---
name: Flaky test
about: A test that passes on some runs and fails on others
labels: flake, area:tests
---

<!-- Title: Flaky: <file> '<test title>'
     docs/process.md § Flakes: fix it, or tag it @quarantine (with a comment
     naming this issue) and label this issue `quarantined`. -->

## The test

`tests/web/<file>.spec.js:<line>`: <title>

## Where it failed

<!-- The run (link), the runner, the commit, and the failing assertion as
     the log or the run's merged report shows it. Say whether the change
     under test touched the app. -->

## Why

<!-- The cause, or the best-supported guess and what would confirm it: a
     wait on a time, an injected reply the engine overwrote, a count a slow
     runner doubled, a bound with no slack, a real race in the app. -->

## Fix

<!-- To the app (preferred when the app is at fault) or to the test. -->

## Quarantined?

- [ ] Tagged `@quarantine` in the spec, with a comment naming this issue
