// LEARNING: the model room. How it learns your taste, for whoever wants to see
// inside: what it weighs, how each pick moves it, which way liking rises on the
// map, and how honest its forecasts have been.
(() => {
"use strict";
const { el, icon } = A;
const NAMES = A.D.phi_names;
const tech = (n) => n.replace(/:p\d+$/, "");
// Each feature in a word a musician uses; the technical name stays beside it.
const WORD = {
  centroid_mean: "brightness", centroid_std: "brightness moving", rolloff_mean: "top end", flatness_mean: "noisiness",
  flux_mean: "restlessness", zcr_mean: "fizz", rms_mean: "level", rms_std: "dynamics", crest: "punch",
  attack_s: "attack time", tail_ratio: "tail", bass_fraction: "weight", held_centroid_std: "movement",
  high_ratio: "high notes", chord_flatness_delta: "chord roughness", motion_slow: "slow drift",
  motion_mid: "wobble", motion_fast: "flutter",
};
const word = (n) => WORD[tech(n)] || tech(n);
const sig = (x) => 1 / (1 + Math.exp(-x));

let root, visible = false, rows = [], order = [], barsBox, lineEl, subEl, replayBtn, mapCv, mapX, MW = 0, MH = 0, fcEl, stripCv, stripX, SW = 0;
let shown = A.model.w.slice();          // what the bars currently draw
let curW = A.model.w.slice(), prevW = curW.slice(), prevN = A.model.n; // snapshots around the latest update
let last = null;                         // { from, to, i, d }: the last update, for replay
let unseen = false, ghosts = null, ghostT = 0, anim = 0, hoverI = -1;
let wrapEl, ov, ovX, OW = 0, OH = 0, evid, evCv, evX, show = 0, swing = null, swingRaf = 0, waitMorph = false;
const picks = [], forecasts = [];
let arrowGhost = null, dropT = 0, dropRaf = 0, moreBtn;
let scale = 0.6;

function mount(r) {
  root = r;
  const wrap = el("div", { class: "md" });
  subEl = el("p", { class: "md-sub" });
  const head = el("header", { class: "md-head" },
    el("div", { class: "md-eyebrow" }, el("span", { class: "cap" }, "Learning")),
    el("h1", { class: "display" }, "How it learns"), subEl);

  // what it weighs
  replayBtn = el("button", { class: "btn ghost md-replay", onclick: () => replay(), html: `${icon("again")}<span class="lbl">Replay</span><kbd>R</kbd>`, "aria-label": "Replay the last pick (R)" });
  lineEl = el("p", { class: "sr", "aria-live": "polite" });
  // the evidence: the last pick's two faces, kept and passed. Not drawn until there is one.
  [evCv, evX] = A.canvas(10, 56);
  evid = el("div", { class: "md-evid", "aria-hidden": "true" }, evCv);
  barsBox = el("div", { class: "md-bars", role: "list", "aria-label": "What it weighs, one weight per feature" });
  rows = NAMES.map((n, i) => {
    const bar = el("i", { class: "md-bar" }), ghost = el("i", { class: "md-ghost" }), val = el("span", { class: "md-val mono" });
    const row = el("div", { class: "md-row", role: "listitem", tabindex: "0", "data-i": i },
      el("span", { class: "md-name" }, el("span", { class: "md-word" }, word(n)), el("span", { class: "md-tech mono" }, tech(n))),
      el("span", { class: "md-track", "aria-hidden": "true" }, el("i", { class: "md-zero" }), ghost, bar), val);
    const on = () => { hoverI = i; drawMap(); row.classList.add("lit"); };
    const off = () => { if (hoverI === i) hoverI = -1; drawMap(); row.classList.remove("lit"); };
    row.addEventListener("pointerenter", on); row.addEventListener("pointerleave", off);
    row.addEventListener("focus", on); row.addEventListener("blur", off);
    return { row, bar, ghost, val };
  });
  order = NAMES.map((_, i) => i);
  rows.forEach((r) => barsBox.append(r.row));
  barsBox.classList.add("collapsed");
  moreBtn = el("button", { class: "disclose md-more", "aria-expanded": "false", html: `${icon("chev")}<span>All 18 weights</span>` });
  moreBtn.addEventListener("click", () => { const o = moreBtn.getAttribute("aria-expanded") !== "true"; moreBtn.setAttribute("aria-expanded", String(o)); barsBox.classList.toggle("collapsed", !o); moreBtn.querySelector("span").textContent = o ? "The six that weigh most" : "All 18 weights"; });
  const weighs = el("section", { class: "md-panel md-weighs", "aria-label": "What it weighs" },
    el("div", { class: "md-ph" }, el("span", { class: "cap" }, "What it weighs"), replayBtn), lineEl, evid, barsBox, moreBtn,
    el("div", { class: "md-scale mono", "aria-hidden": "true" }, el("span", {}, "likes less"), el("span", {}, "0"), el("span", {}, "likes more")));

  // directions on the map
  [mapCv, mapX] = A.canvas(10, 10); mapCv.setAttribute("role", "img");
  const mapWell = el("div", { class: "well md-map" }, mapCv);
  const mapLegend = el("div", { class: "md-maplegend mono", id: "md-maplegend" });
  const map = el("section", { class: "md-panel md-mapp", "aria-label": "Where liking rises" },
    el("div", { class: "md-ph" }, el("span", { class: "cap" }, "Where liking rises"), mapLegend), mapWell);

  // forecasts
  [stripCv, stripX] = A.canvas(10, 44); stripCv.setAttribute("role", "img");
  fcEl = el("div", { class: "md-fc", "aria-live": "polite" });
  const fc = el("section", { class: "md-panel md-fcp", "aria-label": "Forecasts" },
    el("div", { class: "md-ph" }, el("span", { class: "cap" }, "Its forecasts")), fcEl, el("div", { class: "md-strip" }, stripCv));

  // export and the math (level 3)
  const ta = el("textarea", { class: "md-json mono", readonly: true, "aria-label": "The data, as JSON", hidden: true });
  const copy = el("button", { class: "btn md-copy", onclick: () => exportJson(ta, copy), html: `${icon("share")}Copy as JSON` });
  const mathBtn = el("button", { class: "disclose", "aria-expanded": "false", "aria-controls": "md-math", html: `${icon("chev")}The math` });
  const math = el("div", { class: "md-math", id: "md-math", hidden: true },
    el("code", { class: "mono" }, "P(A beats B) = σ(w · (φA − φB))"),
    el("p", {}, "φ is a sound's features, standardized; w is one weight per feature. A pick moves w along φ(kept) − φ(passed), so every sound's rating moves at once, not only the two you heard."),
    el("p", {}, "In the app, φ is 18 audio and 26 structural features, and w is a posterior of 500 draws: reweighted with every pick, fitted again every six. It also grows lenses, one more for every 20 picks up to five, and rates a sound by its best lens. Here, a single w over the 18 audio features."));
  mathBtn.addEventListener("click", () => { const o = mathBtn.getAttribute("aria-expanded") !== "true"; mathBtn.setAttribute("aria-expanded", String(o)); math.hidden = !o; });
  const foot = el("div", { class: "md-foot" }, el("div", { class: "md-footrow" }, copy, mathBtn), math, ta);

  const right = el("div", { class: "md-right" }, map, fc, foot);
  [ov, ovX] = A.canvas(10, 10); ov.className = "md-ov"; ov.setAttribute("aria-hidden", "true");
  wrap.append(head, el("div", { class: "md-body" }, weighs, right), ov);
  root.append(wrap); wrapEl = wrap;

  new ResizeObserver(() => { if (visible) resize(); }).observe(mapWell);
  new ResizeObserver(() => { if (visible) resizeStrip(); }).observe(stripCv.parentElement);

  A.on("model", onModel);
  A.on("pick", onPick);
  A.on("inhand", () => { if (visible) drawMap(); });
  A.on("morphstart", () => { if (visible) drawMap(); });
  A.on("morphend", () => { if (!visible) return; drawMap(); if (waitMorph) { waitMorph = false; setTimeout(() => visible && last && play(last), 180); } });
  A.cmd({ id: "md-replay", view: "model", label: "Replay the last pick", key: "R", icon: "again", run: () => replay() });
  A.cmd({ id: "md-copy", view: "model", label: "Copy the data as JSON", icon: "share", run: () => exportJson(ta, copy) });
  A.cmd({ id: "md-math", view: "model", label: "Show the math", icon: "notes", run: () => mathBtn.click() });
  sync(false);
}

// ---- the model changed: snapshot, and watch it think
function onModel() {
  const w = A.model.w.slice();
  const d = w.map((v, i) => v - curW[i]);
  const moved = d.some((x) => Math.abs(x) > 1e-9);
  prevW = curW; prevN = A.model.n; curW = w;
  if (!moved) { sync(false); return; }
  let i = 0; d.forEach((x, k) => { if (Math.abs(x) > Math.abs(d[i])) i = k; });
  last = { from: prevW.slice(), to: w.slice(), i, d: d[i], pick: null };
  const u = last;
  queueMicrotask(() => { if (u !== last) return; if (visible) choreograph(u); else unseen = true; });
}
// Each pick is scored with the weights from before it was learned from.
function onPick({ win, lose }) {
  const score = (p, w) => p.z.reduce((s, z, i) => s + z * w[i], 0);
  const p = sig(score(win, prevW) - score(lose, prevW));
  const fitted = A.model.n - 1 >= 6;
  if (last && !last.pick) last.pick = { win, lose };
  picks.push({ kept: win.name, passed: lose.name });
  forecasts.push({ kept: win.name, passed: lose.name, p_kept: +p.toFixed(3), fitted, hit: p > 0.5 });
  dropT = performance.now();
  if (visible) { syncForecasts(); dropIn(); }
}

// ---- bars
function sync(animated) {
  const n = A.model.n, fitted = A.model.fitted();
  subEl.textContent = fitted ? `From ${n} pick${n === 1 ? "" : "s"}.` : `${6 - n} more pick${6 - n === 1 ? "" : "s"} and it fits. Until then, a guess.`;
  root.querySelector(".md").classList.toggle("guess", !fitted);
  replayBtn.disabled = !last;
  if (last) {
    const s = last.d >= 0 ? "+" : "−";
    lineEl.textContent = `that pick moved ${word(NAMES[last.i])} most (${s}${Math.abs(last.d).toFixed(2)})`;
  } else lineEl.textContent = "";
  drawEvidence();
  if (!animated) { shown = A.model.w.slice(); fitScale(shown); drawBars(shown); resort(false); }
  syncForecasts();
}
// The scale fits the largest weight, and holds still while bars animate.
const fitScale = (...ws) => { scale = Math.max(0.3, Math.max(...ws.flat().map(Math.abs)) / 0.88); };
function drawBars(w) {
  rows.forEach((r, i) => {
    const v = w[i], f = Math.min(1, Math.abs(v) / scale) * 50;
    r.bar.style.left = v >= 0 ? "50%" : 50 - f + "%"; r.bar.style.width = f + "%";
    r.bar.classList.toggle("neg", v < 0);
    r.val.textContent = (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2);
    r.row.setAttribute("aria-label", `${word(NAMES[i])}: ${v >= 0 ? "likes more" : "likes less"}, ${Math.abs(v).toFixed(2)}`);
    if (ghosts) {
      const g = ghosts[i], gf = Math.min(1, Math.abs(g) / scale) * 50, show = Math.abs(g - A.model.w[i]) > 1e-3;
      r.ghost.style.left = g >= 0 ? "50%" : 50 - gf + "%"; r.ghost.style.width = gf + "%"; r.ghost.style.opacity = show ? String(ghostT) : "0";
    } else r.ghost.style.opacity = "0";
  });
}
// Sorted by size, and when the order changes the rows slide (FLIP).
function resort(animated = true) {
  const w = A.model.w, next = NAMES.map((_, i) => i).sort((a, b) => Math.abs(w[b]) - Math.abs(w[a]) || a - b);
  if (next.join() === order.join()) return;
  const before = new Map(rows.map((r) => [r.row, r.row.getBoundingClientRect().top]));
  order = next; order.forEach((i) => barsBox.append(rows[i].row));
  if (!animated || A.reduced) return;
  for (const r of rows) { const dy = before.get(r.row) - r.row.getBoundingClientRect().top; if (Math.abs(dy) > 0.5) r.row.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" }); }
}
function animate(from, to) {
  cancelAnimationFrame(anim);
  ghosts = from.slice(); ghostT = 1; fitScale(from, to);
  const D = A.reduced ? 0 : 700, t0 = performance.now(), ez = (t) => 1 - Math.pow(1 - t, 3);
  const hi = rows[last?.i ?? 0];
  hi?.row.classList.add("moved");
  const tick = (now) => {
    const t = D ? Math.min(1, (now - t0) / D) : 1, k = ez(t);
    shown = from.map((v, i) => v + (to[i] - v) * k);
    drawBars(shown);
    if (t < 1) anim = requestAnimationFrame(tick);
    else { resort(true); fadeGhosts(); setTimeout(() => hi?.row.classList.remove("moved"), 1600); drawMap(); }
  };
  anim = requestAnimationFrame(tick);
}
function fadeGhosts() {
  const t0 = performance.now(), hold = 2600, D = 900;
  const tick = (now) => {
    const t = now - t0; ghostT = t < hold ? 1 : Math.max(0, 1 - (t - hold) / D);
    drawBars(shown);
    if (ghostT > 0 && visible) anim = requestAnimationFrame(tick); else { ghosts = null; drawBars(shown); }
  };
  anim = requestAnimationFrame(tick);
}
function replay() { if (!last) return; play(last); }
// On a phone the room scrolls: if the evidence is out of view, bring it in first.
function play(u) {
  const r = within(evid), top = wrapEl.scrollTop, bottom = top + wrapEl.clientHeight;
  if (wrapEl.scrollHeight > wrapEl.clientHeight + 4 && (r.y < top + 40 || r.y + 300 > bottom)) {
    wrapEl.scrollTo({ top: Math.max(0, r.y - 72), behavior: A.reduced ? "auto" : "smooth" });
    setTimeout(() => visible && choreograph(u), A.reduced ? 0 : 420);
  } else choreograph(u);
}

// ---- watch it think: the pick's two faces fly in, the light of their
// difference flows into the weights it moves, the bars take it, the arrow turns.
const ez3 = (t) => 1 - Math.pow(1 - t, 3), ezio = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// positions in the room's own content coordinates: on a phone the room scrolls, and
// the overlay scrolls with it
const within = (elm) => { const a = elm.getBoundingClientRect(), b = wrapEl.getBoundingClientRect(); return { x: a.left - b.left + wrapEl.scrollLeft, y: a.top - b.top + wrapEl.scrollTop, w: a.width, h: a.height }; };
const shownRow = (i) => rows[i].row.offsetParent !== null;
function sizeOverlay() {
  const d = Math.min(2, devicePixelRatio || 1); OW = wrapEl.clientWidth; OH = Math.max(wrapEl.clientHeight, wrapEl.scrollHeight);
  ov.width = Math.round(OW * d); ov.height = Math.round(OH * d); ov.style.width = OW + "px"; ov.style.height = OH + "px"; ovX.setTransform(d, 0, 0, d, 0, 0);
}
const FS = 40;
const slots = () => { const r = within(evid), cy = r.y + r.h / 2, cx = r.x + r.w / 2; return { kept: { x: cx - 58 - FS / 2, y: cy - FS / 2, w: FS, h: FS }, passed: { x: cx + 58 - FS / 2, y: cy - FS / 2, w: FS, h: FS }, o: { x: cx, y: cy } }; };
function choreograph(u) {
  cancelAnimationFrame(show); cancelAnimationFrame(anim);
  sync(true); fitScale(u.from, u.to);
  const d = u.to.map((v, i) => v - u.from[i]), mx = Math.max(...d.map(Math.abs)) || 1;
  const movers = d.map((v, i) => i).sort((a, b) => Math.abs(d[b]) - Math.abs(d[a])).filter((i) => Math.abs(d[i]) >= mx * 0.12).slice(0, 5);
  lastShown = u.pick;
  if (A.reduced) { shown = u.to.slice(); drawBars(shown); resort(false); drawEvidence(); swingTo(u, 0); movers.forEach((i) => glow(rows[i])); return; }
  evid.classList.toggle("on", !!u.pick);
  shown = u.from.slice(); ghosts = u.from.slice(); ghostT = 1; drawBars(shown); drawEvidence(true);
  sizeOverlay();
  const start = { x: OW / 2 - 30, y: wrapEl.scrollTop + wrapEl.clientHeight + 20, w: 60, h: 60 };
  const devK = u.pick && A.audio.devFor(u.pick.win), devP = u.pick && A.audio.devFor(u.pick.lose);
  // where each mover's light lands: the bar's new end
  const targets = movers.map((i, k) => ({ i, k, wgt: Math.abs(d[i]) / mx, t0: 470 + k * 80, D: 540, hit: false, x: 0, y: 0, set: false }));
  // the light lands on the bar's tip as it is now; the bar then grows from there
  const land = (tg) => {
    if (!shownRow(tg.i)) { const r = within(moreBtn); tg.x = r.x + 14; tg.y = r.y + r.h / 2; tg.hidden = true; tg.set = true; return; }
    const tr = within(rows[tg.i].row.querySelector(".md-track")), v = u.from[tg.i], f = Math.min(1, Math.abs(v) / scale) * 0.5; tg.x = tr.x + tr.w * (0.5 + (v >= 0 ? f : -f)); tg.y = tr.y + tr.h / 2; tg.set = true;
  };
  // when each bar starts to move: a mover when its light arrives, the rest together after
  // the bars without a light of their own settle after the last light lands, so the
  // weights the pick moved most are seen to move first
  const BAR = 520, lastLight = targets.reduce((m, tg) => Math.max(m, tg.t0 + tg.D), 900), startAt = u.to.map(() => lastLight + 60);
  for (const tg of targets) startAt[tg.i] = tg.t0 + tg.D;
  const barsEnd = Math.max(...startAt) + BAR, ARROW = barsEnd - 120, END = ARROW + 900;
  const T0 = performance.now(); let settled = false, swung = false;
  const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k });
  const frame = (now) => {
    const t = now - T0, x = ovX; x.clearRect(0, 0, OW, OH);
    const sl = slots();
    // 1. the faces rise into the room (0 to 620 ms), then hand over to the strip
    if (u.pick) {
      const k = ez3(Math.min(1, t / 620)), fade = t < 1500 ? 1 : Math.max(0, 1 - (t - 1500) / 350);
      if (fade > 0) {
        x.globalAlpha = fade; A.face(x, FS, u.pick.win, { box: lerp(start, sl.kept, k), dev: devK, glow: 12, lw: 1.3 });
        x.globalAlpha = fade * 0.5; A.face(x, FS, u.pick.lose, { box: lerp({ ...start, x: start.x + 60 }, sl.passed, k), dev: devP, glow: 0, lw: 1.1, layers: false });
        x.globalAlpha = 1;
      }
    }
    // 2. their difference, a point of amber light between them
    const o = u.pick ? sl.o : { x: within(evid).x + within(evid).w / 2, y: within(barsBox).y - 6 };
    if (t > 380 && t < 1900) {
      const a = Math.min(1, (t - 380) / 160) * (t > 1600 ? 1 - (t - 1600) / 300 : 1);
      const g = x.createRadialGradient(o.x, o.y, 0, o.x, o.y, 16); g.addColorStop(0, `rgba(255,180,84,${0.9 * a})`); g.addColorStop(1, "rgba(255,180,84,0)");
      x.fillStyle = g; x.beginPath(); x.arc(o.x, o.y, 16, 0, 7); x.fill();
    }
    // 3. the light flows into the weights it moves, strongest into the bar that moves most
    for (const tg of targets) {
      const s = Math.max(0, Math.min(1, (t - tg.t0) / tg.D)); if (s <= 0) continue;
      if (!tg.set) land(tg);
      const tail = t > tg.t0 + tg.D ? Math.max(0, 1 - (t - tg.t0 - tg.D) / 520) : 1; if (tail <= 0) continue;
      const c = { x: o.x + (tg.x - o.x) * 0.15, y: tg.y }, e = ezio(s), N = 28;
      const pt = (q) => ({ x: (1 - q) * (1 - q) * o.x + 2 * (1 - q) * q * c.x + q * q * tg.x, y: (1 - q) * (1 - q) * o.y + 2 * (1 - q) * q * c.y + q * q * tg.y });
      x.lineCap = "round";
      for (let j = 1; j <= N; j++) {
        const q0 = ((j - 1) / N) * e, q1 = (j / N) * e, a = (j / N) * tail;
        const p0 = pt(q0), p1 = pt(q1);
        x.strokeStyle = `rgba(255,180,84,${0.85 * a})`; x.lineWidth = 1 + tg.wgt * 2.6;
        x.beginPath(); x.moveTo(p0.x, p0.y); x.lineTo(p1.x, p1.y); x.stroke();
      }
      const h = pt(e); x.shadowColor = "rgba(255,180,84,.9)"; x.shadowBlur = 12; x.fillStyle = `rgba(255,214,160,${tail})`;
      x.beginPath(); x.arc(h.x, h.y, 2 + tg.wgt * 2, 0, 7); x.fill(); x.shadowBlur = 0;
      if (s >= 1 && !tg.hit) { tg.hit = true; if (tg.hidden) moreBtn.animate?.([{ color: "#ffb454" }, { color: "" }], { duration: 1200 }); else glow(rows[tg.i]); }
    }
    // 4. each bar takes its light: it moves when its light arrives, not before
    if (!settled) {
      shown = u.from.map((v, i) => { const k = Math.max(0, Math.min(1, (t - startAt[i]) / BAR)); return v + (u.to[i] - v) * ez3(k); });
      drawBars(shown);
      if (t >= barsEnd) { settled = true; shown = u.to.slice(); drawBars(shown); resort(true); fadeGhosts(); }
    }
    // 5. then the arrow turns to its new heading, leaving the old one as a ghost
    if (!swung && t >= ARROW) { swung = true; swingTo(u, 760); }
    if (t < END) show = requestAnimationFrame(frame);
    else { x.clearRect(0, 0, OW, OH); drawEvidence(); }
  };
  show = requestAnimationFrame(frame);
}
function glow(r) {
  r.row.classList.add("moved");
  r.bar.animate?.([{ boxShadow: "0 0 0 0 rgba(255,180,84,0)", filter: "brightness(1)" }, { boxShadow: "0 0 18px 3px rgba(255,180,84,.85)", filter: "brightness(1.45)", offset: 0.25 }, { boxShadow: "0 0 8px -2px rgba(255,180,84,.45)", filter: "brightness(1)" }], { duration: 1100, easing: "ease-out" });
  r.val.animate?.([{ color: "#ffb454" }, { color: "#ffb454", offset: 0.6 }, { color: "" }], { duration: 1600 });
  setTimeout(() => r.row.classList.remove("moved"), 1900);
}
let lastShown = null;
// The strip: kept, minus passed. Drawn only once there is a pick.
function drawEvidence(empty = false) {
  if (!evCv) return;
  const pk = lastShown || last?.pick; evid.classList.toggle("on", !!pk);
  const W = Math.max(120, evid.clientWidth), d = Math.min(2, devicePixelRatio || 1);
  evCv.width = Math.round(W * d); evCv.height = Math.round(56 * d); evCv.style.width = W + "px"; evCv.style.height = "56px"; evX.setTransform(d, 0, 0, d, 0, 0);
  evX.clearRect(0, 0, W, 56);
  if (!pk || empty) return;
  const cx = W / 2, cy = 28;
  A.face(evX, FS, pk.win, { box: { x: cx - 58 - FS / 2, y: cy - FS / 2, w: FS, h: FS }, dev: A.audio.devFor(pk.win), glow: 8, lw: 1.2 });
  evX.globalAlpha = 0.45; A.face(evX, FS, pk.lose, { box: { x: cx + 58 - FS / 2, y: cy - FS / 2, w: FS, h: FS }, dev: A.audio.devFor(pk.lose), glow: 0, lw: 1, layers: false }); evX.globalAlpha = 1;
  evX.strokeStyle = "rgba(255,180,84,.8)"; evX.lineWidth = 1.6; evX.beginPath(); evX.moveTo(cx - 7, cy); evX.lineTo(cx + 7, cy); evX.stroke();
}
// The arrow swings from the regression under the old weights to the new.
function swingTo(u, D) {
  const g0 = gradientFor(u.from), g1 = gradientFor(u.to);
  cancelAnimationFrame(swingRaf);
  if (!D || !g0 || !g1) { swing = null; arrowGhost = null; drawMap(); return; }
  const t0 = performance.now(); arrowGhost = { g: g0, t0, D: D + 1800 };
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / D); swing = k < 1 ? { g0, g1, k: ezio(k) } : null; drawMap();
    if (now - t0 < arrowGhost.D) swingRaf = requestAnimationFrame(tick); else { arrowGhost = null; drawMap(); }
  };
  swingRaf = requestAnimationFrame(tick);
}

// ---- where liking rises: least squares of liking on the map's own axes
const gradient = () => gradientFor(A.model.w);
function gradientFor(w) {
  const ps = A.presets.filter((p) => !A.state.cut.has(p.id)), n = ps.length;
  const sc = (p) => p.z.reduce((s, z, i) => s + z * w[i], 0), mid = A.presets.reduce((s, p) => s + sc(p), 0) / A.presets.length;
  const X = ps.map((p) => [1, p.xy[0], p.xy[1]]), y = ps.map((p) => sig(sc(p) - mid));
  const XtX = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], Xty = [0, 0, 0];
  for (let k = 0; k < n; k++) for (let a = 0; a < 3; a++) { Xty[a] += X[k][a] * y[k]; for (let b = 0; b < 3; b++) XtX[a][b] += X[k][a] * X[k][b]; }
  const b = solve3(XtX, Xty); if (!b) return null;
  const mean = y.reduce((s, v) => s + v, 0) / n;
  const ssr = y.reduce((s, v, k) => s + (v - mean) ** 2, 0), sse = y.reduce((s, v, k) => s + (v - (b[0] + b[1] * X[k][1] + b[2] * X[k][2])) ** 2, 0);
  return { gx: b[1], gy: b[2], r2: ssr > 1e-12 ? 1 - sse / ssr : 0 };
}
function solve3(M, v) {
  const a = M.map((r, i) => [...r, v[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) return null; [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < 3; r++) if (r !== c) { const f = a[r][c] / a[c][c]; for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k]; }
  }
  return a.map((r, i) => r[3] / r[i]);
}
const PAD = 28;
const mapPos = (p) => [PAD + p.xy[0] * (MW - 2 * PAD), PAD + (1 - p.xy[1]) * (MH - 2 * PAD)];
function resize() {
  // layout size, not the on-screen box: the view may be mid-zoom (scaled) when this runs
  const wl = mapCv.parentElement, d = Math.min(2, devicePixelRatio || 1);
  MW = Math.max(160, wl.clientWidth); MH = Math.max(120, wl.clientHeight);
  mapCv.width = Math.round(MW * d); mapCv.height = Math.round(MH * d); mapCv.style.width = MW + "px"; mapCv.style.height = MH + "px";
  mapX.setTransform(d, 0, 0, d, 0, 0); drawMap();
}
const FACE = 22;
function drawMap() {
  if (!MW || !visible) return;
  const x = mapX, fitted = A.model.fitted(); x.clearRect(0, 0, MW, MH);
  // a quiet grid
  x.fillStyle = "rgba(38,43,51,.9)";
  for (let gx = PAD; gx <= MW - PAD + 0.5; gx += (MW - 2 * PAD) / 6) for (let gy = PAD; gy <= MH - PAD + 0.5; gy += (MH - 2 * PAD) / 4) x.fillRect(gx - 0.75, gy - 0.75, 1.5, 1.5);
  const ps = A.presets.filter((p) => !A.state.cut.has(p.id));
  const hz = hoverI >= 0 ? ps.map((p) => p.z[hoverI]) : null, zm = hz ? Math.max(1e-6, ...hz.map(Math.abs)) : 1;
  ps.forEach((p, k) => {
    const [px, py] = mapPos(p);
    if (fitted && hoverI < 0) { const l = A.model.like(p); const g = x.createRadialGradient(px, py, 0, px, py, 5 + l * 14); g.addColorStop(0, `rgba(255,180,84,${0.1 + 0.4 * l})`); g.addColorStop(1, "rgba(255,180,84,0)"); x.fillStyle = g; x.beginPath(); x.arc(px, py, 5 + l * 14, 0, 7); x.fill(); }
    let a = 0.55, r = 2.2;
    if (hz) { const v = hz[k] / zm; a = 0.15 + 0.85 * (v * 0.5 + 0.5); r = 1.6 + 2.6 * Math.max(0, v); }
    x.beginPath(); x.arc(px, py, r, 0, 7); x.fillStyle = `rgba(142,240,177,${a})`; x.fill();
  });
  // the direction liking rises
  let g = gradient(); const cx = MW / 2, cy = MH / 2;
  if (swing) { // turn along the shorter way, between the old heading and the new
    const a0 = Math.atan2(swing.g0.gy, swing.g0.gx), a1 = Math.atan2(swing.g1.gy, swing.g1.gx);
    let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    const m0 = Math.hypot(swing.g0.gx, swing.g0.gy), m1 = Math.hypot(swing.g1.gx, swing.g1.gy), a = a0 + da * swing.k, m = m0 + (m1 - m0) * swing.k;
    g = { gx: Math.cos(a) * m, gy: Math.sin(a) * m, r2: swing.g1.r2 };
  }
  // where it pointed before this pick, fading
  if (arrowGhost && !hz) {
    const gg = arrowGhost.g, gx0 = gg.gx * (MW - 2 * PAD), gy0 = -gg.gy * (MH - 2 * PAD), m0 = Math.hypot(gx0, gy0);
    if (m0 > 1e-6) {
      const age = (performance.now() - arrowGhost.t0) / arrowGhost.D, a = 0.5 * (1 - Math.max(0, age - 0.4) / 0.6);
      const L0 = Math.min(MW, MH) * 0.36 * Math.min(1, m0 * 1.8), ux0 = gx0 / m0, uy0 = gy0 / m0;
      x.save(); x.setLineDash([3, 5]); x.strokeStyle = `rgba(255,180,84,${Math.max(0, a)})`; x.lineWidth = 1.5;
      x.beginPath(); x.moveTo(cx - ux0 * L0 * 0.5, cy - uy0 * L0 * 0.5); x.lineTo(cx + ux0 * L0 * 0.5, cy + uy0 * L0 * 0.5); x.stroke(); x.restore();
    }
  }
  const legend = root.querySelector("#md-maplegend");
  if (hz) legend.textContent = `dots: ${word(NAMES[hoverI])}`;
  else if (!g || Math.hypot(g.gx, g.gy) < 1e-3) legend.textContent = "no direction yet";
  else {
    const gx = g.gx * (MW - 2 * PAD), gy = -g.gy * (MH - 2 * PAD), m = Math.hypot(gx, gy);
    const L = Math.min(MW, MH) * 0.36 * Math.min(1, m * 1.8), ux = gx / m, uy = gy / m;
    x.save(); if (!fitted) x.setLineDash([5, 5]);
    x.strokeStyle = fitted ? "#ffb454" : "rgba(255,180,84,.75)"; x.lineWidth = 2; x.shadowColor = "rgba(255,180,84,.6)"; x.shadowBlur = fitted ? 10 : 0;
    x.beginPath(); x.moveTo(cx - ux * L * 0.5, cy - uy * L * 0.5); x.lineTo(cx + ux * L * 0.5, cy + uy * L * 0.5); x.stroke(); x.setLineDash([]);
    const hx = cx + ux * L * 0.5, hy = cy + uy * L * 0.5;
    x.beginPath(); x.moveTo(hx, hy); x.lineTo(hx - ux * 11 - uy * 6, hy - uy * 11 + ux * 6); x.lineTo(hx - ux * 11 + uy * 6, hy - uy * 11 - ux * 6); x.closePath(); x.fillStyle = x.strokeStyle; x.fill();
    x.restore();
    legend.textContent = fitted ? `the arrow: liking rises · explains ${Math.round(Math.max(0, g.r2) * 100)}%` : "the arrow: a guess, not fitted";
  }
  // the sound in hand: its face, in a green ring
  const p = A.inHand();
  if (!A.state.cut.has(p.id)) {
    const [px, py] = mapPos(p);
    if (!A.morphing) A.face(x, FACE, p, { box: { x: px - FACE / 2, y: py - FACE / 2, w: FACE, h: FACE }, dev: A.audio.devFor(p), glow: 8, lw: 1.2 });
    x.beginPath(); x.arc(px, py, FACE / 2 + 7, 0, 7); x.strokeStyle = "#8ef0b1"; x.lineWidth = 1.5; x.shadowColor = "rgba(142,240,177,.7)"; x.shadowBlur = 10; x.stroke(); x.shadowBlur = 0;
    x.font = "600 12px Jost, sans-serif"; x.fillStyle = "rgba(226,221,209,.9)"; x.textAlign = "center";
    x.fillText(p.name, px, py + FACE / 2 + 22);
  }
  mapCv.setAttribute("aria-label", `The presets on the map, ${p.name} ringed. ${legend.textContent}.`);
}

// ---- forecasts: hits out of guesses, and a strip of what it expected
function syncForecasts() {
  if (!fcEl) return;
  const fit = forecasts.filter((f) => f.fitted), hits = fit.filter((f) => f.hit).length;
  fcEl.replaceChildren();
  if (!forecasts.length) { fcEl.append(el("div", { class: "md-big mono" }, "—"), el("p", { class: "md-fcnote" }, "no picks yet")); drawStrip(); return; }
  if (!fit.length) {
    fcEl.append(el("div", { class: "md-big mono" }, "—"), el("p", { class: "md-fcnote" }, "still guessing"));
    drawStrip(); return;
  }
  const exp = fit.reduce((s, f) => s + Math.max(f.p_kept, 1 - f.p_kept), 0) / fit.length;
  fcEl.append(
    el("div", { class: "md-big mono" }, `${hits}`, el("span", {}, ` / ${fit.length}`)),
    el("p", { class: "md-fcnote mono" }, `expected ${Math.round(exp * 100)}% · was ${Math.round((hits / fit.length) * 100)}%`));
  drawStrip();
}
function resizeStrip() {
  const d = Math.min(2, devicePixelRatio || 1);
  SW = Math.max(120, stripCv.parentElement.clientWidth);
  stripCv.width = Math.round(SW * d); stripCv.height = Math.round(44 * d); stripCv.style.width = SW + "px"; stripCv.style.height = "44px";
  stripX.setTransform(d, 0, 0, d, 0, 0); drawStrip();
}
function dropIn() {
  if (A.reduced) return; cancelAnimationFrame(dropRaf);
  const tick = () => { drawStrip(); if (performance.now() - dropT < 700) dropRaf = requestAnimationFrame(tick); };
  dropRaf = requestAnimationFrame(tick);
}
function drawStrip() {
  if (!SW) return;
  const x = stripX; x.clearRect(0, 0, SW, 44);
  const L = 8, R = SW - 8, y = 18, X = (p) => L + p * (R - L);
  x.fillStyle = "rgba(53,60,70,1)"; x.fillRect(L, y, R - L, 1); x.fillRect(X(0.5) - 0.5, y - 6, 1, 12);
  x.font = "400 12px 'IBM Plex Mono', monospace"; x.fillStyle = "rgba(161,156,144,.85)";
  x.textAlign = "left"; x.fillText("0%", L, 40); x.textAlign = "center"; x.fillText("50%", X(0.5), 40); x.textAlign = "right"; x.fillText(SW < 400 ? "100%" : "100% for the one kept", R, 40);
  forecasts.forEach((f, k) => {
    const cx = X(f.p_kept); let cy = y - ((k % 3) - 1) * 4;
    // the newest falls in from above and rings once where it lands
    if (k === forecasts.length - 1 && !A.reduced) {
      const a = Math.min(1, (performance.now() - dropT) / 420), e = 1 - Math.pow(1 - a, 3);
      cy = cy - 16 * (1 - e);
      if (a >= 1) { const r = Math.min(1, (performance.now() - dropT - 420) / 280); if (r < 1) { x.beginPath(); x.arc(cx, cy, 3.4 + 9 * r, 0, 7); x.strokeStyle = `rgba(255,180,84,${0.6 * (1 - r)})`; x.lineWidth = 1; x.stroke(); } }
    }
    x.beginPath(); x.arc(cx, cy, 3.4, 0, 7);
    if (f.fitted) { x.fillStyle = f.hit ? "#ffb454" : "rgba(255,180,84,.35)"; x.fill(); }
    else { x.setLineDash([2, 2]); x.strokeStyle = "rgba(255,180,84,.8)"; x.lineWidth = 1; x.stroke(); x.setLineDash([]); }
  });
  stripCv.setAttribute("aria-label", `${forecasts.length} forecasts: the chance it gave the sound you kept.`);
}

// ---- export: the data, as JSON, with no download
function exportJson(ta, btn) {
  const data = { features: NAMES.map((n) => ({ name: tech(n), word: word(n) })), weights: A.model.w.map((v) => +v.toFixed(4)), picks: A.model.n, kept: picks, forecasts };
  const text = JSON.stringify(data, null, 2);
  const fallback = () => { ta.hidden = false; ta.value = text; ta.focus(); ta.select(); btn.innerHTML = `${icon("share")}Select and copy`; };
  try {
    navigator.clipboard.writeText(text).then(() => { btn.innerHTML = `${icon("share")}Copied`; ta.hidden = true; setTimeout(() => (btn.innerHTML = `${icon("share")}Copy as JSON`), 1600); }, fallback);
  } catch { fallback(); }
}

A.views.model = {
  mount,
  show() {
    visible = true; resize(); resizeStrip(); sync(false);
    if (unseen && last) { unseen = false; shown = last.from.slice(); drawBars(shown); if (A.morphing) waitMorph = true; else setTimeout(() => visible && play(last), 200); }
  },
  hide() { visible = false; cancelAnimationFrame(anim); cancelAnimationFrame(show); cancelAnimationFrame(swingRaf); swing = null; ghosts = null; if (OW) ovX.clearRect(0, 0, OW, OH); },
  anchor() {
    const p = A.inHand(); if (!MW || A.state.cut.has(p.id)) return null;
    const [px, py] = mapPos(p);
    return A.pageRect(mapCv, { x: px - FACE / 2, y: py - FACE / 2, w: FACE, h: FACE });
  },
  key(e) {
    if ((e.key === "r" || e.key === "R") && !e.metaKey && !e.ctrlKey && !e.altKey) { replay(); return true; }
    return false;
  },
};

const css = `
.md { position:absolute; inset:0; display:grid; grid-template-rows:auto 1fr; gap:var(--s4); padding:var(--s5) var(--s5) 72px; overflow:hidden; }
.md-eyebrow { margin-bottom:10px; }
.md-head .display { margin-bottom:8px; }
.md-sub { margin:0; color:var(--silk-dim); font-size:15px; max-width:60ch; }
.md-body { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,1fr); gap:var(--s4); min-height:0; }
.md-panel { background:var(--panel); border:1px solid var(--hair); border-radius:var(--r3); padding:14px 16px; display:flex; flex-direction:column; gap:10px; min-height:0; }
.md-ph { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:28px; }
.md .md-replay { height:28px; padding-inline:10px; }
.md { isolation:isolate; }
.md-ov { position:absolute; left:0; top:0; pointer-events:none; z-index:5; }
.md-evid { height:0; overflow:hidden; transition:height var(--d-move) var(--e-settle); }
.md-evid.on { height:56px; }
.md-evid canvas { display:block; }
.md-bars { display:grid; grid-auto-rows:minmax(17px, 24px); align-content:start; flex:1; min-height:0; overflow-y:auto; scrollbar-width:thin; scrollbar-color:var(--hair-hi) transparent; }
.md-row { display:grid; grid-template-columns:minmax(0,190px) minmax(0,1fr) 52px; align-items:center; gap:10px; min-height:0; padding:0 6px; border-radius:var(--r1); outline-offset:-2px; }
.md .md-more { display:none; align-self:flex-start; }
.md-row.lit { background:var(--panel-hi); }
.md-row.moved .md-word { color:var(--amber); }
.md-name { display:flex; align-items:baseline; gap:8px; min-width:0; white-space:nowrap; overflow:hidden; }
.md-word { font-size:13px; color:var(--silk); transition:color var(--d-state); }
.md-tech { font-size:12px; color:var(--silk-mute); overflow:hidden; text-overflow:ellipsis; }
.md-track { position:relative; height:10px; }
.md-zero { position:absolute; left:50%; top:-3px; bottom:-3px; width:1px; background:var(--hair-hi); }
.md-bar { position:absolute; top:1px; height:8px; border-radius:2px; background:var(--amber); box-shadow:0 0 8px -2px var(--amber-glow); }
.md-bar.neg { background:var(--amber-dim); }
.md-ghost { position:absolute; top:0; height:10px; border:1px dashed var(--amber-dim); border-radius:2px; opacity:0; pointer-events:none; }
.md.guess .md-bar { background:transparent; border:1px dashed var(--amber); box-shadow:none; top:0; height:10px; }
.md-val { font-size:12px; color:var(--silk-dim); text-align:right; font-variant-numeric:tabular-nums; }
.md-scale { display:grid; grid-template-columns:minmax(0,190px) minmax(0,1fr) 52px; gap:10px; padding:0 6px; font-size:12px; color:var(--silk-mute); }
.md-scale span { grid-column:2; grid-row:1; } .md-scale span:nth-child(1) { justify-self:start; } .md-scale span:nth-child(2) { justify-self:center; } .md-scale span:nth-child(3) { justify-self:end; }
.md-right { display:grid; grid-template-rows:minmax(0,1fr) auto auto; gap:var(--s4); min-height:0; }
.md-mapp { min-height:0; }
.md-map { flex:1; min-height:140px; }
.md-map canvas { position:absolute; inset:0; }
.md-maplegend { font-size:12px; color:var(--amber-dim); }
.md-fc { display:flex; align-items:baseline; gap:14px; }
.md-big { font-size:30px; color:var(--amber); font-weight:500; flex:none; }
.md-big span { font-size:16px; color:var(--silk-mute); }
.md-fcnote { margin:0; color:var(--silk-dim); font-size:13px; }
.md-strip { min-width:0; }
.md-strip canvas { display:block; }
.md-foot { display:grid; gap:8px; }
.md-footrow { display:flex; align-items:center; gap:14px; }
.md .md-copy { height:34px; }
.md-math { background:var(--panel); border:1px solid var(--hair); border-radius:var(--r2); padding:12px 14px; }
.md-math code { display:block; font-size:14px; color:var(--amber); margin-bottom:8px; }
.md-math p { margin:0 0 6px; color:var(--silk-dim); font-size:13px; max-width:62ch; }
.md-json { width:100%; height:120px; background:var(--void); color:var(--silk-dim); border:1px solid var(--hair); border-radius:var(--r2); padding:8px; font-size:12px; resize:vertical; }
@media (max-width: 980px) { .md-row, .md-scale { grid-template-columns:minmax(0,130px) minmax(0,1fr) 48px; } .md-tech { display:none; } }
@media (max-width: 700px) {
  .md { overflow-y:auto; display:flex; flex-direction:column; padding:12px 12px 52px; gap:12px; }
  .md-head { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; flex:none; }
  .md-head .md-eyebrow { display:none; }
  .md-head .display { font-size:28px; margin:0; }
  .md-sub { font-size:13px; }
  .md-body { display:flex; flex-direction:column; gap:12px; }
  .md-right { display:contents; }
  .md-mapp { order:1; } .md-weighs { order:2; } .md-fcp { order:3; } .md-foot { order:4; }
  .md-panel, .md-foot { flex:none; padding:12px; }
  .md-replay .lbl, .md-scale span:nth-child(2) { display:none; }
  .md-row, .md-scale { grid-template-columns:minmax(0,118px) minmax(0,1fr) 46px; gap:8px; }
  .md-row { height:26px; }
  .md-map { height:200px; flex:none; }
  .md-bars { display:flex; flex-direction:column; overflow:visible; }
  .md-bars.collapsed .md-row:nth-child(n+7) { display:none; }
  .md .md-more { display:inline-flex; }
  .md .md-copy { height:40px; }
}
`;
const SHORT = `
%S.md { padding:8px 12px 8px; gap:8px; overflow:hidden; }
%S.md-head { display:flex; align-items:baseline; gap:10px; }
%S.md-head .md-eyebrow { display:none; }
%S.md-head .display { font-size:22px; margin:0; }
%S.md-sub { font-size:12px; }
%S.md-body { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,1fr); gap:10px; }
%S.md-panel { padding:8px 10px; gap:6px; border-radius:var(--r2); }
%S.md-right { display:grid; grid-template-rows:minmax(0,1fr) auto; gap:10px; }
%S.md-foot, %S.md-strip, %S.md-scale { display:none; }
%S.md-evid.on { height:44px; }
%S.md-bars.collapsed .md-row:nth-child(n+7) { display:none; }
%S.md .md-more { display:inline-flex; }
%S.md-map { min-height:80px; }
%S.md-big { font-size:22px; }
`;
const touchCss = `body.touch .md-replay kbd { display:none; }`;
document.head.append(el("style", {}, css + `@media (max-height: 500px) {${SHORT.replaceAll("%S", "")}}` + SHORT.replaceAll("%S", "body.short ") + touchCss));
})();
