// Unit tests for the toast lane's queue (toasts.js): the order toasts reach
// the screen, each one's window, `replace`, `urgent`, the backlog's trim and
// the stale drop. The DOM is a fake that records what the lane did with each
// toast, and the clock and the timers are node:test's mock timers.
// Run: node --test apps/web/tests
import test from "node:test";
import assert from "node:assert/strict";
import { createToastLane, MAX_TOASTS, UNDO_WINDOW_MS, TOAST_MS, TOAST_STALE_MS } from "../toasts.js";

/** The fade's length in these tests (the app's is `--d-move`). */
const FADE = 500;
/** How long a remark holds the lane: its window, then its fade. */
const REMARK = TOAST_MS + FADE;
/** …and an undo. */
const UNDO = UNDO_WINDOW_MS + FADE;

/** A lane on a fake DOM, its clock at 0. `say` puts a toast in it and returns
 *  its entry; `wait` moves the clock a millisecond at a time, so each timer
 *  fires at its own moment and one it sets is run in turn. */
function setup(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const shown = [];
  const faded = [];
  const stacks = new Map();
  const view = {
    show: (el) => shown.push(el.text),
    remove: () => {},
    fade: (el) => faded.push(el.text),
    stack: (el, n) => stacks.set(el.text, n),
  };
  const lane = createToastLane({ view, fadeMs: () => FADE });
  return {
    lane,
    shown,
    faded,
    stacks,
    say: (text, opts) => lane.add({ text }, opts),
    wait: (ms) => {
      for (let i = 0; i < ms; i++) t.mock.timers.tick(1);
    },
    onScreen: () => lane.peek().live?.text ?? null,
    waiting: () => lane.peek().queued.map((el) => el.text),
  };
}

test("one toast is on screen at a time; the rest wait in order, counted beside it", (t) => {
  const l = setup(t);
  l.say("A");
  l.say("B");
  // Said a little later, so it is not too old to be shown when its turn comes.
  l.wait(1000);
  l.say("C");
  assert.equal(l.onScreen(), "A");
  assert.deepEqual(l.waiting(), ["B", "C"]);
  assert.equal(l.stacks.get("A"), 2);
  l.wait(REMARK);
  assert.equal(l.onScreen(), "B");
  assert.equal(l.stacks.get("B"), 1);
  l.wait(REMARK);
  assert.equal(l.onScreen(), "C");
  assert.equal(l.stacks.get("C"), 0);
  assert.deepEqual(l.shown, ["A", "B", "C"]);
});

test("a remark stays its window, then fades, and the next is shown once the fade has played", (t) => {
  const l = setup(t);
  l.say("A");
  l.say("B");
  l.wait(TOAST_MS - 1);
  assert.deepEqual(l.faded, []);
  l.wait(1);
  assert.deepEqual(l.faded, ["A"]);
  l.wait(FADE - 1);
  assert.equal(l.onScreen(), "A");
  l.wait(1);
  assert.equal(l.onScreen(), "B");
});

test("a window starts when the toast is shown, so an undo that waited still gets all of it", (t) => {
  const l = setup(t);
  l.say("remark");
  l.say("undo", { undo: () => {} });
  l.wait(REMARK);
  assert.equal(l.onScreen(), "undo");
  l.wait(UNDO_WINDOW_MS - 1);
  assert.deepEqual(l.faded, ["remark"]);
  l.wait(1);
  assert.deepEqual(l.faded, ["remark", "undo"]);
});

test("its undo pressed takes the toast down at once, and the next one is shown", (t) => {
  const l = setup(t);
  const u = l.say("undo", { undo: () => {} });
  l.say("next");
  l.wait(1000);
  l.lane.dismiss(u, true);
  assert.equal(l.onScreen(), "next");
});

test("replace: a later word on the same thing takes the screen at once, with its own full window", (t) => {
  const l = setup(t);
  l.say("picked A", { replace: "vote" });
  l.say("other");
  l.wait(3000);
  l.say("picked B", { replace: "vote" });
  assert.equal(l.onScreen(), "picked B");
  assert.deepEqual(l.waiting(), ["other"]);
  // The old toast's timer went with it: it cannot take its successor down.
  l.wait(TOAST_MS - 1);
  assert.equal(l.onScreen(), "picked B");
  assert.deepEqual(l.faded, []);
  assert.deepEqual(l.shown, ["picked A", "picked B"]);
});

test("replace: a queued word takes the earlier one's place in line, and only the newest is said", (t) => {
  const l = setup(t);
  l.say("live");
  l.wait(1000);
  l.say("loading", { replace: "warm" });
  l.say("other");
  l.say("loaded", { replace: "warm" });
  assert.deepEqual(l.waiting(), ["loaded", "other"]);
  l.wait(REMARK * 3);
  assert.deepEqual(l.shown, ["live", "loaded", "other"]);
});

test("replace: with nothing to replace, the toast waits at the back as usual", (t) => {
  const l = setup(t);
  l.say("live");
  l.say("other");
  l.say("first word", { replace: "k" });
  assert.deepEqual(l.waiting(), ["other", "first word"]);
});

test("urgent: a refusal jumps the queue and takes the screen; what it interrupted comes back behind it with a fresh window", (t) => {
  const l = setup(t);
  l.say("undo", { undo: () => {} });
  l.say("remark");
  l.wait(3000);
  l.say("refused", { urgent: true });
  assert.equal(l.onScreen(), "refused");
  assert.deepEqual(l.waiting(), ["undo", "remark"]);
  l.wait(REMARK);
  assert.equal(l.onScreen(), "undo");
  l.wait(UNDO_WINDOW_MS - 1);
  assert.equal(l.onScreen(), "undo");
  assert.deepEqual(l.faded, ["refused"]);
});

test("urgent: a toast already fading had its window, and is not brought back", (t) => {
  const l = setup(t);
  l.say("spent");
  l.wait(TOAST_MS + 100);
  assert.deepEqual(l.faded, ["spent"]);
  l.say("refused", { urgent: true });
  assert.equal(l.onScreen(), "refused");
  assert.deepEqual(l.waiting(), []);
  // The interrupted fade ends without taking the refusal down with it.
  l.wait(FADE);
  assert.equal(l.onScreen(), "refused");
});

test("urgent: the same refusal said again takes the earlier one's place", (t) => {
  const l = setup(t);
  l.say("nothing to undo", { urgent: true, replace: "undo-here" });
  l.say("nothing to undo", { urgent: true, replace: "undo-here" });
  assert.equal(l.onScreen(), "nothing to undo");
  assert.deepEqual(l.waiting(), []);
});

test("trim: the backlog keeps three waiting, and cuts the oldest plain remark first", (t) => {
  const l = setup(t);
  l.say("live");
  l.say("undo 1", { undo: () => {} });
  l.say("remark 1");
  l.say("undo 2", { undo: () => {} });
  l.say("remark 2");
  assert.equal(MAX_TOASTS, 3);
  assert.deepEqual(l.waiting(), ["undo 1", "undo 2", "remark 2"]);
  assert.equal(l.stacks.get("live"), 3);
});

test("trim: with no plain remark waiting it cuts the oldest undo, never a refusal", (t) => {
  const l = setup(t);
  l.say("refused 1", { urgent: true });
  l.say("undo 1", { undo: () => {} });
  l.say("undo 2", { undo: () => {} });
  l.say("undo 3", { undo: () => {} });
  l.say("undo 4", { undo: () => {} });
  assert.equal(l.onScreen(), "refused 1");
  assert.deepEqual(l.waiting(), ["undo 2", "undo 3", "undo 4"]);
  l.say("refused 2", { urgent: true });
  // "refused 1" was interrupted and waits behind the new refusal.
  assert.equal(l.onScreen(), "refused 2");
  assert.ok(l.waiting().includes("refused 1"));
});

test("stale: a plain remark that waited longer than TOAST_STALE_MS is dropped, not said late", (t) => {
  const l = setup(t);
  l.say("remark");
  l.say("undo", { undo: () => {} });
  l.say("late");
  // It would reach the screen after REMARK + UNDO.
  assert.ok(REMARK + UNDO > TOAST_STALE_MS);
  l.wait(REMARK + UNDO);
  assert.deepEqual(l.shown, ["remark", "undo"]);
  assert.equal(l.onScreen(), null);
});

test("stale: a remark shown within TOAST_STALE_MS of being said is shown", (t) => {
  const l = setup(t);
  l.say("first");
  l.wait(REMARK - 1);
  l.say("second");
  l.wait(1);
  assert.equal(l.onScreen(), "second");
});

test("stale: an undo is shown however long it waited", (t) => {
  const l = setup(t);
  l.say("undo 1", { undo: () => {} });
  l.say("remark");
  l.say("undo 2", { undo: () => {} });
  l.wait(UNDO + REMARK);
  assert.ok(UNDO + REMARK > TOAST_STALE_MS);
  assert.equal(l.onScreen(), "undo 2");
});

test("stale: a refusal is shown however long it waited", (t) => {
  const l = setup(t);
  l.say("refused 1", { urgent: true });
  l.say("refused 2", { urgent: true });
  l.say("refused 3", { urgent: true });
  // Each pre-empted the one before, which waits behind it.
  l.wait(REMARK * 2);
  assert.ok(REMARK * 2 > TOAST_STALE_MS);
  assert.equal(l.onScreen(), "refused 1");
});

test("retire: a toast whose claim stopped being true goes, on screen or still waiting", (t) => {
  const l = setup(t);
  l.say("live");
  const queued = l.say("queued");
  l.say("next");
  l.lane.retire(queued.el);
  assert.deepEqual(l.waiting(), ["next"]);
  l.lane.retire(l.lane.peek().live);
  assert.deepEqual(l.faded, ["live"]);
  l.wait(FADE);
  assert.equal(l.onScreen(), "next");
  assert.deepEqual(l.shown, ["live", "next"]);
});

test("drop: a toast taken back goes at once, and the count beside the screen follows", (t) => {
  const l = setup(t);
  const live = l.say("picked");
  const queued = l.say("queued");
  l.say("next");
  l.lane.drop(queued.el);
  assert.equal(l.stacks.get("picked"), 1);
  l.lane.drop(live.el);
  assert.equal(l.onScreen(), "next");
});

test("trim: a remark about the player's sounds is cut only after the plain remarks", (t) => {
  const l = setup(t);
  l.say("live");
  l.say("replaced Tine", { bank: true });
  l.say("remark 1");
  l.say("replaced Bell Jar", { bank: true });
  l.say("remark 2");
  assert.deepEqual(l.waiting(), ["replaced Tine", "replaced Bell Jar", "remark 2"]);
  l.say("remark 3");
  assert.deepEqual(l.waiting(), ["replaced Tine", "replaced Bell Jar", "remark 3"]);
});

test("stale: a plain remark still goes stale beside a remark about the player's sounds", (t) => {
  const l = setup(t);
  l.say("remark");
  l.say("undo", { undo: () => {} });
  l.say("narration");
  l.say("replaced Tine", { bank: true });
  // Both reach the head of the queue after REMARK + UNDO.
  assert.ok(REMARK + UNDO > TOAST_STALE_MS);
  l.wait(REMARK + UNDO);
  assert.deepEqual(l.shown, ["remark", "undo", "replaced Tine"]);
});

// #129. Measured on a fast machine (bank_kept.spec.js): the warm start's
// result was on screen, then "Saved …", "Kept … as new. It replaced …" and
// "Opened the preset as …. It replaced …" were said 1.7, 2.3 and 3.0 s after
// it, each a plain remark. The last reached the head of the queue 10.5 s
// after it was said, and was dropped as stale: the player was never told
// which sound the preset replaced.
test("a remark about the player's sounds waits its turn behind other remarks, however long", (t) => {
  const l = setup(t);
  l.say("Your three taught it 18 picks.", { replace: "warm" });
  l.wait(1700);
  l.say("Saved Noisy Stab.", { bank: true });
  l.wait(600);
  l.say("Kept Noisy Pluck as new. It replaced the lowest-rated sound it could: Woodblock.", { bank: true });
  l.wait(700);
  const replaced = "Opened the preset as First Bass. It replaced the lowest-rated sound it could: Tine.";
  l.say(replaced, { bank: true });
  l.wait(REMARK * 3);
  assert.ok(REMARK * 3 - 3000 > TOAST_STALE_MS, "it waited longer than the stale age");
  assert.deepEqual(l.shown.slice(-1), [replaced]);
});
