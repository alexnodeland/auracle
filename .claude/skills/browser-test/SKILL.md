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
  another server may be on `:8642`.
- **Through the queue** (`one_browser.sh`). Rehearsals and recordings may be
  ahead of you. Run it in the background and wait for it; do not start a
  second browser job.
- **Capture the full output.** Filtering to "passed/failed" hides which
  assertion failed; keep the log.
- A spec's `test-results/` folder is overwritten by the next run: read
  failures before queueing another.

## Write

- Name the test for the behaviour: "a bank row's cut appears on hover and can
  be pressed".
- Assert what a player sees or hears. Collect `pageerror` and expect none.
- Wait for states; give timing assertions 1.5 s or more of slack, and accept
  the app being faster than when the test was written.
- Reuse the spec helpers (`boot(page, { warmed })`, seeded sessions) rather
  than clicking through the warm start.

## A failure

Decide whether it is the app, the test, or the machine. "Flaky" is not a
cause: read the error, check the build id, rerun the one spec once through the
queue. A spec that fails only under load needs slack or a state wait, not a
retry.
