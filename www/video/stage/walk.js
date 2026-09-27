// Walkthroughs: the real instrument on screen, narrated.
//
// A walkthrough film is a list of beats, each played over one recorded shot
// (tools/footage.mjs). The clip is placed so that its actions land on the
// words that name them, then framed: a slow camera (zoom and pan keyframes),
// callouts that draw a leader to the thing being named, and a chapter label.
// Nothing here is drawn over the product except what points at it.

import { el, place, clamp, lerp, ramp, fade, keys, E, words, reveal } from "./stage.js";
import { svgLayer, footage, callout, textBlock } from "./kit.js";

/** When the narrator reaches `word` in line `l` (word times if present). */
export function wordTime(l, word) {
  const i = l.text.toLowerCase().indexOf(word.toLowerCase());
  if (i < 0) return l.t0;
  if (l.words) {
    const idx = l.text.slice(0, i).split(/\s+/).filter(Boolean).length;
    return l.words[Math.min(idx, l.words.length - 1)];
  }
  return l.t0 + ((l.t1 - l.t0) * i) / l.text.length;
}

/** Resolve "lineId:word" or a number (seconds from the beat start) to film
 *  time, with an optional offset in seconds ("offer1:Press+0.4"). */
export function at(stage, beat, spec) {
  if (typeof spec === "number") return beat.t0 + spec;
  const off = /([+-]\d+(?:\.\d+)?)$/.exec(spec);
  if (off) return at(stage, beat, spec.slice(0, off.index)) + Number(off[1]);
  const [id, w] = spec.split(":");
  const l = stage.line(id);
  return w ? wordTime(l, w) : l.t0;
}

/** A point on a recorded element: its centre, or the middle of one side. */
function anchor(r, side) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  switch (side) {
    case "top": return [cx, r.y];
    case "bottom": return [cx, r.y + r.h];
    case "left": return [r.x, cy];
    case "right": return [r.x + r.w, cy];
    default: return [cx, cy];
  }
}

/** A callout's point and label position, in app pixels: typed (`x, y, tx,
 *  ty`), or pinned to a mark footage.mjs measured (`mark, side, dx, dy`). */
function place_(c, meta) {
  const r = c.mark && meta.rects && meta.rects[c.mark];
  if (!r) return c;
  const [x, y] = anchor(r, c.side);
  const px = x + (c.ox || 0);
  const py = y + (c.oy || 0);
  return { ...c, x: px, y: py, tx: px + (c.dx ?? 0), ty: py + (c.dy ?? -90) };
}

/**
 * plan: [{
 *   beat, shot, chapter,
 *   frame: {x, y, w, h}            // where the app sits (default: a window, centred)
 *   cam: [[at, z, fx, fy], …]      // zoom about (fx, fy) in [0,1] of the app
 *   callouts: [{at, until?, text, color,
 *                x, y, tx, ty       // in app pixels (1920×1080), or
 *                mark, side, dx, dy // pinned to an element footage.mjs measured
 *              }]
 * }]
 *
 * Async: it reads each shot's sidecar (out/FILM/shots/ID.json) for the marks,
 * so a film's build must await it.
 */
export async function walkthrough(stage, { plan, shots = "shots", captions = true }) {
  const metas = {};
  await Promise.all(
    [...new Set(plan.map((p) => p.shot))].map(async (id) => {
      try {
        const r = await fetch(`../../out/${stage.tl.film}/${shots}/${id}.json`, { cache: "no-store" });
        if (r.ok) metas[id] = await r.json();
      } catch {
        /* a shot not recorded yet draws its callouts where they were typed */
      }
    }),
  );
  const beats = plan.map((p) => ({ ...p, b: stage.tl.beats.find((b) => b.id === p.beat) }));
  beats.forEach((p, i) => {
    const b = p.b;
    const next = beats[i + 1]?.b;
    const meta = { ...(metas[p.shot] || {}), ...(p.meta || {}) };
    stage.scene({
      id: `walk-${p.beat}`,
      t0: b.t0,
      t1: b.t1,
      pre: 0.25,
      post: next ? 0.25 : 0.6,
      fin: 0.25,
      fout: 0.25,
      build(layer) {
        const F = p.frame || { x: 120, y: 70, w: 1680, h: 945 };
        const clip = footage(layer, { src: `../../out/${stage.tl.film}/${shots}/${p.shot}.webm`, ...F });
        const s = F.w / 1920;
        const svg = svgLayer(layer);
        // A callout pinned to a mark its shot has not measured (not recorded
        // yet, or the element was missing) has nowhere to point: it is left
        // out rather than drawn at NaN.
        const cs = (p.callouts || [])
          .map((c0) => place_(c0, meta))
          .filter((c) => [c.x, c.y, c.tx, c.ty].every(Number.isFinite))
          .map((c) => ({ c, api: callout(layer, svg, { x: F.x + c.x * s, y: F.y + c.y * s, tx: F.x + c.tx * s, ty: F.y + c.ty * s, text: c.text, color: c.color || "a" }) }));
        let chap = null;
        if (p.chapter) {
          chap = place(el("div", { class: "eyebrow" }, layer, p.chapter), { x: F.x, y: F.y - 44 });
          chap.style.fontSize = "20px";
        }
        const cap = captions ? textBlock(layer, { x: 960, y: 1048, w: 1700, cls: "voice", size: 34, align: "center", ax: 0.5, ay: 0.5 }) : null;
        const lines = stage.tl.lines.filter((l) => l.beat === p.beat);
        const spans = cap ? lines.map((l) => {
          const d = el("span", {}, cap);
          return { l, d, sp: words(d, l.text) };
        }) : [];
        // The shot started `pre` seconds before its beat (footage.mjs).
        const origin = b.t0 - (meta.pre ?? p.pre ?? 1.0);
        const cam = (p.cam || [[0, 1, 0.5, 0.5]]).map(([a, z, fx, fy]) => [at(stage, b, a), z, fx, fy]);
        // A point in the recorded app (1920×1080 px) as it sits on screen
        // under the camera: footage() scales the clip by z about (fx, fy).
        const onScreen = (x, y, z, fx, fy) => [
          F.x - fx * (z - 1) * F.w + z * x * s,
          F.y - fy * (z - 1) * F.h + z * y * s,
        ];
        return (tl, t) => {
          const k = cam.length > 1 ? keys(t, cam.map(([tt, z, fx, fy]) => [tt, [z, fx, fy], E.io3])) : [cam[0][1], cam[0][2], cam[0][3]];
          stage.wait(clip.seek(t - origin, { z: k[0], fx: k[1], fy: k[2] }));
          cs.forEach(({ c, api }) => {
            const a0 = at(stage, b, c.at);
            const a1 = c.until != null ? at(stage, b, c.until) : b.t1;
            // The point rides the camera; the label keeps its offset from it,
            // so a zoom never leaves an arrow pointing at the wrong control.
            const [px, py] = onScreen(c.x, c.y, k[0], k[1], k[2]);
            api.move(px, py, px + (c.tx - c.x) * s, py + (c.ty - c.y) * s);
            api.update(ramp(t, a0, a0 + 0.6, E.io2) * (1 - ramp(t, a1 - 0.3, a1, E.io2)));
          });
          if (chap) chap.style.opacity = fade(t, b.t0, b.t0 + 0.4, b.t1 - 0.4, b.t1);
          spans.forEach(({ l, d, sp }, j) => {
            const nxt = spans[j + 1]?.l.t0 ?? b.t1 + 0.3;
            d.style.display = t >= l.t0 - 0.3 && t < nxt - 0.1 ? "" : "none";
            reveal(sp, t, l.t0, l.t1);
          });
          void tl;
        };
      },
    });
  });
}
