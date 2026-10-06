---
title: "Every consumer of randomness has its own stream"
number: 1
status: accepted
author: Claude Code
created: 2026-09-28
originating_proposal: null
superseded_by: null
---

# ADR-001: Every consumer of randomness has its own stream

## Status

Accepted

## Context

`WasmEngine` drew pool fills, duel pairs, posterior fits, evolution and
PERFORM's offers from one shared `StdRng`. PERFORM grows a spare offer in the
background, and when that finishes depends on the machine. Every draw after it
moved, so two identical seeded sessions dealt different duels and fitted
different posteriors: the same patch read 0.39 in one session and 0.43 in its
twin. Film rehearsals stopped predicting recordings, and a bug report with a
seed could not be replayed.

## Decision

Each consumer has its own stream, derived from the session seed with a
splitmix64 mix (`Streams` in `crates/auracle-wasm/src/lib.rs`): `fill`, `duel`,
`refine`, `perform`. A fit is seeded from the seed and the number of
observations it is fitted on, so the same evidence always fits the same
posterior. Engine functions take the caller's `Rng`; none owns a shared one.

## Options Considered

### Option 1: One stream, with background work made deterministic

Would require every background job to run at a fixed point in the sequence,
which defeats running it in the background.

### Option 2: One stream per consumer (chosen)

Timing in one consumer cannot move another. Costs one-off changes to every
seeded fixture.

### Option 3: Reseed per request from a counter

Deterministic, but couples every request type to a global counter that has
the same ordering problem.

## Consequences

### Positive

- A seeded session deals, fits and breeds the same way whatever the timing,
  given the same requests in the same order. Streams alone left two
  exceptions, both while the pool fills. A deal was drawn over however many
  sounds had joined, so a faster machine dealt other pairs; deals now keep
  to a fixed schedule and wait for its sounds (#211,
  [web-runtime.md](../architecture/web-runtime.md#deals-while-the-pool-fills)).
  A fit made then re-fits the standardizer over the pool as it stands, so a
  refit armed before the pool is full can still differ with the machine's
  speed.
- Rehearsals predict recordings; seeds in bug reports replay.

### Negative

- Every seeded pool changed once; two test fixtures were re-seeded.
- A new consumer must get its own stream, not borrow one
  (`a_consumer_draws_only_from_its_own_stream` pins the property).

## References

- Commit f929785; `crates/auracle-wasm/src/lib.rs` (`Streams`, `mix_seed`)
- [`../architecture/system.md`](../architecture/system.md#randomness)
