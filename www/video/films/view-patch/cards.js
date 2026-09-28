// The cards of PATCH: inside the sound, drawn with the kit.
//
// - The title, over the bed, right after the cold open: what PATCH is, and a
//   small circuit drawing itself (saws → filter → envelope, green, with an
//   amber LFO on the filter), so the picture says what the words say.
// - A chapter card at every turn: one bar of the bed, over the rack the
//   chapter is about to open on (its own shot's first frames, dimmed), naming
//   the chapter and the musical question it answers. It lifts on the
//   chapter's downbeat, onto the same frame, so the cut is invisible.
// - The outro: the five verbs of the film as the narrator says them, then the
//   next deep dive (EVOLVE) and where the guide keeps this view.
//
// Every time here comes from timeline.json (beats, lines, word times) and
// shots.json (each shot's `pre`), never from typed seconds.
import { el, place, clamp, lerp, ramp, fade, E, words, reveal } from "../../stage/stage.js";
import { svgLayer, plate, cable, mark, textBlock, PHOS } from "../../stage/kit.js";
import { wordTime } from "../../stage/walk.js";

/** The turns: a one-bar card before each chapter, over that chapter's shot. */
export const TURNS = [
  { id: "t-read", beat: "read", shot: "vp-read", n: "01", name: "Reading the circuit", q: "What am I looking at?" },
  { id: "t-hear", beat: "hear", shot: "vp-hear", n: "02", name: "Hearing it properly", q: "How do I really hear a patch?" },
  { id: "t-change", beat: "change", shot: "vp-change", n: "03", name: "Changing it", q: "How do I change it while I play?" },
  { id: "t-add", beat: "add", shot: "vp-add", n: "04", name: "Adding a module", q: "How do I add something new?" },
  { id: "t-move", beat: "move", shot: "vp-move", n: "05", name: "Modulation chains", q: "How do I make it move by itself?" },
  { id: "t-steps", beat: "steps", shot: "vp-steps", n: "06", name: "Steps", q: "How do I give the tone a rhythm?" },
  { id: "t-lock", beat: "lock", shot: "vp-lock", n: "07", name: "Locks and ⚡ evolve", q: "How do I keep what I love, and vary the rest?" },
  { id: "t-keep", beat: "keep", shot: "vp-keep", n: "08", name: "Commit", q: "How do I keep my version?" },
  { id: "t-take", beat: "take", shot: "vp-take", n: "09", name: "Taking it with you", q: "How do I take it with me?" },
  { id: "t-together", beat: "together", shot: "vp-together", n: "", name: "Putting it together", q: "Everything at once, the way you'd work." },
];

// Where walk.js puts the app (its default frame), so a card's rack sits
// exactly where the chapter's footage will be when the card lifts.
const F = { x: 120, y: 70, w: 1680, h: 945 };

export function cards(stage, defs) {
  const beat = (id) => stage.tl.beats.find((b) => b.id === id);
  sceneTitle(stage, beat);
  for (const c of TURNS) if (beat(c.id) && beat(c.beat)) sceneTurn(stage, beat, c, defs);
  sceneOutro(stage, beat);
}

/** The narration of a beat as a caption line, in walk.js's style and place,
 *  so a card and the walkthrough around it read as one film. */
function captions(stage, layer, beatId) {
  const cap = textBlock(layer, { x: 960, y: 1048, w: 1700, cls: "voice", size: 34, align: "center", ax: 0.5, ay: 0.5 });
  const lines = stage.tl.lines.filter((l) => l.beat === beatId);
  const spans = lines.map((l) => {
    const d = el("span", {}, cap);
    return { l, d, sp: words(d, l.text) };
  });
  return (t, end) => {
    spans.forEach(({ l, d, sp }, j) => {
      const nxt = spans[j + 1]?.l.t0 ?? end + 0.3;
      d.style.display = t >= l.t0 - 0.3 && t < nxt - 0.1 ? "" : "none";
      reveal(sp, t, l.t0, l.t1);
    });
  };
}

/** A recorded shot as a still-or-moving backdrop. The same box footage() in
 *  the kit draws, but it falls back to the shot's rehearsal screenshot while
 *  the shot is not recorded yet, so a card can be previewed before the
 *  recording exists (a missing clip would otherwise hold every seek). */
function backdrop(layer, film, shot) {
  const wrap = place(el("div", {}, layer), { x: F.x, y: F.y, w: F.w, h: F.h });
  Object.assign(wrap.style, {
    borderRadius: "14px",
    overflow: "hidden",
    background: "#07080a",
    boxShadow: "0 0 0 1px #292e36, 0 40px 90px rgba(0,0,0,.7), 0 0 60px rgba(142,240,177,.06)",
  });
  const v = el("video", { src: `../../out/${film}/shots/${shot}.webm`, poster: `../../out/${film}/dry/${shot}-00-start.jpg`, muted: "", playsinline: "", preload: "auto" }, wrap);
  v.muted = true;
  Object.assign(v.style, { width: "100%", height: "100%", objectFit: "cover", display: "block" });
  let ok = false;
  const ready = new Promise((res) => {
    if (v.readyState >= 2) return res((ok = true));
    v.addEventListener("loadeddata", () => res((ok = true)), { once: true });
    v.addEventListener("error", () => res(false), { once: true });
  });
  return {
    wrap,
    async seek(ct) {
      await ready;
      if (!ok) return;
      const tt = clamp(ct + 0.002, 0, (v.duration || 1e9) - 0.001);
      if (Math.abs(v.currentTime - tt) > 1e-4) {
        await new Promise((res) => {
          v.addEventListener("seeked", () => res(), { once: true });
          v.currentTime = tt;
        });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// TITLE — what PATCH is, over a circuit drawing itself.

function sceneTitle(stage, beat) {
  const b = beat("title");
  if (!b) return;
  stage.scene({
    id: "title",
    t0: b.t0,
    t1: b.t1,
    pre: 0.35,
    post: 0.3,
    fin: 0.5,
    fout: 0.3,
    build(layer) {
      const under = el("div", { class: "layer" }, layer);
      const svg = svgLayer(layer);
      const over = el("div", { class: "layer" }, layer);
      const eyebrow = textBlock(over, { x: 960, y: 196, w: 1400, cls: "eyebrow", size: 24, align: "center", ax: 0.5, ay: 0.5, text: "Auracle · the four views" });
      eyebrow.style.letterSpacing = "0.32em";
      const name = textBlock(over, { x: 960, y: 318, w: 1600, cls: "silk", size: 164, align: "center", ax: 0.5, ay: 0.5, text: "PATCH" });
      name.style.fontWeight = "500";
      const sub = textBlock(over, { x: 960, y: 452, w: 1400, cls: "voice", size: 64, align: "center", ax: 0.5, ay: 0.5, text: "inside the sound" });
      // The circuit: saws → filter → envelope, with an LFO on the cutoff.
      const Y = 590;
      const P = [
        plate(under, svg, { x: 330, y: Y, w: 330, h: 190, name: "SUPERSAW", knobs: 3, seed: 3 }),
        plate(under, svg, { x: 795, y: Y, w: 330, h: 190, name: "FILTER", kind: "cutoff · res", knobs: 2, seed: 5 }),
        plate(under, svg, { x: 1260, y: Y, w: 330, h: 190, name: "ENV / OUT", knobs: 4, seed: 8 }),
      ];
      const lfo = plate(under, svg, { x: 470, y: Y + 250, w: 200, h: 120, name: "LFO", knobs: 1, color: "b", seed: 2 });
      const green = [
        cable(svg, { p0: P[0].out, p1: P[1].in, sag: 26, color: "a", width: 5 }),
        cable(svg, { p0: P[1].out, p1: P[2].in, sag: 26, color: "a", width: 5 }),
      ];
      const amber = cable(svg, { p0: [lfo.out[0], lfo.out[1]], p1: [P[1].in[0] + 165, Y + 190], sag: 30, color: "b", width: 4 });
      const cut = P[1].knobs[0];
      const cap = captions(stage, over, "title");
      return (tl, t) => {
        // The rack assembles, left to right, then the cables run and flow.
        P.forEach((p, i) => (p.opacity = ramp(tl, -0.2 + i * 0.18, 0.5 + i * 0.18, E.out3)));
        lfo.opacity = ramp(tl, 0.5, 1.1, E.out3);
        green.forEach((c, i) => c.update(t, { draw: ramp(tl, 0.4 + i * 0.35, 1.2 + i * 0.35, E.io3), flow: ramp(tl, 1.6, 2.4) }));
        amber.update(t, { draw: ramp(tl, 1.1, 1.9, E.io3), flow: 0.6 * ramp(tl, 2.0, 2.6) });
        // The LFO sweeps the cutoff: the knob breathes at its rate.
        const sweep = 0.5 + 0.22 * Math.sin(2 * Math.PI * 0.5 * Math.max(0, tl - 1.9)) * ramp(tl, 1.9, 2.6);
        cut.k.set(sweep, { ghost: tl > 1.9 ? sweep : null });
        eyebrow.style.opacity = ramp(tl, 0.0, 0.6);
        name.style.opacity = ramp(tl, 0.2, 1.0, E.out3);
        name.style.letterSpacing = `${lerp(0.3, 0.14, ramp(tl, 0.2, 1.4, E.out4))}em`;
        sub.style.opacity = ramp(tl, 0.8, 1.6, E.out3);
        cap(t, b.t1);
        layer.style.transform = `scale(${lerp(1.0, 1.025, ramp(tl, 0, b.t1 - b.t0, E.lin))})`;
        layer.style.transformOrigin = "50% 45%";
      };
    },
  });
}

// ---------------------------------------------------------------------------
// TURNS — one bar of the bed, over the rack the chapter opens on.

function sceneTurn(stage, beat, c, defs) {
  const tb = beat(c.id);
  const cb = beat(c.beat);
  // The chapter's shot began recording `pre` seconds before its beat, and
  // walk.js shows it from there; the card shows the same clip, earlier.
  const pre = defs[c.shot]?.pre ?? 3.4;
  const origin = cb.t0 - pre;
  stage.scene({
    id: `turn-${c.id}`,
    t0: tb.t0,
    t1: cb.t0,
    pre: 0.25,
    post: 0.4,
    fin: 0.25,
    fout: 0.4,
    build(layer) {
      const clip = backdrop(layer, stage.tl.film, c.shot);
      const dim = place(el("div", {}, layer), { x: F.x, y: F.y, w: F.w, h: F.h });
      Object.assign(dim.style, { borderRadius: "14px", background: "linear-gradient(90deg, rgba(7,8,10,.9) 0%, rgba(7,8,10,.78) 55%, rgba(7,8,10,.55) 100%)" });
      const X = 250;
      const num = textBlock(layer, { x: X, y: 368, w: 900, cls: "eyebrow", size: 26, text: c.n ? `chapter ${c.n}` : "all together" });
      num.style.letterSpacing = "0.3em";
      const name = textBlock(layer, { x: X - 6, y: 408, w: 1500, cls: "display", size: 108, text: c.name });
      const rule = place(el("div", {}, layer), { x: X, y: 548, w: 0, h: 3 });
      Object.assign(rule.style, { background: PHOS.a, boxShadow: "0 0 14px rgba(142,240,177,.5)", borderRadius: "2px" });
      const q = textBlock(layer, { x: X, y: 580, w: 1400, cls: "voice", size: 54, text: c.q });
      q.style.color = "#b9b4a8";
      const len = cb.t0 - tb.t0;
      return (tl, t) => {
        stage.wait(clip.seek(Math.max(0, t - origin)));
        const u = ramp(tl, -0.1, 0.55, E.out3);
        num.style.opacity = u;
        name.style.opacity = ramp(tl, 0.05, 0.6, E.out3);
        name.style.transform = `translateY(${(1 - ramp(tl, 0.05, 0.7, E.out4)) * 18}px)`;
        rule.style.width = `${lerp(0, 220, ramp(tl, 0.25, 1.0, E.io3))}px`;
        q.style.opacity = ramp(tl, 0.45, 1.05, E.out3);
        q.style.transform = `translateY(${(1 - ramp(tl, 0.45, 1.15, E.out4)) * 12}px)`;
        // On the chapter's downbeat the dim lifts: the rack is the chapter.
        dim.style.opacity = (1 - ramp(tl, len - 0.15, len + 0.35, E.io2)).toFixed(3);
      };
    },
  });
}

// ---------------------------------------------------------------------------
// OUTRO — the film in five verbs, then the next deep dive.

const VERBS = ["read", "change", "grow", "protect", "keep"];

function sceneOutro(stage, beat) {
  const b = beat("outro");
  if (!b) return;
  const l1 = stage.line("outro1");
  const l2 = stage.line("outro2");
  stage.scene({
    id: "outro",
    t0: b.t0,
    t1: b.t1,
    pre: 0.4,
    post: 0.0,
    fin: 0.5,
    build(layer) {
      const svg = svgLayer(layer);
      const over = el("div", { class: "layer" }, layer);
      // The five verbs, lit as they are said.
      const row = place(el("div", {}, over), { x: 960, y: 330, ax: 0.5, ay: 0.5 });
      Object.assign(row.style, { display: "flex", gap: "22px" });
      const chips = VERBS.map((v) => {
        const p = el("div", { class: "pill a" }, row, v);
        Object.assign(p.style, { fontSize: "34px", padding: "16px 34px" });
        return { p, at: wordTime(l1, v) };
      });
      // Next: EVOLVE.
      const nextEye = textBlock(over, { x: 960, y: 470, w: 1200, cls: "eyebrow b", size: 26, align: "center", ax: 0.5, ay: 0.5, text: "next" });
      nextEye.style.letterSpacing = "0.34em";
      const next = textBlock(over, { x: 960, y: 560, w: 1600, cls: "silk", size: 118, align: "center", ax: 0.5, ay: 0.5, text: "EVOLVE" });
      const nextSub = textBlock(over, { x: 960, y: 668, w: 1400, cls: "voice", size: 56, align: "center", ax: 0.5, ay: 0.5, text: "breeding sounds you like" });
      const guide = el("div", { class: "pill" }, over, "the guide · Views › PATCH");
      place(guide, { x: 960, y: 790, ax: 0.5, ay: 0.5 });
      Object.assign(guide.style, { fontSize: "24px", padding: "12px 28px" });
      // The lockup, small, to sign off.
      const lock = place(el("div", { class: "lk" }, over), { x: 0, y: 0 });
      lock.style.fontSize = "40px";
      const wm = el("span", { class: "wm" }, lock, "AURACLE");
      const wmW = wm.getBoundingClientRect().width;
      const markPx = 1.28 * 40;
      const gap = 0.62 * 40;
      const left = 960 - (markPx + gap + wmW) / 2;
      const mk = mark(svg, { cx: left + markPx / 2, cy: 900, size: markPx });
      place(lock, { x: left + markPx + gap, y: 900, ay: 0.5 });
      const cap = captions(stage, over, "outro");
      return (tl, t) => {
        chips.forEach(({ p, at }) => {
          const u = ramp(t, at - 0.12, at + 0.25, E.out3);
          p.style.opacity = (0.18 + 0.82 * u).toFixed(3);
          p.style.transform = `translateY(${(1 - u) * 10}px)`;
          p.style.filter = u > 0.5 ? "drop-shadow(0 0 10px rgba(142,240,177,.35))" : "none";
        });
        // The verbs step back when the next film is named.
        row.style.opacity = (1 - 0.45 * ramp(t, l2.t0 - 0.3, l2.t0 + 0.4)).toFixed(3);
        const n = ramp(t, l2.t0 - 0.25, l2.t0 + 0.45, E.out3);
        nextEye.style.opacity = n;
        next.style.opacity = n;
        next.style.letterSpacing = `${lerp(0.3, 0.14, ramp(t, l2.t0 - 0.25, l2.t0 + 0.9, E.out4))}em`;
        nextSub.style.opacity = ramp(t, l2.t0 + 0.2, l2.t0 + 0.9, E.out3);
        guide.style.opacity = ramp(t, l2.t1, l2.t1 + 0.6, E.out3);
        const s = ramp(t, l2.t1 + 0.3, l2.t1 + 1.1, E.out3);
        mk.update({ tile: s, outer: s, inner: s, core: s });
        lock.style.opacity = s;
        cap(t, b.t1);
        // The very end fades out.
        layer.style.opacity = (1 - ramp(tl, b.t1 - b.t0 - 0.9, b.t1 - b.t0, E.io2)).toFixed(3);
      };
    },
  });
}
