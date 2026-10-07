// What PERFORM's measurement of a sound costs in wasm (#290): the renders
// `perform_wire` makes on a pool sound, round by round, and what each costs,
// in the built package `make wasm` writes to apps/web/pkg, run by node, whose
// V8 is the engine Chrome runs. Single threaded, as the engine worker is.
//
//   make wasm
//   node crates/auracle-wasm/examples/wire_cost.mjs [sounds=12] [seed=20260928]
//
// Boots a pool of 40 (the app's) on `seed`, standardizes it untaught (as the
// app is before a pick), then measures `sounds` of its members spread over
// their continuous-knob counts, the way the worker does (`measure` in
// worker.js): `perform_wire_plan` for the round owed, one `memo_render` per
// tree in it, until the plan is empty, then `perform_wire_known`. The pool's
// own renders are in the memo (the fill made them), so the patch itself
// costs nothing, as in the app.
//
// Prints per sound its live knobs, the renders of each round (the Jacobian's
// nudges, the verification's four points per reachable control, the retries
// at half travel), the CPU time of the renders and of the arithmetic (the
// plans and the finish), and what a compile of the tree alone costs
// (`perform_knobs`), and what the first wiring costs (#290: `perform_first`,
// a compile and the knob table's prediction, which the worker pays with every
// tree it sends to the voices), with the shipped table handed over as the
// worker hands it (`perform_table_set`). CPU time
// is the process's (`process.cpuUsage`), so a loaded machine slows the wall
// clock and not the figure; both are printed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { cpus, loadavg } from "node:os";

const pkg = fileURLToPath(new URL("../../../apps/web/pkg/", import.meta.url));
const args = process.argv.slice(2);
const want = Math.max(1, Number(args[0] || 12));
const seed = BigInt(args[1] || 20260928);
const mod = await import(`${pkg}auracle_wasm.js`);
mod.initSync({ module: readFileSync(`${pkg}auracle_wasm_bg.wasm`) });
const { WasmEngine } = mod;

const cpuMs = () => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1e3;
};
// [result, wall ms, CPU ms] of one call.
const timed = (f) => {
  const w = performance.now();
  const c = cpuMs();
  const out = f();
  return [out, performance.now() - w, cpuMs() - c];
};

const say = (s) => console.error(s);
say(`${cpus().length} × ${cpus()[0]?.model}; load ${loadavg().map((x) => x.toFixed(0)).join(" ")}`);
const [, bootWall, bootCpu] = timed(() => {
  globalThis.e = new WasmEngine(seed, 40);
  while (globalThis.e.fill_step(4) > 0) {}
  globalThis.e.restandardize_if_untaught();
});
const e = globalThis.e;
const table = typeof e.perform_table_set === "function" && e.perform_table_set(readFileSync(fileURLToPath(new URL("../../../apps/web/perform-wirings.json", import.meta.url)), "utf8"));
say(`knob table: ${table ? "handed over" : "none (an engine before #290)"}`);
say(`pool of 40 filled and standardized: ${(bootWall / 1e3).toFixed(1)} s wall, ${(bootCpu / 1e3).toFixed(1)} s CPU`);

const misses = () => JSON.parse(e.memo_stats()).misses;
const pool = JSON.parse(e.pool_features()).rows.map((r) => r.id);
const sounds = pool
  .map((id) => {
    const tree = e.tree_json_of(id);
    const [knobs, , compileCpu] = timed(() => JSON.parse(e.perform_knobs(tree)).length);
    const [first, , firstCpu] = table ? timed(() => JSON.parse(e.perform_first(tree))) : [null, 0, NaN];
    const guessed = first && first.predicted ? first.predicted.wiring.filter((w) => !w.search).length : null;
    return { id, tree, knobs, compileCpu, firstCpu, guessed };
  })
  .sort((a, b) => a.knobs - b.knobs);
// Spread over the knob counts: every k-th by count, the largest included.
const pick = [];
for (let i = 0; i < want; i++) pick.push(sounds[Math.round((i * (sounds.length - 1)) / Math.max(1, want - 1))]);
const chosen = [...new Set(pick)];

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.round((xs.length - 1) * p)];

console.log("sound  knobs  renders [jacobian verify retry] = all   render CPU ms (mean/render)   plan+finish CPU ms   compile CPU ms   first CPU ms   wired (predicted)");
const all = { renders: [], perRender: [], arith: [], compile: [], total: [], jac: [], first: [] };
for (const s of chosen) {
  const failed = [];
  const rounds = [];
  let renderCpu = 0;
  let jacCpu = 0;
  let arithCpu = 0;
  const per = [];
  for (let round = 0; round < 6; round++) {
    const [need, , pc] = timed(() => JSON.parse(e.perform_wire_plan(s.tree, "[]", JSON.stringify(failed))));
    arithCpu += pc;
    if (!need.length) break;
    rounds.push(need.length);
    for (const job of need) {
      const m = misses();
      const [ok, , rc] = timed(() => e.memo_render(job.tree));
      if (!ok) failed.push(job.key);
      if (misses() > m) per.push(rc);
      renderCpu += rc;
      if (round === 0) jacCpu += rc;
    }
  }
  const [data, , fc] = timed(() => JSON.parse(e.perform_wire_known(s.tree, "[]", JSON.stringify(failed))));
  arithCpu += fc;
  const r = rounds.reduce((a, b) => a + b, 0);
  const wired = data ? data.wiring.filter((w) => !w.search).length : 0;
  const cells = [0, 1, 2].map((i) => String(rounds[i] || 0).padStart(3)).join(" ");
  console.log(
    `${String(s.id).padStart(5)}  ${String(s.knobs).padStart(5)}  [${cells}] = ${String(r).padStart(3)}   ${renderCpu.toFixed(0).padStart(7)} (${mean(per).toFixed(0).padStart(4)})` +
      `              ${arithCpu.toFixed(1).padStart(7)}            ${s.compileCpu.toFixed(1).padStart(6)}   ${s.firstCpu.toFixed(1).padStart(10)}       ${wired} of 6 (${s.guessed ?? "-"})`,
  );
  all.renders.push(r);
  all.perRender.push(...per);
  all.arith.push(arithCpu);
  all.compile.push(s.compileCpu);
  all.total.push(renderCpu + arithCpu);
  all.jac.push(jacCpu);
  if (Number.isFinite(s.firstCpu)) all.first.push(s.firstCpu);
}
console.log("");
console.log(`renders per measurement: mean ${mean(all.renders).toFixed(1)}, p50 ${pct(all.renders, 0.5)}, max ${pct(all.renders, 1)}`);
console.log(`one render: mean ${mean(all.perRender).toFixed(0)} ms CPU, p50 ${pct(all.perRender, 0.5).toFixed(0)}, p90 ${pct(all.perRender, 0.9).toFixed(0)}, max ${pct(all.perRender, 1).toFixed(0)}`);
console.log(`a measurement: mean ${(mean(all.total) / 1e3).toFixed(1)} s CPU, p50 ${(pct(all.total, 0.5) / 1e3).toFixed(1)}, max ${(pct(all.total, 1) / 1e3).toFixed(1)}; its Jacobian round alone: mean ${(mean(all.jac) / 1e3).toFixed(1)} s`);
console.log(`the arithmetic (plans and finish): mean ${mean(all.arith).toFixed(1)} ms CPU; a compile for the knobs: mean ${mean(all.compile).toFixed(1)} ms, max ${pct(all.compile, 1).toFixed(1)}`);
if (all.first.length) console.log(`the first wiring (perform_first): mean ${mean(all.first).toFixed(1)} ms CPU, max ${pct(all.first, 1).toFixed(1)}`);
say(`load ${loadavg().map((x) => x.toFixed(0)).join(" ")}`);
