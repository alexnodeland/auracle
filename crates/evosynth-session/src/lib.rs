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
pub mod map;
pub mod surrogate;

pub use engine::{Candidate, Engine, LineageEvent, Origin, Profile, SessionConfig};
pub use map::{MapPoint, TasteMap};
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
            xs.push(posterior.utility_mix(&c.phi_std).0);
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

        // The learned taste direction itself is interpretable: with a
        // unimodal user, the *dominant* style lens should correlate with θ*
        // (weaker than the synthetic-space gate because real features are
        // correlated with each other; other lenses may idle near the prior).
        let cos = (0..posterior.k_styles())
            .map(|k| cosine(&posterior.theta_mean(k), &user.theta))
            .fold(f64::NEG_INFINITY, f64::max);
        assert!(cos > 0.4, "best theta direction cosine {cos} too low");
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
        let n_refined = engine
            .pool
            .iter()
            .filter(|c| c.origin == Origin::Refined)
            .count();
        // MH at small step counts may reject everything — that's legal — but
        // the machinery must at least run and keep the pool consistent.
        assert!(engine.pool.len() <= engine.cfg.pool_size);
        // Every injected candidate is a lineage event with a real diff.
        assert_eq!(engine.lineage.len(), n_refined);
        for ev in &engine.lineage {
            assert_eq!(ev.kind, "refine");
            assert!(!ev.diff.is_empty());
            assert!(engine.find(ev.child_id).is_some());
        }
        println!("refined candidates injected: {n_refined}");
    }

    /// Locked refinement never touches a locked address: run `refine_from`
    /// with every continuous amp-envelope site locked and assert the child's
    /// amp env is bit-identical to the seed's while *something* else moved.
    #[test]
    fn locked_refinement_respects_locks() {
        let mut rng = StdRng::seed_from_u64(0x10C5);
        let user = ground_truth();
        let cfg = SessionConfig {
            pool_size: 16,
            refine_steps: 20,
            ..Default::default()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.fill_pool(&mut rng);
        for _ in 0..20 {
            let (a, b) = engine.next_duel(&mut rng).unwrap();
            let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
            engine.record_duel(a, b, chose_a);
        }
        engine.fit_posterior(&mut rng);

        let locked = vec![
            "amp#attack".to_string(),
            "amp#decay".to_string(),
            "amp#sustain".to_string(),
            "amp#release".to_string(),
        ];
        let mut children = 0;
        for round in 0..6 {
            let seed_id = engine.pool[round % engine.pool.len()].id;
            let seed_amp = engine.pool[engine.find(seed_id).unwrap()].tree.amp.clone();
            if let Some(child_id) = engine.refine_from(&mut rng, seed_id, &locked) {
                children += 1;
                let child = &engine.pool[engine.find(child_id).unwrap()];
                assert_eq!(child.tree.amp, seed_amp, "locked amp env moved");
                let ev = engine.lineage.last().unwrap();
                assert_eq!(ev.child_id, child_id);
                assert!(ev.diff.iter().all(|d| !d.addr.starts_with("amp#")));
            }
            if children >= 2 {
                break;
            }
        }
        assert!(children > 0, "no locked refinement ever accepted a move");
    }

    /// Hand edits: `commit_edit` inserts the edited tree, links lineage, and
    /// (when flagged) records the improvement duel.
    #[test]
    fn commit_edit_inserts_and_observes() {
        let mut rng = StdRng::seed_from_u64(0xED17);
        let cfg = SessionConfig {
            pool_size: 12,
            ..Default::default()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.fill_pool(&mut rng);
        let original_id = engine.pool[0].id;
        let edited = evosynth_grammar::set_param(
            &engine.pool[0].tree,
            "amp#attack",
            evosynth_grammar::ParamValue::Continuous(0.05),
        )
        .unwrap();

        let obs_before = engine.log.len();
        let child_id = engine
            .commit_edit(Some(original_id), edited.clone(), true)
            .expect("edit commits");
        assert_eq!(engine.log.len(), obs_before + 1, "improvement duel logged");
        let child = &engine.pool[engine.find(child_id).unwrap()];
        assert_eq!(child.origin, Origin::Edited);
        assert_eq!(child.tree, edited);
        let ev = engine.lineage.last().unwrap();
        assert_eq!(ev.kind, "edit");
        assert_eq!((ev.parent_id, ev.child_id), (original_id, child_id));
        // The original survives (protected from eviction).
        assert!(engine.find(original_id).is_some());
    }

    /// The taste map projects every pool member plus history ghosts, with
    /// finite coordinates and sane explained-variance fractions.
    #[test]
    fn taste_map_is_sane() {
        let mut rng = StdRng::seed_from_u64(0x3A9);
        let user = ground_truth();
        let cfg = SessionConfig {
            pool_size: 20,
            ..Default::default()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.fill_pool(&mut rng);
        for _ in 0..10 {
            let (a, b) = engine.next_duel(&mut rng).unwrap();
            let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
            engine.record_duel(a, b, chose_a);
        }
        engine.fit_posterior(&mut rng);
        let map = engine.taste_map();
        let n_pool = engine.pool.len();
        assert_eq!(map.points.len(), n_pool + 20); // 10 duels × 2 ghosts
        assert!(map
            .points
            .iter()
            .all(|p| p.x.is_finite() && p.y.is_finite()));
        assert!(map.points[..n_pool].iter().all(|p| p.id.is_some()));
        assert!(map.points[n_pool..].iter().all(|p| p.id.is_none()));
        assert!(map.explained[0] >= map.explained[1]);
        assert!(map.explained[0] <= 1.0 + 1e-9);
        // The first axis should actually spread the points.
        let xs: Vec<f64> = map.points.iter().map(|p| p.x).collect();
        let spread = xs.iter().cloned().fold(f64::MIN, f64::max)
            - xs.iter().cloned().fold(f64::MAX, f64::min);
        assert!(spread > 1e-6);
    }

    /// Profiles round-trip the log **with** its standardizer, and importing
    /// re-standardizes the pool under the imported standardizer.
    #[test]
    fn profile_roundtrip_carries_standardizer() {
        let mut rng = StdRng::seed_from_u64(0xB0B);
        let cfg = SessionConfig {
            pool_size: 10,
            ..Default::default()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg.clone());
        engine.begin_session();
        engine.fill_pool(&mut rng);
        for _ in 0..5 {
            let (a, b) = engine.next_duel(&mut rng).unwrap();
            engine.record_duel(a, b, true);
        }
        let profile = engine.export_profile();
        let json = serde_json::to_string(&profile).unwrap();
        let back: Profile = serde_json::from_str(&json).unwrap();
        assert_eq!(back.log, engine.log);
        assert_eq!(back.standardizer.as_ref(), engine.standardizer.as_deref());

        // A fresh engine (different pool → different standardizer) adopts
        // the imported one.
        let mut fresh = Engine::new(PatchGrammarPrior::default(), cfg);
        let mut rng2 = StdRng::seed_from_u64(0xB0C);
        fresh.begin_session();
        fresh.fill_pool(&mut rng2);
        fresh.import_profile(back);
        assert_eq!(
            fresh.standardizer.as_deref(),
            engine.standardizer.as_deref()
        );
        assert_eq!(fresh.log, engine.log);
        // Pool φ re-standardized under the imported standardizer.
        let sz = fresh.standardizer.as_ref().unwrap();
        for c in &fresh.pool {
            assert_eq!(c.phi_std, sz.transform(&c.features.phi()));
        }
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
