// A phone's two gestures (#134).
//
// What this claims:
//
// - EVOLVE: a card swiped up is picked. The card follows the finger up, and
//   let go past a third of its height it presses its own PICK, once (so the
//   pick takes PICK's path: its undo window, its toast, the deal). Let go
//   short of that it springs back, and nothing is picked. A drag down or
//   sideways is not the card's: it does not move, picks nothing, and its
//   touchmove is left to the page (not cancelled), so whatever scrolls there
//   scrolls.
// - A long press (about half a second, without moving) on an EVOLVE
//   card, a bank row or TASTE's map shows the model view while the finger
//   stays down, as holding ⌥ does; the finger lifted, it goes, and the
//   hold's click opens nothing (on the map, a sound a tap on its dot opens). A finger
//   that moves first is an ordinary touch: no model view. A module on
//   PATCH's rack keeps its own long press (its menu) and is not held here.
// - The swipe up picks on a small phone (360 × 640) where the level's
//   column scrolls. The level is one screen there (phone_fits.spec.js), and
//   scrolls only where it cannot fit; the test makes the pair taller than
//   the screen to have a column that scrolls.
//
// In Chromium the touches are the browser's own (CDP's
// `Input.dispatchTouchEvent`), so pointer events, touch events and the click
// that ends a tap all come as on a phone. Under AURACLE_BROWSER=webkit, on an
// iPhone's profile, they are made in the page (`cdpOf`, which says what that
// proves), and the test that needs the browser's own scroll is Chromium's.
const { test, expect, goLevel, landed } = require("./fixtures");

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

// A drag's steps, a frame apart; and a rest before a slow release.
const STEP_MS = 16;
const REST_MS = 200;

const touch = (cdp, type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
/** A finger. In Chromium, the browser's own touches (CDP). WebKit has no
 *  CDP and Playwright drives no touch move there, so its finger is made in
 *  the page: pointer events (pointerType touch) and TouchEvents at the point,
 *  to the element first touched, and a click after a short, still touch.
 *  That proves the gestures' own handling in WebKit's engine; not what only
 *  the browser decides (its own scroll, `touch-action`, whether it sends a
 *  click after a long press, `isTrusted`). */
async function cdpOf(page) {
  if (page.context().browser().browserType().name() === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    return cdp;
  }
  return { send: (_m, { type, touchPoints }) => page.evaluate(PAGE_FINGER, { type, at: touchPoints[0] || null }) };
}
/** WebKit's finger, in the page (above). */
const PAGE_FINGER = ({ type, at }) => {
  const f = window.__finger || (window.__finger = {});
  const pointer = (name, x, y) => f.target.dispatchEvent(new PointerEvent(name, {
    pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true, button: 0, buttons: name === "pointerup" ? 0 : 1,
  }));
  const touches = (x, y) => {
    try {
      return [new Touch({ identifier: 7, target: f.target, clientX: x, clientY: y })];
    } catch {
      return [{ identifier: 7, target: f.target, clientX: x, clientY: y }];
    }
  };
  const touchEv = (name, list, x, y) => {
    let e;
    try {
      e = new TouchEvent(name, { bubbles: true, cancelable: true, composed: true, touches: list, targetTouches: list, changedTouches: touches(x, y) });
    } catch {
      e = new Event(name, { bubbles: true, cancelable: true, composed: true });
      Object.defineProperty(e, "touches", { value: list });
      Object.defineProperty(e, "changedTouches", { value: touches(x, y) });
    }
    f.target.dispatchEvent(e);
  };
  if (type === "touchStart") {
    Object.assign(f, { target: document.elementFromPoint(at.x, at.y), x: at.x, y: at.y, lx: at.x, ly: at.y, t0: document.timeline.currentTime, moved: false });
    pointer("pointerdown", at.x, at.y);
    touchEv("touchstart", touches(at.x, at.y), at.x, at.y);
  } else if (type === "touchMove") {
    if (Math.hypot(at.x - f.x, at.y - f.y) > 10) f.moved = true;
    Object.assign(f, { lx: at.x, ly: at.y });
    pointer("pointermove", at.x, at.y);
    touchEv("touchmove", touches(at.x, at.y), at.x, at.y);
  } else {
    pointer("pointerup", f.lx, f.ly);
    touchEv("touchend", [], f.lx, f.ly);
    if (!f.moved && document.timeline.currentTime - f.t0 < 450) f.target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: f.lx, clientY: f.ly, detail: 1 }));
  }
};
/** The middle of `loc`, brought into view. */
async function middle(loc) {
  // The bank redraws as the engine answers, so a row's node can be swapped
  // mid-scroll: the scroll and the read are retried on the row as it is then.
  let b = null;
  await expect(async () => {
    await loc.scrollIntoViewIfNeeded({ timeout: 2_000 });
    b = await loc.boundingBox({ timeout: 2_000 });
    expect(b).not.toBeNull();
  }).toPass({ timeout: 15_000 });
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

async function swipePicks(page, app) {
  await toEvolve(page, app);
  const cdp = await cdpOf(page);
  const at = await middle(page.locator("#duel-a .duel-well"));
  const card = await page.locator("#duel-a").boundingBox();
  await drag(page, cdp, at, 0, -Math.round(card.height * 0.6));
  await expect.poll(() => picks(page)).toMatchObject({ a: 1, b: 0 });
  expect((await picks(page)).cancelled, "the upward move was the card's").toBeGreaterThan(0);
}

test("a card swiped up past a third of its height is picked through its PICK", async ({ page, app }) => {
  await swipePicks(page, app);
  await expect(page.locator("#duel-a")).not.toHaveClass(/\bswiping\b/);
});

test.describe("a small phone, 360 × 640", () => {
  test.use({ viewport: { width: 360, height: 640 } });
  // The column's own scroll is the browser's, which WebKit's finger (made in
  // the page) does not drive.
  // eslint-disable-next-line playwright/no-skipped-test -- a browser that cannot make the gesture, not a test turned off
  test.skip(({ browserName }) => browserName === "webkit", "the browser's own scroll needs the browser's own touches (CDP, Chromium)");

  test("a card swiped up is picked and the level's column does not scroll; a drag down scrolls it", async ({ page, app }) => {
    await toEvolve(page, app);
    const cdp = await cdpOf(page);
    const col = page.locator("#view-evolve");
    // A pair taller than the screen, as on a phone too short for the level:
    // the column runs past the screen, and starts part way down.
    await page.addStyleTag({ content: "#view-evolve .duel-row { min-height: 900px; }" });
    await expect.poll(() => col.evaluate((c) => c.scrollHeight - c.clientHeight)).toBeGreaterThan(40);
    const half = (c) => { c.scrollTop = Math.round((c.scrollHeight - c.clientHeight) / 2); return c.scrollTop; };
    // A swipe up is the card's: picked, and the column stays put.
    const at = await middle(page.locator("#duel-a .duel-well"));
    const before = await col.evaluate(half);
    const box = await page.locator("#duel-a .duel-well").boundingBox();
    const from = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    const card = await page.locator("#duel-a").boundingBox();
    // Read with the finger still down: once picked, the next pair may move
    // the column on its own.
    await drag(page, cdp, from, 0, -Math.round(card.height * 0.6), { lift: false });
    expect(await col.evaluate((c) => c.scrollTop), "the column did not scroll under the swipe").toBe(before);
    await touch(cdp, "touchEnd", []);
    await expect.poll(() => picks(page)).toMatchObject({ a: 1, b: 0 });
    // A drag down is the column's: it scrolls, and picks nothing more.
    const mid = await col.evaluate(half);
    await drag(page, cdp, { x: at.x, y: from.y }, 0, 80);
    await expect.poll(() => col.evaluate((c) => c.scrollTop)).toBeLessThan(mid);
    expect(await picks(page)).toMatchObject({ a: 1, b: 0 });
  });
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
  await expect(page.locator("body")).toHaveClass(/\bmodel-view\b/);
  const dy = -Math.round(card.height * 0.6);
  for (let i = 1; i <= 8; i++) {
    await touch(cdp, "touchMove", [{ x: at.x, y: at.y + (dy * i) / 8 }]);
    // eslint-disable-next-line playwright/no-wait-for-timeout -- a finger's pace between a drag's steps
    await page.waitForTimeout(STEP_MS);
  }
  await touch(cdp, "touchEnd", []);
  await expect.poll(() => picks(page)).toMatchObject({ a: 1, b: 0 });
});

/** Where TASTE's map draws a sound, on the page, by the app's own layout
 *  (taste-geom.js, as taste_hold.spec.js reads it), the nth sound but the
 *  one in hand. */
async function dotAt(page, n) {
  await expect.poll(() => page.evaluate(() => (window.__tap.facts.views?.map?.points || []).length)).toBeGreaterThan(0);
  const q = await page.evaluate(async (n) => {
    const geom = await import("/taste-geom.js");
    const well = document.getElementById("taste-well");
    const W = Math.max(200, well.clientWidth);
    const H = Math.max(160, well.clientHeight);
    const pts = window.__tap.facts.views.map.points.filter((p) => p.id != null);
    const f = geom.mapFrame(W, H, pts.length, { track: true });
    // Not the sound in hand: the nth of the others.
    const live = document.querySelector("#bank-list .bank-item.live")?.dataset.id;
    const [id, at] = [...geom.mapLayout(pts, f.box, f.minD)].filter(([k]) => String(k) !== live)[n];
    return { id, x: at.x, y: at.y };
  }, n);
  const box = await page.locator("#taste-crt").boundingBox();
  return { id: q.id, x: Math.round(box.x + q.x), y: Math.round(box.y + q.y) };
}

/** A long press on `loc`: the model view is up while it is down, and
 *  goes when it lifts. */
async function holdShowsModel(page, cdp, loc) {
  const at = await middle(loc);
  await expect(page.locator("body")).not.toHaveClass(/\bmodel-view\b/);
  await touch(cdp, "touchStart", [{ x: at.x, y: at.y }]);
  await expect(page.locator("body")).toHaveClass(/\bmodel-view\b/);
  await touch(cdp, "touchEnd", []);
  await expect(page.locator("body")).not.toHaveClass(/\bmodel-view\b/);
}

test("a long press on a card, a bank row and a dot on TASTE's map shows the model view while held, and opens nothing a tap would", async ({ page, app }) => {
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
  // TASTE's map, on its dots: a hold on one opens nothing, where a tap on
  // another opens that sound (its row in the bank is the one in hand).
  // The map's places are the views the engine posts as the pool fills (on a
  // slow runner the pool was still arriving here, and a later post moved the
  // dots under the tap): wait for the whole pool, and for the views that
  // place every sound in it, before reading where a dot is.
  await app.filled();
  await app.engine((timeout) => expect.poll(() => page.evaluate(() => {
    const f = window.__tap.facts;
    const placed = new Set((f.views?.map?.points || []).filter((p) => p.id != null).map((p) => p.id));
    return f.ranked.every((r) => placed.has(r.id));
  }), { timeout, message: "the map's views placing every sound in the pool" }).toBe(true));
  await goLevel(page, "taste");
  await landed(page);
  const held = await dotAt(page, 0);
  const rowOf = (id) => page.locator(`#bank-list .bank-item[data-id="${id}"]`);
  await touch(cdp, "touchStart", [{ x: held.x, y: held.y }]);
  await expect(page.locator("body")).toHaveClass(/\bmodel-view\b/);
  await touch(cdp, "touchEnd", []);
  await expect(page.locator("body")).not.toHaveClass(/\bmodel-view\b/);
  await app.quiet();
  await expect(rowOf(held.id)).not.toHaveClass(/\blive\b/);
  const tapped = await dotAt(page, 1);
  await touch(cdp, "touchStart", [{ x: tapped.x, y: tapped.y }]);
  await touch(cdp, "touchEnd", []);
  await app.engine((timeout) => expect(rowOf(tapped.id)).toHaveClass(/\blive\b/, { timeout }), { ms: 30_000 });
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
