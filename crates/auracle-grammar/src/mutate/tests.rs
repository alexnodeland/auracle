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
    use mutate::NodeKind;
    let refusal = serde_json::from_str::<NodeKind>("\"no such kind\"")
        .expect_err("an unknown name is refused")
        .to_string();
    let (_, listed) = refusal
        .split_once("expected one of")
        .unwrap_or_else(|| panic!("serde's refusal changed its wording: {refusal}"));
    let declared: Vec<&str> = listed.split('`').skip(1).step_by(2).collect();
    let all: Vec<String> = NodeKind::ALL
        .iter()
        .map(|k| {
            serde_json::to_string(k)
                .unwrap()
                .trim_matches('"')
                .to_string()
        })
        .collect();
    assert_eq!(
        all, declared,
        "NodeKind::ALL is not every kind, once, in order"
    );
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
