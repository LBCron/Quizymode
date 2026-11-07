// Shared format for the user-guide capture report (AC 7.1.5, 7.1.6).
// playwright/screenshots/capture.spec.ts writes it, build-user-guide-site.js and
// evaluate-user-guide-capture.js read it. Keep the shape in one place.

import fs from "fs";
import path from "path";
import { projectRoot } from "./generate-user-guide.js";
import { DEFAULT_THEME, THEMES } from "./user-guide-themes.js";

export const REPORT_FILE_NAME = "failures.json";
export const VIEWPORTS = ["desktop", "mobile"];
export { THEMES };

/** A shot on one of these pages must be captured in every theme and every viewport that ran, or the run is not deployed. */
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
 * @param {{slug: string, status: "captured"|"failed", attempts: number, error?: string, path?: string,
 *   themes?: Record<string, {status: "captured"|"failed", error?: string}>}[]} records
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

/**
 * Status of one theme within a record. `status` on the record is the overall outcome (captured only when every
 * theme was captured); `themes` has the per-theme detail. A record without `themes` (Phase A report) describes Dark only.
 */
export function themeStatus(record, theme) {
  if (!record) return "missing";
  if (record.themes && typeof record.themes === "object") return record.themes[theme]?.status ?? "missing";
  return theme === DEFAULT_THEME ? record.status : "missing";
}

/** Flat list of every recorded shot per theme, with its viewport and theme attached. */
export function listShots(report) {
  if (!report) return [];
  return Object.entries(report.viewports).flatMap(([viewport, records]) =>
    (Array.isArray(records) ? records : []).flatMap((record) =>
      THEMES.map((theme) => ({
        viewport,
        theme,
        ...record,
        status: themeStatus(record, theme),
        error: record.themes?.[theme]?.error ?? record.error,
      }))
    )
  );
}

/** The record for one slug in one viewport, or null when that shot was never recorded. */
export function shotRecord(report, viewport, slug) {
  const records = report?.viewports?.[viewport];
  if (!Array.isArray(records)) return null;
  return records.find((record) => record.slug === slug) ?? null;
}

/** "captured", "failed", or "missing" (never recorded) for one theme (Dark by default). */
export function shotStatus(report, viewport, slug, theme = DEFAULT_THEME) {
  return themeStatus(shotRecord(report, viewport, slug), theme);
}
