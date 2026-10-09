// Scratch: voice_cost.mjs's measurement, two packages alternated per kind in
// one process, SECONDS voice-seconds per rep, least of REPS, thread CPU time.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
const [kinds, pa, pb, secs = "5", reps = "3"] = process.argv.slice(2);
const RATE = 48_000, Q = 128, QUANTA = Math.round((RATE / Q) * Number(secs)), REPS = Number(reps);
async function load(pkg) {
  const mod = await import(pathToFileURL(path.join(path.resolve(pkg), "auracle_wasm.js")).href + "?" + pkg);
  mod.initSync({ module: readFileSync(path.join(pkg, "auracle_wasm_bg.wasm")) });
  return mod;
}
const A = await load(pa), B = await load(pb);
const cpu = () => { const u = process.threadCpuUsage(); return (u.user + u.system) / 1e3; };
const trees = JSON.parse(readFileSync(kinds, "utf8")).trees;
console.log(`ms of this thread's CPU per voice-second, ${secs} s a rep, least of ${REPS}, alternated; load ${os.loadavg()[0].toFixed(0)}`);
console.log(`${"kind".padEnd(22)} ${"before".padStart(8)} ${"after".padStart(8)} ${"ratio".padStart(7)}`);
let sa = 0, sb = 0;
for (const t of trees) {
  const json = JSON.stringify(t.tree);
  const best = [Infinity, Infinity];
  const polys = [A, B].map((m) => { const p = new m.LivePoly(json, RATE, 1); p.note_on(60, 1.0); for (let i = 0; i < 40; i++) p.process_ptr(Q); return p; });
  for (let r = 0; r < REPS; r++) {
    for (let k = 0; k < 2; k++) {
      const c = cpu();
      for (let i = 0; i < QUANTA; i++) polys[k].process_ptr(Q);
      best[k] = Math.min(best[k], (cpu() - c) / Number(secs));
    }
  }
  polys.forEach((p) => p.free());
  sa += best[0]; sb += best[1];
  console.log(`${t.name.slice(0, 22).padEnd(22)} ${best[0].toFixed(2).padStart(8)} ${best[1].toFixed(2).padStart(8)} ${(best[1] / best[0]).toFixed(3).padStart(7)}`);
}
console.log(`${"all kinds".padEnd(22)} ${sa.toFixed(1).padStart(8)} ${sb.toFixed(1).padStart(8)} ${(sb / sa).toFixed(3).padStart(7)}`);
console.log(`load ${os.loadavg()[0].toFixed(0)}, after`);
