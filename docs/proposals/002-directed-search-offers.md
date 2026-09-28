---
title: "Aim PERFORM's search-control offers along the control's direction"
number: 2
status: draft
author: Claude Code
created: 2026-09-28
updated: 2026-09-28
supersedes: null
superseded_by: null
---

# RFC-002: Aim PERFORM's search-control offers along the control's direction

## Audience

Anyone changing PERFORM (`crates/auracle-session/src/perform.rs`,
`Engine::offer`, `apps/web/perform.js`).

## Context

A named control no knob in the patch reaches is a *search control*: turning it
asks for an offer. Today the offer is a locked walk toward taste, and the
control's direction only selects which offers are kept. A player turning
Grit up hears offers that are better by taste but not reliably grittier.

## Proposal

Tilt the walk's target toward the control's direction:
`π ∝ p_grammar · exp(β·E[u] + γ·ê·z)`, where `ê` is the control's direction
in standardized φ, `z` the candidate's standardized φ, and γ scales with how
far the control is turned. Report the achieved move along `ê` with the offer,
so the B strip can say "grittier by …".

## Alternatives Considered

- **Filter harder after an undirected walk**: wastes renders on offers that
  are then thrown away.
- **Graft a module that reaches the direction**: already done where a graft
  exists (`graft_for`); the search is for patches where none does.

## Consequences

- Search controls do what their names say more often.
- A new knob to tune (γ), measured with a reach census
  (`examples/reach_census.rs`).

## Open questions

- Should γ grow with repeated turns in the same direction?
