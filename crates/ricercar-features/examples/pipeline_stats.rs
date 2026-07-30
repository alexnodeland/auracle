//! Calibration: run the featurize pipeline over many prior draws and report
//! pass/quarantine statistics plus feature ranges. Informs the vet-threshold
//! open question in DESIGN.md §6.
//!
//! ```bash
//! cargo run -p ricercar-features --example pipeline_stats --release -- 200
//! ```

use fugue::runtime::handler::run;
use fugue::runtime::interpreters::PriorHandler;
use fugue::Trace;
use fugue_evo::inference::prior::GenomePrior;
use rand::rngs::StdRng;
use rand::SeedableRng;
use ricercar_features::{featurize, Features, FeaturizeError, PhraseSpec, VetFailure};
use ricercar_grammar::PatchGrammarPrior;

fn main() {
    let n: usize = std::env::args()
        .nth(1)
        .and_then(|a| a.parse().ok())
        .unwrap_or(200);
    let spec = PhraseSpec::default();
    let prior = PatchGrammarPrior::default();
    let mut rng = StdRng::seed_from_u64(0xCA11B);

    let (mut ok, mut silent, mut over, mut dc, mut nonfinite) = (0, 0, 0, 0, 0);
    let mut phis: Vec<Vec<f64>> = Vec::new();
    for _ in 0..n {
        let (tree, _) = run(
            PriorHandler {
                rng: &mut rng,
                trace: Trace::default(),
            },
            prior.model(),
        );
        match featurize(&tree, &spec) {
            Ok(v) => {
                ok += 1;
                phis.push(v.features.phi());
            }
            Err(FeaturizeError::Quarantined(f)) => match f {
                VetFailure::Silent { .. } => silent += 1,
                VetFailure::Overlevel { .. } => over += 1,
                VetFailure::DcDominated { .. } => dc += 1,
                VetFailure::NonFinite => nonfinite += 1,
            },
            Err(e) => panic!("unexpected: {e}"),
        }
    }

    println!("prior draws:   {n}");
    println!("featurized:    {ok} ({:.0}%)", 100.0 * ok as f64 / n as f64);
    println!("quarantined:   silent={silent} overlevel={over} dc={dc} nonfinite={nonfinite}");
    println!();
    let names = Features::phi_names();
    println!("{:<16} {:>9} {:>9} {:>9}", "feature", "min", "mean", "max");
    for (i, name) in names.iter().enumerate() {
        let col: Vec<f64> = phis.iter().map(|p| p[i]).collect();
        let mean = col.iter().sum::<f64>() / col.len().max(1) as f64;
        let min = col.iter().cloned().fold(f64::INFINITY, f64::min);
        let max = col.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        println!("{name:<16} {min:>9.3} {mean:>9.3} {max:>9.3}");
    }
}
