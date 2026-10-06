use super::*;
use crate::mutate::{apply_struct_op, validate_tree, StructOp};
use crate::term::{FilterKind, Waveform};
use rand::rngs::StdRng;
use rand::SeedableRng;

fn filter_over_vco(cutoff: f64) -> PatchTree {
    PatchTree {
        amp: AmpEnv {
            attack: 0.1,
            decay: 0.3,
            sustain: 0.6,
            release: 0.2,
        },
        root: AudioNode::Filter {
            uid: Uid(7),
            kind: FilterKind::SvfBp,
            cutoff,
            resonance: 0.4,
            mod_depth: 0.5,
            input: Box::new(AudioNode::Vco {
                uid: Uid(9),
                wave: Waveform::Saw,
                octave: 0,
                detune: 0.5,
                mod_depth: 0.3,
                modulation: ModNode::None,
            }),
            modulation: ModNode::None,
        },
    }
}

/// The generative model's own claim, checked rather than trusted: every
/// continuous site the prior can draw lands inside [`PARAM_DOMAIN`]. If
/// this ever fails, the domain constant is wrong and every gate built on
/// it is refusing legitimate patches.
#[test]
fn every_prior_draw_is_in_domain() {
    let prior = PatchGrammarPrior::default();
    let mut rng = StdRng::seed_from_u64(20260802);
    for _ in 0..400 {
        let t = prior.sample_with_rng(&mut rng);
        assert!(
            t.domain_violations().is_empty(),
            "the prior drew an out-of-domain site: {:?}",
            t.domain_violations()
        );
    }
}

/// The sentinel, exactly as it was found in the shipped session: four
/// sites of one patch at `1e30`. Repair moves all four and nothing else,
/// and every node keeps the identity it had — locks and hand-placed
/// positions ride on `uid`, so a repair that reissued them would fix a
/// number by destroying the player's arrangement.
#[test]
fn clamp_repairs_the_sentinel_and_keeps_identity() {
    let mut t = filter_over_vco(1e30);
    t.amp.sustain = 1e30;
    assert_eq!(t.domain_violations().len(), 2);

    assert_eq!(t.clamp_domains(), 2);
    assert!(t.domain_violations().is_empty());
    assert_eq!(t.amp.sustain, PARAM_MAX, "the top of the domain is open");
    assert_eq!(t.amp.attack, 0.1, "a clean site must not move");
    let AudioNode::Filter {
        uid,
        cutoff,
        resonance,
        input,
        ..
    } = &t.root
    else {
        panic!("the repair changed the term's shape");
    };
    assert_eq!(*cutoff, PARAM_MAX);
    assert_eq!(*resonance, 0.4);
    assert_eq!(*uid, Uid(7), "the repair reissued an identity");
    let AudioNode::Vco { uid, .. } = &**input else {
        panic!("the repair changed the child");
    };
    assert_eq!(*uid, Uid(9));

    // Idempotent, and free on a clean term.
    assert_eq!(t.clamp_domains(), 0);
}

/// A categorical index past its arity is refused, not wrapped. Unreachable
/// from MH or a knob edit; a hand-made trace is the way in, and wrapping
/// `oct = 9` to some octave would be inventing a value.
#[test]
fn an_out_of_range_categorical_is_refused() {
    let good = filter_over_vco(0.5);
    let mut t = good.to_trace();
    let addr = t
        .choices
        .keys()
        .find(|k| k.ends_with("#oct"))
        .cloned()
        .expect("the vco has an octave site");
    t.choices.get_mut(&addr).unwrap().value = ChoiceValue::Usize(9);
    let err = PatchTree::from_trace(&t).expect_err("oct = 9 must not decode");
    assert!(err.to_string().contains("categorical"), "{err}");
    let addr = t
        .choices
        .keys()
        .find(|k| k.ends_with("#fkind"))
        .cloned()
        .expect("the filter has a kind site");
    let mut t2 = good.to_trace();
    t2.choices.get_mut(&addr).unwrap().value = ChoiceValue::Usize(4);
    assert!(
        PatchTree::from_trace(&t2).is_err(),
        "fkind = 4 must not wrap to svf lp"
    );
}

/// An AUDIO IN's input past the last slot (a `u8` in a saved file can say
/// 200) is reported with the out-of-domain knobs and repaired to the last
/// slot, so the patch stays editable: the codec refuses the slot, and
/// every knob edit goes through the codec.
#[test]
fn an_input_past_the_last_slot_is_reported_and_repaired() {
    let mut t = PatchTree {
        amp: AmpEnv {
            attack: 0.1,
            decay: 0.3,
            sustain: 0.7,
            release: 0.3,
        },
        root: AudioNode::AudioIn {
            uid: Uid::NEW,
            input: 200,
            gain: 0.5,
            channel: InputChannel::Both,
        },
    };
    assert_eq!(
        t.domain_violations(),
        vec![("node#input".to_string(), 200.0)]
    );
    assert!(PatchTree::from_trace(&t.to_trace()).is_err());
    assert!(crate::set_param(&t, "node#gain", crate::ParamValue::Continuous(0.3)).is_err());
    assert_eq!(t.clamp_domains(), 1);
    assert!(matches!(
        t.root,
        AudioNode::AudioIn { input, .. } if input as usize == INPUT_SLOTS - 1
    ));
    assert!(t.domain_violations().is_empty());
    assert!(crate::set_param(&t, "node#gain", crate::ParamValue::Continuous(0.3)).is_ok());
}

/// NaN carries no direction, so it lands in the middle rather than being
/// pinned to an end that would state one.
#[test]
fn nan_lands_mid_range() {
    let mut t = filter_over_vco(f64::NAN);
    assert_eq!(t.clamp_domains(), 1);
    let AudioNode::Filter { cutoff, .. } = &t.root else {
        unreachable!()
    };
    assert_eq!(*cutoff, 0.5);
}

/// `validate_tree` is the predicate and names the site — the WS-1 rider
/// used to speak only about size and depth, which is why a value could
/// walk through it.
#[test]
fn validate_tree_refuses_an_out_of_domain_site() {
    assert!(validate_tree(&filter_over_vco(0.6)).is_ok());
    let err = validate_tree(&filter_over_vco(1e30)).expect_err("must refuse");
    assert!(
        err.contains("node#cut"),
        "the reason must name the site: {err}"
    );
    assert!(err.contains("out of range"), "{err}");
}

/// The route the corruption actually travelled: an explicit fragment
/// handed to `apply_struct_op` (a HELD subtree, a bank drop) is adopted
/// verbatim, so `finish()` has to be the funnel that cleans it.
#[test]
fn an_explicit_fragment_cannot_seat_a_bad_value() {
    let host = filter_over_vco(0.6);
    let bad = AudioNode::Fold {
        uid: Uid::NEW,
        threshold: 1e30,
        mod_depth: 0.3,
        input: Box::new(AudioNode::Noise {
            uid: Uid::NEW,
            color: crate::term::NoiseColor::White,
        }),
        modulation: ModNode::None,
    };
    let out = apply_struct_op(
        &host,
        &StructOp::InsertTree {
            key: "node/0".into(),
            node: bad,
        },
    )
    .expect("a repairable fragment must still land");
    assert!(
        out.domain_violations().is_empty(),
        "finish() seated {:?}",
        out.domain_violations()
    );
}

/// `Silence` survives a codec round trip, and it is source index **6**.
///
/// The index is asserted as a literal, not read back from the encoder,
/// because it is a wire format: a saved trace stores the number, so if
/// this ever changes every persisted genome silently re-points at a
/// different oscillator. A test that asked the encoder what it wrote would
/// agree with any renumbering and catch nothing.
#[test]
fn silence_round_trips_at_source_index_six() {
    let tree = PatchTree {
        amp: crate::term::AmpEnv {
            attack: 0.1,
            decay: 0.3,
            sustain: 0.6,
            release: 0.2,
        },
        root: AudioNode::Mix {
            uid: Uid::NEW,
            balance: 0.5,
            a: Box::new(AudioNode::Silence { uid: Uid::NEW }),
            b: Box::new(AudioNode::Noise {
                uid: Uid::NEW,
                color: crate::term::NoiseColor::White,
            }),
        },
    };

    let t = tree.to_trace();
    assert_eq!(
        get_usize(&t, "node/0", "src").expect("a source index"),
        6,
        "Silence must stay source index 6 — the index is the wire format"
    );
    // Two sites and no more: a hole has nothing to set.
    assert_eq!(
        t.choices.keys().filter(|k| k.starts_with("node/0")).count(),
        2,
        "Silence should write only #leaf and #src"
    );

    let back = PatchTree::from_trace(&t).expect("round trips");
    assert_eq!(back.to_sexpr(), tree.to_sexpr());
}
