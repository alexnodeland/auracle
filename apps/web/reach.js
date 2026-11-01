// A finger's reach for a socket on PATCH's rack (#134): which socket a press
// or a drop beside the drawing means, if any. main.js measures the sockets
// on screen and hands them in; this decides.
//
// A socket is drawn a few px across at the rack's fitted zoom on a phone, far
// under a finger. A lit one (a destination: a module in hand, a cable being
// placed) reaches out for a press or a drop, and at rest an out ○, and a
// module's ⋯ and its lock over the rack around them, reach out for a tap,
// which picks the cable up, opens the menu or locks the module (main.js
// `tapReach`, #519); only when
// the finger is unambiguous: the nearest within `reach` px of its centre,
// and no other within 1.5 times that distance. Anything else (no socket
// near, two about as near) is no socket: the press or the drop does what
// it did before.

/** A press beside a lit socket reaches it from this far, in CSS px. */
export const REACH_PRESS_PX = 22;
/** A cable let go beside one, from this far. */
export const REACH_DROP_PX = 12;
/** The next lit socket must be this many times as far as the nearest. */
export const REACH_CLEAR = 1.5;

/** The candidate a point means, or null. `cands` are `{ x, y }` centres
 *  (with whatever else the caller carries); `reach` in the same px. */
export function socketMeant(cands, x, y, reach) {
  let best = null;
  let bd = Infinity;
  let second = Infinity;
  for (const c of cands) {
    const d = Math.hypot(x - c.x, y - c.y);
    if (d < bd) { second = bd; bd = d; best = c; } else if (d < second) second = d;
  }
  if (!best || bd > reach) return null;
  if (second <= REACH_CLEAR * bd) return null;
  return best;
}
