# auracle-session: the engine every frontend drives

The two loops: a fast silent patch loop (fill, refine) and a slow human taste
loop (observe, refit). Rules shared by all crates are in
[`../AGENTS.md`](../AGENTS.md); the design is in
[`docs/architecture/system.md`](../../docs/architecture/system.md).

## Where things are

| File | Holds |
| --- | --- |
| `engine.rs` | `Engine`: pool, fills, duel choice (`next_duel_full`), `fit_posterior`, refinement (`refine_jobs` → `refine_absorb` → `refine_finish`, and the serial `refine`, `refine_seed`, `refine_from`), PERFORM's `offer`/`drift`, persistence |
| `walk.rs` | A generation's walks as data: `WalkContext`, `WalkJob`, `WalkResult`, and `run_walk`, the walk as a pure function the farm runs ([ADR-007](../../docs/decisions/007-generations-breed-in-parallel.md)) |
| `job.rs` | PERFORM's offers, aimed offers and drifts as walks that can be paused: `PerformJob` (`step`, `finish_moved`), built by `Engine::offer_job`, `offer_aimed_job` and `drift_job`; `walk.rs`'s `WalkRun` is the locked walk's state between steps, and `walk_on` is it run to the end, so stepping and not stepping are one walk |
| `farm.rs` | The indexed draw stream the render farm fills from, so the pool the farm builds equals the serial one |
| `perform.rs` | PERFORM: named controls wired through the patch's Jacobian, verification, grafts, the aimed offer (`TiltedFitness`, `Engine::offer_toward`); the palette's eighteen directions (`PALETTE`, whose first six are the panel's `CONTROLS`), wired on request (`Engine::wire_named`); which way your taste leans along each, at the sound in hand, for the model view (`Engine::lean`, `Lean`) |
| `guess.rs` | The model's guess (Plan-005 task 9d): the module it guesses you'd add next. `guess_candidates` (the output's placements), `Engine::guess_plan` (the renders owed, in render order) and `Engine::guess_rank` (by the lower bound of the gain), pure; `GuessMemory`, the skips and the undo of a taken guess, per patch |
| `map.rs` | The TASTE map: 2D embedding with a pinned orientation across refits, and where a sound of your own sits on it (`TasteMap::own`, `Engine::own_on_map`) |
| `own.rs` | A sound of your own (Plan-005 task 11): a recording's measured coordinates in the session's space (`OwnSound`, saved by name, never audio), its nearest pool members and presets over those coordinates, and the generation bred toward it (`refine_toward_jobs`, `TowardFitness`, `OWN_GAMMA`) |
| `belief.rs` | The belief after each pick (`Engine::belief`): the ranked numbers and lenses under the reweighted posterior, the next generation's seeds (`next_seeds`) and what it may replace (`may_replace`), as the worker posts them |
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
- **A generation absorbs in job order and retires at its end.** Walks may run
  anywhere and finish in any order; `refine_absorb` takes them in job order
  only, and nothing leaves the pool until `refine_finish`, so a save made
  mid-generation protects. Each walk's RNG comes from its job, never from a
  generator another walk advanced.
- **Evolution samples, it does not climb.** Some children land below their
  parent on purpose; the app labels them "exploring".
- **A refit keeps style identities** by aligning to the previous fit's lenses.
  Anything keyed by lens index (names, colours, shares) relies on it.
- **Session state is persisted and migrated.** A new field needs a default for
  old profiles.
- **PERFORM's control words and the bank's sound names are copy.**
  `CONTROLS` in `perform.rs` and the words in `naming.rs` reach the screen,
  and `make dev-check` reads both against `www/brand/voice.md`
  ([`../AGENTS.md`](../AGENTS.md)). `CONTROLS` is also part of the shipped
  wirings' fingerprint: change a word there and run `make perform-wirings`.

## Tests and measurements

`cargo test -p auracle-session --profile test-fast`. Each module's tests are
in `<module>/tests.rs` beside it (engine's in `engine/tests.rs`: the pool,
duels, fits, generations, edits, the bank's names, the check cadence, clips
and takes); the fixtures several files share, `fast()`, `ground_truth()`,
`taught()`, `contrary_picks()`, `sweep_clip()` and `restore()`/`reload()`,
are in `src/testkit.rs`. The Makefile names the slow tier's tests by path
(`SLOW_TESTS`, `SEARCH_FLOOR`), so a test moved or renamed there moves in
the Makefile too.

The crate is held at 100% of lines and functions by its own fast tier
(`make coverage`; `crates/AGENTS.md` § Coverage). The slow tier's tests
check outcomes in σ over many presets and seeds; each mechanism they run
also has a fast test sized to its claim beside its module (PERFORM's on
one preset and a few steps, its wiring arithmetic on a Jacobian built by
hand). A generic function (a walk, a drift) is counted by its most-covered
instantiation, so one fitness type has to take every path of it.
`make search-check`,
`make climb` and `make islands` measure the search; the examples in
`examples/` measure PERFORM (`perform_wiring`, `reach_census`, and
`offer_census` behind `make offer-census`, which chose `AIM_GAMMA` and
`AIM_WALKS`) and the loops. `suggest_census` measures ways the model could
suggest the next module in PATCH, their cost and their quality against
synthetic listeners (`docs/notes/suggest-2026-10/`); `guess_cost` measures
what was built from it (renders and CPU per guess, and what it guesses, on
the census's patches after both warm starts).
