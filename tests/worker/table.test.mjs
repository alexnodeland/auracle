// What the engine worker does with the sounds on EVOLVE's table (#452):
// main's `holdTable` sends `on_table` with the pair up and the pair of a
// pick still in its undo window, and the engine replaces neither until they
// are put away (`Engine::set_on_table`), so the pick's `record_duel` finds
// both its sides when the window closes. It used to be refused when a
// generation's end, a preset load or an import inside the window replaced a
// side. The reply says what is held, with the ratings (what may be replaced
// moves with the hold, as with a save).
//
// worker.js runs here as it is, over the built engine, with no page
// (harness.mjs), filling serially (no farm). With no fit yet every sound
// rates the same, and a preset load replaces the first sound in pool order
// it may (the engine's ties keep pool order), so the test knows which sound
// a load would take.
import test from "node:test";
import assert from "node:assert/strict";
import { workerFor } from "./harness.mjs";

const SEED = 20261031;
// A test that hangs fails here, well inside the CI job's limit.
const TIMEOUT = 150_000;

const ids = (loaded) => loaded.views.ranked.map((r) => r.id);

test("a pick's pair held on the table outlives a preset load and its vote is recorded; put away, the next load replaces it", { timeout: TIMEOUT }, async (t) => {
  const w = await workerFor(t, { seed: SEED, poolSize: 8, playableAt: 4 });
  const [{ json }] = await w.send({ type: "save" });
  const order = JSON.parse(json).bank.map((e) => e.id);
  assert.equal(order.length, 8);
  const [a, b] = order;
  const absent = Math.max(...order) + 1;

  // Held, in u32 ids, with an id the pool does not hold passed over.
  const [held] = await w.send({ type: "on_table", ids: [a, b, absent] });
  assert.equal(held.type, "on_table");
  assert.deepEqual(held.ids, [a, b]);
  assert.ok(Array.isArray(held.ratings && held.ratings.may_replace), "the reply carries the ratings");
  assert.equal(held.retiring, undefined, "no generation is open to say what its end replaces");

  // A preset load in the pick's window: it would have replaced `a`, the
  // first in pool order, and replaces the next sound instead.
  const [first] = await w.send({ type: "load_preset", index: 0 });
  assert.equal(first.type, "preset_loaded");
  assert.ok(first.id > 0, "the preset did not land");
  const after = ids(first);
  assert.equal(after.length, 8, "the load did not replace a sound");
  assert.ok(after.includes(a) && after.includes(b), "a preset load replaced a sound on the table");
  assert.ok(!after.includes(order[2]), "the load replaced another sound than the first it may");

  // The window closes: the vote is recorded.
  const [voted] = await w.send({ type: "record_duel", a, b, choseA: true });
  assert.equal(voted.recorded, true, "the pick on a held pair was refused");
  assert.equal(voted.status.picks, 1);

  // Put away: the next load replaces the first in pool order, which a vote
  // on it then cannot reach.
  const [putAway] = await w.send({ type: "on_table", ids: [] });
  assert.deepEqual(putAway.ids, []);
  const [second] = await w.send({ type: "load_preset", index: 1 });
  assert.ok(!ids(second).includes(a), "a sound put away was still kept");
  const [late] = await w.send({ type: "record_duel", a, b, choseA: false });
  assert.equal(late.recorded, false);
  await w.close();
});
