// Unit tests for guide.js's storage: what the guide pill reads back, and the
// first steps' old key migrated into it.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { readGuide, GUIDE_KEY, OLD_STEPS_KEY } from "../guide.js";

const store = (o) => (k) => (k in o ? o[k] : null);

test("nothing stored is a fresh start, and nothing to migrate", () => {
  assert.deepEqual(readGuide(store({})), { done: [], closed: false, migrated: false });
});

test("the pill's own key is read as it was written", () => {
  const got = readGuide(store({ [GUIDE_KEY]: JSON.stringify({ done: ["play", "turn"], closed: true }) }));
  assert.deepEqual(got, { done: ["play", "turn"], closed: true, migrated: false });
});

test("the first steps' old array is migrated, and the pill opens", () => {
  const got = readGuide(store({ [OLD_STEPS_KEY]: JSON.stringify(["play", "offer"]) }));
  assert.deepEqual(got, { done: ["play", "offer"], closed: false, migrated: true });
});

test("the new key wins over the old one", () => {
  const got = readGuide(store({ [GUIDE_KEY]: JSON.stringify({ done: ["turn"], closed: false }), [OLD_STEPS_KEY]: JSON.stringify(["play"]) }));
  assert.deepEqual(got.done, ["turn"]);
  assert.equal(got.migrated, false);
});

test("what cannot be read is a fresh start; ids are strings, each once", () => {
  assert.deepEqual(readGuide(store({ [GUIDE_KEY]: "{" })).done, []);
  assert.deepEqual(readGuide(store({ [GUIDE_KEY]: JSON.stringify({ done: ["play", 3, "play", null], closed: "yes" }) })), { done: ["play"], closed: false, migrated: false });
  assert.deepEqual(readGuide(store({ [OLD_STEPS_KEY]: "not json" })), { done: [], closed: false, migrated: true });
  assert.deepEqual(readGuide(() => { throw new Error("private window"); }), { done: [], closed: false, migrated: false });
});
