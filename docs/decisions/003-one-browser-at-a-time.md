---
title: "One browser job at a time, first come first served"
number: 3
status: superseded
author: Claude Code
created: 2026-09-28
originating_proposal: null
superseded_by: 10
---

# ADR-003: One browser job at a time, first come first served

## Status

Accepted

## Context

Film rehearsals, recordings and Playwright suites all drive a Chromium running
the full app, render farm and audio engine. Two at once make both late:
rehearsal timings stop predicting recordings, timing assertions fail for the
machine rather than the app, and a recording captures stutters. The first gate
("wait until no footage.mjs is running") was a polling race: a test suite
waited 75 minutes behind a stream of rehearsals that happened to poll at the
right moment. Separately, a suite run from a worktree reused whatever server
answered on :8642, often the main checkout's, and reported on the wrong app.

## Decision

- Every browser job goes through `www/video/tools/one_browser.sh`: each caller
  takes a ticket (its arrival time) and runs when its ticket is the oldest;
  tickets of dead processes are swept.
- A suite run outside the main checkout sets `AURACLE_TEST_PORT`, which starts
  its own server and never reuses one.

## Options Considered

### Option 1: Let jobs run concurrently

Cheaper wall-clock, unreliable results; rejected by experience.

### Option 2: A polling gate

Starves unlucky callers.

### Option 3: A FIFO ticket queue (chosen)

Fair and simple; a crashed job cannot block the queue.

## Consequences

### Positive

- Rehearsals predict recordings; suites fail for app reasons.

### Negative

- Browser work is serial; long rehearsals delay tests. Queue order is the
  only priority.
- A waiter started under the old gate cannot join the queue; restart it.

## References

- `www/video/tools/one_browser.sh`; `tests/web/playwright.config.js`
- [`../runbooks/browser-queue.md`](../runbooks/browser-queue.md)
