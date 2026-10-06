use super::*;

fn engine_with_patch() -> (WasmEngine, String) {
    let mut engine = WasmEngine::new(3, 6);
    while engine.fill_step(3) > 0 {}
    let id = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked()).unwrap()[0]["id"]
        .as_u64()
        .unwrap() as u32;
    let tree = engine.tree_json_of(id);
    (engine, tree)
}

/// A figure's render is the performed state's: its portrait is the
/// portrait of that state's own featurization, and `along` is where it
/// measures on the control, as a wiring's `position` is computed.
#[test]
fn a_figure_measures_the_performed_state() {
    let (engine, tree) = engine_with_patch();
    let reply: serde_json::Value =
        serde_json::from_str(&engine.explain_render(&tree, "[]", Some(0))).unwrap();
    let t: auracle_grammar::PatchTree = serde_json::from_str(&tree).unwrap();
    let v = featurize(&t, &engine.engine.cfg.phrase).unwrap();
    let want = serde_json::to_value(explain::portrait(&v.render, &v.features.audio)).unwrap();
    assert_eq!(reply["portrait"], want);
    let names: Vec<String> = AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect();
    let z = standardized_audio(&v.features, engine.engine.standardizer().unwrap());
    let along: f64 = direction(&PALETTE[0], &names)
        .iter()
        .zip(&z)
        .map(|(a, b)| a * b)
        .sum();
    assert!((reply["along"].as_f64().unwrap() - along).abs() < 1e-12);
    assert_eq!(
        reply["portrait"]["bands"].as_array().unwrap().len(),
        explain::BANDS
    );
    let none: serde_json::Value =
        serde_json::from_str(&engine.explain_render(&tree, "[]", None)).unwrap();
    assert!(none["along"].is_null());
    let bad: serde_json::Value =
        serde_json::from_str(&engine.explain_render("{", "[]", Some(0))).unwrap();
    assert_eq!(bad["error"], "no_tree");
}

/// The lesson's filter cuts what is above its cutoff, on the sound in
/// hand: a lower cutoff leaves the top bands lower against the lows, and
/// its response is the grammar's lowpass, a Butterworth.
#[test]
fn the_lesson_filter_darkens_the_sound_in_hand() {
    let (engine, tree) = engine_with_patch();
    let mut open = engine.lesson_filter(&tree, "[]", Some(0.95));
    let mut shut = engine.lesson_filter(&tree, "[]", Some(0.45));
    let (a, b): (serde_json::Value, serde_json::Value) = (
        serde_json::from_str(&open.json()).unwrap(),
        serde_json::from_str(&shut.json()).unwrap(),
    );
    assert!(a["error"].is_null() && b["error"].is_null(), "{a} {b}");
    assert!((b["cutoff_hz"].as_f64().unwrap() - cutoff_hz(0.45)).abs() < 1e-9);
    let top = |j: &serde_json::Value| -> f64 {
        let bands = j["portrait"]["bands"].as_array().unwrap();
        bands[34..].iter().map(|d| d.as_f64().unwrap()).sum::<f64>() / 6.0
    };
    assert!(top(&b) < top(&a) - 6.0, "{} vs {}", top(&b), top(&a));
    let want = explain::response_bands(
        &lowpass_response(0.45, LESSON_RESONANCE, 44_100.0, RESPONSE_LEN),
        44_100.0,
    );
    let got: Vec<f64> = b["response"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d.as_f64().unwrap())
        .collect();
    assert_eq!(got, want);
    // Butterworth: flat below the cutoff, about 3 dB down at it.
    let edges = explain::band_edges_hz();
    let at = |hz: f64| {
        (0..explain::BANDS)
            .find(|&k| edges[k] <= hz && hz < edges[k + 1])
            .unwrap()
    };
    let fc = cutoff_hz(0.45);
    assert!(want[at(fc / 8.0)].abs() < 0.5, "{want:?}");
    assert!((want[at(fc)] + 3.0).abs() < 1.5, "{want:?}");
    assert!(want[at(fc * 4.0)] < -20.0, "{want:?}");
    assert!(!open.take_samples().is_empty());
    assert!(!shut.take_samples().is_empty());
    // With no filter, it is the sound in hand as it is: the same render
    // a figure measures, and the same audition.
    let mut plain = engine.lesson_filter(&tree, "[]", None);
    let p: serde_json::Value = serde_json::from_str(&plain.json()).unwrap();
    let fig: serde_json::Value =
        serde_json::from_str(&engine.explain_render(&tree, "[]", None)).unwrap();
    assert!(p["cutoff"].is_null() && p["response"].is_null());
    assert!(p["placement"].is_null());
    assert_eq!(p["portrait"], fig["portrait"]);
    assert!(!plain.take_samples().is_empty());
    assert_eq!(b["placement"], "inside");
}

/// A patch with no room for one more module still gets its lesson: the
/// filter follows the whole voice (`placement: "after"`), and still
/// darkens it, as it would inside.
#[test]
fn a_patch_with_no_room_gets_the_filter_after_it() {
    let mut engine = WasmEngine::new(20_260_928, 60);
    while engine.fill_step(8) > 0 {}
    let ids: Vec<u32> = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked())
        .unwrap()
        .iter()
        .map(|r| r["id"].as_u64().unwrap() as u32)
        .collect();
    let full = ids
        .iter()
        .map(|&id| engine.tree_json_of(id))
        .find(|t| {
            let tree: auracle_grammar::PatchTree = serde_json::from_str(t).unwrap();
            let probe = AudioNode::Filter {
                uid: Uid::NEW,
                kind: FilterKind::SvfLp,
                cutoff: 0.5,
                resonance: LESSON_RESONANCE,
                mod_depth: 0.0,
                input: Box::new(AudioNode::Silence { uid: Uid::NEW }),
                modulation: ModNode::None,
            };
            insert_at_output(&tree, probe).is_none()
        })
        .expect("a pool of 60 holds a patch at the size ceilings");
    let plain: serde_json::Value =
        serde_json::from_str(&engine.lesson_filter(&full, "[]", None).json()).unwrap();
    let mut r = engine.lesson_filter(&full, "[]", Some(0.4));
    let f: serde_json::Value = serde_json::from_str(&r.json()).unwrap();
    assert!(f["error"].is_null(), "{f}");
    assert_eq!(f["placement"], "after");
    assert!(!r.take_samples().is_empty());
    let centre = |j: &serde_json::Value| j["portrait"]["facts"]["centroid_hz"].as_f64().unwrap();
    assert!(
        centre(&f) < centre(&plain),
        "{} vs {}",
        centre(&f),
        centre(&plain)
    );
}
