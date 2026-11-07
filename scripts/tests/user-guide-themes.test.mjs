// Run with: node --test scripts/tests/user-guide-themes.test.mjs
// Covers theme folder mapping and the guide site theme fallback choice (AC 7.1.4, 7.1.7, 7.1.8).

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import {
  DEFAULT_THEME,
  THEMES,
  normalizeTheme,
  otherTheme,
  pickShot,
  publishedAssetPath,
  shotDir,
} from "../user-guide-themes.js";
import { publishedImageUrl, resolveScreenshotDir } from "../generate-user-guide.js";

test("themes are Dark then Light and Dark is the default", () => {
  assert.deepEqual(THEMES, ["dark", "light"]);
  assert.equal(DEFAULT_THEME, "dark");
  assert.equal(normalizeTheme("light"), "light");
  assert.equal(normalizeTheme("sepia"), "dark");
  assert.equal(otherTheme("dark"), "light");
  assert.equal(otherTheme("light"), "dark");
});

test("capture folders are <root>/<theme>/<viewport>", () => {
  const root = path.join("x", "shots");
  assert.equal(shotDir(root, "dark", "desktop"), path.join(root, "dark", "desktop"));
  assert.equal(shotDir(root, "light", "mobile"), path.join(root, "light", "mobile"));
  assert.equal(shotDir(root, "bogus", "tablet"), path.join(root, "dark", "desktop"));
});

test("published assets are assets/<theme>/<viewport>/<file>", () => {
  assert.equal(publishedAssetPath("dark", "desktop", "01.home.png"), "assets/dark/desktop/01.home.png");
  assert.equal(publishedAssetPath("light", "mobile", "01.home.png"), "assets/light/mobile/01.home.png");
});

test("markdown guides link the Dark set on Pages", () => {
  assert.equal(
    publishedImageUrl("desktop", "01.home.png"),
    "https://yanis-kr.github.io/Quizymode/assets/dark/desktop/01.home.png"
  );
  assert.equal(
    publishedImageUrl("mobile", "01.home.png"),
    "https://yanis-kr.github.io/Quizymode/assets/dark/mobile/01.home.png"
  );
});

test("screenshot dir resolves per theme and viewport under the configured root", () => {
  const previous = process.env.USER_GUIDE_SCREENSHOT_ROOT;
  process.env.USER_GUIDE_SCREENSHOT_ROOT = path.resolve("some-root");
  try {
    assert.equal(resolveScreenshotDir("mobile", "light"), path.resolve("some-root", "light", "mobile"));
    assert.equal(resolveScreenshotDir("desktop"), path.resolve("some-root", "dark", "desktop"));
  } finally {
    if (previous === undefined) delete process.env.USER_GUIDE_SCREENSHOT_ROOT;
    else process.env.USER_GUIDE_SCREENSHOT_ROOT = previous;
  }
});

const sources = { dark: "assets/dark/desktop/01.home.png", light: "assets/light/desktop/01.home.png" };

test("pickShot returns the selected theme when it is available", () => {
  assert.deepEqual(pickShot(sources, {}, "light"), { src: sources.light, fallbackTheme: null, unavailable: false });
  assert.deepEqual(pickShot(sources, {}, "dark"), { src: sources.dark, fallbackTheme: null, unavailable: false });
});

test("pickShot falls back to the other theme with a marker when the variant is missing", () => {
  assert.deepEqual(pickShot({ dark: sources.dark, light: "" }, {}, "light"), {
    src: sources.dark,
    fallbackTheme: "dark",
    unavailable: false,
  });
  assert.deepEqual(pickShot({ dark: "", light: sources.light }, {}, "dark"), {
    src: sources.light,
    fallbackTheme: "light",
    unavailable: false,
  });
});

test("pickShot treats a failed variant as missing even if a stale file exists", () => {
  const choice = pickShot(sources, { light: true }, "light");
  assert.equal(choice.src, sources.dark);
  assert.equal(choice.fallbackTheme, "dark");
});

test("pickShot shows the unavailable card when neither theme has a usable shot", () => {
  assert.deepEqual(pickShot({ dark: "", light: "" }, {}, "dark"), { src: "", fallbackTheme: null, unavailable: true });
  assert.equal(pickShot(sources, { dark: true, light: true }, "light").unavailable, true);
  assert.equal(pickShot(undefined, undefined, "dark").unavailable, true);
});

test("pickShot only sees one viewport, so it can never cross viewports", () => {
  const mobile = { dark: "", light: "" };
  assert.equal(pickShot(mobile, {}, "dark").unavailable, true); // desktop shots exist but are not passed in
});
