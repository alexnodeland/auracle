//! Watch the synth learn a fake user's taste in fast-forward (the reference:
//! *Milestones*), and **measure the acquisition function** against its
//! alternatives.
//!
//! A synthetic user who likes bright, bassy, filtered, fast-attack patches
//! answers duels; between rounds the posterior re-fits and the pool re-ranks.
//!
//! ```bash
//! # the demo: one run, printed per round          (~1 min)
//! cargo run -p auracle-session --example learn_synthetic --release
//!
//! # the acquisition A/B: 3 rules x 20 seeds x 2 regimes       (roughly 2x that, since it now runs two regimes on 16 cores;
//! cargo run -p auracle-session --example learn_synthetic --release -- --compare
//! #                                                 ~19 CPU-minutes, fanned
//! #                                                 out one thread per run)
//!
//! # more seeds if you want tighter error bars     (scales linearly)
//! cargo run -p auracle-session --example learn_synthetic --release -- --compare 20
//! ```
//!
//! Runtimes are wall-clock on a 16-core machine and are dominated by MCMC:
//! each run is `ROUNDS` full posterior fits, and `--compare N` does
//! `3 · N · ROUNDS` of them. Every number in [`Acquisition`]'s doc table came
//! from `--compare 10`; re-running it reproduces them exactly, since the only
//! randomness is seeded.
//!
//! [`Acquisition`]: auracle_session::Acquisition
//!
//! ## What `--compare` measures, and why it measures it three ways
//!
//! Whether an information-seeking acquisition function beats a best-arm one
//! *for learning taste* is an empirical claim, so it is measured here rather
//! than asserted in a doc comment. Each rule is run on the **same pool** from
//! the **same seed**, so every comparison is paired and the pool lottery
//! cancels.
//!
//! One metric is not enough, because the three rules optimize different
//! things and the honest question is which difference the user actually
//! feels:
//!
//! - **cos θ\*** — cosine between the best style lens and the true θ. What the
//!   model learned about taste *direction*. Drives the grammar proposal tilt
//!   and the taste map, and the user never sees it directly.
//! - **rank r** — Pearson correlation between posterior utility and true
//!   utility over the pool. How well the bank is ordered — this one the user
//!   sees on every screen.
//! - **excess nats** — mean `KL(p* ‖ p_model)` over *all* C(n,2) pool pairs,
//!   where `p*` is the user's true Bradley–Terry probability. Predictive
//!   error with the irreducible noise floor subtracted, so 0 is a perfect
//!   model. Lower is better.
//!
//! That last one is deliberately **not** the prequential log-loss over the
//! duels each rule chose for itself. Those are not comparable across rules:
//! BALD *deliberately* selects pairs near p = 0.5, which carry the highest
//! log-loss by construction, so scoring each rule on its own question set
//! would penalize exactly the behaviour that makes it informative. Scoring
//! every rule on the same exhaustive, unbiased pair set removes that
//! confound. (`Engine::calibration` reports the prequential number for the
//! UI, where the check duels are the unbiased subsample.)
use auracle_features::Features;
use auracle_grammar::PatchGrammarPrior;
use auracle_session::{Acquisition, Engine, SessionConfig};
use auracle_taste::synthetic::cosine;
use auracle_taste::{Standardizer, SyntheticUser};
use rand::rngs::StdRng;
use rand::SeedableRng;

fn pearson(xs: &[f64], ys: &[f64]) -> f64 {
    let n = xs.len() as f64;
    let mx = xs.iter().sum::<f64>() / n;
    let my = ys.iter().sum::<f64>() / n;
    let cov: f64 = xs.iter().zip(ys).map(|(x, y)| (x - mx) * (y - my)).sum();
    let vx: f64 = xs.iter().map(|x| (x - mx) * (x - mx)).sum();
    let vy: f64 = ys.iter().map(|y| (y - my) * (y - my)).sum();
    cov / (vx.sqrt() * vy.sqrt() + 1e-12)
}

fn ground_truth() -> SyntheticUser {
    let names = Features::phi_names();
    let mut theta = vec![0.0; names.len()];
    for (name, w) in [
        ("centroid_mean", 2.0),
        ("flatness_mean", -1.5),
        ("attack_s", -1.5),
        ("bass_fraction", 1.0),
        ("n_filter", 0.8),
        ("tail_ratio", 0.6),
    ] {
        // Base-name match: audio names carry a stimulus tag (`:p2`).
        theta[names
            .iter()
            .position(|n| n.split(':').next() == Some(name))
            .unwrap()] = w;
    }
    SyntheticUser {
        theta,
        tau: 0.0,
        cuts: vec![-2.0, -0.9, 0.0, 0.9, 2.0],
    }
}

/// Best cosine between θ* and any style lens of the fitted posterior. With a
/// unimodal user the taste spreads over several lenses as K grows, so the
/// *best* lens is the fair readout of "did it find the direction".
fn theta_recovery(engine: &Engine, user: &SyntheticUser) -> f64 {
    match &engine.posterior {
        Some(p) => (0..p.k_styles())
            .map(|k| cosine(&p.theta_mean(k), &user.theta))
            .fold(f64::NEG_INFINITY, f64::max),
        None => 0.0,
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--compare") {
        let n = args
            .get(i + 1)
            .and_then(|a| a.parse::<usize>().ok())
            .unwrap_or(20);
        if let Some(j) = args.iter().position(|a| a == "--pool") {
            if let Some(p) = args.get(j + 1).and_then(|a| a.parse::<usize>().ok()) {
                POOL.store(p, std::sync::atomic::Ordering::Relaxed);
            }
        }
        compare(n.max(2));
        return;
    }
    let mut rng = StdRng::seed_from_u64(0xFAB);
    let user = ground_truth();
    println!("synthetic user: bright, bassy, filtered, fast attack, long tails\n");

    let mut engine = Engine::new(
        PatchGrammarPrior::default(),
        SessionConfig {
            pool_size: 48,
            ..Default::default()
        },
    );
    engine.begin_session();
    print!("rendering + vetting candidate pool… ");
    engine.fill_pool(&mut rng);
    println!("{} vetted candidates\n", engine.pool.len());

    for round in 1..=5 {
        for _ in 0..12 {
            let (a, b) = engine.next_duel(&mut rng).unwrap();
            let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
            engine.record_duel(a, b, chose_a);
        }
        engine.fit_posterior(&mut rng);

        let posterior = engine.posterior.as_ref().unwrap();
        let (mut xs, mut ys) = (Vec::new(), Vec::new());
        for c in &engine.pool {
            xs.push(posterior.utility_mix(&c.phi_std).0);
            ys.push(user.utility(&c.phi_std));
        }
        let r = pearson(&xs, &ys);
        let cal = engine.calibration();
        let ranked = engine.ranked();
        let (top, tm, ts) = ranked[0];
        println!(
            "round {round}: {:>3} duels | model↔truth r = {r:.2} | cos θ* = {:.2} | \
             Brier skill = {:+.3} | top: u = {tm:.2}±{ts:.2}",
            engine.log.len(),
            theta_recovery(&engine, &user),
            cal.skill,
        );
        let names = engine.display_names();
        println!(
            "         {}  ({})",
            names[&engine.pool[top].id],
            engine.pool[top].tree.signature()
        );
    }

    println!("\nfinal top 3 in the user's learned taste:");
    let names = engine.display_names();
    for &(i, m, s) in engine.ranked().iter().take(3) {
        println!(
            "  u = {m:5.2} ± {s:.2}  {:<18} {}",
            names[&engine.pool[i].id],
            engine.pool[i].tree.signature()
        );
    }
    if let Some(e) = engine.explain(engine.pool[engine.ranked()[0].0].id) {
        println!("\nwhy the top patch, under lens {}:", e.style);
        for c in e.contributions.iter().take(4) {
            println!("  {:>+6.3}  {}", c.contribution, c.name);
        }
    }
}

/// Rounds of duels between refits, and how many rounds — the A/B grid.
const ROUND_SIZE: usize = 12;
const ROUNDS: usize = 6;
/// Pool size for the A/B. Overridable so the "a bigger pair space favours
/// information-seeking" hypothesis can actually be tested rather than assumed.
static POOL: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(48);

fn sigmoid(x: f64) -> f64 {
    1.0 / (1.0 + (-x).exp())
}

/// Which pool regime an arm is measured in.
///
/// This distinction is the whole point of the second version of this study.
/// The first ran only `Static` and concluded that uniform pairing ties an
/// information-seeking rule — in the one regime where that was very nearly a
/// foregone conclusion. A pool of i.i.d. prior draws is spread uniformly over
/// feature space *by construction*, so uniform pairs already achieve near
/// optimal `‖φ_a − φ_b‖` coverage and there is no redundancy for an
/// information-seeking rule to prune. Measuring there and shipping the answer
/// was measuring the easy case and generalizing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Regime {
    /// Pool frozen at its initial i.i.d. prior draws.
    Static,
    /// Refinement runs between rounds, so the pool concentrates around the
    /// current best the way the shipped product's does — children are injected
    /// near the frontier and `insert_candidate` evicts the worst.
    Evolving,
}

/// The readouts of one finished run.
#[derive(Clone, Copy)]
struct ArmResult {
    cos: f64,
    rank_r: f64,
    excess_nats: f64,
    /// Mean pairwise `‖φ_a − φ_b‖` over the final pool, in reference-
    /// standardized space. Reported as a **manipulation check**: if the
    /// evolving arm's pool is no tighter than the static arm's, then the
    /// regime this study exists to create was never created, and its
    /// comparison means nothing.
    pool_spread: f64,
}

/// The fixed evaluation set for one seed: raw φ of the initial i.i.d. pool,
/// plus a reference standardizer fit on it.
///
/// Scoring each arm on *its own* final pool — what the first version did —
/// stops being comparable the moment pools are allowed to diverge, because
/// every arm is then graded on a different exam. Worse, the synthetic user's
/// θ\* lives in standardized space, so an arm that built a different pool also
/// gets a different standardizer and therefore a different notion of "true
/// utility". Both problems go away by grading everyone on one fixed set under
/// one fixed standardizer.
struct Eval {
    raw: Vec<Vec<f64>>,
    reference: Standardizer,
}

impl Eval {
    fn new(raw: Vec<Vec<f64>>) -> Self {
        let reference = Standardizer::fit(&raw);
        Self { raw, reference }
    }
}

fn run_arm(acquisition: Acquisition, regime: Regime, seed: u64, user: &SyntheticUser) -> ArmResult {
    let mut pool_rng = StdRng::seed_from_u64(seed);
    let mut acq_rng = StdRng::seed_from_u64(seed ^ 0xAC0_1500);
    let evolving = regime == Regime::Evolving;
    let mut engine = Engine::new(
        PatchGrammarPrior::default(),
        SessionConfig {
            pool_size: POOL.load(std::sync::atomic::Ordering::Relaxed),
            acquisition,
            // The regime under test. `Static` freezes the pool at its i.i.d.
            // draws; `Evolving` lets refinement concentrate it.
            refine_steps: if evolving { 12 } else { 0 },
            // Check duels exist to de-bias calibration, not to learn; they
            // would hand the same free exploration to every arm and blur the
            // comparison.
            duel_check_every: 0,
            // A slightly cheaper chain than the shipped default. This study
            // needs 3 rules x 2 regimes x N seeds x ROUNDS fits; the gap used
            // to be large (8k against a shipped 30k) because at full budget
            // the study did not finish in a usable time. The default is now
            // 10k/3k, so this is a 1.25x trim rather than a different regime.
            // Every arm pays exactly the same budget and the readout is a
            // *paired difference*, so the comparison is unaffected either
            // way; only the absolute recovery numbers move.
            mcmc_samples: 8_000,
            mcmc_warmup: 2_500,
            ..Default::default()
        },
    );
    engine.begin_session();
    engine.fill_pool(&mut pool_rng);

    // Snapshot the starting pool as the shared exam before anything moves it.
    let eval = Eval::new(engine.pool.iter().map(|c| c.features.phi()).collect());

    let mut t = 0u64;
    for round in 0..ROUNDS {
        for _ in 0..ROUND_SIZE {
            let Some((a, b)) = engine.next_duel(&mut acq_rng) else {
                break;
            };
            // The user's luck at duel t is the same draw in every arm.
            let mut user_rng = StdRng::seed_from_u64(seed ^ 0x115E_0000 ^ t);
            // The synthetic user answers through the **reference** basis, not
            // the arm's own standardizer.
            //
            // Under `Static` these coincide — the pool is frozen and common, so
            // every arm fits the same standardizer — but under `Evolving` the
            // pools diverge by construction, which is the entire point of the
            // regime. Reading `phi_std` there would give each arm a *different*
            // ground-truth user, and directionally so: an arm that concentrates
            // its pool gets a smaller sigma, which inflates z-scores, which
            // inflates |Δu*|, which makes its own training labels less noisy —
            // an advantage with nothing to do with acquisition quality. Grading
            // on a fixed exam removes that from the scoring but not from the
            // training signal, so it has to be removed here.
            let chose_a = user.duel(
                &mut user_rng,
                &eval.reference.transform(&engine.pool[a].features.phi()),
                &eval.reference.transform(&engine.pool[b].features.phi()),
            );
            engine.record_duel(a, b, chose_a);
            t += 1;
        }
        let mut fit_rng = StdRng::seed_from_u64(seed ^ 0xF17_0000 ^ round as u64);
        engine.fit_posterior(&mut fit_rng);
        if evolving {
            // Refinement's own randomness is common across arms; which
            // candidates it produces is not, because it is driven by the
            // posterior the arm's own duels built. That difference is part of
            // what acquisition does, not noise to be cancelled.
            let mut refine_rng = StdRng::seed_from_u64(seed ^ 0x8EF1_0000 ^ round as u64);
            engine.refine(&mut refine_rng);
        }
    }

    let posterior = engine.posterior.as_ref().expect("fitted");
    let arm_sz = engine.standardizer.as_ref().expect("standardizer");

    // Grade on the shared exam: the model reads it through its own
    // standardizer, the ground truth through the reference one.
    let arm_phis: Vec<Vec<f64>> = eval.raw.iter().map(|r| arm_sz.transform(r)).collect();
    let true_phis: Vec<Vec<f64>> = eval
        .raw
        .iter()
        .map(|r| eval.reference.transform(r))
        .collect();

    let (mut xs, mut ys) = (Vec::new(), Vec::new());
    for (a, t) in arm_phis.iter().zip(&true_phis) {
        xs.push(posterior.utility_mix(a).0);
        ys.push(user.utility(t));
    }

    // Exhaustive over eval pairs: deterministic given the run, so all the
    // spread in this number is the run's, not the evaluation's.
    let (mut cross, mut floor, mut n) = (0.0, 0.0, 0usize);
    for i in 0..arm_phis.len() {
        for j in (i + 1)..arm_phis.len() {
            let p_star = sigmoid(user.utility(&true_phis[i]) - user.utility(&true_phis[j]));
            let p_hat = posterior
                .prob_prefers(&arm_phis[i], &arm_phis[j])
                .clamp(1e-9, 1.0 - 1e-9);
            cross += -(p_star * p_hat.ln() + (1.0 - p_star) * (1.0 - p_hat).ln());
            let ps = p_star.clamp(1e-9, 1.0 - 1e-9);
            floor += -(ps * ps.ln() + (1.0 - ps) * (1.0 - ps).ln());
            n += 1;
        }
    }
    let n = n.max(1) as f64;

    // θ recovery, with the arm's θ mapped into the reference basis first.
    // Both standardizers are diagonal affine maps of the same raw features, so
    // `θ_ref[i] = θ_arm[i] · s_ref[i] / s_arm[i]` is exact, not an
    // approximation — without it the cosine compares vectors expressed in two
    // different bases and quietly means nothing.
    let cos = (0..posterior.k_styles())
        .map(|k| {
            let theta: Vec<f64> = posterior
                .theta_mean(k)
                .iter()
                .enumerate()
                .map(|(i, t)| t * eval.reference.std[i] / arm_sz.std[i])
                .collect();
            cosine(&theta, &user.theta)
        })
        .fold(f64::NEG_INFINITY, f64::max);

    // Manipulation check: how spread is the pool we ended up with?
    let final_phis: Vec<Vec<f64>> = engine
        .pool
        .iter()
        .map(|c| eval.reference.transform(&c.features.phi()))
        .collect();
    let (mut dsum, mut dn) = (0.0, 0usize);
    for i in 0..final_phis.len() {
        for j in (i + 1)..final_phis.len() {
            let d: f64 = final_phis[i]
                .iter()
                .zip(&final_phis[j])
                .map(|(a, b)| (a - b) * (a - b))
                .sum();
            dsum += d.sqrt();
            dn += 1;
        }
    }

    ArmResult {
        cos,
        rank_r: pearson(&xs, &ys),
        excess_nats: (cross - floor) / n,
        pool_spread: dsum / dn.max(1) as f64,
    }
}

fn mean(v: &[f64]) -> f64 {
    v.iter().sum::<f64>() / v.len().max(1) as f64
}

fn sd(v: &[f64]) -> f64 {
    if v.len() < 2 {
        return 0.0;
    }
    let m = mean(v);
    (v.iter().map(|x| (x - m) * (x - m)).sum::<f64>() / (v.len() - 1) as f64).sqrt()
}

/// Paired difference `a − b`, with the standard error of that difference.
/// Paired because both arms ran on the same seed, hence the same pool: the
/// pool lottery is the dominant nuisance term and pairing removes it.
fn paired(a: &[f64], b: &[f64]) -> (f64, f64) {
    let d: Vec<f64> = a.iter().zip(b).map(|(x, y)| x - y).collect();
    (mean(&d), sd(&d) / (d.len().max(1) as f64).sqrt())
}

fn verdict(diff: f64, se: f64, higher_is_better: bool) -> String {
    if se <= 0.0 {
        return "—".into();
    }
    let t = diff / se;
    if t.abs() < 2.0 {
        format!("{diff:+.3} ± {:.3}  inside noise", 2.0 * se)
    } else {
        let better = (diff > 0.0) == higher_is_better;
        format!(
            "{diff:+.3} ± {:.3}  {} (t = {t:.1})",
            2.0 * se,
            if better { "BETTER" } else { "WORSE" }
        )
    }
}

/// A named readout: how to pull it off a result, and which direction is good.
type Metric = (&'static str, bool, fn(&ArmResult) -> f64);

fn compare(n_seeds: usize) {
    let user = ground_truth();
    let seeds: Vec<u64> = (0..n_seeds).map(|i| 0xE05 + i as u64 * 7919).collect();
    let arms = [
        ("random", Acquisition::Random),
        ("thompson", Acquisition::Thompson),
        ("bald", Acquisition::Bald),
    ];
    let regimes = [Regime::Static, Regime::Evolving];

    println!(
        "acquisition A/B — {n_seeds} CRN-paired seeds, pool {}, {} duels, refit every {ROUND_SIZE}",
        POOL.load(std::sync::atomic::Ordering::Relaxed),
        ROUNDS * ROUND_SIZE
    );
    println!("(pool fill, user coin flips, MCMC and refinement seeds are common across arms)");
    println!("(graded on a fixed held-out exam: the initial pool, under one reference scale)\n");

    // One job per (regime, arm, seed); they are independent, so fan them out.
    let mut jobs: Vec<(usize, usize, usize)> = Vec::new();
    for g in 0..regimes.len() {
        for a in 0..arms.len() {
            for s in 0..seeds.len() {
                jobs.push((g, a, s));
            }
        }
    }
    let next = std::sync::atomic::AtomicUsize::new(0);
    let out: Vec<std::sync::Mutex<Option<ArmResult>>> = (0..jobs.len())
        .map(|_| std::sync::Mutex::new(None))
        .collect();
    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(jobs.len());
    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| loop {
                let k = next.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                if k >= jobs.len() {
                    break;
                }
                let (g, a, s) = jobs[k];
                let r = run_arm(arms[a].1, regimes[g], seeds[s], &user);
                *out[k].lock().unwrap() = Some(r);
            });
        }
    });
    let results: Vec<ArmResult> = out
        .into_iter()
        .map(|m| m.into_inner().unwrap().expect("job ran"))
        .collect();
    let idx = |g: usize, a: usize, s: usize| (g * arms.len() + a) * seeds.len() + s;

    let metrics: [Metric; 3] = [
        ("cos θ*  (higher better)", true, |r| r.cos),
        ("rank r  (higher better)", true, |r| r.rank_r),
        ("excess nats (lower better)", false, |r| r.excess_nats),
    ];

    for (g, regime) in regimes.iter().enumerate() {
        println!("════════ {regime:?} pool ════════");
        // Manipulation check first: if this did not move, nothing below it
        // about "the concentrated regime" is entitled to be believed.
        let spread: Vec<f64> = (0..arms.len())
            .map(|a| {
                mean(
                    &(0..seeds.len())
                        .map(|s| results[idx(g, a, s)].pool_spread)
                        .collect::<Vec<_>>(),
                )
            })
            .collect();
        println!(
            "  pool spread (mean pairwise ‖Δφ‖): random {:.2}  thompson {:.2}  bald {:.2}",
            spread[0], spread[1], spread[2]
        );

        for (title, higher_better, f) in metrics {
            println!("  ── {title} ──");
            let mut cols: Vec<Vec<f64>> = Vec::new();
            for (a, (label, _)) in arms.iter().enumerate() {
                let col: Vec<f64> = (0..seeds.len())
                    .map(|s| f(&results[idx(g, a, s)]))
                    .collect();
                println!(
                    "  {label:<10} mean {:>7.3}   sd {:>6.3}",
                    mean(&col),
                    sd(&col)
                );
                cols.push(col);
            }
            let (d_tr, se_tr) = paired(&cols[2], &cols[1]);
            let (d_rr, se_rr) = paired(&cols[2], &cols[0]);
            println!(
                "    bald − thompson : {}",
                verdict(d_tr, se_tr, higher_better)
            );
            println!(
                "    bald − random   : {}",
                verdict(d_rr, se_rr, higher_better)
            );
        }
        println!();
    }

    // The comparison that motivated the second study: does the gap between
    // bald and random change when the pool stops being i.i.d.?
    println!("════════ does the regime change the answer? ════════");
    for (title, higher_better, f) in metrics {
        let gap = |g: usize| -> (f64, f64) {
            let b: Vec<f64> = (0..seeds.len())
                .map(|s| f(&results[idx(g, 2, s)]))
                .collect();
            let r: Vec<f64> = (0..seeds.len())
                .map(|s| f(&results[idx(g, 0, s)]))
                .collect();
            paired(&b, &r)
        };
        let (ds, ses) = gap(0);
        let (de, see) = gap(1);
        println!("  {title}");
        println!(
            "    static   bald − random : {}",
            verdict(ds, ses, higher_better)
        );
        println!(
            "    evolving bald − random : {}",
            verdict(de, see, higher_better)
        );
    }
}
