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
- **`make smoke`** runs the pair the site job runs (`smoke.spec.js`,
  `failure_flows.spec.js`), in seconds.
- **A failed test on the fixture** carries what its tap saw (every toast,
  and the counts of what was sent and heard) as the attachment `tap`;
  `AURACLE_TAP_LOG=1` prints it too.

## The two tiers

The suite is about an hour and a half in one worker, so CI splits it
([`docs/architecture/testing.md` § CI tiers](../../docs/architecture/testing.md#ci-tiers)):

- **Fast tier**: every test not tagged `@slow` or `@quarantine`, about
  seventy minutes in one worker. Part of the required `CI` check on any PR
  that touches `apps/web`, `tests/web` or the engine, dealt to eight runners
  by `shard.mjs` from main's last timings, about nine minutes each.
- **Slow tier**: the tests tagged `@slow` or `@quarantine`, about
  thirty-five minutes in one worker. The *Slow suite* workflow
  (`.github/workflows/slow-suite.yml`) runs them on main, nightly, on a PR
  that touches what they cover, and on a PR labelled `full-ci`. It does not
  block merging. A separate nightly flake hunt (`flake-hunt.yml`) runs the
  fast tier three times over.

Run a tier locally the same way (after `make wasm`):

```bash
make browser-fast   # --grep-invert "@slow|@quarantine", queued, own port
make browser-slow   # --grep "@slow|@quarantine"
```

On a workstation, run the specs your change reaches and let CI run the rest:
it is the gate, and it runs them eight wide. `make browser-changed` runs the
specs changed against `origin/main`, the specs of a changed helper, and the
specs named for a changed app module (`changed.mjs`); for `main.js` and the
engine, which reach every level, name them by file or prefix
(`npx playwright test patch_ perform_layout.spec.js`).

When CI fails, the run's summary links one HTML report of every runner, with
the failed tests' traces: download it and run `npx playwright show-report
<dir>` here.

**Tagging a slow test.** A test that takes over about 40 s on CI (the list
reporter prints each test's time) goes in the slow tier: tag it in its
declaration with Playwright's tag syntax, leaving the title alone.

```js
test("EVOLVE POOL breeds beside you: …", { tag: "@slow" }, async ({ page }) => {
```

Tag the test, not the file: the rest of a file stays fast. If it exercises
app code the slow tier's path filter does not cover, add that path to the
`scope` job in `slow-suite.yml`. A test that is slow only because it waits on
a fixed timer is better made faster than tagged.

**A flaky test** is fixed, or tagged `@quarantine` with a comment naming its
issue while it is fixed: it leaves the gate for the slow tier, where it still
runs. No retries anywhere
([`testing.md` § Flakes](../../docs/architecture/testing.md#flakes)).

## Writing a spec

- **Logic belongs in a unit test.** New logic lands in a pure module under
  `apps/web/` with a `node:test` in `apps/web/tests/` (`make web-check` runs
  them in milliseconds); a browser spec proves the wiring and what a player
  sees, not arithmetic. A boot is seconds here and tens of seconds on CI.
- **Start from the fixture.** `const { test, expect } = require("./fixtures")`
  (`fixtures.js`), never `@playwright/test` directly:
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
    slows the engine's wasm). `AURACLE_SEED=random` boots every spec that
    names no seed of its own unseeded (the nightly flake hunt does), and
    `AURACLE_SEED=N` with N;
  - what the engine said and was asked: `app.reply(type, { where, after })`
    waits for a reply main was handed (`where` a pattern or a function),
    `app.replies`, `app.last`, `app.count`, `app.sent`, `app.sentCount`,
    `app.log` (both directions, in order), `app.facts()` (views, ranked,
    ratings, status as main last heard them), `app.toast`/`app.toasts`;
  - a state the engine reaches only by chance is handed to main with
    `app.inject(reply)`; **`app.hold(patterns, { inject })` keeps the
    engine's own replies of that kind from main while an injected one
    stands**, so a refit cannot overwrite it (#126); `app.release()` lets
    them through, in order. Requests are held (`app.holdRequests`), delayed
    (`app.delay`), stalled and answered by the spec (`app.stall`,
    `app.stalled`), answered without the engine (`app.answer`), and replies
    rewritten before main reads them (`app.amend`);
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
  a slow runner's engine never eats the test's own 90 s. When the app gets faster, a spec that expected to see
  an intermediate state may miss it: accept either state rather than slowing
  the app down. A timeout under about 1.5 s is a flake waiting to happen.
- **"Nothing happens" is `app.quiet()`**: the one fixed wait, `QUIET_MS`
  (1.5 s, the slack a loaded machine needs to do the wrong thing), for a
  check that something does not occur. A longer window says why in its
  call (`app.quiet(5_000)`, the window a behaviour was always watched over).
  A pause inside a gesture (a player's pace between picks, a drag's steps) is
  a named constant beside the spec's helpers. Any other `waitForTimeout` is
  a wait for something: wait for it.
- **Waiting on PERFORM's engine** (an offer or a drift growing, or the work
  queued ahead of it) is renders, seconds each on a CI runner: bound it with
  `app.offerBudget()` (`perform_budget.js`), not a fixed number
  ([`testing.md` § Rules](../../docs/architecture/testing.md#rules)).
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
  mid-way is at another zoom), the bench lane settled (`settled`,
  `laneCounts`), the model's guess as drawn and as asked (`drawnGuess`,
  `rankedGuess`, `guessAfter`), and a pinned fit (`pinPulls`). Every helper
  but `rackAtRest` takes the test's `app`.
- **A spec for every fix** of user-visible behaviour, named for the behaviour
  (`a bank row's cut appears on hover and can be pressed`).
- Not yet on the fixture: `perform_*`, `responsive`, `audio_in*` and the rest
  of the views' specs. A spec moved onto it keeps every test's title (the
  timings and `testing.md` key on them).
