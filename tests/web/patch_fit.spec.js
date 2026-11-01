// PATCH's fit is readable and a finger's size on every screen (#519), and the
// head and the structure menu stay out of the way (#530).
//
// The seeded boot's sound is Bright Stab: seven modules, six modulators and
// the amp, too wide to hold whole at a size you can read in a phone's well or
// a 1440 px screen's. Before #519 the fit held it whatever that cost: 0.16× on
// a phone held upright (its names 2.6 px, its sockets 3 px across, the face at
// OUT 16 × 26 px) and 0.47× at 1440 (names 7.9 px).
//
// What this claims:
//
// - On a phone (390 × 844, touch) the fit prints every module's name at the
//   type floor (`--t-label`, 11 px) or larger, draws no text on the rack
//   smaller than the rack's own smallest type (`--t-rack-micro`, 9 px), and
//   shows where the patch starts (its first module whole, and n › at the
//   well's right edge for the modules past it); every socket, knob and name
//   in the well answers at its middle, never a ⋯'s or a lock's pad; a
//   finger's tap beside an out ○ (not on it) picks its cable up, opening no
//   module's sheet, and every socket it lights answers at its middle; one
//   beside a ⋯ opens its menu, and one beside a lock locks it; the face at OUT is 44 px or more once the
//   edge has carried the camera to it; and FIT frames the patch as it opened
//   again.
// - At 1440 × 900 the same patch fits with every name at 11 px or larger and
//   no rack text under 9 px, the rest past the right edge, and FIT after a
//   zoom comes back to that fit.
// - At 1440 the structure menu of a module low in the well and near its
//   right edge (HOLD) opens where it fits, never over the well's foot (the
//   camera, the readout, TEACH) and never past the well's sides (over the
//   levels' rail), by its ⋯ and by F2. A module's whole menu (ten verbs),
//   taller than the well at 1440, at 1280 × 800 and on the phone, stays
//   inside it too, cut to its height: End (or, on the phone, a scroll)
//   brings its last row, delete, in.
// - At 1280 × 800, where the patch is too big to fit, the keys carry the
//   camera along it (End, ←), and an edit made there (that module deleted
//   from its menu) leaves the camera where they put it; another sound too
//   big to fit, opened from there, opens where it starts.
// - The head's full depth budget (6/6) is amber at rest, as the tight one is,
//   never red; an edit refused at that ceiling (a second filter in series)
//   is said with the depth it would have made (7), turns that count red, and
//   no other, as the refusal is said (read as it is drawn), and it is amber
//   again after; an edit refused for the size instead turns the size's count
//   red, shown though it is far from its ceiling, and leaves the depth amber.
const { test, expect, goLevel, bankTab } = require("./fixtures");
const { rackAtRest, settled, walkRightEdge } = require("./patch_page");

const TYPE_FLOOR = 11; // --t-label
const RACK_FLOOR = 9; // --t-rack-micro

/** PATCH with the boot's sound on its fit, at rest. */
async function patchAtFit(app) {
  await app.boot();
  await goLevel(app.page, "patch");
  await expect(app.page.locator("#rack-svg g.mod-group").first()).toBeVisible();
  await app.engine((timeout) => rackAtRest(app.page, { timeout }), { ms: 30_000 });
}

/** The rack's text as drawn now: each visible name's size in CSS px, and
 *  every other visible text on the well's screen smaller than `under` px.
 *  ⋯'s and the lock's glyphs are not text to read: a glyph on a control is
 *  sized to its control (accessibility.md § Type size), and theirs to the
 *  pocket on the plate's edge. */
const rackType = (page, under) => page.evaluate((floor) => {
  const svg = document.getElementById("rack-svg");
  const a = svg.getScreenCTM().a;
  const fr = document.getElementById("rack-scroll").getBoundingClientRect();
  const shown = (t) => {
    const cs = getComputedStyle(t);
    if (cs.visibility === "hidden" || cs.display === "none" || !(t.textContent || "").trim()) return false;
    const r = t.getBoundingClientRect();
    return r.width > 0 && r.right > fr.left && r.left < fr.right && r.bottom > fr.top && r.top < fr.bottom;
  };
  const px = (t) => parseFloat(getComputedStyle(t).fontSize) * a;
  return {
    names: [...svg.querySelectorAll(".rack-plates .mod-title")].filter(shown).map((t) => [t.textContent, Math.round(px(t) * 10) / 10]),
    small: [...svg.querySelectorAll("text")].filter((t) => !t.closest(".mod-menu-btn, .mod-lock")).filter(shown).filter((t) => px(t) < floor - 0.05)
      .map((t) => `${t.getAttribute("class") || t.parentNode.getAttribute("class")} "${t.textContent}" ${px(t).toFixed(1)} px`),
  };
}, under);

const viewBox = (page) => page.evaluate(() => document.getElementById("rack-svg").getAttribute("viewBox").split(/\s+/).map(Number));
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1);

/** Where the structure menu is now: open, clear of the well's foot (the
 *  camera, the readout, TEACH) and below its top, inside its sides; and, cut
 *  to the well, whether its list scrolls and End brings its last row in. */
const menuPlace = (page) => page.evaluate(() => {
  const menu = document.getElementById("ctx-menu");
  const m = menu.getBoundingClientRect();
  const foot = document.getElementById("pt-foot").getBoundingClientRect();
  const frame = document.getElementById("rack-frame").getBoundingClientRect();
  return {
    open: m.height > 0,
    clear: m.bottom <= foot.top + 0.5 && m.top >= frame.top - 0.5,
    inside: m.left >= frame.left - 0.5 && m.right <= frame.right + 0.5,
    rows: menu.querySelectorAll(".cm-item").length,
    cut: menu.scrollHeight > menu.clientHeight + 1,
  };
});
/** The last row of the open menu, all of it within the menu's box. */
const lastRowShown = (page) => page.evaluate(() => {
  const menu = document.getElementById("ctx-menu");
  const items = menu.querySelectorAll(".cm-item");
  const r = items[items.length - 1].getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  return { label: items[items.length - 1].firstChild.textContent.trim(), shown: r.top >= m.top - 0.5 && r.bottom <= m.bottom + 0.5 };
});
/** The key of the leftmost module of the signal path (not a modulator, not
 *  the amp) whose plate is whole in the well: its menu has every verb. */
const ordinaryModule = (page) => page.evaluate(() => {
  const f = document.getElementById("rack-scroll").getBoundingClientRect();
  const gs = [...document.querySelectorAll("#rack-svg .rack-plates g[data-key]")].filter((g) => {
    const p = g.querySelector(".mod-plate");
    if (!p || p.classList.contains("modside") || g.getAttribute("data-kind") === "amp") return false;
    const r = p.getBoundingClientRect();
    return r.left >= f.left && r.right <= f.right && r.top >= f.top && r.bottom <= f.bottom;
  });
  gs.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  return gs[0]?.getAttribute("data-key") ?? null;
});
/** The rack's own targets in the well (every socket, knob and module name)
 *  whose middle is under a ⋯'s or a lock's pad rather than itself. */
const underPads = (page) => page.evaluate(() => {
  const f = document.getElementById("rack-scroll").getBoundingClientRect();
  const svg = document.getElementById("rack-svg");
  const under = [];
  let checked = 0;
  for (const c of svg.querySelectorAll(".jack .j-nut, [data-addr], .rack-plates .mod-title")) {
    const r = c.getBoundingClientRect();
    if (!r.width || getComputedStyle(c).visibility === "hidden") continue;
    const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
    if (x < f.left || x > f.right || y < f.top || y > f.bottom) continue;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !hit.closest("#rack-svg")) continue; // under the well's own chrome (an edge, the foot)
    checked += 1;
    const pad = hit.closest(".mod-menu-btn, .mod-lock");
    if (pad) under.push(`${c.getAttribute("class")} of ${c.closest("[data-key]")?.getAttribute("data-key")} under ${pad.getAttribute("class")} of ${pad.closest("[data-key]")?.getAttribute("data-key")}`);
  }
  return { checked, under };
});
/** A point of bare panel 14 to 18 px from the middle of one of the rack's
 *  reach targets (`sel`: an out ○'s nut, or ⋯'s or a lock's pad) that
 *  plainly means it, as reach.js reads a finger: every other socket, ⋯ and
 *  lock more than 1.6 times as far. With its module's key and name. */
const beside = (page, sel) => page.evaluate((sel) => {
  const f = document.getElementById("rack-scroll").getBoundingClientRect();
  const svg = document.getElementById("rack-svg");
  const mid = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const all = [...svg.querySelectorAll(".jack .j-nut, .mod-menu-btn > rect, .mod-lock > rect")].map((el) => ({ el, ...mid(el) }));
  for (const s of all.filter((o) => o.el.matches(sel))) {
    for (let a = 0; a < 2 * Math.PI; a += Math.PI / 8) {
      for (const d of [14, 18]) {
        const x = s.x + d * Math.cos(a);
        const y = s.y + d * Math.sin(a);
        if (x < f.left + 4 || x > f.right - 4 || y < f.top + 4 || y > f.bottom - 4) continue;
        const t = document.elementFromPoint(x, y);
        if (!t || !t.closest("#rack-svg") || t.closest("[data-addr], .jack, .mod-menu-btn, .mod-lock, .rack-guess, .ain-ctl, .mod-title")) continue;
        if (all.every((o) => o === s || Math.hypot(o.x - x, o.y - y) > 1.6 * d)) {
          const key = s.el.closest("[data-key]").getAttribute("data-key");
          const title = svg.querySelector(`.rack-plates g[data-key="${key}"] .mod-title`)?.textContent ?? "";
          return { x, y, key, title };
        }
      }
    }
  }
  return null;
}, sel);
/** A finger's tap at (x, y), and what it answered with: whether `sel`
 *  matched once the lift's own task was done (`inTask`), and how long after
 *  the lift it first did (`ms`), both on the page's clock, read as the page
 *  changes (an observer over the document) rather than by a poll. */
async function tapTimed(page, x, y, sel) {
  await page.evaluate((sel) => {
    const T = (window.__tapTimed = { at: null, lift: null, inTask: null });
    const look = () => {
      if (T.at == null && document.querySelector(sel)) T.at = performance.now();
      return T.at != null;
    };
    const mo = new MutationObserver(() => { if (look()) mo.disconnect(); });
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    addEventListener("pointerup", (e) => {
      T.lift = e.timeStamp;
      setTimeout(() => { T.inTask = look(); }, 0);
    }, { capture: true, once: true });
  }, sel);
  await page.touchscreen.tap(x, y);
  await expect.poll(() => page.evaluate(() => window.__tapTimed.inTask)).not.toBeNull();
  return page.evaluate(() => ({ inTask: window.__tapTimed.inTask, ms: window.__tapTimed.at - window.__tapTimed.lift }));
}
/** A module's whole menu (ten verbs) from F2 on its plate: inside the well
 *  and clear of its foot, cut to the well where it is taller and scrolled
 *  by End to `delete`. */
async function wholeMenuInTheWell(page) {
  const key = await ordinaryModule(page);
  expect(key, "a module of the signal path, whole in the well").not.toBeNull();
  await page.locator(`#rack-svg .rack-controls g.mod-group[data-key="${key}"]`).focus();
  await page.keyboard.press("F2");
  await expect(page.locator("#ctx-menu")).toBeVisible();
  const at = await menuPlace(page);
  expect(at, `${key}'s menu`).toMatchObject({ open: true, clear: true, inside: true });
  expect(at.rows, `${key}'s menu holds every verb`).toBeGreaterThanOrEqual(9);
  await page.keyboard.press("End");
  await expect(page.locator("#ctx-menu .cm-item").last()).toBeFocused();
  expect(await lastRowShown(page)).toEqual({ label: "delete", shown: true });
  await page.keyboard.press("Escape");
  await expect(page.locator("#ctx-menu")).toBeHidden();
  return at;
}

/** Open the pool's row `id` on PATCH, its rack at rest; its name. */
async function openRow(app, id) {
  const { page } = app;
  const row = page.locator(`#bank-list .bank-item[data-id="${id}"]`).first();
  const name = (await row.locator(".bi-name").textContent()).trim();
  await row.click();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toHaveText(name, { timeout }), { ms: 60_000 });
  await app.engine((timeout) => rackAtRest(page, { timeout }), { ms: 30_000 });
  return name;
}
/** The pool's row of the sound on the bench (`home`), and of another sound
 *  too big to fit (`big`, a module past the well's right edge), opened one
 *  by one until one is; the sound left open is that one. */
async function bigOtherSound(app) {
  const { page } = app;
  const first = (await page.locator("#rack-subject").textContent()).trim();
  await bankTab(page, "pool");
  const ids = await page.locator("#bank-list .bank-item[data-id]").evaluateAll((rs) => rs.map((r) => r.getAttribute("data-id")));
  let home = null;
  for (const id of ids) {
    const name = (await page.locator(`#bank-list .bank-item[data-id="${id}"] .bi-name`).first().textContent()).trim();
    if (name === first) { home = id; continue; }
    await openRow(app, id);
    if (await page.locator("#pt-edge-r").isVisible()) return { big: id, home };
  }
  return { big: null, home };
}

test.describe("a phone, 390 × 844", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("PATCH's fit on a phone prints every module's name at the type floor, its targets a finger's size, and pans to the rest", async ({ page, app }) => {
    await patchAtFit(app);
    const type = await rackType(page, RACK_FLOOR);
    expect(type.names.length, "names on the screen").toBeGreaterThan(0);
    for (const [name, px] of type.names) expect(px, `${name}'s size`).toBeGreaterThanOrEqual(TYPE_FLOOR - 0.05);
    expect(type.small, "rack text under the rack's own floor").toEqual([]);
    // Where it starts: the leftmost module whole in the well, the rest past its right edge.
    const first = await page.evaluate(() => {
      const f = document.getElementById("rack-scroll").getBoundingClientRect();
      const rs = [...document.querySelectorAll("#rack-svg .rack-plates g[data-key] .mod-plate")].map((p) => p.getBoundingClientRect());
      const p = rs.sort((a, b) => a.left - b.left)[0];
      return p.left >= f.left - 1 && p.right <= f.right + 1;
    });
    expect(first, "the patch's first module is in the well").toBe(true);
    await expect(page.locator("#pt-edge-l")).toBeHidden();
    await expect(page.locator("#pt-edge-r")).toBeVisible();
    expect(Number(await page.locator("#pt-edge-r b").textContent())).toBeGreaterThan(0);

    // Every socket, knob and module name in the well is its own at its
    // middle: no ⋯'s or lock's pad lies over it (they once grew with the
    // camera, over a neighbour's sockets and their own module's name).
    const targets = await underPads(page);
    expect(targets.under, "targets under a ⋯ or lock").toEqual([]);
    expect(targets.checked, "targets on the screen").toBeGreaterThan(10);

    // A finger's tap beside an out ○, on the panel and not on the socket,
    // picks its cable up; no module's sheet opens.
    const out = await beside(page, ".jack[data-outkey]:not(.modjack) .j-nut");
    expect(out, "a point of panel beside an out ○").not.toBeNull();
    const pick = await tapTimed(page, out.x, out.y, "#rack-svg.wiring");
    expect(pick.inTask, "the cable picked up in the tap's own task").toBe(true);
    app.budget("a tap beside an out ○ → its cable picked up", pick.ms, 100);
    await expect(page.locator("#rack-svg")).toHaveClass(/\bwiring\b/);
    await expect(page.locator("#module-sheet.on")).toHaveCount(0);
    // Every socket it lights is its own at its middle, for the finger that
    // places it.
    const lit = await page.evaluate(() => [...document.querySelectorAll("#rack-svg .jack.legal")].map((j) => {
      const r = j.querySelector(".j-nut").getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { key: j.getAttribute("data-childkey") || j.getAttribute("data-modkey"), own: !hit?.closest("#rack-svg") || hit.closest(".jack") === j };
    }));
    expect(lit.length, "sockets lit").toBeGreaterThan(0);
    expect(lit.filter((j) => !j.own), "lit sockets under something else").toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.locator("#rack-svg")).not.toHaveClass(/\bwiring\b/);

    // A finger's tap beside a ⋯, on bare panel and plainly meaning it,
    // opens that module's menu, as a tap on it does; no sheet opens.
    const dots = await beside(page, ".mod-menu-btn > rect");
    expect(dots, "a point of panel beside a ⋯").not.toBeNull();
    const menu = await tapTimed(page, dots.x, dots.y, "#ctx-menu:not(.hidden)");
    expect(menu.inTask, "the menu open in the tap's own task").toBe(true);
    app.budget("a tap beside a ⋯ → its menu open", menu.ms, 100);
    await expect(page.locator("#ctx-menu")).toBeVisible();
    await expect(page.locator("#ctx-menu .cm-title-name")).toHaveText(dots.title);
    await expect(page.locator("#module-sheet.on")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator("#ctx-menu")).toBeHidden();
    // …and one beside a lock locks its module.
    const lock = await beside(page, ".mod-lock > rect");
    expect(lock, "a point of panel beside a lock").not.toBeNull();
    const locked = await tapTimed(page, lock.x, lock.y, `#rack-svg g.mod-group[data-key="${lock.key}"] .mod-lock.on`);
    expect(locked.inTask, "the module locked in the tap's own task").toBe(true);
    app.budget("a tap beside a lock → its module locked", locked.ms, 100);
    await expect(page.locator(`#rack-svg g.mod-group[data-key="${lock.key}"] .mod-lock.on`)).toHaveCount(1);
    await expect(page.locator("#module-sheet.on")).toHaveCount(0);

    // The edge carries the camera along, to OUT: the face there is a
    // finger's size. FIT frames the patch as it opened again.
    const fitted = await viewBox(page);
    // Each press brings the nearest module past it to the middle.
    await walkRightEdge(app);
    await expect(page.locator("#pt-edge-r")).toBeHidden();
    await expect.poll(() => page.evaluate(() => {
      const f = document.getElementById("rack-scroll").getBoundingClientRect();
      const p = document.getElementById("rack-play").getBoundingClientRect();
      return p.left >= f.left - 1 && p.right <= f.right + 1 && p.width >= 44 && p.height >= 44;
    }), { message: "the face at OUT, in the well and a finger's size" }).toBe(true);
    await page.locator("#pt-fit").tap();
    await expect.poll(async () => near(await viewBox(page), fitted), { timeout: 5_000 }).toBe(true);
  });

  test("a module's whole structure menu, by a finger on its ⋯, opens inside the well on a phone and scrolls there", async ({ page, app }) => {
    await patchAtFit(app);
    const key = await ordinaryModule(page);
    expect(key, "a module of the signal path, whole in the well").not.toBeNull();
    const dots = await page.locator(`#rack-svg g.mod-group[data-key="${key}"] .mod-menu-btn text`).boundingBox();
    await page.touchscreen.tap(dots.x + dots.width / 2, dots.y + dots.height / 2);
    await expect(page.locator("#ctx-menu")).toBeVisible();
    const at = await menuPlace(page);
    expect(at, `${key}'s menu`).toMatchObject({ open: true, clear: true, inside: true, cut: true });
    expect(at.rows, `${key}'s menu holds every verb`).toBeGreaterThanOrEqual(9);
    // Its list runs on under the fade, to delete.
    await expect(page.locator("#ctx-menu")).toHaveClass(/\bcm-clamped\b/);
    await page.locator("#ctx-menu .cm-item").last().scrollIntoViewIfNeeded();
    expect(await lastRowShown(page)).toEqual({ label: "delete", shown: true });
    await expect(page.locator("#ctx-menu")).not.toHaveClass(/\bcm-clamped\b/);
  });
});

test("PATCH's fit at 1440 prints every module's name at the type floor, and FIT comes back to it", async ({ page, app }) => {
  await patchAtFit(app);
  const type = await rackType(page, RACK_FLOOR);
  expect(type.names.length, "names on the screen").toBeGreaterThan(6);
  for (const [name, px] of type.names) expect(px, `${name}'s size`).toBeGreaterThanOrEqual(TYPE_FLOOR - 0.05);
  expect(type.small, "rack text under the rack's own floor").toEqual([]);
  await expect(page.locator("#pt-edge-r")).toBeVisible();
  const fitted = await viewBox(page);
  await page.locator("#pt-zoom-out").click();
  await expect.poll(async () => near(await viewBox(page), fitted)).toBe(false);
  await page.locator("#pt-fit").click();
  await expect.poll(async () => near(await viewBox(page), fitted), { timeout: 5_000 }).toBe(true);
});

test("the structure menu opens inside the well, clear of its foot, and a module's whole menu scrolls there", async ({ page, app }) => {
  await patchAtFit(app);
  // By its ⋯: select HOLD, low in the well and near its right edge, with a
  // press on its plate, then its ⋯.
  const plate = page.locator('#rack-svg .rack-plates g[data-kind="hold"] .mod-plate').first();
  const b = await plate.boundingBox();
  await page.mouse.click(b.x + 8, b.y + b.height - 6);
  await expect(page.locator('#rack-svg .rack-plates g[data-kind="hold"].selected')).toHaveCount(1);
  const dots = await page.locator('#rack-svg g.mod-group[data-kind="hold"] .mod-menu-btn text').boundingBox();
  await page.mouse.click(dots.x + dots.width / 2, dots.y + dots.height / 2);
  await expect(page.locator("#ctx-menu")).toBeVisible();
  expect(await menuPlace(page)).toMatchObject({ open: true, clear: true, inside: true });
  await page.keyboard.press("Escape");
  await expect(page.locator("#ctx-menu")).toBeHidden();
  // By F2 on the plate.
  await page.locator('#rack-svg .rack-controls g.mod-group[data-kind="hold"]').focus();
  await page.keyboard.press("F2");
  await expect(page.locator("#ctx-menu")).toBeVisible();
  expect(await menuPlace(page)).toMatchObject({ open: true, clear: true, inside: true });
  await page.keyboard.press("Escape");
  await expect(page.locator("#ctx-menu")).toBeHidden();
  // A module of the signal path: ten verbs, taller than the well here.
  expect((await wholeMenuInTheWell(page)).cut, "the whole menu, cut to the well").toBe(true);
});

test.describe("a laptop, 1280 × 800", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("a module's whole structure menu scrolls inside the well on a laptop, clear of its foot", async ({ page, app }) => {
    await patchAtFit(app);
    expect((await wholeMenuInTheWell(page)).cut, "the whole menu, cut to the well").toBe(true);
  });

  test("an edit made from the keys far along a patch too big to fit leaves the camera there, and another sound opens where it starts", async ({ page, app }) => {
    await patchAtFit(app);
    const atRest = () => app.engine((timeout) => rackAtRest(page, { timeout }), { ms: 30_000 });
    const { big, home } = await bigOtherSound(app);
    expect(big, "another sound of the pool too big to fit at 1280").not.toBeNull();
    await openRow(app, home);
    await expect(page.locator("#pt-edge-l")).toBeHidden();

    // The keys carry the camera to the end of the patch, and back one module.
    await page.locator("#rack-svg .rack-controls g.mod-group").first().focus();
    await page.keyboard.press("End");
    await atRest();
    await page.keyboard.press("ArrowLeft");
    await atRest();
    await expect(page.locator("#pt-edge-l")).toBeVisible();
    const aimed = await viewBox(page);
    // That module deleted from its menu: the camera stays where the keys put it.
    await page.keyboard.press("F2");
    await page.locator("#ctx-menu .cm-item", { hasText: /^delete/ }).click();
    await settled(app);
    await atRest();
    const after = await viewBox(page);
    expect(Math.abs(after[0] - aimed[0]), `the camera's x, ${aimed[0].toFixed(0)} before the edit and ${after[0].toFixed(0)} after`).toBeLessThan(1);
    expect(Math.abs(after[2] - aimed[2]), "the camera's zoom").toBeLessThan(1);
    await expect(page.locator("#pt-edge-l")).toBeVisible();

    // Another sound, from there, opens where it starts.
    await openRow(app, big);
    await expect(page.locator("#pt-edge-l")).toBeHidden();
    await expect(page.locator("#pt-edge-r")).toBeVisible();
  });
});

test("a full depth budget is amber at rest, and red only while an edit refused at it is said", async ({ page, app }) => {
  // Every count the head draws in red, as it is drawn: read in the task that
  // drew it, on the app's clock, not by a poll that may come after the
  // refusal has been said and the red has gone (ADR-022).
  await page.addInitScript(() => {
    window.__budgetRed = [];
    document.addEventListener("DOMContentLoaded", () => {
      const el = document.getElementById("budget");
      new MutationObserver(() => {
        const red = [...el.querySelectorAll(".bg-cell.refused")].map((c) => ({ text: c.textContent, color: getComputedStyle(c).color }));
        if (red.length) window.__budgetRed.push(red);
      }).observe(el, { childList: true, subtree: true });
    });
  });
  await patchAtFit(app);
  const ink = (v) => page.evaluate((name) => {
    const s = document.createElement("span");
    s.style.color = `var(${name})`;
    document.body.appendChild(s);
    const c = getComputedStyle(s).color;
    s.remove();
    return c;
  }, v);
  const [amber, red] = [await ink("--phos-b"), await ink("--led-red")];
  const depth = page.locator("#budget .bg-cell", { hasText: /\d+\/\d+ depth/ }).filter({ hasNotText: "mod" });
  await expect(depth).toHaveText("6/6 depth");
  await expect(depth).toHaveClass(/\bfull\b/);
  await expect(depth).toHaveCSS("color", amber);
  await expect(depth.locator("b")).toHaveCSS("color", amber);
  expect(await page.evaluate(() => window.__budgetRed), "red at rest").toEqual([]);
  // A second filter in series after the first one (its ⋯'s duplicate) would
  // make the patch seven deep: refused, and said, with the size and the
  // depth it would have had.
  const first = await page.evaluate(() => {
    const gs = [...document.querySelectorAll('#rack-svg .rack-controls g.mod-group[data-kind="filter"]')];
    gs.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    return gs[0].getAttribute("data-key");
  });
  await page.locator(`#rack-svg .rack-controls g.mod-group[data-key="${first}"]`).focus();
  await page.keyboard.press("F2");
  await page.locator("#ctx-menu .cm-item", { hasText: /^duplicate/ }).click();
  await app.toast(/didn’t happen: the patch would pass its limits \(\d+ modules, depth 7\)/);
  // The depth, and only the depth (the size is nowhere near its ceiling),
  // went red as the refusal was said.
  expect(await page.evaluate(() => window.__budgetRed[0]), "the counts drawn red").toEqual([{ text: "6/6 depth", color: red }]);
  // Amber again once the refusal has been said.
  await expect(depth).not.toHaveClass(/\brefused\b/, { timeout: 15_000 });
  await expect(depth).toHaveCSS("color", amber);
  await expect(page.locator("#budget .bg-cell.refused")).toHaveCount(0);

  // Refused for the size instead, as the engine refuses an edit to a patch
  // of 24 modules (answered here, for this patch is nowhere near): the size
  // goes red, shown though it is not near its ceiling, and the full depth
  // stays amber.
  const before = await page.evaluate(() => window.__budgetRed.length);
  await app.answer("edit_set_tree", { type: "edit_rejected", error: "the patch would pass its limits (25 modules, depth 6)" });
  await page.locator(`#rack-svg .rack-controls g.mod-group[data-key="${first}"]`).focus();
  await page.keyboard.press("F2");
  await page.locator("#ctx-menu .cm-item", { hasText: /^duplicate/ }).click();
  await app.toast(/didn’t happen: the patch would pass its limits \(25 modules, depth 6\)/);
  expect(await page.evaluate((k) => window.__budgetRed[k], before), "the counts drawn red").toEqual([{ text: expect.stringMatching(/^\d+\/24 modules$/), color: red }]);
  await expect(depth).toHaveCSS("color", amber);
});
