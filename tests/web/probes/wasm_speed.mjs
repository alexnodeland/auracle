// Is Firefox's wasm slower than Chromium's on the live voice (#288)? The same
// quanta of `LivePoly`, four voices held, timed in a worker of each browser
// and in node (V8, the figure `crates/auracle-wasm/examples/live_cost.mjs`
// prints), beside each other. A worklet runs wasm on the same engine as a
// worker does (V8's TurboFan, SpiderMonkey's Ion), so this is the part of
// "Firefox's AudioWorklet versus Chromium's" a machine with no sound card can
// answer; how each browser schedules its audio thread it cannot.
//
//   cd tests/web && AURACLE_TEST_PORT=8823 \
//     ../../www/video/tools/one_browser.sh node probes/wasm_speed.mjs [--presets="Gut String,Loom"] [--batch=32]
//
// It serves a page and a worker of its own at /__probe/ on the app's
// server (a route, nothing on disk) and reads the engine from apps/web/pkg.
import { readFileSync } from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium, firefox } = require("@playwright/test");
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; }));
const BATCH = Number(flags.batch || 32);
const NAMES = String(flags.presets || "Gut String,Two Minds,Wobble Board,Loom").split(",");
const PORT = process.env.AURACLE_TEST_PORT || "8642";
const BUDGET_MS = 128 / 48_000 * 1e3;

const pkg = here("../../../apps/web/pkg/");
const bench = readFileSync(here("./wasm_speed_bench.mjs"), "utf8");
const WORKER = `
import init, * as mod from "/pkg/auracle_wasm.js";
import { bench } from "/__probe/bench.mjs";
await init();
self.postMessage(bench(mod, ${JSON.stringify({ names: NAMES, batch: BATCH })}));
`;

async function inBrowser(kind) {
  const browser = await (kind === "firefox" ? firefox : chromium).launch();
  try {
    const page = await browser.newPage();
    await page.route("**/__probe/**", (route) => {
      const url = route.request().url();
      if (url.endsWith("/page.html")) return route.fulfill({ body: "<!doctype html><title>probe</title>", contentType: "text/html" });
      if (url.endsWith("/worker.mjs")) return route.fulfill({ body: WORKER, contentType: "text/javascript" });
      return route.fulfill({ body: bench, contentType: "text/javascript" });
    });
    await page.goto(`http://localhost:${PORT}/__probe/page.html`);
    return await page.evaluate(
      () => new Promise((resolve, reject) => {
        const w = new Worker("/__probe/worker.mjs", { type: "module" });
        w.onmessage = (e) => resolve(e.data);
        w.onerror = (e) => reject(new Error(e.message));
      }),
    );
  } finally {
    await browser.close();
  }
}

const mod = await import(`${pkg}auracle_wasm.js`);
mod.initSync({ module: readFileSync(`${pkg}auracle_wasm_bg.wasm`) });
const { bench: run } = await import(here("./wasm_speed_bench.mjs"));
const results = { node: run(mod, { names: NAMES, batch: BATCH }) };
console.log(`load average ${os.loadavg()[0].toFixed(0)} before the browsers; ms per 128-frame quantum, 4 voices held, the least of 200 batches of ${BATCH} (p10 and median beside it; Firefox's clock rounds to 1 ms, so a batch must be long)`);
for (const kind of ["chromium", "firefox"]) results[kind] = await inBrowser(kind);
console.log(`load average ${os.loadavg()[0].toFixed(0)} after`);
const f = (x) => x.toFixed(3);
console.log(`${"".padEnd(14)} ${["node (V8)", "chromium", "firefox"].map((h) => h.padStart(26)).join("")}   firefox / chromium (least)`);
for (const [i, name] of NAMES.entries()) {
  const cells = ["node", "chromium", "firefox"].map((k) => {
    const r = results[k][i];
    return `${f(r.min)} (${f(r.p10)}, ${f(r.p50)})`.padStart(26);
  });
  console.log(`${name.padEnd(14)} ${cells.join("")}   ${(results.firefox[i].min / results.chromium[i].min).toFixed(2)}x   (${f((results.firefox[i].min / BUDGET_MS) * 100)}% / ${f((results.chromium[i].min / BUDGET_MS) * 100)}% of a 2.67 ms quantum)`);
}
