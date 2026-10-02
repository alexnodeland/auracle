//! # auracle-session
//!
//! The **two-loop engine** (the reference: *The two loops*) every frontend
//! drives:
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
//! Animated: [*Under the hood*](https://auracle.alexnodeland.com/docs/films.html#film-engine) follows both loops end to end;
//! [*The math*](https://auracle.alexnodeland.com/docs/films.html#film-math) covers acquisition, the search target and refinement.
//!
//! The M4 gate is this crate's closed-loop test: engine + synthetic user,
//! end-to-end through the *real* grammar → render → vet → features pipeline,
//! asserting the learned taste ranks genuinely-preferred patches on top.

pub mod belief;
pub mod calib;
pub mod engine;
pub mod farm;
pub mod guess;
pub mod map;
pub mod migrate;
pub mod naming;
pub mod perform;
pub mod surrogate;
pub mod walk;

pub use belief::{Belief, BeliefRow};
pub use calib::{calibration, Calibration, Forecast, ProvenanceScore, ReliabilityBin};
pub use engine::{
    phi_names, tilt_weights, Acquisition, BankEntry, Candidate, ClipChange, ClipStatus,
    Contribution, DuelChoice, EditOutcome, Engine, Explanation, ImplicitEvent, LineageEvent,
    Origin, Profile, RefineKeep, RefineOutcome, RenderPolicy, SessionConfig, SessionState,
    EVENTS_CAP, EVENT_PHI_KEEP, MIN_SESSION_OBS,
};
pub use farm::{draw_seed, Draw, PreFeaturized};
pub use guess::{
    guess_candidates, guess_is_current, guessable_source, Guess, GuessCandidate, GuessMemory,
    GuessPlan, GuessRanking, GuessRefusal, GuessSkip, GuessWhy, GUESS_BUDGET_MS, GUESS_FLOOR,
    GUESS_TAKEN_KEEP,
};
pub use map::{MapPoint, TasteMap};
pub use naming::{claim_name, NameScale};
pub use surrogate::{SurrogateFitness, QUARANTINE_FITNESS};
pub use walk::{run_walk, walk_seed, WalkContext, WalkJob, WalkResult, LOCK_SCALE_CAP};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calib::{calibration, Forecast};
    use auracle_taste::Provenance;

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
    use auracle_features::Features;
    use auracle_grammar::PatchGrammarPrior;
    use auracle_taste::synthetic::cosine;
    use auracle_taste::SyntheticUser;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    /// A synthetic user over the REAL standardized feature space: likes
    /// bright, bassy, filtered patches with fast attacks; dislikes noisy
    /// (flat-spectrum) and slow-attack ones.
    fn ground_truth() -> SyntheticUser {
        let names = Features::phi_names();
        let mut theta = vec![0.0; names.len()];
        // Audio names carry a stimulus tag (`centroid_mean:p2`); the synthetic
        // user's taste is about the perceptual axis, not the stimulus, so
        // match on the base name.
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

    /// The whole point of a pin.
    ///
    /// Eviction takes the member with the *lowest* posterior utility, which is
    /// exactly the patch a user loves before the model has learned why — so
    /// before pins the bank was not merely careless with favourites, it was
    /// biased toward destroying precisely the ones worth keeping. This test
    /// pins the very patch the evictor would reach for first and then applies
    /// more insertion pressure than there are free slots.
    #[test]
    fn a_pinned_patch_survives_eviction_pressure() {
        let mut rng = StdRng::seed_from_u64(0x9111);
        let mut engine = Engine::new(
            PatchGrammarPrior::default(),
            SessionConfig {
                pool_size: 8,
                ..fast()
            },
        );
        engine.fill_pool(&mut rng);
        assert_eq!(engine.pool.len(), 8, "pool did not fill");

        let worst = engine.ranked().last().expect("a ranked pool").0;
        let doomed = engine.pool[worst].id;
        assert!(engine.set_pinned(doomed, true), "the pin was refused");

        let mut inserted = 0;
        for (name, tree) in auracle_grammar::presets() {
            if engine.insert_preset(tree, name).is_some() {
                inserted += 1;
            }
        }
        assert!(
            inserted >= 4,
            "only {inserted} insertions — not enough to force eviction"
        );
        assert_eq!(engine.pool.len(), 8, "pool grew past its cap");
        assert!(
            engine.find(doomed).is_some(),
            "the pinned patch was evicted anyway — a pin that does not hold is \
             worse than no pin, because the UI promises it held"
        );
    }

    /// The budget is a real ceiling and refuses out loud. A `set_pinned` that
    /// silently no-ops at the cap would reproduce, in the fix, the exact class
    /// of bug the fix exists to remove.
    #[test]
    fn every_fit_records_what_each_lens_claimed() {
        let mut rng = StdRng::seed_from_u64(0x5747);
        let mut engine = Engine::new(
            PatchGrammarPrior::default(),
            SessionConfig {
                pool_size: 12,
                ..fast()
            },
        );
        engine.begin_session();
        engine.fill_pool(&mut rng);
        assert!(
            engine.style_shares().is_empty(),
            "nothing fitted yet, so nothing to report"
        );

        for _ in 0..6 {
            let (a, b) = engine.next_duel(&mut rng).unwrap();
            engine.record_duel(a, b, true);
        }
        engine.fit_posterior(&mut rng);

        let rows = engine.style_shares();
        assert_eq!(rows.len(), 1, "one row per fit");
        let r = &rows[0];
        assert_eq!(r.observations, 6);
        assert_eq!(r.shares.len(), r.k, "a share per lens the fit was allowed");
        let total: f64 = r.shares.iter().sum();
        assert!(
            (total - 1.0).abs() < 1e-6,
            "shares are a distribution over lenses, summing to 1, not {total}"
        );

        // A second fit appends rather than replacing: the open question in
        // `SessionConfig::k_styles` is about shares *across* a session, so a
        // register that only kept the latest would not answer it.
        engine.fit_posterior(&mut rng);
        assert_eq!(engine.style_shares().len(), 2);

        // And it survives a save/restore, because the evidence wanted is
        // "across real sessions" and a session ends.
        let state = engine.export_state();
        let mut restored = Engine::new(PatchGrammarPrior::default(), fast());
        restored.import_state(state);
        assert_eq!(
            restored.style_shares().len(),
            2,
            "the register did not survive a reload, so it cannot accumulate"
        );
    }

    #[test]
    fn the_pin_budget_is_capped_and_refusal_is_reported() {
        let mut rng = StdRng::seed_from_u64(0x9112);
        let mut engine = Engine::new(
            PatchGrammarPrior::default(),
            SessionConfig {
                pool_size: 8,
                ..fast()
            },
        );
        engine.fill_pool(&mut rng);
        let ids: Vec<u64> = engine.pool.iter().map(|c| c.id).collect();
        let cap = engine.pin_cap();
        assert!(cap >= 1 && cap < ids.len(), "cap {cap} is not a real bound");

        for id in ids.iter().take(cap) {
            assert!(engine.set_pinned(*id, true), "pin within budget refused");
        }
        assert_eq!(engine.pinned_count(), cap);
        assert!(
            !engine.set_pinned(ids[cap], true),
            "pinning past the cap must be refused, not silently ignored"
        );
        // Re-pinning something already pinned is not a new charge.
        assert!(engine.set_pinned(ids[0], true), "idempotent re-pin refused");
        // Unpinning frees budget again.
        assert!(engine.set_pinned(ids[0], false));
        assert!(
            engine.set_pinned(ids[cap], true),
            "freed budget not reusable"
        );
        assert!(
            !engine.set_pinned(9_999_999, true),
            "unknown id reported ok"
        );
    }

    /// A session saved before pins existed must still load.
    ///
    /// The saved record is a single IndexedDB key with no schema version, so
    /// backward compatibility cannot be checked at runtime — it has to hold by
    /// construction, and `#[serde(default)]` is the construction. A bank entry
    /// written by the previous build has no `pinned` key at all; it must
    /// deserialize as "not pinned", which is exactly what it meant.
    #[test]
    fn a_bank_entry_saved_before_pins_still_loads() {
        let (_, tree) = auracle_grammar::presets().remove(0);
        let legacy = serde_json::json!({
            "id": 7,
            "tree": tree,
            "origin": "preset",
            "name": "Saved Last Week",
        });
        let entry: BankEntry = serde_json::from_value(legacy).expect("legacy entry must load");
        assert_eq!(entry.id, 7);
        assert!(!entry.pinned, "a pre-pin entry must restore as unpinned");
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
        // A pin that does not survive a reload is not a save at all — this is
        // the one property the whole feature is for.
        let pinned_id = engine.pool[3].id;
        assert!(engine.set_pinned(pinned_id, true));

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
            assert_eq!(a.pinned, b.pinned, "a pin did not survive the reload");
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
            .insert_preset(auracle_grammar::presets()[0].1.clone(), "p")
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
        let build = |memo: auracle_features::RenderMemo| {
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
        let memoized = build(auracle_features::RenderMemo::default());
        let plain = build(auracle_features::RenderMemo::disabled());

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

    /// A listener who wants **slow** movement and dislikes **fast** flutter
    /// is learnable from duels on the real pool.
    ///
    /// Before the motion bands this preference was not hard to learn but
    /// inexpressible: a 0.55 Hz sweep and a 13 Hz flutter scored the same on
    /// every coordinate φ had (`motion_probe`). The gate is the ordinary
    /// closed loop — real prior draws, real renders, 60 duels, the shipped
    /// fit — with a ground truth that lives *only* on the two band
    /// coordinates, so every bit of recovered correlation had to come through
    /// them.
    #[test]
    fn closed_loop_learns_motion_rate() {
        const SEEDS: [u64; 3] = [0xE05, 0x1, 0x2];
        fn user() -> SyntheticUser {
            let names = Features::phi_names();
            let mut theta = vec![0.0; names.len()];
            for (name, w) in [("motion_slow", 1.5), ("motion_fast", -1.5)] {
                let i = names
                    .iter()
                    .position(|n| n.split(':').next() == Some(name))
                    .expect("motion band in φ");
                theta[i] = w;
            }
            SyntheticUser {
                theta,
                tau: 0.0,
                cuts: vec![-2.0, -0.9, 0.0, 0.9, 2.0],
            }
        }
        fn one(seed: u64) -> (f64, f64, f64) {
            let mut rng = StdRng::seed_from_u64(seed);
            let user = user();
            let cfg = SessionConfig {
                pool_size: 48,
                refine_steps: 0,
                mcmc_samples: SessionConfig::default().mcmc_samples,
                mcmc_warmup: SessionConfig::default().mcmc_warmup,
                ..fast()
            };
            let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
            engine.begin_session();
            engine.fill_pool(&mut rng);
            for _ in 0..4 {
                for _ in 0..15 {
                    let (a, b) = engine.next_duel(&mut rng).unwrap();
                    let chose_a =
                        user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
                    engine.record_duel(a, b, chose_a);
                }
                engine.fit_posterior(&mut rng);
            }
            let posterior = engine.posterior.as_ref().unwrap();
            let (mut xs, mut ys) = (Vec::new(), Vec::new());
            for c in &engine.pool {
                xs.push(posterior.utility_mix(&c.phi_std).0);
                ys.push(user.utility(&c.phi_std));
            }
            // How much the pool actually varies along the preference: a gate
            // on a pool where every patch is static would pass or fail on
            // nothing.
            let my = ys.iter().sum::<f64>() / ys.len() as f64;
            let spread =
                (ys.iter().map(|y| (y - my) * (y - my)).sum::<f64>() / ys.len() as f64).sqrt();
            let top5: f64 = engine
                .ranked()
                .iter()
                .take(5)
                .map(|&(i, _, _)| user.utility(&engine.pool[i].phi_std))
                .sum::<f64>()
                / 5.0;
            (pearson(&xs, &ys), (top5 - my) / spread.max(1e-9), spread)
        }
        let rows: Vec<(u64, (f64, f64, f64))> = std::thread::scope(|s| {
            let hs: Vec<_> = SEEDS
                .iter()
                .map(|&seed| s.spawn(move || (seed, one(seed))))
                .collect();
            hs.into_iter().map(|h| h.join().unwrap()).collect()
        });
        for (seed, (r, lift, spread)) in &rows {
            println!("motion seed {seed:#x}: r = {r:.3}  top-5 lift = {lift:+.2}σ  truth spread = {spread:.3}");
        }
        for (seed, (r, lift, _)) in &rows {
            assert!(*r > MOTION_R_FLOOR, "seed {seed:#x}: r = {r:.3}");
            assert!(
                *lift > MOTION_LIFT_FLOOR,
                "seed {seed:#x}: top-5 lift {lift:+.2}σ"
            );
        }
    }
    /// Per-seed floors for [`closed_loop_learns_motion_rate`], set under the
    /// measured values with margin. Measured when the bands shipped (3 seeds,
    /// 60 duels, shipped MCMC budget): r = 0.631 / 0.594 / 0.434 and top-5
    /// lift = +1.02 / +0.60 / +0.97σ over a truth spread of ~1.6. Chance is
    /// r ≈ 0 and lift ≈ 0.
    const MOTION_R_FLOOR: f64 = 0.25;
    const MOTION_LIFT_FLOOR: f64 = 0.2;

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

    /// **M4 gate 2: does refinement move the pool toward what the user
    /// actually likes?**
    ///
    /// The taste-loop gate ([`closed_loop_learns_synthetic_taste`]) runs at
    /// `refine_steps: 0`, so this is the only always-on test of the *other*
    /// loop. It is a small, fixed-budget version of `search_health --climb`,
    /// and it is graded the same way: on the synthetic user's **true** utility
    /// over the pool, before and after real `Engine::refine` generations.
    ///
    /// ## What this test used to do, and why that was not a gate
    ///
    /// Three things, all of which looked like assertions and none of which
    /// could fail for the right reason:
    ///
    /// - `assert!(best_after >= best_before)` on `ranked()` is true **by
    ///   construction**. `insert_candidate` evicts the pool's lowest-utility
    ///   member and refuses a refined child that does not beat it, so the top
    ///   of the ranking cannot fall. It asserted the eviction rule, not the
    ///   search.
    /// - It graded children with `ranked()`, i.e. with the **surrogate that
    ///   refinement is optimizing**. A search that had learned to fool its own
    ///   fitness would have scored perfectly.
    /// - `n_refined` was `println!`'d and never asserted, so a build where
    ///   refinement injected nothing at all passed silently.
    ///
    /// The machinery assertions it did make — lineage parity, real diffs,
    /// resolvable child ids, pool bound — were the good part and are kept.
    ///
    /// ## Why it is multi-seed, and gated on the **median**
    ///
    /// One run is a single draw over the pool lottery, the duel answers and the
    /// MH chain, so a single-seed threshold is not worth setting — the same
    /// reasoning as the taste-loop gate. Unlike that gate, the statistic here
    /// is the median rather than the mean, because the per-seed distribution
    /// has a heavy left tail that makes a mean over any affordable number of
    /// seeds a coin flip. [`MEDIAN_GAIN_GATE`] has the measurement.
    ///
    /// Sixteen seeds, run concurrently: ~70 s wall, which is affordable in a
    /// suite that already renders real audio, and enough that the middle of the
    /// distribution is stable.
    #[test]
    fn refinement_improves_pool() {
        const SEEDS: [u64; 16] = [
            0xF00D, 0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7, 0x8, 0x9, 0xA, 0xB, 0xC, 0xD, 0xE, 0xF,
        ];
        const GENERATIONS: usize = 3;

        /// One search. Returns `(mean gain, max gain, children injected)` in
        /// the synthetic user's true utility.
        fn one(seed: u64) -> (f64, f64, usize) {
            let mut rng = StdRng::seed_from_u64(seed);
            let user = ground_truth();
            let cfg = SessionConfig {
                pool_size: 24,
                // Well under the shipped 40x10: this is a regression floor that
                // runs on every commit, not the budget study. `search_health
                // --budget-ab` is where the shipped split is chosen.
                refine_steps: 12,
                refine_seeds: 3,
                ..fast()
            };
            let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
            engine.begin_session();
            engine.fill_pool(&mut rng);
            for _ in 0..40 {
                let (a, b) = engine.next_duel(&mut rng).unwrap();
                let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
                engine.record_duel(a, b, chose_a);
            }
            engine.fit_posterior(&mut rng);

            // True utility of the pool: the user is never shown to the search,
            // which only ever sees the posterior, so a climb here is the whole
            // surrogate path working end to end.
            let truth = |e: &Engine| -> (f64, f64) {
                let us: Vec<f64> = e.pool.iter().map(|c| user.utility(&c.phi_std)).collect();
                let mean = us.iter().sum::<f64>() / us.len() as f64;
                let max = us.iter().copied().fold(f64::NEG_INFINITY, f64::max);
                (mean, max)
            };
            let (mean_before, max_before) = truth(&engine);
            for _ in 0..GENERATIONS {
                engine.refine(&mut rng);
            }
            let (mean_after, max_after) = truth(&engine);

            let n_refined = engine
                .pool
                .iter()
                .filter(|c| c.origin == Origin::Refined)
                .count();

            // The machinery invariants. Every injection is a lineage event
            // with a real diff, and the pool never grows past its cap.
            assert!(engine.pool.len() <= engine.cfg.pool_size);
            for ev in &engine.lineage {
                assert_eq!(ev.kind, "refine");
                assert!(!ev.diff.is_empty(), "seed {seed:#x}: a child with no diff");
            }

            // **Pool ⊆ lineage, not lineage ⊆ pool**, and the direction matters.
            //
            // The single-generation version of this test asserted the reverse —
            // that every lineage child is still findable in the pool — and that
            // is only true when nothing has had a chance to be evicted yet.
            // Across generations a child injected in generation 1 is an
            // ordinary eviction candidate in generation 2, so the old assertion
            // fails on a *correct* engine as soon as the horizon is longer than
            // one round. (It did, on the first run of this widened test.)
            //
            // Lineage is permanent history; the pool is a fixed-size working
            // set. The invariant that survives both is that the history explains
            // every refined member the pool still holds.
            let logged: std::collections::HashSet<u64> =
                engine.lineage.iter().map(|ev| ev.child_id).collect();
            for c in engine.pool.iter().filter(|c| c.origin == Origin::Refined) {
                assert!(
                    logged.contains(&c.id),
                    "seed {seed:#x}: refined candidate {} has no lineage event",
                    c.id
                );
            }
            assert!(
                engine.lineage.len() >= n_refined,
                "seed {seed:#x}: {n_refined} refined in pool but only {} lineage events",
                engine.lineage.len()
            );

            (
                mean_after - mean_before,
                max_after - max_before,
                engine.lineage.len(),
            )
        }

        let rows: Vec<(u64, (f64, f64, usize))> = std::thread::scope(|s| {
            let handles: Vec<_> = SEEDS
                .iter()
                .map(|&seed| s.spawn(move || (seed, one(seed))))
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });

        for (seed, (mean_gain, max_gain, injected)) in &rows {
            println!(
                "  seed {seed:#x}: mean gain {mean_gain:+.3}  max gain {max_gain:+.3}  \
                 injected {injected}"
            );
        }

        let n = rows.len();
        let mean_gain = rows.iter().map(|(_, m)| m.0).sum::<f64>() / n as f64;
        let mut sorted: Vec<f64> = rows.iter().map(|(_, m)| m.0).collect();
        sorted.sort_by(f64::total_cmp);
        let median_gain = (sorted[(n - 1) / 2] + sorted[n / 2]) / 2.0;
        let improved = rows.iter().filter(|(_, m)| m.0 > 0.0).count();
        let worst_max = rows.iter().map(|(_, m)| m.1).fold(f64::INFINITY, f64::min);
        let total_injected: usize = rows.iter().map(|(_, m)| m.2).sum();
        println!(
            "refinement over {n} seeds x {GENERATIONS} generations: median gain \
             {median_gain:+.3}  mean {mean_gain:+.3}  improved {improved}/{n}  \
             worst max gain {worst_max:+.3}  injected {total_injected}"
        );

        // A generation that injects nothing anywhere is a broken search, not a
        // conservative one.
        assert!(
            total_injected > 0,
            "refinement injected no candidates across any seed"
        );
        assert!(
            improved >= IMPROVED_GATE,
            "only {improved}/{n} seeds improved, under the {IMPROVED_GATE} gate"
        );
        assert!(
            median_gain > MEDIAN_GAIN_GATE,
            "median pool gain {median_gain:+.3} is under the {MEDIAN_GAIN_GATE:+.3} gate"
        );
        // The worst per-seed change in the pool's *best* member is printed,
        // not asserted. It used to be `assert!(worst_max >= -1e-9)`, which is
        // not guaranteed by construction: `insert_candidate` evicts the
        // *model*-worst member, and the model is a surrogate, so a misranking
        // can evict the true best and the pool's max utility can fall on one
        // seed while the search is working exactly as designed. It held on the
        // sixteen fixed seeds — which is the class of flake this file's own
        // header warns about — so it is a number to read, and the gates above
        // (median gain, seeds improved, anything injected) are the claims.
        if worst_max < -1e-9 {
            println!("  note: one seed's best member fell by {worst_max:+.3} (surrogate eviction)");
        }
    }

    /// Gates for [`refinement_improves_pool`], set from the observed 16-seed
    /// spread rather than from a round number.
    ///
    /// ## Why the **median**, and not the mean
    ///
    /// The mean was the obvious choice and the measurement rejected it. Over
    /// the 16 seeds the per-seed gains were
    ///
    /// ```text
    /// -12.04  -5.55  -1.33  0.87  0.93  1.16  1.48  1.48
    ///   1.48   1.50   1.51  2.01  2.10  2.55  2.57  2.72
    /// ```
    ///
    /// — thirteen clear improvements and **two catastrophic seeds** that drag
    /// the mean to +0.215 while the median sits at +1.481. The tail is not a
    /// measurement artifact to be averaged away, and it makes the mean useless
    /// as a gate: over *any* four of these seeds the mean ranges −4.51 to
    /// +2.49 and is **negative 40 % of the time**. A four-seed mean gate — the
    /// first version of this test — would have been a coin flip that failed for
    /// reasons having nothing to do with the change under review.
    ///
    /// The median is stable for the same reason the mean is not: eleven of the
    /// sixteen seeds sit between 0.87 and 2.72, and five of those within 0.04
    /// of each other, so the middle of the distribution barely moves.
    ///
    /// ## What the two bad seeds are
    ///
    /// They are the surrogate doing its job too well. `insert_candidate` admits
    /// a child that beats the pool's worst **by the model**, and evicts by the
    /// same rule — so a posterior fitted on 40 duels at the suite's trimmed
    /// MCMC budget can hand back nine candidates it likes and the synthetic
    /// user does not, replacing nine the user did. That is the classic failure
    /// of optimizing a surrogate, it is *not* a bug in the machinery, and it is
    /// the reason [`RefineKeep::Best`] ships switched off: taking the argmax of
    /// the same surrogate is the move most likely to make this worse, and
    /// nothing has measured it yet.
    ///
    /// Gates below the observed values with real margin: 13 improved (gate 10),
    /// median +1.481 (gate +0.5). Re-derive them by running this test with
    /// `-- --nocapture` and reading the per-seed lines.
    ///
    /// ## Re-measured when walks got their own seeds (RFC-001)
    ///
    /// Each walk now draws from a seed of its own rather than from one stream
    /// shared across the generation, and the tilted prior is computed once
    /// per generation, so every seed here breeds a different generation than
    /// the table above. The same 16 seeds then read median +1.757, mean
    /// +1.511, **16/16 improved**, and no seed's best member fell. The two
    /// catastrophic seeds were draws, not fixtures: the mechanism described
    /// above is real and can recur on any seed, so the gates stay where they
    /// were.
    const MEDIAN_GAIN_GATE: f64 = 0.5;
    const IMPROVED_GATE: usize = 10;

    // ---- a generation as jobs (RFC-001, ADR-007) ----

    /// A taught engine for the generation tests: a full pool of 16, 30 duels
    /// from the synthetic user, one fit, and a budget small enough to run
    /// four of these at once. Deterministic in `seed`: two calls build two
    /// engines with the same pool, ids, log and posterior.
    fn taught(seed: u64) -> Engine {
        let mut rng = StdRng::seed_from_u64(seed);
        let user = ground_truth();
        let cfg = SessionConfig {
            pool_size: 16,
            refine_steps: 12,
            refine_seeds: 5,
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
        engine
    }

    /// `n` engines built by [`taught`] from one seed, concurrently.
    fn taught_n(seed: u64, n: usize) -> Vec<Engine> {
        std::thread::scope(|s| {
            let hs: Vec<_> = (0..n).map(|_| s.spawn(move || taught(seed))).collect();
            hs.into_iter().map(|h| h.join().unwrap()).collect()
        })
    }

    /// Every job of a generation walked the way the render farm walks it:
    /// each on its own thread with its own cold memo, started in `order`.
    /// Returned in **completion** order as `order` lists it.
    fn farm_walks(ctx: &WalkContext, jobs: &[walk::WalkJob], order: &[usize]) -> Vec<WalkResult> {
        std::thread::scope(|s| {
            let hs: Vec<_> = order
                .iter()
                .map(|&i| {
                    let job = &jobs[i];
                    s.spawn(move || run_walk(ctx, job, &auracle_features::RenderMemo::default()))
                })
                .collect();
            hs.into_iter().map(|h| h.join().unwrap()).collect()
        })
    }

    /// The pool as a comparable value: ids, terms (node identities aside —
    /// they come from a process-wide mint), origins and pins, in pool order.
    fn pool_of(e: &Engine) -> Vec<(u64, auracle_grammar::PatchTree, Origin, bool)> {
        e.pool
            .iter()
            .map(|c| (c.id, c.tree.clone(), c.origin, c.pinned))
            .collect()
    }

    fn lineage_of(e: &Engine) -> String {
        serde_json::to_string(&e.lineage).unwrap()
    }

    /// **A generation is a function of its seed, not of its schedule.** The
    /// same taught engine, bred four ways from the same `refine` stream:
    ///
    /// - `serial`: [`Engine::refine`], every walk in the engine, one memo;
    /// - `stepped`: `refine_begin` + `refine_seed` per parent (the worker's
    ///   serial driver today);
    /// - `farmed`: the jobs walked concurrently on cold memos, finishing in a
    ///   shuffled order, and offered to the engine **as they finish** — an
    ///   early result is refused as stale and changes nothing, and is offered
    ///   again once its turn comes;
    /// - `per_child`: the farmed results absorbed in order, but with an
    ///   eviction pass after every child — the rule before evictions moved to
    ///   the end of the generation.
    ///
    /// The first three must be the same pool, in the same order, with the
    /// same lineage. The fourth must hold the same patches under the same ids
    /// with the same lineage: deferring eviction changes *when* a member
    /// leaves, never *which*.
    #[test]
    fn a_generation_absorbed_in_any_completion_order_is_the_serial_one() {
        use rand::seq::SliceRandom;
        let mut engines = taught_n(0x6E4E, 4);
        let mut per_child = engines.pop().unwrap();
        let mut farmed = engines.pop().unwrap();
        let mut stepped = engines.pop().unwrap();
        let mut serial = engines.pop().unwrap();
        let stream = || StdRng::seed_from_u64(0xB4EED);
        let before: std::collections::HashSet<u64> = serial.pool.iter().map(|c| c.id).collect();
        let gen = serial.generation + 1;

        serial.refine(&mut stream());

        let parents = stepped.refine_begin(&mut stream());
        assert_eq!(stepped.refine_progress(), Some((0, parents.len())));
        for p in parents {
            stepped.refine_seed(p);
        }
        assert_eq!(stepped.refine_progress(), None, "the last seed finishes");

        let (ctx, jobs) = farmed.refine_jobs(&mut stream()).expect("taught");
        let mut order: Vec<usize> = (0..jobs.len()).collect();
        order.shuffle(&mut StdRng::seed_from_u64(9));
        if order[0] == 0 {
            order.swap(0, 1); // the first arrival must be early for the test to bite
        }
        let results = farm_walks(&ctx, &jobs, &order);
        let mut held = std::collections::BTreeMap::new();
        let mut next = 0;
        for r in results.iter().cloned() {
            if r.index != next {
                let (pool, lineage) = (pool_of(&farmed), lineage_of(&farmed));
                assert_eq!(farmed.refine_absorb(r.clone()), None);
                assert_eq!(farmed.last_refine(), RefineOutcome::Stale);
                assert_eq!(pool_of(&farmed), pool, "a stale result moved the pool");
                assert_eq!(lineage_of(&farmed), lineage);
                held.insert(r.index, r);
                continue;
            }
            farmed.refine_absorb(r);
            next += 1;
            while let Some(h) = held.remove(&next) {
                farmed.refine_absorb(h);
                next += 1;
            }
        }
        assert_eq!(next, jobs.len());

        let (_, per_child_jobs) = per_child.refine_jobs(&mut stream()).unwrap();
        assert_eq!(
            per_child_jobs, jobs,
            "the same engine and stream deal the same jobs"
        );
        let mut in_order = results.clone();
        in_order.sort_by_key(|r| r.index);
        for r in in_order {
            per_child.refine_absorb(r);
            per_child.evict_to_size(&std::collections::HashSet::new());
        }

        let born = serial
            .lineage
            .iter()
            .filter(|ev| ev.generation == gen)
            .count();
        let after: std::collections::HashSet<u64> = serial.pool.iter().map(|c| c.id).collect();
        let retired = before.difference(&after).count();
        let mut named: Vec<u64> = serial.retired().to_vec();
        named.sort_unstable();
        let mut left: Vec<u64> = before.difference(&after).copied().collect();
        left.sort_unstable();
        assert_eq!(named, left, "retired() names what left the pool");
        println!(
            "generation {gen}: {} jobs, {born} children, {retired} retired",
            jobs.len()
        );
        assert!(
            born > 0,
            "the fixture bred nothing, so nothing was compared"
        );
        assert!(
            retired > 0,
            "the fixture retired nothing, so eviction was not compared"
        );

        for (name, other) in [("stepped", &stepped), ("farmed", &farmed)] {
            assert_eq!(pool_of(other), pool_of(&serial), "{name} pool differs");
            assert_eq!(
                lineage_of(other),
                lineage_of(&serial),
                "{name} lineage differs"
            );
            assert_eq!(other.generation, serial.generation);
        }
        let by_id = |e: &Engine| {
            let mut v = pool_of(e);
            v.sort_by_key(|row| row.0);
            v
        };
        assert_eq!(
            by_id(&per_child),
            by_id(&serial),
            "eviction at the end chose differently"
        );
        assert_eq!(lineage_of(&per_child), lineage_of(&serial));
        for e in [&serial, &stepped, &farmed, &per_child] {
            assert_eq!(e.pool.len(), e.cfg.pool_size);
        }
    }

    /// A walk is a pure function of its context and job: the same job on a
    /// cold memo, on a warm one, and after its context and job have been
    /// through JSON (the farm's wire) gives the same result, byte for byte.
    #[test]
    fn a_walk_is_a_function_of_its_job() {
        let mut engine = taught(0xA1C);
        let (ctx, jobs) = engine
            .refine_jobs(&mut StdRng::seed_from_u64(3))
            .expect("taught");
        let text = |r: &WalkResult| serde_json::to_string(r).unwrap();
        let wire_ctx: WalkContext =
            serde_json::from_str(&serde_json::to_string(&ctx).unwrap()).unwrap();
        let mut moved = 0;
        for job in jobs.iter().take(3) {
            let cold = run_walk(&ctx, job, &auracle_features::RenderMemo::default());
            let warm = run_walk(&ctx, job, engine.memo());
            let wire_job: walk::WalkJob =
                serde_json::from_str(&serde_json::to_string(job).unwrap()).unwrap();
            assert_eq!(&wire_job, job);
            let wired = run_walk(
                &wire_ctx,
                &wire_job,
                &auracle_features::RenderMemo::default(),
            );
            assert_eq!(
                text(&cold),
                text(&warm),
                "job {}: the memo moved a walk",
                job.index
            );
            assert_eq!(
                text(&cold),
                text(&wired),
                "job {}: the wire moved a walk",
                job.index
            );
            if let Some(child) = &cold.child {
                moved += 1;
                let cached = cold.cached.as_ref().expect("a child carries its features");
                assert_eq!(cached.key, auracle_features::render_key(child, &ctx.phrase));
            }
        }
        assert!(moved > 0, "no walk moved, so no child was compared");
    }

    /// **Picks made while a generation breeds do not choose its children.**
    /// Every pick reweights the posterior at once (so the next pair answers
    /// it), and in the app picks land between a generation's absorptions.
    /// The children kept and the members retired are judged under the
    /// posterior the generation opened with, so the same generation absorbed
    /// with a run of contrary picks between its children, and absorbed with
    /// none, keeps the same pool.
    #[test]
    fn picks_during_a_generation_do_not_change_which_children_are_kept() {
        let mut engines = taught_n(0x91C5, 2);
        let mut picked = engines.pop().unwrap();
        let mut quiet = engines.pop().unwrap();
        let stream = || StdRng::seed_from_u64(0x0DD5);
        let (ctx, jobs) = quiet.refine_jobs(&mut stream()).expect("taught");
        let (_, picked_jobs) = picked.refine_jobs(&mut stream()).expect("taught");
        assert_eq!(
            picked_jobs, jobs,
            "the same engine and stream deal the same jobs"
        );
        let order: Vec<usize> = (0..jobs.len()).collect();
        let results = farm_walks(&ctx, &jobs, &order);
        let order_now =
            |e: &Engine| -> Vec<u64> { e.ranked().iter().map(|&(i, _, _)| e.pool[i].id).collect() };
        let before = order_now(&picked);
        for r in &results {
            quiet.refine_absorb(r.clone());
            picked.refine_absorb(r.clone());
            // Between children: the player prefers what the model likes
            // least, over and over.
            for _ in 0..6 {
                let ranked = picked.ranked();
                let (best, worst) = (ranked[0].0, ranked[ranked.len() - 1].0);
                picked.record_duel(worst, best, true);
            }
        }
        assert_ne!(
            order_now(&picked)[..before.len().min(8)],
            before[..before.len().min(8)],
            "the picks did not move the posterior, so nothing was tested"
        );
        let by_id = |e: &Engine| {
            let mut v = pool_of(e);
            v.sort_by_key(|row| row.0);
            v
        };
        assert_eq!(quiet.refine_progress(), None);
        assert_eq!(picked.refine_progress(), None);
        assert_eq!(by_id(&picked), by_id(&quiet), "the picks changed the pool");
        assert_eq!(
            picked.retired(),
            quiet.retired(),
            "the picks changed the retirees"
        );
        assert!(
            quiet
                .lineage
                .iter()
                .any(|ev| ev.generation == quiet.generation),
            "the fixture bred nothing, so admission was not compared"
        );
        assert!(!quiet.retired().is_empty(), "the fixture retired nothing");
    }

    /// **Stop keeps what was bred.** A generation stopped after its first
    /// children leaves a consistent pool: back to size, holding every child
    /// that earned its place, with a lineage event for each child absorbed
    /// and none for the jobs never absorbed. The results still in flight are
    /// refused, and the next generation opens as usual.
    #[test]
    fn a_stopped_generation_keeps_what_it_bred() {
        let mut engine = taught(0x5709);
        let before: std::collections::HashSet<u64> = engine.pool.iter().map(|c| c.id).collect();
        let (ctx, jobs) = engine
            .refine_jobs(&mut StdRng::seed_from_u64(0x5709))
            .expect("taught");
        let gen = engine.generation;
        let order: Vec<usize> = (0..jobs.len()).collect();
        let results = farm_walks(&ctx, &jobs, &order);
        let mut children = Vec::new();
        let mut absorbed = 0;
        for r in &results {
            absorbed += 1;
            if let Some(id) = engine.refine_absorb(r.clone()) {
                children.push(id);
                break;
            }
        }
        assert!(
            !children.is_empty(),
            "the fixture bred nothing before its last job"
        );
        assert!(absorbed < jobs.len(), "the fixture stopped nowhere");
        assert_eq!(engine.refine_progress(), Some((absorbed, jobs.len())));

        let retired = engine.refine_finish();
        assert_eq!(engine.refine_progress(), None);
        assert_eq!(
            engine.pool.len(),
            engine.cfg.pool_size,
            "stop leaves the pool at size"
        );
        let now: std::collections::HashSet<u64> = engine.pool.iter().map(|c| c.id).collect();
        let mut was: std::collections::HashSet<u64> = before.clone();
        was.extend(children.iter().copied());
        let gone: std::collections::HashSet<u64> = retired.iter().copied().collect();
        assert!(gone.is_disjoint(&now), "a retired id is still in the pool");
        assert_eq!(
            now.union(&gone)
                .copied()
                .collect::<std::collections::HashSet<_>>(),
            was,
            "every member is still here or was retired, and nothing else"
        );
        let events: Vec<u64> = engine
            .lineage
            .iter()
            .filter(|ev| ev.generation == gen)
            .map(|ev| ev.child_id)
            .collect();
        assert_eq!(
            events, children,
            "one lineage event per child absorbed, none after"
        );
        for c in engine.pool.iter().filter(|c| c.origin == Origin::Refined) {
            assert!(engine.lineage.iter().any(|ev| ev.child_id == c.id));
        }

        let (pool, lineage) = (pool_of(&engine), lineage_of(&engine));
        for r in &results[absorbed..] {
            assert_eq!(engine.refine_absorb(r.clone()), None);
            assert_eq!(engine.last_refine(), RefineOutcome::Stale);
        }
        assert_eq!(
            pool_of(&engine),
            pool,
            "a result after the stop moved the pool"
        );
        assert_eq!(lineage_of(&engine), lineage);
        assert!(engine.refine_finish().is_empty(), "finish is idempotent");
        assert_eq!(
            engine.retired(),
            &retired[..],
            "the stop's retirees are remembered"
        );
        let (_, next) = engine
            .refine_jobs(&mut StdRng::seed_from_u64(1))
            .expect("the next generation opens");
        assert_eq!(next[0].generation, gen + 1);
    }

    /// **A save made while a generation runs protects its patch.** The member
    /// the first admitted child displaced stays in the pool until the
    /// generation ends — under per-child eviction it was gone on the spot, and
    /// pinning it failed as an unknown id — so pinning it mid-run keeps it
    /// through the finish, and the finish retires the next-lowest instead.
    #[test]
    fn a_save_made_mid_generation_is_never_retired() {
        let mut engine = taught(0x5A7E);
        let (ctx, jobs) = engine
            .refine_jobs(&mut StdRng::seed_from_u64(0x5A7E))
            .expect("taught");
        let order: Vec<usize> = (0..jobs.len()).collect();
        let results = farm_walks(&ctx, &jobs, &order);
        let mut rest = results.into_iter();
        let mut doomed = None;
        for r in rest.by_ref() {
            engine.refine_absorb(r);
            if let Some(&id) = engine.retiring().first() {
                doomed = Some(id);
                break;
            }
        }
        let doomed = doomed.expect("no child was admitted over a full pool");
        assert!(
            engine.find(doomed).is_some(),
            "the displaced member left before the generation ended"
        );
        assert!(engine.set_pinned(doomed, true), "the save was refused");
        assert!(!engine.retiring().contains(&doomed));
        for r in rest {
            engine.refine_absorb(r);
        }
        engine.refine_finish();
        assert_eq!(engine.pool.len(), engine.cfg.pool_size);
        let i = engine.find(doomed).expect("a saved patch was retired");
        assert!(engine.pool[i].pinned);
    }

    /// **A ⚡ seed is not replaced while its walk is out.** The patch the
    /// model likes least is the one every insert evicts first, so it is the
    /// seed most at risk: in the control twin a run of preset loads retires
    /// it. With a ⚡ job drawn from it, the same loads, a whole generation and
    /// its finish all pass it over, and the walk, when it lands, is absorbed
    /// against its seed instead of being thrown away as `unknown_seed`. Once
    /// absorbed (or cancelled) the seed is an ordinary member again.
    #[test]
    fn a_seed_evolving_is_never_evicted_until_its_walk_lands() {
        let mut twins = taught_n(0xE70F, 2);
        let mut evolving = twins.pop().unwrap();
        let mut control = twins.pop().unwrap();
        let worst = control.ranked().last().expect("a ranked pool").0;
        let doomed = control.pool[worst].id;
        let load = |e: &mut Engine| {
            for (name, tree) in auracle_grammar::presets().into_iter().take(6) {
                e.insert_preset(tree, name);
            }
        };
        load(&mut control);
        assert!(
            control.find(doomed).is_none(),
            "the fixture never evicted the member it likes least"
        );

        let (ctx, job) = evolving
            .refine_from_job(&mut StdRng::seed_from_u64(1), doomed, &[])
            .expect("taught, and the seed is in the pool");
        assert_eq!(evolving.refine_from_inflight(), vec![doomed]);
        load(&mut evolving);
        assert_eq!(evolving.pool.len(), evolving.cfg.pool_size);
        assert!(
            evolving.find(doomed).is_some(),
            "a preset load evicted the seed of a ⚡ in flight"
        );
        let (gctx, jobs) = evolving
            .refine_jobs(&mut StdRng::seed_from_u64(2))
            .expect("taught");
        let order: Vec<usize> = (0..jobs.len()).collect();
        for r in farm_walks(&gctx, &jobs, &order) {
            evolving.refine_absorb(r);
        }
        evolving.refine_finish();
        assert!(
            evolving.find(doomed).is_some(),
            "a generation's end retired the seed of a ⚡ in flight"
        );

        let result = run_walk(&ctx, &job, &auracle_features::RenderMemo::default());
        evolving.refine_from_absorb(doomed, result);
        assert_ne!(evolving.last_refine(), RefineOutcome::UnknownSeed);
        assert_ne!(evolving.last_refine(), RefineOutcome::Stale);
        assert!(evolving.refine_from_inflight().is_empty());
        assert!(
            !evolving.refine_from_cancel(doomed),
            "absorbed is not in flight"
        );
        assert_eq!(evolving.refine_from_walk(doomed), None);
        assert_eq!(evolving.last_refine(), RefineOutcome::UnknownSeed);

        // A cancelled job protects nothing.
        let id = evolving.pool[evolving.ranked().last().unwrap().0].id;
        evolving
            .refine_from_job(&mut StdRng::seed_from_u64(3), id, &[])
            .expect("in the pool");
        assert!(evolving.refine_from_cancel(id));
        assert!(evolving.refine_from_inflight().is_empty());
    }

    // ---- the belief after each pick (Plan-005 task 9) ----

    /// The player prefers what the model likes least, `n` times: picks that
    /// move the posterior as far as a pick can, with no refit.
    fn contrary_picks(engine: &mut Engine, n: usize) {
        for _ in 0..n {
            let ranked = engine.ranked();
            let (best, worst) = (ranked[0].0, ranked[ranked.len() - 1].0);
            engine.record_duel(worst, best, true);
        }
    }

    /// A member's mixture utility under the posterior the long way, from the
    /// draws and their weights: `(mean, std, the lens most responsible)`, the
    /// last of equals as the map's rule keeps.
    fn summary_by_hand(p: &auracle_taste::TastePosterior, phi: &[f64]) -> (f64, f64, usize) {
        let mut us = Vec::new();
        let mut resp = vec![0.0; p.k_styles()];
        for (s, draw) in p.samples.iter().enumerate() {
            let lens: Vec<f64> = draw
                .theta
                .iter()
                .map(|t| t.iter().zip(phi).map(|(a, b)| a * b).sum())
                .collect();
            let (best, u) = lens
                .iter()
                .enumerate()
                .fold((0, f64::NEG_INFINITY), |acc, (k, &v)| {
                    if v >= acc.1 {
                        (k, v)
                    } else {
                        acc
                    }
                });
            us.push(u);
            resp[best] += p.weight(s);
        }
        let mean: f64 = us.iter().enumerate().map(|(s, u)| p.weight(s) * u).sum();
        let var: f64 = us
            .iter()
            .enumerate()
            .map(|(s, u)| p.weight(s) * (u - mean) * (u - mean))
            .sum();
        let lens = (0..resp.len()).fold(0, |best, k| if resp[k] >= resp[best] { k } else { best });
        (mean, var.sqrt(), lens)
    }

    /// **The belief after a pick is the posterior the pick left.** Picks
    /// between refits reweight the draws and fit nothing; `Engine::belief`
    /// must report the reweighted posterior, number for number what a refit's
    /// views would show of it (the ranked list, the map's pool dots), and what
    /// the draws and their weights give computed the long way.
    #[test]
    fn the_belief_after_a_pick_is_the_reweighted_posterior() {
        let mut engine = taught(0xBE1F);
        let fitted = engine.belief();
        contrary_picks(&mut engine, 4);
        let after = engine.belief();
        let p = engine.posterior.clone().expect("taught");
        assert!(
            p.ess() < p.samples.len() as f64 - 1e-6 || engine.needs_refit(),
            "the picks did not reweight the draws"
        );
        let numbers = |b: &Belief| -> Vec<(u64, u64, u64)> {
            b.ranked
                .iter()
                .map(|r| (r.id, r.mean.to_bits(), r.std.to_bits()))
                .collect()
        };
        assert_ne!(
            numbers(&after),
            numbers(&fitted),
            "the picks moved nothing, so nothing was tested"
        );
        assert!(p.k_styles() > 1, "one lens, so no lens was tested");

        let ranked = engine.ranked();
        assert_eq!(after.ranked.len(), engine.pool.len());
        for (row, &(i, mean, std)) in after.ranked.iter().zip(&ranked) {
            assert_eq!(row.id, engine.pool[i].id, "not the ranked order");
            assert_eq!(row.mean.to_bits(), mean.to_bits(), "not the ranked mean");
            assert_eq!(row.std.to_bits(), std.to_bits(), "not the ranked std");
        }
        let map = engine.taste_map();
        let mut dots = 0;
        for pt in map.points.iter().filter(|pt| pt.id.is_some()) {
            let row = after.ranked.iter().find(|r| Some(r.id) == pt.id).unwrap();
            assert_eq!(row.mean.to_bits(), pt.utility.to_bits(), "not the glow");
            assert_eq!(row.std.to_bits(), pt.utility_std.to_bits(), "not the size");
            assert_eq!(row.style, pt.style, "not the color");
            dots += 1;
        }
        assert_eq!(dots, engine.pool.len());
        for row in &after.ranked {
            let c = &engine.pool[engine.find(row.id).unwrap()];
            let (mean, std, lens) = summary_by_hand(&p, &c.phi_std);
            assert!((row.mean - mean).abs() <= 1e-9 * (1.0 + mean.abs()));
            assert!((row.std - std).abs() <= 1e-9 * (1.0 + std.abs()));
            assert_eq!(row.style, lens);
        }
        assert_eq!(
            after,
            engine.belief(),
            "a belief is a function of the engine"
        );
    }

    /// **The seeds and may-be-replaced marks are what a generation does.**
    /// `next_seeds` names the parents `refine_jobs` then takes, and
    /// `may_replace` bounds what that generation's end retires:
    ///
    /// - before the first fit: no seeds, and no generation opens;
    /// - at rest, after picks no refit has seen and with the top member and
    ///   the bottom member saved: a saved patch still seeds, and is never
    ///   marked;
    /// - mid-generation, with the pool over size and a pick made since it
    ///   opened: the next generation opens by retiring what this one
    ///   displaced, so those never seed it, and the rest rank under the
    ///   posterior as it stands, not the one this generation opened with.
    ///
    /// `belief` carries the same two lists at every step.
    #[test]
    fn next_seeds_and_may_replace_are_what_a_generation_does() {
        let mut engine = taught(0x5EED);
        let agrees = |e: &Engine| {
            let b = e.belief();
            assert_eq!(b.seeds, e.next_seeds(), "belief's seeds");
            assert_eq!(b.may_replace, e.may_replace(), "belief's may_replace");
        };
        let parents = |jobs: &[walk::WalkJob]| jobs.iter().map(|j| j.parent_id).collect::<Vec<_>>();

        let fitted = engine.posterior.take();
        assert!(engine.next_seeds().is_empty());
        agrees(&engine);
        let at = engine.generation;
        assert!(engine.refine_jobs(&mut StdRng::seed_from_u64(1)).is_none());
        assert_eq!(engine.generation, at, "a generation opened with no taste");
        engine.posterior = fitted;

        contrary_picks(&mut engine, 3);
        let ranked = engine.ranked();
        let top = engine.pool[ranked[0].0].id;
        let bottom = engine.pool[ranked[ranked.len() - 1].0].id;
        assert!(engine.set_pinned(top, true) && engine.set_pinned(bottom, true));
        let seeds = engine.next_seeds();
        let may = engine.may_replace();
        agrees(&engine);
        assert_eq!(seeds.len(), engine.cfg.refine_seeds);
        assert_eq!(seeds[0], top, "a saved patch seeds like any other");
        assert_eq!(
            may.len(),
            engine.cfg.refine_seeds,
            "a full pool can lose one member per walk"
        );
        assert!(
            !may.contains(&top) && !may.contains(&bottom),
            "a saved patch was marked"
        );
        let (ctx, jobs) = engine
            .refine_jobs(&mut StdRng::seed_from_u64(0x5EED))
            .expect("taught");
        assert_eq!(parents(&jobs), seeds, "refine_jobs took other parents");

        // Absorb children until the pool is over size, short of the last job.
        let order: Vec<usize> = (0..jobs.len()).collect();
        for r in farm_walks(&ctx, &jobs, &order)
            .into_iter()
            .take(jobs.len() - 1)
        {
            engine.refine_absorb(r);
            if !engine.retiring().is_empty() {
                break;
            }
        }
        let retiring = engine.retiring();
        assert!(
            !retiring.is_empty(),
            "no child was admitted over a full pool"
        );
        contrary_picks(&mut engine, 2);
        // Every member may seed now, so the retirees would if nothing kept
        // them out.
        engine.cfg.refine_seeds = engine.pool.len();
        let seeds = engine.next_seeds();
        agrees(&engine);
        assert!(
            retiring.iter().all(|id| !seeds.contains(id)),
            "a member the next generation retires first was named a seed"
        );
        let children: std::collections::HashSet<u64> = engine
            .lineage
            .iter()
            .filter(|ev| ev.generation == engine.generation)
            .map(|ev| ev.child_id)
            .collect();
        let (_, next) = engine
            .refine_jobs(&mut StdRng::seed_from_u64(2))
            .expect("taught");
        assert_eq!(parents(&next), seeds, "refine_jobs took other parents");
        let retired = engine.retired();
        assert!(!retired.is_empty(), "the generation retired nothing");
        assert!(
            retired
                .iter()
                .all(|id| may.contains(id) || children.contains(id)),
            "the generation retired {retired:?}, outside {may:?}"
        );
    }

    /// **`may_replace` while the pool fills, and beside a ⚡ walk.** Short of
    /// its size, the pool owes a generation fewer retirements, so fewer
    /// members are marked. A ⚡ seed is out of every eviction while its walk
    /// is out, so it leaves the marks and the next member up joins them. A
    /// real generation then retires nothing outside the marks but its own
    /// children, and never the ⚡ seed.
    #[test]
    fn may_replace_counts_a_filling_pool_and_passes_over_a_seed_evolving() {
        let mut engine = taught(0xF111);
        let walks = engine.cfg.refine_seeds;
        engine.cfg.pool_size = engine.pool.len() + 2;
        let ranked = engine.ranked();
        let lowest = engine.pool[ranked[ranked.len() - 1].0].id;
        let before = engine.may_replace();
        assert_eq!(before.len(), walks - 2, "two empty places owe two fewer");
        assert_eq!(before[0], lowest);

        engine
            .refine_from_job(&mut StdRng::seed_from_u64(1), lowest, &[])
            .expect("in the pool");
        let may = engine.may_replace();
        assert_eq!(engine.belief().may_replace, may);
        assert!(!may.contains(&lowest), "a ⚡ seed was marked");
        assert_eq!(may.len(), before.len());
        assert_eq!(may[..may.len() - 1], before[1..], "not the next member up");

        let (ctx, jobs) = engine
            .refine_jobs(&mut StdRng::seed_from_u64(0xF111))
            .expect("taught");
        let order: Vec<usize> = (0..jobs.len()).collect();
        for r in farm_walks(&ctx, &jobs, &order) {
            engine.refine_absorb(r);
        }
        let children: std::collections::HashSet<u64> = engine
            .lineage
            .iter()
            .filter(|ev| ev.generation == engine.generation)
            .map(|ev| ev.child_id)
            .collect();
        let retired = engine.retired().to_vec();
        assert!(!retired.is_empty(), "the generation retired nothing");
        assert!(retired.len() <= may.len());
        assert!(
            retired
                .iter()
                .all(|id| may.contains(id) || children.contains(id)),
            "the generation retired {retired:?}, outside {may:?}"
        );
        assert!(engine.find(lowest).is_some(), "the ⚡ seed was retired");
        assert!(engine.refine_from_cancel(lowest));
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

    /// A seed the grammar prior cannot score is reported as such, not as a
    /// walk that happened not to move.
    ///
    /// The tree here is deeper than `MAX_DEPTH` — the shape a session saved by
    /// a build with the old ceilings (depth 9 against support that ends at 6)
    /// can still hold. It has to **load and play** (`commit_edit` admits it,
    /// `render_of` renders it; no load path re-checks the ceilings, by design),
    /// and ⚡ evolve on it has to say *why* it did nothing: `init_from` returns
    /// `None` before the first step, and until this the caller saw the same
    /// `None` as for a walk that found no improvement. The generation counter
    /// must not advance for a press that produced nothing, either.
    #[test]
    fn refine_names_a_seed_outside_the_prior_support() {
        use auracle_grammar::mutate::MAX_DEPTH;
        use auracle_grammar::term::{AudioNode, FilterKind, ModNode};
        use auracle_grammar::{validate_tree, Uid};
        let mut rng = StdRng::seed_from_u64(0x0D5);
        let user = ground_truth();
        let cfg = SessionConfig {
            pool_size: 16,
            refine_steps: 20,
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.fill_pool(&mut rng);
        assert_eq!(engine.last_refine(), RefineOutcome::Idle);
        for _ in 0..20 {
            let (a, b) = engine.next_duel(&mut rng).unwrap();
            let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
            engine.record_duel(a, b, chose_a);
        }
        // Before the fit there is no taste to refine toward.
        let any = engine.pool[0].id;
        assert_eq!(engine.refine_from(&mut rng, any, &[]), None);
        assert_eq!(engine.last_refine(), RefineOutcome::NoTaste);
        engine.fit_posterior(&mut rng);

        // A filter stack two levels past the ceiling, over a shipped preset.
        let mut deep = auracle_grammar::presets()[0].1.clone();
        while deep.root.depth() < MAX_DEPTH + 2 {
            deep.root = AudioNode::Filter {
                uid: Uid::NEW,
                kind: FilterKind::SvfLp,
                cutoff: 0.6,
                resonance: 0.2,
                mod_depth: 0.0,
                input: Box::new(deep.root),
                modulation: ModNode::None,
            };
        }
        assert!(
            validate_tree(&deep).is_err(),
            "the fixture must be over the ceiling"
        );
        // Admitted — featurized, vetted, in the pool — despite being over the
        // ceiling: loading is not where the ceilings live.
        let deep_id = engine
            .commit_edit(None, deep, EditOutcome::Untold)
            .expect("a hand edit always lands");
        assert!(engine.find(deep_id).is_some());

        let gen_before = engine.generation;
        assert_eq!(engine.refine_from(&mut rng, deep_id, &[]), None);
        assert_eq!(engine.last_refine(), RefineOutcome::OutsideSupport);
        assert_eq!(
            engine.generation, gen_before,
            "nothing landed, no generation"
        );

        assert_eq!(engine.refine_from(&mut rng, 0xDEAD_BEEF, &[]), None);
        assert_eq!(engine.last_refine(), RefineOutcome::UnknownSeed);

        // Every in-support seed gets a real verdict, and at least one walk
        // lands within a few tries — the reason surface must not be all noise.
        let mut injected = false;
        for i in 0..engine.pool.len().min(8) {
            let id = engine.pool[i].id;
            if id == deep_id {
                continue;
            }
            let child = engine.refine_from(&mut rng, id, &[]);
            let outcome = engine.last_refine();
            assert_ne!(
                outcome,
                RefineOutcome::OutsideSupport,
                "seed {id} is in support"
            );
            assert_ne!(outcome, RefineOutcome::Idle);
            assert_eq!(child.is_some(), outcome == RefineOutcome::Injected);
            injected |= child.is_some();
            if injected {
                break;
            }
        }
        assert!(injected, "no in-support seed ever produced a child");
    }

    /// The engine's per-session history is bounded: the implicit-event stream
    /// keeps at most `EVENTS_CAP` rows and raw φ on the newest `EVENT_PHI_KEEP`
    /// of them, and the duel-exposure tallies forget an id the moment it is
    /// evicted. All three used to grow for the life of the session and ride
    /// along in every autosave.
    #[test]
    fn history_stays_bounded() {
        let mut rng = StdRng::seed_from_u64(0xB0B);
        let cfg = SessionConfig {
            pool_size: 6,
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.fill_pool(&mut rng);
        let phi = vec![0.5; auracle_features::Features::phi_names().len()];
        for i in 0..(EVENTS_CAP + 300) {
            engine.log_event_detail("play", i as u64, 1.0, "", phi.clone(), phi.clone());
        }
        assert_eq!(engine.events.len(), EVENTS_CAP);
        let with_phi = engine
            .events
            .iter()
            .filter(|e| !e.phi_before.is_empty())
            .count();
        assert_eq!(with_phi, EVENT_PHI_KEEP);
        assert!(
            engine.events.last().unwrap().phi_after == phi,
            "the newest event must keep its φ"
        );
        // The dropped rows are the oldest: the survivor ids start at 300.
        assert_eq!(engine.events[0].id, 300);

        // Exposure tallies: deal a duel, evict one of its sides, and the
        // tallies no longer mention it.
        let (a, _) = engine.next_duel(&mut rng).expect("a duel");
        let gone = engine.pool[a].id;
        // With no posterior every member ranks equal, and `insert_candidate`
        // evicts the *first* of the tied worst — pool index 0. Put the dealt
        // side there, so the one hand edit (which always lands) evicts it.
        engine.pool.swap(0, a);
        let mut t = engine.pool[1].tree.clone();
        t.amp.attack = 0.017;
        engine.commit_edit(None, t, EditOutcome::Untold);
        assert!(
            engine.find(gone).is_none(),
            "the fixture never evicted the dealt side"
        );
        assert!(engine.shown_pairs_len() <= 1);
        assert!(!engine.shown_candidate_ids().contains(&gone));
    }

    /// A reload opens a new τ session only once the current one has earned it.
    /// Three votes then a reload used to be two sessions and two τ sites; the
    /// merge at import folds sessions that never reached the floor into their
    /// predecessor, so a once-per-visit voter stops accumulating a nuisance
    /// site per visit.
    #[test]
    fn a_reload_reuses_a_session_that_has_not_earned_its_own_threshold() {
        let mut rng = StdRng::seed_from_u64(0x5E55);
        let cfg = SessionConfig {
            pool_size: 8,
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg.clone());
        engine.begin_session();
        engine.fill_pool(&mut rng);
        for i in 0..(MIN_SESSION_OBS - 2) {
            engine.record_keep(i % engine.pool.len(), true);
        }
        let short = engine.export_state();
        let mut back = Engine::new(PatchGrammarPrior::default(), cfg.clone());
        back.begin_session();
        back.import_state(short);
        assert_eq!(
            back.begin_session(),
            0,
            "three votes do not earn a second τ"
        );
        assert_eq!(back.log.n_sessions(), 1);

        for i in 0..MIN_SESSION_OBS {
            back.record_keep(i % back.pool.len(), false);
        }
        let long = back.export_state();
        let mut again = Engine::new(PatchGrammarPrior::default(), cfg);
        again.begin_session();
        again.import_state(long);
        assert_eq!(again.begin_session(), 1, "a session past the floor closes");

        // A legacy log with one-vote sessions from eight reloads is regrouped
        // at import into sessions that have earned a τ: the merge walks from
        // the newest down and stops folding once a group reaches the floor,
        // so eight singletons become {3 votes (the floor session), 5 votes}
        // rather than eight τ sites.
        let mut legacy = again.export_state();
        let n_votes = legacy.profile.log.observations.len();
        assert_eq!(n_votes, 2 * MIN_SESSION_OBS - 2);
        for (i, o) in legacy.profile.log.observations.iter_mut().enumerate() {
            o.session = i; // one session per vote
        }
        let mut merged = Engine::new(
            PatchGrammarPrior::default(),
            SessionConfig {
                pool_size: 8,
                ..fast()
            },
        );
        merged.begin_session();
        merged.import_state(legacy);
        assert_eq!(
            merged.log.n_sessions(),
            2,
            "one-vote sessions must fold together"
        );
        let in_last = merged
            .log
            .observations
            .iter()
            .filter(|o| o.session() == 1)
            .count();
        assert_eq!(in_last, MIN_SESSION_OBS);
    }

    /// A refit keeps each lens where the previous fit had it: the lens that
    /// carried the pool's taste is at the same index afterwards, so the name
    /// the player gave it still names it.
    #[test]
    fn refits_keep_the_dominant_lens_where_it_was() {
        use auracle_taste::synthetic::cosine;
        let mut rng = StdRng::seed_from_u64(0x1E45);
        let user = ground_truth();
        let cfg = SessionConfig {
            pool_size: 16,
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.fill_pool(&mut rng);
        // 45 duels → K = 1 + 45/20 = 3 lenses.
        for _ in 0..45 {
            let (a, b) = engine.next_duel(&mut rng).unwrap();
            let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
            engine.record_duel(a, b, chose_a);
        }
        engine.fit_posterior(&mut rng);
        let first = engine.posterior.clone().expect("fit");
        assert!(first.k_styles() >= 2, "the test needs more than one lens");
        let pool: Vec<Vec<f64>> = engine.pool.iter().map(|c| c.phi_std.clone()).collect();
        let shares = first.style_share(&pool);
        let dominant = (0..first.k_styles())
            .max_by(|&i, &j| shares[i].total_cmp(&shares[j]))
            .unwrap();
        let before = first.theta_mean(dominant);

        // A second fit from a different RNG state, over the same log.
        let mut other = StdRng::seed_from_u64(0x7777);
        engine.fit_posterior(&mut other);
        let second = engine.posterior.clone().expect("refit");
        let best = (0..second.k_styles())
            .max_by(|&i, &j| {
                cosine(&second.theta_mean(i), &before)
                    .total_cmp(&cosine(&second.theta_mean(j), &before))
            })
            .unwrap();
        assert_eq!(
            best, dominant,
            "the dominant lens moved from index {dominant} to {best} across a refit"
        );
    }

    /// **R6.** A refined child keeps its seed's node identities wherever the
    /// structure survived the walk.
    ///
    /// Without this the panel cannot tell "the patch evolved" from "a different
    /// patch arrived", so every lock, hand-placed position and selection dies
    /// on the app's central action — and evolution is exactly the action the
    /// locks exist to be used *with*. Refinement gives identity no help at all:
    /// it proposes over the trace and rebuilds the genome from it on every
    /// accepted step, so what `refine_from` returns is anonymous until
    /// `record_child` re-keys it against the seed. This asserts the re-keying,
    /// through the rack view the panel actually reads.
    #[test]
    fn refinement_carries_node_identity() {
        use auracle_grammar::describe;
        let mut rng = StdRng::seed_from_u64(0x1D3);
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

        let mut checked = 0;
        for round in 0..8 {
            let seed_id = engine.pool[round % engine.pool.len()].id;
            let seed = describe::describe(&engine.pool[engine.find(seed_id).unwrap()].tree);
            let Some(child_id) = engine.refine_from(&mut rng, seed_id, &[]) else {
                continue;
            };
            let child = describe::describe(&engine.pool[engine.find(child_id).unwrap()].tree);
            let mut carried = 0;
            for cm in &child.modules {
                if cm.key == "amp" {
                    assert_eq!(cm.uid, 0, "the amp is the envelope, not a node");
                    continue;
                }
                assert_ne!(cm.uid, 0, "{} came back without an identity", cm.key);
                // Same key, same kind, before and after: the same module, and
                // the only honest answer is the same identity.
                if let Some(sm) = seed.modules.iter().find(|m| m.key == cm.key) {
                    if sm.kind == cm.kind {
                        assert_eq!(sm.uid, cm.uid, "identity lost at {}", cm.key);
                        carried += 1;
                    }
                }
            }
            // A round that shares no module with its seed has nothing to say
            // about identity, and is **skipped rather than failed**.
            //
            // This used to `assert!(carried > 0, "a refinement step that
            // changed everything is not a refinement")`, which conflates two
            // different claims: "identity survives where structure survives"
            // (this test's subject, asserted above and still strict) and "a
            // walk never restructures a whole term" (a claim about the search,
            // and not a true one). Forty MH steps over a small term can replace
            // the root's kind, after which no key/kind pair matches and there is
            // simply nothing to carry — no uid was lost, because none was
            // comparable. The φ shift from peak-capped normalization moved one
            // seed's trajectory into exactly that case, and the test failed
            // without anything being wrong.
            //
            // `checked` counts only rounds that genuinely exercised the
            // property, and the final assert still requires at least one.
            if carried == 0 {
                continue;
            }
            checked += 1;
            if checked >= 2 {
                break;
            }
        }
        assert!(
            checked > 0,
            "no refinement round preserved any structure, so identity carrying was never exercised"
        );
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
        let edited = auracle_grammar::set_param(
            &engine.pool[0].tree,
            "amp#attack",
            auracle_grammar::ParamValue::Continuous(0.05),
        )
        .unwrap();

        let obs_before = engine.log.len();
        let child_id = engine
            .commit_edit(
                Some(original_id),
                edited.clone(),
                EditOutcome::Heard { edited_won: true },
            )
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

    /// PERFORM's offers are duels: the player hears the offer against the
    /// sound they are playing and takes it or passes. Both answers have to
    /// arrive — a stream that only ever recorded takes would be the model
    /// agreeing with its own proposals — as ordinary duels tagged
    /// `PerformOffer`, forecast before they are observed, without touching
    /// the pool. Two identical patches record nothing.
    #[test]
    fn perform_offers_are_duels_both_ways_and_leave_the_pool_alone() {
        let mut rng = StdRng::seed_from_u64(0x0FFE);
        let cfg = SessionConfig {
            pool_size: 12,
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.fill_pool(&mut rng);
        let home = engine.pool[0].tree.clone();
        let offer = auracle_grammar::set_param(
            &home,
            "amp#attack",
            auracle_grammar::ParamValue::Continuous(0.4),
        )
        .unwrap();
        let pool_ids: Vec<u64> = engine.pool.iter().map(|c| c.id).collect();

        assert!(engine.record_tree_duel(&home, &offer, false, Provenance::PerformOffer));
        assert!(engine.record_tree_duel(&home, &offer, true, Provenance::PerformOffer));
        assert!(
            !engine.record_tree_duel(&home, &home, true, Provenance::PerformOffer),
            "the same patch twice is not a question"
        );
        assert_eq!(engine.log.n_with(Provenance::PerformOffer), 2);
        let taken = &engine.log.observations[0];
        let auracle_taste::Feedback::Duel { chose_a, .. } = &taken.feedback else {
            panic!("an offer answer is a duel");
        };
        assert!(!chose_a, "A is home, and the offer was taken");
        assert_eq!(
            engine.pool.iter().map(|c| c.id).collect::<Vec<_>>(),
            pool_ids,
            "a performance's passing sounds are evidence, not candidates"
        );

        // With a posterior, the forecast is scored in its own stream.
        engine.fit_posterior(&mut rng);
        let n_before = engine.forecasts.len();
        assert!(engine.record_tree_duel(&home, &offer, true, Provenance::PerformOffer));
        assert_eq!(engine.forecasts.len(), n_before + 1);
        assert_eq!(
            engine.forecasts.last().unwrap().provenance,
            Provenance::PerformOffer
        );
        let cal = engine.calibration();
        assert!(cal
            .by_provenance
            .iter()
            .any(|r| r.provenance == "perform_offer" && r.n >= 1));
    }

    /// The losing direction is the half that used to be unrepresentable: a
    /// `false` in the old boolean API meant "said nothing", so an edit the
    /// player heard and rejected left no trace and the log only ever saw
    /// edits that won. It has to arrive as a duel the *original* wins, and
    /// the express checkbox has to be distinguishable from a heard one — in
    /// the log and in the forecast stream — without either of them changing
    /// what the likelihood sees.
    #[test]
    fn a_heard_edit_that_lost_is_logged_as_a_loss_and_tagged() {
        let mut rng = StdRng::seed_from_u64(0x105E);
        let cfg = SessionConfig {
            pool_size: 12,
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.fill_pool(&mut rng);
        let original_id = engine.pool[0].id;
        let seed = engine.pool[0].tree.clone();
        let bend = |v: f64| {
            auracle_grammar::set_param(
                &seed,
                "amp#attack",
                auracle_grammar::ParamValue::Continuous(v),
            )
            .unwrap()
        };

        engine
            .commit_edit(
                Some(original_id),
                bend(0.05),
                EditOutcome::Heard { edited_won: false },
            )
            .expect("a losing edit still commits — it is a candidate either way");
        let obs = engine.log.observations.last().unwrap();
        assert_eq!(obs.provenance, Provenance::HeardEdit);
        let auracle_taste::Feedback::Duel { chose_a, .. } = &obs.feedback else {
            panic!("a commit outcome is a duel");
        };
        assert!(!chose_a, "A is the edit, and the edit lost");

        engine
            .commit_edit(Some(original_id), bend(0.09), EditOutcome::SelfReported)
            .expect("the express path still commits");
        let obs = engine.log.observations.last().unwrap();
        assert_eq!(obs.provenance, Provenance::SelfReport);

        engine
            .commit_edit(Some(original_id), bend(0.13), EditOutcome::Untold)
            .expect("an untold commit still commits");
        assert_eq!(
            engine.log.len(),
            2,
            "an untold commit claims nothing, so it observes nothing"
        );
        assert_eq!(engine.log.n_with(Provenance::HeardEdit), 1);
        assert_eq!(engine.log.n_with(Provenance::SelfReport), 1);

        // A commit whose tree the bank already holds inserts nothing — but the
        // player still heard two patches and picked one, and the answer must
        // not be lost to a bookkeeping collision. It is scored against the
        // twin instead.
        let twin = engine.pool[1].tree.clone();
        let obs_before = engine.log.len();
        assert!(
            engine
                .commit_edit(
                    Some(original_id),
                    twin,
                    EditOutcome::Heard { edited_won: false }
                )
                .is_none(),
            "a duplicate tree is not a new candidate"
        );
        assert_eq!(
            engine.log.len(),
            obs_before + 1,
            "the comparison was thrown away because the winner already existed"
        );
        assert_eq!(
            engine.log.observations.last().unwrap().provenance,
            Provenance::HeardEdit
        );

        // And the tag stays out of the fit: what the likelihood is handed is
        // (feedback, session), which is what it was handed before this field
        // existed. Two rows differing only in provenance are one row twice.
        let names = phi_names();
        let sz = engine
            .standardizer
            .clone()
            .expect("a filled pool has a standardizer");
        let fit = auracle_taste::FitSet::build(&engine.log, &names, &sz);
        assert_eq!(fit.len(), engine.log.len());
        assert_eq!(
            fit.rows[0].0.phis().len(),
            2,
            "still a duel, whatever it was collected by"
        );
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
        // Both axes are solved, not merely returned after a fixed iteration
        // count. On real pool data this converges in far fewer than the cap.
        assert_eq!(
            map.converged,
            [true, true],
            "a taste-map axis hit its iteration cap without converging"
        );
    }

    /// The map's axes carry the sign convention on real pool data.
    ///
    /// The property itself is unit-tested in [`crate::map`] against data built
    /// to violate it; this is the end-to-end check that the projection the app
    /// actually draws obeys it too.
    #[test]
    fn taste_map_axes_are_sign_pinned() {
        let mut rng = StdRng::seed_from_u64(0x5E1);
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
        assert_eq!(map.converged, [true, true]);
        assert!(map.points.iter().any(|p| p.x.abs() > 1e-6));
    }

    /// The map keeps the orientation it was last drawn in, across a redraw
    /// and across a save and reload. The remembered axes are forced to the
    /// mirror image of what the sign convention picks, so both checks fail
    /// without the memory, and the reload check fails without its persistence.
    #[test]
    fn taste_map_keeps_its_orientation_across_redraws_and_reloads() {
        let mut rng = StdRng::seed_from_u64(0x0B1E);
        let cfg = SessionConfig {
            pool_size: 12,
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg.clone());
        engine.begin_session();
        engine.fill_pool(&mut rng);
        for _ in 0..4 {
            let (a, b) = engine.next_duel(&mut rng).unwrap();
            engine.record_duel(a, b, true);
        }
        let first = engine.taste_map();
        assert!(first
            .points
            .iter()
            .any(|p| p.x.abs() > 1e-6 && p.y.abs() > 1e-6));
        // As though an earlier refit had left the map drawn the other way.
        {
            let mut drawn = engine.map_axes.lock().unwrap();
            for axis in drawn
                .as_mut()
                .expect("the map remembers its axes")
                .iter_mut()
            {
                for v in axis.iter_mut() {
                    *v = -*v;
                }
            }
        }
        let redrawn = engine.taste_map();
        assert_eq!(first.points.len(), redrawn.points.len());
        for (p, q) in first.points.iter().zip(&redrawn.points) {
            assert!(
                (p.x + q.x).abs() < 1e-9 && (p.y + q.y).abs() < 1e-9,
                "the redraw did not keep the orientation it was drawn in"
            );
        }

        let json = serde_json::to_string(&engine.export_state()).unwrap();
        let mut restored = Engine::new(PatchGrammarPrior::default(), cfg);
        restored.begin_session();
        restored.import_state(serde_json::from_str(&json).unwrap());
        let reloaded = restored.taste_map();
        assert_eq!(reloaded.points.len(), redrawn.points.len());
        for (p, q) in redrawn.points.iter().zip(&reloaded.points) {
            assert!(
                (p.x - q.x).abs() < 1e-6 && (p.y - q.y).abs() < 1e-6,
                "the reload mirrored the map"
            );
        }
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
        use auracle_features::{featurize, PhraseSpec};
        let spec = PhraseSpec::default();
        let base = auracle_grammar::presets()
            .into_iter()
            .find(|(n, _)| *n == "Glass Pad")
            .expect("preset")
            .1;

        // Twelve variants differing by a hair of filter cutoff — inaudible,
        // and certainly not twelve different instruments.
        let variants: Vec<auracle_features::Features> = (0..12)
            .map(|i| {
                let tweaked = auracle_grammar::set_param(
                    &base,
                    "op0#cutoff",
                    auracle_grammar::ParamValue::Continuous(0.650 + i as f64 * 0.0005),
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

    /// A patch keeps its name when the bank moves around it.
    ///
    /// Names are read off the pool's terciles, and were read afresh on every
    /// call, so a generation that replaced nine patches renamed patches that
    /// had not changed: the EVOLVE film caught the child on the bench going
    /// from `Soft Drone` to `Soft Lead` as its generation landed. This evicts a
    /// third of a filled bank and fills it again, as a generation does, and
    /// requires every survivor to read exactly as before — having first
    /// checked that reading them afresh really would rename one, so the test
    /// cannot pass on a bank that happened not to move.
    #[test]
    fn a_patch_keeps_its_name_when_the_bank_moves() {
        let mut rng = StdRng::seed_from_u64(0x9A5);
        let cfg = SessionConfig {
            pool_size: 30,
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.fill_pool(&mut rng);
        let before = engine.display_names();

        let gone: Vec<u64> = engine.pool.iter().map(|c| c.id).take(10).collect();
        engine.pool.retain(|c| !gone.contains(&c.id));
        engine.fill_pool(&mut rng);
        let after = engine.display_names();
        let survivors: Vec<u64> = engine
            .pool
            .iter()
            .map(|c| c.id)
            .filter(|id| before.contains_key(id))
            .collect();
        assert_eq!(survivors.len(), 20);

        // What the old reading gave: every generated name afresh, in id order.
        let afresh: std::collections::HashMap<u64, String> = {
            let scale = NameScale::fit(engine.pool.iter().map(|c| &c.features));
            let mut taken = std::collections::HashSet::new();
            let mut pool: Vec<&Candidate> = engine.pool.iter().collect();
            pool.sort_by_key(|c| c.id);
            pool.into_iter()
                .map(|c| (c.id, claim_name(&scale.name(&c.features), &mut taken)))
                .collect()
        };
        let moved = survivors
            .iter()
            .filter(|id| afresh[*id] != before[*id])
            .count();
        assert!(
            moved > 0,
            "this bank did not move enough to rename anyone afresh; the test needs a seed that does"
        );
        for id in &survivors {
            assert_eq!(
                after[id], before[id],
                "patch {id} was renamed when the bank moved"
            );
        }
        let unique: std::collections::HashSet<&String> = after.values().collect();
        assert_eq!(unique.len(), after.len(), "names collide: {after:?}");
    }

    /// Kept names survive a reload, and a session saved before names were
    /// kept is named once, on restore, with every name unique.
    #[test]
    fn names_are_kept_across_a_reload() {
        let mut rng = StdRng::seed_from_u64(0x9A6);
        let cfg = SessionConfig {
            pool_size: 16,
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.fill_pool(&mut rng);
        let before = engine.display_names();

        let mut restored = Engine::new(PatchGrammarPrior::default(), fast());
        restored.import_state(engine.export_state());
        assert_eq!(
            restored.display_names(),
            before,
            "a reload renamed the bank"
        );

        let mut old = serde_json::to_value(engine.export_state()).unwrap();
        for entry in old["bank"].as_array_mut().unwrap() {
            entry.as_object_mut().unwrap().remove("auto_name");
        }
        let mut restored = Engine::new(PatchGrammarPrior::default(), fast());
        restored.import_state(serde_json::from_value(old).unwrap());
        assert!(
            restored
                .pool
                .iter()
                .all(|c| c.name.is_some() || c.auto_name.is_some()),
            "an older save came back with patches never named"
        );
        let names = restored.display_names();
        let unique: std::collections::HashSet<&String> = names.values().collect();
        assert_eq!(unique.len(), names.len(), "names collide: {names:?}");
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
            //
            // The bound now matches that last sentence, which the code did not.
            // `N - 1` admits **one** collision and therefore fires on 21% of
            // seeds — the very rate the paragraph above calls seed luck — and
            // it duly fired the first time an unrelated change (a seventh
            // source kind) shifted rng consumption again. `N - 2` admits the
            // two collisions the reasoning allows and fires at P(≥3) ≈ 0.19%,
            // which is a claim about the sampler rather than about the seed.
            let min_pairs = match acquisition {
                Acquisition::Bald => N,
                _ => N - 2,
            };
            assert!(
                n_pairs >= min_pairs,
                "{acquisition:?}: {n_pairs} distinct pairs out of {N}"
            );
            // Distinct-candidate coverage splits the same way and for the
            // same reason. Twelve duels are 24 slots drawn from a pool of 24,
            // so a *uniform* rule is expected to reach
            // `24·(1 − (23/24)^24) ≈ 15.5` distinct candidates with a
            // standard deviation near 1.6 — 13 is an ordinary draw from that,
            // and asserting 14 of `Random` asserts seed luck. It held until
            // wave 2C's recursive mod sort moved rng consumption, which is
            // exactly the brittleness this comment already describes for
            // pairs. `Bald` is the rule that *promises* spread, through its
            // exposure penalty, so it keeps the stronger bound.
            let min_distinct = match acquisition {
                Acquisition::Bald => 14,
                _ => 12,
            };
            assert!(
                distinct >= min_distinct,
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
                provenance: Provenance::Duel,
            })
            .collect();
        let hedging: Vec<Forecast> = (0..20)
            .map(|_| Forecast {
                p_a: 0.55,
                chose_a: true,
                random_check: false,
                provenance: Provenance::Duel,
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
                provenance: Provenance::Duel,
            })
            .collect();
        let m = calibration(&mixed);
        let bin = m.bins.iter().find(|b| b.n > 0).unwrap();
        assert!((bin.predicted - bin.observed).abs() < 0.05, "{bin:?}");
        assert_eq!(m.check_n, 10, "check duels counted separately");
        assert_eq!(m.by_provenance.len(), 1, "one stream, one row");
        assert_eq!(m.by_provenance[0].provenance, "duel");
    }

    /// Self-report and heard comparison are scored apart, because there is no
    /// reason to believe a checkbox and a heard A/B are equally reliable and
    /// the only way to find out is to keep the two streams separable. The
    /// aggregate still covers everything — this splits the score, it does not
    /// hide any of it.
    #[test]
    fn calibration_scores_a_checkbox_apart_from_a_heard_comparison() {
        let f = |p: f64, won: bool, prov| Forecast {
            p_a: p,
            chose_a: won,
            random_check: false,
            provenance: prov,
        };
        let mut fs: Vec<Forecast> = (0..10)
            .map(|_| f(0.9, true, Provenance::HeardEdit))
            .collect();
        // The self-reports contradict a model that is right about the heard
        // ones — precisely the asymmetry this split exists to make visible.
        fs.extend((0..10).map(|_| f(0.9, false, Provenance::SelfReport)));
        let c = calibration(&fs);
        assert_eq!(c.n, 20, "the aggregate still sees every forecast");
        let row = |name: &str| {
            c.by_provenance
                .iter()
                .find(|r| r.provenance == name)
                .unwrap_or_else(|| panic!("{name} missing"))
        };
        assert_eq!(row("heard_edit").n, 10);
        assert_eq!(row("self_report").n, 10);
        assert!(
            row("heard_edit").skill > row("self_report").skill,
            "the split scored nothing: {:?}",
            c.by_provenance
        );
        assert!(c.by_provenance.iter().all(|r| r.provenance != "duel"));
    }

    /// A check pair still counts as a check when it is answered after the
    /// next pair has been dealt — which is how the app always answers, since
    /// it records a vote only once its undo window has passed. Tagging only
    /// the last pair dealt left TRUST reading "0 of 20" checks after 33
    /// duels that were every one of them uniform.
    #[test]
    fn a_check_answered_after_the_next_deal_still_counts() {
        let mut rng = StdRng::seed_from_u64(0xC4EC);
        let user = ground_truth();
        let cfg = SessionConfig {
            pool_size: 16,
            acquisition: Acquisition::Random,
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.fill_pool(&mut rng);
        for _ in 0..8 {
            let (a, b) = engine.next_duel(&mut rng).unwrap();
            let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
            engine.record_duel(a, b, chose_a);
        }
        engine.fit_posterior(&mut rng);
        let before = engine.calibration().check_n;
        let first = engine.next_duel_full(&mut rng).unwrap();
        let second = engine.next_duel_full(&mut rng).unwrap();
        assert!(
            first.random_check && second.random_check,
            "uniform pairs are checks"
        );
        engine.record_duel(first.a, first.b, true);
        engine.record_duel(second.a, second.b, false);
        assert_eq!(
            engine.calibration().check_n,
            before + 2,
            "a check answered after the next deal lost its tag"
        );
    }

    /// The check cadence counts pairs the player was shown, not pairs dealt.
    /// The app deals the next pair ahead and throws some deals away unseen
    /// (the engine dealt the pair on the table, a side was cut or replaced,
    /// a pick was taken back); counted at the deal, a scheduled check could
    /// be one of those and the calibration subsample shrank. Here every pair
    /// shown is preceded by two deals thrown away: each is dealt under the
    /// same schedule as the one shown, and exactly every third pair shown is
    /// a check.
    #[test]
    fn discarded_deals_do_not_advance_the_check_cadence() {
        let mut rng = StdRng::seed_from_u64(0xDEA1);
        let user = ground_truth();
        let cfg = SessionConfig {
            pool_size: 16,
            acquisition: Acquisition::Thompson,
            duel_check_every: 3,
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.fill_pool(&mut rng);
        // Nine pairs shown and answered (random, before any fit): the next
        // pair shown is the tenth, and checks fall on the 10th, 13th, 16th.
        for _ in 0..9 {
            let (a, b) = engine.next_duel(&mut rng).unwrap();
            let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
            engine.record_duel(a, b, chose_a);
        }
        engine.fit_posterior(&mut rng);
        let checks_before = engine.calibration().check_n;
        let mut shown = Vec::new();
        for _ in 0..9 {
            let thrown: Vec<&str> = (0..2)
                .map(|_| engine.deal_duel_except(&mut rng, &[]).unwrap().method)
                .collect();
            let d = engine.deal_duel_except(&mut rng, &[]).unwrap();
            assert!(
                thrown.iter().all(|m| *m == d.method),
                "a deal thrown away moved the schedule: {thrown:?} then {}",
                d.method
            );
            let (a, b) = (engine.pool[d.a].id, engine.pool[d.b].id);
            assert!(
                engine.duel_shown(b, a),
                "a dealt pair is shown, either order"
            );
            assert!(
                !engine.duel_shown(a, b),
                "putting it back up is not a second showing"
            );
            shown.push(d.method);
            engine.record_duel(d.a, d.b, true);
        }
        assert_eq!(
            shown,
            ["check", "thompson", "thompson"].repeat(3),
            "every third pair shown is a check"
        );
        assert_eq!(
            engine.calibration().check_n,
            checks_before + 3,
            "every check shown and answered is scored as one, and nothing thrown away is"
        );
    }

    /// A check shown and answered before the first fit is used up by its
    /// answer, though there was no forecast to score. It used to stay
    /// pending, and the next answer on the same pair (after the fit, on a
    /// pair the model had chosen, or the same question put back up) was
    /// scored as that old check.
    #[test]
    fn a_check_answered_before_the_first_fit_is_not_scored_again() {
        let mut rng = StdRng::seed_from_u64(0xC4EC);
        let user = ground_truth();
        let cfg = SessionConfig {
            pool_size: 8,
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        engine.fill_pool(&mut rng);
        let first = engine.deal_duel_except(&mut rng, &[]).unwrap();
        assert!(first.random_check, "with no fit every pair is a check");
        let (ia, ib) = (engine.pool[first.a].id, engine.pool[first.b].id);
        assert!(engine.duel_shown(ia, ib));
        engine.record_duel(first.a, first.b, true);
        for _ in 0..8 {
            let (a, b) = engine.next_duel(&mut rng).unwrap();
            let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
            engine.record_duel(a, b, chose_a);
        }
        engine.fit_posterior(&mut rng);
        let before = engine.calibration().check_n;
        // The same pair answered again, not dealt as a check this time.
        engine.record_duel(first.a, first.b, false);
        assert_eq!(
            engine.calibration().check_n,
            before,
            "an answer before the fit left its check pending for a later answer"
        );
    }

    /// something: its standardized vectors are inverted back to raw values,
    /// re-projected by name, and the votes survive the feature-set change
    /// that motivated the whole exercise.
    #[test]
    fn legacy_profile_migrates_into_the_new_feature_set() {
        use crate::migrate::SCHEMA1_NAMES;
        let d = SCHEMA1_NAMES.len();
        // A schema-1 profile: standardized φ plus the standardizer they were
        // written under, which is exactly what makes them invertible.
        let sz = auracle_taste::Standardizer {
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
        // Schema-1 values were measured under the v1 stimulus, so the vote
        // lands on the v1 names — not the current stimulus-tagged audio
        // names, which would launder old-stimulus evidence into coordinates
        // it was never commensurable with.
        assert_eq!(
            o.feature_names,
            crate::migrate::v1_names(),
            "a migrated vote must land on the stimulus it was recorded under"
        );
        // Old-stimulus rows must never feed the current standardizer …
        assert_eq!(engine.log.raw_rows(&names).len(), 0);
        // … but the vote itself is intact raw evidence under its own names.
        assert_eq!(engine.log.raw_rows(&o.feature_names).len(), 2);
        let sz_now = engine.standardizer.as_ref().expect("standardizer refit");
        assert_eq!(sz_now.dimension(), names.len());
        let data = auracle_taste::FitSet::build(&engine.log, &names, sz_now);
        let auracle_taste::Feedback::Duel { a, b, chose_a } = &data.rows[0].0 else {
            panic!("modality changed in migration");
        };
        assert!(chose_a);
        assert_eq!(a.len(), names.len());
        assert!(a.iter().chain(b).all(|x| x.is_finite()));
        // Structural coordinates (stimulus-independent) carry the comparison
        // forward; stimulus-tagged audio coordinates are imputed to exactly
        // "no evidence" (z = 0) on both sides. The winner keeps its win, and
        // no coordinate flips.
        let audio_tagged = |n: &str| n.ends_with(":p2");
        for (j, name) in names.iter().enumerate() {
            if audio_tagged(name) {
                assert_eq!(a[j], 0.0, "old-stimulus audio leaked into {name}");
                assert_eq!(b[j], 0.0, "old-stimulus audio leaked into {name}");
            }
        }
        assert!(a.iter().zip(b).all(|(x, y)| x >= y));
        assert!(
            a.iter().zip(b).any(|(x, y)| x > y),
            "the structural evidence vanished entirely"
        );
    }

    /// A profile written under the **previous φ width** still loads, and its
    /// votes still count for the coordinates they were measured on.
    ///
    /// This is the migration a *feature-set* change produces, as distinct from
    /// the schema change above: the log is already raw and already named, so
    /// nothing needs inverting — but the standardizer that shipped with the
    /// profile has the wrong dimension, and every vote is now short a few
    /// coordinates. Both halves have to be right or the failure is silent:
    /// keeping the old standardizer would transform vectors of one width
    /// against means of another, and dropping the votes would read as "this
    /// user has no opinion" about coordinates they voted on hundreds of times.
    ///
    /// Wave 3 is the case in hand — `chain_balance`, `frac_sidechained` and
    /// `mod_at_source` did not exist — but the test is written against
    /// "whatever the last three coordinates are" so it keeps testing the
    /// mechanism rather than this particular wave.
    #[test]
    fn a_profile_written_under_a_narrower_phi_still_counts() {
        use auracle_taste::{Feedback, Observation, ObservationLog};

        let names = phi_names();
        let old_names: Vec<String> = names[..names.len() - 3].to_vec();
        let d = old_names.len();
        // A vote whose winner is higher on every coordinate it knows about.
        //
        // Strictly *inside* [0,1] rather than the `1.0 + i·0.01` this used to
        // be, and the reason is a real gate rather than a cosmetic one:
        // `migrate::repair_log` now pulls the unit-bounded coordinates back
        // into their range on load, so a synthetic row that put `mod_density`
        // at 1.19 was arriving repaired and the assertion below was reading
        // the repair rather than the projection. The property under test —
        // every coordinate strictly higher on the winner — is unchanged.
        let (a, b): (Vec<f64>, Vec<f64>) = (
            (0..d)
                .map(|i| (i as f64 + 1.0) / (d as f64 + 1.0))
                .collect(),
            vec![0.0; d],
        );
        let mut log = ObservationLog::new();
        log.push(Observation::new(
            Feedback::Duel {
                a: a.clone(),
                b: b.clone(),
                chose_a: true,
            },
            0,
            &old_names,
        ));
        let profile = Profile {
            log,
            standardizer: Some(auracle_taste::Standardizer {
                mean: vec![0.0; d],
                std: vec![1.0; d],
            }),
        };

        let mut rng = StdRng::seed_from_u64(0x3C0);
        let mut engine = Engine::new(
            PatchGrammarPrior::default(),
            SessionConfig {
                pool_size: 8,
                ..fast()
            },
        );
        engine.begin_session();
        engine.fill_pool(&mut rng);
        engine.import_profile(profile);

        // The profile's standardizer is obsolete by width, so it is dropped
        // and a fresh one fit from the live pool. Carrying it would silently
        // mis-scale every coordinate.
        let sz = engine.standardizer.as_ref().expect("standardizer refit");
        assert_eq!(sz.dimension(), names.len());
        // The vote keeps the names it was recorded under — it is not
        // re-stamped, because it genuinely says nothing about the new
        // coordinates and claiming otherwise would be a fabricated zero.
        assert_eq!(engine.log.observations[0].feature_names, old_names);
        // It is therefore not eligible to fit the standardizer (wrong width)…
        assert_eq!(engine.log.raw_rows(&names).len(), 0);

        // …and it still lands in the fit, projected by name.
        let data = auracle_taste::FitSet::build(&engine.log, &names, sz);
        let auracle_taste::Feedback::Duel {
            a: za,
            b: zb,
            chose_a,
        } = &data.rows[0].0
        else {
            panic!("modality changed");
        };
        assert!(chose_a);
        assert_eq!(za.len(), names.len());
        for j in 0..d {
            assert_eq!(za[j], (a[j] - sz.mean[j]) / sz.std[j], "{} lost", names[j]);
            assert!(za[j] > zb[j], "{} flipped", names[j]);
        }
        // The three that did not exist are imputed at the mean, which is
        // exactly zero in standardized space: "this vote says nothing here".
        for j in d..names.len() {
            assert_eq!(za[j], 0.0, "{} invented evidence", names[j]);
            assert_eq!(zb[j], 0.0, "{} invented evidence", names[j]);
        }
    }

    /// A session saved under the **v1 palette** still loads — bank, votes and
    /// all — after the palette grew modulation slots on modules that already
    /// shipped.
    ///
    /// This is the failure mode a palette expansion produces and a schema
    /// migration does not catch, because nothing about the *log* changed. The
    /// v2 palette added `mod_depth` + `modulation` to `Delay`, `Chorus` and
    /// `Reverb`, and serde requires every field of a struct variant by
    /// default — so before those fields were `#[serde(default)]`, a single
    /// v1-era delay anywhere in a bank failed the `SessionState` deserialize.
    /// Not the patch: the **save**. Bank, observation log, lineage,
    /// calibration, all of it, for a user who did nothing but keep using the
    /// app. Roughly a third of v1 op draws were one of those three modules,
    /// so most real banks contained at least one.
    ///
    /// The fixture is hand-written v1-shaped JSON rather than a serialized
    /// current tree, because a current tree round-trips trivially and would
    /// assert nothing. The defaults must also be *v1 behaviour* — depth 0,
    /// no modulation source — so a restored patch sounds like the one that
    /// was saved, which the parameter asserts below check.
    #[test]
    fn v1_palette_session_still_loads() {
        use auracle_grammar::term::{AudioNode, ModNode};

        // One tree per module that gained a slot, in the exact shape v1 wrote.
        let v1_bank = r#"[
          {"id":0,"tree":{"amp":{"attack":0.1,"decay":0.2,"sustain":0.5,"release":0.3},
            "root":{"Delay":{"time":0.4,"feedback":0.3,"mix":0.5,
              "input":{"Vco":{"wave":"Saw","octave":0,"detune":0.2}}}}},
           "origin":"prior","name":null,"pinned":false},
          {"id":1,"tree":{"amp":{"attack":0.1,"decay":0.2,"sustain":0.5,"release":0.3},
            "root":{"Chorus":{"rate":0.4,"depth":0.3,"mix":0.5,
              "input":{"Supersaw":{"octave":0,"detune":0.3,"mix":0.5}}}}},
           "origin":"prior","name":null,"pinned":false},
          {"id":2,"tree":{"amp":{"attack":0.1,"decay":0.2,"sustain":0.5,"release":0.3},
            "root":{"Reverb":{"size":0.4,"damp":0.3,"mix":0.5,
              "input":{"Filter":{"kind":"SvfLp","cutoff":0.6,"resonance":0.3,
                "mod_depth":0.2,"modulation":{"Lfo":{"wave":"Sine","rate":0.3}},
                "input":{"Vco":{"wave":"Square","octave":-1,"detune":0.1}}}}}}},
           "origin":"prior","name":null,"pinned":false},
          {"id":3,"tree":{"amp":{"attack":0.1,"decay":0.2,"sustain":0.5,"release":0.3},
            "root":{"Vco":{"wave":"Triangle","octave":1,"detune":0.75}}},
           "origin":"prior","name":null,"pinned":false},
          {"id":4,"tree":{"amp":{"attack":0.1,"decay":0.2,"sustain":0.5,"release":0.3},
            "root":{"Supersaw":{"octave":-1,"detune":0.65,"mix":0.4}}},
           "origin":"prior","name":null,"pinned":false}
        ]"#;
        let d = crate::migrate::SCHEMA1_NAMES.len();
        let sz = auracle_taste::Standardizer {
            mean: (0..d).map(|i| 0.1 + i as f64 * 0.01).collect(),
            std: vec![0.5; d],
        };
        let saved = format!(
            r#"{{"profile":{{"log":{{"observations":[
                 {{"Duel":{{"a":{a},"b":{b},"chose_a":true,"session":0}}}}
               ]}},"standardizer":{sz}}},
               "bank":{v1_bank},"lineage":[],"generation":3}}"#,
            a = serde_json::to_string(&vec![0.4_f64; d]).unwrap(),
            b = serde_json::to_string(&vec![-0.4_f64; d]).unwrap(),
            sz = serde_json::to_string(&sz).unwrap(),
        );

        let state: SessionState =
            serde_json::from_str(&saved).expect("a v1-palette save must still deserialize");
        assert_eq!(state.bank.len(), 5);

        // The added knobs default to "as it sounded in v1".
        let AudioNode::Delay {
            time,
            mod_depth,
            modulation,
            ..
        } = &state.bank[0].tree.root
        else {
            panic!("delay did not survive the load");
        };
        assert_eq!(*time, 0.4, "a saved parameter changed value on load");
        assert_eq!(*mod_depth, 0.0, "new knob must default to inaudible");
        assert_eq!(*modulation, ModNode::None);
        assert!(matches!(
            &state.bank[1].tree.root,
            AudioNode::Chorus { mod_depth, modulation, .. }
                if *mod_depth == 0.0 && *modulation == ModNode::None
        ));
        // Reverb's own slot defaults, but the filter *below* it had a slot in
        // v1 and must keep the source that was saved in it.
        let AudioNode::Reverb {
            mod_depth, input, ..
        } = &state.bank[2].tree.root
        else {
            panic!("reverb did not survive the load");
        };
        assert_eq!(*mod_depth, 0.0);
        assert!(
            matches!(&**input, AudioNode::Filter { modulation, .. }
                if matches!(modulation, ModNode::Lfo { .. })),
            "a slot that already existed in v1 lost its source"
        );

        // Wave 2A put a pitch-modulation slot on the two oldest sources, and
        // a vco is in *every* saved patch — so a missing `#[serde(default)]`
        // there does not cost one module, it fails the whole `SessionState`
        // deserialize and takes bank, observation log and lineage with it.
        // These two entries are the shapes that would have caught that:
        // roots with no `mod_depth` and no `modulation` key at all.
        let AudioNode::Vco {
            wave,
            octave,
            detune,
            mod_depth,
            modulation,
            ..
        } = &state.bank[3].tree.root
        else {
            panic!("a v1-shaped vco did not survive the load");
        };
        assert_eq!(*wave, auracle_grammar::term::Waveform::Triangle);
        assert_eq!(*octave, 1);
        assert_eq!(*detune, 0.75, "a saved parameter changed value on load");
        assert_eq!(*mod_depth, 0.0, "new pitch knob must default to inaudible");
        assert_eq!(*modulation, ModNode::None);
        let AudioNode::Supersaw {
            octave,
            detune,
            mix,
            mod_depth,
            modulation,
            ..
        } = &state.bank[4].tree.root
        else {
            panic!("a v1-shaped supersaw did not survive the load");
        };
        assert_eq!(*octave, -1);
        assert_eq!(*detune, 0.65);
        assert_eq!(*mix, 0.4);
        assert_eq!(*mod_depth, 0.0);
        assert_eq!(*modulation, ModNode::None);
        // The vcos nested *inside* the three older entries must have defaulted
        // too — that is the shape a real save actually has.
        let AudioNode::Delay { input, .. } = &state.bank[0].tree.root else {
            unreachable!("checked above")
        };
        assert!(
            matches!(&**input, AudioNode::Vco { mod_depth, modulation, .. }
                if *mod_depth == 0.0 && *modulation == ModNode::None),
            "a nested v1 vco lost its defaults"
        );

        // And the whole thing restores into a live engine: every v1 patch
        // compiles, renders and vets under the v2 compiler, and the user's
        // vote is still in the log.
        let mut rng = StdRng::seed_from_u64(0x71D);
        let mut engine = Engine::new(
            PatchGrammarPrior::default(),
            SessionConfig {
                pool_size: 8,
                ..fast()
            },
        );
        engine.begin_session();
        engine.fill_pool(&mut rng);
        let restored = engine.import_state(state);
        assert_eq!(restored, 5, "a v1 patch was dropped on restore");
        assert_eq!(engine.log.len(), 1, "the user's vote did not survive");
        assert!(
            engine.log.observations[0].is_raw(),
            "the schema-1 vote was not migrated"
        );
        assert!(
            engine.pool.iter().all(|c| !c.phi_std.is_empty()),
            "a restored v1 patch has no features"
        );

        // Node identities are the other thing this fixture is now proving: it
        // was written long before uids existed, so every node in it arrives
        // unset. The whole migration is that `#[serde(default)]` lets the save
        // load at all and the pool settles it on the way in — a returning user
        // gets working locks and layout without their save being rewritten.
        for c in &engine.pool {
            let rack = auracle_grammar::describe(&c.tree);
            let mut seen = std::collections::HashSet::new();
            for m in rack.modules.iter().filter(|m| m.key != "amp") {
                assert_ne!(m.uid, 0, "a restored node has no identity at {}", m.key);
                assert!(seen.insert(m.uid), "restored identities collide");
            }
        }
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
        let phrase = auracle_features::PhraseSpec::default();

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

    /// **A farm on a stale clip still builds the serial pool.** The farm
    /// measures with the clip its phrase carries, and after a capture (or a
    /// restore that installed a clip) it can be a phrase behind. Every draw
    /// that listens then comes back measured, or vetted out, under the old
    /// clip. Absorption measures those draws here, so the pool is the one the
    /// serial fold builds with the session's own clip. Without that, the
    /// pool admits the old clip's φ under a key that names it.
    #[test]
    fn a_farm_on_a_stale_clip_still_builds_the_serial_pool() {
        const SEED: u64 = 0x5EED_A0D1;
        // AUDIO IN as the likeliest source, so a six-patch pool holds
        // listeners.
        let mut prior = PatchGrammarPrior::default();
        prior.source_weights[auracle_grammar::prior::N_SOURCES - 1] = 2.0;
        let cfg = || SessionConfig {
            pool_size: 6,
            ..fast()
        };
        let mut serial = Engine::new(prior.clone(), cfg());
        serial.begin_session();
        serial.set_fill_seed(SEED);
        serial.fill_pool(&mut StdRng::seed_from_u64(0xDEAD));
        assert!(
            serial.pool.iter().filter(|c| c.tree.listens()).count() >= 2,
            "the pool holds too few listeners to test"
        );

        let mut farm = Engine::new(prior, cfg());
        farm.begin_session();
        farm.set_fill_seed(SEED);
        let stale = auracle_features::PhraseSpec {
            clip: Some(sweep_clip(&farm.cfg.phrase)),
            ..farm.cfg.phrase.clone()
        };
        loop {
            let wave = farm.fill_draw(3);
            if wave.is_empty() {
                break;
            }
            for d in wave {
                let pre = if d.dup {
                    None
                } else {
                    PreFeaturized::render(d.tree, &stale, false).ok()
                };
                farm.absorb_prior(d.index, pre);
            }
        }
        assert_eq!(
            pool_signature(&serial),
            pool_signature(&farm),
            "a farm a clip behind built another pool"
        );
        let keys = |e: &Engine| e.pool.iter().map(|c| c.key.clone()).collect::<Vec<_>>();
        assert_eq!(
            keys(&serial),
            keys(&farm),
            "a listener kept the old clip's key"
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

        let phrase = auracle_features::PhraseSpec::default();
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
                            audition: Some(std::sync::Arc::new(auracle_features::Audition {
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

        let phrase = auracle_features::PhraseSpec::default();
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
        let preset = auracle_grammar::presets()[0].1.clone();
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

    // ---- audition clips (Plan-007 task 3) ----

    /// A patch that listens: the input through a lowpass.
    fn listening_patch() -> auracle_grammar::PatchTree {
        use auracle_grammar::term::{AmpEnv, AudioNode, FilterKind, InputChannel, ModNode};
        auracle_grammar::PatchTree {
            amp: AmpEnv {
                attack: 0.05,
                decay: 0.3,
                sustain: 0.8,
                release: 0.3,
            },
            root: AudioNode::Filter {
                uid: auracle_grammar::Uid::NEW,
                kind: FilterKind::SvfLp,
                cutoff: 0.5,
                resonance: 0.2,
                mod_depth: 0.0,
                input: Box::new(AudioNode::AudioIn {
                    uid: auracle_grammar::Uid::NEW,
                    input: 0,
                    gain: auracle_grammar::INPUT_GAIN_UNITY,
                    channel: InputChannel::Both,
                }),
                modulation: ModNode::None,
            },
        }
    }

    /// A captured clip: a falling sweep, the phrase's length.
    fn sweep_clip(spec: &auracle_features::PhraseSpec) -> auracle_features::AuditionClip {
        let x: Vec<f32> = (0..spec.total_samples())
            .map(|i| {
                let t = i as f64 / spec.sample_rate;
                let hz = 1200.0 * (-t / 2.5).exp() + 80.0;
                (0.4 * (std::f64::consts::TAU * hz * t).sin()) as f32
            })
            .collect();
        auracle_features::AuditionClip::from_interleaved(&x, 1, spec.sample_rate, spec).unwrap()
    }

    /// An engine with one patch that listens and one that does not.
    fn listening_engine() -> (Engine, u64, u64) {
        let cfg = SessionConfig {
            pool_size: 4,
            ..fast()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        // A fill gives the session its standardizer; then room for two more,
        // so neither insert evicts anything.
        engine.begin_session();
        engine.fill_pool(&mut StdRng::seed_from_u64(0xC11F));
        engine.cfg.pool_size += 2;
        let listens = engine
            .insert_preset(listening_patch(), "listens")
            .expect("a listening patch vets on the reference");
        let deaf = engine
            .insert_preset(auracle_grammar::presets()[0].1.clone(), "deaf")
            .expect("a preset vets");
        (engine, listens, deaf)
    }

    /// Setting a clip measures again the members that listen, and only them:
    /// the listener's key and φ move, the other's do not.
    #[test]
    fn a_new_clip_remeasures_only_the_patches_that_listen() {
        let (mut engine, listens, deaf) = listening_engine();
        // What a measurement wrote on a member: its key and its raw φ.
        let at = |e: &Engine, id: u64| {
            let c = &e.pool[e.find(id).unwrap()];
            (c.key.clone(), c.features.phi())
        };
        let (before_l, before_d) = (at(&engine, listens), at(&engine, deaf));
        assert_eq!(
            engine.audition_clip_status().source,
            auracle_features::ClipSource::Reference
        );
        let clip = sweep_clip(&engine.cfg.phrase);
        let change = engine.set_audition_clip(Some(clip.clone()));
        assert_eq!(change.remeasured, vec![listens]);
        assert!(change.unmeasured.is_empty());
        let (after_l, after_d) = (at(&engine, listens), at(&engine, deaf));
        assert_ne!(
            before_l.0, after_l.0,
            "the listener's key names the new clip"
        );
        assert_ne!(before_l.1, after_l.1, "and its φ was measured with it");
        assert_eq!(
            before_d, after_d,
            "a patch that does not listen is untouched"
        );
        let status = engine.audition_clip_status();
        assert_eq!(status.source, auracle_features::ClipSource::Captured);
        assert_eq!(status.id, clip.id());
        // Setting the same clip again changes nothing.
        assert_eq!(engine.set_audition_clip(Some(clip)), ClipChange::default());
    }

    /// The clip is saved with the session and restored before the bank is
    /// measured, so a reload measures a listening patch exactly as before.
    #[test]
    fn a_clip_is_saved_with_the_session_and_restored() {
        let (mut engine, listens, _) = listening_engine();
        let clip = sweep_clip(&engine.cfg.phrase);
        engine.set_audition_clip(Some(clip.clone()));
        let phi = engine.pool[engine.find(listens).unwrap()].features.phi();
        let saved = serde_json::to_string(&engine.export_state()).unwrap();
        // The bound, in the file: 16-bit samples, five seconds of mono.
        let state: SessionState = serde_json::from_str(&saved).unwrap();
        let data = state.audition_clip.as_ref().unwrap()["data"]
            .as_str()
            .unwrap()
            .len();
        assert_eq!(data, (clip.frames() * 2).div_ceil(3) * 4);
        assert!(
            clip.seconds() <= auracle_features::MAX_CLIP_SECONDS,
            "a clip is never longer than the bound"
        );
        let mut back = Engine::new(PatchGrammarPrior::default(), engine.cfg.clone());
        back.cfg.phrase.clip = None;
        back.import_state(state);
        let status = back.audition_clip_status();
        assert_eq!(status.id, clip.id());
        assert_eq!(status.unreadable, None);
        assert_eq!(back.pool[back.find(listens).unwrap()].features.phi(), phi);
    }

    /// A clip the session file holds but that cannot be read costs the
    /// session its clip and nothing else: the bank and the log come back, the
    /// patches that listen are measured with the reference, and the status
    /// says why.
    #[test]
    fn an_unreadable_clip_restores_as_the_reference_and_says_so() {
        let (mut engine, listens, _) = listening_engine();
        engine.set_audition_clip(Some(sweep_clip(&engine.cfg.phrase)));
        let mut state = engine.export_state();
        state.audition_clip.as_mut().unwrap()["channels"] = 7.into();
        let text = serde_json::to_string(&state).unwrap();
        let state: SessionState = serde_json::from_str(&text).expect("the session still parses");
        let mut back = Engine::new(PatchGrammarPrior::default(), fast());
        assert_eq!(back.import_state(state), engine.pool.len());
        let status = back.audition_clip_status();
        assert_eq!(status.source, auracle_features::ClipSource::Reference);
        assert!(status.unreadable.is_some(), "the fallback is reported");
        let c = &back.pool[back.find(listens).unwrap()];
        assert_eq!(
            c.key,
            auracle_features::render_key(&c.tree, &auracle_features::PhraseSpec::default()),
            "measured with the reference"
        );
    }
}
