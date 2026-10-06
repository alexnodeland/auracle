//! The presets' faces the app ships (`apps/web/preset-faces.json`) are each
//! preset's face as the engine renders it today.
//!
//! The file is generated (`make preset-faces`, the `preset_faces` example):
//! one render per preset, committed so the page draws a preset's face without
//! asking the engine. A stale file draws a preset with another sound's
//! picture, and nothing in the page could tell. Two tests stand between a
//! change and that:
//!
//! - `shipped_preset_faces_are_current` compares what renders nothing: the
//!   fingerprint of what a face is measured with (the render namespace, the
//!   reference clip, the face's encoding), each preset's name, source and
//!   render key, and that the key is the one the worker files the preset's
//!   face under.
//! - `shipped_preset_faces_render_the_same_today` renders every preset again
//!   and compares the whole file with what `make preset-faces` writes today,
//!   byte for byte: anything that moves a face (the compiler, the DSP, the
//!   normalization, the face's analysis) fails it. A few seconds on four
//!   cores. The built wasm renders the same bytes as the native build (every
//!   preset when this was written, `face_of_tree` under node), and
//!   `tests/web/faces_presets.spec.js` compares one preset's face in the page
//!   with the engine's.

use auracle_features::{cache_namespace, render_key, PhraseSpec};
use auracle_grammar::preset_bank;
use auracle_wasm::shipped::faces::{faces_fingerprint, preset_faces, PresetFaces};
use auracle_wasm::shipped::{preset_source, POOL, SEED};
use auracle_wasm::{farm_key, WasmEngine};

const REGENERATE: &str = "run `make preset-faces` and commit apps/web/preset-faces.json";

fn shipped_text() -> String {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/web/preset-faces.json"
    );
    std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{path}: {e} — {REGENERATE}"))
}

fn shipped() -> PresetFaces {
    serde_json::from_str(&shipped_text())
        .unwrap_or_else(|e| panic!("preset-faces.json does not read: {e} — {REGENERATE}"))
}

#[test]
fn shipped_preset_faces_are_current() {
    let file = shipped();
    let phrase = PhraseSpec::default();
    assert_eq!(
        file.fingerprint,
        faces_fingerprint(&phrase),
        "the render namespace (the phrase, RENDER_EPOCH, the quiver version), the reference clip or the face's encoding changed since the faces were rendered — {REGENERATE}"
    );
    assert_eq!(file.ns, cache_namespace(&phrase), "{REGENERATE}");
    assert_eq!(file.clip, phrase.audition_clip().id(), "{REGENERATE}");
    let bank = preset_bank();
    let names: Vec<&str> = file.presets.iter().map(|r| r.name.as_str()).collect();
    let want: Vec<&str> = bank.iter().map(|p| p.name).collect();
    assert_eq!(names, want, "the preset library changed — {REGENERATE}");
    // The engine the worker runs: the key it files a preset's face under,
    // asked by the preset's tree, is the file's.
    let e = WasmEngine::new(SEED, POOL);
    for (i, (row, p)) in file.presets.iter().zip(&bank).enumerate() {
        assert_eq!(
            row.source,
            preset_source(p.name, &p.tree),
            "{} changed since its face was rendered — {REGENERATE}",
            p.name
        );
        assert_eq!(
            row.key,
            render_key(&p.tree, &phrase),
            "{}: {REGENERATE}",
            p.name
        );
        assert_eq!(row.listens, p.tree.listens(), "{}: {REGENERATE}", p.name);
        assert_eq!(
            farm_key(&e.preset_tree_json(i), &e.phrase_json()),
            format!("{}/{}", file.ns, row.key),
            "{}: the worker files its face under another key",
            p.name
        );
    }
}

#[test]
fn shipped_preset_faces_render_the_same_today() {
    let t0 = std::time::Instant::now();
    let threads = std::thread::available_parallelism().map_or(2, |n| n.get());
    let file = shipped();
    let today = preset_faces(threads);
    assert_eq!(
        today.presets.len(),
        preset_bank().len(),
        "every preset has a face today"
    );
    for (was, now) in file.presets.iter().zip(&today.presets) {
        assert_eq!(
            was, now,
            "{}'s face renders differently today: the compiler, the DSP, the normalization or the face's analysis changed — {REGENERATE}",
            now.name
        );
    }
    assert_eq!(
        shipped_text(),
        today.to_text(),
        "the file is not the text `make preset-faces` writes today — {REGENERATE}"
    );
    eprintln!(
        "rendered {} presets' faces again: {:.1} s on {threads} threads",
        today.presets.len(),
        t0.elapsed().as_secs_f64()
    );
}
