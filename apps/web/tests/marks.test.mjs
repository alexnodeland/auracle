// Unit tests for marks.js: what pointing at EVOLVE POOL marks in the bank,
// the seeds and what may or will be replaced, read from the engine's lists
// by what is running.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { evolveMarks, bankMarks, retiringAfter, NO_MARKS } from "../marks.js";

/** The marks as the bank paints them: sorted ids, and the word's kind. */
function painted(state) {
  const m = bankMarks(evolveMarks(state));
  return { seeds: [...m.seeds].sort((a, b) => a - b), may: [...m.may].sort((a, b) => a - b), kind: m.kind };
}

const RATINGS = { seeds: [4, 9, 12], may_replace: [31, 27, 40, 33] };
const FULL = { pool: 40, pool_target: 40 };

test("at rest, the seeds and what may be replaced are the engine's ratings, and nothing else", () => {
  assert.deepEqual(painted({ ratings: RATINGS, status: FULL }), { seeds: [4, 9, 12], may: [27, 31, 33, 40], kind: "may" });
  // A pick's ratings name others, and the marks are those.
  assert.deepEqual(painted({ ratings: { seeds: [1], may_replace: [2] }, status: FULL }), { seeds: [1], may: [2], kind: "may" });
});

test("at rest with no ratings yet, nothing is marked", () => {
  assert.deepEqual(painted({}), { seeds: [], may: [], kind: "may" });
  assert.deepEqual(painted({ ratings: null, status: FULL }), { seeds: [], may: [], kind: "may" });
  assert.deepEqual(painted({ ratings: { seeds: [3] }, status: FULL }), { seeds: [3], may: [], kind: "may" });
});

test("while a generation runs, its own seeds and what its end will replace, said will", () => {
  const breeding = { seeds: [5, 6], retiring: [20, 21] };
  // The ratings name the next generation's: not read while one runs.
  assert.deepEqual(painted({ breeding, ratings: RATINGS, status: FULL }), { seeds: [5, 6], may: [20, 21], kind: "will" });
});

test("a generation's will-be-replaced is empty until its first child lands, and its seeds wait for its progress", () => {
  assert.deepEqual(painted({ breeding: { seeds: null, retiring: [] }, ratings: RATINGS }), { seeds: [], may: [], kind: "will" });
  assert.deepEqual(painted({ breeding: {}, ratings: RATINGS }), { seeds: [], may: [], kind: "will" });
});

test("while ⚡ walks: its seed, and the first of may_replace past it that its child would replace", () => {
  const evolvingFrom = { id: 31, name: "Glass Pad" };
  // At size, one: the seed in flight is passed over, so the next is marked.
  assert.deepEqual(painted({ evolvingFrom, ratings: RATINGS, status: FULL }), { seeds: [31], may: [27], kind: "may" });
  // Over size by one, two.
  assert.deepEqual(painted({ evolvingFrom, ratings: RATINGS, status: { pool: 41, pool_target: 40 } }), { seeds: [31], may: [27, 40], kind: "may" });
  // A seed that is not on the list: the first of it.
  assert.deepEqual(painted({ evolvingFrom: { id: 4 }, ratings: RATINGS, status: FULL }), { seeds: [4], may: [31], kind: "may" });
});

test("while ⚡ walks on a pool still filling, only its seed: its child takes a free place", () => {
  const evolvingFrom = { id: 31 };
  assert.deepEqual(painted({ evolvingFrom, ratings: RATINGS, status: { pool: 30, pool_target: 40 } }), { seeds: [31], may: [], kind: "may" });
  assert.deepEqual(painted({ evolvingFrom, ratings: RATINGS, status: { pool: 39, pool_target: 40 } }), { seeds: [31], may: [], kind: "may" });
  // No status, or none with a target: nothing owed.
  assert.deepEqual(painted({ evolvingFrom, ratings: RATINGS, status: null }), { seeds: [31], may: [], kind: "may" });
  assert.deepEqual(painted({ evolvingFrom, ratings: RATINGS, status: { pool: 40 } }), { seeds: [31], may: [], kind: "may" });
  assert.deepEqual(painted({ evolvingFrom, ratings: null, status: FULL }), { seeds: [31], may: [], kind: "may" });
});

test("a generation running outranks ⚡: its lists are the marks", () => {
  assert.deepEqual(
    painted({ breeding: { seeds: [5], retiring: [20] }, evolvingFrom: { id: 31 }, ratings: RATINGS, status: FULL }),
    { seeds: [5], may: [20], kind: "will" },
  );
});

test("a sound that is a seed is marked a seed, and never also as one that may go", () => {
  assert.deepEqual(painted({ ratings: { seeds: [4, 9], may_replace: [9, 27] }, status: FULL }), { seeds: [4, 9], may: [27], kind: "may" });
  assert.deepEqual(painted({ breeding: { seeds: [20], retiring: [20, 21] } }), { seeds: [20], may: [21], kind: "will" });
});

test("away from EVOLVE POOL nothing is marked", () => {
  const m = bankMarks(NO_MARKS);
  assert.equal(m.seeds.size, 0);
  assert.equal(m.may.size, 0);
  assert.equal(m.kind, "may");
});

test("a save made while a generation runs: its reply's list replaces the one held, so the saved sound loses its mark and the one going instead gains it", () => {
  const breeding = { seeds: [5], retiring: [20, 21] };
  // Sound 20 saved: the engine's `pinned` passes over it and names 22.
  breeding.retiring = retiringAfter(breeding, { type: "pinned", ok: true, retiring: [21, 22] });
  assert.deepEqual(painted({ breeding, ratings: RATINGS }), { seeds: [5], may: [21, 22], kind: "will" });
  // An empty list is a list: nothing will be replaced now.
  assert.deepEqual(retiringAfter(breeding, { retiring: [] }), []);
});

test("a reply with no retiring list leaves what will be replaced as it was, and with no generation open there is none", () => {
  const breeding = { seeds: [5], retiring: [20, 21] };
  assert.deepEqual(retiringAfter(breeding, { type: "pinned", ok: true }), [20, 21]);
  assert.deepEqual(retiringAfter(breeding, { retiring: null }), [20, 21]);
  assert.deepEqual(retiringAfter(breeding, null), [20, 21]);
  assert.equal(retiringAfter(null, { retiring: [1] }), null);
});
