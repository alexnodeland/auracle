// Auracle vision prototype: the core. Data, the vessel (every sound's face),
// the audio engine, a small learning model, and the frame every view shares:
// header, bank, keys, palette, lens, toasts, the first-visit guide.
(() => {
"use strict";
const D = window.AURACLE_DATA;
const A = (window.A = { D, presets: D.presets, views: {}, cmds: [] });
A.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s, r = document) => r.querySelector(s);
A.$ = $;
A.el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};
const el = A.el;

// ---------------------------------------------------------------- icons
// The brand set's grammar: 24 px grid, 2 px stroke, currentColor.
const ICON = {
  perform: '<circle cx="12" cy="13" r="7"/><path d="M12 13l3.6-4.2"/><path d="M12 3.2v1.6"/>',
  patch: '<path d="M6.5 11.9c0 8 11 8 11 0"/><circle cx="6.5" cy="9" r="2.9"/><circle cx="17.5" cy="9" r="2.9"/>',
  evolve: '<path d="M4.5 18.8 12 5.2l7.5 13.6"/><path d="M8 13.5h8"/>',
  taste: '<path d="M3 19h18"/><path d="M3 16c4.5 0 4.5-11 9-11s4.5 11 9 11"/>',
  play: '<path d="M8.5 6.2v11.6l9.3-5.8z" fill="currentColor"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.6" fill="currentColor"/>',
  star: '<path d="M12 4.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.6l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z"/>',
  save: '<path d="M6 4.5h9.5L19 8v11.5H6z"/><path d="M9 4.5v4.5h6"/><path d="M9 19.5V14h7v5.5"/>',
  cut: '<path d="M7 7l10 10M17 7L7 17"/>',
  search: '<circle cx="10.8" cy="10.8" r="6"/><path d="M19.5 19.5l-4.4-4.4"/>',
  chev: '<path d="M9.5 6l6 6-6 6"/>',
  x: '<path d="M7.5 7.5l9 9M16.5 7.5l-9 9"/>',
  undo: '<path d="M9 6.5L5 10.5l4 4"/><path d="M5 10.5h9.5a4.5 4.5 0 0 1 0 9H12"/>',
  again: '<path d="M18.5 12a6.5 6.5 0 1 1-1.9-4.6"/><path d="M18.5 4.5v4h-4"/>',
  notes: '<path d="M6.5 4h11v16h-11z"/><path d="M9.5 9h5M9.5 12.5h5M9.5 16h3"/>',
  bank: '<path d="M4.5 6.5h15M4.5 12h15M4.5 17.5h9"/>',
  keys: '<rect x="3.5" y="6" width="17" height="12" rx="1.5"/><path d="M8 6v7M12 6v7M16 6v7"/>',
  model: '<path d="M7 18v-6"/><path d="M12 18V6"/><path d="M17 18v-8.5"/>',
  teach: '<path d="M7 18v-6"/><path d="M12 18V6"/><path d="M17 18v-8.5"/>',
  share: '<path d="M12 4v11"/><path d="M8 8l4-4 4 4"/><path d="M5 13v6h14v-6"/>',
  stage: '<rect x="3.5" y="5" width="17" height="12" rx="1.5"/><path d="M9 20h6"/>',
  drop: '<path d="M12 4v10"/><path d="M8 10l4 4 4-4"/><path d="M5 17.5h14"/>',
  ask: '<circle cx="12" cy="12" r="8.5"/><path d="M9.8 9.6a2.3 2.3 0 1 1 3.2 2.1c-.7.3-1 .8-1 1.5v.4"/><path d="M12 16.6v.1"/>',
  input: '<circle cx="12" cy="9" r="3.2"/><path d="M12 12.2V20"/><path d="M8.5 20h7"/><path d="M6.5 9a5.5 5.5 0 0 0 11 0"/>',
  lamp: '<circle cx="12" cy="12" r="3.2" fill="currentColor"/><circle cx="12" cy="12" r="7.5" stroke-opacity=".35"/>',
  map: '<circle cx="7" cy="8" r="1.6"/><circle cx="15" cy="6.5" r="1.6"/><circle cx="11" cy="14" r="1.6"/><circle cx="17.5" cy="16.5" r="1.6"/><circle cx="6" cy="17" r="1.6"/>',
};
A.icon = (n, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

// ---------------------------------------------------------------- data
const NB = D.bands_hz.length;
const MEAN = D.mean_db, SD = D.sd_db;
const sig = (x) => 1 / (1 + Math.exp(-x));
A.sig = sig;
const smooth = (a, k = 1) => a.map((v, i) => { let s = 0, n = 0; for (let j = -k; j <= k; j++) { const x = a[i + j]; if (x != null) { s += x; n++; } } return s / n; });
A.smooth = smooth;
// A spectrum (dB re its own peak) against the bank's average, in bank SDs:
// the vessel bulges where this sound differs from the others.
A.devOf = (p, extra) => {
  const row = p.ltas_db.map((v, i) => v + (extra ? extra[i] : 0));
  const mx = Math.max(...row);
  return row.map((v, i) => (v - mx - MEAN[i]) / SD);
};
A.byId = new Map();
for (const p of A.presets) { p.dev = A.devOf(p); A.byId.set(p.id, p); }
A.find = (name) => A.presets.find((p) => p.name === name);
A.bandOfHz = (hz) => { let best = 0; D.bands_hz.forEach((f, i) => { if (Math.abs(Math.log(f / hz)) < Math.abs(Math.log(D.bands_hz[best] / hz))) best = i; }); return best; };

// ---------------------------------------------------------------- the vessel
// Frequency runs up the vessel (low at the base), width is how much this sound
// has at that frequency compared with the bank, and the faint inner layers are
// its phrase over time, each as loud as it was.
function vesselPath(ctx, arr, scale, box) {
  const n = arr.length, cx = box.x + box.w / 2, R = box.w / 2;
  const pts = arr.map((v, i) => [R * sig(v * 1.4) * scale, box.y + box.h - (i / (n - 1)) * box.h]);
  const all = pts.map(([w, y]) => [cx + w, y]).concat(pts.slice().reverse().map(([w, y]) => [cx - w, y]));
  ctx.beginPath();
  const m = all.length;
  ctx.moveTo((all[m - 1][0] + all[0][0]) / 2, (all[m - 1][1] + all[0][1]) / 2);
  for (let i = 0; i < m; i++) { const p = all[i], q = all[(i + 1) % m]; ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); }
  ctx.closePath();
}
A.vesselPath = vesselPath;
A.face = (ctx, s, p, o = {}) => {
  const pad = o.pad ?? s * 0.06;
  const box = o.box || { x: pad, y: pad, w: s - 2 * pad, h: s - 2 * pad };
  const k = s < 36 ? 2 : 1;
  const dev = smooth(o.dev || p.dev, k);
  const col = o.rgb || "142,240,177";
  const dim = o.dim ?? 1;
  if (o.layers !== false) {
    p.sdev.forEach((sl, t) => {
      const l = p.sloud[t]; if (l < 0.25) return;
      vesselPath(ctx, smooth(sl, k), 0.35 + 0.65 * l, box);
      ctx.fillStyle = `rgba(${col},${(0.05 + 0.11 * l) * dim})`; ctx.fill();
    });
  }
  if (o.hi) {
    const [b0, b1] = o.hi;
    const y0 = box.y + box.h - (b1 / (NB - 1)) * box.h, y1 = box.y + box.h - (b0 / (NB - 1)) * box.h;
    ctx.save(); ctx.beginPath(); ctx.rect(0, y0, s * 4, y1 - y0); ctx.clip();
    vesselPath(ctx, dev, 1, box); ctx.fillStyle = `rgba(${col},${0.22 * dim})`; ctx.fill(); ctx.restore();
  }
  vesselPath(ctx, dev, 1, box);
  if (o.glow) { ctx.shadowColor = `rgba(${col},${0.65 * dim})`; ctx.shadowBlur = o.glow; }
  ctx.strokeStyle = `rgba(${col},${(o.alpha ?? 1) * dim})`;
  ctx.lineWidth = o.lw || Math.max(1, s / 70);
  ctx.stroke(); ctx.shadowBlur = 0;
  if (o.live) {
    vesselPath(ctx, smooth(o.live, 1), 1, box);
    ctx.strokeStyle = "rgba(226,255,236,.95)"; ctx.lineWidth = Math.max(1.2, s / 170);
    ctx.shadowColor = `rgba(${col},.95)`; ctx.shadowBlur = 14; ctx.stroke(); ctx.shadowBlur = 0;
  }
  return box;
};
A.canvas = (cssW, cssH = cssW) => {
  const c = document.createElement("canvas"), d = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(cssW * d); c.height = Math.round(cssH * d);
  c.style.width = cssW + "px"; c.style.height = cssH + "px";
  const x = c.getContext("2d"); x.scale(d, d);
  return [c, x];
};
A.faceCanvas = (p, size, o = {}) => {
  if (!o.h && !o.margin) { const [c, x] = A.canvas(size); A.face(x, size, p, o); c.setAttribute("aria-hidden", "true"); return c; }
  // a vessel in the same box a view draws it in (the big wells use w = 0.6 h), with room for its glow
  const w = size, h = o.h || size, m = o.margin || 0, pad = o.pad ?? 0;
  const [c, x] = A.canvas(w + 2 * m, h + 2 * m);
  A.face(x, h, p, { ...o, box: o.box || { x: m + pad, y: m + pad, w: w - 2 * pad, h: h - 2 * pad } });
  c.setAttribute("aria-hidden", "true"); c.dataset.margin = m; return c;
};
A.TOUCH = matchMedia("(hover: none) and (pointer: coarse)").matches;
const seen = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight ? r : null; };
A.seen = seen;
// A face travelling from one place to another (a save to its shelf, a lesson to TAUGHT).
A.flyFace = (p, from, to, { dur = 460, size, done, land = false } = {}) => {
  if (A.reduced || !from || !to) { done?.(); return; }
  // landing = arriving in a view's own box, at full size and opacity, so the view takes over without a seam
  const box = land ? to : from, tall = box.width / box.height < 0.9;
  const s = land ? to.height : size || from.height, sw = tall ? (box.width / box.height) * s : s;
  const c = tall ? A.faceCanvas(p, sw, { h: s, glow: land ? 22 : 8 }) : A.faceCanvas(p, s, { glow: 8 });
  const k0 = land ? from.height / s : 1, k1 = land ? 1 : Math.min(1, (to.height * 0.8) / s);
  Object.assign(c.style, { position: "fixed", left: from.left + from.width / 2 - sw / 2 + "px", top: from.top + from.height / 2 - s / 2 + "px", zIndex: 90, pointerEvents: "none", transformOrigin: "50% 50%" });
  document.body.append(c);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2), dy = to.top + to.height / 2 - (from.top + from.height / 2);
  c.animate([{ transform: `translate(0,0) scale(${k0})`, opacity: 1 }, { transform: `translate(${dx * 0.5}px,${dy * 0.5 - 18}px) scale(${(k0 + k1) / 2})`, opacity: 1, offset: 0.55 }, { transform: `translate(${dx}px,${dy}px) scale(${k1})`, opacity: land ? 1 : 0.2 }],
    { duration: dur, easing: "cubic-bezier(.6,0,.2,1)" }).onfinish = () => { c.remove(); done?.(); };
};
// Choosing a sound from the bank: its face leaves the row and lands in your hands, in
// whichever view you are in (where that view draws the sound in hand).
A.takeUp = (p, src) => {
  const r = seen(src);
  A.setInHand(p.id, { play: true });
  if (A.reduced || !r) return;
  A.morphing = true; A.emit("morphstart", A.state.view);
  requestAnimationFrame(() => {
    const a = A.views[A.state.view]?.anchor?.(), to = a ? { left: a.x, top: a.y, width: a.w, height: a.h } : seen(document.querySelector(".inhand canvas"));
    A.flyFace(p, r, to, { land: !!a, dur: 520, done: () => { A.morphing = false; A.emit("morphend", A.state.view); } });
  });
};
// A face falling to dust (a cut), or gathering back from it (its undo).
A.dust = (src, { reverse = false, done } = {}) => {
  const r = seen(src);
  if (A.reduced || !r || !src.getContext) { done?.(); return; }
  let img; try { img = src.getContext("2d").getImageData(0, 0, src.width, src.height).data; } catch { done?.(); return; }
  const w = src.width, h = src.height, step = Math.max(1, Math.round(w / 30)), parts = [];
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const i = (y * w + x) * 4, a = img[i + 3]; if (a < 40) continue;
    parts.push({ x: r.left + (x / w) * r.width, y: r.top + (y / h) * r.height, c: `${img[i]},${img[i + 1]},${img[i + 2]}`, a: a / 255, vx: (Math.random() - 0.5) * 2.2, vy: -Math.random() * 1.4, lag: Math.random() * 0.25 });
  }
  const [cv, cx] = A.canvas(innerWidth, innerHeight); cv.style.cssText = "position:fixed;left:0;top:0;pointer-events:none;z-index:90"; document.body.append(cv);
  const D = 760, t0 = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - t0) / D); cx.clearRect(0, 0, innerWidth, innerHeight);
    for (const q of parts) {
      let s = Math.max(0, Math.min(1, ((reverse ? 1 - t : t) - q.lag) / (1 - q.lag)));
      const al = q.a * (1 - s); if (al < 0.02) continue;
      cx.fillStyle = `rgba(${q.c},${al})`; cx.fillRect(q.x + q.vx * s * 26, q.y + q.vy * s * 16 + 46 * s * s, 1.6, 1.6);
    }
    if (t < 1) requestAnimationFrame(tick); else { cv.remove(); done?.(); }
  };
  requestAnimationFrame(tick);
};
// A number that rolls: up when it grows, down when it is taken back.
A.roll = (elm, text) => {
  if (!elm) return;
  const cur = elm.querySelector(".roll-cur"), old = cur ? cur.textContent : elm.textContent;
  if (old === String(text)) return;
  const up = parseFloat(text) >= parseFloat(old) || isNaN(parseFloat(old));
  elm.classList.add("roll"); elm.replaceChildren();
  const a = el("span", { class: "roll-old", "aria-hidden": "true" }, old), b = el("span", { class: "roll-cur" }, String(text));
  elm.append(a, b);
  if (A.reduced) { a.remove(); return; }
  a.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: `translateY(${up ? -100 : 100}%)`, opacity: 0 }], { duration: 260, easing: "cubic-bezier(.6,0,.2,1)", fill: "forwards" }).onfinish = () => a.remove();
  b.animate([{ transform: `translateY(${up ? 100 : -100}%)`, opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" });
};

// ---------------------------------------------------------------- patch trees
// The presets' real trees (canonical JSON from the engine), read into modules
// in signal order: each with its kind, its own knobs, its depth and its parent.
const KIND = { Vco: "VCO", Supersaw: "SUPERSAW", Wavetable: "WAVETABLE", Noise: "NOISE", Pluck: "PLUCK", Op: "SHAPE CV", Pair: "COMBINE CV", Granular: "GRANULAR", Formant: "FORMANT", Filter: "FILTER", Eq: "EQ", Distortion: "DISTORTION", Fold: "WAVEFOLDER", Bitcrush: "BITCRUSH", RingMod: "RING MOD", Chorus: "CHORUS", Flanger: "FLANGER", Phaser: "PHASER", Delay: "DELAY", Reverb: "REVERB", Comp: "COMPRESSOR", Duck: "DUCKER", Gate: "GATE", Tremolo: "TREMOLO", Vibrato: "VIBRATO", Shift: "PITCH SHIFT", Vocoder: "VOCODER", Mix: "MIX", Lfo: "LFO", Env: "MOD ENV", Steps: "STEPS", Rand: "S&H RAND", Follow: "FOLLOWER", Euclid: "EUCLID", AudioIn: "AUDIO IN" };
const MOD_KINDS = new Set(["Lfo", "Env", "Steps", "Rand", "Follow", "Euclid", "Op", "Pair"]);
A.KIND = KIND; A.MOD_KINDS = MOD_KINDS;
A.modulesOf = (tree) => {
  const out = [];
  const walk = (node, depth, role, parent) => {
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if (!KIND[k]) continue;
      const params = {}, kids = [];
      for (const [pk, pv] of Object.entries(v || {})) {
        if (pv && typeof pv === "object" && Object.keys(pv).some((x) => KIND[x])) kids.push([pk, pv]);
        else if (typeof pv !== "object") params[pk] = pv;
      }
      const m = { i: out.length, kind: k, label: KIND[k], params, depth, role, parent, mod: MOD_KINDS.has(k) };
      out.push(m);
      for (const [pk, pv] of kids) walk(pv, depth + 1, pk, m.i);
    }
  };
  walk(tree.root, 0, "out", -1);
  return out;
};

// ---------------------------------------------------------------- events + state
const bus = new EventTarget();
A.on = (t, f) => bus.addEventListener(t, (e) => f(e.detail));
A.emit = (t, d) => bus.dispatchEvent(new CustomEvent(t, { detail: d }));
const START = A.find("Reese") || A.presets[0];
A.state = { view: "perform", inHand: START.id, taught: 0, saved: new Set(), cut: new Set(), stars: {}, fx: {}, lens: false, lensHeld: false };
A.fxOf = (id) => (A.state.fx[id] ||= { bright: 0.5, body: 0.5, snap: 0.5, motion: 0, grit: 0, space: 0 });
A.inHand = () => A.byId.get(A.state.inHand);
A.setInHand = (id, { play = false } = {}) => {
  A.state.inHand = id; A.emit("inhand", A.byId.get(id));
  if (play) A.audio.play(A.byId.get(id));
};
// Teaching the model: when the caller says where it came from, an amber spark
// carries it to TAUGHT, and the count rolls when it lands.
A.teach = (n = 1, from) => {
  A.state.taught += n;
  const to = seen(document.querySelector("#taught")), r = from && (from.getBoundingClientRect ? seen(from) : from);
  if (!A.reduced && r && to && n > 0) spark(r, to, () => A.emit("taught", A.state.taught));
  else A.emit("taught", A.state.taught);
};
function spark(from, to, done) {
  const d = el("span", { class: "spark", "aria-hidden": "true" }); document.body.append(d);
  const x0 = from.left + from.width / 2, y0 = from.top + from.height / 2, x1 = to.left + to.width / 2, y1 = to.top + to.height / 2;
  Object.assign(d.style, { left: x0 + "px", top: y0 + "px" });
  const mx = (x1 - x0) * 0.5, my = Math.min(y1 - y0, 0) * 0.5 - 60;
  d.animate([{ transform: "translate(-50%,-50%) scale(.6)", opacity: 0 }, { transform: `translate(calc(-50% + ${mx}px), calc(-50% + ${my}px)) scale(1)`, opacity: 1, offset: 0.45 }, { transform: `translate(calc(-50% + ${x1 - x0}px), calc(-50% + ${y1 - y0}px)) scale(.5)`, opacity: 0.9 }],
    { duration: 560, easing: "cubic-bezier(.5,0,.3,1)" }).onfinish = () => { d.remove(); done(); };
}

// ---------------------------------------------------------------- audio
const AU = (A.audio = { ctx: null, bufs: new Map(), phrase: null, notes: new Map(), playingId: null });
const b64ToBuf = (url) => { const s = atob(url.split(",")[1]); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
AU.ensure = () => {
  if (AU.ctx) { if (AU.ctx.state === "suspended") AU.ctx.resume(); return AU.ctx; }
  const c = (AU.ctx = new (window.AudioContext || window.webkitAudioContext)());
  const g = (n) => { const x = c.createGain(); x.gain.value = n; return x; };
  const bq = (type, f, q = 0.707) => { const x = c.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; };
  AU.input = g(1);
  AU.shaper = c.createWaveShaper(); AU.shaper.oversample = "2x";
  AU.lp = bq("lowpass", 18000); AU.hs = bq("highshelf", 3000); AU.ls = bq("lowshelf", 180);
  AU.mo = bq("lowpass", 20000, 1.2);
  AU.lfo = c.createOscillator(); AU.lfoGain = g(0); AU.lfo.connect(AU.lfoGain).connect(AU.mo.frequency); AU.lfo.frequency.value = 1; AU.lfo.start();
  AU.dry = g(1); AU.wet = g(0); AU.conv = c.createConvolver(); AU.conv.buffer = impulse(c, 2.6);
  AU.master = g(0.8);
  // a limiter, not a colour: nothing leaves above about -6 dBFS, however the controls are set
  AU.comp = c.createDynamicsCompressor(); AU.comp.threshold.value = -9; AU.comp.knee.value = 0; AU.comp.ratio.value = 20; AU.comp.attack.value = 0.002; AU.comp.release.value = 0.12;
  AU.an = c.createAnalyser(); AU.an.fftSize = 4096; AU.an.smoothingTimeConstant = 0.72;
  AU.input.connect(AU.shaper).connect(AU.lp).connect(AU.hs).connect(AU.ls).connect(AU.mo);
  AU.mo.connect(AU.dry).connect(AU.master); AU.mo.connect(AU.conv).connect(AU.wet).connect(AU.master);
  AU.master.connect(AU.comp).connect(AU.an).connect(c.destination);
  AU.freq = new Float32Array(AU.an.frequencyBinCount);
  const edges = [D.bands_hz[0] / Math.sqrt(D.bands_hz[1] / D.bands_hz[0])];
  for (let i = 0; i < NB - 1; i++) edges.push(Math.sqrt(D.bands_hz[i] * D.bands_hz[i + 1]));
  edges.push(D.bands_hz[NB - 1] * Math.sqrt(D.bands_hz[NB - 1] / D.bands_hz[NB - 2]));
  AU.binsOf = edges.slice(0, -1).map((lo, i) => { const hi = edges[i + 1], hz = c.sampleRate / AU.an.fftSize; return [Math.max(1, Math.floor(lo / hz)), Math.max(Math.floor(lo / hz) + 1, Math.ceil(hi / hz))]; });
  AU.apply(A.fxOf(A.state.inHand), A.inHand());
  return c;
};
function impulse(c, secs) {
  const n = Math.floor(c.sampleRate * secs), b = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2); }
  return b;
}
AU.buffer = (p) => {
  if (!AU.bufs.has(p.id)) AU.bufs.set(p.id, AU.ensure().decodeAudioData(b64ToBuf(p.audio)));
  return AU.bufs.get(p.id);
};
const shaperCurve = (k) => { const n = 1024, cur = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; cur[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); } return cur; };
AU.apply = (fx, p = A.inHand()) => {
  if (!AU.ctx) return;
  const t = AU.ctx.currentTime, st = (param, v) => param.setTargetAtTime(v, t, 0.03);
  const b = fx.bright;
  st(AU.lp.frequency, b < 0.5 ? 350 * Math.pow(18000 / 350, b / 0.5) : 18000);
  st(AU.hs.gain, b > 0.5 ? ((b - 0.5) / 0.5) * 12 : 0);
  st(AU.ls.gain, (fx.body - 0.5) * 24);
  AU.shaper.curve = fx.grit > 0.01 ? shaperCurve(fx.grit * 30) : null;
  // loudness stays put as the tone moves: the energy BRIGHT and BODY add or
  // take away is computed from this sound's own spectrum and paid back at the input
  st(AU.input.gain, (1 / (1 + fx.grit * 2.2)) * Math.pow(10, -AU.energyDb(p, fx) / 20));
  st(AU.wet.gain, fx.space * 0.7); st(AU.dry.gain, 1 - fx.space * 0.45);
  st(AU.mo.frequency, fx.motion > 0.01 ? 5200 : 20000);
  st(AU.lfoGain.gain, fx.motion * 4200); st(AU.lfo.frequency, 0.25 + fx.motion * 5);
};
// BRIGHT and BODY are filters, so what they do to the spectrum is exact: the
// vessel reshapes from their real frequency response.
const OC = new OfflineAudioContext(1, 128, 44100);
const R = { lp: OC.createBiquadFilter(), hs: OC.createBiquadFilter(), ls: OC.createBiquadFilter() };
R.lp.type = "lowpass"; R.hs.type = "highshelf"; R.hs.frequency.value = 3000; R.ls.type = "lowshelf"; R.ls.frequency.value = 180;
const FQ = new Float32Array(D.bands_hz), MAG = new Float32Array(NB), PH = new Float32Array(NB);
AU.responseDb = (fx) => {
  const b = fx.bright;
  R.lp.frequency.value = b < 0.5 ? 350 * Math.pow(18000 / 350, b / 0.5) : 18000;
  R.hs.gain.value = b > 0.5 ? ((b - 0.5) / 0.5) * 12 : 0;
  R.ls.gain.value = (fx.body - 0.5) * 24;
  const out = new Array(NB).fill(0);
  for (const f of [R.lp, R.hs, R.ls]) { f.getFrequencyResponse(FQ, MAG, PH); for (let i = 0; i < NB; i++) out[i] += 20 * Math.log10(Math.max(MAG[i], 1e-6)); }
  return out;
};
AU.devFor = (p) => A.devOf(p, AU.responseDb(A.fxOf(p.id)));
AU.energyDb = (p, fx) => {
  const r = AU.responseDb(fx); let a = 0, b = 0;
  p.ltas_db.forEach((v, i) => { a += Math.pow(10, v / 10); b += Math.pow(10, (v + r[i]) / 10); });
  return Math.max(-12, Math.min(12, 10 * Math.log10(b / a)));
};
AU.envelope = (gain, t0, fx, peak = 1) => {
  const snap = fx.snap, atk = snap < 0.5 ? 0.003 + (0.5 - snap) * 0.5 : 0.002;
  gain.gain.cancelScheduledValues(t0); gain.gain.setValueAtTime(0, t0);
  if (snap > 0.5) { const boost = 1 + (snap - 0.5) * 0.8; gain.gain.linearRampToValueAtTime(peak * boost, t0 + atk); gain.gain.setTargetAtTime(peak, t0 + atk, 0.06); }
  else gain.gain.linearRampToValueAtTime(peak, t0 + atk);
};
AU.play = async (p, { onEnd } = {}) => {
  const c = AU.ensure(); const buf = await AU.buffer(p);
  AU.stopPhrase(false);
  AU.apply(A.fxOf(p.id), p);
  const src = c.createBufferSource(), g = c.createGain(); src.buffer = buf; src.connect(g).connect(AU.input);
  AU.envelope(g, c.currentTime, A.fxOf(p.id), 1);
  src.start(); AU.phrase = { src, g, id: p.id }; AU.playingId = p.id; A.emit("play", p);
  src.onended = () => { if (AU.phrase && AU.phrase.src === src) { AU.phrase = null; AU.playingId = null; A.emit("stop", p); onEnd && onEnd(); } };
};
AU.stopPhrase = (emit = true) => {
  if (!AU.phrase) return; const { src, g, id } = AU.phrase; const t = AU.ctx.currentTime;
  g.gain.setTargetAtTime(0, t, 0.03); src.stop(t + 0.15); AU.phrase = null; AU.playingId = null; if (emit) A.emit("stop", A.byId.get(id));
};
AU.toggle = (p) => (AU.playingId === p.id ? AU.stopPhrase() : AU.play(p));
AU.noteOn = async (key, semis) => {
  const p = A.inHand(); const c = AU.ensure(); const buf = await AU.buffer(p);
  if (AU.notes.has(key)) return;
  AU.apply(A.fxOf(p.id), p);
  const src = c.createBufferSource(), g = c.createGain(); src.buffer = buf; src.playbackRate.value = Math.pow(2, semis / 12);
  src.connect(g).connect(AU.input); AU.envelope(g, c.currentTime, A.fxOf(p.id), 0.9);
  src.start(0, 0, (D.held.end + 0.6) / src.playbackRate.value);
  AU.notes.set(key, { src, g, semis }); A.emit("note", { key, semis, on: true });
};
AU.noteOff = (key) => {
  const v = AU.notes.get(key); if (!v) return; AU.notes.delete(key);
  const t = AU.ctx.currentTime; v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, 0.08); v.src.stop(t + 0.6);
  A.emit("note", { key, semis: v.semis, on: false });
};
// The live spectrum, against the bank, in the vessel's own coordinates.
AU.liveDev = () => {
  if (!AU.ctx || (!AU.phrase && !AU.notes.size)) return null;
  AU.an.getFloatFrequencyData(AU.freq);
  const e = AU.binsOf.map(([lo, hi]) => { let s = 0; for (let k = lo; k < hi; k++) s += Math.pow(10, AU.freq[k] / 10); return 10 * Math.log10(s / (hi - lo) + 1e-12); });
  const mx = Math.max(...e); if (mx < -95) return null;
  return e.map((v, i) => (v - mx - MEAN[i]) / SD);
};

// ---------------------------------------------------------------- the model
// A small Bradley–Terry on the sounds' standardized features: enough to make
// the lens, the forecast and the map glow honest within this prototype.
const M = (A.model = { w: new Array(D.phi_names.length).fill(0), n: 0, hits: 0, guesses: 0 });
M.score = (p) => p.z.reduce((s, z, i) => s + z * M.w[i], 0);
M.mean = () => A.presets.reduce((s, p) => s + M.score(p), 0) / A.presets.length;
M.like = (p) => sig(M.score(p) - M.mean());
M.predict = (a, b) => sig(M.score(a) - M.score(b));
M.fitted = () => M.n >= 6;
M.learn = (win, lose) => {
  const p = M.predict(win, lose);
  for (let i = 0; i < M.w.length; i++) M.w[i] += 0.3 * (1 - p) * (win.z[i] - lose.z[i]) - 0.01 * M.w[i];
  M.n++; A.emit("learned", { win, lose }); A.emit("model", M);
};
M.lean = (feature) => { const i = D.phi_names.indexOf(feature); return i < 0 ? 0 : Math.tanh(M.w[i] * 1.5); };

// ---------------------------------------------------------------- commands
A.cmd = (c) => { A.cmds = A.cmds.filter((x) => x.id !== c.id); A.cmds.push(c); };

// ---------------------------------------------------------------- shell
const VIEWS = [["perform", "Perform"], ["patch", "Patch"], ["evolve", "Evolve"], ["taste", "Taste"], ["model", "Learning"]];
function header() {
  const bar = $(".bar");
  const chip = el("div", { class: "inhand", role: "group", "aria-label": "The sound in hand" });
  const lamp = el("button", { class: "lens-btn", "aria-pressed": "false", "aria-label": "Show what the model thinks (hold ⌥)", title: "What the model thinks · hold ⌥", html: '<span class="led"></span>Model<kbd>⌥</kbd>' });
  // like ⌥: held, the model's view stays up while you hold; tapped, it stays until tapped again
  let holdT = 0, heldByPress = false;
  lamp.addEventListener("pointerdown", (e) => { heldByPress = false; clearTimeout(holdT); holdT = setTimeout(() => { heldByPress = true; if (!A.state.lens) A.lens(true); }, 280); });
  const release = () => { clearTimeout(holdT); if (heldByPress && A.state.lensHeld) A.lens(false); };
  lamp.addEventListener("pointerup", release); lamp.addEventListener("pointercancel", release); lamp.addEventListener("pointerleave", release);
  lamp.addEventListener("click", () => { if (heldByPress) { heldByPress = false; return; } A.lens(!A.state.lens, true); });
  lamp.addEventListener("contextmenu", (e) => e.preventDefault());
  const taught = el("div", { class: "taught", title: "Picks, ratings and cuts it has learned from" }, el("span", { class: "cap" }, "Taught"), el("b", { id: "taught" }, "0"));
  const cmdk = el("button", { class: "cmdk", "aria-label": "Search or do anything (⌘K)", onclick: () => A.palette(true), html: `${A.icon("search")}<span class="lbl">Search or do anything</span><kbd>⌘K</kbd>` });
  const notes = el("button", { class: "iconbtn", "aria-label": "About this prototype", title: "About this prototype", onclick: () => A.notes(true), html: A.icon("notes") });
  const bankBtn = el("button", { class: "iconbtn narrow-bank", "aria-label": "Bank", onclick: () => document.body.classList.toggle("bank-open"), html: A.icon("bank") });
  bar.append(bankBtn, el("a", { class: "brand", href: "#perform", "aria-label": "Auracle" }, el("span", { class: "word" }, "AURACLE"), el("span", { class: "lamp", id: "brand-lamp" })), el("div", { class: "where", id: "where", "aria-live": "polite" }), chip, taught, lamp, cmdk, notes);
  const drawChip = () => {
    const p = A.inHand(); chip.replaceChildren();
    const playing = A.audio.playingId === p.id;
    chip.append(A.faceCanvas(p, 30, { layers: true, dev: A.audio.devFor(p) }), el("span", { class: "nm" }, p.name),
      el("button", { class: "play", "aria-label": (playing ? "Stop " : "Play ") + p.name + " (space)", title: "Play · space", onclick: () => A.audio.toggle(p), html: A.icon(playing ? "stop" : "play") }));
  };
  A.on("inhand", drawChip); A.on("play", drawChip); A.on("stop", drawChip); A.on("fx", drawChip); drawChip();
  A.on("taught", (n) => { const b = $("#taught"); A.roll(b, n); b.animate?.([{ textShadow: "0 0 12px #ffb454" }, { textShadow: "none" }], { duration: 700 }); });
  A.on("model", () => { const l = $("#brand-lamp"); l.classList.add("on"); setTimeout(() => l.classList.remove("on"), 900); });
}

// ---- the bank
// The pool is a Set (callers add and delete as before) that says when it changes: "pool".
class PoolSet extends Set {
  add(v) { const had = this.has(v); super.add(v); if (!had && this.live) A.emit("pool", { added: v }); return this; }
  delete(v) { const r = super.delete(v); if (r && this.live) A.emit("pool", { deleted: v }); return r; }
}
const POOL = (() => { const order = [...A.presets].sort((a, b) => ((a.id * 37) % 61) - ((b.id * 37) % 61)); const s = new PoolSet(order.slice(0, 24).map((p) => p.id)); s.live = true; return s; })();
A.pool = POOL;
A.poolAdd = (id) => POOL.add(id);
A.poolDelete = (id) => POOL.delete(id);

// ---- lineage, as the engine keeps it: breeding never changes a sound. A generation's
// seeds are the pool's best-rated quarter; each walks to one child (a new sound, its seed
// untouched), which gets in only if the model rates it above the weakest sound it would
// displace; at the end the pool trims back to size, lowest-rated first, saved sounds
// exempt. The engine records each child's seed and what changed (its lineage); the
// sounds trimmed away are dropped, and only their names are kept.
A.state.lineage = {}; A.state.unheard = new Set(); A.state.gens = [];
A.bankMarks = null;                  // {seeds, maygo}: what EVOLVE POOL would do, shown before it does
// a sound still has its sound while it is in the pool or saved; one trimmed away is only a name
A.alive = (p) => !!p && (POOL.has(p.id) || A.state.saved.has(p.id) || p.category === "yours");
// a generation is open while its walks run: each child joins it as it lands, the way the app
// posts them, so the bank's "new" group forms as they arrive; it closes when the pool trims
A.openGeneration = () => { const g = { gen: A.state.gens.length + 1, kids: [], gone: [], notKept: 0, open: true }; A.state.gens.push(g); return g; };
A.childBorn = (id, parent, g, rated = {}) => { A.state.lineage[id] = { parent, gen: g.gen, ...rated }; A.state.unheard.add(id); g.kids.push(id); };
A.closeGeneration = (g) => { g.open = false; A.bankTab?.("pool"); A.emit("generation", g); };
const heard = (p) => { if (p && A.state.unheard.delete(p.id)) A.bankDraw?.(); };
A.on("play", heard); A.on("inhand", heard);
// what a child is, next to its parent: modules gained and lost, the knobs that moved
// most on the modules they share, and the biggest change in its sound
A.diffOf = (kid, par) => {
  const km = A.modulesOf(kid.tree), pm = A.modulesOf(par.tree);
  const count = (ms) => ms.reduce((m, x) => m.set(x.label, (m.get(x.label) || 0) + 1), new Map());
  const kc = count(km), pc = count(pm);
  const added = [...kc].filter(([l, n]) => n > (pc.get(l) || 0)).map(([l]) => l.toLowerCase());
  const removed = [...pc].filter(([l, n]) => n > (kc.get(l) || 0)).map(([l]) => l.toLowerCase());
  const knobs = [];
  for (const m of km) {
    const q = pm.find((x) => x.kind === m.kind); if (!q) continue;
    for (const [k, v] of Object.entries(m.params)) {
      const w = q.params[k]; if (typeof v !== "number" || typeof w !== "number") continue;
      const d = Math.abs(v - w) / (Math.abs(w) > 1 ? Math.abs(w) : 1); if (d > 0.08) knobs.push({ mod: m.label.toLowerCase(), k, from: w, to: v, d });
    }
  }
  knobs.sort((a, b) => b.d - a.d);
  const mean = (a, i0, i1) => a.slice(i0, i1).reduce((s, v) => s + v, 0) / (i1 - i0);
  const top = mean(kid.dev, 28, 40) - mean(par.dev, 28, 40), low = mean(kid.dev, 0, 10) - mean(par.dev, 0, 10);
  const words = [];
  if (top > 0.35) words.push("brighter"); else if (top < -0.35) words.push("darker");
  if (low > 0.35) words.push("heavier"); else if (low < -0.35) words.push("lighter");
  const parts = [...added.map((x) => "+ " + x), ...removed.map((x) => "− " + x), ...words];
  return { added, removed, knobs: knobs.slice(0, 3), words, summary: parts.slice(0, 3).join(" · ") || "a close variation" };
};
// a child's face, with its parent's small beside it and the line it grew along
function lineageFace(p, par) {
  const [cv, x] = A.canvas(44, 30);
  if (par) {
    A.face(x, 16, par, { box: { x: 0, y: 12, w: 13, h: 16 }, layers: false, glow: 0, lw: 1, dim: 0.5 });
    x.beginPath(); x.moveTo(8, 12); x.quadraticCurveTo(12, 3, 20, 6); x.strokeStyle = "rgba(142,240,177,.55)"; x.lineWidth = 1; x.stroke();
  }
  A.face(x, 28, p, { box: { x: 17, y: 1, w: 26, h: 28 }, dev: A.audio.devFor(p) });
  cv.setAttribute("aria-hidden", "true"); return cv;
}
let showGone = false;
let bankTab = "presets", bankQuery = "", cursor = -1;
const CATS = ["yours", "bass", "lead", "keys", "pad", "texture", "perc", "weird"];
function bank() {
  const root = $(".bank");
  const tabs = el("div", { class: "bank-tabs", role: "tablist", "aria-label": "Bank" });
  const list = el("div", { class: "bank-list", role: "list", "aria-label": "Sounds" });
  const filter = el("label", { class: "bank-filter", html: A.icon("search") }, el("input", { type: "search", placeholder: "Find a sound", "aria-label": "Find a sound", oninput: (e) => { bankQuery = e.target.value.toLowerCase(); draw(); } }));
  const grab = el("button", { class: "sheet-grab", "aria-label": "Put the bank away", onclick: () => document.body.classList.remove("bank-open") });
  root.append(grab, el("div", { class: "bank-head" }, tabs, filter), list);
  let drag = null;
  grab.addEventListener("pointerdown", (e) => { drag = { y: e.clientY, id: e.pointerId, moved: 0 }; grab.setPointerCapture(e.pointerId); root.style.transition = "none"; });
  grab.addEventListener("pointermove", (e) => { if (!drag || e.pointerId !== drag.id) return; drag.moved = Math.max(0, e.clientY - drag.y); root.style.transform = `translateY(${drag.moved}px)`; });
  const let_go = () => { if (!drag) return; const far = drag.moved > 80; root.style.transition = ""; root.style.transform = ""; if (far) document.body.classList.remove("bank-open"); drag = null; };
  grab.addEventListener("pointerup", let_go); grab.addEventListener("pointercancel", let_go);
  const tabDefs = [["pool", "Pool", () => [...POOL].filter((id) => !A.state.cut.has(id)).length], ["saved", "Saved", () => A.state.saved.size], ["presets", "Presets", () => A.presets.filter((p) => p.category !== "yours" && !A.state.cut.has(p.id)).length]];
  list.id = "bank-list";
  const drawTabs = () => {
    const had = document.activeElement?.closest?.(".btab")?.dataset.tab;
    tabs.replaceChildren(...tabDefs.map(([id, label, n]) => el("button", { class: "btab", role: "tab", "data-tab": id, "aria-controls": "bank-list", tabindex: bankTab === id ? "0" : "-1", "aria-selected": String(bankTab === id), onclick: () => { bankTab = id; drawTabs(); draw(); } }, label, el("span", { class: "n" }, String(n())))));
    A.bankBadge?.();
    if (had) tabs.querySelector(`[data-tab="${had}"]`)?.focus();
  };
  tabs.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const ids = tabDefs.map(([id]) => id), i = ids.indexOf(bankTab); bankTab = ids[(i + (e.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length];
    drawTabs(); draw(); tabs.querySelector(`[data-tab="${bankTab}"]`)?.focus(); e.preventDefault(); e.stopPropagation();
  });
  const rowOf = (p, how = {}) => {
    const saved = A.state.saved.has(p.id), live = A.state.inHand === p.id;
    const lin = how.lineage && A.state.lineage[p.id], par = lin && A.byId.get(lin.parent);
    const like = A.model.like(p), mk = A.bankMarks, seed = mk?.seeds.has(p.id), maygo = mk?.maygo.has(p.id);
    const row = el("div", { class: `row${saved ? " saved" : ""}${live ? " live" : ""}${A.model.fitted() ? "" : " guess"}${lin ? " kid" : ""}${seed ? " seed" : ""}${maygo ? " maygo" : ""}`, role: "listitem", "data-id": p.id, onclick: (e) => {
      if (e.target.closest(".act")) return;
      // the bank as an overlay (a phone's sheet, a tablet's or landscape drawer) goes away as you choose
      const src = row.querySelector("canvas"), sheet = document.body.classList.contains("bank-open") && getComputedStyle(document.querySelector(".bank")).position === "fixed";
      if (A.state.inHand === p.id) { A.audio.toggle(p); return; }
      if (sheet) document.body.classList.remove("bank-open");
      A.takeUp(p, src);
    } },
      lin ? lineageFace(p, par && A.alive(par) ? par : null) : A.faceCanvas(p, 26, { dev: A.audio.devFor(p) }),
      lin ? el("div", { class: "nm2" },
        el("span", { class: "nm-line" },
          A.state.unheard.has(p.id) ? el("span", { class: "newdot", title: "Not heard yet", "aria-hidden": "true" }) : "",
          el("button", { class: "nm", style: "text-align:left", "aria-label": `${p.name}, bred from ${par?.name || "the pool"} in generation ${lin.gen}${A.state.unheard.has(p.id) ? ", not heard yet" : ""}: hold it and play`, title: p.blurb }, p.name)),
        el("span", { class: "sub mono" }, par ? `from ${par.name} · ${A.diffOf(p, par).summary}` : `bred in generation ${lin.gen}`))
        : el("button", { class: "nm", style: "text-align:left", "aria-label": `${p.name}: hold it and play${seed ? "; a seed for the next generation" : ""}${maygo ? "; may be replaced by the next generation" : ""}`, title: p.blurb }, p.name),
      seed || maygo ? el("span", { class: "mark mono", "aria-hidden": "true" }, seed ? "seed" : "may go") : "",
      el("div", { class: "acts" },
        lin && par ? el("button", { class: "act", "data-ask": "lineage", "aria-label": `Compare ${p.name} with ${par.name}`, title: "What changed", onclick: (e) => { e.stopPropagation(); A.ask?.(e.currentTarget); }, html: A.icon("evolve") }) : "",
        el("button", { class: "act", "aria-label": `Play ${p.name}`, title: "Play", onclick: () => A.audio.toggle(p), html: A.icon(A.audio.playingId === p.id ? "stop" : "play") }),
        el("button", { class: `act${A.state.stars[p.id] ? " on" : ""}`, "aria-label": `Star ${p.name}`, title: "Star · 1–5", onclick: (e) => A.star(p, A.state.stars[p.id] ? 0 : 4, e.currentTarget), html: A.icon("star") }),
        el("button", { class: `act${saved ? " on" : ""}`, "aria-label": `${saved ? "Unsave" : "Save"} ${p.name}`, title: "Save · m", onclick: () => A.save(p), html: A.icon("save") }),
        el("button", { class: "act cut", "aria-label": `Cut ${p.name}`, title: "Cut", onclick: () => A.cut(p), html: A.icon("cut") })),
      el("span", { class: "pct", title: A.model.fitted() ? "Chance it wins against an average sound" : "A guess: it fits after 6 picks" }, A.model.fitted() ? Math.round(like * 100) + "%" : "?"),
      el("span", { class: "like", "aria-hidden": "true" }, el("i", { style: `width:${Math.round(like * 100)}%` })));
    return row;
  };
  const draw = () => {
    // FLIP: remember where every row was, redraw, then let each glide from there
    const before = new Map(), focusId = document.activeElement?.closest?.(".row")?.dataset.id, focusCls = document.activeElement?.className;
    if (!A.reduced && seen(list)) for (const r of list.querySelectorAll(".row")) before.set(r.dataset.id, r.getBoundingClientRect().top);
    render();
    if (before.size) for (const r of list.querySelectorAll(".row")) {
      const t = before.get(r.dataset.id);
      if (t == null) { r.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 }); continue; }
      const dy = t - r.getBoundingClientRect().top;
      if (Math.abs(dy) > 0.5) r.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
    if (focusId) { const r = list.querySelector(`.row[data-id="${focusId}"]`); const f = r && ([...r.querySelectorAll("button")].find((b) => b.className === focusCls) || r.querySelector(".nm")); f?.focus({ preventScroll: true }); }
  };
  const render = () => {
    const pool = bankTab === "pool" ? [...POOL].map((id) => A.byId.get(id)) : bankTab === "saved" ? [...A.state.saved].map((id) => A.byId.get(id)) : A.presets;
    const items = pool.filter((p) => !A.state.cut.has(p.id) && (!bankQuery || p.name.toLowerCase().includes(bankQuery) || p.category.includes(bankQuery) || p.blurb.toLowerCase().includes(bankQuery)));
    list.replaceChildren();
    if (!items.length) { list.append(el("div", { class: "bank-group" }, bankTab === "saved" ? "Nothing saved yet · press M" : "No sound matches")); return; }
    if (A.state.lens && A.model.fitted()) items.sort((a, b) => A.model.like(b) - A.model.like(a));
    const last = A.state.gens[A.state.gens.length - 1];
    // "new" is the latest generation that bred anything; it stays until the next one does
    const born = [...A.state.gens].reverse().find((g) => g.kids.length);
    if (bankTab === "pool" && last && !bankQuery) {
      const kids = born ? born.kids.map((id) => items.find((p) => p.id === id)).filter(Boolean) : [], rest = items.filter((p) => !kids.includes(p));
      if (kids.length) {
        list.append(el("div", { class: "bank-group new", title: "Bred in the latest generation, in the order they were bred" }, el("span", {}, `New · generation ${born.gen}`), el("span", {}, String(kids.length))));
        for (const p of kids) list.append(rowOf(p, { lineage: true }));
        if (born.notKept) list.append(el("div", { class: "bank-note mono" }, `${born.notKept} more ${born.notKept === 1 ? "was" : "were"} bred but rated below the pool, so not kept`));
      }
      list.append(el("div", { class: "bank-group" }, el("span", {}, kids.length ? "In the pool" : "Pool"), el("span", {}, String(rest.length))));
      for (const p of rest) list.append(rowOf(p, { lineage: true }));
      const gone = last.gone.map((id) => A.byId.get(id)).filter((p) => p && !POOL.has(p.id));
      if (gone.length) {
        list.append(el("button", { class: "bank-group fold", "aria-expanded": String(showGone), title: "Rated lowest when the generation ended. The engine keeps their names, not their sounds.", onclick: () => { showGone = !showGone; A.bankDraw(); } }, el("span", {}, `Replaced · generation ${last.gen}`), el("span", {}, `${gone.length} ${showGone ? "▾" : "▸"}`)));
        if (showGone) {
          list.append(el("div", { class: "bank-note mono" }, "Rated lowest at the end of the generation. Only their names are kept."));
          list.append(el("div", { class: "gone-names", role: "list" }, ...gone.map((p) => el("span", { role: "listitem" }, p.name))));
        }
      }
      return;
    }
    const groups = bankTab === "presets" && !(A.state.lens && A.model.fitted()) ? CATS.map((c) => [c, items.filter((p) => p.category === c)]).filter(([, a]) => a.length) : [[null, items]];
    for (const [cat, arr] of groups) {
      if (cat) list.append(el("div", { class: "bank-group" }, el("span", {}, cat), el("span", {}, String(arr.length))));
      for (const p of arr) list.append(rowOf(p, { lineage: bankTab !== "presets" }));
    }
  };
  A.bankDraw = () => { drawTabs(); draw(); };
  A.bankTab = (id) => { if (!tabDefs.some(([t]) => t === id)) return; bankTab = id; A.bankDraw(); };
  // many pool changes in one breed redraw once
  let poolRaf = 0, fresh = 0;
  const badge = A.bankBadge = () => { for (const b of document.querySelectorAll(".narrow-bank, .btab[data-tab='pool']")) { let t = b.querySelector(".fresh"); if (!fresh) { t?.remove(); continue; } if (!t) { t = el("span", { class: "fresh", "aria-label": `${fresh} new in the pool` }); b.append(t); } t.textContent = "+" + fresh; } };
  const looked = () => (document.body.classList.contains("bank-open") || !matchMedia("(max-width: 980px)").matches) && bankTab === "pool";
  A.on("pool", (d) => { if (d?.added && !looked()) fresh++; if (!poolRaf) poolRaf = requestAnimationFrame(() => { poolRaf = 0; A.bankDraw(); badge(); }); });
  new MutationObserver(() => { if (looked() && fresh) { fresh = 0; badge(); } }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  tabs.addEventListener("click", () => { if (looked() && fresh) { fresh = 0; badge(); } });
  A.bankFlash = (id) => { const r = list.querySelector(`[data-id="${id}"]`); if (r) { r.classList.remove("flash"); void r.offsetWidth; r.classList.add("flash"); r.scrollIntoView({ block: "nearest", behavior: A.reduced ? "auto" : "smooth" }); } };
  for (const t of ["inhand", "play", "stop", "model", "lens", "saved", "cut"]) A.on(t, () => A.bankDraw());
  A.on("fx", () => { const r = list.querySelector(`[data-id="${A.state.inHand}"] canvas`); if (r) r.replaceWith(A.faceCanvas(A.inHand(), 26, { dev: A.audio.devFor(A.inHand()) })); });
  A.bankDraw();
}
const faceOf = (p) => seen(document.querySelector(`.bank .row[data-id="${p.id}"] canvas`)) && document.querySelector(`.bank .row[data-id="${p.id}"] canvas`) || (A.state.inHand === p.id && document.querySelector(".inhand canvas")) || null;
A.save = (p) => {
  const was = A.state.saved.has(p.id);
  // saving drops the sound's face onto the Saved shelf (or the bank's button when the bank is away)
  if (!was) { const src = seen(faceOf(p)), shelf = seen(document.querySelector('.btab[data-tab="saved"]')) || seen(document.querySelector(".narrow-bank")); A.flyFace(p, src, shelf, { done: () => { const n = document.querySelector('.btab[data-tab="saved"] .n'); n?.animate?.([{ color: "#e2ddd1", transform: "scale(1.35)" }, { transform: "none" }], { duration: 420 }); } }); }
  if (was) A.state.saved.delete(p.id); else A.state.saved.add(p.id);
  A.emit("saved", p);
  A.toast({ face: p, text: was ? `Unsaved ${p.name}.` : `Saved ${p.name}. It won't be replaced.`, undo: () => { if (was) A.state.saved.add(p.id); else A.state.saved.delete(p.id); A.emit("saved", p); } });
};
A.cut = (p) => {
  // a cut sound falls to dust where it stood; the rows close over the gap
  const src = faceOf(p); A.dust(src);
  A.state.cut.add(p.id); A.teach(1, src); A.emit("cut", p);
  A.toast({ face: p, text: `Cut ${p.name}. It won't be dealt again.`, undo: () => {
    A.state.cut.delete(p.id); A.state.taught--; A.emit("taught", A.state.taught); A.emit("cut", p);
    // and taking it back gathers the dust into its face again
    const c = document.querySelector(`.bank .row[data-id="${p.id}"] canvas`);
    if (c && seen(c) && !A.reduced) { c.style.opacity = "0"; A.dust(c, { reverse: true, done: () => { c.style.opacity = ""; } }); }
  } });
};
A.star = (p, n, from) => { A.state.stars[p.id] = n; A.teach(1, from || faceOf(p)); A.emit("saved", p); A.toast({ face: p, text: n ? `${p.name} rated ${n}★.` : `Rating cleared.`, undo: () => { delete A.state.stars[p.id]; A.emit("saved", p); } }); };

// ---- keys
const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ";": 16, "'": 17 };
let octave = 0;
function keys() {
  const root = $(".keys");
  const side = el("div", { class: "keys-side" },
    el("div", { class: "cap" }, "Keys"),
    el("div", { class: "oct" }, el("kbd", {}, "Z"), el("span", { id: "oct" }, "C4"), el("kbd", {}, "X"), el("span", { style: "margin-left:8px" }, "octave")));
  const bed = el("div", { class: "keybed", role: "group", "aria-label": "Keyboard" });
  const octBtns = el("div", { class: "oct-btns" },
    el("button", { class: "iconbtn", "aria-label": "Octave down", onclick: () => shift(-1), html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14.5 6l-6 6 6 6"/></svg>' }),
    el("span", { class: "oct-now mono", "aria-live": "polite" }),
    el("button", { class: "iconbtn", "aria-label": "Octave up", onclick: () => shift(1), html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9.5 6l6 6-6 6"/></svg>' }));
  root.append(side, octBtns, bed);
  const small = matchMedia("(max-width: 700px) and (min-height: 501px)");
  const shift = (d) => { octave = Math.max(-1, Math.min(1, octave + d)); draw(); };
  A.octave = shift;
  const WHITE = [0, 2, 4, 5, 7, 9, 11], names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const letterOf = (semi) => Object.entries(KEYMAP).find(([, v]) => v + octave * 12 === semi)?.[0] || "";
  const draw = () => {
    bed.replaceChildren();
    const whites = [];
    // a phone gets a keyboard sized for the hand: an octave and a third around the current octave
    const lo = small.matches ? octave * 12 : -12, hi = small.matches ? octave * 12 + 16 : 24;
    bed.setAttribute("aria-label", `Keyboard, C${4 + Math.floor(lo / 12)} to ${small.matches ? "E" : "C"}${4 + Math.floor(hi / 12)}`);
    for (let s = lo; s <= hi; s++) if (WHITE.includes(((s % 12) + 12) % 12)) whites.push(s);
    const w = 100 / whites.length;
    whites.forEach((s) => {
      const k = el("div", { class: "wk", "data-semi": s }, letterOf(s).toUpperCase());
      if (((s % 12) + 12) % 12 === 0) k.append(el("span", { class: "c" }, "C" + (4 + Math.floor(s / 12))));
      bed.append(k);
    });
    for (let s = lo; s < hi; s++) {
      if (WHITE.includes(((s % 12) + 12) % 12)) continue;
      const left = whites.indexOf(s - 1);
      bed.append(el("div", { class: "bk", "data-semi": s, style: `left:calc(${(left + 1) * w}% - ${w * 0.32}%);width:${w * 0.64}%` }, letterOf(s).toUpperCase()));
    }
    $("#oct").textContent = "C" + (4 + octave);
    root.querySelector(".oct-now").textContent = "C" + (4 + octave);
    // the letters sliding tell you the octave moved, not only the label
    if (!A.reduced && lastOct != null && lastOct !== octave) bed.animate([{ transform: `translateX(${(octave - lastOct) * 18}px)`, opacity: 0.5 }, { transform: "none", opacity: 1 }], { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" });
    lastOct = octave;
  };
  let lastOct = null;
  small.addEventListener?.("change", draw);
  draw(); A.keysDraw = draw;
  // every finger its own note (chords), and sliding across the keys plays each one in turn
  const held = new Map();
  const nearestKey = (x) => [...bed.querySelectorAll(".wk")].find((w) => { const r = w.getBoundingClientRect(); return x >= r.left - 3 && x <= r.right + 3; });
  const keyAt = (x, y) => document.elementFromPoint(x, y)?.closest?.(".keybed [data-semi]") || nearestKey(x, y);
  bed.addEventListener("pointerdown", (e) => { const k = e.target.closest("[data-semi]") || nearestKey(e.clientX, e.clientY); if (!k) return; e.preventDefault(); bed.setPointerCapture(e.pointerId); const id = "ptr" + e.pointerId; held.set(e.pointerId, +k.dataset.semi); AU.noteOn(id, +k.dataset.semi); });
  bed.addEventListener("pointermove", (e) => {
    if (!held.has(e.pointerId)) return;
    const k = keyAt(e.clientX, e.clientY); if (!k) return;
    const s = +k.dataset.semi; if (s === held.get(e.pointerId)) return;
    const id = "ptr" + e.pointerId; AU.noteOff(id); held.set(e.pointerId, s); AU.noteOn(id, s);
  });
  const lift = (e) => { if (!held.has(e.pointerId)) return; AU.noteOff("ptr" + e.pointerId); held.delete(e.pointerId); };
  bed.addEventListener("pointerup", lift); bed.addEventListener("pointercancel", lift);
  A.on("note", ({ semis, on }) => { const k = bed.querySelector(`[data-semi="${semis}"]`); if (k) k.classList.toggle("down", on); });
}

// ---- toasts (the result of your gesture, with seven seconds to take it back)
let undoStack = [];
A.toast = ({ face, text, undo, ms = 7000 }) => {
  const box = $(".toasts");
  const t = el("div", { class: "toast", role: "status" });
  if (face) t.append(A.faceCanvas(face, 22, { layers: false }));
  t.append(el("span", {}, text));
  let entry;
  if (undo) {
    entry = { undo, t, until: performance.now() + ms };
    undoStack.push(entry);
    t.append(el("button", { class: "btn ghost", style: "height:30px;padding-inline:10px", onclick: () => { undo(); close(); }, html: `${A.icon("undo")}Undo<kbd>⌘Z</kbd>` }));
    const bar = el("span", { class: "bar7" }); t.append(bar);
    bar.animate?.([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: ms, easing: "linear" });
  }
  box.append(t);
  while (box.children.length > 3) box.firstElementChild.remove();
  document.body.classList.add("toasting");
  const close = () => { t.classList.add("out"); setTimeout(() => { t.remove(); if (!box.children.length) document.body.classList.remove("toasting"); }, 200); undoStack = undoStack.filter((x) => x !== entry); };
  setTimeout(close, undo ? ms : 3200);
};
A.undoLast = () => { const now = performance.now(); const e = undoStack.filter((x) => x.until > now).pop(); if (!e) { A.toast({ text: "Nothing to take back." }); return; } e.undo(); e.t.classList.add("out"); setTimeout(() => { e.t.remove(); if (!$(".toasts").children.length) document.body.classList.remove("toasting"); }, 200); undoStack = undoStack.filter((x) => x !== e); };

// ---- the lens: the model's mind, raised over whatever is showing
let lensQuiet = 0;
A.lens = (on, sticky = false) => {
  if (!sticky && A.state.lens && !A.state.lensHeld) return;
  const was = A.state.lens;
  A.state.lens = on; A.state.lensHeld = on && !sticky;
  const btn = $(".lens-btn"), tag = $(".lens-tag");
  btn.setAttribute("aria-pressed", String(on && sticky));
  tag.querySelector(".voice").textContent = A.model.fitted() ? `what it believes, from ${A.model.n} picks` : `still guessing · it fits after 6 picks (${A.model.n} so far)`;
  clearTimeout(lensQuiet); document.body.classList.remove("lens-quiet");
  if (on && !was) {
    // the model's view rises out of its own lamp: the veil is lit from the toggle,
    // and the tag grows from it to its place
    const b = btn.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    document.documentElement.style.setProperty("--lx", cx + "px"); document.documentElement.style.setProperty("--ly", cy + "px");
    document.body.classList.add("lens");
    if (!A.reduced) {
      const t = tag.getBoundingClientRect(), tx = t.left + t.width / 2, ty = t.top + t.height / 2;
      tag.animate([{ transform: `translate(calc(-50% + ${cx - tx}px), ${cy - ty}px) scale(.25)`, opacity: 0 }, { transform: "translateX(-50%)", opacity: 1 }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
  } else document.body.classList.toggle("lens", on);
  // held, the tag stays while you hold; toggled on, it says its line and settles, leaving the amber
  if (on && sticky) lensQuiet = setTimeout(() => document.body.classList.add("lens-quiet"), 3200);
  A.emit("lens", on);
};

// ---- the palette: every action, with its key; every sound, by its face
let palOpen = false, palSel = 0, palItems = [], palFrom = null;
A.palette = (open, q = "") => {
  if (open && !palOpen) palFrom = document.activeElement;
  palOpen = open;
  $(".scrim").classList.toggle("on", open); $(".palette").classList.toggle("on", open);
  if (open) { const i = $(".palette input"); i.value = q; palDraw(q); i.focus(); }
  else { if (palFrom && document.contains(palFrom)) palFrom.focus?.({ preventScroll: true }); palFrom = null; }
};
// how well a query names a thing: the start of it, then the start of a word, then anywhere, then scattered
const rank = (q, s) => {
  if (!q) return 1; const l = s.toLowerCase(), k = q.toLowerCase();
  if (l.startsWith(k)) return 100 - l.length * 0.05;
  const words = l.split(/[^a-z0-9]+/); const wi = words.findIndex((w) => w.startsWith(k)); if (wi >= 0) return 80 - wi;
  const ci = l.indexOf(k); if (ci >= 0) return 60 - ci * 0.2;
  return fuzzy(q, s).ok ? 20 : -1;
};
const fuzzy = (q, s) => { if (!q) return { ok: true, html: s }; let i = 0, out = "", hit = 0; const lq = q.toLowerCase(); for (const ch of s) { if (i < lq.length && ch.toLowerCase() === lq[i]) { out += `<mark>${ch}</mark>`; i++; hit++; } else out += ch; } return { ok: i === lq.length, html: out, score: hit }; };
function palDraw(q) {
  const ul = $(".palette ul"); ul.replaceChildren(); palItems = [];
  const view = A.state.view;
  const groups = [["This view", A.cmds.filter((c) => c.view === view)], ["Anywhere", A.cmds.filter((c) => !c.view)], ["Sounds", A.presets.filter((p) => !A.state.cut.has(p.id)).map((p) => ({ id: "snd" + p.id, label: p.name, face: p, hint: p.category, run: () => A.setInHand(p.id, { play: true }) }))]];
  const ranked = groups.map(([g, arr]) => [g, arr.map((c) => ({ c, f: fuzzy(q, c.label), r: rank(q, c.label) })).filter((x) => x.f.ok).sort((a, b) => b.r - a.r)]);
  if (q) ranked.sort((a, b) => (b[1][0]?.r ?? -1) - (a[1][0]?.r ?? -1));
  for (const [g, hits] of ranked) {
    if (!hits.length) continue;
    ul.append(el("li", { class: "grp", role: "presentation" }, g));
    for (const { c, f } of hits.slice(0, g === "Sounds" ? (q ? 8 : 5) : 20)) {
      const li = el("li", { class: "it", role: "option", id: "pal-" + c.id, onclick: () => { A.palette(false); c.run(); }, onmousemove: () => { palSel = palItems.indexOf(c); palMark(); } });
      li.append(c.face ? A.faceCanvas(c.face, 24, { layers: false }) : el("span", { class: "ico", html: A.icon(c.icon || "chev") }));
      li.append(el("span", { html: f.html }));
      li.append(el("span", { class: "hint", html: c.key ? c.key.split(" ").map((k) => `<kbd>${k}</kbd>`).join("") : c.hint || "" }));
      ul.append(li); palItems.push(c);
    }
  }
  palSel = 0; palMark();
}
function palMark() { document.querySelectorAll(".palette .it").forEach((li, i) => { li.setAttribute("aria-selected", String(i === palSel)); if (i === palSel) { li.scrollIntoView({ block: "nearest" }); $(".palette input").setAttribute("aria-activedescendant", li.id); } }); }

// ---- the first visit: one act at a time, in one place
const T = () => A.TOUCH;
const GUIDE = [
  { id: "note", text: () => (T() ? `Tap a key to play ${A.inHand().name}` : `Press <kbd>A</kbd> to play ${A.inHand().name}`), on: ["note", "play"] },
  { id: "bright", text: () => `Turn <b>BRIGHT</b> and watch its shape follow`, on: "fx" },
  { id: "zoom", text: () => (T() ? `Pinch in: ${A.inHand().name} among every sound` : `<kbd>⌥↑</kbd> zoom out: ${A.inHand().name} among every sound`), on: "view", when: (d) => d === "taste" },
  { id: "lens", text: () => (T() ? `Hold <b>MODEL</b> to see what the model thinks` : `Hold <kbd>⌥</kbd> to see what the model thinks`), on: "lens", when: (d) => !!d },
  { id: "pick", text: () => (T() ? `<b>Evolve</b>: keep the one you'd reach for` : `<kbd>⌥←</kbd> EVOLVE: keep the one you'd reach for`), on: "pick" },
];
let gstep = 0, gdone = false;
function guide() {
  const g = $(".guide");
  const draw = () => {
    g.replaceChildren(); if (gdone || gstep >= GUIDE.length) return;
    const s = GUIDE[gstep];
    g.append(el("div", { class: "next", role: "status" },
      el("span", { class: "pips", "aria-hidden": "true" }, GUIDE.map((_, i) => el("i", { class: i < gstep ? "done" : "" }))),
      el("span", { html: s.text() }),
      el("button", { class: "x", "aria-label": "Stop showing these", title: "Stop showing these", onclick: () => { gdone = true; draw(); }, html: A.icon("x") })));
  };
  for (const s of GUIDE) for (const ev of [].concat(s.on)) {
    A.on(ev, (d) => { if (gdone || GUIDE[gstep]?.id !== s.id) return; if (s.when && !s.when(d)) return; gstep++; done(); });
  }
  // a step done: its pip fills, then the next step takes its place
  const done = () => { const pip = g.querySelectorAll(".pips i")[gstep - 1]; if (pip && !A.reduced) { pip.classList.add("done"); pip.animate([{ transform: "scale(2.2)" }, { transform: "none" }], { duration: 320 }); setTimeout(draw, 360); } else draw(); };
  A.on("inhand", draw); A.guideReset = () => { gstep = 0; gdone = false; draw(); }; draw();
}

// ---- views
// ---- one space: the sound at the centre, depth as zoom
// TASTE is zoomed out (the sound among all sounds), PERFORM is the sound, PATCH
// is zoomed in (what it is made of); EVOLVE sits beside it. Moving between them
// carries the sound's own vessel from where it was to where it will be.
const LEVELS = ["model", "taste", "perform", "patch"];
const WHERE = { model: ["Learning", "how it learns your taste"], taste: ["Taste", "the sound among all sounds"], perform: ["Perform", "the sound, under your hands"], patch: ["Patch", "what the sound is made of"], evolve: ["Evolve", "what it could become"] };
A.LEVELS = LEVELS;
let morph = null, morphSeq = 0;
const dirOf = (a, b) => {
  if (b === "evolve") return "left"; if (a === "evolve") return "right";
  return LEVELS.indexOf(b) > LEVELS.indexOf(a) ? "in" : "out";
};
const KEYFRAMES = {
  in: [["scale(1)", "scale(1.12)"], ["scale(.86)", "scale(1)"]],
  out: [["scale(1)", "scale(.86)"], ["scale(1.12)", "scale(1)"]],
  left: [["translateX(0)", "translateX(14%)"], ["translateX(-14%)", "translateX(0)"]],
  right: [["translateX(0)", "translateX(-14%)"], ["translateX(14%)", "translateX(0)"]],
};
const SLIDE = { in: [0, 10], out: [0, -10], left: [-14, 0], right: [14, 0] };
function syncWhere(id, dir) {
  document.body.dataset.view = id;
  document.querySelectorAll(".rail-stop").forEach((b) => { const on = b.dataset.view === id; b.setAttribute("aria-current", on ? "location" : "false"); });
  const w = $("#where"); const [n, d] = WHERE[id];
  const g = el("span", { class: "where-g" }, el("span", { class: "cap" }, n), el("span", { class: "where-d" }, d));
  const old = [...w.children];
  w.append(g);
  if (dir && !A.reduced) {
    // zooming in, the new name rises from below; out, it drops from above; aside, it slides
    const [dx, dy] = SLIDE[dir];
    g.animate([{ transform: `translate(${dx}px,${dy}px)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
    for (const o of old) { o.classList.add("leaving"); o.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${-dx}px,${-dy}px)`, opacity: 0 }], { duration: 180, easing: "cubic-bezier(.6,0,.2,1)", fill: "forwards" }).onfinish = () => o.remove(); }
  } else old.forEach((o) => o.remove());
  $(".rail").dataset.at = id;
  railIndicator();
}
// ---- the rail's puck: a light that travels from where you were to where you are going
function stopCenter(v) { const b = document.querySelector(`.rail-stop[data-view="${v}"]`), r = $(".rail").getBoundingClientRect(), q = b.getBoundingClientRect(); return [q.left - r.left + q.width / 2, q.top - r.top + q.height / 2]; }
function puck(a, b, D) {
  const rail = $(".rail"); if (!rail || A.reduced || getComputedStyle(rail).position === "fixed") return;
  let pk = rail.querySelector(".rail-puck"); if (!pk) { pk = el("span", { class: "rail-puck", "aria-hidden": "true" }); rail.append(pk); }
  // the rail is a cross: EVOLVE branches off PERFORM, so a trip to or from it turns the corner there
  const path = [a]; if ((a === "evolve") !== (b === "evolve") && a !== "perform" && b !== "perform") path.push("perform"); path.push(b);
  const pts = path.map(stopCenter), frames = pts.map(([x, y], i) => ({ transform: `translate(${x}px,${y}px)`, offset: i / (pts.length - 1) }));
  frames[0].opacity = 0; frames[frames.length - 1].opacity = 1;
  pk.getAnimations().forEach((an) => an.cancel());
  pk.animate(frames, { duration: D * 0.92, easing: "cubic-bezier(.65,0,.25,1)", fill: "forwards" })
    .onfinish = () => { rail.classList.remove("travelling"); pk.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: "forwards" }); };
}
// A zoom in progress leans the bar's line toward the level it would reach (t: 0..1).
function railPreview(dir, t = 0) {
  const rail = $(".rail"), ind = rail?.querySelector(".rail-ind"); if (!ind || getComputedStyle(ind).display === "none") return;
  if (!dir) { ind.style.transition = ""; railIndicator(); return; }
  const cur = LEVELS.indexOf(A.state.view === "evolve" ? "perform" : A.state.view), next = LEVELS[cur + (dir === "in" ? 1 : -1)];
  if (!next) return;
  const a = rail.querySelector('.rail-stop[aria-current="location"]'), b = rail.querySelector(`.rail-stop[data-view="${next}"]`), r = rail.getBoundingClientRect();
  const ax = a.getBoundingClientRect().left - r.left + a.getBoundingClientRect().width * 0.25, bx = b.getBoundingClientRect().left - r.left + b.getBoundingClientRect().width * 0.25;
  ind.style.transition = "none"; ind.style.transform = `translateX(${ax + (bx - ax) * Math.min(1, t) * 0.6}px)`;
}
// ---- on a phone the rail is a bar: one green line slides to where you are
function railIndicator() {
  const rail = $(".rail"); if (!rail) return;
  let ind = rail.querySelector(".rail-ind"); if (!ind) { ind = el("span", { class: "rail-ind", "aria-hidden": "true" }); rail.append(ind); }
  const cur = rail.querySelector('.rail-stop[aria-current="location"]'); if (!cur) return;
  const r = rail.getBoundingClientRect(), q = cur.getBoundingClientRect();
  ind.style.width = q.width * 0.5 + "px"; ind.style.transform = `translateX(${q.left - r.left + q.width * 0.25}px)`;
}
A.show = (id) => {
  if (!A.views[id]) return;
  const prev = A.state.view, first = !A.booted;
  if (prev === id && !first) return;
  if (morph) morph.finish(); // land the move in flight before starting another
  const seq = ++morphSeq;
  const oldEl = $("#view-" + prev), newEl = $("#view-" + id);
  const rel = (r) => { if (!r) return null; const s = $(".stage").getBoundingClientRect(); return { x: r.x - s.left, y: r.y - s.top, w: r.w, h: r.h }; };
  const from = first ? null : A.views[prev]?.anchor?.() || null;
  const dir = first ? null : dirOf(prev, id);
  A.state.view = id; syncWhere(id, dir);
  newEl.classList.add("on");
  const moving = !first && !A.reduced;
  A.morphing = moving;
  if (moving) { A.emit("morphstart", prev); newEl.style.opacity = "0"; }
  A.views[id].show?.();
  if (location.hash !== "#" + id) history.replaceState(null, "", "#" + id);
  A.emit("view", id);
  // The world after any move, finished or cut short: exactly one view on, no
  // transform or fade left behind on any of them.
  const settle = () => {
    for (const [v] of VIEWS) {
      const e = $("#view-" + v), on = v === A.state.view;
      if (!on && e.classList.contains("on")) { e.classList.remove("on"); A.views[v]?.hide?.(); }
      e.getAnimations().forEach((an) => an.cancel());
      e.style.transform = e.style.opacity = e.style.transformOrigin = "";
    }
    A.morphing = false; morph = null; overlay.clear(); $(".rail").classList.remove("travelling"); A.emit("morphend", A.state.view);
  };
  if (!moving) { settle(); return; }
  let a1 = null, ended = false;
  const end = () => { if (ended) return; ended = true; if (seq === morphSeq) settle(); };
  morph = { finish() { if (a1) a1.onfinish = null; end(); } };
  // A view measures itself the first time it is shown. Start scaling it only
  // after that (two frames: layout, then the ResizeObserver), or it lays itself
  // out at 86% or 112% of its size and the sound lands in the wrong place.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (ended || seq !== morphSeq) return;
    const to = A.views[id].anchor?.() || null;
    const [ko, kn] = KEYFRAMES[dir], D = 620 * (A.slow || 1), ease = "cubic-bezier(.65,0,.25,1)";
    const origin = (r) => (r ? `${r.x + r.w / 2}px ${r.y + r.h / 2}px` : "50% 50%");
    const fr = rel(from), tr = rel(to);
    oldEl.style.transformOrigin = origin(fr); newEl.style.transformOrigin = origin(tr);
    // the old view leaves in the first half, the new arrives in the second: in
    // between, the sound alone carries you across
    a1 = oldEl.animate([{ transform: ko[0], opacity: 1 }, { opacity: 0, offset: 0.45 }, { transform: ko[1], opacity: 0 }], { duration: D, easing: ease, fill: "forwards" });
    newEl.animate([{ transform: kn[0], opacity: 0 }, { opacity: 0, offset: 0.4 }, { transform: kn[1], opacity: 1 }], { duration: D, easing: ease, fill: "forwards" });
    newEl.style.opacity = "";
    overlay.fly(A.inHand(), from, to, dir, D);
    $(".rail").classList.add("travelling"); puck(prev, id, D);
    a1.onfinish = end;
  }));
};
// a link to a level (#taste, #patch …) moves there, as the rail would
window.addEventListener("hashchange", () => { const id = location.hash.slice(1); if (A.booted && A.views[id] && id !== A.state.view) A.show(id); });
A.zoom = (dir) => {
  if (morph) return;
  const cur = LEVELS.indexOf(A.state.view === "evolve" ? "perform" : A.state.view);
  const next = cur + (dir === "in" ? 1 : -1);
  if (next < 0 || next >= LEVELS.length) {
    // nothing further that way: the rail nods toward the end it reached
    $(".rail").animate?.([{ translate: "0 0" }, { translate: `0 ${dir === "in" ? 6 : -6}px` }, { translate: "0 0" }], { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" });
    return;
  }
  A.show(LEVELS[next]);
};
// The travelling vessel: one object between two places.
const overlay = (() => {
  let cv, x, raf = 0;
  const ensure = () => { if (cv) return; cv = el("canvas", { class: "morph", "aria-hidden": "true" }); document.body.append(cv); x = cv.getContext("2d"); };
  const size = () => { const d = Math.min(2, devicePixelRatio || 1); cv.width = innerWidth * d; cv.height = innerHeight * d; cv.style.width = innerWidth + "px"; cv.style.height = innerHeight + "px"; x.setTransform(d, 0, 0, d, 0, 0); };
  const ez = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  return {
    fly(p, from, to, dir, D) {
      ensure(); size(); cancelAnimationFrame(raf);
      const shift = dir === "left" ? 1 : -1;
      if (!from && to) from = { x: to.x - shift * to.w * 1.6, y: to.y, w: to.w, h: to.h, fade: true };
      if (from && !to) to = { x: from.x + shift * from.w * 1.4, y: from.y + from.h * 0.1, w: from.w * 0.8, h: from.h * 0.8, fade: true };
      if (!from || !to) return;
      A._fly = { from: { ...from }, to: { ...to }, dir, D };
      const dev = A.audio.devFor(p), t0 = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - t0) / D), k = ez(t);
        const r = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, w: from.w + (to.w - from.w) * k, h: from.h + (to.h - from.h) * k };
        x.clearRect(0, 0, innerWidth, innerHeight);
        x.globalAlpha = from.fade ? k : to.fade ? 1 - k : 1;
        A.face(x, r.h, p, { box: r, dev, glow: Math.max(6, r.h * 0.06), lw: Math.max(1, r.h / 180) });
        x.globalAlpha = 1;
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    },
    clear() { cancelAnimationFrame(raf); if (x) x.clearRect(0, 0, innerWidth, innerHeight); },
  };
})();
// A view reports where the sound in hand sits, in page pixels.
A.pageRect = (elm, r) => { const b = elm.getBoundingClientRect(); return { x: b.left + r.x, y: b.top + r.y, w: r.w, h: r.h }; };
let notesFrom = null;
A.notes = (on) => {
  const n = $(".notes"), was = n.classList.contains("on"); n.classList.toggle("on", on);
  if (on && !was) { notesFrom = document.activeElement; $(".notes .close").focus(); }
  if (!on && was) { notesFrom?.focus?.({ preventScroll: true }); notesFrom = null; }
};

// ---- global keys
let altTimer = null;
function onKey(e) {
  const typing = e.target.closest?.("input, textarea, select");
  if (palOpen) {
    if (e.key === "Escape") { A.palette(false); e.preventDefault(); }
    else if (e.key === "ArrowDown") { palSel = Math.min(palItems.length - 1, palSel + 1); palMark(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { palSel = Math.max(0, palSel - 1); palMark(); e.preventDefault(); }
    else if (e.key === "Enter") { const c = palItems[palSel]; A.palette(false); c?.run(); e.preventDefault(); }
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { A.palette(true); e.preventDefault(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { A.undoLast(); e.preventDefault(); return; }
  if (e.key === "Escape") { A.notes(false); document.body.classList.remove("bank-open", "keys-open"); if (A.state.lens) A.lens(false, true); return; }
  if (e.key === "Alt") { if (!altTimer && !A.state.lens) altTimer = setTimeout(() => { altTimer = null; A.lens(true); }, 220); e.preventDefault(); return; }
  if (altTimer) { clearTimeout(altTimer); altTimer = null; }
  if (e.altKey && /^Digit[1-5]$/.test(e.code)) { if (A.state.lensHeld) A.lens(false); A.show(VIEWS[+e.code.slice(5) - 1][0]); e.preventDefault(); return; }
  if (e.altKey && e.key.startsWith("Arrow")) {
    if (A.state.lensHeld) A.lens(false);
    if (e.key === "ArrowUp") A.zoom("out"); else if (e.key === "ArrowDown") A.zoom("in");
    else if (e.key === "ArrowLeft") A.show("evolve"); else if (e.key === "ArrowRight" && A.state.view === "evolve") A.show("perform");
    e.preventDefault(); return;
  }
  if (typing || e.metaKey || e.ctrlKey) return;
  if (A.views[A.state.view]?.key?.(e)) { e.preventDefault(); return; }
  const k = e.key.toLowerCase();
  if (k in KEYMAP && !e.repeat) { AU.noteOn("kb" + k, KEYMAP[k] + octave * 12); e.preventDefault(); return; }
  if (k === "z" || k === "x") { octave = Math.max(-1, Math.min(1, octave + (k === "x" ? 1 : -1))); A.keysDraw(); return; }
  if (e.key === " ") { A.audio.toggle(A.inHand()); e.preventDefault(); return; }
  if (e.key === "?") { A.palette(true); e.preventDefault(); return; }
  if (e.key === "-" || e.key === "=") { A.zoom(e.key === "=" ? "in" : "out"); return; }
  if (k === "m") { A.save(A.inHand()); return; }
  if (e.key === "[" || e.key === "]") { const arr = A.presets.filter((p) => !A.state.cut.has(p.id)); const i = arr.findIndex((p) => p.id === A.state.inHand); const n = arr[(i + (e.key === "]" ? 1 : -1) + arr.length) % arr.length]; A.setInHand(n.id, { play: true }); A.bankFlash(n.id); return; }
  if (/^[1-5]$/.test(e.key) && A.state.view !== "evolve") { A.star(A.inHand(), +e.key); return; }
}
function onKeyUp(e) {
  if (e.key === "Alt") { if (altTimer) { clearTimeout(altTimer); altTimer = null; } if (A.state.lensHeld) A.lens(false); return; }
  const k = e.key.toLowerCase(); if (k in KEYMAP) AU.noteOff("kb" + k);
}

// ---- boot
A.boot = () => {
  const mq = (q, cls) => { const m = matchMedia(q), f = () => document.body.classList.toggle(cls, m.matches); f(); m.addEventListener?.("change", f); };
  mq("(hover: none) and (pointer: coarse)", "touch");
  mq("(max-height: 500px) and (orientation: landscape)", "short");
  header(); bank(); keys(); guide();
  // grain: a fixed noise texture, generated once
  const [gc, gx] = A.canvas(160); const id = gx.createImageData(gc.width, gc.height);
  for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
  gx.putImageData(id, 0, 0); $(".grain").style.backgroundImage = `url(${gc.toDataURL()})`;
  A.cmd({ id: "go-model", label: "How it learns: the model room", key: "⌥5", icon: "teach", run: () => A.show("model") });
  A.cmd({ id: "go-taste", label: "Zoom out to TASTE", key: "⌥↑", icon: "taste", run: () => A.show("taste") });
  A.cmd({ id: "go-perform", label: "The sound: PERFORM", key: "⌥1", icon: "perform", run: () => A.show("perform") });
  A.cmd({ id: "go-patch", label: "Zoom in to PATCH", key: "⌥↓", icon: "patch", run: () => A.show("patch") });
  A.cmd({ id: "go-evolve", label: "Beside it: EVOLVE", key: "⌥←", icon: "evolve", run: () => A.show("evolve") });
  A.cmd({ id: "play", label: "Play the sound in hand", key: "Space", icon: "play", run: () => A.audio.toggle(A.inHand()) });
  A.cmd({ id: "save", label: "Save the sound in hand", key: "M", icon: "save", run: () => A.save(A.inHand()) });
  A.cmd({ id: "cut", label: "Cut the sound in hand", icon: "cut", run: () => A.cut(A.inHand()) });
  A.cmd({ id: "lens", label: "Show what the model thinks", key: "⌥ hold", icon: "lamp", run: () => A.lens(!A.state.lens, true) });
  A.cmd({ id: "undo", label: "Take back the last pick or cut", key: "⌘Z", icon: "undo", run: () => A.undoLast() });
  A.cmd({ id: "next", label: "Next sound in the bank", key: "]", icon: "chev", run: () => onKey({ key: "]", target: document.body, preventDefault() {}, code: "" }) });
  A.cmd({ id: "oct", label: "Octave down / up", key: "Z X", icon: "keys", run: () => {} });
  A.cmd({ id: "notes", label: "About this prototype", icon: "notes", run: () => A.notes(true) });
  A.cmd({ id: "guide", label: "Show the first-visit steps again", icon: "chev", run: () => A.guideReset() });
  rail();
  for (const [id] of VIEWS) A.views[id]?.mount?.($("#view-" + id));
  gestures();
  // moving through the space comes first: no focused control may swallow ⌥ and an arrow
  document.addEventListener("keydown", (e) => {
    if (!e.altKey || e.metaKey || e.ctrlKey || palOpen) return;
    if (!(e.key.startsWith("Arrow") || /^Digit[1-5]$/.test(e.code))) return;
    e.stopPropagation(); onKey(e);
  }, true);
  document.addEventListener("keydown", onKey);
  document.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", () => { if (A.state.lensHeld) A.lens(false); });
  $(".scrim").addEventListener("click", () => A.palette(false));
  $(".palette input").addEventListener("input", (e) => palDraw(e.target.value));
  $(".notes .close").addEventListener("click", () => A.notes(false));
  const start = (location.hash || "#perform").slice(1);
  A.state.view = A.views[start] ? start : "perform";
  A.show(A.state.view); A.booted = true;
};

// ---- the depth rail: where you are, and the way in and out
function rail() {
  const stop = (id, label, key, hint) => el("button", { class: "rail-stop", "data-view": id, "aria-label": `${label}: ${hint} (${key})`, title: `${label} · ${key}`, onclick: () => A.show(id), html: `${A.icon(id)}<span class="rl">${label}</span>` });
  const r = el("nav", { class: "rail", "aria-label": "Where you are" },
    el("span", { class: "rail-hint rail-up", "aria-hidden": "true" }, "out"),
    stop("model", "Learning", "⌥↑ ⌥↑", "how it learns"),
    el("span", { class: "rail-line", "aria-hidden": "true" }),
    stop("taste", "Taste", "⌥↑", "zoom out"),
    el("span", { class: "rail-line", "aria-hidden": "true" }),
    el("div", { class: "rail-mid" }, stop("evolve", "Evolve", "⌥←", "beside it"), el("span", { class: "rail-branch", "aria-hidden": "true" }), stop("perform", "Perform", "⌥1", "the sound")),
    el("span", { class: "rail-line", "aria-hidden": "true" }),
    stop("patch", "Patch", "⌥↓", "zoom in"),
    el("span", { class: "rail-hint rail-down", "aria-hidden": "true" }, "in"),
    el("button", { class: "rail-stop rail-keys", "aria-label": "Keys", onclick: () => document.body.classList.toggle("keys-open"), html: `${A.icon("keys")}<span class="rl">Keys</span>` }));
  $(".stage").append(r);
}
// Pinch or ⌥-scroll zooms between levels; two fingers on a touch screen too.
function gestures() {
  const st = $(".stage"); let acc = 0, lastT = 0;
  st.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.altKey)) return;
    e.preventDefault();
    const now = performance.now(); if (now - lastT > 400) acc = 0; lastT = now;
    acc += e.deltaY;
    if (Math.abs(acc) > 70) { A.zoom(acc < 0 ? "in" : "out"); acc = 0; lastT = now + 500; }
  }, { passive: false });
  const pts = new Map(); let d0 = 0;
  const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  st.addEventListener("pointerdown", (e) => { if (e.pointerType !== "touch") return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) d0 = dist(); });
  st.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && d0) {
      const k = dist() / d0;
      if (k > 1.3) { A.zoom("in"); d0 = 0; railPreview(null); } else if (k < 0.77) { A.zoom("out"); d0 = 0; railPreview(null); }
      else railPreview(k >= 1 ? "in" : "out", k >= 1 ? (k - 1) / 0.3 : (1 - k) / 0.23);
    }
  });
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) { d0 = 0; railPreview(null); } };
  st.addEventListener("pointerup", up); st.addEventListener("pointercancel", up);
  document.querySelector(".sheet-scrim")?.addEventListener("click", () => document.body.classList.remove("bank-open", "keys-open"));
  window.addEventListener("resize", () => railIndicator());
  document.fonts?.ready?.then(() => railIndicator());
}
})();
