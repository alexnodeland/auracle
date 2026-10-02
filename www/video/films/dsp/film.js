// The sound engine: for audio and DSP engineers and synth builders.
//
// Every drawing is of something auracle-grammar, auracle-features or
// auracle-wasm does, and every curve is computed rather than sketched: the
// filter responses from quiver's own topologies (TPT SVF, the four-pole diode
// ladder), the diode curve from `DiodeLadderFilter::diode_sat`, the K
// weighting from the constants in loudness.rs, the gates and the modulation
// spectrum from real renders. The renders are the engine's own — the preset
// library played through `PhraseSpec::default()` by the same wasm the app runs
// (apps/web/pkg, `farm_render`) — downsampled into DATA at the end of this
// file. The JS ports of the BS.1770 blocks and of `motion_bands` used to make
// DATA reproduce the engine's own numbers (−31.187 LUFS; −1.845 / −1.308 /
// −3.885 for Glass Pad) before anything here was drawn from them.

import { el, place, clamp, lerp, ramp, fade, keys, E, words, reveal } from "../../stage/stage.js";
import { svgLayer, knob, cable, mark, keyboard, textBlock, voiceWave, GLOW, ink, inkA } from "../../stage/kit.js";

const C = {
  a: ink("--phos-a"), aDim: ink("--phos-a-dim"), aDeep: ink("--phos-a-deep"),
  b: ink("--phos-b"), bDim: ink("--phos-b-dim"), bDeep: ink("--phos-b-deep"),
  silk: ink("--silk"), dim: ink("--silk-dim"), mute: ink("--silk-mute"), hair: ink("--hairline"), panel: ink("--panel"), bezel: ink("--bezel"),
};
const SR = 44100;

export async function build(stage) {
  const beat = (id) => stage.tl.beats.find((b) => b.id === id);
  const line = (id) => stage.line(id);
  const ctx = { stage, beat, line };
  sceneIntro(ctx);
  sceneGraph(ctx);
  sceneModules(ctx);
  sceneCompile(ctx);
  scenePhrase(ctx);
  sceneVetting(ctx);
  sceneLoudness(ctx);
  sceneFeatures(ctx);
  sceneLive(ctx);
  sceneFarm(ctx);
  sceneOutro(ctx);
}

// ---- the engine film's helpers ----------------------------------------------

function stack(layer) {
  const under = el("div", { class: "layer" }, layer);
  const svg = svgLayer(layer);
  const over = el("div", { class: "layer" }, layer);
  return { under, svg, over };
}
function voiceLine(over, text, { y = 985, size = 44, w = 1720 } = {}) {
  const d = textBlock(over, { x: 960, y, w, cls: "voice", size, align: "center", ax: 0.5, ay: 0.5 });
  return { d, sp: words(d, text) };
}
/** A caption over its line, each word lit at the time the narrator says it. */
function speak(v, t, l, next) {
  v.d.style.opacity = fade(t, l.t0 - 0.25, l.t0 + 0.05, next - 0.35, next - 0.1);
  reveal(v.sp, t, l.t0, l.t1, l.words && l.words.length === v.sp.length ? l.words : null);
}
function wordTime(l, word) {
  const i = l.text.toLowerCase().indexOf(word.toLowerCase());
  if (i < 0) return l.t0;
  if (l.words) {
    const idx = l.text.slice(0, i).split(/\s+/).filter(Boolean).length;
    return l.words[Math.min(idx, l.words.length - 1)];
  }
  return l.t0 + ((l.t1 - l.t0) * i) / l.text.length;
}
/** A labelled box: a plate with a mono title and an optional subtitle. */
function box(under, { x, y, w, h, title, sub = "", color = "a", ax = 0, ay = 0, size = 22 }) {
  const d = place(el("div", { class: "plate" }, under), { x, y, w, h, ax, ay });
  const t = el("div", { class: "mono" }, d, title);
  Object.assign(t.style, { position: "absolute", left: "18px", top: "14px", fontSize: `${size}px`, color: color === "b" ? C.b : color === "s" ? C.silk : C.a, fontWeight: 600, whiteSpace: "nowrap" });
  if (sub) {
    const s = el("div", { class: "mono" }, d, sub);
    Object.assign(s.style, { position: "absolute", left: "18px", top: `${size + 26}px`, right: "14px", fontSize: "16px", color: C.dim, lineHeight: "1.45", whiteSpace: "pre-wrap" });
  }
  return d;
}
/** An arrow from p0 to p1 (drawn on with `u`). */
function arrow(svg, p0, p1, color = "a", { curve = 0, width = 2.5, dash = null } = {}) {
  const g = el("g", {}, svg);
  g.style.filter = GLOW[color];
  const mx = (p0[0] + p1[0]) / 2 + curve * (p1[1] - p0[1]);
  const my = (p0[1] + p1[1]) / 2 - curve * (p1[0] - p0[0]);
  const stroke = color === "b" ? C.b : C.a;
  const p = el("path", { d: `M${p0[0]} ${p0[1]} Q${mx} ${my} ${p1[0]} ${p1[1]}`, fill: "none", stroke, "stroke-width": width, "stroke-linecap": "round" }, g);
  if (dash) p.setAttribute("stroke-dasharray", dash);
  const len = p.getTotalLength();
  if (!dash) p.setAttribute("stroke-dasharray", `${len} ${len}`);
  const ang = Math.atan2(p1[1] - my, p1[0] - mx);
  const head = el("path", { d: "M0 0 L-14 -7 L-14 7 Z", fill: stroke, transform: `translate(${p1[0]} ${p1[1]}) rotate(${(ang * 180) / Math.PI})` }, g);
  return {
    g,
    update(u) {
      if (!dash) p.setAttribute("stroke-dashoffset", len * (1 - clamp(u)));
      else g.style.opacity = clamp(u * 2);
      head.setAttribute("opacity", u >= 0.98 ? 1 : 0);
    },
  };
}

// ---- small helpers of this film ---------------------------------------------

/** A line of mono (or silk) text, placed in frame pixels. */
function label(parent, text, { x, y, size = 20, color = C.dim, ax = 0, ay = 0, weight = 400, cls = "mono", html = false, w = null, align = null, ls = null } = {}) {
  const d = place(el("div", { class: cls }, parent), { x, y, ax, ay, w });
  if (html) d.innerHTML = text;
  else d.textContent = text;
  Object.assign(d.style, { fontSize: `${size}px`, color, fontWeight: weight, whiteSpace: w ? "normal" : "nowrap", lineHeight: "1.35" });
  if (align) d.style.textAlign = align;
  if (ls != null) d.style.letterSpacing = ls;
  return d;
}
function pill(parent, text, { x, y, cls = "", ax = 0, ay = 0.5, size = null } = {}) {
  const d = place(el("div", { class: `pill ${cls}` }, parent, text), { x, y, ax, ay });
  if (size) d.style.fontSize = `${size}px`;
  return d;
}
/** Fade a node in (and let it rise a few pixels as it does). */
function show(node, u, dy = 10) {
  node.style.opacity = clamp(u).toFixed(3);
  node.style.transform = u < 1 ? `translateY(${((1 - clamp(u)) * dy).toFixed(1)}px)` : "";
}
function group(parent, glow = null) {
  const g = el("g", {}, parent);
  if (glow) g.style.filter = GLOW[glow];
  return g;
}
function path(parent, d, attrs = {}) {
  return el("path", { d, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round", ...attrs }, parent);
}
/** Make a path drawable: returns u ↦ draw the first u of it. */
function drawable(p) {
  const len = p.getTotalLength() || 1;
  p.setAttribute("stroke-dasharray", `${len} ${len}`);
  p.setAttribute("stroke-dashoffset", len);
  return (u) => {
    p.setAttribute("stroke-dashoffset", (len * (1 - clamp(u))).toFixed(2));
    // A round cap draws a dot for a zero-length dash: hide the path until it starts.
    p.style.visibility = u <= 0.0005 ? "hidden" : "";
  };
}
const P = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");
/** A path through `n + 1` samples of a function of u ∈ [0, 1]. */
function fnD(n, f) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(f(i / n));
  return P(pts);
}
/** A dark instrument panel for a plot. */
function panel(under, { x, y, w, h }) {
  const d = place(el("div", {}, under), { x, y, w, h });
  Object.assign(d.style, { background: inkA("--bezel", 0.62), border: `1px solid ${C.hair}`, borderRadius: "10px" });
  return d;
}
const fmtInt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
/** Log-frequency axis: f in [f0, f1] → x in [x, x + w]. */
const logX = (f, x, w, f0 = 20, f1 = 20000) => x + (Math.log(f / f0) / Math.log(f1 / f0)) * w;

// ---- data decoding ------------------------------------------------------------

function b64(s, T) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new T(u.buffer);
}
/** A render's min/max envelope, one pair per display column. */
function envOf(s) {
  const a = b64(s, Int8Array);
  const n = a.length / 2;
  const mx = new Float32Array(n);
  const mn = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mx[i] = a[2 * i] / 127;
    mn[i] = a[2 * i + 1] / 127;
  }
  return { mx, mn, n };
}
const samplesOf = (s) => Array.from(b64(s, Int16Array), (v) => v / 32767);
/** Draw an envelope as a dense waveform (up to the max, down to the min, per column). */
function envD(env, { x, y, w, h, gain = 1, i0 = 0, i1 = env.n, lim = 1.25 }) {
  let d = "";
  for (let i = i0; i < i1; i++) {
    const px = (x + ((i + 0.5) / env.n) * w).toFixed(1);
    const a = clamp(env.mx[i] * gain, -lim, lim);
    const b = clamp(env.mn[i] * gain, -lim, lim);
    d += `${i === i0 ? "M" : "L"}${px} ${(y - a * h).toFixed(1)}L${px} ${(y - b * h).toFixed(1)}`;
  }
  return d || `M${x} ${y}`;
}

// ---- the maths the pictures are drawn from ------------------------------------

/** quiver's diode curve (`DiodeLadderFilter::diode_sat`): harder above zero. */
const diodeSat = (x) => (x >= 0 ? Math.tanh(1.2 * x) : Math.tanh(0.8 * x));
/** Prewarped frequency ratio of a TPT (bilinear) filter at fs. */
const warp = (f, fc, fs = SR) => Math.tan((Math.PI * Math.min(f, 0.49 * fs)) / fs) / Math.tan((Math.PI * fc) / fs);
/** |H| of quiver's TPT SVF outputs: the bilinear image of 1/(s² + ks + 1). */
function svfMag(kind, f, fc, k) {
  const W = warp(f, fc);
  const den = Math.hypot(1 - W * W, k * W);
  return kind === "lp" ? 1 / den : kind === "bp" ? W / den : (W * W) / den;
}
/** |H| of the four-pole ladder in its linear regime: G⁴ / (1 + k G⁴), G = 1/(1 + s). */
function ladderMag(f, fc, k) {
  const W = warp(f, fc);
  let re = 1;
  let im = 0;
  for (let i = 0; i < 4; i++) {
    const r = re - im * W;
    im = re * W + im;
    re = r;
  }
  return 1 / Math.hypot(re + k, im);
}
/** BS.1770 K weighting, verbatim from crates/auracle-features/src/loudness.rs. */
function kShelf(fs) {
  const gDb = 3.999843853973347, q = 0.7071752369554196, fc = 1681.974450955533;
  const k = Math.tan((Math.PI * fc) / fs);
  const vh = Math.pow(10, gDb / 20);
  const vb = Math.pow(vh, 0.499666774155);
  const a0 = 1 + k / q + k * k;
  return { b0: (vh + (vb * k) / q + k * k) / a0, b1: (2 * (k * k - vh)) / a0, b2: (vh - (vb * k) / q + k * k) / a0, a1: (2 * (k * k - 1)) / a0, a2: (1 - k / q + k * k) / a0 };
}
function kHighpass(fs) {
  const q = 0.5003270373238773, fc = 38.13547087602444;
  const k = Math.tan((Math.PI * fc) / fs);
  const a0 = 1 + k / q + k * k;
  return { b0: 1 / a0, b1: -2 / a0, b2: 1 / a0, a1: (2 * (k * k - 1)) / a0, a2: (1 - k / q + k * k) / a0 };
}
function biquadDb(c, f, fs = SR) {
  const w = (2 * Math.PI * f) / fs;
  const nr = c.b0 + c.b1 * Math.cos(w) + c.b2 * Math.cos(2 * w);
  const ni = -(c.b1 * Math.sin(w) + c.b2 * Math.sin(2 * w));
  const dr = 1 + c.a1 * Math.cos(w) + c.a2 * Math.cos(2 * w);
  const di = -(c.a1 * Math.sin(w) + c.a2 * Math.sin(2 * w));
  return 20 * Math.log10(Math.hypot(nr, ni) / Math.hypot(dr, di) + 1e-12);
}
/** An exponential ADSR contour (shape = exponential), times in seconds. */
function adsrExp(t, { a, d, s, r, off }) {
  const TC = 4.6; // segments close to within 1 % of their target
  if (t < 0) return 0;
  if (t < a) return (1 - Math.exp((-TC * t) / a)) / (1 - Math.exp(-TC));
  const held = t < off ? t : off;
  const sus = s + (1 - s) * Math.exp((-TC * (held - a)) / d);
  if (t < off) return sus;
  return sus * Math.exp((-TC * (t - off)) / r);
}
function adsrLin(t, { a, d, s, r, off }) {
  if (t < 0) return 0;
  if (t < a) return t / a;
  const held = t < off ? t : off;
  const sus = held < a + d ? 1 - ((1 - s) * (held - a)) / d : s;
  if (t < off) return sus;
  return Math.max(0, sus * (1 - (t - off) / r));
}

// The standard phrase (`PhraseSpec::default()`), in seconds on its own clock.
const PHRASE = [
  { name: "C4", lane: 2, t0: 0, t1: 1.8 },
  { name: "C5", lane: 0, t0: 2.0, t1: 2.3 },
  { name: "C4", lane: 2, t0: 2.45, t1: 2.95 },
  { name: "E4", lane: 1, t0: 2.45, t1: 2.95, voice2: true },
  { name: "C3", lane: 3, t0: 3.15, t1: 3.95 },
];
const PHRASE_S = 5.05;

// The real φ_audio names, `AudioFeatures::NAMES` order.
const FEATURES = [
  "centroid", "centroid spread", "rolloff", "flatness", "flux", "zero crossings", "level", "level swing",
  "crest", "attack", "tail", "bass", "held-note spread", "high-note level", "chord flatness", "slow motion",
  "mid motion", "fast motion",
];

// ============================================================================
// 1 · intro
// ============================================================================

function sceneIntro({ stage, beat, line }) {
  const b = beat("intro");
  const l1 = line("intro1");
  stage.scene({
    id: "intro", t0: b.t0, t1: b.t1, post: 0.5, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const eb = place(el("div", { class: "eyebrow" }, over, "the sound engine"), { x: 120, y: 92 });
      eb.style.fontSize = "26px";
      // Glass Pad's real standard-phrase render, swept across like a beam.
      const env = envOf(DATA.gp.env);
      const X = 120, WD = 1680, Y = 380, A = 250;
      const axis = group(svg);
      el("line", { x1: X, y1: Y, x2: X + WD, y2: Y, stroke: C.hair, "stroke-width": 1.5 }, axis);
      const secs = [];
      for (let s = 0; s <= 5; s++) {
        const x = X + (s / PHRASE_S) * WD;
        el("line", { x1: x, y1: Y + 200, x2: x, y2: Y + 210, stroke: C.mute, "stroke-width": 1.5 }, axis);
        secs.push(label(over, s === 0 ? "0 s" : `${s}`, { x, y: Y + 218, size: 16, color: C.mute, ax: 0.5 }));
      }
      const wg = group(svg, "a");
      const wave = path(wg, "", { stroke: C.a, "stroke-width": 1.25 });
      const head = el("circle", { r: 6, fill: ink("--phos-a-pulse"), opacity: 0 }, wg);
      const tag = label(over, "Glass Pad · the standard phrase · 5.05 s", { x: X + WD, y: Y + 248, size: 17, color: C.mute, ax: 1 });
      // The patch graph, small, on the left.
      const chainLbl = label(over, "the patch graph", { x: 120, y: 668, size: 18, color: C.mute });
      const chain = ["vco", "ladder", "vca"].map((n, i) => box(under, { x: 120 + i * 240, y: 704, w: 180, h: 100, title: n, sub: ["Vco · saw", "DiodeLadder", "Vca · exp"][i] }));
      const wires = [0, 1].map((i) => cable(svg, { p0: [300 + i * 240, 754], p1: [360 + i * 240, 754], sag: 12, width: 4 }));
      // The live voices, four thin lanes on the right.
      const voiceLbl = label(over, "the live voices", { x: 1250, y: 668, size: 18, color: C.mute });
      const lanes = [0, 1, 2, 3].map((i) => {
        const y = 704 + i * 26;
        const bg = place(el("div", { class: "screen" }, under), { x: 1290, y, w: 510, h: 22 });
        const lb = label(over, `${i + 1}`, { x: 1262, y: y + 11, ay: 0.5, size: 15, color: C.mute });
        const tr = path(group(svg, "a"), "", { stroke: C.a, "stroke-width": 1.8 });
        const fn = voiceWave({ f: [6, 7.56, 8.99, 12][i], bright: 0.55, seed: 11 + i });
        return { bg, lb, tr, fn, y };
      });
      const ar = arrow(svg, [820, 754], [1234, 754], "a", { width: 2 });
      const v1 = voiceLine(over, "This is how Auracle makes sound, from the *patch graph* to the *live voices*.");
      const tG = wordTime(l1, "patch graph");
      const tV = wordTime(l1, "live voices");
      // The beam sweeps the phrase in real time. The render is drawn, not
      // heard (ADR-014: no cues).
      const tSweep = b.t0 + 0.3;
      return (tl, t) => {
        show(eb, ramp(t, b.t0 + 0.1, b.t0 + 0.8));
        const u = ramp(t, tSweep, tSweep + PHRASE_S, E.lin);
        const i1 = Math.max(1, Math.floor(u * env.n));
        wave.setAttribute("d", envD(env, { x: X, y: Y, w: WD, h: A, i1 }));
        const hx = X + ((i1 - 0.5) / env.n) * WD;
        head.setAttribute("cx", hx);
        head.setAttribute("cy", Y - env.mx[i1 - 1] * A);
        head.setAttribute("opacity", u > 0 && u < 1 ? 0.9 : 0);
        axis.setAttribute("opacity", ramp(t, b.t0, b.t0 + 0.6));
        secs.forEach((s) => (s.style.opacity = ramp(t, b.t0 + 0.2, b.t0 + 0.8)));
        tag.style.opacity = ramp(t, b.t0 + 1.0, b.t0 + 1.6);
        const cu = ramp(t, tG - 0.3, tG + 0.3, E.out3);
        show(chainLbl, cu);
        chain.forEach((c, i) => show(c, ramp(t, tG - 0.3 + i * 0.1, tG + 0.3 + i * 0.1, E.out3)));
        wires.forEach((w, i) => w.update(t, { draw: ramp(t, tG + i * 0.15, tG + 0.4 + i * 0.15), flow: 1, opacity: cu }));
        ar.update(ramp(t, tG + 0.45, tV - 0.05, E.io2));
        show(voiceLbl, ramp(t, tV - 0.2, tV + 0.3));
        lanes.forEach((ln, i) => {
          const lit = ramp(t, tV - 0.1 + i * 0.13, tV + 0.25 + i * 0.13, E.out3);
          ln.bg.style.opacity = ln.lb.style.opacity = lit;
          ln.tr.setAttribute("opacity", lit);
          ln.tr.setAttribute("d", fnD(120, (q) => [1296 + q * 498, ln.y + 11 - 7.5 * ln.fn(q, t)]));
        });
        speak(v1, t, l1, b.t1 + 0.4);
        void tl;
      };
    },
  });
}

// ============================================================================
// 2 · graph — quiver, one sample per tick, live knobs
// ============================================================================

/** A module plate as it sits in a quiver graph: silk name, the quiver type, jacks. */
function modPlate(under, svg, { x, y, w, h, name, type, knobs = [], color = "a" }) {
  const d = place(el("div", { class: "plate" }, under), { x, y, w, h });
  const t = el("div", { class: "silk" }, d, name);
  Object.assign(t.style, { position: "absolute", left: "18px", top: "14px", fontSize: "19px", letterSpacing: "0.16em" });
  const s = el("div", { class: "mono" }, d, type);
  Object.assign(s.style, { position: "absolute", left: "18px", top: "44px", fontSize: "15px", color: C.mute, whiteSpace: "nowrap" });
  for (const [sx, sy] of [[8, 8], [w - 18, 8], [8, h - 18], [w - 18, h - 18]]) {
    const sc = el("i", { class: "screw" }, d);
    Object.assign(sc.style, { left: `${sx}px`, top: `${sy}px`, width: "10px", height: "10px" });
  }
  const ks = knobs.map((kn, i) => {
    const cx = x + 70 + i * 80;
    const cy = y + h - 52;
    const k = knob(svg, { cx, cy, r: 16, color, glow: false });
    k.set(kn.v);
    const lb = el("div", { class: "mono" }, d, kn.label);
    Object.assign(lb.style, { position: "absolute", left: `${cx - x - 30}px`, width: "60px", textAlign: "center", top: `${h - 25}px`, fontSize: "13px", color: C.mute });
    return { k, cx, cy, ...kn };
  });
  return { d, ks, x, y, w, h };
}

function sceneGraph({ stage, beat, line }) {
  const b = beat("graph");
  const l1 = line("graph1");
  const l2 = line("graph2");
  const l3 = line("graph3");
  stage.scene({
    id: "graph", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      // First Bass, compiled: vco(saw) → ladder, a mod envelope on the cutoff,
      // then the tail compile() adds to every voice (a ladder makes DC, so this
      // one gets the blocker).
      const PW = 220, PH = 160, PY = 400, CY = 470;
      const ROW = [
        { name: "VCO", type: "Vco · saw", x: 100, knobs: [{ label: "oct", v: 0.25 }, { label: "det", v: 0.5 }] },
        { name: "LADDER", type: "DiodeLadderFilter", x: 390, knobs: [{ label: "cut", v: 0.45 }, { label: "res", v: 0.55 }] },
        { name: "DC BLOCK", type: "Svf · hp · 20 Hz", x: 680 },
        { name: "VCA", type: "Vca · exp", x: 970 },
        { name: "LIMITER", type: "Limiter", x: 1260 },
        { name: "OUT", type: "StereoOutput", x: 1550 },
      ].map((r) => modPlate(under, svg, { ...r, y: PY, w: PW, h: PH }));
      const MOD = [
        { name: "MOD ENV", type: "Adsr · node/m", x: 390, jx: 460 },
        { name: "AMP ENV", type: "Adsr · voice:adsr", x: 970, jx: 1080 },
      ].map((r) => ({ ...modPlate(under, svg, { ...r, y: 196, w: PW, h: 104, color: "b" }), jx: r.jx }));
      const wires = ROW.slice(0, -1).map((r, i) => cable(svg, { p0: [r.x + PW, CY], p1: [ROW[i + 1].x, CY], sag: 10, width: 5 }));
      const modG = group(svg, "b");
      const mods = MOD.map((m) => {
        const p = path(modG, `M${m.jx} 300 C${m.jx} 336 ${m.jx} 364 ${m.jx} ${PY}`, { stroke: C.b, "stroke-width": 4 });
        const jk = [300, PY].map((y) => el("circle", { cx: m.jx, cy: y, r: 7, fill: C.bezel, stroke: C.bDeep, "stroke-width": 2 }, svg));
        return { draw: drawable(p), jk };
      });
      const modTags = [
        label(over, "cut ← env", { x: 474, y: 350, ay: 0.5, size: 15, color: C.bDim }),
        label(over, "cv ← env", { x: 1094, y: 350, ay: 0.5, size: 15, color: C.bDim }),
      ];
      const brG = group(svg);
      path(brG, `M${680} 574 L680 584 L${1550 + PW} 584 L${1550 + PW} 574`, { stroke: C.mute, "stroke-width": 1.5 });
      const brL = label(over, "the tail compile() adds · the DC blocker because a ladder makes DC", { x: (680 + 1550 + PW) / 2, y: 594, size: 16, color: C.mute, ax: 0.5 });
      const quiver = pill(over, "quiver · modular synthesis in Rust", { x: 100, y: 138, cls: "a" });
      const tickPill = pill(over, "Patch::tick() → (L, R)", { x: 1770, y: 138, ax: 1 });
      tickPill.style.color = C.silk;
      // One sample per tick: the output, as stems, from the real render.
      const scr = place(el("div", { class: "screen" }, under), { x: 1180, y: 668, w: 600, h: 200 });
      const scrT = label(over, "voice:out · one sample per tick", { x: 1180, y: 634, size: 17, color: C.dim });
      const cnt = label(over, "", { x: 1780, y: 632, size: 20, color: C.a, ax: 1 });
      const rate = label(over, "then 44 100 ticks a second", { x: 1780, y: 880, size: 15, color: C.mute, ax: 1 });
      const stems = samplesOf(DATA.fb.stem);
      const sMax = Math.max(...stems.map(Math.abs));
      const stemG = group(svg, "a");
      const zero = el("line", { x1: 1196, y1: 768, x2: 1764, y2: 768, stroke: C.hair, "stroke-width": 1.5 }, svg);
      const stemEls = stems.map((v, i) => {
        const x = 1204 + (i * 552) / (stems.length - 1);
        const y = 768 - (v / sMax) * 82;
        return { l: el("line", { x1: x, y1: 768, x2: x, y2: y, stroke: C.a, "stroke-width": 2.5, opacity: 0 }, stemG), c: el("circle", { cx: x, cy: y, r: 5, fill: C.a, opacity: 0 }, stemG) };
      });
      // Then the same screen shows what the knob is moving: the ladder's response.
      const rDefs = el("defs", {}, svg);
      const rClip = el("clipPath", { id: "respclip" }, rDefs);
      el("rect", { x: 1182, y: 670, width: 596, height: 196 }, rClip);
      const respGrid = group(svg);
      for (const f of [100, 1000, 10000]) {
        const x = logX(f, 1200, 560);
        el("line", { x1: x, y1: 680, x2: x, y2: 860, stroke: C.hair, "stroke-width": 1 }, respGrid);
        respGrid.appendChild(el("text", { x: x + 5, y: 856, fill: C.mute, "font-family": "IBM Plex Mono", "font-size": 13 }, null, f >= 1000 ? `${f / 1000}k` : `${f}`));
      }
      el("line", { x1: 1200, y1: 716, x2: 1760, y2: 716, stroke: C.hair, "stroke-width": 1 }, respGrid);
      const respG = el("g", { "clip-path": "url(#respclip)" }, svg);
      const respIn = group(respG, "a");
      const resp = path(respIn, "", { stroke: C.a, "stroke-width": 3 });
      const fcLine = el("line", { y1: 700, y2: 866, stroke: C.silk, "stroke-width": 1.2, "stroke-dasharray": "4 5" }, svg);
      const fcLbl = label(over, "", { x: 0, y: 676, size: 16, color: C.silk });
      const respT = label(over, "ladder response · follows node#cut", { x: 1180, y: 634, size: 17, color: C.dim });
      const K_FB = 4 * 0.85 * 0.55; // First Bass: res 0.55 through the 0.85 cap, k = 4·res
      const respD = (cv) => {
        const fc = clamp(20 * Math.pow(1000, cv), 20, 20000);
        return fnD(140, (q) => {
          const f = 20 * Math.pow(1000, q);
          const db = clamp(20 * Math.log10(ladderMag(f, fc, K_FB) * (1 + K_FB)), -80, 12);
          return [1200 + q * 560, 716 - db * 3.0];
        });
      };
      // The dots: one sample per tick through the whole graph.
      const xs = ROW.map((r) => r.x + PW / 2);
      const dotG = group(svg, "a");
      const dots = Array.from({ length: 5 }, () => el("circle", { r: 8, fill: ink("--phos-a-pulse"), opacity: 0 }, dotG));
      // A sample is seen on the cables and goes out of sight inside a module,
      // which lights while it has it.
      const onCable = (x) => {
        let v = 1;
        for (const r of ROW) {
          const d = Math.min(x - r.x, r.x + PW - x);
          if (d > 0) v = Math.min(v, clamp(1 - d / 16));
        }
        return v;
      };
      // Knobs: a continuous one (live) and a categorical one (a rebuild).
      const wave = knob(svg, { cx: 215, cy: 742, r: 42, label: "wave", labelSize: 15, color: "a", dim: true, glow: false });
      wave.set(0.66, { glowOn: false });
      const waveTag = label(over, "picks a port · a rebuild", { x: 215, y: 842, size: 15, color: C.mute, ax: 0.5 });
      const waveLead = path(svg, "M215 684 L215 566", { stroke: C.mute, "stroke-width": 1.5, "stroke-dasharray": "4 6" });
      const cut = knob(svg, { cx: 505, cy: 742, r: 58, label: "cut", labelSize: 17, color: "a" });
      const leadG = group(svg);
      path(leadG, `M505 684 L462 ${PY + PH - 34}`, { stroke: C.silk, "stroke-width": 1.8, "stroke-dasharray": "5 6" });
      const hnd = pill(over, "ParamHandle · Arc<AtomicF64>", { x: 610, y: 690 });
      const addr = label(over, "", { x: 624, y: 740, size: 20, color: C.silk, ay: 0.5 });
      const norec = pill(over, "no recompile · the next sample hears it", { x: 610, y: 796, cls: "a" });
      const v1 = voiceLine(over, "Underneath is *quiver*, a modular synthesis library in Rust.");
      const v2 = voiceLine(over, "On each *tick*, *one sample* moves through the whole graph.");
      const v3 = voiceLine(over, "Continuous knobs are *atomic values* the audio thread reads, so turning one needs *no recompile*.");
      // Tick schedule: the first ticks slow enough to follow, then faster.
      const tTick = wordTime(l2, "tick") - 0.05;
      const starts = [];
      let acc = tTick;
      for (let k = 0; k <= stems.length; k++) {
        starts.push(acc);
        acc += Math.max(0.05, 0.62 * Math.pow(0.72, k));
      }
      const tAll = starts[stems.length];
      const tSwap = Math.max(tAll + 0.3, wordTime(l3, "atomic") - 0.2);
      const tTurn = l3.t0 + 0.3;
      const cutAt = (t) => keys(t, [[tTurn, 0.45], [tTurn + 1.6, 0.74, E.io2], [tTurn + 3.4, 0.27, E.io2], [tTurn + 4.8, 0.5, E.io2]]);
      return (tl, t) => {
        ROW.forEach((r, i) => show(r.d, ramp(t, b.t0 + 0.05 + i * 0.12, b.t0 + 0.5 + i * 0.12, E.out3)));
        ROW.forEach((r, i) => r.ks.forEach((k) => k.k.g.setAttribute("opacity", ramp(t, b.t0 + 0.05 + i * 0.12, b.t0 + 0.5 + i * 0.12))));
        MOD.forEach((m, i) => {
          const u = ramp(t, b.t0 + 0.9 + i * 0.2, b.t0 + 1.3 + i * 0.2, E.out3);
          show(m.d, u);
          m.ks.forEach((k) => k.k.g.setAttribute("opacity", u));
        });
        mods.forEach((m, i) => {
          const u = ramp(t, b.t0 + 1.2 + i * 0.2, b.t0 + 1.6 + i * 0.2);
          m.draw(u);
          m.jk.forEach((j) => j.setAttribute("opacity", u));
          modTags[i].style.opacity = ramp(t, b.t0 + 1.5 + i * 0.2, b.t0 + 1.9 + i * 0.2);
        });
        brG.setAttribute("opacity", ramp(t, b.t0 + 1.6, b.t0 + 2.1));
        brL.style.opacity = ramp(t, b.t0 + 1.6, b.t0 + 2.1);
        show(quiver, ramp(t, wordTime(l1, "quiver") - 0.1, wordTime(l1, "quiver") + 0.4));
        show(tickPill, ramp(t, tTick - 0.1, tTick + 0.3));
        // Ticks: which one is running, and how far through the graph it is.
        let k = -1;
        for (let j = 0; j < stems.length; j++) if (t >= starts[j]) k = j;
        const done = t >= tAll ? stems.length : Math.max(0, k);
        const flow = ramp(t, tAll, tAll + 0.3);
        const lit = new Set();
        dots.forEach((d, i) => {
          let x = null;
          let o = 0;
          if (t < tAll && k >= 0 && i === 0) {
            const ph = clamp((t - starts[k]) / (starts[k + 1] - starts[k]));
            x = lerp(xs[0], xs[xs.length - 1], ph);
            o = 1;
          } else if (t >= tAll) {
            x = lerp(xs[0], xs[xs.length - 1], ((t - tAll) * 0.9 + i / dots.length) % 1);
            o = 0.85 * flow;
          }
          if (x == null) return d.setAttribute("opacity", 0);
          d.setAttribute("cx", x.toFixed(1));
          d.setAttribute("cy", CY);
          d.setAttribute("opacity", (o * onCable(x)).toFixed(3));
          ROW.forEach((r, j) => {
            if (Math.abs(x - xs[j]) < PW / 2 && o > 0.5) lit.add(j);
          });
        });
        ROW.forEach((r, j) => {
          const on = lit.has(j) && t < tAll;
          r.d.style.borderColor = on ? inkA("--phos-a", 0.75) : "";
          r.d.style.boxShadow = on ? `inset 1px 1px 0 ${inkA("--white", 0.07)}, 0 18px 50px ${inkA("--black", 0.55)}, 0 0 26px ${inkA("--phos-a", 0.22)}` : "";
        });
        wires.forEach((w, i) => w.update(t, { draw: ramp(t, b.t0 + 0.5 + i * 0.12, b.t0 + 0.9 + i * 0.12), flow: 0.8 * flow, opacity: ramp(t, b.t0 + 0.3 + i * 0.12, b.t0 + 0.6 + i * 0.12) }));
        // The output, sample by sample, until the knob takes the screen.
        const stemsOn = 1 - ramp(t, tSwap - 0.2, tSwap + 0.2);
        const scrU = ramp(t, tTick - 0.2, tTick + 0.3);
        scr.style.opacity = scrU;
        scrT.style.opacity = scrU * stemsOn;
        zero.setAttribute("opacity", scrU * stemsOn);
        stemEls.forEach((s, i) => {
          const u = i < done ? 1 : i === done && k === i ? 0.35 : 0;
          s.l.setAttribute("opacity", u * stemsOn);
          s.c.setAttribute("opacity", u * stemsOn);
        });
        const n = DATA.fb.stem0 + done + (t > tAll ? Math.floor((t - tAll) * SR) : 0);
        cnt.textContent = `n = ${fmtInt(n)}`;
        cnt.style.opacity = scrU * stemsOn;
        rate.style.opacity = ramp(t, tAll + 0.2, tAll + 0.6) * stemsOn;
        // graph3: a knob is an atomic the audio thread reads.
        const k3 = ramp(t, l3.t0 - 0.2, l3.t0 + 0.3, E.out3);
        wave.g.setAttribute("opacity", k3 * 0.8);
        wave.text.setAttribute("opacity", k3);
        cut.g.setAttribute("opacity", k3);
        const cv = cutAt(t);
        cut.set(cv, { glowOn: true });
        ROW[1].ks[0].k.set(t > tTurn ? cv : 0.45);
        const ta = wordTime(l3, "atomic");
        leadG.setAttribute("opacity", ramp(t, ta - 0.3, ta + 0.2));
        show(hnd, ramp(t, ta - 0.2, ta + 0.3));
        addr.textContent = `node#cut = ${cv.toFixed(2)}`;
        show(addr, ramp(t, ta, ta + 0.4));
        const tn = wordTime(l3, "no recompile");
        show(norec, ramp(t, tn - 0.2, tn + 0.3));
        waveTag.style.opacity = ramp(t, tn + 0.2, tn + 0.7);
        waveLead.setAttribute("opacity", ramp(t, tn + 0.2, tn + 0.7));
        const ru = ramp(t, tSwap - 0.1, tSwap + 0.4);
        respG.setAttribute("opacity", ru);
        respGrid.setAttribute("opacity", ru);
        respT.style.opacity = ru;
        resp.setAttribute("d", respD(cv));
        const fc = 20 * Math.pow(1000, cv);
        const fx = logX(fc, 1200, 560);
        fcLine.setAttribute("x1", fx);
        fcLine.setAttribute("x2", fx);
        fcLine.setAttribute("opacity", ru * 0.8);
        fcLbl.textContent = `fc ${fc >= 1000 ? (fc / 1000).toFixed(1) + " kHz" : Math.round(fc) + " Hz"}`;
        place(fcLbl, { x: fx + 8, y: 676 });
        fcLbl.style.opacity = ru;
        speak(v1, t, l1, l2.t0);
        speak(v2, t, l2, l3.t0);
        speak(v3, t, l3, b.t1 + 0.4);
        void tl;
      };
    },
  });
}

// ============================================================================
// 3 · modules — the palette, the filters, the two sorts
// ============================================================================

function sceneModules({ stage, beat, line }) {
  const b = beat("modules");
  const l1 = line("modules1");
  const l2 = line("modules2");
  const l3 = line("modules3");
  stage.scene({
    id: "modules", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      // ---- modules1: the node bank, 42 glyphs in ten groups (apps/web/main.js MODULES).
      const bankU = el("div", { class: "layer" }, under);
      const bankO = el("div", { class: "layer" }, over);
      const bankS = group(svg);
      const GROUPS = [
        ["sources", "sources"], ["shape", "shape"], ["filter", "filter"], ["space", "space"], ["motion", "motion"],
        ["dynamics", "dynamics"], ["combine", "combine"], ["modulation", "modulation"], ["cvshape", "shape cv"], ["cvlogic", "combine cv"],
      ];
      const AMBER = new Set(["modulation", "cvshape", "cvlogic"]);
      const title = pill(bankO, "the palette · 42 modules · 10 groups", { x: 100, y: 128, cls: "a" });
      const tiles = [];
      GROUPS.forEach(([gid, glabel], gi) => {
        const col = gi < 5 ? 0 : 1;
        const row = gi % 5;
        const x0 = col ? 1000 : 100;
        const y0 = 186 + row * 118;
        const amber = AMBER.has(gid);
        const gl = label(bankO, glabel, { x: x0, y: y0 + 48, ay: 0.5, size: 18, color: amber ? C.bDim : C.aDim });
        DATA.glyphs.filter((m) => m[0] === gid).forEach((m, i) => {
          const x = x0 + 150 + i * 112;
          const d = place(el("div", {}, bankU), { x, y: y0, w: 104, h: 96 });
          Object.assign(d.style, { background: `linear-gradient(180deg,${ink("--panel-hi")},${ink("--panel")})`, border: `1px solid ${C.hair}`, borderRadius: "8px" });
          const nm = el("div", { class: "mono" }, d, m[1]);
          Object.assign(nm.style, { position: "absolute", left: 0, right: 0, bottom: "9px", textAlign: "center", fontSize: "14px", color: C.dim });
          const gg = el("g", { transform: `translate(${x + 20} ${y0 + 14}) scale(3.2)` }, bankS);
          gg.innerHTML = m[2];
          const paths = [...gg.querySelectorAll("path")].map((p) => {
            const cls = p.getAttribute("class") || "gl";
            p.setAttribute("fill", "none");
            p.setAttribute("stroke-linecap", "round");
            p.setAttribute("stroke-linejoin", "round");
            p.setAttribute("vector-effect", "non-scaling-stroke");
            if (cls === "gl-rule") Object.assign(p.style, { stroke: C.mute, strokeWidth: "1.3px", strokeDasharray: "4 4" });
            else if (cls === "gl-mark") Object.assign(p.style, { stroke: C.mute, strokeWidth: "1.4px" });
            else if (cls === "gl-ghost") Object.assign(p.style, { strokeWidth: "1.6px", opacity: 0.5 });
            else p.style.strokeWidth = "2.6px";
            return { p, cls };
          });
          tiles.push({ gid, name: m[1], d, nm, gg, paths, amber, x, y: y0, gi, i });
        });
        tiles.push({ label: gl, gi });
      });
      const setTile = (tile, on) => {
        const hot = tile.amber ? C.b : C.a;
        const rest = tile.amber ? ink("--phos-b-deep") : C.aDeep;
        tile.paths.forEach(({ p, cls }) => {
          if (cls === "gl" || cls === "gl-ghost") p.style.stroke = on > 0.5 ? hot : rest;
        });
        tile.gg.style.filter = on > 0.5 ? GLOW[tile.amber ? "b" : "a"] : "none";
        tile.d.style.borderColor = on > 0.01 ? (tile.amber ? inkA("--phos-b", 0.3 + 0.6 * on) : inkA("--phos-a", 0.3 + 0.6 * on)) : C.hair;
        tile.d.style.boxShadow = on > 0.01 ? `0 0 ${26 * on}px ${tile.amber ? inkA("--phos-b", 0.25) : inkA("--phos-a", 0.25)}` : "none";
        tile.nm.style.color = on > 0.5 ? C.silk : C.dim;
      };
      const mTiles = tiles.filter((x) => x.d);
      const pluck = mTiles.find((x) => x.name === "pluck");
      const dyn = mTiles.filter((x) => x.gid === "dynamics");
      // The dynamics modules' second input is a control: the key.
      const keyG = group(svg, "b");
      // …drawn as a jack under each tile, where a second cable plugs in.
      const keys3 = dyn.map((tile) => {
        const x = tile.x + 52;
        const y = tile.y + 107;
        const p = path(keyG, `M${x} ${y} L${x} ${tile.y + 97}`, { stroke: C.b, "stroke-width": 3 });
        const c = el("circle", { cx: x, cy: y, r: 5, fill: C.b }, keyG);
        return { p, c };
      });
      const keyNote = label(bankO, "key: a second input, a control", { x: dyn[2].x + 124, y: dyn[2].y + 107, ay: 0.5, size: 15, color: C.b });

      // ---- modules2: the two filter designs, drawn from their own equations.
      const filtU = el("div", { class: "layer" }, under);
      const filtO = el("div", { class: "layer" }, over);
      const filtS = group(svg);
      const FC = 1000;
      const RES = 0.85 * 0.5; // a knob at half, through the resonance cap
      const plots = [
        { t: "svf · low pass", fn: (f) => svfMag("lp", f, FC, 2 - 2 * RES) },
        { t: "svf · band pass", fn: (f) => svfMag("bp", f, FC, 2 - 2 * RES) },
        { t: "svf · high pass", fn: (f) => svfMag("hp", f, FC, 2 - 2 * RES) },
        { t: "diode ladder · 24 dB/oct", fn: (f) => ladderMag(f, FC, 4 * RES) },
      ].map((pl, i) => {
        const x = 100 + i * 432;
        const y = 150;
        const w = 404;
        const h = 230;
        panel(filtU, { x, y, w, h });
        label(filtO, pl.t, { x: x + 16, y: y + 12, size: 16, color: C.silk });
        const gr = group(filtS);
        for (const f of [100, 1000, 10000]) {
          const gx = logX(f, x + 16, w - 32);
          el("line", { x1: gx, y1: y + 40, x2: gx, y2: y + h - 14, stroke: C.hair, "stroke-width": 1 }, gr);
        }
        const y0 = y + 84; // 0 dB
        el("line", { x1: x + 16, y1: y0, x2: x + w - 16, y2: y0, stroke: C.hair, "stroke-width": 1 }, gr);
        const cp = el("clipPath", { id: `fclip${i}` }, el("defs", {}, filtS));
        el("rect", { x: x + 2, y: y + 36, width: w - 4, height: h - 38 }, cp);
        const cg = group(el("g", { "clip-path": `url(#fclip${i})` }, filtS), "a");
        const p = path(cg, fnD(200, (q) => {
          const f = 20 * Math.pow(1000, q);
          const db = clamp(20 * Math.log10(pl.fn(f) + 1e-9), -90, 12);
          return [x + 16 + q * (w - 32), y0 - db * 3.2];
        }), { stroke: C.a, "stroke-width": 3 });
        return { draw: drawable(p), cg, gr };
      });
      const svfBr = group(filtS);
      path(svfBr, "M100 404 L100 414 L1364 414 L1364 404", { stroke: C.mute, "stroke-width": 1.5 });
      path(svfBr, "M1396 404 L1396 414 L1800 414 L1800 404", { stroke: C.mute, "stroke-width": 1.5 });
      const svfL = label(filtO, "state variable ×3 · one TPT core, three of its outputs", { x: 732, y: 426, size: 18, color: C.dim, ax: 0.5 });
      const ladL = label(filtO, "diode ladder · k = 4·res", { x: 1598, y: 426, size: 18, color: C.dim, ax: 0.5 });
      // The diode's transfer curve, and what it does to a sine: a DC offset.
      const TX = 170, TY = 490, TW = 520, TH = 340;
      const trPanel = panel(filtU, { x: TX, y: TY, w: TW, h: TH });
      const trT = label(filtO, "DiodeLadderFilter::diode_sat", { x: TX + 16, y: TY + 12, size: 16, color: C.silk });
      const tr = group(filtS);
      const tcx = TX + TW / 2;
      const tcy = TY + TH / 2 + 14;
      const txs = (x) => tcx + (x / 2.6) * (TW / 2 - 24);
      const tys = (y) => tcy - y * (TH / 2 - 44);
      el("line", { x1: TX + 20, y1: tcy, x2: TX + TW - 20, y2: tcy, stroke: C.hair, "stroke-width": 1.2 }, tr);
      el("line", { x1: tcx, y1: TY + 40, x2: tcx, y2: TY + TH - 14, stroke: C.hair, "stroke-width": 1.2 }, tr);
      const refP = path(tr, fnD(120, (q) => { const x = -2.6 + 5.2 * q; return [txs(x), tys(Math.tanh(x))]; }), { stroke: C.mute, "stroke-width": 1.6, "stroke-dasharray": "5 6" });
      const trG = group(filtS, "a");
      const trP = path(trG, fnD(160, (q) => { const x = -2.6 + 5.2 * q; return [txs(x), tys(diodeSat(x))]; }), { stroke: C.a, "stroke-width": 3.2 });
      const trDraw = drawable(trP);
      const tPos = label(filtO, "tanh(1.2x)", { x: txs(0.9), y: tys(0.95) - 6, size: 17, color: C.a, ay: 1 });
      const tNeg = label(filtO, "tanh(0.8x)", { x: txs(-0.9), y: tys(-0.9) + 10, size: 17, color: C.a, ax: 1 });
      const tRef = label(filtO, "tanh(x)", { x: txs(2.0), y: tys(Math.tanh(2.0)) + 26, size: 15, color: C.mute, ax: 0.5 });
      const SX = 800, SY = 490, SW = 1000, SH = 340;
      const scPanel = panel(filtU, { x: SX, y: SY, w: SW, h: SH });
      const scT = label(filtO, "a sine through it: the mean lifts off zero", { x: SX + 16, y: SY + 12, size: 16, color: C.silk });
      const scy = SY + SH / 2 + 16;
      const scA = 118;
      const AMP = 1.8;
      let mean = 0;
      for (let i = 0; i < 4000; i++) mean += diodeSat(AMP * Math.sin((2 * Math.PI * i) / 4000)) / 4000;
      const sc = group(filtS);
      el("line", { x1: SX + 20, y1: scy, x2: SX + SW - 20, y2: scy, stroke: C.hair, "stroke-width": 1.2 }, sc);
      const scG = group(filtS, "a");
      const scP = path(scG, fnD(400, (q) => [SX + 24 + q * (SW - 48), scy - diodeSat(AMP * Math.sin(2 * Math.PI * 3 * q)) * scA]), { stroke: C.a, "stroke-width": 2.8 });
      const scDraw = drawable(scP);
      const meanL = el("line", { x1: SX + 20, x2: SX + SW - 20, y1: scy - mean * scA, y2: scy - mean * scA, stroke: C.silk, "stroke-width": 2, "stroke-dasharray": "8 7" }, filtS);
      const pk = [diodeSat(AMP), diodeSat(-AMP)];
      const pkG = group(filtS);
      pk.forEach((v) => el("line", { x1: SX + 20, x2: SX + SW - 20, y1: scy - v * scA, y2: scy - v * scA, stroke: C.mute, "stroke-width": 1.2, "stroke-dasharray": "3 6" }, pkG));
      const pkL = pk.map((v) => label(filtO, `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`, { x: SX + SW - 16, y: scy - v * scA + (v > 0 ? -6 : 6), size: 15, color: C.dim, ax: 1, ay: v > 0 ? 1 : 0 }));
      const meanT = label(filtO, `- - mean = +${mean.toFixed(3)} · a DC offset`, { x: SX + SW - 16, y: SY + 12, size: 16, color: C.silk, ax: 1 });

      // ---- modules3: two sorts, two Rust types.
      const typU = el("div", { class: "layer" }, under);
      const typO = el("div", { class: "layer" }, over);
      const typS = group(svg);
      // Tidal, from the preset library: chorus(filter(supersaw)), with the
      // chorus modulated by or(euclid, euclid).
      const NODES = [
        { n: "chorus", x: 430, y: 230, sort: "a" },
        { n: "filter", x: 300, y: 400, sort: "a", p: 0 },
        { n: "supersaw", x: 300, y: 570, sort: "a", p: 1 },
        { n: "or", x: 640, y: 400, sort: "b", p: 0 },
        { n: "euclid", x: 560, y: 570, sort: "b", p: 3 },
        { n: "euclid", x: 740, y: 570, sort: "b", p: 3 },
      ];
      const edgeG = group(typS);
      const edges = NODES.filter((n) => n.p != null).map((n) => {
        const pn = NODES[n.p];
        const mod = n.sort === "b";
        const p = path(edgeG, `M${pn.x} ${pn.y + 26} C${pn.x} ${pn.y + 80} ${n.x} ${n.y - 80} ${n.x} ${n.y - 26}`, { stroke: mod ? C.b : C.aDim, "stroke-width": 3, ...(mod ? { "stroke-dasharray": "9 8" } : {}) });
        return { p, n };
      });
      const nodeEls = NODES.map((n) => {
        const d = pill(typO, n.n, { x: n.x, y: n.y, cls: n.sort, ax: 0.5 });
        Object.assign(d.style, { fontSize: "24px", padding: "10px 26px" });
        return d;
      });
      const legA = label(typO, "── audio · AudioNode", { x: 600, y: 190, size: 19, color: C.a });
      const legB = label(typO, "‑ ‑ modulation · ModNode", { x: 600, y: 226, size: 19, color: C.b });
      const presetT = label(typO, "Tidal, from the preset library", { x: 200, y: 158, size: 17, color: C.mute });
      const code = panel(typU, { x: 980, y: 170, w: 820, h: 330 });
      const codeT = label(typO, "", {
        x: 1010, y: 196, size: 25, color: C.silk, html: true,
      });
      codeT.innerHTML =
        `<span style="color:${C.mute}">// crates/auracle-grammar/src/term.rs</span><br>` +
        `enum <span style="color:${C.a}">AudioNode</span> {<br>` +
        `&nbsp;&nbsp;Filter {<br>` +
        `&nbsp;&nbsp;&nbsp;&nbsp;input: Box&lt;<span style="color:${C.a}">AudioNode</span>&gt;,<br>` +
        `&nbsp;&nbsp;&nbsp;&nbsp;modulation: <span style="color:${C.b}">ModNode</span>,<br>` +
        `&nbsp;&nbsp;&nbsp;&nbsp;…<br>` +
        `&nbsp;&nbsp;}, …<br>}`;
      codeT.style.lineHeight = "1.5";
      const intruder = pill(typO, "lfo", { x: 0, y: 0, cls: "b", ax: 0.5 });
      Object.assign(intruder.style, { fontSize: "24px", padding: "10px 26px" });
      const cross = label(typO, "✕", { x: 0, y: 0, size: 64, color: C.silk, ax: 0.5, ay: 0.5 });
      cross.style.textShadow = `0 0 18px ${inkA("--silk", 0.45)}`;
      const err1 = label(typO, "error[E0308]: mismatched types", { x: 980, y: 560, size: 24, color: C.silk });
      const err2 = label(typO, "expected Box<AudioNode>, found ModNode", { x: 980, y: 602, size: 20, color: C.dim });
      const err3 = label(typO, "a mistyped patch cannot be constructed", { x: 980, y: 660, size: 22, color: C.silk });
      const socket = el("rect", { x: 300 - 92, y: 570 - 30, width: 184, height: 60, rx: 30, fill: "none", stroke: C.a, "stroke-width": 2, "stroke-dasharray": "6 6", opacity: 0 }, typS);

      const v1 = voiceLine(over, "The palette has *forty-two modules*, from a plucked string to sidechained dynamics.");
      const v2 = voiceLine(over, "The filter is a *state variable* design, or a *diode ladder* that saturates harder one way.");
      const v3 = voiceLine(over, "Audio and modulation are *separate Rust types*, so a mistyped patch cannot even be built.");
      const tPl = wordTime(l1, "plucked");
      const tSc = wordTime(l1, "sidechained");
      const tLad = wordTime(l2, "diode ladder");
      const tSat = wordTime(l2, "saturates");
      const tTy = wordTime(l3, "separate");
      const tMis = wordTime(l3, "mistyped");
      const tNo = wordTime(l3, "cannot");
      return (tl, t) => {
        // Which picture: the bank, then the filters, then the types.
        const aU = 1 - ramp(t, l2.t0 - 0.35, l2.t0 + 0.05);
        const bU = ramp(t, l2.t0 - 0.25, l2.t0 + 0.15) * (1 - ramp(t, l3.t0 - 0.35, l3.t0 + 0.05));
        const cU = ramp(t, l3.t0 - 0.25, l3.t0 + 0.15);
        bankU.style.opacity = bankO.style.opacity = aU;
        bankS.setAttribute("opacity", aU);
        keyG.setAttribute("opacity", aU);
        filtU.style.opacity = filtO.style.opacity = bU;
        filtS.setAttribute("opacity", bU);
        typU.style.opacity = typO.style.opacity = cU;
        typS.setAttribute("opacity", cU);
        if (aU > 0) {
          show(title, ramp(t, wordTime(l1, "forty-two") - 0.1, wordTime(l1, "forty-two") + 0.4));
          tiles.forEach((tile) => {
            const u = ramp(t, b.t0 + 0.05 + tile.gi * 0.09 + (tile.i || 0) * 0.03, b.t0 + 0.45 + tile.gi * 0.09 + (tile.i || 0) * 0.03, E.out3);
            if (tile.label) return show(tile.label, u);
            tile.d.style.opacity = u;
            tile.gg.setAttribute("opacity", u);
            let on = 0;
            if (tile === pluck) on = fade(t, tPl - 0.1, tPl + 0.2, tSc - 0.1, tSc + 0.3);
            if (tile.gid === "dynamics") on = ramp(t, tSc - 0.05 + dyn.indexOf(tile) * 0.12, tSc + 0.25 + dyn.indexOf(tile) * 0.12);
            setTile(tile, on);
          });
          keys3.forEach((k, i) => {
            const u = ramp(t, tSc + 0.2 + i * 0.12, tSc + 0.5 + i * 0.12);
            k.p.setAttribute("opacity", u);
            k.c.setAttribute("opacity", u);
          });
          keyNote.style.opacity = ramp(t, tSc + 0.5, tSc + 0.9);
        }
        if (bU > 0) {
          plots.forEach((pl, i) => {
            pl.draw(ramp(t, l2.t0 + 0.1 + i * 0.25, l2.t0 + 0.8 + i * 0.25, E.io2));
            pl.gr.setAttribute("opacity", ramp(t, l2.t0 + i * 0.25, l2.t0 + 0.4 + i * 0.25));
          });
          svfBr.setAttribute("opacity", ramp(t, wordTime(l2, "state variable"), wordTime(l2, "state variable") + 0.4));
          svfL.style.opacity = ramp(t, wordTime(l2, "state variable"), wordTime(l2, "state variable") + 0.4);
          ladL.style.opacity = ramp(t, tLad, tLad + 0.4);
          const tu = ramp(t, tLad + 0.1, tLad + 0.5);
          tr.setAttribute("opacity", tu);
          trT.style.opacity = tu;
          show(trPanel, tu, 6);
          refP.setAttribute("opacity", tu);
          trDraw(ramp(t, tLad + 0.2, tSat + 0.4, E.io2));
          tPos.style.opacity = ramp(t, tSat, tSat + 0.4);
          tNeg.style.opacity = ramp(t, tSat + 0.3, tSat + 0.7);
          tRef.style.opacity = ramp(t, tSat + 0.3, tSat + 0.7);
          const su = ramp(t, tSat - 0.1, tSat + 0.3);
          sc.setAttribute("opacity", su);
          scT.style.opacity = su;
          show(scPanel, su, 6);
          scDraw(ramp(t, tSat, tSat + 1.0, E.io2));
          const mu = ramp(t, tSat + 0.9, tSat + 1.3);
          meanL.setAttribute("opacity", mu);
          meanT.style.opacity = mu;
          const pu = ramp(t, tSat + 0.5, tSat + 0.9);
          pkG.setAttribute("opacity", pu);
          pkL.forEach((x) => (x.style.opacity = pu));
        }
        if (cU > 0) {
          presetT.style.opacity = ramp(t, l3.t0, l3.t0 + 0.4);
          NODES.forEach((n, i) => show(nodeEls[i], ramp(t, l3.t0 - 0.1 + i * 0.1, l3.t0 + 0.3 + i * 0.1, E.out3)));
          edges.forEach((e, i) => e.p.setAttribute("opacity", ramp(t, l3.t0 + 0.1 + i * 0.1, l3.t0 + 0.4 + i * 0.1)));
          legA.style.opacity = ramp(t, wordTime(l3, "Audio"), wordTime(l3, "Audio") + 0.4);
          legB.style.opacity = ramp(t, wordTime(l3, "modulation"), wordTime(l3, "modulation") + 0.4);
          show(code, ramp(t, tTy - 0.2, tTy + 0.3));
          show(codeT, ramp(t, tTy - 0.2, tTy + 0.3));
          // An lfo, a modulation term, offered where audio is typed.
          const mv = ramp(t, tMis - 0.2, tNo - 0.05, E.io3);
          const shake = t > tNo ? Math.sin((t - tNo) * 60) * 9 * (1 - ramp(t, tNo, tNo + 0.4)) : 0;
          const back = ramp(t, tNo + 0.9, tNo + 1.7, E.io3);
          const ix = lerp(lerp(760, 300, mv), 760, back) + shake;
          const iy = lerp(lerp(800, 670, mv), 800, back);
          place(intruder, { x: ix, y: iy, ax: 0.5, ay: 0.5 });
          intruder.style.opacity = ramp(t, tMis - 0.4, tMis - 0.1) * (1 - ramp(t, tNo + 1.4, tNo + 1.8));
          socket.setAttribute("opacity", fade(t, tMis, tMis + 0.3, tNo + 1.2, tNo + 1.6));
          place(cross, { x: 300, y: 622, ax: 0.5, ay: 0.5 });
          cross.style.opacity = fade(t, tNo, tNo + 0.15, tNo + 1.3, tNo + 1.7);
          show(err1, ramp(t, tNo + 0.05, tNo + 0.35));
          show(err2, ramp(t, tNo + 0.25, tNo + 0.55));
          show(err3, ramp(t, tNo + 0.6, tNo + 1.0));
        }
        speak(v1, t, l1, l2.t0);
        speak(v2, t, l2, l3.t0);
        speak(v3, t, l3, b.t1 + 0.4);
        void tl;
      };
    },
  });
}

// ============================================================================
// 4 · compile — the mandatory tail, bounded parameters
// ============================================================================

/** A dial whose last stretch the grammar cannot reach (a cap on the map). */
function capDial(svg, over, { cx, cy, r, cap, name, sub }) {
  const a0 = (-225 * Math.PI) / 180;
  const sweep = (270 * Math.PI) / 180;
  const arc = (u0, u1, rr) => {
    const t0 = a0 + sweep * u0;
    const t1 = a0 + sweep * u1;
    const large = t1 - t0 > Math.PI ? 1 : 0;
    return `M${(cx + rr * Math.cos(t0)).toFixed(1)} ${(cy + rr * Math.sin(t0)).toFixed(1)}A${rr} ${rr} 0 ${large} 1 ${(cx + rr * Math.cos(t1)).toFixed(1)} ${(cy + rr * Math.sin(t1)).toFixed(1)}`;
  };
  const g = el("g", {}, svg);
  const R = r + 22;
  path(g, arc(cap, 1, R), { stroke: C.mute, "stroke-width": 7, "stroke-dasharray": "3 7", opacity: 0.9 });
  const hotG = group(g, "a");
  const hot = path(hotG, "", { stroke: C.a, "stroke-width": 8 });
  const tc = a0 + sweep * cap;
  path(g, `M${cx + (R - 16) * Math.cos(tc)} ${cy + (R - 16) * Math.sin(tc)} L${cx + (R + 16) * Math.cos(tc)} ${cy + (R + 16) * Math.sin(tc)}`, { stroke: C.silk, "stroke-width": 3 });
  const k = knob(g, { cx, cy, r, color: "a", glow: false });
  k.set(0);
  const nameL = label(over, name, { x: cx, y: cy + r + 40, size: 19, color: C.silk, ax: 0.5, cls: "silk", ls: "0.16em" });
  const subL = label(over, sub, { x: cx, y: cy + r + 76, size: 19, color: C.a, ax: 0.5 });
  const capL = label(over, `${cap}`, { x: cx + (R + 34) * Math.cos(tc), y: cy + (R + 34) * Math.sin(tc), size: 18, color: C.silk, ax: 0.5, ay: 0.5 });
  return {
    g,
    labels: [nameL, subL, capL],
    set(v) {
      hot.setAttribute("d", v > 0.002 ? arc(0, Math.min(v, cap), R) : "");
      k.set(Math.min(v, cap));
    },
  };
}

function sceneCompile({ stage, beat, line }) {
  const b = beat("compile");
  const l1 = line("compile1");
  const l2 = line("compile2");
  stage.scene({
    id: "compile", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      // compile(): `<audio> → DC blocker → VCA (amp ADSR) → Limiter → StereoOutput`.
      const RY = 200, RH = 140, RC = RY + RH / 2;
      const src = place(el("div", {}, under), { x: 100, y: RY, w: 240, h: RH });
      Object.assign(src.style, { border: `2px dashed ${C.aDeep}`, borderRadius: "10px" });
      const srcT = label(over, "⟨audio⟩", { x: 220, y: RY + 50, size: 26, color: C.a, ax: 0.5, ay: 0.5 });
      const srcS = label(over, "the evolved term", { x: 220, y: RY + 90, size: 16, color: C.dim, ax: 0.5, ay: 0.5 });
      const B = [
        box(under, { x: 430, y: RY, w: 270, h: RH, title: "DC blocker", sub: "Svf high pass\n20 Hz · res 0" }),
        box(under, { x: 790, y: RY, w: 240, h: RH, title: "VCA", sub: "Vca" }),
        box(under, { x: 1120, y: RY, w: 270, h: RH, title: "Limiter", sub: "threshold 1.0 = 5 V\nsoft off" }),
        box(under, { x: 1480, y: RY, w: 300, h: RH, title: "StereoOutput", sub: "voice:out" }),
      ];
      const vcaSub = label(over, "response: exponential", { x: 808, y: RY + 76, size: 16, color: C.a });
      const adsr = box(under, { x: 790, y: 420, w: 240, h: 104, title: "ADSR", sub: "shape: exponential", color: "b" });
      const arrs = [
        arrow(svg, [340, RC], [428, RC]),
        arrow(svg, [700, RC], [788, RC]),
        arrow(svg, [1030, RC], [1118, RC]),
        arrow(svg, [1390, RC], [1478, RC]),
        arrow(svg, [910, 420], [910, RY + RH + 2], "b"),
      ];
      // makes_dc: a ladder or a tube drive; this is the one from the filter scene.
      const dcNote = label(over, "only where the term can make DC: a ladder or a tube drive · makes_dc()", { x: 430, y: RY - 36, size: 17, color: C.dim });
      const DX = 430, DY = 380, DW = 270, DH = 150;
      const dcPanel = panel(under, { x: DX, y: DY, w: DW, h: DH });
      const dcS = group(svg);
      const dcy = DY + DH / 2 + 6;
      el("line", { x1: DX + 12, y1: dcy, x2: DX + DW - 12, y2: dcy, stroke: C.hair, "stroke-width": 1.2 }, dcS);
      let mean = 0;
      for (let i = 0; i < 4000; i++) mean += diodeSat(1.8 * Math.sin((2 * Math.PI * i) / 4000)) / 4000;
      const dcG = group(svg, "a");
      const dcP = path(dcG, "", { stroke: C.a, "stroke-width": 2.4 });
      const dcM = el("line", { x1: DX + 12, x2: DX + DW - 12, stroke: C.silk, "stroke-width": 1.8, "stroke-dasharray": "6 6" }, svg);
      const dcT = label(over, "", { x: DX + 14, y: DY + 10, size: 15, color: C.silk });
      // A ±0.1 gauge for the mean: the offset is a few per cent of the wave.
      const GX0 = DX + DW - 30;
      el("line", { x1: GX0, x2: GX0, y1: dcy - 50, y2: dcy + 50, stroke: C.hair, "stroke-width": 8, "stroke-linecap": "round" }, dcS);
      const gBarG = group(svg, "a");
      const gBar = el("line", { x1: GX0, x2: GX0, y1: dcy, y2: dcy, stroke: C.a, "stroke-width": 8, "stroke-linecap": "round" }, gBarG);
      el("line", { x1: GX0 - 9, x2: GX0 + 9, y1: dcy, y2: dcy, stroke: C.silk, "stroke-width": 1.5 }, dcS);
      // The amp envelope: exponential segments, against the linear ones it replaced.
      const EX = 1120, EY = 420, EW = 660, EH = 250;
      const envPanel = panel(under, { x: EX, y: EY, w: EW, h: EH });
      const envT = label(over, "amp envelope · exponential", { x: EX + 16, y: EY + 12, size: 16, color: C.silk });
      const envL = label(over, "- - linear: a fader being pulled", { x: EX + EW - 16, y: EY + 12, size: 15, color: C.mute, ax: 1 });
      const ENV = { a: 0.08, d: 0.5, s: 0.45, r: 0.7, off: 1.1 };
      const ex = (t) => EX + 24 + (t / 2.0) * (EW - 48);
      const ey = (v) => EY + EH - 26 - v * (EH - 80);
      const eBase = el("line", { x1: EX + 20, y1: ey(0), x2: EX + EW - 20, y2: ey(0), stroke: C.hair, "stroke-width": 1.2 }, svg);
      const linP = path(svg, fnD(200, (q) => [ex(q * 2), ey(adsrLin(q * 2, ENV))]), { stroke: C.mute, "stroke-width": 2, "stroke-dasharray": "6 6" });
      const linDraw = drawable(linP);
      const expG = group(svg, "b");
      const expP = path(expG, fnD(300, (q) => [ex(q * 2), ey(adsrExp(q * 2, ENV))]), { stroke: C.b, "stroke-width": 3 });
      const expDraw = drawable(expP);
      const limNote = label(over, "a safety net · the real limiting is on the master bus", { x: 1120, y: 360, size: 17, color: C.dim });
      const chan = label(over, "built once per channel, so stereo tails stay stereo", { x: 100, y: 870, size: 18, color: C.mute });
      // compile2: two dials whose tops the grammar cannot reach.
      const dials = [
        capDial(svg, over, { cx: 330, cy: 610, r: 92, cap: 0.85, name: "resonance", sub: "× 0.85 · never self-oscillation" }),
        capDial(svg, over, { cx: 1130, cy: 610, r: 92, cap: 0.7, name: "delay feedback", sub: "× 0.7 · cannot run away" }),
      ];
      // Beside each: what the cap buys, from the linear maths.
      const RX = 520, RYp = 470, RW = 420, RHp = 250;
      const ringP = panel(under, { x: RX, y: RYp, w: RW, h: RHp });
      const ringT = label(over, "ladder impulse · k = 4·0.85 = 3.4", { x: RX + 16, y: RYp + 12, size: 15, color: C.silk });
      const ringN = label(over, "k = 4 rings forever: unreachable", { x: RX + 16, y: RYp + RHp - 30, size: 15, color: C.mute });
      // Poles of (1+s)⁴ = −k nearest the axis: s = −1 + k^¼·e^{±jπ/4}.
      const pole = (k) => ({ re: -1 + Math.pow(k, 0.25) * Math.SQRT1_2, im: Math.pow(k, 0.25) * Math.SQRT1_2 });
      const rcy = RYp + 120;
      const ringD = (k) => {
        const p = pole(k);
        return fnD(300, (q) => {
          const tt = q * 90;
          return [RX + 20 + q * (RW - 40), rcy - 70 * Math.exp(p.re * tt) * Math.sin(p.im * tt)];
        });
      };
      const ringGrey = path(svg, ringD(4), { stroke: C.mute, "stroke-width": 1.6, "stroke-dasharray": "4 5" });
      const ringG = group(svg, "a");
      const ringHot = path(ringG, ringD(3.4), { stroke: C.a, "stroke-width": 2.6 });
      const ringDraw = drawable(ringHot);
      const FX = 1320, FW = 460;
      const fbP = panel(under, { x: FX, y: RYp, w: FW, h: RHp });
      const fbT = label(over, "echoes · each one × 0.7", { x: FX + 16, y: RYp + 12, size: 15, color: C.silk });
      const fbN = label(over, "× 1.0 never dies: unreachable", { x: FX + 16, y: RYp + RHp - 30, size: 15, color: C.mute });
      const fbG = group(svg, "a");
      const echoes = Array.from({ length: 10 }, (_, i) => {
        const x = FX + 34 + i * 43;
        const base = RYp + 200;
        const grey = el("line", { x1: x, y1: base, x2: x, y2: base - 140, stroke: C.mute, "stroke-width": 2, "stroke-dasharray": "3 4" }, svg);
        const hot = el("line", { x1: x, y1: base, x2: x, y2: base - 140 * Math.pow(0.7, i), stroke: C.a, "stroke-width": 5, "stroke-linecap": "round" }, fbG);
        return { grey, hot };
      });
      const v1 = voiceLine(over, "Every voice ends with a *DC blocker* where needed, an *exponential envelope*, and a *limiter*.");
      const v2 = voiceLine(over, "Resonance and feedback are *capped*, so filters cannot oscillate and delays cannot run away.");
      const tDC = wordTime(l1, "DC blocker");
      const tEx = wordTime(l1, "exponential");
      const tLi = wordTime(l1, "limiter");
      const tCap = wordTime(l2, "capped");
      const tOsc = wordTime(l2, "oscillate");
      const tRun = wordTime(l2, "run away");
      return (tl, t) => {
        const one = 1 - ramp(t, l2.t0 - 0.4, l2.t0);
        const two = ramp(t, l2.t0 - 0.2, l2.t0 + 0.3);
        show(src, ramp(t, b.t0, b.t0 + 0.4, E.out3));
        srcT.style.opacity = srcS.style.opacity = ramp(t, b.t0, b.t0 + 0.4);
        B.forEach((d, i) => show(d, ramp(t, b.t0 + 0.15 + i * 0.15, b.t0 + 0.55 + i * 0.15, E.out3)));
        show(adsr, ramp(t, b.t0 + 0.6, b.t0 + 1.0, E.out3) * one);
        arrs.forEach((a, i) => a.update(ramp(t, b.t0 + 0.3 + i * 0.15, b.t0 + 0.7 + i * 0.15)));
        arrs[4].g.style.opacity = one;
        // The row stays for compile2, quieter.
        const rowDim = lerp(1, 0.55, two);
        [src, ...B].forEach((d) => (d.style.filter = `brightness(${rowDim})`));
        // DC blocker: the offset drops to zero before the VCA.
        const lit = ramp(t, tDC, tDC + 0.3);
        B[0].style.borderColor = lit > 0 && one > 0.5 ? inkA("--phos-a", 0.3 + 0.6 * lit) : "";
        dcNote.style.opacity = ramp(t, tDC - 0.1, tDC + 0.3) * one;
        const drop = ramp(t, tDC + 0.3, tDC + 1.1, E.io3);
        const off = mean * (1 - drop);
        const dA = 52;
        dcP.setAttribute("d", fnD(200, (q) => [DX + 16 + q * (DW - 76), dcy - (diodeSat(1.8 * Math.sin(2 * Math.PI * 2.5 * q)) - mean + off) * dA]));
        gBar.setAttribute("y2", (dcy - (off / 0.1) * 50).toFixed(1));
        gBarG.setAttribute("opacity", ramp(t, tDC - 0.2, tDC + 0.2) * one);
        dcM.setAttribute("y1", dcy - off * dA);
        dcM.setAttribute("y2", dcy - off * dA);
        dcM.setAttribute("x2", DX + DW - 56);
        dcT.textContent = `mean ${off >= 0.0005 ? "+" + off.toFixed(3) : "0.000"}`;
        const dcU = ramp(t, tDC - 0.2, tDC + 0.2) * one;
        dcS.setAttribute("opacity", dcU);
        dcPanel.style.opacity = dcU;
        dcG.setAttribute("opacity", dcU);
        dcM.setAttribute("opacity", dcU);
        dcT.style.opacity = dcU;
        // Exponential envelope, exponential VCA.
        const eu = ramp(t, tEx - 0.2, tEx + 0.2) * one;
        envT.style.opacity = envL.style.opacity = eu;
        envPanel.style.opacity = eu;
        eBase.setAttribute("opacity", eu);
        linP.setAttribute("opacity", eu);
        expG.setAttribute("opacity", eu);
        linDraw(ramp(t, tEx, tEx + 1.0, E.io2));
        expDraw(ramp(t, tEx + 0.1, tEx + 1.2, E.io2));
        vcaSub.style.opacity = ramp(t, tEx + 0.2, tEx + 0.6);
        B[1].style.borderColor = ramp(t, tEx, tEx + 0.3) * one > 0.1 ? inkA("--phos-a", 0.6) : "";
        const lu = ramp(t, tLi - 0.1, tLi + 0.3);
        B[2].style.borderColor = lu > 0 && one > 0.5 ? inkA("--phos-a", 0.3 + 0.6 * lu) : "";
        limNote.style.opacity = lu * one;
        chan.style.opacity = ramp(t, tLi + 0.4, tLi + 0.9) * one;
        // compile2: the caps.
        dials.forEach((d, i) => {
          const u = ramp(t, l2.t0 + i * 0.2, l2.t0 + 0.4 + i * 0.2, E.out3);
          d.g.setAttribute("opacity", u);
          d.labels.forEach((x) => (x.style.opacity = u));
          // The knob is turned all the way up; the mapping stops at the cap.
          const want = ramp(t, tCap - 0.1 + i * 0.3, tCap + 1.1 + i * 0.3, E.io3);
          d.set(want);
        });
        const ru = ramp(t, tOsc - 0.4, tOsc);
        ringP.style.opacity = ringT.style.opacity = ru;
        ringN.style.opacity = ramp(t, tOsc + 0.3, tOsc + 0.7);
        ringGrey.setAttribute("opacity", ramp(t, tOsc + 0.3, tOsc + 0.7));
        ringG.setAttribute("opacity", ru);
        ringDraw(ramp(t, tOsc - 0.2, tOsc + 1.2, E.io2));
        const fu = ramp(t, tRun - 0.6, tRun - 0.2);
        fbP.style.opacity = fbT.style.opacity = fu;
        fbN.style.opacity = ramp(t, tRun + 0.2, tRun + 0.6);
        echoes.forEach((e, i) => {
          e.hot.setAttribute("opacity", ramp(t, tRun - 0.4 + i * 0.07, tRun - 0.2 + i * 0.07));
          e.grey.setAttribute("opacity", ramp(t, tRun + 0.2, tRun + 0.6));
        });
        speak(v1, t, l1, l2.t0);
        speak(v2, t, l2, b.t1 + 0.4);
        void tl;
      };
    },
  });
}

// ============================================================================
// 5 · phrase — the standard phrase, and determinism
// ============================================================================

function scenePhrase({ stage, beat, line }) {
  const b = beat("phrase");
  const [l1, l2, l3, l4] = ["phrase1", "phrase2", "phrase3", "phrase4"].map(line);
  stage.scene({
    id: "phrase", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const rollU = el("div", { class: "layer" }, under);
      const rollO = el("div", { class: "layer" }, over);
      const rollS = group(svg);
      const X0 = 240, X1 = 1790;
      const tx = (s) => X0 + (s / PHRASE_S) * (X1 - X0);
      const eb = place(el("div", { class: "eyebrow" }, rollO, "the standard phrase"), { x: 100, y: 108 });
      const tag = label(rollO, "PhraseSpec::default() · 44 100 Hz · 5.05 s", { x: 1790, y: 108, size: 18, color: C.dim, ax: 1 });
      const LANES = ["C5", "E4", "C4", "C3"];
      const ly = (i) => 200 + i * 60;
      LANES.forEach((n, i) => {
        el("line", { x1: X0, y1: ly(i), x2: X1, y2: ly(i), stroke: C.hair, "stroke-width": 1 }, rollS);
        label(rollO, n, { x: 100, y: ly(i), ay: 0.5, size: 20, color: C.dim });
      });
      const noteG = group(rollS, "a");
      const notes = PHRASE.map((n) => ({
        ...n,
        r: el("rect", { x: tx(n.t0), y: ly(n.lane) - 17, width: tx(n.t1) - tx(n.t0), height: 34, rx: 5, fill: C.a, opacity: 0.15 }, noteG),
        o: el("rect", { x: tx(n.t0), y: ly(n.lane) - 17, width: tx(n.t1) - tx(n.t0), height: 34, rx: 5, fill: "none", stroke: C.aDim, "stroke-width": 1.5 }, rollS),
      }));
      const relBox = el("rect", { x: tx(3.95), y: ly(3) - 17, width: tx(5.05) - tx(3.95), height: 34, rx: 5, fill: "none", stroke: C.aDeep, "stroke-width": 1.5, "stroke-dasharray": "5 5" }, rollS);
      const relL = label(rollO, "release window · 1.10 s", { x: tx(4.5), y: ly(3) + 26, size: 16, color: C.dim, ax: 0.5 });
      const nameL = [
        label(rollO, "held 1.80 s", { x: tx(0.9), y: ly(2) - 26, size: 16, color: C.silk, ax: 0.5, ay: 1 }),
        label(rollO, "stab · an octave up", { x: tx(2.15), y: ly(0) - 26, size: 16, color: C.silk, ax: 0.5, ay: 1 }),
        label(rollO, "voice 2: its own compiled voice, gate-synced", { x: tx(2.95) + 16, y: ly(1), size: 16, color: C.silk, ay: 0.5 }),
        label(rollO, "low C", { x: tx(3.55), y: ly(3) - 26, size: 16, color: C.silk, ax: 0.5, ay: 1 }),
      ];
      // Two real renders on the same clock: a pluck-like bass and a pad.
      const fb = envOf(DATA.fb.env);
      const gp = envOf(DATA.gp.env);
      const strips = [
        { env: fb, y: 522, name: "First Bass" },
        { env: gp, y: 666, name: "Glass Pad" },
      ].map((s) => {
        const g = group(rollS, "a");
        const p = path(g, envD(s.env, { x: X0, y: s.y, w: X1 - X0, h: 62 }), { stroke: C.a, "stroke-width": 1.1 });
        const lb = label(rollO, s.name, { x: 100, y: s.y, ay: 0.5, size: 17, color: C.dim });
        return { ...s, g, p, lb };
      });
      const head = el("line", { y1: 170, y2: 730, stroke: C.silk, "stroke-width": 1.5, opacity: 0 }, rollS);
      const axisG = group(rollS);
      const axL = [];
      for (let s = 0; s <= 5; s++) {
        el("line", { x1: tx(s), y1: 748, x2: tx(s), y2: 758, stroke: C.mute, "stroke-width": 1.5 }, axisG);
        axL.push(label(rollO, `${s} s`, { x: tx(s), y: 764, size: 16, color: C.mute, ax: 0.5 }));
      }
      // The tail window: where tail_ratio is measured.
      const tailR = el("rect", { x: tx(4.75), y: 168, width: tx(5.05) - tx(4.75), height: 564, fill: C.b, opacity: 0 }, rollS);
      const tailL = label(rollO, "final 300 ms → tail_ratio", { x: tx(4.75) - 12, y: 808, size: 18, color: C.b, ax: 1 });
      const tailL2 = label(rollO, "which is why the low note is last", { x: tx(4.75) - 12, y: 840, size: 16, color: C.bDim, ax: 1 });
      // ---- phrase4: bit for bit.
      const detU = el("div", { class: "layer" }, under);
      const detO = el("div", { class: "layer" }, over);
      const detS = group(svg);
      const seed = label(detO, "", { x: 960, y: 150, size: 32, color: C.silk, ax: 0.5, html: true });
      seed.innerHTML = `quiver::rng::seed(<span style="color:${C.a}">0xE05F00D</span>)`;
      const seedN = label(detO, "before compile, every render · tick order fixed", { x: 960, y: 198, size: 18, color: C.dim, ax: 0.5 });
      const nw = samplesOf(DATA.nw.win);
      const nwMax = Math.max(...nw.map(Math.abs));
      const DX0 = 330, DX1 = 1760;
      const nwD = (y, amp) => fnD(nw.length - 1, (q) => [DX0 + q * (DX1 - DX0), y - (nw[Math.round(q * (nw.length - 1))] / nwMax) * amp]);
      const rows = [
        { y: 340, t: "render 1" },
        { y: 480, t: "render 2" },
      ].map((r) => {
        const g = group(detS, "a");
        const p = path(g, nwD(0, 72), { stroke: r.y === 340 ? C.a : C.silk, "stroke-width": r.y === 340 ? 2.2 : 1.4 });
        const lb = label(detO, r.t, { x: 100, y: r.y, ay: 0.5, size: 19, color: C.dim });
        return { ...r, g, p, lb };
      });
      const diffY = 600;
      const diffBase = el("line", { x1: DX0, y1: diffY, x2: DX1, y2: diffY, stroke: C.hair, "stroke-width": 1 }, detS);
      const diffG = group(detS, "a");
      const diffP = path(diffG, `M${DX0} ${diffY} L${DX1} ${diffY}`, { stroke: C.a, "stroke-width": 3 });
      const diffDraw = drawable(diffP);
      const diffL = label(detO, "1 − 2", { x: 100, y: diffY, ay: 0.5, size: 19, color: C.dim });
      const diffN = label(detO, `max |1 − 2| = 0 over all ${fmtInt(DATA.n)} samples · Noise Wash, pink noise`, { x: DX0, y: 650, size: 20, color: C.silk });
      const nwTag = label(detO, "20 ms of the held C4", { x: DX1, y: 244, size: 16, color: C.mute, ax: 1 });
      const v1 = voiceLine(over, "For comparison, every patch plays *the same five second phrase*.");
      const v2 = voiceLine(over, "It *holds* a C, *stabs* an octave higher, and plays a *two note chord*.");
      const v3 = voiceLine(over, "It ends on a *low C*, with a _long release_.");
      const v4 = voiceLine(over, "The random seed is reset every render, so the samples repeat *bit for bit*.");
      const tH = wordTime(l2, "holds");
      const tS = wordTime(l2, "stabs");
      const tC = wordTime(l2, "two note chord");
      const tLo = wordTime(l3, "low C");
      const tRel = wordTime(l3, "long release");
      const tSeed = wordTime(l4, "random seed");
      const tRen = wordTime(l4, "every render");
      const tBit = wordTime(l4, "bit for bit");
      const litAt = [tH, tS, tC, tC + 0.15, tLo];
      return (tl, t) => {
        const rollU1 = 1 - ramp(t, l4.t0 - 0.4, l4.t0);
        rollU.style.opacity = rollO.style.opacity = rollU1;
        rollS.setAttribute("opacity", rollU1);
        const det = ramp(t, l4.t0 - 0.2, l4.t0 + 0.3);
        detU.style.opacity = detO.style.opacity = det;
        detS.setAttribute("opacity", det);
        if (rollU1 > 0) {
          show(eb, ramp(t, b.t0, b.t0 + 0.4));
          tag.style.opacity = ramp(t, wordTime(l1, "five second") - 0.2, wordTime(l1, "five second") + 0.3);
          // phrase1: the playhead plays it once, and both renders follow it.
          const ph = ramp(t, l1.t0 + 0.1, l1.t1 + 0.2, E.lin);
          head.setAttribute("x1", tx(ph * PHRASE_S));
          head.setAttribute("x2", tx(ph * PHRASE_S));
          head.setAttribute("opacity", fade(t, l1.t0, l1.t0 + 0.2, l1.t1, l1.t1 + 0.3) * 0.7);
          const i1 = Math.max(1, Math.floor(ph * fb.n));
          strips.forEach((s, i) => {
            s.p.setAttribute("d", envD(s.env, { x: X0, y: s.y, w: X1 - X0, h: 62, i1 }));
            s.lb.style.opacity = ramp(t, l1.t0 + i * 0.2, l1.t0 + 0.4 + i * 0.2);
            s.g.setAttribute("opacity", 0.55 + 0.45 * ramp(t, tH - 0.2, tH + 0.3));
          });
          notes.forEach((n, i) => {
            const on = ramp(t, litAt[i] - 0.1, litAt[i] + 0.25, E.out3);
            const playing = ph * PHRASE_S >= n.t0 && ph * PHRASE_S <= n.t1 && t < l1.t1 + 0.3;
            n.r.setAttribute("opacity", Math.max(0.15 + 0.85 * on, playing ? 0.55 : 0).toFixed(3));
            n.o.setAttribute("opacity", ramp(t, b.t0 + 0.1, b.t0 + 0.5));
          });
          nameL.forEach((nl, i) => show(nl, ramp(t, [tH, tS, tC + 0.2, tLo][i], [tH, tS, tC + 0.2, tLo][i] + 0.35)));
          relBox.setAttribute("opacity", ramp(t, tRel - 0.1, tRel + 0.3));
          relL.style.opacity = ramp(t, tRel, tRel + 0.4);
          axisG.setAttribute("opacity", ramp(t, b.t0, b.t0 + 0.4));
          axL.forEach((a) => (a.style.opacity = ramp(t, b.t0, b.t0 + 0.4)));
          tailR.setAttribute("opacity", 0.16 * ramp(t, tRel + 0.3, tRel + 0.8));
          show(tailL, ramp(t, tRel + 0.5, tRel + 0.9));
          show(tailL2, ramp(t, tRel + 0.8, tRel + 1.2));
        }
        if (det > 0) {
          show(seed, ramp(t, tSeed - 0.2, tSeed + 0.3));
          show(seedN, ramp(t, tRen - 0.2, tRen + 0.3));
          // Two renders, then one laid over the other: they coincide.
          rows.forEach((r, i) => {
            const y = i === 0 ? 340 : lerp(480, 340, ramp(t, tRen + 0.2, tRen + 1.0, E.io3));
            r.p.setAttribute("d", nwD(y, 72));
            r.g.setAttribute("opacity", ramp(t, l4.t0 + i * 0.25, l4.t0 + 0.4 + i * 0.25));
            r.lb.style.opacity = ramp(t, l4.t0 + i * 0.25, l4.t0 + 0.4 + i * 0.25) * (i === 1 ? 1 - ramp(t, tRen + 0.4, tRen + 0.9) : 1);
          });
          rows[0].lb.textContent = t > tRen + 0.8 ? "render 1, 2" : "render 1";
          nwTag.style.opacity = ramp(t, l4.t0 + 0.3, l4.t0 + 0.7);
          const du = ramp(t, tRen + 1.0, tRen + 1.4);
          diffBase.setAttribute("opacity", du);
          diffL.style.opacity = du;
          diffDraw(ramp(t, tRen + 1.0, tBit + 0.1, E.io2));
          const glow = ramp(t, tBit, tBit + 0.4);
          diffP.setAttribute("stroke-width", (3 + 2.5 * glow).toFixed(2));
          diffG.style.filter = glow > 0.05 ? `${GLOW.a} drop-shadow(0 0 ${(22 * glow).toFixed(1)}px ${inkA("--phos-a", 0.55)})` : GLOW.a;
          show(diffN, ramp(t, tBit + 0.1, tBit + 0.5));
        }
        speak(v1, t, l1, l2.t0);
        speak(v2, t, l2, l3.t0);
        speak(v3, t, l3, l4.t0);
        speak(v4, t, l4, b.t1 + 0.4);
        void tl;
      };
    },
  });
}

// ============================================================================
// 6 · vetting — the gate on the raw render
// ============================================================================

function sceneVetting({ stage, beat, line }) {
  const b = beat("vetting");
  const [l1, l2, l3] = ["vetting1", "vetting2", "vetting3"].map(line);
  stage.scene({
    id: "vetting", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      // What arrives: First Bass as rendered, before any gain (peak 0.49).
      const fb = envOf(DATA.fb.env);
      const rawGain = Math.pow(10, -DATA.fb.gain / 20);
      // Three pathologies, made to order so each trips exactly one check.
      const N = 600;
      const sig = {
        silent: Array.from({ length: N }, (_, i) => 2.6e-5 * Math.sin((2 * Math.PI * 9 * i) / N)),
        runaway: Array.from({ length: N }, (_, i) => 0.25 * Math.exp((3.2 * i) / N) * Math.sin((2 * Math.PI * 9 * i) / N)),
        dc: Array.from({ length: N }, (_, i) => 0.8 + 0.25 * Math.sin((2 * Math.PI * 9 * i) / N)),
      };
      const stat = (x) => {
        const n = x.length;
        const mean = x.reduce((a, v) => a + v, 0) / n;
        const rms = Math.sqrt(x.reduce((a, v) => a + v * v, 0) / n);
        const peak = Math.max(...x.map(Math.abs));
        return { mean, rms, peak, dc: Math.abs(mean) / rms };
      };
      const st = { silent: stat(sig.silent), runaway: stat(sig.runaway), dc: stat(sig.dc) };
      const sup = (v) => {
        const e = Math.floor(Math.log10(Math.abs(v)));
        const m = v / Math.pow(10, e);
        return `${m.toFixed(1)}·10${String(e).replace("-", "⁻").replace(/\d/g, (d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[d])}`;
      };
      // The incoming screen.
      const IX = 100, IY = 300, IW = 470, IH = 220, ICY = IY + IH / 2;
      const inScr = place(el("div", { class: "screen" }, under), { x: IX, y: IY, w: IW, h: IH });
      const inT = label(over, "", { x: IX, y: IY - 36, size: 18, color: C.silk });
      const inM = label(over, "", { x: IX, y: IY + IH + 16, size: 17, color: C.dim });
      const clipId = "vetclip";
      const defs = el("defs", {}, svg);
      const cp = el("clipPath", { id: clipId }, defs);
      el("rect", { x: IX, y: IY, width: IW, height: IH }, cp);
      const inG = el("g", { "clip-path": `url(#${clipId})` }, svg);
      const inWG = group(inG, "a");
      const inP = path(inWG, "", { stroke: C.a, "stroke-width": 1.6 });
      const inZ = el("line", { x1: IX, y1: ICY, x2: IX + IW, y2: ICY, stroke: C.hair, "stroke-width": 1 }, inG);
      const AMP = 100; // pixels per unit, the raw ±1.0 domain
      const sigD = (x, dx) => fnD(x.length - 1, (q) => [IX + 14 + q * (IW - 28) + dx, ICY - x[Math.round(q * (x.length - 1))] * AMP]);
      // The gate: four checks, in the code's order (vet.rs).
      const GX = 640;
      const gateG = group(svg);
      path(gateG, `M${GX} 190 L${GX} 640`, { stroke: C.aDeep, "stroke-width": 4 });
      const CHECKS = [
        { k: "nonfinite", t: "non-finite · any NaN or ∞" },
        { k: "silent", t: "silent · RMS < 10⁻⁴" },
        { k: "runaway", t: "overlevel · peak > 2.0 + 1.5·(voices − 1) = 3.5" },
        { k: "dc", t: "DC · |mean| / RMS > 0.6" },
      ].map((c, i) => {
        const d = pill(over, c.t, { x: GX + 30, y: 230 + i * 118, size: 18 });
        const mark = label(over, "", { x: GX + 6, y: 230 + i * 118, size: 26, color: C.a, ax: 0.5, ay: 0.5 });
        return { ...c, d, mark, y: 230 + i * 118 };
      });
      // Where things go.
      const passScr = place(el("div", { class: "screen" }, under), { x: 1400, y: 190, w: 400, h: 170 });
      const passG = group(svg, "a");
      path(passG, envD(fb, { x: 1414, y: 275, w: 372, h: 100, gain: rawGain }), { stroke: C.a, "stroke-width": 1 });
      const passT = label(over, "✓ vetted → loudness", { x: 1400, y: 154, size: 20, color: C.a });
      const qBox = place(el("div", { class: "plate" }, under), { x: 1400, y: 470, w: 400, h: 250 });
      const qT = label(over, "quarantine", { x: 1424, y: 488, size: 20, color: C.silk, cls: "silk", ls: "0.16em" });
      const qTag = label(over, "fitness −50 · QUARANTINE_FITNESS", { x: 1800, y: 740, size: 19, color: C.b, ax: 1 });
      const qTag2 = label(over, "never played", { x: 1800, y: 770, size: 19, color: C.b, ax: 1 });
      const pre = label(over, "before any of this, a domain check on the term itself: no knob outside its range is rendered", { x: 100, y: 850, size: 17, color: C.mute });
      const thumbs = ["silent", "runaway", "dc"].map((k, i) => {
        const y = 566 + i * 54;
        const g = el("g", {}, svg);
        el("line", { x1: 1424, x2: 1664, y1: y, y2: y, stroke: C.hair, "stroke-width": 1 }, g);
        const peak = Math.max(1e-4, st[k].peak);
        const sc = k === "silent" ? 1 : 1 / peak;
        const p = path(group(g, "a"), fnD(sig[k].length - 1, (q) => [1424 + q * 240, y - sig[k][Math.round(q * (sig[k].length - 1))] * sc * 18]), { stroke: C.aDim, "stroke-width": 1.4 });
        const lb = label(over, ["silent", "overlevel", "DC"][i], { x: 1684, y, ay: 0.5, size: 17, color: C.dim });
        return { g, p, lb };
      });
      const v1 = voiceLine(over, "First, each *raw render* goes through a gate.");
      const v2 = voiceLine(over, "It fails silence, runaway peaks, and signals dominated by DC.");
      const v3 = voiceLine(over, "What fails is _never played_.");
      const tFail = { silent: wordTime(l2, "silence"), runaway: wordTime(l2, "runaway"), dc: wordTime(l2, "DC") };
      const tPass = wordTime(l1, "gate");
      return (tl, t) => {
        const inU = ramp(t, b.t0, b.t0 + 0.4) * (1 - ramp(t, l3.t0 - 0.2, l3.t0 + 0.3));
        inScr.style.opacity = inU;
        gateG.setAttribute("opacity", ramp(t, b.t0 + 0.2, b.t0 + 0.6));
        CHECKS.forEach((c, i) => show(c.d, ramp(t, b.t0 + 0.3 + i * 0.12, b.t0 + 0.7 + i * 0.12)));
        // Which signal is on the incoming screen, and where it is.
        let cur = "pass";
        let t0 = l1.t0 - 0.1;
        let tNext = tFail.silent - 0.55;
        for (const k of ["silent", "runaway", "dc"]) if (t >= tFail[k] - 0.55) { cur = k; t0 = tFail[k] - 0.55; }
        if (cur === "silent") tNext = tFail.runaway - 0.55;
        else if (cur === "runaway") tNext = tFail.dc - 0.55;
        else if (cur === "dc") tNext = l3.t0 + 0.2;
        const push = ramp(t, t0 + 0.2, t0 + 0.55, E.in2);
        const back = cur === "pass" ? 0 : ramp(t, t0 + 0.7, t0 + 1.0, E.out3);
        const dx = cur === "pass" ? 140 * ramp(t, tPass - 0.1, tPass + 0.5, E.in2) : 110 * push * (1 - back);
        let o = inU;
        if (cur === "pass") {
          inP.setAttribute("d", envD(fb, { x: IX + 14 + dx, y: ICY, w: IW - 28, h: AMP, gain: rawGain }));
          inT.textContent = "raw render · First Bass";
          inM.textContent = `peak ${DATA.fb.rawPeak.toFixed(2)} · RMS ${DATA.fb.rawRms.toFixed(3)} · |mean|/RMS ${sup(DATA.fb.dc)}`;
          o *= 1 - ramp(t, tPass + 0.3, tPass + 0.6);
        } else {
          inP.setAttribute("d", sigD(sig[cur], dx));
          const s = st[cur];
          inT.textContent = { silent: "a silent render", runaway: "a runaway render", dc: "a DC-dominated render" }[cur];
          inM.textContent = { silent: `RMS ${sup(s.rms)}`, runaway: `peak ${s.peak.toFixed(1)}`, dc: `|mean| / RMS = ${s.dc.toFixed(2)}` }[cur];
          o *= ramp(t, t0, t0 + 0.2) * (1 - ramp(t, tNext - 0.15, tNext));
        }
        inWG.setAttribute("opacity", o);
        inZ.setAttribute("opacity", inU);
        inT.style.opacity = inM.style.opacity = cur === "pass" ? inU * (1 - ramp(t, tPass + 0.4, tPass + 0.7)) : o;
        // Checks: ✓ for everything that passes a check, ✕ where it stops.
        CHECKS.forEach((c, i) => {
          let m = "";
          let col = C.a;
          if (cur === "pass" && t > tPass + i * 0.12) m = "✓";
          if (cur !== "pass") {
            const failAt = CHECKS.findIndex((x) => x.k === cur);
            if (t > t0 + 0.5 && t < tNext) {
              if (i < failAt) m = "✓";
              if (i === failAt) { m = "✕"; col = C.silk; }
            }
          }
          c.mark.textContent = m;
          c.mark.style.color = col;
          const hot = cur !== "pass" && CHECKS.findIndex((x) => x.k === cur) === i && t > t0 + 0.5 && t < tNext;
          c.d.style.borderColor = hot ? C.silk : "";
          c.d.style.color = hot ? C.silk : "";
          c.mark.style.opacity = m ? 1 - ramp(t, l3.t0 - 0.2, l3.t0 + 0.3) : 0;
        });
        // The one that passes goes on; the ones that fail are held back.
        const pu = ramp(t, tPass + 0.3, tPass + 0.8);
        passScr.style.opacity = pu;
        passG.setAttribute("opacity", pu);
        show(passT, pu);
        const qu = ramp(t, tFail.silent + 0.2, tFail.silent + 0.6);
        show(qBox, qu);
        qT.style.opacity = qu;
        thumbs.forEach((th, i) => {
          const tt = tFail[["silent", "runaway", "dc"][i]] + 0.5;
          const u = ramp(t, tt, tt + 0.35, E.out3);
          th.g.setAttribute("opacity", u);
          th.g.setAttribute("transform", `translate(0 ${((1 - u) * -30).toFixed(1)})`);
          th.lb.style.opacity = u;
        });
        show(qTag, ramp(t, wordTime(l3, "never played") - 0.3, wordTime(l3, "never played") + 0.2));
        show(qTag2, ramp(t, wordTime(l3, "never played"), wordTime(l3, "never played") + 0.4));
        pre.style.opacity = ramp(t, l3.t1 + 0.1, l3.t1 + 0.5);
        speak(v1, t, l1, l2.t0);
        speak(v2, t, l2, l3.t0);
        speak(v3, t, l3, b.t1 + 0.4);
        void tl;
      };
    },
  });
}

// ============================================================================
// 7 · loudness — BS.1770, to −18 LUFS, and the peak that wins
// ============================================================================

function sceneLoudness({ stage, beat, line }) {
  const b = beat("loudness");
  const [l1, l2, l3] = ["loudness1", "loudness2", "loudness3"].map(line);
  stage.scene({
    id: "loudness", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const fb = envOf(DATA.fb.env);
      // ---- loudness1: the K weighting, evaluated; then the gated blocks.
      const aU = el("div", { class: "layer" }, under);
      const aO = el("div", { class: "layer" }, over);
      const aS = group(svg);
      const KX = 100, KY = 130, KW = 760, KH = 270;
      panel(aU, { x: KX, y: KY, w: KW, h: KH });
      const kT = pill(aO, "ITU-R BS.1770 · K weighting", { x: KX + KW + 40, y: KY + 40, cls: "a" });
      const kN = label(aO, "high shelf +4 dB above 1 682 Hz · high pass at 38 Hz", { x: KX + KW + 40, y: KY + 86, size: 18, color: C.dim });
      const kN2 = label(aO, "two biquads, derived for 44 100 Hz from the analog prototype", { x: KX + KW + 40, y: KY + 118, size: 16, color: C.mute });
      const kx = (f) => logX(f, KX + 60, KW - 80, 10, 20000);
      const ky = (db) => KY + 24 + (1 - (db + 24) / 32) * (KH - 60);
      const kg = group(aS);
      for (const f of [10, 100, 1000, 10000]) {
        el("line", { x1: kx(f), y1: KY + 20, x2: kx(f), y2: KY + KH - 32, stroke: C.hair, "stroke-width": 1 }, kg);
        label(aO, f >= 1000 ? `${f / 1000}k` : `${f}`, { x: kx(f), y: KY + KH - 28, size: 14, color: C.mute, ax: 0.5 });
      }
      for (const db of [0, -12]) {
        el("line", { x1: KX + 60, y1: ky(db), x2: KX + KW - 20, y2: ky(db), stroke: C.hair, "stroke-width": 1 }, kg);
        label(aO, `${db} dB`, { x: KX + 52, y: ky(db), size: 14, color: C.mute, ax: 1, ay: 0.5 });
      }
      const shelf = kShelf(SR);
      const hp = kHighpass(SR);
      const kD = (fn) => fnD(220, (q) => { const f = 10 * Math.pow(2000, q); return [kx(f), ky(clamp(fn(f), -24, 8))]; });
      const kShelfP = path(aS, kD((f) => biquadDb(shelf, f)), { stroke: C.aDim, "stroke-width": 1.8, "stroke-dasharray": "5 5" });
      const kHpP = path(aS, kD((f) => biquadDb(hp, f)), { stroke: C.mute, "stroke-width": 1.8, "stroke-dasharray": "5 5" });
      const kSumG = group(aS, "a");
      const kSum = path(kSumG, kD((f) => biquadDb(shelf, f) + biquadDb(hp, f)), { stroke: C.a, "stroke-width": 3.2 });
      const kDraw = drawable(kSum);
      const kLeg = label(aO, "- - shelf · - - high pass · ── both", { x: KX + KW - 20, y: KY + 12, size: 14, color: C.mute, ax: 1 });
      // Blocks over the raw First Bass render, on one clock.
      const BX = 100, BW = 1700;
      const bx = (s) => BX + (s / PHRASE_S) * BW;
      const WY = 760, WA = 110;
      const rawGain = Math.pow(10, -DATA.fb.gain / 20);
      const wg = group(aS, "a");
      path(wg, envD(fb, { x: BX, y: WY, w: BW, h: WA, gain: rawGain }), { stroke: C.a, "stroke-width": 1 });
      const wTag = label(aO, "First Bass, raw", { x: BX, y: WY + 64, size: 16, color: C.mute });
      // Block loudness, one bar per 400 ms block, stepping 100 ms (75 % overlap).
      const blocks = DATA.fb.blocks;
      const LY0 = 640, LY1 = 460; // −80 LUFS … −20 LUFS
      const ly = (l) => LY0 - ((clamp(l, -80, -20) + 80) / 60) * (LY0 - LY1);
      const barG = group(aS);
      const bars = blocks.map((l, j) => {
        const c = bx(0.2 + j * 0.1);
        return el("rect", { x: c - 13, width: 26, y: ly(l), height: Math.max(0, LY0 - ly(l)), rx: 3, fill: C.a }, barG);
      });
      // Blocks of digital silence sit far under the chart: a stub each, so the gate has something to take.
      const stubs = blocks.map((l, j) => (l <= -80 ? el("rect", { x: bx(0.2 + j * 0.1) - 13, width: 26, y: LY0 - 6, height: 6, rx: 2, fill: C.mute }, aS) : null)).filter(Boolean);
      const silT = label(aO, "silence", { x: bx(0.2 + (blocks.length - 4) * 0.1), y: LY0 + 10, size: 14, color: C.mute, ax: 0.5 });
      const spans = [0, 1, 2, 3].map((j) => el("rect", { x: bx(j * 0.1), y: WY - 98 + j * 9, width: bx(0.4) - bx(0), height: 6, rx: 3, fill: "none", stroke: C.silk, "stroke-width": 1.5 }, aS));
      const spanL = label(aO, "400 ms blocks · every 100 ms", { x: bx(0.52), y: WY - 104, size: 16, color: C.silk, ay: 0.5 });
      const absY = ly(-70);
      const absTh = -0.691 + 10 * Math.log10(blocks.filter((l) => l > -70).reduce((a, l) => a + Math.pow(10, (l + 0.691) / 10), 0) / blocks.filter((l) => l > -70).length) - 10;
      const absL = el("line", { x1: BX, x2: BX + BW, y1: absY, y2: absY, stroke: C.silk, "stroke-width": 1.5, "stroke-dasharray": "6 6" }, aS);
      const absT = label(aO, "absolute gate −70", { x: BX + BW, y: absY - 6, size: 16, color: C.silk, ax: 1, ay: 1 });
      const relY = ly(absTh);
      const relL = el("line", { x1: BX, x2: BX + BW, y1: relY, y2: relY, stroke: C.silk, "stroke-width": 1.5, "stroke-dasharray": "6 6" }, aS);
      const relT = label(aO, `relative gate ${absTh.toFixed(1)}`, { x: BX + BW, y: relY - 6, size: 16, color: C.silk, ax: 1, ay: 1 });
      const relT2 = label(aO, "mean − 10 LU", { x: BX + BW, y: relY + 6, size: 14, color: C.dim, ax: 1 });
      const intL = label(aO, `integrated: ${DATA.fb.lufs.toFixed(1)} LUFS`, { x: BX, y: 440, size: 22, color: C.a });
      const scaleT = label(aO, "block loudness", { x: BX, y: 408, size: 16, color: C.mute });
      // ---- loudness2: matched to −18, which is not the same RMS.
      const bU = el("div", { class: "layer" }, under);
      const bO = el("div", { class: "layer" }, over);
      const bS = group(svg);
      const tgtP = pill(bO, "target −18 LUFS · TARGET_LUFS", { x: 960, y: 140, cls: "a", ax: 0.5 });
      const PAT = [
        { k: "jw", name: "bright · Jet Wash", sub: "white noise → flanger", y: 350, L0: DATA.jw.L0 },
        { k: "ib", name: "bass · Iron Bass", sub: "saw → tube drive → ladder", y: 640, L0: DATA.ib.L0 },
      ].map((p) => {
        const env = envOf(DATA[p.k].env);
        const g = group(bS, "a");
        const w = path(g, "", { stroke: C.a, "stroke-width": 1.2 });
        const nm = label(bO, p.name, { x: 100, y: p.y - 160, size: 20, color: C.silk });
        const sb = label(bO, p.sub, { x: 100, y: p.y - 132, size: 16, color: C.mute });
        // A horizontal loudness meter, −40 … 0 LUFS, with the target marked.
        const MX = 1220, MW = 560;
        const mxv = (l) => MX + ((clamp(l, -40, 0) + 40) / 40) * MW;
        const track = place(el("div", {}, bU), { x: MX, y: p.y - 30, w: MW, h: 24 });
        Object.assign(track.style, { background: C.bezel, border: `1px solid ${C.hair}`, borderRadius: "5px" });
        const fill = place(el("div", {}, bU), { x: MX, y: p.y - 30, w: 0, h: 24 });
        Object.assign(fill.style, { background: `linear-gradient(90deg,${ink("--phos-a-deep")},${ink("--phos-a")})`, borderRadius: "5px" });
        const tick = el("line", { x1: mxv(-18), x2: mxv(-18), y1: p.y - 42, y2: p.y + 6, stroke: C.silk, "stroke-width": 2 }, bS);
        const val = label(bO, "", { x: MX, y: p.y + 14, size: 20, color: C.a });
        const rms = label(bO, "", { x: MX, y: p.y + 48, size: 20, color: C.silk });
        return { ...p, env, g, w, nm, sb, track, fill, tick, val, rms, mxv, MX };
      });
      const tgtT = label(bO, "−18", { x: PAT[0].mxv(-18), y: PAT[0].y - 72, size: 16, color: C.silk, ax: 0.5 });
      const bNote = label(bO, "same loudness · not the same RMS: the K curve and the gates are the difference", { x: 100, y: 820, size: 19, color: C.dim });
      // ---- loudness3: a gain, capped by the peak; never a limiter.
      const cU = el("div", { class: "layer" }, under);
      const cO = el("div", { class: "layer" }, over);
      const cS = group(svg);
      const form = label(cO, "", { x: 960, y: 150, size: 34, color: C.silk, ax: 0.5, html: true });
      form.innerHTML = `gain = min( −18 − L , +30 dB , <span style="color:${C.a}">headroom to peak 1.0</span> )`;
      const GX = 100, GW = 1060, GY = 470, GA = 190;
      const fsTop = el("line", { x1: GX, x2: GX + GW, y1: GY - GA, y2: GY - GA, stroke: C.silk, "stroke-width": 1.5, "stroke-dasharray": "7 6" }, cS);
      const fsBot = el("line", { x1: GX, x2: GX + GW, y1: GY + GA, y2: GY + GA, stroke: C.silk, "stroke-width": 1.5, "stroke-dasharray": "7 6" }, cS);
      const fsT = label(cO, "peak 1.0 · full scale", { x: GX + GW, y: GY - GA - 8, size: 16, color: C.silk, ax: 1, ay: 1 });
      const ghostG = group(cS);
      const ghost = path(ghostG, "", { stroke: C.mute, "stroke-width": 1, "stroke-dasharray": "2 3" });
      const gWg = group(cS, "a");
      const gW = path(gWg, "", { stroke: C.a, "stroke-width": 1.1 });
      const gTag = label(cO, "First Bass", { x: GX, y: GY + GA + 20, size: 16, color: C.mute });
      const L = DATA.fb.lufs;
      const wanted = Math.min(-18 - L, 30);
      const head = 20 * Math.log10(1 / DATA.fb.rawPeak);
      const gain = Math.min(wanted, head);
      const NX = 1240;
      const nums = [
        [`L = ${L.toFixed(2)} LUFS`, C.silk],
        [`−18 − L = +${wanted.toFixed(2)} dB`, C.dim],
        [`headroom = +${head.toFixed(2)} dB`, C.a],
        [`gain = +${gain.toFixed(2)} dB → ${(L + gain).toFixed(2)} LUFS`, C.silk],
        [`${(wanted - gain).toFixed(2)} dB short · kept as peak_reduction_db`, C.dim],
      ].map(([s, col], i) => label(cO, s, { x: NX, y: 300 + i * 46, size: 22, color: col }));
      const ghostT = label(cO, `at +${wanted.toFixed(2)} dB the peak would be ${(DATA.fb.rawPeak * Math.pow(10, wanted / 20)).toFixed(2)}`, { x: GX + 560, y: GY + GA + 20, size: 16, color: C.mute });
      const tbl = label(cO, "", { x: NX, y: 560, size: 17, color: C.dim, html: true });
      tbl.innerHTML =
        `<span style="color:${C.mute}">150 vetted draws (audition/loudness.md)</span><br>` +
        `peak p99&nbsp;&nbsp;2.098 → 1.000<br>over full scale&nbsp;&nbsp;22 → 0<br>15 % give up gain · 3.0 dB on average`;
      tbl.style.lineHeight = "1.55";
      const scal = pill(cO, "a scalar, not a limiter: timbre untouched", { x: GX, y: 810, cls: "a" });
      const v1 = voiceLine(over, "Loudness is measured *the broadcast way*, with *K weighting* and *gated blocks*.");
      const v2 = voiceLine(over, "Each patch is matched to *minus eighteen loudness units*, since _louder wins comparisons_.");
      const v3 = voiceLine(over, "The gain *stops short of clipping* instead of limiting, so *timbre is untouched*.");
      const tK = wordTime(l1, "K weighting");
      const tG = wordTime(l1, "gated blocks");
      const tM = wordTime(l2, "minus eighteen");
      const tWin = wordTime(l2, "louder wins");
      const tStop = wordTime(l3, "stops short");
      const tTim = wordTime(l3, "timbre");
      return (tl, t) => {
        const A = 1 - ramp(t, l2.t0 + 0.5, l2.t0 + 0.9);
        const Bu = ramp(t, l2.t0 + 0.6, l2.t0 + 1.0) * (1 - ramp(t, l3.t0 - 0.35, l3.t0 + 0.05));
        const Cu = ramp(t, l3.t0 - 0.25, l3.t0 + 0.15);
        aU.style.opacity = aO.style.opacity = A;
        aS.setAttribute("opacity", A);
        bU.style.opacity = bO.style.opacity = Bu;
        bS.setAttribute("opacity", Bu);
        cU.style.opacity = cO.style.opacity = Cu;
        cS.setAttribute("opacity", Cu);
        if (A > 0) {
          show(kT, ramp(t, wordTime(l1, "broadcast") - 0.1, wordTime(l1, "broadcast") + 0.3));
          kN.style.opacity = kN2.style.opacity = ramp(t, tK, tK + 0.4);
          kDraw(ramp(t, b.t0 + 0.2, tK + 0.3, E.io2));
          kShelfP.setAttribute("opacity", ramp(t, tK - 0.1, tK + 0.3));
          kHpP.setAttribute("opacity", ramp(t, tK + 0.1, tK + 0.5));
          kLeg.style.opacity = ramp(t, tK + 0.1, tK + 0.5);
          const tB = wordTime(l1, "broadcast");
          const wu = ramp(t, tB - 0.3, tB + 0.1);
          wg.setAttribute("opacity", wu);
          wTag.style.opacity = wu;
          spans.forEach((s, j) => s.setAttribute("opacity", ramp(t, tB + j * 0.1, tB + 0.2 + j * 0.1)));
          spanL.style.opacity = ramp(t, tB + 0.2, tB + 0.5);
          scaleT.style.opacity = ramp(t, tB + 0.3, tB + 0.6);
          // Bars rise with the weighting, then the absolute gate, then the relative one.
          const tAbs = tG - 0.1;
          const tRel = tG + 0.45;
          bars.forEach((r, j) => {
            const l = blocks[j];
            const u = ramp(t, tB + 0.3 + j * 0.03, tB + 0.6 + j * 0.03);
            const h = Math.max(0, LY0 - ly(l)) * u;
            r.setAttribute("y", LY0 - h);
            r.setAttribute("height", h);
            const gated = (l <= -70 && t > tAbs) || (l > -70 && l <= absTh && t > tRel);
            r.setAttribute("fill", gated ? C.hair : C.a);
            r.setAttribute("opacity", l <= -70 ? (t > tAbs ? 1 : 0.9) : 1);
          });
          absL.setAttribute("opacity", ramp(t, tAbs - 0.2, tAbs));
          absT.style.opacity = ramp(t, tAbs - 0.2, tAbs);
          relL.setAttribute("opacity", ramp(t, tRel - 0.2, tRel));
          relT.style.opacity = relT2.style.opacity = ramp(t, tRel - 0.2, tRel);
          const su = ramp(t, tB + 1.2, tB + 1.6);
          stubs.forEach((r) => {
            r.setAttribute("opacity", su);
            r.setAttribute("fill", t > tAbs ? C.hair : C.aDim);
          });
          silT.style.opacity = su;
          show(intL, ramp(t, tRel + 0.3, tRel + 0.7));
        }
        if (Bu > 0) {
          show(tgtP, ramp(t, tM - 0.2, tM + 0.3));
          tgtT.style.opacity = ramp(t, tM - 0.2, tM + 0.3);
          const mv = ramp(t, tM + 0.1, tM + 1.4, E.io3);
          PAT.forEach((p, i) => {
            const Lnow = lerp(p.L0, -18, mv);
            const g = Math.pow(10, (Lnow - p.L0) / 20) * Math.pow(10, (p.L0 - -18) / 20);
            // The envelope is stored normalized (at −18); scale it back to Lnow.
            p.w.setAttribute("d", envD(p.env, { x: 100, y: p.y, w: 1040, h: 110, gain: g, lim: 1.3 }));
            const u = ramp(t, l2.t0 + 0.6 + i * 0.2, l2.t0 + 1.0 + i * 0.2);
            p.g.setAttribute("opacity", u);
            p.nm.style.opacity = p.sb.style.opacity = u;
            p.track.style.opacity = u;
            p.fill.style.opacity = u;
            p.fill.style.width = `${p.mxv(Lnow) - p.MX}px`;
            p.tick.setAttribute("opacity", u);
            p.val.textContent = `${Lnow.toFixed(1)} LUFS`;
            p.val.style.opacity = u;
            const r = DATA[p.k].rmsDb + (Lnow + 18);
            p.rms.textContent = `RMS ${r.toFixed(1)} dBFS`;
            p.rms.style.opacity = u * ramp(t, tM + 1.2, tM + 1.6);
          });
          bNote.style.opacity = ramp(t, tWin - 0.2, tWin + 0.3);
        }
        if (Cu > 0) {
          show(form, ramp(t, l3.t0 - 0.1, l3.t0 + 0.4));
          const gu = ramp(t, l3.t0 - 0.1, tStop + 0.6, E.io2);
          const gNow = gu * gain;
          const G = Math.pow(10, (gNow - DATA.fb.gain) / 20);
          gW.setAttribute("d", envD(fb, { x: GX, y: GY, w: GW, h: GA, gain: G, lim: 1.0 }));
          const gh = ramp(t, tStop + 0.4, tStop + 0.9);
          ghost.setAttribute("d", envD(fb, { x: GX, y: GY, w: GW, h: GA, gain: Math.pow(10, (wanted - DATA.fb.gain) / 20), lim: 1.4 }));
          ghostG.setAttribute("opacity", gh * 0.8);
          ghostT.style.opacity = gh;
          const touch = ramp(t, tStop + 0.3, tStop + 0.5) * (1 - ramp(t, tStop + 1.2, tStop + 1.8));
          fsTop.setAttribute("stroke-width", 1.5 + 2 * touch);
          fsBot.setAttribute("stroke-width", 1.5 + 2 * touch);
          fsT.style.opacity = ramp(t, l3.t0, l3.t0 + 0.4);
          gTag.style.opacity = ramp(t, l3.t0, l3.t0 + 0.4);
          nums.forEach((n, i) => show(n, ramp(t, l3.t0 + 0.4 + i * 0.35, l3.t0 + 0.8 + i * 0.35)));
          tbl.style.opacity = ramp(t, tTim - 0.4, tTim);
          show(scal, ramp(t, tTim - 0.1, tTim + 0.4));
        }
        speak(v1, t, l1, l2.t0);
        speak(v2, t, l2, l3.t0);
        speak(v3, t, l3, b.t1 + 0.4);
        void tl;
      };
    },
  });
}

// ============================================================================
// 8 · features — φ_audio (18) and φ_struct (26)
// ============================================================================

function sceneFeatures({ stage, beat, line }) {
  const b = beat("features");
  const [l1, l2, l3, l4, l5, l6] = ["features1", "features2", "features3", "features4", "features5", "features6"].map(line);
  stage.scene({
    id: "features", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      // The eighteen, as horizontal bars: Glass Pad, z-scored over the presets.
      const RY = 172, RS = 34, ZX = 600, ZW = 180;
      const ry = (i) => RY + i * RS;
      const pillA = pill(over, "φ_audio · 18 · AudioFeatures::NAMES", { x: 100, y: 118, cls: "a" });
      const zTag = label(over, "Glass Pad, z-scored over the preset library", { x: 100, y: 800, size: 16, color: C.mute });
      const axisG = group(svg);
      el("line", { x1: ZX, y1: RY - 20, x2: ZX, y2: ry(17) + 20, stroke: C.hair, "stroke-width": 1.5 }, axisG);
      const barG = group(svg, "a");
      const rows = FEATURES.map((n, i) => {
        const lb = label(over, n, { x: ZX - 200, y: ry(i), ay: 0.5, size: 18, color: C.dim, ax: 1 });
        const r = el("rect", { y: ry(i) - 10, height: 20, rx: 3, fill: C.a, x: ZX, width: 0 }, barG);
        return { lb, r, z: DATA.z[i] };
      });
      // Group brackets, to the right of the bars.
      const BRX = ZX + ZW + 30;
      const brk = (i0, i1, text, col = C.dim) => {
        const g = group(svg);
        path(g, `M${BRX} ${ry(i0) - 12} L${BRX + 10} ${ry(i0) - 12} L${BRX + 10} ${ry(i1) + 12} L${BRX} ${ry(i1) + 12}`, { stroke: col, "stroke-width": 1.6 });
        const lb = label(over, text, { x: BRX + 22, y: (ry(i0) + ry(i1)) / 2, ay: 0.5, size: 17, color: col });
        return { g, lb };
      };
      const brTex = brk(3, 4, "texture");
      const brLev = brk(6, 8, "level");
      const brEnv = brk(9, 10, "envelope");
      const brBass = brk(11, 11, "bass · below ~250 Hz");
      const brMot = brk(15, 17, "held-note motion");
      const P0 = 1150; // the right panel
      // features2: the log axis (www/viz log-axis, at film size).
      const f2 = el("div", { class: "layer" }, over);
      const f2S = group(svg);
      const lax = (f) => Math.log2(Math.max(f, 20) / 20) / Math.log2(22050 / 20);
      const AX = P0, AW = 640;
      const rowsLA = [
        { y: 290, name: "linear in Hz · rejected", fn: (f) => f / 22050, col: C.mute },
        { y: 430, name: "octaves above 20 Hz · shipped", fn: lax, col: C.a },
      ].map((r) => {
        el("line", { x1: AX, y1: r.y, x2: AX + AW, y2: r.y, stroke: C.hair, "stroke-width": 2 }, f2S);
        label(f2, r.name, { x: AX, y: r.y - 44, size: 17, color: r.col === C.a ? C.a : C.dim });
        for (const f of r.col === C.a ? [20, 100, 1000, 10000] : [0, 5000, 10000, 15000, 20000]) {
          const x = AX + r.fn(Math.max(f, 1e-9)) * AW;
          el("line", { x1: x, y1: r.y - 6, x2: x, y2: r.y + 6, stroke: C.mute, "stroke-width": 1.5 }, f2S);
          label(f2, f >= 1000 ? `${f / 1000}k` : `${f}`, { x, y: r.y + 12, size: 14, color: C.mute, ax: 0.5 });
        }
        const bands = [[200, 400], [8000, 16000]].map(([lo, hi]) => {
          const x1 = AX + r.fn(lo) * AW;
          const x2 = AX + r.fn(hi) * AW;
          return el("rect", { x: x1, y: r.y - 11, width: Math.max(2, x2 - x1), height: 22, rx: 3, fill: r.col === C.a ? C.a : C.silk, opacity: 0 }, f2S);
        });
        return { ...r, bands };
      });
      const oct = label(f2, "one octave: 200 → 400 Hz, and 8 → 16 kHz", { x: AX, y: 500, size: 17, color: C.silk });
      const formula = label(f2, "log_axis(f) = log₂(max(f, 20) / 20) / log₂(f_Nyq / 20)", { x: AX, y: 560, size: 20, color: C.silk });
      const f2n = label(f2, "centroid, its spread, 85 % rolloff, zero crossings: all on this axis", { x: AX, y: 604, size: 16, color: C.dim });
      // features3: what the seven and the one are, as formulas.
      const f3 = el("div", { class: "layer" }, over);
      const F3 = [
        [3, "flatness = geometric / arithmetic mean of |X|²"],
        [4, "flux = ‖ |Xₙ| − |Xₙ₋₁| ‖ / (Σ|Xₙ| + Σ|Xₙ₋₁|)"],
        [6, "level = mean frame RMS · swing = its spread"],
        [8, "crest = ln(peak / RMS)"],
        [9, "attack = ln(t to 90 % of peak + 5 ms)"],
        [10, "tail = ln(RMS of the last 300 ms / RMS + 10⁻³)"],
        [11, "bass = energy below ~250 Hz / all energy"],
      ].map(([i, s]) => ({ i, d: label(f3, s, { x: P0, y: ry(i), ay: 0.5, size: 18, color: C.silk }) }));
      // features4: a small copy of the phrase, and which note each reads.
      const f4 = el("div", { class: "layer" }, over);
      const f4S = group(svg);
      const QX = P0 + 40, QW = 600;
      const qx = (s) => QX + (s / PHRASE_S) * QW;
      const qy = (lane) => 522 + lane * 36;
      const f4n = group(f4S, "a");
      const qNotes = PHRASE.map((n) => el("rect", { x: qx(n.t0), y: qy(n.lane) - 11, width: qx(n.t1) - qx(n.t0), height: 22, rx: 3, fill: C.a, opacity: 0.35 }, f4n));
      const leadG = group(f4S);
      const LEADS = [
        { i: 12, x: qx(0) - 6, y: qy(2), name: "held C4", lx: qx(0.9), ly: qy(2) + 16, la: 0.5 },
        { i: 13, x: qx(2.15), y: qy(0) + 12, name: "C5 stab", lx: qx(2.3) + 12, ly: qy(0) - 10, la: 0 },
        { i: 14, x: qx(2.7), y: qy(2) + 12, name: "dyad", lx: qx(2.95) + 12, ly: qy(1) + 4, la: 0 },
      ].map((L) => {
        const x0 = ZX + ZW + 16;
        const y0 = ry(L.i);
        const p = path(leadG, `M${x0} ${y0} C${x0 + 180} ${y0} ${L.x - 160} ${L.y + (L.i === 12 ? 0 : 60)} ${L.x} ${L.y}`, { stroke: C.silk, "stroke-width": 1.5, "stroke-dasharray": "5 5" });
        const nl = label(f4, L.name, { x: L.lx, y: L.ly, size: 14, color: C.silk, ax: L.la });
        return { ...L, p, nl };
      });
      // features5: the held note's modulation spectrum, from the real render.
      const f5 = el("div", { class: "layer" }, over);
      const f5S = group(svg);
      const MX = P0, MW = 640, MY = 626, MH = 250;
      const mx = (f) => logX(f, MX, MW, 0.3, 40);
      const spec = DATA.motion.spec;
      const vmax = Math.max(...spec.map((s) => Math.max(s[1], s[2])));
      const my = (v) => MY - (v / vmax) * (MH - 40);
      const BANDS = [[0.5, 2, "sweeps"], [2, 8, "pulsing"], [8, 30, "flutter"]];
      const bandR = BANDS.map(([lo, hi, nm], k) => {
        const r = el("rect", { x: mx(lo), y: MY - MH + 20, width: mx(hi) - mx(lo), height: MH - 20, fill: C.a, opacity: 0 }, f5S);
        const lb = label(f5, `${nm} · ${lo}–${hi} Hz`, { x: (mx(lo) + mx(hi)) / 2, y: MY - MH - 6, size: 15, color: C.silk, ax: 0.5 });
        const cx = (mx(lo) + mx(hi)) / 2;
        const val = label(f5, `${DATA.motion.bands[k].toFixed(2)}`, { x: cx, y: MY + 12, size: 17, color: C.a, ax: 0.5 });
        const ld = path(f5S, `M${cx} ${MY + 40} C${cx} ${MY + 70} ${ZX + ZW + 120} ${ry(15 + k)} ${ZX + ZW + 16} ${ry(15 + k)}`, { stroke: C.a, "stroke-width": 1.5, "stroke-dasharray": "5 5" });
        return { r, lb, val, ld };
      });
      el("line", { x1: MX, y1: MY, x2: MX + MW, y2: MY, stroke: C.hair, "stroke-width": 1.5 }, f5S);
      for (const f of [0.5, 2, 8, 30]) el("line", { x1: mx(f), y1: MY - MH + 20, x2: mx(f), y2: MY + 6, stroke: C.mute, "stroke-width": 1 }, f5S);
      const sClipR = el("rect", { x: MX - 4, y: MY - MH - 10, width: 0, height: MH + 20 }, el("clipPath", { id: "specclip" }, el("defs", {}, f5S)));
      const specC = el("g", { "clip-path": "url(#specclip)" }, f5S);
      const specG = group(specC, "a");
      path(specG, P(spec.map((s) => [mx(s[0]), my(s[1])])), { stroke: C.a, "stroke-width": 2.6 });
      path(specC, P(spec.map((s) => [mx(s[0]), my(s[2])])), { stroke: C.silk, "stroke-width": 2, "stroke-dasharray": "7 6" });
      const legend = label(f5, "── brightness (log₂ centroid) · - - level (log₂ RMS)", { x: MX, y: MY - MH - 48, size: 15, color: C.dim });
      const mForm = label(f5, "motion_B = ½ log₂(v_B(brightness) + v_B(level) + 10⁻⁴)", { x: MX, y: 820, size: 18, color: C.silk });
      const mTag = label(f5, `held C4, from ${DATA.motion.arrived.toFixed(2)} s (arrived) to 1.80 s · MOTION_BANDS`, { x: MX, y: MY - MH - 76, size: 15, color: C.mute });
      // features6: the 26 structural numbers, no render needed.
      const f6 = el("div", { class: "layer" }, over);
      const f6U = el("div", { class: "layer" }, under);
      const SN = ["vco", "supersaw", "noise", "wavetable", "pluck", "formant", "silence", "filter", "drive", "time", "mod fx", "reverb", "dynamics", "lfo", "env", "rand", "follow", "mod shape", "mod logic", "mod density", "mod depth", "amp attack", "amp sustain", "amp release", "chain balance", "sidechained"];
      const cells = SN.map((n, i) => {
        const col = i % 5;
        const row = Math.floor(i / 5);
        const x = P0 + col * 128;
        const y = 180 + row * 86;
        const d = place(el("div", {}, f6U), { x, y, w: 118, h: 76 });
        const v = DATA.gpStruct[i];
        const fam = i < 19;
        Object.assign(d.style, { borderRadius: "8px", border: `1px solid ${fam ? C.aDeep : C.hair}`, background: v > 0 ? (fam ? inkA("--phos-a", 0.16) : inkA("--silk", 0.1)) : ink("--recess-hi") });
        const nm = label(f6, n, { x: x + 59, y: y + 12, size: 14, color: C.dim, ax: 0.5 });
        const vl = label(f6, Number.isInteger(v) ? `${v}` : v.toFixed(2), { x: x + 59, y: y + 38, size: 21, color: v > 0 ? (fam ? C.a : C.silk) : C.mute, ax: 0.5 });
        return { d, nm, vl, i };
      });
      const f6a = label(f6, "19 family counts", { x: P0, y: 138, size: 17, color: C.a });
      const f6b = label(f6, "+ 7 term-level numbers · no compile, no render", { x: P0 + 190, y: 138, size: 17, color: C.silk });
      const sPill = pill(f6, "φ_struct · 26", { x: P0, y: 760 });
      const phi = label(f6, "", { x: P0 + 300, y: 756, size: 44, color: C.b, ay: 0.5, html: true });
      phi.innerHTML = "φ ∈ ℝ<sup>44</sup>";
      phi.style.textShadow = `0 0 22px ${inkA("--phos-b", 0.45)}`;

      const v1 = voiceLine(over, "From that render come *eighteen audio features*.");
      const v2 = voiceLine(over, "Four measure the spectrum's *brightness* and its *movement*, on a *logarithmic frequency axis*.");
      const v3 = voiceLine(over, "*Texture*, *level* and *envelope* take seven more, and one measures the *bass*.");
      const v4 = voiceLine(over, "Three are read from *single notes*. Three more are *bands of motion* on the held note.");
      const v5 = voiceLine(over, "The bands run from *half a hertz to two*, and from *two to eight*. The fastest runs from *eight to thirty*.");
      const v6 = voiceLine(over, "*Twenty-six structural features* come from the patch, with no render.");
      const tTex = wordTime(l3, "Texture");
      const tLev = wordTime(l3, "level");
      const tEnv = wordTime(l3, "envelope");
      const tBass = wordTime(l3, "bass");
      const tSingle = wordTime(l4, "single notes");
      const tBands = wordTime(l4, "bands of motion");
      const tB5 = [wordTime(l5, "half a hertz"), wordTime(l5, "two to eight"), wordTime(l5, "eight to thirty")];
      const tStruct = wordTime(l6, "structural");
      const tNoR = wordTime(l6, "no render");
      const groupsLit = (t) => {
        // Which bars are lit, line by line; -1 means all.
        if (t < l2.t0 - 0.1) return null;
        if (t < l3.t0 - 0.1) return new Set([0, 1, 2, 5]);
        if (t < l4.t0 - 0.1) {
          const s = new Set();
          if (t > tTex - 0.1) [3, 4].forEach((i) => s.add(i));
          if (t > tLev - 0.1) [6, 7, 8].forEach((i) => s.add(i));
          if (t > tEnv - 0.1) [9, 10].forEach((i) => s.add(i));
          if (t > tBass - 0.1) s.add(11);
          return s;
        }
        if (t < l5.t0 - 0.1) {
          const s = new Set([12, 13, 14]);
          if (t > tBands - 0.1) [15, 16, 17].forEach((i) => s.add(i));
          return s;
        }
        if (t < l6.t0 - 0.1) return new Set([15, 16, 17]);
        return new Set();
      };
      return (tl, t) => {
        show(pillA, ramp(t, wordTime(l1, "eighteen") - 0.1, wordTime(l1, "eighteen") + 0.3));
        zTag.style.opacity = ramp(t, l1.t1 - 0.2, l1.t1 + 0.3) * (1 - ramp(t, l6.t0 - 0.3, l6.t0));
        axisG.setAttribute("opacity", ramp(t, b.t0, b.t0 + 0.4));
        const lit = groupsLit(t);
        const dimAll = ramp(t, l6.t0 - 0.2, l6.t0 + 0.3);
        rows.forEach((r, i) => {
          const u = E.out3(ramp(t, b.t0 + 0.1 + i * 0.06, b.t0 + 0.6 + i * 0.06, E.lin));
          const w = (clamp(Math.abs(r.z), 0, 2.2) / 2.2) * ZW * u;
          r.r.setAttribute("x", r.z >= 0 ? ZX : ZX - w);
          r.r.setAttribute("width", Math.max(0, w));
          const on = lit == null || lit.has(i);
          const o = (on ? 1 : 0.22) * lerp(1, 0.3, dimAll);
          r.r.setAttribute("opacity", o.toFixed(3));
          r.lb.style.opacity = (ramp(t, b.t0 + 0.1 + i * 0.06, b.t0 + 0.5 + i * 0.06) * (on ? 1 : 0.4) * lerp(1, 0.35, dimAll)).toFixed(3);
          r.lb.style.color = on && lit != null ? C.silk : C.dim;
        });
        // features2.
        const u2 = fade(t, l2.t0 - 0.2, l2.t0 + 0.3, l3.t0 - 0.3, l3.t0);
        f2.style.opacity = u2;
        f2S.setAttribute("opacity", u2);
        rowsLA.forEach((r, i) => r.bands.forEach((bd, j) => bd.setAttribute("opacity", 0.55 * ramp(t, wordTime(l2, "logarithmic") - 0.2 + j * 0.25 + i * 0.1, wordTime(l2, "logarithmic") + 0.2 + j * 0.25 + i * 0.1))));
        oct.style.opacity = ramp(t, wordTime(l2, "logarithmic") + 0.3, wordTime(l2, "logarithmic") + 0.7);
        formula.style.opacity = ramp(t, wordTime(l2, "frequency axis"), wordTime(l2, "frequency axis") + 0.4);
        f2n.style.opacity = ramp(t, l2.t0 + 0.2, l2.t0 + 0.6);
        // features3.
        const u3 = fade(t, l3.t0 - 0.2, l3.t0 + 0.2, l4.t0 - 0.3, l4.t0);
        f3.style.opacity = u3;
        const at3 = { 3: tTex, 4: tTex + 0.15, 6: tLev, 8: tLev + 0.15, 9: tEnv, 10: tEnv + 0.15, 11: tBass };
        F3.forEach((f) => show(f.d, ramp(t, at3[f.i] - 0.1, at3[f.i] + 0.3)));
        const bracketsOn = 1 - dimAll;
        [[brTex, tTex], [brLev, tLev], [brEnv, tEnv], [brBass, tBass], [brMot, tBands]].forEach(([br, tt]) => {
          const u = ramp(t, tt - 0.1, tt + 0.3) * bracketsOn * (br === brMot ? 1 - ramp(t, l5.t0 - 0.2, l5.t0 + 0.2) : 1);
          br.g.setAttribute("opacity", u);
          br.lb.style.opacity = u;
        });
        // features4.
        const u4 = fade(t, l4.t0 - 0.2, l4.t0 + 0.2, l5.t0 - 0.3, l5.t0);
        f4.style.opacity = u4;
        f4S.setAttribute("opacity", u4);
        LEADS.forEach((L, k) => {
          const u = ramp(t, tSingle + k * 0.2, tSingle + 0.4 + k * 0.2);
          L.p.setAttribute("opacity", u);
          L.nl.style.opacity = u;
          qNotes[[0, 1, 3][k]].setAttribute("opacity", 0.35 + 0.65 * u);
          if (k === 2) qNotes[2].setAttribute("opacity", 0.35 + 0.65 * u);
        });
        // features5.
        const u5 = fade(t, l5.t0 - 0.2, l5.t0 + 0.2, l6.t0 - 0.3, l6.t0);
        f5.style.opacity = u5;
        f5S.setAttribute("opacity", u5);
        sClipR.setAttribute("width", (MW + 8) * ramp(t, l5.t0, l5.t0 + 1.3, E.io2));
        bandR.forEach((br, k) => {
          const u = ramp(t, tB5[k] - 0.1, tB5[k] + 0.3);
          br.r.setAttribute("opacity", 0.1 * u);
          br.lb.style.opacity = u;
          br.val.style.opacity = u;
          br.ld.setAttribute("opacity", ramp(t, tB5[k] + 0.2, tB5[k] + 0.6));
        });
        legend.style.opacity = ramp(t, l5.t0 + 0.4, l5.t0 + 0.8);
        mForm.style.opacity = ramp(t, tB5[2] + 0.3, tB5[2] + 0.7);
        mTag.style.opacity = ramp(t, l5.t0, l5.t0 + 0.4);
        // features6.
        const u6 = ramp(t, l6.t0 - 0.2, l6.t0 + 0.2);
        f6.style.opacity = f6U.style.opacity = u6;
        cells.forEach((c) => {
          const u = ramp(t, tStruct - 0.2 + c.i * 0.025, tStruct + 0.2 + c.i * 0.025);
          c.d.style.opacity = u;
          c.nm.style.opacity = c.vl.style.opacity = u;
        });
        f6a.style.opacity = ramp(t, tStruct, tStruct + 0.4);
        f6b.style.opacity = ramp(t, tNoR - 0.2, tNoR + 0.2);
        show(sPill, ramp(t, tNoR, tNoR + 0.4));
        show(phi, ramp(t, tNoR + 0.3, tNoR + 0.7));
        speak(v1, t, l1, l2.t0);
        speak(v2, t, l2, l3.t0);
        speak(v3, t, l3, l4.t0);
        speak(v4, t, l4, l5.t0);
        speak(v5, t, l5, l6.t0);
        speak(v6, t, l6, b.t1 + 0.4);
        void tl;
      };
    },
  });
}

// ============================================================================
// 9 · live — LivePoly in the AudioWorklet
// ============================================================================

function sceneLive({ stage, beat, line }) {
  const b = beat("live");
  const [l1, l2, l3, l4] = ["live1", "live2", "live3", "live4"].map(line);
  stage.scene({
    id: "live", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const comp = box(under, { x: 100, y: 300, w: 240, h: 100, title: "compile()", sub: "auracle_grammar", color: "s" });
      const wk = place(el("div", {}, under), { x: 420, y: 150, w: 1000, h: 470 });
      Object.assign(wk.style, { border: `1.5px solid ${C.hair}`, borderRadius: "16px", background: inkA("--panel", 0.4) });
      const wkT = label(over, "AudioWorklet · the render thread", { x: 444, y: 166, size: 19, color: C.silk });
      const LX = 470, LW = 520;
      const laneSet = (y0, color, seedBase) => [0, 1, 2, 3].map((i) => {
        const y = y0 + i * 42;
        const bg = place(el("div", { class: "screen" }, under), { x: LX, y, w: LW, h: 34 });
        const g = group(svg, color);
        const p = path(g, "", { stroke: color === "b" ? C.b : C.a, "stroke-width": 2 });
        const fn = voiceWave({ f: [5, 6.3, 7.5, 10][i], bright: color === "b" ? 0.75 : 0.45, seed: seedBase + i });
        return { bg, g, p, fn, y };
      });
      const A = laneSet(226, "a", 21);
      const Bl = laneSet(430, "b", 31);
      const aT = label(over, "slot A · 4 voices · LivePoly", { x: LX, y: 206, size: 17, color: C.a, ay: 0.5 });
      const bT = label(over, "slot B · PERFORM's offers · 4 more", { x: LX, y: 410, size: 17, color: C.b, ay: 0.5 });
      const inArr = arrow(svg, [340, 350], [462, 350]);
      // The crossfade: equal power, smoothed per sample.
      const QX = 1030, QY = 250, QW = 360, QH = 220;
      const qp = panel(under, { x: QX, y: QY, w: QW, h: QH });
      const qx = (m) => QX + 24 + m * (QW - 48);
      const qy = (v) => QY + QH - 30 - v * (QH - 70);
      const qS = group(svg);
      el("line", { x1: QX + 20, y1: qy(0), x2: QX + QW - 20, y2: qy(0), stroke: C.hair, "stroke-width": 1 }, qS);
      path(qS, fnD(80, (m) => [qx(m), qy(1)]), { stroke: C.mute, "stroke-width": 1.5, "stroke-dasharray": "5 5" });
      const cg = group(qS, "a");
      path(cg, fnD(80, (m) => [qx(m), qy(Math.cos((Math.PI * m) / 2))]), { stroke: C.a, "stroke-width": 2.6 });
      const sg = group(qS, "b");
      path(sg, fnD(80, (m) => [qx(m), qy(Math.sin((Math.PI * m) / 2))]), { stroke: C.b, "stroke-width": 2.6 });
      const dotA = el("circle", { r: 7, fill: C.a }, qS);
      const dotB = el("circle", { r: 7, fill: C.b }, qS);
      const qT1 = label(over, "", { x: QX, y: QY - 40, size: 18, color: C.silk, html: true });
      qT1.innerHTML = `y = <span style="color:${C.a}">cos(πm/2)·A</span> + <span style="color:${C.b}">sin(πm/2)·B</span>`;
      const qT2 = label(over, "power: cos² + sin² = 1", { x: qx(0.5), y: qy(1) - 8, size: 14, color: C.mute, ax: 0.5, ay: 1 });
      const qT3 = label(over, "m ← m + 0.002 (m* − m) · ≈ 10 ms at 48 kHz", { x: QX - 10, y: QY + QH + 16, size: 16, color: C.dim });
      // Out: the master limiter.
      const outB = box(under, { x: 1500, y: 320, w: 300, h: 110, title: "master limiter", sub: "across the voice sum\nceiling 0.98", color: "s" });
      const outArr = arrow(svg, [1420, 375], [1496, 375]);
      // live3: quanta, one buffer.
      const q3 = el("div", { class: "layer" }, over);
      const q3U = el("div", { class: "layer" }, under);
      const q3S = group(svg);
      const QN = 10;
      const quanta = Array.from({ length: QN }, (_, i) => {
        const x = 100 + i * 120;
        const d = place(el("div", {}, q3U), { x, y: 700, w: 108, h: 54 });
        Object.assign(d.style, { borderRadius: "6px", border: `1px solid ${C.aDeep}`, background: inkA("--phos-a", 0.06) });
        const t = label(q3, "128", { x: x + 54, y: 727, size: 16, color: C.dim, ax: 0.5, ay: 0.5 });
        return { d, t, x };
      });
      const buf = place(el("div", {}, q3U), { x: 1400, y: 690, w: 400, h: 74 });
      Object.assign(buf.style, { borderRadius: "8px", border: `1.5px solid ${C.a}`, background: inkA("--phos-a", 0.08), boxShadow: `0 0 24px ${inkA("--phos-a", 0.15)}` });
      label(q3, "out_buf · one persistent buffer", { x: 1600, y: 716, size: 17, color: C.a, ax: 0.5, ay: 0.5 });
      label(q3, "process_ptr() → a pointer into wasm memory", { x: 1600, y: 744, size: 14, color: C.dim, ax: 0.5, ay: 0.5 });
      label(q3, "render quanta, 128 frames each", { x: 100, y: 664, size: 17, color: C.dim });
      const q3P = pill(q3, "no allocation per quantum · in steady state", { x: 100, y: 810, cls: "a" });
      const writeP = path(q3S, "", { stroke: C.a, "stroke-width": 2, "stroke-dasharray": "4 5" });
      // live4: a patch swap on a frame clock.
      const s4 = el("div", { class: "layer" }, over);
      const s4U = el("div", { class: "layer" }, under);
      const s4S = group(svg);
      const TX0 = 100, TW = 1260;
      const FR = 1024; // 2 quanta out, 4 rebuilds, 2 quanta in
      const fx = (f) => TX0 + (f / FR) * TW;
      const gy = (g) => 820 - g * 130;
      const cellsQ = ["fade", "fade", "voice 1", "voice 2", "voice 3", "voice 4", "fade", "fade"].map((n, i) => {
        const d = place(el("div", {}, s4U), { x: fx(i * 128) + 2, y: 836, w: TW / 8 - 4, h: 36 });
        Object.assign(d.style, { borderRadius: "5px", border: `1px solid ${i >= 2 && i < 6 ? C.aDeep : C.hair}`, background: i >= 2 && i < 6 ? inkA("--phos-a", 0.07) : "transparent" });
        const t = label(s4, n, { x: fx(i * 128 + 64), y: 854, size: 15, color: i >= 2 && i < 6 ? C.a : C.dim, ax: 0.5, ay: 0.5 });
        return { d, t };
      });
      const gain = (f) => (f < 256 ? 1 - f / 256 : f < 768 ? 0 : (f - 768) / 256);
      const gG = group(s4S, "a");
      const gP = path(gG, fnD(256, (q) => [fx(q * FR), gy(gain(q * FR))]), { stroke: C.a, "stroke-width": 3 });
      const gDraw = drawable(gP);
      const gT = label(s4, "output gain · 1/256 per frame ≈ 6 ms", { x: TX0, y: 660, size: 16, color: C.dim });
      const silT = label(s4, "rebuilt in silence · one voice per quantum", { x: fx(512), y: gy(0) - 20, size: 16, color: C.a, ax: 0.5, ay: 1 });
      // The held chord: keys lit across the whole swap; envelope phase carried.
      const KX = 1430;
      const kb = keyboard(s4S, { x: KX, y: 690, w: 370, h: 104, low: 60, octaves: 1 });
      // Their amp envelope over the same frames: carried (green) against the
      // fresh attack a re-press would otherwise start after the rebuild (grey).
      const ex = (f) => KX + (f / FR) * 370;
      const ey = (v) => 876 - v * 44;
      const envS = group(s4S);
      el("line", { x1: KX, y1: ey(0), x2: KX + 370, y2: ey(0), stroke: C.hair, "stroke-width": 1 }, envS);
      const reAtt = path(envS, fnD(80, (q) => { const f = 768 + q * 256; return [ex(f), ey(0.6 * (1 - Math.exp(-q * 5)) / (1 - Math.exp(-5)))]; }), { stroke: C.mute, "stroke-width": 2, "stroke-dasharray": "5 5" });
      const carG = group(envS, "a");
      path(carG, `M${ex(0)} ${ey(0.6)} L${ex(FR)} ${ey(0.6)}`, { stroke: C.a, "stroke-width": 2.6 });
      const carT = label(s4, "envelope phase carried", { x: KX, y: 812, size: 13, color: C.a });
      const reT = label(s4, "a re-press would re-attack", { x: KX + 370, y: 882, size: 13, color: C.mute, ax: 1 });
      const heldT = label(s4, "held C · E · G", { x: KX, y: 660, size: 16, color: C.dim });
      const carryT = label(s4, "no new attack", { x: KX + 200, y: 812, size: 13, color: C.silk });
      const v1 = voiceLine(over, "Live, the same compiler builds *four voices* inside an *AudioWorklet*.");
      const v2 = voiceLine(over, "Four more play _PERFORM's offers_, crossfaded at *equal power*.");
      const v3 = voiceLine(over, "In steady state, the audio thread *allocates nothing*.");
      const v4 = voiceLine(over, "A patch change fades out, *rebuilds the voices in silence*, and carries your *held notes* across.");
      const tFour = wordTime(l1, "four voices");
      const tAW = wordTime(l1, "AudioWorklet");
      const tOff = wordTime(l2, "PERFORM");
      const tEq = wordTime(l2, "equal power");
      const tAl = wordTime(l3, "allocates");
      const tFade = wordTime(l4, "fades out");
      const tReb = wordTime(l4, "rebuilds");
      const tHeld = wordTime(l4, "held notes");
      return (tl, t) => {
        show(comp, ramp(t, b.t0, b.t0 + 0.4, E.out3));
        inArr.update(ramp(t, b.t0 + 0.3, b.t0 + 0.8));
        show(wk, ramp(t, b.t0 + 0.3, b.t0 + 0.8, E.out3));
        wkT.style.opacity = lerp(0.35, 1, ramp(t, tAW - 0.3, tAW + 0.2)) * ramp(t, b.t0 + 0.5, b.t0 + 0.9);
        wk.style.borderColor = fade(t, tAW - 0.2, tAW + 0.2, tAW + 1.2, tAW + 1.8) > 0.02 ? inkA("--phos-a", (0.55 * fade(t, tAW - 0.2, tAW + 0.2, tAW + 1.2, tAW + 1.8)).toFixed(3)) : C.hair;
        aT.style.opacity = ramp(t, tFour - 0.2, tFour + 0.2);
        bT.style.opacity = ramp(t, tOff - 0.2, tOff + 0.2);
        // The blend: A alone, then across to B, then back (a Peek).
        const m = keys(t, [[tEq - 0.1, 0], [tEq + 0.9, 1, E.io3], [tEq + 2.4, 1], [tEq + 3.3, 0, E.io3]]);
        const ga = Math.cos((Math.PI * m) / 2);
        const gb = Math.sin((Math.PI * m) / 2);
        const frameU = ramp(t, b.t0 + 0.4, b.t0 + 0.9);
        A.forEach((ln, i) => {
          const u = ramp(t, tFour - 0.1 + i * 0.12, tFour + 0.25 + i * 0.12);
          ln.bg.style.opacity = Math.max(0.45 * frameU, u);
          ln.g.setAttribute("opacity", u * (0.3 + 0.7 * ga));
          ln.p.setAttribute("d", fnD(110, (q) => [LX + 8 + q * (LW - 16), ln.y + 17 - 12 * ln.fn(q, t)]));
        });
        Bl.forEach((ln, i) => {
          const u = ramp(t, tOff - 0.1 + i * 0.12, tOff + 0.25 + i * 0.12);
          ln.bg.style.opacity = Math.max(0.45 * frameU, u);
          ln.g.setAttribute("opacity", u * (0.3 + 0.7 * gb));
          ln.p.setAttribute("d", fnD(110, (q) => [LX + 8 + q * (LW - 16), ln.y + 17 - 12 * ln.fn(q, t)]));
        });
        const qu = ramp(t, tEq - 0.5, tEq);
        qp.style.opacity = qu;
        qS.setAttribute("opacity", qu);
        qT1.style.opacity = qT2.style.opacity = qu;
        qT3.style.opacity = ramp(t, tEq + 0.3, tEq + 0.7);
        dotA.setAttribute("cx", qx(m));
        dotA.setAttribute("cy", qy(ga));
        dotB.setAttribute("cx", qx(m));
        dotB.setAttribute("cy", qy(gb));
        show(outB, ramp(t, b.t0 + 0.6, b.t0 + 1.0, E.out3));
        outArr.update(ramp(t, b.t0 + 0.8, b.t0 + 1.2));
        // live3.
        const u3 = fade(t, l3.t0 - 0.2, l3.t0 + 0.2, l4.t0 - 0.3, l4.t0);
        q3.style.opacity = q3U.style.opacity = u3;
        q3S.setAttribute("opacity", u3);
        const cur = Math.floor(clamp((t - l3.t0) / 0.28, 0, 1e9)) % QN;
        quanta.forEach((q, i) => {
          const on = i === cur;
          q.d.style.borderColor = on ? C.a : C.aDeep;
          q.d.style.boxShadow = on ? `0 0 18px ${inkA("--phos-a", 0.3)}` : "none";
          q.t.style.color = on ? C.a : C.dim;
        });
        writeP.setAttribute("d", `M${quanta[cur].x + 54} 700 C${quanta[cur].x + 54} 640 1600 640 1600 688`);
        show(q3P, ramp(t, tAl - 0.1, tAl + 0.3));
        // live4.
        const u4 = ramp(t, l4.t0 - 0.2, l4.t0 + 0.2);
        s4.style.opacity = s4U.style.opacity = u4;
        s4S.setAttribute("opacity", u4);
        gDraw(ramp(t, tFade - 0.2, tHeld + 0.3, E.lin));
        cellsQ.forEach((c, i) => {
          const at = tFade - 0.2 + (i / 8) * (tHeld + 0.5 - tFade);
          const u = ramp(t, at, at + 0.2);
          c.d.style.opacity = u;
          c.t.style.opacity = u;
        });
        gT.style.opacity = ramp(t, tFade - 0.2, tFade + 0.2);
        silT.style.opacity = ramp(t, tReb, tReb + 0.4);
        kb.update(ramp(t, l4.t0, l4.t0 + 0.3) > 0.5 ? new Set([60, 64, 67]) : new Set());
        heldT.style.opacity = u4;
        show(carryT, ramp(t, tHeld + 0.2, tHeld + 0.6));
        const eu = ramp(t, tHeld - 0.2, tHeld + 0.2);
        envS.setAttribute("opacity", eu);
        carT.style.opacity = eu;
        reT.style.opacity = ramp(t, tHeld + 0.3, tHeld + 0.7);
        reAtt.setAttribute("opacity", ramp(t, tHeld + 0.3, tHeld + 0.7));
        speak(v1, t, l1, l2.t0);
        speak(v2, t, l2, l3.t0);
        speak(v3, t, l3, l4.t0);
        speak(v4, t, l4, b.t1 + 0.4);
        void tl;
      };
    },
  });
}

// ============================================================================
// 10 · farm — the render farm, and why width is invisible
// ============================================================================

function sceneFarm({ stage, beat, line }) {
  const b = beat("farm");
  const [l1, l2] = ["farm1", "farm2"].map(line);
  stage.scene({
    id: "farm", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const main = box(under, { x: 810, y: 130, w: 300, h: 92, title: "main thread", sub: "spawns, hands out ports", color: "s" });
      const eng = box(under, { x: 800, y: 330, w: 320, h: 104, title: "engine worker", sub: "draws, absorbs, the pool" });
      const W = [[300, 260], [230, 400], [300, 540], [1320, 260], [1390, 400], [1320, 540]];
      const workers = W.map(([x, y], i) => ({ d: box(under, { x, y, w: 210, h: 84, title: `render ${i + 1}`, sub: "farm_render()", size: 19 }), x, y }));
      const spawn = arrow(svg, [960, 222], [960, 326], "a", { width: 2 });
      const portG = group(svg);
      const ports = workers.map((w) => {
        const wx = w.x < 960 ? w.x + 210 : w.x;
        const ex = w.x < 960 ? 800 : 1120;
        return path(portG, `M${wx} ${w.y + 42} C${(wx + ex) / 2} ${w.y + 42} ${(wx + ex) / 2} 382 ${ex} 382`, { stroke: C.aDim, "stroke-width": 2, "stroke-dasharray": "6 6" });
      });
      const portT = label(over, "one MessagePort each", { x: 960, y: 470, size: 16, color: C.dim, ax: 0.5 });
      const nForm = label(over, "N = clamp(cores − 2, 0, 6) · at most 2 when deviceMemory ≤ 4", { x: 960, y: 92, size: 18, color: C.silk, ax: 0.5 });
      // farm2: indexed draws, absorbed in order.
      const seedT = label(over, "", { x: 960, y: 520, size: 24, color: C.silk, ax: 0.5, html: true });
      seedT.innerHTML = `draw i = <span style="color:${C.a}">splitmix64(fill_seed, i)</span>`;
      const NP = 12;
      const PX = 240, PC = 116;
      const poolY = 640;
      const arrive = [2, 0, 3, 1, 5, 4, 7, 6, 9, 11, 8, 10];
      const R = [0.82, 0.35, 0.6, 0.95, 0.5, 0.2, 0.7, 0.4, 0.88, 0.3, 0.65, 0.55];
      const cellD = (i, x, y) => fnD(40, (q) => [x + 10 + q * (PC - 32), y + 22 - 12 * Math.sin(2 * Math.PI * (1 + i * 0.37) * q + i) * Math.exp(-R[i] * 2.4 * q)]);
      const mkPool = (y, lbl) => {
        const lb = label(over, lbl, { x: PX - 20, y: y + 22, size: 17, color: C.dim, ax: 1, ay: 0.5 });
        const cells = Array.from({ length: NP }, (_, i) => {
          const x = PX + i * PC;
          const d = place(el("div", {}, under), { x, y, w: PC - 12, h: 44 });
          Object.assign(d.style, { borderRadius: "6px", border: `1px solid ${C.hair}`, background: ink("--recess-hi") });
          const g = group(svg, "a");
          const p = path(g, cellD(i, x, y), { stroke: C.a, "stroke-width": 1.8 });
          const n = label(over, `${i}`, { x: x + PC - 18, y: y + 4, size: 13, color: C.mute, ax: 1 });
          return { d, g, p, n };
        });
        return { lb, cells, y };
      };
      const pools = [mkPool(poolY, "width 6"), mkPool(poolY + 70, "width 2"), mkPool(poolY + 140, "width 0")];
      const doneT = label(over, "", { x: 960, y: 590, size: 16, color: C.dim, ax: 0.5 });
      const same = pill(over, "one fill_seed · one pool, at any width", { x: 960, y: 598, cls: "a", ax: 0.5 });
      const tests = label(over, "farm_width_does_not_change_the_pool · farm_absorption_reproduces_the_serial_pool", { x: 960, y: 870, size: 15, color: C.mute, ax: 0.5 });
      const v1 = voiceLine(over, "Auditions render *in parallel*, on up to *six workers*.");
      const v2 = voiceLine(over, "Draws are *indexed* and *absorbed in order*, so the pool is *identical at any width*.");
      const tPar = wordTime(l1, "parallel");
      const tSix = wordTime(l1, "six workers");
      const tIdx = wordTime(l2, "indexed");
      const tAbs = wordTime(l2, "absorbed");
      const tId = wordTime(l2, "identical");
      return (tl, t) => {
        const up = 1 - ramp(t, l2.t0 - 0.3, l2.t0 + 0.2) * 0.45;
        show(main, ramp(t, b.t0, b.t0 + 0.4, E.out3));
        show(eng, ramp(t, b.t0 + 0.3, b.t0 + 0.7, E.out3));
        spawn.update(ramp(t, b.t0 + 0.4, b.t0 + 0.8));
        workers.forEach((w, i) => {
          const u = ramp(t, tPar - 0.2 + i * 0.12, tPar + 0.2 + i * 0.12, E.out3);
          show(w.d, u);
          w.d.style.filter = `brightness(${up.toFixed(3)})`;
          ports[i].setAttribute("opacity", u);
          // Busy: a pulse travelling the port while it renders.
          ports[i].setAttribute("stroke-dashoffset", (-(t * 40) % 12).toFixed(1));
        });
        portT.style.opacity = ramp(t, tSix - 0.2, tSix + 0.2);
        nForm.style.opacity = ramp(t, tSix, tSix + 0.4);
        show(seedT, ramp(t, tIdx - 0.2, tIdx + 0.2));
        // Results land out of order; the pool only ever grows at its cursor.
        const T0 = tIdx + 0.2;
        const dt = Math.max(0.12, (tId - 0.3 - T0) / NP);
        const landed = (i) => T0 + arrive.indexOf(i) * dt;
        let cursor = 0;
        while (cursor < NP && t >= landed(cursor)) {
          // The fold at i waits for every index before it.
          let ready = true;
          for (let j = 0; j <= cursor; j++) if (t < landed(j)) ready = false;
          if (!ready) break;
          cursor++;
        }
        const absAt = (i) => Math.max(...Array.from({ length: i + 1 }, (_, j) => landed(j)));
        pools.forEach((pl, k) => {
          const pu = k === 0 ? ramp(t, tIdx - 0.1, tIdx + 0.3) : ramp(t, tId - 0.1 + k * 0.25, tId + 0.3 + k * 0.25, E.out3);
          pl.lb.style.opacity = pu;
          pl.cells.forEach((c, i) => {
            c.d.style.opacity = pu;
            c.n.style.opacity = pu;
            let o = 0;
            if (k === 0) {
              const got = t >= landed(i);
              const abs = t >= absAt(i);
              o = abs ? 1 : got ? 0.3 : 0;
              c.d.style.borderColor = abs ? C.aDeep : got ? C.mute : C.hair;
            } else {
              o = pu;
              c.d.style.borderColor = C.aDeep;
            }
            c.g.setAttribute("opacity", (o * pu).toFixed(3));
          });
        });
        doneT.textContent = `arrived: ${arrive.filter((i) => t >= landed(i)).join(" ")} · absorbed through index ${Math.max(0, cursor - 1)}`;
        doneT.style.opacity = ramp(t, T0, T0 + 0.3) * (1 - ramp(t, tId + 0.6, tId + 1.0));
        show(same, ramp(t, tId + 0.7, tId + 1.1));
        tests.style.opacity = ramp(t, tId + 0.8, tId + 1.2);
        void tAbs;
        speak(v1, t, l1, l2.t0);
        speak(v2, t, l2, b.t1 + 0.4);
        void tl;
      };
    },
  });
}

// ============================================================================
// 11 · outro
// ============================================================================

function sceneOutro({ stage, beat, line }) {
  const b = beat("outro");
  const l1 = line("outro1");
  stage.scene({
    id: "outro", t0: b.t0, t1: b.t1, pre: 0.3, fin: 0.4,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const diag = el("div", { class: "layer" }, over);
      const diagU = el("div", { class: "layer" }, under);
      const diagS = group(svg);
      const cb = box(diagU, { x: 960, y: 470, w: 560, h: 96, title: "auracle_grammar::compile", sub: "one term → one quiver patch", color: "s", ax: 0.5, ay: 0.5 });
      const up = box(diagU, { x: 960, y: 230, w: 700, h: 96, title: "search", sub: "render → vet → normalize → φ", color: "b", ax: 0.5, ay: 0.5 });
      const dn = box(diagU, { x: 960, y: 710, w: 700, h: 96, title: "stage · LivePoly", sub: "4 + 4 voices in the AudioWorklet", ax: 0.5, ay: 0.5 });
      const aUp = arrow(diagS, [960, 420], [960, 282], "b", { width: 3 });
      const aDn = arrow(diagS, [960, 520], [960, 658], "a", { width: 3 });
      const pulses = [group(diagS, "b"), group(diagS, "a")].map((g, i) => el("circle", { r: 9, fill: i ? ink("--phos-a-pulse") : ink("--phos-b-pulse"), opacity: 0 }, g));
      // The lockup, as in the engine film.
      const lock = place(el("div", { class: "lk" }, over), { x: 0, y: 0 });
      lock.style.fontSize = "96px";
      const wm = el("span", { class: "wm" }, lock, "AURACLE");
      const wmW = wm.getBoundingClientRect().width;
      const markPx = 1.28 * 96;
      const gap = 0.62 * 96;
      const left = 960 - (markPx + gap + wmW) / 2;
      const mk = mark(svg, { cx: left + markPx / 2, cy: 460, size: markPx });
      place(lock, { x: left + markPx + gap, y: 460, ay: 0.5 });
      const sub = label(over, "the sound engine", { x: 960, y: 580, size: 26, color: C.aDim, ax: 0.5, cls: "eyebrow" });
      const v1 = voiceLine(over, "*One compiler* serves search and stage, so what you play is _what the model measured_.");
      const tMe = wordTime(l1, "measured");
      const tLk = l1.t1 + 0.25;
      return (tl, t) => {
        const dOut = 1 - ramp(t, tLk - 0.35, tLk + 0.1);
        diag.style.opacity = diagU.style.opacity = dOut;
        diagS.setAttribute("opacity", dOut);
        show(cb, ramp(t, b.t0, b.t0 + 0.4, E.out3));
        show(up, ramp(t, wordTime(l1, "search") - 0.2, wordTime(l1, "search") + 0.2, E.out3));
        show(dn, ramp(t, wordTime(l1, "stage") - 0.2, wordTime(l1, "stage") + 0.2, E.out3));
        aUp.update(ramp(t, wordTime(l1, "search") - 0.1, wordTime(l1, "search") + 0.4));
        aDn.update(ramp(t, wordTime(l1, "stage") - 0.1, wordTime(l1, "stage") + 0.4));
        // On "measured": both paths pulse together, out of the one box.
        pulses.forEach((p, i) => {
          const u = ramp(t, tMe - 0.1, tMe + 0.6, E.io2);
          p.setAttribute("cx", 960);
          p.setAttribute("cy", i ? lerp(520, 658, u) : lerp(420, 282, u));
          p.setAttribute("opacity", fade(t, tMe - 0.1, tMe, tMe + 0.5, tMe + 0.6).toFixed(3));
        });
        cb.style.boxShadow = `inset 1px 1px 0 ${inkA("--white", 0.07)}, 0 18px 50px ${inkA("--black", 0.55)}, 0 0 ${(40 * fade(t, tMe - 0.1, tMe + 0.1, tMe + 0.5, tMe + 0.9)).toFixed(1)}px ${inkA("--silk", 0.25)}`;
        const u = ramp(t, tLk - 0.2, tLk + 0.7, E.out4);
        mk.update({ tile: u, outer: u, inner: ramp(t, tLk - 0.3, tLk + 0.4), core: E.outBack(ramp(t, tLk - 0.3, tLk + 0.2, E.lin)) });
        lock.style.opacity = u;
        sub.style.opacity = ramp(t, tLk + 0.4, tLk + 0.9);
        speak(v1, t, l1, b.t1 + 5);
        layer.style.opacity = 1 - ramp(t, b.t1 - 0.8, b.t1, E.io2);
        void tl;
      };
    },
  });
}

// ---- DATA: real renders, from the engine -----------------------------------
//
// Made by rendering presets through apps/web/pkg (`farm_render`, the default
// phrase, seed 0xE05F00D) and reducing them: `env` is a min/max pair per
// display column (int8, base64) of the normalized audition; `stem` and `win`
// are consecutive samples (int16); `blocks` are BS.1770 block loudnesses of
// the raw render; `motion.spec` is the held note's modulation spectrum
// (brightness and level tracks, variance density per bin ×10⁴, on a log-f
// grid); `z` is Glass Pad's φ_audio z-scored over the 62 presets; `glyphs`
// are the node bank's 42 modules (apps/web/main.js MODULES).
const DATA = {"sr":44100,"n":222705,"gp":{"env":"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","lufs":-31.187,"gain":13.187,"rawPeak":0.153,"rawRms":0.02701,"onsets":[0,88200,108045,138915]},"fb":{"env":"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","lufs":-26.752,"gain":6.146,"pr":2.606,"rawPeak":0.4929,"rawRms":0.04901,"dc":0.0007526538411070836,"normL":-20.61,"blocks":[-25.52,-27.25,-27.28,-27.3,-27.31,-27.31,-27.3,-27.3,-27.3,-27.31,-27.31,-27.29,-27.27,-27.27,-27.28,-28.52,-30.29,-26.72,-26.56,-25.66,-25.65,-24.27,-23.75,-23.27,-22.48,-24.08,-24.72,-26.24,-26.79,-28.25,-28.83,-27.99,-29.15,-29.36,-29.38,-29.4,-29.9,-31.27,-33.51,-37.66,-140.04,-300.69,-300.69,-300.69,-300.69,-300.69,-300.69],"stem":"2w1TDb4MHgxzC74K/wk3CWcIjwevBsoF3wTvA/oCBAIPAR4AMf9H/mL9gfyk+8v6+Pko+V74mffY9h32Z/W29A==","stem0":40135,"scope":"BwcICAgJCQkJCgoKCgoLCwsLCwsLDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDQ0NDQ0NDQ0NDg4ODg4ODg4PDw8PDw8PDxAQEBAQEBAQEBAQEBAQEREREREREREQEBAQEBAPDw8ODg0NDAsLCgkIBwcGBQQDAgEA//79/fz7+vn4+Pf29fX08/Py8vHx8PDv7+7u7u3t7ezs7Ovr6+vr6+vq6urq6urq6urq6urr6+vr6+vr6+zs7Ozs7e3t7e3u7u7u7+/v7/Dw8PDx8fHx8vLy8vPz8/P09PT09fX19fb29vb29/f39/j4+Pj4+Pn5+fn5+vr6+vr6+/v7+/v7+/z8/Pz8/Pz9/f39/f3+/v7+/v//////AAAAAAEBAQICAgIDAwMEBAQFBQUGBgYGBwcHCAgICAkJCQkKCgoKCwsLCwsLCwwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA0NDQ0NDQ0NDQ4ODg4ODg4ODw8PDw8PDw8QEBAQEBAQEBAQEBAQEBAREREREREREBAQEBAQDw8PDg4NDQwLCwoJCAgHBgUEAwIBAP/+/f38+/r5+Pj39vb19PTz8vLx8fDw7+/u7u7t7e3s7Ozr6+vr6+vr6urq6urq6urq6urq6uvr6+vr6+vs7Ozs7O3t7e3t7u7u7u/v7+/w8PDw8fHx8fLy8vLz8/Pz9PT09PX19fX29vb29vf39/f4+Pj4+Pj5+fn5+fr6+vr6+vv7+/v7+/v8/Pz8/Pz8/f39/f39/v7+/v7+/////wAAAAABAQECAgICAwMDBAQEBQUFBgYGBgcHBwgICAgJCQkJCgoKCgsLCwsLCwsMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwNDQ0NDQ0NDQ0ODg4ODg4ODg8PDw8PDw8PDxAQEBAQEBAQEBAQEBAQERERERERERAQEBAQEA8PDw4ODQ0MCwsKCQgIBwYFBAMCAQD//v79/Pv6+fn49/b29fT08/Ly8fHw8O/v7u7u7e3t7Ozs7Ovr6+vr6+rq6urq6urq6urq6urr6+vr6+vr7Ozs7Ozs7e3t7e7u7u7v7+/v8PDw8PHx8fHy8vLy8/Pz8/T09PT19fX19vb29vb39/f3+Pj4+Pj4+fn5+fn6+vr6+vr6+/v7+/v7/Pz8/Pz8/P39/f39/f3+/v7+/v////8AAAAAAQEBAQICAgMDAwQEBAUFBQUGBgYHBwcICAgICQkJCQoKCg=="},"nw":{"win":"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","maxDiff":0},"jw":{"env":"Fe4d2ybZKdsp2SfUJdQj2ybcIdwg3SDeHOAe4SHiHeIe5BrkHeAc4RnlHuMf5RnpHeYb5BriG+gd6BnlHOEa4h3jHOcc6BzlGeYd5xnmGOQZ5BvnG+Yb5h7kGucX5hjpGOYb5xvlG+Ub5hrnIOYf5xzmHOcX6hfmGecb4RvlHOgc4hnjGOYX5R3nGOQb6BjjHOQZ5BnnGOYe6B7iHOYa6RvnHeEc5xrpGuUY4xvkGuYa6BzlGOce5h3oHOUX5R3kF+ga5RnoGucf6BjlF+gZ4hnmGeQa5hrkGuca5RfmHuUb6RrmHOgd5BvoG+Qf4hrpHeQd5R3mGuYa4RzjGeka5RjmG+QZ4hnoGucd4hvkGOUb5BzlGukc4xXnHOMa4hXoDvEO9Qn1B/kG+gX7BPwD/gL+Av4B/wH/Af8B/w33G+Im3ijWKNwr1ifaJtkh3SPeIN0f4RvhIOEc4iDeHeQd5R7iHuQd4x3kHuYa6BzoFuoP8A3zCfcI+Qb6BPsD/QP+Av4C/hnjM9U1vkXHOcU+wz/ENcY5xzPIOcgv0S3TMdIyyzbUKtMt2DHVL9Qn0i7SKs8n3incMNkt1ivYMdsn2y7VKtYt1THXK9cz2CvYKMwu2CvQHtkb6BXqEPEN8gr3B/kG+gT8A/wD/QL+Av4B/wH/CPke5CvbKNYj1CnbK9ko2ibUId4i3yPdI+Qf5B/fHOEc4xzjHeMa5RzjG+Qd4BrlHOQd5BzkHuYZ5R3jG+QY5hnkHOUc5BjlHeoc4RvpHOYb5RvgHegY5BvkHeUb5xroGeEb5hjjGugZ5RjqGuke6BvmGuoW5xrmHOQa5RnrGOcY6BHvEPML9gn4BvkF+wT8A/0D/gL+Af8B/wH/Af8B/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","rmsDb":-21.81,"rms":-21.81,"L":-18,"L0":-9.633},"ib":{"env":"R8EywC/LKs8o1STaIdsg3h7gHOEb4hrkGeQZ5RnlGOYY5hjmF+YX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5xfnF+cX5wj1Av4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD3GPccyzi3UKdkk3CHfH+Id4xzlG+Ya5xnnGegY6RjpF+kX6RfqF+oX6hfqFuoW6hbrBfsB/wAAAAAAAAAAAAAAAAAAAAAAAG+SX4tOqlarOcFDuzjKOMM3yjPQMscq2zDKJtQt1CvPKdQu0iPaLtMn3CvSK9Uq2SrRJeEr0CTYKtEp1ybXK9Mg2y3UJ9ws1CbWKdoq0h7jEekC/AH/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADchDtzbOL8IqyibQJtQi1yDfHtod3BvdHN4b3xvfGuAT4BrhGeEZ7hnhGeEU4hniGeIZ6xniGOIW4hjiGOIY5xjiGOIX4hjiGOIY4hjiEuIY4hjiGO4Y4hjiFeIY4hjiGOoY4hjiFuIY4hjiGOYY4hjiGOIY4hjkGOIY4hLiGOIN+QL9AP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","rmsDb":-17.36,"L":-18,"L0":-19.471},"motion":{"spec":[[0.3,29.21,3.305],[0.311,29.32,3.296],[0.322,29.433,3.287],[0.333,29.55,3.278],[0.345,29.723,3.305],[0.358,29.921,3.346],[0.371,30.126,3.388],[0.384,30.338,3.432],[0.398,30.558,3.478],[0.412,30.786,3.525],[0.427,31.021,3.574],[0.442,31.266,3.625],[0.458,31.519,3.677],[0.474,31.781,3.732],[0.491,32.052,3.788],[0.509,32.351,3.887],[0.527,32.719,4.133],[0.546,33.102,4.387],[0.565,33.497,4.651],[0.586,33.907,4.924],[0.607,34.332,5.207],[0.628,34.772,5.5],[0.651,35.228,5.804],[0.674,35.702,6.138],[0.698,36.238,6.867],[0.723,36.794,7.621],[0.749,37.37,8.402],[0.776,37.966,9.211],[0.804,38.584,10.05],[0.833,39.224,10.918],[0.862,39.867,12.287],[0.893,40.524,13.899],[0.925,41.206,15.569],[0.959,41.912,17.298],[0.993,42.643,19.09],[1.028,43.321,21.415],[1.065,43.953,24.244],[1.103,44.608,27.174],[1.143,45.287,30.21],[1.184,45.944,33.501],[1.226,46.369,37.744],[1.27,46.809,42.138],[1.316,47.265,46.69],[1.363,47.577,51.7],[1.412,47.607,57.427],[1.462,47.639,63.359],[1.515,47.664,69.508],[1.569,47.132,76.257],[1.625,46.58,83.249],[1.683,45.996,90.483],[1.744,44.798,97.622],[1.806,43.558,105.016],[1.871,42.103,112.267],[1.938,40.218,118.863],[2.007,38.265,125.695],[2.079,35.909,130.817],[2.154,33.404,135.743],[2.231,30.711,139.054],[2.311,27.844,141.087],[2.394,24.907,141.511],[2.479,21.905,139.95],[2.568,18.947,136.51],[2.66,16.038,131.1],[2.756,13.345,123.433],[2.854,10.718,114.444],[2.957,8.55,103.166],[3.063,6.529,91.122],[3.172,4.849,78.117],[3.286,3.548,65.093],[3.404,2.473,52.284],[3.526,1.676,40.174],[3.652,1.185,29.959],[3.783,0.847,21.235],[3.918,0.641,14.198],[4.059,0.531,8.943],[4.204,0.478,5.389],[4.355,0.448,3.336],[4.511,0.42,2.204],[4.672,0.399,1.773],[4.84,0.404,1.933],[5.013,0.472,2.726],[5.193,0.653,4.324],[5.379,0.996,6.939],[5.571,1.553,10.768],[5.771,2.303,15.56],[5.978,3.166,20.737],[6.192,4.008,25.451],[6.414,4.631,28.539],[6.644,4.824,28.905],[6.882,4.547,26.489],[7.128,3.777,21.331],[7.384,2.753,14.881],[7.648,1.734,8.712],[7.922,0.915,3.964],[8.206,0.414,1.336],[8.5,0.163,0.346],[8.805,0.059,0.262],[9.12,0.02,0.491],[9.447,0.005,0.747],[9.785,0.017,1.032],[10.136,0.086,1.492],[10.499,0.223,2.165],[10.875,0.362,2.699],[11.265,0.391,2.529],[11.668,0.29,1.561],[12.086,0.193,0.588],[12.519,0.191,0.263],[12.968,0.2,0.311],[13.432,0.126,0.221],[13.914,0.034,0.039],[14.412,0.007,0.014],[14.928,0.012,0.075],[15.463,0.004,0.057],[16.017,0.001,0.005],[16.591,0.009,0.019],[17.186,0.011,0.059],[17.801,0.005,0.051],[18.439,0.001,0.014],[19.1,0,0],[19.784,0.009,0.005],[20.493,0.017,0.004],[21.227,0.006,0.001],[21.987,0.003,0],[22.775,0.005,0.002],[23.591,0.007,0.001],[24.436,0.012,0.001],[25.312,0.004,0.001],[26.219,0.006,0],[27.158,0.006,0.001],[28.131,0,0],[29.139,0.002,0],[30.183,0.002,0],[31.264,0.001,0],[32.384,0,0],[33.545,0.003,0.001],[34.746,0.002,0.001],[35.991,0.001,0],[37.281,0,0],[38.616,0.001,0],[40,0.001,0]],"bands":[-1.845,-1.308,-3.885],"arrived":0.842},"z":[-0.04,0.59,-0.1,-0.26,-0.41,0.08,0.81,-0.03,-0.59,0.83,0.98,-0.3,0.97,-1.11,-0.09,1.15,1.69,1.12],"gpStruct":[0,1,0,0,0,0,0,1,0,0,1,0,0,1,0,0,0,0,0,0.333,1,0.55,0.8,0.65,1,0],"glyphs":[["sources","vco","<path class=\"gl\" d=\"M1 11.5 L7 2.5 L7 11.5 L13 2.5 L13 11.5 L19 2.5\"/>"],["sources","supersaw","<path class=\"gl-ghost\" d=\"M0.5 9.5 L6 2 L6 9.5 L11.5 2 L11.5 9.5 L17 2\"/><path class=\"gl-ghost\" d=\"M2.5 13 L8 5.5 L8 13 L13.5 5.5 L13.5 13 L19 5.5\"/><path class=\"gl\" d=\"M1.5 11.5 L7 4 L7 11.5 L12.5 4 L12.5 11.5 L18 4\"/>"],["sources","wavetable","<path class=\"gl\" d=\"M1 3.4 q2.3 -2.8 4.6 0 t4.6 0 t4.6 0\"/><path class=\"gl\" d=\"M1 11.2 h2.6 v-3 h3.1 v3 h3.1 v-3 h3.1 v3 h2.9\"/><path class=\"gl-mark\" d=\"M17.6 4.6 V9.4 M16.3 8.2 l1.3 1.4 l1.3 -1.4\"/>"],["sources","pluck","<path class=\"gl\" d=\"M1 7 C2.4 0.8, 4 13.2, 5.6 7 C6.9 2.4, 8.2 11.6, 9.5 7 C10.6 3.8, 11.7 10.2, 12.8 7 C13.7 4.9, 14.6 9.1, 15.5 7 C16.3 5.6, 17.1 8.4, 17.9 7 L19 7\"/>"],["sources","formant","<path class=\"gl-rule\" d=\"M0 12 H20\"/><path class=\"gl\" d=\"M1 12 C2.4 12, 2.7 3.2, 4.1 3.2 C5.5 3.2, 5.8 12, 7.2 12 C8.3 12, 8.6 5.8, 9.9 5.8 C11.2 5.8, 11.5 12, 12.8 12 C13.8 12, 14.1 8, 15.3 8 C16.5 8, 16.8 12, 18 12 L19 12\"/>"],["sources","noise","<path class=\"gl\" d=\"M1 7 L2.3 2.6 L3.6 10.8 L4.9 4 L6.2 12 L7.5 3.4 L8.8 9.6 L10.1 2.4 L11.4 11.4 L12.7 4.6 L14 12.2 L15.3 3 L16.6 10 L17.9 4.4 L19 7.4\"/>"],["shape","wavefolder","<path class=\"gl-rule\" d=\"M0 3.6 H20\"/><path class=\"gl\" d=\"M1 12.4 L4.6 3.6 L6.6 7.8 L8.6 3.6 L11.4 12.4 L14.6 3.6 L16.6 7.8 L18.6 3.6\"/>"],["shape","distortion","<path class=\"gl-rule\" d=\"M1 13 L19 1\"/><path class=\"gl\" d=\"M1 12.6 C5.4 12.4, 6.4 9.4, 10 7 C13.6 4.6, 14.6 1.7, 19 1.5\"/>"],["shape","bitcrush","<path class=\"gl\" d=\"M1 10.6 h2.6 V8 h2.6 V5 h2.6 V3.4 h2.6 V5 h2.6 V8 h2.6 V10.6 h2\"/>"],["filter","filter","<path class=\"gl\" d=\"M1 5 H8.6 C10.6 5, 10.9 3, 12.1 3 C13.4 3, 13.7 7.2, 15.2 10 C16.4 12.3, 17.7 13, 19 13\"/>"],["filter","eq","<path class=\"gl\" d=\"M1 4.6 H3.4 C5 4.6, 5.4 10.4, 7.6 10.4 C9.4 10.4, 10.2 10.4, 11.6 10.4 C13.6 10.4, 14 4.6, 16.2 4.6 H19\"/>"],["space","delay","<path class=\"gl-rule\" d=\"M0 12 H20\"/><path class=\"gl\" d=\"M1.6 12 V2.6 M6.4 12 V5.8 M11.2 12 V8.2 M16 12 V10.2\"/>"],["space","chorus","<path class=\"gl-ghost\" d=\"M1 7 q2.6 4.2 5.2 0 t5.2 0 t5.2 0\"/><path class=\"gl\" d=\"M1 7 q2.2 -4.2 4.4 0 t4.4 0 t4.4 0 t4.4 0\"/>"],["space","reverb","<path class=\"gl-rule\" d=\"M0 12 H20\"/><path class=\"gl\" d=\"M2 12 V2 M5 12 V6.4 M7.2 12 V8.6 M9.4 12 V7.4 M11.6 12 V9.6 M13.8 12 V8.8 M16 12 V10.4 M18.2 12 V9.9\"/>"],["space","phaser","<path class=\"gl\" d=\"M1 4.4 H3.2 C4.2 4.4, 4.4 10.6, 5.4 10.6 C6.4 10.6, 6.6 4.4, 7.6 4.4 C8.8 4.4, 9 10.6, 10 10.6 C11 10.6, 11.2 4.4, 12.4 4.4 C13.6 4.4, 13.8 10.6, 14.8 10.6 C15.8 10.6, 16 4.4, 17.2 4.4 H19\"/>"],["space","flanger","<path class=\"gl\" d=\"M1 4.6 q1 5.6 2 0 t2 0 t2 0 t2 0 t2 0 t2 0 t2 0 t2 0 t2 0\"/>"],["space","granular","<path class=\"gl\" d=\"M2 5 v2 M4 8.4 v2 M5.6 3.6 v2 M7.2 9.6 v2 M8.8 6 v2 M10.4 3.4 v2 M12 8.6 v2 M13.6 5.4 v2 M15.2 10 v2 M16.8 6.8 v2 M18.4 4.4 v2\"/>"],["motion","tremolo","<path class=\"gl-ghost\" d=\"M1 7 q2.5 5 5 0 t5 0 t5 0 t3 0\"/><path class=\"gl\" d=\"M1 7 q2.5 -5 5 0 t5 0 t5 0 t3 0\"/>"],["motion","vibrato","<path class=\"gl\" d=\"M1 7 q0.7 -4.4 1.4 0 q0.9 4.4 1.8 0 q1.3 -4.4 2.6 0 q1.7 4.4 3.4 0 q1.3 -4.4 2.6 0 q0.9 4.4 1.8 0 q0.7 -4.4 1.4 0\"/>"],["motion","pitch shift","<path class=\"gl-ghost\" d=\"M1 10.5 q1.6 -3.4 3.2 0 t3.2 0 t3.2 0 t3.2 0 t3.2 0\"/><path class=\"gl\" d=\"M1 4.2 q1.1 -3.4 2.2 0 t2.2 0 t2.2 0 t2.2 0 t2.2 0 t2.2 0 t2.2 0 t2.2 0\"/>"],["dynamics","compressor","<path class=\"gl-rule\" d=\"M1 13 L19 1\"/><path class=\"gl\" d=\"M1 13 L8.5 5.5 C10.2 4, 11.6 3.6, 13.6 3.3 L19 2.8\"/>"],["dynamics","ducker","<path class=\"gl-mark\" d=\"M4.2 12.6 V8\"/><path class=\"gl\" d=\"M1 4.4 H3.6 L4.6 11.2 C6.6 11.2, 8.2 6, 11.2 4.9 C13.8 4.5, 16.2 4.4, 19 4.4\"/>"],["dynamics","gate","<path class=\"gl-rule\" d=\"M0 12 H20\"/><path class=\"gl\" d=\"M1.6 7.4 q0.7 -3.6 1.4 0 t1.4 0 t1.4 0 M9 7.4 q0.7 -3.6 1.4 0 t1.4 0 M15.4 7.4 q0.7 -3.6 1.4 0 t1.4 0\"/>"],["combine","mix","<path class=\"gl\" d=\"M1 2.8 L9.6 7 L19 7 M1 11.2 L9.6 7\"/>"],["combine","ring mod","<path class=\"gl-rule\" d=\"M1 7 q4.5 -5.6 9 0 t9 0\"/><path class=\"gl\" d=\"M1 7 q1.5 -4 3 0 t3 0 t3 0 t3 0 t3 0 t3 0\"/>"],["combine","vocoder","<path class=\"gl-rule\" d=\"M0 12 H20\"/><path class=\"gl\" d=\"M2 12 V6.2 M4.4 12 V3.6 M6.8 12 V7.8 M9.2 12 V4.6 M11.6 12 V9.2 M14 12 V5.2 M16.4 12 V8.2 M18.4 12 V6.6\"/><path class=\"gl-ghost\" d=\"M1.6 7.4 C4 2.6, 7 9, 9.8 4.8 C12.8 2.2, 15.6 8.6, 18.8 6.2\"/>"],["modulation","lfo","<path class=\"gl\" d=\"M1 10.6 L5.5 3.4 L10 10.6 L14.5 3.4 L19 10.6\"/>"],["modulation","mod env","<path class=\"gl\" d=\"M1 12 L5 2.4 L19 12\"/>"],["modulation","s&h rand","<path class=\"gl\" d=\"M1 9 h3 V4 h3 V11.2 h3 V6 h3 V8.6 h3 V3.4 h2\"/>"],["modulation","follower","<path class=\"gl-ghost\" d=\"M2 7 L3 3.6 L4 10.4 L5 4.2 L6 10 L7 4.8 L8 9.6 L9 5.4 L10 9 L11 5.9 L12 8.4 L13 6.3 L14 8 L15 6.6 L16 7.6 L17 6.9 L18 7.3\"/><path class=\"gl\" d=\"M1 12.4 C2.6 3, 3.4 2.6, 5.2 3.2 C8.6 4.2, 13 9.4, 19 11.8\"/>"],["modulation","euclid","<path class=\"gl-rule\" d=\"M0 12 H20\"/><path class=\"gl\" d=\"M1.4 12 V5 M6.2 12 V5 M11 12 V5 M15.8 12 V5\"/><path class=\"gl-ghost\" d=\"M3.8 12 V8.6 M8.6 12 V8.6 M13.4 12 V8.6 M18.2 12 V8.6\"/>"],["modulation","steps","<path class=\"gl-rule\" d=\"M0 12.5 H20\"/><path class=\"gl\" d=\"M2.5 12.5 V9 M7.5 12.5 V5.2 M12.5 12.5 V2 M17.5 12.5 V7.4\"/><path class=\"gl-ghost\" d=\"M1 9 h3 L6 5.2 h3 L11 2 h3 L16 7.4 h3\"/>"],["cvshape","quantize","<path class=\"gl\" d=\"M1 11 h2.6 V8.6 h2.6 V6.2 h2.6 V3.8 h2.6 V6.2 h2.6 V8.6 h2.6 V11 h2\"/>"],["cvshape","slew","<path class=\"gl-ghost\" d=\"M1 10.5 h4 V4 h5 V10.5 h4 V4 h5\"/><path class=\"gl\" d=\"M1 10.5 h2.6 L6.4 4 h2.2 L11 10.5 h2.4 L16 4 h3\"/>"],["cvshape","rectify","<path class=\"gl-rule\" d=\"M0 7 H20\"/><path class=\"gl-ghost\" d=\"M1 3.4 L5 10.6 L9 3.4 L13 10.6 L17 3.4\"/><path class=\"gl\" d=\"M1 3.4 L3 7 L5 3.4 L7 7 L9 3.4 L11 7 L13 3.4 L15 7 L17 3.4\"/>"],["cvshape","hold","<path class=\"gl-ghost\" d=\"M1 7 q2.2 -4 4.4 0 t4.4 0 t4.4 0 t4.4 0\"/><path class=\"gl\" d=\"M1 8.6 h3 V4.4 h3 V6.6 h3 V10.4 h3 V6.6 h3 V4 h2\"/>"],["cvlogic","min","<path class=\"gl-ghost\" d=\"M1 4 L9 4\"/><path class=\"gl-ghost\" d=\"M1 10 L9 10\"/><path class=\"gl\" d=\"M9 4 L11 10 L19 10\"/>"],["cvlogic","max","<path class=\"gl-ghost\" d=\"M1 4 L9 4\"/><path class=\"gl-ghost\" d=\"M1 10 L9 10\"/><path class=\"gl\" d=\"M9 10 L11 4 L19 4\"/>"],["cvlogic","and","<path class=\"gl-ghost\" d=\"M1 4 h5 v0 M1 10 h7\"/><path class=\"gl\" d=\"M6 11 h2 V4 h4 V11 h7\"/>"],["cvlogic","or","<path class=\"gl-ghost\" d=\"M1 4 h4 M1 10 h6\"/><path class=\"gl\" d=\"M1 11 h3 V4 h5 V11 h2 V4 h4 V11 h4\"/>"],["cvlogic","xor","<path class=\"gl-ghost\" d=\"M1 4 h4 M1 10 h6\"/><path class=\"gl\" d=\"M1 11 h3 V4 h3 V11 h3 V4 h3 V11 h6\"/>"],["cvlogic","switch","<path class=\"gl-ghost\" d=\"M1 4 h6 M1 10 h6\"/><path class=\"gl\" d=\"M7 4 L11 4 M7 10 L10 10 L11 4 M11 4 h8\"/>"]]};
