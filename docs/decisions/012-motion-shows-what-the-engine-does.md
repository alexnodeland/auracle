---
title: "Motion shows what the engine does"
number: 12
status: accepted
author: Claude Code
created: 2026-09-30
originating_proposal: 6
superseded_by: null
---

# ADR-012: Motion shows what the engine does

## Status

Accepted. Amended by [ADR-025](025-every-interaction-answers-at-once.md) on
2026-10-06: a value the engine predicted and has not yet measured (a wiring,
a filter curve, a forecast) is drawn as a guess, with words that say so,
until its measurement replaces it.

## Context

RFC-006 moves explanation out of sentences and into motion:
- an offer grows out of the sound in hand;
- a child buds from its seed;
- a pick draws the direction it taught.

Motion is also a claim. Prototype v2's first lineage display invented a
parent for each child (the nearest sound), let a replaced sound be played and
brought back, and drew a pick as a ripple from one spot. The engine does none
of those things:
- a child's parent is the seed its walk started from, and the engine records
  it;
- a replaced sound's tree is dropped;
- a pick moves every rating along one direction.

The maintainer: "Make sure that all of this is sound and maps well to the
actual evolution underneath. Don't have animations or interactions just for
the sake of it." ADR-004 already holds words to that standard. This ADR holds
motion to it.

## Decision

- **An animation or interaction that shows a mechanism shows only a fact the
  engine produces.** It reads that fact from the engine's own data, never by
  inferring it in the view. Examples of such data:
  - the lineage events;
  - the posterior;
  - the ranked list;
  - an offer's walk;
  - the pool's admissions and trims.
- **What the engine doesn't record isn't drawn.** If it has to appear, it is
  drawn as a guess: dashed amber, the convention for a guess, with words that
  say so.
- **Each one names its source.** The code that draws a mechanism carries a
  comment naming the engine symbol it shows (`LineageEvent`, `refine_finish`,
  `Engine::offer`). A change to that symbol then finds the animations it
  breaks.
- **Stand-ins are labelled.** A prototype, a film or a demo that can't run the
  engine says which of its motions are stand-ins, and what the engine does
  instead.
- **Decoration doesn't pretend.** Motion that is only feedback (a press, a
  sheet opening, a row settling) is fine as long as it doesn't look like a
  mechanism.

## Options Considered

### Option 1: Motion as decoration

Pretty, and it teaches the wrong model. Rejected by the maintainer.

### Option 2: Explain in words only

That is true, but it is what RFC-004 moved away from, and the maintainer asked
for the mechanism to be shown. Rejected.

### Option 3: Motion bound to the engine's facts (chosen)

It costs a trace for each animation, and some engine data exposed to the web
app: the lineage, the belief after each pick, and the seed count.

## Consequences

- Animations are reviewed like descriptions. A change to the engine checks the
  animations that name it, as ADR-004 checks the guide.
- The web app reads more of the engine. Each piece is already computed (RFC-006,
  "Where each part lands").
- Some proposed motions wait for their facts. A face drawn hollow below the
  sonic floor waits for RFC-005. A replaced sound that can be heard waits for
  the engine to keep its tree.
- `apps/web/AGENTS.md` and `www/AGENTS.md` point here.
