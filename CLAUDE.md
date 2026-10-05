@AGENTS.md

## Claude Code in this repo

Everything above is shared with other agents. This part is about the Claude
Code setup in `.claude/`.

### Instructions load by directory

Each area's `CLAUDE.md` imports its `AGENTS.md`, and Claude Code reads it when
you work on files there. Area rules are therefore not repeated here, and they
override nothing above.

### Skills (`.claude/skills/`)

| Skill | Use it to |
| --- | --- |
| `auracle-strategy` | Background: invariants and where knowledge lives (loads itself) |
| `check` | Pick and run the right gates for what changed |
| `wasm` | Rebuild `apps/web/pkg`, and know when it is needed |
| `browser-test` | Run Playwright specs the right way (own port, the browser queue) |
| `truth-pass` | Find every description of a behaviour you changed and make it true |
| `changelog` | Write an `[Unreleased]` entry in the house voice |
| `film` | Make or change a film: script, voice, shots, rehearsal, recording, publishing |
| `ship` | Take one task from its issue to a merged PR: worktree, brief, build, review, PR, CI, merge, clean up ([`docs/process.md`](docs/process.md)) |

### Agents (`.claude/agents/`)

| Agent | Give it |
| --- | --- |
| `engine-engineer` | Changes in `crates/`: the grammar, φ, the taste model, the session engine, the bindings |
| `web-engineer` | Changes in `apps/web`: the instrument's views, worker protocol, audio, MIDI |
| `film-producer` | One film end to end, up to a clean rehearsal |
| `docs-writer` | Guide, reference and landing copy that must match the app |
| `truth-auditor` | Read-only: walk a view or feature against its descriptions and report every gap |
| `reviewer` | Read-only: review a diff against this repo's invariants |

Give agents that change code their own worktree. They commit there and hand
back a report; they never push, open a PR or merge. The session that
coordinates the work (the operator) reviews, pushes, opens the PR and merges
on a green check ([`docs/process.md`](docs/process.md)). The one-browser rule
applies to agents too.

### Hooks (`.claude/hooks/`, wired in `.claude/settings.json`)

- **Session start:** reports whether `apps/web/pkg` is older than the Rust
  sources, and who is waiting in the browser queue.
- **Before an edit:** blocks hand edits to generated paths (`apps/web/pkg/`,
  `site/`, `target/`).
- **After an edit:** formats Rust with `rustfmt` and syntax-checks JS
  (`node --check`) and Python (`py_compile`). A failure comes back to you at
  once, not at `make check` time.
- **Before a Bash command:** `cargo test` on the audio crates without an
  optimized profile is refused, with the right command in the message.

### Plugins

The [principled](https://github.com/alexnodeland/principled) marketplace is
enabled for this project: `principled-docs` (proposals → decisions → plans,
ADR immutability), `principled-architecture` (modules mapped to their ADRs,
drift) and `principled-quality` (spec-driven review checklists). `docs/` follows
its layout, so `/new-adr`, `/new-proposal`, `/new-plan`, `/arch-drift` and
`/review-checklist` work here. User-facing decisions still go in the published
reference; see [`docs/README.md`](docs/README.md) for which record gets what.
