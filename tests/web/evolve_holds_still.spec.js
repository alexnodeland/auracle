// EVOLVE holds still under the hand (#312, ADR-025):
//
// - ⚡'s child opens itself on the bench only when the bench still holds its
//   seed, nothing was opened since the press, and nothing sounds. Over notes
//   held, or a sound opened since, it waits in the bank and the toast says
//   why, with OPEN IT, which opens it.
// - The engine holds the sounds on the table (#452): the pair up and the
//   pair of a pick still in its undo window (`on_table`). A sound opened
//   from PRESETS in the window replaces another sound than the one the pool
//   would have replaced first, a side of the pick, and the pick's vote is
//   sent and counted when the window closes. It used to be refused ("…was
//   replaced, so the pick wasn't recorded"), and TAUGHT went back down. The
//   pick's pair is let go after its vote, and ⌘Z and ↻ say what is up.
// - A side of the pair on the table that left the pool before the engine
//   heard the pair was up (a generation ending in that round trip) leaves
//   the pair standing: that side says it was replaced and goes quiet, and
//   the next pick says it taught nothing and puts up the next pair.
//
// The engine's own ⚡ answer is held (`app.hold`) and one is posted as the
// worker posts it (`app.inject`), with a child from the pool, so the test
// does not wait out a walk or depend on one breeding. The pair is read off
// the cards, and the generation's end is posted in the cards' own task.
// The pick held through a preset load is on a pair the test deals: the
// table's first deal is stalled (`app.stall`) and answered with the two
// sounds a load replaces first. A generation's end takes the same sound
// first and passes the table over the same way (`Engine::spared`; natively,
// `a_sound_on_the_table_is_not_replaced_until_it_is_put_away`), but it
// takes minutes and cannot be aimed.
const { test, expect, goLevel, bankTab } = require("./fixtures");

/** The pool sound on the bench, once one is. */
async function benchId(app) {
  let id = null;
  await app.engine((timeout) => expect.poll(async () => {
    // eslint-disable-next-line playwright/no-useless-await -- app.last is the tap's (a promise), not Locator.last()
    const b = await app.last("bench");
    return (id = b?.subject ?? null);
  }, { timeout }).not.toBeNull(), { ms: 60_000 });
  return id;
}

/** ⚡'s answer as the worker posts it: `childId` bred from `seedId`. */
async function zapLands(app, seedId, childId) {
  const s = await app.facts();
  await app.inject({ type: "evolved_from", seedId, childId, reason: null, views: s.views, status: s.status });
}

const opened = async (app, id, after) => (await app.sent({ type: "edit_begin", id }, { after })).length;

const sorted = (ids) => [...ids].sort((x, y) => x - y);
/** The sounds main last told the engine are on the table, sorted. */
const held = async (app) => sorted((await app.sent("on_table")).pop()?.ids ?? []);
const cards = (page) => page.evaluate(() => ["a", "b"].map((x) => Number(document.querySelector(`#name-${x} .dn-id`).textContent.replace("#", ""))));

test("⚡'s child opens itself only with nothing in the hand, and else says why with OPEN IT", async ({ page, app }) => {
  await app.boot({ random: 20260928, reuseRenders: true });
  await app.engine((timeout) => expect.poll(async () => ((await app.facts()).ranked || []).length, { timeout }).toBeGreaterThanOrEqual(40), { ms: 60_000 });
  await app.hold(["evolved_from", { views: true }]);
  await goLevel(page, "patch");
  await app.engine((timeout) => expect(page.locator("#rack-evolve")).toBeEnabled({ timeout }), { ms: 60_000 });
  const seed = await benchId(app);
  const pool = (await app.facts()).ranked.map((r) => r.id).filter((id) => id !== seed);
  await page.locator("#rack-evolve").click();
  await expect.poll(async () => (await app.sent({ type: "refine_from", id: seed })).length).toBe(1);
  await page.mouse.move(5, 5);

  // Nothing in the hand: the child opens itself.
  let t = await app.now();
  await zapLands(app, seed, pool[0]);
  await expect.poll(() => opened(app, pool[0], t), { message: "the child opened itself" }).toBe(1);
  await app.engine((timeout) => expect.poll(() => benchId(app), { timeout }).toBe(pool[0]), { ms: 60_000 });

  // A note held: the child waits, and the toast says why.
  await page.locator("#rack-svg").hover();
  await page.mouse.move(5, 5);
  let mark = await app.toastMark();
  t = await app.now();
  await page.keyboard.down("a");
  await zapLands(app, pool[0], pool[1]);
  // The clean case's "ready to play" can still be on its way into the
  // lane: this one is told by its own words.
  await app.toast(/^⚡ bred .*, and what you’re playing goes on\./, { since: mark });
  await page.keyboard.up("a");
  await app.quiet();
  expect(await opened(app, pool[1], t), "the child opened over a held note").toBe(0);

  // Another sound opened since: the child waits, OPEN IT opens it.
  await bankTab(page, "pool");
  await page.locator(`#bank-list .bank-item[data-id="${pool[2]}"] .bi-name`).click();
  await app.engine((timeout) => expect.poll(() => benchId(app), { timeout }).toBe(pool[2]), { ms: 60_000 });
  mark = await app.toastMark();
  t = await app.now();
  await zapLands(app, pool[0], pool[3]);
  const name = (await app.facts()).names[pool[2]];
  await app.toast(`, and ${name} is still the sound in hand.`, { since: mark });
  expect(await opened(app, pool[3], t), "the child opened over the sound opened since").toBe(0);
  await page.locator("#toasts .toast button", { hasText: /open it/i }).last().click();
  await expect.poll(() => opened(app, pool[3], t), { message: "OPEN IT opened the child" }).toBe(1);
});

test("a pick in its undo window is counted though a preset opened in the window would have replaced a side of it", async ({ page, app }) => {
  await app.stall({ type: "duel", ahead: false });
  await app.boot();
  await goLevel(page, "evolve");
  await app.filled();
  // The premise: no fit yet, so every sound rates the same, and a preset
  // load replaces the first sound in pool order it may: the ranked list's
  // first (its ties keep pool order).
  const { ranked } = await app.facts();
  expect(ranked.every((r) => r.mean === 0), "a fit has run").toBe(true);
  const pair = [ranked[0].id, ranked[1].id];
  const ask = await app.stalled();
  await app.inject({ type: "duel", pair, meta: { a: pair[0], b: pair[1], info_gain: 0, random_check: true, method: "random" }, ahead: false, re: ask.rid });
  await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 30_000 });
  await expect.poll(() => held(app), { message: "the pair up is held" }).toEqual(sorted(pair));

  // A pick, and a preset opened from the bank inside its window.
  const mark = await app.toastMark();
  const t = await app.now();
  await page.locator("#choose-a").click();
  await bankTab(page, "presets");
  await page.locator("#bank-list .preset-item").first().click();
  const loaded = await app.reply("preset_loaded", { after: t });
  const now = loaded.views.ranked.map((r) => r.id);
  expect(ranked.filter((r) => !now.includes(r.id)), "the preset replaced no sound").toHaveLength(1);
  expect(pair.filter((id) => !now.includes(id)), "the preset replaced a side of the pick").toEqual([]);

  // The window closes: the vote is sent once, recorded and counted.
  await app.engine((timeout) => expect.poll(async () => (await app.sent("record_duel", { after: t })).length, { timeout }).toBe(1), { ms: 30_000 });
  const [vote] = await app.sent("record_duel", { after: t });
  expect(sorted([vote.a, vote.b])).toEqual(sorted(pair));
  const [load] = await app.sent("load_preset", { after: t });
  expect(load._n, "the preset was opened after the window closed").toBeLessThan(vote._n);
  const answer = await app.replyTo(vote);
  expect(answer.recorded, "the engine refused the pick").toBe(true);
  await expect(page.locator("#duel-count")).toHaveText("1");
  expect((await app.toasts(mark)).filter((x) => /recorded/.test(x)), "a toast said the pick went nowhere").toEqual([]);
  // Held until its vote, and let go after it: with no pick held, what the
  // engine holds is the pair up (which may share a sound with the pick's).
  const told = await app.sent("on_table", { after: t });
  expect(told.filter((m) => m._n < vote._n).every((m) => pair.every((id) => m.ids.includes(id))), "let go before its vote").toBe(true);
  await expect.poll(async () => (await app.sent("on_table")).filter((m) => m._n > vote._n).length, { message: "never let go" }).toBeGreaterThan(0);
  await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 30_000 });
  await expect.poll(async () => (await held(app)).join(), { message: "the pair up, alone" }).toBe(sorted(await cards(page)).join());

  // A pick taken back holds its pair again as the pair up; ↻ puts it away,
  // and what is held is the pair that goes up in its place.
  const next = await cards(page);
  await page.locator("#choose-a").click();
  await expect.poll(async () => (await held(app)).filter((id) => next.includes(id)), { message: "the pick's pair held in its window" }).toEqual(sorted(next));
  await page.keyboard.press("Control+z");
  await expect.poll(() => cards(page)).toEqual(next);
  await expect.poll(() => held(app), { message: "⌘Z: the pick's pair, up again" }).toEqual(sorted(next));
  await page.locator("#skip-duel").click();
  await app.engine((timeout) => expect.poll(() => cards(page), { timeout }).not.toEqual(next), { ms: 30_000 });
  await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 30_000 });
  await expect.poll(async () => (await held(app)).join(), { message: "↻: the pair up in its place, alone" }).toBe(sorted(await cards(page)).join());
});

test("a side of the pair on the table that left the pool before the engine held it leaves the pair up, and the next pick deals the next", async ({ page, app }) => {
  await app.boot({ random: 20260928 });
  await goLevel(page, "evolve");
  await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 60_000 });
  // Only what the test posts changes the pool from here.
  await app.hold([{ views: true }, "refine_child", "refined"]);
  const ids = () => page.evaluate(() => ["a", "b"].map((x) => Number(document.querySelector(`#name-${x} .dn-id`).textContent.replace("#", ""))));
  // A pick, held in its undo window, and the next pair up.
  const first = await ids();
  await page.locator("#choose-a").click();
  await app.engine((timeout) => expect.poll(ids, { timeout }).not.toEqual(first), { ms: 30_000 });
  await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 30_000 });
  const s = await app.facts();
  const was = await page.evaluate((s) => {
    const ids = () => ["a", "b"].map((x) => Number(document.querySelector(`#name-${x} .dn-id`).textContent.replace("#", "")));
    const pair = ids();
    window.__tap.inject({
      type: "refined", views: { ...s.views, ranked: s.ranked.filter((r) => r.id !== pair[0]) },
      status: { ...s.status, generation: (s.status.generation || 0) + 1 }, born: [], retired: [pair[0]], reasons: [],
    });
    return { pair, now: ids(), gone: document.getElementById("duel-a").classList.contains("gone") };
  }, s);
  expect(was.now, "the pair on the table, as the generation ended").toEqual(was.pair);
  expect(was.gone).toBe(true);
  await expect(page.locator("#fam-a")).toHaveText("Replaced in the pool.");
  for (const id of ["#play-a", "#promote-a", "#flip-a", "#pd-a"]) await expect(page.locator(id), `${id} on the replaced side`).toBeDisabled();
  await expect(page.locator("#play-b")).toBeEnabled();
  await expect(page.locator("#choose-a")).toBeEnabled();
  // The table stays as it is while nothing is pressed.
  await app.quiet();
  expect(await ids()).toEqual(was.pair);
  // A pick on it commits the pick still in its window, as any pick does (its
  // vote goes in that task), teaches nothing itself (no forecast asked for
  // it), says so, and puts up the next pair. The earlier pick's vote is sent
  // exactly once by the end of this pick's task: by this pick, or by its
  // own window closing first on a slow runner (which this test can't hold
  // off), never lost and never twice.
  const mark = await app.toastMark();
  const t = await app.now();
  const sent = await page.evaluate(([a, b]) => {
    document.getElementById("choose-b").click();
    return window.__tap.sent.filter((x) => x.m.type === "record_duel" && x.m.a === a && x.m.b === b).length;
  }, first);
  expect(sent, "the pick in its window committed, once, by the end of this pick").toBe(1);
  await app.toast(/was replaced, so that pick taught nothing\. Here is the next pair\.$/, { since: mark });
  await app.engine((timeout) => expect.poll(ids, { timeout }).not.toEqual(was.pair), { ms: 30_000 });
  await expect(page.locator("#duel-a")).not.toHaveClass(/\bgone\b/);
  await expect(page.locator("#pd-a")).toBeEnabled();
  const asked = (await app.sent({ type: "duel_pred" }, { after: t })).filter((m) => !m.pre && m.a === was.pair[0] && m.b === was.pair[1]);
  expect(asked, "a pick asked about a pair with a side gone").toEqual([]);
});
