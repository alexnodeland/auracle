---
title: "Breed a generation in seconds: walks in parallel on the render farm"
number: 1
status: in-review
author: Claude Code
created: 2026-09-28
updated: 2026-09-28
supersedes: null
superseded_by: null
---

# RFC-001: Breed a generation in seconds: walks in parallel on the render farm

## Audience

Anyone changing `crates/auracle-session` (refinement), `crates/auracle-wasm`
(the refine bindings), `apps/web/worker.js` and `apps/web/farm.js`. The
decision to accept is the maintainer's.

## Context

EVOLVE POOL runs `refine_seeds` typed MH walks, one child per seed, in the
engine worker, one after another (`Engine::refine_begin`, then
`refine_seed` per parent). Each MH step scores its proposal with
`SurrogateFitness::evaluate`, which **renders** the proposal on the audition
phrase (`featurize_memo`), so a generation is render-bound: measured natively
at about 100 s (about 36 fresh renders per seed, 5–21 s per seed), and about
3 minutes in the browser under load. The EVOLVE film cuts over the wait; a
player cannot. Since the responsiveness work the worker answers the player
between seeds, but a generation is no faster.

The render farm already exists: stateless wasm workers (`farm.js`) that run a
pure function per job (`farm_render(tree, phrase)`) and hand results back to
be folded in stream order, so the pool the farm builds equals the serial one.

A walk has the same shape. `Engine::walk_with` takes `&self` and reads only:

| Input | Where it comes from | Serializable |
| --- | --- | --- |
| The biased prior | `Engine::biased_prior()` (the grammar prior tilted by the posterior's mean θ, weighted by style share) | Not yet: `PatchGrammarPrior` derives `Clone` only. Add `Serialize`, or send the tilt (θ and sd per coordinate) and rebuild it in the worker |
| The fitness | `SurrogateFitness { posterior, standardizer, phrase, memo }` | posterior and standardizer are `Serialize`; the memo is per-process |
| β, `refine_keep`, `refine_steps`, `LOCK_SCALE_CAP` | `SessionConfig` and constants | yes |
| The seed tree and locks | the parent candidate | yes |
| An RNG | today `&mut self.rng.refine`, shared across the generation's walks | a seed per walk |

Everything after the walk (the novelty check and `insert_candidate`, which
evicts the worst and records lineage) mutates the pool and must stay in the
engine, in a fixed order.

## Proposal

### 1. Split a generation into jobs and absorptions (auracle-session)

```rust
/// Everything one walk reads, and nothing it may change.
#[derive(Serialize, Deserialize)]
pub struct WalkJob {
    pub parent_id: u64,
    pub seed: PatchTree,
    pub locked: Vec<String>,
    pub steps: usize,
    pub rng_seed: u64,
}

/// What a generation's walks share: sent once per generation per worker.
#[derive(Serialize, Deserialize)]
pub struct WalkContext {
    pub prior: PatchGrammarPrior,          // biased_prior(), computed once (needs Serialize)
    pub posterior: TastePosterior,
    pub standardizer: Standardizer,
    pub phrase: PhraseSpec,
    pub beta: f64,
    pub refine_keep: RefineKeep,
}

impl Engine {
    /// Open a generation: bump `generation`, pick the parents (as
    /// `refine_begin` does), draw ONE base from the refine stream, and derive
    /// each job's RNG as `mix_seed(base, index)`.
    pub fn refine_jobs<R: Rng>(&mut self, rng: &mut R) -> (WalkContext, Vec<WalkJob>);

    /// Fold one walk's result in, exactly as `refine_inner` does after its
    /// walk: novelty check, `insert_candidate`, lineage. Called in job order.
    pub fn refine_absorb(&mut self, parent_id: u64, walk: Result<PatchTree, RefineOutcome>) -> Option<u64>;
}

/// A walk as a pure function: what a farm worker runs.
pub fn run_walk(ctx: &WalkContext, job: &WalkJob, memo: &RenderMemo) -> Result<PatchTree, RefineOutcome>;
```

`refine()` and `refine_seed()` become thin wrappers over these (the serial
path, and the fallback with no farm), so native tests keep exercising the
same code the browser runs.

### 2. Deterministic regardless of timing (ADR-001)

Each job carries its own RNG seed, derived from one draw of the `refine`
stream per generation. Results are absorbed **in job order**, whichever walk
finishes first. So a generation is a function of the seed, the pool and the
posterior, never of which worker was fastest, and the parallel and serial
paths produce the same pool (a native test pins this: absorb in shuffled
completion order, compare with serial).

### 3. The browser (auracle-wasm, worker.js, farm.js)

- `WasmEngine::refine_jobs() -> {context, jobs}` (JSON) and
  `WasmEngine::refine_absorb(parent_id, result_json) -> child id or 0`.
- A new stateless binding for the farm: `farm_walk(context_json, job_json) ->
  result_json`. Each farm worker keeps its own `RenderMemo`, and caches the
  parsed context by generation, so the posterior crosses once per worker per
  generation, not once per job.
- `worker.js` runs a generation as a `breed` long job: issue all jobs to the
  farm, absorb results in job order as they arrive (holding out-of-order ones),
  breathing between absorptions so the player is answered. With no farm it
  runs the jobs serially in the worker, as today.
- EVOLVE's progress toast counts children absorbed, in order.

### 4. Size and cost to measure first

- **The posterior payload.** `TastePosterior` carries its thinned MCMC draws.
  Measure the JSON size at `mcmc_samples` × `k_styles`; if it is several
  megabytes, send it once per worker per generation (as above), or send a
  thinned copy for walks only (the surrogate averages `utility_mix` over the
  draws; measure how few keep the chosen child the same).
- **Memo loss.** The engine's memo is shared across a generation's walks
  today; per-worker memos lose cross-walk hits. Walks from different seeds
  rarely revisit the same tree, so expect little loss; measure hit rates.
- **Speed-up.** With W farm workers, a generation should take roughly its
  slowest walk plus overhead: measure 1, 2, 4 workers on the same seed.

## Alternatives Considered

- **Fewer, shorter walks.** Faster, and a measurably worse search:
  `make budget-ab` set the current `(refine_steps, refine_seeds)` split.
- **Parallelize inside one walk.** MH is sequential; only the proposal's
  render could be farmed, at one round trip per step. Worse than whole walks.
- **Cache renders across walks.** Helps revisits only; most proposals are
  new trees.

## Consequences

- A generation in roughly the time of its slowest walk: seconds, not minutes,
  on a machine with several cores.
- Seeded generations change once (per-walk RNGs replace the shared stream), as
  seeded pools did under ADR-001.
- `refine_from` (⚡ evolve from this) is one walk: it can use the same job
  path for a single job on a farm worker, keeping the engine worker free.

## Implementation outline

1. **Session:** `WalkContext`, `WalkJob`, `run_walk`, `refine_jobs`,
   `refine_absorb`; `refine`/`refine_seed` rewritten over them. Tests: serial
   equals parallel-in-any-order; a job is deterministic in its seed; the
   existing `refinement_improves_pool` gate still passes.
2. **Measure** the context payload and memo hit rates natively (an example
   beside `closed_loop_sweep`).
3. **Wasm:** `refine_jobs`, `refine_absorb`, `farm_walk`; native tests that
   the JSON round trip leaves a walk's result unchanged.
4. **Web:** `worker.js` breed job over the farm, ordered absorption,
   breathing; `farm.js` walk jobs with a per-generation context cache; the
   fallback path. A browser spec: EVOLVE POOL completes, children appear in
   order, and the player is answered mid-generation.
5. **Measure in the browser**: generation time at 1, 2, 4 farm workers; update
   the guide's EVOLVE page if it states how long a generation takes.

## Open questions

- Should EVOLVE show children as they are absorbed, in seed order, rather than
  all at the end?
- Is a thinned posterior for walks acceptable if it measurably never changes
  which child a walk returns?
