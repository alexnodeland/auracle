---
title: "Merge at green, one PR in CI at a time, quarantine an unrelated failure on sight"
number: 20
status: accepted
author: Claude Code
created: 2026-10-05
originating_proposal: null
superseded_by: null
---

# ADR-020: Merge at green, one PR in CI at a time

## Status

Accepted by the maintainer on 2026-10-05 (#158). It amends rule 5 of
[ADR-019](019-work-flows-through-issues-and-prs.md), which rebased a PR on
`main` before its merge whenever `main` had moved. It also adds to rules 4
and 6 what happens at green and when an unrelated test fails on a PR. The
rest of ADR-019 stands.

## Context

On 2026-10-05, ADR-019's flow took an afternoon and three CI cycles to land
two PRs that were each ready on their first run:
- C2b (#152) went green and was not merged. Review fixes were added to it.
- Then the SDLC PR (#149) merged. Under rule 5, that sent both open PRs (#152
  and #155) back to rebase and run CI again.
- Each re-run failed on a test neither PR touched, and each failure was
  root-caused inside the PR before it could move:
  - a guide spec that assumed every random opening sound has a control to
    name;
  - a cable spec that polled for a state shorter than its poll interval.

Each step was the rule working as written:
- green, then more commits;
- the base moves, so rebase;
- the rebase means about 270 browser tests run again on random sounds;
- one flakes, so investigate, push, and run again.

The ruleset does not require a PR to be up to date with `main`
(`strict_required_status_checks_policy: false`). Rule 5 imposed that
requirement by hand, at the cost of a second CI run per merge.

The first draft of this ADR stacked the next PR on the head of the one
ahead before its first run, so that it would merge on that run once the one
ahead landed. Its first use, the same day, showed why it doesn't:
- C2b (#152) was stacked on #155's head, and both runs went green.
- #155 squash-merged, so `main` got one new commit holding #155's changes.
- C2b's branch still carried #155's original commits. Where both PRs had
  changed the same lines (`CHANGELOG.md`'s Unreleased section, the page's
  cache-busters), GitHub's squash merge of C2b found a conflict and refused.
- C2b was rebased onto `main` with the same files, byte for byte, and the
  new head ran CI again. The required check is per commit.

Nearly every PR adds to the top of the Unreleased section, so stacked PRs
nearly always meet there.

## Decision

1. **Merge at green.** A PR whose `CI` is green and which has no blocking
   finding merges then. Nothing more is added to a green PR. A later
   finding, or an improvement seen in passing, becomes an issue or the next
   PR.
2. **Review is one round.**
   - Blocking findings are fixed before the PR, and the fixes are checked:
     - a wrong result;
     - a dropped capability;
     - an untrue description;
     - a spec that can pass vacuously or that a slow runner can fail.
   - Every other finding goes into the PR body as an issue.
   - A brief too big for one round is split before the builder starts.
3. **One PR in CI at a time, unless their files don't meet.**
   - The next PR in a line may be built on the branch of the one ahead, but
     it is pushed only once that one has merged, rebased onto `main` first
     (`git rebase --onto origin/main <the one ahead's last head>`).
   - Its first run then tests what it merges into, and `main`'s run reuses
     that verdict (#121).
   - Two PRs whose files don't meet may be in CI together, each based on
     `main` (rule 4).
4. **Behind `main` is allowed when the files don't meet.** A PR whose files
   no PR merged since its run touches may merge on its run even though
   `main` moved.
   - `main`'s own run then verifies the merged tree in full.
   - A failure there is fixed forward before anything else merges.
   - When the files meet, the PR is rebased and checked again, as before.
5. **An unrelated failure is quarantined on sight.** A PR's run may fail on a
   test that meets all three of these:
   - it is in a file the PR doesn't touch;
   - it fails on behaviour the PR doesn't change;
   - its trace shows a cause outside the PR.

   That test gets one commit on the PR: the `@quarantine` tag, with its
   `flake` issue. The PR goes on, and the root cause is the issue's job. In
   doubt, the failure is the PR's.

## Options Considered

- **Keep rule 5, with retries on the gate.** Rejected. The maintainer's flake
  policy is no retries (ADR-019 rule 6), and a retry would hide the very
  flakes the nightly hunt is there to find.
- **Require up-to-date branches in the ruleset** (GitHub's strict mode).
  Rejected. It enforces rule 5's double run instead of removing it.
- **Stack the next PR on the one ahead before its CI.** Tried and rejected,
  as described in Context: a squash merge breaks the stack wherever the two
  PRs meet, and they nearly always meet in `CHANGELOG.md`. Two changes would
  make it work:
  - CI reusing a verdict on a PR's run when an earlier run passed the same
    tree (today only `main`'s run reuses one);
  - one changelog file per PR, assembled at release.

  Neither is built.
- **A merge queue** (GitHub's). It does what rules 3 and 4 do by hand, and
  it builds each PR on top of the queue ahead of it, so a squash merge
  breaks nothing. Not available: GitHub offers it only to repositories owned
  by an organization, and this one is owned by a person. Moving to an
  organization is #161, after the films.

## Consequences

- A PR's first green run is normally its last. In return, a line of PRs
  goes through CI one after another, not side by side.
- `main` can go red after a merge behind it (rule 4). The full run on `main`
  catches it, and fixing it comes first.
- Quarantine grows faster, and each quarantined test has an issue. The
  *Slow suite* still runs them, and the nightly *Flake hunt* still finds new
  ones.
- PRs get smaller: a brief is sized for one review round.
