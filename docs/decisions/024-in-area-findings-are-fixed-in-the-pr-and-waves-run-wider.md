---
title: "A review's in-area findings are fixed in the PR, and a wave runs more than two streams"
number: 24
status: accepted
author: Claude Code
created: 2026-10-06
originating_proposal: null
superseded_by: null
---

# ADR-024: In-area findings are fixed in the PR; a wave runs more than two streams

## Status

Accepted by the maintainer on 2026-10-06 (#177), in the day's waves. It
amends two rules:

- [ADR-020](020-merge-at-green-one-pr-in-ci.md)'s rule 2, which sent every
  finding but a blocking one into the PR body as an issue. Review is still
  one round, and its blocking findings are still fixed and checked again
  before the PR. ADR-020's rules 1 and 5 stand: nothing is added to a green
  PR, and an unrelated failure is quarantined on sight.
- [ADR-019](019-work-flows-through-issues-and-prs.md)'s rule 5, which kept
  at most two streams of work in flight. One merge queue, and never two
  streams on the same files, stand. So does the rest of ADR-019.

## Context

On 2026-10-06 the backlog was cleared in waves: a triage chose items that
shared no file, a saved workflow built, reviewed, fixed and finalized each
on its own branch, and the operator shipped them through the merge queue.
Up to four PRs were in flight at once (W8's four).

**The findings.** Builders listed open items, and reviewers found should-fix
findings and nits, that were in the area the branch already touched: an
in-area bug, a flaky or vacuous test, a description left untrue. Under
ADR-020 rule 2 each became an issue, which meant a second branch, a second
review and a second CI run for a fix the builder had in hand, and a backlog
that grew by the follow-ups of the PRs that were meant to shrink it. The
maintainer chose to have them fixed in the same PR.

ADR-020's reason for rule 2 was that a branch that grows runs CI again, and
every run was a roll of the flaky dice. Review happens before the PR is
opened (ADR-019 rule 3), so a fix made in review adds no run; what does add
one is a commit after the PR is open, and that stays forbidden (ADR-020
rule 1). Flakes are rare now, too (ADR-022, ADR-023).

**The streams.** ADR-019 rule 5's limit of two dates from when the operator
kept one PR in CI at a time by hand (ADR-020 rule 3) and judged whether two
PRs' files met. Since ADR-021 and ADR-023 the queue does both: it tests each
batch on top of `main`, holds a PR that conflicts with one ahead of it, and
takes out one that conflicts with `main`. What more streams cost is a
rebase, mostly of docs table rows, which `scripts/ops/rows_resolve.py`
resolves. Browser jobs still share the machine through one queue
([ADR-010](010-tests-share-the-browser-recordings-do-not.md)).

## Decision

1. **A review's in-area findings are fixed in the PR.** Every finding in what
   the branch touches (blocking, should-fix, a nit) is fixed on the branch in
   the review's one round, before the PR, and so is in-area work the builder
   listed as left open. Only two kinds leave the PR, each as an issue named
   in its body: a choice only the maintainer can make, and work in an area
   the branch doesn't touch. A finding declined is said in the PR body with
   its reason. The blocking fixes, not the whole branch, get a second look.
2. **A wave runs more than two streams.** By hand, at most two streams are in
   flight. A wave the maintainer asks for runs one stream per item, each on
   files no other item of the wave touches; there is still one merge queue,
   and never two streams on the same files.

## Options Considered

- **Every non-blocking finding as an issue (ADR-020 rule 2 as it stood).**
  Rejected by the maintainer: a second PR for a fix in hand, and a backlog
  that grows from its own clearing.
- **Fix every finding, another area's too.** Rejected: a branch that reaches
  into another area grows its review and its conflicts. That work is an
  issue, and an issue the next wave can take.
- **Keep two streams for waves too.** Rejected: the queue already does the
  work the limit stood in for (Context), and the maintainer ran the day's
  waves wider.

## Consequences

- A review round is bigger and a PR leaves fewer follow-ups behind. The
  `ship-issues` workflow's fix stage takes every blocking and should-fix
  finding, the nits and the in-area open items; its open items carry a kind
  (`in_area`, `decision`, `other_area`, `note`), and an `in_area` one left
  in the final report keeps the item from `ready`.
- A wave's PRs meet more often in the same rows (testing.md's tables, the
  Makefile's `DEV_CHECKS`), so a batch holds one PR fewer and the second is
  rebased by hand, with diff3 and `rows_resolve.py`.
- A wave's PRs are no less tested: the queue's full gate runs on each batch
  on top of `main`, as for any PR.
- `docs/process.md` § Review and § CI and merging (*Linear*), and the `ship`
  and `ship-wave` skills, say these rules.
