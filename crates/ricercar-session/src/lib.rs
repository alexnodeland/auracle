//! # ricercar-session
//!
//! The **two-loop engine** (DESIGN.md §1.5) every frontend drives:
//!
//! - **Patch loop** (fast, silent): vetted prior draws fill a pool; once a
//!   posterior exists, a short typed-MH walk on
//!   `π_β ∝ p_grammar · exp(β·E[u_θ])` moves the pool toward the user's taste
//!   ([`engine::Engine::refine`]). Local refinement on that target, not a
//!   draw from it.
//! - **Taste loop** (slow, human-paced): feedback appends to the observation
//!   log as raw φ; the posterior re-fits from it, standardizing at fit time
//!   ([`engine::Engine::fit_posterior`]). Between fits each vote is folded in
//!   by importance reweighting, so the next question responds to the last
//!   answer.
//! - **Acquisition** between them: BALD — expected information gain about θ
//!   ([`engine::Engine::next_duel`]), which measurably beats the dueling
//!   Thompson rule it replaced and ties uniformly-random pairing
//!   ([`engine::Acquisition`] carries the numbers).
//!
//! The M4 gate is this crate's closed-loop test: engine + synthetic user,
//! end-to-end through the *real* grammar → render → vet → features pipeline,
//! asserting the learned taste ranks genuinely-preferred patches on top.

pub mod calib;
pub mod engine;
pub mod farm;
pub mod map;
pub mod migrate;
pub mod naming;
pub mod surrogate;

pub use calib::{calibration, Calibration, Forecast, ReliabilityBin};
pub use engine::{
    phi_names, tilt_weights, Acquisition, BankEntry, Candidate, Contribution, DuelChoice, Engine,
    Explanation, ImplicitEvent, LineageEvent, Origin, Profile, RenderPolicy, SessionConfig,
    SessionState,
};
pub use farm::{draw_seed, Draw, PreFeaturized};
pub use map::{MapPoint, TasteMap};
pub use naming::{claim_name, NameScale};
pub use surrogate::{SurrogateFitness, QUARANTINE_FITNESS};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calib::{calibration, Forecast};

    /// Test-scale engine config.
    ///
    /// Identical to the shipped default except for the MCMC budget. The gap
    /// used to be 5× (6k against a shipped 30k) and existed because a suite
    /// that fits dozens of times could not afford the shipped chain; the
    /// shipped default is now 10k/3k, so the gap is 1.7× and this is a
    /// trim rather than a different regime.
    ///
    /// It is kept, narrowed, for the tests whose subject is *machinery* —
    /// that refinement injects lineage, that locks hold, that state
    /// round-trips — where the posterior only has to be a posterior. The one
    /// test whose subject is the posterior's *quality*
    /// ([`closed_loop_learns_synthetic_taste`]) opts back up to the shipped
    /// budget, because a quality gate measured on a chain no user runs is not
    /// a gate on anything shipped.
    fn fast() -> SessionConfig {
        SessionConfig {
            mcmc_samples: 6_000,
            mcmc_warmup: 2_000,
            ..Default::default()
        }
    }
    use rand::rngs::StdRng;
    use rand::SeedableRng;
    use ricercar_features::Features;
    use ricercar_grammar::PatchGrammarPrior;
    use ricercar_taste::synthetic::cosine;
    use ricercar_taste::SyntheticUser;

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

    /// The taste→grammar tilt: positive structural θ inflates its kind's
    /// proposal weight, negative deflates, multipliers are clamped so no
    /// kind starves, and the result is a normalized distribution.
    #[test]
    fn proposal_tilt_follows_taste() {
        let base = [0.2, 0.35, 0.15, 0.15, 0.15];
        // Loves delays (idx 3), hates folds (idx 2).
        let tilts = [0.0, 0.0, -3.0, 3.0, 0.0];
        let w = tilt_weights(&base, &tilts, 0.6);
        assert!((w.iter().sum::<f64>() - 1.0).abs() < 1e-12, "normalized");
        assert!(w[3] > base[3], "loved kind gains mass");
        assert!(w[2] < base[2], "hated kind loses mass");
        // Clamp: even an extreme tilt keeps every kind proposable.
        let extreme = tilt_weights(&base, &[-50.0, 50.0, 0.0, 0.0, 0.0], 1.0);
        assert!(extreme[0] > 0.01, "clamped kind never starves");
        // η = 0 is the identity (up to normalization).
        let id = tilt_weights(&base, &tilts, 0.0);
        for (a, b) in id.iter().zip(&base) {
            assert!((a - b).abs() < 1e-12);
        }
    }

    /// Progressive boot, end to end at the engine layer:
    ///
    /// 1. a partially filled pool has **no duel in it** — `next_duel` skips
    ///    un-standardized candidates, which is precisely what used to force a
    ///    frontend to wait out the whole fill;
    /// 2. `standardize_now` makes it duel-able without rendering anything;
    /// 3. it never moves a standardizer that already exists, so candidates
    ///    arriving behind the user join the scale their neighbours are on;
    /// 4. `restandardize_if_untaught` widens the scale to the finished pool,
    ///    but refuses once θ has been fit against it.
    #[test]
    fn partial_pool_becomes_duelable_and_the_scale_holds_still() {
        let mut rng = StdRng::seed_from_u64(0xB007);
        // A target far above what we draw, so `fill_pool_step`'s own
        // "the pool reached pool_size" standardization never fires and we are
        // testing the mid-fill state a progressive boot actually lives in.
        let cfg = SessionConfig {
            pool_size: 32,
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        assert!(
            engine.fill_pool_step(&mut rng, 4) >= 2,
            "pool too small to test"
        );
        assert!(
            engine.pool.iter().all(|c| c.phi_std.is_empty()),
            "a short pool standardized itself"
        );
        assert!(
            engine.next_duel(&mut rng).is_none(),
            "an un-standardized pool must not be duel-able"
        );

        engine.standardize_now();
        assert!(engine.pool.iter().all(|c| !c.phi_std.is_empty()));
        assert!(
            engine.next_duel(&mut rng).is_some(),
            "standardize_now did not make the partial pool duel-able"
        );
        let provisional = engine.standardizer.clone().expect("standardizer fit");

        // The fill continues behind the user. New members must be admitted on
        // the *existing* scale — a standardizer that moved here would shift
        // every utility on screen mid-session.
        assert!(engine.fill_pool_step(&mut rng, 4) >= 1);
        engine.standardize_now();
        assert_eq!(
            engine.standardizer.as_deref(),
            Some(&*provisional),
            "standardize_now replaced a live standardizer"
        );
        assert!(engine.pool.iter().all(|c| !c.phi_std.is_empty()));

        // Fill complete, still untaught: widening to the full pool is free
        // and lossless, because the log keeps raw φ.
        engine.restandardize_if_untaught();
        assert_ne!(
            engine.standardizer.as_deref(),
            Some(&*provisional),
            "the completion re-fit did nothing"
        );

        // Taught: the scale is now the one θ is denominated in, and must not
        // move underneath it.
        engine.record_duel(0, 1, true);
        engine.fit_posterior(&mut rng);
        let taught = engine.standardizer.clone().expect("standardizer after fit");
        assert!(engine.fill_pool_step(&mut rng, 2) >= 1);
        engine.restandardize_if_untaught();
        assert_eq!(
            engine.standardizer.as_deref(),
            Some(&*taught),
            "re-standardized under a live posterior"
        );
    }

    /// Persistence round-trip: export a session, restore it into a fresh
    /// engine, and everything that matters survives — bank (ids, trees,
    /// names, origins), log, standardizer geometry, lineage, and id
    /// allocation (new ids never collide with restored ones).
    #[test]
    fn session_state_roundtrips() {
        let mut rng = StdRng::seed_from_u64(0x5AFE);
        let cfg = SessionConfig {
            pool_size: 8,
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg.clone());
        engine.begin_session();
        engine.fill_pool(&mut rng);
        assert!(engine.pool.len() >= 4, "pool too small to test");
        engine.record_duel(0, 1, true);
        engine.record_keep(2, false);
        let named_id = engine.pool[0].id;
        engine.set_name(named_id, "My Bass");

        let json = serde_json::to_string(&engine.export_state()).unwrap();
        let state: SessionState = serde_json::from_str(&json).unwrap();

        let mut restored = Engine::new(PatchGrammarPrior::default(), cfg);
        restored.begin_session();
        let n = restored.import_state(state);
        assert_eq!(n, engine.pool.len(), "bank entries lost in restore");
        assert_eq!(restored.log.len(), 2, "observations lost");
        for (a, b) in engine.pool.iter().zip(&restored.pool) {
            assert_eq!(a.id, b.id);
            assert_eq!(a.tree, b.tree);
            assert_eq!(a.name, b.name);
            assert_eq!(a.origin, b.origin);
            // φ must be re-standardized under the SAME standardizer.
            for (x, y) in a.phi_std.iter().zip(&b.phi_std) {
                assert!((x - y).abs() < 1e-9, "phi drifted across restore");
            }
            assert_eq!(
                b.render.is_some(),
                restored.cfg.render_policy == RenderPolicy::Eager,
                "only an eager pool carries audition audio at admission"
            );
            assert_eq!(a.key, b.key, "content address must survive a round trip");
        }
        // Fresh ids allocated after restore never collide.
        let max_old = engine.pool.iter().map(|c| c.id).max().unwrap();
        let new_id = restored
            .insert_preset(ricercar_grammar::presets()[0].1.clone(), "p")
            .unwrap();
        assert!(new_id > max_old, "id allocation collided after restore");
    }

    /// Deferring the audition buffer must cost nothing but time: the buffer a
    /// lazy pool materializes on demand is the *same buffer* an eager pool
    /// kept, sample for sample. If it were not, the scope a user sees and the
    /// audio they hear would drift apart from the render φ was measured on.
    ///
    /// Also pins the bound: `audio_cache` is what keeps a lazy pool's audition
    /// memory flat no matter how much of the bank gets played.
    #[test]
    fn lazy_renders_are_bit_identical_and_bounded() {
        let base = |policy| SessionConfig {
            pool_size: 4,
            render_policy: policy,
            audio_cache: 2,
            ..fast()
        };

        let mut rng = StdRng::seed_from_u64(0xA1D10);
        let mut eager = Engine::new(PatchGrammarPrior::default(), base(RenderPolicy::Eager));
        eager.fill_pool(&mut rng);

        // Same seed, same prior, same draws — only the retention policy differs.
        let mut rng = StdRng::seed_from_u64(0xA1D10);
        let mut lazy = Engine::new(PatchGrammarPrior::default(), base(RenderPolicy::Lazy));
        lazy.fill_pool(&mut rng);

        assert!(eager.pool.len() >= 3, "pool too small to test");
        assert_eq!(eager.pool.len(), lazy.pool.len(), "policy changed the pool");
        assert!(
            eager.pool.iter().all(|c| c.render.is_some()),
            "eager pool dropped a buffer"
        );
        assert!(
            lazy.pool.iter().all(|c| c.render.is_none()),
            "lazy pool retained a buffer at admission"
        );

        // Emptying the memo forces the *re-render* path (`render_playback`)
        // rather than a warm hit — the case that has to be bit-exact.
        lazy.memo().clear();

        let ids: Vec<u64> = lazy.pool.iter().map(|c| c.id).collect();
        for (k, id) in ids.iter().enumerate() {
            let want = eager.pool[k].render.clone().expect("eager keeps audio");
            let got = lazy.render_of(*id).expect("lazy materializes").clone();
            assert_eq!(got.sample_rate, want.sample_rate);
            assert_eq!(
                got.samples, want.samples,
                "lazily materialized audition drifted from the featurized render"
            );
        }
        assert_eq!(
            lazy.pool.iter().filter(|c| c.render.is_some()).count(),
            2,
            "audio_cache did not bound resident audition buffers"
        );

        // Headless callers keep nothing and are told so, rather than being
        // handed a buffer they never asked to pay for.
        let mut rng = StdRng::seed_from_u64(0xA1D10);
        let mut none = Engine::new(PatchGrammarPrior::default(), base(RenderPolicy::None));
        none.fill_pool(&mut rng);
        let id = none.pool[0].id;
        assert!(none.render_of(id).is_none());
    }

    /// Every featurization the engine performs goes through the memo. The
    /// sharpest way to say that: hand a restore the memo the fill populated
    /// and it must not render *anything* — today `import_state` re-featurizes
    /// every bank entry, which is why a returning user pays a full cold boot.
    #[test]
    fn every_featurize_site_consults_the_memo() {
        let cfg = SessionConfig {
            pool_size: 5,
            render_policy: RenderPolicy::Lazy,
            ..fast()
        };
        let mut rng = StdRng::seed_from_u64(0xF00D);
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg.clone());
        engine.fill_pool(&mut rng);
        assert!(engine.pool.len() >= 3, "pool too small to test");

        let before = engine.memo().stats();
        assert!(
            before.misses >= engine.pool.len() as u64,
            "fill did not populate the memo"
        );

        let n = engine.pool.len();
        let state = engine.export_state();
        let mut restored = Engine::new(PatchGrammarPrior::default(), cfg);
        restored.set_memo(engine.memo().clone());
        assert_eq!(restored.import_state(state), n, "bank entries lost");

        let after = restored.memo().stats();
        assert_eq!(
            after.misses,
            before.misses,
            "restore re-rendered {} terms the memo already held",
            after.misses - before.misses
        );
        assert_eq!(after.hits, before.hits + n as u64);

        // A hit is indistinguishable from a miss — including in the raw φ that
        // would enter the observation log.
        for (a, b) in engine.pool.iter().zip(&restored.pool) {
            assert_eq!(a.key, b.key);
            assert_eq!(a.features.phi(), b.features.phi());
            assert_eq!(a.features.gain_db, b.features.gain_db);
        }
    }

    /// The memo must be invisible to everything except wall time. Same seed,
    /// same pool — every id, term, key, raw φ and standardized φ — whether a
    /// featurization was computed or replayed. `RenderMemo::disabled()` is
    /// behaviourally the un-memoized engine, so this is the A/B.
    #[test]
    fn the_memo_does_not_change_the_pool() {
        let build = |memo: ricercar_features::RenderMemo| {
            let cfg = SessionConfig {
                pool_size: 6,
                ..fast()
            };
            let mut rng = StdRng::seed_from_u64(0x11EE);
            let mut e = Engine::new(PatchGrammarPrior::default(), cfg);
            e.set_memo(memo);
            e.begin_session();
            e.fill_pool(&mut rng);
            e
        };
        let memoized = build(ricercar_features::RenderMemo::default());
        let plain = build(ricercar_features::RenderMemo::disabled());

        assert!(memoized.pool.len() >= 3, "pool too small to test");
        assert_eq!(memoized.pool.len(), plain.pool.len(), "pool size changed");
        for (a, b) in memoized.pool.iter().zip(&plain.pool) {
            assert_eq!(a.id, b.id);
            assert_eq!(a.tree, b.tree, "the memo changed which terms were drawn");
            assert_eq!(a.key, b.key);
            assert_eq!(a.features.phi(), b.features.phi(), "φ drifted");
            assert_eq!(a.phi_std, b.phi_std);
        }
        assert_eq!(plain.memo().stats().features, 0, "disabled memo retained");
    }

    /// M4 gate: the headless closed loop. Fill a pool through the real
    /// pipeline, run rounds of acquisition-chosen duels answered by the
    /// synthetic user, re-fit between rounds, and assert:
    /// 1. the posterior's ranking correlates with true utility on the pool;
    /// 2. the engine's top picks are genuinely better than the pool average;
    /// 3. the dominant style lens points roughly at the true θ.
    ///
    /// **Run over a fixed set of seeds, with the gates on the means.** One
    /// run of this loop is a single draw — over the pool lottery, the duel
    /// answers and the MH chain — and the seed-to-seed spread of `r` is
    /// sd ≈ 0.08 across a range of ≈ 0.25, wider than the difference between
    /// any two MCMC budgets from 6 000 steps up (the measurement is in
    /// [`SessionConfig::mcmc_samples`]). At the shipped budget a single-seed
    /// `r > 0.6` gate fails on ~2 of 13 draws, so a one-seed version of this
    /// test would go red about 15 % of the time for any change that merely
    /// perturbs the upstream RNG stream — grammar, features, render,
    /// acquisition, or the fit itself — while telling you nothing about the
    /// change. The seeds run concurrently, so the wall cost is ~one run.
    ///
    /// The surviving per-seed asserts are deliberately loose floors — "this
    /// seed learned *something*" — set below the worst of 13 seeds at the
    /// shipped budget (min r 0.551, min cos 0.315). They catch a loop that
    /// stopped working; they are not the gate.
    #[test]
    fn closed_loop_learns_synthetic_taste() {
        // Fixed, not drawn: a regression gate has to fail for the same
        // reason twice. 0xE05 leads — it is the historical single seed, so
        // its printed line still reproduces the numbers the budget tables
        // were read off.
        const SEEDS: [u64; 5] = [0xE05, 0x1, 0x2, 0x3, 0x4];

        /// One closed loop. Returns `(r, top5, pool mean + 0.5σ, best cos)`.
        fn one(seed: u64) -> (f64, f64, f64, f64) {
            let mut rng = StdRng::seed_from_u64(seed);
            let user = ground_truth();

            let cfg = SessionConfig {
                pool_size: 48,
                refine_steps: 0, // refinement exercised separately
                // The shipped MCMC budget, not the suite's trimmed one: this
                // is the gate on how good the posterior a real user gets is,
                // so it must be measured on the chain a real user runs.
                // Affordable now that the default is 10k rather than 30k.
                mcmc_samples: SessionConfig::default().mcmc_samples,
                mcmc_warmup: SessionConfig::default().mcmc_warmup,
                ..fast()
            };
            let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
            engine.begin_session();
            engine.fill_pool(&mut rng);
            assert!(
                engine.pool.len() >= 40,
                "seed {seed:#x}: pool only filled to {}",
                engine.pool.len()
            );

            // 4 rounds × 15 duels, refit after each round.
            for _ in 0..4 {
                for _ in 0..15 {
                    let (a, b) = engine.next_duel(&mut rng).unwrap();
                    let chose_a =
                        user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
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

            // 2. Top-5 by the model vs the pool average, in true utility.
            let top5: f64 = engine
                .ranked()
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

            // 3. The learned taste direction itself is interpretable: with a
            // unimodal user, the *dominant* style lens should correlate with
            // θ* (weaker than the synthetic-space gate because real features
            // are correlated with each other; other lenses may idle near the
            // prior). With dynamic K the taste spreads across several lenses
            // even for a unimodal user, so per-lens directions are diluted
            // relative to a K=1 fit — this is an interpretability sanity
            // floor, not the gate (the predictive metrics are).
            let cos = (0..posterior.k_styles())
                .map(|k| cosine(&posterior.theta_mean(k), &user.theta))
                .fold(f64::NEG_INFINITY, f64::max);

            (r, top5, pool_mean + 0.5 * pool_std, cos)
        }

        let rows: Vec<(u64, (f64, f64, f64, f64))> = std::thread::scope(|s| {
            let handles: Vec<_> = SEEDS
                .iter()
                .map(|&seed| s.spawn(move || (seed, one(seed))))
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });

        for (seed, (r, _, _, cos)) in &rows {
            assert!(
                *r > 0.45,
                "seed {seed:#x}: posterior/truth correlation {r:.3} under the per-seed floor"
            );
            assert!(
                *cos > 0.2,
                "seed {seed:#x}: best theta cosine {cos:.3} under the per-seed floor"
            );
        }

        let n = rows.len() as f64;
        let mean_r = rows.iter().map(|(_, m)| m.0).sum::<f64>() / n;
        let mean_top5 = rows.iter().map(|(_, m)| m.1).sum::<f64>() / n;
        let mean_bar = rows.iter().map(|(_, m)| m.2).sum::<f64>() / n;
        let mean_cos = rows.iter().map(|(_, m)| m.3).sum::<f64>() / n;

        assert!(
            mean_r > 0.6,
            "posterior/truth correlation {mean_r:.3} averaged over {} seeds too low",
            rows.len()
        );
        assert!(
            mean_top5 > mean_bar,
            "mean top-5 true utility {mean_top5:.2} not above mean pool mean+0.5σ ({mean_bar:.2})"
        );
        assert!(
            mean_cos > 0.3,
            "mean best theta direction cosine {mean_cos:.3} too low"
        );

        // Printed, not just asserted: these are the recovery metrics the MCMC
        // budget is traded against, and a budget change is only defensible
        // against their *margins* — per seed, so the spread stays visible.
        for (seed, (r, top5, bar, cos)) in &rows {
            println!("  seed {seed:#x}: r={r:.3}  top5={top5:.3} (vs {bar:.3})  cos={cos:.3}");
        }
        println!(
            "closed loop @ {}+{} steps, {} seeds: mean r={mean_r:.3} (gate 0.6)  \
             mean top5={mean_top5:.3} vs {mean_bar:.3} (gate)  mean cos={mean_cos:.3} (gate 0.3)",
            SessionConfig::default().mcmc_samples,
            SessionConfig::default().mcmc_warmup,
            rows.len(),
        );
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
            ..fast()
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
            ..fast()
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
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.fill_pool(&mut rng);
        let original_id = engine.pool[0].id;
        let edited = ricercar_grammar::set_param(
            &engine.pool[0].tree,
            "amp#attack",
            ricercar_grammar::ParamValue::Continuous(0.05),
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
            ..fast()
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
            ..fast()
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

    /// The lock rejection region must be **symmetric**, or the
    /// Metropolis-within-Gibbs argument that makes locking exact does not
    /// hold. Scanning only the *previous* trace lets a birth at a locked
    /// address through while rejecting the death that would undo it, so the
    /// chain can wander into locked structure it can never leave.
    #[test]
    fn locks_are_symmetric_over_births() {
        use fugue::runtime::trace::{Choice, ChoiceValue};
        use fugue::{Address, Trace};

        let trace_with = |addrs: &[(&str, f64)]| {
            let mut t = Trace::default();
            for (a, v) in addrs {
                let addr = Address::from(a.to_string());
                t.choices.insert(
                    addr.clone(),
                    Choice {
                        addr,
                        value: ChoiceValue::F64(*v),
                        logp: 0.0,
                    },
                );
            }
            t
        };
        let locked: std::collections::HashSet<String> = ["amp#attack".to_string()].into();

        let absent = trace_with(&[("osc#wave", 1.0)]);
        let present = trace_with(&[("osc#wave", 1.0), ("amp#attack", 0.3)]);
        let changed = trace_with(&[("osc#wave", 1.0), ("amp#attack", 0.9)]);
        let untouched = trace_with(&[("osc#wave", 2.0), ("amp#attack", 0.3)]);

        // Birth and death of a locked address are both violations.
        assert!(Engine::violates_locks(&absent, &present, &locked), "birth");
        assert!(Engine::violates_locks(&present, &absent, &locked), "death");
        // …and edits, in both directions.
        assert!(Engine::violates_locks(&present, &changed, &locked));
        assert!(Engine::violates_locks(&changed, &present, &locked));
        // Moving an *unlocked* site is always fine.
        assert!(!Engine::violates_locks(&present, &untouched, &locked));
        assert!(!Engine::violates_locks(&untouched, &present, &locked));
        // No locks, no rejections.
        assert!(!Engine::violates_locks(
            &absent,
            &present,
            &std::collections::HashSet::new()
        ));
    }

    /// Duel selection must not keep asking the same question. Between refits
    /// the posterior barely moves, which is exactly when a best-arm rule
    /// locks onto one pair and shows it over and over.
    #[test]
    fn acquisition_asks_different_questions() {
        let distinct_pairs = |acquisition: Acquisition| -> usize {
            let mut rng = StdRng::seed_from_u64(0xACC);
            let user = ground_truth();
            let cfg = SessionConfig {
                pool_size: 24,
                acquisition,
                duel_check_every: 0,
                ..fast()
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
            // Now hold the posterior still and ask for 12 duels in a row.
            let mut seen = std::collections::HashSet::new();
            for _ in 0..12 {
                let (a, b) = engine.next_duel(&mut rng).unwrap();
                let (x, y) = (engine.pool[a].id, engine.pool[b].id);
                seen.insert(if x <= y { (x, y) } else { (y, x) });
            }
            seen.len()
        };
        let bald = distinct_pairs(Acquisition::Bald);
        assert!(
            bald >= 10,
            "BALD offered only {bald} distinct pairs out of 12"
        );
        // Deliberately NOT asserted: `bald > thompson`. That is a horse race
        // between two rules at one seed, and it is brittle in exactly the way
        // this suite must not be — Thompson's degeneracy needs a *sharp*
        // posterior to express (the shipped bug appeared after many refits),
        // and after 10 duels the posterior here is wide enough that Thompson
        // draws varied champions on some seeds. Rule-vs-rule quality is
        // established distributionally by `learn_synthetic --compare` (20
        // CRN-paired seeds, both regimes); a unit test's job is the
        // product property — the shipped rule must not lock onto one pair —
        // which is the assertion above.
    }

    /// The local explanation is *exact*: utility is linear within a lens, so
    /// the contributions must sum to the utility, with no residual to
    /// apologize for.
    #[test]
    fn explanation_decomposes_utility_exactly() {
        let mut rng = StdRng::seed_from_u64(0xE8B);
        let user = ground_truth();
        let cfg = SessionConfig {
            pool_size: 16,
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.fill_pool(&mut rng);
        assert!(
            engine.explain(engine.pool[0].id).is_none(),
            "no posterior yet"
        );
        for _ in 0..14 {
            let (a, b) = engine.next_duel(&mut rng).unwrap();
            let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
            engine.record_duel(a, b, chose_a);
        }
        engine.fit_posterior(&mut rng);

        let id = engine.pool[engine.ranked()[0].0].id;
        let e = engine.explain(id).expect("explanation after a fit");
        let sum: f64 = e.contributions.iter().map(|c| c.contribution).sum();
        assert!(
            (sum - e.utility).abs() < 1e-9,
            "contributions {sum} != utility {}",
            e.utility
        );
        assert_eq!(e.contributions.len(), Features::phi_names().len());
        // Sorted by magnitude, so "the top three" is a meaningful phrase.
        for w in e.contributions.windows(2) {
            assert!(w[0].contribution.abs() >= w[1].contribution.abs());
        }
    }

    /// Patches get names a musician could say out loud, and no two rows in
    /// the bank share one.
    #[test]
    fn patches_get_unique_musical_names() {
        let mut rng = StdRng::seed_from_u64(0x9A3);
        let cfg = SessionConfig {
            pool_size: 32,
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.fill_pool(&mut rng);

        let names = engine.display_names();
        assert_eq!(names.len(), engine.pool.len());
        let unique: std::collections::HashSet<&String> = names.values().collect();
        assert_eq!(unique.len(), names.len(), "names collide: {names:?}");
        for n in names.values() {
            assert!(n.split(' ').count() >= 2, "not a <character> <role>: {n}");
            assert!(n.chars().next().unwrap().is_uppercase());
        }
        // A user-given name always wins over the generated one.
        let id = engine.pool[0].id;
        engine.set_name(id, "My Bass");
        assert_eq!(engine.display_names()[&id], "My Bass");
    }

    /// Names must **spread**, not merely be unique after numbering.
    ///
    /// The failure this guards was measured in the running app: 13 of 40 bank
    /// rows named `Glass Pad`, numerals to `Glass Pad 12`. The old test passed
    /// throughout, because uniqueness-after-disambiguation is exactly what a
    /// numeral suffix guarantees no matter how degenerate the generator is.
    /// Concentration is the property with product meaning, so concentration is
    /// what gets asserted.
    #[test]
    fn names_spread_across_the_pool() {
        let mut rng = StdRng::seed_from_u64(0x9A3);
        let cfg = SessionConfig {
            pool_size: 40,
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.fill_pool(&mut rng);
        let n = engine.pool.len();
        assert!(n >= 32, "pool too small to say anything: {n}");

        let names = engine.display_names();
        assert_eq!(names.len(), n);
        let unique: std::collections::HashSet<&String> = names.values().collect();
        assert_eq!(unique.len(), n, "names collide: {names:?}");

        // Strip any disambiguating numeral to recover the generated bucket.
        let base = |s: &String| -> String {
            match s.rsplit_once(' ') {
                Some((head, tail)) if tail.parse::<usize>().is_ok() => head.to_string(),
                _ => s.clone(),
            }
        };
        let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        for v in names.values() {
            *counts.entry(base(v)).or_insert(0) += 1;
        }
        let (top_name, top) = counts
            .iter()
            .max_by_key(|(_, c)| **c)
            .map(|(k, v)| (k.clone(), *v))
            .unwrap();
        let share = top as f64 / n as f64;
        let mut hist: Vec<(&String, &usize)> = counts.iter().collect();
        hist.sort_by(|a, b| b.1.cmp(a.1));
        println!(
            "{n} patches -> {} distinct names, top `{top_name}` {top} ({share:.0}%)",
            counts.len(),
            share = share * 100.0
        );
        println!("  {hist:?}");
        assert!(
            share <= 0.20,
            "`{top_name}` takes {top}/{n} = {share:.2} of the bank; \
             the alphabet has collapsed again"
        );
        assert!(
            counts.len() >= 12,
            "only {} distinct names over {n} patches: {counts:?}",
            counts.len()
        );
    }

    /// Names must **collapse** when the patches really are alike.
    ///
    /// The counterpart to `names_spread_across_the_pool`, and the reason that
    /// test is not sufficient on its own. Quantiles put a third of the pool in
    /// each bucket whatever the pool is, so a scheme built only to spread will
    /// happily deal out thirty names for thirty imperceptible variations of
    /// one pad and tell the user they are thirty different sounds. Spreading
    /// is only a virtue when the pool is genuinely varied; here it would be a
    /// lie, and the just-noticeable-difference floors exist to stop it.
    #[test]
    fn names_collapse_when_the_patches_are_alike() {
        use ricercar_features::{featurize, PhraseSpec};
        let spec = PhraseSpec::default();
        let base = ricercar_grammar::presets()
            .into_iter()
            .find(|(n, _)| *n == "Glass Pad")
            .expect("preset")
            .1;

        // Twelve variants differing by a hair of filter cutoff — inaudible,
        // and certainly not twelve different instruments.
        let variants: Vec<ricercar_features::Features> = (0..12)
            .map(|i| {
                let tweaked = ricercar_grammar::set_param(
                    &base,
                    "op0#cutoff",
                    ricercar_grammar::ParamValue::Continuous(0.650 + i as f64 * 0.0005),
                )
                .unwrap_or_else(|_| base.clone());
                featurize(&tweaked, &spec).expect("vets").features
            })
            .collect();

        let scale = NameScale::fit(variants.iter());
        let names: std::collections::HashSet<String> =
            variants.iter().map(|f| scale.name(f)).collect();
        assert!(
            names.len() <= 2,
            "{} distinct names for imperceptible variants: {names:?}",
            names.len()
        );
    }

    /// A user or preset name must *compete* for its spelling, not squat on it.
    /// `Glass Pad` is a preset name and also something the generator can
    /// produce; substituting explicit names after disambiguation let both
    /// reach the bank.
    #[test]
    fn explicit_names_participate_in_collisions() {
        let mut rng = StdRng::seed_from_u64(0x9A4);
        let cfg = SessionConfig {
            pool_size: 12,
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.fill_pool(&mut rng);

        // Name three patches the same thing on purpose, and name a fourth
        // whatever the generator called a fifth.
        let ids: Vec<u64> = engine.pool.iter().map(|c| c.id).take(4).collect();
        let generated = engine.display_names()[&engine.pool[5].id].clone();
        for id in &ids[..3] {
            engine.set_name(*id, "Glass Pad");
        }
        engine.set_name(ids[3], &generated);

        let names = engine.display_names();
        let unique: std::collections::HashSet<&String> = names.values().collect();
        assert_eq!(
            unique.len(),
            names.len(),
            "explicit names bypassed collision detection: {names:?}"
        );
        assert_eq!(
            names[&ids[0]], "Glass Pad",
            "first claim keeps the plain name"
        );
    }

    /// Duels must spread over *candidates*, not just over pairs.
    ///
    /// Measured in the shipped app: over twelve consecutive duels one
    /// candidate appeared in six, and the pair penalty could not see it —
    /// every pairing of that candidate is a distinct pair. This asserts the
    /// thing the user actually experiences, with the posterior held still,
    /// which is the regime between refits where degeneracy showed up.
    ///
    /// Both shippable rules are checked. The default is `Random`, which has
    /// no repetition machinery at all and does not need any; `Bald` has to
    /// *earn* its equivalent behaviour from the exposure penalty, so it is the
    /// one that could regress.
    #[test]
    fn duels_spread_over_candidates_not_just_pairs() {
        const N: usize = 12;
        let spread = |acquisition: Acquisition| -> (usize, f64, usize) {
            let mut rng = StdRng::seed_from_u64(0xD4E);
            let user = ground_truth();
            let cfg = SessionConfig {
                pool_size: 24,
                duel_check_every: 0,
                acquisition,
                ..fast()
            };
            let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
            engine.begin_session();
            engine.fill_pool(&mut rng);
            for _ in 0..N {
                let (a, b) = engine.next_duel(&mut rng).unwrap();
                let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
                engine.record_duel(a, b, chose_a);
            }
            engine.fit_posterior(&mut rng);

            // Hold the posterior still and ask for N duels, as the app does
            // between refits.
            let mut appearances: std::collections::HashMap<u64, usize> =
                std::collections::HashMap::new();
            let mut pairs = std::collections::HashSet::new();
            for _ in 0..N {
                let d = engine.next_duel_full(&mut rng).unwrap();
                let (x, y) = (engine.pool[d.a].id, engine.pool[d.b].id);
                *appearances.entry(x).or_insert(0) += 1;
                *appearances.entry(y).or_insert(0) += 1;
                pairs.insert(if x <= y { (x, y) } else { (y, x) });
            }
            let max_share = *appearances.values().max().unwrap() as f64 / N as f64;
            (appearances.len(), max_share, pairs.len())
        };

        for acquisition in [Acquisition::Random, Acquisition::Bald] {
            let (distinct, max_share, n_pairs) = spread(acquisition);
            println!(
                "{acquisition:?}: {N} duels -> {distinct} distinct candidates, \
                 max share {max_share:.2}, {n_pairs} distinct pairs"
            );
            // Pair distinctness is asserted per rule, at the level the rule
            // actually promises. `Bald` carries an exposure penalty whose job
            // is repeat avoidance, so it must deliver all-distinct pairs.
            // `Random` promises uniformity, and uniformity *collides*: 12
            // draws from C(24,2)=276 pairs repeat one with probability ~21%
            // (expected collisions 66/276 ≈ 0.24), so demanding zero repeats
            // of it asserts seed luck, not behaviour — that assertion held
            // until an unrelated refactor shifted rng consumption, which is
            // precisely the brittleness. Two collisions is p < 2%; more than
            // that would mean the sampler is not uniform.
            let min_pairs = match acquisition {
                Acquisition::Bald => N,
                _ => N - 1,
            };
            assert!(
                n_pairs >= min_pairs,
                "{acquisition:?}: {n_pairs} distinct pairs out of {N}"
            );
            assert!(
                distinct >= 14,
                "{acquisition:?}: only {distinct} distinct candidates over {N} duels"
            );
            assert!(
                max_share <= 0.35,
                "{acquisition:?}: one candidate is in {max_share:.2} of duels \
                 — best-arm degeneracy"
            );
        }
    }

    /// The calibration export is a *proper* score. A confident-and-right
    /// forecaster must beat a hedging one, which is precisely what the
    /// running hit rate it replaces cannot tell you.
    #[test]
    fn brier_rewards_sharpness_that_hit_rate_cannot() {
        let confident: Vec<Forecast> = (0..20)
            .map(|_| Forecast {
                p_a: 0.95,
                chose_a: true,
                random_check: false,
            })
            .collect();
        let hedging: Vec<Forecast> = (0..20)
            .map(|_| Forecast {
                p_a: 0.55,
                chose_a: true,
                random_check: false,
            })
            .collect();
        let (c, h) = (calibration(&confident), calibration(&hedging));
        assert_eq!(c.hit_rate, h.hit_rate, "hit rate cannot tell these apart");
        assert!(
            c.skill > h.skill,
            "Brier skill must: {} vs {}",
            c.skill,
            h.skill
        );
        assert!(c.skill > 0.9 && h.skill < 0.2);

        // Reliability bins: a well-calibrated stream lands on the diagonal.
        let mixed: Vec<Forecast> = (0..100)
            .map(|i| Forecast {
                p_a: 0.1,
                chose_a: i % 10 == 0,
                random_check: i % 10 == 0,
            })
            .collect();
        let m = calibration(&mixed);
        let bin = m.bins.iter().find(|b| b.n > 0).unwrap();
        assert!((bin.predicted - bin.observed).abs() < 0.05, "{bin:?}");
        assert_eq!(m.check_n, 10, "check duels counted separately");
    }

    /// A profile written before raw-φ logging still loads and still means
    /// something: its standardized vectors are inverted back to raw values,
    /// re-projected by name, and the votes survive the feature-set change
    /// that motivated the whole exercise.
    #[test]
    fn legacy_profile_migrates_into_the_new_feature_set() {
        use crate::migrate::SCHEMA1_NAMES;
        let d = SCHEMA1_NAMES.len();
        // A schema-1 profile: standardized φ plus the standardizer they were
        // written under, which is exactly what makes them invertible.
        let sz = ricercar_taste::Standardizer {
            mean: (0..d).map(|i| 0.1 + i as f64 * 0.01).collect(),
            std: vec![0.5; d],
        };
        let legacy = format!(
            r#"{{"log":{{"observations":[
                {{"Duel":{{"a":{a},"b":{b},"chose_a":true,"session":0}}}}
            ]}},"standardizer":{sz}}}"#,
            a = serde_json::to_string(&vec![0.4_f64; d]).unwrap(),
            b = serde_json::to_string(&vec![-0.4_f64; d]).unwrap(),
            sz = serde_json::to_string(&sz).unwrap(),
        );
        let profile: Profile = serde_json::from_str(&legacy).unwrap();
        assert!(
            profile.log.observations.iter().all(|o| !o.is_raw()),
            "fixture is not actually legacy"
        );

        let mut rng = StdRng::seed_from_u64(0x11D);
        let cfg = SessionConfig {
            pool_size: 8,
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.fill_pool(&mut rng);
        engine.import_profile(profile);

        let names = phi_names();
        assert_eq!(engine.log.len(), 1);
        let o = &engine.log.observations[0];
        assert!(o.is_raw(), "observation not migrated");
        assert!(
            !o.feature_names.contains(&"size".to_string()),
            "`size` survived"
        );
        assert_eq!(
            o.feature_names, names,
            "a migrated vote must land on the current feature set, not beside it"
        );
        // The migrated vote is usable: it fits a standardizer and projects
        // cleanly onto the current feature set.
        assert_eq!(engine.log.raw_rows(&o.feature_names).len(), 2);
        let sz_now = engine.standardizer.as_ref().expect("standardizer refit");
        assert_eq!(sz_now.dimension(), names.len());
        let data = ricercar_taste::FitSet::build(&engine.log, &names, sz_now);
        let ricercar_taste::Feedback::Duel { a, b, chose_a } = &data.rows[0].0 else {
            panic!("modality changed in migration");
        };
        assert!(chose_a);
        assert_eq!(a.len(), names.len());
        assert!(a.iter().chain(b).all(|x| x.is_finite()));
        // The winner really did have the larger raw values on every axis, so
        // the migration must not have flipped the comparison.
        assert!(a.iter().zip(b).filter(|(x, y)| x > y).count() > names.len() / 2);
    }

    // ------------------------------------------------------------------
    // The render farm (crate::farm)
    // ------------------------------------------------------------------

    /// A pool signature strong enough to catch any drift the farm could
    /// introduce: **id, term, and raw φ**.
    ///
    /// φ and not just the tree, deliberately. The tree alone proves the *draw
    /// stream* survived the move off-engine; it says nothing about whether the
    /// render did. φ is the only assertion that actually exercises
    /// `render.rs`'s `(term, spec) → bit-identical samples` contract across
    /// separate wasm instances, which is the claim the whole farm rests on.
    fn pool_signature(engine: &Engine) -> Vec<(u64, String, Vec<f64>)> {
        engine
            .pool
            .iter()
            .map(|c| (c.id, c.tree.to_sexpr(), c.features.phi()))
            .collect()
    }

    /// Fill a pool the way the farm does: issue up to `width` draws at a time,
    /// featurize them off-engine, let the results arrive **scrambled**, and
    /// absorb strictly in index order.
    ///
    /// `width == 0` issues one job at a time and absorbs it immediately, which
    /// is the serial fallback — the same code path the app takes when no farm
    /// worker ever reports ready.
    fn farm_fill(width: usize, fill_seed: u64, pool_size: usize) -> Engine {
        let cfg = SessionConfig {
            pool_size,
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.set_fill_seed(fill_seed);
        let phrase = ricercar_features::PhraseSpec::default();

        // Completed-but-unabsorbed results, deliberately kept in whatever
        // order the "workers" finished in.
        let mut done: Vec<(u64, Option<PreFeaturized>)> = Vec::new();
        loop {
            let wave = engine.fill_draw(width.max(1));
            let issued = wave.len();
            for d in wave {
                let pre = if d.dup {
                    None
                } else {
                    PreFeaturized::render(d.tree, &phrase, false).ok()
                };
                done.push((d.index, pre));
            }
            // Scramble completion order as a wider farm would: more workers,
            // more reordering. Absorption must not be able to tell.
            if width >= 2 {
                done.reverse();
            }
            if width >= 5 && done.len() > 2 {
                let half = done.len() / 2;
                done.rotate_left(half);
            }
            let mut absorbed = 0;
            loop {
                let cursor = engine.draw_cursor();
                let Some(k) = done.iter().position(|(i, _)| *i == cursor) else {
                    break;
                };
                let (index, pre) = done.remove(k);
                engine.absorb_prior(index, pre);
                absorbed += 1;
            }
            if engine.pool.len() >= pool_size {
                break;
            }
            if issued == 0 && absorbed == 0 {
                break; // drained: no work left to issue and none outstanding
            }
        }
        engine
    }

    /// The judge's gate. Same `fill_seed`, farm widths {0,1,2,3,5,8}, one
    /// pool.
    ///
    /// This is the assertion that makes the farm's determinism a property of
    /// the code rather than of the argument in `farm.rs`: draws are named by
    /// index, absorbed in index order, and the fold at index *i* sees exactly
    /// the pool that indices `< i` built — so how many renders were in flight,
    /// and in what order they finished, cannot reach the result.
    #[test]
    fn farm_width_does_not_change_the_pool() {
        const SEED: u64 = 0xC0FFEE;
        let base = pool_signature(&farm_fill(0, SEED, 6));
        assert!(base.len() >= 4, "pool too small to test");
        for width in [1usize, 2, 3, 5, 8] {
            let got = pool_signature(&farm_fill(width, SEED, 6));
            assert_eq!(base, got, "farm width {width} changed the pool");
        }
    }

    /// The farm fold and the in-process fill are the same fold.
    ///
    /// `fill_pool` renders inside the engine; `farm_fill` renders outside it
    /// and hands the results back. Given one `fill_seed` they must agree
    /// exactly — otherwise "serial fallback" would mean "a different bank",
    /// and every user whose browser cannot spawn workers would be running a
    /// different product.
    #[test]
    fn farm_absorption_reproduces_the_serial_pool() {
        const SEED: u64 = 0x5EED_1234;
        let cfg = SessionConfig {
            pool_size: 6,
            ..fast()
        };
        let mut serial = Engine::new(PatchGrammarPrior::default(), cfg);
        serial.begin_session();
        serial.set_fill_seed(SEED);
        let mut rng = StdRng::seed_from_u64(0xDEAD);
        serial.fill_pool(&mut rng);
        assert!(serial.pool.len() >= 4, "pool too small to test");
        assert_eq!(
            pool_signature(&serial),
            pool_signature(&farm_fill(4, SEED, 6)),
            "the farm built a different pool than the serial fill"
        );

        // Chunking is invisible too: the draw cursor lives in the engine, not
        // in a loop variable, so `fill_step(2)` forty times is `fill_step(40)`.
        let mut chunked = Engine::new(
            PatchGrammarPrior::default(),
            SessionConfig {
                pool_size: 6,
                ..fast()
            },
        );
        chunked.begin_session();
        chunked.set_fill_seed(SEED);
        let mut rng = StdRng::seed_from_u64(0xDEAD);
        while chunked.pool.len() < 6 && chunked.fill_pool_step(&mut rng, 1) > 0 {}
        assert_eq!(
            pool_signature(&serial),
            pool_signature(&chunked),
            "chunking the fill changed the pool"
        );
    }

    /// The wire is `f32`, and that has to be invisible.
    ///
    /// A farm result's audition crosses as `Float32Array` and is rebuilt on
    /// the far side. Since the pool's buffer is *only* ever consumed as f32
    /// (`render_of`, `edit_render`), a transported buffer must equal the one
    /// an in-process render would have kept — sample for sample, not
    /// approximately.
    #[test]
    fn transported_audition_is_the_render_it_names() {
        const SEED: u64 = 0x000A_0D10;
        let cfg = || SessionConfig {
            pool_size: 3,
            render_policy: RenderPolicy::Eager,
            ..fast()
        };
        let mut serial = Engine::new(PatchGrammarPrior::default(), cfg());
        serial.begin_session();
        serial.set_fill_seed(SEED);
        let mut rng = StdRng::seed_from_u64(1);
        serial.fill_pool(&mut rng);
        assert!(!serial.pool.is_empty(), "pool too small to test");

        let phrase = ricercar_features::PhraseSpec::default();
        let mut farmed = Engine::new(PatchGrammarPrior::default(), cfg());
        farmed.begin_session();
        farmed.set_fill_seed(SEED);
        loop {
            let wave = farmed.fill_draw(2);
            if wave.is_empty() {
                break;
            }
            for d in wave {
                let index = d.index;
                let pre = if d.dup {
                    None
                } else {
                    PreFeaturized::render(d.tree, &phrase, true).ok().map(|p| {
                        // Exactly what crosses the port: the samples, and
                        // nothing else. Rebuilt from the engine's own phrase.
                        let samples = p.audition.expect("asked for audio").samples.clone();
                        PreFeaturized {
                            audition: Some(std::sync::Arc::new(ricercar_features::Audition {
                                samples,
                                sample_rate: phrase.sample_rate,
                            })),
                            ..p
                        }
                    })
                };
                farmed.absorb_prior(index, pre);
            }
            if farmed.pool.len() >= 3 {
                break;
            }
        }
        assert_eq!(pool_signature(&serial), pool_signature(&farmed));
        for (a, b) in serial.pool.iter().zip(&farmed.pool) {
            let want = a.render.as_ref().expect("eager keeps audio");
            let got = b.render.as_ref().expect("absorbed audio was dropped");
            assert_eq!(got.sample_rate, want.sample_rate);
            assert_eq!(
                got.samples, want.samples,
                "a transported audition drifted from the render φ was measured on"
            );
        }
    }

    /// A deferred restore is `import_state` with the renders moved out of it.
    ///
    /// Restore is the returning user's boot, and it is the path the farm helps
    /// most (today it is a full bank of serial renders behind a frozen bar).
    /// Moving that work off-engine must change nothing about what comes back:
    /// ids, terms, names, origins, φ_std, content keys, and the id allocator.
    #[test]
    fn deferred_restore_equals_import_state() {
        let mut rng = StdRng::seed_from_u64(0x2E570E);
        let cfg = SessionConfig {
            pool_size: 6,
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg.clone());
        engine.begin_session();
        engine.fill_pool(&mut rng);
        assert!(engine.pool.len() >= 4, "pool too small to test");
        engine.record_duel(0, 1, true);
        engine.record_keep(2, false);
        engine.set_name(engine.pool[0].id, "Kept One");
        let state = engine.export_state();

        let mut serial = Engine::new(PatchGrammarPrior::default(), cfg.clone());
        serial.begin_session();
        let n_serial = serial.import_state(state.clone());

        let phrase = ricercar_features::PhraseSpec::default();
        let mut deferred = Engine::new(PatchGrammarPrior::default(), cfg);
        deferred.begin_session();
        let bank = deferred.import_state_deferred(state);
        assert_eq!(bank.len(), n_serial, "deferred restore lost a bank entry");
        // Off-engine, in bank order — which is what the engine worker does
        // with a wave of farm results.
        for entry in bank {
            let Ok(pre) = PreFeaturized::render(entry.tree.clone(), &phrase, false) else {
                continue;
            };
            deferred.absorb_bank_entry(entry, pre);
        }
        let n_deferred = deferred.finish_restore();

        assert_eq!(n_serial, n_deferred, "restore sizes disagree");
        assert_eq!(serial.log.len(), deferred.log.len(), "log lost");
        for (a, b) in serial.pool.iter().zip(&deferred.pool) {
            assert_eq!(a.id, b.id);
            assert_eq!(a.tree, b.tree);
            assert_eq!(a.name, b.name);
            assert_eq!(a.origin, b.origin);
            assert_eq!(a.key, b.key);
            assert_eq!(a.features.phi(), b.features.phi(), "raw φ drifted");
            assert_eq!(a.phi_std, b.phi_std, "standardized φ drifted");
        }
        // The id allocator has to come back the same, or a post-restore insert
        // collides with a restored candidate on one path and not the other.
        let preset = ricercar_grammar::presets()[0].1.clone();
        assert_eq!(
            serial.insert_preset(preset.clone(), "p"),
            deferred.insert_preset(preset, "p"),
            "id allocation diverged across a deferred restore"
        );
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
