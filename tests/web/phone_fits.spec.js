// A phone's levels are app views (#134): each fits its screen, what it is
// for is on that screen, everything pressed is a finger's size, and no label
// is stood one word to a line.
//
// What this claims, on a phone held upright (360 × 640, 390 × 844) and on
// its side (844 × 390), with touch:
//
// - At every level the page scrolls neither way and the level itself does
//   not scroll: where there is more than fits it scrolls inside its own
//   panel (PERFORM's controls, LEARNING's room, the bank's list).
// - What the level is for is on the screen without a scroll, above the bar
//   along the bottom: PERFORM's first control, EVOLVE's PLAY and PICK for
//   both sounds, PATCH's ⚡ and ADD, TASTE's map, LEARNING's map.
// - Every button, field and tab a finger can reach there (not covered by
//   anything, on the screen) is at least 44 × 44 px; the same with the bank's
//   sheet and the keys' drawer open. What is drawn on the rack at its zoom
//   is not counted (its sockets, and the ▶ on the face at OUT): a tapped
//   module opens its sheet, whose settings are (patch_touch.spec.js), and
//   the sound in hand plays from the menu bar's ▶.
// - No label with two or more words is set one word to a line.
//
// What it does not claim: that a toast or the guide pill never covers a
// control for the seconds it is up (a covered control is skipped, as a
// finger could not press it either), or anything at a tablet's size
// (shell_phone.spec.js and perform_layout.spec.js hold those).
const { test, expect, goLevel, landed } = require("./fixtures");

const PHONE = { hasTouch: true, isMobile: true };
const LEVELS = ["perform", "patch", "evolve", "taste", "learning"];
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
const MISFITS = ({ primary }) => {
  const out = [];
  const doc = document.documentElement;
  if (doc.scrollHeight > innerHeight + 1) out.push(`the page scrolls: ${doc.scrollHeight} in ${innerHeight}`);
  if (doc.scrollWidth > innerWidth + 1) out.push(`the page scrolls sideways: ${doc.scrollWidth} in ${innerWidth}`);
  const view = document.querySelector("section.view.on");
  if (view.scrollHeight > view.clientHeight + 1) out.push(`${view.id} scrolls: ${view.scrollHeight} in ${view.clientHeight}`);
  // The bar along the bottom, when the levels are one (upright).
  const rail = document.getElementById("rail").getBoundingClientRect();
  const floor = rail.width > innerWidth / 2 ? rail.top : innerHeight;
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
    const lines = new Set([...range.getClientRects()].filter((r) => r.width > 1).map((r) => Math.round(r.bottom / 4))).size;
    if (lines >= words) out.push(`${name(e)} is ${words} words on ${lines} lines`);
  }
  return out;
};

for (const [width, height] of [[360, 640], [390, 844], [844, 390]]) {
  test.describe(`a phone, ${width} × ${height}`, () => {
    test.use({ ...PHONE, viewport: { width, height } });

    test(`each level is one screen at ${width} × ${height}, its primary controls in sight and a finger's size`, async ({ page, app }) => {
      await app.boot();
      for (const level of LEVELS) {
        await goLevel(page, level);
        await landed(page);
        await expect.poll(() => page.evaluate(MISFITS, { primary: PRIMARY[level] }), `what does not fit at ${level}`).toEqual([]);
      }
    });

    test(`the bank's sheet and the keys' drawer are a finger's size at ${width} × ${height}`, async ({ page, app }) => {
      await app.boot();
      await goLevel(page, "patch");
      await landed(page);
      await page.locator("#bank-btn").tap();
      await expect(page.locator("body")).toHaveClass(/\bbank-open\b/);
      await expect.poll(() => page.evaluate(MISFITS, { primary: [] }), "what does not fit with the bank up").toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.locator("body")).not.toHaveClass(/\bbank-open\b/);
      await page.locator("#keys-toggle").tap();
      await expect(page.locator("#keybar")).toBeVisible();
      await expect.poll(() => page.evaluate(MISFITS, { primary: [] }), "what does not fit with the keys up").toEqual([]);
    });
  });
}
