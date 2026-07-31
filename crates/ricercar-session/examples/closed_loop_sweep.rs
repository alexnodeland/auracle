//! Seed-averaged replication of the M4 closed-loop gate across MCMC budgets.
//!
//! `closed_loop_learns_synthetic_taste` is a *single* draw from a noisy
//! process: pool lottery, duel answers and the MH chain are all seeded off
//! one `StdRng`. Comparing budgets by re-running that one test at each of
//! them compares one sample against one sample, and the seed-to-seed spread
//! of the pool/truth correlation `r` is far wider than the gap between
//! budgets — so that comparison is dominated by which seed you happened to
//! run. This harness runs the identical loop over many seeds and reports the
//! mean, the min, and how often the `r > 0.6` gate would have failed.
//!
//! ```bash
//! # default: seeds 0xE05 and 0x1..=0xC at 5k / 10k / 30k
//! cargo run -p ricercar-session --example closed_loop_sweep --release
//!
//! # fewer seeds, or specific budgets (warmup is held at 30 % of the budget)
//! cargo run -p ricercar-session --example closed_loop_sweep --release -- 8
//! cargo run -p ricercar-session --example closed_loop_sweep --release -- 13 10000
//! ```
//!
//! The default run is ~19 s wall / ~3.5 CPU-minutes on 16 cores: the seeds of
//! one budget are fanned out one thread each, so wall time is roughly the
//! slowest single run per budget.
//!
//! The loop is byte-for-byte the one in the test — pool 48, `refine_steps`
//! 0, 4 rounds × 15 duels, refit after each round, everything else default —
//! so seed `0xE05` reproduces the test's printed numbers exactly at the
//! shipped budget.

use std::thread;

use rand::rngs::StdRng;
use rand::SeedableRng;
use ricercar_features::Features;
use ricercar_grammar::PatchGrammarPrior;
use ricercar_session::{Engine, SessionConfig};
use ricercar_taste::synthetic::cosine;
use ricercar_taste::SyntheticUser;

/// The gate the test asserts on.
const R_GATE: f64 = 0.6;

/// Seeds, in the order they are consumed. `0xE05` first so a 1-seed run is
/// the test itself.
const SEEDS: [u64; 13] = [
    0xE05, 0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7, 0x8, 0x9, 0xA, 0xB, 0xC,
];

/// Same synthetic user as the test: bright, bassy, filtered, fast attack.
fn ground_truth() -> SyntheticUser {
    let names = Features::phi_names();
    let mut theta = vec![0.0; names.len()];
    let mut set = |name: &str, w: f64| {
        let i = names.iter().position(|n| *n == name).unwrap();
        theta[i] = w;
    };
    set("centroid_mean", 2.0);
    set("flatness_mean", -1.5);
    set("attack_s", -1.5);
    set("bass_fraction", 1.0);
    set("n_filter", 0.8);
    set("tail_ratio", 0.6);
    SyntheticUser {
        theta,
        tau: 0.0,
        cuts: vec![-2.0, -0.9, 0.0, 0.9, 2.0],
    }
}

fn pearson(xs: &[f64], ys: &[f64]) -> f64 {
    let n = xs.len() as f64;
    let mx = xs.iter().sum::<f64>() / n;
    let my = ys.iter().sum::<f64>() / n;
    let cov: f64 = xs.iter().zip(ys).map(|(x, y)| (x - mx) * (y - my)).sum();
    let vx: f64 = xs.iter().map(|x| (x - mx) * (x - mx)).sum();
    let vy: f64 = ys.iter().map(|y| (y - my) * (y - my)).sum();
    cov / (vx.sqrt() * vy.sqrt() + 1e-12)
}

/// One closed loop. Returns `(r, top5, mean + 0.5σ, best-lens cos)`.
fn run(seed: u64, samples: usize, warmup: usize) -> (f64, f64, f64, f64) {
    let mut rng = StdRng::seed_from_u64(seed);
    let user = ground_truth();

    let cfg = SessionConfig {
        pool_size: 48,
        refine_steps: 0,
        mcmc_samples: samples,
        mcmc_warmup: warmup,
        ..Default::default()
    };
    let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
    engine.begin_session();
    engine.fill_pool(&mut rng);

    for _ in 0..4 {
        for _ in 0..15 {
            let (a, b) = engine.next_duel(&mut rng).unwrap();
            let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
            engine.record_duel(a, b, chose_a);
        }
        engine.fit_posterior(&mut rng);
    }

    let posterior = engine.posterior.as_ref().unwrap();
    let (mut xs, mut ys) = (Vec::new(), Vec::new());
    for c in &engine.pool {
        xs.push(posterior.utility_mix(&c.phi_std).0);
        ys.push(user.utility(&c.phi_std));
    }
    let r = pearson(&xs, &ys);

    let top5: f64 = engine
        .ranked()
        .iter()
        .take(5)
        .map(|&(i, _, _)| user.utility(&engine.pool[i].phi_std))
        .sum::<f64>()
        / 5.0;
    let mean = ys.iter().sum::<f64>() / ys.len() as f64;
    let sd = (ys.iter().map(|y| (y - mean) * (y - mean)).sum::<f64>() / ys.len() as f64).sqrt();

    let cos = (0..posterior.k_styles())
        .map(|k| cosine(&posterior.theta_mean(k), &user.theta))
        .fold(f64::NEG_INFINITY, f64::max);

    (r, top5, mean + 0.5 * sd, cos)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let n_seeds = args
        .first()
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(SEEDS.len())
        .clamp(1, SEEDS.len());
    let budgets: Vec<(usize, usize)> = if args.len() > 1 {
        args[1..]
            .iter()
            .filter_map(|s| s.parse::<usize>().ok())
            // warmup is held at ~30 % of the sample budget, as in the config.
            .map(|n| (n, (n * 3 / 10).max(1)))
            .collect()
    } else {
        vec![(5_000, 2_000), (10_000, 3_000), (30_000, 10_000)]
    };

    println!("closed loop over {n_seeds} seeds; pool 48, refine 0, 4x15 duels, r gate {R_GATE}\n");

    for (samples, warmup) in budgets {
        let t0 = std::time::Instant::now();
        let rows: Vec<(u64, (f64, f64, f64, f64))> = thread::scope(|s| {
            let handles: Vec<_> = SEEDS[..n_seeds]
                .iter()
                .map(|&seed| s.spawn(move || (seed, run(seed, samples, warmup))))
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });

        let n = rows.len() as f64;
        let rs: Vec<f64> = rows.iter().map(|(_, m)| m.0).collect();
        let mean_r = rs.iter().sum::<f64>() / n;
        let min_r = rs.iter().copied().fold(f64::INFINITY, f64::min);
        let fails = rs.iter().filter(|r| **r <= R_GATE).count();
        let mean_top5 = rows.iter().map(|(_, m)| m.1).sum::<f64>() / n;
        let mean_cos = rows.iter().map(|(_, m)| m.3).sum::<f64>() / n;

        println!(
            "--- {samples}+{warmup} steps  ({:.1?} wall) ---",
            t0.elapsed()
        );
        for (seed, m) in &rows {
            println!(
                "  seed {seed:#x}: r={:.3}  top5={:.3} (vs {:.3})  cos={:.3}{}",
                m.0,
                m.1,
                m.2,
                m.3,
                if m.0 <= R_GATE {
                    "   <-- FAILS r gate"
                } else {
                    ""
                }
            );
        }
        println!(
            "  mean r={mean_r:.3}  min r={min_r:.3}  r<={R_GATE} on {fails}/{} seeds  \
             mean top5={mean_top5:.3}  mean cos={mean_cos:.3}\n",
            rows.len()
        );
    }
}
