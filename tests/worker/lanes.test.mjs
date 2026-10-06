// The player first, in the worker itself: a request the player makes waits
// for at most the engine call in progress when it arrives, whatever long job
// holds the engine (docs/architecture/web-runtime.md, "The worker's lanes").
//
// worker.js runs here as it is, over the built engine, with no page
// (harness.mjs). Each request is posted while a given call of the job runs
// (`during`), as one of main's arrives mid-render, and the thread's timeline
// (`trace`) says what the worker did between: the claim is an order of
// events on one thread, so a slow machine makes it slower, never wrong.
// apps/web/tests/worker-lanes.test.mjs holds the same rule on the worker's
// functions lifted out over a stub engine; this holds it on the real one.
import test from "node:test";
import assert from "node:assert/strict";
import { workerFor, callsBetween, outOf } from "./harness.mjs";

const SEED = 1;
// A test that hangs fails here, well inside the CI job's limit.
const TIMEOUT = 150_000;

/** A pool member's tree, as PERFORM measures it. */
async function treeOf(w, id) {
  const [r] = await w.send({ type: "tree_json", id });
  return r.json;
}

/** Where the request posted `during` a call was posted, handed to the
 *  worker, and answered by `reply`. */
function served(trace, type, reply) {
  const posted = trace.findIndex((e) => e.ev === "posted" && e.type === type);
  const arrived = trace.findIndex((e, i) => i > posted && e.ev === "in" && e.type === type);
  const answered = outOf(trace, reply);
  assert.ok(posted >= 0 && arrived > posted && answered > arrived, `${type} was posted, handed over and answered`);
  return { posted, arrived, answered };
}

/** A taste, so the model has a guess: the warm start's picks, then a fit.
 *  The ids of its first pick (opened on the bench) and of another sound. */
async function taught(w) {
  // `warm_first`, then `warm_done`: the last is the one wanted.
  const warm = (await w.send({ type: "warm_start", picked: [0, 1, 2], rest: [3, 4, 5, 6, 7, 8] })).at(-1);
  const [fitted] = await w.send({ type: "fit" });
  return { first: warm.first, other: fitted.views.ranked.map((r) => r.id).find((id) => id !== warm.first) };
}

test("a request made during PERFORM's measurement is answered before its next render", { timeout: TIMEOUT }, async (t) => {
  const w = await workerFor(t, { seed: SEED });
  const tree = await treeOf(w, 1);
  // A bank row's ▶, asked for during the measurement's third render.
  const play = { type: "render", id: 2 };
  w.post(play, { during: { call: "memo_render", nth: 3 } });
  const [wired] = await w.send({ type: "perform_wire", req: 1, tree, overrides: [] });
  const [render] = await w.answers(play);
  assert.ok(render.buffer.length > 0, "the render was answered with its sound");
  assert.ok(wired.data, "the measurement landed whole");

  const trace = await w.trace();
  const { posted, arrived, answered } = served(trace, "render", render);
  // Handed to the worker when the render in progress ended, before any other call…
  assert.deepEqual(callsBetween(trace, posted, arrived), [], "the request waited for more than the call in progress");
  // …and answered before the measurement rendered again.
  assert.ok(!callsBetween(trace, arrived, answered).includes("memo_render"), "the measurement rendered before answering");
  // The measurement still had renders to make, or this proved nothing.
  assert.ok(callsBetween(trace, answered, outOf(trace, wired)).includes("memo_render"), "the measurement was over");
  await w.close();
});

test("a request made during the guess's renders is answered before its next render, and with no crew the guess ranks the likeliest eight", { timeout: TIMEOUT }, async (t) => {
  const w = await workerFor(t, { seed: SEED });
  const { first, other } = await taught(w);
  await w.send({ type: "edit_begin", id: first });
  // The guess asks main for a crew, is answered with none (`?farm=0`), and
  // renders the likeliest eight on the worker's thread.
  const play = { type: "render", id: other };
  w.post(play, { during: { call: "memo_render", nth: 1 } });
  const ask = { type: "guess", token: 1 };
  const at = w.post(ask);
  const [guess] = await w.answers(ask);
  const [render] = await w.answers(play);
  assert.ok(render.buffer.length > 0, "the render was answered with its sound");
  assert.equal(w.repliesOf("farm_want", { after: at }).length, 1, "the guess asked for a crew");
  assert.ok(guess.data && guess.data.guesses, "the guess ranked");
  assert.equal(guess.data.planned, 8, "with no crew, the floor's eight");
  assert.ok(guess.data.total > 8, "more candidates than the floor ranks");
  assert.ok(guess.data.rendered <= 8);

  const trace = await w.trace();
  const { posted, arrived, answered } = served(trace, "render", render);
  assert.deepEqual(callsBetween(trace, posted, arrived), [], "the request waited for more than the call in progress");
  const between = callsBetween(trace, arrived, answered);
  assert.ok(!between.some((c) => c === "memo_render" || c.startsWith("guess_")), "the guess went on before answering");
  assert.ok(answered < outOf(trace, guess), "the request waited for the whole guess");
  await w.close();
});

test("a pick made while a spare offer grows is answered before the spare's next step, and leaving the patch drops the spare at once", { timeout: TIMEOUT }, async (t) => {
  const w = await workerFor(t, { seed: SEED });
  const tree = await treeOf(w, 1);
  // An offer to answer, grown first (a short walk).
  const [grown] = await w.send({ type: "perform_offer", req: 1, tree, overrides: [], locks: [], steps: 6 });
  assert.ok(grown.offer && grown.offer.tree, "an offer to answer grew");
  // A spare far longer than the checks (`bg`, as the page asks for one
  // nobody has claimed); the pick during its third step, and PERFORM leaving
  // the patch (`retire`) during its sixth.
  const PICK = 3;
  const SPARE = 2;
  const pick = { type: "perform_record", req: PICK, tree, overrides: [], offer: JSON.stringify(grown.offer.tree), took: false };
  w.post(pick, { during: { call: "perform_job_step", nth: 3 } });
  w.post({ type: "retire", reqs: [SPARE] }, { during: { call: "perform_job_step", nth: 6 } });
  const [spare] = await w.send({ type: "perform_offer", req: SPARE, tree, overrides: [], locks: [], steps: 400, bg: true });
  assert.equal(spare.error, "retired", "the spare was dropped, not finished");
  const [recorded, status] = await w.answers(pick);
  assert.equal(recorded.recorded, true, "the pick was recorded");
  assert.ok(status.ratings, "and the ratings it left came with it");

  const trace = await w.trace();
  const picked = served(trace, "perform_record", status);
  assert.deepEqual(callsBetween(trace, picked.posted, picked.arrived), [], "the pick waited for more than the step in progress");
  assert.ok(!callsBetween(trace, picked.arrived, picked.answered).includes("perform_job_step"), "the spare stepped before the pick was answered");
  // The spare was still growing after the pick, or this proved nothing.
  assert.ok(callsBetween(trace, picked.answered, outOf(trace, spare)).includes("perform_job_step"), "the spare was over before the pick");
  // Retired at its next breath: no step after the page left.
  const left = served(trace, "retire", spare);
  assert.deepEqual(callsBetween(trace, left.posted, left.arrived), [], "the retire waited for more than the step in progress");
  assert.ok(!callsBetween(trace, left.arrived, left.answered).includes("perform_job_step"), "the spare stepped after the page left it");
  await w.close();
});
