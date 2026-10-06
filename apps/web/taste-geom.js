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
export function mapFrame(w, h, n, { track = false } = {}) {
  const small = w < 520;
  const m = small ? Math.max(22, w * 0.06) : Math.max(48, w * 0.07);
  const s0 = Math.round(Math.max(20, Math.min(32, Math.sqrt((w * h) / Math.max(1, n)) * 0.5)));
  // With the taste-over-time track along the bottom, the sounds keep clear of it.
  const bottom = track ? (small ? 78 : 96) : small ? 40 : 48;
  return { box: { w, h, left: m, right: m, top: small ? 48 : 56, bottom }, s0, minD: s0 * 1.05 };
}

/** LEARNING's small map: each pool point `[{id, x, y}]` min–max scaled into
 *  a `w` × `h` canvas inside `pad` px, with no opening up (the small map
 *  shows the engine's coordinates as they are). Returns a Map from id to
 *  `{x, y}`. */
export function miniLayout(points, w, h, pad) {
  const out = new Map();
  const pts = (points || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!pts.length) return out;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  for (const p of pts) {
    out.set(p.id, {
      x: pad + ((p.x - x0) / Math.max(1e-9, x1 - x0)) * (w - 2 * pad),
      y: pad + ((p.y - y0) / Math.max(1e-9, y1 - y0)) * (h - 2 * pad),
    });
  }
  return out;
}

/** How a sound's mark is drawn while a weight is pointed at: its z on that
 *  feature against the largest |z| in the pool (`v`, −1 to 1), as an alpha
 *  and a radius in px (the prototype's model.js). */
export function shadeOf(z, zmax) {
  const v = Math.max(-1, Math.min(1, (Number(z) || 0) / Math.max(1e-6, zmax)));
  return { v, alpha: 0.15 + 0.85 * (v * 0.5 + 0.5), r: 1.6 + 2.6 * Math.max(0, v) };
}

/** Each sound's z on one feature, from the table the engine posts with every
 *  views post (`WasmEngine::pool_features`: `{names, rows: [{id, z}]}`, each
 *  row's z in φ's order, the order of `names`): a Map from id to the z in the
 *  column `name` heads. Null when no feature is named or the engine posted no
 *  z for it: the small map is shaded, and its legend says "dots:", only when
 *  this is not null. */
export function zByFeature(features, name) {
  const zi = name && features && Array.isArray(features.names) ? features.names.indexOf(name) : -1;
  return zi >= 0 ? new Map(features.rows.map((row) => [row.id, row.z[zi]])) : null;
}

/** Every sound's mark on the small map while a weight is pointed at: each of
 *  `ids` (the sounds drawn) by its z on that feature (`zOf`, a Map from id to
 *  z as `WasmEngine::pool_features` posted it; a sound with none is drawn at
 *  the middle), against the largest |z| among the sounds drawn, through
 *  `shadeOf`. Returns a Map from id to its shade. */
export function poolShades(ids, zOf) {
  const list = [...ids];
  const zAt = (id) => zOf.get(id) ?? 0;
  const zmax = Math.max(1e-6, ...list.map((id) => Math.abs(zAt(id))));
  return new Map(list.map((id) => [id, shadeOf(zAt(id), zmax)]));
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
// The fit itself is the engine's (`auracle_session::liking_direction`, posted
// as `ratings.direction`, in map units). The page only draws it.

/** The engine's direction (liking per map unit) on a drawn map: each axis
 *  scaled by `sx`, `sy` px per map unit. A gradient divides where the
 *  coordinates multiply. */
export function directionOnScreen(d, sx, sy) {
  if (!d || !Number.isFinite(d.gx) || !Number.isFinite(d.gy)) return null;
  return { gx: d.gx / Math.max(1e-12, sx), gy: d.gy / Math.max(1e-12, sy), r2: d.r2 };
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

// ---------- taste over time: what the engine posted, kept ----------
// The engine keeps no history of its ratings, its map or its θ: each reply
// carries the posterior as it stands. The page keeps what it was sent, one
// entry per change (a pick's, a star's or a cut's reply with its `ratings`;
// a views post with a new map), so TASTE's track and LEARNING's replay show
// exactly what was posted at each one, rounded to four decimal places. The
// maps are kept once each and referenced, since a map changes only at a
// refit. Bounded to the last HISTORY_MAX entries, and saved with the session
// (`ui.taste`) as JS-owned state with a version.

export const HISTORY_VERSION = 1;
export const HISTORY_MAX = 200;
const r4 = (x) => Math.round((Number(x) || 0) * 1e4) / 1e4;

/** An empty history. */
export function newHistory() {
  return { v: HISTORY_VERSION, maps: [], entries: [], names: null };
}

/** A saved history if it is one this build can read, else an empty one. */
const num = (x) => typeof x === "number" && Number.isFinite(x);
const triple = (t) => Array.isArray(t) && t.length === 3 && t.every(num);
const goodMap = (m) => m && Array.isArray(m.points) && m.points.every(triple);
const goodStyles = (s) => s === undefined || s === null ||
  (Array.isArray(s) && s.every((x) => x && num(x.share) && Array.isArray(x.m) && Array.isArray(x.d) &&
    x.m.length === x.d.length && x.m.every(num) && x.d.every(num)));

/** A saved history if it is one this build can read, else an empty one. A
 *  map or a moment that is not well formed is dropped, not thrown on: the
 *  rest is kept. */
export function readHistory(saved) {
  if (!saved || saved.v !== HISTORY_VERSION || !Array.isArray(saved.maps) || !Array.isArray(saved.entries)) return newHistory();
  const h = { v: HISTORY_VERSION, maps: [], entries: [], names: Array.isArray(saved.names) ? saved.names : null };
  const at = new Map();
  saved.maps.forEach((m, i) => {
    if (!goodMap(m)) return;
    at.set(i, h.maps.length);
    h.maps.push({ points: m.points, explained: Array.isArray(m.explained) && m.explained.every(num) ? m.explained : [0, 0] });
  });
  for (const e of saved.entries) {
    const ok = e && typeof e.kind === "string" && Number.isInteger(e.m) && at.has(e.m) &&
      Array.isArray(e.r) && e.r.every(triple) &&
      (e.pick === null || e.pick === undefined || (Array.isArray(e.pick) && e.pick.length === 2 && e.pick.every(num))) &&
      goodStyles(e.s) && num(e.n ?? 0) && num(e.obs ?? 0);
    if (ok) h.entries.push({ ...e, m: at.get(e.m) });
  }
  return h;
}

/** Keep one change. `e`: `{kind, n, obs, gen, fit, map: {points, explained},
 *  ratings: [{id, mean, std}], pick: {a, b} | null}`. `kind` is `start`,
 *  `pick`, `star`, `cut`, `keep`, `offer`, `map` or `gen`; `n` the picks
 *  TAUGHT counted then; `obs` the engine's observation count; `gen` its
 *  generation; `fit` whether a fit existed. A generation's entry also says
 *  which sounds joined the map (`joined`). Returns the entry kept. */
export function recordEntry(h, e, max = HISTORY_MAX) {
  const points = (e.map?.points || []).filter((p) => p && p.id != null).map((p) => [p.id, r4(p.x), r4(p.y)]);
  const explained = (e.map?.explained || [0, 0]).map(r4);
  const last = h.entries[h.entries.length - 1];
  const lastMap = last ? h.maps[last.m] : null;
  let m;
  if (lastMap && JSON.stringify(lastMap.points) === JSON.stringify(points)) m = last.m;
  else {
    h.maps.push({ points, explained });
    m = h.maps.length - 1;
  }
  const before = new Set(lastMap ? lastMap.points.map((p) => p[0]) : []);
  const r = (e.ratings || []).map((x) => [x.id, r4(x.mean), r4(x.std)]);
  // A redrawn map that changes nothing (a reload sends the map it saved) is
  // not a new moment.
  if (e.kind === "map" && last && last.m === m && JSON.stringify(last.r) === JSON.stringify(r)) return last;
  const entry = {
    kind: e.kind,
    n: e.n | 0,
    obs: e.obs | 0,
    gen: e.gen | 0,
    fit: !!e.fit,
    m,
    r,
    pick: e.pick ? [e.pick.a, e.pick.b] : null,
    joined: e.kind === "gen" && lastMap ? points.filter((p) => !before.has(p[0])).length : 0,
  };
  h.entries.push(entry);
  if (h.entries.length > max) {
    // How many went from the front, so a moment being looked at keeps its
    // place (`dropped` counts them, and is not saved).
    h.dropped = (h.dropped || 0) + (h.entries.length - max);
    h.entries.splice(0, h.entries.length - max);
    const used = [...new Set(h.entries.map((x) => x.m))].sort((a, b) => a - b);
    const at = new Map(used.map((old, i) => [old, i]));
    h.maps = used.map((old) => h.maps[old]);
    for (const x of h.entries) x.m = at.get(x.m);
  }
  return entry;
}

/** The styles a reply posted after a pick (`WasmEngine::styles`), kept with
 *  that pick's entry: the last one whose observation count is `obs`.
 *  Returns the entry, or null when no entry is that pick's. */
export function attachStyles(h, obs, styles) {
  if (!Array.isArray(styles) || !styles.length) return null;
  let entry = null;
  for (let i = h.entries.length - 1; i >= 0; i--) {
    if (h.entries[i].obs === obs && h.entries[i].kind !== "map" && h.entries[i].kind !== "gen" && h.entries[i].kind !== "file") {
      entry = h.entries[i];
      break;
    }
  }
  return entry ? setStyles(h, entry, styles) : null;
}

/** The styles that were in force at a moment, kept with it: a pick's from
 *  the reply after it, a refit's, a generation's or an opened file's from
 *  the views post that brought its map. */
export function setStyles(h, entry, styles) {
  if (!entry || !Array.isArray(styles) || !styles.length) return null;
  const names = styles[0].theta.map((t) => t.name);
  if (!h.names) h.names = names;
  if (JSON.stringify(h.names) !== JSON.stringify(names)) entry.names = names;
  entry.s = styles.map((s) => ({ share: r4(s.share), m: s.theta.map((t) => r4(t.mean)), d: s.theta.map((t) => r4(t.std)) }));
  return entry;
}

/** Entry `i` as the views it was: the map (its points carrying the ratings
 *  then), the ratings, whether a fit existed, the pick, and the styles if
 *  they were posted. */
export function entryView(h, i) {
  const e = h.entries[i];
  if (!e) return null;
  const map = h.maps[e.m];
  const ratings = new Map(e.r.map(([id, mean, std]) => [id, { mean, std }]));
  const points = map.points.map(([id, x, y]) => ({
    id, x, y, utility: ratings.get(id)?.mean ?? 0, utility_std: ratings.get(id)?.std ?? 0,
  }));
  const names = e.names || h.names || [];
  const styles = e.s
    ? e.s.map((s) => ({ share: s.share, theta: s.m.map((mean, j) => ({ name: names[j], mean, std: s.d[j] })) }))
    : null;
  return {
    kind: e.kind, n: e.n, fit: e.fit, gen: e.gen, joined: e.joined,
    pick: e.pick ? { a: e.pick[0], b: e.pick[1] } : null,
    map: { points, explained: map.explained }, ratings, styles,
  };
}
