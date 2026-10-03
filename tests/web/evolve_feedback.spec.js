// What EVOLVE and TASTE say back when you teach them, checked where the films
// found them short of the guide.
//
// - PICKS counts a pick the moment it is made and uncounts it on ⌘Z; it used
//   to wait out the vote's seven-second undo window, so it lagged every pick
//   and read one short after a run of them.
// - The vote toast names the vote ⌘Z would undo: a later pick's toast takes
//   the place of an earlier one, on screen or queued. Voting every two
//   seconds used to leave the first pick named six seconds after the third.
// - The sixth pick always redraws the taste map. A refit used to be skipped
//   when the engine said its weights had not collapsed, so a run of agreeable
//   picks ended with the meter wrapping to zero and nothing learned.
// - The rule that deals the pairs is stated, steadily: under the default
//   every pair is dealt at random, which the old one-in-ten ◇ caption denied.
// - A bank row's ▶ is a transport: lit while it plays, and a second press
//   stops it. ▶ SAMPLE is the same.
// - The warm start's result replaces its "Loading those in…" toast.
//
// The engine worker is reached the way failure_flows.spec.js reaches it: by
// wrapping `Worker` before main.js runs. Sessions are seeded (the films' own
// Math.random), so the pool and the sides are the same run to run.
const { test, expect } = require("@playwright/test");
const { goLevel } = require("./shell");

const SEED = `(() => { let s = 20260927 >>> 0; Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

const init = ({ warmed = true } = {}) => `(() => {
  const Orig = window.Worker;
  const workers = (window.__pwWorkers = []);
  const last = (window.__pwLast = {});
  const counts = (window.__pwCounts = {});
  const log = (window.__pwLog = []);
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    w.__pwUrl = String(url);
    workers.push(w);
    w.addEventListener("message", (e) => {
      const d = e.data;
      // Registered before main's onmessage, and the event's data is one
      // object, so main reads what this leaves: the engine reporting its
      // importance weights intact, which is the case the refit used to skip.
      if (window.__pwNoRefit && d && d.status && typeof d.status === "object") d.status.needs_refit = false;
      // Deals tagged as a given rule dealt them (the ◇ test): the engine's own
      // pairs, under a rule the session is not running.
      if (window.__pwDealMeta && d && d.type === "duel" && d.meta) Object.assign(d.meta, window.__pwDealMeta);
      if (d && typeof d.type === "string") {
        last[d.type] = d;
        counts[d.type] = (counts[d.type] || 0) + 1;
        if (d.type === "status" || d.type === "fitted" || d.type === "duel") {
          // A pick's reply carries the ratings it left (\`engineRatings\`):
          // kept as their shape and a checksum of their numbers. Not the sum
          // of the means: φ is standardized over the pool, so with one lens
          // that sum can be zero up to rounding whatever the posterior.
          const b = d.ratings;
          const ratings = b
            ? { rows: b.ranked.length, seeds: b.seeds.length, may: b.may_replace.length, sum: b.ranked.reduce((s, r) => s + r.mean * r.mean + r.std, 0) }
            : null;
          log.push({ type: d.type, at: performance.now(), needs_refit: d.status && d.status.needs_refit, pool: d.status && d.status.pool, target: d.status && d.status.pool_target, vote: !!d.vote, ratings, ess: d.status && d.status.ess, pair: d.vote && d.vote.a != null ? [d.vote.a, d.vote.b] : null });
        }
      }
    });
    const post = w.postMessage.bind(w);
    w.postMessage = (m, t) => {
      if (m && m.type) counts["sent:" + m.type] = (counts["sent:" + m.type] || 0) + 1;
      return post(m, t);
    };
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  window.__pwEngine = () => workers.find((w) => /worker\\.js/.test(w.__pwUrl)) || null;
  // Every toast that enters the lane, in order: the lane shows one at a time,
  // so a replaced toast is visible here as one that never entered.
  const toasts = (window.__pwToasts = []);
  document.addEventListener("DOMContentLoaded", () => {
    const lane = document.getElementById("toasts");
    if (!lane) return;
    new MutationObserver((muts) => {
      for (const m of muts)
        for (const n of m.addedNodes) {
          const msg = n.querySelector && n.querySelector(".toast-msg");
          if (msg) toasts.push({ text: msg.textContent, at: performance.now() });
        }
    }).observe(lane, { childList: true });
  });
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

const count = (page, type) => page.evaluate((t) => window.__pwCounts[t] || 0, type);
const post = (page, data) => page.evaluate((d) => window.__pwEngine().postMessage(d), data);
const picks = async (page) => Number(await page.locator("#duel-count").textContent());
/** The names on the cards, as the toast will say them. */
const cardNames = (page) =>
  page.evaluate(() => ["a", "b"].map((s) => document.getElementById(`name-${s}`).firstChild.textContent.trim()));
/** The ids on the cards, in the order they are shown. */
const cardIds = (page) =>
  page.evaluate(() => ["a", "b"].map((s) => Number(document.querySelector(`#name-${s} .dn-id`).textContent.replace("#", ""))));

async function toEvolve(page) {
  await page.waitForFunction(() => window.__pwLast.duel && window.__pwLast.duel.pair, null, { timeout: 60_000 });
  await goLevel(page, "evolve");
  await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 30_000 });
  // The names are painted from the bank's rows; wait for real ones.
  await expect(page.locator("#name-a .dn-id")).toBeAttached({ timeout: 30_000 });
}

test("TAUGHT counts a pick at once, ⌘Z takes it back, and the lane names the latest pick", async ({ page }) => {
  const pageErrors = await boot(page);
  await toEvolve(page);
  const chooseA = page.locator("#choose-a");
  const n0 = await picks(page);

  // Counted in the click's own task — not seven seconds on, when the log hears.
  await chooseA.click();
  expect(await picks(page)).toBe(n0 + 1);
  // TAUGHT counts everything it learned from, and its tooltip splits it.
  await expect(page.locator("#taught .counter-label")).toHaveText("taught");
  await expect(page.locator("#taught")).toHaveAttribute("title", new RegExp(`^${n0 + 1} picks? · 0 stars · 0 cuts$`));
  await expect(page.locator("#teach-pips i.lit")).toHaveCount(1);
  await expect(page.locator("#teach-copy")).toContainText("5 more picks");

  // ⌘Z inside the window uncounts it everywhere it was counted, and the
  // "Picked …" toast goes with it rather than standing over a pick undone.
  await page.keyboard.press("Control+z");
  expect(await picks(page)).toBe(n0);
  await expect(page.locator("#teach-pips i.lit")).toHaveCount(0);
  await expect(page.locator("#toasts .toast", { hasText: "Picked " })).toHaveCount(0);

  // Three picks a second and a half apart: the lane names the third.
  let third = null;
  let before = 0;
  for (let i = 0; i < 3; i++) {
    await expect(chooseA).toBeEnabled();
    // A pair dealt from sounds still arriving shows their ids until the bank
    // names them (the app opens at PERFORM, whose first measurement goes
    // before the rest of the fill): the third pick is read once it's named.
    if (i === 2) await expect.poll(async () => (await cardNames(page)).some((n) => /^#\d+$/.test(n)), { timeout: 60_000 }).toBe(false);
    const [a, b] = await cardNames(page);
    if (i === 2) {
      third = `Picked ${a} over ${b}.`;
      before = await page.evaluate(() => window.__pwToasts.length);
    }
    await chooseA.click();
    expect(await picks(page)).toBe(n0 + i + 1);
    if (i < 2) await page.waitForTimeout(1500);
  }
  // Until the third pick's window closes and it commits, sampling PICKS: it
  // must never dip while a pick moves from "waiting" to "in the log".
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 8_500) {
    seen.add(await picks(page));
    await page.waitForTimeout(150);
  }
  expect([...seen]).toEqual([n0 + 3]);
  const picked = await page.evaluate(
    (k) => window.__pwToasts.slice(k).map((t) => t.text).filter((t) => t.startsWith("Picked ")),
    before,
  );
  expect(picked.length, `vote toasts shown after the third pick: ${JSON.stringify(picked)}`).toBeGreaterThan(0);
  expect(new Set(picked)).toEqual(new Set([third]));
  // …and the log has all three: the engine's own count agrees with PICKS.
  await expect.poll(() => page.evaluate(() => window.__pwLast.status && window.__pwLast.status.status.observations)).toBe(n0 + 3);

  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("the sixth pick always redraws the taste map, even after agreeable picks", async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors = await boot(page);
  await toEvolve(page);
  const chooseA = page.locator("#choose-a");
  const mid = page.locator("#duel-mid");

  // Picks that agree with the model: its own forecast for the pair on the
  // cards decides the side. Picks like these are the ones that leave the
  // importance weights uncollapsed — `needs_refit` false — which is when the
  // refit used to be skipped. Whether they do is the posterior's business
  // (in one seeded run the weights collapsed at the fifth pick anyway), so
  // the second cycle also has every status say `needs_refit: false`: the
  // exact condition under which the meter used to count down to nothing.
  async function agreeablePick() {
    await expect(chooseA).toBeEnabled({ timeout: 30_000 });
    const [a, b] = await cardIds(page);
    const asked = await count(page, "duel_pred");
    await post(page, { type: "duel_pred", a, b, choseA: true });
    await expect.poll(() => count(page, "duel_pred")).toBeGreaterThan(asked);
    const p = await page.evaluate(() => window.__pwLast.duel_pred.pred);
    await page.locator(p >= 0.5 || p == null || p < 0 ? "#choose-a" : "#choose-b").click();
    await page.waitForTimeout(400);
  }

  for (let cycle = 1; cycle <= 2; cycle++) {
    if (cycle === 2) await page.evaluate(() => { window.__pwNoRefit = true; });
    const fits = await count(page, "sent:fit");
    const logFrom = await page.evaluate(() => window.__pwLog.length);
    for (let i = 1; i <= 6; i++) {
      await agreeablePick();
      if (i < 6) {
        await expect(page.locator("#teach-pips i.lit")).toHaveCount(i);
        const left = 6 - i;
        await expect(page.locator("#teach-copy")).toContainText(`${left} more pick${left > 1 ? "s" : ""}`);
      }
    }
    // The meter keeps its word: it says the refit is coming, a fit goes out
    // once the sixth pick's undo window closes, and "it just learned" plays
    // when the fit has landed (evolve_truth.spec.js pins the order).
    await expect(mid).toHaveClass(/\blearning\b/);
    await expect(page.locator("#teach-copy")).toContainText("learning from your last 6 picks");
    await expect.poll(() => count(page, "sent:fit"), { timeout: 20_000 }).toBeGreaterThan(fits);
    const refit = await page.evaluate((k) => window.__pwLog.slice(k).filter((e) => e.type === "status").map((e) => e.needs_refit), logFrom);
    test.info().annotations.push({ type: `cycle ${cycle} needs_refit before the fit`, description: JSON.stringify(refit) });
    console.log(`cycle ${cycle}: needs_refit as each pick landed ${JSON.stringify(refit)}`);
    // Wait for it to land before the next cycle, so the next six start clean.
    await expect.poll(() => count(page, "fitted"), { timeout: 120_000 }).toBeGreaterThanOrEqual(cycle);
    await expect(page.locator("#teach-copy")).toContainText("it just learned", { timeout: 5_000 });
    await expect(mid).not.toHaveClass(/\blearning\b/);
    // The row stays full beside "it just learned" until the next pick starts
    // the next one.
    await expect(page.locator("#teach-pips i.lit")).toHaveCount(6);
    if (cycle === 2) {
      // Every pick after the first refit answers with the ratings it left
      // (`WasmEngine::belief`): every member's numbers, the ten seeds of the
      // next generation and the ten members it may replace. The numbers move
      // with each pick, with no refit between the first five.
      const picked = (k) => window.__pwLog.slice(k).filter((e) => e.type === "status" && e.vote);
      await expect.poll(() => page.evaluate(picked, logFrom).then((p) => p.length)).toBe(6);
      const replies = await page.evaluate(picked, logFrom);
      for (const e of replies) {
        expect(e.ratings, "a pick's reply carried no ratings").not.toBeNull();
        expect(e.ratings.rows).toBe(e.pool);
        expect(e.ratings.seeds).toBe(10);
        expect(e.ratings.may).toBe(Math.min(10, Math.max(0, e.pool + 10 - e.target))); // fewer while the pool fills
      }
      expect(new Set(replies.map((e) => e.ratings.sum)).size, `the ratings did not move per pick: ${JSON.stringify(replies.map((e) => [e.pair, e.ess, e.ratings.sum]))}`).toBe(6);
    }
  }
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("◇ states the dealing rule steadily: every pair under the default, a check only under a choosing rule", async ({ page }) => {
  const pageErrors = await boot(page);
  await toEvolve(page);
  const rule = page.locator("#duel-rule");
  const pred = page.locator("#duel-pred");
  const RANDOM = "◇ random pair · a fair test";
  await expect(rule).toHaveText(RANDOM);
  expect(await rule.getAttribute("title")).toContain("every pair is dealt at random");
  expect(await rule.getAttribute("title")).not.toContain("one pair in ten");

  // Through votes and skips it holds its place — on the deal after a vote
  // too, where the old mark was never drawn.
  for (let i = 0; i < 6; i++) {
    await expect(page.locator("#choose-a")).toBeEnabled();
    await page.locator("#choose-a").click();
    await expect(page.locator("#choose-a")).toBeEnabled();
    await expect(rule).toHaveText(RANDOM);
  }
  await page.locator("#skip-duel").click();
  await expect(page.locator("#choose-a")).toBeEnabled();
  await expect(rule).toHaveText(RANDOM);

  // Once there is a model to forecast with (the sixth pick fitted one), the
  // forecast after a vote is readable on its own line, beside the rule.
  await expect.poll(() => count(page, "fitted"), { timeout: 120_000 }).toBeGreaterThan(0);
  await expect(page.locator("#choose-a")).toBeEnabled();
  await page.locator("#choose-a").click();
  // In the model's voice: the side it guessed, its probability, and a word.
  await expect(pred).toHaveText(/^it guessed (this|the other) · \d+% · (a hunch|leaning|fairly sure)$/, { timeout: 5_000 });
  await expect(rule).toHaveText(RANDOM);

  // The engine tags every tenth pair "check" under Random too, though it is
  // drawn like the rest: it must not read as a change of rule.
  //
  // A pair reaches the table the way the engine deals it: one is up and the
  // next is already dealt, waiting. So the deals from here on are tagged with
  // the rule under test, and the pair is skipped until one dealt since is up:
  // the first skip puts up the pair dealt before, the second one dealt after.
  const deal = async (method) => {
    await page.evaluate((m) => {
      window.__pwDealMeta = { info_gain: 0, random_check: m !== "bald", method: m };
    }, method);
    for (let i = 0; i < 3; i++) {
      await expect(page.locator("#skip-duel")).toBeEnabled({ timeout: 30_000 });
      await page.locator("#skip-duel").click();
    }
    await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 30_000 });
  };
  await deal("check");
  await expect(rule).toHaveText(RANDOM);
  await expect(rule).not.toHaveClass(/\bcheck\b/);

  // Under a choosing rule, the one-in-ten mark means what it says.
  await deal("bald");
  await expect(rule).toHaveText("chosen where it’s least sure");
  await deal("check");
  await expect(rule).toHaveText("◇ fair test · dealt at random");
  await expect(rule).toHaveClass(/\bcheck\b/);
  expect(await rule.getAttribute("title")).toContain("one pair in ten");

  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("a bank row's ▶ lights while it plays and stops on a second press; ▶ SAMPLE too", async ({ page }) => {
  const pageErrors = await boot(page);
  await toEvolve(page);
  const hear = page.locator("#bank-list .bank-item .bi-hear").first();
  const lit = page.locator("#bank-list .bi-hear.playing");
  // A row's ▶ is among the actions it shows when pointed at.
  const first = page.locator("#bank-list .bank-item[data-id]").first();

  await first.hover();
  await hear.click();
  await expect(lit).toHaveCount(1, { timeout: 30_000 });
  // A rating re-renders the bank; the row that is playing still says so.
  // (the second row, from the keyboard: the list focused, ↓ ↓, then 4)
  await page.locator("#bank-list").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("4");
  await expect(page.locator("#bank-list .bank-item").nth(1).locator(".bi-star")).toHaveAttribute("aria-pressed", "true");
  await expect(lit).toHaveCount(1);
  await expect(page.locator("#bank-list .bank-item").first().locator(".bi-hear")).toHaveClass(/\bplaying\b/);
  // Pressed again, it stops — it does not start the phrase over.
  await first.hover();
  await page.locator("#bank-list .bank-item .bi-hear").first().click();
  await expect(lit).toHaveCount(0, { timeout: 1_000 });

  // Played to its end, it goes dark by itself.
  await first.hover();
  await page.locator("#bank-list .bank-item .bi-hear").first().click();
  await expect(lit).toHaveCount(1, { timeout: 15_000 });
  await expect(lit).toHaveCount(0, { timeout: 15_000 });

  // ▶ SAMPLE: the same transport.
  const sample = page.locator("#play-a");
  await sample.click();
  await expect(sample).toHaveClass(/\bplaying\b/, { timeout: 30_000 });
  await sample.click();
  await expect(sample).not.toHaveClass(/\bplaying\b/, { timeout: 1_000 });

  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("the warm start's result replaces its loading toast when it lands", async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors = await boot(page, { warmed: false });
  await expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout: 60_000 });
  const cards = page.locator(".warm-cell .warm-item");
  for (const i of [0, 3, 6]) await cards.nth(i).click();
  await page.locator("#warm-go").click();
  // The loading toast, or already the result in its place: on a quick
  // machine the teaching lands before this line looks.
  await expect(page.locator("#toasts .toast-msg")).toContainText(/Opening those|Your three taught it/, { timeout: 5_000 });
  await page.waitForFunction(() => window.__pwLast.warm_done, null, { timeout: 180_000 });
  // On screen within a beat of the reply, in the loading toast's place.
  const lane = page.locator("#toasts .toast-msg");
  await expect(lane).toContainText("Your three taught it 18 picks", { timeout: 1_500 });
  await expect(page.locator("#toasts .toast", { hasText: "Opening those" })).toHaveCount(0);
  expect(await picks(page)).toBe(18);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});
