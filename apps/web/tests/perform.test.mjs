// Unit tests for perform.js's pure arithmetic: what a knob sounds at, and the
// bases that keep it there when controls leave the panel.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { soundingOf, foldHidden, rebase } from "../perform.js";

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
