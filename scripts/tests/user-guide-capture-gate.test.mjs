// Run with: node --test scripts/tests/user-guide-capture-gate.test.mjs
// Covers the publish gate for the user-guide capture (AC 7.1.6) without running Playwright.

import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCapture } from "../evaluate-user-guide-capture.js";
import { KEY_PAGE_SLUGS, MAX_FAILED_SHARE } from "../user-guide-capture-report.js";

const OTHER_SLUGS = ["featured", "about", "feedback", "ideas", "keyword-filter", "item-detail"];

function records(failedSlugs = [], extra = OTHER_SLUGS) {
  return [...KEY_PAGE_SLUGS, ...extra].map((slug) =>
    failedSlugs.includes(slug)
      ? { slug, status: "failed", attempts: 3, error: "boom" }
      : { slug, status: "captured", attempts: 1 }
  );
}

test("no report blocks the deploy", () => {
  const result = evaluateCapture(null, ["desktop", "mobile"]);
  assert.equal(result.blocked, true);
  assert.match(result.problems[0], /No capture report/);
});

test("a clean run with every key page captured is allowed", () => {
  const report = { viewports: { desktop: records(), mobile: records() } };
  const result = evaluateCapture(report, ["desktop", "mobile"]);
  assert.equal(result.blocked, false);
  assert.equal(result.failed.length, 0);
});

test("a missing key page blocks the deploy even when few shots failed", () => {
  const report = { viewports: { desktop: records(["mode-quiz"]), mobile: records() } };
  const result = evaluateCapture(report, ["desktop", "mobile"]);
  assert.equal(result.blocked, true);
  assert.ok(result.keyFailures.includes("desktop/mode-quiz (failed)"));
});

test("a key page that never ran counts as missing", () => {
  const desktop = records().filter((record) => record.slug !== "home");
  const result = evaluateCapture({ viewports: { desktop, mobile: records() } }, ["desktop", "mobile"]);
  assert.equal(result.blocked, true);
  assert.ok(result.keyFailures.includes("desktop/home (missing)"));
});

test("failures up to the share limit are allowed, one more blocks", () => {
  // 22 shots (11 per viewport). Failures are only on non-key pages, so the key-page rule is not what decides.
  const total = (KEY_PAGE_SLUGS.length + OTHER_SLUGS.length) * 2;
  const allowed = Math.floor(total * MAX_FAILED_SHARE); // 2
  const withFailures = (count) => ({
    viewports: { desktop: records(OTHER_SLUGS.slice(0, count)), mobile: records() },
  });

  assert.equal(evaluateCapture(withFailures(allowed), ["desktop", "mobile"]).blocked, false);
  assert.equal(evaluateCapture(withFailures(allowed + 1), ["desktop", "mobile"]).blocked, true);
});

test("a viewport that ran with no records blocks the deploy", () => {
  const result = evaluateCapture({ viewports: { desktop: records() } }, ["desktop", "mobile"]);
  assert.equal(result.blocked, true);
  assert.ok(result.problems.some((problem) => problem.includes("mobile")));
});

test("only the viewports that ran are judged", () => {
  const result = evaluateCapture({ viewports: { desktop: records() } }, ["desktop"]);
  assert.equal(result.blocked, false);
});
