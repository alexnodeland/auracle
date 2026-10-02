// The math: for people who read the reference for fun. Every picture is a
// diagram of something the reference documents and the code computes, and
// every number on screen carries the name of the constant it comes from, so a
// viewer can grep for it. Green is sound; amber is the model's mind, which is
// most of this film.

import { el, place, clamp, lerp, ramp, fade, E, rng, words, reveal } from "../../stage/stage.js";
import { svgLayer, mark, textBlock, voiceWave, scope, knob, PHOS, PHOS_DIM, PHOS_DEEP, GLOW, ink, inkA } from "../../stage/kit.js";

export async function build(stage) {
  const beat = (id) => stage.tl.beats.find((b) => b.id === id);
  const line = (id) => stage.line(id);
  const ctx = { stage, beat, line };
  // Formulas: indices and exponents set small and tight, as in print, so
  // `θ<sub>k</sub>` reads as one symbol and an exponent does not open a gap.
  el("style", {}, document.head).textContent =
    "#frame sub, #frame sup { font-size: 0.64em; line-height: 0; }" +
    "#frame sup { vertical-align: 0.62em; } #frame sub { vertical-align: -0.28em; }";
  sceneIntro(ctx);
  sceneUtility(ctx);
  sceneLikelihoods(ctx);
  scenePosterior(ctx);
  sceneCalibration(ctx);
  sceneAcquisition(ctx);
  sceneTarget(ctx);
  sceneRefine(ctx);
  sceneLocks(ctx);
  scenePerform(ctx);
  sceneOutro(ctx);
}

// ---- materials ------------------------------------------------------------

const A = PHOS.a;
const B = PHOS.b;
const A_DIM = PHOS_DIM.a;
const B_DIM = PHOS_DIM.b;
const A_DEEP = PHOS_DEEP.a;
const B_DEEP = PHOS_DEEP.b;
const SILK = ink("--silk");
const DIM = ink("--silk-dim");
const MUTE = ink("--silk-mute");
const HAIR = ink("--hairline");
const PANEL = ink("--panel");
const INK = ink("--rack");
const sig = (v) => 1 / (1 + Math.exp(-v));

const glowCss = (c, k = 1) =>
  c === "a"
    ? `drop-shadow(0 0 ${(2.5 * k).toFixed(2)}px ${inkA("--phos-a", 0.95)}) drop-shadow(0 0 ${(12 * k).toFixed(2)}px ${inkA("--phos-a", 0.38)})`
    : `drop-shadow(0 0 ${(2.5 * k).toFixed(2)}px ${inkA("--phos-b", 0.95)}) drop-shadow(0 0 ${(14 * k).toFixed(2)}px ${inkA("--phos-b", 0.42)})`;
const textGlow = (c, k = 1) =>
  c === "a" ? `0 0 ${(18 * k).toFixed(1)}px ${inkA("--phos-a", Math.min(0.9, 0.45 * k).toFixed(2))}` : `0 0 ${(20 * k).toFixed(1)}px ${inkA("--phos-b", Math.min(0.95, 0.45 * k).toFixed(2))}`;

function mixHex(c1, c2, u) {
  const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const a = p(c1);
  const b = p(c2);
  return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], clamp(u)))).join(",")})`;
}

// ---- the engine film's helpers, as that film uses them ----------------------

function stack(layer) {
  const under = el("div", { class: "layer" }, layer);
  const svg = svgLayer(layer);
  const over = el("div", { class: "layer" }, layer);
  return { under, svg, over };
}

/** A caption: the narration in the voice face, its last line resting 60 px above the frame's bottom. */
function voiceLine(over, text, { y = 1020, size = 42, w = 1640, ay = 1 } = {}) {
  const d = textBlock(over, { x: 960, y, w, cls: "voice", size, align: "center", ax: 0.5, ay });
  d.style.textWrap = "balance"; // two even lines, never one long line and an orphan
  return { d, sp: words(d, text) };
}

/** Show a line's words over its own span, each lit on the narrator's measured word time. */
function speak(v, t, l, next) {
  v.d.style.opacity = fade(t, l.t0 - 0.25, l.t0 + 0.05, next - 0.35, next - 0.1).toFixed(3);
  reveal(v.sp, t, l.t0, l.t1, l.words && l.words.length === v.sp.length ? l.words : null);
}

/** The caption with its emphasis, but only if it still says what the script says. */
function cap(l, marked) {
  if (marked.replace(/[*_]/g, "") === l.text) return marked;
  console.warn(`caption for ${l.id} no longer matches the script; showing the script's text`);
  return l.text;
}

/** When the narrator reaches the first word of the line that starts with `word`. */
function wordTime(l, word) {
  const ws = l.text.split(/\s+/).filter(Boolean);
  const key = word.toLowerCase();
  let idx = ws.findIndex((w) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+/u, "").startsWith(key));
  if (idx < 0) {
    const i = l.text.toLowerCase().indexOf(key);
    if (i < 0) {
      console.warn(`no word "${word}" in ${l.id}`);
      return l.t0;
    }
    idx = l.text.slice(0, i).split(/\s+/).filter(Boolean).length;
  }
  if (l.words && l.words.length === ws.length) return l.words[idx];
  const i = l.text.indexOf(ws[idx]);
  return l.t0 + ((l.t1 - l.t0) * i) / l.text.length;
}

/** An arrow from p0 to p1, drawn on with `u`. Colour "a"/"b" glow; anything else is a plain stroke. */
function arrow(svg, p0, p1, color = "a", { curve = 0, width = 2.5, dash = null, head = 14, glow = true } = {}) {
  const stroke = { a: A, b: B, s: SILK, d: DIM, m: MUTE, ad: A_DIM, bd: B_DIM }[color] || color;
  const g = el("g", {}, svg);
  if (glow && (color === "a" || color === "b")) g.style.filter = GLOW[color];
  const mx = (p0[0] + p1[0]) / 2 + curve * (p1[1] - p0[1]);
  const my = (p0[1] + p1[1]) / 2 - curve * (p1[0] - p0[0]);
  const path = el("path", { d: `M${p0[0]} ${p0[1]} Q${mx} ${my} ${p1[0]} ${p1[1]}`, fill: "none", stroke, "stroke-width": width, "stroke-linecap": "round" }, g);
  if (dash) path.setAttribute("stroke-dasharray", dash);
  const len = path.getTotalLength();
  if (!dash) path.setAttribute("stroke-dasharray", `${len} ${len}`);
  const ang = Math.atan2(p1[1] - my, p1[0] - mx);
  const h = head;
  const tip = el("path", { d: `M0 0 L${-h} ${-h / 2} L${-h} ${h / 2} Z`, fill: stroke, transform: `translate(${p1[0]} ${p1[1]}) rotate(${(ang * 180) / Math.PI})` }, g);
  return {
    g,
    path,
    update(u) {
      if (!dash) path.setAttribute("stroke-dashoffset", (len * (1 - clamp(u))).toFixed(2));
      else g.style.opacity = clamp(u * 2);
      tip.setAttribute("opacity", u >= 0.98 ? 1 : 0);
    },
  };
}

// ---- small drawing helpers ---------------------------------------------------

/** A line of mono (or other) type, absolutely placed; `html` may carry <sub>/<sup>. */
function txt(parent, html, { x = 0, y = 0, size = 22, color = DIM, ax = 0, ay = 0, w = null, weight = null, cls = "mono", align = null, glow = null, lh = null, ls = null, wrap = false } = {}) {
  const d = place(el("div", { class: cls }, parent), { x, y, w, ax, ay });
  d.innerHTML = html;
  d.style.fontSize = `${size}px`;
  d.style.color = color;
  if (weight) d.style.fontWeight = weight;
  if (!wrap) d.style.whiteSpace = "nowrap";
  if (align) d.style.textAlign = align;
  if (glow) d.style.textShadow = textGlow(glow);
  if (lh) d.style.lineHeight = String(lh);
  if (ls) d.style.letterSpacing = ls;
  return d;
}

/** Fade an HTML node in with a small rise. */
function show(d, u, dy = 12) {
  d.style.opacity = clamp(u).toFixed(3);
  d.style.transform = dy && u < 1 ? `translateY(${((1 - clamp(u)) * dy).toFixed(1)}px)` : "";
}
const op = (n, v) => n.setAttribute("opacity", clamp(v).toFixed(3));

/** Type with a strike drawn through it (`set(u)` draws the strike). */
function struck(parent, html, opts = {}) {
  const d = txt(parent, html, opts);
  const bar = el("div", {}, d);
  Object.assign(bar.style, { position: "absolute", left: "-3%", top: "52%", height: "3px", width: "0", background: opts.strike || SILK, borderRadius: "2px" });
  return {
    d,
    set(u) {
      bar.style.width = `${(106 * clamp(u)).toFixed(1)}%`;
    },
  };
}

/** A rejection mark, popped in with `set(u)`. */
function cross(svg, x, y, r = 15, color = SILK, width = 4) {
  const g = el("g", { opacity: 0 }, svg);
  const d = `M${-r} ${-r} L${r} ${r} M${r} ${-r} L${-r} ${r}`;
  el("path", { d, stroke: INK, "stroke-width": width + 5, "stroke-linecap": "round", fill: "none" }, g);
  el("path", { d, stroke: color, "stroke-width": width, "stroke-linecap": "round", fill: "none" }, g);
  return {
    g,
    set(u) {
      const k = E.outBack(clamp(u));
      g.setAttribute("transform", `translate(${x} ${y}) scale(${Math.max(0.001, k).toFixed(3)})`);
      g.setAttribute("opacity", clamp(u * 3).toFixed(3));
    },
  };
}

/** A padlock, drawn (no emoji: two phosphors only). */
function padlock(svg, x, y, s = 1, color = B) {
  const g = el("g", { transform: `translate(${x} ${y}) scale(${s})` }, svg);
  el("path", { d: "M-6.5 -1 V-7 A6.5 6.5 0 0 1 6.5 -7 V-1", fill: "none", stroke: color, "stroke-width": 2.6, "stroke-linecap": "round" }, g);
  el("rect", { x: -10, y: -2, width: 20, height: 15, rx: 3, fill: color }, g);
  el("circle", { cx: 0, cy: 5, r: 2.2, fill: INK }, g);
  return g;
}

/** A path through fn over [0,1], mapped by X and Y. */
function curveD(fn, X, Y, n = 200, u0 = 0, u1 = 1) {
  let d = "";
  for (let i = 0; i <= n; i++) {
    const u = u0 + ((u1 - u0) * i) / n;
    d += (i ? "L" : "M") + X(u).toFixed(1) + " " + Y(fn(u)).toFixed(1);
  }
  return d;
}

/** A graphite plate (HTML, under the SVG). */
function plate(under, x, y, w, h) {
  return place(el("div", { class: "plate" }, under), { x, y, w, h });
}

/** A small duel card: side badge, a name, and the sound's trace. */
function miniCard(under, svg, { x, y, w = 300, h = 124, side, name, wave }) {
  const d = plate(under, x, y, w, h);
  const badge = el("div", {}, d, side);
  Object.assign(badge.style, {
    position: "absolute", left: "16px", top: "14px", width: "40px", height: "40px", borderRadius: "7px",
    border: `1.5px solid ${ink("--phos-a-deep")}`, display: "grid", placeItems: "center",
    fontFamily: "IBM Plex Mono", fontWeight: 600, fontSize: "22px", color: A,
  });
  const nm = el("div", { class: "mono" }, d, name);
  Object.assign(nm.style, { position: "absolute", left: "70px", top: "20px", fontSize: "24px", color: SILK });
  const scr = el("div", { class: "screen" }, d);
  Object.assign(scr.style, { left: "16px", top: "66px", width: `${w - 32}px`, height: `${h - 82}px` });
  const tr = scope(svg, { x: x + 26, y: y + 70, w: w - 52, h: h - 90, width: 2.2, points: 180, wave });
  return {
    d,
    tr,
    update(t, { o = 1, picked = 0 } = {}) {
      d.style.opacity = o;
      tr.g.style.opacity = o;
      tr.update(t, { amp: 0.8, ox: t * 0.25 });
      d.style.borderColor = picked > 0 ? inkA("--phos-a", 0.3 + 0.6 * picked) : ink("--hairline");
      d.style.boxShadow = `inset 1px 1px 0 ${inkA("--white", 0.07)}, 0 18px 50px ${inkA("--black", 0.55)}, 0 0 ${40 * picked}px ${inkA("--phos-a", 0.25 * picked)}`;
    },
  };
}

/** A two-dimensional single-site Metropolis–Hastings chain on a rotated Gaussian. */
function chain2d({ n, thin, burn, mu, sdPar, sdPerp, step, seed, start }) {
  const r = rng(seed);
  const g = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const m = Math.hypot(mu[0], mu[1]);
  const ex = [mu[0] / m, mu[1] / m];
  const ey = [-ex[1], ex[0]];
  const logp = (p) => {
    const d0 = p[0] - mu[0];
    const d1 = p[1] - mu[1];
    const a = d0 * ex[0] + d1 * ex[1];
    const c = d0 * ey[0] + d1 * ey[1];
    return -0.5 * ((a / sdPar) ** 2 + (c / sdPerp) ** 2);
  };
  let s = start.slice();
  const steps = [s.slice()];
  const draws = [];
  const at = [];
  for (let i = 0; i < burn + n * thin; i++) {
    const k = i % 2; // one site per step
    const p = s.slice();
    p[k] += g() * step;
    if (Math.log(r() + 1e-12) < logp(p) - logp(s)) s = p;
    steps.push(s.slice());
    if (i >= burn && (i - burn + 1) % thin === 0) {
      draws.push(s.slice());
      at.push(i + 1);
    }
  }
  return { steps, draws, at };
}

// ---------------------------------------------------------------------------
// 1. INTRO — the reference's pipeline, and the loop that closes it.

function sceneIntro({ stage, beat, line }) {
  const b = beat("intro");
  const l1 = line("intro1");
  stage.scene({
    id: "intro", t0: b.t0, t1: b.t1, post: 0.5, fout: 0.5,
    build(layer) {
      const { svg, over } = stack(layer);
      const eyebrow = txt(over, "the math", { x: 120, y: 112, cls: "eyebrow b", size: 24, color: B_DIM });
      const sub = txt(over, "the taste model and the search, as the code computes them", { x: 120, y: 156, size: 24, color: MUTE });
      const Y = 440;
      const NODES = ["term", "patch", "audio", "audio", "ℝ<sup>44</sup>", "ℝ"];
      const STAGES = [["compile", "a"], ["render", "a"], ["vet", "a"], ["φ", "b"], ["u<sub>θ</sub>", "b"]];
      const nd = NODES.map((h) => txt(over, h, { size: 56, color: SILK, ay: 0.5 }));
      const ws = nd.map((d) => d.getBoundingClientRect().width);
      const gap = (1680 - ws.reduce((s, v) => s + v, 0)) / STAGES.length;
      const xs = [];
      let x = 120;
      nd.forEach((d, i) => {
        place(d, { x, y: Y, ay: 0.5 });
        xs.push([x, x + ws[i]]);
        x += ws[i] + gap;
      });
      const arrows = STAGES.map(([name, c], i) => {
        const p0 = [xs[i][1] + 22, Y + 4];
        const p1 = [xs[i + 1][0] - 22, Y + 4];
        const ar = arrow(svg, p0, p1, c, { width: 3 });
        const lb = txt(over, name, { x: (p0[0] + p1[0]) / 2, y: Y - 30, size: 32, color: c === "b" ? B : A_DIM, ax: 0.5, ay: 1, glow: c === "b" ? "b" : null });
        return { ar, lb };
      });
      // The return arc: what you answer conditions θ, and θ bends what is proposed next.
      const pR = [(xs[5][0] + xs[5][1]) / 2, Y + 54];
      const pT = [(xs[0][0] + xs[0][1]) / 2, Y + 54];
      const curve = 0.25;
      const arc = arrow(svg, pR, pT, "b", { curve, width: 3 });
      const apex = Y + 54 + 0.5 * curve * (pR[0] - pT[0]);
      const arcLbl = txt(over, "answers condition θ  ·  θ reshapes how the next term is proposed", { x: (pR[0] + pT[0]) / 2, y: apex + 26, size: 27, color: B_DIM, ax: 0.5 });
      const tWhy = wordTime(l1, "why");
      const tShape = wordTime(l1, "shape");
      const v1 = voiceLine(over, cap(l1, "The math inside Auracle, and _why each piece has its shape_."));
      return (tl, t) => {
        show(eyebrow, ramp(t, b.t0 + 0.05, b.t0 + 0.5, E.out3), 8);
        show(sub, ramp(t, b.t0 + 0.25, b.t0 + 0.75, E.out3), 8);
        nd.forEach((d, i) => show(d, ramp(t, b.t0 + 0.2 + i * 0.2, b.t0 + 0.55 + i * 0.2, E.out3), 10));
        arrows.forEach((a, i) => {
          a.ar.update(ramp(t, b.t0 + 0.35 + i * 0.2, b.t0 + 0.7 + i * 0.2, E.io2));
          show(a.lb, ramp(t, b.t0 + 0.5 + i * 0.2, b.t0 + 0.85 + i * 0.2), 6);
        });
        arc.update(ramp(t, tWhy - 0.05, tWhy + 0.9, E.io3));
        show(arcLbl, ramp(t, tWhy + 0.5, tWhy + 1.0), 8);
        // "…its shape": the three amber stages (φ, u_θ and the arc) glow once.
        const g = fade(t, tShape - 0.15, tShape + 0.2, tShape + 0.6, tShape + 1.4);
        for (const a of arrows.slice(3)) {
          a.ar.g.style.filter = glowCss("b", 1 + 2.4 * g);
          a.lb.style.textShadow = textGlow("b", 1 + 1.6 * g);
        }
        arc.g.style.filter = glowCss("b", 1 + 2.4 * g);
        arcLbl.style.color = mixHex(B_DIM, B, g);
        speak(v1, t, l1, b.t1 + 0.4);
        void tl;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// 2. UTILITY — forty-four standardized features, and a max over linear lenses.

const AUD_Z = [1.2, 0.4, 1.0, -0.6, 0.8, 0.9, 0.2, 1.4, -0.7, -0.5, -0.2, -0.9, 0.5, 0.7, 0.3, 0.9, 0.4, -0.3];
const AUD_RAW = [3.1, 0.05, 3.3, 0.02, 0.35, 2.6, 0.12, 0.04, 1.7, 0.01, 0.45, 0.15, 0.06, 0.08, 0.03, 0.05, 0.09, 0.04];
const STR_N = [1, 0, 0, 2, 1, 0, 0, 1, 0, 0, 3, 0, 1, 0, 0, 1, 0, 0, 0, 2, 0, 1, 0, 0, 0, 1];

function sceneUtility({ stage, beat, line }) {
  const b = beat("utility");
  const [l1, l2, l3] = ["utility1", "utility2", "utility3"].map(line);
  stage.scene({
    id: "utility", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const gA = el("g", {}, svg);
      const hA = el("div", { class: "layer" }, over);
      const cC = el("div", { class: "layer" }, under);
      const gC = el("g", {}, svg);
      const hC = el("div", { class: "layer" }, over);

      // ---- utility1: 18 + 26 measurements become one vector, then one scale.
      const R = rng(41);
      const STR_Z = STR_N.map((n) => {
        const m = 0.2 + R() * 0.8;
        const s = 0.45 + R() * 0.55;
        return clamp((n - m) / s, -1.8, 2.3);
      });
      const ZX = 430;
      const ROW = 15;
      const Y0 = 196;
      const zero = el("line", { x1: ZX, y1: Y0 - 14, x2: ZX, y2: Y0 + 43 * ROW + 14, stroke: HAIR, "stroke-width": 2, opacity: 0 }, gA);
      const gBars = el("g", {}, gA);
      gBars.style.filter = GLOW.a;
      const items = [];
      AUD_RAW.forEach((raw, i) => {
        const L = Math.min(540, raw * 150);
        const H = Math.max(4, L * 0.4);
        items.push({ s0: [560 + i * 44, 412 - H, 26, H], raw: Math.max(3, L), z: AUD_Z[i], c0: A, audio: true, r: el("rect", { rx: 2, fill: A, opacity: 0 }, gBars) });
      });
      STR_N.forEach((n, j) => {
        const cx = 560 + (j % 13) * 61;
        const cy = 482 + Math.floor(j / 13) * 61;
        items.push({ s0: [cx, cy, 48, 48], raw: Math.max(3, n * 80), z: STR_Z[j], c0: n ? A_DEEP : PANEL, audio: false, r: el("rect", { rx: 6, fill: n ? A_DEEP : PANEL, stroke: HAIR, "stroke-width": 1.5, opacity: 0 }, gA) });
      });
      const lbAud = txt(hA, "φ<sub>audio</sub> · 18 · what the patch sounds like", { x: 560, y: 150, size: 22, color: A_DIM });
      const lbStr = txt(hA, "φ<sub>struct</sub> · 26 · how the patch is built", { x: 560, y: 622, size: 22, color: DIM });
      const colPhi = txt(hA, "φ(x) ∈ ℝ<sup>44</sup>", { x: 250, y: 92, size: 44, color: SILK });
      const colZ = txt(hA, "z = (φ − μ) / s", { x: 250, y: 92, size: 44, color: SILK });
      const colFoot = txt(hA, "refit at every posterior fit, over the log and the pool · Standardizer::fit", { x: 250, y: 152, size: 18, color: MUTE });
      const bracket = (k0, k1, label, color) => {
        const y0 = Y0 + k0 * ROW - 6;
        const y1 = Y0 + k1 * ROW + 6;
        const p = el("path", { d: `M270 ${y0} L258 ${y0} L258 ${y1} L270 ${y1}`, fill: "none", stroke: color, "stroke-width": 2, opacity: 0 }, gA);
        const tt = txt(hA, label, { x: 244, y: (y0 + y1) / 2, size: 20, color, ax: 1, ay: 0.5 });
        return { p, tt };
      };
      const brackets = [bracket(0, 17, "18 audio", A_DIM), bracket(18, 43, "26 structural", DIM)];

      // ---- utility2: u(x) = max_k θ_kᵀ z(x).
      const fx = txt(hA, "u(x) = <span>max</span><sub>k</sub> θ<sub>k</sub><sup>T</sup> z(x)", { x: 1300, y: 212, size: 66, color: B, ax: 0.5, ay: 0.5, glow: "b" });
      const maxSpan = fx.querySelector("span");
      const avg = struck(hA, "Σ<sub>k</sub> w<sub>k</sub> θ<sub>k</sub><sup>T</sup> z(x)", { x: 1300, y: 306, size: 40, color: MUTE, ax: 0.5, ay: 0.5, strike: DIM });
      const EXP = [1.6, -0.4, 0.5];
      const EY = [430, 508, 586];
      const EZ = 1270;
      const ES = 150;
      const eAxis = el("line", { x1: EZ, y1: EY[0] - 34, x2: EZ, y2: EY[2] + 34, stroke: HAIR, "stroke-width": 2, opacity: 0 }, gA);
      const gExp = el("g", {}, gA);
      gExp.style.filter = GLOW.b;
      const experts = EXP.map((v, k) => {
        const lb = txt(hA, `θ<sub>${k + 1}</sub><sup>T</sup> z(x)`, { x: 900, y: EY[k], size: 34, color: B_DIM, ay: 0.5 });
        const link = el("path", { d: `M${ZX + 200} ${Y0 + 21.5 * ROW} C ${ZX + 330} ${Y0 + 21.5 * ROW}, 760 ${EY[k]}, 884 ${EY[k]}`, fill: "none", stroke: B_DEEP, "stroke-width": 1.6, opacity: 0 }, gA);
        const bar = el("rect", { x: EZ, y: EY[k] - 12, width: 0, height: 24, rx: 3, fill: B }, gExp);
        const val = txt(hA, (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1), { x: EZ + v * ES + (v >= 0 ? 14 : -14), y: EY[k], size: 26, color: B_DIM, ax: v >= 0 ? 0 : 1, ay: 0.5 });
        return { lb, link, bar, val, v };
      });
      const uOut = txt(hA, "= u(x)", { x: EZ + EXP[0] * ES + 90, y: EY[0], size: 30, color: B, ay: 0.5, glow: "b" });
      const kNote = txt(hA, "K = 1 + ⌊n / 20⌋, capped at 5  ·  SessionConfig::k_styles", { x: 900, y: 664, size: 20, color: DIM });
      const small = txt(
        hC,
        "θ<sub>kj</sub> ~ N(0, σ<sub>θ</sub><sup>2</sup>),  σ<sub>θ</sub> = 1 / (√d · s<sub>K</sub>)<br>" +
          "s<sub>K</sub> = 1, .826, .748, .701, .669 for K = 1…5  (MAX_NORMAL_SD)<br>" +
          "the correction that keeps Var(u<sub>a</sub> − u<sub>b</sub>) the same at every K",
        { x: 120, y: 806, size: 18, color: MUTE, lh: 1.6 },
      );

      // ---- utility3: two islands, two lenses, one scale.
      const R2 = rng(12);
      const dots = [];
      const cluster = (cx, cy, n, kind) => {
        for (let i = 0; i < n; i++) {
          const a = R2() * Math.PI * 2;
          const r = Math.sqrt(R2()) * 112;
          dots.push({ x: cx + Math.cos(a) * r * 1.35, y: cy + Math.sin(a) * r, kind, rr: 5 + R2() * 4 });
        }
      };
      cluster(540, 560, 36, "dark");
      cluster(1380, 540, 36, "bright");
      for (let i = 0; i < 36; i++) {
        let x = 220 + R2() * 1480;
        const y = 350 + R2() * 400;
        if (Math.abs(x - 960) < 120) x += x < 960 ? -130 : 130;
        dots.push({ x, y, kind: "else", rr: 3 + R2() * 3 });
      }
      for (const d of dots) d.c = el("circle", { cx: d.x, cy: d.y, r: d.rr, fill: d.kind === "else" ? HAIR : A_DEEP }, gC);
      const gHalo = el("g", {}, gC);
      gHalo.style.filter = GLOW.b;
      for (const d of dots) d.halo = el("circle", { cx: d.x, cy: d.y, r: 0, fill: B, opacity: 0 }, gHalo);
      const nearest = (kind, px, py) => dots.filter((d) => d.kind === kind).reduce((a, d) => (Math.hypot(d.x - px, d.y - py) < Math.hypot(a.x - px, a.y - py) ? d : a));
      const pickA = nearest("dark", 590, 470);
      const pickB = nearest("bright", 1330, 450);
      const nD = txt(hC, "dark drones", { x: 540, y: 716, cls: "voice", size: 42, color: DIM, ax: 0.5 });
      const nB = txt(hC, "bright plucks", { x: 1380, y: 696, cls: "voice", size: 42, color: DIM, ax: 0.5 });
      const O = [960, 846];
      const lens1 = arrow(gC, O, [660, 616], "b", { width: 3.2 });
      const lens2 = arrow(gC, O, [1262, 600], "b", { width: 3.2 });
      const t1Lbl = txt(hC, "θ<sub>1</sub>", { x: 846, y: 700, size: 36, color: B, ax: 0.5, ay: 0.5, glow: "b" });
      const t2Lbl = txt(hC, "θ<sub>2</sub>", { x: 1076, y: 690, size: 36, color: B, ax: 0.5, ay: 0.5, glow: "b" });
      // The shared scale, vertical, between the islands.
      const AY0 = 560;
      const AY1 = 196;
      const uy = (u) => AY0 - ((u + 1) / 3) * (AY0 - AY1);
      const axG = el("g", { opacity: 0 }, gC);
      el("line", { x1: 960, y1: AY0, x2: 960, y2: AY1 - 12, stroke: B_DIM, "stroke-width": 2.5 }, axG);
      for (const u of [-1, 0, 1, 2]) el("line", { x1: 950, y1: uy(u), x2: 970, y2: uy(u), stroke: B_DIM, "stroke-width": 2 }, axG);
      const axLbl = txt(hC, "u", { x: 960, y: AY1 - 22, size: 32, color: B, ax: 0.5, ay: 1 });
      const axZero = txt(hC, "0", { x: 982, y: uy(0), size: 18, color: MUTE, ay: 0.5 });
      const axNote = txt(hC, "one scale, so the duel is well posed", { x: 960, y: AY0 + 22, size: 18, color: MUTE, ax: 0.5 });
      const UA = 1.3;
      const UB = 1.05;
      const cardA = miniCard(cC, gC, { x: 250, y: 160, side: "A", name: "drone", wave: voiceWave({ f: 1.3, bright: 0.12, seed: 3 }) });
      const cardB = miniCard(cC, gC, { x: 1370, y: 140, side: "B", name: "pluck", wave: voiceWave({ f: 2.8, bright: 0.85, seed: 4 }) });
      const fly = [el("circle", { r: 7, fill: B, opacity: 0 }, gHalo), el("circle", { r: 7, fill: B, opacity: 0 }, gHalo)];
      const lift = [el("circle", { r: 8, fill: A, opacity: 0 }, gC), el("circle", { r: 8, fill: A, opacity: 0 }, gC)];
      const mkA = txt(hC, "u(A) = θ<sub>1</sub><sup>T</sup>z(A)", { x: 940, y: uy(UA), size: 24, color: B, ax: 1, ay: 0.5 });
      const mkB = txt(hC, "u(B) = θ<sub>2</sub><sup>T</sup>z(B)", { x: 980, y: uy(UB), size: 24, color: B, ay: 0.5 });
      const markers = [el("circle", { cx: 960, cy: uy(UA), r: 8, fill: B, opacity: 0 }, gHalo), el("circle", { cx: 960, cy: uy(UB), r: 8, fill: B, opacity: 0 }, gHalo)];

      const v1 = voiceLine(over, cap(l1, "Each patch becomes *forty-four features*, standardized to one scale."));
      const v2 = voiceLine(over, cap(l2, "Utility is _the maximum_ over a few linear experts, never their average."));
      const v3 = voiceLine(over, cap(l3, "So you can love *dark drones* and *bright plucks*, and each is scored by _its own best lens_."));
      const tF = wordTime(l1, "forty-four");
      const tS = wordTime(l1, "standardized");
      const tMax = wordTime(l2, "maximum");
      const tExp = wordTime(l2, "linear");
      const tNever = wordTime(l2, "never");
      const tDr = wordTime(l3, "drones");
      const tPl = wordTime(l3, "plucks");
      const tSc = wordTime(l3, "scored");
      const tLens = wordTime(l3, "lens");
      return (tl, t) => {
        const outA = 1 - ramp(t, l3.t0 - 0.5, l3.t0 + 0.05, E.io2);
        gA.style.opacity = hA.style.opacity = outA.toFixed(3);
        const inC = ramp(t, l3.t0 - 0.3, l3.t0 + 0.4, E.io2);
        gC.style.opacity = hC.style.opacity = cC.style.opacity = inC.toFixed(3);
        // utility1
        items.forEach((it, k) => {
          const u0 = ramp(t, b.t0 - 0.25 + (it.audio ? k * 0.03 : 0.35 + (k - 18) * 0.012), b.t0 + 0.3 + (it.audio ? k * 0.03 : 0.35 + (k - 18) * 0.012), E.out3);
          const u1 = ramp(t, tF - 0.35 + k * 0.01, tF + 0.45 + k * 0.01, E.io3);
          const u2 = ramp(t, tS - 0.15 + k * 0.005, tS + 0.55 + k * 0.005, E.io3);
          const yk = Y0 + k * ROW;
          const zx = it.z * 80;
          const cx = lerp(ZX, ZX + Math.min(0, zx), u2);
          const cw = lerp(it.raw, Math.abs(zx), u2);
          let [sx, sy, sw, sh] = it.s0;
          if (it.audio) {
            const g = E.out3(u0);
            sy = sy + sh * (1 - g);
            sh = sh * g;
          }
          it.r.setAttribute("x", lerp(sx, cx, u1).toFixed(1));
          it.r.setAttribute("y", lerp(sy, yk - 5, u1).toFixed(1));
          it.r.setAttribute("width", Math.max(0.5, lerp(sw, cw, u1)).toFixed(1));
          it.r.setAttribute("height", Math.max(0.5, lerp(sh, 10, u1)).toFixed(1));
          if (!it.audio) {
            it.r.setAttribute("fill", mixHex(it.c0, A_DIM, u1));
            it.r.setAttribute("stroke-width", (1.5 * (1 - u1)).toFixed(2));
            it.r.setAttribute("rx", (6 - 4 * u1).toFixed(1));
          }
          op(it.r, it.audio ? Math.min(1, u0 * 3) : u0);
        });
        const c1 = ramp(t, tF - 0.2, tF + 0.5);
        const c2 = ramp(t, tS - 0.1, tS + 0.5);
        const s0 = ramp(t, b.t0, b.t0 + 0.6) * (1 - ramp(t, tF - 0.4, tF + 0.1));
        show(lbAud, s0, 0);
        show(lbStr, s0 * ramp(t, b.t0 + 0.3, b.t0 + 0.9), 0);
        show(colPhi, c1 * (1 - c2), 0);
        show(colZ, c2, 0);
        show(colFoot, ramp(t, tS + 0.3, tS + 0.9), 6);
        op(zero, c1);
        for (const br of brackets) {
          op(br.p, c1);
          show(br.tt, c1, 0);
        }
        // utility2
        show(fx, ramp(t, l2.t0 - 0.3, l2.t0 + 0.3, E.out3), 10);
        const gm = fade(t, tMax - 0.1, tMax + 0.25, tMax + 1.0, tMax + 2.0);
        maxSpan.style.color = mixHex(B, ink("--phos-b-flash"), gm);
        maxSpan.style.textShadow = textGlow("b", 1 + 2.2 * gm);
        op(eAxis, ramp(t, tExp - 0.3, tExp + 0.2));
        const hl = ramp(t, tExp + 0.8, tExp + 1.2);
        experts.forEach((e, k) => {
          const u = ramp(t, tExp - 0.25 + k * 0.18, tExp + 0.35 + k * 0.18, E.out3);
          show(e.lb, u, 0);
          op(e.link, u * 0.9);
          const w = Math.abs(e.v) * ES * u;
          e.bar.setAttribute("x", (e.v >= 0 ? EZ : EZ - w).toFixed(1));
          e.bar.setAttribute("width", w.toFixed(1));
          const dim = k === 0 ? 1 : 1 - 0.55 * hl;
          e.bar.setAttribute("opacity", (dim * (k === 0 ? 1 : 0.8)).toFixed(3));
          show(e.val, u * dim, 0);
          e.lb.style.color = k === 0 ? mixHex(B_DIM, B, hl) : B_DIM;
        });
        show(uOut, hl, 0);
        show(avg.d, ramp(t, tNever - 0.1, tNever + 0.35, E.out3), -14);
        avg.set(ramp(t, tNever + 0.3, tNever + 0.75, E.io2));
        show(kNote, ramp(t, tNever + 0.4, tNever + 0.9), 6);
        show(small, ramp(t, l3.t0 + 0.9, l3.t0 + 1.5), 6);
        // utility3
        const lit1 = ramp(t, tDr - 0.1, tDr + 0.4);
        const lit2 = ramp(t, tPl - 0.1, tPl + 0.4);
        for (const d of dots) {
          const lit = d.kind === "dark" ? lit1 : d.kind === "bright" ? lit2 : 0;
          d.halo.setAttribute("r", (3 + 5 * lit).toFixed(1));
          d.halo.setAttribute("opacity", (0.85 * lit).toFixed(3));
        }
        nD.style.color = mixHex(DIM, B, lit1);
        nB.style.color = mixHex(DIM, B, lit2);
        show(nD, ramp(t, tDr - 0.2, tDr + 0.3), 8);
        show(nB, ramp(t, tPl - 0.2, tPl + 0.3), 8);
        lens1.update(ramp(t, tDr, tDr + 0.6, E.io2));
        lens2.update(ramp(t, tPl, tPl + 0.6, E.io2));
        show(t1Lbl, ramp(t, tDr + 0.4, tDr + 0.8), 0);
        show(t2Lbl, ramp(t, tPl + 0.4, tPl + 0.8), 0);
        const pulse = fade(t, tLens - 0.1, tLens + 0.2, tLens + 0.5, tLens + 1.1);
        lens1.g.style.filter = lens2.g.style.filter = glowCss("b", 1 + 1.8 * pulse);
        // "scored": each pick lifts into a card, and lands on the one axis.
        const lu = ramp(t, tSc - 0.25, tSc + 0.45, E.io3);
        const cardsO = ramp(t, tSc + 0.1, tSc + 0.5);
        const endA = [270, 196];
        const endB = [1390, 176];
        [[pickA, endA, 0], [pickB, endB, 1]].forEach(([d, e, i]) => {
          lift[i].setAttribute("cx", lerp(d.x, e[0], lu).toFixed(1));
          lift[i].setAttribute("cy", lerp(d.y, e[1], lu).toFixed(1));
          op(lift[i], lu > 0 && lu < 1 ? 1 : 0);
        });
        cardA.update(t, { o: cardsO });
        cardB.update(t, { o: cardsO });
        op(axG, ramp(t, tSc, tSc + 0.4));
        show(axLbl, ramp(t, tSc, tSc + 0.4), 0);
        show(axZero, ramp(t, tSc, tSc + 0.4), 0);
        show(axNote, ramp(t, tSc + 1.2, tSc + 1.6), 6);
        const fu = ramp(t, tSc + 0.45, tSc + 1.05, E.io3);
        [[[550, 222], UA, 0], [[1370, 202], UB, 1]].forEach(([p, u, i]) => {
          fly[i].setAttribute("cx", lerp(p[0], 960, fu).toFixed(1));
          fly[i].setAttribute("cy", lerp(p[1], uy(u), fu).toFixed(1));
          op(fly[i], fu > 0 && fu < 1 ? 1 : 0);
          op(markers[i], fu >= 1 ? 1 : 0);
        });
        show(mkA, ramp(t, tSc + 0.95, tSc + 1.3), 0);
        show(mkB, ramp(t, tSc + 1.05, tSc + 1.4), 0);
        speak(v1, t, l1, l2.t0);
        speak(v2, t, l2, l3.t0);
        speak(v3, t, l3, b.t1 + 0.4);
        void tl;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// 3. LIKELIHOODS — three ways of observing one utility.

function sceneLikelihoods({ stage, beat, line }) {
  const b = beat("likelihoods");
  const L = ["likelihoods1", "likelihoods2", "likelihoods3", "likelihoods4", "likelihoods5"].map(line);
  stage.scene({
    id: "likelihoods", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const PX = [80, 680, 1280];
      const PW = 560;
      const PY = 110;
      const PH = 640;
      const AX = PY + 452;
      const TOP = PY + 250;
      const X = (p, u) => PX[p] + 45 + ((u + 4) / 8) * (PW - 90);
      const Yp = (P) => AX - P * (AX - TOP);
      const plates = PX.map((x) => plate(under, x, PY, PW, PH));
      const titles = ["duel", "cut", "stars"].map((s, p) => txt(over, s, { x: PX[p] + 30, y: PY + 24, size: 36, color: SILK, weight: 600 }));
      const tags = [
        txt(over, "Bradley–Terry", { x: PX[0] + 30, y: PY + 80, size: 19, color: B_DIM }),
        txt(over, "bank ▸ cut = kill  ·  record_keep(id, false)", { x: PX[1] + 30, y: PY + 80, size: 18, color: DIM }),
        txt(over, "ordinal  ·  fitted cutpoints, ordered", { x: PX[2] + 30, y: PY + 80, size: 18, color: DIM }),
      ];
      const forms = [
        [txt(over, "P(A ≻ B) = σ(u(A) − u(B))", { x: PX[0] + 30, y: PY + 128, size: 26, color: B, glow: "b" })],
        [
          txt(over, "P(keep) = σ(u(x) − τ<sub>s</sub>)", { x: PX[1] + 30, y: PY + 128, size: 26, color: B, glow: "b" }),
          txt(over, "τ<sub>s</sub> ~ N(0, 1), one per session", { x: PX[1] + 30, y: PY + 172, size: 19, color: DIM }),
        ],
        [
          txt(over, "P(y = k) = σ(c<sub>k</sub> − u) − σ(c<sub>k−1</sub> − u)", { x: PX[2] + 30, y: PY + 128, size: 23, color: B, glow: "b" }),
          txt(over, "c<sub>0</sub> = −2 + 1.5 r<sub>0</sub>,  c<sub>j</sub> = c<sub>j−1</sub> + e<sup>−0.5 + 0.7 r<sub>j</sub></sup>", { x: PX[2] + 30, y: PY + 172, size: 18, color: DIM }),
        ],
      ];
      // One amber axis, u, running under all three.
      const axG = el("g", {}, svg);
      axG.style.filter = GLOW.b;
      const axis = el("path", { d: `M${X(0, -4)} ${AX} L${X(2, 4)} ${AX}`, stroke: B_DIM, "stroke-width": 2.5, fill: "none" }, axG);
      const axLen = X(2, 4) - X(0, -4);
      axis.setAttribute("stroke-dasharray", `${axLen} ${axLen}`);
      const ticks = [];
      for (let p = 0; p < 3; p++) {
        for (const u of [-4, -2, 0, 2, 4]) {
          ticks.push(el("line", { x1: X(p, u), y1: AX - 5, x2: X(p, u), y2: AX + 5, stroke: B_DIM, "stroke-width": 1.5 }, svg));
          if (p < 2) ticks.push(txt(over, u < 0 ? `−${-u}` : `${u}`, { x: X(p, u), y: AX + 14, size: 15, color: MUTE, ax: 0.5 }));
        }
        if (p === 2) ticks.push(txt(over, "u", { x: X(p, 4) + 14, y: AX, size: 22, color: B_DIM, ay: 0.5 }));
      }
      const footer = txt(
        over,
        "one factor:  Σ<sub>i</sub> w<sub>i</sub> log p(y<sub>i</sub> | θ)  ·  recency  w<sub>i</sub> = 0.5<sup>(n−1−i)/150</sup>  (recency_half_life)",
        { x: 960, y: PY + PH + 30, size: 22, color: DIM, ax: 0.5 },
      );

      // Panel 1 — the duel: P(A ≻ B) as A moves along u; B sits at the curve's midpoint.
      const uB = -0.8;
      const g1 = el("g", {}, svg);
      g1.style.filter = GLOW.b;
      const c1 = el("path", { d: curveD((s) => sig(s * 8 - 4 - uB), (s) => X(0, s * 8 - 4), Yp), fill: "none", stroke: B, "stroke-width": 3 }, g1);
      const c1Len = c1.getTotalLength();
      c1.setAttribute("stroke-dasharray", `${c1Len} ${c1Len}`);
      const dotB = el("circle", { cx: X(0, uB), cy: AX, r: 8, fill: SILK, opacity: 0 }, svg);
      const lblB = txt(over, "B", { x: X(0, uB), y: AX + 38, size: 20, color: SILK, ax: 0.5 });
      const vDash = el("line", { stroke: B_DIM, "stroke-width": 1.5, "stroke-dasharray": "5 5", opacity: 0 }, svg);
      const hDash = el("line", { stroke: B_DIM, "stroke-width": 1.5, "stroke-dasharray": "5 5", opacity: 0 }, svg);
      const onCurve = el("circle", { r: 7, fill: B, opacity: 0 }, g1);
      const dotA = el("circle", { r: 9, fill: A, opacity: 0 }, svg);
      dotA.style.filter = GLOW.a;
      const lblA = txt(over, "A", { x: 0, y: AX + 38, size: 20, color: A, ax: 0.5 });
      const pRead = txt(over, "", { x: 0, y: 0, size: 22, color: B, ay: 1, glow: "b" });
      const dBr = el("path", { fill: "none", stroke: B, "stroke-width": 2, opacity: 0 }, svg);
      const dLbl = txt(over, "Δu", { x: 0, y: AX - 46, size: 20, color: B, ax: 0.5 });
      const prov = txt(over, "heard edits, asserted edits and PERFORM offers<br>are duels too, each with a provenance tag", { x: PX[0] + 30, y: AX + 76, size: 16, color: MUTE, lh: 1.5 });

      // Panel 2 — keep or cut: the same u against a per-session bar τ_s.
      const tau1 = -1.2;
      const tau2 = 1.3;
      const uK = 0.5;
      const g2 = el("g", {}, svg);
      g2.style.filter = GLOW.b;
      const c2 = el("path", { fill: "none", stroke: B, "stroke-width": 3 }, g2);
      const tauLine = el("line", { stroke: B, "stroke-width": 2.5, opacity: 0 }, g2);
      const tauLbl = txt(over, "τ<sub>s</sub>", { x: 0, y: TOP - 10, size: 24, color: B, ax: 0.5, ay: 1, glow: "b" });
      const dotK = el("circle", { cx: X(1, uK), cy: AX, r: 9, fill: A, opacity: 0 }, svg);
      dotK.style.filter = GLOW.a;
      const kRead = txt(over, "", { x: 0, y: 0, size: 20, color: B, glow: "b" });
      const ROWS = [
        { y: AX + 76, tau: tau1, name: "session 1 · generous" },
        { y: AX + 134, tau: tau2, name: "session 2 · a picky day" },
      ].map((r) => {
        const ln = el("line", { x1: X(1, -4), y1: r.y, x2: X(1, 4), y2: r.y, stroke: HAIR, "stroke-width": 2, opacity: 0 }, svg);
        const tk = el("line", { x1: X(1, r.tau), y1: r.y - 12, x2: X(1, r.tau), y2: r.y + 12, stroke: B, "stroke-width": 3, opacity: 0 }, g2);
        const dt = el("circle", { cx: X(1, uK), cy: r.y, r: 7, fill: A, opacity: 0 }, svg);
        const nm = txt(over, r.name, { x: X(1, -4), y: r.y - 30, size: 16, color: DIM });
        const pk = txt(over, `keep ${Math.round(100 * sig(uK - r.tau))}%`, { x: X(1, 4), y: r.y - 30, size: 16, color: B_DIM, ax: 1 });
        return { ...r, ln, tk, dt, nm, pk };
      });
      const still = txt(over, "↑ u did not move", { x: X(1, uK), y: AX + 150, size: 16, color: A_DIM, ax: 0.5 });

      // Panel 3 — stars: six bands between five fitted cutpoints.
      const cut0 = [-2.3, -1.1, -0.1, 0.9, 2.1];
      const shift = 1.2;
      const uS = 0.6;
      const g3 = el("g", {}, svg);
      const bands = Array.from({ length: 6 }, () => el("rect", { fill: B, opacity: 0 }, g3));
      const bandLbl = Array.from({ length: 6 }, (_, k) => txt(over, `${k}★`, { size: 17, color: B_DIM, ax: 0.5, ay: 1 }));
      const g3c = el("g", {}, svg);
      g3c.style.filter = GLOW.b;
      const cuts = cut0.map(() => el("line", { stroke: B, "stroke-width": 3, opacity: 0 }, g3c));
      const cutLbl = cut0.map((_, j) => txt(over, `c<sub>${j}</sub>`, { size: 17, color: B_DIM, ax: 0.5 }));
      const uLine = el("line", { x1: X(2, uS), y1: TOP - 20, x2: X(2, uS), y2: AX, stroke: A, "stroke-width": 2, "stroke-dasharray": "5 5", opacity: 0 }, svg);
      const dotS = el("circle", { cx: X(2, uS), cy: AX, r: 9, fill: A, opacity: 0 }, svg);
      dotS.style.filter = GLOW.a;
      const harshLbl = txt(over, "a harsher rater: every cutpoint moves; u does not", { x: PX[2] + 30, y: AX + 76, size: 16, color: MUTE });

      const v = [
        voiceLine(over, cap(L[0], "Three kinds of answer feed _that one utility_.")),
        voiceLine(over, cap(L[1], "A duel is _Bradley-Terry_, logistic in the utility difference.")),
        voiceLine(over, cap(L[2], "Cutting a patch is a kill, judged against _a bar fitted per session_.")),
        voiceLine(over, cap(L[3], "A picky day moves _the bar_. Not the taste.")),
        voiceLine(over, cap(L[4], "Stars fall between _fitted cutpoints_, so a harsh rater moves the cutpoints.")),
      ];
      const tUtil = wordTime(L[0], "utility");
      const tBT = wordTime(L[1], "Bradley");
      const tDiff = wordTime(L[1], "difference");
      const tKill = wordTime(L[2], "kill");
      const tBar = wordTime(L[2], "bar");
      const tSess = wordTime(L[2], "session");
      const tPicky = wordTime(L[3], "picky");
      const tMoves = wordTime(L[3], "moves");
      const tTaste = wordTime(L[3], "taste");
      const tStars = wordTime(L[4], "Stars");
      const tCuts = wordTime(L[4], "cutpoints");
      const tHarsh = wordTime(L[4], "harsh");
      const t1s = [L[1].t0, L[2].t0, L[4].t0];
      return (tl, t) => {
        plates.forEach((d, p) => {
          const u = ramp(t, L[0].t0 - 0.35 + p * 0.15, L[0].t0 + 0.25 + p * 0.15, E.out4);
          d.style.opacity = u.toFixed(3);
          d.style.transform = `translateY(${((1 - u) * 26).toFixed(1)}px)`;
          show(titles[p], u, 26);
          show(tags[p], ramp(t, t1s[p] - 0.3, t1s[p] + 0.2), 6);
          forms[p].forEach((f, j) => show(f, ramp(t, t1s[p] - 0.2 + j * 0.3 + (p === 1 && j === 1 ? tSess - L[2].t0 - 0.3 : 0), t1s[p] + 0.3 + j * 0.3 + (p === 1 && j === 1 ? tSess - L[2].t0 - 0.3 : 0)), 6));
        });
        const ax = ramp(t, tUtil - 0.35, tUtil + 0.6, E.io2);
        axis.setAttribute("stroke-dashoffset", (axLen * (1 - ax)).toFixed(1));
        for (const k of ticks) (k instanceof SVGElement ? op(k, ax) : show(k, ax, 0));
        show(footer, ramp(t, L[0].t1 + 0.1, L[0].t1 + 0.6), 8);
        // Panel 1.
        const cu = ramp(t, tBT - 0.1, tBT + 0.8, E.io2);
        c1.setAttribute("stroke-dashoffset", (c1Len * (1 - cu)).toFixed(1));
        op(dotB, cu * 3);
        show(lblB, cu * 3, 0);
        const slide = ramp(t, tDiff - 0.3, tDiff + 0.9, E.io3);
        const uA = lerp(-2.6, 1.5, slide);
        const PA = sig(uA - uB);
        const onA = ramp(t, tBT + 0.2, tBT + 0.6);
        dotA.setAttribute("cx", X(0, uA).toFixed(1));
        dotA.setAttribute("cy", AX);
        op(dotA, onA);
        place(lblA, { x: X(0, uA), y: AX + 38, ax: 0.5 });
        show(lblA, onA, 0);
        const rd = ramp(t, tDiff - 0.3, tDiff);
        vDash.setAttribute("x1", X(0, uA));
        vDash.setAttribute("x2", X(0, uA));
        vDash.setAttribute("y1", AX);
        vDash.setAttribute("y2", Yp(PA));
        hDash.setAttribute("x1", X(0, -4));
        hDash.setAttribute("x2", X(0, uA));
        hDash.setAttribute("y1", Yp(PA));
        hDash.setAttribute("y2", Yp(PA));
        op(vDash, rd);
        op(hDash, rd * 0.7);
        onCurve.setAttribute("cx", X(0, uA));
        onCurve.setAttribute("cy", Yp(PA));
        op(onCurve, rd);
        pRead.innerHTML = `P(A ≻ B) = ${PA.toFixed(2)}`;
        place(pRead, { x: clamp(X(0, uA) - 150, PX[0] + 24, PX[0] + PW - 250), y: Yp(PA) - 16, ay: 1 });
        show(pRead, rd, 0);
        const x0 = X(0, uB);
        const x1 = X(0, uA);
        dBr.setAttribute("d", `M${x0} ${AX - 12} L${x0} ${AX - 22} L${x1} ${AX - 22} L${x1} ${AX - 12}`);
        op(dBr, rd * (Math.abs(x1 - x0) > 20 ? 1 : 0));
        place(dLbl, { x: (x0 + x1) / 2, y: AX - 50, ax: 0.5 });
        show(dLbl, rd * (Math.abs(x1 - x0) > 40 ? 1 : 0), 0);
        show(prov, ramp(t, tDiff + 0.6, tDiff + 1.2), 6);
        // Panel 2.
        const tau = lerp(tau1, tau2, ramp(t, tMoves - 0.1, tMoves + 0.8, E.io3));
        c2.setAttribute("d", curveD((s) => sig(s * 8 - 4 - tau), (s) => X(1, s * 8 - 4), Yp));
        op(c2, ramp(t, tKill - 0.2, tKill + 0.4));
        const tb = ramp(t, tBar - 0.15, tBar + 0.3);
        tauLine.setAttribute("x1", X(1, tau));
        tauLine.setAttribute("x2", X(1, tau));
        tauLine.setAttribute("y1", AX + 8);
        tauLine.setAttribute("y2", TOP);
        op(tauLine, tb);
        place(tauLbl, { x: X(1, tau), y: TOP - 8, ax: 0.5, ay: 1 });
        show(tauLbl, tb, 0);
        const pulse = fade(t, tTaste - 0.1, tTaste + 0.15, tTaste + 0.5, tTaste + 1.1);
        op(dotK, ramp(t, tKill, tKill + 0.4));
        dotK.setAttribute("r", (9 + 5 * pulse).toFixed(1));
        const PK = sig(uK - tau);
        kRead.innerHTML = `P(keep) ${PK.toFixed(2)}`;
        place(kRead, { x: PX[1] + 45, y: TOP + 8 });
        show(kRead, ramp(t, tKill + 0.3, tKill + 0.7), 0);
        ROWS.forEach((r, i) => {
          const u = ramp(t, tPicky - 0.2 + i * 0.25, tPicky + 0.3 + i * 0.25, E.out3);
          op(r.ln, u);
          op(r.tk, u);
          op(r.dt, u);
          r.dt.setAttribute("r", (7 + 4 * pulse).toFixed(1));
          show(r.nm, u, 0);
          show(r.pk, u, 0);
        });
        show(still, pulse > 0.02 ? Math.min(1, pulse * 2) : ramp(t, tTaste + 0.3, tTaste + 0.8), 0);
        // Panel 3.
        const sh = shift * ramp(t, tHarsh - 0.1, tHarsh + 1.0, E.io3);
        const cs = cut0.map((c) => c + sh);
        const edges = [-Infinity, ...cs, Infinity];
        const probs = [];
        for (let k = 0; k < 6; k++) {
          const hi = edges[k + 1] === Infinity ? 1 : sig(edges[k + 1] - uS);
          const lo = edges[k] === -Infinity ? 0 : sig(edges[k] - uS);
          probs.push(Math.max(0, hi - lo));
        }
        const peak = Math.max(...probs);
        const bu = ramp(t, tStars - 0.1, tStars + 0.8, E.out3);
        probs.forEach((pr, k) => {
          const lo = k === 0 ? -4 : clamp(cs[k - 1], -4, 4);
          const hi = k === 5 ? 4 : clamp(cs[k], -4, 4);
          const x0b = X(2, lo);
          const w = Math.max(0, X(2, hi) - x0b);
          const h = (pr / peak) * 170 * bu;
          bands[k].setAttribute("x", (x0b + 1.5).toFixed(1));
          bands[k].setAttribute("width", Math.max(0, w - 3).toFixed(1));
          bands[k].setAttribute("y", (AX - h).toFixed(1));
          bands[k].setAttribute("height", h.toFixed(1));
          bands[k].setAttribute("opacity", ((0.25 + 0.6 * (pr / peak)) * bu).toFixed(3));
          place(bandLbl[k], { x: x0b + w / 2, y: AX - h - 6, ax: 0.5, ay: 1 });
          bandLbl[k].style.color = pr / peak > 0.6 ? B : B_DIM;
          show(bandLbl[k], bu * (w > 30 ? 1 : 0), 0);
        });
        const cu3 = ramp(t, tCuts - 0.2, tCuts + 0.3);
        cuts.forEach((c, j) => {
          c.setAttribute("x1", X(2, cs[j]));
          c.setAttribute("x2", X(2, cs[j]));
          c.setAttribute("y1", AX - 14);
          c.setAttribute("y2", AX + 14);
          op(c, cu3 * (cs[j] < 4 ? 1 : 0));
          place(cutLbl[j], { x: X(2, cs[j]), y: AX + 18, ax: 0.5 });
          show(cutLbl[j], cu3 * (cs[j] < 3.9 ? 1 : 0), 0);
        });
        {
          let kU = 0;
          while (kU < 5 && uS >= cs[kU]) kU++;
          uLine.setAttribute("y1", (AX - (probs[kU] / peak) * 170 * bu).toFixed(1));
        }
        op(uLine, ramp(t, tStars + 0.2, tStars + 0.6));
        op(dotS, ramp(t, tStars + 0.2, tStars + 0.6));
        show(harshLbl, ramp(t, tHarsh + 0.5, tHarsh + 1.0), 6);
        const nexts = [L[1].t0, L[2].t0, L[3].t0, L[4].t0, b.t1 + 0.4];
        v.forEach((vv, i) => speak(vv, t, L[i], nexts[i]));
        void tl;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// 4. POSTERIOR — MCMC draws, then exact reweighting until a refit is due.

function scenePosterior({ stage, beat, line }) {
  const b = beat("posterior");
  const [l1, l2, l3, l4] = ["posterior1", "posterior2", "posterior3", "posterior4"].map(line);
  stage.scene({
    id: "posterior", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { svg, over } = stack(layer);
      // Left: every site of the model, and what it is not.
      const SX = 120;
      const SY = 200;
      const siteL = el("div", { class: "layer" }, over);
      siteL.style.transformOrigin = "0 0";
      const sites = [
        ["θ<sub>0,0</sub> … θ<sub>4,43</sub>", "5 lenses × 44 weights"],
        ["τ<sub>s</sub>", "one threshold per session"],
        ["r<sub>0</sub> … r<sub>4</sub>", "the star cutpoints"],
      ].map(([n, c], i) => ({
        n: txt(siteL, n, { x: SX, y: SY + i * 86, size: 32, color: B }),
        r: txt(siteL, "∈ ℝ", { x: SX + 330, y: SY + i * 86, size: 32, color: SILK }),
        c: txt(siteL, c, { x: SX, y: SY + i * 86 + 44, size: 18, color: MUTE }),
      }));
      const zLab = struck(siteL, "z<sub>i</sub> ∈ {1 … K}", { x: SX, y: SY + 3 * 86, size: 32, color: DIM, strike: SILK });
      const zNote = txt(siteL, "no lens label to sample: the max removed it", { x: SX, y: SY + 3 * 86 + 44, size: 18, color: MUTE });
      const mh = txt(
        over,
        `<span style='color:${ink("--phos-b")}'>adaptive single-site MH</span><br>3 000 warmup + 10 000 steps · thinned to 500<br><span style='color:${ink("--silk-mute")}'>mcmc_warmup · mcmc_samples · KEEP</span>`,
        { x: SX, y: 600, size: 20, color: DIM, lh: 1.6 },
      );
      const refitNote = txt(over, "needs_refit(): resampled since the last fit<br>the app refits at most every 6 duels", { x: SX, y: 740, size: 20, color: B_DIM, lh: 1.6 });

      // Centre: the draws, as tastes from a common origin (a 2-D slice of θ).
      const O = [700, 640];
      const S = 520;
      const P = (th) => [O[0] + th[0] * S, O[1] - th[1] * S];
      const axes = el("g", { opacity: 0 }, svg);
      el("line", { x1: O[0] - 30, y1: O[1], x2: O[0] + 620, y2: O[1], stroke: HAIR, "stroke-width": 2 }, axes);
      el("line", { x1: O[0], y1: O[1] + 30, x2: O[0], y2: O[1] - 480, stroke: HAIR, "stroke-width": 2 }, axes);
      const slice = txt(over, "two of θ's 220 coordinates", { x: O[0] + 620, y: O[1] + 14, size: 17, color: MUTE, ax: 1 });
      const C1 = chain2d({ n: 160, thin: 7, burn: 80, mu: [0.62, 0.42], sdPar: 0.16, sdPerp: 0.24, step: 0.16, seed: 5, start: [0.04, 0.03] });
      const C2 = chain2d({ n: 160, thin: 7, burn: 0, mu: [0.5, 0.56], sdPar: 0.13, sdPerp: 0.15, step: 0.14, seed: 9, start: [0.5, 0.56] });
      const gCloud = el("g", {}, svg);
      gCloud.style.filter = GLOW.b;
      const mkArrow = (th, parent) => {
        const [x, y] = P(th);
        const ln = el("line", { x1: O[0], y1: O[1], x2: x, y2: y, stroke: B, "stroke-width": 1.3, "stroke-linecap": "round", opacity: 0 }, parent);
        const tip = el("circle", { cx: x, cy: y, r: 3, fill: B, opacity: 0 }, parent);
        return { th, ln, tip };
      };
      const cloud1 = C1.draws.map((th) => mkArrow(th, gCloud));
      const cloud2 = C2.draws.map((th) => mkArrow(th, gCloud));
      const head = el("g", {}, svg);
      head.style.filter = GLOW.b;
      const headLn = el("line", { x1: O[0], y1: O[1], stroke: ink("--phos-b-hot"), "stroke-width": 3, opacity: 0 }, head);
      const headTip = el("circle", { r: 7, fill: ink("--phos-b-hot"), opacity: 0 }, head);
      const stair = el("polyline", { fill: "none", stroke: ink("--phos-b-hot"), "stroke-width": 2, opacity: 0 }, head);
      const drawnLbl = txt(over, "", { x: 1250, y: 250, size: 22, color: B, glow: "b" });
      const drawnSub = txt(over, "500 draws · 160 of them drawn here", { x: 1250, y: 284, size: 17, color: MUTE });

      // The answers: each one's evidence is a direction d, and p(y | θ) = σ(κ θ·d).
      const ANS = [[-0.4, 0.92], [-0.6, 0.8], [-0.3, 0.95], [-0.5, 0.87]];
      const KAPPA = 6;
      const lik = ANS.map((d) => C1.draws.map((th) => sig(KAPPA * (th[0] * d[0] + th[1] * d[1]))));
      const cutsG = el("g", {}, svg);
      const cutLines = ANS.map(() => el("line", { stroke: B_DIM, "stroke-width": 2, "stroke-dasharray": "8 8", opacity: 0 }, cutsG));
      // Systematic resampling (offset ½N) of the weights after the fourth answer.
      const N = C1.draws.length;
      const wAfter = (() => {
        let w = new Array(N).fill(1 / N);
        for (const li of lik) {
          w = w.map((x, i) => x * li[i]);
          const s = w.reduce((a, c) => a + c, 0);
          w = w.map((x) => x / s);
        }
        return w;
      })();
      const counts = new Array(N).fill(0);
      {
        let u = 0.5 / N;
        let cum = wAfter[0];
        let src = 0;
        for (let i = 0; i < N; i++) {
          while (src + 1 < N && cum < u) {
            src++;
            cum += wAfter[src];
          }
          counts[src]++;
          u += 1 / N;
        }
      }
      const distinct = counts.filter((c) => c > 0).length;

      // Under the cloud: one weight bar per draw.
      const BX0 = 560;
      const BW = 5;
      const BY = 868;
      const gW = el("g", {}, svg);
      const wBars = C1.draws.map((_, i) => el("rect", { x: BX0 + i * BW, width: BW - 1.4, y: BY, height: 0, fill: B, opacity: 0 }, gW));
      const wLbl = txt(over, "w<sub>s</sub>, one per draw", { x: BX0, y: BY + 8, size: 17, color: MUTE });
      // The update rule.
      const rule = txt(over, "w<sub>s</sub> ← w<sub>s</sub> p(y | θ<sub>s</sub>) / Σ<sub>s′</sub> w<sub>s′</sub> p(y | θ<sub>s′</sub>)", { x: 1000, y: 100, size: 34, color: B, ax: 0.5, ay: 0.5, glow: "b" });
      const exact = place(el("div", { class: "pill b" }, over, "exact · O(S) per answer"), { x: 1210, y: 164, ax: 0.5, ay: 0.5 });
      // Right: effective sample size.
      const MX = 1640;
      const MY0 = 690;
      const MH = 400;
      const essLbl = txt(over, "ESS = 1 / Σ<sub>s</sub> w<sub>s</sub><sup>2</sup>", { x: MX + 20, y: 230, size: 26, color: B, ax: 0.5, glow: "b" });
      const meter = el("g", { opacity: 0 }, svg);
      el("rect", { x: MX, y: MY0 - MH, width: 40, height: MH, rx: 6, fill: ink("--bezel"), stroke: HAIR, "stroke-width": 1.5 }, meter);
      const mFill = el("rect", { x: MX + 4, width: 32, rx: 3, fill: B }, meter);
      mFill.style.filter = GLOW.b;
      el("line", { x1: MX - 12, y1: MY0 - MH / 2, x2: MX + 52, y2: MY0 - MH / 2, stroke: SILK, "stroke-width": 2, "stroke-dasharray": "4 4" }, meter);
      const half = txt(over, "N/2", { x: MX + 60, y: MY0 - MH / 2, size: 18, color: DIM, ay: 0.5 });
      const essRead = txt(over, "", { x: MX + 20, y: MY0 + 22, size: 24, color: B, ax: 0.5 });
      const essSub = txt(over, "", { x: MX + 20, y: MY0 + 56, size: 17, color: MUTE, ax: 0.5 });
      const answered = txt(over, "", { x: MX + 20, y: 272, size: 17, color: DIM, ax: 0.5 });
      const resampled = place(el("div", { class: "pill b" }, over, "resampled"), { x: MX + 20, y: 800, ax: 0.5, ay: 0.5 });

      const v = [
        voiceLine(over, cap(l1, "With no hidden lens labels, every parameter is _a real number_.")),
        voiceLine(over, cap(l2, "So plain _Metropolis-Hastings_ fits it, and keeps five hundred draws.")),
        voiceLine(over, cap(l3, "Between fits, each answer _reweights the draws_, exactly and nearly free.")),
        voiceLine(over, cap(l4, "When the weights collapse, it pays for _a refit_.")),
      ];
      const tLabels = wordTime(l1, "labels");
      const tReal = wordTime(l1, "real");
      const tMH = wordTime(l2, "Metropolis");
      const tFive = wordTime(l2, "five");
      const tRw = wordTime(l3, "reweights");
      const tExact = wordTime(l3, "exactly");
      const tAns = [tRw - 0.1, wordTime(l3, "exactly") + 0.1, wordTime(l3, "free") - 0.1, l4.t0 - 0.15];
      const tCol = wordTime(l4, "collapse");
      const tRefit = wordTime(l4, "refit");
      const drawEnd = l2.t1 + 0.35;
      return (tl, t) => {
        // posterior1: the sites, centred and large, then moved aside for the fit.
        const aside = ramp(t, l2.t0 - 0.5, l2.t0 + 0.3, E.io3);
        siteL.style.transform = `translate(${lerp(500, 0, aside).toFixed(1)}px, ${lerp(60, 0, aside).toFixed(1)}px) scale(${lerp(1.35, 1, aside).toFixed(3)})`;
        sites.forEach((s, i) => {
          const u = ramp(t, l1.t0 - 0.3 + i * 0.3, l1.t0 + 0.2 + i * 0.3, E.out3);
          show(s.n, u, 10);
          show(s.c, u, 10);
          show(s.r, ramp(t, tReal - 0.2 + i * 0.12, tReal + 0.2 + i * 0.12), 0);
          s.r.style.textShadow = textGlow("b", 1.4 * fade(t, tReal, tReal + 0.3, tReal + 0.8, tReal + 1.5));
        });
        show(zLab.d, fade(t, tLabels - 0.25, tLabels + 0.15, l2.t0 + 0.4, l2.t0 + 1.2), 0);
        zLab.set(ramp(t, tLabels + 0.1, tLabels + 0.6));
        show(zNote, fade(t, tLabels + 0.4, tLabels + 0.8, l2.t0 + 0.4, l2.t0 + 1.2), 0);
        // posterior2: an MH chain, one site at a time, then fast-forward.
        show(mh, ramp(t, tMH - 0.1, tMH + 0.4), 8);
        op(axes, ramp(t, l2.t0 - 0.4, l2.t0 + 0.2));
        show(slice, ramp(t, l2.t0 - 0.2, l2.t0 + 0.3), 0);
        const slow = ramp(t, tMH - 0.2, tMH + 1.5, E.lin);
        const fast = ramp(t, tMH + 1.5, drawEnd, E.io2);
        const kStep = Math.min(C1.steps.length - 1, Math.floor(slow * 16 + fast * (C1.steps.length - 17)));
        const running = t > tMH - 0.2 && t < drawEnd + 0.2;
        const hp = P(C1.steps[kStep]);
        headLn.setAttribute("x2", hp[0].toFixed(1));
        headLn.setAttribute("y2", hp[1].toFixed(1));
        headTip.setAttribute("cx", hp[0].toFixed(1));
        headTip.setAttribute("cy", hp[1].toFixed(1));
        const hO = running ? ramp(t, tMH - 0.2, tMH) : 0;
        op(headLn, hO * 0.9);
        op(headTip, hO);
        const tr = C1.steps.slice(Math.max(0, kStep - 14), kStep + 1).map((s) => P(s).map((q) => q.toFixed(1)).join(",")).join(" ");
        stair.setAttribute("points", tr);
        op(stair, hO * (1 - fast) * 0.9);
        // posterior3/4: weights, answer by answer, then a resample and a refit.
        const au = tAns.map((ta) => ramp(t, ta, ta + 0.5, E.io2));
        let w = C1.draws.map((_, i) => {
          let x = 1;
          au.forEach((u, a) => (x *= lerp(1, lik[a][i], u)));
          return x;
        });
        const sw = w.reduce((a, c) => a + c, 0);
        w = w.map((x) => x / sw);
        const essW = 1 / w.reduce((a, x) => a + x * x, 0);
        const rs = ramp(t, tCol + 0.35, tCol + 0.65);
        const refit = ramp(t, tRefit - 0.1, tRefit + 0.8, E.io3);
        const gone = ramp(t, tRefit - 0.2, tRefit + 0.3);
        const dispW = w.map((x, i) => lerp(x * N, counts[i], rs));
        cloud1.forEach((a, i) => {
          const born = C1.at[i] <= kStep ? 1 : 0;
          const wi = dispW[i];
          const vis = born * clamp(wi) * (1 - gone);
          const Lr = 0.3 + 0.7 * clamp(wi);
          const [x, y] = P([a.th[0] * Lr, a.th[1] * Lr]);
          a.ln.setAttribute("x2", x.toFixed(1));
          a.ln.setAttribute("y2", y.toFixed(1));
          a.tip.setAttribute("cx", x.toFixed(1));
          a.tip.setAttribute("cy", y.toFixed(1));
          a.ln.setAttribute("stroke-width", (1.3 + (rs > 0 ? 0.7 * Math.min(3, counts[i] - 1) * rs : 0)).toFixed(2));
          op(a.ln, (0.04 + 0.6 * vis) * born * (1 - gone));
          op(a.tip, (0.04 + 0.9 * vis) * born * (1 - gone));
        });
        cloud2.forEach((a, i) => {
          const u = ramp(t, tRefit + (i / N) * 0.7, tRefit + 0.15 + (i / N) * 0.7);
          op(a.ln, 0.6 * u);
          op(a.tip, 0.9 * u);
        });
        const nDrawn = Math.min(N, C1.at.filter((s) => s <= kStep).length);
        drawnLbl.textContent = nDrawn ? `${Math.round((nDrawn / N) * 500)} draws` : "";
        show(drawnLbl, ramp(t, tMH + 1.4, tMH + 1.8) * (1 - ramp(t, tRw - 0.6, tRw - 0.2)), 0);
        show(drawnSub, ramp(t, tFive - 0.1, tFive + 0.4) * (1 - ramp(t, tRw - 0.6, tRw - 0.2)), 0);
        ANS.forEach((d, a) => {
          // The answer's boundary θ·d = 0, drawn through the quadrant the draws live in.
          let n = [-d[1], d[0]];
          if (n[0] + n[1] < 0) n = [-n[0], -n[1]];
          const ln = cutLines[a];
          ln.setAttribute("x1", (O[0] + n[0] * 600).toFixed(1));
          ln.setAttribute("y1", (O[1] - n[1] * 600).toFixed(1));
          ln.setAttribute("x2", (O[0] - n[0] * 40).toFixed(1));
          ln.setAttribute("y2", (O[1] + n[1] * 40).toFixed(1));
          op(ln, 0.9 * fade(t, tAns[a] - 0.15, tAns[a] + 0.1, tAns[a] + 0.45, tAns[a] + 0.9));
        });
        const wu = ramp(t, tRw - 0.5, tRw - 0.1);
        const barsOn = wu * (1 - ramp(t, tRefit + 0.9, tRefit + 1.4) * 0);
        wBars.forEach((r, i) => {
          const bornB = C1.at[i] <= kStep ? 1 : 0;
          const h = Math.min(120, 22 * lerp(dispW[i], 1, refit));
          r.setAttribute("y", (BY - h * barsOn).toFixed(1));
          r.setAttribute("height", (h * barsOn).toFixed(1));
          op(r, bornB * barsOn * (0.35 + 0.6 * clamp(h / 60)));
        });
        show(wLbl, barsOn, 0);
        show(rule, ramp(t, tRw - 0.35, tRw + 0.15, E.out3), 10);
        show(exact, ramp(t, tExact - 0.1, tExact + 0.3), 6);
        // The meter.
        const mOn = ramp(t, tRw - 0.5, tRw - 0.1);
        op(meter, mOn);
        show(essLbl, mOn, 0);
        show(half, mOn, 0);
        const frac = lerp(lerp(essW / N, 1, rs), 1, refit);
        mFill.setAttribute("y", (MY0 - 4 - (MH - 8) * frac).toFixed(1));
        mFill.setAttribute("height", ((MH - 8) * frac).toFixed(1));
        const flash = fade(t, tCol + 0.3, tCol + 0.5, tCol + 1.3, tCol + 1.9);
        mFill.setAttribute("fill", mixHex(B, ink("--phos-b-flash"), flash));
        // Below half the draw count, the half line lights: this is what triggers the resample.
        const below = frac < 0.5 ? 1 : 0;
        half.style.color = below ? B : DIM;
        half.style.textShadow = below ? textGlow("b", 1.4) : "none";
        essRead.textContent = `ESS ${Math.round(500 * frac)} / 500`;
        show(essRead, mOn, 0);
        essSub.textContent = rs > 0.5 && refit < 0.5 ? `but only ${Math.round((distinct / N) * 500)} distinct` : refit >= 0.5 ? "a fresh fit" : "";
        show(essSub, mOn * (rs > 0.5 ? 1 : 0), 0);
        const nAns = au.filter((u) => u > 0.05).length;
        answered.textContent = refit > 0.5 ? "answers since the fit: 0" : `answers since the fit: ${nAns}`;
        show(answered, mOn, 0);
        show(resampled, flash, 0);
        resampled.style.transform = `translate(-50%, -50%) scale(${(1 + 0.08 * flash).toFixed(3)})`;
        resampled.style.translate = "0 0";
        show(refitNote, ramp(t, tRefit + 0.2, tRefit + 0.7), 6);
        const nexts = [l2.t0, l3.t0, l4.t0, b.t1 + 0.4];
        v.forEach((vv, i) => speak(vv, t, [l1, l2, l3, l4][i], nexts[i]));
        void tl;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// 5. CALIBRATION — forecast first, score with a proper rule, per stream.

function sceneCalibration({ stage, beat, line }) {
  const b = beat("calibration");
  const [l1, l2, l3, l4] = ["calibration1", "calibration2", "calibration3", "calibration4"].map(line);
  stage.scene({
    id: "calibration", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      // calibration1: a forecast, an answer, a score.
      const cardsU = el("div", { class: "layer" }, under);
      const cardsG = el("g", {}, svg);
      const cA = miniCard(cardsU, cardsG, { x: 330, y: 330, w: 560, h: 250, side: "A", name: "Soft Engine", wave: voiceWave({ f: 1.5, bright: 0.3, seed: 31 }) });
      const cB = miniCard(cardsU, cardsG, { x: 1030, y: 330, w: 560, h: 250, side: "B", name: "Pale Wire", wave: voiceWave({ f: 2.3, bright: 0.65, seed: 32 }) });
      const note = place(el("div", {}, over), { x: 960, y: 240, ax: 0.5, ay: 0.5 });
      Object.assign(note.style, { fontFamily: "IBM Plex Mono", fontSize: "36px", color: B, textShadow: textGlow("b"), border: `1.5px dashed ${ink("--phos-b-dim")}`, borderRadius: "10px", padding: "12px 30px", whiteSpace: "nowrap" });
      note.textContent = "forecast: B, 64%";
      const pick = txt(over, "you pick B", { x: 1310, y: 610, size: 22, color: A, ax: 0.5 });
      const score = place(el("div", { class: "pill b" }, over), { x: 960, y: 700, ax: 0.5, ay: 0.5 });
      score.innerHTML = "<span>(p<sub>chosen</sub> − 1)<sup>2</sup> = (0.64 − 1)<sup>2</sup> = 0.13</span>";
      score.style.fontSize = "28px";
      const brier = txt(over, "B = mean (p<sub>chosen</sub> − 1)<sup>2</sup>   ·   skill = 1 − B / 0.25", { x: 960, y: 790, size: 32, color: B, ax: 0.5, ay: 0.5, glow: "b" });
      // calibration2: the expected score against the reported probability, for a true p = 0.7.
      const PX0 = 190;
      const PX1 = 830;
      const PY0 = 780;
      const PY1 = 372;
      const qx = (q) => PX0 + q * (PX1 - PX0);
      const ey = (e) => PY0 - (e / 0.8) * (PY0 - PY1);
      const pTrue = 0.7;
      const EB = (q) => (q - pTrue) ** 2 + pTrue * (1 - pTrue);
      const g2 = el("g", {}, svg);
      const axes2 = el("g", {}, g2);
      el("line", { x1: PX0, y1: PY0, x2: PX1, y2: PY0, stroke: HAIR, "stroke-width": 2 }, axes2);
      el("line", { x1: PX0, y1: PY0, x2: PX0, y2: PY1 - 20, stroke: HAIR, "stroke-width": 2 }, axes2);
      el("line", { x1: qx(pTrue), y1: PY0, x2: qx(pTrue), y2: PY1 - 10, stroke: A_DIM, "stroke-width": 2, "stroke-dasharray": "6 6" }, axes2);
      const pg = el("g", {}, g2);
      pg.style.filter = GLOW.b;
      const para = el("path", { d: curveD(EB, qx, ey), fill: "none", stroke: B, "stroke-width": 3.2 }, pg);
      const paraLen = para.getTotalLength();
      para.setAttribute("stroke-dasharray", `${paraLen} ${paraLen}`);
      const marker = el("circle", { r: 10, fill: ink("--phos-b-hot"), opacity: 0 }, pg);
      const h2 = el("div", { class: "layer" }, over);
      txt(h2, "𝔼[score] = (q − p)<sup>2</sup> + p(1 − p)", { x: PX0, y: 232, size: 30, color: B, glow: "b" });
      txt(h2, "reported probability q", { x: (PX0 + PX1) / 2, y: PY0 + 34, size: 20, color: DIM, ax: 0.5 });
      txt(h2, "true p = 0.7", { x: qx(pTrue), y: PY1 - 18, size: 20, color: A_DIM, ax: 0.5, ay: 1 });
      [0, 0.5, 1].map((q) => txt(h2, String(q), { x: qx(q), y: PY0 + 8, size: 16, color: MUTE, ax: 0.5 }));
      txt(h2, "expected<br>score", { x: PX0 - 14, y: PY1, size: 17, color: MUTE, ax: 1, lh: 1.3, align: "right" });
      const honest = txt(h2, "honest: q = p scores best", { x: qx(pTrue) + 20, y: ey(EB(pTrue)) + 22, size: 22, color: B });
      // calibration3: a reliability diagram, with accuracy and skill beside it.
      const RX0 = 1080;
      const RX1 = 1520;
      const RY0 = 780;
      const RY1 = 340;
      const rx = (p) => RX0 + p * (RX1 - RX0);
      const ry = (p) => RY0 - p * (RY0 - RY1);
      const g3 = el("g", {}, svg);
      el("line", { x1: RX0, y1: RY0, x2: RX1, y2: RY0, stroke: HAIR, "stroke-width": 2 }, g3);
      el("line", { x1: RX0, y1: RY0, x2: RX0, y2: RY1, stroke: HAIR, "stroke-width": 2 }, g3);
      el("line", { x1: rx(0), y1: ry(0), x2: rx(1), y2: ry(1), stroke: MUTE, "stroke-width": 1.5, "stroke-dasharray": "5 5" }, g3);
      const binsG = el("g", {}, g3);
      binsG.style.filter = GLOW.b;
      const binDots = Array.from({ length: 5 }, () => el("circle", { r: 0, fill: B }, binsG));
      const binWh = Array.from({ length: 5 }, () => el("line", { stroke: B_DEEP, "stroke-width": 2 }, g3));
      const h3 = el("div", { class: "layer" }, over);
      txt(h3, "reliability · N_BINS = 5", { x: RX0, y: 282, size: 22, color: DIM });
      txt(h3, "it said · forecast", { x: (RX0 + RX1) / 2, y: RY0 + 14, size: 17, color: MUTE, ax: 0.5 });
      txt(h3, "it was right", { x: RX0 + 10, y: RY1 - 2, size: 17, color: MUTE, ay: 1 });
      txt(h3, "honest", { x: rx(0.8) + 12, y: ry(0.84), size: 17, color: MUTE, ay: 0.5 });
      txt(h3, "accuracy", { x: 1580, y: 400, size: 20, color: DIM });
      const accV = txt(h3, "", { x: 1580, y: 430, size: 52, color: SILK });
      txt(h3, "Brier skill", { x: 1580, y: 560, size: 20, color: DIM });
      const skV = txt(h3, "", { x: 1580, y: 590, size: 52, color: B, glow: "b" });
      const over3 = txt(h3, "", { x: 1580, y: 700, size: 18, color: B_DIM, lh: 1.5 });
      // Four hundred forecasts of duels whose true probability is known.
      const SIM = (() => {
        const R = rng(12345);
        return Array.from({ length: 400 }, () => {
          const tp = 0.5 + (R() - 0.5) * 0.5;
          return { tp, won: R() < tp };
        });
      })();
      const simulate = (s) => {
        const bins = Array.from({ length: 5 }, () => ({ n: 0, p: 0, o: 0 }));
        let br = 0;
        let hits = 0;
        for (const d of SIM) {
          const p = sig(s * Math.log(d.tp / (1 - d.tp)));
          const pc = d.won ? p : 1 - p;
          br += (pc - 1) ** 2;
          if (pc > 0.5) hits++;
          const k = Math.min(4, Math.floor(p * 5));
          bins[k].n++;
          bins[k].p += p;
          bins[k].o += d.won ? 1 : 0;
        }
        return { bins, acc: hits / SIM.length, skill: 1 - br / SIM.length / 0.25 };
      };
      // calibration4: one score per stream.
      const STREAMS = [["dealt duels", "duel", 330], ["PERFORM offers", "perform_offer", 250], ["heard edits", "heard_edit", 190], ["asserted edits", "self_report", 110]];
      const h4 = el("div", { class: "layer" }, over);
      const g4 = el("g", {}, svg);
      g4.style.filter = GLOW.b;
      const streams = STREAMS.map(([n, wire, w], i) => {
        const y = 380 + i * 104;
        return {
          n: txt(h4, n, { x: 190, y, size: 26, color: SILK, ay: 0.5 }),
          wire: txt(h4, wire, { x: 190, y: y + 30, size: 16, color: MUTE, ay: 0.5 }),
          bar: el("rect", { x: 480, y: y - 12, height: 24, width: 0, rx: 4, fill: B }, g4),
          w,
        };
      });
      txt(h4, "ProvenanceScore: a Brier skill for each kind of evidence", { x: 190, y: 800, size: 20, color: DIM });
      txt(h4, "Brier skill", { x: 480, y: 318, size: 18, color: MUTE });

      const v = [
        voiceLine(over, cap(l1, "Each duel is _forecast_ before you answer, then scored by Brier.")),
        voiceLine(over, cap(l2, "Brier is a _proper rule_, so only an honest probability scores best.")),
        voiceLine(over, cap(l3, "Accuracy cannot see _overconfidence_.")),
        voiceLine(over, cap(l4, "Each kind of evidence gets _its own score_.")),
      ];
      const tFc = wordTime(l1, "forecast");
      const tAnswer = wordTime(l1, "answer");
      const tBrier = wordTime(l1, "Brier");
      const tProper = wordTime(l2, "proper");
      const tHonest = wordTime(l2, "honest");
      const tOver = wordTime(l3, "overconfidence");
      const tKind = wordTime(l4, "kind");
      return (tl, t) => {
        // calibration1
        const cardsO = ramp(t, b.t0 - 0.2, b.t0 + 0.4, E.out3) * (1 - ramp(t, l2.t0 - 0.4, l2.t0 + 0.1));
        const picked = ramp(t, tAnswer, tAnswer + 0.3);
        cA.update(t, { o: cardsO });
        cB.update(t, { o: cardsO, picked: picked * cardsO });
        show(note, ramp(t, tFc - 0.1, tFc + 0.35, E.out3) * (1 - ramp(t, l2.t0 - 0.4, l2.t0 + 0.1)), 10);
        note.style.rotate = `${(-2 + 2 * ramp(t, tFc - 0.1, tFc + 0.35)).toFixed(2)}deg`;
        show(pick, picked * cardsO, 0);
        show(score, ramp(t, tBrier - 0.1, tBrier + 0.3, E.out3) * (1 - ramp(t, l2.t0 - 0.4, l2.t0 + 0.1)), 10);
        // The definition stays for the whole beat, moved up out of the way.
        const up = ramp(t, l2.t0 - 0.4, l2.t0 + 0.2, E.io3);
        show(brier, ramp(t, tBrier + 0.5, tBrier + 1.0), 0);
        place(brier, { x: 960, y: lerp(790, 122, up), ax: 0.5, ay: 0.5 });
        brier.style.fontSize = `${lerp(32, 30, up)}px`;
        // calibration2
        const on2 = ramp(t, l2.t0 - 0.2, l2.t0 + 0.4) * (1 - ramp(t, tKind - 0.5, tKind));
        g2.style.opacity = h2.style.opacity = on2.toFixed(3);
        para.setAttribute("stroke-dashoffset", (paraLen * (1 - ramp(t, tProper - 0.2, tProper + 0.7, E.io2))).toFixed(1));
        const mq = lerp(0.97, pTrue, ramp(t, tHonest - 0.2, tHonest + 0.6, E.io3));
        marker.setAttribute("cx", qx(mq).toFixed(1));
        marker.setAttribute("cy", ey(EB(mq)).toFixed(1));
        op(marker, ramp(t, tProper + 0.4, tProper + 0.7));
        show(honest, ramp(t, tHonest + 0.4, tHonest + 0.8), 0);
        // calibration3
        const on3 = ramp(t, l3.t0 - 0.6, l3.t0);
        g3.style.opacity = h3.style.opacity = on3.toFixed(3);
        const sOver = lerp(1, 3.0, ramp(t, tOver - 0.1, tOver + 1.0, E.io3));
        const sim = simulate(sOver);
        sim.bins.forEach((bn, k) => {
          const on = bn.n > 12 ? 1 : 0;
          const p = bn.n ? bn.p / bn.n : 0.5;
          const o = bn.n ? bn.o / bn.n : 0.5;
          binDots[k].setAttribute("cx", rx(p).toFixed(1));
          binDots[k].setAttribute("cy", ry(o).toFixed(1));
          binDots[k].setAttribute("r", (on * (4 + Math.sqrt(bn.n) * 0.7)).toFixed(1));
          const se = Math.sqrt(Math.max(o * (1 - o), 0.02) / Math.max(1, bn.n));
          binWh[k].setAttribute("x1", rx(p));
          binWh[k].setAttribute("x2", rx(p));
          binWh[k].setAttribute("y1", ry(clamp(o - 2 * se)));
          binWh[k].setAttribute("y2", ry(clamp(o + 2 * se)));
          op(binWh[k], on);
        });
        accV.textContent = `${Math.round(sim.acc * 100)}%`;
        skV.textContent = `${sim.skill >= 0 ? "+" : "−"}${Math.abs(sim.skill).toFixed(2)}`;
        const top = sim.bins[4];
        over3.innerHTML = top.n > 12 ? `top bin: says ${Math.round((100 * top.p) / top.n)}%,<br>right ${Math.round((100 * top.o) / top.n)}% of the time` : "";
        show(over3, ramp(t, tOver + 0.8, tOver + 1.2), 0);
        // calibration4
        const on4 = ramp(t, tKind - 0.3, tKind + 0.2);
        h4.style.opacity = on4.toFixed(3);
        streams.forEach((s, i) => {
          const u = ramp(t, tKind - 0.1 + i * 0.15, tKind + 0.5 + i * 0.15, E.out3);
          show(s.n, u, 0);
          show(s.wire, u, 0);
          s.bar.setAttribute("width", (s.w * u).toFixed(1));
        });
        const nexts = [l2.t0, l3.t0, l4.t0, b.t1 + 0.4];
        v.forEach((vv, i) => speak(vv, t, [l1, l2, l3, l4][i], nexts[i]));
        void tl;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// 6. ACQUISITION — random pairs, because a measured comparison said so.

function sceneAcquisition({ stage, beat, line }) {
  const b = beat("acquisition");
  const [l1, l2, l3] = ["acquisition1", "acquisition2", "acquisition3"].map(line);
  stage.scene({
    id: "acquisition", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      // The pool the web app asks from: forty patches.
      const GX = 160;
      const GY = 270;
      const GS = 66;
      const pos = Array.from({ length: 40 }, (_, i) => [GX + (i % 8) * GS, GY + Math.floor(i / 8) * GS]);
      const gP = el("g", {}, svg);
      const dots = pos.map(([x, y]) => el("circle", { cx: x, cy: y, r: 12, fill: A_DEEP, stroke: HAIR, "stroke-width": 1.5, opacity: 0 }, gP));
      const gL = el("g", {}, svg);
      gL.style.filter = GLOW.b;
      const pairLn = el("line", { stroke: B, "stroke-width": 2.5, "stroke-dasharray": "7 7", opacity: 0 }, gL);
      const rings = [0, 1].map(() => el("circle", { r: 20, fill: "none", stroke: B, "stroke-width": 3, opacity: 0 }, gL));
      const q = txt(over, "?", { size: 44, color: B, ax: 0.5, ay: 0.5, glow: "b" });
      const poolL = txt(over, "the pool · 40 patches", { x: GX - 12, y: GY - 76, size: 22, color: DIM });
      // The measured comparison (reference: search / acquisition).
      const CX = [1250, 1480, 1710];
      const tbl = el("div", { class: "layer" }, over);
      ["cos θ* ↑", "rank r ↑", "excess nats ↓"].map((h, i) => txt(tbl, h, { x: CX[i], y: 214, size: 22, color: DIM, ax: 0.5 }));
      txt(tbl, "static pool · 20 seeds × 72 duels · reference: search / acquisition", { x: 780, y: 160, size: 19, color: MUTE });
      const ROWS = [
        ["random", [0.46, 0.731, 0.211]],
        ["most informative (BALD)", [0.484, 0.762, 0.199]],
        ["Thompson", [0.416, 0.628, 0.254]],
      ].map(([n, vals], r) => {
        const y = 286 + r * 58;
        return {
          n: txt(tbl, n, { x: 780, y, size: 26, color: r === 0 ? A : SILK, ay: 0.5 }),
          v: vals.map((x, i) => txt(tbl, x.toFixed(3), { x: CX[i], y, size: 26, color: r === 0 ? A : SILK, ax: 0.5, ay: 0.5 })),
        };
      });
      const rule = el("line", { x1: 780, y1: 250, x2: 1820, y2: 250, stroke: HAIR, "stroke-width": 1.5, opacity: 0 }, svg);
      // Paired differences, ± 2 s.e.: tied, and lost.
      const DIFF = [
        { n: "BALD − random", y: 530, v: [[0.025, 0.058], [0.031, 0.046], [-0.012, 0.013]] },
        { n: "BALD − Thompson", y: 610, v: [[0.068, 0.062], [0.134, 0.044], [-0.055, 0.014]] },
      ];
      const SC = [700, 520, 1300];
      const zeroes = CX.map((x) => el("line", { x1: x, y1: 490, x2: x, y2: 650, stroke: MUTE, "stroke-width": 1.5, "stroke-dasharray": "4 5", opacity: 0 }, svg));
      const zl = CX.map((x) => txt(tbl, "0", { x, y: 486, size: 16, color: MUTE, ax: 0.5, ay: 1 }));
      const gD = el("g", {}, svg);
      gD.style.filter = GLOW.b;
      const diffs = DIFF.map((d) => ({
        n: txt(tbl, d.n, { x: 780, y: d.y, size: 22, color: B_DIM, ay: 0.5 }),
        bars: d.v.map(([m, e], i) => ({
          ln: el("line", { x1: CX[i] + (m - e) * SC[i], y1: d.y, x2: CX[i] + (m + e) * SC[i], y2: d.y, stroke: B, "stroke-width": 3, opacity: 0 }, gD),
          c0: el("line", { x1: CX[i] + (m - e) * SC[i], y1: d.y - 9, x2: CX[i] + (m - e) * SC[i], y2: d.y + 9, stroke: B, "stroke-width": 3, opacity: 0 }, gD),
          c1: el("line", { x1: CX[i] + (m + e) * SC[i], y1: d.y - 9, x2: CX[i] + (m + e) * SC[i], y2: d.y + 9, stroke: B, "stroke-width": 3, opacity: 0 }, gD),
          dot: el("circle", { cx: CX[i] + m * SC[i], cy: d.y, r: 6, fill: B, opacity: 0 }, gD),
        })),
      }));
      const tiedL = txt(tbl, "every interval crosses 0: a tie", { x: 780, y: 674, size: 19, color: B_DIM });
      const lostL = txt(tbl, "clear of 0: Thompson lost", { x: 1300, y: 674, size: 19, color: B_DIM });
      const se = txt(tbl, "± 2 s.e. of the paired difference", { x: 780, y: 462, size: 18, color: MUTE });
      // The duel, dealt at random.
      const duelU = el("div", { class: "layer" }, under);
      const duelG = el("g", {}, svg);
      const dA = miniCard(duelU, duelG, { x: 150, y: 640, w: 250, h: 110, side: "A", name: "#13", wave: voiceWave({ f: 1.8, bright: 0.4, seed: 51 }) });
      const dB = miniCard(duelU, duelG, { x: 430, y: 640, w: 250, h: 110, side: "B", name: "#34", wave: voiceWave({ f: 2.5, bright: 0.7, seed: 52 }) });
      const probe = place(el("div", { class: "pill b" }, over, "◇ unbiased probe"), { x: 415, y: 812, ax: 0.5, ay: 0.5 });
      const foot = txt(over, "Acquisition::Random (default) · BALD and Thompson are kept so the comparison stays runnable", { x: 780, y: 860, size: 18, color: MUTE });
      const PAIRS = [[3, 21], [26, 12], [9, 38]];
      const HOPS = [[5, 30], [17, 2], [36, 11], [22, 7], [13, 34]];
      const v = [
        voiceLine(over, cap(l1, "Which pair should it ask about?")),
        voiceLine(over, cap(l2, "Picking the most informative pair only _tied_ random pairs. Thompson sampling _lost_.")),
        voiceLine(over, cap(l3, "So pairs are *random*, and every duel is also _an unbiased check_.")),
      ];
      const tTied = wordTime(l2, "tied");
      const tLost = wordTime(l2, "lost");
      const tRand = wordTime(l3, "random");
      const tUnb = wordTime(l3, "unbiased");
      const tDuel = wordTime(l3, "duel");
      return (tl, t) => {
        const gin = ramp(t, b.t0 - 0.3, b.t0 + 0.5);
        const dx = lerp(570, 0, ramp(t, l2.t0 - 0.55, l2.t0 + 0.15, E.io3));
        gP.setAttribute("transform", `translate(${dx.toFixed(1)} 0)`);
        gL.setAttribute("transform", `translate(${dx.toFixed(1)} 0)`);
        dots.forEach((d, i) => op(d, ramp(t, b.t0 - 0.3 + i * 0.012, b.t0 + 0.2 + i * 0.012)));
        place(poolL, { x: GX - 12 + dx, y: GY - 76 });
        show(poolL, gin, 0);
        // "Which pair?": a pair, then another.
        const qOn = fade(t, l1.t0, l1.t0 + 0.3, l2.t0 + 0.2, l2.t0 + 0.6);
        const qi = clamp(Math.floor((t - l1.t0) / 0.75), 0, PAIRS.length - 1);
        let pair = PAIRS[qi];
        // acquisition3: two dots, uniformly at random.
        const rOn = ramp(t, tRand - 0.6, tRand - 0.4);
        let rPair = null;
        if (t >= tRand - 0.6) {
          const hop = Math.floor((t - (tRand - 0.6)) / 0.12);
          rPair = hop < HOPS.length ? HOPS[hop] : [13, 34];
        }
        const P0 = rPair || pair;
        const [pa, pb] = [pos[P0[0]], pos[P0[1]]];
        pairLn.setAttribute("x1", pa[0]);
        pairLn.setAttribute("y1", pa[1]);
        pairLn.setAttribute("x2", pb[0]);
        pairLn.setAttribute("y2", pb[1]);
        op(pairLn, Math.max(qOn, rOn) * 0.9);
        rings.forEach((r, i) => {
          const p = i ? pb : pa;
          r.setAttribute("cx", p[0]);
          r.setAttribute("cy", p[1]);
          op(r, Math.max(qOn, rOn));
        });
        place(q, { x: (pa[0] + pb[0]) / 2 + dx, y: (pa[1] + pb[1]) / 2 - 26, ax: 0.5, ay: 0.5 });
        show(q, qOn, 0);
        // acquisition2: the table, then the differences.
        const tOn = ramp(t, l2.t0 - 0.3, l2.t0 + 0.3) * (1 - 0.45 * ramp(t, l3.t0, l3.t0 + 0.6));
        tbl.style.opacity = tOn.toFixed(3);
        gD.style.opacity = tOn.toFixed(3);
        op(rule, tOn);
        ROWS.forEach((r, i) => {
          const u = ramp(t, l2.t0 - 0.2 + i * 0.2, l2.t0 + 0.3 + i * 0.2);
          const dim = i === 2 ? 1 - 0.6 * ramp(t, tLost, tLost + 0.4) : 1;
          show(r.n, u * dim, 0);
          r.v.forEach((x) => show(x, u * dim, 0));
        });
        const u1 = ramp(t, tTied - 0.2, tTied + 0.4);
        const u2 = ramp(t, tLost - 0.2, tLost + 0.4);
        [u1, u2].forEach((u, r) => {
          show(diffs[r].n, u, 0);
          diffs[r].bars.forEach((bb) => {
            for (const k of [bb.ln, bb.c0, bb.c1, bb.dot]) op(k, u);
          });
        });
        zeroes.forEach((z) => op(z, u1 * tOn));
        zl.forEach((z) => show(z, u1, 0));
        show(se, u1, 0);
        show(tiedL, ramp(t, tTied + 0.4, tTied + 0.8), 0);
        show(lostL, ramp(t, tLost + 0.3, tLost + 0.7), 0);
        // acquisition3: dealt as a duel.
        const deal = ramp(t, tDuel - 0.2, tDuel + 0.3, E.out3);
        dA.update(t, { o: deal });
        dB.update(t, { o: deal });
        show(probe, ramp(t, tUnb - 0.1, tUnb + 0.3, E.outBack), -18);
        show(foot, ramp(t, tUnb + 0.4, tUnb + 0.9), 6);
        const nexts = [l2.t0, l3.t0, b.t1 + 0.4];
        v.forEach((vv, i) => speak(vv, t, [l1, l2, l3][i], nexts[i]));
        void tl;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// The landscape the search runs on: the grammar's prior over terms (green) and
// the Boltzmann target (amber), in one dimension.

const LAND = {
  prior: (x) =>
    0.95 * Math.exp(-((x - 0.1) ** 2) / 0.012) + 0.6 * Math.exp(-((x - 0.34) ** 2) / 0.02) + 0.3 * Math.exp(-((x - 0.63) ** 2) / 0.02) + 0.14 * Math.exp(-((x - 0.86) ** 2) / 0.015) + 0.03,
  util: (x) => 1.25 * Math.exp(-((x - 0.63) ** 2) / 0.018) + 0.35 * Math.exp(-((x - 0.36) ** 2) / 0.01) - 0.35,
};
const target = (x, beta) => LAND.prior(x) * Math.exp(beta * LAND.util(x));
const targetMax = (beta) => {
  let m = 0;
  for (let i = 0; i <= 400; i++) m = Math.max(m, target(i / 400, beta));
  return m;
};

function landscape(svg, over, { X0 = 150, X1 = 1250, base = 760, H = 400 } = {}) {
  const X = (x) => X0 + x * (X1 - X0);
  const g = el("g", {}, svg);
  el("line", { x1: X0, y1: base, x2: X1, y2: base, stroke: HAIR, "stroke-width": 2 }, g);
  const gP = el("g", {}, g);
  gP.style.filter = GLOW.a;
  const pMax = targetMax(0);
  const prior = el("path", { d: curveD(LAND.prior, X, (v) => base - (v / pMax) * H), fill: "none", stroke: A, "stroke-width": 3 }, gP);
  const pLen = prior.getTotalLength();
  prior.setAttribute("stroke-dasharray", `${pLen} ${pLen}`);
  const gT = el("g", {}, g);
  gT.style.filter = GLOW.b;
  const tgt = el("path", { fill: inkA("--phos-b", 0.07), stroke: B, "stroke-width": 3.2 }, gT);
  const util = el("path", { d: curveD(LAND.util, X, (v) => base - 90 - v * 150), fill: "none", stroke: B_DIM, "stroke-width": 2, "stroke-dasharray": "3 7", opacity: 0 }, g);
  const legend = txt(over, `<span style='color:${ink("--phos-a")}'>— p<sub>grammar</sub>(x)</span>&nbsp;&nbsp;&nbsp;<span style='color:${ink("--phos-b")}'>— π<sub>β</sub>(x)</span>`, { x: X0, y: base + 22, size: 22 });
  const axisL = txt(over, "x · terms, simpler → deeper", { x: X1, y: base + 22, size: 18, color: MUTE, ax: 1 });
  const utilL = txt(over, "··· 𝔼[u<sub>θ</sub>(x)]", { x: X0 + legend.getBoundingClientRect().width + 40, y: base + 22, size: 22, color: B_DIM });
  return {
    g,
    X,
    base,
    H,
    y: (x, beta) => base - (target(x, beta) / targetMax(beta)) * H,
    prior(u) {
      prior.setAttribute("stroke-dashoffset", (pLen * (1 - clamp(u))).toFixed(1));
    },
    priorOpacity(o) {
      gP.style.opacity = o;
    },
    target(beta, o = 1) {
      const m = targetMax(beta);
      const d = curveD((x) => target(x, beta) / m, X, (v) => base - v * H, 240);
      tgt.setAttribute("d", `${d} L${X1} ${base} L${X0} ${base} Z`);
      gT.style.opacity = o;
    },
    util(o) {
      op(util, o);
      show(utilL, o, 0);
    },
    labels(o) {
      show(legend, o, 0);
      show(axisL, o, 0);
    },
  };
}

// ---------------------------------------------------------------------------
// 7. TARGET — π_β ∝ p_grammar · e^{β𝔼[u]}, and the one dial.

function sceneTarget({ stage, beat, line }) {
  const b = beat("target");
  const [l1, l2, l3] = ["target1", "target2", "target3"].map(line);
  stage.scene({
    id: "target", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { svg, over } = stack(layer);
      const f = txt(over, "π<sub>β</sub>(x) ∝ p<sub>grammar</sub>(x) · e<sup>β 𝔼[u<sub>θ</sub>(x)]</sup>", { x: 700, y: 170, size: 50, color: SILK, ax: 0.5, ay: 0.5 });
      const land = landscape(svg, over, { X0: 150, X1: 1250, base: 760, H: 400 });
      // What each factor does (reference: search / target).
      const roleP = txt(over, `p<sub>grammar</sub>(x)<br><span style='color:${ink("--silk-dim")};font-size:20px'>supplies parsimony</span>`, { x: 1370, y: 340, size: 30, color: A, lh: 1.5 });
      const roleU = txt(over, `e<sup>β 𝔼[u<sub>θ</sub>(x)]</sup><br><span style='color:${ink("--silk-dim")};font-size:20px'>supplies direction</span>`, { x: 1370, y: 470, size: 30, color: B, lh: 1.5 });
      // target2: three terms, depth 1–3, and the prior mass each is left with.
      const TX = 1370;
      const BW = 300;
      const treeG = el("g", {}, svg);
      const treeH = el("div", { class: "layer" }, over);
      const TREES = [["saw"], ["ladder", "saw"], ["verb", "ladder", "saw"]];
      const MASS = [1, 0.46, 0.21];
      const LBL = ["p(x)", "p(x) × 0.6 w<sub>op</sub> …", "p(x) × (0.6 w<sub>op</sub> …)<sup>2</sup>"];
      const trees = TREES.map((nodes, i) => {
        const y = 300 + i * 160;
        let px = TX;
        const pills = nodes.map((n) => {
          const d = place(el("div", { class: "pill a" }, treeH, n), { x: px, y, ay: 0.5 });
          Object.assign(d.style, { fontSize: "19px", padding: "6px 14px" });
          const w = d.getBoundingClientRect().width;
          d.dataset.x0 = px;
          d.dataset.x1 = px + w;
          px += w + 34;
          return d;
        });
        const links = pills.slice(1).map((d, j) => el("line", { x1: Number(pills[j].dataset.x1) + 3, y1: y, x2: Number(d.dataset.x0) - 3, y2: y, stroke: A_DEEP, "stroke-width": 2.5 }, treeG));
        const frame = el("rect", { x: TX, y: y + 34, width: BW, height: 16, rx: 3, fill: "none", stroke: HAIR, "stroke-width": 1.5 }, treeG);
        const bar = el("rect", { x: TX, y: y + 34, width: 0, height: 16, rx: 3, fill: A_DIM }, treeG);
        const lbl = txt(treeH, LBL[i], { x: TX, y: y + 60, size: 17, color: A_DIM });
        return { pills, links, frame, bar, lbl, y };
      });
      const tCap = txt(treeH, "each level multiplies in another #leaf<br>Bernoulli that came out processor<br>(1 − source_prob = 0.6)", { x: TX, y: 748, size: 17, color: MUTE, lh: 1.5 });
      const pen = struck(treeH, "− λ · size", { x: TX + 190, y: 222, size: 34, color: B_DIM, ax: 0.5, ay: 0.5, strike: SILK });
      // target3: β as a knob.
      const KX = 1600;
      const KY = 470;
      const KR = 72;
      const kn = knob(svg, { cx: KX, cy: KY, r: KR, color: "b" });
      const knH = el("div", { class: "layer" }, over);
      txt(knH, "β", { x: KX, y: KY + KR + 44, size: 44, color: B, ax: 0.5, ay: 0.5, glow: "b" });
      const bVal = txt(knH, "", { x: KX, y: KY + KR + 92, size: 26, color: SILK, ax: 0.5, ay: 0.5 });
      const angOf = (beta) => ((-225 + 270 * clamp(beta / 8)) * Math.PI) / 180;
      const tickAt = (beta, text, side) => {
        const a = angOf(beta);
        const r0 = KR + 24;
        const x = KX + Math.cos(a) * (KR + 46);
        const y = KY + Math.sin(a) * (KR + 46);
        const tk = el("line", { x1: KX + Math.cos(a) * r0, y1: KY + Math.sin(a) * r0, x2: KX + Math.cos(a) * (r0 + 12), y2: KY + Math.sin(a) * (r0 + 12), stroke: B_DIM, "stroke-width": 2.5, opacity: 0 }, svg);
        const tt = txt(knH, text, { x, y, size: 18, color: B_DIM, ax: side, ay: 0.5, align: side === 1 ? "right" : "left", lh: 1.4 });
        return { tk, tt };
      };
      const ticks = [tickAt(0, "0 · browse the prior", 1), tickAt(2, `2 · shipped<br><span style='color:${ink("--silk-mute")}'>SessionConfig::beta</span>`, 1), tickAt(8, "8 · optimizer", 0)];
      const foot = txt(
        over,
        "With a posterior, the grammar's categorical weights are tilted by the model (η = 0.6, each multiplier clamped to ¼…4, proposal_tilt),<br>and that tilted grammar is the prior the walk runs under:  π′ ∝ p<sub>tilted</sub> · e<sup>β𝔼[u]</sup>  — reference, Proposals.",
        { x: 150, y: 840, size: 17, color: MUTE, lh: 1.6 },
      );
      const v = [
        voiceLine(over, cap(l1, "Search aims at a _Boltzmann target_, the *grammar's prior* times the exponential of beta times expected utility.")),
        voiceLine(over, cap(l2, "The prior supplies *parsimony* as a probability, not a penalty to tune.")),
        voiceLine(over, cap(l3, "_Beta_, at two, is the one dial between browsing and optimizing.")),
      ];
      const tBoltz = wordTime(l1, "Boltzmann");
      const tPrior = wordTime(l1, "prior");
      const tExp = wordTime(l1, "exponential");
      const tUtil = wordTime(l1, "expected");
      const tPars = wordTime(l2, "parsimony");
      const tPen = wordTime(l2, "penalty");
      const tTwo = wordTime(l3, "two");
      const tBrowse = wordTime(l3, "browsing");
      const tOpt = wordTime(l3, "optimizing");
      return (tl, t) => {
        show(f, ramp(t, b.t0 - 0.1, b.t0 + 0.5, E.out3), 10);
        f.style.textShadow = textGlow("b", 1.6 * fade(t, tBoltz - 0.1, tBoltz + 0.2, tBoltz + 0.8, tBoltz + 1.4));
        land.prior(ramp(t, tPrior - 0.2, tPrior + 0.8, E.io2));
        land.labels(ramp(t, tPrior, tPrior + 0.5));
        // β over time: rises out of the prior to 2, then the dial.
        const rise = ramp(t, tExp - 0.1, tExp + 1.1, E.io3);
        let beta = 2 * rise;
        const k3 = ramp(t, l3.t0 - 0.4, l3.t0 + 0.1);
        if (t > tTwo - 0.2) {
          beta = 2;
          beta = lerp(beta, 0, ramp(t, tBrowse - 0.15, tBrowse + 0.45, E.io3));
          beta = lerp(beta, 8, ramp(t, tOpt - 0.15, tOpt + 0.6, E.io3));
          beta = lerp(beta, 2, ramp(t, l3.t1 + 0.35, l3.t1 + 1.1, E.io3));
        }
        land.target(beta, ramp(t, tExp - 0.1, tExp + 0.3));
        const roles = 1 - ramp(t, l2.t0 - 0.4, l2.t0);
        show(roleP, ramp(t, tPrior + 0.2, tPrior + 0.7) * roles, 8);
        show(roleU, ramp(t, tExp + 0.4, tExp + 0.9) * roles, 8);
        land.util(ramp(t, tUtil, tUtil + 0.4) * (1 - ramp(t, l2.t0, l2.t0 + 0.5)) * 0.9);
        // target2
        const on2 = ramp(t, l2.t0 - 0.3, l2.t0 + 0.2) * (1 - ramp(t, l3.t0 - 0.4, l3.t0));
        treeG.style.opacity = treeH.style.opacity = on2.toFixed(3);
        trees.forEach((tr, i) => {
          const u = ramp(t, tPars - 0.4 + i * 0.3, tPars + 0.1 + i * 0.3, E.out3);
          tr.pills.forEach((p) => show(p, u, 8));
          tr.links.forEach((k) => op(k, u));
          op(tr.frame, u);
          tr.bar.setAttribute("width", (BW * lerp(i ? MASS[i - 1] : MASS[0], MASS[i], ramp(t, tPars + 0.2 + i * 0.3, tPars + 0.6 + i * 0.3, E.io3)) * u).toFixed(1));
          show(tr.lbl, u, 0);
        });
        show(tCap, ramp(t, tPars + 0.9, tPars + 1.3), 6);
        show(pen.d, fade(t, tPen - 0.2, tPen + 0.1, tPen + 1.3, tPen + 1.8), 0);
        pen.set(ramp(t, tPen + 0.2, tPen + 0.6));
        // target3
        kn.g.style.opacity = knH.style.opacity = k3.toFixed(3);
        kn.set(beta / 8, { col: "b" });
        bVal.textContent = `β = ${beta.toFixed(1)}`;
        const tk = [fade(t, tBrowse - 0.1, tBrowse + 0.3, tOpt - 0.2, tOpt + 0.2), ramp(t, tTwo - 0.1, tTwo + 0.3), ramp(t, tOpt - 0.1, tOpt + 0.3)];
        ticks.forEach((k, i) => {
          op(k.tk, k3 * (0.5 + 0.5 * tk[i]));
          show(k.tt, k3 * (0.35 + 0.65 * tk[i]), 0);
          k.tt.style.color = tk[i] > 0.5 ? B : B_DIM;
        });
        show(foot, ramp(t, l2.t1 + 0.1, l2.t1 + 0.6), 6);
        const nexts = [l2.t0, l3.t0, b.t1 + 0.4];
        v.forEach((vv, i) => speak(vv, t, [l1, l2, l3][i], nexts[i]));
        void tl;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// 8. REFINE — MH on the trace, ten short walks, and what is kept.

function sceneRefine({ stage, beat, line }) {
  const b = beat("refine");
  const [l1, l2, l3] = ["refine1", "refine2", "refine3"].map(line);
  stage.scene({
    id: "refine", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { svg, over } = stack(layer);
      // refine1: the genome as a trace, and two kinds of move.
      const tG = el("g", {}, svg);
      const tH = el("div", { class: "layer" }, over);
      const NODES = [
        { n: "verb", x: 560, y: 250, addr: "node#op" },
        { n: "ladder", x: 560, y: 450, addr: "node/0#cut", val: true },
        { n: "saw", x: 380, y: 650, addr: "node/0/0#src" },
        { n: "s&h", x: 740, y: 650, addr: "node/0/m#mod", mod: true },
      ];
      const EDGES = [[0, 1], [1, 2], [1, 3]];
      EDGES.forEach(([a, c]) => {
        const p = NODES[a];
        const q = NODES[c];
        el("line", { x1: p.x, y1: p.y + 66, x2: q.x, y2: q.y - 28, stroke: A_DEEP, "stroke-width": 2.5, "stroke-dasharray": NODES[c].mod ? "6 6" : null }, tG);
      });
      const pills = NODES.map((nd) => {
        const d = place(el("div", { class: "pill a" }, tH, nd.n), { x: nd.x, y: nd.y, ax: 0.5, ay: 0.5 });
        Object.assign(d.style, { fontSize: "26px", padding: "10px 26px" });
        const ad = txt(tH, nd.addr, { x: nd.x, y: nd.y + 36, size: 20, color: B, ax: 0.5 });
        return { d, ad };
      });
      const cutVal = txt(tH, "", { x: NODES[1].x + pills[1].ad.getBoundingClientRect().width / 2 + 10, y: NODES[1].y + 36, size: 20, color: B });
      const modL = txt(tH, "mod", { x: 676, y: 560, size: 16, color: MUTE, ax: 0.5 });
      const fe = place(el("div", { class: "pill" }, tH, "fugue-evo · adaptive single-site MH on the trace"), { x: 1020, y: 250, ay: 0.5 });
      const mv1 = txt(tH, "parameter move", { x: 1020, y: 380, size: 26, color: B });
      const mv1s = txt(tH, "node/0#cut  0.42 → 0.57", { x: 1020, y: 420, size: 22, color: DIM });
      const mv2 = txt(tH, "structural move", { x: 1020, y: 520, size: 26, color: B });
      const mv2s = txt(tH, `node/0/m regenerated: s&amp;h → steps<br><span style='color:${ink("--silk-mute")}'>reversible jump · fugue handles the Jacobian bookkeeping</span>`, { x: 1020, y: 560, size: 22, color: DIM, lh: 1.55 });
      const acc = txt(tH, "accept with min(1, π<sub>β</sub>(x′) q(x | x′) / π<sub>β</sub>(x) q(x′ | x))", { x: 1020, y: 700, size: 22, color: B_DIM });
      // refine2/3: the landscape, the pool on it, and ten walks of forty steps.
      const lG = el("g", {}, svg);
      const lH = el("div", { class: "layer" }, over);
      const land = landscape(lG, lH, { X0: 150, X1: 1450, base: 720, H: 420 });
      land.prior(1);
      land.priorOpacity(0.35);
      land.target(2);
      land.labels(1);
      land.util(0);
      const BETA = 2;
      const logpi = (x) => (x <= 0.005 || x >= 0.995 ? -Infinity : Math.log(target(x, BETA)));
      // A sample from π_β, as a histogram (the contrast for refine3).
      const NB = 52;
      const R = rng(77);
      const cdf = [];
      {
        let s = 0;
        for (let i = 0; i <= 1000; i++) {
          s += target(i / 1000, BETA);
          cdf.push(s);
        }
        for (let i = 0; i < cdf.length; i++) cdf[i] /= s;
      }
      const draw = () => {
        const u = R();
        let i = 0;
        while (i < cdf.length - 1 && cdf[i] < u) i++;
        return i / 1000;
      };
      const hist = new Array(NB).fill(0);
      for (let i = 0; i < 1500; i++) hist[Math.min(NB - 1, Math.floor(draw() * NB))]++;
      const hMax = Math.max(...hist);
      const histG = el("g", { opacity: 0 }, lG);
      hist.forEach((c, i) => {
        const x0 = land.X(i / NB);
        const w = land.X((i + 1) / NB) - x0;
        const h = (c / hMax) * 330;
        el("rect", { x: x0 + 1, y: land.base - h, width: w - 2, height: h, fill: B_DEEP }, histG);
      });
      histG.parentNode.insertBefore(histG, histG.parentNode.firstChild);
      const histL = txt(lH, "the bars: where a real sample from π<sub>β</sub> would land", { x: land.X(0.08), y: 250, size: 19, color: B_DIM });
      // The pool: forty patches drawn from the target, the ten best by 𝔼[u] ringed.
      const pool = Array.from({ length: 40 }, () => draw());
      const best = pool.map((x, i) => [LAND.util(x), i]).sort((a, c) => c[0] - a[0]).slice(0, 10).map((p) => p[1]);
      const pG = el("g", {}, lG);
      const poolDots = pool.map((x) => el("circle", { cx: land.X(x), cy: land.y(x, BETA), r: 6, fill: A_DEEP, stroke: A_DIM, "stroke-width": 1.5 }, pG));
      const wG = el("g", {}, lG);
      wG.style.filter = GLOW.b;
      const walks = best.map((i, w) => {
        const r = rng(1000 + w);
        const g = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
        let x = pool[i];
        const path = [x];
        for (let s = 0; s < 40; s++) {
          const p = x + g() * 0.035;
          if (Math.log(r() + 1e-12) < logpi(p) - logpi(x)) x = p;
          path.push(x);
        }
        const ring = el("circle", { cx: land.X(pool[i]), cy: land.y(pool[i], BETA), r: 13, fill: "none", stroke: B, "stroke-width": 2.5, opacity: 0 }, wG);
        const dot = el("circle", { r: 8, fill: ink("--phos-b-hot"), opacity: 0 }, wG);
        const trail = el("polyline", { fill: "none", stroke: B, "stroke-width": 1.6, opacity: 0 }, wG);
        const flag = el("path", { fill: B, opacity: 0 }, wG);
        const endX = land.X(x);
        const tick = el("line", { x1: endX, y1: land.base - 16, x2: endX, y2: land.base + 16, stroke: ink("--phos-b-hot"), "stroke-width": 3, opacity: 0 }, wG);
        return { path, ring, dot, trail, flag, tick };
      });
      const budget = txt(lH, "refine_seeds = 10 · refine_steps = 40  (2 × N_OPS)", { x: 150, y: 150, size: 26, color: B, glow: "b" });
      const endMean = walks.reduce((a2, w) => a2 + w.path[40], 0) / walks.length;
      const endsL = txt(lH, "↑ where the ten walks ended", { x: land.X(endMean), y: land.base + 52, size: 18, color: ink("--phos-b-hot"), ax: 0.5 });
      const stepL = txt(lH, "", { x: 150, y: 196, size: 20, color: DIM });
      // The pool strip the ends drop into.
      const SX = 260;
      const SY = 850;
      const slots = Array.from({ length: 10 }, (_, i) => el("rect", { x: SX + i * 70, y: SY - 22, width: 56, height: 44, rx: 8, fill: "none", stroke: HAIR, "stroke-width": 1.5, opacity: 0 }, lG));
      const stripL = txt(lH, "into the pool", { x: SX - 20, y: SY, size: 20, color: DIM, ax: 1, ay: 0.5 });
      const keepL = txt(lH, "RefineKeep::Last — local hill-climbing on π<sub>β</sub>, not a draw from it", { x: SX + 720, y: SY, size: 20, color: B, ay: 0.5 });
      const v = [
        voiceLine(over, cap(l1, "Refinement is _Metropolis-Hastings_ on the trace, through fugue-evo.")),
        voiceLine(over, cap(l2, "It walks forty steps from each of the ten best patches.")),
        voiceLine(over, cap(l3, "Keeping where each walk ends _climbs the target_ instead of sampling it, which suits a shortlist.")),
      ];
      const tMH = wordTime(l1, "Metropolis");
      const tTrace = wordTime(l1, "trace");
      const tFugue = wordTime(l1, "fugue-evo");
      const tWalk = wordTime(l2, "walks");
      const tForty = wordTime(l2, "forty");
      const tTen = wordTime(l2, "ten");
      const tEnds = wordTime(l3, "ends");
      const tSamp = wordTime(l3, "sampling");
      const tClimb = wordTime(l3, "climbs");
      const walkEnd = l2.t1 + 0.5;
      return (tl, t) => {
        const on1 = 1 - ramp(t, l2.t0 - 0.45, l2.t0);
        tG.style.opacity = tH.style.opacity = on1.toFixed(3);
        pills.forEach((p, i) => {
          show(p.d, ramp(t, b.t0 - 0.2 + i * 0.12, b.t0 + 0.2 + i * 0.12), 8);
          show(p.ad, ramp(t, b.t0 + 0.2 + i * 0.12, b.t0 + 0.6 + i * 0.12), 0);
        });
        // Parameter move: #cut flashes and takes a new value.
        const f1 = fade(t, tMH - 0.05, tMH + 0.15, tMH + 0.7, tMH + 1.3);
        pills[1].ad.style.textShadow = textGlow("b", 1 + 2.5 * f1);
        pills[1].ad.style.color = mixHex(B, ink("--phos-b-flash"), f1);
        const cv = lerp(0.42, 0.57, ramp(t, tMH + 0.1, tMH + 0.5));
        cutVal.textContent = `= ${cv.toFixed(2)}`;
        show(cutVal, ramp(t, b.t0 + 0.6, b.t0 + 1.0), 0);
        show(mv1, ramp(t, tMH - 0.1, tMH + 0.3), 8);
        show(mv1s, ramp(t, tMH + 0.1, tMH + 0.5), 8);
        // Structural move: the modulation leaf is regenerated.
        const f2 = ramp(t, tTrace - 0.1, tTrace + 0.4);
        const flick = f2 > 0 && f2 < 1 ? Math.floor(t * 12) % 3 : f2 >= 1 ? 3 : 0;
        pills[3].d.textContent = ["s&h", "lfo", "env", "steps"][flick];
        pills[3].d.style.borderColor = f2 > 0 ? mixHex(A_DEEP, B, fade(t, tTrace - 0.1, tTrace + 0.2, tTrace + 0.8, tTrace + 1.4)) : "";
        show(mv2, ramp(t, tTrace - 0.1, tTrace + 0.3), 8);
        show(mv2s, ramp(t, tTrace + 0.1, tTrace + 0.5), 8);
        show(fe, ramp(t, tFugue - 0.3, tFugue + 0.2), 8);
        show(acc, ramp(t, tFugue + 0.3, tFugue + 0.8), 6);
        show(modL, ramp(t, b.t0 + 0.4, b.t0 + 0.8), 0);
        // refine2
        const on2 = ramp(t, l2.t0 - 0.4, l2.t0 + 0.1);
        lG.style.opacity = lH.style.opacity = on2.toFixed(3);
        const ringU = ramp(t, tTen - 0.2, tTen + 0.3);
        const run = ramp(t, tWalk, walkEnd, E.lin);
        const k = Math.min(40, Math.floor(run * 41));
        stepL.textContent = t > tWalk ? `step ${k} / 40` : "";
        show(budget, ramp(t, tForty - 0.1, tForty + 0.4), 8);
        show(stepL, ramp(t, tWalk, tWalk + 0.3), 0);
        poolDots.forEach((d, i) => op(d, best.includes(i) ? 1 : 1 - 0.4 * ringU));
        const drop = ramp(t, tEnds + 0.4, tEnds + 1.2, E.io3);
        walks.forEach((w, i) => {
          op(w.ring, Math.max(ringU * (1 - ramp(t, tWalk + 0.2, tWalk + 0.8)), t < tWalk ? ramp(t, l2.t0 - 0.2, l2.t0 + 0.3) : 0));
          const x = w.path[k];
          const px = land.X(x);
          const py = land.y(x, BETA);
          const walking = t >= tWalk ? 1 : 0;
          // "ends": each final state is flagged, then drops into its slot.
          const sx = SX + i * 70 + 28;
          const dx = lerp(px, sx, drop);
          const dy = lerp(py, SY, drop);
          w.dot.setAttribute("cx", dx.toFixed(1));
          w.dot.setAttribute("cy", dy.toFixed(1));
          op(w.dot, walking);
          const pts = w.path.slice(Math.max(0, k - 10), k + 1).map((xx) => `${land.X(xx).toFixed(1)},${land.y(xx, BETA).toFixed(1)}`).join(" ");
          w.trail.setAttribute("points", pts);
          op(w.trail, walking * 0.6 * (1 - ramp(t, tEnds, tEnds + 0.5)));
          const fl = ramp(t, tEnds - 0.1, tEnds + 0.25) * (1 - drop);
          w.flag.setAttribute("d", `M${px} ${py - 10} L${px} ${py - 44} L${px + 22} ${py - 37} L${px} ${py - 30} Z`);
          op(w.flag, fl);
          op(w.tick, ramp(t, tEnds + 0.6, tEnds + 1.0));
        });
        slots.forEach((s, i) => op(s, ramp(t, tEnds + 0.1 + i * 0.03, tEnds + 0.4 + i * 0.03)));
        show(stripL, ramp(t, tEnds + 0.1, tEnds + 0.5), 0);
        show(endsL, ramp(t, tEnds + 0.8, tEnds + 1.2), 0);
        show(keepL, ramp(t, tClimb + 0.2, tClimb + 0.7), 0);
        op(histG, 0.4 * ramp(t, tSamp - 0.2, tSamp + 0.5));
        show(histL, ramp(t, tSamp + 0.1, tSamp + 0.6), 0);
        const nexts = [l2.t0, l3.t0, b.t1 + 0.4];
        v.forEach((vv, i) => speak(vv, t, [l1, l2, l3][i], nexts[i]));
        void tl;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// 9. LOCKS — exact conditioning, and why births are checked too.

function sceneLocks({ stage, beat, line }) {
  const b = beat("locks");
  const [l1, l2, l3] = ["locks1", "locks2", "locks3"].map(line);
  stage.scene({
    id: "locks", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { svg, over } = stack(layer);
      const TRACE = [
        ["node#op", "verb", false],
        ["node/0#cut", "0.42", true],
        ["node/0#res", "0.61", true],
        ["node/0/m#mod", "s&amp;h", false],
        ["node/0/m#rate", "0.30", false],
        ["amp#release", "0.55", false],
      ];
      const TX = 140;
      const TY = 250;
      const TL = txt(over, "the trace x", { x: TX, y: TY - 70, size: 22, color: DIM });
      const rows = TRACE.map(([a, val, locked], i) => {
        const y = TY + i * 62;
        return {
          a: txt(over, a, { x: TX, y, size: 30, color: locked ? B : SILK, ay: 0.5 }),
          v: txt(over, val, { x: TX + 330, y, size: 30, color: DIM, ay: 0.5 }),
          lock: locked ? padlock(svg, TX + 470, y, 1.2) : null,
          locked,
          y,
        };
      });
      const LL = txt(over, "L = the locked addresses", { x: TX, y: TY + 6 * 62, size: 18, color: B_DIM });
      const f = txt(over, "π<sub>β</sub>(x<sub>¬L</sub> | x<sub>L</sub>)", { x: 1300, y: 190, size: 60, color: B, ax: 0.5, ay: 0.5, glow: "b" });
      const mwg = txt(over, "Metropolis-within-Gibbs", { x: 1300, y: 262, size: 26, color: DIM, ax: 0.5, ay: 0.5 });
      // locks2: three proposals, each rejected.
      const PR = [
        { verb: "change", what: "node/0#cut  0.42 → 0.57", row: 1 },
        { verb: "delete", what: "prune node/0, which takes node/0#res", row: 2 },
        { verb: "create", what: "a birth at a locked address", row: -1 },
      ];
      const props = PR.map((p, i) => {
        const y = 380 + i * 84;
        const ar = arrow(svg, [900, y], [980, y], "bd", { width: 2.5, head: 12 });
        const x0 = txt(over, "x", { x: 880, y, size: 26, color: SILK, ax: 1, ay: 0.5 });
        const x1 = txt(over, "x′", { x: 996, y, size: 26, color: SILK, ay: 0.5 });
        const vb = txt(over, p.verb, { x: 1060, y, size: 28, color: B, ay: 0.5 });
        const wh = txt(over, p.what, { x: 1200, y, size: 22, color: DIM, ay: 0.5 });
        const xx = cross(svg, 940, y, 14, SILK, 4);
        return { ar, x0, x1, vb, wh, xx, y, row: p.row };
      });
      const rej = txt(over, "rejected outside the kernel: the move is simply not taken", { x: 880, y: 616, size: 19, color: MUTE });
      // locks3: a birth allowed but its death refused is a one-way door.
      const DX0 = 1010;
      const DX1 = 1590;
      const DY = 780;
      const dG = el("g", {}, svg);
      const region = el("path", { fill: inkA("--phos-b", 0.06), stroke: B_DIM, "stroke-width": 2, "stroke-dasharray": "8 7" }, dG);
      const nx = txt(over, "x", { x: DX0, y: DY, size: 34, color: SILK, ax: 0.5, ay: 0.5 });
      const nx2 = txt(over, "x′", { x: DX1, y: DY, size: 34, color: SILK, ax: 0.5, ay: 0.5 });
      const birth = arrow(dG, [DX0 + 40, DY - 26], [DX1 - 40, DY - 26], "a", { curve: 0.12, width: 3 });
      const death = arrow(dG, [DX1 - 40, DY + 26], [DX0 + 40, DY + 26], "d", { curve: 0.12, width: 3 });
      const bL = txt(over, "birth at L", { x: (DX0 + DX1) / 2, y: DY - 98, size: 20, color: A_DIM, ax: 0.5, ay: 0.5 });
      const dL = txt(over, "death at L", { x: (DX0 + DX1) / 2, y: DY + 98, size: 20, color: DIM, ax: 0.5, ay: 0.5 });
      const xBirth = cross(dG, (DX0 + DX1) / 2, DY - 64, 14, SILK, 4);
      const xDeath = cross(dG, (DX0 + DX1) / 2, DY + 64, 14, SILK, 4);
      const verdictBad = txt(over, "checked in prev only: a one-way door,<br>and detailed balance breaks", { x: TX, y: 690, size: 20, color: DIM, lh: 1.5 });
      const verdictGood = txt(over, "violates_locks(prev, next, locked)<br>checks both traces: symmetric", { x: TX, y: 690, size: 20, color: B, lh: 1.5 });
      const small = txt(over, "a brand-new address inside a locked module<br>is in neither trace, so it is not caught:<br>a lock is a promise about addresses, not subtrees", { x: TX, y: 792, size: 17, color: MUTE, lh: 1.6 });
      const blob = (k) => {
        // k = 0: lopsided (x and x′ both inside, a tail toward x′); k = 1: symmetric (x alone).
        const pts = [];
        for (let i = 0; i < 48; i++) {
          const a = (i / 48) * Math.PI * 2;
          const lop = [DX0 + 250 + Math.cos(a) * 340 + 60 * Math.cos(a) ** 3, DY + Math.sin(a) * (86 - 26 * Math.cos(a))];
          const sym = [DX0 + Math.cos(a) * 96, DY + Math.sin(a) * 86];
          pts.push([lerp(lop[0], sym[0], k), lerp(lop[1], sym[1], k)]);
        }
        return `M${pts.map((p) => p.map((q) => q.toFixed(1)).join(" ")).join(" L")} Z`;
      };
      const v = [
        voiceLine(over, cap(l1, "A lock is _exact conditioning_.")),
        voiceLine(over, cap(l2, "Moves that change, delete or create a locked address are _rejected_.")),
        voiceLine(over, cap(l3, "Checking births as well as deaths keeps _detailed balance_.")),
      ];
      const tExact = wordTime(l1, "exact");
      const tV = [wordTime(l2, "change"), wordTime(l2, "delete"), wordTime(l2, "create")];
      const tRej = wordTime(l2, "rejected");
      const tBirths = wordTime(l3, "births");
      const tDeaths = wordTime(l3, "deaths");
      const tBal = wordTime(l3, "balance");
      return (tl, t) => {
        show(TL, ramp(t, b.t0 - 0.2, b.t0 + 0.3), 0);
        rows.forEach((r, i) => {
          const u = ramp(t, b.t0 - 0.2 + i * 0.1, b.t0 + 0.2 + i * 0.1, E.out3);
          show(r.a, u, 0);
          show(r.v, u, 0);
          if (r.lock) op(r.lock, ramp(t, tExact - 0.3 + i * 0.1, tExact + 0.1 + i * 0.1));
        });
        show(LL, ramp(t, tExact, tExact + 0.4), 0);
        show(f, ramp(t, tExact - 0.2, tExact + 0.3, E.out3), 10);
        show(mwg, ramp(t, tExact + 0.4, tExact + 0.9), 6);
        // locks2
        const dim2 = 1 - 0.55 * ramp(t, l3.t0 - 0.3, l3.t0 + 0.2);
        props.forEach((p, i) => {
          const u = ramp(t, tV[i] - 0.35, tV[i] + 0.05, E.out3);
          p.ar.update(u);
          for (const d of [p.x0, p.x1, p.vb, p.wh]) show(d, u * dim2, 0);
          p.xx.set(ramp(t, tV[i] + 0.15, tV[i] + 0.5) * dim2);
          p.xx.g.style.opacity = String(dim2 * clamp(ramp(t, tV[i] + 0.15, tV[i] + 0.5) * 3));
          p.ar.g.style.opacity = String(dim2);
          if (p.row >= 0) {
            const fl = fade(t, tV[i] - 0.2, tV[i] + 0.1, tV[i] + 0.6, tV[i] + 1.0);
            rows[p.row].a.style.textShadow = textGlow("b", 1 + 2 * fl);
          }
        });
        show(rej, ramp(t, tRej, tRej + 0.4) * dim2, 0);
        // locks3
        const on3 = ramp(t, l3.t0 - 0.3, l3.t0 + 0.2);
        dG.style.opacity = on3.toFixed(3);
        const fix = ramp(t, tBirths + 0.1, tDeaths + 0.2, E.io3);
        region.setAttribute("d", blob(fix));
        birth.update(on3);
        death.update(on3);
        birth.g.style.opacity = String(1 - 0.6 * fix);
        xDeath.set(ramp(t, l3.t0, l3.t0 + 0.3));
        xBirth.set(ramp(t, tDeaths - 0.1, tDeaths + 0.25));
        for (const d of [nx, nx2, bL, dL]) show(d, on3, 0);
        show(verdictBad, on3 * (1 - ramp(fix, 0, 0.45)), 0);
        show(verdictGood, ramp(fix, 0.55, 1), 0);
        verdictGood.style.textShadow = textGlow("b", fade(t, tBal - 0.1, tBal + 0.2, tBal + 0.6, tBal + 1.2) * 1.5);
        region.setAttribute("stroke", mixHex(B_DIM, B, fade(t, tBal - 0.1, tBal + 0.2, tBal + 0.6, tBal + 1.2)));
        show(small, ramp(t, l3.t1 + 0.1, l3.t1 + 0.6), 6);
        const nexts = [l2.t0, l3.t0, b.t1 + 0.4];
        v.forEach((vv, i) => speak(vv, t, [l1, l2, l3][i], nexts[i]));
        void tl;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// 10. PERFORM — named directions, a Jacobian per patch, a ridge solve, verified halves.

const J_ROWS = [
  "centroid_mean", "centroid_std", "rolloff_mean", "flatness_mean", "flux_mean", "zcr_mean", "rms_mean", "rms_std", "crest",
  "attack_s", "tail_ratio", "bass_fraction", "held_centroid_std", "high_ratio", "chord_flatness_delta", "motion_slow", "motion_mid", "motion_fast",
];

function scenePerform({ stage, beat, line }) {
  const b = beat("perform");
  const [l1, l2, l3, l4] = ["perform1", "perform2", "perform3", "perform4"].map(line);
  stage.scene({
    id: "perform", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { svg, over } = stack(layer);
      // perform1: six fixed directions in standardized sound.
      const sG = el("g", {}, svg);
      const sH = el("div", { class: "layer" }, over);
      const O = [960, 470];
      const NAMED = [
        ["Bright", 30, "(centroid + rolloff) / √2"],
        ["Snap", 90, "(−attack + crest) / √2"],
        ["Motion", 150, "½ (held_centroid_std + slow + mid + fast)"],
        ["Body", 210, "bass_fraction"],
        ["Grit", 270, "flatness_mean"],
        ["Space", 330, "tail_ratio"],
      ];
      const dirs = NAMED.map(([n, deg, wgt]) => {
        const a = (deg * Math.PI) / 180;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const ar = arrow(sG, O, [O[0] + c * 220, O[1] - s * 220], "a", { width: 3.2 });
        const side = Math.abs(c) < 0.2 ? 0.5 : c > 0 ? 0 : 1;
        const lx = O[0] + c * 250;
        const ly = O[1] - s * 250;
        const lb = txt(sH, n, { x: lx, y: ly, size: 30, color: SILK, ax: side, ay: s > 0.5 ? 1 : s < -0.5 ? 0 : 0.5 });
        const wy = s > 0.5 ? ly - 40 : s < -0.5 ? ly + 42 : ly + 34;
        const wt = txt(sH, wgt, { x: lx, y: wy, size: 20, color: A_DIM, ax: side, ay: s > 0.5 ? 1 : 0 });
        return { ar, lb, wt };
      });
      const fixedL = txt(sH, "the directions ê stay fixed; the patch moves", { x: 960, y: 812, size: 22, color: DIM, ax: 0.5 });
      const presets = [
        { n: "First Bass", p: [O[0] - 178, O[1] + 8] },
        { n: "Glass Pad", p: [O[0] + 96, O[1] - 162] },
      ];
      const pDot = el("circle", { r: 11, fill: A }, sG);
      pDot.style.filter = GLOW.a;
      const pLbl = presets.map((pr) => txt(sH, pr.n, { x: pr.p[0], y: pr.p[1] + 22, size: 18, color: A_DIM, ax: 0.5 }));
      const pMarks = presets.map((pr) => el("circle", { cx: pr.p[0], cy: pr.p[1], r: 5, fill: "none", stroke: A_DIM, "stroke-width": 1.5 }, sG));
      // perform2/3: the Jacobians.
      const jG = el("g", {}, svg);
      const jH = el("div", { class: "layer" }, over);
      const CELL = 26;
      const PITCH = 29;
      const GY = 262;
      const G1X = 560;
      const G2X = 910;
      const mkGrid = (x0, cols, cutCol, cutRows, seed) => {
        const r = rng(seed);
        const cells = [];
        for (let c = 0; c < cols; c++) {
          for (let i = 0; i < 18; i++) {
            let v = (r() - 0.5) * 1.1 * (r() < 0.55 ? 0.35 : 1);
            if (c === cutCol) v = cutRows[i] ?? (r() - 0.5) * 0.25;
            const rect = el("rect", { x: x0 + c * PITCH, y: GY + i * PITCH, width: CELL, height: CELL, rx: 4, fill: v >= 0 ? A : A_DEEP, opacity: 0 }, jG);
            cells.push({ rect, c, i, a: Math.min(1, Math.abs(v)) });
          }
        }
        return cells;
      };
      const CUT1 = { 0: 1.0, 2: 0.95, 5: 0.8, 13: 0.7, 3: 0.35, 8: -0.3 };
      const CUT2 = { 1: 0.8, 12: 0.9, 15: 0.75, 16: 0.5, 0: 0.35, 11: -0.4 };
      const grid1 = mkGrid(G1X, 10, 0, CUT1, 21);
      const grid2 = mkGrid(G2X, 12, 3, CUT2, 22);
      const rowL = J_ROWS.map((n, i) => txt(jH, n, { x: G1X - 14, y: GY + i * PITCH + CELL / 2, size: 15, color: MUTE, ax: 1, ay: 0.5 }));
      const g1T = txt(jH, "First Bass · 18 × n", { x: G1X, y: GY - 58, size: 21, color: SILK });
      const g2T = txt(jH, "Glass Pad · 18 × n", { x: G2X, y: GY - 58, size: 21, color: SILK });
      const cutOut1 = el("rect", { x: G1X - 3, y: GY - 3, width: CELL + 6, height: 18 * PITCH + 3, rx: 5, fill: "none", stroke: B, "stroke-width": 2.5, opacity: 0 }, jG);
      const cutOut2 = el("rect", { x: G2X + 3 * PITCH - 3, y: GY - 3, width: CELL + 6, height: 18 * PITCH + 3, rx: 5, fill: "none", stroke: B, "stroke-width": 2.5, opacity: 0 }, jG);
      const cutL1 = txt(jH, "node#cut", { x: G1X + CELL / 2, y: GY - 10, size: 15, color: B, ax: 0.5, ay: 1 });
      const cutL2 = txt(jH, "node/0#cut", { x: G2X + 3 * PITCH + CELL / 2, y: GY - 10, size: 15, color: B, ax: 0.5, ay: 1 });
      const jF = txt(jH, "J<sub>:,k</sub> = ( z(v<sub>0</sub> + h<sub>k</sub> e<sub>k</sub>) − z(v<sub>0</sub>) ) / h<sub>k</sub>", { x: 120, y: 96, size: 34, color: B, glow: "b" });
      const jF2 = txt(jH, "h = 0.08 toward the interior · n + 1 renders  (JACOBIAN_STEP)", { x: 120, y: 150, size: 20, color: DIM });
      const renders = txt(jH, "n + 1 renders: one at v<sub>0</sub>, one per nudged knob", { x: G1X, y: GY + 18 * PITCH + 16, size: 18, color: DIM });
      // The measured comparison (reference: search / PERFORM, "Median purity").
      const PUR = el("div", { class: "layer" }, jH);
      const PC = [1320, 1628, 1716, 1804];
      txt(PUR, "median purity", { x: PC[0], y: 290, size: 20, color: DIM });
      ["Bright", "Snap", "Motion"].forEach((h, i) => txt(PUR, h, { x: PC[i + 1], y: 330, size: 18, color: MUTE, ax: 0.5 }));
      [
        ["own Jacobian", ["0.61", "0.77", "0.75"], B],
        ["leave-one-out table", ["0.23", "0.16", "0.09"], DIM],
      ].forEach(([n, vals, c], r) => {
        txt(PUR, n, { x: PC[0], y: 368 + r * 38, size: 20, color: c });
        vals.forEach((v, i) => txt(PUR, v, { x: PC[i + 1], y: 368 + r * 38, size: 20, color: c, ax: 0.5 }));
      });
      // perform3: ridge, support of four, re-solve, travel, gate.
      const EFF = [0.95, 0.15, 0.7, 0.1, 0.55, 0.3, 0.05, 0.62, 0.2, 0.12];
      const top4 = EFF.map((e, i) => [e, i]).sort((a, c) => c[0] - a[0]).slice(0, 4).map((p) => p[1]);
      const RES = EFF.map((e, i) => (top4.includes(i) ? e * [1.05, 1.1, 0.92, 1.12][top4.indexOf(i)] : 0));
      const effG = el("g", {}, jG);
      effG.style.filter = GLOW.b;
      const EB = GY + 18 * PITCH + 100;
      const effBars = EFF.map((e, i) => el("rect", { x: G1X + i * PITCH, width: CELL, y: EB, height: 0, rx: 3, fill: B, opacity: 0 }, effG));
      const effL = txt(jH, "effect |δ<sub>k</sub>| · ‖J<sub>k</sub>‖", { x: G1X - 14, y: EB - 20, size: 16, color: B_DIM, ax: 1, ay: 0.5 });
      const outlines = top4.map((c) => el("rect", { x: G1X + c * PITCH - 4, y: GY - 4, width: CELL + 8, height: EB - GY + 8, rx: 6, fill: "none", stroke: B, "stroke-width": 2.5, opacity: 0 }, jG));
      const ridge = txt(jH, "δ* = (J<sup>T</sup>J + λI)<sup>−1</sup> J<sup>T</sup> ê,&nbsp;&nbsp;λ = 0.05&nbsp;&nbsp;(RIDGE)", { x: 1000, y: 330, size: 28, color: B, glow: "b" });
      const r2 = txt(
        jH,
        "support: the 4 largest effects (MAX_KNOBS = 4), then re-solved on them<br>" + "a full turn moves no knob more than half its range (MAX_TRAVEL = 0.5)<br>" + `<span style='color:${ink("--phos-b-dim")}'>search ⇔ ρ &lt; 0.35 ∨ R &lt; 0.15σ&nbsp;&nbsp;(PURITY_FLOOR, REACH_FLOOR)</span>`,
        { x: 1000, y: 400, size: 19, color: DIM, lh: 1.9 },
      );
      const ctrl = txt(jH, "control: Bright", { x: 1000, y: 280, size: 22, color: A_DIM });
      // perform4: each half, rendered.
      const mG = el("g", {}, svg);
      const mH = el("div", { class: "layer" }, over);
      const MX0 = 200;
      const MX1 = 1000;
      const MYc = 520;
      const cx = (c) => (MX0 + MX1) / 2 + c * ((MX1 - MX0) / 2);
      const my = (m) => MYc - m * 900;
      el("line", { x1: MX0, y1: MYc, x2: MX1, y2: MYc, stroke: HAIR, "stroke-width": 2 }, mG);
      el("line", { x1: cx(0), y1: MYc + 250, x2: cx(0), y2: MYc - 260, stroke: HAIR, "stroke-width": 2 }, mG);
      const lower = el("rect", { x: MX0, y: MYc - 260, width: (MX1 - MX0) / 2, height: 510, fill: inkA("--silk-dim", 0.08), opacity: 0 }, mG);
      el("line", { x1: cx(-1.05), y1: my(-1.05 * 0.2), x2: cx(1.05), y2: my(1.05 * 0.2), stroke: DIM, "stroke-width": 2, "stroke-dasharray": "7 7" }, mG);
      txt(mH, "linear prediction", { x: cx(0.62), y: my(0.62 * 0.2) + 18, size: 17, color: DIM });
      const MEAS = [[-1, 0.021], [-0.5, 0.009], [0.5, 0.11], [1, 0.19]];
      const rg = el("g", {}, mG);
      rg.style.filter = GLOW.b;
      const rdots = MEAS.map(() => el("circle", { r: 10, fill: B, opacity: 0 }, rg));
      txt(mH, "m(c) = ê<sup>T</sup>( z(v(c)) − z(v<sub>0</sub>) )", { x: MX0, y: 170, size: 32, color: B, glow: "b" });
      txt(mH, "First Bass · Motion, four renders", { x: MX0, y: 222, size: 20, color: DIM });
      [-1, -0.5, 0.5, 1].map((c) => txt(mH, c === -0.5 ? "−½" : c === 0.5 ? "+½" : c < 0 ? "−1" : "+1", { x: cx(c), y: MYc + 16, size: 18, color: MUTE, ax: 0.5 }));
      txt(mH, "c", { x: MX1 + 16, y: MYc, size: 22, color: MUTE, ay: 0.5 });
      const closedL = txt(mH, "lower half: predicted stiller, rendered a shade more restless → closed", { x: MX0, y: MYc + 268, size: 19, color: SILK });
      const xLow = cross(mG, cx(-0.5), my(0.009) - 44, 16, SILK, 4);
      const small = txt(mH, "open if 0 &lt; s·m(s/2) &lt; s·m(s) and r<sub>s</sub> ≥ 0.075 · one retry at half travel", { x: MX0, y: 836, size: 18, color: MUTE });
      // The knob, redrawn with only the half that still moves.
      const KX = 1420;
      const KY = 500;
      const KR = 96;
      const kG = el("g", {}, mG);
      const arcP = (a0, a1, r) => {
        const p0 = [KX + r * Math.cos(a0), KY + r * Math.sin(a0)];
        const p1 = [KX + r * Math.cos(a1), KY + r * Math.sin(a1)];
        return `M${p0[0].toFixed(1)} ${p0[1].toFixed(1)} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p1[0].toFixed(1)} ${p1[1].toFixed(1)}`;
      };
      const d2r = (d) => (d * Math.PI) / 180;
      const ringLowG = el("g", {}, kG);
      ringLowG.style.filter = GLOW.a;
      const ringLow = el("path", { d: arcP(d2r(-225), d2r(-90), KR + 22), fill: "none", stroke: A, "stroke-width": 6, "stroke-linecap": "round" }, ringLowG);
      const ringHiG = el("g", {}, kG);
      ringHiG.style.filter = GLOW.a;
      el("path", { d: arcP(d2r(-90), d2r(45), KR + 22), fill: "none", stroke: A, "stroke-width": 6, "stroke-linecap": "round" }, ringHiG);
      el("circle", { cx: KX, cy: KY + 4, r: KR, fill: inkA("--black", 0.55) }, kG);
      el("circle", { cx: KX, cy: KY, r: KR, fill: ink("--cap-mid"), stroke: ink("--bezel"), "stroke-width": 1.5 }, kG);
      el("line", { x1: KX, y1: KY - KR * 0.28, x2: KX, y2: KY - KR * 0.86, stroke: SILK, "stroke-width": 7, "stroke-linecap": "round" }, kG);
      txt(mH, "MOTION", { x: KX, y: KY + KR + 46, size: 22, color: SILK, ax: 0.5, cls: "silk" });
      const stillL = txt(mH, "already as still as it gets", { x: KX, y: KY + KR + 92, size: 30, color: DIM, ax: 0.5, cls: "voice" });
      const v = [
        voiceLine(over, cap(l1, "PERFORM's controls are *fixed directions* in standardized sound. Bright is centroid plus rolloff.")),
        voiceLine(over, cap(l2, "Each patch gets _its own Jacobian_ from one nudged render per knob, since knobs act differently in each.")),
        voiceLine(over, cap(l3, "A _ridge solve_ picks at most four knobs for each control.")),
        voiceLine(over, cap(l4, "Each half is then *rendered for real*, and closes if it stops moving the right way.")),
      ];
      const tBright = wordTime(l1, "Bright");
      const tFixed = wordTime(l1, "fixed");
      const tJac = wordTime(l2, "Jacobian");
      const tNudged = wordTime(l2, "nudged");
      const tDiff = wordTime(l2, "differently");
      const tRidge = wordTime(l3, "ridge");
      const tFour = wordTime(l3, "four");
      const tRend = wordTime(l4, "rendered");
      const tClose = wordTime(l4, "closes");
      return (tl, t) => {
        // perform1
        const on1 = 1 - ramp(t, l2.t0 - 0.45, l2.t0);
        sG.style.opacity = sH.style.opacity = on1.toFixed(3);
        dirs.forEach((d, i) => {
          d.ar.update(ramp(t, b.t0 + 0.0 + i * 0.12, b.t0 + 0.5 + i * 0.12));
          show(d.lb, ramp(t, b.t0 + 0.3 + i * 0.12, b.t0 + 0.7 + i * 0.12), 0);
          show(d.wt, ramp(t, tBright - 0.1 + i * 0.16, tBright + 0.3 + i * 0.16), 0);
          d.lb.style.color = i === 0 ? mixHex(SILK, A, ramp(t, tBright - 0.1, tBright + 0.3)) : SILK;
        });
        dirs[0].ar.g.style.filter = glowCss("a", 1 + 1.5 * fade(t, tBright - 0.1, tBright + 0.2, tBright + 0.8, tBright + 1.5));
        const sw = 0.5 - 0.5 * Math.cos(Math.max(0, t - tFixed) * 1.4);
        const pp = [lerp(presets[0].p[0], presets[1].p[0], sw), lerp(presets[0].p[1], presets[1].p[1], sw)];
        pDot.setAttribute("cx", pp[0].toFixed(1));
        pDot.setAttribute("cy", pp[1].toFixed(1));
        const pOn = ramp(t, tFixed - 0.2, tFixed + 0.3);
        op(pDot, pOn);
        pLbl.forEach((d) => show(d, pOn, 0));
        pMarks.forEach((m) => op(m, pOn));
        show(fixedL, ramp(t, tFixed + 0.3, tFixed + 0.8), 0);
        // perform2
        const on2 = ramp(t, l2.t0 - 0.3, l2.t0 + 0.2) * (1 - ramp(t, l4.t0 - 0.45, l4.t0));
        jG.style.opacity = jH.style.opacity = on2.toFixed(3);
        const nCols = Math.floor(ramp(t, tJac - 0.2, tNudged + 1.1, E.lin) * 10.999);
        grid1.forEach((c) => op(c.rect, (c.c < nCols ? 1 : 0) * (0.2 + 0.8 * c.a)));
        show(renders, ramp(t, tJac - 0.3, tJac) * (1 - ramp(t, l3.t0 - 0.3, l3.t0)), 0);
        show(jF, ramp(t, l2.t0 - 0.2, l2.t0 + 0.3), 8);
        show(jF2, ramp(t, tJac - 0.1, tJac + 0.3), 6);
        rowL.forEach((r) => show(r, ramp(t, l2.t0, l2.t0 + 0.4), 0));
        show(g1T, ramp(t, l2.t0, l2.t0 + 0.4), 0);
        const g2on = ramp(t, tDiff - 0.3, tDiff + 0.3) * (1 - ramp(t, l3.t0 - 0.3, l3.t0 + 0.2));
        grid2.forEach((c) => op(c.rect, g2on * (0.2 + 0.8 * c.a)));
        show(g2T, g2on, 0);
        const cutHi = ramp(t, tDiff + 0.2, tDiff + 0.6) * (1 - ramp(t, l3.t0 - 0.3, l3.t0));
        op(cutOut1, cutHi);
        op(cutOut2, cutHi * g2on);
        show(cutL1, cutHi, 0);
        show(cutL2, cutHi * g2on, 0);
        show(PUR, ramp(t, tDiff + 0.8, tDiff + 1.3) * (1 - ramp(t, l3.t0 - 0.3, l3.t0 + 0.1)), 6);
        // perform3
        const on3 = ramp(t, tRidge - 0.3, tRidge + 0.2);
        show(ridge, on3, 8);
        show(ctrl, on3, 0);
        show(r2, ramp(t, tFour + 0.4, tFour + 0.9), 6);
        const sup = ramp(t, tFour - 0.1, tFour + 0.3);
        const res = ramp(t, tFour + 0.5, tFour + 1.0, E.io3);
        EFF.forEach((e, i) => {
          const h = 62 * lerp(e, RES[i], res) * ramp(t, tRidge, tRidge + 0.5, E.out3);
          effBars[i].setAttribute("y", (EB - h).toFixed(1));
          effBars[i].setAttribute("height", h.toFixed(1));
          op(effBars[i], on3 * (top4.includes(i) ? 1 : 1 - 0.7 * sup));
        });
        show(effL, on3, 0);
        outlines.forEach((o) => op(o, sup));
        grid1.forEach((c) => {
          if (sup > 0 && !top4.includes(c.c)) op(c.rect, (0.2 + 0.8 * c.a) * (1 - 0.65 * sup));
        });
        // perform4
        const on4 = ramp(t, l4.t0 - 0.35, l4.t0 + 0.2);
        mG.style.opacity = mH.style.opacity = on4.toFixed(3);
        MEAS.forEach(([c, m], i) => {
          const u = ramp(t, tRend - 0.1 + i * 0.15, tRend + 0.35 + i * 0.15, E.out3);
          rdots[i].setAttribute("cx", cx(c).toFixed(1));
          rdots[i].setAttribute("cy", lerp(my(m) - 120, my(m), u).toFixed(1));
          op(rdots[i], u * (c < 0 ? 1 - 0.55 * ramp(t, tClose, tClose + 0.4) : 1));
        });
        const cl = ramp(t, tClose - 0.1, tClose + 0.4);
        op(lower, cl);
        xLow.set(ramp(t, tClose + 0.1, tClose + 0.45));
        show(closedL, ramp(t, tClose + 0.3, tClose + 0.7), 0);
        // The closed half loses its ring: only the half that still moves is drawn.
        ringLow.setAttribute("stroke", mixHex(A, A_DEEP, cl));
        ringLowG.style.filter = cl > 0.5 ? "none" : GLOW.a;
        op(ringLow, 1 - 0.8 * cl);
        ringLow.setAttribute("stroke-dasharray", cl > 0.5 ? "3 9" : "");
        show(stillL, ramp(t, tClose + 0.6, tClose + 1.1), 0);
        show(small, ramp(t, tClose + 1.0, tClose + 1.5), 6);
        const nexts = [l2.t0, l3.t0, l4.t0, b.t1 + 0.4];
        v.forEach((vv, i) => speak(vv, t, [l1, l2, l3, l4][i], nexts[i]));
        void tl;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// 11. OUTRO — the constants, and where each is measured.

function sceneOutro({ stage, beat, line }) {
  const b = beat("outro");
  const l1 = line("outro1");
  stage.scene({
    id: "outro", t0: b.t0, t1: b.t1, pre: 0, fin: 0.5,
    build(layer) {
      const { svg, over } = stack(layer);
      const lock = place(el("div", { class: "lk" }, over), { x: 0, y: 0 });
      lock.style.fontSize = "96px";
      const wm = el("span", { class: "wm" }, lock, "AURACLE");
      const wmW = wm.getBoundingClientRect().width;
      const markPx = 1.28 * 96;
      const gap = 0.62 * 96;
      const left = 960 - (markPx + gap + wmW) / 2;
      const mk = mark(svg, { cx: left + markPx / 2, cy: 300, size: markPx });
      place(lock, { x: left + markPx + gap, y: 300, ay: 0.5 });
      const v1 = voiceLine(over, cap(l1, "Every constant here is in _the reference_, with its measurement where there is one."), { y: 470, size: 48, ay: 0.5, w: 1500 });
      const TOK = ["beta 2.0", "proposal_tilt 0.6", "recency_half_life 150", "RIDGE 0.05", "JACOBIAN_STEP 0.08", "PURITY_FLOOR 0.35", "REACH_FLOOR 0.15"];
      const row = el("div", {}, over);
      Object.assign(row.style, { position: "absolute", left: "260px", top: "600px", width: "1400px", display: "flex", justifyContent: "center", flexWrap: "wrap", gap: "16px 34px" });
      const toks = TOK.map((s) => {
        const d = el("div", { class: "mono" }, row, s);
        Object.assign(d.style, { fontSize: "24px", color: B_DIM, whiteSpace: "nowrap" });
        return d;
      });
      const links = ["taste model", "search", "performance"].map((s, i) => place(el("div", { class: "pill a" }, over, `${s}  ▸`), { x: 960 + (i - 1) * 330, y: 800, ax: 0.5, ay: 0.5 }));
      const tConst = wordTime(l1, "constant");
      const tRef = wordTime(l1, "reference");
      return (tl, t) => {
        const u = ramp(t, b.t0 - 0.2, b.t0 + 0.7, E.out4);
        mk.update({ tile: u, outer: u, inner: ramp(t, b.t0 - 0.3, b.t0 + 0.4), core: E.outBack(ramp(t, b.t0 - 0.3, b.t0 + 0.2, E.lin)) });
        lock.style.opacity = u;
        speak(v1, t, l1, b.t1 + 5);
        toks.forEach((d, i) => {
          const k = ramp(t, tConst + 0.1 + i * 0.14, tConst + 0.6 + i * 0.14, E.out3);
          d.style.opacity = k.toFixed(3);
          d.style.transform = `translate(${((1 - k) * (i % 2 ? 18 : -18)).toFixed(1)}px, ${((1 - k) * 10).toFixed(1)}px)`;
        });
        links.forEach((l, i) => show(l, ramp(t, tRef + i * 0.2, tRef + 0.4 + i * 0.2), 10));
        layer.style.opacity = (1 - ramp(t, b.t1 - 2.5, b.t1 - 0.05, E.io2)).toFixed(3);
        void tl;
      };
    },
  });
}
