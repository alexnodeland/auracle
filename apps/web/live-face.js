// A sound's face, alive: what sounds now, drawn over the face in the face's
// own bands and against the same bank, so in the vessel's coordinates (the
// mock's stage, docs/notes/vision-2026-09/prototype/stage.js `frame`). Stage
// mode drew it alone; now every face of a sound being played draws it, inline
// at its own size: PERFORM's well (and B's), PATCH's face at OUT, the face in
// flight between the levels, the EVOLVE card being played, and the sound's
// mark on TASTE's and LEARNING's maps.
//
// Two parts:
// - **the trace**, one face's moving layer frame by frame (`createTrace`,
//   `traceHear`, `traceFade`, `traceDraw`): the vessel's outline lit by how
//   loud it is, and the live outline, both left to fade like phosphor and
//   cleared a moment after the last sound. Stage mode draws through these, at
//   full size; an inline face draws the same thing scaled to its box, and a
//   face too small for a second outline only brightens its own.
// - **the loop** (`createLiveFaces`), one animation frame for every live face
//   on screen: each signal a face listens to is read once a frame, each sound
//   measured once (faces.js `createLiveMeter`: the face's own Hann frame and
//   bands), however many faces show it, into buffers made once. It runs only
//   while something is played or a trace is still fading, and draws only the
//   faces on screen; under reduced motion it never runs, and the faces stay
//   still. What each frame draws is decided here, on the page; the canvas
//   calls are live-paint.js's, made in a worker of their own on canvases
//   handed to it, where the browser can (the glow is a blur that a browser
//   drawing on the CPU makes on the thread that asks: #512), and here where
//   it cannot. One frame is in the worker at a time: the loop sends the next
//   once the last is painted, so a frame there is a frame here, as slow a
//   machine as it is.
//
// ADR-012: what moves is a measurement of what is heard, never a guess. A face
// listens only to the signal that is its own sound (main.js says which: the
// voices' share of the output for the sound in hand, B's share for B, the
// phrase a ▶ plays for the sound it names), so a face responds to what you
// hear of it, and to nothing else. Pure over its canvas contexts and its
// analysers, which are handed in, so it is unit-tested (tests/live-face.test.mjs).
import { FACE_BANDS, FACE_FRAME, createLiveMeter, whiten, smooth } from "./faces.js";
import { tint } from "./vessel.js";
// Under this module's own stamp: the worker loads it on its own, with no
// import map, so it imports nothing.
const { tracePoints, paintFade, paintStrokes, paintLayer, FADE_NONE, FADE_STEP, FADE_CLEAR } = await import(
  `./live-paint.js${new URL(import.meta.url).search}`
);
export { tracePoints };

/** How loud, as the mock reads it: −42 dBFS (RMS) is nothing, −8 is all. */
export const LIVE_QUIET_DB = -42;
export const LIVE_FULL_DB = -8;
/** Below this loudness (0 to 1) nothing is drawn: it is silence. */
export const LIVE_FLOOR = 0.05;
/** How fast the loudness follows a rise and a fall, a frame at a time. */
export const LIVE_RISE = 0.5;
export const LIVE_FALL = 0.08;
/** What is left of the trail after a frame (`destination-out` at this alpha). */
export const LIVE_FADE = 0.14;
/** The fade never quite reaches nothing in 8-bit alpha: this long after the
 *  last sound the trail is cleared outright. */
export const LIVE_CLEAR_MS = 1600;
/** A face's box (px tall) below which only its outline brightens: the live
 *  outline is not drawn, as at that size it cannot be read. */
export const LIVE_TRACE_MIN_H = 40;
/** The box height (px) at which an inline face draws its lines and glow as
 *  stage mode does; smaller boxes scale them down, to a tenth at least. */
export const LIVE_FULL_H = 600;
/** A signal quieter than this (dBFS, RMS, as heard) is not measured. */
export const LIVE_SILENT_DB = -60;

/** Loudness (0 to 1) of a frame at `rmsDb` dBFS. */
export function loudness(rmsDb) {
  const l = (rmsDb - LIVE_QUIET_DB) / (LIVE_FULL_DB - LIVE_QUIET_DB);
  return l > 0 ? (l < 1 ? l : 1) : 0;
}

/** The scale of an inline face's lines and glow, for a box `h` px tall. */
export function traceScale(h) {
  const k = h / LIVE_FULL_H;
  return k > 1 ? 1 : k < 0.1 ? 0.1 : k;
}

/** One face's moving layer: what it last heard, how loud, and when, in
 *  buffers made once. */
export function createTrace() {
  return {
    live: new Float64Array(FACE_BANDS), // what sounds, against the bank, eased
    dev: new Float64Array(FACE_BANDS), // this frame's, before easing
    sm: new Float64Array(FACE_BANDS), // smoothed, to draw
    lit: new Float64Array(FACE_BANDS), // the face's own outline, smoothed
    litFace: null, // what `lit` was taken of
    litStats: null,
    // The frame's two outlines, to paint (`traceStrokes`): the vessel's own,
    // lit, then what sounds; each its points (x and y), color, width and glow.
    strokes: [0, 1].map(() => ({ pts: new Float64Array(FACE_BANDS * 4), style: "", width: 0, shadow: "", blur: 0 })),
    has: false, // `live` holds the last frame's
    loud: 0, // how loud, eased (the mock's `s.loud`)
    loudAt: -Infinity, // when it last heard a sound
    cleared: true, // nothing is drawn on its layer
  };
}

/** Take what `src` heard into `dst` (a face carried between the levels keeps
 *  what it was showing). */
export function traceCopy(dst, src) {
  dst.live.set(src.live);
  dst.has = src.has;
  dst.loud = src.loud;
  dst.loudAt = src.loudAt;
}

/** One frame heard: `reading` is a frame measured as a face is (`{db,
 *  rmsDb}`, faces.js `createLiveMeter`'s), or null for silence. Eases the
 *  loudness, and, when it is loud enough to draw, takes the frame against the
 *  bank's `stats` into `live`. True when there is something to draw. */
export function traceHear(tr, reading, stats, now) {
  const target = reading ? loudness(reading.rmsDb) : 0;
  tr.loud += (target - tr.loud) * (target > tr.loud ? LIVE_RISE : LIVE_FALL);
  if (target < LIVE_FLOOR || !stats) {
    tr.has = false;
    return false;
  }
  tr.loudAt = now;
  whiten(reading.db, stats, tr.dev);
  for (let b = 0; b < FACE_BANDS; b++) tr.live[b] = tr.has ? tr.live[b] * 0.5 + tr.dev[b] * 0.5 : tr.dev[b];
  tr.has = true;
  return true;
}

/** The trail's fade, a frame of it, over `x, y, w, h` of `ctx` (in its own
 *  units: where the trace can reach): what is drawn fades like phosphor, and
 *  a moment after the last sound (or at once under reduced motion, `still`)
 *  the whole canvas is cleared outright, once. `color` is only for its
 *  alpha. */
export function traceFade(ctx, tr, x, y, w, h, now, still, color) {
  const step = traceFadeStep(tr, now, still);
  paintFade(ctx, step, x, y, w, h, step === FADE_STEP ? tint(color, LIVE_FADE) : "");
}

/** What `traceFade` does this frame, decided (live-paint.js paints it):
 *  `FADE_CLEAR` once a moment after the last sound (or at once, `still`),
 *  `FADE_NONE` after that, and `FADE_STEP` while the trail fades. */
export function traceFadeStep(tr, now, still) {
  if (still || now - tr.loudAt > LIVE_CLEAR_MS) {
    const step = tr.cleared ? FADE_NONE : FADE_CLEAR;
    tr.cleared = true;
    return step;
  }
  tr.cleared = false;
  return FADE_STEP;
}

/** A vessel's outline points into `out` (`[x0, y0, x1, y1, …]`): exactly
 *  faces.js `vesselPoints`, up the right side and down the left, with nothing
 *  made new. */
const sig = (x) => 1 / (1 + Math.exp(-x));
export function pointsInto(out, dev, box, scale = 1) {
  const n = dev.length;
  const cx = box.x + box.w / 2;
  const R = box.w / 2;
  for (let i = 0; i < n; i++) {
    const w = R * sig(dev[i] * 1.4) * scale;
    const y = box.y + box.h - (i / (n - 1)) * box.h;
    out[2 * i] = cx + w;
    out[2 * i + 1] = y;
    const j = 2 * n - 1 - i;
    out[2 * j] = cx - w;
    out[2 * j + 1] = y;
  }
  return out;
}

/** The face's own outline, against the bank and smoothed as stage mode lights
 *  it, taken again only when the face or the bank changed. */
function litOf(tr, face, stats) {
  if (tr.litFace !== face || tr.litStats !== stats) {
    whiten(face.ltas, stats, tr.dev);
    smooth(tr.dev, 1, tr.lit);
    tr.litFace = face;
    tr.litStats = stats;
  }
  return tr.lit;
}

/** The trace drawn over `face` at `box` on `ctx`: the vessel's own outline
 *  lit by how loud it is, then, where the face is large enough (`trace`),
 *  what sounds now in silk. In `color` (the face's: the sound's green, B's
 *  amber), its lines and glow at `scale` (1: stage mode's), at `dim`. */
export function traceDraw(ctx, tr, opts) {
  tr.cleared = false;
  paintStrokes(ctx, tr.strokes, traceStrokes(tr, opts));
}

/** What `traceDraw` paints, decided into `tr.strokes` (live-paint.js
 *  `paintStrokes` paints them): how many, 1 or 2. */
export function traceStrokes(tr, { face, stats, box, color, silk, scale = 1, dim = 1, trace = true }) {
  const loud = tr.loud;
  const lit = tr.strokes[0];
  pointsInto(lit.pts, litOf(tr, face, stats), box);
  lit.style = tint(color, (0.12 + 0.55 * loud) * dim);
  lit.width = Math.max(1, 2 * scale);
  lit.shadow = tint(color, 0.9 * dim);
  lit.blur = (18 + loud * 56) * scale;
  if (!trace) return 1;
  const now = tr.strokes[1];
  pointsInto(now.pts, smooth(tr.live, 1, tr.sm), box);
  now.style = tint(silk, 0.95 * dim);
  now.width = Math.max(1, (1.6 + loud * 1.6) * scale);
  now.shadow = tint(color, 0.95 * dim);
  now.blur = (10 + loud * 30) * scale;
  return 2;
}

/** How far past its box a face's trace can reach, at `scale`: its widest
 *  glow and line. */
export const traceReach = (scale) => (18 + 56) * scale * 2 + 4;

/** The loop for every face that hears what is played (see the top).
 *
 *  - `signals`: up to three getters, each an AnalyserNode (fftSize
 *    `FACE_FRAME`) or null; signal `i` is bit `1 << i` of a face's `hears`.
 *  - `gainDb()`: what lies between the signals and the speakers (the master
 *    fader), so a face is as loud as it is heard.
 *  - `held()`: something is being played (a key down, a phrase, a monitored
 *    input): the loop keeps listening while it is, silent or not.
 *  - `still()`: reduced motion; `off()`: no inline face can be seen (stage
 *    mode covers the page).
 *  - `silk()`: the live outline's color.
 *  - `flightHears(frame)`: what the face in flight hears (it is the sound in
 *    hand's).
 *  - `paintWorker()`: a new worker running live-paint.js, which paints the
 *    layers on canvases handed to it; with none (or a canvas that cannot be
 *    handed over, or a worker that fails) they are painted here, the same
 *    calls on the same canvases.
 *  - `raf`, `now`, `doc`, `dpr`: the page's, handed in for the tests.
 *
 *  `add({place})` adds a face. `place(p, frame)` says each frame where it is
 *  and what it hears, filling `p`, or returns false when it is not on screen:
 *  `p.host` (the element its layer is laid over, positioned), `p.hw`, `p.hh`
 *  (that element's size, CSS px), `p.box` (the vessel's box in the host's
 *  px: `{x, y, w, h}`, filled in place), `p.face`, `p.stats`, `p.color`,
 *  `p.hears` (signal bits) and `p.inHand` (it is the sound in hand's face). */
export function createLiveFaces({
  signals,
  gainDb = () => 0,
  held = () => false,
  still = () => false,
  off = () => false,
  silk,
  flightHears = () => 0,
  paintWorker = null,
  raf = (f) => requestAnimationFrame(f),
  now = () => performance.now(),
  doc = typeof document !== "undefined" ? document : null,
  dpr = () => Math.min(2, Math.max(1, (typeof window !== "undefined" && window.devicePixelRatio) || 1)),
} = {}) {
  const S = signals.length;
  const meter = createLiveMeter();
  const bufs = signals.map(() => new Float32Array(FACE_FRAME));
  const rates = new Float64Array(S);
  const levels = new Float64Array(S); // each signal's frame, dBFS as heard
  const sum = new Float32Array(FACE_FRAME);
  // One reading a frame for each set of signals heard together (a face that
  // hears the voices and the phrase hears their sum), made once.
  const readings = Array.from({ length: 1 << S }, () => ({ db: new Float64Array(FACE_BANDS), rmsDb: -Infinity, frame: -1 }));
  const faces = [];
  const flight = { tr: createTrace(), at: -Infinity, face: null, stats: null };
  let lastHand = null; // the trace of the sound in hand's face drawn last
  let frameNo = 0;
  let pending = false;
  const counts = { frames: 0, reads: 0, measures: 0, posted: 0, painted: 0 };
  // The worker that paints the layers (live-paint.js), once started: the
  // frame sent and whether it is painted yet, and each face's frame for the
  // next. It paints each layer on a canvas of its own and answers with a
  // picture of it, which the page's layer shows as it is
  // (`transferFromImageBitmap`): a canvas the page hands to a worker
  // (`transferControlToOffscreen`) froze the audio for seconds at a time in
  // Firefox without a window (the specs', and CI's), and this does not.
  let painter = null;
  let painterTried = false;

  function startPainter() {
    if (painterTried || !paintWorker) return;
    painterTried = true;
    try {
      const w = paintWorker();
      painter = { w, frame: 0, waiting: false, ops: [] };
      w.onmessage = (e) => {
        const m = e.data;
        if (!painter || !m || m.frame !== painter.frame) return;
        if (m.failed) return paintHere();
        for (const { id, bitmap } of m.layers) show(faces[id], bitmap);
        painter.waiting = false;
        counts.painted++;
      };
      w.onerror = paintHere;
      w.onmessageerror = paintHere;
    } catch (_) {
      painter = null;
    }
  }

  // A layer as the worker painted it, shown on the face's canvas.
  function show(f, bitmap) {
    if (!f || !f.shown) {
      if (bitmap) bitmap.close();
      return;
    }
    const w = bitmap ? bitmap.width : 0;
    const h = bitmap ? bitmap.height : 0;
    if (f.cv.width !== w || f.cv.height !== h) {
      f.cv.width = w;
      f.cv.height = h;
    }
    if (bitmap) f.shown.transferFromImageBitmap(bitmap);
  }

  // The worker failed (or a layer could not show its pictures): every layer
  // it painted goes, and is made again and painted here at the next frame.
  function paintHere() {
    const was = painter;
    if (!was) return;
    painter = null;
    try {
      was.w.terminate();
    } catch (_) {
      /* gone already */
    }
    for (const f of faces) {
      if (!f.shown) continue;
      f.cv.remove();
      f.cv = null;
      f.shown = null;
      f.W = f.H = -1;
      f.tr.cleared = true;
    }
  }

  function add({ place }) {
    const tr = createTrace();
    const f = {
      place,
      p: { host: null, hw: 0, hh: 0, box: { x: 0, y: 0, w: 0, h: 0 }, face: null, stats: null, color: "", hears: 0, inHand: false, key: "" },
      tr,
      cv: null,
      ctx: null, // its 2D context, painted here
      shown: null, // or what shows the worker's pictures of it
      W: -1, // the layer's size in px, as last set
      H: -1,
      // This frame's painting of the layer (live-paint.js `paintLayer`).
      op: { id: faces.length, size: null, k: 0, fade: FADE_NONE, rect: [0, 0, 0, 0], fadeStyle: "", n: 0, strokes: null },
      on: false,
    };
    faces.push(f);
    return f;
  }

  // A face's layer, made the first time it is drawn: one that shows the
  // worker's pictures of it when there is a worker, else one painted here.
  function layer(f) {
    if (f.cv) return;
    startPainter();
    const cv = doc.createElement("canvas");
    cv.className = "face-live";
    cv.setAttribute("aria-hidden", "true");
    f.W = f.H = -1;
    f.cv = cv;
    if (painter) {
      const shown = cv.getContext("bitmaprenderer");
      if (shown) {
        f.shown = shown;
        return;
      }
      paintHere(); // a browser with no such canvas: painted here
    }
    f.ctx = cv.getContext("2d");
  }

  // The face's frame (`f.op`) painted: here, or queued for the worker. A
  // frame that changes nothing is not painted at all.
  function paint(f) {
    const op = f.op;
    if (!op.size && op.fade === FADE_NONE && !op.n) return;
    if (painter) painter.ops.push(op);
    else paintLayer(f.cv, f.ctx, op);
  }

  // The frame's painting sent to the worker, if there is any: it answers
  // with the pictures once it is painted, and until then no other frame is
  // sent.
  function flush() {
    const w = painter;
    if (!w || !w.ops.length) return;
    w.frame++;
    w.waiting = true;
    counts.posted++;
    w.w.postMessage({ frame: w.frame, faces: w.ops });
    w.ops.length = 0;
  }

  function wake() {
    if (pending || still()) return;
    pending = true;
    raf(liveFacesFrame);
  }

  // A face's layer, gone blank (off screen, reduced motion, stage mode).
  function wipe(f) {
    if (f.cv && !f.tr.cleared) {
      const op = f.op;
      op.size = null;
      op.k = 0;
      op.fade = FADE_CLEAR;
      op.n = 0;
      op.strokes = null;
      paint(f);
    }
    f.tr.cleared = true;
    f.tr.has = false;
    f.tr.loud = 0;
    f.tr.loudAt = -Infinity;
  }

  // This frame's reading of the signals in `mask`, measured once whatever
  // number of faces hear them; null in silence.
  function reading(mask) {
    if (!mask) return null;
    const r = readings[mask];
    if (r.frame === frameNo) return r.rmsDb === -Infinity ? null : r;
    r.frame = frameNo;
    let one = -1;
    let n = 0;
    for (let i = 0; i < S; i++) if (mask & (1 << i)) { one = i; n++; }
    let src = bufs[one];
    if (n > 1) {
      sum.fill(0);
      for (let i = 0; i < S; i++) {
        if (!(mask & (1 << i))) continue;
        const b = bufs[i];
        for (let k = 0; k < FACE_FRAME; k++) sum[k] += b[k];
      }
      src = sum;
    }
    const m = meter.measure(src, rates[one]);
    counts.measures++;
    r.db.set(m.db);
    r.rmsDb = m.rmsDb + gainDb();
    return r;
  }

  function liveFacesFrame() {
    pending = false;
    // The worker is still painting the last frame: this one waits for it
    // (a frame is read, eased and faded only when it is painted, so the
    // trail is the same at whatever rate the frames are painted).
    if (painter && painter.waiting) {
      pending = true;
      raf(liveFacesFrame);
      return;
    }
    const t = now();
    frameNo++;
    counts.frames++;
    if (still() || off()) {
      for (const f of faces) wipe(f);
      flight.tr.has = false;
      flush();
      return;
    }
    // Where each face is, and what it hears (the page's reads, first).
    let need = 0;
    for (const f of faces) {
      const was = f.on;
      f.on = !!f.place(f.p, frameNo) && !!f.p.host;
      if (f.on) {
        need |= f.p.hears;
        // A face come into sight while its sound plays takes up what the
        // face it was carried from was showing.
        if (!was && f.p.inHand && t - flight.at < 250 && flight.tr.has) traceCopy(f.tr, flight.tr);
      } else wipe(f);
    }
    const flying = t - flight.at < 250;
    if (flying) need |= flightHears(frameNo);
    // Each signal read once: which are sounding.
    let sounding = 0;
    for (let i = 0; i < S; i++) {
      if (!(need & (1 << i))) continue;
      const an = signals[i]();
      if (!an) continue;
      an.getFloatTimeDomainData(bufs[i]);
      counts.reads++;
      rates[i] = an.context.sampleRate;
      const b = bufs[i];
      let ss = 0;
      for (let k = 0; k < FACE_FRAME; k++) ss += b[k] * b[k];
      levels[i] = ss > 0 ? 10 * Math.log10(ss / FACE_FRAME) + gainDb() : -Infinity;
      if (levels[i] > LIVE_SILENT_DB) sounding |= 1 << i;
    }
    const ink = silk();
    const k = dpr();
    for (const f of faces) {
      if (!f.on) continue;
      draw(f, reading(f.p.hears & sounding), t, k, ink);
    }
    if (flying && flight.stats) traceHear(flight.tr, reading(flightHears(frameNo) & sounding), flight.stats, t);
    flush();
    // Keep going while something is played, a trail still fades, or a face
    // is in flight; else the loop idles until `wake`.
    let busy = flying || held();
    for (const f of faces) if (!f.tr.cleared) busy = true;
    if (busy && !pending) {
      pending = true;
      raf(liveFacesFrame);
    }
  }

  // A face's frame: its layer's size, the trail's fade, and what it heard
  // (`traceFade`'s and `traceDraw`'s, decided here and painted by `paint`).
  function draw(f, r, t, k, ink) {
    const p = f.p;
    layer(f);
    // The slot's own drawing may have been put back since (a face slot is
    // filled anew when its face or the bank changes): the layer goes back
    // over it, its trail as it was.
    if (f.cv.parentNode !== p.host) p.host.append(f.cv);
    const op = f.op;
    const W = Math.round(p.hw * k);
    const H = Math.round(p.hh * k);
    op.size = null;
    if (f.W !== W || f.H !== H) {
      f.W = W;
      f.H = H;
      op.size = [W, H];
      f.tr.cleared = true;
    }
    op.k = k;
    const b = p.box;
    const scale = traceScale(b.h);
    const m = traceReach(scale);
    op.fade = traceFadeStep(f.tr, t, false);
    op.rect[0] = b.x - m;
    op.rect[1] = b.y - m;
    op.rect[2] = b.w + 2 * m;
    op.rect[3] = b.h + 2 * m;
    op.fadeStyle = op.fade === FADE_STEP ? tint(p.color, LIVE_FADE) : "";
    op.n = 0;
    if (p.face && traceHear(f.tr, r, p.stats, t)) {
      if (p.inHand) lastHand = f.tr;
      f.tr.cleared = false;
      op.n = traceStrokes(f.tr, { face: p.face, stats: p.stats, box: b, color: p.color, silk: ink, scale, trace: b.h >= LIVE_TRACE_MIN_H });
    }
    op.strokes = op.n ? f.tr.strokes : null;
    paint(f);
  }

  return {
    add,
    wake,
    /** Measure a silent frame once, so the first sound's frame does not pay
     *  for the meter's first run (its band weights, and code not yet
     *  compiled), and start the face painter, so it does not pay for that
     *  either: called while the page is idle. Under reduced motion the loop
     *  never runs, so no painter is started (a face drawn once motion is
     *  back starts it). */
    warm(sampleRate) {
      meter.measure(sum.fill(0), sampleRate);
      if (!still()) startPainter();
    },
    /** The face in flight between the levels (shell.js draws it each frame
     *  on its own canvas, cleared each frame, so it has no trail): what the
     *  sound in hand sounds like now, over `face` at `box`, at `alpha`. */
    flight(ctx, { face, stats: st, box, color, alpha = 1 }) {
      const t = now();
      if (t - flight.at >= 250) {
        // A new flight takes up what the face it leaves was showing.
        if (lastHand) traceCopy(flight.tr, lastHand);
        else flight.tr.has = false;
      }
      flight.at = t;
      flight.face = face;
      flight.stats = st;
      wake();
      if (still() || !face || !st || !flight.tr.has || t - flight.tr.loudAt > 100) return false;
      const scale = traceScale(box.h);
      traceDraw(ctx, flight.tr, { face, stats: st, box, color, silk: silk(), scale, dim: alpha, trace: box.h >= LIVE_TRACE_MIN_H });
      return true;
    },
    /** Is the loop running (a frame asked for)? */
    get running() {
      return pending;
    },
    /** What the loop has done: frames run, signals read, sounds measured,
     *  and frames sent to the worker and painted there. */
    get counts() {
      return counts;
    },
  };
}
