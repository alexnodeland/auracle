// What the cable probe costs in the browser's speed class (Plan-005 task 9e):
// `edit_cable_levels` (one render of the phrase, every audio cable read after
// every tick) on each preset in hand, beside `farm_render` without audio (one
// render of the phrase, then φ), in this thread's CPU time. Run by node, whose
// V8 is the engine Chrome runs; single-threaded, as the engine worker is. The
// native twin, which also times a plain render and checks the probed render
// bit for bit, is
// `cargo run --release -p auracle-features --example cable_probe`.
//
//   make wasm
//   node crates/auracle-wasm/examples/cable_cost.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = fileURLToPath(new URL("../../../apps/web/pkg/", import.meta.url));
const mod = await import(`${pkg}auracle_wasm.js`);
mod.initSync({ module: readFileSync(`${pkg}auracle_wasm_bg.wasm`) });

const cpuNow = () => {
  const u = process.threadCpuUsage ? process.threadCpuUsage() : process.cpuUsage();
  return (u.user + u.system) / 1e3;
};
const median = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];

// A small pool, so a preset can be loaded (an insert needs the standardizer
// a filled pool fits) and opened.
const e = new mod.WasmEngine(20260928n, 6);
while (e.fill_step(3) > 0) {}
e.restandardize_if_untaught();
const phrase = e.phrase_json();
const presets = JSON.parse(e.preset_list());
console.log(`${presets.length} presets, the standard phrase\n`);
console.log("preset                     cables  probe ms  render+φ ms  ratio");
const probe = [];
const featurize = [];
for (let i = 0; i < presets.length; i++) {
  const id = Number(e.load_preset(i));
  if (id <= 0 || !e.edit_begin(id)) continue;
  const tree = e.edit_tree_json();
  e.edit_cable_levels(); // warm
  let c = cpuNow();
  const out = JSON.parse(e.edit_cable_levels());
  const p = cpuNow() - c;
  c = cpuNow();
  const job = mod.farm_render(tree, phrase, false);
  const f = cpuNow() - c;
  job.free();
  probe.push(p);
  featurize.push(f);
  console.log(
    `${presets[i].name.padEnd(26)} ${String(out.cables.length).padStart(6)} ${p.toFixed(0).padStart(9)} ` +
      `${f.toFixed(0).padStart(12)} ${(p / f).toFixed(2).padStart(6)}`,
  );
}
console.log(
  `\nmedian: probe ${median(probe).toFixed(0)} CPU ms, render+φ ${median(featurize).toFixed(0)} CPU ms, ` +
    `over ${probe.length} presets`,
);
