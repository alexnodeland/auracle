use super::*;
use crate::testkit::*;
use crate::*;
use auracle_features::{Features, StructFeatures};
use auracle_grammar::PatchGrammarPrior;
use auracle_taste::{Feedback, Observation};
use rand::rngs::StdRng;
use rand::SeedableRng;

fn names() -> Vec<String> {
    Features::phi_names()
        .into_iter()
        .map(|s| s.to_string())
        .collect()
}

fn row(names: &[String], set: &[(&str, f64)]) -> Vec<f64> {
    let mut v = vec![0.5; names.len()];
    for (n, x) in set {
        let i = names.iter().position(|m| m == n).expect("known coordinate");
        v[i] = *x;
    }
    v
}

/// Six cells of exactly `1e30`, which is what the shipped profile held.
/// Repair pulls them back inside the coordinate's range and leaves the
/// vote standing — the player's preference is still their preference; only
/// one number in it was never a measurement.
#[test]
fn repair_clamps_the_sentinel_and_keeps_the_vote() {
    let n = names();
    let mut log = ObservationLog::default();
    for _ in 0..3 {
        log.observations.push(Observation::new(
            Feedback::Duel {
                a: row(&n, &[("amp_sustain", 1e30), ("n_vco", 4.0)]),
                b: row(&n, &[("amp_sustain", 1e30)]),
                chose_a: true,
            },
            0,
            &n,
        ));
    }
    let (clamped, dropped) = repair_log(&mut log);
    assert_eq!((clamped, dropped), (6, 0));
    assert_eq!(log.observations.len(), 3);

    let i = n.iter().position(|m| m == "amp_sustain").unwrap();
    let j = n.iter().position(|m| m == "n_vco").unwrap();
    for o in &log.observations {
        for phi in o.feedback.phis() {
            assert_eq!(phi[i], 1.0, "the unit coordinate was not repaired");
        }
        // An unbounded coordinate is left exactly alone: four oscillators
        // is a patch, not corruption, and a repair that clamped counts
        // would be inventing evidence.
        assert_eq!(o.feedback.phis()[0][j], 4.0);
    }
    // Idempotent — a second load must not find anything to do.
    assert_eq!(repair_log(&mut log), (0, 0));
}

/// A NaN cannot be clamped to anything that is not an invention, so the
/// whole observation goes. One vote is a smaller loss than a posterior of
/// NaNs.
#[test]
fn a_non_finite_vote_is_dropped() {
    let n = names();
    let mut log = ObservationLog::default();
    log.observations.push(Observation::new(
        Feedback::KeepKill {
            x: row(&n, &[("mod_depth_mean", f64::NAN)]),
            kept: true,
        },
        0,
        &n,
    ));
    log.observations.push(Observation::new(
        Feedback::KeepKill {
            x: row(&n, &[]),
            kept: false,
        },
        0,
        &n,
    ));
    assert_eq!(repair_log(&mut log), (0, 1));
    assert_eq!(log.observations.len(), 1);
}

/// The implicit stream's φ pairs are repaired positionally, and only when
/// the width matches the live feature set — a row from a different φ is a
/// row this cannot interpret, and guessing at it is how a "repair" invents
/// evidence.
#[test]
fn implicit_event_phi_is_repaired_only_at_the_right_width() {
    let n = names();
    let mut before = row(&n, &[("amp_sustain", 1e30)]);
    let mut after = row(&n, &[("amp_sustain", 0.4), ("n_vco", 3.0)]);
    assert_eq!(repair_phi_pair(&mut before, &mut after, &n), 1);
    let i = n.iter().position(|m| m == "amp_sustain").unwrap();
    assert_eq!(before[i], 1.0);
    assert_eq!(after[i], 0.4);

    // A stale-width row is left exactly as it was found.
    let mut stale = vec![1e30; 3];
    let mut empty: Vec<f64> = Vec::new();
    assert_eq!(repair_phi_pair(&mut stale, &mut empty, &n), 0);
    assert_eq!(stale, vec![1e30; 3]);
}

/// Sessions that never earned a τ of their own fold into the one before,
/// cascading, with session 0 as the floor; long sessions are untouched.
#[test]
fn short_sessions_merge_into_their_predecessor() {
    let n = names();
    let mut log = ObservationLog::new();
    let mut push = |session: usize, count: usize| {
        for _ in 0..count {
            log.push(Observation::new(
                Feedback::KeepKill {
                    x: vec![0.5; n.len()],
                    kept: true,
                },
                session,
                &n,
            ));
        }
    };
    // 0: six votes; 1: two (short); 2: one (short); 3: seven; 4: one (short).
    push(0, 6);
    push(1, 2);
    push(2, 1);
    push(3, 7);
    push(4, 1);
    assert_eq!(log.n_sessions(), 5);
    let moved = merge_short_sessions(&mut log, 5);
    // 1 and 2 cascade into 0; 4 into 3; 3 is renumbered to 1.
    assert_eq!(log.n_sessions(), 2);
    let count = |s: usize| log.observations.iter().filter(|o| o.session == s).count();
    assert_eq!((count(0), count(1)), (9, 8));
    assert_eq!(moved, 2 + 1 + 7 + 1);
    // Idempotent.
    assert_eq!(merge_short_sessions(&mut log, 5), 0);
    // A leading short session is the floor and stays where it is.
    let mut small = ObservationLog::new();
    for s in [0, 0, 1, 1, 1, 1, 1, 1] {
        small.push(Observation::new(
            Feedback::KeepKill {
                x: vec![0.5; n.len()],
                kept: true,
            },
            s,
            &n,
        ));
    }
    assert_eq!(merge_short_sessions(&mut small, 5), 0);
    assert_eq!(small.n_sessions(), 2);
}

/// A shaped modulation chain reads `mod_depth_mean = 2`, and the repair
/// leaves it exactly there. It used to clamp it to 1 — "unshaped" — on
/// every load, rewriting the evidence for precisely the patches the
/// coordinate exists to describe.
#[test]
fn a_shaped_chains_depth_survives_the_repair() {
    let n = names();
    let i = n
        .iter()
        .position(|m| m == "mod_depth_mean")
        .expect("mod_depth_mean is a φ coordinate");
    let mut x = vec![0.5; n.len()];
    x[i] = 2.0;
    let mut log = ObservationLog::new();
    log.push(Observation::new(
        Feedback::KeepKill {
            x: x.clone(),
            kept: true,
        },
        0,
        &n,
    ));
    assert_eq!(repair_log(&mut log), (0, 0), "a legal depth was 'repaired'");
    let after = log.observations[0].feedback.phis()[0];
    assert_eq!(after[i], 2.0);
}

/// Every name the repair enforces a bound on has to still be a φ
/// coordinate. Rename one and this fails here rather than by quietly
/// enforcing nothing.
#[test]
fn every_unit_name_is_a_live_coordinate() {
    let n = names();
    for name in StructFeatures::UNIT_NAMES {
        assert!(
            n.iter().any(|m| m == name),
            "{name} is no longer in φ — the domain repair is a no-op for it"
        );
    }
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

/// **A migration converts only what it can read.** A standardizer of another
/// width than schema 1's inverts nothing, so the log is left alone; a vote
/// already raw is left as it is; and a legacy vote whose vectors are not
/// schema 1's width stays marked as one that cannot be read, rather than
/// claiming today's names.
#[test]
fn a_migration_converts_only_what_it_can_read() {
    let d = SCHEMA1_NAMES.len();
    let legacy = |width: usize| {
        let mut o = Observation::new(
            Feedback::KeepKill {
                x: vec![0.3; width],
                kept: true,
            },
            0,
            &[],
        );
        o.schema_version = 0;
        o
    };
    let n = names();
    let mut log = ObservationLog::default();
    log.observations.push(legacy(d));
    log.observations.push(legacy(d + 1));
    log.observations.push(Observation::new(
        Feedback::KeepKill {
            x: row(&n, &[]),
            kept: false,
        },
        0,
        &n,
    ));
    let sz = |width: usize| auracle_taste::Standardizer {
        mean: vec![0.1; width],
        std: vec![0.5; width],
    };
    let untouched = serde_json::to_string(&log).unwrap();
    assert_eq!(migrate_log(&mut log, &sz(d + 2), &n, 22_050.0), 0);
    assert_eq!(serde_json::to_string(&log).unwrap(), untouched);

    assert_eq!(migrate_log(&mut log, &sz(d), &n, 22_050.0), 1);
    let [read, unread, raw] = &log.observations[..] else {
        panic!("a vote was lost");
    };
    assert!(read.is_raw() && read.feature_names == n);
    assert!(!unread.is_raw() && unread.feature_names.is_empty());
    assert!(raw.is_raw());
    assert!(
        needs_migration(&log),
        "the unreadable vote stopped saying so"
    );
}

/// Raw votes logged without names (the synthetic and headless paths) take
/// today's names; named ones keep theirs. A coordinate renamed since a vote
/// was written is read under its new name, once.
#[test]
fn unnamed_votes_take_todays_names_and_renamed_ones_their_new_name() {
    let n = names();
    let mut log = ObservationLog::default();
    let keep = |names: &[String]| {
        Observation::new(
            Feedback::KeepKill {
                x: vec![0.0; names.len().max(1)],
                kept: true,
            },
            0,
            names,
        )
    };
    let old: Vec<String> = vec!["n_delay".into(), "n_vco".into()];
    log.observations.push(keep(&[]));
    log.observations.push(keep(&old));
    stamp_names(&mut log, &n);
    assert_eq!(log.observations[0].feature_names, n);
    assert_eq!(log.observations[1].feature_names, old);
    assert_eq!(apply_renames(&mut log), 1);
    assert_eq!(log.observations[1].feature_names, ["n_time", "n_vco"]);
    assert_eq!(apply_renames(&mut log), 0, "a rename applied twice");
}

/// A log row with no names is not repaired: which coordinate a position
/// holds is a guess there, and a wrong guess would clamp a count.
#[test]
fn an_unnamed_row_is_not_repaired_by_position() {
    let n = names();
    let mut log = ObservationLog::default();
    log.observations.push(Observation::new(
        Feedback::KeepKill {
            x: row(&n, &[("amp_sustain", 1e30)]),
            kept: true,
        },
        0,
        &[],
    ));
    assert_eq!(repair_log(&mut log), (0, 0));
    let i = n.iter().position(|m| m == "amp_sustain").unwrap();
    assert_eq!(log.observations[0].feedback.phis()[0][i], 1e30);
}
