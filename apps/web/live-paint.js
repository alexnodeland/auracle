// A live face's layer, painted: the canvas calls of one frame of a trace
// (live-face.js decides what each frame draws; this only draws it), for
// stage mode, the face in flight between the levels and every inline live
// face. Kept apart from the deciding, and importing nothing, so the same
// calls can be made on a canvas of any thread's.

/** The path of points made by live-face.js `pointsInto` (`m` of them), joined
 *  as vessel.js `traceVessel` joins them: quadratic curves through their
 *  midpoints. */
export function tracePoints(ctx, p, m) {
  ctx.beginPath();
  ctx.moveTo((p[2 * (m - 1)] + p[0]) / 2, (p[2 * (m - 1) + 1] + p[1]) / 2);
  for (let i = 0; i < m; i++) {
    const k = (i + 1) % m;
    ctx.quadraticCurveTo(p[2 * i], p[2 * i + 1], (p[2 * i] + p[2 * k]) / 2, (p[2 * i + 1] + p[2 * k + 1]) / 2);
  }
  ctx.closePath();
}

/** The whole canvas cleared, whatever its transform. */
export function clearAll(ctx) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

/** What a frame of the trail's fade does (live-face.js `traceFadeStep`):
 *  nothing, a frame of the phosphor's fade, or the canvas cleared. */
export const FADE_NONE = 0;
export const FADE_STEP = 1;
export const FADE_CLEAR = 2;

/** A frame of the trail's fade: `step` over `x, y, w, h` (the canvas's own
 *  units), `style` the fade's color at its alpha (`destination-out`). */
export function paintFade(ctx, step, x, y, w, h, style) {
  if (step === FADE_CLEAR) clearAll(ctx);
  else if (step === FADE_STEP) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = style;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
}

/** The first `n` of `strokes` (live-face.js `traceStrokes`), each an outline
 *  (`pts`, made by `pointsInto`) stroked in `style` at `width`, glowing in
 *  `shadow` at `blur`. */
export function paintStrokes(ctx, strokes, n) {
  ctx.save();
  for (let i = 0; i < n; i++) {
    const s = strokes[i];
    tracePoints(ctx, s.pts, s.pts.length / 2);
    ctx.strokeStyle = s.style;
    ctx.lineWidth = s.width;
    ctx.shadowColor = s.shadow;
    ctx.shadowBlur = s.blur;
    ctx.stroke();
  }
  ctx.restore();
}

/** One face's frame on its canvas `cv` (`g` its context), as live-face.js
 *  makes it: `size` the canvas's new size in px, or null; `k` the device
 *  pixels to a CSS px (0 for a layer wiped, which keeps its transform); the
 *  fade (`fade`, over `rect`, in `fadeStyle`); and `n` of `strokes`. */
export function paintLayer(cv, g, op) {
  if (op.size) {
    cv.width = op.size[0];
    cv.height = op.size[1];
  }
  if (op.k) g.setTransform(op.k, 0, 0, op.k, 0, 0);
  const r = op.rect;
  paintFade(g, op.fade, r[0], r[1], r[2], r[3], op.fadeStyle);
  if (op.n) paintStrokes(g, op.strokes, op.n);
}
