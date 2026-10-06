// Request ids, read out of the app's own source. Run: node --test apps/web/tests
//
// Main numbers every request it sends (`rid`, main.js `send`), and the worker
// carries the number back on every reply to it (`re`, worker.js `post` and
// `answer`), with nothing on what it says of its own accord (`news`). Neither
// file can be imported (each boots on load), so this lifts the functions out
// of their source and runs them as written: main's `send` over a stand-in
// worker, and the worker's reply path (`reOf`, `emit`, `post`, `answer`,
// `news`, `engineError`, `runMessage`, `renderJoined`) over handlers that post
// the way `dispatch`'s cases do, and over `dispatch`'s own bench cases and a
// generation's replies on a stand-in engine. The list of requests the worker
// never answers (the fixture's UNANSWERED) is read against the worker's
// source, both ways.
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
// as `dispatch` (async, as `dispatch` is: a throw is a rejection). Or, with
// `lifts`, more of worker.js as written (`dispatch` itself among them), over
// `engine` and the `stubs` it calls; `prelude` declares what they share, and
// `returns` names more of it to hand back.
function worker(handlers, { lifts = [], engine = {}, stubs = {}, prelude = [], returns = [] } = {}) {
  const out = [];
  const self = { postMessage: (msg) => out.push(msg) };
  const quiet = { error() {} };
  let w = null;
  const own = lifts.includes("dispatch");
  const names = ["self", "console", "engine", ...Object.keys(stubs), ...(own ? [] : ["dispatch"])];
  const values = [self, quiet, engine, ...Object.values(stubs), ...(own ? [] : [async (m) => handlers[m.type](m, w)])];
  const handed = ["post", "answer", "news", "reOf", "runMessage", "renderJoined", ...lifts, ...returns];
  w = new Function(
    ...names,
    [
      "let answering = null;",
      "let poisoned = null;",
      ...prelude,
      lift(workerSrc, "reOf"),
      lift(workerSrc, "emit"),
      line(workerSrc, /^const post = .*$/m),
      line(workerSrc, /^const answer = .*$/m),
      line(workerSrc, /^const news = .*$/m),
      lift(workerSrc, "isFatal"),
      lift(workerSrc, "engineError"),
      lift(workerSrc, "runMessage"),
      lift(workerSrc, "renderJoined"),
      ...lifts.map((name) => lift(workerSrc, name)),
      `return { ${handed.join(", ")} };`,
    ].join("\n"),
  )(...values);
  w.out = out;
  return w;
}

// Each request's replies, in order, by the number they carry back.
const repliesTo = (out, rid) => out.filter((r) => [].concat(r.re ?? []).includes(rid));
// A request's replies are all stamped, and all but the last say `more`.
function lastIsLast(replies, what) {
  assert.ok(replies.length > 0, `${what}: no reply`);
  replies.forEach((r, i) => {
    if (i < replies.length - 1) assert.equal(r.more, true, `${what}: ${r.type} is not its last reply, and says so`);
    else assert.equal(r.more, undefined, `${what}: ${r.type} is its last reply`);
  });
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

// The engine the bench's cases call, answering as a working one does.
const benchEngine = () => ({
  edit_structure_apply: () => "",
  edit_set_tree_apply: () => "",
  edit_known_makeup: () => 0.8,
  edit_revet() {},
  edit_tree_json: () => '{"tree":1}',
  perform_knobs: () => "[]",
  edit_makeup: () => 1,
  edit_render: () => [0, 0, 0],
  edit_describe: () => "{}",
  edit_vet_ok: () => true,
  edit_vet_silent: () => false,
  sample_rate: () => 48000,
  edit_utility: () => "{}",
  edit_explain: () => "{}",
  tree_json_of: () => '{"tree":2}',
  makeup_of: () => 1,
  edit_begin: () => true,
});

test("a bench edit's early tree and an open's early tree are not its last reply: the bench is", async () => {
  const w = worker({}, { lifts: ["dispatch", "postLiveTree", "postBench"], engine: benchEngine() });
  await w.runMessage({ type: "edit_structure", op: { insert: "vcf" }, rid: 1 });
  await w.runMessage({ type: "edit_set_tree", json: "{}", rid: 2 });
  await w.runMessage({ type: "edit_set_tree", json: "{}", restore: true, rid: 3 });
  await w.runMessage({ type: "edit_begin", id: 4, rid: 4 });
  assert.deepEqual(repliesTo(w.out, 1).map((r) => r.type), ["tree_json", "bench"]);
  assert.deepEqual(repliesTo(w.out, 2).map((r) => r.type), ["tree_json", "bench"]);
  // An undo with its makeup known goes to the voices early too.
  assert.deepEqual(repliesTo(w.out, 3).map((r) => r.type), ["tree_json", "bench"]);
  assert.deepEqual(repliesTo(w.out, 4).map((r) => r.type), ["bench_opening", "bench"]);
  for (const rid of [1, 2, 3, 4]) lastIsLast(repliesTo(w.out, rid), `request ${rid}`);
  assert.equal(w.out.length, 8, "nothing unstamped");
});

test("a generation answers its refine from farm messages and its own queued walks: progress and children, then refined", async () => {
  const w = worker({ breed_step: (m, w) => w.genLanded(g, 6) }, {
    lifts: ["genProgress", "genLanded", "genFinish", "genDrop"],
    engine: { ranked: () => "[]", lineage: () => "[]", refine_retired: () => "[3]" },
    stubs: {
      genEta: () => 0, farmCrew: () => 2, refineRetiring: () => [], engineRatings: () => [], refineReason: () => null,
      logNote() {}, tasteViews: () => ({}), status: () => ({}), benchBelief: () => null,
      walkAbandon() {}, walkBusy: () => false, walkInflight: new Map(), crewReap() {}, crewIdle() {}, schedulePump() {},
    },
    prelude: ["let gen = null;", "const setGen = (g) => { gen = g; };"],
    returns: ["setGen"],
  });
  const g = {
    to: { type: "refine", rid: 7 }, generation: 3, parents: [11, 12], total: 2, next: 0, walked: 0,
    results: new Map(), started: new Map(), born: [], reasons: [], farmed: true, stopped: false,
  };
  w.setGen(g);
  // A child absorbed from a farm message (nothing running), and one walked
  // here, as the worker's own queued `breed_step` (no number of its own).
  w.genProgress(g);
  w.genLanded(g, 5);
  await w.runMessage({ type: "breed_step" });
  w.genFinish(g);
  const replies = repliesTo(w.out, 7);
  assert.deepEqual(replies.map((r) => r.type), ["refine_progress", "refine_child", "refine_child", "refine_progress", "refined"]);
  lastIsLast(replies, "refine");
  assert.equal(w.out.length, replies.length, "every reply names the refine");
});

test("a calibration the engine cannot make is answered all the same, and a trap with the crash", async () => {
  const trap = () => {
    const e = new Error("unreachable");
    e.name = "RuntimeError";
    return e;
  };
  let fail = () => new TypeError("engine.calibration is not a function");
  const w = worker({}, {
    lifts: ["dispatch"],
    engine: { calibration: () => { throw fail(); } },
    stubs: { engineForecasts: () => [], modelFacts: () => ({}) },
  });
  await w.runMessage({ type: "calibration", rid: 1 });
  assert.deepEqual(w.out, [{ type: "calibration", calib: null, re: 1 }]);
  fail = trap;
  await w.runMessage({ type: "calibration", rid: 2 });
  assert.deepEqual(w.out.slice(1).map((r) => [r.type, r.request, r.fatal, r.re]), [["engine_error", "calibration", true, 2]]);
});

test("the requests the tap does not wait on are exactly the ones the worker never answers", () => {
  const list = fixturesSrc.match(/const UNANSWERED = \[([\s\S]*?)\];/);
  assert.ok(list, "fixtures.js has no UNANSWERED");
  const unanswered = [...list[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
  assert.ok(unanswered.length > 0);
  const dispatch = lift(workerSrc, "dispatch");
  const onArrival = workerSrc.slice(workerSrc.indexOf("self.onmessage = (e) => {"), workerSrc.indexOf("function renderJoined("));
  const replies = /\b(post|answer|postBench|postLiveTree|performReply|postClip)\(/;
  const cases = [...dispatch.matchAll(/case "([a-z_]+)":/g)].map((x) => [x[1], dispatch.slice(x.index, dispatch.indexOf("break;", x.index))]);
  const arrivals = [...onArrival.matchAll(/if \(m\.type === "([a-z_]+)"\) \{/g)].map((x) => [x[1], onArrival.slice(x.index, onArrival.indexOf("return;", x.index))]);

  // Each one listed is never answered: a case that posts nothing, or a
  // branch taken on arrival that may answer the requests it acts on, never
  // itself (outside `runMessage` nothing is answered by `post`).
  for (const type of unanswered) {
    const c = cases.find(([t]) => t === type);
    const a = arrivals.find(([t]) => t === type);
    assert.ok(c || a, `the worker has no ${type}`);
    if (c) assert.doesNotMatch(c[1], replies, `the worker answers ${type}`);
    else assert.doesNotMatch(a[1], /\bpost\(|answer\(m,/, `the worker answers ${type}`);
  }

  // And each one the worker leaves unanswered is listed. A case answered by
  // a helper it hands the request to is checked through the helper; the
  // worker's own queued work is not a request main can send.
  const through = {
    faces: ["faces"], face_cancel: ["faceCancel"], refine: ["breedOpen"], refine_from: ["evolveFrom"],
    perform_wire: ["measure"], perform_offer: ["walkRun"], perform_drift: ["walkRun"],
    guess: ["guessCrewPhase", "guessRun"],
  };
  const internal = ["face_lookup", "face_render", "breed_step"];
  const answersIt = /\b(answer|performReply)\(m\b|\bpost\(/;
  for (const [type, body] of cases) {
    if (replies.test(body) || unanswered.includes(type)) continue;
    if (internal.includes(type)) {
      assert.match(workerSrc, new RegExp(`\\{ type: "${type}"`), `the worker queues ${type} itself`);
      continue;
    }
    assert.ok(through[type], `the worker never answers ${type}, and the tap would wait for it: list it in UNANSWERED`);
    for (const helper of through[type]) assert.match(lift(workerSrc, helper), answersIt, `${helper} answers ${type}`);
  }
  for (const [type, body] of arrivals) {
    if (/answer\(m,/.test(body)) continue;
    assert.ok(unanswered.includes(type), `${type} is never answered, and the tap would wait for it: list it in UNANSWERED`);
  }

  // Every request main sends is one of these, so none falls through
  // `dispatch` unanswered; and none is the worker's own work.
  const pages = ["main.js", "perform.js", "patch.js", "explain.js", "takes.js", "audio-in.js", "taste.js", "booth.js", "midi.js"];
  const sent = new Set();
  for (const page of pages) {
    const src = read(`../${page}`);
    for (const x of src.matchAll(/\b(?:send|queueStruct)\(\s*\{\s*(?:\.\.\.\w+,\s*)?type: "([a-z_]+)"/g)) sent.add(x[1]);
    for (const x of src.matchAll(/\brequest\("([a-z_]+)"/g)) sent.add(x[1]);
  }
  assert.ok(sent.has("edit_param") && sent.has("perform_wire") && sent.has("init"), "the sends were found");
  const handled = new Set([...cases.map(([t]) => t), ...arrivals.map(([t]) => t)]);
  for (const type of sent) {
    assert.ok(handled.has(type), `main sends ${type}, which the worker has no case for`);
    assert.ok(!internal.includes(type), `main sends ${type}, the worker's own work`);
  }
});
