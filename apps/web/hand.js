// A background result never moves what is under the hand (ADR-025,
// decision 2): while the pointer is over a region a result would move (the
// bank, the map, LEARNING's bars), the result waits, and applies when the
// pointer leaves or after `HAND_REST_MS` of rest (no movement over it).
//
// `createHand` is the rule, with the clock and the timers handed in, so it is
// unit-tested (tests/hand.test.mjs). main.js keeps one: it tells it where
// the pointer is (`enter`, `move`, `leave` from each region's pointer events)
// and hands it what would move one (`after`): a refit's views land through it
// (#300). taste.js keeps two of its own, told by `holdRegion` below: TASTE's
// map (the halos settle at once, the places wait) and LEARNING's bars (the
// lengths move at once, the order waits).
//
// The other half is the rule for a control rather than a region
// (`heldOrTouched`, `HAND_HOLD_MS`): a control held, however still, or
// touched or let go less than 1.5 s ago. perform.js imports it, and holds a
// measurement that would move PERFORM's controls or XY pad back on it (#304).

/** How long the pointer rests over a region before a waiting result applies. */
export const HAND_REST_MS = 1000;

/** How long after the last touch or release a control still counts as under
 *  the hand (decided on #304, 2026-10-06). */
export const HAND_HOLD_MS = 1500;

/** The other half of the rule, for a control rather than a region: a result
 *  that would move a control waits while one is held (`held`, however still)
 *  or was touched or let go less than `HAND_HOLD_MS` ago (`lastTouch` and
 *  `now` on one clock). PERFORM's controls and XY pad wait on it
 *  (`handsBusy` in perform.js). */
export function heldOrTouched(held, lastTouch, now) {
  return !!held || now - lastTouch < HAND_HOLD_MS;
}

export function createHand({ now, setTimer, clearTimer }) {
  let over = 0; // regions the pointer is over
  let movedAt = 0;
  let timer = null;
  const waiting = new Map(); // key -> what to run

  function run() {
    clearTimer(timer);
    timer = null;
    const due = [...waiting.values()];
    waiting.clear();
    for (const fn of due) fn();
  }

  // Fires `HAND_REST_MS` after the last movement, and again until the
  // pointer has rested that long.
  function arm() {
    clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      if (!waiting.size) return;
      if (!over || now() - movedAt >= HAND_REST_MS) run();
      else arm();
    }, Math.max(0, movedAt + HAND_REST_MS - now()));
  }

  return {
    /** The pointer came over a region. */
    enter() {
      over += 1;
      movedAt = now();
      if (waiting.size) arm();
    },
    /** It moved over one: the rest starts again. */
    move() {
      movedAt = now();
    },
    /** It left one: what waits applies once it is over none. */
    leave() {
      over = Math.max(0, over - 1);
      if (!over && waiting.size) run();
    },
    /** Is the pointer over a region now? */
    held: () => over > 0,
    /** Run `fn` now, or when the hand lets go. A later one under the same
     *  `key` takes the place of one still waiting. */
    after(key, fn) {
      if (!over) {
        waiting.delete(key);
        fn();
        return true;
      }
      waiting.set(key, fn);
      arm();
      return false;
    },
    /** Forget what waits under `key` (a newer result has made it stale). */
    drop(key) {
      waiting.delete(key);
    },
  };
}

/** One region a result waits on, told to `hand`: the mouse over `el`, a touch
 *  on it (from the finger going down until `HAND_REST_MS` after it lifts: a
 *  finger has no hover, so the rest is counted from the lift), and any
 *  `extra()` hold (a sound's card up on the map) make one hold, and the hand
 *  is told only as that hold starts and ends. `refresh()` says `extra()`
 *  changed; `moved()` says the player moved in it by other means (an arrow
 *  key's step), so the rest starts again; `release()` lets go when the region
 *  is hidden, where no pointerleave will come. */
export function holdRegion(el, hand, { extra = () => false, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let over = false, touched = false, touchT = null, held = false;
  function refresh() {
    const now = over || touched || extra();
    if (now === held) return;
    held = now;
    if (held) hand.enter();
    else hand.leave();
  }
  el.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "mouse") over = true;
    refresh();
  });
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    clearTimer(touchT);
    touched = true;
    refresh();
    hand.move();
  });
  el.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") over = true;
    if (held) hand.move();
    else refresh();
  });
  el.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") over = false;
    else if (touched) {
      hand.move();
      clearTimer(touchT);
      touchT = setTimer(() => { touched = false; refresh(); }, HAND_REST_MS);
    }
    refresh();
  });
  return {
    refresh,
    moved() {
      if (held) hand.move();
    },
    release() {
      clearTimer(touchT);
      over = false;
      touched = false;
      refresh();
    },
  };
}
