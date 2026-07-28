// EVOSYNTH engine worker: owns the wasm engine so rendering and MCMC never
// block the UI thread. Audio buffers cross as transferable Float32Arrays.

import init, { WasmEngine } from "./pkg/evosynth_wasm.js";

let engine = null;

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

self.onmessage = async (e) => {
  const m = e.data;
  switch (m.type) {
    case "init": {
      await init();
      engine = new WasmEngine(BigInt(m.seed >>> 0), m.poolSize);
      post({ type: "ready" });
      // Fill incrementally so the boot meter can narrate progress.
      let status = JSON.parse(engine.status());
      while (status.pool < status.pool_target) {
        const added = engine.fill_step(2);
        status = JSON.parse(engine.status());
        post({ type: "fill_progress", pool: status.pool, target: status.pool_target });
        if (added === 0) break;
      }
      post({ type: "filled", status });
      break;
    }
    case "duel": {
      const pair = JSON.parse(engine.next_duel());
      post({ type: "duel", pair });
      break;
    }
    case "render": {
      const buf = engine.render_of(m.idx);
      const arr = new Float32Array(buf);
      post(
        { type: "render", idx: m.idx, sampleRate: engine.sample_rate(), buffer: arr, sexpr: engine.sexpr_of(m.idx) },
        [arr.buffer]
      );
      break;
    }
    case "record_duel": {
      engine.record_duel(m.a, m.b, m.choseA);
      post({ type: "status", status: JSON.parse(engine.status()) });
      break;
    }
    case "record_keep": {
      engine.record_keep(m.idx, m.kept);
      post({ type: "status", status: JSON.parse(engine.status()) });
      break;
    }
    case "record_stars": {
      engine.record_stars(m.idx, m.rating);
      post({ type: "status", status: JSON.parse(engine.status()) });
      break;
    }
    case "fit": {
      engine.fit();
      post({ type: "fitted", taste: JSON.parse(engine.taste()) });
      break;
    }
    case "refine": {
      engine.refine();
      post({ type: "refined", ranked: JSON.parse(engine.ranked()) });
      break;
    }
    case "export": {
      post({ type: "exported", json: engine.export_log() });
      break;
    }
    case "import": {
      const ok = engine.import_log(m.json);
      post({ type: "imported", ok, status: JSON.parse(engine.status()) });
      break;
    }
  }
};
