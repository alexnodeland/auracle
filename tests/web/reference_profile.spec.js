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
// - In Chromium the page is throttled at the render's rate up to the
//   profile's cap (CDP; `pageRateMax`, the Air's CPU against an M-series
//   one, ×4.5), and in Firefox, which has no throttle for a page, it is not.
//   How much slower a fixed piece of work ran on the page, against a page
//   with no profile, is the test's annotation, and it is printed: on a busy
//   machine a wall-clock throttle adds less to what the load already costs,
//   so it is a reading, not a check (ADR-022). The page with no profile's
//   figure, on the Air and on an M-series machine, is how the cap is
//   measured (profile.js).
// - A render takes about the reference machine's time, in the engine worker
//   and on the farm, each the median of three after one to warm up, once
//   the pool is whole (before it, the app's own fill competes with them;
//   `@slow`, for that wait, and judged each night with the other budgets).
//   How far over the reference's time they ran is a budget (ADR-022): a
//   machine slower than the reference, which the profile cannot speed up,
//   or one loaded after its calibration, is slower, not wrong. Where the
//   rate can tell (×2 or more), each is held to half the rate times the
//   calibration's render measured again unslowed, now, which a slowed render
//   clears and an unslowed one does not. Against today's estimate of the Air
//   (356 ms) a hosted runner's rate is ×1.6 to ×5.6, most ×2.6 to ×3.8 (its
//   render 64 to 227 ms on the nights since #406, most 94 to 135), and an
//   M-series workstation's about ×5; where it is less than ×2, the first
//   test is the check.
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

test("on the air profile the page is throttled in Chromium at the render's rate up to the Air's CPU against an M-series one, and not in Firefox, which has no throttle for a page", async ({ page, app, newContext }) => {
  // The throttle is set before the page loads; the boot is not waited for.
  await app.boot({ profile: "air", wait: false });
  await app.reply("ready");
  const on = app.profile;
  const capped = Math.max(1, Math.min(on.rate, on.pageRateMax));
  expect(on.pageRate, `the rate CDP throttles the page at, in ${on.browser}: the render's ×${on.rate}, at most ×${on.pageRateMax}`).toBe(on.browser === "chromium" ? capped : 1);
  expect(on.engineRate, "the engine's rate stays the render's, whatever the page's").toBe(on.rate);

  const plain = await (await newContext()).newPage();
  const here = await profile.pageWork(page);
  const there = await profile.pageWork(plain);
  const reading = `a fixed piece of work ${Math.round(here)} ms on the profiled page, ${Math.round(there)} ms on a page with no profile: ×${(here / there).toFixed(2)}, the throttle ×${on.pageRate}`;
  console.log(`page throttle: ${reading}`);
  test.info().annotations.push({ type: "page throttle", description: reading });
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
