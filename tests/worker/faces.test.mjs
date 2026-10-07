// A face the engine already holds is answered at once, whatever long job
// holds the engine (docs/architecture/web-runtime.md § Faces).
//
// A pool member's face rides on its featurization, in the engine's memo. It
// used to be looked up only in `later`, and `later` waits while a long job
// holds the floor: on an engine slowed four times the bank's faces, and the
// bank's mean every face is drawn against, came 154 s after the warm start,
// when PERFORM's first measurement ended. worker.js runs here as it is, over
// the built engine, with no page (harness.mjs); the request is posted while
// the measurement renders (`during`), as main's arrives mid-render.
import test from "node:test";
import assert from "node:assert/strict";
import { workerFor, callsBetween, outOf } from "./harness.mjs";

const SEED = 1;
const TIMEOUT = 150_000;
// The engine's encoding of a face (`auracle_features::FACE_LEN`).
const FACE_LEN = 40 + 12 * 40 + 12;

test("a pool member's face is answered from the engine's memo during PERFORM's measurement, before its next render", { timeout: TIMEOUT }, async (t) => {
  const w = await workerFor(t, { seed: SEED });
  const [{ json: tree }] = await w.send({ type: "tree_json", id: 1 });
  // The bank's rows ask for their faces during the measurement's third render.
  const ids = [2, 3, 4, 5];
  const ask = { type: "faces", ids, trees: [], render: true };
  w.post(ask, { during: { call: "memo_render", nth: 3 } });
  const [wired] = await w.send({ type: "perform_wire", req: 1, tree, overrides: [] });
  const [faces] = await w.answers(ask);
  assert.ok(wired.data, "the measurement landed whole");

  // Answered with every face, none left pending for `later`.
  assert.deepEqual(faces.items.map((i) => i.id), ids, "every member asked for is in the answer");
  assert.deepEqual(faces.pending, [], "nothing waits for `later`");
  for (const it of faces.items) {
    assert.equal(it.face.length, FACE_LEN, `member ${it.id}'s face is a face`);
    assert.match(it.key, /^e\d+:q[^/]+:[0-9a-f]{32}\/[0-9a-f]{32}$/, "filed under its namespace and render key");
  }

  const trace = await w.trace();
  const posted = trace.findIndex((e) => e.ev === "posted" && e.type === "faces");
  const arrived = trace.findIndex((e, i) => i > posted && e.ev === "in" && e.type === "faces");
  const answered = outOf(trace, faces);
  assert.ok(posted >= 0 && arrived > posted && answered > arrived, "the request was posted, handed over and answered");
  // Answered before the measurement rendered again…
  assert.ok(!callsBetween(trace, arrived, answered).includes("memo_render"), "the measurement rendered before the faces were answered");
  // …which still had renders to make, or this proved nothing.
  assert.ok(callsBetween(trace, answered, outOf(trace, wired)).includes("memo_render"), "the measurement was over");
  await w.close();
});
