# auracle-session: the engine every frontend drives

The two loops: a fast silent patch loop (fill, refine) and a slow human taste
loop (observe, refit). Rules shared by all crates are in
[`../AGENTS.md`](../AGENTS.md); the design is in
[`docs/architecture/system.md`](../../docs/architecture/system.md).

## Where things are

| File | Holds |
| --- | --- |
| `engine.rs` | `Engine`: pool, fills, duel choice (`next_duel_full`), `fit_posterior`, refinement (`refine`, `refine_seed`, `refine_from`), PERFORM's `offer`/`drift`, persistence |
| `farm.rs` | The indexed draw stream the render farm fills from, so the pool the farm builds equals the serial one |
| `perform.rs` | PERFORM: named controls wired through the patch's Jacobian, verification, grafts |
| `map.rs` | The TASTE map: 2D embedding with a pinned orientation across refits |
| `calib.rs` | Prequential calibration: forecasts scored on random (check) duels |
| `naming.rs` | Musical names for patches and styles, read off φ |
| `surrogate.rs` | The taste as a fugue-evo fitness |
| `migrate.rs` | Profiles written before raw-φ logging |

## Rules

- **Take an `Rng`, never own a shared one.** Each caller passes the stream
  that belongs to its consumer
  ([ADR-001](../../docs/decisions/001-one-random-stream-per-consumer.md)).
- **Random pairs are the calibration sample.** Under the default rule every
  duel is dealt at random, and the method says `"random"`. Only a choosing rule
  (BALD, Thompson) has scheduled `"check"` probes. TRUST's honesty depends on
  this; do not let the model choose what it is scored on.
- **The map never mirrors.** Axis signs are pinned to the last drawn map and
  saved with the session.
- **Evolution samples, it does not climb.** Some children land below their
  parent on purpose; the app labels them "exploring".
- **A refit keeps style identities** by aligning to the previous fit's lenses.
  Anything keyed by lens index (names, colours, shares) relies on it.
- **Session state is persisted and migrated.** A new field needs a default for
  old profiles.

## Tests and measurements

`cargo test -p auracle-session --profile test-fast`. `make search-check`,
`make climb` and `make islands` measure the search; the examples in
`examples/` measure PERFORM (`perform_wiring`, `reach_census`) and the loops.
