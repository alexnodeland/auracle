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
//     the calibration after every pick;
//   - the weight bars moving after a pick: the `styles` reply that follows it
//     (`WasmEngine::styles`, the reweighted θ);
//   - the track's scrub and its replay, and LEARNING's replay: those same
//     replies, kept in the page as they came (taste-geom's history), since
//     the engine keeps no history of its own;
//   - the small map shaded by a feature: `WasmEngine::pool_features`, each
//     sound's z, posted with every views post.
// What the engine does not record is not drawn: no arrow for a pick whose two
// sounds are not both on the map (a PERFORM offer is never in the pool), and
// no moment on the track from before the page began keeping them.
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
  // While TASTE's track shows an earlier moment, `scrubView` is that moment
  // as it was posted (taste-geom `entryView`), and the map draws from it.
  let scrubView = null;
  const fitted = () => (scrubView ? scrubView.fit : !!(host.views() && host.views().styles));
  const mapOf = () => {
    if (scrubView) return scrubView.map;
    const v = host.views();
    return v && v.map && Array.isArray(v.map.points) ? v.map : null;
  };
  /** The pool's map points, without the history ghosts or what was cut (an
   *  earlier moment shows its pool as it was). */
  const poolPoints = () => (mapOf()?.points || []).filter((p) => p.id != null && (scrubView || !host.isCut(p.id)));
  /** id → {mean, std} as the engine rates the pool now: the ratings after
   *  the last pick (`WasmEngine::belief`), else the map's own numbers. */
  function ratingsNow() {
    if (scrubView) return scrubView.ratings;
    const out = new Map();
    for (const p of mapOf()?.points || []) if (p.id != null) out.set(p.id, { mean: p.utility, std: p.utility_std });
    const r = host.views()?.ratings;
    if (r && Array.isArray(r.ranked)) for (const row of r.ranked) out.set(row.id, { mean: row.mean, std: row.std });
    return out;
  }

  // ---------- the history: what was posted, kept (taste-geom) ----------
  let history = geom.newHistory();
  /** Keep the views as they stand now, as one moment of `kind`. */
  function record(kind, pick, obs) {
    const v = host.views();
    if (!v || !v.map || !Array.isArray(v.map.points)) return null;
    const r = v.ratings && Array.isArray(v.ratings.ranked)
      ? v.ratings.ranked.map((x) => ({ id: x.id, mean: x.mean, std: x.std }))
      : v.map.points.filter((p) => p.id != null).map((p) => ({ id: p.id, mean: p.utility, std: p.utility_std }));
    const droppedBefore = history.dropped || 0;
    const entry = geom.recordEntry(history, {
      kind, pick, obs: obs ?? host.observations(), n: host.picks(), gen: host.generation(),
      fit: !!v.styles, map: v.map, ratings: r,
    });
    // At the bound the oldest moments go from the front: a moment being
    // looked at, and the replay's place, move with what they show.
    const dropped = (history.dropped || 0) - droppedBefore;
    if (dropped > 0) {
      if (scrub != null) {
        scrub = Math.max(0, scrub - dropped);
        scrubView = geom.entryView(history, scrub);
      }
      if (replayT) replayI = Math.max(0, replayI - dropped);
    }
    host.scheduleSave();
    return entry;
  }
  // A taste file was opened: the next map is its moment, a boundary.
  let fileNext = false;

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
  // SOUND (false) or TASTE (true): the toggle at the map's top left. Not
  // saved, as in the prototype.
  let tasteMode = false;
  // The model view (⌥, shell.js) drives TASTE's side of the toggle while it
  // is up, so there is one model view, not two; the toggle comes back to
  // where the player left it when it goes.
  let modelView = false;
  const tasteOn = () => tasteMode || modelView;
  let scrub = null; // the track's moment shown, an index into the history, or null for now
  const halosOn = () => fitted() || tasteOn() || scrub != null;

  // The track shows once there are two moments to move between.
  const trackOn = () => history.entries.length >= 2;
  function relayout() {
    const pts = poolPoints();
    const frame = geom.mapFrame(W, H, pts.length, { track: trackOn() });
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
    // after a refit) through the bank's logistic. As in the prototype, SOUND
    // shows them once there is a fit (and on the track); TASTE always, dashed
    // while there is no fit, and dims each sound by how little it is liked.
    if (halosOn()) for (const p of pts) {
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
      ctx.globalAlpha = tasteOn() && isFit ? 0.22 + 0.78 * (likeShown.get(p.id) ?? 0.5) : 1;
      drawMark(ctx, p.id, q.x, q.y, r);
      ctx.globalAlpha = 1;
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
    // Focus inside the card: its words follow, its buttons stay put.
    if (plate.dataset.id === String(id) && plate.contains(document.activeElement)) {
      const gs = plate.querySelector(".ts-pl-like");
      if (gs) gs.textContent = fitted() && like != null ? words.plateGuess(like) : words.TASTE_LABELS.noGuess;
      return;
    }
    plate.dataset.id = String(id);
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
      // The press spent on the point (the model view, which takes Esc last,
      // waits for the next one).
      e.preventDefault();
      setActive(null);
    }
  });
  cv.addEventListener("focus", () => {
    if (!cv.matches(":focus-visible")) return;
    if (active == null) setActive(host.subjectId() ?? poolPoints()[0]?.id ?? null, true);
  });
  // The card stays while focus moves into it, so its ▶ PLAY and OPEN can be
  // reached with Tab; it closes when focus leaves both.
  cv.addEventListener("blur", (e) => {
    if (activeKbd && !plate.contains(e.relatedTarget)) setActive(null);
  });
  plate.addEventListener("focusout", (e) => {
    if (activeKbd && !plate.contains(e.relatedTarget) && e.relatedTarget !== cv) setActive(null);
  });

  function syncTasteText() {
    $("taste-sub").textContent = scrub != null ? words.LOOKING_BACK : host.fittedFrom();
    const map = mapOf();
    const n = poolPoints().length;
    $("taste-foot").textContent = map && n ? words.mapFoot(n, (map.explained?.[0] || 0) + (map.explained?.[1] || 0)) : "";
    const legend = $("taste-legend");
    legend.classList.toggle("on", n > 0 && halosOn());
    legend.classList.toggle("guess", !fitted());
    legend.querySelector(".tl-words").textContent = words.haloLegend(fitted());
  }

  // ---------- SOUND / TASTE ----------
  const tog = $("taste-tog");
  tog.title = words.TASTE_LABELS.togTitle;
  tog.addEventListener("click", () => {
    tasteMode = !tasteMode;
    tog.setAttribute("aria-pressed", String(tasteOn()));
    syncTasteText();
    drawMap();
  });

  // ---------- taste over time: the track ----------
  // Every moment the page kept (taste-geom's history) as a tick: amber for a
  // pick (thin and dim before the first fit), silk below the line for a star
  // or a cut, a faint line where it first fitted, a green diamond for a
  // generation with how many sounds joined the map. Scrubbing shows the map
  // as it was posted then, and the step's own pick as its arrow: forward as
  // taught, backward reversed.
  const time = $("taste-time");
  const track = $("taste-track");
  const tcv = $("taste-track-cv");
  const tlabel = $("taste-tlabel");
  const tplay = $("taste-tplay");
  const TPAD = 12;
  let replayT = 0;
  let replayI = 0;
  tplay.setAttribute("aria-label", words.TASTE_LABELS.trackPlay);
  tplay.title = words.TASTE_LABELS.trackPlay;
  track.setAttribute("aria-label", words.TASTE_LABELS.track);

  function indexAt(e) {
    const r = track.getBoundingClientRect();
    const n = history.entries.length;
    const k = (e.clientX - r.left - TPAD) / Math.max(1, r.width - 2 * TPAD);
    return Math.round(Math.max(0, Math.min(1, k)) * (n - 1));
  }
  function setScrub(i) {
    const last = history.entries.length - 1;
    if (last < 0) return;
    i = Math.max(0, Math.min(last, i));
    const next = i >= last ? null : i;
    if (next === scrub) return;
    const from = scrub ?? last;
    const fwd = i > from;
    scrub = next;
    scrubView = next == null ? null : geom.entryView(history, next);
    // The step's own pick, as it was posted with that moment: only for a
    // step of one moment, not a jump (Home, End, a fast drag), which would
    // credit one pick with everything in between.
    const step = Math.abs(i - from) === 1 ? geom.entryView(history, fwd ? i : from) : null;
    strokes = step && step.pick
      ? [{ a: fwd ? step.pick.a : step.pick.b, b: fwd ? step.pick.b : step.pick.a, t0: performance.now() }]
      : [];
    if (next == null) {
      seenMap = mapOf();
      seenFitted = fitted();
      seenRatings = host.views()?.ratings || null;
      // Picks that came while looking back were drawn on the track, not as
      // arrivals.
      arrivals = [];
    }
    adopt({ move: true });
    syncTasteText();
    drawTime();
    renderPlate();
    kick();
  }
  function stopReplay() {
    if (!replayT) return;
    clearInterval(replayT);
    replayT = 0;
    tplay.classList.remove("on");
    tplay.setAttribute("aria-label", words.TASTE_LABELS.trackPlay);
    tplay.title = words.TASTE_LABELS.trackPlay;
  }
  // The replay steps through every kept moment from the first, on a timer
  // (when each step comes, not how it moves); under reduced motion each step
  // jumps.
  function replay() {
    if (replayT) { stopReplay(); return; }
    const n = history.entries.length;
    if (n < 2) return;
    replayI = 0;
    setScrub(0);
    tplay.classList.add("on");
    tplay.setAttribute("aria-label", words.TASTE_LABELS.trackStop);
    tplay.title = words.TASTE_LABELS.trackStop;
    const stepMs = Math.max(180, Math.min(520, 4200 / n));
    replayT = setInterval(() => {
      replayI += 1;
      setScrub(replayI);
      if (replayI >= history.entries.length - 1) stopReplay();
    }, stepMs);
  }
  tplay.addEventListener("click", replay);
  let tdown = false;
  track.addEventListener("pointerdown", (e) => {
    tdown = true;
    track.setPointerCapture(e.pointerId);
    track.focus({ preventScroll: true });
    stopReplay();
    setScrub(indexAt(e));
  });
  track.addEventListener("pointermove", (e) => { if (tdown) setScrub(indexAt(e)); });
  const tup = () => { tdown = false; };
  track.addEventListener("pointerup", tup);
  track.addEventListener("pointercancel", tup);
  track.addEventListener("keydown", (e) => {
    const last = history.entries.length - 1;
    const at = scrub ?? last;
    let to = null;
    if (e.key === "ArrowLeft") to = at - 1;
    else if (e.key === "ArrowRight") to = at + 1;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = last;
    if (to == null) return;
    e.preventDefault();
    e.stopPropagation();
    stopReplay();
    setScrub(to);
  });
  new ResizeObserver(() => drawTime()).observe(track);

  function drawTime() {
    const on = trackOn();
    const was = time.classList.contains("on");
    time.classList.toggle("on", on);
    if (on !== was && visible === "taste" && W) {
      resizeMap();
      drawMap();
      placePlate();
    }
    if (!on || visible !== "taste") return;
    const w = Math.max(40, track.clientWidth);
    const h = Math.max(20, track.clientHeight);
    const ctx = sizeCanvas(tcv, w, h);
    ctx.clearRect(0, 0, w, h);
    const es = history.entries;
    const n = es.length;
    const last = n - 1;
    const at = scrub ?? last;
    const base = Math.round(h * 0.62);
    const X = (i) => TPAD + (n > 1 ? i / last : 0) * (w - 2 * TPAD);
    ctx.fillStyle = tok("--hairline");
    ctx.fillRect(TPAD, base, w - 2 * TPAD, 1);
    const fitAt = es.findIndex((e) => e.fit);
    if (fitAt > 0) {
      ctx.fillStyle = inkAlpha(INK.amber, 0.18);
      ctx.fillRect(X(fitAt) - 0.5, 4, 1, h - 8);
    }
    ctx.beginPath();
    ctx.arc(X(0), base, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = INK.silk;
    ctx.fill();
    for (let i = 1; i < n; i++) {
      const e = es[i];
      const past = i <= at;
      if (e.kind === "gen") continue; // its diamond, below
      if (e.kind === "file") {
        // A taste file opened here: what comes after is another taste.
        ctx.fillStyle = inkAlpha(INK.silk, past ? 0.85 : 0.35);
        ctx.fillRect(X(i) - 1, 2, 2, h - 4);
      } else if (e.kind === "map") {
        ctx.fillStyle = inkAlpha(INK.amber, past ? 0.3 : 0.12);
        ctx.fillRect(X(i) - 0.5, 6, 1, h - 12);
      } else if (e.kind === "star" || e.kind === "cut" || e.kind === "keep") {
        ctx.fillStyle = inkAlpha(INK.silk, past ? 0.7 : 0.3);
        ctx.fillRect(X(i) - 0.5, base + 2, 1, 6);
      } else {
        ctx.fillStyle = inkAlpha(INK.amber, (e.fit ? 0.95 : 0.5) * (past ? 1 : 0.45));
        ctx.fillRect(X(i) - (e.fit ? 1 : 0.5), base - 11, e.fit ? 2 : 1, 11);
      }
    }
    for (let i = 1; i < n; i++) {
      const e = es[i];
      if (e.kind !== "gen") continue;
      const past = i <= at;
      const gx = X(i);
      ctx.save();
      ctx.translate(gx, base);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = past ? INK.green : inkAlpha(INK.green, 0.4);
      ctx.fillRect(-3.5, -3.5, 7, 7);
      ctx.restore();
      if (e.joined) {
        ctx.fillStyle = inkAlpha(INK.green, past ? 0.9 : 0.4);
        text(ctx, words.joinedLabel(e.joined), gx + 7, base - 4, "left");
      }
    }
    const hx = X(at);
    ctx.fillStyle = inkAlpha(INK.silk, scrub != null ? 0.9 : 0.5);
    ctx.fillRect(hx - 0.5, 3, 1, h - 6);
    ctx.beginPath();
    ctx.arc(hx, base, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = INK.silk;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = tok("--bezel");
    ctx.stroke();
    // Now says the count the title says (TAUGHT's picks, which counts a pick
    // the moment it is made); a past moment says the engine's count then.
    const label = scrub == null ? words.trackLabel(host.taught().picks, true) : words.trackLabel(es[at].n, false);
    tlabel.textContent = label;
    track.setAttribute("aria-valuemax", String(last));
    track.setAttribute("aria-valuenow", String(at));
    track.setAttribute("aria-valuetext", label);
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
    if (document.activeElement && box.contains(document.activeElement) && document.activeElement.matches("input")) return;
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
        stopBarReplay();
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

  // The rows are kept per feature and updated in place, so a bar moves to a
  // new weight (a CSS transition on `--d-move`) rather than being redrawn.
  const rowEls = new Map(); // feature name → its row's elements
  let shownK = null;        // the style the rows draw
  let barReplay = null;     // {list, i, timer} while REPLAY runs
  let barHover = null;      // the feature pointed at, shading the small map

  function rowFor(name) {
    let el = rowEls.get(name);
    if (el) return el;
    const row = document.createElement("div");
    row.setAttribute("role", "listitem");
    row.tabIndex = 0;
    // A guess's mark sits in a slot every row keeps, left of the word, so
    // the word never moves.
    const mark = document.createElement("span");
    mark.className = "md-mark";
    mark.setAttribute("aria-hidden", "true");
    const nameEl = document.createElement("span");
    nameEl.className = "md-name";
    nameEl.setAttribute("aria-hidden", "true");
    const word = document.createElement("span");
    word.className = "md-word";
    word.textContent = host.niceName(name);
    const tech = document.createElement("span");
    tech.className = "md-tech";
    tech.textContent = String(name).split(":")[0];
    nameEl.append(word, tech);
    const track = document.createElement("span");
    track.className = "md-track";
    track.setAttribute("aria-hidden", "true");
    const zero = document.createElement("i");
    zero.className = "md-zero";
    // Where the weight was before a replayed pick, dashed, while it moves.
    const ghostEl = document.createElement("i");
    ghostEl.className = "md-ghost";
    const bar = document.createElement("i");
    const whisk = document.createElement("i");
    whisk.className = "md-whisker";
    track.append(zero, ghostEl, bar, whisk);
    const val = document.createElement("span");
    val.className = "md-val";
    val.setAttribute("aria-hidden", "true");
    row.append(mark, nameEl, track, val);
    // Pointing at a weight shades the small map by that feature's z.
    const on = () => { barHover = name; row.classList.add("lit"); drawDirection(); };
    const off = () => { if (barHover === name) barHover = null; row.classList.remove("lit"); drawDirection(); };
    row.addEventListener("pointerenter", on);
    row.addEventListener("pointerleave", off);
    row.addEventListener("focus", on);
    row.addEventListener("blur", off);
    el = { row, mark, bar, ghostEl, whisk, val };
    rowEls.set(name, el);
    return el;
  }

  /** The weights as bars: the chosen style's θ, or, during REPLAY, a kept
   *  moment's (`view`: the style with that moment's θ, the one before it as
   *  `prev`, and the feature it moved most). */
  function renderBars(view = null) {
    const box = $("md-bars");
    const s = view || chosenStyle();
    const more = $("md-more");
    $("md-weights-none").classList.toggle("hidden", !!s);
    $("md-weights-none").textContent = words.NO_WEIGHTS;
    $("md-scale").classList.toggle("hidden", !s);
    if (!s) {
      box.replaceChildren();
      rowEls.clear();
      shownK = null;
      more.classList.add("hidden");
      return;
    }
    if (s.k !== shownK) {
      // Another style: its rows, without motion.
      box.replaceChildren();
      rowEls.clear();
      shownK = s.k;
    }
    const rows = [...s.theta].sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean));
    // One scale for every row, fitted as the module rail's are (taste-geom
    // `directionsScale`), in percent of the track's half-width.
    const scale = geom.directionsScale(view && view.prev ? [...rows, ...view.prev] : rows, 50);
    const prev = view && view.prev ? new Map(view.prev.map((t) => [t.name, t])) : null;
    const keep = new Set();
    rows.forEach((r, i) => {
      const el = rowFor(r.name);
      keep.add(r.name);
      const mark = geom.pullMark(r, scale, 50);
      el.row.className = `md-row${mark.guess ? " guess" : ""}${i >= FEW_WEIGHTS ? " extra" : ""}` +
        `${view && view.moved === r.name ? " moved" : ""}${barHover === r.name ? " lit" : ""}`;
      el.row.setAttribute("aria-label", words.weightSaid(host.niceName(r.name), r.mean, r.std, mark.guess));
      el.mark.textContent = mark.guess ? "?" : "";
      el.bar.className = `md-bar${mark.hollow ? " hollow" : ""}${r.mean < 0 ? " neg" : ""}`;
      el.bar.style.left = `${50 + Math.min(0, mark.len)}%`;
      el.bar.style.width = `${Math.abs(mark.len)}%`;
      el.whisk.style.left = `${50 + mark.lo}%`;
      el.whisk.style.width = `${Math.max(0, mark.hi - mark.lo)}%`;
      el.whisk.style.opacity = String(mark.whiskerAlpha);
      const p = prev && prev.get(r.name);
      if (p) {
        const pm = geom.pullMark(p, scale, 50);
        el.ghostEl.style.left = `${50 + Math.min(0, pm.len)}%`;
        el.ghostEl.style.width = `${Math.abs(pm.len)}%`;
        el.ghostEl.classList.add("on");
      } else el.ghostEl.classList.remove("on");
      el.val.textContent = `${r.mean >= 0 ? "+" : "−"}${Math.abs(r.mean).toFixed(2)}`;
      box.append(el.row);
    });
    for (const [name, el] of rowEls) {
      if (keep.has(name)) continue;
      el.row.remove();
      rowEls.delete(name);
    }
    box.classList.toggle("collapsed", !moreOpen);
    more.classList.remove("hidden");
    more.setAttribute("aria-expanded", String(moreOpen));
    more.querySelector(".lbl").textContent = words.weightsMore(moreOpen, rows.length, FEW_WEIGHTS);
    const { settled, guesses } = geom.countPulls(rows.map((r) => geom.pullMark(r, scale, 50)));
    box.setAttribute("aria-label", words.weightsSaid(host.styleName(s, s.k), settled, guesses));
    syncReplayButton();
  }

  // ---------- REPLAY: the weights through the picks ----------
  // Each kept moment that has the styles posted after it (`styles`, taste-geom
  // `attachStyles`), for the chosen style, in turn: the bars move to each,
  // the one before stays a moment as a dashed ghost, and the weight that
  // moved most lights. The steps come on a timer (when, not how it moves);
  // under reduced motion each step jumps.
  const replayBtn = $("md-replay");
  function replayList() {
    const s = chosenStyle();
    if (!s) return [];
    const out = [];
    for (let i = 0; i < history.entries.length; i++) {
      if (!history.entries[i].s) continue;
      const v = geom.entryView(history, i);
      const st = v.styles && v.styles[s.k];
      if (st) out.push({ n: v.n, kind: v.kind, obs: history.entries[i].obs, theta: st.theta });
    }
    return out;
  }
  function syncReplayButton() {
    const can = replayList().length >= 2;
    replayBtn.disabled = !can && !barReplay;
    replayBtn.title = can ? words.TASTE_LABELS.replayTitle : words.TASTE_LABELS.noReplayTitle;
  }
  // A step is credited to what it was: a pick only when both moments are
  // picks and one observation apart (`obs`); a refit, a generation, an
  // opened file, a star or a cut by name; anything wider as the change since
  // the moment before. Only a single pick's step draws its ghost and lights
  // the weight it moved most.
  const PICKS = new Set(["pick", "offer"]);
  let liveAt = 0;
  function replayStep() {
    const r = barReplay;
    const cur = r.list[r.i];
    const prev = r.i > 0 ? r.list[r.i - 1] : null;
    let moved = null, d = 0;
    if (prev) {
      const before = new Map(prev.theta.map((t) => [t.name, t.mean]));
      for (const t of cur.theta) {
        const dd = t.mean - (before.get(t.name) ?? t.mean);
        if (Math.abs(dd) > Math.abs(d)) { d = dd; moved = t.name; }
      }
    }
    const single = !!prev && cur.obs === prev.obs + 1;
    const pickStep = single && PICKS.has(cur.kind) && PICKS.has(prev.kind);
    const s = chosenStyle();
    renderBars({ ...s, theta: cur.theta, prev: pickStep ? prev.theta : null, moved: pickStep ? moved : null });
    $("md-replay-at").textContent = words.replayAt(cur.kind, cur.n);
    // Said at most about once a second: a screen reader cannot keep up with
    // a step every few hundred ms.
    const now = performance.now();
    if (moved && now - liveAt >= 1000) {
      liveAt = now;
      $("md-replay-live").textContent = words.stepMoved(cur.kind, PICKS.has(cur.kind) ? pickStep : single, host.niceName(moved), d);
    }
  }
  function replayBars() {
    if (barReplay) { stopBarReplay(); return; }
    const list = replayList();
    if (list.length < 2) return;
    barReplay = { list, i: 0, timer: 0 };
    replayBtn.classList.add("on");
    replayStep();
    const stepMs = Math.max(180, Math.min(520, 4200 / list.length));
    barReplay.timer = setInterval(() => {
      barReplay.i += 1;
      if (barReplay.i >= barReplay.list.length) { stopBarReplay(); return; }
      replayStep();
    }, stepMs);
  }
  function stopBarReplay() {
    if (!barReplay) return;
    clearInterval(barReplay.timer);
    barReplay = null;
    replayBtn.classList.remove("on");
    $("md-replay-at").textContent = "";
    if (visible === "learning") renderBars();
  }
  replayBtn.addEventListener("click", replayBars);

  // ---------- where liking rises ----------
  const mdCv = $("md-map-cv");
  let MW = 0, MH = 0;
  const MPAD = 28;
  function miniPositions() {
    return geom.miniLayout(poolPoints(), MW, MH, MPAD);
  }
  /** The direction now: least squares of the engine's ratings
   *  (`WasmEngine::belief`) on the engine's map (`taste_map`), as drawn. */
  /** The direction now, as the engine fitted it (`Belief::direction`,
   *  `auracle_session::liking_direction`: liking on the map's two axes, with
   *  r²), on the small map as drawn: each axis is stretched to the panel, so
   *  the gradient is divided by the stretch. */
  function gradientNow() {
    const d = host.views()?.ratings?.direction;
    const pts = poolPoints();
    if (!d || pts.length < 2) return null;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const sx = (MW - 2 * MPAD) / Math.max(1e-9, Math.max(...xs) - Math.min(...xs));
    const sy = (MH - 2 * MPAD) / Math.max(1e-9, Math.max(...ys) - Math.min(...ys));
    return geom.directionOnScreen(d, sx, sy);
  }
  function retarget() {
    // A new heading: the arrow turns to it from where it was drawn, and the
    // old heading stays a moment as a dashed ghost.
    const g = gradientNow();
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
    // A weight pointed at: every sound shaded by its z on that feature, as
    // the engine posted it (`WasmEngine::pool_features`), against the
    // largest |z| among the sounds drawn (taste-geom `zByFeature`,
    // `poolShades`).
    const zOf = geom.zByFeature(host.views()?.features, barHover);
    const shades = zOf ? geom.poolShades(pos.keys(), zOf) : null;
    for (const [id, q] of pos) {
      if (shades) {
        const sh = shades.get(id);
        ctx.beginPath();
        ctx.arc(q.x, q.y, sh.r, 0, Math.PI * 2);
        ctx.fillStyle = inkAlpha(INK.green, sh.alpha);
        ctx.fill();
        continue;
      }
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
    const legend = zOf ? words.dotsLegend(host.niceName(barHover)) : words.directionLegend(gNow);
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
  let fcKey = "";
  function renderForecasts() {
    const fc = $("md-fc");
    const list = scored();
    const sc = geom.forecastScore(list);
    const key = JSON.stringify([sc, fitted()]);
    const same = key === fcKey;
    fcKey = key;
    // Rebuilt only when what it says changed: it is a live region, and a
    // rebuild is read out again.
    if (!same) {
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
    }
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
    if (!barReplay) renderBars();
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
   *  child landing, a pick): keep a new map as a moment, and adopt what is
   *  new. */
  let recordedMap = null;
  function sync() {
    const liveMap = host.views()?.map || null;
    if (liveMap && Array.isArray(liveMap.points) && liveMap !== recordedMap) {
      // The history begins with the first map this page is sent; after that,
      // each new map is a moment: a generation's when the engine's
      // generation count moved, a redraw's otherwise.
      const last = history.entries[history.entries.length - 1];
      const kind = !last ? "start" : fileNext ? "file" : host.generation() > last.gen ? "gen" : "map";
      fileNext = false;
      // The styles in force with this map (a refit's, a generation's, an
      // opened file's), so REPLAY credits its change to it, not to a pick.
      const entry = record(kind);
      if (entry && entry.kind === kind && host.views()?.styles) geom.setStyles(history, entry, host.views().styles);
      recordedMap = liveMap;
    }
    if (visible === "taste" && scrub != null) {
      // Looking back: the map stays on the moment shown; the track grows.
      drawTime();
      return;
    }
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
      drawTime();
      renderPlate();
      kick();
    } else if (visible === "learning") {
      retarget();
      renderLearning();
      kick();
    }
  }

  // R replays LEARNING's weights, as in the prototype, while LEARNING shows
  // and nothing is being typed.
  document.addEventListener("keydown", (e) => {
    if (visible !== "learning" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key !== "r" && e.key !== "R") return;
    if (e.target?.closest?.("input, select, textarea, [contenteditable]")) return;
    e.preventDefault();
    replayBars();
  });

  return {
    /** Where the level showing marks the sound you're playing, for the face
     *  carried between the levels (shell.js): its mark on TASTE's map, where
     *  the map puts it (`taste_map`, as it will rest when a settle moves it),
     *  at the size the map draws it; its ring on LEARNING's small map, which
     *  draws a dot there, not a face (the face lands small on the ring, and
     *  the dot is what is left once the move lands). In
     *  the page's pixels, `{id, x, y, size}` (the mark's centre, and its
     *  size as `host.drawFace` takes it), or null: not showing, or the sound
     *  is not on the map (an offer, a preset not yet in the pool). */
    anchor(level) {
      if (visible !== level) return null;
      const id = host.subjectId();
      if (id == null || host.isCut(id)) return null;
      if (level === "taste") {
        const q = target.get(id);
        if (!q || !W) return null;
        const r = cv.getBoundingClientRect();
        const pts = poolPoints();
        const unsure = geom.mapUnsureScale(pts.map((p) => stdNow.get(p.id)));
        const dot = geom.mapDotRadius(fitted() ? unsure(stdNow.get(id)) : 0.5);
        return { id, x: r.left + q.x, y: r.top + q.y, size: dot * 2 };
      }
      if (level === "learning") {
        const q = miniPositions().get(id);
        if (!q || !MW) return null;
        const r = mdCv.getBoundingClientRect();
        // Inside its ring (9 px).
        return { id, x: r.left + q.x, y: r.top + q.y, size: 8 };
      }
      return null;
    },
    /** Which view is showing. Called by `showView`. */
    setView(name) {
      const was = visible;
      visible = name === "taste" || name === "learning" ? name : null;
      if (visible !== "taste") {
        setActive(null);
        if (was === "taste") {
          // Leaving TASTE leaves the track at now.
          stopReplay();
          scrub = null;
          scrubView = null;
        }
      }
      if (visible !== "learning") stopBarReplay();
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
        drawTime();
        drawMap();
        kick();
      }
      if (visible === "learning" && was !== "learning") {
        resizeLearning();
        gNow = gradientNow();
        swing = null;
        ghost = null;
        seenForecasts = scored().length;
        renderLearning();
      }
    },
    /** Redraw with whatever views main now holds. */
    draw: sync,
    /** EVOLVE's small TASTE map (Plan-008 C1), drawn into `cv` at its CSS
     *  size: every sound in the pool where the engine's map puts it
     *  (`taste_map`), the model's liking a faint amber halo once it has
     *  fitted (`WasmEngine::belief`), and the pair on the table, `a` and `b`,
     *  ringed and lettered where they are on it. Still: it is redrawn when a
     *  views post, a pick's ratings or a new pair changes what it shows, and
     *  draws nothing before the engine has a map. */
    drawMini(cv, { a = null, b = null } = {}) {
      const w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return;
      const ctx = sizeCanvas(cv, w, h);
      ctx.clearRect(0, 0, w, h);
      const v = host.views();
      const pts = (v && v.map && Array.isArray(v.map.points) ? v.map.points : []).filter((p) => p.id != null && !host.isCut(p.id));
      if (!pts.length) return;
      const pos = geom.miniLayout(pts, w, h, 14);
      const isFit = !!(v && v.styles);
      const like = new Map(pts.map((p) => [p.id, p.utility]));
      if (v.ratings && Array.isArray(v.ratings.ranked)) for (const row of v.ratings.ranked) like.set(row.id, row.mean);
      for (const [id, q] of pos) {
        if (isFit) {
          const l = geom.liking(like.get(id) ?? 0);
          const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, 3 + l * 9);
          g.addColorStop(0, inkAlpha(INK.amber, 0.08 + 0.3 * l));
          g.addColorStop(1, inkAlpha(INK.amber, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(q.x, q.y, 3 + l * 9, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(q.x, q.y, 1.6, 0, Math.PI * 2);
        ctx.fillStyle = inkAlpha(INK.green, 0.6);
        ctx.fill();
      }
      for (const [id, letter] of [[a, "A"], [b, "B"]]) {
        const q = id != null ? pos.get(id) : null;
        if (!q) continue;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 5, 0, Math.PI * 2);
        ctx.strokeStyle = inkAlpha(INK.silk, 0.9);
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = inkAlpha(INK.silk, 0.9);
        text(ctx, letter, q.x, q.y - 9, "center");
      }
    },
    /** The model view went up or down (shell.js): TASTE's side of the
     *  toggle while it is up. */
    setModelView(on) {
      if (modelView === !!on) return;
      modelView = !!on;
      tog.setAttribute("aria-pressed", String(tasteOn()));
      // While the view is up the map is on its TASTE side whatever the
      // switch says, so the switch rests, and says why.
      tog.disabled = modelView;
      tog.title = modelView ? words.TASTE_LABELS.togByModel : words.TASTE_LABELS.togTitle;
      if (visible === "taste") {
        syncTasteText();
        drawMap();
      }
    },
    /** A `status` reply: a pick, a star or a cut the engine took, with the
     *  ratings it left (`WasmEngine::belief`). It is kept as a moment on the
     *  track. A pair's pick (`record_duel`) also draws its arrow, from the
     *  sound passed to the sound picked. */
    onStatus(m) {
      if (!m || m.recorded === false || !m.ratings) return;
      const v = m.vote;
      const pick = v && v.kind === "duel" && v.a != null && v.b != null && typeof m.choseA === "boolean"
        ? { a: m.choseA ? v.b : v.a, b: m.choseA ? v.a : v.b }
        : null;
      const kind = !v ? "offer" : v.kind === "stars" ? "star" : v.kind === "keep" ? (v.kept ? "keep" : "cut") : "pick";
      record(kind, pick, m.status && m.status.observations);
      if (pick && visible === "taste" && scrub == null) {
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
    /** A `styles` reply after a pick (`WasmEngine::styles`): kept with that
     *  pick's moment, and LEARNING's bars move to it. main has already put
     *  the styles in its views. */
    onStyles(m) {
      if (!m || !m.styles) return;
      geom.attachStyles(history, m.observations, m.styles);
      host.scheduleSave();
      if (visible === "learning" && !barReplay) {
        renderChips();
        renderBars();
      }
    },
    /** A `calibration` reply: the forecasts and the math's numbers. */
    onCalibration() {
      if (visible === "learning") {
        renderForecasts();
        renderMath();
        kick();
      }
    },
    /** A taste file was opened: the next map kept is its moment, marked on
     *  the track as a boundary. */
    markFile() {
      fileNext = true;
    },
    /** What the page kept, to save with the session (JS-owned, versioned). */
    history: () => history,
    /** A saved history, read back on load (or an empty one if unreadable). */
    restore(saved) {
      history = geom.readHistory(saved);
      recordedMap = null;
    },
  };
}
