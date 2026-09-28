// The cards of EVOLVE: breeding sounds you like, drawn with the kit.
//
// - The title, over the bed, right after the cold open: the view's name, what
//   it is for, and the loop it runs on, drawn as the teaching meter's six
//   amber pips, one lighting on each word of the loop as the narrator says it
//   ("two", "pick", "reach", "breeds", "toward", "picks").
// - A chapter card at every turn: one bar of the bed over the chapter's own
//   footage (the turn beat borrows the chapter's shot, so it is already
//   running under the card), naming the chapter and the musical question it
//   answers. It lifts on the chapter's downbeat.
// - The outro: the next deep dive (TASTE) and where the guide keeps EVOLVE,
//   then a fade to the rack.
//
// Every time here comes from timeline.json (beats, lines, word times), never
// from typed seconds. Green is sound, amber is the model's mind.
import { el, place, clamp, lerp, ramp, E } from "../../stage/stage.js";
import { svgLayer, mark, textBlock, PHOS, GLOW } from "../../stage/kit.js";
import { wordTime } from "../../stage/walk.js";

/** The chapters: each turn beat, its number, its name and its question. */
export const TURNS = [
  { beat: "turn1", n: "01", name: "The duel", q: "How do I choose between two sounds?" },
  { beat: "turn2", n: "02", name: "Play it yourself", q: "How do I hear more than the phrase?" },
  { beat: "turn3", n: "03", name: "Point it", q: "How do I tell it what I'm after?" },
  { beat: "turn4", n: "04", name: "What a pick does", q: "What happens when I pick?" },
  { beat: "turn5", n: "05", name: "Fair questions", q: "Why these two?" },
  { beat: "turn6", n: "06", name: "A generation", q: "How does it grow new sounds?" },
  { beat: "turn7", n: "07", name: "Stars, save, cut", q: "How do I keep a sound, and what does that teach?" },
  { beat: "turn8", n: "08", name: "A working rhythm", q: "How does it fit into a session?" },
];

export function cards(stage) {
  const beat = (id) => stage.tl.beats.find((b) => b.id === id);
  sceneTitle(stage, beat);
  for (const c of TURNS) if (beat(c.beat)) sceneTurn(stage, beat, c);
  sceneOutro(stage, beat);
}

/** A darkening over the footage, strongest where the type sits. It stops
 *  above the caption line (walk.js sets captions at y 1048, under the
 *  footage's window), so the narration stays readable under a card. */
function scrim(layer, { top = 0.55, mid = 0.8, bottom = 0.55 } = {}) {
  const s = place(el("div", {}, layer), { x: 0, y: 0, w: 1920, h: 1022 });
  s.style.background = `linear-gradient(180deg, rgba(7,8,10,${top}) 0%, rgba(7,8,10,${mid}) 42%, rgba(7,8,10,${mid}) 62%, rgba(7,8,10,${bottom}) 100%)`;
  return s;
}

/** A row of teaching-meter pips, drawn: `lit(i)` in [0, 1] per pip. */
function pips(svg, { cx, cy, n = 6, r = 11, gap = 38 }) {
  const g = el("g", {}, svg);
  const x0 = cx - ((n - 1) * gap) / 2;
  const dots = Array.from({ length: n }, (_, i) => {
    const off = el("circle", { cx: x0 + i * gap, cy, r, fill: "#1a1410", stroke: "#0b0c0e", "stroke-width": 1.5 }, g);
    const onG = el("g", {}, g);
    onG.style.filter = GLOW.b;
    const on = el("circle", { cx: x0 + i * gap, cy, r, fill: PHOS.b, opacity: 0 }, onG);
    return { off, on };
  });
  return {
    g,
    update(lit) {
      dots.forEach((d, i) => d.on.setAttribute("opacity", clamp(lit(i)).toFixed(3)));
    },
  };
}

// ---------------------------------------------------------------------------
// TITLE — EVOLVE, what it is for, and the loop as six pips.

function sceneTitle(stage, beat) {
  const b = beat("title");
  if (!b) return;
  const l1 = stage.line("title1");
  const l2 = stage.line("title2");
  stage.scene({
    id: "card-title",
    t0: b.t0,
    t1: b.t1,
    z: 5,
    pre: 0.25,
    post: 0.25,
    fin: 0.6,
    fout: 0.5,
    build(layer) {
      const sc = scrim(layer, { top: 0.62, mid: 0.84, bottom: 0.62 });
      const svg = svgLayer(layer);
      const over = el("div", { class: "layer" }, layer);
      const eyebrow = textBlock(over, { x: 960, y: 262, w: 1400, cls: "eyebrow", size: 24, align: "center", ax: 0.5, ay: 0.5, text: "Auracle · the four views" });
      eyebrow.style.letterSpacing = "0.32em";
      const name = textBlock(over, { x: 960, y: 392, w: 1600, cls: "silk", size: 168, align: "center", ax: 0.5, ay: 0.5, text: "EVOLVE" });
      const sub = textBlock(over, { x: 960, y: 530, w: 1400, cls: "voice", size: 66, align: "center", ax: 0.5, ay: 0.5, text: "breeding sounds you like" });
      sub.style.color = "#d9d4c8";
      const meter = pips(svg, { cx: 960, cy: 660 });
      const tag = textBlock(over, { x: 960, y: 716, w: 1200, cls: "mono", size: 24, align: "center", ax: 0.5, ay: 0.5, text: "two sounds · one pick · a new generation" });
      tag.style.letterSpacing = "0.12em";
      // The pips light on the words that name the loop.
      const cues = [wordTime(l2, "two"), wordTime(l2, "pick"), wordTime(l2, "reach"), wordTime(l2, "breeds"), wordTime(l2, "toward"), wordTime(l2, "picks")];
      return (tl, t) => {
        sc.style.opacity = ramp(tl, -0.25, 0.5);
        eyebrow.style.opacity = ramp(tl, 0.1, 0.7);
        name.style.opacity = ramp(tl, 0.2, 1.1, E.out3);
        name.style.letterSpacing = `${lerp(0.34, 0.16, ramp(tl, 0.2, 1.6, E.out4))}em`;
        sub.style.opacity = ramp(tl, l1.t0 - b.t0 - 0.2, l1.t0 - b.t0 + 0.5, E.out3);
        meter.g.style.opacity = ramp(tl, l2.t0 - b.t0 - 0.6, l2.t0 - b.t0, E.out3);
        meter.update((i) => ramp(t, cues[i] - 0.05, cues[i] + 0.25, E.out3));
        tag.style.opacity = ramp(tl, l2.t0 - b.t0 - 0.4, l2.t0 - b.t0 + 0.3);
      };
    },
  });
}

// ---------------------------------------------------------------------------
// TURNS — a chapter card: one bar of the bed, lifting on the downbeat.

function sceneTurn(stage, beat, c) {
  const b = beat(c.beat);
  stage.scene({
    id: `card-${c.beat}`,
    t0: b.t0,
    t1: b.t1,
    z: 5,
    pre: 0.2,
    post: 0.5,
    fin: 0.35,
    fout: 0.45,
    build(layer) {
      const sc = scrim(layer, { top: 0.5, mid: 0.78, bottom: 0.5 });
      const svg = svgLayer(layer);
      const over = el("div", { class: "layer" }, layer);
      const num = textBlock(over, { x: 960, y: 372, w: 400, cls: "eyebrow", size: 30, align: "center", ax: 0.5, ay: 0.5, text: c.n });
      num.style.letterSpacing = "0.3em";
      const rule = el("line", { x1: 960, y1: 418, x2: 960, y2: 418, stroke: PHOS.a, "stroke-width": 2, opacity: 0.7 }, svg);
      const name = textBlock(over, { x: 960, y: 492, w: 1700, cls: "silk", size: 104, align: "center", ax: 0.5, ay: 0.5, text: c.name });
      const q = textBlock(over, { x: 960, y: 612, w: 1500, cls: "voice", size: 54, align: "center", ax: 0.5, ay: 0.5, text: c.q });
      q.style.color = "#9a958a";
      const T = b.t1 - b.t0;
      return (tl) => {
        sc.style.opacity = ramp(tl, -0.2, 0.3);
        num.style.opacity = ramp(tl, 0.0, 0.4);
        const w = 150 * ramp(tl, 0.1, 0.7, E.out3);
        rule.setAttribute("x1", (960 - w).toFixed(1));
        rule.setAttribute("x2", (960 + w).toFixed(1));
        name.style.opacity = ramp(tl, 0.05, 0.5, E.out3);
        name.style.letterSpacing = `${lerp(0.22, 0.12, ramp(tl, 0.05, 0.9, E.out4))}em`;
        q.style.opacity = ramp(tl, 0.35, 0.9, E.out3);
        q.style.transform = `translateY(${(1 - ramp(tl, 0.35, 0.9, E.out3)) * 10}px)`;
        // A slow drift, so the bar breathes.
        layer.style.transform = `scale(${lerp(1.0, 1.015, ramp(tl, 0, T + 0.5, E.lin))})`;
        layer.style.transformOrigin = "50% 50%";
      };
    },
  });
}

// ---------------------------------------------------------------------------
// OUTRO — next, TASTE; the guide's page; a fade to the rack.

function sceneOutro(stage, beat) {
  const b = beat("outro");
  if (!b) return;
  const l1 = stage.line("outro1");
  const l2 = stage.line("outro2");
  stage.scene({
    id: "card-outro",
    t0: b.t0,
    t1: b.t1,
    z: 5,
    pre: 0.2,
    post: 0.0,
    fin: 0.5,
    build(layer) {
      const sc = scrim(layer, { top: 0.35, mid: 0.8, bottom: 0.8 });
      const svg = svgLayer(layer);
      const over = el("div", { class: "layer" }, layer);
      const next = textBlock(over, { x: 960, y: 402, w: 1200, cls: "eyebrow b", size: 26, align: "center", ax: 0.5, ay: 0.5, text: "next · the fourth view" });
      next.style.letterSpacing = "0.3em";
      const name = textBlock(over, { x: 960, y: 510, w: 1600, cls: "silk", size: 132, align: "center", ax: 0.5, ay: 0.5, text: "TASTE" });
      const sub = textBlock(over, { x: 960, y: 628, w: 1400, cls: "voice", size: 58, align: "center", ax: 0.5, ay: 0.5, text: "what it learned about you" });
      const guide = el("div", { class: "pill a" }, over, "the guide  ·  views  ›  EVOLVE");
      place(guide, { x: 960, y: 772, ax: 0.5, ay: 0.5 });
      Object.assign(guide.style, { fontSize: "26px", padding: "14px 30px" });
      // The mark, small, above: the posterior contracting onto one taste.
      const mk = mark(svg, { cx: 960, cy: 300, size: 76 });
      const black = place(el("div", {}, layer), { x: 0, y: 0, w: 1920, h: 1080 });
      black.style.background = "#0c0d10";
      const T = b.t1 - b.t0;
      return (tl) => {
        sc.style.opacity = ramp(tl, -0.2, 0.5);
        mk.update({ tile: ramp(tl, 0.0, 0.6), outer: ramp(tl, 0.1, 0.9), inner: ramp(tl, 0.0, 0.7), core: E.outBack(ramp(tl, 0.0, 0.5, E.lin)) });
        next.style.opacity = ramp(tl, l1.t0 - b.t0 - 0.3, l1.t0 - b.t0 + 0.2);
        name.style.opacity = ramp(tl, wordTime(l1, "TASTE") - b.t0 - 0.35, wordTime(l1, "TASTE") - b.t0 + 0.35, E.out3);
        name.style.letterSpacing = `${lerp(0.3, 0.16, ramp(tl, wordTime(l1, "TASTE") - b.t0 - 0.35, wordTime(l1, "TASTE") - b.t0 + 1.0, E.out4))}em`;
        sub.style.opacity = ramp(tl, wordTime(l1, "TASTE") - b.t0 + 0.1, wordTime(l1, "TASTE") - b.t0 + 0.8, E.out3);
        const gu = ramp(tl, wordTime(l2, "guide") - b.t0 - 0.2, wordTime(l2, "guide") - b.t0 + 0.4, E.out3);
        guide.style.opacity = gu;
        guide.style.transform = `translateY(${(1 - gu) * 12}px)`;
        black.style.opacity = ramp(tl, T - 1.0, T, E.io2);
      };
    },
  });
}
