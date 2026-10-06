---
title: "Time in a test: a slow runner may make a test slower, never wrong"
number: 22
status: accepted
author: Claude Code
created: 2026-10-05
originating_proposal: null
superseded_by: null
---

# ADR-022: Time in a test

## Status

Accepted by the maintainer on 2026-10-05 (#177). It amends one sentence that
`.github/workflows/ci.yml` and `docs/architecture/testing.md` both held: "a
failure that only appears on a slow runner is still a finding about the app".
That stays true of correctness and is no longer true of speed.
[ADR-019](019-work-flows-through-issues-and-prs.md)'s flake rules stand: no
retries, and a flaky test is fixed or quarantined.

## Context

About a third of PR runs went red, each time on one browser test, and nearly
always on a timing assumption a slow runner broke. In one hour on 2026-10-05,
two PRs met three of them (#182, #185, #186). The CI runners differ in speed
by about two times: the median boot is 2.6 s on a fast runner and 5.5 s on a
slow one (#177).

The test audit (#178) found 42 measured durations compared with a bound, 19
of them in the gate, and 15 short timeouts used as promises about speed.
Three kinds of claim were mixed together:

- `evolve_ahead`'s "a pick puts the next pair up within 300 ms" (#160) was a
  claim that the swap needs no engine round trip. The app does it in the
  click's own task (`placePair`). CI measured 346 ms once, for main-thread
  jank that had nothing to do with the swap.
- `evolve_truth`'s "opening a patch is not announced" (#186) assumed every
  open on a runner ends inside `OPEN_SAID_MS`. On a slow runner one didn't,
  and the app was right to say so.
- `explain`'s lesson test (#185) read the reply to an early key press and
  compared it with the slider's last position, which a slow runner made it
  meet more often.

Each failure was the machine, not the app. Each red run cost the PR a CI
cycle, about 22 minutes.

## Decision

A timing assertion in a test is one of three kinds, and each has its own
form.

1. **An engine fact.** Wait for the state or the reply that answers your
   request: the lineage written, the undo's own reply, the reply whose token
   is the request's. It is deterministic under `?seed`. The wait is bounded
   by the fixture's engine waits (`app.engine`, `app.reply`), which a slow
   engine makes longer, not wrong.
2. **A promise about the app's own timeline.** Assert it on the app's clock,
   not the runner's:
   - **order instead of milliseconds:** the cards changed in the click's own
     task, no `duel` request went out between the click and the cards
     changing, the sign was up before the edit's reply landed;
   - **the app's own marks:** the open's `waited` (`mark("patch-opened")`)
     decides whether "Opened …" is said;
   - **`page.clock`** for the main-thread windows (`UNDO_WINDOW_MS`,
     `TOAST_STALE_MS` and the like), fast-forwarded rather than waited out,
     in the specs that need it only: it also fakes `performance.now` and
     `requestAnimationFrame`, which the tap and the rack's tweens read;
   - **`AudioContext` time** for what is heard.
3. **A measurement of the machine's speed** ("answers within 6 s", "lit
   within 100 ms"). It is not a gate assertion. It is a budget:
   `budget(name, measured, limit)` in `tests/web/fixtures.js` (`app.budget`
   on the fixture) records it as the test's annotation and never fails on the
   gate. With `AURACLE_PERF=1` it is judged; the nightly *Speed budgets* job
   runs the specs that hold one that way, and files one issue for those over
   their limit.

**A slow runner may make a test slower, never wrong.** A failure that only
appears on a slow runner is still a finding when it is about correctness: a
race the app loses, a state it never reaches. A failure that is only about
how long something took is a budget over its limit, read where budgets are
judged.

## Options Considered

- **Slack on every bound** (1.5 s or more, the rule before this one). Kept
  for what is left of a bound inside a class (a) wait, but it does not settle
  a claim like "at once": a 300 ms promise with 1.5 s of slack promises
  nothing, and a runner slower still fails it.
- **A `@perf` tag moving each speed test out of the gate whole** (#177's
  first plan). Rejected for the tests that also prove an order or a state:
  the gate would lose those. A budget leaves the test in the gate and takes
  only the number out.
- **Retries.** Rejected by ADR-019 and again here: a retry hides the finding
  and charges every run its timeouts.

## Consequences

- A test keeps every assertion about order and state, and loses only its
  milliseconds. The PR that made this change lists each line it converted,
  and what that line asserts now.
- The gate's report shows each budget as an annotation (`budget: <name>
  <measured> ms of <limit> ms`), so a slow run is visible without being red.
- A budget is enforced only where the machine is held still: the nightly
  job, at a fixed `AURACLE_CPU_THROTTLE`. Its issue is about speed, not
  about a flaky test.
- `tests/web/AGENTS.md` says how to write each kind, and `testing.md`
  § Flakes and § Rules point here. A review finding "a spec that a slow
  runner can fail" (ADR-020) now means a correctness assertion with a
  timing assumption, or a speed bound that isn't a budget.
