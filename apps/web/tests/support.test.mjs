// Unit tests for support.js: how many sounds in the pool carry each module
// and each φ coordinate, read off the ranked rows' s-expressions by the token
// the grammar opens each module's term with.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sexprHead, sexprHeads, poolSupport } from "../support.js";

// The grammar's own table (auracle-grammar's
// term::tests::the_sexpr_heads_fixture_is_current): the token
// each kind's term opens with in `PatchTree::to_sexpr`, by the name the wire
// knows the kind by, and two patches' s-expressions with the kinds the rack
// description reads in them.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/sexpr-heads.json", import.meta.url), "utf8"));

/** A catalog of the fixture's every kind, with φ only where a test gives one. */
const catalog = (phis = {}) => Object.keys(fixture.heads).map((kind) => ({ kind, phi: phis[kind] || null }));
const row = (id, sexpr) => ({ id, sexpr });

test("every module is searched for by the token the grammar opens its term with", () => {
  const kinds = Object.keys(fixture.heads);
  // Not an empty table: it holds the two whose token is not their name.
  assert.equal(fixture.heads.audio_in, "audioin");
  assert.equal(fixture.heads.distortion, "dist");
  for (const kind of kinds) assert.equal(sexprHead(kind), fixture.heads[kind], kind);
});

test("a sound with an AUDIO IN counts as one that carries AUDIO IN", () => {
  const p = fixture.patches.find((x) => x.kinds.includes("audio_in"));
  assert.match(p.sexpr, /\(audioin /, "the grammar writes AUDIO IN as audioin");
  const { counts, total } = poolSupport([row(1, p.sexpr)], catalog());
  assert.equal(total, 1);
  assert.equal(counts.audio_in, 1);
  assert.equal(counts.filter, 1);
});

test("each sound counts exactly the modules the rack reads in it", () => {
  for (const p of fixture.patches) {
    const { counts } = poolSupport([row(1, p.sexpr)], catalog());
    const carried = Object.keys(counts).filter((k) => counts[k] > 0).sort();
    assert.deepEqual(carried, [...p.kinds].sort(), p.about);
  }
});

test("a coordinate counts each sound once, however many of its modules the sound has", () => {
  const drive = { fold: "n_drive", distortion: "n_drive", bitcrush: "n_drive", ringmod: "n_drive", vco: "n_vco" };
  const both = fixture.patches.find((x) => x.kinds.includes("fold") && x.kinds.includes("distortion"));
  const audio = fixture.patches.find((x) => x.kinds.includes("audio_in"));
  const { counts, byPhi, total } = poolSupport([row(1, both.sexpr), row(2, audio.sexpr)], catalog(drive));
  assert.equal(counts.fold, 1);
  assert.equal(counts.distortion, 1);
  assert.equal(byPhi.n_drive, 1, "a wavefolder over a distortion is one sound carrying n_drive, not two");
  assert.equal(byPhi.n_vco, 1);
  assert.equal(total, 2);
  // Two of one module in one sound is still one sound.
  const twice = "(voice a=0.10 d=0.30 s=0.70 r=0.30 (fold t=0.50 nomod (fold t=0.40 nomod (vco saw +0 0.50 nomod))))";
  assert.equal(poolSupport([row(3, twice)], catalog(drive)).counts.fold, 1);
});

test("a coordinate no sound carries is counted as none, and a module with no coordinate has a count and no coordinate", () => {
  const { byPhi } = poolSupport([], catalog({ filter: "n_filter", eq: "n_filter" }));
  assert.deepEqual(byPhi, { n_filter: 0 });
  const p = fixture.patches.find((x) => x.kinds.includes("audio_in"));
  const out = poolSupport([row(1, p.sexpr)], catalog({ filter: "n_filter" }));
  assert.equal(out.counts.audio_in, 1);
  assert.deepEqual(Object.keys(out.byPhi), ["n_filter"]);
});

test("a cut sound is out of every count and of the total; a row without an s-expression is in the total only", () => {
  const p = fixture.patches.find((x) => x.kinds.includes("audio_in"));
  const { counts, total } = poolSupport([row(1, p.sexpr), row(2, p.sexpr), row(3, "")], catalog(), new Set([2]));
  assert.equal(counts.audio_in, 1);
  assert.equal(total, 2);
});

test("an s-expression's heads are the tokens after each opening parenthesis, an empty socket's included", () => {
  assert.deepEqual(
    [...sexprHeads("(voice a=0.10 (capture loop 0.50s (silence)) (dist soft g=0.45 nomod (audioin 1 g=0.67 both)))")],
    ["voice", "capture", "silence", "dist", "audioin"],
  );
  assert.deepEqual([...sexprHeads("")], []);
  assert.deepEqual([...sexprHeads(undefined)], []);
});
