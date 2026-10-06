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

/// **Every audio kind's `#src` or `#op` index, as a literal table.** A
/// saved trace stores these numbers, so a kind that moved would re-point
/// every persisted genome at a different module; asked of the encoder
/// alone, a renumbering would agree with itself and catch nothing. The
/// match is exhaustive, so a new kind does not compile until it is given
/// its index here, after the last, and every kind in `NodeKind::ALL` is
/// encoded from the module a hand places and decoded back.
#[test]
fn source_and_op_indices_are_append_only() {
    use crate::mutate::{default_fragment, NodeKind};
    let pinned = |k: NodeKind| -> (&'static str, usize) {
        match k {
            NodeKind::Vco => ("src", 0),
            NodeKind::Supersaw => ("src", 1),
            NodeKind::Noise => ("src", 2),
            NodeKind::Wavetable => ("src", 3),
            NodeKind::Pluck => ("src", 4),
            NodeKind::Formant => ("src", 5),
            NodeKind::Silence => ("src", 6),
            NodeKind::AudioIn => ("src", 7),
            NodeKind::Mix => ("op", 0),
            NodeKind::Filter => ("op", 1),
            NodeKind::Fold => ("op", 2),
            NodeKind::Delay => ("op", 3),
            NodeKind::Chorus => ("op", 4),
            NodeKind::Reverb => ("op", 5),
            NodeKind::Distortion => ("op", 6),
            NodeKind::Bitcrush => ("op", 7),
            NodeKind::Phaser => ("op", 8),
            NodeKind::RingMod => ("op", 9),
            NodeKind::Flanger => ("op", 10),
            NodeKind::Tremolo => ("op", 11),
            NodeKind::Vibrato => ("op", 12),
            NodeKind::Eq => ("op", 13),
            NodeKind::Granular => ("op", 14),
            NodeKind::Shift => ("op", 15),
            NodeKind::Comp => ("op", 16),
            NodeKind::Duck => ("op", 17),
            NodeKind::Gate => ("op", 18),
            NodeKind::Vocoder => ("op", 19),
            NodeKind::Track => ("op", 20),
            NodeKind::Capture => ("op", 21),
        }
    };
    for kind in NodeKind::ALL {
        let node = default_fragment(kind);
        let mut t = Trace::default();
        encode_node(&node, "k", &mut t);
        let (site, want) = pinned(kind);
        assert_eq!(
            (site == "src", get_usize(&t, "k", site).ok()),
            (kind.is_source(), Some(want)),
            "{kind:?} must stay at #{site} {want}: the index is the wire format"
        );
        assert_eq!(decode_node(&t, "k").expect("decodes"), node, "{kind:?}");
    }
}

// ---------- the genome's own contract ----------

use crate::describe::{describe, KnobKind};
use crate::edit::{set_param, ParamValue};
use crate::mutate::{apply_struct_op, default_fragment, ModKind, NodeKind, StructOp};
use fugue_evo::genome::bounds::MultiBounds;
use rand::rngs::StdRng;
use rand::SeedableRng;

fn voice(root: AudioNode) -> PatchTree {
    PatchTree {
        amp: AmpEnv {
            attack: 0.1,
            decay: 0.3,
            sustain: 0.7,
            release: 0.4,
        },
        root,
    }
}

/// `kind` as a hand places it on a saw: a source alone, anything else
/// inserted over it.
fn over_saw(kind: NodeKind) -> PatchTree {
    if kind.is_source() {
        return voice(default_fragment(kind));
    }
    let op = StructOp::Insert {
        key: "node".into(),
        kind,
    };
    apply_struct_op(&voice(default_fragment(NodeKind::Vco)), &op).expect("an insert over a saw")
}

/// Every module a hand can place, bare and under every modulation a hand
/// can set on it, a shaper twice so it wraps a term.
fn every_kind_and_modulation() -> Vec<PatchTree> {
    let mut trees = Vec::new();
    for kind in NodeKind::ALL {
        let tree = over_saw(kind);
        for mk in ModKind::ALL {
            let set = StructOp::SetMod {
                key: "node".into(),
                kind: mk,
            };
            if let Ok(once) = apply_struct_op(&tree, &set) {
                trees.push(apply_struct_op(&once, &set).unwrap_or(once.clone()));
                trees.push(once);
            }
        }
        trees.push(tree);
    }
    trees
}

/// **A patch is its own genome**, as fugue-evo reads one: it decodes to
/// itself, its dimension is the number of choices its trace holds, a draw
/// from a seed is the grammar's draw from that seed (ADR-001: the bounds
/// are ignored, the prior is the default one), and `try_distance` never
/// refuses.
#[test]
fn a_patch_is_its_own_genome() {
    for t in every_kind_and_modulation() {
        assert_eq!(t.decode(), t);
        assert_eq!(
            t.dimension(),
            t.to_trace().choices.len(),
            "{}",
            t.to_sexpr()
        );
        let other = over_saw(NodeKind::Delay);
        assert_eq!(t.try_distance(&other).ok(), Some(t.distance(&other)));
    }
    let prior = PatchGrammarPrior::default();
    for seed in 0..20 {
        let drawn = PatchTree::generate(
            &mut StdRng::seed_from_u64(seed),
            &MultiBounds::symmetric(5.0, 3),
        );
        assert_eq!(
            drawn,
            prior.sample_with_rng(&mut StdRng::seed_from_u64(seed))
        );
    }
}

/// The trace's address prefix is `node`, the root's key: every choice a
/// patch writes is under it but the amp envelope's four. Saved traces and
/// fugue-evo's subtree moves read it, so it is pinned.
#[test]
fn the_trace_prefix_is_the_roots_key() {
    assert_eq!(PatchTree::trace_prefix(), "node");
    let t = over_saw(NodeKind::Mix).to_trace();
    let (amp, tree): (Vec<String>, Vec<String>) = t
        .choices
        .keys()
        .map(|a| a.to_string())
        .partition(|a| a.starts_with("amp#"));
    assert_eq!(amp.len(), 4);
    assert!(tree.iter().all(|a| a.starts_with("node")), "{tree:?}");
}

/// **Distance is parameter L1 where the trees agree** (the trait's doc, and
/// fugue-evo's niching reads it): a patch is at 0 from itself; turning any
/// continuous knob a hand can reach by δ moves it exactly δ; flipping a
/// selector moves it exactly 1; an octave, a quarter. On every module and
/// every modulation, amp envelope included, so no knob is invisible to it.
#[test]
fn distance_is_l1_over_every_knob_a_hand_can_turn() {
    let mut knobs = 0;
    for t in every_kind_and_modulation() {
        assert_eq!(t.distance(&t), 0.0, "{}", t.to_sexpr());
        for k in describe(&t).modules.into_iter().flat_map(|m| m.knobs) {
            let (to, want) = match &k.kind {
                KnobKind::Continuous => {
                    let up = k.value + 0.125 < 1.0;
                    let v = if up { k.value + 0.125 } else { k.value - 0.125 };
                    (ParamValue::Continuous(v), 0.125)
                }
                KnobKind::Enum { options } => {
                    let i = (k.value as usize + 1) % options.len();
                    (ParamValue::Index(i), 1.0)
                }
                KnobKind::Octave => {
                    let i = if k.value < 4.0 {
                        k.value + 1.0
                    } else {
                        k.value - 1.0
                    };
                    (ParamValue::Index(i as usize), 0.25)
                }
            };
            let turned = set_param(&t, &k.addr, to).unwrap();
            let d = t.distance(&turned);
            assert!(
                (d - want).abs() < 1e-12,
                "{}: {} moved the distance {d}, not {want}",
                t.to_sexpr(),
                k.addr
            );
            assert_eq!(turned.distance(&t), d, "{} is not symmetric", k.addr);
            knobs += 1;
        }
    }
    assert!(knobs > 1_000, "only {knobs} knobs turned");
}

/// **And a size penalty where the trees diverge**: two different modules
/// at a place are as far apart as both subtrees are big, and two different
/// modulations as 2 plus the difference in their sizes, so a leaf swapped
/// for a two-deep chain reads as further than two leaves swapped.
#[test]
fn distance_charges_by_size_where_the_trees_diverge() {
    for a in NodeKind::ALL {
        for b in NodeKind::ALL.into_iter().filter(|b| *b != a) {
            let (ta, tb) = (over_saw(a), over_saw(b));
            let want = (ta.root.size() + tb.root.size()) as f64;
            assert_eq!(ta.distance(&tb), want, "{a:?} against {b:?}");
        }
    }
    let modulated = |mk: ModKind| {
        let set = StructOp::SetMod {
            key: "node".into(),
            kind: mk,
        };
        let t = voice(default_fragment(NodeKind::Vco));
        apply_struct_op(&t, &set).unwrap()
    };
    for a in ModKind::ALL {
        for b in ModKind::ALL.into_iter().filter(|b| *b != a) {
            let (ta, tb) = (modulated(a), modulated(b));
            let (ma, mb) = (ta.root.modulation().unwrap(), tb.root.modulation().unwrap());
            let want = 2.0 + (ma.size() as f64 - mb.size() as f64).abs();
            assert_eq!(ta.distance(&tb), want, "{a:?} against {b:?}");
        }
    }
    // A take is content: another recording is as far as one step.
    let take = |hz: f64| {
        let x: Vec<f32> = (0..64).map(|i| (i as f64 * hz).sin() as f32).collect();
        crate::take::Take::from_samples(&x, 48_000.0).unwrap()
    };
    let capture = |t| {
        let mut tree = over_saw(NodeKind::Capture);
        if let AudioNode::Capture { take, .. } = &mut tree.root {
            *take = t;
        }
        tree
    };
    assert_eq!(capture(take(0.1)).distance(&capture(take(0.2))), 1.0);
    assert_eq!(capture(take(0.1)).distance(&capture(take(0.1))), 0.0);
}

/// Between any two patches the distance is finite, never negative, and the
/// same both ways: 300 pairs of prior draws.
#[test]
fn distance_is_a_symmetric_finite_measure_on_any_pair() {
    let prior = PatchGrammarPrior::default();
    let mut rng = StdRng::seed_from_u64(0xD157);
    for _ in 0..300 {
        let (a, b) = (
            prior.sample_with_rng(&mut rng),
            prior.sample_with_rng(&mut rng),
        );
        let d = a.distance(&b);
        assert!(d.is_finite() && d >= 0.0, "{d}");
        assert_eq!(d, b.distance(&a));
    }
}

/// A hand-made trace that is not a patch is refused, and the refusal names
/// the site: an index past a structural categorical's last kind, and a
/// choice the trace does not hold (a knob, a kind, the leaf choice).
#[test]
fn a_trace_that_is_not_a_patch_names_the_site() {
    let refusal = |edit: &dyn Fn(&mut Trace)| {
        let mut t = over_saw(NodeKind::Filter).to_trace();
        edit(&mut t);
        PatchTree::from_trace(&t).unwrap_err().to_string()
    };
    let set = |t: &mut Trace, key: &str, site: &str, v: usize| {
        t.choices.get_mut(&addr!(key, site)).expect("a site").value = ChoiceValue::Usize(v);
    };
    assert!(refusal(&|t| set(t, "node", "op", 99)).contains("op kind 99 out of range at node"));
    assert!(
        refusal(&|t| set(t, "node/m", "mod", 99)).contains("mod kind 99 out of range at node/m")
    );
    assert!(
        refusal(&|t| set(t, "node/0", "src", 99)).contains("source kind 99 out of range at node/0")
    );
    // A selector past its options: an AUDIO IN's channel.
    let mut t = voice(default_fragment(NodeKind::AudioIn)).to_trace();
    set(&mut t, "node", "channel", 9);
    let why = PatchTree::from_trace(&t).unwrap_err().to_string();
    assert!(
        why.contains("node#channel = 9 is outside its 3-way categorical"),
        "{why}"
    );
    for gone in ["amp#attack", "node#op", "node#leaf"] {
        let (key, site) = gone.split_once('#').unwrap();
        let why = refusal(&|t| {
            t.choices.remove(&addr!(key, site));
        });
        assert!(why.contains(gone), "{gone}: {why}");
    }
}
