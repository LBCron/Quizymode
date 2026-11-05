import { expect, test } from "../fixtures";

test.use({ storageState: { cookies: [], origins: [] } });

test("AC 3.0 @smoke - anonymous visitor can start the five-question home quiz", async ({
  page,
}) => {
  await page.goto("/");

  const quickQuizLink = page.getByRole("link", { name: /play a 5-question quiz/i });
  await expect(quickQuizLink).toBeVisible();
  await expect(page.getByText(/no account needed/i)).toBeVisible();

  await quickQuizLink.click();

  // /start (#462) plays the starter pool, or falls back to the fixed Fun Trivia Facts quiz until the pool is seeded.
  await expect(page).toHaveURL(
    /\/start|\/quiz\/collections\/8f9b8c14-8d30-4d94-9b20-4c7bb7f7f511\/fun\+trivia\+facts/
  );
  // Role + exact name: the collection description on the quiz page also contains "question" (#152).
  await expect(page.getByRole("heading", { name: "Question", exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(/^\s*A\./).first()).toBeVisible();
  await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);
});

// 195 px wide is a 390 px phone at 200% zoom (#151).
for (const [width, height] of [
  [195, 422],
  [260, 450],
  [320, 568],
  [390, 844],
] as const) {
  test(`AC 3.0.4 - home has no horizontal overflow at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    // The hero grows when the featured and collections lanes render, which stretches the
    // rotated decorative shapes; measure only after both lane queries have settled.
    const lanesSettled = Promise.all([
      page.waitForResponse((r) => /\/featured(?:\?|$)/.test(r.url()), { timeout: 10_000 }),
      page.waitForResponse((r) => /\/collections\/discover(?:\?|$)/.test(r.url()), {
        timeout: 10_000,
      }),
    ]);
    await page.goto("/");
    await lanesSettled;

    const quickQuizLink = page.getByRole("link", { name: /play a 5-question quiz/i });
    await expect(quickQuizLink).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));

    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  });
}

// Browser-local guest history (#113, AC 3.0.15–3.0.19): phone-sized viewport, keyboard clearing.
test.describe("guest history return card", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("AC 3.0.15 - anonymous completion shows one return card after reload and can be cleared", async ({
    page,
  }) => {
    // The home action opens /start (random starter pool, #462); this test needs the fixed collection, which /start falls back to.
    await page.goto("/quiz/collections/8f9b8c14-8d30-4d94-9b20-4c7bb7f7f511/fun+trivia+facts");
    await expect(page.getByRole("heading", { name: "Question", exact: true })).toBeVisible({
      timeout: 10_000,
    });

    for (let index = 0; index < 5; index += 1) {
      await page.locator('button[type="button"]').filter({ hasText: /^\s*A\./ }).first().click();
      if (index < 4) await page.getByRole("button", { name: /^next$/i }).click();
    }
    await expect(page.getByRole("button", { name: /view results/i })).toBeVisible();

    await page.goto("/");
    await page.reload();
    const card = page.getByRole("region", { name: /your last quiz/i });
    await expect(card).toHaveCount(1);
    await expect(card.getByText(/saved in this browser only/i)).toBeVisible();
    await expect(card.getByRole("link", { name: /practice again/i })).toHaveAttribute(
      "href",
      "/quiz/collections/8f9b8c14-8d30-4d94-9b20-4c7bb7f7f511"
    );

    await card.getByRole("button", { name: /clear guest history/i }).press("Enter");
    await expect(page.getByRole("region", { name: /your last quiz/i })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("region", { name: /your last quiz/i })).toHaveCount(0);
  });
});
