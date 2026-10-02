//! What a face costs beside the render it is taken from, natively.
//!
//! ```bash
//! cargo run -p auracle-features --example face_cost --release
//! ```
//!
//! Every preset is featurized (render, vet, normalize, φ) and its face taken
//! from the same render ([`auracle_features::Face`]), each timed. The face is
//! computed inside every featurization (`featurize_memo`), so its share of a
//! featurization is what faces add to a fill, a generation's walks and an
//! offer. Its twin in wasm is `auracle-wasm/examples/face_cost.mjs`.

use std::time::Instant;

use auracle_features::{featurize, Face, PhraseSpec};

fn median(mut xs: Vec<f64>) -> f64 {
    xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    xs[xs.len() / 2]
}

fn main() {
    let spec = PhraseSpec::default();
    let mut render_ms = Vec::new();
    let mut face_ms = Vec::new();
    for (_, tree) in auracle_grammar::presets() {
        let t = Instant::now();
        let Ok(v) = featurize(&tree, &spec) else {
            continue;
        };
        render_ms.push(t.elapsed().as_secs_f64() * 1e3);
        let t = Instant::now();
        let face = Face::of_f64(&v.render.samples, v.render.sample_rate);
        face_ms.push(t.elapsed().as_secs_f64() * 1e3);
        assert_eq!(face.bytes().len(), auracle_features::FACE_LEN);
    }
    let (r, f) = (median(render_ms.clone()), median(face_ms.clone()));
    println!("presets featurized: {}", render_ms.len());
    println!("featurize (render, vet, φ)  median {r:8.2} ms");
    println!(
        "face (40 bands × 12 slices)  median {f:8.2} ms   max {:.2} ms",
        face_ms.iter().cloned().fold(0.0, f64::max)
    );
    println!("face / featurize             {:8.2} %", 100.0 * f / r);
}
