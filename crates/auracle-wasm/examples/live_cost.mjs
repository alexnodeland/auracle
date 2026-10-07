// What the live voice costs the audio thread, in wasm: `LivePoly`, the
// instrument the AudioWorklet runs (apps/web/live-audio.js), timed per
// 128-frame render quantum under node, whose V8 is the engine Chrome runs.
// One thread, as the worklet is. The quantum's real-time budget is
// 128 / rate: 2.67 ms at 48 kHz, 2.90 ms at 44.1 kHz.
//
//   make wasm
//   node crates/auracle-wasm/examples/live_cost.mjs [flags]
//
//   --rate=48000      the context's sample rate
//   --reps=3          repeats of every row (the least and the median are printed)
//   --quanta=1000     quanta per steady-state row (2.7 s at 48 kHz)
//   --sweep-reps=2    repeats of every preset in the all-presets sweep
//   --slowdown=4.5    the CPU the headroom is worked out for: this many times slower
//                     than the one measuring (an Intel MacBook Air against an M-series)
//   --target=0.5      the share of a quantum the voices may take there, the rest being
//                     the page's, the browser's and the other threads' on the same core
//   --list            print every preset of the sweep, cheapest first
//   --gate=0.59       with --sweep-only: exit 1 if any preset's four voices cost more than this
//                     many ms of CPU a quantum (the least of the sweep's repeats), naming them.
//                     0.59 ms is a whole 48 kHz quantum on a CPU 4.5x slower than the M3 Max
//                     these figures were taken on; 11 of the 62 presets (the ladders) are over it.
//                     While an offer in B is heard (BLEND off home, PEEK held) the worklet renders
//                     eight voices, so the same number is then 0.30 for four (half of it: 50 of 62
//                     presets are over); at a mix of 0 B rests and costs nothing. The figures are
//                     this machine's: a CI runner measures 1.5-2x as much, so a runner's limit is
//                     its own baseline. Time is a budget, never an expect (ADR-022): run it where
//                     it is judged (the speed budgets job), not in the gate.
//   --seconds=4       length of a fast run
//   --pool=24         patches in the pool whose heaviest is measured (0: presets only)
//   --presets=a,b     preset names to measure besides the sweep's four landmarks
//   --native-text     use node's TextDecoder/TextEncoder (the worklet has neither,
//                     and live-audio.js polyfills them with a loop in JS)
//   --sweep-only      only the all-presets sweep
//
// The cost is CPU time, `process.threadCpuUsage()`, not wall time: a loaded
// machine stretches a quantum's wall time by whatever it was descheduled for,
// and does not stretch the CPU time the thread was on a core. Every table
// prints the load average it ran under. Wall time per quantum is kept only
// for its least, which load cannot lower, and the median; a maximum measured
// on a busy machine says what else was running and is labelled so. Where the
// CPU is an efficiency core of an M-series part the figure is that core's, and
// load decides which core a run lands on, so the least of the repeats is the
// number to read (a performance core, uncontended).
//
// What is measured, as the page and the worklet drive it:
//
// - **steady**: 1, 2, 3 and 4 voices held (the worklet builds `LivePoly(tree,
//   rate, 4)`, so four is the voice limit), then A and B both at four (an offer
//   in PERFORM's B slot is a second `LivePoly`, rendered every quantum while it
//   is heard), and A at four beside a B at rest (`rest`, what the worklet does
//   with B while its mix is 0), with each quantum going through the worklet's
//   own JS: `process_ptr` (or `rest`), the view, the copy out and `poll_event`.
// - **fast**: a run of notes, a new pitch every 1/rate second, each let go after
//   60% of the gap, so release tails keep every voice running and every press
//   past the fourth steals a voice. With **metering as the app does it**: a
//   key's `liveNoteOn` calls `setSignalFlow(true)`, which sends `meter`
//   on *every* press, and the worklet answers with `set_meter(true)` (every
//   tap re-subscribed), `meter_keys()` (serialized), a `JSON.parse`, a message
//   to the page, and every 8th quantum `Array.from` of the levels; and
//   `liveNoteOff` turns it off 400 ms after the last key. `--` rows say which.
// - **events**: the port handler's own work, which is render-thread time too:
//   `note_on`, `set_meter(true)` + `meter_keys`, constructing `LivePoly(tree,
//   rate, 4)` (the first patch, and a B slot loading), and a swap's rebuild,
//   one voice's compile per quantum.
import { readFileSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
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
const RATE = Number(flags.rate || 48_000);
const REPS = Number(flags.reps || 3);
const QUANTA = Number(flags.quanta || 1000);
const SWEEP_REPS = Number(flags["sweep-reps"] || 2);
const SLOWDOWN = Number(flags.slowdown || 4.5);
const TARGET = Number(flags.target || 0.5);
const SECONDS = Number(flags.seconds || 4);
const POOL = Number(flags.pool ?? 24);
const Q = 128;
const BUDGET_MS = (Q / RATE) * 1e3;

const pkg = fileURLToPath(new URL("../../../apps/web/pkg/", import.meta.url));

// The worklet's scope has no TextDecoder or TextEncoder; live-audio.js
// installs a hand-written pair before the glue runs. Install the same ones.
if (!flags["native-text"]) {
  const src = readFileSync(fileURLToPath(new URL("../../../apps/web/live-audio.js", import.meta.url)), "utf8");
  const m = src.match(/const POLYFILL = `([\s\S]*?)`;\n\nconst PROCESSOR/);
  if (!m) throw new Error("live-audio.js has no POLYFILL block to install");
  delete globalThis.TextDecoder;
  delete globalThis.TextEncoder;
  (0, eval)(m[1]);
}
const mod = await import(`${pkg}auracle_wasm.js`);
const wasm = mod.initSync({ module: readFileSync(`${pkg}auracle_wasm_bg.wasm`) });
const { LivePoly, WasmEngine } = mod;

const load = () => os.loadavg()[0].toFixed(0);
const cpu = () => {
  const u = process.threadCpuUsage();
  return (u.user + u.system) / 1e3;
};
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];
const median = (xs) => pct(xs, 0.5);
const f = (x, d = 3) => x.toFixed(d);

// The worklet's own work around one quantum (live-audio.js `process`): render,
// the cached view, the copy out to the two channels, the swap event poll.
const L = new Float32Array(Q);
const R = new Float32Array(Q);
function workletQuantum(poly, state, key) {
  const ptr = poly.process_ptr(Q);
  let view = state[key];
  if (!view || view.ptr !== ptr || view.buf !== wasm.memory.buffer) {
    view = state[key] = { ptr, buf: wasm.memory.buffer, v: new Float32Array(wasm.memory.buffer, ptr, Q * 2) };
  }
  return view.v;
}
function quantum(a, b, state) {
  const va = workletQuantum(a, state, "a");
  let vb = null;
  // B at a mix of 0 rests; heard, it renders.
  if (b && state.bRest) b.rest(Q);
  else if (b) vb = workletQuantum(b, state, "b");
  // (B's call can grow memory under A's view: both views are taken after both
  // calls, as the worklet does.)
  const v = state.a.buf === wasm.memory.buffer ? state.a.v : new Float32Array(wasm.memory.buffer, state.a.ptr, Q * 2);
  if (vb) {
    const w = state.b.v;
    for (let i = 0; i < Q; i++) {
      L[i] = v[2 * i] * 0.7 + w[2 * i] * 0.7;
      R[i] = v[2 * i + 1] * 0.7 + w[2 * i + 1] * 0.7;
    }
  } else {
    for (let i = 0; i < Q; i++) {
      L[i] = v[2 * i];
      R[i] = v[2 * i + 1];
    }
  }
  a.poll_event();
  if (b) b.poll_event();
}

const CHORD = [48, 55, 64, 72];
const RUN = [60, 62, 64, 67, 69, 72, 74, 76];

// ---- steady: n voices held, CPU time per quantum ---------------------------
// withB: false (A alone), "heard" (B renders) or "rest" (B at a mix of 0).
function steady(tree, n, withB) {
  const a = new LivePoly(tree, RATE, 4);
  const b = withB ? new LivePoly(tree, RATE, 4) : null;
  for (let i = 0; i < n; i++) {
    a.note_on(CHORD[i], 0.8);
    if (b) b.note_on(CHORD[i], 0.8);
  }
  const state = { bRest: withB === "rest" };
  for (let q = 0; q < 200; q++) quantum(a, b, state); // past the attack
  const walls = [];
  const c0 = cpu();
  for (let q = 0; q < QUANTA; q++) {
    const t = performance.now();
    quantum(a, b, state);
    walls.push(performance.now() - t);
  }
  const mean = (cpu() - c0) / QUANTA;
  a.free();
  b?.free();
  return { cpu: mean, wallMin: Math.min(...walls), wallP50: median(walls) };
}

function steadyRow(name, tree) {
  const rows = [];
  for (const [n, withB] of [[1, false], [2, false], [3, false], [4, false], [4, "heard"], [4, "rest"]]) {
    const reps = [];
    for (let r = 0; r < REPS; r++) reps.push(steady(tree, n, withB));
    const best = reps.reduce((x, y) => (y.cpu < x.cpu ? y : x));
    const med = median(reps.map((r) => r.cpu));
    rows.push({ n, withB, best, med });
  }
  return rows;
}

function printSteady(name, rows) {
  const cells = rows.map(({ n, withB, best }) => {
    const label = withB === "heard" ? "A+B 8" : withB === "rest" ? "A+B at rest" : String(n);
    return `${label}: ${f(best.cpu)}`;
  });
  const four = rows.find((r) => r.n === 4 && !r.withB).best.cpu;
  const eight = rows.find((r) => r.withB === "heard").best.cpu;
  console.log(
    `${name.padEnd(26)} cpu ms/quantum, least of ${REPS}, voices held  ${cells.join("  ")}   4 voices = ${f((four / BUDGET_MS) * 100, 0)}% of the budget, 8 = ${f((eight / BUDGET_MS) * 100, 0)}%`,
  );
}

// ---- fast: a run of notes ---------------------------------------------------
// metering: "off" (what the engine has always been measured with), or "app"
// (what `liveNoteOn`/`liveNoteOff` do to the worklet).
function fast(tree, perSecond, metering, withB) {
  const a = new LivePoly(tree, RATE, 4);
  const b = withB ? new LivePoly(tree, RATE, 4) : null;
  const state = { bRest: withB === "rest" };
  const gap = Math.max(1, Math.round(RATE / Q / perSecond));
  const hold = Math.max(1, Math.round(gap * 0.6));
  const total = Math.round((SECONDS * RATE) / Q);
  const walls = [];
  const handler = { on: [], meter: [], off: [] };
  let metered = false;
  let sinceLastKey = 0;
  let down = 0;
  let nextNote = 0;
  const sounding = [];
  for (let q = 0; q < 100; q++) quantum(a, b, state);
  const c0 = cpu();
  for (let q = 0; q < total; q++) {
    if (q % gap === 0) {
      const note = RUN[nextNote++ % RUN.length];
      let t = performance.now();
      a.note_on(note, 0.8);
      b?.note_on(note, 0.8);
      handler.on.push(performance.now() - t);
      sounding.push({ note, at: q + hold });
      down++;
      sinceLastKey = 0;
      if (metering === "app") {
        // main.js `setSignalFlow(true)`, on every press; the worklet's `meter`.
        t = performance.now();
        a.set_meter(true);
        JSON.parse(a.meter_keys());
        handler.meter.push(performance.now() - t);
        metered = true;
      }
    }
    for (let i = sounding.length - 1; i >= 0; i--) {
      if (sounding[i].at === q) {
        const t = performance.now();
        a.note_off(sounding[i].note);
        b?.note_off(sounding[i].note);
        handler.off.push(performance.now() - t);
        sounding.splice(i, 1);
        down--;
      }
    }
    if (metered && down === 0 && ++sinceLastKey * Q >= 0.4 * RATE) {
      a.set_meter(false); // liveNoteOff's 400 ms timer
      metered = false;
    }
    const t = performance.now();
    quantum(a, b, state);
    if (metered && q % 8 === 0) {
      const len = a.meter_len();
      if (len > 0) Array.from(new Float32Array(wasm.memory.buffer, a.meter_ptr(), len));
    }
    walls.push(performance.now() - t);
  }
  const mean = (cpu() - c0) / total;
  a.free();
  b?.free();
  return {
    cpu: mean,
    wallMin: Math.min(...walls),
    wallP50: median(walls),
    wallP99: pct(walls, 0.99),
    over: walls.filter((w) => w > BUDGET_MS).length / total,
    handler,
  };
}

function printFast(label, runs) {
  const best = runs.reduce((x, y) => (y.cpu < x.cpu ? y : x));
  const med = median(runs.map((r) => r.cpu));
  console.log(
    `  ${label.padEnd(34)} cpu ${f(best.cpu)} (median ${f(med)}) ms/q = ${f((best.cpu / BUDGET_MS) * 100, 0)}%` +
      `  wall min ${f(best.wallMin)} p50 ${f(best.wallP50)} p99 ${f(best.wallP99)}` +
      `  over budget ${f(best.over * 100, 1)}% (loaded machine)`,
  );
  const h = best.handler;
  const m = (xs) => (xs.length ? `${f(Math.min(...xs))}/${f(median(xs))}` : "-");
  console.log(
    `  ${"".padEnd(34)} port handler ms, min/median: note_on ${m(h.on)}  note_off ${m(h.off)}  meter on ${m(h.meter)}`,
  );
}

// ---- events: the port handler's own work -------------------------------------
function events(tree) {
  const out = {};
  const timeIt = (fn, n) => {
    const xs = [];
    for (let i = 0; i < n; i++) {
      const t = performance.now();
      fn();
      xs.push(performance.now() - t);
    }
    return { min: Math.min(...xs), p50: median(xs) };
  };
  new LivePoly(tree, RATE, 4).free(); // warm
  out.construct4 = timeIt(() => new LivePoly(tree, RATE, 4).free(), 12);
  out.construct1 = timeIt(() => new LivePoly(tree, RATE, 1).free(), 12);
  const a = new LivePoly(tree, RATE, 4);
  a.note_on(60, 0.8);
  out.noteOn = timeIt(() => a.note_on(64, 0.8), 200);
  out.meterOn = timeIt(() => {
    a.set_meter(true);
    JSON.parse(a.meter_keys());
  }, 200);
  out.taps = a.set_meter(true);
  a.set_meter(false);
  out.setPatchParse = timeIt(() => a.set_patch(tree), 12);
  a.free();
  return out;
}

// ---- the trees ----------------------------------------------------------------
console.log(`live_cost.mjs  ${RATE} Hz, quantum ${Q} frames = ${f(BUDGET_MS)} ms budget, node ${process.version}, ${os.cpus()[0].model}`);
console.log(`text codecs: ${flags["native-text"] ? "node's own" : "the worklet's polyfill (live-audio.js)"}   load average at start ${load()}`);
const e = new WasmEngine(20261006n, Math.max(POOL, 4));
const presets = JSON.parse(e.preset_list());
const trees = presets.map((p) => ({ name: p.name, sig: p.sig, tree: e.preset_tree_json(p.index) }));

// The sweep: every preset at four voices held, the least of REPS runs.
const sweep = [];
for (const t of trees) {
  const reps = [];
  for (let r = 0; r < SWEEP_REPS; r++) reps.push(steady(t.tree, 4, false).cpu);
  sweep.push({ ...t, cpu: Math.min(...reps) });
}
sweep.sort((x, y) => x.cpu - y.cpu);
console.log(`\nSWEEP  ${sweep.length} presets, 4 voices held, cpu ms/quantum (least of ${SWEEP_REPS})   load ${load()}`);
const at = (q) => sweep[Math.min(sweep.length - 1, Math.floor(sweep.length * q))];
console.log(
  `  cheapest ${sweep[0].name} ${f(sweep[0].cpu)}   median ${at(0.5).name} ${f(at(0.5).cpu)}   p90 ${at(0.9).name} ${f(at(0.9).cpu)}   heaviest ${sweep.at(-1).name} ${f(sweep.at(-1).cpu)}`,
);
console.log(`  top five: ${sweep.slice(-5).reverse().map((s) => `${s.name} ${f(s.cpu)}`).join(", ")}`);
const over = (x) => sweep.filter((s) => s.cpu > x).length;
console.log(`  over 25% of the budget: ${over(BUDGET_MS * 0.25)}, over 50%: ${over(BUDGET_MS * 0.5)}, over 100%: ${over(BUDGET_MS)} (of ${sweep.length})`);
// What a CPU SLOWDOWN times slower would make of it: a preset's four voices at
// SLOWDOWN × their cost here, and eight (a B slot heard beside A) at twice that.
// How many voices fit in TARGET of a quantum there, if the cost is the same per voice.
const share = (cost, voices) => (cost * (voices / 4) * SLOWDOWN) / BUDGET_MS;
const count = (voices, limit) => sweep.filter((s) => share(s.cpu, voices) > limit).length;
console.log(`  on a CPU ${SLOWDOWN}x slower (4 voices | 8 with a B slot heard): over the whole quantum ${count(4, 1)} | ${count(8, 1)}, over ${TARGET * 100}% ${count(4, TARGET)} | ${count(8, TARGET)}, over 25% ${count(4, 0.25)} | ${count(8, 0.25)} of ${sweep.length}`);
const fit = sweep.map((s) => Math.floor((TARGET * BUDGET_MS) / (SLOWDOWN * (s.cpu / 4))));
const hist = [0, 1, 2, 3, 4].map((n) => fit.filter((v) => (n === 4 ? v >= 4 : v === n)).length);
console.log(`  voices that fit in ${TARGET * 100}% of a quantum there: ${hist.map((c, n) => `${n === 4 ? "4+" : n}: ${c} presets`).join(", ")}`);
if (flags.list) for (const s of sweep) console.log(`    ${s.name.padEnd(22)} ${String(s.sig).padEnd(14)} ${f(s.cpu)} ms = ${f((s.cpu / BUDGET_MS) * 100, 0)}% here, ${f(share(s.cpu, 4) * 100, 0)}% on the slower CPU`);
if (flags.gate) {
  const limit = Number(flags.gate);
  const over = sweep.filter((x) => x.cpu > limit);
  console.log(`  gate ${limit} ms for four voices: ${over.length ? `${over.length} over: ${over.map((x) => `${x.name} ${f(x.cpu)}`).join(", ")}` : "none over"}`);
  if (over.length) process.exitCode = 1;
}
if (flags["sweep-only"]) process.exit(process.exitCode ?? 0);

// Landmarks: the sweep's cheap, median and heavy presets, the named ones, and
// the heaviest tree of a seeded pool.
const picked = new Map();
for (const s of [sweep[0], at(0.5), at(0.9), sweep.at(-1)]) picked.set(s.name, s.tree);
for (const n of String(flags.presets || "").split(",").filter(Boolean)) {
  const t = trees.find((x) => x.name.toLowerCase() === n.toLowerCase());
  if (t) picked.set(t.name, t.tree);
}
if (POOL > 0) {
  const t0 = performance.now();
  while (e.fill_step(4) > 0) {}
  const ids = JSON.parse(e.ranked()).map((r) => r.id);
  let heavy = null;
  for (const id of ids) {
    const tree = e.tree_json_of(id);
    if (tree.length < 8) continue;
    const c = Math.min(steady(tree, 4, false).cpu, steady(tree, 4, false).cpu);
    if (!heavy || c > heavy.cpu) heavy = { id, cpu: c, tree };
  }
  console.log(`  pool of ${ids.length} dealt in ${f((performance.now() - t0) / 1e3, 1)} s; its heaviest patch #${heavy.id} (${heavy.tree.length} B) costs ${f(heavy.cpu)} ms/quantum at 4 voices   load ${load()}`);
  picked.set(`pool patch #${heavy.id}`, heavy.tree);
}

console.log(`\nSTEADY  cpu ms/quantum, voices held (the worklet's voice limit is 4 per LivePoly, 8 with a B slot heard; at rest B renders none)   load ${load()}`);
for (const [name, tree] of picked) printSteady(name, steadyRow(name, tree));

console.log(`\nFAST  notes per second, 4 voices, each note let go after 60% of the gap   load ${load()}`);
for (const [name, tree] of picked) {
  console.log(`${name}`);
  for (const perSecond of [8, 16]) {
    for (const metering of ["off", "app"]) {
      const runs = [];
      for (let r = 0; r < REPS; r++) runs.push(fast(tree, perSecond, metering, false));
      printFast(`${perSecond}/s metering ${metering === "app" ? "as the app does it" : "off"}`, runs);
    }
  }
  for (const [withB, label] of [["heard", "A+B heard"], ["rest", "A+B at rest"]]) {
    const runs = [];
    for (let r = 0; r < REPS; r++) runs.push(fast(tree, 16, "app", withB));
    printFast(`16/s metering as the app, ${label}`, runs);
  }
}

console.log(`\nEVENTS  the port handler's work (ms, min / median of wall; the least a loaded machine allows)   load ${load()}`);
for (const [name, tree] of picked) {
  const ev = events(tree);
  const s = (x) => `${f(x.min)}/${f(x.p50)}`;
  console.log(
    `${name.padEnd(26)} new LivePoly(.., 4) ${s(ev.construct4)}  (1 voice ${s(ev.construct1)})  note_on ${s(ev.noteOn)}  set_meter(true)+meter_keys+parse ${s(ev.meterOn)} (${ev.taps} taps)  set_patch parse ${s(ev.setPatchParse)}`,
  );
}
console.log(`\nbudget ${f(BUDGET_MS)} ms/quantum at ${RATE} Hz; load at the end ${load()}`);
