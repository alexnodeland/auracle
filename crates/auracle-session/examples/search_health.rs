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
//! cargo run -p auracle-session --example search_health --release
//! cargo run -p auracle-session --example search_health --release -- 8   # seeds
//! cargo run -p auracle-session --example search_health --release -- --budget-ab
//! cargo run -p auracle-session --example search_health --release -- --routing
//! cargo run -p auracle-session --example search_health --release -- --climb 16
//! cargo run -p auracle-session --example search_health --release -- --tail
//! ```
//!
//! `--tail` is measurements 4 and 3 alone — the back half of the default run,
//! and the expensive half.
//!
//! `--climb` runs measurement 1 alone, at whatever seed count is asked for,
//! and prints the **per-seed** final utilities as well as the mean. That is
//! the iteration loop for anything that touches φ or the prior: measurement 1
//! is the gate a feature-set change is most likely to fail, it is a third of
//! the runtime, and a change of ±0.4 in the mean gain is inside the
//! seed-to-seed spread — so the aggregate alone cannot tell a regression from
//! a lottery. The seeds are the same list in both arms, so the paired
//! differences below the table are the number to read.
//!
//! `--routing` is measurement 5 and it is the odd one out: everything else
//! here asks whether a change *broke* the search, and it asks whether a change
//! **bought** anything. It compiles against a feature set that does not have
//! the wave-3 shape columns — it walks the term itself rather than reading
//! `StructFeatures` — precisely so the same binary can be run on both sides of
//! that change and the two numbers compared.
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
//! ## The wave-3 φ reading, so it does not have to be re-derived
//!
//! `chain_balance` and `frac_sidechained` joined φ_struct. Both arms below are
//! the same seed list; "before" is the 23-column φ_struct, "after" is the same
//! plus those two. Nothing regresses, three things improve, and the one number
//! that moved the wrong way is inside the noise:
//!
//! ```text
//!                                              before     after
//! 1  pool climb, mean gain (8 seeds)            +1.714    +1.723
//! 1  pool climb, mean gain (16 seeds, paired)             +0.35 ± 0.73
//! 1  best patch found (16 seeds, paired)                  −1.00 ± 0.63
//! 2  MH acceptance                               46.5%     49.6%
//! 2  structural share of accepted                29.8%     31.4%
//! 3  locked refine beat its parent (shipped)      66%       69%
//! 4  fitted vs true utility (spearman)           0.318     0.389
//! 4  fitted ranking across refits                0.556     0.619
//! 4  true best survived the generation            98%      100%
//! 5  routing listener: fit vs truth              0.662     0.705
//! 5  routing listener: true mean gain           +2.016    +2.669
//! 5  routing listener: pool sidechained          71.6%     82.0%
//! closed_loop_sweep mean r (13 seeds)        0.693±0.018  0.688±0.018
//! ```
//!
//! The best-patch line is the only negative and it is 1.6 standard errors, on
//! a quantity a single lucky seed moves a long way (one before-arm seed
//! returned a max of 16.4 against a fleet median of 7.4). Measurement 4 is the
//! one worth reading twice: giving the model two more things to be right about
//! made its ranking agree with the truth *more*, for a synthetic listener who
//! has no opinion about routing at all.
//!
//! ## 3. Does locked refinement still land?
//!
//! `Engine::refine_from` with locks is the app's "⚡ evolve from this" button.
//! Reported as two rates — one that saturates and one that does not; see
//! [`refine_hits`]. Run at half, one, two and four times the shipped budget,
//! so "20 steps is not enough" is a statement with a number attached rather
//! than a feeling.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use auracle_features::Features;
use auracle_grammar::{PatchGrammarPrior, PatchTree};
use auracle_session::{Engine, RefineKeep, SessionConfig, SurrogateFitness};
use auracle_taste::{MixtureSyntheticUser, SyntheticUser};
use fugue::Trace;
use fugue_evo::genome::trace_genome::TraceGenome;
use fugue_evo::inference::mh::EvolutionChain;
use fugue_evo::inference::model::EvolutionModel;
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};

/// Refinement generations run per seed in measurement 1.
const GENERATIONS: usize = 6;
/// Duels used to teach the model before search starts.
const TEACH_DUELS: usize = 60;
/// Votes cast between generations in [`retention`], so the posterior is
/// actually refit while the pool turns over.
const REFIT_DUELS: usize = 12;

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

/// Which refinement-keep rule every measurement in this run uses.
///
/// A process-global rather than a parameter threaded through nine call sites,
/// because it is a *run* setting: `--keep-best` re-runs the whole harness under
/// the other arm so the two can be paired seed-for-seed. Set once in `main`
/// before any thread is spawned, read-only thereafter.
static KEEP_BEST: AtomicBool = AtomicBool::new(false);

fn keep_mode() -> RefineKeep {
    if KEEP_BEST.load(Ordering::Relaxed) {
        RefineKeep::Best
    } else {
        RefineKeep::Last
    }
}

fn cfg(pool: usize) -> SessionConfig {
    SessionConfig {
        pool_size: pool,
        refine_keep: keep_mode(),
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
    teach_n(engine, rng, user, TEACH_DUELS);
}

/// `teach` with an explicit budget, refit in four instalments.
fn teach_n(engine: &mut Engine, rng: &mut StdRng, user: &SyntheticUser, duels: usize) {
    for _ in 0..4 {
        for _ in 0..(duels / 4) {
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
///
/// The first version of this measurement taught once up front and then ran the
/// generations, exactly as [`climb`] does — which froze the posterior and made
/// stability report **ρ = 1.000 by construction**. A number that cannot come
/// out any other way is not evidence, and it is the same tautology the MH
/// acceptance measurement above had to be rewritten to avoid. So this one
/// keeps voting between generations, which is also what the instrument
/// actually does: the user does not stop after sixty duels.
/// - **best kept** — how often the previous generation's true-best member is
///   still in the pool afterwards. This is the failure itself, counted.
///
/// # What it found, so the question does not get re-asked from scratch
///
/// A wave-2B reading showed the pool peaking at generation 4 and then falling
/// back, with `max u` falling too — the best member being evicted. The obvious
/// suspect was ranking churn: with 23 φ coordinates fitted from sixty duels, a
/// member could plausibly be top-five one generation and bottom-five the next,
/// and eviction reads only the current ranking.
///
/// Over 8 seeds, refitting between generations:
///
/// ```text
/// fitted vs true utility (spearman):  0.318
/// fitted ranking across refits:       0.556
/// true-best survived the generation:  47/48 = 98%
/// ```
///
/// **The churn is real** — 0.556 is a ranking that moves substantially between
/// refits. **And it does not matter**, because the top of the order is not
/// where it moves: the true best survives 98% of generations, and eviction
/// only ever looks at the bottom. So the hypothesis was right about the
/// mechanism and wrong about the consequence, which is the useful half to
/// write down.
///
/// The number that *does* constrain things is the first one. A Spearman of
/// 0.318 between the fitted ranking and the truth means eviction is acting on
/// a weak signal — so late in a run, once the pool has converged and true
/// utilities are bunched, which member goes is close to arbitrary with respect
/// to the truth. No eviction *rule* fixes that; an upper-confidence-bound
/// variant was designed and deliberately not shipped, because the ranking's
/// problem is not that it ignores uncertainty, it is that it carries little
/// information. The levers are more evidence or a better surrogate.
///
/// The decline itself does not reproduce at the wave-2C palette (monotonic,
/// 7 of 8 seeds climbing, `max u` 5.505 → 8.154).
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

    for g in 0..GENERATIONS {
        // Keep teaching, or the posterior never moves and "does the ranking
        // hold still" answers itself.
        if g > 0 {
            teach_n(&mut engine, &mut rng, &user, REFIT_DUELS);
        }
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

/// Measurement 1 on its own, with the per-seed numbers printed.
///
/// The aggregate table hides the only thing that makes a before/after
/// comparison readable: these curves are noisy per seed, and the mean of eight
/// of them moves by a few tenths on nothing at all. Both arms run the same
/// seed list, so the per-seed column pairs up across a rebuild and the
/// difference of the paired means is what a claim should be made on.
///
/// # How much this harness can actually resolve
///
/// Written down so the next feature-set change does not learn it the
/// expensive way. Measured on the wave-3 φ columns, **16 seeds, standard
/// error ±0.64 on the mean gain**. Two arms that differed by a whole
/// coordinate came back at +0.35 ± 0.73 and −0.33 ± 0.74 against the same
/// baseline — which is to say this measurement cannot see a change of half a
/// unit, and an eight-seed run of it (se ≈ 0.9) will happily hand you one.
///
/// The wave-3 8-seed run reported +1.714 → +1.320, best patch 8.154 → 6.503,
/// and 7-of-8 seeds climbing down to 5-of-8: three numbers all pointing the
/// same way, all inside the noise, and a column was very nearly cut on them.
/// So: **16 seeds minimum for a decision, and read the paired difference and
/// its standard error, never the two means side by side.** If a change needs
/// to be detected below that resolution, the fix is more seeds — the run is
/// embarrassingly parallel — not a closer reading of eight.
fn climb_report(seeds: &[u64]) {
    let curves: Vec<Vec<(f64, f64)>> = std::thread::scope(|s| {
        let hs: Vec<_> = seeds
            .iter()
            .map(|&x| s.spawn(move || climb(x, None)))
            .collect();
        hs.into_iter().map(|h| h.join().unwrap()).collect()
    });
    println!("== 1. pool true utility per refinement generation ==");
    println!(
        "(pool 48, {TEACH_DUELS} duels, {GENERATIONS} generations, {} seeds)",
        seeds.len()
    );
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
    let g_mean = mean(&gain);
    // Standard error of the mean gain, so "it moved" and "it moved more than
    // this harness can see" are distinguishable claims.
    let var =
        gain.iter().map(|g| (g - g_mean).powi(2)).sum::<f64>() / (gain.len().max(2) - 1) as f64;
    println!(
        "  mean gain: {g_mean:+.3} ± {:.3} (se)   climbed on {up}/{}",
        (var / gain.len() as f64).sqrt(),
        gain.len()
    );
    // **And the same claim again, robustly, because the mean above cannot
    // carry it.** Pool utility collapses catastrophically on a small fraction
    // of seeds — `insert_candidate` admits and evicts by the model, so a
    // surrogate that is wrong in the right way can walk a pool downhill — and
    // a collapse is worth tens of utility against a typical gain of two. On
    // the 48-seed pair that revalidated the ZCR/flux fix, **three seeds of 48
    // carried 95% of the variance** in the paired difference: the raw mean
    // read +0.749 ± 0.857 while the trimmed mean read −0.099 ± 0.191, a
    // four-fold tighter interval pointing the other way.
    //
    // So the mean is not a statistic about the search, it is a statistic about
    // whether this seed list happened to contain a collapse. The median and
    // the trimmed mean are what a φ change should be read on; the mean stays
    // because the collapses are real and hiding them would be worse.
    let mut sorted = gain.clone();
    sorted.sort_by(f64::total_cmp);
    let median = if sorted.len().is_multiple_of(2) {
        (sorted[sorted.len() / 2 - 1] + sorted[sorted.len() / 2]) / 2.0
    } else {
        sorted[sorted.len() / 2]
    };
    let cut = (sorted.len() / 10).max(1);
    let trimmed = if sorted.len() > 2 * cut {
        &sorted[cut..sorted.len() - cut]
    } else {
        &sorted[..]
    };
    let t_mean = mean(trimmed);
    let t_var = trimmed.iter().map(|g| (g - t_mean).powi(2)).sum::<f64>()
        / (trimmed.len().max(2) - 1) as f64;
    println!(
        "  median gain: {median:+.3}   10% trimmed: {t_mean:+.3} ± {:.3} (se, n={})",
        (t_var / trimmed.len() as f64).sqrt(),
        trimmed.len()
    );
    println!(
        "{:<8} {:>10} {:>10} {:>10}",
        "seed", "final mean", "final max", "gain"
    );
    for (i, c) in curves.iter().enumerate() {
        println!(
            "{:<8x} {:>10.3} {:>10.3} {:>+10.3}",
            seeds[i],
            c[GENERATIONS].0,
            c[GENERATIONS].1,
            c[GENERATIONS].0 - c[0].0
        );
    }
    println!();
}

// ---------------------------------------------------------------------------
// Measurement 5: a listener whose taste is about **routing**.
// ---------------------------------------------------------------------------
//
// Every synthetic user in this repo is linear in the same φ the model is
// linear in, which is the right way to ask "how fast does it estimate
// coefficients" and the wrong way to ask "can it learn *this*". The user here
// wants **asymmetric** routing: one branch processed and the other left dry,
// with the second input of a binary being a chain of its own rather than a
// bare oscillator. That is a statement φ_struct could not represent at all
// until the wave-3 shape columns landed, because a count vector has no place
// to put it.
//
// The taste is deliberately *not* "likes branching". A first version of this
// measurement used branch width, and the before/after arms came out nearly
// identical (Spearman 0.709 on a feature set with no topology coordinate at
// all) — because wanting a wider tree is wanting more sources, and the source
// counts have been in φ since v1. It was measuring a proxy, not the thing.
// `frac_sidechained` and `chain_balance` are the two shape quantities that a
// count vector provably cannot reach: `filter(mix(a, b))` and
// `mix(filter(a), b)` have identical counts and differ in both.
//
// The shape term is computed **from the term**, by the two little walks below,
// and deliberately not by reading `StructFeatures`. Two reasons, and the
// second is why it is worth the duplication:
//
// - The ground truth must be byte-identical on both sides of the feature
//   change or the before/after numbers are measuring two different users.
// - It has to *compile* against a `StructFeatures` that does not have the
//   fields yet, which is the only way to get the "before" arm at all.
//
// What is reported is not θ recovery — there is no θ* to recover, since the
// user is not linear in φ on either arm — but the three things that matter to
// a player: does the fitted ranking agree with the truth, does the pool climb
// in *true* utility, and does the search actually go and find the sidechained
// routings, or does it stay in the flat stacks the prior draws by default.
//
// Wave 3's reading, 8 seeds, before → after:
//
//   fit vs truth (spearman)      0.662 → 0.705
//   true mean utility gain      +2.016 → +2.669
//   true best patch              7.648 → 8.483
//   pool with a sidechained in   71.6% → 82.0%   (from 13.5% at generation 0)
//
// All four move the same way, which is the shape a real effect has. Note the
// *before* arm is far from blind — 71.6% — because an asymmetric routing also
// sounds different, and the audio half of φ hears that. What the columns buy
// is the model knowing *why*.

/// Weight on the shape term, against audio coefficients of 2.0/1.5/1.0 on
/// unit-variance z-scores. Chosen so routing is a real part of this listener's
/// taste and not the whole of it — a user who only cared about topology would
/// be a strawman for a feature set built to carry timbre.
const ROUTING_WEIGHT: f64 = 2.0;

/// Mean source-to-root path length over the longest one. 1.0 when every
/// source sits the same distance from the amp — a serial chain, or a mix of
/// two equal branches; below 1.0 when one branch is a chain and the other is
/// a bare oscillator.
fn chain_balance(root: &PatchTree) -> f64 {
    fn go(
        n: &auracle_grammar::term::AudioNode,
        d: usize,
        sum: &mut usize,
        max: &mut usize,
        k: &mut usize,
    ) {
        let kids = n.children();
        if kids.is_empty() {
            *k += 1;
            *sum += d + 1;
            *max = (*max).max(d + 1);
        }
        for c in kids {
            go(c, d + 1, sum, max, k);
        }
    }
    let (mut sum, mut max, mut k) = (0, 0, 0);
    go(&root.root, 0, &mut sum, &mut max, &mut k);
    if k == 0 || max == 0 {
        return 1.0;
    }
    (sum as f64 / k as f64) / max as f64
}

/// Of the binary nodes, the fraction whose second child is itself a processor
/// rather than a bare source.
fn sidechained(root: &PatchTree) -> f64 {
    fn go(n: &auracle_grammar::term::AudioNode, bin: &mut usize, side: &mut usize) {
        let kids = n.children();
        if kids.len() == 2 {
            *bin += 1;
            *side += usize::from(!kids[1].children().is_empty());
        }
        for c in kids {
            go(c, bin, side);
        }
    }
    let (mut bin, mut side) = (0, 0);
    go(&root.root, &mut bin, &mut side);
    if bin == 0 {
        0.0
    } else {
        side as f64 / bin as f64
    }
}

/// The routing listener's true utility: the usual audio taste, plus a real
/// preference for an asymmetric, sidechained routing.
///
/// Both terms are zero for every serial chain **and** for a symmetric mix of
/// two bare oscillators, so nothing here can be predicted from how many
/// sources a patch has — which is the whole point.
fn routing_utility(user: &SyntheticUser, phi_std: &[f64], tree: &PatchTree) -> f64 {
    let shape = sidechained(tree) + (1.0 - chain_balance(tree));
    user.utility(phi_std) + ROUTING_WEIGHT * shape
}

/// What one seed of measurement 5 reports.
struct Routing {
    /// Spearman ρ between the fitted utility and the truth, after teaching.
    fit_vs_truth: f64,
    /// True utility (mean, max) before and after the generations.
    before: (f64, f64),
    after: (f64, f64),
    /// Share of the pool carrying a sidechained binary, before and after.
    /// This is the one a reader should look at first: it is "did the search go
    /// and find the thing the user asked for", in one number.
    branchy_before: f64,
    branchy_after: f64,
}

fn routing(seed: u64) -> Routing {
    let mut rng = StdRng::seed_from_u64(seed);
    let user = ground_truth();
    let mut engine = Engine::new(PatchGrammarPrior::default(), cfg(48));
    engine.begin_session();
    engine.fill_pool(&mut rng);

    // Teach with the routing listener rather than the plain one — the whole
    // question is whether these votes reach anything.
    for _ in 0..4 {
        for _ in 0..(TEACH_DUELS / 4) {
            let Some((a, b)) = engine.next_duel(&mut rng) else {
                break;
            };
            let ua = routing_utility(&user, &engine.pool[a].phi_std, &engine.pool[a].tree);
            let ub = routing_utility(&user, &engine.pool[b].phi_std, &engine.pool[b].tree);
            let chose_a = rng.gen_bool((1.0 / (1.0 + (ub - ua).exp())).clamp(1e-9, 1.0 - 1e-9));
            engine.record_duel(a, b, chose_a);
        }
        engine.fit_posterior(&mut rng);
    }

    let truth = |e: &Engine| -> Vec<f64> {
        e.pool
            .iter()
            .map(|c| routing_utility(&user, &c.phi_std, &c.tree))
            .collect()
    };
    let fitted = |e: &Engine| -> Vec<f64> {
        let p = e.posterior.clone();
        e.pool
            .iter()
            .map(|c| match (&p, c.phi_std.is_empty()) {
                (Some(p), false) => p.utility_mix(&c.phi_std).0,
                _ => 0.0,
            })
            .collect()
    };
    let branchy = |e: &Engine| -> f64 {
        let n = e.pool.len().max(1) as f64;
        e.pool.iter().filter(|c| sidechained(&c.tree) > 0.0).count() as f64 / n
    };
    let summarize = |us: &[f64]| -> (f64, f64) {
        (
            mean(us),
            us.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        )
    };

    let fit_vs_truth = spearman(&fitted(&engine), &truth(&engine));
    let before = summarize(&truth(&engine));
    let branchy_before = branchy(&engine);
    for _ in 0..GENERATIONS {
        engine.refine(&mut rng);
    }
    Routing {
        fit_vs_truth,
        before,
        after: summarize(&truth(&engine)),
        branchy_before,
        branchy_after: branchy(&engine),
    }
}

fn routing_report(seeds: &[u64]) {
    println!("== 5. a listener whose taste is about routing ==");
    println!(
        "(same audio taste, plus {ROUTING_WEIGHT:.1} × (sidechained fraction + 1 − chain balance))"
    );
    let rows: Vec<Routing> = std::thread::scope(|s| {
        let hs: Vec<_> = seeds.iter().map(|&x| s.spawn(move || routing(x))).collect();
        hs.into_iter().map(|h| h.join().unwrap()).collect()
    });
    println!(
        "  fitted vs true utility (spearman):   {:.3}",
        mean(&rows.iter().map(|r| r.fit_vs_truth).collect::<Vec<_>>())
    );
    println!(
        "  true mean u   {:.3} -> {:.3}   ({:+.3} over {GENERATIONS} generations)",
        mean(&rows.iter().map(|r| r.before.0).collect::<Vec<_>>()),
        mean(&rows.iter().map(|r| r.after.0).collect::<Vec<_>>()),
        mean(
            &rows
                .iter()
                .map(|r| r.after.0 - r.before.0)
                .collect::<Vec<_>>()
        ),
    );
    println!(
        "  true max u    {:.3} -> {:.3}",
        mean(&rows.iter().map(|r| r.before.1).collect::<Vec<_>>()),
        mean(&rows.iter().map(|r| r.after.1).collect::<Vec<_>>()),
    );
    println!(
        "  pool with a sidechained input:  {:.1}% -> {:.1}%",
        100.0 * mean(&rows.iter().map(|r| r.branchy_before).collect::<Vec<_>>()),
        100.0 * mean(&rows.iter().map(|r| r.branchy_after).collect::<Vec<_>>()),
    );
    println!();
}

/// Measurements 4 and 3, which are the back half of the default run.
///
/// Split out because they are also the *expensive* half — an hour of wall
/// clock in, a comparison run that gets interrupted has nothing to show for
/// itself. `--tail` re-runs exactly these against the same seeds, so a
/// before/after pair does not have to recompute measurements 1 and 2 to get
/// at them.
fn tail_report(seeds: &[u64]) {
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

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let ab = args.iter().any(|a| a == "--budget-ab");
    let routing_only = args.iter().any(|a| a == "--routing");
    let climb_only = args.iter().any(|a| a == "--climb");
    let tail_only = args.iter().any(|a| a == "--tail");
    let islands_only = args.iter().any(|a| a == "--islands");
    KEEP_BEST.store(args.iter().any(|a| a == "--keep-best"), Ordering::Relaxed);
    if KEEP_BEST.load(Ordering::Relaxed) {
        println!("(RefineKeep::Best)\n");
    }
    let n_seeds: usize = args
        .iter()
        .find_map(|a| a.parse::<usize>().ok())
        .unwrap_or(6);
    let seeds: Vec<u64> = (0..n_seeds as u64).map(|i| 0xE05 + i * 0x101).collect();

    if ab {
        budget_ab(&seeds);
        return;
    }
    if routing_only {
        routing_report(&seeds);
        return;
    }
    if climb_only {
        climb_report(&seeds);
        return;
    }
    if tail_only {
        tail_report(&seeds);
        return;
    }
    if islands_only {
        islands_report(&seeds);
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

    tail_report(&seeds);
}

// ---------------------------------------------------------------------------
// 6. Cross-island reach
// ---------------------------------------------------------------------------

/// A bimodal ground truth: two well-separated islands of taste.
///
/// Island A is bright, fast-attack, filtered. Island B is dark, slow, noisy and
/// long-tailed — deliberately opposed on every coordinate they share, so a
/// patch cannot be near both and "which island is this on" is unambiguous.
fn two_islands() -> MixtureSyntheticUser {
    let names = Features::phi_names();
    let at = |name: &str| {
        names
            .iter()
            .position(|n| n.split(':').next() == Some(name))
            .expect("known coordinate")
    };
    let mut a = vec![0.0; names.len()];
    let mut b = vec![0.0; names.len()];
    // Island A — bright pluck.
    a[at("centroid_mean")] = 2.0;
    a[at("attack_s")] = -1.5;
    a[at("flatness_mean")] = -1.5;
    a[at("n_filter")] = 0.8;
    // Island B — dark noisy drone. Opposed on all four.
    b[at("centroid_mean")] = -2.0;
    b[at("attack_s")] = 1.5;
    b[at("flatness_mean")] = 1.5;
    b[at("tail_ratio")] = 1.2;
    MixtureSyntheticUser { thetas: vec![a, b] }
}

/// How far onto its island a patch must sit for a crossing to count as one.
///
/// In the synthetic user's utility units, and set well above the noise a single
/// accepted MH step produces: a patch within this of the boundary is not really
/// *on* either island, and watching it flip says nothing about whether the
/// search can travel.
const DECISIVE: f64 = 1.0;

/// Which island a candidate sits on, and by how much it prefers it.
fn island_of(user: &MixtureSyntheticUser, phi: &[f64]) -> (usize, f64) {
    let scores: Vec<f64> = user
        .thetas
        .iter()
        .map(|t| t.iter().zip(phi).map(|(x, y)| x * y).sum::<f64>())
        .collect();
    let best = (0..scores.len())
        .max_by(|&i, &j| scores[i].total_cmp(&scores[j]))
        .unwrap_or(0);
    let other = scores
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != best)
        .map(|(_, s)| *s)
        .fold(f64::NEG_INFINITY, f64::max);
    (best, scores[best] - other)
}

/// One seed's worth of island bookkeeping.
struct Islands {
    /// Refinement events where parent and child sit on different islands.
    crossed: usize,
    /// Of those, the ones where **both** ends are decisively on their island —
    /// see [`DECISIVE`]. A patch sitting on the decision boundary can flip
    /// island under an arbitrarily small change, and counting that as "the
    /// search crossed a valley" would be measuring nothing.
    decisive: usize,
    /// Refinement events observed at all.
    events: usize,
    /// Pool share on each island, after all generations.
    share: [usize; 2],
    /// Best true utility reached on each island.
    best: [f64; 2],
}

/// Measurement 6: **can refinement leave the island it started on?**
///
/// The taste model is a max of K linear experts precisely so one user can hold
/// several islands of taste. The search is a local MH walk warm-started from
/// the pool's best members. Those two facts look to be in tension, and the
/// reference recorded the tension as an open question — *"local refinement from
/// island A will not find island B"* — on reasoning rather than measurement.
///
/// This teaches a genuinely bimodal user, runs real generations, and asks how
/// often a child lands on the island its parent was not on.
///
/// Read the pool share beside the crossing rate. Both islands being occupied is
/// *not* evidence of crossing: the initial i.i.d. fill scatters candidates over
/// both, and refinement can then polish each in place. The crossing rate is the
/// claim; the share is the control.
fn islands(seed: u64) -> Islands {
    let mut rng = StdRng::seed_from_u64(seed);
    let user = two_islands();
    let mut engine = Engine::new(PatchGrammarPrior::default(), cfg(48));
    engine.begin_session();
    engine.fill_pool(&mut rng);

    for _ in 0..4 {
        for _ in 0..(TEACH_DUELS / 4) {
            let Some((a, b)) = engine.next_duel(&mut rng) else {
                break;
            };
            let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
            engine.record_duel(a, b, chose_a);
        }
        engine.fit_posterior(&mut rng);
    }

    let (mut crossed, mut decisive, mut events) = (0usize, 0usize, 0usize);
    for _ in 0..GENERATIONS {
        let before = engine.lineage.len();
        engine.refine(&mut rng);
        for ev in engine.lineage.iter().skip(before) {
            let (Some(pi), Some(ci)) = (engine.find(ev.parent_id), engine.find(ev.child_id)) else {
                continue; // parent evicted by a later injection in the same wave
            };
            let (p_island, p_margin) = island_of(&user, &engine.pool[pi].phi_std);
            let (c_island, c_margin) = island_of(&user, &engine.pool[ci].phi_std);
            events += 1;
            if p_island != c_island {
                crossed += 1;
                if p_margin > DECISIVE && c_margin > DECISIVE {
                    decisive += 1;
                }
            }
        }
    }

    let mut share = [0usize; 2];
    let mut best = [f64::NEG_INFINITY; 2];
    for c in &engine.pool {
        let (i, _) = island_of(&user, &c.phi_std);
        share[i] += 1;
        best[i] = best[i].max(user.utility(&c.phi_std));
    }
    Islands {
        crossed,
        decisive,
        events,
        share,
        best,
    }
}

fn islands_report(seeds: &[u64]) {
    let rows: Vec<Islands> = std::thread::scope(|s| {
        let hs: Vec<_> = seeds.iter().map(|&x| s.spawn(move || islands(x))).collect();
        hs.into_iter().map(|h| h.join().unwrap()).collect()
    });
    println!("== 6. cross-island reach ==");
    println!("(pool 48, {TEACH_DUELS} duels, {GENERATIONS} generations, bimodal user)");
    println!(
        "{:<8} {:>9} {:>9} {:>9} {:>14} {:>11} {:>11}",
        "seed", "crossed", "decisive", "events", "pool A / B", "best A", "best B"
    );
    let (mut tc, mut td, mut te) = (0usize, 0usize, 0usize);
    for (seed, r) in seeds.iter().zip(&rows) {
        tc += r.crossed;
        td += r.decisive;
        te += r.events;
        let fin = |x: f64| if x.is_finite() { x } else { f64::NAN };
        println!(
            "{:<8x} {:>9} {:>9} {:>9} {:>7} / {:<4} {:>11.3} {:>11.3}",
            seed,
            r.crossed,
            r.decisive,
            r.events,
            r.share[0],
            r.share[1],
            fin(r.best[0]),
            fin(r.best[1]),
        );
    }
    let pct = |a: usize, b: usize| {
        if b == 0 {
            0.0
        } else {
            100.0 * a as f64 / b as f64
        }
    };
    println!(
        "\n  crossings: {tc}/{te} refinement events ({:.1}%)",
        pct(tc, te)
    );
    println!(
        "  of those, decisive (both ends > {DECISIVE:.1} onto their island): \
         {td}/{tc} ({:.1}% of all events)",
        pct(td, te)
    );
    let empty = rows
        .iter()
        .filter(|r| r.share[0] == 0 || r.share[1] == 0)
        .count();
    println!(
        "  seeds whose pool ended on ONE island only: {empty}/{}",
        rows.len()
    );
}
