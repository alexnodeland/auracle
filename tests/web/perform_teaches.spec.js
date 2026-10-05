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
const { test, expect } = require("./fixtures");

// How long an offer takes to grow is the renders it is made of (about twenty
// phrase renders), so it is a real wait whose length is the machine's: 3 s on
// a laptop and a minute and more on a loaded CI runner, where the first spare
// took 62 s. Waiting for one is waiting for the engine, not for a bug, so the
// bound is the runner's: `app.offerBudget` (perform_budget.js), from a step
// measured here. What must not wait for an offer, the pick that answers one
// and the Keep, is held to its own tight bounds below and in
// perform_offer_latency.spec.js.

// PEEK held long enough for B to be heard: a second of it while a note sounds.
const HEARD_MS = 1_800;

test("an offer heard and answered is a pick; unheard, it is not", { tag: "@slow" }, async ({ page, app }) => {
  await app.boot();
  // Until PERFORM names the preset, "controls reach" may be the previous
  // patch's (the first pool patch lands on the bench at boot).
  await app.openOnPerform("Glass Pad");
  // Each of the four waits on an offer adds a budget.
  const OFFER_MS = await app.offerBudget({ waits: 4 });
  const picks = async () => Number(await page.locator("#duel-count").textContent());
  const p0 = await picks();
  await page.keyboard.down("a");
  const grow = async () => {
    await page.locator(".pf-pad", { hasText: /^(Offer|Next)$/ }).click();
    await page.waitForSelector(".pf-offer.ready", { timeout: OFFER_MS });
  };
  const peek = async () => {
    const b = await page.locator(".pf-pad", { hasText: "Peek" }).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down(); await page.waitForTimeout(HEARD_MS); await page.mouse.up();
  };
  await grow();
  await peek();
  // NEXT: passing on the heard offer, said at once (its undo window runs
  // from then, so it is read before the next offer is waited for).
  await page.locator(".pf-pad", { hasText: /^(Offer|Next)$/ }).click();
  await expect(page.locator("#toasts")).toContainText("Passed on B. That counts as a pick for what you had.", { timeout: 10_000 });
  await page.waitForSelector(".pf-offer.ready", { timeout: OFFER_MS });
  // It counts once its seven-second undo window has run out, and the engine
  // has recorded it.
  await app.engine((timeout) => expect.poll(picks, { timeout }).toBe(p0 + 1), { ms: 30_000 });
  const p1 = await picks();
  await peek();
  await page.locator(".pf-pad", { hasText: "Take" }).click();
  await app.engine((timeout) => expect.poll(picks, { timeout }).toBe(p1 + 1), { ms: 60_000 });
  const p2 = await picks();
  // an unheard offer answered teaches nothing
  await grow();
  await page.locator(".pf-pad", { hasText: "Take" }).click();
  // Nothing is counted: watched past the take's eight-second window, and past
  // a whole offer's worth of engine time.
  await app.quiet(12_000);
  await grow();
  const p3 = await picks();
  await page.keyboard.up("a");
  expect(p1).toBe(p0 + 1);
  expect(p2).toBe(p1 + 1);
  expect(p3).toBe(p2);
});
