// Unit tests for warm.js: the warm start's nine cards, one per family first,
// with the random function fixed by the test.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { warmSample, WARM_CARDS } from "../warm.js";

/** A library in category order, as the engine lists it: `counts` rows of
 *  each family, indexed from 0. */
function library(counts) {
  const rows = [];
  for (const [category, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) rows.push({ index: rows.length, category, name: `${category} ${i + 1}` });
  }
  return rows;
}

/** A random function that returns `draws` in turn (then 0), and counts its
 *  calls. */
function scripted(draws = []) {
  const f = () => {
    f.calls += 1;
    return draws.length ? draws.shift() : 0;
  };
  f.calls = 0;
  return f;
}

/** A seeded draw in [0, 1) (mulberry32), for the properties over many runs. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHIPPED = { bass: 5, lead: 4, pad: 4, keys: 3, pluck: 3, perc: 3, fx: 2, drone: 2, texture: 2 };

test("nine cards, every family among them, in library order, none twice", () => {
  const rows = library(SHIPPED);
  for (let seed = 1; seed <= 200; seed++) {
    const cards = warmSample(rows, seeded(seed));
    assert.equal(cards.length, WARM_CARDS);
    assert.equal(new Set(cards.map((r) => r.index)).size, cards.length, "a card twice");
    assert.deepEqual(new Set(cards.map((r) => r.category)), new Set(Object.keys(SHIPPED)), `seed ${seed}: a family left out`);
    assert.deepEqual(cards.map((r) => r.index), [...cards.map((r) => r.index)].sort((a, b) => a - b), "not in library order");
    for (const c of cards) assert.ok(rows.includes(c), "a card that is not one of the library's rows");
  }
});

test("each family's card is drawn by the random function, one draw per family in the order they first appear", () => {
  // Nine families of three (rows 0–2, 3–5, …), so the nine are the draws
  // alone. A draw of 0.99 takes a family's last row, 0 its first, 0.5 its
  // middle; the draws after the third are 0.
  const rows = library(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`family${i}`, 3])));
  const random = scripted([0.99, 0, 0.5]);
  assert.deepEqual(warmSample(rows, random).map((r) => r.index), [2, 3, 7, 9, 12, 15, 18, 21, 24]);
  assert.ok(random.calls >= 9, "one draw per family");
});

test("with fewer families than nine, the rest are filled from the rows not drawn, until there are nine", () => {
  const rows = library({ bass: 6, lead: 6 });
  for (let seed = 1; seed <= 50; seed++) {
    const cards = warmSample(rows, seeded(seed));
    assert.equal(cards.length, WARM_CARDS);
    assert.ok(cards.some((r) => r.category === "bass") && cards.some((r) => r.category === "lead"));
  }
});

test("a library of nine or fewer is shown whole, in library order", () => {
  const nine = library({ bass: 3, pad: 3, perc: 3 });
  assert.deepEqual(warmSample(nine, seeded(7)).map((r) => r.index), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const four = library({ bass: 2, pad: 2 });
  assert.deepEqual(warmSample(four, seeded(7)).map((r) => r.index), [0, 1, 2, 3]);
  assert.deepEqual(warmSample([], seeded(7)), []);
});

test("more than nine families: the first nine to appear each give one card, and nothing fills behind them", () => {
  const counts = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`family${i}`, 2]));
  const rows = library(counts);
  for (let seed = 1; seed <= 50; seed++) {
    const cards = warmSample(rows, seeded(seed));
    assert.equal(cards.length, WARM_CARDS);
    assert.deepEqual(cards.map((r) => r.category), Array.from({ length: 9 }, (_, i) => `family${i}`));
  }
});

test("the same draws give the same nine: the random function is the only source of chance", () => {
  const rows = library(SHIPPED);
  assert.deepEqual(warmSample(rows, seeded(20260928)), warmSample(rows, seeded(20260928)));
  // Different draws can give a different nine.
  const seen = new Set();
  for (let seed = 1; seed <= 20; seed++) seen.add(warmSample(rows, seeded(seed)).map((r) => r.index).join(","));
  assert.ok(seen.size > 1, "twenty seeds dealt one nine");
});

test("with no random function handed in it draws from Math.random, read at the call", (t) => {
  const rows = library(SHIPPED);
  const random = scripted();
  t.mock.method(Math, "random", random);
  const cards = warmSample(rows);
  assert.equal(cards.length, WARM_CARDS);
  // One draw per family, then the shuffle of the rest.
  assert.ok(random.calls >= Object.keys(SHIPPED).length, `Math.random was called ${random.calls} times`);
});
