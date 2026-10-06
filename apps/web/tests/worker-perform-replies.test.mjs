// How the worker answers PERFORM's requests when the engine throws, read out
// of worker.js itself. Run: node --test apps/web/tests
//
// Every PERFORM request is answered exactly once. An ordinary throw is
// answered with the request's own reply, empty and carrying the error. A trap
// (a wasm RuntimeError: the engine is gone) is not answered there: it is
// rethrown, and `runMessage` answers it with the fatal `engine_error` that
// names the request by `req` and latches `poisoned`. Answered first with its
// own reply, the page said "the walk failed on this sound: try again" about a
// request no engine would ever run again, and heard of the crash only after.
//
// worker.js boots an engine on load, so `performReply`, `measure` and
// `walkRun` are lifted out of its source and run against a stub engine.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../worker.js", import.meta.url), "utf8");

// The source of `[async ]function name(…) { … }`, braces matched.
function lift(name) {
  let at = src.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `worker.js has no function ${name}`);
  if (src.slice(at - 6, at) === "async ") at -= 6;
  let depth = 0;
  for (let i = src.indexOf("{", at); i < src.length; i++) {
    if (src[i] === "{") depth++;
    if (src[i] === "}" && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

// What `wasm-bindgen` throws out of a trapped engine.
const trap = () => {
  const e = new Error("unreachable");
  e.name = "RuntimeError";
  return e;
};

function harness(engine) {
  const posts = [];
  const make = new Function(
    "engine", "post", "answer", "breathe", "laneOf", "idleOnly", "laterWaiting", "lanes", "LATER", "beginLongOp", "endLongOp",
    `${lift("isFatal")}\n${lift("performReply")}\n${lift("measure")}\n${lift("walkRun")}\nreturn { performReply, measure, walkRun };`,
  );
  const fns = make(
    engine,
    (m) => posts.push(m),
    // A reply to `m` (worker.js `answer`): its request's number aside, a post.
    (m, msg) => posts.push(msg),
    async () => false,
    () => 1,
    () => false,
    () => false,
    [[], [], []],
    2,
    () => {},
    () => {},
  );
  return { ...fns, posts };
}

test("a trap in a PERFORM reply is rethrown, not answered as an empty reply", () => {
  const { performReply, posts } = harness({});
  assert.throws(() => performReply({ req: 7 }, "perform_grafted", "graft", false, () => { throw trap(); }), /unreachable/);
  assert.deepEqual(posts, []);
});

test("an ordinary throw in a PERFORM reply is answered with the error", () => {
  const { performReply, posts } = harness({});
  performReply({ req: 7 }, "perform_grafted", "graft", false, () => { throw new Error("bad tree"); });
  assert.deepEqual(posts, [{ type: "perform_grafted", req: 7, graft: null, error: "bad tree" }]);
});

test("a measurement the engine traps in is rethrown, not answered", async () => {
  const { measure, posts } = harness({
    perform_wire_plan: () => JSON.stringify([{ tree: "{}", key: "k" }]),
    memo_render: () => { throw trap(); },
  });
  await assert.rejects(measure({ req: 3, tree: "{}" }), /unreachable/);
  assert.deepEqual(posts.filter((p) => p.type === "perform_wired"), []);
});

test("a measurement that throws otherwise is answered with the error", async () => {
  const { measure, posts } = harness({
    perform_wire_plan: () => { throw new Error("no standardizer"); },
  });
  await measure({ req: 3, tree: "{}" });
  assert.deepEqual(posts, [{ type: "perform_wired", req: 3, data: null, error: "no standardizer" }]);
});

test("a walk the engine traps in is rethrown, not answered, and its job is not dropped", async () => {
  let dropped = 0;
  const { walkRun, posts } = harness({
    perform_offer_begin: () => JSON.stringify({ job: 1 }),
    perform_job_step: () => { throw trap(); },
    perform_job_drop: () => { dropped++; },
  });
  await assert.rejects(walkRun({ type: "perform_offer", req: 5, tree: "{}" }), /unreachable/);
  assert.deepEqual(posts.filter((p) => p.type === "perform_offered"), []);
  assert.equal(dropped, 0, "a trapped engine was called again");
});

test("a walk that throws otherwise is answered with the error, and its job dropped", async () => {
  let dropped = 0;
  const { walkRun, posts } = harness({
    perform_offer_begin: () => JSON.stringify({ job: 1 }),
    perform_job_step: () => { throw new Error("bad step"); },
    perform_job_drop: () => { dropped++; },
  });
  await walkRun({ type: "perform_offer", req: 5, tree: "{}" });
  assert.deepEqual(posts, [{ type: "perform_offered", req: 5, offer: null, error: "bad step" }]);
  assert.equal(dropped, 1);
});
