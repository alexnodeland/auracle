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
    "SOON", "LATER", "FACES", "lanes", "floor", "blocked", "backgroundStep",
    `${idle[0]}\n${lift("seenFaceWaiting")}\n${lift("nextLong")}\nreturn nextLong;`,
  )(SOON, LATER, FACES, lanes, null, () => false, () => true);
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
    "SOON", "LATER", "FACES", "lanes", "floor", "blocked", "backgroundStep",
    `${idle[0]}\n${lift("seenFaceWaiting")}\n${lift("nextLong")}\nreturn nextLong;`,
  )(SOON, LATER, FACES, lanes, null, () => false, () => true);
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

// A yield is one turn of the event loop, and several flows yield at once (the
// lane's drain, the pump, a long job's breath). A timer one set before
// another's long call fires right after that call, ahead of what arrived
// during it, in Chromium as in Node: so the worker's `yieldToQueue` yields
// again when its turn took longer than a turn. What "arrived during the call"
// is here is a task set during it, as a message posted to the worker mid-call
// is one.
test("a yield another flow's long call ran through lets in what arrived during that call before it goes on", async () => {
  const { yieldToQueue } = new Function(`${line(/^const YIELD_TURN_MS = .*$/m)}\n${lift("yieldToQueue")}\nreturn { yieldToQueue };`)();
  const log = [];
  // Another flow's turn comes first, and its call takes 60 ms…
  setTimeout(() => {
    const t = performance.now();
    // …during which a request arrives.
    setTimeout(() => log.push("the request that arrived during it"), 0);
    while (performance.now() - t < 60) { /* a render */ }
    log.push("the other flow's call");
  }, 0);
  await yieldToQueue();
  log.push("this flow goes on");
  assert.deepEqual(log, ["the other flow's call", "the request that arrived during it", "this flow goes on"]);
});

// No notes sounding unless a test says so: every background step may go.
function floorJobs({ held = false } = {}) {
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
    "backgroundHeld", "backgroundStep",
    [
      line(/^const YIELD_TURN_MS = .*$/m), lift("yieldToQueue"), line(/^const GUESS_FLOOR = .*$/m), line(/^const GUESS_BUDGET_MS = .*$/m),
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
    // A request served between the job's renders; one in the background
    // (`bg`: a dealt pair's sound, a warm-start card) is a render of its own.
    async (m) => {
      log.push(`served ${m.type}`);
      if (m.bg) engine.memo_render(m.what);
    },
    () => {},
    () => {},
    () => {},
    () => held,
    () => !held,
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

test("an open made while a background render runs between a measurement's renders is answered before the measurement's next", async () => {
  const w = floorJobs();
  w.owe("p1", "p2");
  // A dealt pair's sound waiting in the background: the measurement's first
  // breath serves it (render 2), and the open arrives during it.
  w.lanes[NOW].push({ type: "render", bg: true, what: "the pair's sound" });
  w.during(2, { type: "edit_begin" });
  await w.measure({ type: "perform_wire", req: 1, tree: "t" });
  assert.deepEqual(w.log, ["render p1", "served render", "render the pair's sound", "served edit_begin", "render p2", "reply perform_wired"]);
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

// The warm start's cards are measured while the player chooses, into the
// memo, so "teach it" inserts them without a render (worker.js `warmCard`).
// A card measured is not measured again while the card is open; the warm
// start offered again after SKIP deals cards whose φ the generations since
// may have pushed out of the memo, so it measures them again.
test("a warm-start card measured before SKIP is measured again when the warm start is offered again", () => {
  const lanes = [[], [], [], []];
  const measured = [];
  const engine = {
    preset_tree_json: (i) => `preset ${i}`,
    memo_render(tree) {
      measured.push(tree);
      return true;
    },
  };
  const w = new Function(
    "NOW", "lanes", "engine", "drainNow",
    [
      line(/^let warmCards = .*$/m), line(/^const warmMeasured = .*$/m), lift("warmCardsOrder"), lift("warmCard"),
      "return { warmCardsOrder, warmCard };",
    ].join("\n"),
  )(NOW, lanes, engine, () => {});
  // The lane serving every card queued, as the worker's drain does.
  const serve = () => {
    while (lanes[NOW].length) if (lanes[NOW].shift().type === "warm_card") w.warmCard();
  };
  // Dealt; the first card measured, then a pick of the second, which is
  // measured next; a pick's order sent again measures neither twice…
  w.warmCardsOrder([0, 1, 2]);
  w.warmCard();
  lanes[NOW].length = 0;
  w.warmCardsOrder([1, 0, 2]);
  w.warmCard();
  lanes[NOW].length = 0;
  w.warmCardsOrder([1, 0, 2]);
  assert.deepEqual(measured, ["preset 0", "preset 1"]);
  // …SKIP closes the card, and the warm start offered again deals the same
  // three: each is measured, the two from the first offer too.
  w.warmCardsOrder([]);
  serve();
  w.warmCardsOrder([0, 1, 2]);
  serve();
  assert.deepEqual(measured, ["preset 0", "preset 1", "preset 0", "preset 1", "preset 2"]);
});

// Background work steps aside while notes sound on a small machine (#288):
// the worker's own `setPlaying`, `backgroundHeld`, `backgroundStep`,
// `backgroundLater`, `backgroundResumed` and `backgroundTurn`, on a clock and
// timers the test moves by hand.
function playClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  const clock = {
    performance: { now: () => now },
    setTimeout: (fn, ms) => {
      timers.set(++seq, { at: now + ms, fn });
      return seq;
    },
    clearTimeout: (id) => timers.delete(id),
    // Move the clock on by `ms`, firing each timer due on the way, in order.
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
    get now() {
      return now;
    },
  };
  const woken = [];
  const w = new Function(
    "performance", "setTimeout", "clearTimeout", "schedulePump", "farmSink", "walkPump",
    [
      line(/^const PLAY_TAIL_MS = .*$/m), line(/^const PLAY_CAP_MS = .*$/m), line(/^const PLAY_TRICKLE_MS = .*$/m),
      line(/^let playSince = .*$/m), line(/^let playTail = .*$/m), line(/^let trickledAt = .*$/m),
      line(/^let trickleTimer = .*$/m), line(/^const backgroundWaiters = .*$/m),
      lift("setPlaying"), lift("backgroundHeld"), lift("backgroundStep"), lift("backgroundLater"),
      lift("backgroundResumed"), lift("backgroundTurn"),
      "return { setPlaying, backgroundHeld, backgroundStep, backgroundTurn };",
    ].join("\n"),
  )(clock.performance, clock.setTimeout, clock.clearTimeout, () => woken.push(clock.now), { wake() {} }, () => {});
  return { ...w, clock, woken };
}

test("while notes sound and for a second after, no background step goes, and then everything held back is woken", async () => {
  const p = playClock();
  assert.equal(p.backgroundStep(), true, "nothing sounding: it goes");
  p.setPlaying(true);
  assert.equal(p.backgroundStep(), false, "a note sounding: it waits");
  p.clock.advance(500);
  p.setPlaying(false);
  p.clock.advance(999);
  assert.equal(p.backgroundStep(), false, "the last note's tail: it still waits");
  const turn = p.backgroundTurn();
  let went = false;
  turn.then(() => {
    went = true;
  });
  p.clock.advance(1);
  assert.equal(p.backgroundHeld(), false, "a second after the last note");
  assert.ok(p.woken.includes(1_500), "the pump was woken when the hold ended");
  await turn;
  assert.ok(went, "the fill's turn came");
  assert.equal(p.backgroundStep(), true);
});

test("a note again within the tail keeps the hold, and its clock, going", () => {
  const p = playClock();
  p.setPlaying(true);
  p.clock.advance(600);
  p.setPlaying(false);
  p.clock.advance(500);
  p.setPlaying(true);
  p.clock.advance(5_000);
  assert.equal(p.backgroundStep(), false, "still held 6.1 s on");
  assert.equal(p.woken.length, 0, "the tail's timer did not end it");
});

test("past eight seconds of notes, one background step goes a second, and each turn wakes what waits", () => {
  const p = playClock();
  p.setPlaying(true);
  p.clock.advance(7_999);
  assert.equal(p.backgroundStep(), false, "under the cap");
  // The step that waited wakes everything when the cap comes.
  p.clock.advance(1);
  assert.deepEqual(p.woken, [8_000]);
  assert.equal(p.backgroundStep(), true, "the cap: one step");
  assert.equal(p.backgroundStep(), false, "and only one");
  p.clock.advance(999);
  assert.equal(p.backgroundStep(), false, "a second has not gone by");
  p.clock.advance(1);
  assert.deepEqual(p.woken, [8_000, 9_000], "woken for the next");
  assert.equal(p.backgroundStep(), true, "a second on, the next");
  // Let go: the hold ends a second later, the trickle with it.
  p.setPlaying(false);
  p.clock.advance(1_000);
  assert.equal(p.backgroundStep(), true);
  assert.equal(p.backgroundStep(), true, "not counted any more");
});

test("background work asked for while notes sound is not run at once, and the cap's turn wakes the pump for it", () => {
  let now = 0;
  const timers = [];
  const woken = [];
  const FACES = 3;
  const lanes = [[], [], [{ type: "cable_levels" }], []];
  const w = new Function(
    "NOW", "SOON", "LATER", "FACES", "lanes", "floor", "blocked", "performance", "setTimeout", "clearTimeout", "schedulePump", "farmSink", "walkPump",
    [
      line(/^const PLAY_TAIL_MS = .*$/m), line(/^const PLAY_CAP_MS = .*$/m), line(/^const PLAY_TRICKLE_MS = .*$/m),
      line(/^let playSince = .*$/m), line(/^let playTail = .*$/m), line(/^let trickledAt = .*$/m),
      line(/^let trickleTimer = .*$/m), line(/^const backgroundWaiters = .*$/m),
      lift("setPlaying"), lift("backgroundHeld"), lift("backgroundStep"), lift("backgroundLater"),
      lift("backgroundResumed"), lift("runnable"),
      "return { setPlaying, runnable };",
    ].join("\n"),
  )(NOW, SOON, LATER, FACES, lanes, null, () => false, { now: () => now },
    (fn, ms) => timers.push({ at: now + ms, fn }), () => {}, () => woken.push(now), null, () => {});
  assert.equal(w.runnable(), true, "nothing sounding: the pump runs it");
  w.setPlaying(true);
  assert.equal(w.runnable(), false, "a note sounding: no pump for it");
  // A gesture still is.
  lanes[NOW].push({ type: "edit_param" });
  assert.equal(w.runnable(), true);
  lanes[NOW].length = 0;
  assert.equal(timers.length, 1, "its turn is set");
  assert.equal(timers[0].at, 8_000, "at the cap");
  now = 8_000;
  timers[0].fn();
  assert.deepEqual(woken, [8_000], "the pump woken at the cap");
  assert.equal(w.runnable(), true, "and its step may go");
});

test("while notes sound, nothing from later or the faces lane starts, and soon work does", () => {
  const FACES = 3;
  const idle = src.match(/^const idleOnly = .*$/m);
  let open = false;
  const lanes = [[], [{ type: "perform_offer", name: "pressed offer" }], [{ type: "fit", name: "refit" }], [{ type: "face_render", name: "face" }]];
  const next = new Function(
    "SOON", "LATER", "FACES", "lanes", "floor", "blocked", "backgroundStep",
    `${idle[0]}\n${lift("seenFaceWaiting")}\n${lift("nextLong")}\nreturn nextLong;`,
  )(SOON, LATER, FACES, lanes, null, () => false, () => open);
  assert.equal(next().name, "pressed offer");
  assert.equal(next(), null, "the refit waits");
  assert.equal(lanes[LATER].length, 1);
  open = true;
  assert.equal(next().name, "refit");
  assert.equal(next().name, "face");
});

test("while notes sound, a background job holding the floor gives way at its next breath, and the player's does not", async () => {
  const bg = floorJobs({ held: true });
  bg.owe("p1", "p2");
  const left = { type: "perform_wire", bg: true, req: 1, tree: "t" };
  await bg.measure(left);
  assert.deepEqual(bg.log, ["render p1"]);
  assert.equal(bg.lanes[LATER][0], left, "back at the front of later");
  const own = floorJobs({ held: true });
  own.owe("p1", "p2");
  await own.measure({ type: "perform_wire", req: 2, tree: "t" });
  assert.deepEqual(own.log, ["render p1", "render p2", "reply perform_wired"]);
});

test("while notes sound, a background render in now waits, and a gesture is served", async () => {
  const lanes = [[{ type: "render", bg: true, name: "the pair's sound" }, { type: "edit_param", name: "a knob" }], [], [], []];
  let held = true;
  const served = [];
  const serveNow = new Function(
    "NOW", "SOON", "lanes", "floor", "blocked", "runMessage", "backgroundHeld", "backgroundStep",
    [line(/^const YIELD_TURN_MS = .*$/m), lift("yieldToQueue"), line(/^const bgWaits = .*$/m), lift("serveNow"), "return serveNow;"].join("\n"),
  )(NOW, SOON, lanes, null, () => false, async (m) => served.push(m.name), () => held, () => !held);
  await serveNow();
  assert.deepEqual(served, ["a knob"]);
  assert.equal(lanes[NOW].length, 1, "the pair's sound waits");
  held = false;
  await serveNow();
  assert.deepEqual(served, ["a knob", "the pair's sound"]);
});
