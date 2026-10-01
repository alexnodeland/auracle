// STAGE and SHARE. Stage mode: the sound in hand, fullscreen, drawn live with
// phosphor persistence, for a gig or a stream. Share: the sound as a card, its
// face and its name, recognisable anywhere.
(() => {
"use strict";
const { el, icon } = A;
const typingIn = (e) => !!e.target.closest?.("input, textarea, select, [contenteditable]");

// ================================================================ stage mode
let stage = null; // { root, base, bx, trails, tx, name, cat, hint, W, H, raf, loud, last, lastSound, entered, idle }

function openStage() {
  if (stage) return;
  const p = A.inHand();
  const root = el("div", { class: "st-stage", role: "dialog", "aria-modal": "true", "aria-label": `Stage mode: ${p.name}`, tabindex: "-1" });
  const [base, bx] = A.canvas(10, 10), [trails, tx] = A.canvas(10, 10);
  base.className = "st-base"; trails.className = "st-trails";
  base.setAttribute("aria-hidden", "true"); trails.setAttribute("aria-hidden", "true");
  const brand = el("div", { class: "st-brand", "aria-hidden": "true" }, el("span", { class: "st-word" }, "AURACLE"), el("span", { class: "st-lamp" }));
  const name = el("div", { class: "st-name" });
  const cat = el("div", { class: "st-cat mono" });
  const hud = el("div", { class: "st-hud" }, name, cat);
  const touch = matchMedia("(pointer: coarse)").matches;
  const hint = el("div", { class: "st-hint", "aria-hidden": "true", html: touch ? "tap to play · <b>×</b> to leave" : `<kbd>A</kbd>–<kbd>L</kbd> play · <kbd>space</kbd> phrase · <kbd>⇧F</kbd> leave` });
  const leave = el("button", { class: "st-leave", "aria-label": "Leave stage mode (Shift F or Escape)", title: "Leave · ⇧F", onclick: (e) => { e.stopPropagation(); closeStage(); }, html: icon("x") });
  const live = el("div", { class: "sr", "aria-live": "polite" }, `Stage mode, ${p.name}. Shift F or Escape leaves.`);
  root.append(base, trails, brand, hud, hint, leave, live);
  document.body.append(root);
  stage = { root, base, bx, trails, tx, name, cat, hint, W: 0, H: 0, raf: 0, loud: 0, last: null, lastSound: 0, entered: false, idle: 0, prevFocus: document.activeElement };
  document.body.classList.add("st-on");
  sizeStage(); drawBase(); drawHud();
  root.focus({ preventScroll: true });
  // show the controls on movement, then let them go
  const wake = () => { root.classList.add("awake"); clearTimeout(stage.idle); stage.idle = setTimeout(() => stage && root.classList.remove("awake"), 2400); };
  root.addEventListener("pointermove", wake); wake();
  root.addEventListener("pointerup", (e) => { if (e.target.closest("button")) return; A.audio.toggle(A.inHand()); });
  setTimeout(() => stage && hint.classList.add("gone"), 3000);
  const fs = document.documentElement.requestFullscreen?.();
  if (fs && fs.then) fs.then(() => { if (stage) stage.entered = true; }).catch(() => {});
  if (!A.reduced) root.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
  loop();
}
function closeStage() {
  if (!stage) return;
  const s = stage; stage = null;
  cancelAnimationFrame(s.raf); clearTimeout(s.idle); lit.clear();
  document.body.classList.remove("st-on");
  if (document.fullscreenElement) document.exitFullscreen?.().catch?.(() => {});
  const done = () => { s.root.remove(); s.prevFocus?.focus?.({ preventScroll: true }); };
  if (A.reduced) done(); else s.root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180 }).onfinish = done;
}
const toggleStage = () => (stage ? closeStage() : openStage());

function sizeStage() {
  const s = stage, d = Math.min(2, devicePixelRatio || 1);
  s.W = innerWidth; s.H = innerHeight;
  for (const [c, x] of [[s.base, s.bx], [s.trails, s.tx]]) {
    c.width = Math.round(s.W * d); c.height = Math.round(s.H * d); c.style.width = s.W + "px"; c.style.height = s.H + "px";
    x.setTransform(d, 0, 0, d, 0, 0);
  }
}
const stageBox = () => {
  const { W, H } = stage, narrow = W <= 700;
  const h = Math.min(H * (narrow ? 0.62 : 0.76), W * (narrow ? 1.25 : 1.05)), w = h * 0.6;
  return { x: (W - w) / 2, y: (H - h) / 2 - H * (narrow ? 0.06 : 0.035), w, h };
};
// The still part: the vessel as the patch is made, on glass.
function drawBase() {
  const s = stage, x = s.bx, p = A.inHand(), b = stageBox(), dev = A.audio.devFor(p);
  x.clearRect(0, 0, s.W, s.H);
  const g = x.createRadialGradient(s.W / 2, b.y + b.h * 0.6, 0, s.W / 2, b.y + b.h * 0.6, Math.max(s.W, s.H) * 0.7);
  g.addColorStop(0, "rgba(22,40,30,.55)"); g.addColorStop(1, "rgba(7,8,10,0)");
  x.fillStyle = g; x.fillRect(0, 0, s.W, s.H);
  const fy = b.y + b.h + 2, fl = x.createLinearGradient(0, 0, s.W, 0);
  fl.addColorStop(0, "rgba(142,240,177,0)"); fl.addColorStop(0.5, "rgba(142,240,177,.26)"); fl.addColorStop(1, "rgba(142,240,177,0)");
  x.fillStyle = fl; x.fillRect(s.W * 0.12, fy, s.W * 0.76, 1);
  x.save(); x.translate(0, 2 * fy); x.scale(1, -1); x.globalAlpha = 0.08;
  A.face(x, b.h, p, { box: b, dev, layers: false, glow: 0 }); x.restore();
  const m = x.createLinearGradient(0, fy, 0, fy + b.h * 0.3); m.addColorStop(0, "rgba(7,8,10,0)"); m.addColorStop(1, "rgba(7,8,10,1)");
  x.fillStyle = m; x.fillRect(0, fy + 1, s.W, b.h * 0.3); x.fillStyle = "#07080a"; x.fillRect(0, fy + b.h * 0.3, s.W, s.H);
  A.face(x, b.h, p, { box: b, dev, glow: 30, lw: 2.2, dim: 0.92 });
}
function drawHud() {
  const p = A.inHand();
  stage.name.textContent = p.name;
  stage.cat.textContent = `${p.category} · in hand`;
  stage.root.setAttribute("aria-label", `Stage mode: ${p.name}`);
}
// ---- the vessel as a keyboard on its side
// Its vertical axis is frequency (A.D.bands_hz, low at the base), so a note
// lights the vessel where its fundamental and first harmonics sit, for as long
// as the note lasts. The keys play the held note of the phrase, whose root is
// A.D.held.root_hz; a note's semitones move every partial by the same ratio.
const BANDS = A.D.bands_hz, NB = BANDS.length, LOG_STEP = Math.log(BANDS[1] / BANDS[0]);
const NOTE_RELEASE = 520, HARMONICS = 5;
const lit = new Map(); // key -> { semis, t0, off }
const idxOf = (hz) => Math.log(hz / BANDS[0]) / LOG_STEP; // continuous band index
const yAt = (b, i) => b.y + b.h - (i / (NB - 1)) * b.h;
function halfWidthAt(b, dev, i) { // the vessel's half-width at a continuous band index
  const j = Math.max(0, Math.min(NB - 1, i)), a = Math.floor(j), c = Math.min(NB - 1, a + 1), t = j - a;
  const v = dev[a] * (1 - t) + dev[c] * t;
  return (b.w / 2) * A.sig(v * 1.4);
}
A.on("note", ({ key, semis, on }) => {
  if (!stage) return;
  const now = performance.now();
  if (on) lit.set(key, { semis, t0: now, off: null });
  else { const n = lit.get(key); if (n) n.off = now; }
  loop();
});
// How bright a note is now, 0..1: a strike that settles, then a release.
function noteLevel(n, now) {
  if (A.reduced) return n.off == null ? 1 : 0;
  const strike = 0.78 + 0.22 * Math.exp(-(now - n.t0) / 220);
  if (n.off == null) return strike;
  const k = 1 - (now - n.off) / NOTE_RELEASE;
  return k <= 0 ? 0 : strike * k * k;
}
function drawNotes(x, b, now) {
  if (!lit.size) return;
  const dev = A.smooth(A.audio.devFor(A.inHand()), 1), root = A.D.held.root_hz;
  const th = Math.max(2.5, b.h * 0.0085); // a band's half-thickness
  x.save();
  A.vesselPath(x, dev, 1.001, b); x.clip();
  for (const [key, n] of lit) {
    const lv = noteLevel(n, now);
    if (lv <= 0) { lit.delete(key); continue; }
    const f0 = root * Math.pow(2, n.semis / 12);
    for (let h = 1; h <= HARMONICS; h++) {
      const i = idxOf(f0 * h); if (i < 0 || i > NB - 1) continue;
      const y = yAt(b, i), a = lv / Math.pow(h, 0.9), t = th * (h === 1 ? 1 : 0.7);
      const g = x.createLinearGradient(0, y - t * 4, 0, y + t * 4);
      g.addColorStop(0, "rgba(142,240,177,0)"); g.addColorStop(0.5, `rgba(${h === 1 ? "226,255,236" : "142,240,177"},${a})`); g.addColorStop(1, "rgba(142,240,177,0)");
      x.fillStyle = g; x.fillRect(b.x - 2, y - t * 4, b.w + 4, t * 8);
      x.fillStyle = `rgba(226,255,236,${a * (h === 1 ? 0.95 : 0.6)})`; x.fillRect(b.x - 2, y - t * 0.22, b.w + 4, Math.max(1, t * 0.44));
    }
  }
  x.restore();
  // where each fundamental meets the vessel's edge: the key's two ends, glowing
  for (const n of lit.values()) {
    const lv = noteLevel(n, now); if (lv <= 0) continue;
    const i = idxOf(root * Math.pow(2, n.semis / 12)); if (i < 0 || i > NB - 1) continue;
    const y = yAt(b, i), w = halfWidthAt(b, dev, i), cx = b.x + b.w / 2;
    x.shadowColor = "rgba(142,240,177,.95)"; x.shadowBlur = 16 * lv; x.fillStyle = `rgba(226,255,236,${lv})`;
    for (const s of [-1, 1]) { x.beginPath(); x.arc(cx + s * w, y, Math.max(2.2, b.h * 0.006), 0, Math.PI * 2); x.fill(); }
    x.shadowBlur = 0;
  }
}

// How loud it is now, 0..1, from the analyser's own samples.
let tbuf = null;
function loudness() {
  const an = A.audio.an; if (!an) return 0;
  if (!tbuf || tbuf.length !== an.fftSize) tbuf = new Float32Array(an.fftSize);
  an.getFloatTimeDomainData(tbuf);
  let sum = 0; for (let i = 0; i < tbuf.length; i += 2) sum += tbuf[i] * tbuf[i];
  const db = 10 * Math.log10(sum / (tbuf.length / 2) + 1e-12);
  return Math.max(0, Math.min(1, (db + 42) / 34));
}
// The moving part: what you hear, drawn in the vessel's own coordinates, left
// to fade like phosphor.
function frame(now) {
  const s = stage; if (!s) return;
  s.raf = 0;
  const x = s.tx, b = stageBox(), p = A.inHand();
  const sounding = A.audio.playingId === p.id || A.audio.notes.size > 0;
  let live = sounding ? A.audio.liveDev() : null;
  if (live && s.last) live = live.map((v, i) => s.last[i] * 0.5 + v * 0.5);
  s.last = live;
  const target = sounding ? loudness() : 0;
  s.loud += (target - s.loud) * (target > s.loud ? 0.5 : 0.08);
  if (live) s.lastSound = now;
  if (A.reduced) x.clearRect(0, 0, s.W, s.H);
  else { x.globalCompositeOperation = "destination-out"; x.fillStyle = "rgba(0,0,0,.14)"; x.fillRect(0, 0, s.W, s.H); x.globalCompositeOperation = "source-over"; }
  if (!A.reduced && s.loud > 0.02) {
    A.vesselPath(x, A.smooth(A.audio.devFor(p), 1), 1, b);
    x.strokeStyle = `rgba(142,240,177,${0.12 + 0.55 * s.loud})`; x.lineWidth = 2;
    x.shadowColor = "rgba(142,240,177,.9)"; x.shadowBlur = 18 + s.loud * 56; x.stroke(); x.shadowBlur = 0;
  }
  if (live) {
    A.vesselPath(x, A.smooth(live, 1), 1, b);
    x.strokeStyle = "rgba(226,255,236,.95)"; x.lineWidth = 1.6 + s.loud * 1.6;
    x.shadowColor = "rgba(142,240,177,.95)"; x.shadowBlur = 10 + s.loud * 30; x.stroke(); x.shadowBlur = 0;
  }
  drawNotes(x, b, now);
  // keep drawing while there is sound, and until the last trail has faded
  if (sounding || lit.size || now - s.lastSound < 1600) s.raf = requestAnimationFrame(frame);
  else x.clearRect(0, 0, s.W, s.H);
}
function loop() { if (stage && !stage.raf) stage.raf = requestAnimationFrame(frame); }

A.on("play", loop); A.on("note", loop);
A.on("inhand", () => { if (stage) { drawBase(); drawHud(); } });
A.on("fx", () => { if (stage) drawBase(); });
addEventListener("resize", () => { if (stage) { sizeStage(); drawBase(); } });
document.addEventListener("fullscreenchange", () => { if (stage && stage.entered && !document.fullscreenElement) closeStage(); });

// ================================================================ share a sound
let share = null; // { root, card, cx, prevFocus, status }
const TAG = "A synthesizer that searches for your sound";
const CW = 1200, CH = 630;

function wrap(x, text, maxW) {
  const words = text.split(/\s+/), lines = []; let line = "";
  for (const w of words) { const t = line ? line + " " + w : w; if (x.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line); return lines;
}
function spaced(x, text, px, y, track) { // letter-spaced text, left-aligned
  let cx = px; for (const ch of text) { x.fillText(ch, cx, y); cx += x.measureText(ch).width + track; } return cx;
}
// The card, drawn at 1200 × 630 in card pixels.
function drawCard(x, p) {
  x.save();
  x.fillStyle = "#07080a"; x.fillRect(0, 0, CW, CH);
  const g = x.createRadialGradient(290, 380, 0, 290, 380, 560); g.addColorStop(0, "rgba(20,42,30,.95)"); g.addColorStop(1, "rgba(7,8,10,0)");
  x.fillStyle = g; x.fillRect(0, 0, CW, CH);
  for (let y = 0; y < CH; y += 3) { x.fillStyle = "rgba(255,255,255,.012)"; x.fillRect(0, y, CW, 1); }
  // the well's frame
  x.strokeStyle = "#262b33"; x.lineWidth = 1;
  const r = 18, fx = 28.5, fy = 28.5, fw = CW - 57, fh = CH - 57;
  x.beginPath(); x.roundRect ? x.roundRect(fx, fy, fw, fh, r) : x.rect(fx, fy, fw, fh); x.stroke();
  // the face, large, on glass
  const h = 452, b = { x: 290 - h * 0.3, y: 70, w: h * 0.6, h };
  const dev = A.audio.devFor(p), floor = b.y + b.h + 2;
  const fl = x.createLinearGradient(80, 0, 500, 0); fl.addColorStop(0, "rgba(142,240,177,0)"); fl.addColorStop(0.5, "rgba(142,240,177,.3)"); fl.addColorStop(1, "rgba(142,240,177,0)");
  x.fillStyle = fl; x.fillRect(80, floor, 420, 1);
  x.save(); x.beginPath(); x.rect(0, floor + 1, CW, CH); x.clip(); x.translate(0, 2 * floor); x.scale(1, -1); x.globalAlpha = 0.09;
  A.face(x, b.h, p, { box: b, dev, layers: false, glow: 0 }); x.restore();
  A.face(x, b.h, p, { box: b, dev, glow: 34, lw: 2.4 });
  // words
  const L = 560;
  x.textBaseline = "alphabetic"; x.textAlign = "left";
  x.font = "600 17px Jost, 'Futura', sans-serif"; x.fillStyle = "#a19c90";
  spaced(x, p.category.toUpperCase(), L, 156, 3.4);
  let size = 96; x.font = `400 ${size}px Jost, 'Futura', sans-serif`;
  while (x.measureText(p.name).width > CW - L - 90 && size > 56) { size -= 4; x.font = `400 ${size}px Jost, 'Futura', sans-serif`; }
  x.fillStyle = "#e2ddd1"; x.fillText(p.name, L - size * 0.04, 156 + size * 1.05);
  x.font = "400 30px Jost, 'Futura', sans-serif"; x.fillStyle = "#a19c90";
  const bl = wrap(x, p.blurb, CW - L - 110).slice(0, 3);
  bl.forEach((t, i) => x.fillText(t, L, 156 + size * 1.05 + 62 + i * 42));
  // the mark and the line
  x.fillStyle = "#262b33"; x.fillRect(L, 488, CW - L - 90, 1);
  x.font = "500 24px Jost, 'Futura', sans-serif"; x.fillStyle = "#e2ddd1";
  const end = spaced(x, "AURACLE", L, 540, 8.2);
  x.beginPath(); x.arc(end + 6, 532, 5, 0, Math.PI * 2); x.fillStyle = "#ffb454"; x.shadowColor = "rgba(255,180,84,.7)"; x.shadowBlur = 10; x.fill(); x.shadowBlur = 0;
  x.font = "600 13px Jost, 'Futura', sans-serif"; x.fillStyle = "#6f6c63";
  spaced(x, TAG.toUpperCase(), L, 568, 2.5);
  x.restore();
}
async function fontsReady() {
  try { await Promise.all(["400 96px Jost", "500 24px Jost", "600 17px Jost", "400 30px Jost"].map((f) => document.fonts.load(f))); } catch {}
}
function openShare() {
  if (share) return;
  const p = A.inHand();
  const prevFocus = document.activeElement;
  const scrim = el("div", { class: "st-scrim", onclick: () => closeShare() });
  const title = el("h2", { class: "st-title", id: "st-share-title" }, p.name);
  const status = el("p", { class: "st-status mono", "aria-live": "polite" });
  const [card, cx] = A.canvas(CW, CH);
  card.className = "st-card"; card.removeAttribute("style"); card.setAttribute("role", "img"); card.setAttribute("aria-label", `A card for ${p.name}: its face, name and description`);
  const img = el("img", { class: "st-card st-img", alt: `A card for ${p.name}`, hidden: true });
  const copyImg = el("button", { class: "btn", onclick: () => copyImage(), html: `${icon("share")}Copy image` });
  const copyName = el("button", { class: "btn ghost", onclick: () => copyText(), html: "Copy name" });
  const close = el("button", { class: "iconbtn st-x", "aria-label": "Close", onclick: () => closeShare(), html: icon("x") });
  const dlg = el("div", { class: "st-share", role: "dialog", "aria-modal": "true", "aria-labelledby": "st-share-title" },
    el("div", { class: "st-share-head" }, el("div", {}, el("div", { class: "cap" }, "Share"), title), close),
    el("div", { class: "st-card-frame" }, card, img),
    el("div", { class: "st-share-foot" }, el("div", { class: "st-acts" }, copyImg, copyName), el("p", { class: "st-quiet" }, "Links to a sound come with the app.")),
    status);
  document.body.append(scrim, dlg);
  share = { scrim, dlg, card, cx, img, status, title, prevFocus, p };
  fontsReady().then(() => { if (share && share.p === p) drawCard(cx, p); });
  drawCard(cx, p);
  copyImg.focus({ preventScroll: true });
  if (!A.reduced) { dlg.animate([{ opacity: 0, transform: "translate(-50%, -48%) scale(.985)" }, { opacity: 1, transform: "translate(-50%, -50%)" }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" }); }
  dlg.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const f = [...dlg.querySelectorAll("button:not([disabled])")]; if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { f[f.length - 1].focus(); e.preventDefault(); }
    else if (!e.shiftKey && i === f.length - 1) { f[0].focus(); e.preventDefault(); }
  });
}
function closeShare() {
  if (!share) return;
  const s = share; share = null;
  s.scrim.remove(); s.dlg.remove();
  s.prevFocus?.focus?.({ preventScroll: true });
}
// The PNG is exactly the card: 1200 × 630.
function cardBlob(p) {
  return fontsReady().then(() => new Promise((res, rej) => {
    const c = document.createElement("canvas"); c.width = CW; c.height = CH;
    drawCard(c.getContext("2d"), p);
    c.toBlob((b) => (b ? res(b) : rej(new Error("no image"))), "image/png");
  }));
}
function copyImage() {
  const s = share; if (!s) return;
  const blob = cardBlob(s.p);
  const fallback = () => blob.then((b) => {
    if (!share) return;
    s.img.src = URL.createObjectURL(b); s.img.hidden = false; s.card.hidden = true;
    s.status.textContent = "Right-click the card to save it.";
  }).catch(() => { s.status.textContent = "This browser can't make the image here."; });
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") { fallback(); return; }
    navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
      .then(() => { if (share) s.status.textContent = "Copied the card."; })
      .catch(fallback);
  } catch { fallback(); }
}
function copyText() {
  const s = share; if (!s) return;
  const pick = () => { const r = document.createRange(); r.selectNodeContents(s.title); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); s.status.textContent = "Selected the name: press ⌘C."; };
  try { navigator.clipboard.writeText(s.p.name).then(() => { if (share) s.status.textContent = `Copied “${s.p.name}”.`; }).catch(pick); } catch { pick(); }
}

// ================================================================ keys, commands, doors
// Capture phase, so ⇧F never reaches the note keys and Esc closes the top layer only.
addEventListener("keydown", (e) => {
  if (share && e.key === "Escape") { closeShare(); e.preventDefault(); e.stopPropagation(); return; }
  if (share) return;
  if (stage && e.key === "Escape") { closeStage(); e.preventDefault(); e.stopPropagation(); return; }
  if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "F" || e.code === "KeyF") && !typingIn(e)) {
    if (!e.repeat) toggleStage();
    e.preventDefault(); e.stopPropagation();
  }
}, true);
addEventListener("keyup", (e) => { if (e.shiftKey && (e.key === "F" || e.code === "KeyF")) e.stopPropagation(); }, true);

A.cmd({ id: "stage", label: "Stage mode", key: "⇧F", icon: "stage", run: openStage });
A.cmd({ id: "share", label: "Share this sound", icon: "share", run: openShare });

// Doors in PERFORM: a stage button in the well's corner, a share button by the name.
let doors = false;
function placeShare(head) {
  if (!head || head.querySelector(".st-share-btn")) return;
  const h1 = head.querySelector(".display"); if (!h1) return;
  h1.after(el("button", { class: "st-share-btn", "aria-label": `Share ${A.inHand().name}`, title: "Share this sound", onclick: () => openShare(), html: icon("share") }));
}
A.on("view", () => {
  if (doors) return;
  const well = document.querySelector("#view-perform .pf-well"), head = document.querySelector("#view-perform .pf-head");
  if (!well || !head) return;
  doors = true;
  well.append(el("button", { class: "st-well-btn", "aria-label": "Stage mode (Shift F)", title: "Stage mode · ⇧F", onclick: (e) => { e.stopPropagation(); openStage(); }, html: `${icon("stage")}<kbd>⇧F</kbd>` }));
  placeShare(head);
  new MutationObserver(() => placeShare(head)).observe(head, { childList: true });
});

const css = `
/* stage mode */
.st-stage { position:fixed; inset:0; z-index:90; background:var(--void); outline:none; cursor:none; overflow:hidden; touch-action:manipulation; }
.st-stage.awake { cursor:default; }
.st-stage canvas { position:absolute; inset:0; }
.st-trails { mix-blend-mode:screen; }
.st-brand { position:absolute; left:32px; top:28px; display:flex; align-items:center; gap:10px; opacity:.55; }
.st-word { font:500 13px/1 var(--f-silk); letter-spacing:.34em; color:var(--silk-dim); }
.st-lamp { width:7px; height:7px; border-radius:50%; background:var(--amber); box-shadow:0 0 8px var(--amber-glow); }
.st-hud { position:absolute; left:32px; bottom:30px; display:grid; gap:8px; pointer-events:none; }
.st-name { font:600 15px/1 var(--f-silk); letter-spacing:.34em; text-transform:uppercase; color:var(--silk); }
.st-cat { font-size:12px; color:var(--silk-mute); letter-spacing:.04em; }
.st-hint { position:absolute; left:50%; bottom:34px; transform:translateX(-50%); display:flex; align-items:center; gap:6px; color:var(--silk-dim); font-size:13px; white-space:nowrap; transition:opacity 900ms var(--e-settle); }
.st-hint kbd { color:var(--silk); }
.st-hint b { color:var(--silk); font-weight:500; }
.st-hint.gone { opacity:0; }
.st-leave { position:absolute; right:22px; top:20px; width:40px; height:40px; border-radius:50%; display:grid; place-items:center; color:var(--silk-dim); border:1px solid var(--hair); background:rgba(19,22,26,.6); opacity:0; transition:opacity var(--d-state), color var(--d-press); }
.st-leave svg { width:18px; height:18px; }
.st-leave:hover { color:var(--silk); }
.st-stage.awake .st-leave, .st-leave:focus-visible { opacity:1; }
body.st-on .grain { z-index:91; }
@media (pointer: coarse) { .st-leave { opacity:1; width:44px; height:44px; } .st-stage { cursor:default; } .st-well-btn kbd { display:none; } }
body.touch .st-well-btn kbd { display:none; }
body.touch .st-leave { opacity:1; width:44px; height:44px; }
@media (max-width: 700px) {
  .st-brand { left:18px; top:18px; }
  .st-hud { left:18px; bottom:calc(20px + env(safe-area-inset-bottom, 0px)); }
  .st-name { font-size:13px; letter-spacing:.28em; }
  .st-hint { bottom:calc(64px + env(safe-area-inset-bottom, 0px)); font-size:12px; }
  .st-leave { right:14px; top:12px; opacity:1; }
}
@media (prefers-reduced-motion: reduce) { .st-hint { transition:none; } }

/* the doors in PERFORM */
.st-well-btn { position:absolute; right:12px; top:12px; z-index:3; display:inline-flex; align-items:center; gap:8px; height:32px; padding:0 8px 0 10px; border-radius:999px;
  color:var(--silk-dim); border:1px solid var(--hair); background:rgba(19,22,26,.72); cursor:pointer; transition:color var(--d-press), border-color var(--d-press); }
.st-well-btn svg { width:15px; height:15px; }
.st-well-btn kbd { font-size:9px; }
.st-well-btn:hover { color:var(--silk); border-color:var(--hair-hi); }
.pf-head .display { display:inline-block; vertical-align:middle; }
.st-share-btn { display:inline-grid; place-items:center; vertical-align:middle; width:34px; height:34px; margin-left:14px; border-radius:50%;
  color:var(--silk-mute); border:1px solid var(--hair); transition:color var(--d-press), border-color var(--d-press); }
.st-share-btn svg { width:15px; height:15px; }
.st-share-btn:hover { color:var(--silk); border-color:var(--hair-hi); }

/* share */
.st-scrim { position:fixed; inset:0; z-index:80; background:rgba(4,5,6,.72); backdrop-filter:blur(3px); animation:fade var(--d-state) var(--e-settle); }
.st-share { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); z-index:81; width:min(820px, calc(100vw - 32px)); max-height:calc(100vh - 32px); overflow:auto;
  display:grid; gap:18px; padding:22px; border-radius:var(--r3); background:var(--panel); border:1px solid var(--hair-hi); box-shadow:0 40px 90px -30px rgba(0,0,0,.9); }
.st-share-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
.st-title { font:500 var(--t-title)/1.15 var(--f-silk); margin:8px 0 0; }
.st-card-frame { border-radius:var(--r2); overflow:hidden; border:1px solid var(--hair); background:var(--void); }
.st-card { display:block; width:100%; height:auto; aspect-ratio:1200 / 630; max-width:100%; }
.st-card[hidden] { display:none; }
.st-share-foot { display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; }
.st-acts { display:flex; gap:8px; flex-wrap:wrap; }
.st-acts .btn { white-space:nowrap; }
.st-quiet { margin:0; color:var(--silk-mute); font-size:13px; }
.st-status { margin:0; min-height:16px; font-size:12px; color:var(--green-dim); }
@media (max-width: 700px) { .st-share { padding:16px; gap:14px; } .st-acts .btn { flex:1; } }
`;
document.head.append(el("style", {}, css));
})();
