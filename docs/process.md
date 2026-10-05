# How work flows

How a change gets from an idea to `main` and the live site. This is the
canonical description: when practice changes, this page changes in the same PR.
It was settled by [RFC-009](proposals/009-how-work-flows.md) and is recorded as
[ADR-019](decisions/019-work-flows-through-issues-and-prs.md). The `ship` skill
(`.claude/skills/ship/`) walks one task through it with the exact commands.

## The lifecycle

| Stage | What it produces | Where it lives | Who |
| --- | --- | --- | --- |
| 1. Something worth doing | An issue | GitHub issues | Anyone |
| 2. Worth arguing first? | A proposal (RFC) | [`proposals/`](proposals/) | The maintainer decides |
| 3. Accepted | An ADR for each decision the RFC makes, and a plan when the work spans more than one PR | [`decisions/`](decisions/), [`plans/`](plans/) | |
| 4. Planned | One issue per plan task, in the plan's milestone | GitHub issues | The operator |
| 5. Briefed | What the builder needs: scope, decisions, tests, docs, report | The issue body, or a brief it links | The operator |
| 6. Built | Commits on `claude/<topic>`, in a worktree of its own | A branch | An agent, or a person |
| 7. Reviewed | Ranked findings, fixed; the fixes re-reviewed | The review's report | The `reviewer` agent |
| 8. Proposed | A pull request that closes the issue | GitHub PRs | The operator, or a contributor for their own branch |
| 9. Checked | A green `CI` check | GitHub Actions | CI |
| 10. Merged | One squash commit on `main` | `main` | The operator |
| 11. Shipped | `main` verified (reused or run), the site deployed from CI's build | GitHub Actions, Pages | CI |
| 12. Closed | The issue closed, the plan's progress updated, the worktree removed | | The operator |

Small fixes skip stages 2–4: an issue (or a failing test) is enough. Stages 2
and 3 are for changes big enough to argue about first, as
[`README.md`](README.md#which-record-gets-what) says.

**The operator** is whoever coordinates the work: the maintainer, or a lead
session acting for them. Agents commit on their branch; the operator pushes
it, opens the PR, merges and cleans up. A human contributor pushes their own
branch (or fork) and opens their own PR; the maintainer reviews and merges
it. Either way there is one merge queue and one place where "is this ready?"
is decided.

## Issues

Every piece of outstanding work is an issue: a plan task, a bug, a flaky test,
a follow-up a review raised, a dependency bump. Nothing outstanding lives only
in a plan's prose, a session's notes or a conversation.

- **Types** (one label each): `task` (planned work, usually a plan task),
  `bug`, `flake` (a test that passes only sometimes), `enhancement`,
  `documentation`, `dependencies`.
- **Areas** (as many as apply): `area:engine`, `area:web`, `area:tests`,
  `area:ci`, `area:site`, `area:films`.
- **Plans:** `plan-005`, `plan-008`, and one per plan that gets tasks.
- **State:** `quarantined` (a test tagged `@quarantine` for this issue),
  `blocked` (waiting on another issue or on the maintainer; the body says
  which).
- **CI:** `full-ci` on a PR asks the *Slow suite* to run on it in full
  (adding the label starts a run).
- **Milestones:** one per plan ("Plan-008: the shell", "Plan-005: the sound at
  the centre"), and one per standing stream of work ("Testing and CI",
  "Films: Wave 3", "fugue 0.2.3"). An issue with no milestone is the backlog:
  real, not yet scheduled.
- **Titles** say the outcome, not the activity: "Faces on the PRESETS rows",
  not "Work on preset faces". A flake's title is `Flaky: <file> '<test title>'`.
- **Bodies** follow the templates in `.github/ISSUE_TEMPLATE/`: a task names
  its plan, its brief and what done means; a flake names the test, the run
  that caught it, why it fails, the fix, and whether it is quarantined.
- **Plans link their issues.** A plan's progress table has an issue column,
  and each task row links its issue and, once merged, its PR. The plan stays
  the design; the issue tracks the work.

## Building

- **One worktree per branch**, beside the main checkout:
  `git worktree add -b claude/<topic> ../auracle-wt-<topic> origin/main`.
  An agent's branch is `claude/<topic>`; a contributor names theirs as
  [`CONTRIBUTING.md` § Workflow](../CONTRIBUTING.md#workflow) says. Never build
  in the main checkout while other work is in flight there.
- **Builders commit only.** An agent never pushes, opens a PR or merges. Its
  commits are small, one area each, each leaving the app working.
- **Commit messages** explain why (root `AGENTS.md` rule 8). They carry
  `Refs #N` when an issue exists. No hand-written attribution trailers: no
  `Co-Authored-By`, no "generated with" line, no model name or version. When
  the session asks for a session link line, it is the message's last line and
  nothing follows it.
- **The gates a builder runs** are the fast ones for what changed (the `check`
  skill) and the specs it added or touched (`make browser-changed`), through
  the browser queue on its own port. Not the full suite: CI runs it eight wide.
- **Rebasing while building or in review** is only to resolve a conflict with
  `main`. The rebase that matters is the one before the merge
  ([CI and merging](#ci-and-merging)).
- **Descriptions stay true in the same change**
  ([ADR-004](decisions/004-descriptions-stay-true.md)): the guide, the
  reference, in-app copy, `CHANGELOG.md`, and the plan's as-built section.
- **Drop no functionality.** When something moves or is retired, every
  capability keeps a home by mouse, keyboard and touch, and the builder's
  report has the before → after table that shows it. Where a capability has
  no home, the builder stops and asks.
- **New words:** a new term, label or phrase that `www/brand/voice.md`'s word
  table governs gets a row there before it ships, and the maintainer approves
  every change to that guide ([ADR-013](decisions/013-one-voice.md),
  [`voice.md` § How this is kept](../www/brand/voice.md#how-this-is-kept)).
  The builder drafts the rows in its report; the operator batches them into
  one question; the approved rows are committed. A sentence written in the
  existing words (most toasts and status lines) needs no row, only the voice
  check.
- **Cache-busters:** a change to `apps/web/style.css` or `main.js` bumps its
  `?b=` in `index.html`. When two branches both bump it, the one that merges
  second takes a value above main's at its rebase: a cache-buster only has to
  differ from what the browser last loaded, but a value that only rises reads
  as history.

## Review

Every branch is reviewed before its PR, by the `reviewer` agent (read-only)
or a person, against:

- **Correctness**, with a concrete scenario for each finding (inputs, state,
  wrong result), verified by running something where it can be.
- **Drop nothing:** everything the change moved is still reachable by mouse,
  keyboard and touch.
- **Truth:** ADR-004 (every description of the changed behaviour) and
  [ADR-012](decisions/012-motion-shows-what-the-engine-does.md) (every mark
  and motion an engine fact).
- **Spec robustness** under the no-retry policy: waits on states, never on
  times; no exact count of something a slow runner may do twice; no
  assertion that can pass vacuously.
- **The area's invariants** (its `AGENTS.md` and ADRs).

Findings come back ranked. The builder fixes them on the branch; the fixes,
not the whole branch, get a second review. A finding the operator declines is
said in the PR body with the reason.

## Pull requests

- The operator pushes an agent's branch and opens the PR:
  `gh pr create --base main --head claude/<topic> --title "<what is true now>" --body-file <file>`.
  A contributor opens theirs from their own branch or fork.
- **The body** says what changed for a player or a contributor, why, how
  (the decisions a reviewer should look at), and what was checked (gates,
  specs and their counts, the review and what it found). It closes the issues
  it finishes (`Closes #N`). Most PRs have one; a Dependabot bump, or a small
  fix seen in passing, may stand alone, and its body says why it is needed.
  When an agent session made the PR, the body ends with the session's link
  line.
- `.github/PULL_REQUEST_TEMPLATE.md` is the checklist.

## CI and merging

CI is the gate ([`architecture/testing.md` § CI tiers](architecture/testing.md#ci-tiers)):

- **The required check is `CI`.** It holds Lint, Web, Site, the Rust tests and
  the browser tier, dealt to eight runners by time, about ten minutes. A PR
  that changes only specs runs only those specs.
- **Wait on the run's state, never a fixed time:** poll until it completes,
  then read its jobs.
- **Merge on green only:** `gh pr merge <n> --squash --match-head-commit <sha>`,
  so nothing pushed after the check is merged unchecked. Never merge red, and
  never re-run a red check until it passes: a red check is read, then fixed
  or quarantined ([Flakes](#flakes)).
- **GitHub enforces it.** `main`'s ruleset requires the `CI` check, from
  GitHub Actions, with no bypass for anyone, admins included. It does not
  require the branch to be up to date with `main`; the rule below does that
  where it matters. To merge anything else, the maintainer edits the
  ruleset.
- **Before the merge, catch up with `main`:**
  - if `main` moved since the PR's CI run and the PR touches the app, the
    tests, the crates or CI (`apps/`, `tests/`, `crates/`, `Cargo.*`, the
    `Makefile`, `.github/`), rebase it on `main`, push with
    `git push --force-with-lease`, wait for CI on the new head, and merge that
    SHA;
  - a PR that changes only docs may merge behind `main`. Its merged files
    then differ from the ones its run tested, so `main`'s run reuses nothing
    and verifies it in full.
- **Linear:** one merge queue, at most two streams of work in flight and
  never two touching the same files.
- **On `main`**, a job the merged PR already passed is not run again, but only
  when the merged files are exactly the files the PR's run tested (the same
  git tree): `main` did not move between the PR's run and its merge. The site deploys from CI's
  own build once `CI` is green. The *Slow suite* runs on every push to `main`
  and nightly; the *Flake hunt* nightly. A failure there files an issue.

After the merge: the issue closes (via `Closes #N`), the plan's progress table
gets the PR, and the PR's branch deletes itself on GitHub (the repository
deletes merged branches). Remove the worktree and the local branch:
`git worktree remove ../auracle-wt-<topic>`, `git branch -D claude/<topic>`.

## Flakes

No retries, on the gate or anywhere else. A test that passes only sometimes is
a finding about the app or the test.

1. **Read it.** The run's summary links one HTML report of every browser
   runner, with traces. Decide whether the app, the test or the machine is at
   fault.
2. **Fix it** when the cause is clear: a wait on a time rather than a state,
   an injected reply the engine can overwrite, a count a slow runner can
   double, a bound with no slack, or a real race in the app.
3. **Or quarantine it** while it is fixed: open a `flake` issue (the template
   says what goes in it), tag the test `@quarantine` with a comment naming the
   issue, label the issue `quarantined`. It leaves the gate and runs in the
   *Slow suite*. The PR that fixes it removes the tag and closes the issue.

The nightly *Flake hunt* runs the gate's browser tests three times each
against `main` and files an issue when one fails.

## Dependencies

Dependabot opens one grouped PR a week for the actions and one for
`tests/web`'s npm packages. They are handled like any PR, one at a time and
behind the work in flight: their CI runs are cancelled while they would take
runners from active work, then rebased (`@dependabot rebase`) and merged on
green. A major version gets its release notes read before the merge.

## Releases and publishing

Cutting a release is in [`CONTRIBUTING.md` § Cutting a release](../CONTRIBUTING.md#cutting-a-release).
Publishing anything outside this repository (a crate, an npm package, a
release of quiver or fugue) is confirmed with the maintainer each time, even
when the change that needs it was approved.

## Status updates

Report what is done, what is running and what is next. No calendar estimates.
Name PRs and issues by number, and say plainly when something failed, was
skipped or is waiting on the maintainer.

## The machine

- Every browser job goes through `www/video/tools/one_browser.sh`, on its own
  port from a worktree
  ([ADR-010](decisions/010-tests-share-the-browser-recordings-do-not.md)). The
  operator hands each branch a free port (8771 and up) in its brief; set it as
  `AURACLE_TEST_PORT`, which Playwright and `make browser-changed`,
  `browser-fast` and `browser-slow` all use. No film recording while other
  browser work runs.
- Stop a process by its PID, never by `pkill -f`.
- Never a bare `git stash`: the stash is shared between worktrees. Commit, or
  stash with a name and pop that one.
