// EVOSYNTH engine worker: owns the wasm engine so rendering and MCMC never
// block the UI thread. Audio buffers cross as transferable Float32Arrays.
// Candidates are addressed by stable id everywhere.
//
// The wasm glue + binary are imported with the version stamp from this
// worker's own URL (?v=...), so a rebuilt engine can never be paired with a
// browser-cached stale module — protocol mismatch between main.js and the
// engine shows up as blank duel scopes and an empty map.

const V = new URL(self.location.href).searchParams.get("v") || Date.now();

let engine = null;
let WasmEngine = null;

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
      treeJson: engine.edit_tree_json(),
      ...extra,
    },
    [arr.buffer]
  );
}

self.onmessage = async (e) => {
  const m = e.data;
  switch (m.type) {
    case "init": {
      const mod = await import(`./pkg/evosynth_wasm.js?v=${V}`);
      await mod.default({
        module_or_path: new URL(`./pkg/evosynth_wasm_bg.wasm?v=${V}`, self.location.href),
      });
      WasmEngine = mod.WasmEngine;
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
    case "tree_json": {
      post({ type: "tree_json", id: m.id, json: engine.tree_json_of(m.id) });
      break;
    }
    case "describe": {
      post({ type: "described", id: m.id, rack: JSON.parse(engine.describe_of(m.id)) });
      break;
    }
    case "set_name": {
      engine.set_name(m.id, m.name);
      post({ type: "ranked", ranked: JSON.parse(engine.ranked()) });
      break;
    }
    case "presets": {
      post({ type: "presets", rows: JSON.parse(engine.preset_list()) });
      break;
    }
    case "load_preset": {
      const id = Number(engine.load_preset(m.index));
      post({ type: "preset_loaded", id, views: tasteViews(), status: status() });
      break;
    }
    case "edit_structure": {
      const err = engine.edit_structure(JSON.stringify(m.op));
      if (err === "") postBench({ edited: "structure" });
      else post({ type: "edit_rejected", error: err });
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
