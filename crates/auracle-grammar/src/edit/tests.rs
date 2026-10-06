use super::*;
use crate::describe::{describe, KnobKind};
use crate::mutate::{default_fragment, NodeKind};
use crate::term::{AmpEnv, AudioNode, ModNode, Uid};
use crate::tests::draw;
use crate::PatchGrammarPrior;
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

/// Structural sites reject knob edits; unknown addresses error cleanly,
/// including one with no site at all.
#[test]
fn edits_reject_structure_and_unknowns() {
    let prior = PatchGrammarPrior::default();
    let mut rng = StdRng::seed_from_u64(12);
    let (tree, _) = draw(&prior, &mut rng);
    assert!(matches!(
        set_param(&tree, "node#leaf", ParamValue::Index(0)),
        Err(EditError::Structural(_))
    ));
    assert!(matches!(
        set_param(&tree, "nowhere#cut", ParamValue::Continuous(0.5)),
        Err(EditError::UnknownAddress(_))
    ));
    assert!(matches!(
        set_param(&tree, "node", ParamValue::Continuous(0.5)),
        Err(EditError::UnknownAddress(_))
    ));
}

/// **Every selector a hand turns stops at the last option the rack shows**,
/// and at the first: on every kind of module, each enum and octave selector
/// is set past its end and before its start, and the rack reads back the
/// last option and the first. The sets come from `NodeKind::ALL` and the
/// rack's own option lists, so a selector whose clamp disagrees with its
/// faceplate fails here by address, and the selector sites the rack shows
/// are exactly the ones the clamp knows.
#[test]
fn every_selector_stops_at_the_options_the_rack_shows() {
    let mut sites = std::collections::BTreeSet::new();
    for kind in NodeKind::ALL {
        let tree = voice(default_fragment(kind));
        for m in describe(&tree).modules {
            for k in m.knobs {
                let last = match &k.kind {
                    KnobKind::Enum { options } => options.len() - 1,
                    KnobKind::Octave => 4,
                    KnobKind::Continuous => continue,
                };
                sites.insert(split_addr(&k.addr).1.to_string());
                for (asked, want) in [(usize::MAX, last), (0, 0)] {
                    let set = set_param(&tree, &k.addr, ParamValue::Index(asked))
                        .unwrap_or_else(|e| panic!("{kind:?} {}: {e}", k.addr));
                    let shown = describe(&set)
                        .modules
                        .into_iter()
                        .flat_map(|m| m.knobs)
                        .find(|s| s.addr == k.addr)
                        .expect("the selector is still there")
                        .value;
                    assert_eq!(shown, want as f64, "{kind:?} {} set to {asked}", k.addr);
                }
            }
        }
    }
    // Every site the clamp knows is a selector on some module, and the rack
    // shows no selector the clamp does not know.
    let known: std::collections::BTreeSet<String> =
        SELECTORS.iter().map(|(s, _)| s.to_string()).collect();
    assert_eq!(sites, known);
}

/// A knob takes a value and a selector takes an index; each refuses the
/// other, rather than reading a continuous value as an index or the reverse.
#[test]
fn a_knob_and_a_selector_refuse_each_others_values() {
    let tree = voice(default_fragment(NodeKind::Vco));
    assert!(matches!(
        set_param(&tree, "node#det", ParamValue::Index(2)),
        Err(EditError::KindMismatch(a)) if a == "node#det"
    ));
    assert!(matches!(
        set_param(&tree, "node#wave", ParamValue::Continuous(0.5)),
        Err(EditError::KindMismatch(a)) if a == "node#wave"
    ));
}

/// A tree that does not decode (here a VCO pitched nine octaves up, past
/// the selector's five) cannot be knob-edited, and the refusal says why
/// rather than handing back a different patch.
#[test]
fn a_tree_that_does_not_decode_refuses_a_knob_and_says_why() {
    let tree = voice(AudioNode::Vco {
        uid: Uid::NEW,
        wave: crate::term::Waveform::Saw,
        octave: 9,
        detune: 0.5,
        mod_depth: 0.0,
        modulation: ModNode::None,
    });
    let refused = set_param(&tree, "amp#attack", ParamValue::Continuous(0.2));
    assert!(
        matches!(&refused, Err(EditError::Decode(why)) if why.contains("node#oct")),
        "{refused:?}"
    );
}
