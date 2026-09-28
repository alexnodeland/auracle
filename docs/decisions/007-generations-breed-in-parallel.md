---
title: "A generation breeds its walks in parallel, absorbed in job order"
number: 7
status: accepted
author: Claude Code
created: 2026-09-28
originating_proposal: 1
superseded_by: null
---

# ADR-007: A generation breeds its walks in parallel, absorbed in job order

## Status

Accepted

## Context

EVOLVE POOL ran a generation's MH walks one after another in the engine
worker; each step renders its proposal, so a generation took about 100 s
natively and about 3 minutes in the browser. RFC-001 showed a walk is a
read-only function of the engine and only admission mutates the pool.

## Decision

A generation is split into walk jobs (seed, locks, steps, a per-walk RNG seed
derived from one draw of the `refine` stream) and a shared per-generation
context (biased prior, posterior, standardizer, phrase, β, keep rule). Jobs
run on the render farm's workers through a pure `run_walk`; the engine absorbs
results strictly in job order. The serial path runs the same jobs in the
engine worker when no farm is available.

## Options Considered

### Option 1: Fewer or shorter walks

Faster and measurably worse search (`make budget-ab`).

### Option 2: Parallel inside one walk

MH is sequential; one farm round trip per step is slower than whole walks.

### Option 3: Whole walks in parallel, ordered absorption (chosen)

Speed-up close to the number of workers, with results independent of timing.

## Consequences

### Positive

- A generation in roughly the time of its slowest walk.
- Parallel and serial paths produce the same pool for the same seed.

### Negative

- Seeded generations change once (per-walk RNGs).
- The posterior crosses to each worker once per generation; its size must be
  measured and bounded.

## References

- [RFC-001](../proposals/001-evolve-pool-parallel-walks.md),
  [Plan-001](../plans/001-evolve-pool-parallel-walks.md),
  [ADR-001](001-one-random-stream-per-consumer.md)
