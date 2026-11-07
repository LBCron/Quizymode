import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "../fixtures";
import path from "path";
import fs from "fs";
import { slugToFilename } from "../../scripts/generate-user-guide.js";
import { screenshotRoot, writeViewportRecords } from "../../scripts/user-guide-capture-report.js";
import { THEMES, shotDir } from "../../scripts/user-guide-themes.js";
import { setAppTheme, type GuideTheme } from "./theme-switch";

const HOME_SAMPLE_COLLECTION_ID = "8f9b8c14-8d30-4d94-9b20-4c7bb7f7f511";
const HOME_SAMPLE_COLLECTION_SLUG = "fun+trivia+facts";
const HOME_SAMPLE_COLLECTION_DETAIL_PATH = `/collections/${HOME_SAMPLE_COLLECTION_ID}/${HOME_SAMPLE_COLLECTION_SLUG}`;
const USER_GUIDE_COMMENT_TEXT = "Study tip: grouping capitals by continent makes them easier to remember — try Europe first, then expand to other regions.";

async function safeGoto(page: Page, url: string) {
  await page.goto(url, { waitUntil: "load", timeout: 20_000 });
  await waitForUiToSettle(page);
  await expect(page.locator("body")).toBeVisible();
}

async function signInWithEnvCredentials(page: Page) {
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;
  if (!email || !password) {
    return false;
  }

  await page.goto("/login", { waitUntil: "load", timeout: 20_000 }).catch(() => {});
  await page.locator("#email").fill(email).catch(() => {});
  await page.locator("#password").fill(password).catch(() => {});
  await page.getByRole("button", { name: /sign in/i }).click().catch(() => {});
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 15_000 }).catch(() => {});
  await waitForUiToSettle(page);
  return true;
}

async function ensureSignedIn(page: Page) {
  const signOutButton = page.getByRole("button", { name: /sign out/i });
  if (await signOutButton.isVisible().catch(() => false)) {
    return;
  }

  await signInWithEnvCredentials(page);
}

// The app's loading indicators all render an `.animate-spin` element (LoadingSpinner,
// route fallbacks, comboboxes). A visible role="status" alone is not a spinner: pages
// show permanent status messages (e.g. flashcard or search feedback) that must not block capture.
async function hasVisibleSpinner(page: Page) {
  return page
    .locator(".animate-spin")
    .evaluateAll((elements) =>
      elements.some((element) => {
        const htmlElement = element as HTMLElement;
        return (
          htmlElement.offsetParent !== null &&
          htmlElement.offsetWidth > 1 &&
          htmlElement.offsetHeight > 1
        );
      })
    )
    .catch(() => false);
}

async function waitForUiToSettle(page: Page) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

  // Require the page to be spinner-free for 3 consecutive 200 ms polls (600 ms
  // total) before declaring it settled. A single clean check can land in the
  // brief gap between two sequential loading phases (e.g. auth resolve → data
  // fetch), which would capture a blank screen or a spinner mid-transition.
  let cleanStreak = 0;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    if (!(await hasVisibleSpinner(page))) {
      cleanStreak += 1;
      if (cleanStreak >= 3) {
        break;
      }
    } else {
      cleanStreak = 0;
    }

    await page.waitForTimeout(200);
  }
}

// Retry policy for one shot (AC 7.1.5): 3 attempts; wait 2 s, reload, try again; wait 5 s, reload, try again.
const ATTEMPTS_PER_SHOT = 3;
const RETRY_WAITS_MS = [2_000, 5_000];
// One attempt may not run longer than this, so a shot cannot push its test past the 150 s limit.
const ATTEMPT_TIMEOUT_MS = 55_000;
// No new attempt starts once a shot has used this much time.
const SHOT_RETRY_WINDOW_MS = 90_000;
// Total time spent in retries across the whole run.
const RUN_RETRY_BUDGET_MS = 5 * 60_000;

type ThemeOutcome = { status: "captured" | "failed"; error?: string };

type ShotRecord = {
  slug: string;
  // Overall outcome: "captured" only when every theme was captured (AC 7.1.4).
  status: "captured" | "failed";
  attempts: number;
  error?: string;
  path?: string;
  themes: Record<GuideTheme, ThemeOutcome>;
};

type Viewport = "desktop" | "mobile";

// Per-theme outcomes of the attempt that is running now. Reset before every attempt of a shot.
let attemptThemes: Partial<Record<GuideTheme, ThemeOutcome>> = {};

// Every shot's outcome, per viewport, for failures.json. Rewritten after each shot so a later crash keeps earlier results.
const shotRecords: Record<Viewport, ShotRecord[]> = { desktop: [], mobile: [] };
let retryTimeSpentMs = 0;

function viewportOf(testInfo: TestInfo): Viewport {
  return testInfo.project.name === "screenshots-mobile" ? "mobile" : "desktop";
}

function recordShot(viewport: Viewport, record: ShotRecord) {
  shotRecords[viewport] = shotRecords[viewport].filter((existing) => existing.slug !== record.slug).concat(record);
  try {
    writeViewportRecords(screenshotRoot(), viewport, shotRecords[viewport]);
  } catch (error) {
    console.warn(`Could not write the user-guide capture report: ${String(error)}`);
  }
}

function describeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0].slice(0, 300);
}

function currentPath(page: Page) {
  try {
    return new URL(page.url()).pathname;
  } catch {
    return "";
  }
}

async function withAttemptTimeout(work: () => Promise<void>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Attempt exceeded ${timeoutMs / 1000}s`)), timeoutMs);
  });
  const running = work();
  // A late failure after the timeout is already handled; it must not surface as an unhandled rejection.
  running.catch(() => {});
  try {
    await Promise.race([running, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A page counts as loaded only when it is signed in, #root renders, no error screen shows, and no spinner remains. */
async function assertPageReady(page: Page) {
  if (currentPath(page).endsWith("/login")) {
    throw new Error("Redirected to /login: not signed in");
  }

  await expect(page.locator("#root")).toBeVisible({ timeout: 10_000 });

  if (await page.getByText("Something went wrong", { exact: false }).first().isVisible().catch(() => false)) {
    throw new Error("The error screen is showing");
  }

  if (await hasVisibleSpinner(page)) {
    throw new Error("A loading spinner is still visible");
  }
}

/**
 * Runs one shot with retries. It never throws: a shot that still fails is recorded in failures.json,
 * and the rest of the serial suite keeps running (AC 7.1.5).
 */
async function runShot(page: Page, testInfo: TestInfo, slug: string, shoot: () => Promise<void>) {
  const viewport = viewportOf(testInfo);
  const startedAt = Date.now();
  let attempts = 0;
  let lastError: unknown = null;
  let lastThemes: Partial<Record<GuideTheme, ThemeOutcome>> = {};

  for (let attempt = 0; attempt < ATTEMPTS_PER_SHOT; attempt += 1) {
    const retryStartedAt = Date.now();
    if (attempt > 0) {
      if (Date.now() - startedAt > SHOT_RETRY_WINDOW_MS || retryTimeSpentMs > RUN_RETRY_BUDGET_MS) {
        break;
      }

      await page.waitForTimeout(RETRY_WAITS_MS[attempt - 1]);
      await page.reload({ waitUntil: "load", timeout: 20_000 }).catch(() => {});
    }

    attempts += 1;
    attemptThemes = {};
    try {
      await withAttemptTimeout(shoot, ATTEMPT_TIMEOUT_MS);
      if (attempt > 0) retryTimeSpentMs += Date.now() - retryStartedAt;
      recordShot(viewport, {
        slug,
        status: "captured",
        attempts,
        themes: { dark: { status: "captured" }, light: { status: "captured" } },
      });
      return;
    } catch (error) {
      if (attempt > 0) retryTimeSpentMs += Date.now() - retryStartedAt;
      lastError = error;
      lastThemes = attemptThemes;
    }
  }

  const error = describeError(lastError);
  const themes = Object.fromEntries(
    THEMES.map((theme) => [theme, lastThemes[theme as GuideTheme] ?? { status: "failed", error }])
  ) as Record<GuideTheme, ThemeOutcome>;
  const record: ShotRecord = {
    slug,
    status: "failed",
    attempts,
    error,
    path: currentPath(page),
    themes,
  };
  recordShot(viewport, record);
  console.warn(`User-guide shot failed: ${viewport}/${slug} after ${attempts} attempt(s): ${record.error}`);
}

/** `<root>/<theme>/<viewport>` (AC 7.1.4). The root is USER_GUIDE_SCREENSHOT_ROOT or docs/user-guide/screenshots. */
function getScreenshotDir(testInfo: TestInfo, theme: GuideTheme) {
  return shotDir(screenshotRoot(), theme, viewportOf(testInfo));
}

async function openMobileMenuIfNeeded(page: Page, testInfo: TestInfo, slug: string) {
  if (testInfo.project.name !== "screenshots-mobile") {
    return;
  }

  if (slug !== "home") {
    return;
  }

  const menuButton = page.getByRole("button", { name: /open main menu/i });
  if (!(await menuButton.isVisible().catch(() => false))) {
    return;
  }

  await menuButton.click().catch(() => {});
  await waitForUiToSettle(page);
}

async function waitForSelectValue(
  page: Page,
  selector: string,
  expectedValue: string,
  timeout = 15_000
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const value = await page.locator(selector).inputValue().catch(() => "");
    if (value.trim().toLowerCase() === expectedValue.trim().toLowerCase()) {
      return true;
    }

    await page.waitForTimeout(200);
  }

  return false;
}

async function waitForTextToDisappear(page: Page, textPattern: RegExp) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    const matchingText = await page
      .getByText(textPattern)
      .evaluateAll((elements) =>
        elements.some((element) => {
          const htmlElement = element as HTMLElement;
          return htmlElement.offsetParent !== null;
        })
      )
      .catch(() => false);

    if (!matchingText) {
      return;
    }

    await page.waitForTimeout(200);
  }
}

async function waitForInputValue(
  page: Page,
  selector: string,
  expectedValue: string,
  timeout = 15_000
) {
  const startedAt = Date.now();
  const normalizedExpected = expectedValue.trim();

  while (Date.now() - startedAt < timeout) {
    const value = await page.locator(selector).inputValue().catch(() => "");
    if (value.trim() === normalizedExpected) {
      return true;
    }

    await page.waitForTimeout(200);
  }

  return false;
}

async function waitForAnyVisible(
  page: Page,
  selectors: string[],
  timeout = 15_000
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    for (const selector of selectors) {
      const isVisible = await page.locator(selector).first().isVisible().catch(() => false);
      if (isVisible) {
        return selector;
      }
    }

    await page.waitForTimeout(200);
  }

  throw new Error(
    `Timed out after ${timeout}ms waiting for one of: ${selectors.join(", ")}`
  );
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  slug: string,
  url: string,
  waitFor?: string | string[]
) {
  await ensureSignedIn(page);
  await safeGoto(page, url);
  if (waitFor) {
    const selectors = Array.isArray(waitFor) ? waitFor : [waitFor];
    await waitForAnyVisible(page, selectors, 12_000);
  }

  await captureCurrentPage(page, testInfo, slug);
}

/**
 * Takes the Dark shot, switches to Light in place, takes the Light shot, and restores Dark, all from one navigation
 * (AC 7.1.4). A theme that fails is recorded in `attemptThemes` and the error is rethrown so runShot retries.
 */
async function captureCurrentPage(page: Page, testInfo: TestInfo, slug: string) {
  await waitForUiToSettle(page);
  await assertPageReady(page);
  await openMobileMenuIfNeeded(page, testInfo, slug);

  try {
    for (const theme of THEMES as GuideTheme[]) {
      try {
        await setAppTheme(page, theme);
        if (theme !== "dark") {
          await waitForUiToSettle(page);
          await assertPageReady(page);
        }
        const screenshotDir = getScreenshotDir(testInfo, theme);
        fs.mkdirSync(screenshotDir, { recursive: true });
        await page.screenshot({
          path: path.join(screenshotDir, slugToFilename(slug)),
          fullPage: true,
          scale: "css",
        });
        attemptThemes[theme] = { status: "captured" };
      } catch (error) {
        attemptThemes[theme] = { status: "failed", error: describeError(error) };
        throw error;
      }
    }
  } finally {
    // Leave the app in Dark for the next shot, even when Light failed.
    await setAppTheme(page, "dark").catch(() => {});
  }
}

async function clickMode(page: Page, modeName: string) {
  await page
    .getByRole("tab", { name: new RegExp(modeName, "i") })
    .first()
    .click()
    .catch(() => {});
  await waitForUiToSettle(page);
}

function pickCollectionDetailHref(hrefs: string[]) {
  return (
    hrefs.find((href) =>
      /^\/collections\/[^/?#]+(?:\/[^/?#]+)?$/.test(href)
    ) ?? null
  );
}

async function getCurrentCollectionDetailHref(page: Page) {
  const hrefs = await page
    .locator("a[href^='/collections/']")
    .evaluateAll((elements) =>
      elements
        .map((element) => element.getAttribute("href"))
        .filter((href): href is string => Boolean(href))
    )
    .catch(() => []);

  return pickCollectionDetailHref(hrefs);
}

async function ensureOwnedCollectionDetailPath(page: Page) {
  await safeGoto(page, "/collections");

  let href = await getCurrentCollectionDetailHref(page);
  if (href) {
    return href;
  }

  await page
    .getByRole("button", { name: /new collection/i })
    .click()
    .catch(() => {});
  await page.locator("#collection-name").fill("User Guide Collection").catch(() => {});
  await page
    .getByRole("button", { name: /^create$/i })
    .click()
    .catch(() => {});
  await page.waitForTimeout(2_000);

  href = await getCurrentCollectionDetailHref(page);
  return href;
}

async function getAnyCollectionDetailPath(page: Page) {
  const ownedHref = await ensureOwnedCollectionDetailPath(page);
  if (ownedHref) {
    return ownedHref;
  }

  await safeGoto(page, "/collections?tab=discover");
  const discoverHref = await getCurrentCollectionDetailHref(page);
  return discoverHref ?? HOME_SAMPLE_COLLECTION_DETAIL_PATH;
}

async function openCollectionDetail(page: Page, preferOwned = false) {
  const href = preferOwned
    ? await ensureOwnedCollectionDetailPath(page)
    : await getAnyCollectionDetailPath(page);

  await safeGoto(page, href ?? HOME_SAMPLE_COLLECTION_DETAIL_PATH);
}

async function ensureListMode(page: Page) {
  await clickMode(page, "list");
}

async function waitForCategoryItemsLoaded(page: Page) {
  await waitForUiToSettle(page);
  await waitForAnyVisible(page, [
    "button[title='Manage collections']",
    "button[title*='Add to ']",
    "button[title*='Remove from ']",
    "h3.text-lg",
    "text=Answer:",
    "text=No items found.",
  ]);
}

async function waitForCollectionsPageLoaded(page: Page) {
  await waitForUiToSettle(page);
  await waitForTextToDisappear(page, /loading collections/i);
  await waitForAnyVisible(page, [
    "button:has-text('New collection')",
    "button[title='Edit collection']",
    "button[title='Active collection']",
    "button[title='Set as active collection']",
    "text=No collections yet. Create your first collection!",
  ]);
}

async function waitForManageCollectionsDialog(page: Page) {
  await waitForAnyVisible(page, ["text=Manage Collections"]);
  await waitForTextToDisappear(page, /loading collections/i);
  await waitForAnyVisible(page, [
    "input[type='checkbox']",
    "text=No collections available",
  ]);
}

async function clickConsentIfPresent(page: Page) {
  const consentButton = page.getByRole("button", { name: /i understand/i });
  if (await consentButton.isVisible().catch(() => false)) {
    await consentButton.click().catch(() => {});
    await consentButton.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
    await waitForUiToSettle(page);
  }
}

function collectionRowXPath(name: string) {
  return `xpath=//div[contains(@class,'flex items-center gap-3')][.//span[normalize-space()="${name}"]]`;
}

function collectionCardXPath(name: string) {
  return `xpath=//div[contains(@class,'rounded-2xl')][.//h3[normalize-space()="${name}"]]`;
}

async function ensureCollectionExistsInManageDialog(page: Page, name: string) {
  const existing = page.locator(collectionRowXPath(name));
  if (await existing.first().isVisible().catch(() => false)) {
    return;
  }

  await page.locator("input[placeholder='Enter collection name']").fill(name).catch(() => {});
  await page.locator("button[title='Add new collection']").click().catch(() => {});
  await waitForAnyVisible(page, [collectionRowXPath(name)], 15_000);
}

async function setActiveCollectionInManageDialog(page: Page, name: string) {
  const row = page.locator(collectionRowXPath(name)).first();
  await row.locator("input[type='radio']").check().catch(() => {});
  await page.waitForTimeout(300);
}

async function openManageCollectionsForFirstItem(page: Page) {
  await waitForCategoryItemsLoaded(page);
  const manageCollectionsButton = page
    .locator("button[title='Manage collections']")
    .first();
  const fallbackCollectionButton = page
    .locator(
      "xpath=(//button[contains(@title,'Add to') or contains(@title,'Remove from')]/preceding-sibling::button[1])[1]"
    )
    .first();

  if (await manageCollectionsButton.isVisible().catch(() => false)) {
    await manageCollectionsButton.scrollIntoViewIfNeeded().catch(() => {});
    await manageCollectionsButton.click({ force: true }).catch(() => {});
  } else {
    await fallbackCollectionButton.scrollIntoViewIfNeeded().catch(() => {});
    await fallbackCollectionButton.click({ force: true }).catch(() => {});
  }

  await waitForManageCollectionsDialog(page);
}

async function ensureSecondCollectionIsActive(page: Page, name: string) {
  await openManageCollectionsForFirstItem(page);
  await ensureCollectionExistsInManageDialog(page, name);
  await setActiveCollectionInManageDialog(page, name);
}

async function closeManageCollectionsDialog(page: Page) {
  await page
    .locator("xpath=//h3[normalize-space()='Manage Collections']/following-sibling::button[1]")
    .click()
    .catch(() => {});
  await page.waitForTimeout(300);
}

async function addFirstItemsToActiveCollection(page: Page, count: number) {
  const addButtons = page.locator("button[title*='Add to ']");
  const total = await addButtons.count();
  let addedCount = 0;

  for (let index = 0; index < total && addedCount < count; index += 1) {
    const button = addButtons.nth(index);
    const enabled = await button.isEnabled().catch(() => false);
    if (!enabled) {
      continue;
    }

    await button.click().catch(() => {});
    await page.waitForTimeout(500);
    addedCount += 1;
  }

  await waitForUiToSettle(page);
}

async function getCollectionHrefByName(page: Page, name: string) {
  await safeGoto(page, "/collections");
  await waitForCollectionsPageLoaded(page);

  const card = page.locator(collectionCardXPath(name)).first();
  const link = card.locator("a[href^='/collections/']").first();
  return (await link.getAttribute("href").catch(() => null)) ?? HOME_SAMPLE_COLLECTION_DETAIL_PATH;
}

async function openCollectionByName(page: Page, name: string) {
  const href = await getCollectionHrefByName(page, name);
  await safeGoto(page, href);
  await waitForCollectionDetailLoaded(page);
}

async function waitForCollectionDetailLoaded(page: Page) {
  await waitForUiToSettle(page);
  await waitForAnyVisible(page, [
    "text=Collection",
    "button:has-text('Details')",
    "text=No items in this collection.",
  ]);
}

async function waitForCollectionQuizModeLoaded(page: Page) {
  await page.waitForURL(/\/quiz\/collections\//, { timeout: 15_000 }).catch(() => {});
  await waitForUiToSettle(page);
  await waitForTextToDisappear(page, /loading/i);
  await waitForAnyVisible(page, [
    "h3:has-text('Question')",
    "h3:has-text('Select an answer:')",
    "text=/Score:\\s*\\d+\\s*\\/\\s*\\d+\\s*correct/i",
    "button[title='View item details']",
  ]);
}

async function getFirstCategoryItemDetailHref(page: Page) {
  await ensureSignedIn(page);
  await safeGoto(page, "/categories/geography/capitals/world");
  await ensureListMode(page);
  await waitForCategoryItemsLoaded(page);

  return (
    (await page
      .locator("a[title='View item details'][href^='/items/']")
      .first()
      .getAttribute("href")
      .catch(() => null)) ??
    null
  );
}

async function openFirstCategoryItemDetail(page: Page) {
  await ensureSignedIn(page);
  await safeGoto(page, "/categories/geography/capitals/world");
  await ensureListMode(page);
  await waitForCategoryItemsLoaded(page);

  const detailButton = page
    .locator("a[title='View item details'][href^='/items/']")
    .first();
  if (await detailButton.isVisible().catch(() => false)) {
    await detailButton.click().catch(() => {});
    await page.waitForURL(/\/items\/[^/?#]+/, { timeout: 15_000 }).catch(() => {});
  } else {
    const href = await getFirstCategoryItemDetailHref(page);
    await safeGoto(page, href ?? "/categories/geography/capitals/world");
  }

  await waitForAnyVisible(page, [
    "text=Item details",
    "text=Question",
    "button:has-text('Comments')",
  ]);
}

async function rateCurrentItemFiveStars(page: Page) {
  const fiveStarButton = page.locator("button[title='Rate 5 stars']").first();
  if (await fiveStarButton.isVisible().catch(() => false)) {
    await fiveStarButton.click().catch(() => {});
    await waitForUiToSettle(page);
  }
}

async function openCommentsForCurrentItem(page: Page) {
  const commentsButton = page
    .getByRole("button", { name: /comments \(/i })
    .first();
  await commentsButton.scrollIntoViewIfNeeded().catch(() => {});
  await commentsButton.click({ force: true }).catch(() => {});
  await waitForAnyVisible(page, [
    "[role='dialog']",
    "textarea[placeholder='Write your comment...']",
    "text=No comments yet. Be the first to comment!",
  ]);
}

async function addCommentForCurrentItem(page: Page, text: string) {
  await openCommentsForCurrentItem(page);
  const commentBox = page.locator("textarea[placeholder='Write your comment...']").first();
  if (await commentBox.isVisible().catch(() => false)) {
    await commentBox.fill(text).catch(() => {});
    await page.getByRole("button", { name: /post comment/i }).click().catch(() => {});
    await waitForAnyVisible(page, [`text=${text}`], 15_000);
    await waitForUiToSettle(page);
  }
}

async function setPageSizeToFive(page: Page) {
  await page.evaluate(async () => {
    const prefix = "CognitoIdentityServiceProvider";
    const accessTokenKey = Object.keys(localStorage).find(
      (k) => k.startsWith(prefix) && k.endsWith(".accessToken")
    );
    if (!accessTokenKey) return;
    const token = localStorage.getItem(accessTokenKey);
    if (!token) return;
    await fetch("/api/users/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ key: "PageSize", value: "5" }),
    }).catch(() => {});
  }).catch(() => {});
}

async function openScopedAddItemsPage(page: Page) {
  await ensureSignedIn(page);
  // The Create hub (/create) has no scope fields; the scoped form lives at /create/question.
  await safeGoto(page, "/create/question?category=geography&keywords=capitals,world");
  await clickConsentIfPresent(page);
  // A prefilled topic shows as the pill (the cascading selects stay mounted but hidden; read them with inputValue()).
  await waitForAnyVisible(page, ["[data-testid=\"topic-pill\"]"]);
}

async function applyKeywordFilterWithResults(page: Page) {
  await safeGoto(page, "/categories/geography/capitals/world");
  await ensureListMode(page);
  await waitForCategoryItemsLoaded(page);

  const preferredKeywords = ["western-europe", "oceania", "belgium", "switzerland", "australia"];
  for (const keyword of preferredKeywords) {
    const button = page.locator(`button[title*='click to filter']:has-text('${keyword}')`).first();
    if (!(await button.isVisible().catch(() => false))) {
      continue;
    }

    await button.click().catch(() => {});
    await waitForUiToSettle(page);
    await waitForAnyVisible(page, [
      "h3.text-lg",
      `button.bg-indigo-600:has-text('${keyword}')`,
      `button.text-white:has-text('${keyword}')`,
    ]);

    const itemCards = await page.locator("h3.text-lg").count().catch(() => 0);
    const noItems = await page.getByText(/no items found/i).isVisible().catch(() => false);
    if (itemCards > 0 && !noItems) {
      return;
    }
  }
}

/** Declares one shot as a serial test. The body runs inside runShot, so a failed shot is recorded and never fails the test. */
function shotTest(slug: string, body: (page: Page, testInfo: TestInfo) => Promise<void>) {
  test(slug, async ({ page }, testInfo) => {
    await runShot(page, testInfo, slug, () => body(page, testInfo));
  });
}

test.describe("User guide screenshots", () => {
  test.describe.configure({ mode: "serial" });
  // Per-test limit (AC 7.1.5): a shot's attempts are bounded inside runShot, so 150 s is never reached by one shot.
  test.setTimeout(150_000);

  const secondCollectionName = "Second collection";

  shotTest("home", async (page, testInfo) => {
    await setPageSizeToFive(page);
    await capture(page, testInfo, "home", "/");
  });

  shotTest("featured", async (page, testInfo) => {
    await capture(page, testInfo, "featured", "/featured", [
      "button:has-text('Sets')",
      "text=No featured sets yet",
    ]);
  });

  shotTest("categories", async (page, testInfo) => {
    await capture(page, testInfo, "categories", "/categories");
  });

  shotTest("add-items", async (page, testInfo) => {
    await capture(page, testInfo, "add-items", "/create");
  });

  shotTest("add-new-item", async (page, testInfo) => {
    await capture(page, testInfo, "add-new-item", "/create/question");
  });

  shotTest("create-notes", async (page, testInfo) => {
    await capture(page, testInfo, "create-notes", "/create/notes");
  });

  shotTest("create-import", async (page, testInfo) => {
    await capture(page, testInfo, "create-import", "/create/import");
  });

  shotTest("collections-mine", async (page, testInfo) => {
    await capture(page, testInfo, "collections-mine", "/collections", [
      "button:has-text('New collection')",
      "button[title='Edit collection']",
    ]);
  });

  shotTest("collection-detail", async (page, testInfo) => {
    await openCollectionByName(page, secondCollectionName);
    await captureCurrentPage(page, testInfo, "collection-detail");
  });

  shotTest("about", async (page, testInfo) => {
    await capture(page, testInfo, "about", "/about");
  });

  shotTest("feedback", async (page, testInfo) => {
    await capture(page, testInfo, "feedback", "/feedback");
  });

  shotTest("ideas", async (page, testInfo) => {
    await capture(page, testInfo, "ideas", "/ideas");
  });

  shotTest("nav-geography", async (page, testInfo) => {
    await capture(page, testInfo, "nav-geography", "/categories/geography");
  });

  shotTest("nav-geography-capitals", async (page, testInfo) => {
    await capture(page, testInfo, "nav-geography-capitals", "/categories/geography/capitals");
  });

  shotTest("nav-geography-capitals-world", async (page, testInfo) => {
    await capture(
      page,
      testInfo,
      "nav-geography-capitals-world",
      "/categories/geography/capitals/world"
    );
  });

  shotTest("mode-flashcards", async (page, testInfo) => {
    await safeGoto(page, "/categories/geography/capitals/world");
    await clickMode(page, "flashcards");
    await captureCurrentPage(page, testInfo, "mode-flashcards");
  });

  shotTest("mode-quiz", async (page, testInfo) => {
    await safeGoto(page, "/categories/geography/capitals/world");
    await clickMode(page, "quiz");
    await captureCurrentPage(page, testInfo, "mode-quiz");
  });

  shotTest("items-add-to-collection", async (page, testInfo) => {
    await safeGoto(page, "/categories/geography/capitals/world");
    await ensureListMode(page);
    await waitForCategoryItemsLoaded(page);
    await captureCurrentPage(page, testInfo, "items-add-to-collection");
  });

  shotTest("items-collection-badges", async (page, testInfo) => {
    await safeGoto(page, "/categories/geography/capitals/world");
    await ensureListMode(page);
    await waitForCategoryItemsLoaded(page);
    await addFirstItemsToActiveCollection(page, 3);
    await captureCurrentPage(page, testInfo, "items-collection-badges");
  });

  shotTest("items-collection-removed", async (page, testInfo) => {
    await safeGoto(page, "/categories/geography/capitals/world");
    await ensureListMode(page);
    await waitForCategoryItemsLoaded(page);

    let removeButtons = page.locator("button[title*='Remove from ']");
    if ((await removeButtons.count()) === 0) {
      await page.locator("button[title*='Add to ']").first().click().catch(() => {});
      await waitForUiToSettle(page);
      removeButtons = page.locator("button[title*='Remove from ']");
    }

    await removeButtons.first().click().catch(() => {});
    await waitForUiToSettle(page);
    await captureCurrentPage(page, testInfo, "items-collection-removed");
  });

  shotTest("active-collection-selector", async (page, testInfo) => {
    await safeGoto(page, "/categories/geography/capitals/world");
    await ensureListMode(page);
    await waitForCategoryItemsLoaded(page);
    await ensureSecondCollectionIsActive(page, secondCollectionName);
    await captureCurrentPage(page, testInfo, "active-collection-selector");
    await closeManageCollectionsDialog(page);
    await addFirstItemsToActiveCollection(page, 2);
  });

  shotTest("collection-new", async (page, testInfo) => {
    await safeGoto(page, "/collections");
    await page
      .getByRole("button", { name: /new collection/i })
      .click()
      .catch(() => {});
    await page.waitForTimeout(1_000);
    await page.locator("#collection-name").fill("My Second Collection").catch(() => {});
    await captureCurrentPage(page, testInfo, "collection-new");
    await page
      .getByRole("button", { name: /^create$/i })
      .click()
      .catch(() => {});
    await page.waitForTimeout(1_500);
  });

  shotTest("collections-mine-two", async (page, testInfo) => {
    await capture(page, testInfo, "collections-mine-two", "/collections", [
      "button[title='Edit collection']",
      "button[title='Active collection']",
    ]);
  });

  shotTest("keyword-filter", async (page, testInfo) => {
    await applyKeywordFilterWithResults(page);
    await captureCurrentPage(page, testInfo, "keyword-filter");
  });

  shotTest("item-detail", async (page, testInfo) => {
    await openFirstCategoryItemDetail(page);
    await captureCurrentPage(page, testInfo, "item-detail");
  });

  shotTest("item-rating-five-stars", async (page, testInfo) => {
    await openFirstCategoryItemDetail(page);
    await rateCurrentItemFiveStars(page);
    await captureCurrentPage(page, testInfo, "item-rating-five-stars");
  });

  shotTest("item-comment-added", async (page, testInfo) => {
    await openFirstCategoryItemDetail(page);
    await addCommentForCurrentItem(page, USER_GUIDE_COMMENT_TEXT);
    await waitForAnyVisible(page, ["[role='dialog']", `text=${USER_GUIDE_COMMENT_TEXT}`]);
    await captureCurrentPage(page, testInfo, "item-comment-added");
  });

  shotTest("collection-detail-flashcards", async (page, testInfo) => {
    await openCollectionByName(page, secondCollectionName);
    await clickMode(page, "flashcards");
    await captureCurrentPage(page, testInfo, "collection-detail-flashcards");
  });

  shotTest("collection-detail-quiz", async (page, testInfo) => {
    await openCollectionByName(page, secondCollectionName);
    await clickMode(page, "quiz");
    await waitForCollectionQuizModeLoaded(page);
    await captureCurrentPage(page, testInfo, "collection-detail-quiz");
  });

  shotTest("collection-settings-public", async (page, testInfo) => {
    await safeGoto(page, "/collections");
    await waitForCollectionsPageLoaded(page);

    const card = page.locator(collectionCardXPath(secondCollectionName)).first();
    await card.locator("button[title='Edit collection']").click().catch(() => {});
    await waitForAnyVisible(page, ["text=Edit Collection", "#edit-collection-is-public"]);
    await waitForInputValue(page, "#edit-collection-name", secondCollectionName);

    const publicToggle = page.locator("#edit-collection-is-public");
    const isChecked = await publicToggle.isChecked().catch(() => false);
    if (!isChecked) {
      await publicToggle.check().catch(() => {});
    }

    await captureCurrentPage(page, testInfo, "collection-settings-public");

    await page.getByRole("button", { name: /^save$/i }).click().catch(() => {});
    await waitForTextToDisappear(page, /saving/i);
    await waitForCollectionsPageLoaded(page);
  });

  shotTest("collections-discover-public", async (page, testInfo) => {
    await capture(page, testInfo, "collections-discover-public", "/collections?tab=discover");
  });

  shotTest("collection-bookmark", async (page, testInfo) => {
    await safeGoto(page, "/collections?tab=discover");
    await page
      .locator("button[title*='Bookmark']")
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(1_000);
    await captureCurrentPage(page, testInfo, "collection-bookmark");
  });

  shotTest("collections-bookmarked", async (page, testInfo) => {
    await capture(page, testInfo, "collections-bookmarked", "/collections?tab=bookmarked");
  });

  shotTest("add-items-prepopulated", async (page, testInfo) => {
    await openScopedAddItemsPage(page);
    await waitForSelectValue(page, "#item-form-category", "geography");
    await waitForSelectValue(page, "#item-form-rank1", "capitals");
    await waitForSelectValue(page, "#item-form-rank2", "world");
    await captureCurrentPage(page, testInfo, "add-items-prepopulated");
  });
});
