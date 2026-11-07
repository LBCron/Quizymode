import type { Page } from "@playwright/test";
import { APP_THEME_ATTRIBUTE, APP_THEME_STORAGE_KEY } from "../../scripts/user-guide-themes.js";

export type GuideTheme = "dark" | "light";

/**
 * Switches the app's theme in place, without navigating (#506 Phase B, AC 7.1.4): writes the theme storage key,
 * dispatches the `storage` event the app listens for (AC 14.5), and waits until `<html data-theme>` shows the theme.
 */
export async function setAppTheme(page: Page, theme: GuideTheme, timeoutMs = 5_000): Promise<void> {
  await page.evaluate(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
      window.dispatchEvent(
        new StorageEvent("storage", { key, newValue: value, storageArea: window.localStorage })
      );
    },
    [APP_THEME_STORAGE_KEY, theme]
  );

  await page.waitForFunction(
    ([attribute, value]) => document.documentElement.getAttribute(attribute) === value,
    [APP_THEME_ATTRIBUTE, theme],
    { timeout: timeoutMs }
  );
  // Let the repaint after the attribute change finish before a screenshot.
  await page.waitForTimeout(150);
}
