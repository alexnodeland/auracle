use super::*;
use crate::tests::{pool_ids, too_deep};
use auracle_grammar::{PatchGrammarPrior, PatchTree};
use rand::rngs::StdRng;
use rand::SeedableRng;

/// An engine with a standardizer (a six-patch pool, filled), and its best
/// patch: what a figure measures `along` a control needs.
fn engine_with_patch() -> (WasmEngine, String) {
    let mut engine = WasmEngine::new(3, 6);
    while engine.fill_step(3) > 0 {}
    let tree = engine.tree_json_of(pool_ids(&engine)[0]);
    (engine, tree)
}

/// The lesson's engine: it reads only the phrase, so no pool, and a bright
/// preset with room for one more module (as every preset has).
fn lesson() -> (WasmEngine, String) {
    let (_, tree) = auracle_grammar::presets()
        .into_iter()
        .find(|(n, _)| *n == "Folded Lead")
        .expect("preset exists");
    (WasmEngine::new(3, 1), serde_json::to_string(&tree).unwrap())
}

fn json_of(r: &ExplainRender) -> serde_json::Value {
    serde_json::from_str(&r.json()).unwrap()
}

/// The lesson's lowpass, as `insert_at_output` is asked to place it.
fn lowpass() -> AudioNode {
    AudioNode::Filter {
        uid: Uid::NEW,
        kind: FilterKind::SvfLp,
        cutoff: 0.5,
        resonance: LESSON_RESONANCE,
        mod_depth: 0.0,
        input: Box::new(AudioNode::Silence { uid: Uid::NEW }),
        modulation: ModNode::None,
    }
}

/// A patch of `node` under filters until no module more fits
/// (`insert_at_output` refuses one), the compiler still able to build it.
fn at_the_ceiling(node: AudioNode) -> PatchTree {
    let mut tree = auracle_grammar::presets()[0].1.clone();
    tree.root = node;
    while insert_at_output(&tree, lowpass()).is_some() {
        tree.root = AudioNode::Filter {
            uid: Uid::NEW,
            kind: FilterKind::SvfLp,
            cutoff: 0.9,
            resonance: 0.1,
            mod_depth: 0.0,
            input: Box::new(tree.root),
            modulation: ModNode::None,
        };
    }
    tree
}

/// A figure's render is the performed state's: its portrait is the
/// portrait of that state's own featurization, and `along` is the same
/// number as a wiring's `position` on that control (`perform_wire`'s).
/// With no control, or an index past the palette, there is no `along`.
#[test]
fn a_figure_measures_the_performed_state() {
    let (engine, tree) = engine_with_patch();
    let reply: serde_json::Value =
        serde_json::from_str(&engine.explain_render(&tree, "[]", Some(0))).unwrap();
    let t: PatchTree = serde_json::from_str(&tree).unwrap();
    let v = featurize(&t, &engine.engine.cfg.phrase).unwrap();
    let want = serde_json::to_value(explain::portrait(&v.render, &v.features.audio)).unwrap();
    assert_eq!(reply["portrait"], want);
    assert_eq!(
        reply["portrait"]["bands"].as_array().unwrap().len(),
        explain::BANDS
    );
    let wired: serde_json::Value =
        serde_json::from_str(&engine.perform_wire(&tree, "[]", Some("[0]".into()))).unwrap();
    assert_eq!(wired["wiring"][0]["index"], 0);
    let position = wired["wiring"][0]["position"].as_f64().unwrap();
    assert!(
        (reply["along"].as_f64().unwrap() - position).abs() < 1e-9,
        "along {} against the wiring's position {position}",
        reply["along"]
    );
    for k in [None, Some(PALETTE.len() as u32)] {
        let none: serde_json::Value =
            serde_json::from_str(&engine.explain_render(&tree, "[]", k)).unwrap();
        assert!(none["along"].is_null(), "{k:?}: no control, no `along`");
    }
}

/// A figure of a state that does not render says why, as the lesson does:
/// `no_tree` for text that is not a patch, `silent` for one that plays
/// nothing, `vet` for any other refusal (one the compiler cannot build).
#[test]
fn a_figure_that_does_not_render_says_why() {
    let (engine, _) = lesson();
    let mut silent = auracle_grammar::presets()[0].1.clone();
    silent.root = AudioNode::Silence { uid: Uid::NEW };
    let silent = serde_json::to_string(&silent).unwrap();
    let deep = serde_json::to_string(&too_deep()).unwrap();
    for (tree, why) in [("{", "no_tree"), (&silent, "silent"), (&deep, "vet")] {
        let reply: serde_json::Value =
            serde_json::from_str(&engine.explain_render(tree, "[]", Some(0))).unwrap();
        assert_eq!(reply["error"], why, "{reply}");
    }
}

/// The lesson's filter cuts what is above its cutoff, on the sound in
/// hand: a lower cutoff leaves the top bands lower against the lows, the
/// response it reports is the grammar's lowpass at that cutoff, and the
/// filter goes inside the patch. With no cutoff it is the sound in hand as
/// it is: the same render a figure measures, and the same audition.
#[test]
fn the_lesson_filter_darkens_the_sound_in_hand() {
    let (engine, tree) = lesson();
    let mut open = engine.lesson_filter(&tree, "[]", Some(0.95));
    let mut shut = engine.lesson_filter(&tree, "[]", Some(0.45));
    let (a, b) = (json_of(&open), json_of(&shut));
    assert!(a["error"].is_null() && b["error"].is_null(), "{a} {b}");
    assert_eq!(b["placement"], "inside");
    assert!((b["cutoff_hz"].as_f64().unwrap() - cutoff_hz(0.45)).abs() < 1e-9);
    let top = |j: &serde_json::Value| -> f64 {
        let bands = j["portrait"]["bands"].as_array().unwrap();
        bands[34..].iter().map(|d| d.as_f64().unwrap()).sum::<f64>() / 6.0
    };
    assert!(top(&b) < top(&a) - 6.0, "{} vs {}", top(&b), top(&a));
    let sr = engine.engine.cfg.phrase.sample_rate;
    let want = explain::response_bands(
        &lowpass_response(0.45, LESSON_RESONANCE, sr, RESPONSE_LEN),
        sr,
    );
    let got: Vec<f64> = serde_json::from_value(b["response"].clone()).unwrap();
    assert_eq!(got, want);
    assert!(!open.take_samples().is_empty());
    assert!(!shut.take_samples().is_empty());
    let mut plain = engine.lesson_filter(&tree, "[]", None);
    let p = json_of(&plain);
    let fig: serde_json::Value =
        serde_json::from_str(&engine.explain_render(&tree, "[]", None)).unwrap();
    assert!(p["cutoff"].is_null() && p["response"].is_null());
    assert!(p["placement"].is_null());
    assert_eq!(p["portrait"], fig["portrait"]);
    assert!(!plain.take_samples().is_empty());
}

/// The lesson's filter is a Butterworth lowpass (`LESSON_RESONANCE`): flat
/// below its cutoff, about 3 dB down at it, and falling fast above, so "the
/// cutoff is where the cutting starts" is true of the curve it draws.
#[test]
fn the_lesson_filter_is_a_butterworth() {
    let sr = 44_100.0;
    let edges = explain::band_edges_hz();
    let at = |hz: f64| {
        (0..explain::BANDS)
            .find(|&k| edges[k] <= hz && hz < edges[k + 1])
            .unwrap()
    };
    for cutoff in [0.45, 0.5, 0.6] {
        let response = explain::response_bands(
            &lowpass_response(cutoff, LESSON_RESONANCE, sr, RESPONSE_LEN),
            sr,
        );
        let fc = cutoff_hz(cutoff);
        assert!(response[at(fc / 8.0)].abs() < 0.5, "{cutoff}: {response:?}");
        assert!(
            (response[at(fc)] + 3.0).abs() < 1.5,
            "{cutoff}: {response:?}"
        );
        assert!(response[at(fc * 4.0)] < -20.0, "{cutoff}: {response:?}");
    }
}

/// A patch with no room for one more module still gets its lesson: the
/// filter follows the whole voice (`placement: "after"`), and still
/// darkens it, as it would inside. About one prior draw in nine is at the
/// ceilings; they are drawn, not rendered, until one is.
#[test]
fn a_patch_with_no_room_gets_the_filter_after_it() {
    let (engine, _) = lesson();
    let mut rng = StdRng::seed_from_u64(20_260_928);
    let (plain, f, mut r) = (0..200)
        .map(|_| PatchGrammarPrior::default().sample_with_rng(&mut rng))
        .filter(|t| insert_at_output(t, lowpass()).is_none())
        .find_map(|t| {
            let full = serde_json::to_string(&t).unwrap();
            let r = engine.lesson_filter(&full, "[]", Some(0.4));
            let f = json_of(&r);
            let plain = json_of(&engine.lesson_filter(&full, "[]", None));
            (f["error"].is_null() && plain["error"].is_null()).then_some((plain, f, r))
        })
        .expect("a prior draw at the size ceilings that renders");
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

/// A lesson that does not render says why, inside the patch or after it,
/// and still carries the cutoff it was asked at (one that is not a number
/// is the middle of the knob): `no_tree` for text that is not a patch,
/// `silent` for a sound that plays nothing, `vet` for a knob out of its
/// range or a patch the compiler cannot build.
#[test]
fn a_lesson_that_does_not_render_says_why() {
    let (engine, _) = lesson();
    let quiet = || AudioNode::Silence { uid: Uid::NEW };
    let mut roomy = auracle_grammar::presets()[0].1.clone();
    roomy.root = quiet();
    let mut wild = at_the_ceiling(auracle_grammar::presets()[0].1.root.clone());
    wild.amp.sustain = 7.0;
    let text = |t: &PatchTree| serde_json::to_string(t).unwrap();
    for (tree, cutoff, why) in [
        ("{".to_string(), Some(0.4), "no_tree"),
        (text(&roomy), None, "silent"),
        (text(&roomy), Some(0.4), "silent"),
        (text(&at_the_ceiling(quiet())), Some(0.4), "silent"),
        (text(&wild), Some(f64::NAN), "vet"),
        (text(&too_deep()), Some(0.4), "vet"),
    ] {
        let mut r = engine.lesson_filter(&tree, "[]", cutoff);
        let j = json_of(&r);
        assert_eq!(j["error"], why, "{cutoff:?}: {j}");
        assert!(j.get("portrait").is_none() && r.take_samples().is_empty());
        let asked = cutoff.map(|c| if c.is_finite() { c } else { 0.5 });
        assert_eq!(j["cutoff"].as_f64(), asked, "{j}");
    }
}
