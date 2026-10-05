// The worker's lanes, read out of worker.js itself. Run: node --test apps/web/tests
//
// worker.js is not a module a test can import (it boots an engine on load),
// so this lifts `laneOf` and `blocked` out of its source and runs them as
// written, beside a model of how the worker serves its lanes: every `now`
// request first, in arrival order, then the first `soon` (then `later`)
// request that is not blocked. That model is `serveNow` and `nextLong`.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../worker.js", import.meta.url), "utf8");

// The source of `function name(…) { … }`, braces matched.
function lift(name) {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `worker.js has no function ${name}`);
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
