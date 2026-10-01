// TASTE: the map of taste, drawn with faces. Every sound sits where its
// measured features put it; the model's liking is an amber halo behind it,
// hollow while it is still a guess. A pick is drawn as what it teaches: a
// direction, from the sound passed to the sound kept, and every halo on the map
// moves at once (the model is linear in the features, so one pick moves them all).
(() => {
"use strict";
const { el, icon } = A;
const DPR = Math.min(2, window.devicePixelRatio || 1);

let root, well, cv, ctx, plate, readout, legend, subtitle, foot, keysHint, tog;
let W = 0, H = 0, S0 = 26, S1 = 47, visible = false, raf = 0;
let tasteMode = false;
let pos = new Map();                 // id -> {x, y} (relaxed, on screen)
let active = null, activeKbd = false, grow = new Map(); // id -> current size
let likeNow = new Map(), likeShown = new Map(), seenLike = new Map();
let ripples = [];
let spriteCache = new Map();
let clearTimer = 0;
let ringFrom = null;                 // the ring's last place, while it glides to the new sound in hand
let lastHand = null;                 // which sound the ring was on
let arrivals = [];                   // picks made since this view last looked: {win, lose}
let coarse = matchMedia("(pointer: coarse)").matches; // touch: tap to audition, the plate docks
// taste over time: a snapshot of the model at every change, from session start
const snaps = [];                    // {w, n, t, pool, src: the sound the change came from}
const gens = [];                     // {at: snapshot index, count, t, kids: [{id, from}]}
let lastPoolSet = new Set();
// picks, drawn as directions: {a (passed), b (kept), t0, back (undone while scrubbing)}
let strokes = [], pendingPick = null;
const STROKE_MS = 1500;
let buds = [];                       // {id, from, t0, dur, back}
let scrub = null;                    // null = now; else a snapshot index
let lastPool = 0, replayT = 0;
let time, track, tcv, tctx, tlabel, tplay;
const timeOn = () => snaps.length >= 2;

const shown = () => A.presets.filter((p) => !A.state.cut.has(p.id));
const fittedNow = () => (scrub != null ? snaps[scrub].n >= 6 : A.model.fitted());
const halosOn = () => fittedNow() || A.state.lens || tasteMode || scrub != null;
const fxKey = (p) => { const f = A.state.fx[p.id]; return f ? Object.values(f).map((v) => v.toFixed(2)).join(",") : ""; };

// liking as the model saw it then: the same sum A.model.like makes, with that snapshot's weights
function likeFrom(w) {
  const sc = (p) => p.z.reduce((t, z, i) => t + z * w[i], 0);
  const mean = A.presets.reduce((t, p) => t + sc(p), 0) / A.presets.length;
  return (p) => A.sig(sc(p) - mean);
}
function computeLikes() {
  const f = scrub != null ? likeFrom(snaps[scrub].w) : (p) => A.model.like(p);
  likeNow = new Map(A.presets.map((p) => [p.id, f(p)]));
}

// ---- sprites: each face drawn once at a size, then placed
function sprite(p, size) {
  const key = `${p.id}:${size}:${fxKey(p)}`;
  let s = spriteCache.get(key);
  if (s) return s;
  const m = Math.ceil(size * 0.5), full = size + 2 * m;
  const c = document.createElement("canvas"); c.width = Math.ceil(full * DPR); c.height = Math.ceil(full * DPR);
  const x = c.getContext("2d"); x.scale(DPR, DPR);
  A.face(x, size, p, { box: { x: m, y: m, w: size, h: size }, dev: A.audio.devFor(p), glow: Math.max(5, size * 0.32), lw: size > 40 ? 1.5 : 1 });
  s = { c, full }; spriteCache.set(key, s);
  return s;
}

// ---- layout: the features' plane, relaxed just enough that faces don't sit on each other
// Each axis is blended halfway toward its ranks, so the crowded middle opens up
// while neighbours stay neighbours (a monotone stretch, not a new map).
let spread = null;
function spreadXY() {
  const list = A.presets, n = list.length;
  const rank = (k) => { const o = [...list].sort((a, b) => a.xy[k] - b.xy[k]); const r = new Map(); o.forEach((p, i) => r.set(p.id, i / (n - 1))); return r; };
  const rx = rank(0), ry = rank(1);
  spread = new Map(list.map((p) => [p.id, [0.45 * p.xy[0] + 0.55 * rx.get(p.id), 0.45 * p.xy[1] + 0.55 * ry.get(p.id)]]));
}
function layout() {
  if (!spread) spreadXY();
  const small = W < 520, low = H < 320, mx = small ? Math.max(22, W * 0.06) : Math.max(48, W * 0.07);
  const myTop = low ? 46 : small ? 58 : 64, myBot = timeOn() ? (low ? 52 : small ? 78 : 96) : (low ? 16 : small ? 28 : 40);
  const iw = W - 2 * mx, ih = H - myTop - myBot;
  const arr = shown().map((p) => {
    const [sx, sy] = spread.get(p.id), ax = mx + sx * iw, ay = myTop + (1 - sy) * ih;
    const prev = pos.get(p.id);
    return { p, ax, ay, x: ax, y: ay, px: prev?.x, py: prev?.y };
  });
  const minD = S0 * 1.05;
  for (let it = 0; it < 90; it++) {
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j]; let dx = b.x - a.x, dy = b.y - a.y; let d = Math.hypot(dx, dy);
      if (d >= minD) continue;
      if (d < 1e-3) { dx = Math.cos(i + j); dy = Math.sin(i + j); d = 1; }
      const push = (minD - d) / 2, ux = dx / d, uy = dy / d;
      a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
    }
    for (const a of arr) {
      a.x += (a.ax - a.x) * 0.06; a.y += (a.ay - a.y) * 0.06;
      a.x = Math.max(mx * 0.5, Math.min(W - mx * 0.5, a.x)); a.y = Math.max(myTop * 0.6, Math.min(H - myBot * 0.6, a.y));
    }
  }
  pos = new Map(arr.map((a) => [a.p.id, { x: a.x, y: a.y }]));
}

function resize() {
  // layout size, not the on-screen box: when this runs the view may be mid-zoom
  // (scaled), and a map laid out for the scaled box spills past the well's edges
  W = Math.max(200, well.clientWidth); H = Math.max(200, well.clientHeight);
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); cv.style.width = W + "px"; cv.style.height = H + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // faces sized to the room they share: legible on a phone, never crowding on a desktop
  const s = Math.round(Math.max(20, Math.min(32, Math.sqrt((W * H) / Math.max(1, shown().length)) * 0.5)));
  if (s !== S0) { S0 = s; S1 = Math.round(s * 1.8); spriteCache.clear(); }
  layout(); draw(); placePlate(); syncText();
}

// ---- drawing
function drawGrid(x) {
  const step = 44;
  x.fillStyle = "rgba(226,221,209,.07)";
  for (let gx = step / 2; gx < W; gx += step) for (let gy = step / 2; gy < H; gy += step) x.fillRect(gx, gy, 1, 1);
  // two faint axes through the centre: the plane's own origin
  x.fillStyle = "rgba(226,221,209,.04)";
  x.fillRect(W * 0.07, H / 2, W * 0.86, 1); x.fillRect(W / 2, 48, 1, H - 88);
}
function drawHalo(x, cx, cy, like, fitted) {
  if (!fitted) {
    x.save(); x.setLineDash([3, 4]); x.beginPath(); x.arc(cx, cy, S0 * 0.86, 0, Math.PI * 2);
    x.strokeStyle = "rgba(255,180,84,.42)"; x.lineWidth = 1; x.stroke(); x.restore(); return;
  }
  const k = Math.pow(like, 1.6);
  const r = S0 * (0.5 + 1.45 * k);
  const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `rgba(255,180,84,${0.03 + 0.42 * k})`); g.addColorStop(0.55, `rgba(255,180,84,${0.015 + 0.14 * k})`); g.addColorStop(1, "rgba(255,180,84,0)");
  x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
}
function draw() {
  if (!ctx || !W) return;
  const x = ctx; x.clearRect(0, 0, W, H);
  drawGrid(x);
  const list = shown(), fitted = fittedNow(), halos = halosOn();
  const nowT = performance.now();
  buds = buds.filter((b) => nowT < b.t0 + b.dur);
  const budding = new Set(buds.filter((b) => nowT >= b.t0 - 1 && !b.back).map((b) => b.id));
  const ap = active != null ? pos.get(active) : null;
  // halos first, all of them, so faces sit on the light
  if (halos) for (const p of list) { const q = pos.get(p.id); if (q) drawHalo(x, q.x, q.y, likeShown.get(p.id) ?? 0.5, fitted); }
  // faces
  const tint = tasteMode && fitted;
  for (const p of list) {
    if (p.id === active) continue;
    if (A.morphing && p.id === A.state.inHand) continue;
    if (budding.has(p.id)) continue;
    const q = pos.get(p.id); if (!q) continue;
    const size = grow.get(p.id) || S0;
    let a = tint ? 0.22 + 0.78 * (likeShown.get(p.id) ?? 0.5) : 1;
    if (ap && Math.hypot(q.x - ap.x, q.y - ap.y) < S1 * 2.4) a *= 0.5;
    const sp = sprite(p, size > S0 + 1 ? S1 : S0), k = size / (size > S0 + 1 ? S1 : S0);
    x.globalAlpha = a; x.drawImage(sp.c, q.x - (sp.full * k) / 2, q.y - (sp.full * k) / 2, sp.full * k, sp.full * k); x.globalAlpha = 1;
    if (A.state.saved.has(p.id)) { x.beginPath(); x.arc(q.x + size * 0.46, q.y - size * 0.46, 2.4, 0, Math.PI * 2); x.fillStyle = "#e2ddd1"; x.fill(); }
  }
  // the sound in hand: a green ring, gliding from where your hand was
  let hq = pos.get(A.state.inHand);
  if (hq && ringFrom && !A.reduced) {
    const k = Math.min(1, (nowT - ringFrom.t0) / 420), e = 1 - Math.pow(1 - k, 3);
    if (k < 1) hq = { x: ringFrom.x + (hq.x - ringFrom.x) * e, y: ringFrom.y + (hq.y - ringFrom.y) * e }; else ringFrom = null;
  }
  if (hq) {
    const r = ((grow.get(A.state.inHand) || S0) * 0.5) + 7;
    x.beginPath(); x.arc(hq.x, hq.y, r, 0, Math.PI * 2);
    x.strokeStyle = "#8ef0b1"; x.lineWidth = 1.5; x.shadowColor = "rgba(142,240,177,.7)"; x.shadowBlur = 10; x.stroke(); x.shadowBlur = 0;
  }
  // the one in focus, last, larger
  if (ap) {
    const p = A.byId.get(active), size = grow.get(active) || S1;
    const sp = sprite(p, S1), k = size / S1;
    x.drawImage(sp.c, ap.x - (sp.full * k) / 2, ap.y - (sp.full * k) / 2, sp.full * k, sp.full * k);
    if (A.state.saved.has(p.id)) { x.beginPath(); x.arc(ap.x + size * 0.46, ap.y - size * 0.46, 2.6, 0, Math.PI * 2); x.fillStyle = "#e2ddd1"; x.fill(); }
    if (activeKbd) { x.beginPath(); x.arc(ap.x, ap.y, size * 0.5 + 12, 0, Math.PI * 2); x.strokeStyle = "rgba(226,221,209,.55)"; x.setLineDash([2, 3]); x.lineWidth = 1; x.stroke(); x.setLineDash([]); }
  }
  // under the lens: the direction liking rises, fitted on this map's own positions
  if (A.state.lens && fitted && !A.morphing) drawArrow(x, list);
  // each pick: the direction it taught, from the one passed to the one kept (reversed when undone)
  for (const st of strokes) {
    const pa = pos.get(st.a), pb = pos.get(st.b); if (!pa || !pb) continue;
    const e = (nowT - st.t0) / (STROKE_MS * (A.slow || 1)); if (e < 0 || e >= 1) continue;
    const [f, t] = st.back ? [pb, pa] : [pa, pb], g = A.reduced ? 1 : easeOut(Math.min(1, e / 0.35)), al = 0.85 * (1 - Math.max(0, (e - 0.6) / 0.4));
    const L = Math.hypot(t.x - f.x, t.y - f.y) || 1, ux = (t.x - f.x) / L, uy = (t.y - f.y) / L, hx = f.x + (t.x - f.x) * g, hy = f.y + (t.y - f.y) * g;
    x.save(); x.strokeStyle = x.fillStyle = `rgba(255,180,84,${al})`; x.lineWidth = 1.6; x.shadowColor = "rgba(255,180,84,.5)"; x.shadowBlur = 6;
    x.beginPath(); x.moveTo(f.x, f.y); x.lineTo(hx, hy); x.stroke();
    x.beginPath(); x.moveTo(hx, hy); x.lineTo(hx - ux * 10 - uy * 5.5, hy - uy * 10 + ux * 5.5); x.lineTo(hx - ux * 10 + uy * 5.5, hy - uy * 10 - ux * 5.5); x.closePath(); x.fill();
    x.restore();
  }
  // generations: each child buds from its parent (a seed, then a face moving out)
  for (const b of buds) {
    const pa = pos.get(b.from), ch = pos.get(b.id), cp = A.byId.get(b.id); if (!pa || !ch || !cp) continue;
    let t = (nowT - b.t0) / b.dur; if (t < 0) continue; t = Math.min(1, t); if (b.back) t = 1 - t;
    if (t < 0.22) { const k = t / 0.22; x.beginPath(); x.arc(pa.x, pa.y, 1 + 3.5 * k, 0, Math.PI * 2); x.fillStyle = "#ffb454"; x.shadowColor = "rgba(255,180,84,.8)"; x.shadowBlur = 8; x.fill(); x.shadowBlur = 0; continue; }
    const k = easeOut((t - 0.22) / 0.78), bx = pa.x + (ch.x - pa.x) * k, by = pa.y + (ch.y - pa.y) * k, size = S0 * (0.15 + 0.85 * k);
    x.strokeStyle = `rgba(142,240,177,${0.35 * (1 - k)})`; x.lineWidth = 1; x.beginPath(); x.moveTo(pa.x, pa.y); x.lineTo(bx, by); x.stroke();
    const sp = sprite(cp, S0), sk = size / S0;
    x.drawImage(sp.c, bx - (sp.full * sk) / 2, by - (sp.full * sk) / 2, sp.full * sk, sp.full * sk);
  }
  // your sounds: a silk four-point star and the word
  for (const p of list) {
    if (p.id < 1000) continue;
    const q = pos.get(p.id); if (!q) continue;
    const size = grow.get(p.id) || S0;
    star(x, q.x + size * 0.52, q.y - size * 0.5, p.id === active ? 7 : 5.5);
    x.font = "400 12px 'IBM Plex Mono', monospace"; x.textAlign = "center"; x.fillStyle = "rgba(226,221,209,.85)";
    x.fillText("yours", q.x, q.y + size * 0.5 + 16);
  }
  // ripples: where it learned
  const now = performance.now();
  for (const r of ripples) {
    const q = pos.get(r.id); if (!q) continue;
    const t = Math.min(1, Math.max(0, (now - r.t0) / r.dur)); if (now < r.t0) continue;
    let rad, alpha;
    if (A.reduced) { rad = S0 * 1.5; alpha = 0.7 * (1 - t); }
    else if (r.up) { rad = S0 * (0.7 + 3.4 * easeOut(t)); alpha = 0.75 * (1 - t); }
    else { rad = S0 * (4.1 - 3.4 * easeOut(t)); alpha = 0.75 * (1 - t) * Math.min(1, t * 4); }
    x.beginPath(); x.arc(q.x, q.y, rad, 0, Math.PI * 2);
    x.strokeStyle = r.green ? `rgba(142,240,177,${alpha})` : `rgba(255,180,84,${alpha})`; x.lineWidth = 1.2;
    if (!r.up) x.setLineDash([4, 4]);
    x.stroke(); x.setLineDash([]);
  }
  ripples = ripples.filter((r) => now < r.t0 + r.dur);
}
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
// Least squares of liking on (x, y) over the faces as placed: the same computation
// as LEARNING's arrow, on this map's own coordinates.
function drawArrow(x, list) {
  let n = 0, sx = 0, sy = 0, sl = 0, sxx = 0, syy = 0, sxy = 0, sxl = 0, syl = 0;
  for (const p of list) { const q = pos.get(p.id), l = likeShown.get(p.id); if (!q || l == null) continue; n++; sx += q.x; sy += q.y; sl += l; sxx += q.x * q.x; syy += q.y * q.y; sxy += q.x * q.y; sxl += q.x * l; syl += q.y * l; }
  if (n < 3) return;
  const cxx = sxx - (sx * sx) / n, cyy = syy - (sy * sy) / n, cxy = sxy - (sx * sy) / n, cxl = sxl - (sx * sl) / n, cyl = syl - (sy * sl) / n;
  const det = cxx * cyy - cxy * cxy; if (Math.abs(det) < 1e-9) return;
  const gx = (cyy * cxl - cxy * cyl) / det, gy = (cxx * cyl - cxy * cxl) / det, m = Math.hypot(gx, gy); if (m < 1e-6) return;
  const ux = gx / m, uy = gy / m, L = Math.min(W, H) * 0.34, cx = sx / n, cy = sy / n;
  x.save(); x.strokeStyle = "rgba(255,180,84,.85)"; x.lineWidth = 2; x.shadowColor = "rgba(255,180,84,.6)"; x.shadowBlur = 10;
  x.beginPath(); x.moveTo(cx - ux * L * 0.5, cy - uy * L * 0.5); x.lineTo(cx + ux * L * 0.5, cy + uy * L * 0.5); x.stroke();
  const hx = cx + ux * L * 0.5, hy = cy + uy * L * 0.5;
  x.beginPath(); x.moveTo(hx, hy); x.lineTo(hx - ux * 12 - uy * 6.5, hy - uy * 12 + ux * 6.5); x.lineTo(hx - ux * 12 + uy * 6.5, hy - uy * 12 - ux * 6.5); x.closePath(); x.fillStyle = "rgba(255,180,84,.9)"; x.fill();
  x.restore();
}
function star(x, cx, cy, r) {
  x.beginPath();
  for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 4, rr = i % 2 ? r * 0.3 : r; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
  x.closePath(); x.fillStyle = "#e2ddd1"; x.shadowColor = "rgba(226,221,209,.6)"; x.shadowBlur = 6; x.fill(); x.shadowBlur = 0;
}

// ---- animation: sizes ease, halos ease toward what it now believes, ripples run once
function kick() {
  if (raf || !visible) return;
  const tick = () => {
    raf = 0;
    let busy = false;
    for (const p of shown()) {
      const target = p.id === active ? S1 : S0, cur = grow.get(p.id) || S0;
      if (Math.abs(cur - target) > 0.3) { grow.set(p.id, A.reduced ? target : cur + (target - cur) * 0.28); busy = true; } else if (cur !== target) grow.set(p.id, target);
      const lt = likeNow.get(p.id) ?? 0.5, ls = likeShown.get(p.id) ?? lt;
      if (Math.abs(ls - lt) > 0.002) { likeShown.set(p.id, A.reduced ? lt : ls + (lt - ls) * 0.1); busy = true; } else likeShown.set(p.id, lt);
    }
    const nowK = performance.now();
    strokes = strokes.filter((st) => nowK < st.t0 + STROKE_MS * (A.slow || 1));
    if (ripples.length || buds.length || strokes.length) busy = true;
    draw();
    if (busy && visible) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

// Once, when the model has moved since this view last looked: the picks it learned from,
// each drawn as its direction in turn, while the halos settle to what it now believes.
function arrive() {
  const t0 = performance.now(), recent = arrivals.slice(-6); arrivals = [];
  recent.forEach((a, i) => strokes.push({ a: a.lose.id, b: a.win.id, t0: t0 + 200 + i * 260 }));
  if (recent.length) kick();
  return 0;
}
function rippleFromChange() { seenLike = new Map(likeNow); }

// ---- focus, hover, the plate
function hit(mx, my, reach) {
  let best = null, bd = Infinity;
  for (const p of shown()) {
    const q = pos.get(p.id); if (!q) continue;
    const r = reach ?? (p.id === active ? S1 : S0) * 0.62, d = Math.hypot(q.x - mx, q.y - my);
    if (d < r && d < bd) { best = p.id; bd = d; }
  }
  return best;
}
function setActive(id, kbd = false) {
  if (id === active && kbd === activeKbd) return;
  active = id; activeKbd = kbd;
  const p = id != null ? A.byId.get(id) : null;
  readout.textContent = p ? `${p.name}, ${p.category}` : "";
  cv.style.cursor = p ? "pointer" : "default";
  renderPlate(); kick();
}
function renderPlate() {
  const p = active != null ? A.byId.get(active) : null;
  if (!p) { plate.classList.remove("on"); plate.setAttribute("aria-hidden", "true"); return; }
  const fitted = fittedNow(), like = likeNow.get(p.id) ?? 0.5;
  const playing = A.audio.playingId === p.id;
  plate.replaceChildren(
    el("div", { class: "ts-pl-top" }, el("span", { class: "cap" }, p.category),
      A.state.inHand === p.id ? el("span", { class: "cap", style: "color:var(--green)" }, "in hand") : "",
      (fitted || A.state.lens || scrub != null) ? el("span", { class: `ts-pl-like mono${fitted ? "" : " guess"}`, title: "Chance it beats an average sound, as the model sees it" }, fitted ? Math.round(like * 100) + "%" : "guess") : ""),
    el("div", { class: "ts-pl-name" }, p.name),
    el("div", { class: "ts-pl-blurb", title: p.blurb }, p.blurb),
    el("div", { class: "ts-pl-acts" },
      el("button", { class: "btn ghost ts-sm", onclick: () => { A.audio.toggle(p); renderPlate(); }, html: `${icon(playing ? "stop" : "play")}${playing ? "Stop" : "Play"}<kbd>Space</kbd>` }),
      el("button", { class: "btn ghost ts-sm", disabled: A.state.inHand === p.id, onclick: () => { A.setInHand(p.id); }, html: `Hold it<kbd>↵</kbd>` })));
  plate.classList.add("on"); plate.setAttribute("aria-hidden", "false");
  placePlate();
}
function placePlate() {
  if (active == null || !plate.classList.contains("on")) return;
  plate.classList.toggle("dock", coarse);
  if (coarse) {
    plate.style.transform = "";
    const q = pos.get(active), ph = plate.offsetHeight || 130, low = timeOn() ? (H < 320 ? 50 : 66) : 10, hi = H < 320 ? 44 : 52, s = S1 * 0.5 + 8;
    // docked along the bottom or the top: whichever leaves the face it describes clear
    const clearBottom = !q || q.y + s < H - low - ph, clearTop = !q || q.y - s > hi + ph;
    const top = !clearBottom && (clearTop || q.y > H / 2);
    plate.style.bottom = top ? "" : low + "px"; plate.style.top = top ? hi + "px" : "";
    return;
  }
  plate.style.top = "";
  plate.style.bottom = "";
  const q = pos.get(active); if (!q) return;
  const pw = plate.offsetWidth || 260, ph = plate.offsetHeight || 120, gap = S1 * 0.5 + 16;
  let px = q.x + gap; if (px + pw > W - 10) px = q.x - gap - pw;
  if (px < 10) px = Math.min(W - pw - 10, Math.max(10, q.x - pw / 2));
  let py = q.y - ph / 2;
  // if it had to sit over the face horizontally, go above or below it instead
  if (px < q.x + S1 * 0.5 && px + pw > q.x - S1 * 0.5) py = q.y - S1 * 0.5 - 14 - ph < 10 ? q.y + S1 * 0.5 + 14 : q.y - S1 * 0.5 - 14 - ph;
  py = Math.max(10, Math.min(H - ph - 10, py));
  plate.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px)`;
}

// arrow keys: the nearest face in that direction
function step(dir) {
  const list = shown();
  let from = active != null ? pos.get(active) : pos.get(A.state.inHand);
  if (!from) { setActive(list[0]?.id ?? null, true); return; }
  if (active == null) { setActive(A.state.inHand, true); return; }
  const v = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[dir];
  let best = null, bs = Infinity;
  for (const p of list) {
    if (p.id === active) continue;
    const q = pos.get(p.id); const dx = q.x - from.x, dy = q.y - from.y, d = Math.hypot(dx, dy); if (d < 1) continue;
    const cos = (dx * v[0] + dy * v[1]) / d; if (cos < 0.45) continue;
    const score = d * (1 + 2.2 * Math.sqrt(1 - cos * cos));
    if (score < bs) { bs = score; best = p.id; }
  }
  if (best != null) setActive(best, true);
}

// ---- mount
function mount(r) {
  root = r;
  const head = el("div", { class: "ts-head" });
  subtitle = el("p", { class: "blurb ts-sub" });
  head.append(
    el("div", { class: "pf-eyebrow" }, el("span", { class: "cap" }, "Taste")),
    el("h1", { class: "display" }, "What it has learned"),
    subtitle);
  well = el("div", { class: "well ts-well" });
  [cv, ctx] = A.canvas(10, 10);
  cv.tabIndex = 0; cv.setAttribute("role", "application");
  cv.setAttribute("aria-roledescription", "map");
  cv.setAttribute("aria-label", "Taste map: every sound, placed by how it sounds. Arrow keys move between sounds, Enter holds one, Space plays it.");
  readout = el("div", { class: "sr", "aria-live": "polite" });
  tog = el("button", { class: "tog ts-tog", "aria-pressed": "false", "aria-label": "Colour by taste", title: "Colour the map by what it thinks you'd like",
    onclick: () => setTaste(!tasteMode) },
    el("span", { class: "led" }), el("span", { class: "ts-seg", "data-seg": "sound" }, "Sound"), el("span", { class: "ts-sep", "aria-hidden": "true" }, "/"), el("span", { class: "ts-seg", "data-seg": "taste" }, "Taste"));
  legend = el("div", { class: "ts-legend", "aria-hidden": "true" });
  plate = el("div", { class: "ts-plate", role: "group", "aria-hidden": "true" });
  // taste over time: a slim track along the bottom, once there is a history
  [tcv, tctx] = A.canvas(10, 10);
  tplay = el("button", { class: "ts-tplay", "aria-label": "Replay how your taste moved", title: "Replay", onclick: () => replay(), html: icon("play") });
  track = el("div", { class: "ts-track", role: "slider", tabindex: "0", "aria-label": "Taste over time", "aria-valuemin": "0" }, tcv);
  tlabel = el("span", { class: "ts-tlabel mono", "aria-hidden": "true" });
  time = el("div", { class: "ts-time", role: "group", "aria-label": "Taste over time" }, tplay, track, tlabel);
  well.append(cv, tog, legend, plate, readout, time);
  foot = el("div", { class: "ts-foot" },
    el("span", { class: "mono ts-note" }),
    keysHint = el("span", { class: "ts-keys" }, el("kbd", {}, "←"), el("kbd", {}, "↑"), el("kbd", {}, "↓"), el("kbd", {}, "→"), " move ", el("kbd", {}, "↵"), " hold ", el("kbd", {}, "Space"), " play"));
  root.append(el("div", { class: "ts" }, head, well, foot));

  cv.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    const b = cv.getBoundingClientRect(); const id = hit(e.clientX - b.left, e.clientY - b.top);
    if (id != null) { clearTimeout(clearTimer); if (id !== active || activeKbd) setActive(id, false); }
    else if (active != null && !activeKbd) { clearTimeout(clearTimer); clearTimer = setTimeout(() => setActive(null), 260); }
  });
  cv.addEventListener("pointerleave", (e) => { if (e.pointerType === "touch") return; if (!activeKbd) { clearTimeout(clearTimer); clearTimer = setTimeout(() => setActive(null), 260); } });
  plate.addEventListener("pointerenter", () => clearTimeout(clearTimer));
  plate.addEventListener("pointerleave", () => { if (!activeKbd) { clearTimeout(clearTimer); clearTimer = setTimeout(() => setActive(null), 200); } });
  let lastPointer = "mouse";
  cv.addEventListener("pointerdown", (e) => { lastPointer = e.pointerType; coarse = e.pointerType === "touch" || e.pointerType === "pen" ? true : matchMedia("(pointer: coarse)").matches && e.pointerType !== "mouse"; });
  cv.addEventListener("click", (e) => {
    const b = cv.getBoundingClientRect(), touch = lastPointer === "touch" || lastPointer === "pen";
    // a finger is wide: on touch the nearest face within 26 px answers
    const id = hit(e.clientX - b.left, e.clientY - b.top, touch ? 26 : undefined);
    if (touch) {
      // tap: hear it and see its card; tap it again (or Hold it) to take it in hand
      if (id == null) { setActive(null); return; }
      if (id === active && A.state.inHand !== id) { A.setInHand(id); return; }
      setActive(id, false); const p = A.byId.get(id); if (A.audio.playingId !== id) A.audio.play(p); renderPlate();
      return;
    }
    if (id != null) A.setInHand(id, { play: true });
  });
  // keyboard focus starts at the sound in hand; a pointer's focus doesn't: its own tap decides
  cv.addEventListener("focus", () => { if (!cv.matches(":focus-visible")) return; keysHint.classList.add("on"); if (active == null) setActive(A.state.inHand, true); });
  cv.addEventListener("blur", () => { keysHint.classList.remove("on"); if (activeKbd) setActive(null); });

  new ResizeObserver(() => { if (visible) resize(); }).observe(well);
  computeLikes(); likeShown = new Map(likeNow); seenLike = new Map(likeNow);
  // the history starts now
  lastPool = A.pool.size; lastPoolSet = new Set(A.pool); snapshot();
  // every pick, wherever it is made (EVOLVE's pair, PERFORM's offers), is one direction taught
  A.on("learned", ({ win, lose }) => { pendingPick = { win, lose }; if (visible && scrub == null) { strokes.push({ a: lose.id, b: win.id, t0: performance.now() }); kick(); } else arrivals.push({ win, lose }); });
  const bd = A.bankDraw;
  if (bd && !bd.tsWrapped) { A.bankDraw = (...a) => { const r = bd(...a); checkPool(); return r; }; A.bankDraw.tsWrapped = true; }
  let pdown = false;
  track.addEventListener("pointerdown", (e) => { pdown = true; track.setPointerCapture(e.pointerId); track.focus({ preventScroll: true }); stopReplay(); setScrub(indexAt(e)); });
  track.addEventListener("pointermove", (e) => { if (pdown) setScrub(indexAt(e)); });
  const pup = () => { pdown = false; }; track.addEventListener("pointerup", pup); track.addEventListener("pointercancel", pup);
  track.addEventListener("keydown", (e) => {
    const last = snaps.length - 1, at = scrub ?? last;
    let to = null;
    if (e.key === "ArrowLeft") to = at - 1; else if (e.key === "ArrowRight") to = at + 1; else if (e.key === "Home") to = 0; else if (e.key === "End") to = last;
    if (to == null) return;
    e.preventDefault(); e.stopPropagation(); stopReplay(); setScrub(to);
  });
  new ResizeObserver(() => drawTime()).observe(track);
  A.on("model", () => { snapshot(); checkPool(); computeLikes(); syncText(); drawTime(); if (visible) { rippleFromChange(); kick(); renderPlate(); } });
  A.on("yours", (p) => { spread = null; computeLikes(); likeShown.set(p.id, likeNow.get(p.id)); seenLike.set(p.id, likeNow.get(p.id)); syncText(); if (visible) { layout(); draw(); } });
  A.on("lens", () => { syncText(); if (visible) { draw(); renderPlate(); } });
  A.on("inhand", () => {
    const from = lastHand != null ? pos.get(lastHand) : null; lastHand = A.state.inHand;
    if (visible && from && !A.morphing) { ringFrom = { x: from.x, y: from.y, t0: performance.now() }; kick(); }
    if (visible) { draw(); renderPlate(); }
  });
  A.on("saved", () => { if (visible) draw(); });
  A.on("cut", () => { if (active != null && A.state.cut.has(active)) setActive(null); if (visible) { layout(); draw(); } syncText(); });
  A.on("fx", () => { if (visible) draw(); });
  A.on("play", () => { if (visible) renderPlate(); }); A.on("stop", () => { if (visible) renderPlate(); });

  A.cmd({ id: "ts-colour", view: "taste", label: "Colour by taste", icon: "taste", run: () => setTaste(!tasteMode) });
  A.cmd({ id: "ts-best", view: "taste", label: "Find the sound it likes most", icon: "lamp", run: () => {
    const best = shown().reduce((a, b) => ((likeNow.get(b.id) ?? 0) > (likeNow.get(a.id) ?? 0) ? b : a));
    cv.focus(); setActive(best.id, true);
  } });
  A.cmd({ id: "ts-replay", view: "taste", label: "Replay how your taste moved", icon: "play", run: () => replay() });
  A.cmd({ id: "ts-hand", view: "taste", label: "Centre on the sound in hand", icon: "map", run: () => {
    cv.focus(); setActive(A.state.inHand, true);
    const q = pos.get(A.state.inHand); if (q) { ripples.push({ id: A.state.inHand, up: true, t0: performance.now(), dur: 900, green: true }); kick(); }
  } });
  syncText();
}

function setTaste(on) {
  tasteMode = on;
  tog.setAttribute("aria-pressed", String(on));
  syncText(); if (visible) { draw(); kick(); }
}
function syncText() {
  const n = A.model.n, left = Math.max(0, 6 - n), fitted = fittedNow();
  subtitle.textContent = scrub != null ? "Looking back."
    : A.model.fitted() ? `From ${n} picks.` : `${left} more pick${left === 1 ? "" : "s"} and it fits your taste.`;
  const nP = shown().filter((p) => p.id < 1000).length, share = Math.round(A.D.map_share * 100);
  foot.querySelector(".ts-note").textContent = W && W < 520 ? `close shapes sound alike · ${share}% of how they differ` : `a flat view of ${nP} presets: close shapes usually sound alike (it shows ${share}% of how they differ)`;
  legend.classList.toggle("on", halosOn());
  legend.innerHTML = fitted
    ? `<svg width="44" height="18" viewBox="0 0 44 18"><circle cx="7" cy="9" r="4" fill="rgba(255,180,84,.18)" stroke="rgba(255,180,84,.5)"/><circle cx="30" cy="9" r="8" fill="rgba(255,180,84,.3)" stroke="rgba(255,180,84,.8)"/></svg><span>it likes more</span>`
    : `<svg width="22" height="18" viewBox="0 0 22 18"><circle cx="11" cy="9" r="7" fill="none" stroke="rgba(255,180,84,.6)" stroke-dasharray="3 3"/></svg><span>still a guess</span>`;
}

// ---- taste over time
const pickWords = (n) => (n === 0 ? "before any picks" : `after ${n} pick${n === 1 ? "" : "s"}`);
function snapshot() { const pk = pendingPick; pendingPick = null; snaps.push({ w: A.model.w.slice(), n: A.model.n, t: performance.now(), pool: A.pool.size, src: pk ? pk.win.id : A.state.inHand, lose: pk ? pk.lose.id : null }); }
// generations: the pool growing; a breed adds its children over a few seconds, so growth close together is one
function checkPool() {
  const size = A.pool.size, now = performance.now();
  if (size > lastPool) {
    const added = [...A.pool].filter((id) => !lastPoolSet.has(id));
    const kids = added.map((id) => ({ id, from: A.budFrom ?? parentOf(id) }));
    let g = gens[gens.length - 1];
    if (g && now - g.t < 3000) { g.count += size - lastPool; g.t = now; g.kids.push(...kids); }
    else {
      // its own moment on the track, after the picks that led to it
      snaps.push({ w: A.model.w.slice(), n: A.model.n, t: now, pool: size, src: kids[0]?.from ?? A.state.inHand, gen: true });
      g = { at: snaps.length - 1, count: size - lastPool, t: now, kids }; gens.push(g);
    }
    if (visible && scrub == null) budFrom(kids, false);
    drawTime();
  }
  lastPool = size; lastPoolSet = new Set(A.pool);
}
// a child's parent: the seed its walk started from, as the lineage records it
function parentOf(id) {
  const rec = A.state.lineage?.[id]; if (rec) return rec.parent;
  const c = A.byId.get(id); let best = null, bd = Infinity;
  for (const pid of lastPoolSet) { const q = A.byId.get(pid); if (!q || !c) continue; const d = q.z.reduce((t, z, i) => t + (z - c.z[i]) ** 2, 0); if (d < bd) { bd = d; best = pid; } }
  return best ?? A.state.inHand;
}
function budFrom(kids, back) {
  if (A.reduced || !kids.length) return;
  const t0 = performance.now();
  kids.forEach((k, i) => { if (k.from != null && k.from !== k.id) buds.push({ id: k.id, from: k.from, t0: t0 + i * 120, dur: 900, back }); });
  kick();
}
const TPAD = 12;
function indexAt(e) {
  const r = track.getBoundingClientRect(), n = snaps.length;
  const k = (e.clientX - r.left - TPAD) / Math.max(1, r.width - 2 * TPAD);
  return Math.round(Math.max(0, Math.min(1, k)) * (n - 1));
}
function setScrub(i) {
  const last = snaps.length - 1;
  i = Math.max(0, Math.min(last, i));
  const next = i >= last ? null : i;
  if (next === scrub) return;
  const from = scrub ?? last, fwd = i > from;
  scrub = next;
  // the step's own pick, as its direction: forward as taught, backward as undone
  const sn = snaps[fwd ? i : from];
  if (sn?.lose != null && sn.src != null) strokes = [{ a: sn.lose, b: sn.src, t0: performance.now(), back: !fwd }];
  for (const g of gens) { if (fwd ? g.at > from && g.at <= i : g.at > i && g.at <= from) budFrom(g.kids, !fwd); }
  computeLikes(); seenLike = new Map(likeNow);
  syncText(); drawTime(); kick(); renderPlate();
}
function replay() {
  if (replayT) { stopReplay(); return; }
  if (snaps.length < 2) return;
  let i = 0; setScrub(0);
  tplay.innerHTML = icon("stop"); tplay.setAttribute("aria-label", "Stop the replay");
  const stepMs = A.reduced ? 260 : Math.max(180, Math.min(520, 4200 / snaps.length));
  replayT = setInterval(() => { i++; setScrub(i); if (i >= snaps.length - 1) stopReplay(); }, stepMs);
}
function stopReplay() {
  if (!replayT) return;
  clearInterval(replayT); replayT = 0;
  tplay.innerHTML = icon("play"); tplay.setAttribute("aria-label", "Replay how your taste moved");
}
function drawTime() {
  if (!time) return;
  const on = timeOn(), was = time.classList.contains("on");
  time.classList.toggle("on", on);
  if (on !== was && visible && W) { layout(); draw(); placePlate(); }
  if (!on) return;
  const w = Math.max(40, track.clientWidth), h = Math.max(20, track.clientHeight), d = Math.min(2, devicePixelRatio || 1);
  if (tcv.width !== Math.round(w * d) || tcv.height !== Math.round(h * d)) { tcv.width = Math.round(w * d); tcv.height = Math.round(h * d); tcv.style.width = w + "px"; tcv.style.height = h + "px"; }
  const x = tctx; x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, w, h);
  const n = snaps.length, last = n - 1, at = scrub ?? last, base = Math.round(h * 0.62);
  const X = (i) => TPAD + (n > 1 ? i / last : 0) * (w - 2 * TPAD);
  x.fillStyle = "rgba(53,60,70,1)"; x.fillRect(TPAD, base, w - 2 * TPAD, 1);
  // where it fitted: a faint mark, the picks before it are guesses
  const fitAt = snaps.findIndex((s) => s.n >= 6);
  if (fitAt > 0) { x.fillStyle = "rgba(255,180,84,.18)"; x.fillRect(X(fitAt) - 0.5, 4, 1, h - 8); }
  // the start, then a tick for every change: amber for a pick, hollow while still a guess, silk for a take-back
  x.beginPath(); x.arc(X(0), base, 2.5, 0, Math.PI * 2); x.fillStyle = "#e2ddd1"; x.fill();
  for (let i = 1; i < n; i++) {
    if (snaps[i].gen) continue; // drawn as its diamond below
    const back = snaps[i].n < snaps[i - 1].n, fit = snaps[i].n >= 6, past = i <= at;
    if (back) { x.fillStyle = `rgba(226,221,209,${past ? 0.7 : 0.3})`; x.fillRect(X(i) - 0.5, base + 2, 1, 6); continue; }
    x.fillStyle = `rgba(255,180,84,${(fit ? 0.95 : 0.5) * (past ? 1 : 0.45)})`;
    x.fillRect(X(i) - (fit ? 1 : 0.5), base - 11, fit ? 2 : 1, 11);
  }
  // generations: green diamonds, with how many joined
  x.font = "400 12px 'IBM Plex Mono', monospace"; x.textAlign = "left"; x.textBaseline = "alphabetic";
  for (const g of gens) {
    const gx = X(Math.min(g.at, last)), past = g.at <= at;
    x.save(); x.translate(gx, base); x.rotate(Math.PI / 4);
    x.fillStyle = past ? "#8ef0b1" : "rgba(142,240,177,.4)"; x.shadowColor = "rgba(142,240,177,.6)"; x.shadowBlur = past ? 6 : 0;
    x.fillRect(-3.5, -3.5, 7, 7); x.restore();
    x.fillStyle = past ? "rgba(142,240,177,.9)" : "rgba(142,240,177,.4)"; x.fillText("+" + g.count, gx + 7, base - 4);
  }
  // the handle: you, looking back (or now, at the right end)
  const hx = X(at);
  x.fillStyle = scrub != null ? "rgba(226,221,209,.9)" : "rgba(226,221,209,.5)"; x.fillRect(hx - 0.5, 3, 1, h - 6);
  x.beginPath(); x.arc(hx, base, 5.5, 0, Math.PI * 2); x.fillStyle = "#e2ddd1"; x.fill();
  x.lineWidth = 2; x.strokeStyle = "#07080a"; x.stroke();
  const label = scrub != null ? pickWords(snaps[at].n) : `now · ${pickWords(A.model.n)}`;
  tlabel.textContent = label;
  track.setAttribute("aria-valuemax", String(last)); track.setAttribute("aria-valuenow", String(at)); track.setAttribute("aria-valuetext", scrub != null ? label : `now, ${pickWords(A.model.n)}`);
}

let pendingArrive = null;
A.on("morphend", () => { if (!visible) return; if (pendingArrive) { const f = pendingArrive; pendingArrive = null; f(); } kick(); });
A.on("morphstart", () => { if (visible) draw(); });
A.views.taste = {
  mount,
  _probe: () => ({ pos: [...pos].map(([id, q]) => ({ id, x: q.x, y: q.y })), S0, S1, W, H, active, snaps: snaps.length, gens: gens.map((g) => g.at) }),
  _focus: (id) => { setActive(id, false); },
  anchor() {
    const q = pos.get(A.state.inHand); if (!q || !cv) return null;
    const s = grow.get(A.state.inHand) || S0, r = cv.getBoundingClientRect();
    return { x: r.left + q.x - s / 2, y: r.top + q.y - s / 2, w: s, h: s };
  },
  show() {
    visible = true; lastHand = A.state.inHand; ringFrom = null; computeLikes(); syncText(); resize(); drawTime();
    // the arrival waits for the zoom to land, so the pulses start where the eye is
    const go = () => { const d = arrive(); rippleFromChange(d); kick(); };
    if (A.morphing) { const once = () => { go(); }; pendingArrive = once; } else go();
    if (A.tasteFocus != null) {
      const id = A.tasteFocus; A.tasteFocus = null;
      if (pos.get(id)) { cv.focus({ preventScroll: true }); setActive(id, true); ripples.push({ id, up: true, t0: performance.now(), dur: 1100, green: true }); kick(); }
    }
  },
  hide() { visible = false; pendingArrive = null; stopReplay(); setActive(null); plate.classList.remove("on"); },
  key(e) {
    if (document.activeElement !== cv) return false;
    if (e.key.startsWith("Arrow")) { step(e.key); return true; }
    if (e.key === "Enter" && active != null) { A.setInHand(active); return true; }
    if (e.key === " " && active != null) { A.audio.toggle(A.byId.get(active)); renderPlate(); return true; }
    return false;
  },
};

const css = `
.ts { position:absolute; inset:0; display:grid; grid-template-rows:auto 1fr auto; gap:var(--s3); padding:var(--s5) var(--s5) 72px; }
.ts-head .display { margin-bottom:6px; }
.ts-sub { min-height:22px; }
.ts-well { min-height:0; }
.ts-well canvas { position:absolute; inset:0; touch-action:manipulation; } /* no double-tap zoom: two taps mean audition, then hold */
.ts-well canvas:focus-visible { outline:none; }
.ts-well:focus-within { border-color:var(--hair-hi); }
.ts-tog { position:absolute; left:14px; top:14px; z-index:2; background:rgba(12,13,16,.72); backdrop-filter:blur(4px); height:30px; }
.ts-tog .ts-seg { transition:color var(--d-state); }
.ts-tog[aria-pressed="false"] [data-seg="taste"], .ts-tog[aria-pressed="true"] [data-seg="sound"] { color:var(--silk-mute); }
.ts-tog[aria-pressed="false"] [data-seg="sound"], .ts-tog[aria-pressed="true"] [data-seg="taste"] { color:var(--silk); }
.ts-tog .ts-sep { color:var(--silk-mute); }
.ts-tog[aria-pressed="true"] .led { background:var(--silk); box-shadow:0 0 8px rgba(226,221,209,.45); }
.ts-legend { position:absolute; right:14px; top:14px; z-index:2; display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:var(--r1);
  font:400 12px/1 var(--f-mono); color:var(--amber-dim); background:rgba(12,13,16,.72); opacity:0; transition:opacity var(--d-state); pointer-events:none; }
.ts-legend.on { opacity:1; }
.ts-plate { position:absolute; left:0; top:0; z-index:3; width:272px; padding:12px 12px 10px 14px; border-radius:var(--r2);
  background:rgba(26,30,35,.94); backdrop-filter:blur(6px); border:1px solid var(--hair-hi); box-shadow:0 18px 40px -18px rgba(0,0,0,.9);
  opacity:0; pointer-events:none; transition:opacity var(--d-state) var(--e-settle); }
.ts-plate.on { opacity:1; pointer-events:auto; }
.ts-pl-top { display:flex; align-items:center; gap:10px; }
.ts-pl-like { margin-left:auto; font-size:12px; color:var(--amber); }
.ts-pl-like.guess { color:var(--amber-dim); border:1px dashed var(--amber-deep); border-radius:3px; padding:1px 5px; }
.ts-pl-name { font:500 var(--t-title)/1.15 var(--f-silk); margin:6px 0 2px; }
.ts-pl-blurb { color:var(--silk-dim); font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ts-pl-acts { display:flex; gap:4px; margin:10px 0 0 -8px; }
.ts-plate .ts-sm { height:30px; padding-inline:8px; font-size:10px; white-space:nowrap; }
.ts-sm svg { width:12px; height:12px; }
.ts-foot { display:flex; justify-content:space-between; align-items:center; gap:var(--s4); min-height:22px; }
.ts-note { font-size:12px; color:var(--silk-dim); }
.ts-keys { display:flex; align-items:center; gap:4px; font-size:12px; color:var(--silk-mute); opacity:0; transition:opacity var(--d-state); white-space:nowrap; }
.ts-keys.on { opacity:1; }
.ts-time { position:absolute; left:14px; right:14px; bottom:12px; height:46px; z-index:2; display:none; align-items:center; gap:10px; padding:0 12px 0 6px;
  border-radius:var(--r2); background:rgba(12,13,16,.8); backdrop-filter:blur(5px); border:1px solid var(--hair); animation:nextin var(--d-move) var(--e-settle); }
.ts-time.on { display:flex; }
.ts-tplay { width:32px; height:32px; flex:none; border-radius:50%; display:grid; place-items:center; color:var(--silk-dim); }
.ts-tplay:hover { color:var(--silk); background:var(--plate); }
.ts-tplay svg { width:14px; height:14px; }
.ts-track { flex:1; min-width:0; height:36px; cursor:pointer; touch-action:none; border-radius:var(--r1); }
.ts-track canvas { display:block; }
.ts-track:focus-visible { outline-offset:0; }
.ts-tlabel { flex:none; font-size:12px; color:var(--silk-dim); min-width:13ch; text-align:right; white-space:nowrap; }
@media (max-width: 980px) { .ts-keys { display:none; } .ts-plate { width:220px; } }
@media (max-width: 640px) { .ts { padding:var(--s4) var(--s4) 72px; } }
.ts-plate.dock { left:10px; right:10px; top:auto; width:auto; transform:none; }
@media (max-width: 700px) {
  .ts { padding:12px 12px 52px; gap:8px; }
  .ts-head { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
  .ts-head .pf-eyebrow { display:none; }
  .ts-head .display { font-size:28px; margin:0; }
  .ts-sub { min-height:0; margin:0; font-size:13px; }
  .ts-time { left:8px; right:8px; bottom:8px; height:44px; } .ts-tlabel { min-width:0; font-size:12px; }
  .ts-note { font:400 12px/1.3 var(--f-silk); }
  .ts-tog, .ts-legend { top:10px; } .ts-tog { left:10px; } .ts-legend { right:10px; }
  .ts-plate .ts-pl-acts .btn { height:40px; }
}
`;
// a short screen (a phone on its side): the header folds to a line, the map takes the height
const SHORT = `
%S.ts { padding:8px 12px 8px; gap:6px; }
%S.ts-head { display:flex; align-items:baseline; gap:10px; }
%S.ts-head .pf-eyebrow, %S.ts-foot { display:none; }
%S.ts-head .display { font-size:22px; margin:0; }
%S.ts-sub { min-height:0; margin:0; font-size:12px; }
%S.ts-time { height:38px; bottom:6px; } %S.ts-track { height:30px; }
%S.ts-tog, %S.ts-legend { top:8px; height:28px; }
%S.ts-plate.dock { padding:8px 10px; } %S.ts-plate.dock .ts-pl-blurb { display:none; }
`;
const touchCss = `body.touch .ts-plate kbd, body.touch .ts-keys { display:none; }`;
document.head.append(el("style", {}, css + `@media (max-height: 500px) {${SHORT.replaceAll("%S", "")}}` + SHORT.replaceAll("%S", "body.short ") + touchCss));
})();
