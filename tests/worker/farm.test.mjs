// The farm hears the phrase the session measures with (Plan-007 task 4,
// docs/architecture/web-runtime.md "The farm's phrase"): the phrase carries
// the session's audition clip, so when a capture or a restore changes the
// clip, every farm worker standing is handed the new phrase before any work
// that would be measured with it. Until then a worker's render of a sound
// that listens carries the old clip, and the sound is measured again here.
//
// worker.js runs here as it is, over the built engine (harness.mjs), and the
// farm is ports the test holds (`fakeCrew`): what reaches a farm worker, and
// in what order, is what each port heard.
import test from "node:test";
import assert from "node:assert/strict";
import { workerFor, fakeCrew } from "./harness.mjs";

const SEED = 1;
const TIMEOUT = 300_000;

/** Six seconds of a tone on two channels, as AUDIO IN's capture sends it. */
function capture(rate = 48_000) {
  const frames = 6 * rate;
  const samples = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) samples[2 * i] = samples[2 * i + 1] = 0.25 * Math.sin((2 * Math.PI * 440 * i) / rate);
  return { type: "set_audition_clip", samples, channels: 2, sampleRate: rate };
}

/** Does a phrase handed to a farm worker carry the captured clip? */
const withClip = (m) => m.type === "phrase" && "clip" in JSON.parse(m.json);

test("a capture hands every farm worker standing the new phrase", { timeout: TIMEOUT }, async (t) => {
  const crew = fakeCrew(2);
  t.after(() => crew.close());
  const w = await workerFor(t, { seed: SEED, crew: () => crew.ports });
  // A crew stands after a walk: the model's guess raises one (it needs a
  // taste and a patch on the bench), and keeps it a minute after.
  const [warm] = await w.send({ type: "warm_start", picked: [0, 1, 2], rest: [3, 4, 5, 6, 7, 8] });
  await w.send({ type: "fit" });
  await w.send({ type: "edit_begin", id: warm.first });
  const at = w.post({ type: "guess", token: 1 });
  await w.reply("guess", { where: { token: 1 }, after: at });
  assert.ok(crew.heard.every((h) => h.some((m) => m.type === "job")), "the crew rendered for the guess");
  assert.ok(crew.heard.every((h) => !h.some(withClip)), "a phrase with a clip before any capture");

  const msg = capture();
  const [reply] = await w.send(msg, { transfer: [msg.samples.buffer] });
  assert.equal(reply.ok, true, "the engine took the capture");
  assert.equal(reply.clip.source, "captured");
  assert.equal(reply.farmResent, 2, "the reply counts the workers handed the phrase");
  // Port messages arrive in order: anything sent to a worker after this is
  // rendered with the new clip.
  for (const h of crew.heard) assert.equal(h.filter(withClip).length, 1, "a worker standing was not handed the new phrase");
  await w.close();
});

test("a restore that installs a captured clip hands boot's crew the clip's phrase before any of the bank's renders", { timeout: TIMEOUT }, async (t) => {
  // A session saved with a captured clip.
  const first = await workerFor(t, { seed: SEED });
  const msg = capture();
  const [taken] = await first.send(msg, { transfer: [msg.samples.buffer] });
  assert.equal(taken.ok, true);
  const [{ json: saved }] = await first.send({ type: "save" }, { answers: ["saved"] });
  await first.close();

  // Boot from it with a crew of two, as main boots with a farm.
  const crew = fakeCrew(2);
  t.after(() => crew.close());
  const w = await workerFor(t, { boot: false });
  const after = w.replies.length;
  await w.boot({ seed: SEED, saved, farmPorts: crew.ports });
  const restored = w.repliesOf("audition_clip", { after }).pop();
  assert.equal(restored && restored.clip.source, "captured", "the restore installed the saved clip");
  for (const h of crew.heard) {
    const phrases = h.filter((m) => m.type === "phrase");
    const firstJob = h.findIndex((m) => m.type === "job");
    assert.ok(firstJob >= 0, "the crew rendered the bank");
    assert.ok(!withClip(phrases[0]), "the handshake, before the restore, carries no clip");
    const clipAt = h.findIndex(withClip);
    assert.ok(clipAt >= 0 && clipAt < firstJob, "the bank's renders went out before the clip's phrase");
  }
  await w.close();
});
