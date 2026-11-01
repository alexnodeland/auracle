// A live face's layer, painted: the canvas calls of one frame of a trace
// (live-face.js decides what each frame draws; this only draws it). The same
// calls run on the page (stage mode, the face in flight between the levels,
// and every inline face where there is no worker) and in a worker of their
// own, which paints every inline live face on a canvas of its own and answers
// each frame with a picture of each layer it painted, which the page shows
// as it is: the same pixels as the frame painted on the page.
//
// Why a worker: the trace's two outlines glow (`shadowBlur`), and a browser
// that draws a canvas on the CPU (Firefox, and any browser without a GPU)
// blurs them on the thread that asks. On the main thread that was 2 ms of
// every frame a key sounded at PERFORM, 7 ms on a Retina screen (Firefox on
// an M3 Max, #512): the time a note-on, a knob's write and a pointer move
// waited behind. In the worker the page's part of a frame is what is heard
// and where, a message, and showing the pictures.
//
// Imports nothing, so the worker loads it under the build's stamp alone (a
// worker has no import map: a bare `./faces.js` there would be a second copy
// fetched with no stamp).

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

/** A frame from the page, in the worker: each face's frame (`faces`: `{id,
 *  …paintLayer's op}`) on the layer of that id, made by `make()` the first
 *  time it is painted. Returns the ids of the layers painted, once each. */
export function paintFrame(layers, m, make) {
  const painted = [];
  for (const op of m.faces) {
    let l = layers.get(op.id);
    if (!l) {
      const cv = make();
      l = { cv, g: cv.getContext("2d") };
      layers.set(op.id, l);
    }
    paintLayer(l.cv, l.g, op);
    if (!painted.includes(op.id)) painted.push(op.id);
  }
  return painted;
}

// Run as a worker: every frame the page sends is painted, and answered with
// a picture of each layer painted (none for a layer of no size), and the
// time it took on this thread. The page sends the next frame once this one
// is answered. A frame that fails says so (`failed`), as one that throws
// while it paints does (the page's `error`): the page then paints its faces
// itself.
if (typeof DedicatedWorkerGlobalScope !== "undefined" && self instanceof DedicatedWorkerGlobalScope) {
  const layers = new Map();
  const make = () => new OffscreenCanvas(1, 1);
  self.onmessage = (e) => {
    const t0 = performance.now();
    const frame = e.data.frame;
    const ids = paintFrame(layers, e.data, make);
    Promise.all(
      ids.map((id) => {
        const cv = layers.get(id).cv;
        return cv.width && cv.height ? createImageBitmap(cv) : null;
      }),
    ).then(
      (pictures) => {
        const ms = performance.now() - t0;
        self.postMessage({ frame, ms, layers: ids.map((id, i) => ({ id, bitmap: pictures[i] })) }, pictures.filter(Boolean));
      },
      (err) => self.postMessage({ frame, failed: String(err) }),
    );
  };
}
