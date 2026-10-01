// PERFORM: the sound in hand, largest; six named controls wired to its shape;
// the model's offer drawn as a guess beside it.
(() => {
"use strict";
const { el, icon } = A;
const NB = A.D.bands_hz.length;
const band = (hz) => A.bandOfHz(hz);
const fmtHz = (f) => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1) + " kHz" : Math.round(f) + " Hz");
// Each control: what it is called, its two ends, where it lives on the vessel,
// the feature the model's lean is read from, and the modules it would move.
const DIMS = [
  { id: "bright", name: "Bright", ends: ["dark", "bright"], hi: [band(1800), NB - 1], lean: "centroid_mean:p2", kinds: ["Filter", "Eq"], param: "cutoff",
    val: (v) => (v < 0.49 ? "lowpass " + fmtHz(350 * Math.pow(18000 / 350, v / 0.5)) : v > 0.51 ? "+" + ((v - 0.5) / 0.5 * 12).toFixed(1) + " dB air" : "as made") },
  { id: "body", name: "Body", ends: ["thin", "heavy"], hi: [0, band(260)], lean: "bass_fraction:p2", kinds: ["Eq", "Vco", "Supersaw"], param: "octave",
    val: (v) => (Math.abs(v - 0.5) < 0.01 ? "as made" : (v > 0.5 ? "+" : "−") + Math.abs((v - 0.5) * 24).toFixed(1) + " dB low") },
  { id: "snap", name: "Snap", ends: ["soft", "sharp"], hi: null, layer: 0, lean: "attack_s:p2", flip: true, kinds: ["Env", "Pluck"], param: "attack",
    val: (v) => (Math.abs(v - 0.5) < 0.01 ? "as made" : v < 0.5 ? Math.round((0.003 + (0.5 - v) * 0.5) * 1000) + " ms attack" : "+" + Math.round((v - 0.5) * 140) + "% punch") },
  { id: "motion", name: "Motion", ends: ["still", "restless"], hi: [band(900), band(9000)], sway: true, lean: "held_centroid_std:p2", kinds: ["Lfo", "Steps", "Rand"], param: "rate",
    val: (v) => (v < 0.01 ? "still" : (0.25 + v * 5).toFixed(1) + " Hz sweep") },
  { id: "grit", name: "Grit", ends: ["smooth", "rough"], hi: [band(1500), band(8000)], lean: "flatness_mean:p2", kinds: ["Distortion", "Fold", "Bitcrush"], param: "drive",
    val: (v) => (v < 0.01 ? "clean" : "drive " + Math.round(v * 100) + "%") },
  { id: "space", name: "Space", ends: ["close", "far"], hi: null, haze: true, lean: "tail_ratio:p2", kinds: ["Reverb", "Delay"], param: "mix",
    val: (v) => (v < 0.01 ? "dry" : Math.round(v * 100) + "% room") },
];
const DEF = { bright: 0.5, body: 0.5, snap: 0.5, motion: 0, grit: 0, space: 0 };
const DIM = Object.fromEntries(DIMS.map((d) => [d.id, d]));
// ---- the palette: controls are higher-order "pedals" over the circuit. Each one is a
// blend of the six dimensions the tone stage can move (in the app, of the patch's own
// knobs); a player chooses which sit on their panel, and in what order.
const GROUPS = ["Tone", "Weight", "Dynamics", "Movement", "Space", "Character"];
const BASE_GROUP = { bright: "Tone", body: "Weight", snap: "Dynamics", motion: "Movement", space: "Space", grit: "Character" };
const mk = (id, name, group, ends, w, def) => ({ id, name, group, ends, w, def });
const MACROS = [
  ...DIMS.map((d) => ({ ...d, base: true, group: BASE_GROUP[d.id], w: { [d.id]: 1 }, def: DEF[d.id] })),
  mk("warmth", "Warmth", "Tone", ["cold", "warm"], { bright: -0.6, body: 0.5 }, 0.5),
  mk("air", "Air", "Tone", ["closed", "airy"], { bright: 0.7, body: -0.25 }, 0.5),
  mk("thump", "Thump", "Weight", ["light", "thumping"], { body: 0.7, snap: 0.5 }, 0.5),
  mk("punch", "Punch", "Dynamics", ["gentle", "punchy"], { snap: 0.8, body: 0.35, grit: 0.2 }, 0.5),
  mk("softness", "Softness", "Dynamics", ["hard", "soft"], { snap: -0.8, bright: -0.3 }, 0),
  mk("wobble", "Wobble", "Movement", ["steady", "wobbling"], { motion: 0.9, space: 0.15 }, 0),
  mk("drift", "Drift", "Movement", ["fixed", "drifting"], { motion: 0.45, space: 0.45 }, 0),
  mk("distance", "Distance", "Space", ["near", "distant"], { space: 0.85, bright: -0.35 }, 0),
  mk("haze", "Haze", "Space", ["clear", "hazy"], { space: 0.6, motion: 0.3, snap: -0.3 }, 0),
  mk("bite", "Bite", "Character", ["mild", "biting"], { grit: 0.6, snap: 0.4, bright: 0.25 }, 0),
  mk("lofi", "Lo-fi", "Character", ["clean", "worn"], { grit: 0.75, bright: -0.45 }, 0),
];
for (const m of MACROS) {
  if (m.base) continue;
  const main = Object.entries(m.w).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0][0];
  m.main = main; m.hi = DIM[main].hi; m.param = DIM[main].param; m.sway = !!m.w.motion; m.haze = !!m.w.space;
  m.kinds = [...new Set(Object.keys(m.w).flatMap((d) => DIM[d].kinds))];
  const span = m.def === 0.5 ? 0.5 : 1;
  m.val = (v) => (Math.abs(v - m.def) < 0.01 ? "as made" : `${v > m.def ? "+" : "−"}${Math.round((Math.abs(v - m.def) / span) * 100)}%`);
}
const MAC = Object.fromEntries(MACROS.map((m) => [m.id, m]));
const MAX_PANEL = 8;
const loadPanel = () => { try { const a = JSON.parse(localStorage.getItem("auracle.panel") || "null"); if (Array.isArray(a) && a.length && a.every((id) => MAC[id])) return a.slice(0, MAX_PANEL); } catch {} return DIMS.map((d) => d.id); };
A.state.panel = loadPanel();
const savePanel = () => { try { localStorage.setItem("auracle.panel", JSON.stringify(A.state.panel)); } catch {} };
const panelMacros = () => A.state.panel.map((id) => MAC[id]).filter(Boolean);
// each sound keeps its own settings; what the tone stage hears is the base six plus every blend
const MS = (pid = A.state.inHand) => ((A.state.macro ||= {})[pid] ||= {});
const mval = (m, pid = A.state.inHand) => { const v = MS(pid)[m.id]; return v == null ? m.def : v; };
function effective(pid = A.state.inHand, override = null) {
  const fx = override ? { ...A.fxOf(pid) } : A.fxOf(pid), st = { ...MS(pid), ...(override || {}) };
  for (const d of Object.keys(DEF)) {
    let v = st[d] != null ? st[d] : DEF[d];
    for (const m of MACROS) if (!m.base && st[m.id] != null) v += (m.w[d] || 0) * (st[m.id] - m.def);
    fx[d] = Math.max(0, Math.min(1, v));
  }
  return fx;
}
const leanOf = (c) => Object.entries(c.w).reduce((s, [d, w]) => s + w * A.model.lean(DIM[d].lean) * (DIM[d].flip ? -1 : 1), 0) / Object.values(c.w).reduce((s, w) => s + Math.abs(w), 0);
A.perform = { MACROS, DIMS, GROUPS, mval, effective, panel: () => A.state.panel };

let root, well, cv, ctx, W = 0, H = 0, raf = 0, hover = null, focusCtl = null, how = false, offer = null, peeking = false, lastLive = null, visible = false;
let knobs = {}, kgridEl = null;
// what is drawn settles toward what is true: the vessel's shape and its place in the well
// follow a spring, so a change of control or layout moves, never jumps
let shown = null, devShown = null, devVel = null, devId = null, unsettled = false, peekT = 0, lastDrawn = null, softUntil = 0, springT = 0, snapNext = false;
const coarse = matchMedia("(pointer: coarse)");
const touchy = () => coarse.matches || document.body.classList.contains("touch");
const phone = matchMedia("(max-width: 700px)");
const shortScreen = () => document.body.classList.contains("short") || matchMedia("(max-height: 500px)").matches;

function mount(r) {
  root = r;
  root.style.cssText = "display:none";
  const grid = el("div", { class: "pf" });
  const left = el("div", { class: "pf-left" });
  const head = el("div", { class: "pf-head" });
  well = el("div", { class: "well pf-well" });
  [cv, ctx] = A.canvas(10, 10); cv.setAttribute("role", "img"); well.append(cv);
  const readout = el("div", { class: "pf-read mono", "aria-live": "off" });
  well.append(readout);
  well.append(el("button", { class: "pf-howbtn", "aria-label": "How the controls work", title: "How it works", onclick: (e) => { e.stopPropagation(); setHow(!how); }, html: A.icon("ask") }));
  left.append(head, well);
  const right = el("div", { class: "pf-right" });
  const ctlHead = el("div", { class: "pf-ctlhead" }, el("span", { class: "cap" }, "Controls"),
    el("span", { class: "pf-ctlacts" },
      el("button", { class: "disclose pf-arrange", "aria-haspopup": "dialog", onclick: () => openPalette(), html: `${icon("perform")}Arrange` }),
      el("button", { class: "disclose", "aria-expanded": "false", id: "pf-how", onclick: () => setHow(!how), html: `${icon("chev")}How it works` })));
  const kgrid = el("div", { class: "pf-knobs", role: "group", "aria-label": "Your controls" });
  kgridEl = kgrid; renderKnobs();
  const pads = el("div", { class: "pf-pads", role: "group", "aria-label": "Offer" },
    el("button", { class: "btn primary pf-offer", id: "pf-offer", onclick: () => grow(), html: `${icon("evolve")}Offer<kbd>N</kbd>` }),
    el("button", { class: "btn pf-peek", id: "pf-peek", disabled: true, onpointerdown: () => peek(true), onpointerup: () => peek(false), onpointerleave: () => peeking && peek(false), html: `Peek<kbd>B</kbd>` }),
    el("button", { class: "btn pf-take", id: "pf-take", disabled: true, onclick: () => take(), html: `Take<kbd>⇧↵</kbd>` }),
    el("button", { class: "btn ghost pf-pass", id: "pf-pass", disabled: true, onclick: () => pass(), html: `Pass` }));
  const hood = el("div", { class: "pf-hood", id: "pf-hood", "aria-live": "polite" });
  right.append(ctlHead, kgrid, hood, pads);
  grid.append(left, right);
  root.append(grid);
  drawHead();
  new ResizeObserver(resize).observe(well);
  // a card opened in the well (your own sound) takes its room from the left, and the sound moves over
  new MutationObserver(() => { if (visible) draw(); }).observe(well, { childList: true });
  well.addEventListener("pointermove", (e) => { const r = cv.getBoundingClientRect(); onWellHover(e.clientX - r.left, e.clientY - r.top); });
  well.addEventListener("pointerleave", () => { hover = null; readout.textContent = ""; lightKnob(null); draw(); });
  well.addEventListener("click", () => A.audio.toggle(A.inHand()));
  A.on("inhand", () => {
    offer = null; syncPads(); drawHead(); syncKnobs(); hoodFor(null); draw();
    if (visible && !A.reduced && !anim) root.querySelector(".pf-head").animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
  });
  A.on("fx", () => { syncKnobs(); draw(); });
  A.on("play", () => loop()); A.on("note", () => loop());
  A.on("lens", () => { syncKnobs(); draw(); });
  A.on("morphend", () => { if (visible) draw(); });
  A.on("morphstart", () => { if (visible) draw(); });
  A.on("model", () => { syncKnobs(); });
  A.cmd({ id: "pf-offer", view: "perform", label: "Offer a variant into B", key: "N", icon: "evolve", run: grow });
  A.cmd({ id: "pf-take", view: "perform", label: "Take the offer", key: "⇧↵", icon: "chev", run: take });
  A.cmd({ id: "pf-arrange", view: "perform", label: "Arrange your controls", icon: "perform", run: () => openPalette() });
  A.cmd({ id: "pf-how", view: "perform", label: "How the controls work", key: "?", icon: "notes", run: () => setHow(!how) });
  A.cmd({ id: "pf-reset", view: "perform", label: "Reset every control to as made", icon: "again", run: () => { softUntil = performance.now() + 700; A.state.macro[A.state.inHand] = {}; A.audio.apply(effective()); syncKnobs(); A.emit("fx", {}); for (const k of Object.values(knobs)) pulse(k.box); } });
  syncKnobs(); syncPads();
}

function drawHead() {
  const p = A.inHand();
  const head = root.querySelector(".pf-head");
  head.replaceChildren(
    el("div", { class: "pf-eyebrow" }, el("span", { class: "cap" }, p.category), el("span", { class: "cap", style: "color:var(--silk-mute)" }, "· in hand")),
    el("h1", { class: "display" }, p.name),
    el("p", { class: "blurb" }, p.blurb));
}

// ---- the panel: which controls sit here, in what order; and the palette to change it
function renderKnobs() {
  const g = kgridEl; if (!g) return;
  const ms = panelMacros(), n = ms.length;
  knobs = {};
  g.replaceChildren(...ms.map((c) => knob(c)));
  if (n < MAX_PANEL) g.append(el("button", { class: "kn-add", "aria-label": "Add a control", title: "Add a control", onclick: () => openPalette(), html: "<span>+</span>" }));
  g.style.setProperty("--cols", n <= 6 ? 3 : 4);
  g.style.setProperty("--pcols", n <= 6 ? `repeat(${n}, minmax(0, 1fr)) 30px` : "repeat(4, minmax(0, 1fr))");
  syncKnobs();
}
// a control, pushed to its far end on this sound: what it would do, drawn small
function preview(m, w = 44, h = 64) {
  const [c, x] = A.canvas(w, h), p = A.inHand(), box = { x: 4, y: 3, w: w - 8, h: h - 6 };
  const now = A.fxOf(p.id), to = effective(p.id, { [m.id]: 1 });
  let d1 = A.devOf(p, A.audio.responseDb(to));
  const dg = to.grit - now.grit; if (dg > 0.02) d1 = d1.map((v, i) => v + dg * 0.9 * Math.max(0, (i - 18) / 22) * (1 + 0.35 * Math.sin(i * 2.3)));
  A.face(x, box.h, p, { box, dev: A.audio.devFor(p), layers: false, glow: 0, lw: 1, dim: 0.3 });
  const dsp = to.space - now.space;
  if (dsp > 0.02) for (let k = 1; k <= 2; k++) { A.vesselPath(x, A.smooth(d1, 2), 1 + 0.12 * k * dsp, box); x.strokeStyle = `rgba(142,240,177,${(0.2 * dsp) / k})`; x.lineWidth = 3 * k; x.stroke(); }
  const dm = to.motion - now.motion;
  if (dm > 0.02) { x.save(); x.translate(box.x + box.w / 2, box.y + box.h); x.transform(1, 0, 0.14 * dm, 1, 0, 0); x.translate(-(box.x + box.w / 2), -(box.y + box.h)); A.vesselPath(x, A.smooth(d1, 2), 1, box); x.strokeStyle = "rgba(142,240,177,.35)"; x.lineWidth = 1; x.stroke(); x.restore(); }
  A.vesselPath(x, A.smooth(d1, 1), 1, box); x.strokeStyle = "#8ef0b1"; x.lineWidth = 1.4; x.shadowColor = "rgba(142,240,177,.6)"; x.shadowBlur = 5; x.stroke(); x.shadowBlur = 0;
  const ds = to.snap - now.snap;
  if (Math.abs(ds) > 0.02) { x.fillStyle = ds > 0 ? "rgba(226,255,236,.9)" : "rgba(142,240,177,.3)"; x.fillRect(box.x + box.w * 0.3, box.y + box.h - 2, box.w * 0.4, 2); }
  c.setAttribute("aria-hidden", "true"); return c;
}
let pal = null;
function openPalette() {
  if (!pal) {
    pal = el("div", { class: "pp", role: "dialog", "aria-label": "Your controls" });
    document.body.append(pal);
    pal.addEventListener("keydown", (e) => { if (e.key === "Escape") { closePalette(); e.stopPropagation(); e.preventDefault(); } }, true);
    let d = null; // a phone's sheet: drag its top down to put it away
    pal.addEventListener("pointerdown", (e) => { if (!pal.classList.contains("sheet") || !e.target.closest(".pp-grab, .pp-head") || e.target.closest("button")) return; d = { y: e.clientY }; try { pal.setPointerCapture(e.pointerId); } catch {} pal.style.transition = "none"; });
    pal.addEventListener("pointermove", (e) => { if (d) pal.style.transform = `translateY(${Math.max(0, e.clientY - d.y)}px)`; });
    const end = (e) => { if (!d) return; const dy = e.clientY - d.y; d = null; pal.style.transition = ""; pal.style.transform = ""; if (dy > 70) closePalette(); };
    pal.addEventListener("pointerup", end); pal.addEventListener("pointercancel", end);
  }
  renderPalette(); placePalette(); pal.classList.add("on");
  root.querySelector(".pf-arrange")?.setAttribute("aria-expanded", "true");
  (pal.querySelector(".pp-add:not([disabled])") || pal.querySelector(".pp-x"))?.focus({ preventScroll: true });
}
function closePalette() {
  if (!pal?.classList.contains("on")) return;
  pal.classList.remove("on");
  root.querySelector(".pf-arrange")?.setAttribute("aria-expanded", "false");
  if (visible) root.querySelector(".pf-arrange")?.focus({ preventScroll: true });
}
function placePalette() {
  if (phone.matches || shortScreen()) { pal.classList.add("sheet"); pal.style.left = pal.style.top = pal.style.width = pal.style.height = ""; return; }
  pal.classList.remove("sheet");
  const r = well.getBoundingClientRect();
  Object.assign(pal.style, { left: r.left + "px", top: r.top + "px", width: Math.min(r.width, 460) + "px", height: r.height + "px" });
}
function renderPalette() {
  if (!pal) return;
  const ms = panelMacros(), on = new Set(A.state.panel);
  const row = (m, inPanel, i) => el("div", { class: "pp-row" + (inPanel ? " on" : ""), "data-id": m.id },
    preview(m),
    el("div", { class: "pp-txt" }, el("span", { class: "pp-name" }, m.name), el("span", { class: "pp-ends" }, `${m.ends[0]} · ${m.ends[1]}`)),
    ...(inPanel ? [
      el("button", { class: "pp-b", "aria-label": `Move ${m.name} earlier`, disabled: i === 0, onclick: () => movePanel(m.id, -1), html: "↑" }),
      el("button", { class: "pp-b", "aria-label": `Move ${m.name} later`, disabled: i === ms.length - 1, onclick: () => movePanel(m.id, 1), html: "↓" }),
      el("button", { class: "pp-b pp-rm", "aria-label": `Remove ${m.name}`, disabled: ms.length <= 1, onclick: () => removeMacro(m.id), html: A.icon("x") }),
    ] : [el("button", { class: "pp-b pp-add", "aria-label": `Add ${m.name}`, disabled: ms.length >= MAX_PANEL, onclick: (e) => addMacro(m.id, e.currentTarget.closest(".pp-row")), html: "+" })]));
  pal.replaceChildren(
    el("div", { class: "pp-grab", "aria-hidden": "true" }),
    el("div", { class: "pp-head" },
      el("div", {}, el("div", { class: "cap" }, "Your controls"), el("p", { class: "pp-sub" }, `${ms.length} of ${MAX_PANEL} on the panel · each is a blend of the sound's own knobs`)),
      el("button", { class: "pp-x", "aria-label": "Close", onclick: () => closePalette(), html: A.icon("x") })),
    el("div", { class: "pp-body" },
      el("div", { class: "pp-sec" }, el("div", { class: "pp-h cap" }, "On the panel"), ...ms.map((m, i) => row(m, true, i))),
      ...GROUPS.map((g) => { const avail = MACROS.filter((m) => m.group === g && !on.has(m.id)); return avail.length ? el("div", { class: "pp-sec" }, el("div", { class: "pp-h cap" }, g), ...avail.map((m) => row(m, false))) : ""; })));
}
function flipKnobs(change) {
  const before = new Map(Object.entries(knobs).map(([id, k]) => [id, k.box.getBoundingClientRect()]));
  change();
  if (A.reduced) return;
  for (const [id, k] of Object.entries(knobs)) {
    const b = before.get(id); if (!b) continue;
    const a = k.box.getBoundingClientRect(), dx = b.left - a.left, dy = b.top - a.top;
    if (dx || dy) k.box.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
}
function addMacro(id, fromRow) {
  if (A.state.panel.length >= MAX_PANEL || A.state.panel.includes(id)) return;
  const src = fromRow?.querySelector("canvas")?.getBoundingClientRect();
  flipKnobs(() => { A.state.panel.push(id); savePanel(); renderKnobs(); });
  renderPalette();
  const k = knobs[id]; if (!k) return;
  // the control's picture flies from the palette into its place on the panel
  if (src && !A.reduced && !pal.classList.contains("sheet")) {
    const dst = k.dial.getBoundingClientRect(), fl = preview(MAC[id]);
    Object.assign(fl.style, { position: "fixed", left: src.left + "px", top: src.top + "px", zIndex: 90, pointerEvents: "none" });
    document.body.append(fl);
    k.box.style.opacity = "0";
    fl.animate([{ transform: "translate(0, 0) scale(1)", opacity: 1 }, { transform: `translate(${dst.left + dst.width / 2 - src.left - src.width / 2}px, ${dst.top + dst.height / 2 - src.top - src.height / 2}px) scale(.7)`, opacity: 0.25 }], { duration: 560, easing: "cubic-bezier(.6,0,.2,1)" })
      .onfinish = () => { fl.remove(); k.box.style.opacity = ""; pulse(k.box); };
  } else pulse(k.box);
  (pal.querySelector(`.pp-row.on[data-id="${id}"] .pp-rm`) || pal.querySelector(".pp-x"))?.focus({ preventScroll: true });
}
function removeMacro(id) {
  const i = A.state.panel.indexOf(id); if (i < 0 || A.state.panel.length <= 1) return;
  const m = MAC[id], kept = MS()[id], moved = kept != null && Math.abs(kept - m.def) > 0.01, k = knobs[id];
  const done = () => {
    flipKnobs(() => { A.state.panel.splice(i, 1); savePanel(); delete MS()[id]; A.audio.apply(effective()); renderKnobs(); });
    A.emit("fx", {}); renderPalette();
    A.toast({ text: moved ? `Removed ${m.name}, and its setting with it.` : `Removed ${m.name}.`, undo: () => {
      flipKnobs(() => { A.state.panel.splice(Math.min(i, A.state.panel.length), 0, id); if (kept != null) MS()[id] = kept; savePanel(); A.audio.apply(effective()); renderKnobs(); });
      A.emit("fx", {}); if (pal?.classList.contains("on")) renderPalette(); } });
  };
  if (k && !A.reduced) k.box.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(.6)" }], { duration: 200, easing: "ease-in", fill: "forwards" }).onfinish = done; else done();
}
function movePanel(id, d) {
  const a = A.state.panel, i = a.indexOf(id), j = i + d; if (j < 0 || j >= a.length) return;
  flipKnobs(() => { [a[i], a[j]] = [a[j], a[i]]; savePanel(); renderKnobs(); });
  renderPalette();
  pal.querySelector(`.pp-row.on[data-id="${id}"] .pp-b[aria-label*="${d < 0 ? "earlier" : "later"}"]:not([disabled])`)?.focus({ preventScroll: true });
}
A.on("view", (v) => { if (v !== "perform") closePalette(); });
// Esc puts the palette away wherever focus has gone (a removed row takes its focus with it)
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && pal?.classList.contains("on") && !document.querySelector(".palette.on")) { closePalette(); e.stopPropagation(); e.preventDefault(); } }, true);
A.on("inhand", () => { if (pal?.classList.contains("on")) renderPalette(); });

// ---- knobs
function knob(c) {
  const [kc, kx] = A.canvas(80);
  const box = el("div", { class: "kn", "data-c": c.id });
  const dial = el("div", { class: "kn-dial", role: "slider", tabindex: "0", "aria-label": c.name, "aria-valuemin": "0", "aria-valuemax": "100" }, kc);
  const name = el("div", { class: "kn-name" }, c.name);
  const val = el("div", { class: "kn-val mono" });
  const ends = el("div", { class: "kn-ends" }, el("span", {}, c.ends[0]), el("span", {}, "·"), el("span", {}, c.ends[1]));
  const lean = el("div", { class: "kn-lean voice m-only" });
  box.append(dial, name, val, ends, lean);
  knobs[c.id] = { c, box, dial, kx, val, lean };
  let drag = null;
  dial.addEventListener("keydown", () => box.classList.remove("touched"));
  dial.addEventListener("pointerdown", (e) => { box.classList.toggle("touched", e.pointerType === "touch"); try { dial.setPointerCapture(e.pointerId); } catch {} dial.focus({ preventScroll: true, focusVisible: false }); drag = { y: e.clientY, v: mval(c) }; box.classList.add("turning"); });
  dial.addEventListener("pointermove", (e) => { if (!drag) return; const fine = e.shiftKey ? 0.2 : 1; set(c, drag.v + ((drag.y - e.clientY) / 220) * fine); });
  const end = () => { drag = null; box.classList.remove("turning"); };
  dial.addEventListener("pointerup", end); dial.addEventListener("pointercancel", end);
  dial.addEventListener("dblclick", () => { softUntil = performance.now() + 700; set(c, c.def); pulse(box); });
  dial.addEventListener("wheel", (e) => { e.preventDefault(); set(c, mval(c) - e.deltaY / 1200); }, { passive: false });
  dial.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 0.005 : 0.03, v = mval(c);
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { set(c, v + step); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { set(c, v - step); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === "Home") { set(c, 0); e.preventDefault(); } else if (e.key === "End") { set(c, 1); e.preventDefault(); }
    else if (e.key === "Backspace" || e.key === "Delete") { softUntil = performance.now() + 700; set(c, c.def); pulse(box); e.preventDefault(); }
  });
  const enter = () => { hover = c; lightKnob(c); hoodFor(c); draw(); };
  const leave = () => { if (focusCtl !== c) { hover = null; lightKnob(null); draw(); } };
  box.addEventListener("pointerenter", enter); box.addEventListener("pointerleave", leave);
  dial.addEventListener("focus", () => { focusCtl = c; enter(); }); dial.addEventListener("blur", () => { focusCtl = null; hover = null; lightKnob(null); draw(); });
  return box;
}
function set(c, v) {
  v = Math.max(0, Math.min(1, v));
  if (Math.abs(mval(c) - v) < 1e-4) return;
  MS()[c.id] = v; lastCtl = c;
  A.audio.apply(effective()); syncKnob(c); A.emit("fx", { id: c.id, v });
}
function syncKnob(c) {
  const k = knobs[c.id]; if (!k) return; const v = mval(c);
  k.dial.setAttribute("aria-valuenow", String(Math.round(v * 100)));
  k.dial.setAttribute("aria-valuetext", `${c.val(v)}, toward ${v >= c.def ? c.ends[1] : c.ends[0]}`);
  k.val.textContent = c.val(v);
  k.box.classList.toggle("moved", Math.abs(v - c.def) > 0.01);
  const lean = leanOf(c);
  k.lean.textContent = !A.model.fitted() ? "no lean yet" : Math.abs(lean) < 0.12 ? "no lean" : `it leans ${lean > 0 ? c.ends[1] : c.ends[0]}`;
  drawKnob(k, v, lean);
}
function drawKnob(k, v, lean) {
  const x = k.kx, s = 80, cx = 40, cy = 40, r = 30, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  x.clearRect(0, 0, s, s);
  x.lineCap = "round";
  x.beginPath(); x.arc(cx, cy, r, a0, a1); x.strokeStyle = "#262b33"; x.lineWidth = 3; x.stroke();
  const def = k.c.def, av = a0 + (a1 - a0) * v, ad = a0 + (a1 - a0) * def;
  x.beginPath(); x.arc(cx, cy, r, Math.min(ad, av), Math.max(ad, av));
  x.strokeStyle = "#8ef0b1"; x.lineWidth = 3; x.shadowColor = "rgba(142,240,177,.6)"; x.shadowBlur = 8; x.stroke(); x.shadowBlur = 0;
  // the model's lean, in amber, under the lens
  if (A.state.lens && A.model.fitted() && Math.abs(lean) > 0.12) {
    const al = a0 + (a1 - a0) * Math.max(0, Math.min(1, def + lean * 0.45));
    x.beginPath(); x.arc(cx, cy, r + 5, Math.min(ad, al), Math.max(ad, al)); x.strokeStyle = "rgba(255,180,84,.9)"; x.lineWidth = 2; x.setLineDash([2, 3]); x.stroke(); x.setLineDash([]);
    x.beginPath(); x.arc(cx + Math.cos(al) * (r + 5), cy + Math.sin(al) * (r + 5), 2.4, 0, 7); x.fillStyle = "#ffb454"; x.fill();
  }
  const g = x.createRadialGradient(cx - 6, cy - 8, 2, cx, cy, 23); g.addColorStop(0, "#2f353e"); g.addColorStop(1, "#15181c");
  x.beginPath(); x.arc(cx, cy, 22, 0, 7); x.fillStyle = g; x.fill(); x.strokeStyle = "#0a0b0d"; x.lineWidth = 1; x.stroke();
  x.beginPath(); x.moveTo(cx + Math.cos(av) * 8, cy + Math.sin(av) * 8); x.lineTo(cx + Math.cos(av) * 18, cy + Math.sin(av) * 18); x.strokeStyle = "#e2ddd1"; x.lineWidth = 2.2; x.stroke();
  // default tick
  x.beginPath(); x.moveTo(cx + Math.cos(ad) * (r - 4), cy + Math.sin(ad) * (r - 4)); x.lineTo(cx + Math.cos(ad) * (r + 3), cy + Math.sin(ad) * (r + 3)); x.strokeStyle = "#6f6c63"; x.lineWidth = 1.2; x.stroke();
}
const syncKnobs = () => panelMacros().forEach(syncKnob);
const pulse = (box) => box.animate?.([{ boxShadow: "inset 0 0 0 1px rgba(142,240,177,.55)" }, { boxShadow: "inset 0 0 0 1px rgba(142,240,177,0)" }], { duration: 420, easing: "ease-out" });
function lightKnob(c) { for (const k of Object.values(knobs)) k.box.classList.toggle("lit", !!c && k.c === c); }

// The hood: which of this patch's own modules the control moves (links to PATCH).
function hoodFor(c) {
  const h = root.querySelector("#pf-hood"); h.replaceChildren();
  if (!c) return;
  const mods = A.modulesOf(A.inHand().tree);
  const hit = mods.filter((m) => c.kinds.includes(m.kind));
  const row = el("div", { class: "hood-row" }, el("span", { class: "cap" }, c.name), el("span", { class: "hood-arrow", "aria-hidden": "true" }, "→"));
  const groups = [];
  for (const m of hit) { const key = m.label + "|" + m.params[c.param]; const g = groups.find((g) => g.key === key); if (g) g.n++; else groups.push({ key, m, n: 1 }); }
  if (groups.length) for (const { m, n } of groups.slice(0, 3)) row.append(el("button", { class: "hood-mod", title: "Open in PATCH", onclick: () => { A.patchFocus = m.i; A.show("patch"); } }, m.label, n > 1 ? el("span", { class: "hood-n" }, ` ×${n}`) : "", m.params[c.param] != null ? el("span", { class: "mono" }, ` ${c.param} ${fmt(m.params[c.param])}`) : ""));
  else row.append(el("span", { class: "hood-none" }, "adds a stage this patch doesn't have"));
  h.append(row);
  if (phone.matches) {
    // over the well, at the end the control doesn't shape (BODY works low: the hood sits high)
    const wr = well.getBoundingClientRect(), op = (h.offsetParent || root).getBoundingClientRect();
    const high = ["body", "snap", "space"].includes(c.base ? c.id : c.main);
    h.style.top = high ? `${wr.top - op.top + 8}px` : ""; h.style.bottom = high ? "auto" : "";
    h.classList.toggle("at-top", high);
    clearTimeout(hoodFor.t);
    hoodFor.t = setTimeout(() => { if (!h.matches(":hover, :focus-within")) h.replaceChildren(); }, 2800);
  }
}
const fmt = (v) => (typeof v === "number" ? (Math.abs(v) < 10 ? v.toFixed(2) : Math.round(v)) : String(v));

// ---- a played note lights its pitch on the vessel: its fundamental and first harmonics,
// as bands at their own heights (the vessel's axis is frequency), for the note's life
const litNotes = new Map(); // key -> { semis, t0, off }
const NOTE_REL = 520, LOG_B = Math.log(A.D.bands_hz[1] / A.D.bands_hz[0]);
A.on("note", ({ key, semis, on }) => {
  const now = performance.now();
  if (on) litNotes.set(key, { semis, t0: now, off: null }); else { const n = litNotes.get(key); if (n) n.off = now; }
  loop();
});
function noteBands(x, b, dev) {
  const now = performance.now(), root0 = A.D.held.root_hz;
  for (const [k, n] of litNotes) {
    const lv = A.reduced ? (n.off == null ? 1 : 0) : n.off == null ? 0.78 + 0.22 * Math.exp(-(now - n.t0) / 220) : Math.max(0, 1 - (now - n.off) / NOTE_REL) ** 2;
    if (lv <= 0.001) { litNotes.delete(k); continue; }
    for (let h = 1; h <= 5; h++) {
      const f = root0 * Math.pow(2, n.semis / 12) * h, i = Math.log(f / A.D.bands_hz[0]) / LOG_B;
      if (i < 0 || i > NB - 1) continue;
      const a = Math.floor(i), c2 = Math.min(NB - 1, a + 1), t = i - a, v = dev[a] * (1 - t) + dev[c2] * t;
      const hw = (b.w / 2) * A.sig(v * 1.4), y = b.y + b.h - (i / (NB - 1)) * b.h, cx = b.x + b.w / 2, al = lv / h;
      const g = x.createLinearGradient(cx - hw, 0, cx + hw, 0);
      g.addColorStop(0, `rgba(226,255,236,${0.85 * al})`); g.addColorStop(0.5, `rgba(142,240,177,${0.35 * al})`); g.addColorStop(1, `rgba(226,255,236,${0.85 * al})`);
      x.fillStyle = g; x.shadowColor = "rgba(142,240,177,.9)"; x.shadowBlur = 10 * al; x.fillRect(cx - hw, y - (h === 1 ? 1.5 : 0.75), hw * 2, h === 1 ? 3 : 1.5); x.shadowBlur = 0;
    }
  }
}
// ---- the shape the controls make. BRIGHT and BODY are exact (the filters' response).
// GRIT and SNAP are estimated: drive adds harmonics above ~700 Hz and roughens the edge;
// snap swells or softens the phrase's first moments (its earliest layers). The live line,
// while it plays, is the measured truth.
function shapeOf(p) {
  const fx = A.fxOf(p.id), dev = A.audio.devFor(p).slice();
  if (fx.grit > 0.01) for (let i = 0; i < NB; i++) {
    const f = A.D.bands_hz[i]; if (f < 700) continue;
    const up = Math.min(1, Math.log2(f / 700) / 3);
    dev[i] += fx.grit * (1.1 * up + (f > 1500 ? 0.3 * (i % 2 ? 1 : -1) : 0));
  }
  return dev;
}
function layersOf(p) {
  const s = A.fxOf(p.id).snap; if (Math.abs(s - 0.5) < 0.01) return p;
  const k = 1 + (s - 0.5) * 1.1;
  return Object.assign(Object.create(p), { sloud: p.sloud.map((l, t) => (t < 2 ? Math.max(0, Math.min(1, l * k)) : l)) });
}
function settleDev(p) {
  const target = shapeOf(p);
  if (devId !== p.id && devShown && !A.reduced && !snapNext) { devId = p.id; softUntil = performance.now() + 600; }
  if (devId !== p.id || !devShown || A.reduced) { devShown = target.slice(); devVel = target.map(() => 0); devId = p.id; snapNext = false; return devShown; }
  snapNext = false;
  let moving = false;
  // after a pause the spring starts from one step, never catching up on idle time
  const now = performance.now(), gap = now - springT, steps = gap > 100 ? 1 : Math.min(4, Math.round(gap / 16.7)); springT = now;
  if (steps < 1) { unsettled = true; return devShown; }
  for (let n = 0; n < steps; n++) for (let i = 0; i < NB; i++) {
    // a turn follows closely; a reset springs back, slower, with a little overshoot you can see
    const soft = performance.now() < softUntil, gain = soft ? 0.09 : 0.3, damp = soft ? 0.8 : 0.6;
    devVel[i] = devVel[i] * damp + (target[i] - devShown[i]) * gain; devShown[i] += devVel[i];
    if (n === steps - 1 && (Math.abs(target[i] - devShown[i]) > 0.004 || Math.abs(devVel[i]) > 0.004)) moving = true;
  }
  if (moving) unsettled = true; else devShown = target.slice();
  return devShown;
}
// ---- the offer: the model grows a variant into B, drawn as a guess
// ---- the offer's moments, each one object moving: grown out of the sound in
// hand, peeked, taken into the centre (amber warming to green), or passed back
let anim = null;
const AMBER = [255, 180, 84], GREEN = [142, 240, 177];
const lerpBox = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k });
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function offerBox(b) {
  const z = zones(true), s = Math.min(0.62, (z.right * 0.8) / b.w), ocx = W - z.right / 2;
  return { x: ocx - (b.w * s) / 2, y: b.y + b.h * (1 - s), w: b.w * s, h: b.h * s };
}
const seed = (b) => ({ x: b.x + b.w * 0.4, y: b.y + b.h * 0.55, w: b.w * 0.2, h: b.h * 0.2 });
function play(type, D, extra = {}) {
  if (A.reduced) { extra.done?.(); draw(); return; }
  anim = { type, t0: performance.now(), D: D * (A.slow || 1), ...extra }; loop();
}
// An offer is a short walk from the sound in hand (the engine's MH chain, 20 steps). It
// teaches the model only once you have heard it: a second of Peek. Taken, it counts as the
// offer over what you had; passed, as what you had over the offer. Unheard, neither counts.
let heard = false, heardAt = 0, heardT = 0;
function grow() {
  if (anim) return;
  heard = false; clearTimeout(heardT);
  const a = A.inHand(), prev = offer;
  const cands = A.presets.filter((p) => p.id !== a.id && !A.state.cut.has(p.id) && p.z && (!prev || p.id !== prev.id));
  const d = (p) => p.z.reduce((s, z, i) => s + (z - a.z[i]) ** 2, 0);
  cands.sort((x, y) => d(x) - A.model.like(x) * 6 - (d(y) - A.model.like(y) * 6));
  const pool = cands.slice(0, 5);
  const heroFrom = shown ? { ...shown } : geom(!!prev);
  offer = pool[Math.floor(Math.random() * pool.length)];
  syncPads();
  play(prev ? "swap" : "in", 620, { heroFrom, prev, prevBox: prev ? offerBox(heroFrom) : null });
  A.audio.buffer(offer);
  const btn = root.querySelector("#pf-offer"); btn.animate?.([{ boxShadow: "0 0 0 0 rgba(255,180,84,.6)" }, { boxShadow: "0 0 0 14px rgba(255,180,84,0)" }], { duration: 600 });
}
function peek(on) {
  if (!offer || anim) return;
  peeking = on;
  if (on) { A.audio.play(offer); heardAt = performance.now(); clearTimeout(heardT); heardT = setTimeout(() => { heard = true; }, 1000); }
  else { A.audio.stopPhrase(); clearTimeout(heardT); if (performance.now() - heardAt >= 1000) heard = true; }
  const pk = root.querySelector("#pf-peek"); pk.classList.toggle("held", on); pk.setAttribute("aria-pressed", String(on));
  loop(); draw();
}
function take() {
  if (!offer || anim) return;
  if (peeking) { peeking = false; A.audio.stopPhrase(); }
  const was = A.inHand(), got = offer;
  const heroFrom = shown ? { ...shown } : geom(true), offFrom = offerBox(heroFrom), to = geom(false);
  const D = 820 * (A.slow || 1);
  if (!A.reduced) { flyHome(was, heroFrom, D); fadeHead(D); }
  const commit = () => {
    anim = null; offer = null; shown = { ...to }; snapNext = true;
    const counted = heard;
    if (counted) { A.model.learn(got, was); A.teach(1); }
    A.setInHand(got.id, { play: true }); A.bankFlash(was.id);
    const h = root.querySelector(".pf-head"); h.getAnimations().forEach((a) => a.cancel());
    if (!A.reduced) h.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" });
    A.toast({ face: got, text: counted ? `Took ${got.name}: a pick for it over ${was.name}.` : `Took ${got.name}. Not a pick: you hadn't heard it first.`, undo: () => { A.setInHand(was.id); if (counted) { A.state.taught--; A.emit("taught", A.state.taught); } } });
  };
  play("take", 820, { heroFrom, offFrom, to, was, got, done: commit });
}
function pass() {
  if (!offer || anim) return;
  if (peeking) { peeking = false; A.audio.stopPhrase(); }
  const kept = A.inHand(), gone = offer, heroFrom = shown ? { ...shown } : geom(true);
  const commit = () => {
    anim = null; offer = null; syncPads();
    if (heard) { A.model.learn(kept, gone); A.teach(1); }
    A.toast({ face: gone, text: heard ? `Passed on ${gone.name}: a pick for ${kept.name} over it.` : `Skipped ${gone.name}. Not a pick: you hadn't heard it.` });
    draw();
  };
  play("pass", 480, { heroFrom, offFrom: offerBox(heroFrom), gone, done: commit });
}
// The sound you let go of goes home: a copy of its face leaves the well and lands on its own
// row in the bank (on a phone, on the bank button), where the row lights.
function flyHome(p, box, D) {
  const r = well.getBoundingClientRect(), from = { left: r.left + box.x, top: r.top + box.y, w: box.w, h: box.h };
  const list = document.querySelector(".bank-list"), lr = list?.getBoundingClientRect();
  let row = document.querySelector(`.bank-list .row[data-id="${p.id}"] canvas`), to = row?.getBoundingClientRect();
  const seen = to && lr && to.width > 0 && to.bottom > lr.top + 4 && to.top < lr.bottom - 4 && lr.width > 0 && getComputedStyle(document.querySelector(".bank")).visibility !== "hidden";
  if (!seen || phone.matches) {
    const btn = document.querySelector(".narrow-bank"), br = btn?.getBoundingClientRect();
    if (phone.matches && br && br.width) to = { left: br.left + br.width / 2 - 10, top: br.top + br.height / 2 - 10, width: 20, height: 20 };
    else if (lr && lr.width) to = { left: lr.left + 20, top: Math.min(Math.max(lr.top + 8, from.top + from.h / 2), lr.bottom - 30), width: 26, height: 26 };
    else to = { left: r.left - 30, top: from.top + from.h * 0.5, width: 20, height: 20 };
  }
  const [c, x] = A.canvas(box.w, box.h);
  A.face(x, box.h, p, { box: { x: 0, y: 0, w: box.w, h: box.h }, dev: A.audio.devFor(p), glow: 18, lw: 2 });
  Object.assign(c.style, { position: "fixed", left: from.left + "px", top: from.top + "px", zIndex: 30, pointerEvents: "none", transformOrigin: "0 0" });
  document.body.append(c);
  const sc = Math.max(0.05, to.height / box.h), tx = to.left + to.width / 2 - (from.left + (box.w * sc) / 2), ty = to.top - from.top;
  const mid = phone.matches
    // out to the left margin first, then up it: it never crosses the title
    ? { transform: `translate(${-from.left + 6}px, ${ty * 0.1}px) scale(${Math.max(sc, 0.22)})`, opacity: 1, offset: 0.45 }
    : { transform: `translate(${tx * 0.35}px, ${ty * 0.35 - 10}px) scale(${1 - (1 - sc) * 0.45})`, opacity: 1, offset: 0.4 };
  c.animate([
    { transform: "translate(0,0) scale(1)", opacity: 1 }, mid,
    { transform: `translate(${tx}px, ${ty}px) scale(${sc})`, opacity: 0.85 },
  ], { duration: D, easing: "cubic-bezier(.55,0,.2,1)" }).onfinish = () => {
    c.remove();
    // on a phone the bank is a closed sheet: its button takes the sound in
    if (phone.matches) document.querySelector(".narrow-bank")?.animate?.([{ boxShadow: "0 0 0 0 rgba(142,240,177,.6)", color: "#8ef0b1" }, { boxShadow: "0 0 0 10px rgba(142,240,177,0)" }], { duration: 480 });
  };
}
function fadeHead(D) {
  const h = root.querySelector(".pf-head");
  const early = phone.matches;
  h.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-4px)" }], { duration: D * (early ? 0.25 : 0.35), delay: D * (early ? 0.08 : 0.2), easing: "ease-in", fill: "forwards" });
}
function syncPads() {
  const on = !!offer;
  for (const id of ["pf-peek", "pf-take", "pf-pass"]) { const b = root.querySelector("#" + id); b.disabled = !on; }
  const o = root.querySelector("#pf-offer");
  o.innerHTML = on ? `${icon("again")}Another<kbd>N</kbd>` : `${icon("evolve")}Offer<kbd>N</kbd>`;
}

// ---- how it works (level 3): the response, on the vessel's own axis
let howSheet = null;
function drawHowSheet() {
  if (!howSheet) return;
  const { x, w, h } = howSheet, p = A.inHand(), fx = A.fxOf(p.id), dev = A.audio.devFor(p), resp = A.audio.responseDb(fx);
  x.clearRect(0, 0, w, h);
  const vb = { x: 64, y: 10, w: (h - 34) * 0.6, h: h - 34 };
  A.face(x, vb.h, p, { box: vb, dev, glow: 12, lw: 1.6 });
  x.font = "400 12px 'IBM Plex Mono', monospace"; x.textAlign = "right"; x.fillStyle = "rgba(161,156,144,.9)";
  for (const hz of [100, 1000, 10000]) { const i = A.bandOfHz(hz), y = vb.y + vb.h - (i / (NB - 1)) * vb.h; x.fillRect(52, y, 6, 1); x.fillText(fmtHz(hz), 48, y + 4); }
  const rx = vb.x + vb.w + 24, rw = w - rx - 12, zx = rx + rw / 2;
  x.strokeStyle = "#262b33"; x.lineWidth = 1; x.strokeRect(rx, vb.y, rw, vb.h); x.fillStyle = "rgba(111,108,99,.6)"; x.fillRect(zx, vb.y, 1, vb.h);
  x.beginPath(); resp.forEach((db, i) => { const y = vb.y + vb.h - (i / (NB - 1)) * vb.h, xx = zx + Math.max(-1, Math.min(1, db / 24)) * rw * 0.5; i ? x.lineTo(xx, y) : x.moveTo(xx, y); });
  x.strokeStyle = "#8ef0b1"; x.lineWidth = 2; x.shadowColor = "rgba(142,240,177,.6)"; x.shadowBlur = 8; x.stroke(); x.shadowBlur = 0;
  x.textAlign = "center"; x.fillStyle = "rgba(161,156,144,.9)"; x.fillText("−24   0   +24 dB", zx, vb.y + vb.h + 18);
}
function openHowSheet(on) {
  if (!on) { if (howSheet) { const s0 = howSheet.el; howSheet = null; if (A.reduced) s0.remove(); else s0.animate([{ transform: "none" }, { transform: "translateY(105%)" }], { duration: 200 }).onfinish = () => s0.remove(); } return; }
  if (howSheet) return;
  const w = Math.min(innerWidth, 520), h = 190, [c, x] = A.canvas(w - 28, h);
  const sheet = el("section", { class: "pf-howsheet", role: "dialog", "aria-label": "How BRIGHT and BODY work" },
    el("div", { class: "pf-howsheet-top" }, el("span", { class: "cap" }, "Bright + Body"), el("button", { class: "own-x", "aria-label": "Close", onclick: () => setHow(false), html: A.icon("x") })),
    c, el("p", { class: "pf-howsheet-p" }, "Both are filters: the shape moves by exactly this."));
  document.body.append(sheet);
  howSheet = { el: sheet, x, w: w - 28, h };
  drawHowSheet();
}
A.on("fx", () => drawHowSheet()); A.on("inhand", () => drawHowSheet());
A.on("view", (v) => { if (v !== "perform" && howSheet) setHow(false); });
// How it works: the answer for the control you last touched (BRIGHT if none yet),
// with the other five a tap away; on a wide screen BRIGHT and BODY also draw their
// filter curve on the vessel's own frequency axis
let lastCtl = null;
function setHow(on) {
  const wide = !(phone.matches || shortScreen());
  if (on && A.ask) {
    const c = focusCtl || lastCtl || panelMacros()[0];
    A.ask(root.querySelector(`.kn[data-c="${c.id}"]`));
    how = wide && (c.id === "bright" || c.id === "body");
  } else { how = false; if (A.askOpen?.()) A.askClose(); }
  if (howSheet) openHowSheet(false);
  root.querySelector("#pf-how")?.setAttribute("aria-expanded", String(on));
  root.querySelector(".pf-howbtn")?.setAttribute("aria-pressed", String(on));
  draw();
}
A.on("ask", (a) => { if (a?.kind !== "knob" || !root) return; const wide = !(phone.matches || shortScreen()); how = wide && (a.c === "bright" || a.c === "body"); root.querySelector("#pf-how")?.setAttribute("aria-expanded", "true"); draw(); });
A.on("askclose", () => { if (!root) return; how = false; root.querySelector("#pf-how")?.setAttribute("aria-expanded", "false"); root.querySelector(".pf-howbtn")?.setAttribute("aria-pressed", "false"); draw(); });

// ---- the well
function resize() {
  W = Math.max(80, well.clientWidth); H = Math.max(80, well.clientHeight);
  const d = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(W * d); cv.height = Math.round(H * d); cv.style.width = W + "px"; cv.style.height = H + "px";
  ctx.setTransform(d, 0, 0, d, 0, 0); shown = null; draw();
}
// Three zones: the figure (left, when asked), the sound (centre), the offer (right).
const howW = () => Math.min(196, Math.round(W * 0.4));
const cardW = () => { if (phone.matches) return 0; const c = well && well.querySelector(".own-card"); return c ? c.offsetWidth + 24 : 0; };
const zones = (withOffer = !!offer) => { const left = Math.max(how ? howW() : 0, cardW()), right = withOffer ? Math.max(Math.min(170, W * 0.42), W * 0.3) : 0; return { left, right }; };
function geom(withOffer = !!offer) {
  const z = zones(withOffer), room = W - z.left - z.right;
  let h = Math.min(H * 0.8, room * 1.2); if (withOffer || how) h = Math.min(h, H * 0.72);
  const w = h * 0.6, cx = z.left + room / 2;
  return { x: cx - w / 2, y: (H - h) / 2 - H * 0.03, w, h };
}
function onWellHover(x, y) {
  const b = geom();
  if (y < b.y || y > b.y + b.h) { hover = null; lightKnob(focusCtl); root.querySelector(".pf-read").textContent = ""; draw(); return; }
  const i = Math.round((1 - (y - b.y) / b.h) * (NB - 1));
  const p = A.inHand(), dev = A.audio.devFor(p);
  const diff = dev[i] * A.D.sd_db;
  root.querySelector(".pf-read").textContent = `${fmtHz(A.D.bands_hz[i])}  ${diff >= 0 ? "+" : "−"}${Math.abs(diff).toFixed(0)} dB against the bank`;
  const c = DIMS.find((c) => c.hi && i >= c.hi[0] && i <= c.hi[1] && (c.id === "bright" || c.id === "body"));
  hover = { band: i, c };
  lightKnob(c || null); draw();
}
function loop() {
  if (raf || !visible) return;
  const tick = () => {
    raf = 0; draw();
    const fx = A.fxOf(A.state.inHand);
    // one frame booked at a time: draw() may already have booked the next one
    if (!raf && visible && (anim || unsettled || litNotes.size || A.audio.playingId != null || A.audio.notes.size || (fx.motion > 0.01 && !A.reduced) || lastLive || (peeking ? peekT < 1 : peekT > 0))) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
function draw() {
  if (!ctx || !W) return;
  const p = A.inHand(), fx = A.fxOf(p.id), t = performance.now() / 1000;
  const x = ctx; x.clearRect(0, 0, W, H);
  // where things are right now: at rest, or partway through a moment
  let k = 1;
  if (anim) {
    k = clamp01((performance.now() - anim.t0) / anim.D);
    if (k >= 1) {
      const a = anim; anim = null;
      // the moment's last place is where rest begins: no jump back to where it started
      if (a.type === "in" || a.type === "swap") shown = geom(true); else if (a.type === "pass") shown = geom(false);
      if (a.done) { a.done(); return; }
    }
  }
  const e = ease(k), M = anim;
  unsettled = false;
  let b = geom();
  if (!M) {
    if (!shown || A.reduced) shown = { ...b };
    else { const n = lerpBox(shown, b, 0.2); if (Math.abs(n.x - b.x) + Math.abs(n.y - b.y) + Math.abs(n.h - b.h) > 0.6) { shown = n; unsettled = true; } else shown = { ...b }; }
    b = { ...shown };
  }
  let heroAlpha = 1, ob = offer ? offerBox(b) : null, offRgb = 0, offAlpha = 1, haloAlpha = 0.45, labelAlpha = 1;
  if (M && (M.type === "in" || M.type === "swap")) {
    b = lerpBox(M.heroFrom, geom(true), e); ob = lerpBox(seed(b), offerBox(geom(true)), e); offAlpha = clamp01(k * 1.6); labelAlpha = clamp01((k - 0.6) / 0.4);
  } else if (M && M.type === "take") {
    // the sound you held leaves the well as its own object (flyHome); here it is gone
    b = M.heroFrom; heroAlpha = A.reduced ? 1 - e : 0;
    ob = lerpBox(M.offFrom, M.to, e); offRgb = clamp01((k - 0.2) / 0.6); haloAlpha = 0.45 * (1 - clamp01(k * 3)); labelAlpha = 1 - clamp01(k * 4);
  } else if (M && M.type === "pass") {
    b = lerpBox(M.heroFrom, geom(false), e); ob = lerpBox(M.offFrom, seed(b), e); offAlpha = 1 - e; labelAlpha = 1 - clamp01(k * 4);
  }
  const dev = settleDev(p), P = layersOf(p);
  const focus = hover?.c || focusCtl || hover?.band != null && null;
  // the floor and the reflection: they belong to whichever sound is the one in the centre
  const main = M && M.type === "take" && ob ? ob : b, mainP = M && M.type === "take" ? M.got : p, mainDev = M && M.type === "take" ? A.audio.devFor(M.got) : dev;
  const floorY = main.y + main.h + 2;
  const fl = x.createLinearGradient(0, 0, W, 0); fl.addColorStop(0, "rgba(142,240,177,0)"); fl.addColorStop(0.5, "rgba(142,240,177,.22)"); fl.addColorStop(1, "rgba(142,240,177,0)");
  x.fillStyle = fl; x.fillRect(W * 0.08, floorY, W * 0.84, 1);
  if (!A.morphing) { x.save(); x.translate(0, 2 * floorY); x.scale(1, -1); x.globalAlpha = 0.1 * (M && M.type === "take" ? e : 1);
  A.face(x, main.h, mainP, { box: main, dev: mainDev, layers: false, glow: 0, rgb: M && M.type === "take" ? (e > 0.5 ? GREEN : AMBER).join(",") : undefined }); x.restore(); }
  const mask = x.createLinearGradient(0, floorY, 0, floorY + main.h * 0.35); mask.addColorStop(0, "rgba(7,8,10,0)"); mask.addColorStop(1, "rgba(7,8,10,1)");
  x.fillStyle = mask; x.fillRect(0, floorY + 1, W, main.h * 0.35); x.fillStyle = "#07080a"; x.fillRect(0, floorY + main.h * 0.35, W, H);
  // motion: the layers sway at the control's own rate
  const sway = fx.motion > 0.01 && !A.reduced ? Math.sin(t * Math.PI * 2 * (0.25 + fx.motion * 5) * 0.35) * fx.motion * 0.06 : 0;
  x.save();
  if (sway) { x.translate(b.x + b.w / 2, b.y + b.h); x.transform(1, 0, sway, 1, 0, 0); x.translate(-(b.x + b.w / 2), -(b.y + b.h)); }
  // live: what you hear now, against the bank
  let live = A.audio.playingId === p.id || A.audio.notes.size ? A.audio.liveDev() : null;
  if (live && lastLive) live = live.map((v, i) => lastLive[i] * 0.55 + v * 0.45);
  lastLive = live;
  if (!A.morphing && heroAlpha > 0.01) A.face(x, b.h, P, {
    box: b, dev, glow: 22, lw: 2,
    hi: M ? null : focus?.hi || (hover?.band != null ? [Math.max(0, hover.band - 1), Math.min(NB - 1, hover.band + 1)] : null),
    dim: (peeking ? 0.45 : 1) * heroAlpha, live: peeking ? null : live,
  });
  if (!A.morphing && heroAlpha > 0.01 && litNotes.size) noteBands(x, b, dev);
  x.restore();
  // peeking: the offer's shape rises in place over the sound you hold, so you see what would change here
  peekT = A.reduced ? (peeking ? 1 : 0) : Math.max(0, Math.min(1, peekT + (peeking ? 0.12 : -0.16)));
  if (offer && !M && peekT > 0.001) {
    const q = ease(peekT), od = offer.dev, mid = dev.map((v, i) => v + (od[i] - v) * q);
    x.save(); x.setLineDash([5, 5]); A.vesselPath(x, A.smooth(mid, 1), 1, b);
    x.strokeStyle = `rgba(255,180,84,${0.85 * q})`; x.lineWidth = 1.8; x.shadowColor = "rgba(255,180,84,.6)"; x.shadowBlur = 12 * q; x.stroke(); x.restore();
  }
  // SPACE: a haze outside the vessel as the room grows
  if (fx.space > 0.01) {
    for (let i = 1; i <= 3; i++) { A.vesselPath(x, A.smooth(dev, 2), 1 + fx.space * 0.18 * i, b); x.strokeStyle = `rgba(142,240,177,${0.1 * fx.space / i})`; x.lineWidth = 6 * i; x.stroke(); }
  }
  // the offer, B: the model's guess, amber, hollow
  // the old offer, when another replaces it, folds back into the sound it grew from
  if (M && M.type === "swap" && M.prev) {
    const back = lerpBox(M.prevBox, seed(b), e);
    A.face(x, back.h, M.prev, { box: back, rgb: AMBER.join(","), glow: 8, lw: 1.4, dim: 1 - e });
  }
  const O = M && M.type === "take" ? M.got : M && M.type === "pass" ? M.gone : offer;
  if (O && ob) {
    const peek = peeking && !M, pLive = peek && A.audio.playingId === O.id ? A.audio.liveDev() : null;
    // a guess is drawn as a guess: a dashed halo until it is yours
    if (haloAlpha > 0.01 && offAlpha > 0.01) {
      x.save(); x.setLineDash([4, 6]); A.vesselPath(x, A.smooth(O.dev, 2), 1.14, ob);
      x.strokeStyle = `rgba(255,180,84,${haloAlpha * offAlpha})`; x.lineWidth = 1.2; x.stroke(); x.restore();
    }
    // taking it: the model's amber gives way to sound's green; two phosphors, never a third colour
    const warm = typeof offRgb === "number" ? offRgb : 0;
    // what it grew from: the parent's outline, faint, inside the offer, so what changed shows
    if (!M && offer && O === offer) { x.save(); x.setLineDash([2, 4]); A.vesselPath(x, A.smooth(A.audio.devFor(p), 2), 1, ob); x.strokeStyle = "rgba(142,240,177,.38)"; x.lineWidth = 1; x.stroke(); x.restore(); }
    if (warm <= 0) A.face(x, ob.h, O, { box: ob, rgb: AMBER.join(","), glow: peek ? 22 : 14, lw: 1.8, dim: offAlpha * (peek || M ? 1 : 0.9), live: pLive });
    else {
      const Od = A.audio.devFor(O);
      // taking it: green rises from the base, amber above; the line between glows
      const lvl = ob.y + ob.h * (1 - warm);
      x.save(); x.beginPath(); x.rect(0, lvl, W, H); x.clip(); A.face(x, ob.h, O, { box: ob, dev: Od, rgb: GREEN.join(","), glow: 22, lw: 2, dim: offAlpha }); x.restore();
      if (warm < 1) {
        x.save(); x.beginPath(); x.rect(0, 0, W, lvl); x.clip(); A.face(x, ob.h, O, { box: ob, dev: Od, rgb: AMBER.join(","), glow: 14, lw: 1.8, dim: offAlpha }); x.restore();
        const g = x.createLinearGradient(ob.x - 20, 0, ob.x + ob.w + 20, 0); g.addColorStop(0, "rgba(226,255,236,0)"); g.addColorStop(0.5, "rgba(226,255,236,.85)"); g.addColorStop(1, "rgba(226,255,236,0)");
        x.fillStyle = g; x.fillRect(ob.x - 20, lvl - 0.75, ob.w + 40, 1.5);
      }
    }
    if (labelAlpha > 0.01) {
      x.globalAlpha = labelAlpha;
      // captions stay inside the well, however long the name
      const inside = (t) => { const w = x.measureText(t).width; return Math.max(w / 2 + 10, Math.min(W - w / 2 - 10, ob.x + ob.w / 2)); };
      x.font = "600 11px Jost, sans-serif"; x.fillStyle = "#ffb454"; x.textAlign = "center";
      const nm = ("B · " + O.name).toUpperCase().split("").join(String.fromCharCode(8202));
      x.fillText(nm, inside(nm), ob.y - 14);
      x.font = "400 12px 'IBM Plex Mono', monospace"; x.fillStyle = "rgba(255,180,84,.75)";
      const cap = peek ? (W < 480 ? "peeking" : "peeking · let go to return") : touchy() ? "hold Peek" : W < 480 ? "hold B to peek" : "offered · hold B to peek";
      x.fillText(cap, inside(cap), ob.y + ob.h + 22);
      x.globalAlpha = 1;
    }
  }
  // how it works: frequency on the vessel's own axis, and the filters' real response
  if (how || focus) {
    const ax = how ? Math.round(howW() * 0.36) : b.x - 26;
    x.font = "400 12px 'IBM Plex Mono', monospace"; x.textAlign = "right"; x.fillStyle = "rgba(161,156,144,.9)";
    for (const hz of [50, 100, 300, 1000, 3000, 10000]) {
      const i = A.bandOfHz(hz), y = b.y + b.h - (i / (NB - 1)) * b.h;
      x.fillRect(ax + 6, y, 6, 1); x.fillText(fmtHz(hz), ax, y + 4);
    }
  }
  if (how) {
    const resp = A.audio.responseDb(fx), rx = Math.round(howW() * 0.46), rw = Math.round(howW() * 0.47);
    x.strokeStyle = "rgba(38,43,51,1)"; x.lineWidth = 1; x.strokeRect(rx, b.y, rw, b.h);
    const zx = rx + rw * 0.5; x.fillStyle = "rgba(111,108,99,.6)"; x.fillRect(zx, b.y, 1, b.h);
    x.beginPath();
    resp.forEach((db, i) => { const y = b.y + b.h - (i / (NB - 1)) * b.h, xx = zx + Math.max(-1, Math.min(1, db / 24)) * rw * 0.5; i ? x.lineTo(xx, y) : x.moveTo(xx, y); });
    x.strokeStyle = "#8ef0b1"; x.lineWidth = 2; x.shadowColor = "rgba(142,240,177,.6)"; x.shadowBlur = 8; x.stroke(); x.shadowBlur = 0;
    x.font = "400 12px 'IBM Plex Mono', monospace"; x.fillStyle = "rgba(161,156,144,.9)"; x.textAlign = "center";
    x.fillText("−24  0  +24 dB", rx + rw / 2, b.y + b.h + 20);
    x.font = "600 11px Jost, sans-serif"; x.fillStyle = "rgba(226,221,209,.95)";
    x.fillText("BRIGHT + BODY", rx + rw / 2, b.y - 12);
  }
  cv.setAttribute("aria-label", `${p.name}: its shape, low frequencies at the base, high at the top`);
  root.querySelector(".pf-pads").classList.toggle("busy", !!M);
  lastDrawn = { anim: M ? M.type : null, k, top: dev[33], hero: heroAlpha > 0.01 ? { ...b } : null, offer: O && ob ? { ...ob } : null, main: { ...main } };
  if (unsettled || (peeking ? peekT < 1 : peekT > 0)) loop();
}

A.views.perform = {
  mount,
  // the well's place in the page as laid out, not as a zoom in flight has scaled it
  anchor() {
    if (!W) return null;
    const st = document.querySelector(".stage"), sr = st.getBoundingClientRect(); let x = 0, y = 0, e = well;
    while (e && e !== st) { x += e.offsetLeft - (e.scrollLeft || 0); y += e.offsetTop - (e.scrollTop || 0); e = e.offsetParent; }
    const b = shown || geom();
    return { x: sr.left + x + b.x, y: sr.top + y + b.y, w: b.w, h: b.h };
  },
  debug: () => lastDrawn,
  show() { visible = true; root.style.display = ""; resize(); syncKnobs(); loop(); },
  hide() { visible = false; root.style.display = "none"; if (peeking) peek(false); },
  key(e) {
    const k = e.key;
    if (k === "n" || k === "N") { if (!e.repeat) grow(); return true; }
    if ((k === "b" || k === "B") && offer) { if (!e.repeat) { peek(true); const up = (u) => { if (u.key.toLowerCase() === "b") { peek(false); document.removeEventListener("keyup", up); } }; document.addEventListener("keyup", up); } return true; }
    if (k === "Enter" && e.shiftKey && offer) { take(); return true; }
    if (k === "?") { setHow(!how); return true; }
    return false;
  },
};

// view-scoped styles
const css = `
.pf { position:absolute; inset:0; display:grid; grid-template-columns:minmax(0,1.35fr) minmax(300px,1fr); gap:var(--s5); padding:var(--s5) var(--s5) 72px; }
.pf-left { display:grid; grid-template-rows:auto 1fr; gap:var(--s4); min-height:0; }
.pf-eyebrow { display:flex; gap:8px; margin-bottom:10px; }
.pf-head .display { margin-bottom:8px; display:inline-block; vertical-align:middle; }
.pf-well { min-height:0; cursor:pointer; }
.pf-well canvas { position:absolute; inset:0; }
.pf-read { position:absolute; left:50%; top:14px; transform:translateX(-50%); font-size:12px; color:var(--silk-dim); pointer-events:none; white-space:nowrap; }
.pf-right { display:flex; flex-direction:column; justify-content:center; gap:var(--s5); min-height:0; padding-bottom:8px; }
.pf-ctlhead { display:flex; justify-content:space-between; align-items:center; }
.pf-knobs { display:grid; grid-template-columns:repeat(var(--cols, 3), minmax(0, 1fr)); gap:10px 6px; }
.pf-ctlacts { display:flex; gap:14px; align-items:center; }
.kn-add { display:none; }
.pp { position:fixed; z-index:70; display:none; flex-direction:column; background:var(--panel); border:1px solid var(--hair-hi); border-radius:var(--r3); box-shadow:0 30px 70px -30px rgba(0,0,0,.9); padding:14px 14px 10px; }
.pp.on { display:flex; animation:ppin var(--d-move) var(--e-settle); }
@keyframes ppin { from { opacity:0; transform:translateY(8px); } }
.pp.sheet { left:0; right:0; bottom:var(--nav-h, 0px); top:auto; max-height:74vh; border-radius:18px 18px 0 0; border-bottom:0; }
.pp-grab { display:none; }
.pp.sheet .pp-grab { display:block; flex:none; width:40px; height:4px; border-radius:2px; background:var(--hair-hi); margin:0 auto 8px; touch-action:none; }
.pp-head { flex:none; display:flex; justify-content:space-between; align-items:flex-start; gap:10px; touch-action:none; }
.pp-sub { margin:4px 0 0; color:var(--silk-mute); font-size:12px; }
.pp-x { flex:none; width:40px; height:40px; border-radius:50%; display:grid; place-items:center; color:var(--silk-dim); }
.pp-x svg { width:18px; height:18px; }
.pp-body { overflow-y:auto; min-height:0; margin-top:10px; display:grid; gap:14px; align-content:start; overscroll-behavior:contain; }
.pp-sec { display:grid; gap:4px; }
.pp-h { padding:2px; color:var(--silk-mute); }
.pp-row { display:grid; grid-template-columns:44px minmax(0,1fr) auto auto auto; align-items:center; gap:10px; padding:4px 6px; border-radius:10px; }
.pp-row:not(.on) { grid-template-columns:44px minmax(0,1fr) auto; }
.pp-row.on { background:rgba(142,240,177,.04); }
.pp-row:not(.on):hover { background:var(--panel-hi); }
.pp-txt { display:grid; gap:3px; min-width:0; }
.pp-name { font:600 12px/1 var(--f-silk); letter-spacing:.16em; text-transform:uppercase; }
.pp-ends { font-size:12px; color:var(--silk-dim); }
.pp-b { width:36px; height:36px; border-radius:8px; border:1px solid var(--hair); display:grid; place-items:center; color:var(--silk-dim); font:400 16px/1 var(--f-mono); }
.pp-b:hover:not([disabled]) { color:var(--silk); border-color:var(--hair-hi); }
.pp-b[disabled] { opacity:.3; cursor:default; }
.pp-b svg { width:14px; height:14px; }
.pp-add { color:var(--green); border-color:var(--green-deep); }
.pp-rm:hover:not([disabled]) { color:var(--red) !important; border-color:rgba(255,87,71,.45) !important; }
@media (pointer: coarse) { .pp-b { width:44px; height:44px; } }
.kn { display:grid; justify-items:center; gap:2px; padding:12px 6px 10px; border-radius:var(--r2); border:1px solid transparent; transition:background var(--d-state), border-color var(--d-state); }
.kn:hover, .kn.lit, .kn:focus-within { background:var(--panel); border-color:var(--hair); }
.kn-dial { border-radius:50%; cursor:ns-resize; touch-action:none; }
.kn-dial:focus-visible { outline-offset:0; }
.kn-name { font:600 var(--t-label)/1 var(--f-silk); letter-spacing:.2em; text-transform:uppercase; margin-top:4px; }
.kn-val { font-size:12px; color:var(--silk-mute); min-height:15px; transition:color var(--d-state); }
.kn.moved .kn-val { color:var(--green); }
.kn-ends { display:flex; gap:6px; font-size:12px; color:var(--silk-mute); opacity:0; transform:translateY(-3px); transition:opacity var(--d-state), transform var(--d-state) var(--e-settle); }
.kn:hover .kn-ends, .kn.lit .kn-ends, .kn:focus-within .kn-ends, .kn.turning .kn-ends { opacity:1; transform:none; }
.kn-lean { font-size:14px; min-height:18px; }
body:not(.lens) .kn-lean { display:none; }
.pf-hood { min-height:44px; }
.hood-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:8px 10px; border-radius:var(--r2); background:var(--panel); border:1px solid var(--hair); animation:nextin var(--d-state) var(--e-settle); }
.hood-arrow { color:var(--silk-mute); }
.hood-mod { font:600 10px/1 var(--f-silk); letter-spacing:.14em; padding:6px 8px; border-radius:var(--r1); border:1px solid var(--hair-hi); color:var(--silk); }
.hood-mod .mono { letter-spacing:0; color:var(--green-dim); font-weight:400; }
.hood-mod:hover { border-color:var(--green-dim); }
.hood-none { color:var(--silk-dim); font-size:13px; }
.pf-pads { display:grid; grid-template-columns:1.3fr 1fr 1fr auto; gap:8px; }
.pf-pads .btn { height:52px; }
@media (max-width: 980px) { .pf { grid-template-columns:1fr; overflow-y:auto; } .pf-left { grid-template-rows:auto 360px; } }
/* the phone: the whole loop (play, turn, offer, peek, take) in one screen, the sound
   largest. Six knobs in one row, their values shown as a bubble while you turn; the pads
   sit lowest, in thumb reach. */
@media (max-width: 700px) {
  .pf { display:flex; flex-direction:column; gap:8px; padding:10px 14px 10px; overflow-y:auto; }
  .stage:has(.guide .next) .pf { padding-bottom:52px; }
  .pf-left { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; gap:6px; }
  .pf-head { flex:none; display:grid; grid-template-columns:minmax(0,1fr) auto; grid-template-areas:"eye eye" "name share" "blurb blurb"; column-gap:8px; align-items:center; }
  .pf-eyebrow { grid-area:eye; margin-bottom:2px; }
  .pf-head .display { grid-area:name; font-size:28px; line-height:1.05; margin:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
  .pf-head .blurb { grid-area:blurb; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
  .pf-well { flex:1 1 auto; min-height:170px; height:auto; }
  .pf-right { flex:none; position:relative; gap:6px; padding:0; justify-content:flex-start; }
  .pf-ctlhead { height:18px; }
  .pf-ctlhead .cap, .pf-ctlhead .disclose { font-size:10px; }
  .pf-knobs { grid-template-columns:var(--pcols, repeat(6, minmax(0, 1fr))); gap:0 2px; }
  .kn-add { display:grid; place-items:center; align-self:start; height:46px; margin-top:2px; border-radius:10px; border:1px dashed var(--hair-hi); color:var(--silk-dim); font:300 20px/1 var(--f-silk); }
  .kn-add:active { background:var(--panel-hi); }
  .kn { position:relative; padding:2px 0 4px; gap:0; }
  .kn-dial canvas { width:46px !important; height:46px !important; display:block; }
  .kn-name { font-size:11px; margin-top:1px; letter-spacing:.06em; }
  .kn.moved .kn-name { color:var(--green); }
  .kn-val { position:absolute; bottom:calc(100% - 2px); left:50%; transform:translate(-50%, 4px); white-space:nowrap; z-index:5; pointer-events:none;
    background:var(--panel-hi); border:1px solid var(--hair-hi); border-radius:999px; padding:3px 9px; opacity:0; transition:opacity var(--d-state), transform var(--d-state) var(--e-settle); }
  .kn.turning .kn-val, .kn.lit .kn-val { opacity:1; transform:translate(-50%, 0); }
  .kn:first-child .kn-val { left:0; transform:translate(0, 4px); } .kn:first-child.turning .kn-val, .kn:first-child.lit .kn-val { transform:none; }
  .kn:last-child .kn-val { left:auto; right:0; transform:translate(0, 4px); } .kn:last-child.turning .kn-val, .kn:last-child.lit .kn-val { transform:none; }
  .kn-ends, .kn-lean { display:none; }
  .pf-hood { position:absolute; left:0; right:0; bottom:calc(100% + 30px); min-height:0; z-index:3; }
  .pf-hood.at-top { left:8px; right:8px; }
  .hood-row { padding:6px 8px; background:rgba(19,22,26,.94); backdrop-filter:blur(4px); }
  .pf-pads { grid-template-columns:1.3fr 1fr 1fr .8fr; gap:6px; }
  .pf-pads .btn { height:48px; padding-inline:6px; letter-spacing:.12em; gap:6px; }
  .pf-pads .btn kbd { display:none; }
  .pf-pads .pf-pass { grid-column:auto; }
  /* the keys drawer is open: the knobs fold away, the pads lift above it */
  body.keys-open .pf-knobs, body.keys-open .pf-ctlhead, body.keys-open .pf-hood { display:none; }
  body.keys-open .pf { padding-bottom:140px; }
}
@media (max-width: 700px) and (max-height: 700px) { .pf-head .blurb { display:none; } .pf-ctlhead { display:none; } }
/* a phone on its side: the sound on the left, the hands on the right, nothing to scroll */
@media (max-height: 500px) and (orientation: landscape) {
  .pf { display:grid; grid-template-columns:minmax(0,1.15fr) minmax(0,1fr); grid-template-rows:minmax(0,1fr); gap:12px; padding:8px 12px; overflow:hidden; }
  .stage:has(.guide .next) .pf { padding-bottom:8px; }
  .pf-left { display:flex; flex-direction:column; min-height:0; gap:0; }
  .pf-head { display:none; }
  .pf-well { flex:1 1 auto; min-height:0; height:auto; }
  .pf-right { display:flex; flex-direction:column; justify-content:center; gap:6px; padding:0; position:relative; min-height:0; }
  .pf-ctlhead { display:none; }
  .pf-knobs { grid-template-columns:repeat(var(--cols, 3), minmax(0, 1fr)); gap:0 4px; }
  .kn-add { display:none; }
  .kn { position:relative; padding:2px 0 3px; gap:0; }
  .kn-dial canvas { width:40px !important; height:40px !important; display:block; }
  .kn-name { font-size:11px; letter-spacing:.08em; margin-top:0; }
  .kn-val { font-size:11px; min-height:13px; }
  .kn-ends, .kn-lean { display:none; }
  .pf-hood { position:absolute; left:0; right:0; top:-4px; min-height:0; z-index:3; }
  .pf-pads { grid-template-columns:1.3fr 1fr 1fr .8fr; gap:6px; }
  .pf-pads .btn { height:40px; padding-inline:6px; letter-spacing:.1em; }
  .pf-pads .btn kbd { display:none; }
  .pf-howbtn { display:grid; }
  body.keys-open .pf-knobs { display:none; }
}
@media (pointer: coarse) { .pf-pads .btn kbd { display:none; } }
.pf-howbtn { display:none; position:absolute; left:10px; top:10px; z-index:2; width:32px; height:32px; border-radius:50%; place-items:center; color:var(--silk-dim); background:rgba(19,22,26,.8); border:1px solid var(--hair); }
.pf-howbtn svg { width:16px; height:16px; }
.pf-howbtn[aria-pressed="true"] { color:var(--green); border-color:var(--green-deep); }
@media (max-width: 700px) and (max-height: 700px) { .pf-howbtn { display:grid; } }
.pf-pads.busy .btn { opacity:.5; pointer-events:none; transition:opacity var(--d-state); }
.hood-n { color:var(--silk-dim); letter-spacing:0; }
.kn-dial:focus-visible { border-radius:50%; outline-offset:3px; }
.kn.touched .kn-dial:focus-visible { outline:none; }
/* phone: a turned knob shows its value where its name was, so nothing floats over
   the controls; the hood is a light line on a fade, drawn away from the band being shaped */
@media (max-width: 700px) {
  .kn-val, .kn:first-child .kn-val, .kn:last-child .kn-val { position:static; transform:none !important; background:none; border:0; padding:0; opacity:1; display:none; font-size:11px; line-height:1.35; color:var(--green); margin-top:1px; min-height:0; white-space:nowrap; }
  .kn.turning .kn-val, .kn.lit .kn-val { display:block; }
  .kn.turning .kn-name, .kn.lit .kn-name { display:none; }
  .hood-row { background:linear-gradient(rgba(7,8,10,0), rgba(7,8,10,.82) 40%); border:0; border-radius:0 0 12px 12px; padding:14px 10px 6px; }
  .pf-hood.at-top .hood-row { background:linear-gradient(rgba(7,8,10,.82) 60%, rgba(7,8,10,0)); border-radius:12px 12px 0 0; padding:6px 10px 14px; }
  .hood-row .cap { font-size:10px; }
  .hood-mod { padding:5px 7px; font-size:10px; }
}
.pf-howsheet { position:fixed; left:0; right:0; bottom:var(--nav-h, 62px); z-index:54; padding:10px 14px 14px; background:var(--panel); border:1px solid var(--hair-hi); border-bottom:0; border-radius:16px 16px 0 0; box-shadow:0 -20px 40px -20px rgba(0,0,0,.9); animation:ownsheet var(--d-move) var(--e-settle); max-width:520px; margin:0 auto; }
.pf-howsheet::before { content:""; display:block; width:36px; height:4px; border-radius:2px; background:var(--hair-hi); margin:0 auto 6px; }
.pf-howsheet-top { display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; }
.pf-howsheet canvas { display:block; }
.pf-howsheet-p { margin:4px 0 0; color:var(--silk-dim); font-size:13px; }
@keyframes ownsheet { from { transform:translateY(100%); } to { transform:none; } }
.pf-peek.held { background:var(--plate); border-color:var(--amber-dim); color:var(--amber); box-shadow:0 0 18px -6px var(--amber-glow); }
`;
document.head.append(el("style", {}, css));
})();
