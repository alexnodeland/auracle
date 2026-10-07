// The loop `wasm_speed.mjs` times in a browser's worker, and in node for the
// reference: the live voice's quanta, four voices held, in batches short
// enough that the least of them was not descheduled. No imports: the worker
// and node each hand in the engine's module (`mod`), already initialised.
//
// A browser has no thread CPU clock (`process.threadCpuUsage()` is node's),
// and a loaded machine stretches wall time by what a thread waited, so each
// batch is 8 quanta (about 2 ms of work at the heaviest preset), short of a
// scheduler's slice, and the figure is the least batch of many: the cost of a
// quantum when nothing took the core away. The same loop in node and in a
// browser puts both on one scale.

export function bench(mod, { names, rate = 48_000, batches = 200, batch = 8, voices = 4 }) {
  const { LivePoly, WasmEngine } = mod;
  const engine = new WasmEngine(20261006n, 4);
  const trees = new Map(JSON.parse(engine.preset_list()).map((p) => [p.name, engine.preset_tree_json(p.index)]));
  const CHORD = [48, 55, 64, 72];
  const out = [];
  for (const name of names) {
    const poly = new LivePoly(trees.get(name), rate, 4);
    for (let i = 0; i < voices; i++) poly.note_on(CHORD[i], 0.8);
    for (let q = 0; q < 300; q++) poly.process_ptr(128); // past the attack, and the engine's warm-up
    const ms = [];
    for (let b = 0; b < batches; b++) {
      const t = performance.now();
      for (let q = 0; q < batch; q++) poly.process_ptr(128);
      ms.push((performance.now() - t) / batch);
    }
    ms.sort((a, c) => a - c);
    out.push({ name, min: ms[0], p10: ms[Math.floor(ms.length * 0.1)], p50: ms[Math.floor(ms.length * 0.5)] });
    poly.free();
  }
  return out;
}
