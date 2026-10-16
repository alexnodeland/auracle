// Unit tests for hand.js: a background result waits while the pointer is
// over the region it would move, and applies on leaving or after a rest.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { createHand, heldOrTouched, holdRegion, HAND_HOLD_MS, HAND_REST_MS } from "../hand.js";

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

test("a control held, however still, is under the hand", () => {
  assert.equal(heldOrTouched(true, 0, 60_000), true);
});

test("a control let go is under the hand for 1.5 s from the release, then not", () => {
  assert.equal(HAND_HOLD_MS, 1500);
  const released = 10_000;
  assert.equal(heldOrTouched(false, released, released), true);
  assert.equal(heldOrTouched(false, released, released + HAND_HOLD_MS - 1), true);
  assert.equal(heldOrTouched(false, released, released + HAND_HOLD_MS), false);
});

test("a panel never touched is not under the hand", () => {
  assert.equal(heldOrTouched(false, -Infinity, 0), false);
});

/** An element that only dispatches what a test fires at it. */
function element() {
  const on = new Map();
  return {
    addEventListener: (type, fn) => on.set(type, fn),
    fire: (type, pointerType = "mouse") => on.get(type)?.({ pointerType }),
  };
}

/** A hand that counts what it is told. */
function counted(c) {
  const hand = createHand(c);
  const told = { enter: 0, leave: 0 };
  return {
    told,
    hand: { ...hand, enter: () => (told.enter++, hand.enter()), leave: () => (told.leave++, hand.leave()) },
  };
}

test("a region's mouse holds what waits until it leaves, and the hand is told once each way", () => {
  const c = clock();
  const { hand, told } = counted(c);
  const el = element();
  holdRegion(el, hand, c);
  el.fire("pointerenter");
  el.fire("pointermove");
  el.fire("pointermove");
  let ran = 0;
  hand.after("places", () => ran++);
  c.advance(500);
  el.fire("pointermove");
  c.advance(900);
  assert.equal(ran, 0, "moving keeps it waiting");
  el.fire("pointerleave");
  assert.equal(ran, 1);
  assert.deepEqual(told, { enter: 1, leave: 1 });
});

test("a touch holds what waits until a rest after the finger lifts", () => {
  const c = clock();
  const { hand, told } = counted(c);
  const el = element();
  holdRegion(el, hand, c);
  el.fire("pointerenter", "touch");
  el.fire("pointerdown", "touch");
  c.advance(700);
  el.fire("pointermove", "touch");
  c.advance(200);
  el.fire("pointerleave", "touch"); // the finger lifts at 900 ms
  c.advance(100);
  let ran = 0;
  hand.after("places", () => ran++); // a result lands at 1000 ms
  c.advance(HAND_REST_MS - 101);
  assert.equal(ran, 0, "still waiting just before a rest after the lift");
  c.advance(1);
  assert.equal(ran, 1, "applies a rest after the lift");
  assert.deepEqual(told, { enter: 1, leave: 1 });
});

test("an extra hold (a card up) holds without the pointer, and its arrow steps start the rest again", () => {
  const c = clock();
  const hand = createHand(c);
  const el = element();
  let up = false;
  const region = holdRegion(el, hand, { ...c, extra: () => up });
  up = true;
  region.refresh();
  assert.equal(hand.held(), true);
  let ran = 0;
  hand.after("places", () => ran++);
  for (let i = 0; i < 6; i++) {
    c.advance(300);
    region.moved();
  }
  assert.equal(ran, 0, "steps every 300 ms keep it waiting");
  c.advance(HAND_REST_MS);
  assert.equal(ran, 1, "a rest after the last step lets it go");
  up = false;
  region.refresh();
  assert.equal(hand.held(), false);
});

test("a region released while hidden lets go of the mouse and a touch", () => {
  const c = clock();
  const hand = createHand(c);
  const el = element();
  const region = holdRegion(el, hand, c);
  el.fire("pointerenter");
  el.fire("pointerdown", "touch");
  let ran = 0;
  hand.after("places", () => ran++);
  region.release();
  assert.equal(ran, 1);
  assert.equal(hand.held(), false);
  c.advance(5_000);
  assert.equal(hand.held(), false);
});
