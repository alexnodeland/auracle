// The worker's lanes, read out of worker.js itself. Run: node --test apps/web/tests
//
// worker.js boots an engine on load: tests/worker runs it whole, over the
// built engine (`make worker-test`). This needs no engine and runs in
// milliseconds: it lifts `laneOf` and `blocked` out of its source and runs
// them as written, beside a model of how the worker serves its lanes: every `now`
// request first, in arrival order, then the first `soon` (then `later`)
// request that is not blocked. That model is `serveNow` and `nextLong`.
// The rule for a request that arrives while a long job holds the floor runs
// the worker's own `serveNow`, `breathe`, `guessRun` and `measure` (below).
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

const [NOW, SOON, LATER] = [0, 1, 2];
// Walking and a boot crew both on: the case where the most is blocked.
const make = new Function(
  "NOW", "SOON", "LATER", "walking", "bootCrewLive",
  `${lift("laneOf")}\n${lift("blocked")}\nreturn { laneOf, blocked };`,
);
const { laneOf, blocked } = make(NOW, SOON, LATER, () => true, () => true);

// The order the worker would answer `msgs`, all queued before it looks.
function served(msgs) {
  const lanes = [[], [], []];
  msgs.forEach((m) => lanes[laneOf(m)].push(m));
  const out = [...lanes[NOW]];
  for (const lane of [SOON, LATER]) {
    for (;;) {
      const i = lanes[lane].findIndex((q) => !blocked(q));
      if (i < 0) break;
      out.push(lanes[lane].splice(i, 1)[0]);
    }
  }
  return out.map((m) => m.type);
}

test("a sound of your own's three requests share one lane and are never blocked", () => {
  const types = ["own_sound_set", "own_sound", "own_sound_clear"];
  const lanes = new Set(types.map((type) => laneOf({ type })));
  assert.equal(lanes.size, 1, "own-sound requests split across lanes");
  for (const type of types) assert.equal(blocked({ type }), false, `${type} waits on a walk`);
});

test("a clear after a set is answered after it, and so is a read", () => {
  assert.deepEqual(
    served([{ type: "own_sound_set" }, { type: "own_sound_clear" }]),
    ["own_sound_set", "own_sound_clear"],
  );
  assert.deepEqual(
    served([{ type: "own_sound_set" }, { type: "own_sound" }, { type: "own_sound_clear" }]),
    ["own_sound_set", "own_sound", "own_sound_clear"],
  );
});

test("the own-sound requests never await the wirings fetch", () => {
  for (const type of ["own_sound_set", "own_sound"]) {
    const at = src.indexOf(`case "${type}": {`);
    assert.ok(at >= 0, `dispatch has no ${type}`);
    const body = src.slice(at, src.indexOf("break;", at));
    assert.doesNotMatch(body, /await/, `${type} awaits inside dispatch`);
  }
});

test("a face the player is looking at goes before a measurement nobody waits on, never before PERFORM's own", () => {
  const FACES = 3;
  const idle = src.match(/^const idleOnly = .*$/m);
  assert.ok(idle, "worker.js has no idleOnly");
  const build = (lanes) => new Function(
    "SOON", "LATER", "FACES", "lanes", "floor", "blocked",
    `${idle[0]}\n${lift("seenFaceWaiting")}\n${lift("nextLong")}\nreturn nextLong;`,
  )(SOON, LATER, FACES, lanes, null, () => false);
  const order = (lanes) => {
    const next = build(lanes);
    const out = [];
    for (let m = next(); m; m = next()) out.push(m.name);
    return out;
  };
  // PATCH's outline, a bank face and a background re-check, all waiting.
  assert.deepEqual(order([[], [], [{ type: "perform_wire", bg: true, name: "recheck" }],
    [{ type: "face_render", seen: true, name: "outline" }, { type: "face_render", name: "bank" }]]),
  ["outline", "recheck", "bank"]);
  // PERFORM measuring the sound it plays is not idle: it goes first.
  assert.deepEqual(order([[], [], [{ type: "perform_wire", name: "measure" }],
    [{ type: "face_render", seen: true, name: "outline" }]]),
  ["measure", "outline"]);
  // With nothing looked at, a background measurement still goes before the faces lane.
  assert.deepEqual(order([[], [], [{ type: "perform_wire", bg: true, name: "recheck" }],
    [{ type: "face_render", name: "bank" }]]),
  ["recheck", "bank"]);
  // And a measurement nobody waits on gives way to a looked-at face mid-run.
  assert.match(lift("measure"), /idleOnly\(m\) && \(laterWaiting\(\) \|\| seenFaceWaiting\(lanes\)\)/);
});

test("a preset row's face renders after everything the player is waiting on, a background measurement too", () => {
  const FACES = 3;
  const idle = src.match(/^const idleOnly = .*$/m);
  const next = (lanes) => new Function(
    "SOON", "LATER", "FACES", "lanes", "floor", "blocked",
    `${idle[0]}\n${lift("seenFaceWaiting")}\n${lift("nextLong")}\nreturn nextLong;`,
  )(SOON, LATER, FACES, lanes, null, () => false);
  // Every kind of long work queued at once, each in the lane `laneOf` gives it.
  const msgs = [
    { type: "face_render", name: "preset face" },
    { type: "perform_wire", bg: true, name: "background measurement" },
    { type: "cable_levels", name: "cable probe" },
    { type: "guess", name: "guess" },
    { type: "fit", name: "refit" },
    { type: "perform_wire", name: "PERFORM's measurement" },
    { type: "perform_offer", name: "pressed offer" },
  ];
  const laneWithFaces = new Function("NOW", "SOON", "LATER", "FACES", `${lift("laneOf")}\nreturn laneOf;`)(NOW, SOON, LATER, FACES);
  const lanes = [[], [], [], []];
  for (const m of msgs) lanes[laneWithFaces(m)].push(m);
  // An open, a ▶ or an edit is `now`, served before any of these starts.
  for (const type of ["load_preset", "edit_begin", "render", "edit_structure"]) assert.equal(laneWithFaces({ type }), NOW, type);
  const order = [];
  const take = next(lanes);
  for (let m = take(); m; m = take()) order.push(m.name);
  assert.equal(order.length, msgs.length);
  assert.equal(order[order.length - 1], "preset face");
});

// A request the player makes while a long job holds the floor (the model's
// guess, PERFORM's measurement) is served before that job's next render, so
// it waits at most for the render in progress when it arrived: a wasm call
// cannot be interrupted, and the job answers the `now` lane between renders
// (`breathe`). The worker's own `yieldToQueue`, `serveNow`, `breathe`,
// `holdFloor`, `guessRun` and `measure` run here, over an engine that records
// each render and the requests it served. A request "posted during render n"
// is queued on a later turn of the event loop, as a message posted to a
// worker that is inside a call is delivered only once the job gives the
// event loop a turn: so the job must yield (`yieldToQueue`) and then serve
// the lane (`serveNow`), or the request waits for the next render too.
const line = (re) => {
  const m = src.match(re);
  assert.ok(m, `worker.js has no ${re}`);
  return m[0];
};

function floorJobs() {
  const log = [];
  const lanes = [[], [], [], []];
  const owed = new Set();
  const during = new Map();
  let renders = 0;
  const jobs = () => [...owed].map((t) => ({ key: t, tree: t }));
  const engine = {
    memo_render(tree) {
      log.push(`render ${tree}`);
      owed.delete(tree);
      const posted = during.get(++renders);
      if (posted) setTimeout(() => lanes[laneOf(posted)].push(posted), 0);
      return true;
    },
    guess_plan: () => JSON.stringify({ jobs: jobs() }),
    guess_rank: () => JSON.stringify({ guesses: [] }),
    edit_tree_json: () => "the bench",
    perform_wire_plan: () => JSON.stringify(jobs()),
    perform_wire_known: () => "{}",
  };
  const fns = new Function(
    "NOW", "SOON", "LATER", "FACES", "lanes", "floor", "walking", "bootCrewLive", "engine", "post", "answer", "runMessage", "schedulePump", "beginLongOp", "endLongOp",
    [
      line(/^const yieldToQueue = .*$/m), line(/^const GUESS_FLOOR = .*$/m), line(/^const GUESS_BUDGET_MS = .*$/m),
      line(/^const idleOnly = .*$/m), line(/^const laterWaiting = .*$/m), line(/^const bgWaits = .*$/m),
      lift("laneOf"), lift("blocked"), lift("seenFaceWaiting"), lift("isFatal"), lift("performReply"),
      lift("serveNow"), lift("breathe"), lift("holdFloor"), lift("guessRun"), lift("measure"),
      // Each holding the floor, as `dispatch` runs them.
      "return { guessRun: (m) => holdFloor(m, () => guessRun(m)), measure: (m) => holdFloor(m, () => measure(m)) };",
    ].join("\n"),
  )(
    NOW, SOON, LATER, 3, lanes, null, () => false, () => false, engine,
    (m) => log.push(`reply ${m.type}`),
    // A reply to `m` from after an await (worker.js `answer`): its request's
    // number aside, a reply like any other.
    (m, msg) => log.push(`reply ${msg.type}`),
    async (m) => log.push(`served ${m.type}`),
    () => {},
    () => {},
    () => {},
  );
  return {
    ...fns,
    log,
    lanes,
    owe: (...trees) => trees.forEach((t) => owed.add(t)),
    // `m` is posted to the worker while render `n` runs.
    during: (n, m) => during.set(n, m),
  };
}

test("a knob turned while the model's guess renders is answered before the guess's next render", async () => {
  const w = floorJobs();
  w.owe("g1", "g2", "g3");
  w.during(1, { type: "edit_param" });
  await w.guessRun({ type: "guess" });
  assert.deepEqual(w.log, ["render g1", "served edit_param", "render g2", "render g3", "reply guess"]);
});

test("an open while PERFORM's background measurement renders is answered before its next render", async () => {
  const w = floorJobs();
  w.owe("p1", "p2", "p3");
  w.during(2, { type: "edit_begin" });
  await w.measure({ type: "perform_wire", bg: true, req: 1, tree: "t" });
  assert.deepEqual(w.log, ["render p1", "render p2", "served edit_begin", "render p3", "reply perform_wired"]);
});

test("the guess gives way to long work the player asks for, at the front of later with what it spent", async () => {
  const w = floorJobs();
  w.owe("g1", "g2");
  w.during(1, { type: "explain" });
  const guess = { type: "guess" };
  await w.guessRun(guess);
  assert.deepEqual(w.log, ["render g1"]);
  assert.equal(w.lanes[LATER][0], guess);
  assert.equal(typeof guess.spent, "number");
});
