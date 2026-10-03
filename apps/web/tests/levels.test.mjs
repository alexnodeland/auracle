// Unit tests for levels.js: how the levels sit and how a key, a hash or a
// saved name moves between them.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import {
  LEVELS, ASIDE, HOME, BY_DIGIT, WHERE, ALL,
  isLevel, digitKey, dirOf, step, railPath, savedLevel, hashLevel, startLevel, levelForKey,
} from "../levels.js";

test("the axis runs out to in, with EVOLVE beside PERFORM", () => {
  assert.deepEqual(LEVELS, ["learning", "taste", "perform", "patch"]);
  assert.equal(ASIDE, "evolve");
  assert.equal(HOME, "perform");
  assert.deepEqual(ALL.slice().sort(), ["evolve", "learning", "patch", "perform", "taste"]);
  for (const l of ALL) assert.equal(WHERE[l].length, 2, `${l} has a name and a line`);
});

test("⌥1 to ⌥5 go to perform, patch, evolve, taste, learning", () => {
  assert.deepEqual(BY_DIGIT, ["perform", "patch", "evolve", "taste", "learning"]);
  assert.equal(digitKey("perform"), "⌥1");
  assert.equal(digitKey("learning"), "⌥5");
  assert.equal(digitKey("play"), "");
  for (let i = 1; i <= 5; i++) assert.equal(levelForKey("taste", "x", `Digit${i}`), BY_DIGIT[i - 1]);
  assert.equal(levelForKey("taste", "x", "Digit6"), null);
});

test("a move has a direction: in, out, or aside", () => {
  assert.equal(dirOf("perform", "patch"), "in");
  assert.equal(dirOf("perform", "taste"), "out");
  assert.equal(dirOf("learning", "patch"), "in");
  assert.equal(dirOf("patch", "evolve"), "left");
  assert.equal(dirOf("evolve", "taste"), "right");
  assert.equal(dirOf("taste", "taste"), null);
  assert.equal(dirOf("taste", "nowhere"), null);
});

test("a step stops at the ends, and from EVOLVE is measured from PERFORM", () => {
  assert.equal(step("perform", "in"), "patch");
  assert.equal(step("perform", "out"), "taste");
  assert.equal(step("taste", "out"), "learning");
  assert.equal(step("learning", "out"), null);
  assert.equal(step("patch", "in"), null);
  assert.equal(step("evolve", "out"), "taste");
  assert.equal(step("evolve", "in"), "patch");
  assert.equal(step("perform", "sideways"), null);
});

test("⌥ and an arrow: up zooms out, down zooms in, left to EVOLVE, right back", () => {
  assert.equal(levelForKey("perform", "ArrowUp"), "taste");
  assert.equal(levelForKey("perform", "ArrowDown"), "patch");
  assert.equal(levelForKey("patch", "ArrowLeft"), "evolve");
  assert.equal(levelForKey("evolve", "ArrowLeft"), null);
  assert.equal(levelForKey("evolve", "ArrowRight"), "perform");
  assert.equal(levelForKey("taste", "ArrowRight"), null);
  assert.equal(levelForKey("learning", "ArrowUp"), null);
  assert.equal(levelForKey("perform", "a", "KeyA"), null);
});

test("the rail turns the corner at PERFORM on the way to or from EVOLVE", () => {
  assert.deepEqual(railPath("taste", "evolve"), ["taste", "perform", "evolve"]);
  assert.deepEqual(railPath("evolve", "patch"), ["evolve", "perform", "patch"]);
  assert.deepEqual(railPath("perform", "evolve"), ["perform", "evolve"]);
  assert.deepEqual(railPath("taste", "patch"), ["taste", "patch"]);
  assert.deepEqual(railPath("taste", "taste"), ["taste"]);
});

test("a saved 'play' opens PATCH, and junk opens nothing", () => {
  assert.equal(savedLevel("play"), "patch");
  assert.equal(savedLevel("patch"), "patch");
  assert.equal(savedLevel("evolve"), "evolve");
  assert.equal(savedLevel("rack"), null);
  assert.equal(savedLevel(null), null);
  assert.equal(isLevel("play"), false);
});

test("the start level: the hash, else the saved level, else PERFORM", () => {
  assert.equal(hashLevel("#taste"), "taste");
  assert.equal(hashLevel("#TASTE"), "taste");
  assert.equal(hashLevel("#film-tour"), null);
  assert.equal(hashLevel(""), null);
  assert.equal(startLevel("#learning", "patch"), "learning");
  assert.equal(startLevel("", "patch"), "patch");
  assert.equal(startLevel("", "play"), "patch");
  assert.equal(startLevel("#nope", "nope"), "perform");
  assert.equal(startLevel("", null), "perform");
});
