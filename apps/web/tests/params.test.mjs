// Unit tests for params.js: what the address asks of a boot, `?farm=N` (or
// the setting kept for it) and `?seed=N`, bad input included.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { farmOverride, seedOverride, FARM_MAX } from "../params.js";

/** A setting that says what it holds, and how many times it was read. */
function setting(value) {
  const s = () => {
    s.reads += 1;
    return value;
  };
  s.reads = 0;
  return s;
}

test("?farm=N is the farm's width, floored and held to 0–8", () => {
  assert.equal(farmOverride("?farm=4"), 4);
  assert.equal(farmOverride("?farm=0"), 0);
  assert.equal(farmOverride("?farm=3.7"), 3);
  assert.equal(farmOverride("?farm=-2"), 0);
  assert.equal(farmOverride("?farm=99"), FARM_MAX);
  assert.equal(FARM_MAX, 8);
  // Among the address's other words, and as Number reads it.
  assert.equal(farmOverride("?seed=7&farm=2&film"), 2);
  assert.equal(farmOverride("?farm=0x4"), 4);
  assert.equal(farmOverride("?farm=%203"), 3);
});

test("a ?farm= that is not a number asks for nothing, and the machine's width stands", () => {
  for (const bad of ["?farm=abc", "?farm=Infinity", "?farm=-Infinity", "?farm=NaN", "?farm=2x"]) {
    assert.equal(farmOverride(bad, setting("3")), null, bad);
  }
});

test("with no ?farm the setting kept for it is read, by the same rules", () => {
  assert.equal(farmOverride("", setting("5")), 5);
  assert.equal(farmOverride("?seed=7", setting("12")), 8);
  assert.equal(farmOverride("", setting("lots")), null);
  assert.equal(farmOverride("", setting("")), null);
  assert.equal(farmOverride("", setting(null)), null);
  assert.equal(farmOverride(""), null, "no setting at all");
});

test("the address outranks the setting, and the setting is not read when the address names a farm", () => {
  const kept = setting("6");
  assert.equal(farmOverride("?farm=2", kept), 2);
  assert.equal(kept.reads, 0);
  // An empty ?farm= names one too: nothing, not the setting.
  assert.equal(farmOverride("?farm=", kept), null);
  assert.equal(kept.reads, 0);
  // The first ?farm= is the one read.
  assert.equal(farmOverride("?farm=1&farm=7", kept), 1);
});

test("?seed=N is the session's seed, any whole number, taken modulo 2^32 exactly", () => {
  const said = [];
  const warn = (s) => said.push(s);
  assert.equal(seedOverride("?seed=7", warn), 7);
  assert.equal(seedOverride("?seed=0", warn), 0);
  assert.equal(seedOverride("?seed=007", warn), 7);
  assert.equal(seedOverride("?seed=4294967295", warn), 4294967295);
  assert.equal(seedOverride("?seed=4294967296", warn), 0);
  assert.equal(seedOverride("?seed=4294967303", warn), 7);
  // Past what a double holds exactly: the remainder is the BigInt's.
  assert.equal(seedOverride("?seed=18446744073709551623", warn), 7);
  assert.equal(seedOverride("?film&seed=20260928", warn), 20260928);
  assert.deepEqual(said, []);
});

test("with no ?seed there is no seed, and nothing is said", () => {
  const said = [];
  assert.equal(seedOverride("", (s) => said.push(s)), null);
  assert.equal(seedOverride("?farm=2", (s) => said.push(s)), null);
  assert.deepEqual(said, []);
});

test("a ?seed= that is not a whole number is said in the console and ignored", () => {
  for (const raw of ["-1", "1.5", "1e3", " 7", "7 ", "abc", "", "0x10", "+7"]) {
    const said = [];
    assert.equal(seedOverride(`?seed=${encodeURIComponent(raw)}`, (s) => said.push(s)), null, JSON.stringify(raw));
    assert.deepEqual(said, [
      `[auracle] ?seed= takes a whole number, so "${raw}" is ignored and this session's random seed is its own.`,
    ]);
  }
});
