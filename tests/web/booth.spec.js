// Booth mode: the instrument plays itself when nobody is at the keys, and a
// visitor's first touch hands it over.
//
// Walked on the real engine with a short idle (`?booth=3`): attract starts in
// PERFORM, holds a chord and moves two named controls; one key press stops it
// on the spot (banner gone, Wander and Blend home) — and nothing it did was
// counted as a pick. Attract runs quiet: its offers are never answered.
const { test, expect } = require("./fixtures");

test("attract plays in PERFORM, hands over on a key, and teaches nothing", async ({ page, app }) => {
  // A first visit (the warm start and the tours not yet seen), seeded.
  await app.boot({ warmed: false, seen: false, query: "?booth=3" });
  await page.locator("#warm-skip").click();
  const picks = await page.locator("#duel-count").textContent();

  await expect(page.locator("#booth-attract")).not.toHaveClass(/hidden/, { timeout: 30_000 });
  await app.engine((timeout) => expect(page.locator("#ba-cap")).toContainText("under one hand", { timeout }), { ms: 90_000 });
  await expect(page.locator('.rail-stop[data-level="perform"]')).toHaveAttribute("aria-current", "location");
  await expect
    .poll(() => page.evaluate(() =>
      [0, 1, 2, 3, 4, 5].some((i) => Number(document.querySelector(`.pf-knob[data-i="${i}"]`).getAttribute("aria-valuenow")) !== 0),
    ), { message: "the invisible hand moves a named control" })
    .toBe(true);

  await page.keyboard.press("h");
  await expect(page.locator("#booth-attract")).toHaveClass(/hidden/, { timeout: 5000 });
  // Given the time to, nothing it did is counted as a pick.
  await app.quiet();
  // Blend (the slider in the well) and Wander (at the start of the pads) home.
  await expect(page.locator('.pf-blend[data-i="6"] input')).toHaveAttribute("aria-valuenow", "0.00");
  await expect(page.locator('.pf-knob[data-i="7"]')).toHaveAttribute("aria-valuenow", "0.00");
  expect(await page.locator("#duel-count").textContent()).toBe(picks);
});
