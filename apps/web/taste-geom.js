// The TASTE view's geometry: how big a MAP dot is, how long a DIRECTIONS
// bar and its whisker are, and whether a pull is drawn settled or as a guess
// (in STYLES, DIRECTIONS and PATCH's node bank alike). All are claims about
// uncertainty, and all were drawn so that the uncertainty could not be seen —
// nothing on screen looked broken, which is why they live here, pure, with
// unit tests beside them (tests/taste-geom.test.mjs). main.js draws; this
// decides the lengths and the marks.

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
