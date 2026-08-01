//! Does the search still *search*? Three measurements the closed-loop gate
//! does not make, because it runs with `refine_steps: 0`.
//!
//! `closed_loop_sweep` measures whether the taste model **learns**. This
//! measures whether the evolutionary half **improves things** once it has
//! something to aim at — which is the other half of the product, and the half
//! a palette expansion is most likely to break: every extra operator widens
//! the structural categorical the MH kernel proposes from, and every extra
//! modulation slot adds sites the kernel must share its single-site budget
//! across.
//!
//! ```bash
//! cargo run -p ricercar-session --example search_health --release
//! cargo run -p ricercar-session --example search_health --release -- 8   # seeds
//! cargo run -p ricercar-session --example search_health --release -- --budget-ab
//! ```
//!
//! ## 1. Does the pool climb?
//!
//! Fill a pool, teach the model with synthetic duels, then run real
//! `Engine::refine` generations, reporting the pool's **mean and max true
//! utility** (the synthetic user's, not the model's) after each. The user is
//! never shown to the search — it only ever sees the posterior — so a climb
//! here is the surrogate doing its job end to end.
//!
//! ## 2. Where do the MH proposals go?
//!
//! `fugue_evo::inference::mh::EvolutionChain::step` returns `(genome, trace)`
//! and **exposes neither an acceptance flag nor which site it targeted**, so
//! nothing here is read off the API. What can be recovered, and how much
//! each number is worth, differs by quantity — stated separately rather than
//! blurred into one "acceptance rate", because two of the three are exact and
//! one is an estimate:
//!
//! - **Overall acceptance — exact.** `adaptive_single_site_mh` returns the
//!   *current* trace unchanged on rejection, so "some choice differs" is
//!   acceptance and nothing else is.
//! - **Structural share of accepted moves — exact.** An accepted move is
//!   structural when it changed the address *set* (reversible jump: a new
//!   subtree's sites appear, an old subtree's disappear) or moved a `#leaf`,
//!   `#src`, `#op` or `#mod` site.
//! - **Per-class acceptance rates — estimated, and they have to be.** A
//!   *rejected* proposal leaves no trace of which site it targeted; diffing
//!   cannot tell a rejected structural move from a rejected parameter one,
//!   and an earlier version of this harness that pretended otherwise reported
//!   structural acceptance as a flat 100%, which is a tautology of the
//!   classifier and not a fact about the chain. The kernel does document that
//!   it picks the target site **uniformly over all sites**, so the expected
//!   number of structural proposals is `Σ_steps (structural sites / all
//!   sites)` on the trace as it stood at that step, and dividing the exact
//!   accepted count by that expectation gives the rate. It is an estimate of
//!   a ratio whose denominator is a mean, so read it to one significant
//!   figure.
//!
//! The split matters because they do different work: parameter moves polish a
//! topology, structural moves find a different one, and a palette expansion
//! can starve the second without touching the first.
//!
//! ## 3. Does locked refinement still land?
//!
//! `Engine::refine_from` with locks is the app's "⚡ evolve from this" button.
//! Reported as two rates — one that saturates and one that does not; see
//! [`refine_hits`]. Run at half, one, two and four times the shipped budget,
//! so "20 steps is not enough" is a statement with a number attached rather
//! than a feeling.

use std::collections::HashSet;
use std::sync::Arc;

use fugue::Trace;
use fugue_evo::genome::trace_genome::TraceGenome;
use fugue_evo::inference::mh::EvolutionChain;
use fugue_evo::inference::model::EvolutionModel;
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use ricercar_features::Features;
use ricercar_grammar::{PatchGrammarPrior, PatchTree};
use ricercar_session::{Engine, SessionConfig, SurrogateFitness};
use ricercar_taste::SyntheticUser;

/// Refinement generations run per seed in measurement 1.
const GENERATIONS: usize = 6;
/// Duels used to teach the model before search starts.
const TEACH_DUELS: usize = 60;

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

fn cfg(pool: usize) -> SessionConfig {
    SessionConfig {
        pool_size: pool,
        // The fit is not what is under test here; trim it so a seed is
        // seconds rather than a minute. Measurement 1 is a *paired* before /
        // after on one posterior, so a thinner posterior costs precision, not
        // validity.
        mcmc_samples: 3_000,
        mcmc_warmup: 900,
        ..Default::default()
    }
}

/// Teach `engine` a taste, then return the synthetic user.
fn teach(engine: &mut Engine, rng: &mut StdRng, user: &SyntheticUser) {
    for _ in 0..4 {
        for _ in 0..(TEACH_DUELS / 4) {
            let Some((a, b)) = engine.next_duel(rng) else {
                break;
            };
            let chose_a = user.duel(rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
            engine.record_duel(a, b, chose_a);
        }
        engine.fit_posterior(rng);
    }
}

/// True mean and max utility over the pool.
fn pool_utility(engine: &Engine, user: &SyntheticUser) -> (f64, f64) {
    let us: Vec<f64> = engine
        .pool
        .iter()
        .map(|c| user.utility(&c.phi_std))
        .collect();
    let mean = us.iter().sum::<f64>() / us.len().max(1) as f64;
    let max = us.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    (mean, max)
}

/// Measurement 1: pool mean / max true utility per refinement generation.
///
/// `budget` overrides `(refine_steps, refine_seeds)` when given — that is
/// what `--budget-ab` sweeps.
fn climb(seed: u64, budget: Option<(usize, usize)>) -> Vec<(f64, f64)> {
    let mut rng = StdRng::seed_from_u64(seed);
    let user = ground_truth();
    let mut c = cfg(48);
    if let Some((steps, nseeds)) = budget {
        c.refine_steps = steps;
        c.refine_seeds = nseeds;
    }
    let mut engine = Engine::new(PatchGrammarPrior::default(), c);
    engine.begin_session();
    engine.fill_pool(&mut rng);
    teach(&mut engine, &mut rng, &user);

    let mut out = vec![pool_utility(&engine, &user)];
    for _ in 0..GENERATIONS {
        engine.refine(&mut rng);
        out.push(pool_utility(&engine, &user));
    }
    out
}

/// `--budget-ab`: is the shipped `(refine_steps, refine_seeds)` the right
/// split of one generation's budget?
///
/// The defaults ride `N_OPS` — `2·N_OPS` steps from `N_OPS/2` seeds — on the
/// argument that a wider operator categorical needs both more proposals and
/// more starting points. That is a claim about *where* the budget should go,
/// and it is testable: hold total proposals roughly fixed and move them
/// between depth (steps per seed) and breadth (seeds per generation).
///
/// The thing to watch is **max** utility, not mean. More seeds replaces more
/// of the pool per generation with children of the current top, which lifts
/// the mean by construction while thinning the diversity the frontier is
/// found from — so a config can look better on the mean and be worse at the
/// only thing "give me your best patch" cares about.
fn budget_ab(seeds: &[u64]) {
    let shipped = SessionConfig::default();
    let grid = [
        (shipped.refine_steps, shipped.refine_seeds, "shipped"),
        (shipped.refine_steps, 3, "same depth, fewer seeds"),
        (shipped.refine_steps * 5 / 3, 3, "same total, fewer seeds"),
        (
            shipped.refine_steps / 2,
            shipped.refine_seeds * 2,
            "half depth, double breadth",
        ),
    ];
    println!("== 1b. refine budget A/B ==");
    println!(
        "{:<8} {:<7} {:>9} {:>12} {:>12} {:>10}",
        "steps", "seeds", "proposals", "final mean u", "final max u", "note"
    );
    for (steps, nseeds, note) in grid {
        let curves: Vec<Vec<(f64, f64)>> = std::thread::scope(|s| {
            let hs: Vec<_> = seeds
                .iter()
                .map(|&x| s.spawn(move || climb(x, Some((steps, nseeds)))))
                .collect();
            hs.into_iter().map(|h| h.join().unwrap()).collect()
        });
        let fm = mean(&curves.iter().map(|c| c[GENERATIONS].0).collect::<Vec<_>>());
        let fx = mean(&curves.iter().map(|c| c[GENERATIONS].1).collect::<Vec<_>>());
        println!(
            "{steps:<8} {nseeds:<7} {:>9} {fm:>12.3} {fx:>12.3}   {note}",
            steps * nseeds
        );
    }
    println!();
}

/// Is `addr` one of the grammar's structural choice sites?
fn is_structural(addr: &str) -> bool {
    matches!(
        addr.rsplit_once('#').map(|(_, s)| s),
        Some("leaf" | "src" | "op" | "mod")
    )
}

/// Classify one accepted/rejected transition by diffing traces.
///
/// Returns `(accepted, structural)`. A move is structural when the address
/// *set* changed (reversible jump) or the single address whose value changed
/// is a `#leaf`/`#src`/`#op`/`#mod` site.
fn classify(prev: &Trace, next: &Trace) -> (bool, bool) {
    let keys_prev: HashSet<&str> = prev.choices.keys().map(|a| &**a).collect();
    let keys_next: HashSet<&str> = next.choices.keys().map(|a| &**a).collect();
    if keys_prev != keys_next {
        return (true, true);
    }
    let mut moved: Option<&str> = None;
    for (a, c) in &prev.choices {
        let Some(d) = next.choices.get(a) else {
            return (true, true);
        };
        if c.value != d.value {
            moved = Some(&**a);
            break;
        }
    }
    match moved {
        None => (false, false),
        Some(a) => (true, is_structural(a)),
    }
}

/// What measurement 2 collects for one seed.
#[derive(Clone, Copy, Default)]
struct Accept {
    /// Proposals made (exact).
    steps: usize,
    /// Proposals accepted (exact — the trace changed).
    accepted: usize,
    /// Accepted moves that were structural (exact).
    accepted_structural: usize,
    /// Expected number of structural *proposals*: `Σ structural/total sites`
    /// over the steps, under the kernel's documented uniform site choice.
    /// Fractional on purpose — it is an expectation, not a count.
    expected_structural: f64,
    /// Mean trace sites over the refinement seeds this chain started from.
    mean_sites: f64,
}

/// Measurement 2: MH acceptance, split structural / parameter.
///
/// Rebuilds exactly the chain `Engine::refine_one` runs — same prior, same
/// `SurrogateFitness`, same β — because the engine's own walk reports nothing.
fn acceptance(seed: u64, steps: usize) -> Accept {
    let mut rng = StdRng::seed_from_u64(seed);
    let user = ground_truth();
    let mut engine = Engine::new(PatchGrammarPrior::default(), cfg(48));
    engine.begin_session();
    engine.fill_pool(&mut rng);
    teach(&mut engine, &mut rng, &user);

    let fitness = SurrogateFitness {
        posterior: Arc::clone(engine.posterior.as_ref().expect("fitted")),
        standardizer: Arc::clone(engine.standardizer.as_ref().expect("standardizer")),
        phrase: engine.cfg.phrase.clone(),
        memo: engine.memo().clone(),
    };
    let model =
        EvolutionModel::new(PatchGrammarPrior::default(), fitness).with_beta(engine.cfg.beta);
    let mut chain = EvolutionChain::new(model);

    let mut acc = Accept::default();
    let mut sites = 0.0;
    let mut n_seeds = 0.0f64;
    let seeds: Vec<PatchTree> = engine
        .ranked()
        .iter()
        .take(engine.cfg.refine_seeds)
        .map(|&(i, _, _)| engine.pool[i].tree.clone())
        .collect();
    for seed_tree in seeds {
        let Some(mut trace) = chain.init_from(&seed_tree) else {
            continue;
        };
        sites += trace.choices.len() as f64;
        n_seeds += 1.0;
        for _ in 0..steps {
            // Read the site mix off the trace the kernel is about to propose
            // *from*, before the step — reversible jump changes it.
            let total = trace.choices.len().max(1);
            let structural_sites = trace.choices.keys().filter(|a| is_structural(a)).count();
            acc.expected_structural += structural_sites as f64 / total as f64;

            let (_, t) = chain.step(&mut rng, &trace);
            let (accepted, structural) = classify(&trace, &t);
            acc.steps += 1;
            if accepted {
                acc.accepted += 1;
                acc.accepted_structural += usize::from(structural);
            }
            trace = t;
        }
    }
    acc.mean_sites = sites / n_seeds.max(1.0);
    acc
}

/// Measurement 3: locked-refinement hit rate at a given step budget.
///
/// Locks are drawn the way the app produces them: a user freezes a handful of
/// the patch's own knobs on the panel, so the lock set is a random subset of
/// the seed's non-structural addresses.
///
/// Two bars, because the first one turns out not to be a bar at all:
///
/// - **landed** — `refine_from` returned a child. That means the walk moved,
///   the result was novel, *and* it cleared the pool's eviction bar
///   (`insert_candidate` refuses a `Refined` candidate that scores below the
///   evictee). This is the honest definition of "the button did something",
///   and it saturates at 100%, which makes it useless for comparing budgets.
/// - **beat its parent** — the child's posterior-mean utility exceeds the
///   seed's. This is what the user actually asked for when they pressed
///   "evolve from this", and it does *not* saturate, so it is the number a
///   budget argument should be made on.
///
/// Trials run in sequence against one evolving pool on purpose: that is how
/// a user presses the button, and each landed child changes the eviction bar
/// the next one has to clear.
fn refine_hits(seed: u64, steps: usize, trials: usize) -> (usize, usize, usize) {
    let mut rng = StdRng::seed_from_u64(seed);
    let user = ground_truth();
    let mut engine = Engine::new(
        PatchGrammarPrior::default(),
        SessionConfig {
            refine_steps: steps,
            ..cfg(48)
        },
    );
    engine.begin_session();
    engine.fill_pool(&mut rng);
    teach(&mut engine, &mut rng, &user);

    let (mut landed, mut improved) = (0, 0);
    for t in 0..trials {
        let ranked = engine.ranked();
        let top = ranked.len().min(engine.cfg.refine_seeds).max(1);
        let (idx, parent_u, _) = ranked[t % top];
        let id = engine.pool[idx].id;
        let tree = engine.pool[idx].tree.clone();
        let addrs: Vec<String> = tree
            .to_trace()
            .choices
            .keys()
            .map(|a| a.to_string())
            .filter(|a| !is_structural(a))
            .collect();
        // Lock about a third of the knobs — a plausible "I like this filter
        // and this envelope, change the rest" gesture.
        let locked: Vec<String> = addrs.into_iter().filter(|_| rng.gen_bool(0.33)).collect();
        if let Some(child) = engine.refine_from(&mut rng, id, &locked) {
            landed += 1;
            let child_u = engine
                .ranked()
                .iter()
                .find(|&&(i, _, _)| engine.pool[i].id == child)
                .map(|&(_, u, _)| u);
            if child_u.is_some_and(|u| u > parent_u) {
                improved += 1;
            }
        }
    }
    (landed, improved, trials)
}

/// Measurement 4: **why** the pool climbs and then falls back.
///
/// From wave 2C's palette the climb curve peaks around generation 4 and then
/// declines, and `max u` declines with it — meaning eviction is throwing away
/// the best patch in the pool. Eviction ranks by the *fitted* utility
/// (`insert_candidate`), and the fitted utility is only ever a proxy for the
/// truth this harness can see. Three numbers separate the candidate causes:
///
/// - **fit↔truth** — Spearman ρ between the fitted score and the true utility
///   over the whole pool. If this is low, the model simply does not know what
///   is good and eviction cannot help.
/// - **fit stability** — Spearman ρ between one generation's fitted scores and
///   the next's, over the members present in both. If *this* is low while
///   fit↔truth is fine, the ranking is churning between refits and eviction is
///   sampling noise rather than reading a belief.
/// - **best kept** — how often the previous generation's true-best member is
///   still in the pool afterwards. This is the failure itself, counted.
struct Retention {
    fit_vs_truth: Vec<f64>,
    fit_stability: Vec<f64>,
    best_kept: usize,
    best_chances: usize,
}

/// Spearman's ρ: Pearson on ranks, which is what "does the order agree" means
/// here — the utilities are on arbitrary scales and only their order is used.
fn spearman(a: &[f64], b: &[f64]) -> f64 {
    fn ranks(xs: &[f64]) -> Vec<f64> {
        let mut idx: Vec<usize> = (0..xs.len()).collect();
        idx.sort_by(|&i, &j| xs[i].total_cmp(&xs[j]));
        let mut r = vec![0.0; xs.len()];
        // Average ties, or a pool with repeated scores biases ρ upward.
        let mut i = 0;
        while i < idx.len() {
            let mut j = i;
            while j + 1 < idx.len() && xs[idx[j + 1]] == xs[idx[i]] {
                j += 1;
            }
            let avg = (i + j) as f64 / 2.0;
            for &k in &idx[i..=j] {
                r[k] = avg;
            }
            i = j + 1;
        }
        r
    }
    let (ra, rb) = (ranks(a), ranks(b));
    let (ma, mb) = (mean(&ra), mean(&rb));
    let mut num = 0.0;
    let (mut da, mut db) = (0.0, 0.0);
    for i in 0..ra.len() {
        num += (ra[i] - ma) * (rb[i] - mb);
        da += (ra[i] - ma).powi(2);
        db += (rb[i] - mb).powi(2);
    }
    if da == 0.0 || db == 0.0 {
        return 0.0;
    }
    num / (da * db).sqrt()
}

fn retention(seed: u64) -> Retention {
    let mut rng = StdRng::seed_from_u64(seed);
    let user = ground_truth();
    let mut engine = Engine::new(PatchGrammarPrior::default(), cfg(48));
    engine.begin_session();
    engine.fill_pool(&mut rng);
    teach(&mut engine, &mut rng, &user);

    // The fitted score exactly as `insert_candidate` computes it.
    let fitted = |e: &Engine| -> Vec<(u64, f64)> {
        let p = e.posterior.clone();
        e.pool
            .iter()
            .map(|c| {
                let u = match (&p, c.phi_std.is_empty()) {
                    (Some(p), false) => p.utility_mix(&c.phi_std).0,
                    _ => 0.0,
                };
                (c.id, u)
            })
            .collect()
    };

    let mut out = Retention {
        fit_vs_truth: Vec::new(),
        fit_stability: Vec::new(),
        best_kept: 0,
        best_chances: 0,
    };
    let mut prev_fit: Vec<(u64, f64)> = fitted(&engine);

    for _ in 0..GENERATIONS {
        // Who is genuinely best right now?
        let best = engine
            .pool
            .iter()
            .max_by(|a, b| {
                user.utility(&a.phi_std)
                    .total_cmp(&user.utility(&b.phi_std))
            })
            .map(|c| c.id);

        engine.refine(&mut rng);

        if let Some(id) = best {
            out.best_chances += 1;
            if engine.pool.iter().any(|c| c.id == id) {
                out.best_kept += 1;
            }
        }

        let now_fit = fitted(&engine);
        let truth: Vec<f64> = engine
            .pool
            .iter()
            .map(|c| user.utility(&c.phi_std))
            .collect();
        let fit_now: Vec<f64> = now_fit.iter().map(|&(_, u)| u).collect();
        out.fit_vs_truth.push(spearman(&fit_now, &truth));

        // Stability is only meaningful over members that survived, so pair on id.
        let (mut a, mut b) = (Vec::new(), Vec::new());
        for &(id, u_prev) in &prev_fit {
            if let Some(&(_, u_now)) = now_fit.iter().find(|&&(i, _)| i == id) {
                a.push(u_prev);
                b.push(u_now);
            }
        }
        if a.len() >= 4 {
            out.fit_stability.push(spearman(&a, &b));
        }
        prev_fit = now_fit;
    }
    out
}

fn mean(xs: &[f64]) -> f64 {
    xs.iter().sum::<f64>() / xs.len().max(1) as f64
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let ab = args.iter().any(|a| a == "--budget-ab");
    let n_seeds: usize = args
        .iter()
        .find_map(|a| a.parse::<usize>().ok())
        .unwrap_or(6);
    let seeds: Vec<u64> = (0..n_seeds as u64).map(|i| 0xE05 + i * 0x101).collect();

    if ab {
        budget_ab(&seeds);
        return;
    }

    println!("== 1. pool true utility per refinement generation ==");
    println!(
        "(pool 48, {TEACH_DUELS} duels, {GENERATIONS} generations, refine_steps/seeds from config)"
    );
    let curves: Vec<Vec<(f64, f64)>> = std::thread::scope(|s| {
        let hs: Vec<_> = seeds
            .iter()
            .map(|&x| s.spawn(move || climb(x, None)))
            .collect();
        hs.into_iter().map(|h| h.join().unwrap()).collect()
    });
    println!(
        "{:<6} {:>10} {:>10} {:>10}",
        "gen", "mean u", "max u", "Δ mean"
    );
    let mut prev = f64::NAN;
    for g in 0..=GENERATIONS {
        let ms: Vec<f64> = curves.iter().map(|c| c[g].0).collect();
        let xs: Vec<f64> = curves.iter().map(|c| c[g].1).collect();
        let m = mean(&ms);
        println!(
            "{g:<6} {m:>10.3} {:>10.3} {:>10}",
            mean(&xs),
            if prev.is_nan() {
                "—".into()
            } else {
                format!("{:+.3}", m - prev)
            }
        );
        prev = m;
    }
    let gain: Vec<f64> = curves.iter().map(|c| c[GENERATIONS].0 - c[0].0).collect();
    let up = gain.iter().filter(|g| **g > 0.0).count();
    println!(
        "  mean gain over {GENERATIONS} generations: {:+.3}   climbed on {up}/{} seeds\n",
        mean(&gain),
        gain.len()
    );

    println!("== 2. MH proposals (fugue-evo exposes no acceptance or target-site counter) ==");
    let rows: Vec<Accept> = std::thread::scope(|s| {
        let hs: Vec<_> = seeds
            .iter()
            .map(|&x| s.spawn(move || acceptance(x, 200)))
            .collect();
        hs.into_iter().map(|h| h.join().unwrap()).collect()
    });
    let steps: usize = rows.iter().map(|r| r.steps).sum();
    let acc: usize = rows.iter().map(|r| r.accepted).sum();
    let acc_s: usize = rows.iter().map(|r| r.accepted_structural).sum();
    let exp_s: f64 = rows.iter().map(|r| r.expected_structural).sum();
    let sites = mean(&rows.iter().map(|r| r.mean_sites).collect::<Vec<_>>());
    println!("mean trace sites per refinement seed: {sites:.1}");
    println!(
        "overall acceptance (exact):        {acc}/{steps} = {:.1}%   (kernel target 44%)",
        100.0 * acc as f64 / steps.max(1) as f64
    );
    println!(
        "structural share of accepted (exact): {acc_s}/{acc} = {:.1}%",
        100.0 * acc_s as f64 / acc.max(1) as f64
    );
    println!(
        "structural sites are {:.1}% of all sites, so ~{exp_s:.0} of {steps} proposals were structural",
        100.0 * exp_s / steps.max(1) as f64
    );
    println!(
        "  estimated structural acceptance: {:.0}%     estimated parameter acceptance: {:.0}%",
        100.0 * acc_s as f64 / exp_s.max(1.0),
        100.0 * (acc - acc_s) as f64 / (steps as f64 - exp_s).max(1.0),
    );
    println!();

    println!("== 4. does eviction keep what is good? ==");
    println!("(fit↔truth: does the model know? · stability: does its ranking hold still?)");
    let rets: Vec<Retention> = std::thread::scope(|s| {
        let hs: Vec<_> = seeds
            .iter()
            .map(|&x| s.spawn(move || retention(x)))
            .collect();
        hs.into_iter().map(|h| h.join().unwrap()).collect()
    });
    let vs_truth: Vec<f64> = rets.iter().flat_map(|r| r.fit_vs_truth.clone()).collect();
    let stability: Vec<f64> = rets.iter().flat_map(|r| r.fit_stability.clone()).collect();
    let kept: usize = rets.iter().map(|r| r.best_kept).sum();
    let chances: usize = rets.iter().map(|r| r.best_chances).sum();
    println!(
        "  fitted vs true utility (spearman):  {:.3}",
        mean(&vs_truth)
    );
    println!(
        "  fitted ranking across refits:       {:.3}",
        mean(&stability)
    );
    println!(
        "  true-best survived the generation:   {kept}/{chances} = {:.0}%",
        100.0 * kept as f64 / chances.max(1) as f64
    );
    println!();

    println!("== 3. locked refine_from hit rate ==");
    println!("(a third of each seed's knobs locked at random; a hit is a new patch that beats the evictee)");
    println!(
        "{:<8} {:>12} {:>8} {:>14} {:>8}",
        "steps", "landed", "rate", "beat parent", "rate"
    );
    let shipped = SessionConfig::default().refine_steps;
    for steps in [shipped / 2, shipped, 2 * shipped, 4 * shipped] {
        let rs: Vec<(usize, usize, usize)> = std::thread::scope(|s| {
            let hs: Vec<_> = seeds
                .iter()
                .map(|&x| s.spawn(move || refine_hits(x, steps, 8)))
                .collect();
            hs.into_iter().map(|h| h.join().unwrap()).collect()
        });
        let (l, i, t) = rs
            .iter()
            .fold((0, 0, 0), |(a, b, c), (d, e, f)| (a + d, b + e, c + f));
        println!(
            "{}{:<7} {:>12} {:>7.0}% {:>14} {:>7.0}%",
            if steps == shipped { "*" } else { " " },
            steps,
            format!("{l}/{t}"),
            100.0 * l as f64 / t.max(1) as f64,
            format!("{i}/{t}"),
            100.0 * i as f64 / t.max(1) as f64,
        );
    }
    println!("(* = shipped SessionConfig::refine_steps)");
}
