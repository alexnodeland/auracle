// What one rendered module suggestion costs in the browser's speed class:
// the b-out candidates `suggest_census` lists (each patch, and every edit at
// its output, in its empty sockets and in its root's mod slot), each rendered
// by `preview_op` on the bench, as PATCH's pre-placement audition renders a
// placement. `preview_op` renders the whole phrase on a clone (the same
// `featurize_memo` the census times natively), so its time is one candidate's
// render. Run by node, whose V8 is the engine Chrome runs; single-threaded,
// as the engine worker is.
//
//   make wasm
//   cargo run --release -p auracle-session --example suggest_census -- --ops /tmp/ops.json
//   node crates/auracle-wasm/examples/suggest_cost.mjs /tmp/ops.json
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const pkg = fileURLToPath(new URL("../../../apps/web/pkg/", import.meta.url));
const path = process.argv[2];
if (!path) {
  console.error("usage: node suggest_cost.mjs OPS.json (written by suggest_census --ops)");
  process.exit(2);
}
const entries = JSON.parse(readFileSync(path, "utf8"));
const mod = await import(`${pkg}auracle_wasm.js`);
mod.initSync({ module: readFileSync(`${pkg}auracle_wasm_bg.wasm`) });
const { WasmEngine } = mod;

// `shipped::boot`'s seed and pool: an insert needs the standardizer a filled
// pool fits.
const e = new WasmEngine(20260928n, 40);
while (e.fill_step(4) > 0) {}
e.restandardize_if_untaught();
// A bench to hold each patch: any preset opens it, then the patch replaces
// its tree without a render (`edit_set_tree_apply`), which is also how an
// empty patch, which does not vet, gets onto the bench.
const first = Number(e.load_preset(0));
if (!e.edit_begin(first)) throw new Error("no bench");

// CPU time of this thread, which a busy machine does not inflate the way it
// inflates the wall clock (`process.threadCpuUsage`, node 23.9 and later;
// the whole process's otherwise).
const cpuNow = () => {
  const u = process.threadCpuUsage ? process.threadCpuUsage() : process.cpuUsage();
  return (u.user + u.system) / 1e3;
};
const median = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
const quart = (xs, f) => [...xs].sort((x, y) => x - y)[Math.floor((xs.length - 1) * f)];
const all = [];
let wallAll = 0;
console.log("patch                       edits   median CPU ms   total CPU s   silent");
for (const { name, tree, ops } of entries) {
  const err = e.edit_set_tree_apply(JSON.stringify(tree));
  if (err !== "") {
    console.log(`${name}: refused (${err})`);
    continue;
  }
  const times = [];
  let silent = 0;
  for (const op of ops) {
    const w = performance.now();
    const c = cpuNow();
    const pcm = e.preview_op(JSON.stringify(op), 2.0);
    times.push(cpuNow() - c);
    wallAll += performance.now() - w;
    if (pcm.length === 0) silent += 1;
  }
  all.push(...times);
  const total = times.reduce((s, x) => s + x, 0);
  console.log(
    `${name.padEnd(26)} ${String(ops.length).padStart(6)} ${median(times).toFixed(0).padStart(15)} ` +
      `${(total / 1e3).toFixed(2).padStart(13)} ${String(silent).padStart(8)}`,
  );
}
const cpuAll = all.reduce((s, x) => s + x, 0);
console.log(
  `\none render: median ${median(all).toFixed(0)} CPU ms (quartiles ${quart(all, 0.25).toFixed(0)}, ` +
    `${quart(all, 0.75).toFixed(0)}) over ${all.length}; wall over CPU ${(wallAll / cpuAll).toFixed(2)}`,
);
