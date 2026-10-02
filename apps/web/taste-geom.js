// TASTE's and LEARNING's geometry: how big a dot on the map is, how long a
// weight's bar and its whisker are, and whether a weight is drawn settled or
// as a guess (in LEARNING and PATCH's module rail alike); where each sound
// sits on the map and how its halo glows; which way liking rises; and how
// the forecasts score. Most are claims about uncertainty, and the first ones
// were drawn so that the uncertainty could not be seen — nothing on screen
// looked broken, which is why they live here, pure, with unit tests beside
// them (tests/taste-geom.test.mjs). taste.js and main.js draw; this decides
// the lengths, the places and the marks.

// ---------- MAP: size is how unsure it is ----------
// It was `base + min(1, sd) · 3.5` px. In a taught session (56 picks) sd ran
// 0.46–1.70 and every dot came out 5.6–7.5 px, the surest and the least sure
// the same size; after a first fit a third of them sat on the cap. The base
// also moved with the patch's origin, so an edit looked less sure than it
// was. Now the radius spans the map's own spread of sd — its surest tenth
// smallest, its least sure tenth largest, linear between — over a range
// never narrower than MAP_SD_SPAN_MIN and centred on where the pool sits, so
// a pool it is about equally sure of draws about equally sized dots rather
// than stretching noise into a contrast.

/** CSS px. The legend's two rings are these, to the pixel (style.css). */
export const MAP_R_SURE = 2.5;
export const MAP_R_UNSURE = 9;
/** The narrowest sd range the sizes are spread over, in utility units. */
export const MAP_SD_SPAN_MIN = 0.5;

/** sd → 0 (surest on this map) … 1 (least sure), from the pool's own sds.
 *  A patch with no sd yet (no posterior) is ½: nothing to say either way. */
export function mapUnsureScale(sds, spanMin = MAP_SD_SPAN_MIN) {
  const xs = sds.filter((s) => s != null && Number.isFinite(s)).sort((a, b) => a - b);
  if (xs.length < 2) return () => 0.5;
  const at = (f) => xs[Math.round(f * (xs.length - 1))];
  let lo = at(0.1);
  let hi = at(0.9);
  if (hi - lo < spanMin) {
    const mid = (lo + hi) / 2;
    lo = mid - spanMin / 2;
    hi = mid + spanMin / 2;
  }
  return (sd) => (sd == null || !Number.isFinite(sd) ? 0.5 : Math.max(0, Math.min(1, (sd - lo) / (hi - lo))));
}

/** The dot's radius in CSS px for a scale value from `mapUnsureScale`. */
export function mapDotRadius(t) {
  return MAP_R_SURE + t * (MAP_R_UNSURE - MAP_R_SURE);
}

// ---------- DIRECTIONS: a bar and its ±σ whisker, on one scale ----------
// A bar could reach 0.7 of the half-width while its whisker was capped at
// 0.3, so a coefficient whose interval crosses zero — grit at −0.121 ± 0.126,
// truly [−0.247, +0.005] — was drawn with a whisker stopping short of the
// centre line, looking settled. The guide says to read the whiskers, not the
// bars; they have to be drawn to be read.
//
// Now bars and whiskers share one scale, fitted so the largest |mean| + σ
// reaches the half-width. One very unsure coefficient must not shrink every
// bar to a sliver, so the scale never stretches past DIR_STRETCH × the
// largest |mean|: a whisker longer than that is cut at the edge and marked
// as cut (`clipLo`/`clipHi`, drawn as an arrowhead), never shortened. And an
// interval that crosses zero crosses the centre line by at least
// DIR_CROSS_MIN of the half-width, so "a guess" is visible even when the
// crossing is a hair.

/** The smallest |mean| the scale is fitted to: a lens that has learned
 *  nothing yet draws short bars, not ones stretched to fill the panel. */
export const DIR_FLOOR = 0.12;
export const DIR_STRETCH = 2;
export const DIR_CROSS_MIN = 0.012;

/** Pixels per unit of θ, for rows `[{mean, std}]` drawn into a half-width of
 *  `usable` px. */
export function directionsScale(rows, usable) {
  let maxMean = DIR_FLOOR;
  let maxReach = DIR_FLOOR;
  for (const r of rows) {
    const m = Math.abs(r.mean);
    const s = Math.max(0, r.std || 0);
    maxMean = Math.max(maxMean, m);
    maxReach = Math.max(maxReach, m + s);
  }
  return usable / Math.min(maxReach, DIR_STRETCH * maxMean);
}

/** One row's bar and whisker, in px from the centre line (negative left).
 *  `lo`/`hi` are the whisker's drawn ends; `clipLo`/`clipHi` say an end was
 *  cut at the edge; `crossesZero` says the interval includes 0. */
export function directionsBar(r, scale, usable) {
  const s = Math.max(0, r.std || 0);
  const len = r.mean * scale;
  let lo = (r.mean - s) * scale;
  let hi = (r.mean + s) * scale;
  const crossesZero = r.mean - s < 0 && r.mean + s > 0;
  if (crossesZero) {
    const min = DIR_CROSS_MIN * usable;
    if (r.mean < 0) hi = Math.max(hi, min);
    else lo = Math.min(lo, -min);
  }
  const clipLo = lo < -usable;
  const clipHi = hi > usable;
  return { len, lo: Math.max(lo, -usable), hi: Math.min(hi, usable), clipLo, clipHi, crossesZero };
}

// ---------- one mark for a pull: settled, or a guess ----------
// DIRECTIONS drew every coefficient as the same glowing bar, and at 58 picks
// 35 of its 36 intervals crossed zero, so almost everything on screen was a
// guess drawn as a settled pull; STYLES drew the same numbers with no
// interval at all, and PATCH's node bank called them "no lean" and drew a dot.
// One concept, three looks. Now all three draw one mark, decided here:
//
//   settled — the ±σ interval clears zero: a solid bar with its whisker;
//   a guess — the interval crosses zero: a hollow 1 px outline at GUESS_ALPHA,
//             the whisker at full strength, and the label ends in "?".
//
// The whisker is the reading that matters for a guess, so it is the thing
// drawn strongest; the bar is only where the guess happens to point.

/** How strongly a guess's hollow bar is drawn, 0–1. */
export const GUESS_ALPHA = 0.45;
/** How strongly a whisker is drawn: behind a settled bar, and on a guess. */
export const WHISKER_ALPHA_SETTLED = 0.55;
export const WHISKER_ALPHA_GUESS = 1;

/** True when a coefficient `{mean, std}` has not been established: its ±σ
 *  interval includes zero (strictly — an end exactly on zero has cleared it,
 *  the same boundary as `directionsBar`'s `crossesZero`). */
export function isGuess(r) {
  const s = Math.max(0, r.std || 0);
  return r.mean - s < 0 && r.mean + s > 0;
}

/** One pull's mark: `directionsBar`'s geometry plus how to draw it. */
export function pullMark(r, scale, usable) {
  const bar = directionsBar(r, scale, usable);
  const guess = bar.crossesZero;
  return {
    ...bar,
    guess,
    hollow: guess,
    barAlpha: guess ? GUESS_ALPHA : 1,
    whiskerAlpha: guess ? WHISKER_ALPHA_GUESS : WHISKER_ALPHA_SETTLED,
  };
}

/** A row's label: a guess says so with a trailing "?". `guess` is one pull's
 *  state, or — for a DIRECTIONS row that draws one bar per style — whether
 *  every bar on the row is a guess (no style is sure of it). */
export function pullLabel(name, guess) {
  return guess ? `${name}?` : name;
}

/** Counts for a caption or a screen reader: how many marks are settled. */
export function countPulls(marks) {
  let settled = 0;
  let guesses = 0;
  for (const m of marks) {
    if (m.guess) guesses += 1;
    else settled += 1;
  }
  return { settled, guesses };
}

// ---------- TASTE's map: where each sound sits, and its glow ----------
// Prototype v2 (docs/notes/vision-2026-09/prototype/taste.js) draws every
// sound where the engine's map puts it (`taste_map`: the pool on the two
// principal axes of φ, map.rs), opened up just enough that no two sit on each
// other, with the model's liking as an amber halo behind it.

/** The bank's number for a sound: the logistic of its posterior-mean
 *  utility (`BeliefRow::mean`, `MapPoint::utility`), the % on every bank row. */
export function liking(mean) {
  const u = Number(mean);
  return 1 / (1 + Math.exp(-(Number.isFinite(u) ? u : 0)));
}

/** The halo behind a sound it has a guess about: its radius in px for a mark
 *  of size `s0`, and its alpha at the centre (`a0`) and halfway out (`a1`).
 *  The prototype's curve: liking to the 1.6, so a sound it barely likes
 *  glows faintly and one it likes most reaches nearly twice the mark. */
export function haloOf(like, s0) {
  const k = Math.pow(Math.max(0, Math.min(1, Number(like) || 0)), 1.6);
  return { r: s0 * (0.5 + 1.45 * k), a0: 0.03 + 0.42 * k, a1: 0.015 + 0.14 * k };
}

/** The map's frame for a canvas `w` × `h` CSS px holding `n` sounds: the
 *  margins `mapLayout` keeps (`box`), the mark size the halos are drawn to
 *  (`s0`, sized to the room the sounds share: legible on a small screen,
 *  never crowding a large one), and the nearest two marks may sit (`minD`). */
export function mapFrame(w, h, n) {
  const small = w < 520;
  const m = small ? Math.max(22, w * 0.06) : Math.max(48, w * 0.07);
  const s0 = Math.round(Math.max(20, Math.min(32, Math.sqrt((w * h) / Math.max(1, n)) * 0.5)));
  return { box: { w, h, left: m, right: m, top: small ? 48 : 56, bottom: small ? 40 : 48 }, s0, minD: s0 * 1.05 };
}

/** How far each axis is pulled toward its ranks: about halfway, as the
 *  prototype does, so the crowded middle opens while every sound keeps its
 *  order along both axes (a monotone stretch, not a new map). */
export const MAP_RANK_PULL = 0.55;

/** Screen positions for the map's pool points `[{id, x, y}]` (the engine's
 *  coordinates) in a box `{w, h, left, right, top, bottom}` (size and px
 *  margins): each axis min–max scaled, pulled toward its ranks, then relaxed
 *  so no two marks sit closer than `minD` px, each held toward its own place.
 *  Pure and deterministic: the same points give the same layout. Returns a
 *  Map from id to `{x, y}`. y grows downward with the engine's second
 *  coordinate, as the map has always been drawn. */
export function mapLayout(points, box, minD, iterations = 90) {
  const pts = (points || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  const out = new Map();
  if (!pts.length) return out;
  const n = pts.length;
  const iw = Math.max(1, box.w - box.left - box.right);
  const ih = Math.max(1, box.h - box.top - box.bottom);
  const norm = (k) => {
    const vs = pts.map((p) => p[k]);
    const lo = Math.min(...vs);
    const span = Math.max(...vs) - lo;
    const order = pts.map((_, i) => i).sort((a, b) => pts[a][k] - pts[b][k] || a - b);
    const rank = new Array(n);
    order.forEach((i, r) => { rank[i] = n > 1 ? r / (n - 1) : 0.5; });
    return pts.map((p, i) => (1 - MAP_RANK_PULL) * (span > 1e-12 ? (p[k] - lo) / span : 0.5) + MAP_RANK_PULL * rank[i]);
  };
  const nx = norm("x");
  const ny = norm("y");
  const arr = pts.map((p, i) => {
    const ax = box.left + nx[i] * iw;
    const ay = box.top + ny[i] * ih;
    return { id: p.id, ax, ay, x: ax, y: ay };
  });
  const xmin = box.left * 0.5;
  const xmax = box.w - box.right * 0.5;
  const ymin = box.top * 0.6;
  const ymax = box.h - box.bottom * 0.6;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i];
        const b = arr[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= minD) continue;
        if (d < 1e-3) { dx = Math.cos(i + j); dy = Math.sin(i + j); d = 1; }
        const push = (minD - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        a.x -= ux * push; a.y -= uy * push;
        b.x += ux * push; b.y += uy * push;
      }
    }
    for (const a of arr) {
      a.x += (a.ax - a.x) * 0.06;
      a.y += (a.ay - a.y) * 0.06;
      a.x = Math.max(xmin, Math.min(xmax, a.x));
      a.y = Math.max(ymin, Math.min(ymax, a.y));
    }
  }
  for (const a of arr) out.set(a.id, { x: a.x, y: a.y });
  return out;
}

// ---------- LEARNING: which way liking rises on the map ----------

const finitePoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.like);

/** Least squares of liking on the map's two axes, over points
 *  `[{x, y, like}]` in whatever coordinates they are drawn in: the direction
 *  liking rises (`gx`, `gy`, liking per unit of x and of y), how much of
 *  liking's spread across the map that plane explains (`r2`, 0–1), and the
 *  points' centre (`cx`, `cy`). `null` with fewer than three points, none
 *  spread over both axes, or every liking the same. The arrow summarizes the engine's ratings on the
 *  engine's map; it is not a quantity the engine computes. */
export function likingGradient(points) {
  const ps = (points || []).filter(finitePoint);
  const n = ps.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sl = 0;
  for (const p of ps) { sx += p.x; sy += p.y; sl += p.like; }
  const mx = sx / n, my = sy / n, ml = sl / n;
  let cxx = 0, cyy = 0, cxy = 0, cxl = 0, cyl = 0, sst = 0;
  for (const p of ps) {
    const dx = p.x - mx, dy = p.y - my, dl = p.like - ml;
    cxx += dx * dx; cyy += dy * dy; cxy += dx * dy; cxl += dx * dl; cyl += dy * dl; sst += dl * dl;
  }
  const det = cxx * cyy - cxy * cxy;
  // No spread in liking (no fit yet: every rating 0) is no direction at all.
  if (!(sst > 1e-12) || !(det > 1e-9 * Math.max(1e-12, cxx * cyy))) return null;
  const gx = (cyy * cxl - cxy * cyl) / det;
  const gy = (cxx * cyl - cxy * cxl) / det;
  let sse = 0;
  for (const p of ps) {
    const fit = ml + gx * (p.x - mx) + gy * (p.y - my);
    sse += (p.like - fit) ** 2;
  }
  return { gx, gy, r2: sst > 1e-12 ? Math.max(0, 1 - sse / sst) : 0, cx: mx, cy: my };
}

/** The arrow's length in px for a gradient `g` (liking per px) over a map
 *  `span` px across, with `room` px to draw in: longer as liking changes more
 *  across the map, the whole of `room` once it changes by 0.55 or more. */
export function arrowLength(g, span, room) {
  if (!g) return 0;
  return room * Math.min(1, Math.hypot(g.gx, g.gy) * span * 1.8);
}

/** The heading `k` (0–1) of the way from angle `a0` to `a1`, in radians,
 *  turning the shorter way round. */
export function turnBetween(a0, a1, k) {
  let da = a1 - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  return a0 + da * k;
}

// ---------- LEARNING: the forecasts, scored ----------

/** The engine's forecasts (`WasmEngine::forecasts`: `{p_a, chose_a,
 *  random_check, provenance}`, each taken before its answer) as the chance
 *  each gave the sound you picked, oldest first, and whether it guessed it. */
export function scoredForecasts(list) {
  return (Array.isArray(list) ? list : [])
    .filter((f) => f && Number.isFinite(f.p_a))
    .map((f) => {
      const p = f.chose_a ? f.p_a : 1 - f.p_a;
      return { p, hit: p > 0.5, check: !!f.random_check, provenance: f.provenance || "duel" }; // voice: name
    });
}

/** Hits out of forecasts, and what it expected against what it got: the
 *  mean chance it gave the side it guessed, against the share it got right.
 *  `null` with no forecasts. */
export function forecastScore(scored) {
  if (!scored || !scored.length) return null;
  const hits = scored.filter((f) => f.hit).length;
  const expected = scored.reduce((s, f) => s + Math.max(f.p, 1 - f.p), 0) / scored.length;
  return { hits, n: scored.length, expected, was: hits / scored.length };
}
