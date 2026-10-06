use super::*;
use crate::phrase::PhraseSpec;
use crate::pipeline::{featurize, Features};
use crate::tests::{amp, vco};
use auracle_grammar::term::{AmpEnv, AudioNode, ModNode, NoiseColor, Uid, Waveform};
use auracle_grammar::PatchTree;

/// `mod_depth_mean` reads 2 for a modulator wrapped in one processor, and
/// it is not one of the unit-bounded coordinates — the pairing that made
/// every stored vote on a shaped patch get clamped to "unshaped" on load.
#[test]
fn a_shaped_modulator_has_depth_two_and_is_not_unit_bounded() {
    use auracle_grammar::term::{FilterKind, ModOp};
    let tree = PatchTree {
        amp: AmpEnv {
            attack: 0.1,
            decay: 0.3,
            sustain: 0.7,
            release: 0.3,
        },
        root: AudioNode::Filter {
            uid: Uid::NEW,
            kind: FilterKind::SvfLp,
            cutoff: 0.5,
            resonance: 0.2,
            mod_depth: 0.5,
            modulation: ModNode::Op {
                uid: Uid::NEW,
                kind: ModOp::Slew,
                p0: 0.4,
                p1: 0.4,
                input: Box::new(ModNode::Lfo {
                    uid: Uid::NEW,
                    wave: Waveform::Sine,
                    rate: 0.3,
                }),
            },
            input: Box::new(vco(Waveform::Saw).root),
        },
    };
    let f = struct_features(&tree);
    assert_eq!(f.mod_depth_mean, 2.0, "Op(Lfo) is a two-deep chain");
    assert!(
        !StructFeatures::UNIT_NAMES.contains(&"mod_depth_mean"),
        "a count-like mean must not be declared unit-bounded"
    );
    // And the bounded ones really are, on this shaped term too.
    for (name, v) in StructFeatures::UNIT_NAMES.iter().zip(f.unit_coordinates()) {
        assert!((0.0..=1.0).contains(&v), "{name} = {v}");
    }
}

/// The two exact collinearities φ must not contain, checked on the term
/// rather than assumed: `size` is the sum of every module count, and the
/// sources exceed the binary nodes by exactly one. Either one makes the
/// design matrix rank-deficient — an unidentified ridge for the sampler
/// to wander along, and per-feature weights the Styles tab would render
/// as if they meant something individually.
///
/// Wave 2B is where the second identity stops being about two nodes:
/// `Comp`, `Duck`, `Gate` and `Vocoder` each take two audio subterms, so
/// all six binary counts appear in it. The φ-side consequence is checked
/// in `phi_hides_every_binary_count_inside_a_family` below.
///
/// Wave 2C adds a **third** identity, over the modulation forest rather
/// than the audio tree — the leaves of a forest exceed its binary nodes by
/// its tree count — and it is asserted here alongside the other two. It
/// does not reach φ, for the reason spelled out in
/// [`crate::structural`]: its tree count is `filled_slots`, which φ only
/// carries inside the `mod_density` ratio, and the euclid sits on the
/// same side of the sum as the combiners rather than opposite them.
#[test]
fn phi_carries_no_exact_collinearity() {
    let names = Features::phi_names();
    // `n_delay` is here because wave 2A *renamed* it to `n_time`: the
    // column counts granulators now, and a stale name in φ is a Styles
    // tab row that says "delay" about something else.
    for gone in [
        "size",
        "depth",
        "n_mix",
        "n_ringmod",
        "n_delay",
        "n_comp",
        "n_duck",
        "n_gate",
        "n_vocoder",
    ] {
        assert!(!names.contains(&gone), "`{gone}` is back in φ");
    }
    let spec = PhraseSpec::default();
    for (name, tree) in auracle_grammar::presets() {
        let f = featurize(&tree, &spec).unwrap().features;
        let s = &f.structural;
        let sources = s.n_vco + s.n_supersaw + s.n_noise + s.n_wavetable + s.n_pluck + s.n_formant;
        let binaries = s.n_mix + s.n_ringmod + s.n_comp + s.n_duck + s.n_gate + s.n_vocoder;
        let sum = sources
            + binaries
            + s.n_filter
            + s.n_eq
            + s.n_fold
            + s.n_distortion
            + s.n_bitcrush
            + s.n_delay
            + s.n_granular
            + s.n_shift
            + s.n_chorus
            + s.n_phaser
            + s.n_flanger
            + s.n_tremolo
            + s.n_vibrato
            + s.n_reverb;
        assert_eq!(s.size, sum, "{name}: size is not the sum of the counts");
        // Every production is unary except the six that take two audio
        // inputs, so every tree is a forest of `sources` leaves joined by
        // `sources − 1` binary nodes. This is ONE equation, so exactly one
        // column has to leave φ — `n_mix`. The other five stay, each
        // inside a family that also counts something outside the identity,
        // which is what stops it coming back.
        assert_eq!(
            sources - binaries,
            1.0,
            "{name}: the collinearity this test guards is not what it says"
        );
        // The modulation forest's own identity. `mod_density` is
        // `filled/slots`, so the filled count has to be reconstructed
        // here rather than read off φ — which is exactly why the equation
        // is not available to a linear model.
        let slots = mod_slots(&tree);
        let filled = (s.mod_density * slots as f64).round();
        let mod_leaves = s.n_lfo + s.n_env + s.n_rand + s.n_steps + s.n_follow + s.n_euclid;
        let combiners = s.n_min + s.n_max + s.n_and + s.n_or + s.n_xor + s.n_switch;
        assert_eq!(
            mod_leaves - combiners,
            filled,
            "{name}: the modulation forest does not have one more leaf \
             per tree than it has binary nodes"
        );
        // …and neither side of it is separately visible in φ: the euclid
        // is summed *with* the combiners, not against them.
        assert!(
            s.n_mod_logic() >= s.n_euclid + combiners - 1e-9,
            "{name}: n_mod_logic stopped hiding the euclid with the \
             combiners, which is what keeps the identity out of φ"
        );
    }
}

/// How many modulation slots a tree has, counted the way
/// `struct_features` does — one per module that owns one, regardless of
/// how deep the chain hanging off it goes.
fn mod_slots(tree: &PatchTree) -> usize {
    // A slot's address is `<owner>/m#mod` and nothing deeper: the nodes
    // *inside* a chain live at `<owner>/m/0#mod` and below, and they are
    // not slots — which is the same distinction `count_mod` draws.
    auracle_grammar::describe(tree)
        .modules
        .iter()
        .flat_map(|m| &m.structural_addrs)
        .filter(|a| a.ends_with("/m#mod"))
        .count()
}

/// No **retained** φ coordinate isolates a binary count, so the identity
/// above cannot be reconstructed from what φ carries.
///
/// This is the check `n_dynamics` needs and the earlier families did not:
/// it is *exactly* `n_comp + n_duck + n_gate`, three of the six binary
/// terms, with no unary member diluting it. The argument that it is
/// nonetheless safe rests entirely on the other three terms being
/// unrecoverable — so that is what gets asserted, by constructing the one
/// tree that would expose a family with no unary member and checking each
/// family moves when something outside the identity is added to it.
#[test]
fn phi_hides_every_binary_count_inside_a_family() {
    use auracle_grammar::term::{DriveMode, FilterKind};
    let saw = || vco(Waveform::Saw).root;
    // n_drive must move for a fold, which is not a binary node — so
    // `n_drive` alone never reads back as `n_ringmod`.
    let folded = StructFeatures {
        n_fold: 1.0,
        ..Default::default()
    };
    assert!(folded.n_drive() > 0.0 && folded.n_ringmod == 0.0);
    // Same for the filter family and the vocoder.
    let tilted = StructFeatures {
        n_eq: 1.0,
        ..Default::default()
    };
    assert!(tilted.n_filter_family() > 0.0 && tilted.n_vocoder == 0.0);
    // `n_dynamics` has no such dilution, and does not need one: it
    // contributes three of the six binary terms and nothing in φ supplies
    // `n_mix`, `n_ringmod` or `n_vocoder` separately from a family that
    // also counts unary nodes.
    let dynamics = PatchTree {
        amp: amp(),
        root: AudioNode::Duck {
            uid: Uid::NEW,
            amount: 0.7,
            threshold: 0.4,
            release: 0.35,
            mod_depth: 0.0,
            modulation: ModNode::None,
            input: Box::new(AudioNode::Distortion {
                uid: Uid::NEW,
                drive: 0.4,
                tone: 0.5,
                mode: DriveMode::Soft,
                mod_depth: 0.0,
                modulation: ModNode::None,
                input: Box::new(saw()),
            }),
            key: Box::new(AudioNode::Filter {
                uid: Uid::NEW,
                kind: FilterKind::SvfLp,
                cutoff: 0.5,
                resonance: 0.2,
                mod_depth: 0.0,
                modulation: ModNode::None,
                input: Box::new(saw()),
            }),
        },
    };
    let s = struct_features(&dynamics);
    assert_eq!(s.n_dynamics(), 1.0);
    assert_eq!(s.size, 5.0, "the key branch was not counted");
    assert_eq!(s.n_vco, 2.0, "the key branch's source was not counted");
    // …and the identity holds on a tree whose binary node is a 2B one.
    assert_eq!(s.n_vco - s.n_duck, 1.0);
}

/// Structural features count exactly what's in the tree.
#[test]
fn struct_features_count_the_tree() {
    let tree = PatchTree {
        amp: amp(),
        root: AudioNode::Delay {
            uid: Uid::NEW,
            time: 0.5,
            feedback: 0.5,
            mix: 0.5,
            mod_depth: 0.0,
            modulation: ModNode::None,
            input: Box::new(AudioNode::Filter {
                uid: Uid::NEW,
                kind: auracle_grammar::term::FilterKind::Ladder,
                cutoff: 0.5,
                resonance: 0.5,
                mod_depth: 0.5,
                modulation: ModNode::Env {
                    uid: Uid::NEW,
                    attack: 0.2,
                    decay: 0.6,
                },
                input: Box::new(AudioNode::Mix {
                    uid: Uid::NEW,
                    balance: 0.5,
                    a: Box::new(vco(Waveform::Saw).root),
                    b: Box::new(AudioNode::Noise {
                        uid: Uid::NEW,
                        color: NoiseColor::Pink,
                    }),
                }),
            }),
        },
    };
    let f = struct_features(&tree);
    assert_eq!(f.n_delay, 1.0);
    assert_eq!(f.n_filter, 1.0);
    assert_eq!(f.n_mix, 1.0);
    assert_eq!(f.n_vco, 1.0);
    assert_eq!(f.n_noise, 1.0);
    assert_eq!(f.n_env, 1.0);
    assert_eq!(f.n_lfo, 0.0);
    assert_eq!(f.size, 5.0);
    assert_eq!(f.depth, 4.0);
    // Three slots — the delay, the filter, and the vco, whose slot reaches
    // pitch — with only the filter's filled. The mix and the noise have
    // none: two audio inputs and no parameter respectively.
    assert_eq!(f.mod_density, 1.0 / 3.0);
    // Families, not per-kind columns: the ladder is the only `n_drive`
    // candidate here and there is none, so the coordinate reads zero.
    assert_eq!(f.n_drive(), 0.0);
    assert_eq!(f.n_mod_fx(), 0.0);
    // The filter family is the filter alone; the time family the delay.
    assert_eq!(f.n_filter_family(), 1.0);
    assert_eq!(f.n_time(), 1.0);
    assert_eq!(f.to_vec().len(), StructFeatures::NAMES.len());
    // Shape. Levels are delay(1) · filter(1) · mix(1) · vco+noise(2), so
    // the tree is two wide at its widest; both sources sit four nodes from
    // the root, so it is perfectly balanced; the mix's `/1` is a bare
    // noise source, so nothing is sidechained; and the one filled slot is
    // on the filter, one step down a four-deep tree.
    assert_eq!(f.branch_width_max, 2.0);
    assert_eq!(f.chain_balance, 1.0);
    assert_eq!(f.frac_sidechained, 0.0);
    assert!((f.mod_at_source - 1.0 / 3.0).abs() < 1e-12);
}

/// The wave-3 shape coordinates: two patches with **identical counts** and
/// different routing must land on different φ.
///
/// This is WS-8 §4's acceptance test in one assertion. `filter(mix(a, b))`
/// filters the sum; `mix(filter(a), b)` filters one layer and leaves the
/// other dry. One filter, two VCOs, one mixer either way — so under the
/// twenty-three columns that shipped before this wave the two patches were
/// *the same point*, and no amount of voting could have taught the model
/// which one the user meant.
#[test]
fn shape_separates_serial_from_parallel() {
    let mix = |a: AudioNode, b: AudioNode| AudioNode::Mix {
        uid: Uid::NEW,
        balance: 0.5,
        a: Box::new(a),
        b: Box::new(b),
    };
    let filter = |input: AudioNode| AudioNode::Filter {
        uid: Uid::NEW,
        kind: auracle_grammar::term::FilterKind::SvfLp,
        cutoff: 0.5,
        resonance: 0.2,
        mod_depth: 0.0,
        modulation: ModNode::None,
        input: Box::new(input),
    };
    let src = || vco(Waveform::Saw).root;

    let sum_then_filter = struct_features(&PatchTree {
        amp: amp(),
        root: filter(mix(src(), src())),
    });
    let filter_one_layer = struct_features(&PatchTree {
        amp: amp(),
        root: mix(filter(src()), src()),
    });

    // Every count agrees, which is the point.
    for (a, b) in [
        (sum_then_filter.n_vco, filter_one_layer.n_vco),
        (sum_then_filter.n_filter, filter_one_layer.n_filter),
        (sum_then_filter.n_mix, filter_one_layer.n_mix),
        (sum_then_filter.size, filter_one_layer.size),
        (sum_then_filter.depth, filter_one_layer.depth),
    ] {
        assert_eq!(a, b);
    }
    // Both are two wide, which is why width is not the coordinate that
    // does the work here (and, per the module doc, is not a φ coordinate
    // at all). Balance is: sources at three and three against three and
    // two.
    assert_eq!(sum_then_filter.branch_width_max, 2.0);
    assert_eq!(filter_one_layer.branch_width_max, 2.0);
    assert_eq!(sum_then_filter.chain_balance, 1.0);
    assert!((filter_one_layer.chain_balance - 5.0 / 6.0).abs() < 1e-12);
    assert_ne!(sum_then_filter.to_vec(), filter_one_layer.to_vec());

    // A serial chain is one node wide however long it gets — the property
    // the proposal tilt reads to decide whether to offer a binary at all.
    let serial = struct_features(&PatchTree {
        amp: amp(),
        root: filter(filter(filter(src()))),
    });
    assert_eq!(serial.branch_width_max, 1.0);
    assert_eq!(serial.chain_balance, 1.0);

    // `frac_sidechained` asks whether the second input is a chain of its
    // own. Bare source on the right: no. A filter on the right: yes.
    assert_eq!(
        struct_features(&PatchTree {
            amp: amp(),
            root: mix(src(), src()),
        })
        .frac_sidechained,
        0.0
    );
    assert_eq!(
        struct_features(&PatchTree {
            amp: amp(),
            root: mix(src(), filter(src())),
        })
        .frac_sidechained,
        1.0
    );
}
