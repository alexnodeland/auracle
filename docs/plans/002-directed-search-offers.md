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
