# docs: for people and agents working on Auracle

This directory is for working **on** Auracle. What the instrument does and how
it works, for players and curious readers, is the site in `www/` (the guide and
the technical reference). Nothing here is published.

It follows the [principled](https://github.com/alexnodeland/principled)
documentation layout, so the `principled-docs` and `principled-architecture`
plugins work on it.

| Directory | Holds | Changes |
| --- | --- | --- |
| [`architecture/`](architecture/) | How the system fits together, as it is now | Living: kept current with the code |
| [`decisions/`](decisions/) | ADRs: an engineering decision, its context and its consequences | Immutable once accepted; superseded, never edited |
| [`proposals/`](proposals/) | RFCs: a change worth deciding before building | `draft → in-review → accepted / rejected / superseded` |
| [`plans/`](plans/) | How an accepted proposal gets built, decomposed into tasks | `active → complete / abandoned` |
| [`runbooks/`](runbooks/) | What to do when a known thing breaks | Living |
| [`notes/`](notes/) | Design reviews, working specs and measurements that informed decisions | A record: dated, not kept current |

## Which record gets what

- **A user-facing design choice** (why duels and not ratings, why the phrase
  is five seconds): the published
  [design decisions](../www/reference/src/design/decisions.md) in the
  reference, where players and reviewers read it.
- **An engineering rule contributors must keep** (every consumer has its own
  random stream, trees serialize in declaration order): an ADR here, and a
  one-line rule in the `AGENTS.md` of the area it governs, linking to the ADR.
- **A change big enough to argue about first** (parallel evolution walks,
  directed search): a proposal here. When it is accepted, the ADR records the
  decision and a plan breaks it down.
- **Something that went wrong and will again** (the disk filled mid-render,
  the wasm engine panicked): a runbook.

## Architecture

- [`system.md`](architecture/system.md): the engine, from a patch drawn to a
  pick learned to a generation bred, and adding a module
- [`web-runtime.md`](architecture/web-runtime.md): the app's threads, the
  worker's lanes, the bench lane, PERFORM, audio
- [`testing.md`](architecture/testing.md): every gate, what it proves and when
  to run it
- [`films.md`](architecture/films.md): how a film goes from script to the site

## Decisions

| ADR | Decision |
| --- | --- |
| [001](decisions/001-one-random-stream-per-consumer.md) | Every consumer of randomness has its own stream |
| [002](decisions/002-trees-serialize-in-declaration-order.md) | Patch trees serialize from their types, in declaration order |
| [003](decisions/003-one-browser-at-a-time.md) | One browser job at a time, first come first served |
| [004](decisions/004-descriptions-stay-true.md) | Descriptions stay true, and the app is fixed first |
| [005](decisions/005-tests-run-optimized.md) | Rust tests run in an optimized profile |
| [006](decisions/006-layered-agent-context.md) | Agent context is layered: AGENTS.md per area, deeper docs here |
| [007](decisions/007-generations-breed-in-parallel.md) | A generation breeds its walks in parallel, absorbed in job order |
| [008](decisions/008-search-offers-are-aimed.md) | A search control's offer is aimed along the control's direction |

## Proposals

| RFC | Status | Proposal |
| --- | --- | --- |
| [001](proposals/001-evolve-pool-parallel-walks.md) | accepted | Breed a generation in seconds: walks in parallel on the render farm |
| [002](proposals/002-directed-search-offers.md) | accepted | Aim PERFORM's search-control offers along the control's direction |

## Plans

| Plan | Status | Implements |
| --- | --- | --- |
| [001](plans/001-evolve-pool-parallel-walks.md) | active | RFC-001, ADR-007 |
| [002](plans/002-directed-search-offers.md) | active | RFC-002, ADR-008 |

## Notes

- [`musical-instrument-review.md`](notes/musical-instrument-review.md): the
  design review that set the direction for PERFORM and the four views
- [`ui-hierarchy.md`](notes/ui-hierarchy.md): the working spec for the layout
  pass that added PERFORM
- [`interaction-2026-09/`](notes/interaction-2026-09/README.md): six
  interaction reviews (119 findings, measured) and the spec that combines them:
  rules, time budget, contracts for words, colour, undo, messages and keys
- [`plugin-lab/`](notes/plugin-lab/README.md): named controls measured on a
  third-party synth, a feasibility study for a plugin

## Runbooks

- [`wasm-engine-poisoned.md`](runbooks/wasm-engine-poisoned.md): "recursive use of an object", "memory access out of bounds"
- [`stale-wasm.md`](runbooks/stale-wasm.md): the app runs old engine code
- [`disk-full.md`](runbooks/disk-full.md): no space left, mid-build or mid-render
- [`film-shot-fails.md`](runbooks/film-shot-fails.md): a rehearsal shot errors or runs late
- [`browser-queue.md`](runbooks/browser-queue.md): a browser job waits forever
