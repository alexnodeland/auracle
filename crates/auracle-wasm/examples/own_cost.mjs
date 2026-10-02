// What a sound of your own costs in wasm (Plan-005 task 11): the built
// package `make wasm` writes to apps/web/pkg, run by node, whose V8 is the
// engine Chrome runs.
//
//   make wasm
//   node crates/auracle-wasm/examples/own_cost.mjs [seconds=30] [rate=48000] [--file-only]
//
// Boots a pool of 40 (one render at a time, about 10 s), hands over the
// shipped wirings (`own_presets_set`), brings a synthetic recording of
// `seconds` at `rate` (`own_sound_set`: the analysis, the map frame and the
// nearest sounds), asks for it again (`own_sound`), then teaches a few picks,
// fits, and opens a breed toward it (`refine_toward_jobs`) and walks its
// first job (`farm_walk`, the tilted target). Prints each in ms and the
// reply's size, and how much the wasm memory grew for the file: linear
// memory never shrinks, so that growth is kept for the rest of the session.
//
// `--file-only` skips the boot and the breed: the analysis and the memory
// alone, on a fresh engine (no standardizer, so no z and no nearest).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const pkg = fileURLToPath(new URL("../../../apps/web/pkg/", import.meta.url));
const wirings = fileURLToPath(new URL("../../../apps/web/perform-wirings.json", import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const fileOnly = process.argv.includes("--file-only");
const seconds = Number(args[0] || 30);
const rate = Number(args[1] || 48000);
const mod = await import(`${pkg}auracle_wasm.js`);
const wasm = mod.initSync({ module: readFileSync(`${pkg}auracle_wasm_bg.wasm`) });
const { WasmEngine, farm_walk } = mod;
const mb = () => wasm.memory.buffer.byteLength / 2 ** 20;

const ms = (f) => {
  const t = performance.now();
  const v = f();
  return [performance.now() - t, v];
};
const say = (what, t, v) => console.log(`${what.padEnd(28)} ${t.toFixed(1).padStart(9)} ms  ${String(v)}`);

const t0 = performance.now();
const e = new WasmEngine(20260928n, 40);
if (!fileOnly) {
  while (e.fill_step(4) > 0) {}
  e.restandardize_if_untaught();
  console.error(`booted a pool of ${JSON.parse(e.status()).pool} in ${((performance.now() - t0) / 1e3).toFixed(1)} s`);
}

// A recording: two detuned saws, one-pole filtered, with a slow swell and a
// breathing level. Cheap to make at any length and rate.
const n = Math.floor(seconds * rate);
const pcm = new Float32Array(n);
let p1 = 0, p2 = 0, lp = 0;
for (let i = 0; i < n; i++) {
  const t = i / rate;
  p1 = (p1 + 110 / rate) % 1;
  p2 = (p2 + 110.6 / rate) % 1;
  lp += 0.08 * (p1 + p2 - 1 - lp);
  pcm[i] = 0.4 * lp * (1 - Math.exp(-t * 2)) * (0.8 + 0.2 * Math.sin(2 * Math.PI * 0.2 * t));
}

if (!fileOnly) {
  const [tp, np] = ms(() => e.own_presets_set(readFileSync(wirings, "utf8")));
  say("own_presets_set", tp, `${np} presets`);
}
const before = mb();
const [ts, reply] = ms(() => e.own_sound_set(pcm, rate, "Field recording 03"));
const grew = mb() - before;
const r = JSON.parse(reply);
say(`own_sound_set (${seconds} s at ${rate / 1000} kHz)`, ts, `${reply.length} B, ok ${r.ok}`);
console.log(`  input ${((n * 4) / 2 ** 20).toFixed(1)} MB of f32; wasm memory grew ${grew.toFixed(1)} MB (now ${mb().toFixed(1)} MB)`);
if (!r.ok) {
  console.log(`  refused: ${r.error}`);
  process.exit(0);
}
console.log(`  ${r.seconds.toFixed(1)} s measured${r.truncated ? " (cut)" : ""}; masked ${r.masked.length}`);
if (fileOnly) process.exit(0);
console.log(`  map ${JSON.stringify(r.map)}`);
console.log(`  nearest ${r.nearest.map((x) => `${x.id}:${x.distance.toFixed(2)}`).join(" ")}`);
console.log(`  presets ${r.nearest_presets.map((x) => `${x.name} ${x.distance.toFixed(2)}`).join(", ")}`);
const [ta, again] = ms(() => e.own_sound());
say("own_sound", ta, `${again.length} B`);

for (let i = 0; i < 24; i++) {
  const [a, b] = JSON.parse(e.next_duel());
  e.record_duel(a, b, (a * 7 + b) % 3 !== 0);
}
const [tf] = ms(() => e.fit());
say("fit (24 picks)", tf, "");
const [tj, jobs] = ms(() => e.refine_toward_jobs());
const j = JSON.parse(jobs);
if (!j.context) {
  console.log("refine_toward_jobs opened nothing");
  process.exit(0);
}
say("refine_toward_jobs", tj, `${jobs.length} B, ${j.jobs.length} jobs, parents ${j.jobs.map((x) => x.parent_id).join(" ")}`);
const ctx = JSON.stringify(j.context);
const [tw, walked] = ms(() => farm_walk(ctx, JSON.stringify(j.jobs[0])));
const w = JSON.parse(walked);
say("farm_walk (tilted, 1 job)", tw, w.child ? "a child" : `no child (${w.reason})`);
e.refine_finish();
