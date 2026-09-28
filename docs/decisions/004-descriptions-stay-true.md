---
title: "Descriptions stay true, and the app is fixed first"
number: 4
status: accepted
author: Claude Code
created: 2026-09-28
originating_proposal: null
superseded_by: null
---

# ADR-004: Descriptions stay true, and the app is fixed first

## Status

Accepted

## Context

Auracle is described in many places: the guide, the reference, the landing
page, the films' narration and callouts, the in-app copy (toasts, tooltips,
status lines) and the changelog. Making a film of each view meant doing, on
camera, everything the guide says. It found dozens of places where the app
fell short of its description: a control that could never be clicked, a
rename that renamed other styles, a status line that said the controls were
waiting when they were not, a knob label that read backwards. Each could have
been "fixed" by weakening the sentence.

## Decision

- Every change that alters what a player sees or hears updates the
  descriptions of it in the same change.
- When a description and the app disagree, the default is to fix the app, so
  the description becomes true. The words change only when the app is right
  and the words were wrong, or the described behaviour was a mistake.
- Numbers shown in films and docs come from real sessions, and narration does
  not quote numbers that a seed or an engine change can move.

## Options Considered

### Option 1: Descriptions follow the app

Cheap, and the product drifts towards whatever was easiest to build.

### Option 2: The app is fixed toward its descriptions (chosen)

The guide becomes a specification that is exercised; films become acceptance
tests.

## Consequences

### Positive

- The guide, the films and the app agree; filming is a test pass.

### Negative

- A doc or film change can pull in app work. The `truth-pass` skill and the
  `truth-auditor` agent exist to find what describes a behaviour quickly.

## References

- `CHANGELOG.md` § "What the films found"
- [`../architecture/films.md`](../architecture/films.md#readiness)
