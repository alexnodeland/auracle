// Work nobody is waiting on gives way, and work the player asked for does not
// wait for it (docs/architecture/web-runtime.md, "The worker's lanes" and
// "The model's guess and the cable probe"): a measurement PERFORM has left
// lets a cable probe go first and finishes after it, and is the player's
// again when PERFORM comes back into sight; the guess's wait for a crew
// holds nothing up.
//
// worker.js runs here as it is, over the built engine, with no page
// (harness.mjs). Each claim is an order of replies, with the order that the
// rule exists to prevent shown too, on the same requests.
import test from "node:test";
import assert from "node:assert/strict";
import { workerFor, callsBetween, outOf } from "./harness.mjs";

const SEED = 1;
const TIMEOUT = 300_000;

async function treeOf(w, id) {
  const [r] = await w.send({ type: "tree_json", id });
  return r.json;
}

test("a measurement nobody waits on gives way to a cable probe and finishes after it, where PERFORM's own does not", { timeout: TIMEOUT }, async (t) => {
  const w = await workerFor(t, { seed: SEED });
  // The probe measures the patch on the bench.
  await w.send({ type: "edit_begin", id: 1 });

  // A measurement PERFORM has left (`bg`, as `retire` leaves one), and
  // PATCH's probe asked for during its second render.
  w.post({ type: "cable_levels", token: 1 }, { during: { call: "memo_render", nth: 2 } });
  const [left] = await w.send({ type: "perform_wire", req: 1, tree: await treeOf(w, 2), overrides: [], bg: true });
  const probe = await w.reply("cable_levels", { where: { token: 1 } });
  assert.ok(probe.levels.cables.length > 0, "the probe measured the cables");
  assert.ok(left.data, "the measurement still landed, whole");
  assert.ok(probe._n < left._n, "the probe waited for the whole measurement");
  let trace = await w.trace();
  // It gave way part-way and went on from where it was.
  assert.ok(callsBetween(trace, outOf(trace, probe), outOf(trace, left)).includes("memo_render"), "the measurement was over before the probe");

  // PERFORM's own measurement of the sound it plays keeps the floor: the
  // probe waits for it.
  const at = w.post({ type: "cable_levels", token: 2 }, { during: { call: "memo_render", nth: 2 } });
  const [own] = await w.send({ type: "perform_wire", req: 2, tree: await treeOf(w, 4), overrides: [] });
  const waited = await w.reply("cable_levels", { where: { token: 2 }, after: at });
  assert.ok(own.data);
  assert.ok(own._n < waited._n, "PERFORM's own measurement gave way to the probe");
  trace = await w.trace();
  assert.ok(trace.findIndex((e) => e.ev === "in" && e.type === "cable_levels" && e.key === 2) < outOf(trace, own), "the probe was asked for after the measurement");
  await w.close();
});

test("a measurement PERFORM left when it went out of sight is the player's again when it comes back", { timeout: TIMEOUT }, async (t) => {
  const w = await workerFor(t, { seed: SEED });
  // A Take's measurement: PERFORM goes out of sight during its second render
  // (`retire`: it drops to `later`), comes back during its third (`promote`),
  // and Wander asks for a drift of the patch during its fourth.
  const tree = await treeOf(w, 2);
  w.post({ type: "retire", reqs: [1] }, { during: { call: "memo_render", nth: 2 } });
  w.post({ type: "promote", kind: "perform_wire", req: 1 }, { during: { call: "memo_render", nth: 3 } });
  w.post({ type: "perform_drift", req: 2, tree, overrides: [], locks: [], steps: 12, sigma: 0.05 }, { during: { call: "memo_render", nth: 4 } });
  const [wired] = await w.send({ type: "perform_wire", req: 1, tree, overrides: [] });
  const [drifted] = await w.answers({ type: "perform_drift", req: 2 });
  assert.ok(wired.data && drifted.drift, "both landed");
  assert.ok(wired._n < drifted._n, "the drift, asked for after it in the background, landed first");
  let trace = await w.trace();
  const drift = trace.findIndex((e) => e.ev === "in" && e.type === "perform_drift");
  assert.ok(callsBetween(trace, drift, outOf(trace, wired)).includes("memo_render"), "the measurement was over before the drift was asked for");

  // Left out of sight (no `promote`), it gives way to the drift: the case
  // coming back is for.
  const other = await treeOf(w, 4);
  const at = w.post({ type: "retire", reqs: [3] }, { during: { call: "memo_render", nth: 2 } });
  w.post({ type: "perform_drift", req: 4, tree: other, overrides: [], locks: [], steps: 12, sigma: 0.05 }, { during: { call: "memo_render", nth: 3 } });
  const [demoted] = await w.send({ type: "perform_wire", req: 3, tree: other, overrides: [] });
  const [first] = await w.answers({ type: "perform_drift", req: 4 }, { after: at });
  assert.ok(demoted.data && first.drift);
  assert.ok(first._n < demoted._n, "a measurement nobody waits on kept the drift waiting");
  trace = await w.trace();
  assert.ok(callsBetween(trace, outOf(trace, first), outOf(trace, demoted)).includes("memo_render"), "the measurement was over before the drift");
  await w.close();
});

test("an Offer asked for while the guess waits for its crew starts at once", { timeout: TIMEOUT }, async (t) => {
  const w = await workerFor(t, { seed: SEED });
  const [warm] = await w.send({ type: "warm_start", picked: [0, 1, 2], rest: [3, 4, 5, 6, 7, 8] });
  await w.send({ type: "fit" });
  const [bench] = await w.send({ type: "edit_begin", id: warm.first });
  // The guess raises a crew (`farm_want`), and main's answer is kept back
  // until the Offer is answered: the guess waits for its crew all that time.
  w.holdFarm();
  const at = w.post({ type: "guess", token: 1 });
  await w.reply("farm_want", { after: at });
  const [offered] = await w.send({ type: "perform_offer", req: 1, tree: bench.treeJson, overrides: [], locks: [], steps: 1 });
  assert.ok(offered.offer, "the Offer was answered");
  assert.equal(w.releaseFarm(), 1);
  const guess = await w.reply("guess", { where: { token: 1 }, after: at });
  assert.ok(guess.data && guess.data.guesses, "the guess ranked once its crew was answered");
  assert.ok(offered._n < guess._n, "the guess was answered before the Offer");
  // The Offer began while the guess waited for its crew, before the guess
  // rendered anything on the engine's thread: a crew phase holding the floor
  // keeps it waiting until the crew comes or the worker gives up on it.
  const trace = await w.trace();
  const asked = trace.findIndex((e) => e.ev === "in" && e.type === "guess");
  const after = (name) => trace.findIndex((e, i) => i > asked && e.ev === "call" && e.name === name);
  assert.ok(after("perform_offer_begin") > 0, "the Offer began");
  assert.ok(after("perform_offer_begin") < after("memo_render"), "the Offer waited for the guess's crew");
  await w.close();
});
