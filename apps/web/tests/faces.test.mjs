// Unit tests for faces.js: a face against the bank, and the vessel it draws.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import {
  FACE_BANDS,
  FACE_SLICES,
  FACE_LEN,
  FACE_MIN_BANK,
  FACE_SPREAD_FLOOR_DB,
  decodeFace,
  bankStats,
  whiten,
  smooth,
  vesselPath,
  layerWeight,
  faceSvg,
} from "../faces.js";

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
  const mean = { ltas: s.mean };
  const dev = whiten(mean.ltas, s);
  assert.ok(dev.every((v) => Math.abs(v) < 1e-12));
  const d = vesselPath(dev, { x: 0, y: 0, w: 20, h: 40 });
  // Every point sits at x = 10 ± 5, except where the two sides meet, at the
  // very top and the very base.
  const pts = [...d.matchAll(/([-\d.]+) ([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  for (const [x, y] of pts) {
    if (y === 0 || y === 40) continue;
    assert.ok(Math.abs(Math.abs(x - 10) - 5) < 0.01, `${x},${y}`);
  }
});

test("the vessel is mirrored, low at the base", () => {
  const dev = Float64Array.from({ length: FACE_BANDS }, (_, i) => (i < 5 ? 2 : -1));
  const d = vesselPath(dev, { x: 0, y: 0, w: 20, h: 40 });
  const pts = [...d.matchAll(/Q([-\d.]+) ([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const atBase = pts.filter(([, y]) => y > 39).map(([x]) => Math.abs(x - 10));
  const atTop = pts.filter(([, y]) => y < 1).map(([x]) => Math.abs(x - 10));
  assert.ok(Math.min(...atBase) > Math.max(...atTop), "wide where the lows are strong, narrow on top");
  const left = pts.filter(([x]) => x < 10).map(([x, y]) => `${(20 - x).toFixed(2)},${y}`).sort();
  const right = pts.filter(([x]) => x > 10).map(([x, y]) => `${x.toFixed(2)},${y}`).sort();
  assert.deepEqual(left, right);
});

test("a face is the same markup for the same render and bank", () => {
  const bank = [tilt(0.5), tilt(1), tilt(1.5), tilt(2)].map((t) => decodeFace(bytes(t)));
  const s = bankStats(bank);
  const a = faceSvg(decodeFace(bytes(tilt(1.2))), s, { w: 24, h: 40 });
  const b = faceSvg(decodeFace(bytes(tilt(1.2))), bankStats(bank.map((f) => ({ ...f }))), { w: 24, h: 40 });
  assert.equal(a, b);
  assert.match(a, /^<svg class="face"/);
  assert.equal((a.match(/class="face-l"/g) || []).length, FACE_SLICES, "a layer per loud slice");
  assert.equal(faceSvg(null, s, { w: 24, h: 40 }), "");
  assert.equal(faceSvg(bank[0], null, { w: 24, h: 40 }), "", "no bank, no face");
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
