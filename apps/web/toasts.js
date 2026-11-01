// The toast lane's queue: which toast is on screen, which wait, in what
// order, and which are cut; and where the lane stands (`placeLane`, rule 2).
// main.js's `note()` builds a toast's element and hands it here, and its
// `positionToastLane` measures the page and moves the lane to the spot
// `placeLane` chose. Pure: the DOM, the clock and the timers are handed in
// (`createToastLane`), and so are the rects (`placeLane`), so
// tests/toasts.test.mjs drives the lane with node:test's mock timers.
//
// Transient chrome used to stack upward from the bottom centre of the window,
// which is exactly where PICK A / PICK B live. The app's recovery affordance
// was covering the app's core preference-learning action — and every "TAKE IT
// OUT" toast landed on the one pair of buttons the whole instrument exists to
// collect. Three rules, and the first two are geometric so the collision
// cannot silently come back with the next feature:
//
//   1. ONE LANE, its corner the bottom right of the stage, just above the
//      keybar (see `positionToastLane` for why there and not the rack's
//      top-right); on a phone held upright, a banner as wide as the screen.
//   2. RESERVED RECTS: every control on screen in the level (and its
//      heading, its teaching strips and the panels in LANE_STRIPS /
//      LANE_COLUMNS) is measured, and the lane stands in the free spot
//      nearest its corner (`placeLane`), whatever the window size. It used
//      to step over a list of strips by hand, and a level's footer missing
//      from the list (EVOLVE's, #517) was covered after every pick.
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
//
// Rule 7, from #305: A RECEIPT WITH A LIVE TAKE-BACK IS NOT A REMARK. A pick's
// "Picked X over Y." carries the only button that takes the pick back, and its
// window runs from the pick, not from when the toast is shown: the pick is
// committed UNDO_WINDOW_MS after it was made, wherever its toast is. Behind a
// plain remark it waited 4.2 to 7 s, and reached the screen with its window
// closed, a receipt for a pick that could no longer be taken back. A toast
// given `takeBack: true` (its undo's window started when it was said) goes
// ahead of every plain remark waiting, and, with nothing but plain remarks
// waiting, interrupts one on screen, which comes back behind it with a fresh
// window (and a fresh age, so it is not dropped as stale for having been
// interrupted) as it does behind a refusal. It waits behind every refusal,
// undo and toast about the player's sounds (rule 6) in the queue, and never
// interrupts one; if its window closes while it waits it is dropped, never
// said late; one about the player's sounds is still said (rule 6), its
// button retired by its caller. On screen it stays until its window closes,
// and at least as long as a remark.

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
   *  `replace`, `bank`, `takeBack`). Returns its entry, for `dismiss`. */
  function add(el, opts = {}) {
    // `born`: when it was said, which a take-back's window runs from (rule
    // 7); `queued`: when it last joined the queue, which its staleness is
    // judged from, so a toast put back behind an interruption has its fresh
    // window there too.
    const t0 = now();
    const entry = { el, opts, born: t0, queued: t0, timer: null, out: false };
    if (opts.urgent) {
      // Rule 5 holds for refusals too: the same refusal said again (⌘Z pressed
      // twice where there is nothing to undo) takes the earlier one's place
      // rather than queueing a second copy behind it.
      if (opts.replace) dropReplaced(opts.replace);
      preempt(entry);
    } else if (opts.replace && supersede(entry)) {
      // In the earlier word's place.
    } else if (opts.takeBack) ahead(entry);
    else queue.push(entry);
    trim();
    pump();
    return entry;
  }

  /** A plain remark: no button, no refusal, not about the player's sounds. */
  const plain = (t) => !t.opts.undo && !t.opts.urgent && !t.opts.bank;

  /** Rule 7: a receipt with a live take-back goes ahead of every plain
   *  remark, and behind every refusal, undo and toast about the player's
   *  sounds waiting; with none of those waiting it interrupts a plain remark
   *  on screen. */
  function ahead(entry) {
    let last = -1;
    queue.forEach((t, i) => { if (!plain(t)) last = i; });
    if (last < 0 && live && plain(live)) return preempt(entry);
    queue.splice(last + 1, 0, entry);
  }

  /** Rule 7: how long a receipt with a live take-back has left of its
   *  window. */
  const windowLeft = (t) => t.born + UNDO_WINDOW_MS - now();

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
    held.queued = now();
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
    // A plain remark gone stale, and a receipt whose take-back closed while
    // it waited (rule 7), are dropped, not said late.
    const late = (t) =>
      (plain(t) && now() - t.queued > TOAST_STALE_MS) ||
      (t.opts.takeBack && !t.opts.bank && !t.opts.urgent && windowLeft(t) <= 0);
    while (queue.length && late(queue[0])) view.remove(queue.shift().el);
    const t = queue.shift();
    if (!t) return;
    live = t;
    // Its counter first, so it is shown at the size it will stand at (the
    // lane is placed for that size, main.js `positionToastLane`).
    renderStack();
    view.show(t.el);
    // Must not outlive the action it can still cancel (see the cut handler).
    const ms = t.opts.takeBack
      ? Math.max(TOAST_MS, windowLeft(t))
      : t.opts.undo ? UNDO_WINDOW_MS : TOAST_MS;
    t.timer = later(() => dismiss(t), ms);
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

/** How far the lane keeps from a control it stands beside, in px. */
export const LANE_GAP = 8;
/** How far inside a picture's edge it keeps when it stands over one. */
export const LANE_INSET = 8;

/** Rule 2: where the lane stands. The free spot nearest its corner for a
 *  toast of `size` ({w, h}) inside `bounds`, as `{left, top}`, or null when
 *  there is none.
 *
 *  - `reserved`: rects it never overlaps (the level's controls, its heading,
 *    the teaching strips and panels). It keeps `gap` from those it stands
 *    beside.
 *  - `pictures`: what it may stand over (a well with the sound's face, the
 *    rack, the map), wholly inside one, `inset` from its edges, or clear of
 *    it: never across a picture's edge.
 *  - `prefer`: `"corner"`, the bottom right of `bounds`, nearest in its two
 *    distances added; or, for a banner as wide as `bounds` (a phone), only
 *    its height is chosen, nearest the `"bottom"` or the `"top"`.
 *
 *  Rects are `{left, top, right, bottom}` in the page's px. Each candidate
 *  lines the toast up against an edge of `bounds`, of a reserved rect (with
 *  `gap`) or of a picture (with `inset`), on each axis; the nearest that
 *  breaks no rule wins, and a tie goes to the lower, then to the righter. */
export function placeLane({ size, bounds, reserved = [], pictures = [], prefer = "corner", gap = LANE_GAP, inset = LANE_INSET }) {
  const { w, h } = size;
  if (!(w > 0 && h > 0)) return null;
  const banner = prefer !== "corner";
  const xs = banner ? [bounds.left] : [
    bounds.right - w,
    ...reserved.flatMap((r) => [r.left - gap - w, r.right + gap]),
    ...pictures.flatMap((p) => [p.right - inset - w, p.left + inset]),
  ];
  const ys = [
    bounds.bottom - h,
    bounds.top,
    ...reserved.flatMap((r) => [r.top - gap - h, r.bottom + gap]),
    ...pictures.flatMap((p) => [p.bottom - inset - h, p.top + inset]),
  ];
  // Half a pixel either way: a page's rects are fractional, and a toast
  // flush against a control (or a picture's inset) does not cover it.
  const E = 0.5;
  const within = (v, lo, hi) => v >= lo - E && v <= hi + E;
  const meets = (a, b) => a.left < b.right - E && a.right > b.left + E && a.top < b.bottom - E && a.bottom > b.top + E;
  // On one axis: inside the picture (`inset` from its edges) or across all of
  // it (a banner wider than a well) is fine; part-way across an edge is not.
  const fits = (a0, a1, b0, b1) => (a0 >= b0 + inset - E && a1 <= b1 - inset + E) || (a0 <= b0 + E && a1 >= b1 - E);
  const free = (t) =>
    !reserved.some((r) => meets(t, r)) &&
    !pictures.some((p) => meets(t, p) && !(fits(t.left, t.right, p.left, p.right) && fits(t.top, t.bottom, p.top, p.bottom)));
  const far = (t) =>
    prefer === "top" ? t.top - bounds.top
      : prefer === "bottom" ? bounds.bottom - t.bottom
        : (bounds.right - t.right) + (bounds.bottom - t.bottom);
  let best = null;
  for (const x of new Set(xs)) {
    if (!within(x, bounds.left, bounds.right - w)) continue;
    for (const y of new Set(ys)) {
      if (!within(y, bounds.top, bounds.bottom - h)) continue;
      const t = { left: x, top: y, right: x + w, bottom: y + h };
      if (!free(t)) continue;
      const d = far(t);
      if (!best || d < best.d - E || (Math.abs(d - best.d) <= E && (y > best.t.top + E || (Math.abs(y - best.t.top) <= E && x > best.t.left)))) best = { t, d };
    }
  }
  return best ? { left: best.t.left, top: best.t.top } : null;
}

/** Where a phone's banner may be narrowed to over a picture that has
 *  controls standing along its sides: the picture's inside, `inset` from its
 *  edges, and `gap` clear of each reserved rect that runs along a side, as
 *  `{left, right}`, or null when no control stands along either side. A
 *  control runs along a side when it lies within the picture's height, is at
 *  least half as tall, and reaches to within `inset` of that side: PATCH's
 *  edges (*n ›*, *‹ n*), shown while the patch is wider than the well, which
 *  a banner across the screen meets at every height but the top of the well
 *  (#519). Its `placeLane` is then given `bounds` from `left` to `right`. */
export function bannerColumn(picture, reserved = [], { gap = LANE_GAP, inset = LANE_INSET } = {}) {
  const E = 0.5;
  const p = picture;
  const mid = (p.left + p.right) / 2;
  let left = p.left + inset;
  let right = p.right - inset;
  let narrowed = false;
  for (const r of reserved) {
    if (r.top < p.top - E || r.bottom > p.bottom + E || r.bottom - r.top < (p.bottom - p.top) / 2) continue;
    if (r.right <= mid && r.left <= p.left + inset + E && r.right > p.left + E) {
      left = Math.max(left, r.right + gap);
      narrowed = true;
    } else if (r.left >= mid && r.right >= p.right - inset - E && r.left < p.right - E) {
      right = Math.min(right, r.left - gap);
      narrowed = true;
    }
  }
  return narrowed && right > left ? { left, right } : null;
}
