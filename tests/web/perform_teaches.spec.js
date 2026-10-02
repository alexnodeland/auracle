// PERFORM teaches: an offer heard and answered is a pick.
//
// The claim in views/perform.md, walked end to end on the real engine: hold a
// note, grow an offer, hear it (Peek held past a second), and answer it.
// Asking for another (the Offer pad reads NEXT while B holds one) is a pass
// (the played sound wins), Take is a take (the offer wins); each counts after
// its undo window, and an offer taken without being heard counts for nothing. The picks counter is the engine's own observation
// count plus the EVOLVE picks, cuts and ratings it has not answered for yet,
// and PERFORM makes none of those, so this is the log, not the UI, being
// checked.
const { test, expect } = require("@playwright/test");
const budget = require("./perform_budget.js");

// How long an offer takes to grow is the renders it is made of (about twenty
// phrase renders), so it is a real wait whose length is the machine's: 3 s on
// a laptop and a minute and more on a loaded CI runner, where the first spare
// took 62 s. Waiting for one is waiting for the engine, not for a bug, so the
// bound is the runner's: `offerBudget` (perform_budget.js), from a step
// measured here. What must not wait for an offer, the pick that answers one
// and the Keep, is held to its own tight bounds below and in
// perform_offer_latency.spec.js.

test("an offer heard and answered is a pick; unheard, it is not", { tag: "@slow" }, async ({ page }) => {
  // The boot and the fixed waits; each of the four waits on an offer adds a
  // budget below.
  test.setTimeout(240_000);
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await budget.watch(page);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  await page.locator('.bf[data-f="preset"]').click();
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
  await page.waitForTimeout(1500);
  await page.locator('.viewtab[data-view="perform"]').click();
  // Until PERFORM names the preset, "controls reach" may be the previous
  // patch's (the first pool patch lands on the bench at boot).
  await expect(page.locator(".pf-name")).toHaveText("Glass Pad", { timeout: 30000 });
  await page.waitForSelector(".pf-status:has-text('controls reach')", { timeout: 90000 });
  const OFFER_MS = await budget.offerBudget(page, { waits: 4 });
  const picks = async () => Number(await page.locator("#duel-count").textContent());
  const p0 = await picks();
  await page.keyboard.down("a");
  const grow = async () => {
    await page.locator(".pf-pad", { hasText: /^(Offer|Next)$/ }).click();
    await page.waitForSelector(".pf-offer.ready", { timeout: OFFER_MS });
  };
  const peek = async (ms) => {
    const b = await page.locator(".pf-pad", { hasText: "Peek" }).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up();
  };
  await grow();
  await peek(1800);
  // NEXT: passing on the heard offer, said at once (its undo window runs
  // from then, so it is read before the next offer is waited for).
  await page.locator(".pf-pad", { hasText: /^(Offer|Next)$/ }).click();
  await expect(page.locator("#toasts")).toContainText("Passed on B. That counts as a pick for what you had.", { timeout: 10_000 });
  await page.waitForSelector(".pf-offer.ready", { timeout: OFFER_MS });
  // It counts once its seven-second undo window has run out.
  await expect.poll(picks, { timeout: 30_000 }).toBe(p0 + 1);
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
