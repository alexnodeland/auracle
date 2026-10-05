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
2. **Agents commit; the operator ships.** A change is built on its own
   branch in its own worktree. An agent commits there and never pushes,
   opens a PR or merges; the operator (the maintainer, or a lead session
   acting for them) pushes it, opens the PR, merges and removes the worktree.
   A human contributor pushes their own branch or fork and opens their own
   PR, which the maintainer reviews and merges.
3. **Every branch an agent builds is reviewed before its PR** (a human
   contributor's PR is reviewed by the maintainer on the PR), against
   `process.md`'s review checklist, and the fixes to its findings are reviewed
   again.
4. **A PR merges only on a green `CI` check,** squashed, with
   `--match-head-commit`, and closes the issues it finishes. Most PRs have
   one; a Dependabot bump or a small fix seen in passing may stand alone. A
   red check is read and then fixed or quarantined, never re-run until it
   passes. `main`'s ruleset requires `CI` with no bypass actor, admins
   included; only the maintainer, by editing the ruleset, can let anything
   else merge.
5. **The flow is linear:** one merge queue, at most two streams of work in
   flight and never two on the same files. While building or in review a
   branch is rebased only to resolve a conflict. Before its merge, a PR that
   touches the app, the tests, the crates or CI is rebased on `main` if
   `main` moved since its CI run, pushed with `--force-with-lease`, and
   merged at the new head once its CI is green; a PR that changes only docs
   may merge behind `main`, whose own run then verifies it in full.
6. **A flaky test is fixed or quarantined, never retried:** the `flake` issue
   is opened, the test is tagged `@quarantine`, and the fix removes the tag.
7. **New words wait for the maintainer:** a new term, label or phrase that
   `www/brand/voice.md`'s word table governs gets a row, drafted by the
   builder and committed once the maintainer approves it
   ([ADR-013](013-one-voice.md)). Sentences written in the existing words need
   no row.
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
