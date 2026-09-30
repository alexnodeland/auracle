// The cards of PATCH: inside the sound, drawn with the kit over the footage.
//
// Every card beat borrows a recorded shot (film.js), so the real rack is
// always under the card: the title runs on over the cold open's acid line,
// a chapter's turn over the rack the chapter opens on (its shot starts a bar
// early), the outro over the acid line just committed. A card is a veil over
// that footage's window, and type:
// - The title: PATCH, what it is for, and one cable patching itself as the
//   narrator says "One patch", its signal flowing on "playable".
// - A chapter card at every turn: the chapter's number and name, the musical
//   question it answers, and where it sits among the nine, as a row of small
//   plates. The veil lifts on the chapter's downbeat, onto the same frame.
// - The outro: the film's five verbs, lit as they are said, then the next
//   deep dive (EVOLVE) and where the guide keeps PATCH; then black.
//
// walk.js draws the captions (under the footage's window, below the veil).
// Every time here comes from timeline.json (beats, lines, word times), never
// from typed seconds. Green is sound, amber is the model's mind.
import { el, place, lerp, ramp, E, words, reveal } from "../../stage/stage.js";
import { svgLayer, cable, mark, textBlock, PHOS, PHOS_DEEP, ink, inkA } from "../../stage/kit.js";
import { wordTime } from "../../stage/walk.js";

/** The turns: a one-bar card before each chapter. */
export const TURNS = [
  { id: "t-read", beat: "read", n: 1, name: "Reading the circuit", q: "What am I looking at?" },
  { id: "t-hear", beat: "hear", n: 2, name: "Hearing it properly", q: "How do I really hear a patch?" },
  { id: "t-change", beat: "change", n: 3, name: "Changing it", q: "How do I change it while I play?" },
  { id: "t-add", beat: "add", n: 4, name: "Adding a module", q: "How do I add something new?" },
  { id: "t-move", beat: "move", n: 5, name: "Modulation chains", q: "How do I make it move by itself?" },
  { id: "t-steps", beat: "steps", n: 6, name: "Steps", q: "How do I give the tone a rhythm?" },
  { id: "t-lock", beat: "lock", n: 7, name: "Locks and ⚡ evolve", q: "How do I keep what I love, and vary the rest?" },
  { id: "t-keep", beat: "keep", n: 8, name: "Commit", q: "How do I keep my version?" },
  { id: "t-take", beat: "take", n: 9, name: "Taking it with you", q: "How do I take it with me?" },
  { id: "t-together", beat: "together", n: 0, name: "Putting it together", q: "Everything at once, the way you'd work." },
];
const COUNT = TURNS.filter((c) => c.n).length;

// Above the walkthrough's scenes (z 0), below the grain.
const Z = 6;

export function cards(stage) {
  const beat = (id) => stage.tl.beats.find((b) => b.id === id);
  // The veil runs unbroken from the title through the first chapter card,
  // so the two cards trade type over one darkening, not two.
  veilScene(stage, "title", beat("title"), beat("read"), { pre: 0.5, a: 0.64 });
  for (const c of TURNS) if (c.id !== "t-read" && beat(c.id) && beat(c.beat)) veilScene(stage, c.id, beat(c.id), beat(c.beat), { pre: 0.25, a: 0.62 });
  sceneTitle(stage, beat);
  for (const c of TURNS) if (beat(c.id) && beat(c.beat)) sceneTurn(stage, beat, c);
  sceneOutro(stage, beat);
}

/** A veil over the footage's window only (walk.js's frame): it darkens and
 *  softens the instrument, so the words lead and the rack is still there;
 *  the captions below the window stay as they are. */
function veil(layer, { a = 0.62, blur = 5 } = {}) {
  const v = place(el("div", {}, layer), { x: 120, y: 70, w: 1680, h: 945 });
  v.style.borderRadius = "14px";
  v.style.background = `radial-gradient(120% 95% at 32% 50%, ${inkA("--bezel", a)} 0%, ${inkA("--bezel", Math.min(0.92, a + 0.18))} 100%)`;
  v.style.backdropFilter = `blur(${blur}px) saturate(0.85)`;
  return v;
}

/** A veil from card beat `b` to the downbeat of `until`, where it lifts. */
function veilScene(stage, id, b, until, { pre, a }) {
  stage.scene({
    id: `veil-${id}`,
    t0: b.t0,
    t1: until.t0,
    pre,
    post: 0.45,
    fin: pre,
    fout: 0.45,
    z: Z,
    build(layer) {
      veil(layer, { a });
      return () => {};
    },
  });
}

// ---------------------------------------------------------------------------
// TITLE — what PATCH is, and one cable patching itself.

function sceneTitle(stage, beat) {
  const b = beat("title");
  const next = beat("t-read");
  if (!b || !next) return;
  const l1 = stage.line("title1");
  const l2 = stage.line("title2");
  stage.scene({
    id: "card-title",
    t0: b.t0,
    t1: next.t0,
    pre: 0.3,
    post: 0.2,
    fin: 0.3,
    fout: 0.4,
    z: Z + 1,
    build(layer) {
      const svg = svgLayer(layer);
      const over = el("div", { class: "layer" }, layer);
      const eyebrow = textBlock(over, { x: 960, y: 250, w: 1400, cls: "eyebrow", size: 24, align: "center", ax: 0.5, ay: 0.5, text: "Auracle · the four views, in depth" });
      eyebrow.style.letterSpacing = "0.32em";
      const name = textBlock(over, { x: 960, y: 372, w: 1600, cls: "silk", size: 168, align: "center", ax: 0.5, ay: 0.5, text: "PATCH" });
      name.style.textShadow = `0 0 40px ${inkA("--phos-a", 0.18)}`;
      const sub = textBlock(over, { x: 960, y: 505, w: 1400, cls: "voice", size: 64, align: "center", ax: 0.5, ay: 0.5, text: "inside the sound" });
      sub.style.color = ink("--silk");
      // One cable, out → in: a patch at its smallest (the kit draws its jacks).
      const wire = cable(svg, { p0: [690, 640], p1: [1230, 640], sag: 46, color: "a", width: 5 });
      const tags = [
        textBlock(over, { x: 690, y: 690, w: 200, cls: "mono", size: 20, align: "center", ax: 0.5, ay: 0.5, text: "out" }),
        textBlock(over, { x: 1230, y: 690, w: 200, cls: "mono", size: 20, align: "center", ax: 0.5, ay: 0.5, text: "in" }),
      ];
      tags.forEach((x) => (x.style.color = PHOS.a));
      const tOne = wordTime(l2, "One");
      const tFull = wordTime(l2, "full");
      const tPlay = wordTime(l2, "playable");
      return (tl, t) => {
        const u = ramp(tl, -0.3, 0.9, E.out4);
        name.style.opacity = u;
        name.style.letterSpacing = `${lerp(0.34, 0.14, u)}em`;
        eyebrow.style.opacity = ramp(tl, 0.1, 0.8, E.io2);
        sub.style.opacity = ramp(t, l1.t0 - 0.1, l1.t0 + 0.6, E.out3);
        sub.style.transform = `translateY(${(1 - ramp(t, l1.t0 - 0.1, l1.t0 + 0.7, E.out3)) * 12}px)`;
        const j = ramp(t, tOne - 0.35, tOne, E.out3);
        tags[0].style.opacity = 0.8 * j;
        const d = ramp(t, tOne, tFull + 0.2, E.io3);
        wire.update(t, { draw: d, flow: ramp(t, tPlay - 0.1, tPlay + 0.5), opacity: j });
        tags[1].style.opacity = 0.8 * ramp(t, tFull, tFull + 0.3);
      };
    },
  });
}

// ---------------------------------------------------------------------------
// TURNS — one bar of the bed, over the rack the chapter opens on.

function sceneTurn(stage, beat, c) {
  const b = beat(c.id);
  const d = beat(c.beat);
  stage.scene({
    id: `card-${c.id}`,
    t0: b.t0,
    t1: d.t0,
    pre: 0.2,
    post: 0.4,
    fin: 0.2,
    fout: 0.4,
    z: Z + 1,
    build(layer) {
      const X = 250;
      const num = textBlock(layer, { x: X, y: 372, w: 900, cls: "eyebrow", size: 26, text: c.n ? `chapter ${String(c.n).padStart(2, "0")}` : "all together" });
      num.style.letterSpacing = "0.3em";
      const name = textBlock(layer, { x: X - 6, y: 410, w: 1500, cls: "display", size: 108, text: c.name });
      const rule = place(el("div", {}, layer), { x: X, y: 552, w: 0, h: 3 });
      Object.assign(rule.style, { background: PHOS.a, boxShadow: `0 0 14px ${inkA("--phos-a", 0.5)}`, borderRadius: "2px" });
      const q = textBlock(layer, { x: X, y: 584, w: 1400, cls: "voice", size: 54 });
      q.style.color = ink("--silk");
      const qs = words(q, c.q);
      // Where this chapter sits among the nine: a row of small plates, as a
      // rack reads, this one lit.
      const plates = [];
      if (c.n) {
        for (let i = 1; i <= COUNT; i++) {
          const p = place(el("div", {}, layer), { x: X + (i - 1) * 44, y: 700, w: 34, h: 18 });
          p.style.borderRadius = "4px";
          p.style.background = i === c.n ? PHOS.a : i < c.n ? PHOS_DEEP.a : ink("--plate-off");
          p.style.border = `1px solid ${i === c.n ? PHOS.a : ink("--plate-off-edge")}`;
          if (i === c.n) p.style.boxShadow = `0 0 12px ${inkA("--phos-a", 0.7)}`;
          plates.push(p);
        }
      }
      const len = d.t0 - b.t0;
      return (tl, t) => {
        num.style.opacity = ramp(tl, -0.15, 0.45, E.out3);
        name.style.opacity = ramp(tl, -0.05, 0.55, E.out3);
        name.style.transform = `translateY(${(1 - ramp(tl, -0.05, 0.65, E.out4)) * 18}px)`;
        rule.style.width = `${Math.round(220 * ramp(tl, 0.15, 0.9, E.io3))}px`;
        q.style.opacity = ramp(tl, 0.3, 0.7, E.io2);
        reveal(qs, t, b.t0 + 0.4, b.t0 + Math.min(1.7, len * 0.6));
        plates.forEach((p, i) => (p.style.opacity = ramp(tl, 0.35 + i * 0.04, 0.75 + i * 0.04, E.io2).toFixed(3)));
        // A slow drift, so the bar breathes.
        layer.style.transform = `scale(${lerp(1.0, 1.012, ramp(tl, 0, len + 0.4, E.lin))})`;
        layer.style.transformOrigin = "30% 50%";
      };
    },
  });
}

// ---------------------------------------------------------------------------
// OUTRO — the film in five verbs, then the next deep dive; then black.

const VERBS = ["read", "change", "grow", "protect", "keep"];

function sceneOutro(stage, beat) {
  const b = beat("outro");
  if (!b) return;
  const l1 = stage.line("outro1");
  const l2 = stage.line("outro2");
  stage.scene({
    id: "card-outro",
    t0: b.t0,
    t1: b.t1,
    pre: 0.5,
    post: 0.6,
    fin: 0.5,
    z: Z,
    build(layer) {
      veil(layer, { a: 0.66, blur: 6 });
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
      // Next: EVOLVE, and where the guide keeps PATCH.
      const nextEye = textBlock(over, { x: 960, y: 474, w: 1200, cls: "eyebrow b", size: 26, align: "center", ax: 0.5, ay: 0.5, text: "next, in depth" });
      nextEye.style.letterSpacing = "0.34em";
      const next = textBlock(over, { x: 960, y: 566, w: 1600, cls: "silk", size: 118, align: "center", ax: 0.5, ay: 0.5, text: "EVOLVE" });
      const nextSub = textBlock(over, { x: 960, y: 674, w: 1400, cls: "voice", size: 56, align: "center", ax: 0.5, ay: 0.5, text: "breeding sounds you like" });
      nextSub.style.color = ink("--silk");
      const guide = el("div", { class: "pill" }, over, "the guide · The instrument › PATCH");
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
      // Black over everything, captions too, for the last second.
      const black = place(el("div", {}, layer), { x: 0, y: 0, w: 1920, h: 1080 });
      black.style.background = ink("--rack");
      const T = b.t1 - b.t0;
      return (tl, t) => {
        chips.forEach(({ p, at }) => {
          const u = ramp(t, at - 0.12, at + 0.25, E.out3);
          p.style.opacity = (0.18 + 0.82 * u).toFixed(3);
          p.style.transform = `translateY(${(1 - u) * 10}px)`;
          p.style.filter = u > 0.5 ? `drop-shadow(0 0 10px ${inkA("--phos-a", 0.35)})` : "none";
        });
        row.style.opacity = (ramp(tl, -0.4, 0.2) * (1 - 0.45 * ramp(t, l2.t0 - 0.3, l2.t0 + 0.4))).toFixed(3);
        const n = ramp(t, l2.t0 - 0.25, l2.t0 + 0.45, E.out3);
        nextEye.style.opacity = n;
        next.style.opacity = n;
        next.style.letterSpacing = `${lerp(0.3, 0.14, ramp(t, l2.t0 - 0.25, l2.t0 + 0.9, E.out4))}em`;
        nextSub.style.opacity = ramp(t, wordTime(l2, "breeding") - 0.15, wordTime(l2, "breeding") + 0.5, E.out3);
        const g = ramp(t, l2.t1 + 0.1, l2.t1 + 0.7, E.out3);
        guide.style.opacity = g;
        guide.style.transform = `translateY(${(1 - g) * 10}px)`;
        const s = ramp(t, l2.t1 + 0.4, l2.t1 + 1.2, E.out3);
        mk.update({ tile: s, outer: s, inner: s, core: s });
        lock.style.opacity = s;
        black.style.opacity = ramp(tl, T - 0.9, T + 0.1, E.io2).toFixed(3);
      };
    },
  });
}
