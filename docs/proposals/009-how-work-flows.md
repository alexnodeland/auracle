---
title: "How work flows: from an issue to main, written down once"
number: 9
status: accepted
author: Claude Code
created: 2026-10-05
updated: 2026-10-05
supersedes: null
superseded_by: null
---

# RFC-009: How work flows

## Audience

- **The maintainer,** who asked on 2026-10-05 for the development process to
  be made canonical and every outstanding item to be a GitHub issue.
- **Anyone, person or agent, who builds, reviews or merges a change here.**

## Context

The repository already keeps its reasoning in code, in the principled layout
([`docs/README.md`](../README.md)): proposals argue a change, ADRs record the
rules it sets, plans break it into tasks, architecture pages say how the
system is now, runbooks say what to do when something known breaks.

What it did not keep in one place is how a change moves:

- **The flow was spread out.** Pieces of it were in `CONTRIBUTING.md`
  (branch names, `make check`), `docs/architecture/testing.md` (the CI tiers,
  flakes), the area `AGENTS.md` files, agent definitions, the briefs a lead
  session wrote for its agents, and that session's private notes.
- **Outstanding work lived in prose.** Plans track their tasks in progress
  tables and as-built sections; review follow-ups, unit-test candidates and
  the order of the next PRs were in session notes. GitHub issues held only
  flaky tests. Someone opening the repository could not see what was left.
- **Some rules existed only in conversation.** No retries, and a flaky test
  is fixed or quarantined with an issue. Every `voice.md` row is approved by
  the maintainer before it is committed. Agents commit while the operator
  pushes and merges. Every branch is reviewed before its PR. No date
  estimates in status updates.
- **Some written rules had drifted.** The PR template still asked for
  `make check` "with release tests" as the gate, though CI has been the gate
  since the browser tier outgrew a workstation. `CLAUDE.md` listed a `site`
  skill that does not exist, and the docs index missed ADR-018.

The practice itself worked, and was refined on 2026-10-05 alongside the CI
overhaul (#119, #121): eight browser runners dealt by time, main reusing a
merged PR's verdict, the site deployed from CI's own build.

## Proposal

1. **One living page, [`docs/process.md`](../process.md),** describes the flow
   end to end: the twelve stages from an issue to a closed issue, who does
   each, and where its artifact lives. It changes in the same PR as the
   practice it describes.
2. **Every piece of outstanding work is a GitHub issue.** That covers plan
   tasks, bugs, flakes, review follow-ups and dependency bumps, each with a
   type label, area labels, plan labels and a milestone per plan. Plans keep
   the design and link each task's issue and PR; the issue tracks the work.
3. **The roles are written down.** Builders (agents, contributors) commit on
   their own branch in their own worktree. The operator (the maintainer, or a
   lead session acting for them) pushes, opens the PR, merges and cleans up.
4. **Every branch is reviewed before its PR**, against a written checklist:
   correctness with concrete scenarios, nothing dropped by mouse, keyboard or
   touch, ADR-004 and ADR-012, and spec robustness under the no-retry policy.
   Only the fixes get a second review.
5. **CI is the gate, and the merge is checked:**
   - merge on green only, with `--match-head-commit`;
   - one merge queue, at most two streams of work in flight, never touching
     the same files;
   - a red check is read, then fixed or quarantined, never re-run until it
     passes.
6. **The rules that lived in conversation are written:**
   - the flake policy (no retries; fix, or quarantine with an issue);
   - `voice.md` rows approved by the maintainer, batched into one question;
   - drop no functionality;
   - publishing outside the repository confirmed each time;
   - Dependabot PRs one at a time behind active work;
   - status updates without date estimates;
   - the machine's rules: the browser queue, stopping a process by PID, no
     bare `git stash`.
7. **The tools carry it:**
   - a `ship` skill walks one task from issue to merged PR with the exact
     commands;
   - the agent definitions say what a builder and a reviewer do and hand back;
   - the PR and issue templates (task, flake) ask for what the page requires;
   - the root `AGENTS.md` points at the page in one rule.

## Alternatives considered

- **Keep the flow in `CONTRIBUTING.md`.** It is the human guide, written for
  someone sending a first PR; the operator's and agents' parts would swamp
  it. It links the page instead.
- **Track work in plans only, no issues.** Plans are designs, reviewed and
  accepted once; their task tables went stale between sessions, and
  follow-ups found in review had nowhere to go.
- **A project board.** Issues with labels and milestones answer "what is
  left" without another surface to keep current. A board can be added over
  them later without changing the process.

## Consequences

- What is left is visible in GitHub: open issues by milestone.
- A new session or contributor reads one page to know how a change lands.
- Every PR closes an issue, so the CHANGELOG, the plan and the issue tell the
  same story.
- The process has a cost: an issue per task and a review per branch. Small
  fixes start at an issue (or a failing test) and skip the proposal and plan.

## Decided

Accepted by the maintainer on 2026-10-05: "canonicalize the SDLC process",
with every outstanding item reflected as a GitHub issue and `AGENTS.md` and
the skills updated to match ("do all that"). Recorded as
[ADR-019](../decisions/019-work-flows-through-issues-and-prs.md).
