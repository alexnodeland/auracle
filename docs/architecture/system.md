---
title: "The engine: from a drawn patch to a learned taste"
last_updated: 2026-10-06
related_adrs: [1, 2, 5]
---

# The engine: from a drawn patch to a learned taste

## Purpose

For anyone changing `crates/`. It follows one patch and one pick through the
engine, names the file each step lives in, and ends with the checklist for
adding a module. The *why* of the model and the search, with the math, is the
published [reference](../../www/reference/src/); this document is the map to
the code.

## Overview

Two loops share one pool of patches.

```text
            patch loop (fast, silent)                         taste loop (slow, human)
 prior draw ──► compile ──► render ──► vet ──► φ ──► pool ──► duel ──► pick ──► log ──► refit
      ▲                                                 │                                 │
      └────────── refine: typed MH toward E[u] ◄────────┴───────── posterior ◄────────────┘
```

1. **Draw.** `auracle-grammar/src/prior.rs` samples a `PatchTree` from a typed
   PCFG. The tree is the genome; its trace addresses (`node/0#cut`) name every
   knob.
2. **Compile.** `compile.rs` turns the tree into a quiver `Patch` (a voice),
   with the output stage and limiter every patch shares.
3. **Render and vet.** `auracle-features` plays the voice through the standard
   phrase (`phrase.rs`), refuses silent, broken or runaway renders (`vet.rs`),
   and normalizes loudness to `TARGET_LUFS` (`loudness.rs`). A render
   compiles the voice with `compile_for_render`, which folds each live knob
   it can into the port it drives (nothing turns a knob during a
   measurement): about 87% of them, the rest sharing their port with a
   modulation's cable. A sample then walks about half the nodes and the
   samples are the same, bit for bit (`CompiledVoice::pin_knobs`; [what a render
   costs](../notes/render-cost-2026-10/README.md)).
   A patch with an AUDIO IN (`PatchTree::listens`) is built on the audition
   stream and reads the phrase's audition clip on the render's own clock
   (`clip.rs`, `render.rs`); its render key carries the clip.
4. **Measure.** φ is φ_audio (perceptual descriptors of the render) plus
   φ_struct (render-free descriptors of the tree), `pipeline.rs`. φ is all the
   model sees.
5. **Pool.** `auracle-session/src/engine.rs` keeps `pool_size` vetted
   candidates, filled from an indexed draw stream (`farm.rs`) so the browser's
   render farm and the serial path build the same pool.
6. **Duel.** `next_duel_full` deals a pair. Under the default rule
   (`Acquisition::Random`) every pair is random, and so every pick is also a
   fair test of the model's forecast (`calib.rs` scores them).
7. **Observe.** A pick, a star, a keep, a cut or a committed edit is appended
   to the log as raw φ (`auracle-taste/src/observe.rs`). Stars, cuts and edits
   are the other ways the player teaches it.
8. **Refit.** `fit_posterior` standardizes φ from the log (`standardize.rs`)
   and runs MCMC (`mcmc_samples`, `mcmc_warmup`) on the max-of-experts model
   (`model.rs`) with up to `k_styles` lenses. The new posterior is aligned to
   the previous one's lenses, so styles keep their identity and names.
   Between refits, votes reweight the existing draws, and every reply to a
   pick carries what the reweighted draws say (`belief.rs`, `Engine::belief`).
9. **Refine.** EVOLVE POOL runs a generation: `refine_seeds` typed MH walks
   of `refine_steps` steps on `π_β ∝ p_grammar · exp(β·E[u])`, one child per
   seed. It is split into data and a fold (`walk.rs`,
   [ADR-007](../decisions/007-generations-breed-in-parallel.md)):
   `refine_jobs` opens the generation and returns one `WalkContext` (tilted
   prior, posterior, standardizer, phrase, β, keep rule) and one `WalkJob` per
   parent, each with its own RNG seed from one draw of the `refine` stream;
   `run_walk` is the walk as a pure function, run in the engine or on a
   render-farm worker (`farm_walk`); `refine_absorb` folds results in **job
   order** (novelty, admission, lineage) and refuses one out of turn as
   `stale`; `refine_finish` ends it (or stops it early) and only then
   retires the lowest members not kept (`Candidate::kept`: saved, or kept as
   new by `commit_edit` and not yet in a recorded pick, at most
   `unjudged_cap` of those), so a patch saved mid-generation is never
   retired. `refine` is that loop run serially, and `refine_begin` +
   `refine_seed` the same loop one walk per call. ⚡ *evolve from this* is one
   job over the same path (`refine_from`, or `refine_from_job` +
   `refine_from_absorb` / `refine_from_walk`), with locks; its seed is
   exempt from eviction while the job is out. Before a generation opens,
   `next_seeds` names its parents and `may_replace` the members its end
   could retire.

## Key abstractions

| Type | Crate | What it is |
| --- | --- | --- |
| `PatchTree` | grammar | The genome: a typed term. Audio and Mod sorts are separate types. |
| Trace address | grammar | `node/0#cut`: the one name every knob, lock, edit and proposal uses |
| `PhraseSpec` | features | The audition phrase: notes, timing, seed, and the audition clip an AUDIO IN reads |
| φ | features | The feature vector, `phi_names()` in order |
| `Observation` | taste | One piece of feedback, with raw φ |
| `TastePosterior` | taste | Weighted MCMC draws of θ per lens |
| `Engine` | session | Pool, log, posterior, lineage, PERFORM state |
| `SessionState` | session | What is saved and restored (migrated when it changes) |

## PERFORM

`auracle-session/src/perform.rs` gives a patch six named controls (Bright,
Snap, Motion, Body, Grit, Space), the first six of a palette of eighteen
(`PALETTE`) that the engine measures the same way when asked
(`Engine::wire_named`; the app asks for the six). Each is wired to the knobs whose change moves
that direction in φ, measured on the patch's own renders (a Jacobian), and the
wiring is verified on real renders before it is trusted. A control that no
knob reaches becomes a **search control**: turning it asks for an offer, a
nearby patch grown on the taste walk tilted toward that direction
(`Engine::offer_toward`, ADR-008), whose reply says how far it moved that way.
The Offer pad's offers are the untilted walk (`Engine::offer`). Wander drifts the
knobs (`Engine::drift`) or grows offers on its own. Measurement is the
expensive part, which is why the web app caches wirings and measures in pieces.
Under the model view each control also shows which way your taste leans along
it (`Engine::lean`): the posterior slope of the utility along the control's
direction at the sound in hand, through the lens that claims the sound in each
draw (`TastePosterior::slope`): a few dot products per draw for a tree in the
engine's memo, and otherwise one render, as ▶ costs.

## Randomness

Fills, duels, fits, evolution and PERFORM each draw from their own stream,
derived from the session seed, and a fit is seeded from the evidence count
([ADR-001](../decisions/001-one-random-stream-per-consumer.md)). A seeded
session therefore deals, fits and breeds the same way however long anything
took. Within a generation each walk has its own seed, derived from one draw of
the `refine` stream, so which farm worker finishes first cannot change what
is bred. PERFORM's offers and drifts are seeded the same way: each takes one
draw of the `perform` stream when it begins and walks on a generator of its
own, so pausing one, or beginning another beside it, cannot change what either
finds. A session opened with a seed in the address (`?seed=`) whose pool
fills at boot keeps its duels to a fixed schedule from the first, dealt at
`playable`: the k-th draws only from the first 8·(k+1) sounds in the order
the seed's fill folds them in, whether or not the fill has finished by
then, and the worker holds one until those have joined, so how far the fill
had got does not change them, on any machine. A session restored with its
pool full has no fill and no schedule, and its duels draw from the whole
pool. An ordinary session (no seed in the address) has no schedule either:
its duels are drawn at once from the sounds that have joined, so a pick
never waits for more to join, and how far the fill had got can change them
([web-runtime.md](web-runtime.md#deals-while-the-pool-fills)). What a
player does while the pool fills can change the duels: a sound they add
(the warm start's picks, a preset opened) joins wherever the fill has got
to.

## Adding a module

A new module is a change in every layer. In order:

1. **Term**: add the node to `term.rs` (right sort, knobs with domains).
2. **Prior**: give it production weight and knob priors in `prior.rs`. A
   kind only a player places (TRACK, CAPTURE) gets no weight: it is a
   player kind, appended after the drawn kinds, which `OpKind` scores and
   never samples, and which walks hold (`PatchTree::player_sites`).
3. **Compile**: build the quiver module in `compile.rs`. Mind the stack: large
   modules built by value are why the wasm stack is 8 MB.
4. **Describe**: plate title and knob labels in `describe.rs`. Labels are copy:
   a label says what turning it up does.
5. **Mutate**: in `mutate.rs`, a `NodeKind`, its audible defaults in
   `default_fragment` (its own second branch included) and its `graft` arm,
   which seats the chain at `/0`. The compiler asks for those two; it does not
   ask for these:
   - `NodeKind::ALL`, which the edit gate sweeps (a const check and
     `node_kind_all_names_every_kind` fail until the kind is there);
   - `is_source`, if it is a source;
   - the three tables with catch-all arms: `child_mut` if it has audio
     children, `binary_children_mut` if it has two, and `mod_slot_mut` if it
     has a modulation slot. Forget one and the kind silently has no children
     or no slot.
6. **φ_struct**: count it in `auracle-features/src/structural.rs` if the model
   should see it. That is a φ change: run `make revalidate`.
7. **Web**: the node bank entry in `apps/web/main.js` (kind, name, group,
   tags, `phi` hint), knob units and `SITE_NAMES` if it adds a site. The
   pool's count of the module reads the s-expression: rewrite the grammar's
   table of its tokens (`the_sexpr_heads_fixture_is_current` in
   `term/tests.rs`, with `AURACLE_UPDATE_FIXTURES=1`), and if `to_sexpr`
   opens the term with a token other than the kind's name, add it to
   `apps/web/support.js` (`sexprHead`); `support.test.mjs` fails until you
   do.
8. **Guide**: its node page and the rack pages in `www/docs`; the reference if
   it changes the palette's story.
9. **Tests**: the edit gate, the codec round trip, a compile test, and
   `make wasm` then the browser smoke test.

## References

- Reference: *The two loops*, *Audition*, *Features*, *Utility as a max of
  experts*, *The search* (`www/reference/src/`)
- [ADR-001](../decisions/001-one-random-stream-per-consumer.md),
  [ADR-002](../decisions/002-trees-serialize-in-declaration-order.md),
  [ADR-005](../decisions/005-tests-run-optimized.md)
