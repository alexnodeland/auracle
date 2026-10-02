// CAPTURE's recorder in the voice worklet (live-audio.js PROCESSOR): what it
// copies while RECORD is lit, and what it hands back at STOP. The processor
// is the worklet's own source, run here with a stub port, so the one case a
// browser can only race for, a STOP before the first quantum, is exact.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../live-audio.js", import.meta.url)), "utf8");
const open = "const PROCESSOR = `";
const at = src.indexOf(open) + open.length;
const body = src.slice(at, src.indexOf("`;", at));

/** A voice processor with a port that records what it posts. */
function voice() {
  const processors = {};
  class AudioWorkletProcessor {
    constructor() {
      this.sent = [];
      this.port = { postMessage: (m) => this.sent.push(m), onmessage: null, onmessageerror: null };
    }
  }
  const registerProcessor = (name, cls) => { processors[name] = cls; };
  new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", body)(AudioWorkletProcessor, registerProcessor, 48_000);
  const p = new processors["auracle-voice"]();
  p.sent.length = 0;
  return p;
}

/** One quantum: the voices' input empty, the recorder's carrying `x` (left)
 *  and `-x` (right). */
function quantum(p, x) {
  const l = new Float32Array(128).fill(x);
  const r = new Float32Array(128).fill(-x);
  const out = [[new Float32Array(128), new Float32Array(128)]];
  p.process([[], [l, r]], out);
}

const done = (p) => p.sent.find((m) => m.type === "take_done");

test("a STOP before the first quantum hands back no frames", () => {
  const p = voice();
  p.handle({ type: "take_start", key: "node", buf: new Float32Array(4096) });
  p.handle({ type: "take_stop", key: "node" });
  const d = done(p);
  assert.ok(d, "no take_done");
  assert.equal(d.frames, 0);
});

test("the recorder copies its own input, interleaved, a quantum at a time", () => {
  const p = voice();
  p.handle({ type: "take_start", key: "node", buf: new Float32Array(2 * 1000) });
  quantum(p, 0.25);
  quantum(p, 0.5);
  p.handle({ type: "take_stop", key: "node" });
  const d = done(p);
  assert.equal(d.key, "node");
  assert.equal(d.frames, 256);
  assert.deepEqual([d.buf[0], d.buf[1], d.buf[2 * 128], d.buf[2 * 128 + 1]], [0.25, -0.25, 0.5, -0.5]);
});

test("it stops copying at the buffer's end, and a second STOP is an error, not a take", () => {
  const p = voice();
  p.handle({ type: "take_start", key: "node", buf: new Float32Array(2 * 200) });
  quantum(p, 0.1);
  quantum(p, 0.1);
  quantum(p, 0.1);
  p.handle({ type: "take_stop", key: "node" });
  assert.equal(done(p).frames, 200);
  p.handle({ type: "take_stop", key: "node" });
  const err = p.sent.find((m) => m.type === "take_error");
  assert.equal(err && err.code, "failed");
});

test("the recorder's field is its own: ● REC's recording goes on beside it", () => {
  const p = voice();
  p.handle({ type: "take_start", key: "node", buf: new Float32Array(2 * 1000) });
  // ● REC's buffer is this.rec; the recorder must never take that name.
  p.rec = [];
  quantum(p, 0.3);
  p.handle({ type: "take_stop", key: "node" });
  assert.equal(done(p).frames, 128);
  assert.ok(Array.isArray(p.rec), "● REC's buffer was replaced");
});
