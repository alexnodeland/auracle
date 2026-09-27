// PERFORM teaches: an offer heard and answered is a pick.
//
// The claim in views/perform.md, walked end to end on the real engine: hold a
// note, grow an offer, hear it (Peek held past a second), and answer it.
// Asking for another is a pass (the played sound wins), Take is a take (the
// offer wins, after its settle window), and an offer taken without being
// heard counts for nothing. The picks counter is the engine's own observation
// count, so this is the log, not the UI, being checked.
const { test, expect } = require("@playwright/test");
test("an offer heard and answered is a pick; unheard, it is not", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  await page.locator('.bf[data-f="preset"]').click();
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
  await page.waitForTimeout(1500);
  await page.locator('.viewtab[data-view="perform"]').click();
  await page.waitForSelector(".pf-status:has-text('controls reach')", { timeout: 90000 });
  const picks = async () => Number(await page.locator("#duel-count").textContent());
  const p0 = await picks();
  await page.keyboard.down("a");
  const grow = async () => {
    await page.locator(".pf-pad", { hasText: "Offer" }).click();
    await page.waitForSelector(".pf-offer.ready", { timeout: 90000 });
  };
  const peek = async (ms) => {
    const b = await page.locator(".pf-pad", { hasText: "Peek" }).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up();
  };
  await grow();
  await peek(1800);
  await grow(); // passing on the heard offer
  await page.waitForTimeout(1500);
  const p1 = await picks();
  await peek(1800);
  await page.locator(".pf-pad", { hasText: "Take" }).click();
  await expect.poll(picks, { timeout: 60_000 }).toBe(p1 + 1);
  const p2 = await picks();
  // an unheard offer answered teaches nothing
  await grow();
  await page.locator(".pf-pad", { hasText: "Take" }).click();
  // Past the settle window, and past a whole offer's worth of engine time.
  await page.waitForTimeout(12000);
  await grow();
  const p3 = await picks();
  await page.keyboard.up("a");
  expect(p1).toBe(p0 + 1);
  expect(p2).toBe(p1 + 1);
  expect(p3).toBe(p2);
  expect(errs).toEqual([]);
});
