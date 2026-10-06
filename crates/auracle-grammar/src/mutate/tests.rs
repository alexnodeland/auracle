use super::*;
use crate::tests::{captured, patch, sine_vco, tone, SR};
use crate::{mutate, term, Take};

/// **`NodeKind::ALL` names every kind once, in declaration order.**
///
/// `ALL` is what the edit gate sweeps, so a kind missing from it is a kind
/// no gate ever places. The compile-time check beside `ALL` sees every kind
/// declared before its last entry; this sees the rest. serde's derive
/// refuses an unknown name by listing every variant it knows, in
/// declaration order, so that list is the enum read without a second copy
/// to keep.
#[test]
fn node_kind_all_names_every_kind() {
    let all: Vec<String> = NodeKind::ALL.iter().map(wire_name).collect();
    assert_eq!(
        all,
        declared::<NodeKind>(),
        "NodeKind::ALL is not every kind, once, in order"
    );
}

/// The same for `ModKind::ALL`, which the edit gate and the finite-prior gate
/// sweep: it left out `Steps`, the last kind declared, so neither gate ever
/// set a step sequence by hand.
#[test]
fn mod_kind_all_names_every_kind() {
    let all: Vec<String> = ModKind::ALL.iter().map(wire_name).collect();
    assert_eq!(
        all,
        declared::<ModKind>(),
        "ModKind::ALL is not every kind, once, in order"
    );
}

/// A kind's name on the wire.
fn wire_name<T: serde::Serialize>(k: &T) -> String {
    serde_json::to_string(k)
        .unwrap()
        .trim_matches('"')
        .to_string()
}

/// Every name serde accepts for `T`, in declaration order, read off the
/// refusal of a name it does not.
fn declared<T: serde::de::DeserializeOwned + std::fmt::Debug>() -> Vec<String> {
    let refusal = serde_json::from_str::<T>("\"no such kind\"")
        .expect_err("an unknown name is refused")
        .to_string();
    let (_, listed) = refusal
        .split_once("expected one of")
        .unwrap_or_else(|| panic!("serde's refusal changed its wording: {refusal}"));
    listed
        .split('`')
        .skip(1)
        .step_by(2)
        .map(String::from)
        .collect()
}

/// `NodeKind::Silence` is spelled `silence` on the wire, which is also
/// the `kind` the rack reports for a hole.
#[test]
fn the_silence_kind_round_trips_as_silence() {
    use mutate::NodeKind;
    let s = serde_json::to_string(&NodeKind::Silence).unwrap();
    assert_eq!(s, "\"silence\"");
    let back: NodeKind = serde_json::from_str(&s).unwrap();
    assert_eq!(back, NodeKind::Silence);
    assert!(NodeKind::Silence.is_source());
    assert!(NodeKind::ALL.contains(&NodeKind::Silence));
}

/// `SetTake` installs a recording on a CAPTURE, clears it with an empty
/// one, and refuses anywhere else and an unreadable take.
#[test]
fn set_take_installs_and_refuses() {
    use mutate::StructOp;
    let tree = patch(term::AudioNode::Mix {
        uid: Uid::NEW,
        balance: 0.5,
        a: Box::new(captured(term::CaptureMode::Once, Take::empty())),
        b: Box::new(sine_vco()),
    });
    let take = Take::from_samples(&tone(800, 440.0), SR).unwrap();
    let op = |key: &str, take: Take| StructOp::SetTake {
        key: key.into(),
        take,
    };
    // Through its JSON, as the panel would send it.
    let json = serde_json::to_string(&op("node/0", take.clone())).unwrap();
    let parsed: StructOp = serde_json::from_str(&json).unwrap();
    let set = mutate::apply_struct_op(&tree, &parsed).unwrap();
    assert!(set.has_takes());
    let cleared = mutate::apply_struct_op(&set, &op("node/0", Take::empty())).unwrap();
    assert!(!cleared.has_takes());
    assert!(mutate::apply_struct_op(&tree, &op("node/1", take.clone())).is_err());
    let unreadable: Take = serde_json::from_str("{\"format\":\"nope\"}").unwrap();
    assert!(mutate::apply_struct_op(&set, &op("node/0", unreadable.clone())).is_err());
    // So is a fragment carrying one, by either splice.
    let fragment = captured(term::CaptureMode::Hold, unreadable);
    for op in [
        StructOp::ReplaceTree {
            key: "node/1".into(),
            node: fragment.clone(),
        },
        StructOp::InsertTree {
            key: "node/1".into(),
            node: fragment.clone(),
        },
    ] {
        let refused = mutate::apply_struct_op(&tree, &op);
        assert!(
            matches!(&refused, Err(StructError::Invalid(why)) if why.contains("couldn’t be read")),
            "{refused:?}"
        );
    }
}

/// A two-input chain to edit: a mix of a filtered saw and a sine.
fn mixed() -> PatchTree {
    patch(AudioNode::Mix {
        uid: Uid::NEW,
        balance: 0.5,
        a: Box::new(graft(default_fragment(NodeKind::Filter), saw_vco(0)).unwrap()),
        b: Box::new(sine_vco()),
    })
}

/// **Every edit refuses a key that names no module, and says so**: a key
/// that is not a key, one past a module's last input (a mix's `/2`, a
/// ducker's `/2`, a filter's `/1`) and one below a source. The refusal is
/// `NoSuchNode`, the toast's "that module is not in the patch", never an
/// edit somewhere else.
#[test]
fn every_edit_refuses_a_key_that_names_no_module() {
    let ducked = patch(graft(default_fragment(NodeKind::Duck), sine_vco()).unwrap());
    let take = Take::from_samples(&tone(100, 330.0), SR).unwrap();
    let ops = |key: &str| {
        let key = key.to_string();
        vec![
            StructOp::Replace {
                key: key.clone(),
                kind: NodeKind::Filter,
            },
            StructOp::Insert {
                key: key.clone(),
                kind: NodeKind::Filter,
            },
            StructOp::Delete { key: key.clone() },
            StructOp::SetMod {
                key: key.clone(),
                kind: ModKind::Lfo,
            },
            StructOp::SwapMix { key: key.clone() },
            StructOp::ReplaceTree {
                key: key.clone(),
                node: sine_vco(),
            },
            StructOp::InsertTree {
                key: key.clone(),
                node: default_fragment(NodeKind::Filter),
            },
            StructOp::SetModTree {
                key: key.clone(),
                m: default_steps(),
            },
            StructOp::SetTake {
                key,
                take: take.clone(),
            },
        ]
    };
    for (tree, key) in [
        (&mixed(), "nowhere"),
        (&mixed(), "node/2"),
        (&mixed(), "node/0/1"),
        (&mixed(), "node/1/0"),
        (&mixed(), "node/0/0/0/1"),
        (&ducked, "node/2"),
    ] {
        for op in ops(key) {
            let refused = mutate::apply_struct_op(tree, &op);
            assert!(
                matches!(&refused, Err(StructError::NoSuchNode(k)) if k == key),
                "{op:?}: {refused:?}"
            );
            assert_eq!(
                refused.unwrap_err().to_string(),
                "that module is not in the patch"
            );
        }
    }
}

/// **Insert and Delete undo each other**, for every kind a hand can insert:
/// inserting a module over a chain and deleting it again gives the chain
/// back, because a delete keeps the branch you hear (a mix's or ring
/// mod's first input, a dynamics module's or vocoder's signal, the branch a
/// TRACK plays, the chain a CAPTURE records).
///
/// At the root and under a one-input module; under a two-input one a delete
/// takes the whole branch (`a_delete_under_a_binary_takes_the_branch`).
#[test]
fn an_insert_then_a_delete_gives_the_patch_back() {
    let tree = patch(graft(default_fragment(NodeKind::Reverb), mixed().root).unwrap());
    for kind in NodeKind::ALL.into_iter().filter(|k| !k.is_source()) {
        for key in ["node", "node/0"] {
            let op = StructOp::Insert {
                key: key.into(),
                kind,
            };
            let inserted = mutate::apply_struct_op(&tree, &op)
                .unwrap_or_else(|e| panic!("{kind:?} at {key}: {e}"));
            let back = mutate::apply_struct_op(&inserted, &StructOp::Delete { key: key.into() })
                .unwrap_or_else(|e| panic!("delete {kind:?} at {key}: {e}"));
            assert_eq!(back, tree, "{kind:?} at {key}");
        }
    }
}

/// Deleting one input of a two-input module takes that whole branch and
/// leaves the other in the module's place (pulling the key out of a ducker
/// leaves the pad), whichever of the two is named, for every kind the rack
/// draws with two inputs; a third is refused, not read as the second.
#[test]
fn a_delete_under_a_binary_takes_the_branch() {
    let over_saw =
        |kind| patch(graft(default_fragment(kind), saw_vco(0)).unwrap_or_else(|_| saw_vco(0)));
    let mut binaries = Vec::new();
    for kind in NodeKind::ALL {
        let tree = over_saw(kind);
        let [a, b] = tree.root.children()[..] else {
            continue;
        };
        binaries.push(kind);
        let (a, b) = (a.clone(), b.clone());
        let del = |key: &str| mutate::apply_struct_op(&tree, &StructOp::Delete { key: key.into() });
        assert_eq!(del("node/0").unwrap().root, b, "{kind:?}");
        assert_eq!(del("node/1").unwrap().root, a, "{kind:?}");
        assert!(
            matches!(del("node/2"), Err(StructError::NoSuchNode(_))),
            "{kind:?}"
        );
    }
    // Every kind the rack draws with two audio inputs, and only those.
    let two_sockets: Vec<NodeKind> = NodeKind::ALL
        .into_iter()
        .filter(|&kind| {
            let rack = crate::describe::describe(&over_saw(kind));
            let inputs = rack
                .wires
                .iter()
                .filter(|w| w.to == "node" && w.kind == "audio");
            inputs.count() == 2
        })
        .collect();
    assert_eq!(binaries, two_sockets);
}

/// Swapping the inputs of a module that has one is refused, and says why.
#[test]
fn swapping_a_one_input_module_is_refused() {
    let refused = mutate::apply_struct_op(
        &mixed(),
        &StructOp::SwapMix {
            key: "node/0".into(),
        },
    );
    assert_eq!(
        refused.unwrap_err().to_string(),
        "this module has only one input, so there is nothing to swap"
    );
}

/// A fragment that is a source has no input for the chain below it, so
/// splicing one in is refused, and says why, rather than dropping the chain.
#[test]
fn a_source_cannot_be_spliced_into_a_wire() {
    let refused = mutate::apply_struct_op(
        &mixed(),
        &StructOp::InsertTree {
            key: "node/0".into(),
            node: sine_vco(),
        },
    );
    assert_eq!(
        refused.unwrap_err().to_string(),
        "a source has no input to splice into"
    );
}
