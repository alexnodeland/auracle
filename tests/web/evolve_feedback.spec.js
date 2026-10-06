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
// The engine's replies are read and amended through the fixture's tap
// (fixtures.js). Sessions are seeded (the films' own Math.random), so the
// pool and the sides are the same run to run.
const { test, expect, goLevel } = require("./fixtures");

// Every phrase that starts sounding, how long it is, and when something
// stopped it (its source's stop()): what a player hears from a ▶, and what a
// ▶ pressed again does to it.
const SOURCES = `(() => {
  const src = (window.__pwSources = []);
  const P = AudioBufferSourceNode.prototype;
  const start = P.start;
  const stop = P.stop;
  P.start = function (...a) {
    this.__pwN = src.length;
    src.push({ at: performance.now(), ms: this.buffer ? this.buffer.duration * 1000 : 0, stopped: null });
    return start.apply(this, a);
  };
  P.stop = function (...a) {
    const s = src[this.__pwN];
    if (s && s.stopped == null) s.stopped = performance.now();
    return stop.apply(this, a);
  };
})();`;

async function boot(page, app, opts = {}) {
  await page.addInitScript(SOURCES);
  await app.boot({ random: 20260927, ...opts });
}

const picks = async (page) => Number(await page.locator("#duel-count").textContent());
/** The names on the cards, as the toast will say them. */
const cardNames = (page) =>
  page.evaluate(() => ["a", "b"].map((s) => document.getElementById(`name-${s}`).firstChild.textContent.trim()));
/** The ids on the cards, in the order they are shown. */
const cardIds = (page) =>
  page.evaluate(() => ["a", "b"].map((s) => Number(document.querySelector(`#name-${s} .dn-id`).textContent.replace("#", ""))));
const pairKey = (ids) => [...ids].sort((x, y) => x - y).join();
const sources = (page) => page.evaluate(() => window.__pwSources.slice());
// A second press stops the phrase at once: its light goes out well inside
// what is left of the phrase, which runs seconds.
const STOP_MS = 2_500;

/** Press a ▶ whose phrase is sounding, and require that the press stopped
 *  it: the source playing was stopped (not left to end), its light went out
 *  within STOP_MS, and no phrase started over. */
async function pressStops(page, app, what, press, dark) {
  const before = await sources(page);
  const playing = before.length - 1;
  const at = await app.now();
  await press();
  await dark(STOP_MS);
  await expect
    .poll(async () => (await sources(page))[playing].stopped, { timeout: STOP_MS, message: `the second press on ${what} did not stop its phrase` })
    .not.toBeNull();
  const after = await sources(page);
  expect(after.length, `the second press started ${what} over`).toBe(before.length);
  const left = before[playing].at + before[playing].ms - at;
  const said = `${what}: stopped ${Math.round(after[playing].stopped - at)} ms after the press, with ${Math.round(left)} ms of the phrase left`;
  console.log(said);
  // On a runner slow enough to leave less of the phrase than the bound, the
  // light alone proves nothing, and the stop() above is the proof.
  if (left <= STOP_MS) test.info().annotations.push({ type: "short phrase left", description: said });
}

async function toEvolve(page, app) {
  await app.reply("duel", { where: { pair: true }, timeout: 60_000 });
  await goLevel(page, "evolve");
  await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 30_000 });
  // The names are painted from the bank's rows; wait for real ones.
  await app.engine((timeout) => expect(page.locator("#name-a .dn-id")).toBeAttached({ timeout }), { ms: 30_000 });
}

// "Three picks a second and a half apart": the pace the films found the
// lane naming the first pick six seconds after the third.
const PICK_GAP_MS = 1_500;

test("TAUGHT counts a pick at once, ⌘Z takes it back, and the lane names the latest pick", async ({ page, app }) => {
  await boot(page, app);
  await toEvolve(page, app);
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
    if (i === 2) await app.engine((timeout) => expect.poll(async () => (await cardNames(page)).some((n) => /^#\d+$/.test(n)), { timeout }).toBe(false), { ms: 60_000 });
    const [a, b] = await cardNames(page);
    if (i === 2) {
      third = `Picked ${a} over ${b}.`;
      before = await app.toastMark();
      // From the third pick on, every value PICKS takes, as it takes it.
      await page.evaluate(() => {
        const el = document.getElementById("duel-count");
        window.__pwCounted = [];
        new MutationObserver(() => window.__pwCounted.push(el.textContent)).observe(el, { childList: true, subtree: true, characterData: true });
      });
    }
    await chooseA.click();
    expect(await picks(page)).toBe(n0 + i + 1);
    if (i < 2) await page.waitForTimeout(PICK_GAP_MS);
  }
  // Until the third pick's window closes and it commits (the engine's own
  // count has all three), PICKS must never dip while a pick moves from
  // "waiting" to "in the log": every value it took since the third pick.
  // eslint-disable-next-line playwright/no-useless-await -- app.last is the tap's (a promise), not Locator.last()
  await app.engine((timeout) => expect.poll(async () => ((await app.last("status")) || { status: {} }).status.observations, { timeout }).toBe(n0 + 3), { ms: 30_000 });
  const counted = await page.evaluate(() => window.__pwCounted.map(Number));
  expect([...new Set([...counted, await picks(page)])]).toEqual([n0 + 3]);
  const picked = (await app.toasts(before)).filter((t) => t.startsWith("Picked "));
  expect(picked.length, `vote toasts shown after the third pick: ${JSON.stringify(picked)}`).toBeGreaterThan(0);
  expect(new Set(picked)).toEqual(new Set([third]));
});

test("the sixth pick always redraws the taste map, even after agreeable picks", async ({ page, app }) => {
  await boot(page, app);
  await toEvolve(page, app);
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
    await app.engine((timeout) => expect(chooseA).toBeEnabled({ timeout }), { ms: 30_000 });
    const [a, b] = await cardIds(page);
    const asked = await app.now();
    await app.post({ type: "duel_pred", a, b, choseA: true });
    const p = (await app.reply("duel_pred", { after: asked, where: { a, b }, timeout: 30_000 })).pred;
    await page.locator(p >= 0.5 || p == null || p < 0 ? "#choose-a" : "#choose-b").click();
    // The next pair is up before the next forecast is asked for.
    await app.engine((timeout) => expect.poll(async () => pairKey(await cardIds(page)), { timeout }).not.toBe(pairKey([a, b])), { ms: 30_000 });
  }

  /** The `status` replies after `t`, with the ratings each carried kept as
   *  their shape and a checksum of their numbers. Not the sum of the means:
   *  φ is standardized over the pool, so with one lens that sum can be zero
   *  up to rounding whatever the posterior. */
  const statuses = async (t) => (await app.replies("status", { after: t })).map((d) => {
    const b = d.ratings;
    return {
      needs_refit: d.status && d.status.needs_refit,
      pool: d.status && d.status.pool,
      target: d.status && d.status.pool_target,
      vote: !!d.vote,
      ratings: b ? { rows: b.ranked.length, seeds: b.seeds.length, may: b.may_replace.length, sum: b.ranked.reduce((s, r) => s + r.mean * r.mean + r.std, 0) } : null,
      ess: d.status && d.status.ess,
      pair: d.vote && d.vote.a != null ? [d.vote.a, d.vote.b] : null,
    };
  });

  for (let cycle = 1; cycle <= 2; cycle++) {
    // The engine reporting its importance weights intact (read by main as
    // the tap leaves it), which is the case the refit used to skip.
    if (cycle === 2) await app.amend({ status: true }, { "status.needs_refit": false });
    const fits = await app.sentCount("fit");
    const fitted = await app.count("fitted");
    const logFrom = await app.now();
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
    await expect.poll(() => app.sentCount("fit"), { timeout: 20_000 }).toBeGreaterThan(fits);
    const refit = (await statuses(logFrom)).map((e) => e.needs_refit);
    test.info().annotations.push({ type: `cycle ${cycle} needs_refit before the fit`, description: JSON.stringify(refit) });
    console.log(`cycle ${cycle}: needs_refit as each pick landed ${JSON.stringify(refit)}`);
    // Wait for it to land before the next cycle, so the next six start clean.
    await app.engine((timeout) => expect.poll(() => app.count("fitted"), { timeout }).toBeGreaterThan(fitted));
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
      const picked = async () => (await statuses(logFrom)).filter((e) => e.vote);
      await expect.poll(async () => (await picked()).length).toBe(6);
      const replies = await picked();
      for (const e of replies) {
        expect(e.ratings, "a pick's reply carried no ratings").not.toBeNull();
        expect(e.ratings.rows).toBe(e.pool);
        expect(e.ratings.seeds).toBe(10);
        expect(e.ratings.may).toBe(Math.min(10, Math.max(0, e.pool + 10 - e.target))); // fewer while the pool fills
      }
      expect(new Set(replies.map((e) => e.ratings.sum)).size, `the ratings did not move per pick: ${JSON.stringify(replies.map((e) => [e.pair, e.ess, e.ratings.sum]))}`).toBe(6);
    }
  }
});

test("◇ states the dealing rule steadily: every pair under the default, a check only under a choosing rule", async ({ page, app }) => {
  await boot(page, app);
  await toEvolve(page, app);
  const rule = page.locator("#duel-rule");
  const pred = page.locator("#duel-pred");
  const RANDOM = "◇ random pair · a fair test";
  await expect(rule).toHaveText(RANDOM);
  expect(await rule.getAttribute("title")).toContain("every pair is dealt at random");

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
  await app.reply("fitted");
  await expect(page.locator("#choose-a")).toBeEnabled();
  await page.locator("#choose-a").click();
  // In the model's voice: the side it guessed, its probability, and a word.
  await expect(pred).toHaveText(/^it guessed (this|the other) · \d+% · (a hunch|leaning|fairly sure)$/, { timeout: 5_000 });
  await expect(rule).toHaveText(RANDOM);
  // The default's line is never a check's.
  await expect(rule).not.toHaveClass(/\bcheck\b/);

  // Under Random the engine says "random" of every pair (auracle-session's
  // the_default_rule_deals_every_pair_at_random_and_says_so pins it), so the
  // rules that choose are injected here. Which words each rule gets, and
  // that a "check" reaching the page under Random reads as Random, are
  // words.js's (`dealRule`, apps/web/tests/words.test.mjs); here, that a
  // deal's rule reaches the line, and a check its mark.
  //
  // A pair reaches the table the way the engine deals it: one is up and the
  // next is already dealt, waiting. So the deals from here on are tagged with
  // the rule under test, and the pair is skipped until one dealt since is up:
  // the first skip puts up the pair dealt before, the second one dealt after.
  const deal = async (method) => {
    await app.unamend();
    await app.amend({ type: "duel", meta: true }, { "meta.info_gain": 0, "meta.random_check": method !== "bald", "meta.method": method });
    for (let i = 0; i < 3; i++) {
      await app.engine((timeout) => expect(page.locator("#skip-duel")).toBeEnabled({ timeout }), { ms: 30_000 });
      await page.locator("#skip-duel").click();
    }
    await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 30_000 });
  };
  // Under a choosing rule, the one-in-ten mark means what it says.
  await deal("bald");
  await expect(rule).toHaveText("chosen where it’s least sure");
  await deal("check");
  await expect(rule).toHaveText("◇ fair test · dealt at random");
  await expect(rule).toHaveClass(/\bcheck\b/);
});

test("a bank row's ▶ lights while it plays and stops on a second press; ▶ SAMPLE too", async ({ page, app }) => {
  await boot(page, app);
  await toEvolve(page, app);
  const hear = page.locator("#bank-list .bank-item .bi-hear").first();
  const lit = page.locator("#bank-list .bi-hear.playing");
  // A row's ▶ is among the actions it shows when pointed at.
  const first = page.locator("#bank-list .bank-item[data-id]").first();

  await first.hover();
  await hear.click();
  await app.engine((timeout) => expect(lit).toHaveCount(1, { timeout }), { ms: 30_000 });
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
  await pressStops(page, app, "a row's ▶",
    () => page.locator("#bank-list .bank-item .bi-hear").first().click(),
    (timeout) => expect(lit).toHaveCount(0, { timeout }));

  // Played to its end, it goes dark by itself.
  await first.hover();
  await page.locator("#bank-list .bank-item .bi-hear").first().click();
  await expect(lit).toHaveCount(1, { timeout: 15_000 });
  await expect(lit).toHaveCount(0, { timeout: 15_000 });

  // ▶ SAMPLE: the same transport.
  const sample = page.locator("#play-a");
  await sample.click();
  await app.engine((timeout) => expect(sample).toHaveClass(/\bplaying\b/, { timeout }), { ms: 30_000 });
  await pressStops(page, app, "▶ SAMPLE", () => sample.click(),
    (timeout) => expect(sample).not.toHaveClass(/\bplaying\b/, { timeout }));
});

test("the warm start's result replaces its loading toast when it lands", async ({ page, app }) => {
  await boot(page, app, { warmed: false });
  await app.engine((timeout) => expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout }), { ms: 60_000 });
  const cards = page.locator(".warm-cell .warm-item");
  for (const i of [0, 3, 6]) await cards.nth(i).click();
  await page.locator("#warm-go").click();
  // The loading toast, or already the result in its place: on a quick
  // machine the teaching lands before this line looks.
  await expect(page.locator("#toasts .toast-msg")).toContainText(/Opening those|Your three taught it/, { timeout: 5_000 });
  await app.reply("warm_done", { timeout: 180_000 });
  // On screen within a beat of the reply, in the loading toast's place.
  const lane = page.locator("#toasts .toast-msg");
  await expect(lane).toContainText("Your three taught it 18 picks", { timeout: 1_500 });
  await expect(page.locator("#toasts .toast", { hasText: "Opening those" })).toHaveCount(0);
  expect(await picks(page)).toBe(18);
});
