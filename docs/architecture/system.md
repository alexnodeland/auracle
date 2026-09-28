---
title: "The engine: from a drawn patch to a learned taste"
last_updated: 2026-09-28
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
   and normalizes loudness to `TARGET_LUFS` (`loudness.rs`).
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
   Between refits, votes reweight the existing draws.
9. **Refine.** EVOLVE POOL runs `refine`: `refine_seeds` typed MH walks of
   `refine_steps` steps on `π_β ∝ p_grammar · exp(β·E[u])`, one child per
   seed, retiring the patches the model likes least (saved patches never
   retire). ⚡ *evolve from this* is `refine_from` on one patch, with locks.

## Key abstractions

| Type | Crate | What it is |
| --- | --- | --- |
| `PatchTree` | grammar | The genome: a typed term. Audio and Mod sorts are separate types. |
| Trace address | grammar | `node/0#cut`: the one name every knob, lock, edit and proposal uses |
| `PhraseSpec` | features | The audition phrase: notes, timing, seed |
| φ | features | The feature vector, `phi_names()` in order |
| `Observation` | taste | One piece of feedback, with raw φ |
| `TastePosterior` | taste | Weighted MCMC draws of θ per lens |
| `Engine` | session | Pool, log, posterior, lineage, PERFORM state |
| `SessionState` | session | What is saved and restored (migrated when it changes) |

## PERFORM

`auracle-session/src/perform.rs` gives a patch six named controls (Bright,
Snap, Motion, Body, Grit, Space). Each is wired to the knobs whose change moves
that direction in φ, measured on the patch's own renders (a Jacobian), and the
wiring is verified on real renders before it is trusted. A control that no
knob reaches becomes a **search control**: turning it asks for an offer, a
nearby patch grown toward that direction (`Engine::offer`). Wander drifts the
knobs (`Engine::drift`) or grows offers on its own. Measurement is the
expensive part, which is why the web app caches wirings and measures in pieces.

## Randomness

Fills, duels, fits, evolution and PERFORM each draw from their own stream,
derived from the session seed, and a fit is seeded from the evidence count
([ADR-001](../decisions/001-one-random-stream-per-consumer.md)). A seeded
session therefore deals, fits and breeds the same way however long anything
took. The one remaining nondeterminism in the app is *when* the first duel is
dealt: it is dealt at `playable`, while the pool is still filling.

## Adding a module

A new module is a change in every layer. In order:

1. **Term**: add the node to `term.rs` (right sort, knobs with domains).
2. **Prior**: give it production weight and knob priors in `prior.rs`.
3. **Compile**: build the quiver module in `compile.rs`. Mind the stack: large
   modules built by value are why the wasm stack is 8 MB.
4. **Describe**: plate title and knob labels in `describe.rs`. Labels are copy:
   a label says what turning it up does.
5. **Mutate**: audible defaults for a player's insert in `mutate.rs`, and let
   the edit gate cover it.
6. **φ_struct**: count it in `auracle-features/src/structural.rs` if the model
   should see it. That is a φ change: run `make revalidate`.
7. **Web**: the node bank entry in `apps/web/main.js` (kind, name, group,
   tags, `phi` hint), knob units and `SITE_NAMES` if it adds a site.
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
