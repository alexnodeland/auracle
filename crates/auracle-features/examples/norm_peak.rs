//! Does the audition path clip? Peak distribution of vetted, loudness-normalized
//! renders, against the ceiling and against the app's master gain.
//!
//! ```bash
//! cargo run -p auracle-features --example norm_peak --release -- 150
//! ```
//!
//! ## Why this exists
//!
//! Matching integrated loudness says nothing about the peak, and crest factor
//! spans tens of dB across this grammar. Before
//! [`loudness::PEAK_CEILING`](auracle_features::PEAK_CEILING), normalizing to a
//! target level sent percussive patches well over full scale. This harness is
//! what measured that, and it is kept because it is the only instrument that
//! reads the quantity the ceiling exists to bound:
//!
//! ```text
//!                                    before the ceiling      after
//! featurized                                144/150        144/150
//! peak p50                                    0.623          0.623
//! peak p90                                    1.061          1.000
//! peak p99                                    2.098          1.000
//! peak max                                    4.063          1.000
//! over 1.0 full scale                      22 (15%)              0
//! over 1.25 (clips at master 0.8)          11  (8%)              0
//! pulled down to clear the ceiling                —  22 (15%), mean
//!                                                    3.0 dB, worst 12.2
//! ```
//!
//! The two 22s are the same twenty-two patches, which is the internal check on
//! this table: exactly the renders that were over full scale are the ones that
//! gave up gain, and no other render moved.
//!
//! The p50 is unmoved, and that is the number to check first on any change
//! here: the ceiling is a fault stop, not a level policy, and a build where the
//! median moved is one that is quietly re-levelling the whole pool — and every
//! audio feature that is not scale-invariant with it.
//!
//! The `pulled down` line is the cost side of the trade, and it should be read
//! next to the peaks rather than on its own: it is how many patches audition
//! below `TARGET_LUFS`, and by how much, in exchange for none of them clipping.

use auracle_features::{featurize, PhraseSpec, PEAK_CEILING};
use auracle_grammar::{PatchGrammarPrior, PatchTree};
use fugue::runtime::handler::run;
use fugue::runtime::interpreters::PriorHandler;
use fugue::Trace;
use fugue_evo::inference::prior::GenomePrior;
use rand::{rngs::StdRng, SeedableRng};

/// The app's master gain (`apps/web/main.js`). Anything above `1 / MASTER`
/// clips at the output device.
const MASTER: f64 = 0.8;

fn main() {
    let n: usize = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(150);
    // Fixed: this is a regression instrument, so it has to measure the same
    // population every time it is run.
    let mut rng = StdRng::seed_from_u64(0xE05);
    let prior = PatchGrammarPrior::default();
    let spec = PhraseSpec::default();

    let mut peaks: Vec<f64> = Vec::new();
    let mut pulled: Vec<f64> = Vec::new();
    for _ in 0..n {
        let (tree, _): (PatchTree, Trace) = run(
            PriorHandler {
                rng: &mut rng,
                trace: Trace::default(),
            },
            prior.model(),
        );
        let Ok(vc) = featurize(&tree, &spec) else {
            continue; // quarantined: never auditioned, so never a peak
        };
        peaks.push(vc.render.samples.iter().fold(0.0f64, |p, s| p.max(s.abs())));
        pulled.push(vc.features.peak_reduction_db);
    }
    let ok = peaks.len();
    assert!(ok > 0, "nothing featurized");
    let mut sorted = peaks.clone();
    sorted.sort_by(f64::total_cmp);
    let q = |f: f64| sorted[((sorted.len() - 1) as f64 * f) as usize];

    println!("featurized {ok}/{n}");
    println!(
        "peak: min {:.3}  p50 {:.3}  p90 {:.3}  p99 {:.3}  max {:.3}   (ceiling {PEAK_CEILING:.2})",
        sorted[0],
        q(0.50),
        q(0.90),
        q(0.99),
        sorted[ok - 1]
    );
    let over_full = peaks.iter().filter(|p| **p > PEAK_CEILING + 1e-9).count();
    let over_master = peaks.iter().filter(|p| **p > 1.0 / MASTER).count();
    println!(
        "over ceiling: {over_full}/{ok} ({:.0}%)   over {:.2} (clips at master {MASTER}): \
         {over_master}/{ok} ({:.0}%)",
        100.0 * over_full as f64 / ok as f64,
        1.0 / MASTER,
        100.0 * over_master as f64 / ok as f64,
    );

    let n_pulled = pulled.iter().filter(|d| **d > 0.0).count();
    let worst = pulled.iter().fold(0.0f64, |m, d| m.max(*d));
    let mean_pulled = if n_pulled > 0 {
        pulled.iter().sum::<f64>() / n_pulled as f64
    } else {
        0.0
    };
    println!(
        "pulled down to clear the ceiling: {n_pulled}/{ok} ({:.0}%)  mean {mean_pulled:.1} dB  \
         worst {worst:.1} dB",
        100.0 * n_pulled as f64 / ok as f64,
    );
}
