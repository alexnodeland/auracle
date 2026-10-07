// The reference profile (ADR-025): what `app.boot({ profile: "air" })` makes
// of the machine under the run (profile.js), since the nightly *Speed
// budgets* job judges every budget on it.
//
// - The engine worker and every farm worker run their wasm through the
//   profile's slowdown, at the rate the calibration gave. A render on each is
//   read from the worker's own record of what it slowed (perform_budget.js
//   `SLOW_ENGINE`): the engine worker's own wasm instance (a probe ahead of
//   worker.js, `ENGINE_PROBE`) and a farm worker the page spawns as main
//   spawns one (the compiled module, a port, the phrase, a job). The
//   slowdown is served at every rate, ×1 included, so this holds on a
//   machine as slow as the reference too, where a render's time says
//   nothing. The farm has two renderers, the reference's width, and every
//   farm worker the page started was served the profile's farm.js. Read at
//   the engine's `ready`, not after the boot: this is the gate's check of
//   the profile, and on it a boot is the reference machine's.
// - In Chromium the page is throttled at the profile's rate (CDP), and in
//   Firefox, which has no throttle for a page, it is not. How much slower a
//   fixed piece of work ran on the page, against a page with no profile, is
//   the test's annotation: on a busy machine a wall-clock throttle adds less
//   to what the load already costs, so it is a reading, not a check
//   (ADR-022).
// - A render takes about the reference machine's time, in the engine worker
//   and on the farm, each the median of three after one to warm up, once
//   the pool is whole (before it, the app's own fill competes with them;
//   `@slow`, for that wait, and judged each night with the other budgets).
//   How far over the reference's time they ran is a budget (ADR-022): a
//   machine slower than the reference, which the profile cannot speed up,
//   or one loaded after its calibration, is slower, not wrong. Where the
//   rate can tell (×2 or more, a workstation), each is held to half the rate
//   times the calibration's render measured again unslowed, now, which a
//   slowed render clears and an unslowed one does not; a hosted runner's
//   rate is about 1 to 1.5, and there the first test is the check.
const { test, expect } = require("./fixtures");
const profile = require("./profile");

/** How far over the reference's time a render may run before its budget is
 *  over: the calibration's own spread and a runner's noise, with room. */
const OVER = 1.5;

test("on the air profile the engine worker and every farm worker run their wasm through the profile's slowdown at the calibrated rate, and the farm has two renderers", async ({ page, app }) => {
  // Up to the engine's `ready` (its wasm instantiated, the farm's workers
  // spawned before it), not the veil: on the profile the rest of the boot is
  // the reference machine's, tens of seconds on a runner, and nothing here
  // reads it.
  await app.boot({ profile: "air", workerPrefix: profile.ENGINE_PROBE, wait: false });
  await app.reply("ready");
  const on = app.profile;
  expect(await profile.farmWorkers(page), "the farm's renderers, the reference's two").toBe(2);
  await expect.poll(() => on.served.farm, { message: "every farm worker the page started was served the profile's farm.js" }).toBe(2);

  const engine = await app.engine(() => profile.engineRender(page, { preset: on.preset, runs: 1, warm: false }));
  const engineSlowed = profile.slowedCalls(engine.slowed);
  expect(engineSlowed.map((s) => s.rate), "the engine worker's slowdowns: the profile's, at the engine's rate").toEqual([on.engineRate]);
  expect(engineSlowed[0].calls, "the wasm calls of a render in the engine worker that the slowdown slowed").toBeGreaterThan(0);

  const farm = await app.engine(() => profile.farmRender(page, { tree: engine.tree, phrase: engine.phrase, runs: 1, warm: false }));
  const farmSlowed = profile.slowedCalls(farm.slowed);
  expect(farmSlowed.map((s) => s.rate), "a farm worker's slowdowns: the profile's, at the calibration's rate").toEqual([on.rate]);
  expect(farmSlowed[0].calls, "the wasm calls of a render on the farm that the slowdown slowed").toBeGreaterThan(0);
});

test("on the air profile the page is throttled at the profile's rate in Chromium, and not in Firefox, which has no throttle for a page", async ({ page, app, newContext }) => {
  // The throttle is set before the page loads; the boot is not waited for.
  await app.boot({ profile: "air", wait: false });
  await app.reply("ready");
  const on = app.profile;
  expect(on.pageRate, `the rate CDP throttles the page at, in ${on.browser}`).toBe(on.browser === "chromium" ? on.rate : 1);

  const plain = await (await newContext()).newPage();
  const here = await profile.pageWork(page);
  const there = await profile.pageWork(plain);
  test.info().annotations.push({
    type: "page throttle",
    description: `a fixed piece of work ${Math.round(here)} ms on the profiled page, ${Math.round(there)} ms on a page with no profile: ×${(here / there).toFixed(2)}, the throttle ×${on.pageRate}`,
  });
});

test("on the air profile a render takes about the reference machine's time, in the engine worker and on the farm", { tag: "@slow" }, async ({ page, app }) => {
  test.setTimeout(240_000); // about 1.6 min in a four-core container, most of it the pool filling cold on the profile
  await app.boot({ profile: "air", workerPrefix: profile.ENGINE_PROBE, reuseRenders: true });
  await app.filled();
  const on = app.profile;

  const engine = await app.engine(() => profile.engineRender(page, { preset: on.preset }));
  const farm = await app.engine(() => profile.farmRender(page, { tree: engine.tree, phrase: engine.phrase }));
  console.log(`${profile.calibrationLine(on)}; on the profile: ${Math.round(engine.ms)} ms in the engine worker, ${Math.round(farm.ms)} ms on the farm`);
  app.budget(`a render of ${on.preset} in the engine worker, the reference's ${on.referenceMs} ms`, engine.ms, Math.round(on.referenceMs * OVER));
  app.budget(`a render of ${on.preset} on the farm, the reference's ${on.referenceMs} ms`, farm.ms, Math.round(on.referenceMs * OVER));

  const floor = await app.engine(() => profile.unslowedFloors(app.where, on));
  expect(engine.ms, `a render in the engine worker (${engine.times.map(Math.round).join(", ")} ms) against ${floor.engine.said}`).toBeGreaterThanOrEqual(floor.engine.floorMs);
  expect(farm.ms, `a render on the farm (${farm.times.map(Math.round).join(", ")} ms) against ${floor.farm.said}`).toBeGreaterThanOrEqual(floor.farm.floorMs);
});
