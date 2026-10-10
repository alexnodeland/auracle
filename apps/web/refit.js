// A refit landing (#300): what main does with the worker's `fitted`.
//
// The fit runs on the farm while the player goes on, so it lands whenever it
// lands. `landRefit` is the rule, with main's side handed in (`host`), so it
// is unit-tested (tests/refit.test.mjs):
//
// - a fit the engine refused to install (`refused`: the log it fitted was
//   replaced while it ran, as a taste file replaces it) taught nothing. The
//   meter says nothing, and the fit the replacement asked for is still on its
//   way: `fitting` stays as it is while one is (the lamp's count says so);
// - a fit installed: the meter says it learned, the status and everything
//   that asks the engine again under the new posterior go at once (the
//   bench's guess, PATCH's and EVOLVE's guesses, PERFORM's leans), and only
//   the views and what is drawn from them (the bank's order, the maps,
//   LEARNING's bars) wait for the hand (hand.js, under the key `views`,
//   which a newer views post drops: it is drawn in their place).

/** Land the worker's `fitted` reply `m`. Returns whether it taught anything. */
export function landRefit(m, host) {
  // Every reply answers one request the lamp counted.
  host.lampOff();
  if (m.refused) {
    host.stillFitting();
    host.status(m.status);
    return false;
  }
  host.learned();
  host.status(m.status);
  host.hand.after("views", () => host.views(m.views));
  host.posteriorChanged(m);
  return true;
}
