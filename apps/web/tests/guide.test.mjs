// Unit tests for guide.js: what the guide pill reads back from storage, the
// first steps' old key migrated into it, and which steps a level shows.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { readGuide, stepsShown, GUIDE_KEY, OLD_STEPS_KEY } from "../guide.js";

const store = (o) => (k) => (k in o ? o[k] : null);

test("nothing stored is a fresh start, and nothing to migrate", () => {
  assert.deepEqual(readGuide(store({})), { done: [], closed: [], migrated: false });
});

test("the pill's own key is read as it was written: × per level", () => {
  const got = readGuide(store({ [GUIDE_KEY]: JSON.stringify({ done: ["play", "turn"], closed: ["patch"] }) }));
  assert.deepEqual(got, { done: ["play", "turn"], closed: ["patch"], migrated: false });
});

test("a × from before the levels had their own steps closed PERFORM's only", () => {
  const got = readGuide(store({ [GUIDE_KEY]: JSON.stringify({ done: [], closed: true }) }));
  assert.deepEqual(got.closed, ["perform"]);
});

test("the first steps' old array is migrated, and the pill opens", () => {
  const got = readGuide(store({ [OLD_STEPS_KEY]: JSON.stringify(["play", "offer"]) }));
  assert.deepEqual(got, { done: ["play", "offer"], closed: [], migrated: true });
});

test("the new key wins over the old one", () => {
  const got = readGuide(store({ [GUIDE_KEY]: JSON.stringify({ done: ["turn"], closed: false }), [OLD_STEPS_KEY]: JSON.stringify(["play"]) }));
  assert.deepEqual(got.done, ["turn"]);
  assert.equal(got.migrated, false);
});

test("what cannot be read is a fresh start; ids are strings, each once", () => {
  assert.deepEqual(readGuide(store({ [GUIDE_KEY]: "{" })).done, []);
  assert.deepEqual(readGuide(store({ [GUIDE_KEY]: JSON.stringify({ done: ["play", 3, "play", null], closed: "yes" }) })), { done: ["play"], closed: [], migrated: false });
  assert.deepEqual(readGuide(store({ [GUIDE_KEY]: JSON.stringify({ done: [], closed: ["patch", 4, "patch"] }) })).closed, ["patch"]);
  assert.deepEqual(readGuide(store({ [OLD_STEPS_KEY]: "not json" })), { done: [], closed: [], migrated: true });
  assert.deepEqual(readGuide(() => { throw new Error("private window"); }), { done: [], closed: [], migrated: false });
});

// PERFORM's five, as perform.js and main.js add them: the turn left out while
// the sound in hand is one no control reaches (#480).
const performSteps = (reachesNone) => [
  { id: "play" },
  { id: "turn", skip: () => reachesNone() },
  { id: "offer" },
  { id: "zoom" },
  { id: "model" },
  { id: "patch-play", levels: ["patch"] },
];
const ids = (shown) => ({ here: shown.here.map((s) => s.id), now: shown.now?.id ?? null });

test("a level shows its own steps, the first not done up next", () => {
  const steps = performSteps(() => false);
  assert.deepEqual(ids(stepsShown(steps, "perform", new Set(["play"]))), { here: ["play", "turn", "offer", "zoom", "model"], now: "turn" });
  assert.deepEqual(ids(stepsShown(steps, "patch", new Set())), { here: ["patch-play"], now: "patch-play" });
});

test("on a sound no control reaches, the turn is left out: its pip, and the step up next", () => {
  let none = true;
  const steps = performSteps(() => none);
  const shown = stepsShown(steps, "perform", new Set(["play"]));
  assert.deepEqual(ids(shown), { here: ["play", "offer", "zoom", "model"], now: "offer" });
  // Every other step done: the level's steps are done, and its closing line
  // is due, with the turn still not done.
  const rest = new Set(["play", "offer", "zoom", "model"]);
  assert.equal(stepsShown(steps, "perform", rest).now, null);
  // A sound a control turns: the turn is back, and up next.
  none = false;
  assert.deepEqual(ids(stepsShown(steps, "perform", rest)), { here: ["play", "turn", "offer", "zoom", "model"], now: "turn" });
});

test("a step done is shown done whether or not the sound in hand could do it", () => {
  const steps = performSteps(() => false);
  const done = new Set(["play", "turn"]);
  assert.equal(stepsShown(steps, "perform", done).now.id, "offer");
  // Left out on a sound no control reaches, it was still done.
  assert.equal(stepsShown(performSteps(() => true), "perform", done).now.id, "offer");
});
