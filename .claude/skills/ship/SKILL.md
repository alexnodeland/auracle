---
name: ship
description: >
  Take one Auracle task from its GitHub issue to a merged PR, the way
  docs/process.md says: a worktree and branch, a brief, an agent that builds
  and commits, a review before the PR, the PR in the merge queue, CI as the
  gate, the queue's squash merge, and the clean-up. Use when asked to build,
  land, merge or "ship" a planned task, a fix or a follow-up.
---

# Ship one task

[`docs/process.md`](../../../docs/process.md) is the rule; this is the
procedure. You are the operator: agents build and commit; you review, push,
open the PR in the merge queue, and clean up once the queue has merged it.
By hand, keep at most two streams in flight, never two on the same files.
Several tasks at once, when the maintainer asks for a wave, go through the
saved workflows and the [`ship-wave`](../ship-wave/SKILL.md) skill, one
stream per item, each on files no other touches (ADR-024); its scripts
(`scripts/ops/`: `ship_pr.sh`, `watch_queue.sh`, `rows_resolve.py`) serve one
task as well.

Every command names the repository explicitly (`gh -R alexnodeland/auracle`,
`git -C <path>`), so it works from any session directory. Each Bash call is a
fresh shell: nothing set in one call is there in the next, so set `REPO`, `WT`
and `sha` in the same call that uses them, or write the values in. Keep a
command whole rather than in a variable (`GH="gh -R …"; gh -R alexnodeland/auracle …` does not split
in zsh, this environment's shell):

```bash
REPO=/absolute/path/to/auracle          # the main checkout
WT="$REPO/../auracle-wt-<topic>"        # this task's worktree
```

## 1. The issue

```bash
gh -R alexnodeland/auracle issue view <n>                       # the task, its plan, its brief
gh -R alexnodeland/auracle issue list --milestone "<milestone>" --state open
```

No issue yet? Open one first. `gh issue create --template` does not work
non-interactively, and a template's labels aren't applied from the command
line, so pass the body and the labels yourself:

```bash
gh -R alexnodeland/auracle issue create --title "<what is true when done>" \
  --body-file <(sed '1,/^---$/d' "$REPO/.github/ISSUE_TEMPLATE/task.md") \
  --label task --label area:<area> --label plan-<nnn> --milestone "<milestone>"
```

(`flake.md` with `--label flake --label area:tests` for a flaky test.) Then
edit the body to fill the template's sections.

## 2. A worktree and a branch

```bash
git -C "$REPO" fetch -q origin
git -C "$REPO" worktree add -q -b claude/<topic> "$WT" origin/main
(cd "$WT/tests/web" && npm ci --no-audit --no-fund)
```

The last line installs `tests/web`'s packages in the new worktree
(`node_modules` is per checkout): without them `make web-check` stops at the
specs' lint, and the after-edit hook does not lint a spec.

Pick a free port for the branch's browser runs (8771 and up) and put it in the
brief as `AURACLE_TEST_PORT`: Playwright and `make browser-changed`,
`browser-fast` and `browser-slow` all use it.

## 3. The brief

The issue body, or a brief it links, gives the builder everything; it never has
to ask:

- the scope, the decisions already made (don't re-ask), and what not to touch
  (files another stream is changing);
- the rules: commit only, never push or open a PR; small commits; `Refs #<n>`
  in commit messages; no hand-written attribution (`Co-Authored-By`, model
  names); the session link line last, when the session asks for one;
- the gates: the `check` skill's set for what changes, the specs it adds or
  touches through `one_browser.sh` on its port (`make browser-changed`), no
  full suite;
- drop no functionality: a before → after table for anything moved or
  retired, by mouse, keyboard and touch;
- descriptions stay true in the same change; rows for new words that
  `voice.md`'s table governs drafted in the report, not committed;
- the report: head SHA, gates and spec counts, the before → after table,
  meaning changes to specs, voice drafts, anything left open.

Hand it to the area's agent (`web-engineer`, `engine-engineer`,
`docs-writer`, `film-producer`) with the worktree path and the port.

## 4. Review before the PR

When the builder reports, run the quick gates in `$WT`, then hand the branch to
the `reviewer` agent: the diff (`git -C "$WT" log origin/main..HEAD`), the
brief, and what to hunt for.

One round. Send the findings back to the builder (the same agent, so it
keeps its context), and have only the **blocking** fixes looked at again:
- a wrong result;
- a dropped capability;
- an untrue description;
- a spec that can pass vacuously or that a slow runner can fail.

Every other finding in what the branch touches is fixed in the same round
too, and so is in-area work the builder listed as open. Only a choice for
the maintainer, or work in another area, leaves the PR: file it as an issue
and name it in the PR body (`process.md` § Review). A finding you decline
goes in the PR body with the reason.

**A branch built on another open PR** is held until that one merges, then
moved onto `main` before step 5:

```bash
git -C "$WT" fetch -q origin
git -C "$WT" rebase --onto origin/main <the one ahead's last head>
```

Don't push it stacked on the open one: once that one squash-merges, a branch
still carrying its commits conflicts wherever both changed the same lines,
and the queue can't merge it. Any other branch goes up now, based on
`main`: the queue tests it on top of `main` when its batch is made.
Otherwise rebase only to resolve a conflict.

New words for `voice.md`'s table: ask the maintainer once for the batch, then
have the builder commit the approved rows.

## 5. The PR, in the merge queue

```bash
git -C "$WT" push -q -u origin claude/<topic>
gh -R alexnodeland/auracle pr create --base main --head claude/<topic> \
  --title "<type>(<scope>): <what is true now>" --body-file <scratch>/pr-<topic>.md --label queue
gh -R alexnodeland/auracle pr comment <n> --body "@mergifyio queue"
```

Check the title and the body first, as `PR checks` will (it reads the
branch's body file, with no PR yet):

```bash
PR_TITLE="<the title>" PR_BODY="$(cat <scratch>/pr-<topic>.md)" \
  python3 "$WT/scripts/pr_checks.py" title
PR_TITLE="<the title>" PR_BODY="$(cat <scratch>/pr-<topic>.md)" \
  python3 "$WT/scripts/pr_checks.py" links
```

The `@mergifyio queue` comment is the act of enqueueing, for now: the
`queue` label queues a PR through Mergify's auto-merge conditions, which act
only once the maintainer switches on Merge Protections in Mergify's
dashboard. Put the label on anyway; once Merge Protections is on, the label
alone queues the PR and the comment is only for putting one back. The PR
enters Mergify's merge queue once its own `CI`, the fast lane, and its
`PR checks` are green; the queue runs the full gate on its batch and merges
it (`process.md` § CI and merging). The title becomes the squash commit's
subject, `<title> (#<n>)`, so it starts with a type as a commit does
(`fix(web): …`, `tests: …`, `ci: …`); the commit's body is the PR's commit
messages (the repository's squash setting), so each commit's why reaches
`main`.

A PR that fixes CI or quarantines a flaky test also gets the `priority`
label (`gh -R alexnodeland/auracle pr edit <n> --add-label priority`): it
goes into the queue's next batch ahead of the rest.

The body: what changed, why, how (what a reviewer should look at), checks
(gates, specs and counts, the review and its findings), the issues one per
line (`Closes #<n>` for each it finishes, one keyword per issue, since
`Closes #a, #b` closes #a only; `Refs #<n>` for each it advances; or a
`No issue:` line saying why), and, when an agent session made it, the
session's link line last. Once it merges, `PR checks` comments on each
`Refs` issue, closes any `Closes` issue GitHub missed, tells each closed
issue's parent how many of its sub-issues are closed, and ticks the boxes in
other open issues that name what closed (once every issue a box names is
closed as completed).

A PR that changes what the slow tests cover also gets the `full-ci` label
(`gh -R alexnodeland/auracle pr edit <n> --add-label full-ci`): the *Slow
suite* runs on a PR only with it. It covers any crate, `Cargo.toml` or
`Cargo.lock`, `rust-toolchain.toml`, the `Makefile`, `slow-suite.yml` or
`.github/actions/`; `apps/web/`'s `worker.js`, `farm.js`, `perform.js`,
`patch.js`, `live-audio.js`, `audio-in.js`, `explain.js`, `faces.js` or
`vessel.js`; `tests/web/`'s `fixtures.js`, `playwright.config.js`,
`package.json` or `package-lock.json`; a spec file that holds an `@slow` or
`@quarantine` test; and a `main.js` change that reaches EVOLVE's
generations or PERFORM's offers. The queue doesn't wait for it: by hand the
PR is queued at once. A wave holds it out of the queue until its Slow suite
is green (`ship_pr.sh --full-ci`; `process.md` § CI and merging says why).

## 6. The merge, waited on by state

The PR's own `CI` is the fast lane (a few minutes). Green, with its
`PR checks` green too, the PR is in the queue, which tests it in a batch of
up to three (a release PR alone) on a draft PR (the full gate, about twelve
minutes, from a `mergify/merge-queue/` branch) and merges each PR of a green
batch. Wait until it merges, its own `CI` or `PR checks` goes red, or it
leaves the queue:

```bash
until r=$(gh -R alexnodeland/auracle pr view <n> --json state,labels,statusCheckRollup -q '
    def red($check): [.statusCheckRollup[] | select(.name == $check)]
      | sort_by(.detailsUrl | capture("/runs/(?<run>[0-9]+)/job/(?<job>[0-9]+)") | [(.run | tonumber), (.job | tonumber)])
      | last | .conclusion == "FAILURE" or .conclusion == "TIMED_OUT";
    if .state != "OPEN" then .state
    elif any(.labels[]; .name == "dequeued") then "dequeued"
    elif red("CI") then "CI red"
    elif red("PR checks") then "PR checks red"
    else empty end'); [ -n "$r" ]; do sleep 30; done; echo "$r"
```

Each check is read by its latest run. The rollup keeps every run of a check
on the PR's head commit, and an edit to the title or body runs `PR checks`
again on the same commit, so the red run the edit put right stays in the
list. The latest is the one with the highest run id (then job id), both in
its link; a start time doesn't order them, since a skipped job's can come
after its end.

Run the wait in the background; never sleep a fixed time and assume.

- **`MERGED`:** watch `main`'s run. It reuses the queue's verdict (on the
  batch's last merge, `main` has the files that run tested) and deploys the
  site once green; a run for an earlier merge of the batch runs nothing.
  Then step 8.
- **`CI red`:** the fast lane, on the PR's own head; the PR never entered
  the queue. Read it:
  `gh -R alexnodeland/auracle run list --workflow ci.yml --branch claude/<topic> --json databaseId,conclusion,headSha`,
  then `gh -R alexnodeland/auracle run view <run> --log-failed`, and the
  run summary's merged browser report. Then step 7.
- **`PR checks red`:** the title or the issue lines; the PR never entered
  the queue. `gh -R alexnodeland/auracle pr checks <n>` links the run, and
  its failed step says what to write. Put the title or the body right with
  `gh -R alexnodeland/auracle pr edit <n> --title "…"` or `--body-file`:
  the edit runs it again, and no push is needed. Start the wait again once
  `gh -R alexnodeland/auracle pr checks <n>` shows the new run of
  `PR checks` pending; started sooner, it finds only the red run and stops
  at once. Green, the PR enters the queue by itself.
- **`dequeued`:** it left the queue without merging. Red in the queue (the
  full gate failed on its batch, and the split narrowed the failure to this
  PR), a conflict, or a run that was cancelled.
  `gh -R alexnodeland/auracle pr checks <n>` (the *Mergify Merge Queue*
  check) and the queue's comment (`gh -R alexnodeland/auracle pr view <n> --comments`)
  say why. The red run is the draft PR's, on its own branch:
  `gh -R alexnodeland/auracle run list --workflow ci.yml --event pull_request --json databaseId,conclusion,headBranch,createdAt -q '[.[] | select(.headBranch | startswith("mergify/merge-queue/"))] | .[:5]'`,
  then `--log-failed` and its browser report as above. Then step 7.

Red in the queue doesn't prove the PR at fault: Mergify doesn't run a red
batch again, so a flake leaves the PR it was last narrowed to dequeued. If
the red run failed a test the PR doesn't touch, for a cause outside it, it
is a flake case (`process.md` § Flakes, step 4): quarantine the test with one
commit on this PR, and put it back in (step 7).

## 7. When it doesn't merge

Green, with no blocking finding, the PR is in the queue: nothing is added to
it, and a later finding is an issue or the next PR. When it comes back red
or dequeued (red on its own run, or red in the queue):

1. **Check the worktree is at the branch on GitHub.** The queue never pushes
   to a PR's branch, so the two should match; if they don't, find out who
   pushed before going on:

   ```bash
   git -C "$WT" fetch -q origin
   [ "$(git -C "$WT" rev-parse HEAD)" = "$(git -C "$WT" rev-parse origin/claude/<topic>)" ] && echo same
   ```

2. **Fix it on the branch.** The app or the test is fixed there (by the
   builder). Red in the queue, the fix is checked by the fast lane first and
   the full gate again in the queue; run the specs it touches locally
   (`make browser-changed`), since a `main.js` change's fast lane runs the
   smoke only. A red test the PR doesn't touch, for a cause outside it
   (`process.md` § Flakes, step 4), gets one commit that quarantines it with
   its `flake` issue; don't root-cause it here. Never re-run a red check
   until it passes. A run that was cancelled rather than failed needs no
   fix.
   - **A conflict with `main`:** rebase it, with a lease that names the head
     on GitHub, so a push nobody fetched is never overwritten:

   ```bash
   pushed=$(git -C "$WT" rev-parse origin/claude/<topic>)
   git -C "$WT" rebase origin/main
   git -C "$WT" push -q --force-with-lease=claude/<topic>:"$pushed" origin claude/<topic>
   ```

3. **Push it, and put it back in the queue.** The `queue` label stays on;
   the command re-queues:

   ```bash
   git -C "$WT" push -q origin claude/<topic>
   gh -R alexnodeland/auracle pr edit <n> --remove-label dequeued
   gh -R alexnodeland/auracle pr comment <n> --body "@mergifyio queue"
   ```

   The comment is safe either way: a PR whose own first run was red never
   entered the queue, and enters by itself once `CI` is green. Then step 6
   again.

**By hand, only when Mergify is down.** The PR's own `CI` is the fast lane,
not the full gate, and the ruleset requires only that one, so nothing stops
a merge by hand that skips the full gate: run it first. Up to date with
`main` (if `main` moved, rebase it with the lease above), start a run by
hand, which is the full gate, wait for it to finish, and merge only if it is
green on the PR's head and the PR's own `CI` is too:

```bash
sha=$(gh -R alexnodeland/auracle pr view <n> --json headRefOid -q .headRefOid)
gh -R alexnodeland/auracle workflow run ci.yml --ref claude/<topic>
until run=$(gh -R alexnodeland/auracle run list --workflow ci.yml --event workflow_dispatch \
    --branch claude/<topic> --json databaseId,headSha -q "[.[] | select(.headSha == \"$sha\")][0].databaseId // empty"); \
  [ -n "$run" ]; do sleep 10; done
gh -R alexnodeland/auracle run watch "$run" --exit-status && \
gh -R alexnodeland/auracle pr merge <n> --squash --match-head-commit "$sha" \
  --subject "<title> (#<n>)"
```

`run watch --exit-status` fails on a red run, so the merge runs only after a
green one. Only the SHA that was checked; `main`'s ruleset refuses anything
else. A merge from outside the queue makes the queue start over on the new
`main`, and `main`'s own run, finding no queue record, runs everything.

## 8. Clean up

The PR's branch deletes itself on GitHub when it merges. Remove the worktree
and the local branch:

```bash
git -C "$REPO" worktree remove "$WT"
git -C "$REPO" branch -D claude/<topic>
gh -R alexnodeland/auracle issue view <n> --json state       # closed by "Closes #<n>", or by PR checks if GitHub missed it
```

The merge's *Issues on merge* job (`pr-checks.yml`) commented on each
`Refs` issue, closed any `Closes` issue GitHub missed, told each closed
issue's parent, and ticked the boxes in other open issues (an umbrella's
checklist) that name an issue that closed, once every issue each names is
closed as completed. Don't tick those by hand. Its run's log says what it
did to each, and why a box naming a closed issue was left (another still
open, or closed as not planned; a line changed since it read it); a red run
is a read or a write that failed. Read it, and once the cause has passed
(GitHub's API answering again), run the job again: each line it writes is
marked, so it ticks and posts only what the red run left out.

```bash
gh -R alexnodeland/auracle run list --workflow pr-checks.yml --branch claude/<topic> --json databaseId,conclusion,event,displayTitle
gh -R alexnodeland/auracle run rerun <run> --failed
```

What it can't do, do by hand. Tick a box it leaves, since no later merge
comes back for it: one that names no issue (only PRs, or nothing); one that
names another repository's issue, or an issue closed as not planned or as a
duplicate; one whose issue closed without a merge; one the search missed
(added in the minute before the merge, so the run's log says nothing of it);
and one the run's log says changed as it was read. Update the plan's
progress table (the task's issue and PR) when the PR did not.

## Status

Report done, running and next, by PR and issue number. No date estimates.

CI's health is read, not felt: `python3 scripts/ci_stats.py` gives the last
7 days (CI's wall time by lane and kind of PR, the required jobs' runner
waits, red runs and the job that failed, runs per PR, the time from entering
Mergify's queue to the merge, main's red stretches and the browser shards),
and `--compare docs/notes/ci-baseline-2026-10-05.json` sets each headline
against the week before #177's wave 0. The nightly *CI health* workflow
(`ci-health.yml`) writes the same to its summary; the budgets are in
`docs/architecture/testing.md` § Budgets.
