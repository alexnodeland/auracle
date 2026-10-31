// Unit tests for clips.js: which clip each input is heard through as the
// engine worker says, which input a first listen captures by itself, and the
// key that names the clips a listening sound is measured through (#147).
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { createClips, clipKey, inputSlots, INPUT_SLOTS } from "../clips.js";

const REF = "ref0000";
const ref = { source: "reference", id: REF, note: "…", seconds: 5.05, channels: 1 };
const cap = (id) => ({ source: "captured", id, note: "…", seconds: 5.05, channels: 2 });
/** Every input's status, the reference but where `own` names one. */
const every = (own = {}) => Array.from({ length: INPUT_SLOTS }, (_, s) => own[s] || ref);

const amp = { attack: 0.01, decay: 0.3, sustain: 0.95, release: 0.05 };
const ain = (input) => ({ AudioIn: { input, gain: 0.66, channel: "Both" } });
const saw = { Vco: { wave: "Saw", octave: 0, detune: 0.5, mod_depth: 0, modulation: "None" } };
const tree = (root) => JSON.stringify({ amp, root });

test("the inputs a tree reads are its AUDIO INs' slots, ascending, each once, as the grammar counts them", () => {
  assert.deepEqual(inputSlots(tree(saw)), [], "a sound that does not listen reads no input");
  assert.deepEqual(inputSlots(tree(ain(0))), [0]);
  const three = { Mix: { balance: 0.5, a: ain(1), b: { Mix: { balance: 0.5, a: ain(0), b: ain(1) } } } };
  assert.deepEqual(inputSlots(tree(three)), [0, 1]);
  // Deep in a chain: a filter over a ducker keyed by input 3.
  const keyed = { Filter: { kind: "Ladder", cutoff: 0.5, resonance: 0.2, mod_depth: 0, modulation: "None", input: { Duck: { amount: 0.5, input: saw, key: ain(2) } } } };
  assert.deepEqual(inputSlots(tree(keyed)), [2]);
  // A slot past the last reads the last (`input_slot`), as a hand-edited
  // file can hold.
  assert.deepEqual(inputSlots(tree(ain(12))), [INPUT_SLOTS - 1]);
  // A key already composed is not a tree.
  assert.deepEqual(inputSlots(`${tree(ain(0))}|clip:${REF}`), []);
  assert.deepEqual(inputSlots(null), []);
});

test("a sound's key names one clip when every input it reads hears it, and each input's when they differ", () => {
  const ids = { 0: "aaa", 1: "bbb", 2: "aaa" };
  assert.equal(clipKey([], (s) => ids[s]), null, "a sound that reads no input carries no clip");
  assert.equal(clipKey([0], (s) => ids[s]), "aaa", "one input: its clip, as the key was before inputs had their own");
  assert.equal(clipKey([0, 2], (s) => ids[s]), "aaa", "two inputs on one clip: that clip");
  assert.equal(clipKey([0, 1], (s) => ids[s]), "0:aaa+1:bbb");
  assert.equal(clipKey([0, 1, 2], (s) => ids[s]), "0:aaa+1:bbb+2:aaa");
  assert.equal(clipKey([0, 5], (s) => ids[s]), null, "an input the engine has not named gives no key");
});

test("before the engine says, no input is captured by itself and no key names a clip", () => {
  const c = createClips();
  assert.equal(c.of(0), null);
  assert.equal(c.firstListen(0), false);
  assert.equal(c.key(tree(ain(0))), null);
  assert.equal(c.shared(), null);
  assert.deepEqual(c.sources(), Array(INPUT_SLOTS).fill(null));
});

test("each input is captured on its own first listen, while the engine hears it through the reference", () => {
  const c = createClips();
  c.heard({ type: "ready", clip: ref, clips: every() });
  for (let s = 0; s < INPUT_SLOTS; s++) assert.equal(c.firstListen(s), true, `input ${s + 1} waits for its first listen`);
  // Input 1 captured: input 2 still waits for its own.
  c.heard({ type: "audition_clip", slot: 0, ok: true, clip: cap("aaa"), clips: every({ 0: cap("aaa") }) });
  assert.equal(c.firstListen(0), false, "a captured input was captured again by itself");
  assert.equal(c.firstListen(1), true, "input 2 took input 1's clip");
  assert.deepEqual(c.sources().slice(0, 3), ["captured", "reference", "reference"]);
  // Its reply carries input 1's own status as `clip`; that is not every
  // input's.
  assert.equal(c.of(1).id, REF);
});

test("an older session's one clip, heard on every input, leaves first listens alone", () => {
  // A session saved before inputs had clips of their own restores its one
  // clip on every slot; a capture is then NEW CLIP's, as it was.
  const c = createClips();
  c.heard({ type: "audition_clip", clip: cap("old"), clips: every(Object.fromEntries(Array.from({ length: INPUT_SLOTS }, (_, s) => [s, cap("old")]))) });
  for (let s = 0; s < INPUT_SLOTS; s++) assert.equal(c.firstListen(s), false);
  assert.equal(c.shared(), "old");
});

test("a refused capture of one input keeps that input from capturing by itself until its NEW CLIP, and no other", () => {
  const c = createClips();
  c.heard({ type: "ready", clip: ref, clips: every() });
  c.heard({ type: "audition_clip", slot: 1, ok: false, note: "That capture was silent…", clip: ref, clips: every() });
  assert.equal(c.firstListen(1), false, "a refused input captured again by itself");
  assert.equal(c.firstListen(0), true, "another input's refusal held input 1 back");
  // A restore's word, with no `ok`, does not lift it.
  c.heard({ type: "audition_clip", clip: ref, clips: every() });
  assert.equal(c.firstListen(1), false);
  c.retry(1);
  assert.equal(c.firstListen(1), true, "NEW CLIP did not lift the refusal");
  // …and a capture the engine takes lifts it too.
  c.heard({ type: "audition_clip", slot: 1, ok: false, note: "…", clip: ref, clips: every() });
  c.heard({ type: "audition_clip", slot: 1, ok: true, clip: cap("bbb"), clips: every({ 1: cap("bbb") }) });
  c.heard({ type: "audition_clip", slot: 1, ok: true, clip: ref, clips: every() }); // cleared
  assert.equal(c.firstListen(1), true);
});

test("a listening sound's key follows the clips of the inputs it reads, and only theirs", () => {
  const c = createClips();
  c.heard({ type: "ready", clip: ref, clips: every() });
  const one = tree(ain(0));
  const two = tree({ Mix: { balance: 0.5, a: ain(0), b: ain(1) } });
  const plain = tree(saw);
  assert.equal(c.key(one), REF);
  assert.equal(c.key(two), REF, "two inputs on the reference: one clip");
  assert.equal(c.key(plain), null);
  // Input 2 captured: the sound reading it is keyed by both clips, the one on
  // input 1 alone keeps its key.
  c.heard({ type: "audition_clip", slot: 1, ok: true, clip: cap("bbb"), clips: every({ 1: cap("bbb") }) });
  assert.equal(c.key(one), REF, "a clip on an input it does not read moved its key");
  assert.equal(c.key(two), `0:${REF}+1:bbb`);
  // Input 1 too.
  c.heard({ type: "audition_clip", slot: 0, ok: true, clip: cap("aaa"), clips: every({ 0: cap("aaa"), 1: cap("bbb") }) });
  assert.equal(c.key(one), "aaa");
  assert.equal(c.key(two), "0:aaa+1:bbb");
});

test("a preset's shipped face is drawn under the clip every input hears, and under none once they differ", () => {
  const c = createClips();
  c.heard({ type: "ready", clip: ref, clips: every() });
  assert.equal(c.shared(), REF);
  c.heard({ type: "audition_clip", slot: 3, ok: true, clip: cap("ddd"), clips: every({ 3: cap("ddd") }) });
  assert.equal(c.shared(), null);
});

test("an engine too old to name each input's clip has its one clip heard on every input", () => {
  const c = createClips();
  c.heard({ type: "audition_clip", clip: ref });
  assert.equal(c.firstListen(4), true);
  assert.equal(c.key(tree(ain(4))), REF);
  assert.equal(c.shared(), REF);
  c.heard({ type: "audition_clip", ok: true, clip: cap("one") });
  assert.equal(c.firstListen(0), false);
  assert.equal(c.key(tree({ Mix: { balance: 0.5, a: ain(0), b: ain(1) } })), "one");
  // Anything else is not a word on the clips.
  c.heard(null);
  c.heard({ type: "audition_clip", clip: { source: "captured" } });
  assert.equal(c.shared(), "one");
});
