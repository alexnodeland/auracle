//! The preset wirings the app ships (`apps/web/perform-wirings.json`) are the
//! presets the code builds today, measured the way the code measures today.
//!
//! The file is generated (`make perform-wirings`, the `preset_wirings`
//! example): minutes of renders, so it is committed rather than built. A stale
//! file wires a preset's controls to the wrong knobs until the app's
//! background re-check lands, and then the re-check re-centres them. Two tests
//! stand between a change and that:
//!
//! - `shipped_preset_wirings_are_current` compares fingerprints of the presets
//!   and of the measurement's named inputs (phrase, render namespace, feature
//!   names, controls, PERFORM's constants). It renders nothing.
//! - `shipped_preset_wirings_measure_the_same_today` catches what no
//!   fingerprint sees (feature maths, loudness normalization, vetting,
//!   compiler, DSP, the pool the standardizer is fitted to, PERFORM's solver)
//!   by re-measuring a fixed sample of the file natively
//!   (`auracle_wasm::shipped`): the standardizer, the standardized φ of every
//!   eighth preset, and two presets' whole wiring. A few seconds on four
//!   cores. A change that moves none of the sample can still pass.

use auracle_features::PhraseSpec;
use auracle_grammar::preset_bank;
use auracle_wasm::shipped::{
    self, measurement_fingerprint, preset_source, TOLERANCE, WIRE_PROBES, Z_PROBE_STRIDE,
};
use serde_json::Value;

const REGENERATE: &str = "run `make perform-wirings` and commit apps/web/perform-wirings.json";

fn shipped_file() -> Value {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/web/perform-wirings.json"
    );
    let text =
        std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{path}: {e} — {REGENERATE}"));
    serde_json::from_str(&text).expect("perform-wirings.json is JSON")
}

#[test]
fn shipped_preset_wirings_are_current() {
    let file = shipped_file();
    assert_eq!(
        file["fingerprint"].as_str(),
        Some(measurement_fingerprint(&PhraseSpec::default()).as_str()),
        "the phrase, the render namespace (RENDER_EPOCH, the quiver version), the feature names, the controls or PERFORM's constants changed since the wirings were measured — {REGENERATE}"
    );
    let rows = file["presets"].as_array().expect("a presets array");
    let bank = preset_bank();
    let names: Vec<&str> = rows
        .iter()
        .map(|r| r["name"].as_str().unwrap_or(""))
        .collect();
    let want: Vec<&str> = bank.iter().map(|p| p.name).collect();
    assert_eq!(names, want, "the preset library changed — {REGENERATE}");
    for (row, p) in rows.iter().zip(&bank) {
        assert_eq!(
            row["source"].as_str(),
            Some(preset_source(p.name, &p.tree).as_str()),
            "{} changed since it was measured — {REGENERATE}",
            p.name
        );
        let data = &row["data"];
        assert!(
            data["wiring"].as_array().is_some_and(|w| w.len() == 6) && data["addrs"].is_array(),
            "{} has no wiring in the file — {REGENERATE}",
            p.name
        );
        assert!(
            row["tree"].as_str().is_some_and(|t| t.starts_with('{')),
            "{}: tree text",
            p.name
        );
    }
}

/// Where `now` first differs from `was`, as a path and both values: numbers
/// within [`TOLERANCE`] of their size, everything else exactly.
fn first_difference(was: &Value, now: &Value, path: &str) -> Option<String> {
    let differs = || Some(format!("{path}: shipped {was}, today {now}"));
    match (was, now) {
        (Value::Number(a), Value::Number(b)) => {
            let (a, b) = (a.as_f64()?, b.as_f64()?);
            let scale = a.abs().max(b.abs()).max(1.0);
            ((a - b).abs() > TOLERANCE * scale).then(differs).flatten()
        }
        (Value::Array(a), Value::Array(b)) => {
            if a.len() != b.len() {
                return differs();
            }
            a.iter()
                .zip(b)
                .enumerate()
                .find_map(|(i, (x, y))| first_difference(x, y, &format!("{path}[{i}]")))
        }
        (Value::Object(a), Value::Object(b)) => {
            if a.keys().ne(b.keys()) {
                return differs();
            }
            a.iter()
                .find_map(|(k, x)| first_difference(x, &b[k], &format!("{path}.{k}")))
        }
        _ => (was != now).then(differs).flatten(),
    }
}

#[test]
fn shipped_preset_wirings_measure_the_same_today() {
    let t0 = std::time::Instant::now();
    let threads = std::thread::available_parallelism().map_or(2, |n| n.get());
    let file = shipped_file();
    let rows = file["presets"].as_array().expect("a presets array");
    let bank = preset_bank();
    // The cheap test reports a changed library; this one only needs the rows
    // it samples to be the presets they name.
    assert_eq!(
        rows.len(),
        bank.len(),
        "the preset library changed — {REGENERATE}"
    );

    let mut e = shipped::boot(threads);
    let boot_s = t0.elapsed().as_secs_f64();
    let (mean, std) = shipped::audio_standardizer(&e).expect("the booted pool is standardized");
    let now = serde_json::json!({ "mean": mean, "std": std });
    if let Some(diff) = first_difference(&file["standardizer"], &now, "standardizer") {
        panic!(
            "the standard pool's standardizer is not the one the wirings were measured under \
             ({diff}): the grammar prior, vetting, φ or the standardizer fit changed — {REGENERATE}"
        );
    }

    let z_probes: Vec<usize> = (0..bank.len()).step_by(Z_PROBE_STRIDE).collect();
    let probes: Vec<usize> = z_probes
        .iter()
        .chain(&WIRE_PROBES)
        .copied()
        .filter(|&i| i < bank.len())
        .collect();
    let trees: Vec<_> = probes.iter().map(|&i| bank[i].tree.clone()).collect();
    shipped::warm(&e, &trees, threads);
    let loaded: Vec<(usize, String)> = probes
        .iter()
        .map(|&i| {
            let id = e.load_preset(i);
            assert!(id > 0, "{} did not load", bank[i].name);
            (i, e.tree_json_of(id))
        })
        .collect();

    for (i, tree) in &loaded {
        let name = bank[*i].name;
        let z = shipped::preset_z(&e, tree).unwrap_or_else(|| panic!("{name} does not vet"));
        if let Some(diff) = first_difference(&rows[*i]["data"]["z"], &serde_json::json!(z), "z") {
            panic!(
                "{name} sounds different to φ than when its wiring was measured ({diff}): \
                 the feature maths, loudness normalization, compiler or DSP changed — {REGENERATE}"
            );
        }
    }

    // The whole measurement, solver and verification included, of the
    // cheapest presets: one thread each.
    let e = &e;
    let wired: Vec<(usize, String)> = std::thread::scope(|s| {
        let jobs: Vec<_> = loaded
            .iter()
            .filter(|(i, _)| WIRE_PROBES.contains(i))
            .map(|(i, tree)| s.spawn(move || (*i, e.perform_wire(tree, "[]", None))))
            .collect();
        jobs.into_iter()
            .map(|j| j.join().expect("measured"))
            .collect()
    });
    for (i, data) in &wired {
        let name = bank[*i].name;
        let now: Value = serde_json::from_str(data).expect("wiring JSON");
        if let Some(diff) = first_difference(&rows[*i]["data"], &now, "data") {
            panic!(
                "{name} wires differently today than the shipped file says ({diff}) — {REGENERATE}"
            );
        }
    }
    eprintln!(
        "re-measured the shipped wirings' sample: boot {boot_s:.1} s, total {:.1} s on {threads} threads",
        t0.elapsed().as_secs_f64()
    );
}
