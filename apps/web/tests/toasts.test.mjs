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
 *  fires at its own moment and one it sets is run in turn. The fake records
 *  what reached the screen (`shown`), what faded, and what was taken off it
 *  or out of the lane (`removed`). */
function setup(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const shown = [];
  const faded = [];
  const removed = [];
  const stacks = new Map();
  const view = {
    show: (el) => shown.push(el.text),
    remove: (el) => removed.push(el.text),
    fade: (el) => faded.push(el.text),
    stack: (el, n) => stacks.set(el.text, n),
  };
  const lane = createToastLane({ view, fadeMs: () => FADE });
  return {
    lane,
    shown,
    faded,
    removed,
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
  assert.deepEqual(l.removed, ["picked A"]);
  assert.deepEqual(l.waiting(), ["other"]);
  // The old toast's timer went with it: it cannot take its successor down,
  // nor touch the screen again when it would have run out.
  l.wait(TOAST_MS - 1);
  assert.equal(l.onScreen(), "picked B");
  assert.deepEqual(l.faded, []);
  assert.deepEqual(l.removed, ["picked A"]);
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
  assert.deepEqual(l.removed, ["loading"]);
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

test("urgent: a refusal said again on the same thing takes the earlier one's place, with its own window", (t) => {
  const l = setup(t);
  l.say("Nothing to undo here.", { urgent: true, replace: "undo-here" });
  l.wait(2000);
  l.say("Nothing to redo here.", { urgent: true, replace: "undo-here" });
  assert.equal(l.onScreen(), "Nothing to redo here.");
  assert.deepEqual(l.removed, ["Nothing to undo here."]);
  assert.deepEqual(l.waiting(), []);
  // The earlier one's timer went with it: the newer one gets its full window.
  l.wait(TOAST_MS - 1);
  assert.equal(l.onScreen(), "Nothing to redo here.");
  assert.deepEqual(l.faded, []);
  assert.deepEqual(l.removed, ["Nothing to undo here."]);
  l.wait(1);
  assert.deepEqual(l.faded, ["Nothing to redo here."]);
  assert.deepEqual(l.shown, ["Nothing to undo here.", "Nothing to redo here."]);
});

// A waiting toast is not on screen, so a cut one leaves the lane with nothing
// to take off the screen: these check it is out of the queue and never shown.
const NEVER = 60_000;

test("trim: the backlog keeps three waiting, and cuts the plain remark nearest the front first", (t) => {
  const l = setup(t);
  l.say("live");
  l.say("undo 1", { undo: () => {} });
  l.say("remark 1");
  l.say("undo 2", { undo: () => {} });
  l.say("remark 2");
  assert.equal(MAX_TOASTS, 3);
  assert.deepEqual(l.waiting(), ["undo 1", "undo 2", "remark 2"]);
  assert.equal(l.stacks.get("live"), 3);
  l.wait(NEVER);
  assert.ok(!l.shown.includes("remark 1"));
});

test("trim: with no plain remark waiting it cuts the undo nearest the front, never a refusal", (t) => {
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
  l.wait(NEVER);
  assert.ok(!l.shown.includes("undo 1"));
  assert.deepEqual(l.shown.filter((x) => x.startsWith("refused")), ["refused 1", "refused 2", "refused 1"]);
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

test("trim: a remark about the player's sounds is never cut, nor counted against the three waiting", (t) => {
  const l = setup(t);
  l.say("live");
  l.say("replaced Tine", { bank: true });
  l.say("remark 1");
  l.say("replaced Bell Jar", { bank: true });
  l.say("remark 2");
  l.say("remark 3");
  // Five waiting, three of them counted: nothing is cut.
  assert.deepEqual(l.waiting(), ["replaced Tine", "remark 1", "replaced Bell Jar", "remark 2", "remark 3"]);
  assert.equal(l.stacks.get("live"), 5);
  // A fourth counted: the plain remark nearest the front goes.
  l.say("remark 4");
  assert.deepEqual(l.waiting(), ["replaced Tine", "replaced Bell Jar", "remark 2", "remark 3", "remark 4"]);
  l.wait(NEVER);
  assert.ok(!l.shown.includes("remark 1"));
  assert.deepEqual(l.shown.slice(0, 3), ["live", "replaced Tine", "replaced Bell Jar"]);
});

test("trim: with no plain remark waiting it cuts the undo nearest the front, passing over a remark about the player's sounds", (t) => {
  const l = setup(t);
  l.say("live");
  const preset = "Opened the preset as First Bass. It replaced the lowest-rated sound it could: Tine.";
  l.say(preset, { bank: true });
  for (const n of [1, 2, 3, 4]) l.say(`undo ${n}`, { undo: () => {} });
  assert.deepEqual(l.waiting(), [preset, "undo 2", "undo 3", "undo 4"]);
  l.wait(NEVER);
  assert.deepEqual(l.shown, ["live", preset, "undo 2", "undo 3", "undo 4"]);
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

// #183: the three paths by which a remark about the player's sounds was still
// taken off the lane before it was read, after #129. Each was found in the
// review of #129's fix; the words are the app's.

// Keep a sound as new, and keep another before the first toast shows. The
// second commit's reveal (`replace: "commit"`) took the first one's place,
// and Woodblock was never named.
test("replace: a later word on its key doesn't take a waiting remark about the player's sounds; it waits behind it", (t) => {
  const l = setup(t);
  l.say("Picked Glass Pad over Soft Wash.");
  l.wait(1000);
  const first = "Kept Noisy Pluck as new. It replaced the lowest-rated sound it could: Woodblock.";
  l.say(first, { replace: "commit", bank: true });
  l.wait(1000);
  const reveal = "B was your edit, and you picked it.";
  l.say(reveal, { replace: "commit" });
  assert.deepEqual(l.waiting(), [first, reveal]);
  // The second commit lands: its own remark about the player's sounds takes
  // the reveal's place, as a later word on the same thing does.
  l.wait(1000);
  const second = "Kept Noisy Bell as new: B was your edit, and you picked it. It replaced the lowest-rated sound it could: Tine.";
  l.say(second, { replace: "commit", bank: true });
  assert.deepEqual(l.waiting(), [first, second]);
  assert.deepEqual(l.removed, [reveal]);
  l.wait(NEVER);
  assert.deepEqual(l.shown, ["Picked Glass Pad over Soft Wash.", first, second]);
});

test("replace: a later word on its key leaves a remark about the player's sounds on screen for its whole window", (t) => {
  const l = setup(t);
  const bred = "⚡ bred Glass 2 from Glass Pad, and it’s ready to play. It replaced the lowest-rated sound it could: Tine.";
  l.say(bred, { replace: "evolve-from", bank: true });
  l.wait(1000);
  const stopped = "⚡ stopped. Nothing was added to the pool.";
  l.say(stopped, { replace: "evolve-from" });
  assert.equal(l.onScreen(), bred);
  assert.deepEqual(l.waiting(), [stopped]);
  l.wait(TOAST_MS - 1001);
  assert.deepEqual(l.faded, []);
  l.wait(1);
  assert.deepEqual(l.faded, [bred]);
  l.wait(FADE);
  assert.equal(l.onScreen(), stopped);
  assert.deepEqual(l.removed, [bred]);
});

test("replace: a remark about the player's sounds still takes the place of an earlier plain word on its key", (t) => {
  const l = setup(t);
  const loading = "Opening those and teaching the model what you picked…";
  l.say(loading, { replace: "warm" });
  l.wait(2000);
  const taught = "Your three taught it 18 picks, so it starts out pointed at you. Your three are saved.";
  l.say(taught, { replace: "warm", bank: true });
  assert.equal(l.onScreen(), taught);
  assert.deepEqual(l.removed, [loading]);
  l.wait(TOAST_MS - 1);
  assert.deepEqual(l.faded, []);
});

// "⚡ bred Glass 2 … It replaced Tine." is on screen with OPEN IT, and ⚡ is
// pressed again while EVOLVE POOL is breeding. The refusal shares the key
// (`replace: "evolve-from"`), and took that toast and its button down at once.
test("urgent: a refusal on its key interrupts a remark about the player's sounds; it comes back with its button and a fresh window", (t) => {
  const l = setup(t);
  const bred = "⚡ bred Glass 2 from Glass Pad: it’s at the top of the pool, and your edits are still open. It replaced the lowest-rated sound it could: Tine.";
  l.say(bred, { undo: () => {}, undoLabel: "open it", replace: "evolve-from", bank: true });
  l.wait(3000);
  const refused = "⚡ didn’t start: EVOLVE POOL is breeding a generation. Press ⚡ again when it finishes.";
  l.say(refused, { urgent: true, replace: "evolve-from" });
  assert.equal(l.onScreen(), refused);
  assert.deepEqual(l.waiting(), [bred]);
  l.wait(REMARK);
  assert.equal(l.onScreen(), bred);
  l.wait(UNDO_WINDOW_MS - 1);
  assert.equal(l.onScreen(), bred);
  assert.deepEqual(l.faded, [refused]);
  l.wait(1);
  assert.deepEqual(l.faded, [refused, bred]);
  assert.deepEqual(l.shown, [bred, refused, bred]);
});

// The same refusal, with "⚡ bred …" still waiting behind a pick's toast
// rather than on screen: `dropReplaced` took it out of the queue, and it was
// never shown at all.
test("urgent: a refusal on its key leaves a waiting remark about the player's sounds in the queue; it is shown after the refusal and the toast it interrupted", (t) => {
  const l = setup(t);
  const pick = "Picked Glass Pad over Soft Wash.";
  l.say(pick, { undo: () => {}, replace: "vote" });
  l.wait(1000);
  const bred = "⚡ bred Glass 2 from Glass Pad: it’s at the top of the pool, and your edits are still open. It replaced the lowest-rated sound it could: Tine.";
  l.say(bred, { undo: () => {}, undoLabel: "open it", replace: "evolve-from", bank: true });
  l.wait(1000);
  const refused = "⚡ didn’t start: EVOLVE POOL is breeding a generation. Press ⚡ again when it finishes.";
  l.say(refused, { urgent: true, replace: "evolve-from" });
  assert.equal(l.onScreen(), refused);
  assert.deepEqual(l.waiting(), [pick, bred]);
  assert.deepEqual(l.removed, [pick]);
  l.wait(REMARK);
  assert.equal(l.onScreen(), pick);
  l.wait(UNDO);
  assert.equal(l.onScreen(), bred);
  l.wait(NEVER);
  assert.deepEqual(l.shown, [pick, refused, pick, bred]);
});

// "Opened the preset as … It replaced Tine." waits behind a pick's undo, and
// three cuts follow (each an undo and a remark about the player's sounds).
// The trim, finding no plain remark, cut the one nearest the front: the
// preset's.
test("trim: a remark about the player's sounds waiting behind an undo isn't cut by the toasts said after it", (t) => {
  const l = setup(t);
  const pick = "Picked Glass Pad over Soft Wash.";
  l.say(pick, { undo: () => {}, replace: "vote" });
  const preset = "Opened the preset as First Bass. It replaced the lowest-rated sound it could: Tine.";
  l.say(preset, { bank: true });
  const cuts = ["Bell Jar", "Soft Wash", "Glass Rain"].map((n) => `Cut ${n}. It won’t be dealt again.`);
  for (const c of cuts) l.say(c, { undo: () => {}, bank: true });
  assert.deepEqual(l.waiting(), [preset, ...cuts]);
  assert.equal(l.stacks.get(pick), 4);
  l.wait(NEVER);
  assert.deepEqual(l.shown, [pick, preset, ...cuts]);
});

test("trim: past three refusals waiting it cuts the oldest refusal, never a remark about the player's sounds behind them", (t) => {
  const l = setup(t);
  const saved = "Saved Glass Pad. No generation will replace it (1 of 8 saved).";
  l.say(saved, { bank: true });
  // Each refusal pre-empts the one before, which waits right behind it, and
  // the remark about the player's sounds is pushed back behind them all.
  for (const r of ["refused 1", "refused 2", "refused 3"]) l.say(r, { urgent: true });
  assert.deepEqual(l.waiting(), ["refused 2", "refused 1", saved]);
  // A fourth refusal makes four waiting before it takes the screen: the trim
  // has only refusals to cut among them, and takes the one at the back.
  l.say("refused 4", { urgent: true });
  assert.deepEqual(l.waiting(), ["refused 3", "refused 2", saved]);
  l.wait(NEVER);
  assert.deepEqual(l.shown, [saved, "refused 1", "refused 2", "refused 3", "refused 4", "refused 3", "refused 2", saved]);
});
