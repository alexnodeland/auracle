// PATCH's camera, quiet in the well's corner (Plan-008 C2a, round 2's camera
// decision): fit · − · + · map · the layout's ▾.
//
// What this claims:
//
// - −, + and fit move the camera: − and + zoom about the well's middle, fit
//   frames the whole patch again.
// - The layout's ▾ is a menu: chain, compact and by hand (the subtitle names
//   the layout), with snap and reset acting on a layout by hand only.
// - map shows the minimap; a shift-click on it bookmarks the spot, and ⇧1
//   brings the camera back to it.
// - ctrl-wheel (a trackpad's pinch) over the well zooms the camera, never the
//   level.
// - When the patch is wider than the view, its edges count the modules past
//   them, and a press brings the nearest one in.
const { test, expect } = require("@playwright/test");
const { boot, openPreset } = require("./patch_page");

const viewBox = (page) => page.evaluate(() => document.getElementById("rack-svg").getAttribute("viewBox").split(/\s+/).map(Number));
// The camera at rest: two reads a quarter second apart agree (opening a
// preset fits it with a tween, and a bookmark keeps the zoom it was set at).
const restingView = async (page) => {
  let last = null;
  await expect.poll(async () => {
    const v = (await viewBox(page)).join(" ");
    const same = v === last;
    last = v;
    return same;
  }, { timeout: 10_000, intervals: [250] }).toBe(true);
};

test("−, + and fit in the corner zoom the camera and frame the patch again", async ({ page }) => {
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  await restingView(page);
  const fitted = await viewBox(page);
  await page.locator("#pt-zoom-in").click();
  await expect.poll(async () => (await viewBox(page))[2]).toBeLessThan(fitted[2]);
  await page.locator("#pt-zoom-out").click();
  await page.locator("#pt-zoom-out").click();
  await expect.poll(async () => (await viewBox(page))[2]).toBeGreaterThan(fitted[2]);
  await page.locator("#pt-fit").click();
  // Every module in the view again, and drawn at least as large as the fit
  // it opened at drew it.
  await expect.poll(() => page.evaluate(() => {
    const f = document.getElementById("rack-scroll").getBoundingClientRect();
    return [...document.querySelectorAll("#rack-svg .rack-plates g[data-key] .mod-plate")].every((p) => {
      const r = p.getBoundingClientRect();
      return r.left >= f.left - 1 && r.right <= f.right + 1 && r.top >= f.top - 1 && r.bottom <= f.bottom + 1;
    });
  }), { timeout: 5_000 }).toBe(true);
  expect((await viewBox(page))[2]).toBeLessThan(fitted[2] * 1.5);
  expect(errors).toEqual([]);
});

test("the layout's ▾ switches chain, compact and by hand, and snap and reset act by hand only", async ({ page }) => {
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  const btn = page.locator("#rack-layout");
  const menu = page.locator("#pt-laymenu");
  await expect(btn).toHaveText(/^chain/);
  await btn.click();
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-layout="chain"]')).toHaveAttribute("aria-checked", "true");
  await expect(menu.locator("#rack-grid")).toBeDisabled();
  await expect(menu.locator("#rack-reseed")).toBeDisabled();
  await menu.locator('[data-layout="compact"]').click();
  await expect(menu).toBeHidden();
  await expect(btn).toHaveText(/^compact/);
  await expect(page.locator("#rack-meta")).toContainText("packed tight");
  await btn.click();
  await menu.locator('[data-layout="freeform"]').click();
  await expect(btn).toHaveText(/^by hand/);
  await expect(page.locator("#rack-meta")).toContainText("placed by hand");
  await btn.click();
  await expect(menu.locator("#rack-grid")).toBeEnabled();
  await expect(menu.locator("#rack-reseed")).toBeEnabled();
  // The arrows walk the menu; Esc folds it and gives ▾ the focus back.
  await menu.locator('[data-layout="freeform"]').focus();
  await page.keyboard.press("ArrowDown");
  await expect(menu.locator("#rack-grid")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(btn).toBeFocused();
  // Back to the chain.
  await btn.click();
  await menu.locator('[data-layout="chain"]').click();
  await expect(page.locator("#rack-meta")).toContainText("in signal order");
  expect(errors).toEqual([]);
});

test("map shows the minimap, a shift-click bookmarks a spot, and ⇧1 goes back to it", async ({ page }) => {
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  await page.locator("#rack-map-btn").click();
  const map = page.locator("#rack-map");
  await expect(map).toBeVisible();
  await expect(page.locator("#rack-map-btn")).toHaveAttribute("aria-pressed", "true");
  const m = await map.boundingBox();
  await restingView(page);
  await page.keyboard.down("Shift");
  await page.mouse.click(m.x + m.width * 0.3, m.y + m.height * 0.5);
  await page.keyboard.up("Shift");
  await expect(page.locator("#rack-map .mm-pip")).toHaveCount(1);
  const marked = await viewBox(page);
  await page.locator("#pt-fit").click();
  await page.locator("#pt-zoom-in").click();
  await expect.poll(async () => (await viewBox(page))[2]).not.toBeCloseTo(marked[2], 0);
  await page.locator("#rack-subject").click();
  await page.keyboard.press("Shift+Digit1");
  await expect.poll(async () => {
    // The bookmark keeps the zoom it was set at (and the spot clicked).
    const v = await viewBox(page);
    return Math.abs(v[2] - marked[2]) < 2;
  }, { timeout: 5_000 }).toBe(true);
  expect(errors).toEqual([]);
});

test("ctrl-wheel over the well zooms the camera, not the level", async ({ page }) => {
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  await restingView(page);
  const before = await viewBox(page);
  const f = await page.locator("#rack-scroll").boundingBox();
  await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -240);
  await page.keyboard.up("Control");
  await expect.poll(async () => (await viewBox(page))[2]).toBeLessThan(before[2]);
  await expect(page.locator("body")).toHaveAttribute("data-level", "patch");
  await expect(page.locator('.rail-stop[data-level="patch"]')).toHaveAttribute("aria-current", "location");
  expect(errors).toEqual([]);
});

test("zoomed in, the well's edges count the modules past them, and a press brings the nearest in", async ({ page }) => {
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  await expect(page.locator("#pt-edge-l")).toBeHidden();
  await expect(page.locator("#pt-edge-r")).toBeHidden();
  for (let i = 0; i < 5; i++) await page.locator("#pt-zoom-in").click();
  const right = page.locator("#pt-edge-r");
  const left = page.locator("#pt-edge-l");
  // Zoomed about the middle, something lies past at least one edge.
  await expect.poll(async () => (await right.isVisible()) || (await left.isVisible())).toBe(true);
  const edge = (await right.isVisible()) ? right : left;
  const n = Number(await edge.locator("b").textContent());
  expect(n).toBeGreaterThan(0);
  await expect(edge).toHaveAttribute("aria-label", /more module(s)? to the (left|right)/);
  await restingView(page);
  const x0 = (await viewBox(page))[0];
  await edge.click();
  await expect.poll(async () => (await viewBox(page))[0], { timeout: 5_000 }).not.toBeCloseTo(x0, 0);
  expect(errors).toEqual([]);
});
