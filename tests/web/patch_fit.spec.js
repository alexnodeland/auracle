// PATCH's fit is readable and a finger's size on every screen (#519).
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
//   well's right edge for the modules past it); every ⋯ and every lock is at
//   least 44 × 44 px and answers at its middle, and so is the face at OUT
//   once the edge has carried the camera to it; a finger's tap beside an out
//   ○ (not on it) picks its cable up and opens no module's sheet; and FIT
//   frames the patch as it opened again.
// - At 1440 × 900 the same patch fits with every name at 11 px or larger and
//   no rack text under 9 px, the rest past the right edge, and FIT after a
//   zoom comes back to that fit.
const { test, expect, goLevel } = require("./fixtures");
const { rackAtRest } = require("./patch_page");

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

    // Every ⋯ and lock in the well: 44 × 44 px, and its own at its middle.
    const pads = await page.evaluate(() => {
      const f = document.getElementById("rack-scroll").getBoundingClientRect();
      return [...document.querySelectorAll("#rack-svg .mod-menu-btn, #rack-svg .mod-lock")].map((g) => {
        const r = g.querySelector("rect").getBoundingClientRect();
        const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
        if (x < f.left || x > f.right || y < f.top || y > f.bottom) return null;
        return { what: g.getAttribute("class"), w: Math.round(r.width), h: Math.round(r.height), own: !!document.elementFromPoint(x, y)?.closest(`.${g.classList[0]}`) };
      }).filter(Boolean);
    });
    expect(pads.length, "a ⋯ or a lock on the screen").toBeGreaterThan(0);
    for (const p of pads) {
      expect(p.w, `${p.what}'s width`).toBeGreaterThanOrEqual(44);
      expect(p.h, `${p.what}'s height`).toBeGreaterThanOrEqual(44);
      expect(p.own, `${p.what} answers at its middle`).toBe(true);
    }

    // A finger's tap beside an out ○, on the panel and not on the socket,
    // picks its cable up; no module's sheet opens.
    const beside = await page.evaluate(() => {
      const jacks = [...document.querySelectorAll("#rack-svg .jack")].map((j) => {
        const r = j.querySelector(".j-nut").getBoundingClientRect();
        return { j, x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      const f = document.getElementById("rack-scroll").getBoundingClientRect();
      for (const s of jacks.filter((o) => o.j.matches("[data-outkey]:not(.modjack)"))) {
        for (let a = 0; a < 2 * Math.PI; a += Math.PI / 8) {
          for (const d of [14, 17]) {
            const x = s.x + d * Math.cos(a);
            const y = s.y + d * Math.sin(a);
            if (x < f.left + 4 || x > f.right - 4 || y < f.top + 4 || y > f.bottom - 4) continue;
            const t = document.elementFromPoint(x, y);
            if (!t || !t.closest("#rack-svg") || t.closest("[data-addr], .jack, .mod-menu-btn, .mod-lock, .rack-guess, .ain-ctl")) continue;
            if (jacks.every((o) => o === s || Math.hypot(o.x - x, o.y - y) > 1.6 * d)) return { x, y };
          }
        }
      }
      return null;
    });
    expect(beside, "a point of panel beside an out ○").not.toBeNull();
    await page.touchscreen.tap(beside.x, beside.y);
    await expect(page.locator("#rack-svg")).toHaveClass(/\bwiring\b/);
    await expect(page.locator("#module-sheet.on")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator("#rack-svg")).not.toHaveClass(/\bwiring\b/);

    // The edge carries the camera along, to OUT: the face there is a
    // finger's size. FIT frames the patch as it opened again.
    const fitted = await viewBox(page);
    const edge = page.locator("#pt-edge-r");
    // Each press brings the nearest module past it to the middle.
    await expect.poll(async () => {
      if (await edge.isVisible()) await edge.tap();
      return edge.isVisible();
    }, { timeout: 30_000, intervals: [600] }).toBe(false);
    await expect.poll(() => page.evaluate(() => {
      const f = document.getElementById("rack-scroll").getBoundingClientRect();
      const p = document.getElementById("rack-play").getBoundingClientRect();
      return p.left >= f.left - 1 && p.right <= f.right + 1 && p.width >= 44 && p.height >= 44;
    }), { message: "the face at OUT, in the well and a finger's size" }).toBe(true);
    await page.locator("#pt-fit").tap();
    await expect.poll(async () => near(await viewBox(page), fitted), { timeout: 5_000 }).toBe(true);
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
