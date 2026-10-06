use super::*;
use crate::{run_walk, SessionConfig};
use auracle_features::{file::recording_stimuli, render::render_phrase, AudioFeatures};
use auracle_grammar::{preset_bank, PatchGrammarPrior};
use auracle_taste::SyntheticUser;
use rand::rngs::StdRng;
use rand::SeedableRng;

/// The listener the generation tests teach (the crate's `ground_truth`).
fn listener() -> SyntheticUser {
    let names = Features::phi_names();
    let mut theta = vec![0.0; names.len()];
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

/// A pool of 16, 30 duels taught, one fit: the generation tests' engine.
fn taught(seed: u64) -> Engine {
    let mut rng = StdRng::seed_from_u64(seed);
    let cfg = SessionConfig {
        pool_size: 16,
        refine_steps: 12,
        refine_seeds: 5,
        mcmc_samples: 6_000,
        mcmc_warmup: 2_000,
        ..Default::default()
    };
    let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
    engine.begin_session();
    engine.fill_pool(&mut rng);
    let user = listener();
    for _ in 0..30 {
        let (a, b) = engine.next_duel(&mut rng).unwrap();
        let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
        engine.record_duel(a, b, chose_a);
    }
    engine.fit_posterior(&mut rng);
    engine
}

/// A preset recorded on the melody and measured as a file.
fn recording(name: &str) -> FileFeatures {
    let p = preset_bank()
        .into_iter()
        .find(|p| p.name == name)
        .expect("a preset by that name");
    let (_, spec) = recording_stimuli().remove(0);
    let r = render_phrase(&p.tree, &spec).unwrap();
    let pcm: Vec<f32> = r.samples.iter().map(|&s| s as f32).collect();
    auracle_features::featurize_file(&pcm, spec.sample_rate).unwrap()
}

/// A file measured as this, with every audio coordinate set: what the
/// session keeps is still only the ones a file measures.
fn file_of(audio: AudioFeatures) -> FileFeatures {
    FileFeatures {
        audio,
        seconds: 2.0,
        truncated: false,
        lufs_before: -20.0,
        gain_db: 2.0,
    }
}

/// The session keeps the measured coordinates, by name, and nothing
/// masked; a coordinate whose name the current φ lacks is masked on the
/// way back in rather than misread, and the name is cut to its limit.
#[test]
fn a_sound_keeps_only_what_its_file_measures() {
    let f = recording("Glass Pad");
    let own = OwnSound::from_file(&"x".repeat(80), &f);
    assert_eq!(own.name.chars().count(), OWN_NAME_MAX);
    let observed = auracle_features::file_observed();
    assert_eq!(own.features.len(), observed.iter().filter(|o| **o).count());
    for (n, _) in &own.features {
        assert!(
            !auracle_features::FILE_MASKED.contains(&n.as_str()),
            "{n} kept"
        );
    }
    let mut renamed = own.clone();
    renamed.features[0].0 = "centroid_mean:p1".into();
    assert_eq!(renamed.observed().len(), own.observed().len() - 1);
}

/// The tilt is the taste minus `(γ/2)·d²` over the measured coordinates
/// exactly, a coordinate the file does not measure moves nothing, and a
/// proposal that does not vet keeps its quarantine score.
#[test]
fn the_tilt_is_half_gamma_times_the_squared_distance() {
    use fugue_evo::fitness::traits::Fitness;
    let spec = PhraseSpec::default();
    let memo = RenderMemo::default();
    let trees: Vec<_> = preset_bank().into_iter().take(6).map(|p| p.tree).collect();
    let rows: Vec<Vec<f64>> = trees
        .iter()
        .map(|t| {
            featurize_memo(t, &spec, &memo, false)
                .unwrap()
                .0
                .features
                .phi()
        })
        .collect();
    let std = Arc::new(Standardizer::fit(&rows));
    let toward = Toward {
        observed: vec![0, 3],
        target: vec![0.5, -1.0],
        gamma: 2.0,
    };
    let fit = TowardFitness {
        inner: crate::perform::VetOnlyFitness {
            phrase: spec.clone(),
            memo: memo.clone(),
        },
        toward: toward.clone(),
        standardizer: Arc::clone(&std),
        phrase: spec.clone(),
        memo: memo.clone(),
    };
    for (t, phi) in trees.iter().zip(&rows) {
        let z = std.transform(phi);
        let d2 = (z[0] - 0.5).powi(2) + (z[3] + 1.0).powi(2);
        assert!((fit.evaluate(t) - (-d2)).abs() < 1e-9);
        let mut moved = z.clone();
        moved[1] += 3.0;
        moved[20] -= 2.0;
        assert_eq!(toward.sq_distance(&moved), toward.sq_distance(&z));
    }
    // However far a vetted patch is from the target, it scores above a
    // proposal that does not vet: the pull is floored at OWN_FLOOR.
    let far = TowardFitness {
        toward: Toward {
            target: vec![40.0, -40.0],
            ..toward.clone()
        },
        ..fit.clone()
    };
    for t in &trees {
        assert_eq!(far.evaluate(t), -OWN_FLOOR);
        assert!(far.evaluate(t) > QUARANTINE_FITNESS);
    }
    let silent = auracle_grammar::PatchTree {
        amp: trees[0].amp.clone(),
        root: auracle_grammar::term::AudioNode::Silence {
            uid: auracle_grammar::term::Uid::NEW,
        },
    };
    assert_eq!(fit.evaluate(&silent), QUARANTINE_FITNESS);
}

/// **Untilted walks are untouched.** A context without a target
/// serializes without the key (the farm's JSON is what it was) and one
/// written before the key existed parses; and at γ = 0 the tilted walk is
/// the untilted one bit for bit, so wrapping the fitness consumes no
/// randomness and moves no acceptance. Then, from the same jobs, a walk
/// at a real γ ends nearer the target on average than the untilted one.
#[test]
fn breeding_toward_a_sound_tilts_only_its_own_walks() {
    let mut engine = taught(0x0A1D);
    assert!(
        engine
            .refine_toward_jobs(&mut StdRng::seed_from_u64(1))
            .is_none(),
        "no sound, no generation"
    );
    assert_eq!(engine.own_breed_blocked(), Some("no_sound"));
    let mut untaught = Engine::new(PatchGrammarPrior::default(), SessionConfig::default());
    untaught.own_set("Glass Pad", &recording("Glass Pad"));
    assert_eq!(untaught.own_breed_blocked(), Some("untaught"));
    let mut stale = OwnSound::from_file("Old", &recording("Glass Pad"));
    for (name, _) in &mut stale.features {
        *name = name.replace(":p2", ":p1");
    }
    engine.own = Some(stale);
    assert_eq!(engine.own_breed_blocked(), Some("stale_sound"));
    assert!(engine
        .refine_toward_jobs(&mut StdRng::seed_from_u64(1))
        .is_none());
    engine.own_set("Glass Pad", &recording("Glass Pad"));
    assert_eq!(engine.own_breed_blocked(), None);
    let parents = engine.own_seeds();
    let (ctx, jobs) = engine
        .refine_toward_jobs(&mut StdRng::seed_from_u64(1))
        .expect("taught, with a sound");
    assert_eq!(
        jobs.iter().map(|j| j.parent_id).collect::<Vec<_>>(),
        parents,
        "own_seeds names the parents"
    );
    let toward = ctx.toward.clone().expect("tilted");
    let plain = WalkContext {
        toward: None,
        ..ctx.clone()
    };
    let json = serde_json::to_value(&plain).unwrap();
    assert!(json.get("toward").is_none());
    let back: WalkContext = serde_json::from_value(json).unwrap();
    assert!(back.toward.is_none());

    let flat = WalkContext {
        toward: Some(Toward {
            gamma: 0.0,
            ..toward.clone()
        }),
        ..ctx.clone()
    };
    let memo = engine.memo().clone();
    let walk = |c: &WalkContext| -> Vec<Option<auracle_grammar::PatchTree>> {
        std::thread::scope(|s| {
            let hs: Vec<_> = jobs
                .iter()
                .map(|j| {
                    let memo = &memo;
                    s.spawn(move || run_walk(c, j, memo).child)
                })
                .collect();
            hs.into_iter().map(|h| h.join().unwrap()).collect()
        })
    };
    let untilted = walk(&plain);
    assert_eq!(walk(&flat), untilted, "γ = 0 moved a walk");

    let strong = WalkContext {
        toward: Some(Toward {
            gamma: 4.0,
            ..toward.clone()
        }),
        ..ctx.clone()
    };
    let tilted = walk(&strong);
    let std = engine.standardizer().unwrap().clone();
    let dist = |ends: &[Option<auracle_grammar::PatchTree>]| -> f64 {
        ends.iter()
            .zip(&jobs)
            .map(|(e, j)| {
                let t = e.as_ref().unwrap_or(&j.seed);
                let (cf, _) = featurize_memo(t, &engine.cfg.phrase, &memo, false).unwrap();
                toward.distance_raw(&cf.features.phi(), &std)
            })
            .sum::<f64>()
            / jobs.len() as f64
    };
    let (t, u) = (dist(&tilted), dist(&untilted));
    assert!(t < u, "tilted walks ended {t:.3}σ away, untilted {u:.3}σ");
}

/// The nearest sounds are ranked by the distance over the measured
/// coordinates; the map places the sound without moving the map; and
/// the sound, features only, survives a save.
#[test]
fn nearest_map_and_save() {
    let mut engine = taught(0x5A7E);
    assert!(engine.own_nearest(3).is_empty());
    assert!(engine.taste_map().own.is_none());
    let before = serde_json::to_string(&engine.taste_map().points).unwrap();
    // A file that measures exactly what pool member 0 measures.
    let (c0_id, c0_audio) = (engine.pool[0].id, engine.pool[0].features.audio);
    engine.own_set("Mine", &file_of(c0_audio));
    let near = engine.own_nearest(3);
    assert_eq!(near[0].0, c0_id, "a member is nearest itself");
    assert!(near[0].1 < 1e-9);
    assert!(near.windows(2).all(|w| w[0].1 <= w[1].1));
    let t = engine.own_toward(OWN_GAMMA).unwrap();
    for (id, d) in &near {
        let c = &engine.pool[engine.find(*id).unwrap()];
        assert!((t.distance(&c.phi_std) - d).abs() < 1e-12);
    }
    let z = engine.own_z().unwrap();
    assert_eq!(z.len(), Features::phi_names().len());
    assert_eq!(z.iter().filter(|v| v.is_some()).count(), t.observed.len());

    let map = engine.taste_map();
    assert_eq!(
        serde_json::to_string(&map.points).unwrap(),
        before,
        "bringing a sound moved the map"
    );
    let own = map.own.expect("placed");
    assert_eq!(own.observed, t.observed.len());
    assert_eq!(engine.own_on_map(crate::map::OWN_PLACEMENT), Some(own));

    let presets = vec![PresetPhi {
        index: 7,
        name: "Copy".into(),
        audio: c0_audio.to_vec(),
    }];
    assert_eq!(engine.own_nearest_presets(1, &presets)[0].0, 7);

    let saved = serde_json::to_string(&engine.export_state()).unwrap();
    assert!(saved.contains("own_sound"));
    let state: crate::SessionState = serde_json::from_str(&saved).unwrap();
    assert_eq!(state.own_sound.as_ref(), engine.own_sound());
    let mut v: serde_json::Value = serde_json::from_str(&saved).unwrap();
    v.as_object_mut().unwrap().remove("own_sound");
    let old: crate::SessionState = serde_json::from_value(v).unwrap();
    assert!(old.own_sound.is_none(), "a session saved before loads");
    assert!(engine.own_clear());
    assert!(!serde_json::to_string(&engine.export_state())
        .unwrap()
        .contains("own_sound"));
}

/// The direction liking rises on the map is fitted over pool sounds
/// only: the sound of your own is placed on the map but has no liking,
/// so bringing one leaves `belief().direction` exactly as it was.
#[test]
fn the_direction_ignores_the_sound_of_your_own() {
    let mut engine = taught(0xD1E0);
    let _ = engine.taste_map();
    let without = engine.belief().direction.expect("a fitted pool");
    engine.own_set("Mine", &file_of(engine.pool[3].features.audio));
    let map = engine.taste_map();
    assert!(map.own.is_some(), "the sound is placed");
    let pool: Vec<[f64; 3]> = map
        .points
        .iter()
        .filter(|pt| pt.id.is_some())
        .map(|pt| [pt.x, pt.y, 1.0 / (1.0 + (-pt.utility).exp())])
        .collect();
    let with = engine.belief().direction.expect("still fitted");
    assert_eq!(with, without, "bringing a sound moved the direction");
    let fit = crate::map::liking_direction(&pool).unwrap();
    assert!((with.gx - fit.gx).abs() <= 1e-9 * (1.0 + fit.gx.abs()));
    assert!((with.gy - fit.gy).abs() <= 1e-9 * (1.0 + fit.gy.abs()));
}
