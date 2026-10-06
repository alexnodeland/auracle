use super::*;
use crate::term::FilterKind;

/// A trace written by the v1 palette still decodes.
///
/// Saved sessions, bank entries and the whole observation log are stored
/// as traces, so a site added to an *existing* variant is a wire-format
/// change: `Delay` gained `#mdepth` and a `/m` slot, and `Rand` gained
/// `#glide`, none of which appear in a trace written last week. The
/// defaults are chosen so the decoded patch still *sounds* like the one
/// that was saved — an empty slot and a mod depth that modulates nothing.
#[test]
fn a_v1_trace_still_decodes() {
    let mut t = Trace::default();
    for (site, v) in [
        ("attack", 0.1),
        ("decay", 0.3),
        ("sustain", 0.6),
        ("release", 0.2),
    ] {
        put_f64(&mut t, "amp", site, v);
    }
    // node = Delay { time, fb, dmix } — no #mdepth, no /m slot at all.
    put_bool(&mut t, "node", "leaf", false);
    put_usize(&mut t, "node", "op", 3);
    put_f64(&mut t, "node", "time", 0.6);
    put_f64(&mut t, "node", "fb", 0.4);
    put_f64(&mut t, "node", "dmix", 0.35);
    // node/0 = Filter modulated by a v1 Rand — rate but no glide.
    put_bool(&mut t, "node/0", "leaf", false);
    put_usize(&mut t, "node/0", "op", 1);
    put_usize(&mut t, "node/0", "fkind", 3);
    put_f64(&mut t, "node/0", "cut", 0.5);
    put_f64(&mut t, "node/0", "res", 0.4);
    put_f64(&mut t, "node/0", "mdepth", 0.5);
    put_usize(&mut t, "node/0/m", "mod", 3);
    put_f64(&mut t, "node/0/m", "rate", 0.62);
    // node/0/0 = Vco.
    put_bool(&mut t, "node/0/0", "leaf", true);
    put_usize(&mut t, "node/0/0", "src", 0);
    put_usize(&mut t, "node/0/0", "wave", 2);
    put_usize(&mut t, "node/0/0", "oct", 1);
    put_f64(&mut t, "node/0/0", "det", 0.5);

    let tree = PatchTree::from_trace(&t).expect("a v1 trace must still load");
    let AudioNode::Delay {
        mod_depth,
        modulation,
        input,
        ..
    } = &tree.root
    else {
        panic!("decoded the wrong node: {}", tree.root.to_sexpr());
    };
    assert_eq!(
        *mod_depth, 0.0,
        "a v1 trace must decode to the same term as v1 JSON: depth 0"
    );
    assert_eq!(*modulation, ModNode::None, "absent slot must decode empty");
    let AudioNode::Filter {
        kind, modulation, ..
    } = &**input
    else {
        panic!("decoded the wrong child: {}", input.to_sexpr());
    };
    assert_eq!(*kind, FilterKind::Ladder);
    assert_eq!(
        *modulation,
        ModNode::Rand {
            uid: Uid::NEW,
            rate: 0.62,
            glide: 0.0
        },
        "a v1 S&H must come back as hard steps"
    );
    // The vco at the bottom is the one that matters most: wave 2A gave it
    // a pitch slot, and a vco is in nearly every trace ever written. An
    // absent `#mdepth`/`/m` must decode to "no pitch modulation", not to
    // a missing-address error that fails the whole genome.
    let AudioNode::Filter { input, .. } = &**input else {
        unreachable!("checked above")
    };
    assert_eq!(
        **input,
        AudioNode::Vco {
            uid: Uid::NEW,
            wave: Waveform::Saw,
            octave: -1,
            detune: 0.5,
            mod_depth: DEFAULT_MOD_DEPTH,
            modulation: ModNode::None,
        },
        "a v1 vco must decode with its pitch slot empty"
    );

    // ...and once loaded it is a v2 genome like any other: re-encoding it
    // writes the new sites, and that trace round-trips.
    let back = PatchTree::from_trace(&tree.to_trace()).expect("re-encoded trace decodes");
    assert_eq!(back, tree);
}

fn amp_sites(t: &mut Trace) {
    for (site, v) in [
        ("attack", 0.1),
        ("decay", 0.3),
        ("sustain", 0.6),
        ("release", 0.2),
    ] {
        put_f64(t, "amp", site, v);
    }
}

/// The patch the two old-save fixtures below both describe: every
/// modulation kind that existed before `Steps` — all eight `#mod` indices,
/// `None` included — in one tree.
fn every_pre_steps_mod_kind() -> PatchTree {
    PatchTree {
        amp: AmpEnv {
            attack: 0.1,
            decay: 0.3,
            sustain: 0.6,
            release: 0.2,
        },
        root: AudioNode::Mix {
            uid: Uid::NEW,
            balance: 0.5,
            a: Box::new(AudioNode::Delay {
                uid: Uid::NEW,
                time: 0.6,
                feedback: 0.4,
                mix: 0.35,
                mod_depth: 0.2,
                modulation: ModNode::Rand {
                    uid: Uid::NEW,
                    rate: 0.62,
                    glide: 0.1,
                },
                input: Box::new(AudioNode::Fold {
                    uid: Uid::NEW,
                    threshold: 0.6,
                    mod_depth: 0.4,
                    modulation: ModNode::Follow {
                        uid: Uid::NEW,
                        sens: 0.5,
                        release: 0.3,
                    },
                    input: Box::new(AudioNode::Filter {
                        uid: Uid::NEW,
                        kind: FilterKind::SvfLp,
                        cutoff: 0.5,
                        resonance: 0.4,
                        mod_depth: 0.5,
                        modulation: ModNode::Pair {
                            uid: Uid::NEW,
                            kind: PairOp::Xor,
                            a: Box::new(ModNode::Euclid {
                                uid: Uid::NEW,
                                rate: 0.5,
                                steps: 0.5,
                                pulses: 0.4,
                            }),
                            b: Box::new(ModNode::Op {
                                uid: Uid::NEW,
                                kind: ModOp::Slew,
                                p0: 0.2,
                                p1: 0.3,
                                input: Box::new(ModNode::Lfo {
                                    uid: Uid::NEW,
                                    wave: Waveform::Sine,
                                    rate: 0.4,
                                }),
                            }),
                        },
                        input: Box::new(AudioNode::Vco {
                            uid: Uid::NEW,
                            wave: Waveform::Saw,
                            octave: 0,
                            detune: 0.5,
                            mod_depth: 0.3,
                            modulation: ModNode::Env {
                                uid: Uid::NEW,
                                attack: 0.2,
                                decay: 0.5,
                            },
                        }),
                    }),
                }),
            }),
            b: Box::new(AudioNode::Vco {
                uid: Uid::NEW,
                wave: Waveform::Square,
                octave: -1,
                detune: 0.5,
                mod_depth: 0.3,
                modulation: ModNode::None,
            }),
        },
    }
}

/// A trace written **before `Steps` existed** decodes to the same tree,
/// and re-encodes to the same indices.
///
/// Written site by site with the `#mod` numbers as literals rather than
/// through `to_trace`, because the point is the wire format: a saved
/// genome stores the number, so appending a kind must not move one. An
/// encoder-derived fixture would agree with any renumbering.
#[test]
fn a_pre_steps_trace_still_decodes_to_the_same_tree() {
    let mut t = Trace::default();
    amp_sites(&mut t);
    put_bool(&mut t, "node", "leaf", false);
    put_usize(&mut t, "node", "op", 0); // mix
    put_f64(&mut t, "node", "bal", 0.5);
    // node/0 = delay, slot = s&h rand (#mod 3)
    put_bool(&mut t, "node/0", "leaf", false);
    put_usize(&mut t, "node/0", "op", 3);
    put_f64(&mut t, "node/0", "time", 0.6);
    put_f64(&mut t, "node/0", "fb", 0.4);
    put_f64(&mut t, "node/0", "dmix", 0.35);
    put_f64(&mut t, "node/0", "mdepth", 0.2);
    put_usize(&mut t, "node/0/m", "mod", 3);
    put_f64(&mut t, "node/0/m", "rate", 0.62);
    put_f64(&mut t, "node/0/m", "glide", 0.1);
    // node/0/0 = fold, slot = follower (#mod 4)
    put_bool(&mut t, "node/0/0", "leaf", false);
    put_usize(&mut t, "node/0/0", "op", 2);
    put_f64(&mut t, "node/0/0", "thresh", 0.6);
    put_f64(&mut t, "node/0/0", "mdepth", 0.4);
    put_usize(&mut t, "node/0/0/m", "mod", 4);
    put_f64(&mut t, "node/0/0/m", "sens", 0.5);
    put_f64(&mut t, "node/0/0/m", "rel", 0.3);
    // node/0/0/0 = filter, slot = xor(euclid, slew(lfo)) — #mod 7, 5, 6, 1
    let f = "node/0/0/0";
    put_bool(&mut t, f, "leaf", false);
    put_usize(&mut t, f, "op", 1);
    put_usize(&mut t, f, "fkind", 0);
    put_f64(&mut t, f, "cut", 0.5);
    put_f64(&mut t, f, "res", 0.4);
    put_f64(&mut t, f, "mdepth", 0.5);
    put_usize(&mut t, "node/0/0/0/m", "mod", 7);
    put_usize(&mut t, "node/0/0/0/m", "pairop", 4);
    put_usize(&mut t, "node/0/0/0/m/0", "mod", 5);
    put_f64(&mut t, "node/0/0/0/m/0", "erate", 0.5);
    put_f64(&mut t, "node/0/0/0/m/0", "esteps", 0.5);
    put_f64(&mut t, "node/0/0/0/m/0", "epulses", 0.4);
    put_usize(&mut t, "node/0/0/0/m/1", "mod", 6);
    put_usize(&mut t, "node/0/0/0/m/1", "modop", 1);
    put_f64(&mut t, "node/0/0/0/m/1", "rise", 0.2);
    put_f64(&mut t, "node/0/0/0/m/1", "fall", 0.3);
    put_usize(&mut t, "node/0/0/0/m/1/0", "mod", 1);
    put_usize(&mut t, "node/0/0/0/m/1/0", "wave", 0);
    put_f64(&mut t, "node/0/0/0/m/1/0", "rate", 0.4);
    // node/0/0/0/0 = vco, slot = mod env (#mod 2)
    let v = "node/0/0/0/0";
    put_bool(&mut t, v, "leaf", true);
    put_usize(&mut t, v, "src", 0);
    put_usize(&mut t, v, "wave", 2);
    put_usize(&mut t, v, "oct", 2);
    put_f64(&mut t, v, "det", 0.5);
    put_f64(&mut t, v, "mdepth", 0.3);
    put_usize(&mut t, "node/0/0/0/0/m", "mod", 2);
    put_f64(&mut t, "node/0/0/0/0/m", "att", 0.2);
    put_f64(&mut t, "node/0/0/0/0/m", "dec", 0.5);
    // node/1 = vco, empty slot (#mod 0)
    put_bool(&mut t, "node/1", "leaf", true);
    put_usize(&mut t, "node/1", "src", 0);
    put_usize(&mut t, "node/1", "wave", 3);
    put_usize(&mut t, "node/1", "oct", 1);
    put_f64(&mut t, "node/1", "det", 0.5);
    put_f64(&mut t, "node/1", "mdepth", 0.3);
    put_usize(&mut t, "node/1/m", "mod", 0);

    let want = every_pre_steps_mod_kind();
    let tree = PatchTree::from_trace(&t).expect("a pre-steps trace must still load");
    assert_eq!(tree, want, "{}", tree.to_sexpr());
    // Re-encoding writes back exactly the choices it was given: same
    // addresses, same indices, nothing added.
    let again = tree.to_trace();
    assert_eq!(again.choices.len(), t.choices.len());
    for (a, c) in &t.choices {
        assert_eq!(again.choices[a].value, c.value, "moved at {a}");
    }
}

/// A `PatchTree` saved as JSON before `Steps` existed — the shape bank
/// entries and sessions are persisted in — still deserializes to the same
/// tree, and serializes back byte for byte.
#[test]
fn a_pre_steps_json_save_still_loads() {
    // The shape the pre-`Steps` (wave 2C) serializer wrote, uids included
    // the way a settled bank entry carries them. The byte-for-byte
    // assertion below is what pins that none of these variants' wire
    // format moved when a new one was appended.
    const SAVED: &str = r#"{"amp":{"attack":0.1,"decay":0.3,"sustain":0.6,"release":0.2},"root":{"Mix":{"balance":0.5,"a":{"Delay":{"time":0.6,"feedback":0.4,"mix":0.35,"mod_depth":0.2,"input":{"Fold":{"threshold":0.6,"mod_depth":0.4,"input":{"Filter":{"kind":"SvfLp","cutoff":0.5,"resonance":0.4,"mod_depth":0.5,"input":{"Vco":{"wave":"Saw","octave":0,"detune":0.5,"mod_depth":0.3,"modulation":{"Env":{"attack":0.2,"decay":0.5,"uid":9}},"uid":8}},"modulation":{"Pair":{"kind":"xor","a":{"Euclid":{"rate":0.5,"steps":0.5,"pulses":0.4,"uid":6}},"b":{"Op":{"kind":"slew","p0":0.2,"p1":0.3,"input":{"Lfo":{"wave":"Sine","rate":0.4,"uid":7}},"uid":10}},"uid":5}},"uid":4}},"modulation":{"Follow":{"sens":0.5,"release":0.3,"uid":11}},"uid":2}},"modulation":{"Rand":{"rate":0.62,"glide":0.1,"uid":3}},"uid":1}},"b":{"Vco":{"wave":"Square","octave":-1,"detune":0.5,"mod_depth":0.3,"modulation":"None","uid":12}},"uid":13}}}"#;
    let tree: PatchTree = serde_json::from_str(SAVED).expect("an old save must still load");
    assert_eq!(tree, every_pre_steps_mod_kind(), "{}", tree.to_sexpr());
    assert_eq!(serde_json::to_string(&tree).unwrap(), SAVED);
}

/// `Steps` is `#mod` index **8** — after `Pair` — and every other kind is
/// where it was. Asserted as literals for the reason
/// `silence_round_trips_at_source_index_six` gives:
/// the index is the wire format.
#[test]
fn mod_kind_indices_are_append_only() {
    let leaf_or = |m: ModNode| {
        let mut t = Trace::default();
        encode_mod(&m, "k", &mut t);
        get_usize(&t, "k", "mod").unwrap()
    };
    let lfo = || ModNode::Lfo {
        uid: Uid::NEW,
        wave: Waveform::Sine,
        rate: 0.4,
    };
    let steps = ModNode::Steps {
        uid: Uid::NEW,
        rate: 0.4,
        length: 0.5,
        slew: 0.25,
        values: [0.0, 1.0, 0.2, 0.8, 0.4, 0.6, 0.3, 0.7],
    };
    let table = [
        (ModNode::None, 0),
        (lfo(), 1),
        (
            ModNode::Env {
                uid: Uid::NEW,
                attack: 0.1,
                decay: 0.2,
            },
            2,
        ),
        (
            ModNode::Rand {
                uid: Uid::NEW,
                rate: 0.1,
                glide: 0.2,
            },
            3,
        ),
        (
            ModNode::Follow {
                uid: Uid::NEW,
                sens: 0.1,
                release: 0.2,
            },
            4,
        ),
        (
            ModNode::Euclid {
                uid: Uid::NEW,
                rate: 0.1,
                steps: 0.2,
                pulses: 0.3,
            },
            5,
        ),
        (
            ModNode::Op {
                uid: Uid::NEW,
                kind: ModOp::Hold,
                p0: 0.5,
                p1: 0.0,
                input: Box::new(lfo()),
            },
            6,
        ),
        (
            ModNode::Pair {
                uid: Uid::NEW,
                kind: PairOp::Min,
                a: Box::new(lfo()),
                b: Box::new(lfo()),
            },
            7,
        ),
        (steps.clone(), 8),
    ];
    for (m, want) in table {
        assert_eq!(leaf_or(m.clone()), want, "{m:?}");
    }
    // All eleven sites of a Steps, latent values included, and nothing
    // else under its key.
    let mut t = Trace::default();
    encode_mod(&steps, "k", &mut t);
    assert_eq!(t.choices.len(), 1 + STEPS_SITES.len());
    assert_eq!(steps.site_count(), t.choices.len());
    assert_eq!(decode_mod(&t, "k").unwrap(), steps);
}
