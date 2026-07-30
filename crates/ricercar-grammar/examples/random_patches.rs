//! The M1 demo: sample random patches from the grammar prior and render each
//! one playing a short phrase to a WAV file.
//!
//! ```bash
//! cargo run -p ricercar-grammar --example random_patches --release
//! ```
//!
//! Writes `random_patch_<n>.wav` files (and prints each patch's s-expression)
//! into `target/random_patches/`. Every one is a genuine draw from the prior —
//! this is what the synth "dreams" before it knows anything about you.

use fugue::runtime::handler::run;
use fugue::runtime::interpreters::PriorHandler;
use fugue::Trace;
use fugue_evo::inference::prior::GenomePrior;
use quiver::render::write_wav;
use rand::rngs::StdRng;
use rand::SeedableRng;
use ricercar_grammar::{compile, PatchGrammarPrior};
use std::path::Path;

const SR: f64 = 44_100.0;

/// A tiny phrase: (v/oct offset from C4, gate-on seconds, gate-off seconds).
const PHRASE: [(f64, f64, f64); 3] = [
    (0.0, 0.60, 0.15),        // C4, held
    (3.0 / 12.0, 0.25, 0.10), // Eb4, stab
    (-1.0, 0.80, 1.25),       // C3, long release tail
];

fn main() {
    let n: usize = std::env::args()
        .nth(1)
        .and_then(|a| a.parse().ok())
        .unwrap_or(8);
    let seed: u64 = std::env::args()
        .nth(2)
        .and_then(|a| a.parse().ok())
        .unwrap_or(0xE05);

    let out_dir = Path::new("target/random_patches");
    std::fs::create_dir_all(out_dir).expect("create output dir");

    let prior = PatchGrammarPrior::default();
    let mut rng = StdRng::seed_from_u64(seed);

    for i in 0..n {
        let (tree, trace) = run(
            PriorHandler {
                rng: &mut rng,
                trace: Trace::default(),
            },
            prior.model(),
        );
        println!(
            "[{i}] log p(x) = {:8.2}  {}",
            trace.log_prior,
            tree.to_sexpr()
        );

        let mut voice = compile(&tree, SR).expect("prior samples always compile");
        let mut left = Vec::new();
        let mut right = Vec::new();
        for (voct, on_s, off_s) in PHRASE {
            voice.pitch.set(voct);
            voice.gate.set(5.0);
            for _ in 0..(on_s * SR) as usize {
                let (l, r) = voice.patch.tick();
                left.push(l / 5.0); // ±5 V modular level → ±1.0 sample
                right.push(r / 5.0);
            }
            voice.gate.set(0.0);
            for _ in 0..(off_s * SR) as usize {
                let (l, r) = voice.patch.tick();
                left.push(l / 5.0);
                right.push(r / 5.0);
            }
        }

        let path = out_dir.join(format!("random_patch_{i}.wav"));
        write_wav(&path, SR as u32, &left, &right).expect("write wav");
        println!("      → {}", path.display());
    }
    println!("\n{n} patches rendered. Listen with e.g. `open target/random_patches/`.");
}
