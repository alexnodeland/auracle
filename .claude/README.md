# .claude: the Claude Code setup

The skills, subagents, hooks and plugins this repo gives Claude Code. Every
agent's rules are in the `AGENTS.md` files (the root one is the front door);
this page is the detail behind its *Tooling* section.

## Instructions load by directory

Each area's `CLAUDE.md` imports its `AGENTS.md`, and Claude Code reads it when
you work on files there. Every `CLAUDE.md`, the root one too, is that one
line: the rules are in the `AGENTS.md` files, which other agents read as well.

A session in a worktree (`.claude/worktrees/<topic>`, inside the main
checkout) loads its worktree's files and, from an ancestor directory, the
main checkout's root `CLAUDE.md` (and the `AGENTS.md` it imports). The main
checkout is kept on `main` and current, so the two agree; where they differ,
the worktree's own is the one to follow
([`docs/process.md` § Building](../docs/process.md#building)).

## Worktrees (`.claude/worktrees/`)

Every branch's worktree lives here, inside the main checkout, and git
ignores the directory: `make worktree TOPIC=<topic>` makes one (branch
`claude/<topic>` from `origin/main`, with `tests/web`'s packages) and
`make worktree-rm TOPIC=<topic>` removes it and its branch once merged. Claude
Code puts the worktrees it makes itself here too (a subagent's
`isolation: worktree`, `EnterWorktree`, `claude --worktree`). Each is a
checkout of its own, with its own `target/`, `apps/web/pkg/` and
`node_modules/`; the checks and the hooks below never read from one checkout
into another. The hooks and settings are the session's: an agent that a
session in the main checkout starts in a worktree runs the main checkout's
`settings.json` and hooks (`$CLAUDE_PROJECT_DIR`), so a branch that changes
them is live in its worktree only once it merges and the main checkout is
fast-forwarded. Before that, `make dev-check` tries the branch's own
(`.claude/checks/test_hooks.sh`).

## Skills (`.claude/skills/`)

| Skill | Use it to |
| --- | --- |
| `auracle-strategy` | Background: invariants and where knowledge lives (loads itself) |
| `check` | Pick and run the right gates for what changed |
| `wasm` | Rebuild `apps/web/pkg`, and know when it is needed |
| `browser-test` | Run Playwright specs the right way (own port, the browser queue) |
| `truth-pass` | Find every description of a behaviour you changed and make it true |
| `changelog` | Write a change's entry as `changelog.d/<topic>.md`, in the house voice |
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
change code their own worktree, under `.claude/worktrees/`. They commit there
and hand back a report; they never push, open a PR or merge. The session that
coordinates the work (the operator) reviews, pushes and opens the PR in the
merge queue, which merges it once the full gate is green on its batch
([`docs/process.md`](../docs/process.md)). The one-browser rule applies to
agents too.

## Hooks (`.claude/hooks/`, wired in `.claude/settings.json`)

- **Session start** (`session-start.sh`): says when `apps/web/pkg` has no
  built engine, is older than the Rust it is built from (a `.rs` file under
  `crates/`, a crate's `Cargo.toml`, or `Cargo.lock`), or is a quick
  `make wasm-dev` build or an unfinished one (a build that failed or was
  stopped), which the browser specs and the films refuse, in the checkout the
  session's directory is in, a worktree's own when it is in one; and how many
  jobs wait in the browser queue and whether a film's `footage.mjs` is
  running. It never fails the session.
- **Before an edit** (`guard-generated.sh`, on Edit, Write and MultiEdit):
  refuses a hand edit under any of the five generated paths of the file's
  own checkout (a worktree under `.claude/worktrees/` included), saying what
  writes each: `apps/web/pkg/` (`make wasm`), `site/` (`make site`), `target/`
  (cargo), `www/docs/src/img/` (a copy of the landing page's screenshots) and
  `www/landing/assets/film/` (`publish.py`).
- **After an edit** (`post-edit-check.sh`, on Edit, Write and MultiEdit):
  `rustfmt` on a `.rs` file; `node --check` on `.js`, `.mjs` and `.cjs` (as an
  ES module under `apps/web/`, which also catches a backtick inside
  `live-audio.js`'s `PROCESSOR`); ESLint on a spec or helper in `tests/web`,
  as `make spec-lint` runs it, where `tests/web`'s packages are installed
  (`npm ci` there; a few tenths of a second for one file); `py_compile` on
  `.py`; `json.tool` on `.json`; `bash -n` on `.sh`. It skips the file's own
  checkout's `target/` and `apps/web/pkg/`, and `node_modules/`. A failure
  comes back to you at once, not at `make check` time.
- **Before a Bash command** (`guard-bash.sh`): refuses `cargo test` on any
  crate without `--release`, `--profile` or `--doc` (use
  `--profile test-fast`), and refuses `playwright test` outside
  `one_browser.sh` (a `--list` and `make smoke` are let through). Each refusal
  says the right command.

`.claude/checks/test_hooks.sh` runs the hooks against inputs they must block
and pass, in a fake main checkout with a worktree inside it too
(`make dev-check`). A hook that reads a path or a directory finds its
checkout as the nearest directory above it holding a `.git`
(`.claude/hooks/_root.sh`).

## Plugins

The [principled](https://github.com/alexnodeland/principled) marketplace is
enabled for this project: `principled-docs` (proposals → decisions → plans,
ADR immutability), `principled-architecture` (modules mapped to their ADRs,
drift) and `principled-quality` (spec-driven review checklists). `docs/` follows
its layout, so `/new-adr`, `/new-proposal`, `/new-plan`, `/arch-drift` and
`/review-checklist` work here. User-facing decisions still go in the published
reference; see [`docs/README.md`](../docs/README.md) for which record gets what.
