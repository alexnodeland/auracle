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
    `${idle[0]}\n${line(/^const playerAsked = .*$/m)}\n${lift("seenFaceWaiting")}\n${lift("nextLong")}\nreturn nextLong;`,
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
    `${idle[0]}\n${line(/^const playerAsked = .*$/m)}\n${lift("seenFaceWaiting")}\n${lift("nextLong")}\nreturn nextLong;`,
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

// No room made for the audio unless a test says so: every background step
// may go.
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
      line(/^const playerAsked = .*$/m),
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

// Background work makes room for the audio while it struggles and notes
// sound (#288): the worker's own `setRoom`, `backgroundHeld`,
// `backgroundStep`, `backgroundStepDone`, `backgroundLater`,
// `backgroundResumed` and `backgroundTurn`, on a clock and timers the test
// moves by hand. `playable`: the boot veil is down (nothing is held before).
const ROOM = [
  /^const ROOM_TAIL_MS = .*$/m, /^const ROOM_CAP_MS = .*$/m, /^const ROOM_REST_MS = .*$/m, /^const ROOM_STEP_STALE_MS = .*$/m,
  /^let roomSince = .*$/m, /^let roomTail = .*$/m, /^let playableSaid = .*$/m, /^let stepOut = .*$/m,
  /^let restedFrom = .*$/m, /^let restTimer = .*$/m, /^const backgroundWaiters = .*$/m,
];
const ROOM_FNS = ["setRoom", "backgroundHeld", "backgroundStep", "backgroundStepDone", "backgroundLater", "backgroundResumed", "backgroundTurn", "veilDown"];
function roomClock({ playable = true, extra = [], names = [], values = [] } = {}) {
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
    get timers() {
      return [...timers.values()];
    },
  };
  const woken = [];
  const w = new Function(
    "performance", "setTimeout", "clearTimeout", "schedulePump", "farmSink", "walkPump", ...names,
    [
      ...ROOM.map(line), ...ROOM_FNS.map(lift), ...extra,
      `return { ${[...ROOM_FNS, ...extra.map((e) => /function (\w+)\(/.exec(e)?.[1]).filter(Boolean)].join(", ")} };`,
    ].join("\n"),
  )(clock.performance, clock.setTimeout, clock.clearTimeout, () => woken.push(clock.now), { wake() {} }, () => {}, ...values);
  if (playable) w.veilDown();
  return { ...w, clock, woken };
}

test("while room is made and for a second after, no background step goes, and then everything held back is woken", async () => {
  const p = roomClock();
  assert.equal(p.backgroundStep(), true, "no room asked for: it goes");
  p.setRoom(true);
  assert.equal(p.backgroundStep(), false, "room made: it waits");
  p.clock.advance(500);
  p.setRoom(false);
  p.clock.advance(999);
  assert.equal(p.backgroundStep(), false, "the last note's tail: it still waits");
  const turn = p.backgroundTurn();
  let went = false;
  turn.then(() => {
    went = true;
  });
  p.clock.advance(1);
  assert.equal(p.backgroundHeld(), false, "a second after the word");
  assert.ok(p.woken.includes(1_500), "the pump was woken when the hold ended");
  await turn;
  assert.ok(went, "the fill's turn came");
  assert.equal(p.backgroundStep(), true);
});

test("nothing is held before the boot veil lifts, and room asked for under it counts from then", () => {
  const p = roomClock({ playable: false });
  p.setRoom(true);
  p.clock.advance(20_000);
  assert.equal(p.backgroundStep(), true, "keys under the veil hold no batch of the fill");
  assert.equal(p.backgroundHeld(), false);
  p.veilDown();
  assert.equal(p.backgroundStep(), false, "the veil down: held, the cap counted from now");
  p.clock.advance(7_999);
  assert.equal(p.backgroundStep(), false);
  p.clock.advance(1);
  assert.equal(p.backgroundStep(), true, "eight seconds after the veil");
});

test("room asked for again within the tail keeps the hold, and its clock, going", () => {
  const p = roomClock();
  p.setRoom(true);
  p.clock.advance(600);
  p.setRoom(false);
  p.clock.advance(500);
  p.setRoom(true);
  p.clock.advance(5_000);
  assert.equal(p.backgroundStep(), false, "still held 6.1 s on");
  assert.equal(p.woken.length, 0, "the tail's timer did not end it");
});

test("past the cap, background work goes a step at a time, each a rest after the last one ended", () => {
  const p = roomClock();
  p.setRoom(true);
  p.clock.advance(7_999);
  assert.equal(p.backgroundStep(), false, "under the cap");
  // The step that waited wakes everything when the cap comes.
  p.clock.advance(1);
  assert.deepEqual(p.woken, [8_000]);
  assert.equal(p.backgroundStep(), true, "the cap: one step");
  // A step on this thread runs 600 ms (a render) before the thread asks again.
  p.clock.advance(600);
  assert.equal(p.backgroundStep(), false, "it ended as the thread asked again: a rest from then");
  p.clock.advance(999);
  assert.equal(p.backgroundStep(), false, "a second has not gone by since it ended");
  p.clock.advance(1);
  assert.deepEqual(p.woken, [8_000, 9_600], "woken a rest after the step ended, not after it began");
  assert.equal(p.backgroundStep(), true, "the next");
  // No longer asked for: the hold ends a tail later, the steps with it.
  p.setRoom(false);
  p.clock.advance(1_000);
  assert.equal(p.backgroundStep(), true);
  assert.equal(p.backgroundStep(), true, "not counted any more");
});

test("a step past the cap on the farm runs until the farm answers, or until it goes stale", () => {
  const p = roomClock();
  p.setRoom(true);
  p.clock.advance(8_000);
  assert.equal(p.backgroundStep(true), true, "a walk handed out");
  p.clock.advance(3_000);
  assert.equal(p.backgroundStep(), false, "nothing else while it walks");
  p.backgroundStepDone();
  p.clock.advance(999);
  assert.equal(p.backgroundStep(), false, "a rest after it answered");
  p.clock.advance(1);
  assert.ok(p.woken.includes(12_000), "woken a rest after the answer");
  assert.equal(p.backgroundStep(true), true, "the next render handed out");
  // A worker lost with it: it never answers, and is taken as ended once stale.
  p.clock.advance(4_999);
  assert.equal(p.backgroundStep(), false);
  p.clock.advance(1);
  assert.ok(p.woken.includes(17_000), "woken when it went stale");
  assert.equal(p.backgroundStep(), false, "a rest from then");
  p.clock.advance(1_000);
  assert.equal(p.backgroundStep(), true);
});

test("background work asked for while room is made is not run at once, the cap's turn wakes the pump for it, and the player's guess runs", () => {
  const FACES = 3;
  const lanes = [[], [], [{ type: "cable_levels" }], []];
  const p = roomClock({
    names: ["NOW", "SOON", "LATER", "FACES", "lanes", "floor", "blocked"],
    values: [NOW, SOON, LATER, FACES, lanes, null, () => false],
    extra: [line(/^const playerAsked = .*$/m), lift("runnable")],
  });
  assert.equal(p.runnable(), true, "no room asked for: the pump runs it");
  p.setRoom(true);
  assert.equal(p.runnable(), false, "room made: no pump for it");
  // A gesture still is, and so is a guess the player asked for.
  lanes[NOW].push({ type: "edit_param" });
  assert.equal(p.runnable(), true);
  lanes[NOW].length = 0;
  lanes[LATER].push({ type: "guess", at: "node/0" });
  assert.equal(p.runnable(), true, "What goes here? is the player's");
  lanes[LATER].pop();
  assert.equal(p.runnable(), false);
  assert.ok(p.clock.timers.some((t) => t.at === 8_000), "its turn is set, at the cap");
  p.clock.advance(8_000);
  assert.deepEqual(p.woken, [8_000], "the pump woken at the cap");
  assert.equal(p.runnable(), true, "and its step may go");
});

test("while room is made, nothing from later or the faces lane starts, and soon work and the player's guess do", () => {
  const FACES = 3;
  const idle = src.match(/^const idleOnly = .*$/m);
  let open = false;
  const lanes = [
    [],
    [{ type: "perform_offer", name: "pressed offer" }],
    [{ type: "fit", name: "refit" }, { type: "guess", name: "the output's guess" }, { type: "guess", at: "node/0", name: "What goes here?" }],
    [{ type: "face_render", name: "face" }],
  ];
  const next = new Function(
    "SOON", "LATER", "FACES", "lanes", "floor", "blocked", "backgroundStep",
    `${idle[0]}\n${line(/^const playerAsked = .*$/m)}\n${lift("seenFaceWaiting")}\n${lift("nextLong")}\nreturn nextLong;`,
  )(SOON, LATER, FACES, lanes, null, () => false, () => open);
  assert.equal(next().name, "pressed offer");
  assert.equal(next().name, "What goes here?", "the player's guess goes");
  assert.equal(next(), null, "the refit and the output's guess wait");
  assert.equal(lanes[LATER].length, 2);
  open = true;
  assert.equal(next().name, "refit");
  assert.equal(next().name, "the output's guess");
  assert.equal(next().name, "face");
});

test("while room is made, the player's guess holding the floor does not give way", async () => {
  const w = floorJobs({ held: true });
  w.owe("g1", "g2");
  await w.guessRun({ type: "guess", at: "node/0" });
  assert.deepEqual(w.log, ["render g1", "render g2", "reply guess"]);
  const bg = floorJobs({ held: true });
  bg.owe("g1", "g2");
  const output = { type: "guess" };
  await bg.guessRun(output);
  assert.deepEqual(bg.log, ["render g1"], "the output's guess gives way");
  assert.equal(bg.lanes[LATER][0], output);
});

test("while room is made, a background job holding the floor gives way at its next breath, and the player's does not", async () => {
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

test("while room is made, a background render in now waits, and a gesture is served", async () => {
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
