---
name: ship-wave
description: >
  Run several Auracle tasks at once with the saved workflows in
  .claude/workflows/ (ship-issues, fix-flake, triage-backlog, review-pr,
  mutants-burndown), and do the operator's part around each run: worktrees,
  the in-progress comment, the launch, reading the result, voice drafts as
  one batch, shipping and watching with scripts/ops/, rebasing on a
  conflict, and the clean-up. Use when the maintainer asks for a wave, a
  triage, or one of those workflows by name; one task by hand is the ship
  skill.
---

# Ship a wave

[`docs/process.md`](../../../docs/process.md) is the rule, § Waves the part
for this; the [`ship`](../ship/SKILL.md) skill is one task by hand, and
everything it says about the PR, the queue and the merge holds here. This is
the procedure around a run. You are the operator: the workflow's agents
build, review and commit; you comment, push, open the PR, watch the queue
and clean up.

**A workflow spends many tokens** (a ship-issues item is five agents or
more, a triage one per open issue). Run one when the maintainer asks for a
wave, a triage or a workflow by name, not on your own initiative.

Every command names the repository (`gh -R alexnodeland/auracle`,
`git -C <path>`); each Bash call is a fresh shell, so set `REPO`, `WT` and
the like in the call that uses them. The shell is zsh: quote a line of
`=`s (`echo '======'`), which zsh otherwise expands.

```bash
REPO=/absolute/path/to/auracle          # the main checkout
WT="$REPO/.claude/worktrees/<topic>"    # one item's worktree
```

## Which workflow

| Workflow (`.claude/workflows/`) | For | Its args |
| --- | --- | --- |
| `triage-backlog` | Choosing the next wave: one read-only agent per open issue, then waves (items that share no file), bundles (issues that do), chains, and one batch of questions for the maintainer | `{issues?: [n], models?, session?}`; none reads every open issue |
| `ship-issues` | Building: build, review, fix (every blocking and should-fix finding, the nits, the in-area open items), re-check the blocking ones, then finalize (rebased onto `origin/main` with diff3, the quick gates again, the PR checks on the title and body) | `{items: [{issue, closes, refs, branch, worktree, port, agentType, model?, notes, decisions, avoid}], models?, session}` |
| `fix-flake` | One flaky test: diagnosed from the run's log and trace and reproduced at throttle 4 and under load, its cause named by ADR-022's classes; fixed; proved by `--repeat-each=5` and a mutation it must fail on; reviewed; finalized, its quarantine tag out | `{spec, test_title, run_id, issue?, branch, worktree, port, models?, session}` |
| `review-pr` | A second review of a PR or branch: five lenses in parallel, each finding then put to an agent that tries to refute it; only the survivors come back, ranked | `{pr, models?}` or `{branch, worktree, models?}` |
| `mutants-burndown` | One crate's surviving mutants, killed file by file with behavior tests (or shown equivalent and excluded narrowly), measured again, reviewed and finalized. Hours | `{crate, branch, worktree, issue?, models?, session}` |

`session` is this operator session's link (`https://claude.ai/code/session_…`):
each commit then ends with `Claude-Session: <it>` and each PR body with the
link. Without it, neither does.

`models` is `{<stage>: 'opus' | 'sonnet'}`. Each workflow runs its stages on the
model its script sets by how hard the stage is and what a wrong answer costs.
Opus builds, fixes, diagnoses, proves a flake's fix, kills mutants, plans,
reviews (`review-pr`'s correctness, descriptions and tests lenses, and every
refuter), and re-checks a blocking finding (`verify`), the last gate on it.
Sonnet finalizes, lists issues, reads one issue, runs `mutants-burndown`'s
first measure (the run after, `remeasure`, is Opus), and runs `review-pr`'s
voice and process lenses. A script's args comment names its stages, and the
[README](../../README.md#choosing-the-model) has them in a table.

**One run per item.** A run returns when its slowest item is done, so give
`ship-issues` one issue per run, or a small bundle of issues that share
files, and each completion notifies on its own.

## 1. Plan the wave

Run `triage-backlog` when the next wave isn't obvious. Its plan's items are in
`ship-issues`' item shape, less the worktree and the port. Ask the
maintainer its questions as one batch before the wave; an issue waiting on
an answer is in no wave. Items of one wave share no file: two branches that
edit the same rows (testing.md's tables, the Makefile's `DEV_CHECKS`, a
spec's quarantine tag) can't merge in one queue batch, and the second is
rebased by hand.

## 2. Worktrees, ports, the in-progress comment

For each item:

```bash
make -C "$REPO" worktree TOPIC=<topic>
git -C "$REPO" merge -q --ff-only origin/main
make -C "$WT" pkg-reuse || nice -n 10 make -C "$WT" wasm
gh -R alexnodeland/auracle issue comment <n> --body "In progress: \`claude/<topic>\` <what it will do, in a line>."
```

The first line fetches and makes `claude/<topic>` from `origin/main` at
`$WT`, inside the main checkout where git ignores it, with `tests/web`'s
packages; the second keeps the main checkout on `main` and current, since an
agent in `$WT` also loads its root `AGENTS.md` and runs its hooks; the third
gives the worktree an engine (the [`ship`](../ship/SKILL.md) skill's step 2
says more of each).

Give each item a free port of its own (8771 and up; the reviewer takes the
port plus 100). Its notes are what the builder needs and would otherwise ask:
what remains, the decisions already made, what not to touch (another item's
files). The workflow adds the rules to each prompt, and tells every agent to
use the advisor when there is one (before it commits to an approach, when it is
stuck, and before it reports done), so the notes need not.

## 3. Launch

**Choose each item's model** first. An item that is well specified and
mechanical (the issue says exactly what to change, and a gate proves it) takes
`model: 'sonnet'` for its build and fix stages. An item that needs design or
diagnosis keeps the default, Opus, and so does one you are unsure of. To move a
stage for every item, pass `models: {stage: 'opus' | 'sonnet'}`. The README has
[examples of each](../../README.md#choosing-the-model).

With Claude Code's Workflow tool, by name (the file
`.claude/workflows/<name>.js`), and `args` as a JSON object, never a string:

```
Workflow({ name: "ship-issues", args: { items: [ { issue: 233, closes: [233], refs: [177],
  branch: "claude/<topic>", worktree: "/abs/path/auracle/.claude/worktrees/<topic>", port: 8781,
  agentType: "web-engineer", notes: "…", decisions: "…", avoid: "…" } ],
  session: "https://claude.ai/code/session_…" } })
```

`model` and `models` are optional: without them an item builds and fixes on
Opus, and every other stage runs on its default.

The run goes on in the background and tells you when it ends. Launch the
next item's run beside it; the tool caps how many agents run at once.

## 4. Read the result

```bash
python3 "$REPO/scripts/ops/wf_result.py" <run id> --out <your scratch directory>
```

The run id is in the Workflow tool's result. A finished run is read from its
output file; a run still going, from its journal: an item whose agents are
done can ship while the run's other items go on. It prints, per branch: the
status and head, closes and refs, `full-ci` or not, the review's counts and
the re-check, the problems it or the workflow found, the voice drafts, the
open items by kind, the decisions made, and the `ship_pr.sh` command; it
writes `pr-<key>.md` (the body, ending with the session link) beside it.

Before shipping, every item is `ready`, or each problem is dealt with:

- **A problem** (a title with no type, an issue line missing, blocking
  findings left, an agent that did not return, finalize missing) is put
  right on the branch. An agent skipped, or dead on an API error, gives the
  run a null and the run goes on: its item says which (`fix #233 did not
  return`), and a review's blocking findings no re-check confirmed are a
  problem, never `none needed`. A workflow's agents can't be resumed
  afterwards: brief a fresh agent with the branch, the head and what is
  wrong, or run the workflow again.
- **Open items, by kind** (the fold-in rule, `docs/process.md` § Review):
  `in_area` work is done on the branch, never filed (one left is a problem);
  `decision` goes to the maintainer, in the batch below; `other_area`
  becomes an issue, named in the PR body; `note` is read.

## 5. Voice drafts, as one batch

Each draft has its words, where they appear, and its row for
`www/brand/voice.md`'s word table. Put the wave's drafts and decisions to the
maintainer as one question. Approved rows are committed to `voice.md` on the
branch that uses them (by you, or a fresh agent), before it ships; a refused
one is reworded in the existing words first.

## 6. Ship

```bash
"$REPO/scripts/ops/ship_pr.sh" [--full-ci] [--priority] "$WT" claude/<topic> "<title>" <scratch>/pr-<key>.md
```

It refuses a dirty worktree, a branch that isn't the worktree's or isn't
`claude/*`, and a title or body `PR checks` would fail (it runs `main`'s
`scripts/pr_checks.py` on them); then it pushes, opens the PR labelled
`queue` and comments `@mergifyio queue`. When `gh pr create` fails (GitHub's
GraphQL API can fail while its REST API works), it does each of those
through the REST API, and finds a PR whose create answered nothing by its
branch. `--priority` is for a fix to CI or
to a flaky test. `--full-ci` is for a PR the Slow suite covers
(`wf_result.py` says which, from the report's `needs_full_ci`): it opens the
PR with `full-ci` and does not queue it; queue it once its Slow suite is
green, with the two commands it prints. A wave's PRs land minutes apart, so
a slow test one of them broke is caught on its own PR, not on `main` with
several to suspect (by hand, a `full-ci` PR is queued at once:
`process.md` § CI and merging).

## 7. Watch

```bash
"$REPO/scripts/ops/watch_queue.sh" <n> [<n> ...]
```

Run it as a background task (`run_in_background`), which tells you when it
exits; one detached with `&` tells no one. It exits when a PR merges,
closes, is dequeued, goes red on its own `CI` or `PR checks`, or, for a
`full-ci` PR not yet queued, when its Slow suite finishes. It reads each
check by its latest run, and doesn't count a `dequeued` label left on after
a requeue while Mergify's queue check is running. Start it again for the
PRs still open.

- **`MERGED`:** step 9.
- **`Slow suite green`:** queue it (`gh -R alexnodeland/auracle pr edit <n> --add-label queue`,
  then `pr comment <n> --body "@mergifyio queue"`). Red: as `CI red`.
- **`CI red`, `PR checks red`, `dequeued`:** the [`ship`](../ship/SKILL.md)
  skill's steps 6 and 7 say how to read and fix each. A red test the PR
  doesn't touch, for a cause outside it, is quarantined on sight with one
  commit (`process.md` § Flakes, step 4), and `fix-flake` takes it later.

## 8. A conflict

A PR that conflicts with `main` leaves the queue (often the second of two
that edit the same docs rows). Rebase it, with diff3 so each conflict
carries its base, and resolve the line-wise ones with `rows_resolve.py`: it
keeps `main`'s lines, applies the branch's changes to them, merges two words
added to one line, and refuses a real overlap, which you resolve by hand.

```bash
git -C "$WT" fetch -q origin
pushed=$(git -C "$WT" rev-parse origin/claude/<topic>)
git -C "$WT" -c merge.conflictStyle=diff3 rebase origin/main
python3 "$REPO/scripts/ops/rows_resolve.py" <each conflicted file, under $WT>
git -C "$WT" add <the files>; GIT_EDITOR=true git -C "$WT" rebase --continue
```

The gates again for what the branch changes (the `check` skill), then push
with a lease naming the head on GitHub, to the `claude/` branch only, never
`main`, and put it back in the queue:

```bash
git -C "$WT" push -q --force-with-lease=claude/<topic>:"$pushed" origin claude/<topic>
gh -R alexnodeland/auracle pr edit <n> --remove-label dequeued
gh -R alexnodeland/auracle pr comment <n> --body "@mergifyio queue"
```

The comment puts it back, as for any dequeued PR (the `ship` skill's step
7). Mergify's `requeue` is the same command under an old name, deprecated.
Without a comment the PR can stay out of the queue, and nothing says so.
A conflict mid-rebase that needs a decision: `git -C "$WT" rebase --abort`,
and ask.

## 9. After the merge

The merge's *Issues on merge* job closes the issues, comments on the ones it
advanced and their parents, and ticks the boxes (the `ship` skill's step 8
says what it leaves to you). Then:

```bash
make -C "$REPO" worktree-rm TOPIC=<topic>    # removes $WT and deletes the branch it is on
```

It refuses a branch whose commits no remote branch holds: once
`origin/claude/<topic>` is pruned (`git fetch --prune`), a merged branch
needs `FORCE=1`.

## When something hangs

- A git command (or a `make dev-check` inside a commit) that hangs is often
  waiting on git's fsmonitor socket: `git -c core.fsmonitor=false …`. The
  scripts in `scripts/ops/` pass it.
- Stop a process by its PID, never `pkill -f`.

## Status

Report done, running and next, by PR and issue number; say plainly what
failed, was skipped or waits on the maintainer (`process.md` § Status
updates).
