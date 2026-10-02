// What a figure and the lesson cost in the browser's speed class (Plan-005
// task 10): `explain_render` (one render of the phrase, then its portrait)
// and `lesson_filter` (the same with the lesson's lowpass on the output,
// its portrait, the filter's response and the audition), beside
// `farm_render` without audio (one render, then φ), on every preset, in this
// thread's CPU time. Run by node, whose V8 is the engine Chrome runs;
// single-threaded, as the engine worker is. Also the reply's size, which
// crosses the worker boundary as JSON.
//
//   make wasm
//   node crates/auracle-wasm/examples/explain_cost.mjs
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
const max = (xs) => Math.max(...xs);

const e = new mod.WasmEngine(20260928n, 6);
while (e.fill_step(3) > 0) {}
e.restandardize_if_untaught();
const phrase = e.phrase_json();
const presets = JSON.parse(e.preset_list());
const figure = [];
const lesson = [];
const plain = [];
const bytes = [];
for (let i = 0; i < presets.length; i++) {
  const id = Number(e.load_preset(i));
  if (id <= 0) continue;
  const tree = e.tree_json_of(id);
  let c = cpuNow();
  const reply = e.explain_render(tree, "[]", 0);
  figure.push(cpuNow() - c);
  bytes.push(reply.length);
  c = cpuNow();
  const r = e.lesson_filter(tree, "[]", 0.6);
  r.take_samples();
  r.free();
  lesson.push(cpuNow() - c);
  c = cpuNow();
  mod.farm_render(tree, phrase, false).free();
  plain.push(cpuNow() - c);
}
console.log(`${figure.length} presets, the standard phrase, CPU ms (median · max)`);
console.log(`explain_render  ${median(figure).toFixed(0)} · ${max(figure).toFixed(0)}`);
console.log(`lesson_filter   ${median(lesson).toFixed(0)} · ${max(lesson).toFixed(0)}`);
console.log(`render + φ      ${median(plain).toFixed(0)} · ${max(plain).toFixed(0)}`);
console.log(`a figure's reply: ${(median(bytes) / 1024).toFixed(1)} KB of JSON (median)`);
