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
//
// - The same of PERFORM's controls' column scrolled to its end (the hood,
//   WANDER and the pads), and with the well in XY.
// - PATCH at 390 × 844: the face at OUT's ▶ answers a finger 21 px from its
//   middle each way, and goes while sockets are lit. A tap on bare panel
//   beside a lit socket (12 to 18 px, every other lit one over 1.6 times as
//   far: reach.js, whose unit tests hold the rule, the ambiguous point and
//   the drop's shorter reach) places the module in hand there, opening no
//   module's sheet, and a tap elsewhere straight after is that control's; a
//   finger held there opens no module's menu; and a cable being placed
//   reaches a lit socket the same way, past the rack's pan.
// - A touch tablet (768 × 1024, 1024 × 768): UNDER THE HOOD's rows are
//   44 px, each on the screen or in the hood's own scroll, and the hood
//   shows its heading and at least two of them.
// - Nothing in a level is out of reach: every control in it is on the
//   screen, or inside something that scrolls to it.
// - On a smaller phone (568 × 320, 667 × 375 on their sides) and on a
//   390 × 844 phone zoomed to 125% for larger text (which lays the page out
//   in 312 × 675 CSS pixels: the type tokens are pixels), a level that cannot fit
//   scrolls instead of cutting: nothing scrolls sideways, nothing is out of
//   reach, and what a finger reaches is still its size.
//
// - A toast stands at the top of the screen, under the menu bar, and covers
//   none of a level's primary controls.
//
// What it does not claim: that a toast never covers some other control
// for the seconds it is up, or that the guide pill never does (a covered
// control is skipped, as a finger could not press it either), or anything at a tablet's size
// (shell_phone.spec.js and perform_layout.spec.js hold those).
const { test, expect, goLevel, landed } = require("./fixtures");
const { rackAtRest } = require("./patch_page");

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
const MISFITS = ({ primary, fits = true }) => {
  const out = [];
  const doc = document.documentElement;
  if (fits && doc.scrollHeight > innerHeight + 1) out.push(`the page scrolls: ${doc.scrollHeight} in ${innerHeight}`);
  if (doc.scrollWidth > innerWidth + 1) out.push(`the page scrolls sideways: ${doc.scrollWidth} in ${innerWidth}`);
  const view = document.querySelector("section.view.on");
  if (fits && view.scrollHeight > view.clientHeight + 1) out.push(`${view.id} scrolls: ${view.scrollHeight} in ${view.clientHeight}`);
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
  // A toast stands at the top, under the menu bar, over none of these.
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
  // Each stop's name in the bar along the bottom is whole.
  for (const rl of document.querySelectorAll("#rail .rl")) {
    if (rl.offsetParent && rl.scrollWidth > rl.clientWidth + 1) out.push(`"${rl.textContent}" is cut: ${rl.scrollWidth} in ${rl.clientWidth}`);
  }
  const bar = document.querySelector(".menubar");
  if (bar.scrollWidth > bar.clientWidth + 1) out.push(`the menu bar holds ${bar.scrollWidth} in ${bar.clientWidth}`);
  return out;
};

for (const [width, height] of [[360, 640], [390, 844], [844, 390]]) {
  test.describe(`a phone, ${width} × ${height}`, () => {
    test.use({ ...PHONE, viewport: { width, height } });

    test(`each level is one screen at ${width} × ${height}, its primary controls in sight and a finger's size`, async ({ page, app }) => {
      await app.boot();
      // The boot's toast (the pool still filling) is up over PERFORM, the
      // level the app opens at, when the first check runs.
      await expect(page.locator("#toasts .toast").first()).toBeVisible();
      for (const level of LEVELS) {
        await goLevel(page, level);
        await landed(page);
        await expect.poll(() => page.evaluate(MISFITS, { primary: PRIMARY[level] }), `what does not fit at ${level}`).toEqual([]);
      }
      await goLevel(page, "perform");
      await landed(page);
      await page.locator(".pf-right").evaluate((col) => { col.scrollTop = col.scrollHeight; });
      await expect.poll(() => page.evaluate(MISFITS, { primary: [".pf-pads"] }), "what does not fit at the controls' end").toEqual([]);
      // XY: each control's line says what the pad turns ("turns toward
      // bloom only"), on one line or two of a length.
      await page.locator(".pf-right").evaluate((col) => { col.scrollTop = 0; });
      await page.locator(".pf-xy-btn").tap();
      await expect(page.locator(".pf-xy")).toBeVisible();
      await expect.poll(() => page.evaluate(MISFITS, { primary: [] }), "what does not fit in XY").toEqual([]);
    });

    test(`the bank's sheet and the keys' drawer are a finger's size at ${width} × ${height}`, async ({ page, app }) => {
      await app.boot();
      await goLevel(page, "patch");
      await landed(page);
      await page.locator("#bank-btn").tap();
      await expect(page.locator("body")).toHaveClass(/\bbank-open\b/);
      await expect.poll(() => page.evaluate(MISFITS, { primary: [] }), "what does not fit with the bank up").toEqual([]);
      // Put away as a finger does: a tap on the scrim beside the sheet.
      await page.locator(".sheet-scrim").tap({ position: { x: 8, y: 8 } });
      await expect(page.locator("body")).not.toHaveClass(/\bbank-open\b/);
      await page.locator("#keys-toggle").tap();
      await expect(page.locator("#keybar")).toBeVisible();
      await expect.poll(() => page.evaluate(MISFITS, { primary: [] }), "what does not fit with the keys up").toEqual([]);
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

/** PATCH on a phone with Glass Pad open, its bank put away. */
async function patchOnAPhone(page, app) {
  await app.boot();
  // The bank is a sheet here, and `openPreset` reaches the presets through
  // the rail, under the sheet's scrim: the preset is opened as a finger does.
  await goLevel(page, "patch");
  await landed(page);
  await page.locator("#bank-btn").tap();
  await page.locator("#bank-tab-presets").tap();
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().locator(".bi-name").tap();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText("Glass Pad", { timeout }), { ms: 60_000 });
  await expect(page.locator("body")).not.toHaveClass(/\bbank-open\b/);
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

  test("a finger held beside a lit socket places the module there and opens no module's menu", async ({ page, app }) => {
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
      await goLevel(page, "perform");
      await landed(page);
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
