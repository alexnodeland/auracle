//! The preset wirings the app ships (`apps/web/perform-wirings.json`) are the
//! presets the code builds today, measured under today's inputs.
//!
//! The file is generated (`make perform-wirings`, the `preset_wirings`
//! example): minutes of renders, so it is committed rather than built. Nothing
//! else would notice a preset edited, added or renamed without it being
//! re-measured — the app would just play the old preset's wiring on the new
//! one until a background re-check caught up. This compares fingerprints and
//! renders nothing.

use auracle_features::PhraseSpec;
use auracle_grammar::preset_bank;
use auracle_wasm::shipped::{measurement_fingerprint, preset_source};

const REGENERATE: &str = "run `make perform-wirings` and commit apps/web/perform-wirings.json";

#[test]
fn shipped_preset_wirings_are_current() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/web/perform-wirings.json"
    );
    let text =
        std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{path}: {e} — {REGENERATE}"));
    let file: serde_json::Value =
        serde_json::from_str(&text).expect("perform-wirings.json is JSON");
    assert_eq!(
        file["fingerprint"].as_str(),
        Some(measurement_fingerprint(&PhraseSpec::default()).as_str()),
        "the phrase, the feature names or the controls changed since the wirings were measured — {REGENERATE}"
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
