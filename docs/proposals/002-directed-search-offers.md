---
title: "Aim PERFORM's search-control offers along the control's direction"
number: 2
status: accepted
author: Claude Code
created: 2026-09-28
updated: 2026-09-28
supersedes: null
superseded_by: null
---

# RFC-002: Aim PERFORM's search-control offers along the control's direction

## Audience

Anyone changing PERFORM: `crates/auracle-session/src/perform.rs`,
`Engine::refine_walk`/`walk_with`, the `perform_offer` binding, and
`apps/web/perform.js`. Accepted by the maintainer on 2026-09-28.

## Context

A named control no knob in the patch can honestly move is a *search control*
(amber, dashed). Turning it past a third either grafts a module that gives it
something to turn (Bright and Body get a flat EQ, Space up gets a longer
release) or, otherwise, asks for an offer:

```js
// apps/web/perform.js, onRelease
host.note(`${w.name}: no knobs here make it ${up ? w.high : w.low} — growing an offer instead`);
requestOffer(`${w.name.toLowerCase()} ${up ? "up" : "down"}`);
```

The request carries the direction only as a label. `perform_offer(tree,
overrides, locks, steps)` and `Engine::offer` run the same **undirected**
walk as the Offer button (`refine_walk`: the taste target
`π ∝ p_grammar · exp(β·E[u])`, or the vetted prior before a fit). So turning
Grit up gets an offer that is better by taste, not reliably grittier. The
guide says so honestly ("It is **not yet aimed** at the direction you
turned", `www/docs/src/views/perform.md`), but the control's name promises
more than the offer does.

Each named control already has a unit direction `ê` over the named φ axes
(`perform::direction(control, names)`), and the standardized φ of every
proposal is computed anyway, by the fitness.

## Proposal

### 1. A tilted fitness (auracle-session)

```rust
/// Any fitness, tilted along a direction in standardized φ: the search
/// control's target is π ∝ p_grammar · exp(β·(f(x) + γ·s·ê·z(x))).
pub struct TiltedFitness<F> {
    pub inner: F,                      // SurrogateFitness, or VetOnlyFitness before a fit
    pub standardizer: Arc<Standardizer>,
    pub direction: Vec<f64>,           // ê, unit, over φ
    pub sign: f64,                     // +1 turned up, −1 turned down
    pub gamma: f64,                    // how hard to aim
    pub phrase: PhraseSpec,
    pub memo: RenderMemo,              // shared with inner: one render per proposal
}
```

`evaluate` featurizes once through the memo (the inner fitness's render is a
memo hit), and returns `inner + γ·s·(ê · z)`.

`Engine::offer_toward(rng, tree, locks, steps, control, sign)` builds it from
`CONTROLS[control]` and runs `walk_with`. `offer` (the Offer button, Wander)
is unchanged.

### 2. Say what it achieved

The offer reply adds `moved`: `ê · (z(offer) − z(current))` in σ, and
`perform.js` uses it in B's strip ("grittier by 0.8σ", or "no grittier, and
here is why: …" when it is ≤ 0). An offer that did not move the way you
turned is labelled as such rather than presented as the answer.

### 3. γ, measured, not guessed

γ trades aim against taste. Choose it with a census like
`examples/reach_census.rs`: for each preset and each search control, grow N
offers at several γ and record the achieved move along `ê` and the drop in
`E[u]`. Pick the smallest γ that moves most patches at least as far as a
knob-reachable control's `MAX_TRAVEL` would, with a bounded taste cost.

### 4. The guide

When this lands, the guide's "not yet aimed" warning becomes a description of
the aim and of what B's strip says; the reference's PERFORM search page gains
the target and the census.

## Alternatives Considered

- **Filter harder after an undirected walk**: grow several offers and keep
  the one that moved most along `ê`. Simple, but spends renders on offers that
  are thrown away, and a walk that never heads that way yields nothing.
- **More grafts**: a graft exists where one module gives the control a knob
  (`graft_for`). Grit has none that stays transparent (a drive reads as
  Bright; a bitcrusher is transparent only at 16 bits), so search is the only
  honest route there.

## Consequences

- Search controls do what their names say, most of the time, and say so when
  they do not.
- A new constant (γ) with a measured default, quoted by name in the reference.
- The Offer button and Wander are untouched.

## Implementation outline

1. `TiltedFitness` and `offer_toward` in `auracle-session`, with a test that
   on a preset with no drive, `offer_toward(Grit, +1)` moves along Grit's
   direction on average over seeds, and the undirected `offer` does not.
2. The census example; choose γ; record it in the reference.
3. `perform_offer` gains optional `control` and `sign`; the reply gains
   `moved` (a struct reply, per ADR-002).
4. `perform.js`: pass the control and sign from `onRelease`; B's strip reports
   `moved`; a browser spec on a patch where Grit is a search control.
5. Guide and reference updated (the `truth-pass` skill).

## Open questions

- Should repeated turns in the same direction raise γ (asking harder)?
- Should Wander's offer zone aim along the last control the player turned?
