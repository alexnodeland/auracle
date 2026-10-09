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

/// `mixed_log` with every keep's and star's coordinates 2 and 9 imputed, at
/// the standardized mean (0) where the standardizer imputes them: two lenses
/// equal off those coordinates then tie on every such candidate, and the
/// lens that prices the imputed variance is the tie's.
fn imputed_at_mean(mut data: FitSet) -> FitSet {
    for (r, (o, _)) in data.rows.iter_mut().enumerate() {
        if let Feedback::KeepKill { x, .. } | Feedback::Stars { x, .. } = o {
            x[2] = 0.0;
            x[9] = 0.0;
            data.absent[r] = vec![2, 9];
        }
    }
    data
}

/// The chain's kept likelihood and prior are the whole ones: its likelihood
/// is, bit for bit, what `Evidence::loglik` computes from the state, and its
/// log-weight what the program's trace would total, and the proposal's
/// buffers are back to the current state's.
fn assert_whole(chain: &Chain, evidence: &Evidence, layout: &Layout, at: &str) {
    let ll = evidence.loglik(&chain.cur_s);
    assert_eq!(chain.cur_scored.ll.to_bits(), ll.to_bits(), "{at}: total");
    let lw = layout.log_prior(&chain.cur) + nan_to_neg_inf(ll);
    assert_eq!(chain.cur_lw.to_bits(), lw.to_bits(), "{at}: log-weight");
    let bits = |s: &Scored| -> Vec<u64> {
        s.dots
            .iter()
            .chain(&s.terms)
            .chain([&s.ll])
            .chain(&s.prior)
            .chain([&s.lp])
            .map(|v| v.to_bits())
            .collect()
    };
    assert!(
        bits(&chain.prop_scored) == bits(&chain.cur_scored),
        "{at}: the proposal's score is not the current one's"
    );
    assert!(chain.prop == chain.cur, "{at}: the proposal's values");
}

/// A step recomputes only what its site reaches, and lands on the number the
/// whole likelihood gives: every site of a program with μ (a fused group), θ
/// over three lenses, τ over two sessions (each with keeps) and cuts is moved by hand, its
/// proposal scored against `Evidence::loglik` of the proposed draw bit for
/// bit, and taken or left in turn; then the chain runs on its own, checked
/// after every step. The log holds duels, keeps and stars, imputed
/// coordinates and a recency half-life, and starts with lenses 0 and 1 tied
/// on every keep and star, so the imputed variance is priced by the last of
/// two equal lenses until a move breaks the tie.
#[test]
fn every_step_scores_what_the_whole_likelihood_gives() {
    let mut cfg = TasteConfig::mixture(D, 3);
    cfg.fused = vec![vec![0, 1, 3]];
    cfg.fused_rho = Some(0.3);
    cfg.recency_half_life = Some(6.0);
    let data = imputed_at_mean(mixed_log(6, 30, 2));
    let model = TasteModel::new(cfg);
    let addrs = Arc::new(SiteAddrs::new(&model.cfg, data.n_sessions()));
    let layout = Arc::new(Layout::new(&model.cfg, &addrs));
    let evidence = Arc::new(Evidence::new(&model.cfg, &data));
    let mut rng = StdRng::seed_from_u64(9);
    let (_, start) = run(
        PriorHandler {
            rng: &mut rng,
            trace: Trace::default(),
        },
        model.model_at(&evidence, &addrs, &layout),
    );
    let fresh = Chain::new(&layout, &evidence, &addrs, &start);
    // Lens 1 is lens 0 but on the imputed coordinates, where it is larger,
    // and lens 2 is half of lens 0 off them, so the two tie at the top
    // wherever lens 0 likes a keep or a star.
    let mut vals = fresh.cur.clone();
    let lens = |k: usize, i: usize| layout.theta_at + k * D + i;
    for i in 0..D {
        let imputed = i == 2 || i == 9;
        vals[lens(1, i)] = vals[lens(0, i)] + if imputed { 1.5 } else { 0.0 };
        if !imputed {
            vals[lens(2, i)] = 0.5 * vals[lens(0, i)];
        }
    }
    let mut chain = Chain::at(&layout, &evidence, fresh.sites.clone(), vals);
    assert_whole(&chain, &evidence, &layout, "the start");
    let tied = |chain: &Chain| {
        let r = chain.rows.keeps.iter().flatten().chain(&chain.rows.stars);
        r.filter(|&&r| {
            let d = &chain.cur_scored.dots[chain.rows.cands[r] * 3..][..3];
            d[0] == d[1] && d[1] >= d[2]
        })
        .count()
    };
    assert!(tied(&chain) > 3, "only {} rows tie", tied(&chain));
    // The tie matters: lens 1 prices the imputed variance, and lens 0 would
    // price it lower.
    let as_if_lens_0 = {
        let mut s = chain.cur_s.clone();
        s.theta[1] = s.theta[0].clone();
        evidence.loglik(&s)
    };
    assert_ne!(chain.cur_scored.ll, as_if_lens_0);

    // Every site by hand, the moves that keep the tie first (μ, τ, cuts and
    // the lenses' imputed coordinates), each taken or left in turn.
    let keeps_tie = |slot: usize| {
        slot < layout.theta_at
            || slot >= layout.tau_at
            || [2, 9].contains(&((slot - layout.theta_at) % D))
    };
    let (first, then): (Vec<usize>, Vec<usize>) = (0..chain.cur.len()).partition(|&s| keeps_tie(s));
    let mut reached = Vec::new();
    for (n, &slot) in first.iter().chain(&then).enumerate() {
        let at = format!("move {n}, slot {slot}");
        let value = chain.cur[slot] + 0.4 * (n as f64 * 0.7).sin();
        let lw = chain.propose(slot, value);
        let ll = evidence.loglik(&chain.prop_s);
        assert_eq!(
            chain.prop_scored.ll.to_bits(),
            ll.to_bits(),
            "{at}: proposal"
        );
        let want = layout.log_prior(&chain.prop) + nan_to_neg_inf(ll);
        assert_eq!(lw.to_bits(), want.to_bits(), "{at}: proposal's log-weight");
        chain.settle(slot, n % 2 == 0, lw);
        assert_whole(&chain, &evidence, &layout, &at);
        assert_eq!(chain.cur[slot] == value, n % 2 == 0, "{at}: taken or left");
        if n + 1 == first.len() {
            assert!(tied(&chain) > 3, "the moves that keep the tie broke it");
        }
        reached.push(layout.reach(slot));
    }
    for kind in [
        Reach::Nothing,
        Reach::Lens(2),
        Reach::Session(1),
        Reach::Cuts,
    ] {
        assert!(reached.contains(&kind), "no move reached {kind:?}");
    }

    // And the chain on its own, warmup and sampling, after every step.
    let mut moved = 0;
    for n in 0..3000 {
        let before = chain.cur_lw;
        chain.step(&mut rng, n < 1000);
        moved += usize::from(chain.cur_lw != before);
        assert_whole(&chain, &evidence, &layout, &format!("step {n}"));
    }
    assert!(moved > 300, "only {moved} of 3000 steps moved");
}

/// What each site reaches, by its slot in a program's execution order: μ
/// first, then θ lens by lens, τ by session, and the cut raws.
#[test]
fn a_site_reaches_what_its_slot_says() {
    let mut cfg = TasteConfig::mixture(4, 2);
    cfg.fused = vec![vec![0, 1]];
    cfg.fused_rho = Some(0.3);
    let addrs = SiteAddrs::new(&cfg, 2);
    let layout = Layout::new(&cfg, &addrs);
    let want = [
        Reach::Nothing,
        Reach::Nothing,
        Reach::Lens(0),
        Reach::Lens(0),
        Reach::Lens(0),
        Reach::Lens(0),
        Reach::Lens(1),
        Reach::Lens(1),
        Reach::Lens(1),
        Reach::Lens(1),
        Reach::Session(0),
        Reach::Session(1),
        Reach::Cuts,
        Reach::Cuts,
        Reach::Cuts,
        Reach::Cuts,
        Reach::Cuts,
    ];
    let got: Vec<Reach> = (0..addrs.site_count()).map(|s| layout.reach(s)).collect();
    assert_eq!(got, want);
}
