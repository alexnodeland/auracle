use super::*;
use crate::testkit::*;
use crate::*;
use auracle_features::Features;
use auracle_grammar::PatchGrammarPrior;
use auracle_taste::synthetic::cosine;
use auracle_taste::Provenance;
use auracle_taste::SyntheticUser;
use rand::rngs::StdRng;
use rand::SeedableRng;

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
    let restored = reload(&engine);
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
                let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
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
        let spread = (ys.iter().map(|y| (y - my) * (y - my)).sum::<f64>() / ys.len() as f64).sqrt();
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
        assert_eq!(
            other.display_names(),
            serial.display_names(),
            "{name} named the generation differently"
        );
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
    let mut back = restore(&engine, engine.export_state());
    assert_eq!(
        back.begin_session(),
        0,
        "three votes do not earn a second τ"
    );
    assert_eq!(back.log.n_sessions(), 1);

    for i in 0..MIN_SESSION_OBS {
        back.record_keep(i % back.pool.len(), false);
    }
    let mut again = restore(&back, back.export_state());
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
    let merged = restore(&again, legacy);
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

/// Take the lowest-rated member that is not an edit out of a taught pool
/// and keep its tree as new, so the sound kept is, by construction, the
/// one the model rates lowest among the rest (every earlier keep aside):
/// the case that motivated protecting it. Returns its id. `original` is
/// passed to `commit_edit` with `outcome`.
fn keep_lowest_as_new(engine: &mut Engine, original: Option<u64>, outcome: EditOutcome) -> u64 {
    let lowest = |e: &Engine| {
        e.ranked()
            .into_iter()
            .rev()
            .map(|(i, _, _)| i)
            .find(|&i| e.pool[i].origin != Origin::Edited)
    };
    let worst = lowest(engine).expect("a ranked pool");
    let gone = engine.pool.remove(worst);
    let id = engine
        .commit_edit(original, gone.tree, outcome)
        .expect("kept as new");
    let rest = engine
        .ranked()
        .into_iter()
        .rev()
        .map(|(i, _, _)| &engine.pool[i])
        .find(|c| c.origin != Origin::Edited || c.id == id)
        .map(|c| c.id);
    assert_eq!(
        rest,
        Some(id),
        "the precondition: the sound kept as new rates lowest"
    );
    id
}

/// A preset's tree with one knob moved: a sound no pool holds yet, so
/// inserting it always takes a place.
fn fresh_preset(i: usize) -> auracle_grammar::PatchTree {
    let (_, tree) = auracle_grammar::presets().remove(i);
    auracle_grammar::set_param(
        &tree,
        "amp#attack",
        auracle_grammar::ParamValue::Continuous(0.0123),
    )
    .expect("every preset has an amp")
}

/// The maintainer's rule: a sound kept as new is not replaced until it
/// has been through a pick. Before, a preset opened on a full pool
/// replaced the sound just kept whenever the model rated it lowest; here
/// it rates lowest, more presets are opened than the pool holds, and a
/// generation runs, and it is still there, outside every "may be
/// replaced" list, and not charged to the Saved budget. One pick later
/// (it is A of a recorded pair, and loses) it is the first sound the
/// next generation may replace, and the next preset replaces it.
#[test]
fn a_sound_kept_as_new_is_not_replaced_until_its_first_pick() {
    let mut engine = taught(0x4EE9);
    let size = engine.cfg.pool_size;
    let kept = keep_lowest_as_new(&mut engine, None, EditOutcome::Untold);
    assert_eq!(engine.unjudged(), vec![kept]);
    assert_eq!(
        engine.pinned_count(),
        0,
        "a kept sound spent the Saved budget"
    );
    assert!(
        !engine.may_replace().contains(&kept),
        "EVOLVE marks the kept sound \"may be replaced\""
    );
    assert!(!engine.belief().may_replace.contains(&kept));

    let mut opened = 0;
    for (name, tree) in auracle_grammar::presets() {
        if engine.insert_preset(tree, name).is_some() {
            opened += 1;
        }
    }
    assert!(opened > size, "only {opened} presets opened");
    assert_eq!(engine.pool.len(), size);
    assert!(
        engine.find(kept).is_some(),
        "a preset replaced the sound kept as new"
    );
    engine.refine(&mut StdRng::seed_from_u64(0x4EEA));
    assert!(engine.find(kept).is_some(), "a generation replaced it");
    assert!(!engine.retired().contains(&kept));

    // One pick: it is A, and the other side wins.
    let k = engine.find(kept).unwrap();
    let other = (0..engine.pool.len()).find(|&i| i != k).unwrap();
    engine.record_duel(k, other, false);
    assert!(engine.unjudged().is_empty(), "a pick left it protected");
    assert!(!engine.pool[engine.find(kept).unwrap()].kept());
    assert_eq!(
        engine.pool[engine.ranked().last().unwrap().0].id,
        kept,
        "the precondition: it still rates lowest"
    );
    assert_eq!(
        engine.may_replace().first(),
        Some(&kept),
        "judged and lowest, yet not the first that may be replaced"
    );
    assert!(engine.insert_preset(fresh_preset(0), "Fresh").is_some());
    assert!(
        engine.find(kept).is_none(),
        "a judged sound rated lowest was not replaced"
    );
}

/// The comparison that keeps a sound as new does not count as its pick
/// (it judges the original), or the protection would be gone the moment
/// it was given on KEEP AS NEW's usual path. An answered PERFORM offer
/// is a pick, on either side, by tree.
#[test]
fn the_keep_is_not_the_pick_but_a_perform_offer_is() {
    let mut engine = taught(0x4EEB);
    let original = engine.pool[0].id;
    let kept = keep_lowest_as_new(
        &mut engine,
        Some(original),
        EditOutcome::Heard { edited_won: false },
    );
    assert_eq!(
        engine.unjudged(),
        vec![kept],
        "the keep's own pick cleared it"
    );
    let tree = engine.pool[engine.find(kept).unwrap()].tree.clone();
    let offer = auracle_grammar::set_param(
        &tree,
        "amp#attack",
        auracle_grammar::ParamValue::Continuous(0.0321),
    )
    .unwrap();
    assert!(engine.record_tree_duel(&offer, &tree, true, auracle_taste::Provenance::PerformOffer));
    assert!(
        engine.unjudged().is_empty(),
        "an answered offer left it protected"
    );

    // The sound in hand heard with its controls moved is still that
    // sound: the frontend marks it by its own tree.
    let again = keep_lowest_as_new(&mut engine, None, EditOutcome::Untold);
    let tree = engine.pool[engine.find(again).unwrap()].tree.clone();
    engine.mark_judged(&tree, u64::MAX);
    assert!(engine.unjudged().is_empty());
}

/// An answer given before a sound was kept as new is not a pick for it,
/// even when it is recorded after (PERFORM holds a Take eight seconds):
/// it judges only members already in the pool when it was given.
#[test]
fn an_answer_judges_only_sounds_already_in_the_pool_when_it_was_given() {
    let mut engine = taught(0x4EEF);
    let as_of = engine.pool.iter().map(|c| c.id).max().unwrap();
    let kept = keep_lowest_as_new(&mut engine, None, EditOutcome::Untold);
    assert!(kept > as_of);
    let tree = engine.pool[engine.find(kept).unwrap()].tree.clone();
    let home = engine
        .pool
        .iter()
        .find(|c| c.id != kept)
        .unwrap()
        .tree
        .clone();
    assert!(engine.record_tree_duel_as_of(
        &home,
        &tree,
        false,
        auracle_taste::Provenance::PerformOffer,
        as_of
    ));
    engine.mark_judged(&tree, as_of);
    assert_eq!(
        engine.unjudged(),
        vec![kept],
        "an answer given before the keep judged the kept sound"
    );
    assert!(engine.record_tree_duel_as_of(
        &home,
        &tree,
        true,
        auracle_taste::Provenance::PerformOffer,
        kept
    ));
    assert!(engine.unjudged().is_empty());
}

/// A cut is an answer about the sound: a sound kept as new and cut
/// competes like any cut sound. A star is not a pick and leaves it safe.
#[test]
fn a_cut_ends_the_protection_and_a_star_does_not() {
    let mut engine = taught(0x4EF0);
    let kept = keep_lowest_as_new(&mut engine, None, EditOutcome::Untold);
    engine.record_stars(engine.find(kept).unwrap(), 1);
    assert_eq!(engine.unjudged(), vec![kept], "a star ended the protection");
    engine.record_keep(engine.find(kept).unwrap(), false);
    assert!(engine.unjudged().is_empty(), "a cut left it protected");
    assert_eq!(engine.may_replace().first(), Some(&kept));
}

/// A saved sound is protected by its save, so a sound kept as new and
/// then saved does not count toward the cap: keeping another past it
/// clears nothing. Unsaved, it counts again, and the oldest unsaved mark
/// past the cap goes.
#[test]
fn saved_sounds_do_not_count_toward_the_cap_on_sounds_kept_as_new() {
    let mut engine = taught(0x4EF1);
    let cap = engine.unjudged_cap();
    let mut kept = Vec::new();
    for _ in 0..cap {
        kept.push(keep_lowest_as_new(&mut engine, None, EditOutcome::Untold));
    }
    assert!(engine.set_pinned(kept[0], true));
    kept.push(keep_lowest_as_new(&mut engine, None, EditOutcome::Untold));
    assert_eq!(
        engine.unjudged(),
        kept,
        "a saved sound counted toward the cap"
    );
    assert!(engine.set_pinned(kept[0], false));
    assert_eq!(
        engine.unjudged(),
        kept[1..].to_vec(),
        "unsaved, the oldest past the cap kept its mark"
    );
}

/// The bound: at most `unjudged_cap` sounds kept as new are protected at
/// once, the newest, so the pool can never be protected solid. With the
/// Saved budget spent as well, every preset still lands and the pool
/// keeps its size, and a keep past the cap hands the oldest back to
/// normal eviction rather than removing it.
#[test]
fn sounds_kept_as_new_are_protected_up_to_a_cap_newest_first() {
    let mut engine = taught(0x4EEC);
    let size = engine.cfg.pool_size;
    let cap = engine.unjudged_cap();
    assert!(cap >= 1 && 2 * cap < size, "cap {cap} is not a real bound");
    let mut kept = Vec::new();
    for _ in 0..cap + 2 {
        kept.push(keep_lowest_as_new(&mut engine, None, EditOutcome::Untold));
    }
    assert_eq!(engine.unjudged(), kept[2..].to_vec(), "not the newest");
    assert!(
        kept[..2].iter().all(|id| engine.find(*id).is_some()),
        "the cap removed a sound instead of its protection"
    );
    // Spend the Saved budget on members not kept as new.
    let free: Vec<u64> = engine
        .pool
        .iter()
        .filter(|c| !c.unjudged)
        .map(|c| c.id)
        .take(engine.pin_cap())
        .collect();
    for id in &free {
        assert!(engine.set_pinned(*id, true));
    }
    assert_eq!(engine.pinned_count(), engine.pin_cap());
    for i in 0..auracle_grammar::presets().len() {
        assert!(
            engine.insert_preset(fresh_preset(i), "Fresh").is_some(),
            "a preset found nothing it could replace"
        );
        assert_eq!(engine.pool.len(), size, "the pool overflowed");
    }
    assert!(
        kept[2..].iter().all(|id| engine.find(*id).is_some()),
        "a protected sound was replaced"
    );
    assert!(
        kept[..2].iter().all(|id| engine.find(*id).is_none()),
        "the oldest keeps, past the cap, were never replaced"
    );
    assert!(free.iter().all(|id| engine.find(*id).is_some()));
}

/// The mark survives a save and a reload; a session with no sound kept
/// as new saves without the key, exactly as before; and an entry saved
/// before the mark existed loads judged.
#[test]
fn a_sound_kept_as_new_is_still_protected_after_a_reload() {
    let mut engine = taught(0x4EED);
    let quiet = serde_json::to_value(engine.export_state()).unwrap();
    assert!(
        quiet["bank"]
            .as_array()
            .unwrap()
            .iter()
            .all(|e| e.get("unjudged").is_none()),
        "a session with nothing kept as new saved a new key"
    );
    let kept = keep_lowest_as_new(&mut engine, None, EditOutcome::Untold);
    let restored = reload(&engine);
    assert_eq!(restored.unjudged(), vec![kept]);

    let mut legacy = serde_json::to_value(engine.export_state()).unwrap();
    for e in legacy["bank"].as_array_mut().unwrap() {
        e.as_object_mut().unwrap().remove("unjudged");
    }
    let old = restore(&engine, serde_json::from_value(legacy).unwrap());
    assert!(
        old.unjudged().is_empty(),
        "an old session loaded a sound as unjudged"
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

/// Names must **spread**, not merely be unique after numbering.
///
/// The failure this guards was measured in the running app: 13 of 40 bank
/// rows named `Glass Pad`, numerals to `Glass Pad 12`. The old test passed
/// throughout, because uniqueness-after-disambiguation is exactly what a
/// numeral suffix guarantees no matter how degenerate the generator is.
/// Concentration is the property with product meaning, so concentration is
/// what gets asserted.
///
/// The names are also ones a musician could say out loud (a character and
/// a role, capitalized), no two rows share one, and a name the player gives
/// wins over the generated one.
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
    for v in names.values() {
        assert!(v.split(' ').count() >= 2, "not a <character> <role>: {v}");
        assert!(v.starts_with(char::is_uppercase), "not capitalized: {v}");
    }
    let id = engine.pool[0].id;
    engine.set_name(id, "My Bass");
    assert_eq!(engine.display_names()[&id], "My Bass");
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
    let names: std::collections::HashSet<String> = variants.iter().map(|f| scale.name(f)).collect();
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
/// kept is named once, on restore, as it always was: every unnamed sound
/// read off the whole restored bank, claimed in id order. A restore is not
/// a fill, so the fill's joining order (#154) must not reach it; when it
/// did, 12 of these 16 sounds came back under new names.
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

    let restored = restore(&engine, engine.export_state());
    assert_eq!(
        restored.display_names(),
        before,
        "a reload renamed the bank"
    );

    let mut old = serde_json::to_value(engine.export_state()).unwrap();
    for entry in old["bank"].as_array_mut().unwrap() {
        entry.as_object_mut().unwrap().remove("auto_name");
    }
    let restored = restore(&engine, serde_json::from_value(old).unwrap());
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
    let whole = {
        let scale = NameScale::fit(restored.pool.iter().map(|c| &c.features));
        let mut taken = std::collections::HashSet::new();
        let mut by_id: Vec<&Candidate> = restored.pool.iter().collect();
        by_id.sort_by_key(|c| c.id);
        by_id
            .into_iter()
            .map(|c| (c.id, claim_name(&scale.name(&c.features), &mut taken)))
            .collect::<std::collections::HashMap<u64, String>>()
    };
    assert_eq!(
        names, whole,
        "an older save was not named off the whole bank it restored"
    );
}

/// A name cleared on a sound that never had a generated one (named in a
/// session saved before names were kept) is read off the bank as it
/// stands, like any name given now, not off the oldest sounds in it. Only
/// patches named in the order they joined are read off the bank as it
/// stood when they joined (#154).
#[test]
fn a_cleared_name_is_read_off_the_bank_as_it_stands() {
    use std::collections::HashSet;
    let mut rng = StdRng::seed_from_u64(0x9A7);
    let cfg = || SessionConfig {
        pool_size: 24,
        ..fast()
    };
    let mut engine = Engine::new(PatchGrammarPrior::default(), cfg());
    engine.begin_session();
    engine.fill_pool(&mut rng);
    let mut by_id: Vec<&Candidate> = engine.pool.iter().collect();
    by_id.sort_by_key(|c| c.id);
    // Among the oldest sounds, one the oldest NAME_FLOOR and the whole
    // bank would call different things, or this proves nothing.
    let oldest = NameScale::fit(by_id[..NAME_FLOOR].iter().map(|c| &c.features));
    let whole = NameScale::fit(engine.pool.iter().map(|c| &c.features));
    let id = by_id[..NAME_FLOOR]
        .iter()
        .find(|c| oldest.name(&c.features) != whole.name(&c.features))
        .map(|c| c.id)
        .expect("the oldest sounds read alike either way; the test needs a seed that does not");
    let base = whole.name(&engine.pool.iter().find(|c| c.id == id).unwrap().features);

    // Named by the player, saved by a build before names were kept.
    engine.set_name(id, "Mine");
    let mut old = serde_json::to_value(engine.export_state()).unwrap();
    for entry in old["bank"].as_array_mut().unwrap() {
        if entry["id"].as_u64() == Some(id) {
            entry.as_object_mut().unwrap().remove("auto_name");
        }
    }
    let mut restored = restore(&engine, serde_json::from_value(old).unwrap());
    let c = restored.pool.iter().find(|c| c.id == id).unwrap();
    assert!(c.auto_name.is_none(), "the fixture's sound came back named");

    restored.set_name(id, "");
    let mut taken: HashSet<String> = restored
        .pool
        .iter()
        .filter(|c| c.id != id)
        .filter_map(|c| c.name.clone().or_else(|| c.auto_name.clone()))
        .collect();
    assert_eq!(
        restored.display_names()[&id],
        claim_name(&base, &mut taken),
        "a cleared name was read off the oldest sounds, not the bank"
    );

    // The same in a bank where every sound carries a player's name and
    // none a generated one, so no name is kept to order it by.
    let ids: Vec<u64> = engine.pool.iter().map(|c| c.id).collect();
    for (k, each) in ids.iter().enumerate() {
        engine.set_name(*each, &format!("Mine {k}"));
    }
    let mut old = serde_json::to_value(engine.export_state()).unwrap();
    for entry in old["bank"].as_array_mut().unwrap() {
        entry.as_object_mut().unwrap().remove("auto_name");
    }
    let mut restored = restore(&engine, serde_json::from_value(old).unwrap());
    assert!(restored.pool.iter().all(|c| c.auto_name.is_none()));
    restored.set_name(id, "");
    let mut taken: HashSet<String> = restored
        .pool
        .iter()
        .filter(|c| c.id != id)
        .filter_map(|c| c.name.clone())
        .collect();
    assert_eq!(
        restored.display_names()[&id],
        claim_name(&base, &mut taken),
        "in a bank named by its player, a cleared name was read off the oldest sounds"
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
///
/// Each bound is set from a sweep, not from this seed. `Random`'s are the
/// uniform rule's own tails (400 000 simulated deals of 12 pairs from 24):
/// each fails on fewer than 0.4% of seeds. `Bald`'s are 32 seeds of this
/// very fixture (`0xD4E + k·0x9E37`): 15 to 20 distinct candidates, a share
/// of at most 4 of 12, and 12 distinct pairs on 31 seeds, 11 on one.
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
        //
        // `Bald`'s penalty is soft: it makes a repeat costly, not
        // impossible, and one seed in the sweep of 32 repeats a pair once.
        // Asking for every pair distinct failed on that 3% of seeds; one
        // repeat is the bound the sweep supports.
        let min_pairs = match acquisition {
            Acquisition::Bald => N - 1,
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
        // The share splits too. A uniform rule puts some candidate in 5 or
        // more of 12 duels (a share over 0.35) on 4.6% of seeds, so that
        // bound asserted `Random`'s seed luck; 7 or more (over 0.5) happens
        // on 0.03%. `Bald` promises spread and keeps 0.35: the sweep's worst
        // is 4 of 12.
        let max_share_cap = match acquisition {
            Acquisition::Bald => 0.35,
            _ => 0.5,
        };
        assert!(
            max_share <= max_share_cap,
            "{acquisition:?}: one candidate is in {max_share:.2} of duels \
                 — best-arm degeneracy"
        );
    }
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

// ---- CAPTURE takes in the session file (Plan-007 task 6) ----

/// A sound that mixes a CAPTURE holding a take (a decaying tone, two
/// seconds at the phrase's rate, recorded from an input) with a keyed
/// VCO, so it still sounds, and still measures, without its take.
fn captured_patch() -> auracle_grammar::PatchTree {
    use auracle_grammar::term::{AmpEnv, AudioNode, CaptureMode, InputChannel, Waveform};
    use auracle_grammar::ModNode;
    let sr = auracle_features::PhraseSpec::default().sample_rate;
    let x: Vec<f32> = (0..(2.0 * sr) as usize)
        .map(|i| {
            let t = i as f64 / sr;
            (0.6 * (-t * 1.5).exp() * (std::f64::consts::TAU * 196.0 * t).sin()) as f32
        })
        .collect();
    auracle_grammar::PatchTree {
        amp: AmpEnv {
            attack: 0.02,
            decay: 0.3,
            sustain: 0.8,
            release: 0.3,
        },
        root: AudioNode::Mix {
            uid: auracle_grammar::Uid::NEW,
            balance: 0.4,
            a: Box::new(AudioNode::Capture {
                uid: auracle_grammar::Uid::NEW,
                play: CaptureMode::Once,
                input: Box::new(AudioNode::AudioIn {
                    uid: auracle_grammar::Uid::NEW,
                    input: 0,
                    gain: auracle_grammar::INPUT_GAIN_UNITY,
                    channel: InputChannel::Both,
                }),
                take: auracle_grammar::Take::from_samples(&x, sr).unwrap(),
            }),
            b: Box::new(AudioNode::Vco {
                uid: auracle_grammar::Uid::NEW,
                wave: Waveform::Triangle,
                octave: 0,
                detune: 0.5,
                mod_depth: 0.0,
                modulation: ModNode::None,
            }),
        },
    }
}

/// The take of the CAPTURE at `node/0`.
fn capture_take(tree: &auracle_grammar::PatchTree) -> auracle_grammar::Take {
    match tree.root.children().first() {
        Some(auracle_grammar::AudioNode::Capture { take, .. }) => take.clone(),
        n => panic!("no capture at node/0: {n:?}"),
    }
}

/// An engine holding one captured sound.
fn capture_engine() -> (Engine, u64) {
    let cfg = SessionConfig {
        pool_size: 4,
        ..fast()
    };
    let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
    engine.begin_session();
    engine.fill_pool(&mut StdRng::seed_from_u64(0xCA97));
    engine.cfg.pool_size += 1;
    let id = engine
        .insert_preset(captured_patch(), "captured")
        .expect("a captured sound vets");
    (engine, id)
}

/// **A take is saved with its sound, held to its bound, and comes back
/// bit for bit**, so the restored sound measures exactly as before and
/// nothing is reported as repaired.
#[test]
fn a_take_is_saved_with_its_sound_and_restored() {
    let (engine, id) = capture_engine();
    let before = &engine.pool[engine.find(id).unwrap()];
    let (tree, phi) = (before.tree.clone(), before.features.phi());
    let text = serde_json::to_string(&engine.export_state()).unwrap();
    let state: SessionState = serde_json::from_str(&text).unwrap();
    // The bound, in the file: f32 samples in base64, no longer than the
    // take's seconds at its rate.
    let saved = serde_json::to_value(&state).unwrap();
    let entry = saved["bank"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == id)
        .expect("the captured sound is in the bank");
    let take = &entry["tree"]["root"]["Mix"]["a"]["Capture"]["take"];
    let length = take["length"].as_u64().unwrap() as usize;
    assert_eq!(take["format"], auracle_grammar::TAKE_FORMAT);
    assert_eq!(
        take["data"].as_str().unwrap().len(),
        (length * 4).div_ceil(3) * 4
    );
    assert!(length as f64 <= auracle_grammar::TAKE_SECONDS * take["sample_rate"].as_f64().unwrap());
    let mut back = Engine::new(PatchGrammarPrior::default(), engine.cfg.clone());
    back.import_state(state);
    let after = &back.pool[back.find(id).unwrap()];
    assert_eq!(after.tree, tree, "the take came back different");
    assert_eq!(capture_take(&after.tree), capture_take(&tree));
    assert!(!capture_take(&tree).is_empty());
    assert_eq!(
        after.features.phi(),
        phi,
        "the restored sound measures differently"
    );
    assert_eq!(back.repair_report(), (0, 0, 0));
}

/// **A take the session file holds but that cannot be read costs the sound
/// its take and nothing else**: the bank comes back whole, the capture is
/// in place and empty, the sound is measured again without it (its φ
/// moves), and the restore reports one repaired sound, which the app tells
/// the player.
///
/// A sound whose only source is its take would restore silent and fail
/// the vet, and `import_state` drops any entry that no longer renders;
/// that rule is restore-wide and is left as it is here.
#[test]
fn an_unreadable_take_restores_the_sound_empty_and_says_so() {
    let (engine, id) = capture_engine();
    let phi = engine.pool[engine.find(id).unwrap()].features.phi();
    let mut saved = serde_json::to_value(engine.export_state()).unwrap();
    for e in saved["bank"].as_array_mut().unwrap() {
        if e["id"] == id {
            // A length the data does not hold.
            e["tree"]["root"]["Mix"]["a"]["Capture"]["take"]["length"] = 7.into();
        }
    }
    let state: SessionState = serde_json::from_value(saved).expect("the session still parses");
    let mut back = Engine::new(PatchGrammarPrior::default(), engine.cfg.clone());
    assert_eq!(
        back.import_state(state.clone()),
        engine.pool.len(),
        "the bank came back whole"
    );
    let c = &back.pool[back.find(id).unwrap()];
    assert!(
        capture_take(&c.tree).is_empty(),
        "the unreadable take was kept"
    );
    assert_ne!(
        c.features.phi(),
        phi,
        "measured as if the take were still there"
    );
    assert_eq!(back.repair_report().0, 1, "the restore did not say so");
    // The farm's restore comes back the same: each entry rendered from its
    // own term (which no longer holds the take), absorbed in bank order.
    let mut farmed = Engine::new(PatchGrammarPrior::default(), engine.cfg.clone());
    let bank = farmed.import_state_deferred(state);
    for entry in bank {
        let Ok(pre) = PreFeaturized::render(entry.tree.clone(), &engine.cfg.phrase, false) else {
            continue;
        };
        farmed.absorb_bank_entry(entry, pre);
    }
    assert_eq!(farmed.finish_restore(), engine.pool.len());
    assert_eq!(farmed.repair_report().0, 1);
    let f = &farmed.pool[farmed.find(id).unwrap()];
    assert_eq!(f.tree, c.tree);
    assert_eq!(f.features.phi(), c.features.phi());
}

// ---- held sounds: a take that was the sound's only source ----

/// A sound that is nothing but a CAPTURE with its take, in an engine.
fn capture_only_engine() -> (Engine, u64, auracle_grammar::Take) {
    let mut tree = captured_patch();
    let capture = match &tree.root {
        auracle_grammar::AudioNode::Mix { a, .. } => (**a).clone(),
        n => panic!("{n:?}"),
    };
    tree.root = capture;
    let take = capture_take_at_root(&tree);
    let cfg = SessionConfig {
        pool_size: 4,
        ..fast()
    };
    let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
    engine.begin_session();
    engine.fill_pool(&mut StdRng::seed_from_u64(0x4E1D));
    engine.cfg.pool_size += 1;
    let id = engine
        .insert_preset(tree, "only its take")
        .expect("a capture with its take vets");
    (engine, id, take)
}

fn capture_take_at_root(tree: &auracle_grammar::PatchTree) -> auracle_grammar::Take {
    match &tree.root {
        auracle_grammar::AudioNode::Capture { take, .. } => take.clone(),
        n => panic!("no capture at the root: {n:?}"),
    }
}

/// The session file with the take of sound `id` (a capture at the root)
/// corrupted: a length its data does not hold.
fn with_corrupt_take(engine: &Engine, id: u64) -> (serde_json::Value, serde_json::Value) {
    let mut saved = serde_json::to_value(engine.export_state()).unwrap();
    let mut corrupt = serde_json::Value::Null;
    for e in saved["bank"].as_array_mut().unwrap() {
        if e["id"] == id {
            let take = &mut e["tree"]["root"]["Capture"]["take"];
            take["length"] = 7.into();
            corrupt = take.clone();
        }
    }
    assert!(!corrupt.is_null(), "sound {id} has no take in the file");
    (saved, corrupt)
}

/// **A sound whose only source is an unreadable take is held, not lost.**
/// The restore leaves it out of the pool and reports it as held, apart
/// from the repairs; a save writes its take back JSON-equal to what was
/// loaded, and the next restore holds it again. It is never
/// dealt or ranked.
#[test]
fn a_sound_whose_only_take_is_unreadable_is_held_through_save_and_restore() {
    let (engine, id, _) = capture_only_engine();
    let (saved, corrupt) = with_corrupt_take(&engine, id);
    let state: SessionState = serde_json::from_value(saved).unwrap();
    let mut back = Engine::new(PatchGrammarPrior::default(), engine.cfg.clone());
    let restored = back.import_state(state);
    assert_eq!(
        restored,
        engine.pool.len() - 1,
        "the held sound is not in the pool"
    );
    assert!(back.find(id).is_none());
    assert_eq!(back.held().len(), 1);
    assert_eq!(back.held()[0].id, id);
    assert_eq!(back.held()[0].name.as_deref(), Some("only its take"));
    assert_eq!(
        back.repair_report(),
        (0, 0, 0),
        "held is reported apart from repaired"
    );
    // Never dealt, never ranked.
    let mut rng = StdRng::seed_from_u64(0xDEA1);
    for _ in 0..60 {
        let (a, b) = back.next_duel(&mut rng).expect("a duel");
        assert!(back.pool[a].id != id && back.pool[b].id != id);
    }
    assert!(back.ranked().iter().all(|(i, _, _)| back.pool[*i].id != id));
    // Saved again, the take is JSON-equal to what was loaded.
    let resaved = serde_json::to_value(back.export_state()).unwrap();
    let entry = resaved["bank"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == id)
        .expect("a save keeps the held sound");
    assert_eq!(entry["tree"]["root"]["Capture"]["take"], corrupt);
    // And the next restore holds it again.
    let state: SessionState = serde_json::from_value(resaved).unwrap();
    let mut again = Engine::new(PatchGrammarPrior::default(), engine.cfg.clone());
    again.import_state(state);
    assert_eq!(again.held().len(), 1);
    assert_eq!(again.held()[0].id, id);
    // A new sound never takes the held sound's id.
    let new = again
        .insert_preset(auracle_grammar::presets()[0].1.clone(), "new")
        .unwrap();
    assert_ne!(new, id);
}

/// **A held sound comes back with a readable take**, measured as a new
/// sound in the pool under its own id and name, and is no longer held. An
/// unknown id or an empty take is refused and changes nothing.
#[test]
fn a_held_sound_is_readmitted_with_a_readable_take() {
    let (engine, id, take) = capture_only_engine();
    let (saved, _) = with_corrupt_take(&engine, id);
    let mut back = Engine::new(PatchGrammarPrior::default(), engine.cfg.clone());
    back.import_state(serde_json::from_value(saved).unwrap());
    assert_eq!(back.held().len(), 1);
    assert_eq!(
        back.readmit_held(id + 999, take.clone()),
        Err(ReadmitError::NotHeld)
    );
    assert_eq!(
        back.readmit_held(id, auracle_grammar::Take::empty()),
        Err(ReadmitError::NoTake)
    );
    assert_eq!(back.held().len(), 1);
    assert_eq!(back.readmit_held(id, take.clone()), Ok(id));
    assert!(back.held().is_empty());
    let c = &back.pool[back.find(id).expect("in the pool")];
    assert_eq!(capture_take_at_root(&c.tree), take);
    assert_eq!(c.name.as_deref(), Some("only its take"));
    let original = &engine.pool[engine.find(id).unwrap()];
    assert_eq!(
        c.features.phi(),
        original.features.phi(),
        "measured as it sounds"
    );
    // Saved once, not twice.
    let bank = back.export_state().bank;
    assert_eq!(bank.iter().filter(|e| e.id == id).count(), 1);
}

/// A file that repeats an id cannot make one held sound drop another:
/// two entries under one id, each a capture whose only take is
/// unreadable, are both held and both saved again.
#[test]
fn a_repeated_id_never_drops_a_held_sound() {
    let (engine, id, _) = capture_only_engine();
    let (mut saved, _) = with_corrupt_take(&engine, id);
    let bank = saved["bank"].as_array_mut().unwrap();
    let mut twin = bank.iter().find(|e| e["id"] == id).unwrap().clone();
    twin["name"] = "its twin".into();
    bank.push(twin);
    let mut back = Engine::new(PatchGrammarPrior::default(), engine.cfg.clone());
    back.import_state(serde_json::from_value(saved).unwrap());
    let names: Vec<_> = back.held().iter().map(|e| e.name.clone()).collect();
    assert_eq!(names.len(), 2, "{names:?}");
    assert_eq!(
        back.export_state()
            .bank
            .iter()
            .filter(|e| e.id == id)
            .count(),
        2
    );
}
