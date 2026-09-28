---
title: "Aim search-control offers along the control's direction"
number: 2
status: active
author: Claude Code
created: 2026-09-28
updated: 2026-09-28
originating_proposal: 2
related_adrs: [2, 8]
---

# Plan-002: Aim search-control offers along the control's direction

## Objective

Implements [RFC-002](../proposals/002-directed-search-offers.md) under
[ADR-008](../decisions/008-search-offers-are-aimed.md): turning a search
control grows an offer that moves the way it was turned, and says how far.

## Bounded contexts

| Context | Owns | Crate / file |
| --- | --- | --- |
| Targets | `TiltedFitness`, `offer_toward` | `auracle-session/src/perform.rs`, `engine.rs` |
| Tuning | The γ census | `auracle-session/examples/` |
| Bindings | `perform_offer` with control and sign; `moved` in the reply | `auracle-wasm/src/lib.rs` |
| Presentation | The request from `onRelease`; B's strip | `apps/web/perform.js` |

## Tasks

1. **Session.** `TiltedFitness<F>` sharing the render memo;
   `Engine::offer_toward(rng, tree, locks, steps, control, sign)`. Test: on
   presets with no drive, `offer_toward(Grit, +1)` moves along Grit's
   direction on average over seeds, and undirected `offer` does not.
2. **Census and γ.** An example that grows N offers per preset per search
   control at several γ, recording the move along `ê` and the drop in `E[u]`;
   choose the default; name it as a constant.
3. **Bindings.** Optional `control` and `sign` on `perform_offer`; a struct
   reply with `moved` (ADR-002).
4. **Web.** `onRelease` passes control and sign; B's strip reports the move
   ("grittier by 0.8σ", or says it did not move that way); browser spec.
5. **Truth.** The guide's "not yet aimed" warning becomes a description of
   the aim; the reference's PERFORM search page gains the target and census.

## Done when

On patches where Grit or Space is a search control, the offer moves that way
in most trials, B says by how much, and every gate is green.

## Outcome

All five tasks are built. The census (`make offer-census`,
`crates/auracle-session/examples/offer_census.rs`) settled two constants in
`auracle_session::perform`, not one:

- **`AIM_GAMMA` = 1.** Past it more aim buys a few points of the floor,
  none of R\*, and a lower E[u].
- **`AIM_WALKS` = 3**, which the plan did not foresee. Twenty single-site
  steps rarely propose the module that makes a patch rough, and the tilt
  cannot make a proposal the kernel never draws: the tilt alone moved Grit
  up at least `REACH_FLOOR` in 17% of taught trials. A walk that has not
  arrived continues from where it stopped (one longer chain, nothing thrown
  away), up to three walks.

16 presets, every search control both ways, two seeded offers per arm, 192
offers per arm, seed 7; "≥ floor" is at least `REACH_FLOOR` (0.15σ) the asked
way, R\* = 0.95σ the median verified reach of a reachable control:

| γ × walks | ≥ floor, taught | ≥ R\*, taught | median ΔE[u], taught | ≥ floor, prior | Grit up ≥ floor, taught / prior |
|---|---|---|---|---|---|
| 0 × 1 (Offer pad) | 22% | 13% | +0.92 | 23% | 7% / 14% |
| 0.5 × 1 | 26% | 16% | +0.84 | 31% | 14% / 35% |
| 1 × 1 | 34% | 23% | +0.74 | 35% | 17% / 35% |
| 2 × 1 | 39% | 22% | +0.63 | 36% | 25% / 32% |
| 4 × 1 | 40% | 23% | +0.62 | 38% | 32% / 32% |
| 0 × 3 | 32% | 18% | +1.72 | 41% | 17% / 32% |
| **1 × 3 (shipped)** | **46%** | **28%** | **+1.33** | **53%** | **46% / 64%** |
| 2 × 3 | 48% | 28% | +1.18 | 54% | 50% / 71% |

Timed (fresh memo per offer): 6.0 s for the Offer pad's walk, 15.6 s for the
shipped aimed offer; one tilted walk costs the same as an untilted one (5.1 s
each).

**Done when, measured.** Grit up moves the asked way in 64% of trials before a
fit and 46% after a taste that dislikes noise (the worst case for Grit), so
"most trials" holds before a fit and falls just short after one. Grit down
and Space down never move (0 of 28 and 0 of 24): a patch with no noise or no
tail is already at the floor, and B says so. Space up reaches 29–45%, and is
asked for only when the release graft did not reach.

**Left open.** The wait (RT4): growing aimed offers on the farm, and starting
both ways at pointer-down, belong to RFC-001's farm walk path. RFC-002's own
open questions (asking harder on repeated turns; aiming Wander) are
unanswered. The `view-perform` film still says "It isn't aimed at grit yet"
(`honest6`), and needs re-voicing and re-recording.
