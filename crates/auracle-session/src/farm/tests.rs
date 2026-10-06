use super::*;
use crate::testkit::*;
use crate::*;
use auracle_grammar::PatchGrammarPrior;
use rand::rngs::StdRng;
use rand::SeedableRng;

/// Indexing must decorrelate: neighbouring indices are unrelated seeds,
/// and the same `(base, index)` always names the same one.
#[test]
fn draw_seed_is_pure_and_decorrelated() {
    assert_eq!(draw_seed(7, 3), draw_seed(7, 3));
    assert_ne!(draw_seed(7, 3), draw_seed(7, 4));
    assert_ne!(draw_seed(7, 3), draw_seed(8, 3));
    // Adjacent indices must not differ in a handful of bits.
    let a = draw_seed(0xC0FFEE, 0);
    let b = draw_seed(0xC0FFEE, 1);
    assert!(
        (a ^ b).count_ones() > 8,
        "adjacent draw seeds barely differ: {a:x} vs {b:x}"
    );
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
    farm_fill_handing(width, fill_seed, pool_size, None).0
}

/// [`farm_fill`] with the app's progressive boot in it: after the first
/// batch of absorbs that leaves `hand_at` or more sounds in the pool, the
/// bank is handed over (`standardize_now`, as the worker's `playable`
/// does) and the names the app would show then are returned beside the
/// engine. How many sounds that catches depends on how the batch fell, as
/// it does on a farm.
fn farm_fill_handing(
    width: usize,
    fill_seed: u64,
    pool_size: usize,
    hand_at: Option<usize>,
) -> (Engine, Option<std::collections::HashMap<u64, String>>) {
    let mut shown = None;
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
        if let Some(at) = hand_at {
            if shown.is_none() && engine.pool.len() >= at {
                engine.standardize_now();
                shown = Some(engine.display_names());
            }
        }
        if engine.pool.len() >= pool_size {
            break;
        }
        if issued == 0 && absorbed == 0 {
            break; // drained: no work left to issue and none outstanding
        }
    }
    (engine, shown)
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

/// **A seed names the pool it deals, whenever the bank is handed over**
/// (#154). The app takes the bank at the first batch of farm results that
/// reaches its `playableAt`, so how many sounds it catches depends on how
/// the results fell: 8 on one run, more on the next. Names were read off the
/// bank caught then, so one `?seed=` named its pool differently from run
/// to run (sound 4 was *Soft Lead* on one, *Bright Lead* on another).
///
/// The same seed filled four ways — the serial fill, which shows its
/// names first when the pool is full; a farm whose batch carries the
/// handover past [`NAME_FLOOR`]; a handover below it; and the no-farm
/// fallback two at a time — must end with the same names, and every name
/// shown at a handover of `NAME_FLOOR` or more must be the one kept. It
/// first checks that reading the smallest and the largest bank caught
/// whole, the rule before, would have named them apart, so it cannot pass
/// on a seed whose names do not move. A pool of 12 keeps it in the fast
/// tier: four fills, about 10 s.
#[test]
fn a_seed_names_its_pool_however_the_bank_was_handed_over() {
    use std::collections::{HashMap, HashSet};
    const SEED: u64 = 0x5EED_0154;
    const POOL: usize = 12;
    let cfg = || SessionConfig {
        pool_size: POOL,
        ..fast()
    };
    let mut serial = Engine::new(PatchGrammarPrior::default(), cfg());
    serial.begin_session();
    serial.set_fill_seed(SEED);
    serial.fill_pool(&mut StdRng::seed_from_u64(0xDEAD));
    assert_eq!(serial.pool.len(), POOL, "the fill fell short");
    assert!(
        serial.pool.iter().all(|c| c.auto_name.is_some()),
        "the full pool was not named"
    );
    let names = serial.display_names();

    // Every way to the same pool, with the names shown at the handover.
    let mut runs: Vec<(String, Engine, HashMap<u64, String>)> = Vec::new();
    for (width, at) in [(3, NAME_FLOOR), (2, 3)] {
        let (farm, shown) = farm_fill_handing(width, SEED, POOL, Some(at));
        let shown = shown.expect("the bank was handed over");
        let how = format!("width {width}, handed over at {} sounds", shown.len());
        runs.push((how, farm, shown));
    }
    // `?farm=0`: two at a time, handed over at the first step that
    // reaches the threshold, then two names to give at every step.
    let mut chunked = Engine::new(PatchGrammarPrior::default(), cfg());
    chunked.begin_session();
    chunked.set_fill_seed(SEED);
    let mut rng = StdRng::seed_from_u64(0xDEAD);
    let mut shown = None;
    while chunked.pool.len() < POOL && chunked.fill_pool_step(&mut rng, 2) > 0 {
        if shown.is_none() && chunked.pool.len() >= NAME_FLOOR {
            chunked.standardize_now();
            shown = Some(chunked.display_names());
        }
    }
    let shown = shown.expect("the bank was handed over");
    let how = format!("two at a time, handed over at {} sounds", shown.len());
    runs.push((how, chunked, shown));

    // The rule before: the bank the handover caught, read whole, in id
    // order. Two catches it would have named apart, or this proves nothing.
    let read_whole = |caught: usize| -> Vec<String> {
        let mut bank: Vec<&Candidate> = serial.pool.iter().collect();
        bank.sort_by_key(|c| c.id);
        bank.truncate(caught);
        let scale = NameScale::fit(bank.iter().map(|c| &c.features));
        let mut taken = HashSet::new();
        bank.iter()
            .map(|c| claim_name(&scale.name(&c.features), &mut taken))
            .collect()
    };
    // The serial fill first shows its names with the pool full.
    let caught: Vec<usize> = std::iter::once(POOL)
        .chain(runs.iter().map(|(_, _, s)| s.len()))
        .collect();
    println!("handovers caught {caught:?} sounds");
    let lo = caught.iter().copied().filter(|&n| n >= NAME_FLOOR).min();
    let hi = caught.iter().copied().max();
    let (lo, hi) = (lo.unwrap(), hi.unwrap());
    assert!(hi > lo, "every handover caught {lo} sounds: nothing varied");
    assert_ne!(
        read_whole(lo)[..lo],
        read_whole(hi)[..lo],
        "reading the bank at {lo} and at {hi} sounds names the first {lo} alike; \
             the test needs a seed that does not"
    );

    for (how, engine, shown) in &runs {
        assert_eq!(
            pool_signature(engine),
            pool_signature(&serial),
            "{how}: another pool"
        );
        assert_eq!(engine.display_names(), names, "{how}: named differently");
        if shown.len() >= NAME_FLOOR {
            for (id, name) in shown {
                assert_eq!(&names[id], name, "{how}: renamed after it was shown");
            }
        }
    }
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
