// What the model's guess costs in the browser's speed class (Plan-005 task
// 9d): the native `guess_cost` example's session and patches, through the
// bindings the worker calls (`guess_plan`, `memo_render`, `guess_rank`), in
// this thread's CPU time. Run by node, whose V8 is the engine Chrome runs;
// single-threaded, as the engine worker is.
//
// The app's pool of 40 from `shipped::boot`'s seed, then each warm start as
// the worker runs it (`warm_start`: the three picks pinned, each beating the
// other six), with the three the native run picked by centroid; then for each
// patch on the bench, the guess the worker makes with no farm (the first 8,
// `GUESS_FLOOR`) and the rest of the output's candidates, as a crew would
// render them. The engine's memo is shared across patches here; their
// candidates are not.
//
//   make wasm
//   node crates/auracle-wasm/examples/guess_cost.mjs
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
const quart = (xs, f) => [...xs].sort((x, y) => x - y)[Math.floor((xs.length - 1) * f)];

const GUESS_FLOOR = 8;
const NINE = ["First Bass", "Folded Lead", "Pluck", "Cathedral", "Noise Wash", "Flint", "Two Minds", "Bell Jar", "Glass Pad"];
const PICKS = {
  darkest: ["First Bass", "Cathedral", "Noise Wash"],
  brightest: ["Flint", "Folded Lead", "Bell Jar"],
};
const PATCHES = ["Sub & Sparkle", "Hornet", "Tine", "Detune Dream", "Dub Echo", "Deadfall", "Ceiling"];

const all = [];
for (const [label, picked] of Object.entries(PICKS)) {
  const e = new mod.WasmEngine(20260928n, 40);
  while (e.fill_step(4) > 0) {}
  e.restandardize_if_untaught();
  const list = JSON.parse(e.preset_list());
  const index = (name) => list.find((p) => p.name === name).index;
  const ids = {};
  for (const n of picked) {
    const id = Number(e.load_preset(index(n)));
    e.set_pinned(id, true);
    ids[n] = id;
  }
  for (const n of NINE.filter((n) => !picked.includes(n))) {
    const id = Number(e.load_preset(index(n)));
    for (const p of picked) e.record_duel(ids[p], id, true);
  }
  e.fit();
  console.log(`\n== warm start: the three ${label} (${picked.join(", ")})`);
  console.log("patch                       floor: renders  CPU s   all: renders  CPU s   plan+rank ms  median render ms  first guess");

  // Plan and render until nothing is owed; returns [renders, CPU ms each, plan ms].
  const run = (limit, failed) => {
    const per = [];
    let planMs = 0;
    for (;;) {
      let c = cpuNow();
      const plan = JSON.parse(e.guess_plan(undefined, JSON.stringify(failed), limit));
      planMs += cpuNow() - c;
      if (plan.reason) throw new Error(plan.reason);
      if (!plan.jobs.length) break;
      for (const job of plan.jobs) {
        c = cpuNow();
        if (!e.memo_render(job.tree)) failed.push(job.key);
        per.push(cpuNow() - c);
      }
    }
    return [per, planMs];
  };
  const patches = PATCHES.map((n) => [n, n, false]).concat([
    ["Detune Dream, cleared", "Detune Dream", true],
    ["Sub & Sparkle, cleared", "Sub & Sparkle", true],
  ]);
  for (const [name, preset, clear] of patches) {
    const id = Number(e.load_preset(index(preset)));
    if (!e.edit_begin(id)) throw new Error(`no bench for ${name}`);
    if (clear) {
      const t = JSON.parse(e.edit_tree_json());
      t.root = { Silence: {} };
      const err = e.edit_set_tree_apply(JSON.stringify(t));
      if (err !== "") throw new Error(err);
    }
    const failed = [];
    const [floorPer, p1] = run(GUESS_FLOOR, failed);
    let c = cpuNow();
    const floor = JSON.parse(e.guess_rank(undefined, JSON.stringify(failed), GUESS_FLOOR));
    const r1 = cpuNow() - c;
    const [restPer, p2] = run(0, failed);
    c = cpuNow();
    const full = JSON.parse(e.guess_rank(undefined, JSON.stringify(failed), 0));
    const r2 = cpuNow() - c;
    const per = floorPer.concat(restPer);
    all.push(...per);
    const sum = (xs) => xs.reduce((s, x) => s + x, 0);
    const g = floor.guesses[0];
    const same = full.guesses[0] && g && JSON.stringify(full.guesses[0].op) === JSON.stringify(g.op);
    console.log(
      `${name.padEnd(27)} ${String(floorPer.length).padStart(15)} ${(sum(floorPer) / 1e3).toFixed(2).padStart(7)} ` +
        `${String(per.length).padStart(14)} ${(sum(per) / 1e3).toFixed(2).padStart(6)} ` +
        `${(p1 + p2 + r1 + r2).toFixed(1).padStart(14)} ${median(per).toFixed(0).padStart(17)}  ` +
        `${g ? `${g.kind} at ${g.socket} (${Math.round(g.p * 100)}%)` : "none"}${same ? "" : " · all's first differs"}`,
    );
  }
  e.free();
}
console.log(
  `\none render in wasm: median ${median(all).toFixed(0)} CPU ms (quartiles ${quart(all, 0.25).toFixed(0)}–${quart(all, 0.75).toFixed(0)}) over ${all.length}`,
);
