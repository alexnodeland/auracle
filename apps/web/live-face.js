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
//   still.
//
// ADR-012: what moves is a measurement of what is heard, never a guess. A face
// listens only to the signal that is its own sound (main.js says which: the
// voices' share of the output for the sound in hand, B's share for B, the
// phrase a ▶ plays for the sound it names), so a face responds to what you
// hear of it, and to nothing else. Pure over its canvas contexts and its
// analysers, which are handed in, so it is unit-tested (tests/live-face.test.mjs).
import { FACE_BANDS, FACE_FRAME, createLiveMeter, whiten, smooth } from "./faces.js";
import { tint } from "./vessel.js";

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
    pts: new Float64Array(FACE_BANDS * 4), // a vessel's points, x and y
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
  if (still || now - tr.loudAt > LIVE_CLEAR_MS) {
    if (!tr.cleared) clearAll(ctx);
    tr.cleared = true;
    return;
  }
  tr.cleared = false;
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = tint(color, LIVE_FADE);
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function clearAll(ctx) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
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

/** The path of points made by `pointsInto` (`m` of them), joined as vessel.js
 *  `traceVessel` joins them: quadratic curves through their midpoints. */
export function tracePoints(ctx, p, m) {
  ctx.beginPath();
  ctx.moveTo((p[2 * (m - 1)] + p[0]) / 2, (p[2 * (m - 1) + 1] + p[1]) / 2);
  for (let i = 0; i < m; i++) {
    const k = (i + 1) % m;
    ctx.quadraticCurveTo(p[2 * i], p[2 * i + 1], (p[2 * i] + p[2 * k]) / 2, (p[2 * i + 1] + p[2 * k + 1]) / 2);
  }
  ctx.closePath();
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
export function traceDraw(ctx, tr, { face, stats, box, color, silk, scale = 1, dim = 1, trace = true }) {
  const n = FACE_BANDS;
  const loud = tr.loud;
  tr.cleared = false;
  ctx.save();
  tracePoints(ctx, pointsInto(tr.pts, litOf(tr, face, stats), box), 2 * n);
  ctx.strokeStyle = tint(color, (0.12 + 0.55 * loud) * dim);
  ctx.lineWidth = Math.max(1, 2 * scale);
  ctx.shadowColor = tint(color, 0.9 * dim);
  ctx.shadowBlur = (18 + loud * 56) * scale;
  ctx.stroke();
  if (trace) {
    tracePoints(ctx, pointsInto(tr.pts, smooth(tr.live, 1, tr.sm), box), 2 * n);
    ctx.strokeStyle = tint(silk, 0.95 * dim);
    ctx.lineWidth = Math.max(1, (1.6 + loud * 1.6) * scale);
    ctx.shadowColor = tint(color, 0.95 * dim);
    ctx.shadowBlur = (10 + loud * 30) * scale;
    ctx.stroke();
  }
  ctx.restore();
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
  const counts = { frames: 0, reads: 0, measures: 0 };

  function add({ place }) {
    const f = {
      place,
      p: { host: null, hw: 0, hh: 0, box: { x: 0, y: 0, w: 0, h: 0 }, face: null, stats: null, color: "", hears: 0, inHand: false, key: "" },
      tr: createTrace(),
      cv: null,
      ctx: null,
      on: false,
    };
    faces.push(f);
    return f;
  }

  function wake() {
    if (pending || still()) return;
    pending = true;
    raf(liveFacesFrame);
  }

  // A face's layer, gone blank (off screen, reduced motion, stage mode).
  function wipe(f) {
    if (f.ctx && !f.tr.cleared) clearAll(f.ctx);
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
    const t = now();
    frameNo++;
    counts.frames++;
    if (still() || off()) {
      for (const f of faces) wipe(f);
      flight.tr.has = false;
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
    // Keep going while something is played, a trail still fades, or a face
    // is in flight; else the loop idles until `wake`.
    let busy = flying || held();
    for (const f of faces) if (!f.tr.cleared) busy = true;
    if (busy && !pending) {
      pending = true;
      raf(liveFacesFrame);
    }
  }

  function draw(f, r, t, k, ink) {
    const p = f.p;
    if (!f.cv) {
      f.cv = doc.createElement("canvas");
      f.cv.className = "face-live";
      f.cv.setAttribute("aria-hidden", "true");
      f.ctx = f.cv.getContext("2d");
    }
    // The slot's own drawing may have been put back since (a face slot is
    // filled anew when its face or the bank changes): the layer goes back
    // over it, its trail as it was.
    if (f.cv.parentNode !== p.host) p.host.append(f.cv);
    const W = Math.round(p.hw * k);
    const H = Math.round(p.hh * k);
    if (f.cv.width !== W || f.cv.height !== H) {
      f.cv.width = W;
      f.cv.height = H;
      f.tr.cleared = true;
    }
    const g = f.ctx;
    g.setTransform(k, 0, 0, k, 0, 0);
    const b = p.box;
    const scale = traceScale(b.h);
    const m = traceReach(scale);
    traceFade(g, f.tr, b.x - m, b.y - m, b.w + 2 * m, b.h + 2 * m, t, false, p.color);
    if (!p.face || !traceHear(f.tr, r, p.stats, t)) return;
    if (p.inHand) lastHand = f.tr;
    traceDraw(g, f.tr, { face: p.face, stats: p.stats, box: b, color: p.color, silk: ink, scale, trace: b.h >= LIVE_TRACE_MIN_H });
  }

  return {
    add,
    wake,
    /** Measure a silent frame once, so the first sound's frame does not pay
     *  for the meter's first run (its band weights, and code not yet
     *  compiled): called while the page is idle. */
    warm(sampleRate) {
      meter.measure(sum.fill(0), sampleRate);
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
    /** What the loop has done: frames run, signals read, sounds measured. */
    get counts() {
      return counts;
    },
  };
}
