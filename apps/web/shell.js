// The shell: which level you are at, and the ways you move between them
// (Plan-008). It owns the level registry, `show`, the header's `#where`, the
// level rail and the level keys (ADR-017: ⌥↑/⌥↓ zoom, ⌥← to EVOLVE and ⌥→
// back, ⌥1–5), ⌥ and the wheel and a two-finger pinch, the move between
// levels (the morph, the face it carries, the rail's puck) and a sound taken
// up from the bank (`takeUp`), the model view (hold ⌥, or MODEL), and ⌘K,
// the one list of every command and every sound (`cmd`).
// main.js creates it with a host and keeps every side effect of a move in
// `host.levelChanged(prev, next)` and of the model view in
// `host.modelViewChanged(on)`: the shell does the DOM (the section shown,
// `body[data-level]`, `#where`, the rail's `aria-current`, the saved level
// and the hash; `body.model-view`, MODEL's LED and the tag). The rules for
// which level a key or a hash leads to, and of the move itself, are
// levels.js's, unit-tested.
//
// A move (Plan-008 §2.3, the specimen's morph): the level you leave scales
// and fades, the one you reach comes in from the other side, and between them
// the face of the sound you're playing travels on a canvas over the page,
// from where one level draws it (its `anchor`) to where the other does. Under
// reduced motion every move is instant and nothing flies.

// With the build stamp main.js loaded this with, so a new build refetches it.
const {
  WHERE, isLevel, startLevel, hashLevel, levelForKey, dirOf, step, railPath,
  MORPH, MORPH_GONE, MORPH_SHOWN, WHERE_SLIDE, NOD_PX, flightEnds, flightAt, wheelStep, wheelOwner, pinchStep,
  BY_DIGIT, cmdkList, SOUNDS_SHOWN,
} = await import(`./levels.js${new URL(import.meta.url).search}`);

const SAVED = "auracle-view";
// A tapped model view is remembered (held is never): "1" up, "0" down. Seeded
// once from PATCH's old LEANS switch (`auracle-belief`), which it replaced.
const SAVED_MODEL = "auracle-model-view";
const OLD_LEANS = "auracle-belief";
// ⌥ held this long shows the model view (ADR-017); a key pressed sooner
// cancels it, so ⌥↑ never flashes it on the way to TASTE.
const MODEL_HOLD_MS = 220;
// MODEL pressed this long is a hold (the view goes when it is let go), not a
// tap (which keeps it), as the prototype has it.
const PRESS_HOLD_MS = 280;
// A tapped view says what it believes, then its tag settles out of the way;
// the amber stays. When, not how long a move takes.
const TAG_SAYS_MS = 3200;
// A move that has not landed this long after it should have (a page out of
// sight runs no frames) lands at once: when, not how long a move takes.
const MOVE_GRACE_MS = 500;

/** A text field, where ⌥ and an arrow move by word and must stay its own. */
function typing(target) {
  return !!target?.closest?.(
    "input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button]), select, textarea, [contenteditable]:not([contenteditable=false])",
  );
}

export function createShell(host = {}) {
  const levels = new Map(); // level -> { el, anchor }
  let cur = null;
  // A motion token's length now (main.js `motionMs`): 0 under reduced motion.
  const ms = (name) => (host.motionMs ? host.motionMs(name) : 0);

  /** A level, the section that shows it, and `anchor()`: where the level
   *  shows the sound you're playing, `{box: {x, y, w, h}, key}` in the
   *  page's pixels with the render key of the face shown there (or that a
   *  map's mark stands for: LEARNING's is a dot in a ring), or null where
   *  it shows none. */
  function register(level, spec) {
    if (!isLevel(level) || !spec || !spec.el) return;
    levels.set(level, spec);
  }

  // ---------- the model view ----------
  // What the model believes, raised over whatever level is showing
  // (Plan-008 §2.5): `body.model-view`, which the bank, EVOLVE and TASTE
  // read; MODEL's LED; and the tag, in the model's voice. Held (⌥ or MODEL
  // pressed), it goes when let go; tapped, it stays until a tap or Esc. A
  // hold never ends a view that was tapped on.
  const model = { on: false, held: false };
  let altTimer = 0;
  let quietTimer = 0;
  function paintModelTag() {
    const tag = document.getElementById("model-tag");
    const voice = tag && tag.querySelector(".mt-voice");
    if (voice) voice.textContent = model.on && host.modelTag ? host.modelTag() : "";
  }
  function setModelView(on, { sticky = false } = {}) {
    if (!sticky && model.on && !model.held) return;
    const was = model.on;
    model.on = !!on;
    model.held = model.on && !sticky;
    document.body.classList.toggle("model-view", model.on);
    const btn = document.getElementById("model-btn");
    if (btn) btn.setAttribute("aria-pressed", String(model.on && !model.held));
    clearTimeout(quietTimer);
    document.body.classList.remove("model-quiet");
    if (model.on && !model.held) quietTimer = setTimeout(() => document.body.classList.add("model-quiet"), TAG_SAYS_MS);
    if (was !== model.on) paintModelTag();
    if (was !== model.on && host.modelViewChanged) host.modelViewChanged(model.on);
    // A tap is a choice to leave it up (or take it down), kept across a
    // reload; a hold is a glance, and leaves the choice as it was.
    if (sticky) saveModel(model.on);
  }
  function saveModel(on) {
    try {
      localStorage.setItem(SAVED_MODEL, on ? "1" : "0");
      localStorage.removeItem(OLD_LEANS);
    } catch { /* private windows throw; the view is never load-bearing */ }
  }
  /** Was the model view left up by a tap? The old LEANS switch, if that is
   *  all there is, says so once. */
  function readModel() {
    try {
      const v = localStorage.getItem(SAVED_MODEL);
      if (v != null) return v === "1";
      return localStorage.getItem(OLD_LEANS) === "1";
    } catch {
      return false;
    }
  }
  function cancelAltHold() {
    clearTimeout(altTimer);
    altTimer = 0;
  }
  // MODEL, pressed and held or tapped. The click a hold ends with is not a
  // tap. Enter and Space click it, so the keyboard taps.
  const modelBtn = document.getElementById("model-btn");
  if (modelBtn) {
    let pressTimer = 0;
    let heldByPress = false;
    modelBtn.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      heldByPress = false;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        heldByPress = true;
        if (!model.on) setModelView(true);
      }, PRESS_HOLD_MS);
    });
    const release = () => {
      clearTimeout(pressTimer);
      if (heldByPress && model.held) setModelView(false);
    };
    for (const t of ["pointerup", "pointercancel", "pointerleave"]) modelBtn.addEventListener(t, release);
    modelBtn.addEventListener("click", () => {
      if (heldByPress) {
        heldByPress = false;
        return;
      }
      setModelView(!model.on || model.held, { sticky: true });
    });
    // A long press on a touch screen is the hold, not the page's menu.
    modelBtn.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  // The window going away takes the held ⌥ with it: its keyup never comes.
  window.addEventListener("blur", () => {
    cancelAltHold();
    if (model.held) setModelView(false);
  });

  function read() {
    try {
      return localStorage.getItem(SAVED);
    } catch {
      return null; // private windows throw; the level is never load-bearing
    }
  }
  function save(level) {
    try {
      localStorage.setItem(SAVED, level);
    } catch { /* ignore */ }
  }
  // The address says where you are, so a reload or a shared link comes back
  // to it. Replaced, not pushed: Back leaves the instrument, as it always did,
  // rather than stepping through the levels.
  function writeHash(level) {
    if (location.hash === `#${level}`) return;
    try {
      history.replaceState(history.state, "", `${location.pathname}${location.search}#${level}`);
    } catch { /* a sandboxed frame can refuse; the saved level still holds */ }
  }

  /** The level's name and line in the header. Moving, the new name comes in
   *  from the way you went (`WHERE_SLIDE`): from below going in, from above
   *  going out, from the side going to or from EVOLVE. */
  function paintWhere(level, dir = null) {
    const box = document.getElementById("where");
    if (!box) return;
    const [name, line] = WHERE[level];
    const n = box.querySelector(".where-n");
    const d = box.querySelector(".where-d");
    if (n) n.textContent = name;
    if (d) d.textContent = line;
    const len = dir ? ms("--d-move") : 0;
    if (!len || !WHERE_SLIDE[dir]) return;
    const [dx, dy] = WHERE_SLIDE[dir];
    for (const e of [n, d]) {
      if (!e || !e.animate) continue;
      e.animate(
        [{ transform: `translate(${dx}px, ${dy}px)`, opacity: 0 }, { transform: "none", opacity: 1 }],
        { duration: len, easing: easing("--e-settle") },
      );
    }
  }

  function paintRail(level) {
    for (const b of document.querySelectorAll(".rail-stop[data-level]")) {
      if (b.dataset.level === level) b.setAttribute("aria-current", "location");
      else b.removeAttribute("aria-current");
    }
  }

  /** An easing token's curve (`--e-settle`, `--e-swap`), for a script's
   *  animation, as a transition would use it. */
  function easing(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "ease";
  }

  // ---------- the move ----------
  // Every move has a number; the one in flight (`moving`) is landed before
  // the next starts, and `settle` leaves exactly one section `.on` with no
  // transform or fade on any of them, however a move ended (Plan-008 §2.3,
  // audit finding 1).
  let moveSeq = 0;
  let moving = null; // {seq, finish(), ...}: the move in flight
  let afterMove = []; // what waits for it to land (a sound taken up)
  let taking = 0; // a sound taken up, in flight: when it lands

  /** Where `level` draws the sound you're playing, if that is the face that
   *  flies (`key`): an anchor showing another sound's face (an EVOLVE card,
   *  PATCH hearing A or B, TASTE's mark for a sound you have since edited)
   *  is no place for this one. */
  function placeOf(level, key) {
    const spec = level && levels.get(level);
    let a = null;
    try {
      a = spec && spec.anchor ? spec.anchor() : null;
    } catch {
      a = null; // a level that cannot say where is a level with no place
    }
    return a && a.box && a.key === key ? a.box : null;
  }

  /** The face the move carries: the sound you're playing's, from the
   *  bench's own render (main.js `heldFace`: `faceOf`, the engine's
   *  `face_of_key`), or null when there is none to show (an edit or an open
   *  still at the engine, a patch that failed its check), and then nothing
   *  flies (ADR-012: its one claim is "this is the sound you're playing"). */
  function heldKey() {
    const h = host.heldFace ? host.heldFace() : null;
    return h && h.key ? h.key : null;
  }

  /** Land the move in flight now, and whatever waited for it. */
  function settle() {
    const m = moving;
    moving = null;
    for (const [l, spec] of levels) {
      const on = l === cur;
      spec.el.classList.toggle("on", on);
      spec.el.classList.remove("leaving");
      spec.el.inert = false;
      spec.el.style.transform = "";
      spec.el.style.opacity = "";
      spec.el.style.transformOrigin = "";
    }
    if (m) {
      clearTimeout(m.guard);
      for (const a of m.anims) a.cancel();
      overlay.clear();
      puckRest();
      if (host.mark) host.mark("level-landed", { from: m.prev, to: m.level, dir: m.dir, cut: !m.done, flew: m.flew });
    }
    const queued = afterMove;
    afterMove = [];
    for (const f of queued) f();
  }

  /** Go to `level`. `chosen`: the player asked for it (a rail stop, a level
   *  key, a link), not the app. `focus`: the level's section takes focus, so
   *  its own keys work on arrival (EVOLVE's ←/→). True if it moved. */
  function show(level, { chosen = false, focus = false } = {}) {
    if (!isLevel(level) || !levels.has(level)) return false;
    if (cur === level) return false;
    // A move in flight lands before the next starts, and a sound taken up
    // and still flying is put down where it was going.
    if (moving) moving.finish();
    if (taking) {
      clearTimeout(taking);
      taking = 0;
      overlay.clear();
    }
    const prev = cur;
    const dir = prev ? dirOf(prev, level) : null;
    const len = prev && dir ? ms("--d-zoom") : 0;
    // Where the level you leave draws the sound, read before anything about
    // the page changes.
    const key = len ? heldKey() : null;
    const from = key ? placeOf(prev, key) : null;
    const seq = ++moveSeq;
    cur = level;
    const oldEl = prev ? levels.get(prev).el : null;
    const newEl = levels.get(level).el;
    if (len && oldEl) {
      // Still on screen while it leaves, but no longer the level: nothing
      // in it takes a press, the focus or a screen reader's attention.
      oldEl.classList.add("leaving");
      oldEl.inert = true;
      newEl.style.opacity = "0";
    }
    newEl.classList.add("on");
    document.body.dataset.level = level;
    paintWhere(level, len ? dir : null);
    paintRail(level);
    save(level);
    writeHash(level);
    if (host.levelChanged) host.levelChanged(prev, level, { chosen });
    if (focus) {
      newEl.tabIndex = -1;
      newEl.focus({ preventScroll: true });
    }
    if (!len || !oldEl) {
      settle();
      return true;
    }
    const m = { seq, prev, level, dir, anims: [], done: false, flew: null, guard: 0 };
    m.finish = () => {
      if (moving !== m) return;
      settle();
    };
    moving = m;
    // A page out of sight runs no frames and plays no animation: the move
    // lands anyway, a while after it would have (when, not how long).
    m.guard = setTimeout(m.finish, len * 2 + MOVE_GRACE_MS);
    // The level you reach lays itself out first, unscaled (a frame, then its
    // ResizeObserver's), so where it draws the sound is read where it will
    // rest, not at 86% or 112% of it (audit finding 2).
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (moving !== m) return;
      const to = key ? placeOf(level, key) : null;
      const [leave, arrive] = MORPH[dir];
      const ease = easing("--e-swap");
      // Each scales about where it draws the sound, so the face stays the
      // centre of the move.
      oldEl.style.transformOrigin = originIn(oldEl, from);
      newEl.style.transformOrigin = originIn(newEl, to);
      const out = oldEl.animate(
        [{ transform: leave[0], opacity: 1 }, { opacity: 0, offset: MORPH_GONE }, { transform: leave[1], opacity: 0 }],
        { duration: len, easing: ease, fill: "forwards" },
      );
      const into = newEl.animate(
        [{ transform: arrive[0], opacity: 0 }, { opacity: 0, offset: MORPH_SHOWN }, { transform: arrive[1], opacity: 1 }],
        { duration: len, easing: ease, fill: "forwards" },
      );
      newEl.style.opacity = "";
      m.anims.push(out, into);
      const f = key ? flightEnds(from, to, dir) : null;
      const id = f ? overlay.fly(f, key, len) : null;
      puckTravel(prev, level, len);
      // Landed: the face is drawn at the end of its flight, exactly where
      // the level draws it, and then the level takes over.
      into.onfinish = () => {
        if (moving !== m) return;
        m.done = true;
        m.flew = id ? overlay.land(id) : null;
        requestAnimationFrame(() => m.finish());
      };
    }));
    return true;
  }

  /** `transform-origin` for a section, at the centre of a box in the page. */
  function originIn(el, box) {
    if (!box) return "50% 50%";
    const r = el.getBoundingClientRect();
    return `${(box.x + box.w / 2 - r.left).toFixed(1)}px ${(box.y + box.h / 2 - r.top).toFixed(1)}px`;
  }

  /** One step along the axis, as the wheel and a pinch take it: at the end
   *  of the axis the rail nods toward the end it reached. A gesture's step
   *  while a move is in flight moves nothing (its momentum is not a second
   *  move); a key, a stop or a link lands the move in flight and goes. */
  function zoom(dir, { gesture = false } = {}) {
    if (gesture && moving) return false;
    const next = step(cur, dir);
    if (!next) {
      nod(dir);
      return false;
    }
    return show(next, { chosen: true });
  }

  /** The rail nods toward the end of the axis it reached (its `translate`,
   *  which leaves its centring `transform` alone; audit finding 4). */
  function nod(dir) {
    const len = ms("--d-state");
    if (!rail || !len || !rail.animate) return;
    const y = dir === "in" ? NOD_PX : -NOD_PX;
    rail.animate([{ translate: "0 0" }, { translate: `0 ${y}px` }, { translate: "0 0" }], { duration: len, easing: easing("--e-settle") });
  }

  // ---------- the face in flight ----------
  // One canvas over the whole page, made the first time a face flies (never
  // under reduced motion), drawn only while it does. What it draws is the
  // face of the sound you're playing by its render key (`host.drawFace`:
  // main.js draws `faceByKey`, the engine's `face_of_key`, against the
  // bank, through vessel.js `drawVessel`), the same face both levels draw,
  // so it lands without a seam.
  const overlay = (() => {
    let cv = null;
    let ctx = null;
    let raf = 0;
    let fl = null; // {f, key, len, t0, last}
    function ensure() {
      if (cv) return;
      cv = document.createElement("canvas");
      cv.className = "zoom-face";
      cv.setAttribute("aria-hidden", "true");
      document.body.append(cv);
      ctx = cv.getContext("2d");
    }
    function size() {
      const d = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.round(window.innerWidth * d);
      const H = Math.round(window.innerHeight * d);
      if (cv.width !== W || cv.height !== H) {
        cv.width = W;
        cv.height = H;
      }
      ctx.setTransform(d, 0, 0, d, 0, 0);
    }
    function draw(t) {
      // Steered: where it lands, read again each frame (a level that is not
      // itself moving may still move what it draws: PATCH's camera fitting
      // a sound just opened).
      if (fl.track && !fl.f.fade) {
        const b = fl.track();
        if (b) fl.f.to = b;
      }
      const { box, alpha } = flightAt(fl.f, t);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      if (host.drawFace) host.drawFace(ctx, fl.key, box, { alpha });
      fl.last = { x: box.x, y: box.y, w: box.w, h: box.h, t };
    }
    function tick(now) {
      raf = 0;
      if (!fl) return;
      const t = Math.min(1, (now - fl.t0) / fl.len);
      draw(t);
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    let flights = 0;
    return {
      /** Start a flight; its number, for `land` and `clear`. `track`: where
       *  it lands, asked again each frame. */
      fly(f, key, len, track = null) {
        ensure();
        size();
        cancelAnimationFrame(raf);
        fl = { id: ++flights, f, key, len, track, t0: performance.now(), last: null };
        cv.classList.add("on");
        draw(0);
        raf = requestAnimationFrame(tick);
        return fl.id;
      },
      /** Drawn at the flight's very end, whatever frame it had reached; the
       *  box it was drawn at last. */
      land(id) {
        if (!fl || fl.id !== id) return null;
        cancelAnimationFrame(raf);
        raf = 0;
        draw(1);
        const r = fl.last;
        const one = (v) => Math.round(v * 10) / 10;
        return { x: one(r.x), y: one(r.y), w: one(r.w), h: one(r.h), fade: fl.f.fade };
      },
      /** Take a flight off the page (`id`; any, with none). */
      clear(id) {
        if (id != null && (!fl || fl.id !== id)) return;
        cancelAnimationFrame(raf);
        raf = 0;
        fl = null;
        if (!cv) return;
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        cv.classList.remove("on");
      },
      busy: () => !!fl,
    };
  })();

  /** Where the app opens: the hash, else the level saved last time, else
   *  PERFORM (levels.js `startLevel`). */
  function start() {
    show(startLevel(location.hash, read()));
    // Left up by a tap last time: up again (and the old LEANS key retired).
    if (readModel()) setModelView(true, { sticky: true });
  }

  // The rail: a click goes there. With a pointer, the level takes focus (as a
  // tab's click did), so EVOLVE's ←/→ work at once; from the keyboard (a
  // click with `detail` 0), focus stays on the stop.
  const rail = document.getElementById("rail");

  // The rail's puck: a light that travels from the stop you left to the one
  // you reach, turning the corner at PERFORM on the way to or from EVOLVE
  // (levels.js `railPath`), while the stops are dimmed (`.traveling`). A
  // pinch leans it toward the level it would reach. Made the first time it
  // moves; under reduced motion it never does.
  let puck = null;
  function stopCentre(level) {
    const b = rail && rail.querySelector(`.rail-stop[data-level="${level}"]`);
    if (!b) return null;
    const r = rail.getBoundingClientRect();
    const q = b.getBoundingClientRect();
    return [q.left - r.left + q.width / 2, q.top - r.top + q.height / 2];
  }
  function ensurePuck() {
    if (!puck && rail) {
      puck = document.createElement("span");
      puck.className = "rail-puck";
      puck.setAttribute("aria-hidden", "true");
      rail.append(puck);
    }
    return puck;
  }
  function puckTravel(a, b, len) {
    if (!rail || !len || !ensurePuck() || !puck.animate) return;
    const pts = railPath(a, b).map(stopCentre);
    if (pts.some((p) => !p)) return;
    for (const an of puck.getAnimations()) an.cancel();
    const frames = pts.map(([x, y], i) => ({ transform: `translate(${x}px, ${y}px)`, opacity: 1, offset: i / (pts.length - 1) }));
    frames[0].opacity = 0;
    rail.classList.add("traveling");
    puck.animate(frames, { duration: len, easing: easing("--e-swap"), fill: "forwards" });
  }
  /** The move landed: the stop it reached lights again, and the puck fades
   *  into it. */
  function puckRest() {
    if (!rail) return;
    rail.classList.remove("traveling");
    if (!puck) return;
    const len = ms("--d-state");
    const at = puck.getAnimations();
    if (!len || !at.length) {
      for (const an of at) an.cancel();
      puck.style.opacity = "0";
      return;
    }
    const xy = stopCentre(cur);
    for (const an of at) an.cancel();
    if (!xy) return;
    puck.animate(
      [{ transform: `translate(${xy[0]}px, ${xy[1]}px)`, opacity: 1 }, { transform: `translate(${xy[0]}px, ${xy[1]}px)`, opacity: 0 }],
      { duration: len, fill: "forwards" },
    );
  }
  /** A pinch on its way: the puck leans from the stop you're at toward the
   *  one it would reach, `t` (0..1) of the way to the most it leans; null
   *  puts it back. */
  function puckLean(dir, t = 0) {
    if (!rail || moving) return;
    const next = dir ? step(cur, dir) : null;
    if (!next || !ms("--d-state")) {
      if (puck) {
        for (const an of puck.getAnimations()) an.cancel();
        puck.style.opacity = "0";
      }
      return;
    }
    const a = stopCentre(cur);
    const b = stopCentre(next);
    if (!a || !b || !ensurePuck()) return;
    for (const an of puck.getAnimations()) an.cancel();
    const k = Math.min(1, Math.max(0, t)) * 0.6;
    puck.style.transform = `translate(${a[0] + (b[0] - a[0]) * k}px, ${a[1] + (b[1] - a[1]) * k}px)`;
    puck.style.opacity = String(Math.min(1, 0.3 + t));
  }
  if (rail) {
    rail.addEventListener("click", (e) => {
      const stop = e.target.closest?.(".rail-stop[data-level]");
      if (!stop) return;
      show(stop.dataset.level, { chosen: true, focus: e.detail > 0 });
    });
    // A keyboard on the rail walks it as it is drawn: ↑ out, ↓ in, ← to
    // EVOLVE and → back, Home and End to its ends; each step goes there and
    // the focus follows, as the view tabs' arrows did. Taken here, so a
    // level's own arrows (EVOLVE's picks) never hear a key meant for the rail.
    rail.addEventListener("keydown", (e) => {
      const stop = e.target.closest?.(".rail-stop[data-level]");
      if (!stop || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const stops = [...rail.querySelectorAll(".rail-stop[data-level]")];
      const next =
        e.key === "Home" ? stops[0].dataset.level
        : e.key === "End" ? stops[stops.length - 1].dataset.level
        : e.key.startsWith("Arrow") ? levelForKey(stop.dataset.level, e.key, "")
        : undefined;
      if (next === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      if (!next) return;
      show(next, { chosen: true });
      rail.querySelector(`.rail-stop[data-level="${next}"]`)?.focus();
    });
  }

  // The level keys come first: no focused control may swallow ⌥ and an
  // arrow (a knob turns on the arrows, a list walks on them), so they are
  // taken in the capture phase, before any control's own handler. A text
  // field keeps them: there ⌥← moves by word. A modal dialog keeps them too
  // (`host.blocked`): the level behind it must not change unseen.
  document.addEventListener(
    "keydown",
    (e) => {
      // Any other key while ⌥'s hold is counting cancels it.
      if (e.key !== "Alt") cancelAltHold();
      // ⌥ alone opens the window's menu in Firefox and Edge on Windows. Held,
      // it shows the model view, except where ⌥ is the field's (a text field
      // moves by word with it) or under a modal dialog.
      if (e.key === "Alt") {
        if (typing(e.target)) return;
        e.preventDefault();
        if (!e.repeat && !altTimer && !model.on && !(host.blocked && host.blocked())) {
          altTimer = setTimeout(() => {
            altTimer = 0;
            setModelView(true);
          }, MODEL_HOLD_MS);
        }
        return;
      }
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      if (!(e.key.startsWith("Arrow") || /^Digit[1-5]$/.test(e.code || ""))) return;
      if (typing(e.target)) return;
      if (host.blocked && host.blocked()) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      // A level key while ⌥ holds the model view up: the move is what was
      // meant, and the view goes with the hold.
      if (model.held) setModelView(false);
      const next = levelForKey(cur, e.key, e.code);
      if (next) show(next, { chosen: true });
      // ⌥↑ at LEARNING, ⌥↓ at PATCH: nothing further that way.
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") nod(e.key === "ArrowDown" ? "in" : "out");
    },
    true,
  );
  // Esc ends the model view only when nothing nearer took it: on the window,
  // in the bubble phase, after every handler on the page has had it, and not
  // when one of them closed something with it (`defaultPrevented`: a menu,
  // a bank row's ★, the selection, the catalog, a module in hand, a guess
  // asked for a place, a new patch; PERFORM's XY or How it works, the scope
  // and picture panels, TASTE's selected point) or stopped it on its way (a
  // plate, a knob, a dialog, ⌘K's list). So Esc walks out one thing a press,
  // at every level, and the view outlasts it. In a text field Esc is the
  // field's (Find a sound clears), and the view stays, as it does for a
  // press in a drop-down (`typing`).
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !model.on || e.defaultPrevented || typing(e.target)) return;
    setModelView(false, { sticky: true });
  });
  document.addEventListener(
    "keyup",
    (e) => {
      if (e.key !== "Alt") return;
      cancelAltHold();
      if (model.held) setModelView(false);
      if (!typing(e.target)) e.preventDefault();
    },
    true,
  );
  // The wordmark goes to PERFORM, the level at rest. Its href stays for a
  // middle click and for a page without scripts; a plain click is a move, so
  // it is replaced in the address like every other one, not a new entry Back
  // would step through.
  const brand = document.querySelector(".brand");
  if (brand) {
    brand.addEventListener("click", (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      show("perform", { chosen: true });
    });
  }
  // A link to a level ("…/play/#taste"), or the address edited by hand. The
  // wordmark's href is "./#perform", a route into this page rather than an
  // anchor on it, which is how the site's link check reads it too.
  window.addEventListener("hashchange", () => {
    const level = hashLevel(location.hash);
    if (level) show(level, { chosen: true });
  });

  // ---------- ⌥ and the wheel, and a pinch ----------
  // ⌥ and the wheel anywhere on the stage zoom between the levels, and so do
  // ctrl and the wheel, which is how a trackpad's pinch arrives; over PATCH's
  // rack ctrl and the wheel stay its camera's (main.js; Plan-008 Q9), so a
  // pinch there zooms the patch and ⌥ and the wheel, ⌥↑ or the rail leave
  // it. A turn moves one level, and the rest of it moves nothing
  // (levels.js `wheelStep`). Taken from the page either way, or the
  // browser would zoom the page under it. But ⌥ and the wheel over
  // something that can still scroll that way (PATCH's catalog, PERFORM's
  // hood, a level taller than the window) scroll it, as they always did: ⌥
  // held is also the model view, read while the list moves. The turn stays
  // the scroller's to its end (levels.js `wheelOwner`).
  const stage = document.querySelector(".stage");
  let wheel = {};
  let turn = null;
  /** Can something under `el`, inside the stage, scroll the way the wheel
   *  turned (its larger axis)? */
  const scrollsThatWay = (el, dx, dy) => {
    const across = Math.abs(dx) > Math.abs(dy);
    const d = across ? dx : dy;
    if (!d) return false;
    for (let n = el; n && n !== stage && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const ov = across ? cs.overflowX : cs.overflowY;
      if (ov !== "auto" && ov !== "scroll" && ov !== "overlay") continue;
      const [at, seen, all] = across ? [n.scrollLeft, n.clientWidth, n.scrollWidth] : [n.scrollTop, n.clientHeight, n.scrollHeight];
      if (all - seen < 1) continue;
      if (d > 0 ? at + seen < all - 1 : at > 0) return true;
    }
    return false;
  };
  if (stage) {
    stage.addEventListener("wheel", (e) => {
      if (!(e.altKey || e.ctrlKey) || e.metaKey) return;
      if (!e.altKey && e.target.closest?.("#rack-scroll")) return;
      if (host.blocked && host.blocked()) return;
      if (e.altKey && !e.ctrlKey) {
        // The rack scrolls nothing (it is a camera), and ⌥ and the wheel
        // over it are the levels' (Q9), whatever holds it.
        const scrolls = !e.target.closest?.("#rack-scroll") && scrollsThatWay(e.target, e.deltaX, e.deltaY);
        turn = wheelOwner(turn, performance.now(), scrolls);
        if (turn.to === "scroll") return;
      }
      e.preventDefault();
      // ⌥ held for the wheel is the wheel's, not the model view's: as with a
      // level key, the move is what was meant.
      if (e.altKey) {
        cancelAltHold();
        if (model.held) setModelView(false);
      }
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
      const r = wheelStep(wheel, e.deltaY * k, performance.now());
      wheel = r.st;
      if (r.dir) zoom(r.dir, { gesture: true });
    }, { passive: false });

    // Two fingers on a touch screen: spread to zoom in, close to zoom out
    // (levels.js `pinchStep`), the puck leaning toward the level it would
    // reach on the way. Not over the rack: two fingers there are the
    // rack's. Heard in the capture phase, so a control that holds a finger
    // still lets the stage see both.
    const fingers = new Map();
    let d0 = 0;
    const spread = () => {
      const [a, b] = [...fingers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    stage.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch" || e.target.closest?.("#rack-scroll")) return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      d0 = fingers.size === 2 ? spread() : 0;
    }, true);
    stage.addEventListener("pointermove", (e) => {
      if (!fingers.has(e.pointerId)) return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size !== 2 || !d0) return;
      const r = pinchStep(spread() / d0);
      if (r.dir) {
        // One level a pinch: the fingers lift before the next.
        d0 = 0;
        puckLean(null);
        if (host.blocked && host.blocked()) return;
        zoom(r.dir, { gesture: true });
      } else if (r.lean) puckLean(r.lean.dir, r.lean.t);
    }, true);
    const lift = (e) => {
      if (!fingers.delete(e.pointerId)) return;
      if (fingers.size < 2 && d0) {
        d0 = 0;
        puckLean(null);
      }
    };
    stage.addEventListener("pointerup", lift, true);
    stage.addEventListener("pointercancel", lift, true);
  }

  // ---------- a sound taken up from the bank ----------
  /** Its face, from where the bank showed it (`from`, a box in the page, and
   *  `key`, its render key), flies to where the level you're at draws the
   *  sound you're playing, once the level draws it: called when the sound
   *  has reached your hands, never before (the bench's reply). Where the
   *  level has no place for it, it fades out where it was. After a move in
   *  flight lands; not under reduced motion. True if it flies. */
  function takeUp(from, key) {
    const len = ms("--d-zoom");
    if (!len || !key || !from) return false;
    if (moving) {
      afterMove.push(() => takeUp(from, key));
      return true;
    }
    if (overlay.busy() || key !== heldKey()) return false;
    const level = cur;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (moving || cur !== level || overlay.busy()) return;
      // Where the level draws it, or, at a level with no place for it, the
      // sound in hand in the menu bar.
      const hand = () => {
        const a = host.handAnchor ? host.handAnchor() : null;
        return a && a.box && a.key === key ? a.box : null;
      };
      const there = placeOf(level, key) ? () => placeOf(level, key) : hand;
      const f = flightEnds(from, there(), null);
      if (!f) return;
      const id = overlay.fly(f, key, len, there);
      taking = setTimeout(() => {
        taking = 0;
        const flew = overlay.land(id);
        requestAnimationFrame(() => {
          overlay.clear(id);
          if (flew && host.mark) host.mark("taken-up", { level, flew });
        });
      }, len);
    }));
    return true;
  }

  // ---------- ⌘K: the one list (Plan-008 §2.4) ----------
  // Every command, with its key, and every sound, by its face, found by
  // typing: what this level does (This level), what any does (Anywhere: the
  // levels, the keys bar, files, your taste, the films, the guide's keys and
  // gestures), and the sounds (pool, saved, presets). ⌘K or Ctrl K opens
  // it, as its button in the menu bar does, and `?` too wherever explain.js
  // has no control to ask about (ADR-017). It is drawn from what the page
  // already holds, never asking the engine: a
  // sound's face is the one the page has drawn, or an empty slot until it
  // has one. While it is open the keys are the field's: nothing behind it
  // hears them, so no note plays and no level moves.
  const cmdList = [];
  /** A command: `{id, level?, label, key?, hint?, run, when?}`. `level` puts
   *  it under This level, at that level only; without one it is Anywhere.
   *  `label` and `hint` may be functions, read each time the list is drawn
   *  (a setting's state), and `when()` false leaves it out. `key` is the
   *  key that does the same (a string, or several), printed for this
   *  platform; `hint` is said where a command has no key. Registering an
   *  `id` again replaces it. */
  function cmd(c) {
    if (!c || !c.id || typeof c.run !== "function") return;
    const i = cmdList.findIndex((x) => x.id === c.id);
    if (i >= 0) cmdList[i] = c;
    else cmdList.push(c);
  }
  /** Commands that come and go (a sound kept safe, RECORD AGAIN on it): a
   *  function giving the ones there are now, asked each time the list is
   *  drawn. */
  const providers = [];
  function cmds(fn) {
    if (typeof fn === "function") providers.push(fn);
  }
  const K = {
    el: document.getElementById("cmdk"),
    scrim: document.getElementById("cmdk-scrim"),
    input: document.getElementById("cmdk-input"),
    list: document.getElementById("cmdk-list"),
    btn: document.getElementById("cmdk-btn"),
  };
  const kOpen = () => !!K.el && !K.el.classList.contains("hidden");
  let kSel = 0;
  let kRows = []; // [{item, li}], in the order shown
  let kFrom = null; // where the focus goes back to on close
  const val = (v) => (typeof v === "function" ? v() : v);
  const keyText = (k) => (host.platformKeys ? host.platformKeys(k) : k);
  function kGroups() {
    const now = [...cmdList];
    for (const fn of providers) {
      try {
        now.push(...(fn() || []));
      } catch { /* a provider that cannot say gives nothing */ }
    }
    const live = now.filter((c) => {
      try {
        return !c.when || c.when();
      } catch {
        return false;
      }
    });
    const shown = (c) => ({ ...c, label: String(val(c.label) || ""), hint: val(c.hint) || "", key: val(c.key) || null });
    let sounds = [];
    try {
      sounds = host.sounds ? host.sounds() : [];
    } catch {
      sounds = [];
    }
    return [
      { name: "This level", items: live.filter((c) => c.level && c.level === cur).map(shown) },
      { name: "Anywhere", items: live.filter((c) => !c.level).map(shown) },
      { name: "Sounds", items: sounds.map(shown), cap: SOUNDS_SHOWN },
    ];
  }
  /** The label, with the letters the query matched marked. */
  function marked(label, marks) {
    const frag = document.createDocumentFragment();
    const at = new Set(marks);
    let run = "";
    let inMark = false;
    const flush = () => {
      if (!run) return;
      if (inMark) {
        const m = document.createElement("mark");
        m.textContent = run;
        frag.append(m);
      } else frag.append(run);
      run = "";
    };
    for (let i = 0; i < label.length; i++) {
      const hit = at.has(i);
      if (hit !== inMark) {
        flush();
        inMark = hit;
      }
      run += label[i];
    }
    flush();
    return frag;
  }
  function kDraw() {
    const groups = cmdkList(kGroups(), K.input.value);
    const frag = document.createDocumentFragment();
    kRows = [];
    for (const g of groups) {
      const h = document.createElement("li");
      h.className = "cmdk-grp";
      h.setAttribute("role", "presentation");
      h.textContent = g.name;
      frag.append(h);
      for (const { item, marks } of g.hits) {
        const li = document.createElement("li");
        li.className = "cmdk-it";
        li.id = `cmdk-o${kRows.length}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", "false");
        const ico = document.createElement("span");
        ico.className = "cmdk-ico";
        ico.setAttribute("aria-hidden", "true");
        // A sound's face, as the page has drawn it (main.js `faceSlot`);
        // a command's glyph where the app has one for it (▶, ⚡), else ›.
        if (item.face) ico.innerHTML = item.face();
        else ico.textContent = item.icon || "›";
        const lab = document.createElement("span");
        lab.className = "cmdk-lab";
        lab.append(marked(item.label, marks));
        const hint = document.createElement("span");
        hint.className = "cmdk-hint";
        const keys = item.key ? (Array.isArray(item.key) ? item.key : [item.key]) : [];
        if (item.hint) hint.append(item.hint);
        for (const k of keys) {
          const kb = document.createElement("kbd");
          kb.textContent = keyText(k);
          hint.append(kb);
        }
        li.append(ico, lab, hint);
        const at = kRows.length;
        li.addEventListener("click", () => kRun(at));
        li.addEventListener("pointermove", (e) => {
          if (e.pointerType === "mouse" && kSel !== at) kMark(at, false);
        });
        frag.append(li);
        kRows.push({ item, li });
      }
    }
    K.list.replaceChildren(frag);
    // The faces drawn already go in now; the rest stay empty slots.
    if (host.paintSounds) host.paintSounds(K.list);
    K.list.classList.toggle("none", !kRows.length);
    kMark(0, true);
  }
  function kMark(i, scroll = true) {
    kSel = Math.max(0, Math.min(kRows.length - 1, i));
    kRows.forEach(({ li }, j) => li.setAttribute("aria-selected", String(j === kSel)));
    const row = kRows[kSel];
    if (row) {
      K.input.setAttribute("aria-activedescendant", row.li.id);
      if (scroll) row.li.scrollIntoView({ block: "nearest" });
    } else K.input.removeAttribute("aria-activedescendant");
  }
  /** Open the list. `from` says where the focus goes back to when it closes:
   *  what held it before, unless a pointer's click opened it (then nothing:
   *  a click leaves no focus, and Space then plays, ADR-016). */
  function kShow({ pointer = false } = {}) {
    if (!K.el || kOpen()) return;
    const a = document.activeElement;
    kFrom = !pointer && a && a !== document.body && a !== K.input ? a : null;
    K.input.value = "";
    K.el.classList.remove("hidden");
    K.scrim.classList.remove("hidden");
    K.btn?.setAttribute("aria-expanded", "true");
    kDraw();
    K.input.focus({ preventScroll: true });
    if (host.mark) host.mark("cmdk-open", { rows: kRows.length });
  }
  function kHide() {
    if (!kOpen()) return;
    K.el.classList.add("hidden");
    K.scrim.classList.add("hidden");
    K.btn?.setAttribute("aria-expanded", "false");
    K.input.removeAttribute("aria-activedescendant");
    const back = kFrom;
    kFrom = null;
    if (back && document.contains(back) && back.focus) back.focus({ preventScroll: true });
    else if (document.activeElement === K.input) K.input.blur();
    kRows = [];
    K.list.replaceChildren();
  }
  /** Run the row `i`: the list closes first, giving the focus back, so what
   *  the command opens (a panel, a file's picker) takes it from there, in
   *  the same task as the key or the click (a file's picker needs that). */
  function kRun(i) {
    const row = kRows[i];
    kHide();
    if (row) row.item.run();
  }
  if (K.el) {
    K.input.addEventListener("input", () => kDraw());
    K.scrim.addEventListener("click", () => kHide());
    // A press inside the list keeps the focus in its field.
    K.el.addEventListener("mousedown", (e) => {
      if (e.target !== K.input) e.preventDefault();
    });
    if (K.btn) K.btn.addEventListener("click", (e) => (kOpen() ? kHide() : kShow({ pointer: e.detail > 0 })));
  }
  // ⌘K or Ctrl K, from anywhere but under another modal dialog; taken
  // before anything on the page (Firefox takes Ctrl K for its search bar).
  // While the list is open every key is its own: the arrows choose, Enter
  // runs, Esc closes, Tab stays in the field, and the rest are typed into
  // it, heard by nothing behind (no note, no ⌘Z, no level key, no Esc for
  // the model view).
  window.addEventListener(
    "keydown",
    (e) => {
      const isK = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.code === "KeyK" || String(e.key || "").toLowerCase() === "k");
      if (!kOpen()) {
        if (!isK || !K.el || (host.blocked && host.blocked())) return;
        e.preventDefault();
        e.stopPropagation();
        kShow();
        return;
      }
      e.stopPropagation();
      if (isK || e.key === "Escape") {
        e.preventDefault();
        kHide();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (kRows.length) kMark((kSel + (e.key === "ArrowDown" ? 1 : -1) + kRows.length) % kRows.length);
      } else if (e.key === "Enter") {
        if (e.isComposing) return;
        e.preventDefault();
        if (!e.repeat) kRun(kSel);
      } else if (e.key === "Tab") {
        e.preventDefault();
      }
    },
    true,
  );
  // ? opens it where explain.js had nothing to ask about: explain hears ? in
  // the capture phase and claims it over a control (`preventDefault`), so it
  // is read here after, in the bubble phase. Not in a text field, where ? is
  // typed, nor under a modal dialog.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "?" || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || kOpen()) return;
    if (typing(e.target) || (host.blocked && host.blocked())) return;
    e.preventDefault();
    kShow();
  });
  // The levels, each one a command, with the key that goes straight there.
  BY_DIGIT.forEach((level, i) => {
    cmd({
      id: `level-${level}`,
      label: `${WHERE[level][0].toUpperCase()}: ${WHERE[level][1]}`,
      key: `⌥${i + 1}`,
      when: () => cur !== level,
      run: () => show(level, { chosen: true }),
    });
  });
  // MODEL's tap: up until run again (or Esc); held, ⌥ (its key, printed).
  cmd({
    id: "model-view",
    label: "The model view: what it believes about every sound",
    hint: () => (model.on ? "on" : "hold"),
    key: () => (model.on ? null : "⌥"),
    run: () => setModelView(!model.on, { sticky: true }),
  });

  return {
    register,
    show,
    start,
    zoom,
    takeUp,
    /** The level shown, or null before `start`. */
    current: () => cur,
    /** Is the model view up? */
    modelView: () => model.on,
    /** Say the tag again: what it believes has changed (a pick, a fit). */
    modelTagChanged: () => { if (model.on) paintModelTag(); },
    /** Register a command in ⌘K's list (`cmd` above), or a function giving
     *  the ones there are now (`cmds`). */
    cmd,
    cmds,
    /** ⌘K's list: open it, close it, and is it open? */
    openCommands: () => kShow(),
    closeCommands: () => kHide(),
    commandsOpen: kOpen,
  };
}
