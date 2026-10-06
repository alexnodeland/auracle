# How work flows

How a change gets from an idea to `main` and the live site. This is the
canonical description: when practice changes, this page changes in the same PR.
It was settled by [RFC-009](proposals/009-how-work-flows.md) and is recorded as
[ADR-019](decisions/019-work-flows-through-issues-and-prs.md), as
[ADR-020](decisions/020-merge-at-green-one-pr-in-ci.md),
[ADR-021](decisions/021-merges-go-through-mergifys-queue.md) and
[ADR-023](decisions/023-the-gate-runs-in-the-queue.md) amend it. The `ship` skill
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
| 9. Checked | A green `CI` check on the PR (the fast lane), then the full gate green on the queue's batch | GitHub Actions | CI |
| 10. Merged | One squash commit on `main`, once the full gate is green on top of `main` | `main` | The merge queue (Mergify) |
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
  ([CI and merging](#ci-and-merging)). `priority` on a PR that fixes CI or a
  flaky test puts it at the front of the queue. `dequeued` is Mergify's, on
  a PR that left the queue without merging.
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
  the browser queue on its own port. Not the full suite: the merge queue's
  run of CI runs it twelve wide.
- **Sized for one review round.** A brief that will not fit one round of
  review is split before the builder starts: two PRs that each merge on
  their first green run land sooner than one that goes round three times.
- **Rebasing while building or in review** is only to resolve a conflict,
  or to move a branch built on the one ahead onto `main` once that one has
  merged ([CI and merging](#ci-and-merging)). The merge queue tests a PR on
  top of `main` itself, without touching its branch.
- **Descriptions stay true in the same change**
  ([ADR-004](decisions/004-descriptions-stay-true.md)): the guide, the
  reference, in-app copy, the changelog entry (`changelog.d/<topic>.md`,
  which a release moves into `CHANGELOG.md`), and the plan's as-built
  section.
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
  times; no exact count of something a slow runner may do twice; no speed
  bound but a budget
  ([ADR-022](decisions/022-a-slow-runner-makes-a-test-slower-never-wrong.md));
  no assertion that can pass vacuously.
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
  `gh pr create --base main --head claude/<topic> --title "<what is true now>" --body-file <file> --label queue`,
  then comments `@mergifyio queue` on it, which queues it until the label
  alone does ([CI and merging](#ci-and-merging)).
  A contributor opens theirs from their own branch or fork, and the
  maintainer adds the label and the comment once it is reviewed.
- **The body** says what changed for a player or a contributor, why, how
  (the decisions a reviewer should look at), and what was checked (gates,
  specs and their counts, the review and what it found). It closes the issues
  it finishes (`Closes #N`). Most PRs have one; a Dependabot bump, or a small
  fix seen in passing, may stand alone, and its body says why it is needed.
  When an agent session made the PR, the body ends with the session's link
  line. The body stays on the PR: the squash commit on `main` is
  `<title> (#<n>)` with the PR's commit messages as its body (the
  repository's squash setting), so each commit's why reaches `main`.
- `.github/PULL_REQUEST_TEMPLATE.md` is the checklist.

## CI and merging

CI is the gate ([`architecture/testing.md` § CI tiers](architecture/testing.md#ci-tiers)),
in two lanes ([ADR-023](decisions/023-the-gate-runs-in-the-queue.md)):

- **A PR's own run is the fast lane.** Its `CI` check holds Lint, Coverage
  (the Rust tests) and the Doctests when Rust changed; Web and Site when the
  site, the docs or the app changed (Web alone for a script's own tests, and
  nothing more for a changelog entry, which *What changed* checks on every
  run); Browser smoke when the app, the engine or what runs the specs changed
  (not the specs' lint, which no browser reads); Worker protocol
  (`make worker-test`) when the app, the engine or `tests/worker/` changed;
  and the browser specs the change reaches
  (`tests/web/changed.mjs`, as `make browser-changed` picks them), on up to
  four runners. About five minutes for docs; up to about ten when Rust
  changed (Coverage sets the length) or an app module's specs run (`patch.js`
  reaches about 23 test-minutes, on four runners).
  - A change whose specs can't be told (`main.js`, `worker.js`, `index.html`,
    `style.css`, a crate) runs the smoke and no other spec. So does a helper
    that more than twenty spec files require, or a change to more than
    twenty spec files. For `worker.js`, Worker protocol is the check.
  - A change to CI itself (`.github/workflows/`, `.github/actions/`) runs the
    full gate in its own lane.
  - **A green PR is fit to queue, not proven.** The fast lane is quick word on
    what the PR changed. The full gate is the merge queue's run.
- **The merge queue's run is the full gate.** Everything, as on `main`:
  Lint, Web, Site, Coverage, the Doctests, Worker protocol and the browser
  tier on twelve runners, about twelve minutes, on the tree the batch makes on top of
  `main`. It is CI on a draft PR the queue opens from a branch under
  `mergify/merge-queue/`.
- **The required check is `CI`,** in both lanes. `main`'s ruleset requires
  it on a PR's head commit, from GitHub Actions, with no bypass for anyone,
  admins and the queue included; the fast lane's `CI` is what meets it when
  the queue merges the PR. It does not require the branch to be up to date
  with `main`: the queue tests on top of `main` itself. To merge anything
  else, the maintainer edits the ruleset.
- **Every PR also runs *Mutants*,** a workflow of its own, part of neither
  lane's `CI` and not required. On a PR that changes a crate it tests the
  changed code: its summary lists the mutants of it that no test noticed,
  and review treats each as a finding. The builder runs
  `make mutants DIFF=1` before review, so they are answered before the PR.
  On the queue's draft PRs it passes at once, since each PR's own run has
  judged their code.
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
  ([ADR-021](decisions/021-merges-go-through-mergifys-queue.md),
  [ADR-023](decisions/023-the-gate-runs-in-the-queue.md)). Mergify's queue,
  set up in `.mergify.yml`, is how a PR reaches `main`:
  - A reviewed PR is opened with the `queue` label, and a
    `@mergifyio queue` comment queues it. The comment is the act of
    enqueueing for now: the label queues a PR through Mergify's auto-merge
    conditions, which act only while Merge Protections is active for the
    repository in Mergify's dashboard, and that is the maintainer's to switch
    on. Once it is, the label alone queues a PR, and the comment is only for
    putting one back.
  - It enters the queue once its fast lane's `CI` is green.
  - The queue tests up to three queued PRs together, a batch, on a draft PR
    of its own, on top of `main`: one full gate for the batch. A batch waits
    at most three minutes for company. One batch is tested at a time.
  - Green, the queue squash-merges each PR of the batch on its own, the head
    that was tested, so nothing pushed after the check merges unchecked. Each
    commit is `<title> (#<n>)` with the PR's commit messages. The queue never pushes to
    a PR's branch.
  - A PR labelled `priority`, a fix to CI or to a flaky test, goes into the
    next batch ahead of everything else queued. The batch being tested goes
    on.
  - A release PR (labelled `release`: `CONTRIBUTING.md` § Cutting a release)
    is queued on its own, tested alone and merged alone, also ahead of the
    rest, so its merge commit's tree is exactly the tree the full gate
    tested.
- **A PR can be green on its own run and red in the queue.** Then its batch
  is split: Mergify tests the parts, the first part first, merges a part that
  passes and splits a part that fails again. A PR that fails on its own is
  the one at fault. The others go on, and nothing is retried: Mergify's
  automatic retries are off, and a red check is never re-run until it
  passes.
  - The PR at fault gets the `dequeued` label; its *Mergify Merge Queue*
    check and the queue's comment say why it left and which check failed.
    The red run is the draft PR's, on its `mergify/merge-queue/` branch.
  - The red run is read, then fixed or quarantined on the branch
    ([Flakes](#flakes)).
  - It goes back in with `@mergifyio queue` (the `queue` label stays on).
    A run that was cancelled rather than failed goes back in as it is.
  - A flake in the queue lands on someone: Mergify doesn't run the red batch
    again, so the PR it was last narrowed to is dequeued, though it changed
    nothing the failed test covers. A dequeued PR whose red run failed a
    test it doesn't touch, for a cause outside it, is a flake case
    ([Flakes](#flakes), step 4): the test is quarantined with one commit on
    that PR, and the PR goes back in.
  - A PR whose own fast lane is red never entered the queue: it enters once a
    fix makes `CI` green.
- **Merge at green.** A PR whose `CI` is green and that has no blocking
  finding is in the queue then. Nothing is added to a green PR. A finding
  raised after it, or an improvement seen in passing, becomes an issue or the
  next PR ([ADR-020](decisions/020-merge-at-green-one-pr-in-ci.md)).
- **A line of PRs.** The next PR in a line may be built on the branch of the
  one ahead. It is pushed only once that one has merged, moved onto `main`
  first: `git rebase --onto origin/main <the one ahead's last head>`. Don't
  push it stacked on the one ahead: a squash merge gives `main` one new
  commit, and the branch behind, still carrying the old ones, conflicts
  wherever both PRs changed the same lines.
- **A conflict takes a PR out of the queue.** Two PRs that both edit the same
  lines can't go in one batch. The second is held, keeping its place, while
  the one ahead is in the queue; once that one merges, the second conflicts
  with `main` and leaves the queue. A conflict with `main` itself takes a PR
  out at once. Changelog entries never conflict, since each is a file of its
  own in `changelog.d/`. Rebase it on `main` by hand, push with
  `--force-with-lease=<branch>:<the head on GitHub>`, and queue it again.
- **By hand, only when Mergify is down:** on a PR up to date with `main`
  (rebased if `main` moved), run CI by hand on its branch (Actions → CI → Run
  workflow: a run by hand is the full gate), and once that run and the PR's
  `CI` are green,
  `gh pr merge <n> --squash --match-head-commit <sha> --subject "<title> (#<n>)"`.
  Nothing enforces the full run first: the ruleset requires only `CI` on
  the PR's head, the fast lane, so a merge by hand without it lands code
  that only the fast lane has seen. A merge from outside the queue makes
  the queue start over on the new `main`.
- **Linear:** one merge queue, at most two streams of work in flight and
  never two touching the same files.
- **On `main`**, a job the queue's run already passed is not run again when
  `main`'s files are exactly the files that run tested (the same git tree):
  the last merge of every batch. The site deploys from CI's own build once
  `CI` is green. `main`'s runs keep the latest only: a batch lands as two or
  three merges seconds apart, a run in progress finishes, the newest waiting
  run replaces any older one, and a run whose commit `main` has already moved
  past runs nothing, since the newest run covers it. The *Slow suite* runs on
  `main` the same way, and nightly; the *Flake hunt* nightly. A failure there
  files an issue. *Mutants* runs weekly over a part of the workspace (a
  fifteen-week cycle aims to cover it all), and a surviving mutant files
  one too
  ([`crates/AGENTS.md` § Mutation testing](../crates/AGENTS.md#mutation-testing)).

After the merge: the issue closes (via `Closes #N`), the plan's progress table
gets the PR, and the PR's branch deletes itself on GitHub (the repository
deletes merged branches). Remove the worktree and the local branch:
`git worktree remove ../auracle-wt-<topic>`, `git branch -D claude/<topic>`.

## Flakes

No retries, on the gate or anywhere else. A test that passes only sometimes is
a finding about the app or the test, when what failed is correctness. A slow
runner may make a test slower, never wrong
([ADR-022](decisions/022-a-slow-runner-makes-a-test-slower-never-wrong.md)):
how long something took is a budget, not a gate assertion.

1. **Read it.** The run's summary links one HTML report of every browser
   runner, with traces. Decide whether the app, the test or the machine is at
   fault.
2. **Fix it** when the cause is clear: a wait on a time rather than a state,
   an injected reply the engine can overwrite, a count a slow runner can
   double, a speed bound that should be a budget, or a real race in the app.
3. **Or quarantine it** while it is fixed: open a `flake` issue (the template
   says what goes in it), tag the test `@quarantine` with a comment naming the
   issue, label the issue `quarantined`. It leaves the gate and runs in the
   *Slow suite*. The PR that fixes it removes the tag and closes the issue.
4. **On a PR, an unrelated failure is quarantined on sight**, on its own run
   or in the queue's run that dequeued it. The failure qualifies when all
   three hold:
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
runners from active work, then rebased (`@dependabot rebase`), given the
`queue` label and queued. A major version gets its release notes read before
it is queued.

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
