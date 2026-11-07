// Theme and viewport helpers shared by the capture spec, the markdown generator, the site build and the gate
// (#506 Phase B, AC 7.1.4, 7.1.7). Only imports `path` on purpose: scripts/generate-user-guide.js and the report
// module both depend on this file, and `pickShot` is also inlined into the guide site's browser script.

import path from "path";

/** Capture order: Dark first (the app's default), Light second. */
export const THEMES = ["dark", "light"];
export const DEFAULT_THEME = "dark";

/** The app's theme storage key and `<html>` marker (AC 14.5). */
export const APP_THEME_STORAGE_KEY = "quizymode.theme.v1";
export const APP_THEME_ATTRIBUTE = "data-theme";

export function normalizeTheme(value) {
  return value === "light" ? "light" : "dark";
}

export function otherTheme(theme) {
  return theme === "light" ? "dark" : "light";
}

/** `<root>/<theme>/<viewport>`, the folder one capture run writes into. */
export function shotDir(root, theme, viewport) {
  return path.join(root, normalizeTheme(theme), viewport === "mobile" ? "mobile" : "desktop");
}

/** Path of one image inside the published Pages site, relative to the site root. */
export function publishedAssetPath(theme, viewport, filename) {
  return `assets/${normalizeTheme(theme)}/${viewport === "mobile" ? "mobile" : "desktop"}/${filename}`;
}

/**
 * Chooses what a guide step shows for the selected theme within one viewport. Never crosses viewports (AC 7.1.7).
 * Self-contained (no outer references) because the guide site inlines it via Function.prototype.toString.
 *
 * @param {{dark?: string, light?: string}} sources image URL per theme; empty/absent when the file is missing
 * @param {{dark?: boolean, light?: boolean}} failed true when the capture report marks that theme's shot failed
 * @param {string} theme selected theme
 * @returns {{src: string, fallbackTheme: string|null, unavailable: boolean}}
 */
export function pickShot(sources, failed, theme) {
  const own = theme === "light" ? "light" : "dark";
  const other = own === "light" ? "dark" : "light";
  const usable = (name) => Boolean(sources && sources[name]) && !(failed && failed[name]);

  if (usable(own)) return { src: sources[own], fallbackTheme: null, unavailable: false };
  if (usable(other)) return { src: sources[other], fallbackTheme: other, unavailable: false };
  return { src: "", fallbackTheme: null, unavailable: true };
}
