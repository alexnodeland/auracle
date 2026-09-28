---
name: auracle-strategy
description: >
  Background knowledge for working on Auracle: the invariants that hold
  everywhere, which document answers which question, and which skill or agent
  to use. Consult at the start of any non-trivial change in this repo, or when
  unsure where knowledge lives.
user-invocable: false
---

# Working on Auracle: where knowledge lives

Auracle's context is layered (ADR-006). Load only what the task needs.

## Start here

1. The root `AGENTS.md`: the map, the eight rules, the commands.
2. The `AGENTS.md` of the area you are changing (Claude Code loads it with the
   directory's `CLAUDE.md`): `crates/`, each crate, `apps/web`, `tests/web`,
   `www`, `www/video`.
3. Follow its links into `docs/` only for what the task touches.

## Which document answers what

| Question | Read |
| --- | --- |
| How does a patch become a learned taste? | `docs/architecture/system.md` |
| Why is the worker answering in this order? How does the bench lane work? | `docs/architecture/web-runtime.md` |
| Which tests prove this? What should I run? | `docs/architecture/testing.md`, or the `check` skill |
| How is a film made? | `docs/architecture/films.md`, or the `film` skill |
| Why is it built this way (engineering)? | `docs/decisions/` |
| Why is it built this way (product, for players)? | `www/reference/src/design/decisions.md` |
| Something broke in a known way | `docs/runbooks/` |
| What does the app say it does? | `www/docs/src/views/*.md`, the films, the in-app copy |

## Invariants that catch people out

- φ is a contract: phrase, features, normalization, vetting. `make revalidate`.
- Rust tests run with `--profile test-fast`.
- `make wasm` after Rust the app calls; `pkg/` is generated.
- Trees serialize from their types, never through `json!` (ADR-002).
- Every consumer of randomness has its own stream (ADR-001).
- Every worker request gets a reply; gestures go in the `now` lane.
- One browser job at a time, through `one_browser.sh`; suites from worktrees
  on their own port (ADR-010).
- Descriptions stay true, and the app is fixed first (ADR-004).

## Skills and agents

Skills: `check`, `wasm`, `browser-test`, `truth-pass`, `changelog`, `film`,
`site`. Agents: `engine-engineer`, `web-engineer`, `film-producer`,
`docs-writer`, `truth-auditor`, `reviewer`. The root `CLAUDE.md` says when to
use each. Record a new engineering decision with `/new-adr` (principled-docs)
and a change worth arguing about first with `/new-proposal`.
