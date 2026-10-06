---
name: browser-test
description: >
  Run or write Auracle's Playwright specs (tests/web) correctly: on the suite's
  own port, through the one-browser queue, against a current wasm build. Use
  for any change to app behaviour, or when asked to test in a browser.
---

# Browser tests

Details and conventions are in `tests/web/AGENTS.md`; which spec pins what is
in `docs/architecture/testing.md`.

## Run

```bash
make wasm                  # only if Rust the app calls changed (see the wasm skill)
cd tests/web
AURACLE_TEST_PORT=8690 ../../www/video/tools/one_browser.sh \
  npx playwright test <spec.js ...> --reporter=line > <scratch>/run.log 2>&1
grep -aE "passed|failed|✘|Expected|Received" <scratch>/run.log | tail
```

- **Own port** (`AURACLE_TEST_PORT`), always from a worktree, and whenever
  another server may be on `:8642`. A branch's brief gives it one (8771 and
  up); set in the environment, it reaches `make browser-changed`,
  `browser-fast` and `browser-slow` too.
- **Through the queue** (`one_browser.sh`). Rehearsals and recordings may be
  ahead of you. Run it in the background and wait for it; do not start a
  second browser job.
- **Capture the full output.** Filtering to "passed/failed" hides which
  assertion failed; keep the log.
- A spec's `test-results/` folder is overwritten by the next run: read
  failures before queueing another.
- **Run what the change reaches, not the suite:** `make browser-changed`
  (changed specs, the specs of a changed helper, the specs named for a changed
  app module; `BASE=` to diff against something other than `origin/main`), or
  name them (`npx playwright test patch_ perform_layout.spec.js`). The full
  tier is CI's job: about seventy-five minutes in one worker, twelve runners
  wide there.

## In CI

- The fast tier (every spec not tagged `@slow` or `@quarantine`) is inside the
  required `CI` check, dealt to twelve runners by main's last timings
  (`tests/web/shard.mjs`). A PR that changes only specs runs only those specs.
- The *Slow suite* runs `@slow` and `@quarantine` on `main`, nightly, and on
  a PR only with the `full-ci` label; the nightly *Flake hunt* runs the fast
  tier three times each.
- A runner that runs out of time still reports: it is interrupted a minute
  before Playwright's global timeout, and the test it was running is
  reported as interrupted, with its trace.
- A failed run's summary links one HTML report of every runner, with the
  failed tests' traces: download it, then `npx playwright show-report <dir>`
  in `tests/web`. `gh run view <id> --log-failed` shows the failing assertion.

## Write

- Name the test for the behaviour: "a bank row's cut appears on hover and can
  be pressed".
- Assert what a player sees or hears; a worker message only when the message
  is the behaviour (a request not sent twice, a stale reply refused).
- Use the shared fixture when `tests/web/fixtures.js` is present: `app.boot()`
  (seeded by default), typed waits (`app.reply`, `app.toast`, `app.level`),
  `app.quiet()` for "nothing happens", `app.hold()` so an injected reply can't
  be overwritten by the engine's own. It fails a test on any page error, so no
  spec collects `pageerror` itself. Without it, reuse the spec helpers
  (`boot(page, { warmed })`) and collect `pageerror`.
- Wait for states, never times: no `waitForTimeout` except a named pacing
  constant inside a gesture. Engine work is bounded by `offerBudget`
  (`perform_budget.js`), not a guess. Accept the app being faster than when
  the test was written.
- Time is one of three kinds (ADR-022; `tests/web/AGENTS.md` says how): an
  engine fact is a wait for the reply to your request; a promise about the
  app's own timeline is order (the state in the gesture's own task, the tap's
  log) or the app's marks (`app.marks`); how long something took is
  `app.budget(name, ms, limit)`, recorded and never failed on the gate,
  judged with `AURACLE_PERF=1`. Never `expect(ms).toBeLessThan(…)`.
- No exact count of something a slow runner may legitimately do twice.
- A test over about 40 s on CI is tagged `@slow` (`tests/web/AGENTS.md`).

## A failure

Decide whether it is the app, the test, or the machine. "Flaky" is not a
cause: read the error, check the build id, rerun the one spec once through the
queue. A spec that fails only under load needs slack or a state wait, not a
retry: there are no retries anywhere. A test that fails in CI only sometimes is
fixed, or quarantined while it is fixed: a `flake` issue, the `@quarantine`
tag with a comment naming it, the issue labelled `quarantined`
(`docs/process.md` § Flakes). The fix removes the tag.
