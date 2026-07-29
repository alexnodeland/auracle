//! # evosynth-taste
//!
//! The **user model**: a latent utility over patches, fit from human feedback,
//! persisted across sessions.
//!
//! ```text
//! u(x) = θ_z · φ(x)        z ~ per-session style latent (mixture of experts)
//! ```
//!
//! One utility, three observation likelihoods in a single fugue program
//! (DESIGN.md §1.3): Bradley–Terry duels (primary), keep/kill against a
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

pub use model::{TasteConfig, TasteModel, TastePosterior, TasteSample};
pub use observe::{Observation, ObservationLog};
pub use standardize::Standardizer;
pub use synthetic::{MixtureSyntheticUser, SyntheticUser};

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
        let posterior = model.fit(&mut rng, &log, 30_000, 10_000);

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
            log.push(Observation::KeepKill {
                x,
                kept,
                session: 0,
            });
        }
        for _ in 0..150 {
            let x = random_phi(&mut rng);
            let rating = user.stars(&mut rng, &x);
            log.push(Observation::Stars {
                x,
                rating,
                session: 0,
            });
        }

        let model = TasteModel::new(TasteConfig::linear(D));
        let posterior = model.fit(&mut rng, &log, 30_000, 10_000);

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
        let posterior = model.fit(&mut rng, &log, 30_000, 10_000);

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
        let dir = std::env::temp_dir().join("evosynth-taste-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("log.json");
        log.save(&path).unwrap();
        let back = ObservationLog::load(&path).unwrap();
        assert_eq!(back, log);
        assert_eq!(back.n_sessions(), 3);
    }

    /// The standardizer normalizes to zero mean / unit variance and
    /// round-trips dimension.
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
            assert!(mean.abs() < 1e-9);
            assert!((var - 1.0).abs() < 1e-9);
        }
        // Constant column: std floored, no NaN.
        assert!(transformed.iter().all(|r| r[1].abs() < 1e-9));
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
            .fit(&mut rng, &log, 4_000, 2_000)
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

        let p1 = TasteModel::new(TasteConfig::linear(D)).fit(&mut rng, &log, 25_000, 8_000);
        let p2 = TasteModel::new(TasteConfig::mixture(D, 2)).fit(&mut rng, &log, 45_000, 15_000);

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
}
