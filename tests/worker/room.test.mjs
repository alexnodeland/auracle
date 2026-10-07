// Background work makes room for the audio while it struggles and notes
// sound (#288, docs/architecture/web-runtime.md, "Making room for the
// audio"): main says so (`make_room`, never answered), and from then until a
// second after its word ends nothing in the background starts, while the
// player's requests and the long work the player asked for go on. Past
// eight seconds of it, background work goes on a step at a time, so notes
// that sound for good cannot stop the fill. Nothing is held before the boot
// veil lifts.
//
// worker.js runs here as it is, over the built engine, with no page
// (harness.mjs). Each claim is what the worker answered and what it called,
// in order, and where a claim holds only under the cap, when (the trace's
// `t`), so a slow runner makes it slower, never wrong (ADR-022).
// apps/web/tests/worker-lanes.test.mjs holds the hold's clock on the
// worker's functions over a clock the test moves.
import test from "node:test";
import assert from "node:assert/strict";
import { workerFor, outOf } from "./harness.mjs";

const SEED = 1;
// A test that hangs fails here, well inside the CI job's limit.
const TIMEOUT = 150_000;
// "Nothing happens" is watched for this long: the slack a loaded machine
// needs to do the wrong thing (tests/web/AGENTS.md, `app.quiet`).
const QUIET_MS = 1_500;
const quiet = () => new Promise((resolve) => setTimeout(resolve, QUIET_MS));
// worker.js `ROOM_CAP_MS`: past it, held work goes on a step at a time.
const ROOM_CAP_MS = 8_000;

/** Where in a trace a request of `type` was handed to the worker, the
 *  `nth` time (1 by default). */
function handed(trace, type, nth = 1) {
  let seen = 0;
  return trace.findIndex((e) => e.ev === "in" && e.type === type && ++seen === nth);
}
const calls = (trace, name, from = 0) => trace.slice(from).filter((e) => e.ev === "call" && e.name === name);

test("while room is made, background work waits, the player is answered, and it goes a second after the word ends", { timeout: TIMEOUT }, async (t) => {
  const w = await workerFor(t, { seed: SEED });
  await w.send({ type: "edit_begin", id: 1 });
  w.post({ type: "make_room", on: true });
  // PATCH's cable probe (`later`) and a dealt pair's sound (a background
  // render in `now`), asked for while room is made…
  const probe = { type: "cable_levels", token: 1 };
  w.post(probe);
  const pair = { type: "render", id: 3, bg: true };
  w.post(pair);
  // …then a bank row's tree (a gesture) and a sound of your own read back
  // (`soon`: the player's own long work).
  const [tree] = await w.send({ type: "tree_json", id: 2 });
  assert.ok(tree.json, "the gesture was answered");
  const [own] = await w.send({ type: "own_sound" });
  assert.equal(own.type, "own_sound", "soon work went on");
  await quiet();
  w.post({ type: "make_room", on: false });
  const [levels] = await w.answers(probe);
  const [sound] = await w.answers(pair);
  assert.ok(levels.levels, "the probe measured");
  assert.ok(sound.buffer.length > 0, "the pair's sound was rendered");
  const trace = await w.trace();
  const on = trace[handed(trace, "make_room")];
  const off = handed(trace, "make_room", 2);
  const [measured] = calls(trace, "edit_cable_levels");
  const at = trace.indexOf(measured);
  // It started after the word ended, or, on a runner slow enough, past the
  // cap: never sooner.
  assert.ok(at > off || measured.t - on.t >= ROOM_CAP_MS, "the probe started while room was made, under the cap");
  // The pair's sound waited the same way.
  const rendered = outOf(trace, sound);
  assert.ok(rendered > off || trace[rendered].t - on.t >= ROOM_CAP_MS, "the pair's sound was rendered while room was made, under the cap");
  await w.close();
});

test("past eight seconds of making room, background work goes through all the same", { timeout: TIMEOUT }, async (t) => {
  const w = await workerFor(t, { seed: SEED });
  await w.send({ type: "edit_begin", id: 1 });
  // Notes that sound for good: no word that room is no longer needed comes.
  w.post({ type: "make_room", on: true });
  const probe = { type: "cable_levels", token: 1 };
  w.post(probe);
  const [levels] = await w.answers(probe);
  assert.ok(levels.levels, "the probe measured while room was still made");
  const trace = await w.trace();
  assert.equal(handed(trace, "make_room", 2), -1, "room was never let go");
  const on = trace[handed(trace, "make_room")];
  const [measured] = calls(trace, "edit_cable_levels");
  assert.ok(measured.t - on.t >= ROOM_CAP_MS, "it went through only past the cap");
  await w.close();
});

test("room asked for under the boot veil holds nothing until it lifts, then the fill waits between its batches", { timeout: TIMEOUT }, async (t) => {
  const w = await workerFor(t, { boot: false });
  w.post({ type: "init", seed: SEED, poolSize: 12, playableAt: 8, saved: null, farmPorts: [] });
  // Keys played under the veil, from the start.
  w.post({ type: "make_room", on: true });
  const playable = await w.reply("playable");
  await quiet();
  let trace = await w.trace();
  const on = handed(trace, "make_room");
  const lifted = outOf(trace, playable);
  assert.ok(calls(trace, "fill_step", on).length >= 2, "the fill went on under the veil");
  assert.ok(lifted > on, "and the veil lifted");
  // From the veil on, one batch at most (the one under way when it lifted),
  // under the cap.
  const after = calls(trace, "fill_step", lifted).filter((c) => c.t - trace[lifted].t < ROOM_CAP_MS);
  assert.ok(after.length <= 1, `${after.length} batches while room was made`);
  assert.equal(w.repliesOf("filled").length, 0);
  const at = w.replies.length;
  w.post({ type: "make_room", on: false });
  const filled = await w.until((r) => r.type === "filled", { after: at });
  assert.ok(filled.status.pool >= 12, "the bank filled once room was no longer needed");
  trace = await w.trace();
  assert.ok(calls(trace, "fill_step", handed(trace, "make_room", 2)).length >= 1, "its batches went on after");
  await w.close();
});
