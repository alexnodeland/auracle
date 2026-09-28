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
4. **Web.** *Done.* `worker.js`: a `breed` job (`breedOpen`) issuing walk
   jobs to the farm, holding out-of-order results, absorbing in order one per
   turn; serial fallback through `refine_seed` (no crew, a worker lost, a
   walk a worker answered `""`, a five-minute watchdog). `farm.js`: `walk`
   jobs with the context sent once per worker per generation (`walk_context`)
   and `farm_walk`'s per-worker memo. As built, beyond the plan:
   - **The generation does not hold the floor.** It is a *walk job*; only a
     refit and another generation wait for it (`blocked`), so PERFORM's
     measurements, offers, spares and drifts run during it.
   - **The farm on demand.** Boot's crew is still reaped at boot's end; a
     generation or ⚡ asks main for a crew (`farm_want` / `farm_ports`),
     spawned from the module compiled at boot, reaped after 60 s idle or at
     once on a stop that leaves it walking for nobody. `walkWidth()` is boot's
     rule with a floor of one worker on two or more cores.
   - **⚡ as one farm walk** (`refine_from_job` → `farm_walk` →
     `refine_from_absorb`) at the front of the queue, with stop. Two or three
     parallel walks keeping the best was **not** done: choosing the best
     needs E[u] of each result, which only absorbing computes, and the extra
     seeds would change what a seeded ⚡ breeds. One walk.
   - **Stop** (`refine_stop`) calls `refine_finish` and keeps what is bred.
5. **Presentation.** *Done.* Children appear as they land (EV-05's answer:
   yes), in a "new · gen N" group at the top of the pool that does not
   re-sort the ranked rows; EVOLVE POOL is its own progress bar (jobs
   absorbed / total) with stop; hovering it marks what may be replaced
   (`refine_retiring` during a generation, the lowest unsaved rows before
   one); the menu bar's job slot (SH3, RT9) carries the generation with an
   estimate from this session's walk times, ⚡ and the refit, and the E is lit
   exactly while it shows.
6. **Verify.** *Done.* `evolve_breeds_beside_you.spec.js` (completes, children
   in order, a pick deals within 1 s, PERFORM measures and an Offer starts
   mid-generation, stop keeps what's bred, ⚡ leaves the engine free);
   `evolve_generation_timing.spec.js` (the harness below); the guide's EVOLVE,
   bank, rack and glossary pages and the reference's runtime page.

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

## Measured (task 6)

`tests/web/evolve_generation_timing.spec.js` (`AURACLE_MEASURE=1`), Chromium
on the same shared 4-core machine as task 2, while other agents' builds and a
film rehearsal queue kept its load average at 6–7.5. Each width boots a fresh
profile holding **one saved session** (taught once: six picks and their
refit), so every width breeds the same generation; the time is from the press
to the receipt. Two samples, in opposite orders:

| Farm workers | Generation | First child landed | Same children, retirees and bank as `?farm=0` |
| --- | --- | --- | --- |
| 0 (the serial path, walks in the engine worker) | 207.6 s, 229.5 s | 23–24 s | — |
| 1 | 197.9 s, 205.7 s | 21–24 s | yes |
| 2 (`walkWidth()` here: 4 cores − 2) | 192.4 s, 187.1 s | 40–42 s | yes |
| 4 | 156.9 s, 172.5 s | 70–75 s | yes |

Sessions taught afresh at each width (so each bred a different generation)
took 208 s at 0, 148 s at 1, 110–152 s at 2 and 105 s at 4.

The gain in wall time is small on a machine that is already oversubscribed:
the walks share the same busy cores, and one walk of this generation (job 2)
runs well over a minute on its own, so the generation cannot end before it
does, and with more workers each walk (the first included) runs slower. The
native measurement on the same machine was 166 s vs 79 s with ten threads.
What changed for the player does not depend on the load:

| During a generation | Before (review, RT1) | Now (`evolve_breeds_beside_you.spec.js`) |
| --- | --- | --- |
| A pick's next pair dealt | up to one walk, ≈ 19 s | 8–37 ms |
| PERFORM's first measurement of a newly opened patch | after the whole generation | during it (41 s, beside the walks) |
| A pressed Offer starts | after the whole generation | 13 ms |
| ⚡: a deal while it walks | after the walk, ≈ 23 s | 15–37 ms |
| ⚡ stop answered | — (no stop) | 372 ms |

"Several times faster" (below) is therefore **not** shown on this machine;
it is the native result and needs cores to spare. The generation no longer
holds the instrument, which was RT1's finding.

## Done when

Serial and parallel produce the same pool for a seed; a generation in the
browser is several times faster on a multi-core machine; every gate green.
