---
title: "The gate runs in the queue: a fast lane on the PR, the full gate on the batch that lands"
number: 23
status: accepted
author: Claude Code
created: 2026-10-06
originating_proposal: null
superseded_by: null
---

# ADR-023: The gate runs in the queue

## Status

Accepted by the maintainer on 2026-10-06 (#177). It amends
[ADR-021](021-merges-go-through-mergifys-queue.md):
- its rule 1 (one PR at a time, checked in place on the PR's own branch,
  rebased onto `main` when `main` has moved) gives way to batches of up to
  three PRs, checked on a draft PR of the queue's own;
- its rule 2 changes in what a PR's `CI` means: a green fast lane enters the
  queue, and the full gate's green on the batch merges it;
- its consequences about a second run when `main` moved, and about the queue
  force-pushing a PR's branch, no longer hold.

ADR-021's rules 3 and 4 stand: no retries, and a merge by hand only when
Mergify is down. So do [ADR-020](020-merge-at-green-one-pr-in-ci.md)'s rules
1, 2 and 5: merge at green, one review round, quarantine an unrelated failure
on sight.

## Context

Under ADR-021 every PR ran the full gate on its own branch: Lint, Web, Site,
Browser smoke, the Rust tests and their coverage, and the browser tier on
twelve runners, 16 to 19 jobs and about twelve minutes. When `main` had moved
by the time the PR reached the front of the queue, the queue rebased it and
ran all of it again. The builder and the reviewer waited on the first run and
the queue on the second, and each run held most of the account's 20 runners,
so a second PR's run queued behind it (#177).

What a PR's own run is for is quick word on what it changed. What `main` needs
is one full verdict on the tree that lands. The first can be small; only the
second has to be everything.

## Decision

1. **Two lanes in one workflow** (`ci.yml`; its `changes` job picks the lane):
   - **A PR's own run is the fast lane:** Lint, Coverage (the Rust tests) and
     the Doctests when Rust changed; Web and Site when the site, the docs or
     the app changed; Browser smoke when the app, the engine or what runs the
     specs changed; and the browser specs the change reaches
     (`tests/web/changed.mjs`), one runner per file, up to four. A change
     whose specs can't be told (`main.js`, `worker.js`, a crate) runs the
     smoke only. A change to CI itself runs the full gate. A green fast lane
     says the PR is fit to queue, not that it can merge.
   - **The queue's run is the full gate:** everything, as on `main`, with the
     browser tier on twelve runners, on the tree the batch makes on top of
     `main`. The browser tier runs the smoke's two specs itself, so there is
     no Browser smoke job there.
2. **The queue checks batches on a draft PR** (`.mergify.yml`):
   - up to three queued PRs in one batch, which waits at most three minutes
     for company; serial, one batch checked at a time;
   - a PR enters on its fast lane's green `CI`;
   - the batch merges on `Full gate`, a check only the queue's run has. It is
     not `CI`, because Mergify takes a queue whose merge conditions match its
     queue conditions for a one-step queue and then merges a PR already on
     `main`'s tip on its own run, with no draft PR;
   - each PR is squash-merged on its own, `<title> (#<number>)` as before.
     The ruleset's required `CI` is met by each PR's own head, which carries
     its green fast lane.
3. **A red batch is split, and the PR at fault leaves the queue.** Mergify
   splits a failed batch and tests the parts, the first part first; a part
   that passes merges, and one that fails is split again. A PR that fails on
   its own is the one at fault: it gets the `dequeued` label and Mergify's
   comment says why. The others go on. Mergify's automatic retries stay off.
4. **One full run per batch on `main` too.** `main` reuses the queue run's
   record when its tree is the tree the queue tested, which is the last merge
   of every batch. `main` and the Slow suite keep the latest run only: a run
   in progress finishes, the newest waiting run replaces any older one, and a
   run whose commit `main` has already moved past runs nothing.
5. **A fix to CI or a flake goes first:** the `priority` label puts a PR at
   the front of the queue, into the next batch.
6. **The plain Test jobs fold into Coverage**, which runs the same tests
   instrumented, and the doctests get a job of their own.

## Options Considered

- **Keep the full gate on every PR (ADR-021 as it stood).** Rejected: two
  full runs for most PRs, and the slowest answer exactly when the builder is
  waiting for one.
- **The full gate on the queue, one PR at a time.** Each PR's queue run would
  still be a full run on a draft PR. Batching two or three makes it one full
  run per batch, and the maintainer chose batching.
- **Speculative checks (`max_parallel_checks` above one).** Each would hold
  another full gate's runners, and the account runs at most 20 jobs at once.
  GitHub Pro is declined for now (#177).
- **Narrow the queue's run by what the batch changed.** `main` would then run
  what the queue skipped, after every merge. Running everything once, where
  it decides the merge, keeps `main`'s runs to the deploy.
- **The title's type (`ci`, `fix(tests)`) for priority.** PR titles here say
  the outcome and carry no type, so a label is the simpler rule.

## Consequences

- **A PR can be green on its own run and red in the queue.** Its batch is
  split, the PR at fault is dequeued and says why, and the operator reads the
  red run on the draft PR. Flakes are rare now (#177), so a split is seldom
  spent on one; when it is, every part passes and merges, and the batch's red
  run is read and the test quarantined like any flake. Each part of a split is
  another full run, so a red batch of three costs two or three.
- **A PR's first answer is minutes sooner,** and its second, the queue's,
  covers up to three PRs at once.
- **The queue no longer pushes to a PR's branch.** A worktree fixing a
  dequeued PR builds on its own last push.
- **A PR that conflicts with one ahead of it in the queue is held**, not
  dequeued, until that one merges; then it leaves the queue to be rebased by
  hand. A conflict with `main` itself dequeues it at once.
- **The fast lane is not the gate.** A builder still runs the specs a change
  reaches locally (`make browser-changed`), and a `main.js` change gets only
  the smoke before the queue. A view-to-spec map for `main.js` would narrow
  that gap (#177, wave 2).
- **`main` reuses the queue's verdict on every batch's last merge.** The
  batch's earlier merges are never tested alone, as with any batch; their run
  runs nothing once `main` has moved past them. The browser tier's timings
  come from the queue's run, saved by `main`'s.
