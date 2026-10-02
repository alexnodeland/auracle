// What a sound of your own costs in wasm (Plan-005 task 11): the built
// package `make wasm` writes to apps/web/pkg, run by node, whose V8 is the
// engine Chrome runs.
//
//   make wasm
//   node crates/auracle-wasm/examples/own_cost.mjs [seconds=30] [rate=48000]
//
// Boots a pool of 40 (one render at a time, about 10 s), hands over the
// shipped wirings (`own_presets_set`), brings a synthetic recording of
// `seconds` at `rate` (`own_sound_set`: the analysis, the map frame and the
// nearest sounds), asks for it again (`own_sound`), then teaches a few picks,
// fits, and opens a breed toward it (`refine_toward_jobs`) and walks its
// first job (`farm_walk`, the tilted target). Prints each in ms and the
// reply's size.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const pkg = fileURLToPath(new URL("../../../apps/web/pkg/", import.meta.url));
const wirings = fileURLToPath(new URL("../../../apps/web/perform-wirings.json", import.meta.url));
const seconds = Number(process.argv[2] || 30);
const rate = Number(process.argv[3] || 48000);
const mod = await import(`${pkg}auracle_wasm.js`);
mod.initSync({ module: readFileSync(`${pkg}auracle_wasm_bg.wasm`) });
const { WasmEngine, farm_walk } = mod;

const ms = (f) => {
  const t = performance.now();
  const v = f();
  return [performance.now() - t, v];
};
const say = (what, t, v) => console.log(`${what.padEnd(28)} ${t.toFixed(1).padStart(9)} ms  ${String(v)}`);

const t0 = performance.now();
const e = new WasmEngine(20260928n, 40);
while (e.fill_step(4) > 0) {}
e.restandardize_if_untaught();
console.error(`booted a pool of ${JSON.parse(e.status()).pool} in ${((performance.now() - t0) / 1e3).toFixed(1)} s`);

// A recording: a detuned saw pad with a slow swell and a filter that breathes.
const n = Math.floor(seconds * rate);
const pcm = new Float32Array(n);
for (let i = 0; i < n; i++) {
  const t = i / rate;
  let v = 0;
  for (let h = 1; h < 20; h++) {
    const g = Math.exp(-h / (6 + 4 * Math.sin(2 * Math.PI * 0.2 * t)));
    v += (g / h) * (Math.sin(2 * Math.PI * 110 * h * t) + Math.sin(2 * Math.PI * 110.6 * h * t));
  }
  pcm[i] = 0.15 * v * (1 - Math.exp(-t * 2));
}

const [tp, np] = ms(() => e.own_presets_set(readFileSync(wirings, "utf8")));
say("own_presets_set", tp, `${np} presets`);
const [ts, reply] = ms(() => e.own_sound_set(pcm, rate, "Field recording 03"));
const r = JSON.parse(reply);
say(`own_sound_set (${seconds} s)`, ts, `${reply.length} B, ok ${r.ok}, ${r.seconds?.toFixed(1)} s measured`);
console.log(`  masked ${r.masked.length} of ${r.z.length}; map ${JSON.stringify(r.map)}`);
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
say("refine_toward_jobs", tj, `${jobs.length} B, ${j.jobs.length} jobs, parents ${j.jobs.map((x) => x.parent_id).join(" ")}`);
const ctx = JSON.stringify(j.context);
const [tw, walked] = ms(() => farm_walk(ctx, JSON.stringify(j.jobs[0])));
const w = JSON.parse(walked);
say("farm_walk (tilted, 1 job)", tw, w.child ? "a child" : `no child (${w.reason})`);
e.refine_finish();
