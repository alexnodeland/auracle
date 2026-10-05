// The one renderer for a sound's face, at every size (Plan-005 task 3): a
// bank row's icon, a chip, EVOLVE's cards, PERFORM's sound in hand, the
// share card and stage mode's full screen. The specimen is prototype v2:
// `A.face` and `A.vesselPath` (core.js) for the vessel and its layers,
// stage.js's `drawBase` and `drawCard` for the glow and the floor's
// reflection (docs/notes/vision-2026-09/prototype/).
//
// What it draws is a fact of the render (ADR-012): the engine's face
// (`auracle_features::face`, filed by `WasmEngine::face_of`) against the
// bank's mean and spread (faces.js). Nothing here moves; a caller redraws when
// the render or the bank changes. Stage mode's moving trail (what you hear,
// fading like phosphor) is stage mode's own, drawn over this.
import { FACE_SLICES, whiten, smooth, vesselPoints, layerWeight } from "./faces.js";

/** `#rrggbb` → "r, g, b" for an rgba() with its own alpha. */
function rgbOf(color) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(color).trim());
  return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : null;
}

/** `color` (`#rrggbb`) at `alpha`, as an rgba() for a canvas. */
export function tint(color, alpha) {
  const rgb = rgbOf(color);
  return rgb ? `rgba(${rgb}, ${alpha})` : color;
}

/** The vessel's path on `ctx`: the points joined with quadratic curves
 *  through their midpoints, closed, as `A.vesselPath` joins them. */
export function traceVessel(ctx, pts) {
  const m = pts.length;
  ctx.beginPath();
  ctx.moveTo((pts[m - 1][0] + pts[0][0]) / 2, (pts[m - 1][1] + pts[0][1]) / 2);
  for (let i = 0; i < m; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % m];
    ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  ctx.closePath();
}

/** Draw `face` (faces.js `decodeFace`) against the bank's `stats` into `box`
 *  ({x, y, w, h}, the vessel's own box; a large one is 0.6 as wide as it is
 *  tall, as the specimen's wells are). Returns false, drawing nothing, with
 *  no face or no bank to draw it against.
 *
 *  - `color`: the vessel's, as `#rrggbb` (the app passes the sound's green,
 *    `--phos-a`).
 *  - `slices`: the twelve slices of the phrase as faint layers inside the
 *    outline, each as large and as bright as its slice is loud
 *    (`layerWeight`); a near-silent slice draws none.
 *  - `glow`: the outline's glow, a blur in px (0: none; the specimen's large
 *    faces use 18 to 34).
 *  - `reflection`: the floor under the vessel, a line of light and the
 *    outline mirrored in it, faint and fading (the specimen's stage and card).
 *  - `line`: the outline's width (default h/70, at least 1); `dim`: an
 *    overall alpha.
 *  - `dash`: the outline dashed (`[on, off]` in px), for a face drawn as a
 *    comparison over another (PATCH's "without this module" at OUT). */
export function drawVessel(ctx, face, stats, { box, color, slices = true, glow = 0, reflection = false, line = null, dim = 1, dash = null } = {}) {
  const rgb = rgbOf(color);
  if (!face || !stats || !box || !rgb) return false;
  const k = box.h < 36 ? 2 : 1;
  const outline = vesselPoints(smooth(whiten(face.ltas, stats), k), box);
  const width = line ?? Math.max(1, box.h / 70);
  ctx.save();
  if (reflection) {
    const floor = box.y + box.h + 2;
    // The floor: a line of light wider than the vessel, brightest under it.
    const fx0 = box.x - box.w * 0.9;
    const fx1 = box.x + box.w * 1.9;
    const fl = ctx.createLinearGradient(fx0, 0, fx1, 0);
    fl.addColorStop(0, `rgba(${rgb}, 0)`);
    fl.addColorStop(0.5, `rgba(${rgb}, ${0.3 * dim})`);
    fl.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = fl;
    ctx.fillRect(fx0, floor, fx1 - fx0, 1);
    // The vessel in it, upside down, its base at the floor, fading over a
    // third of its height.
    ctx.save();
    ctx.beginPath();
    ctx.rect(fx0, floor + 1, fx1 - fx0, box.h * 0.32);
    ctx.clip();
    ctx.translate(0, 2 * floor);
    ctx.scale(1, -1);
    const fade = ctx.createLinearGradient(0, box.y + box.h, 0, box.y + box.h * 0.68);
    fade.addColorStop(0, `rgba(${rgb}, ${0.14 * dim})`);
    fade.addColorStop(1, `rgba(${rgb}, 0)`);
    traceVessel(ctx, outline);
    ctx.strokeStyle = fade;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.restore();
  }
  if (slices) {
    for (let t = 0; t < FACE_SLICES; t++) {
      const l = layerWeight(face.loud[t]);
      if (!l) continue;
      traceVessel(ctx, vesselPoints(smooth(whiten(face.slices[t], stats), k), box, 0.35 + 0.65 * l));
      ctx.fillStyle = `rgba(${rgb}, ${(0.05 + 0.11 * l) * dim})`;
      ctx.fill();
    }
  }
  traceVessel(ctx, outline);
  if (dash) ctx.setLineDash(dash);
  if (glow) {
    ctx.shadowColor = `rgba(${rgb}, ${0.65 * dim})`;
    ctx.shadowBlur = glow;
  }
  ctx.strokeStyle = `rgba(${rgb}, ${dim})`;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
  return true;
}

/** The vessel's box in a `w × h` space, padded as the specimen pads it (6% of
 *  the shorter side). */
export function vesselBox(w, h) {
  const pad = Math.min(w, h) * 0.06;
  return { x: pad, y: pad, w: w - 2 * pad, h: h - 2 * pad };
}
