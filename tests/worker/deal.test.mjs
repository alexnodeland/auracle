// Deals while the pool fills (#211). In a session opened with a seed in the
// address (`?seed=`: `init`'s `seeded`) whose pool fills at boot, the k-th
// deal draws only from the first step·(k+1) sounds of the pool (the step is
// the size the app is handed over at, `playableAt`: 8 in the app), in the
// order the seed's fill folds them in, and a deal asked for before they have
// all joined waits in the worker until they have (worker.js `dealsWaiting`).
// So a seed deals the same pairs however far the fill had got when each was
// asked for. It used to draw over however many had joined, and the same seed
// dealt 4,10 on one boot and 5,6 on another. A saved bank that comes back
// whole has no fill, and deals from the whole pool from its first pair. An
// ordinary session (no seed in the address) has no schedule: its deals are
// drawn at once, over the sounds that have joined, so a pick never waits for
// the fill.
//
// worker.js runs here as it is, over the built engine, with no page
// (harness.mjs), filling serially (no farm), two sounds a step. The claims
// are the replies and their order on the worker's one thread, so a slow
// machine makes this slower, never wrong. The pools are small and the step
// is 4, not the app's 8, so each test renders a few dozen sounds: every
// claim is about the step, whatever it is.
import test from "node:test";
import assert from "node:assert/strict";
import { workerFor, outOf } from "./harness.mjs";

const SEED = 20260928;
const STEP = 4;
const POOL = 12;
// A test that hangs fails here, well inside the CI job's limit.
const TIMEOUT = 150_000;
const DEALS = 4;

const key = (pair) => [...pair].sort((x, y) => x - y).join();

/** How many sounds the pool held at place `at` of `w`'s `trace`: what the
 *  last `fill_progress` before it said. */
const poolBefore = (w, trace, at) => {
  let pool = 0;
  for (const e of trace.slice(0, at)) {
    const r = e.ev === "out" ? w.replies[e.n] : null;
    if (r && r.type === "fill_progress") pool = r.pool;
  }
  return pool;
};

/** `DEALS` deals asked for as the app is handed over, at STEP sounds (posted
 *  when `standardize_now` begins, handed over when it ends), and a request of
 *  another kind behind them, on a worker booted then with `seeded`. Their
 *  answers, the request behind them's, and the trace once the pool has
 *  filled. */
async function dealsAsTheAppOpens(t, seeded) {
  const w = await workerFor(t, { boot: false });
  const asks = Array.from({ length: DEALS }, () => ({ type: "duel", exclude: [] }));
  for (const q of asks) w.post(q, { during: "standardize_now" });
  const other = { type: "calibration" };
  w.post(other, { during: "standardize_now" });
  w.post({ type: "init", seed: SEED, seeded, poolSize: POOL, playableAt: STEP, saved: null, farmPorts: [] });
  const answers = [];
  for (const q of asks) answers.push((await w.answers(q))[0]);
  const [behind] = await w.answers(other);
  await w.reply("filled");
  return { w, answers, behind, trace: await w.trace() };
}

test("a seeded session's deal asked for while the pool fills waits for the sounds the schedule names, and deals what a full pool deals", { timeout: TIMEOUT }, async (t) => {
  // The pool full before anything is dealt.
  const full = await workerFor(t, { seed: SEED, seeded: true, poolSize: POOL, playableAt: STEP });
  const settled = [];
  for (let i = 0; i < DEALS; i++) {
    const [r] = await full.send({ type: "duel", exclude: [] });
    settled.push(key(r.pair));
  }
  await full.close();

  // The same seed, every deal asked for as the app is handed over.
  const { w, answers, behind, trace } = await dealsAsTheAppOpens(t, true);
  assert.deepEqual(answers.map((r) => key(r.pair)), settled, "the same seed dealt other pairs while the pool filled");

  // When each deal was handed over, and when it was answered: the pool as
  // the last `fill_progress` before each said it.
  const handed = trace.map((e, i) => (e.ev === "in" && e.type === "duel" ? i : -1)).filter((i) => i >= 0);
  const answeredAt = answers.map((r) => outOf(trace, r));
  // The first deal reaches STEP sounds, the second twice that, and every
  // deal after that the whole pool.
  const need = [STEP, 2 * STEP, POOL, POOL];
  assert.equal(handed.length, DEALS);
  assert.ok(poolBefore(w, trace, handed[1]) < need[1], `the second deal was asked for with ${poolBefore(w, trace, handed[1])} sounds in: it had nothing to wait for`);
  for (let k = 0; k < DEALS; k++) {
    assert.ok(poolBefore(w, trace, answeredAt[k]) >= need[k], `deal ${k} was answered with ${poolBefore(w, trace, answeredAt[k])} sounds in, before the ${need[k]} it draws from`);
  }
  // The first deal waits for nothing: the app opens as fast as it did.
  assert.ok(poolBefore(w, trace, answeredAt[0]) < need[1], `the first deal waited for more than its ${STEP}`);
  // Only the deals wait: the request behind them was answered before the
  // second deal was.
  assert.ok(behind._n < answers[1]._n, "a request behind a waiting deal waited with it");
  await w.close();
});

test("an ordinary session's deal asked for while the pool fills is answered at once, over the sounds that have joined", { timeout: TIMEOUT }, async (t) => {
  // The seeded test's requests, in a session with no seed in the address.
  const { w, answers, trace } = await dealsAsTheAppOpens(t, false);
  const [{ json: saved }] = await w.send({ type: "save" });
  const order = JSON.parse(saved).bank.map((e) => e.id);
  assert.equal(order.length, POOL);

  const handed = trace.map((e, i) => (e.ev === "in" && e.type === "duel" ? i : -1)).filter((i) => i >= 0);
  const answeredAt = answers.map((r) => outOf(trace, r));
  assert.equal(handed.length, DEALS);
  // What a seeded session's schedule would have each deal wait for: the
  // second twice STEP sounds, the third and fourth the whole pool.
  const need = [STEP, 2 * STEP, POOL, POOL];
  for (let k = 0; k < DEALS; k++) {
    const pool = poolBefore(w, trace, answeredAt[k]);
    // Dealt from the sounds that had joined when it was answered: the pool
    // only grows while it fills, in the order of the bank saved after.
    const places = answers[k].pair.map((id) => order.indexOf(id));
    assert.ok(places.every((i) => i >= 0 && i < pool), `deal ${k} was answered with ${pool} sounds in, and dealt sounds ${places.map((i) => i + 1).join(" and ")} of the pool`);
    if (k > 0) assert.ok(pool < need[k], `deal ${k} waited for the ${need[k]} sounds a seed's schedule names: it was answered with ${pool} in`);
  }
  // No deal was held for a schedule: the worker never asked what one waits for.
  assert.ok(!trace.some((e) => e.ev === "call" && e.name === "deal_need"), "the worker asked the engine what an ordinary session's deal waits for");
  await w.close();
});

test("a seeded session's saved bank that comes back whole deals from the whole pool from its first pair, and one that comes back short keeps to the schedule", { timeout: TIMEOUT }, async (t) => {
  // A bank of POOL sounds, saved; its order is the pool's.
  const first = await workerFor(t, { seed: SEED, seeded: true, poolSize: POOL, playableAt: STEP });
  const [{ json: saved }] = await first.send({ type: "save" });
  await first.close();
  const order = JSON.parse(saved).bank.map((e) => e.id);
  assert.equal(order.length, POOL);
  const at = (id) => order.indexOf(id);

  // Back whole: there is no fill, so no schedule, though the session is
  // seeded. Booted with a step of 2, the k-th deal under one would hold only
  // the first 2·(k+1) sounds (the first deal the first two); the first deals
  // here reach past that. (Drawn from the whole pool, the first falls within
  // its first two sounds one time in 66, the second within four one in 11,
  // the third within six one in 4: a seed whose three all do would be a seed
  // to change.)
  const whole = await workerFor(t, { seed: SEED, seeded: true, poolSize: POOL, playableAt: 2, saved });
  const wide = [];
  for (let k = 0; k < 3; k++) {
    const [r] = await whole.send({ type: "duel", exclude: [] });
    wide.push(Math.max(...r.pair.map(at)));
  }
  assert.ok(
    wide.some((last, k) => last >= 2 * (k + 1)),
    `a bank that came back whole dealt by the schedule: its first pairs reached ${wide.map((n) => n + 1).join(", ")} sounds in`,
  );
  await whole.close();

  // Back short of a larger pool: the rest fills behind it, so its deals keep
  // to the schedule, and the first is the bank's first two sounds.
  const short = await workerFor(t, { seed: SEED, seeded: true, poolSize: POOL + 2, playableAt: 2, saved });
  const [r] = await short.send({ type: "duel", exclude: [] });
  assert.deepEqual(
    r.pair.map(at).sort((x, y) => x - y),
    [0, 1],
    "a bank that came back short dealt its first pair from beyond its first two sounds",
  );
  await short.close();
});
