// EVOLVE: the next pair is already waiting.
//
// A pick used to put the pair away and wait for the engine to deal the next
// (about 30 ms on a quiet engine, a whole seed's walk during a generation),
// and then for its two sounds to render. Now, while a pair is on the table,
// the next is dealt and both its sounds fetched; a pick or ↻ puts it up at
// once, and the one after is dealt behind it. A pick taken back puts its pair
// back, and the pair that replaced it is the next (or, when the table was
// still waiting on a deal, that deal), with the deal behind it, if one was
// asked for, after it; a patch cut meanwhile is never put up.
//
// Pairs go up in the order the engine dealt them, whatever the timing. A pick
// made while the next deal is still out (a generation holds deals behind the
// seed being bred) used to ask for a second deal, keep the first answer as
// "the next" and put the second up: the table ran P, R, Q instead of P, Q, R,
// so when an answer landed changed what a seeded session showed. A pick
// taken back used to throw away the deal behind the pair it put back, when
// that deal had been asked for, so how long that pair's sounds took changed
// the pair after it (#211, the last tests here). A session with a seed in
// the address deals by the fill's schedule, so its deals don't depend on how
// far the fill has got (evolve_seeded_deals.spec.js). These tests boot with
// `random` alone, so they are not: they deal at once from what has arrived.
//
// "At once" is the app's own order, not a time (ADR-022): the cards show the
// next pair, live, before the click's own task ends (`placePair` is
// synchronous), and no deal for the table is asked for between the click and
// the cards changing. How many milliseconds that took is a budget: 0.3 s for
// the pair, 0.15 s for its ▶ (budgets.spec.js holds the same two).
//
// The engine worker is reached through the fixture's tap (fixtures.js), to
// see which deals were asked for ahead, and to hold what the engine says
// while a deal is out. The page's random draws are seeded (`random`); the
// engine's deals are not (no seed in the address).
const { test, expect, goLevel } = require("./fixtures");

const AHEAD = { type: "duel", ahead: true };

async function boot(page, app) {
  await app.boot({ random: 20260928 });
  await goLevel(page, "evolve");
  await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 60_000 });
}

const cardIds = (page) =>
  page.evaluate(() => ["a", "b"].map((s) => Number(document.querySelector(`#name-${s} .dn-id`).textContent.replace("#", ""))));
/** The pairs dealt ahead, in the order main heard them. */
const aheadPairs = async (app) => (await app.replies("duel", { where: { ahead: true, pair: true } })).map((d) => d.pair);
const aheadCount = async (app) => (await aheadPairs(app)).length;
/** Every deal asked for and answered after `after`, in order:
 *  [sent|got, ahead?, pair, t]. */
const deals = async (app, after) => {
  const sent = (await app.sent("duel", { after })).map((m) => ["sent", !!m.ahead, null, m._at]);
  const got = (await app.replies("duel", { after })).map((d) => ["got", !!d.ahead, d.pair, d._at]);
  return sent.concat(got).sort((a, b) => a[3] - b[3]);
};
/** Both sounds of a pair fetched: a render of each has come back (the page
 *  asks only for a sound it has not heard). */
const heardAll = async (app, pair) => {
  const heard = new Set((await app.replies("render")).map((r) => r.id));
  return pair.every((id) => heard.has(id));
};
const soundsHeard = (app, pair) =>
  app.engine((timeout) => expect.poll(() => heardAll(app, pair), { timeout }).toBe(true), { ms: 60_000 });
/** The `n`th pair dealt ahead (or a later one) is waiting with its sounds:
 *  it has landed, no deal is still out, and both sounds of the last one are
 *  here. Not just the `n`th landed: an answer refused is dealt again, and a
 *  swap with a deal still out waits for that deal. Call it with no hold
 *  standing: a held reply is not counted. */
async function aheadReady(app, n = 1) {
  await app.engine((timeout) => expect.poll(async () => {
    const pairs = await aheadPairs(app);
    const out = (await app.sentCount("duel")) - (await app.count("duel"));
    return pairs.length >= n && out === 0 && heardAll(app, pairs[pairs.length - 1]);
  }, { timeout }).toBe(true), { ms: 60_000 });
}

/** Click a card's control in the page. Returns `sync`: whether the cards
 *  showed another pair, live, before the click's own task ended (read as
 *  `click()` returns, before anything else can run); `between`: every request
 *  the page posted from the click until the cards changed, in order, as
 *  [type, ahead]; and `ms`, how long that took in the page's clock. */
async function pickAndTime(page, sel) {
  return page.evaluate(async (sel) => {
    const ids = () => ["a", "b"].map((s) => document.querySelector(`#name-${s} .dn-id`)?.textContent).join();
    const before = ids();
    const changed = () => ids() !== before && !document.querySelector("#choose-a").disabled;
    const sent = window.__tap.sent;
    const n0 = sent.length;
    const t0 = performance.now();
    document.querySelector(sel).click();
    const sync = changed();
    for (;;) {
      if (changed()) return { sync, ms: performance.now() - t0, between: sent.slice(n0).map((q) => [q.type, !!q.m.ahead]) };
      if (performance.now() - t0 > 60_000) return { sync, ms: Infinity, between: sent.slice(n0).map((q) => [q.type, !!q.m.ahead]) };
      await new Promise((r) => setTimeout(r, 2));
    }
  }, sel);
}

/** A pick or ↻ put the pair dealt ahead up at once: in the click's own task,
 *  with no deal for the table asked for before the cards changed. The time
 *  it took is a budget (ADR-022). */
function expectAtOnce(app, r, what) {
  expect(r.sync, `${what}: the next pair went up in the click's own task`).toBe(true);
  expect(r.between.filter(([type, ahead]) => type === "duel" && !ahead), `${what}: a deal for the table was asked for before the cards changed`).toEqual([]);
  app.budget(`${what}: the click → the next pair on the table`, r.ms, 300);
}

test("a pick puts the pair dealt ahead on the table at once, sounds and all", async ({ page, app }) => {
  await boot(page, app);
  // A pair dealt ahead, and its sounds fetched.
  await aheadReady(app);
  const before = await cardIds(page);
  const mark = await app.now();

  const r = await pickAndTime(page, "#choose-a");
  console.log(`pick → next pair on the table: ${r.ms.toFixed(0)} ms, in the click's task: ${r.sync}`);
  const now = await cardIds(page);
  const all = await deals(app);
  console.log(`deals: ${JSON.stringify(all.map(([k, a, p]) => [k, a ? "ahead" : "table", p]))}`);
  expectAtOnce(app, r, "a pick");
  // It was a pair dealt ahead, and no deal for the table was asked for.
  expect((await aheadPairs(app)).map((p) => [...p].sort().join())).toContain([...now].sort().join());
  expect((await deals(app, mark)).filter(([k, a]) => k === "sent" && !a), "a deal was asked for after the pick").toEqual([]);
  expect(now).not.toEqual(before);
  // Its sound is here: ▶ SAMPLE sounds in the click's own task, and asks for
  // no render.
  const play = await page.evaluate(async () => {
    const b = document.querySelector("#play-a");
    const sent = window.__tap.sent;
    const n0 = sent.length;
    const t0 = performance.now();
    b.click();
    const sync = b.classList.contains("playing");
    for (;;) {
      if (b.classList.contains("playing")) return { sync, ms: performance.now() - t0, renders: sent.slice(n0).filter((q) => q.type === "render").length };
      if (performance.now() - t0 > 30_000) return { sync, ms: Infinity, renders: sent.slice(n0).filter((q) => q.type === "render").length };
      await new Promise((r) => setTimeout(r, 2));
    }
  });
  console.log(`▶ SAMPLE on the pair dealt ahead: ${play.ms.toFixed(0)} ms, in the click's task: ${play.sync}`);
  expect(play.sync, "▶ SAMPLE sounds in the click's own task").toBe(true);
  expect(play.renders, "▶ SAMPLE asked for a render: its sound was not here").toBe(0);
  app.budget("▶ SAMPLE on the pair dealt ahead → sounding", play.ms, 150);
  await page.locator("#play-a").click(); // stop it

  // Taken back: the pick's pair returns, and the one it brought up waits,
  // with the pair dealt behind it after it.
  await page.keyboard.press("Control+z");
  await expect.poll(async () => [...(await cardIds(page))].sort().join()).toBe([...before].sort().join());
  expectAtOnce(app, await pickAndTime(page, "#choose-b"), "a pick after ⌘Z");
  expect([...(await cardIds(page))].sort()).toEqual([...now].sort());

  // ↻ swaps too: the pair dealt behind it, kept through the take-back.
  await aheadReady(app, 2);
  const skip = await pickAndTime(page, "#skip-duel");
  console.log(`another pair ↻: ${skip.ms.toFixed(0)} ms, in the click's task: ${skip.sync}`);
  expectAtOnce(app, skip, "↻");
});

test("a patch cut while its pair waits ahead is never put up", async ({ page, app }) => {
  await boot(page, app);
  await app.engine((timeout) => expect.poll(() => aheadCount(app), { timeout }).toBeGreaterThanOrEqual(1), { ms: 60_000 });
  const [cut] = (await aheadPairs(app)).pop();
  const row = page.locator(`#bank-list .bank-item[data-id="${cut}"]`);
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  await row.locator(".bi-kill").click();
  await expect(row).toHaveCount(0);
  for (let i = 0; i < 4; i++) {
    await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 30_000 });
    await page.locator("#choose-a").click();
    await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 30_000 });
    expect(await cardIds(page), "a cut patch was dealt from ahead").not.toContain(cut);
  }
});

/** The pair on the table, sorted, as a string (sides are shuffled). */
const tableKey = async (page) => [...(await cardIds(page))].sort((x, y) => x - y).join();
const key = (p) => [...p].sort((x, y) => x - y).join();

// Which pair a deal returns depends on the pool when it is dealt, and the
// pool is still filling while these tests deal (no seed in the address, so
// no schedule), so it depends on the machine's speed: the same deal came
// back [3,6] on one CI run, [3,12] on another and [3,7], the pair just put on
// the table, on a third. An answer main may not put up (deal.js `usable`:
// the pair on the table, the pair just put away, the pick held in its undo
// window) is dealt again, one deal per refused answer, by design. So "the
// pair dealt next" is the first answer main may put up: the order holds, and
// a refused answer is skipped.
/** Index of the first pair in `pairs`, from `from`, whose key is none of
 *  `refused`; -1 if there is none yet. */
const firstUsable = (pairs, refused, from = 0) => {
  for (let i = from; i < pairs.length; i++) if (!refused.includes(key(pairs[i]))) return i;
  return -1;
};

test("pairs go up in the order they were dealt when a pick lands while the next deal is out", async ({ page, app }) => {
  await boot(page, app);
  await aheadReady(app);

  // A pick puts the waiting pair up; the deal after it goes out, and what
  // the engine says from then on is held, in order, as it is while it
  // breeds a generation.
  await app.hold({}, { from: AHEAD });
  const mark = await app.now();
  expectAtOnce(app, await pickAndTime(page, "#choose-a"), "a pick");
  await expect.poll(() => app.holding()).toBe(true);
  // Picked again while that deal is out: the cards wait for it, and no
  // second deal is asked for meanwhile.
  const answered = await tableKey(page);
  await page.locator("#choose-b").click();
  await expect(page.locator("#choose-a")).toBeDisabled();
  await app.quiet();
  await app.release();
  await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 30_000 });
  const dealt = async () => (await deals(app, mark)).filter(([k, , p]) => k === "got" && p).map(([, , p]) => p);
  const first = await dealt();
  console.log(`dealt after the pick: ${JSON.stringify(first)}; on the table: ${await tableKey(page)}`);
  // The first pair dealt after the pick that may go up is the one on the
  // table (the pair just answered may not)…
  const up = firstUsable(first, [answered]);
  expect(up, "no answer main may put up").toBeGreaterThanOrEqual(0);
  expect(await tableKey(page)).toBe(key(first[up]));
  // …and nothing was dealt for the table on top of the deal already out:
  // none before its answer landed, and one for each answer refused.
  const since = await deals(app, mark);
  const firstGot = since.findIndex(([k, , p]) => k === "got" && p);
  const forTable = (from, to) => since.slice(from, to).filter(([k, a]) => k === "sent" && !a).length;
  expect(forTable(0, firstGot), "a second deal was asked for while one was out").toBe(0);
  expect(forTable(0), "a deal for the table that no refused answer asked for").toBe(up);

  // The next pick puts up the pair dealt after that one, at once.
  const refused = [key(first[up]), answered];
  await app.engine((timeout) => expect.poll(async () => firstUsable(await dealt(), refused, up + 1), { timeout }).toBeGreaterThan(up), { ms: 60_000 });
  const next = (await dealt())[firstUsable(await dealt(), refused, up + 1)];
  await soundsHeard(app, next);
  expectAtOnce(app, await pickAndTime(page, "#choose-a"), "the next pick");
  expect(await tableKey(page)).toBe(key(next));
});

test("a pick taken back while the next deal is out leaves that pair waiting as the next", async ({ page, app }) => {
  await boot(page, app);
  await aheadReady(app);
  const mark = await app.now();
  await app.hold({}, { from: AHEAD });
  expectAtOnce(app, await pickAndTime(page, "#choose-a"), "a pick");
  await expect.poll(() => app.holding()).toBe(true);
  const before = await tableKey(page);
  await page.locator("#choose-b").click();
  await expect(page.locator("#choose-a")).toBeDisabled();
  // Taken back: the pair returns, live, while the deal is still out.
  await page.keyboard.press("Control+z");
  await expect(page.locator("#choose-a")).toBeEnabled();
  expect(await tableKey(page)).toBe(before);
  await app.release();
  // The deal that was out is the next pair, sounds and all (or, if it came
  // back as the pair on the table, the answer main dealt again for it): the
  // next pick puts it up at once, without a deal.
  const got = async () => (await deals(app, mark)).filter(([k, , p]) => k === "got" && p).map(([, , p]) => p);
  await app.engine((timeout) => expect.poll(async () => firstUsable(await got(), [before]), { timeout }).toBeGreaterThanOrEqual(0), { ms: 60_000 });
  const next = (await got())[firstUsable(await got(), [before])];
  await soundsHeard(app, next);
  const pickMark = await app.now();
  expectAtOnce(app, await pickAndTime(page, "#choose-a"), "the pick after the deal landed");
  expect(await tableKey(page)).toBe(key(next));
  const sentForTable = (await deals(app, pickMark)).filter(([k, a]) => k === "sent" && !a).length;
  expect(sentForTable).toBe(0);
});

// A taken-back pick and the deal behind the pair it put back (#211). The
// probe: a seeded session (engine and page, 20260928), the pool filled, then
// pick, ⌘Z, pick, pick. P is on the table and Q waits as the next pair. The
// first pick puts Q up, and the deal behind Q (R) is asked for once Q's two
// sounds are here; ⌘Z puts P back with Q waiting again; the second pick puts
// Q up; the third puts up the pair after Q. Whether R was drawn before ⌘Z
// depends on how long Q's renders took, so the probe runs three ways: R
// landed before ⌘Z, R still out at ⌘Z (its answer held), and R not asked for
// before ⌘Z (Q's render replies held from the first deal ahead until after
// ⌘Z, as a worker busy elsewhere would). A take-back used to throw R away
// when it had been drawn, and the pair after Q was the next one dealt: the
// same seed and the same gestures showed a different pair after Q. Now R is
// kept as the pair after next, so the pair after Q is R in all three: the
// first pair dealt after the first pick that may go up (deal.test.mjs holds
// the same of every deal asked for, in both orders). The second gesture is a
// pick; ↻ there shows the same pairs in every order too, a deal behind Q
// being judged against the pick that put Q up (deal.test.mjs).
const PROBE_SEED = 20260928;
const nothing = async () => {};
/** Each order: what is held from boot (`hold`), what "P up and Q waiting"
 *  waits for (`ready`), what is held from the first pick (`arm`), what has
 *  happened to the deal behind Q by ⌘Z (`atUndo`), and whether it had been
 *  asked for by then (`asked`; an answer refused is dealt again, so how many
 *  were is not the point). */
const ORDERS = [
  {
    name: "landed before ⌘Z",
    hold: nothing,
    ready: (app) => aheadReady(app),
    arm: nothing,
    atUndo: (app, mark) => app.reply("duel", { where: { ahead: true }, after: mark, timeout: 30_000 }),
    asked: true,
  },
  {
    name: "still out at ⌘Z",
    hold: nothing,
    ready: (app) => aheadReady(app),
    arm: (app) => app.hold({ type: "duel" }, { from: AHEAD }),
    atUndo: (app) => expect.poll(async () => (await app.held()).map((h) => h.type)).toContain("duel"),
    asked: true,
  },
  {
    name: "not asked for before ⌘Z",
    hold: (app) => app.hold({ type: "render" }, { from: AHEAD }),
    ready: (app) => app.reply("duel", { where: { ahead: true, pair: true } }),
    arm: nothing,
    atUndo: nothing,
    asked: false,
  },
];
for (const order of ORDERS) {
  test(`a taken-back pick keeps the deal behind the pair it put back, so picking again shows the same pair after it however its renders were timed (the deal behind it ${order.name})`, async ({ page, app }) => {
    await order.hold(app);
    await app.boot({ seed: PROBE_SEED, random: PROBE_SEED });
    await app.filled();
    await goLevel(page, "evolve");
    // P on the table, Q dealt ahead (and, but for the held order, its sounds
    // here).
    await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 60_000 });
    await order.ready(app);
    const P = await tableKey(page);
    const Q = key((await aheadPairs(app)).pop());
    const mark = await app.now();

    await order.arm(app);
    await page.locator("#choose-a").click();
    await expect.poll(() => tableKey(page)).toBe(Q);
    await order.atUndo(app, mark);
    const askedBeforeUndo = (await app.sent(AHEAD, { after: mark })).length;
    await page.keyboard.press("Control+z");
    await expect.poll(() => tableKey(page)).toBe(P);
    await app.release();

    await page.locator("#choose-a").click();
    await expect.poll(() => tableKey(page)).toBe(Q);
    await page.locator("#choose-a").click();
    await app.engine((timeout) => expect.poll(() => tableKey(page), { timeout }).not.toBe(Q), { ms: 30_000 });
    await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 30_000 });
    const afterQ = await tableKey(page);

    const dealt = (await app.replies("duel", { after: mark, where: { pair: true } })).map((d) => d.pair);
    const behindQ = dealt[firstUsable(dealt, [P, Q])];
    console.log(`P ${P}, Q ${Q}; deals asked ahead before ⌘Z: ${askedBeforeUndo}; dealt after the first pick: ${JSON.stringify(dealt)}; after Q: ${afterQ}`);
    expect(askedBeforeUndo > 0, "the deal behind Q was asked for before ⌘Z, or not, as this order says").toBe(order.asked);
    expect(afterQ, "the pair after Q is not the deal behind Q").toBe(key(behindQ));
  });
}
