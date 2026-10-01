// pick_belief.rs's loop against the built wasm, the browser's speed class:
// the package `make wasm` writes to apps/web/pkg, run by node, whose V8 is
// the engine Chrome runs. The same seed, the same coin and the same columns,
// so the two print comparable tables.
//
//   make wasm
//   node crates/auracle-wasm/examples/pick_belief.mjs [picks] [breed]
//
// `picks` defaults to 30. `breed` = 1 then opens a generation, walks all but
// its last job here (`farm_walk`, one at a time: a minute or two) so it stays
// open with the pool over size, and times ten more picks. The boot fills the
// pool here too, one render at a time (about 10 s).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const pkg = fileURLToPath(new URL("../../../apps/web/pkg/", import.meta.url));
const picks = Number(process.argv[2] || 30);
const breed = Number(process.argv[3] || 0) !== 0;
const mod = await import(`${pkg}auracle_wasm.js`);
mod.initSync({ module: readFileSync(`${pkg}auracle_wasm_bg.wasm`) });
const { WasmEngine, farm_walk } = mod;

// `shipped::boot`: the seed and pool PERFORM's wirings are measured under.
const t0 = performance.now();
const e = new WasmEngine(20260928n, 40);
while (e.fill_step(4) > 0) {}
e.restandardize_if_untaught();
console.error(`booted a pool of ${JSON.parse(e.status()).pool} in ${((performance.now() - t0) / 1e3).toFixed(1)} s`);

// The example's coin (xorshift64*), so the picks match the native run's.
let s = 0x9e3779b97f4a7c15n;
const M = (1n << 64n) - 1n;
const unit = () => {
  s ^= s >> 12n;
  s ^= (s << 25n) & M;
  s ^= s >> 27n;
  return Number(((s * 0x2545f4914f6cdd1dn) & M) >> 11n) / 2 ** 53;
};
const ms = (f) => {
  const t = performance.now();
  const n = f();
  return [performance.now() - t, n];
};
const lenses = () => (JSON.parse(e.styles()) || []).length;
const median = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
const pad = (x, w, d = 2) => x.toFixed(d).padStart(w);

const byK = new Map();
const fits = new Map();
const file = (m, k, v) => (m.has(k) ? m.get(k).push(v) : m.set(k, [v]));
console.log("pick  K  ess   record  belief  ranked    map  styles   (ms; bytes: belief, ranked, map)");
for (let pick = 1; pick <= picks; pick++) {
  const [a, b] = JSON.parse(e.next_duel());
  const p = e.duel_pred(a, b);
  const choseA = p >= 0 ? unit() < p : (a * 7 + b) % 3 !== 0;
  const [rec] = ms(() => e.record_duel(a, b, choseA));
  const [bl, blb] = ms(() => e.belief().length);
  const [rk, rkb] = ms(() => e.ranked().length);
  const [mp, mpb] = ms(() => e.taste_map().length);
  const [st] = ms(() => e.styles().length);
  const ess = JSON.parse(e.status()).ess;
  const k = lenses();
  console.log(`${String(pick).padStart(4)} ${String(k).padStart(2)} ${pad(ess, 4, 0)}  ${pad(rec, 6)}  ${pad(bl, 6)}  ${pad(rk, 6)}  ${pad(mp, 5)}  ${pad(st, 6)}   ${blb} ${rkb} ${mpb}`);
  if (k > 0) file(byK, k, [rec, bl, rk, mp, st]);
  if (pick % 6 === 0) {
    const [fit] = ms(() => (e.fit(), 0));
    file(fits, lenses(), fit); // under the K it fitted
    console.log(`      refit ${fit.toFixed(0)} ms (K ${lenses()})`);
  }
}
console.log("\nmedians (ms)\n  K  picks  record  belief  ranked    map  styles   refit");
for (const [k, rows] of byK) {
  const [rec, bl, rk, mp, st] = [0, 1, 2, 3, 4].map((i) => median(rows.map((r) => r[i])));
  const fit = fits.has(k) ? median(fits.get(k)) : NaN;
  console.log(`  ${k}  ${String(rows.length).padStart(5)}  ${pad(rec, 6)}  ${pad(bl, 6)}  ${pad(rk, 6)}  ${pad(mp, 5, 1)}  ${pad(st, 6)}  ${pad(fit, 6, 0)}`);
}

if (breed) {
  const t1 = performance.now();
  const reply = JSON.parse(e.refine_jobs());
  const context = JSON.stringify(reply.context);
  const results = reply.jobs.slice(0, -1).map((job) => farm_walk(context, JSON.stringify(job)));
  for (const r of results) e.refine_absorb(r);
  const retiring = JSON.parse(e.refine_retiring());
  const st = JSON.parse(e.status());
  console.error(`bred ${results.length} of ${reply.jobs.length} walks in ${((performance.now() - t1) / 1e3).toFixed(0)} s: pool ${st.pool} of ${st.pool_target}, ${retiring.length} retiring`);
  const bls = [];
  const rks = [];
  for (let i = 0; i < 10; i++) {
    const [a, b] = JSON.parse(e.next_duel());
    e.record_duel(a, b, unit() < e.duel_pred(a, b));
    bls.push(ms(() => e.belief().length)[0]);
    rks.push(ms(() => e.ranked().length)[0]);
  }
  console.log(`\nmid-generation, ${retiring.length} retiring (ms): belief ${pad(median(bls), 0)}  ranked ${pad(median(rks), 0)}`);
  e.refine_finish();
}
