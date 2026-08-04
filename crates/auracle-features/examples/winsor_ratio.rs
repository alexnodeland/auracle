//! How heavy can a *clean* φ column's tail be? — the measurement behind
//! `auracle_taste::standardize`'s runaway threshold.
//!
//! ```bash
//! cargo run -p auracle-features --example winsor_ratio --release
//! cargo run -p auracle-features --example winsor_ratio --release -- 150  # pools
//! ```
//!
//! `Standardizer::fit` protects a column from a single escaped value by
//! comparing its plain σ against its 2%-winsorized σ and using the winsorized
//! moments when the first is more than `RUNAWAY_RATIO` times the second. That
//! only works if no *honest* column ever reaches the threshold — and "no honest
//! column reaches it" is a claim about this feature set on this prior, not a
//! fact about statistics, so it has to be measured rather than asserted.
//!
//! It was asserted first, at 8×, on the reasoning that clean columns differ "by
//! a factor of order one". The paired evolution run caught it: 15 of 16 seeds
//! bit-identical and the sixteenth from `+0.12` to `−40.5`, because one pool had
//! a column whose tail is real.
//!
//! This fits `pools` independent 48-patch pools — the reference population
//! `Engine::refit_standardizer` actually uses — and reports the largest ratio
//! each column reached across all of them. At 150 pools (6 000 column-fits):
//!
//! ```text
//! rms_std:p2                   14.567
//! chord_flatness_delta:p2      13.853
//! flatness_mean:p2              4.304
//! rms_mean:p2                   4.080
//! n_mod_shape                   2.477
//! ```
//!
//! The two leaders are log-scale audio descriptors, and a pool that happens to
//! contain one near-silent patch genuinely has a tail on them. The maximum is
//! still climbing with the sample count (5.30 at 30 pools, 14.6 at 150), which
//! is the reason the shipped threshold is `1e6` rather than "a bit above what we
//! saw": what matters is that clean φ is O(10) and the fault it exists to catch
//! is O(10²⁹), so the constant belongs in the middle of that gap and not at the
//! edge of this table.

use auracle_features::{featurize, Features, PhraseSpec};
use auracle_grammar::PatchGrammarPrior;
use rand::rngs::StdRng;
use rand::SeedableRng;

/// The reference population `Engine::refit_standardizer` fits on.
const POOL: usize = 48;
/// Mirrors `auracle_taste::standardize`'s tail fraction.
const TAIL: f64 = 0.02;

fn winsor_k(n: usize) -> usize {
    if n < 10 {
        return 0;
    }
    (((n as f64) * TAIL).ceil() as usize).clamp(1, (n - 1) / 2)
}

fn sd(col: &[f64], clip: Option<(f64, f64)>) -> f64 {
    let at = |x: &f64| match clip {
        Some((lo, hi)) => x.clamp(lo, hi),
        None => *x,
    };
    let n = col.len() as f64;
    let m = col.iter().map(at).sum::<f64>() / n;
    (col.iter()
        .map(|x| {
            let d = at(x) - m;
            d * d
        })
        .sum::<f64>()
        / n)
        .sqrt()
}

fn main() {
    let pools: usize = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(30);
    let spec = PhraseSpec::default();
    let prior = PatchGrammarPrior::default();
    let names = Features::phi_names();
    let mut worst = vec![0.0f64; names.len()];

    for p in 0..pools {
        // A fresh RNG per pool, so the pools are independent rather than one
        // long stream cut into pieces — the quantity under test is the *worst
        // pool*, and correlated pools would understate its tail.
        let mut rng = StdRng::seed_from_u64(9_000 + p as u64);
        let mut rows: Vec<Vec<f64>> = Vec::with_capacity(POOL);
        while rows.len() < POOL {
            let t = prior.sample_with_rng(&mut rng);
            if let Ok(v) = featurize(&t, &spec) {
                rows.push(v.features.phi());
            }
        }
        for (j, w) in worst.iter_mut().enumerate() {
            let mut col: Vec<f64> = rows.iter().map(|r| r[j]).collect();
            let s = sd(&col, None);
            col.sort_by(|a, b| a.partial_cmp(b).expect("φ is finite"));
            let k = winsor_k(col.len());
            let (lo, hi) = (col[k], col[col.len() - 1 - k]);
            // `hi > lo` and `sw > 0` are the same guards the fit uses: a column
            // that is constant once clipped has no ratio to speak of.
            if hi > lo {
                let sw = sd(&col, Some((lo, hi)));
                if sw > 0.0 {
                    *w = w.max(s / sw);
                }
            }
        }
    }

    let mut v: Vec<(f64, &str)> = worst.into_iter().zip(names).collect();
    v.sort_by(|a, b| b.0.total_cmp(&a.0));
    println!("max plain-σ / winsorized-σ over {pools} clean {POOL}-patch pools:");
    for (r, n) in v.iter().take(14) {
        println!("{n:<28} {r:.3}");
    }
}
