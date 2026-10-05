---
name: ship
description: >
  Take one Auracle task from its GitHub issue to a merged PR, the way
  docs/process.md says: a worktree and branch, a brief, an agent that builds
  and commits, a review before the PR, the PR, CI as the gate, a checked
  squash merge, and the clean-up. Use when asked to build, land, merge or
  "ship" a planned task, a fix or a follow-up.
---

# Ship one task

[`docs/process.md`](../../../docs/process.md) is the rule; this is the
procedure. You are the operator: agents build and commit, you review, push,
open the PR, merge and clean up. Keep at most two streams in flight, never two
on the same files.

## 1. The issue

```bash
gh issue view <n>                       # the task, its plan, its brief
gh issue list --milestone "<milestone>" --state open
```

No issue yet? Open one first (`gh issue create --template "Task"`, or
`--template "Flaky test"`) with its type label, area labels, plan label and
milestone.

## 2. A worktree and a branch

```bash
git -C <repo> fetch -q origin
git -C <repo> worktree add -q -b claude/<topic> ../auracle-wt-<topic> origin/main
```

Pick a free port for the branch's browser runs (`AURACLE_TEST_PORT`, e.g.
8771–8799) and say it in the brief.

## 3. The brief

The issue body, or a brief it links, gives the builder everything; it never has
to ask:

- the scope, the decisions already made (don't re-ask), and what not to touch
  (files another stream is changing);
- the rules: commit only, never push or open a PR; small commits; `Refs #<n>`
  in commit messages; the commit trailer rules (no `Co-Authored-By`, no model
  names; the session link line last, when the session asks for one);
- the gates: the `check` skill's set for what changes, the specs it adds or
  touches through `one_browser.sh` on its port (`make browser-changed`), no
  full suite;
- drop no functionality: a before → after table for anything moved or
  retired, by mouse, keyboard and touch;
- descriptions stay true in the same change; new `voice.md` rows drafted in
  the report, not committed;
- the report: head SHA, gates and spec counts, the before → after table,
  meaning changes to specs, voice drafts, anything left open.

Hand it to the area's agent (`web-engineer`, `engine-engineer`,
`docs-writer`, `film-producer`) with the worktree path and the port.

## 4. Review before the PR

When the builder reports, rebase on `origin/main` yourself (resolve, bump
`?b=` cache-busters that collide), run the quick gates, then hand the branch to
the `reviewer` agent: the diff (`git log origin/main..HEAD`), the brief, and
what to hunt for. Send its findings back to the builder (the same agent, so it
keeps its context); have only the fixes re-reviewed. A finding you decline goes
in the PR body with the reason.

New `voice.md` rows: ask the maintainer once for the batch, then have the
builder commit the approved rows.

## 5. The PR

```bash
git -C ../auracle-wt-<topic> push -q -u origin claude/<topic>
gh pr create --base main --head claude/<topic> \
  --title "<what is true now>" --body-file <scratch>/pr-<topic>.md
```

The body: what changed, why, how (what a reviewer should look at), checks
(gates, specs and counts, the review and its findings), `Closes #<n>`, and,
when an agent session made it, the session's link line last.

## 6. CI, waited on by state

```bash
sha=$(gh pr view <n> --json headRefOid -q .headRefOid)
until [ "$(gh run list --workflow ci.yml --branch claude/<topic> \
  --json headSha,status -q "[.[] | select(.headSha==\"$sha\")][0].status")" = completed ]; do sleep 30; done
gh run list --workflow ci.yml --branch claude/<topic> --limit 1 --json databaseId,conclusion
gh run view <run> --json jobs -q '.jobs[] | "\(.name) \(.conclusion)"'
```

Run the wait in the background; never sleep a fixed time and assume. A red
run: `gh run view <run> --log-failed`, and the run summary's merged browser
report. The app or the test is fixed on the branch; a flake is fixed or
quarantined (`process.md` § Flakes). Never re-run a red check until it
passes.

## 7. The merge

```bash
gh pr merge <n> --squash --match-head-commit "$sha" --subject "<title> (#<n>)"
```

Only on green, only the SHA that was checked. Then watch `main`'s run: it
reuses the PR's verdict when the files are identical, and deploys the site
once green.

## 8. Clean up

```bash
git -C <repo> worktree remove ../auracle-wt-<topic>
git -C <repo> branch -D claude/<topic>
gh issue view <n> --json state          # closed by "Closes #<n>"; close it by hand if not
```

Update the plan's progress table (the task's issue and PR) when the PR did not.

## Status

Report done, running and next, by PR and issue number. No date estimates.
