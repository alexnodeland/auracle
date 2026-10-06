// Request ids, read out of the app's own source. Run: node --test apps/web/tests
//
// Main numbers every request it sends (`rid`, main.js `send`), and the worker
// carries the number back on every reply to it (`re`, worker.js `post` and
// `answer`), with nothing on what it says of its own accord (`news`). Neither
// file can be imported (each boots on load), so this lifts the functions out
// of their source and runs them as written: main's `send` over a stand-in
// worker, and the worker's reply path (`reOf`, `emit`, `post`, `answer`,
// `news`, `engineError`, `runMessage`, `renderJoined`) over handlers that post
// the way `dispatch`'s cases do.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const workerSrc = read("../worker.js");
const mainSrc = read("../main.js");
const fixturesSrc = read("../../../tests/web/fixtures.js");

// The source of `[async ]function name(…) { … }` in `src`, braces matched.
function lift(src, name) {
  let at = src.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `no function ${name}`);
  if (src.slice(at - 6, at) === "async ") at -= 6;
  let depth = 0;
  for (let i = src.indexOf("{", at); i < src.length; i++) {
    if (src[i] === "{") depth++;
    if (src[i] === "}" && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}
const line = (src, re) => {
  const m = src.match(re);
  assert.ok(m, `no ${re}`);
  return m[0];
};

// The worker's reply path, posting into `out`, with `handlers[type](m, w)`
// as `dispatch` (async, as `dispatch` is: a throw is a rejection).
function worker(handlers) {
  const out = [];
  const self = { postMessage: (msg) => out.push(msg) };
  const quiet = { error() {} };
  let w = null;
  const dispatch = async (m) => handlers[m.type](m, w);
  w = new Function(
    "self", "dispatch", "console",
    [
      "let answering = null;",
      "let poisoned = null;",
      lift(workerSrc, "reOf"),
      lift(workerSrc, "emit"),
      line(workerSrc, /^const post = .*$/m),
      line(workerSrc, /^const answer = .*$/m),
      line(workerSrc, /^const news = .*$/m),
      lift(workerSrc, "isFatal"),
      lift(workerSrc, "engineError"),
      lift(workerSrc, "runMessage"),
      lift(workerSrc, "renderJoined"),
      "return { post, answer, news, reOf, runMessage, renderJoined };",
    ].join("\n"),
  )(self, dispatch, quiet);
  w.out = out;
  return w;
}

const turn = () => new Promise((r) => setTimeout(r, 0));

test("main numbers every request it sends, from 1, in one place, and leaves the request it was handed alone", () => {
  const posted = [];
  const send = new Function("worker", `let requestSeq = 0;\n${lift(mainSrc, "send")}\nreturn send;`)({
    postMessage: (msg, transfer) => posted.push({ msg, transfer }),
  });
  const buf = new ArrayBuffer(8);
  const asked = { type: "edit_param", addr: "a", value: 1 };
  send(asked);
  send({ type: "set_audition_clip", samples: buf }, [buf]);
  send({ type: "render", id: 3 });
  assert.deepEqual(posted.map((p) => p.msg.rid), [1, 2, 3]);
  assert.deepEqual(posted[0].msg, { type: "edit_param", addr: "a", value: 1, rid: 1 });
  assert.equal(asked.rid, undefined, "the caller's object is not numbered");
  assert.deepEqual(posted[1].transfer, [buf], "what is transferred still goes with it");
  assert.deepEqual(posted[2].transfer, []);
  // Every request main makes goes through `send`: nothing else posts to the
  // engine worker (`worker.postMessage`).
  assert.deepEqual(mainSrc.match(/\bworker\.postMessage\(/g), ["worker.postMessage("]);
});

test("a handler's replies carry its request's number, the worker's own news none", async () => {
  const w = worker({
    edit_structure: (m, w) => {
      w.news({ type: "busy" });
      w.post({ type: "tree_json", more: true });
      w.post({ type: "bench" });
      w.news({ type: "idle" });
    },
  });
  await w.runMessage({ type: "edit_structure", rid: 7 });
  assert.deepEqual(w.out, [{ type: "busy" }, { type: "tree_json", more: true, re: 7 }, { type: "bench", re: 7 }, { type: "idle" }]);
});

test("after an await nothing is taken for a reply unless it names its request", async () => {
  const w = worker({
    guess: async (m, w) => {
      w.post({ type: "early" });
      await turn();
      w.post({ type: "late" });
      w.answer(m, { type: "guess" });
    },
  });
  await w.runMessage({ type: "guess", rid: 4 });
  assert.deepEqual(w.out, [{ type: "early", re: 4 }, { type: "late" }, { type: "guess", re: 4 }]);
});

test("a request served while another's long job breathes is answered as itself, and the job as itself after", async () => {
  const w = worker({
    perform_wire: async (m, w) => {
      await turn(); // a breath: the player's request is served here
      await w.runMessage({ type: "edit_param", rid: 9 });
      w.answer(m, { type: "perform_wired" });
    },
    edit_param: (m, w) => w.post({ type: "bench" }),
  });
  const job = w.runMessage({ type: "perform_wire", rid: 8 });
  // While the job waits, something it did not ask for is the worker's own.
  w.post({ type: "log" });
  await job;
  assert.deepEqual(w.out, [{ type: "log" }, { type: "bench", re: 9 }, { type: "perform_wired", re: 8 }]);
});

test("a request whose handler throws, at once or later, is answered with engine_error carrying its number", async () => {
  const w = worker({
    describe: () => {
      throw new Error("no such id");
    },
    explain: async () => {
      await turn();
      throw new Error("later");
    },
  });
  await w.runMessage({ type: "describe", id: 3, rid: 11 });
  await w.runMessage({ type: "explain", rid: 12 });
  assert.deepEqual(w.out.map((r) => [r.type, r.request, r.re]), [["engine_error", "describe", 11], ["engine_error", "explain", 12]]);
});

test("a reply that already names its request keeps it, and what main did not send carries none", async () => {
  const w = worker({
    face_lookup: (m, w) => w.post({ type: "faces" }),
    retire: (m, w) => w.answer({ type: "perform_offer", rid: 2 }, { type: "perform_offered", error: "retired" }),
  });
  await w.runMessage({ type: "face_lookup" }); // the worker's own queued work
  await w.runMessage({ type: "retire", rid: 5 });
  assert.deepEqual(w.out, [{ type: "faces" }, { type: "perform_offered", error: "retired", re: 2 }]);
});

test("one render of an id answers everyone who asked: its reply names both requests", () => {
  const w = worker({});
  // ▶ on a sound whose background render is still queued: the player's
  // request takes its place, and answers it too.
  const queue = [{ type: "render", id: 5, bg: true, rid: 1 }];
  const now = { type: "render", id: 5, rid: 2 };
  assert.equal(w.renderJoined(queue, now), false, "the player's render is queued");
  assert.deepEqual(queue, []);
  assert.deepEqual(w.reOf(now), [2, 1]);
  // A background render asked for while the player's is queued is not
  // queued again: the one queued answers it.
  queue.push(now);
  assert.equal(w.renderJoined(queue, { type: "render", id: 5, bg: true, rid: 3 }), true);
  assert.deepEqual(w.reOf(queue[0]), [2, 1, 3]);
  // Another id, or two of the player's own, are two renders.
  assert.equal(w.renderJoined(queue, { type: "render", id: 6, rid: 4 }), false);
  assert.equal(w.renderJoined(queue, { type: "render", id: 5, rid: 5 }), false);
  assert.deepEqual(w.reOf(queue[0]), [2, 1, 3]);
});

test("the requests the tap does not wait on are the ones the worker never answers", () => {
  const list = fixturesSrc.match(/const UNANSWERED = \[([\s\S]*?)\];/);
  assert.ok(list, "fixtures.js has no UNANSWERED");
  const types = [...list[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
  assert.ok(types.length > 0);
  const dispatch = lift(workerSrc, "dispatch");
  const onArrival = workerSrc.slice(workerSrc.indexOf("self.onmessage = (e) => {"), workerSrc.indexOf("function renderJoined("));
  const replies = /\b(post|answer|postBench|postLiveTree|performReply|postClip)\(/;
  for (const type of types) {
    const at = dispatch.indexOf(`case "${type}":`);
    if (at >= 0) {
      const body = dispatch.slice(at, dispatch.indexOf("break;", at));
      assert.doesNotMatch(body, replies, `the worker answers ${type}`);
    } else {
      // Handled as it arrives: it may answer the requests it acts on, never
      // itself (outside `runMessage` nothing is answered by `post`).
      const at = onArrival.indexOf(`m.type === "${type}"`);
      assert.ok(at >= 0, `the worker has no ${type}`);
      const body = onArrival.slice(at, onArrival.indexOf("return;", at));
      assert.doesNotMatch(body, /\bpost\(|answer\(m,/, `the worker answers ${type}`);
    }
  }
});
