// EVOLVE: two sounds, the one you'd reach for, and what that taught it. The
// pick is one orchestrated moment: the pair is drawn out of the pool at random,
// the kept sound flies into its place on the map (or into TASTE, where the map
// lives), and the pick is drawn as what it teaches: a direction, from the one you
// passed to the one you kept, along which every sound's rating moves at once. The
// pick drops into the meter, and the model says what it had guessed.
(() => {
"use strict";
const { el, icon } = A;
let root, cards = {}, pair = null, recent = [], visible = false, raf = 0, busy = false, last = null, hoverSide = null;
let mini, mctx, MW = 260, MH = 150, ripples = [], kept = [], shuffle = null, refitAt = 0, stroke = null, arrive = null, mraf = 0;
const hidden = { a: false, b: false }; // a vessel away on its flight is not drawn at home
const slow = () => A.slow || 1;
const ease = (t) => 1 - Math.pow(1 - t, 3);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function mount(r) {
  root = r; root.style.display = "none";
  const wrap = el("div", { class: "ev" });
  const head = el("div", { class: "ev-head" },
    el("div", { class: "ev-headl" },
      el("div", { class: "ev-eyebrow" }, el("span", { class: "cap" }, "Evolve")),
      el("h1", { class: "ev-ask" }, el("span", { class: "ask-ptr" }, "Keep the one you'd reach for."), el("span", { class: "ask-touch" }, "Tap to hear. Swipe one up to keep it.")),
      el("div", { class: "ev-meter", id: "ev-meter", "aria-live": "polite" })),
    el("button", { class: "ev-mini", id: "ev-mini", "aria-label": "Your taste map · open TASTE (⌥4)", title: "Open TASTE · ⌥4", onclick: () => A.show("taste") }));
  const duel = el("div", { class: "ev-duel" }, card("a"), el("div", { class: "ev-vs", id: "ev-vs", "aria-hidden": "true" }, el("span", {}, "or")), card("b"));
  const foot = el("div", { class: "ev-foot" },
    el("button", { class: "btn ghost ev-again", "aria-label": "Another pair (N)", title: "Another pair · N", onclick: () => deal(), html: `${icon("again")}<span>Another pair</span><kbd>N</kbd>` }),
    el("span", { class: "ev-fair mono", title: "Every pair is dealt at random, so each pick also tests its forecast" }, "random pair · a fair test"),
    el("button", { class: "btn primary ev-breed", id: "ev-breed", onclick: () => breed(), onpointerenter: () => marks(true), onpointerleave: () => marks(false), onfocus: () => marks(true), onblur: () => marks(false) }));
  wrap.append(head, duel, foot);
  root.append(wrap);
  [mini, mctx] = A.canvas(MW, MH); root.querySelector("#ev-mini").append(mini, el("span", { class: "ev-mini-cap cap" }, "Taste ", el("kbd", {}, "⌥4")));
  // learning that happens elsewhere (an offer taken in PERFORM) moves the meter too; our own
  // pick is busy and lights its pip when the drop lands
  A.on("model", () => { if (pair && !busy) { pair.guess = A.model.predict(pair.a, pair.b); forecast(); draw(); last = null; meter(); } drawMini(); breedBtn(); });
  A.on("play", () => { glyphs(); loop(); }); A.on("stop", () => { glyphs(); draw(); });
  A.on("lens", () => { forecast(); draw(); });
  A.on("morphend", (id) => { if (id === "evolve" && visible) { for (const s of ["a", "b"]) size(s); drawMini(); } });
  A.on("cut", () => { if (pair && (A.state.cut.has(pair.a.id) || A.state.cut.has(pair.b.id))) deal(); drawMini(); });
  A.cmd({ id: "ev-a", view: "evolve", label: "Play A", key: "1", icon: "play", run: () => A.audio.toggle(pair.a) });
  A.cmd({ id: "ev-b", view: "evolve", label: "Play B", key: "2", icon: "play", run: () => A.audio.toggle(pair.b) });
  A.cmd({ id: "ev-pa", view: "evolve", label: "Keep A", key: "←", icon: "chev", run: () => pick("a") });
  A.cmd({ id: "ev-pb", view: "evolve", label: "Keep B", key: "→", icon: "chev", run: () => pick("b") });
  A.cmd({ id: "ev-n", view: "evolve", label: "Another pair", key: "N", icon: "again", run: () => deal() });
  A.cmd({ id: "ev-breed", view: "evolve", label: "Evolve the pool", icon: "evolve", run: () => breed() });
  deal(); meter(); breedBtn();
}

function card(side) {
  const L = side.toUpperCase();
  const [cv, cx] = A.canvas(10, 10);
  const glyph = el("span", { class: "ev-glyph", "aria-hidden": "true", html: icon("play") });
  const well = el("div", { class: "well ev-well", role: "button", tabindex: "0" }, cv,
    el("div", { class: "ev-letter cap", "aria-hidden": "true" }, L), el("div", { class: "ev-guess mono m-only" }), glyph,
    el("div", { class: "ev-swipe", "aria-hidden": "true", html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 19V6M6.5 11.5 12 6l5.5 5.5"/></svg>keep` }));
  const name = el("h2", { class: "ev-name" });
  const meta = el("div", { class: "ev-meta" });
  const play = el("button", { class: "btn ev-play", onclick: () => A.audio.toggle(pair[side]) });
  const keep = el("button", { class: "btn ev-keep", onclick: () => pick(side) });
  const info = el("div", { class: "ev-info" }, el("div", { class: "ev-id" }, name, meta), el("div", { class: "ev-acts" }, play, keep));
  const c = el("section", { class: "ev-card", "data-side": side, "aria-label": `Sound ${L}` }, well, info);
  // attention follows a mouse; a tap is not a hover
  c.addEventListener("pointerenter", (e) => { if (e.pointerType !== "mouse") return; hoverSide = side; draw(); });
  c.addEventListener("pointerleave", (e) => { if (e.pointerType !== "mouse") return; hoverSide = null; draw(); });
  // on a touch screen, swipe the sound up to keep it: it lifts toward the map as you drag
  let sw = null, swiped = false;
  well.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse" || busy) return; sw = { x: e.clientX, y: e.clientY, id: e.pointerId, lift: 0 }; swiped = false; well.setPointerCapture(e.pointerId); });
  well.addEventListener("pointermove", (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy)) { reset(); return; }
    sw.lift = Math.max(0, -dy);
    const k = Math.min(1, sw.lift / 72);
    c.style.transform = `translateY(${-Math.min(36, sw.lift * 0.5)}px)`;
    c.style.setProperty("--lift", k.toFixed(3));
    c.classList.toggle("lifting", sw.lift > 6);
  });
  const reset = () => { sw = null; c.style.transform = ""; c.style.removeProperty("--lift"); c.classList.remove("lifting"); };
  well.addEventListener("pointerup", () => { if (!sw) return; const go = sw.lift > 72; if (sw.lift > 6) swiped = true; reset(); if (go) pick(side); });
  well.addEventListener("pointercancel", reset);
  well.addEventListener("click", () => { if (swiped) { swiped = false; return; } A.audio.toggle(pair[side]); });
  well.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { A.audio.toggle(pair[side]); e.preventDefault(); e.stopPropagation(); } });
  cards[side] = { c, cv, cx, well, name, meta, play, keep, info, glyph, W: 0, H: 0 };
  new ResizeObserver(() => size(side)).observe(well);
  return c;
}
function size(side) {
  // layout size, not the painted box: mid-move the view is scaled, and a well measured
  // then would draw (and launch flights) from the wrong place
  const k = cards[side], d = Math.min(2, devicePixelRatio || 1);
  k.W = Math.max(60, k.well.clientWidth); k.H = Math.max(60, k.well.clientHeight);
  k.cv.width = Math.round(k.W * d); k.cv.height = Math.round(k.H * d); k.cv.style.width = k.W + "px"; k.cv.style.height = k.H + "px";
  k.cx.setTransform(d, 0, 0, d, 0, 0); draw();
}
const geom = (k) => { const h = Math.min(k.H * 0.8, k.W * 1.05), w = h * 0.6; return { x: (k.W - w) / 2, y: (k.H - h) / 2 - 6, w, h }; };

// ---- dealing: two sounds lifted out of the pool at random (a fair test)
function deal() {
  if (busy) return;
  const live = [...A.pool].map((id) => A.byId.get(id)).filter((p) => p && !A.state.cut.has(p.id));
  const fresh = live.filter((p) => !recent.includes(p.id));
  const from = fresh.length >= 2 ? fresh : live;
  const i = Math.floor(Math.random() * from.length); let j = Math.floor(Math.random() * (from.length - 1)); if (j >= i) j++;
  pair = { a: from[i], b: from[j], guess: A.model.predict(from[i], from[j]) };
  recent = [...recent, pair.a.id, pair.b.id].slice(-10);
  hidden.a = hidden.b = false;
  for (const s of ["a", "b"]) {
    const k = cards[s], p = pair[s];
    k.name.textContent = p.name;
    k.meta.replaceChildren(el("span", { class: "cap" }, p.category), el("span", { class: "ev-blurb" }, p.blurb));
    k.play.innerHTML = `${icon("play")}<span>Play</span><kbd>${s === "a" ? 1 : 2}</kbd>`;
    k.play.setAttribute("aria-label", `Play ${p.name} (${s === "a" ? 1 : 2})`);
    k.well.setAttribute("aria-label", `Play ${p.name}`);
    k.keep.innerHTML = s === "a" ? `<kbd>←</kbd><span>Keep A</span>` : `<span>Keep B</span><kbd>→</kbd>`;
    k.keep.setAttribute("aria-label", `Keep ${p.name}`);
    k.c.classList.remove("won", "lost");
    k.info.classList.remove("arrive"); void k.info.offsetWidth; if (!A.reduced) k.info.classList.add("arrive");
    A.audio.buffer(p);
  }
  if (!A.reduced && visible) {
    arrive = { t0: performance.now() };
    const others = live.filter((p) => p !== pair.a && p !== pair.b).sort(() => Math.random() - 0.5).slice(0, 5);
    shuffle = { t0: performance.now(), ids: others.map((p) => p.id) };
  }
  glyphs(); forecast(); loop(); animMini();
}
function forecast() {
  if (!pair) return;
  const g = pair.guess, fitted = A.model.fitted();
  for (const s of ["a", "b"]) {
    const pr = s === "a" ? g : 1 - g;
    cards[s].well.querySelector(".ev-guess").textContent = fitted ? `it guesses ${Math.round(pr * 100)}%` : "a guess · not fitted";
  }
}
function glyphs() {
  if (!pair) return;
  for (const s of ["a", "b"]) { const on = A.audio.playingId === pair[s].id; cards[s].glyph.innerHTML = icon(on ? "stop" : "play"); cards[s].glyph.classList.toggle("on", on); }
}

// ---- the pick
function pick(side) {
  if (!pair || busy) return;
  busy = true;
  const other = side === "a" ? "b" : "a", win = pair[side], lose = pair[other];
  const fitted = A.model.fitted(), pr = side === "a" ? pair.guess : 1 - pair.guess, right = (pair.guess >= 0.5 ? "a" : "b") === side;
  const snap = { w: A.model.w.slice(), n: A.model.n }, before = new Map(A.presets.map((p) => [p.id, A.model.like(p)]));
  A.audio.stopPhrase();
  cards[side].c.classList.add("won"); cards[other].c.classList.add("lost");
  const target = landing(win);
  let settled = false;
  const land = () => {
    if (settled) return; settled = true;
    A.model.learn(win, lose); A.teach(1);
    kept.push({ id: win.id, t0: performance.now() }); kept = kept.slice(-6);
    stroke = { win, lose, before, t0: performance.now() }; animMini();
    if (target && target.el) target.el.animate?.([{ boxShadow: "0 0 0 0 rgba(142,240,177,.7)" }, { boxShadow: "0 0 0 12px rgba(142,240,177,0)" }], { duration: 600 });
    A.emit("pick", { win, lose });
    const n = A.model.n;
    drop(target, (n - 1) % 6, () => { last = { right, pr, fitted, fitNow: n === 6 }; meter(); if (n % 6 === 0) refit(win, target); });
    setTimeout(() => { busy = false; deal(); }, A.reduced ? 0 : 140 * slow());
  };
  fly(side, win, target, land);
  A.toast({ face: win, text: `Kept ${win.name}.`, undo: () => {
    A.model.w = snap.w; A.model.n = snap.n; A.state.taught--; A.emit("taught", A.state.taught); A.emit("model", A.model);
    kept = kept.filter((k) => k.id !== win.id); last = null; meter(); drawMini();
  } });
}
// where a kept sound goes: its dot on the map when the map is here, or TASTE, where the map lives
function landing(p) {
  const m = root.querySelector("#ev-mini");
  if (m && getComputedStyle(m).display !== "none") { const r = mini.getBoundingClientRect(); if (r.width > 0) { const [px, py] = miniPos(p); return { x: r.left + px, y: r.top + py, dot: true }; } }
  const stop = document.querySelector('.rail-stop[data-view="taste"]');
  if (stop) { const q = stop.getBoundingClientRect(); if (q.width > 0) return { x: q.left + q.width / 2, y: q.top + q.height / 2, el: stop }; }
  return null;
}
// The flight leaves from exactly where the card drew it: same box, same line.
function fly(side, p, target, done) {
  // from the canvas the vessel is drawn on (inside the well's border), not the well's box
  const k = cards[side], b = geom(k), r = k.cv.getBoundingClientRect();
  if (A.reduced || !target || !k.W) { done(); return; }
  const m = 24, [f, fx] = A.canvas(b.w + 2 * m, b.h + 2 * m);
  A.face(fx, b.h, p, { box: { x: m, y: m, w: b.w, h: b.h }, glow: 18, lw: 2 });
  Object.assign(f.style, { position: "fixed", left: r.left + b.x - m + "px", top: r.top + b.y - m + "px", zIndex: 80, pointerEvents: "none" });
  f.setAttribute("aria-hidden", "true"); f.className = "ev-flight";
  document.body.append(f);
  hidden[side] = true; draw();
  const cx0 = r.left + b.x + b.w / 2, cy0 = r.top + b.y + b.h / 2, s = (target.dot ? 7 : 16) / b.w;
  const an = f.animate([
    { transform: "translate(0,0) scale(1)", opacity: 1 },
    { transform: "translate(0,-12px) scale(1.03)", opacity: 1, offset: 0.2 },
    { transform: `translate(${target.x - cx0}px,${target.y - cy0}px) scale(${s})`, opacity: 0.8 },
  ], { duration: 720 * slow(), easing: "cubic-bezier(.6,0,.2,1)" });
  an.onfinish = () => { f.remove(); done(); };
}
// the pick drops from where it landed into the meter, and lights its pip
function drop(from, i, then) {
  const pipEl = root.querySelectorAll(".ev-pips i")[i];
  if (A.reduced || !from || !pipEl || !visible) { then(); return; }
  const q = pipEl.getBoundingClientRect();
  if (!q.width) { then(); return; }
  const d = el("span", { class: "ev-drop", "aria-hidden": "true" }); document.body.append(d);
  Object.assign(d.style, { left: from.x - 3 + "px", top: from.y - 3 + "px" });
  const tx = q.left + q.width / 2 - from.x, ty = q.top + q.height / 2 - from.y;
  d.animate([{ transform: "translate(0,0) scale(.6)", opacity: 0.4 }, { transform: `translate(${tx * 0.5}px,${ty * 0.5 - 24}px) scale(1)`, opacity: 1, offset: 0.5 }, { transform: `translate(${tx}px,${ty}px) scale(1.2)`, opacity: 1 }],
    { duration: 360 * slow(), easing: "cubic-bezier(.5,0,.3,1)" }).onfinish = () => { d.remove(); then(); };
}
// every sixth pick it refits: the whole model is fitted again at once, so the pips flash
// and every halo on the map re-settles together
function refit(win, target) {
  const pips = root.querySelectorAll(".ev-pips i");
  if (!A.reduced) pips.forEach((pp, i) => pp.animate([{ boxShadow: "0 0 0 0 rgba(255,180,84,.8)" }, { boxShadow: "0 0 0 6px rgba(255,180,84,0)" }], { duration: 500, delay: i * 55 }));
  refitAt = performance.now(); animMini();
  // with the map away (a narrow screen), TASTE's own tab takes the amber: that is where it redrew
  if (target && target.el && !A.reduced) target.el.animate?.([{ boxShadow: "0 0 0 0 rgba(255,180,84,.8)", color: "#ffb454" }, { boxShadow: "0 0 0 14px rgba(255,180,84,0)", color: "#ffb454", offset: 0.6 }, { boxShadow: "0 0 0 14px rgba(255,180,84,0)" }], { duration: 1100 });
}
function meter() {
  const n = A.model.n, into = n % 6, fitted = A.model.fitted();
  const m = root.querySelector("#ev-meter"); m.replaceChildren();
  const pips = el("span", { class: "ev-pips", role: "img", "aria-label": `${n && into === 0 ? 6 : into} of 6 picks toward the next fit` });
  for (let i = 0; i < 6; i++) pips.append(el("i", { class: i < (n && into === 0 ? 6 : into) ? "on" : "" }));
  m.append(pips);
  if (last && last.fitNow) {
    // the first fit is news the meter can say in place, with the way to see it
    m.append(el("span", { class: "voice ev-said" }, "it has fitted your taste"), el("button", { class: "ev-see", onclick: () => A.show("taste"), html: `see it<kbd>⌥4</kbd>` }));
  } else if (last) {
    const pct = Math.round(Math.max(last.pr, 1 - last.pr) * 100);
    m.append(el("span", { class: "voice ev-said" }, !last.fitted ? "it was only guessing" : last.right ? `it guessed this · ${pct}%` : `it guessed the other · ${pct}%`,
      last.fitted ? el("span", { class: last.right ? "ev-hit" : "ev-miss", "aria-label": last.right ? "right" : "wrong" }, last.right ? " ✓" : " ✗") : ""));
  } else m.append(el("span", { class: "ev-count mono" }, fitted ? `${6 - into} more picks and it refits` : `${6 - n} more picks and it fits your taste`));
}
function breedBtn() {
  const b = root.querySelector("#ev-breed"), ok = A.model.fitted();
  if (busy && b.dataset.breeding) return;
  b.disabled = !ok;
  b.innerHTML = ok ? `${icon("evolve")}<span>Evolve pool</span>` : `<span>Evolve pool</span><span class="sub">needs ${6 - A.model.n} picks</span>`;
}

// ---- breeding, as the engine runs a generation (engine.rs: refine_jobs, walk_on, admission,
// refine_finish). The seeds are the pool's best-rated quarter (the engine's ten of forty).
// Each seed walks a short way to one child: a new sound, the seed itself untouched. A child
// gets in only if the model rates it above the weakest sound it would displace, counting the
// places already promised. When every walk is in, the pool trims back to size, lowest-rated
// first (a child can go too), and a sound you saved is never trimmed. The trimmed sounds are
// dropped: the engine keeps their names. In this demo a walk can't run, so a child is the
// unpooled preset nearest its seed.
function plan() {
  const pool = [...A.pool].map((id) => A.byId.get(id)).filter((p) => p && p.z && !A.state.cut.has(p.id));
  const seeds = pool.slice().sort((x, y) => A.model.like(y) - A.model.like(x)).slice(0, Math.max(1, Math.round(pool.length / 4)));
  const maygo = pool.filter((p) => !A.state.saved.has(p.id)).sort((x, y) => A.model.like(x) - A.model.like(y)).slice(0, seeds.length);
  return { pool, seeds, maygo };
}
// pointing at EVOLVE POOL shows what it would do: which sounds seed the walks, which may be replaced
function marks(on) {
  if (busy || !A.model.fitted()) on = false;
  if (!on && !A.bankMarks) return;
  if (on) {
    const { seeds, maygo } = plan(); A.bankMarks = { seeds: new Set(seeds.map((p) => p.id)), maygo: new Set(maygo.map((p) => p.id)) };
    if (bankVisible()) { A.bankTab("pool"); return; }
  } else A.bankMarks = null;
  A.bankDraw();
}
function breed() {
  if (!A.model.fitted() || busy) return;
  A.bankMarks = null;
  const b = root.querySelector("#ev-breed"); busy = true; b.disabled = true; b.dataset.breeding = "1";
  const { pool, seeds } = plan(), size = pool.length, G = A.openGeneration(), gen = G.gen;
  const dz = (a, c) => a.z.reduce((s, z, i) => s + (z - c.z[i]) ** 2, 0);
  const kindsOf = (p) => new Set(A.modulesOf(p.tree).map((m) => m.kind));
  const apart = (a, k) => { const x = kindsOf(a), y = kindsOf(k); let both = 0; for (const v of x) if (y.has(v)) both++; return 1 - both / Math.max(1, new Set([...x, ...y]).size); };
  const taken = new Set();
  // the walk's stand-in: the nearest sound not in the pool, in sound and in the modules they share
  const walk = (seed) => {
    const c = A.presets.filter((p) => p.z && p.category !== "yours" && !A.pool.has(p.id) && !A.state.cut.has(p.id) && !taken.has(p.id)).sort((a, c2) => dz(seed, a) + 12 * apart(seed, a) - (dz(seed, c2) + 12 * apart(seed, c2)))[0];
    if (c) taken.add(c.id); return c;
  };
  // the bar a child must clear: the weakest unsaved rating, past the places already promised
  const floor = pool.filter((p) => !A.state.saved.has(p.id)).map((p) => A.model.like(p)).sort((x, y) => x - y);
  let owed = 0;
  const duel = root.querySelector(".ev-duel"); duel.classList.add("breeding");
  // the pool is what changes, so show the pool
  const bankOn = bankVisible();
  if (bankOn) { const t = document.querySelector(".bank-tabs .btab"); if (t && t.getAttribute("aria-selected") !== "true") t.click(); }
  const dr = duel.getBoundingClientRect(), S = Math.min(dr.height * 0.62, 300, dr.width * 0.5), gap = (A.reduced ? 80 : 620) * slow();
  const flying = new Set(), admitted = [];
  let bred = 0, below = 0;
  const redraw = () => { A.bankDraw(); for (const id of flying) { const c = document.querySelector(`.bank .row[data-id="${id}"] canvas`); if (c) c.style.visibility = "hidden"; } };
  const label = (i, said) => { b.innerHTML = `<span class="ev-spin" aria-hidden="true"></span><span>Walk ${i} of ${seeds.length}</span>${said ? `<span class="sub">${said}</span>` : ""}`; };
  let i = 0;
  const step = () => {
    if (i >= seeds.length) { setTimeout(finish, A.reduced ? 0 : 700 * slow()); return; }
    const seed = seeds[i], n = i++, k = walk(seed);
    if (!k) { label(n + 1, "no move"); setTimeout(step, gap); return; }
    bred++;
    const like = A.model.like(k), bar = floor[owed] ?? -Infinity, ok = like > bar;
    label(n + 1, ok ? "kept" : "rated below the pool");
    if (ok) {
      owed++; floor.push(like); floor.sort((x, y) => x - y);
      admitted.push(k.id); A.childBorn(k.id, seed.id, G, { pu: A.model.like(seed), cu: like });
      A.pool.add(k.id); if (bankOn) flying.add(k.id); redraw();
      bud(seed, k, dr, S, n, bankOn, true, () => { flying.delete(k.id); redraw(); A.bankFlash(k.id); ripple(k); drawMini(); });
    } else { below++; bud(seed, k, dr, S, n, bankOn, false, () => {}); }
    setTimeout(step, gap);
  };
  const finish = () => {
    // back to size: the lowest-rated unsaved sounds go, children included
    const over = [...A.pool].length - size;
    const goners = over > 0 ? [...A.pool].map((id) => A.byId.get(id)).filter((p) => p && p.z && !A.state.saved.has(p.id) && !A.state.cut.has(p.id)).sort((x, y) => A.model.like(x) - A.model.like(y)).slice(0, over) : [];
    if (bankOn && !A.reduced) for (const g of goners) { const r = document.querySelector(`.bank .row[data-id="${g.id}"]`); r?.animate?.([{ opacity: 1, filter: "blur(0)" }, { opacity: 0, filter: "blur(3px)", transform: "translateX(-12px)" }], { duration: 600, fill: "forwards" }); }
    setTimeout(() => {
      for (const g of goners) A.pool.delete(g.id);
      const kidsGone = goners.filter((g) => admitted.includes(g.id)).length, kids = admitted.filter((id) => A.pool.has(id));
      G.kids = kids; G.gone = goners.filter((g) => !admitted.includes(g.id)).map((g) => g.id); G.notKept = below + kidsGone;
      A.closeGeneration(G);
      A.bankDraw(); drawMini(); duel.classList.remove("breeding"); busy = false; delete b.dataset.breeding; breedBtn();
      const replaced = goners.length - kidsGone, notKept = below + kidsGone;
      A.toast({ text: !bred ? `Generation ${gen}: no move was accepted, so the pool is as it was.`
        : !kids.length ? `Generation ${gen}: ${bred} bred, but none rated above the sounds already in the pool, so it is as it was.`
        : `Generation ${gen}: ${kids.length} new sound${kids.length > 1 ? "s" : ""} in the pool, each grown from one of the ${seeds.length} it rates highest.${notKept ? ` ${notKept} more ${notKept > 1 ? "were" : "was"} bred but rated lower, and not kept.` : ""} The ${replaced} it rated lowest ${replaced > 1 ? "were" : "was"} replaced.` });
    }, A.reduced ? 0 : 650 * slow());
  };
  step();
}
const bankVisible = () => { const bk = document.querySelector(".bank"); if (!bk) return false; const r = bk.getBoundingClientRect(); return r.width > 0 && r.right > 0 && r.left < innerWidth && r.top < innerHeight && r.bottom > 0 && getComputedStyle(bk).visibility !== "hidden"; };
// One child: a seed inside its parent's face buds out beside it, then flies to its row
// in the bank (or into the bank button, when the bank is put away).
function bud(par, kid, dr, S, n, bankOn, kept, landed) {
  if (A.reduced) { landed(); return; }
  const cx = dr.left + dr.width / 2 + (n % 2 ? 1 : -1) * dr.width * 0.12, cy = dr.top + dr.height / 2 - S / 2, L = cx - S / 2;
  const pc = A.faceCanvas(par, S, { glow: 16 }), kc = A.faceCanvas(kid, S, { glow: 16 });
  for (const c of [pc, kc]) { Object.assign(c.style, { position: "fixed", left: L + "px", top: cy + "px", zIndex: 80, pointerEvents: "none" }); c.className = "ev-flight"; }
  document.body.append(pc, kc);
  const D = 1500 * slow();
  pc.animate([{ opacity: 0, transform: "scale(.92)" }, { opacity: 1, transform: "scale(1)", offset: 0.25 }, { opacity: 1, offset: 0.7 }, { opacity: 0, transform: "scale(.96)" }], { duration: D, easing: "cubic-bezier(.2,.8,.2,1)" }).onfinish = () => pc.remove();
  // the destination: the child's own row face, centre to centre and size to size
  let tx, ty, s, into = null;
  const rowFace = bankOn ? document.querySelector(`.bank .row[data-id="${kid.id}"] canvas`) : null;
  if (rowFace) { rowFace.scrollIntoView({ block: "nearest" }); const q = rowFace.getBoundingClientRect(); tx = q.left + q.width / 2; ty = q.top + q.height / 2; s = q.width / S; }
  else { into = document.querySelector(".narrow-bank") || document.querySelector(".inhand"); const q = into.getBoundingClientRect(); tx = q.left + q.width / 2; ty = q.top + q.height / 2; s = 20 / S; }
  const side = S * 0.72;
  if (!kept) {
    kc.animate([
      { transform: "translate(0,18%) scale(.12)", opacity: 0, offset: 0 },
      { transform: "translate(0,18%) scale(.16)", opacity: 1, offset: 0.12 },
      { transform: `translate(${side}px,0) scale(.8)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${side}px,0) scale(.8)`, opacity: 0.8, filter: "blur(0)", offset: 0.7 },
      { transform: `translate(${side}px,10%) scale(.7)`, opacity: 0, filter: "blur(4px)", offset: 1 },
    ], { duration: D, easing: "cubic-bezier(.6,0,.2,1)" }).onfinish = () => { kc.remove(); landed(); };
    return;
  }
  kc.animate([
    { transform: "translate(0,18%) scale(.12)", opacity: 0, offset: 0 },
    { transform: "translate(0,18%) scale(.16)", opacity: 1, offset: 0.12 },
    { transform: `translate(${side}px,0) scale(.8)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${side}px,0) scale(.8)`, opacity: 1, offset: 0.62 },
    { transform: `translate(${tx - (L + S / 2)}px,${ty - (cy + S / 2)}px) scale(${s})`, opacity: 1, offset: 1 },
  ], { duration: D, easing: "cubic-bezier(.6,0,.2,1)" }).onfinish = () => {
    kc.remove(); landed();
    into?.animate?.([{ boxShadow: "0 0 0 0 rgba(142,240,177,.7)" }, { boxShadow: "0 0 0 10px rgba(142,240,177,0)" }], { duration: 520 });
  };
}

// ---- drawing
function draw() {
  if (!pair || !visible) return;
  const now = performance.now();
  for (const s of ["a", "b"]) {
    const k = cards[s], x = k.cx, p = pair[s]; if (!k.W) continue;
    x.clearRect(0, 0, k.W, k.H);
    const b0 = geom(k), playing = A.audio.playingId === p.id;
    // a new pair rises out of the pool, A a beat before B
    const ak = arrive ? ease(clamp01((now - arrive.t0 - (s === "b" ? 70 : 0) * slow()) / (320 * slow()))) : 1;
    const b = { ...b0, y: b0.y + (1 - ak) * 18 };
    const dim = (hoverSide && hoverSide !== s ? 0.55 : 1) * ak;
    const fy = b0.y + b0.h + 2, fl = x.createLinearGradient(0, 0, k.W, 0);
    fl.addColorStop(0, "rgba(142,240,177,0)"); fl.addColorStop(0.5, `rgba(142,240,177,${0.2 * (hoverSide && hoverSide !== s ? 0.55 : 1)})`); fl.addColorStop(1, "rgba(142,240,177,0)");
    x.fillStyle = fl; x.fillRect(k.W * 0.1, fy, k.W * 0.8, 1);
    if (hidden[s]) continue;
    // under the lens, the model's forecast as a halo on the side it favours
    if (A.state.lens) {
      const pr = s === "a" ? pair.guess : 1 - pair.guess, fitted = A.model.fitted();
      x.save(); if (!fitted) x.setLineDash([4, 6]);
      A.vesselPath(x, A.smooth(p.dev, 2), 1.12 + pr * 0.12, b);
      x.strokeStyle = `rgba(255,180,84,${(0.15 + pr * 0.65) * ak})`; x.lineWidth = 1 + pr * 3; x.shadowColor = "rgba(255,180,84,.6)"; x.shadowBlur = fitted ? 18 * pr : 0; x.stroke(); x.restore();
    }
    const live = playing ? A.audio.liveDev() : null;
    A.face(x, b.h, p, { box: b, glow: playing ? 26 : 18, lw: 2, dim, live });
  }
  if (arrive && now - arrive.t0 > 420 * slow()) arrive = null;
}
function loop() {
  if (raf || !visible) return;
  const tick = () => { raf = 0; draw(); if (visible && (A.audio.playingId != null || arrive)) raf = requestAnimationFrame(tick); };
  raf = requestAnimationFrame(tick);
}
const miniPos = (p) => { const pad = 14; return [pad + p.xy[0] * (MW - 2 * pad), pad + (1 - p.xy[1]) * (MH - 2 * pad)]; };
function ripple(p) { ripples.push({ p, t0: performance.now() }); animMini(); }
const STROKE = 1700, SETTLE = 800, REFIT = 900;
function animMini() { if (mraf) return; const t = () => { mraf = 0; drawMini(); const now = performance.now(); if (ripples.length || shuffle || stroke || refitAt || kept.some((k) => now - k.t0 < 2000)) mraf = requestAnimationFrame(t); }; mraf = requestAnimationFrame(t); }
function drawMini() {
  if (!mctx) return;
  const x = mctx, now = performance.now(); x.clearRect(0, 0, MW, MH);
  const fitted = A.model.fitted();
  // a pick moves every rating at once: the halos ease from what they were to what it now believes
  const sk = stroke ? ease(clamp01((now - stroke.t0) / (SETTLE * slow()))) : 1;
  // a refit fits the whole model again: every halo dips and returns together
  const rk = refitAt ? clamp01((now - refitAt) / (REFIT * slow())) : 1, lit = rk < 1 ? 0.2 + 0.8 * ease(rk) : 1;
  if (rk >= 1) refitAt = 0;
  for (const p of A.presets) {
    if (A.state.cut.has(p.id) || !p.xy) continue;
    const [px, py] = miniPos(p), l1 = A.model.like(p), l0 = stroke?.before.get(p.id) ?? l1, like = l0 + (l1 - l0) * sk;
    if (fitted) {
      x.beginPath(); x.arc(px, py, 1.5 + like * 4, 0, 7); x.fillStyle = `rgba(255,180,84,${(0.08 + like * 0.3) * lit})`; x.fill();
    }
    x.beginPath(); x.arc(px, py, 1.7, 0, 7); x.fillStyle = A.pool.has(p.id) ? "rgba(142,240,177,.75)" : "rgba(142,240,177,.28)"; x.fill();
  }
  // what a pick teaches: a direction, from the sound passed to the sound kept
  if (stroke) {
    const e = (now - stroke.t0) / (STROKE * slow());
    if (e >= 1) stroke = null;
    else if (stroke.win.xy && stroke.lose.xy) {
      const [ax, ay] = miniPos(stroke.lose), [bx, by] = miniPos(stroke.win), g = ease(clamp01(e / 0.35)), a = 0.9 * (1 - clamp01((e - 0.6) / 0.4));
      const L = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L, uy = (by - ay) / L, hx = ax + (bx - ax) * g, hy = ay + (by - ay) * g;
      x.save(); x.strokeStyle = x.fillStyle = `rgba(255,180,84,${a})`; x.lineWidth = 1.5;
      x.beginPath(); x.moveTo(ax, ay); x.lineTo(hx, hy); x.stroke();
      x.beginPath(); x.moveTo(hx, hy); x.lineTo(hx - ux * 7 - uy * 4, hy - uy * 7 + ux * 4); x.lineTo(hx - ux * 7 + uy * 4, hy - uy * 7 - ux * 4); x.closePath(); x.fill();
      x.restore();
    }
  }
  // your recent picks keep a quiet silk ring: where you have been teaching it
  for (const k of kept) {
    const p = A.byId.get(k.id); if (!p || !p.xy) continue;
    const [px, py] = miniPos(p), a = 0.35 + 0.55 * clamp01(1 - (now - k.t0) / 2000);
    x.beginPath(); x.arc(px, py, 4, 0, 7); x.strokeStyle = `rgba(226,221,209,${a})`; x.lineWidth = 1; x.stroke();
  }
  // a fair test: a ring hops over the pool at random, then settles on the two it drew
  let settled = true;
  if (shuffle) {
    const e = (now - shuffle.t0) / (380 * slow());
    if (e >= 1 || !shuffle.ids.length) shuffle = null;
    else {
      settled = false;
      const p = A.byId.get(shuffle.ids[Math.min(shuffle.ids.length - 1, Math.floor(e * shuffle.ids.length))]);
      if (p && p.xy) { const [px, py] = miniPos(p); x.beginPath(); x.arc(px, py, 5, 0, 7); x.strokeStyle = "rgba(226,221,209,.55)"; x.lineWidth = 1.2; x.stroke(); }
    }
  }
  if (pair && settled) for (const s of ["a", "b"]) {
    if (!pair[s].xy) continue;
    const [px, py] = miniPos(pair[s]);
    x.beginPath(); x.arc(px, py, 5, 0, 7); x.strokeStyle = "#e2ddd1"; x.lineWidth = 1.2; x.stroke();
    x.font = "600 12px Jost, sans-serif"; x.fillStyle = "#e2ddd1"; x.textAlign = "center"; x.fillText(s.toUpperCase(), px, py - 9);
  }
  ripples = ripples.filter((r) => now - r.t0 < 1100 * slow());
  for (const r of ripples) {
    if (!r.p.xy) continue;
    const k = (now - r.t0) / (1100 * slow()), [px, py] = miniPos(r.p);
    x.beginPath(); x.arc(px, py, 4 + k * 22, 0, 7); x.strokeStyle = `rgba(142,240,177,${0.7 * (1 - k)})`; x.lineWidth = 1.2; x.stroke();
    x.beginPath(); x.arc(px, py, 3, 0, 7); x.fillStyle = "#8ef0b1"; x.fill();
  }
}

A.views.evolve = {
  mount,
  anchor() { return null; },
  show() { visible = true; root.style.display = ""; for (const s of ["a", "b"]) size(s); drawMini(); glyphs(); },
  hide() { visible = false; root.style.display = "none"; },
  key(e) {
    if (e.key === "1" || e.key === "2") { A.audio.toggle(pair[e.key === "1" ? "a" : "b"]); return true; }
    if (e.key === "ArrowLeft") { pick("a"); return true; }
    if (e.key === "ArrowRight") { pick("b"); return true; }
    if (e.key === "n" || e.key === "N") { deal(); return true; }
    return false;
  },
};

const css = `
.ev { position:absolute; inset:0; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:auto minmax(0,1fr) auto; gap:var(--s4); padding:var(--s5) calc(var(--s5) + 12px) 72px var(--s5); }
.ev-head { display:flex; justify-content:space-between; align-items:flex-start; gap:var(--s5); }
.ev-eyebrow { margin-bottom:10px; }
.ev-ask { font:400 40px/1.05 var(--f-silk); margin:0 0 14px; letter-spacing:-.01em; }
.ev-ask .ask-touch { display:none; }
@media (hover: none) and (pointer: coarse) { .ev-ask .ask-ptr { display:none; } .ev-ask .ask-touch { display:inline; } }
.ev-meter { display:flex; align-items:center; gap:14px; min-height:24px; }
.ev-pips { display:flex; gap:6px; }
.ev-pips i { width:9px; height:9px; border-radius:50%; border:1.5px solid var(--amber-dim); transition:background var(--d-state), box-shadow var(--d-state); }
.ev-pips i.on { background:var(--amber); border-color:var(--amber); box-shadow:0 0 8px var(--amber-glow); }
.ev-count { font-size:13px; color:var(--silk-dim); }
.ev-said { animation:evsaid var(--d-move) var(--e-settle); }
@keyframes evsaid { from { opacity:0; transform:translateY(4px); } }
.ev-see { display:inline-flex; align-items:center; gap:6px; height:28px; padding:0 10px; border-radius:999px; border:1px solid var(--amber-deep); color:var(--amber); font:600 10px/1 var(--f-silk); letter-spacing:.16em; text-transform:uppercase; animation:evsaid var(--d-move) var(--e-settle); }
.ev-see:hover { border-color:var(--amber-dim); }
.ev-see kbd { color:var(--amber-dim); border-color:var(--amber-deep); }
@media (max-width: 700px) { .ev-see kbd { display:none; } .ev-see { height:32px; } }
.ev-hit { color:var(--amber); font-style:normal; } .ev-miss { color:var(--silk-dim); font-style:normal; }
.ev-drop { position:fixed; width:6px; height:6px; border-radius:50%; background:var(--amber); box-shadow:0 0 10px var(--amber-glow); z-index:81; pointer-events:none; }
.ev-mini { position:relative; flex:none; border-radius:var(--r2); border:1px solid var(--hair); background:var(--void); padding:0; overflow:hidden; transition:border-color var(--d-state); }
.ev-mini:hover { border-color:var(--hair-hi); }
.ev-mini canvas { display:block; }
.ev-mini-cap { position:absolute; left:10px; bottom:8px; display:flex; gap:6px; align-items:center; color:var(--silk-mute); }
.ev-duel { display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); gap:var(--s3); min-height:0; }
.ev-vs { display:grid; place-items:center; color:var(--silk-mute); font:italic 400 16px/1 var(--f-voice); }
.ev-card { display:grid; grid-template-rows:minmax(0,1fr) auto; gap:var(--s3); min-height:0; min-width:0; container-type:inline-size; transform-origin:50% 90%; transition:transform var(--d-move) var(--e-settle), opacity var(--d-move); }
.ev-card.won { transform:translateY(-6px); }
.ev-card.lost { opacity:.3; transform:translateY(10px) scale(.97); }
.ev-card.lifting { transition:none; }
.ev-duel.breeding .ev-card { opacity:.18; transition:opacity var(--d-move); }
.ev-well { min-height:0; cursor:pointer; }
.ev-well:focus-visible { outline:2px solid var(--green); outline-offset:2px; }
.ev-well canvas { position:absolute; inset:0; }
.ev-letter { position:absolute; left:16px; top:14px; color:var(--silk-dim); font-size:12px; }
.ev-guess { position:absolute; right:16px; top:14px; font-size:12px; color:var(--amber); }
.ev-glyph { position:absolute; right:12px; bottom:12px; width:32px; height:32px; border-radius:50%; display:grid; place-items:center; color:var(--green-dim); border:1px solid var(--hair); background:rgba(7,8,10,.6); pointer-events:none; transition:color var(--d-state), border-color var(--d-state); }
.ev-glyph svg { width:14px; height:14px; }
.ev-glyph.on, .ev-well:hover .ev-glyph { color:var(--green); border-color:var(--green-deep); }
.ev-swipe { display:none; position:absolute; left:50%; bottom:10px; transform:translateX(-50%); align-items:center; gap:4px; font:600 10px/1 var(--f-silk); letter-spacing:.16em; text-transform:uppercase; color:var(--silk-mute); pointer-events:none; opacity:calc(.55 + var(--lift, 0) * .45); }
.ev-swipe svg { width:14px; height:14px; }
.ev-card.lifting .ev-swipe { color:var(--green); }
.ev-card.lifting .ev-well { box-shadow:0 0 0 1px var(--green-deep), 0 -12px 28px -10px rgba(142,240,177,calc(var(--lift, 0) * .6)); }
@media (hover: none) and (pointer: coarse) { .ev-swipe { display:flex; } .ev-well { touch-action:none; } }
.ev-info { display:flex; justify-content:space-between; align-items:flex-end; gap:var(--s4); }
.ev-info.arrive { animation:evarrive calc(var(--d-move) + 60ms) var(--e-settle); }
@keyframes evarrive { from { opacity:0; transform:translateY(6px); } }
.ev-id { min-width:0; }
.ev-name { font:500 26px/1.1 var(--f-silk); margin:0 0 6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ev-meta { display:flex; gap:10px; align-items:baseline; color:var(--silk-dim); font-size:14px; min-width:0; }
.ev-blurb { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:28ch; }
.ev-acts { display:flex; gap:8px; flex:none; }
.ev-keep { min-width:112px; }
.ev-card.won .ev-keep { border-color:var(--green); color:var(--green); box-shadow:0 0 18px -4px var(--green-glow); }
@container (max-width: 460px) { .ev-info { flex-direction:column; align-items:stretch; gap:10px; } .ev-acts .btn { flex:1; min-width:0; } .ev-blurb { max-width:100%; } }
.ev-foot { display:flex; align-items:center; gap:var(--s4); }
.ev-fair { font-size:12px; color:var(--silk-mute); }
.ev-breed { margin-left:auto; height:44px; min-width:180px; }
.ev-foot .btn, .ev-acts .btn { white-space:nowrap; }
@media (max-width: 1200px) { .ev-ask { font-size:32px; } .ev-fair { display:none; } .ev-count { white-space:nowrap; } .ev-breed { min-width:0; } }
.ev-spin { width:12px; height:12px; border-radius:50%; border:2px solid rgba(26,18,6,.3); border-top-color:var(--ink-on-amber); animation:spin 700ms linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
@media (max-width: 980px) { .ev-vs { display:none; } .ev-mini { display:none; } .ev-ask { font-size:30px; } .ev-duel { grid-template-columns:minmax(0,1fr) minmax(0,1fr); } .ev-info { flex-direction:column; align-items:stretch; } .ev-blurb { display:none; } }
/* a phone: the whole loop in one screen. Two wells side by side (tap one to hear it,
   swipe it up to keep it), each with its name and one Keep; the meter above, and
   "another pair" and the breed below. */
@media (max-width: 700px) {
  .ev { display:flex; flex-direction:column; gap:10px; padding:10px 14px 12px; overflow-y:auto; }
  .ev-card { container-type:normal; }
  .stage:has(.guide .next) .ev { padding-bottom:54px; }
  .ev-head, .ev-foot { flex:none; }
  .ev-eyebrow { display:none; }
  .ev-ask { font-size:20px; line-height:1.2; margin:0 0 6px; }
  .ev-meter { min-height:20px; gap:10px; }
  .ev-count, .ev-said { font-size:13px; }
  .ev-duel { flex:1 1 auto; min-height:260px; display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:10px; }
  .ev-card { grid-template-rows:minmax(150px, 1fr) auto; gap:8px; }
  .ev-letter { left:10px; top:10px; }
  .ev-guess { right:auto; left:28px; top:10px; font-size:11px; }
  .ev-glyph { right:8px; top:8px; bottom:auto; width:30px; height:30px; }
  .ev-info { flex-direction:column; align-items:stretch; gap:8px; }
  .ev-name { font-size:16px; margin:0 0 2px; }
  .ev-meta .cap { font-size:10px; }
  .ev-blurb { display:none; }
  .ev-acts .ev-play { display:none; }
  .ev-acts .btn { flex:1; height:44px; min-width:0; }
  .ev-foot { gap:10px; }
  .ev-foot .btn { flex:1; height:44px; min-width:0; }
  .ev-again kbd, .ev-keep kbd, .ev-fair { display:none; }
  .ev-breed { margin-left:0; }
  .ev-breed .sub { display:none; }
}
@media (max-width: 380px) { .ev-ask { font-size:18px; } .ev-foot .btn { padding-inline:10px; letter-spacing:.12em; } }
/* keys are for keyboards: on touch the hints go */
@media (hover: none) and (pointer: coarse) { #view-evolve kbd { display:none; } }
body.touch #view-evolve kbd { display:none; }
` + shortCss("") .replace(/^/, "@media (max-height: 500px) {\n") + "}\n" + shortCss("body.short ");
// A short screen (a phone on its side): one row of controls over the pair, and the two
// wells side by side taking every pixel that is left. The ask moves to the wells' own
// "↑ keep" and play glyphs; its heading stays for screen readers.
function shortCss(pre) { return `
${pre}.ev { display:grid; grid-template-columns:minmax(0,1fr) auto; grid-template-rows:auto minmax(0,1fr); grid-template-areas:"head foot" "duel duel"; gap:6px 10px; padding:8px 12px; overflow:hidden; }
${pre}.stage:has(.guide .next) .ev { padding-bottom:8px; } /* on a short screen the first-visit line rides in the header */
${pre}.ev-head { grid-area:head; display:flex; align-items:center; min-width:0; gap:10px; }
${pre}.ev-headl { min-width:0; flex:1; }
${pre}.ev-eyebrow, ${pre}.ev-mini, ${pre}.ev-vs, ${pre}.ev-fair, ${pre}.ev-blurb, ${pre}.ev-acts .ev-play, ${pre}.ev-breed .sub { display:none; }
${pre}.ev-ask { position:absolute; width:1px; height:1px; margin:0; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
${pre}.ev-meter { min-height:32px; gap:10px; flex-wrap:nowrap; min-width:0; }
${pre}.ev-count, ${pre}.ev-said { font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
${pre}.ev-foot { grid-area:foot; display:flex; gap:8px; align-items:center; }
${pre}.ev-foot .btn { height:40px; padding-inline:12px; flex:none; min-width:0; }
${pre}.ev-again { width:40px; padding:0; }
${pre}.ev-again span, ${pre}.ev-again kbd { display:none; }
${pre}.ev-breed { margin-left:0; min-width:0; }
${pre}.ev-duel { grid-area:duel; display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; min-height:0; }
${pre}.ev-card { display:grid; grid-template-columns:minmax(0,1fr) minmax(92px,36%); grid-template-rows:minmax(0,1fr); gap:8px; min-height:0; container-type:normal; }
${pre}.ev-well { min-height:0; }
${pre}.ev-letter { left:10px; top:8px; }
${pre}.ev-guess { right:auto; left:28px; top:8px; font-size:11px; }
${pre}.ev-glyph { right:8px; top:6px; bottom:auto; width:28px; height:28px; }
${pre}.ev-swipe { bottom:6px; }
${pre}.ev-info { flex-direction:column; align-items:stretch; justify-content:flex-end; gap:8px; min-width:0; }
${pre}.ev-id { min-width:0; }
${pre}.ev-name { font-size:15px; margin:0 0 2px; }
${pre}.ev-meta { gap:6px; } ${pre}.ev-meta .cap { font-size:10px; }
${pre}.ev-acts { flex:none; }
${pre}.ev-keep { height:40px; width:100%; min-width:0; padding-inline:10px; }
`; }

document.head.append(el("style", {}, css));
})();
