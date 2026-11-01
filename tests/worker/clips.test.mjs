// Each input's clip (#147, docs/architecture/web-runtime.md, AUDIO IN, "The clips"): a
// capture of one input goes to the engine worker as `set_input_clip` with its
// slot, and is that slot's clip alone. Its reply, `audition_clip`, carries the
// slot, the engine's sentence, the slot's own status (`clip`) and every
// slot's (`clips`), as `ready` and a restore carry them, so the page knows
// which clip each input is heard through; the pool's members that read that
// slot, and only they, are measured again, and their ratings come with it. A
// save keeps each slot's clip (`audition_clips`). A sound reading two inputs
// is rendered through each one's clip, in the built engine as natively. What
// the farm is handed after one is farm.test.mjs's.
//
// worker.js runs here as it is, over the built engine (harness.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { workerFor } from "./harness.mjs";

const SEED = 1;
// A test that hangs fails here, well inside the CI job's limit.
const TIMEOUT = 150_000;
/** How many input slots there are (`INPUT_SLOTS` in auracle-grammar). */
const SLOTS = 8;

/** Six seconds of a tone at `hz` on two channels, as AUDIO IN's capture of
 *  input `slot` sends it; `level` 0 is a silent one. */
function capture(slot, hz, { level = 0.25, rate = 48_000 } = {}) {
  const frames = 6 * rate;
  const samples = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) samples[2 * i] = samples[2 * i + 1] = level * Math.sin((2 * Math.PI * hz * i) / rate);
  return { type: "set_input_clip", slot, samples, channels: 2, sampleRate: rate };
}
const sendCapture = (w, msg) => w.send(msg, { transfer: [msg.samples.buffer] });
const ids = (clips) => clips.map((c) => c.id);

test("a capture of one input is that input's clip alone, and its reply says which clip every input hears", { timeout: TIMEOUT }, async (t) => {
  const w = await workerFor(t, { seed: SEED });
  // Before any capture every input hears the built-in reference: one id.
  const ready = w.repliesOf("ready").pop();
  assert.equal(ready.clips.length, SLOTS, "ready names every input's clip");
  assert.ok(ready.clips.every((c) => c.source === "reference" && c.id === ready.clip.id), "an input heard something but the reference before a capture");
  const ref = ready.clip.id;

  // Input 2 captured: its clip, and no other input's.
  const [two] = await sendCapture(w, capture(1, 660));
  assert.equal(two.type, "audition_clip");
  assert.equal(two.slot, 1, "the reply names the input it answers");
  assert.equal(two.ok, true, "the engine took the capture");
  assert.equal(two.note, "The model hears sounds with an input through the clip captured from it.");
  assert.equal(two.clip.source, "captured", "`clip` is the input's own");
  assert.equal(two.clips.length, SLOTS);
  assert.equal(two.clips[1].id, two.clip.id);
  assert.notEqual(two.clip.id, ref);
  for (const s of [0, 2, 3, 4, 5, 6, 7]) assert.equal(two.clips[s].id, ref, `input ${s + 1} took input 2's clip`);

  // Input 1 captured from another device: its own, and input 2's stays.
  const [one] = await sendCapture(w, capture(0, 440));
  assert.equal(one.slot, 0);
  assert.equal(one.ok, true);
  assert.equal(one.clips[0].source, "captured");
  assert.notEqual(one.clips[0].id, two.clip.id, "two devices, one clip");
  assert.equal(one.clips[1].id, two.clip.id, "a capture of input 1 moved input 2's clip");
  assert.equal(one.clips[2].id, ref);

  // A silent capture is refused, and changes nothing.
  const [silent] = await sendCapture(w, capture(2, 440, { level: 0 }));
  assert.equal(silent.slot, 2);
  assert.equal(silent.ok, false);
  assert.equal(silent.note, "That capture was silent, so nothing changed. Check the input, then capture again.");
  assert.deepEqual(ids(silent.clips), ids(one.clips), "a refused capture moved a clip");

  // Without samples, an input hears the clip every input hears again.
  const [cleared] = await w.send({ type: "set_input_clip", slot: 1 });
  assert.equal(cleared.slot, 1);
  assert.equal(cleared.ok, true);
  assert.equal(cleared.clips[1].id, ref, "input 2 cleared still hears its capture");
  assert.equal(cleared.clips[0].id, one.clips[0].id, "clearing input 2 moved input 1's clip");

  // The status alone, as main may ask for it: the same word a restore posts.
  const [status] = await w.send({ type: "audition_clip" });
  assert.deepEqual(ids(status.clips), ids(cleared.clips));
  assert.equal(status.clip.id, ref, "the clip every input hears is still the reference: no capture is every input's");

  // Saved: input 1's own clip, under its slot, and no clip for every input.
  const [{ json }] = await w.send({ type: "save" });
  const saved = JSON.parse(json);
  assert.deepEqual(Object.keys(saved.audition_clips || {}), ["0"], "the save holds input 1's clip, and only it");
  assert.equal(saved.audition_clips["0"].source, "captured");
  assert.ok(!saved.audition_clip, "a capture of one input was saved as every input's clip");
  await w.close();
});

test("a sound on input 2 is measured again by input 2's clip alone, and its new ratings come with the reply", { timeout: TIMEOUT }, async (t) => {
  const w = await workerFor(t, { seed: SEED });
  // A sound that listens on input 2: a saw beside AUDIO IN.
  const amp = { attack: 0.01, decay: 0.3, sustain: 0.95, release: 0.05 };
  const saw = { Vco: { wave: "Saw", octave: 0, detune: 0.5, mod_depth: 0, modulation: "None" } };
  const ain = { AudioIn: { input: 1, gain: 24 / 36, channel: "Both" } };
  const json = JSON.stringify({ amp, root: { Mix: { balance: 0.5, a: saw, b: ain } } });
  const [landed] = await w.send({ type: "import_patch", json, name: "Second Ear" });
  assert.ok(landed.id > 0, "the sound that listens joined the pool");

  // Input 1's clip: no sound reads it, so nothing is measured again.
  const [one] = await sendCapture(w, capture(0, 440));
  assert.equal(one.ok, true);
  assert.deepEqual(one.remeasured, [], "a sound on input 2 was measured with input 1's clip");
  assert.equal(one.views, undefined, "ratings sent though nothing moved");

  // Input 2's: that sound is measured again, and the ratings go with it.
  const [two] = await sendCapture(w, capture(1, 660));
  assert.equal(two.ok, true);
  assert.deepEqual(two.remeasured, [landed.id], "the sound on input 2 was not measured with its clip");
  assert.ok(two.views && Array.isArray(two.views.ranked), "the ratings it moved did not come with the reply");
  assert.ok(two.status, "the status did not come with the reply");
  await w.close();
});

test("a restore says which clip each input hears, as it was saved", { timeout: TIMEOUT }, async (t) => {
  // A session saved with two inputs captured.
  const first = await workerFor(t, { seed: SEED });
  await sendCapture(first, capture(0, 440));
  const [taken] = await sendCapture(first, capture(1, 660));
  assert.equal(taken.ok, true);
  const [{ json: saved }] = await first.send({ type: "save" });
  await first.close();

  const w = await workerFor(t, { boot: false });
  const after = w.replies.length;
  await w.boot({ seed: SEED, saved });
  const restored = w.repliesOf("audition_clip", { after }).pop();
  assert.ok(restored, "the restore said nothing of the clips");
  assert.deepEqual(ids(restored.clips), ids(taken.clips), "an input's clip came back as another");
  assert.equal(restored.clips[0].source, "captured");
  assert.equal(restored.clips[1].source, "captured");
  assert.equal(restored.clips[2].source, "reference");
  await w.close();
});

test("a sound reading two inputs is rendered through each input's own clip: its inputs swapped with their clips is the same sound, bit for bit", { timeout: TIMEOUT }, async (t) => {
  // In the built engine, as the features crate holds it natively
  // (`two_inputs_hear_their_own_clips`): two sounds, each the other's mirror,
  // AUDIO IN on one input at 70% and on the other at 30%.
  const w = await workerFor(t, { seed: SEED });
  const amp = { attack: 0.01, decay: 0.3, sustain: 0.95, release: 0.05 };
  const ain = (input) => ({ AudioIn: { input, gain: 24 / 36, channel: "Both" } });
  const both = (a, b) => JSON.stringify({ amp, root: { Mix: { balance: 0.3, a: ain(a), b: ain(b) } } });
  const [p] = await w.send({ type: "import_patch", json: both(0, 1), name: "Left Ear" });
  const [q] = await w.send({ type: "import_patch", json: both(1, 0), name: "Right Ear" });
  assert.ok(p.id > 0 && q.id > 0, "the sounds that read two inputs joined the pool");
  // ▶'s render: the sound as the model hears it, through its inputs' clips.
  const play = async (id) => {
    const [r] = await w.send({ type: "render", id });
    assert.ok(r.buffer && r.buffer.length > 0, `sound ${id} did not render`);
    return Buffer.from(r.buffer.buffer, r.buffer.byteOffset, r.buffer.byteLength);
  };
  // Both inputs on the reference: the mirror is the same sound.
  assert.ok((await play(p.id)).equals(await play(q.id)), "one clip on both inputs, and the mirror sounds different");

  // Input 1 a tone at 440 Hz, input 2 one at 660: each capture measures both
  // sounds again, and the mirror now differs.
  const [a1] = await sendCapture(w, capture(0, 440));
  const [b2] = await sendCapture(w, capture(1, 660));
  for (const r of [a1, b2]) {
    assert.equal(r.ok, true);
    assert.deepEqual([...r.remeasured].sort((x, y) => x - y), [p.id, q.id].sort((x, y) => x - y), `input ${r.slot + 1}'s clip did not measure both sounds again`);
  }
  const pAB = await play(p.id);
  const qAB = await play(q.id);
  assert.ok(!pAB.equals(qAB), "two inputs, each with its own clip, and the mirror sounds the same: one clip heard on both");

  // The clips swapped: each sound is now its mirror as it was.
  const [b1] = await sendCapture(w, capture(0, 660));
  const [a2] = await sendCapture(w, capture(1, 440));
  assert.equal(b1.clips[0].id, b2.clip.id, "input 1's 660 Hz capture is another clip than input 2's");
  assert.equal(a2.clips[1].id, a1.clip.id, "input 2's 440 Hz capture is another clip than input 1's");
  assert.ok((await play(p.id)).equals(qAB), "the sound on inputs 1 and 2 with the clips swapped is not its mirror");
  assert.ok((await play(q.id)).equals(pAB), "the mirror with the clips swapped is not the sound");
  await w.close();
});
