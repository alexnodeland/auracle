// A toast never covers a control or a level's heading, at any size (#517).
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
// level within its seven seconds), with PERFORM's sound moved from home so
// KEEP and BACK are up, at 1440 × 900, 1280 × 720 and 820 × 1180 (a tablet
// held upright, the desk's layout under a finger), and on a phone (390 ×
// 844, 375 × 667, and 844 × 390 on its side):
//
// - A press at the middle of each control of the level's foot and action row
//   named in FOOT (each of which must be on screen) reaches that control.
// - No other control the level shows (every button, slider, tab or field in
//   it, on the rail and in the guide pill) is reached through the toast,
//   and no control's box meets the toast's: the toast stands clear of them,
//   or, where nothing is free (PERFORM at 375 × 667), the guide pill gives
//   way while it stands over it, hidden rather than covered.
// - The toast covers none of the level's heading (HEADS: its title, PERFORM's
//   share button and KEEP/BACK, EVOLVE's pips and line and its small map).
// - On a phone, a swipe up on the banner still puts it away.
// - A change under the receipt (what each generation did, opened from the
//   keyboard where it stands) does not move it while the pointer rests on
//   it (ADR-025); it moves clear once the pointer leaves.
//
// What it does not claim: anything with the keys' drawer up on a phone,
// where PERFORM keeps no band a toast fits and it stands over the foot of
// the knobs (web-runtime.md § Toasts), that a finger held on the banner
// holds it as the pointer does (main.js `laneTouched`), anything of what is drawn on TASTE's
// map or on PATCH's rack, whose sounds and modules reach to every corner (a
// toast on TASTE lets the pointer through: taste_toast.spec.js), or where
// exactly the toast stands (toasts.test.mjs holds `placeLane`'s choices).
const { test, expect, goLevel } = require("./fixtures");

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
    for (const e of view.querySelectorAll(sel)) if (shown(e) && meets(seen(e))) out.push(`the toast covers ${sel}`);
  }
  return out;
};

// How long the receipt is given to settle clear of the level once it is
// there (a frame, after what moved under it): well inside its seven seconds,
// so a failure names what it covers, not that it went.
const SETTLE_MS = 5_000;

/** PERFORM's sound moved from home, so KEEP and BACK are up (a knob turned
 *  up from the keyboard, as perform_layout.spec.js turns one). */
async function moveFromHome(page) {
  await goLevel(page, "perform");
  const knob = page.locator(".pf-deck .pf-knob:not(.search):not(.pending):not(.half-hi)").first();
  await knob.focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowUp");
  await expect(page.locator(".pf-moved")).toHaveClass(/\bon\b/);
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
      await moveFromHome(page);
      for (const level of LEVELS) {
        await receiptAt(page, app, level);
        await expect.poll(() => covered(page, level, true), { message: `what a pick's receipt covers at ${level}`, timeout: SETTLE_MS }).toEqual([]);
      }
    });
  });
}

/** Do two of Playwright's boxes overlap? */
const boxesMeet = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

// ADR-025: a change under the receipt never moves it from under the hand.
// What each generation did, opened from the keyboard under EVOLVE's receipt
// at 1440 × 900, would take the receipt's place: while the pointer rests on
// the receipt it stays where it is, and once the pointer leaves it moves
// clear of the strip.
test("a change under a toast waits while the pointer rests on it, and the toast moves clear once it leaves", async ({ page, app }) => {
  await app.boot();
  await pick(page, app);
  const receipt = page.locator("#toasts .toast:not(.out)", { hasText: /^Picked .+ over .+/ });
  await expect.poll(() => covered(page, "evolve", true), { message: "what a pick's receipt covers at evolve", timeout: SETTLE_MS }).toEqual([]);
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

for (const [width, height] of [[390, 844], [375, 667], [844, 390]]) {
  test.describe(`a phone, ${width} × ${height}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true, isMobile: true });

    test(`on a phone at ${width} × ${height} a pick's receipt covers no control and no heading at any level, and a swipe up puts it away`, async ({ page, app }) => {
      await app.boot();
      await moveFromHome(page);
      for (const level of LEVELS) {
        await receiptAt(page, app, level);
        await expect.poll(() => covered(page, level, false), { message: `what a pick's receipt covers at ${level}`, timeout: SETTLE_MS }).toEqual([]);
      }
      // A swipe up on the toast puts it away (main.js `note`), wherever it
      // stands now: a finger of the browser's own (CDP, as
      // touch_gestures.spec.js makes one), on its words, 40 px up in four
      // moves.
      const receipt = page.locator("#toasts .toast:not(.out)", { hasText: /^Picked .+ over .+/ });
      await expect(receipt).toBeVisible();
      const box = await receipt.locator(".toast-msg").boundingBox();
      const x = Math.round(box.x + box.width / 2);
      const y = Math.round(box.y + box.height / 2);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      const finger = (type, dy) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: dy == null ? [] : [{ x, y: y - dy, id: 1 }] });
      await finger("touchStart", 0);
      for (const dy of [10, 20, 30, 40]) await finger("touchMove", dy);
      await finger("touchEnd");
      await expect(receipt).toHaveCount(0);
    });
  });
}
