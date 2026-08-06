//! # auracle-taste
//!
//! The **user model**: a latent utility over patches, fit from human feedback,
//! persisted across sessions.
//!
//! ```text
//! u(x) = θ_z · φ(x)        z ~ per-session style latent (mixture of experts)
//! ```
//!
//! One utility, three observation likelihoods in a single fugue program (the
//! reference: *One utility, three likelihoods*): Bradley–Terry duels
//! (primary), keep/kill against a
//! per-session threshold latent τ, and ordinal star ratings with learned
//! cutpoints. Inference is fugue's adaptive MH over the taste program;
//! the [`observe::ObservationLog`] is the profile's source of truth and the
//! posterior can always be re-fit from it.
//!
//! Ships at **K = 1** (a one-component mixture *is* Bayesian linear
//! regression); the mixture machinery (per-session style sites) is present
//! and unlocked by config.
//!
//! The M3 gate lives in this crate's tests: a [`synthetic::SyntheticUser`]
//! with ground-truth θ* generates noisy feedback and the posterior must
//! recover θ* and predict held-out choices — the taste core is falsifiable
//! with no UI and no human.

pub mod model;
pub mod observe;
pub mod standardize;
pub mod synthetic;

pub use model::{TasteConfig, TasteModel, TastePosterior, TasteSample, MAX_NORMAL_SD};
pub use observe::{
    Feedback, FitSet, Observation, ObservationLog, Provenance, PHI_SCHEMA, PHI_SCHEMA_STANDARDIZED,
};
pub use standardize::Standardizer;
pub use synthetic::{IdealPointUser, MixtureSyntheticUser, SyntheticUser};

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::StdRng;
    use rand::{Rng, SeedableRng};
    use synthetic::cosine;

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

    /// A fused group adds exactly `K` sites and nothing else, and an unfused
    /// config is untouched.
    ///
    /// The second half is the one that matters for a change like this: the
    /// flat path is what every unit test, every synthetic user and every
    /// existing saved posterior runs on, and it must be the same program node
    /// for node. `mu` is empty without a group, so it is.
    #[test]
    fn fusing_costs_one_site_per_style_and_nothing_when_unused() {
        let flat = TasteConfig::mixture(40, 5);
        let flat_sites = model::SiteAddrs::new(&flat, 1).site_count();
        assert_eq!(flat_sites, 40 * 5 + 1 + 5, "the documented 206");

        // Both knobs are needed, which is itself the guard: naming a group
        // with rho at its default 0 must stay the flat program.
        let mut named_only = flat.clone();
        named_only.fused = vec![vec![2, 5, 0]];
        assert_eq!(
            model::SiteAddrs::new(&named_only, 1).site_count(),
            flat_sites,
            "a named group at rho = 0 must add no sites — off means off"
        );

        let mut fused = named_only.clone();
        fused.fused_rho = Some(0.25);
        let fused_sites = model::SiteAddrs::new(&fused, 1).site_count();
        assert_eq!(
            fused_sites,
            flat_sites + 5,
            "one latent mean per style, and no other new site"
        );
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
        assert!(
            fused > flat && wins >= 8,
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
            "imputing two weighted axes did not reduce confidence:              measured {measured:.4}, imputed {imputed:.4}"
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

        // τ posterior mean near the truth (same scale as u).
        let tau_mean: f64 = posterior.samples.iter().map(|s| s.tau[0]).sum::<f64>()
            / posterior.samples.len() as f64;
        assert!(
            (tau_mean - user.tau).abs() < 0.6,
            "tau posterior mean {tau_mean} far from truth {}",
            user.tau
        );
    }

    /// M3 gate 3: ranking a candidate pool by posterior-mean utility puts
    /// genuinely good candidates on top (the exploit half of acquisition).
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

        // Pool of 100; compare model's top-10 against true top-10.
        let pool: Vec<Vec<f64>> = (0..100).map(|_| random_phi(&mut rng)).collect();
        let mut by_model: Vec<usize> = (0..pool.len()).collect();
        by_model.sort_by(|&i, &j| {
            posterior
                .utility(&pool[j], 0)
                .0
                .total_cmp(&posterior.utility(&pool[i], 0).0)
        });
        let mut by_truth: Vec<usize> = (0..pool.len()).collect();
        by_truth.sort_by(|&i, &j| user.utility(&pool[j]).total_cmp(&user.utility(&pool[i])));

        let top_model: std::collections::HashSet<usize> = by_model[..10].iter().copied().collect();
        let overlap = by_truth[..10]
            .iter()
            .filter(|i| top_model.contains(i))
            .count();
        assert!(
            overlap >= 6,
            "only {overlap}/10 of the true best candidates in the model's top 10"
        );
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
            let n_test = 400;
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

        assert!(
            acc_curved > 0.60,
            "a concave user should still be ranked well above chance, got {acc_curved}"
        );
        assert!(
            acc_curved < acc_linear,
            "the harness cannot tell a misspecified user ({acc_curved}) from a \
             well-specified one ({acc_linear}) — it would not catch a real one"
        );
    }

    /// Observation logs round-trip through JSON (the profile's source of
    /// truth must survive persistence).
    #[test]
    fn log_roundtrips() {
        let mut rng = StdRng::seed_from_u64(44);
        let user = ground_truth();
        let mut log = ObservationLog::new();
        for s in 0..3 {
            let (a, b) = (random_phi(&mut rng), random_phi(&mut rng));
            log.push(user.observe_duel(&mut rng, a, b, s));
        }
        let dir = std::env::temp_dir().join("auracle-taste-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("log.json");
        log.save(&path).unwrap();
        let back = ObservationLog::load(&path).unwrap();
        assert_eq!(back, log);
        assert_eq!(back.n_sessions(), 3);
    }

    /// The standardizer normalizes to zero mean / unit variance and
    /// round-trips dimension.
    ///
    /// The tolerances are still exact, and that is the point: `fit` gained a
    /// runaway-column detector, not a routine trim, so on clean data it is the
    /// plain moments to the last bit. If this test ever needs loosening, the
    /// robustification has started charging the honest columns for the
    /// dishonest ones.
    #[test]
    fn standardizer_standardizes() {
        let mut rng = StdRng::seed_from_u64(55);
        let rows: Vec<Vec<f64>> = (0..500)
            .map(|_| vec![rng.gen::<f64>() * 100.0, 5.0, rng.gen::<f64>() - 3.0])
            .collect();
        let sz = Standardizer::fit(&rows);
        assert_eq!(sz.dimension(), 3);
        let transformed: Vec<Vec<f64>> = rows.iter().map(|r| sz.transform(r)).collect();
        for dim in [0, 2] {
            let col: Vec<f64> = transformed.iter().map(|r| r[dim]).collect();
            let mean = col.iter().sum::<f64>() / col.len() as f64;
            let var = col.iter().map(|x| (x - mean) * (x - mean)).sum::<f64>() / col.len() as f64;
            assert!(mean.abs() < 1e-9, "dim {dim} is not centred: {mean}");
            assert!((var - 1.0).abs() < 1e-9, "dim {dim} scale drifted: {var}");
        }
        // Constant column: std floored, no NaN.
        assert!(transformed.iter().all(|r| r[1].abs() < 1e-9));
    }

    /// A log written before raw-φ logging still loads, and is recognizable
    /// as legacy — silently reading its standardized vectors as raw values
    /// would corrupt the profile it was meant to preserve.
    #[test]
    fn legacy_logs_still_load() {
        let json = r#"{"observations":[
            {"Duel":{"a":[1.0,2.0],"b":[3.0,4.0],"chose_a":true,"session":0}},
            {"KeepKill":{"x":[0.5,0.25],"kept":false,"session":1}},
            {"Stars":{"x":[0.1,0.2],"rating":3,"session":1}}
        ]}"#;
        let log: ObservationLog = serde_json::from_str(json).unwrap();
        assert_eq!(log.len(), 3);
        assert_eq!(log.n_sessions(), 2);
        assert!(
            log.observations.iter().all(|o| !o.is_raw()),
            "legacy observations must not claim to be raw"
        );
        // …and they contribute nothing to a standardizer fit over raw values.
        assert!(log
            .raw_rows(&[String::from("a"), String::from("b")])
            .is_empty());
    }

    /// The point of raw-φ logging: the feature set can change and old votes
    /// still land on the right axes. A renamed/reordered/extended feature set
    /// must re-project by name, and a coordinate the vote predates is imputed
    /// at the standardizer mean — which standardizes to exactly zero, i.e.
    /// "this vote says nothing about that axis".
    #[test]
    fn observations_reproject_by_name() {
        let names_then: Vec<String> = ["bright", "noisy"].iter().map(|s| s.to_string()).collect();
        let mut log = ObservationLog::new();
        log.push(Observation::new(
            Feedback::Duel {
                a: vec![10.0, 1.0],
                b: vec![0.0, 3.0],
                chose_a: true,
            },
            0,
            &names_then,
        ));
        // The feature set later gains a coordinate and swaps the order.
        let names_now: Vec<String> = ["noisy", "warm", "bright"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let sz = Standardizer {
            mean: vec![2.0, 7.0, 5.0],
            std: vec![1.0, 2.0, 5.0],
        };
        let fit = FitSet::build(&log, &names_now, &sz);
        let Feedback::Duel { a, b, chose_a } = &fit.rows[0].0 else {
            panic!("modality changed");
        };
        assert!(chose_a);
        // noisy: (1−2)/1, warm: absent ⇒ 0, bright: (10−5)/5.
        assert_eq!(a, &vec![-1.0, 0.0, 1.0]);
        assert_eq!(b, &vec![1.0, 0.0, -1.0]);
        assert_eq!(log.raw_rows(&names_then).len(), 2, "raw rows are fittable");
    }

    /// σ_θ must widen with K. `u = max_k u_k` is the max of K standard
    /// normals under the prior, whose SD *falls* with K — so at fixed σ_θ,
    /// growing the mixture would quietly shrink `Var(u_a − u_b)` and make the
    /// model less able to express a strong preference than before.
    #[test]
    fn sigma_theta_compensates_the_k_schedule() {
        let s1 = TasteConfig::linear(D).sigma_theta();
        let mut prev = s1;
        for k in 2..=5 {
            let s = TasteConfig::mixture(D, k).sigma_theta();
            assert!(s > prev, "sigma did not widen from K={} to K={k}", k - 1);
            prev = s;
        }
        assert!(
            (s1 - 1.0 / (D as f64).sqrt()).abs() < 1e-12,
            "K=1 unchanged"
        );
        // Var(u_a − u_b) restored to its K=1 value, to within the table.
        for k in 1..=5 {
            let s = TasteConfig::mixture(D, k).sigma_theta();
            let sd_u = s * (D as f64).sqrt() * MAX_NORMAL_SD[k - 1];
            assert!((sd_u - 1.0).abs() < 1e-9, "K={k} utility SD {sd_u}");
        }
        // An explicit override still wins.
        let mut cfg = TasteConfig::mixture(D, 5);
        cfg.theta_prior_std = Some(0.3);
        assert_eq!(cfg.sigma_theta(), 0.3);
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
        let p = TasteModel::new(TasteConfig::linear(D)).fit(
            &mut rng,
            &FitSet::as_is(&log),
            8_000,
            3_000,
        );
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

    /// K = 2 smoke: the mixture path runs end-to-end and returns finite
    /// summaries, weights sum to one, and alignment is well-formed.
    #[test]
    fn k2_smoke() {
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

        let p1 = TasteModel::new(TasteConfig::linear(D)).fit(
            &mut rng,
            &FitSet::as_is(&log),
            25_000,
            8_000,
        );
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
        assert!(
            acc2 > acc1 + 0.02,
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
            ca > 0.6 && cb > 0.6,
            "style recovery too weak: cos_a={ca:.2} cos_b={cb:.2}"
        );
    }

    /// A log written before provenance existed still loads, and every row in
    /// it reads as the thing it was: a dealt duel. The observation log is one
    /// IndexedDB blob with no schema version, so compatibility is by
    /// construction or it is nothing — and the alternative to a default here
    /// is a saved profile that fails to parse and takes a user's whole taste
    /// history with it.
    #[test]
    fn a_log_written_before_provenance_still_loads() {
        let old = r#"{"observations":[
            {"feedback":{"Duel":{"a":[0.5],"b":[0.25],"chose_a":true}},
             "session":0,"feature_names":["x"],"schema_version":2},
            {"KeepKill":{"x":[0.1],"kept":true,"session":1}}
        ]}"#;
        let log: ObservationLog = serde_json::from_str(old).expect("an old log parses");
        assert_eq!(log.len(), 2);
        assert!(log
            .observations
            .iter()
            .all(|o| o.provenance == Provenance::Duel));
        assert_eq!(log.n_with(Provenance::Duel), 2);
        assert_eq!(log.n_with(Provenance::SelfReport), 0);

        // And the tag round-trips when it is not the default, while a default
        // one stays off the wire — an old reader sees exactly what it saw.
        let mut log = log;
        log.push(Observation::tagged(
            Feedback::KeepKill {
                x: vec![0.7],
                kept: false,
            },
            2,
            &["x".to_string()],
            Provenance::SelfReport,
        ));
        let json = serde_json::to_string(&log).unwrap();
        assert!(json.contains("self_report"));
        assert_eq!(
            json.matches("provenance").count(),
            1,
            "the default was serialized"
        );
        let back: ObservationLog = serde_json::from_str(&json).unwrap();
        assert_eq!(back, log);
    }
}
