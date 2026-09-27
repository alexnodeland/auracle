//! Can a named control that the knobs cannot reach be given something to
//! turn, without changing the sound?
//!
//! For every preset, wire the six controls as PERFORM does. For each of
//! Bright, Body and Space that comes out a search control, apply PERFORM's
//! graft (`perform::graft_for`: a neutral EQ on the output for Bright and
//! Body, a longer amp release for Space) and report two things:
//!
//! * `|Δz|` — how far the graft alone moved the sound, as the norm of the
//!   standardized audio-φ change. A graft that is not transparent is a patch
//!   change the player did not ask for.
//! * whether the control is reachable on the grafted patch (verified at ±½
//!   and ±1, the same gate as everywhere else), and which halves.
//!
//! cargo run -p auracle-session --example perform_inserts --release -- [seed]
use auracle_features::featurize;
use auracle_grammar::preset_bank;
use auracle_grammar::PatchGrammarPrior;
use auracle_session::perform::{self, CONTROLS};
use auracle_session::{Engine, SessionConfig};
use rand::SeedableRng;

fn main() {
    let seed: u64 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(7);
    let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
    let mut engine = Engine::new(PatchGrammarPrior::default(), SessionConfig::default());
    engine.begin_session();
    engine.fill_pool(&mut rng);
    let spec = engine.cfg.phrase.clone();
    let std = engine.standardizer().expect("filled pool").clone();
    let z = |t: &auracle_grammar::PatchTree| -> Option<Vec<f64>> {
        let v = featurize(t, &spec).ok()?;
        let n = v.features.audio.to_vec().len();
        Some(std.transform(&v.features.phi())[..n].to_vec())
    };
    let mut tried = [0usize; 6];
    let mut opened = [0usize; 6];
    let mut dz_all: Vec<f64> = Vec::new();
    for p in preset_bank() {
        let Some((_, wiring)) = engine.wire_controls(&p.tree) else {
            continue;
        };
        let Some(z0) = z(&p.tree) else { continue };
        let mut line = Vec::new();
        for (k, w) in wiring.iter().enumerate() {
            if !w.search {
                continue;
            }
            let Some(t2) = perform::graft_for(&p.tree, k) else {
                continue;
            };
            tried[k] += 1;
            let Some(z2) = z(&t2) else {
                line.push(format!("{} no-vet", w.name));
                continue;
            };
            let dz = z0
                .iter()
                .zip(&z2)
                .map(|(a, b)| (a - b).powi(2))
                .sum::<f64>()
                .sqrt();
            dz_all.push(dz);
            let Some((_, w2)) = engine.wire_controls(&t2) else {
                continue;
            };
            let (lo, hi) = w2[k].range();
            if !w2[k].search {
                opened[k] += 1;
            }
            line.push(format!(
                "{} |Δz| {dz:.2} → {}",
                w.name,
                if w2[k].search {
                    "still search".to_string()
                } else {
                    format!(
                        "open [{lo:+.0},{hi:+.0}] pur {:.2} reach {:.2}",
                        w2[k].purity, w2[k].reach
                    )
                }
            ));
        }
        if !line.is_empty() {
            println!("{:<18} {}", p.name, line.join(" · "));
        }
    }
    println!();
    for k in [0, 3, 5] {
        println!("{:<7} opened {}/{}", CONTROLS[k].name, opened[k], tried[k]);
    }
    dz_all.sort_by(f64::total_cmp);
    if !dz_all.is_empty() {
        println!(
            "graft |Δz|: median {:.3}, p90 {:.3}, max {:.3}",
            dz_all[dz_all.len() / 2],
            dz_all[dz_all.len() * 9 / 10],
            dz_all[dz_all.len() - 1]
        );
    }
}
