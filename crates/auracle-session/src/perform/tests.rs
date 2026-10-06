use super::*;
use auracle_features::featurize;
use auracle_grammar::preset_bank;

fn preset_standardizer(spec: &PhraseSpec) -> Standardizer {
    let rows: Vec<Vec<f64>> = preset_bank()
        .iter()
        .filter_map(|p| featurize(&p.tree, spec).ok())
        .map(|v| v.features.phi())
        .collect();
    Standardizer::fit(&rows)
}

/// Every palette direction is unit length over φ's real names, and every
/// coordinate it names exists: a control whose one coordinate was renamed
/// away has no direction at all, and one that lost one of several would
/// quietly narrow to the rest, so each weight is checked by name. The
/// six are the palette's first six, and names are unique (a wiring is
/// told apart by its name).
#[test]
fn directions_are_unit_and_named_coordinates_exist() {
    let names: Vec<String> = AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect();
    let bare: Vec<&str> = names
        .iter()
        .map(|n| n.split(':').next().unwrap_or(n))
        .collect();
    for c in &PALETTE {
        let d = direction(c, &names);
        let n: f64 = d.iter().map(|x| x * x).sum::<f64>().sqrt();
        assert!(
            (n - 1.0).abs() < 1e-9,
            "{} names a coordinate φ lacks",
            c.name
        );
        for (a, _) in c.axis {
            assert!(bare.contains(a), "{}: φ has no {a}", c.name);
        }
    }
    for (k, c) in CONTROLS.iter().enumerate() {
        assert_eq!(PALETTE[k].name, c.name, "the six lead the palette");
    }
    let mut seen = HashSet::new();
    assert!(PALETTE.iter().all(|c| seen.insert(c.name)), "a name twice");
    let families = [
        "Tone",
        "Weight",
        "Dynamics",
        "Movement",
        "Space",
        "Character",
    ];
    for f in families {
        let n = PALETTE.iter().filter(|c| c.family == f).count();
        assert_eq!(n, 3, "{f} has {n} controls");
    }
    assert_eq!(
        palette_controls(&[6, 99, 0, 6])
            .iter()
            .map(|c| c.name)
            .collect::<Vec<_>>(),
        [PALETTE[6].name, PALETTE[0].name],
        "out of range and repeats are dropped, order kept"
    );
}

/// Purity generalizes without moving the six. For each of the six it is
/// bit-for-bit the formula it always was (the cosine with its axis
/// against the other five axes); for every palette control a move along
/// its own direction is pure, and a move along a named axis orthogonal to
/// it is not this control at all.
#[test]
fn purity_keeps_the_six_and_extends_to_the_palette() {
    let names: Vec<String> = AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect();
    let mut rng = <rand::rngs::StdRng as rand::SeedableRng>::seed_from_u64(5);
    let purity = |d: &[f64], m: &[f64]| {
        let along = dot(m, d);
        let off: f64 = purity_basis(d, &names)
            .iter()
            .skip(1)
            .map(|b| dot(b, m).powi(2))
            .sum();
        along / (along * along + off).sqrt().max(1e-12)
    };
    for _ in 0..200 {
        let m: Vec<f64> = (0..names.len()).map(|_| rng.gen_range(-1.0..1.0)).collect();
        for c in &CONTROLS {
            let d = direction(c, &names);
            let along: f64 = m.iter().zip(&d).map(|(a, b)| a * b).sum();
            let off: f64 = CONTROLS
                .iter()
                .filter(|o| o.name != c.name)
                .map(|o| {
                    direction(o, &names)
                        .iter()
                        .zip(&m)
                        .map(|(x, y)| x * y)
                        .sum::<f64>()
                        .powi(2)
                })
                .sum();
            let was = along / (along * along + off).sqrt().max(1e-12);
            assert_eq!(purity(&d, &m).to_bits(), was.to_bits(), "{}", c.name);
        }
    }
    // Where a palette control leans on one of the six (Thump on Snap,
    // through `crest`), the rest of that axis, the part orthogonal to the
    // control's own direction, is another control's gesture and must
    // count against it in full: a move of the control's direction plus
    // that remainder, in equal parts, is 1/√2 pure. This is the
    // Gram–Schmidt branch of `purity_basis`; dropping a leaning axis
    // instead reads the same move as pure (1).
    let mut leaning = 0;
    for c in &PALETTE {
        let d = direction(c, &names);
        assert!((purity(&d, &d) - 1.0).abs() < 1e-12, "{}", c.name);
        for o in &CONTROLS {
            let a = direction(o, &names);
            let share = dot(&a, &d);
            let mut rest: Vec<f64> = a.iter().zip(&d).map(|(x, y)| x - share * y).collect();
            let n = rest.iter().map(|x| x * x).sum::<f64>().sqrt();
            if share.abs() < 1e-12 || n < 1e-9 {
                continue; // orthogonal to it, or the control is this axis
            }
            rest.iter_mut().for_each(|x| *x /= n);
            let m: Vec<f64> = d.iter().zip(&rest).map(|(x, y)| x + y).collect();
            let p = purity(&d, &m);
            assert!(
                (p - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-9,
                "{} leaning on {}: purity {p}",
                c.name,
                o.name
            );
            leaning += 1;
        }
    }
    assert!(leaning >= 10, "only {leaning} leaning pairs were checked");
}

/// A control the knobs cannot reach may be given something to turn, and
/// the EQ that does it for Bright and Body is inaudible until turned: on
/// every preset that has no EQ, the grafted patch vets and its audio φ
/// stays within a hair of the original (standardized, so "a hair" is in
/// the units the controls move in). A second EQ is never grafted, and
/// Space's release graft is a floor, not a reset.
#[test]
fn grafts_are_transparent_and_do_not_stack() {
    let spec = PhraseSpec::default();
    let std = preset_standardizer(&spec);
    let n_audio = AudioFeatures::NAMES.len();
    let z = |t: &PatchTree| {
        let v = featurize(t, &spec).expect("grafted patch vets");
        std.transform(&v.features.phi())[..n_audio].to_vec()
    };
    let bright = CONTROLS.iter().position(|c| c.name == "Bright").unwrap();
    let space = CONTROLS.iter().position(|c| c.name == "Space").unwrap();
    let mut grafted = 0;
    let mut worst: f64 = 0.0;
    for p in preset_bank().into_iter().step_by(4) {
        let Some(t) = graft_for(&p.tree, bright) else {
            continue;
        };
        grafted += 1;
        let d = z(&p.tree)
            .iter()
            .zip(z(&t))
            .map(|(a, b)| (a - b).powi(2))
            .sum::<f64>()
            .sqrt();
        worst = worst.max(d);
        assert!(graft_for(&t, bright).is_none(), "{}: a second EQ", p.name);
    }
    assert!(grafted >= 8, "only {grafted} presets took the EQ graft");
    assert!(worst < 0.05, "an EQ graft moved the sound by {worst:.3}σ");

    let mut short = preset_bank()[0].tree.clone();
    short.amp.release = 0.2;
    let long = graft_for(&short, space).expect("a short release grows");
    assert_eq!(long.amp.release, SPACE_RELEASE);
    assert_eq!(long.root, short.root, "Space changes the release only");
    assert!(graft_for(&long, space).is_none(), "already long enough");
    assert!(insert_for(space).is_none() && graft_for(&short, 4).is_none());
}

/// An EQ nobody hears is not an EQ to turn: one inside what a CAPTURE
/// records, or inside what a TRACK follows, does not stop Bright grafting
/// one onto the output. One that is heard still does.
#[test]
fn an_unheard_eq_does_not_stop_the_graft() {
    use auracle_grammar::term::{CaptureMode, InputChannel, PitchBand};
    use auracle_grammar::{Take, INPUT_GAIN_UNITY, TRACK_SENSITIVITY_DEFAULT};
    let bright = CONTROLS.iter().position(|c| c.name == "Bright").unwrap();
    let eq_over_input = || AudioNode::Eq {
        uid: Uid::NEW,
        low: 0.5,
        mid: 0.5,
        high: 0.5,
        mod_depth: 0.0,
        modulation: ModNode::None,
        input: Box::new(AudioNode::AudioIn {
            uid: Uid::NEW,
            input: 0,
            gain: INPUT_GAIN_UNITY,
            channel: InputChannel::Both,
        }),
    };
    let base = preset_bank()[0].tree.clone();
    let take = Take::from_samples(&[0.1, 0.2, 0.3], 44_100.0).unwrap();
    let unheard = [
        AudioNode::Capture {
            uid: Uid::NEW,
            play: CaptureMode::Once,
            input: Box::new(eq_over_input()),
            take,
        },
        AudioNode::Track {
            uid: Uid::NEW,
            band: PitchBand::Mid,
            sensitivity: TRACK_SENSITIVITY_DEFAULT,
            dynamics: 0.5,
            input: Box::new(base.root.clone()),
            listen: Box::new(eq_over_input()),
        },
    ];
    for root in unheard {
        let tree = PatchTree {
            amp: base.amp.clone(),
            root,
        };
        let grafted = graft_for(&tree, bright).expect("an unheard EQ blocked the graft");
        assert!(
            matches!(grafted.root, AudioNode::Eq { .. }),
            "{}",
            grafted.to_sexpr()
        );
    }
    let heard = PatchTree {
        amp: base.amp.clone(),
        root: eq_over_input(),
    };
    assert!(
        graft_for(&heard, bright).is_none(),
        "a heard EQ is grafted twice"
    );
}

/// PERFORM only turns knobs the voices can take live. Every live knob has
/// a compiled handle, and on the shipped presets there are continuous
/// sites without one (a modulation depth with nothing to modulate): those
/// are exactly what the old list wrote, missed, and answered with a patch
/// reload mid-phrase. A drift may move nothing else.
#[test]
fn performance_touches_live_knobs_only() {
    let sr = PhraseSpec::default().sample_rate;
    let mut excluded = 0;
    for p in preset_bank() {
        let voice = auracle_grammar::compile(&p.tree, sr).expect("presets compile");
        let live = live_knobs(&p.tree, sr);
        for (a, _) in &live {
            assert!(
                voice.params.contains_key(a),
                "{}: {a} has no handle",
                p.name
            );
        }
        excluded += continuous_knobs(&p.tree).len() - live.len();
    }
    assert!(
        excluded > 0,
        "the presets have handle-less sites; this test must see one"
    );
}

/// A drift is local and knob-only: it changes no structural or
/// categorical choice and no knob without a live handle, and the farthest
/// knob it moves grows with `sigma` — the Wander dial's reach. (The old
/// walk, fugue's adaptive kernel from a fresh chain, moved some knob by
/// 0.3–0.85 of its range in eight steps.)
#[test]
fn drift_is_local_and_follows_sigma() {
    use crate::engine::{Engine, SessionConfig};
    let engine = Engine::new(
        auracle_grammar::PatchGrammarPrior::default(),
        SessionConfig::default(),
    );
    let sr = engine.cfg.phrase.sample_rate;
    let mut rng = <rand::rngs::StdRng as rand::SeedableRng>::seed_from_u64(11);
    let (mut small, mut large) = (0.0f64, 0.0f64);
    for p in preset_bank().iter().take(6) {
        let before: std::collections::HashMap<String, f64> =
            continuous_knobs(&p.tree).into_iter().collect();
        let live: HashSet<String> = live_knobs(&p.tree, sr)
            .into_iter()
            .map(|(a, _)| a)
            .collect();
        for (sigma, acc) in [(0.03, &mut small), (0.2, &mut large)] {
            let t = engine
                .drift(&mut rng, &p.tree, &[], 12, sigma)
                .expect("a vetted preset drifts");
            assert_eq!(
                structural_addrs(&t),
                structural_addrs(&p.tree),
                "{}: structure moved",
                p.name
            );
            let mut far = 0.0f64;
            for (a, v) in continuous_knobs(&t) {
                let d = (v - before[&a]).abs();
                if !live.contains(&a) {
                    assert!(d < 1e-12, "{}: non-live {a} moved", p.name);
                }
                far = far.max(d);
            }
            *acc += far;
        }
    }
    assert!(
        small < 0.5 * large,
        "sigma should set the reach: {small:.2} vs {large:.2}"
    );
    assert!(
        small / 6.0 < 0.15,
        "a gentle drift should stay local: mean max {:.2}",
        small / 6.0
    );
}

/// The tilt is exactly `f + γ·s·ê·z` and renders nothing of its own: the
/// inner fitness's render is the one the tilt reads, and a proposal that
/// does not vet keeps its quarantine score, untilted.
#[test]
fn a_tilt_adds_its_aim_and_costs_no_render() {
    let spec = PhraseSpec::default();
    let std = Arc::new(preset_standardizer(&spec));
    let names: Vec<String> = AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect();
    let memo = RenderMemo::default();
    let inner = VetOnlyFitness {
        phrase: spec.clone(),
        memo: memo.clone(),
    };
    use fugue_evo::fitness::traits::Fitness;
    let bank = preset_bank();
    let p = bank.iter().find(|p| p.name == "Glass Pad").expect("preset");
    for sign in [1.0, -1.0] {
        let tilt = TiltedFitness {
            inner: inner.clone(),
            standardizer: Arc::clone(&std),
            direction: direction(&CONTROLS[4], &names),
            sign,
            gamma: 1.5,
            phrase: spec.clone(),
            memo: memo.clone(),
        };
        let before = memo.stats().misses;
        let f = tilt.evaluate(&p.tree);
        assert!(
            memo.stats().misses <= before + 1,
            "the tilt rendered a second time"
        );
        let z = audio_z(&p.tree, &spec, &memo, &std).expect("vets");
        let want = 1.5 * sign * dot(&tilt.direction, &z);
        assert!((f - want).abs() < 1e-12, "{f} vs {want}");
    }
}

/// Does the patch have anything that makes it rough — a drive, a folder, a
/// crusher or a noise source? Grit's axis is spectral flatness.
fn has_grit(n: &AudioNode) -> bool {
    matches!(
        n,
        AudioNode::Distortion { .. }
            | AudioNode::Bitcrush { .. }
            | AudioNode::Fold { .. }
            | AudioNode::Noise { .. }
    ) || n.children().into_iter().any(has_grit)
}

/// ADR-008: a search control's offer moves the way the control was
/// turned. On presets with nothing rough in them (no drive, folder,
/// crusher or noise: where Grit is a search control), `offer_toward(Grit,
/// +1)` ends at least [`REACH_FLOOR`] grittier in most trials, and further
/// than the undirected `offer` from the same seeds, which mostly does not
/// move that way at all. Before the first fit (the tilt around the vetted
/// prior), which is when a new player meets it.
#[test]
fn an_aimed_offer_moves_the_way_it_was_turned() {
    use crate::engine::{Engine, SessionConfig};
    let mut engine = Engine::new(
        auracle_grammar::PatchGrammarPrior::default(),
        SessionConfig::default(),
    );
    engine.standardizer = Some(Arc::new(preset_standardizer(&engine.cfg.phrase)));
    let grit = CONTROLS.iter().position(|c| c.name == "Grit").unwrap();
    let bank = preset_bank();
    let (mut aimed, mut plain) = (Vec::new(), Vec::new());
    for name in ["Glass Pad", "Detune Dream", "Choirboy"] {
        let p = bank.iter().find(|p| p.name == name).expect("preset exists");
        assert!(!has_grit(&p.tree.root), "{name} has something rough in it");
        for seed in 0..3u64 {
            let mut r = <rand::rngs::StdRng as rand::SeedableRng>::seed_from_u64(seed);
            let a = engine
                .offer_toward(&mut r, &p.tree, &[], 20, grit, 1.0)
                .ok()
                .and_then(|t| engine.moved_along(&p.tree, &t, grit))
                .unwrap_or(0.0);
            let mut r = <rand::rngs::StdRng as rand::SeedableRng>::seed_from_u64(seed);
            let u = engine
                .offer(&mut r, &p.tree, &[], 20)
                .ok()
                .and_then(|t| engine.moved_along(&p.tree, &t, grit))
                .unwrap_or(0.0);
            eprintln!("{name} seed {seed}: aimed {a:+.2}σ, undirected {u:+.2}σ");
            aimed.push(a);
            plain.push(u);
        }
    }
    let hits = |v: &[f64]| v.iter().filter(|&&m| m >= REACH_FLOOR).count();
    let median = |v: &[f64]| {
        let mut v = v.to_vec();
        v.sort_by(f64::total_cmp);
        v[v.len() / 2]
    };
    assert!(
        hits(&aimed) * 2 > aimed.len(),
        "aimed offers moved grittier in only {} of {}",
        hits(&aimed),
        aimed.len()
    );
    assert!(
        hits(&plain) < hits(&aimed) && median(&plain) < median(&aimed),
        "the undirected offer moved as often or as far: {} hits, median {:.2}σ, against {} and {:.2}σ",
        hits(&plain),
        median(&plain),
        hits(&aimed),
        median(&aimed)
    );
}

#[test]
fn solve_recovers_a_known_system() {
    let m = vec![vec![4.0, 1.0], vec![1.0, 3.0]];
    let x = solve(m, vec![1.0, 2.0]);
    assert!((x[0] - 1.0 / 11.0).abs() < 1e-12 && (x[1] - 7.0 / 11.0).abs() < 1e-12);
}

/// The gate: where a control claims it can reach, turning it moves the
/// **measured** sound along its axis, in order, on real renders.
///
/// Verification ([`verify`]) opens a half only if the renders at ±½ and ±1
/// both moved the right way; this checks the claim somewhere verification
/// did not look — ±¾ — with a stated tolerance of [`MONO_TOL`]σ. No finite
/// set of samples proves a nonlinear response monotone; this is the
/// measurable version of the promise. A wiring whose predicted move does not survive the
/// nonlinearity of a real render is exactly the dishonest control this
/// module exists to refuse. It holds for the whole [`PALETTE`]: the six as
/// the panel wires them, and each of the twelve wired alone.
#[test]
fn named_controls_move_the_sound_they_name() {
    let spec = PhraseSpec::default();
    let std = preset_standardizer(&spec);
    let memo = RenderMemo::default();
    let bank = preset_bank();
    // The six as the panel wires them, then each of the palette's twelve
    // alone, so every control is held to its claim wherever it makes one.
    let mut sets: Vec<Vec<NamedControl>> = vec![CONTROLS.to_vec()];
    sets.extend(PALETTE[CONTROLS.len()..].iter().map(|c| vec![*c]));
    // One preset per thread: every render is a pure function of its tree,
    // and the memo is shared, so this changes the time and nothing else.
    let check = |name: &str| -> (usize, usize, HashSet<String>) {
        let (mut checked, mut palette_checked) = (0, 0);
        let mut palette_names = HashSet::new();
        let p = bank.iter().find(|p| p.name == name).expect("preset exists");
        let jac = jacobian(&p.tree, &spec, &memo, &std).expect("preset vets");
        for set in &sets {
            let mut wiring = wire_set(&jac, set, SEMANTIC_RIDGE);
            verify(&p.tree, &jac, &mut wiring, &spec, &memo, &std);
            for (i, w) in wiring.iter().enumerate() {
                let (lo, hi) = w.range();
                if w.search {
                    continue;
                }
                assert_eq!(w.axis, direction(&set[i], &jac.names), "{}", w.name);
                let d = w.axis.clone();
                let mine = set.len() == 1;
                if mine && (lo < 0.0 || hi > 0.0) {
                    palette_names.insert(w.name.clone());
                }
                let at = |c: f64| {
                    let mut cs = vec![0.0; wiring.len()];
                    cs[i] = c;
                    let mut t = p.tree.clone();
                    for (a, v) in apply(&jac, &wiring, &cs) {
                        t = set_param(&t, &a, ParamValue::Continuous(v)).unwrap();
                    }
                    let z = audio_z(&t, &spec, &memo, &std).expect("still vets");
                    z.iter().zip(&d).map(|(a, b)| a * b).sum::<f64>()
                };
                let mid = at(0.0);
                let count = if mine {
                    &mut palette_checked
                } else {
                    &mut checked
                };
                if hi > 0.0 {
                    let h = at(0.75);
                    assert!(
                        h > mid - MONO_TOL,
                        "{name}/{} up half: {mid:.3} -> {h:.3}",
                        w.name
                    );
                    *count += 1;
                }
                if lo < 0.0 {
                    let l = at(-0.75);
                    assert!(
                        l < mid + MONO_TOL,
                        "{name}/{} down half: {mid:.3} -> {l:.3}",
                        w.name
                    );
                    *count += 1;
                }
            }
        }
        (checked, palette_checked, palette_names)
    };
    let names = ["First Bass", "Ceiling", "Detune Dream", "Long Way Down"];
    let results: Vec<(usize, usize, HashSet<String>)> = std::thread::scope(|s| {
        let jobs: Vec<_> = names
            .iter()
            .map(|name| {
                let check = &check;
                s.spawn(move || check(name))
            })
            .collect();
        jobs.into_iter()
            .map(|j| j.join().unwrap_or_else(|e| std::panic::resume_unwind(e)))
            .collect()
    });
    let checked: usize = results.iter().map(|r| r.0).sum();
    let palette_checked: usize = results.iter().map(|r| r.1).sum();
    let palette_names: HashSet<String> =
        results.into_iter().flat_map(|r| r.2.into_iter()).collect();
    assert!(checked >= 8, "too few open halves to be a gate: {checked}");
    eprintln!(
        "the twelve: {palette_checked} open halves checked, over {} controls",
        palette_names.len()
    );
    assert!(
        palette_checked >= 16 && palette_names.len() >= 8,
        "too few of the palette's halves to be a gate: {palette_checked} over {palette_names:?}"
    );
}

/// A measurement paid for in rounds — planned, its renders made elsewhere
/// and folded into the memo, then finished — is the measurement
/// `wire_controls` makes in one call: the same wiring, to the bit. And a
/// plan renders nothing: the thread asking for one stays free. The same
/// holds for the whole palette (`wire_plan_named`, `wire_named`).
#[test]
fn a_planned_measurement_is_the_measurement() {
    use crate::engine::{Engine, SessionConfig};
    let bank = preset_bank();
    let six = CONTROLS.len();
    // Fitted once: a fit renders every preset, and each engine below
    // needs only the same standardizer, not its own sixty renders.
    let std = Arc::new(preset_standardizer(&SessionConfig::default().phrase));
    for (name, controls) in [
        ("First Bass", &PALETTE[..six]),
        ("Glass Pad", &PALETTE[..six]),
        ("First Bass", &PALETTE[..]),
    ] {
        let p = bank.iter().find(|p| p.name == name).expect("preset exists");
        let fresh = || {
            let mut e = Engine::new(
                auracle_grammar::PatchGrammarPrior::default(),
                SessionConfig::default(),
            );
            e.standardizer = Some(Arc::clone(&std));
            e
        };
        let palette = controls.len() > six;
        let whole = if palette {
            fresh().wire_named(&p.tree, controls, &HashSet::new())
        } else {
            fresh().wire_controls(&p.tree)
        }
        .expect("preset vets");

        // The planned path, with its renders made on a separate memo — a
        // stand-in for a farm worker — and handed over as rows.
        let engine = fresh();
        let farm = RenderMemo::default();
        let mut failed: HashSet<String> = HashSet::new();
        let mut rounds = 0;
        loop {
            let misses = engine.memo().stats().misses;
            let need = if palette {
                engine.wire_plan_named(&p.tree, controls, &failed)
            } else {
                engine.wire_plan(&p.tree, &failed)
            };
            assert_eq!(
                engine.memo().stats().misses,
                misses,
                "{name}: a plan rendered"
            );
            if need.is_empty() {
                break;
            }
            rounds += 1;
            assert!(rounds <= 3, "{name}: a measurement is at most three rounds");
            for (key, t) in need {
                match featurize_memo(&t, &engine.cfg.phrase, &farm, false) {
                    Ok((cf, _)) => engine.memo().put(cf, None),
                    Err(_) => {
                        failed.insert(key);
                    }
                }
            }
        }
        let before = engine.memo().stats().misses;
        let planned = if palette {
            engine.wire_named(&p.tree, controls, &failed)
        } else {
            engine.wire_controls_known(&p.tree, &failed)
        }
        .expect("preset vets");
        assert_eq!(planned.1.len(), controls.len(), "{name}: one wiring each");
        assert_eq!(
            engine.memo().stats().misses,
            before,
            "{name}: finishing a planned measurement rendered"
        );
        assert_eq!(
            serde_json::to_string(&planned.1).unwrap(),
            serde_json::to_string(&whole.1).unwrap(),
            "{name}: the wiring differs"
        );
        assert_eq!(planned.0.cols, whole.0.cols, "{name}: the Jacobian differs");
    }
}

/// **Cutting a walk up cannot change it.** PERFORM's offer, its aimed
/// offer (which may walk more than once) and its drift are
/// [`PerformJob`]s the web worker advances a step at a time, answering
/// the player between steps. For a seed, each stepped in chunks of 1 and 3,
/// with another walk begun and run to its end after the first
/// chunk (a pressed Offer over a paused spare), ends on exactly the tree
/// (or exactly the reason there is none) that the one-call form ends on:
/// `Engine::offer`, `offer_aimed` and `drift`. Those are the job run to the
/// end, so this pins that pausing changes nothing; that the jobs match the
/// calls the app made before walks could be paused was checked by running
/// the previous source and this over the same seeds (identical trees, in
/// the commit that introduced them), not pinned here, because a walk's
/// exact tree is not the same across platforms. That the aimed case
/// really walks again is checked too, or the multi-walk path would be
/// going untested.
#[test]
fn a_stepped_walk_is_the_walk() {
    use crate::engine::{Engine, SessionConfig};
    use rand::rngs::StdRng;
    use rand::SeedableRng;
    let mut engine = Engine::new(
        auracle_grammar::PatchGrammarPrior::default(),
        SessionConfig::default(),
    );
    engine.standardizer = Some(Arc::new(preset_standardizer(&engine.cfg.phrase)));
    let grit = CONTROLS.iter().position(|c| c.name == "Grit").unwrap();
    let bank = preset_bank();
    let (mut again, mut moved) = (0, 0);
    for name in ["Glass Pad"] {
        let p = bank.iter().find(|p| p.name == name).expect("preset exists");
        for seed in 0..2u64 {
            // gamma 0 aims nowhere, so a walk that did not happen to go
            // the asked way by REACH_FLOOR walks again: the multi-walk
            // path.
            let rng = |k: u64| StdRng::seed_from_u64(seed ^ (k << 8));
            let whole = [
                engine.offer(&mut rng(0), &p.tree, &[], 4),
                engine.offer_aimed(&mut rng(1), &p.tree, &[], 4, grit, 1.0, 0.0, 3),
                engine.drift(&mut rng(2), &p.tree, &[], 5, 0.1),
            ];
            for chunk in [1usize, 3] {
                let jobs = [
                    engine.offer_job(&p.tree, &[], 4),
                    engine.offer_aimed_job(&p.tree, &[], 4, grit, 1.0, 0.0, 3),
                    engine.drift_job(&p.tree, &[], 5, 0.1),
                ];
                for (k, job) in jobs.into_iter().enumerate() {
                    let mut job = job.expect("a vetted preset begins");
                    let mut mine = rng(k as u64);
                    let mut other = StdRng::seed_from_u64(0xDEC0DE ^ seed);
                    let mut chunks = 0;
                    while job.step(&mut mine, chunk) {
                        chunks += 1;
                        if chunks == 1 {
                            let b = engine.offer_job(&p.tree, &[], 3).unwrap();
                            let _ = b.run(&mut other);
                        }
                    }
                    if k == 1 && job.walks() > 1 {
                        again += 1;
                    }
                    let got = job.finish();
                    assert_eq!(
                        got, whole[k],
                        "{name} seed {seed} chunk {chunk} walk {k}: chunking changed it"
                    );
                    moved += usize::from(got.is_ok());
                }
            }
        }
    }
    assert!(moved > 0, "no walk moved, so nothing was compared");
    assert!(again > 0, "no aimed offer walked twice");
}

/// The target a job walks is the one it began on: the engine's
/// standardizer taken away between two of its steps (a refit, or a new
/// session, while a spare grows) leaves it where it was.
#[test]
fn a_job_keeps_the_target_it_began_on() {
    use crate::engine::{Engine, SessionConfig};
    use rand::rngs::StdRng;
    use rand::SeedableRng;
    let mut engine = Engine::new(
        auracle_grammar::PatchGrammarPrior::default(),
        SessionConfig::default(),
    );
    engine.standardizer = Some(Arc::new(preset_standardizer(&engine.cfg.phrase)));
    let grit = CONTROLS.iter().position(|c| c.name == "Grit").unwrap();
    let p = preset_bank()
        .into_iter()
        .find(|p| p.name == "Glass Pad")
        .expect("preset exists");
    let want = engine.offer_aimed(
        &mut StdRng::seed_from_u64(9),
        &p.tree,
        &[],
        4,
        grit,
        1.0,
        1.0,
        2,
    );
    let mut job = engine
        .offer_aimed_job(&p.tree, &[], 4, grit, 1.0, 1.0, 2)
        .unwrap();
    let mut r = StdRng::seed_from_u64(9);
    assert!(job.step(&mut r, 1));
    engine.standardizer = None;
    while job.step(&mut r, 2) {}
    assert_eq!(job.finish(), want);
}
