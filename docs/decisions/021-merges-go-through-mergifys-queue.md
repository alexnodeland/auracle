---
title: "Merges go through Mergify's queue"
number: 21
status: accepted
author: Claude Code
created: 2026-10-05
originating_proposal: null
superseded_by: null
---

# ADR-021: Merges go through Mergify's queue

## Status

Accepted by the maintainer on 2026-10-05 (#177). It amends
[ADR-020](020-merge-at-green-one-pr-in-ci.md): its rules 3 and 4 (one PR in
CI at a time, kept by hand; merging behind `main` when the files don't meet)
give way to the queue. ADR-020's rules 1, 2 and 5 stand: merge at green, one
review round, quarantine an unrelated failure on sight. In
[ADR-019](019-work-flows-through-issues-and-prs.md), the operator's part now
ends at enqueueing (rule 2), and the queue's merge takes the place of
`--match-head-commit` (rule 4), which stays the way to merge by hand. The rest
of ADR-019 stands.

## Context

Under ADR-020 the operator did the merge flow by hand (#161 lists it):
- held the next PR in a line until the one ahead merged, then moved it onto
  `main` (`git rebase --onto`) before its first run;
- decided whether a PR's files met what had merged since its run: if not, it
  merged behind `main`; if so, it was rebased, pushed and run again;
- waited on CI in a loop, and merged on green with `--match-head-commit`;
- moved a PR again when the one ahead of it changed.

Each step was a place to be slow or wrong. Merging behind `main` also meant
`main` could go red after a merge, and fixing it came first (ADR-020,
Consequences).

A merge queue does this work. GitHub's needs a repository owned by an
organization, and this one is owned by a person; moving it is #161, after the
films. Mergify's queue is free for open source and works on a repository owned
by a person, and the maintainer has installed its app.

The tradeoff:
- **The cost.** The queue brings a PR up to date with `main` and runs `CI`
  there. A PR whose base moved after its own run runs CI twice.
- **What it buys.** Nothing lands untested on top of what merged ahead of
  it, and nobody has to judge whether two PRs' files meet. A PR that is
  already on `main`'s tip merges on its own green run.

## Decision

1. **A PR merges through Mergify's queue** (`.mergify.yml`):
   - one queue, one PR at a time;
   - checked in place, on the PR's own branch;
   - rebased onto `main` when `main` has moved, and checked again there;
   - squash-merged as `<title> (#<number>)`, with the PR's body.
2. **The operator enqueues and stops.** A reviewed PR is opened with the
   `queue` label, or gets `@mergifyio queue`. It enters the queue once its
   `CI` is green, and the queue merges it.
3. **A failure leaves the queue and isn't retried.** Mergify's automatic
   retries stay off. A red run is read, then fixed or quarantined (ADR-020
   rule 5); the PR goes back in with `@mergifyio queue`.
4. **By hand only when the queue can't.** If Mergify is down, the operator
   merges at green with `gh pr merge --squash --match-head-commit`, a PR that
   is up to date with `main`. `main`'s ruleset still requires `CI` either way.

## Options Considered

- **Keep ADR-020's rules by hand.** Rejected: the operator's judgement was the
  slow and fallible part (#161).
- **GitHub's merge queue.** Not available to a repository owned by a person
  (#161).
- **Batches or speculative checks.** Rejected for now. Each check would run
  on a draft PR on a queue branch, a second run of every PR even when `main`
  hasn't moved, and the account runs at most 20 jobs at once (#177). In place,
  one at a time, the PR's own run is the check.
- **Update by merging `main` into the PR.** It would keep `main` linear too,
  since a squash makes no merge commit. Rebasing keeps the branch a straight
  line of the builder's commits on `main`.

## Consequences

- A PR's first green run is its last unless `main` moved under it.
- Every merge is a tree the queue tested, so `main`'s run reuses the PR's
  verdict (#121) every time, not only when nothing merged in between.
- The queue force-pushes a PR's branch when it rebases it. A worktree resets
  to the remote branch before a fix is committed.
- Two PRs that both edit the top of `CHANGELOG.md`'s Unreleased section
  conflict when the second is rebased, and it leaves the queue until it is
  rebased by hand. One changelog file per PR (#177, 5.2) removes that.
- Mergify is a service outside the repository. When it is down, merges wait
  or are made by hand (rule 4).
