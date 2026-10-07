// The reference profile (ADR-025): what `app.boot({ profile: "air" })` makes
// of the machine under the run (profile.js), measured, since the nightly
// *Speed budgets* job judges every budget on it.
//
// - A render in the engine worker and one on the farm each take about the
//   reference machine's time: the calibration's preset rendered on the engine
//   worker's own wasm instance (a probe ahead of worker.js, `ENGINE_PROBE`),
//   and on a farm worker the page spawns as main spawns one (the compiled
//   module, a port, the phrase, a job), each the median of three after one to
//   warm up. That the profile slowed them is asserted: each takes at least
//   half the reference's time, which a slower or busier machine only makes
//   longer, and which an unslowed render here (a quarter of it on an M3 Max)
//   does not reach. How far over the reference's time they ran is a budget
//   (ADR-022): a machine slower than the reference, which the profile cannot
//   speed up, or one loaded after its calibration, is slower, not wrong.
// - The farm has two renderers, the reference's width, and every farm worker
//   the page started was served the profile's farm.js.
// - In Chromium the page is throttled by the same rate (CDP): a fixed piece of
//   work on the page against the same work on a page with no profile, at
//   least half the rate. Firefox has no throttle for a page: there the
//   page's rate is 1, and the work takes about what it takes on a plain page.
const { test, expect } = require("./fixtures");
const profile = require("./profile");

/** How far over the reference's time a render may run before its budget is
 *  over: the calibration's own spread and a runner's noise, with room. */
const OVER = 1.5;

test("on the air profile a render takes about the reference machine's time, in the engine worker and on the farm, and the farm has two renderers", async ({ page, app }) => {
  await app.boot({ profile: "air", workerPrefix: profile.ENGINE_PROBE });
  const on = app.profile;
  expect(await profile.farmWorkers(page), "the farm's renderers, the reference's two").toBe(2);
  expect(on.served.farm, "every farm worker the page started was served the profile's farm.js").toBe(2);

  const engine = await app.engine(() => profile.engineRender(page, { preset: on.preset }));
  const farm = await app.engine(() => profile.farmRender(page, { tree: engine.tree, phrase: engine.phrase }));
  console.log(`${profile.calibrationLine(on)}; on the profile: ${Math.round(engine.ms)} ms in the engine worker, ${Math.round(farm.ms)} ms on the farm`);
  expect(engine.ms / on.referenceMs, `a render in the engine worker (${engine.times.map(Math.round).join(", ")} ms) against the reference's ${on.referenceMs} ms`).toBeGreaterThan(0.5);
  expect(farm.ms / on.referenceMs, `a render on the farm (${farm.times.map(Math.round).join(", ")} ms) against the reference's ${on.referenceMs} ms`).toBeGreaterThan(0.5);
  app.budget(`a render of ${on.preset} in the engine worker, the reference's ${on.referenceMs} ms`, engine.ms, Math.round(on.referenceMs * OVER));
  app.budget(`a render of ${on.preset} on the farm, the reference's ${on.referenceMs} ms`, farm.ms, Math.round(on.referenceMs * OVER));
});

test("on the air profile the page is throttled by the rate the engine is slowed by, in Chromium, and not in Firefox", async ({ page, app, newContext }) => {
  await app.boot({ profile: "air" });
  const { rate, pageRate } = app.profile;
  const plain = await (await newContext()).newPage();
  const here = await profile.pageWork(page);
  const there = await profile.pageWork(plain);
  console.log(`the page's work: ${Math.round(here)} ms on the profile (the engine ×${rate}, the page ×${pageRate}), ${Math.round(there)} ms on a page with none`);
  expect(here / there, `the profiled page against a plain one, the page's rate ${pageRate}`).toBeGreaterThan(pageRate / 2);
});
