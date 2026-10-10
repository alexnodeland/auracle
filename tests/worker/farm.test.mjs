// The farm hears the phrase the session measures with (Plan-007 task 4,
// docs/architecture/web-runtime.md "The farm's phrase"): the phrase carries
// the session's audition clip, so when a capture or a restore changes the
// clip, every farm worker standing is handed the new phrase before any work
// that would be measured with it. Until then a worker's render of a sound
// that listens carries the old clip, and the sound is measured again here.
//
// worker.js runs here as it is, over the built engine (harness.mjs), and the
// farm is ports the test holds (`fakeCrew`): what reaches a farm worker, and
// in what order, is what each port heard. Which worker renders what is the
// order their answers arrive in, so nothing here asks that each one did:
// under load here one worker took 29 of a guess's 30 renders, and on a CI
// runner one of the two was handed none.
import test from "node:test";
import assert from "node:assert/strict";
import { workerFor, fakeCrew } from "./harness.mjs";

const SEED = 1;
// A test that hangs fails here, well inside the CI job's limit.
const TIMEOUT = 150_000;

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
  // A crew stands after a refit or a walk: the refit raises one and is
  // fitted on it (#300), the model's guess walks on it
  // (it needs a taste and a patch on the bench), and it is kept a minute
  // after (`CREW_IDLE_MS`).
  const warm = (await w.send({ type: "warm_start", picked: [0, 1, 2], rest: [3, 4, 5, 6, 7, 8] })).at(-1);
  const at = w.replies.length;
  await w.send({ type: "fit" });
  await w.send({ type: "edit_begin", id: warm.first });
  const ask = { type: "guess", token: 1 };
  w.post(ask);
  await w.answers(ask);
  // Standing: main was asked for it and handed both workers, the worker
  // greeted each (its handshake phrase, no clip yet), and has not reaped it.
  const [wanted] = w.repliesOf("farm_want", { after: at });
  assert.ok(wanted, "the refit raised no crew");
  for (const h of crew.heard) assert.deepEqual(h.filter((m) => m.type === "phrase").map(withClip), [false], "a worker was not greeted, or heard a clip before any capture");
  assert.ok(crew.heard.some((h) => h.some((m) => m.type === "job")), "the crew was handed none of the guess's renders");
  assert.deepEqual(w.repliesOf("farm_done", { where: { crew: wanted.crew } }), [], "the crew was reaped before the capture");

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
  const [{ json: saved }] = await first.send({ type: "save" });
  await first.close();

  // Boot from it with a crew of two, as main boots with a farm.
  const crew = fakeCrew(2);
  t.after(() => crew.close());
  const w = await workerFor(t, { boot: false });
  const after = w.replies.length;
  await w.boot({ seed: SEED, saved, farmPorts: crew.ports });
  const restored = w.repliesOf("audition_clip", { after }).pop();
  assert.equal(restored && restored.clip.source, "captured", "the restore installed the saved clip");
  // The crew as a whole rendered the bank (which worker took which entry is
  // the order of their answers); every worker standing heard the clip's
  // phrase, and before any render it was handed.
  assert.ok(crew.heard.some((h) => h.some((m) => m.type === "job")), "the crew was handed none of the bank's renders");
  for (const h of crew.heard) {
    const phrases = h.filter((m) => m.type === "phrase");
    assert.ok(!withClip(phrases[0]), "the handshake, before the restore, carries no clip");
    const clipAt = h.findIndex(withClip);
    const firstJob = h.findIndex((m) => m.type === "job");
    assert.ok(clipAt >= 0, "a worker standing was not handed the clip's phrase");
    assert.ok(firstJob < 0 || clipAt < firstJob, "the bank's renders went out before the clip's phrase");
  }
  await w.close();
});
