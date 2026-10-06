// A face's render and everyone who asked for it, read out of worker.js
// itself. Run: node --test apps/web/tests
//
// worker.js is not a module a test can import (it boots an engine on load),
// so this lifts `faceLookup`, `faceRender` and `faceCancel` out of its source
// and runs them as written, over a memo and a store that hold no face, so
// every lookup ends in the faces lane. Two slots can wait on one render key:
// a preset's row and that preset's pool row, or the bench (an unedited
// preset's tree is the preset's), or PATCH's outline. Each one is answered
// (#153): before, a second asker was left waiting for good, and a looked-at
// one took the job's place in the answer from whoever asked first.
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
const line = (re) => {
  const m = src.match(re);
  assert.ok(m, `worker.js has no ${re}`);
  return m[0];
};

const FACES = 3;
const LATER = 2;

/** The worker's face functions over a memo and a store with no face in
 *  them; `rendered` is what a render of a key gives (null: a tree that does
 *  not vet). Every `faces` the worker says of its own accord is in `said`. */
function faceWorker({ rendered = (key) => new Uint8Array([key.length]) } = {}) {
  const lanes = [[], [], [], []];
  const said = [];
  const faceMem = new Map();
  const faceRendering = new Map();
  const fns = new Function(
    "FACES", "LATER", "lanes", "faceMem", "faceRendering", "faceNow", "faceStoreGet", "faceKeep", "news", "post", "schedulePump",
    [
      line(/^const faceTag = .*$/m), line(/^const sameAsker = .*$/m),
      lift("faceLookup"), lift("faceRender"), lift("faceCancel"),
      "return { faceLookup, faceRender, faceCancel };",
    ].join("\n"),
  )(
    FACES, LATER, lanes, faceMem, faceRendering,
    (q, render) => (render ? rendered(q.key) : null),
    async () => new Map(),
    (key, b) => faceMem.set(key, b),
    (m) => said.push(m),
    (m) => said.push(m),
    () => {},
  );
  // What `faces` hands the lookup: each ask with its key.
  const ask = (asks) => fns.faceLookup({ type: "face_lookup", asks, render: true });
  // Run the faces lane to its end, in order.
  const drain = () => {
    const out = [];
    while (lanes[FACES].length) {
      const job = lanes[FACES].shift();
      out.push(job);
      fns.faceRender(job);
    }
    return out;
  };
  const answered = () => said.flatMap((m) => (m.items || []).map((i) => i.ref ?? `i${i.id}`));
  const failed = () => said.flatMap((m) => (m.failed || []).map((i) => i.ref ?? `i${i.id}`));
  const cancelled = () => said.flatMap((m) => (m.cancelled || []).map((i) => i.ref ?? `i${i.id}`));
  return { ...fns, lanes, said, faceRendering, ask, drain, answered, failed, cancelled };
}

test("two slots waiting on one render key are both answered by its one render", async () => {
  const w = faceWorker();
  // A preset's row, then the same preset's pool row and the bench's tree.
  await w.ask([{ ref: "p3", key: "ns/k3" }]);
  await w.ask([{ id: 41, key: "ns/k3" }]);
  await w.ask([{ ref: "rbench", key: "ns/k3" }]);
  assert.equal(w.lanes[FACES].length, 1, "one render for one key");
  const ran = w.drain();
  assert.equal(ran.length, 1);
  assert.deepEqual(w.answered().sort(), ["i41", "p3", "rbench"]);
  // Each with the key and the face of that one render.
  const items = w.said.flatMap((m) => m.items);
  assert.ok(items.every((i) => i.key === "ns/k3" && i.face === items[0].face));
  assert.equal(w.faceRendering.size, 0);
});

test("a slot asking again while its render waits is answered once", async () => {
  const w = faceWorker();
  await w.ask([{ ref: "p3", key: "ns/k3" }]);
  await w.ask([{ ref: "p3", key: "ns/k3" }]);
  w.drain();
  assert.deepEqual(w.answered(), ["p3"]);
});

test("a looked-at face takes a waiting render to the front, and everyone on it is still answered", async () => {
  const w = faceWorker();
  await w.ask([{ ref: "p1", key: "ns/k1" }, { ref: "p2", key: "ns/k2" }]);
  // PATCH's outline happens to be preset 2's tree.
  await w.ask([{ ref: "rwithout", key: "ns/k2", seen: true }]);
  assert.deepEqual(w.lanes[FACES].map((j) => j.key), ["ns/k2", "ns/k1"]);
  assert.equal(w.lanes[FACES][0].seen, true);
  w.drain();
  assert.deepEqual(w.answered(), ["p2", "rwithout", "p1"]);
});

test("a looked-at face already at the front keeps the asker before it", async () => {
  const w = faceWorker();
  await w.ask([{ ref: "p2", key: "ns/k2" }]);
  await w.ask([{ ref: "rwithout", key: "ns/k2", seen: true }]);
  w.drain();
  assert.deepEqual(w.answered(), ["p2", "rwithout"]);
});

test("a slot that leaves the view takes only itself off a render others still wait on", async () => {
  const w = faceWorker();
  await w.ask([{ ref: "p3", key: "ns/k3" }]);
  await w.ask([{ ref: "rbench", key: "ns/k3" }]);
  w.faceCancel({ type: "face_cancel", refs: ["p3"] });
  assert.deepEqual(w.cancelled(), ["p3"]);
  assert.equal(w.lanes[FACES].length, 1, "the render stays for the bench");
  w.drain();
  assert.deepEqual(w.answered(), ["rbench"]);
});

test("a render nobody is left on is dropped, and a looked-at one nobody looks at any more loses its place", async () => {
  const w = faceWorker();
  await w.ask([{ ref: "p3", key: "ns/k3" }]);
  w.faceCancel({ type: "face_cancel", refs: ["p3"] });
  assert.equal(w.lanes[FACES].length, 0);
  assert.equal(w.faceRendering.size, 0);
  // Asked again, it is queued again.
  await w.ask([{ ref: "p3", key: "ns/k3" }]);
  assert.equal(w.lanes[FACES].length, 1);
  // A looked-at asker that goes leaves the job unlooked-at for the others.
  await w.ask([{ ref: "rwithout", key: "ns/k3", seen: true }]);
  assert.equal(w.lanes[FACES][0].seen, true);
  w.faceCancel({ type: "face_cancel", refs: ["rwithout"] });
  assert.equal(w.lanes[FACES][0].seen, false);
  w.drain();
  assert.deepEqual(w.answered(), ["p3"]);
});

test("a render that does not vet is failed to everyone on it", async () => {
  const w = faceWorker({ rendered: () => null });
  await w.ask([{ ref: "p9", key: "ns/k9" }]);
  await w.ask([{ id: 7, key: "ns/k9" }]);
  w.drain();
  assert.deepEqual(w.answered(), []);
  assert.deepEqual(w.failed().sort(), ["i7", "p9"]);
});
