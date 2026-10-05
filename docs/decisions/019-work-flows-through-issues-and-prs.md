---
title: "Work flows through issues and reviewed PRs, merged on a green check"
number: 19
status: accepted
author: Claude Code
created: 2026-10-05
originating_proposal: 9
superseded_by: null
---

# ADR-019: Work flows through issues and reviewed PRs

## Status

Accepted by the maintainer on 2026-10-05
([RFC-009](../proposals/009-how-work-flows.md)). The living description is
[`docs/process.md`](../process.md); this record is the decision, and
`process.md` may grow without amending it as long as these rules hold.

## Context

Proposals, ADRs, plans and architecture pages were already kept in the
repository. How a change moved from an idea to `main` was not: it was spread
over `CONTRIBUTING.md`, `testing.md`, area `AGENTS.md` files, agent briefs and
a lead session's notes. Outstanding work lived in plan prose and session notes,
and several rules existed only in conversation. RFC-009 has the details.

## Decision

1. **Every piece of outstanding work is a GitHub issue,** with a type label,
   area labels, a plan label and milestone where it belongs to a plan.
   Plans link their tasks' issues and PRs.
2. **Builders commit; the operator ships.** A change is built on its own
   branch in its own worktree. The builder (an agent or a contributor)
   commits; the operator (the maintainer, or a lead session acting for them)
   pushes, opens the PR, merges and removes the worktree.
3. **Every branch is reviewed before its PR,** against `process.md`'s review
   checklist, and the fixes to its findings are reviewed again.
4. **A PR closes its issue and merges only on a green `CI` check,** squashed,
   with `--match-head-commit`. A red check is read and then fixed or
   quarantined, never re-run until it passes. Nothing merges red without the
   maintainer saying so.
5. **The flow is linear:** one merge queue, at most two streams of work in
   flight and never two on the same files, each branch rebased once before
   its merge.
6. **A flaky test is fixed or quarantined, never retried:** the `flake` issue
   is opened, the test is tagged `@quarantine`, and the fix removes the tag.
7. **Player-facing words wait for the maintainer:** `www/brand/voice.md` rows
   are drafted by the builder and committed once approved
   ([ADR-013](013-one-voice.md)).
8. **Publishing outside this repository is confirmed each time.**

## Options Considered

- **The flow in `CONTRIBUTING.md`.** Kept as the human guide; it links
  `process.md` rather than holding the operator's and agents' parts.
- **Plans as the only tracker.** Rejected: task tables went stale and review
  follow-ups had nowhere to live.
- **Retries on the gate.** Rejected on 2026-10-05: a browser spec's waits run
  to two minutes, so a retry costs minutes and hides a finding; the nightly
  flake hunt finds what a single run misses.

## Consequences

- `docs/process.md` is updated in the same PR as any change to how work
  flows, as an architecture page is with the code.
- The `ship` skill, the agent definitions and the PR and issue templates
  follow `process.md`; when they disagree, `process.md` is right and they are
  fixed.
- Work that cannot be turned into an issue (a decision for the maintainer)
  is asked as a question and recorded where it lands: an ADR, a plan's
  decisions section, or an issue's body.
