// The shell: which level you are at, and the ways you move between them
// (Plan-008). It owns the level registry, `show`, the header's `#where`, the
// level rail and the level keys (ADR-017: ⌥↑/⌥↓ zoom, ⌥← to EVOLVE and ⌥→
// back, ⌥1–5), and the model view (hold ⌥, or MODEL). main.js creates it
// with a host and keeps every side effect of a move in
// `host.levelChanged(prev, next)` and of the model view in
// `host.modelViewChanged(on)`: the shell does the DOM (one section shown,
// `body[data-level]`, `#where`, the rail's `aria-current`, the saved level
// and the hash; `body.model-view`, MODEL's LED and the tag). The rules for
// which level a key or a hash leads to are levels.js's, unit-tested.
//
// A move is instant here. The morph between levels (the held sound's face
// carried from one level to the next) is Plan-008 PR C.

// With the build stamp main.js loaded this with, so a new build refetches it.
const { WHERE, isLevel, startLevel, hashLevel, levelForKey } = await import(`./levels.js${new URL(import.meta.url).search}`);

const SAVED = "auracle-view";
// ⌥ held this long shows the model view (ADR-017); a key pressed sooner
// cancels it, so ⌥↑ never flashes it on the way to TASTE.
const MODEL_HOLD_MS = 220;
// MODEL pressed this long is a hold (the view goes when it is let go), not a
// tap (which keeps it), as the prototype has it.
const PRESS_HOLD_MS = 280;
// A tapped view says what it believes, then its tag settles out of the way;
// the amber stays. When, not how long a move takes.
const TAG_SAYS_MS = 3200;

/** A text field, where ⌥ and an arrow move by word and must stay its own. */
function typing(target) {
  return !!target?.closest?.(
    "input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button]), select, textarea, [contenteditable]:not([contenteditable=false])",
  );
}

export function createShell(host = {}) {
  const levels = new Map(); // level -> { el }
  let cur = null;

  /** A level and the section that shows it. */
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

  function paintWhere(level) {
    const box = document.getElementById("where");
    if (!box) return;
    const [name, line] = WHERE[level];
    const n = box.querySelector(".where-n");
    const d = box.querySelector(".where-d");
    if (n) n.textContent = name;
    if (d) d.textContent = line;
  }

  function paintRail(level) {
    for (const b of document.querySelectorAll(".rail-stop[data-level]")) {
      if (b.dataset.level === level) b.setAttribute("aria-current", "location");
      else b.removeAttribute("aria-current");
    }
  }

  /** Go to `level`. `chosen`: the player asked for it (a rail stop, a level
   *  key, a link), not the app. `focus`: the level's section takes focus, so
   *  its own keys work on arrival (EVOLVE's ←/→). True if it moved. */
  function show(level, { chosen = false, focus = false } = {}) {
    if (!isLevel(level) || !levels.has(level)) return false;
    const prev = cur;
    if (prev === level) return false;
    cur = level;
    for (const [l, spec] of levels) spec.el.classList.toggle("hidden", l !== level);
    document.body.dataset.level = level;
    paintWhere(level);
    paintRail(level);
    save(level);
    writeHash(level);
    if (host.levelChanged) host.levelChanged(prev, level, { chosen });
    if (focus) {
      const el = levels.get(level).el;
      el.tabIndex = -1;
      el.focus({ preventScroll: true });
    }
    return true;
  }

  /** Where the app opens: the hash, else the level saved last time, else
   *  PERFORM (levels.js `startLevel`). */
  function start() {
    show(startLevel(location.hash, read()));
  }

  // The rail: a click goes there. With a pointer, the level takes focus (as a
  // tab's click did), so EVOLVE's ←/→ work at once; from the keyboard (a
  // click with `detail` 0), focus stays on the stop.
  const rail = document.getElementById("rail");
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
      // Esc ends the model view, however it came up, and goes on to close
      // whatever else it closes.
      if (e.key === "Escape" && model.on) setModelView(false, { sticky: true });
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
    },
    true,
  );
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

  return {
    register,
    show,
    start,
    /** The level shown, or null before `start`. */
    current: () => cur,
    /** Is the model view up? */
    modelView: () => model.on,
    /** Say the tag again: what it believes has changed (a pick, a fit). */
    modelTagChanged: () => { if (model.on) paintModelTag(); },
  };
}
