// Unit tests for vessel.js: the one renderer, on a canvas that records what
// it is asked to draw. Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { decodeFace, bankStats, FACE_LEN, FACE_BANDS, FACE_SLICES } from "../faces.js";
import { drawVessel, vesselBox } from "../vessel.js";

/** A 2D context that records every call and every style it is given. */
function recorder() {
  const ops = [];
  const grad = () => ({ addColorStop: (o, c) => ops.push(["stop", o, c]) });
  const ctx = new Proxy(
    { ops },
    {
      get(t, k) {
        if (k === "ops") return ops;
        if (k === "createLinearGradient" || k === "createRadialGradient") return (...a) => { ops.push([k, ...a]); return grad(); };
        return (...a) => ops.push([k, ...a.map((v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v))]);
      },
      set(t, k, v) {
        ops.push(["=", k, typeof v === "object" ? "gradient" : v]);
        return true;
      },
    },
  );
  return ctx;
}

function bytes(ltas, loud = 0) {
  const b = new Uint8Array(FACE_LEN);
  const enc = (db) => Math.round((db + 60) / 0.5);
  for (let i = 0; i < FACE_BANDS; i++) b[i] = enc(ltas[i]);
  for (let t = 0; t < FACE_SLICES; t++) for (let i = 0; i < FACE_BANDS; i++) b[FACE_BANDS + t * FACE_BANDS + i] = enc(ltas[i]);
  for (let t = 0; t < FACE_SLICES; t++) b[FACE_BANDS + FACE_SLICES * FACE_BANDS + t] = enc(t < 10 ? loud : -60);
  return b;
}
const tilt = (slope) => Array.from({ length: FACE_BANDS }, (_, i) => Math.max(-60, -slope * i));
const bank = [tilt(0.5), tilt(1), tilt(1.5), tilt(2)].map((t) => decodeFace(bytes(t)));
const stats = bankStats(bank);
const GREEN = "#8ef0b1";
const count = (ops, name) => ops.filter((o) => o[0] === name).length;

test("a row's face: ten loud slices as layers, then the outline, no glow", () => {
  const ctx = recorder();
  assert.equal(drawVessel(ctx, bank[1], stats, { box: vesselBox(24, 40), color: GREEN }), true);
  assert.equal(count(ctx.ops, "fill"), 10, "a layer for each slice loud enough to draw (two are silent)");
  assert.equal(count(ctx.ops, "stroke"), 1, "one outline");
  assert.ok(!ctx.ops.some((o) => o[0] === "=" && o[1] === "shadowBlur"), "no glow unless asked");
  assert.ok(ctx.ops.some((o) => o[0] === "=" && o[1] === "fillStyle" && /^rgba\(142, 240, 177, /.test(o[2])), "in the color given");
});

test("stage size: the glow, the layers and the floor's reflection, by the same drawing", () => {
  const box = { x: 500, y: 60, w: 410, h: 684 };
  const ctx = recorder();
  drawVessel(ctx, bank[1], stats, { box, color: GREEN, glow: 30, reflection: true, line: 2.2 });
  const ops = ctx.ops;
  assert.equal(count(ops, "fill"), 10);
  assert.equal(count(ops, "stroke"), 2, "the reflection's outline and the vessel's");
  assert.ok(ops.some((o) => o[0] === "=" && o[1] === "shadowBlur" && o[2] === 30), "the glow");
  assert.ok(ops.some((o) => o[0] === "scale" && o[1] === 1 && o[2] === -1), "mirrored in the floor");
  assert.ok(ops.some((o) => o[0] === "fillRect" && o[2] === box.y + box.h + 2 && o[4] === 1), "a line of light at the floor");
  // The same face at the two sizes is the same shape, scaled: the outline's
  // first point sits at the same fraction of the box.
  const first = (o) => o.find((x) => x[0] === "quadraticCurveTo");
  const small = recorder();
  drawVessel(small, bank[1], stats, { box: { x: 0, y: 0, w: 410 / 10, h: 684 / 10 }, color: GREEN });
  const big = first(ops.slice(ops.findLastIndex((o) => o[0] === "beginPath")));
  const tiny = first(small.ops.slice(small.ops.findLastIndex((o) => o[0] === "beginPath")));
  assert.ok(Math.abs((big[1] - box.x) / 10 - tiny[1]) < 0.01);
});

test("the same face and bank draw the same calls", () => {
  const a = recorder();
  const b = recorder();
  drawVessel(a, decodeFace(bytes(tilt(1.2))), stats, { box: vesselBox(28, 44), color: GREEN, glow: 8 });
  drawVessel(b, decodeFace(bytes(tilt(1.2))), bankStats(bank.map((f) => ({ ...f }))), { box: vesselBox(28, 44), color: GREEN, glow: 8 });
  assert.deepEqual(a.ops, b.ops);
});

test("no face, no bank or no color draws nothing", () => {
  const ctx = recorder();
  assert.equal(drawVessel(ctx, null, stats, { box: vesselBox(24, 40), color: GREEN }), false);
  assert.equal(drawVessel(ctx, bank[0], null, { box: vesselBox(24, 40), color: GREEN }), false);
  assert.equal(drawVessel(ctx, bank[0], stats, { box: vesselBox(24, 40) }), false);
  assert.equal(ctx.ops.length, 0);
});
