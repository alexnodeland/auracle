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
