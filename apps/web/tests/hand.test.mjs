// Unit tests for hand.js: a background result waits while the pointer is
// over the region it would move, and applies on leaving or after a rest.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { createHand, HAND_REST_MS } from "../hand.js";

/** A clock and timers the test moves by hand. */
function clock() {
  let t = 0;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => (timers.set(++seq, { at: t + ms, fn }), seq),
    clearTimer: (id) => timers.delete(id),
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        t = next[1].at;
        next[1].fn();
      }
      t = end;
    },
  };
}

test("with the pointer over no region, a result applies at once", () => {
  const c = clock();
  const hand = createHand(c);
  let ran = 0;
  assert.equal(hand.after("fit", () => ran++), true);
  assert.equal(ran, 1);
  assert.equal(hand.held(), false);
});

test("a result waits while the pointer is over a region, and applies when it leaves", () => {
  const c = clock();
  const hand = createHand(c);
  const ran = [];
  hand.enter();
  assert.equal(hand.after("fit", () => ran.push("fit")), false);
  // Moving the whole time: never a rest, so it waits.
  for (let i = 0; i < 10; i++) {
    c.advance(HAND_REST_MS / 2);
    hand.move();
  }
  assert.deepEqual(ran, []);
  hand.leave();
  assert.deepEqual(ran, ["fit"]);
  c.advance(5 * HAND_REST_MS);
  assert.deepEqual(ran, ["fit"], "it ran twice");
});

test("a result waiting under a resting pointer applies after the rest", () => {
  const c = clock();
  const hand = createHand(c);
  let ran = 0;
  hand.enter();
  hand.after("fit", () => ran++);
  c.advance(HAND_REST_MS - 1);
  assert.equal(ran, 0);
  hand.move(); // the rest starts again
  c.advance(HAND_REST_MS - 1);
  assert.equal(ran, 0);
  c.advance(1);
  assert.equal(ran, 1);
  assert.equal(hand.held(), true, "the pointer is still there");
});

test("a later result under the same key takes the place of one waiting, and a dropped one never runs", () => {
  const c = clock();
  const hand = createHand(c);
  const ran = [];
  hand.enter();
  hand.after("fit", () => ran.push(1));
  hand.after("fit", () => ran.push(2));
  hand.after("other", () => ran.push("other"));
  hand.drop("other");
  hand.leave();
  assert.deepEqual(ran, [2]);
});

test("two regions: the pointer leaving one for another still holds", () => {
  const c = clock();
  const hand = createHand(c);
  let ran = 0;
  hand.enter();
  hand.enter();
  hand.after("fit", () => ran++);
  hand.leave();
  assert.equal(ran, 0);
  hand.leave();
  assert.equal(ran, 1);
  hand.leave(); // a leave with none entered counts nothing below zero
  assert.equal(hand.held(), false);
});

test("entering with a result already waiting starts its rest from the entry", () => {
  const c = clock();
  const hand = createHand(c);
  let ran = 0;
  hand.enter();
  hand.after("fit", () => ran++);
  hand.enter(); // into a second region, at once
  c.advance(HAND_REST_MS);
  assert.equal(ran, 1);
});
