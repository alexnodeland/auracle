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

- **`AURACLE_TEST_PORT`** starts a server of the suite's own on that port.
  Without it the config reuses whatever answers on `:8642`, which from a
  worktree is often the main checkout, so a green run can be the wrong app.
- **`one_browser.sh`** queues the run behind any rehearsal, recording or other
  suite. Two browsers at once make both late, and a timing assertion then
  fails for the machine, not the app.
- **`make smoke`** runs the CI pair (`smoke.spec.js`, `failure_flows.spec.js`).
  The whole suite takes about fifteen minutes.

## Writing a spec

- **Assert what a player sees or hears**: text on screen, a class that lights
  a control, an `AnalyserNode` level. Not internal variables.
- **Every spec fails on page errors** (collect `pageerror` and expect none).
- **Wait for states, not times.** `expect(...).toHaveText(..., { timeout })`
  over `waitForTimeout`. The machine is often loaded, so a timeout under about
  1.5 s is a flake waiting to happen. When the app gets faster, a spec that
  expected to see an intermediate state may miss it: accept either state
  rather than slowing the app down.
- **Seed and skip the warm start deliberately**: `boot(page, { warmed })`
  helpers exist in the newer specs; reuse them rather than clicking through.
- **A spec for every fix** of user-visible behaviour, named for the behaviour
  (`a bank row's cut appears on hover and can be pressed`).
