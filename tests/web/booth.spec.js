// Booth mode: the instrument plays itself when nobody is at the keys, and a
// visitor's first touch hands it over.
//
// Walked on the real engine with a short idle (`?booth=3`): attract starts in
// PERFORM, holds a chord and moves two named controls; one key press stops it
// on the spot (banner gone, Wander and Blend home) — and nothing it did was
// counted as a pick. Attract runs quiet: its offers are never answered.
const { test, expect } = require("@playwright/test");

test("attract plays in PERFORM, hands over on a key, and teaches nothing", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("/?booth=3");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  const picks = await page.locator("#duel-count").textContent();

  await expect(page.locator("#booth-attract")).not.toHaveClass(/hidden/, { timeout: 30_000 });
  await expect(page.locator("#ba-cap")).toContainText("under one hand", { timeout: 90_000 });
  await expect(page.locator('.rail-stop[data-level="perform"]')).toHaveAttribute("aria-current", "location");
  await page.waitForTimeout(3000);
  const moved = await page.evaluate(() =>
    [0, 1, 2, 3, 4, 5].some((i) => Number(document.querySelector(`.pf-knob[data-i="${i}"]`).getAttribute("aria-valuenow")) !== 0),
  );
  expect(moved, "the invisible hand moves a named control").toBe(true);

  await page.keyboard.press("h");
  await expect(page.locator("#booth-attract")).toHaveClass(/hidden/, { timeout: 5000 });
  await page.waitForTimeout(1000);
  for (const i of [6, 7]) {
    await expect(page.locator(`.pf-knob[data-i="${i}"]`)).toHaveAttribute("aria-valuenow", "0.00");
  }
  expect(await page.locator("#duel-count").textContent()).toBe(picks);
  expect(errs).toEqual([]);
});
