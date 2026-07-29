// EVOSYNTH engine worker: owns the wasm engine so rendering and MCMC never
// block the UI thread. Audio buffers cross as transferable Float32Arrays.
// Candidates are addressed by stable id everywhere.

import init, { WasmEngine } from "./pkg/evosynth_wasm.js";

let engine = null;

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

const status = () => JSON.parse(engine.status());

// Everything the taste instruments need, in one bundle.
function tasteViews() {
  return {
    map: JSON.parse(engine.taste_map()),
    styles: JSON.parse(engine.styles()),
    lineage: JSON.parse(engine.lineage()),
    ranked: JSON.parse(engine.ranked()),
  };
}

function postBench(extra) {
  const buf = engine.edit_render();
  const arr = new Float32Array(buf);
  post(
    {
      type: "bench",
      rack: JSON.parse(engine.edit_describe()),
      vetOk: engine.edit_vet_ok(),
      sampleRate: engine.sample_rate(),
      buffer: arr,
      ...extra,
    },
    [arr.buffer]
  );
}

self.onmessage = async (e) => {
  const m = e.data;
  switch (m.type) {
    case "init": {
      await init();
      engine = new WasmEngine(BigInt(m.seed >>> 0), m.poolSize);
      post({ type: "ready" });
      // Fill incrementally so the boot meter can narrate progress.
      let st = status();
      while (st.pool < st.pool_target) {
        const added = engine.fill_step(2);
        st = status();
        post({ type: "fill_progress", pool: st.pool, target: st.pool_target });
        if (added === 0) break;
      }
      post({ type: "filled", status: st });
      break;
    }
    case "duel": {
      const pair = JSON.parse(engine.next_duel());
      post({ type: "duel", pair });
      break;
    }
    case "render": {
      const buf = engine.render_of(m.id);
      const arr = new Float32Array(buf);
      post(
        {
          type: "render",
          id: m.id,
          sampleRate: engine.sample_rate(),
          buffer: arr,
          sexpr: engine.sexpr_of(m.id),
        },
        [arr.buffer]
      );
      break;
    }
    case "record_duel": {
      engine.record_duel(m.a, m.b, m.choseA);
      post({ type: "status", status: status() });
      break;
    }
    case "record_keep": {
      engine.record_keep(m.id, m.kept);
      post({ type: "status", status: status() });
      break;
    }
    case "record_stars": {
      engine.record_stars(m.id, m.rating);
      post({ type: "status", status: status() });
      break;
    }
    case "fit": {
      engine.fit();
      post({ type: "fitted", views: tasteViews(), status: status() });
      break;
    }
    case "refine": {
      engine.refine();
      post({ type: "refined", views: tasteViews(), status: status() });
      break;
    }
    // ---- workbench (the interactive rack) ----
    case "edit_begin": {
      const ok = engine.edit_begin(m.id);
      if (ok) postBench({ subject: m.id });
      else post({ type: "bench_missing", id: m.id });
      break;
    }
    case "edit_param": {
      const ok = engine.edit_param(m.addr, m.value, m.isIndex);
      if (ok) postBench({ edited: m.addr, token: m.token });
      else post({ type: "edit_rejected", addr: m.addr });
      break;
    }
    case "edit_commit": {
      const id = Number(engine.edit_commit(m.asImprovement));
      post({
        type: "committed",
        id,
        views: tasteViews(),
        status: status(),
      });
      break;
    }
    case "refine_from": {
      const childId = Number(engine.refine_from(m.id, JSON.stringify(m.locks)));
      post({
        type: "evolved_from",
        seedId: m.id,
        childId,
        views: tasteViews(),
        status: status(),
      });
      break;
    }
    // ---- taste instruments ----
    case "taste_views": {
      post({ type: "taste_views", views: tasteViews() });
      break;
    }
    // ---- persistence ----
    case "export": {
      post({ type: "exported", json: engine.export_profile() });
      break;
    }
    case "import": {
      const ok = engine.import_profile(m.json);
      post({ type: "imported", ok, status: status() });
      break;
    }
  }
};
