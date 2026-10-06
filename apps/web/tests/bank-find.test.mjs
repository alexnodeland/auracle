// Unit tests for bank-find.js: Find a sound's rule, what a sound must hold to
// stay in the bank while words are typed.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { findQuery, bankMatches } from "../bank-find.js";

/** Rows as the presets tab lists them: a name, a family and a blurb. */
const LIBRARY = [
  { name: "Glass Pad", category: "pad", blurb: "Soft and wide, a slow filter sweep" },
  { name: "Sub Bass", category: "bass", blurb: "One deep sine, felt more than heard" },
  { name: "Acid Line", category: "bass", blurb: "A squelchy resonant filter" },
  { name: "Tin Bell", category: "perc", blurb: "Metallic strike" },
];
const found = (typed) => LIBRARY.filter((p) => bankMatches(findQuery(typed), p.name, p.category, p.blurb)).map((p) => p.name);

test("what is typed is read trimmed and lowercased", () => {
  assert.equal(findQuery("  Glass "), "glass");
  assert.equal(findQuery("PAD"), "pad");
  assert.equal(findQuery(""), "");
  assert.equal(findQuery("   "), "");
  assert.equal(findQuery(null), "");
  assert.equal(findQuery(undefined), "");
});

test("nothing typed finds every sound", () => {
  assert.deepEqual(found(""), LIBRARY.map((p) => p.name));
  assert.deepEqual(found("   "), LIBRARY.map((p) => p.name));
  assert.equal(bankMatches("", null), true, "even one with no name");
});

test("a sound's name finds it, in any case, anywhere in the name", () => {
  assert.deepEqual(found("glass"), ["Glass Pad"]);
  assert.deepEqual(found("GLASS"), ["Glass Pad"]);
  assert.deepEqual(found("ss p"), ["Glass Pad"], "across a space");
  assert.deepEqual(found("ub ba"), ["Sub Bass"]);
});

test("a family's name finds every sound in it", () => {
  assert.deepEqual(found("bass"), ["Sub Bass", "Acid Line"]);
  assert.deepEqual(found("Perc"), ["Tin Bell"]);
});

test("a word only a blurb holds finds the sound", () => {
  assert.deepEqual(found("squelchy"), ["Acid Line"]);
  assert.deepEqual(found("filter"), ["Glass Pad", "Acid Line"]);
  assert.deepEqual(found("felt more"), ["Sub Bass"]);
});

test("a word nothing holds finds nothing", () => {
  assert.deepEqual(found("zzqx"), []);
  // Words are matched as typed, not each on its own.
  assert.deepEqual(found("glass bass"), []);
});

test("a sound with no family or blurb is found by its name alone", () => {
  // A pool sound not opened from a preset: main.js hands null for both.
  assert.equal(bankMatches("drone", "Low Drone", null, null), true);
  assert.equal(bankMatches("pad", "Low Drone", null, null), false);
  assert.equal(bankMatches("drone", "Low Drone"), true);
  assert.equal(bankMatches("x", undefined, undefined, undefined), false);
  // The words of a missing field are never "null" or "undefined".
  assert.equal(bankMatches("null", "Low Drone", null, null), false);
  assert.equal(bankMatches("undefined", "Low Drone"), false);
});
