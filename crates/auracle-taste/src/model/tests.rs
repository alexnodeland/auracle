use super::*;
use crate::observe::{Feedback, FitSet, Observation, ObservationLog};
use crate::synthetic::{cosine, IdealPointUser, MixtureSyntheticUser, SyntheticUser};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};

const D: usize = 16;

fn random_phi<R: Rng>(rng: &mut R) -> Vec<f64> {
    // Standardized feature space: unit normals.
    (0..D)
        .map(|_| {
            let (u1, u2): (f64, f64) = (rng.gen(), rng.gen());
            (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
        })
        .collect()
}

fn ground_truth() -> SyntheticUser {
    // A sparse, interpretable taste: likes dims 0/3 strongly, dislikes 1/7.
    let mut theta = vec![0.0; D];
    theta[0] = 1.8;
    theta[1] = -1.2;
    theta[3] = 1.0;
    theta[7] = -0.8;
    theta[10] = 0.5;
    SyntheticUser {
        theta,
        tau: 0.4,
        cuts: vec![-2.0, -0.9, 0.0, 0.9, 2.0],
    }
}

/// M3 gate 1: duels alone recover θ* (direction) and predict held-out
/// duels far above chance.
#[test]
fn duels_recover_theta() {
    let mut rng = StdRng::seed_from_u64(11);
    let user = ground_truth();

    let mut log = ObservationLog::new();
    for _ in 0..400 {
        let (a, b) = (random_phi(&mut rng), random_phi(&mut rng));
        log.push(user.observe_duel(&mut rng, a, b, 0));
    }

    let model = TasteModel::new(TasteConfig::linear(D));
    let posterior = model.fit(&mut rng, &FitSet::as_is(&log), 30_000, 10_000);

    let theta_hat = posterior.theta_mean(0);
    let cos = cosine(&theta_hat, &user.theta);
    assert!(cos > 0.85, "theta recovery cosine {cos} too low");

    // Held-out predictive accuracy: predict the *modal* outcome
    // (deterministic argmax of true utility), which a perfect model gets
    // ~100% of.
    let mut correct = 0;
    let n_test = 300;
    for _ in 0..n_test {
        let (a, b) = (random_phi(&mut rng), random_phi(&mut rng));
        let truth = user.utility(&a) > user.utility(&b);
        let pred = posterior.prob_prefers(&a, &b) > 0.5;
        if pred == truth {
            correct += 1;
        }
    }
    let acc = correct as f64 / n_test as f64;
    assert!(acc > 0.8, "held-out duel accuracy {acc} too low");
}

/// Naming a fused group changes nothing until its correlation is above
/// zero: an unfused config, a named group with `fused_rho` unset, and one
/// at 0 are the same program, so a fit from one seed draws the same
/// posterior bit for bit.
///
/// That is what matters about the flat path: it is what every unit test,
/// every synthetic user and every saved posterior runs on, and the guard
/// is that both knobs are needed. The fit at ρ = 0.25 differs, so the
/// comparison can fail.
#[test]
fn a_named_group_at_rho_zero_is_the_flat_program() {
    let mut rng = StdRng::seed_from_u64(0xF1A7);
    let user = ground_truth();
    let mut log = ObservationLog::new();
    for _ in 0..20 {
        let (a, b) = (random_phi(&mut rng), random_phi(&mut rng));
        log.push(user.observe_duel(&mut rng, a, b, 0));
    }
    let data = FitSet::as_is(&log);
    let fit = |cfg: &TasteConfig| {
        let mut r = StdRng::seed_from_u64(7);
        TasteModel::new(cfg.clone())
            .fit(&mut r, &data, 2_000, 1_000)
            .samples
    };

    let flat = TasteConfig::mixture(D, 2);
    let mut named_only = flat.clone();
    named_only.fused = vec![vec![2, 5, 0]];
    let mut at_zero = named_only.clone();
    at_zero.fused_rho = Some(0.0);
    let mut on = named_only.clone();
    on.fused_rho = Some(0.25);

    let draws = fit(&flat);
    assert!(
        fit(&named_only) == draws,
        "a named group with ρ unset moved the fit"
    );
    assert!(
        fit(&at_zero) == draws,
        "a named group at ρ = 0 moved the fit"
    );
    assert!(fit(&on) != draws, "a group at ρ = 0.25 changed nothing");
}

/// The site counts the docs quote are the live φ's. `model.rs` quotes 226
/// sites as shipped (K = 5, one session) and 231 with the brightness group;
/// the reference (`taste/likelihoods.md`, `taste/posterior.md`) quotes
/// 49 + S at K = 1 and 225 + S at K = 5. All of them assume d = 44, so a
/// change to φ fails here until they are updated.
#[test]
fn the_site_counts_the_docs_quote_are_the_live_phis() {
    let d = auracle_features::Features::phi_names().len();
    let sites = |k: usize, sessions: usize, fused: bool| {
        let mut cfg = TasteConfig::mixture(d, k);
        if fused {
            cfg.fused = vec![vec![0, 1, 2]];
            cfg.fused_rho = Some(0.25);
        }
        SiteAddrs::new(&cfg, sessions).site_count()
    };
    let docs = "φ moved: update the site counts quoted in model.rs and the reference";
    assert_eq!(sites(1, 1, false), 49 + 1, "{docs}");
    assert_eq!(sites(5, 1, false), 225 + 1, "{docs}");
    assert_eq!(sites(5, 1, false), 226, "{docs}");
    // One latent mean per style for the group, and no other new site.
    assert_eq!(sites(5, 1, true), 231, "{docs}");
}

/// A fused group moves only the prior's covariance, as `fused_rho`'s doc
/// promises: the group's members correlate at ρ within a style, while every
/// coordinate keeps the prior variance σ_θ² it has without the group, and
/// nothing correlates across groups, across styles (each style has its own
/// group mean), or with an unfused coordinate. Read off draws from the
/// model's own prior.
///
/// Over sixteen seeds, at 8 000 draws, the correlations were within 0.027
/// of their targets and every variance within 5.6% of σ_θ²; the bounds are
/// 0.08 and 12%, some seven standard errors.
#[test]
fn a_fused_group_correlates_its_members_and_keeps_their_scale() {
    const DF: usize = 8;
    let mut cfg = TasteConfig::mixture(DF, 2);
    cfg.fused = vec![vec![0, 1], vec![2, 3]];
    cfg.fused_rho = Some(0.5);
    let var = cfg.sigma_theta().powi(2);
    let model = TasteModel::new(cfg.clone());
    let mut rng = StdRng::seed_from_u64(0xC0);
    let draws: Vec<TasteSample> = (0..8_000)
        .map(|_| model.prior_sample(&mut rng, &FitSet::default()))
        .collect();
    let col = |k: usize, i: usize| -> Vec<f64> { draws.iter().map(|s| s.theta[k][i]).collect() };
    let corr = |a: &[f64], b: &[f64]| -> f64 {
        let n = a.len() as f64;
        let (ma, mb) = (a.iter().sum::<f64>() / n, b.iter().sum::<f64>() / n);
        let c = a
            .iter()
            .zip(b)
            .map(|(x, y)| (x - ma) * (y - mb))
            .sum::<f64>()
            / n;
        c / (sample_sd(a) * sample_sd(b))
    };
    for (what, (k, i), (l, j), want) in [
        ("a group, style 0", (0, 0), (0, 1), 0.5),
        ("a group, style 1", (1, 2), (1, 3), 0.5),
        ("two groups", (0, 0), (0, 2), 0.0),
        ("two styles", (0, 0), (1, 0), 0.0),
        ("a member and an unfused coordinate", (0, 1), (0, 4), 0.0),
    ] {
        let r = corr(&col(k, i), &col(l, j));
        assert!(
            (r - want).abs() < 0.08,
            "{what}: correlation {r}, not {want}"
        );
    }
    for k in 0..2 {
        for i in 0..DF {
            let v = sample_sd(&col(k, i)).powi(2);
            assert!(
                (v / var - 1.0).abs() < 0.12,
                "θ[{k}][{i}] has prior variance {v}, not {var}"
            );
        }
    }
    // A correlation outside [0, 1) is clamped into it.
    cfg.fused_rho = Some(1.5);
    assert_eq!(cfg.fused_rho(), 0.99);
    cfg.fused_rho = Some(-0.3);
    assert_eq!(cfg.fused_rho(), 0.0);
}

/// A fused prior over correlated coordinates recovers taste better than a
/// flat one when evidence is thin — which is the whole claim.
///
/// The fixture is φ shaped like the real brightness cluster: coordinates
/// 0, 1 and 2 are one latent quantity plus small independent noise, and
/// the user weights all three. That is the situation a VIF of ~17 reports.
/// Both arms see the **same** duels from the same seed, so the comparison
/// is the prior and nothing else.
///
/// Thin evidence is the point. With enough duels the likelihood swamps any
/// prior and both arms converge, so a test at 400 duels would pass whatever
/// the prior did; 40 is where a prior that says "these three move together"
/// can still be wrong or right.
#[test]
fn a_fused_prior_beats_a_flat_one_on_a_correlated_cluster() {
    let mut rng = StdRng::seed_from_u64(0xB817);
    let mut theta = vec![0.0; D];
    theta[0] = 1.2;
    theta[1] = 1.0;
    theta[2] = 0.9;
    theta[8] = -1.1;
    let user = SyntheticUser {
        theta,
        tau: 0.4,
        cuts: vec![-2.0, -0.9, 0.0, 0.9, 2.0],
    };

    // φ with a genuine brightness cluster: one shared factor, three noisy
    // views of it.
    let correlated = |rng: &mut StdRng| -> Vec<f64> {
        let mut x = random_phi(rng);
        let shared = x[0];
        x[1] = 0.93 * shared + 0.37 * x[1];
        x[2] = 0.90 * shared + 0.44 * x[2];
        x
    };

    let mut log = ObservationLog::new();
    for _ in 0..40 {
        let (a, b) = (correlated(&mut rng), correlated(&mut rng));
        log.push(user.observe_duel(&mut rng, a, b, 0));
    }
    let data = FitSet::as_is(&log);

    let fit = |cfg: TasteConfig, seed: u64| {
        let mut r = StdRng::seed_from_u64(seed);
        let p = TasteModel::new(cfg).fit(&mut r, &data, 20_000, 6_000);
        cosine(&p.theta_mean(0), &user.theta)
    };

    // Across several chain seeds, not one: a single pair proves nothing
    // about a prior, and this codebase has already been bitten once by a
    // statistic that was really about seed luck (see `RefineKeep`).
    let mut wins = 0;
    let (mut sum_flat, mut sum_fused) = (0.0, 0.0);
    for seed in [7u64, 19, 23, 41, 57, 63, 71, 89, 97, 103, 111, 127] {
        let flat = fit(TasteConfig::linear(D), seed);
        let mut cfg = TasteConfig::linear(D);
        cfg.fused = vec![vec![0, 1, 2]];
        cfg.fused_rho = Some(0.25);
        let fused = fit(cfg, seed);
        println!(
            "seed {seed}: flat {flat:.3}  fused {fused:.3}  ({:+.3})",
            fused - flat
        );
        sum_flat += flat;
        sum_fused += fused;
        if fused > flat {
            wins += 1;
        }
    }
    let n = 12.0;
    let (flat, fused) = (sum_flat / n, sum_fused / n);
    println!("mean: flat {flat:.3}  fused {fused:.3}");
    // The bound is the claim, "beats": a higher mean and more wins than
    // losses. Swept over sixteen data seeds (this one and 1 to 15), each
    // with these twelve chain seeds, the mean gain ran from +0.0065 to
    // +0.037 and the wins from 8 to 12 of 12; this data seed is the one at
    // 8. It used to ask for 8, which is where this seed sits, so any
    // correct change to the MCMC stream was a coin toss.
    assert!(
        fused > flat && wins >= 7,
        "fusing the cluster did not help: flat {flat:.3}, fused {fused:.3}, {wins}/12 wins"
    );
}

/// An imputed coordinate makes a keep/kill verdict *less certain*, and
/// leaves a duel alone.
///
/// The asymmetry is the whole point. A duel carries the same absence on
/// both candidates, so the imputed term cancels in `u_a − u_b` and the
/// observation is silent about that axis — correct, and untouched here. A
/// keep/kill has nothing to cancel against: `u(x)` meets a threshold, and
/// a coordinate imputed at the mean enters that sum as though it had been
/// measured and found average. It was not measured at all, and the
/// likelihood now says so by pulling the log-odds toward zero.
#[test]
fn imputation_costs_confidence_on_keep_kill_but_not_on_duels() {
    let mut theta = vec![0.0; D];
    theta[0] = 1.5;
    theta[1] = 1.5;
    theta[2] = 0.8;
    let s = TasteSample {
        theta: vec![theta],
        tau: vec![0.0],
        cuts: vec![-2.0, -0.9, 0.0, 0.9, 2.0],
    };

    let mut x = vec![0.0; D];
    x[2] = 1.0;
    let keep = Feedback::KeepKill {
        x: x.clone(),
        kept: true,
    };

    // Coordinates 0 and 1 carry real weight; imputing them should cost
    // confidence in this verdict.
    let measured = s.loglik_with(&keep, 0, &[]);
    let imputed = s.loglik_with(&keep, 0, &[0, 1]);
    assert!(
        imputed < measured,
        "imputing two weighted axes did not reduce confidence: \
         measured {measured:.4}, imputed {imputed:.4}"
    );
    // Less certain means *closer to a coin flip*, not merely different.
    let coin = 0.5f64.ln();
    assert!(
        (imputed - coin).abs() < (measured - coin).abs(),
        "the correction moved the verdict away from 0.5 instead of toward it"
    );

    // Imputing an axis this listener does not care about costs nothing:
    // its θ is zero, so it contributes no variance.
    let mut theta_z = vec![0.0; D];
    theta_z[2] = 0.8;
    let s0 = TasteSample {
        theta: vec![theta_z],
        ..s.clone()
    };
    assert!(
        (s0.loglik_with(&keep, 0, &[0, 1]) - s0.loglik_with(&keep, 0, &[])).abs() < 1e-12,
        "an imputed axis with zero weight must be free"
    );

    // A duel is untouched: the absence cancels.
    let duel = Feedback::Duel {
        a: x.clone(),
        b: vec![0.0; D],
        chose_a: true,
    };
    assert!(
        (s.loglik_with(&duel, 0, &[0, 1]) - s.loglik_with(&duel, 0, &[])).abs() < 1e-12,
        "a duel must not be attenuated — the imputed term cancels in u_a − u_b"
    );

    // Stars: the attenuation acts on `(c_k − u)`, so it pulls the rating's
    // probability toward the *prior over categories*, exactly as keep/kill
    // is pulled toward a coin. Checked against the marginal it approximates:
    // average `P(rating | u + ε)` over ε ~ N(0, Σ θ_i²) for the imputed
    // axes, by quadrature. The old code scaled `u` instead of the
    // difference and was off from that truth by more than the tolerance
    // here (0.205 against 0.133 at u = 1.5, for one cutpoint).
    let ratings = |x: &[f64], absent: &[usize]| -> Vec<f64> {
        (0..=s.cuts.len() as u8)
            .map(|r| {
                s.loglik_with(
                    &Feedback::Stars {
                        x: x.to_vec(),
                        rating: r,
                    },
                    0,
                    absent,
                )
                .exp()
            })
            .collect()
    };
    let measured = ratings(&x, &[]);
    let imputed = ratings(&x, &[0, 1]);
    assert!(
        (measured.iter().sum::<f64>() - 1.0).abs() < 1e-9
            && (imputed.iter().sum::<f64>() - 1.0).abs() < 1e-9,
        "the ordinal probabilities must sum to one: {measured:?} {imputed:?}"
    );
    // Marginal truth by Gauss–Hermite-free brute force: fine grid over ε.
    let var: f64 = [0, 1].iter().map(|&i| s.theta[0][i] * s.theta[0][i]).sum();
    let sd = var.sqrt();
    let u0 = s.utility_mix(&x);
    let sigmoid = |v: f64| 1.0 / (1.0 + (-v).exp());
    let mut truth = vec![0.0; s.cuts.len() + 1];
    let steps = 4001;
    let mut wsum = 0.0;
    for j in 0..steps {
        let z = -6.0 + 12.0 * j as f64 / (steps - 1) as f64;
        let w = (-0.5 * z * z).exp();
        let u = u0 + sd * z;
        for (k, t) in truth.iter_mut().enumerate() {
            let hi = if k == s.cuts.len() {
                1.0
            } else {
                sigmoid(s.cuts[k] - u)
            };
            let lo = if k == 0 {
                0.0
            } else {
                sigmoid(s.cuts[k - 1] - u)
            };
            *t += w * (hi - lo);
        }
        wsum += w;
    }
    for t in &mut truth {
        *t /= wsum;
    }
    for k in 0..truth.len() {
        assert!(
            (imputed[k] - truth[k]).abs() < 0.03,
            "rating {k}: attenuated {:.3} vs marginal {:.3} (measured {:.3})",
            imputed[k],
            truth[k],
            measured[k]
        );
    }
}

/// A two-lens draw over `D` coordinates with a keep/kill threshold and
/// three star cutpoints, for checking likelihoods by hand.
fn two_lens_draw(rng: &mut StdRng) -> TasteSample {
    TasteSample {
        theta: vec![random_phi(rng), random_phi(rng)],
        tau: vec![0.3],
        cuts: vec![-1.0, 0.0, 1.5],
    }
}

/// Every observation's likelihood is a probability distribution over what
/// the listener could have done, under the max-of-lenses utility: a duel's
/// two outcomes are `σ(±(u_a − u_b))`, a keep and a kill `σ(±(u − τ))`,
/// and the ratings of an ordinal scale sum to one. A rating past the top of
/// the scale reads as the top, and a one-category scale is certain.
#[test]
fn every_likelihood_is_a_distribution_over_its_outcomes() {
    let mut rng = StdRng::seed_from_u64(0x11C);
    let ln_sigmoid = |v: f64| -(1.0 + (-v).exp()).ln();
    for _ in 0..20 {
        let s = two_lens_draw(&mut rng);
        let (a, b, x) = (
            random_phi(&mut rng),
            random_phi(&mut rng),
            random_phi(&mut rng),
        );
        let u = |phi: &[f64]| s.theta.iter().map(|t| dot(t, phi)).fold(f64::MIN, f64::max);

        let duel = |chose_a| Feedback::Duel {
            a: a.clone(),
            b: b.clone(),
            chose_a,
        };
        let won = s.loglik(&duel(true), 0);
        assert!((won - ln_sigmoid(u(&a) - u(&b))).abs() < 1e-12);
        assert!((won.exp() + s.loglik(&duel(false), 0).exp() - 1.0).abs() < 1e-12);

        let keep = |kept| Feedback::KeepKill { x: x.clone(), kept };
        let kept = s.loglik(&keep(true), 0);
        assert!((kept - ln_sigmoid(u(&x) - 0.3)).abs() < 1e-12);
        assert!((kept.exp() + s.loglik(&keep(false), 0).exp() - 1.0).abs() < 1e-12);

        let stars = |rating| Feedback::Stars {
            x: x.clone(),
            rating,
        };
        let top = s.cuts.len() as u8;
        let total: f64 = (0..=top).map(|r| s.loglik(&stars(r), 0).exp()).sum();
        assert!((total - 1.0).abs() < 1e-12, "ratings sum to {total}");
        assert_eq!(s.loglik(&stars(top + 3), 0), s.loglik(&stars(top), 0));

        let one_category = TasteSample {
            cuts: Vec::new(),
            ..s.clone()
        };
        assert_eq!(one_category.loglik(&stars(0), 0), 0.0);
    }
}

/// A keep from a session the posterior has no τ for (one that began after
/// the last fit) carries no threshold evidence: it leaves every draw's
/// weight where it was, while the same keep in a fitted session moves them.
#[test]
fn a_keep_from_a_session_the_fit_never_saw_moves_nothing() {
    let mut rng = StdRng::seed_from_u64(0x5E55);
    let samples: Vec<TasteSample> = (0..50).map(|_| two_lens_draw(&mut rng)).collect();
    let p = TastePosterior {
        cfg: TasteConfig::mixture(D, 2),
        samples,
        weights: Vec::new(),
    };
    let keep = Feedback::KeepKill {
        x: random_phi(&mut rng),
        kept: true,
    };
    let unseen = p.reweighted(&keep, 3);
    assert!(
        (0..p.samples.len()).all(|i| (unseen.weight(i) - p.weight(i)).abs() < 1e-15),
        "a session with no τ moved the weights"
    );
    assert!(p.reweighted(&keep, 0).ess() < p.ess() - 1.0);
}

/// An observation `h` places back in the log weighs `0.5^(h / half_life)` in
/// the likelihood the fit conditions on, the newest weighing 1, so old
/// taste fades as new evidence arrives (the session layer ships a half-life
/// of 150). No half-life, or one that is not positive, weighs every
/// observation alike. Read off the program's own factor, on a prior draw.
#[test]
fn old_votes_fade_by_the_half_life() {
    let mut rng = StdRng::seed_from_u64(0x4A1F);
    let user = ground_truth();
    let mut log = ObservationLog::new();
    for i in 0..12 {
        let (a, b) = (random_phi(&mut rng), random_phi(&mut rng));
        log.push(user.observe_duel(&mut rng, a, b, i % 2));
        let x = random_phi(&mut rng);
        let kept = user.keep(&mut rng, &x);
        log.push(Observation::new(Feedback::KeepKill { x, kept }, i % 2, &[]));
    }
    let data = FitSet::as_is(&log);
    let n = data.len();
    for half_life in [None, Some(0.0), Some(-1.0), Some(5.0)] {
        let mut cfg = TasteConfig::linear(D);
        cfg.recency_half_life = half_life;
        let model = TasteModel::new(cfg);
        let (s, trace) = run(
            PriorHandler {
                rng: &mut rng,
                trace: Trace::default(),
            },
            model.model(&data),
        );
        let weight = |i: usize| match half_life {
            Some(h) if h > 0.0 => 0.5f64.powf((n - 1 - i) as f64 / h),
            _ => 1.0,
        };
        let expected: f64 = data
            .rows
            .iter()
            .enumerate()
            .map(|(i, (o, session))| weight(i) * s.loglik(o, *session))
            .sum();
        assert!(
            (trace.log_factors - expected).abs() < 1e-9 * expected.abs().max(1.0),
            "half-life {half_life:?}: the program weighs the log at {}, not {expected}",
            trace.log_factors
        );
    }
}

/// Alignment to an external reference puts each lens at the index of the
/// reference lens it most resembles — so a refit keeps a style's identity —
/// and a reference with fewer lenses than K leaves the extra lens on the
/// index the reference does not claim.
#[test]
fn aligned_to_keeps_lens_identities_across_fits() {
    let mut rng = StdRng::seed_from_u64(0xA11);
    let a: Vec<f64> = (0..D).map(|i| if i < 4 { 2.0 } else { 0.0 }).collect();
    let b: Vec<f64> = (0..D)
        .map(|i| if i >= D - 4 { -2.0 } else { 0.0 })
        .collect();
    let jitter = |v: &[f64], rng: &mut StdRng| -> Vec<f64> {
        v.iter().map(|x| x + 0.1 * rng.gen::<f64>()).collect()
    };
    // Label-switched draws: half the samples list (a, b), half (b, a).
    let samples: Vec<TasteSample> = (0..200)
        .map(|i| {
            let (x, y) = (jitter(&a, &mut rng), jitter(&b, &mut rng));
            TasteSample {
                theta: if i % 2 == 0 { vec![x, y] } else { vec![y, x] },
                tau: vec![0.0],
                cuts: vec![-2.0, -0.9, 0.0, 0.9, 2.0],
            }
        })
        .collect();
    let post = TastePosterior {
        cfg: TasteConfig::mixture(D, 2),
        samples,
        weights: Vec::new(),
    };
    let to_ab = post.aligned_to(&[a.clone(), b.clone()]);
    let to_ba = post.aligned_to(&[b.clone(), a.clone()]);
    assert!(cosine(&to_ab.theta_mean(0), &a) > 0.99);
    assert!(cosine(&to_ab.theta_mean(1), &b) > 0.99);
    assert!(
        cosine(&to_ba.theta_mean(0), &b) > 0.99,
        "the reference decides the order"
    );
    assert!(cosine(&to_ba.theta_mean(1), &a) > 0.99);
    // K grew: a one-lens reference pins lens 0 and leaves lens 1 free.
    let grown = post.aligned_to(std::slice::from_ref(&b));
    assert!(cosine(&grown.theta_mean(0), &b) > 0.99);
    assert!(cosine(&grown.theta_mean(1), &a) > 0.99);
    // Self-alignment is still coherent (each lens is one thing), whatever
    // order it lands in.
    let selfed = post.aligned();
    let m0 = selfed.theta_mean(0);
    assert!(cosine(&m0, &a) > 0.99 || cosine(&m0, &b) > 0.99);
    // An empty reference (no previous fit) is self-alignment.
    assert_eq!(post.aligned_to(&[]).samples, selfed.samples);

    // One lens has nothing to switch: alignment leaves its draws as they are.
    let one = TastePosterior {
        cfg: TasteConfig::linear(D),
        samples: post
            .samples
            .iter()
            .map(|s| TasteSample {
                theta: vec![s.theta[0].clone()],
                ..s.clone()
            })
            .collect(),
        weights: Vec::new(),
    };
    assert_eq!(one.aligned().samples, one.samples);
    assert_eq!(one.aligned_to(&[b.clone()]).samples, one.samples);
}

/// M3 gate 2: all three modalities condition one posterior; recovery
/// still holds and the keep/kill threshold τ is located.
#[test]
fn mixed_modalities_recover() {
    let mut rng = StdRng::seed_from_u64(22);
    let user = ground_truth();

    let mut log = ObservationLog::new();
    for _ in 0..150 {
        let (a, b) = (random_phi(&mut rng), random_phi(&mut rng));
        log.push(user.observe_duel(&mut rng, a, b, 0));
    }
    for _ in 0..150 {
        let x = random_phi(&mut rng);
        let kept = user.keep(&mut rng, &x);
        log.push(Observation::new(Feedback::KeepKill { x, kept }, 0, &[]));
    }
    for _ in 0..150 {
        let x = random_phi(&mut rng);
        let rating = user.stars(&mut rng, &x);
        log.push(Observation::new(Feedback::Stars { x, rating }, 0, &[]));
    }

    let model = TasteModel::new(TasteConfig::linear(D));
    let posterior = model.fit(&mut rng, &FitSet::as_is(&log), 30_000, 10_000);

    let cos = cosine(&posterior.theta_mean(0), &user.theta);
    assert!(cos > 0.85, "mixed-modality recovery cosine {cos} too low");

    // τ is located: the keep/kill evidence narrows it well inside its
    // N(0, 1) prior, and the truth lies within three of the posterior's own
    // standard deviations of its mean. Swept over twenty seeds (this one and
    // 1 to 19), the posterior SD ran 0.178 to 0.237 and the error 0.01 to
    // 2.43 SDs, median 0.47: the posterior is calibrated, so a fresh draw
    // fails 3 SDs about 0.3% of the time. This seed is the 2.43, which a
    // fixed bound of 0.6 had been set just above.
    let n = posterior.samples.len();
    let tau = |i: usize| posterior.samples[i].tau[0];
    let tau_mean: f64 = (0..n).map(|i| posterior.weight(i) * tau(i)).sum();
    let tau_var: f64 = (0..n)
        .map(|i| posterior.weight(i) * (tau(i) - tau_mean).powi(2))
        .sum();
    let (err, sd) = ((tau_mean - user.tau).abs(), tau_var.sqrt());
    assert!(sd < 0.35, "τ was not located: posterior SD {sd}");
    assert!(
        err < 3.0 * sd,
        "τ posterior mean {tau_mean} is {err} from the truth {}, over 3 SDs of {sd}",
        user.tau
    );
}

/// M3 gate 3: ranking a candidate pool by posterior-mean utility orders it
/// as the listener would, so the top of that order (the exploit half of
/// acquisition) is genuinely good.
///
/// Scored over the whole pool of 100, by Spearman's ρ between the model's
/// ranking and the truth's. The top-10 overlap this used to count is one
/// draw of ten ranks: over twenty seeds it ran 6 to 10 against a bound of 6.
/// ρ over the same twenty seeds (this one and 1 to 19) ran 0.944 to 0.984
/// (this one 0.981), about a hundredth of spread around 0.97.
#[test]
fn posterior_ranks_a_pool() {
    let mut rng = StdRng::seed_from_u64(33);
    let user = ground_truth();

    let mut log = ObservationLog::new();
    for _ in 0..300 {
        let (a, b) = (random_phi(&mut rng), random_phi(&mut rng));
        log.push(user.observe_duel(&mut rng, a, b, 0));
    }
    let model = TasteModel::new(TasteConfig::linear(D));
    let posterior = model.fit(&mut rng, &FitSet::as_is(&log), 30_000, 10_000);

    let pool: Vec<Vec<f64>> = (0..100).map(|_| random_phi(&mut rng)).collect();
    let by_model: Vec<f64> = pool.iter().map(|x| posterior.utility(x, 0).0).collect();
    let by_truth: Vec<f64> = pool.iter().map(|x| user.utility(x)).collect();
    let rho = spearman(&by_model, &by_truth);
    assert!(
        rho > 0.9,
        "the model orders the pool unlike the listener: Spearman ρ {rho}"
    );
}

/// Spearman's rank correlation (no ties among continuous utilities).
fn spearman(a: &[f64], b: &[f64]) -> f64 {
    let ranks = |v: &[f64]| -> Vec<f64> {
        let mut order: Vec<usize> = (0..v.len()).collect();
        order.sort_by(|&i, &j| v[i].total_cmp(&v[j]));
        let mut r = vec![0.0; v.len()];
        for (rank, &i) in order.iter().enumerate() {
            r[i] = rank as f64;
        }
        r
    };
    let (ra, rb) = (ranks(a), ranks(b));
    let n = a.len() as f64;
    let d2: f64 = ra.iter().zip(&rb).map(|(x, y)| (x - y) * (x - y)).sum();
    1.0 - 6.0 * d2 / (n * (n * n - 1.0))
}

/// **The misspecification gate.** Every other user here is linear in the
/// same φ the model is linear in, so the model is correctly specified by
/// construction and the gates only ever measure estimation speed. This one
/// is an ideal-point listener: `u* = −Σ w(φ−c)²`, strictly concave, while
/// `max_k θ_k·φ` is a maximum of affine functions and therefore convex.
/// The model provably cannot represent this user at any K.
///
/// What it *should* still do is rank most pairs, because over any region
/// not straddling the ideal point the true utility is locally monotone.
/// So the assertions are: still clearly better than chance (this can fail,
/// and would if inference broke), and measurably worse than the same
/// machinery on a well-specified user (this can also fail — if it did, the
/// harness would not be sensitive enough to detect misspecification at
/// all, which is the property being established).
#[test]
fn misspecified_user_is_learned_partially_and_detectably() {
    let mut rng = StdRng::seed_from_u64(0x1DEA);
    let mut center = vec![0.0; D];
    let mut weights = vec![0.15; D];
    // A specific sound: bright-ish, not too bright; quiet on dim 1.
    center[0] = 0.8;
    center[1] = -0.6;
    center[3] = 0.4;
    weights[0] = 0.9;
    weights[1] = 0.7;
    weights[3] = 0.5;
    let curved = IdealPointUser { center, weights };
    let linear = ground_truth();

    // Held-out modal accuracy under each user, same budget and inference.
    let accuracy = |rng: &mut StdRng, use_curved: bool| -> f64 {
        let mut log = ObservationLog::new();
        for _ in 0..300 {
            let (a, b) = (random_phi(rng), random_phi(rng));
            log.push(if use_curved {
                curved.observe_duel(rng, a, b, 0)
            } else {
                linear.observe_duel(rng, a, b, 0)
            });
        }
        let posterior = TasteModel::new(TasteConfig::mixture(D, 2)).fit(
            rng,
            &FitSet::as_is(&log),
            20_000,
            6_000,
        );
        let mut correct = 0;
        let n_test = 2_000;
        for _ in 0..n_test {
            let (a, b) = (random_phi(rng), random_phi(rng));
            let truth = if use_curved {
                curved.utility(&a) > curved.utility(&b)
            } else {
                linear.utility(&a) > linear.utility(&b)
            };
            if (posterior.prob_prefers(&a, &b) > 0.5) == truth {
                correct += 1;
            }
        }
        correct as f64 / n_test as f64
    };

    let acc_curved = accuracy(&mut rng, true);
    let acc_linear = accuracy(&mut rng, false);
    println!("misspecified acc {acc_curved:.3} vs well-specified {acc_linear:.3}");

    // Held out over 2 000 pairs, so binomial noise (±0.01) is small beside
    // the spread between seeds. Swept over sixteen seeds (this one and 1 to
    // 15): curved 0.653 to 0.709 (this one 0.667), linear 0.897 to 0.943,
    // and the gap between them 0.19 to 0.28. A gap of a few hundredths
    // would be inside the noise, not a detection, hence 0.1.
    assert!(
        acc_curved > 0.60,
        "a concave user should still be ranked well above chance, got {acc_curved}"
    );
    assert!(
        acc_linear - acc_curved > 0.1,
        "the harness cannot tell a misspecified user ({acc_curved}) from a \
         well-specified one ({acc_linear}) — it would not catch a real one"
    );
}

/// σ_θ must widen with K. `u = max_k u_k` is the max of K standard
/// normals under the prior, whose SD *falls* with K — so at fixed σ_θ,
/// growing the mixture would quietly shrink `Var(u_a − u_b)` and make the
/// model less able to express a strong preference than before.
///
/// Checked on the program itself: draws from the model's own prior, at
/// every K the table covers, score a candidate with ‖φ‖² = d (a
/// standardized candidate's expected norm) at a utility SD of 1, as K = 1
/// does. Each `u_k` is exactly normal for a fixed φ, so `d` is kept small
/// to keep the draws cheap; it changes nothing about the claim. 5 000 draws
/// put the SD within about 1% (over sixteen seeds and every K, at most 3%
/// off); the 5% bound is some five of those, and the table's own digits are
/// checked exactly by `max_normal_sd_is_the_sd_of_the_max_of_k_normals`.
#[test]
fn sigma_theta_compensates_the_k_schedule() {
    const DP: usize = 4;
    let mut rng = StdRng::seed_from_u64(0x51);
    let phi = vec![1.0; DP];
    for k in 1..=MAX_NORMAL_SD.len() {
        let model = TasteModel::new(TasteConfig::mixture(DP, k));
        let us: Vec<f64> = (0..5_000)
            .map(|_| {
                model
                    .prior_sample(&mut rng, &FitSet::default())
                    .utility_mix(&phi)
            })
            .collect();
        let sd = sample_sd(&us);
        assert!((sd - 1.0).abs() < 0.05, "K={k}: prior utility SD {sd}");
    }
    // An explicit override still wins.
    let mut cfg = TasteConfig::mixture(D, 5);
    cfg.theta_prior_std = Some(0.3);
    assert_eq!(cfg.sigma_theta(), 0.3);
}

/// `MAX_NORMAL_SD[K − 1]` is what it says: the SD of the largest of K iid
/// standard normals, to the table's three decimals. Its density is
/// `K φ(x) Φ(x)^(K−1)`, integrated here on a fine grid.
#[test]
fn max_normal_sd_is_the_sd_of_the_max_of_k_normals() {
    let (lo, h, n) = (-10.0, 1e-3, 20_001);
    let x = |i: usize| lo + h * i as f64;
    let pdf = |x: f64| (-0.5 * x * x).exp() / (2.0 * std::f64::consts::PI).sqrt();
    // Φ by the trapezoid rule, from Φ(−10) ≈ 0.
    let mut cdf = vec![0.0; n];
    for i in 1..n {
        cdf[i] = cdf[i - 1] + 0.5 * h * (pdf(x(i - 1)) + pdf(x(i)));
    }
    for (k, &table) in (1..).zip(MAX_NORMAL_SD.iter()) {
        let (mut m1, mut m2) = (0.0, 0.0);
        for (i, c) in cdf.iter().enumerate() {
            let f = k as f64 * pdf(x(i)) * c.powi(k - 1) * h;
            m1 += x(i) * f;
            m2 += x(i) * x(i) * f;
        }
        let sd = (m2 - m1 * m1).sqrt();
        assert!(
            (sd - table).abs() < 5e-4,
            "K={k}: the SD is {sd:.5}, the table says {table}"
        );
    }
}

/// Population standard deviation.
fn sample_sd(v: &[f64]) -> f64 {
    let n = v.len() as f64;
    let m = v.iter().sum::<f64>() / n;
    (v.iter().map(|x| (x - m) * (x - m)).sum::<f64>() / n).sqrt()
}

/// A posterior with no draws (a fit that kept none) is inert: it claims no
/// information (ESS 0, so the session's refit trigger fires), and every
/// update and alignment returns it empty rather than dividing by zero.
#[test]
fn an_empty_posterior_is_inert() {
    let p = TastePosterior {
        cfg: TasteConfig::mixture(D, 2),
        samples: Vec::new(),
        weights: Vec::new(),
    };
    assert_eq!(p.ess(), 0.0);
    let duel = Feedback::Duel {
        a: vec![1.0; D],
        b: vec![0.0; D],
        chose_a: true,
    };
    for q in [
        p.resampled(),
        p.reweighted(&duel, 0),
        p.aligned(),
        p.aligned_to(&[vec![1.0; D]]),
    ] {
        assert!(q.samples.is_empty() && q.weights.is_empty());
        assert_eq!(q.ess(), 0.0);
    }
}

/// Reweighting always leaves the weights a distribution, finite and
/// summing to one, even when the update has nothing finite to say: a vote
/// on a candidate whose φ is not finite (a render that escaped the
/// featurizer's quarantine), or one that every draw still carrying weight
/// rules out entirely, so that every product underflows to zero.
#[test]
fn reweighting_always_leaves_a_distribution() {
    let mut rng = StdRng::seed_from_u64(0xD157);
    let samples: Vec<TasteSample> = (0..20).map(|_| two_lens_draw(&mut rng)).collect();
    let p = TastePosterior {
        cfg: TasteConfig::mixture(D, 2),
        samples,
        weights: Vec::new(),
    };
    let is_distribution = |q: &TastePosterior| {
        q.weights.len() == q.samples.len()
            && q.weights.iter().all(|w| w.is_finite() && *w >= 0.0)
            && (q.weights.iter().sum::<f64>() - 1.0).abs() < 1e-12
    };
    let mut nan = random_phi(&mut rng);
    nan[3] = f64::NAN;
    let unreadable = Feedback::Duel {
        a: nan,
        b: random_phi(&mut rng),
        chose_a: true,
    };
    assert!(is_distribution(&p.reweighted(&unreadable, 0)));

    // All the weight on a draw that loves dimension 0; the vote says the
    // listener hates it, so strongly that draw's likelihood is e^−3000.
    let lens = |sign: f64| {
        let mut t = vec![0.0; D];
        t[0] = sign * 50.0;
        vec![t.clone(), t]
    };
    let decided = TastePosterior {
        cfg: TasteConfig::mixture(D, 2),
        samples: vec![
            TasteSample {
                theta: lens(1.0),
                ..p.samples[0].clone()
            },
            TasteSample {
                theta: lens(-1.0),
                ..p.samples[0].clone()
            },
        ],
        weights: vec![1.0, 0.0],
    };
    let (mut a, mut b) = (vec![0.0; D], vec![0.0; D]);
    a[0] = 30.0;
    b[0] = -30.0;
    let contradiction = Feedback::Duel {
        a,
        b,
        chose_a: false,
    };
    assert!(is_distribution(&decided.reweighted(&contradiction, 0)));
}

/// Every per-style summary is importance-weighted, as the crate's rule
/// asks: between fits the draws stop being equally probable, and an
/// unweighted mean or spread describes a posterior nobody holds. Checked
/// by hand on two draws weighted 3 : 1, whose lenses are deliberately in
/// opposite orders.
#[test]
fn per_style_summaries_are_importance_weighted() {
    let draw = |theta: Vec<Vec<f64>>| TasteSample {
        theta,
        tau: vec![0.0],
        cuts: vec![-1.0, 0.0, 1.0],
    };
    let p = TastePosterior {
        cfg: TasteConfig::mixture(2, 2),
        samples: vec![
            draw(vec![vec![0.0, 1.0], vec![1.0, 0.0]]),
            draw(vec![vec![2.0, 1.0], vec![0.0, 0.5]]),
        ],
        weights: vec![0.75, 0.25],
    };
    // Lens 0 is θ = (0, 1) at 3/4 and (2, 1) at 1/4 (unweighted: mean
    // (1, 1), SD (1, 0)).
    assert_eq!(p.theta_mean(0), vec![0.5, 1.0]);
    assert_eq!(p.theta_std(0), vec![0.75f64.sqrt(), 0.0]);
    // A candidate along (1, 0) is lens 1's in the first draw and lens 0's in
    // the second; one along (0, 1) is lens 0's in both.
    assert_eq!(p.responsibilities(&[1.0, 0.0]), vec![0.25, 0.75]);
    assert_eq!(p.responsibilities(&[0.0, 1.0]), vec![1.0, 0.0]);
    // So the two candidates' shares average to (5/8, 3/8) (unweighted:
    // (3/4, 1/4)).
    assert_eq!(
        p.style_share(&[vec![1.0, 0.0], vec![0.0, 1.0]]),
        vec![0.625, 0.375]
    );
    // No candidates: no claim.
    assert_eq!(p.style_share(&[]), vec![0.0, 0.0]);
}

/// Between full refits the posterior is updated by importance
/// reweighting. It must move toward the evidence, degrade *visibly*
/// (falling ESS) rather than silently, and survive resampling.
#[test]
fn importance_updates_track_new_evidence() {
    let mut rng = StdRng::seed_from_u64(88);
    let user = ground_truth();
    let mut log = ObservationLog::new();
    for _ in 0..40 {
        let (a, b) = (random_phi(&mut rng), random_phi(&mut rng));
        log.push(user.observe_duel(&mut rng, a, b, 0));
    }
    let p =
        TasteModel::new(TasteConfig::linear(D)).fit(&mut rng, &FitSet::as_is(&log), 8_000, 3_000);
    assert!(
        (p.ess() - p.samples.len() as f64).abs() < 1e-6,
        "fit is uniform"
    );

    // A decisive duel: A is far up θ*, B far down. Reweighting must raise
    // the model's probability for that outcome.
    let mut a = vec![0.0; D];
    a[0] = 3.0;
    let mut b = vec![0.0; D];
    b[0] = -3.0;
    let before = p.prob_prefers(&a, &b);
    let after = p
        .reweighted(
            &Feedback::Duel {
                a: a.clone(),
                b: b.clone(),
                chose_a: true,
            },
            0,
        )
        .reweighted(
            &Feedback::Duel {
                a: a.clone(),
                b: b.clone(),
                chose_a: true,
            },
            0,
        );
    assert!(
        after.prob_prefers(&a, &b) > before,
        "reweighting ignored the evidence: {before} → {}",
        after.prob_prefers(&a, &b)
    );
    assert!(
        after.ess() < p.ess(),
        "ESS must show the cost of the update"
    );
    assert!((after.weights.iter().sum::<f64>() - 1.0).abs() < 1e-9);

    let re = after.resampled();
    assert_eq!(re.samples.len(), after.samples.len());
    assert!(
        (re.ess() - re.samples.len() as f64).abs() < 1e-6,
        "resampling restores uniform weights"
    );
    // Resampling preserves the weighted summary it was drawn from.
    assert!((re.prob_prefers(&a, &b) - after.prob_prefers(&a, &b)).abs() < 0.05);
}

/// The one-pass summary the app's per-pick belief is built from is the
/// two summaries it replaces, bit for bit: on draws with uneven weights
/// (a posterior between refits), over random candidates, and where two
/// lenses tie (the lens rule keeps the last of equals either way).
#[test]
fn one_pass_summary_is_utility_and_responsibilities() {
    let mut rng = StdRng::seed_from_u64(0xBE11EF);
    let k = 3;
    let samples: Vec<TasteSample> = (0..200)
        .map(|s| {
            let mut theta: Vec<Vec<f64>> = (0..k).map(|_| random_phi(&mut rng)).collect();
            if s % 7 == 0 {
                theta[2] = theta[0].clone(); // a tie between lenses 0 and 2
            }
            TasteSample {
                theta,
                tau: vec![0.0],
                cuts: vec![-1.0, 0.0, 1.0],
            }
        })
        .collect();
    let raw: Vec<f64> = (0..samples.len())
        .map(|_| rng.gen::<f64>().powi(3))
        .collect();
    let total: f64 = raw.iter().sum();
    let p = TastePosterior {
        cfg: TasteConfig::mixture(D, k),
        samples,
        weights: raw.iter().map(|w| w / total).collect(),
    };
    for _ in 0..50 {
        let phi = random_phi(&mut rng);
        let ((mean, std), resp) = p.utility_mix_and_responsibilities(&phi);
        let (m, s) = p.utility_mix(&phi);
        assert_eq!(mean.to_bits(), m.to_bits(), "mean");
        assert_eq!(std.to_bits(), s.to_bits(), "std");
        let r = p.responsibilities(&phi);
        assert_eq!(resp.len(), r.len());
        for (a, b) in resp.iter().zip(&r) {
            assert_eq!(a.to_bits(), b.to_bits(), "responsibilities");
        }
    }
    assert!(
        (p.ess() - p.samples.len() as f64).abs() > 1.0,
        "the weights are uniform, so weighting was not tested"
    );
}

/// The K = 2 mixture path runs end to end over a log of two sessions (two
/// τ sites), and returns finite summaries per style and mixed, with
/// responsibilities that sum to one after alignment.
#[test]
fn a_two_session_k2_fit_returns_finite_summaries() {
    let mut rng = StdRng::seed_from_u64(66);
    let user = ground_truth();
    let mut log = ObservationLog::new();
    for s in 0..2 {
        for _ in 0..30 {
            let (a, b) = (random_phi(&mut rng), random_phi(&mut rng));
            log.push(user.observe_duel(&mut rng, a, b, s));
        }
    }
    let posterior = TasteModel::new(TasteConfig::mixture(D, 2))
        .fit(&mut rng, &FitSet::as_is(&log), 4_000, 2_000)
        .aligned();
    let phi = random_phi(&mut rng);
    for style in 0..2 {
        let (m, s) = posterior.utility(&phi, style);
        assert!(m.is_finite() && s.is_finite());
    }
    let (m, s) = posterior.utility_mix(&phi);
    assert!(m.is_finite() && s.is_finite());
    let r = posterior.responsibilities(&phi);
    assert!((r.iter().sum::<f64>() - 1.0).abs() < 1e-9);
}

/// **The M6 mixture gate.** A user whose true taste is bimodal — utility
/// = max over two orthogonal-ish component tastes — is a function no
/// single linear θ can represent. The K = 2 marginalized mixture must
/// (a) predict held-out duels better than K = 1, and (b) recover *both*
/// component directions after alignment.
#[test]
fn mixture_captures_bimodal_taste() {
    let mut rng = StdRng::seed_from_u64(77);
    // Mirrored dominant dimension: u* = max(θ_a·φ, θ_b·φ) is V-shaped in
    // φ₀, which no single linear θ can track (its best move is to zero
    // out φ₀ entirely).
    let mut theta_a = vec![0.0; D];
    theta_a[0] = 2.4;
    theta_a[1] = 1.2;
    theta_a[2] = 0.8;
    let mut theta_b = vec![0.0; D];
    theta_b[0] = -2.4;
    theta_b[1] = 1.2;
    theta_b[3] = 0.8;
    let user = MixtureSyntheticUser {
        thetas: vec![theta_a.clone(), theta_b.clone()],
    };

    let mut log = ObservationLog::new();
    for _ in 0..350 {
        let (a, b) = (random_phi(&mut rng), random_phi(&mut rng));
        log.push(user.observe_duel(&mut rng, a, b, 0));
    }

    let p1 =
        TasteModel::new(TasteConfig::linear(D)).fit(&mut rng, &FitSet::as_is(&log), 25_000, 8_000);
    let p2 = TasteModel::new(TasteConfig::mixture(D, 2)).fit(
        &mut rng,
        &FitSet::as_is(&log),
        45_000,
        15_000,
    );

    // (a) held-out modal accuracy.
    let mut correct = [0usize; 2];
    let n_test = 400;
    for _ in 0..n_test {
        let (a, b) = (random_phi(&mut rng), random_phi(&mut rng));
        let truth = user.utility(&a) > user.utility(&b);
        if (p1.prob_prefers(&a, &b) > 0.5) == truth {
            correct[0] += 1;
        }
        if (p2.prob_prefers(&a, &b) > 0.5) == truth {
            correct[1] += 1;
        }
    }
    let acc1 = correct[0] as f64 / n_test as f64;
    let acc2 = correct[1] as f64 / n_test as f64;
    // Swept over sixteen seeds (this one and 1 to 15): the mixture's lead
    // ran 0.118 to 0.208 (this one 0.150; mean 0.157, SD 0.024), its
    // accuracy 0.845 to 0.915, and the weaker style came back at cos 0.927
    // to 0.972 (mean 0.954, SD 0.015). The lead's bound sits 3.6 SDs under
    // its mean and the cosine's 6.8, where a mixture that had lost most of
    // its advantage, or recovered a style only roughly, fails; the 0.02 and
    // 0.6 they replace passed both.
    assert!(
        acc2 > acc1 + 0.07,
        "mixture ({acc2}) does not beat linear ({acc1}) on a bimodal user"
    );
    assert!(acc2 > 0.75, "mixture accuracy {acc2} too low");

    // (b) both true directions are recovered by some aligned style.
    let aligned = p2.aligned();
    let best_cos = |truth: &[f64]| -> f64 {
        (0..2)
            .map(|k| cosine(&aligned.theta_mean(k), truth))
            .fold(f64::NEG_INFINITY, f64::max)
    };
    let (ca, cb) = (best_cos(&theta_a), best_cos(&theta_b));
    assert!(
        ca > 0.85 && cb > 0.85,
        "style recovery too weak: cos_a={ca:.2} cos_b={cb:.2}"
    );
}

/// A file of this process's own, so that test runs in several worktrees at
/// once never read each other's half-written files.
fn scratch_file(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("auracle-taste-{}-{name}", std::process::id()))
}

/// A posterior round-trips through its file bit for bit: its config, its
/// draws and its importance weights. One saved before importance weights
/// existed, under a config from before recency and fused groups, loads as
/// the uniformly weighted posterior it was.
#[test]
fn a_posterior_round_trips_through_its_file() {
    let mut rng = StdRng::seed_from_u64(0x5AFE);
    let user = ground_truth();
    let mut log = ObservationLog::new();
    for _ in 0..20 {
        let (a, b) = (random_phi(&mut rng), random_phi(&mut rng));
        log.push(user.observe_duel(&mut rng, a, b, 0));
    }
    let mut cfg = TasteConfig::mixture(D, 2);
    cfg.recency_half_life = Some(150.0);
    let vote = Feedback::Duel {
        a: random_phi(&mut rng),
        b: random_phi(&mut rng),
        chose_a: true,
    };
    let p = TasteModel::new(cfg)
        .fit(&mut rng, &FitSet::as_is(&log), 1_000, 500)
        .reweighted(&vote, 0);

    let path = scratch_file("posterior.json");
    p.save(&path).unwrap();
    let back = TastePosterior::load(&path);
    std::fs::remove_file(&path).unwrap();
    let back = back.unwrap();
    assert_eq!(back.cfg, p.cfg);
    assert_eq!(back.samples, p.samples);
    assert_eq!(back.weights, p.weights);

    let old = r#"{"cfg":{"n_features":2,"k_styles":1,"n_stars":3,"theta_prior_std":null},
        "samples":[{"theta":[[0.5,-1.0]],"tau":[0.1],"cuts":[-1.0,1.0]},
                   {"theta":[[1.5,0.0]],"tau":[0.2],"cuts":[-1.0,1.0]}]}"#;
    let old: TastePosterior = serde_json::from_str(old).unwrap();
    assert_eq!(
        old.cfg,
        TasteConfig {
            n_stars: 3,
            ..TasteConfig::linear(2)
        }
    );
    assert_eq!(old.ess(), 2.0);
    assert_eq!(old.theta_mean(0), vec![1.0, -0.5]);
}
