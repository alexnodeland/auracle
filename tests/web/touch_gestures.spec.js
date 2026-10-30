// A phone's two gestures (#134).
//
// What this claims:
//
// - EVOLVE: a card flicked up is picked. The card follows the finger up, and
//   let go past a third of its height it presses its own PICK, once (so the
//   pick takes PICK's path: its undo window, its toast, the deal). Let go
//   short of that it springs back, and nothing is picked. A drag down or
//   sideways is not the card's: it does not move, picks nothing, and its
//   touchmove is left to the page (not cancelled), so whatever scrolls there
//   scrolls.
// - A long press (a finger held still about half a second) on an EVOLVE
//   card, a bank row, a module on PATCH's rack or TASTE's map shows the model
//   view while the finger stays down, as holding ⌥ does; the finger lifted,
//   it goes, and the hold's click opens nothing. A finger that moves first is
//   an ordinary touch: no model view.
//
// Touches are the browser's own (CDP's `Input.dispatchTouchEvent`), so
// pointer events, touch events and the click that ends a tap all come as on
// a phone.
const { test, expect, goLevel, landed } = require("./fixtures");

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

// A drag's steps, a frame apart; and a rest before a slow release.
const STEP_MS = 16;
const REST_MS = 200;

const touch = (cdp, type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
async function cdpOf(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  return cdp;
}
/** The middle of `loc`, brought into view. */
async function middle(loc) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), h: b.height };
}
/** A finger from `at` by (dx, dy), in steps, then lifted. */
async function drag(page, cdp, at, dx, dy, { steps = 8, lift = true } = {}) {
  await touch(cdp, "touchStart", [{ x: at.x, y: at.y }]);
  for (let i = 1; i <= steps; i++) {
    await touch(cdp, "touchMove", [{ x: at.x + (dx * i) / steps, y: at.y + (dy * i) / steps }]);
    // eslint-disable-next-line playwright/no-wait-for-timeout -- a finger's pace between a drag's steps
    await page.waitForTimeout(STEP_MS);
  }
  if (lift) await touch(cdp, "touchEnd", []);
}
/** Count PICK's clicks and the card's touchmoves the app cancelled. */
const watchPicks = (page) => page.evaluate(() => {
  window.__picks = { a: 0, b: 0, cancelled: 0 };
  for (const s of ["a", "b"]) document.getElementById(`choose-${s}`).addEventListener("click", () => window.__picks[s]++);
  document.getElementById("duel-a").addEventListener("touchmove", (e) => { if (e.defaultPrevented) window.__picks.cancelled++; });
});
const picks = (page) => page.evaluate(() => window.__picks);

async function toEvolve(page, app) {
  await app.boot();
  await goLevel(page, "evolve");
  await landed(page);
  await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 60_000 });
  await watchPicks(page);
}

test("a card flicked up past a third of its height is picked through its PICK", async ({ page, app }) => {
  await toEvolve(page, app);
  const cdp = await cdpOf(page);
  const at = await middle(page.locator("#duel-a .duel-well"));
  const card = await page.locator("#duel-a").boundingBox();
  await drag(page, cdp, at, 0, -Math.round(card.height * 0.6));
  await expect.poll(() => picks(page)).toMatchObject({ a: 1, b: 0 });
  expect((await picks(page)).cancelled, "the upward move was the card's").toBeGreaterThan(0);
  await expect(page.locator("#duel-a")).not.toHaveClass(/\bflicking\b/);
});

test("a card let go short of the line springs back and picks nothing", async ({ page, app }) => {
  await toEvolve(page, app);
  const cdp = await cdpOf(page);
  const at = await middle(page.locator("#duel-a .duel-well"));
  // Slow and short: a quarter of the card's height, held, then lifted.
  await drag(page, cdp, at, 0, -Math.round(at.h * 0.4), { steps: 10, lift: false });
  // It follows the finger while it is down.
  const mid = await page.locator("#duel-a").evaluate((c) => new DOMMatrix(getComputedStyle(c).transform).m42);
  expect(mid).toBeLessThan(-10);
  // eslint-disable-next-line playwright/no-wait-for-timeout -- the finger rests before it lifts, so the release is slow
  await page.waitForTimeout(REST_MS);
  await touch(cdp, "touchEnd", []);
  await expect.poll(() => page.locator("#duel-a").evaluate((c) => c.style.transform)).toBe("");
  expect((await picks(page))).toMatchObject({ a: 0, b: 0 });
});

test("a drag down or sideways on a card is not the card's: no pick, no move, the page keeps the touch", async ({ page, app }) => {
  await toEvolve(page, app);
  const cdp = await cdpOf(page);
  const at = await middle(page.locator("#duel-a .duel-well"));
  await drag(page, cdp, at, 0, 200);
  await drag(page, cdp, at, -150, -20);
  await drag(page, cdp, at, 150, 0);
  expect(await page.locator("#duel-a").evaluate((c) => c.style.transform)).toBe("");
  expect(await picks(page)).toEqual({ a: 0, b: 0, cancelled: 0 });
});

test("a card held until the model view shows, then pushed up in the same touch, is still picked", async ({ page, app }) => {
  await toEvolve(page, app);
  const cdp = await cdpOf(page);
  const at = await middle(page.locator("#duel-a .duel-well"));
  const card = await page.locator("#duel-a").boundingBox();
  // One finger: held still until the view is up, then pushed up and lifted.
  await touch(cdp, "touchStart", [at]);
  await expect(page.locator("body")).toHaveClass(/\bmodel-view\b/, { timeout: 3_000 });
  const dy = -Math.round(card.height * 0.6);
  for (let i = 1; i <= 8; i++) {
    await touch(cdp, "touchMove", [{ x: at.x, y: at.y + (dy * i) / 8 }]);
    // eslint-disable-next-line playwright/no-wait-for-timeout -- a finger's pace between a drag's steps
    await page.waitForTimeout(STEP_MS);
  }
  await touch(cdp, "touchEnd", []);
  await expect.poll(() => picks(page)).toMatchObject({ a: 1, b: 0 });
});

/** Hold a finger still on `loc`: the model view is up while it is down, and
 *  goes when it lifts. */
async function holdShowsModel(page, cdp, loc) {
  const at = await middle(loc);
  await expect(page.locator("body")).not.toHaveClass(/\bmodel-view\b/);
  await touch(cdp, "touchStart", [{ x: at.x, y: at.y }]);
  await expect(page.locator("body")).toHaveClass(/\bmodel-view\b/, { timeout: 3_000 });
  await touch(cdp, "touchEnd", []);
  await expect(page.locator("body")).not.toHaveClass(/\bmodel-view\b/);
}

test("a long press on a card, a bank row, a module and TASTE's map shows the model view while held", async ({ page, app }) => {
  await toEvolve(page, app);
  const cdp = await cdpOf(page);
  await holdShowsModel(page, cdp, page.locator("#duel-b .duel-well"));
  expect(await picks(page), "a hold picks nothing").toMatchObject({ a: 0, b: 0 });
  // A bank row, in the sheet: the hold opens nothing (the row's click is the
  // hold's), and the sheet stays up.
  await page.locator("#bank-btn").click();
  const row = page.locator("#bank-list .bank-item[data-id]:not(.live) .bi-name").first();
  await expect(row).toBeVisible();
  await holdShowsModel(page, cdp, row);
  await expect(page.locator("body")).toHaveClass(/\bbank-open\b/);
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toHaveClass(/\bbank-open\b/);
  // TASTE's map.
  await goLevel(page, "taste");
  await landed(page);
  await holdShowsModel(page, cdp, page.locator("#taste-crt"));
  // The hold's click selects no sound: no card comes up.
  await app.quiet();
  await expect(page.locator("#taste-plate")).not.toHaveClass(/\bon\b/);
  // A module on PATCH's rack: no sheet opens for the hold.
  await goLevel(page, "patch");
  await landed(page);
  const mod = page.locator("#rack-svg [data-key]").first();
  await app.engine((timeout) => expect(mod).toBeVisible({ timeout }), { ms: 60_000 });
  const b = await mod.boundingBox();
  // The module's head: its title strip, away from its knobs and jacks.
  const at = { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + 6) };
  await touch(cdp, "touchStart", [at]);
  await expect(page.locator("body")).toHaveClass(/\bmodel-view\b/, { timeout: 3_000 });
  await touch(cdp, "touchEnd", []);
  await expect(page.locator("body")).not.toHaveClass(/\bmodel-view\b/);
  await app.quiet();
  await expect(page.locator("#module-sheet.on")).toHaveCount(0);
});

test("a finger that moves before the hold closes is an ordinary touch: no model view", async ({ page, app }) => {
  await toEvolve(page, app);
  const cdp = await cdpOf(page);
  const at = await middle(page.locator("#duel-b .duel-well"));
  await touch(cdp, "touchStart", [at]);
  await touch(cdp, "touchMove", [{ x: at.x + 20, y: at.y }]);
  // Still down, longer than a hold takes (QUIET_MS is past TOUCH_HOLD_MS).
  await app.quiet();
  await expect(page.locator("body")).not.toHaveClass(/\bmodel-view\b/);
  await touch(cdp, "touchEnd", []);
  await expect(page.locator("body")).not.toHaveClass(/\bmodel-view\b/);
});
