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
Keep at most two streams in flight, never two on the same files.

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
```

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

One round. Send only the **blocking** findings back to the builder (the same
agent, so it keeps its context), and have only those fixes looked at again:
- a wrong result;
- a dropped capability;
- an untrue description;
- a spec that can pass vacuously or that a slow runner can fail.

File every other finding as an issue and name it in the PR body. A finding
you decline goes in the PR body with the reason.

**A branch built on another open PR** is held until that one merges, then
moved onto `main` before step 5:

```bash
git -C "$WT" fetch -q origin
git -C "$WT" rebase --onto origin/main <the one ahead's last head>
```

Don't push it stacked on the open one: once that one squash-merges, a branch
still carrying its commits conflicts wherever both changed the same lines
(`CHANGELOG.md`, nearly always), and the queue can't rebase it. Any other
branch goes up now, based on `main`: the queue brings it up to date when it
reaches the front. Otherwise rebase only to resolve a conflict.

New words for `voice.md`'s table: ask the maintainer once for the batch, then
have the builder commit the approved rows.

## 5. The PR, in the merge queue

```bash
git -C "$WT" push -q -u origin claude/<topic>
gh -R alexnodeland/auracle pr create --base main --head claude/<topic> \
  --title "<what is true now>" --body-file <scratch>/pr-<topic>.md --label queue
```

The `queue` label is the one act of enqueueing: the PR enters Mergify's
merge queue once its `CI` is green, and the queue merges it (`process.md`
§ CI and merging). The title becomes the squash commit's subject,
`<title> (#<n>)`, and its body is the PR's commit messages (the repository's
squash setting), so each commit's why reaches `main`.

The body: what changed, why, how (what a reviewer should look at), checks
(gates, specs and counts, the review and its findings), `Closes #<n>`, and,
when an agent session made it, the session's link line last.

A PR that changes what the slow tests cover also gets the `full-ci` label
(`gh -R alexnodeland/auracle pr edit <n> --add-label full-ci`): the *Slow
suite* runs on a PR only with it. It covers any crate, `Cargo.toml` or
`Cargo.lock`, `rust-toolchain.toml`, the `Makefile`, `slow-suite.yml` or
`.github/actions/`; `apps/web/`'s `worker.js`, `farm.js`, `perform.js`,
`patch.js`, `live-audio.js`, `audio-in.js`, `explain.js`, `faces.js` or
`vessel.js`; `tests/web/`'s `fixtures.js`, `playwright.config.js`,
`package.json` or `package-lock.json`; a spec file that holds an `@slow` or
`@quarantine` test; and a `main.js` change that reaches EVOLVE's
generations or PERFORM's offers. It does not block the merge.

## 6. The merge, waited on by state

The queue rebases the PR onto `main` if `main` moved, runs `CI` on that
head, and merges. Wait until it merges, its `CI` goes red, or it leaves the
queue:

```bash
until r=$(gh -R alexnodeland/auracle pr view <n> --json state,labels,statusCheckRollup -q '
    if .state != "OPEN" then .state
    elif any(.labels[]; .name == "dequeued") then "dequeued"
    elif any(.statusCheckRollup[]; .name == "CI" and (.conclusion == "FAILURE" or .conclusion == "TIMED_OUT")) then "CI red"
    else empty end'); [ -n "$r" ]; do sleep 30; done; echo "$r"
```

Run the wait in the background; never sleep a fixed time and assume.

- **`MERGED`:** watch `main`'s run. It reuses the PR's verdict (the queue
  merged the files that run tested) and deploys the site once green. Then
  step 8.
- **`CI red`:** read the run on the PR's head:
  `gh -R alexnodeland/auracle run list --workflow ci.yml --branch claude/<topic> --json databaseId,conclusion,headSha`,
  then `gh -R alexnodeland/auracle run view <run> --log-failed`, and the
  run summary's merged browser report. Then step 7.
- **`dequeued`:** it left the queue without merging: a red run on the
  rebased head, a conflict with `main`, or a run that was cancelled.
  `gh -R alexnodeland/auracle pr checks <n>` (the *Mergify Merge Queue*
  check) and the queue's comment (`gh -R alexnodeland/auracle pr view <n> --comments`)
  say why. Then step 7.

## 7. When it doesn't merge

Green, with no blocking finding, the PR is in the queue: nothing is added to
it, and a later finding is an issue or the next PR. When it comes back red
or dequeued:

1. **Bring the worktree to the branch on GitHub.** The queue may have
   rebased it:

   ```bash
   git -C "$WT" fetch -q origin
   git -C "$WT" reset -q --hard origin/claude/<topic>
   ```

2. **Fix it on the branch.** The app or the test is fixed there (by the
   builder). A red test the PR doesn't touch, for a cause outside it
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

**By hand, only when Mergify is down.** On green, and up to date with
`main` (if `main` moved, rebase it with the lease above and wait for `CI` on
the new head):

```bash
sha=$(gh -R alexnodeland/auracle pr view <n> --json headRefOid -q .headRefOid)
gh -R alexnodeland/auracle pr merge <n> --squash --match-head-commit "$sha" \
  --subject "<title> (#<n>)"
```

Only the SHA that was checked; `main`'s ruleset refuses anything else. A
merge from outside the queue makes the queue start over on the new `main`.

## 8. Clean up

The PR's branch deletes itself on GitHub when it merges. Remove the worktree
and the local branch:

```bash
git -C "$REPO" worktree remove "$WT"
git -C "$REPO" branch -D claude/<topic>
gh -R alexnodeland/auracle issue view <n> --json state       # closed by "Closes #<n>"; close it by hand if not
```

Update the plan's progress table (the task's issue and PR) when the PR did not.

## Status

Report done, running and next, by PR and issue number. No date estimates.
