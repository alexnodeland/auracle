//! How far does one PERFORM drift move the knobs? (max and median |Δ| per drift)
use auracle_grammar::{preset_bank, PatchGrammarPrior};
use auracle_session::perform::live_knobs;
use auracle_session::{Engine, SessionConfig};
use rand::SeedableRng;
fn main() {
    let engine = Engine::new(PatchGrammarPrior::default(), SessionConfig::default());
    let sr = engine.cfg.phrase.sample_rate;
    let mut rng = rand::rngs::StdRng::seed_from_u64(3);
    for p in preset_bank().iter().take(12) {
        for (steps, sigma) in [(8usize, 0.05), (18, 0.08), (40, 0.15)] {
            let base: std::collections::HashMap<String, f64> =
                live_knobs(&p.tree, sr).into_iter().collect();
            match engine.drift(&mut rng, &p.tree, &[], steps, sigma) {
                Ok(t) => {
                    let mut d: Vec<f64> = live_knobs(&t, sr)
                        .iter()
                        .map(|(a, v)| (v - base.get(a).copied().unwrap_or(*v)).abs())
                        .collect();
                    d.sort_by(f64::total_cmp);
                    let moved = d.iter().filter(|x| **x > 1e-9).count();
                    println!(
                        "{:<16} steps {steps:>2} σ {sigma:.2}: moved {moved:>2}/{:<2} max {:.2}",
                        p.name,
                        d.len(),
                        d.last().copied().unwrap_or(0.0)
                    );
                }
                Err(e) => println!(
                    "{:<16} steps {steps:>2} σ {sigma:.2}: {}",
                    p.name,
                    e.as_str()
                ),
            }
        }
    }
}
