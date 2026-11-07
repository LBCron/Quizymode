#!/usr/bin/env node
// Decides whether a user-guide capture may be published (AC 7.1.6), and lists failed shots.
//
//   node scripts/evaluate-user-guide-capture.js                       # gate: exit 1 blocks the Pages deploy
//   node scripts/evaluate-user-guide-capture.js --mode report         # local: exit 2 when any shot failed
//   node scripts/evaluate-user-guide-capture.js --viewports desktop   # limit to the viewports that ran
//
// The gate blocks when there is no capture report (sign-in or setup failed before any shot ran), when a key page
// was not captured in a viewport that ran, or when more than MAX_FAILED_SHARE of the recorded shots failed.
// In CI, the summary goes to GITHUB_STEP_SUMMARY and the decision to GITHUB_OUTPUT as `deploy=true|false`.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  KEY_PAGE_SLUGS,
  MAX_FAILED_SHARE,
  THEMES,
  VIEWPORTS,
  listShots,
  readCaptureReport,
  reportPath,
  screenshotRoot,
  shotStatus,
} from "./user-guide-capture-report.js";

function parseArgs(argv) {
  const options = { mode: "gate", viewports: VIEWPORTS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode" && argv[index + 1]) {
      options.mode = argv[index + 1];
      index += 1;
    } else if (arg === "--viewports" && argv[index + 1]) {
      options.viewports = argv[index + 1].split(",").map((value) => value.trim()).filter(Boolean);
      index += 1;
    }
  }
  if (!["gate", "report"].includes(options.mode)) {
    throw new Error(`Unknown --mode "${options.mode}". Expected gate or report.`);
  }
  return options;
}

export function evaluateCapture(report, viewports) {
  const problems = [];
  const keyFailures = [];

  if (!report) {
    problems.push("No capture report was written. Sign-in or capture setup failed before any shot ran.");
    return { blocked: true, problems, keyFailures, failed: [], total: 0, failedShare: 0 };
  }

  for (const viewport of viewports) {
    const recorded = listShots(report).filter((shot) => shot.viewport === viewport);
    if (recorded.length === 0) {
      problems.push(`No shots were recorded for ${viewport}.`);
      continue;
    }
    for (const slug of KEY_PAGE_SLUGS) {
      for (const theme of THEMES) {
        const status = shotStatus(report, viewport, slug, theme);
        if (status !== "captured") {
          keyFailures.push(`${viewport}/${theme}/${slug} (${status})`);
        }
      }
    }
  }

  const shots = listShots(report).filter((shot) => viewports.includes(shot.viewport));
  // Every theme/viewport shot counts once; a theme that was never recorded counts as failed.
  const failed = shots.filter((shot) => shot.status !== "captured");
  const total = shots.length;
  const failedShare = total === 0 ? 1 : failed.length / total;

  if (total === 0) {
    problems.push("The capture report has no shots for the viewports that ran.");
  }

  const blocked = problems.length > 0 || keyFailures.length > 0 || failedShare > MAX_FAILED_SHARE;
  return { blocked, problems, keyFailures, failed, total, failedShare };
}

function renderSummary(result, root) {
  const lines = [];
  const percent = (result.failedShare * 100).toFixed(1);
  lines.push("## User guide capture");
  lines.push("");
  lines.push(`- Shots recorded: ${result.total}`);
  lines.push(`- Failed shots: ${result.failed.length} (${percent}%, limit ${MAX_FAILED_SHARE * 100}%)`);
  lines.push(`- Decision: ${result.blocked ? "**not deployed**; the previous guide stays live" : "deploy"}`);
  lines.push("");

  for (const problem of result.problems) {
    lines.push(`- Problem: ${problem}`);
  }
  if (result.keyFailures.length > 0) {
    lines.push("- Key pages not captured:");
    for (const item of result.keyFailures) {
      lines.push(`  - ${item}`);
    }
  }
  if (result.problems.length + result.keyFailures.length > 0) {
    lines.push("");
  }

  if (result.failed.length > 0) {
    lines.push("### Failed shots");
    lines.push("");
    lines.push("| Viewport | Theme | Shot | Attempts | Last error |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const shot of result.failed) {
      const error = (shot.error ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
      lines.push(`| ${shot.viewport} | ${shot.theme} | ${shot.slug} | ${shot.attempts} | ${error} |`);
    }
    lines.push("");
  }

  lines.push(`Report: \`${reportPath(root)}\``);
  return lines.join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = screenshotRoot();
  const report = readCaptureReport(root);
  const result = evaluateCapture(report, options.viewports);
  const summary = renderSummary(result, root);

  console.log(summary);

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, "utf8");
  }
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `deploy=${result.blocked ? "false" : "true"}\n`, "utf8");
  }

  if (options.mode === "report") {
    const anyIssue = result.failed.length > 0 || result.blocked;
    process.exit(anyIssue ? 2 : 0);
  }

  process.exit(result.blocked ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
