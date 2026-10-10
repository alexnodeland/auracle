// A background result never moves what is under the hand (ADR-025,
// decision 2): while the pointer is over a region a result would move (the
// bank, the map, LEARNING's bars), the result waits, and applies when the
// pointer leaves or after `HAND_REST_MS` of rest (no movement over it).
//
// `createHand` is the rule, with the clock and the timers handed in, so it is
// unit-tested (tests/hand.test.mjs). main.js tells it where the pointer is
// (`enter`, `move`, `leave` from each region's pointer events) and hands it
// what would move one (`after`): a refit's views land through it (#300).

/** How long the pointer rests over a region before a waiting result applies. */
export const HAND_REST_MS = 1000;

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
