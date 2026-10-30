// Unit tests for reach.js: which lit socket a finger beside it means.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { socketMeant, REACH_PRESS_PX, REACH_DROP_PX } from "../reach.js";

const at = (x, y, id) => ({ x, y, id });

test("a press within reach of one lit socket, the next far off, means it", () => {
  assert.equal(socketMeant([at(0, 0, "a"), at(100, 0, "b")], 15, 0, REACH_PRESS_PX)?.id, "a");
});

test("a press on bare panel away from every socket means none", () => {
  assert.equal(socketMeant([at(0, 0, "a"), at(100, 0, "b")], 50, 40, REACH_PRESS_PX), null);
});

test("a point between two about as near is ambiguous, and means none", () => {
  // 10 and 14 px: the second is within 1.5 times the first.
  assert.equal(socketMeant([at(0, 0, "a"), at(24, 0, "b")], 10, 0, REACH_PRESS_PX), null);
});

test("a drop reaches less far than a press: 15 px is a press's, not a drop's", () => {
  const cands = [at(0, 0, "a"), at(200, 0, "b")];
  assert.equal(socketMeant(cands, 15, 0, REACH_PRESS_PX)?.id, "a");
  assert.equal(socketMeant(cands, 15, 0, REACH_DROP_PX), null);
  assert.equal(socketMeant(cands, 10, 0, REACH_DROP_PX)?.id, "a");
});

test("an ambiguous drop means none, as one on empty panel does", () => {
  assert.equal(socketMeant([at(0, 0, "a"), at(16, 0, "b")], 7, 0, REACH_DROP_PX), null);
  assert.equal(socketMeant([at(0, 0, "a")], 60, 60, REACH_DROP_PX), null);
});

test("no lit sockets means none", () => {
  assert.equal(socketMeant([], 0, 0, REACH_PRESS_PX), null);
});
