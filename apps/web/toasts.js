// The toast lane's queue: which toast is on screen, which wait, in what
// order, and which are cut. main.js's `note()` builds a toast's element and
// hands it here; where the lane sits on screen (rules 1 and 2, below) is
// main.js's `positionToastLane`. Pure: the DOM, the clock and the timers are
// handed in (`createToastLane`), so tests/toasts.test.mjs drives the lane with
// node:test's mock timers.
//
// Transient chrome used to stack upward from the bottom centre of the window,
// which is exactly where PICK A / PICK B live. The app's recovery affordance
// was covering the app's core preference-learning action — and every "TAKE IT
// OUT" toast landed on the one pair of buttons the whole instrument exists to
// collect. Three rules, and the first two are geometric so the collision
// cannot silently come back with the next feature:
//
//   1. ONE LANE, anchored bottom-right just above the keybar (see
//      `positionToastLane` for why there and not the rack's top-right).
//   2. RESERVED RECTS: whatever teaching strip is on screen — and every other
//      surface in LANE_STRIPS / LANE_COLUMNS — is measured and the lane is
//      pushed clear of it, whatever the window size.
//   3. ONE VISIBLE TOAST, with a stacking counter. Three toasts saying
//      different things at once is not three times the information.
//
// The queue matters for more than tidiness: a toast's time-to-live starts when
// it becomes *visible*, so an undo that waits its turn still gets its full
// seven seconds rather than expiring behind someone else's confirmation.
//
// Rule 4 arrived later, from the acceptance walkthrough: a REFUSAL IS NOT A
// REMARK. Everything above treats the lane as first-in-first-out, which is
// right for confirmations and wrong for the one message class that answers a
// gesture the player has already made and still believes in. Measured on the
// depth ceiling: the refusal surfaced eight seconds after the edit it was
// about, and under a burst it never surfaced at all — it carries no action, so
// the staleness drop and the backlog trim both cut exactly it. So `urgent`
// jumps the queue, displaces what is on screen, and is exempt from both cuts.
//
// Rule 5, from the films: A LATER WORD ON THE SAME THING SUPERSEDES THE
// EARLIER ONE. First-in-first-out is right for different news and wrong for
// news about one thing that has moved on. Voting every two seconds, the lane
// still named the first pick six seconds after the third, beside a ⌘Z that
// would undo the third; the warm start's result ("18 preferences learned")
// waited out the "Loading those in…" it answered while PICKS already read 18.
// A toast given `replace: key` takes the place of any earlier toast with the
// same key (but one about the player's sounds: rule 6), on screen or queued:
// on screen it takes the floor at once with its own full window, queued it
// takes the earlier one's place in line.
//
// Rule 6, from #129 and #183: A CHANGE TO THE PLAYER'S SOUNDS IS NOT
// NARRATION. The stale drop is right for a remark a newer state has
// overtaken, and wrong for one that says a sound joined or left the pool, or
// was saved or released: that stays true however long it waits, and for a
// sound that was replaced the toast is the only place the player hears it (it
// has no row left). On a fast machine "Opened the preset as … It replaced …
// Tine" was said behind three plain remarks, reached the head of the queue
// 10.5 s later, and was dropped. A toast given `bank: true` is never dropped
// for its age, and no other rule of the queue takes it off before it has had
// its window either (its caller still can, when what it says stops being
// true: `retire`, `drop`). Each of these did, and Woodblock or Tine went
// unnamed:
//
//   - Rule 5 passes it over: a later word on the same key no longer takes
//     this toast's place (a second keep's reveal took "Kept … It replaced
//     Woodblock"), and with no other word on its key to replace, it waits
//     its turn at the back. This toast still takes the place of an earlier
//     word on its own key that is not about the player's sounds (the warm
//     start's result, a keep after its reveal).
//   - A refusal on its key interrupts it as rule 4 interrupts anything, rather
//     than taking it down ("⚡ bred … It replaced Tine" lost its OPEN IT to
//     "⚡ didn't start"): it comes back behind the refusal with a fresh
//     window, unless it was already fading.
//   - The backlog's trim never cuts it, and it is not counted against
//     MAX_TOASTS: a preset's toast behind an undo was cut by the three cuts
//     said after it. A burst of these each has its turn, and the cap still
//     holds for the toasts around them.

/** How many toasts may wait behind the one on screen, not counting those
 *  about the player's sounds (`bank`, rule 6), which are never cut. */
export const MAX_TOASTS = 3;
/** One window, shared by the toast and by whatever it is holding back. */
export const UNDO_WINDOW_MS = 7000;
/** How long a toast without an undo stays on screen. */
export const TOAST_MS = 4200;
/** A queued remark about a patch state that has moved on is worse than
 *  silence. An undo is exempt: being still actionable is its whole point.
 *  So is a refusal — an unheard "that did not happen" is the one omission
 *  that leaves the player believing something false. And so is a change to
 *  the player's sounds (`bank`, rule 6), which does not go out of date. */
export const TOAST_STALE_MS = 9000;

/** The lane. `view` is the DOM side, each call given a toast's element:
 *  `show(el)` puts it on screen, `remove(el)` takes it off (or out of
 *  wherever it is), `fade(el)` retires its button and starts its fade, and
 *  `stack(el, n)` says how many wait behind it. `now` is the clock, `fadeMs()`
 *  the fade's length; `setTimeout` and `clearTimeout` default to the page's
 *  own, looked up when called. */
export function createToastLane({
  view,
  now = () => Date.now(),
  setTimeout: later = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: cancel = (id) => globalThis.clearTimeout(id),
  fadeMs = () => 0,
}) {
  const queue = [];
  let live = null;

  /** Put a toast in the lane; `opts` as `note()`'s (`undo`, `urgent`,
   *  `replace`, `bank`). Returns its entry, for `dismiss`. */
  function add(el, opts = {}) {
    const entry = { el, opts, born: now(), timer: null, out: false };
    if (opts.urgent) {
      // Rule 5 holds for refusals too: the same refusal said again (⌘Z pressed
      // twice where there is nothing to undo) takes the earlier one's place
      // rather than queueing a second copy behind it.
      if (opts.replace) dropReplaced(opts.replace);
      preempt(entry);
    } else if (!(opts.replace && supersede(entry))) queue.push(entry);
    trim();
    pump();
    return entry;
  }

  /** Rule 5: put `entry` where the earlier word with its `replace` key is.
   *  False when there is none, and the caller queues it as usual. A toast
   *  about the player's sounds is not an earlier word here (rule 6): it keeps
   *  its place, and `entry` waits behind it. */
  function supersede(entry) {
    const key = entry.opts.replace;
    const same = (t) => t.opts.replace === key && !t.opts.bank;
    const held = live && same(live) ? live : null;
    const at = queue.findIndex(same);
    // Every earlier word on it goes; only the newest is ever said.
    for (let i = queue.length - 1; i >= 0; i--) {
      if (!same(queue[i])) continue;
      view.remove(queue[i].el);
      queue.splice(i, 1);
    }
    if (held) {
      // On screen, even mid-fade: the floor passes straight to the newer word.
      // The old toast's timer goes with it, so it cannot dismiss its successor.
      cancel(held.timer);
      view.remove(held.el);
      live = null;
      queue.unshift(entry);
      return true;
    }
    if (at < 0) return false;
    queue.splice(at, 0, entry);
    return true;
  }

  /** Every toast with this `replace` key goes, on screen or queued, with no
   *  successor put in its place (the caller is about to say it again). Not
   *  one about the player's sounds (rule 6): on screen, the refusal pre-empts
   *  it as it does any toast, and it comes back behind it. */
  function dropReplaced(key) {
    const same = (t) => t.opts.replace === key && !t.opts.bank;
    for (let i = queue.length - 1; i >= 0; i--) {
      if (!same(queue[i])) continue;
      view.remove(queue[i].el);
      queue.splice(i, 1);
    }
    if (live && same(live)) {
      cancel(live.timer);
      view.remove(live.el);
      live = null;
    }
  }

  /** Take a toast off the lane now, whether it is on screen or still waiting —
   *  for a toast whose claim stopped being true before its window ran out. */
  function drop(el) {
    if (!el) return;
    if (live && live.el === el) return dismiss(live, true);
    const i = queue.findIndex((t) => t.el === el);
    if (i >= 0) queue.splice(i, 1);
    view.remove(el);
    renderStack();
  }

  /** Take a toast down because what it says stopped being true — the edit it
   *  confirmed was undone. Wherever it is: on screen, or still waiting its
   *  turn in the lane, where it must not surface later as news. */
  function retire(el) {
    if (!el) return;
    const t = live && live.el === el ? live : queue.find((x) => x.el === el);
    if (t) dismiss(t);
    else view.remove(el);
  }

  /** Put a refusal at the head of the lane and take the floor for it. Whatever
   *  was on screen is *interrupted*, not spent: it goes back into the queue
   *  right behind the refusal with its undo button still live, and its window
   *  restarts when it is visible again — the same rule every queued toast
   *  already gets. Cutting it instead would answer one silent failure by
   *  creating another. */
  function preempt(entry) {
    queue.unshift(entry);
    const held = live;
    if (!held) return;
    cancel(held.timer);
    held.timer = null;
    view.remove(held.el);
    live = null;
    // A toast already fading out had its whole window: it is spent, not
    // interrupted, so it is not brought back.
    if (held.out) return;
    queue.splice(1, 0, held);
  }

  /** Keep the backlog shallow, and spend the cut on remarks rather than on
   *  anything still carrying an action — or on a refusal, which is the one
   *  thing in the lane that cannot be said later instead. A change to the
   *  player's sounds (rule 6) is neither cut nor counted. */
  function trim() {
    const counted = (t) => !t.opts.bank;
    let n = queue.filter(counted).length;
    while (n > MAX_TOASTS) {
      let i = queue.findIndex((t) => counted(t) && !t.opts.undo && !t.opts.urgent);
      if (i < 0) i = queue.findIndex((t) => counted(t) && !t.opts.urgent);
      // Last resort takes from the back, never the front: the head is where the
      // refusal that just pre-empted is sitting. The back may be a toast about
      // the player's sounds, pushed there by the refusals: it is passed over.
      if (i < 0) {
        i = queue.length - 1;
        while (!counted(queue[i])) i--;
      }
      queue.splice(i, 1);
      n--;
    }
    renderStack();
  }

  function pump() {
    if (live) return;
    while (queue.length && !queue[0].opts.undo && !queue[0].opts.urgent && !queue[0].opts.bank &&
           now() - queue[0].born > TOAST_STALE_MS) {
      queue.shift();
    }
    const t = queue.shift();
    if (!t) return;
    live = t;
    view.show(t.el);
    renderStack();
    // Must not outlive the action it can still cancel (see the cut handler).
    t.timer = later(() => dismiss(t), t.opts.undo ? UNDO_WINDOW_MS : TOAST_MS);
  }

  function renderStack() {
    if (live) view.stack(live.el, queue.length);
  }

  /** The toast's window has closed, or its claim has: off the lane, at once
   *  (`immediate`) or after its fade. */
  function dismiss(t, immediate) {
    if (live !== t) {
      // Never made it to the lane: drop it out of the queue rather than leaving
      // a dead entry to be shown after its moment has passed. And if it is on
      // screen anyway, it goes: a toast is never left behind with no timer.
      const i = queue.indexOf(t);
      if (i >= 0) queue.splice(i, 1);
      view.remove(t.el);
      return;
    }
    cancel(t.timer);
    // Retire the *action* on the window boundary, not when the animation
    // finishes — the fade (`--d-move`) kept a clickable undo on screen past the
    // moment its commit had already fired.
    view.fade(t.el);
    t.out = true;
    // The fade can be overtaken: a refusal may pre-empt this toast mid-fade and
    // take the lane. Then this toast no longer owns the live slot, and clearing
    // it would orphan the refusal on screen for the rest of the session.
    const gone = () => {
      view.remove(t.el);
      if (live !== t) return;
      live = null;
      pump();
    };
    // Removed when the fade has played, and at once under reduced motion,
    // where it is 0.
    if (immediate) gone();
    else later(gone, fadeMs());
  }

  /** What the lane holds: the element on screen, and those waiting, in
   *  order. */
  function peek() {
    return { live: live ? live.el : null, queued: queue.map((t) => t.el) };
  }

  return { add, dismiss, drop, retire, peek };
}
