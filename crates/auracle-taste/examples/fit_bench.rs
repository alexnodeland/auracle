//! Wall-time harness for [`TasteModel::fit`] — the fit stall, isolated.
//!
//! The fit is the app's second-largest user-facing wait (every sixth vote),
//! and its cost is dominated by **model reconstruction**, not by the
//! likelihood: fugue's single-site MH rebuilds the whole program once per MH
//! step, so the bill is `steps × sites` with the observation loop as a
//! rounding error. This harness is the instrument that claim is measured
//! with — it runs the two operating points the session layer actually visits:
//!
//! | point | K | n_obs | sites (`dK + S + (n_stars−1) + KG`) |
//! |---|---|---|---|
//! | first fit  | 1 | 6   | 33  |
//! | mature fit | 5 | 100 | 141 |
//!
//! It fits over synthetic standardized φ (no rendering, no grammar), so it
//! measures the fit and nothing else, and it is fast enough to run between
//! edits.
//!
//! ```text
//! cargo run --release -p auracle-taste --example fit_bench            # 20k/6k, the wasm budget
//! cargo run --release -p auracle-taste --example fit_bench -- 5000 1500
//! ```
//!
//! Each point prints wall time and a **draw checksum** over every f64 in the
//! posterior. The checksum is the bit-exactness gate: any change that only
//! removes work (hoisting address construction, thinning retention) must
//! leave it identical, because the model's addresses and the RNG consumption
//! order are unchanged. Only a change to the MCMC *budget* may move it.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::time::Instant;

use auracle_features::Features;
use auracle_taste::{Feedback, FitSet, Observation, ObservationLog, TasteConfig, TasteModel};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};

/// One standard normal, Box–Muller, from the seeded stream.
fn normal<R: Rng>(rng: &mut R) -> f64 {
    let (u1, u2): (f64, f64) = (rng.gen::<f64>().max(1e-12), rng.gen());
    (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
}

/// `n_obs` synthetic duels over `d`-dimensional standardized φ, answered by a
/// fixed ground-truth taste with logistic noise. Sessions cycle so the τ site
/// count matches a real multi-session log.
fn synthetic_log(seed: u64, n_obs: usize, d: usize, n_sessions: usize) -> ObservationLog {
    let mut rng = StdRng::seed_from_u64(seed);
    let names: Vec<String> = (0..d).map(|i| format!("f{i}")).collect();
    let mut theta = vec![0.0; d];
    for (i, t) in theta.iter_mut().enumerate() {
        *t = if i % 3 == 0 { 1.0 } else { -0.5 } / (1.0 + i as f64 * 0.1);
    }
    let mut log = ObservationLog::new();
    for j in 0..n_obs {
        let a: Vec<f64> = (0..d).map(|_| normal(&mut rng)).collect();
        let b: Vec<f64> = (0..d).map(|_| normal(&mut rng)).collect();
        let du: f64 = theta
            .iter()
            .zip(a.iter().zip(&b))
            .map(|(t, (x, y))| t * (x - y))
            .sum();
        let p = 1.0 / (1.0 + (-du).exp());
        let chose_a = rng.gen::<f64>() < p;
        log.push(Observation::new(
            Feedback::Duel { a, b, chose_a },
            j % n_sessions,
            &names,
        ));
    }
    log
}

/// Order-sensitive hash of every f64 in the posterior draws. Equal checksums
/// mean bit-identical draws.
fn checksum(p: &auracle_taste::TastePosterior) -> u64 {
    let mut h = DefaultHasher::new();
    p.samples.len().hash(&mut h);
    for s in &p.samples {
        for row in &s.theta {
            for v in row {
                v.to_bits().hash(&mut h);
            }
        }
        for v in s.tau.iter().chain(&s.cuts) {
            v.to_bits().hash(&mut h);
        }
    }
    h.finish()
}

fn point(label: &str, k: usize, n_obs: usize, n_sessions: usize, samples: usize, warmup: usize) {
    let d = Features::phi_names().len();
    let log = synthetic_log(0xB0A7, n_obs, d, n_sessions);
    let data = FitSet::as_is(&log);
    let cfg = TasteConfig::mixture(d, k);
    // Asked for rather than re-derived here. The site count grew a term when
    // the brightness cluster gained a fused prior (`K` latent group means),
    // and a hand-rolled formula in a benchmark is exactly the kind of thing
    // that keeps reporting the old number after the model has moved.
    let sites = auracle_taste::model::SiteAddrs::new(&cfg, data.n_sessions().max(1)).site_count();
    let model = TasteModel::new(cfg);

    let mut rng = StdRng::seed_from_u64(0xF17);
    let t0 = Instant::now();
    let posterior = model.fit(&mut rng, &data, samples, warmup);
    let dt = t0.elapsed();

    let steps = (samples + warmup) as f64;
    println!(
        "{label:<12} K={k} n_obs={n_obs:<4} sites={sites:<4} \
         fit={:>8.3}s  {:>7.1}µs/step  {:>5.2}µs/site/step  draws={:<4} checksum={:016x}",
        dt.as_secs_f64(),
        dt.as_secs_f64() * 1e6 / steps,
        dt.as_secs_f64() * 1e6 / (steps * sites as f64),
        posterior.samples.len(),
        checksum(&posterior),
    );
}

/// Recovery of a ground-truth taste at one MCMC budget, averaged over seeds.
///
/// Fitting faster is only a win if the posterior still knows the same things,
/// and the step budget is the one lever in this file that is a genuine
/// statistical trade rather than removed waste. This measures what is
/// actually traded: how well the fitted posterior orders unseen pairs
/// (held-out duel agreement with the noiseless ground-truth ordering) and how
/// well its best lens points along θ\*.
fn sweep(samples: usize, warmup: usize, k: usize, n_obs: usize, seeds: u64) {
    let d = Features::phi_names().len();
    let (mut acc_sum, mut cos_sum, mut secs) = (0.0, 0.0, 0.0);
    for seed in 0..seeds {
        let mut rng = StdRng::seed_from_u64(0x5EED + seed);
        let mut theta = vec![0.0; d];
        for (i, t) in theta.iter_mut().enumerate() {
            *t = if i % 3 == 0 { 1.0 } else { -0.5 } / (1.0 + i as f64 * 0.1);
        }
        let user = auracle_taste::SyntheticUser {
            theta,
            tau: 0.0,
            cuts: vec![-2.0, -0.9, 0.0, 0.9, 2.0],
        };
        let mut log = ObservationLog::new();
        for _ in 0..n_obs {
            let a: Vec<f64> = (0..d).map(|_| normal(&mut rng)).collect();
            let b: Vec<f64> = (0..d).map(|_| normal(&mut rng)).collect();
            let chose_a = user.duel(&mut rng, &a, &b);
            log.push(Observation::new(Feedback::Duel { a, b, chose_a }, 0, &[]));
        }
        // Held-out exam: fresh pairs, scored against the *noiseless* truth.
        let exam: Vec<(Vec<f64>, Vec<f64>)> = (0..400)
            .map(|_| {
                (
                    (0..d).map(|_| normal(&mut rng)).collect(),
                    (0..d).map(|_| normal(&mut rng)).collect(),
                )
            })
            .collect();

        let model = TasteModel::new(TasteConfig::mixture(d, k));
        let t0 = Instant::now();
        let posterior = model
            .fit(&mut rng, &FitSet::as_is(&log), samples, warmup)
            .aligned();
        secs += t0.elapsed().as_secs_f64();

        let hits = exam
            .iter()
            .filter(|(a, b)| {
                (posterior.prob_prefers(a, b) > 0.5) == (user.utility(a) > user.utility(b))
            })
            .count();
        acc_sum += hits as f64 / exam.len() as f64;
        cos_sum += (0..posterior.k_styles())
            .map(|kk| auracle_taste::synthetic::cosine(&posterior.theta_mean(kk), &user.theta))
            .fold(f64::NEG_INFINITY, f64::max);
    }
    let n = seeds as f64;
    println!(
        "budget={samples:<6}+{warmup:<5} K={k} n_obs={n_obs}  \
         heldout_acc={:.4}  best_lens_cos={:.4}  fit={:.3}s",
        acc_sum / n,
        cos_sum / n,
        secs / n,
    );
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("sweep") {
        // Recovery vs budget at the mature operating point. Warmup is held at
        // the shipped ~1:3 ratio to the sampling budget.
        let seeds = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(4);
        for &(s, w) in &[
            (30_000, 10_000),
            (20_000, 6_000),
            (10_000, 3_000),
            (8_000, 2_500),
            (6_000, 2_000),
            (5_000, 2_000),
            (3_000, 1_000),
            (2_000, 1_000),
        ] {
            sweep(s, w, 5, 100, seeds);
        }
        return;
    }
    let samples: usize = args.first().and_then(|s| s.parse().ok()).unwrap_or(20_000);
    let warmup: usize = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(6_000);
    println!(
        "mcmc_samples={samples} mcmc_warmup={warmup} ({} steps)",
        samples + warmup
    );
    point("first-fit", 1, 6, 1, samples, warmup);
    point("mature-fit", 5, 100, 1, samples, warmup);
    // Control: the mature site count with the first fit's observation count.
    // `mature-fit − split-probe` is the likelihood; `split-probe` is (almost
    // all) reconstruction. This is the reconstruction-vs-likelihood split,
    // measured rather than modelled.
    point("split-probe", 5, 6, 1, samples, warmup);
}
