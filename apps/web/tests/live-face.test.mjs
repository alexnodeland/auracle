// Unit tests for live-face.js: a face's moving layer (the trace stage mode and
// every inline face draw) and the one loop that reads, measures and draws them.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { decodeFace, bankStats, vesselPoints, smooth, whiten, FACE_LEN, FACE_BANDS, FACE_SLICES } from "../faces.js";
import { traceVessel } from "../vessel.js";
import {
  LIVE_CLEAR_MS,
  LIVE_FALL,
  LIVE_TRACE_MIN_H,
  loudness,
  traceScale,
  createTrace,
  traceHear,
  traceFade,
  traceDraw,
  pointsInto,
  tracePoints,
  createLiveFaces,
} from "../live-face.js";

/** A 2D context that records every call and every style it is given. */
function recorder() {
  const ops = [];
  const canvas = { width: 300, height: 600 };
  return new Proxy(
    { ops },
    {
      get(t, k) {
        if (k === "ops") return ops;
        if (k === "canvas") return canvas;
        return (...a) => ops.push([k, ...a.map((v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v))]);
      },
      set(t, k, v) {
        ops.push(["=", k, v]);
        return true;
      },
    },
  );
}
const count = (ops, name) => ops.filter((o) => o[0] === name).length;
const sets = (ops, prop) => ops.filter((o) => o[0] === "=" && o[1] === prop).map((o) => o[2]);

function bytes(ltas) {
  const b = new Uint8Array(FACE_LEN);
  const enc = (db) => Math.round((db + 60) / 0.5);
  for (let i = 0; i < FACE_BANDS; i++) b[i] = enc(ltas[i]);
  for (let t = 0; t < FACE_SLICES; t++) for (let i = 0; i < FACE_BANDS; i++) b[FACE_BANDS + t * FACE_BANDS + i] = enc(ltas[i]);
  return b;
}
const tilt = (slope) => Array.from({ length: FACE_BANDS }, (_, i) => Math.max(-60, -slope * i));
const bank = [tilt(0.5), tilt(1), tilt(1.5), tilt(2)].map((t) => decodeFace(bytes(t)));
const stats = bankStats(bank);
const GREEN = "#8ef0b1";
const SILK = "#e8e4da";
const BOX = { x: 20, y: 30, w: 240, h: 400 };

/** A frame measured as a face is, `rmsDb` loud. */
const heard = (rmsDb, slope = 1) => ({ db: Float64Array.from(tilt(slope)), rmsDb });

test("the points are the vessel's: pointsInto is vesselPoints, made into one buffer", () => {
  const dev = whiten(bank[2].ltas, stats);
  const want = vesselPoints(dev, BOX, 0.8).flat();
  const got = pointsInto(new Float64Array(FACE_BANDS * 4), dev, BOX, 0.8);
  assert.equal(got.length, want.length);
  for (let i = 0; i < want.length; i++) assert.ok(Math.abs(got[i] - want[i]) < 1e-9, `point ${i}`);
  // …and joined as vessel.js joins them.
  const a = recorder();
  const b = recorder();
  traceVessel(a, vesselPoints(dev, BOX, 0.8));
  tracePoints(b, got, FACE_BANDS * 2);
  assert.deepEqual(b.ops, a.ops);
});

test("loudness runs from −42 dBFS (nothing) to −8 (all), and an inline face's lines scale with its box", () => {
  assert.equal(loudness(-Infinity), 0);
  assert.equal(loudness(-42), 0);
  assert.equal(loudness(-8), 1);
  assert.equal(loudness(0), 1);
  assert.ok(Math.abs(loudness(-25) - 0.5) < 1e-9);
  assert.equal(traceScale(600), 1, "stage size");
  assert.equal(traceScale(1200), 1);
  assert.equal(traceScale(300), 0.5);
  assert.equal(traceScale(10), 0.1, "a map's mark: at least a tenth");
});

test("a trace hears a loud frame against the bank, eases what it shows, and silence draws nothing", () => {
  const tr = createTrace();
  assert.equal(traceHear(tr, null, stats, 0), false, "silence");
  assert.equal(traceHear(tr, heard(-60), stats, 10), false, "too quiet to draw");
  assert.equal(tr.has, false);
  assert.equal(traceHear(tr, heard(-8, 2), stats, 20), true);
  assert.equal(tr.loudAt, 20);
  assert.equal(tr.loud, 0.5, "a rise is followed by half a frame at a time");
  const first = whiten(Float64Array.from(tilt(2)), stats);
  for (let b = 0; b < FACE_BANDS; b++) assert.ok(Math.abs(tr.live[b] - first[b]) < 1e-9, "the first frame as heard");
  traceHear(tr, heard(-8, 0.5), stats, 36);
  const second = whiten(Float64Array.from(tilt(0.5)), stats);
  for (let b = 0; b < FACE_BANDS; b++) assert.ok(Math.abs(tr.live[b] - (first[b] + second[b]) / 2) < 1e-9, "then eased");
  const loud = tr.loud;
  assert.equal(traceHear(tr, null, stats, 52), false);
  assert.ok(Math.abs(tr.loud - loud * (1 - LIVE_FALL)) < 1e-9, "a fall is followed slowly");
  assert.equal(tr.loudAt, 36, "silence is not a sound heard");
});

test("the trail fades like phosphor while it is heard, and is cleared once, a moment after the last sound", () => {
  const tr = createTrace();
  traceHear(tr, heard(-10), stats, 1000);
  const g = recorder();
  traceFade(g, tr, 0, 0, 100, 200, 1016, false, GREEN);
  assert.equal(count(g.ops, "fillRect"), 1);
  assert.deepEqual(sets(g.ops, "globalCompositeOperation"), ["destination-out"]);
  assert.deepEqual(sets(g.ops, "fillStyle"), ["rgba(142, 240, 177, 0.14)"]);
  assert.equal(tr.cleared, false);
  const later = recorder();
  traceFade(later, tr, 0, 0, 100, 200, 1000 + LIVE_CLEAR_MS + 1, false, GREEN);
  assert.equal(count(later.ops, "clearRect"), 1, "cleared outright");
  assert.equal(count(later.ops, "fillRect"), 0);
  assert.equal(tr.cleared, true);
  const after = recorder();
  traceFade(after, tr, 0, 0, 100, 200, 1000 + LIVE_CLEAR_MS + 20, false, GREEN);
  assert.equal(after.ops.length, 0, "and then nothing: no work in silence");
  // Reduced motion: cleared at once, however recent the sound.
  const still = createTrace();
  traceHear(still, heard(-10), stats, 0);
  still.cleared = false;
  const s = recorder();
  traceFade(s, still, 0, 0, 100, 200, 16, true, GREEN);
  assert.equal(count(s.ops, "clearRect"), 1);
  assert.equal(count(s.ops, "fillRect"), 0);
});

test("stage size draws stage mode's two outlines; a small face only brightens its own", () => {
  const tr = createTrace();
  traceHear(tr, heard(-8), stats, 0);
  const g = recorder();
  traceDraw(g, tr, { face: bank[1], stats, box: BOX, color: GREEN, silk: SILK, scale: 1 });
  const loud = tr.loud;
  assert.equal(count(g.ops, "stroke"), 2, "the vessel's outline lit, and what sounds");
  assert.deepEqual(sets(g.ops, "lineWidth"), [2, 1.6 + loud * 1.6]);
  assert.deepEqual(sets(g.ops, "shadowBlur"), [18 + loud * 56, 10 + loud * 30]);
  assert.deepEqual(sets(g.ops, "strokeStyle"), [`rgba(142, 240, 177, ${0.12 + 0.55 * loud})`, "rgba(232, 228, 218, 0.95)"]);
  // The lit outline is the face's own, smoothed as stage mode lights it.
  const want = recorder();
  traceVessel(want, vesselPoints(smooth(whiten(bank[1].ltas, stats), 1), BOX));
  const firstPath = g.ops.slice(g.ops.findIndex((o) => o[0] === "beginPath"), g.ops.findIndex((o) => o[0] === "closePath") + 1);
  assert.deepEqual(firstPath, want.ops);
  const small = recorder();
  traceDraw(small, tr, { face: bank[1], stats, box: { x: 0, y: 0, w: 12, h: LIVE_TRACE_MIN_H - 1 }, color: GREEN, silk: SILK, scale: traceScale(LIVE_TRACE_MIN_H - 1), trace: false });
  assert.equal(count(small.ops, "stroke"), 1, "only the outline");
  assert.deepEqual(sets(small.ops, "lineWidth"), [1], "never thinner than a pixel");
});

// ---------- the loop ----------

/** An analyser playing a sine at `amp` (0 is silence), counting its reads. */
function analyser(amp = 0, hz = 440) {
  const a = {
    amp,
    reads: 0,
    context: { sampleRate: 48000 },
    getFloatTimeDomainData(buf) {
      a.reads++;
      for (let i = 0; i < buf.length; i++) buf[i] = a.amp * Math.sin((2 * Math.PI * hz * i) / 48000);
    },
  };
  return a;
}
/** A page: a canvas maker and hosts that hold what is appended to them. */
function page() {
  const made = [];
  const doc = {
    createElement() {
      const cv = { width: 0, height: 0, parentNode: null, className: "", setAttribute() {} };
      const ctx = recorder();
      cv.getContext = () => ctx;
      cv.ctx = ctx;
      made.push(cv);
      return cv;
    },
  };
  const host = () => ({
    kids: [],
    append(c) {
      c.parentNode = this;
      this.kids.push(c);
    },
  });
  return { doc, made, host };
}
/** A loop on a clock the test turns, a frame at a time. */
function loop(opts) {
  let queued = null;
  let t = 0;
  const lf = createLiveFaces({
    raf: (f) => {
      queued = f;
    },
    now: () => t,
    silk: () => SILK,
    dpr: () => 1,
    ...opts,
  });
  return {
    lf,
    /** Run the frame asked for, if one was; true if it ran. */
    step(ms = 16) {
      t += ms;
      const f = queued;
      queued = null;
      if (f) f();
      return !!f;
    },
    get queued() {
      return !!queued;
    },
  };
}
function face(host, hears, { inHand = true, on = () => true } = {}) {
  return {
    place(p) {
      if (!on()) return false;
      p.host = host;
      p.hw = 300;
      p.hh = 600;
      Object.assign(p.box, BOX);
      p.face = bank[1];
      p.stats = stats;
      p.color = GREEN;
      p.hears = hears;
      p.inHand = inHand;
      return true;
    },
  };
}
const strokes = (cv) => count(cv.ctx.ops, "stroke");

test("each signal is read once a frame and each sound measured once, however many faces show it", () => {
  const { doc, made, host } = page();
  const voices = analyser(0.3);
  const offer = analyser(0.3, 880);
  const phrase = analyser(0);
  const L = loop({ signals: [() => voices, () => offer, () => phrase], doc, held: () => true });
  // The sound in hand twice (the well and, say, a face in flight's
  // neighbour), hearing the voices and Space's phrase; B hearing its share.
  L.lf.add(face(host(), 1 | 4));
  L.lf.add(face(host(), 1 | 4));
  L.lf.add(face(host(), 2, { inHand: false }));
  L.lf.wake();
  assert.ok(L.step());
  assert.equal(voices.reads, 1);
  assert.equal(offer.reads, 1);
  assert.equal(phrase.reads, 1, "read, and silent");
  assert.equal(L.lf.counts.measures, 2, "one for the sound in hand (the phrase is silent), one for B");
  assert.equal(made.length, 3, "a layer for each face");
  for (const cv of made) assert.equal(strokes(cv), 2, "each draws its outline lit and what sounds");
  // The phrase sounds too: the sound in hand is the voices and the phrase,
  // summed and measured once.
  phrase.amp = 0.2;
  assert.ok(L.step());
  assert.equal(voices.reads, 2);
  assert.equal(L.lf.counts.measures, 4);
});

test("a face off screen is not drawn, and a signal nobody on screen hears is not read", () => {
  const { doc, made, host } = page();
  const voices = analyser(0.3);
  const offer = analyser(0.3);
  let bShown = false;
  const L = loop({ signals: [() => voices, () => offer], doc, held: () => true });
  L.lf.add(face(host(), 1));
  L.lf.add(face(host(), 2, { inHand: false, on: () => bShown }));
  L.lf.wake();
  L.step();
  assert.equal(offer.reads, 0);
  assert.equal(made.length, 1);
  bShown = true;
  L.step();
  assert.equal(offer.reads, 1);
  assert.equal(made.length, 2);
});

test("in silence nothing is measured, the trail is cleared, and the loop idles until woken", () => {
  const { doc, made, host } = page();
  const voices = analyser(0.3);
  let keyDown = true;
  const L = loop({ signals: [() => voices], doc, held: () => keyDown });
  L.lf.add(face(host(), 1));
  L.lf.wake();
  L.step();
  assert.equal(strokes(made[0]), 2);
  // The key comes up and the sound stops.
  keyDown = false;
  voices.amp = 0;
  const measured = L.lf.counts.measures;
  let frames = 0;
  while (L.step()) frames++;
  assert.equal(L.lf.counts.measures, measured, "silence is read, never measured");
  assert.ok(frames * 16 >= LIVE_CLEAR_MS && frames * 16 <= LIVE_CLEAR_MS + 64, `stopped ${frames} frames after the sound`);
  assert.equal(count(made[0].ctx.ops, "clearRect"), 1, "the trail cleared once");
  assert.equal(L.lf.running, false);
  const reads = voices.reads;
  L.step();
  L.step();
  assert.equal(voices.reads, reads, "no frame runs in silence");
  // A key wakes it.
  L.lf.wake();
  assert.equal(L.lf.running, true);
});

test("under reduced motion nothing moves: the loop never runs, and a layer drawn is cleared", () => {
  const { doc, made, host } = page();
  const voices = analyser(0.3);
  let still = false;
  const L = loop({ signals: [() => voices], doc, held: () => true, still: () => still });
  L.lf.add(face(host(), 1));
  L.lf.wake();
  L.step();
  assert.equal(strokes(made[0]), 2);
  still = true;
  L.step();
  assert.equal(count(made[0].ctx.ops, "clearRect"), 1, "what was drawn goes");
  assert.equal(L.lf.running, false);
  L.lf.wake();
  assert.equal(L.lf.running, false, "and it is not woken");
  assert.equal(L.step(), false);
});

test("stage mode (off) covers the inline faces: they are cleared and nothing is read", () => {
  const { doc, made, host } = page();
  const voices = analyser(0.3);
  let stage = false;
  const L = loop({ signals: [() => voices], doc, held: () => true, off: () => stage });
  L.lf.add(face(host(), 1));
  L.lf.wake();
  L.step();
  stage = true;
  const reads = voices.reads;
  L.step();
  assert.equal(voices.reads, reads);
  assert.equal(count(made[0].ctx.ops, "clearRect"), 1);
  assert.equal(L.lf.running, false);
});

test("the face in flight keeps what it showed, and draws what sounds while it flies", () => {
  const { doc, host } = page();
  const voices = analyser(0.3);
  const L = loop({ signals: [() => voices], doc, held: () => true, flightHears: () => 1 });
  L.lf.add(face(host(), 1));
  L.lf.wake();
  L.step();
  L.step();
  // The move starts: the flight's first frame draws what the well heard.
  const g = recorder();
  assert.equal(L.lf.flight(g, { face: bank[1], stats, box: BOX, color: GREEN, alpha: 0.5 }), true);
  assert.equal(count(g.ops, "stroke"), 2);
  // While it flies, the loop goes on hearing for it.
  L.step();
  const reads = voices.reads;
  assert.equal(L.lf.flight(recorder(), { face: bank[1], stats, box: BOX, color: GREEN }), true);
  L.step();
  assert.equal(voices.reads, reads + 1);
  // Silence: it flies still.
  voices.amp = 0;
  L.step();
  L.step();
  const quiet = recorder();
  assert.equal(L.lf.flight(quiet, { face: bank[1], stats, box: BOX, color: GREEN }), false);
  assert.equal(quiet.ops.length, 0);
});

test("a layer put out of its slot (the slot filled anew) goes back over it", () => {
  const { doc, made, host } = page();
  const voices = analyser(0.3);
  const h = host();
  const L = loop({ signals: [() => voices], doc, held: () => true });
  L.lf.add(face(h, 1));
  L.lf.wake();
  L.step();
  assert.equal(made[0].parentNode, h);
  made[0].parentNode = null; // innerHTML replaced
  L.step();
  assert.equal(made[0].parentNode, h);
  assert.equal(made.length, 1, "the same layer, its trail as it was");
});
