// What a face costs in wasm, the browser's speed class: the built package
// under node (V8, the engine Chrome runs). Its native twin is
// auracle-features/examples/face_cost.rs.
//
//   make wasm
//   node crates/auracle-wasm/examples/face_cost.mjs [pkg-dir] [n]
//
// A face is taken inside every featurization, so what it costs is the
// difference between featurizing with it and without it. Give a second
// package built from before faces (`pkg-dir`) and run this on both: the same
// seeded pool is featurized by `farm_render` (render, vet, φ, and in a build
// with faces the face), one tree at a time, and the medians are printed.
// With faces it also times `face_of` taking a face from a resident audition
// (the analysis alone: 40 bands × 12 slices) and from the memo.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const pkg = process.argv[2] || fileURLToPath(new URL("../../../apps/web/pkg/", import.meta.url));
const n = Number(process.argv[3] || 24);
const mod = await import(`${pkg.replace(/\/?$/, "/")}auracle_wasm.js`);
mod.initSync({ module: readFileSync(`${pkg.replace(/\/?$/, "/")}auracle_wasm_bg.wasm`) });
const { WasmEngine, farm_render } = mod;

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const e = new WasmEngine(20260928n, n);
while (e.fill_step(4) > 0) {}
const ids = JSON.parse(e.ranked()).map((r) => r.id);
const phrase = e.phrase_json();
const trees = ids.map((id) => e.tree_json_of(id));

farm_render(trees[0], phrase, false); // warm the planner
const feat = [];
for (const t of trees) {
  const t0 = performance.now();
  const job = farm_render(t, phrase, false);
  feat.push(performance.now() - t0);
  job.free?.();
}
console.log(`${pkg}`);
console.log(`featurize (farm_render), ${trees.length} trees: median ${median(feat).toFixed(1)} ms`);

if (typeof e.face_of === "function") {
  // From the memo: what the worker pays for a face it has not copied out yet.
  const memo = ids.map((id) => {
    const t0 = performance.now();
    e.face_of(id, false);
    return performance.now() - t0;
  });
  // The analysis alone: a resident audition with no face on its row. Rows of
  // this build always carry one, so the row's face is taken off first by
  // re-absorbing it without (`memo_absorb` of the row minus its face).
  const analysis = [];
  for (const [i, id] of ids.entries()) {
    const job = farm_render(trees[i], phrase, false);
    const row = JSON.parse(job.cached);
    delete row.face;
    e.memo_absorb(trees[i], JSON.stringify(row));
    e.render_of(id); // the audition, resident
    const t0 = performance.now();
    const b = e.face_of(id, false);
    analysis.push(performance.now() - t0);
    if (b.length !== 532) throw new Error(`no face for ${id}`);
  }
  console.log(`face from the memo:            median ${median(memo).toFixed(3)} ms`);
  console.log(`face from an audition (analysis): median ${median(analysis).toFixed(2)} ms, max ${Math.max(...analysis).toFixed(2)} ms`);
}
