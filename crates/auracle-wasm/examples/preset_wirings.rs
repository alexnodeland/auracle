//! Measure PERFORM's wiring of every preset, the way the app's engine worker
//! does, and write the file the app ships them in.
//!
//! ```bash
//! make perform-wirings          # = the line below, nice'd
//! cargo run -p auracle-wasm --example preset_wirings --release -- [threads] [out]
//! ```
//!
//! A first measurement costs the browser eleven-odd seconds of renders (one per
//! knob, then four per reachable control), and until it lands every named
//! control reads "listening…". Presets are the patches a newcomer meets first:
//! the warm start's cards, the preset bank, booth mode's demo set. So each one
//! is measured here, ahead of time, and shipped in `apps/web/perform-wirings.json`;
//! PERFORM plays a preset from it at once and re-measures it in the background
//! against the session's own model (stale-while-revalidate, `perform.js`).
//!
//! "The way the worker does" means through the same surface: a `WasmEngine`
//! booted as the page boots one (a 40-patch pool, filled, then re-standardized
//! as the worker does after its fill), the preset inserted with `load_preset`,
//! its tree read back with `tree_json_of` — the text the app keys its cache
//! by — and measured by `perform_wire` with no knob overrides, which is what
//! the worker's planned measurement finishes as (pinned by
//! `a_planned_measurement_is_the_measurement`).
//!
//! The engine seed is fixed, so the file is reproducible. Each thread boots its
//! own engine from that seed and so measures under the same standardizer: the
//! thread count changes the time, never the numbers.
//!
//! The file records, per preset, a fingerprint of what it was measured from
//! (`auracle_wasm::shipped`), and `tests/shipped_wirings.rs` fails when a
//! preset or the measurement's inputs change without this being re-run.

use std::sync::Mutex;

use auracle_features::PhraseSpec;
use auracle_grammar::preset_bank;
use auracle_wasm::shipped::{measurement_fingerprint, preset_source};
use auracle_wasm::WasmEngine;

const SEED: u64 = 20_260_928;
const POOL: usize = 40;

fn boot() -> WasmEngine {
    let mut e = WasmEngine::new(SEED, POOL);
    // The worker's serial fill, two draws a step, until the pool is full or the
    // draw budget is spent.
    for _ in 0..400 {
        if e.fill_step(2) == 0 {
            break;
        }
    }
    e.restandardize_if_untaught();
    e
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let threads: usize = args
        .first()
        .and_then(|s| s.parse().ok())
        .unwrap_or(2)
        .max(1);
    let out = args
        .get(1)
        .cloned()
        .unwrap_or_else(|| "apps/web/perform-wirings.json".into());
    let bank = preset_bank();
    let n = bank.len();
    let rows: Mutex<Vec<Option<String>>> = Mutex::new(vec![None; n]);
    let t0 = std::time::Instant::now();
    std::thread::scope(|s| {
        for t in 0..threads {
            let (bank, rows) = (&bank, &rows);
            s.spawn(move || {
                let mut e = boot();
                for i in (t..n).step_by(threads) {
                    let p = &bank[i];
                    let id = e.load_preset(i);
                    assert!(id > 0, "{} did not load", p.name);
                    let tree = e.tree_json_of(id);
                    let data = e.perform_wire(&tree, "[]");
                    assert!(data != "null", "{} could not be measured", p.name);
                    let data: serde_json::Value = serde_json::from_str(&data).expect("wiring JSON");
                    let reach = data["wiring"]
                        .as_array()
                        .map(|w| w.iter().filter(|x| x["search"] != true).count())
                        .unwrap_or(0);
                    eprintln!(
                        "  {:>2}/{n} {:<22} {} of 6 controls reach · {:.0} s",
                        i + 1,
                        p.name,
                        reach,
                        t0.elapsed().as_secs_f64()
                    );
                    let row = serde_json::json!({
                        "name": p.name,
                        "source": preset_source(p.name, &p.tree),
                        "tree": tree,
                        "data": data,
                    });
                    rows.lock().unwrap()[i] = Some(row.to_string());
                }
            });
        }
    });
    let rows: Vec<String> = rows
        .into_inner()
        .unwrap()
        .into_iter()
        .map(|r| r.expect("measured"))
        .collect();
    // One preset per line, so a regeneration diffs by preset.
    let head = serde_json::json!({
        "about": "PERFORM's wiring of every preset, measured natively by `make perform-wirings` (crates/auracle-wasm/examples/preset_wirings.rs). Generated: do not edit. The app plays a preset from this at once and re-measures it in the background.",
        "rev": 0,
        "fingerprint": measurement_fingerprint(&PhraseSpec::default()),
    });
    let head = head.to_string();
    let text = format!(
        "{},\n\"presets\": [\n{}\n]}}\n",
        &head[..head.len() - 1],
        rows.join(",\n")
    );
    // Round-trips as JSON, or it is not written.
    let _: serde_json::Value = serde_json::from_str(&text).expect("the file is JSON");
    std::fs::write(&out, &text).expect("write the wirings");
    eprintln!(
        "wrote {out}: {n} presets, {} KB, {:.0} s",
        text.len() / 1024,
        t0.elapsed().as_secs_f64()
    );
}
