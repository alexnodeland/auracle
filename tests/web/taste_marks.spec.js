// TASTE says how sure it is, and counts what is left.
//
// - A guess looks like a guess. DIRECTIONS drew every coefficient as the same
//   glowing bar under "Longer bar = stronger pull", when at 58 picks 35 of 36
//   intervals crossed zero; STYLES drew them with no interval at all; PATCH's
//   node bank called the same number "no lean" and drew a dot. All three now
//   draw one mark (taste-geom `pullMark`): settled, a solid bar; a guess, a
//   hollow outline with its whisker at full strength and a "?" on its label.
// - Every early state counts from where the player is. MAP said "Start 6
//   quick picks →" at five picks of six, and TRUST's twenty guesses sat
//   behind the same six-pick button.
// - The map's footer and caption are in words, and say what a click does.
//
// The engine worker is reached the way failure_flows.spec.js reaches it: by
// wrapping `Worker` before main.js runs. A pull's look is checked twice: in
// the canvas's own description (its aria-label, which names every guess with
// its "?"), and in the pixels, on a fit whose two coefficients the spec
// chooses — one settled, one a guess — delivered as the worker would.
const { test, expect } = require("@playwright/test");

const SEED = `(() => { let s = 20260928 >>> 0; Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

const init = ({ warmed = true } = {}) => `(() => {
  const Orig = window.Worker;
  const workers = (window.__pwWorkers = []);
  const counts = (window.__pwCounts = {});
  const last = (window.__pwLast = {});
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    w.__pwUrl = String(url);
    workers.push(w);
    w.addEventListener("message", (e) => {
      const d = e.data;
      if (!d || typeof d.type !== "string") return;
      last[d.type] = d;
      counts[d.type] = (counts[d.type] || 0) + 1;
      // The views main.js last adopted come with any of several replies.
      if (d.views) window.__pwViews = d.views;
      if (d.status && typeof d.status === "object") window.__pwStatus = d.status;
    });
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  window.__pwEngine = () => workers.find((w) => /worker\\.js/.test(w.__pwUrl)) || null;
  try {
    const seen = ["auracle-played", "auracle-bench-tour", "auracle-bank-toured"];
    if (${warmed}) seen.push("auracle-warmed");
    for (const k of seen) localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

async function boot(page, opts = {}) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.addInitScript(SEED);
  await page.addInitScript(init(opts));
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 150_000 });
  return pageErrors;
}

/** The warm start's three picks, then the fit it asks for. */
async function warmStartAndFit(page) {
  await expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout: 30_000 });
  const cards = page.locator(".warm-cell .warm-item");
  for (const i of [1, 4, 7]) await cards.nth(i).click();
  await page.locator("#warm-go").click();
  await expect.poll(() => page.evaluate(() => window.__pwCounts.fitted || 0), { timeout: 120_000 }).toBeGreaterThan(0);
}

async function tasteTab(page, tab) {
  await page.locator('.viewtab[data-view="taste"]').click();
  await page.locator(`.tab[data-tab="${tab}"]`).click();
}

/** Hand main.js a fit whose leading style has exactly two coefficients: a
 *  settled one on `sure` and a guess on `unsure`. Every other style is idle. */
async function injectTwoPulls(page, sure, unsure) {
  await page.evaluate(([a, b]) => {
    const v = JSON.parse(JSON.stringify(window.__pwViews));
    v.styles = v.styles.map((s, k) =>
      k === 0
        ? { ...s, share: 1, theta: [{ name: a, mean: 0.5, std: 0.1 }, { name: b, mean: 0.4, std: 0.6 }] }
        : { ...s, share: 0 },
    );
    const data = { type: "fitted", views: v, status: window.__pwStatus };
    window.__pwEngine().dispatchEvent(new MessageEvent("message", { data }));
  }, [sure, unsure]);
}

/** Solid style-colour pixels (the first style is the amber token) in a band
 *  of the TASTE canvas: full alpha, red high, blue low. A hollow outline is
 *  drawn at 0.45 alpha and the whisker in silk, so neither counts. */
function solidAmberIn(page, band) {
  return page.evaluate((b) => {
    const c = document.getElementById("taste-crt");
    const ctx = c.getContext("2d");
    const x0 = Math.round(b.x0 * c.width), x1 = Math.round(b.x1 * c.width);
    const y0 = Math.round(b.y0 * c.height), y1 = Math.round(b.y1 * c.height);
    const px = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 200 && px[i] > 200 && px[i + 2] < 150) n += 1;
    return n;
  }, band);
}

test("a guess is drawn hollow with a ?, in DIRECTIONS, STYLES and the node bank", async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors = await boot(page, { warmed: false });
  await warmStartAndFit(page);

  // A real early fit: eighteen preferences, and the model says how few of its
  // pulls it is sure of.
  await tasteTab(page, "dir");
  await expect(page.locator("#taste-caption")).toHaveText(
    "Where each style leans. Solid = it's sure. Hollow = still a guess — the thin line is how far it could be off.",
  );
  const label = await page.locator("#taste-crt").getAttribute("aria-label");
  const m = /^Directions: (\d+) settled, (\d+) still a guess \(marked \?\)\. (.*)$/.exec(label || "");
  expect(m, `the canvas says what it draws: ${label}`).not.toBeNull();
  const [settled, guesses] = [Number(m[1]), Number(m[2])];
  expect(guesses, "an eighteen-preference fit is mostly guesses").toBeGreaterThan(0);
  const rows = m[3].split(", ");
  expect(rows.filter((r) => r.endsWith("?")).length).toBe(guesses);
  expect(rows.length).toBe(settled + guesses);

  await page.locator('.tab[data-tab="styles"]').click();
  await expect(page.locator("#taste-caption")).toContainText("hollow, with a ?, = still a guess");
  await expect(page.locator("#taste-crt")).toHaveAttribute("aria-label", /^Styles: \d+ settled, [1-9]\d* still a guess/);

  // The pixels, on two coefficients chosen here: filter's family settled
  // (0.5 ± 0.1), the vco's a guess (0.4 ± 0.6, an interval across zero).
  await injectTwoPulls(page, "n_filter", "n_vco");
  await page.locator('.tab[data-tab="dir"]').click();
  await expect(page.locator("#taste-crt")).toHaveAttribute("aria-label", /^Directions: 1 settled, 1 still a guess \(marked \?\)\. [^?]+, [^,]+\?$/);
  // Two rows at h/3 and 2h/3, bars rightward from the centre line at 0.6 w;
  // the band sits inside both bars (0.5 and 0.4 of the 0.3 w half-width).
  const bar = (y) => ({ x0: 0.62, x1: 0.70, y0: y - 0.012, y1: y + 0.012 });
  const solidSettled = await solidAmberIn(page, bar(1 / 3));
  const solidGuess = await solidAmberIn(page, bar(2 / 3));
  expect(solidSettled, "the settled pull is a filled bar").toBeGreaterThan(40);
  expect(solidGuess, "the guess is not filled").toBe(0);

  // PATCH's node bank draws the same two marks: the vco a hollow bar whose
  // whisker crosses the zero rule, the filter a solid one clear of it.
  await page.locator('.viewtab[data-view="play"]').click();
  const cell = (kind) => page.locator(`#nb-groups .nb-item[data-kind="${kind}"] .ni-theta`);
  await expect(cell("vco")).toHaveClass(/\bguess\b/, { timeout: 15_000 });
  await expect(cell("filter")).not.toHaveClass(/\bguess\b|\bthin\b/);
  const geo = await page.evaluate(() => {
    const read = (kind) => {
      const c = document.querySelector(`#nb-groups .nb-item[data-kind="${kind}"] .ni-theta`);
      const w = c.querySelector(".tb-whisk");
      const b = c.querySelector(".tb-bar");
      return {
        lo: parseFloat(w.style.left),
        hi: parseFloat(w.style.left) + parseFloat(w.style.width),
        fill: getComputedStyle(b).backgroundColor,
        title: c.title,
      };
    };
    return { vco: read("vco"), filter: read("filter") };
  });
  expect(geo.vco.lo, "a guess's whisker starts left of zero").toBeLessThan(17);
  expect(geo.vco.hi, "…and ends right of it").toBeGreaterThan(17);
  expect(geo.vco.fill).toBe("rgba(0, 0, 0, 0)");
  expect(geo.vco.title).toMatch(/^Still a guess/);
  expect(geo.filter.lo, "a settled whisker sits clear of zero").toBeGreaterThan(17);
  expect(geo.filter.fill).not.toBe("rgba(0, 0, 0, 0)");

  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("TASTE's early states count what is left, and the map says what a click does", async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors = await boot(page, { warmed: true });
  await page.waitForFunction(() => window.__pwLast.duel && window.__pwLast.duel.pair, null, { timeout: 60_000 });

  // No fit yet: MAP, STYLES and DIRECTIONS count the picks to the first one.
  await tasteTab(page, "map");
  await expect(page.locator("#crt-empty #ce-cta")).toHaveText("6 more picks →", { timeout: 30_000 });
  await page.locator('.tab[data-tab="styles"]').click();
  await expect(page.locator("#crt-empty")).toContainText("Your first style appears at pick 6; more split off as you teach it.");
  await page.locator('.tab[data-tab="trust"]').click();
  await expect(page.locator("#crt-empty")).toContainText("After 20 guesses it grades itself here.");
  await expect(page.locator("#crt-empty #ce-cta")).toHaveText("20 to go →");

  // Five picks in, the count has moved with them.
  await page.locator('.viewtab[data-view="evolve"]').click();
  for (let i = 0; i < 5; i++) {
    await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 30_000 });
    await page.locator("#choose-a").click();
    await page.waitForTimeout(400);
  }
  await tasteTab(page, "map");
  await expect(page.locator("#crt-empty #ce-cta")).toHaveText("1 more pick →");
  await expect(page.locator("#crt-empty")).toContainText("In 1 more pick it redraws your taste map");
  await page.locator('.tab[data-tab="styles"]').click();
  await expect(page.locator("#crt-empty")).toContainText("Your first style appears at pick 6;");

  // The sixth redraws it: the map lights, captioned in words.
  await page.locator('.viewtab[data-view="evolve"]').click();
  await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 30_000 });
  await page.locator("#choose-a").click();
  await expect.poll(() => page.evaluate(() => window.__pwCounts.fitted || 0), { timeout: 120_000 }).toBeGreaterThan(0);
  await tasteTab(page, "map");
  await expect(page.locator("#taste-caption")).toHaveText(
    "Brighter: it thinks you’d like it more. Bigger: it’s less sure. Click a dot to open it.",
  );
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});
