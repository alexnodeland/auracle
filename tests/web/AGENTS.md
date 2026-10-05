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

- **Assert what a player sees or hears**: text on screen, a class that lights
  a control, an `AnalyserNode` level. Not internal variables.
- **Every spec fails on page errors** (collect `pageerror` and expect none).
- **Wait for states, not times.** `expect(...).toHaveText(..., { timeout })`
  over `waitForTimeout`. The machine is often loaded, so a timeout under about
  1.5 s is a flake waiting to happen. When the app gets faster, a spec that
  expected to see an intermediate state may miss it: accept either state
  rather than slowing the app down.
- **Waiting on PERFORM's engine** (an offer or a drift growing, or the work
  queued ahead of it) is renders, seconds each on a CI runner: bound it with
  `offerBudget` from `perform_budget.js`, not a fixed number
  ([`testing.md` § Rules](../../docs/architecture/testing.md#rules)).
- **Seed and skip the warm start deliberately**: `boot(page, { warmed })`
  helpers exist in the newer specs; reuse them rather than clicking through.
- **Go to a level with `goLevel(page, level)`**, into KEYS ⋯ with
  `openKeys(page)`, to a bank with `bankTab(page, "pool"|"saved"|"presets")`
  and into the model view with `modelView(page, on)`, from `shell.js`. A bank
  row's guess (`.bi-pct`, `.bi-u`) shows only under the model view, its
  actions (`.bi-acts`) only on approach, and its stars through ★ or the 1–5
  keys; find a row by its `data-id`, not by text. The app opens at PERFORM (Plan-008), so a
  spec about PATCH goes there first, and waits for the state it needs (the
  rack drawn, a pair named), not for a name or a time: PERFORM's first
  measurement runs at boot and moves when the rest lands.
- **A spec for every fix** of user-visible behaviour, named for the behaviour
  (`a bank row's cut appears on hover and can be pressed`).
