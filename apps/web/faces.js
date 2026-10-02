// A sound's face: its render's spectrum, against the bank's (Plan-005 task 3,
// RFC-006 §2; the specimen is prototype v2's `A.face`,
// docs/notes/vision-2026-09/prototype/core.js). The data and the geometry,
// pure, so they are unit-tested (tests/faces.test.mjs); vessel.js draws them,
// at every size.
//
// What is drawn is the engine's measurement of the render
// (`auracle_features::face`, read from the engine's memo by
// `WasmEngine::face_of`): 40 bands from 35 Hz to 14 kHz, low at the base,
// each the mean power density over its edges, in dB re the sound's own
// loudest band, over the whole phrase and in 12 slices of it. Whitening is
// here: each band minus the bank's mean in that band, over the bank's spread
// (one number, pooled over every band of every sound in the bank), so the
// vessel is wide where this sound has more than the bank's sounds have, and
// narrow where it has less. A face changes only when its render does or when
// the bank's mean or spread does (a sound added, replaced or cut): nothing
// here moves by itself (ADR-012).

/** The engine's encoding (`auracle_features::face`): keep in step. */
export const FACE_BANDS = 40;
export const FACE_SLICES = 12;
export const FACE_FLOOR_DB = -60;
export const FACE_STEP_DB = 0.5;
export const FACE_LEN = FACE_BANDS + FACE_SLICES * FACE_BANDS + FACE_SLICES;
/** Below this many faces in the bank there is no mean to draw against, and no
 *  face is drawn (its slot stays empty). */
export const FACE_MIN_BANK = 4;
/** The spread is never taken as less than this (dB): a bank of near copies
 *  would otherwise blow a fraction of a dB up to the vessel's full width. */
export const FACE_SPREAD_FLOOR_DB = 3;
/** The bank's mean and spread are drawn against again only when they have
 *  moved by more than this since the faces were last drawn: a band's mean by
 *  FACE_RESTAT_DB, or the spread by FACE_RESTAT_SPREAD of itself. Less moves
 *  a 40 px face by under a tenth of a pixel, and a card's by under one. */
export const FACE_RESTAT_DB = 0.25;
export const FACE_RESTAT_SPREAD = 0.01;
/** A slice this far (dB) under the phrase's loudest draws no layer, and one
 *  within it draws a layer as large and as bright as it is loud. */
export const FACE_LAYER_RANGE_DB = 30;

/** The engine's bytes as dB: the long-term spectrum, the slices, their
 *  loudness. Null for anything that is not a face. */
export function decodeFace(bytes) {
  if (!bytes || bytes.length !== FACE_LEN) return null;
  const db = (i) => FACE_FLOOR_DB + bytes[i] * FACE_STEP_DB;
  const ltas = new Float64Array(FACE_BANDS);
  for (let b = 0; b < FACE_BANDS; b++) ltas[b] = db(b);
  const slices = [];
  for (let t = 0; t < FACE_SLICES; t++) {
    const s = new Float64Array(FACE_BANDS);
    for (let b = 0; b < FACE_BANDS; b++) s[b] = db(FACE_BANDS + t * FACE_BANDS + b);
    slices.push(s);
  }
  const loud = new Float64Array(FACE_SLICES);
  for (let t = 0; t < FACE_SLICES; t++) loud[t] = db(FACE_BANDS + FACE_SLICES * FACE_BANDS + t);
  return { ltas, slices, loud };
}

/** The bank's mean per band and its spread, over the long-term spectra of the
 *  faces given (the bank's rows); null below FACE_MIN_BANK. */
export function bankStats(faces) {
  const fs = faces.filter(Boolean);
  if (fs.length < FACE_MIN_BANK) return null;
  const mean = new Float64Array(FACE_BANDS);
  for (const f of fs) for (let b = 0; b < FACE_BANDS; b++) mean[b] += f.ltas[b];
  for (let b = 0; b < FACE_BANDS; b++) mean[b] /= fs.length;
  let ss = 0;
  for (const f of fs) for (let b = 0; b < FACE_BANDS; b++) ss += (f.ltas[b] - mean[b]) ** 2;
  const spread = Math.max(FACE_SPREAD_FLOOR_DB, Math.sqrt(ss / (fs.length * FACE_BANDS)));
  return { mean, spread, n: fs.length };
}

/** Have the bank's stats moved enough since `drawn` to draw against `now`? */
export function statsMoved(drawn, now) {
  if (!drawn || !now) return drawn !== now;
  if (Math.abs(now.spread - drawn.spread) > FACE_RESTAT_SPREAD * drawn.spread) return true;
  for (let b = 0; b < FACE_BANDS; b++) if (Math.abs(now.mean[b] - drawn.mean[b]) > FACE_RESTAT_DB) return true;
  return false;
}

/** A spectrum (dB) against the bank: in spreads, per band. */
export function whiten(db, stats) {
  const out = new Float64Array(FACE_BANDS);
  for (let b = 0; b < FACE_BANDS; b++) out[b] = (db[b] - stats.mean[b]) / stats.spread;
  return out;
}

/** A moving average over 2k + 1 bands (fewer at the ends). */
export function smooth(a, k) {
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(a.length - 1, i + k); j++) {
      s += a[j];
      n++;
    }
    out[i] = s / n;
  }
  return out;
}

const sig = (x) => 1 / (1 + Math.exp(-x));

/** The vessel's outline: frequency up the box (low at the base), mirrored
 *  about its center, half-width `R · σ(1.4 v) · scale` for a band `v` spreads
 *  from the bank's mean (half the box at the mean), as the specimen draws it.
 *  The closed list of points, up the right side and down the left;
 *  vessel.js joins them with quadratic curves through their midpoints. */
export function vesselPoints(dev, box, scale = 1) {
  const n = dev.length;
  const cx = box.x + box.w / 2;
  const R = box.w / 2;
  const half = [];
  for (let i = 0; i < n; i++) half.push([R * sig(dev[i] * 1.4) * scale, box.y + box.h - (i / (n - 1)) * box.h]);
  return half.map(([w, y]) => [cx + w, y]).concat(half.slice().reverse().map(([w, y]) => [cx - w, y]));
}

/** How large and how bright slice t's layer is (0 draws none). */
export function layerWeight(loudDb) {
  const l = Math.max(0, Math.min(1, 1 + loudDb / FACE_LAYER_RANGE_DB));
  return l < 0.25 ? 0 : l;
}
