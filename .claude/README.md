# .claude: the Claude Code setup

The skills, subagents, hooks and plugins this repo gives Claude Code. Every
agent's rules are in the `AGENTS.md` files (the root one is the front door);
this page is the detail behind its *Tooling* section.

## Instructions load by directory

Each area's `CLAUDE.md` imports its `AGENTS.md`, and Claude Code reads it when
you work on files there. Every `CLAUDE.md`, the root one too, is that one
line: the rules are in the `AGENTS.md` files, which other agents read as well.

## Skills (`.claude/skills/`)

| Skill | Use it to |
| --- | --- |
| `auracle-strategy` | Background: invariants and where knowledge lives (loads itself) |
| `check` | Pick and run the right gates for what changed |
| `wasm` | Rebuild `apps/web/pkg`, and know when it is needed |
| `browser-test` | Run Playwright specs the right way (own port, the browser queue) |
| `truth-pass` | Find every description of a behaviour you changed and make it true |
| `changelog` | Write an `[Unreleased]` entry in the house voice |
| `film` | Make or change a film: script, voice, shots, rehearsal, recording, publishing |
| `ship` | Take one task from its issue to a merged PR: worktree, brief, build, review, PR, CI, merge, clean up ([`docs/process.md`](../docs/process.md)) |

## Agents (`.claude/agents/`)

| Agent | Give it |
| --- | --- |
| `engine-engineer` | Changes in `crates/`: the grammar, φ, the taste model, the session engine, the bindings |
| `web-engineer` | Changes in `apps/web`: the instrument's views, worker protocol, audio, MIDI |
| `film-producer` | One film end to end, up to a clean rehearsal |
| `docs-writer` | Guide, reference and landing copy that must match the app |
| `truth-auditor` | Read-only: walk a view or feature against its descriptions and report every gap |
| `reviewer` | Read-only: review a diff against this repo's invariants |

Every agent runs on Opus (`model: opus` in its frontmatter). Give agents that
change code their own worktree. They commit there and hand back a report;
they never push, open a PR or merge. The session that
coordinates the work (the operator) reviews, pushes, opens the PR and merges
on a green check ([`docs/process.md`](../docs/process.md)). The one-browser rule
applies to agents too.

## Hooks (`.claude/hooks/`, wired in `.claude/settings.json`)

- **Session start** (`session-start.sh`): says when `apps/web/pkg` has no
  built engine, or is older than the Rust it is built from (a `.rs` file under
  `crates/`, a crate's `Cargo.toml`, or `Cargo.lock`); and how many jobs wait
  in the browser queue and whether a film's `footage.mjs` is running. It never
  fails the session.
- **Before an edit** (`guard-generated.sh`, on Edit, Write and MultiEdit):
  refuses a hand edit under any of the five generated paths, saying what
  writes each: `apps/web/pkg/` (`make wasm`), `site/` (`make site`), `target/`
  (cargo), `www/docs/src/img/` (a copy of the landing page's screenshots) and
  `www/landing/assets/film/` (`publish.py`).
- **After an edit** (`post-edit-check.sh`, on Edit, Write and MultiEdit):
  `rustfmt` on a `.rs` file; `node --check` on `.js`, `.mjs` and `.cjs` (as an
  ES module under `apps/web/`, which also catches a backtick inside
  `live-audio.js`'s `PROCESSOR`); `py_compile` on `.py`; `json.tool` on
  `.json`; `bash -n` on `.sh`. It skips `target/`, `node_modules/` and
  `apps/web/pkg/`. A failure comes back to you at once, not at `make check`
  time.
- **Before a Bash command** (`guard-bash.sh`): refuses `cargo test` on any
  crate without `--release`, `--profile` or `--doc` (use
  `--profile test-fast`), and refuses `playwright test` outside
  `one_browser.sh` (a `--list` and `make smoke` are let through). Each refusal
  says the right command.

`.claude/checks/test_hooks.sh` runs the hooks against inputs they must block
and pass (`make dev-check`).

## Plugins

The [principled](https://github.com/alexnodeland/principled) marketplace is
enabled for this project: `principled-docs` (proposals → decisions → plans,
ADR immutability), `principled-architecture` (modules mapped to their ADRs,
drift) and `principled-quality` (spec-driven review checklists). `docs/` follows
its layout, so `/new-adr`, `/new-proposal`, `/new-plan`, `/arch-drift` and
`/review-checklist` work here. User-facing decisions still go in the published
reference; see [`docs/README.md`](../docs/README.md) for which record gets what.
