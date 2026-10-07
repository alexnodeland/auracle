// What one phrase render costs in wasm: the render benchmark's wasm half
// (`make bench-render`), under node, whose V8 is the engine Chrome runs.
// Single-threaded, as a farm worker is.
//
//   make wasm
//   node crates/auracle-wasm/examples/bench_render.mjs [flags] [pkg …]
//
//   --reps=5     repeats of each tree; the least is reported
//   --rounds=1   with two packages, how many times each runs the set, in turn
//   --audio      ask for the audition too (`want_audio`), as the first few
//                patches of a fill do: the f32 buffer is copied out to JS
//   --set=PATH   the trees (default: auracle-features/examples/bench_render.json,
//                the native bench's set, so the two read the same trees)
//   --bank       every preset instead of the set
//   --digest     time nothing: hash each tree's reply (φ, the vet report, the face,
//                the onsets, as the farm posts them) and the set's, for each package,
//                so two builds can be shown to measure the same, bit for bit
//
// A package is a directory `make wasm` wrote (default: apps/web/pkg). With
// two, the first is "before" and the second "after": each round runs the set
// on one and then the other, in this one process, so both see the same load
// and the same warmed JIT, and each tree's figure on each side is its least
// over every round.
//
// A render here is `farm_render(tree, phrase, false)`, the farm worker's whole
// job: the tree's JSON parsed, then compile, render, vet, normalize, φ, the
// face, and the reply's JSON copied out. The native twin
// (`auracle-features/examples/bench_render.rs`) runs the same job without the
// JSON, and `--stages` there splits it.
//
// The cost is this thread's CPU time (`process.threadCpuUsage()`, node 23.9
// and later; on an older node the process's, which the header says), not the
// wall clock: a loaded machine stretches a render's wall time by however long
// the thread waited for a core. Wall time is printed beside it, the least of
// the repeats, and every table prints the load average it ran under.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const flags = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.slice(2).split("=");
      return [k, v ?? true];
    }),
);
const REPS = Number(flags.reps || 5);
const ROUNDS = Number(flags.rounds || 1);
const AUDIO = Boolean(flags.audio);
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const SET = flags.set || here("../../auracle-features/examples/bench_render.json");
const pkgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (pkgs.length === 0) pkgs.push(here("../../../apps/web/pkg/"));
if (pkgs.length > 2) throw new Error("one package, or two to compare");

const load = () => os.loadavg()[0].toFixed(0);
// This thread's CPU time where node has it (23.9 and later); before that the
// process's, which also counts V8's compiler and collector threads.
const THREAD = typeof process.threadCpuUsage === "function";
const cpu = () => {
  const u = THREAD ? process.threadCpuUsage() : process.cpuUsage();
  return (u.user + u.system) / 1e3;
};

async function open(dir) {
  const abs = path.resolve(dir);
  const mod = await import(pathToFileURL(path.join(abs, "auracle_wasm.js")).href);
  mod.initSync({ module: readFileSync(path.join(abs, "auracle_wasm_bg.wasm")) });
  let build = "unstamped";
  try {
    const b = JSON.parse(readFileSync(path.join(abs, "build.json"), "utf8"));
    build = `${b.profile} ${String(b.source || "").slice(0, 12)}`;
  } catch {
    // An unstamped package still runs.
  }
  const engine = new mod.WasmEngine(1n, 1);
  const phrase = engine.phrase_json();
  engine.free();
  return { mod, phrase, dir: abs, build };
}

const sides = [];
for (const dir of pkgs) sides.push(await open(dir));
// The bank, as the engine lists it (`preset_list`, `preset_tree_json`).
function bank(side) {
  const e = new side.mod.WasmEngine(1n, 1);
  const rows = JSON.parse(e.preset_list()).map((p) => ({ name: p.name, json: e.preset_tree_json(p.index) }));
  e.free();
  return rows;
}
const set = flags.bank
  ? bank(sides[0])
  : JSON.parse(readFileSync(SET, "utf8")).trees.map((t) => ({
      name: t.name,
      json: JSON.stringify(t.tree),
    }));

if (flags.digest) {
  // FNV-1a, 64-bit, over each reply's text.
  const fnv = (h, text) => {
    for (const b of Buffer.from(text, "utf8")) {
      h ^= BigInt(b);
      h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return h;
  };
  for (const side of sides) {
    let all = 0xcbf29ce484222325n;
    for (const tree of set) {
      const job = side.mod.farm_render(tree.json, side.phrase, false);
      const h = fnv(0xcbf29ce484222325n, job.ok ? job.cached : "refused");
      job.free();
      all = fnv(all, h.toString(16));
      console.log(`${h.toString(16).padStart(16, "0")}  ${tree.name}`);
    }
    console.log(`${all.toString(16).padStart(16, "0")}  the set, on ${side.dir} (${side.build})`);
  }
  process.exit(0);
}

// One render of `tree` on `side`: [CPU ms, wall ms].
function once(side, tree) {
  const w = performance.now();
  const c = cpu();
  const job = side.mod.farm_render(tree.json, side.phrase, AUDIO);
  if (AUDIO) job.samples; // copy the audition out, as the farm posts it
  const ms = [cpu() - c, performance.now() - w];
  const ok = job.ok;
  job.free();
  if (!ok) throw new Error(`${tree.name} was refused on ${side.dir}`);
  return ms;
}

const best = sides.map(() => set.map(() => [Infinity, Infinity]));
console.log(
  `bench_render (wasm, node ${process.version}): ${set.length} trees, least of ${REPS}` +
    `${sides.length > 1 ? ` over ${ROUNDS} rounds each` : ""}, ${THREAD ? "this thread's" : "the process's"} CPU ms` +
    `${AUDIO ? ", with the audition copied out" : ""}`,
);
sides.forEach((s, i) => console.log(`${sides.length > 1 ? ["before", "after"][i] : "package"}: ${s.dir} (${s.build})`));
console.log(`load average ${load()} on ${os.cpus().length} cores, before`);
for (let r = 0; r < (sides.length > 1 ? ROUNDS : 1); r++) {
  sides.forEach((side, si) => {
    let total = 0;
    set.forEach((tree, ti) => {
      for (let k = 0; k < REPS; k++) {
        const [c, w] = once(side, tree);
        best[si][ti][0] = Math.min(best[si][ti][0], c);
        best[si][ti][1] = Math.min(best[si][ti][1], w);
      }
      total += best[si][ti][0];
    });
    if (sides.length > 1) console.log(`round ${r + 1} ${["before", "after"][si]}: load ${load()}`);
  });
}

const f = (x) => x.toFixed(1).padStart(9);
if (sides.length === 1) {
  console.log(`${"tree".padEnd(20)} ${"cpu ms".padStart(9)} ${"wall ms".padStart(9)}`);
  set.forEach((t, i) => console.log(`${t.name.padEnd(20)} ${f(best[0][i][0])} ${f(best[0][i][1])}`));
  const ms = best[0].map((b) => b[0]);
  const sorted = [...ms].sort((a, b) => a - b);
  const total = ms.reduce((a, b) => a + b, 0);
  console.log(
    `set: ${ms.length} renders, ${total.toFixed(0)} ms in all, mean ${(total / ms.length).toFixed(1)}, ` +
      `median ${sorted[Math.floor(ms.length / 2)].toFixed(1)}, least ${sorted[0].toFixed(1)}, ` +
      `most ${sorted[ms.length - 1].toFixed(1)} ms per render`,
  );
} else {
  console.log(`${"tree".padEnd(20)} ${"before".padStart(9)} ${"after".padStart(9)} ${"after/before".padStart(13)}`);
  let tb = 0;
  let ta = 0;
  set.forEach((t, i) => {
    const [b, a] = [best[0][i][0], best[1][i][0]];
    tb += b;
    ta += a;
    console.log(`${t.name.padEnd(20)} ${f(b)} ${f(a)} ${(a / b).toFixed(3).padStart(13)}`);
  });
  console.log(`${"set".padEnd(20)} ${f(tb)} ${f(ta)} ${(ta / tb).toFixed(3).padStart(13)}`);
}
console.log(`load average ${load()}, after`);
