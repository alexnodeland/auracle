// What measuring the palette costs in the browser's speed class: PERFORM's
// measurement of the presets through the built package, today's six against
// all eighteen, on the engine the shipped wirings are measured under. Run by
// node, whose V8 is the engine Chrome runs; single-threaded, as the engine
// worker is. `palette_census.rs` beside this file is the native side, and the
// reach.
//
//   make wasm
//   node crates/auracle-wasm/examples/palette_cost.mjs [stride]
//
// Every `stride`-th preset (default 4). Each is measured cold, the six first
// (`perform_wire` as the worker asks today: renders for the Jacobian, then
// four per reachable control and two more for a retry, whose ±½ points are
// memo hits), then all eighteen
// (`perform_wire` with every palette index), which reuses the six's renders
// from the memo and pays only for the twelve's verification. The renders are
// counted from `memo_stats`, so ms per render is what one costs here.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const pkg = fileURLToPath(new URL("../../../apps/web/pkg/", import.meta.url));
const stride = Math.max(1, Number(process.argv[2] || 4));
const mod = await import(`${pkg}auracle_wasm.js`);
mod.initSync({ module: readFileSync(`${pkg}auracle_wasm_bg.wasm`) });
const { WasmEngine } = mod;

// `shipped::boot`: the seed and pool PERFORM's wirings are measured under.
const t0 = performance.now();
const e = new WasmEngine(20260928n, 40);
while (e.fill_step(4) > 0) {}
e.restandardize_if_untaught();
console.error(`booted a pool of ${JSON.parse(e.status()).pool} in ${((performance.now() - t0) / 1e3).toFixed(1)} s`);

const all = JSON.stringify(Array.from({ length: 18 }, (_, i) => i));
const misses = () => JSON.parse(e.memo_stats()).misses;
const median = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const reaches = (reply) => JSON.parse(reply).wiring.filter((w) => !w.search).length;

const presets = JSON.parse(e.preset_list());
const rows = [];
console.log("preset                 knobs  six: renders    s  reach | eighteen: renders    s  reach");
for (let i = 0; i < presets.length; i += stride) {
  const id = e.load_preset(i);
  if (!id) continue;
  const tree = e.tree_json_of(id);
  let m = misses();
  let t = performance.now();
  const six = e.perform_wire(tree, "[]");
  const sixT = (performance.now() - t) / 1e3;
  const sixR = misses() - m;
  m = misses();
  t = performance.now();
  const full = e.perform_wire(tree, "[]", all);
  const moreT = (performance.now() - t) / 1e3;
  const moreR = misses() - m;
  const knobs = JSON.parse(six).addrs.length;
  rows.push({ sixR, sixT, allR: sixR + moreR, allT: sixT + moreT });
  console.log(
    `${presets[i].name.padEnd(22)} ${String(knobs).padStart(5)}  ${String(sixR).padStart(12)} ${sixT.toFixed(1).padStart(5)} ${String(reaches(six)).padStart(5)} |${String(sixR + moreR).padStart(17)} ${(sixT + moreT).toFixed(1).padStart(5)} ${String(reaches(full)).padStart(5)}`,
  );
}
const col = (k) => rows.map((r) => r[k]);
const perRender = col("sixT").reduce((a, b) => a + b, 0) / col("sixR").reduce((a, b) => a + b, 0);
console.log(`\n${rows.length} presets, wasm (node ${process.version})`);
console.log("            renders: median  mean   seconds: median  mean");
console.log(`six          ${String(median(col("sixR"))).padStart(14)} ${mean(col("sixR")).toFixed(1).padStart(5)} ${median(col("sixT")).toFixed(2).padStart(16)} ${mean(col("sixT")).toFixed(2).padStart(5)}`);
console.log(`eighteen     ${String(median(col("allR"))).padStart(14)} ${mean(col("allR")).toFixed(1).padStart(5)} ${median(col("allT")).toFixed(2).padStart(16)} ${mean(col("allT")).toFixed(2).padStart(5)}`);
console.log(`one render: ${(1e3 * perRender).toFixed(0)} ms`);
