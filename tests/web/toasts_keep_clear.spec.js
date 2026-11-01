// A toast keeps clear of every control and every level's heading, at every
// size (#517), but with the keys up on a small phone (below).
// After every pick, the receipt (*Picked … over …*, NOT WHAT I MEANT) stood
// over EVOLVE's foot at 1440 × 900 and 1280 × 720: a press at EVOLVE POOL's
// middle reached the toast, so EVOLVE POOL and *what each generation did*
// could not be pressed until it went. The lane stepped over a list of strips
// written by hand, and EVOLVE's foot was not on it; on PERFORM it stood over
// UNDER THE HOOD and, at 1280 × 720, the rail's bottom stop. On a phone the
// banner stood just under the menu bar, over PERFORM's share button and
// KEEP/BACK, EVOLVE's pips and its small TASTE map, and each level's
// heading.
//
// What this claims, at each level (EVOLVE, PERFORM, PATCH, TASTE, LEARNING),
// while a pick's receipt is on screen (picked in EVOLVE, then carried to the
// level within its seven seconds), with PERFORM's sound (Glass Pad, opened
// from the presets: `moveFromHome` says why not the sound boot deals) moved
// from home so KEEP and BACK are up, at 1440 × 900, 1280 × 720 and 820 ×
// 1180 (a tablet held upright, the desk's layout under a finger), and on a
// phone (390 × 844, 375 × 667, and 844 × 390 on its side):
//
// - A press at the middle of each control of the level's foot and action row
//   named in FOOT (each of which must be on screen) reaches that control.
// - No other control the level shows (every button, slider, tab or field in
//   it, on the rail and in the guide pill) is reached through the toast,
//   and no control's box meets the toast's: the toast stands clear of them,
//   or, where nothing is free (PERFORM at 375 × 667), the guide pill gives
//   way while it stands over it, unseen rather than covered: its × out of
//   reach, its step still a status a screen reader hears.
// - The toast covers none of the level's heading (HEADS: its title, PERFORM's
//   share button and KEEP/BACK, EVOLVE's pips and line and its small map),
//   each of which must be in the level (a phone hides EVOLVE's title).
// - On a phone held upright at PATCH, with the patch wider than the well,
//   the toast stands clear of the edges (*n ›*, and *‹ n* once a tap on
//   *n ›* brings it up under the toast), which are controls like any other,
//   and on PATCH's first visit the guide pill does not give way to it.
// - On a phone, a swipe up on the banner puts it away: the swipe itself
//   (`.swiped`, which nothing but a swipe adds), not its window running out.
// - A change under the receipt (what each generation did, opened from the
//   keyboard where it stands) does not move it while the pointer rests on
//   it (ADR-025); it moves clear once the pointer leaves.
// - On a phone, the XY pad coming up under the receipt (from the keyboard)
//   moves it clear, after a tap on its words too: a finger that has lifted
//   holds nothing (a tap left `:hover` on the banner, which held it there).
//   Played as a phone is, by finger: a click would leave the mouse's place
//   behind, and the browser moves `:hover` off the banner from there when
//   the page changes, so the hold would not show.
//
// What it does not claim: anything with the keys' drawer up on a phone,
// where PERFORM keeps no band a toast fits and it stands over the foot of
// the knobs (web-runtime.md § Toasts), that a finger held on the banner
// holds it as the pointer does (main.js `laneTouched`), anything of what is drawn on TASTE's
// map or on PATCH's rack, whose sounds and modules reach to every corner (a
// toast on TASTE lets the pointer through: taste_toast.spec.js), or where
// exactly the toast stands (toasts.test.mjs holds `placeLane`'s choices).
const { test, expect, goLevel, landed } = require("./fixtures");

const LEVELS = ["evolve", "perform", "patch", "taste", "learning"];

// Each level's foot and action row: what the issue named, each of which must
// be on screen for the check to count.
const FOOT = {
  evolve: ["#play-a", "#choose-a", "#play-b", "#choose-b", "#skip-duel", "#evolve-btn", "#lineage-btn"],
  perform: [".pf-pads button", ".pf-pads .pf-wander", ".pf-share", ".pf-moved .pf-keep", ".pf-moved .pf-back"],
  patch: ["#pt-fit", "#pt-zoom-out", "#pt-zoom-in", "#rack-map-btn", "#rack-layout"],
  taste: ["#taste-tog", "#taste-tplay", "#taste-track"],
  learning: ["#md-copy", "#md-math-btn"],
};
// …and what sits beside the foot where the level is one screen (a desk, a
// tablet): UNDER THE HOOD's rows (the rail's stops, at the stage's right
// edge, are among every control). On a phone the hood is a pane of its own.
const DESK_FOOT = { perform: [".pf-hood-row"] };
const HEADS = {
  evolve: [".ev-title", "#teach-pips", "#teach-copy", "#ev-map"],
  perform: [".pf-title", ".pf-share", ".pf-moved"],
  patch: ["#rack-subject"],
  taste: ["#view-taste .lv-title"],
  learning: ["#view-learning .lv-title"],
};

/** What the pick's receipt covers at the level shown: each named control
 *  missing or whose middle a press would not reach, each other control
 *  whose middle a press would find the toast at or whose box meets the
 *  toast's, and each part of the heading it overlaps. A control is judged
 *  by the part of it its scrolling panes show (UNDER THE HOOD scrolls: a
 *  row scrolled out of its view is not on screen). Empty when it covers
 *  nothing; `["no receipt"]` with none up. */
const UNDER_THE_TOAST = ({ foot, heads }) => {
  const toast = [...document.querySelectorAll("#toasts .toast")].find((t) => !t.classList.contains("out") && /^Picked .+ over .+/.test(t.textContent));
  if (!toast) return ["no receipt"];
  const t = toast.getBoundingClientRect();
  const meets = (r) => r.left < t.right - 0.5 && r.right > t.left + 0.5 && r.top < t.bottom - 0.5 && r.bottom > t.top + 0.5;
  // The part of `e` on screen: its box cut by every pane around it that
  // clips (a scroller), or null when none of it shows.
  const seen = (e) => {
    const b = e.getBoundingClientRect();
    let r = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const c = p.getBoundingClientRect();
      r = { left: Math.max(r.left, c.left), top: Math.max(r.top, c.top), right: Math.min(r.right, c.right), bottom: Math.min(r.bottom, c.bottom) };
    }
    return r.right - r.left > 1 && r.bottom - r.top > 1 ? r : null;
  };
  const shown = (e) => !!seen(e) && !e.closest(".hidden, [hidden]") && getComputedStyle(e).visibility !== "hidden";
  const name = (e) => `${e.id ? "#" + e.id : "." + [...e.classList].join(".")} "${(e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 28)}"`;
  const at = (e) => {
    const r = seen(e);
    return document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
  };
  const view = document.querySelector("section.view.on");
  const out = [];
  for (const sel of foot) {
    const els = [...view.querySelectorAll(sel)].filter(shown);
    if (!els.length) out.push(`${sel} is not on screen`);
    for (const e of els) {
      const hit = at(e);
      if (!hit || !(hit === e || e.contains(hit))) out.push(`a press at the middle of ${name(e)} reaches ${hit ? name(hit) : "nothing"}`);
    }
  }
  // Every control at the level, on the rail and in the guide pill, but those
  // drawn on the map or the rack.
  const controls = [...view.querySelectorAll("button, input:not([type=hidden]), select, textarea, [role=slider], [role=tab], [tabindex='0']"),
    ...document.querySelectorAll("#rail button, #guide button")]
    .filter((e) => shown(e) && !e.closest("#taste-crt, #rack-svg") && e.id !== "taste-crt");
  for (const e of controls) {
    const hit = at(e);
    if (hit && hit.closest("#toasts")) out.push(`a press at the middle of ${name(e)} reaches the toast`);
    else if (meets(seen(e))) out.push(`the toast meets ${name(e)}`);
  }
  for (const sel of heads) {
    const els = [...view.querySelectorAll(sel)];
    if (!els.length) out.push(`${sel} is not in the level`);
    for (const e of els) if (shown(e) && meets(seen(e))) out.push(`the toast covers ${sel}`);
  }
  return out;
};

// How long the receipt is given to settle clear of the level once it is
// there (a frame, after what moved under it): well inside its seven seconds,
// so a failure names what it covers, not that it went.
const SETTLE_MS = 5_000;

/** PERFORM's sound moved from home, so KEEP and BACK are up: Glass Pad in
 *  hand on its shipped wiring, and a control of it turned from the keyboard
 *  the way it opens there. Pointer moves are taps with `touch` (no mouse
 *  left anywhere), clicks without.
 *
 *  Not the sound boot deals: nothing promises it a control that turns up
 *  (#574). At 375 × 667 seed 39 deals one no control reaches (0 of 6), and
 *  seeds 7, 22, 27 and 40 ones whose controls turn down only, so the knob
 *  this waited for never came, for the whole of the test's time.
 *
 *  Opened at PATCH, through the bank's sheet where a phone has one (as
 *  phone_fits.spec.js `presetByTouch` opens it), Glass Pad plays at once on
 *  the wiring shipped with the app (perform-wirings.json: Bright turns both
 *  ways), the same on every seed, and is measured again in the background
 *  ("re-checking"). That measurement is held from main until the sound has
 *  moved. Landed between the knob being chosen here and the first press (the
 *  presses are a hand, which a wiring waits out), it could close the half
 *  they push toward, or make the control a search one, and nothing would
 *  move. Landed after, it cannot take the move away: the controls are wired
 *  around the sound where the hand left it and home stays home (perform.js
 *  `applyWired`), and a control whose half it closed stops at the centre,
 *  the sound still moved (web-runtime.md § PERFORM on the main thread).
 *  Waiting for it instead cost about 10 s a test here, behind the pool's
 *  fill (perform_instant.spec.js's test that waits for one takes 23 to 88 s
 *  on CI). */
async function moveFromHome(page, app, { touch = false } = {}) {
  const press = (target) => (touch ? target.tap() : target.click());
  const level = (name) => (touch ? tapLevel(page, name) : goLevel(page, name));
  await level("patch");
  const sheet = page.locator("#bank-btn");
  if (await sheet.isVisible()) await press(sheet);
  await press(page.locator("#bank-tab-presets"));
  await app.hold("perform_wired");
  await press(page.locator(".bank-item", { hasText: "Glass Pad" }).first().locator(".bi-name"));
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText("Glass Pad", { timeout }), { ms: 60_000 });
  await expect(page.locator("body")).not.toHaveClass(/\bbank-open\b/);
  await level("perform");
  await app.engine((timeout) => expect(page.locator(".pf-name")).toHaveText("Glass Pad", { timeout }), { ms: 30_000 });
  // Wired from the file at once, none waiting: a file that came too late to
  // be read would leave the controls listening for the measurement held.
  await app.reached({ wired: true, ms: 30_000 });
  const knob = page.locator(".pf-deck .pf-knob:not(.search):not(.pending)").first();
  const key = /\bhalf-hi\b/.test(await knob.getAttribute("class")) ? "ArrowDown" : "ArrowUp";
  await knob.focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press(key);
  await expect(page.locator(".pf-moved")).toHaveClass(/\bon\b/);
  await app.release();
}

/** Pick A in EVOLVE once its pair is up, and wait for the receipt on screen. */
async function pick(page, app) {
  await goLevel(page, "evolve");
  const choose = page.locator("#choose-a");
  await app.engine((timeout) => expect(choose).toBeEnabled({ timeout }), { ms: 30_000 });
  await choose.click();
  await expect(page.locator("#toasts .toast:not(.out)", { hasText: /^Picked .+ over .+/ })).toBeVisible();
}

/** A pick's receipt on screen at `level`: picked in EVOLVE, and carried
 *  there within its window. */
async function receiptAt(page, app, level) {
  await pick(page, app);
  if (level !== "evolve") await goLevel(page, level);
}

/** What the receipt covers at `level` (UNDER_THE_TOAST), the foot a desk's
 *  or a phone's. */
const covered = (page, level, desk) =>
  page.evaluate(UNDER_THE_TOAST, { foot: [...FOOT[level], ...(desk ? DESK_FOOT[level] || [] : [])], heads: HEADS[level] });

for (const { width, height, touch } of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 820, height: 1180, touch: true }]) {
  test.describe(`a desk, ${width} × ${height}`, () => {
    test.use({ viewport: { width, height }, hasTouch: !!touch });

    test(`a pick's receipt covers no control and no heading at any level at ${width} × ${height}`, async ({ page, app }) => {
      await app.boot();
      await moveFromHome(page, app);
      for (const level of LEVELS) {
        await receiptAt(page, app, level);
        await expect.poll(() => covered(page, level, true), { message: `what a pick's receipt covers at ${level}`, timeout: SETTLE_MS }).toEqual([]);
      }
    });
  });
}

/** Do two of Playwright's boxes overlap? */
const boxesMeet = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** The pick's receipt on screen, and the wait until it is at rest: its
 *  entry (`toast-in`, 8 px down into place over `--d-state`) played out, so
 *  its box is where the lane put it. */
async function atRest(page) {
  const receipt = page.locator("#toasts .toast:not(.out)", { hasText: /^Picked .+ over .+/ });
  await expect(receipt).toBeVisible();
  await expect.poll(() => receipt.evaluate((el) => el.getAnimations().length), "the receipt's entry played out").toBe(0);
  return receipt;
}

// ADR-025: a change under the receipt never moves it from under the hand.
// What each generation did, opened from the keyboard under EVOLVE's receipt
// at 1440 × 900, would take the receipt's place: while the pointer rests on
// the receipt it stays where it is, and once the pointer leaves it moves
// clear of the strip.
test("a change under a toast waits while the pointer rests on it, and the toast moves clear once it leaves", async ({ page, app }) => {
  await app.boot();
  await pick(page, app);
  await expect.poll(() => covered(page, "evolve", true), { message: "what a pick's receipt covers at evolve", timeout: SETTLE_MS }).toEqual([]);
  const receipt = await atRest(page);
  await receipt.locator(".toast-msg").hover();
  const held = await receipt.boundingBox();
  await page.locator("#lineage-btn").focus();
  await page.keyboard.press("Enter");
  const strip = page.locator("#lineage-pop");
  await expect(strip).toBeVisible();
  const box = await strip.boundingBox();
  expect(boxesMeet(held, box), "the strip opens where the receipt stands").toBe(true);
  await app.quiet();
  expect(await receipt.boundingBox(), "the receipt under the pointer has not moved").toEqual(held);
  await page.mouse.move(box.x + 4, box.y + box.height - 4);
  await expect.poll(async () => boxesMeet(await receipt.boundingBox(), await strip.boundingBox()), "the receipt over the strip once the pointer has left it").toBe(false);
});

/** The guide pill standing aside for the toast (PERFORM at 375 × 667,
 *  where nothing else is free): its × out of reach, and its step still a
 *  status in the accessibility tree, heard as each step comes up
 *  (accessibility.md). Hidden whole, it left the tree. */
async function pillAside(page) {
  const pill = page.locator("#guide");
  await expect(pill).toHaveClass(/\bunder-toast\b/);
  await expect(pill.getByRole("status"), "the pill's step, to a screen reader").toHaveCount(1);
  await expect(pill.getByRole("button", { name: "Stop showing these" }), "the pill's ×").toHaveCount(0);
}

for (const [width, height, crowded] of [[390, 844], [375, 667, true], [844, 390]]) {
  test.describe(`a phone, ${width} × ${height}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true, isMobile: true });
    // What else holds at a level, at this size: the pill standing aside on
    // a crowded PERFORM.
    const alsoAt = Object.fromEntries(LEVELS.map((l) => [l, crowded && l === "perform" ? pillAside : async () => {}]));

    test(`on a phone at ${width} × ${height} a pick's receipt covers no control and no heading at any level, and a swipe up puts it away`, async ({ page, app }) => {
      await app.boot();
      await moveFromHome(page, app);
      for (const level of LEVELS) {
        await receiptAt(page, app, level);
        await expect.poll(() => covered(page, level, false), { message: `what a pick's receipt covers at ${level}`, timeout: SETTLE_MS }).toEqual([]);
        await alsoAt[level](page);
      }
      // A swipe up on the toast puts it away (main.js `note`), wherever it
      // stands now: a finger of the browser's own (CDP, as
      // touch_gestures.spec.js makes one), on its words, 40 px up in four
      // moves. The element itself is held, since a toast whose window ran
      // out also leaves the lane: a swipe marks it `.swiped` and takes it
      // off at once (within two seconds here, well inside what is left of
      // its window), and nothing else marks it so.
      const receipt = await atRest(page);
      const swiped = await receipt.elementHandle();
      const box = await receipt.locator(".toast-msg").boundingBox();
      const x = Math.round(box.x + box.width / 2);
      const y = Math.round(box.y + box.height / 2);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      const finger = (type, dy) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: dy == null ? [] : [{ x, y: y - dy, id: 1 }] });
      await finger("touchStart", 0);
      for (const dy of [10, 20, 30, 40]) await finger("touchMove", dy);
      await finger("touchEnd");
      await expect.poll(() => swiped.evaluate((el) => ({ swiped: el.classList.contains("swiped"), onScreen: el.isConnected })), { message: "the receipt, swiped up", timeout: 2_000 }).toEqual({ swiped: true, onScreen: false });
    });
  });
}

// PATCH's edges (#519) are controls a finger needs, and they run down the
// well's sides: while the patch is wider than the well, *n ›* (and once the
// camera is inside the patch, *‹ n*) stands from 48 px below the well's top
// to 48 px above its foot. A banner across the screen met the right one at
// every height it could stand at, so with nowhere free the lane kept clear
// of the strips alone and stood over *n ›* (at 375 × 667, 438 to 484 px
// down, across the edge's 318 to 362). It now stands narrowed between the
// edges (toasts.js `bannerColumn`), and moves when an edge comes up under
// it: *‹ n*, brought up by a tap on *n ›*.
test.describe("a phone, 375 × 667, PATCH's edges", () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

  test("on a phone a toast over the rack stands between PATCH's edges, and moves clear of one that comes up under it", async ({ page, app }) => {
    await app.boot();
    await receiptAt(page, app, "patch");
    await expect(page.locator("#pt-edge-r"), "n ›: the patch is wider than the well at its fit").toBeVisible();
    await expect(page.locator("#pt-edge-l")).toBeHidden();
    await expect.poll(() => covered(page, "patch", false), { message: "what a pick's receipt covers at patch, n › up", timeout: SETTLE_MS }).toEqual([]);
    await page.locator("#pt-edge-r").tap();
    await expect(page.locator("#pt-edge-l"), "‹ n: a module past the well's left edge too").toBeVisible();
    await expect.poll(() => covered(page, "patch", false), { message: "what a pick's receipt covers at patch, both edges up", timeout: SETTLE_MS }).toEqual([]);
  });

  // On PATCH's first visit its steps are up in the guide pill, under the
  // well. The banner across the screen found no band over the rack, and
  // stood over the pill, which gave way (unseen, its × out of reach) though
  // the rack beside *n ›* had room: the column is tried before the pill
  // gives way.
  test("on a phone, on PATCH's first visit, a toast over the rack stands beside n › and leaves the guide pill in sight", async ({ page, app }) => {
    await app.boot({ seen: false });
    await receiptAt(page, app, "patch");
    await expect(page.locator("#pt-edge-r"), "n ›: the patch is wider than the well at its fit").toBeVisible();
    await expect(page.locator("#guide"), "PATCH's first steps").toBeVisible();
    await expect.poll(() => covered(page, "patch", false), { message: "what a pick's receipt covers at patch, the guide pill up", timeout: SETTLE_MS }).toEqual([]);
    // Read once, with the receipt still up: a retried assertion would pass
    // once the receipt's window ran out and the pill came back.
    const at = await page.evaluate(() => ({
      receipt: [...document.querySelectorAll("#toasts .toast:not(.out)")].some((t) => /^Picked .+ over .+/.test(t.textContent)),
      pillAside: document.getElementById("guide").classList.contains("under-toast"),
    }));
    expect(at, "the guide pill in sight beside the receipt").toEqual({ receipt: true, pillAside: false });
  });
});

/** Go to a level by a tap on its stop, as a finger does. */
async function tapLevel(page, level) {
  const stop = page.locator(`.rail-stop[data-level="${level}"]`);
  await stop.tap();
  await expect(stop).toHaveAttribute("aria-current", "location");
  await landed(page);
}

// A finger that has lifted holds nothing (ADR-025 holds the lane under a
// resting pointer or a finger on the banner). A tap on the banner's words
// left `:hover` on it, and the lane read that as a hand on it: the XY pad
// coming up under the banner then left it there, over the pad (it stood
// there 1.5 s later in three runs of three), until something else moved it.
// Everything is tapped, as on a phone, but the knob and the XY pad, turned
// and opened from the keyboard, which moves no pointer.
test.describe("a phone, 390 × 844, the XY pad", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("on a phone a toast moves clear of the XY pad coming up under it, after a tap on its words too", async ({ page, app }) => {
    await app.boot();
    await moveFromHome(page, app, { touch: true });
    await tapLevel(page, "evolve");
    const choose = page.locator("#choose-a");
    await app.engine((timeout) => expect(choose).toBeEnabled({ timeout }), { ms: 30_000 });
    await choose.tap();
    await tapLevel(page, "perform");
    await expect.poll(() => covered(page, "perform", false), { message: "what a pick's receipt covers at perform", timeout: SETTLE_MS }).toEqual([]);
    const receipt = await atRest(page);
    await receipt.locator(".toast-msg").tap();
    await page.locator(".pf-xy-btn").focus();
    await page.keyboard.press("Enter");
    const pad = page.locator("#pf-xy");
    await expect(pad).toBeVisible();
    await expect.poll(async () => boxesMeet(await receipt.boundingBox(), await pad.boundingBox()), { message: "the receipt over the XY pad", timeout: SETTLE_MS }).toBe(false);
    await expect.poll(() => covered(page, "perform", false), { message: "what a pick's receipt covers at perform with the XY pad up", timeout: SETTLE_MS }).toEqual([]);
  });
});
