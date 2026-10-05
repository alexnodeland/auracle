// The browser tests: boot the instrument with the built wasm and require a
// clean console and a registered worklet (smoke.spec.js), then provoke the
// four failure flows the September 2026 audit fixed (failure_flows.spec.js).
// Each file's header says what it does and does not claim.
//
// It serves apps/web with the app's own dev server (no-store, so a rebuilt
// pkg/ is never shadowed by the browser cache). `make wasm` must have run —
// the test asserts that, rather than booting a page that has no engine to
// fail on.
const { defineConfig } = require("@playwright/test");

// AURACLE_TEST_PORT runs the suite on a server of its own, never reusing one
// already listening: from a worktree, :8642 is often the main checkout's
// server, and a suite that reuses it tests the wrong app and says nothing.
const OWN_PORT = process.env.AURACLE_TEST_PORT;
const PORT = OWN_PORT || "8642";

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: /.*\.spec\.js/,
  // Fail fast. A test's own budget is twice the longest a test without an
  // explicit timeout took on CI (about 45 s at 63ec6ff); a longer test says
  // so with `test.setTimeout` or `test.slow()`, and a wait on the engine
  // through the fixture (`app.engine`, `app.reply`, `app.booted`,
  // `app.offerBudget`) adds its own time to the test's timeout.
  timeout: 90_000,
  // A UI state: a wait for the engine says so with a longer bound of its own
  // (fixtures.js ENGINE_MS, perform_budget.js `offerBudget`).
  expect: { timeout: 10_000 },
  // One worker, no retries: a boot that only sometimes comes up clean, or a
  // flow that only sometimes rolls back, is a finding, not a flake to paper
  // over. Serial because every test boots the engine and the render farm.
  workers: 1,
  // Still one test at a time per machine, but CI's shards split the suite by
  // test rather than by file, so one file of slow PERFORM specs cannot make
  // a single runner take three times as long as the others. Nothing in a
  // spec file is shared between its tests (each boots its own page).
  fullyParallel: true,
  // No retries, on CI either: a flaky test is fixed, or tagged @quarantine,
  // which moves it from the gate to the Slow suite until it is
  // (docs/architecture/testing.md § Flakes).
  retries: 0,
  // A stray test.only would quietly narrow the run to that test (on CI, to
  // one runner's share minus everything but it), and the run would pass.
  forbidOnly: !!process.env.CI,
  // On CI each runner also writes a blob report (blob-report/). One job merges
  // a run's blobs into a single HTML report, traces and all, and on main
  // into the timings shard.mjs deals the next run by.
  reporter: process.env.CI ? [["list"], ["github"], ["blob"]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Wider than the handheld gate (min dimension ≥ 620 and a fine pointer),
    // or index.html never injects main.js at all.
    viewport: { width: 1440, height: 900 },
    browserName: "chromium",
    launchOptions: {
      // A WebAudio context must not wait for a gesture nobody will make.
      args: ["--autoplay-policy=no-user-gesture-required"],
    },
    // A failed test's trace, kept. On a workstation without its DOM snapshots:
    // saving them there (Playwright 1.56, macOS) hung a failed test's teardown
    // until its timeout and left a trace that would not open. CI's traces keep
    // them (its failures save in seconds) and are what the run's report shows.
    trace: process.env.CI ? "retain-on-failure" : { mode: "retain-on-failure", snapshots: false },
  },
  webServer: {
    command: `python3 ../../apps/web/serve.py ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !OWN_PORT,
    timeout: 30_000,
  },
});
