// TASTE and LEARNING (Plan-005 task 6, RFC-006 §7, to prototype v2's
// taste.js and model.js in docs/notes/vision-2026-09/prototype/).
//
// TASTE is the map: every sound in the pool where the engine's map puts it,
// the model's liking as an amber halo behind it, hollow and dashed while it is
// still a guess. A pick draws as what it teaches: an arrow from the sound
// passed to the sound picked, and every halo on the map moves at once, because
// a pick reweights the posterior's draws and with them every rating. A refit
// settles every halo, and every place, together.
//
// LEARNING is the model room: the weights of the style you choose, which way
// liking rises on the map, the forecasts it made before each pick and how they
// scored, the data as JSON, and the math.
//
// Every motion here shows a fact the engine posted at that moment
// (ADR-012), and the comment beside it names the engine symbol:
//   - a pick's arrow and the halos moving with it: the `status` reply to
//     `record_duel` (its `vote`, `choseA` and `ratings`, `WasmEngine::belief`);
//   - a refit settling them: a views post (`tasteViews`: `taste_map`,
//     `belief`);
//   - LEARNING's arrow turning: the same `ratings` on the same map;
//   - a forecast landing on the strip: `WasmEngine::forecasts`, posted with
//     the calibration after every pick.
// What the engine does not record is not drawn: no arrow for a pick whose two
// sounds are not both on the map (a PERFORM offer is never in the pool), and
// no weights moving between refits (the belief carries ratings, not θ).
//
// main.js owns the data (`views`, the calibration), the bank and the bench;
// this module draws, and asks main (`host`) to open, play or rename. Pure
// geometry is in taste-geom.js, sentences in words.js, both unit-tested.

export function createTaste(host) {
  const { geom, words, INK, inkAlpha, canvasFont, motionMs, tok } = host;
  const $ = (id) => document.getElementById(id);

  // How long an arrow stays drawn once it has reached the sound picked: a
  // timer (when it goes), not a motion (how it moves). Under reduced motion
  // the arrow appears whole for this long and then goes.
  const ARROW_HOLD_MS = 1800;
  // Picks made while TASTE was not showing, drawn in turn when it next opens
  // (the prototype's `arrive`): each is the reply that pick got, kept as it
  // came. At most this many, and this far apart.
  const ARRIVALS_MAX = 6;
  const ARRIVAL_GAP_MS = 260;
  // How long after leaving a sound its card stays, so the pointer can reach it.
  const PLATE_LINGER_MS = 260;

  // ---------- easing: the token's curve, for a script's tween ----------
  const settleCurve = (() => {
    const m = /cubic-bezier\(([^)]+)\)/.exec(tok("--e-settle") || "");
    const [x1, y1, x2, y2] = m ? m[1].split(",").map(Number) : [0, 0, 1, 1];
    const bx = (t) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
    const by = (t) => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let lo = 0, hi = 1;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (bx(mid) < x) lo = mid;
        else hi = mid;
      }
      return by((lo + hi) / 2);
    };
  })();

  // Canvas text at the canvas floor, in device pixels: every other mark is
  // drawn in CSS pixels under a scaled transform.
  function text(ctx, s, x, y, align = "left") {
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = canvasFont(dpr);
    ctx.textAlign = align;
    ctx.fillText(s, x * dpr, y * dpr);
    ctx.restore();
  }
  function sizeCanvas(cv, w, h) {
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  let visible = null; // "taste", "learning" or null
  let raf = 0;
  const busy = new Set(); // what still moves: "glow", "arrow", "swing", "drop"
  function kick() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      frame(performance.now());
    });
  }
  function frame(now) {
    if (visible === "taste") drawMap(now);
    if (visible === "learning") {
      drawDirection(now);
      drawStrip(now);
    }
    if (busy.size && visible) kick();
  }

  // ---------- what the engine says ----------
  const fitted = () => !!(host.views() && host.views().styles);
  const mapOf = () => {
    const v = host.views();
    return v && v.map && Array.isArray(v.map.points) ? v.map : null;
  };
  /** The pool's map points, without the history ghosts or what was cut. */
  const poolPoints = () => (mapOf()?.points || []).filter((p) => p.id != null && !host.isCut(p.id));
  /** id → {mean, std} as the engine rates the pool now: the ratings after
   *  the last pick (`WasmEngine::belief`), else the map's own numbers. */
  function ratingsNow() {
    const out = new Map();
    for (const p of mapOf()?.points || []) if (p.id != null) out.set(p.id, { mean: p.utility, std: p.utility_std });
    const r = host.views()?.ratings;
    if (r && Array.isArray(r.ranked)) for (const row of r.ranked) out.set(row.id, { mean: row.mean, std: row.std });
    return out;
  }

  // =====================================================================
  // TASTE: the map
  // =====================================================================
  const cv = $("taste-crt");
  const well = $("taste-well");
  const plate = $("taste-plate");
  const live = $("taste-live");
  let W = 0, H = 0, S0 = 24;
  let target = new Map();   // id → {x, y}: where the current map puts each sound
  let shownPos = new Map(); // id → {x, y}: where it is drawn now
  let fromPos = new Map();  // …and where a settle started
  let likeTarget = new Map(), likeShown = new Map(), likeFrom = new Map();
  let stdNow = new Map();
  let tween = null;         // {t0, dur, move}: the halos (and on a settle, the places) on their way
  let strokes = [];         // [{a: passed, b: picked, t0}]
  let arrivals = [];        // picks made while the map was not showing
  let seenMap = null, seenRatings = null, seenFitted = null;
  let active = null, activeKbd = false, plateTimer = 0;

  function relayout() {
    const pts = poolPoints();
    const frame = geom.mapFrame(W, H, pts.length);
    S0 = frame.s0;
    target = geom.mapLayout(pts, frame.box, frame.minD);
  }

  // A new map or new ratings start the halos (and, for a new map, the places)
  // moving from where they are drawn to where the engine now puts them, all
  // in one tween: every glow moves together.
  function adopt({ move }) {
    const r = ratingsNow();
    likeFrom = new Map(likeShown);
    likeTarget = new Map();
    stdNow = new Map();
    for (const p of poolPoints()) {
      const row = r.get(p.id) || { mean: 0, std: 0 };
      likeTarget.set(p.id, geom.liking(row.mean));
      stdNow.set(p.id, row.std);
    }
    if (move) {
      fromPos = new Map(shownPos);
      relayout();
    }
    const dur = motionMs("--d-move");
    tween = { t0: performance.now(), dur, move };
    busy.add("glow");
    if (!dur) step(performance.now());
  }
  function step(now) {
    if (!tween) return;
    const k = tween.dur > 0 ? Math.min(1, (now - tween.t0) / tween.dur) : 1;
    const e = settleCurve(k);
    for (const [id, to] of likeTarget) {
      const from = likeFrom.has(id) ? likeFrom.get(id) : to;
      likeShown.set(id, from + (to - from) * e);
    }
    for (const [id, to] of target) {
      // A sound new to the map appears where it lands; on a settle, every
      // other one moves from where it was drawn.
      const from = tween.move && fromPos.has(id) ? fromPos.get(id) : shownPos.get(id) || to;
      shownPos.set(id, tween.move ? { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e } : from);
    }
    for (const id of [...shownPos.keys()]) if (!target.has(id)) shownPos.delete(id);
    if (k >= 1) {
      tween = null;
      busy.delete("glow");
    }
  }

  function measureMap() {
    W = Math.max(200, well.clientWidth);
    H = Math.max(160, well.clientHeight);
  }
  // A new size is a new layout of the same map, not something the engine
  // did: the places jump to it.
  function resizeMap() {
    measureMap();
    relayout();
    shownPos = new Map(target);
  }

  // The face slot: what marks a sound on the map. Today a dot, its size the
  // model's doubt (taste-geom `mapDotRadius`, RFC-006 §7: size is the
  // uncertainty). The faces (Plan-005 task 3) draw here instead, through
  // `host.drawFace(ctx, id, x, y, size)`, which returns true when it drew.
  function drawMark(ctx, id, x, y, r) {
    if (host.drawFace && host.drawFace(ctx, id, x, y, r * 2)) return;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = INK.green;
    ctx.shadowColor = inkAlpha(INK.green, 0.6);
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawMap(now = performance.now()) {
    if (visible !== "taste" || !W) return;
    step(now);
    const ctx = sizeCanvas(cv, W, H);
    ctx.clearRect(0, 0, W, H);
    // A quiet field: a dot every 44 px, and the plane's two axes through it.
    ctx.fillStyle = inkAlpha(INK.silk, 0.07);
    for (let gx = 22; gx < W; gx += 44) for (let gy = 22; gy < H; gy += 44) ctx.fillRect(gx, gy, 1, 1);
    const pts = poolPoints();
    if (!pts.length) return;
    const isFit = fitted();
    const unsure = geom.mapUnsureScale(pts.map((p) => stdNow.get(p.id)));
    // The halos first, all of them, so every mark sits on the light. The glow
    // is the engine's rating (`BeliefRow::mean` after a pick, `MapPoint::utility`
    // after a refit) through the bank's logistic.
    for (const p of pts) {
      const q = shownPos.get(p.id);
      if (!q) continue;
      if (!isFit) {
        // No fit, no rating: a guess, drawn as one (dashed amber).
        ctx.save();
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(q.x, q.y, S0 * 0.62, 0, Math.PI * 2);
        ctx.strokeStyle = inkAlpha(INK.amber, 0.42);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        continue;
      }
      const h = geom.haloOf(likeShown.get(p.id) ?? 0.5, S0);
      const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, h.r);
      g.addColorStop(0, inkAlpha(INK.amber, h.a0));
      g.addColorStop(0.55, inkAlpha(INK.amber, h.a1));
      g.addColorStop(1, inkAlpha(INK.amber, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(q.x, q.y, h.r, 0, Math.PI * 2);
      ctx.fill();
    }
    const subject = host.subjectId();
    const pending = host.pendingId();
    for (const p of pts) {
      const q = shownPos.get(p.id);
      if (!q) continue;
      const r = geom.mapDotRadius(isFit ? unsure(stdNow.get(p.id)) : 0.5);
      drawMark(ctx, p.id, q.x, q.y, r);
      // The sound you're playing: a green ring. One on its way: dotted silk.
      if (p.id === subject || (p.id === pending && pending !== subject)) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(q.x, q.y, r + 6, 0, Math.PI * 2);
        if (p.id === subject) {
          ctx.strokeStyle = INK.green;
          ctx.shadowColor = inkAlpha(INK.green, 0.7);
          ctx.shadowBlur = 10;
          ctx.lineWidth = 1.5;
        } else {
          ctx.strokeStyle = INK.silk;
          ctx.setLineDash([1.5, 2.5]);
          ctx.lineWidth = 1.2;
        }
        ctx.stroke();
        ctx.restore();
      }
      if (p.id === active && activeKbd) {
        ctx.save();
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.arc(q.x, q.y, r + 11, 0, Math.PI * 2);
        ctx.strokeStyle = inkAlpha(INK.silk, 0.55);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }
    }
    drawStrokes(ctx, now);
  }

  // A pick, as the direction it taught: from the sound passed to the sound
  // picked (`record_duel`'s `vote` and `choseA`, in the `status` that answers
  // it). It draws on, holds, and fades; under reduced motion it is drawn
  // whole for its hold and then goes.
  function drawStrokes(ctx, now) {
    const on = motionMs("--d-move");
    const fade = motionMs("--d-move");
    strokes = strokes.filter((s) => now < s.t0 + on + ARROW_HOLD_MS + fade);
    if (strokes.length) busy.add("arrow");
    else busy.delete("arrow");
    for (const s of strokes) {
      if (now < s.t0) continue;
      const f = shownPos.get(s.a);
      const t = shownPos.get(s.b);
      if (!f || !t) continue;
      const age = now - s.t0;
      const g = on > 0 ? settleCurve(Math.min(1, age / on)) : 1;
      const out = age - on - ARROW_HOLD_MS;
      const alpha = 0.9 * (out <= 0 ? 1 : fade > 0 ? Math.max(0, 1 - out / fade) : 0);
      if (alpha <= 0) continue;
      const L = Math.hypot(t.x - f.x, t.y - f.y) || 1;
      const ux = (t.x - f.x) / L;
      const uy = (t.y - f.y) / L;
      // The head stops short of the picked sound's mark, so it points at it.
      const reach = Math.max(0, L - 10);
      const hx = f.x + ux * reach * g;
      const hy = f.y + uy * reach * g;
      ctx.save();
      ctx.strokeStyle = inkAlpha(INK.amber, alpha);
      ctx.fillStyle = inkAlpha(INK.amber, alpha);
      ctx.shadowColor = inkAlpha(INK.amber, 0.5 * alpha);
      ctx.shadowBlur = 6;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx - ux * 10 - uy * 5.5, hy - uy * 10 + ux * 5.5);
      ctx.lineTo(hx - ux * 10 + uy * 5.5, hy - uy * 10 - ux * 5.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // ---------- the card beside a sound ----------
  function hit(mx, my, reach) {
    let best = null, bd = Infinity;
    for (const p of poolPoints()) {
      const q = shownPos.get(p.id);
      if (!q) continue;
      const d = Math.hypot(q.x - mx, q.y - my);
      if (d < (reach ?? S0 * 0.62) && d < bd) { best = p.id; bd = d; }
    }
    return best;
  }
  function setActive(id, kbd = false) {
    if (id === active && kbd === activeKbd) return;
    active = id;
    activeKbd = kbd;
    cv.classList.toggle("hit", id != null && !kbd);
    renderPlate();
    drawMap();
  }
  function renderPlate() {
    if (active == null || !shownPos.get(active)) {
      plate.classList.remove("on");
      plate.setAttribute("aria-hidden", "true");
      return;
    }
    const id = active;
    const like = likeTarget.get(id);
    const name = host.nameOf(id) || "";
    plate.replaceChildren();
    const nm = document.createElement("div");
    nm.className = "ts-pl-name";
    nm.textContent = name;
    const gs = document.createElement("div");
    gs.className = "ts-pl-like";
    // The bank's number for it, as the ratings after the last pick have it.
    gs.textContent = fitted() && like != null ? words.plateGuess(like) : words.TASTE_LABELS.noGuess;
    gs.classList.toggle("guess", !fitted());
    const acts = document.createElement("div");
    acts.className = "ts-pl-acts";
    const playBtn = document.createElement("button");
    playBtn.className = "util-btn";
    playBtn.textContent = words.TASTE_LABELS.play;
    playBtn.title = words.playTitle(name);
    playBtn.onclick = () => host.play(id, playBtn);
    const openBtn = document.createElement("button");
    openBtn.className = "util-btn";
    openBtn.textContent = words.TASTE_LABELS.open;
    openBtn.title = words.TASTE_LABELS.openTitle;
    openBtn.disabled = id === host.subjectId();
    openBtn.onclick = () => host.open(id);
    acts.append(playBtn, openBtn);
    plate.append(nm, gs, acts);
    plate.classList.add("on");
    plate.setAttribute("aria-hidden", "false");
    placePlate();
  }
  function placePlate() {
    const q = shownPos.get(active);
    if (!q) return;
    const pw = plate.offsetWidth || 240;
    const ph = plate.offsetHeight || 100;
    const gap = S0 * 0.5 + 14;
    let px = q.x + gap;
    if (px + pw > W - 10) px = q.x - gap - pw;
    if (px < 10) px = Math.min(W - pw - 10, Math.max(10, q.x - pw / 2));
    let py = q.y - ph / 2;
    if (px < q.x + gap && px + pw > q.x - gap) py = q.y - gap - ph < 10 ? q.y + gap : q.y - gap - ph;
    py = Math.max(10, Math.min(H - ph - 10, py));
    plate.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px)`;
  }
  /** The nearest sound in an arrow key's direction (the prototype's `step`). */
  function stepTo(key) {
    const list = poolPoints();
    const fromId = active ?? host.subjectId();
    const from = shownPos.get(fromId);
    if (active == null || !from) {
      setActive(from ? fromId : list[0]?.id ?? null, true);
      return;
    }
    const v = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
    let best = null, bs = Infinity;
    for (const p of list) {
      if (p.id === active) continue;
      const q = shownPos.get(p.id);
      if (!q) continue;
      const dx = q.x - from.x, dy = q.y - from.y, d = Math.hypot(dx, dy);
      if (d < 1) continue;
      const cos = (dx * v[0] + dy * v[1]) / d;
      if (cos < 0.45) continue;
      const score = d * (1 + 2.2 * Math.sqrt(1 - cos * cos));
      if (score < bs) { bs = score; best = p.id; }
    }
    if (best != null) setActive(best, true);
  }

  cv.addEventListener("pointermove", (e) => {
    // A finger has no hover: a tap opens the sound, which is what the card offers.
    if (e.pointerType !== "mouse") return;
    const b = cv.getBoundingClientRect();
    const id = hit(e.clientX - b.left, e.clientY - b.top);
    if (id != null) {
      clearTimeout(plateTimer);
      if (id !== active || activeKbd) setActive(id, false);
    } else if (active != null && !activeKbd) {
      clearTimeout(plateTimer);
      plateTimer = setTimeout(() => setActive(null), PLATE_LINGER_MS);
    }
  });
  cv.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "mouse" || activeKbd) return;
    clearTimeout(plateTimer);
    plateTimer = setTimeout(() => setActive(null), PLATE_LINGER_MS);
  });
  plate.addEventListener("pointerenter", () => clearTimeout(plateTimer));
  plate.addEventListener("pointerleave", () => {
    if (activeKbd) return;
    clearTimeout(plateTimer);
    plateTimer = setTimeout(() => setActive(null), PLATE_LINGER_MS);
  });
  cv.addEventListener("click", (e) => {
    const b = cv.getBoundingClientRect();
    const id = hit(e.clientX - b.left, e.clientY - b.top, e.pointerType === "mouse" ? undefined : 26);
    if (id != null) host.open(id);
  });
  cv.addEventListener("keydown", (e) => {
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      stepTo(e.key);
    } else if (e.key === "Enter" && active != null) {
      e.preventDefault();
      host.open(active);
    } else if (e.key === "Escape" && active != null) {
      setActive(null);
    }
  });
  cv.addEventListener("focus", () => {
    if (!cv.matches(":focus-visible")) return;
    if (active == null) setActive(host.subjectId() ?? poolPoints()[0]?.id ?? null, true);
  });
  cv.addEventListener("blur", () => {
    if (activeKbd) setActive(null);
  });

  function syncTasteText() {
    $("taste-sub").textContent = host.fittedFrom();
    const map = mapOf();
    const n = poolPoints().length;
    $("taste-foot").textContent = map && n ? words.mapFoot(n, (map.explained?.[0] || 0) + (map.explained?.[1] || 0)) : "";
    const legend = $("taste-legend");
    legend.classList.toggle("on", n > 0);
    legend.classList.toggle("guess", !fitted());
    legend.querySelector(".tl-words").textContent = words.haloLegend(fitted());
  }

  // =====================================================================
  // LEARNING: the model room
  // =====================================================================
  // The style whose weights are shown, by its index. A refit keeps each
  // style's index (the engine aligns them to the last fit's), so the choice
  // holds across refits; it is not saved, and a reload starts on the style
  // with the largest share.
  let styleK = null;
  let moreOpen = false;
  let gNow = null, gFrom = null, swing = null, ghost = null;
  let seenForecasts = 0, dropT = 0;
  const FEW_WEIGHTS = 6;

  function activeStyles() {
    const v = host.views();
    if (!v || !v.styles) return [];
    return v.styles.map((s, k) => ({ ...s, k })).filter((s) => s.share >= 0.02);
  }
  function chosenStyle() {
    const ss = activeStyles();
    if (!ss.length) return null;
    const pick = ss.find((s) => s.k === styleK);
    return pick || ss.slice().sort((a, b) => b.share - a.share)[0];
  }

  function renderChips() {
    const box = $("md-chips");
    const ss = activeStyles();
    box.replaceChildren();
    box.classList.toggle("hidden", !ss.length);
    const chosen = chosenStyle();
    for (const s of ss) {
      const color = host.styleColor(s.k);
      const chip = document.createElement("div");
      chip.className = "md-chip";
      chip.dataset.k = String(s.k);
      const pick = document.createElement("button");
      pick.className = "md-chip-pick";
      pick.setAttribute("role", "radio");
      pick.setAttribute("aria-checked", String(chosen && chosen.k === s.k));
      pick.title = words.TASTE_LABELS.chipTitle;
      // The chosen style's mark sits in a slot every chip keeps, left of the
      // swatch, so the name never moves.
      const mark = document.createElement("span");
      mark.className = "md-mark";
      mark.setAttribute("aria-hidden", "true");
      const sw = document.createElement("i");
      sw.style.background = color;
      const share = document.createElement("span");
      share.className = "md-chip-share";
      share.textContent = `${Math.round(s.share * 100)}%`;
      pick.append(mark, sw, share);
      pick.setAttribute("aria-label", words.chipSaid(host.styleName(s, s.k), s.share));
      pick.onclick = () => {
        styleK = s.k;
        renderLearning();
      };
      const input = document.createElement("input");
      input.className = "md-chip-name";
      input.maxLength = 24;
      input.value = s.name || "";
      input.placeholder = host.styleName(s, s.k);
      input.title = words.TASTE_LABELS.nameTitle;
      const fit = () => { input.size = Math.max(6, (input.value || input.placeholder).length + 1); };
      fit();
      input.addEventListener("input", fit);
      input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") input.blur(); });
      input.addEventListener("keyup", (e) => e.stopPropagation());
      // A rename updates this chip and the weights' label in place: a
      // rebuild here would replace the chip's ▶ under a pointer that blurred
      // the name by pressing it, and the press would be lost.
      input.onblur = () => {
        const name = input.value.trim();
        if ((s.name || "") === name) return;
        s.name = name;
        host.setStyleName(s.k, name);
        input.placeholder = host.styleName({ ...s, name: "" }, s.k);
        pick.setAttribute("aria-label", words.chipSaid(host.styleName(s, s.k), s.share));
        renderBars();
      };
      const play = document.createElement("button");
      play.className = "md-chip-play";
      play.textContent = "▶";
      const ex = s.exemplars && s.exemplars[0];
      if (ex == null) {
        play.disabled = true;
        play.title = words.TASTE_LABELS.noExemplarTitle;
      } else {
        play.title = words.TASTE_LABELS.exemplarTitle;
        play.onclick = () => host.play(ex, play);
      }
      play.setAttribute("aria-label", play.title);
      chip.append(pick, input, play);
      box.append(chip);
    }
  }

  function renderBars() {
    const box = $("md-bars");
    const s = chosenStyle();
    const more = $("md-more");
    box.replaceChildren();
    $("md-weights-none").classList.toggle("hidden", !!s);
    $("md-weights-none").textContent = words.NO_WEIGHTS;
    $("md-scale").classList.toggle("hidden", !s);
    if (!s) {
      more.classList.add("hidden");
      return;
    }
    const rows = [...s.theta].sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean));
    // One scale for every row, fitted as the module rail's are (taste-geom
    // `directionsScale`), in percent of the track's half-width.
    const scale = geom.directionsScale(rows, 50);
    rows.forEach((r, i) => {
      const mark = geom.pullMark(r, scale, 50);
      const row = document.createElement("div");
      row.className = `md-row${mark.guess ? " guess" : ""}${i >= FEW_WEIGHTS ? " extra" : ""}`;
      row.setAttribute("role", "listitem");
      const word = host.niceName(r.name);
      row.setAttribute("aria-label", words.weightSaid(word, r.mean, r.std, mark.guess));
      // A guess's mark sits in a slot every row keeps, left of the word, so
      // the word never moves (a "?" after it used to push nothing, but a
      // mark before it would have).
      const m = document.createElement("span");
      m.className = "md-mark";
      m.setAttribute("aria-hidden", "true");
      m.textContent = mark.guess ? "?" : "";
      const name = document.createElement("span");
      name.className = "md-name";
      name.setAttribute("aria-hidden", "true");
      const w = document.createElement("span");
      w.className = "md-word";
      w.textContent = word;
      const tech = document.createElement("span");
      tech.className = "md-tech";
      tech.textContent = String(r.name).split(":")[0];
      name.append(w, tech);
      const track = document.createElement("span");
      track.className = "md-track";
      track.setAttribute("aria-hidden", "true");
      const zero = document.createElement("i");
      zero.className = "md-zero";
      const bar = document.createElement("i");
      bar.className = `md-bar${mark.hollow ? " hollow" : ""}${r.mean < 0 ? " neg" : ""}`;
      bar.style.left = `${50 + Math.min(0, mark.len)}%`;
      bar.style.width = `${Math.abs(mark.len)}%`;
      const wh = document.createElement("i");
      wh.className = "md-whisker";
      wh.style.left = `${50 + mark.lo}%`;
      wh.style.width = `${Math.max(0, mark.hi - mark.lo)}%`;
      wh.style.opacity = String(mark.whiskerAlpha);
      track.append(zero, bar, wh);
      const val = document.createElement("span");
      val.className = "md-val";
      val.setAttribute("aria-hidden", "true");
      val.textContent = `${r.mean >= 0 ? "+" : "−"}${Math.abs(r.mean).toFixed(2)}`;
      row.append(m, name, track, val);
      box.append(row);
    });
    box.classList.toggle("collapsed", !moreOpen);
    more.classList.remove("hidden");
    more.setAttribute("aria-expanded", String(moreOpen));
    more.querySelector(".lbl").textContent = words.weightsMore(moreOpen, rows.length, FEW_WEIGHTS);
    const { settled, guesses } = geom.countPulls(rows.map((r) => geom.pullMark(r, scale, 50)));
    box.setAttribute("aria-label", words.weightsSaid(host.styleName(s, s.k), settled, guesses));
  }

  // ---------- where liking rises ----------
  const mdCv = $("md-map-cv");
  let MW = 0, MH = 0;
  const MPAD = 28;
  function miniPositions() {
    const pts = poolPoints();
    const out = new Map();
    if (!pts.length) return out;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    for (const p of pts) {
      out.set(p.id, {
        x: MPAD + ((p.x - x0) / Math.max(1e-9, x1 - x0)) * (MW - 2 * MPAD),
        y: MPAD + ((p.y - y0) / Math.max(1e-9, y1 - y0)) * (MH - 2 * MPAD),
      });
    }
    return out;
  }
  /** The direction now: least squares of the engine's ratings
   *  (`WasmEngine::belief`) on the engine's map (`taste_map`), as drawn. */
  function gradientNow(pos) {
    const r = ratingsNow();
    const pts = [];
    for (const [id, q] of pos) {
      const row = r.get(id);
      if (row) pts.push({ x: q.x, y: q.y, like: geom.liking(row.mean) });
    }
    return geom.likingGradient(pts);
  }
  function retarget() {
    // A new heading: the arrow turns to it from where it was drawn, and the
    // old heading stays a moment as a dashed ghost.
    const pos = miniPositions();
    const g = gradientNow(pos);
    const same = g && gNow && Math.abs(g.gx - gNow.gx) < 1e-12 && Math.abs(g.gy - gNow.gy) < 1e-12;
    if (same) return;
    const dur = motionMs("--d-move");
    if (gNow && g && visible === "learning" && dur > 0) {
      gFrom = gNow;
      swing = { t0: performance.now(), dur };
      ghost = { g: gNow, t0: performance.now() };
      busy.add("swing");
    } else {
      swing = null;
      ghost = null;
    }
    gNow = g;
  }
  function drawDirection(now = performance.now()) {
    if (visible !== "learning" || !MW) return;
    const ctx = sizeCanvas(mdCv, MW, MH);
    ctx.clearRect(0, 0, MW, MH);
    ctx.fillStyle = inkAlpha(INK.silk, 0.1);
    for (let i = 0; i <= 6; i++) for (let j = 0; j <= 4; j++) {
      ctx.fillRect(MPAD + (i * (MW - 2 * MPAD)) / 6 - 0.75, MPAD + (j * (MH - 2 * MPAD)) / 4 - 0.75, 1.5, 1.5);
    }
    const pos = miniPositions();
    const r = ratingsNow();
    const isFit = fitted();
    for (const [id, q] of pos) {
      if (isFit) {
        const l = geom.liking(r.get(id)?.mean ?? 0);
        const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, 5 + l * 14);
        g.addColorStop(0, inkAlpha(INK.amber, 0.1 + 0.4 * l));
        g.addColorStop(1, inkAlpha(INK.amber, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 5 + l * 14, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(q.x, q.y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = inkAlpha(INK.green, 0.55);
      ctx.fill();
    }
    let g = gNow;
    let swingK = 1;
    if (swing) {
      swingK = Math.min(1, (now - swing.t0) / swing.dur);
      if (swingK >= 1) { swing = null; }
    }
    if (ghost && now - ghost.t0 > motionMs("--d-move") + ARROW_HOLD_MS) ghost = null;
    if (!swing && !ghost) busy.delete("swing");
    const cx = MW / 2, cy = MH / 2;
    const span = Math.min(MW, MH) - 2 * MPAD;
    const room = Math.min(MW, MH) * 0.36;
    const arrow = (gg, k, style) => {
      const L = geom.arrowLength(gg, span, room);
      if (L < 1) return;
      const a = Math.atan2(gg.gy, gg.gx);
      const ux = Math.cos(a), uy = Math.sin(a);
      ctx.save();
      ctx.strokeStyle = style.color;
      ctx.fillStyle = style.color;
      ctx.lineWidth = style.width;
      if (style.dash) ctx.setLineDash(style.dash);
      if (style.glow) { ctx.shadowColor = inkAlpha(INK.amber, 0.6); ctx.shadowBlur = 10; }
      ctx.beginPath();
      ctx.moveTo(cx - ux * L * 0.5, cy - uy * L * 0.5);
      ctx.lineTo(cx + ux * L * 0.5, cy + uy * L * 0.5);
      ctx.stroke();
      if (style.head) {
        ctx.setLineDash([]);
        const hx = cx + ux * L * 0.5, hy = cy + uy * L * 0.5;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx - ux * 11 - uy * 6, hy - uy * 11 + ux * 6);
        ctx.lineTo(hx - ux * 11 + uy * 6, hy - uy * 11 - ux * 6);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    };
    // Where it pointed before the last pick, fading.
    if (ghost && ghost.g) {
      const age = (now - ghost.t0) / (motionMs("--d-move") + ARROW_HOLD_MS);
      arrow(ghost.g, 1, { color: inkAlpha(INK.amber, Math.max(0, 0.5 * (1 - age))), width: 1.5, dash: [3, 5] });
    }
    if (g) {
      if (swing && gFrom) {
        const e = settleCurve(swingK);
        const a = geom.turnBetween(Math.atan2(gFrom.gy, gFrom.gx), Math.atan2(g.gy, g.gx), e);
        const m0 = Math.hypot(gFrom.gx, gFrom.gy), m1 = Math.hypot(g.gx, g.gy), m = m0 + (m1 - m0) * e;
        g = { gx: Math.cos(a) * m, gy: Math.sin(a) * m, r2: g.r2 };
      }
      arrow(g, 1, isFit
        ? { color: INK.amber, width: 2, glow: true, head: true }
        : { color: inkAlpha(INK.amber, 0.75), width: 2, dash: [5, 5], head: true });
    }
    // The sound you're playing: a green ring and its name.
    const sid = host.subjectId();
    const sq = pos.get(sid);
    if (sq) {
      ctx.beginPath();
      ctx.arc(sq.x, sq.y, 9, 0, Math.PI * 2);
      ctx.strokeStyle = INK.green;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = inkAlpha(INK.green, 0.7);
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = inkAlpha(INK.silk, 0.9);
      text(ctx, host.nameOf(sid) || "", sq.x, Math.min(MH - 4, sq.y + 24), "center");
    }
    const legend = words.directionLegend(gNow);
    $("md-maplegend").textContent = legend;
    mdCv.setAttribute("aria-label", words.directionSaid(sq ? host.nameOf(sid) : "", legend));
  }

  // ---------- its forecasts ----------
  const stripCv = $("md-strip-cv");
  let SW = 0;
  // Tall enough that the labels' descenders stay inside it.
  const SH = 48;
  function scored() {
    return geom.scoredForecasts(host.engine().forecasts);
  }
  function renderForecasts() {
    const fc = $("md-fc");
    const list = scored();
    const sc = geom.forecastScore(list);
    fc.replaceChildren();
    const big = document.createElement("div");
    big.className = "md-big";
    const note = document.createElement("p");
    note.className = "md-fcnote";
    if (!sc) {
      big.classList.add("hidden");
      note.textContent = words.noForecasts(fitted());
    } else {
      big.textContent = String(sc.hits);
      const of = document.createElement("span");
      of.textContent = ` / ${sc.n}`;
      big.append(of);
      note.textContent = words.forecastNote(sc);
    }
    fc.append(big, note);
    $("md-skill").textContent = host.skillText();
    $("md-kinds").textContent = host.kindsText();
    if (list.length > seenForecasts && seenForecasts > 0 && visible === "learning") {
      // A forecast that just landed: `WasmEngine::forecasts`, posted with the
      // calibration after the pick it scores.
      dropT = performance.now();
      busy.add("drop");
      kick();
    }
    seenForecasts = list.length;
    stripCv.setAttribute("aria-label", words.stripSaid(list.length));
  }
  function drawStrip(now = performance.now()) {
    if (visible !== "learning" || !SW) return;
    const ctx = sizeCanvas(stripCv, SW, SH);
    ctx.clearRect(0, 0, SW, SH);
    const L = 8, R = SW - 8, y = 16;
    const X = (p) => L + p * (R - L);
    ctx.fillStyle = tok("--hairline");
    ctx.fillRect(L, y, R - L, 1);
    ctx.fillRect(X(0.5) - 0.5, y - 6, 1, 12);
    ctx.fillStyle = INK.silkDim;
    text(ctx, "0%", L, 41, "left");
    text(ctx, "50%", X(0.5), 41, "center");
    text(ctx, SW < 410 ? words.TASTE_LABELS.stripEndShort : words.TASTE_LABELS.stripEnd, R, 41, "right");
    const list = scored();
    const drop = motionMs("--d-move");
    list.forEach((f, k) => {
      const cx = X(f.p);
      let cy = y - ((k % 3) - 1) * 4;
      if (k === list.length - 1 && busy.has("drop")) {
        const a = drop > 0 ? Math.min(1, (now - dropT) / drop) : 1;
        cy -= 16 * (1 - settleCurve(a));
        if (a >= 1) busy.delete("drop");
      }
      ctx.beginPath();
      ctx.arc(cx, cy, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = f.hit ? INK.amber : inkAlpha(INK.amber, 0.35);
      ctx.fill();
    });
  }

  // ---------- copy as JSON, and the math ----------
  function exportData() {
    const v = host.views() || {};
    const e = host.engine();
    return {
      taught: host.taught(),
      facts: e.facts || null,
      styles: (v.styles || []).map((s, k) => ({
        k,
        name: host.styleName(s, k),
        share: s.share,
        weights: s.theta.map((t) => ({ name: t.name, word: host.niceName(t.name), mean: t.mean, std: t.std })),
      })),
      ratings: ((v.ratings && v.ratings.ranked) || []).map((r) => ({ id: r.id, name: host.nameOf(r.id), mean: r.mean, std: r.std, style: r.style })),
      forecasts: e.forecasts || [],
      calibration: e.calib || null,
    };
  }
  function copyJson() {
    const btn = $("md-copy");
    const ta = $("md-json");
    const textOut = JSON.stringify(exportData(), null, 2);
    const say = (state) => { btn.querySelector(".lbl").textContent = words.copyLabel(state); };
    const fallback = () => {
      ta.hidden = false;
      ta.value = textOut;
      ta.focus();
      ta.select();
      say("select");
    };
    try {
      navigator.clipboard.writeText(textOut).then(() => {
        ta.hidden = false;
        ta.value = textOut;
        say("copied");
        setTimeout(() => say("idle"), 1600);
      }, fallback);
    } catch (_) {
      fallback();
    }
  }
  $("md-copy").addEventListener("click", copyJson);
  const mathBtn = $("md-math-btn");
  mathBtn.addEventListener("click", () => {
    const open = mathBtn.getAttribute("aria-expanded") !== "true";
    mathBtn.setAttribute("aria-expanded", String(open));
    $("md-math").hidden = !open;
  });
  $("md-more").addEventListener("click", () => {
    moreOpen = !moreOpen;
    renderBars();
  });
  function renderMath() {
    const facts = host.engine().facts;
    const box = $("md-math-lines");
    box.replaceChildren();
    if (!facts) return;
    for (const line of words.mathLines(facts, host.fitEvery)) {
      const p = document.createElement("p");
      p.textContent = line;
      box.append(p);
    }
  }

  function renderLearning() {
    $("md-sub").textContent = host.fittedFrom();
    $("view-learning").classList.toggle("guess", !fitted());
    renderChips();
    renderBars();
    renderForecasts();
    renderMath();
    drawDirection();
    drawStrip();
  }
  function resizeLearning() {
    const wl = mdCv.parentElement;
    MW = Math.max(160, wl.clientWidth);
    MH = Math.max(120, wl.clientHeight);
    SW = Math.max(120, stripCv.parentElement.clientWidth);
  }

  // =====================================================================
  // main.js calls these
  // =====================================================================
  new ResizeObserver(() => {
    if (visible !== "taste") return;
    resizeMap();
    drawMap();
    placePlate();
  }).observe(well);
  new ResizeObserver(() => {
    if (visible !== "learning") return;
    resizeLearning();
    drawDirection();
    drawStrip();
  }).observe($("view-learning"));

  /** The views or the ratings changed (a refit, a generation, an import, a
   *  child landing, a pick): adopt what is new. */
  function sync() {
    const map = mapOf();
    const ratings = host.views()?.ratings || null;
    const fit = fitted();
    if (visible === "taste") {
      if (map !== seenMap || fit !== seenFitted) {
        // A views post: a refit, a generation, an import. Every halo and
        // every place settles together (`taste_map`, `belief`).
        const settle = seenMap != null && map != null && map !== seenMap && fit && seenFitted;
        seenMap = map;
        seenFitted = fit;
        adopt({ move: true });
        if (settle) live.textContent = words.refitSaid();
      } else if (ratings !== seenRatings) {
        adopt({ move: false });
      }
      seenRatings = ratings;
      syncTasteText();
      renderPlate();
      kick();
    } else if (visible === "learning") {
      retarget();
      renderLearning();
      kick();
    }
  }

  return {
    /** Which view is showing. Called by `showView`. */
    setView(name) {
      const was = visible;
      visible = name === "taste" || name === "learning" ? name : null;
      if (visible !== "taste") setActive(null);
      if (visible === "taste" && was !== "taste") {
        measureMap();
        seenMap = mapOf();
        seenFitted = fitted();
        seenRatings = host.views()?.ratings || null;
        if (!likeShown.size) {
          // The first look: the map as the engine has it, nothing moving.
          relayout();
          shownPos = new Map(target);
          adopt({ move: false });
          likeShown = new Map(likeTarget);
          tween = null;
          busy.delete("glow");
        } else {
          // What the map last showed, settling to what the engine says now
          // (`taste_map`, `belief`), and the picks made since, each drawn in
          // turn from its own `record_duel` reply.
          adopt({ move: true });
        }
        const t0 = performance.now();
        const recent = arrivals.slice(-ARRIVALS_MAX);
        recent.forEach((a, i) => strokes.push({ a: a.a, b: a.b, t0: t0 + i * ARRIVAL_GAP_MS }));
        const last = recent[recent.length - 1];
        if (last && target.has(last.a) && target.has(last.b)) live.textContent = words.pickSaid(host.nameOf(last.b), host.nameOf(last.a));
        arrivals = [];
        syncTasteText();
        drawMap();
        kick();
      }
      if (visible === "learning" && was !== "learning") {
        resizeLearning();
        gNow = gradientNow(miniPositions());
        swing = null;
        ghost = null;
        seenForecasts = scored().length;
        renderLearning();
      }
    },
    /** Redraw with whatever views main now holds. */
    draw: sync,
    /** A `status` reply: a pick, a star or a cut the engine took, with the
     *  ratings it left (`WasmEngine::belief`). A pair's pick (`record_duel`)
     *  also draws its arrow, from the sound passed to the sound picked. */
    onStatus(m) {
      if (!m || m.recorded === false || !m.ratings) return;
      const v = m.vote;
      const pick = v && v.kind === "duel" && v.a != null && v.b != null && typeof m.choseA === "boolean"
        ? { a: m.choseA ? v.b : v.a, b: m.choseA ? v.a : v.b }
        : null;
      if (pick && visible === "taste") {
        strokes.push({ ...pick, t0: performance.now() });
        if (shownPos.get(pick.a) && shownPos.get(pick.b)) {
          live.textContent = words.pickSaid(host.nameOf(pick.b), host.nameOf(pick.a));
        }
      } else if (pick) {
        arrivals.push(pick);
        if (arrivals.length > ARRIVALS_MAX) arrivals.shift();
      }
      sync();
    },
    /** A `calibration` reply: the forecasts and the math's numbers. */
    onCalibration() {
      if (visible === "learning") {
        renderForecasts();
        renderMath();
        kick();
      }
    },
  };
}
