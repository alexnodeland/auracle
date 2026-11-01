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
//   still. What each frame draws is decided here (`traceFadeStep`,
//   `traceStrokes`), and painted by live-paint.js's canvas calls, in one of
//   two places, chosen by what painting on the page measures
//   (`createPaintSwitch`), against the live faces' budget for a frame
//   (`LIVE_PAINT_BUDGET_MS`, 2 ms: ADR-025). What is timed is the calls, and
//   first before any face is painted: **the idle probe** (`warm`), while the
//   page is idle after the voices are up, paints one frame of the largest
//   face (PERFORM's well, at the size it is drawn, its two outlines at their
//   loudest glow) on a canvas of its own that is never shown, by the calls a
//   frame painted on the page makes, and times them (when that was over,
//   once more in an idle callback of its own, the lesser kept, nothing
//   moving in between: `LIVE_PROBE_RUNS`). A browser that draws a canvas
//   as it is called (Firefox) pays the glow's blur in those calls, about 6
//   ms at the Air's Retina scale on an M3 Max, against the 7 ms a frame of
//   the real well takes there; Chromium only records them, 0.1 to 1 ms on
//   the reference profile (its page throttled ×4.5).
//   - **in a worker of their own**, the face painter, where the probe
//     measures over: the painter is started then, before the first sound,
//     and every face's layer is born a `bitmaprenderer` canvas that shows
//     the painter's pictures, so no frame's glow is blurred on the page (a
//     sound played between the probe's two timings is painted on the page
//     until they decide, and its layers handed over as below). The
//     painter paints each frame on an OffscreenCanvas of its own and answers
//     with a picture of each layer, which the layer shows as it is: a frame
//     is shown one round trip after it is read (the next frame where the
//     painter takes a few ms, two or three frames where it takes 30). One
//     frame is in the worker at a time: the loop reads, eases and fades the
//     next only once the last is answered, so the trail is the same at
//     whatever rate the painter paints.
//   - **on the page**, in the frame that read it, where the probe measures
//     inside, for as long as the page's paint of a frame (every face's
//     canvas calls) measures inside it as the faces are played: the median
//     of the last `LIVE_PAINT_WINDOW` frames that drew an outline. Chromium
//     draws the calls it recorded after the frame's script: on a GPU that
//     costs the main thread next to nothing (0.2 ms after the script, on an
//     M3 Max's Metal), and a worker would only show each frame a frame
//     later. Drawn in software instead (SwiftShader, Chromium's software GL:
//     a VM, a blocklisted GPU, Playwright's headless Chromium here and on
//     CI), that drawing blocks the main thread after the script, about 4.5
//     ms a frame at the Air's Retina scale, and neither the probe nor the
//     window, timing the calls, sees it (#569).
//   - **moved later**, where the window's median goes over (a larger face, a
//     machine that slows): the painter is started then, and the page paints
//     on until it answers that it is up; then each layer, as that frame left
//     it, is handed to it as a picture (`createImageBitmap`), which it draws
//     on its own canvas, so the trail goes on where it was, no frame of it
//     lost or painted twice, and from then on it paints, as above. The move
//     is one way, for the session: a face never flips between the two, and
//     a paint that measured over once is not trusted under again. No painter
//     is started otherwise; under reduced motion there is no probe and the
//     loop never runs, so none ever is.
//   No canvas of the page's is handed to the painter
//   (`transferControlToOffscreen`: in Firefox without a window that froze
//   the audio for seconds at a time). With no painter, a canvas with no
//   `bitmaprenderer` context, a layer whose picture cannot be taken, a
//   painter that errs, or a frame it answers `failed`, the faces are painted
//   here, by the same calls, for the rest of the session.
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

/** The live faces' budget for a frame, ms (ADR-025), held in two places:
 *  live_faces.spec.js holds the loop's whole call a frame to it (reading the
 *  signals, measuring, deciding and painting or sending), as a budget, and
 *  the switch (`createPaintSwitch`) holds the page's canvas calls for a
 *  frame alone to it, the part a worker can take: the page paints the faces
 *  itself while those measure inside it. */
export const LIVE_PAINT_BUDGET_MS = 2;
/** How many frames painted on the page the page's paint is judged over,
 *  once the idle probe has found it inside budget: a sixth of a second at 60
 *  frames a second. Enough that a few frames slowed by something else (a
 *  collection, a resize) move nothing, few enough that a paint that gets
 *  slower as the faces are played (a larger face, a machine that slows) is
 *  paid for no more than about these. */
export const LIVE_PAINT_WINDOW = 10;

/** How many times the idle probe may time its frame: once, and, when that
 *  measured over budget, once more in an idle callback of its own, the
 *  lesser kept, so a frame slowed by something else (a collection, a page
 *  still busy booting, a throttled page's pause) moves nothing. A browser
 *  that blurs on the thread that asks pays its blur twice, once a session,
 *  each time in a different idle moment. */
export const LIVE_PROBE_RUNS = 2;

/** Where the live faces are painted, decided from what painting them on the
 *  page costs (see the top). `probe(paint)`, the idle probe, runs `paint`
 *  before any face is painted and times it on `clock`, once a call: inside
 *  `budget` ms, the probe is done and nothing moves; over it, the switch
 *  owes a retake (`retake`), the next call, made in another idle moment,
 *  and the lesser of the two decides: over `budget`, it answers true, and
 *  from then on the switch always does. Nothing moves while a retake is
 *  owed. Inside it,
 *  `time(paint)` runs `paint`, one frame's canvas calls on the page, which
 *  returns true when it drew an outline (a frame of the fade alone costs
 *  little, and says nothing of the glow), and times it on `clock`; once the
 *  median of the last `frames` frames that drew is over `budget` ms, it
 *  answers true (once no retake is owed), and from then on always does.
 *  One way, for the session: the faces never flip between the page and the
 *  painter, and a page that measured over budget once (a CPU's blur) is
 *  not trusted under it again. The median, so one slow frame (or a few)
 *  moves nothing, and a window that slides, so a paint that degrades later
 *  (a larger face, a machine that slows) still moves. */
export function createPaintSwitch({ budget = LIVE_PAINT_BUDGET_MS, frames = LIVE_PAINT_WINDOW, clock = () => performance.now() } = {}) {
  const times = new Float64Array(frames);
  const sorted = new Float64Array(frames);
  let n = 0;
  let moved = false;
  let median = NaN;
  let probed = NaN;
  let probes = 0;
  // A first reading over budget waits for its retake.
  const owed = () => !moved && probes > 0 && probes < LIVE_PROBE_RUNS;
  return {
    probe(paint) {
      if (moved || probes >= LIVE_PROBE_RUNS) return moved;
      const t0 = clock();
      paint();
      const ms = clock() - t0;
      probed = probes ? Math.min(probed, ms) : ms;
      probes++;
      if (probed <= budget) probes = LIVE_PROBE_RUNS;
      else if (probes >= LIVE_PROBE_RUNS) moved = true;
      return moved;
    },
    /** The retake given up (reduced motion came on before it): nothing
     *  moves, and the window decides. */
    forgo() {
      if (owed()) probes = LIVE_PROBE_RUNS;
    },
    time(paint) {
      const t0 = clock();
      const drew = paint();
      const ms = clock() - t0;
      if (drew && !moved) {
        times[n % frames] = ms;
        n++;
        if (n >= frames) {
          sorted.set(times);
          sorted.sort();
          const h = frames >> 1;
          median = frames % 2 ? sorted[h] : (sorted[h - 1] + sorted[h]) / 2;
          moved = median > budget && !owed();
        }
      }
      return moved;
    },
    /** A first reading of the probe over budget waits for its retake. */
    get retake() {
      return owed();
    },
    /** The page's paint measured over budget: the faces go to the painter. */
    get moved() {
      return moved;
    },
    /** What the idle probe measured, ms (NaN before it, or without one). */
    get probed() {
      return probed;
    },
    /** The median of the last window, ms (NaN before the first is full). */
    get median() {
      return median;
    },
    /** Frames that drew, timed until the move. */
    get frames() {
      return n;
    },
  };
}

/** The idle probe's face (`warm`): how loud (0 to 1), and its outline, in
 *  spreads from the bank's mean, band by band: a vessel nearly as wide as
 *  its box at its widest (`σ(1.4 · 2)` of the half-width), as a face
 *  sounding gets, drawn against a bank whose mean is 0 and spread 1. */
const PROBE_LOUD = 1;
const PROBE_DEV = Float64Array.from({ length: FACE_BANDS }, (_, b) => 2 * Math.sin((Math.PI * b) / (FACE_BANDS - 1)));
const PROBE_STATS = { mean: new Float64Array(FACE_BANDS), spread: 1 };

/** The pictures a painter's answer holds, let go: an answer no layer will
 *  show (the painter given up, a frame already past, its first). */
function letGo(m) {
  if (m && m.layers) for (const { bitmap } of m.layers) if (bitmap) bitmap.close();
}

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
 *  - `paintWorker()`: a new worker running live-paint.js (the face
 *    painter), started once `paintSwitch` says the page's paint is over
 *    budget, by the idle probe (`warm`) or as the faces are played, never
 *    before (so never under reduced motion). Started by the probe, the
 *    faces' layers are born showing its pictures; started later, the page
 *    paints on until it answers that it is up, then hands it each layer as
 *    a picture (`picture(canvas)`, a promise of one: `createImageBitmap`).
 *    Either way, the page shows the pictures it answers each frame with
 *    (`bitmaprenderer`). With
 *    none, a canvas with no `bitmaprenderer` context, a picture refused, a
 *    worker error or `messageerror`, or a frame answered `failed`, the faces
 *    are painted here, by the same calls, from then on.
 *  - `paintSwitch`: where the faces are painted (`createPaintSwitch`).
 *  - `idle(f)`: runs `f` in a later idle moment (the idle probe's retake).
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
  picture = (cv) => createImageBitmap(cv),
  paintSwitch = createPaintSwitch(),
  idle = (f) => (typeof requestIdleCallback === "function" ? requestIdleCallback(f, { timeout: 1000 }) : setTimeout(f, 50)),
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
  // Frames run, signals read, sounds measured, frames painted on the page,
  // and frames sent to the painter and answered.
  const counts = { frames: 0, reads: 0, measures: 0, here: 0, posted: 0, painted: 0 };
  // Where the faces are painted (see the top): on the page, the faces of
  // this frame in `here`, until the switch moves them to the face painter
  // (live-paint.js's worker), for good unless it fails. The painter, once
  // started: whether it has said it is up, the last frame sent and whether
  // it is answered yet, and each face's frame for the next.
  let inWorker = false;
  const here = [];
  let painter = null;
  let painterTried = false;

  // The page's paint measured over budget: the painter started. Until it
  // answers its first message, an empty frame, the page goes on painting.
  function startPainter() {
    if (painterTried || !paintWorker) return;
    painterTried = true;
    try {
      const w = paintWorker();
      const p = { w, frame: 0, ready: false, waiting: false, ops: [] };
      painter = p;
      w.onmessage = (e) => {
        const m = e.data;
        if (painter !== p || !m) return letGo(m);
        if (m.failed) return paintHere();
        if (m.frame === 0) {
          p.ready = true;
          return letGo(m);
        }
        if (m.frame !== p.frame) return letGo(m);
        for (const { id, bitmap } of m.layers) {
          if (painter === p) show(faces[id], bitmap);
          else if (bitmap) bitmap.close();
        }
        if (painter !== p) return;
        p.waiting = false;
        counts.painted++;
      };
      w.onerror = paintHere;
      w.onmessageerror = paintHere;
      w.postMessage({ frame: 0, faces: [] });
    } catch (_) {
      if (painter) paintHere();
      painter = null;
    }
  }

  // The idle probe (see the top): one frame of the largest face, its two
  // outlines at their loudest glow, painted on a canvas of its own that is
  // never shown, by the calls a frame painted here makes (`paintLayer`), and
  // timed by the switch. First the same frame with no glow, untimed: the
  // canvas sized and the calls run once, as a frame of the window never is
  // a layer's first. Over budget, it is timed again in an idle callback of
  // its own (`idle`), so no one idle moment pays the glow twice, and nothing
  // moves meanwhile (a sound played in between is painted here); the lesser
  // decides. Over budget, the faces go to the painter then.
  function probeHere({ w, h, box }) {
    const cv = doc.createElement("canvas");
    const g = cv.getContext("2d");
    if (!g) return;
    const k = dpr();
    const scale = traceScale(box.h);
    const m = traceReach(scale);
    const ink = silk();
    const tr = createTrace();
    tr.live.set(PROBE_DEV);
    tr.loud = PROBE_LOUD;
    const opts = { face: { ltas: PROBE_DEV }, stats: PROBE_STATS, box, color: ink, silk: ink, scale, trace: box.h >= LIVE_TRACE_MIN_H };
    const op = {
      id: -1,
      size: [Math.round(w * k), Math.round(h * k)],
      k,
      fade: FADE_STEP,
      rect: [box.x - m, box.y - m, box.w + 2 * m, box.h + 2 * m],
      fadeStyle: tint(ink, LIVE_FADE),
      n: traceStrokes(tr, opts),
      strokes: tr.strokes,
    };
    for (let i = 0; i < op.n; i++) tr.strokes[i].blur = 0;
    paintLayer(cv, g, op);
    op.size = null;
    traceStrokes(tr, opts);
    const take = () => paintSwitch.probe(() => paintLayer(cv, g, op));
    const decided = (over) => {
      cv.width = cv.height = 0;
      if (over) toPainter();
    };
    if (take() || !paintSwitch.retake) return decided(paintSwitch.moved);
    idle(() => {
      // Reduced motion since: no retake, and nothing moves.
      if (still()) {
        paintSwitch.forgo();
        return decided(false);
      }
      decided(take());
    });
  }

  // The probe measured over budget: the painter started, before the first
  // frame. A layer with no trail on it (none, until a face has sounded) is
  // made again to show its pictures, and every frame goes to it from the
  // first, so no frame's glow is blurred here; one with a trail still on it
  // is handed over as it stands, at the next frame painted here, once the
  // painter is up. With no painter, the faces are painted here.
  function toPainter() {
    startPainter();
    if (!painter) return;
    if (faces.some((f) => f.cv && !f.tr.cleared)) return;
    for (const f of faces) if (f.cv) drop(f);
    inWorker = true;
  }

  // The faces handed to the painter, at the end of a frame painted here:
  // each layer as this frame left it goes to the painter as a picture, which
  // it draws on a canvas of its own (its trail where it was), and goes on
  // showing here until the painter answers with its own picture of it. No
  // frame is read until then, so none is lost or painted twice.
  function handOver() {
    const p = painter;
    inWorker = true;
    p.frame++;
    p.waiting = true;
    counts.posted++;
    const frame = p.frame;
    const handed = [];
    for (const f of faces) {
      if (!f.cv) continue;
      if (f.cv.width && f.cv.height) handed.push(f);
      else drop(f); // a layer of no size: made again, to show pictures
    }
    // Every picture is waited for: one refused, or the painter gone, lets
    // go of those taken, and a hand-over that cannot be sent paints here, so
    // nothing is left waiting on an answer that will not come.
    const taking = handed.map((f) => {
      try {
        return picture(f.cv);
      } catch (err) {
        return Promise.reject(err);
      }
    });
    Promise.allSettled(taking).then((got) => {
      const bitmaps = got.map((r) => (r.status === "fulfilled" ? r.value : null));
      if (painter !== p || got.some((r) => r.status === "rejected")) {
        for (const b of bitmaps) if (b) b.close();
        if (painter === p) paintHere();
        return;
      }
      try {
        p.w.postMessage({ frame, faces: [], seed: handed.map((f, i) => ({ id: f.op.id, bitmap: bitmaps[i] })) }, bitmaps);
      } catch (_) {
        for (const b of bitmaps) b.close();
        if (painter === p) paintHere();
      }
    });
  }

  // A layer the next frame makes again.
  function drop(f) {
    f.cv.remove();
    f.cv = null;
    f.ctx = null;
    f.shown = null;
    f.W = f.H = -1;
    f.tr.cleared = true;
  }

  // A layer as the worker painted it, shown on the face's canvas; a layer
  // painted here until the hand-over is first put back by one that shows
  // the painter's pictures (a canvas has one kind of context).
  function show(f, bitmap) {
    if (f && !f.shown && f.ctx && inWorker && f.cv) {
      const cv = newLayer();
      const shown = cv.getContext("bitmaprenderer");
      if (!shown) {
        if (bitmap) bitmap.close();
        return paintHere(); // a browser with no such canvas: painted here
      }
      if (f.cv.parentNode) f.cv.replaceWith(cv);
      f.cv = cv;
      f.ctx = null;
      f.shown = shown;
    }
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

  // The worker failed (or a layer could not show its pictures): it is
  // ended, and the faces are painted here from then on. A layer it painted
  // goes, and is made again and painted here at the next frame; one still
  // painted here (handed over, not yet answered) stays, as it was.
  function paintHere() {
    const was = painter;
    if (!was) return;
    painter = null;
    inWorker = false;
    try {
      was.w.terminate();
    } catch (_) {
      /* gone already */
    }
    for (const f of faces) if (f.shown) drop(f);
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

  function newLayer() {
    const cv = doc.createElement("canvas");
    cv.className = "face-live";
    cv.setAttribute("aria-hidden", "true");
    return cv;
  }

  // A face's layer, made the first time it is drawn: painted here, or, once
  // the faces are the painter's, one that shows its pictures.
  function layer(f) {
    if (f.cv) return;
    f.W = f.H = -1;
    f.cv = newLayer();
    if (inWorker) {
      const shown = f.cv.getContext("bitmaprenderer");
      if (shown) {
        f.shown = shown;
        return;
      }
      paintHere(); // a browser with no such canvas: painted here
    }
    f.ctx = f.cv.getContext("2d");
  }

  // The face's frame (`f.op`) queued, to paint here or in the worker at the
  // frame's end. A frame that changes nothing is not painted at all.
  function paint(f) {
    const op = f.op;
    if (!op.size && op.fade === FADE_NONE && !op.n) return;
    if (inWorker) painter.ops.push(op);
    else here.push(f);
  }

  // The frame's faces painted here, every face's calls together; true when
  // one drew an outline.
  function paintFrameHere() {
    let drew = false;
    for (const f of here) {
      paintLayer(f.cv, f.ctx, f.op);
      if (f.op.n) drew = true;
    }
    here.length = 0;
    return drew;
  }

  // The frame painted: here, timed by the switch (which starts the painter
  // once it is over budget, and hands the faces over once the painter is
  // up), or sent to the worker, if there is anything to paint. The worker
  // answers with the pictures once it is painted, and until then no other
  // frame is sent.
  function flush() {
    if (!inWorker) {
      if (here.length) {
        counts.here++;
        if (paintSwitch.time(paintFrameHere)) startPainter();
      }
      if (painter && painter.ready) handOver();
      return;
    }
    const w = painter;
    if (!w.ops.length) return;
    w.frame++;
    w.waiting = true;
    counts.posted++;
    try {
      w.w.postMessage({ frame: w.frame, faces: w.ops });
    } catch (_) {
      paintHere(); // a frame that cannot be sent: painted here from then on
    }
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
    // The worker is still painting the last frame (or taking the faces
    // over): this one waits for it (a frame is read, eased and faded only
    // when the last is painted, so the trail is the same at whatever rate
    // the frames are painted).
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
  // (`traceFade`'s and `traceDraw`'s, decided here and painted at the
  // frame's end, `flush`).
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
    /** Called while the page is idle, before the first sound. Measure a
     *  silent frame once, so the first sound's frame does not pay for the
     *  meter's first run (its band weights, and code not yet compiled); and,
     *  given `probe` (the largest face: its layer `w` by `h` and its vessel's
     *  `box`, CSS px, as `place` fills `p.hw`, `p.hh` and `p.box`), time one
     *  frame of it painted here (the idle probe, see the top: over budget,
     *  timed again in a later idle moment, `idle`), which, over budget,
     *  starts the painter then and has the faces born painted by it.
     *  No probe under reduced motion (nothing moves, so nothing is painted),
     *  with no painter to move to, or once the faces have moved. */
    warm(sampleRate, probe = null) {
      meter.measure(sum.fill(0), sampleRate);
      if (probe && paintWorker && doc && !still() && !paintSwitch.moved) probeHere(probe);
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
     *  frames painted on the page, and frames sent to the worker (the
     *  hand-over among them) and answered. */
    get counts() {
      return counts;
    },
  };
}
