---
title: "Agent context is layered: AGENTS.md per area, deeper docs in docs/"
number: 6
status: accepted
author: Claude Code
created: 2026-09-28
originating_proposal: null
superseded_by: null
---

# ADR-006: Agent context is layered: AGENTS.md per area, deeper docs in docs/

## Status

Accepted

## Context

Agents working on Auracle need different knowledge in different places: the
φ contract in the features crate, the bench lane in the web app, the browser
queue in the films. A single long root file costs every task its full length
and still misses the details. Several agents worked in parallel during the
film work and each rediscovered the same rules.

## Decision

- A root `AGENTS.md` holds only what every task needs: the map, the rules
  that hold everywhere, the commands, and pointers.
- Each area (`crates/` and each crate, `apps/web`, `tests/web`, `www`,
  `www/video`) has its own `AGENTS.md` with that area's rules. A `CLAUDE.md`
  beside each imports it (`@AGENTS.md`), so Claude Code loads it when working
  there and other agents read the same file.
- Deeper material lives in `docs/` (principled layout: architecture,
  decisions, proposals, plans, runbooks), linked from the area files and from
  skills rather than loaded up front.
- Repeatable procedures are skills (`.claude/skills/`), specialist roles are
  agents (`.claude/agents/`), and rules a machine can check are hooks.

## Options Considered

### Option 1: One large CLAUDE.md

Everything always loaded; drifts; expensive.

### Option 2: Layered context (chosen)

Each task loads what its area needs, and can follow links for more.

## Consequences

### Positive

- Short front door; area rules sit beside the code they govern.
- The same files serve Claude Code and other agents.

### Negative

- More files to keep current. When a rule changes, change it in the area file
  and link the ADR; do not copy it into several files.

## References

- `AGENTS.md`, `CLAUDE.md`, `.claude/`
- [principled](https://github.com/alexnodeland/principled) docs strategy
