// The shell: which level you are at, and the ways you move between them
// (Plan-008). It owns the level registry, `show`, the header's `#where`, the
// level rail and the level keys (ADR-017: ⌥↑/⌥↓ zoom, ⌥← to EVOLVE and ⌥→
// back, ⌥1–5). main.js creates it with a host and keeps every side effect of
// a move in `host.levelChanged(prev, next)`: the shell does the DOM (one
// section shown, `body[data-level]`, `#where`, the rail's `aria-current`, the
// saved level and the hash). The rules for which level a key or a hash leads
// to are levels.js's, unit-tested.
//
// A move is instant here. The morph between levels (the held sound's face
// carried from one level to the next) is Plan-008 PR C.

// With the build stamp main.js loaded this with, so a new build refetches it.
const { WHERE, isLevel, startLevel, hashLevel, levelForKey } = await import(`./levels.js${new URL(import.meta.url).search}`);

const SAVED = "auracle-view";

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
      // ⌥ alone opens the window's menu in Firefox and Edge on Windows.
      if (e.key === "Alt") {
        if (!typing(e.target)) e.preventDefault();
        return;
      }
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      if (!(e.key.startsWith("Arrow") || /^Digit[1-5]$/.test(e.code || ""))) return;
      if (typing(e.target)) return;
      if (host.blocked && host.blocked()) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      const next = levelForKey(cur, e.key, e.code);
      if (next) show(next, { chosen: true });
    },
    true,
  );
  document.addEventListener(
    "keyup",
    (e) => {
      if (e.key === "Alt" && !typing(e.target)) e.preventDefault();
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
  // A link to a level ("…/play/#taste"), or the address edited by hand.
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
  };
}
