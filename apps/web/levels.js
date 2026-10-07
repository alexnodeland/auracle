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

/** Whose a turn of ⌥ and the wheel is: one that starts over something that
 *  can still scroll that way is that scroller's ("scroll") until the turn
 *  ends, a pause of `WHEEL_IDLE_MS`, as the browser keeps a scroll on the
 *  list it started in; any other is the levels' ("levels"). `turn`
 *  (`{to, last}`, or null), the event's time, and whether what is under
 *  the pointer can scroll that way now: the turn after it. */
export function wheelOwner(turn, now, scrolls) {
  const last = Number.isFinite(turn?.last) ? turn.last : -Infinity;
  const to = now - last > WHEEL_IDLE_MS || !turn?.to ? (scrolls ? "scroll" : "levels") : turn.to;
  return { to, last: now };
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

// ---------- ⌘K: the one list (Plan-008 §2.4) ----------
// Every command and every sound in one list, found by typing. These are the
// rules for what a query finds and in what order; shell.js draws the list.

/** How well a query names a label: its start (a shorter label first), then
 *  the start of a word in it (an earlier word first), then anywhere in it
 *  (earlier first), then its letters in order, scattered; -1 for no match.
 *  An empty query names everything alike. The specimen's `rank`. */
export function rank(q, s) {
  const k = String(q || "").trim().toLowerCase();
  if (!k) return 1;
  const l = String(s || "").toLowerCase();
  if (l.startsWith(k)) return 100 - l.length * 0.05;
  const wi = wordStarts(l).findIndex((at) => l.startsWith(k, at));
  if (wi >= 0) return 80 - wi;
  const ci = l.indexOf(k);
  if (ci >= 0) return 60 - ci * 0.2;
  return fuzzy(k, l) ? 20 : -1;
}

/** Where each word of a label starts: after anything that is not a letter or
 *  a digit. */
function wordStarts(l) {
  const at = [];
  for (let i = 0; i < l.length; i++) {
    const word = /[\p{L}\p{N}]/u.test(l[i]);
    if (word && (i === 0 || !/[\p{L}\p{N}]/u.test(l[i - 1]))) at.push(i);
  }
  return at;
}

/** A query's letters in a label, in order and case aside: where each falls
 *  (the first place it can), or null when they don't all appear. */
export function fuzzy(q, s) {
  const k = String(q || "").trim().toLowerCase();
  const l = String(s || "").toLowerCase();
  const at = [];
  for (let j = 0; j < l.length && at.length < k.length; j++) if (l[j] === k[at.length]) at.push(j);
  return at.length === k.length ? at : null;
}

/** What to mark in a label for a query: the letters it matched, as the
 *  match `rank` counted (the run at its start, at a word or anywhere, else
 *  the scattered letters); none for an empty query or no match. */
export function hitMarks(q, s) {
  const k = String(q || "").trim().toLowerCase();
  if (!k) return [];
  const l = String(s || "").toLowerCase();
  const run = (from) => Array.from({ length: k.length }, (_, i) => from + i);
  if (l.startsWith(k)) return run(0);
  const w = wordStarts(l).find((at) => l.startsWith(k, at));
  if (w != null) return run(w);
  const ci = l.indexOf(k);
  if (ci >= 0) return run(ci);
  return fuzzy(k, l) || [];
}

/** How many sounds the list shows: with no query, and with one. */
export const SOUNDS_SHOWN = [5, 8];

/** The list for a query. `groups` is `[{name, items, cap}]`, each item with
 *  a `label`, in the order to show them with no query; `cap` is
 *  `[none, some]`, how many of its hits a group shows without a query and
 *  with one (all, without a cap). A group's hits stand best first (ties in
 *  the order given), a group with none is left out, and with a query the
 *  group holding the best hit comes first, so the first row is what was
 *  typed. Each hit carries the letters to mark. */
export function cmdkList(groups, q) {
  const k = String(q || "").trim();
  const out = [];
  for (const g of groups || []) {
    const hits = [];
    (g.items || []).forEach((item, i) => {
      const r = rank(k, item.label);
      if (r >= 0) hits.push({ item, r, i });
    });
    if (!hits.length) continue;
    hits.sort((a, b) => b.r - a.r || a.i - b.i);
    const cap = g.cap ? g.cap[k ? 1 : 0] : Infinity;
    out.push({
      name: g.name,
      best: hits[0].r,
      hits: hits.slice(0, cap).map(({ item }) => ({ item, marks: hitMarks(k, item.label) })),
    });
  }
  if (k) out.sort((a, b) => b.best - a.best);
  return out.map(({ name, hits }) => ({ name, hits }));
}
