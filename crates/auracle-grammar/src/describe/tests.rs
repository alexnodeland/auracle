use crate::tests::{captured, listening, node_at, patch, tracked};
use crate::{describe, edit, mutate, presets, set_param, term, tree_diff};
use crate::{ParamValue, StructError, Take, Uid};
use fugue_evo::genome::trace_genome::TraceGenome;

/// The rack draws an AUDIO IN as its own plate: kind `audio_in` (the
/// `NodeKind` spelling), title "audio in", and three knobs whose
/// addresses are trace sites a knob edit can write.
#[test]
fn audio_in_is_a_plate_with_three_knobs() {
    use describe::KnobKind;
    let tree = listening(2, term::InputChannel::Right);
    let rack = describe::describe(&tree);
    let m = rack
        .modules
        .iter()
        .find(|m| m.key == "node/0")
        .expect("the input's plate");
    assert_eq!(
        (m.kind.as_str(), m.title.as_str()),
        ("audio_in", "audio in")
    );
    assert!(!m.is_mod);
    let labels: Vec<&str> = m.knobs.iter().map(|k| k.label.as_str()).collect();
    assert_eq!(labels, ["input", "gain", "channel"]);
    let addrs: Vec<&str> = m.knobs.iter().map(|k| k.addr.as_str()).collect();
    assert_eq!(addrs, ["node/0#input", "node/0#gain", "node/0#channel"]);
    match &m.knobs[0].kind {
        KnobKind::Enum { options } => {
            assert_eq!(options.len(), term::INPUT_SLOTS);
            assert_eq!((options[0].as_str(), m.knobs[0].value), ("1", 2.0));
        }
        k => panic!("input is a selector, not {k:?}"),
    }
    match &m.knobs[2].kind {
        KnobKind::Enum { options } => {
            assert_eq!(options, &["left", "right", "both"]);
            assert_eq!(m.knobs[2].value, 1.0);
        }
        k => panic!("channel is a selector, not {k:?}"),
    }
    assert_eq!(m.structural_addrs, ["node/0#leaf", "node/0#src"]);
    // Every knob is an address a knob edit writes, and nothing else moves.
    let set = set_param(&tree, "node/0#input", ParamValue::Index(5)).unwrap();
    match &set.root.children()[0] {
        term::AudioNode::AudioIn { input, channel, .. } => {
            assert_eq!((*input, *channel), (5, term::InputChannel::Right));
        }
        n => panic!("the edit replaced the node: {}", n.to_sexpr()),
    }
    let clamped = set_param(&tree, "node/0#input", ParamValue::Index(99)).unwrap();
    assert_eq!(
        clamped
            .to_trace()
            .get_usize(&fugue::addr!("node/0", "input")),
        Some(term::INPUT_SLOTS - 1),
        "an input past the last slot is clamped to it"
    );
    let louder = set_param(&tree, "node/0#gain", ParamValue::Continuous(0.9)).unwrap();
    assert_eq!(tree_diff(&tree, &louder).len(), 1);
    assert_eq!(tree.input_sites(), ["node/0#input"]);
    assert!(tree.listens() && !presets::presets()[0].1.listens());
}

/// The rack draws a TRACK as a two-input plate (the branch it plays at
/// `/0`, the one it follows at `/1`) and a CAPTURE as a one-input plate,
/// each knob a trace site a knob edit writes, and neither with a
/// modulation slot.
#[test]
fn track_and_capture_are_plates_with_their_knobs() {
    use describe::KnobKind;
    let tree = patch(term::AudioNode::Mix {
        uid: Uid::NEW,
        balance: 0.5,
        a: Box::new(tracked(term::PitchBand::High, 0.3)),
        b: Box::new(captured(term::CaptureMode::Loop, Take::empty())),
    });
    let rack = describe::describe(&tree);
    let plate = |key: &str| {
        rack.modules
            .iter()
            .find(|m| m.key == key)
            .unwrap_or_else(|| panic!("no plate at {key}"))
            .clone()
    };
    let trace = tree.to_trace();
    let track = plate("node/0");
    assert_eq!(
        (track.kind.as_str(), track.title.as_str()),
        ("track", "track")
    );
    let labels: Vec<&str> = track.knobs.iter().map(|k| k.label.as_str()).collect();
    assert_eq!(labels, ["band", "sensitivity", "dynamics"]);
    let addrs: Vec<&str> = track.knobs.iter().map(|k| k.addr.as_str()).collect();
    assert_eq!(addrs, ["node/0#band", "node/0#tsens", "node/0#tdyn"]);
    match &track.knobs[0].kind {
        KnobKind::Enum { options } => {
            assert_eq!(options, &["low", "mid", "high"]);
            assert_eq!(track.knobs[0].value, 2.0);
        }
        k => panic!("band is a selector, not {k:?}"),
    }
    assert_eq!(track.structural_addrs, ["node/0#leaf", "node/0#op"]);
    for w in ["node/0/0", "node/0/1"] {
        assert!(
            rack.wires.iter().any(|x| x.from == w && x.to == "node/0"),
            "no wire from {w}"
        );
    }
    let capture = plate("node/1");
    assert_eq!(
        (capture.kind.as_str(), capture.title.as_str()),
        ("capture", "capture")
    );
    assert_eq!(capture.knobs.len(), 1);
    assert_eq!(capture.knobs[0].label, "play");
    match &capture.knobs[0].kind {
        KnobKind::Enum { options } => assert_eq!(options, &["once", "hold", "loop"]),
        k => panic!("play is a selector, not {k:?}"),
    }
    assert_eq!(capture.structural_addrs, ["node/1#leaf", "node/1#op"]);
    assert!(rack
        .wires
        .iter()
        .any(|x| x.from == "node/1/0" && x.to == "node/1"));
    // Every knob is a trace site, and a knob edit writes it.
    for k in track.knobs.iter().chain(&capture.knobs) {
        let (key, site) = edit::split_addr(&k.addr);
        assert!(
            trace.choices.contains_key(&fugue::addr!(key, site)),
            "{} is not a trace site",
            k.addr
        );
    }
    let set = set_param(&tree, "node/1#play", ParamValue::Index(1)).unwrap();
    assert!(matches!(
        node_at(&set.root, "node/1"),
        Some(term::AudioNode::Capture {
            play: term::CaptureMode::Hold,
            ..
        })
    ));
    // Neither takes a modulator, and each says so in its own words.
    for key in ["node/0", "node/1"] {
        let refused = mutate::apply_struct_op(
            &tree,
            &mutate::StructOp::SetMod {
                key: key.into(),
                kind: mutate::ModKind::Lfo,
            },
        );
        assert!(
            matches!(&refused, Err(StructError::Invalid(why)) if why.contains("track and capture")),
            "{refused:?}"
        );
    }
}
