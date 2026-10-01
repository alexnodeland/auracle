// Explain anything: the "ask" step. Point at something (a ? chip appears),
// press ? or click the chip, and it answers with a small computed figure and
// one plain sentence. From BRIGHT's answer, a one-minute lesson can start,
// using the sound in hand as its example.
(() => {
"use strict";
const { el, icon } = A;
const NB = A.D.bands_hz.length;
const G = "#8ef0b1", GD = "rgba(142,240,177,", AM = "#ffb454", AMD = "rgba(255,180,84,";
const SILK = "#e2ddd1", DIM = "rgba(161,156,144,.95)", MUTE = "rgba(111,108,99,.9)", HAIR = "#262b33";
const MONO = "400 12px 'IBM Plex Mono', monospace", CAPS = "600 11px Jost, sans-serif";
const fmtHz = (f) => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1) + " kHz" : Math.round(f) + " Hz");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const bandY = (i, box) => box.y + box.h - (i / (NB - 1)) * box.h;

// ---------------------------------------------------------------- what is askable
const TARGETS = [
  [".pf-knobs .kn", "knob"],
  [".bank .row", "like"],
  [".bank .row .pct", "like"],
  [".ev-fair", "pair"],
  [".ev-card", "pair"],
  [".ts-foot", "map"],
  [".inhand", "vessel"],
];
function tag() {
  for (const [sel, kind] of TARGETS) document.querySelectorAll(sel).forEach((n) => { if (n.dataset.ask !== kind) n.dataset.ask = kind; });
}
let tagQueued = false;
new MutationObserver(() => { if (tagQueued) return; tagQueued = true; requestAnimationFrame(() => { tagQueued = false; tag(); }); })
  .observe(document.body, { childList: true, subtree: true });

// ---------------------------------------------------------------- the chip: the hint that you can ask
const chip = el("button", { class: "ask-chip", type: "button", tabindex: "-1", "aria-label": "Ask about this (?)", title: "Ask · ?", html: "?" });
document.body.append(chip);
let current = null, hideT = 0;
function showChip(t) {
  current = t; clearTimeout(hideT);
  const r = t.getBoundingClientRect();
  if (!r.width || !r.height) { chip.classList.remove("on"); return; }
  chip.style.left = clamp(r.right - 11, 4, innerWidth - 26) + "px";
  chip.style.top = clamp(r.top - 9, 4, innerHeight - 26) + "px";
  chip.classList.add("on");
}
function hideChip() { hideT = setTimeout(() => { chip.classList.remove("on"); if (!pop.classList.contains("on")) current = null; }, 160); }
document.addEventListener("pointerover", (e) => {
  if (e.pointerType === "touch") return; // on touch, a long press asks (below)
  if (e.target === chip) { clearTimeout(hideT); return; }
  const t = e.target.closest?.("[data-ask]");
  if (t) showChip(t); else if (current && !e.target.closest?.(".ask-pop")) hideChip();
});
document.addEventListener("focusin", (e) => { const t = e.target.closest?.("[data-ask]"); if (t) showChip(t); });
document.addEventListener("scroll", () => chip.classList.remove("on"), true);
chip.addEventListener("click", () => current && ask(current));
// ? asks, when something askable is under the pointer or holds focus
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && lesson.classList.contains("on")) { e.stopPropagation(); e.preventDefault(); closeLesson(true); return; }
  if (e.key === "Escape" && pop.classList.contains("on")) { e.stopPropagation(); e.preventDefault(); close(); return; }
  if (e.key !== "?" || e.metaKey || e.ctrlKey || e.target.closest?.("input, textarea, select")) return;
  const focused = document.activeElement?.closest?.("[data-ask]");
  const t = focused || (current && current.matches(":hover") ? current : null);
  if (!t) return;
  e.stopPropagation(); e.preventDefault(); ask(t);
}, true);

// ---------------------------------------------------------------- touch: hold to ask
// A finger held still on anything askable fills a ring around it; when the ring
// closes, the answer opens. Moving, or lifting early, is an ordinary touch. The
// first few early lifts show the ring half-filled, fading: the gesture, shown.
const HOLD = 480, RING_DELAY = 140;
const ring = el("div", { class: "ask-ring", "aria-hidden": "true" });
document.body.append(ring);
let lp = null, eatClick = 0, hints = 0;
const ringAt = (x, y) => { ring.style.left = x + "px"; ring.style.top = y + "px"; };
document.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "touch" || e.target.closest?.(".ask-pop, .lesson")) return;
  const t = e.target.closest?.("[data-ask]"); if (!t) return;
  ringAt(e.clientX, e.clientY); ring.classList.remove("on", "hint", "done");
  // the ring waits a moment: a tap or the start of a swipe never shows it
  lp = { t, x: e.clientX, y: e.clientY, id: e.pointerId, t0: performance.now(),
    show: setTimeout(() => { if (lp && !lp.fired) { void ring.offsetWidth; ring.classList.add("on"); } }, RING_DELAY),
    timer: setTimeout(() => { if (!lp) return; lp.fired = true; ring.classList.remove("on"); ring.classList.add("done"); eatClick = performance.now(); navigator.vibrate?.(8); ask(lp.t); hints = 99; }, HOLD) };
}, true);
document.addEventListener("pointermove", (e) => { if (lp && e.pointerId === lp.id && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) endHold(false); }, true);
const endHold = (lifted) => {
  if (!lp) return;
  clearTimeout(lp.timer); clearTimeout(lp.show);
  const early = lifted && !lp.fired && performance.now() - lp.t0 > 90;
  ring.classList.remove("on");
  if (early && hints < 3) { hints++; ring.classList.add("hint"); setTimeout(() => ring.classList.remove("hint"), 900); }
  lp = null;
};
document.addEventListener("pointerup", () => endHold(true), true);
document.addEventListener("pointercancel", () => endHold(false), true);
// the click that ends a long press belongs to the question, not to the control under it
document.addEventListener("click", (e) => { if (performance.now() - eatClick < 700) { e.stopPropagation(); e.preventDefault(); eatClick = 0; } }, true);
document.addEventListener("contextmenu", (e) => { if (e.target.closest?.("[data-ask]") && matchMedia("(pointer: coarse)").matches) e.preventDefault(); });

// ---------------------------------------------------------------- the answer
const pop = el("div", { class: "ask-pop", role: "dialog", "aria-modal": "false", "aria-labelledby": "ask-title", tabindex: "-1" });
document.body.append(pop);
let returnTo = null;
// Beside or below what was asked, never over it, with a caret pointing back at it.
// Things in the bank answer to their right, so the list stays readable.
function place(t) {
  pop.removeAttribute("data-side");
  if (matchMedia("(max-width: 700px)").matches) { pop.style.left = pop.style.top = ""; return; }
  const r = t.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  let side = "below", x = r.left + r.width / 2 - pw / 2, y = r.bottom + 12;
  if (t.closest(".bank") || y + ph > innerHeight - 12 && r.top - ph - 12 < 8) {
    side = r.right + 14 + pw < innerWidth ? "right" : "left";
    x = side === "right" ? r.right + 14 : r.left - pw - 14; y = r.top + r.height / 2 - ph / 2;
  } else if (y + ph > innerHeight - 12) { side = "above"; y = r.top - ph - 12; }
  x = clamp(x, 12, innerWidth - pw - 12); y = clamp(y, 8, innerHeight - ph - 8);
  pop.style.left = x + "px"; pop.style.top = y + "px";
  // the caret sits on the edge facing the target, at the target's centre
  pop.dataset.side = side;
  pop.style.setProperty("--cx", clamp(r.left + r.width / 2 - x, 18, pw - 18) + "px");
  pop.style.setProperty("--cy", clamp(r.top + r.height / 2 - y, 18, ph - 18) + "px");
}
function answer(t) {
  const kind = t.dataset.ask;
  if (kind === "knob") return knob(t.closest(".kn").dataset.c);
  if (kind === "like") return like(A.byId.get(+t.closest(".row").dataset.id));
  if (kind === "pair") return pair();
  if (kind === "lineage") return lineage(A.byId.get(+t.closest(".row").dataset.id));
  if (kind === "map") return map();
  return vessel(A.inHand());
}
let shown = null; // the element the open answer is about
function ask(t) {
  const a = answer(t); if (!a) return;
  shown = t;
  returnTo = document.activeElement;
  pop.replaceChildren(
    el("div", { class: "ask-head" }, el("span", { class: "cap", id: "ask-title" }, a.title), el("button", { class: "ask-x", type: "button", "aria-label": "Close (esc)", onclick: close, html: icon("x") })),
    a.fig, el("p", { class: "ask-say" }, a.say));
  if (a.fig.getAttribute("role") !== "img") { a.fig.setAttribute("role", "img"); a.fig.setAttribute("aria-label", a.alt || a.say); }
  if (a.more) pop.append(a.more);
  const kc = t.dataset.ask === "knob" ? t.closest(".kn")?.dataset.c : null;
  if (kc) {
    const ids = [...document.querySelectorAll('#view-perform .kn[data-c]')].map((k) => k.dataset.c);
    const sw = el("div", { class: "ask-sw", role: "group", "aria-label": "Explain another control" },
      ...ids.map((id) => el("button", { type: "button", "aria-pressed": String(id === kc), onclick: () => ask(document.querySelector(`#view-perform .kn[data-c="${id}"]`)) }, id)));
    pop.insertBefore(sw, pop.querySelector(".ask-say"));
    pop.onkeydown = (ev) => { if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return; const j = (ids.indexOf(kc) + (ev.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length; ask(document.querySelector(`#view-perform .kn[data-c="${ids[j]}"]`)); ev.preventDefault(); ev.stopPropagation(); };
  } else pop.onkeydown = null;
  pop.classList.add("on"); chip.classList.remove("on");
  place(t); pop.focus({ preventScroll: true });
  a.fig.title = "Play it again"; a.fig.style.cursor = "pointer"; a.fig.addEventListener("click", () => run(a));
  run(a);
  A.emit("ask", { kind: t.dataset.ask, c: kc });
}
function close() {
  cancelAnimationFrame(anim);
  const was = pop.classList.contains("on");
  pop.classList.remove("on");
  if (was) A.emit("askclose");
  if (returnTo && document.contains(returnTo)) returnTo.focus?.({ preventScroll: true });
  returnTo = null;
}
document.addEventListener("pointerdown", (e) => { if (pop.classList.contains("on") && !e.target.closest(".ask-pop, .ask-chip, .lesson")) close(); });
A.ask = (t) => ask(typeof t === "string" ? document.querySelector(t) : t);
A.askClose = () => close();
A.askOpen = () => pop.classList.contains("on");
// an open answer follows its value: turn the knob and the figure and sentence move with it
let liveQ = 0;
A.on("fx", () => {
  if (!pop.classList.contains("on") || !shown || shown.dataset.ask !== "knob" || liveQ) return;
  liveQ = requestAnimationFrame(() => {
    liveQ = 0; if (!pop.classList.contains("on") || !shown) return;
    const a = answer(shown); if (!a) return;
    const old = pop.querySelector(".ask-fig"); if (old) old.replaceWith(a.fig);
    a.fig.setAttribute("role", "img"); a.fig.setAttribute("aria-label", a.alt || a.say);
    a.fig.title = "Play it again"; a.fig.style.cursor = "pointer"; a.fig.addEventListener("click", () => run(a));
    const say = pop.querySelector(".ask-say"); if (say) say.textContent = a.say;
    cancelAnimationFrame(anim); if (a.loop) run(a); else a.paint(1, 0);
  });
});
// an answer belongs to where it was asked: moving elsewhere puts it away
A.on("view", () => { if (pop.classList.contains("on")) close(); });
A.ask.close = close;

// ---------------------------------------------------------------- figures
// Motion and computed shapes first, words last: each figure plays its cause
// once (or, for MOTION, runs at the control's real rate), then holds. Under
// reduced motion it shows the end state. Clicking a figure plays it again.
const W = 320, H = 140;
const ez = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const seg = (k, a, b) => clamp((k - a) / (b - a), 0, 1);
function frame() { const [c, x] = A.canvas(W, H); c.className = "ask-fig"; return [c, x]; }
const axisText = (x, s, px, py, align = "left", col = DIM) => { x.font = MONO; x.fillStyle = col; x.textAlign = align; x.fillText(s, px, py); };
const capsText = (x, s, px, py, align = "left", col = DIM) => { x.font = CAPS; x.fillStyle = col; x.textAlign = align; x.fillText(s.toUpperCase().split("").join(String.fromCharCode(8202)), px, py); };
const glowLine = (x, w = 2) => { x.strokeStyle = G; x.lineWidth = w; x.shadowColor = GD + ".6)"; x.shadowBlur = 8; x.stroke(); x.shadowBlur = 0; };

// A knob: what it does to the sound, from the same chain the sound plays through.
const KNOB = { bright: "Bright", body: "Body", snap: "Snap", motion: "Motion", grit: "Grit", space: "Space" };
// a control from the palette: its recipe over the six, and the push it gives this sound
function macroAnswer(id) {
  const M = A.perform?.MACROS.find((m) => m.id === id); if (!M) return null;
  const p = A.inHand(), v = A.perform.mval(M), [c, x] = frame();
  const NAMES = { bright: "BRIGHT", body: "BODY", snap: "SNAP", motion: "MOTION", grit: "GRIT", space: "SPACE" };
  const dims = Object.entries(M.w).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const far = Math.abs(v - M.def) < 0.01 ? 1 : v;
  const paint = (k) => {
    x.clearRect(0, 0, W, H);
    const box = { x: 10, y: 10, w: 58, h: H - 36 };
    const fxT = A.perform.effective(p.id, { [M.id]: M.def + (far - M.def) * k });
    A.face(x, box.h, p, { box, dev: A.audio.devFor(p), layers: false, glow: 0, lw: 1, dim: 0.35 });
    A.vesselPath(x, A.smooth(A.devOf(p, A.audio.responseDb(fxT)), 1), 1, box); glowLine(x);
    const bx = 150, bw = W - bx - 16, zx = bx + bw / 2;
    dims.forEach(([d, w], i) => {
      const y = 22 + i * 26;
      axisText(x, NAMES[d], bx - 10, y + 4, "right");
      x.fillStyle = HAIR; x.fillRect(bx, y, bw, 1); x.fillStyle = "rgba(111,108,99,.6)"; x.fillRect(zx, y - 7, 1, 14);
      const len = w * k * (bw / 2) * 0.9; x.fillStyle = "#8ef0b1"; x.fillRect(Math.min(zx, zx + len), y - 3, Math.abs(len), 6);
    });
    axisText(x, "down", bx, H - 8); axisText(x, "up", bx + bw, H - 8, "right");
  };
  const say = `${M.name}: ${dims.map(([d, w]) => `${NAMES[d]} ${w > 0 ? "up" : "down"}`).join(", ")}${Math.abs(v - M.def) < 0.01 ? " as you turn it." : ", as set now."}`;
  return { title: `${M.name} · what it does`, fig: c, paint, dur: 1.1, loop: false, say, more: null, alt: `How ${M.name} changes ${p.name}` };
}
// a child next to its parent: the vessel grows from the parent's shape into the child's,
// with what changed listed, and both a tap away to hear
// A child beside the seed it was grown from: the seed's outline, the child's face walking
// out of it (the walk), what changed in the patch, and what the model rated each when it
// was bred. Both play while both still exist; a seed trimmed from the pool is only a name.
function lineage(p) {
  const lin = A.state.lineage?.[p?.id], par = lin && A.byId.get(lin.parent); if (!par) return null;
  const d = A.diffOf(p, par), [c, x] = frame(), live = A.alive(par);
  const box = { x: 14, y: 8, w: 70, h: H - 20 };
  const paint = (k) => {
    x.clearRect(0, 0, W, H);
    A.vesselPath(x, A.smooth(par.dev, 1), 1, box); x.setLineDash([3, 3]); x.strokeStyle = "rgba(226,221,209,.55)"; x.lineWidth = 1.2; x.stroke(); x.setLineDash([]);
    const dev = par.dev.map((v, i) => v + (p.dev[i] - v) * k);
    A.face(x, box.h, p, { box, dev, glow: 10, lw: 1.5, dim: 0.35 + 0.65 * k });
    axisText(x, par.name, 104, 34, "left", MUTE); axisText(x, "seeded a walk to", 104, 58, "left", DIM); axisText(x, p.name, 104, 82, "left", SILK);
    axisText(x, `generation ${lin.gen}`, 104, 106, "left", MUTE);
  };
  const lines = [...d.added.map((m) => `+ ${m}`), ...d.removed.map((m) => `− ${m}`), ...d.knobs.map((k) => `${k.mod} ${k.k} ${fmtN(k.from)} → ${fmtN(k.to)}`)];
  const pct = (v) => Math.round(v * 100) + "%", exploring = lin.pu != null && lin.cu < lin.pu - 0.05;
  const more = el("div", { class: "ask-lin" },
    lines.length ? el("ul", { class: "ask-lin-list mono" }, ...lines.map((t) => el("li", {}, t))) : "",
    lin.pu != null ? el("p", { class: "voice ask-lin-rated" }, exploring
      ? `it rated ${p.name} ${pct(lin.cu)}, below its seed's ${pct(lin.pu)}: exploring. A walk can step downhill, and this one still beat the weakest sound in the pool.`
      : `it rated ${p.name} ${pct(lin.cu)} and its seed ${pct(lin.pu)} when it bred them`) : "",
    el("div", { class: "ask-lin-play" },
      live ? el("button", { class: "btn ghost", type: "button", onclick: () => A.audio.toggle(par), html: `${icon("play")}${par.name}` })
        : el("span", { class: "ask-lin-gone mono", title: "Trimmed from the pool; the engine keeps its name, not its sound" }, `${par.name} · replaced`),
      el("button", { class: "btn", type: "button", onclick: () => A.audio.toggle(p), html: `${icon("play")}${p.name}` })),
    el("p", { class: "ask-lin-note mono" }, "In the app a child is its seed after a short walk: knobs nudged, now and then a module swapped. In this demo it is the preset nearest its seed."));
  const say = d.words.length ? `Grown from ${par.name}: ${d.words.join(" and ")}.` : `Grown from ${par.name}: a close variation.`;
  return { title: `${p.name} · what changed`, fig: c, paint, dur: 1.2, loop: false, say, more, alt: `${p.name} grown from ${par.name}` };
}
const fmtN = (v) => (Math.abs(v) >= 10 ? Math.round(v) : v.toFixed(2));
function knob(id) {
  if (!KNOB[id]) return macroAnswer(id);
  const p = A.inHand(), fx = { ...A.fxOf(p.id) }, v = fx[id];
  const [c, x] = frame();
  let say = "", more = null, paint, dur = 1.1, loop = false;
  if (id === "bright" || id === "body") {
    // the filter's curve moves from neutral to this setting, and the vessel follows
    const box = { x: 10, y: 10, w: 58, h: H - 36 }, rx = 138, rw = W - rx - 14, zx = rx + rw / 2;
    paint = (k) => {
      x.clearRect(0, 0, W, H);
      const f = { ...fx, [id]: 0.5 + (v - 0.5) * k }, r = A.audio.responseDb(f);
      A.face(x, box.h, p, { box, dev: A.devOf(p, r), glow: 8, lw: 1.2 });
      for (const hz of [100, 1000, 10000]) { const y = bandY(A.bandOfHz(hz), box); x.fillStyle = "rgba(111,108,99,.7)"; x.fillRect(74, y, 5, 1); axisText(x, fmtHz(hz), 83, y + 4); }
      x.strokeStyle = HAIR; x.lineWidth = 1; x.strokeRect(rx + 0.5, box.y + 0.5, rw, box.h);
      x.fillStyle = "rgba(111,108,99,.55)"; x.fillRect(zx, box.y, 1, box.h);
      x.beginPath(); r.forEach((db, i) => { const y = bandY(i, box), xx = zx + clamp(db / 24, -1, 1) * rw * 0.5; i ? x.lineTo(xx, y) : x.moveTo(xx, y); }); glowLine(x);
      axisText(x, "−24", rx, H - 8); axisText(x, "0", zx, H - 8, "center"); axisText(x, "+24 dB", rx + rw, H - 8, "right");
    };
    if (id === "bright") {
      say = v < 0.49 ? `Cuts above ${fmtHz(350 * Math.pow(18000 / 350, v / 0.5))}: the top narrows.` : v > 0.51 ? `Lifts the highs ${((v - 0.5) / 0.5 * 12).toFixed(1)} dB: the top widens.` : "A filter on the highs. Centre: as made.";
      more = el("button", { class: "btn ask-learn", type: "button", onclick: () => { close(); openLesson(); }, html: `${icon("teach")}Learn: what a filter does<span class="sub">1 min</span>` });
    } else {
      const db = (v - 0.5) * 24;
      say = Math.abs(db) < 0.2 ? "A shelf under 180 Hz. Centre: as made." : `${db > 0 ? "Adds" : "Takes"} ${Math.abs(db).toFixed(1)} dB under 180 Hz: the base ${db > 0 ? "widens" : "narrows"}.`;
    }
  } else if (id === "snap") {
    // a note starts: the envelope plays through its first 400 ms
    const gx = 30, gw = W - 44, gy = 14, gh = H - 42;
    const env = (s, t) => { const atk = s < 0.5 ? 0.003 + (0.5 - s) * 0.5 : 0.002, pk = s > 0.5 ? 1 + (s - 0.5) * 0.8 : 1; return t < atk ? (t / atk) * pk : 1 + (pk - 1) * Math.exp(-(t - atk) / 0.06); };
    const yOf = (g) => gy + gh - (g / 1.45) * gh;
    paint = (k) => {
      x.clearRect(0, 0, W, H); x.strokeStyle = HAIR; x.lineWidth = 1; x.strokeRect(gx + 0.5, gy + 0.5, gw, gh);
      x.beginPath(); for (let i = 0; i <= 120; i++) { const t = (i / 120) * 0.4; i ? x.lineTo(gx + (i / 120) * gw, yOf(env(0.5, t))) : x.moveTo(gx, yOf(env(0.5, t))); } x.setLineDash([3, 3]); x.strokeStyle = "rgba(161,156,144,.7)"; x.lineWidth = 1; x.stroke(); x.setLineDash([]);
      const n = Math.max(1, Math.round(120 * k)); x.beginPath(); for (let i = 0; i <= n; i++) { const t = (i / 120) * 0.4; i ? x.lineTo(gx + (i / 120) * gw, yOf(env(v, t))) : x.moveTo(gx, yOf(env(v, t))); } glowLine(x);
      const hx = gx + (n / 120) * gw, hy = yOf(env(v, (n / 120) * 0.4)); x.beginPath(); x.arc(hx, hy, 3.5, 0, 7); x.fillStyle = G; x.fill();
      axisText(x, "0", gx, H - 8); axisText(x, "400 ms", gx + gw, H - 8, "right");
    };
    dur = 1.4;
    say = Math.abs(v - 0.5) < 0.01 ? "How each note starts. Dashed: as made." : v < 0.5 ? `Softer starts: ${Math.round((0.003 + (0.5 - v) * 0.5) * 1000)} ms to full.` : `Adds ${Math.round((v - 0.5) * 80)}% punch to each start.`;
  } else if (id === "motion") {
    // the sweeping filter, running at the control's real rate
    const gx = 58, gw = W - 70, gy = 12, gh = H - 38, lo = Math.log(200), hi = Math.log(20000), rate = 0.25 + v * 5;
    const yOf = (f) => gy + gh - ((Math.log(f) - lo) / (hi - lo)) * gh;
    paint = (k, t) => {
      x.clearRect(0, 0, W, H); x.strokeStyle = HAIR; x.lineWidth = 1; x.strokeRect(gx + 0.5, gy + 0.5, gw, gh);
      for (const f of [1000, 10000]) { axisText(x, fmtHz(f), gx - 6, yOf(f) + 4, "right"); x.fillStyle = "rgba(111,108,99,.5)"; x.fillRect(gx, yOf(f), gw, 1); }
      x.setLineDash([3, 3]); x.strokeStyle = "rgba(161,156,144,.7)"; x.beginPath(); x.moveTo(gx, yOf(20000) + 1); x.lineTo(gx + gw, yOf(20000) + 1); x.stroke(); x.setLineDash([]);
      if (v > 0.01) {
        const amp = v * 4200 * ez(Math.min(1, k * 1.5));
        x.beginPath(); for (let i = 0; i <= 200; i++) { const tt = (i / 200) * 2 - t, f = clamp(5200 + amp * Math.sin(2 * Math.PI * rate * tt), 200, 20000); i ? x.lineTo(gx + (i / 200) * gw, yOf(f)) : x.moveTo(gx, yOf(f)); } glowLine(x);
        const fNow = clamp(5200 + amp * Math.sin(2 * Math.PI * rate * (2 - t)), 200, 20000); x.beginPath(); x.arc(gx + gw, yOf(fNow), 3.5, 0, 7); x.fillStyle = G; x.fill();
      }
      axisText(x, "2 s ago", gx, H - 8); axisText(x, "now", gx + gw, H - 8, "right");
    };
    loop = v > 0.01;
    say = v < 0.01 ? "A sweeping filter. Zero: still." : `Sweeps a filter ${rate.toFixed(1)} times a second.`;
  } else if (id === "grit") {
    // the waveshaper bends from a straight line into this setting's curve
    const s = H - 30, gx = (W - s) / 2, gy = 10;
    paint = (kk) => {
      x.clearRect(0, 0, W, H); const k = v * 30 * kk, g = 1 / (1 + v * kk * 2.2);
      x.strokeStyle = HAIR; x.lineWidth = 1; x.strokeRect(gx + 0.5, gy + 0.5, s, s);
      x.fillStyle = "rgba(111,108,99,.5)"; x.fillRect(gx, gy + s / 2, s, 1); x.fillRect(gx + s / 2, gy, 1, s);
      x.setLineDash([3, 3]); x.strokeStyle = "rgba(161,156,144,.7)"; x.beginPath(); x.moveTo(gx, gy + s); x.lineTo(gx + s, gy); x.stroke(); x.setLineDash([]);
      x.beginPath(); for (let i = 0; i <= 100; i++) { const xi = (i / 100) * 2 - 1, yi = (((1 + k) * xi) / (1 + k * Math.abs(xi))) * g; const px = gx + ((xi + 1) / 2) * s, py = gy + s - ((clamp(yi, -1, 1) + 1) / 2) * s; i ? x.lineTo(px, py) : x.moveTo(px, py); } glowLine(x);
      axisText(x, "in", gx + s + 6, gy + s / 2 + 4); axisText(x, "out", gx + s / 2 + 6, gy + 12);
    };
    say = v < 0.01 ? "Straight line: clean." : "Bends loud moments into new harmonics.";
  } else {
    // the room: its tail decays out after the sound
    const gx = 34, gw = W - 46, gy = 12, gh = H - 38, wet = v * 0.7, dry = 1 - v * 0.45;
    paint = (k) => {
      x.clearRect(0, 0, W, H); x.strokeStyle = HAIR; x.lineWidth = 1; x.strokeRect(gx + 0.5, gy + 0.5, gw, gh);
      x.fillStyle = GD + ".9)"; x.fillRect(gx + 1, gy + gh - dry * gh, 4, dry * gh);
      const n = Math.round(120 * k); x.beginPath(); x.moveTo(gx + 6, gy + gh);
      for (let i = 0; i <= n; i++) { const t = i / 120; x.lineTo(gx + 6 + t * (gw - 8), gy + gh - wet * Math.pow(1 - t, 3.2) * gh); }
      x.lineTo(gx + 6 + (n / 120) * (gw - 8), gy + gh); x.closePath(); x.fillStyle = GD + ".18)"; x.fill(); x.strokeStyle = G; x.lineWidth = 1.5; x.stroke();
      axisText(x, "dry", 4, gy + gh - dry * gh + 4); axisText(x, "0", gx + 6, H - 8); axisText(x, "2.6 s", gx + gw, H - 8, "right");
    };
    dur = 1.6;
    say = v < 0.01 ? "Zero: dry, no room." : `A room ${Math.round(v * 100)}% deep, fading over 2.6 s.`;
  }
  return { title: `${KNOB[id]} · what it does`, fig: c, paint, dur, loop, say, more, alt: `How ${KNOB[id]} changes ${p.name}` };
}

// Liking: the bank's bars grow, then this sound drops into its place.
function like(p) {
  if (!p) return null;
  const [c, x] = frame();
  const list = A.presets.filter((q) => !A.state.cut.has(q.id)), fitted = A.model.fitted();
  const vals = list.map((q) => A.model.like(q)), me = A.model.like(p);
  const bins = 20, counts = new Array(bins).fill(0);
  for (const v of vals) counts[Math.min(bins - 1, Math.floor(v * bins))]++;
  const gx = 12, gw = W - 24, gy = 16, gh = H - 44, mx = Math.max(...counts), bw = gw / bins, face = A.faceCanvas(p, 22, { layers: false });
  const paint = (k) => {
    x.clearRect(0, 0, W, H);
    x.fillStyle = "rgba(111,108,99,.5)"; x.fillRect(gx, gy + gh, gw, 1);
    const kb = ez(seg(k, 0, 0.65));
    counts.forEach((n, i) => {
      if (!n) return; const h = (n / mx) * (gh - 8) * kb, bx = gx + i * bw + 1.5, by = gy + gh - h;
      if (fitted) { x.fillStyle = AMD + ".75)"; x.fillRect(bx, by, bw - 3, h); }
      else if (h > 2) { x.setLineDash([3, 3]); x.strokeStyle = AMD + ".8)"; x.lineWidth = 1; x.strokeRect(bx + 0.5, by + 0.5, bw - 4, h - 1); x.setLineDash([]); }
    });
    const km = ez(seg(k, 0.55, 1)); if (km <= 0) return;
    const mxX = gx + me * gw, top = gy - 6 - (1 - km) * 30;
    x.globalAlpha = km; x.strokeStyle = G; x.lineWidth = 2; x.beginPath(); x.moveTo(mxX, top + 20); x.lineTo(mxX, gy + gh); x.stroke();
    x.drawImage(face, clamp(mxX - 11, gx, gx + gw - 22), top, 22, 22); x.globalAlpha = 1;
    axisText(x, "less", gx, H - 8); axisText(x, "more", gx + gw, H - 8, "right");
  };
  const beat = vals.filter((v) => v < me).length, pct = Math.round((beat / Math.max(1, vals.length - 1)) * 100);
  const say = fitted ? `It thinks you'd pick it over ${pct}% of the bank.` : "A guess until 6 picks.";
  return { title: `${p.name} · what it thinks`, fig: c, paint, dur: 1.5, say, alt: `Liking for ${p.name} against the bank` };
}

// The pair: the pool flickers like a draw, then two dots lift out as A and B.
function pair() {
  const names = [...document.querySelectorAll(".ev-card .ev-name")].map((n) => n.textContent);
  const a = A.find(names[0]), b = A.find(names[1]);
  const pool = [...A.pool].map((id) => A.byId.get(id)).filter((p) => p && !A.state.cut.has(p.id));
  const [c, x] = frame(), pad = 18;
  const pos = (p) => [pad + p.xy[0] * (W - 2 * pad), pad + (1 - p.xy[1]) * (H - 2 * pad - 10)];
  const paint = (k, t) => {
    x.clearRect(0, 0, W, H);
    const flick = k < 0.55 ? Math.floor(t * 18) : -1;
    for (const p of A.presets) {
      if (A.state.cut.has(p.id)) continue; const [px, py] = pos(p), inPool = A.pool.has(p.id);
      const lit = inPool && flick >= 0 && ((p.id * 7 + flick * 13) % pool.length) < 2;
      x.beginPath(); x.arc(px, py, lit ? 3.4 : 2, 0, 7); x.fillStyle = lit ? G : inPool ? GD + ".6)" : "rgba(111,108,99,.3)"; x.fill();
    }
    const kl = ez(seg(k, 0.55, 1)); if (kl <= 0) return;
    for (const [p, L] of [[a, "A"], [b, "B"]]) {
      if (!p) continue; const [px, py0] = pos(p), py = py0 - kl * 6;
      x.beginPath(); x.arc(px, py, 2 + kl * 2.4, 0, 7); x.fillStyle = G; x.shadowColor = GD + ".9)"; x.shadowBlur = 10 * kl; x.fill(); x.shadowBlur = 0;
      x.beginPath(); x.arc(px, py, 4 + kl * 5, 0, 7); x.strokeStyle = `rgba(226,221,209,${kl})`; x.lineWidth = 1.5; x.stroke();
      x.globalAlpha = kl; capsText(x, L, px, py - 14, "center", SILK); x.globalAlpha = 1;
    }
    axisText(x, `pool of ${pool.length}`, W - 8, H - 6, "right", MUTE);
  };
  return { title: "Why these two", fig: c, paint, dur: 1.6, say: "Drawn at random from the pool: a fair test of its forecast.", alt: "The pool, with this pair drawn from it" };
}

// The map: its two directions draw themselves in, named by the features.
const WORDS = {
  "centroid_mean": ["brighter", "darker"], "centroid_std": ["more movement", "steadier"], "rolloff_mean": ["more air", "duller"],
  "flatness_mean": ["noisier", "purer"], "flux_mean": ["more restless", "calmer"], "zcr_mean": ["fizzier", "rounder"],
  "rms_mean": ["louder", "quieter"], "rms_std": ["more dynamic", "more even"], "crest": ["punchier", "smoother"],
  "attack_s": ["slower attack", "sharper attack"], "tail_ratio": ["longer tail", "shorter tail"], "bass_fraction": ["heavier", "lighter"],
  "held_centroid_std": ["more movement", "steadier"], "high_ratio": ["stronger up high", "choked up high"], "chord_flatness_delta": ["rougher chords", "cleaner chords"],
  "motion_slow": ["slow movement", "no slow movement"], "motion_mid": ["more wobble", "less wobble"], "motion_fast": ["fast flutter", "no flutter"],
};
function axisWords(k) {
  const n = A.presets.length, names = A.D.phi_names, mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const xs = A.presets.map((p) => p.xy[k]), mx = mean(xs);
  const r = names.map((nm, j) => {
    const zs = A.presets.map((p) => p.z[j]), mz = mean(zs); let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (zs[i] - mz); sxx += (xs[i] - mx) ** 2; syy += (zs[i] - mz) ** 2; }
    return { key: nm.split(":")[0], r: sxy / Math.sqrt(sxx * syy + 1e-12) };
  }).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  const top = []; for (const f of r) { const w = WORDS[f.key]; if (!w) continue; const word = f.r > 0 ? w[0] : w[1], anti = f.r > 0 ? w[1] : w[0]; if (!top.some((t) => t.word === word)) top.push({ word, anti }); if (top.length === 2) break; }
  return { hi: top.map((t) => t.word).join(", "), lo: top.map((t) => t.anti).join(", ") };
}
function map() {
  const [c, x] = frame(), pad = 14, gx = pad + 8, gw = W - 2 * pad - 8, gy = 20, gh = H - 46;
  const X = axisWords(0), Y = axisWords(1);
  const paint = (k) => {
    x.clearRect(0, 0, W, H);
    for (const p of A.presets) { if (A.state.cut.has(p.id)) continue; const px = gx + p.xy[0] * gw, py = gy + (1 - p.xy[1]) * gh; x.beginPath(); x.arc(px, py, 2, 0, 7); x.fillStyle = p.id === A.state.inHand ? G : GD + ".45)"; x.fill(); }
    const kx = ez(seg(k, 0, 0.5)), ky = ez(seg(k, 0.3, 0.8)), kw = seg(k, 0.6, 1);
    x.strokeStyle = "rgba(226,221,209,.75)"; x.lineWidth = 1.2;
    if (kx > 0) { const ex = gx + gw * kx; x.beginPath(); x.moveTo(gx, gy + gh + 8); x.lineTo(ex, gy + gh + 8); x.moveTo(ex - 5, gy + gh + 5); x.lineTo(ex, gy + gh + 8); x.lineTo(ex - 5, gy + gh + 11); x.stroke(); }
    if (ky > 0) { const ey = gy + gh - gh * ky; x.beginPath(); x.moveTo(gx - 8, gy + gh); x.lineTo(gx - 8, ey); x.moveTo(gx - 11, ey + 5); x.lineTo(gx - 8, ey); x.lineTo(gx - 5, ey + 5); x.stroke(); }
    x.globalAlpha = kw; axisText(x, X.hi + " →", gx + gw, H - 6, "right", SILK); axisText(x, "↑ " + Y.hi, gx - 4, 13, "left", SILK); x.globalAlpha = 1;
  };
  return { title: "What the map's directions mean", fig: c, paint, dur: 1.5, say: `Right: ${X.hi}. Up: ${Y.hi}.`, alt: `The map: rightward is ${X.hi}, upward is ${Y.hi}` };
}

// The vessel: the spectrum, measured against the bank, folds upright into the face.
function vessel(p) {
  const [c, x] = frame();
  const fx = A.fxOf(p.id), resp = A.audio.responseDb(fx), row = p.ltas_db.map((v, i) => v + resp[i]), mx = Math.max(...row);
  const raw = row.map((v) => clamp((v - mx + 60) / 60, 0, 1)), dev = A.audio.devFor(p), wh = A.smooth(dev, 1).map((d) => A.sig(d * 1.4));
  const sx = (i) => 22 + (i / (NB - 1)) * (W - 44), base = H - 22, sh = H - 44;
  const vh = H - 20, vw = vh * 0.6, cx = W / 2, vy = (i) => 10 + vh - (i / (NB - 1)) * vh;
  const paint = (k) => {
    x.clearRect(0, 0, W, H);
    const k1 = seg(k, 0, 0.25), k2 = ez(seg(k, 0.25, 0.5)), k3 = ez(seg(k, 0.55, 0.85)), k4 = seg(k, 0.85, 1);
    const label = k < 0.25 ? "its spectrum" : k < 0.55 ? "against the average" : "stood upright";
    capsText(x, label, 12, 14, "left", DIM);
    if (k2 > 0 && k3 < 1) { x.globalAlpha = 1 - k3; x.setLineDash([3, 3]); x.strokeStyle = "rgba(161,156,144,.8)"; x.lineWidth = 1; x.beginPath(); x.moveTo(sx(0), base - 0.5 * sh); x.lineTo(sx(NB - 1), base - 0.5 * sh); x.stroke(); x.setLineDash([]); x.globalAlpha = 1; }
    const pt = (i, side) => {
      const a = raw[i] + (wh[i] - raw[i]) * k2;           // spectrum → against the bank
      const px = sx(i), py = base - a * sh;                 // lying down
      const qx = cx + side * wh[i] * (vw / 2), qy = vy(i);  // stood up
      return [px + (qx - px) * k3, py + (qy - py) * k3];
    };
    const n = k3 > 0 ? NB : Math.max(2, Math.round(NB * k1));
    x.beginPath(); for (let i = 0; i < n; i++) { const [px, py] = pt(i, 1); i ? x.lineTo(px, py) : x.moveTo(px, py); } glowLine(x, 1.8);
    if (k3 > 0) { x.globalAlpha = k3; x.beginPath(); for (let i = 0; i < NB; i++) { const [px, py] = pt(i, -1); i ? x.lineTo(px, py) : x.moveTo(px, py); } glowLine(x, 1.8); x.globalAlpha = 1; }
    if (k4 > 0) { x.globalAlpha = k4; A.face(x, vh, p, { box: { x: cx - vw / 2, y: 10, w: vw, h: vh }, dev, glow: 10, lw: 1.4 }); x.globalAlpha = 1; }
    if (k3 < 0.2) { x.globalAlpha = 1 - k3 * 5; axisText(x, "low", sx(0), H - 6); axisText(x, "high", sx(NB - 1), H - 6, "right"); x.globalAlpha = 1; }
  };
  return { title: `${p.name} · its face`, fig: c, paint, dur: 2.4, say: "Its spectrum, against the average sound, stood upright.", alt: `How ${p.name}'s face is computed` };
}

// plays a figure's cause, then holds
let anim = 0;
function run(a) {
  cancelAnimationFrame(anim);
  if (A.reduced) { a.paint(1, 0); return; }
  const t0 = performance.now();
  const tick = (now) => {
    const t = (now - t0) / 1000, k = Math.min(1, t / a.dur);
    a.paint(k, t);
    if (pop.classList.contains("on") && (k < 1 || a.loop)) anim = requestAnimationFrame(tick);
  };
  anim = requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- the lesson: what a filter does
const lesson = el("div", { class: "lesson", role: "dialog", "aria-modal": "true", "aria-labelledby": "lesson-title" });
document.body.append(lesson);
let step = 0, saved = null, lessonReturn = null, lraf = 0;
const STEPS = 3;
function openLesson() {
  const p = A.inHand();
  saved = { id: p.id, bright: A.fxOf(p.id).bright };
  lessonReturn = document.activeElement; step = 0;
  lesson.classList.add("on"); renderLesson();
}
function closeLesson(restore) {
  if (!lesson.classList.contains("on")) return;
  cancelAnimationFrame(lraf); lraf = 0;
  if (restore && saved) setBright(saved.id, saved.bright);
  if (A.audio.playingId === saved?.id) A.audio.stopPhrase();
  lesson.classList.remove("on"); saved = null;
  lessonReturn?.focus?.({ preventScroll: true });
}
function setBright(id, v) { const fx = A.fxOf(id); fx.bright = v; A.audio.apply(fx, A.byId.get(id)); A.emit("fx", { id: "bright", v }); }
const cutOf = (b) => 350 * Math.pow(18000 / 350, clamp(b, 0, 0.5) / 0.5);
const brightOf = (f) => 0.5 * (Math.log(f / 350) / Math.log(18000 / 350));
function renderLesson() {
  const p = A.byId.get(saved.id);
  const [vc, vx] = A.canvas(200, 300); vc.className = "lesson-vessel";
  const drawV = () => {
    vx.clearRect(0, 0, 200, 300); const h = 270, w = h * 0.6, box = { x: (200 - w) / 2, y: 12, w, h };
    A.face(vx, h, p, { box, dev: A.audio.devFor(p), glow: 16, lw: 1.8, live: A.audio.playingId === p.id ? A.audio.liveDev() : null });
    if (step === 1) {
      // the cutoff on the vessel: everything above it is what the filter takes away
      const b = A.fxOf(p.id).bright, f = cutOf(b), y = bandY(A.bandOfHz(f), box);
      if (b < 0.495) { vx.fillStyle = "rgba(7,8,10,.55)"; vx.fillRect(0, 0, 200, y); }
      vx.fillStyle = SILK; vx.fillRect(box.x - 18, y - 0.75, box.w + 36, 1.5);
      vx.beginPath(); vx.arc(box.x - 18, y, 3.5, 0, 7); vx.fill();
    }
  };
  const loop = () => { drawV(); if (lesson.classList.contains("on") && A.audio.playingId === p.id) lraf = requestAnimationFrame(loop); else lraf = 0; };
  const play = el("button", { class: "btn", type: "button", onclick: () => { A.audio.toggle(p); setTimeout(() => { playLabel(); if (!lraf) loop(); }, 60); } });
  const playLabel = () => { play.innerHTML = A.audio.playingId === p.id ? `${icon("stop")}Stop` : `${icon("play")}Play ${p.name}`; };
  playLabel(); drawV();
  const body = el("div", { class: "lesson-body" });
  if (step === 0) {
    body.append(el("h2", { class: "lesson-h", id: "lesson-title" }, "A sound has a shape"),
      el("p", {}, `This is ${p.name}. Low frequencies sit at the base, high ones at the top.`),
      el("p", {}, "Where the shape is wide, the sound has more energy than most sounds; where it is narrow, less."),
      el("p", { class: "lesson-try" }, "Play it, and watch the bright line: that is what you hear, now."), play);
  } else if (step === 1) {
    // a filter you can drag: its cutoff on a frequency axis, driving BRIGHT
    const FW = 320, FH = 150, [fc, fxc] = A.canvas(FW, FH);
    fc.className = "lesson-filter"; fc.tabIndex = 0; fc.setAttribute("role", "slider");
    fc.setAttribute("aria-label", "Filter cutoff"); fc.setAttribute("aria-valuemin", "350"); fc.setAttribute("aria-valuemax", "18000");
    const lo = Math.log(100), hi = Math.log(20000), xOf = (f) => 16 + ((Math.log(f) - lo) / (hi - lo)) * (FW - 32), fOf = (px) => Math.exp(lo + ((px - 16) / (FW - 32)) * (hi - lo));
    const drawF = () => {
      const x = fxc, b = A.fxOf(p.id).bright, f = cutOf(b), gy = 14, gh = FH - 44;
      x.clearRect(0, 0, FW, FH);
      x.strokeStyle = HAIR; x.strokeRect(16.5, gy + 0.5, FW - 32, gh);
      const r = A.audio.responseDb({ bright: Math.min(0.5, b), body: 0.5 });
      x.save(); x.beginPath(); x.rect(17, gy, FW - 34, gh); x.clip();
      x.beginPath(); r.forEach((db, i) => { const px = xOf(A.D.bands_hz[i]), py = gy + (clamp(-db, 0, 36) / 36) * gh; i ? x.lineTo(px, py) : x.moveTo(px, py); });
      x.lineTo(xOf(A.D.bands_hz[NB - 1]), gy + gh); x.lineTo(xOf(A.D.bands_hz[0]), gy + gh); x.closePath();
      x.fillStyle = GD + ".14)"; x.fill(); x.strokeStyle = G; x.lineWidth = 2; x.shadowColor = GD + ".6)"; x.shadowBlur = 8; x.stroke(); x.shadowBlur = 0;
      x.restore();
      const cx = xOf(f); x.fillStyle = SILK; x.fillRect(cx - 1, gy - 4, 2, gh + 8);
      x.beginPath(); x.arc(cx, gy - 4, 6, 0, 7); x.fillStyle = SILK; x.fill();
      axisText(x, "100 Hz", 16, FH - 8); axisText(x, "1 kHz", xOf(1000), FH - 8, "center"); axisText(x, "10 kHz", xOf(10000), FH - 8, "center");
      const roomLeft = cx - 16 > 120;
      axisText(x, "cutoff " + fmtHz(f), roomLeft ? cx - 10 : cx + 10, gy + gh - 10, roomLeft ? "right" : "left", SILK);
      fc.setAttribute("aria-valuenow", String(Math.round(f))); fc.setAttribute("aria-valuetext", `cutoff ${fmtHz(f)}`);
    };
    const setF = (f) => { setBright(p.id, clamp(brightOf(clamp(f, 350, 18000)), 0, 0.5)); drawF(); drawV(); };
    let drag = false;
    fc.addEventListener("pointerdown", (e) => { drag = true; fc.setPointerCapture(e.pointerId); const r = fc.getBoundingClientRect(); setF(fOf(e.clientX - r.left)); });
    fc.addEventListener("pointermove", (e) => { if (!drag) return; const r = fc.getBoundingClientRect(); setF(fOf(e.clientX - r.left)); });
    fc.addEventListener("pointerup", () => { drag = false; }); fc.addEventListener("pointercancel", () => { drag = false; });
    fc.addEventListener("keydown", (e) => { const f = cutOf(A.fxOf(p.id).bright); if (e.key === "ArrowLeft" || e.key === "ArrowDown") { setF(f / 1.12); e.preventDefault(); e.stopPropagation(); } else if (e.key === "ArrowRight" || e.key === "ArrowUp") { setF(f * 1.12); e.preventDefault(); e.stopPropagation(); } });
    if (A.fxOf(p.id).bright > 0.5) setBright(p.id, 0.5);
    drawF();
    body.append(el("h2", { class: "lesson-h", id: "lesson-title" }, "A filter lets some through"),
      el("p", {}, "This lowpass filter keeps everything below its cutoff and cuts what is above."),
      fc, el("p", { class: "lesson-try" }, "Drag the cutoff down while it plays: the top of the shape narrows, and the sound darkens."), play);
  } else {
    body.append(el("h2", { class: "lesson-h", id: "lesson-title" }, "What to remember"),
      el("ul", { class: "lesson-list" },
        el("li", {}, "A lowpass filter keeps the lows and cuts the highs."),
        el("li", {}, "Its cutoff is where the cutting starts."),
        el("li", {}, "BRIGHT turns a filter like this one, on any sound."),
        el("li", {}, "The shape shows it: the top of the vessel is the sound's highs.")),
      el("p", { class: "lesson-try" }, "Done puts BRIGHT back where it was."));
  }
  const pips = el("div", { class: "lesson-pips", "aria-hidden": "true" }, ...Array.from({ length: STEPS }, (_, i) => el("i", { class: i <= step ? "on" : "" })));
  const nav = el("div", { class: "lesson-nav" }, pips,
    el("span", { class: "lesson-count mono" }, `${step + 1} of ${STEPS}`),
    el("button", { class: "btn ghost", type: "button", disabled: step === 0, onclick: () => { step--; renderLesson(); } }, "Back"),
    step < STEPS - 1 ? el("button", { class: "btn", type: "button", onclick: () => { step++; renderLesson(); }, html: `Next<kbd>↵</kbd>` })
      : el("button", { class: "btn primary", type: "button", onclick: () => closeLesson(true), html: "Done" }));
  lesson.replaceChildren(el("div", { class: "lesson-panel", "data-step": String(step) },
    el("div", { class: "lesson-top" }, el("span", { class: "cap" }, "Learn · what a filter does"), el("button", { class: "ask-x", type: "button", "aria-label": "Close (esc)", onclick: () => closeLesson(true), html: icon("x") })),
    el("div", { class: "lesson-main" }, vc, body), nav));
  if (A.audio.playingId === p.id && !lraf) loop();
  (lesson.querySelector(".lesson-filter") || lesson.querySelector(".lesson-nav .btn:last-child")).focus({ preventScroll: true });
}
lesson.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.target.closest("button") && step < STEPS - 1) { step++; renderLesson(); e.preventDefault(); e.stopPropagation(); }
  if (e.key === "Tab") { const f = [...lesson.querySelectorAll("button:not([disabled]), [tabindex='0']")]; if (!f.length) return; const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { f[f.length - 1].focus(); e.preventDefault(); } else if (!e.shiftKey && i === f.length - 1) { f[0].focus(); e.preventDefault(); } }
  if (!["Escape", "Tab", " ", "Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) e.stopPropagation();
});
A.on("stop", () => { const b = lesson.querySelector(".lesson-body .btn"); if (b && saved) b.innerHTML = `${icon("play")}Play ${A.byId.get(saved.id).name}`; });
A.ask.lesson = openLesson;
A.ask.step = (n) => { step = n; renderLesson(); };
A.cmd({ id: "ask-filter", label: "Learn: what a filter does", icon: "teach", run: openLesson });
A.cmd({ id: "ask-face", label: "How a sound's face is drawn", key: "?", icon: "ask", run: () => ask(document.querySelector(".inhand")) });

// ---------------------------------------------------------------- styles
const css = `
.ask-lin { display:grid; gap:8px; margin-top:8px; }
.ask-lin-list { margin:0; padding:0; list-style:none; display:grid; gap:3px; font-size:12px; color:var(--silk-dim); }
.ask-lin-note { margin:0; font-size:11px; color:var(--silk-dim); }
.ask-lin-rated { margin:0; font-size:13px; line-height:1.4; }
.ask-lin-gone { align-self:center; font-size:12px; color:var(--silk-dim); }
.ask-lin-play { display:flex; gap:8px; flex-wrap:wrap; }
.ask-lin-play .btn { height:34px; padding-inline:12px; text-transform:none; letter-spacing:.02em; font:500 13px/1 var(--f-silk); }
.ask-sw { display:flex; gap:4px; margin:8px 0 2px; }
.ask-sw button { flex:1; min-width:0; height:30px; border-radius:8px; border:1px solid var(--hair); font:600 9px/1 var(--f-silk); letter-spacing:.12em; text-transform:uppercase; color:var(--silk-dim); }
.ask-sw button:hover { color:var(--silk); border-color:var(--hair-hi); }
.ask-sw button[aria-pressed="true"] { color:var(--green); border-color:var(--green-deep); background:rgba(142,240,177,.06); }
@media (pointer: coarse) { .ask-sw button { height:40px; font-size:10px; } }
.ask-chip { position:fixed; z-index:64; width:20px; height:20px; border-radius:50%; display:grid; place-items:center;
  font:600 11px/1 var(--f-silk); color:var(--silk); background:var(--plate); border:1px solid var(--hair-hi);
  box-shadow:0 4px 12px -4px rgba(0,0,0,.8); opacity:0; transform:scale(.8); pointer-events:none;
  transition:opacity var(--d-state), transform var(--d-state) var(--e-settle), border-color var(--d-press); }
.ask-chip.on { opacity:1; transform:none; pointer-events:auto; }
.ask-chip:hover { border-color:var(--green-dim); color:var(--green); }
.ask-ring { position:fixed; z-index:95; width:64px; height:64px; margin:-32px 0 0 -32px; border-radius:50%; pointer-events:none; opacity:0;
  background:conic-gradient(var(--green) calc(var(--k, 0) * 1turn), rgba(142,240,177,.12) 0); -webkit-mask:radial-gradient(circle, transparent 27px, #000 28px); mask:radial-gradient(circle, transparent 27px, #000 28px); }
@property --k { syntax:"<number>"; inherits:false; initial-value:0; }
.ask-ring.on { opacity:1; animation:askhold 340ms linear forwards; }
.ask-ring.hint { opacity:0; animation:askhint 900ms var(--e-settle); --k:.45; }
.ask-ring.done { animation:askdone 260ms var(--e-settle) forwards; --k:1; }
@keyframes askhold { from { --k:0; } to { --k:1; } }
@keyframes askhint { 0% { opacity:.9; } 100% { opacity:0; transform:scale(1.15); } }
@keyframes askdone { 0% { opacity:1; } 100% { opacity:0; transform:scale(1.35); } }
@media (prefers-reduced-motion: reduce) { .ask-ring.on { animation:none; --k:1; } }
.ask-pop { position:fixed; z-index:66; width:min(360px, calc(100vw - 24px)); padding:12px 14px 14px; border-radius:var(--r3);
  background:var(--panel-hi); border:1px solid var(--hair-hi); box-shadow:0 24px 60px -20px rgba(0,0,0,.85), 0 0 0 1px rgba(0,0,0,.4);
  display:none; outline:none; }
.ask-pop:focus-visible { outline:none; }
.ask-pop[data-side]::before { content:""; position:absolute; width:10px; height:10px; background:var(--panel-hi); border:1px solid var(--hair-hi); transform:rotate(45deg); }
.ask-pop[data-side="below"]::before { top:-6px; left:calc(var(--cx) - 5px); border-right:0; border-bottom:0; }
.ask-pop[data-side="above"]::before { bottom:-6px; left:calc(var(--cx) - 5px); border-left:0; border-top:0; }
.ask-pop[data-side="right"]::before { left:-6px; top:calc(var(--cy) - 5px); border-top:0; border-right:0; }
.ask-pop[data-side="left"]::before { right:-6px; top:calc(var(--cy) - 5px); border-bottom:0; border-left:0; }
.ask-pop.on { display:grid; gap:10px; animation:askin var(--d-state) var(--e-settle); }
@keyframes askin { from { opacity:0; transform:translateY(4px); } }
.ask-head { display:flex; justify-content:space-between; align-items:center; gap:8px; }
.ask-head .cap { color:var(--silk); }
.ask-x { width:26px; height:26px; border-radius:50%; display:grid; place-items:center; color:var(--silk-mute); }
.ask-x:hover { color:var(--silk); background:var(--plate); }
.ask-x svg { width:14px; height:14px; }
.ask-fig { display:block; border-radius:var(--r2); background:var(--void); border:1px solid var(--hair); max-width:100%; height:auto !important; }
.ask-say { margin:0; font-size:14px; line-height:1.45; color:var(--silk); max-width:34ch; }
.ask-learn { justify-self:start; height:34px; }
.ask-learn .sub { margin-left:2px; }
.lesson { position:fixed; inset:0; z-index:72; display:none; place-items:center; background:rgba(4,5,6,.66); backdrop-filter:blur(3px); padding:16px; }
.lesson.on { display:grid; animation:fade var(--d-state) var(--e-settle); }
.lesson-panel { width:min(760px, 100%); background:var(--panel); border:1px solid var(--hair-hi); border-radius:var(--r3); padding:18px 22px 18px;
  box-shadow:0 30px 80px -20px rgba(0,0,0,.85); display:grid; gap:14px; }
.lesson-top { display:flex; justify-content:space-between; align-items:center; }
.lesson-main { display:grid; grid-template-columns:200px minmax(0,1fr); gap:28px; align-items:center; min-height:320px; }
.lesson-vessel { border-radius:var(--r2); background:radial-gradient(120% 90% at 50% 60%, #0d1411 0%, var(--void) 62%); border:1px solid var(--hair); }
.lesson-body { display:grid; gap:12px; align-content:center; min-width:0; }
.lesson-body p { margin:0; color:var(--silk-dim); max-width:46ch; }
.lesson-h { font:500 26px/1.15 var(--f-silk); margin:0 0 2px; text-wrap:balance; }
.lesson-try { color:var(--silk) !important; }
.lesson-body .btn { justify-self:start; }
.lesson-filter { border-radius:var(--r2); background:var(--void); border:1px solid var(--hair); cursor:ew-resize; touch-action:none; max-width:100%; }
.lesson-list { margin:0; padding-left:18px; display:grid; gap:8px; color:var(--silk); }
.lesson-nav { display:flex; align-items:center; gap:10px; border-top:1px solid var(--hair); padding-top:14px; }
.lesson-pips { display:flex; gap:5px; }
.lesson-pips i { width:7px; height:7px; border-radius:50%; background:var(--hair-hi); }
.lesson-pips i.on { background:var(--green); }
.lesson-count { font-size:12px; color:var(--silk-mute); margin-right:auto; }
body.touch .ask-pop kbd, body.touch .lesson kbd, body.touch .ask-chip { display:none; }
@media (pointer: coarse) { .ask-pop kbd, .lesson kbd { display:none; } }
@media (max-height: 500px) {
  .ask-pop { max-height:calc(100vh - 16px); overflow-y:auto; }
  .ask-fig { max-height:104px; width:auto !important; }
  .lesson { padding:8px; place-items:center; }
  .lesson-panel { max-height:calc(100vh - 16px); overflow-y:auto; padding:10px 16px; gap:8px; border-radius:var(--r3); }
  .lesson-main { grid-template-columns:96px minmax(0,1fr) !important; justify-items:stretch !important; min-height:0; gap:14px; align-items:start; }
  .lesson-vessel { width:96px !important; height:144px !important; }
  .lesson-h { font-size:20px; }
  .lesson-body { gap:6px; }
  .lesson-body > p:not(.lesson-try) { display:none; }
  .lesson-filter { max-height:120px; width:auto !important; }
  .lesson-nav { padding-top:8px; }
}
@media (max-width: 700px) {
  .ask-pop { left:0 !important; right:0; top:auto !important; bottom:0; width:100%; border-radius:18px 18px 0 0; z-index:90; padding:14px 16px calc(18px + env(safe-area-inset-bottom, 0px)); }
  .ask-pop .ask-fig { width:100% !important; }
  .ask-say { max-width:none; }
  .lesson { padding:0; place-items:end stretch; }
  .lesson-panel { border-radius:18px 18px 0 0; max-height:92vh; overflow-y:auto; padding:16px 16px calc(16px + env(safe-area-inset-bottom, 0px)); }
  .lesson-main { grid-template-columns:1fr; justify-items:center; gap:16px; min-height:0; }
  .lesson-vessel { width:120px !important; height:180px !important; }
  .lesson-panel[data-step="1"] .lesson-main { grid-template-columns:88px minmax(0,1fr); justify-items:stretch; align-items:start; gap:12px; }
  .lesson-panel[data-step="1"] .lesson-vessel { width:88px !important; height:132px !important; position:sticky; top:0; }
  .lesson-panel[data-step="1"] .lesson-h { font-size:21px; }
  .lesson-panel[data-step="1"] .lesson-body > p:not(.lesson-try) { display:none; }
  .lesson-panel[data-step="1"] .lesson-filter { grid-column:1 / -1; }
}
`;
document.head.append(el("style", {}, css));
})();
