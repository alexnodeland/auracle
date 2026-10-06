use super::*;

#[test]
fn a_source_ignores_uids_and_sees_everything_else() {
    let bank = auracle_grammar::preset_bank();
    let p = &bank[0];
    let mut again = p.tree.clone();
    again.ensure_uids();
    assert_eq!(
        preset_source(p.name, &p.tree),
        preset_source(p.name, &again)
    );
    assert_ne!(
        preset_source(p.name, &p.tree),
        preset_source("renamed", &p.tree)
    );
    assert_ne!(
        preset_source(p.name, &p.tree),
        preset_source(p.name, &bank[1].tree)
    );
}

/// The measurement's renders run on any number of threads and come back in
/// item order, so the width changes the time, never the numbers (`boot`,
/// `warm`): one thread, a few, and more than there are items.
#[test]
fn a_parallel_map_keeps_item_order_at_any_width() {
    let items: Vec<u64> = (0..37).collect();
    let serial: Vec<u64> = items.iter().map(|x| x * x + 1).collect();
    for threads in [1, 3, 64] {
        assert_eq!(
            par_map(&items, threads, |x| x * x + 1),
            serial,
            "{threads} threads"
        );
    }
    assert!(par_map(&[] as &[u64], 4, |x| *x).is_empty());
}

/// The cross-target comparison names the first place the probe parts from
/// the pinned one: a number past [`TOLERANCE`] of its size (and not one
/// within it), a list of another length, keys on one side only, any other
/// value that differs; and agreement is nothing at all.
#[test]
fn a_difference_names_the_first_place_the_probes_part() {
    use serde_json::json;
    let at = |was: serde_json::Value, now: serde_json::Value| first_difference(&was, &now, "probe");
    let same = json!({"seed": 7, "draws": ["a", "b"], "pool": {"spread": {"x": 1.5}}});
    assert_eq!(at(same.clone(), same.clone()), None);
    assert_eq!(
        at(json!({"x": 1000.0}), json!({"x": 1000.0 + 0.5e-3})),
        None,
        "within tolerance of its size"
    );
    assert_eq!(
        at(json!({"x": 1000.0}), json!({"x": 1000.01})).as_deref(),
        Some("probe.x: pinned 1000.0, now 1000.01")
    );
    assert_eq!(
        at(json!({"d": ["a", "b"]}), json!({"d": ["a"]})).as_deref(),
        Some("probe.d: 2 entries pinned, 1 now")
    );
    assert_eq!(
        at(json!({"d": ["a", "b"]}), json!({"d": ["a", "c"]})).as_deref(),
        Some("probe.d[1]: pinned \"b\", now \"c\"")
    );
    assert_eq!(
        at(json!({"a": 1, "b": 2}), json!({"a": 1, "c": 2})).as_deref(),
        Some("probe: keys only in the pinned probe [\"b\"], only now [\"c\"]")
    );
    assert_eq!(
        at(json!({"kept": null}), json!({"kept": 3})).as_deref(),
        Some("probe.kept: pinned null, now 3")
    );
}

/// A pinned file that is not JSON is said to be so, before the probe is
/// rendered at all.
#[test]
fn a_pinned_probe_that_is_not_json_says_so() {
    assert_eq!(
        boot_probe_difference("{ not json"),
        "the pinned probe is not JSON"
    );
}

/// The measurement examples read the session engine inside a wasm engine
/// (`session`): the one its bindings answer from.
#[test]
fn the_session_inside_is_the_one_the_bindings_answer_from() {
    let mut e = WasmEngine::new(SEED, 3);
    while e.fill_step(3) > 0 {}
    let inside = session(&e);
    let ranked: Vec<serde_json::Value> = serde_json::from_str(&e.ranked()).unwrap();
    let ids: Vec<u64> = ranked.iter().map(|r| r["id"].as_u64().unwrap()).collect();
    let want: Vec<u64> = inside
        .ranked()
        .into_iter()
        .map(|(i, _, _)| inside.pool[i].id)
        .collect();
    assert_eq!(ids, want);
    assert_eq!(inside.cfg.pool_size, 3);
}
