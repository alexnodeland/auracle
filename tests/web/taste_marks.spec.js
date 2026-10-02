// TASTE says how sure it is, and counts what is left.
//
// - A guess looks like a guess. DIRECTIONS drew every coefficient as the same
//   glowing bar under "Longer bar = stronger pull", when at 58 picks 35 of 36
//   intervals crossed zero; STYLES drew them with no interval at all; PATCH's
//   node bank called the same number "no lean" and drew a dot. LEARNING's
//   weights and the node bank now draw one mark (taste-geom `pullMark`):
//   settled, a solid bar; a guess, a hollow outline with its whisker at full
//   strength and a "?" in the slot left of its label.
// - Every early state counts from where the player is. MAP said "Start 6
//   quick picks →" at five picks of six; TASTE and LEARNING now say how many
//   picks are left before it fits, and LEARNING says what it has none of yet.
// - The map's footer is in words.
//
// The engine worker is reached the way failure_flows.spec.js reaches it: by
// wrapping `Worker` before main.js runs. A weight's look is checked twice: in
// the weights' own description (their aria-label, which counts the guesses),
// and in the bars, on a fit whose two coefficients the spec chooses — one
// settled, one a guess — delivered as the worker would.
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
      // A pinned fit (injectTwoPulls) outlives the real refits behind it:
      // every listener sees this same data object, and this one runs first.
      if (d.views && window.__pwPinStyles) d.views.styles = JSON.parse(JSON.stringify(window.__pwPinStyles));
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

async function openView(page, view) {
  await page.locator(`.viewtab[data-view="${view}"]`).click();
  await expect(page.locator(`#view-${view}`)).toBeVisible();
}

/** Hand main.js a fit whose leading style has exactly two coefficients: a
 *  settled one on `sure` and a guess on `unsure`. Every other style is idle.
 *  The styles stay pinned: a real refit or generation that lands later (a
 *  slow runner finishes the warm start's background work after this) keeps
 *  them instead of replacing the injected pulls. */
async function injectTwoPulls(page, sure, unsure) {
  await page.evaluate(([a, b]) => {
    const v = JSON.parse(JSON.stringify(window.__pwViews));
    v.styles = v.styles.map((s, k) =>
      k === 0
        ? { ...s, share: 1, theta: [{ name: a, mean: 0.5, std: 0.1 }, { name: b, mean: 0.4, std: 0.6 }] }
        : { ...s, share: 0 },
    );
    window.__pwPinStyles = v.styles;
    const data = { type: "fitted", views: v, status: window.__pwStatus };
    window.__pwEngine().dispatchEvent(new MessageEvent("message", { data }));
  }, [sure, unsure]);
}

test("a guess is drawn hollow with a ?, in LEARNING's weights and the module rail, and the guess above the rack is a percentage and a word", async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors = await boot(page, { warmed: false });
  await warmStartAndFit(page);

  // The guess above the rack is a percentage and a word, never MODEL'S GUESS
  // and a bare decimal (words.js `guessLabel`).
  await expect(page.locator("#belief .bl-u")).toHaveText(/^\d+%$/, { timeout: 30_000 });
  await expect(page.locator("#belief .bl-sure")).toHaveText(/^· (a hunch|leaning|fairly sure)$/);
  await expect(page.locator("#belief")).not.toContainText(/model's guess/i);

  // A real early fit: eighteen picks, and LEARNING says how few of its
  // weights it is sure of.
  await openView(page, "learning");
  const label = await page.locator("#md-bars").getAttribute("aria-label");
  const m = /^.+: (\d+) settled, (\d+) still a guess$/.exec(label || "");
  expect(m, `the weights say what they draw: ${label}`).not.toBeNull();
  const [settled, guesses] = [Number(m[1]), Number(m[2])];
  expect(guesses, "an eighteen-pick fit is mostly guesses").toBeGreaterThan(0);
  await expect(page.locator("#md-bars .md-row")).toHaveCount(settled + guesses);
  await expect(page.locator("#md-bars .md-row.guess")).toHaveCount(guesses);
  await expect(page.locator("#md-bars .md-row.guess .md-mark").first()).toHaveText("?");
  await expect(page.locator("#md-bars .md-row.guess .md-bar.hollow")).toHaveCount(guesses);

  // Two weights chosen here: filter's family settled (0.5 ± 0.1), the vco's
  // a guess (0.4 ± 0.6, an interval across zero). The settled one is filled,
  // the guess hollow, with its whisker across the zero line.
  await injectTwoPulls(page, "n_filter", "n_vco");
  await expect(page.locator("#md-bars")).toHaveAttribute("aria-label", /: 1 settled, 1 still a guess$/);
  const bars = await page.evaluate(() => [...document.querySelectorAll("#md-bars .md-row")].map((r) => {
    const b = r.querySelector(".md-bar");
    const w = r.querySelector(".md-whisker");
    return {
      word: r.querySelector(".md-word").textContent,
      mark: r.querySelector(".md-mark").textContent,
      fill: getComputedStyle(b).backgroundColor,
      lo: parseFloat(w.style.left),
      hi: parseFloat(w.style.left) + parseFloat(w.style.width),
    };
  }));
  expect(bars.map((b) => b.mark)).toEqual(["", "?"]);
  expect(bars[0].fill, "the settled weight is a filled bar").not.toBe("rgba(0, 0, 0, 0)");
  expect(bars[1].fill, "the guess is not filled").toBe("rgba(0, 0, 0, 0)");
  expect(bars[1].lo, "a guess's whisker starts left of zero").toBeLessThan(50);
  expect(bars[1].hi, "…and ends right of it").toBeGreaterThan(50);
  expect(bars[0].lo, "a settled whisker sits clear of zero").toBeGreaterThan(50);

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

  // The filter's spec card says the settled lean in sentences: the count,
  // then the lean, capitalized and ending in a period. It ran on in
  // lowercase after the count's period.
  await page.locator('#nb-groups .nb-item[data-kind="filter"]').hover();
  await expect(page.locator("#spec-dock .sp-dim").first()).toHaveText(/^In \d+ of \d+ sounds\.$/);
  await expect(page.locator("#spec-dock .sp-belief")).toHaveText(
    /^In .+ \(100% of your pool\), you lean toward it \(θ \+0\.50 ± 0\.10\)\.$/);

  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("TASTE's and LEARNING's early states count what is left, and the map says what it shows", async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors = await boot(page, { warmed: true });
  await page.waitForFunction(() => window.__pwLast.duel && window.__pwLast.duel.pair, null, { timeout: 60_000 });

  // No fit yet: both count the picks to the first one, and LEARNING says
  // what it has none of yet.
  await openView(page, "taste");
  await expect(page.locator("#taste-sub")).toHaveText("6 more picks and it fits your taste.", { timeout: 30_000 });
  await expect(page.locator("#taste-legend .tl-words")).toHaveText("still a guess");
  // As in the prototype: before a fit SOUND shows no glow at all, and TASTE
  // shows each as a guess (a dashed ring, and the legend saying so).
  await expect(page.locator("#taste-legend")).not.toHaveClass(/\bon\b/);
  await page.locator("#taste-tog").click();
  await expect(page.locator("#taste-legend")).toHaveClass(/\bon\b/);
  await page.locator("#taste-tog").click();
  await openView(page, "learning");
  await expect(page.locator("#md-sub")).toHaveText("6 more picks and it fits your taste.");
  await expect(page.locator("#md-weights-none")).toHaveText("none yet: it weighs nothing until it first fits");
  await expect(page.locator("#md-fc .md-fcnote")).toHaveText("none yet: it starts guessing when it first fits");

  // Five picks in, the count has moved with them.
  await page.locator('.viewtab[data-view="evolve"]').click();
  for (let i = 0; i < 5; i++) {
    await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 30_000 });
    await page.locator("#choose-a").click();
    await page.waitForTimeout(400);
  }
  await openView(page, "taste");
  await expect(page.locator("#taste-sub")).toHaveText("1 more pick and it fits your taste.");

  // The sixth fits it: the halos light, and the map says what it shows.
  await page.locator('.viewtab[data-view="evolve"]').click();
  await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 30_000 });
  await page.locator("#choose-a").click();
  await expect.poll(() => page.evaluate(() => window.__pwCounts.fitted || 0), { timeout: 120_000 }).toBeGreaterThan(0);
  await openView(page, "taste");
  await expect(page.locator("#taste-sub")).toHaveText("From 6 picks.");
  await expect(page.locator("#taste-legend .tl-words")).toHaveText("it likes more");
  await expect(page.locator("#taste-foot")).toHaveText(/^A flat view of \d+ sounds: close dots usually sound alike \(it shows \d+% of how they differ\)\.$/);
  await openView(page, "learning");
  await expect(page.locator("#md-fc .md-fcnote")).toHaveText(/^(none yet: it guesses before each pick from here|expected \d+% · was \d+%)$/);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});
