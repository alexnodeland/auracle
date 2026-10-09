// A refit runs on the farm, and the engine answers the player meanwhile
// (#300, docs/architecture/web-runtime.md "The worker's lanes"): the engine
// exports what the fit reads (`fit_export`), a crew worker fits it
// (`farm_fit`), and the engine installs it (`fit_install`). One fit is out at
// a time. A session saved with its fit fits nothing when it comes back; one
// saved before fits once, after boot.
//
// worker.js runs here as it is, over the built engine, with no page
// (harness.mjs). The crew is ports the test holds (`fakeCrew`): a refit it
// is handed is fitted as farm.js fits it (`farmFit`), held, or declined.
import test from "node:test";
import assert from "node:assert/strict";
import { workerFor, fakeCrew, farmFit } from "./harness.mjs";

const SEED = 1;
// A test that hangs fails here, well inside the CI job's limit.
const TIMEOUT = 150_000;

/** Picks: the warm start's three, each a pick over the cards not chosen. */
const teach = (w) => w.send({ type: "warm_start", picked: [0, 1, 2], rest: [3, 4, 5, 6, 7, 8] });

/** What a fit's reply says of the model, without its timings. */
const model = (r) => JSON.stringify({ ranked: r.views.ranked, styles: r.views.styles, map: r.views.map });

/** Until the crew has heard what `cond` asks (its ports are this thread's,
 *  so no reply of the worker's says so). */
async function heard(cond, timeout = 120_000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeout) throw new Error(`the crew never heard it: ${cond}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Where in the trace an engine call was made, by name (-1: never). */
const callAt = (trace, name, from = 0) => trace.findIndex((e, i) => i >= from && e.ev === "call" && e.name === name);

test("a refit runs on the farm, and a pick and a sound asked for while it runs are answered before it lands", { timeout: TIMEOUT }, async (t) => {
  // The crew sits on the fit until the test lets it go.
  const held = [];
  const crew = fakeCrew(1, { fit: (k, m) => (held.push(m), null) });
  t.after(() => crew.close());
  const w = await workerFor(t, { seed: SEED, crew: () => crew.ports });
  const warm = (await teach(w)).at(-1);
  const fit = { type: "fit" };
  w.post(fit);
  await heard(() => held.length > 0);
  // Out on the farm: the player's requests are answered meanwhile.
  const pick = { type: "record_stars", id: warm.first, rating: 4 };
  const [stars] = await w.send(pick);
  assert.equal(stars.recorded, true);
  const [sound] = await w.send({ type: "render", id: warm.first });
  assert.equal(sound.type, "render");
  // A second fit waits for the first: one out at a time.
  const again = { type: "fit" };
  w.post(again);
  await w.send({ type: "taste_views" });
  assert.equal(held.length, 1, "a second fit went out beside the first");
  assert.deepEqual(w.repliesOf("fitted"), [], "a fit was answered before the farm's landed");

  crew.answer(0, await farmFit(held[0]));
  const [landed] = await w.answers(fit);
  assert.equal(landed.type, "fitted");
  assert.equal(landed.farm, true);
  assert.equal(landed.refused, undefined, "the engine refused the farm's fit");
  assert.equal(landed.status.has_posterior, true);
  // The star made while it ran is folded in: the fit counts every
  // observation the engine holds.
  assert.equal(landed.status.observations, stars.status.observations);
  // Then the second goes out, and lands.
  await heard(() => held.length > 1);
  crew.answer(0, await farmFit(held[1]));
  const [second] = await w.answers(again);
  assert.equal(second.farm, true);

  // The engine never fitted on its own thread.
  const trace = await w.trace();
  assert.equal(callAt(trace, "fit"), -1, "the engine fitted here");
  assert.ok(callAt(trace, "fit_export") >= 0 && callAt(trace, "fit_install") >= 0);
  await w.close();
});

test("the farm's fit is the fit the engine makes with no farm", { timeout: TIMEOUT }, async (t) => {
  const crew = fakeCrew(1);
  t.after(() => crew.close());
  const farmed = await workerFor(t, { seed: SEED, crew: () => crew.ports });
  const here = await workerFor(t, { seed: SEED });
  await teach(farmed);
  await teach(here);
  const [a] = await farmed.send({ type: "fit" });
  const [b] = await here.send({ type: "fit" });
  assert.equal(a.farm, true);
  assert.equal(b.farm, false, "with no crew it was fitted here");
  assert.equal(model(a), model(b));
  // Fitted here, it was the one engine call the lane served it with, said
  // as long work (`busy` … `idle`).
  const trace = await here.trace();
  assert.equal(callAt(trace, "fit"), -1);
  assert.ok(here.repliesOf("busy").length > 0);
  await farmed.close();
  await here.close();
});

test("a refit the crew cannot run is fitted here, back in its lane", { timeout: TIMEOUT }, async (t) => {
  const crew = fakeCrew(1, { fit: (k, m) => ({ type: "cannot", i: m.i, walk: true, reason: "a broken instance" }) });
  t.after(() => crew.close());
  const w = await workerFor(t, { seed: SEED, crew: () => crew.ports });
  await teach(w);
  const [r] = await w.send({ type: "fit" });
  assert.equal(r.type, "fitted");
  assert.equal(r.farm, false);
  assert.ok(crew.heard[0].some((m) => m.type === "fit"), "the crew was never handed the fit");
  assert.equal(r.status.has_posterior, true);
  await w.close();
});

test("a restore with its fit fits nothing, and one saved before fits once after boot, on the farm", { timeout: TIMEOUT }, async (t) => {
  const first = await workerFor(t, { seed: SEED });
  await teach(first);
  const [fitted] = await first.send({ type: "fit" });
  const [{ json: saved }] = await first.send({ type: "save" });
  await first.close();
  assert.ok(JSON.parse(saved).fit, "the save holds no fit");

  // With its fit: the model comes back as it was, and nothing is fitted.
  const back = await workerFor(t, { boot: false });
  await back.boot({ seed: SEED, saved });
  const [views] = await back.send({ type: "taste_views" });
  assert.equal(JSON.stringify(views.views.styles), JSON.stringify(fitted.views.styles));
  const trace = await back.trace();
  for (const call of ["fit", "fit_export"]) assert.equal(callAt(trace, call), -1, `a restore with its fit called ${call}`);
  assert.deepEqual(back.repliesOf("fitted"), []);
  await back.close();

  // Saved before the fit was kept: fitted once, after `filled`, on the farm.
  const old = JSON.parse(saved);
  delete old.fit;
  const crew = fakeCrew(1);
  t.after(() => crew.close());
  const w = await workerFor(t, { boot: false, crew: () => crew.ports });
  const filled = await w.boot({ seed: SEED, saved: JSON.stringify(old) });
  assert.equal(filled.status.has_posterior, false);
  const refit = await w.reply("fitted", { after: filled._n });
  assert.equal(refit.farm, true);
  assert.equal(refit.re, undefined, "the restore's fit answered a request");
  assert.equal(model(refit), model(fitted), "the restore fitted another model");
  await w.close();
});
