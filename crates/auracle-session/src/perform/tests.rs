use super::*;
use auracle_grammar::preset_bank;

/// A standardizer fitted on the whole preset bank: the units a test reads
/// in σ (`REACH_FLOOR`, `MONO_TOL`, a graft's hair). 62 renders, so a test
/// whose assertion does not read the units fits on
/// [`preset_standardizer_in`] with a step instead.
fn preset_standardizer(spec: &PhraseSpec) -> Standardizer {
    preset_standardizer_in(spec, &RenderMemo::default(), 1)
}

/// A standardizer fitted on every `step`-th preset, measured through `memo`
/// (so a test that measures the same presets again pays for them once).
fn preset_standardizer_in(spec: &PhraseSpec, memo: &RenderMemo, step: usize) -> Standardizer {
    let rows: Vec<Vec<f64>> = preset_bank()
        .iter()
        .step_by(step)
        .filter_map(|p| featurize_memo(&p.tree, spec, memo, false).ok())
        .map(|(cf, _)| cf.features.phi())
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

/// **The palette is named as the page names it.** A control crosses the
/// wasm boundary as its index into [`PALETTE`] (a wiring's `index`, an aimed
/// offer's `control`, a graft's `k`), and the page names it back from its
/// own table (`apps/web/words.js`'s `PALETTE`). The index is a wire format,
/// so it is pinned here as a literal table, the same one
/// `apps/web/tests/words.test.mjs` pins for the page, and the page's table
/// is read and compared row for row: name, end words and family.
#[test]
fn the_palette_is_named_as_the_page_names_it() {
    const WIRE: [(&str, &str, &str, &str); 18] = [
        ("Bright", "dark", "bright", "Tone"),
        ("Snap", "bloom", "snap", "Dynamics"),
        ("Motion", "still", "restless", "Movement"),
        ("Body", "thin", "full", "Weight"),
        ("Grit", "smooth", "rough", "Character"),
        ("Space", "close", "far", "Space"),
        ("Warmth", "cold", "warm", "Tone"),
        ("Air", "closed", "airy", "Tone"),
        ("Thump", "light", "thumping", "Weight"),
        ("Heft", "slight", "heavy", "Weight"),
        ("Punch", "gentle", "punchy", "Dynamics"),
        ("Round", "hard", "round", "Dynamics"),
        ("Throb", "steady", "throbbing", "Movement"),
        ("Sway", "fixed", "swaying", "Movement"),
        ("Distance", "near", "distant", "Space"),
        ("Haze", "clear", "hazy", "Space"),
        ("Bite", "mild", "biting", "Character"),
        ("Lo-fi", "clean", "worn", "Character"),
    ];
    let engine: Vec<_> = PALETTE
        .iter()
        .map(|c| (c.name, c.low, c.high, c.family))
        .collect();
    assert_eq!(engine, WIRE, "a palette index names another control");

    // The page's table, field by field from each row's opening line.
    let words = include_str!("../../../../apps/web/words.js");
    let table = &words[words
        .find("export const PALETTE = [")
        .expect("words.js has PALETTE")..];
    let table = &table[..table.find("\n];").expect("PALETTE ends")];
    let field = |row: &str, key: &str| -> String {
        let at = row.find(&format!("{key}: \"")).expect(key) + key.len() + 3;
        row[at..at + row[at..].find('"').unwrap()].to_string()
    };
    let page: Vec<(String, String, String, String)> = table
        .lines()
        .filter(|l| l.trim_start().starts_with("{ name: "))
        .map(|l| {
            (
                field(l, "name"),
                field(l, "low"),
                field(l, "high"),
                field(l, "family"),
            )
        })
        .collect();
    let wire: Vec<(String, String, String, String)> = WIRE
        .iter()
        .map(|&(n, l, h, f)| (n.into(), l.into(), h.into(), f.into()))
        .collect();
    assert_eq!(page, wire, "the page names a palette index otherwise");
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
    // The hair is in the whole bank's σ; the presets sampled below are
    // measured once, for the fit and for the comparison.
    let memo = RenderMemo::default();
    let std = preset_standardizer_in(&spec, &memo, 1);
    let n_audio = AudioFeatures::NAMES.len();
    let z = |t: &PatchTree| {
        let (v, _) = featurize_memo(t, &spec, &memo, false).expect("grafted patch vets");
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
    // An identity in any units: eight presets fit it (its own memo, so the
    // render count below starts from nothing).
    let std = Arc::new(preset_standardizer_in(&spec, &RenderMemo::default(), 8));
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

/// The target a job walks is the one it began on: picks that reweight the
/// posterior between two of its steps (the player answers while a spare
/// grows), and then the engine's standardizer taken away (a refit, or a
/// new session), leave it where it was. The picks do move the target a new
/// job would walk, or this would compare nothing.
#[test]
fn a_job_keeps_the_target_it_began_on() {
    use crate::testkit::{contrary_picks, taught};
    use rand::rngs::StdRng;
    use rand::SeedableRng;
    let mut engine = taught(0x70B);
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
    contrary_picks(&mut engine, 4);
    let moved = engine.offer_aimed(
        &mut StdRng::seed_from_u64(9),
        &p.tree,
        &[],
        4,
        grit,
        1.0,
        1.0,
        2,
    );
    assert_ne!(moved, want, "the picks moved nothing a walk can see");
    engine.standardizer = None;
    while job.step(&mut r, 2) {}
    assert_eq!(job.finish(), want);
}

// ---- the wiring's arithmetic, on a Jacobian built by hand ----

/// Acid Line, whose cutoff (`node#cut`, Bright's site) sits low and whose
/// release (`amp#release`, Space's) sits low, beside a Jacobian built by
/// hand: the cutoff moves z along Bright's axis at 2σ per unit of travel,
/// the release along Space's at 3σ, and its other knobs move nothing.
fn acid_by_hand() -> (PatchTree, Jacobian) {
    let tree = preset_bank()
        .into_iter()
        .find(|p| p.name == "Acid Line")
        .expect("a preset")
        .tree;
    let names: Vec<String> = AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect();
    let knobs = live_knobs(&tree, PhraseSpec::default().sample_rate);
    let (bright, space) = (
        direction(&CONTROLS[0], &names),
        direction(&CONTROLS[5], &names),
    );
    let cols = knobs
        .iter()
        .map(|(a, _)| match a.as_str() {
            "node#cut" => bright.iter().map(|x| 2.0 * x).collect(),
            "amp#release" => space.iter().map(|x| 3.0 * x).collect(),
            _ => vec![0.0; names.len()],
        })
        .collect();
    let jac = Jacobian {
        addrs: knobs.iter().map(|(a, _)| a.clone()).collect(),
        values: knobs.iter().map(|(_, v)| *v).collect(),
        z: vec![0.0; names.len()],
        names,
        cols,
    };
    (tree, jac)
}

/// The standardized audio φ the hand-built Jacobian says `t` measures: its
/// cutoff's and release's travel from Acid Line's, times their columns,
/// passed through `bend` (each knob's travel in, the travel heard out).
fn by_hand(jac: &Jacobian, t: &PatchTree, bend: &dyn Fn(&str, f64) -> f64) -> Vec<f64> {
    let now = continuous_knobs(t);
    let mut z = jac.z.clone();
    for (k, a) in jac.addrs.iter().enumerate() {
        let v = now
            .iter()
            .find(|(b, _)| b == a)
            .map_or(jac.values[k], |x| x.1);
        let heard = bend(a, v - jac.values[k]);
        for (zi, ci) in z.iter_mut().zip(&jac.cols[k]) {
            *zi += ci * heard;
        }
    }
    z
}

/// **A control is wired to the knob that moves its axis, named first.**
/// Bright takes the cutoff and Space the release, each at the full
/// `MAX_TRAVEL` (the knob doing the work sets the scale), with the reach
/// their columns give it and a purity of 1; a control no knob moves is a
/// search control with nothing wired. Every wiring that is not a search
/// clears the gate. Applying a turn moves exactly the wired knobs, by the
/// turn times their travel, clamped to the knob's range; a turn of zero and
/// a search control move nothing.
#[test]
fn a_control_is_wired_to_the_knob_that_moves_its_axis() {
    let (_, jac) = acid_by_hand();
    let wiring = wire(&jac);
    assert_eq!(wiring.len(), CONTROLS.len());
    let by = |name: &str| wiring.iter().find(|w| w.name == name).unwrap();
    let (bright, space) = (by("Bright"), by("Space"));
    assert_eq!(bright.knobs, [("node#cut".to_string(), MAX_TRAVEL)]);
    assert_eq!(space.knobs, [("amp#release".to_string(), MAX_TRAVEL)]);
    assert!((bright.reach - 2.0 * MAX_TRAVEL).abs() < 1e-9);
    assert!((space.reach - 3.0 * MAX_TRAVEL).abs() < 1e-9);
    assert!((bright.purity - 1.0).abs() < 1e-9 && !bright.search);
    assert_eq!((bright.index, space.index), (Some(0), Some(5)));
    for w in &wiring {
        if w.search {
            assert_eq!(w.range(), (0.0, 0.0), "{} turns while a search", w.name);
        } else {
            assert!(
                w.reach >= REACH_FLOOR && w.purity >= PURITY_FLOOR,
                "{}",
                w.name
            );
        }
    }
    let snap = by("Snap");
    assert!(snap.search && snap.knobs.is_empty(), "no knob moves Snap");

    let cut = jac.values[jac.addrs.iter().position(|a| a == "node#cut").unwrap()];
    let turned = apply(&jac, &wiring, &[1.0, 1.0, 0.0, 0.0, 0.0, -2.0]);
    let rel = jac.values[jac.addrs.iter().position(|a| a == "amp#release").unwrap()];
    assert_eq!(
        turned,
        [
            (
                "amp#release".to_string(),
                (rel - MAX_TRAVEL).clamp(0.0, KNOB_MAX)
            ),
            ("node#cut".to_string(), cut + MAX_TRAVEL),
        ],
        "not the wired knobs, by the turn"
    );
    assert!(apply(&jac, &wiring, &[0.0; 6]).is_empty());
}

/// **Two controls that would be one gesture are told apart.** A later
/// control whose predicted movement is collinear with an earlier one's,
/// either sign, is a search control on this patch. The prior toward the
/// knobs a control names is a soft one: with no prior at all, the same
/// Jacobian wires the same knobs.
#[test]
fn two_controls_that_would_be_one_gesture_are_told_apart() {
    let (_, jac) = acid_by_hand();
    let mut twice = wire_set(&jac, &[PALETTE[0], PALETTE[0]], SEMANTIC_RIDGE);
    assert!(
        !twice[0].search && twice[1].search,
        "Bright twice was two gestures"
    );
    twice[1].search = false;
    twice[1].moved = twice[0].moved.iter().map(|x| -x).collect();
    separate(&mut twice);
    assert!(twice[1].search, "the opposite gesture was kept");
    let flat = wire_with(&jac, 1.0);
    for (a, b) in flat.iter().zip(wire(&jac)) {
        assert_eq!(
            a.knobs.iter().map(|k| &k.0).collect::<Vec<_>>(),
            b.knobs.iter().map(|k| &k.0).collect::<Vec<_>>()
        );
    }
    assert_eq!(palette_index(&PALETTE[7]), Some(7));
    let tried = NamedControl {
        name: "Tried",
        axis: &[("centroid_mean", -1.0)],
        ..PALETTE[0]
    };
    assert_eq!(palette_index(&tried), None, "a direction being tried out");
}

/// **Verification confirms a half the sound moves the asked way, closes
/// one it does not, and retries at half travel.** On a patch that answers
/// its knobs exactly as the Jacobian says, both halves of Bright and Space
/// are confirmed at the reach predicted. Where turning the cutoff down
/// changes nothing, that half is closed and the control turns up only.
/// Where the full turn overshoots and comes back, the control keeps half
/// its travel and the reach that goes with it. While a render is still
/// owed, nothing is decided.
#[test]
fn verification_confirms_closes_or_halves_each_half() {
    let (tree, jac) = acid_by_hand();
    let straight = |_: &str, d: f64| d;
    let mut wiring = wire(&jac);
    assert!(verify_by(&tree, &jac, &mut wiring, &mut |t| {
        Look::Z(by_hand(&jac, t, &straight))
    }));
    let bright = wiring.iter().find(|w| w.name == "Bright").unwrap();
    assert!((bright.up.unwrap() - bright.reach).abs() < 1e-9);
    // Turned down, the cutoff stops at the bottom of its range: the half is
    // confirmed at the reach that is left.
    let cut = jac.values[jac.addrs.iter().position(|a| a == "node#cut").unwrap()];
    assert!((bright.down.unwrap() - 2.0 * cut.min(MAX_TRAVEL)).abs() < 1e-9);
    assert_eq!(bright.range(), (-1.0, 1.0));

    let floor_down = |a: &str, d: f64| if a == "node#cut" { d.max(0.0) } else { d };
    let mut wiring = wire(&jac);
    verify_by(&tree, &jac, &mut wiring, &mut |t| {
        Look::Z(by_hand(&jac, t, &floor_down))
    });
    let bright = wiring.iter().find(|w| w.name == "Bright").unwrap();
    assert_eq!((bright.down, bright.range()), (Some(0.0), (0.0, 1.0)));

    // The cutoff's effect rises to a quarter turn and falls back past it.
    let overshoot = |a: &str, d: f64| {
        if a == "node#cut" {
            d.signum() * (0.25 - (d.abs() - 0.25).abs())
        } else {
            d
        }
    };
    let mut wiring = wire(&jac);
    verify_by(&tree, &jac, &mut wiring, &mut |t| {
        Look::Z(by_hand(&jac, t, &overshoot))
    });
    let bright = wiring.iter().find(|w| w.name == "Bright").unwrap();
    assert_eq!(bright.knobs, [("node#cut".to_string(), MAX_TRAVEL / 2.0)]);
    assert!(
        (bright.reach - 2.0 * MAX_TRAVEL / 2.0).abs() < 1e-9,
        "the reach was not halved"
    );
    assert!(!bright.search);

    let mut wiring = wire(&jac);
    let complete = verify_by(&tree, &jac, &mut wiring, &mut |_| Look::Pending);
    assert!(!complete);
    assert!(wiring.iter().all(|w| w.up.is_none() && w.down.is_none()));
}

// ---- PERFORM through the engine, sized to the claim ----

fn preset_named(name: &str) -> PatchTree {
    preset_bank()
        .into_iter()
        .find(|p| p.name == name)
        .expect("a preset")
        .tree
}

/// A shipped preset under filters stacked two levels past the depth
/// ceiling: a patch a session saved by an older build can hold, which the
/// grammar's prior gives no mass.
fn too_deep() -> PatchTree {
    let mut deep = preset_named("Folded Lead");
    while deep.root.depth() < auracle_grammar::mutate::MAX_DEPTH + 2 {
        deep.root = AudioNode::Filter {
            uid: Uid::NEW,
            kind: auracle_grammar::term::FilterKind::SvfLp,
            cutoff: 0.6,
            resonance: 0.2,
            mod_depth: 0.0,
            input: Box::new(deep.root),
            modulation: ModNode::None,
        };
    }
    deep
}

/// **A measurement planned and rendered elsewhere is the measurement.**
/// Before a scale there is nothing to measure or plan. Then, on Folded Lead
/// (seven live knobs): the plan, rendered round by round into the memo,
/// finishes without a render and gives exactly what measuring in one call
/// gives. Its Jacobian is one-sided finite differences of the live knobs,
/// each stepped toward the inside of its range. A render known not to vet
/// is not made, and its knob moves nothing in the measurement. Wiring no
/// control measures the patch alone; a patch that does not vet has no
/// measurement.
#[test]
fn a_measurement_planned_and_rendered_elsewhere_is_the_measurement() {
    use crate::engine::{Engine, SessionConfig};
    let tree = preset_named("Folded Lead");
    let none = HashSet::new();
    let mut engine = Engine::new(
        auracle_grammar::PatchGrammarPrior::default(),
        SessionConfig::default(),
    );
    assert!(engine.wire_controls(&tree).is_none() && engine.jacobian(&tree).is_none());
    assert!(engine.wire_plan(&tree, &none).is_empty());
    let spec = engine.cfg.phrase.clone();
    engine.standardizer = Some(Arc::new(preset_standardizer_in(&spec, engine.memo(), 8)));

    let mut failed = HashSet::new();
    let mut rounds = 0;
    loop {
        let need = engine.wire_plan(&tree, &failed);
        if need.is_empty() {
            break;
        }
        rounds += 1;
        assert!(rounds <= 3, "a measurement is at most three rounds");
        for (key, t) in need {
            assert_eq!(key, render_key(&t, &spec));
            if featurize_memo(&t, &spec, engine.memo(), false).is_err() {
                failed.insert(key);
            }
        }
    }
    let renders = engine.memo().stats().misses;
    let (jac, wiring) = engine.wire_controls_known(&tree, &failed).expect("it vets");
    assert_eq!(engine.memo().stats().misses, renders, "finishing rendered");
    let (jac1, wiring1) = engine.wire_controls(&tree).unwrap();
    assert_eq!(
        serde_json::to_string(&(&jac, &wiring)).unwrap(),
        serde_json::to_string(&(&jac1, &wiring1)).unwrap()
    );
    assert!(
        wiring.iter().any(|w| w.up.is_some()),
        "nothing was verified"
    );

    let live = live_knobs(&tree, spec.sample_rate);
    assert_eq!(
        jac.addrs,
        live.iter().map(|(a, _)| a.clone()).collect::<Vec<_>>()
    );
    let std = engine.standardizer().unwrap();
    let z = |t: &PatchTree| audio_z(t, &spec, engine.memo(), std).unwrap();
    assert_eq!(jac.z, z(&tree));
    for (k, (addr, v)) in live.iter().enumerate() {
        let h = if *v < 0.5 {
            JACOBIAN_STEP
        } else {
            -JACOBIAN_STEP
        };
        let nudged = set_param(&tree, addr, ParamValue::Continuous(v + h)).unwrap();
        let want: Vec<f64> = z(&nudged)
            .iter()
            .zip(&jac.z)
            .map(|(a, b)| (a - b) / h)
            .collect();
        assert_eq!(jac.cols[k], want, "{addr}");
    }
    assert_eq!(engine.jacobian(&tree).unwrap().cols, jac.cols);

    let (addr, v) = &live[0];
    let h = if *v < 0.5 {
        JACOBIAN_STEP
    } else {
        -JACOBIAN_STEP
    };
    let nudged = set_param(&tree, addr, ParamValue::Continuous(v + h)).unwrap();
    let skip: HashSet<String> = [render_key(&nudged, &spec)].into();
    let (blind, _) = engine.wire_controls_known(&tree, &skip).unwrap();
    assert!(
        blind.cols[0].iter().all(|x| *x == 0.0),
        "a known failure moved a knob"
    );

    let (bare, wired) = engine.wire_named(&tree, &[], &none).unwrap();
    assert!(bare.cols.is_empty() && wired.is_empty());
    assert!(engine.wire_plan_named(&tree, &[], &none).is_empty());
    let silent = PatchTree {
        amp: tree.amp.clone(),
        root: AudioNode::Silence { uid: Uid::NEW },
    };
    assert!(engine.wire_controls(&silent).is_none());
}

/// **An offer, a drift and an aimed offer, stepped, are the one call**, and
/// say where they stand: one walk for an offer or a drift, at most the
/// walks asked for an aimed one, the steps left falling to none, done at
/// the end. A drift turns live knobs only, never a locked one, and with
/// every live knob locked has nothing to turn. An aimed offer's movement is
/// the engine's own measure of it; aimed at a control the palette does not
/// hold it is the plain offer, and has nothing to measure. A patch the
/// prior gives no mass cannot be walked from at all.
#[test]
fn an_offer_a_drift_and_an_aimed_offer_stepped_are_the_one_call() {
    use crate::testkit::taught;
    use rand::rngs::StdRng;
    use rand::SeedableRng;
    let engine = taught(0x9E0);
    assert!(engine.has_taste());
    let tree = preset_named("Folded Lead");
    let stepped = |mut job: PerformJob, seed: u64| {
        let mut r = StdRng::seed_from_u64(seed);
        assert!(!job.is_done() && job.walks() == 1);
        let mut left = job.left();
        while job.step(&mut r, 1) {
            assert!(job.walks() > 1 || job.left() < left, "a step took nothing");
            left = job.left();
        }
        assert!(job.is_done() && job.left() == 0);
        job
    };

    let want = engine.offer(&mut StdRng::seed_from_u64(1), &tree, &[], 4);
    let job = stepped(engine.offer_job(&tree, &[], 4).unwrap(), 1);
    assert_eq!(job.walks(), 1);
    assert_eq!(job.finish(), want);

    let live: Vec<String> = live_knobs(&tree, engine.cfg.phrase.sample_rate)
        .into_iter()
        .map(|(a, _)| a)
        .collect();
    let locks = vec![live[0].clone()];
    let want = engine.drift(&mut StdRng::seed_from_u64(2), &tree, &locks, 8, 0.2);
    let job = stepped(engine.drift_job(&tree, &locks, 8, 0.2).unwrap(), 2);
    let drifted = job.finish();
    assert_eq!(drifted, want);
    let drifted = drifted.expect("eight drift steps moved nothing");
    let before: std::collections::HashMap<String, f64> =
        continuous_knobs(&tree).into_iter().collect();
    for (a, v) in continuous_knobs(&drifted) {
        assert!(
            v == before[&a] || (live.contains(&a) && a != live[0]),
            "{a} moved"
        );
    }
    assert_eq!(structural_addrs(&drifted), structural_addrs(&tree));
    assert_eq!(
        engine.drift_job(&tree, &live, 4, 0.2).err(),
        Some(RefineOutcome::NoMove)
    );

    let aimed = (0..8u64)
        .find_map(|seed| {
            let job = engine
                .offer_aimed_job(&tree, &[], 2, 0, 1.0, AIM_GAMMA, 2)
                .unwrap();
            let job = stepped(job, seed);
            assert!(job.walks() <= 2);
            match job.finish_moved() {
                (Ok(t), moved) => Some((t, moved)),
                (Err(_), moved) => {
                    assert_eq!(moved, None);
                    None
                }
            }
        })
        .expect("no aimed offer moved");
    assert_eq!(aimed.1, engine.moved_along(&tree, &aimed.0, 0));
    assert!(aimed.1.is_some());
    assert_eq!(
        engine.offer_toward(&mut StdRng::seed_from_u64(3), &tree, &[], 3, 999, 1.0),
        engine.offer(&mut StdRng::seed_from_u64(3), &tree, &[], 3)
    );
    assert_eq!(engine.moved_along(&tree, &tree, 999), None);
    let (_, plain) = engine.offer_job(&tree, &[], 2).unwrap().finish_moved();
    assert_eq!(plain, None, "an offer not aimed has no movement to report");

    let deep = too_deep();
    assert_eq!(
        engine.offer_job(&deep, &[], 2).err(),
        Some(RefineOutcome::OutsideSupport)
    );
    assert_eq!(
        engine.drift_job(&deep, &[], 2, 0.2).err(),
        Some(RefineOutcome::OutsideSupport)
    );
    assert_eq!(
        engine
            .offer_aimed_job(&deep, &[], 2, 0, 1.0, AIM_GAMMA, 2)
            .err(),
        Some(RefineOutcome::OutsideSupport)
    );
}

/// **Before the first fit PERFORM explores the vetted prior.** With a
/// scale and no taste, an offer, a drift and an aimed offer still walk (on
/// the prior restricted to sounds that vet), and each comes back as a sound
/// that vets or with the reason it did not move.
#[test]
fn before_the_first_fit_perform_explores_the_vetted_prior() {
    use crate::engine::{Engine, SessionConfig};
    use rand::rngs::StdRng;
    use rand::SeedableRng;
    let mut engine = Engine::new(
        auracle_grammar::PatchGrammarPrior::default(),
        SessionConfig::default(),
    );
    let spec = engine.cfg.phrase.clone();
    engine.standardizer = Some(Arc::new(preset_standardizer_in(&spec, engine.memo(), 8)));
    assert!(!engine.has_taste());
    let tree = preset_named("Folded Lead");
    let mut r = StdRng::seed_from_u64(4);
    let walked = [
        engine.offer(&mut r, &tree, &[], 3),
        engine.drift(&mut r, &tree, &[], 4, 0.2),
        engine.offer_toward(&mut r, &tree, &[], 3, 4, -1.0),
    ];
    for w in &walked {
        match w {
            Ok(t) => assert!(featurize_memo(t, &spec, engine.memo(), false).is_ok()),
            Err(why) => assert_eq!(*why, RefineOutcome::NoMove),
        }
    }
    assert!(
        walked.iter().any(|w| w.is_ok()),
        "nothing moved: nothing was checked"
    );
}

/// **A control with nothing to turn, or only a way back, is a search.** A
/// patch with no live knob wires no control. A Jacobian whose best solve,
/// clamped to each knob's travel, would move the sound against the
/// control's direction (a strong knob that must be held back, and a weak
/// one pushed past its travel) wires nothing for it either: it asks for an
/// offer instead. A direction over coordinates the measurement does not
/// name is no direction at all, and does not divide by its zero length.
#[test]
fn a_control_with_nothing_to_turn_or_only_a_way_back_is_a_search() {
    let names: Vec<String> = AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect();
    let none = Jacobian {
        addrs: Vec::new(),
        values: Vec::new(),
        names: names.clone(),
        z: vec![0.5; names.len()],
        cols: Vec::new(),
    };
    for w in wire(&none) {
        assert!(
            w.search && w.knobs.is_empty(),
            "{} wired on no knob",
            w.name
        );
    }

    let d = direction(&PALETTE[0], &names);
    let off: Vec<usize> = (0..names.len()).filter(|&i| d[i] == 0.0).collect();
    let col = |along: f64, parts: &[(usize, f64)]| {
        let mut c: Vec<f64> = d.iter().map(|x| along * x).collect();
        for &(k, v) in parts {
            c[off[k]] += v;
        }
        c
    };
    let back = Jacobian {
        addrs: ["node#cut", "node#k1", "node#k2"]
            .map(String::from)
            .to_vec(),
        values: vec![0.5; 3],
        names: names.clone(),
        z: vec![0.0; names.len()],
        cols: vec![
            col(-0.1, &[(2, 1.0)]),
            col(0.0, &[(1, -10.0), (2, -10.0)]),
            col(-10.0, &[(1, -110.0)]),
        ],
    };
    let bright = &wire_set(&back, &[PALETTE[0]], SEMANTIC_RIDGE)[0];
    assert!(bright.search && bright.knobs.is_empty() && bright.reach == 0.0);

    let nowhere = direction(&PALETTE[0], &["nothing".to_string()]);
    assert_eq!(nowhere, [0.0]);
}

/// The solve leaves a coordinate it cannot determine at zero: a system
/// with a zero pivot solves the rest and keeps that one still, rather than
/// dividing by zero. This pins `solve`'s own contract; no caller reaches the
/// case today (the wiring's systems carry a ridge on every diagonal entry).
#[test]
fn a_zero_pivot_keeps_its_coordinate_still() {
    assert_eq!(
        solve(vec![vec![2.0, 0.0], vec![0.0, 0.0]], vec![4.0, 1.0]),
        [2.0, 0.0]
    );
}

/// A patch the compiler refuses (nested past what it builds) has no live
/// knob: PERFORM turns only knobs a voice can take live.
#[test]
fn a_patch_the_compiler_refuses_has_no_live_knob() {
    let mut deep = preset_named("Folded Lead");
    let sr = PhraseSpec::default().sample_rate;
    while auracle_grammar::compile(&deep, sr).is_ok() {
        deep.root = AudioNode::Filter {
            uid: Uid::NEW,
            kind: auracle_grammar::term::FilterKind::SvfLp,
            cutoff: 0.6,
            resonance: 0.2,
            mod_depth: 0.0,
            input: Box::new(deep.root),
            modulation: ModNode::None,
        };
    }
    assert!(!continuous_knobs(&deep).is_empty());
    assert!(live_knobs(&deep, sr).is_empty());
}

/// **Verification counts a point that does not vet as no movement.** With
/// every render refused, neither half of a control moves, nor does its
/// retry at half travel: each control is closed both ways and becomes a
/// search. `verify` is `verify_by` on real renders: it decides a wiring
/// exactly as the measurement does.
#[test]
fn verification_counts_a_point_that_does_not_vet_as_no_movement() {
    let (tree, jac) = acid_by_hand();
    let mut wiring = wire(&jac);
    assert!(verify_by(&tree, &jac, &mut wiring, &mut |_| Look::Fails));
    for w in &wiring {
        assert!(w.search, "{} turns with nothing heard", w.name);
        if !w.knobs.is_empty() {
            assert_eq!((w.up, w.down), (Some(0.0), Some(0.0)));
        }
    }
    assert!(
        wiring.iter().any(|w| !w.knobs.is_empty()),
        "nothing was verified"
    );

    use crate::engine::{Engine, SessionConfig};
    let mut engine = Engine::new(
        auracle_grammar::PatchGrammarPrior::default(),
        SessionConfig::default(),
    );
    let spec = engine.cfg.phrase.clone();
    engine.standardizer = Some(Arc::new(preset_standardizer_in(&spec, engine.memo(), 8)));
    let tree = preset_named("Folded Lead");
    let (jac, measured) = engine.wire_controls(&tree).unwrap();
    let mut wiring = wire(&jac);
    verify(
        &tree,
        &jac,
        &mut wiring,
        &spec,
        engine.memo(),
        engine.standardizer().unwrap(),
    );
    assert_eq!(
        serde_json::to_string(&wiring).unwrap(),
        serde_json::to_string(&measured).unwrap()
    );
    // A plan names no render already known not to vet.
    let need = engine.wire_plan(&tree, &HashSet::new());
    assert!(need.is_empty(), "the measurement left renders owed");
    let nudge = &jac.addrs[0];
    let h = if jac.values[0] < 0.5 {
        JACOBIAN_STEP
    } else {
        -JACOBIAN_STEP
    };
    let t = set_param(&tree, nudge, ParamValue::Continuous(jac.values[0] + h)).unwrap();
    let mut fresh = Engine::new(
        auracle_grammar::PatchGrammarPrior::default(),
        SessionConfig::default(),
    );
    fresh.standardizer = engine.standardizer.clone();
    let failed: HashSet<String> = [render_key(&t, &spec)].into();
    let plan = fresh.wire_plan(&tree, &failed);
    assert!(plan.iter().all(|(k, _)| !failed.contains(k)));
    assert!(!plan.is_empty());
}

/// **A control leans the way the lens that claims the sound slopes.** Before
/// a fit there is no lean, and none for a sound that does not vet. With a
/// posterior, each control asked for gets one, in the order asked, carrying
/// its palette index: the posterior slope of the utility along the control's
/// direction at the sound in hand, through the lens that rates the sound
/// highest in each draw. Here the sound sits one σ up `n_filter` and at the
/// mean of everything else, so the lens that likes filters claims it in both
/// draws: lens 0 in the first, lens 1 in the second. That lens likes
/// brightness in both and is split on bass, so Bright leans up clear of zero
/// and Body crosses it, while the other lens's dislike of brightness, and the
/// claiming lens's own liking for filters (a structure no control moves),
/// lean nothing.
#[test]
fn a_control_leans_the_way_the_lens_that_claims_the_sound_slopes() {
    use crate::engine::{phi_names, Engine, SessionConfig};
    use auracle_taste::{TasteConfig, TastePosterior, TasteSample};
    let mut engine = Engine::new(
        auracle_grammar::PatchGrammarPrior::default(),
        SessionConfig::default(),
    );
    let spec = engine.cfg.phrase.clone();
    let tree = preset_named("Folded Lead");
    let names = phi_names();
    let at = |bare: &str| {
        names
            .iter()
            .position(|n| n.split(':').next() == Some(bare))
            .unwrap()
    };
    let (bright, bass, filters) = (at("centroid_mean"), at("bass_fraction"), at("n_filter"));
    let raw = featurize_memo(&tree, &spec, engine.memo(), false)
        .unwrap()
        .0
        .features
        .phi();
    let mut mean = raw;
    mean[filters] -= 1.0;
    engine.standardizer = Some(Arc::new(Standardizer {
        mean,
        std: vec![1.0; names.len()],
    }));
    assert!(
        engine.lean(&tree, &CONTROLS).is_none(),
        "a lean before a fit"
    );

    let lens = |w: &[(usize, f64)]| {
        let mut theta = vec![0.0; names.len()];
        for &(i, x) in w {
            theta[i] = x;
        }
        theta
    };
    let claims = |b: f64| lens(&[(filters, 2.0), (bright, 1.0), (bass, b)]);
    let dark = lens(&[(bright, -5.0)]);
    let draw = |theta: Vec<Vec<f64>>| TasteSample {
        theta,
        tau: vec![0.0],
        cuts: vec![-1.0, 0.0, 1.0],
    };
    engine.posterior = Some(Arc::new(TastePosterior {
        cfg: TasteConfig::mixture(names.len(), 2),
        samples: vec![
            draw(vec![claims(1.0), dark.clone()]),
            draw(vec![dark, claims(-1.0)]),
        ],
        weights: Vec::new(),
    }));

    let leans = engine.lean(&tree, &CONTROLS).expect("a lean once fitted");
    let asked: Vec<(Option<usize>, &str)> =
        leans.iter().map(|l| (l.index, l.name.as_str())).collect();
    let want: Vec<(Option<usize>, &str)> = CONTROLS
        .iter()
        .enumerate()
        .map(|(k, c)| (Some(k), c.name))
        .collect();
    assert_eq!(asked, want);
    let near = |a: f64, b: f64| (a - b).abs() < 1e-12;
    // Bright is centroid and rolloff at 1/√2 each: the claiming lens's 1 on
    // centroid, in both draws.
    let up = &leans[0];
    assert!(
        near(up.mean, 0.5f64.sqrt()) && near(up.std, 0.0),
        "Bright {up:?}"
    );
    // Body is bass alone: +1 in one draw, −1 in the other.
    let body = &leans[3];
    assert!(near(body.mean, 0.0) && near(body.std, 1.0), "Body {body:?}");
    // Nothing the claiming lens weighs moves Grit, Snap, Motion or Space.
    for l in [&leans[1], &leans[2], &leans[4], &leans[5]] {
        assert!(near(l.mean, 0.0) && near(l.std, 0.0), "{l:?}");
    }
    // Asked for in another order, from the palette: that order, each with its
    // index, and the same lean for the same control.
    let other = engine.lean(&tree, &palette_controls(&[16, 3])).unwrap();
    assert_eq!(
        other.iter().map(|l| l.index).collect::<Vec<_>>(),
        vec![Some(16), Some(3)]
    );
    assert_eq!(other[1], leans[3]);

    // A sound that does not vet has no lean; nor, without a scale, does any.
    let silent = PatchTree {
        amp: tree.amp.clone(),
        root: AudioNode::Silence { uid: Uid::NEW },
    };
    assert!(engine.lean(&silent, &CONTROLS).is_none());
    engine.standardizer = None;
    assert!(engine.lean(&tree, &CONTROLS).is_none());
}
