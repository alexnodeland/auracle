// "teach it" inserts the warm start's nine cards, and the engine measures
// them while the player chooses (docs/architecture/web-runtime.md, "The
// worker's lanes"; worker.js `warmCard`): the picks first, one card per turn
// behind every gesture. So the first pick's controls wait on no render of its
// own (#221), and the session "teach it" makes is the one it made when
// nothing was measured ahead.
//
// worker.js runs here as it is, over the built engine, with no page
// (harness.mjs). Which call rendered is in the trace: the memo's misses during
// it (`misses`), 0 for an insert served from the memo.
import test from "node:test";
import assert from "node:assert/strict";
import { workerFor, callsBetween, outOf } from "./harness.mjs";

const SEED = 1;
// A test that hangs fails here, well inside the CI job's limit.
const TIMEOUT = 150_000;

// The nine cards as dealt (preset indices), and the three the player picks,
// in the order picked.
const DEALT = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const PICKED = [5, 0, 1];
const REST = DEALT.filter((i) => !PICKED.includes(i));
// main.js `warmCardsSend`: the picks first, then the rest as dealt.
const order = (picked) => [...new Set([...picked, ...DEALT])];
const teach = () => ({ type: "warm_start", picked: PICKED, rest: REST });

/** The engine calls between two places in a trace (exclusive), with what
 *  each rendered. */
const callsIn = (trace, from, to) => trace.slice(from + 1, to).filter((e) => e.ev === "call");

/** Where in a trace a request was handed to the worker. */
const inOf = (trace, type) => trace.findIndex((e) => e.ev === "in" && e.type === type);

/** Deal the cards (`order`), then ask for a pool member's sound in the
 *  background, as main asks for a dealt pair's: it waits behind every card
 *  still queued (each card measured queues the next ahead of the lane's
 *  other background work, `warmCard`), so by its answer a card has been
 *  measured, or none will be. Its arrival also sets a second loop serving
 *  the lane (the pump) beside the one measuring the cards, as the app's do. */
async function deal(w, cards) {
  w.post({ type: "warm_cards", order: cards });
  await w.send({ type: "render", id: 1, bg: true });
  const trace = await w.trace();
  assert.ok(trace.some((e) => e.ev === "call" && e.name === "memo_render"), "the cards were not measured while the player chose");
}

test("a pick moves its card ahead, teach it waits only for the card being measured, and inserts the measured cards without rendering them", { timeout: TIMEOUT }, async (t) => {
  const w = await workerFor(t, { seed: SEED });
  // The cards are dealt; the player picks the sixth while the first is
  // measured, then two more, and presses teach it while the third is.
  w.post({ type: "warm_cards", order: order([PICKED[0]]) }, { during: { call: "memo_render", nth: 1 } });
  const ask = teach();
  w.post(ask, { during: { call: "memo_render", nth: 3 } });
  await deal(w, order([]));
  const replies = await w.answers(ask);
  assert.deepEqual(replies.map((r) => r.type), ["warm_first", "warm_done"]);
  const [first, done] = replies;
  assert.ok(first.id > 0 && first.index === PICKED[0] && first.json && Number.isFinite(first.makeup), "the first pick reached the voices");
  // The first pick's sound, asked for in the background: it waits behind any
  // card still queued, so by its answer a card measured after teach it would
  // be in the trace. Inserted from the memo, the pick has no sound yet, and
  // this renders it.
  const [sound] = await w.send({ type: "render", id: first.id, bg: true });
  assert.ok(sound.buffer.length > 0, "the first pick has no sound");
  const trace = await w.trace();

  const posted = trace.findIndex((e) => e.ev === "posted" && e.type === "warm_start");
  const arrived = inOf(trace, "warm_start");
  // Three cards measured before it, the last one while it was on its way…
  assert.deepEqual(callsBetween(trace, 0, arrived).filter((n) => n === "memo_render").length, 3, "three cards were measured before teach it");
  // …and handed to the worker when that one ended, before any other call.
  assert.deepEqual(callsBetween(trace, posted, arrived), [], "teach it waited for more than the card in progress");
  for (const e of callsIn(trace, 0, arrived).filter((c) => c.name === "memo_render")) assert.equal(e.misses, 1, "a card was not rendered into the memo");

  // The first pick is inserted from the memo: no render before its controls
  // go to the voices. Without its pick it would have been the sixth card
  // measured, after teach it.
  const toFirst = callsIn(trace, arrived, outOf(trace, first));
  assert.deepEqual(toFirst.map((c) => c.name), ["load_preset_heard", "set_pinned", "tree_json_of", "makeup_of"]);
  assert.equal(toFirst[0].misses, 0, "the first pick was rendered after teach it");
  // The other two picks were measured (the first card, and the third while
  // teach it was on its way); the six passed over were not, and are rendered
  // here, each once.
  const inserts = callsIn(trace, outOf(trace, first), outOf(trace, done)).filter((c) => c.name === "load_preset");
  assert.deepEqual(inserts.map((c) => c.misses), [0, 0, 1, 1, 1, 1, 1, 1]);
  assert.equal(done.n, 18, "each pick over each card passed over");
  assert.ok(!callsBetween(trace, arrived, trace.length).includes("memo_render"), "a card was measured after teach it");
  await w.close();
});

test("the session teach it makes is the one it made when nothing was measured ahead", { timeout: TIMEOUT }, async (t) => {
  const [ahead, cold] = await Promise.all([workerFor(t, { seed: SEED }), workerFor(t, { seed: SEED })]);
  // Every card measured before teach it, in the order teach it inserts them…
  const a = teach();
  ahead.post(a, { during: { call: "memo_render", nth: DEALT.length } });
  await deal(ahead, order(PICKED));
  // …and none (the same sound asked for, as the deal asked for it).
  await cold.send({ type: "render", id: 1, bg: true });
  const [ra, rb] = await Promise.all([ahead.answers(a), cold.send(teach())]);
  const plain = (rs) => rs.map(({ re, _n, ...r }) => r);
  assert.deepEqual(plain(ra), plain(rb), "teach it answered differently");
  const at = await ahead.trace();
  const ct = await cold.trace();
  const inserts = (trace) => callsIn(trace, inOf(trace, "warm_start"), trace.length).filter((c) => /^load_preset/.test(c.name));
  assert.deepEqual(inserts(at).map((c) => c.misses), Array(DEALT.length).fill(0), "an insert rendered a card measured ahead");
  assert.deepEqual(inserts(ct).map((c) => c.misses), Array(DEALT.length).fill(1), "teach it found a card measured");

  // The same bank, ids, names, picks and standardizer…
  const [sa] = await ahead.send({ type: "save" });
  const [sb] = await cold.send({ type: "save" });
  assert.equal(sa.json, sb.json, "the saved session differs");
  // …and the same first fit.
  const [fa] = await ahead.send({ type: "fit" });
  const [fb] = await cold.send({ type: "fit" });
  // (Where each fit's time went, `took`, is this machine's.)
  const fit = ({ took, ...r }) => r;
  assert.deepEqual(plain([fa]).map(fit), plain([fb]).map(fit), "the first fit differs");
  await ahead.close();
  await cold.close();
});
