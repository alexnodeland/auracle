// The reference profile (ADR-025): the speed the speed budgets are judged at.
// Not a spec: `playwright.config.js` matches `*.spec.js` only.
//
// ADR-025 defines it by a machine, not by a factor: a 2018 or 2019 MacBook
// Air, an Intel 1.6 GHz dual-core i5 (2 cores, 4 threads), in Firefox, where
// `farmWidth` gives two renderers. A boot on the profile (`app.boot({ profile:
// "air" })`, or every boot of a run with `AURACLE_PROFILE=air`) is that
// machine as near as this one can make it, whatever this one is:
//
// - **A render takes the reference's time.** The wasm in the engine worker and
//   in every farm worker is slowed (perform_budget.js `SLOW_ENGINE`) by the
//   rate this machine measures: the calibration render here, unslowed,
//   against its time on the reference (`referenceMs`). A machine as slow as
//   the reference or slower is not slowed (rate 1), and its renders take what
//   they take; the slowdown is served there too, at ×1, so a spec can see
//   that the wasm it timed went through it.
// - **Two renderers:** the app boots with `?farm=2`, unless the spec's own
//   address names a width (`?farm=0`, a spec about the path with no farm).
// - **The page is throttled by the same rate** in Chromium (CDP's
//   `Emulation.setCPUThrottlingRate`, which reaches the page and not its
//   workers). Firefox has no such throttle: there the page runs at this
//   machine's speed, and the profile slows the engine and the farm only.
//
// The calibration render is `farm_render` (the farm's whole job: one render on
// the audition phrase, vetted and featurized, with its audio) of one preset,
// `preset`, in a worker of a page of its own, in the run's browser: one render
// to warm up, then the median of CALIBRATION_RUNS. It runs once a run, on the
// first boot that asks for the profile, and is kept in the run's output
// directory, so a worker Playwright starts again after a failure slows by the
// same rate. The file is named for the engine build and the run's process, so
// where the output directory outlives a run (Playwright's UI mode, which
// keeps it) a rebuilt engine or a new session calibrates again; runs from one
// UI session on one build share a calibration.
//
// Measured on a 16-core M3 Max (Oct 7, the release build): Solo
// Flight 239 ms in Chromium and 293 ms in Firefox; the library's 62 presets
// 116 to 512 ms in Chromium, median 215 ms, Solo Flight among the middle ones
// (Glass Pad, PERFORM's preset in the specs, 299 ms).
//
// `referenceMs` is ADR-025's estimate, not yet a measurement on the Air: a
// phrase render about 240 ms on an M3 Max and 1 to 1.2 s on the Air. On the
// Air, `AURACLE_PROFILE=air AURACLE_BROWSER=firefox npx playwright test
// reference_profile.spec.js` prints the calibration render there ("one
// render of Solo Flight … ms here"), which is the figure to set.
const fs = require("node:fs");
const path = require("node:path");
const performBudget = require("./perform_budget");

const PROFILES = {
  air: {
    name: "air",
    machine: "a 2018 or 2019 MacBook Air (Intel 1.6 GHz dual-core i5, 2 cores, 4 threads), in Firefox",
    preset: "Solo Flight",
    referenceMs: 1_100,
    farm: 2,
  },
};
/** Renders the calibration takes the median of, after one to warm up. */
const CALIBRATION_RUNS = 3;

/** The profile named `name`; an unknown name is an error that lists them. */
function profileOf(name) {
  const p = PROFILES[name];
  if (!p) throw new Error(`no profile named ${name}: the fixture knows ${Object.keys(PROFILES).join(", ")} (tests/web/profile.js)`);
  return p;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// In a worker of the calibration page: the engine's glue, initialized, and
// the calibration preset rendered on the audition phrase, timed on the
// worker's clock. No route and no throttle reach it: the page is in a
// context of its own.
const CALIBRATE = `self.onmessage = async (e) => {
  const { glue: url, wasm, preset, runs } = e.data;
  try {
    const glue = await import(url);
    await glue.default({ module_or_path: wasm });
    const engine = new glue.WasmEngine(1n, 8);
    const phrase = engine.phrase_json();
    const found = JSON.parse(engine.preset_list()).find((p) => p.name === preset);
    if (!found) throw new Error("no preset named " + preset);
    const tree = engine.preset_tree_json(found.index);
    engine.free();
    const times = [];
    for (let i = 0; i <= runs; i++) {
      const t = performance.now();
      const job = glue.farm_render(tree, phrase, true);
      const ms = performance.now() - t;
      const ok = job.ok;
      job.free();
      if (!ok) throw new Error(preset + " did not render");
      if (i > 0) times.push(ms);
    }
    postMessage({ times });
  } catch (err) {
    postMessage({ error: String((err && err.message) || err) });
  }
};`;

/** This machine's calibration render, unslowed, in `browser` (the run's):
 *  every time measured, in ms. */
async function measure(browser, baseURL, profile) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.route("**/__auracle_profile", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>profile</title>" }));
    await page.goto(new URL("/__auracle_profile", baseURL).href);
    return await page.evaluate(
      ([src, preset, runs]) =>
        new Promise((resolve, reject) => {
          const w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })), { type: "module" });
          w.onmessage = (e) => {
            w.terminate();
            if (e.data.error) reject(new Error(`the calibration render: ${e.data.error}`));
            else resolve(e.data.times);
          };
          w.onerror = (e) => reject(new Error(`the calibration worker: ${e.message}`));
          const v = "profile";
          w.postMessage({ glue: `${location.origin}/pkg/auracle_wasm.js?v=${v}`, wasm: `${location.origin}/pkg/auracle_wasm_bg.wasm?v=${v}`, preset, runs });
        }),
      [CALIBRATE, profile.preset, CALIBRATION_RUNS],
    );
  } finally {
    await context.close();
  }
}

/** The engine build the run serves (`apps/web/pkg/build.json`), which a
 *  calibration is kept for. */
function engineBuild() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "../../apps/web/pkg/build.json"), "utf8")).build || "unstamped";
  } catch {
    return "none";
  }
}

/** What the profile is on this machine: its calibration (measured once a
 *  run, kept in the run's output directory for the engine build and the
 *  run's process: Playwright's, whose workers these are) and the rate it
 *  slows by. { name, browser, preset, referenceMs, measuredMs, times, rate,
 *  farm }. */
const calibrations = new Map();
function calibrated(name, { browser, browserName, baseURL, outputDir }) {
  const profile = profileOf(name);
  const key = `${name}-${browserName}-${engineBuild()}-${process.ppid}`;
  if (!calibrations.has(key)) {
    calibrations.set(key, (async () => {
      const file = path.join(outputDir, `.profile-${key}.json`);
      try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        // Not measured yet in this run.
      }
      const times = await measure(browser, baseURL, profile);
      const measuredMs = median(times);
      const rate = Math.max(1, Math.round((profile.referenceMs / measuredMs) * 100) / 100);
      const out = { name, browser: browserName, preset: profile.preset, referenceMs: profile.referenceMs, measuredMs: Math.round(measuredMs), times: times.map(Math.round), rate, farm: profile.farm };
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(out)}\n`);
      const said = `profile ${calibrationLine(out)}`;
      console.log(said);
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${said}\n\n`);
      return out;
    })());
    // A calibration that failed is tried again by the next boot that asks.
    calibrations.get(key).catch(() => calibrations.delete(key));
  }
  return calibrations.get(key);
}

/** One line for a calibration: what was measured, and the rate it gives. */
function calibrationLine(c) {
  const rate = c.rate > 1 ? `×${c.rate}` : "×1 (this machine is as slow as the reference, or slower: not slowed)";
  const page = c.browser === "chromium" ? "" : `; the page is not throttled (no throttle in ${c.browser})`;
  return `${c.name} in ${c.browser}: one render of ${c.preset} ${c.measuredMs} ms here, ${c.referenceMs} ms on the reference: ${rate}${page}`;
}

/** The rates a boot on a profile ran at (`app.profile`), equal ones named
 *  together: "engine, farm and page ×4.41", "engine ×4, farm and page ×1". */
function rates(p) {
  const groups = [];
  for (const [what, r] of [["engine", p.engineRate], ["farm", p.farmRate], ["page", p.pageRate]]) {
    const g = groups.find((x) => x.r === r);
    if (g) g.what.push(what);
    else groups.push({ r, what: [what] });
  }
  const and = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0]);
  return groups.map((g) => `${and(g.what)} ×${g.r}`).join(", ");
}

/** The test's `profile` annotation for a boot on one (`app.profile`): its
 *  calibration, and the rates the boot ran at. */
function profileLine(p) {
  return `${calibrationLine(p)}; booted with the ${rates(p)}`;
}

/** Beside a budget's figure: the profile it was measured on, and the rates
 *  the test's boot ran at (a spec's own `slowEngine`, or a throttle, can
 *  make the engine's or the page's more than the profile's). */
function label(p) {
  return `on ${p.name} in ${p.browser} (${rates(p)})`;
}

// ---- What the profile spec measures (reference_profile.spec.js) ----

/** A spec's own code in the engine worker (`app.boot`'s `workerPrefix`):
 *  `__profile_render` renders a preset there `runs` times, after one to warm
 *  up unless `warm` is false, on the engine worker's own wasm instance (the
 *  glue worker.js loaded, imported again by the same address), and answers
 *  `__profile_rendered` with each time on the worker's clock, the tree and
 *  the phrase, and what the worker's slowdowns had done before the renders
 *  and after them (`self.__slowEngine`, perform_budget.js `SLOW_ENGINE`; none
 *  where none was served). Main ignores both; the engine's own work waits
 *  while it runs. */
const ENGINE_PROBE = `self.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || d.type !== "__profile_render") return;
  e.stopImmediatePropagation();
  const slowed = () => (self.__slowEngine || []).map((s) => ({ ...s }));
  (async () => {
    try {
      const glue = await import("./pkg/auracle_wasm.js?v=" + new URL(self.location.href).searchParams.get("v"));
      const engine = new glue.WasmEngine(1n, 8);
      const phrase = engine.phrase_json();
      const found = JSON.parse(engine.preset_list()).find((p) => p.name === d.preset);
      const tree = found ? engine.preset_tree_json(found.index) : "";
      engine.free();
      const before = slowed();
      const times = [];
      for (let i = d.warm ? 0 : 1; i <= d.runs; i++) {
        const t = performance.now();
        const job = glue.farm_render(tree, phrase, true);
        const ms = performance.now() - t;
        const ok = job.ok;
        job.free();
        if (!ok) throw new Error(d.preset + " did not render");
        if (i > 0) times.push(ms);
      }
      self.postMessage({ type: "__profile_rendered", times, tree, phrase, slowed: { before, after: slowed() } });
    } catch (err) {
      self.postMessage({ type: "__profile_rendered", error: String((err && err.message) || err) });
    }
  })();
});
`;

/** A preset rendered `runs` times in the engine worker of a page booted with
 *  ENGINE_PROBE, after one to warm up unless `warm` is false: { ms (the
 *  median), times, tree, phrase, slowed: { before, after } }. */
async function engineRender(page, { preset, runs = CALIBRATION_RUNS, warm = true }) {
  const got = await page.evaluate(
    ([name, n, w]) =>
      new Promise((resolve) => {
        const worker = window.__tap.engine;
        const on = (e) => {
          if (!e.data || e.data.type !== "__profile_rendered") return;
          worker.removeEventListener("message", on);
          resolve(e.data);
        };
        worker.addEventListener("message", on);
        // Past the tap: it is the spec's request, not the app's.
        window.__tap.post({ type: "__profile_render", preset: name, runs: n, warm: w });
      }),
    [preset, runs, warm],
  );
  if (got.error) throw new Error(`the engine's render: ${got.error}`);
  return { ms: median(got.times), times: got.times, tree: got.tree, phrase: got.phrase, slowed: got.slowed };
}

/** `tree` rendered `runs` times on the farm, after one to warm up unless
 *  `warm` is false: a farm worker of the page's own, spawned and handed its
 *  work as main and the engine hand a crew theirs (the compiled module, a
 *  port, the phrase, a job), so the address the app's farm workers load is
 *  the one it loads. Each time is from the job sent to its `done`, on the
 *  page's clock. What the worker's slowdowns had done is asked before the
 *  jobs and after them (`slowed: { before, after }`, perform_budget.js
 *  `SLOW_ENGINE`), each null where the worker served none and so never
 *  answered (given up after ten seconds). It says `bye` after, and leaves
 *  the page's own crew alone. { ms (the median), times, slowed }. */
async function farmRender(page, { tree, phrase, runs = CALIBRATION_RUNS, warm = true }) {
  const got = await page.evaluate(
    async ([t, p, n, warmUp]) => {
      const v = "profile";
      const module = await WebAssembly.compileStreaming(fetch(`./pkg/auracle_wasm_bg.wasm?v=${v}`));
      const w = new Worker(`./farm.js?v=${v}`, { type: "module" });
      const slowed = () =>
        new Promise((resolve) => {
          const timer = setTimeout(() => resolve(null), 10_000);
          w.onmessage = (e) => {
            if (!e.data || e.data.type !== "__slow_engine") return;
            clearTimeout(timer);
            resolve(e.data.slowed);
          };
          w.postMessage({ type: "__slow_engine" });
        });
      const ch = new MessageChannel();
      const port = ch.port1;
      const next = (type) =>
        new Promise((resolve, reject) => {
          port.onmessage = (e) => {
            const d = e.data;
            if (d.type === type) resolve(d);
            else if (d.type === "failed" || d.type === "cannot" || d.type === "refused") reject(new Error(`the farm worker: ${d.type} ${d.reason || ""}`));
          };
        });
      const ready = next("ready");
      w.postMessage({ type: "boot", module, url: `./pkg/auracle_wasm_bg.wasm?v=${v}`, glue: `./pkg/auracle_wasm.js?v=${v}`, port: ch.port2 }, [ch.port2]);
      await ready;
      port.postMessage({ type: "phrase", json: p });
      const before = await slowed();
      const times = [];
      for (let i = warmUp ? 0 : 1; i <= n; i++) {
        const done = next("done");
        const at = performance.now();
        port.postMessage({ type: "job", i, tree: t, wantAudio: true });
        const d = await done;
        if (!d.ok) throw new Error("the farm's render was not ok");
        if (i > 0) times.push(performance.now() - at);
      }
      const after = await slowed();
      port.postMessage({ type: "bye" });
      return { times, slowed: { before, after } };
    },
    [tree, phrase, runs, warm],
  );
  return { ms: median(got.times), times: got.times, slowed: got.slowed };
}

/** The calls a worker's slowdowns slowed between two readings of
 *  `self.__slowEngine` (`slowed: { before, after }`), and the rate each ran
 *  at: [{ rate, calls }], one per slowdown served. */
function slowedCalls({ before, after }) {
  return (after || []).map((s, i) => ({ rate: s.rate, calls: s.calls - (((before || [])[i] || {}).calls || 0) }));
}

/** At what rate an unslowed render here would still pass for a slowed one:
 *  below it the comparison cannot tell them apart. */
const TELLS = 2;

/** What a render on the profile is held to against one here, unslowed, now
 *  (`app.profile` `p`): the calibration's render measured again in a context
 *  of its own (`measure`), and for the engine and the farm a floor, half its
 *  rate times that render's median, which a render slowed at the rate clears
 *  and an unslowed one does not. Only where a rate can tell (TELLS or more);
 *  below it the floor is 0, and where neither can, nothing is measured.
 *  { engine, farm }, each { floorMs, said }. */
async function unslowedFloors(where, p) {
  const tells = (rate) => rate >= TELLS;
  const unslowedMs = tells(p.engineRate) || tells(p.farmRate) ? median(await measure(where.browser, where.baseURL, profileOf(p.name))) : null;
  const floor = (rate) =>
    tells(rate)
      ? { floorMs: (unslowedMs * rate) / 2, said: `half of ×${rate} times ${Math.round(unslowedMs)} ms, ${p.preset} unslowed here now` }
      : { floorMs: 0, said: `nothing: at ×${rate} an unslowed render would pass too (a render tells from ×${TELLS})` };
  return { engine: floor(p.engineRate), farm: floor(p.farmRate) };
}

/** A fixed piece of work on `page`'s main thread, timed on its clock: the
 *  median of three, in ms. On a throttled page it takes the throttle's rate
 *  times what it takes on a plain one. */
function pageWork(page) {
  return page.evaluate(() => {
    const times = [];
    let x = 0;
    for (let k = 0; k < 3; k++) {
      const t = performance.now();
      for (let i = 0; i < 20_000_000; i++) x = (x + i * 7) % 1_000_003;
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    return times[1] + x * 0;
  });
}

/** How many of the page's workers load farm.js: its render farm's, and any a
 *  spec spawned. */
function farmWorkers(page) {
  return page.evaluate(() => window.__tap.workers.filter((w) => /\/farm\.js(\?|$)/.test(w.__tapUrl)).length);
}

/** The routes `app.boot` serves the workers through on a profile: worker.js
 *  and farm.js, each with `prefix` ahead of it. */
const WORKER_JS = /\/worker\.js(\?|$)/;
const FARM_JS = /\/farm\.js(\?|$)/;

module.exports = {
  PROFILES,
  CALIBRATION_RUNS,
  profileOf,
  calibrated,
  calibrationLine,
  profileLine,
  label,
  median,
  measure,
  ENGINE_PROBE,
  engineRender,
  farmRender,
  slowedCalls,
  TELLS,
  unslowedFloors,
  farmWorkers,
  pageWork,
  WORKER_JS,
  FARM_JS,
  SLOW_ENGINE: performBudget.SLOW_ENGINE,
};
