// A phone's levels are app views (#134): each fits its screen, what it is
// for is on that screen, everything pressed is a finger's size, and no label
// is stood one word to a line.
//
// What this claims, on a phone held upright (360 × 640; 390 × 664, an
// iPhone 13 in Safari with its bars; 390 × 844; 430 × 932) and on its side
// (844 × 390), with touch, with the keys' drawer closed and open:
//
// - At every level the page scrolls neither way, the level does not run
//   past its screen, and nothing in it scrolls (an element that scrolls and
//   has more than it shows): the screen stands still, as an app's does. A
//   list scrolls, as a phone's own do, and is the one exception, named in
//   LISTS (the bank's, the catalog's, the rows under the hood, what
//   LEARNING weighs). A list is as long as what it lists, so its box counts
//   as filled for the band below (UNDER THE HOOD lists up to ten knobs, by
//   the sound: a short list ends where its rows do, and the pane keeps its
//   size, or the tabs above it would move when a measurement lands).
// - What the level is for is on the screen without a scroll, above the bar
//   along the bottom: PERFORM's controls (every one of them clear of a toast;
//   the first in sight), EVOLVE's PLAY and PICK for
//   both sounds, PATCH's ⚡ and ADD, TASTE's map, LEARNING's map.
// - Every button, field and tab a finger can reach there (not covered by
//   anything, on the screen) is at least 44 × 44 px; the same with the bank's
//   sheet and the keys' drawer open. What is drawn on the rack at its zoom
//   is not counted (its sockets, and the ▶ on the face at OUT): a tapped
//   module opens its sheet, whose settings are (patch_touch.spec.js), and
//   the sound in hand plays from the menu bar's ▶.
// - No label with two or more words is set one word to a line, and a label
//   or a line of status (three to twelve words) is on one line or on two of
//   a length (the shorter at least 60% of the longer), never a word or two
//   left alone; each stop's name in the bar along the bottom is whole, and
//   the menu bar holds what it shows.
// - The keys' drawer's controls (the octave, the volume, REC, KEYS ⋯) are
//   one row over the keybed at each size; the menu bar's controls share one
//   centre line (±1 px) on a phone, none overlaps another, its two sides' margins
//   match and each square button's glyph is in its middle (±1 px); and no level leaves a
//   band over 48 px tall with nothing in it (the guide pill counts), and
//   no text in a level is cut with an ellipsis.
//
// - The same of PERFORM's other pane, under the hood, every value whole,
//   judged on Glass Pad as soon as its rows are drawn (it has rows on
//   every seed, from its shipped wiring at once, where the session's own
//   sound may reach no knob and an empty hood checks no row); of the well
//   in XY; and of LEARNING's other two panes (what it weighs, its
//   forecasts).
// - PATCH at 390 × 844: the face at OUT's ▶ (brought into the well past its
//   right edge, where the patch's fit leaves it, #519) answers a finger 21 px
//   from its middle each way, and goes while sockets are lit. A tap on bare panel
//   beside a lit socket (12 to 18 px, every other lit one over 1.6 times as
//   far: reach.js, whose unit tests hold the rule, the ambiguous point and
//   the drop's shorter reach) places the module in hand there, opening no
//   module's sheet, and a tap elsewhere straight after is that control's; a
//   finger held there opens no module's menu; and a cable being placed
//   (the whole patch zoomed into view with −) reaches a lit socket the same
//   way, past the rack's pan.
// - A touch tablet (768 × 1024, 1024 × 768): UNDER THE HOOD's rows, on
//   Glass Pad, are 44 px, each on the screen or in the hood's own scroll,
//   and the hood shows its heading and at least two of them.
// - Nothing in a level is out of reach: every control in it is on the
//   screen, or inside something that scrolls to it.
// - On a smaller phone (568 × 320, 667 × 375 on their sides) and on a
//   390 × 844 phone zoomed to 125% for larger text (which lays the page out
//   in 312 × 675 CSS pixels: the type tokens are pixels), a level that cannot fit
//   scrolls instead of cutting: nothing scrolls sideways, nothing is out of
//   reach, and what a finger reaches is still its size.
//
// - A toast covers none of a level's primary controls (it stands in the
//   level's free band: toasts_keep_clear.spec.js holds it to every control
//   and heading).
//
// What it does not claim: that a toast covers no other control for the
// seconds it is up (toasts_keep_clear.spec.js holds that, with a pick's
// receipt at each level), or that the guide pill never does (a covered
// control is skipped, as a finger could not press it either), anything of
// the hood pane for a sound whose controls turn no knob (it has no rows
// then), or anything at a tablet's size
// (shell_phone.spec.js and perform_layout.spec.js hold those).
const { test, expect, goLevel, landed } = require("./fixtures");
const { rackAtRest } = require("./patch_page");

const PHONE = { hasTouch: true, isMobile: true };
// The lists a finger scrolls (a phone's own lists do): nothing else may.
const LISTS = ["#bank-list", ".nb-body", "#nb-groups", ".pf-hood", ".md-weighs", "#cmdk-list"];
const LEVELS = ["perform", "patch", "evolve", "taste", "learning"];
// With the keys up, what a level keeps for the hands (PERFORM's controls,
// EVOLVE's PLAY and PICK, the rack, the maps); what is for looking at gives
// way until they go down.
const PRIMARY_KEYS = {
  perform: [".pf-knob"],
  evolve: ["#play-a", "#choose-a", "#play-b", "#choose-b"],
  patch: ["#rack-evolve"],
  taste: ["#taste-crt"],
  learning: [".md-mapp"],
};
const PRIMARY = {
  perform: [".pf-knob"],
  evolve: ["#play-a", "#choose-a", "#play-b", "#choose-b"],
  patch: ["#rack-evolve", "#pt-add"],
  taste: ["#taste-crt"],
  learning: [".md-mapp"],
};

/** What on the screen a finger cannot use: a page or a level that scrolls,
 *  a primary control out of sight, a target under 44 px, a label one word
 *  to a line. Empty when nothing. */
const MISFITS = ({ primary, fits = true, lists = [] }) => {
  const out = [];
  const doc = document.documentElement;
  if (fits && doc.scrollHeight > innerHeight + 1) out.push(`the page scrolls: ${doc.scrollHeight} in ${innerHeight}`);
  if (doc.scrollWidth > innerWidth + 1) out.push(`the page scrolls sideways: ${doc.scrollWidth} in ${innerWidth}`);
  const view = document.querySelector("section.view.on");
  if (fits && view.scrollHeight > view.clientHeight + 1) out.push(`${view.id} scrolls: ${view.scrollHeight} in ${view.clientHeight}`);
  // Nothing on the screen scrolls but a list.
  if (fits) {
    for (const e of document.querySelectorAll("body *")) {
      if (!e.getClientRects().length || lists.some((l) => e.matches(l))) continue;
      const cs = getComputedStyle(e);
      if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1) out.push(`${e.id ? "#" + e.id : "." + [...e.classList].join(".")} scrolls: ${e.scrollHeight} in ${e.clientHeight}`);
    }
  }
  // The bar along the bottom, when the levels are one (upright).
  const rail = document.getElementById("rail").getBoundingClientRect();
  const floor = rail.width > innerWidth / 2 ? rail.top : innerHeight;
  // Out of reach: a control in the level off the screen (or under the bar)
  // with nothing between it and the level that scrolls to it.
  const scrolls = (e) => {
    for (let a = e.parentElement; a && a !== view.parentElement; a = a.parentElement) {
      const oy = getComputedStyle(a).overflowY;
      if ((oy === "auto" || oy === "scroll") && a.scrollHeight > a.clientHeight + 1) return true;
    }
    return false;
  };
  for (const e of view.querySelectorAll("button, [role=tab], input:not([type=hidden]), select")) {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height || e.closest("svg, .hidden, [hidden], #rack-play")) continue;
    const inSight = r.top >= 0 && r.bottom <= floor + 1 && r.left >= 0 && r.right <= innerWidth + 1;
    if (!inSight && !scrolls(e)) out.push(`${e.id ? "#" + e.id : "." + [...e.classList].join(".")} is out of reach at ${Math.round(r.top)}–${Math.round(r.bottom)}`);
  }
  // A toast stands over none of these.
  const toasts = [...document.querySelectorAll("#toasts .toast")].map((t) => t.getBoundingClientRect()).filter((t) => t.width);
  for (const sel of primary) {
    for (const p of view.querySelectorAll(sel)) {
      const r = p.getBoundingClientRect();
      if (toasts.some((t) => t.bottom > r.top && t.top < r.bottom && t.right > r.left && t.left < r.right)) out.push(`a toast covers ${sel}`);
    }
  }
  for (const sel of primary) {
    const e = view.querySelector(sel);
    const r = e && e.getBoundingClientRect();
    if (!r || !r.height) out.push(`${sel} is not shown`);
    else if (r.top < 0 || r.bottom > floor + 1) out.push(`${sel} is out of sight: ${Math.round(r.top)}–${Math.round(r.bottom)} above ${Math.round(floor)}`);
  }
  const name = (e) => `${e.id ? "#" + e.id : e.className && e.className.baseVal === undefined ? "." + [...e.classList].join(".") : e.tagName} "${(e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30)}"`;
  // Reachable: on the screen, and what a finger there would touch.
  const reachable = (e) => {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
    const y = r.top + r.height / 2;
    if (y < 0 || y >= innerHeight) return false;
    const t = document.elementFromPoint(x, y);
    return !!t && (t === e || e.contains(t));
  };
  for (const e of document.querySelectorAll("button, [role=button], [role=tab], input:not([type=hidden]), select, summary")) {
    if (e.closest("svg, #piano, #rack-play") || e.matches(".nextstep.inert") || !reachable(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 43.5 || r.height < 43.5) out.push(`${name(e)} is ${Math.round(r.width)} × ${Math.round(r.height)}`);
  }
  for (const e of document.querySelectorAll("body *")) {
    if (e.closest("svg, #piano") || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (!reachable(e)) continue;
    const words = e.textContent.trim().split(/\s+/).length;
    if (words < 2) continue;
    const range = document.createRange();
    range.selectNodeContents(e);
    // Each line's width: a line is the rects that share a bottom.
    const widths = new Map();
    for (const r of range.getClientRects()) if (r.width > 1) widths.set(Math.round(r.bottom / 4), (widths.get(Math.round(r.bottom / 4)) || 0) + r.width);
    const lines = widths.size;
    if (lines >= words) out.push(`${name(e)} is ${words} words on ${lines} lines`);
    // A label or a line of status (up to twelve words; a paragraph is
    // prose): on one line, or two of a length.
    else if (words >= 3 && words <= 6 && lines > 2) out.push(`${name(e)} is ${words} words on ${lines} lines`);
    else if (words >= 3 && words <= 12 && lines === 2) {
      const [a, b] = [...widths.values()];
      if (Math.min(a, b) < 0.6 * Math.max(a, b) && Math.min(a, b) < e.clientWidth * 0.5) out.push(`${name(e)} is two lines of ${Math.round(a)} and ${Math.round(b)} px`);
    }
  }
  // No visible text in the level is cut with an ellipsis: by a pixel is cut
  // (a hood value 56 px in its 55 read "1.78 k…").
  for (const e of view.querySelectorAll("*")) {
    if (!reachable(e) || getComputedStyle(e).textOverflow !== "ellipsis") continue;
    if (e.scrollWidth > e.clientWidth) out.push(`${name(e)} is cut: ${e.scrollWidth} in ${e.clientWidth}`);
  }
  // Each stop's name in the bar along the bottom is whole.
  for (const rl of document.querySelectorAll("#rail .rl")) {
    if (rl.offsetParent && rl.scrollWidth > rl.clientWidth + 1) out.push(`"${rl.textContent}" is cut: ${rl.scrollWidth} in ${rl.clientWidth}`);
  }
  const bar = document.querySelector(".menubar");
  if (bar.scrollWidth > bar.clientWidth + 1) out.push(`the menu bar holds ${bar.scrollWidth} in ${bar.clientWidth}`);
  // The menu bar's controls share one centre line (±1 px) and none
  // overlaps another.
  const phone = matchMedia("(max-width: 700px) and (min-height: 501px), (max-height: 500px) and (max-width: 999px)").matches;
  const ctls = (phone ? ["#bank-btn", ".inhand", "#taught", "#model-btn", "#cmdk-btn"] : [])
    .map((q) => [q, document.querySelector(q)?.getBoundingClientRect()]).filter(([, r]) => r && r.width);
  const mids = ctls.map(([q, r]) => [q, r.top + r.height / 2]);
  for (const [q, m] of mids) if (Math.abs(m - mids[0][1]) > 1) out.push(`the menu bar's ${q} is centred ${Math.round(m - mids[0][1])} px off ${mids[0][0]}'s line`);
  for (let i = 1; i < ctls.length; i++) {
    const [qa, a] = ctls[i - 1];
    const [qb, b] = ctls[i];
    if (a.right > b.left + 0.5) out.push(`the menu bar's ${qa} overlaps ${qb} by ${Math.round(a.right - b.left)} px`);
  }
  // …the bar's two sides the same margin (±1 px), and each square button's
  // glyph in its box's middle (±1 px).
  const br = bar.getBoundingClientRect();
  const first = ctls[0] && ctls[0][1];
  const last = ctls.length && ctls[ctls.length - 1][1];
  if (first && last && Math.abs((first.left - br.left) - (br.right - last.right)) > 1) out.push(`the menu bar's margins are ${Math.round(first.left - br.left)} and ${Math.round(br.right - last.right)} px`);
  for (const q of phone ? ["#bank-btn", "#cmdk-btn", "#model-btn"] : []) {
    const b = document.querySelector(q);
    const g = b && b.querySelector("svg, .led");
    if (!g || !g.getClientRects().length) continue;
    const r = b.getBoundingClientRect();
    const gr = g.getBoundingClientRect();
    const dx = gr.left + gr.width / 2 - (r.left + r.width / 2);
    const dy = gr.top + gr.height / 2 - (r.top + r.height / 2);
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) out.push(`${q}'s glyph is ${Math.round(dx)}, ${Math.round(dy)} px off its middle`);
  }
  // No dead band: down the level, no stretch over 48 px holds nothing (a
  // leaf, anything drawn with a ground or a border, or a list's own box),
  // the guide pill counting as something. A list is as long as what it
  // lists: below a short one's last row is its length, not the layout's.
  if (fits) {
    const vr = view.getBoundingClientRect();
    const spans = [];
    for (const e of [...view.querySelectorAll("*"), ...document.querySelectorAll("#guide, #guide *")]) {
      if (!e || !e.getClientRects().length || e.closest(".hidden, [hidden]")) continue;
      const cs = getComputedStyle(e);
      if (cs.visibility === "hidden" || cs.display === "contents") continue;
      const drawn = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none" || parseFloat(cs.borderTopWidth) > 0;
      if (e.children.length && !drawn && !lists.some((l) => e.matches(l))) continue;
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom <= vr.top || r.top >= vr.bottom) continue;
      spans.push([Math.max(r.top, vr.top), Math.min(r.bottom, vr.bottom)]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    let reach = vr.top;
    for (const [t, b] of spans) {
      if (t - reach > 48) out.push(`${view.id} leaves ${Math.round(t - reach)} px empty at ${Math.round(reach)}`);
      reach = Math.max(reach, b);
    }
    if (vr.bottom - reach > 48) out.push(`${view.id} leaves ${Math.round(vr.bottom - reach)} px empty at its foot`);
  }
  return out;
};

/** Each level fits, its primary controls in sight: `MISFITS` empty. */
async function eachLevelFits(page, keys) {
  for (const level of LEVELS) {
    await goLevel(page, level);
    await landed(page);
    await expect.poll(() => page.evaluate(MISFITS, { primary: keys ? PRIMARY_KEYS[level] : PRIMARY[level], lists: LISTS }), `what does not fit at ${level}${keys ? " with the keys up" : ""}`).toEqual([]);
  }
}

for (const [width, height] of [[360, 640], [390, 664], [390, 844], [430, 932], [844, 390]]) {
  test.describe(`a phone, ${width} × ${height}`, () => {
    test.use({ ...PHONE, viewport: { width, height } });

    test(`each level is one screen at ${width} × ${height} that nothing scrolls, keys up or down, its primary controls in sight and a finger's size`, async ({ page, app }) => {
      await app.boot();
      // The boot's toast (the pool still filling) is up over PERFORM, the
      // level the app opens at, when the first check runs.
      await expect(page.locator("#toasts .toast").first()).toBeVisible();
      await eachLevelFits(page, false);
      // PERFORM's XY pad.
      await goLevel(page, "perform");
      await landed(page);
      await page.locator(".pf-xy-btn").tap();
      await expect(page.locator(".pf-xy")).toBeVisible();
      await expect.poll(() => page.evaluate(MISFITS, { primary: [], lists: LISTS }), "what does not fit in XY").toEqual([]);
      await page.locator(".pf-xy-btn").tap();
      // LEARNING's other panes.
      await goLevel(page, "learning");
      await landed(page);
      for (const pane of ["weighs", "forecasts"]) {
        await page.locator(`#view-learning .lv-panes [data-pane="${pane}"]`).tap();
        await expect.poll(() => page.evaluate(MISFITS, { primary: [], lists: LISTS }), `what does not fit at LEARNING's ${pane}`).toEqual([]);
      }
      await page.locator('#view-learning .lv-panes [data-pane="map"]').tap();
      // The keys up: every level again.
      await page.locator("#keys-toggle").tap();
      await expect(page.locator("#keybar")).toBeVisible();
      await eachLevelFits(page, true);
      // The keys down, and PERFORM's other pane, last. UNDER THE HOOD lists
      // the knobs the sound's controls turn, so the session's own sound,
      // which may reach none, can leave it with no rows to judge, or two or
      // three on a guess (#504, #505, #506, when a short list's end was
      // taken for a dead band). Glass Pad's are drawn at once, from its
      // shipped wiring, and judged then: its measurement may land while
      // they are, and the hood fills its pane whichever wiring its rows
      // are from (LISTS), each value a knob's own.
      await page.locator("#keys-toggle").tap();
      await expect(page.locator("#keybar")).toBeHidden();
      await glassPadOnPerform(page, app);
      await page.locator('.lv-panes [data-pane="hood"]').tap();
      await expect(page.locator(".pf-hood-row").first()).toBeVisible();
      await expect.poll(() => page.evaluate(MISFITS, { primary: [], lists: LISTS }), "what does not fit under the hood").toEqual([]);
    });

    test(`the bank's sheet and the keys' drawer are a finger's size at ${width} × ${height}`, async ({ page, app }) => {
      await app.boot();
      await goLevel(page, "patch");
      await landed(page);
      await page.locator("#bank-btn").tap();
      await expect(page.locator("body")).toHaveClass(/\bbank-open\b/);
      await expect.poll(() => page.evaluate(MISFITS, { primary: [], lists: LISTS }), "what does not fit with the bank up").toEqual([]);
      // Put away as a finger does: a tap on the scrim beside the sheet.
      await page.locator(".sheet-scrim").tap({ position: { x: 8, y: 8 } });
      await expect(page.locator("body")).not.toHaveClass(/\bbank-open\b/);
      await page.locator("#keys-toggle").tap();
      await expect(page.locator("#keybar")).toBeVisible();
      await expect.poll(() => page.evaluate(MISFITS, { primary: [], lists: LISTS }), "what does not fit with the keys up").toEqual([]);
      // The drawer's controls are one row: each one's middle on one line.
      const row = await page.evaluate(() => {
        return ["oct-down", "oct-label", "oct-up", "vol", "rec-btn", "keys-btn"].map((id) => {
          const r = document.getElementById(id).getBoundingClientRect();
          return { id, mid: Math.round(r.top + r.height / 2) };
        });
      });
      // (On its side the keybed is in that row too.) A second row would be a
      // control's height, 44 px, below the first.
      expect(row.filter((c) => Math.abs(c.mid - row[0].mid) > 20).map((c) => c.id), `the drawer's controls off the octave's row: ${JSON.stringify(row)}`).toEqual([]);
    });
  });
}

/** What is lost at a level that cannot fit, once there: nothing out of
 *  reach, and what a finger reaches its size (a scroll is allowed). */
async function lostAt(page, level) {
  await goLevel(page, level);
  await landed(page);
  return () => page.evaluate(MISFITS, { primary: [], fits: false });
}

for (const [width, height] of [[568, 320], [667, 375]]) {
  test.describe(`a smaller phone on its side, ${width} × ${height}`, () => {
    test.use({ ...PHONE, viewport: { width, height } });

    test(`a level that cannot fit ${width} × ${height} scrolls, and nothing in it is out of reach`, async ({ page, app }) => {
      await app.boot();
      for (const level of LEVELS) await expect.poll(await lostAt(page, level), `what is lost at ${level}`).toEqual([]);
    });
  });
}

test.describe("a phone with larger text, 390 × 844 at 125% (312 × 675)", () => {
  test.use({ ...PHONE, viewport: { width: 312, height: 675 } });

  test("with the text at 125% a level scrolls, and nothing in it is out of reach", async ({ page, app }) => {
    await app.boot();
    for (const level of LEVELS) await expect.poll(await lostAt(page, level), `what is lost at ${level}`).toEqual([]);
  });
});

/** A point of bare panel 12 to 20 px from a lit socket's middle (one of
 *  `which`), every other lit socket over 1.6 times as far: a point the
 *  finger unambiguously means that socket from (reach.js). */
const besideALitSocket = (page, which) => page.evaluate((which) => {
  const lit = [...document.querySelectorAll("#rack-svg .jack.legal")].map((j) => {
    const r = j.querySelector(".j-nut").getBoundingClientRect();
    return { j, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  for (const s of lit.filter((l) => l.j.matches(which))) {
    for (let a = 0; a < 2 * Math.PI; a += Math.PI / 8) {
      for (const d of [12, 15, 18]) {
        const x = s.x + d * Math.cos(a);
        const y = s.y + d * Math.sin(a);
        const t = document.elementFromPoint(x, y);
        if (!t || !t.closest("#rack-svg") || t.closest("[data-addr], .jack, .mod-menu-btn, .mod-lock, .rack-guess, .ain-ctl")) continue;
        if (lit.every((o) => o === s || Math.hypot(o.x - x, o.y - y) > 1.6 * d)) return { x, y };
      }
    }
  }
  return null;
}, which);

/** The preset `name` opened in PATCH as a finger does it, the bank put away.
 *  Where the bank is a sheet (a phone, a tablet upright) `openPreset`
 *  reaches the presets through the rail, under the sheet's scrim, so BANK
 *  opens it first; beside the stage (a tablet on its side) it is there. */
async function presetByTouch(page, app, name) {
  await goLevel(page, "patch");
  await landed(page);
  const sheet = await page.locator("#bank-btn").isVisible();
  if (sheet) await page.locator("#bank-btn").tap();
  await page.locator("#bank-tab-presets").tap();
  await page.locator(".bank-item", { hasText: name }).first().locator(".bi-name").tap();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText(name, { timeout }), { ms: 60_000 });
  await expect(page.locator("body")).not.toHaveClass(/\bbank-open\b/);
}

/** PERFORM on Glass Pad, opened by touch: a sound with rows under the hood
 *  on every seed, drawn at once from its shipped wiring while the session
 *  measures it again ("re-checking"), which is not waited for. */
async function glassPadOnPerform(page, app) {
  await presetByTouch(page, app, "Glass Pad");
  await goLevel(page, "perform");
  await landed(page);
  await app.engine((timeout) => expect(page.locator(".pf-name")).toHaveText("Glass Pad", { timeout }), { ms: 30_000 });
}

/** PATCH on a phone with Glass Pad open, its bank put away. */
async function patchOnAPhone(page, app) {
  await app.boot();
  await presetByTouch(page, app, "Glass Pad");
  await app.engine((timeout) => rackAtRest(page, { timeout }), { ms: 30_000 });
}

/** A module from the catalog in hand: the catalog folds, the sockets light. */
async function moduleInHand(page) {
  await page.locator("#pt-add").tap();
  await page.locator('#nb-groups .nb-item[data-kind="distortion"]').tap();
  await expect(page.locator("#rack-svg .jack.legal[data-childkey]").first()).toBeVisible();
}

const HELD_MS = 700; // a finger held past the rack's 500 ms long press

test.describe("PATCH under a finger, 390 × 844", () => {
  test.use({ ...PHONE, viewport: { width: 390, height: 844 } });

  test("the face at OUT answers a finger 44 px across, and a tap beside a lit socket places the module in hand there", async ({ page, app }) => {
    await patchOnAPhone(page, app);
    // The fit shows where the patch starts: the well's right edge carries the
    // camera to OUT, a module a press.
    const edge = page.locator("#pt-edge-r");
    await expect.poll(async () => {
      if (await edge.isVisible()) await edge.tap();
      return edge.isVisible();
    }, { timeout: 30_000, intervals: [600] }).toBe(false);
    await app.engine((timeout) => rackAtRest(page, { timeout }), { ms: 30_000 });
    // The ▶ at OUT: 21 px from its middle each way is still its.
    const ring = await page.locator("#rack-play").evaluate((b) => {
      const r = b.getBoundingClientRect();
      const [cx, cy] = [r.left + r.width / 2, r.top + r.height / 2];
      return [[cx - 21, cy], [cx + 21, cy], [cx, cy - 21], [cx, cy + 21]]
        .filter(([x, y]) => !document.elementFromPoint(x, y)?.closest("#rack-play"))
        .map(([x, y]) => `${Math.round(x)},${Math.round(y)}`);
    });
    expect(ring, "points 21 px from the ▶'s middle that are not its").toEqual([]);
    await moduleInHand(page);
    // With sockets lit the ring is gone: it never stands over one.
    await expect.poll(() => page.locator("#rack-play").evaluate((b) => getComputedStyle(b, "::before").display)).toBe("none");
    const before = await page.locator('#rack-svg g.mod-group[data-kind="distortion"]').count();
    const at = await besideALitSocket(page, "[data-childkey]");
    expect(at, "a point of bare panel beside a lit socket").not.toBeNull();
    await page.touchscreen.tap(at.x, at.y);
    await app.engine((timeout) => expect(page.locator('#rack-svg g.mod-group[data-kind="distortion"]')).toHaveCount(before + 1, { timeout }), { ms: 30_000 });
    await expect(page.locator("#module-sheet.on")).toHaveCount(0);
    // A tap elsewhere straight after is that control's: HOW TO READ THIS opens.
    await page.locator("#pt-how").tap();
    await expect(page.locator("#pt-how")).toHaveAttribute("aria-expanded", "true");
  });

  test("a finger held beside a lit socket places the module there and opens no module's menu", async ({ page, app, browserName }) => {
    // eslint-disable-next-line playwright/no-skipped-test -- a browser that cannot make the gesture, not a test turned off
    test.skip(browserName !== "chromium", "a held finger is the browser's own touch (CDP, Chromium)");
    await patchOnAPhone(page, app);
    await moduleInHand(page);
    const before = await page.locator('#rack-svg g.mod-group[data-kind="distortion"]').count();
    const at = await besideALitSocket(page, "[data-childkey]");
    expect(at).not.toBeNull();
    const cdp = await page.context().newCDPSession(page);
    const point = [{ x: at.x, y: at.y }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point });
    // eslint-disable-next-line playwright/no-wait-for-timeout -- the gesture: a finger held past the long press
    await page.waitForTimeout(HELD_MS);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await app.engine((timeout) => expect(page.locator('#rack-svg g.mod-group[data-kind="distortion"]')).toHaveCount(before + 1, { timeout }), { ms: 30_000 });
    await expect(page.locator(".ctx-menu:not(.hidden)")).toHaveCount(0);
  });

  test("a cable being placed reaches a lit socket from a tap beside it, past the rack's pan", async ({ page, app }) => {
    await patchOnAPhone(page, app);
    // The whole patch in view, so the sockets the cable can reach are: the
    // fit stops where the names read and leaves the rest past the right
    // edge (#519); − zooms out to it.
    await expect.poll(async () => {
      if (await page.locator("#pt-edge-r").isVisible()) await page.locator("#pt-zoom-out").tap();
      return page.locator("#pt-edge-r").isVisible();
    }, { timeout: 30_000, intervals: [600] }).toBe(false);
    await app.engine((timeout) => rackAtRest(page, { timeout }), { ms: 30_000 });
    // Tap an output with somewhere to go (the first in the chain): the cable
    // is picked up, and the sockets it fits light.
    const out = await page.evaluate(() => {
      const outs = [...document.querySelectorAll("#rack-svg .jack[data-outkey]:not(.modjack)")].map((j) => {
        const r = j.querySelector(".j-nut").getBoundingClientRect();
        return { j, x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }).filter((o) => o.j.contains(document.elementFromPoint(o.x, o.y))).sort((a, b) => a.x - b.x);
      return outs.length ? { x: outs[0].x, y: outs[0].y } : null;
    });
    expect(out, "an output on the screen").not.toBeNull();
    await page.touchscreen.tap(out.x, out.y);
    await expect(page.locator("#rack-svg")).toHaveClass(/\bwiring\b/);
    const at = await besideALitSocket(page, "*");
    expect(at, "a point of bare panel beside a lit socket").not.toBeNull();
    await page.touchscreen.tap(at.x, at.y);
    // The socket took it: the cable is no longer being placed.
    await expect(page.locator("#rack-svg")).not.toHaveClass(/\bwiring\b/);
  });
});

for (const [width, height] of [[768, 1024], [1024, 768]]) {
  test.describe(`a touch tablet, ${width} × ${height}`, () => {
    test.use({ hasTouch: true, viewport: { width, height } });

    test(`UNDER THE HOOD's rows are a finger's size at ${width} × ${height}, every one in reach`, async ({ page, app }) => {
      await app.boot();
      // On a sound with rows: the session's own may reach no knob, and then
      // the hood has none. What is held here (each row's height and reach,
      // the hood's own) is the same whichever wiring Glass Pad's rows are
      // from.
      await glassPadOnPerform(page, app);
      await expect(page.locator(".pf-hood-row").first()).toBeVisible();
      await expect.poll(() => page.evaluate(MISFITS, { primary: [], fits: false })).toEqual([]);
      const rows = await page.locator(".pf-hood-row").evaluateAll((rs) => rs.map((r) => Math.round(r.getBoundingClientRect().height)));
      expect(rows.filter((h) => h < 44), "rows under 44 px").toEqual([]);
      // The hood shows its heading and at least two rows, never squeezed to
      // one by the column (1024 × 768's short-screen floor once did).
      const hood = await page.locator(".pf-hood").evaluate((h) => ({ shown: h.clientHeight, head: h.querySelector(".pf-hood-h")?.getBoundingClientRect().height || 0 }));
      expect(hood.shown, "the hood's height in sight").toBeGreaterThanOrEqual(hood.head + 2 * 44);
    });
  });
}
