//! Render every preset's face, the way the app's engine worker renders a
//! preset's, and write the file the app ships them in.
//!
//! ```bash
//! make preset-faces            # = the line below, nice'd
//! cargo run -p auracle-wasm --example preset_faces --release -- [threads] [out]
//! ```
//!
//! One render per preset on the standard phrase (the reference clip for a
//! preset with an AUDIO IN), through the bindings the worker asks a preset's
//! face by (`auracle_wasm::shipped::faces`). The page draws a preset's face
//! from this file at once, where it used to wait for a render in the engine's
//! faces lane behind everything else the engine had to do. The thread count
//! changes the time, never the bytes. `tests/shipped_faces.rs` fails when a
//! preset, the render namespace, the reference clip or the face's encoding
//! changes, or when a face renders differently today, until this is run again.

use auracle_wasm::shipped::faces::preset_faces;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let threads: usize = args
        .first()
        .and_then(|s| s.parse().ok())
        .unwrap_or(1)
        .max(1);
    let out = args
        .get(1)
        .cloned()
        .unwrap_or_else(|| "apps/web/preset-faces.json".into());
    let t0 = std::time::Instant::now();
    let faces = preset_faces(threads);
    let n = auracle_grammar::preset_bank().len();
    assert_eq!(
        faces.presets.len(),
        n,
        "every preset has a face (a preset that does not vet has none)"
    );
    let text = faces.to_text();
    // Round-trips, or it is not written.
    let back: auracle_wasm::shipped::faces::PresetFaces =
        serde_json::from_str(&text).expect("the file is JSON");
    assert_eq!(back, faces, "the file reads back as what was rendered");
    std::fs::write(&out, &text).expect("write the faces");
    eprintln!(
        "wrote {out}: {n} presets, {} KB, {:.1} s on {threads} thread(s)",
        text.len() / 1024,
        t0.elapsed().as_secs_f64()
    );
}
