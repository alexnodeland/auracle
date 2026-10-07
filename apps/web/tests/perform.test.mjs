// Unit tests for perform.js's pure arithmetic: what a knob sounds at, and the
// bases that keep it there when controls leave the panel.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { soundingOf, foldHidden, rebase, wireKeyOf, relativeOf, predictedOf, graftIntent } from "../perform.js";

// A wiring that turns `addr` by `g` at a full turn, both halves open.
const wiring = (name, addr, g) => ({ name, knobs: [[addr, g]], search: false, purity: 1, reach: 1, position: 0, up: 1, down: 1 });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test("hiding a turned control leaves the knob sounding where it did", () => {
  // Bright at +1 adds 0.30 to the cutoff, Warmth at −1 takes 0.25 off it.
  const wire = [wiring("Bright", "f#cut", 0.3), wiring("Warmth", "f#cut", 0.25)];
  const values = [1, -1];
  const bases = new Map([["f#cut", 0.85]]);
  near(soundingOf(0.85, "f#cut", wire, values), 0.9);
  // Bright leaves the panel; Warmth stays.
  const folded = foldHidden(bases, wire, values, [false, true]);
  const after = soundingOf(folded.get("f#cut"), "f#cut", [wire[1]], [values[1]]);
  near(after, 0.9);
  // A base clamped to the travel first would have sounded at 0.75.
  near(soundingOf(1, "f#cut", [wire[1]], [values[1]]), 0.75);
});

test("a knob no hidden control turns keeps its base", () => {
  const wire = [wiring("Bright", "f#cut", 0.3), wiring("Snap", "env#att", -0.2)];
  const bases = new Map([["f#cut", 0.4], ["env#att", 0.5]]);
  const folded = foldHidden(bases, wire, [0.5, 0.5], [true, false]);
  near(folded.get("f#cut"), 0.4);
  // Snap's half turn folds into the attack it turned.
  near(folded.get("env#att"), 0.4);
  near(soundingOf(folded.get("env#att"), "env#att", [wire[0]], [0.5]), 0.4);
});

test("a control's value is clamped to its open halves, and the sum to the travel", () => {
  const half = { ...wiring("Space", "amp#rel", 0.5), down: 0 }; // only turns up
  near(soundingOf(0.5, "amp#rel", [half], [-1]), 0.5);
  near(soundingOf(0.9, "amp#rel", [half], [1]), 1 - 1e-6);
});

test("a re-check after a hide, with the same knobs and gains, leaves the sound where it was", () => {
  const wire = [wiring("Bright", "f#cut", 0.3), wiring("Warmth", "f#cut", 0.25)];
  const folded = foldHidden(new Map([["f#cut", 0.85]]), wire, [1, -1], [false, true]);
  // The panel now holds Warmth alone, at −1; its re-check measures the same.
  const kept = [wire[1]];
  const again = rebase(folded, kept, [-1], kept.map((w) => ({ ...w })), [-1]);
  near(soundingOf(again.get("f#cut"), "f#cut", kept, [-1]), 0.9);
  // The base stays past the travel: clamped on its own, it would sound 0.75.
  assert.ok(again.get("f#cut") > 1);
});

test("a re-check with new gains moves the bases, not the sound", () => {
  const before = [wiring("Bright", "f#cut", 0.3)];
  const after = [wiring("Bright", "f#cut", 0.2)];
  const bases = new Map([["f#cut", 0.5]]);
  const moved = rebase(bases, before, [0.5], after, [0.5]);
  near(soundingOf(moved.get("f#cut"), "f#cut", after, [0.5]), soundingOf(0.5, "f#cut", before, [0.5]));
});

test("a wiring's key: the patch, then the clip for a sound that listens, then the set", () => {
  const listening = JSON.stringify({ kind: "Vca", uid: 7, input: { kind: "AudioIn", uid: 9 } });
  const base = JSON.stringify({ kind: "Vca", input: { kind: "AudioIn" } }); // uids dropped
  // A custom set, asked in palette order whatever the panel's order.
  assert.equal(wireKeyOf(listening, [16, 0, 1, 2, 3, 4, 5], "c1"), `${base}|clip:c1#controls=0,1,2,3,4,5,16`);
  // The six on a listening tree: the patch and its clip, nothing more.
  assert.equal(wireKeyOf(listening, [0, 1, 2, 3, 4, 5], "c1"), `${base}|clip:c1`);
  assert.equal(wireKeyOf(listening, undefined, "c1"), `${base}|clip:c1`);
  // Every set of one patch starts with its six's key and `#controls=`
  // (what `borrowWiring` looks for), and two sets never share a key.
  const six = wireKeyOf(listening, null, "c1");
  assert.ok(wireKeyOf(listening, [6, 0], "c1").startsWith(`${six}#controls=`));
  assert.notEqual(wireKeyOf(listening, [6], "c1"), wireKeyOf(listening, [7], "c1"));
  // A sound that doesn't listen carries no clip; a key already composed is itself.
  const quiet = JSON.stringify({ kind: "Vco", uid: 1 });
  assert.equal(wireKeyOf(quiet, [16], "c1"), `${JSON.stringify({ kind: "Vco" })}#controls=16`);
  const composed = wireKeyOf(listening, [16], "c1");
  assert.equal(wireKeyOf(composed, undefined, "c1"), composed);
});

// A kept wiring: measured on a tree of shape `shape`, for the panel set `set`
// ("" is the six), turning `addrs` and measured at `values`.
const kept = (shape, set, addrs, values, tag) => ({ shape, set, data: { addrs, values, z: [tag], wiring: [wiring("Bright", addrs[0], 0.5)] } });

test("a patch nobody measured borrows the youngest relative of its shape", () => {
  // This tree: shape s1, its own knob values.
  const first = { shape: "s1", knobs: [["f#cut", 0.7], ["amp#attack", 0.1]] };
  const older = kept("s1", "", ["f#cut", "amp#attack"], [0.2, 0.2], "older");
  const younger = kept("s1", "", ["f#cut", "amp#attack"], [0.4, 0.4], "younger");
  const other = kept("s2", "", ["f#cut", "amp#attack"], [0.5, 0.5], "other");
  const data = relativeOf(first, [older, younger, other], "");
  // The youngest of its shape, centred on this tree's own values: its
  // controls' knobs and gains.
  assert.deepEqual(data.addrs, ["f#cut", "amp#attack"]);
  assert.deepEqual(data.values, [0.7, 0.1]);
  assert.deepEqual(data.wiring.map((w) => [w.name, w.knobs]), [["Bright", [["f#cut", 0.5]]]]);
  // The relative's own data is left as it was.
  assert.deepEqual(younger.data.values, [0.4, 0.4]);
  assert.deepEqual(younger.data.z, ["younger"]);
  assert.equal(younger.data.wiring[0].up, 1);
});

test("a borrowed wiring lends how its controls turn, never what the relative measured of itself", () => {
  // The relative: Bright turns its cutoff with its low half closed, Space
  // could not reach it (a search control), and it sits at its own z.
  const relative = {
    shape: "s1",
    set: "",
    data: {
      addrs: ["f#cut", "amp#release"],
      values: [0.2, 0.2],
      z: ["the relative's"],
      wiring: [
        { ...wiring("Bright", "f#cut", 0.5), index: 0, down: 0.01, up: 1.2, position: 1.5 },
        { name: "Space", index: 5, knobs: [], search: true, purity: 0, reach: 0, position: -2, up: null, down: null },
      ],
    },
  };
  const knobs = [["f#cut", 0.7], ["amp#release", 0.3]];
  // With no prediction of this tree: nothing says where it sits.
  const blank = relativeOf({ shape: "s1", knobs }, [relative], "");
  assert.deepEqual(blank.wiring.map((w) => w.name), ["Bright"], "the relative's search control is not lent");
  assert.deepEqual([blank.wiring[0].up, blank.wiring[0].down], [null, null], "both halves open, unverified");
  assert.equal(blank.wiring[0].position, null);
  assert.deepEqual(blank.z, []);
  // A prediction whose engine measured the sound: its z, and its positions by
  // control, where it placed the control.
  const predicted = { z: [0.1, 0.2], wiring: [{ index: 0, position: 0.4 }, { index: 1, position: -0.3 }] };
  const placed = relativeOf({ shape: "s1", knobs, predicted }, [relative], "");
  assert.deepEqual(placed.z, [0.1, 0.2]);
  assert.equal(placed.wiring[0].position, 0.4);
  // A prediction of a sound the engine had not measured places nothing.
  const unplaced = relativeOf({ shape: "s1", knobs, predicted: { ...predicted, z: [] } }, [relative], "");
  assert.equal(unplaced.wiring[0].position, null);
  // A control the prediction did not wire is not placed either.
  const elsewhere = relativeOf({ shape: "s1", knobs, predicted: { z: [0.1], wiring: [{ index: 1, position: 2 }] } }, [relative], "");
  assert.equal(elsewhere.wiring[0].position, null);
  // The relative itself is untouched.
  assert.equal(relative.data.wiring.length, 2);
  assert.equal(relative.data.wiring[0].down, 0.01);
});

test("a prediction of a sound the engine had not measured says nowhere it sits", () => {
  assert.equal(predictedOf(null), null);
  assert.equal(predictedOf({ shape: "s1" }), null);
  const measured = { z: [0.1], wiring: [{ index: 0, position: 0.4 }] };
  assert.equal(predictedOf({ predicted: measured }), measured, "placed: as the engine sent it");
  const blind = { z: [], wiring: [{ index: 0, position: 0 }] };
  assert.deepEqual(predictedOf({ predicted: blind }).wiring, [{ index: 0, position: null }]);
  assert.equal(blind.wiring[0].position, 0, "the engine's reply is untouched");
});

test("a relative of another shape, another set, or a knob this tree lacks lends nothing", () => {
  const first = { shape: "s1", knobs: [["f#cut", 0.7]] };
  assert.equal(relativeOf(first, [kept("s2", "", ["f#cut"], [0.2], "x")], ""), null);
  assert.equal(relativeOf(first, [kept("s1", "6,7", ["f#cut"], [0.2], "x")], ""), null);
  assert.deepEqual(relativeOf(first, [kept("s1", "6,7", ["f#cut"], [0.2], "x")], "6,7").values, [0.7]);
  // A kept entry from before sets were kept with it is the six's.
  const unset = kept("s1", undefined, ["f#cut"], [0.2], "x");
  assert.deepEqual(relativeOf(first, [unset], "").values, [0.7]);
  assert.equal(relativeOf(first, [kept("s1", "", ["f#cut", "f#res"], [0.2, 0.3], "x")], ""), null);
  // Without the engine's word on this tree, or its shape: nothing.
  assert.equal(relativeOf(null, [kept("s1", "", ["f#cut"], [0.2], "x")], ""), null);
  assert.equal(relativeOf({ knobs: [["f#cut", 0.7]] }, [kept("s1", "", ["f#cut"], [0.2], "x")], ""), null);
  assert.equal(relativeOf({ shape: "s1" }, [kept("s1", "", ["f#cut"], [0.2], "x")], ""), null);
  // A kept entry with no data is passed over.
  assert.deepEqual(relativeOf(first, [kept("s1", "", ["f#cut"], [0.2], "x"), { shape: "s1", set: "" }], "").values, [0.7]);
});

// A graft's turn: Space, turned up, its tree not committed yet.
const turned = { i: 5, dir: 1 };

test("a graft is bound to the tree it committed, not to a time", () => {
  // Asked at the turn, nothing is pending until the engine commits a tree.
  assert.equal(graftIntent.pending(turned, "grafted"), false);
  const committed = graftIntent.committed(turned, "grafted");
  assert.deepEqual(committed, { i: 5, dir: 1, key: "grafted" });
  assert.deepEqual(turned, { i: 5, dir: 1 }, "the turn's intent is left as it was");
  // Pending exactly while its own tree is the one in PERFORM.
  assert.equal(graftIntent.pending(committed, "grafted"), true);
  assert.equal(graftIntent.pending(committed, "another"), false);
  // Its own tree arriving keeps it; any other drops it.
  assert.equal(graftIntent.arrived(committed, "grafted"), committed);
  assert.equal(graftIntent.arrived(committed, "another"), null);
  // A tree arriving before the engine answered drops the turn too.
  assert.equal(graftIntent.arrived(turned, "another"), null);
  // Nothing asked: nothing to commit, nothing pending.
  assert.equal(graftIntent.committed(null, "grafted"), null);
  assert.equal(graftIntent.pending(null, "grafted"), false);
});

test("a refused commit leaves no pending graft, and a refusal of another tree leaves it", () => {
  const committed = graftIntent.committed(turned, "grafted");
  assert.equal(graftIntent.refused(committed, "grafted"), null);
  // A Keep refused while the graft's tree waits behind it in the lane.
  assert.equal(graftIntent.refused(committed, "kept"), committed);
  // A turn not yet committed is not what the bench refused.
  assert.equal(graftIntent.refused(turned, "grafted"), turned);
  assert.equal(graftIntent.refused(null, "grafted"), null);
});
