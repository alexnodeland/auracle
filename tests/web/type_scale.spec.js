// The scale holds in the browser.
//
// - The page's text is at least the label size, 11 px: the approved specimen's
//   labels, and the floor under its type scale. The rack and the minimap are
//   SVG drawn through a camera, sized at zoom 1 with tokens of their own
//   (`--t-rack-*`), so text inside an `svg` is not this rule's; nor is a lone
//   glyph (▶, ★, ✓), which is sized to the button it sits in.
// - A canvas draws its text at the canvas floor, 12 px, or larger: TA20 found
//   the 10 px the scopes and TASTE used too small for their job.
// - Under prefers-reduced-motion every duration on the scale is 0, so a
//   transition built on one is instant; without it, it plays.
//
// The tokens are www/brand/tokens.json, and `tokens.py --check` counts the
// literal sizes written in the stylesheet and the scripts. These read what
// the browser computes instead, on every view, so a rule that wins the
// cascade with a smaller size, or a script that sets one, fails here even
// when the count is clean.
const { test, expect } = require("@playwright/test");

const INIT = `(() => {
  try {
    for (const k of ["auracle-played", "auracle-bench-tour", "auracle-bank-toured", "auracle-warmed"]) localStorage.setItem(k, "1");
  } catch (_) {}
  // Every font a canvas is given, in CSS pixels, as the browser parsed it.
  const fonts = (window.__pwCanvasFonts = []);
  const d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "font");
  Object.defineProperty(CanvasRenderingContext2D.prototype, "font", {
    configurable: true,
    get() { return d.get.call(this); },
    set(v) {
      d.set.call(this, v);
      const px = parseFloat((/([\\d.]+)px/.exec(d.get.call(this)) || [])[1]);
      fonts.push({ font: d.get.call(this), css: px / (window.devicePixelRatio || 1), canvas: this.canvas.id || "" });
    },
  });
})();`;

async function boot(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.addInitScript(INIT);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 150_000 });
  return errs;
}

/** Visible text under the floor: each element that holds its own words, or
 *  whose ::before or ::after prints some, outside any svg, whose computed
 *  size is under `floor` px. */
const UNDER = (floor) => `(() => {
  const out = [];
  const name = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
    (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/).join(".") : "");
  const words = (s) => /[\\p{L}\\p{N}]/u.test(s);
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest("svg") || !el.getClientRects().length) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || +cs.opacity === 0) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
    if (words(own) && parseFloat(cs.fontSize) < ${floor}) out.push(name(el) + " " + cs.fontSize + ": " + own.slice(0, 40));
    for (const p of ["::before", "::after"]) {
      const ps = getComputedStyle(el, p);
      const attr = /^attr\\(([\\w-]+)\\)$/.exec(ps.content);
      const text = attr ? el.getAttribute(attr[1]) || "" : ps.content.startsWith('"') ? ps.content.slice(1, -1) : "";
      if (words(text) && ps.display !== "none" && parseFloat(ps.fontSize) < ${floor}) out.push(name(el) + p + " " + ps.fontSize + ": " + text.slice(0, 40));
    }
  }
  return out;
})()`;

test("the page's text is at least the label size, 11 px, on every view", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = await boot(page);
  const under = {};
  for (const view of ["perform", "play", "evolve", "taste"]) {
    await page.locator(`.viewtab[data-view="${view}"]`).click();
    await page.waitForTimeout(1500);
    under[view] = await page.evaluate(UNDER(11));
  }
  for (const tab of ["styles", "dir", "trust"]) {
    await page.locator(`.tab[data-tab="${tab}"]`).click();
    await page.waitForTimeout(600);
    under[`taste ${tab}`] = await page.evaluate(UNDER(11));
  }
  await page.locator('.viewtab[data-view="play"]').click();
  await page.keyboard.press("?");
  await expect(page.locator("#help")).toBeVisible();
  under["? card"] = await page.evaluate(UNDER(11));
  for (const [where, list] of Object.entries(under)) expect(list, `text under 11 px on ${where}`).toEqual([]);
  expect(errs).toEqual([]);
});

test("a canvas draws its text at the canvas floor, 12 px, or larger", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = await boot(page);
  // EVOLVE's scopes label full scale; TASTE's tabs label their dots and bars.
  await page.locator('.viewtab[data-view="evolve"]').click();
  await expect(page.locator("#scope-a")).toBeVisible();
  await page.locator('.viewtab[data-view="taste"]').click();
  for (const tab of ["map", "styles", "dir", "trust"]) {
    await page.locator(`.tab[data-tab="${tab}"]`).click();
    await page.waitForTimeout(600);
  }
  const fonts = await page.evaluate(() => window.__pwCanvasFonts);
  const canvases = new Set(fonts.map((f) => f.canvas));
  expect(canvases.has("taste-crt"), `TASTE's canvas set a font (${[...canvases]})`).toBe(true);
  const small = fonts.filter((f) => !(f.css >= 12));
  expect(small, "canvas fonts under 12 px").toEqual([]);
  expect(errs).toEqual([]);
});

test("reduced motion makes a transition on the scale instant, and without it the transition plays", async ({ browser }) => {
  for (const [reducedMotion, want] of [["no-preference", ["320ms", "0.32s"]], ["reduce", ["0ms", "0s"]]]) {
    const page = await browser.newPage({ reducedMotion });
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto("/");
    // The boot veil fades out on --d-move; nothing here needs the engine.
    const got = await page.evaluate(() => [
      getComputedStyle(document.documentElement).getPropertyValue("--d-move").trim(),
      getComputedStyle(document.getElementById("boot")).transitionDuration,
    ]);
    expect(got, `with prefers-reduced-motion: ${reducedMotion}`).toEqual(want);
    expect(errs).toEqual([]);
    await page.close();
  }
});
