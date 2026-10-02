// What RECORD costs the audio thread (Plan-007 task 6): the worklet's port
// handler runs on the render thread, so `take_start` (one voice of the sound
// compiled: `new LivePoly(tree, rate, 1)`) and `take_stop` (`take_json`, the
// take encoded as base64 JSON) are time the render thread is not rendering.
// Timed here in wall time, on node, whose V8 is the engine Chrome runs; one
// thread, as the worklet is. A render quantum is 128 frames: 2.67 ms at
// 48 kHz.
//
//   make wasm
//   node crates/auracle-wasm/examples/take_cost.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = fileURLToPath(new URL("../../../apps/web/pkg/", import.meta.url));
const mod = await import(`${pkg}auracle_wasm.js`);
const wasm = mod.initSync({ module: readFileSync(`${pkg}auracle_wasm_bg.wasm`) });

const RATE = 48_000;
const QUANTUM_MS = (128 / RATE) * 1e3;
const median = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
const timed = (f) => {
  const t0 = performance.now();
  const r = f();
  return [performance.now() - t0, r];
};

// Every preset's tree, as the bench would hand it to RECORD.
const e = new mod.WasmEngine(20261002n, 6);
while (e.fill_step(3) > 0) {}
e.restandardize_if_untaught();
const presets = JSON.parse(e.preset_list());
const compile = [];
for (let i = 0; i < presets.length; i++) {
  const id = Number(e.load_preset(i));
  if (id <= 0 || !e.edit_begin(id)) continue;
  const tree = e.edit_tree_json();
  new mod.LivePoly(tree, RATE, 1).free(); // warm
  const ts = [];
  for (let k = 0; k < 5; k++) {
    const [ms, p] = timed(() => new mod.LivePoly(tree, RATE, 1));
    p.free();
    ts.push(ms);
  }
  compile.push({ name: presets[i].name, ms: median(ts), bytes: tree.length });
}
compile.sort((a, b) => a.ms - b.ms);
const at = (q) => compile[Math.min(compile.length - 1, Math.floor(compile.length * q))].ms;
console.log(`take_start, one voice compiled, ${compile.length} presets at ${RATE} Hz:`);
console.log(`  median ${at(0.5).toFixed(2)} ms, p90 ${at(0.9).toFixed(2)} ms, worst ${compile.at(-1).ms.toFixed(2)} ms (${compile.at(-1).name}, a ${compile.at(-1).bytes}-byte tree)`);
console.log(`  a quantum is ${QUANTUM_MS.toFixed(2)} ms: over one for ${compile.filter((c) => c.ms > QUANTUM_MS).length} of ${compile.length}`);

// A CAPTURE recording 4 s (the longest take) of a tone, then take_stop.
const capture = (take) => JSON.stringify({
  amp: { attack: 0.01, decay: 0.3, sustain: 0.95, release: 0.05 },
  root: { Capture: { play: "hold", input: { AudioIn: { input: 0, gain: 24 / 36, channel: "Both" } }, take } },
});
const empty = { format: "f32le-base64", sample_rate: RATE, length: 0, data: "" };
const p = new mod.LivePoly(capture(empty), RATE, 1);
p.set_leveler(false);
p.note_on(60, 1.0);
p.set_record("node", true);
const seconds = mod.take_seconds();
const quanta = Math.ceil((seconds * RATE) / 128) + 8;
let worstQ = 0;
for (let q = 0; q < quanta; q++) {
  const view = new Float32Array(wasm.memory.buffer, p.input_ptr(), p.input_capacity() * 2);
  for (let i = 0; i < 128; i++) {
    const x = 0.5 * Math.sin(((q * 128 + i) * 330 * 2 * Math.PI) / RATE);
    view[2 * i] = x;
    view[2 * i + 1] = x;
  }
  p.write_input(128, 2);
  const [ms] = timed(() => p.process_ptr(128));
  worstQ = Math.max(worstQ, ms);
}
const stops = [];
let json = "";
for (let k = 0; k < 5; k++) {
  const [ms, j] = timed(() => p.take_json("node"));
  stops.push(ms);
  json = j;
}
p.set_record("node", false);
p.free();
console.log(`take_stop, a ${seconds} s take at ${RATE} Hz (${(json.length / 1e6).toFixed(2)} MB of JSON): ${median(stops).toFixed(2)} ms`);
console.log(`  the worst recording quantum: ${worstQ.toFixed(3)} ms`);

// What the engine worker does instead, off the audio thread: render_take,
// the recorded input played through the CAPTURE's branch and encoded.
const input = new Float32Array(Math.round(seconds * RATE) * 2);
for (let i = 0; i < input.length / 2; i++) {
  const x = 0.5 * Math.sin((i * 330 * 2 * Math.PI) / RATE);
  input[2 * i] = x;
  input[2 * i + 1] = x;
}
const renders = [];
for (let k = 0; k < 3; k++) {
  const [ms] = timed(() => mod.render_take(capture(empty), "node", input, 2, RATE));
  renders.push(ms);
}
console.log(`render_take in the engine worker, ${seconds} s: ${median(renders).toFixed(1)} ms (not the audio thread's)`);

// take_start of a sound that already holds a full take: its compile decodes it.
const full = JSON.parse(json);
const [, warm] = timed(() => new mod.LivePoly(capture(full), RATE, 1));
warm.free();
const decode = [];
for (let k = 0; k < 5; k++) {
  const [ms, q] = timed(() => new mod.LivePoly(capture(full), RATE, 1));
  q.free();
  decode.push(ms);
}
console.log(`take_start of a CAPTURE holding a ${seconds} s take: ${median(decode).toFixed(2)} ms`);
