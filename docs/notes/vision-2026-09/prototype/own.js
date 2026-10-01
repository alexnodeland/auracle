// BRING YOUR OWN SOUND: drop a recording on the well and it gets a face, a
// place on the map and the presets nearest it. Hold it and the named controls
// process it: audio input, demonstrated with a file.
(() => {
"use strict";
const { el, icon } = A;
const N = 4096, HOP = 1024, NB = A.D.bands_hz.length, MAX_S = 30;
// The engine's bands: 40, geometric, 35 Hz to 14 kHz.
const EDGES = Array.from({ length: NB + 1 }, (_, i) => 35 * Math.pow(14000 / 35, i / NB));
const MEAN = A.D.mean_db, SD = A.D.sd_db, MEAN_MAX = Math.max(...MEAN);
let nextId = 1000;

// ---- a small radix-2 FFT, N = 4096
const REV = new Uint32Array(N), COS = new Float64Array(N / 2), SIN = new Float64Array(N / 2);
for (let i = 0, bits = Math.log2(N); i < N; i++) { let r = 0, x = i; for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } REV[i] = r; }
for (let i = 0; i < N / 2; i++) { COS[i] = Math.cos((2 * Math.PI * i) / N); SIN[i] = -Math.sin((2 * Math.PI * i) / N); }
function fft(re, im) {
  for (let i = 0; i < N; i++) { const j = REV[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let i = 0; i < N; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
      const a = i + j, b = a + half;
      const tr = re[b] * COS[k] - im[b] * SIN[k], ti = re[b] * SIN[k] + im[b] * COS[k];
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
}

// ---- the same measurements the presets carry, from any recording
function analyse(buf) {
  const sr = buf.sampleRate, len = Math.min(buf.length, Math.floor(sr * MAX_S)), ch = buf.numberOfChannels;
  const x = new Float32Array(Math.max(len, N));
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) x[i] += d[i] / ch; }
  const bandOf = new Int16Array(N / 2 + 1).fill(-1), count = new Float64Array(NB);
  for (let k = 0; k <= N / 2; k++) { const hz = (k * sr) / N; for (let b = 0; b < NB; b++) if (hz >= EDGES[b] && hz < EDGES[b + 1]) { bandOf[k] = b; count[b]++; break; } }
  const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const re = new Float64Array(N), im = new Float64Array(N), frames = [], energy = [];
  for (let s = 0; s + N <= x.length; s += HOP) {
    for (let i = 0; i < N; i++) { re[i] = x[s + i] * win[i]; im[i] = 0; }
    fft(re, im);
    const bands = new Float64Array(NB); let e = 0;
    for (let k = 0; k <= N / 2; k++) { const pw = re[k] * re[k] + im[k] * im[k]; e += pw; const b = bandOf[k]; if (b >= 0) bands[b] += pw; }
    for (let b = 0; b < NB; b++) bands[b] = count[b] ? bands[b] / count[b] : 0;
    frames.push(bands); energy.push(e);
  }
  const loudest = Math.max(...energy);
  if (!(loudest > 0)) throw new Error("silent");
  // the average spectrum over the frames within 40 dB of the loudest
  const ltas = new Float64Array(NB); let n = 0;
  frames.forEach((f, i) => { if (energy[i] < loudest * 1e-4) return; n++; for (let b = 0; b < NB; b++) ltas[b] += f[b]; });
  const top = Math.max(...ltas);
  const ltas_db = Array.from(ltas, (v) => Math.round(Math.max(-60, 10 * Math.log10(v / top + 1e-12)) * 10) / 10);
  // twelve slices of the whole recording, each as loud as it was
  const groups = Array.from({ length: 12 }, (_, g) => frames.slice(Math.floor((g * frames.length) / 12), Math.floor(((g + 1) * frames.length) / 12)));
  const sl = groups.map((gr) => { const m = new Float64Array(NB); for (const f of gr) for (let b = 0; b < NB; b++) m[b] += f[b] / gr.length; return m; });
  const gmax = Math.max(...sl.map((m) => Math.max(...m)));
  const sdev = [], sloud = [];
  for (const m of sl) {
    if (!m.some((v) => v > 0)) { sdev.push(ltas_db.map((v, i) => (v - MEAN[i]) / SD)); sloud.push(0); continue; }
    const s = Array.from(m, (v) => Math.max(-60, 10 * Math.log10(v / gmax + 1e-12)));
    const smax = Math.max(...s);
    sdev.push(s.map((v, i) => Math.round((((v - smax) - (MEAN[i] - MEAN_MAX)) / SD) * 100) / 100));
    sloud.push(Math.round(Math.min(1, Math.max(0, (smax + 60) / 60)) * 100) / 100);
  }
  return { ltas_db, sdev, sloud };
}

// ---- a recording becomes a sound like any other
function addBuffer(name, buffer, { show = true } = {}) {
  const a = analyse(buffer);
  const p = {
    id: nextId++, name: (name || "Your sound").slice(0, 32), category: "yours", blurb: "your sound",
    ltas_db: a.ltas_db, sdev: a.sdev, sloud: a.sloud, yours: true,
    // its patch is the recording itself, coming in through an audio input
    tree: { amp: { attack: 0.005, decay: 0.3, sustain: 1, release: 0.2 }, root: { AudioIn: { device: "file", mode: "process", gain: 0.7 } } },
  };
  p.dev = A.devOf(p);
  const near = A.presets.filter((q) => q.id < 1000)
    .map((q) => ({ q, d: q.dev.reduce((s, v, i) => s + (v - p.dev[i]) ** 2, 0) }))
    .sort((x, y) => x.d - y.d);
  const three = near.slice(0, 3).map((o) => o.q);
  // placed by its spectrum: an approximation, said so on the card
  p.z = three[0].z.map((_, i) => three.reduce((s, q) => s + q.z[i], 0) / 3);
  p.xy = [0, 1].map((k) => three.reduce((s, q) => s + q.xy[k], 0) / 3);
  p.near = near.slice(0, 6).map((o) => o.q.id);
  p.nearD = near.slice(0, 6).map((o) => o.d);
  A.audio.bufs.set(p.id, Promise.resolve(buffer));
  A.presets.push(p); A.byId.set(p.id, p);
  A.emit("yours", p);
  if (show) { if (A.state.view !== "perform") A.show("perform"); card(p); }
  return p;
}
async function bring(file) {
  const ctx = A.audio.ensure();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    addBuffer(file.name.replace(/\.[^.]+$/, ""), buf);
  } catch (err) {
    A.toast({ text: err && err.message === "silent" ? `${file.name} is silent.` : `Couldn't read ${file.name}: this browser can't decode it.` });
  }
}

// ---- the card, inside PERFORM's well. The dropped face sits at the centre;
// the presets nearest it fly in from the bank and settle around it, closer
// the nearer they sound, joined by thin lines. The motion says "nearest".
let current = null, webRaf = 0;
const WEB_W = 258, WEB_H = 152, CX = WEB_W / 2, CY = 74, FACE = 70, NEAR = 30;
const live = el("div", { class: "sr", "aria-live": "polite" });
function slots(p) {
  const dmax = Math.max(...p.nearD, 1e-6), ang = [-150, -30, 90].map((a) => (a * Math.PI) / 180);
  return p.near.slice(0, 3).map((id, i) => {
    const r = 56 + 42 * Math.sqrt(p.nearD[i] / dmax);
    return { id, x: CX + Math.cos(ang[i]) * r, y: CY + Math.sin(ang[i]) * r * 0.6 };
  });
}
function close(c) {
  current = null;
  if (A.reduced || !c.classList.contains("own-sheet")) { c.remove(); return; }
  c.animate([{ transform: "none" }, { transform: "translateY(105%)" }], { duration: 220, easing: "cubic-bezier(.6,0,.8,.4)" }).onfinish = () => c.remove();
}
A.on("view", (v) => { if (v !== "perform") document.querySelectorAll(".own-card.own-sheet").forEach((c) => c.remove()); });
function card(p, { fly = true } = {}) {
  current = p;
  const well = document.querySelector("#view-perform .pf-well"); if (!well) return;
  document.querySelectorAll(".own-card").forEach((x) => x.remove());
  cancelAnimationFrame(webRaf); webRaf = 0;
  const held = A.state.inHand === p.id;
  const [lc, lx] = A.canvas(WEB_W, WEB_H); lc.classList.add("own-lines");
  const centre = el("button", { class: "own-face", style: `left:${CX - FACE / 2 - 4}px;top:${CY - FACE / 2 - 4}px`, "aria-label": `Play ${p.name}`, title: "Play", onclick: () => A.audio.toggle(p) },
    A.faceCanvas(p, FACE, { glow: 12, dev: A.audio.devFor(p) }));
  const ss = slots(p);
  const nears = ss.map((sl, i) => {
    const q = A.byId.get(sl.id);
    return el("button", { class: "own-near", style: `left:${sl.x - NEAR / 2 - 3}px;top:${sl.y - NEAR / 2 - 3}px`, title: q.name,
      "aria-label": `Nearest ${i + 1}: ${q.name}. Hold it`, onclick: () => A.setInHand(q.id, { play: true }) }, A.faceCanvas(q, NEAR, { layers: false }));
  });
  const web = el("div", { class: "own-web" }, lc, centre, ...nears);
  const c = el("section", { class: "own-card", role: "group", "aria-label": `Your sound: ${p.name}` },
    el("div", { class: "own-top" },
      el("span", { class: "cap own-yours" }, el("span", { class: "own-star", "aria-hidden": "true" }), "Yours"),
      el("div", { class: "own-name", title: p.name }, p.name),
      el("button", { class: "own-x", "aria-label": "Close", onclick: () => close(c), html: icon("x") })),
    web,
    el("div", { class: "own-quiet mono" }, "placed by its spectrum"),
    el("div", { class: "own-acts" },
      el("button", { class: "btn own-hold", disabled: held, onclick: () => A.setInHand(p.id, { play: true }), html: held ? "In hand" : `${icon("input")}Hold it` }),
      el("button", { class: "btn", onclick: () => { A.tasteFocus = p.id; A.show("taste"); }, html: `${icon("map")}Show on map` }),
      el("button", { class: "btn own-breed", onclick: () => breed(p), html: `${icon("evolve")}Breed toward it` })));
  for (const t of ["click", "pointermove", "pointerdown"]) c.addEventListener(t, (e) => e.stopPropagation());
  // on a phone the loop keeps its screen: the card is a sheet that rises over the controls
  if (matchMedia("(max-width: 700px)").matches) { c.classList.add("own-sheet"); document.body.append(c); } else well.append(c);
  // the lines grow from the centre once each face has landed
  const lines = ss.map(() => ({ t0: null }));
  const drawLines = (now) => {
    lx.clearRect(0, 0, WEB_W, WEB_H);
    ss.forEach((sl, i) => {
      const L = lines[i]; if (L.t0 == null || now < L.t0) return;
      const k = Math.min(1, (now - L.t0) / 260), dx = sl.x - CX, dy = sl.y - CY, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
      const a0 = FACE * 0.44, a1 = len - NEAR * 0.58, b = a0 + (a1 - a0) * k;
      lx.beginPath(); lx.moveTo(CX + ux * a0, CY + uy * a0); lx.lineTo(CX + ux * b, CY + uy * b);
      lx.strokeStyle = "rgba(142,240,177,.45)"; lx.lineWidth = 1; lx.stroke();
    });
  };
  const loop = (now) => { webRaf = 0; drawLines(now); if (lines.some((L) => L.t0 == null || now < L.t0 + 260)) webRaf = requestAnimationFrame(loop); };
  if (!fly || A.reduced) { const now = performance.now(); lines.forEach((L) => (L.t0 = now - 1000)); drawLines(now); live.textContent = `${p.name}: nearest ${ss.map((sl) => A.byId.get(sl.id).name).join(", ")}.`; return; }
  nears.forEach((n) => (n.style.opacity = "0"));
  webRaf = requestAnimationFrame(loop);
  const cr = c.getBoundingClientRect(), list = document.querySelector(".bank-list")?.getBoundingClientRect();
  ss.forEach((sl, i) => {
    const q = A.byId.get(sl.id), to = nears[i].getBoundingClientRect();
    const row = document.querySelector(`.bank-list [data-id="${q.id}"] canvas`);
    let from = row?.getBoundingClientRect();
    // from its row in the bank if you can see it, otherwise in from the side
    if (!from || !list || from.width === 0 || from.bottom < list.top || from.top > list.bottom) from = { left: cr.left - 70, top: cr.top + 40 + i * 44, width: NEAR };
    const f = A.faceCanvas(q, NEAR, { layers: false, glow: 6 });
    Object.assign(f.style, { position: "fixed", left: from.left + "px", top: from.top + "px", zIndex: 80, pointerEvents: "none" });
    document.body.append(f);
    const dx = to.left + 3 - from.left, dy = to.top + 3 - from.top;
    const a = f.animate([
      { transform: "translate(0,0) scale(.9)", opacity: 0.5 },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 28}px) scale(1.18)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 1 },
    ], { duration: 780, delay: 140 + i * 150, easing: "cubic-bezier(.6,0,.2,1)", fill: "backwards" });
    a.onfinish = () => { f.remove(); nears[i].style.opacity = ""; lines[i].t0 = performance.now(); if (!webRaf) webRaf = requestAnimationFrame(loop); };
  });
  live.textContent = `${p.name}: nearest ${ss.map((sl) => A.byId.get(sl.id).name).join(", ")}.`;
}
// Breeding toward it: each new sound starts as an amber seed inside the dropped
// face, buds out beside it, then flies to the pool.
function breed(p) {
  const kids = p.near.filter((id) => !A.pool.has(id) && !A.state.cut.has(id));
  if (!kids.length) { A.toast({ face: p, text: `The sounds nearest ${p.name} are already in the pool.` }); return; }
  const join = (id) => { A.budFrom = p.id; A.pool.add(id); A.bankDraw(); A.budFrom = null; A.bankFlash(id); };
  live.textContent = `${kids.length} sounds near ${p.name} join the pool.`;
  const centre = document.querySelector(".own-card .own-face"), tab = document.querySelector(".bank-tabs .btab");
  const bankHidden = !tab || tab.getBoundingClientRect().width === 0 || getComputedStyle(document.querySelector(".bank")).transform !== "none" && matchMedia("(max-width: 700px)").matches;
  const bankBtn = document.querySelector(".narrow-bank"), btnSeen = bankBtn && bankBtn.getBoundingClientRect().width > 0;
  if (A.reduced || !centre || (bankHidden && !btnSeen)) { kids.forEach(join); A.toast({ face: p, text: `${kids.length} sounds near ${p.name} join the pool.` }); return; }
  const dest = () => (bankHidden ? bankBtn : document.querySelector(".bank-tabs .btab")).getBoundingClientRect();
  const c = centre.getBoundingClientRect(), cx = c.left + c.width / 2, cy = c.top + c.height / 2, S = 34;
  kids.forEach((id, i) => {
    const q = A.byId.get(id);
    const ang = ((-90 + (i - (kids.length - 1) / 2) * 32) * Math.PI) / 180, R = 66;
    const bx = cx + Math.cos(ang) * R, by = cy + Math.sin(ang) * R;
    const seed = el("div", { class: "own-seed", "aria-hidden": "true" });
    Object.assign(seed.style, { left: cx - 4 + "px", top: cy - 4 + "px" });
    const f = A.faceCanvas(q, S, { glow: 8 });
    Object.assign(f.style, { position: "fixed", left: bx - S / 2 + "px", top: by - S / 2 + "px", zIndex: 81, pointerEvents: "none", opacity: "0" });
    document.body.append(seed, f);
    const d0 = i * 150;
    seed.animate([{ transform: "scale(0)", opacity: 0 }, { transform: "scale(1.5)", opacity: 1, offset: 0.55 }, { transform: "scale(1)", opacity: 1 }], { duration: 280, delay: d0, fill: "forwards" });
    const bud = f.animate([{ transform: `translate(${cx - bx}px, ${cy - by}px) scale(.1)`, opacity: 1 }, { transform: "translate(0,0) scale(1)", opacity: 1 }],
      { duration: 520, delay: d0 + 240, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" });
    bud.onfinish = () => {
      seed.remove();
      const t = dest();
      const fly = f.animate([{ transform: "translate(0,0) scale(1)", opacity: 1 }, { transform: `translate(${t.left + t.width / 2 - bx}px, ${t.top + t.height / 2 - by}px) scale(.3)`, opacity: 0.85 }],
        { duration: 640, delay: 200 + (kids.length - 1 - i) * 40, easing: "cubic-bezier(.6,0,.2,1)", fill: "forwards" });
      fly.onfinish = () => {
        f.remove(); join(id);
        (bankHidden ? bankBtn : document.querySelector(".bank-tabs .btab"))?.animate?.([{ boxShadow: "0 0 0 0 rgba(142,240,177,.55)" }, { boxShadow: "0 0 0 8px rgba(142,240,177,0)" }], { duration: 420 });
      };
    };
  });
}
A.on("inhand", () => { if (current && document.querySelector(".own-card")) card(current, { fly: false }); });
A.on("fx", (d) => { if (current && A.state.inHand === current.id && d) { const f = document.querySelector(".own-face"); if (f) f.replaceChildren(A.faceCanvas(current, FACE, { glow: 12, dev: A.audio.devFor(current) })); } });

// ---- getting a file in: a drop anywhere (the well lights), or the palette
const input = el("input", { type: "file", accept: "audio/*", class: "sr", tabindex: "-1", "aria-hidden": "true", onchange: (e) => { const f = e.target.files[0]; if (f) bring(f); e.target.value = ""; } });
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
let depth = 0;
const hint = el("div", { class: "own-hint", "aria-hidden": "true", html: `${icon("drop")}<span>Drop a sound to see its face</span>` });
function dragOn(on) {
  document.body.classList.toggle("own-drag", on);
  const well = document.querySelector("#view-perform .pf-well");
  if (on) { (A.state.view === "perform" && well ? well : document.querySelector(".stage")).append(hint); } else hint.remove();
}
document.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; depth++; dragOn(true); });
document.addEventListener("dragover", (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
document.addEventListener("dragleave", (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) dragOn(false); });
document.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); depth = 0; dragOn(false);
  const f = [...e.dataTransfer.files].find((f) => f.type.startsWith("audio/") || /\.(wav|mp3|m4a|aac|ogg|oga|flac|aiff?|webm|caf)$/i.test(f.name));
  if (!f) { A.toast({ text: "That isn't an audio file." }); return; }
  bring(f);
});
A.cmd({ id: "own-bring", label: "Bring your own sound…", icon: "drop", run: () => input.click() });
A.own = { addBuffer, analyse, bring, card };

const css = `
.own-card { position:absolute; left:14px; top:14px; z-index:4; width:284px; padding:12px 12px 12px; border-radius:var(--r2); cursor:default;
  background:rgba(22,25,30,.95); backdrop-filter:blur(6px); border:1px solid var(--hair-hi); box-shadow:0 18px 40px -18px rgba(0,0,0,.9);
  animation:nextin var(--d-move) var(--e-settle); }
.pf-well .own-card canvas { position:static; inset:auto; display:block; }
.own-top { display:grid; grid-template-columns:auto 1fr auto; gap:10px; align-items:center; }
.own-yours { display:inline-flex; align-items:center; gap:6px; color:var(--silk); }
.own-star { width:9px; height:9px; background:var(--silk); clip-path:polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%); }
.own-name { font:500 15px/1.2 var(--f-silk); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
.own-x { width:26px; height:26px; border-radius:50%; display:grid; place-items:center; color:var(--silk-mute); }
.own-x:hover { color:var(--silk); background:var(--plate); }
.own-x svg { width:14px; height:14px; }
.own-web { position:relative; width:${WEB_W}px; height:${WEB_H}px; margin:6px auto 0; border-radius:var(--r1);
  background:radial-gradient(60% 60% at 50% 48%, rgba(142,240,177,.05), transparent 70%); }
.own-web .own-lines, .pf-well .own-web .own-lines { position:absolute; left:0; top:0; pointer-events:none; }
.own-web { overflow:hidden; }
.own-face, .own-near { position:absolute; display:grid; place-items:center; border-radius:var(--r1); border:1px solid transparent; transition:border-color var(--d-state), background var(--d-state); }
.own-face { padding:3px; }
.own-near { padding:2px; }
.own-face:hover, .own-face:focus-visible, .own-near:hover, .own-near:focus-visible { border-color:var(--hair-hi); background:rgba(26,30,35,.8); }
.own-quiet { font-size:11px; color:var(--silk-mute); text-align:center; margin-top:2px; }
.own-acts { display:grid; gap:6px; margin-top:10px; }
.own-acts .btn { height:32px; padding-inline:10px; font-size:10px; letter-spacing:.14em; justify-content:flex-start; }
.own-acts .btn svg { width:13px; height:13px; }
.own-seed { position:fixed; width:8px; height:8px; border-radius:50%; z-index:82; pointer-events:none; background:var(--amber); box-shadow:0 0 10px var(--amber-glow), 0 0 3px var(--amber); }
.own-hint { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); z-index:5; display:flex; align-items:center; gap:10px; padding:10px 16px; border-radius:999px;
  background:rgba(12,13,16,.86); border:1px solid var(--green-deep); color:var(--silk); font-size:14px; pointer-events:none; white-space:nowrap; }
.own-hint svg { width:16px; height:16px; color:var(--green); }
body.own-drag #view-perform .pf-well { border-color:var(--green-dim); box-shadow:inset 0 0 0 1px var(--green-deep), inset 0 0 60px -20px var(--green-glow); }
@media (max-width: 700px) {
  .own-card.own-sheet { position:fixed; left:0; right:0; top:auto; bottom:var(--nav-h, 62px); width:auto; z-index:54; border-radius:16px 16px 0 0; background:var(--panel); backdrop-filter:none;
    padding:10px 14px 14px; border-bottom:0; animation:ownsheet var(--d-move) var(--e-settle); box-shadow:0 -20px 40px -20px rgba(0,0,0,.9); }
  .own-sheet::before { content:""; display:block; width:36px; height:4px; border-radius:2px; background:var(--hair-hi); margin:0 auto 8px; }
  .own-sheet .own-acts { grid-template-columns:1fr 1fr 1fr; }
  .own-sheet .own-acts .btn { height:44px; justify-content:center; padding-inline:6px; font-size:9px; letter-spacing:.1em; }
  .own-sheet .own-acts .btn svg { display:none; }
}
@keyframes ownsheet { from { transform:translateY(100%); } to { transform:none; } }
`;
document.head.append(el("style", {}, css));
document.addEventListener("DOMContentLoaded", () => document.body.append(input, live));
if (document.readyState !== "loading") document.body.append(input, live);
})();
