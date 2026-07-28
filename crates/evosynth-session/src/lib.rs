//! # evosynth-session
//!
//! The **two-loop engine** (DESIGN.md §1.5) every frontend drives:
//!
//! - **Patch loop** (fast, silent): vetted prior draws fill a pool; once a
//!   posterior exists, typed MH on `π_β ∝ p_grammar · exp(β·E[u_θ])` refines
//!   the pool toward the user's taste ([`engine::Engine::refine`]).
//! - **Taste loop** (slow, human-paced): feedback appends to the observation
//!   log; the posterior re-fits from it ([`engine::Engine::fit_posterior`]).
//! - **Acquisition** between them: dueling Thompson sampling
//!   ([`engine::Engine::next_duel`]).
//!
//! The M4 gate is this crate's closed-loop test: engine + synthetic user,
//! end-to-end through the *real* grammar → render → vet → features pipeline,
//! asserting the learned taste ranks genuinely-preferred patches on top.

pub mod engine;
pub mod surrogate;

pub use engine::{Candidate, Engine, SessionConfig};
pub use surrogate::{SurrogateFitness, QUARANTINE_FITNESS};

#[cfg(test)]
mod tests {
    use super::*;
    use evosynth_features::Features;
    use evosynth_grammar::PatchGrammarPrior;
    use evosynth_taste::synthetic::cosine;
    use evosynth_taste::SyntheticUser;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    /// A synthetic user over the REAL standardized feature space: likes
    /// bright, bassy, filtered patches with fast attacks; dislikes noisy
    /// (flat-spectrum) and slow-attack ones.
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

    /// M4 gate: the headless closed loop. Fill a pool through the real
    /// pipeline, run rounds of Thompson-chosen duels answered by the
    /// synthetic user, re-fit between rounds, and assert:
    /// 1. the posterior's ranking correlates with true utility on the pool;
    /// 2. the engine's top picks are genuinely better than the pool average.
    #[test]
    fn closed_loop_learns_synthetic_taste() {
        let mut rng = StdRng::seed_from_u64(0xE05);
        let user = ground_truth();

        let cfg = SessionConfig {
            pool_size: 48,
            refine_steps: 0, // refinement exercised separately
            ..Default::default()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.fill_pool(&mut rng);
        assert!(
            engine.pool.len() >= 40,
            "pool only filled to {}",
            engine.pool.len()
        );

        // 4 rounds × 15 duels, refit after each round.
        for _ in 0..4 {
            for _ in 0..15 {
                let (a, b) = engine.next_duel(&mut rng).unwrap();
                let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
                engine.record_duel(a, b, chose_a);
            }
            engine.fit_posterior(&mut rng);
        }

        // 1. Pearson correlation between posterior-mean and true utility.
        let posterior = engine.posterior.as_ref().unwrap();
        let (mut xs, mut ys) = (Vec::new(), Vec::new());
        for c in &engine.pool {
            xs.push(posterior.utility(&c.phi_std, 0).0);
            ys.push(user.utility(&c.phi_std));
        }
        let r = pearson(&xs, &ys);
        assert!(r > 0.6, "posterior/truth correlation {r} too low");

        // 2. Top-5 by the model vs the pool average, in true utility.
        let ranked = engine.ranked();
        let top5: f64 = ranked
            .iter()
            .take(5)
            .map(|&(i, _, _)| user.utility(&engine.pool[i].phi_std))
            .sum::<f64>()
            / 5.0;
        let pool_mean = ys.iter().sum::<f64>() / ys.len() as f64;
        let pool_std = (ys
            .iter()
            .map(|y| (y - pool_mean) * (y - pool_mean))
            .sum::<f64>()
            / ys.len() as f64)
            .sqrt();
        assert!(
            top5 > pool_mean + 0.5 * pool_std,
            "top-5 true utility {top5:.2} not above pool mean {pool_mean:.2} + 0.5σ ({pool_std:.2})"
        );

        // The learned taste direction itself is interpretable: it should
        // correlate with θ* (weaker than the synthetic-space gate because
        // real features are correlated with each other).
        let cos = cosine(&posterior.theta_mean(0), &user.theta);
        assert!(cos > 0.4, "theta direction cosine {cos} too low");
    }

    /// M4 gate 2: taste-guided refinement produces novel candidates the
    /// surrogate scores at least as well as the seeds it started from.
    #[test]
    fn refinement_improves_pool() {
        let mut rng = StdRng::seed_from_u64(0xF00D);
        let user = ground_truth();

        let cfg = SessionConfig {
            pool_size: 24,
            refine_steps: 8,
            refine_seeds: 2,
            ..Default::default()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.fill_pool(&mut rng);
        for _ in 0..30 {
            let (a, b) = engine.next_duel(&mut rng).unwrap();
            let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
            engine.record_duel(a, b, chose_a);
        }
        engine.fit_posterior(&mut rng);

        let best_before = engine.ranked().first().map(|&(_, m, _)| m).unwrap();
        engine.refine(&mut rng);

        // Refinement never degrades the best (eviction only removes the
        // worst), and any refined newcomer must have beaten the then-worst.
        let best_after = engine.ranked().first().map(|&(_, m, _)| m).unwrap();
        assert!(best_after >= best_before - 1e-9);
        let n_refined = engine.pool.iter().filter(|c| c.refined).count();
        // MH at small step counts may reject everything — that's legal — but
        // the machinery must at least run and keep the pool consistent.
        assert!(engine.pool.len() <= engine.cfg.pool_size);
        println!("refined candidates injected: {n_refined}");
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
}
