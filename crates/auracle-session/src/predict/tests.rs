use super::*;
use crate::perform::{structural_addrs, CONTROLS, MAX_TRAVEL};
use crate::testkit::fast;
use auracle_features::{featurize_memo, Features};
use auracle_grammar::edit::{set_param, ParamValue};
use auracle_grammar::term::{AudioNode, ModNode, Uid};
use auracle_grammar::{preset_bank, PatchGrammarPrior};
use auracle_taste::Standardizer;
use std::sync::Arc;

fn preset(name: &str) -> PatchTree {
    preset_bank()
        .into_iter()
        .find(|p| p.name == name)
        .expect("a preset")
        .tree
}

/// Acid Line (a ladder filter swept by an envelope, over a saw) and its live
/// knobs.
fn acid() -> (PatchTree, Vec<(String, f64)>) {
    let t = preset("Acid Line");
    let knobs = live_knobs(&t, fast().phrase.sample_rate);
    (t, knobs)
}

fn names() -> Vec<String> {
    AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect()
}

/// A column over the audio coordinates with `at` set by name.
fn col(at: &[(&str, f64)]) -> Vec<f64> {
    AudioFeatures::NAMES
        .iter()
        .map(|n| {
            let bare = n.split(':').next().unwrap_or(n);
            at.iter().find(|(a, _)| *a == bare).map_or(0.0, |(_, v)| *v)
        })
        .collect()
}

/// **A shape is the structure without the knob values.** Every continuous
/// knob of Acid Line moved, it is the same shape, so a bred child that only
/// walked knobs borrows its parent's wiring; a selector turned (the saw's
/// wave) or another patch is another shape. The text is pinned: it is kept
/// beside wirings in the page's storage and in the shipped file.
#[test]
fn a_shape_is_the_structure_without_the_knob_values() {
    let (t, knobs) = acid();
    let shape = shape_of(&t);
    assert_eq!(shape, "cb39ae0deccbe248");
    let mut moved = t.clone();
    for (a, v) in &knobs {
        moved = set_param(&moved, a, ParamValue::Continuous((v + 0.3) % 1.0)).expect("a knob");
    }
    assert_ne!(moved, t);
    assert_eq!(shape_of(&moved), shape);
    let wave = structural_addrs(&t)
        .into_iter()
        .find(|a| a.ends_with("#wave"))
        .expect("the saw's wave");
    let square = set_param(&t, &wave, ParamValue::Index(3)).expect("a wave");
    assert_ne!(shape_of(&square), shape);
    assert_ne!(shape_of(&preset("Reese")), shape);
}

/// **A knob is keyed by its module, its target and its range.** On Acid
/// Line the filter's cutoff is a filter's `cut` in the audio path, and the
/// envelope's decay drives the filter; each key drops one thing, finest
/// first, down to the site. The third of the range is where the value falls
/// in thirds, the top included in the last; a knob the rack does not show is
/// known by its site.
#[test]
fn a_knob_is_keyed_by_its_module_its_target_and_its_range() {
    let (t, _) = acid();
    let at = |addr: &str, v: f64| knob_keys(&t, &[(addr.to_string(), v)]).remove(0);
    assert_eq!(
        at("node#cut", 0.36),
        [
            "filter#cut>@1".to_string(),
            "filter#cut>".into(),
            "filter#cut".into(),
            "cut".into()
        ]
    );
    assert_eq!(
        at("node/m#dec", 0.45),
        [
            "modenv#dec>filter@1".to_string(),
            "modenv#dec>filter".into(),
            "modenv#dec".into(),
            "dec".into()
        ]
    );
    let third = |v: f64| at("node#cut", v)[0].clone();
    assert_eq!(third(0.0), "filter#cut>@0");
    assert_eq!(third(0.33), "filter#cut>@0");
    assert_eq!(third(0.34), "filter#cut>@1");
    assert_eq!(third(0.66), "filter#cut>@1");
    assert_eq!(third(0.67), "filter#cut>@2");
    assert_eq!(third(1.0), "filter#cut>@2");
    assert_eq!(
        at("node/9#gone", 0.5),
        [
            "?#gone>@1".to_string(),
            "?#gone>".into(),
            "?#gone".into(),
            "gone".into()
        ]
    );
}

/// Acid Line's Jacobian with the cutoff's column `c` and every other column
/// zero, under spreads of 2.
fn measured_acid(c: Vec<f64>) -> (PatchTree, Jacobian) {
    let (t, knobs) = acid();
    let n = names().len();
    let jac = Jacobian {
        addrs: knobs.iter().map(|(a, _)| a.clone()).collect(),
        values: knobs.iter().map(|(_, v)| *v).collect(),
        names: names(),
        z: vec![0.0; n],
        cols: knobs
            .iter()
            .map(|(a, _)| {
                if a == "node#cut" {
                    c.clone()
                } else {
                    vec![0.0; n]
                }
            })
            .collect(),
    };
    (t, jac)
}

/// **The table keeps the median of what each kind of knob was measured to
/// do.** Columns go back to raw units (a standardized 1 under a spread of 2
/// is 2), each under all four of its knob's keys; a key measured fewer than
/// `TABLE_MIN` times is dropped, so two sounds teach nothing and three do.
/// The median is taken coordinate by coordinate (one outlier does not move
/// it), and of an even count it is the upper middle.
#[test]
fn the_table_keeps_the_median_of_each_kind_of_knob() {
    let n = names().len();
    let spread = vec![2.0; n];
    let sounds: Vec<(PatchTree, Jacobian)> = [1.0, 9.0, 3.0, 2.0]
        .iter()
        .map(|&v| measured_acid(col(&[("centroid_mean", v), ("crest", -v)])))
        .collect();
    let take = |k: usize| -> Vec<Measured> {
        sounds[..k]
            .iter()
            .map(|(tree, jac)| Measured {
                tree,
                jac,
                spread: &spread,
            })
            .collect()
    };
    assert!(KnobTable::learn(&take(TABLE_MIN - 1)).cols.is_empty());
    let three = KnobTable::learn(&take(TABLE_MIN));
    assert_eq!(three.names, names());
    let keys = knob_keys(&sounds[0].0, &[("node#cut".into(), 0.36)]).remove(0);
    for k in &keys {
        // Of 1, 9 and 3, the median is 3; in raw units, 6.
        assert_eq!(
            three.cols[k],
            col(&[("centroid_mean", 6.0), ("crest", -6.0)])
        );
    }
    // Every knob of Acid Line is kept, each under its four keys (the zero
    // columns too: a knob measured to do nothing is a prediction).
    let knobs = sounds[0].1.addrs.len();
    let mut all: Vec<String> = knob_keys(&sounds[0].0, &acid().1)
        .into_iter()
        .flatten()
        .collect();
    all.sort();
    all.dedup();
    assert_eq!(three.cols.len(), all.len());
    assert!(all.len() <= 4 * knobs);
    // Of 1, 9, 3 and 2, the upper middle is 3; of −1, −9, −3 and −2, it is
    // −2.
    let four = KnobTable::learn(&take(4));
    assert_eq!(
        four.cols[&keys[3]],
        col(&[("centroid_mean", 6.0), ("crest", -4.0)])
    );
}

/// **A knob is predicted by the finest key the table holds,** standardized
/// by the session's spreads; a knob the table does not know moves nothing;
/// and a table over other φ names predicts nothing at all.
#[test]
fn a_prediction_takes_the_finest_key_and_the_sessions_spread() {
    let (t, knobs) = acid();
    let n = names().len();
    let cut = knobs.iter().position(|(a, _)| a == "node#cut").unwrap();
    let keys = knob_keys(&t, &knobs);
    let mut table = KnobTable {
        names: names(),
        ..KnobTable::default()
    };
    table
        .cols
        .insert("cut".into(), col(&[("centroid_mean", 4.0)]));
    let spread = vec![2.0; n];
    let p = table.predict(&t, &knobs, &spread).expect("a prediction");
    assert_eq!(p.len(), knobs.len());
    assert_eq!(p[cut], col(&[("centroid_mean", 2.0)]));
    for (i, c) in p.iter().enumerate().filter(|(i, _)| *i != cut) {
        assert_eq!(c, &vec![0.0; n], "{} is unknown", knobs[i].0);
    }
    // The finest key wins over the site.
    table
        .cols
        .insert(keys[cut][0].clone(), col(&[("rolloff_mean", 8.0)]));
    assert_eq!(
        table.column(&keys[cut]),
        Some(&col(&[("rolloff_mean", 8.0)]))
    );
    table
        .cols
        .insert(keys[cut][2].clone(), col(&[("crest", 8.0)]));
    assert_eq!(
        table.column(&keys[cut]),
        Some(&col(&[("rolloff_mean", 8.0)]))
    );
    // Over other names: one renamed, or one fewer.
    let mut renamed = table.clone();
    renamed.names[0] = "renamed".into();
    assert_eq!(renamed.predict(&t, &knobs, &spread), None);
    let mut shorter = table.clone();
    shorter.names.pop();
    assert_eq!(shorter.predict(&t, &knobs, &spread), None);
}

/// A standardizer over φ with every spread `s`.
fn flat(s: f64) -> Standardizer {
    let d = Features::phi_names().len();
    Standardizer {
        mean: vec![0.0; d],
        std: vec![s; d],
    }
}

/// The gate's data for `passing` (each wired 100 times, right on 85) and
/// `failing` (wired 100, right on 60).
fn gate(passing: &[&str], failing: &[&str]) -> BTreeMap<String, Agreement> {
    let pass = Agreement {
        wired: 100,
        right: 85,
    };
    let fail = Agreement {
        wired: 100,
        right: 60,
    };
    passing
        .iter()
        .map(|n| (n.to_string(), pass))
        .chain(failing.iter().map(|n| (n.to_string(), fail)))
        .collect()
}

/// **The bound decides the gate, not the rate.** Four turns in five, seen a
/// hundred times, pass at 0.70; seen ten times, they do not, and nor does a
/// control never wired. Seven in ten seen a hundred times are under it too.
/// A perfect record passes from ten turns: ten in ten do, nine in nine and
/// five in five (the shipped table's Grit) do not. The bound is the Wilson
/// interval's lower end at two standard errors, worked by hand here.
#[test]
fn the_bound_not_the_rate_decides_the_gate() {
    let bound = |wired, right| Agreement { wired, right }.lower_bound();
    let near = |a: f64, b: f64| assert!((a - b).abs() < 1e-4, "{a} ≈ {b}");
    near(bound(100, 80), 0.70917);
    near(bound(10, 8), 0.48394);
    near(bound(100, 70), 0.60211);
    near(bound(10, 10), 0.71429);
    near(bound(9, 9), 0.69231);
    near(bound(5, 5), 0.55556);
    assert_eq!(bound(0, 0), 0.0);
    for (w, r) in [(100, 80), (10, 10)] {
        assert!(bound(w, r) >= PREDICT_GATE, "{r} of {w}");
    }
    for (w, r) in [(10, 8), (100, 70), (9, 9), (5, 5), (0, 0)] {
        assert!(bound(w, r) < PREDICT_GATE, "{r} of {w}");
    }
    let mut table = KnobTable::default();
    table.gate.insert(
        "Bright".into(),
        Agreement {
            wired: 100,
            right: 80,
        },
    );
    table
        .gate
        .insert("Snap".into(), Agreement { wired: 5, right: 5 });
    assert!(table.passes(&CONTROLS[0]));
    assert!(!table.passes(&CONTROLS[1]), "too few turns");
    assert!(!table.passes(&CONTROLS[2]), "never judged");
}

/// **The gate counts how often a held-out sound turns the named way.** Four
/// Acid Lines whose measured cutoff brightens by 1, 2 and 3 and darkens by
/// 5: each held out in turn, the other three's median predicts a brightening
/// (2, 1, 1 and 2), right on the three that brighten and wrong on the one
/// that darkens. Bright is counted on every sound it is
/// wired on, a control the table cannot reach on none. Only the held-out
/// indices are judged: the rest only train.
#[test]
fn the_gate_counts_held_out_turns_that_go_the_named_way() {
    let n = names().len();
    let spread = vec![1.0; n];
    let sounds: Vec<(PatchTree, Jacobian)> = [1.0, 2.0, 3.0, -5.0]
        .iter()
        .map(|&v| measured_acid(col(&[("centroid_mean", v), ("rolloff_mean", v)])))
        .collect();
    let measured: Vec<Measured> = sounds
        .iter()
        .map(|(tree, jac)| Measured {
            tree,
            jac,
            spread: &spread,
        })
        .collect();
    let all = KnobTable::agreement(&measured, &[0, 1, 2, 3], &CONTROLS);
    assert_eq!(all.len(), CONTROLS.len(), "every control asked is named");
    assert_eq!(all["Bright"], Agreement { wired: 4, right: 3 });
    assert_eq!(all["Grit"], Agreement::default(), "nothing reaches it");
    // Held out alone, the darkening one is wrong, and a brightening one right.
    assert_eq!(
        KnobTable::agreement(&measured, &[3], &CONTROLS)["Bright"],
        Agreement { wired: 1, right: 0 }
    );
    assert_eq!(
        KnobTable::agreement(&measured, &[0], &CONTROLS)["Bright"],
        Agreement { wired: 1, right: 1 }
    );
    // An index past the end is judged on nothing.
    assert_eq!(
        KnobTable::agreement(&measured, &[9], &CONTROLS)["Bright"],
        Agreement::default()
    );
    // A learned table carries no gate of its own: the generator adds it.
    assert!(KnobTable::learn(&measured).gate.is_empty());
}

/// **A control below the gate is not wired from the prediction, and one
/// above is.** With a table that can reach both Bright (the cutoff
/// brightens) and Snap (the amp's attack is quicker), each is wired exactly
/// when its gate passes; a control the gate passes but the prediction cannot
/// reach is left out rather than called a search control (a guess may not
/// say *can't*); and a table whose gate passes nothing predicts nothing.
#[test]
fn a_control_below_the_gate_is_not_wired_from_the_prediction_and_one_above_is() {
    let (t, _) = acid();
    let mut engine = Engine::new(PatchGrammarPrior::default(), fast());
    engine.standardizer = Some(Arc::new(flat(1.0)));
    let mut table = KnobTable {
        names: names(),
        ..KnobTable::default()
    };
    table.cols.insert(
        "cut".into(),
        col(&[("centroid_mean", 3.0), ("rolloff_mean", 3.0)]),
    );
    table
        .cols
        .insert("attack".into(), col(&[("attack_s", -3.0), ("crest", 3.0)]));
    let wired = |table: &KnobTable| -> Vec<String> {
        engine
            .wire_predicted(&t, &CONTROLS, table)
            .map(|(_, w)| w.into_iter().map(|w| w.name).collect())
            .unwrap_or_default()
    };
    table.gate = gate(&["Bright", "Snap", "Body"], &[]);
    assert_eq!(
        wired(&table),
        ["Bright", "Snap"],
        "Body passes and reaches nothing"
    );
    table.gate = gate(&["Bright"], &["Snap"]);
    assert_eq!(wired(&table), ["Bright"]);
    table.gate = gate(&["Snap"], &["Bright"]);
    assert_eq!(wired(&table), ["Snap"]);
    table.gate = gate(&["Body"], &["Bright", "Snap"]);
    assert!(engine.wire_predicted(&t, &CONTROLS, &table).is_none());
}

/// **A predicted wiring is the measurement's solve on the table, with no
/// render.** Before a standardizer there is none. With a table that says a
/// filter's cutoff brightens, Bright turns Acid Line's cutoff up by the full
/// travel and the controls the table says nothing about are left out; the
/// wiring is unverified, so it turns both ways, and nothing was rendered. The tree's position comes from the memo once its render is
/// there. A patch the compiler refuses has no live knob and no prediction;
/// nor does a table over other names.
#[test]
fn a_predicted_wiring_is_the_solve_on_the_table_with_no_render() {
    let (t, knobs) = acid();
    let mut engine = Engine::new(PatchGrammarPrior::default(), fast());
    let mut table = KnobTable {
        names: names(),
        ..KnobTable::default()
    };
    table.cols.insert(
        "cut".into(),
        col(&[("centroid_mean", 3.0), ("rolloff_mean", 3.0)]),
    );
    table.gate = gate(&CONTROLS.map(|c| c.name), &[]);
    assert!(engine.wire_predicted(&t, &CONTROLS, &table).is_none());
    engine.standardizer = Some(Arc::new(flat(1.5)));
    let misses = engine.memo().stats().misses;
    let (jac, wiring) = engine
        .wire_predicted(&t, &CONTROLS, &table)
        .expect("predicted");
    assert_eq!(engine.memo().stats().misses, misses, "no render");
    assert_eq!(
        jac.addrs,
        knobs.iter().map(|(a, _)| a.clone()).collect::<Vec<_>>()
    );
    assert_eq!(
        jac.values,
        knobs.iter().map(|(_, v)| *v).collect::<Vec<_>>()
    );
    let cut = jac.addrs.iter().position(|a| a == "node#cut").unwrap();
    assert_eq!(
        jac.cols[cut],
        col(&[("centroid_mean", 2.0), ("rolloff_mean", 2.0)])
    );
    assert!(jac.z.is_empty());
    assert_eq!(wiring.len(), 1, "the table knows only the cutoff");
    let bright = &wiring[0];
    assert_eq!(bright.name, "Bright");
    assert!(!bright.search);
    assert_eq!(bright.knobs, vec![("node#cut".to_string(), MAX_TRAVEL)]);
    assert_eq!((bright.up, bright.down), (None, None));
    assert_eq!(bright.range(), (-1.0, 1.0));
    assert_eq!(bright.position, 0.0);
    // Its render in the memo: the position is where it measures.
    let (cf, _) = featurize_memo(&t, &engine.cfg.phrase, engine.memo(), false).expect("vets");
    let z = standardized_audio(&cf.features, engine.standardizer.as_deref().unwrap());
    let (jac, wiring) = engine
        .wire_predicted(&t, &CONTROLS, &table)
        .expect("predicted");
    assert_eq!(jac.z, z);
    let d = crate::perform::direction(&CONTROLS[0], &jac.names);
    let at: f64 = d.iter().zip(&z).map(|(a, b)| a * b).sum();
    assert_eq!(wiring[0].position, at);
    // No live knob: a patch the compiler refuses.
    let mut deep = preset("Folded Lead");
    while auracle_grammar::compile(&deep, engine.cfg.phrase.sample_rate).is_ok() {
        deep.root = AudioNode::Filter {
            uid: Uid::NEW,
            kind: auracle_grammar::term::FilterKind::SvfLp,
            cutoff: 0.6,
            resonance: 0.2,
            mod_depth: 0.0,
            input: Box::new(deep.root),
            modulation: ModNode::None,
        };
    }
    assert!(live_knobs(&deep, engine.cfg.phrase.sample_rate).is_empty());
    assert!(engine.wire_predicted(&deep, &CONTROLS, &table).is_none());
    table.names[0] = "renamed".into();
    assert!(engine.wire_predicted(&t, &CONTROLS, &table).is_none());
}
