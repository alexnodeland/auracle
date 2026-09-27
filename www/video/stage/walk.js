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

/** Resolve "lineId:word" or a number (seconds from the beat start) to film time. */
export function at(stage, beat, spec) {
  if (typeof spec === "number") return beat.t0 + spec;
  const [id, w] = spec.split(":");
  const l = stage.line(id);
  return w ? wordTime(l, w) : l.t0;
}

/**
 * plan: [{
 *   beat, shot, chapter,
 *   frame: {x, y, w, h}            // where the app sits (default: a window, centred)
 *   cam: [[at, z, fx, fy], …]      // zoom about (fx, fy) in [0,1] of the app
 *   callouts: [{at, until?, x, y, tx, ty, text, color}]   // in app pixels (1920×1080)
 * }]
 */
export function walkthrough(stage, { plan, shots = "shots", captions = true }) {
  const beats = plan.map((p) => ({ ...p, b: stage.tl.beats.find((b) => b.id === p.beat) }));
  beats.forEach((p, i) => {
    const b = p.b;
    const next = beats[i + 1]?.b;
    const meta = p.meta || {};
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
        const cs = (p.callouts || []).map((c) =>
          ({ c, api: callout(layer, svg, { x: F.x + c.x * s, y: F.y + c.y * s, tx: F.x + c.tx * s, ty: F.y + c.ty * s, text: c.text, color: c.color || "a" }) }),
        );
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
        return (tl, t) => {
          const k = cam.length > 1 ? keys(t, cam.map(([tt, z, fx, fy]) => [tt, [z, fx, fy], E.io3])) : [cam[0][1], cam[0][2], cam[0][3]];
          stage.wait(clip.seek(t - origin, { z: k[0], fx: k[1], fy: k[2] }));
          cs.forEach(({ c, api }) => {
            const a0 = at(stage, b, c.at);
            const a1 = c.until != null ? at(stage, b, c.until) : b.t1;
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
