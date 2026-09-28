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

1. **Session: jobs and absorption.** Add `WalkContext`, `WalkJob`,
   `run_walk(ctx, job, memo)`, `Engine::refine_jobs(rng)`,
   `Engine::refine_absorb(parent, result)`; derive `Serialize` for
   `PatchGrammarPrior` and `RefineKeep`. Rewrite `refine`/`refine_seed` over
   them. Tests: serial equals absorbed-in-shuffled-completion-order;
   `run_walk` deterministic in its seed; `refinement_improves_pool` passes.
2. **Measure natively.** Context payload size (JSON) at the shipped
   `mcmc_samples` and `k_styles`; per-worker memo hit rates. Decide whether
   walks get a thinned posterior (only if measured to change no child).
3. **Bindings.** `WasmEngine::refine_jobs`, `refine_absorb`, and a stateless
   `farm_walk(context_json, job_json)`; tests that the JSON round trip leaves
   a walk's result unchanged (struct replies, ADR-002).
4. **Web.** `worker.js`: a `breed` long job issuing walk jobs to the farm,
   holding out-of-order results, absorbing in order, breathing between
   absorptions; serial fallback. `farm.js`: walk jobs with a per-generation
   context cache and a per-worker memo.
5. **Presentation.** EVOLVE shows progress by children absorbed; decide with
   the interaction design review whether children appear as they land.
6. **Verify.** Browser spec: EVOLVE POOL completes, children in order, the
   player answered mid-generation. Measure generation time at 1, 2 and 4
   farm workers; update the guide's EVOLVE page and the reference.

## Done when

Serial and parallel produce the same pool for a seed; a generation in the
browser is several times faster on a multi-core machine; every gate green.
