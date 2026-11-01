// Unit tests for live-face.js: a face's moving layer (the trace stage mode and
// every inline face draw), the one loop that reads, measures and draws them,
// and where it paints them (on the page, or in live-paint.js's worker).
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
  createPaintSwitch,
  LIVE_PAINT_BUDGET_MS,
  LIVE_PAINT_WINDOW,
  LIVE_PROBE_RUNS,
} from "../live-face.js";
import { paintFrame } from "../live-paint.js";

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
/** A loop on a clock the test turns, a frame at a time, and an idle
 *  scheduler the test runs (`idles`, `idle()`). */
function loop(opts) {
  let queued = null;
  let t = 0;
  const idles = [];
  const lf = createLiveFaces({
    raf: (f) => {
      queued = f;
    },
    now: () => t,
    silk: () => SILK,
    dpr: () => 1,
    idle: (f) => idles.push(f),
    ...opts,
  });
  return {
    lf,
    /** The idle callbacks asked for and not yet run. */
    idles,
    /** Run the next idle callback asked for; true if there was one. */
    idle() {
      const f = idles.shift();
      if (f) f();
      return !!f;
    },
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

// ---------- where the faces are painted ----------

/** A clock the test turns, and a paint that takes `ms` on it (drawing an
 *  outline, or, with `drew` false, only the fade). */
function clocked() {
  const c = { t: 0 };
  c.clock = () => c.t;
  c.paint = (ms, drew = true) => () => {
    c.t += ms;
    return drew;
  };
  return c;
}

test("the page's paint decides where the faces are painted: over budget for the median of a window, they move, and never back", () => {
  assert.equal(LIVE_PAINT_BUDGET_MS, 2, "the live faces' budget for a frame (ADR-025)");
  const c = clocked();
  const sw = createPaintSwitch({ clock: c.clock });
  // Each paint is run, and timed on the clock handed in.
  for (let i = 1; i < LIVE_PAINT_WINDOW; i++) assert.equal(sw.time(c.paint(5)), false, `frame ${i}: the window is not full`);
  assert.equal(c.t, 5 * (LIVE_PAINT_WINDOW - 1), "every paint ran");
  assert.ok(Number.isNaN(sw.median));
  assert.equal(sw.time(c.paint(5)), true, "a full window over budget: moved");
  assert.equal(sw.median, 5);
  // One way: a paint inside budget after does not bring the faces back.
  for (let i = 0; i < 100; i++) assert.equal(sw.time(c.paint(0.1)), true);
  assert.equal(sw.moved, true);
  assert.equal(sw.frames, LIVE_PAINT_WINDOW, "and nothing is timed once moved");
});

test("a frame of the fade alone, a paint at the budget, and a few slow frames move nothing; a paint that degrades later does", () => {
  const c = clocked();
  const sw = createPaintSwitch({ clock: c.clock });
  for (let i = 0; i < 50; i++) sw.time(c.paint(30, false));
  assert.equal(sw.frames, 0, "a frame that drew no outline is not counted");
  for (let i = 0; i < 50; i++) assert.equal(sw.time(c.paint(LIVE_PAINT_BUDGET_MS)), false, "at the budget is inside it");
  // Fewer than half the window's frames slow (a collection, a resize): the
  // median is the fast ones'.
  const fast = createPaintSwitch({ clock: c.clock });
  const few = LIVE_PAINT_WINDOW / 2 - 1;
  for (let i = 0; i < LIVE_PAINT_WINDOW - few; i++) fast.time(c.paint(0.5));
  for (let i = 0; i < few; i++) assert.equal(fast.time(c.paint(50)), false, `${i + 1} slow of the last ${LIVE_PAINT_WINDOW}`);
  assert.equal(fast.median, 0.5);
  // Fast for a while, then slower for good: once half the window is over,
  // the median is too.
  const later = createPaintSwitch({ clock: c.clock });
  for (let i = 0; i < 200; i++) later.time(c.paint(0.3));
  let slow = 0;
  while (slow < 100 && !later.time(c.paint(5))) slow++;
  assert.equal(slow + 1, LIVE_PAINT_WINDOW / 2, "moved once half of the last window was slow");
});

test("the idle probe moves the faces when a frame of the largest face is over budget twice, each timing a call of its own; inside it once, the window decides", () => {
  assert.equal(LIVE_PROBE_RUNS, 2);
  const c = clocked();
  // Over: one timing a call; the first over budget owes a retake, and
  // nothing moves until it is made; the lesser of the two decides.
  const sw = createPaintSwitch({ clock: c.clock });
  assert.ok(Number.isNaN(sw.probed), "nothing probed yet");
  assert.equal(sw.retake, false);
  let runs = 0;
  const slow = (ms) => () => {
    runs++;
    c.t += ms;
  };
  assert.equal(sw.probe(slow(5)), false, "one reading over budget moves nothing");
  assert.equal(runs, 1, "timed once a call");
  assert.equal(sw.retake, true, "a retake is owed");
  assert.equal(sw.probed, 5);
  // Meanwhile the window, over budget too, moves nothing either.
  for (let i = 0; i < 2 * LIVE_PAINT_WINDOW; i++) assert.equal(sw.time(c.paint(5)), false, "nothing moves while the retake is owed");
  assert.equal(sw.probe(slow(4)), true, "the retake over budget too: moved");
  assert.equal(runs, 2);
  assert.equal(sw.probed, 4, "the lesser kept");
  assert.equal(sw.retake, false);
  assert.equal(sw.probe(slow(1)), true, "and the probe is done");
  assert.equal(runs, 2);
  for (let i = 0; i < 20; i++) assert.equal(sw.time(c.paint(0.1)), true, "never back");
  // Inside: timed once, nothing moves, and no retake is owed.
  const fast = createPaintSwitch({ clock: c.clock });
  runs = 0;
  assert.equal(fast.probe(slow(1)), false);
  assert.equal(fast.retake, false, "no retake");
  assert.equal(fast.probe(slow(9)), false, "and the probe is done");
  assert.equal(runs, 1, "timed once");
  assert.equal(fast.probed, 1);
  const at = createPaintSwitch({ clock: c.clock });
  assert.equal(at.probe(() => (c.t += LIVE_PAINT_BUDGET_MS)), false, "at the budget is inside it");
  assert.equal(at.retake, false);
  // One slow reading (a collection, a page still booting), then a fast
  // retake: the lesser is kept, and nothing moves.
  const blip = createPaintSwitch({ clock: c.clock });
  assert.equal(blip.probe(slow(9)), false);
  assert.equal(blip.probe(slow(0.5)), false);
  assert.equal(blip.probed, 0.5);
  assert.equal(blip.retake, false);
  // A retake given up (reduced motion came on): nothing moves, and the
  // window decides.
  const gone = createPaintSwitch({ clock: c.clock });
  gone.probe(slow(9));
  gone.forgo();
  assert.equal(gone.retake, false);
  assert.equal(gone.moved, false);
  // A paint inside budget at idle that is slower as the faces are played:
  // the window moves them.
  for (let i = 0; i < 50; i++) fast.time(c.paint(0.3));
  assert.equal(fast.moved, false);
  let slower = 0;
  while (slower < 100 && !fast.time(c.paint(5))) slower++;
  assert.equal(slower + 1, LIVE_PAINT_WINDOW / 2, "moved by the window once half of it was slow");
  // And a window over budget while a retake was owed moves once the retake
  // reads inside, at its next frame.
  const held = createPaintSwitch({ clock: c.clock });
  held.probe(slow(9));
  for (let i = 0; i < LIVE_PAINT_WINDOW; i++) held.time(c.paint(5));
  assert.equal(held.moved, false);
  held.probe(slow(1));
  assert.equal(held.time(c.paint(5)), true, "the window decides once the probe has");
});


/** A 2D context that records every call exactly, numbers unrounded; each
 *  `stroke` takes `strokeMs` on `clock` (`clock.t`), when one is given. */
function exact(clock = null, strokeMs = 0) {
  const ops = [];
  const canvas = { width: 0, height: 0 };
  return new Proxy(
    {},
    {
      get(t, k) {
        if (k === "ops") return ops;
        if (k === "canvas") return canvas;
        return (...a) => {
          if (k === "stroke" && clock) clock.t += strokeMs;
          ops.push([k, ...a]);
        };
      },
      set(t, k, v) {
        ops.push(["=", k, v]);
        return true;
      },
    },
  );
}
/** A page whose canvases can show a worker's pictures (`bitmaprenderer`),
 *  or, with `shows` false, cannot; a 2D context is an exact recorder, its
 *  strokes `strokeMs` long on `clock`. */
function showingPage({ shows = true, clock = null, strokeMs = 0 } = {}) {
  const made = [];
  const doc = {
    createElement() {
      const cv = { width: 0, height: 0, parentNode: null, className: "", setAttribute() {}, removed: false, shownPictures: [] };
      cv.remove = () => {
        cv.removed = true;
        cv.parentNode = null;
      };
      cv.replaceWith = (other) => {
        other.parentNode = cv.parentNode;
        cv.replacedBy = other;
        cv.remove();
      };
      cv.getContext = (kind) => {
        if (kind === "bitmaprenderer") {
          if (!shows || cv.ctx) return null;
          cv.renderer = { transferFromImageBitmap: (b) => cv.shownPictures.push(b) };
          return cv.renderer;
        }
        if (cv.renderer) return null; // a canvas has one kind of context
        cv.ctx = cv.ctx || exact(clock, strokeMs);
        return cv.ctx;
      };
      made.push(cv);
      return cv;
    },
  };
  const host = () => ({
    append(c) {
      c.parentNode = this;
    },
  });
  return { doc, made, host };
}
/** A canvas of the worker's own, painted on an exact recorder. */
const workerCanvas = () => {
  const cv = { width: 0, height: 0, ctx: exact() };
  cv.getContext = () => cv.ctx;
  return cv;
};
/** A worker that keeps what it is sent, and answers when told. */
function heldWorker() {
  const w = { sent: [], onmessage: null, onerror: null, terminated: false };
  w.postMessage = (m) => w.sent.push(structuredClone(m));
  w.terminate = () => {
    w.terminated = true;
  };
  w.answer = (frame, layers = []) => w.onmessage({ data: { frame, layers } });
  return w;
}
/** A page's paint over budget from its first frame that draws. */
const overBudget = () => createPaintSwitch({ budget: -1, frames: 1 });
/** The idle probe's face: a layer and a vessel's box as a face's. */
const PROBE = { w: 300, h: 600, box: BOX };
/** A picture of a layer as it stands: its size, and the calls made on it. */
const snap = (cv) => Promise.resolve({ width: cv.width, height: cv.height, calls: cv.ctx.ops.length });
/** What a picture's promise, and what it posts, have to do. */
const settle = () => new Promise((ok) => setImmediate(ok));
/** The faces handed to `worker` by a loop whose page paints over budget: a
 *  frame painted here starts it, it says it is up, the next frame is painted
 *  here and handed over, and it answers with a picture of each layer. */
async function handOver(L, worker) {
  L.step();
  worker.answer(0);
  L.step();
  await settle();
  const m = worker.sent[worker.sent.length - 1];
  worker.answer(
    m.frame,
    m.seed.map(({ id, bitmap }) => ({ id, bitmap: { width: bitmap.width, height: bitmap.height, close() {} } })),
  );
}

test("while the page's paint is inside budget the faces are painted here, in the frame, and no painter is started", () => {
  const c = clocked();
  const { doc, made, host } = showingPage({ clock: c, strokeMs: 0.4 });
  const voices = analyser(0.3);
  let workers = 0;
  const L = loop({ signals: [() => voices], doc, held: () => true, paintWorker: () => (workers++, heldWorker()), paintSwitch: createPaintSwitch({ clock: c.clock }) });
  L.lf.add(face(host(), 1));
  L.lf.warm(48000, PROBE);
  assert.equal(workers, 0, "not by the idle probe, inside budget");
  assert.equal(L.idles.length, 0, "and no retake asked for");
  assert.equal(made.length, 1, "the probe's canvas");
  assert.equal(made[0].width, 0, "let go");
  made.shift();
  L.lf.wake();
  for (let i = 1; i <= 100; i++) {
    L.step();
    assert.equal(strokes(made[0]), 2 * i, `frame ${i} painted here, in the frame that read it`);
  }
  assert.equal(workers, 0);
  assert.equal(L.lf.counts.here, 100);
  assert.equal(L.lf.counts.posted, 0);
  assert.equal(made.length, 1);
  // Under reduced motion the loop never runs, so however slow the paint,
  // no painter is started.
  const slow = clocked();
  const still = showingPage({ clock: slow, strokeMs: 50 });
  let others = 0;
  const M = loop({ signals: [() => voices], doc: still.doc, held: () => true, still: () => true, paintWorker: () => (others++, heldWorker()), paintSwitch: createPaintSwitch({ clock: slow.clock }) });
  M.lf.add(face(still.host(), 1));
  M.lf.warm(48000, PROBE);
  M.lf.wake();
  for (let i = 0; i < 50; i++) M.step();
  assert.equal(others, 0);
  assert.equal(still.made.length, 0, "no probe, and no layer");
});

test("a probe over budget twice, in two idle callbacks, starts the painter before the first frame, and each layer is born showing its pictures, with no frame painted here", async () => {
  const c = clocked();
  // Two outlines a frame at 3 ms each: 6 ms a frame on the page.
  const { doc, made, host } = showingPage({ clock: c, strokeMs: 3 });
  const voices = analyser(0.3);
  const worker = heldWorker();
  let workers = 0;
  const h = host();
  const L = loop({ signals: [() => voices], doc, held: () => true, paintWorker: () => (workers++, worker), picture: snap, paintSwitch: createPaintSwitch({ clock: c.clock }) });
  L.lf.add(face(h, 1));
  // The probe, in the idle callback main calls `warm` from: a frame of the
  // face, painted on a canvas of its own, never shown: once untimed with
  // no glow, then timed with its glow. Over budget: no painter yet, and
  // its retake asked for, in an idle callback of its own.
  L.lf.warm(48000, PROBE);
  const probe = made[0];
  const glow = () => sets(probe.ctx.ops, "shadowBlur");
  assert.equal(glow().length, 4, "two outlines a frame, twice");
  assert.deepEqual(glow().slice(0, 2), [0, 0], "untimed, no glow");
  assert.ok(glow().slice(2).every((b) => b > 0), "timed, its glow");
  assert.equal(workers, 0, "nothing moves on one reading");
  assert.equal(L.idles.length, 1, "the retake asked for");
  assert.notEqual(probe.width, 0, "the canvas kept for it");
  // The retake, over budget too: the painter started, before any frame.
  assert.ok(L.idle());
  assert.equal(glow().length, 2 * (1 + LIVE_PROBE_RUNS), "timed once more, in the second callback");
  assert.ok(glow().slice(4).every((b) => b > 0));
  assert.equal(count(probe.ctx.ops, "fillRect"), 1 + LIVE_PROBE_RUNS, "and the trail's fade, as a frame has");
  assert.equal(L.idles.length, 0, "no third");
  assert.equal(workers, 1, "started by the probe, before any frame");
  assert.deepEqual(worker.sent, [{ frame: 0, faces: [] }], "asked whether it is up");
  assert.equal(probe.parentNode, null, "never shown");
  assert.equal(probe.width, 0, "let go");
  // The first frame, before the painter is up: the layer is born showing
  // its pictures, and the frame goes to it.
  L.lf.wake();
  L.step();
  assert.equal(made.length, 2);
  const layer = made[1];
  assert.ok(layer.renderer, "born showing the painter's pictures");
  assert.equal(layer.ctx, undefined, "never drawn on here");
  assert.equal(layer.parentNode, h);
  assert.equal(worker.sent.length, 2);
  assert.equal(worker.sent[1].seed, undefined, "nothing to hand over");
  assert.equal(worker.sent[1].faces[0].n, 2);
  assert.deepEqual(worker.sent[1].faces[0].size, [300, 600], "the layer made, at its size, by the painter");
  // Until it answers, no frame is read.
  const reads = voices.reads;
  L.step();
  assert.equal(voices.reads, reads);
  worker.answer(0);
  const picture = { width: 300, height: 600, close() {} };
  worker.answer(1, [{ id: 0, bitmap: picture }]);
  assert.deepEqual(layer.shownPictures, [picture]);
  for (let i = 0; i < 5; i++) {
    L.step();
    worker.answer(worker.sent[worker.sent.length - 1].frame);
  }
  assert.equal(worker.sent.length, 7);
  assert.ok(worker.sent.every((m) => !m.seed), "no hand-over, ever");
  assert.equal(L.lf.counts.here, 0, "no frame painted here");
  assert.equal(made.length, 2);
  // A painter that fails then: the faces are painted here, from then on.
  worker.onerror(new Event("error"));
  assert.equal(layer.removed, true);
  L.step();
  assert.equal(made.length, 3);
  assert.equal(strokes(made[2]), 2, "painted here");
  assert.equal(workers, 1);
});

test("a probe over budget while a face's trail still fades hands that layer over as it stands, once the painter is up", async () => {
  const c = clocked();
  const { doc, made, host } = showingPage({ clock: c, strokeMs: 3 });
  const voices = analyser(0.3);
  const worker = heldWorker();
  // A window no frame fills here: only the probe moves the faces.
  const L = loop({ signals: [() => voices], doc, held: () => true, paintWorker: () => worker, picture: snap, paintSwitch: createPaintSwitch({ clock: c.clock, frames: 1000 }) });
  L.lf.add(face(host(), 1));
  L.lf.wake();
  for (let i = 0; i < 3; i++) L.step();
  assert.equal(strokes(made[0]), 6, "a sound played before the page was idle, painted here");
  L.lf.warm(48000, PROBE);
  L.idle();
  assert.equal(worker.sent.length, 1, "the painter started");
  L.step();
  assert.equal(strokes(made[0]), 8, "painted here until it is up");
  worker.answer(0);
  L.step();
  const calls = made[0].ctx.ops.length;
  await settle();
  assert.deepEqual(worker.sent[1].seed, [{ id: 0, bitmap: { width: 300, height: 600, calls } }], "the layer handed over as it stands");
  assert.equal(made[0].removed, false, "and shown until the painter answers");
});

test("between the probe's two timings nothing moves: a sound played meanwhile is painted here, and handed over as it stands once the retake reads over", async () => {
  const c = clocked();
  const { doc, made, host } = showingPage({ clock: c, strokeMs: 3 });
  const voices = analyser(0.3);
  const worker = heldWorker();
  let workers = 0;
  const sw = createPaintSwitch({ clock: c.clock });
  const L = loop({ signals: [() => voices], doc, held: () => true, paintWorker: () => (workers++, worker), picture: snap, paintSwitch: sw });
  L.lf.add(face(host(), 1));
  L.lf.warm(48000, PROBE);
  assert.equal(L.idles.length, 1, "the retake asked for");
  // A key before the retake: two windows of frames painted here, each over
  // budget, and nothing moves.
  L.lf.wake();
  for (let i = 0; i < 2 * LIVE_PAINT_WINDOW; i++) L.step();
  assert.equal(workers, 0, "no painter between the two timings");
  assert.equal(sw.moved, false);
  assert.equal(strokes(made[1]), 4 * LIVE_PAINT_WINDOW, "every frame painted here");
  // The retake reads over: the painter started, and the layer, a trail on
  // it, handed over as it stands once it is up.
  L.idle();
  assert.equal(workers, 1);
  assert.equal(sw.moved, true);
  L.step();
  worker.answer(0);
  L.step();
  const calls = made[1].ctx.ops.length;
  await settle();
  assert.deepEqual(worker.sent[1].seed, [{ id: 0, bitmap: { width: 300, height: 600, calls } }]);
});

test("a retake that reads inside budget moves nothing, and reduced motion before it gives it up", () => {
  // One slow first reading (two strokes of 3 ms), then a fast one (the
  // switch's clock slowed a hundredfold for it): the lesser decides, inside.
  const c = clocked();
  let rate = 1;
  const { doc, made, host } = showingPage({ clock: c, strokeMs: 3 });
  let workers = 0;
  const voices = analyser(0.3);
  const L = loop({ signals: [() => voices], doc, held: () => true, paintWorker: () => (workers++, heldWorker()), paintSwitch: createPaintSwitch({ clock: () => c.t * rate }) });
  L.lf.add(face(host(), 1));
  L.lf.warm(48000, PROBE);
  assert.equal(L.idles.length, 1);
  rate = 0.01;
  L.idle();
  assert.equal(workers, 0, "the lesser inside budget: nothing moves");
  assert.equal(made[0].width, 0, "the probe's canvas let go");
  // Reduced motion on before the retake: no timing, no painter.
  let still = false;
  const slow = clocked();
  const page2 = showingPage({ clock: slow, strokeMs: 3 });
  const sw = createPaintSwitch({ clock: slow.clock });
  const M = loop({ signals: [() => voices], doc: page2.doc, held: () => true, still: () => still, paintWorker: () => (workers++, heldWorker()), paintSwitch: sw });
  M.lf.add(face(page2.host(), 1));
  M.lf.warm(48000, PROBE);
  const timed = count(page2.made[0].ctx.ops, "stroke");
  still = true;
  M.idle();
  assert.equal(count(page2.made[0].ctx.ops, "stroke"), timed, "not timed again");
  assert.equal(workers, 0, "no painter");
  assert.equal(sw.retake, false, "the retake given up");
  assert.equal(page2.made[0].width, 0, "and the canvas let go");
});

test("no probe with no painter to move to; a painter the probe cannot start leaves the faces painted here", () => {
  const c = clocked();
  const none = showingPage({ clock: c, strokeMs: 3 });
  const voices = analyser(0.3);
  const N = loop({ signals: [() => voices], doc: none.doc, held: () => true, paintSwitch: createPaintSwitch({ clock: c.clock }) });
  N.lf.add(face(none.host(), 1));
  N.lf.warm(48000, PROBE);
  assert.equal(none.made.length, 0, "no probe");
  const { doc, made, host } = showingPage({ clock: c, strokeMs: 3 });
  let workers = 0;
  const L = loop({
    signals: [() => voices],
    doc,
    held: () => true,
    paintWorker: () => {
      workers++;
      throw new Error("no worker here");
    },
    paintSwitch: createPaintSwitch({ clock: c.clock }),
  });
  L.lf.add(face(host(), 1));
  L.lf.warm(48000, PROBE);
  L.idle();
  assert.equal(workers, 1, "the probe was over");
  L.lf.wake();
  for (let i = 0; i < 50; i++) L.step();
  assert.equal(made.length, 2, "the probe's canvas, and the layer");
  assert.equal(strokes(made[1]), 100, "every frame painted here");
  assert.equal(workers, 1, "and none started again");
});

test("a page's paint over budget moves the faces to the painter: started then, painted here until it is up, and each layer handed over as it stands", async () => {
  const c = clocked();
  // Two outlines a frame at 3 ms each: 6 ms a frame on the page.
  const { doc, made, host } = showingPage({ clock: c, strokeMs: 3 });
  const voices = analyser(0.3);
  const worker = heldWorker();
  let workers = 0;
  const h = host();
  const L = loop({ signals: [() => voices], doc, held: () => true, paintWorker: () => (workers++, worker), picture: snap, paintSwitch: createPaintSwitch({ clock: c.clock }) });
  L.lf.add(face(h, 1));
  L.lf.wake();
  for (let i = 1; i < LIVE_PAINT_WINDOW; i++) L.step();
  assert.equal(workers, 0, "no painter while the window fills");
  assert.equal(strokes(made[0]), 2 * (LIVE_PAINT_WINDOW - 1));
  L.step();
  assert.equal(workers, 1, "a window over budget starts the painter");
  assert.deepEqual(worker.sent, [{ frame: 0, faces: [] }], "asked whether it is up");
  // Not up yet: the page goes on painting, in the frame.
  L.step();
  assert.equal(strokes(made[0]), 2 * (LIVE_PAINT_WINDOW + 1));
  assert.equal(worker.sent.length, 1);
  worker.answer(0);
  // Up: this frame is painted here too, then the layer is handed over as
  // this frame left it.
  L.step();
  const calls = made[0].ctx.ops.length;
  assert.equal(strokes(made[0]), 2 * (LIVE_PAINT_WINDOW + 2));
  await settle();
  assert.equal(worker.sent.length, 2);
  const seed = worker.sent[1];
  assert.deepEqual(seed.faces, []);
  assert.deepEqual(seed.seed, [{ id: 0, bitmap: { width: 300, height: 600, calls } }], "a picture of the layer, every call made on it");
  // Until the painter answers, no frame is read, and the layer painted here
  // stays as it was.
  const reads = voices.reads;
  L.step();
  L.step();
  assert.equal(voices.reads, reads);
  assert.equal(made[0].ctx.ops.length, calls);
  assert.equal(made[0].removed, false);
  const picture = { width: 300, height: 600, close() {} };
  worker.answer(seed.frame, [{ id: 0, bitmap: picture }]);
  assert.equal(made.length, 2);
  assert.equal(made[0].replacedBy, made[1], "a layer that shows the painter's pictures takes its place");
  assert.equal(made[1].parentNode, h);
  assert.deepEqual(made[1].shownPictures, [picture]);
  // From then on each frame goes to the painter, and nothing more is
  // painted here.
  L.step();
  assert.equal(worker.sent.length, 3);
  assert.equal(worker.sent[2].faces[0].n, 2);
  assert.equal(worker.sent[2].faces[0].size, null, "the size it was handed over at");
  assert.equal(made[0].ctx.ops.length, calls);
  assert.equal(made[1].ctx, undefined);
  assert.equal(L.lf.counts.here, LIVE_PAINT_WINDOW + 2);
});

test("handed over, each layer shows the painter's pictures, and one frame is in it at a time", async () => {
  const { doc, made, host } = showingPage();
  const voices = analyser(0.3);
  const worker = heldWorker();
  const L = loop({ signals: [() => voices], doc, held: () => true, paintWorker: () => worker, picture: snap, paintSwitch: overBudget() });
  L.lf.add(face(host(), 1));
  L.lf.wake();
  await handOver(L, worker);
  assert.ok(made[1].renderer, "the layer shows pictures");
  assert.equal(made[1].ctx, undefined, "and is never drawn on here");
  assert.ok(L.step());
  assert.equal(worker.sent.length, 3);
  const op = worker.sent[2].faces[0];
  assert.equal(op.id, 0);
  assert.equal(op.n, 2, "the outline lit and what sounds");
  // The worker has not answered: the next frames wait, read nothing, and
  // send nothing.
  const reads = voices.reads;
  const measured = L.lf.counts.measures;
  assert.ok(L.step());
  assert.ok(L.step());
  assert.equal(worker.sent.length, 3, "one frame in the worker at a time");
  assert.equal(voices.reads, reads, "a frame waiting reads nothing");
  assert.equal(L.lf.counts.measures, measured);
  assert.equal(L.lf.running, true, "and the loop goes on");
  // Answered with the layer's picture: it is shown, at its size, and the
  // next frame goes.
  const picture = { width: 300, height: 640, close() {} };
  worker.answer(worker.sent[2].frame, [{ id: 0, bitmap: picture }]);
  assert.equal(made[1].shownPictures[made[1].shownPictures.length - 1], picture);
  assert.equal(made[1].width, 300);
  assert.equal(made[1].height, 640);
  assert.ok(L.step());
  assert.equal(worker.sent.length, 4);
  // An old answer does not let a frame through, and its pictures are let
  // go.
  const old = { width: 300, height: 640, closed: false, close() { old.closed = true; } };
  worker.answer(worker.sent[2].frame, [{ id: 0, bitmap: old }]);
  L.step();
  assert.equal(worker.sent.length, 4);
  assert.equal(made[1].shownPictures.includes(old), false);
  assert.equal(old.closed, true);
});

test("handed over mid-sound, or from the first frame by the probe, the painter paints the same calls, in the same order, as the page paints", async () => {
  // The same faces, sounds and clock, painted here throughout; painted here
  // until a window of frames has been timed and then in a worker (whose
  // frames live-paint.js's own `paintFrame` paints on exact recorders); and
  // in the worker from the first frame, the idle probe over budget: each
  // layer's calls, the page's until the hand-over and the worker's after the
  // picture it was handed, or the worker's alone, are the page's calls,
  // frame by frame, through a sound, its fade and the trail cleared, a face
  // leaving the screen and coming back, and a resize.
  const WINDOW = 10;
  const run = async (withWorker, probed = false) => {
    const { doc, made, host } = showingPage({ shows: withWorker });
    const voices = analyser(0.3);
    const offer = analyser(0.2, 660);
    let size = 600;
    let bShown = true;
    const layers = new Map();
    const worker = heldWorker();
    worker.postMessage = (m) => {
      // Painted at once, as the worker paints it, and answered.
      const ids = paintFrame(layers, structuredClone(m), workerCanvas);
      worker.answer(m.frame, ids.map((id) => ({ id, bitmap: null })));
    };
    const L = loop({
      signals: [() => voices, () => offer],
      doc,
      held: () => true,
      paintWorker: withWorker ? () => worker : null,
      picture: snap,
      paintSwitch: createPaintSwitch({ budget: -1, frames: WINDOW }),
    });
    const tall = (h) => ({
      place(p) {
        p.host = h;
        p.hw = 300;
        p.hh = size;
        Object.assign(p.box, BOX);
        p.face = bank[1];
        p.stats = stats;
        p.color = GREEN;
        p.hears = 1;
        p.inHand = true;
        return true;
      },
    });
    L.lf.add(tall(host()));
    L.lf.add(face(host(), 2, { inHand: false, on: () => bShown }));
    if (probed) {
      L.lf.warm(48000, PROBE);
      L.idle(); // the retake
      made.shift(); // the probe's canvas
    }
    L.lf.wake();
    // 16 ms a frame: the trail is cleared 1.6 s after the sound stops.
    for (let i = 0; i < 200; i++) {
      if (i === 20) offer.amp = 0.35;
      if (i === 30) bShown = false;
      if (i === 45) bShown = true;
      if (i === 50) size = 640;
      if (i === 70) voices.amp = offer.amp = 0;
      L.step();
      await settle();
    }
    return { made, layers, counts: { ...L.lf.counts } };
  };
  const here = await run(false);
  const there = await run(true);
  assert.equal(here.counts.posted, 0);
  assert.equal(there.counts.here, WINDOW, "painted here until a window was timed");
  assert.ok(there.counts.painted > 100 && there.counts.painted === there.counts.posted, "the worker painted every frame sent");
  assert.equal(here.made.length, 2);
  for (let i = 0; i < 2; i++) {
    const want = here.made[i].ctx.ops;
    assert.ok(count(want, "stroke") > 50 && count(want, "fillRect") > 50 && count(want, "clearRect") >= 1, `layer ${i} was painted, faded and cleared`);
    const before = there.made[i].ctx.ops;
    assert.ok(count(before, "stroke") >= WINDOW, `layer ${i} was painted here first`);
    const after = there.layers.get(i).cv.ctx.ops;
    const [first, ...rest] = after;
    assert.equal(first[0], "drawImage", `layer ${i}: the painter starts from the page's picture`);
    assert.deepEqual(first.slice(1), [{ width: 300, height: 600, calls: before.length }, 0, 0], "of every call made on it");
    const got = [...before, ...rest];
    assert.equal(got.length, want.length, `layer ${i}: as many calls`);
    const at = want.findIndex((op, j) => JSON.stringify(op) !== JSON.stringify(got[j]));
    assert.equal(at, -1, `layer ${i}: call ${at} differs: ${JSON.stringify(want[at])} on the page, ${JSON.stringify(got[at])} here then in the worker`);
    assert.equal(there.layers.get(i).cv.width, here.made[i].width);
    assert.equal(there.layers.get(i).cv.height, here.made[i].height);
  }
  const born = await run(true, true);
  assert.equal(born.counts.here, 0, "no frame painted here");
  assert.ok(born.counts.painted > 100 && born.counts.painted === born.counts.posted, "the worker painted every frame sent");
  for (let i = 0; i < 2; i++) {
    assert.ok(born.made[i].renderer && !born.made[i].ctx, `layer ${i} was born showing the painter's pictures`);
    const want = here.made[i].ctx.ops;
    const got = born.layers.get(i).cv.ctx.ops;
    assert.equal(got.length, want.length, `layer ${i}: as many calls`);
    const at = want.findIndex((op, j) => JSON.stringify(op) !== JSON.stringify(got[j]));
    assert.equal(at, -1, `layer ${i}: call ${at} differs: ${JSON.stringify(want[at])} on the page, ${JSON.stringify(got[at])} in the worker`);
  }
});

test("a painter that fails: its layers are made again and painted here, and no other is started", async () => {
  const { doc, made, host } = showingPage();
  const voices = analyser(0.3);
  const worker = heldWorker();
  let workers = 0;
  const h = host();
  const L = loop({ signals: [() => voices], doc, held: () => true, paintWorker: () => (workers++, worker), picture: snap, paintSwitch: overBudget() });
  L.lf.add(face(h, 1));
  L.lf.wake();
  await handOver(L, worker);
  L.step();
  assert.ok(made[1].renderer);
  worker.onerror(new Event("error"));
  assert.equal(worker.terminated, true);
  assert.equal(made[1].removed, true, "the worker's layer leaves the slot");
  // The frame it never answered no longer holds the loop.
  assert.ok(L.step());
  assert.equal(made.length, 3);
  assert.equal(made[2].parentNode, h, "a layer of the page's own, over the same face");
  assert.equal(count(made[2].ctx.ops, "stroke"), 2, "painted here");
  // The page's paint is still over budget: it is painted here all the same.
  for (let i = 0; i < 50; i++) L.step();
  assert.equal(workers, 1);
  assert.equal(count(made[2].ctx.ops, "stroke"), 102);
  // A late answer from the worker shows nothing.
  const late = { width: 1, height: 1, closed: false, close() { late.closed = true; } };
  worker.answer(3, [{ id: 0, bitmap: late }]);
  assert.equal(made[1].shownPictures.includes(late), false);
  assert.equal(late.closed, true, "and is let go");
});

test("a painter that fails while it takes the faces over leaves each layer as the page left it, painted here", async () => {
  const { doc, made, host } = showingPage();
  const voices = analyser(0.3);
  const worker = heldWorker();
  const L = loop({ signals: [() => voices], doc, held: () => true, paintWorker: () => worker, picture: snap, paintSwitch: overBudget() });
  L.lf.add(face(host(), 1));
  L.lf.wake();
  L.step();
  worker.answer(0);
  L.step();
  await settle();
  assert.ok(worker.sent[1].seed, "handed over");
  worker.onerror(new Event("error"));
  assert.equal(worker.terminated, true);
  assert.equal(made[0].removed, false, "the layer painted here stays, its trail as it was");
  assert.ok(L.step());
  assert.equal(made.length, 1);
  assert.equal(strokes(made[0]), 6, "and is painted on, here");
});

test("a layer whose picture cannot be taken stays painted here, and the pictures taken of the others are let go", async () => {
  const { doc, made, host } = showingPage();
  const voices = analyser(0.3);
  const worker = heldWorker();
  const taken = [];
  // The first layer's picture is taken, the second's refused.
  const picture = (cv) => {
    if (cv !== made[0]) return Promise.reject(new Error("no picture"));
    const b = { width: cv.width, height: cv.height, closed: false, close() { b.closed = true; } };
    taken.push(b);
    return Promise.resolve(b);
  };
  const L = loop({ signals: [() => voices], doc, held: () => true, paintWorker: () => worker, picture, paintSwitch: overBudget() });
  L.lf.add(face(host(), 1));
  L.lf.add(face(host(), 1));
  L.lf.wake();
  L.step();
  worker.answer(0);
  L.step();
  await settle();
  assert.equal(worker.terminated, true);
  assert.equal(worker.sent.length, 1, "nothing handed over");
  assert.equal(taken.length, 1);
  assert.equal(taken[0].closed, true, "the picture taken is let go");
  assert.ok(L.step());
  assert.equal(made.length, 2);
  assert.equal(strokes(made[0]), 6);
  assert.equal(strokes(made[1]), 6);
});

test("a hand-over that cannot be sent lets its pictures go and paints here, and the loop is not left waiting", async () => {
  const { doc, made, host } = showingPage();
  const voices = analyser(0.3);
  const worker = heldWorker();
  const send = worker.postMessage;
  worker.postMessage = (m) => {
    if (m.seed) throw new DOMException("could not clone", "DataCloneError");
    send(m);
  };
  const taken = [];
  const picture = (cv) => {
    const b = { width: cv.width, height: cv.height, closed: false, close() { b.closed = true; } };
    taken.push(b);
    return Promise.resolve(b);
  };
  const L = loop({ signals: [() => voices], doc, held: () => true, paintWorker: () => worker, picture, paintSwitch: overBudget() });
  L.lf.add(face(host(), 1));
  L.lf.wake();
  L.step();
  worker.answer(0);
  L.step();
  await settle();
  assert.equal(worker.terminated, true);
  assert.equal(taken.length, 1);
  assert.equal(taken[0].closed, true, "the picture is let go");
  const reads = voices.reads;
  assert.ok(L.step());
  assert.ok(voices.reads > reads, "the next frame is read");
  assert.equal(made.length, 1);
  assert.equal(strokes(made[0]), 6, "and painted here");
});

test("a frame the worker could not finish hands its faces back to the page", async () => {
  const { doc, made, host } = showingPage();
  const voices = analyser(0.3);
  const worker = heldWorker();
  const L = loop({ signals: [() => voices], doc, held: () => true, paintWorker: () => worker, picture: snap, paintSwitch: overBudget() });
  L.lf.add(face(host(), 1));
  L.lf.wake();
  await handOver(L, worker);
  L.step();
  worker.onmessage({ data: { frame: 2, failed: "no picture" } });
  assert.equal(worker.terminated, true);
  assert.equal(made[1].removed, true);
  assert.ok(L.step());
  assert.equal(count(made[2].ctx.ops, "stroke"), 2, "painted here");
});

test("a browser that cannot show a worker's pictures paints here", async () => {
  const { doc, made, host } = showingPage({ shows: false });
  const voices = analyser(0.3);
  const worker = heldWorker();
  const L = loop({ signals: [() => voices], doc, held: () => true, paintWorker: () => worker, picture: snap, paintSwitch: overBudget() });
  L.lf.add(face(host(), 1));
  L.lf.wake();
  await handOver(L, worker);
  assert.equal(worker.terminated, true);
  assert.equal(made[0].removed, false, "the layer painted here stays");
  L.step();
  assert.equal(strokes(made[0]), 6, "three frames, each painted here");
});
