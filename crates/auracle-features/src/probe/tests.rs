use super::*;
use crate::phrase::Note;
use crate::render_phrase;
use auracle_grammar::term::{AmpEnv, AudioNode, FilterKind, ModNode, Uid, Waveform};

/// One held note, no chord: a level a test can work out by hand.
fn mono() -> PhraseSpec {
    PhraseSpec {
        notes: vec![Note {
            voct: 0.0,
            on_s: 0.5,
            off_s: 0.1,
            chord: Vec::new(),
        }],
        ..PhraseSpec::default()
    }
}

fn amp() -> AmpEnv {
    AmpEnv {
        attack: 0.01,
        decay: 0.2,
        sustain: 0.8,
        release: 0.1,
    }
}

fn saw() -> AudioNode {
    AudioNode::Vco {
        uid: Uid::NEW,
        wave: Waveform::Saw,
        octave: 0,
        detune: 0.5,
        mod_depth: 0.0,
        modulation: ModNode::None,
    }
}

fn level<'a>(p: &'a CableProbe, from: &str) -> &'a CableLevel {
    p.cables
        .iter()
        .find(|c| c.from == from)
        .unwrap_or_else(|| panic!("no cable from `{from}`"))
}

/// **A known patch reads its known level.** A lone saw VCO swings ±5 V,
/// so its RMS is 5/√3 V (9.2 dB re 1 V) and its peak 5 V (14.0 dB);
/// band-limiting rounds the corners and moves both a little. Under a
/// lowpass closed to the bottom of its range the same saw reads far
/// lower, and an empty socket reads the floor.
#[test]
fn a_known_patch_reads_its_known_level() {
    let spec = mono();
    let alone = cable_levels(
        &PatchTree {
            amp: amp(),
            root: saw(),
        },
        &spec,
    )
    .expect("renders");
    assert_eq!(alone.cables.len(), 1);
    let c = &alone.cables[0];
    assert_eq!((c.from.as_str(), c.to.as_str()), ("node", "amp"));
    let rms = 20.0 * (5.0 / 3f64.sqrt()).log10();
    assert!(
        (c.rms_db - rms).abs() < 0.5,
        "a ±5 V saw reads {:.2} dB RMS, not {rms:.2}",
        c.rms_db
    );
    assert!(
        (c.peak_db - 20.0 * 5f64.log10()).abs() < 1.0,
        "a ±5 V saw peaks at {:.2} dB",
        c.peak_db
    );
    assert_eq!(alone.samples, spec.total_samples());

    let filtered = PatchTree {
        amp: amp(),
        root: AudioNode::Filter {
            uid: Uid::NEW,
            kind: FilterKind::SvfLp,
            cutoff: 0.0,
            resonance: 0.0,
            mod_depth: 0.0,
            input: Box::new(saw()),
            modulation: ModNode::None,
        },
    };
    let p = cable_levels(&filtered, &spec).expect("renders");
    assert_eq!(p.cables.len(), 2);
    let (out, into) = (level(&p, "node"), level(&p, "node/0"));
    assert!(
        (into.rms_db - c.rms_db).abs() < 1e-9,
        "the saw under the filter reads what the saw alone reads"
    );
    assert!(
        out.rms_db < into.rms_db - 12.0,
        "a closed lowpass passes {:.1} dB of a saw's {:.1}",
        out.rms_db,
        into.rms_db
    );

    let empty = PatchTree {
        amp: amp(),
        root: AudioNode::Silence { uid: Uid::NEW },
    };
    let p = cable_levels(&empty, &spec).expect("renders");
    assert_eq!(p.cables[0].rms_db, PROBE_FLOOR_DB);
    assert_eq!(p.cables[0].peak_db, PROBE_FLOOR_DB);
}

/// **A cable the voice has no tap for reads silence.** Should the rack and
/// the compiler ever disagree about a key, that cable reads the floor: never
/// another cable's level, and never a panic on the audio path.
#[test]
fn a_cable_with_no_tap_reads_the_floor() {
    let tree = PatchTree {
        amp: amp(),
        root: saw(),
    };
    let mut probe = Probe {
        keys: vec!["node".into(), "node/7".into()],
        slots: Vec::new(),
        sum_sq: vec![0.0; 2],
        peak: vec![0.0; 2],
        n: 0,
    };
    render_phrase_observed(&tree, &mono(), &mut probe).expect("renders");
    assert!(probe.slots[0].is_some() && probe.slots[1].is_none());
    assert!(probe.sum_sq[0] > 0.0 && probe.peak[0] > 0.0);
    assert_eq!((probe.sum_sq[1], probe.peak[1]), (0.0, 0.0));
    assert_eq!(db(probe.peak[1]), PROBE_FLOOR_DB);
}

/// **The probe does not change the render,** bit for bit, on every
/// preset, under the standard phrase (chords included).
#[test]
fn the_probe_does_not_change_the_render() {
    let spec = PhraseSpec::default();
    for (name, tree) in auracle_grammar::presets().iter().step_by(4) {
        let plain = render_phrase(tree, &spec).expect("renders").samples;
        let (probed, levels) = probe_cables(tree, &spec).expect("renders");
        assert!(
            plain.len() == probed.samples.len()
                && plain
                    .iter()
                    .zip(&probed.samples)
                    .all(|(a, b)| a.to_bits() == b.to_bits()),
            "{name}: the probed render differs from the plain one"
        );
        assert!(
            levels.cables.iter().any(|c| c.rms_db > PROBE_FLOOR_DB),
            "{name}: no cable carries anything"
        );
    }
}

/// **The cables are the rack's:** one per audio wire of `describe`, in
/// its order, with the keys PATCH draws them by and the uids its cable
/// identity is made of; every one is measured (a tap resolves for every
/// `from`); and a second probe of the same tree reads the same.
#[test]
fn the_cables_are_the_racks() {
    let spec = mono();
    for (name, tree) in auracle_grammar::presets().iter().step_by(3) {
        let mut tree = tree.clone();
        tree.ensure_uids();
        let rack = describe(&tree);
        let wires: Vec<_> = rack.wires.iter().filter(|w| w.kind == "audio").collect();
        let p = cable_levels(&tree, &spec).expect("renders");
        assert_eq!(p.cables.len(), wires.len(), "{name}");
        let voice = auracle_grammar::compile(&tree, spec.sample_rate).expect("compiles");
        for (c, w) in p.cables.iter().zip(&wires) {
            assert_eq!((&c.from, &c.to), (&w.from, &w.to), "{name}");
            let uid = |k: &str| rack.modules.iter().find(|m| m.key == k).unwrap().uid;
            assert_eq!(c.from_uid, uid(&c.from), "{name}");
            assert_eq!(c.to_uid, uid(&c.to), "{name}");
            assert_ne!(c.from_uid, 0, "{name}: a settled module has a uid");
            assert!(
                voice.taps.contains_key(&c.from),
                "{name}: `{}` has no tap",
                c.from
            );
        }
        assert_eq!(p, cable_levels(&tree, &spec).expect("renders"), "{name}");
    }
}
