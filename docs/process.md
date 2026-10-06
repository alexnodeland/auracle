# How work flows

How a change gets from an idea to `main` and the live site. This is the
canonical description: when practice changes, this page changes in the same PR.
It was settled by [RFC-009](proposals/009-how-work-flows.md) and is recorded as
[ADR-019](decisions/019-work-flows-through-issues-and-prs.md), as
[ADR-020](decisions/020-merge-at-green-one-pr-in-ci.md) and
[ADR-021](decisions/021-merges-go-through-mergifys-queue.md) amend it. The `ship` skill
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
| 8. Proposed | A pull request that closes the issue, labelled `queue` | GitHub PRs | The operator, or a contributor for their own branch |
| 9. Checked | A green `CI` check | GitHub Actions | CI |
| 10. Merged | One squash commit on `main`, once `CI` is green on top of `main` | `main` | The merge queue (Mergify) |
| 11. Shipped | `main` verified (reused or run), the site deployed from CI's build | GitHub Actions, Pages | CI |
| 12. Closed | The issue closed, the plan's progress updated, the worktree removed | | The operator |

Small fixes skip stages 2–4: an issue (or a failing test) is enough. Stages 2
and 3 are for changes big enough to argue about first, as
[`README.md`](README.md#which-record-gets-what) says.

**The operator** is whoever coordinates the work: the maintainer, or a lead
session acting for them. Agents commit on their branch; the operator pushes
it, opens the PR with the `queue` label, and cleans up once the merge queue
has merged it. A human contributor pushes their own branch (or fork) and
opens their own PR; the maintainer reviews it and puts it in the queue.
Either way there is one merge queue and one place where "is this ready?" is
decided.

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
  (adding the label starts a run, and every push to the PR runs it again).
  Without it the *Slow suite* does not run on a PR at all.
- **Merging:** `queue` on a PR puts it in the merge queue
  ([CI and merging](#ci-and-merging)). `dequeued` is Mergify's, on a PR that
  left the queue without merging.
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
  the browser queue on its own port. Not the full suite: CI runs it twelve wide.
- **Sized for one review round.** A brief that will not fit one round of
  review is split before the builder starts: two PRs that each merge on
  their first green run land sooner than one that goes round three times.
- **Rebasing while building or in review** is only to resolve a conflict,
  or to move a branch built on the one ahead onto `main` once that one has
  merged ([CI and merging](#ci-and-merging)). The merge queue brings a PR up
  to date with `main` itself.
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
- **Cache-busters:** none to bump. `index.html` names `style.css` and
  `main.js` plainly, and the copies the site and the bundle ship get each
  file's content hash (`www/stamppage.py`, run by `make site` and
  `make bundle`). The modules, the worker and the engine are stamped from
  `pkg/build.json` (`make wasm-stamp`). The dev server sends `no-store`.

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

Findings come back ranked, and review is **one round**:

- **Blocking findings** are fixed on the branch before the PR, and the
  fixes, not the whole branch, get a second look:
  - a wrong result;
  - a dropped capability;
  - an untrue description;
  - a spec that can pass vacuously or that a slow runner can fail.
- **Every other finding** becomes an issue, named in the PR body. It is not
  more commits on the branch: a branch that grows in review runs CI again,
  and every run is another roll of the flaky dice.
- A finding the operator declines is said in the PR body with the reason.

## Pull requests

- The operator pushes an agent's branch and opens the PR, in the merge queue:
  `gh pr create --base main --head claude/<topic> --title "<what is true now>" --body-file <file> --label queue`.
  A contributor opens theirs from their own branch or fork, and the
  maintainer adds the label once it is reviewed.
- **The body** says what changed for a player or a contributor, why, how
  (the decisions a reviewer should look at), and what was checked (gates,
  specs and their counts, the review and what it found). It closes the issues
  it finishes (`Closes #N`). Most PRs have one; a Dependabot bump, or a small
  fix seen in passing, may stand alone, and its body says why it is needed.
  When an agent session made the PR, the body ends with the session's link
  line. The body becomes the squash commit's body on `main`, under the
  subject `<title> (#<n>)`.
- `.github/PULL_REQUEST_TEMPLATE.md` is the checklist.

## CI and merging

CI is the gate ([`architecture/testing.md` § CI tiers](architecture/testing.md#ci-tiers)):

- **The required check is `CI`.** It holds Lint, Web, Site, Browser smoke
  (after Site), the Rust tests and their coverage, and the browser tier,
  dealt to twelve runners by time, about eleven minutes. A PR that changes
  only specs runs only those specs.
- **The *Slow suite* runs on a PR only with `full-ci`.** Add the label to a
  PR that changes what the slow tests cover: any crate, `Cargo.toml` or
  `Cargo.lock`, `rust-toolchain.toml`, the `Makefile`, `slow-suite.yml` or
  `.github/actions/`; `apps/web/`'s `worker.js`, `farm.js`, `perform.js`,
  `patch.js`, `live-audio.js`, `audio-in.js`, `explain.js`, `faces.js` or
  `vessel.js`; `tests/web/`'s `fixtures.js`, `playwright.config.js`,
  `package.json` or `package-lock.json`; a spec file that holds an `@slow` or
  `@quarantine` test; or a `main.js` change that reaches EVOLVE's
  generations or PERFORM's offers. It does not block merging; without it,
  the push to `main` is where a slow test catches the change.
- **Wait on the state, never a fixed time:** poll until the run completes,
  or the PR merges or leaves the queue, then read what happened.
- **The merge queue merges**
  ([ADR-021](decisions/021-merges-go-through-mergifys-queue.md)). Mergify's
  queue, set up in `.mergify.yml`, is how a PR reaches `main`:
  - A reviewed PR is opened with the `queue` label; adding it is the one act
    of enqueueing. A `@mergifyio queue` comment does the same.
  - It enters the queue once its `CI` is green. The queue takes one PR at a
    time, in order, and checks it on its own branch.
  - At the front, a PR that `main` moved under is rebased onto `main`, and
    `CI` runs again on that head. A PR already on `main`'s tip merges on the
    run it has.
  - The queue squash-merges the head that passed, so nothing pushed after
    the check merges unchecked. The commit is `<title> (#<n>)` with the PR's
    body.
- **A red `CI` takes the PR out of the queue, and nothing is retried.**
  Mergify's automatic retries are off, and a red check is never re-run until
  it passes.
  - The PR gets the `dequeued` label; its *Mergify Merge Queue* check and the
    queue's comment say why it left.
  - A red run is read, then fixed or quarantined on the branch
    ([Flakes](#flakes)). The queue may have rebased the branch, so the
    worktree is reset to the branch on GitHub before the fix is committed.
  - It goes back in with `@mergifyio queue` (the `queue` label stays on).
    A run that was cancelled rather than failed goes back in as it is.
  - A PR whose own first run is red never entered the queue: it enters once
    a fix makes `CI` green.
- **GitHub enforces it.** `main`'s ruleset requires the `CI` check, from
  GitHub Actions, with no bypass for anyone, admins and the queue included.
  It does not require the branch to be up to date with `main`; the queue
  does that. To merge anything else, the maintainer edits the ruleset.
- **Merge at green.** A PR whose `CI` is green and that has no blocking
  finding is in the queue then. Nothing is added to a green PR. A finding
  raised after it, or an improvement seen in passing, becomes an issue or the
  next PR ([ADR-020](decisions/020-merge-at-green-one-pr-in-ci.md)).
- **A line of PRs.** The next PR in a line may be built on the branch of the
  one ahead. It is pushed only once that one has merged, moved onto `main`
  first: `git rebase --onto origin/main <the one ahead's last head>`. Don't
  push it stacked on the one ahead: a squash merge gives `main` one new
  commit, and the branch behind, still carrying the old ones, conflicts
  wherever both PRs changed the same lines (`CHANGELOG.md`'s Unreleased
  section, nearly always).
- **A conflict with `main` takes a PR out of the queue.** Two PRs that both
  edit the same lines (the top of `CHANGELOG.md`'s Unreleased section, most
  often) can't both be rebased: the second leaves the queue. Rebase it on
  `main` by hand, push with
  `--force-with-lease=<branch>:<the head on GitHub>`, and queue it again.
- **By hand, only when Mergify is down:**
  `gh pr merge <n> --squash --match-head-commit <sha> --subject "<title> (#<n>)"`,
  at green, on a PR up to date with `main` (rebased and run again if `main`
  moved). A merge from outside the queue makes it start over on the new
  `main`.
- **Linear:** one merge queue, at most two streams of work in flight and
  never two touching the same files.
- **On `main`**, a job the merged PR already passed is not run again when
  the merged files are exactly the files the PR's run tested (the same git
  tree). Through the queue they always are: it merges a PR only on a run
  that tested it on `main`'s tip. The site deploys from CI's own build once
  `CI` is green. `main`'s runs queue, so each merge gets its own run. The
  *Slow suite* runs on every push to `main` and nightly; the *Flake hunt*
  nightly. A failure there files an issue.

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
4. **On a PR, an unrelated failure is quarantined on sight.** The failure
   qualifies when all three hold:
   - the test is in a file the PR doesn't touch;
   - it fails on behaviour the PR doesn't change;
   - its trace shows a cause outside the PR.

   It gets one commit on that PR: the tag and its issue. The PR goes on, and
   the root cause is the issue's job, not the PR's. In doubt, the failure is
   the PR's.

The nightly *Flake hunt* runs the gate's browser tests three times each
against `main` and files an issue when one fails.

## Dependencies

Dependabot opens one grouped PR a week for the actions and one for
`tests/web`'s npm packages. They are handled like any PR, one at a time and
behind the work in flight: their CI runs are cancelled while they would take
runners from active work, then rebased (`@dependabot rebase`) and given the
`queue` label. A major version gets its release notes read before it is
queued.

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
