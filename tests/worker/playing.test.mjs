// Background work steps aside while notes sound (#288,
// docs/architecture/web-runtime.md, "The worker's lanes"): on a machine with
// four threads or fewer main says when notes start and stop (`playing`,
// never answered), and from then until a second after the last note nothing
// in the background starts, while the player's requests and the long work the
// player asked for go on. Past eight seconds of notes, one background step
// goes a second, so a latched note cannot stop the fill for good.
//
// worker.js runs here as it is, over the built engine, with no page
// (harness.mjs). Each claim is what the worker answered and what it called,
// in order; apps/web/tests/worker-lanes.test.mjs holds the hold's clock on
// the worker's functions over a clock the test moves.
import test from "node:test";
import assert from "node:assert/strict";
import { workerFor } from "./harness.mjs";

const SEED = 1;
// A test that hangs fails here, well inside the CI job's limit.
const TIMEOUT = 150_000;
// "Nothing happens" is watched for this long: the slack a loaded machine
// needs to do the wrong thing (tests/web/AGENTS.md, `app.quiet`).
const QUIET_MS = 1_500;
const quiet = () => new Promise((resolve) => setTimeout(resolve, QUIET_MS));

/** Where in a trace a request of `type` was handed to the worker, the
 *  `nth` time (1 by default). */
function handed(trace, type, nth = 1) {
  let seen = 0;
  return trace.findIndex((e) => e.ev === "in" && e.type === type && ++seen === nth);
}

test("while notes sound, background work waits, the player is answered, and it goes a second after the last note", { timeout: TIMEOUT }, async (t) => {
  const w = await workerFor(t, { seed: SEED });
  await w.send({ type: "edit_begin", id: 1 });
  w.post({ type: "playing", on: true });
  // PATCH's cable probe (`later`) and a dealt pair's sound (a background
  // render in `now`), asked for while notes sound…
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
  let trace = await w.trace();
  const calls = trace.filter((e) => e.ev === "call").map((e) => e.name);
  assert.ok(!calls.includes("edit_cable_levels"), "the cable probe started while notes sounded");
  assert.equal(w.repliesOf("render").length, 0, "the pair's sound was rendered while notes sounded");

  // The last note stops: a second later the background goes on.
  w.post({ type: "playing", on: false });
  const [levels] = await w.answers(probe);
  const [sound] = await w.answers(pair);
  assert.ok(levels.levels, "the probe measured");
  assert.ok(sound.buffer.length > 0, "the pair's sound was rendered");
  trace = await w.trace();
  const stopped = handed(trace, "playing", 2);
  const measured = trace.findIndex((e) => e.ev === "call" && e.name === "edit_cable_levels");
  assert.ok(stopped >= 0 && measured > stopped, "the probe started only after the last note");
  await w.close();
});

test("past eight seconds of notes, background work goes through all the same", { timeout: TIMEOUT }, async (t) => {
  const w = await workerFor(t, { seed: SEED });
  await w.send({ type: "edit_begin", id: 1 });
  // Notes held for good (the hold latch): no `playing` off ever comes.
  w.post({ type: "playing", on: true });
  const probe = { type: "cable_levels", token: 1 };
  w.post(probe);
  await quiet();
  let trace = await w.trace();
  assert.ok(!trace.some((e) => e.ev === "call" && e.name === "edit_cable_levels"), "it started under the cap");
  // Nothing else will wake it: the cap's turn does.
  const [levels] = await w.answers(probe);
  assert.ok(levels.levels, "the probe measured while notes still sounded");
  trace = await w.trace();
  assert.equal(handed(trace, "playing", 2), -1, "no note stopped");
  await w.close();
});

test("while notes sound, the bank's fill waits between its batches, and goes on after", { timeout: TIMEOUT }, async (t) => {
  const w = await workerFor(t, { boot: false });
  const init = { type: "init", seed: SEED, poolSize: 12, playableAt: 8, saved: null, farmPorts: [] };
  w.post(init);
  // A batch or two in, notes start.
  const begun = await w.until((r) => r.type === "fill_progress" && r.pool >= 2);
  w.post({ type: "playing", on: true });
  await quiet();
  const held = w.repliesOf("fill_progress", { after: begun._n + 1 });
  // The batch running when the note came may land; no other.
  assert.ok(held.length <= 1, `${held.length} batches while notes sounded`);
  assert.equal(w.repliesOf("filled").length, 0);
  const at = w.replies.length;
  w.post({ type: "playing", on: false });
  const filled = await w.until((r) => r.type === "filled", { after: at });
  assert.ok(filled.status.pool >= 12, "the bank filled once the notes stopped");
  await w.close();
});
