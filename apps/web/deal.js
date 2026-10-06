// EVOLVE's dealing rules: which answer to a deal goes up, which waits as the
// next pair, which is dealt again and which is thrown away. main.js keeps the
// wiring (the requests, the cards, the undo window) and hands the dealer what
// it reads of the table and what it does with a pair (`createDealer`); the
// rules are here alone, so tests/deal.test.mjs drives them with a scripted
// engine, no page, in milliseconds.
//
// The next pair, dealt ahead. A pick used to put the table away and wait for
// the engine to deal: ~30 ms on a quiet engine, but a whole seed's walk (up
// to about 20 s) while a generation ran, and the new pair's sounds then
// rendered after it. So while a pair is on the table the next one is dealt
// and both its sounds fetched, and a pick or "another pair" swaps it in at
// once; the one after is dealt in the background. The pair is chosen before
// the pick is known, which is what already happened (the pick is held in its
// undo window, and the deal used to go out before it was logged): under the
// default rule every pair is dealt at random, and under bald/thompson it is
// chosen against the current posterior, which the model already lets lag its
// log by up to six picks.
//
// Asked for only once the table's own two sounds are here, so the pair in
// front of the player never waits behind the next one's. The next pair's
// sounds are fetched in the background (`bg`): the worker renders them
// behind every gesture waiting on it.
//
// The worker answers deals in the order they were asked for, and `dealt`
// takes each answer on its own terms rather than by which request asked for
// it: the first to land while the table waits goes up, and any other waits as
// the next pair. A pick made while a deal ahead is still out (a generation
// holds deals behind the seed being bred) waits for that deal rather than
// asking for a second. It used to ask for one, keep the first answer as "the
// next" because a pick's deal was expected, and put the second up: the table
// ran P, R, Q, with the cards dimmed through a deal and two renders nobody
// needed, and when an answer landed changed what a seeded session showed
// (ADR-001). Now the pairs go up in the order the engine dealt them.
//
// An empty answer. The engine deals nothing when fewer than two sounds in
// the pool may be dealt: every other one is cut (each deal excludes the cuts).
// A table waiting on that answer has nothing to put up. It used to put up
// nothing as if it were a pair: the cards' buttons came back live over the
// pair just put away, with no reason and nothing they could do (#195). Now
// the table stays off and says why (`nothing`), and deals again by itself
// when a sound may have come back (`soundsBack`): a cut taken back, or the
// pool changed.
//
// A taken-back pick. ⌘Z puts the pick's pair (P) back on the table, and the
// pair that went up in its place (Q) waits as the next, since the player has
// seen it. The deal behind Q (R) used to be thrown away: overwritten if it
// had landed, dropped if it landed later. Whether R had been asked for by ⌘Z
// depends on how long Q's sounds took to arrive, since the pair after the
// table's is dealt only once the table's sounds are here. When it had, the
// pair after Q was a fresh deal, the one after R in the engine's stream; when
// it had not, it was R. The same seed and the same gestures showed a
// different pair after Q (#211, ADR-001). Now R is kept as the pair after
// next (`retract`, `dealt`), and offered as the next pair when Q goes up
// (`placed`), refused or kept on the same terms as a deal landing then, with
// the refusals counted behind Q carried over. When the player picks P again,
// the deals asked for and the pairs that go up are the same in either order,
// given the same answers from the engine.
//
// Which pick a deal is judged against. A deal is refused when it is the pair
// of the pick held in its undo window, which the player has just answered.
// Which pick was held used to be read when the answer was judged,
// and that moment moves with render timing: ↻ after ⌘Z holds no pick, so an
// R that is P itself was refused in one order (it landed while the pick of P
// was held) and went up after Q in the other (it landed after ⌘Z, or was
// asked for only once Q went up again). Now every deal is judged against the
// pick held when the pair it was dealt behind went up (`behind`): the deals
// behind Q, the one asked for ahead and the one asked for when Q is put
// away, against the pick that put Q up (P). Q keeps that pick through a
// take-back (`kept`), and a deal asked for again in place of one refused
// keeps the pick of the one it replaces. So ↻ after ⌘Z, like a pick, shows
// the same pairs in every order (#211), and a deal that waits for the fill
// (worker.js `dealsWaiting`) is judged as it would have been at once.
//
// A deal holding a cut sound is dealt again however many times it takes,
// waiting as the next pair or not, and is not counted as a refusal: the
// engine itself deals again when it draws a sound cut before the deal was
// asked for, so a cut made before the deal and one made while it is out end
// on the same pair (`Engine::deal_duel_scheduled`).
//
// A deal the engine could not run (an `engine_error` naming it) leaves a
// waiting table with nothing coming: it says so, and ↻ deals again
// (`failed`, `retry`). It used to turn the table back on over no pair.

/** How many answers in a row the dealer refuses before it stops dealing
 *  again: with the table waiting, the answer after these goes up anyway (a
 *  pool too small to deal anything else must not leave the cards dimmed for
 *  good), and with a pair on the table no further pair is dealt ahead until
 *  the table changes. */
export const RETRIES = 3;

/** The same two sounds, in either order (the sides are shuffled when a pair
 *  goes up). */
export function samePair(p, q) {
  return !!p && !!q && q.length === 2 && p.includes(q[0]) && p.includes(q[1]);
}

/** A side of the pair was cut (its undo window included). A deal excludes
 *  the cuts made before it was asked for; this checks the ones made since. */
export function holdsCut(pair, cut) {
  return pair.some((id) => cut.has(id));
}

/** May `pair` go up, or wait as the next pair? Not when a side was cut
 *  since (`cut`) or left the pool (`gone`), nor when it is the pair on the
 *  table, the pair just put away (`left`) or the pick held in its undo
 *  window (`held`). */
export function usable(pair, { table = null, left = null, held = null, cut, gone }) {
  if (!pair || pair.length !== 2) return false;
  // A patch cut since is never dealt.
  if (holdsCut(pair, cut)) return false;
  // Replaced since (a generation, a preset load or an import can replace a
  // patch while the pair waits): main records each id that leaves the pool.
  // The bank's rows can lag the pool while it fills, so a missing row is not
  // taken for a replaced patch.
  if (pair.some((id) => gone.has(id))) return false;
  // Not the question on the table, the one just put away, or the one being
  // held in an undo window.
  return !samePair(table, pair) && !samePair(left, pair) && !samePair(held, pair);
}

/** The dealer: the pair dealt ahead and the deals out, and what each answer
 *  does. `io` is what it reads and does through main.js:
 *
 *  - `table()`: the pair on the table, or null while the table waits;
 *  - `held()`: the pair of the pick held in its undo window, or null;
 *  - `cut`, `gone`: the ids cut (undo windows included) and the ids that
 *    left the pool, as Sets main keeps;
 *  - `heard(id)`: the sound is here (rendered, or failed for good);
 *  - `ask(ahead)`: post a deal (`ahead` for the pair after the table's);
 *  - `place(pair, meta)`: put the pair on the table (main's `placePair`, the
 *    one place a pair goes up, which calls `placed` back);
 *  - `fetch(pair)`: fetch the pair's sounds in the background;
 *  - `nothing()`: the table's deal came back empty, so the table has no pair
 *    to put up and stays off until a sound comes back. */
export function createDealer(io) {
  let ahead = null; // {pair, meta, fetched}: dealt, sounds fetched or on their way
  let after = null; // {pair, meta, fetched}: dealt behind the pair a take-back made the next
  let kept = null; // {pair, retries}: that pair, and the refusals counted behind it
  let out = 0; // deals asked for and not yet answered
  let retries = 0; // answers refused since the table last changed
  let left = null; // the pair ↻ or a lost side just put away, until the next goes up
  let empty = false; // the table's last answer was empty: nothing to deal
  let stuck = false; // the table's last deal failed: ↻ deals again
  // The pick held when the pair on the table went up: what the deals behind
  // it are judged against (the header says why).
  let behind = null;
  const asked = []; // for each deal out, oldest first: the pick it is judged against

  const may = (pair, held) => usable(pair, { table: io.table(), left, held, cut: io.cut, gone: io.gone });

  /** A deal for the table, which waits on it; judged against `held`. */
  function deal(held = behind) {
    out += 1;
    asked.push(held);
    io.ask(false);
  }

  /** The pair after the table's, once the table's own two sounds are here,
   *  unless one waits or a deal is out; judged against `held`. */
  function dealAhead(held = behind) {
    const table = io.table();
    if (ahead || out || !table) return;
    if (!table.every(io.heard)) return;
    out += 1;
    asked.push(held);
    io.ask(true);
  }

  /** A deal's answer, or its failure, is in: the pick it is judged against. */
  function answered() {
    out = Math.max(0, out - 1);
    return asked.length ? asked.shift() : behind;
  }

  /** Nothing to deal: the table waits on no deal and puts nothing up. */
  function nothing() {
    left = null;
    retries = 0;
    empty = true;
    stuck = false;
    io.nothing();
  }

  /** An answer offered as the next pair: it waits, its sounds fetched, when
   *  it may; otherwise it is dealt again (a few times, or for a cut sound
   *  as many as it takes), judged against the same pick. */
  function offer(a) {
    if (!may(a.pair, a.held)) {
      // A side cut while it was out: dealt again, not counted (the header).
      if (holdsCut(a.pair, io.cut)) return void dealAhead(a.held);
      // The engine may deal the very pair on the table again (a small pool
      // early in a session does, often): ask again, a few times.
      if (retries++ < RETRIES) dealAhead(a.held);
      return;
    }
    ahead = a;
    if (!a.fetched) io.fetch(a.pair);
    a.fetched = true;
  }

  /** A deal's answer. With the table waiting it goes up; with a pair on the
   *  table it waits as the next one, its sounds fetched, or, when a
   *  take-back already made a pair the next, after that one. */
  function dealt(pair, meta) {
    const held = answered();
    if (!io.table()) {
      // Empty: with another deal still out the table waits for that one;
      // with none, there is nothing to deal.
      if (!pair) {
        if (!out) nothing();
        return;
      }
      if (may(pair, held)) return void io.place(pair, meta);
      // Dealt before a cut, or the pair just put away: the next answer is
      // already on its way, or one more is asked for.
      if (out) return;
      // A pair holding a cut sound is never put up, however many tries it
      // takes: it is dealt again. That ends, because every deal excludes the
      // cuts made before it was asked for: only a cut made while a deal is
      // out brings its answer back here, once per cut. It used to go up after
      // the third try like any other refusal.
      if (holdsCut(pair, io.cut)) return void deal(held);
      // A pool too small to deal anything else puts it up after a few tries.
      if (retries++ < RETRIES) return void deal(held);
      return void io.place(pair, meta);
    }
    // No pair: the engine dealt nothing (fewer than two sounds it may deal),
    // so nothing new waits, take-back or not.
    if (!pair) return;
    // A pair already waiting: the one a taken-back pick had put up, back as
    // the next (`retract`), and this answer is the deal asked for behind it.
    // It is kept as the pair after next, as it is, and judged when that
    // pair goes up (`placed`): judged now, it would be against the pair the
    // take-back put back on the table, not the one it was dealt behind.
    if (ahead) {
      if (!after) after = { pair, meta, fetched: false, held };
      return;
    }
    offer({ pair, meta, fetched: false, held });
  }

  /** Swap the pair dealt ahead onto the table (or, when it may no longer be
   *  dealt, the pair after it); false when there is none that may. Judged
   *  as the gesture finds the table: the pair put away is `left`. */
  function take() {
    while (ahead || after) {
      if (!ahead) [ahead, after] = [after, null];
      const a = ahead;
      ahead = null;
      if (may(a.pair, io.held())) {
        io.place(a.pair, a.meta);
        return true;
      }
    }
    return false;
  }

  /** A pair that may no longer be dealt (cut, or replaced) is dropped, and
   *  the pair after it, if a take-back kept one, is offered in its place;
   *  with none, the next is asked for, judged against the same pick. */
  function check() {
    let dropped = null;
    if (ahead && !may(ahead.pair, ahead.held)) {
      dropped = ahead;
      ahead = null;
    }
    if (!ahead && after) {
      const a = after;
      after = null;
      return void offer(a);
    }
    if (dropped) dealAhead(dropped.held);
  }

  return {
    deal,
    dealAhead,
    dealt,
    check,
    /** A deal the engine could not run (an `engine_error` naming it): true
     *  when the table waits on nothing else, which then has no pair coming
     *  until ↻ deals again (`retry`). A deal ahead that failed leaves the
     *  table as it was: the next render or pair asks again. */
    failed() {
      answered();
      if (io.table() || out) return false;
      stuck = true;
      return true;
    },
    /** ↻ on a table whose deal failed: deal again (true), unless a pair or
     *  a deal has come since. */
    retry() {
      if (!stuck || out || io.table()) return false;
      stuck = false;
      deal();
      return true;
    },
    /** The pair on the table was put away (main has cleared it): a pick, ↻,
     *  or a side lost to a cut or the pool. The pair dealt ahead goes up at
     *  once when there is one (true); otherwise the table waits on a deal: a
     *  deal already out (one asked for ahead) is the next pair, and only with
     *  none out is one asked for. The pair put away (`prev`) is remembered
     *  until the next goes up, so neither it nor a deal of it goes straight
     *  back. */
    another(prev) {
      left = prev;
      retries = 0;
      if (take()) return true;
      if (!out) deal();
      return false;
    },
    /** `pair` went up (`placePair`): the pair waiting, if it is the one
     *  just put up, is no next pair; the pair a take-back kept behind it, if
     *  any, is offered as the next, with the refusals counted behind it
     *  before the take-back; otherwise the one after is dealt. */
    placed(pair) {
      left = null;
      empty = false;
      stuck = false;
      const back = kept && samePair(kept.pair, pair) ? kept : null;
      retries = back ? back.retries : 0;
      // The pick held as it went up, or, for the pair a take-back made the
      // next, the one held when it first went up.
      behind = back ? back.held : io.held();
      kept = null;
      check();
      // Behind a pair the dealer had given up on before a take-back (its
      // answers refused, three times over), nothing more is dealt ahead.
      if (retries <= RETRIES) dealAhead();
    },
    /** A taken-back pick put its pair back on the table (main has put it
     *  there). `displaced` is the pair that went up in its place, or null
     *  when the table was still waiting on a deal; `meta` is its deal's.
     *
     *  A pair went up: it waits as the next one, when it may (`usable`). The
     *  player has seen it, so it comes before any pair dealt behind it. The
     *  deal asked for behind it, if one was, is kept as the pair after next:
     *  the one that has landed here, and one still out when it lands
     *  (`dealt`). When the displaced pair goes up again, that deal is offered
     *  as the next (`placed`); when none was asked for, the pair after it is
     *  dealt then. When it may not wait (as when it is this same pair, put up
     *  again by a pool too small to deal another), nothing changes: a deal
     *  behind it that has landed stays the next pair, and one still out
     *  becomes it.
     *
     *  Nothing went up: the deal the table was waiting on lands with this
     *  pair on the table, so it becomes the next pair (`dealt`) rather than
     *  covering this one. A deal is asked for only when no pair waits and
     *  none is out. */
    retract(displaced, meta) {
      left = null;
      empty = false;
      stuck = false;
      if (displaced && may(displaced, io.held())) {
        after = ahead;
        kept = { pair: displaced, retries, held: behind };
        ahead = { pair: displaced, meta, fetched: true, held: null };
      }
      // The pair put back is on the table, with no pick held.
      behind = io.held();
      dealAhead();
    },
    /** A sound may have come back (a cut taken back, or the pool changed):
     *  a table with nothing to deal asks again, unless a deal is out. */
    soundsBack() {
      if (empty && !out && !io.table()) deal();
    },
    /** The table's last answer was empty, and none has gone up since. */
    get empty() {
      return empty;
    },
    /** The table's last deal failed, and none has gone up or been asked for
     *  since: ↻ deals again. */
    get stuck() {
      return stuck;
    },
    /** Deals asked for and not yet answered. */
    get out() {
      return out;
    },
    /** The pair waiting as the next one, or null. */
    get next() {
      return ahead ? ahead.pair : null;
    },
    /** The pair a take-back kept to come after the next, or null. */
    get afterNext() {
      return after ? after.pair : null;
    },
  };
}
