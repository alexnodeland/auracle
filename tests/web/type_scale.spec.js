// The scale holds in the browser.
//
// - The page's text is at least the label size, 11 px: the approved specimen's
//   labels, and the floor under its type scale. That includes pseudo-element
//   text and the minimap's bookmark numbers. The rack's own SVG is drawn
//   through a camera and sized at zoom 1 with tokens of its own
//   (`--t-rack-*`), so text inside `#rack-svg` is not this rule's; nor is a
//   lone glyph (▶, ★, ✓), which is sized to the button it sits in.
// - A canvas draws its text at the canvas floor, 12 px, or larger: TA20 found
//   the 10 px the scopes and TASTE used too small for their job. The duel
//   scopes' "0 dBFS" and LEARNING's forecast strip are drawn and read, and the
//   strip's labels keep their descenders inside the canvas.
// - The menu bar is as tall as `--menubar-h`, which what opens under it (the
//   alarm) is placed by, in one row and in two.
// - Under prefers-reduced-motion all three durations on the scale are 0, so a
//   transition built on one is instant; without it, it plays.
//
// The tokens are www/brand/tokens.json, and `tokens.py --check` counts the
// literal sizes written in the stylesheet and the scripts. These read what
// the browser computes instead, on every view, so a rule that wins the
// cascade with a smaller size, or a script that sets one, fails here even
// when the count is clean.
const { test, expect } = require("@playwright/test");
const { goLevel } = require("./shell");

const INIT = `(() => {
  try {
    for (const k of ["auracle-played", "auracle-bench-tour", "auracle-bank-toured", "auracle-warmed"]) localStorage.setItem(k, "1");
  } catch (_) {}
  // The engine worker, to hand main.js a calibration as the worker would.
  const Orig = window.Worker;
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    if (/worker\\.js/.test(String(url))) window.__pwWorker = w;
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  // Every line of text a canvas draws: its words, its baseline, the canvas's
  // height, and the font it was drawn in, in CSS pixels.
  const texts = (window.__pwCanvasText = []);
  const fill = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (s, x, y, ...rest) {
    const dpr = window.devicePixelRatio || 1;
    const px = parseFloat((/([\\d.]+)px/.exec(this.font) || [])[1]);
    texts.push({ text: String(s), y, h: this.canvas.height, dpr, css: px / dpr, canvas: this.canvas.id || "" });
    return fill.call(this, s, x, y, ...rest);
  };
})();`;

async function boot(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.addInitScript(INIT);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 150_000 });
  return errs;
}

/** Two frames: whatever a click changed has been laid out and drawn. */
const settled = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function openView(page, view) {
  await goLevel(page, view);
  await expect(page.locator(`#view-${view}`)).toBeVisible();
  await settled(page);
}

/** Visible text under the floor: each element that holds its own words, or
 *  whose ::before or ::after prints some, outside the rack's SVG, whose
 *  computed size is under `floor` px. */
const UNDER = (floor) => `(() => {
  const out = [];
  const name = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
    (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/).join(".") : "");
  const words = (s) => /[\\p{L}\\p{N}]/u.test(s);
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest("#rack-svg") || !el.getClientRects().length) continue;
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
  for (const view of ["perform", "patch", "evolve", "taste", "learning"]) {
    await openView(page, view);
    under[view] = await page.evaluate(UNDER(11));
  }
  // LEARNING with the maths open.
  await page.locator("#md-math-btn").click();
  under["learning, the maths"] = await page.evaluate(UNDER(11));
  // A bookmark on the minimap: its number is text in a page, at the floor,
  // inside its pip.
  await openView(page, "patch");
  if ((await page.locator("#rack-map-btn").getAttribute("aria-pressed")) !== "true") await page.locator("#rack-map-btn").click();
  await expect(page.locator("#rack-map")).toBeVisible();
  const map = await page.locator("#rack-map").boundingBox();
  await page.keyboard.down("Shift");
  await page.mouse.click(map.x + map.width / 2, map.y + map.height / 2);
  await page.keyboard.up("Shift");
  await expect(page.locator("#rack-map .mm-pip-n")).toHaveCount(1);
  under["minimap"] = await page.evaluate(UNDER(11));
  const pip = await page.evaluate(() => {
    const t = document.querySelector("#rack-map .mm-pip-n").getBBox();
    const c = document.querySelector("#rack-map .mm-pip").getBBox();
    return { t: [t.x, t.y, t.width, t.height], c: [c.x, c.y, c.width, c.height] };
  });
  expect(pip.t[2] <= pip.c[2] && pip.t[3] <= pip.c[3], `the bookmark's number fits its pip (${JSON.stringify(pip)})`).toBe(true);
  await page.keyboard.press("?");
  await expect(page.locator("#help")).toBeVisible();
  under["? card"] = await page.evaluate(UNDER(11));
  for (const [where, list] of Object.entries(under)) expect(list, `text under 11 px on ${where}`).toEqual([]);
  expect(errs).toEqual([]);
});

test("a canvas draws its text at the canvas floor, 12 px, or larger, and the forecast strip's labels stay inside it", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = await boot(page);
  const drawn = (canvas, text) => page.waitForFunction(
    ([c, s]) => window.__pwCanvasText.some((t) => (!c || c.includes(t.canvas)) && t.text.startsWith(s)),
    [canvas, text], { timeout: 90_000 },
  );
  // EVOLVE's scopes label full scale once a pair's sound is in.
  await openView(page, "evolve");
  await drawn(["scope-a", "scope-b"], "0 dBFS");
  // TASTE's map, and LEARNING with forecasts to draw, handed over as the
  // worker hands them.
  await openView(page, "taste");
  await openView(page, "learning");
  await page.evaluate(() => {
    const calib = {
      n: 34, brier: 0.214, skill: 0.12, check_n: 9, check_skill: 0.05, bins: [],
      by_provenance: [{ provenance: "duel", n: 24, skill: 0.1 }, { provenance: "heard_edit", n: 10, skill: 0.2 }],
    };
    const forecasts = [0.62, 0.3, 0.71, 0.55].map((p_a, i) => ({ p_a, chose_a: i % 2 === 0, random_check: false, provenance: "duel" }));
    window.__pwWorker.dispatchEvent(new MessageEvent("message", { data: { type: "calibration", calib, forecasts } }));
  });
  await drawn(["md-strip-cv"], "100%");
  const texts = await page.evaluate(() => window.__pwCanvasText);
  const small = texts.filter((t) => !(t.css >= 12)).map((t) => `${t.canvas}: ${t.text} at ${t.css}px`);
  expect(small, "canvas text under 12 px").toEqual([]);
  const last = texts.filter((t) => t.canvas === "md-strip-cv").pop();
  expect(last.y, `the strip's labels, at ${last.y} of ${last.h}, keep their descenders inside it`).toBeLessThanOrEqual(last.h - 4 * last.dpr);
  expect(errs).toEqual([]);
});

test("the menu bar is as tall as --menubar-h, which the alarm is placed under, at every width", async ({ browser }) => {
  // One row at 1000 and up; two at 860 and on a phone, behind "look around
  // anyway", where the token is the wrapped bar's measured height.
  for (const [width, height, mobile] of [[1440, 900, false], [1000, 800, false], [860, 800, false], [390, 844, true]]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile });
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.addInitScript(() => { try { sessionStorage.setItem("auracle-anyway", "1"); } catch (_) {} });
    await page.goto("/");
    await expect(page.locator(".menubar")).toBeVisible();
    const got = await page.evaluate(() => [
      document.querySelector(".menubar").getBoundingClientRect().height,
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--menubar-h")),
    ]);
    expect(got[0], `the menu bar's height at ${width} px, against --menubar-h`).toBe(got[1]);
    expect(errs).toEqual([]);
    await page.close();
  }
});

test("reduced motion makes every duration on the scale instant, and without it a transition plays", async ({ browser }) => {
  for (const [reducedMotion, want] of [
    ["no-preference", { press: "90ms", state: "180ms", move: "320ms", boot: "0.32s" }],
    ["reduce", { press: "0ms", state: "0ms", move: "0ms", boot: "0s" }],
  ]) {
    const page = await browser.newPage({ reducedMotion });
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto("/");
    // The boot veil fades out on --d-move; nothing here needs the engine.
    const got = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        press: root.getPropertyValue("--d-press").trim(),
        state: root.getPropertyValue("--d-state").trim(),
        move: root.getPropertyValue("--d-move").trim(),
        boot: getComputedStyle(document.getElementById("boot")).transitionDuration,
      };
    });
    expect(got, `with prefers-reduced-motion: ${reducedMotion}`).toEqual(want);
    expect(errs).toEqual([]);
    await page.close();
  }
});
