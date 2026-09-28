//! What it costs to breed a generation on the render farm, measured before
//! the web half is built on it (RFC-001 §4, Plan-001 task 2).
//!
//! A generation's walks run on farm workers from a [`WalkContext`] (the
//! tilted prior, the posterior, the standardizer, the phrase) and one
//! [`WalkJob`] each. Three questions decide how the farm should carry them:
//!
//! 1. **How big is the context?** The posterior holds every thinned MCMC draw
//!    of every lens, and it crosses to each worker once per generation.
//! 2. **What does a per-worker memo lose?** In the engine every walk of a
//!    generation shares one memo; on the farm each worker has its own. The
//!    renders a shared memo saves across walks are the ones the farm repeats.
//! 3. **Would a thinned posterior do for walks?** Only if it changes no child:
//!    the surrogate averages `utility_mix` over the draws, and a different
//!    average can flip an MH acceptance.
//!
//! ```bash
//! make walk-payload   # the default run below
//! cargo run -p auracle-session --example walk_payload --release
//! # more seeds for the thinning check, or other thinning factors
//! cargo run -p auracle-session --example walk_payload --release -- 4 2 5 10
//! ```
//!
//! The engine is taught at the **shipped** config (`SessionConfig::default()`,
//! so `mcmc_samples` 10 000, `k_styles` 5, `refine_steps` 40, `refine_seeds`
//! 10) on the app's pool of 40, with 100 duels from a synthetic user so K
//! reaches its cap. The first seed also runs the generation serially on one
//! shared memo, which is the native single-thread baseline; the per-job
//! memos run one thread per job, which is the farm natively.
//!
//! ## Measured (2026-09-28, 3 seeds, a shared 4-core machine under load)
//!
//! | | |
//! |---|---|
//! | context JSON | **2.21 MB**, of which the posterior is 2.21 MB (500 draws × K 5 × d 44); standardizer 1.4 KB, prior 0.8 KB, phrase 0.3 KB; native parse 6–9 ms |
//! | one job | 0.3–2.6 KB (the seed tree) |
//! | one result | 2.0–4.1 KB (the child and its features) |
//! | memo, per job vs one shared cold memo | identical: 435 hits / 385 renders (seed 0x3a1c); walks from different seeds never revisited each other's trees |
//! | memo, against the engine's warm memo | +10 renders per generation (+2.7%), each walk's seed |
//! | a generation, 1 thread vs 10 threads | 166 s vs 79 s (2.1×, on 4 loaded cores) |
//! | thinned posterior for walks | 1/2: 27 of 30 walks return the same child; 1/5: 25 of 30 |
//!
//! So: send the context once per worker per generation (it is the whole
//! payload), keep one memo per worker (nothing is lost by it), and do **not**
//! thin the posterior for walks — at half the draws, one walk in ten already
//! lands a different child.

use std::sync::Arc;
use std::thread;
use std::time::Instant;

use auracle_features::{Features, RenderMemo};
use auracle_grammar::PatchGrammarPrior;
use auracle_session::{run_walk, Engine, SessionConfig, WalkContext, WalkJob, WalkResult};
use auracle_taste::{SyntheticUser, TastePosterior};
use rand::rngs::StdRng;
use rand::SeedableRng;

/// The app's pool (`poolSize` in `apps/web/main.js`).
const APP_POOL: usize = 40;
/// Enough duels for K to reach `k_styles` (K = 1 + n/20, capped).
const DUELS: usize = 100;

/// The synthetic user of the closed-loop gate: bright, bassy, filtered, fast.
fn ground_truth() -> SyntheticUser {
    let names = Features::phi_names();
    let mut theta = vec![0.0; names.len()];
    let mut set = |name: &str, w: f64| {
        let i = names
            .iter()
            .position(|n| n.split(':').next() == Some(name))
            .unwrap();
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

/// An engine taught at the shipped config, with its generation's jobs.
fn taught(seed: u64) -> (Engine, WalkContext, Vec<WalkJob>) {
    let mut rng = StdRng::seed_from_u64(seed);
    let user = ground_truth();
    let cfg = SessionConfig {
        pool_size: APP_POOL,
        ..Default::default()
    };
    let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
    engine.begin_session();
    engine.fill_pool(&mut rng);
    for _ in 0..DUELS {
        let (a, b) = engine.next_duel(&mut rng).unwrap();
        let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
        engine.record_duel(a, b, chose_a);
    }
    engine.fit_posterior(&mut rng);
    let (ctx, jobs) = engine.refine_jobs(&mut rng).expect("taught");
    (engine, ctx, jobs)
}

fn json_len<T: serde::Serialize>(v: &T) -> usize {
    serde_json::to_string(v).unwrap().len()
}

fn kb(n: usize) -> String {
    if n >= 1 << 20 {
        format!("{:.2} MB", n as f64 / (1 << 20) as f64)
    } else {
        format!("{:.1} KB", n as f64 / 1024.0)
    }
}

/// Every job on its own thread with its own cold memo — the farm, natively.
/// Returns the results in job order and each walk's `(hits, misses)`.
fn farm(ctx: &WalkContext, jobs: &[WalkJob]) -> Vec<(WalkResult, (u64, u64))> {
    thread::scope(|s| {
        let hs: Vec<_> = jobs
            .iter()
            .map(|job| {
                s.spawn(move || {
                    let memo = RenderMemo::default();
                    let r = run_walk(ctx, job, &memo);
                    let st = memo.stats();
                    (r, (st.hits, st.misses))
                })
            })
            .collect();
        hs.into_iter().map(|h| h.join().unwrap()).collect()
    })
}

/// The posterior with every `k`-th draw kept, weights renormalized.
fn thinned(p: &TastePosterior, k: usize) -> TastePosterior {
    let keep: Vec<usize> = (0..p.samples.len()).step_by(k).collect();
    let mut weights: Vec<f64> = keep.iter().map(|&i| p.weight(i)).collect();
    let total: f64 = weights.iter().sum();
    weights.iter_mut().for_each(|w| *w /= total);
    TastePosterior {
        cfg: p.cfg.clone(),
        samples: keep.iter().map(|&i| p.samples[i].clone()).collect(),
        weights,
    }
}

fn same_walk(a: &WalkResult, b: &WalkResult) -> bool {
    a.child == b.child && a.reason == b.reason
}

fn main() {
    let args: Vec<usize> = std::env::args()
        .skip(1)
        .filter_map(|s| s.parse().ok())
        .collect();
    let n_seeds = args.first().copied().unwrap_or(3).max(1);
    let thins: Vec<usize> = if args.len() > 1 {
        args[1..].to_vec()
    } else {
        vec![2, 5]
    };
    let seeds: Vec<u64> = (0..n_seeds as u64).map(|i| 0x3A1C + i).collect();

    let mut thin_same = vec![(0usize, 0usize); thins.len()];
    for (si, &seed) in seeds.iter().enumerate() {
        let t0 = Instant::now();
        let (engine, ctx, jobs) = taught(seed);
        let p = &ctx.posterior;
        println!(
            "=== seed {seed:#x}: pool {}, {} observations, K = {}, {} draws of d = {} \
             (taught in {:.1?}) ===",
            engine.pool.len(),
            engine.log.len(),
            p.k_styles(),
            p.samples.len(),
            p.samples[0].theta[0].len(),
            t0.elapsed()
        );

        // ---- 1. payload ----
        let ctx_json = serde_json::to_string(&ctx).unwrap();
        let t = Instant::now();
        let back: WalkContext = serde_json::from_str(&ctx_json).unwrap();
        let parse = t.elapsed();
        assert_eq!(back.posterior.samples.len(), p.samples.len());
        let job_lens: Vec<usize> = jobs.iter().map(json_len).collect();
        println!(
            "context {}  (posterior {}, standardizer {}, prior {}, phrase {}); native parse {parse:.1?}",
            kb(ctx_json.len()),
            kb(json_len(&*ctx.posterior)),
            kb(json_len(&*ctx.standardizer)),
            kb(json_len(&ctx.prior)),
            kb(json_len(&ctx.phrase)),
        );
        println!(
            "jobs    {} × {} .. {} (mean {})",
            jobs.len(),
            kb(*job_lens.iter().min().unwrap()),
            kb(*job_lens.iter().max().unwrap()),
            kb(job_lens.iter().sum::<usize>() / jobs.len()),
        );

        // ---- 2. memo: one per job (the farm) against one shared ----
        let t = Instant::now();
        let farmed = farm(&ctx, &jobs);
        let farm_wall = t.elapsed();
        let (fh, fm) = farmed
            .iter()
            .fold((0, 0), |(h, m), (_, (a, b))| (h + a, m + b));
        let result_lens: Vec<usize> = farmed.iter().map(|(r, _)| json_len(r)).collect();
        let children = farmed.iter().filter(|(r, _)| r.child.is_some()).count();
        println!(
            "results {} children of {}; result JSON {} .. {}",
            children,
            jobs.len(),
            kb(*result_lens.iter().min().unwrap()),
            kb(*result_lens.iter().max().unwrap()),
        );
        println!(
            "per-job memos : {fh} hits / {fm} renders ({:.1}% hit)  — {} threads, {farm_wall:.1?} wall",
            100.0 * fh as f64 / (fh + fm) as f64,
            jobs.len()
        );
        if si == 0 {
            let shared = RenderMemo::default();
            let t = Instant::now();
            let serial: Vec<WalkResult> = jobs.iter().map(|j| run_walk(&ctx, j, &shared)).collect();
            let serial_wall = t.elapsed();
            let st = shared.stats();
            println!(
                "one shared    : {} hits / {} renders ({:.1}% hit)  — 1 thread, {serial_wall:.1?} wall",
                st.hits,
                st.misses,
                100.0 * st.hits as f64 / (st.hits + st.misses) as f64
            );
            println!(
                "  per-job memos render {} more than one shared cold memo ({:+.1}%): the \
                 cross-walk hits a shared memo buys",
                fm as i64 - st.misses as i64,
                100.0 * (fm as f64 / st.misses as f64 - 1.0),
            );
            // Not run, derived: the engine's own memo already holds every pool
            // member, and a walk's first render is its seed.
            println!(
                "  against the engine's warm memo the farm also re-renders each walk's seed: \
                 +{} ({:+.1}%)",
                jobs.len(),
                100.0 * jobs.len() as f64 / (st.misses as f64 - jobs.len() as f64),
            );
            println!(
                "  native speed-up with one thread per job: {:.2}×",
                serial_wall.as_secs_f64() / farm_wall.as_secs_f64()
            );
            for (a, (b, _)) in serial.iter().zip(&farmed) {
                assert!(same_walk(a, b), "a memo changed a walk");
            }
        }

        // ---- 3. would a thinned posterior do? ----
        for (ti, &k) in thins.iter().enumerate() {
            let thin_ctx = WalkContext {
                posterior: Arc::new(thinned(p, k)),
                ..ctx.clone()
            };
            let thin = farm(&thin_ctx, &jobs);
            let same = thin
                .iter()
                .zip(&farmed)
                .filter(|((a, _), (b, _))| same_walk(a, b))
                .count();
            thin_same[ti].0 += same;
            thin_same[ti].1 += jobs.len();
            println!(
                "thin 1/{k:<2}: context {}; {same}/{} walks return the same child",
                kb(json_len(&thin_ctx)),
                jobs.len()
            );
        }
        println!();
    }
    println!("=== thinning over {n_seeds} seeds ===");
    for (&k, (same, n)) in thins.iter().zip(&thin_same) {
        println!("thin 1/{k:<2}: {same}/{n} walks unchanged");
    }
}
