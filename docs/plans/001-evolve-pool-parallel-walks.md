---
title: "Breed a generation in parallel on the render farm"
number: 1
status: active
author: Claude Code
created: 2026-09-28
updated: 2026-09-28
originating_proposal: 1
related_adrs: [1, 2, 7]
---

# Plan-001: Breed a generation in parallel on the render farm

## Objective

Implements [RFC-001](../proposals/001-evolve-pool-parallel-walks.md) under
[ADR-007](../decisions/007-generations-breed-in-parallel.md): a generation in
roughly the time of its slowest walk, identical to the serial result.

## Bounded contexts

| Context | Owns | Crate / file |
| --- | --- | --- |
| Refinement | Walk jobs, the pure walk, ordered absorption | `auracle-session/src/engine.rs` |
| Bindings | JSON jobs, context and results across the wasm boundary | `auracle-wasm/src/lib.rs` |
| Scheduling | The breed job, the farm, ordered absorption, breathing | `apps/web/worker.js`, `farm.js` |
| Presentation | Progress and children as they land | `apps/web/main.js` (EVOLVE) |

## Tasks

1. **Session: jobs and absorption.** *Done.* Add `WalkContext`, `WalkJob`,
   `run_walk(ctx, job, memo)`, `Engine::refine_jobs(rng)`,
   `Engine::refine_absorb(parent, result)`; derive `Serialize` for
   `PatchGrammarPrior` and `RefineKeep`. Rewrite `refine`/`refine_seed` over
   them. Tests: serial equals absorbed-in-shuffled-completion-order;
   `run_walk` deterministic in its seed; `refinement_improves_pool` passes.
   As built (`crates/auracle-session/src/walk.rs`, `engine.rs`): the result
   names its generation, job and parent, so `refine_absorb(result)` takes no
   separate parent; out-of-turn results read `RefineOutcome::Stale`.
   `refine_finish()` stops or closes a generation. Evictions moved to the
   finish (EV-07 item 5): admission is decided per child against the member
   per-child eviction would have displaced, retirement happens at the end,
   so the sets are unchanged and a save made mid-generation protects. ⚡ is
   one job (`refine_from_job` + `refine_from_absorb`).
2. **Measure natively.** *Done* (`make walk-payload`). Context payload size
   (JSON) at the shipped `mcmc_samples` and `k_styles`; per-worker memo hit
   rates. Decide whether walks get a thinned posterior (only if measured to
   change no child). Results below.
3. **Bindings.** *Done.* `WasmEngine::refine_jobs`, `refine_absorb`, and a
   stateless `farm_walk(context_json, job_json)`; tests that the JSON round
   trip leaves a walk's result unchanged (struct replies, ADR-002). Also
   `refine_finish`, `refine_retired`, `refine_retiring`, `refine_from_job`,
   `refine_from_absorb`. None is called by the app yet (task 4).
4. **Web.** `worker.js`: a `breed` long job issuing walk jobs to the farm,
   holding out-of-order results, absorbing in order, breathing between
   absorptions; serial fallback. `farm.js`: walk jobs with a per-generation
   context cache and a per-worker memo.
5. **Presentation.** EVOLVE shows progress by children absorbed; decide with
   the interaction design review whether children appear as they land.
6. **Verify.** Browser spec: EVOLVE POOL completes, children in order, the
   player answered mid-generation. Measure generation time at 1, 2 and 4
   farm workers; update the guide's EVOLVE page and the reference.

## Measured (task 2)

`crates/auracle-session/examples/walk_payload.rs`, shipped config (pool 40,
`mcmc_samples` 10 000, K = 5, 10 walks × 40 steps), 3 seeds, on a shared
4-core machine under load:

| Quantity | Value |
| --- | --- |
| Context JSON | 2.21 MB, all but 2.5 KB of it the posterior (500 draws × 5 lenses × 44 coordinates); native parse 6–9 ms |
| One job / one result | 0.3–2.6 KB / 2.0–4.1 KB |
| Renders, one memo per job vs one shared cold memo | identical (385 renders, 435 hits for 10 walks): no walk revisited another's trees |
| Renders against the engine's warm memo | +10 per generation (+2.7%): each walk renders its seed once |
| A generation, 1 thread vs 10 threads | 166 s vs 79 s (2.1× on 4 loaded cores) |
| Thinned posterior for walks | ½ of the draws: 27/30 walks keep their child; ⅕: 25/30 |

Decisions: the context goes to each farm worker once per generation, and
`farm_walk` keeps the parsed context by text, so the posterior is parsed
once per worker per generation. One memo per worker loses nothing. Walks do
**not** get a thinned posterior: it changes children.

## Done when

Serial and parallel produce the same pool for a seed; a generation in the
browser is several times faster on a multi-core machine; every gate green.
