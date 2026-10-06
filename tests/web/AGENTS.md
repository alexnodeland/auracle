# tests/web: the instrument in a real browser

Playwright specs against the real app and the wasm in `apps/web/pkg`. Nothing
in the app exists for the tests' sake: a spec reaches the engine worker by
wrapping `Worker` before `main.js` runs. Rules for the whole repo are in
[`../../AGENTS.md`](../../AGENTS.md); which spec proves what is in
[`docs/architecture/testing.md`](../../docs/architecture/testing.md).

## Running them

```bash
make wasm   # from the root, first, if any Rust the app calls has changed
cd tests/web
AURACLE_TEST_PORT=8690 ../../www/video/tools/one_browser.sh \
  npx playwright test [spec.js ...] --reporter=line
```

- **`AURACLE_TEST_PORT`** starts a server of the suite's own on that port
  (the `make browser-*` targets use it too, when it is set).
  Without it the config reuses whatever answers on `:8642`, which from a
  worktree is often the main checkout, so a green run can be the wrong app.
- **`one_browser.sh`** queues the run behind any rehearsal, recording or other
  suite. Two browsers at once make both late, and a timing assertion then
  fails for the machine, not the app.
- **`make smoke`** runs the pair CI's *Browser smoke* job runs after the
  site build on a PR that changes the app, the engine or what runs the specs
  (`smoke.spec.js`, `failure_flows.spec.js`), in seconds.
- **A failed test on the fixture** carries what its tap saw (every toast,
  and the counts of what was sent and heard) as the attachment `tap`;
  `AURACLE_TAP_LOG=1` prints it too.

## The two tiers

The suite is about an hour and a half in one worker, so CI splits it
([`docs/architecture/testing.md` § CI tiers](../../docs/architecture/testing.md#ci-tiers)):

- **Fast tier**: every test not tagged `@slow` or `@quarantine`, about
  seventy-five minutes in one worker. Part of the required `CI` check, in
  two lanes. The merge queue's run, the full gate, runs all of it, dealt to
  twelve runners by `shard.mjs` from main's last timings, about six minutes
  each. A PR's own run, the fast lane, runs only the specs its change reaches
  (`changed.mjs`, below), on up to four runners, and the smoke pair when it
  changes the app, the engine or what runs the specs (a helper, the config,
  the lockfile): for `main.js`, `worker.js` or a crate, the smoke pair and
  nothing else.
- **Slow tier**: the tests tagged `@slow` or `@quarantine`, about
  thirty-five minutes in one worker. The *Slow suite* workflow
  (`.github/workflows/slow-suite.yml`) runs them on main, nightly, and on a
  PR labelled `full-ci`, and on no other PR. It does not block merging. A
  separate nightly flake hunt (`flake-hunt.yml`) runs the fast tier three
  times over.

CI runs every browser job in Playwright's image
(`mcr.microsoft.com/playwright:v<version>-noble`), at the `@playwright/test`
version `package-lock.json` locks, so a bump of it moves CI's Chromium in the
same PR with nothing else to edit.

Run a tier locally the same way (after `make wasm`):

```bash
make browser-fast   # --grep-invert "@slow|@quarantine", queued, own port
make browser-slow   # --grep "@slow|@quarantine"
```

On a workstation, run the specs your change reaches and let CI run the rest:
the merge queue's run is the gate, and it runs them twelve wide. `make
browser-changed` runs the specs changed against `origin/main`, the specs of
a changed helper, and the specs named for a changed app module
(`changed.mjs`, which a PR's fast lane in CI uses too); for `main.js` and the
engine, which reach every level, name them by file or prefix
(`npx playwright test patch_ perform_layout.spec.js`). CI's fast lane runs
none of them for such a change, only the smoke pair, so this local run is
the one that sees them before the queue.

When CI fails, the run's summary links one HTML report of every runner, with
the failed tests' traces: download it and run `npx playwright show-report
<dir>` here. A runner that ran out of time is in it too: `shard.mjs`
interrupts the run a minute before Playwright's global timeout
(`AURACLE_GLOBAL_TIMEOUT_MIN`, which CI sets; none locally), and the test
that was running is reported as interrupted.

**Tagging a slow test.** A test that takes over about 40 s on CI (the list
reporter prints each test's time) goes in the slow tier: tag it in its
declaration with Playwright's tag syntax, leaving the title alone.

```js
test("EVOLVE POOL breeds beside you: …", { tag: "@slow" }, async ({ page }) => {
```

Tag the test, not the file: the rest of a file stays fast. A PR that adds
or changes one runs it before merging only with the `full-ci` label (the
push to main runs it either way), and so does a PR that changes what the
slow tests cover: in `tests/web`, `fixtures.js`, `playwright.config.js` or
`package*.json`; in `apps/web`, `worker.js`, `farm.js`, `perform.js`,
`patch.js`, `live-audio.js`, `audio-in.js`, `explain.js`, `faces.js` or
`vessel.js`; any crate, the Cargo files, `rust-toolchain.toml`, the
`Makefile`, `slow-suite.yml` or `.github/actions/`
([`testing.md` § CI tiers](../../docs/architecture/testing.md#ci-tiers)). A test that is slow only because it waits
on a fixed timer is better made faster than tagged.

**A flaky test** is fixed, or tagged `@quarantine` with a comment naming its
issue while it is fixed: it leaves the gate for the slow tier, where it still
runs. No retries anywhere
([`testing.md` § Flakes](../../docs/architecture/testing.md#flakes)).

## Writing a spec

- **Logic belongs in a unit test.** New logic lands in a pure module under
  `apps/web/` with a `node:test` in `apps/web/tests/` (`make web-check` runs
  them in milliseconds); a browser spec proves the wiring and what a player
  sees, not arithmetic. A boot is seconds, here and on CI (a median of 4
  to 5 s there, about 28% of the fast tier's test time).
- **What the engine worker answers belongs in a worker test.** A claim
  about a reply, its fields, or the order the worker answers in (its lanes,
  a long job giving way, what reaches the farm's ports) is a test in
  `tests/worker/` (`make worker-test`): `worker.js` as it is, over the built
  engine with no page, a request posted mid-call if the claim needs it
  ([`testing.md` § The levels](../../docs/architecture/testing.md#the-levels)).
  A spec holds the page's half: that a gesture sends the request, and what
  the reply does on screen or in the output. A spec that posts its requests
  through the tap (`app.post`) and reads only replies is a worker test in the
  wrong place.
- **Start from the fixture.** `const { test, expect } = require("./fixtures")`
  (`fixtures.js`), never `@playwright/test` directly (the lint holds this
  and the `pageerror` rule below, [§ The lint](#the-lint)):
  - **page errors fail the test by themselves** (the auto fixture
    `pageErrors`, on every page of the test's context): no spec collects
    `pageerror` or ends with `expect(errors).toEqual([])`.
    `test.use({ consoleErrors: true })` counts `console.error` too;
  - **`app`** installs the engine worker's tap before main.js runs, and
    `app.boot()` boots seeded twice over, the engine's random seed
    (`?seed=`) and the page's Math.random (as the films seed it), both
    `SEED`, so the pool, the warm start's cards and each pair's sides repeat
    run to run; with the warm start and the tours marked seen
    (`{ warmed: false }` shows the warm start, `seed: null, random: null`
    boots unseeded, `query: "?farm=0"` adds to the address, `slowEngine: 4`
    slows the engine's wasm, `workerPrefix` runs a spec's own code in the
    engine worker ahead of `worker.js`, kept on a throttled run too).
    PERFORM's specs boot with `{ seed:
    PERFORM_SEED, random: PERFORM_SEED }` instead, a seed whose first offer
    on Glass Pad is a typical one (SEED's is unusually light).
    `AURACLE_SEED=random` boots every spec that names no seed of its own
    unseeded, PERFORM's too (the nightly flake hunt does), and
    `AURACLE_SEED=N` with N;
  - what the engine said and was asked: `app.reply(type, { where, after })`
    waits for a reply main was handed (`where` a pattern or a function),
    `app.replies`, `app.last`, `app.count`, `app.sent`, `app.sentCount`,
    `app.log` (both directions, in order), `app.facts()` (views, ranked,
    ratings, status as main last heard them), `app.toast`/`app.toasts`;
  - a request and its answer: main numbers every request (`rid`), and each
    reply to it carries the number back (`re`, with `more: true` on all but
    the last; `docs/architecture/web-runtime.md` § The worker's replies).
    `app.replyTo(sent)` waits for the last reply to one request (as
    `app.sent` returns it), whatever its type and whatever lands first;
    `app.answered({ types, lanes })` waits until every request of those
    types, or in those lanes (`"bench"`: the bench lane's edits), sent so far
    has had its last reply, and names what it is still waiting for when it
    gives up; `app.unanswered(…)` lists them now. Neither waits for the
    requests the worker never answers (`UNANSWERED`) or a spec's own
    `app.post`. A reply the tap gives for a request (`app.answer`,
    `app.fail`) carries its `re`;
  - a state the engine reaches only by chance is handed to main with
    `app.inject(reply)`; **`app.hold(patterns, { inject })` keeps the
    engine's own replies of that kind from main while an injected one
    stands**, so a refit cannot overwrite it (#126); `app.release()` lets
    them through, in order. Requests are held (`app.holdRequests`), delayed
    (`app.delay`), stalled and answered by the spec (`app.stall`,
    `app.stalled`), answered without the engine (`app.answer`) or failed as
    the worker fails a request it could not run (`app.fail`: an
    `engine_error` naming it, `fatal` as a crashed engine answers
    everything, `once` for the next only), and replies rewritten before main
    reads them (`app.amend`);
  - a setting made before `app.boot()` (`app.answer`, `app.hold`, …) is
    replayed by an init script on every load, so it holds from the first
    message; made after, it holds on the page as it is;
  - a spec's own instrumentation (an observer, a spy on `start()`) is an
    init script added before `app.boot()`: it wraps outside the tap, and
    sees a held reply only when it is released.
- **Assert what a player sees or hears**: text on screen, a class that lights
  a control, an `AnalyserNode` level. Not internal variables. Where the
  message *is* the behaviour (a request not sent twice, a stale reply
  refused) assert it through the tap.
- **Wait for states, not times.** `expect(...)` and `expect.poll` wait 10 s
  by default (the config's `expect.timeout`): enough for anything the page
  does by itself. A wait on the engine (boot, the pool filling, a fit, a
  deal, a reply) goes through `app.engine((timeout) => …, { ms })`,
  `app.reply` or `app.booted`, bounded by `ENGINE_MS` (150 s) unless the
  call names its own bound: shorter for what is quick (a deal, 30 s), longer
  only where the engine's work is (the pool filling behind a refit, 300 s;
  a generation, 400 to 480 s). Its time is added to the test's timeout, so
  a slow runner's engine never eats the test's own 90 s, up to
  `ENGINE_CAP_MS` (450 s) in all for one test: past that, an engine that
  hangs fails the test rather than taking the shard's remaining time. When the app gets faster, a spec that expected to see
  an intermediate state may miss it: accept either state rather than slowing
  the app down. A timeout under about 1.5 s is a flake waiting to happen.
- **Time is one of three kinds**
  ([ADR-022](../../docs/decisions/022-a-slow-runner-makes-a-test-slower-never-wrong.md)):
  a slow runner may make a test slower, never wrong.
  - *An engine fact:* wait for the reply that answers your request (the
    request sent after the gesture, and its last reply by the number it
    carries back), through `app.replyTo`, `app.answered`, `app.reply` or
    `app.engine`, not for a time and not for the first reply of its type.
  - *A promise about the app's own timeline:* assert it on the app's clock.
    Read the state in the gesture's own task, inside the `page.evaluate` that
    makes it, before its first `await` (the pair swapped by the click, the
    offer handed over by the press); assert order through the tap (no `duel`
    request between the click and the cards changing, the sign up before the
    edit's reply landed: `app.log`, `app.sent`, `app.replies`); read the
    app's own marks (`app.marks("patch-opened")`, each with its `detail`).
    `page.clock` fast-forwards a main-thread window, in a spec that needs it
    only: it fakes `performance.now` and `requestAnimationFrame` too, which
    the tap and the rack's tweens read.
  - *A measurement of the machine's speed* ("within 300 ms") is a budget,
    never an `expect`: `app.budget(name, ms, limit)`, or `budget` from
    `./fixtures` in a spec not on the fixture yet. It records `budget: <name>
    <ms> ms of <limit> ms` on the test (the merged report shows it, and the
    run's summary lists those over) and never fails the gate;
    `AURACLE_PERF=1` judges it, as the nightly *Speed budgets* job does (at
    `AURACLE_CPU_THROTTLE=1`).
- **"Nothing happens" is `app.quiet()`**: the one fixed wait, `QUIET_MS`
  (1.5 s, the slack a loaded machine needs to do the wrong thing), for a
  check that something does not occur. A longer window says why in its
  call (`app.quiet(5_000)`, the window a behaviour was always watched over).
  A pause inside a gesture (a player's pace between picks, a drag's steps) is
  a named constant beside the spec's helpers, and its line says so to the
  lint ([§ The lint](#the-lint)). Any other `waitForTimeout` is a wait for
  something: wait for it.
- **Waiting on PERFORM's engine** (an offer or a drift growing, or the work
  queued ahead of it) is renders, seconds each on a CI runner: bound it with
  `app.offerBudget()` (`perform_budget.js`), not a fixed number
  ([`testing.md` § Rules](../../docs/architecture/testing.md#rules)). A
  preset reaches PERFORM with `app.openOnPerform(name)` (its controls
  reached; `{ wired: true }` none unwired, `{ reach: false }` not waited
  for, then `app.reached()`).
- **A test's timeout** is the config's 90 s unless it needs more: a test
  over about 45 s on CI says so with `test.setTimeout` (and over 40 s is
  tagged `@slow`, above).
- **Go to a level with `goLevel(page, level)`** (or `app.level`), into KEYS ⋯
  with `openKeys(page)`, to a bank with `bankTab(page,
  "pool"|"saved"|"presets")` and into the model view with `modelView(page,
  on)`, from `shell.js` (re-exported by `fixtures.js`). A bank row's guess
  (`.bi-pct`, `.bi-u`) shows only under the model view, its actions
  (`.bi-acts`) only on approach, and its stars through ★ or the 1–5 keys;
  find a row by its `data-id`, not by text. The app opens at PERFORM
  (Plan-008), so a spec about PATCH goes there first, and waits for the
  state it needs (the rack drawn, a pair named), not for a name or a time:
  PERFORM's first measurement runs at boot and moves when the rest lands.
- **PATCH's specs share `patch_page.js`**: a preset opened with its rack
  drawn and at rest (`openPreset`, and `rackAtRest` on a page: the camera's
  fit and the plates' moves are tweens, and a size read or a press aimed
  mid-way is at another zoom), the bench lane settled (`settled`, a state:
  every edit sent has had its last reply, and two frames later still has,
  so the rack is drawn; `laneCounts`), the model's guess as drawn and as asked (`drawnGuess`,
  `rankedGuess`, `guessAfter`), and a pinned fit (`pinPulls`). Every helper
  but `rackAtRest` takes the test's `app`.
- **A spec for every fix** of user-visible behaviour, named for the behaviour
  (`a bank row's cut appears on hover and can be pressed`).
- Not yet on the fixture (#170): `audio_in*`, `smoke`, `failure_flows` and
  the shell's and views' other specs (the lint's suppressions hold their
  imports and their `pageerror` listeners until they move). A spec moved onto
  it keeps every test's title (the timings and `testing.md` key on them).

## The lint

`make spec-lint` (part of `make web-check`, and so of CI's Web job) runs
ESLint over every `.js` and `.mjs` file here with `eslint.config.mjs`: the
Playwright plugin's recommended rules and the house rules of this file that a
syntax rule can see, every one an error. Then the lint's own tests
(`eslint.test.mjs`: each house rule on code it must flag and code it must let
through) and the suppressions' check (`suppressions.mjs`, below). It needs
this directory's packages: `npm ci` here, once (`make setup` does it, and
the `ship` skill does it in a new worktree). Where they are installed, the
after-edit hook lints a file here when you edit it, in under a second.

**Today's violations are a baseline that only goes down.**
`eslint-suppressions.json` holds each file's count of each rule as the lint
came in. A file passes at its count and fails above it or below it:

- **A count that rises fails.** ESLint then lists every hit of that rule in
  that file, not only the new one: find yours by its line.
- **A count that falls fails until it is recorded.** After the fix, run
  `npx eslint --prune-suppressions` here and commit the file with the fix.
- **A new spec starts at zero:** it has no entry.
- **Nothing is added to it.** `eslint --suppress-all` is not run again (it
  would take a new violation into the baseline), and the gate never passes
  `--pass-on-unpruned-suppressions`. `suppressions.mjs` holds the file to
  that: against the merge base with `BASE` (`origin/main`; CI's Web job
  compares with `HEAD^1`, the branch its merge commit went onto) no count
  may rise, no file's entry may gain a rule, and no file may gain an entry.
  With no git or no such commit it says so and skips the comparison.
- **A rule new to the set** (a house rule added, or one a plugin release adds
  to its recommended set, which then fails the lint in the bump's PR) has its
  findings taken in once, by name, in the PR that brings it:
  `npx eslint --suppress-rule <rule>`. The base holds the rule nowhere, so
  the check lets it in. A rule that widens (a selector that finds more, a
  plugin release that flags more of a rule already here) is not new: its new
  findings are fixed in that PR.
- **A renamed file** keeps its entry: move its key to the new name by hand,
  counts unchanged (the check takes an entry moved whole from a file that is
  gone as a rename). **A deleted file**'s entry goes with
  `npx eslint --prune-suppressions`. Either way, until then the check fails
  on a key that names no file (ESLint itself ignores it).
- **Run it from `tests/web`**, as `make spec-lint` and the hook do: the
  file's paths are relative to it.

The burn-down is the area PRs' (#178), each spec edited once.

**Fix it rather than suppress it.** What each rule asks for:

| Rule | Instead |
| --- | --- |
| `playwright/no-wait-for-timeout` | Wait for the state (`expect`, `expect.poll`, `app.reply`); "nothing happens" is `app.quiet()`. A gesture's pause is the one other kind: a named constant, its line under `// eslint-disable-next-line playwright/no-wait-for-timeout -- <the gesture>` |
| `playwright/prefer-web-first-assertions` | `await expect(locator).toHaveText(…)` (or `toHaveAttribute`, `toBeVisible` and the rest) retries until the page gets there; `expect(await locator.textContent())` reads once |
| `auracle/no-read-after-action` | A statement `expect(await …)` straight after a click, a press or another action reads once, before the app has answered: wait for the state (a web-first assertion, `expect.poll(() => …)`, `await expect(async () => { … }).toPass()`, `app.reply`). A read inside a `toPass` or `poll` callback is retried and passes |
| `playwright/no-conditional-in-test`, `playwright/no-conditional-expect` | No assertion inside a branch or over a list that can be empty (#178): a branch the run did not take checked nothing. Hold the state that decides it (`app.hold`, `app.stall`), or split the test |
| `playwright/missing-playwright-await` | Await every `expect(locator)` and `expect.poll`: without it the test moves on, and the check fails later or never |
| `playwright/no-networkidle` | Wait for what the page shows |
| `auracle/use-the-fixture` | `require("./fixtures")`. `boot_agrees.spec.js`, which opens no page, is the one spec that does not |
| `auracle/no-own-pageerror` | Nothing: the fixture's `pageErrors` fails the test on any page error |
| `auracle/no-runner-clock` | No `Date.now()` or `performance.now()` on the runner in a spec: the three kinds of time above. A read in the body of the function the page runs (`page.evaluate`, `addInitScript`, `waitForFunction`) is on the page's clock and passes; the call's other arguments are worked out on the runner (`page.evaluate(fn, Date.now())` is flagged) |
| `auracle/budget-not-expect` | `app.budget(name, ms, limit)`. It flags `toBeLessThan` (or `OrEqual`) on a name that holds a duration (`ms`, `took`, `elapsed`, `waitedFor`, `pickMs`) or on a difference (`t1 - t0`), against a number or a `…_MS` constant. It reads names, not values, so `expect(deals[0]).toBeLessThan(1_000)` passes it and review catches it; a difference that is not a time (two levels) is a false positive, below |
| `playwright/expect-expect` | A test checks something. The fixture's waits that fail when what they wait for never comes count as checks (`app.reply`, `app.toast`, `app.booted`, `app.engine`, `app.filled`, `app.fullPool`, `app.poolRows`, `app.reached`, `app.quiet`: `ASSERTING_WAITS` in `eslint.config.mjs`) |
| `auracle/no-aur-in-spec`, `auracle/aur-allow-list` | `window.__aur` is main's private state: assert what a player sees or what the tap heard. A read a spec cannot do without goes in a named helper (`fixtures.js`, `patch_page.js`), which may read only the members on `AUR_ALLOWED` in `eslint.config.mjs` (the ones the suite read when the lint came in); one more is a review decision |

**A false positive** is a disable on its line that names the rule and says
why after `--`, never a rewrite to please the rule:
`// eslint-disable-next-line <rule> -- <why>`. The lint holds that too
(`@eslint-community/eslint-comments`: a disable with no reason, or one that
names no rule, fails), and a disable nothing needs fails. Two plugin rules
misread the fixture's own names, and their fixes would break the test:

- `playwright/prefer-to-have-count` takes `expect(await app.count(type))`,
  the tap's count, for a locator's: `-- app.count is the tap's count, not a
  locator's`.
- `playwright/no-useless-await` takes `await app.last(type)`, a promise, for
  `Locator.last()`: `-- app.last is the tap's (a promise), not
  Locator.last()`.

Never run `eslint --fix` over the specs wholesale: a fix rewrites code no
one has read. The `.mjs` files (`shard.mjs`, `changed.mjs`, the lint's own)
are Node tools: parsed, and held to the comment rules, and nothing else.
