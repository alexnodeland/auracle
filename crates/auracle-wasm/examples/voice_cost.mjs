// What one live voice of each module kind costs the audio thread in wasm:
// `LivePoly`, the instrument the AudioWorklet runs, with one voice held,
// under node, whose V8 is the engine Chrome runs. The per-kind table of
// docs/notes/render-cost-2026-10/, for the voice count a CPU can carry
// (#320: up to ten voices).
//
//   cargo run -p auracle-features --example bench_render --release -- --kinds=/tmp/kinds.json
//   make wasm
//   node crates/auracle-wasm/examples/voice_cost.mjs /tmp/kinds.json [--reps=3] [--rate=48000] [pkg]
//
// The trees are `bench_render --kinds`'s: a saw voice, then each source in
// its place, each processor inserted over it, the ladder, and each
// modulation on its slot. Each is built as `new LivePoly(tree, rate, 1)`, a
// key pressed, and a second of 128-frame quanta rendered through
// `process_ptr`; the figure is the least of `--reps` seconds, in CPU ms per
// voice-second, and what the kind adds to the saw voice. At 48 kHz a core
// has 1000 ms a second, so 10 ms per voice-second is 1% of a core for each
// voice, before the page, the browser and the other threads.
//
// The cost is this thread's CPU time (`process.threadCpuUsage()`, node 23.9
// and later; on an older node the process's, which the header says).
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const flags = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.slice(2).split("=");
      return [k, v ?? true];
    }),
);
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!args[0]) throw new Error("name the kinds file: bench_render --kinds=PATH writes it");
const REPS = Number(flags.reps || 3);
const RATE = Number(flags.rate || 48_000);
const Q = 128;
const QUANTA = Math.round(RATE / Q);
const pkg = path.resolve(args[1] || fileURLToPath(new URL("../../../apps/web/pkg/", import.meta.url)));
const mod = await import(pathToFileURL(path.join(pkg, "auracle_wasm.js")).href);
mod.initSync({ module: readFileSync(path.join(pkg, "auracle_wasm_bg.wasm")) });

const THREAD = typeof process.threadCpuUsage === "function";
const cpu = () => {
  const u = THREAD ? process.threadCpuUsage() : process.cpuUsage();
  return (u.user + u.system) / 1e3;
};
const load = () => os.loadavg()[0].toFixed(0);

const trees = JSON.parse(readFileSync(args[0], "utf8")).trees;
console.log(
  `one live voice of each module kind (LivePoly, 1 voice, ${RATE} Hz, ${Q}-frame quanta): ` +
    `${THREAD ? "this thread's" : "the process's"} CPU ms per voice-second, least of ${REPS}; ` +
    `node ${process.version}, load average ${load()} on ${os.cpus().length} cores`,
);
console.log(`${"kind".padEnd(22)} ${"ms/s".padStart(8)} ${"+ on saw".padStart(9)} ${"µs/quantum".padStart(11)}`);
let base = null;
for (const t of trees) {
  const poly = new mod.LivePoly(JSON.stringify(t.tree), RATE, 1);
  poly.note_on(60, 1.0);
  for (let i = 0; i < 40; i++) poly.process_ptr(Q); // past the attack, and the JIT warm
  let best = Infinity;
  for (let r = 0; r < REPS; r++) {
    const c = cpu();
    for (let i = 0; i < QUANTA; i++) poly.process_ptr(Q);
    best = Math.min(best, cpu() - c);
  }
  poly.free();
  if (base === null) base = best;
  console.log(
    `${t.name.slice(0, 22).padEnd(22)} ${best.toFixed(1).padStart(8)} ${(best - base).toFixed(1).padStart(9)} ` +
      `${((best / QUANTA) * 1e3).toFixed(1).padStart(11)}`,
  );
}
console.log(`load average ${load()}, after`);
