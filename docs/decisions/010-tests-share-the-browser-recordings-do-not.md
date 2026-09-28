---
title: "Browser tests share the machine, two at a time; rehearsals and recordings do not"
number: 10
status: accepted
author: Claude Code
created: 2026-09-28
originating_proposal: null
superseded_by: null
---

# ADR-010: Browser tests share the machine, two at a time; rehearsals and recordings do not

## Status

Accepted. Supersedes [ADR-003](003-one-browser-at-a-time.md).

## Context

ADR-003 put every browser job in one first-come, first-served line, to keep a
recording's timings honest. With several people or agents running specs, the
line became the slowest part of the dev loop: a two-minute check waited more
than half an hour behind other suites, although two test runs beside each other
on separate ports disturb nothing that matters to a test.

## Decision

`www/video/tools/one_browser.sh` keeps one first-come, first-served line with
two lanes:

- **exclusive** (the default): rehearsals and recordings run alone, as before.
- **shared**: browser tests (any command running `playwright test`, or
  `BROWSER_LANE=shared`) run up to `BROWSER_SHARED` at once (default 2), never
  beside an exclusive job, each on its own `AURACLE_TEST_PORT`.

A job starts only once everyone ahead of it has started, so neither lane can
starve the other.

## Options Considered

### Option 1: One line, one job (ADR-003)

Honest timings, but tests wait behind tests for no benefit.

### Option 2: No queue for tests

Fast, but a suite beside a recording spoils the take.

### Option 3: Two lanes in one line (chosen)

## Consequences

- Test runs from different worktrees overlap; each must use its own port.
- Timing budget specs may see a second browser beside them; their budgets
  must hold on a shared machine (CI runs them alone).
