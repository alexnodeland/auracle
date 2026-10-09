// Unit tests for refit.js: what main does with a refit landing (#300).
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { landRefit } from "../refit.js";
import { createHand } from "../hand.js";

/** Main's side, recording what was done, over a hand on a clock that never
 *  moves (`over`: the pointer is over a region). */
function host({ over = false } = {}) {
  const did = [];
  const hand = createHand({ now: () => 0, setTimer: () => 0, clearTimer: () => {} });
  if (over) hand.enter();
  return {
    did,
    hand,
    lampOff: () => did.push("lampOff"),
    stillFitting: () => did.push("stillFitting"),
    learned: () => did.push("learned"),
    status: (st) => did.push(`status:${st.n}`),
    views: (v) => did.push(`views:${v.id}`),
    posteriorChanged: () => did.push("posterior"),
  };
}

const fitted = (extra = {}) => ({ type: "fitted", views: { id: 1 }, status: { n: 7 }, ...extra });

test("a fit the engine refused teaches nothing: the meter, the views and the posterior's readers are untouched", () => {
  const h = host();
  assert.equal(landRefit(fitted({ refused: "stale" }), h), false);
  assert.deepEqual(h.did, ["lampOff", "stillFitting", "status:7"]);
});

test("an installed fit says it learned, and moves the views and the posterior's readers at once", () => {
  const h = host();
  assert.equal(landRefit(fitted(), h), true);
  assert.deepEqual(h.did, ["lampOff", "learned", "status:7", "views:1", "posterior"]);
});

test("under the pointer only the views wait, and a newer views post drops them, not the rest", () => {
  const h = host({ over: true });
  landRefit(fitted(), h);
  assert.deepEqual(h.did, ["lampOff", "learned", "status:7", "posterior"]);
  // A newer views post (main's `applyViews` drops the held one).
  h.hand.drop("views");
  h.hand.leave();
  assert.deepEqual(h.did, ["lampOff", "learned", "status:7", "posterior"]);
  // Not dropped, they land when the pointer leaves.
  const k = host({ over: true });
  landRefit(fitted(), k);
  k.hand.leave();
  assert.deepEqual(k.did.slice(-2), ["posterior", "views:1"]);
});
