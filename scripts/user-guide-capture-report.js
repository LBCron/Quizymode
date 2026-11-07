// Shared format for the user-guide capture report (AC 7.1.5, 7.1.6).
// playwright/screenshots/capture.spec.ts writes it, build-user-guide-site.js and
// evaluate-user-guide-capture.js read it. Keep the shape in one place.

import fs from "fs";
import path from "path";
import { projectRoot } from "./generate-user-guide.js";

export const REPORT_FILE_NAME = "failures.json";
export const VIEWPORTS = ["desktop", "mobile"];

/** A shot on one of these pages must be captured in every viewport that ran, or the run is not deployed. */
export const KEY_PAGE_SLUGS = ["home", "categories", "collection-detail", "mode-quiz", "mode-flashcards"];

/** More than this share of failed shots blocks the deploy. */
export const MAX_FAILED_SHARE = 0.1;

export function screenshotRoot() {
  const configured = process.env.USER_GUIDE_SCREENSHOT_ROOT;
  return path.resolve(configured || path.join(projectRoot, "docs", "user-guide", "screenshots"));
}

export function reportPath(root = screenshotRoot()) {
  return path.join(root, REPORT_FILE_NAME);
}

/** Returns the parsed report, or null when it is missing or unreadable. */
export function readCaptureReport(root = screenshotRoot()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(reportPath(root), "utf8"));
    return parsed && typeof parsed.viewports === "object" && parsed.viewports !== null ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Replaces one viewport's shot list and rewrites the report. Other viewports already in the file are kept,
 * because the desktop and mobile Playwright projects can run in separate processes.
 *
 * @param {string} root
 * @param {string} viewport "desktop" or "mobile"
 * @param {{slug: string, status: "captured"|"failed", attempts: number, error?: string, path?: string}[]} records
 */
export function writeViewportRecords(root, viewport, records) {
  fs.mkdirSync(root, { recursive: true });
  const current = readCaptureReport(root);
  const report = {
    generatedAt: new Date().toISOString(),
    viewports: { ...(current?.viewports ?? {}), [viewport]: records },
  };
  fs.writeFileSync(reportPath(root), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

/** Flat list of every recorded shot, with its viewport attached. */
export function listShots(report) {
  if (!report) return [];
  return Object.entries(report.viewports).flatMap(([viewport, records]) =>
    (Array.isArray(records) ? records : []).map((record) => ({ viewport, ...record }))
  );
}

/** The record for one slug in one viewport, or null when that shot was never recorded. */
export function shotRecord(report, viewport, slug) {
  const records = report?.viewports?.[viewport];
  if (!Array.isArray(records)) return null;
  return records.find((record) => record.slug === slug) ?? null;
}

/** "captured", "failed", or "missing" (never recorded). */
export function shotStatus(report, viewport, slug) {
  return shotRecord(report, viewport, slug)?.status ?? "missing";
}
