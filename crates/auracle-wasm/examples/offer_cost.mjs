// What a PERFORM offer costs in the browser's speed class, and how long the
// worker is deaf while it grows: the built package `make wasm` writes to
// apps/web/pkg, run by node, whose V8 is the engine Chrome runs. Single
// threaded, as the engine worker is. `crates/auracle-session/examples/
// offer_cost.rs` is the native side.
//
//   make wasm
//   node crates/auracle-wasm/examples/offer_cost.mjs [stride=5] [offers=3] [steps=20] [--chunked[=N]]
//
// Boots a pool of 40, teaches a few picks and fits, then on every `stride`-th
// preset asks for `offers` of each kind: the Offer button's walk, a search
// control's aimed walk (Grit, up), and Wander's drift. Prints wall time and
// the renders it cost (`memo_stats` misses), and one render's own time.
//
// With `--chunked` the offer is asked the way the worker asks it (a begin, then
// `perform_job_step` of N steps until done, 1 by default, then
// `perform_job_finish`) and the longest single call is printed as well: that
// is how long a pick would wait.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const pkg = fileURLToPath(new URL("../../../apps/web/pkg/", import.meta.url));
const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const stride = Math.max(1, Number(args[0] || 5));
const offers = Math.max(1, Number(args[1] || 3));
const steps = Number(args[2] || 20);
const chunk = flags.map((f) => /^--chunked(?:=(\d+))?$/.exec(f)).find(Boolean);
const chunkN = chunk ? Number(chunk[1] || 1) : 0;
const mod = await import(`${pkg}auracle_wasm.js`);
mod.initSync({ module: readFileSync(`${pkg}auracle_wasm_bg.wasm`) });
const { WasmEngine } = mod;

const t0 = performance.now();
const e = new WasmEngine(20260928n, 40);
while (e.fill_step(4) > 0) {}
e.restandardize_if_untaught();
for (let r = 0; r < 3; r++) {
  for (let i = 0; i < 5; i++) {
    const d = JSON.parse(e.next_duel());
    if (d) e.record_duel(d[0], d[1], (i + r) % 2 === 0);
  }
  e.fit();
}
console.error(`booted and taught in ${((performance.now() - t0) / 1e3).toFixed(1)} s; has_posterior ${JSON.parse(e.status()).has_posterior}`);

const misses = () => JSON.parse(e.memo_stats()).misses;
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.round((xs.length - 1) * p)];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Ask for an offer; returns [total ms, longest single call ms, reply].
function offer(tree, control, sign) {
  const t = performance.now();
  if (!chunkN) {
    const reply = e.perform_offer(tree, "[]", "[]", steps, control, sign);
    const ms = performance.now() - t;
    return [ms, ms, reply];
  }
  let c = performance.now();
  const job = JSON.parse(e.perform_offer_begin(tree, "[]", "[]", steps, control, sign)).job;
  let longest = performance.now() - c;
  if (job == null) return [performance.now() - t, longest, null];
  for (;;) {
    c = performance.now();
    const more = e.perform_job_step(job, chunkN);
    longest = Math.max(longest, performance.now() - c);
    if (!more) break;
  }
  c = performance.now();
  const reply = e.perform_job_finish(job);
  longest = Math.max(longest, performance.now() - c);
  return [performance.now() - t, longest, reply];
}

const presets = JSON.parse(e.preset_list());
const rows = { offer: [], toward: [], drift: [] };
const longest = { offer: [], toward: [] };
const renders = { offer: [], toward: [], drift: [] };
console.log("preset              offer ms [renders]   toward ms [renders]   drift ms [renders]");
for (let i = 0; i < presets.length; i += stride) {
  const id = e.load_preset(i);
  if (!id) continue;
  const tree = e.tree_json_of(id);
  e.memo_render(tree);
  const cells = { offer: [], toward: [], drift: [] };
  for (let k = 0; k < offers; k++) {
    for (const kind of ["offer", "toward", "drift"]) {
      const m = misses();
      let ms, long;
      if (kind === "drift") {
        const t = performance.now();
        e.perform_drift(tree, "[]", "[]", 12, 0.05);
        ms = performance.now() - t;
      } else {
        [ms, long] = offer(tree, kind === "toward" ? 3 : undefined, kind === "toward" ? 1 : undefined);
        longest[kind].push(long);
      }
      const r = misses() - m;
      rows[kind].push(ms);
      renders[kind].push(r);
      cells[kind].push([ms, r]);
    }
  }
  const med = (kind) => {
    const c = cells[kind].sort((a, b) => a[0] - b[0])[Math.floor(cells[kind].length / 2)];
    return `${c[0].toFixed(0).padStart(6)} [${String(c[1]).padStart(3)}]`;
  };
  console.log(`${presets[i].name.padEnd(18)} ${med("offer")}   ${med("toward")}   ${med("drift")}`);
}
console.log("");
for (const kind of ["offer", "toward", "drift"]) {
  const xs = rows[kind];
  const r = mean(renders[kind]);
  console.log(
    `${kind.padEnd(7)} n=${String(xs.length).padEnd(3)} mean ${mean(xs).toFixed(0).padStart(6)} ms  p50 ${pct(xs, 0.5).toFixed(0).padStart(6)}  p90 ${pct(xs, 0.9).toFixed(0).padStart(6)}  max ${pct(xs, 1).toFixed(0).padStart(6)}  renders ${r.toFixed(1)}  ms/render ${(mean(xs) / Math.max(r, 1)).toFixed(0)}` +
      (longest[kind]?.length ? `  | longest single call: p50 ${pct(longest[kind], 0.5).toFixed(0)} ms, max ${pct(longest[kind], 1).toFixed(0)} ms` : ""),
  );
}
