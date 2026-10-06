// Does the worklet's own wasm instance run slowly at first (#288)? The worklet
// compiles the engine from its bytes itself (live-audio.js `init`), so it
// starts on each engine's baseline tier (Chromium's Liftoff, Firefox's
// baseline) and moves to the optimizing one (TurboFan, Ion) in background
// threads, which on a 2-core laptop with the farm and the engine worker busy
// may be late. This times the first seconds of a fresh worker the same way:
// a module compiled from bytes, a `LivePoly` of a preset with four voices held,
// batches of 8 quanta played flat out, the median batch's ms per quantum in each
// 500 ms window since the first quantum.
//
//   cd tests/web && AURACLE_TEST_PORT=8823 \
//     ../../www/video/tools/one_browser.sh node probes/wasm_tierup.mjs [--preset=Loom] [--seconds=8]
import { readFileSync } from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium, firefox } = require("@playwright/test");
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; }));
const PRESET = flags.preset || "Loom";
const SECONDS = Number(flags.seconds || 8);
const PORT = process.env.AURACLE_TEST_PORT || "8642";
const pkg = here("../../../apps/web/pkg/");

const mod = await import(`${pkg}auracle_wasm.js`);
mod.initSync({ module: readFileSync(`${pkg}auracle_wasm_bg.wasm`) });
const e = new mod.WasmEngine(1n, 4);
const tree = e.preset_tree_json(JSON.parse(e.preset_list()).find((p) => p.name === PRESET).index);

// Runs in the worker: compile from bytes (as the worklet does), then play.
const WORKER = `
import * as glue from "/pkg/auracle_wasm.js";
const bytes = await (await fetch("/pkg/auracle_wasm_bg.wasm")).arrayBuffer();
const tc = performance.now();
glue.initSync({ module: new Uint8Array(bytes) });
const compiled = performance.now() - tc;
const poly = new glue.LivePoly(${JSON.stringify(tree)}, 48000, 4);
for (const n of [48, 55, 64, 72]) poly.note_on(n, 0.8);
const t0 = performance.now();
const windows = [];
let cur = [];
let edge = 500;
while (performance.now() - t0 < ${SECONDS * 1000}) {
  const t = performance.now();
  for (let q = 0; q < 8; q++) poly.process_ptr(128);
  const now = performance.now();
  cur.push((now - t) / 8);
  if (now - t0 >= edge) { cur.sort((a, b) => a - b); windows.push([edge / 1000, cur[Math.floor(cur.length / 2)], cur[0]]); cur = []; edge += 500; }
}
self.postMessage({ compiled, windows });
`;

async function inBrowser(kind) {
  const browser = await (kind === "firefox" ? firefox : chromium).launch();
  try {
    const page = await browser.newPage();
    await page.route("**/__probe/**", (route) => {
      const url = route.request().url();
      if (url.endsWith("/page.html")) return route.fulfill({ body: "<!doctype html><title>probe</title>", contentType: "text/html" });
      return route.fulfill({ body: WORKER, contentType: "text/javascript" });
    });
    await page.goto(`http://localhost:${PORT}/__probe/page.html`);
    return await page.evaluate(() => new Promise((resolve, reject) => {
      const w = new Worker("/__probe/worker.mjs", { type: "module" });
      w.onmessage = (ev) => resolve(ev.data);
      w.onerror = (ev) => reject(new Error(ev.message));
    }));
  } finally {
    await browser.close();
  }
}

console.log(`${PRESET}, four voices held; load average ${os.loadavg()[0].toFixed(0)}; ms per quantum, median (least) batch of 8 quanta, per 500 ms window since the first quantum`);
const out = {};
for (const kind of ["chromium", "firefox"]) out[kind] = await inBrowser(kind);
console.log(`load average ${os.loadavg()[0].toFixed(0)} after; wasm compiled from bytes in the worker: chromium ${out.chromium.compiled.toFixed(0)} ms, firefox ${out.firefox.compiled.toFixed(0)} ms (the worklet does this on the audio thread, once, at load)`);
console.log("window end".padEnd(12) + "chromium".padStart(18) + "firefox".padStart(18));
out.chromium.windows.forEach((w, i) => {
  const c = out.firefox.windows[i];
  console.log(`${(w[0] + " s").padEnd(12)}${`${w[1].toFixed(3)} (${w[2].toFixed(3)})`.padStart(18)}${c ? `${c[1].toFixed(3)} (${c[2].toFixed(3)})`.padStart(18) : ""}`);
});
