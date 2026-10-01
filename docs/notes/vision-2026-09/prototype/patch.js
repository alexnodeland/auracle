// PATCH: the sound's real patch as a signal flow that explains itself. Sources
// on the left, the output on the right, into OUT and the sound's own vessel.
// Modulators hang under the stage they move, on dashed cables that flow at the
// modulator's rate. Knobs turn (as a design: nothing re-renders here), and a
// patch can be started from nothing, with the model suggesting the next module.
(() => {
"use strict";
const { el, icon } = A;

// The app's own names for each kind (apps/web/main.js), and what each does.
const NAME = { Vco: "vco", Supersaw: "supersaw", Wavetable: "wavetable", Noise: "noise", Pluck: "pluck", Formant: "formant", Granular: "granular", Filter: "filter", Eq: "eq", Distortion: "distortion", Fold: "wavefolder", Bitcrush: "bitcrush", RingMod: "ring mod", Chorus: "chorus", Flanger: "flanger", Phaser: "phaser", Delay: "delay", Reverb: "reverb", Comp: "compressor", Duck: "ducker", Gate: "gate", Tremolo: "tremolo", Vibrato: "vibrato", Shift: "pitch shift", Vocoder: "vocoder", Mix: "mix", Lfo: "lfo", Env: "mod env", Steps: "steps", Rand: "s&h rand", Follow: "follower", Euclid: "euclid", AudioIn: "audio in" };
const SAYS = {
  Vco: "One oscillator: a single wave, following the keys.",
  Supersaw: "Seven detuned saws stacked into one wide voice.",
  Wavetable: "Sweeps through a table of waves; morph sets the place.",
  Noise: "Random signal: white hisses bright, pink sits softer.",
  Pluck: "A struck string: a burst of noise ringing out.",
  Formant: "Vowel filters that make the sound say ah, ee or oo.",
  Granular: "Tiny grains of the input, scattered and layered.",
  Filter: "Removes part of the spectrum; resonance rings at the cutoff.",
  Eq: "Raises or lowers the lows, mids and highs.",
  Distortion: "Pushes the signal into saturation, adding harmonics and grit.",
  Fold: "Folds loud peaks back on themselves: bright, metallic overtones.",
  Bitcrush: "Fewer bits, a lower sample rate: digital, gritty edges.",
  RingMod: "Multiplies two signals into clangorous, bell-like tones.",
  Chorus: "Detuned copies drifting against the sound: width and shimmer.",
  Flanger: "A sweeping short delay: a jet-like comb swoosh.",
  Phaser: "Sweeping notches in the spectrum: a gentle swirl.",
  Delay: "Echoes: time sets the gap, feedback sets how many.",
  Reverb: "A room around the sound; size and damping shape it.",
  Comp: "Evens out loudness: quiet parts come up, peaks come down.",
  Duck: "Dips the level whenever the key signal hits.",
  Gate: "Opens only while the key signal is loud enough.",
  Tremolo: "Loudness rising and falling at a steady rate.",
  Vibrato: "Pitch wavering at a steady rate.",
  Shift: "Moves the pitch by semitones, keeping its timing.",
  Vocoder: "The modulator's shape, spoken through the carrier's tone.",
  Mix: "Blends two signals; balance sets how much of each.",
  Lfo: "A slow wave that moves another module's knob.",
  Env: "A rise and fall on every note that moves a knob.",
  Steps: "A repeating sequence of values: a stepped pattern.",
  Rand: "A new random value each step, glided if you like.",
  Follow: "Follows a signal's loudness and turns it into movement.",
  Euclid: "Evenly spread pulses: a rhythm from steps and pulses.",
  AudioIn: "An input from outside: a mic, an interface, or the DAW track.",
};
const OP_SAYS = { quantize: "Snaps the movement to a musical scale.", slew: "Smooths the sudden jumps in a movement.", rectify: "Folds the movement onto one side of zero.", hold: "Samples the movement and holds it in steps." };
const OP_PARAMS = { quantize: ["root", "scale"], slew: ["rise", "fall"], rectify: ["mode"], hold: ["rate"] };
const AMP_SAYS = "Every voice ends here: an envelope shapes each note's loudness.";
const SUBKEY = ["kind", "wave", "mode", "color", "table"];
const FILTER_KIND = { SvfLp: "lowpass", SvfHp: "highpass", SvfBp: "bandpass", Ladder: "ladder" };
const INT = new Set(["octave", "semis", "bands", "steps", "pulses", "bits", "length", "downsample"]);
const SHORT = { resonance: "res", threshold: "thresh", brightness: "bright", feedback: "fb", position: "pos", damping: "damp", balance: "balance", downsample: "down", density: "dens", release: "rel", attack: "atk", octave: "oct" };
const ROLE_ORDER = { input: 0, a: 0, carrier: 0, b: 1, modulator: 1, sidechain: 2, key: 2 };

// ---- audio input: devices (illustrative: the prototype frame can't open them) and its four uses
const DEVICES = [["file", "The file you brought", "file", "Your sound"], ["mic", "Built-in microphone", "mic", "Built in"], ["in1", "Interface · in 1", "in 1", "Interface"], ["in2", "Interface · in 2", "in 2", "Interface"], ["in12", "Interface · in 1+2", "in 1+2", "Interface"], ["daw", "DAW track (in the plugin)", "daw track", "In the plugin"]];
const CHANNELS = { file: ["file"], mic: ["mic"], in1: ["1"], in2: ["2"], in12: ["1", "2"], daw: ["daw"] };
const MODES = [["process", "process", "The input runs through the patch: Auracle as an effect."], ["modulate", "modulate", "Its loudness moves the patch, so it reacts to how you play."], ["play", "play", "Its pitch and dynamics play the synth: hum or strum into it."], ["resample", "resample", "Records the input as a new source the model can breed."]];
const MODE_SAYS = Object.fromEntries(MODES.map(([k, , s]) => [k, s]));

// ---- starting from nothing: the catalogue, and each kind's first settings
const CAT = [
  ["source", "Sources", ["Vco", "Supersaw", "Wavetable", "Noise", "Pluck", "AudioIn"]],
  ["shaper", "Shapers", ["Filter", "Eq", "Distortion", "Fold", "Bitcrush"]],
  ["effect", "Effects", ["Chorus", "Phaser", "Delay", "Reverb", "Comp"]],
  ["mod", "Modulators", ["Lfo", "Env", "Steps", "Rand", "Follow"]],
];
const catOf = (k) => (CAT.find(([, , ks]) => ks.includes(k)) || ["effect"])[0];
const GLYPH = {
  source: '<path d="M3 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0"/>',
  shaper: '<path d="M3 8h8c3 0 4 2 5 5s2 5 5 5"/>',
  effect: '<path d="M5 18V6M10 18V9M15 18v-6M20 18v-3"/>',
  mod: '<path d="M3 12c2-5 4-5 6 0s4 5 6 0 4-5 6 0" stroke-dasharray="2.5 3"/>',
};
const gsvg = (g) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH[g]}</svg>`;
const kindIcon = (k) => (k === "AudioIn" ? A.icon("input") : gsvg(catOf(k)));
const DEFAULTS = {
  Vco: { wave: "Saw", octave: 0, detune: 0.3, mod_depth: 0 },
  Supersaw: { detune: 0.45, spread: 0.6, mod_depth: 0 },
  Wavetable: { table: "Vocal", morph: 0.4, mod_depth: 0 },
  Noise: { color: "Pink", level: 0.6 },
  Pluck: { damping: 0.4, brightness: 0.6 },
  AudioIn: { device: "in1", mode: "process", gain: 0.7 },
  Filter: { kind: "SvfLp", cutoff: 0.55, resonance: 0.3, mod_depth: 0.35 },
  Eq: { low: 0.5, mid: 0.5, high: 0.55 },
  Distortion: { drive: 0.45, tone: 0.5 },
  Fold: { folds: 0.4, bias: 0.5 },
  Bitcrush: { bits: 8, downsample: 2 },
  Chorus: { rate: 0.3, depth: 0.5, mix: 0.4 },
  Phaser: { rate: 0.3, depth: 0.6, feedback: 0.4 },
  Delay: { time: 0.4, feedback: 0.35, mix: 0.3 },
  Reverb: { size: 0.6, damping: 0.4, mix: 0.3 },
  Comp: { threshold: 0.5, ratio: 0.4 },
  Lfo: { wave: "Triangle", rate: 0.45 },
  Env: { attack: 0.02, decay: 0.35 },
  Steps: { steps: 8, rate: 0.5 },
  Rand: { rate: 0.5, glide: 0.1 },
  Follow: { attack: 0.05, release: 0.2 },
};
const KIND2 = Object.assign({}, A.KIND, { AudioIn: "AUDIO IN" });
const SILENT = { dev: new Array(A.D.bands_hz.length).fill(-2.4), sdev: [], sloud: [] };

// ---- shapes without words: a module's effect drawn on the vessel at OUT
const FQ = A.D.bands_hz, MEAN = A.D.mean_db, SDB = A.D.sd_db, lg = Math.log2;
const toDev = (row) => { const mx = Math.max(...row); return row.map((v, i) => (v - mx - MEAN[i]) / SDB); };
const bump = (f, fc, db, w = 0.6) => db * Math.exp(-Math.pow(lg(f / fc), 2) / (2 * w * w));
// a filter's response, estimated from its knobs (cutoff 0…1 taken as 20 Hz…20 kHz)
function filterResp(p) {
  const fc = 20 * Math.pow(1000, typeof p.cutoff === "number" ? p.cutoff : 0.5), res = typeof p.resonance === "number" ? p.resonance : 0.2;
  const order = p.kind === "Ladder" ? 8 : 4;
  return FQ.map((f) => {
    let db = p.kind === "SvfHp" ? -10 * Math.log10(1 + Math.pow(fc / f, 4)) : p.kind === "SvfBp" ? -10 * Math.log10(1 + 4 * Math.pow(f / fc - fc / f, 2)) : -10 * Math.log10(1 + Math.pow(f / fc, order));
    return Math.max(-36, db + bump(f, fc, res * 12, 0.25));
  });
}
const eqResp = (p) => FQ.map((f) => { const wl = 1 / (1 + Math.pow(f / 250, 2)), wh = 1 / (1 + Math.pow(4000 / f, 2)), wm = Math.max(0, 1 - wl - wh); return ((p.low ?? 0.5) - 0.5) * 18 * wl + ((p.mid ?? 0.5) - 0.5) * 18 * wm + ((p.high ?? 0.5) - 0.5) * 18 * wh; });
const liftResp = (amt, from) => FQ.map((f) => amt * Math.max(0, Math.min(1, lg(f / from) / 4)));
// what a spectral module adds to what passes through it, in dB (null: not spectral)
function effectOf(kind, p) {
  if (kind === "Filter") return filterResp(p);
  if (kind === "Eq") return eqResp(p);
  if (kind === "Distortion") return liftResp((p.drive ?? 0.5) * 14, 800);
  if (kind === "Fold") return liftResp((p.folds ?? 0.4) * 16 + 2, 1500);
  if (kind === "Bitcrush") return liftResp((1 - Math.min(16, p.bits ?? 8) / 16) * 18 + 3, 3000);
  return null;
}
// where a module acts, when its effect is not a shape we can compute
const REGION = { Vco: [60, 6000], Supersaw: [100, 10000], Wavetable: [100, 8000], Noise: [2000, 14000], Pluck: [200, 8000], Formant: [300, 3500], Granular: [100, 10000], RingMod: [500, 10000], Chorus: [300, 8000], Flanger: [500, 10000], Phaser: [300, 6000], Vocoder: [200, 8000], Delay: [80, 14000], Reverb: [80, 14000], Comp: [40, 14000], Duck: [40, 14000], Gate: [40, 14000], Tremolo: [40, 14000], Vibrato: [60, 8000], Shift: [60, 10000], Mix: [40, 14000], AudioIn: [80, 8000] };
// a new patch's sound, estimated from its modules' kinds and knobs (sources first)
function toneOf(kind, p) {
  const f0 = 262 * Math.pow(2, p.octave || 0);
  const below = (f, g) => (f < g * 0.75 ? -28 - 20 * lg((g * 0.75) / f) : null);
  if (kind === "Vco") { const slope = { Saw: 6, Square: 7, Triangle: 12, Sine: 30 }[p.wave] ?? 6; return FQ.map((f) => below(f, f0) ?? -slope * Math.max(0, lg(f / f0))); }
  if (kind === "Supersaw") return FQ.map((f) => below(f, f0) ?? 2 - 5 * Math.max(0, lg(f / f0)) + bump(f, f0 * 4, 3, 1));
  if (kind === "Wavetable") return FQ.map((f) => below(f, f0) ?? -7 * Math.max(0, lg(f / f0)) + bump(f, 500 * Math.pow(6, p.morph ?? 0.4), 7));
  if (kind === "Noise") return FQ.map((f) => (p.color === "White" ? 3 * lg(f / 1000) : p.color === "Brown" ? -3 * lg(f / 35) : 0) - 6);
  if (kind === "Pluck") return FQ.map((f) => below(f, f0) ?? -(4 + (1 - (p.brightness ?? 0.6)) * 6) * Math.max(0, lg(f / f0)));
  if (kind === "AudioIn") return FQ.map((f) => (below(f, 150) ?? -9 * Math.max(0, lg(f / 150))) + bump(f, 700, 8, 0.4) + bump(f, 2400, 6, 0.4));
  return null;
}
const smoothRow = (r, k) => r.map((v, i) => { let s = 0, n = 0; for (let j = -k; j <= k; j++) if (r[i + j] != null) { s += r[i + j]; n++; } return s / n; });
function estSpec(node, skip) {
  if (!node || typeof node !== "object") return null;
  const k = kindOf(node), b = node[k]; if (!KIND2[k] || b.__ghost) return null;
  const input = () => estSpec(b.input || b.a || b.carrier, skip);
  if (skip && b.__id === skip) {
    if (k === "Mix") return estSpec(b.a, skip) || estSpec(b.b, skip);
    return catOf(k) === "source" ? null : input();
  }
  const t = toneOf(k, b); if (t) return t;
  if (k === "Mix") {
    const a = estSpec(b.a, skip), c = estSpec(b.b, skip), bal = b.balance ?? 0.5;
    if (!a || !c) return a || c;
    return a.map((v, i) => 10 * Math.log10((1 - bal) * Math.pow(10, v / 10) + bal * Math.pow(10, c[i] / 10) + 1e-9));
  }
  const inp = input(); if (!inp) return null;
  const fx = effectOf(k, b); if (fx) return inp.map((v, i) => v + fx[i]);
  if (k === "Reverb") return smoothRow(inp, 3).map((v) => v + 1);
  if (k === "Chorus" || k === "Phaser") return smoothRow(inp, 1);
  if (k === "Comp") { const m = inp.reduce((a, v) => a + v, 0) / inp.length; return inp.map((v) => m + (v - m) * 0.85); }
  return inp;
}
const estDev = (tree, skip) => { const s = estSpec(tree, skip); return s ? toDev(s) : null; };
// the displayed vessel of a new patch grows toward its estimate
let vNow = null, vFrom = null, vTo = null, vT0 = 0;
function growTo(dev) { vFrom = vNow || SILENT.dev; vTo = dev || SILENT.dev; vT0 = performance.now(); }
const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
let catPreview = null; // a catalogue kind under the pointer: the vessel shows it added
let contrib = null; // the bands an added module changed, lit briefly on the vessel


let root, well, scroller, inner, cv, ctx, plates, readout, legend, cat, choice, W = 0, H = 0, raf = 0, visible = false, edgeL, edgeR;
let audioRowCount = 1, mods = [], nodes = [], edges = [], active = -1, hoverI = -1, open = false, order = [], vesselBox = null, outJack = null, rowHeights = [];
// PATCH is either the sound in hand, or a patch being started from nothing
let mode = "patch", start = null, fresh = null, uid = 0, suggestion = null, catOpen = false, silentToast = false;
const freshAmp = { attack: 0.02, decay: 0.3, sustain: 0.7, release: 0.3 };
const reg = new Map(); // a fresh module's id → its settings object in the fresh tree
// edits to the sound in hand: turned (not yet kept), and kept; the prototype can't re-render either
const editState = new Map(); let comparing = false, editToasted = false;
const edOf = (id = A.state.inHand) => { if (!editState.has(id)) editState.set(id, { edits: new Map(), kept: new Map() }); return editState.get(id); };

// ---------------------------------------------------------------- mount
function mount(r) {
  root = r; root.style.cssText = "display:none";
  const head = el("div", { class: "pt-head" });
  well = el("div", { class: "well pt-well" });
  [cv, ctx] = A.canvas(10, 10); cv.setAttribute("aria-hidden", "true");
  plates = el("div", { class: "pt-plates", role: "listbox", tabindex: "0", "aria-label": "Modules, in signal order" });
  inner = el("div", { class: "pt-inner" }, cv, plates);
  scroller = el("div", { class: "pt-scroll" }, inner);
  readout = el("div", { class: "pt-read", "aria-live": "polite" });
  legend = el("div", { class: "pt-legend", hidden: true });
  cat = el("nav", { class: "pt-cat", "aria-label": "Catalogue of modules", hidden: true });
  // a phone's catalogue is a sheet: drag its top down, or tap outside, to put it away
  { let d = null;
    cat.addEventListener("pointerdown", (e) => { if (window.innerWidth > 700 || !e.target.closest(".pt-cat-grab, .pt-cat-top") || e.target.closest("button")) return; d = { y: e.clientY }; try { cat.setPointerCapture(e.pointerId); } catch {} cat.style.transition = "none"; });
    cat.addEventListener("pointermove", (e) => { if (d) cat.style.transform = `translateY(${Math.max(0, e.clientY - d.y)}px)`; });
    const end = (e) => { if (!d) return; const dy = e.clientY - d.y; d = null; cat.style.transition = ""; cat.style.transform = ""; if (dy > 60) setCat(false); };
    cat.addEventListener("pointerup", end); cat.addEventListener("pointercancel", end); }
  choice = el("div", { class: "pt-choice", hidden: true });
  edgeL = el("button", { class: "pt-edge l", type: "button", hidden: true, onclick: () => nudge(-1) });
  edgeR = el("button", { class: "pt-edge r", type: "button", hidden: true, onclick: () => nudge(1) });
  well.append(scroller, edgeL, edgeR, readout, legend, el("div", { class: "pt-scrim", "aria-hidden": "true", onclick: () => setCat(false) }), cat, choice);
  scroller.addEventListener("scroll", () => syncEdges(), { passive: true });
  root.append(el("div", { class: "pt" }, head, well));
  new ResizeObserver(() => { layout(); }).observe(well);
  A.on("morphend", () => { if (visible) draw(); });
  A.on("morphstart", () => { if (visible) draw(); });
  plates.addEventListener("keydown", onRackKey);
  plates.addEventListener("focus", () => { if (active < 0 && order.length) setActive(order[0], false); else setActive(active, false); });
  plates.addEventListener("blur", () => { if (hoverI < 0 && !plates.contains(document.activeElement)) { active = -1; syncActive(); } });
  inner.addEventListener("pointermove", (e) => { const q = pt(e); inner.style.cursor = vesselBox && inBox(q.x, q.y, vesselBox, 10) ? "pointer" : ""; });
  inner.addEventListener("click", (e) => { if (e.target.closest(".pl")) return; const q = pt(e); if (vesselBox && inBox(q.x, q.y, vesselBox, 10)) playIt(); });
  A.on("inhand", () => { comparing = false; build(); });
  A.on("fx", () => draw());
  A.on("play", () => loop()); A.on("stop", () => draw());
  A.cmd({ id: "pt-play", view: "patch", label: "Play the sound", key: "Space", icon: "play", run: () => playIt() });
  A.cmd({ id: "pt-first", view: "patch", label: "Go to the first module", key: "Home", icon: "patch", run: () => { plates.focus(); setActive(order[0]); } });
  A.cmd({ id: "pt-out", view: "patch", label: "Go to the output", key: "End", icon: "chev", run: () => { plates.focus(); setActive(order[order.length - 1]); } });
  A.cmd({ id: "pt-how", view: "patch", label: "How to read this patch", key: "?", icon: "notes", run: () => setOpen(!open) });
  A.cmd({ id: "pt-new", view: "patch", label: "Start from nothing", icon: "patch", run: () => enterNew() });
  A.cmd({ id: "pt-back", view: "patch", label: "Back to the sound in hand", key: "Esc", icon: "undo", run: () => exitNew() });
  A.cmd({ id: "pt-revert", view: "patch", label: "Revert the knobs you turned", icon: "undo", run: () => revertEdits() });
  // Esc leaves a knob, the catalogue sheet, then the new patch. Core handles Esc
  // before any view, so this listens first.
  document.addEventListener("keydown", (e) => {
    if (!visible || e.key !== "Escape" || document.querySelector(".palette.on")) return;
    if (sheet?.classList.contains("on")) { closeSheet(); e.stopPropagation(); e.preventDefault(); return; }
    if (e.target.closest?.(".pl")) { plates.focus({ preventScroll: true }); e.stopPropagation(); e.preventDefault(); return; }
    if (catOpen) { setCat(false); e.stopPropagation(); e.preventDefault(); return; }
    if (mode === "new") { exitNew(); e.stopPropagation(); e.preventDefault(); }
  }, true);
  build();
}
const inBox = (x, y, b, pad = 0) => x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
const pt = (e) => { const r = inner.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
// A rack wider than its well pans; each edge says how many plates lie beyond it
function beyond() {
  const l = scroller.scrollLeft, r = l + scroller.clientWidth, list = nodes.filter((n) => n.box && !n.ghost);
  return { left: list.filter((n) => n.box.x + n.box.w * 0.5 < l).sort((a, b) => b.box.x - a.box.x), right: list.filter((n) => n.box.x + n.box.w * 0.5 > r).sort((a, b) => a.box.x - b.box.x) };
}
function syncEdges() {
  if (!edgeL) return;
  const pans = scroller.scrollWidth > scroller.clientWidth + 2, b = pans ? beyond() : { left: [], right: [] };
  for (const [e, list, dir] of [[edgeL, b.left, "‹"], [edgeR, b.right, "›"]]) {
    e.hidden = !list.length;
    if (list.length) { e.innerHTML = dir === "‹" ? `<span>${dir}</span><b>${list.length}</b>` : `<b>${list.length}</b><span>${dir}</span>`; e.setAttribute("aria-label", `${list.length} more module${list.length === 1 ? "" : "s"} ${dir === "‹" ? "to the left" : "to the right"}`); }
  }
}
function nudge(dir) {
  const b = beyond(), n = (dir < 0 ? b.left : b.right)[0]; if (!n) return;
  scroller.scrollTo({ left: n.box.x + n.box.w / 2 - scroller.clientWidth / 2, behavior: A.reduced ? "auto" : "smooth" });
}
function playIt() {
  if (mode === "new") { if (!silentToast) { silentToast = true; A.toast({ text: "Nothing to hear yet: a new patch is visual only here." }); } return; }
  A.audio.toggle(A.inHand());
}

// ---------------------------------------------------------------- model of the drawing
function labelOf(m) {
  if (m.kind === "Op") return { name: String(m.params.kind || "shape"), sub: "shape cv" };
  if (m.kind === "Pair") return { name: String(m.params.kind || "combine"), sub: "combine cv" };
  if (m.kind === "AudioIn") return { name: "audio in", sub: (DEVICES.find(([k]) => k === m.params.device) || DEVICES[2])[2] };
  let sub = "";
  if (m.kind === "Filter") sub = FILTER_KIND[m.params.kind] || String(m.params.kind || "");
  else for (const k of SUBKEY) if (typeof m.params[k] === "string" && m.params[k] !== "None") { sub = m.params[k].toLowerCase(); break; }
  return { name: NAME[m.kind] || m.label.toLowerCase(), sub };
}
function knobsOf(m) {
  // shape cv's p0/p1 by its kind (term.rs `ModOp::param_sites`); combine cv has none
  if (m.kind === "Op") { const names = OP_PARAMS[m.params.kind] || []; return names.map((k, j) => ({ k, v: m.params["p" + j], site: "p" + j })).filter((k) => typeof k.v === "number"); }
  if (m.kind === "Pair") return [];
  return Object.entries(m.params).filter(([k, v]) => typeof v === "number" && k !== "mod_depth").slice(0, 3).map(([k, v]) => ({ k, v, site: k }));
}
const fmtV = (k, v) => (INT.has(k) ? (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v) : v.toFixed(2));
function saysOf(n) {
  if (n.amp) return AMP_SAYS;
  if (n.ghost) return suggestion?.why || "";
  if (n.m.kind === "AudioIn") return MODE_SAYS[n.m.params.mode] || SAYS.AudioIn;
  if (n.m.kind === "Op") return OP_SAYS[n.m.params.kind] || "Bends a modulator on its way to the knob.";
  if (n.m.kind === "Pair") return `Combines two movements into one, by ${n.m.params.kind}.`;
  return SAYS[n.m.kind] || "";
}
// a knob's value as shown: as made, as kept, or as turned
function valOf(n, kn) {
  if (mode === "new" || n.ghost) return kn.v;
  const e = edOf(), key = `${n.i}:${kn.site}`;
  if (comparing) return e.kept.has(key) ? e.kept.get(key) : kn.v;
  return e.edits.has(key) ? e.edits.get(key) : e.kept.has(key) ? e.kept.get(key) : kn.v;
}

// ---- the fresh tree: canonical-shaped JSON, as the engine's trees are
const kindOf = (node) => Object.keys(node)[0];
function make(kind, ghost, rootNode) {
  const body = JSON.parse(JSON.stringify(DEFAULTS[kind] || {}));
  body.__id = "m" + ++uid; if (ghost) body.__ghost = true;
  if (kind === "AudioIn") body.device = lastDevice(rootNode) || "in1";
  return { [kind]: body };
}
function walkBodies(node, fn) {
  if (!node || typeof node !== "object") return;
  const k = kindOf(node); if (!KIND2[k]) return;
  const b = node[k]; fn(b, k);
  for (const v of Object.values(b)) if (v && typeof v === "object" && KIND2[kindOf(v)]) walkBodies(v, fn);
}
function lastDevice(rootNode) { let d = null; walkBodies(rootNode, (b, k) => { if (k === "AudioIn" && !b.__ghost) d = b.device; }); return d; }
function kindsIn(rootNode) { const s = []; walkBodies(rootNode, (b, k) => { if (!b.__ghost && k !== "Mix") s.push(k); }); return s; }
// the leaf at the end of the input chain (following input, then a), with its parent
function firstLeaf(node) {
  let parent = null, key = null, cur = node;
  for (;;) {
    const b = cur[kindOf(cur)];
    const nxt = ["input", "a", "carrier"].find((k) => b[k] && typeof b[k] === "object");
    if (!nxt) return { parent, key };
    parent = b; key = nxt; cur = b[nxt];
  }
}
// the audio module a new modulator should move: a filter first, else the latest stage
function modHost(node) {
  const c = [];
  walkBodies(node, (b, k) => { if (k !== "Mix" && k !== "AudioIn" && catOf(k) !== "mod" && KIND2[k] && !A.MOD_KINDS.has(k) && !(b.modulation && typeof b.modulation === "object")) c.push([b, k]); });
  return (c.find(([, k]) => k === "Filter") || c[0] || [null])[0];
}
function insert(rootNode, kind, ghost) {
  const node = make(kind, ghost, rootNode), cat = catOf(kind);
  if (!rootNode) return cat === "mod" ? null : node;
  if (cat === "source") {
    const mix = (a) => ({ Mix: Object.assign({ balance: 0.5, __id: "m" + ++uid }, ghost ? { __ghost: true } : {}, { a, b: node }) });
    const { parent, key } = firstLeaf(rootNode);
    if (!parent) return mix(rootNode);
    parent[key] = mix(parent[key]); return rootNode;
  }
  if (cat === "mod") {
    const host = modHost(rootNode); if (!host) return null;
    host.modulation = node; if (!(typeof host.mod_depth === "number" && host.mod_depth > 0)) host.mod_depth = 0.4;
    return rootNode;
  }
  node[kind].input = rootNode; return node;
}
// ---- taking modules out: its input takes its place, a mix left with one side
// becomes that side, a modulator leaves its host unmodulated
function removeFrom(rootNode, id) {
  if (!rootNode) return null;
  const take = (node) => { const k = kindOf(node), b = node[k]; if (b.input && typeof b.input === "object") return b.input; if (k === "Mix") return null; return null; };
  const rk = kindOf(rootNode);
  if (rootNode[rk].__id === id) return take(rootNode);
  let done = false;
  const visit = (node) => {
    if (done || !node || typeof node !== "object") return;
    const k = kindOf(node); if (!KIND2[k]) return; const b = node[k];
    for (const [key, v] of Object.entries(b)) {
      if (done || !v || typeof v !== "object" || !KIND2[kindOf(v)]) continue;
      if (v[kindOf(v)].__id === id) {
        if (key === "modulation") b.modulation = "None";
        else { const r = take(v); if (r) b[key] = r; else if (k === "Mix") b[key] = null; else delete b[key]; }
        done = true; return;
      }
      visit(v);
    }
  };
  visit(rootNode);
  return settleMix(rootNode);
}
function settleMix(node) {
  if (!node || typeof node !== "object") return node;
  const k = kindOf(node); if (!KIND2[k]) return node; const b = node[k];
  for (const [key, v] of Object.entries(b)) if (v && typeof v === "object" && KIND2[kindOf(v)]) b[key] = settleMix(v);
  if (k === "Mix") { if (!b.a && !b.b) return null; if (!b.a) return b.b; if (!b.b) return b.a; }
  return node;
}
function dissolve(els, done) {
  if (A.reduced || !els.length) { done(); return; }
  els.forEach((e, j) => e.animate([{ opacity: 1, transform: "scale(1)", filter: "blur(0)" }, { opacity: 0, transform: "scale(.9) translateY(6px)", filter: "blur(3px)" }], { duration: 260, delay: j * 40, easing: "ease-in", fill: "forwards" }));
  setTimeout(done, 260 + (els.length - 1) * 40);
}
function changedBands(before) {
  const after = estSpec(fresh);
  if (!before && !after) return;
  contrib = { t0: performance.now(), w: (after || before).map((v, i) => Math.min(1, Math.abs((after ? after[i] : -90) - (before ? before[i] : -90)) / 9)) };
}
function removeModule(n) {
  if (mode !== "new" || !n || n.amp) return;
  if (n.ghost) { skipSuggestion(); return; }
  const id = n.m.params.__id, name = labelOf(n.m).name, keep = JSON.parse(JSON.stringify(fresh)), keepStart = start, before = estSpec(fresh);
  closeSheet();
  dissolve([n.el], () => {
    const had = kindsIn(fresh).length;
    fresh = removeFrom(fresh, id); indexFresh(); skipped.clear(); build(); growTo(estDev(fresh)); changedBands(before); loop();
    plates.focus({ preventScroll: true });
    const gone = had - (fresh ? kindsIn(fresh).length : 0) - 1; // modulators that moved it leave with it
    A.toast({ text: !fresh ? `Removed ${name}. The patch is empty.` : gone > 0 ? `Removed ${name}, and the ${gone === 1 ? "modulator" : gone + " modulators"} moving it.` : `Removed ${name}.`, undo: () => { fresh = keep; start = keepStart; indexFresh(); build(); growTo(estDev(fresh)); loop(); } });
  });
}
function clearNew() {
  if (mode !== "new" || !fresh) return;
  const keep = JSON.parse(JSON.stringify(fresh)), keepStart = start;
  closeSheet(); setCat(false);
  dissolve(nodes.filter((n) => !n.amp && n.el).map((n) => n.el), () => {
    fresh = null; start = null; skipped.clear(); indexFresh(); build(); growTo(null); loop();
    A.toast({ text: "Cleared the patch.", undo: () => { fresh = keep; start = keepStart; indexFresh(); build(); growTo(estDev(fresh)); loop(); } });
  });
}
function skipSuggestion() {
  if (!suggestion) return;
  skipped.add(suggestion.kind); closeSheet(); build();
  const g = nodes.find((n) => n.ghost && n.m.kind !== "Mix");
  if (g) { g.el.classList.remove("pulse"); void g.el.offsetWidth; g.el.classList.add("pulse"); }
  else A.toast({ text: "No more suggestions: pick from the catalogue." });
}

function indexFresh() { reg.clear(); walkBodies(fresh, (b) => reg.set(b.__id, b)); }
// The model's suggestion for the next module: from the presets, weighted by what
// it thinks you like once it has fitted; otherwise by how common each kind is.
const PRESET_KINDS = A.presets.map((p) => ({ p, kinds: new Set(A.modulesOf(p.tree).map((m) => m.kind)) }));
const skipped = new Set(); // suggestions put aside until the next module is added
function suggest() {
  if (mode !== "new" || !start) return null;
  const fitted = A.model.fitted(), w = (p) => (fitted ? A.model.like(p) : 1);
  const have = kindsIn(fresh);
  if (start === "process" && !have.includes("AudioIn") && !skipped.has("AudioIn")) return { kind: "AudioIn", why: "where a sound comes in" };
  const sources = CAT[0][2].filter((k) => k !== "AudioIn" && !skipped.has(k));
  if (!have.length && !sources.length) return null;
  if (!have.length) {
    const score = new Map(sources.map((k) => [k, 0]));
    for (const { p, kinds } of PRESET_KINDS) for (const k of sources) if (kinds.has(k)) score.set(k, score.get(k) + w(p));
    const kind = [...score].sort((a, b) => b[1] - a[1])[0][0];
    return { kind, why: fitted ? "most sounds you'd like start here" : "most presets start here" };
  }
  const hasSource = have.some((k) => catOf(k) === "source");
  const host = fresh && modHost(JSON.parse(JSON.stringify(fresh)));
  const cand = CAT.flatMap(([c, , ks]) => ks.map((k) => [k, c])).filter(([k, c]) => k !== "AudioIn" && !skipped.has(k) && !have.includes(k) && !(c === "source" && hasSource) && !(c === "mod" && !host));
  if (!cand.length) return null;
  const last = have[have.length - 1];
  let best = null;
  for (const [k] of cand) {
    let s = 0, with_ = 0, both = 0;
    for (const { p, kinds } of PRESET_KINDS) {
      const overlap = have.filter((h) => kinds.has(h)).length;
      if (kinds.has(k)) s += w(p) * (1 + overlap);
      if (kinds.has(last) || last === "AudioIn") { with_++; if (kinds.has(k)) both++; }
    }
    if (!best || s > best.s) best = { kind: k, s, pct: with_ ? Math.round((100 * both) / with_) : 0 };
  }
  const lastName = last === "AudioIn" ? "an input" : "a " + (NAME[last] || last);
  void lastName;
  return { kind: best.kind, why: fitted ? "sounds you'd like have one" : `in ${best.pct}% of similar presets` };
}
function previewTree() {
  suggestion = suggest();
  if (!suggestion) return fresh;
  const t = insert(fresh ? JSON.parse(JSON.stringify(fresh)) : null, suggestion.kind, true);
  return t || fresh;
}
function walk(rootNode) {
  const out = [];
  const w = (node, depth, role, parent) => {
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if (!KIND2[k]) continue;
      const params = {}, kids = [];
      for (const [pk, pv] of Object.entries(v || {})) {
        if (pv && typeof pv === "object" && Object.keys(pv).some((x) => KIND2[x])) kids.push([pk, pv]);
        else if (typeof pv !== "object") params[pk] = pv;
      }
      const m = { i: out.length, kind: k, label: KIND2[k], params, depth, role, parent, mod: A.MOD_KINDS.has(k) };
      out.push(m);
      for (const [pk, pv] of kids) w(pv, depth + 1, pk, m.i);
    }
  };
  w(rootNode, 0, "out", -1);
  return out;
}

// ---------------------------------------------------------------- build
function build() {
  if (sheetN && !sheetKeep) closeSheet();
  if (mode === "new") { buildFrom(walk(previewTree()), freshAmp); growTo(estDev(fresh)); }
  else { suggestion = null; buildFrom(A.modulesOf(A.inHand().tree), A.inHand().tree.amp); }
  renderHead(); renderPlates(); renderCatalogue(); renderChoice();
  well.classList.toggle("new", mode === "new");
  active = -1; hoverI = -1;
  layout(); buildLegend(); syncActive();
}
function buildFrom(modsIn, ampParams) {
  mods = modsIn;
  const kids = mods.map(() => []);
  for (const m of mods) if (m.parent >= 0) kids[m.parent].push(m.i);
  // a module is CV if it hangs from a "modulation" socket, or from a module that does
  const isCv = mods.map(() => false);
  for (const m of mods) isCv[m.i] = m.role === "modulation" || (m.parent >= 0 && isCv[m.parent]);
  nodes = mods.map((m) => ({ m, i: m.i, cv: isCv[m.i], kids: kids[m.i], col: 0, row: 0, ghost: !!m.params.__ghost }));
  // audio: a tidy tree, the root at column 0 and the sources to the left
  let nextRow = 0;
  const audioKids = (n) => n.kids.map((i) => nodes[i]).filter((c) => !c.cv).sort((a, b) => (ROLE_ORDER[a.m.role] ?? 3) - (ROLE_ORDER[b.m.role] ?? 3));
  const placeA = (n, col) => {
    n.col = col;
    const ak = audioKids(n);
    if (!ak.length) { n.row = nextRow++; return; }
    ak.forEach((c) => placeA(c, col + 1));
    const two = ak.filter((c) => ["a", "b", "carrier", "modulator"].includes(c.m.role));
    n.row = two.length >= 2 ? (two[0].row + two[1].row) / 2 : ak[0].row;
  };
  const rootN = nodes.find((n) => n.m.parent < 0);
  if (rootN) placeA(rootN, 0);
  const audioRows = Math.max(1, nextRow); audioRowCount = audioRows;
  // CV: each modulator's subtree sits in a band under the audio, below its host
  const used = new Set();
  const hosts = nodes.filter((n) => !n.cv && n.kids.some((i) => nodes[i].cv)).sort((a, b) => a.col - b.col);
  for (const h of hosts) for (const ci of h.kids.filter((i) => nodes[i].cv)) {
    const sub = []; let r = 0;
    const placeC = (n, col) => { n.col = col; sub.push(n); const ck = n.kids.map((i) => nodes[i]); if (!ck.length) { n.rrow = r++; return; } ck.forEach((c) => placeC(c, col + 1)); n.rrow = ck[0].rrow; };
    placeC(nodes[ci], h.col);
    let base = audioRows;
    const free = (b) => sub.every((n) => !used.has(`${n.col}:${b + n.rrow}`));
    while (!free(base)) base++;
    for (const n of sub) { n.row = base + n.rrow; used.add(`${n.col}:${n.row}`); }
  }
  // the amp stage: in the tree as `amp`, the last stage of every voice
  nodes.push({ amp: true, i: "amp", col: -1, row: rootN ? rootN.row : 0, params: ampParams, kids: rootN ? [rootN.i] : [], cv: false });
  // edges
  edges = [];
  for (const n of nodes) {
    if (n.amp) { if (rootN) edges.push({ from: rootN, to: n, kind: "audio", role: "input", ghost: rootN.ghost }); continue; }
    for (const ci of n.kids) {
      const c = nodes[ci];
      edges.push({ from: c, to: n, kind: c.cv ? (n.cv ? "cvlink" : "cv") : "audio", role: c.m.role, depth: n.m.params.mod_depth, ghost: c.ghost || n.ghost });
    }
  }
  // the knob each modulator moves: its host's first turning knob
  for (const e of edges) if (e.kind === "cv") { const ks = knobsOf(e.to.m).filter((k) => !INT.has(k.k) && k.v >= 0 && k.v <= 1); e.target = ks[0]?.site || null; e.hz = rateOf(e.from); e.shape = shapeKind(e.from); }
  for (const e of edges) if (e.kind === "cvlink") { e.hz = rateOf(e.from); }
}
// how fast a modulator moves, from its own rate knob as set (0…1 → 0.08…10 Hz)
function rateOf(n) {
  const p = n.m.params;
  if (typeof p.rate === "number") return 0.08 * Math.pow(2, p.rate * 7);
  if (n.m.kind === "Env") return 0.9;
  if (n.m.kind === "Follow") return 1.6;
  const kid = n.kids.map((i) => nodes[i]).find((c) => c.cv);
  return kid ? rateOf(kid) : 1;
}
function shapeKind(n) {
  if (["Lfo", "Steps", "Rand", "Env", "Follow", "Euclid"].includes(n.m.kind)) return n.m.kind;
  const kid = n.kids.map((i) => nodes[i]).find((c) => c.cv);
  return kid ? shapeKind(kid) : "Lfo";
}
// where the modulator takes the knob now, −1…1
function shapeAt(kind, ph) {
  const f = ph - Math.floor(ph);
  if (kind === "Steps") return Math.sin(2 * Math.PI * Math.floor(f * 8) / 8);
  if (kind === "Rand" || kind === "Euclid") { const s = Math.floor(ph * (kind === "Euclid" ? 4 : 1)); const r = Math.sin(s * 12.9898) * 43758.5453; return (r - Math.floor(r)) * 2 - 1; }
  if (kind === "Env") return (f < 0.08 ? f / 0.08 : Math.exp(-(f - 0.08) * 5)) * 2 - 1;
  if (kind === "Follow") return Math.abs(Math.sin(2 * Math.PI * f)) * Math.abs(Math.sin(Math.PI * ph * 0.37)) * 2 - 1;
  return Math.sin(2 * Math.PI * f);
}

// ---------------------------------------------------------------- head, edit bar, catalogue, choice
function renderHead() {
  const head = root.querySelector(".pt-head");
  const how = el("button", { class: "disclose", id: "pt-how", "aria-expanded": String(open), "aria-controls": "pt-legend", onclick: () => setOpen(!open), html: `${icon("chev")}How to read this` });
  if (mode === "new") {
    const real = mods.filter((m) => !m.params.__ghost), nC = real.filter((m, i) => nodes[i]?.cv).length, nA = real.length - nC;
    head.replaceChildren(
      el("div", { class: "pt-headtext" },
        el("div", { class: "pf-eyebrow" }, el("span", { class: "cap" }, "Patch"), el("span", { class: "cap", style: "color:var(--silk-mute)" }, "· from nothing")),
        el("h1", { class: "display" }, "New patch"),
        el("p", { class: "blurb" }, `${nA} module${nA === 1 ? "" : "s"}${nC ? " · " + nC + " modulator" + (nC === 1 ? "" : "s") : ""} · nothing to hear yet`)),
      el("div", { class: "pt-headacts" },
        el("button", { class: "btn pt-add", "aria-expanded": String(catOpen), "aria-controls": "pt-cat", onclick: () => setCat(!catOpen), html: `${icon("patch")}Add module` }),
        fresh ? el("button", { class: "btn ghost pt-clear", "aria-label": "Clear the patch", onclick: () => clearNew(), html: `${icon("x")}Clear` }) : "",
        el("button", { class: "btn ghost", onclick: () => exitNew(), html: `${icon("undo")}Back to ${A.inHand().name}<kbd>Esc</kbd>` }),
        how));
    return;
  }
  const p = A.inHand();
  const nA = mods.filter((m, i) => !nodes[i].cv).length, nC = mods.length - nA;
  head.replaceChildren(
    el("div", { class: "pt-headtext" },
      el("div", { class: "pf-eyebrow" }, el("span", { class: "cap" }, "Patch"), el("span", { class: "cap", style: "color:var(--silk-mute)" }, "· " + p.category)),
      el("h1", { class: "display" }, p.name),
      el("p", { class: "blurb" }, `${nA} module${nA === 1 ? "" : "s"} · ${nC ? nC + " modulator" + (nC === 1 ? "" : "s") : "no modulators"}, in signal order`)),
    el("div", { class: "pt-headacts" },
      el("div", { class: "pt-editbar", id: "pt-editbar", role: "group", "aria-label": "Your edits", hidden: true }),
      el("button", { class: "btn ghost", "aria-label": "Start a patch from nothing", onclick: () => enterNew(), html: `${icon("patch")}New patch` }),
      how));
  syncEditBar();
}
function syncEditBar() {
  const bar = root.querySelector("#pt-editbar"); if (!bar) return;
  const n = edOf().edits.size;
  bar.hidden = n === 0 && !comparing;
  if (bar.hidden) return;
  bar.replaceChildren(
    el("span", { class: "mono" }, comparing ? "as it was" : `${n} change${n === 1 ? "" : "s"}`),
    el("span", { class: "pt-demo mono", title: "This demo plays recordings of the presets, so an edit here changes the picture, not the sound. In the app, the patch re-renders as you turn." }, "not heard in the demo"),
    el("button", { "aria-pressed": String(comparing), title: "Show the values before you turned them", onclick: () => { comparing = !comparing; refreshKnobs(); syncEditBar(); } }, "Compare"),
    el("span", { class: "sep", "aria-hidden": "true" }, "·"),
    el("button", { onclick: () => keepEdits() }, "Keep"),
    el("span", { class: "sep", "aria-hidden": "true" }, "·"),
    el("button", { onclick: () => revertEdits() }, "Revert"));
}
function keepEdits() { const e = edOf(); for (const [k, v] of e.edits) e.kept.set(k, v); e.edits.clear(); comparing = false; refreshKnobs(); syncEditBar(); }
function revertEdits() { const e = edOf(); e.edits.clear(); comparing = false; refreshKnobs(); syncEditBar(); }
function renderCatalogue() {
  cat.hidden = mode !== "new"; cat.id = "pt-cat";
  cat.classList.toggle("open", catOpen);
  if (mode !== "new") return;
  cat.replaceChildren(
    el("div", { class: "pt-cat-grab", "aria-hidden": "true" }),
    el("div", { class: "pt-cat-top" }, el("span", { class: "pt-cat-title cap" }, "Add a module"), el("button", { class: "pt-cat-x", "aria-label": "Close the catalogue", onclick: () => setCat(false), html: A.icon("x") })),
    ...CAT.map(([g, label, kinds]) => el("div", { class: "pt-cat-g", role: "group", "aria-label": label },
    el("div", { class: "pt-cat-h", html: `${gsvg(g)}<span>${label}</span>` }),
    ...kinds.map((k) => el("button", { class: "pt-cat-it", "data-kind": k, "aria-label": `Add ${NAME[k] || k}`, onclick: () => add(k), onpointerenter: () => previewCat(k), onfocus: () => previewCat(k), onpointerleave: () => previewCat(null), onblur: () => previewCat(null) },
      el("span", { class: "ic", html: kindIcon(k) }), el("span", {}, NAME[k] || k), suggestion && suggestion.kind === k ? el("i", { class: "sug", title: "The model suggests this one" }) : "")))));
}
function previewCat(k) {
  if (!k) { catPreview = null; syncActive(); return; }
  const t = catOf(k) === "mod" ? null : insert(fresh ? JSON.parse(JSON.stringify(fresh)) : null, k, false);
  catPreview = t ? estDev(t) : null;
  readout.replaceChildren(el("span", { class: "pt-read-name" }, NAME[k] || k));
  loop(); draw();
}
function setCat(on) { catOpen = on; cat.classList.toggle("open", on); root.querySelector(".pt-scrim")?.classList.toggle("on", on); const b = root.querySelector(".pt-add"); if (b) b.setAttribute("aria-expanded", String(on)); }
function renderChoice() {
  choice.hidden = !(mode === "new" && !start);
  if (choice.hidden) return;
  const opt = (k, ic, t, s) => el("button", { class: "pt-choice-btn", "data-start": k, onclick: () => { start = k; build(); focusGhost(); } }, el("span", { class: "ic", html: ic }), el("b", {}, t), el("span", {}, s));
  choice.replaceChildren(
    el("div", { class: "cap" }, "Start from nothing"),
    el("div", { class: "pt-choice-row" },
      opt("synth", gsvg("source"), "Build a synth", "Oscillators, filters, envelopes"),
      opt("process", A.icon("input"), "Process a sound", "A mic, an instrument, the DAW track")),
    el("p", { class: "pt-choice-note" }, "or pick any module from the catalogue"));
}
function focusGhost() { const g = nodes.find((n) => n.ghost && !(n.m.kind === "Mix")); if (g) { plates.focus({ preventScroll: true }); setActive(g.i); } }

// ---------------------------------------------------------------- new patch: enter, add, leave
function enterNew() { mode = "new"; comparing = false; if (!fresh) start = null; build(); if (!start) choice.querySelector("button")?.focus(); else focusGhost(); }
function exitNew() { if (mode !== "new") return; mode = "patch"; setCat(false); build(); plates.focus({ preventScroll: true }); }
function add(kind) {
  if (!start) start = kind === "AudioIn" ? "process" : "synth";
  if (catOf(kind) === "mod" && (!fresh || !modHost(JSON.parse(JSON.stringify(fresh))))) { A.toast({ text: "A modulator needs something to move: add a source or a filter first." }); return; }
  const before = estSpec(fresh);
  const t = insert(fresh, kind, false); if (!t) return;
  fresh = t; skipped.clear(); indexFresh(); build();
  const after = estSpec(fresh);
  if (after) { const mx = Math.max(...after); contrib = { t0: performance.now(), w: after.map((v, i) => before ? Math.min(1, Math.abs(v - before[i]) / 9) : v > mx - 30 ? 0.8 : 0) }; }
  const n = nodes.slice().reverse().find((x) => x.m && x.m.kind === kind && !x.ghost);
  if (n) {
    n.el.classList.remove("pulse"); void n.el.offsetWidth; n.el.classList.add("pulse");
    if (scroller.scrollWidth > scroller.clientWidth) n.el.scrollIntoView({ inline: "center", block: "nearest", behavior: A.reduced ? "auto" : "smooth" });
    setActive(n.i, false);
    setTimeout(() => { if (active === n.i && hoverI !== n.i && document.activeElement?.closest?.(".pl") == null) setActive(-1); }, 1500);
  }
  if (catOpen && window.innerWidth <= 700) setCat(false);
}
function commitGhost() { if (suggestion) add(suggestion.kind); focusGhost(); }

// ---------------------------------------------------------------- plates
let ghostSig = "", ghostT0 = -1e9;
function renderPlates() {
  plates.replaceChildren();
  for (const n of nodes) plates.append(plateOf(n));
  syncShared();
  const g = nodes.find((n) => n.ghost && n.m.kind !== "Mix");
  const sig = g ? `${g.m.kind}:${g.m.parent}:${g.m.role}` : "";
  if (sig && sig !== ghostSig && !A.reduced) {
    ghostT0 = performance.now();
    for (const n of nodes) if (n.ghost) n.el.classList.add("grow", n.cv ? "from-top" : "from-right");
  }
  ghostSig = sig;
}
function plateOf(n) {
  if (n.amp) {
    const a = n.params;
    const [c, x] = A.canvas(96, 30);
    drawAdsr(x, 96, 30, a, false); n.adsr = [c, x];
    const pl = el("div", { class: "pl amp", role: "option", id: "pl-amp", "data-i": "amp", "aria-selected": "false",
      "aria-label": `amp, envelope: attack ${a.attack.toFixed(2)}, decay ${a.decay.toFixed(2)}, sustain ${a.sustain.toFixed(2)}, release ${a.release.toFixed(2)}` },
      el("div", { class: "pl-top" }, el("span", { class: "pl-name" }, "amp"), el("span", { class: "pl-sub" }, "envelope")),
      el("div", { class: "pl-adsr" }, c),
      el("div", { class: "pl-adsrv" }, ...["attack", "decay", "sustain", "release"].map((k) => el("span", {}, el("b", {}, a[k] < 1 ? a[k].toFixed(2).replace(/^0/, "") : a[k].toFixed(1)), SHORT[k] || k.slice(0, 3)))));
    wirePlate(pl, n); n.el = pl; n.h = 104; return pl;
  }
  const { name, sub } = labelOf(n.m), ks = knobsOf(n.m);
  if (n.ghost) {
    const mixGhost = n.m.kind === "Mix";
    const pl = el("div", { class: `pl ghost${mixGhost ? " ghost-mix" : ""}`, role: "option", id: "pl-" + n.i, "data-i": n.i, "aria-selected": "false",
      "aria-label": mixGhost ? "mix, added with the suggestion" : `Suggested: ${name}. ${suggestion?.why || ""}. Press Enter to add it.` },
      el("div", { class: "pl-top" }, el("span", { class: "pl-name" }, name)),
      el("div", { class: "pl-sug" }, mixGhost ? "joins them" : "suggested"),
      el("div", { class: "pl-why" }, mixGhost ? "two sources meet here" : suggestion?.why || ""));
    pl.addEventListener("click", (e) => { if (e.target.closest(".pl-rm")) return; commitGhost(); });
    if (!mixGhost) pl.append(el("button", { class: "pl-rm", "aria-label": `Skip this suggestion (${name})`, title: "Not this one", onclick: (e) => { e.stopPropagation(); skipSuggestion(); }, html: A.icon("x") }));
    wirePlate(pl, n); n.el = pl; n.h = 104; n.kn = {}; return pl;
  }
  const pl = el("div", { class: `pl${n.cv ? " cv" : ""}${n.m.kind === "AudioIn" ? " ain" : ""}`, role: "option", id: "pl-" + n.i, "data-i": n.i, "aria-selected": "false",
    "aria-label": `${name}${sub ? ", " + sub : ""}${ks.length ? ": " + ks.map((k) => `${k.k} ${fmtV(k.k, k.v)}`).join(", ") : ""}` },
    el("div", { class: "pl-top" }, el("span", { class: "pl-name" }, name), sub ? el("span", { class: "pl-sub", title: sub }, sub) : "", el("span", { class: "pl-ed", "aria-hidden": "true" }, "turned")));
  if (mode === "new") pl.append(el("button", { class: "pl-rm", "aria-label": `Remove ${name}`, title: "Remove · Delete", onclick: (e) => { e.stopPropagation(); removeModule(n); }, html: A.icon("x") }));
  n.kn = {};
  if (n.m.kind === "AudioIn") {
    const groups = [...new Set(DEVICES.map((d) => d[3]))];
    const sel = el("select", { class: "pl-dev", "aria-label": "Input device (illustrative here)" },
      ...groups.map((g) => el("optgroup", { label: g }, ...DEVICES.filter((d) => d[3] === g).map(([k, label, short]) => el("option", { value: k, selected: n.m.params.device === k, "aria-label": label }, short)))));
    sel.addEventListener("change", () => { setParam(n, "device", sel.value); const id = n.m.params.__id; build(); const again = nodes.find((x) => x.m?.params.__id === id); if (again) { setActive(again.i, false); again.el.querySelector("select")?.focus(); } });
    const modes = el("div", { class: "pl-modes", role: "group", "aria-label": "What the input does" },
      ...MODES.map(([k, label, says]) => {
        const b = el("button", { class: "pl-mode", "aria-pressed": String(n.m.params.mode === k), title: says }, label);
        b.addEventListener("click", (e) => { e.stopPropagation(); setParam(n, "mode", k); for (const x of modes.children) x.setAttribute("aria-pressed", String(x === b)); if (active === n.i) syncActive(); });
        b.addEventListener("pointerenter", () => readout.replaceChildren(el("span", { class: "pt-read-name" }, label), el("span", { class: "pt-read-says" }, says)));
        b.addEventListener("focus", () => readout.replaceChildren(el("span", { class: "pt-read-name" }, label), el("span", { class: "pt-read-says" }, says)));
        return b;
      }));
    const gain = ks.find((k) => k.k === "gain");
    pl.append(el("div", { class: "pl-shared", hidden: true }), el("div", { class: "pl-inrow" }, sel, gain ? knobCell(n, gain, name) : ""), modes);
    n.h = matchMedia("(pointer: coarse)").matches ? 186 : 150;
    wirePlate(pl, n); n.el = pl; return pl;
  } else n.h = n.cv ? 92 : 104;
  if (ks.length) {
    const row = el("div", { class: "pl-knobs" });
    for (const k of ks) row.append(knobCell(n, k, name));
    pl.append(row);
  }
  wirePlate(pl, n); n.el = pl; return pl;
}
function knobCell(n, k, name) {
  const unit = !INT.has(k.k) && k.v >= 0 && k.v <= 1;
  const cell = el("div", { class: "pk", role: "slider", tabindex: "-1", "aria-label": `${name} ${k.k}`, "aria-valuemin": unit ? "0" : "-8", "aria-valuemax": unit ? "1" : "16" });
  let x = null, vEl, chip = null;
  if (unit) { const [c, cx] = A.canvas(22); x = cx; cell.append(c); }
  else { chip = el("span", { class: "pk-chip" }); cell.append(chip); }
  vEl = el("span", { class: "pk-v" }); cell.append(vEl, el("span", { class: "pk-n" }, SHORT[k.k] || k.k));
  const kn = { ...k, unit, x, vEl, chip, cell };
  n.kn[k.site] = kn;
  paintKnob(n, kn);
  // drag, wheel or arrows: a design of turning; the prototype can't re-render
  let drag = null;
  let tap = null;
  cell.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    if (e.pointerType === "touch" && TOUCHY()) { tap = { x: e.clientX, y: e.clientY }; return; } // too small to turn by finger: open the module instead
    try { cell.setPointerCapture(e.pointerId); } catch {} cell.tabIndex = 0; cell.focus({ preventScroll: true }); drag = { y: e.clientY, v: valOf(n, kn) };
  });
  cell.addEventListener("pointerup", (e) => { if (!tap) return; const moved = Math.hypot(e.clientX - tap.x, e.clientY - tap.y); tap = null; if (moved < 10) openSheet(n, k.site); });
  cell.addEventListener("pointermove", (e) => { if (!drag) return; const d = (drag.y - e.clientY) * (e.shiftKey ? 0.2 : 1); turn(n, kn, unit ? drag.v + d / 150 : drag.v + Math.round(d / 14)); });
  const end = () => { drag = null; }; cell.addEventListener("pointerup", end); cell.addEventListener("pointercancel", end);
  cell.addEventListener("dblclick", (e) => { e.stopPropagation(); turn(n, kn, k.v); });
  cell.addEventListener("keydown", (e) => {
    const v = valOf(n, kn), step = unit ? (e.shiftKey ? 0.005 : 0.03) : 1;
    if (e.key === "ArrowUp") turn(n, kn, v + step);
    else if (e.key === "ArrowDown") turn(n, kn, v - step);
    else if (e.key === "ArrowRight" || e.key === "ArrowLeft") { const cells = [...n.el.querySelectorAll(".pk")]; const j = cells.indexOf(cell) + (e.key === "ArrowRight" ? 1 : -1); if (cells[j]) { cell.tabIndex = -1; cells[j].tabIndex = 0; cells[j].focus(); } }
    else if (e.key === "Enter") { plates.focus({ preventScroll: true }); }
    else if (e.key === "Tab") { cell.tabIndex = -1; return; }
    else return;
    e.preventDefault(); e.stopPropagation();
  });
  cell.addEventListener("blur", () => { cell.tabIndex = -1; });
  return cell;
}
function turn(n, kn, v) {
  v = kn.unit ? Math.max(0, Math.min(1, v)) : Math.max(-8, Math.min(16, Math.round(v)));
  if (mode === "new") { setParam(n, kn.site, v); kn.v = v; paintKnob(n, kn); return; }
  comparing = false;
  const e = edOf(), key = `${n.i}:${kn.site}`;
  const base = e.kept.has(key) ? e.kept.get(key) : kn.v;
  if (Math.abs(v - base) < 1e-4) e.edits.delete(key); else e.edits.set(key, v);
  paintKnob(n, kn); syncEdited(n); syncEditBar();
  if (!editToasted && e.edits.size) { editToasted = true; A.toast({ text: "In the app, the patch re-renders as you turn. This prototype can't." }); }
}
function setParam(n, k, v) {
  n.m.params[k] = v;
  if (mode === "new") { const b = reg.get(n.m.params.__id); if (b) b[k] = v; }
}
function paintKnob(n, kn, ghostV = null, range = null) {
  const v = valOf(n, kn);
  kn.vEl.textContent = kn.unit ? fmtV(kn.k, v) : "";
  if (kn.chip) kn.chip.textContent = fmtV(kn.k, v);
  kn.cell.setAttribute("aria-valuenow", String(kn.unit ? +v.toFixed(2) : v));
  kn.cell.classList.toggle("moved", mode === "patch" && !comparing && edOf().edits.has(`${n.i}:${kn.site}`));
  if (kn.x) drawArc(kn.x, 22, v, ghostV, range);
}
function refreshKnobs() { for (const n of nodes) { if (!n.kn) continue; for (const kn of Object.values(n.kn)) paintKnob(n, kn); syncEdited(n); } draw(); }
function syncEdited(n) { if (!n.el || n.amp) return; const e = edOf(); n.el.classList.toggle("edited", mode === "patch" && !comparing && [...e.edits.keys()].some((k) => k.startsWith(n.i + ":"))); }
// inputs sharing a device: each says so, and approaching one lights the other
function sharedOf(n) {
  if (n.m?.kind !== "AudioIn") return null;
  const mine = CHANNELS[n.m.params.device] || [];
  const others = nodes.filter((o) => o !== n && o.m?.kind === "AudioIn" && (CHANNELS[o.m.params.device] || []).some((c) => mine.includes(c)));
  if (!others.length) return null;
  const common = mine.filter((c) => others.some((o) => CHANNELS[o.m.params.device].includes(c)));
  return { others, label: common.map((c) => (c === "mic" ? "mic" : c === "daw" ? "daw track" : "in " + c)).join("+") };
}
// devices used by two or more AUDIO IN plates, each with the plates that share it
function sharedGroups() {
  const ins = nodes.filter((n) => n.m?.kind === "AudioIn" && !n.ghost && n.box), out = [];
  const byCh = new Map();
  for (const n of ins) for (const c of CHANNELS[n.m.params.device] || []) { if (!byCh.has(c)) byCh.set(c, []); byCh.get(c).push(n); }
  for (const [c, ns] of byCh) if (ns.length > 1) out.push({ label: c === "mic" ? "mic" : c === "daw" ? "daw" : c === "file" ? "file" : "in " + c, nodes: ns });
  return out;
}
function syncShared() {
  for (const n of nodes) {
    const box = n.el?.querySelector(".pl-shared"); if (!box) continue;
    const s = sharedOf(n);
    box.hidden = !s;
    if (s) box.replaceChildren(el("span", { "aria-hidden": "true" }, "⇄ "), `shared · ${s.label}`);
  }
}
function wirePlate(pl, n) {
  pl.addEventListener("pointerenter", () => { hoverI = n.i; setActive(n.i, false); const s = sharedOf(n); if (s) for (const o of s.others) o.el.classList.add("twin"); });
  pl.addEventListener("pointerleave", () => { hoverI = -1; for (const o of nodes) o.el?.classList.remove("twin"); if (!plates.contains(document.activeElement) || document.activeElement === plates && false) { active = -1; syncActive(); } });
  pl.addEventListener("click", (e) => { if (e.target.closest("select, button, .pk")) return; plates.focus({ preventScroll: true }); setActive(n.amp ? "amp" : n.i, false); if (TOUCHY()) openSheet(n); });
}
function drawArc(x, s, v, ghostV = null, range = null) {
  const c = s / 2, r = s / 2 - 3, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, ang = (t) => a0 + (a1 - a0) * Math.max(0, Math.min(1, t));
  x.clearRect(0, 0, s, s); x.lineCap = "round";
  x.beginPath(); x.arc(c, c, r, a0, a1); x.strokeStyle = "#262b33"; x.lineWidth = 2.4; x.stroke();
  if (range) { x.beginPath(); x.arc(c, c, r, ang(range[0]), ang(range[1])); x.strokeStyle = "rgba(142,240,177,.3)"; x.lineWidth = 4; x.stroke(); }
  x.beginPath(); x.arc(c, c, r, a0, ang(v)); x.strokeStyle = "#8ef0b1"; x.lineWidth = 2.4; x.stroke();
  const av = ang(v);
  x.beginPath(); x.moveTo(c, c); x.lineTo(c + Math.cos(av) * (r - 3), c + Math.sin(av) * (r - 3)); x.strokeStyle = "#e2ddd1"; x.lineWidth = 1.6; x.stroke();
  if (ghostV != null) {
    const ag = ang(ghostV);
    x.beginPath(); x.moveTo(c, c); x.lineTo(c + Math.cos(ag) * (r - 2), c + Math.sin(ag) * (r - 2)); x.strokeStyle = "rgba(142,240,177,.75)"; x.lineWidth = 1.2; x.stroke();
    x.beginPath(); x.arc(c + Math.cos(ag) * r, c + Math.sin(ag) * r, 1.8, 0, 7); x.fillStyle = "#8ef0b1"; x.fill();
  }
}
// The amp envelope, drawn from its four numbers: a note held, then released.
function drawAdsr(x, w, h, a, lit) {
  x.clearRect(0, 0, w, h);
  const T = 0.3 + a.attack + a.decay + 0.35 + a.release, sx = (w - 4) / T, y0 = h - 3, top = 3, sy = y0 - top;
  const p = [[2, y0], [2 + a.attack * sx, top], [2 + (a.attack + a.decay) * sx, y0 - a.sustain * sy], [2 + (a.attack + a.decay + 0.35 + 0.3) * sx, y0 - a.sustain * sy], [w - 2, y0]];
  x.beginPath(); p.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
  x.strokeStyle = lit ? "#8ef0b1" : "rgba(142,240,177,.7)"; x.lineWidth = 1.6; x.lineJoin = "round"; x.stroke();
  x.lineTo(2, y0); x.fillStyle = "rgba(142,240,177,.08)"; x.fill();
}

// ---------------------------------------------------------------- layout
function layout() {
  // layout size, never getBoundingClientRect: the zoom scales the view while it
  // arrives, and a rack laid out at 86% stays wrong after it lands
  const r = { width: well.clientWidth, height: well.clientHeight }; if (!r.width) return;
  const phone = window.innerWidth <= 700, catW = mode === "new" && !phone ? 190 : 0;
  const real = nodes.filter((n) => !n.amp);
  const maxCol = Math.max(0, ...real.map((n) => n.col));
  const cols = maxCol + 2; // the amp at column −1
  const rows = Math.max(1, ...nodes.map((n) => Math.floor(n.row) + 1));
  const padL = 44 + catW, padT = r.height < 320 ? 40 : 72; // a short well (a phone on its side) keeps less headroom
  // wide enough for legible plates; on a narrow screen the rack scrolls inside its well
  const need = padL + cols * 118 + (cols - 1) * 40 + 170;
  W = Math.max(r.width, need); H = r.height - (W > r.width ? 10 : 0);
  const outZone = Math.max(160, Math.min(190, W * 0.18));
  let gx = 64, gy = 30;
  let pw = Math.min(188, (W - padL - outZone - (cols - 1) * gx) / cols);
  if (pw < 128) { gx = 40; pw = Math.min(188, (W - padL - outZone - (cols - 1) * gx) / cols); }
  pw = Math.max(112, pw);
  // each row as tall as its tallest plate
  rowHeights = [];
  for (let i = 0; i < rows; i++) rowHeights.push(Math.max(i < audioRowCount ? 104 : 92, ...nodes.filter((n) => Math.floor(n.row) === i).map((n) => n.h || 0)));
  const rowH = (i) => rowHeights[i] + (i >= audioRowCount ? 8 : 0);
  const gapOf = (i) => (i ? gy : 0) + (i === audioRowCount ? 26 : 0); // the modulators' band sits a little apart
  let needH = 0; for (let i = 0; i < rows; i++) needH += rowH(i) + gapOf(i);
  let availH = H - padT - (open ? 76 : 40);
  if (needH > availH) { gy = Math.max(12, gy - (needH - availH) / Math.max(1, rows - 1)); needH = 0; for (let i = 0; i < rows; i++) needH += rowH(i) + gapOf(i); }
  if (needH > availH) { H = padT + needH + (open ? 76 : 40); availH = needH; }
  inner.style.width = W + "px"; inner.style.height = H + "px";
  const d = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(W * d); cv.height = Math.round(H * d); cv.style.width = W + "px"; cv.style.height = H + "px";
  ctx.setTransform(d, 0, 0, d, 0, 0);
  const rowY = []; let yy = padT + Math.max(0, (availH - needH) / 2);
  for (let i = 0; i < rows; i++) { yy += gapOf(i); rowY.push(yy); yy += rowH(i); }
  const graphW = cols * pw + (cols - 1) * gx;
  const x0 = padL + Math.max(0, (W - padL - outZone - graphW) / 2);
  const xOf = (col) => x0 + (maxCol - col) * (pw + gx); // col 0 (root) is rightmost of the modules; the amp is col −1
  for (const n of nodes) {
    const h = n.h || (n.cv ? 92 : 104);
    // a fractional row (a mix between two inputs) sits between them
    const rf = n.row, r0 = Math.floor(rf), fr = rf - r0;
    const y = rowY[r0] + (fr ? fr * ((rowY[r0 + 1] ?? rowY[r0]) - rowY[r0]) : 0) + (n.cv ? 4 : 0);
    n.box = { x: xOf(n.col), y, w: pw, h };
    Object.assign(n.el.style, { left: n.box.x + "px", top: n.box.y + "px", width: pw + "px", height: h + "px" });
  }
  const amp = nodes.find((n) => n.amp);
  outJack = { x: amp.box.x + amp.box.w + Math.min(64, outZone * 0.34), y: amp.box.y + amp.box.h / 2 };
  const vh = Math.min(150, Math.max(96, 104 * 1.35)), vw = vh * 0.6;
  vesselBox = { x: Math.min(W - vw - 24, outJack.x + 34), y: outJack.y - vh / 2, w: vw, h: vh };
  order = nodes.slice().sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y).map((n) => n.i);
  const choosing = mode === "new" && !start;
  plates.style.visibility = choosing ? "hidden" : "";
  if (choosing) { choice.style.left = (phone ? r.width / 2 : (catW + 12 + Math.min(outJack.x, r.width) - 40) / 2) + "px"; }
  draw(); loop(); syncEdges();
}

// ---------------------------------------------------------------- the drawing
const jackIn = (e) => {
  const b = e.to.box;
  if (e.kind === "cv") return { x: b.x + b.w * 0.62, y: b.y + b.h, dir: "up" };
  if (e.role === "sidechain" || e.role === "key") return { x: b.x + b.w * 0.24, y: b.y + b.h, dir: "up" };
  if (e.role === "a" || e.role === "carrier") return { x: b.x, y: b.y + b.h * 0.36, dir: "left" };
  if (e.role === "b" || e.role === "modulator") return { x: b.x, y: b.y + b.h * 0.68, dir: "left" };
  return { x: b.x, y: b.y + b.h / 2, dir: "left" };
};
const jackOut = (e) => {
  const b = e.from.box;
  if (e.kind === "cv") return { x: b.x + b.w / 2, y: b.y, dir: "up" };
  if (e.kind === "cvlink") return { x: b.x + b.w, y: b.y + b.h / 2, dir: "right" };
  return { x: b.x + b.w, y: b.y + b.h / 2, dir: "right" };
};
function curve(e) {
  if (!e.from.box || !e.to.box) return null; // not laid out yet: skip until it is
  const a = jackOut(e), b = jackIn(e);
  if (b.dir === "up" && a.dir === "up") return [a, { x: a.x, y: a.y - 36 }, { x: b.x, y: b.y + 36 }, b];
  if (b.dir === "up") { const k = Math.max(40, Math.abs(b.x - a.x) * 0.5); return [a, { x: a.x + k, y: a.y }, { x: b.x, y: b.y + Math.max(40, Math.abs(b.y - a.y) * 0.6) }, b]; }
  const k = Math.max(26, (b.x - a.x) * 0.5);
  return [a, { x: a.x + k, y: a.y }, { x: b.x - k, y: b.y }, b];
}
const bez = (P, t) => { const u = 1 - t; return { x: u * u * u * P[0].x + 3 * u * u * t * P[1].x + 3 * u * t * t * P[2].x + t * t * t * P[3].x, y: u * u * u * P[0].y + 3 * u * u * t * P[1].y + 3 * u * t * t * P[2].y + t * t * t * P[3].y }; };
// the path from a module to OUT: the stages its signal passes through
function pathSet(i) {
  const s = new Set(); if (i === -1 || i == null) return s;
  let n = i === "amp" ? nodes.find((x) => x.amp) : nodes[i];
  if (!n) return s;
  s.add(n.i);
  while (n && !n.amp) {
    const up = n.m.parent >= 0 ? nodes[n.m.parent] : nodes.find((x) => x.amp);
    s.add(up.i); n = up;
  }
  return s;
}
const hasMotion = () => edges.some((e) => e.kind !== "audio" && !e.ghost) || sharedGroups().length > 0;
// the stages that feed a module (its sources, and for a modulator its own chain)
function upstream(i) {
  const s = new Set(); if (i === -1 || i == null) return s;
  if (i === "amp") { for (const n of nodes) if (!n.cv) s.add(n.i); return s; }
  const start = nodes[i]; if (!start) return s;
  const rec = (n) => { s.add(n.i); for (const c of n.kids) { const k = nodes[c]; if (k && (start.cv || !k.cv)) rec(k); } };
  rec(start); return s;
}
// the vessel a module leaves behind: its effect undone where it can be computed, else the band it works in
// what the turned knobs would do to the sound: the measured shape plus each turned
// module's estimated change (the prototype can't re-render, so it says "estimated")
function editDev() {
  if (mode !== "patch" || comparing) return null;
  const e = edOf(); if (!e.edits.size && !e.kept.size) return null;
  const p = A.inHand(); let delta = null;
  for (const n of nodes) {
    if (n.amp || n.ghost || !n.m) continue;
    const now = { ...n.m.params }; let changed = false;
    for (const [key, v] of [...e.kept, ...e.edits]) { const [ni, site] = key.split(":"); if (+ni === n.i) { now[site] = v; changed = true; } }
    if (!changed) continue;
    const k = n.m.kind, a = effectOf(k, n.m.params) || toneOf(k, n.m.params), b = effectOf(k, now) || toneOf(k, now);
    if (!a || !b) continue;
    delta = (delta || new Array(FQ.length).fill(0)).map((d, i) => d + b[i] - a[i]);
  }
  if (!delta || delta.every((d) => Math.abs(d) < 0.3)) return null;
  const extra = A.audio.responseDb(A.fxOf(p.id));
  return toDev(p.ltas_db.map((v, i) => v + extra[i] + delta[i]));
}
function withoutOf(n) {
  if (!n || n.amp || n.ghost) return null;
  if (mode === "new") { const id = n.m.params.__id; const d = estDev(fresh, id); return { dev: d || SILENT.dev }; }
  const host = n.cv ? (() => { let h = n; while (h && h.cv) h = h.m.parent >= 0 ? nodes[h.m.parent] : null; return h; })() : n;
  if (!host) return null;
  const fx = !n.cv && effectOf(host.m.kind, host.m.params);
  if (fx) { const p = A.inHand(), extra = A.audio.responseDb(A.fxOf(p.id)); return { dev: toDev(p.ltas_db.map((v, i) => v + extra[i] - fx[i])) }; }
  const r = REGION[host.m.kind] || [80, 14000];
  return { region: [A.bandOfHz(r[0]), A.bandOfHz(r[1])] };
}
function draw(t = performance.now()) {
  if (!ctx || !W) return;
  if (!vesselBox || !outJack || nodes.some((n) => !n.box)) return; // rebuilt but not yet laid out
  const x = ctx; x.clearRect(0, 0, W, H);
  const lit = pathSet(active);
  const playing = mode === "patch" && A.audio.playingId === A.inHand().id;
  const flow = !A.reduced && (playing || active !== -1);
  const secs = t / 1000;
  const travel = playing ? new Set(nodes.map((n) => n.i)) : new Set([...upstream(active), ...pathSet(active)]);
  for (const e of edges) {
    const P = curve(e); if (!P) continue;
    const on = lit.has(e.from.i) && lit.has(e.to.i);
    x.beginPath(); x.moveTo(P[0].x, P[0].y); x.bezierCurveTo(P[1].x, P[1].y, P[2].x, P[2].y, P[3].x, P[3].y);
    const cvish = e.kind !== "audio";
    if (e.ghost) {
      // drawn in from the jack it would plug into, before its plate grows
      const gk = A.reduced ? 1 : Math.min(1, Math.max(0, (t - ghostT0) / 320));
      if (gk < 1) { x.beginPath(); for (let j = 0; j <= 24; j++) { const q = bez(P, 1 - (j / 24) * gk); j ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y); } }
      x.setLineDash([5, 5]); x.lineWidth = 1.6; x.strokeStyle = "rgba(255,180,84,.55)"; x.stroke(); x.setLineDash([]);
      continue;
    }
    // modulation moves: the dash flows from the modulator to its knob at the rate as set
    x.setLineDash(cvish ? [4, 5] : []);
    x.lineDashOffset = cvish && !A.reduced ? -((secs * (e.hz || 1)) % 1) * 27 : 0;
    x.lineWidth = on ? 2.6 : cvish ? 2.2 : 2;
    x.strokeStyle = on ? "#8ef0b1" : cvish ? "rgba(142,240,177,.5)" : "rgba(142,240,177,.34)";
    if (on) { x.shadowColor = "rgba(142,240,177,.7)"; x.shadowBlur = 12; }
    x.stroke(); x.shadowBlur = 0; x.setLineDash([]); x.lineDashOffset = 0;
    // signal as light: from the sources, along the cables, into the vessel at OUT
    if (flow && !cvish && travel.has(e.from.i) && travel.has(e.to.i)) lightAlong(x, P, t);
    // depth and rate, written on the dashed cable
    if (e.kind === "cv" && typeof e.depth === "number") {
      const q = bez(P, 0.5); label(x, `depth ${e.depth.toFixed(2)} · ${(e.hz || 1).toFixed(e.hz < 1 ? 2 : 1)} Hz`, q.x + 8, q.y, on);
    }
    // the level mark: where the app shows each cable's measured level
    if (e.kind === "audio") { const q = bez(P, 0.5); levelMark(x, q.x, q.y, on); }
    // input names where they matter
    if (["a", "b", "sidechain", "key", "carrier", "modulator"].includes(e.role)) { const b = jackIn(e); label(x, e.role === "sidechain" ? "side" : e.role, b.dir === "up" ? b.x + 6 : b.x - 6, b.dir === "up" ? b.y + 14 : b.y - 8, on, b.dir === "up" ? "left" : "right"); }
  }
  // the knob each modulator moves: a ghost pointer swinging by its depth (or, stilled, the range it covers)
  for (const e of edges) {
    if (e.kind !== "cv" || e.ghost || !e.target || !e.to.kn) continue;
    const kn = e.to.kn[e.target]; if (!kn || !kn.x) continue;
    const base = valOf(e.to, kn), depth = typeof e.depth === "number" ? e.depth : 0.3;
    if (A.reduced) paintKnob(e.to, kn, null, [base - depth / 2, base + depth / 2]);
    else paintKnob(e.to, kn, base + (depth / 2) * shapeAt(e.shape, secs * (e.hz || 1)));
  }
  // inputs that share a device: one source, its signal fanning out to each plate
  // that uses it, the same pulse reaching all of them at once
  for (const g of sharedGroups()) {
    const lx = Math.min(...g.nodes.map((n) => n.box.x)), src = { x: Math.max(14, lx - 30), y: g.nodes.reduce((a, n) => a + n.box.y + n.box.h / 2, 0) / g.nodes.length };
    const lit2 = g.nodes.some((n) => n.i === active || n.el.classList.contains("twin"));
    for (const n of g.nodes) {
      const q = { x: n.box.x, y: n.box.y + n.box.h / 2 }, P = [src, { x: src.x + 16, y: src.y }, { x: q.x - 16, y: q.y }, q];
      x.beginPath(); x.moveTo(P[0].x, P[0].y); x.bezierCurveTo(P[1].x, P[1].y, P[2].x, P[2].y, P[3].x, P[3].y);
      x.setLineDash([1.5, 4]); x.lineCap = "round"; x.strokeStyle = lit2 ? "rgba(142,240,177,.95)" : "rgba(142,240,177,.6)"; x.lineWidth = 2; x.stroke(); x.setLineDash([]); x.lineCap = "butt";
      if (!A.reduced) { const ph = (t * 0.0006) % 1, c = bez(P, ph); const gr = x.createRadialGradient(c.x, c.y, 0, c.x, c.y, 7); gr.addColorStop(0, "rgba(190,255,214,.7)"); gr.addColorStop(1, "rgba(142,240,177,0)"); x.fillStyle = gr; x.beginPath(); x.arc(c.x, c.y, 7, 0, 7); x.fill(); }
    }
    x.beginPath(); x.arc(src.x, src.y, 6, 0, 7); x.fillStyle = "#07080a"; x.fill(); x.strokeStyle = "#8ef0b1"; x.lineWidth = 2; x.stroke();
    x.beginPath(); x.arc(src.x, src.y, 2.2, 0, 7); x.fillStyle = "#8ef0b1"; x.fill();
    label(x, g.label, src.x, src.y - 16, true, "center");
  }
  // jacks
  for (const e of edges) { if (e.ghost || !e.from.box || !e.to.box) continue; jack(x, jackOut(e), lit.has(e.from.i)); jack(x, jackIn(e), lit.has(e.to.i) && lit.has(e.from.i)); }
  // amp → OUT → the sound's vessel
  const amp = nodes.find((n) => n.amp), outOn = lit.size > 0;
  const a = { x: amp.box.x + amp.box.w, y: amp.box.y + amp.box.h / 2 };
  x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(outJack.x - 7, outJack.y);
  x.strokeStyle = outOn ? "#8ef0b1" : "rgba(142,240,177,.34)"; x.lineWidth = outOn ? 2.6 : 2; if (outOn) { x.shadowColor = "rgba(142,240,177,.7)"; x.shadowBlur = 12; } x.stroke(); x.shadowBlur = 0;
  const lightOn = flow && (playing || travel.has("amp")) && edges.some((e) => !e.ghost);
  if (lightOn) lightAlong(x, [a, { x: a.x + 10, y: a.y }, { x: outJack.x - 17, y: outJack.y }, { x: outJack.x - 7, y: outJack.y }], t);
  jack(x, a, outOn);
  x.beginPath(); x.arc(outJack.x, outJack.y, 7, 0, 7); x.fillStyle = "#07080a"; x.fill(); x.strokeStyle = outOn || playing ? "#8ef0b1" : "#353c46"; x.lineWidth = 2; x.stroke();
  x.beginPath(); x.arc(outJack.x, outJack.y, 2.6, 0, 7); x.fillStyle = outOn || playing ? "#8ef0b1" : "#6f6c63"; x.fill();
  x.font = "600 12px Jost, sans-serif"; x.textAlign = "center"; x.fillStyle = "rgba(161,156,144,.95)";
  spaced(x, "OUT", outJack.x, outJack.y - 18);
  x.font = "400 12px 'IBM Plex Mono', monospace"; x.textAlign = "center"; x.fillStyle = "rgba(161,156,144,.85)";
  let shown;
  if (mode === "new") {
    // a new patch: flat and silent, then growing toward an estimate from its modules
    if (vTo) { const k = Math.min(1, (t - vT0) / 700), e = A.reduced ? 1 : easeIO(k); vNow = vFrom.map((v, i) => v + (vTo[i] - v) * e); }
    shown = vNow || SILENT.dev;
    const silent = !estSpec(fresh);
    x.save(); if (silent) { x.setLineDash([3, 4]); x.globalAlpha = 0.55; }
    A.face(x, vesselBox.h, SILENT, { box: vesselBox, dev: shown, layers: false, glow: silent ? 0 : 12, lw: silent ? 1.2 : 1.5 });
    x.restore();
    x.fillStyle = "rgba(142,240,177,.12)"; x.fillRect(vesselBox.x - 8, vesselBox.y + vesselBox.h + 3, vesselBox.w + 16, 1);
    x.fillStyle = "rgba(161,156,144,.85)"; x.fillText(silent ? "silent" : "estimated", vesselBox.x + vesselBox.w / 2, vesselBox.y + vesselBox.h + 22);
    if (contrib && !A.reduced && t - contrib.t0 < 1400) {
      const k = 1 - (t - contrib.t0) / 1400, NB = FQ.length, bh = vesselBox.h / (NB - 1);
      x.save(); A.vesselPath(x, A.smooth(shown, 1), 1, vesselBox); x.clip();
      contrib.w.forEach((w, i) => { if (w < 0.05) return; const y = vesselBox.y + vesselBox.h - (i / (NB - 1)) * vesselBox.h; x.fillStyle = `rgba(190,255,214,${0.45 * w * k})`; x.fillRect(vesselBox.x - 4, y - bh / 2, vesselBox.w + 8, bh + 0.5); });
      x.restore();
    }
    if (catPreview) { x.save(); x.setLineDash([4, 4]); A.vesselPath(x, A.smooth(catPreview, 1), 1, vesselBox); x.strokeStyle = "rgba(226,221,209,.7)"; x.lineWidth = 1.3; x.stroke(); x.restore(); }
  } else {
    const p = A.inHand();
    const live = playing ? A.audio.liveDev() : null;
    shown = A.audio.devFor(p);
    if (!A.morphing) A.face(x, vesselBox.h, p, { box: vesselBox, dev: shown, glow: 16, lw: 1.6, live });
    x.fillStyle = "rgba(142,240,177,.18)"; x.fillRect(vesselBox.x - 8, vesselBox.y + vesselBox.h + 3, vesselBox.w + 16, 1);
    const ed = A.morphing ? null : editDev();
    if (ed) {
      x.save(); x.setLineDash([3, 3]); A.vesselPath(x, A.smooth(ed, 1), 1, vesselBox); x.strokeStyle = "rgba(142,240,177,.95)"; x.lineWidth = 1.4; x.shadowColor = "rgba(142,240,177,.6)"; x.shadowBlur = 8; x.stroke(); x.restore();
      x.fillStyle = "rgba(142,240,177,.85)"; x.fillText("estimated", vesselBox.x + vesselBox.w / 2, vesselBox.y + vesselBox.h + 22);
    }
  }
  // a module under the pointer: the vessel as it would be without it
  const wo = !A.morphing && active !== -1 && active !== "amp" ? withoutOf(nodes[active]) : null;
  if (wo && wo.dev) { x.save(); x.setLineDash([4, 4]); A.vesselPath(x, A.smooth(wo.dev, 1), 1, vesselBox); x.strokeStyle = "rgba(226,221,209,.75)"; x.lineWidth = 1.3; x.stroke(); x.restore(); }
  else if (wo && wo.region) {
    const NB = FQ.length, y1 = vesselBox.y + vesselBox.h - (wo.region[0] / (NB - 1)) * vesselBox.h, y0 = vesselBox.y + vesselBox.h - (wo.region[1] / (NB - 1)) * vesselBox.h;
    x.save(); A.vesselPath(x, A.smooth(shown, 1), 1, vesselBox); x.clip();
    x.fillStyle = "rgba(7,8,10,.62)"; x.fillRect(vesselBox.x - 4, y0, vesselBox.w + 8, y1 - y0); x.restore();
    x.fillStyle = "rgba(226,221,209,.5)"; x.fillRect(vesselBox.x - 10, y0, 6, 1); x.fillRect(vesselBox.x - 10, y1, 6, 1); x.fillRect(vesselBox.x - 10, y0, 1, y1 - y0);
  }
  // light arriving: a glow rising through the vessel
  if (lightOn && !A.morphing) {
    const ph = (t * 0.0005) % 1, yy = vesselBox.y + vesselBox.h * (1 - ph);
    x.save(); A.vesselPath(x, A.smooth(shown, 1), 1, vesselBox); x.clip();
    const g = x.createLinearGradient(0, yy - 16, 0, yy + 16); g.addColorStop(0, "rgba(142,240,177,0)"); g.addColorStop(0.5, "rgba(190,255,214,.38)"); g.addColorStop(1, "rgba(142,240,177,0)");
    x.fillStyle = g; x.fillRect(vesselBox.x - 4, yy - 16, vesselBox.w + 8, 32); x.restore();
  }
  if (amp.adsr) drawAdsr(amp.adsr[1], 96, 30, amp.params, lit.has("amp"));
}
// light along a cable: three bright points, spaced, with a soft halo
function lightAlong(x, P, t) {
  for (let k = 0; k < 3; k++) {
    const q = bez(P, ((t * 0.0005) + k / 3) % 1);
    const g = x.createRadialGradient(q.x, q.y, 0, q.x, q.y, 9); g.addColorStop(0, "rgba(190,255,214,.55)"); g.addColorStop(1, "rgba(142,240,177,0)");
    x.fillStyle = g; x.beginPath(); x.arc(q.x, q.y, 9, 0, 7); x.fill();
    x.beginPath(); x.arc(q.x, q.y, 2.2, 0, 7); x.fillStyle = "#e8fff0"; x.fill();
  }
}
function jack(x, p, on) {
  x.beginPath(); x.arc(p.x, p.y, 4.2, 0, 7); x.fillStyle = "#07080a"; x.fill();
  x.strokeStyle = on ? "#8ef0b1" : "#353c46"; x.lineWidth = 1.6; x.stroke();
}
function levelMark(x, cx, cy, on) {
  const w = 16, h = 14;
  x.fillStyle = "#0a0d0b"; roundRect(x, cx - w / 2, cy - h / 2, w, h, 3); x.fill();
  x.strokeStyle = on ? "rgba(142,240,177,.9)" : "rgba(142,240,177,.45)"; x.lineWidth = 1; roundRect(x, cx - w / 2, cy - h / 2, w, h, 3); x.stroke();
  for (let k = 0; k < 3; k++) { const bh = 3 + k * 2.2; x.strokeRect(cx - 5 + k * 3.8 + 0.5, cy + h / 2 - 3 - bh + 0.5, 2, bh); }
}
function roundRect(x, px, py, w, h, r) { x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r); x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath(); }
function label(x, s, px, py, on, align = "left") {
  x.font = "400 12px 'IBM Plex Mono', monospace"; x.textAlign = align;
  x.fillStyle = on ? "rgba(142,240,177,.95)" : "rgba(161,156,144,.8)"; x.fillText(s, px, py + 4);
}
function spaced(x, s, px, py) { x.fillText(s.split("").join(String.fromCharCode(8202, 8202)), px, py); }

// modulation is always visible while the view is: the loop runs if anything moves
function loop() {
  if (raf || !visible) return;
  const tick = (t) => {
    raf = 0; draw(t);
    const playing = mode === "patch" && A.audio.playingId === A.inHand().id;
    const growing = (mode === "new" && vTo && t - vT0 < 720) || t - ghostT0 < 720 || (contrib && t - contrib.t0 < 1400);
    if (visible && !A.reduced && (playing || active !== -1 || hasMotion() || growing || catPreview)) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- focus, approach, readout
function setActive(i, announce = true) {
  if (i == null || i === -1) { active = -1; syncActive(); return; }
  active = i; syncActive(); loop(); void announce;
}
function syncActive() {
  for (const n of nodes) {
    const on = n.i === active;
    n.el.classList.toggle("on", on);
    n.el.setAttribute("aria-selected", String(on));
  }
  const lit = pathSet(active);
  for (const n of nodes) n.el.classList.toggle("path", lit.has(n.i) && n.i !== active);
  if (active === -1) {
    plates.removeAttribute("aria-activedescendant");
    readout.replaceChildren();
    draw(); return;
  }
  const n = active === "amp" ? nodes.find((x) => x.amp) : nodes[active];
  if (!n) { active = -1; return; }
  plates.setAttribute("aria-activedescendant", n.el.id);
  const name = n.amp ? "amp" : labelOf(n.m).name;
  const words = n.ghost || n.m?.kind === "AudioIn";
  readout.replaceChildren(el("span", { class: "pt-read-name", style: n.ghost ? "color:var(--amber)" : null }, n.ghost ? "suggested: " + name : name), words ? el("span", { class: "pt-read-says" }, saysOf(n)) : "");
  draw();
}
function onRackKey(e) {
  if (!order.length || e.target !== plates) return;
  if ((e.key === "Delete" || e.key === "Backspace") && mode === "new" && active !== -1 && active !== "amp") { removeModule(nodes[active]); e.preventDefault(); e.stopPropagation(); return; }
  const at = order.indexOf(active);
  const cur = active === -1 ? null : active === "amp" ? nodes.find((x) => x.amp) : nodes[active];
  let next = null;
  if (e.key === "ArrowRight") next = order[Math.min(order.length - 1, at + 1)];
  else if (e.key === "ArrowLeft") next = order[Math.max(0, at - 1)];
  else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && cur) {
    const dir = e.key === "ArrowDown" ? 1 : -1;
    const cand = nodes.filter((n) => n !== cur && Math.sign(n.box.y - cur.box.y) === dir);
    cand.sort((a, b) => Math.hypot(a.box.x - cur.box.x, (a.box.y - cur.box.y) * 0.6) - Math.hypot(b.box.x - cur.box.x, (b.box.y - cur.box.y) * 0.6));
    if (cand[0]) next = cand[0].i;
  }
  else if (e.key === "Home") next = order[0];
  else if (e.key === "End") next = order[order.length - 1];
  else if (e.key === "Enter" && cur) {
    // Enter goes into a plate: the suggestion is added; knobs, a device, take the keys
    if (cur.ghost) commitGhost();
    else { const first = cur.el.querySelector(".pk, select"); if (first) { if (first.classList.contains("pk")) first.tabIndex = 0; first.focus(); } else playIt(); }
    e.preventDefault(); e.stopPropagation(); return;
  }
  else if (e.key === " ") { playIt(); e.preventDefault(); e.stopPropagation(); return; }
  else return;
  e.preventDefault(); e.stopPropagation();
  if (next != null) setActive(next);
}

// ---------------------------------------------------------------- level 3: how to read this
function buildLegend() {
  legend.id = "pt-legend";
  const glyph = (fn) => { const [c, x] = A.canvas(44, 22); fn(x); return c; };
  const items = [
    [glyph((x) => { x.strokeStyle = "#353c46"; x.lineWidth = 1.2; roundRect(x, 4, 3, 36, 16, 3); x.stroke(); x.fillStyle = "#1a1e23"; x.fill(); }), "Plate: one module, its knobs"],
    [glyph((x) => { x.beginPath(); x.moveTo(3, 16); x.bezierCurveTo(20, 16, 24, 6, 41, 6); x.strokeStyle = "#8ef0b1"; x.lineWidth = 2; x.stroke(); }), "Cable: sound, flowing right to OUT"],
    [glyph((x) => { x.beginPath(); x.moveTo(22, 20); x.bezierCurveTo(22, 12, 22, 10, 22, 2); x.setLineDash([4, 4]); x.strokeStyle = "rgba(142,240,177,.8)"; x.lineWidth = 2; x.stroke(); x.setLineDash([]); }), "Dashed: a modulator, flowing at its rate as set"],
    [glyph((x) => { x.save(); x.translate(11, 0); drawArc(x, 22, 0.35, 0.62, null); x.restore(); }), "A pale pointer: where it takes the knob"],
    [glyph((x) => levelMark(x, 22, 11, true)), "Level: marked here, measured in the app"],
    [glyph((x) => { for (let k = 0; k < 3; k++) { x.beginPath(); x.arc(8 + k * 14, 11, 2.2, 0, 7); x.fillStyle = "#e8fff0"; x.fill(); } }), "Light: the signal, on its way to OUT"],
    [glyph((x) => { x.setLineDash([3, 3]); x.strokeStyle = "rgba(226,221,209,.8)"; x.lineWidth = 1.2; x.beginPath(); x.moveTo(15, 20); x.bezierCurveTo(8, 12, 18, 6, 14, 2); x.moveTo(29, 20); x.bezierCurveTo(36, 12, 26, 6, 30, 2); x.stroke(); }), "Dashed vessel: without that module (approximate)"],
  ];
  if (mode === "new") items.push([glyph((x) => { x.setLineDash([4, 3]); x.strokeStyle = "#ffb454"; x.lineWidth = 1.4; roundRect(x, 4, 3, 36, 16, 3); x.stroke(); x.setLineDash([]); }), "Amber, dashed: the model's suggestion"]);
  if (mode === "new" || nodes.some((n) => n.m?.kind === "AudioIn")) items.push([glyph((x) => { x.save(); x.translate(12, 1); x.scale(0.83, 0.83); x.strokeStyle = "#8ef0b1"; x.lineWidth = 2; x.lineCap = "round"; x.beginPath(); x.arc(12, 9, 3.2, 0, 7); x.moveTo(12, 12.2); x.lineTo(12, 20); x.moveTo(8.5, 20); x.lineTo(15.5, 20); x.moveTo(6.5, 9); x.arc(12, 9, 5.5, Math.PI, 0, true); x.stroke(); x.restore(); }), "Audio in: one input can feed several"]);
  legend.replaceChildren(el("div", { class: "cap" }, "How to read this"),
    ...items.map(([c, s]) => el("div", { class: "pt-leg" }, c, el("span", {}, s))),
    el("p", { class: "pt-leg-note" }, mode === "new" ? "the vessel is estimated from its modules · devices are illustrative · nothing plays here" : "rates as set · levels not measured · knobs don't re-render here"));
}
function setOpen(on) {
  open = on; legend.hidden = !on; layout();
  const b = root.querySelector("#pt-how"); if (b) b.setAttribute("aria-expanded", String(on));
}

// ---------------------------------------------------------------- the module sheet (touch)
// On a phone a plate's knobs are too small to turn. Tapping a module opens it in a
// sheet: every one of its settings as a wide slider with fine steps, its choices as
// buttons, and a small vessel showing what the change would do to the sound.
const TOUCHY = () => matchMedia("(pointer: coarse)").matches || window.innerWidth <= 700;
const RANGE = { octave: [-2, 2], semis: [-12, 12], bands: [2, 32], steps: [1, 16], pulses: [0, 16], bits: [1, 16], length: [1, 16], downsample: [1, 16] };
const LONGN = { res: "resonance", atk: "attack", rel: "release", mod_depth: "mod depth" };
let sheet = null, sheetN = null, sheetKeep = false;
const keyOf = (n, site) => `${n.amp ? "amp" : n.i}:${site}`;
function rowsOf(n) {
  if (n.amp) return ["attack", "decay", "sustain", "release"].map((k) => { const o = n.params[k]; return { site: k, k, orig: o, min: 0, max: k === "sustain" ? 1 : Math.max(2, o * 2), int: false, kind: "num" }; });
  const m = n.m, out = [];
  if (m.kind === "Op") (OP_PARAMS[m.params.kind] || []).forEach((k, j) => { const v = m.params["p" + j]; if (typeof v === "number") out.push({ site: "p" + j, k, orig: v, min: 0, max: 1, int: false, kind: "num" }); });
  for (const [k, v] of Object.entries(m.params)) {
    if (k.startsWith("__") || (m.kind === "Op" && /^p\d$/.test(k))) continue;
    if (typeof v === "number") {
      const int = INT.has(k), [lo, hi] = int ? RANGE[k] || [-8, 16] : v >= 0 && v <= 1 ? [0, 1] : [0, Math.max(1, v * 2)];
      out.push({ site: k, k, orig: v, min: lo, max: hi, int, kind: "num" });
    } else if (typeof v === "string" && v !== "None") {
      if (m.kind === "AudioIn" && k === "device") { out.push({ site: k, k: "input", orig: v, kind: "device" }); continue; }
      let opts = null;
      if (k === "wave") opts = ["Sine", "Triangle", "Saw", "Square"].map((o) => [o, o.toLowerCase()]);
      else if (m.kind === "Filter" && k === "kind") opts = Object.entries(FILTER_KIND);
      else if (m.kind === "AudioIn" && k === "mode") opts = MODES.map(([key, label]) => [key, label]);
      out.push({ site: k, k, orig: v, kind: opts ? "seg" : "fixed", opts });
    }
  }
  return out;
}
function rowVal(n, r) {
  if (mode === "new" || n.ghost) return n.amp ? n.params[r.site] : n.m.params[r.site];
  if (n.m?.kind === "AudioIn" && (r.site === "mode" || r.site === "device")) return n.m.params[r.site];
  const e = edOf(), key = keyOf(n, r.site);
  if (comparing) return e.kept.has(key) ? e.kept.get(key) : r.orig;
  return e.edits.has(key) ? e.edits.get(key) : e.kept.has(key) ? e.kept.get(key) : r.orig;
}
function editRow(n, r, v) {
  if (typeof v === "number") { v = Math.max(r.min, Math.min(r.max, v)); if (r.int) v = Math.round(v); }
  if (n.m?.kind === "AudioIn" && r.site === "mode") {
    setParam(n, "mode", v);
    for (const b of n.el?.querySelectorAll(".pl-mode") || []) b.setAttribute("aria-pressed", String(b.textContent === v));
  } else if (mode === "new") {
    if (n.amp) n.params[r.site] = v; else setParam(n, r.site, v);
    const kn = n.kn?.[r.site]; if (kn && typeof v === "number") { kn.v = v; paintKnob(n, kn); }
    growTo(estDev(fresh));
  } else {
    const kn = n.kn?.[r.site];
    if (kn && typeof v === "number") turn(n, kn, v);
    else {
      comparing = false;
      const e = edOf(), key = keyOf(n, r.site), base = e.kept.has(key) ? e.kept.get(key) : r.orig;
      if (v === base || (typeof v === "number" && Math.abs(v - base) < 1e-4)) e.edits.delete(key); else e.edits.set(key, v);
      syncEdited(n); syncEditBar();
      if (!editToasted && e.edits.size) { editToasted = true; A.toast({ text: "In the app, the patch re-renders as you turn. This prototype can't." }); }
    }
  }
  if (n.amp && n.adsr) drawAdsr(n.adsr[1], 96, 30, Object.fromEntries(["attack", "decay", "sustain", "release"].map((k) => [k, rowVal(n, { site: k, orig: n.params[k] })])), true);
  draw(); paintSheet();
}
// a step button repeats while held, for the last few hundredths
function hold(b, fn) {
  let t = null, r = null;
  const stop = () => { clearTimeout(t); clearInterval(r); t = r = null; };
  b.addEventListener("pointerdown", (e) => { e.preventDefault(); fn(); t = setTimeout(() => { r = setInterval(fn, 60); }, 380); });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, stop);
  b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { fn(); e.preventDefault(); e.stopPropagation(); } });
}
function rowEl(n, r) {
  const name = LONGN[r.k] || String(r.k).replace(/_/g, " ");
  if (r.kind === "num") {
    const val = el("span", { class: "ms-val mono" });
    const fill = el("i", { class: "ms-fill" }), mark = el("i", { class: "ms-mark" }), thumb = el("i", { class: "ms-thumb" });
    const track = el("div", { class: "ms-track", role: "slider", tabindex: "0", "aria-label": name, "aria-valuemin": String(r.min), "aria-valuemax": String(r.max) }, el("i", { class: "ms-rail" }), fill, mark, thumb);
    const step = r.int ? 1 : (r.max - r.min) / 100;
    const nudge = (d) => editRow(n, r, rowVal(n, r) + d);
    const btn = (d, label, sign) => { const b = el("button", { class: "ms-step", "aria-label": `${label} ${name}` }, sign); hold(b, () => nudge(d)); return b; };
    const lab = el("div", { class: "ms-lab", title: "Double-tap: as made" }, el("span", { class: "ms-n" }, name), val);
    const row = el("div", { class: "ms-row", "data-site": r.site }, lab, btn(-step, "Lower", "−"), track, btn(step, "Raise", "+"));
    let drag = false;
    const at = (e) => { const b = track.getBoundingClientRect(); const t = Math.max(0, Math.min(1, (e.clientX - b.left - 14) / (b.width - 28))); editRow(n, r, r.min + t * (r.max - r.min)); };
    track.addEventListener("pointerdown", (e) => { drag = true; try { track.setPointerCapture(e.pointerId); } catch {} at(e); e.preventDefault(); });
    track.addEventListener("pointermove", (e) => { if (drag) at(e); });
    const up = () => { drag = false; }; track.addEventListener("pointerup", up); track.addEventListener("pointercancel", up);
    track.addEventListener("keydown", (e) => {
      const big = e.shiftKey ? step * 10 : step;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") nudge(big); else if (e.key === "ArrowLeft" || e.key === "ArrowDown") nudge(-big);
      else if (e.key === "Home") editRow(n, r, r.min); else if (e.key === "End") editRow(n, r, r.max); else return;
      e.preventDefault(); e.stopPropagation();
    });
    lab.addEventListener("dblclick", () => editRow(n, r, r.orig));
    r.ui = { val, fill, mark, thumb, track, row };
    return row;
  }
  if (r.kind === "seg") {
    const seg = el("div", { class: "ms-seg", role: "radiogroup", "aria-label": name }, ...r.opts.map(([key, label]) => { const b = el("button", { role: "radio", "data-v": key }, label); b.addEventListener("click", () => editRow(n, r, key)); return b; }));
    r.ui = { seg };
    return el("div", { class: "ms-row ms-row-seg", "data-site": r.site }, el("div", { class: "ms-lab" }, el("span", { class: "ms-n" }, name)), seg);
  }
  if (r.kind === "device") {
    const sel = el("select", { class: "ms-dev", "aria-label": "Input device (illustrative here)" }, ...DEVICES.map(([k, label]) => el("option", { value: k, selected: rowVal(n, r) === k }, label)));
    sel.addEventListener("change", () => { setParam(n, "device", sel.value); const i = n.i; sheetKeep = true; build(); sheetKeep = false; sheetN = nodes[i] || n; renderSheet("device"); });
    return el("div", { class: "ms-row ms-row-seg", "data-site": r.site }, el("div", { class: "ms-lab" }, el("span", { class: "ms-n" }, "input")), sel);
  }
  return el("div", { class: "ms-row ms-row-seg" }, el("div", { class: "ms-lab" }, el("span", { class: "ms-n" }, name)), el("span", { class: "ms-fixed mono" }, String(r.orig).toLowerCase()));
}
function renderSheet(focusSite) {
  const n = sheetN; if (!n) return;
  const { name, sub } = n.amp ? { name: "amp", sub: "envelope" } : labelOf(n.m);
  const rows = rowsOf(n);
  const [vc, vx] = A.canvas(72, 120);
  sheet._rows = rows; sheet._vx = vx; sheet._cap = el("figcaption", {}, "");
  sheet.setAttribute("aria-label", `${name} settings`);
  const head = el("div", { class: "ms-head" },
    el("div", { class: "ms-title" }, el("span", { class: "ms-ico", html: n.amp ? A.icon("perform") : kindIcon(n.m.kind) }), el("span", { class: "ms-name" }, name), sub ? el("span", { class: "ms-sub mono" }, sub) : ""),
    el("button", { class: "ms-x", "aria-label": "Close", onclick: () => closeSheet(), html: A.icon("x") }));
  sheet.replaceChildren(el("div", { class: "ms-grab", "aria-hidden": "true" }), head,
    el("div", { class: "ms-body" },
      el("div", { class: "ms-left" }, el("p", { class: "ms-says" }, saysOf(n)), el("div", { class: "ms-rows" }, ...rows.map((r) => rowEl(n, r)))),
      el("figure", { class: "ms-fig", "aria-label": "The sound's shape, with the change estimated" }, vc, sheet._cap)),
    el("p", { class: "ms-demo mono", hidden: true }, "Not heard in this demo: it plays recordings of the presets. In the app the patch re-renders as you turn."),
    mode === "new" && !n.amp ? el("div", { class: "ms-foot" }, el("button", { class: "btn ms-rm", onclick: () => removeModule(n), html: `${A.icon("x")}Remove module` })) : "");
  paintSheet();
  const hl = focusSite && sheet.querySelector(`[data-site="${focusSite}"]`);
  if (hl) { hl.classList.add("hl"); hl.scrollIntoView?.({ block: "nearest" }); }
  (hl?.querySelector(".ms-track, button, select") || sheet.querySelector(".ms-track, .ms-seg button, select") || sheet.querySelector(".ms-x"))?.focus({ preventScroll: true });
}
function paintSheet() {
  if (!sheet || !sheetN || !sheet._rows) return;
  const n = sheetN;
  for (const r of sheet._rows) {
    if (!r.ui) continue;
    const v = rowVal(n, r);
    if (r.kind === "num") {
      const t = (v - r.min) / (r.max - r.min || 1), t0 = (r.orig - r.min) / (r.max - r.min || 1);
      const pos = (k) => `calc(14px + ${Math.max(0, Math.min(1, k))} * (100% - 28px))`;
      r.ui.thumb.style.left = pos(t); r.ui.mark.style.left = pos(t0);
      r.ui.fill.style.left = pos(Math.min(t, t0)); r.ui.fill.style.width = `calc(${Math.abs(t - t0)} * (100% - 28px))`;
      r.ui.val.textContent = r.int ? fmtV(r.k, v) : v.toFixed(2);
      r.ui.track.setAttribute("aria-valuenow", String(+(+v).toFixed(3)));
      r.ui.row.classList.toggle("moved", Math.abs(v - r.orig) > 1e-4);
    } else if (r.kind === "seg") for (const b of r.ui.seg.children) b.setAttribute("aria-checked", String(b.dataset.v === v));
  }
  // the sound's shape, the change it would make, and the band this module works in
  const x = sheet._vx; if (!x) return;
  x.clearRect(0, 0, 72, 120);
  const box = { x: 8, y: 6, w: 56, h: 100 };
  let est = null;
  if (mode === "new") { const d = estDev(fresh) || SILENT.dev; A.vesselPath(x, A.smooth(d, 1), 1, box); x.strokeStyle = "#8ef0b1"; x.lineWidth = 1.4; x.stroke(); est = true; }
  else {
    const p = A.inHand(); A.face(x, 100, p, { box, dev: A.audio.devFor(p), glow: 6, lw: 1.2, dim: 0.75 });
    const ed = editDev(); if (ed) { est = true; x.save(); x.setLineDash([3, 3]); A.vesselPath(x, A.smooth(ed, 1), 1, box); x.strokeStyle = "#8ef0b1"; x.lineWidth = 1.4; x.shadowColor = "rgba(142,240,177,.6)"; x.shadowBlur = 6; x.stroke(); x.restore(); }
  }
  const reg = !n.amp && REGION[n.m.kind];
  if (reg) {
    const NB = FQ.length, yOf = (hz) => box.y + box.h - (A.bandOfHz(hz) / (NB - 1)) * box.h, y0 = yOf(reg[1]), y1 = yOf(reg[0]);
    x.fillStyle = "rgba(142,240,177,.07)"; x.fillRect(0, y0, 72, y1 - y0);
    x.fillStyle = "rgba(142,240,177,.5)"; x.fillRect(0, y0, 3, y1 - y0);
  }
  sheet._cap.textContent = est ? "estimated" : "as made";
  const note = sheet.querySelector(".ms-demo");
  if (note) note.hidden = !est || mode === "new";
}
function openSheet(n, focusSite) {
  if (!n || n.ghost) return;
  if (!sheet) {
    sheet = el("div", { class: "ms", role: "dialog", "aria-modal": "false" });
    document.body.append(sheet);
    // drag the grabber or the title down to put it away
    let d = null;
    sheet.addEventListener("pointerdown", (e) => { if (!e.target.closest(".ms-grab, .ms-head") || e.target.closest("button")) return; d = { y: e.clientY, id: e.pointerId }; try { sheet.setPointerCapture(e.pointerId); } catch {} sheet.style.transition = "none"; });
    sheet.addEventListener("pointermove", (e) => { if (!d) return; const dy = Math.max(0, e.clientY - d.y); sheet.style.transform = `translateY(${dy}px)`; });
    const end = (e) => { if (!d) return; const dy = e.clientY - d.y; d = null; sheet.style.transition = ""; sheet.style.transform = ""; if (dy > 70) closeSheet(); };
    sheet.addEventListener("pointerup", end); sheet.addEventListener("pointercancel", end);
  }
  sheetN = n;
  setActive(n.amp ? "amp" : n.i, false);
  renderSheet(focusSite);
  sheet.classList.add("on"); document.body.classList.add("ms-open");
  n.el?.scrollIntoView?.({ block: "nearest", inline: "center", behavior: A.reduced ? "auto" : "smooth" });
}
function closeSheet() {
  if (!sheet || !sheet.classList.contains("on")) { sheetN = null; return; }
  sheet.classList.remove("on"); document.body.classList.remove("ms-open");
  sheetN = null; if (visible) plates.focus({ preventScroll: true });
}

A.views.patch = {
  mount,
  anchor() { return mode === "new" || !vesselBox ? null : A.pageRect(inner, vesselBox); },
  show() {
    visible = true; root.style.display = "";
    if (A.patchFocus != null && mode === "new") { mode = "patch"; build(); }
    layout();
    // you zoom in through the sound, and it sits at OUT: arrive there, then read leftward
    if (A.patchFocus == null && scroller.scrollWidth > scroller.clientWidth) scroller.scrollLeft = scroller.scrollWidth;
    if (A.patchFocus != null) {
      const i = A.patchFocus; A.patchFocus = null;
      const n = nodes[i];
      if (n) {
        plates.focus({ preventScroll: true }); setActive(i);
        n.el.classList.remove("pulse"); void n.el.offsetWidth; n.el.classList.add("pulse");
        n.el.scrollIntoView?.({ block: "nearest", inline: "center" });
      }
    }
    loop();
  },
  hide() { visible = false; root.style.display = "none"; setCat(false); closeSheet(); },
  key(e) {
    if (e.key === "?") { setOpen(!open); return true; }
    if (e.key === "Home" || e.key === "End") { plates.focus({ preventScroll: true }); setActive(e.key === "Home" ? order[0] : order[order.length - 1]); return true; }
    return false;
  },
};

const css = `
.pt-demo { font-size:11px; color:var(--silk-mute); padding-inline:6px; border-left:1px solid var(--hair); margin-left:2px; }
.ms-demo { flex:none; margin:8px 0 0; font-size:11px; line-height:1.4; color:var(--silk-mute); }
.ms-row-seg > .ms-lab { grid-area:auto; }
.ms-foot { flex:none; display:flex; justify-content:flex-end; padding-top:10px; margin-top:6px; border-top:1px solid var(--hair); }
.ms-rm { height:40px; color:var(--silk-dim); }
.ms-rm:hover, .ms-rm:active { color:var(--red); border-color:rgba(255,87,71,.45); }
.pl-rm { position:absolute; top:6px; right:6px; width:24px; height:24px; border-radius:6px; display:grid; place-items:center; color:var(--silk-mute); border:1px solid transparent; opacity:0; transition:opacity var(--d-state), color var(--d-press), border-color var(--d-press); z-index:2; }
.pl-rm svg { width:13px; height:13px; }
.pl:hover .pl-rm, .pl.on .pl-rm, .pl:focus-within .pl-rm { opacity:1; }
.pl-rm:hover, .pl-rm:focus-visible { color:var(--red); border-color:rgba(255,87,71,.45); background:rgba(255,87,71,.06); }
.pl.ghost .pl-rm { color:var(--amber-dim); }
.pl.ghost .pl-rm:hover { color:var(--amber); border-color:var(--amber-deep); background:rgba(255,180,84,.06); }
@media (pointer: coarse) { .pl-rm { display:none; } .pl.ghost .pl-rm { display:grid; opacity:1; width:36px; height:36px; top:2px; right:2px; } }
.pt-clear:hover { color:var(--red); }
.pt-cat-top { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.pt-cat-x, .pt-cat-grab { display:none; }
.pt-scrim { display:none; }
@media (max-width: 700px) {
  .pt-cat-grab { display:block; width:40px; height:4px; border-radius:2px; background:var(--hair-hi); margin:0 auto 4px; flex:none; touch-action:none; }
  .pt-cat-top { touch-action:none; position:sticky; top:-12px; background:var(--panel); padding:4px 0; z-index:1; }
  .pt-cat-x { display:grid; place-items:center; width:44px; height:44px; border-radius:50%; color:var(--silk-dim); }
  .pt-cat-x svg { width:18px; height:18px; }
  .pt-scrim.on { display:block; position:fixed; inset:0; background:rgba(4,5,6,.5); z-index:56; }
  .pt-cat { background:var(--panel) !important; gap:6px !important; padding-top:8px !important; }
  .pt-cat-top { top:-8px; }
}
.ms { position:fixed; left:0; right:0; bottom:var(--nav-h, 0px); z-index:58; display:flex; flex-direction:column; max-height:60vh; padding:4px 14px 14px;
  background:var(--panel); border:1px solid var(--hair-hi); border-bottom:0; border-radius:18px 18px 0 0; box-shadow:0 -24px 48px -24px rgba(0,0,0,.9);
  transform:translateY(calc(100% + var(--nav-h, 0px))); visibility:hidden; transition:transform var(--d-move) var(--e-settle), visibility 0s linear var(--d-move); }
.ms.on { transform:none; visibility:visible; transition:transform var(--d-move) var(--e-settle), visibility 0s; }
.ms-grab { flex:none; width:40px; height:4px; border-radius:2px; background:var(--hair-hi); margin:6px auto 6px; touch-action:none; }
.ms-head { flex:none; display:flex; align-items:center; justify-content:space-between; gap:10px; touch-action:none; }
.ms-title { display:flex; align-items:center; gap:10px; min-width:0; }
.ms-ico { display:grid; place-items:center; color:var(--green); } .ms-ico svg { width:18px; height:18px; }
.ms-name { font:500 21px/1.1 var(--f-silk); }
.ms-sub { font-size:12px; color:var(--silk-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ms-x { flex:none; width:44px; height:44px; border-radius:50%; display:grid; place-items:center; color:var(--silk-dim); }
.ms-x svg { width:18px; height:18px; }
.ms-body { display:grid; grid-template-columns:minmax(0,1fr) 72px; gap:12px; overflow-y:auto; min-height:0; overscroll-behavior:contain; }
.ms-says { margin:0 0 6px; color:var(--silk-dim); font-size:13px; line-height:1.35; }
.ms-rows { display:grid; gap:6px; }
.ms-row { display:grid; grid-template-columns:44px minmax(0,1fr) 44px; grid-template-areas:"lab lab lab" "minus track plus"; gap:2px 6px; align-items:center; border-radius:10px; padding:2px 0; }
.ms-row > .ms-lab { grid-area:lab; } .ms-row > .ms-step:nth-of-type(1) { grid-area:minus; } .ms-row > .ms-track { grid-area:track; } .ms-row > .ms-step:nth-of-type(2) { grid-area:plus; }
.ms-row.hl { background:rgba(142,240,177,.05); box-shadow:0 0 0 1px var(--green-deep); padding:4px; }
.ms-lab { display:flex; justify-content:space-between; align-items:baseline; gap:8px; padding-inline:2px; }
.ms-n { font:600 11px/1 var(--f-silk); letter-spacing:.16em; text-transform:uppercase; color:var(--silk); }
.ms-val { font-size:13px; color:var(--silk-dim); font-variant-numeric:tabular-nums; }
.ms-row.moved .ms-val { color:var(--green); }
.ms-step { width:44px; height:44px; border-radius:10px; border:1px solid var(--hair-hi); background:var(--panel-hi); color:var(--silk); font:400 20px/1 var(--f-mono); display:grid; place-items:center; touch-action:manipulation; user-select:none; -webkit-user-select:none; }
.ms-step:active { background:var(--plate); }
.ms-track { position:relative; height:44px; touch-action:none; cursor:pointer; border-radius:10px; }
.ms-rail { position:absolute; left:14px; right:14px; top:50%; height:4px; margin-top:-2px; border-radius:2px; background:var(--hair-hi); }
.ms-fill { position:absolute; top:50%; height:4px; margin-top:-2px; border-radius:2px; background:var(--green); box-shadow:0 0 8px var(--green-glow); }
.ms-mark { position:absolute; top:50%; width:2px; height:14px; margin:-7px 0 0 -1px; background:var(--silk-mute); border-radius:1px; }
.ms-thumb { position:absolute; top:50%; width:26px; height:26px; margin:-13px 0 0 -13px; border-radius:50%; background:radial-gradient(circle at 40% 35%, #3a414b, #1a1d22); border:2px solid var(--green); box-shadow:0 2px 6px rgba(0,0,0,.6); }
.ms-row-seg { grid-template-columns:1fr; grid-template-areas:none; }
.ms-seg { display:flex; gap:4px; flex-wrap:wrap; }
.ms-seg button { flex:1; min-width:64px; height:40px; border-radius:10px; border:1px solid var(--hair-hi); font:600 10px/1 var(--f-silk); letter-spacing:.14em; text-transform:uppercase; color:var(--silk-dim); }
.ms-seg button[aria-checked="true"] { color:var(--green); border-color:var(--green-deep); background:rgba(142,240,177,.06); }
.ms-dev { height:44px; width:100%; border-radius:10px; background:var(--panel-hi); color:var(--silk); border:1px solid var(--hair-hi); font-size:15px; padding:0 10px; }
.ms-fixed { color:var(--silk-dim); font-size:13px; }
.ms-fig { margin:0; display:grid; justify-items:center; align-content:start; gap:4px; position:sticky; top:0; }
.ms-fig figcaption { font:400 11px/1 var(--f-mono); color:var(--silk-mute); }
@media (min-width: 701px) and (min-height: 501px) { .ms { left:auto; right:24px; bottom:24px; width:420px; border-radius:16px; border-bottom:1px solid var(--hair-hi); } }
@media (max-height: 500px) { .ms { top:8px; bottom:8px; left:auto; right:8px; width:min(420px, 58vw); max-height:none; border-radius:16px; border-bottom:1px solid var(--hair-hi); transform:translateX(calc(100% + 16px)); } .ms.on { transform:none; } }
.pt { position:absolute; inset:0; display:grid; grid-template-rows:auto 1fr; gap:var(--s4); padding:var(--s5) var(--s5) 72px; }
.pt-head { display:flex; align-items:flex-end; justify-content:space-between; gap:var(--s4); }
.pt-head .display { margin-bottom:8px; }
.pt-headacts { display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end; }
.pt-headacts .btn { height:34px; padding-inline:12px; }
.pt-well { min-height:0; }
.pt-scroll { position:absolute; inset:0; overflow:auto; border-radius:inherit; scrollbar-width:thin; scrollbar-color:var(--hair-hi) transparent; }
.pt-inner { position:relative; height:100%; }
.pt-inner > canvas { position:absolute; left:0; top:0; }
.pt-plates { position:absolute; inset:0; outline:none; }
.pt-plates:focus-visible { box-shadow:0 0 0 2px var(--green-deep) inset; border-radius:var(--r3); }
.pl {
  position:absolute; display:flex; flex-direction:column; gap:8px; padding:10px 12px; border-radius:var(--r2);
  background:linear-gradient(180deg, var(--plate), var(--panel-hi)); border:1px solid var(--hair-hi);
  box-shadow:0 1px 0 rgba(255,255,255,.04) inset, 0 10px 24px -14px rgba(0,0,0,.9);
  transition:transform var(--d-state) var(--e-settle), border-color var(--d-state), box-shadow var(--d-state); cursor:default;
}
.pl.cv { background:linear-gradient(180deg, #181c21, #14171b); border-style:dashed; border-color:#3a414b; }
.pl.on { transform:translateY(-3px); border-color:var(--green-dim); box-shadow:0 0 0 1px rgba(142,240,177,.25), 0 16px 30px -14px rgba(0,0,0,.95), 0 0 24px -8px var(--green-glow); }
.pl.path { border-color:#3f5a4a; }
.pl.twin { border-color:var(--green-dim); box-shadow:0 0 0 1px rgba(142,240,177,.2), 0 0 20px -8px var(--green-glow); }
.pl.pulse { animation:plpulse 1.2s var(--e-settle); }
@keyframes plpulse { 0% { box-shadow:0 0 0 0 rgba(142,240,177,.7); } 60% { box-shadow:0 0 0 14px rgba(142,240,177,0); } 100% { box-shadow:0 0 0 0 rgba(142,240,177,0); } }
.pl-top { display:flex; align-items:baseline; gap:8px; min-width:0; }
.pl-name { flex:none; max-width:100%; font:600 var(--t-label)/1 var(--f-silk); letter-spacing:.18em; text-transform:uppercase; color:var(--silk); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pl.cv .pl-name { color:var(--silk-dim); }
.pl.on .pl-name { color:var(--green); }
.pl-sub { min-width:0; margin-left:auto; font:400 12px/1 var(--f-mono); color:var(--silk-mute); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pl-ed { display:none; font:400 11px/1 var(--f-mono); color:var(--green); }
.pl.edited { border-color:var(--green-deep); }
.pl.edited .pl-ed { display:inline; }
.pl.edited .pl-sub { display:none; }
.pl-knobs { display:flex; gap:10px; }
.pk { display:grid; justify-items:center; gap:1px; min-width:30px; border-radius:4px; cursor:ns-resize; touch-action:none; }
.pk:focus-visible { outline:2px solid var(--green); outline-offset:2px; }
.pk canvas { width:22px; height:22px; }
.pk-v { font:400 12px/1.1 var(--f-mono); color:var(--silk-dim); }
.pl.on .pk-v, .pk.moved .pk-v, .pk.moved .pk-chip { color:var(--green); }
.pk-n { font:400 11px/1.1 var(--f-mono); color:var(--silk-mute); }
.pk-chip { font:500 12px/22px var(--f-mono); color:var(--silk-dim); height:22px; }
.pl-adsr canvas { display:block; width:96px; height:30px; }
.pl-adsrv { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:2px; font:400 11px/1.1 var(--f-mono); color:var(--silk-mute); }
.pl-adsrv b { display:block; font-weight:400; font-size:12px; color:var(--silk-dim); }
.pl.ghost { background:rgba(255,180,84,.035); border:1.5px dashed var(--amber-dim); box-shadow:none; cursor:pointer; }
.pl.ghost .pl-name { color:var(--amber); }
.pl.ghost .pl-sub { color:var(--amber-dim); }
.pl.ghost:hover, .pl.ghost.on { transform:translateY(-2px); border-color:var(--amber); box-shadow:0 0 24px -8px var(--amber-glow); }
.pl.ghost-mix { opacity:.75; }
.pl-sug { font:600 10px/1 var(--f-silk); letter-spacing:.16em; text-transform:uppercase; color:var(--amber-dim); }
.pl-why { font:400 12px/1.35 var(--f-mono); color:var(--amber-dim); }
.pl.ain { gap:6px; }
.pl.ain .pl-sub { display:none; }
.pl-inrow { display:flex; align-items:center; gap:8px; min-width:0; }
.pl-inrow .pl-dev { flex:1; }
.pl-inrow .pk { grid-template-rows:22px auto; }
.pl-inrow .pk-v { display:none; }
.pl-dev { width:100%; min-width:0; font:400 12px/1.2 var(--f-mono); color:var(--silk); background:var(--rack); border:1px solid var(--hair-hi); border-radius:4px; padding:4px 6px; }
.pl-dev:focus-visible { outline:2px solid var(--green); outline-offset:1px; }
.pl-modes { display:grid; grid-template-columns:1fr 1fr; gap:3px; }
.pl-mode { font:400 11px/1 var(--f-mono); color:var(--silk-mute); border:1px solid var(--hair); border-radius:3px; padding:4px 0; }
.pl-mode:hover { color:var(--silk); border-color:var(--hair-hi); }
.pl-mode[aria-pressed="true"] { color:var(--green); border-color:var(--green-deep); background:rgba(142,240,177,.06); }
.pl-shared { font:400 11px/1 var(--f-mono); color:var(--green); }
.pl-shared[hidden] { display:none; }
.pt-read { position:absolute; left:18px; top:14px; right:18px; display:flex; align-items:baseline; gap:12px; pointer-events:none; min-height:20px; z-index:2; }
.pt-read-name { flex:none; font:600 var(--t-label)/1 var(--f-silk); letter-spacing:.18em; text-transform:uppercase; color:var(--green); }
.pt-read-says { font-size:14px; color:var(--silk); }
.pt-legend { position:absolute; left:16px; right:16px; bottom:14px; display:flex; flex-wrap:wrap; align-items:center; gap:8px 22px; padding:10px 14px; border-radius:var(--r2); background:var(--panel); border:1px solid var(--hair); animation:nextin var(--d-state) var(--e-settle); z-index:4; }
.pt-well.new .pt-legend { left:202px; }
.pt-legend[hidden] { display:none; }
.pt-legend > .cap { margin:0 !important; }
.pt-leg { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--silk-dim); }
.pt-leg canvas { width:44px; height:22px; flex:none; }
.pt-leg-note { margin:0 0 0 auto; font:400 12px/1.4 var(--f-mono); color:var(--silk-mute); }
.pt-editbar { display:flex; align-items:center; gap:2px; padding:3px 4px 3px 12px; border-radius:999px; border:1px solid var(--green-deep); background:var(--panel-hi); animation:nextin var(--d-state) var(--e-settle); }
.pt-editbar[hidden] { display:none; }
.pt-editbar .mono { font-size:12px; color:var(--green); margin-right:6px; }
.pt-editbar button { font:600 10px/1 var(--f-silk); letter-spacing:.16em; text-transform:uppercase; color:var(--silk-dim); padding:7px 8px; border-radius:999px; }
.pt-editbar button:hover { color:var(--silk); background:var(--plate); }
.pt-editbar button[aria-pressed="true"] { color:var(--green); }
.pt-editbar .sep { color:var(--silk-mute); }
.pt-cat { position:absolute; left:12px; top:52px; bottom:14px; width:172px; overflow-y:auto; display:flex; flex-direction:column; gap:12px; padding:12px 10px; border-radius:var(--r2); background:rgba(19,22,26,.9); border:1px solid var(--hair); z-index:3; scrollbar-width:thin; scrollbar-color:var(--hair-hi) transparent; }
.pt-cat[hidden] { display:none; }
.pt-cat-title { color:var(--silk-dim); padding-left:6px; }
.pt-cat-g { display:grid; gap:1px; }
.pt-cat-h { display:flex; align-items:center; gap:6px; font:600 10px/1 var(--f-silk); letter-spacing:.18em; text-transform:uppercase; color:var(--silk-mute); margin:0 0 4px 6px; }
.pt-cat-h svg { width:14px; height:14px; }
.pt-cat-it { display:flex; align-items:center; gap:8px; text-align:left; padding:5px 6px; border-radius:4px; font:400 13px/1.1 var(--f-silk); color:var(--silk-dim); }
.pt-cat-it .ic { display:grid; place-items:center; width:16px; height:16px; color:var(--green-dim); }
.pt-cat-it .ic svg { width:15px; height:15px; }
.pt-cat-it:hover, .pt-cat-it:focus-visible { background:var(--panel-hi); color:var(--silk); }
.pt-cat-it .sug { margin-left:auto; width:7px; height:7px; border-radius:50%; background:var(--amber); box-shadow:0 0 8px var(--amber-glow); }
.pt-choice { position:absolute; left:50%; top:52%; transform:translate(-50%, -58%); display:grid; gap:14px; justify-items:center; z-index:4; text-align:center; }
.pt-choice[hidden] { display:none; }
.pt-choice-row { display:flex; gap:12px; }
.pt-choice-btn { display:grid; gap:6px; justify-items:start; text-align:left; width:220px; padding:16px 16px 18px; border-radius:var(--r2); border:1px solid var(--hair-hi); background:var(--panel-hi); transition:border-color var(--d-state), transform var(--d-press); }
.pt-choice-btn:hover, .pt-choice-btn:focus-visible { border-color:var(--green-dim); }
.pt-choice-btn:active { transform:translateY(1px); }
.pt-choice-btn .ic { color:var(--green); display:grid; }
.pt-choice-btn .ic svg { width:22px; height:22px; }
.pt-choice-btn b { font:500 18px/1.1 var(--f-silk); color:var(--silk); }
.pt-choice-btn > span:last-child { font-size:13px; color:var(--silk-dim); }
.pt-choice-note { margin:0; font-size:13px; color:var(--silk-mute); }
.pt-add { display:none !important; }
.pt-edge { position:absolute; top:44px; bottom:12px; width:44px; z-index:3; display:flex; align-items:center; gap:2px; padding:0 6px; color:var(--silk-dim); font:500 12px/1 var(--f-mono); }
.pt-edge[hidden] { display:none; }
.pt-edge.l { left:1px; justify-content:flex-start; border-radius:var(--r3) 0 0 var(--r3); background:linear-gradient(90deg, rgba(7,8,10,.95), rgba(7,8,10,0)); }
.pt-edge.r { right:1px; justify-content:flex-end; border-radius:0 var(--r3) var(--r3) 0; background:linear-gradient(270deg, rgba(7,8,10,.95), rgba(7,8,10,0)); }
.pt-edge b { font-weight:500; color:var(--green-dim); }
.pt-edge:hover, .pt-edge:focus-visible { color:var(--silk); }
body.touch .pt kbd { display:none; }
@media (pointer: coarse) { .pt kbd { display:none; } }
@media (max-height: 500px) {
  .pt { padding:10px 16px 10px; gap:8px; }
  .pt-head .display { font-size:26px; margin-bottom:2px; }
  .pt-head .blurb, .pt-head .pf-eyebrow { display:none; }
  .pt-cat { top:8px; bottom:8px; }
  .pt-choice { top:50%; transform:translate(-50%, -50%); gap:8px; }
  .pt-choice-row { flex-direction:row; }
  .pt-choice-btn { width:200px; padding:10px 12px; }
  .pt-choice-note { display:none; }
  .pt-legend { bottom:8px; padding:6px 10px; }
}
.pl.ghost.grow { animation:ghostgrow 480ms var(--e-settle) 200ms both; }
.pl.ghost.grow.from-right { transform-origin:100% 50%; }
.pl.ghost.grow.from-top { transform-origin:50% 0; }
@keyframes ghostgrow { from { opacity:0; transform:scale(.2); } 60% { opacity:1; } }
.pl.ghost .pl-sug { margin-top:-2px; }
@media (pointer: coarse) {
  .pk { min-width:44px; min-height:44px; align-content:center; }
  .pl-mode { padding:9px 0; font-size:12px; }
  .pl-dev { min-height:36px; font-size:14px; }
  .pl-knobs { gap:4px; }
}
@media (max-width: 980px) { .pt-head { flex-wrap:wrap; } }
@media (max-width: 700px) {
  .pt { padding:14px 12px 12px; gap:10px; }
  .pt-head { flex-direction:column; align-items:stretch; }
  .pt-head .display { font-size:32px; }
  .pt-headacts { justify-content:flex-start; }
  .pt-add { display:inline-flex !important; }
  .pt-cat { position:fixed; left:0; right:0; top:auto; bottom:var(--nav-h, 0px); width:auto; max-height:52vh; border-radius:16px 16px 0 0; z-index:57; transform:translateY(calc(100% + var(--nav-h, 0px))); visibility:hidden; transition:transform var(--d-move) var(--e-settle), visibility 0s linear var(--d-move); box-shadow:0 -20px 40px -20px rgba(0,0,0,.9); }
  .pt-cat.open { transform:none; visibility:visible; transition:transform var(--d-move) var(--e-settle), visibility 0s; }
  .pt-well.new .pt-legend { left:16px; }
  .pt-choice-row { flex-direction:column; }
  .pt-choice-btn { width:min(280px, 78vw); }
  .pt-leg-note { margin:0; }
}
`;
document.head.append(el("style", {}, css));
})();
