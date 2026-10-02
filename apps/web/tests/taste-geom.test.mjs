// Unit tests for taste-geom.js: the lengths TASTE draws uncertainty with.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAP_R_SURE,
  MAP_R_UNSURE,
  mapUnsureScale,
  mapDotRadius,
  directionsScale,
  directionsBar,
  GUESS_ALPHA,
  WHISKER_ALPHA_GUESS,
  isGuess,
  pullMark,
  pullLabel,
  countPulls,
  liking,
  haloOf,
  mapFrame,
  mapLayout,
  likingGradient,
  arrowLength,
  turnBetween,
  scoredForecasts,
  forecastScore,
} from "../taste-geom.js";

test("map: a taught pool's sd spreads its dots from smallest to largest", () => {
  // The spread measured in a taught session (56 picks): 0.46–1.70, median 0.72.
  const sds = [0.46, 0.5, 0.55, 0.6, 0.64, 0.68, 0.7, 0.72, 0.72, 0.75, 0.8, 0.85, 0.9, 1.0, 1.1, 1.2, 1.35, 1.5, 1.6, 1.7];
  const t = mapUnsureScale(sds);
  assert.equal(mapDotRadius(t(0.46)), MAP_R_SURE, "the surest dot is the smallest");
  assert.equal(mapDotRadius(t(1.7)), MAP_R_UNSURE, "the least sure dot is the largest");
  // Small against big at a glance: at least three times the diameter.
  assert.ok(mapDotRadius(t(1.7)) / mapDotRadius(t(0.46)) >= 3);
  // Monotone: more unsure is never drawn smaller.
  const rs = sds.map((s) => mapDotRadius(t(s)));
  for (let i = 1; i < rs.length; i++) assert.ok(rs[i] >= rs[i - 1]);
  // The median sits well inside the range, not on either end.
  assert.ok(t(0.72) > 0.1 && t(0.72) < 0.6);
});

test("map: a pool it is about equally sure of draws about equal dots", () => {
  const sds = [1.2, 1.22, 1.25, 1.27, 1.3, 1.31, 1.33];
  const t = mapUnsureScale(sds);
  const r = sds.map((s) => mapDotRadius(t(s)));
  // 0.13 of sd is noise: it must not be stretched into small-versus-big.
  assert.ok(Math.max(...r) - Math.min(...r) < 0.35 * (MAP_R_UNSURE - MAP_R_SURE));
  assert.ok(Math.abs(t(1.27) - 0.5) < 0.05, "centred where the pool sits");
});

test("map: no sd yet is the middle size, and a lone patch cannot set a scale", () => {
  assert.equal(mapUnsureScale([0.4, 0.9, 1.3])(null), 0.5);
  assert.equal(mapUnsureScale([null, null])(0.7), 0.5);
  assert.equal(mapUnsureScale([0.8])(0.8), 0.5);
});

test("directions: a whisker whose interval crosses zero crosses the centre line", () => {
  // From the TASTE film's taught session: grit (k=2) −0.121 ± 0.126, a true
  // interval of [−0.247, +0.005], drawn with a capped whisker ending at −0.11.
  const rows = [
    { mean: 0.34, std: 0.09 },
    { mean: -0.28, std: 0.11 },
    { mean: -0.121, std: 0.126 }, // grit
    { mean: -0.096, std: 0.143 }, // brightness (k=1)
    { mean: 0.05, std: 0.04 },
  ];
  const usable = 432;
  const scale = directionsScale(rows, usable);
  for (const r of [rows[2], rows[3]]) {
    const b = directionsBar(r, scale, usable);
    assert.ok(b.crossesZero);
    assert.ok(b.lo < 0 && b.hi > 0, "the whisker spans the centre line");
    assert.ok(b.hi >= 5, `it crosses by enough to see (${b.hi.toFixed(1)} px)`);
    // Bar and whisker on one scale: the whisker is centred on the bar's end.
    assert.ok(Math.abs((b.lo + Math.max(b.hi, (r.mean + r.std) * scale)) / 2 - b.len) < 6);
  }
  // A settled coefficient does not.
  assert.equal(directionsBar(rows[0], scale, usable).crossesZero, false);
});

test("directions: the widest interval reaches the half-width, and nothing passes it", () => {
  const rows = [
    { mean: 0.3, std: 0.1 },
    { mean: -0.2, std: 0.15 },
  ];
  const usable = 400;
  const scale = directionsScale(rows, usable);
  const a = directionsBar(rows[0], scale, usable);
  assert.ok(Math.abs(a.hi - usable) < 1e-9, "|mean| + σ of the widest row lands on the edge");
  assert.equal(a.clipHi, false);
  for (const r of rows) {
    const b = directionsBar(r, scale, usable);
    assert.ok(b.lo >= -usable && b.hi <= usable && Math.abs(b.len) <= usable);
  }
});

test("directions: one very unsure coefficient is cut at the edge, not allowed to shrink every bar", () => {
  const rows = [
    { mean: 0.3, std: 0.05 },
    { mean: 0.02, std: 1.5 },
  ];
  const usable = 400;
  const scale = directionsScale(rows, usable);
  const big = directionsBar(rows[0], scale, usable);
  assert.ok(big.len >= usable / 2, `the largest bar keeps at least half the width (${big.len.toFixed(0)} px)`);
  const wide = directionsBar(rows[1], scale, usable);
  assert.ok(wide.clipLo && wide.clipHi, "both ends are marked as cut");
  assert.equal(wide.lo, -usable);
  assert.equal(wide.hi, usable);
});

test("directions: a lens that has learned little draws short bars", () => {
  const scale = directionsScale([{ mean: 0.01, std: 0.01 }], 400);
  assert.ok(directionsBar({ mean: 0.01, std: 0.01 }, scale, 400).len < 40);
});

// ---------- one mark for a pull ----------

test("pull: an interval that crosses zero is a guess, drawn hollow with a full whisker and a ?", () => {
  // From the TASTE film's rows log: 35 of 36 intervals crossed zero, for
  // instance noisiness −0.188 ± 0.19, and every one was drawn as a solid bar.
  const noise = { mean: -0.188, std: 0.19 };
  const usable = 432;
  const scale = directionsScale([noise, { mean: 0.34, std: 0.09 }], usable);
  const m = pullMark(noise, scale, usable);
  assert.equal(m.guess, true);
  assert.equal(m.hollow, true, "a guess is not a filled bar");
  assert.ok(m.barAlpha >= 0.35 && m.barAlpha <= 0.55, `the outline is faint (${m.barAlpha})`);
  assert.equal(m.barAlpha, GUESS_ALPHA);
  assert.equal(m.whiskerAlpha, WHISKER_ALPHA_GUESS);
  assert.ok(m.whiskerAlpha > m.barAlpha, "the whisker is drawn stronger than the bar it qualifies");
  assert.ok(m.lo < 0 && m.hi > 0, "and it crosses the centre line");
  assert.equal(pullLabel("noisiness", m.guess), "noisiness?");
});

test("pull: an interval clear of zero is settled, a solid bar under a quieter whisker", () => {
  const body = { mean: 0.34, std: 0.09 };
  const scale = directionsScale([body], 400);
  const m = pullMark(body, scale, 400);
  assert.equal(m.guess, false);
  assert.equal(m.hollow, false);
  assert.equal(m.barAlpha, 1);
  assert.ok(m.whiskerAlpha < 1);
  assert.equal(pullLabel("body", m.guess), "body");
  // …negative ones too.
  assert.equal(pullMark({ mean: -0.4, std: 0.1 }, scale, 400).guess, false);
});

test("pull: the boundary — an end exactly on zero has cleared it, as the node bank has always counted", () => {
  // The node bank's `beliefState` calls |mean| ≥ std resolved; the mark agrees.
  assert.equal(isGuess({ mean: 0.2, std: 0.2 }), false);
  assert.equal(isGuess({ mean: -0.2, std: 0.2 }), false);
  assert.equal(isGuess({ mean: 0.2, std: 0.2001 }), true);
  assert.equal(isGuess({ mean: 0, std: 0.1 }), true);
  for (const r of [{ mean: 0.2, std: 0.2 }, { mean: 0.19, std: 0.2 }, { mean: -0.5, std: 0.6 }]) {
    assert.equal(pullMark(r, directionsScale([r], 100), 100).guess, isGuess(r));
  }
});

test("pull: a small cell draws the same mark on its own width (the node bank's 16 px and 11 px)", () => {
  // The θ chip's whisker used to be capped at 16 px and drawn from zero, not
  // around the mean; on the shared geometry it is the interval, cut and
  // marked at the edge.
  const rows = [{ mean: 0.3, std: 0.05 }, { mean: 0.05, std: 0.9 }];
  for (const usable of [16, 11]) {
    const scale = directionsScale(rows, usable);
    const wide = pullMark(rows[1], scale, usable);
    assert.equal(wide.guess, true);
    assert.ok(wide.lo < 0 && wide.hi > 0);
    assert.ok(wide.lo >= -usable && wide.hi <= usable, "never past the cell");
    assert.ok(wide.clipLo || wide.clipHi, "and the cut is said");
    const sure = pullMark(rows[0], scale, usable);
    assert.ok(sure.lo > 0, "a settled whisker sits around its mean, clear of zero");
  }
});

test("pull: counts for a caption", () => {
  assert.deepEqual(countPulls([{ guess: true }, { guess: false }, { guess: true }]), { settled: 1, guesses: 2 });
  assert.deepEqual(countPulls([]), { settled: 0, guesses: 0 });
});

// ---------- TASTE's map and LEARNING ----------

test("glow: the bank's number, and a halo that grows with it", () => {
  assert.equal(liking(0), 0.5);
  assert.ok(Math.abs(liking(1) - 0.7311) < 1e-4);
  assert.equal(liking(undefined), 0.5, "no rating is an even guess");
  const lo = haloOf(0.2, 24), mid = haloOf(0.5, 24), hi = haloOf(0.98, 24);
  assert.ok(lo.r < mid.r && mid.r < hi.r, "liked more is wider");
  assert.ok(lo.a0 < mid.a0 && mid.a0 < hi.a0, "…and brighter");
  assert.ok(hi.r <= 24 * 1.95 + 1e-9 && lo.r >= 12, "between half the mark and about twice it");
  assert.ok(hi.a0 <= 0.45 + 1e-9, "a halo never passes 0.45: an arrow's 0.9 stands out over it");
});

test("layout: every sound keeps its order along both axes, and no two sit on each other", () => {
  // A crowded pool: most of it in a corner, as a PCA of φ often puts it.
  const pts = [];
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) pts.push({ id: i, x: Math.pow(rnd(), 3) * 10, y: Math.pow(rnd(), 3) * 5 });
  const f = mapFrame(1100, 560, pts.length);
  const pos = mapLayout(pts, f.box, f.minD);
  assert.equal(pos.size, 40);
  // Deterministic: the same points, the same places.
  assert.deepEqual([...mapLayout(pts, f.box, f.minD)], [...pos]);
  // Inside the frame.
  for (const q of pos.values()) {
    assert.ok(q.x >= f.box.left * 0.5 && q.x <= f.box.w - f.box.right * 0.5);
    assert.ok(q.y >= f.box.top * 0.6 && q.y <= f.box.h - f.box.bottom * 0.6);
  }
  // Opened up: no two marks on top of each other.
  let closest = Infinity;
  const qs = [...pos.values()];
  for (let i = 0; i < qs.length; i++) for (let j = i + 1; j < qs.length; j++) closest = Math.min(closest, Math.hypot(qs[i].x - qs[j].x, qs[i].y - qs[j].y));
  assert.ok(closest > f.minD * 0.6, `the closest two are ${closest.toFixed(1)} px apart`);
  // Order is mostly kept: the relaxation nudges, it does not reshuffle.
  let kept = 0, pairs = 0;
  for (const a of pts) for (const b of pts) {
    if (a.x >= b.x || b.x - a.x < 1) continue;
    pairs += 1;
    if (pos.get(a.id).x < pos.get(b.id).x) kept += 1;
  }
  assert.ok(kept / pairs > 0.9, `${kept} of ${pairs} pairs keep their x order`);
});

test("direction: least squares finds the way liking rises, and how much it explains", () => {
  // Liking rises exactly to the right: the gradient points right, all explained.
  const right = [];
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) right.push({ x: x * 10, y: y * 10, like: 0.2 + x * 0.1 });
  const g = likingGradient(right);
  assert.ok(g.gx > 0 && Math.abs(g.gy) < 1e-9);
  assert.ok(Math.abs(g.r2 - 1) < 1e-9);
  // No spread in liking (no fit yet): no direction at all.
  assert.equal(likingGradient(right.map((p) => ({ ...p, like: 0.5 }))), null);
  // Too few, or all on one line: none.
  assert.equal(likingGradient(right.slice(0, 2)), null);
  assert.equal(likingGradient([0, 1, 2, 3].map((i) => ({ x: i, y: 0, like: i / 4 }))), null);
  // Noise explains little.
  const noisy = right.map((p, i) => ({ ...p, like: 0.5 + (i % 2 ? 0.3 : -0.3) }));
  assert.ok(likingGradient(noisy).r2 < 0.2);
  // The arrow: longer as liking changes more across the map, never past the room.
  assert.equal(arrowLength(null, 400, 100), 0);
  assert.equal(arrowLength({ gx: 0.01, gy: 0 }, 400, 100), 100);
  assert.ok(arrowLength({ gx: 0.0002, gy: 0 }, 400, 100) < 20);
});

test("direction: it turns the shorter way", () => {
  assert.ok(Math.abs(turnBetween(0, Math.PI / 2, 0.5) - Math.PI / 4) < 1e-12);
  // From just above −π to just below π is a small turn through π, not a lap.
  const a = turnBetween(-Math.PI + 0.1, Math.PI - 0.1, 0.5);
  assert.ok(Math.abs(Math.abs(a) - Math.PI) < 1e-9);
});

test("forecasts: the chance it gave the sound you picked, and the score", () => {
  const fs = scoredForecasts([
    { p_a: 0.7, chose_a: true, random_check: false, provenance: "duel" },
    { p_a: 0.7, chose_a: false, random_check: true, provenance: "duel" },
    { p_a: 0.4, chose_a: false, random_check: false, provenance: "perform_offer" },
    { p_a: "x", chose_a: true },
  ]);
  assert.equal(fs.length, 3, "a forecast without a number is not drawn");
  assert.ok(Math.abs(fs[0].p - 0.7) < 1e-12 && fs[0].hit);
  assert.ok(Math.abs(fs[1].p - 0.3) < 1e-12 && !fs[1].hit && fs[1].check);
  assert.ok(Math.abs(fs[2].p - 0.6) < 1e-12 && fs[2].hit);
  const sc = forecastScore(fs);
  assert.equal(sc.hits, 2);
  assert.equal(sc.n, 3);
  assert.ok(Math.abs(sc.expected - (0.7 + 0.7 + 0.6) / 3) < 1e-12);
  assert.ok(Math.abs(sc.was - 2 / 3) < 1e-12);
  assert.equal(forecastScore([]), null);
  assert.deepEqual(scoredForecasts(null), []);
});
