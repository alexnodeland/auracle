use super::*;
use crate::model::{TasteConfig, KEEP};
use crate::observe::Feedback;
use crate::testkit::{ground_truth, random_phi, D};
use fugue::adaptive_mcmc_chain_thinned;
use rand::rngs::StdRng;
use rand::SeedableRng;

/// The reference: fugue-ppl's own chain driver over the taste program,
/// thinned at the same stride. This is how `TasteModel::fit` ran before the
/// kernel, and what the kernel must deal draw for draw.
fn by_fugue(
    model: &TasteModel,
    rng: &mut StdRng,
    data: &FitSet,
    n_samples: usize,
    n_warmup: usize,
    stride: usize,
) -> Vec<TasteSample> {
    let addrs = Arc::new(SiteAddrs::new(&model.cfg, data.n_sessions().max(1)));
    let layout = Arc::new(Layout::new(&model.cfg, &addrs));
    let evidence = Arc::new(Evidence::new(&model.cfg, data));
    let model_fn = || model.model_at(&evidence, &addrs, &layout);
    adaptive_mcmc_chain_thinned(rng, model_fn, n_samples, n_warmup, stride)
        .into_iter()
        .map(|(s, _)| s)
        .collect()
}

/// Every number of every draw, as bits, so equal means bit for bit.
fn bits(draws: &[TasteSample]) -> Vec<Vec<u64>> {
    draws
        .iter()
        .map(|s| {
            s.theta
                .iter()
                .flatten()
                .chain(&s.tau)
                .chain(&s.cuts)
                .map(|v| v.to_bits())
                .collect()
        })
        .collect()
}

/// A log of every kind of feedback over `sessions` sessions, a third of its
/// rows with imputed coordinates, answered by the ground-truth listener.
fn mixed_log(seed: u64, n: usize, sessions: usize) -> FitSet {
    let mut rng = StdRng::seed_from_u64(seed);
    let user = ground_truth();
    let mut data = FitSet::default();
    for j in 0..n {
        let x = random_phi(&mut rng);
        let feedback = match j % 3 {
            0 => {
                let b = random_phi(&mut rng);
                let chose_a = user.utility(&x) > user.utility(&b);
                Feedback::Duel { a: x, b, chose_a }
            }
            1 => Feedback::KeepKill {
                kept: user.utility(&x) > user.tau,
                x,
            },
            _ => Feedback::Stars {
                rating: (j % 6) as u8,
                x,
            },
        };
        data.rows.push((feedback, j % sessions));
        data.absent
            .push(if j % 3 == 1 { vec![2, 9] } else { vec![] });
    }
    data
}

/// The kernel deals fugue's draws: `TasteModel::fit` retains, bit for bit,
/// what fugue-ppl's adaptive single-site driver retains from the same seed,
/// and leaves the stream where fugue leaves it. Swept over seeds and over
/// the configs that shape the program differently: one lens with no star
/// sites; five lenses with two fused groups (μ sites, θ drawn about them),
/// three sessions of τ, stars (cut sites), keeps with imputed coordinates
/// and a recency half-life.
#[test]
fn the_fit_deals_fugues_draws_bit_for_bit() {
    let mut flat = TasteConfig::linear(D);
    flat.n_stars = 1;
    let mut rich = TasteConfig::mixture(D, 5);
    rich.fused = vec![vec![0, 1, 2], vec![5, 7]];
    rich.fused_rho = Some(0.3);
    rich.recency_half_life = Some(6.0);
    let cases = [(flat, mixed_log(1, 12, 1)), (rich, mixed_log(2, 24, 3))];
    // A budget over `KEEP`, so the stride is above 1 and the warmup is long
    // enough for the scales to move off 1.
    let (n_samples, n_warmup) = (2 * KEEP + 7, 900);
    for (cfg, data) in &cases {
        let model = TasteModel::new(cfg.clone());
        for seed in 0..3u64 {
            let mut ours = StdRng::seed_from_u64(seed);
            let mut theirs = StdRng::seed_from_u64(seed);
            let fit = model.fit(&mut ours, data, n_samples, n_warmup);
            let stride = n_samples.div_ceil(KEEP);
            let want = by_fugue(&model, &mut theirs, data, n_samples, n_warmup, stride);
            assert_eq!(fit.samples.len(), n_samples.div_ceil(stride));
            assert!(
                bits(&fit.samples) == bits(&want),
                "K={} seed {seed}: the kernel's draws are not fugue's",
                cfg.k_styles
            );
            assert_eq!(ours.next_u64(), theirs.next_u64(), "seed {seed}");
        }
    }
}

/// The chain accepts and rejects: a draw is not the one before it every
/// time, and not always a new one, so the bit-for-bit test above compares a
/// chain that moved, not one that stood still.
#[test]
fn the_chain_both_moves_and_stays() {
    let model = TasteModel::new(TasteConfig::mixture(D, 2));
    let data = mixed_log(3, 12, 2);
    let mut rng = StdRng::seed_from_u64(4);
    let draws = chain(&model, &mut rng, &data, 400, 200, 1);
    let changed = draws.windows(2).filter(|w| w[0] != w[1]).count();
    assert!(
        changed > 50 && changed < 399,
        "{changed} of 399 steps moved"
    );
}

/// A stride longer than the chain keeps its first draw and no other, as
/// fugue's driver does, and the stream ends where fugue's ends.
#[test]
fn a_stride_past_the_chain_keeps_only_its_first_draw() {
    let model = TasteModel::new(TasteConfig::mixture(D, 3));
    let data = mixed_log(5, 9, 2);
    for seed in 0..3u64 {
        let mut ours = StdRng::seed_from_u64(seed);
        let mut theirs = StdRng::seed_from_u64(seed);
        let got = chain(&model, &mut ours, &data, 3, 5, 10);
        let want = by_fugue(&model, &mut theirs, &data, 3, 5, 10);
        assert_eq!(got.len(), 1);
        assert!(bits(&got) == bits(&want), "seed {seed}");
        assert_eq!(ours.next_u64(), theirs.next_u64(), "seed {seed}");
    }
}

/// fugue's accept test, case by case: a log-ratio of zero or more accepts
/// without drawing; a negative one draws one uniform and accepts below
/// `e^{log α}`; from a state of no mass (−∞ or NaN), the chain moves to any
/// proposal with a finite weight and stays otherwise, drawing nothing.
#[test]
fn the_accept_test_is_fugues() {
    let fresh = || StdRng::seed_from_u64(7);
    let untouched = fresh().next_u64();

    for log_alpha in [0.0, 2.5] {
        let mut rng = fresh();
        assert!(mh_accept(&mut rng, log_alpha, -3.0, -3.0 + log_alpha));
        assert_eq!(rng.next_u64(), untouched, "log α {log_alpha} drew");
    }

    let u: f64 = fresh().gen();
    let after_one = {
        let mut r = fresh();
        let _: f64 = r.gen();
        r.next_u64()
    };
    for (log_alpha, accept) in [(u.ln() + 1e-9, true), (u.ln() - 1e-9, false)] {
        let mut rng = fresh();
        assert_eq!(
            mh_accept(&mut rng, log_alpha, -3.0, -3.0 + log_alpha),
            accept
        );
        assert_eq!(rng.next_u64(), after_one, "log α {log_alpha}");
    }

    // The uniform must fall strictly below `e^{log α}`: at a `log α` whose
    // exponential is the uniform itself, the proposal is rejected. (A seed
    // whose uniform survives `ln` and `exp` unchanged is found, not assumed.)
    let (mut rng, u) = (0u64..)
        .map(|seed| {
            let rng = StdRng::seed_from_u64(seed);
            let u: f64 = rng.clone().gen();
            (rng, u)
        })
        .find(|(_, u)| u.ln().exp() == *u)
        .expect("a uniform that ln and exp return exactly");
    assert!(!mh_accept(&mut rng, u.ln(), -3.0, -3.0 + u.ln()));

    for current in [f64::NEG_INFINITY, f64::NAN] {
        for (prop, accept) in [(-4.0, true), (f64::NEG_INFINITY, false)] {
            let mut rng = fresh();
            assert_eq!(mh_accept(&mut rng, prop - current, current, prop), accept);
            assert_eq!(rng.next_u64(), untouched, "from {current} to {prop}");
        }
    }
}
