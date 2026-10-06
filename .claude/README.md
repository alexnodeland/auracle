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
| `ship-wave` | Run several at once with the saved workflows, and the operator's part around each run: worktrees, launch, the result, voice drafts as a batch, ship, watch, rebase on a conflict ([`docs/process.md` § Waves](../docs/process.md#waves)) |

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

## Workflows (`.claude/workflows/`)

Claude Code workflows, saved by name (the Workflow tool runs one by its
file's name): a script that runs agents in stages, each agent's result
checked against a schema. The `ship-wave` skill says when and how to run
each; they spend many tokens, so one runs when the maintainer asks for a
wave or for it by name.

| Workflow | Runs |
| --- | --- |
| `ship-issues` | Build, review, fix, a second look at the blocking fixes, and finalize (rebased onto `origin/main`, the quick gates and the PR checks again), per issue or bundle; one per run, so each completion notifies |
| `fix-flake` | One flaky test: diagnose, fix, prove (repeat runs at throttle 4 and under load, a mutation it must fail on), review, finalize |
| `triage-backlog` | One read-only agent per open issue, then waves, bundles, chains and the maintainer's questions |
| `review-pr` | Five review lenses in parallel, then an agent that tries to refute each finding; the survivors, ranked |
| `mutants-burndown` | One crate's surviving mutants killed file by file, measured again, reviewed and finalized |

A workflow file is a plain script, not a module: `export const meta = {…}`
(a pure literal), then a body that ends in a top-level `return`. `node
--check` passes such a file whatever it holds, so
`scripts/ops/check_workflows.mjs` checks them instead (`make dev-check`,
and the after-edit hook): meta, the phases it names, no `Date.now()`,
`Math.random()` or Node API, and a dry run of the body on stubbed agents
with sample `args` for each, which it keeps. A new workflow adds its sample
there. What the workflows promise the operator is tested on scripted agents
in `scripts/ops/workflows.test.mjs`: an item of `ship-issues`, `fix-flake`
or `mutants-burndown` is `ready` only when every agent it needed came back,
and `review-pr` loses no finding. An agent label is `<stage> <key>`
(`build #233`, `fix #233 r2`), which `wf_result.py` reads a running
workflow's journal by.

## The operator's scripts (`scripts/ops/`)

Around a run, for the operator (Python's standard library and bash; the
repository from the `origin` remote, `GH_REPO` to override; their tests in
`make dev-check`):

| Script | Does |
| --- | --- |
| `wf_result.py <run>` | Reads a finished run's output file, or a running run's journal, and writes each branch's PR body and a summary: status, problems, voice drafts, open items by kind, the `ship_pr.sh` command |
| `ship_pr.sh [--full-ci] [--priority] <worktree> <branch> <title> <body>` | Checks the title and body as `PR checks` will, pushes, opens the PR with `queue` and queues it (`--full-ci`: opened with `full-ci`, queued once its Slow suite is green); through the REST API when `gh pr create` fails |
| `watch_queue.sh <pr>...` | Polls until a PR merges, closes, leaves the queue, goes red, or (`full-ci`) its Slow suite finishes; run as a background task. Its rule is `queue_state.py` |
| `rows_resolve.py <file>...` | Resolves a diff3 rebase's line-wise conflicts (table rows, a list, words added to one line) and refuses a real overlap |
| `check_workflows.mjs` | Checks the saved workflows, as above |

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
  `live-audio.js`'s `PROCESSOR`, and for any other `.js` with an `import` or
  `export`: a plain `--check` passes such a file whatever it holds); the
  workflow check on a saved workflow (`.claude/workflows/`, not a module);
  ESLint on a spec or helper in `tests/web`,
  as `make spec-lint` runs it, where `tests/web`'s packages are installed
  (`npm ci` there; a few tenths of a second for one file); `py_compile` on
  `.py`; `json.tool` on `.json`; `bash -n` on `.sh`. It skips the file's own
  checkout's `target/` and `apps/web/pkg/`, and `node_modules/`. A failure
  comes back to you at once, not at `make check` time.
- **Before a Bash command** (`guard-bash.sh`): refuses `cargo test` on any
  crate without `--release`, `--profile` or `--doc` (use
  `--profile test-fast`), and `cargo nextest run` or `list` without
  `--release`, `--cargo-profile` or `--archive-file` (use
  `--cargo-profile test-fast`), and refuses `playwright test` outside
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
