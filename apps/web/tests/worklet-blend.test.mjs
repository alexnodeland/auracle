// PERFORM's B slot in the voice worklet (live-audio.js PROCESSOR): while main
// says the audio is struggling (`strain`), an offer nobody hears rests, and
// Blend and Peek bring it in; with headroom it renders always (#288). The processor is
// the worklet's own source, run here over a stand-in for the engine's
// LivePoly that counts what it is asked to do: render a quantum
// (`process_ptr`) or rest through one (`rest`), and, after a rest, wake over a
// few silent quanta (`resting`), as the real one does
// (crates/auracle-wasm/src/live.rs `LivePoly::rest`, whose tests hold the
// wake to where the notes would be). Everything is counted in quanta, the
// worklet's own clock, so nothing here depends on a machine's speed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../live-audio.js", import.meta.url)), "utf8");
const open = "const PROCESSOR = `";
const at = src.indexOf(open) + open.length;
const body = src.slice(at, src.indexOf("`;", at));

const Q = 128;
// A's samples and B's, each a constant, so the output says who is in it.
const A = 0.5;
const B = 0.25;
// How many silent quanta the stand-in's wake takes (a chord held on its
// shelf takes five in the engine).
const WAKE = 5;

/** A voice processor with A loaded, over a stand-in LivePoly. */
function rig() {
  const memory = { buffer: new ArrayBuffer(1 << 16) };
  const made = [];
  let next = 0;
  let processor = null;
  class LivePoly {
    constructor(tree) {
      this.tree = tree;
      this.level = tree === "b" ? B : A;
      this.ptr = next;
      next += Q * 2 * 4;
      this.rendered = 0;
      this.rested = 0;
      this.asleep = false;
      this.waking = 0;
      // The worklet's mix when each rest was asked for: a rest is only ever
      // of a B nobody hears.
      this.restMix = [];
      made.push(this);
    }
    process_ptr(n) {
      this.rendered++;
      const v = new Float32Array(memory.buffer, this.ptr, n * 2);
      if (this.asleep) {
        if (this.waking === 0) this.waking = WAKE;
        if (--this.waking === 0) this.asleep = false;
        v.fill(0);
      } else {
        v.fill(this.level);
      }
      return this.ptr;
    }
    rest() {
      this.rested++;
      this.restMix.push(processor.mixCur);
      this.asleep = true;
      this.waking = 0;
    }
    resting() {
      return this.asleep;
    }
    free() {
      this.freed = true;
    }
    poll_event() {
      return 0;
    }
    set_makeup() {}
    set_patch() {
      return true;
    }
    note_on() {}
    note_off() {}
  }
  class AudioWorkletProcessor {
    constructor() {
      this.sent = [];
      this.port = { postMessage: (m) => this.sent.push(m), onmessage: null, onmessageerror: null };
    }
  }
  const processors = {};
  const registerProcessor = (name, cls) => {
    processors[name] = cls;
  };
  new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", "LivePoly", "wasm", body)(
    AudioWorkletProcessor,
    registerProcessor,
    48_000,
    LivePoly,
    { memory },
  );
  processor = new processors["auracle-voice"]();
  processor.ready = true;
  processor.handle({ type: "patch", tree: "a" });
  return { p: processor, made };
}

/** One quantum: no input. The output's left channel. */
function quantum(p) {
  const out = [[new Float32Array(Q), new Float32Array(Q)]];
  p.process([[], []], out);
  return out[0][0];
}

/** `n` quanta, their left channels end to end. */
function run(p, n) {
  const all = new Float32Array(n * Q);
  for (let k = 0; k < n; k++) all.set(quantum(p), k * Q);
  return all;
}

/** An offer in B at a mix of 0, through `quanta`, the audio struggling
 *  (`strained`, so B rests) or not. */
function offered(quanta = 50, strained = true) {
  const r = rig();
  r.p.handle({ type: "strain", on: strained });
  r.p.handle({ type: "b_patch", tree: "b" });
  r.p.handle({ type: "b_mix", mix: 0 });
  r.b = r.made[1];
  run(r.p, quanta);
  return r;
}

const onlyA = (xs) => xs.every((x) => x === A);
// The largest step from one sample to the next: a click is a jump.
const jump = (xs) => xs.slice(1).reduce((m, x, i) => Math.max(m, Math.abs(x - xs[i])), 0);

test("with headroom, an offer at Blend 0 renders every quantum, and Peek is heard at the next", () => {
  const { p, b } = offered(200, false);
  assert.equal(b.rendered, 200, "B rendered at a mix of 0");
  assert.equal(b.rested, 0);
  p.handle({ type: "b_mix", mix: 1 });
  const next = quantum(p);
  assert.ok(next.some((x) => x !== A), "B is in the very next quantum");
  assert.ok(jump([A, ...next]) < 0.01, "on the mix's ramp, with no jump");
});

test("when the audio stops struggling, a resting offer renders again", () => {
  const { p, b } = offered(100);
  assert.equal(b.rendered, 0);
  p.handle({ type: "strain", on: false });
  run(p, 20);
  assert.equal(b.rendered, 20, "it wakes and renders at a mix of 0");
  assert.equal(b.resting(), false);
  assert.ok(onlyA(quantum(p)), "still unheard at a mix of 0");
});

test("while the audio struggles, an offer at Blend 0 rests: the worklet renders one instrument a quantum", () => {
  const { p, made, b } = offered(200);
  const a = made[0];
  assert.equal(b.rendered, 0, "B rendered at a mix of 0");
  assert.equal(b.rested, 200, "B followed every quantum, resting");
  assert.equal(a.rendered, 200);
  assert.ok(onlyA(quantum(p)), "what sounds is A, untouched");
  assert.ok(b.restMix.every((m) => m === 0), "it rested only where nobody heard it");
});

test("while the audio struggles, Blend brings a resting B in, from 0, with no jump", () => {
  const { p, b } = offered();
  p.handle({ type: "b_mix", mix: 0.5 });
  // The next quantum renders B: it starts waking.
  const first = quantum(p);
  assert.equal(b.rendered, 1, "B renders the quantum after the Blend");
  // While it wakes it is silent, and the mix waits at 0, so A is not turned
  // down under nothing.
  assert.ok(onlyA(first));
  const waking = run(p, WAKE - 1);
  assert.ok(onlyA(waking), "A turned down while B had nothing to play");
  assert.equal(b.resting(), false, "awake after its wake's quanta");
  // Then B comes in on the mix's ramp, from 0.
  const after = run(p, 40);
  const heard = after.findIndex((x) => x !== A);
  assert.ok(heard >= 0 && heard < 2 * Q, `B heard ${heard} samples after it woke`);
  assert.ok(jump([A, ...after]) < 0.01, `a jump of ${jump([A, ...after])}`);
  // Equal power at 0.5: A and B each at cos(π/4).
  const want = (A + B) * Math.SQRT1_2;
  assert.ok(Math.abs(after[after.length - 1] - want) < 0.01, `${after[after.length - 1]} against ${want}`);
});

test("while the audio struggles, Peek sounds all of B while held, and Blend 0 again rests it once the ramp is down", () => {
  const { p, b } = offered();
  p.handle({ type: "b_mix", mix: 1 });
  const peeked = run(p, WAKE + 60);
  assert.ok(jump([A, ...peeked]) < 0.01, "no click coming in");
  assert.ok(Math.abs(peeked[peeked.length - 1] - B) < 0.01, `all of B: ${peeked[peeked.length - 1]}`);
  const rendered = b.rendered;
  const rested = b.rested;
  // Let go: back to the Blend's 0. B renders through the ramp down (it is
  // still heard), then rests.
  p.handle({ type: "b_mix", mix: 0 });
  const back = run(p, 80);
  assert.ok(b.rendered > rendered + 10, "B rendered while its mix ramped down");
  assert.ok(b.rested > rested, "and rested once it was down");
  assert.ok(jump([peeked[peeked.length - 1], ...back]) < 0.01, "no click going out");
  assert.ok(onlyA(back.slice(-Q)), "A alone again");
  assert.ok(b.restMix.every((m) => m < 1e-4), "it rested only where nobody heard it");
});

test("a Blend moved back to 0 while B wakes rests it again, and it wakes again from the start", () => {
  const { p, b } = offered();
  p.handle({ type: "b_mix", mix: 0.5 });
  run(p, 2);
  p.handle({ type: "b_mix", mix: 0 });
  const rested = b.rested;
  assert.ok(onlyA(run(p, 3)), "nothing of B was heard");
  assert.equal(b.rested, rested + 3, "it rested the moment the mix was back at 0");
  p.handle({ type: "b_mix", mix: 0.5 });
  const before = b.rendered;
  assert.ok(onlyA(run(p, WAKE)), "silent while it wakes again");
  assert.equal(b.rendered, before + WAKE);
  assert.ok(run(p, 20).some((x) => x !== A), "then heard");
});

test("a retiring B renders until it is silent, then goes", () => {
  const { p, b } = offered();
  p.handle({ type: "b_mix", mix: 0.7 });
  run(p, WAKE + 40);
  const rendered = b.rendered;
  // Back or Pass: B fades out, and is freed once silent.
  p.handle({ type: "b_clear" });
  const fading = run(p, 200);
  assert.ok(b.rendered > rendered + 10, "it rendered its fade");
  assert.ok(b.freed, "and was freed");
  assert.equal(p.polyB, null);
  assert.ok(jump(fading) < 0.01, "no click going");
  assert.ok(onlyA(fading.slice(-Q)), "A alone");
  assert.ok(b.restMix.every((m) => m < 1e-4), "it never rested while it was heard");
});
