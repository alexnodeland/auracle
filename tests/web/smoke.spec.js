// Does the instrument come up?
//
// One test, and deliberately a shallow one (the failure flows are next door
// in failure_flows.spec.js). It boots apps/web against the wasm
// `make wasm` produced and asserts three things: the page raised no console
// errors and no uncaught exceptions, the AudioWorklet registered (the live
// instrument exists), and the engine reached `playable` (the boot veil lifted).
// That is the whole claim. It does not play a note or score a vote — the
// numeric audio assertions CONTRIBUTING describes are still run by hand.
//
// It exists because the failure it catches is invisible to every other gate:
// a backtick inside the worklet template literal, a wasm method the JS calls
// that the binary no longer exports, a protocol field renamed on one side. All
// of those pass `cargo test`, `node --check` and `make site-check`, and show
// up only as a blank instrument in a browser.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const PKG = path.resolve(__dirname, "../../apps/web/pkg/auracle_wasm_bg.wasm");

test("the instrument boots clean: no console errors, worklet registered, engine playable", async ({ page }) => {
  expect(fs.existsSync(PKG), `no built engine at ${PKG} — run \`make wasm\` first`).toBe(true);

  // Everything the page says that is an error. Worker console output reaches
  // the page's console event in Chromium, so the engine worker and the render
  // farm are covered too. Warnings are not failures here: the app's own
  // degradation log (a re-issued render, a serial fallback) is not an error,
  // and the console gate for warnings is the developer's, run by hand.
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

  await page.goto("/");

  // The worklet registered and the live instrument exists. `window.__aur` is
  // the app's own debug hook (CONTRIBUTING § Verification beyond make check).
  await page.waitForFunction(
    () => window.__aur && typeof window.__aur.getLive === "function" && window.__aur.getLive() != null,
    null,
    { timeout: 60_000 },
  );

  // The engine came up: `playable` lifts the boot veil. Boot renders eight
  // patches before this fires, which on a two-core runner is tens of seconds.
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });

  // The alert strip is for conditions that persist — a crashed engine, an
  // unreadable save, a failed boot. A clean boot has none.
  await expect(page.locator("#alarm")).toHaveClass(/\bhidden\b/);

  expect(errors, `the page raised errors:\n${errors.join("\n")}`).toEqual([]);
});

// Every binding `worker.js` calls must exist in the binary it is served
// (crates/auracle-wasm/AGENTS.md): a method that was renamed or never built
// shows up only as a generation that falls back, or a blank instrument. These
// are the walk surface of RFC-001 — a generation's jobs, the farm's stateless
// walk, ordered absorption, stop, and ⚡ as one farm job. `belief` is the
// ratings each pick's reply carries (Plan-005); its seeds are the next jobs'
// parents. `edit_known_makeup` is the makeup an undo or a redo reaches the
// voices at before its render. The three `audition_clip` methods are the
// session's clip (Plan-007 task 3), and the live voice's input surface is what
// the worklet will write a capture through (task 4). The `guess_*` four are
// the model's guess (Plan-005 task 9d), with `guess_patch_as` the key a new
// patch files its guesses under (task 7), and `edit_cable_levels` the cable
// probe (9e). `held_sounds` and `readmit_held` are the sounds a restore held
// back for an unreadable take (Plan-007 task 6).
test("the engine binary exports the walk surface the worker calls", async ({ page }) => {
  expect(fs.existsSync(PKG), `no built engine at ${PKG} — run \`make wasm\` first`).toBe(true);
  await page.goto("/pkg/build.json");
  const got = await page.evaluate(async () => {
    const mod = await import(`/pkg/auracle_wasm.js?v=${Date.now()}`);
    const proto = mod.WasmEngine.prototype;
    const methods = [
      "refine_jobs", "refine_absorb", "refine_finish", "refine_retired", "refine_retiring",
      "refine_from_job", "refine_from_absorb", "refine_from_walk", "refine_from_cancel",
      "refine_seed", "last_refine_reason", "belief", "edit_known_makeup",
      "audition_clip", "set_audition_clip", "clear_audition_clip",
      "guess_plan", "guess_rank", "guess_skip", "guess_take", "guess_patch_as", "edit_cable_levels",
      "held_sounds", "readmit_held",
    ];
    const live = ["input_ptr", "input_capacity", "write_input", "clear_input"];
    return {
      farm_walk: typeof mod.farm_walk,
      cache_namespace: typeof mod.cache_namespace,
      farm_render: typeof mod.farm_render,
      missing: methods.filter((k) => typeof proto[k] !== "function"),
      liveMissing: live.filter((k) => typeof mod.LivePoly.prototype[k] !== "function"),
    };
  });
  expect(got.farm_walk).toBe("function");
  expect(got.cache_namespace).toBe("function");
  expect(got.farm_render).toBe("function");
  expect(got.missing, "WasmEngine methods worker.js calls are missing").toEqual([]);
  expect(got.liveMissing, "LivePoly's input surface is missing").toEqual([]);
});
