// Unit tests for faces.js: a face against the bank, and the vessel it draws.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FACE_BANDS,
  FACE_SLICES,
  FACE_LEN,
  FACE_MIN_BANK,
  FACE_SPREAD_FLOOR_DB,
  decodeFace,
  bankStats,
  statsMoved,
  whiten,
  smooth,
  vesselPoints,
  layerWeight,
  liveBands,
  bandEdgesHz,
  bandWeights,
  FACE_FLOOR_DB,
} from "../faces.js";

test("what sounds now is read in the face's measure: a steady sound's live bands are its face", () => {
  // The engine's own fixture (auracle-features face::tests): a steady
  // sawtooth's face, and its mean power per bin as an analyser gives it.
  const fx = JSON.parse(readFileSync(new URL("./fixtures/steady-face.json", import.meta.url), "utf8"));
  const face = decodeFace(Buffer.from(fx.face, "base64"));
  const { db } = liveBands(Float32Array.from(fx.bins_db), fx.sample_rate / 2);
  let compared = 0;
  for (let b = 0; b < FACE_BANDS; b++) {
    if (face.ltas[b] <= FACE_FLOOR_DB + 1) continue;
    assert.ok(Math.abs(db[b] - face.ltas[b]) <= 1, `band ${b}: live ${db[b].toFixed(2)} dB, face ${face.ltas[b]} dB`);
    // Every slice of a steady sound is the same, but for the noise floor.
    if (face.ltas[b] > -30) for (const sl of face.slices) assert.ok(Math.abs(db[b] - sl[b]) <= 1, `band ${b} against a slice`);
    compared++;
  }
  assert.ok(compared >= 30, `${compared} bands compared`);
});

test("what sounds now: a tone lights its band, a narrow band reads its bin, silence nothing", () => {
  const nyq = 22050;
  const bins = new Float32Array(1024).fill(-120);
  const at = (hz) => Math.round((hz / nyq) * bins.length);
  bins[at(1000)] = -20;
  const { db, top } = liveBands(bins, nyq);
  const e = bandEdgesHz();
  const band = e.findIndex((x, i) => at(1000) * (nyq / 1024) >= x && at(1000) * (nyq / 1024) < e[i + 1]);
  assert.equal(top, -20);
  assert.equal(db[band], 0, "the tone's band is the densest");
  // A band narrower than one bin reads the bin it sits in.
  bins.fill(-120);
  bins[2] = -30;
  const w = bandWeights(1024, nyq / 1024);
  assert.ok(w.every((ws) => ws.length > 0), "no band is empty");
  assert.equal(liveBands(bins, nyq).db[1], 0, "35 to 46 Hz, inside one bin, reads it");
  const silent = liveBands(new Float32Array(1024).fill(-Infinity), nyq);
  assert.ok(silent.db.every((v) => v === FACE_FLOOR_DB));
  assert.equal(silent.top, -Infinity);
});

/** Bytes for a face whose long-term spectrum is `ltas` (dB), every slice the
 *  same, every slice as loud as the loudest. */
function bytes(ltas, loud = 0) {
  const b = new Uint8Array(FACE_LEN);
  const enc = (db) => Math.round((db + 60) / 0.5);
  for (let i = 0; i < FACE_BANDS; i++) b[i] = enc(ltas[i]);
  for (let t = 0; t < FACE_SLICES; t++) for (let i = 0; i < FACE_BANDS; i++) b[FACE_BANDS + t * FACE_BANDS + i] = enc(ltas[i]);
  for (let t = 0; t < FACE_SLICES; t++) b[FACE_BANDS + FACE_SLICES * FACE_BANDS + t] = enc(loud);
  return b;
}
const tilt = (slope) => Array.from({ length: FACE_BANDS }, (_, i) => Math.max(-60, -slope * i));

test("decode: the engine's bytes read back as dB", () => {
  const f = decodeFace(bytes(tilt(1)));
  assert.equal(f.ltas[0], 0);
  assert.equal(f.ltas[10], -10);
  assert.equal(f.slices.length, FACE_SLICES);
  assert.equal(f.slices[5][10], -10);
  assert.equal(f.loud[3], 0);
  assert.equal(decodeFace(new Uint8Array(10)), null, "anything else is not a face");
});

test("the bank: its mean per band and one pooled spread", () => {
  const faces = [tilt(0.5), tilt(1), tilt(1.5), tilt(2)].map((t) => decodeFace(bytes(t)));
  const s = bankStats(faces);
  assert.equal(s.n, 4);
  assert.equal(s.mean[0], 0);
  assert.equal(s.mean[10], -12.5);
  // At band i the four sit at -0.5i, -i, -1.5i, -2i: deviations of ±0.25i and ±0.75i.
  let ss = 0;
  for (let i = 0; i < FACE_BANDS; i++) {
    const m = s.mean[i];
    for (const f of faces) ss += (f.ltas[i] - m) ** 2;
  }
  assert.equal(s.spread, Math.max(FACE_SPREAD_FLOOR_DB, Math.sqrt(ss / (4 * FACE_BANDS))));
  assert.equal(bankStats(faces.slice(0, FACE_MIN_BANK - 1)), null, "too few to draw against");
  const same = Array.from({ length: 6 }, () => decodeFace(bytes(tilt(1))));
  assert.equal(bankStats(same).spread, FACE_SPREAD_FLOOR_DB, "near copies are not blown up");
});

test("whitening moves when the bank changes", () => {
  const f = decodeFace(bytes(tilt(1)));
  const bank = [tilt(0.5), tilt(1), tilt(1.5), tilt(2)].map((t) => decodeFace(bytes(t)));
  const before = whiten(f.ltas, bankStats(bank));
  const after = whiten(f.ltas, bankStats([...bank, decodeFace(bytes(tilt(0.2)))]));
  assert.notDeepEqual(after, before);
  assert.ok(after[20] < before[20], "a bank that grew brighter makes a dark sound read darker");
});

test("a sound at the bank's mean is a straight vessel, half the box wide", () => {
  const bank = [tilt(0.5), tilt(1), tilt(1.5), tilt(2)].map((t) => decodeFace(bytes(t)));
  const s = bankStats(bank);
  const dev = whiten(s.mean, s);
  assert.ok(dev.every((v) => Math.abs(v) < 1e-12));
  const pts = vesselPoints(dev, { x: 0, y: 0, w: 20, h: 40 });
  assert.equal(pts.length, 2 * FACE_BANDS);
  for (const [x] of pts) assert.ok(Math.abs(Math.abs(x - 10) - 5) < 1e-9, String(x));
});

test("the vessel is mirrored, low at the base", () => {
  const dev = Float64Array.from({ length: FACE_BANDS }, (_, i) => (i < 5 ? 2 : -1));
  const pts = vesselPoints(dev, { x: 0, y: 0, w: 20, h: 40 });
  const right = pts.slice(0, FACE_BANDS);
  const left = pts.slice(FACE_BANDS).reverse();
  assert.equal(right[0][1], 40, "the lowest band at the base");
  assert.equal(right[FACE_BANDS - 1][1], 0, "the highest at the top");
  assert.ok(right[0][0] - 10 > right[FACE_BANDS - 1][0] - 10, "wide where the lows are strong, narrow on top");
  right.forEach(([x, y], i) => {
    assert.ok(Math.abs(20 - x - left[i][0]) < 1e-9);
    assert.equal(y, left[i][1]);
  });
  assert.deepEqual(vesselPoints(dev, { x: 0, y: 0, w: 20, h: 40 }), pts, "the same geometry every time");
});

test("a quiet slice draws a smaller, fainter layer, and silence none", () => {
  assert.equal(layerWeight(0), 1);
  assert.equal(layerWeight(-15), 0.5);
  assert.equal(layerWeight(-25), 0);
  assert.equal(layerWeight(-60), 0);
});

test("smoothing averages its neighbours, fewer at the ends", () => {
  assert.deepEqual([...smooth(Float64Array.from([0, 3, 0, 3]), 1)], [1.5, 1, 2, 1.5]);
});

test("faces are drawn against the bank again only once its stats have moved", () => {
  const bank = [tilt(0.5), tilt(1), tilt(1.5), tilt(2)].map((t) => decodeFace(bytes(t)));
  const s = bankStats(bank);
  assert.equal(statsMoved(null, s), true, "the first bank is drawn against");
  assert.equal(statsMoved(s, bankStats(bank.map((f) => ({ ...f })))), false, "the same bank is not");
  const nudged = { mean: Float64Array.from(s.mean, (m, i) => (i === 7 ? m + 0.2 : m)), spread: s.spread };
  assert.equal(statsMoved(s, nudged), false, "0.2 dB in one band moves no face by a pixel");
  const moved = { mean: Float64Array.from(s.mean, (m, i) => (i === 7 ? m + 0.3 : m)), spread: s.spread };
  assert.equal(statsMoved(s, moved), true);
  assert.equal(statsMoved(s, { mean: s.mean, spread: s.spread * 1.02 }), true);
  assert.equal(statsMoved(s, null), true, "a bank too small to draw against is a change");
});
