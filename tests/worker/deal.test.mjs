// Deals while the pool fills (#211): in a session whose pool fills at boot,
// the k-th deal draws only from the first step·(k+1) sounds of the pool (the
// step is the size the app is handed over at, `playableAt`: 8 in the app),
// in the order the seed's fill folds them in, and a deal asked for before
// they have all joined waits in the worker until they have (worker.js
// `dealsWaiting`). So a seed deals the same pairs however far the fill had
// got when each was asked for. It used to draw over however many had
// joined, and the same seed dealt 4,10 on one boot and 5,6 on another.
//
// worker.js runs here as it is, over the built engine, with no page
// (harness.mjs), filling serially (no farm), two sounds a step. The claims
// are the replies and their order on the worker's one thread, so a slow
// machine makes this slower, never wrong. The pools are small and the step
// is 4, not the app's 8, so each test renders a few dozen sounds: every
// claim is about the step, whatever it is.
import test from "node:test";
import assert from "node:assert/strict";
import { workerFor } from "./harness.mjs";

const SEED = 20260928;
const STEP = 4;
const POOL = 12;
// A test that hangs fails here, well inside the CI job's limit.
const TIMEOUT = 150_000;
const DEALS = 4;

const key = (pair) => [...pair].sort((x, y) => x - y).join();

test("a deal asked for while the pool fills waits for the sounds the schedule names, and deals what a full pool deals", { timeout: TIMEOUT }, async (t) => {
  // The pool full before anything is dealt.
  const full = await workerFor(t, { seed: SEED, poolSize: POOL, playableAt: STEP });
  const settled = [];
  for (let i = 0; i < DEALS; i++) {
    const [r] = await full.send({ type: "duel", exclude: [] });
    settled.push(key(r.pair));
  }
  await full.close();

  // The same seed, every deal asked for as the app is handed over, at STEP
  // sounds (posted when `standardize_now` begins, handed over when it ends),
  // and a request of another kind behind them.
  const w = await workerFor(t, { boot: false });
  const asks = Array.from({ length: DEALS }, () => ({ type: "duel", exclude: [] }));
  for (const q of asks) w.post(q, { during: "standardize_now" });
  const other = { type: "calibration" };
  w.post(other, { during: "standardize_now" });
  w.post({ type: "init", seed: SEED, poolSize: POOL, playableAt: STEP, saved: null, farmPorts: [] });
  const answers = [];
  for (const q of asks) answers.push((await w.answers(q))[0]);
  const [calibration] = await w.answers(other);
  await w.reply("filled");

  assert.deepEqual(answers.map((r) => key(r.pair)), settled, "the same seed dealt other pairs while the pool filled");

  // When each deal was handed over, and when it was answered: the pool as
  // the last `fill_progress` before each said it.
  const trace = await w.trace();
  const poolBefore = (at) => {
    let pool = 0;
    for (const e of trace.slice(0, at)) {
      const r = e.ev === "out" ? w.replies[e.n] : null;
      if (r && r.type === "fill_progress") pool = r.pool;
    }
    return pool;
  };
  const handed = trace.map((e, i) => (e.ev === "in" && e.type === "duel" ? i : -1)).filter((i) => i >= 0);
  const answeredAt = answers.map((r) => trace.findIndex((e) => e.ev === "out" && e.n === r._n));
  // The first deal reaches STEP sounds, the second twice that, and every
  // deal after that the whole pool.
  const need = [STEP, 2 * STEP, POOL, POOL];
  assert.equal(handed.length, DEALS);
  assert.ok(poolBefore(handed[1]) < need[1], `the second deal was asked for with ${poolBefore(handed[1])} sounds in: it had nothing to wait for`);
  for (let k = 0; k < DEALS; k++) {
    assert.ok(poolBefore(answeredAt[k]) >= need[k], `deal ${k} was answered with ${poolBefore(answeredAt[k])} sounds in, before the ${need[k]} it draws from`);
  }
  // The first deal waits for nothing: the app opens as fast as it did.
  assert.ok(poolBefore(answeredAt[0]) < need[1], `the first deal waited for more than its ${STEP}`);
  // Only the deals wait: the request behind them was answered before the
  // second deal was.
  assert.ok(calibration._n < answers[1]._n, "a request behind a waiting deal waited with it");
  await w.close();
});

