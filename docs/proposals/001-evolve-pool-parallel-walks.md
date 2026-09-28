---
title: "Breed a generation in seconds: walks in parallel on the render farm"
number: 1
status: draft
author: Claude Code
created: 2026-09-28
updated: 2026-09-28
supersedes: null
superseded_by: null
---

# RFC-001: Breed a generation in seconds: walks in parallel on the render farm

## Audience

Anyone changing `crates/auracle-session` (refinement), `crates/auracle-wasm`
(the refine bindings), `apps/web/worker.js` and `farm.js`.

## Context

EVOLVE POOL runs `refine_seeds` typed MH walks, one child per seed, in the
engine worker, one after another. Each step of a walk renders a proposal, so a
generation is render-bound: measured natively at about 100 s (about 36 fresh
renders per seed, 5–21 s per seed), and about 3 minutes in the browser under
load. The EVOLVE film cuts over the wait; a player cannot. Since the
responsiveness work, the worker answers the player between seeds, but the
generation itself is no faster.

The render farm already exists: stateless workers that render pool draws from
an indexed stream and hand them back to be folded in stream order.

## Proposal

1. Split a generation into independent walks, each with its own RNG derived
   from the `refine` stream (`base = rng.refine.next_u64()` once per
   generation, then `mix_seed(base, seed_index)`), so a child never depends on
   which walk finished first (ADR-001).
2. Run the walks on farm workers. Each walk needs the posterior summary and
   the standardizer (read-only), its seed tree and locks, and returns its
   chain's result and trace.
3. Absorb results in seed order in the engine worker: admission, dedup and
   retirement stay single-threaded and unchanged, so the pool after a
   generation is the same as the serial path's for the same seed.
4. Keep the serial path as the fallback when no farm is available.

## Alternatives Considered

- **Fewer, shorter walks**: faster, and a measurably worse search
  (`make budget-ab` set the current split).
- **Cache renders across walks**: helps revisits only; most proposals are new.

## Consequences

- A generation in roughly the time of its slowest walk (seconds, not minutes).
- The generation's children for a given seed change once (new per-walk RNGs).
- Farm workers need the posterior summary and standardizer, which today live
  only in the engine worker.

## Open questions

- How much of the posterior must a walk see: the mean, or draws?
- Should a generation show children as they arrive, in seed order?
