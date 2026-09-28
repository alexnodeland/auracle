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
  timeout: 180_000,
  // One worker, no retries: a boot that only sometimes comes up clean, or a
  // flow that only sometimes rolls back, is a finding, not a flake to paper
  // over. Serial because every test boots the engine and the render farm.
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
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
    trace: "retain-on-failure",
  },
  webServer: {
    command: `python3 ../../apps/web/serve.py ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !OWN_PORT,
    timeout: 30_000,
  },
});
