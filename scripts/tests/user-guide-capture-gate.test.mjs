// Run with: node --test scripts/tests/user-guide-capture-gate.test.mjs
// Covers the publish gate for the user-guide capture (AC 7.1.6) without running Playwright.

import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCapture } from "../evaluate-user-guide-capture.js";
import { KEY_PAGE_SLUGS, MAX_FAILED_SHARE, THEMES, listShots, shotStatus } from "../user-guide-capture-report.js";

const OTHER_SLUGS = ["featured", "about", "feedback", "ideas", "keyword-filter", "item-detail"];

/** failed: { slug: [themes that failed] }. Every other theme/slug is captured. */
function records(failed = {}, extra = OTHER_SLUGS) {
  return [...KEY_PAGE_SLUGS, ...extra].map((slug) => {
    const failedThemes = failed[slug] ?? [];
    const themes = Object.fromEntries(
      THEMES.map((theme) => [
        theme,
        failedThemes.includes(theme) ? { status: "failed", error: "boom" } : { status: "captured" },
      ])
    );
    return {
      slug,
      status: failedThemes.length > 0 ? "failed" : "captured",
      attempts: failedThemes.length > 0 ? 3 : 1,
      themes,
    };
  });
}

const both = THEMES;

test("no report blocks the deploy", () => {
  const result = evaluateCapture(null, ["desktop", "mobile"]);
  assert.equal(result.blocked, true);
  assert.match(result.problems[0], /No capture report/);
});

test("a clean run with every key page captured in both themes is allowed", () => {
  const report = { viewports: { desktop: records(), mobile: records() } };
  const result = evaluateCapture(report, ["desktop", "mobile"]);
  assert.equal(result.blocked, false);
  assert.equal(result.failed.length, 0);
  assert.equal(result.total, (KEY_PAGE_SLUGS.length + OTHER_SLUGS.length) * 2 * THEMES.length);
});

test("a key page missing in only the Light theme blocks the deploy", () => {
  const report = { viewports: { desktop: records({ "mode-quiz": ["light"] }), mobile: records() } };
  const result = evaluateCapture(report, ["desktop", "mobile"]);
  assert.equal(result.blocked, true);
  assert.deepEqual(result.keyFailures, ["desktop/light/mode-quiz (failed)"]);
});

test("a key page missing in both themes lists both", () => {
  const report = { viewports: { desktop: records({ home: both }), mobile: records() } };
  const result = evaluateCapture(report, ["desktop", "mobile"]);
  assert.deepEqual(result.keyFailures, ["desktop/dark/home (failed)", "desktop/light/home (failed)"]);
});

test("a key page that never ran counts as missing in every theme", () => {
  const desktop = records().filter((record) => record.slug !== "home");
  const result = evaluateCapture({ viewports: { desktop, mobile: records() } }, ["desktop", "mobile"]);
  assert.equal(result.blocked, true);
  assert.ok(result.keyFailures.includes("desktop/dark/home (missing)"));
  assert.ok(result.keyFailures.includes("desktop/light/home (missing)"));
});

test("failures up to the share limit across all theme and viewport shots are allowed, one more blocks", () => {
  // Failures are on non-key pages only, so the key-page rule is not what decides. One failed Light shot = 1 shot.
  const total = (KEY_PAGE_SLUGS.length + OTHER_SLUGS.length) * 2 * THEMES.length;
  const allowed = Math.floor(total * MAX_FAILED_SHARE);
  const withFailures = (count) => ({
    viewports: {
      desktop: records(Object.fromEntries(OTHER_SLUGS.slice(0, count).map((slug) => [slug, ["light"]]))),
      mobile: records(),
    },
  });

  assert.ok(allowed >= 1 && allowed < OTHER_SLUGS.length);
  assert.equal(evaluateCapture(withFailures(allowed), ["desktop", "mobile"]).blocked, false);
  assert.equal(evaluateCapture(withFailures(allowed + 1), ["desktop", "mobile"]).blocked, true);
});

test("a slug that fails in both themes counts as two failed shots", () => {
  const report = { viewports: { desktop: records({ about: both }), mobile: records() } };
  const result = evaluateCapture(report, ["desktop", "mobile"]);
  assert.equal(result.failed.length, 2);
  assert.deepEqual(result.failed.map((shot) => shot.theme).sort(), ["dark", "light"]);
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

test("a Phase A report without per-theme detail reads as Dark only", () => {
  const legacy = { viewports: { desktop: [{ slug: "home", status: "captured", attempts: 1 }] } };
  assert.equal(shotStatus(legacy, "desktop", "home"), "captured");
  assert.equal(shotStatus(legacy, "desktop", "home", "light"), "missing");
  assert.deepEqual(
    listShots(legacy).map((shot) => `${shot.theme}:${shot.status}`),
    ["dark:captured", "light:missing"]
  );
});
