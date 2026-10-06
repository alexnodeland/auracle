// The levels: where you are in the one space (Plan-008, RFC-006). TASTE is
// zoomed out (the sound among all sounds), PERFORM is the sound, PATCH is
// zoomed in (what it is made of), LEARNING is past TASTE (how it learns), and
// EVOLVE sits beside PERFORM. Pure, so the rules for moving between them are
// unit-tested (tests/levels.test.mjs); shell.js does the DOM.

/** Out to in, along the zoom axis. */
export const LEVELS = ["learning", "taste", "perform", "patch"];
/** Beside PERFORM, off the axis. */
export const ASIDE = "evolve";
/** Where the app opens with no hash and no saved level (RFC-006: at rest is
 *  PERFORM). */
export const HOME = "perform";
/** ⌥1 to ⌥5, in the order ADR-017 gives them. */
export const BY_DIGIT = ["perform", "patch", "evolve", "taste", "learning"];
/** Each level's name and the line under it in the header (`#where`). */
export const WHERE = {
  learning: ["Learning", "how it learns your taste"],
  taste: ["Taste", "the sound among all sounds"],
  perform: ["Perform", "the sound, under your hands"],
  patch: ["Patch", "what the sound is made of"],
  evolve: ["Evolve", "what it could become"],
};

/** Every level, on the axis or beside it. */
export const ALL = [...LEVELS, ASIDE];

export function isLevel(name) {
  return typeof name === "string" && ALL.includes(name);
}

/** The key that goes straight to a level ("⌥1" … "⌥5"). */
export function digitKey(level) {
  const i = BY_DIGIT.indexOf(level);
  return i < 0 ? "" : `⌥${i + 1}`;
}

/** Which way a move from `a` to `b` goes: "in" toward PATCH, "out" toward
 *  LEARNING, "left" into EVOLVE, "right" back out of it; null for no move. */
export function dirOf(a, b) {
  if (a === b || !isLevel(b)) return null;
  if (b === ASIDE) return "left";
  if (a === ASIDE) return "right";
  return LEVELS.indexOf(b) > LEVELS.indexOf(a) ? "in" : "out";
}

/** The level one step `dir` ("in" or "out") from `cur`, or null at the end
 *  of the axis. From EVOLVE a step is measured from PERFORM, the level it
 *  sits beside. */
export function step(cur, dir) {
  const from = cur === ASIDE || !LEVELS.includes(cur) ? HOME : cur;
  const i = LEVELS.indexOf(from) + (dir === "in" ? 1 : dir === "out" ? -1 : 0);
  if (i === LEVELS.indexOf(from) || i < 0 || i >= LEVELS.length) return null;
  return LEVELS[i];
}

/** The stops a move passes on the rail. The rail is a cross: EVOLVE branches
 *  off PERFORM, so a trip between EVOLVE and another level turns the corner
 *  at PERFORM. */
export function railPath(a, b) {
  if (a === b) return [a];
  const corner = (a === ASIDE) !== (b === ASIDE) && a !== HOME && b !== HOME;
  return corner ? [a, HOME, b] : [a, b];
}

/** A saved level as this build names it. PATCH was the view "play" before
 *  the levels; a level saved under that name opens PATCH. Anything else
 *  unknown is no level. */
export function savedLevel(name) {
  if (name === "play") return "patch";
  return isLevel(name) ? name : null;
}

/** The level a URL's hash names ("#taste"), or null. */
export function hashLevel(hash) {
  const name = String(hash || "").replace(/^#/, "").toLowerCase();
  return savedLevel(name);
}

/** Where the app opens: the hash if it names a level, else the level saved
 *  last time, else PERFORM. */
export function startLevel(hash, saved) {
  return hashLevel(hash) || savedLevel(saved) || HOME;
}

/** What a level key does, from `cur`: the level to go to, or null. `key` is
 *  the event's `key` and `code` is its `code` (a digit is read from `code`,
 *  since ⌥1 types "¡" on a Mac). */
export function levelForKey(cur, key, code) {
  if (key === "ArrowUp") return step(cur, "out");
  if (key === "ArrowDown") return step(cur, "in");
  if (key === "ArrowLeft") return cur === ASIDE ? null : ASIDE;
  if (key === "ArrowRight") return cur === ASIDE ? HOME : null;
  const m = /^Digit([1-5])$/.exec(code || "");
  if (m) return BY_DIGIT[Number(m[1]) - 1];
  return null;
}

// ---------- moving between them (Plan-008 §2.3, the specimen's morph) ----------
// The sound you're playing is the one thing that carries you from level to
// level: the level you leave scales and fades, the one you reach comes from
// the other side, and between them the sound's face travels from where one
// level draws it to where the other does (shell.js `show`). These are the
// rules of that move; shell.js does the DOM.

/** How the two sections move, by the move's direction: `[leaving, arriving]`,
 *  each a CSS transform from and to. In, the level you leave grows past you
 *  and the one you reach arrives from small; out, the reverse; aside, a
 *  slide of 14% (the specimen's `KEYFRAMES`). */
export const MORPH = {
  in: [["scale(1)", "scale(1.12)"], ["scale(0.86)", "scale(1)"]],
  out: [["scale(1)", "scale(0.86)"], ["scale(1.12)", "scale(1)"]],
  left: [["translateX(0)", "translateX(14%)"], ["translateX(-14%)", "translateX(0)"]],
  right: [["translateX(0)", "translateX(-14%)"], ["translateX(14%)", "translateX(0)"]],
};
/** The level you leave has faded by this far through the move, and the one
 *  you reach starts to show after this far: in between, the face alone
 *  carries you across. */
export const MORPH_GONE = 0.45;
export const MORPH_SHOWN = 0.4;

/** Where the header's new name comes from, `[dx, dy]` in px: zooming in it
 *  rises from below, out it drops from above, aside it slides in from the
 *  side you went. */
export const WHERE_SLIDE = { in: [0, 10], out: [0, -10], left: [-14, 0], right: [14, 0] };

/** How far the rail nods at the end of the axis, in px. */
export const NOD_PX = 6;

/** The face's flight, from where the level you leave draws the sound (`from`,
 *  a box `{x, y, w, h}` or null) to where the level you reach draws it
 *  (`to`). A level with no place for the sound makes up none: with no
 *  `from` the face fades in where it lands, with no `to` it fades out
 *  drifting the way you went (the specimen's `overlay.fly`), and with
 *  neither nothing flies (null). `fade` says which. */
export function flightEnds(from, to, dir) {
  const ok = (b) => !!b && [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w > 0 && b.h > 0;
  const a = ok(from) ? { x: from.x, y: from.y, w: from.w, h: from.h } : null;
  const b = ok(to) ? { x: to.x, y: to.y, w: to.w, h: to.h } : null;
  if (!a && !b) return null;
  if (!a) return { from: { ...b }, to: b, fade: "in" };
  if (b) return { from: a, to: b, fade: null };
  const side = dir === "left" ? 1 : dir === "right" ? -1 : 0;
  return {
    from: a,
    to: { x: a.x + side * a.w * 1.4 + a.w * 0.1, y: a.y + a.h * 0.1, w: a.w * 0.8, h: a.h * 0.8 },
    fade: "out",
  };
}

/** The move's curve: slow out, quick across, slow in (cubic in-out), as the
 *  specimen's flight eases. */
export function easeInOut(t) {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Where the face is `t` (0..1) of the way through its flight, and how
 *  strongly it is drawn. At 1 it is exactly at the flight's end. */
export function flightAt(f, t) {
  const k = easeInOut(t);
  const box = {
    x: f.from.x + (f.to.x - f.from.x) * k,
    y: f.from.y + (f.to.y - f.from.y) * k,
    w: f.from.w + (f.to.w - f.from.w) * k,
    h: f.from.h + (f.to.h - f.from.h) * k,
  };
  const alpha = f.fade === "in" ? k : f.fade === "out" ? 1 - k : 1;
  return { box, alpha };
}

// ---------- the gestures ----------
/** ⌥ and the wheel (or a trackpad's pinch, which arrives as ctrl and the
 *  wheel) move a level once this much wheel has turned one way. */
export const WHEEL_STEP = 70;
/** A pause this long starts the count again. */
export const WHEEL_IDLE_MS = 400;
/** After a move, the rest of the same turn (a wheel's momentum, a trackpad's
 *  glide) moves nothing for this long: when, not how long a motion takes. */
export const WHEEL_LOCK_MS = 500;

/** One wheel event, `dy` px (down positive) at `now` ms, on the count `st`
 *  (`{acc, last, lock}`; start from `{}`): the count after it, and the way
 *  to move if it has turned far enough, "in" for up (toward PATCH, as the
 *  rack's camera zooms in on it) and "out" for down. */
export function wheelStep(st, dy, now) {
  const last = Number.isFinite(st?.last) ? st.last : -Infinity;
  const lock = Number.isFinite(st?.lock) ? st.lock : -Infinity;
  if (now < lock) return { st: { acc: 0, last: now, lock }, dir: null };
  const acc = (now - last > WHEEL_IDLE_MS ? 0 : st.acc || 0) + (Number.isFinite(dy) ? dy : 0);
  if (Math.abs(acc) > WHEEL_STEP) return { st: { acc: 0, last: now, lock: now + WHEEL_LOCK_MS }, dir: acc < 0 ? "in" : "out" };
  return { st: { acc, last: now, lock }, dir: null };
}

/** Two fingers on a touch screen: spread past 1.3 × the distance they
 *  started at is a move in, closed under 0.77 × a move out. */
export const PINCH_IN = 1.3;
export const PINCH_OUT = 0.77;

/** A pinch at `ratio` (the fingers' distance over where they started): the
 *  way to move once it has gone far enough, and otherwise which way it
 *  leans and how far (0..1), for the rail to lean toward that level. */
export function pinchStep(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return { dir: null, lean: null };
  if (ratio > PINCH_IN) return { dir: "in", lean: null };
  if (ratio < PINCH_OUT) return { dir: "out", lean: null };
  const lean = ratio >= 1
    ? { dir: "in", t: Math.min(1, (ratio - 1) / (PINCH_IN - 1)) }
    : { dir: "out", t: Math.min(1, (1 - ratio) / (1 - PINCH_OUT)) };
  return { dir: null, lean };
}
