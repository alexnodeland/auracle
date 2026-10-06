use super::*;
use rand::RngCore;

/// A patch nested past the compiler's ceiling (`COMPILE_MAX_NESTING`): it
/// parses, and it never compiles, so nothing renders, probes or plays it.
/// What every route that compiles a tree the player sent must refuse.
pub(crate) fn too_deep() -> PatchTree {
    use auracle_grammar::term::{AudioNode, FilterKind, ModNode};
    let mut tree = presets()[0].1.clone();
    while tree.root.depth() + tree.root.max_mod_depth() <= auracle_grammar::COMPILE_MAX_NESTING {
        tree.root = AudioNode::Filter {
            uid: auracle_grammar::Uid::NEW,
            kind: FilterKind::SvfLp,
            cutoff: 0.5,
            resonance: 0.2,
            mod_depth: 0.0,
            input: Box::new(tree.root),
            modulation: ModNode::None,
        };
    }
    tree
}

/// A reply that cannot be written answers with the empty shape its caller
/// reads, never with a panic, which would poison the engine for every later
/// call. No reply here can fail; serde_json refuses a map keyed by anything
/// but a string, and this one stands in for it.
#[test]
fn a_reply_that_cannot_be_written_answers_its_fallback() {
    let refused: std::collections::HashMap<(u8, u8), u8> = [((1, 2), 3)].into_iter().collect();
    assert!(
        serde_json::to_string(&refused).is_err(),
        "fixture: serde_json refuses it"
    );
    assert_eq!(json_or(&refused, "[]"), "[]");
    assert_eq!(json_or(&[1, 2], "[]"), "[1,2]", "what can be written is");
}

/// The cable probe answers `null` for a tree it cannot compile, as for a
/// bench with nothing on it, and the cables of one it can.
#[test]
fn a_tree_that_does_not_compile_has_no_cables() {
    let spec = PhraseSpec::default();
    assert_eq!(cable_levels_json(&too_deep(), &spec), "null");
    let probe: serde_json::Value =
        serde_json::from_str(&cable_levels_json(&presets()[0].1, &spec)).unwrap();
    assert!(probe["cables"].as_array().is_some_and(|c| !c.is_empty()));
}

/// PERFORM's replies write a tree exactly as the rest of the app does, key
/// for key: through `json!` they came out with sorted keys, and PERFORM,
/// which tells a new structure from new knob values by comparing trees'
/// text, took Back after a drift for a new patch.
#[test]
fn perform_replies_write_trees_in_their_own_key_order() {
    let mut engine = WasmEngine::new(3, 6);
    while engine.fill_step(3) > 0 {}
    let id = pool_ids(&engine)[0];
    assert!(engine.edit_begin(id));
    let tree_json = engine.edit_tree_json();
    let mut compared = 0;
    for reply in [
        engine.perform_drift(&tree_json, "{}", "[]", 3, 0.15),
        engine.perform_offer(&tree_json, "{}", "[]", 3, None, None),
    ] {
        let v: serde_json::Value = serde_json::from_str(&reply).unwrap();
        if v.get("reason").is_some() {
            continue; // nothing grew this time; nothing to compare
        }
        let tree: PatchTree = serde_json::from_value(v["tree"].clone()).unwrap();
        let own = serde_json::to_string(&tree).unwrap();
        assert!(
            reply.starts_with(&format!("{{\"tree\":{own}")),
            "the reply's tree is not in its own key order"
        );
        compared += 1;
    }
    assert!(
        compared > 0,
        "neither a drift nor an offer grew, so nothing was checked"
    );
}

/// A row in the farm's persistent cache is keyed by its namespace, so a
/// row another build wrote (another quiver, another featurizer) is never
/// a hit. The store's own stamp is checked only when a farm worker opens
/// it, and a tab still on the old build writes on into a store a newer
/// tab has re-stamped; the engine re-checks a row's content address, which
/// a DSP change does not move. One build has one namespace, so this pins
/// the key's shape: the namespace this binary measures in, then the
/// content address.
#[test]
fn a_stored_row_is_keyed_by_its_namespace() {
    let spec = PhraseSpec::default();
    let phrase = serde_json::to_string(&spec).unwrap();
    let tree = auracle_grammar::presets()[0].1.clone();
    let tree_json = serde_json::to_string(&tree).unwrap();
    let ns = cache_namespace(&phrase);
    assert!(
        ns.contains(&format!(":q{}:", auracle_features::QUIVER_DSP_VERSION)),
        "the namespace names the DSP: {ns}"
    );
    assert_eq!(
        farm_key(&tree_json, &phrase),
        format!("{ns}/{}", auracle_features::render_key(&tree, &spec)),
        "a stored row's key must begin with the namespace it was measured in"
    );
    assert_eq!(farm_key("{", &phrase), "", "an unparsable tree is a miss");
}

/// LEARNING's math reads its numbers from `model_facts`, and its
/// forecast strip from `forecasts`: the facts are φ's two halves, the
/// draws the posterior holds and the lenses it was allowed; each forecast
/// is the `duel_pred` taken before the pick it scores, and none exists
/// before the first fit.
#[test]
fn model_facts_and_forecasts_are_the_engines() {
    let mut engine = WasmEngine::new(5, 8);
    while engine.fill_step(4) > 0 {}
    let facts: serde_json::Value = serde_json::from_str(&engine.model_facts()).unwrap();
    let names = Features::phi_names();
    let audio = names.iter().filter(|n| n.contains(':')).count();
    assert_eq!(facts["audio"], serde_json::json!(audio), "{facts}");
    assert_eq!(facts["audio"], serde_json::json!(18), "{facts}");
    assert_eq!(
        facts["structural"],
        serde_json::json!(names.len() - audio),
        "{facts}"
    );
    assert_eq!(facts["structural"], serde_json::json!(26), "{facts}");
    assert_eq!(
        facts["draws"],
        serde_json::json!(auracle_taste::model::KEEP),
        "{facts}"
    );
    assert_eq!(
        facts["styles"],
        serde_json::json!(0),
        "no fit, no lens: {facts}"
    );
    assert_eq!(facts["styles_max"], serde_json::json!(5), "{facts}");
    assert_eq!(facts["obs_per_style"], serde_json::json!(20), "{facts}");
    assert_eq!(engine.forecasts(), "[]");

    let mut taught = taught_wasm(0x1EA);
    let facts: serde_json::Value = serde_json::from_str(&taught.model_facts()).unwrap();
    let p = taught.engine.posterior.as_ref().unwrap();
    assert_eq!(
        facts["draws"],
        serde_json::json!(p.samples.len()),
        "{facts}"
    );
    assert_eq!(facts["draws"], serde_json::json!(500), "{facts}");
    assert_eq!(facts["styles"], serde_json::json!(p.k_styles()), "{facts}");
    let before: Vec<serde_json::Value> = serde_json::from_str(&taught.forecasts()).unwrap();
    let [a, b]: [u64; 2] = serde_json::from_str::<Option<[u64; 2]>>(&taught.next_duel())
        .unwrap()
        .expect("a duel");
    let pred = taught.duel_pred(a as u32, b as u32);
    assert!(taught.record_duel(a as u32, b as u32, false));
    let after: Vec<serde_json::Value> = serde_json::from_str(&taught.forecasts()).unwrap();
    assert_eq!(after.len(), before.len() + 1);
    let last = after.last().unwrap();
    assert_eq!(last["p_a"].as_f64().unwrap(), pred, "{last}");
    assert_eq!(last["chose_a"], serde_json::json!(false));
    assert_eq!(last["provenance"], serde_json::json!("duel"));

    // The pool's z, one row per featurized member, in φ's order: exactly
    // the coordinates θ weighs.
    let f: serde_json::Value = serde_json::from_str(&taught.pool_features()).unwrap();
    assert_eq!(f["names"].as_array().unwrap().len(), names.len());
    let rows = f["rows"].as_array().unwrap();
    let pool: Vec<_> = taught
        .engine
        .pool
        .iter()
        .filter(|c| !c.phi_std.is_empty())
        .collect();
    assert_eq!(rows.len(), pool.len());
    for (row, c) in rows.iter().zip(&pool) {
        assert_eq!(row["id"], serde_json::json!(c.id));
        let z: Vec<f64> = serde_json::from_value(row["z"].clone()).unwrap();
        assert_eq!(z, c.phi_std, "z is the member's standardized φ");
    }
}

/// The bench's cable probe names the cables PATCH draws, keyed as the rack
/// keys them (`data-from`/`data-to`, and the uids of `midOf`), measures
/// each, and leaves the bench as it found it: the same buffer, bit for
/// bit, and the same tree.
#[test]
fn the_bench_probe_names_the_cables_patch_draws() {
    let mut engine = WasmEngine::new(3, 6);
    while engine.fill_step(3) > 0 {}
    assert_eq!(engine.edit_cable_levels(), "null", "nothing open");
    let id = pool_ids(&engine)[0];
    assert!(engine.edit_begin(id));
    let (before, tree) = (engine.edit_render(), engine.edit_tree_json());
    let probe: serde_json::Value = serde_json::from_str(&engine.edit_cable_levels()).unwrap();
    assert_eq!(
        engine.edit_render(),
        before,
        "the probe moved the bench's buffer"
    );
    assert_eq!(
        engine.edit_tree_json(),
        tree,
        "the probe moved the bench's tree"
    );
    let rack: serde_json::Value = serde_json::from_str(&engine.edit_describe()).unwrap();
    let uid = |key: &serde_json::Value| {
        rack["modules"]
            .as_array()
            .unwrap()
            .iter()
            .find(|m| &m["key"] == key)
            .map(|m| m["uid"].clone())
            .unwrap()
    };
    let drawn: Vec<_> = rack["wires"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|w| w["kind"] == "audio")
        .map(|w| {
            (
                w["from"].clone(),
                w["to"].clone(),
                uid(&w["from"]),
                uid(&w["to"]),
            )
        })
        .collect();
    let probed: Vec<_> = probe["cables"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            assert!(c["rms_db"].as_f64().unwrap().is_finite());
            (
                c["from"].clone(),
                c["to"].clone(),
                c["from_uid"].clone(),
                c["to_uid"].clone(),
            )
        })
        .collect();
    assert!(!drawn.is_empty());
    assert_eq!(probed, drawn, "the probe's cables are not the rack's");
    let direct: PatchTree = serde_json::from_str(&tree).unwrap();
    assert_eq!(
        serde_json::to_string(
            &auracle_features::cable_levels(&direct, &engine.engine.cfg.phrase).unwrap()
        )
        .unwrap(),
        engine.edit_cable_levels(),
        "the binding and the probe disagree"
    );
}

/// The session's clip, through the boundary the worker uses. A capture is
/// taken (resampled from the context's rate), reported, carried in the
/// phrase the farm is handed, folded into a listening sound's stored key
/// and nobody else's, saved with the session and restored from it; a
/// silent capture is refused and changes nothing; and clearing it goes
/// back to the reference.
#[test]
fn the_session_clip_crosses_the_boundary() {
    use auracle_grammar::term::{AudioNode, InputChannel};
    let mut engine = WasmEngine::new(5, 4);
    while engine.fill_step(4) > 0 {}
    let status =
        |e: &WasmEngine| serde_json::from_str::<serde_json::Value>(&e.audition_clip()).unwrap();
    assert_eq!(status(&engine)["source"], "reference");
    assert!(status(&engine)["note"]
        .as_str()
        .unwrap()
        .contains("built-in"));
    let before = engine.phrase_json();

    // A second of a 48 kHz stereo capture.
    let capture: Vec<f32> = (0..48_000 * 2)
        .map(|i| {
            let t = (i / 2) as f32 / 48_000.0;
            0.3 * (t * 220.0 * std::f32::consts::TAU).sin()
        })
        .collect();
    let silent = engine.set_audition_clip(vec![0.0; 48_000], 1, 48_000.0);
    let silent: serde_json::Value = serde_json::from_str(&silent).unwrap();
    assert_eq!(silent["ok"], false);
    assert!(silent["error"].as_str().unwrap().contains("silent"));
    assert_eq!(
        silent["clip"]["source"], "reference",
        "a refusal changes nothing"
    );

    let reply: serde_json::Value =
        serde_json::from_str(&engine.set_audition_clip(capture, 2, 48_000.0)).unwrap();
    assert_eq!(reply["ok"], true);
    assert_eq!(reply["clip"]["source"], "captured");
    assert_eq!(reply["clip"]["channels"], 2);
    assert!((reply["clip"]["seconds"].as_f64().unwrap() - 1.0).abs() < 0.001);
    let id = reply["clip"]["id"].as_str().unwrap().to_string();
    assert_eq!(status(&engine)["id"].as_str().unwrap(), id);

    // The farm's phrase now carries it: a listening sound keys apart,
    // every other sound and the namespace do not move.
    let after = engine.phrase_json();
    assert!(after.contains("\"clip\"") && !before.contains("\"clip\""));
    let mut listens = auracle_grammar::presets()[0].1.clone();
    listens.root = AudioNode::AudioIn {
        uid: auracle_grammar::Uid::NEW,
        input: 0,
        gain: auracle_grammar::INPUT_GAIN_UNITY,
        channel: InputChannel::Both,
    };
    let listens = serde_json::to_string(&listens).unwrap();
    let deaf = serde_json::to_string(&auracle_grammar::presets()[0].1).unwrap();
    assert_ne!(farm_key(&listens, &before), farm_key(&listens, &after));
    assert_eq!(farm_key(&deaf, &before), farm_key(&deaf, &after));
    assert_eq!(cache_namespace(&before), cache_namespace(&after));
    // And the farm renders with it: the row it returns is the engine's key.
    let job = farm_render(&listens, &after, false);
    assert!(job.ok());
    let row: CachedFeatures = serde_json::from_str(&job.cached()).unwrap();
    assert_eq!(
        format!("{}/{}", cache_namespace(&after), row.key),
        farm_key(&listens, &after)
    );

    // Saved with the session, and restored from it.
    let saved = engine.export_session();
    let mut back = WasmEngine::new(6, 4);
    assert!(back.import_session(&saved) > 0);
    assert_eq!(status(&back)["id"].as_str().unwrap(), id);
    assert_eq!(back.phrase_json(), after);

    let cleared: serde_json::Value = serde_json::from_str(&engine.clear_audition_clip()).unwrap();
    assert_eq!(cleared["clip"]["source"], "reference");
    assert_eq!(engine.phrase_json(), before);
}

/// The menu bar's TAUGHT tooltip splits the count by kind from
/// `status()`: a duel is a pick, a rating a star, a keep/kill a cut, and
/// the three add up to `observations`.
#[test]
fn status_counts_picks_stars_and_cuts_apart() {
    let mut engine = WasmEngine::new(3, 6);
    while engine.fill_step(3) > 0 {}
    let ids: Vec<u32> = pool_ids(&engine);
    assert!(engine.record_duel(ids[0], ids[1], true));
    assert!(engine.record_stars(ids[2], 3));
    assert!(engine.record_stars(ids[3], 1));
    assert!(engine.record_keep(ids[4], false));
    let st: serde_json::Value = serde_json::from_str(&engine.status()).unwrap();
    assert_eq!(
        (&st["picks"], &st["stars"], &st["cuts"], &st["observations"]),
        (
            &serde_json::json!(1),
            &serde_json::json!(2),
            &serde_json::json!(1),
            &serde_json::json!(4)
        ),
        "status: {st}"
    );
}

/// A taught engine with a unit-test budget. The shipped refinement budget
/// is a minute and more of walks per generation natively, which a unit
/// test cannot pay; the machinery under test does not depend on it.
/// Deterministic in `seed`: two calls build the same engine.
fn taught_wasm(seed: u64) -> WasmEngine {
    let mut engine = WasmEngine::new(seed, 12);
    engine.engine.cfg.refine_steps = 8;
    engine.engine.cfg.refine_seeds = 3;
    engine.engine.cfg.mcmc_samples = 3_000;
    engine.engine.cfg.mcmc_warmup = 1_000;
    while engine.fill_step(4) > 0 {}
    for _ in 0..16 {
        let [a, b]: [u64; 2] = serde_json::from_str::<Option<[u64; 2]>>(&engine.next_duel())
            .unwrap()
            .expect("a duel");
        // Any fixed rule will do: the test compares two twins, not a taste.
        engine.record_duel(a as u32, b as u32, (a * 7 + b) % 3 != 0);
    }
    engine.fit();
    engine
}

/// Plan and render a guess the way the worker does with no farm
/// (`memo_render`, one job at a time, a job that does not vet into
/// `failed`), then rank. Returns the ranking and the failed keys.
fn guess_serial(engine: &WasmEngine, limit: u32) -> (serde_json::Value, String) {
    let mut failed: Vec<String> = Vec::new();
    for _ in 0..4 {
        let fj = serde_json::to_string(&failed).unwrap();
        let plan: serde_json::Value =
            serde_json::from_str(&engine.guess_plan(None, &fj, limit)).unwrap();
        let jobs = plan["jobs"].as_array().expect("jobs").clone();
        if jobs.is_empty() {
            break;
        }
        for j in jobs {
            if !engine.memo_render(j["tree"].as_str().unwrap()) {
                failed.push(j["key"].as_str().unwrap().to_string());
            }
        }
    }
    let fj = serde_json::to_string(&failed).unwrap();
    (
        serde_json::from_str(&engine.guess_rank(None, &fj, limit)).unwrap(),
        fj,
    )
}

/// **The guess through the bindings, and an undo that counts as a skip.**
/// No guess before the fit; after it, the bench's patch is planned
/// first, then its candidates, and ranked (by the lower bound: the
/// session's `guesses_are_ranked_by_the_lower_bound`). Taking the top guess is an ordinary edit of the bench, and putting the
/// tree back (as ⌘Z does, through `edit_set_tree_apply`) skips that
/// family at that socket for this patch, logged as a skip; another
/// patch keeps its own (empty) skips.
#[test]
fn a_taken_guess_undone_is_a_skip_through_the_bindings() {
    let mut cold = WasmEngine::new(5, 6);
    while cold.fill_step(3) > 0 {}
    let first = pool_ids(&cold)[0];
    assert!(cold.edit_begin(first));
    assert_eq!(cold.guess_plan(None, "[]", 0), r#"{"reason":"no_taste"}"#);

    let mut engine = taught_wasm(5);
    assert_eq!(engine.guess_plan(None, "[]", 0), r#"{"reason":"no_patch"}"#);
    let ids: Vec<u32> = pool_ids(&engine);
    assert!(engine.edit_begin(ids[0]));
    let before = engine.edit_tree_json();
    let (rank, failed) = guess_serial(&engine, 8);
    let guesses = rank["guesses"].as_array().expect("guesses").clone();
    assert!(!guesses.is_empty(), "{rank}");
    assert!(rank["planned"].as_u64().unwrap() <= 8);
    let top = guesses[0].clone();
    assert_eq!(engine.guess_take(&top.to_string()), "");
    engine.edit_revet();
    assert_ne!(engine.edit_tree_json(), before, "the guess went in");
    // ⌘Z: the tree before the guess comes back whole.
    assert_eq!(engine.edit_set_tree_apply(&before), "");
    engine.edit_revet();
    assert_eq!(
        guess_skips_logged(&engine),
        1,
        "the undo was not logged as a skip"
    );
    let again: serde_json::Value =
        serde_json::from_str(&engine.guess_rank(None, &failed, 8)).unwrap();
    assert!(again["skipped"].as_u64().unwrap() >= 1, "{again}");
    assert!(again["guesses"]
        .as_array()
        .unwrap()
        .iter()
        .all(|g| g["socket"] != top["socket"] || g["family"] != top["family"]));
    assert!(!engine.guess_skip(&top.to_string()), "already skipped");
    // Another patch has its own skips.
    assert!(engine.edit_begin(ids[1]));
    let other: serde_json::Value = serde_json::from_str(&engine.guess_plan(None, "[]", 0)).unwrap();
    assert_eq!(other["skipped"], 0, "{other}");
    assert_eq!(guess_skips_logged(&engine), 1);
}

/// Skips are remembered per patch by pool id, and an import brings
/// another session's ids: after one, no skip from before applies.
#[test]
fn an_import_forgets_the_skips() {
    let mut engine = WasmEngine::new(3, 6);
    while engine.fill_step(3) > 0 {}
    let id = pool_ids(&engine)[0];
    assert!(engine.edit_begin(id));
    let skip = r#"{"socket":"out","family":"drive"}"#;
    assert!(engine.guess_skip(skip));
    assert!(!engine.guess_skip(skip), "remembered");
    let saved = engine.export_session();
    assert!(engine.import_session(&saved) > 0);
    assert!(engine.edit_begin(id));
    assert!(engine.guess_skip(skip), "a skip outlived the import");
}

/// A guess for the bench as JSON, as `guess_rank` would give it: the
/// first of `guess_candidates` of `kind`.
fn a_guess(engine: &WasmEngine, kind: &str) -> String {
    let tree = engine.bench_tree.clone().unwrap();
    let c = auracle_session::guess_candidates(&tree, None)
        .into_iter()
        .find(|c| c.kind == kind)
        .unwrap_or_else(|| panic!("no {kind} to guess"));
    serde_json::json!({ "op": c.op, "socket": c.socket, "family": c.family }).to_string()
}

/// The pool's ids, best first, as `ranked()` lists them.
pub(crate) fn pool_ids(engine: &WasmEngine) -> Vec<u32> {
    serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked())
        .unwrap()
        .iter()
        .map(|r| r["id"].as_u64().unwrap() as u32)
        .collect()
}

/// How many guess skips the session's log holds, read from what the save
/// carries (`export_session`'s `events`).
fn guess_skips_logged(engine: &WasmEngine) -> usize {
    let state: SessionState = serde_json::from_str(&engine.export_session()).unwrap();
    state
        .events
        .iter()
        .filter(|ev| ev.kind == "guess_skip")
        .count()
}

/// **An old take does not turn an unrelated undo into a skip.** Take a
/// guess on A, open B, open A again (back at the tree before the guess),
/// make an edit, then undo it to that tree: that undo is of the edit, not
/// of the guess, so nothing is skipped or logged.
#[test]
fn an_old_take_does_not_turn_an_unrelated_undo_into_a_skip() {
    let mut engine = WasmEngine::new(3, 6);
    while engine.fill_step(3) > 0 {}
    let ids = pool_ids(&engine);
    assert!(engine.edit_begin(ids[0]));
    let t0 = engine.edit_tree_json();
    let reverb = a_guess(&engine, "reverb");
    assert_eq!(engine.guess_take(&reverb), "");
    assert!(engine.edit_begin(ids[1]));
    assert!(engine.edit_begin(ids[0]));
    assert_eq!(
        engine.edit_tree_json(),
        t0,
        "back at the tree before the guess"
    );
    let edit = r#"{"op":"insert","key":"node","kind":"delay"}"#; // voice: name
    assert_eq!(engine.edit_structure_apply(edit), "");
    assert_eq!(engine.edit_set_tree_apply(&t0), "");
    assert_eq!(
        guess_skips_logged(&engine),
        0,
        "an unrelated undo was a skip"
    );
    assert!(engine.guess_skip(&reverb), "the family was hidden");
    assert_eq!(guess_skips_logged(&engine), 1);
}

/// **A guess ranked on an earlier tree is refused, not applied.** A noise
/// ranked for the empty socket, sent after the player put a pluck there
/// and a filter after it, would wipe both: it is refused with a reason,
/// and the bench is untouched.
#[test]
fn a_stale_guess_is_refused() {
    let mut engine = WasmEngine::new(3, 6);
    while engine.fill_step(3) > 0 {}
    assert!(engine.edit_begin(pool_ids(&engine)[0]));
    let mut empty: PatchTree = serde_json::from_str(&engine.edit_tree_json()).unwrap();
    empty.root = auracle_grammar::AudioNode::Silence {
        uid: auracle_grammar::Uid::NEW,
    };
    assert_eq!(
        engine.edit_set_tree_apply(&serde_json::to_string(&empty).unwrap()),
        ""
    );
    let noise = a_guess(&engine, "noise");
    for op in [
        r#"{"op":"replace","key":"node","kind":"pluck"}"#, // voice: name
        r#"{"op":"insert","key":"node","kind":"filter"}"#, // voice: name
    ] {
        assert_eq!(engine.edit_structure_apply(op), "");
    }
    let built = engine.edit_tree_json();
    let err = engine.guess_take(&noise);
    assert!(!err.is_empty(), "a stale guess was applied");
    assert_eq!(
        engine.edit_tree_json(),
        built,
        "the refusal moved the bench"
    );
    // A guess for the patch as it is now is taken.
    let reverb = a_guess(&engine, "reverb");
    assert_eq!(engine.guess_take(&reverb), "");
}

/// **Keep as new carries the skips.** The kept sound is the patch the
/// player is working on, so a family skipped before keeping stays
/// skipped on it.
#[test]
fn keep_as_new_carries_the_skips() {
    let mut engine = WasmEngine::new(3, 6);
    while engine.fill_step(3) > 0 {}
    assert!(engine.edit_begin(pool_ids(&engine)[0]));
    let reverb = a_guess(&engine, "reverb");
    assert!(engine.guess_skip(&reverb));
    let edit = r#"{"op":"insert","key":"node","kind":"delay"}"#; // voice: name
    assert_eq!(engine.edit_structure(edit), "");
    let kept = engine.edit_commit("none");
    assert!(kept > 0, "the edit was not kept");
    assert!(engine.edit_begin(kept));
    assert!(
        !engine.guess_skip(&reverb),
        "the skip stayed with the old id"
    );
}

/// **A sound kept as new is protected until a pick, and a PERFORM offer
/// is one.** Kept, it is marked; played in PERFORM with a control moved
/// (so the performed sound is not its tree) and an offer answered, it
/// competes like any other.
#[test]
fn a_perform_offer_judges_the_sound_in_hand() {
    let mut engine = WasmEngine::new(3, 6);
    while engine.fill_step(3) > 0 {}
    let ids = pool_ids(&engine);
    assert!(engine.edit_begin(ids[0]));
    let edit = r#"{"op":"insert","key":"node","kind":"delay"}"#; // voice: name
    assert_eq!(engine.edit_structure(edit), "");
    let kept = engine.edit_commit("none");
    assert!(kept > 0, "the edit was not kept");
    assert_eq!(engine.engine.unjudged(), vec![kept as u64]);
    let tree = engine.tree_json_of(kept);
    let moved = r#"[["amp#attack",0.37]]"#; // voice: name
    assert_ne!(
        engine.perform_apply(&tree, moved),
        engine.perform_apply(&tree, "[]"),
        "the control did not move the sound"
    );
    // Any other sound will do as the offer: one the commit left in.
    let other = pool_ids(&engine)
        .into_iter()
        .find(|&id| id != kept)
        .unwrap();
    let offer = engine.tree_json_of(other);
    assert!(engine.perform_record(&tree, moved, &offer, false, u32::MAX));
    assert!(
        engine.engine.unjudged().is_empty(),
        "an answered offer left the sound in hand protected"
    );
}

/// **A Take held over a keep does not judge the kept sound.** PERFORM
/// records a Take eight seconds after it is made. Taken onto the bench
/// and kept as new in that window, the sound is the answer's B side; the
/// answer carries the newest id the page had seen when it was made, and
/// does not end the protection of a sound kept after it. An answer made
/// once the kept sound was in the bank does.
#[test]
fn a_take_held_over_a_keep_does_not_judge_the_kept_sound() {
    let mut engine = WasmEngine::new(3, 6);
    while engine.fill_step(3) > 0 {}
    let ids = pool_ids(&engine);
    // The Take, made now: the bank shows these ids.
    let as_of = *ids.iter().max().unwrap();
    let home = engine.tree_json_of(ids[0]);
    // B on the bench, kept as new inside the window.
    assert!(engine.edit_begin(ids[0]));
    let edit = r#"{"op":"insert","key":"node","kind":"delay"}"#; // voice: name
    assert_eq!(engine.edit_structure(edit), "");
    let offer = engine.edit_tree_json();
    let kept = engine.edit_commit("none");
    assert!(kept > as_of, "the kept sound is newer than the Take");
    // The window closes, and the Take is recorded.
    assert!(engine.perform_record(&home, "[]", &offer, true, as_of));
    assert_eq!(
        engine.engine.unjudged(),
        vec![kept as u64],
        "a Take made before the keep judged the kept sound"
    );
    // A later answer, with the kept sound in the bank, is its pick.
    assert!(engine.perform_record(&home, "[]", &offer, false, kept));
    assert!(engine.engine.unjudged().is_empty());
}

/// **A new patch keeps its own skips.** NEW PATCH empties the sound in
/// hand into a patch of its own (`guess_patch_as(0)`): a skip made there
/// is not the sound's when the player goes back to it, the sound's are
/// not the new patch's, and coming back to the new patch under its key
/// finds its skip again.
#[test]
fn a_new_patch_files_its_skips_under_its_own_key() {
    let mut engine = WasmEngine::new(3, 6);
    while engine.fill_step(3) > 0 {}
    let sound = pool_ids(&engine)[0];
    assert!(engine.edit_begin(sound));
    let delay = a_guess(&engine, "delay");
    assert!(engine.guess_skip(&delay), "the sound's own skip");
    let key = engine.guess_patch_as(0);
    assert!(key > 0 && key != sound);
    assert!(
        engine.guess_skip(&delay),
        "the new patch took the sound's skip"
    );
    let reverb = a_guess(&engine, "reverb");
    assert!(engine.guess_skip(&reverb));
    // BACK TO the sound: its skips are its own.
    assert!(engine.edit_begin(sound));
    assert!(
        engine.guess_skip(&reverb),
        "the sound took a skip made on the new patch"
    );
    // NEW PATCH again, under the key it was given: its skip is there.
    assert_eq!(engine.guess_patch_as(key), key);
    assert!(!engine.guess_skip(&reverb), "the new patch lost its skip");
    assert_ne!(
        engine.guess_patch_as(0),
        key,
        "a second new patch reused a key"
    );
}

/// **Keep as new carries the skips made after it.** The page does not
/// reopen the kept sound, so the bench is still "opened from" the old
/// id (`bench_original`, what a later commit duel plays against). A skip
/// made after the commit is a skip on the kept sound: opened again, it
/// is still skipped there, and the sound it was made from never had it.
#[test]
fn keep_as_new_carries_the_skips_made_after_it() {
    let mut engine = WasmEngine::new(3, 6);
    while engine.fill_step(3) > 0 {}
    let original = pool_ids(&engine)[0];
    assert!(engine.edit_begin(original));
    let edit = r#"{"op":"insert","key":"node","kind":"delay"}"#; // voice: name
    assert_eq!(engine.edit_structure(edit), "");
    let kept = engine.edit_commit("none");
    assert!(kept > 0, "the edit was not kept");
    assert_eq!(
        engine.edit_original_id(),
        original,
        "a commit duel still plays against the sound it was opened from"
    );
    // After keep as new, on the same bench: skip a reverb.
    let reverb = a_guess(&engine, "reverb");
    assert!(engine.guess_skip(&reverb));
    assert!(engine.edit_begin(kept));
    assert!(
        !engine.guess_skip(&reverb),
        "a skip made after keep as new was filed under the old id"
    );
    assert!(engine.edit_begin(original));
    assert!(
        engine.guess_skip(&reverb),
        "the sound it was kept from took a skip made on the kept one"
    );
}

/// **A guess's renders respect the render namespace.** Each job's
/// `cache` key is the persistent store's (`farm_key`: this binary's
/// namespace, then the content address), and a farm row rendered under
/// another phrase is refused by `memo_absorb`, so the candidate stays
/// unrendered rather than ranked on another stimulus's φ.
#[test]
fn a_guess_respects_the_render_namespace() {
    let mut engine = taught_wasm(6);
    let id = pool_ids(&engine)[0];
    assert!(engine.edit_begin(id));
    let phrase = engine.phrase_json();
    let ns = cache_namespace(&phrase);
    let plan = |e: &WasmEngine| -> serde_json::Value {
        serde_json::from_str(&e.guess_plan(None, "[]", 2)).unwrap()
    };
    // The patch first, if the memo lacks it.
    let mut p = plan(&engine);
    if p["jobs"][0]["tree"].as_str() == Some(engine.edit_tree_json().as_str()) {
        assert!(engine.memo_render(p["jobs"][0]["tree"].as_str().unwrap()));
        p = plan(&engine);
    }
    let jobs = p["jobs"].as_array().unwrap().clone();
    assert!(!jobs.is_empty());
    let mut other: PhraseSpec = serde_json::from_str(&phrase).unwrap();
    other.seed ^= 1;
    let other = serde_json::to_string(&other).unwrap();
    for j in &jobs {
        let tree = j["tree"].as_str().unwrap();
        assert_eq!(j["cache"].as_str().unwrap(), farm_key(tree, &phrase));
        assert!(j["cache"].as_str().unwrap().starts_with(&format!("{ns}/")));
        let foreign = farm_render(tree, &other, false);
        assert!(foreign.ok);
        assert!(
            !engine.memo_absorb(tree, &foreign.cached),
            "a row from another stimulus was absorbed"
        );
    }
    let r: serde_json::Value = serde_json::from_str(&engine.guess_rank(None, "[]", 2)).unwrap();
    assert_eq!(r["rendered"], 0, "{r}");
    // This stimulus's rows are taken, and ranked.
    for j in &jobs {
        let tree = j["tree"].as_str().unwrap();
        let row = farm_render(tree, &phrase, false);
        if row.ok {
            assert!(engine.memo_absorb(tree, &row.cached));
        }
    }
    let r: serde_json::Value = serde_json::from_str(&engine.guess_rank(None, "[]", 2)).unwrap();
    assert!(r["rendered"].as_u64().unwrap() > 0, "{r}");
}

fn twins(seed: u64) -> (WasmEngine, WasmEngine) {
    std::thread::scope(|s| {
        let a = s.spawn(move || taught_wasm(seed));
        let b = s.spawn(move || taught_wasm(seed));
        (a.join().unwrap(), b.join().unwrap())
    })
}

/// A saw-ish note with a slow swell, as a page would decode it: mono
/// `f32` at 48 kHz.
fn decoded_file(seconds: f64) -> Vec<f32> {
    let sr = 48_000.0;
    (0..(seconds * sr) as usize)
        .map(|i| {
            let t = i as f64 / sr;
            let saw: f64 = (1..24)
                .map(|h| (std::f64::consts::TAU * 147.0 * h as f64 * t).sin() / h as f64)
                .sum();
            (0.25 * saw * (1.0 - (-t * 3.0).exp())) as f32
        })
        .collect()
}

/// **A sound of your own, through the binding.** It is measured, placed
/// and its nearest named; a file that cannot be measured is refused by a
/// flag and leaves the sound in place; a breed toward it carries its
/// target over the farm's wire, so `farm_walk` walks the tilted target
/// `run_walk` walks; and the session saves it as features only and
/// brings it back.
#[test]
fn a_sound_of_your_own_through_the_binding() {
    // Before the pool has a standardizer the sound is kept, and its
    // standardized reading is null, not missing.
    let mut fresh = WasmEngine::new(1, 4);
    let early: serde_json::Value =
        serde_json::from_str(&fresh.own_sound_set(&decoded_file(1.0), 48_000.0, None)).unwrap();
    assert_eq!(early["ok"], true);
    assert!(early.get("z").is_some_and(|z| z.is_null()), "{early}");
    assert!(early["map"].is_null());
    assert_eq!(early["nearest"], serde_json::json!([]));
    // A breed before any taste opens nothing and says so.
    let none: serde_json::Value = serde_json::from_str(&fresh.refine_toward_jobs()).unwrap();
    assert!(none["context"].is_null());
    assert_eq!(none["reason"], "untaught");
    // The taste's own generation carries no reason key at all.
    assert!(!fresh.refine_jobs().contains("reason"));

    let mut engine = taught_wasm(0x0A1D);
    assert_eq!(engine.own_sound(), "null");
    let reply: serde_json::Value = serde_json::from_str(&engine.own_sound_set(
        &decoded_file(3.0),
        48_000.0,
        Some("Field recording 03".into()),
    ))
    .unwrap();
    assert_eq!(reply["ok"], true);
    assert_eq!(reply["name"], "Field recording 03");
    let names = auracle_features::Features::phi_names();
    let z = reply["z"].as_array().unwrap();
    assert_eq!(z.len(), names.len());
    let masked: Vec<&str> = reply["masked"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    for (n, v) in names.iter().zip(z) {
        assert_eq!(v.is_null(), masked.contains(n), "{n}");
    }
    assert!(reply["map"]["x"].as_f64().unwrap().is_finite());
    let nearest = reply["nearest"].as_array().unwrap();
    assert_eq!(nearest.len(), OWN_NEAREST);
    for n in nearest {
        assert!(engine.engine.find(n["id"].as_u64().unwrap()).is_some());
    }
    assert_eq!(reply["nearest_presets"].as_array().unwrap().len(), 0);
    assert_eq!(reply["seeds"].as_array().unwrap().len(), 3);

    let refused: serde_json::Value =
        serde_json::from_str(&engine.own_sound_set(&vec![0.0; 48_000], 48_000.0, None)).unwrap();
    assert_eq!(refused["ok"], false);
    assert_eq!(refused["error"], "silent");
    assert!(engine.own_sound().contains("Field recording 03"));

    let jobs: serde_json::Value = serde_json::from_str(&engine.refine_toward_jobs()).unwrap();
    assert!(
        jobs["context"]["toward"].is_object(),
        "the target rides the wire"
    );
    // The wire carries one context for every job: one job shows it whole.
    let context = serde_json::to_string(&jobs["context"]).unwrap();
    let ctx: WalkContext = serde_json::from_str(&context).unwrap();
    let text = serde_json::to_string(&jobs["jobs"][0]).unwrap();
    let native: WalkJob = serde_json::from_str(&text).unwrap();
    let wired = farm_walk(&context, &text);
    // On the memo `farm_walk` just filled: a hit is a miss, bit for bit.
    let direct = WALK_MEMO.with(|memo| run_walk(&ctx, &native, memo));
    assert_eq!(wired, serde_json::to_string(&direct).unwrap());
    engine.refine_absorb(&wired);
    engine.refine_finish();

    let saved = engine.export_session();
    let state: serde_json::Value = serde_json::from_str(&saved).unwrap();
    let own = &state["own_sound"];
    assert_eq!(own["name"], "Field recording 03");
    assert_eq!(
        own["features"].as_array().unwrap().len(),
        names.len() - masked.len(),
        "features only: the measured coordinates, by name"
    );
    let mut back = WasmEngine::new(5, 12);
    assert!(back.import_session(&saved) > 0);
    let again: serde_json::Value = serde_json::from_str(&back.own_sound()).unwrap();
    assert_eq!(again["name"], "Field recording 03");
    assert_eq!(again["z"], engine_z(&engine));
    assert!(engine.own_sound_clear());
    assert_eq!(engine.own_sound(), "null");
    let gone: serde_json::Value = serde_json::from_str(&engine.refine_toward_jobs()).unwrap();
    assert_eq!(gone["reason"], "no_sound");
}

fn engine_z(e: &WasmEngine) -> serde_json::Value {
    serde_json::from_str::<serde_json::Value>(&e.own_sound()).unwrap()["z"].clone()
}

/// The presets nearest a sound come from the wirings the app ships:
/// every preset is read, back to the raw φ a render measures today.
#[test]
fn presets_come_back_from_the_shipped_wirings() {
    let presets = presets_from_wirings(include_str!("../../../apps/web/perform-wirings.json"));
    let bank = auracle_grammar::preset_bank();
    assert_eq!(
        presets.len(),
        bank.len(),
        "a preset is missing from the file"
    );
    let spec = PhraseSpec::default();
    for p in presets.iter().step_by(20) {
        let truth = auracle_features::featurize(&bank[p.index].tree, &spec)
            .unwrap()
            .features
            .audio
            .to_vec();
        for (a, b) in p.audio.iter().zip(&truth) {
            assert!(
                (a - b).abs() <= 1e-9 * (1.0 + b.abs()),
                "{}: {a} vs {b}",
                p.name
            );
        }
    }
    assert!(presets_from_wirings("{").is_empty());
    let mut engine = taught_wasm(0x5E7);
    let n = engine.own_presets_set(include_str!("../../../apps/web/perform-wirings.json"));
    assert_eq!(n as usize, bank.len());
    let reply: serde_json::Value =
        serde_json::from_str(&engine.own_sound_set(&decoded_file(2.0), 48_000.0, None)).unwrap();
    assert_eq!(reply["name"], "Your sound");
    let near = reply["nearest_presets"].as_array().unwrap();
    assert_eq!(near.len(), OWN_NEAREST);
    let d: Vec<f64> = near
        .iter()
        .map(|n| n["distance"].as_f64().unwrap())
        .collect();
    assert!(d.windows(2).all(|w| w[0] <= w[1]));
}

/// **The farm's wire changes no child.** The serial generation
/// (`Engine::refine`) is its jobs, `run_walk` on each with the engine's
/// memo, and `refine_absorb` in job order. The farm hands the same jobs out
/// as JSON (`refine_jobs`), a farm worker walks each through the stateless
/// `farm_walk` export, and the engine absorbs what comes back. So the farm
/// breeds the serial generation exactly when `farm_walk` of a job, as sent,
/// answers what `run_walk` answers on the engine's own context and job, and
/// the binding absorbs that answer in turn and only in turn. (That the order
/// the walks finish in cannot move the bank is the session's
/// `a_generation_absorbed_in_any_completion_order_is_the_serial_one`.)
#[test]
fn farm_walks_breed_the_serial_generation() {
    let mut engine = taught_wasm(0xFA2);
    let size = pool_ids(&engine).len();
    let reply: serde_json::Value = serde_json::from_str(&engine.refine_jobs()).unwrap();
    assert!(
        reply.get("reason").is_none(),
        "the taste's own generation carries no reason: {reply}"
    );
    // Re-serialized through `Value`, so its keys come out sorted: the
    // context is parsed by name, and its floats survive exactly
    // (`float_roundtrip`), which is what the worker's JSON relies on.
    let context = serde_json::to_string(&reply["context"]).unwrap();
    let own = engine.engine.walk_context().expect("taught");
    let jobs = reply["jobs"].as_array().unwrap();
    assert_eq!(jobs.len(), 3);
    let results: Vec<String> = jobs
        .iter()
        .map(|job| {
            let wired = farm_walk(&context, &serde_json::to_string(job).unwrap());
            let native: WalkJob = serde_json::from_value(job.clone()).unwrap();
            // On the memo `farm_walk` just filled: a hit is a miss, bit for
            // bit, so this renders nothing and walks the same walk.
            let direct = WALK_MEMO.with(|memo| run_walk(&own, &native, memo));
            assert_eq!(
                wired,
                serde_json::to_string(&direct).unwrap(),
                "job {}: farm_walk differs from run_walk",
                native.index
            );
            wired
        })
        .collect();
    // In job order only: a result offered out of its turn is refused as
    // stale and changes nothing; one that does not parse changes nothing.
    assert_eq!(engine.refine_absorb(&results[1]), 0);
    assert_eq!(engine.last_refine_reason(), "stale");
    assert_eq!(engine.refine_absorb("{"), 0);
    let children = results
        .iter()
        .filter(|r| engine.refine_absorb(r) > 0)
        .count();
    assert!(
        children > 0,
        "no walk bred a child, so no child was absorbed"
    );
    // The last absorb finished the generation: what the children displaced
    // is retired and gone, the bank is back to size, and a stop has nothing
    // left to do.
    let retired: Vec<u32> = serde_json::from_str(&engine.refine_retired()).unwrap();
    let ids = pool_ids(&engine);
    assert_eq!(ids.len(), size);
    assert_eq!(retired.len(), children, "one retired per child");
    assert!(retired.iter().all(|id| !ids.contains(id)), "{retired:?}");
    assert_eq!(
        engine.refine_finish(),
        "[]",
        "the last absorb already finished"
    );
    assert_eq!(
        engine.refine_retiring(),
        "[]",
        "a bank at size retires nothing"
    );
    assert_eq!(
        engine.refine_absorb(&results[0]),
        0,
        "a finished generation's result"
    );
    assert_eq!(engine.last_refine_reason(), "stale");
    assert_eq!(
        farm_walk("{", "{}"),
        "",
        "a broken job is refused, not walked"
    );
    let job = serde_json::to_string(&jobs[0]).unwrap();
    assert_eq!(farm_walk("{", &job), "", "a broken context is refused");
}

/// **The belief the worker posts after a pick** is the engine's as it
/// stands, under the reweighted posterior: `belief`'s reply is
/// `Engine::belief`, field for field, under the names the worker reads, and
/// a pick moves it. That its rows are `ranked()`'s numbers and its seeds and
/// may-replace a generation's is the session's
/// `the_belief_after_a_pick_is_the_reweighted_posterior` and
/// `next_seeds_and_may_replace_are_what_a_generation_does`.
#[test]
fn the_belief_a_pick_posts_is_the_engines() {
    let mut engine = taught_wasm(0xB31F);
    let fitted = engine.belief();
    let order = pool_ids(&engine);
    assert!(engine.record_duel(order[order.len() - 1], order[0], true));
    let text = engine.belief();
    assert_ne!(text, fitted, "the pick did not move the belief");
    let reply: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(reply, serde_json::to_value(engine.engine.belief()).unwrap());
    for key in ["ranked", "seeds", "may_replace", "direction"] {
        assert!(reply.get(key).is_some(), "no `{key}`: {reply}");
    }
    for key in ["id", "mean", "std", "style"] {
        assert!(reply["ranked"][0].get(key).is_some(), "no `ranked[].{key}`");
    }
}

/// Whether `child` (a binding's reply) is the ⚡ child `want` (the walk's
/// result) lands: its tree when there is one, else 0 and the walk's reason.
fn lands(engine: &WasmEngine, child: u32, want: &WalkResult) {
    match &want.child {
        Some(tree) => {
            assert!(
                child > 0,
                "the walk's child did not land ({})",
                engine.last_refine_reason()
            );
            let got: PatchTree = serde_json::from_str(&engine.tree_json_of(child)).unwrap();
            assert_eq!(&got, tree, "another child landed");
        }
        None => {
            assert_eq!(child, 0);
            let reason = want.reason.expect("no child, so a reason");
            assert_eq!(engine.last_refine_reason(), reason.as_str());
        }
    }
}

/// The walk a ⚡ reply (`refine_from_job`'s) holds, run natively on
/// `memo`: the context and job as the wire carries them, and what
/// `run_walk` makes of them. A memo hit is a miss, bit for bit, so the walk
/// is the same on any memo; the tests pass the one the path under test has
/// just filled (or is about to), so nothing is rendered twice.
fn walk_of(reply: &str, memo: &RenderMemo) -> (String, String, WalkResult) {
    let v: serde_json::Value = serde_json::from_str(reply).unwrap();
    let (context, job) = (
        serde_json::to_string(&v["context"]).unwrap(),
        serde_json::to_string(&v["job"]).unwrap(),
    );
    let ctx: WalkContext = serde_json::from_str(&context).expect("a context");
    let parsed: WalkJob = serde_json::from_str(&job).expect("a job");
    (context, job, run_walk(&ctx, &parsed, memo))
}

/// **⚡ on the farm is ⚡ in the engine.** ⚡ is one job (`refine_from_job`)
/// whose walk is absorbed: on the farm the job crosses the wire as JSON,
/// `farm_walk` walks it and `refine_from_absorb` takes the result; with no
/// crew the engine walks the very job it drew (`refine_from_walk`). Both
/// land the child `run_walk` finds on that job. With no generation open the
/// child is a generation of its own and the bank is back to size at once;
/// during one it joins it, and the stop retires what `refine_retiring`
/// named, sparing the ⚡ seed. A job dropped (`refine_from_cancel`), an
/// unknown seed and an untaught engine each say so.
#[test]
fn evolve_from_this_on_the_farm_is_evolve_from_this() {
    let mut engine = taught_wasm(0x1F7);
    let size = pool_ids(&engine).len();
    // The farm's path, from the best member.
    let id = pool_ids(&engine)[0];
    let reply = engine.refine_from_job(id, "[]");
    let v: serde_json::Value = serde_json::from_str(&reply).unwrap();
    let result = farm_walk(
        &serde_json::to_string(&v["context"]).unwrap(),
        &serde_json::to_string(&v["job"]).unwrap(),
    );
    let (_, _, want) = WALK_MEMO.with(|memo| walk_of(&reply, memo));
    assert_eq!(result, serde_json::to_string(&want).unwrap());
    let child = engine.refine_from_absorb(id, &result);
    lands(&engine, child, &want);
    assert_eq!(pool_ids(&engine).len(), size, "retired at once");
    // The engine's own path: the job drawn first, then walked here.
    let id = pool_ids(&engine)[1];
    let reply = engine.refine_from_job(id, "[]");
    let (_, _, also) = walk_of(&reply, engine.engine.memo());
    let other = engine.refine_from_walk(id);
    lands(&engine, other, &also);
    assert!(
        child > 0 || other > 0,
        "no ⚡ landed, so no child was compared"
    );

    // During a generation: the child joins it, nothing is retired until
    // the stop, and the stop spares the ⚡ seed, the lowest member.
    assert!(engine.refine_jobs().contains("\"jobs\""));
    let seed = *pool_ids(&engine).last().unwrap();
    let reply = engine.refine_from_job(seed, "[]");
    let (_, _, want) = walk_of(&reply, engine.engine.memo());
    assert!(
        want.child.is_some(),
        "fixture: the lowest member's ⚡ moves"
    );
    // `farm_walk`'s answer, as the farm's path above shows it to be.
    let result = serde_json::to_string(&want).unwrap();
    let child = engine.refine_from_absorb(seed, &result);
    lands(&engine, child, &want);
    assert_eq!(
        pool_ids(&engine).len(),
        size + 1,
        "nothing retired before the stop"
    );
    let would = engine.refine_retiring();
    let named: Vec<u32> = serde_json::from_str(&would).unwrap();
    assert_eq!(named.len(), 1);
    assert!(!named.contains(&seed), "the ⚡ seed is spared");
    assert_eq!(
        engine.refine_finish(),
        would,
        "the stop retires what was named"
    );
    assert_eq!(engine.refine_retired(), would);

    // A dropped job is gone; a broken result changes nothing.
    let id = pool_ids(&engine)[0];
    assert!(engine.refine_from_job(id, "[]").contains("\"job\""));
    assert!(engine.refine_from_cancel(id));
    assert!(!engine.refine_from_cancel(id), "dropped once");
    assert_eq!(engine.refine_from_walk(id), 0);
    assert_eq!(engine.last_refine_reason(), "unknown_seed");
    assert_eq!(engine.refine_from_absorb(id, "{"), 0);
    assert_eq!(
        engine.refine_from_job(0xDEAD, "[]"),
        r#"{"reason":"unknown_seed"}"#
    );
    let mut cold = WasmEngine::new(0x1F7, 4);
    while cold.fill_step(4) > 0 {}
    assert_eq!(
        cold.refine_from_job(pool_ids(&cold)[0], "[]"),
        r#"{"reason":"no_taste"}"#
    );
}

/// **A listening seed evolves on the farm as it does in the engine, with
/// the session's clip and its take.** AUDIO IN is a player kind, so a
/// player's patch with one is inside the prior's support and ⚡ walks it.
/// The seed (a filter over input 3, mixed with a CAPTURE of input 1
/// holding a take) is imported into twins that hold the same captured
/// clip. Every ⚡ starts (never `outside_support`); the farm's job carries
/// the session's phrase with its clip and the seed with its take, and the
/// child it lands is the engine's own. A child keeps its inputs and its
/// take.
#[test]
fn a_listening_seed_evolves_on_the_farm_with_its_clip_and_take() {
    use auracle_grammar::term::{
        AmpEnv, AudioNode, CaptureMode, FilterKind, InputChannel, ModNode,
    };
    use auracle_grammar::{Take, Uid, INPUT_GAIN_UNITY};
    let (mut serial, mut farmed) = twins(0xA0D1);
    // A plucked 220 Hz figure, three seconds at 48 kHz, as a browser
    // would capture it.
    let rate = 48_000.0f32;
    let clip: Vec<f32> = (0..(3.0 * rate) as usize)
        .map(|i| {
            let t = i as f32 / rate;
            let env = (-(t % 0.5) * 6.0).exp();
            (t * 220.0 * std::f32::consts::TAU).sin() * 0.3 * env
        })
        .collect();
    let take: Vec<f32> = (0..4_000).map(|i| (i as f32 * 0.05).sin() * 0.4).collect();
    let seed = PatchTree {
        amp: AmpEnv {
            attack: 0.05,
            decay: 0.3,
            sustain: 0.8,
            release: 0.3,
        },
        root: AudioNode::Mix {
            uid: Uid::NEW,
            balance: 0.5,
            a: Box::new(AudioNode::Filter {
                uid: Uid::NEW,
                kind: FilterKind::SvfLp,
                cutoff: 0.55,
                resonance: 0.2,
                mod_depth: 0.0,
                input: Box::new(AudioNode::AudioIn {
                    uid: Uid::NEW,
                    input: 3,
                    gain: INPUT_GAIN_UNITY,
                    channel: InputChannel::Both,
                }),
                modulation: ModNode::None,
            }),
            b: Box::new(AudioNode::Capture {
                uid: Uid::NEW,
                play: CaptureMode::Hold,
                input: Box::new(AudioNode::AudioIn {
                    uid: Uid::NEW,
                    input: 1,
                    gain: INPUT_GAIN_UNITY,
                    channel: InputChannel::Left,
                }),
                take: Take::from_samples(&take, 44_100.0).unwrap(),
            }),
        },
    };
    let json = serde_json::to_string(&seed).unwrap();
    let mut ids = Vec::new();
    for e in [&mut serial, &mut farmed] {
        let r: serde_json::Value =
            serde_json::from_str(&e.set_audition_clip(clip.clone(), 1, rate as f64)).unwrap();
        assert_eq!(r["ok"], true, "{r}");
        ids.push(e.import_patch(&json, "Mic Pad"));
    }
    let (a, b) = (ids[0], ids[1]);
    assert!(a > 0 && b > 0, "the listening patch was not admitted");
    let phrase: serde_json::Value = serde_json::from_str(&farmed.phrase_json()).unwrap();
    assert!(
        !phrase["clip"].is_null(),
        "the session's phrase carries no clip"
    );
    let mut landed = 0;
    for attempt in 0..4 {
        let here = serial.refine_from(a, "[]");
        assert_ne!(
            serial.last_refine_reason(),
            "outside_support",
            "attempt {attempt}"
        );
        let reply: serde_json::Value =
            serde_json::from_str(&farmed.refine_from_job(b, "[]")).unwrap();
        assert_eq!(
            reply["context"]["phrase"], phrase,
            "the walk's context is not the session's phrase with its clip"
        );
        let job: auracle_session::WalkJob =
            serde_json::from_value(reply["job"].clone()).expect("a job");
        assert!(
            job.seed.listens() && job.seed.has_takes(),
            "the job lost the seed's input or take"
        );
        let result = farm_walk(
            &serde_json::to_string(&reply["context"]).unwrap(),
            &serde_json::to_string(&reply["job"]).unwrap(),
        );
        let there = farmed.refine_from_absorb(b, &result);
        assert_eq!(
            here, there,
            "attempt {attempt}: the farm's ⚡ landed elsewhere"
        );
        assert_eq!(serial.last_refine_reason(), farmed.last_refine_reason());
        if here > 0 {
            landed += 1;
            let child: PatchTree = serde_json::from_str(&serial.tree_json_of(here)).unwrap();
            assert!(
                child.listens(),
                "the child lost its input: {}",
                child.to_sexpr()
            );
            assert_eq!(
                child.input_sites().len(),
                seed.input_sites().len(),
                "{}",
                child.to_sexpr()
            );
            assert!(
                child.has_takes(),
                "the child lost the take: {}",
                child.to_sexpr()
            );
        }
    }
    println!("{landed} of 4 ⚡ walks from the listening seed landed a child");
    // Every comparison above is about a child: with none landed, the
    // test would pass having compared nothing.
    assert!(landed > 0, "no ⚡ from the listening seed landed a child");
    assert_eq!(farmed.ranked(), serial.ranked());
}

/// PERFORM's measurement wires the six it always has unless the worker
/// names palette controls, and then exactly those, in the order named,
/// each with its name and its palette `index`, which is how the page
/// names it back (a position is not: asked for Bite then Warmth, position
/// 0 is Bite, and 0 is Bright to an offer). The request is read entry by
/// entry: an index out of range, a repeat, a negative, a fraction or a
/// string is dropped alone, and naming the six is the same as naming none
/// (the panel's request, unchanged). Naming nothing wires nothing and
/// renders no nudge. The plan and its finish take the same set, and a
/// finish whose renders are all in the memo is the one-call answer.
#[test]
fn perform_wire_measures_the_palette_controls_asked_for() {
    use auracle_session::perform::{CONTROLS, PALETTE};
    let mut engine = WasmEngine::new(3, 6);
    while engine.fill_step(3) > 0 {}
    let ids = pool_ids(&engine);
    let (id, other) = (ids[0], ids[1]);
    // `(name, index)` of each wiring, in reply order.
    let wired = |reply: &str| -> Vec<(String, Option<usize>)> {
        let v: serde_json::Value = serde_json::from_str(reply).unwrap();
        v["wiring"]
            .as_array()
            .expect("a wiring")
            .iter()
            .map(|w| {
                let index = w["index"].as_u64().map(|k| k as usize);
                (w["name"].as_str().unwrap().to_string(), index)
            })
            .collect()
    };
    let palette = |ks: &[usize]| -> Vec<(String, Option<usize>)> {
        ks.iter()
            .map(|&k| (PALETTE[k].name.to_string(), Some(k)))
            .collect()
    };

    // Naming nothing: the patch's knobs and z, no wiring, and none of the
    // nudges a Jacobian renders (the pool's member is already in the memo).
    let lone = engine.tree_json_of(other);
    let misses = || {
        serde_json::from_str::<serde_json::Value>(&engine.memo_stats()).unwrap()["misses"]
            .as_u64()
            .unwrap()
    };
    let before = misses();
    assert_eq!(
        engine.perform_wire_plan(&lone, "[]", "[]", Some("[]".into())),
        "[]"
    );
    let empty: serde_json::Value =
        serde_json::from_str(&engine.perform_wire(&lone, "[]", Some("[]".into()))).unwrap();
    assert_eq!(misses(), before, "naming nothing rendered");
    assert_eq!(empty["wiring"], serde_json::json!([]));
    assert!(empty["addrs"].as_array().is_some_and(|a| !a.is_empty()) && empty["z"].is_array());
    assert_ne!(
        engine.perform_wire_plan(&lone, "[]", "[]", Some("[6]".into())),
        "[]",
        "naming one control owes the Jacobian's nudges"
    );

    assert!(engine.edit_begin(id));
    let tree = engine.edit_tree_json();
    let six = engine.perform_wire(&tree, "[]", None);
    assert_eq!(wired(&six), palette(&[0, 1, 2, 3, 4, 5]));
    assert!(CONTROLS.iter().zip(&PALETTE).all(|(a, b)| a.name == b.name));
    assert_eq!(
        engine.perform_wire(&tree, "[]", Some("[0,1,2,3,4,5]".into())),
        six,
        "naming the six is the panel's request"
    );
    for not_a_set in ["not json", "{\"0\": 6}", "6"] {
        assert_eq!(
            engine.perform_wire(&tree, "[]", Some(not_a_set.into())),
            six,
            "{not_a_set}: what is not an array is the six"
        );
    }
    // A request in an order that is not the palette's.
    let asked = engine.perform_wire(&tree, "[]", Some("[16, 6, 99, 16, 0]".into()));
    assert_eq!(wired(&asked), palette(&[16, 6, 0]));
    assert_ne!(wired(&asked)[0].1, Some(0), "position 0 is not index 0");
    for (ask, want) in [
        ("[6, -1]", vec![6]),
        ("[6, 1.5]", vec![6]),
        ("[6.0]", vec![6]),
        ("[\"6\", 7]", vec![7]),
        ("[1e21]", vec![]),
        ("[]", vec![]),
    ] {
        let reply = engine.perform_wire(&tree, "[]", Some(ask.into()));
        assert_eq!(wired(&reply), palette(&want), "{ask}");
    }
    let all = format!("{:?}", (0..PALETTE.len()).collect::<Vec<_>>());
    let full = engine.perform_wire(&tree, "[]", Some(all.clone()));
    assert_eq!(
        wired(&full),
        palette(&(0..PALETTE.len()).collect::<Vec<_>>())
    );
    assert_eq!(
        engine.perform_wire_plan(&tree, "[]", "[]", Some(all.clone())),
        "[]",
        "everything the eighteen need is in the memo"
    );
    assert_eq!(
        engine.perform_wire_known(&tree, "[]", "[]", Some(all)),
        full
    );
}

/// A search control's offer says how far it moved the way it was turned
/// (ADR-008): `moved`, a number in σ that is the engine's own measure of the
/// move along that control's direction. A palette index names the same
/// control to an offer as to a wiring (`perform_wire`'s `index`), one of the
/// panel's six (Grit) as one past them (16, Bite). The Offer button's reply
/// has no `moved`, and neither does one for a control that does not exist
/// (it walks undirected).
#[test]
fn an_aimed_offer_reply_carries_how_far_it_moved() {
    use auracle_session::perform::{CONTROLS, PALETTE};
    let mut engine = WasmEngine::new(3, 6);
    while engine.fill_step(3) > 0 {}
    assert!(engine.edit_begin(pool_ids(&engine)[0]));
    let tree_json = engine.edit_tree_json();
    let home: PatchTree = serde_json::from_str(&tree_json).unwrap();
    let grit = CONTROLS.iter().position(|c| c.name == "Grit").unwrap() as u32;
    assert_eq!(PALETTE[16].name, "Bite");
    for k in [grit, 16] {
        // The first offer that grows: a walk may not move at all.
        let (reply, grown) = (0..4)
            .find_map(|_| {
                let reply = engine.perform_offer(&tree_json, "{}", "[]", 6, Some(k), Some(1.0));
                let v: serde_json::Value = serde_json::from_str(&reply).unwrap();
                let grown: PatchTree = serde_json::from_value(v.get("tree")?.clone()).unwrap();
                Some((v, grown))
            })
            .unwrap_or_else(|| panic!("no offer aimed along {} grew", PALETTE[k as usize].name));
        let moved = reply["moved"]
            .as_f64()
            .expect("an aimed offer says how far it moved");
        let want = engine
            .engine
            .moved_along(&home, &grown, k as usize)
            .unwrap();
        assert!((moved - want).abs() < 1e-9, "{k}: {moved} vs {want}");
    }
    for (control, sign) in [(None, None), (Some(99), Some(-1.0))] {
        let reply = engine.perform_offer(&tree_json, "{}", "[]", 6, control, sign);
        let v: serde_json::Value = serde_json::from_str(&reply).unwrap();
        assert!(v.get("moved").is_none(), "{control:?}: {reply}");
    }
}

/// **The worker's way of asking is the same offer.** `perform_offer` is
/// `perform_offer_begin`, stepped to its end, and `perform_job_finish`; the
/// worker steps one render at a time and answers the player between steps.
/// Two twins taught alike and asked alike give the same reply, even when a
/// pick is recorded on one of them between two steps: the walk keeps the
/// target it began on. (That stepping cannot change any kind of walk is the
/// session's `a_stepped_walk_is_the_walk`.) A handle is spent by its reply
/// or its drop, one not in hand answers as nothing, and handles count up
/// past the top of `u32` without ever being 0 or one still in hand.
#[test]
fn a_stepped_offer_gives_the_reply_the_one_call_gives() {
    let (mut one, mut stepped) = twins(5);
    // The same tree for both (module uids come off a process-wide counter,
    // so the twins' own copies are numbered apart).
    assert!(one.edit_begin(pool_ids(&one)[0]));
    let tree = one.edit_tree_json();
    let want = one.perform_offer(&tree, "[]", "[]", 4, None, None);
    let grown: serde_json::Value = serde_json::from_str(&want).unwrap();
    assert!(
        grown.get("tree").is_some(),
        "fixture: the offer grows: {want}"
    );
    let handle = |reply: String| -> u32 {
        let v: serde_json::Value = serde_json::from_str(&reply).unwrap();
        v["job"].as_u64().expect("a walk begins") as u32
    };
    let job = handle(stepped.perform_offer_begin(&tree, "[]", "[]", 4, None, None));
    assert_eq!(stepped.jobs.len(), 1);
    assert!(
        stepped.perform_job_step(job, 1),
        "a walk of several renders is several steps"
    );
    // A pick, between two steps.
    let offer = grown["tree"].to_string();
    assert!(stepped.perform_record(&tree, "[]", &offer, true, u32::MAX));
    while stepped.perform_job_step(job, 1) {}
    assert_eq!(stepped.perform_job_finish(job), want);
    assert_eq!(stepped.jobs.len(), 0, "the handle was spent");
    // Not in hand: nothing to step, nothing to answer.
    assert!(!stepped.perform_job_step(job, 1));
    assert_eq!(stepped.perform_job_finish(job), "null");
    // Dropped: spent, and not answered.
    let dropped = handle(stepped.perform_offer_begin(&tree, "[]", "[]", 4, None, None));
    assert!(stepped.perform_job_drop(dropped));
    assert!(!stepped.perform_job_drop(dropped));
    assert_eq!(stepped.jobs.len(), 0);
    // Four billion handles later: past the top, 0 is skipped, and so is a
    // handle still in hand.
    stepped.next_job = u32::MAX;
    let begin =
        |e: &mut WasmEngine| handle(e.perform_offer_begin(&tree, "[]", "[]", 4, None, None));
    assert_eq!(begin(&mut stepped), u32::MAX);
    assert_eq!(begin(&mut stepped), 1, "0 is never a handle");
    stepped.next_job = 1;
    assert_eq!(begin(&mut stepped), 2, "1 is still in hand");
}

/// A walk's reply says what was true when it began. A drift begun before
/// any taste existed says `taste: false` even if a posterior was fitted
/// before it finished (an import, a refit): it was walked on the grammar.
#[test]
fn a_walk_replies_with_the_state_it_began_in() {
    let mut engine = WasmEngine::new(7, 12);
    engine.engine.cfg.mcmc_samples = 3_000;
    engine.engine.cfg.mcmc_warmup = 1_000;
    while engine.fill_step(4) > 0 {}
    let id = pool_ids(&engine)[0];
    assert!(engine.edit_begin(id));
    let tree = engine.edit_tree_json();
    assert!(!engine.engine.has_taste(), "an untaught engine");
    let begun: serde_json::Value =
        serde_json::from_str(&engine.perform_drift_begin(&tree, "[]", "[]", 6, 0.15)).unwrap();
    let job = begun["job"].as_u64().expect("a drift begins") as u32;
    assert!(engine.perform_job_step(job, 1));
    for _ in 0..16 {
        let [a, b]: [u64; 2] = serde_json::from_str::<Option<[u64; 2]>>(&engine.next_duel())
            .unwrap()
            .expect("a duel");
        engine.record_duel(a as u32, b as u32, (a * 7 + b) % 3 != 0);
    }
    engine.fit();
    assert!(engine.engine.has_taste(), "taught while the drift was out");
    while engine.perform_job_step(job, 1) {}
    let reply: serde_json::Value = serde_json::from_str(&engine.perform_job_finish(job)).unwrap();
    // A six-step knob drift at σ 0.15 from a vetted member moves: the
    // reply carries a tree, and so the state it began in.
    assert!(
        reply.get("reason").is_none(),
        "the drift grew nothing: {reply}"
    );
    assert_eq!(reply["taste"], false, "{reply}");
    // A walk begun now is taste-directed.
    let begun: serde_json::Value =
        serde_json::from_str(&engine.perform_drift_begin(&tree, "[]", "[]", 6, 0.15)).unwrap();
    assert!(begun.get("job").is_some(), "a drift begins");
    let reply: serde_json::Value =
        serde_json::from_str(&engine.run_job(&begun.to_string())).unwrap();
    assert!(
        reply.get("reason").is_none(),
        "the drift grew nothing: {reply}"
    );
    assert_eq!(reply["taste"], true, "{reply}");
}

/// A draw on one stream never moves another: a spare offer grown in the
/// background, however early or late it lands, leaves the duels and the
/// fills where they were. And a fit's generator is a function of the seed
/// and the evidence count alone.
#[test]
fn a_consumer_draws_only_from_its_own_stream() {
    let mut quiet = Streams::new(20260927);
    let mut busy = Streams::new(20260927);
    for _ in 0..1000 {
        busy.perform.next_u64();
        busy.refine.next_u64();
    }
    for _ in 0..8 {
        assert_eq!(quiet.duel.next_u64(), busy.duel.next_u64());
        assert_eq!(quiet.fill.next_u64(), busy.fill.next_u64());
    }
    assert_eq!(quiet.fit(55).next_u64(), busy.fit(55).next_u64());
    assert_ne!(quiet.fit(55).next_u64(), quiet.fit(56).next_u64());
    // Distinct streams, not one stream under four names.
    let mut s = Streams::new(7);
    let firsts = [
        s.fill.next_u64(),
        s.duel.next_u64(),
        s.refine.next_u64(),
        s.perform.next_u64(),
    ];
    for i in 0..firsts.len() {
        for j in i + 1..firsts.len() {
            assert_ne!(firsts[i], firsts[j]);
        }
    }
}

/// The structural-edit vocabulary is a **wire format**: `main.js` builds
/// these payloads by hand and posts them at `apply_struct_op`, and the
/// same strings are what `describe` reports as a module's `kind`, so the
/// palette, the faceplate and the edit all key off one spelling. A serde
/// rename drifting from the rack description would be invisible in Rust
/// and would break exactly one button in the browser.
#[test]
fn the_structural_edit_vocabulary_keeps_its_spellings() {
    use auracle_grammar::{ModKind, NodeKind};
    for (kind, want) in [
        (NodeKind::Vco, "vco"),
        (NodeKind::Supersaw, "supersaw"),
        (NodeKind::Noise, "noise"),
        (NodeKind::Wavetable, "wavetable"),
        (NodeKind::Pluck, "pluck"),
        (NodeKind::Mix, "mix"),
        (NodeKind::Filter, "filter"),
        (NodeKind::Fold, "fold"),
        (NodeKind::Delay, "delay"),
        (NodeKind::Chorus, "chorus"),
        (NodeKind::Reverb, "reverb"),
        (NodeKind::Distortion, "distortion"),
        (NodeKind::Bitcrush, "bitcrush"),
        (NodeKind::Phaser, "phaser"),
        // Not `ring_mod`: `describe` reports `ringmod`, and one module
        // must not have two names.
        (NodeKind::RingMod, "ringmod"),
        (NodeKind::Formant, "formant"),
        (NodeKind::Flanger, "flanger"),
        (NodeKind::Tremolo, "tremolo"),
        (NodeKind::Vibrato, "vibrato"),
        (NodeKind::Eq, "eq"),
        (NodeKind::Granular, "granular"),
        (NodeKind::Shift, "shift"),
        (NodeKind::Comp, "comp"),
        (NodeKind::Duck, "duck"),
        (NodeKind::Gate, "gate"),
        (NodeKind::Vocoder, "vocoder"),
        // The empty socket, which `describe` reports as `silence`.
        (NodeKind::Silence, "silence"),
        // The player's input, which `describe` reports as `audio_in`.
        (NodeKind::AudioIn, "audio_in"),
    ] {
        assert_eq!(serde_json::to_string(&kind).unwrap(), format!("\"{want}\""));
    }
    for (kind, want) in [
        (ModKind::None, "none"),
        (ModKind::Lfo, "lfo"),
        (ModKind::Env, "env"),
        (ModKind::Rand, "rand"),
        (ModKind::Follow, "follow"),
        // Wave 2C. Each of these is also a `RackModule::kind` — the
        // shapers report `ModOp::label`/`PairOp::label`, which are the
        // same eleven strings, so the palette button and the module it
        // produces agree exactly as they do for the audio kinds.
        (ModKind::Euclid, "euclid"),
        (ModKind::Quantize, "quantize"),
        (ModKind::Slew, "slew"),
        (ModKind::Rectify, "rectify"),
        (ModKind::Hold, "hold"),
        (ModKind::Min, "min"),
        (ModKind::Max, "max"),
        (ModKind::And, "and"),
        (ModKind::Or, "or"),
        (ModKind::Xor, "xor"),
        (ModKind::Switch, "switch"),
        // A leaf, and a `RackModule::kind` too: `describe` reports
        // `steps` for the module this places.
        (ModKind::Steps, "steps"),
    ] {
        assert_eq!(serde_json::to_string(&kind).unwrap(), format!("\"{want}\""));
    }
    // Every buildable kind is also a kind the rack description names, so
    // the palette button and the module it produces agree.
    for kind in [
        NodeKind::Wavetable,
        NodeKind::Pluck,
        NodeKind::Distortion,
        NodeKind::Bitcrush,
        NodeKind::Phaser,
        NodeKind::RingMod,
        NodeKind::Formant,
        NodeKind::Flanger,
        NodeKind::Tremolo,
        NodeKind::Vibrato,
        NodeKind::Eq,
        NodeKind::Granular,
        NodeKind::Shift,
        NodeKind::Comp,
        NodeKind::Duck,
        NodeKind::Gate,
        NodeKind::Vocoder,
        NodeKind::Silence,
        NodeKind::AudioIn,
    ] {
        let tree = auracle_grammar::apply_struct_op(
            &auracle_grammar::presets()[0].1,
            &auracle_grammar::StructOp::Replace {
                key: "node".into(),
                kind,
            },
        )
        .expect("replace at the root always applies");
        let rack = auracle_grammar::describe(&tree);
        let spelled = serde_json::to_string(&kind).unwrap();
        assert!(
            rack.modules
                .iter()
                .any(|m| format!("\"{}\"", m.kind) == spelled),
            "no module named {spelled} in the rack it built"
        );
    }
}

/// Drive one pool fill entirely through the farm boundary: the exact JSON
/// shapes, index types and byte buffers `farm.js` and `worker.js` move.
fn farm_fill(engine: &mut WasmEngine, want_audio: bool) {
    let phrase = engine.phrase_json();
    loop {
        let wave: Vec<serde_json::Value> =
            serde_json::from_str(&engine.fill_draw(4)).expect("fill_draw JSON");
        if wave.is_empty() {
            break;
        }
        // Deliberately absorbed in issue order after rendering the whole
        // wave — the reordering a real farm introduces lives between these
        // two loops.
        let mut results = Vec::new();
        for job in &wave {
            let index = job["i"].as_u64().expect("draw index") as u32;
            let tree = serde_json::to_string(&job["tree"]).expect("tree JSON");
            if job["dup"].as_bool().unwrap_or(false) {
                results.push((index, String::new(), Vec::new()));
                continue;
            }
            let mut r = farm_render(&tree, &phrase, want_audio);
            if !r.ok() {
                results.push((index, String::new(), Vec::new()));
                continue;
            }
            results.push((index, r.cached(), r.take_samples()));
        }
        for (index, cached, samples) in results {
            engine.fill_absorb(index, &cached, &samples);
        }
        let st: serde_json::Value = serde_json::from_str(&engine.status()).expect("status JSON");
        if st["pool"].as_u64() >= st["pool_target"].as_u64() {
            break;
        }
    }
}

/// A saved session with its node identities stripped.
///
/// Two engines that built the same patches by different routes are the
/// same session, and identities are the one thing that legitimately differs
/// between them: uids come from a process-global mint, so the second engine
/// in a test has simply counted further. Comparing exports is comparing
/// *content*, and content is what this strips to. (The identities
/// themselves are pinned by the grammar and session suites.)
fn session_content(engine: &WasmEngine) -> String {
    let mut state: auracle_session::SessionState =
        serde_json::from_str(&engine.export_session()).expect("a session round-trips");
    for entry in &mut state.bank {
        entry.tree.clear_uids();
    }
    serde_json::to_string(&state).expect("a session serializes")
}

/// The whole point, at the boundary the browser actually crosses: a pool
/// filled through `fill_draw` → `farm_render` → `fill_absorb` is the pool
/// `fill_step` builds. If these ever disagree, a user whose browser cannot
/// spawn a worker is running a different instrument.
#[test]
fn the_farm_boundary_builds_the_serial_pool() {
    let mut serial = WasmEngine::new(0xBEEF, 6);
    while serial.fill_step(2) > 0 {}
    let mut farmed = WasmEngine::new(0xBEEF, 6);
    farm_fill(&mut farmed, false);
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&serial.status()).unwrap()["pool"],
        serde_json::from_str::<serde_json::Value>(&farmed.status()).unwrap()["pool"],
    );
    assert_eq!(
        session_content(&serial),
        session_content(&farmed),
        "the farm boundary built a different session than the serial fill"
    );
}

/// A face is the picture of the audition the member plays from, taken
/// from the memo when its row has one and from a render when it has not
/// (a row stored before faces existed).
#[test]
fn a_members_face_is_its_stored_auditions_from_the_memo_or_a_render() {
    let mut engine = WasmEngine::new(3, 8);
    farm_fill(&mut engine, false);
    let ids: Vec<u64> = engine.engine.pool.iter().map(|c| c.id).collect();
    for &id in &ids {
        // From the memo: the fill featurized it, and the face came with it.
        let from_memo = engine.face_of(id as u32, false);
        assert_eq!(from_memo.len(), auracle_features::FACE_LEN);
        let stored = engine.engine.render_of(id).expect("renders");
        let of_audition = Face::of_f32(&stored.samples, stored.sample_rate);
        assert_eq!(
            from_memo,
            of_audition.bytes(),
            "id {id}: the picture of the audition it plays"
        );
        assert!(engine
            .face_key(id as u32)
            .ends_with(&engine.engine.pool[engine.engine.find(id).unwrap()].key));
    }
    // A row without a face (stored before faces), its audition resident:
    // the face is the audition's, and is written back onto the row.
    let id = ids[0];
    let i = engine.engine.find(id).unwrap();
    let key = engine.engine.pool[i].key.clone();
    let want = engine.face_of(id as u32, false);
    let faceless = |e: &WasmEngine| {
        let mut row = e.engine.memo().get(&key).unwrap();
        row.face = None;
        e.engine.memo().put(row, None);
    };
    faceless(&engine);
    assert!(engine.engine.pool[i].render.is_some(), "fixture: resident");
    assert_eq!(engine.face_of(id as u32, false), want);
    assert!(
        engine.engine.memo().get(&key).unwrap().face.is_some(),
        "the face was not remembered"
    );
    // Not resident either: none without a render, the same face with one.
    faceless(&engine);
    engine.engine.pool[i].render = None;
    let tree = serde_json::to_string(&engine.engine.pool[i].tree).unwrap();
    assert!(
        engine.engine.memo().get_audio(&key).is_none(),
        "fixture: the memo holds no audio for this row"
    );
    assert!(
        engine.face_of(id as u32, false).is_empty(),
        "no face without a render"
    );
    assert_eq!(engine.face_of(id as u32, true), want);
    assert!(
        engine.engine.pool[i].render.is_none(),
        "a face's render is not kept: it evicts no audition"
    );
    assert_eq!(
        engine.face_of_tree(&tree, false),
        want,
        "and the tree's face is the member's"
    );
    assert!(engine.face_of(9_999, true).is_empty());
    assert!(engine.face_key(9_999).is_empty());
}

/// `render_of` hands WebAudio the audition at the level it is played at,
/// and the pool keeps the one φ was measured on. Seed 1's first eight hold
/// a slow swell the 30 dB cap stopped 17 dB short — its peaks are far
/// under the ceiling, so all of that comes back — and a sub-bass drone the
/// peak ceiling pulled 6 dB down, whose crest is in a sustained waveform,
/// so the limiter can return only part of it without clipping the wave
/// (`examples/pool_loudness.rs`, load 1).
#[test]
fn render_of_plays_the_audition_at_its_level_and_stores_it_untouched() {
    use auracle_features::{integrated_lufs, TARGET_LUFS};
    // A seed whose eight-patch pool holds at least two auditions more than
    // 3 dB short of the target: the fixture is chosen for them. (Seed 1
    // held two until the engine's randomness was split into one stream
    // per consumer, which moved every seeded pool.)
    let mut engine = WasmEngine::new(3, 8);
    farm_fill(&mut engine, true);
    let lufs = |x: &[f32]| {
        let x: Vec<f64> = x.iter().map(|s| f64::from(*s)).collect();
        integrated_lufs(&x, 44_100.0).expect("vetted, so not silent")
    };
    let ids: Vec<u64> = engine.engine.pool.iter().map(|c| c.id).collect();
    let (mut short, mut whole, mut untouched) = (0, 0, 0);
    for id in ids {
        let i = engine.engine.find(id).expect("pool member");
        let f = engine.engine.pool[i].features.clone();
        let stored = engine.engine.render_of(id).expect("renders");
        let played = engine.render_of(id as u32);
        assert_eq!(played.len(), stored.samples.len());
        assert!(
            played.iter().all(|s| s.abs() <= 1.0),
            "id {id} over full scale"
        );
        let shortfall = TARGET_LUFS - f.lufs_before - f.gain_db;
        if shortfall > 3.0 {
            short += 1;
            let (was, now) = (lufs(&stored.samples), lufs(&played));
            assert!(
                now > was + 1.0,
                "id {id}: {shortfall:.1} dB short, played {was:.1} → {now:.1} LUFS"
            );
            whole += usize::from((now - TARGET_LUFS).abs() < 0.5);
        } else if stored.samples.iter().all(|s| s.abs() < 0.45) {
            // At target, and too quiet for any point between the samples
            // to reach full scale: nothing to do, so nothing done.
            assert_eq!(played, stored.samples, "id {id} was touched");
            untouched += 1;
        }
        // The stored buffer is still exactly what the featurizer made.
        let replay = auracle_features::render_playback(
            &engine.engine.pool[i].tree,
            &engine.engine.cfg.phrase,
            f.gain_db,
        )
        .expect("renders");
        assert_eq!(
            replay.samples, stored.samples,
            "id {id}: the stored audition moved"
        );
    }
    assert!(short >= 2, "the fixture lost its short patches ({short})");
    assert!(whole >= 1, "no shortfall came back to the target");
    assert!(untouched >= 1, "the fixture lost its patches at the target");
}

/// Audio may ride along, and when it does it must be the render φ was
/// measured on. Asking for it must not move the pool either — it is a
/// transport option, not a featurization one.
#[test]
fn transported_audio_neither_moves_nor_misses_the_pool() {
    let mut dry = WasmEngine::new(0x1234, 4);
    farm_fill(&mut dry, false);
    let mut wet = WasmEngine::new(0x1234, 4);
    farm_fill(&mut wet, true);
    assert_eq!(
        session_content(&dry),
        session_content(&wet),
        "asking the farm for audio changed the pool"
    );
    // The absorbed buffer is what `render_of` hands WebAudio, and it must
    // match a fresh in-process render of the same term.
    let id = pool_ids(&wet)[0];
    let from_farm = wet.render_of(id);
    assert!(
        !from_farm.is_empty(),
        "absorbed audio never reached the pool"
    );
    // `dry` holds no audio: its render_of renders the term here.
    assert_eq!(
        from_farm,
        dry.render_of(id),
        "a transported audition drifted from the render it names"
    );
}

/// A result that does not survive transport is a *vet failure*, not an
/// admission: the draw's index is consumed and nothing enters the pool.
/// Admitting audio whose length disagrees with its own vet report would be
/// exactly the DESIGN §2.1 bypass the gate exists to prevent.
#[test]
fn a_corrupted_farm_result_burns_its_draw_and_admits_nothing() {
    let mut engine = WasmEngine::new(0x9999, 8);
    let phrase = engine.phrase_json();
    let wave: Vec<serde_json::Value> = serde_json::from_str(&engine.fill_draw(1)).unwrap();
    let index = wave[0]["i"].as_u64().unwrap() as u32;
    let tree = serde_json::to_string(&wave[0]["tree"]).unwrap();
    let mut r = farm_render(&tree, &phrase, true);
    assert!(r.ok(), "reference draw must render");
    let mut samples = r.take_samples();
    samples.truncate(samples.len() - 1);

    assert_eq!(engine.fill_cursor(), index);
    assert_eq!(
        engine.fill_absorb(index, &r.cached(), &samples),
        0,
        "a length-mismatched buffer was admitted"
    );
    assert_eq!(engine.fill_cursor(), index + 1, "the draw was not consumed");
    let st: serde_json::Value = serde_json::from_str(&engine.status()).unwrap();
    assert_eq!(st["pool"], 0, "a refused result still reached the pool");

    // An empty result (the farm's own vet failure) behaves identically.
    let next: Vec<serde_json::Value> = serde_json::from_str(&engine.fill_draw(1)).unwrap();
    let i2 = next[0]["i"].as_u64().unwrap() as u32;
    assert_eq!(engine.fill_absorb(i2, "", &[]), 0);
    assert_eq!(engine.fill_cursor(), i2 + 1);
}

/// Absorption is in index order, and out-of-order results are refused
/// rather than folded in — the invariant the whole width-equivalence
/// argument rests on. A reorder buffer that silently accepted them would
/// build a pool no other width reproduces.
#[test]
fn out_of_order_absorption_is_refused() {
    let mut engine = WasmEngine::new(0x77, 8);
    let phrase = engine.phrase_json();
    let wave: Vec<serde_json::Value> = serde_json::from_str(&engine.fill_draw(3)).unwrap();
    assert!(wave.len() >= 2, "need two draws to reorder");
    let cursor = engine.fill_cursor();
    let later = wave[1]["i"].as_u64().unwrap() as u32;
    let tree = serde_json::to_string(&wave[1]["tree"]).unwrap();
    let mut r = farm_render(&tree, &phrase, false);
    let samples = r.take_samples();
    assert_eq!(
        engine.fill_absorb(later, &r.cached(), &samples),
        0,
        "a result that jumped the queue was absorbed"
    );
    assert_eq!(
        engine.fill_cursor(),
        cursor,
        "the cursor moved out of order"
    );
}

/// A deferred restore rebuilds the session the serial restore rebuilds,
/// through the same index-addressed boundary the pool fill uses.
#[test]
fn deferred_restore_matches_the_serial_restore() {
    let mut origin = WasmEngine::new(0x5A5A, 5);
    while origin.fill_step(2) > 0 {}
    let saved = origin.export_session();

    let mut serial = WasmEngine::new(1, 5);
    let n_serial = serial.import_session(&saved);
    assert!(n_serial >= 3, "bank too small to test");

    let mut deferred = WasmEngine::new(1, 5);
    let phrase = deferred.phrase_json();
    let jobs: Vec<serde_json::Value> =
        serde_json::from_str(&deferred.import_session_deferred(&saved)).unwrap();
    assert_eq!(jobs.len(), n_serial);
    for job in &jobs {
        let index = job["i"].as_u64().unwrap() as usize;
        let tree = serde_json::to_string(&job["tree"]).unwrap();
        let mut r = farm_render(&tree, &phrase, false);
        assert!(deferred.bank_absorb(index, &r.cached(), &r.take_samples()));
    }
    assert_eq!(deferred.restore_finish(), n_serial);
    assert_eq!(
        serial.export_session(),
        deferred.export_session(),
        "the deferred restore rebuilt a different session"
    );
}

/// The tri-state the persistence layer was missing: a save the build
/// cannot parse, a save with nothing in it, and a real one are three
/// different answers. The first is the one that matters — it is the signal
/// "do not overwrite this record" — and both old methods folded it into
/// the second.
#[test]
fn a_restore_says_whether_it_could_read_the_save() {
    let mut origin = WasmEngine::new(0x5A5B, 4);
    while origin.fill_step(2) > 0 {}
    let saved = origin.export_session();
    let empty = WasmEngine::new(7, 4).export_session();

    let verdict = |s: &str| -> serde_json::Value { serde_json::from_str(s).unwrap() };

    let mut e = WasmEngine::new(1, 4);
    let v = verdict(&e.import_session_checked("{not json"));
    assert_eq!(v["status"], "unparseable");
    assert_eq!(v["restored"], 0);
    let v = verdict(&e.import_session_checked(&empty));
    assert_eq!(v["status"], "empty");
    let v = verdict(&e.import_session_checked(&saved));
    assert_eq!(v["status"], "ok");
    assert!(v["restored"].as_u64().unwrap() >= 3);

    let mut d = WasmEngine::new(1, 4);
    let v = verdict(&d.import_session_deferred_v2("[1,2,3]"));
    assert_eq!(v["status"], "unparseable");
    assert_eq!(v["jobs"].as_array().unwrap().len(), 0);
    let v = verdict(&d.import_session_deferred_v2(&empty));
    assert_eq!(v["status"], "empty");
    let v = verdict(&d.import_session_deferred_v2(&saved));
    assert_eq!(v["status"], "ok");
    // Same jobs as the old method hands out, so the farm loop is unchanged.
    let mut d2 = WasmEngine::new(1, 4);
    let old: serde_json::Value = serde_json::from_str(&d2.import_session_deferred(&saved)).unwrap();
    assert_eq!(v["jobs"], old);
}

/// A vote on an id the pool no longer holds is refused out loud. The app
/// used to count it, save, and toast "rated" while the engine had dropped
/// it on the floor.
#[test]
fn a_vote_on_a_gone_id_is_refused_not_swallowed() {
    let mut engine = WasmEngine::new(0x7E5, 4);
    while engine.fill_step(2) > 0 {}
    let (a, b) = (pool_ids(&engine)[0], pool_ids(&engine)[1]);
    let before = engine.engine.log.len();
    assert!(engine.record_duel(a, b, true));
    assert!(engine.record_keep(a, true));
    assert!(engine.record_stars(b, 4));
    assert_eq!(engine.engine.log.len(), before + 3);
    assert!(!engine.record_duel(a, 0xFFFF, true));
    assert!(
        !engine.record_duel(a, a, true),
        "a duel needs two candidates"
    );
    assert!(!engine.record_keep(0xFFFF, false));
    assert!(!engine.record_stars(0xFFFF, 1));
    assert_eq!(
        engine.engine.log.len(),
        before + 3,
        "a refused vote was logged"
    );
}

/// A cut patch is never dealt again. The cut hides the row and logs a
/// kill, but the patch stays in the pool until a generation replaces it;
/// dealing used to ignore the cut, so a sound the player had thrown out
/// came back as a duel side. The app passes its cut ids with every deal.
#[test]
fn a_cut_patch_is_never_dealt_again() {
    let mut engine = WasmEngine::new(0xC07, 6);
    while engine.fill_step(3) > 0 {}
    let ids = pool_ids(&engine);
    assert!(ids.len() >= 4, "pool too small to test: {}", ids.len());
    let cut = ids[0];
    assert!(engine.record_keep(cut, false));
    let dealt = |reply: String| -> Option<[u32; 2]> {
        let v: serde_json::Value = serde_json::from_str(&reply).unwrap();
        (!v.is_null()).then(|| {
            [
                v["a"].as_u64().unwrap() as u32,
                v["b"].as_u64().unwrap() as u32,
            ]
        })
    };
    // Without the exclusion the cut patch is dealt (the old behaviour),
    // which is what makes the check below mean something.
    let mut seen_uncut = false;
    for _ in 0..200 {
        let [a, b] = dealt(engine.next_duel_ex(None)).expect("a pair");
        seen_uncut |= a == cut || b == cut;
    }
    assert!(seen_uncut, "the cut patch was never dealt even unexcluded");
    for _ in 0..200 {
        let [a, b] = dealt(engine.next_duel_ex(Some(vec![cut]))).expect("a pair");
        assert!(a != cut && b != cut, "the cut patch #{cut} was dealt");
        assert_ne!(a, b);
    }
    // Cut all but one and there is no pair left to deal.
    assert_eq!(dealt(engine.next_duel_ex(Some(ids[1..].to_vec()))), None);
}

/// The app's deal is counted when it reports the pair on the table, not
/// when it is dealt: `deal_duel_ex` deals what `next_duel_ex` would from
/// the same stream, and only `duel_shown` of a pair it dealt counts.
#[test]
fn a_deal_counts_when_it_is_shown() {
    let fresh = || {
        let mut e = WasmEngine::new(0x5E1, 6);
        while e.fill_step(3) > 0 {}
        e
    };
    let pair = |reply: &str| -> [u32; 2] {
        let v: serde_json::Value = serde_json::from_str(reply).unwrap();
        [
            v["a"].as_u64().unwrap() as u32,
            v["b"].as_u64().unwrap() as u32,
        ]
    };
    let (mut counted, mut deferred) = (fresh(), fresh());
    for _ in 0..5 {
        let a = counted.next_duel_ex(None);
        let b = deferred.deal_duel_ex(None);
        assert_eq!(a, b, "one stream, one deal");
        let [x, y] = pair(&b);
        assert!(deferred.duel_shown(y, x));
        assert!(!deferred.duel_shown(x, y), "shown once");
    }
    // A pair never dealt is not shown. (That deals thrown away move
    // nothing is the session's discarded_deals_do_not_advance_the_check_cadence.)
    assert!(!deferred.duel_shown(u32::MAX, u32::MAX - 1), "never dealt");
}

/// The import route enforces the same ceilings as every other write route,
/// and the knob boundary refuses what `clamp` would let through.
#[test]
fn import_and_knob_boundaries_refuse_what_they_used_to_pass() {
    use auracle_grammar::term::{AudioNode, FilterKind, ModNode};
    use auracle_grammar::Uid;
    let mut engine = WasmEngine::new(0x1A7, 4);
    while engine.fill_step(2) > 0 {}
    assert_eq!(engine.last_refine_reason(), "idle");

    let mut deep = auracle_grammar::presets()[0].1.clone();
    while deep.root.depth() <= auracle_grammar::mutate::MAX_DEPTH {
        deep.root = AudioNode::Filter {
            uid: Uid::NEW,
            kind: FilterKind::SvfLp,
            cutoff: 0.5,
            resonance: 0.2,
            mod_depth: 0.0,
            input: Box::new(deep.root),
            modulation: ModNode::None,
        };
    }
    let pool_before = engine.engine.pool.len();
    assert_eq!(
        engine.import_patch(&serde_json::to_string(&deep).unwrap(), "too deep"),
        0
    );
    assert_eq!(
        engine.engine.pool.len(),
        pool_before,
        "the over-ceiling tree landed"
    );
    // A legal preset still imports (a novel one — the pool holds prior draws).
    let ok = auracle_grammar::presets()[3].1.clone();
    assert_ne!(
        engine.import_patch(&serde_json::to_string(&ok).unwrap(), "fine"),
        0
    );

    let id = pool_ids(&engine)[0];
    assert!(engine.edit_begin(id));
    let before = engine.edit_tree_json();
    assert!(!engine.edit_param("amp#attack", f64::NAN, false));
    assert!(!engine.edit_param("amp#attack", f64::INFINITY, false));
    assert_eq!(
        engine.edit_tree_json(),
        before,
        "a refused knob moved the bench"
    );
    // A knob dragged to the stop lands inside the half-open domain.
    assert!(engine.edit_param("amp#attack", 1.0, false));
    let t: auracle_grammar::PatchTree = serde_json::from_str(&engine.edit_tree_json()).unwrap();
    assert_eq!(t.amp.attack, auracle_grammar::PARAM_MAX);
}

/// The numbers the app reads from the engine rather than restating them
/// are the grammar's: the hand-edit ceilings, and the longest take a
/// CAPTURE holds.
#[test]
fn the_budget_ceilings_are_the_grammars() {
    let b: serde_json::Value = serde_json::from_str(&budget_ceilings()).unwrap();
    assert_eq!(b["size"], auracle_grammar::mutate::MAX_SIZE);
    assert_eq!(b["depth"], auracle_grammar::mutate::MAX_DEPTH);
    assert_eq!(b["mod"], auracle_grammar::mutate::MAX_MOD_DEPTH);
    assert_eq!(take_seconds(), auracle_grammar::TAKE_SECONDS);
}

/// Re-issue is stateless: the term at a draw index is recoverable from the
/// engine alone, so a farm worker that dies mid-job costs its render and
/// nothing else. Nobody has to have kept the tree JSON.
#[test]
fn a_lost_job_is_recoverable_from_its_index_alone() {
    let mut engine = WasmEngine::new(0x1D, 8);
    let wave: Vec<serde_json::Value> = serde_json::from_str(&engine.fill_draw(2)).unwrap();
    for job in &wave {
        let index = job["i"].as_u64().unwrap() as u32;
        let reissued: serde_json::Value =
            serde_json::from_str(&engine.draw_json(index)).expect("re-issued tree JSON");
        assert_eq!(
            reissued, job["tree"],
            "draw {index} could not be re-derived from its index"
        );
    }
    // And it stays true after the pool has moved underneath it: the stream
    // is indexed, not advanced.
    let far = engine.draw_json(37);
    while engine.fill_step(2) > 0 {}
    assert_eq!(engine.draw_json(37), far, "the draw stream advanced");
}

/// The commit duel's gate. `wb.dirty` in the panel means "the player
/// touched something", which is a different question from "is there
/// anything to compare": turn a knob and turn it back, or undo to where
/// you started, and dealing a duel would be asking which of two identical
/// patches is better — a question whose answer is a row of noise in the
/// preference log.
#[test]
fn a_bench_edited_back_to_where_it_started_has_no_duel_to_deal() {
    let mut engine = WasmEngine::new(0xD0E1, 6);
    while engine.fill_step(3) > 0 {}
    let id = pool_ids(&engine)[0];
    assert!(engine.edit_begin(id));
    assert_eq!(engine.edit_original_id(), id);
    assert!(
        !engine.edit_differs_from_original(),
        "a freshly benched patch is the patch it came from"
    );

    let before = engine.edit_tree_json();
    assert!(engine.edit_param("amp#attack", 0.42, false));
    assert!(engine.edit_differs_from_original(), "a knob moved");
    // …and back, through the same route undo takes.
    assert_eq!(engine.edit_set_tree(&before), "");
    assert!(
        !engine.edit_differs_from_original(),
        "returning to the original tree still read as an edit"
    );
}

/// A selector's tree reaches the voices with the makeup its own render
/// measured, never the previous tree's: on a sample of the presets'
/// selector changes (every enum site but `table` and `oct`, every other
/// option; `examples/selector_makeup.rs` walks all 355), the makeup that
/// comes back with the edited tree is the one a full measurement of that
/// tree gives. The previous tree's makeup was off by more than 3 dB on
/// almost half of the changes, up to 27 dB hot.
#[test]
fn a_selector_change_comes_back_at_its_measured_makeup() {
    use auracle_grammar::describe::KnobKind;
    let phrase = PhraseSpec::default();
    let mut changes = Vec::new();
    for (name, tree) in presets() {
        for module in describe(&tree).modules {
            for knob in module.knobs {
                let KnobKind::Enum { options } = &knob.kind else {
                    continue;
                };
                let site = knob.addr.rsplit('#').next().unwrap_or("");
                if site == "table" || site == "oct" {
                    continue;
                }
                let cur = knob.value.round() as usize;
                for v in (0..options.len()).filter(|&v| v != cur) {
                    changes.push((name, tree.clone(), knob.addr.clone(), v));
                }
            }
        }
    }
    assert!(changes.len() > 300, "{} selector changes", changes.len());
    let mut engine = WasmEngine::new(0x5E1E, 6);
    while engine.fill_step(3) > 0 {}
    let id = pool_ids(&engine)[0];
    assert!(engine.edit_begin(id));
    let mut far = 0;
    let sample: Vec<_> = changes.iter().step_by(25).collect();
    for (name, tree, addr, v) in &sample {
        assert_eq!(
            engine.edit_set_tree(&serde_json::to_string(tree).unwrap()),
            ""
        );
        let before = engine.edit_makeup();
        assert!(engine.edit_param(addr, *v as f64, true), "{name} {addr}");
        let edited = set_param(tree, addr, ParamValue::Index(*v)).unwrap();
        let measured = live_makeup(
            &auracle_features::featurize(&edited, &phrase)
                .expect("presets' selector changes vet")
                .features,
        );
        assert!(engine.edit_vet_ok(), "{name} {addr} → {v}");
        assert!(
            (engine.edit_makeup() - measured).abs() < 1e-9 * measured,
            "{name} {addr} → {v}: makeup {} where its render measures {measured}",
            engine.edit_makeup()
        );
        if (20.0 * (before / measured).log10()).abs() > 3.0 {
            far += 1;
        }
    }
    // Why the tree waits: the sample holds changes the previous makeup
    // would have played more than 3 dB off.
    assert!(far > 0, "no change in the sample moved the level 3 dB");
}

/// An undo or a redo lands on a tree the engine measured when it was made,
/// and `edit_known_makeup` gives that measurement before the render: the
/// makeup the revet then measures. A tree never measured has none.
#[test]
fn an_undone_selector_has_its_measured_makeup_before_its_render() {
    let mut engine = WasmEngine::new(0x5E1E, 6);
    while engine.fill_step(3) > 0 {}
    let id = pool_ids(&engine)[0];
    assert!(engine.edit_begin(id));
    let rack: serde_json::Value = serde_json::from_str(&engine.edit_describe()).unwrap();
    let wave = rack["modules"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|m| m["knobs"].as_array().unwrap().iter())
        .find(|k| k["addr"].as_str().unwrap().ends_with("#wave"))
        .expect("the patch has an oscillator with a wave selector");
    let addr = wave["addr"].as_str().unwrap().to_string();
    let n = wave["kind"]["options"].as_array().unwrap().len();
    let next = ((wave["value"].as_f64().unwrap().round() as usize + 1) % n) as f64;
    let (tree0, makeup0) = (engine.edit_tree_json(), engine.edit_makeup());
    assert!(engine.edit_param(&addr, next, true));
    let (tree1, makeup1) = (engine.edit_tree_json(), engine.edit_makeup());
    assert_ne!(makeup1, makeup0);
    // Undo: the tree being left is measured as makeup1, the one landed
    // on as makeup0, before any render.
    assert_eq!(engine.edit_set_tree_apply(&tree0), "");
    assert_eq!(engine.edit_makeup(), makeup1, "the makeup moved unmeasured");
    assert_eq!(engine.edit_known_makeup(), makeup0);
    engine.edit_revet();
    assert_eq!(engine.edit_makeup(), makeup0);
    // Redo, the same way.
    assert_eq!(engine.edit_set_tree_apply(&tree1), "");
    assert_eq!(engine.edit_known_makeup(), makeup1);
    // A tree never measured: no makeup to go on.
    assert!(engine.edit_param_apply("amp#attack", 0.123_456_7, false));
    assert_eq!(engine.edit_known_makeup(), -1.0);
}

/// `edit_param` is its write and `edit_revet`: the tree moves at once and
/// the render, the makeup, the vet and φ wait for the revet, which lands
/// exactly where `edit_param` does. A refused write moves nothing.
#[test]
fn a_selector_written_before_its_render_lands_where_edit_param_does() {
    let mut engine = WasmEngine::new(0x5E1E, 6);
    while engine.fill_step(3) > 0 {}
    let id = pool_ids(&engine)[0];
    assert!(engine.edit_begin(id));
    let rack: serde_json::Value = serde_json::from_str(&engine.edit_describe()).unwrap();
    let (addr, next) = rack["modules"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|m| m["knobs"].as_array().unwrap().iter())
        .find(|k| k["addr"].as_str().unwrap().ends_with("#wave"))
        .map(|k| {
            let n = k["kind"]["options"].as_array().unwrap().len();
            let v = k["value"].as_f64().unwrap().round() as usize;
            (
                k["addr"].as_str().unwrap().to_string(),
                ((v + 1) % n) as f64,
            )
        })
        .expect("the patch has an oscillator with a wave selector");
    let (tree0, render0) = (engine.edit_tree_json(), engine.edit_render());
    let (makeup0, phi0) = (engine.edit_makeup(), engine.bench_phi.clone());
    assert!(engine.edit_vet_ok() && phi0.is_some());

    assert!(!engine.edit_param_apply(&addr, f64::NAN, true));
    assert!(!engine.edit_param_apply("node/9/9#nowhere", next, true));
    assert_eq!(
        engine.edit_tree_json(),
        tree0,
        "a refused write moved the tree"
    );

    assert!(engine.edit_param_apply(&addr, next, true));
    let tree1 = engine.edit_tree_json();
    assert_ne!(tree1, tree0, "the write did not reach the tree");
    assert_eq!(
        engine.edit_render(),
        render0,
        "the render moved before it was asked for"
    );
    assert_eq!(engine.edit_makeup(), makeup0, "the makeup moved unmeasured");
    assert_eq!(engine.bench_phi, phi0, "φ moved unmeasured");
    engine.edit_revet();
    let (render1, makeup1, phi1) = (
        engine.edit_render(),
        engine.edit_makeup(),
        engine.bench_phi.clone(),
    );
    assert!(engine.edit_vet_ok());
    assert_ne!(render1, render0, "another wave rendered the same phrase");
    assert_ne!(phi1, phi0, "another wave measured the same φ");
    assert_ne!(makeup1, makeup0, "another wave measured the same makeup");

    assert_eq!(engine.edit_set_tree(&tree0), "");
    assert_eq!(engine.edit_makeup(), makeup0);
    assert!(engine.edit_param(&addr, next, true));
    assert_eq!(engine.edit_tree_json(), tree1);
    assert_eq!(engine.edit_render(), render1);
    assert_eq!(engine.edit_makeup(), makeup1);
    assert_eq!(engine.bench_phi, phi1);
    assert!(engine.edit_vet_ok());
}

/// The readout above the rack describes the tree under the player's
/// hands, on every edit — the WHY line's failure was that it described the
/// patch that was *loaded*, silently, through any number of edits. Both
/// surfaces have to move with the bench and agree with each other, and
/// both have to say "nothing to show" rather than draw a zero when there
/// is no posterior to ask.
#[test]
fn the_bench_readout_follows_the_bench() {
    let mut engine = WasmEngine::new(0x0B1E, 6);
    while engine.fill_step(3) > 0 {}
    let id = pool_ids(&engine)[0];
    assert!(engine.edit_begin(id));

    // Untaught: no posterior, so no honest number exists.
    let u: serde_json::Value = serde_json::from_str(&engine.edit_utility()).unwrap();
    assert_eq!(u["ok"], false, "a number was drawn with nothing behind it");
    assert_eq!(engine.edit_explain(), "null");

    // Teach it something, then the same two calls have to answer.
    let (a, b) = (pool_ids(&engine)[0], pool_ids(&engine)[1]);
    engine.record_duel(a, b, true);
    engine.fit();
    let u0: serde_json::Value = serde_json::from_str(&engine.edit_utility()).unwrap();
    assert_eq!(u0["ok"], true);
    let ex0: serde_json::Value = serde_json::from_str(&engine.edit_explain()).unwrap();
    let sum: f64 = ex0["contributions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["contribution"].as_f64().unwrap())
        .sum();
    assert!(
        (sum - ex0["utility"].as_f64().unwrap()).abs() < 1e-9,
        "the decomposition is exact within a lens, or it is not a decomposition"
    );

    // An edit big enough to move φ has to move the number with it.
    assert_eq!(
        engine.edit_structure(r#"{"op":"insert","key":"node","kind":"distortion"}"#),
        ""
    );
    let u1: serde_json::Value = serde_json::from_str(&engine.edit_utility()).unwrap();
    assert_eq!(u1["ok"], true);
    assert_ne!(
        u0["u"], u1["u"],
        "the readout kept describing the patch that was edited away"
    );
}

/// A bench with nothing reaching the output fails the vet as *silent*,
/// and says so: the app tells an unplugged patch apart from a runaway one
/// by this flag, and a runaway warning over a silent patch is untrue.
#[test]
fn a_bench_with_its_only_source_unplugged_fails_the_vet_as_silent() {
    let mut engine = WasmEngine::new(0x5117, 6);
    while engine.fill_step(3) > 0 {}
    let id = pool_ids(&engine)[0];
    assert!(engine.edit_begin(id));
    assert!(engine.edit_vet_ok());
    assert!(!engine.edit_vet_silent());
    let before = engine.edit_tree_json();
    assert_eq!(
        engine.edit_structure(r#"{"op":"replace","key":"node","kind":"silence"}"#),
        ""
    );
    assert!(!engine.edit_vet_ok(), "a patch of nothing passed the vet");
    assert!(
        engine.edit_vet_silent(),
        "an empty patch failed as something other than silent"
    );
    assert_eq!(engine.edit_set_tree(&before), ""); // ⌘Z
    assert!(engine.edit_vet_ok());
    assert!(!engine.edit_vet_silent());
}

/// The implicit stream: a revert has to arrive with φ on *both* sides of
/// it, because a transition logged from one side says nothing about the
/// direction the player moved — and direction is the entire signal.
#[test]
fn a_logged_revert_carries_both_sides_of_the_edit() {
    let mut engine = WasmEngine::new(0x2E7, 6);
    while engine.fill_step(3) > 0 {}
    let id = pool_ids(&engine)[0];
    assert!(engine.edit_begin(id));
    let before = engine.edit_tree_json();
    assert_eq!(
        engine.edit_structure(r#"{"op":"insert","key":"node","kind":"distortion"}"#),
        ""
    );
    assert_eq!(engine.edit_set_tree(&before), ""); // ⌘Z
    engine.log_edit_event(
        "revert",
        id,
        3400.0,
        r#"{"op":"insert","kind":"distortion"}"#,
        true,
    );

    let state: auracle_session::SessionState =
        serde_json::from_str(&engine.export_session()).unwrap();
    let ev = state.events.last().expect("the revert was logged");
    assert_eq!(ev.kind, "revert");
    assert_eq!(ev.value, 3400.0);
    assert!(!ev.phi_before.is_empty() && !ev.phi_after.is_empty());
    assert_ne!(
        ev.phi_before, ev.phi_after,
        "a revert whose two sides are equal reverted nothing"
    );
    assert!(ev.detail.contains("distortion"));
    // And it stays out of the likelihood, which is the whole premise of
    // logging it this early.
    assert_eq!(state.profile.log.len(), 0);
}

/// The one property the whole pre-placement audition rests on: you can
/// hear the proposal without owning it. If the bench moved, a hover would
/// be an edit, and the player would be undoing sounds they only looked at.
#[test]
fn a_preview_renders_the_proposal_and_leaves_the_bench_alone() {
    // A seed whose top-ranked patch can take a distortion at its root, the
    // splice this test previews (with one RNG stream per consumer, 0x9A1's
    // pool no longer can; the property is the fixture, not the seed).
    let mut engine = WasmEngine::new(0x9A2, 6);
    while engine.fill_step(3) > 0 {}
    let id = pool_ids(&engine)[0];
    assert!(engine.edit_begin(id));
    let before_tree = engine.edit_tree_json();
    let before_render = engine.edit_render();
    let before_desc = engine.edit_describe();

    let pcm = engine.preview_op(r#"{"op":"insert","key":"node","kind":"distortion"}"#, 1.6);
    assert!(!pcm.is_empty(), "the spliced patch should have rendered");
    // Truncated, not the whole phrase: the phrase is ~5 s and the audition
    // is a glance.
    let want = (1.6 * engine.sample_rate()) as usize;
    assert_eq!(pcm.len(), want);
    assert!(
        pcm.iter().any(|s| s.abs() > 1e-4),
        "a preview of a real patch is not silence"
    );
    // The tail is faded, so the cut cannot click.
    assert!(pcm[pcm.len() - 1].abs() < 1e-6);

    assert_eq!(engine.edit_tree_json(), before_tree);
    assert_eq!(engine.edit_render(), before_render);
    assert_eq!(engine.edit_describe(), before_desc);
    assert!(engine.edit_vet_ok());
    // Nor did it move the belief readout — a hover must not restate what
    // the model thinks of a patch the player never adopted.
    assert!(!engine.edit_differs_from_original());
}

/// An op the grammar refuses and an op past the ceilings both come back as
/// "nothing to play", never as a buffer of zeros that would audition as a
/// patch that had gone silent.
#[test]
fn an_unplayable_preview_is_empty_rather_than_silent() {
    let mut engine = WasmEngine::new(0x9A2, 6);
    while engine.fill_step(3) > 0 {}
    let id = pool_ids(&engine)[0];

    // No bench at all.
    assert!(engine
        .preview_op(r#"{"op":"insert","key":"node","kind":"distortion"}"#, 1.6)
        .is_empty());

    assert!(engine.edit_begin(id));
    // A key that is not in the tree.
    assert!(engine
        .preview_op(r#"{"op":"insert","key":"node/9/9/9","kind":"fold"}"#, 1.6)
        .is_empty());
    // Not a `StructOp` at all.
    assert!(engine.preview_op(r#"{"op":"teleport"}"#, 1.6).is_empty());
    // And a source where a processor belongs — the grammar's own refusal.
    assert!(engine
        .preview_op(r#"{"op":"insert","key":"node","kind":"vco"}"#, 1.6)
        .is_empty());
}

/// The scale is what turns θ into a price. Shipping it keyed by name (and
/// only after a standardizer exists) is what keeps the client from
/// inventing one.
#[test]
fn the_phi_scale_ships_by_name_once_it_exists() {
    let mut engine = WasmEngine::new(0x9A3, 6);
    assert_eq!(engine.phi_scale(), "{}", "no standardizer, no scale");
    while engine.fill_step(3) > 0 {}
    engine.standardize_now();
    let map: std::collections::BTreeMap<String, f64> =
        serde_json::from_str(&engine.phi_scale()).unwrap();
    assert_eq!(map.len(), Features::phi_names().len());
    for name in Features::phi_names() {
        let s = *map.get(name).expect("every φ coordinate is priced");
        assert!(s > 0.0, "{name} scaled by a non-positive divisor");
    }
    // The one the sockets are priced through most often.
    assert!(map.contains_key("n_filter"));
}

/// **A take reaches a sound through the edit the app already sends.** A
/// CAPTURE placed on the bench plays nothing yet and fails the vet as
/// silent, as an unplugged socket does; a recording arriving as a
/// `set_take` structural edit (the saved form quiver's `Capture` writes)
/// makes it a sound that vets, saved in the bench's term; an unreadable
/// one is refused in words and changes nothing. No new binding: the web
/// task's capture flow rides `edit_structure`.
#[test]
fn a_take_arrives_on_the_bench_through_a_structural_edit() {
    let mut engine = WasmEngine::new(0xCA9, 6);
    while engine.fill_step(3) > 0 {}
    let id = pool_ids(&engine)[0];
    assert!(engine.edit_begin(id));
    assert_eq!(
        engine.edit_structure(r#"{"op":"replace","key":"node","kind":"capture"}"#),
        ""
    );
    assert!(
        engine.edit_vet_silent(),
        "an empty capture played something"
    );
    let sr = auracle_features::PhraseSpec::default().sample_rate;
    let x: Vec<f32> = (0..(1.5 * sr) as usize)
        .map(|i| (0.5 * (i as f64 * 220.0 * std::f64::consts::TAU / sr).sin()) as f32)
        .collect();
    let take =
        serde_json::to_string(&auracle_grammar::Take::from_samples(&x, sr).unwrap()).unwrap();
    let set = format!(r#"{{"op":"set_take","key":"node","take":{take}}}"#);
    assert_eq!(engine.edit_structure(&set), "");
    assert!(engine.edit_vet_ok(), "a capture with a take failed the vet");
    let bench: auracle_grammar::PatchTree = serde_json::from_str(&engine.edit_tree_json()).unwrap();
    assert!(bench.has_takes(), "the take is not in the bench's term");
    let refused = engine.edit_structure(r#"{"op":"set_take","key":"node","take":{"format":"x"}}"#);
    assert!(!refused.is_empty(), "an unreadable take was taken");
    assert!(engine.edit_vet_ok(), "a refused take changed the bench");
}

/// **A held sound, through the boundary the worker uses.** A session whose
/// bank holds a sound that is only a CAPTURE with an unreadable take
/// restores without it in the pool, reports it as held (apart from the
/// repairs) and lists it with its sentence; a readable take brings it back
/// into the pool, and a bad one is refused in words and changes nothing.
#[test]
fn a_held_sound_is_listed_and_readmitted_through_the_worker_surface() {
    use auracle_grammar::term::{AmpEnv, AudioNode, CaptureMode, InputChannel};
    let mut engine = WasmEngine::new(0x4E1D, 6);
    while engine.fill_step(3) > 0 {}
    let sr = PhraseSpec::default().sample_rate;
    let x: Vec<f32> = (0..sr as usize)
        .map(|i| (0.5 * (i as f64 * 196.0 * std::f64::consts::TAU / sr).sin()) as f32)
        .collect();
    let take = auracle_grammar::Take::from_samples(&x, sr).unwrap();
    let tree = PatchTree {
        amp: AmpEnv {
            attack: 0.02,
            decay: 0.3,
            sustain: 0.8,
            release: 0.3,
        },
        root: AudioNode::Capture {
            uid: auracle_grammar::Uid::NEW,
            play: CaptureMode::Once,
            input: Box::new(AudioNode::AudioIn {
                uid: auracle_grammar::Uid::NEW,
                input: 0,
                gain: auracle_grammar::INPUT_GAIN_UNITY,
                channel: InputChannel::Both,
            }),
            take: take.clone(),
        },
    };
    let mut state: serde_json::Value = serde_json::from_str(&engine.export_session()).unwrap();
    let bank = state["bank"].as_array_mut().unwrap();
    let mut held = bank[0].clone();
    held["id"] = 9_999.into();
    held["name"] = "Held One".into();
    held["tree"] = serde_json::to_value(&tree).unwrap();
    held["tree"]["root"]["Capture"]["take"]["length"] = 3.into();
    bank.push(held);
    let restored = engine.import_session(&state.to_string());
    let listed: serde_json::Value = serde_json::from_str(&engine.held_sounds()).unwrap();
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert_eq!(listed[0]["id"], 9_999);
    assert_eq!(listed[0]["name"], "Held One");
    // What the page records it again with: the capture's key, and the
    // term (so a recorder can be built from it with no bench).
    assert_eq!(listed[0]["capture"], "node");
    let listed_tree: PatchTree =
        serde_json::from_value(listed[0]["tree"].clone()).expect("the held term");
    assert_eq!(listed_tree.lost_take_key().as_deref(), Some("node"));
    // …serialized from its type, in declaration order (ADR-002), not
    // through a `Value`'s sorted map (which put a Capture's `input`
    // before its `play`).
    let own = serde_json::to_string(&engine.engine.held()[0].tree).unwrap();
    assert!(
        engine.held_sounds().contains(&own),
        "the held term is not listed as it serializes"
    );
    assert!(listed[0]["note"]
        .as_str()
        .unwrap()
        .contains("couldn’t be read"));
    let report: serde_json::Value = serde_json::from_str(&engine.repair_report()).unwrap();
    assert_eq!(report["held"], 1);
    assert_eq!(
        report["terms"], 0,
        "a held sound is not counted as repaired"
    );
    let ranked: Vec<serde_json::Value> = serde_json::from_str(&engine.ranked()).unwrap();
    assert!(
        ranked.iter().all(|r| r["id"] != 9_999),
        "a held sound was ranked"
    );
    assert_eq!(ranked.len(), restored);
    // Refused in words, the sound still held: a take that can't be read
    // (or is not a take at all), a take with which it still plays nothing,
    // and a sound that is not held.
    let readmit = |e: &mut WasmEngine, id: u32, take: &str| -> serde_json::Value {
        serde_json::from_str(&e.readmit_held(id, take)).unwrap()
    };
    let unread = readmit_note(&ReadmitError::NoTake);
    for take in [r#"{"format":"x"}"#, "not a take"] {
        let refused = readmit(&mut engine, 9_999, take);
        assert_eq!(refused["ok"], false);
        assert_eq!(refused["error"], unread, "{take}");
    }
    let silent = auracle_grammar::Take::from_samples(&vec![0.0; sr as usize], sr).unwrap();
    let silent = serde_json::to_string(&silent).unwrap();
    let refused = readmit(&mut engine, 9_999, &silent);
    assert_eq!(
        refused["error"],
        readmit_note(&ReadmitError::DoesNotVet(String::new()))
    );
    let good = serde_json::to_string(&take).unwrap();
    let refused = readmit(&mut engine, 1_234, &good);
    assert_eq!(refused["error"], readmit_note(&ReadmitError::NotHeld));
    assert_eq!(
        engine.held_sounds().matches("\"id\":9999").count(),
        1,
        "still held"
    );
    // A readable one brings it back.
    let back: serde_json::Value = serde_json::from_str(&engine.readmit_held(9_999, &good)).unwrap();
    assert_eq!(back["ok"], true);
    assert_eq!(back["id"], 9_999);
    assert_eq!(engine.held_sounds(), "[]");
    let ranked: Vec<serde_json::Value> = serde_json::from_str(&engine.ranked()).unwrap();
    assert!(
        ranked.iter().any(|r| r["id"] == 9_999),
        "the readmitted sound is not in the bank"
    );
}

/// A six-patch pool, filled serially: the engine most binding tests read.
fn filled(seed: u64) -> WasmEngine {
    let mut engine = WasmEngine::new(seed, 6);
    while engine.fill_step(3) > 0 {}
    engine
}

/// **A member is read by its id, and an id not in the pool reads as
/// nothing.** Its makeup, s-expression, rack and tree are the member's own;
/// for an id that is not there (0, which no member has, or one long gone)
/// each answers its "nothing": unity makeup, `""`, `null`, no render, no
/// forecast, no lens. A prefetch makes the member's audition resident, so
/// ▶ waits on no render.
#[test]
fn a_member_is_read_by_its_id_and_an_unknown_id_by_nothing() {
    let mut engine = filled(0x1D5);
    let id = pool_ids(&engine)[0];
    let i = engine.engine.find(id as u64).unwrap();
    let (features, own) = (
        engine.engine.pool[i].features.clone(),
        engine.engine.pool[i].tree.clone(),
    );
    assert_eq!(engine.makeup_of(id), live_makeup(&features));
    assert_eq!(engine.sexpr_of(id), own.to_sexpr());
    let rack: serde_json::Value = serde_json::from_str(&engine.describe_of(id)).unwrap();
    assert_eq!(rack, serde_json::to_value(describe(&own)).unwrap());
    let tree: PatchTree = serde_json::from_str(&engine.tree_json_of(id)).unwrap();
    assert_eq!(tree, own);
    for gone in [0, 9_999] {
        assert_eq!(engine.makeup_of(gone), 1.0);
        assert_eq!(engine.sexpr_of(gone), "");
        assert_eq!(engine.describe_of(gone), "null");
        assert_eq!(engine.tree_json_of(gone), "null");
        assert!(!engine.prefetch_render(gone));
        assert_eq!(engine.duel_pred(id, gone), -1.0);
        assert_eq!(engine.best_style_of(gone), -1);
        assert!(!engine.edit_begin(gone));
    }
    engine.engine.pool[i].render = None;
    assert!(engine.prefetch_render(id));
    assert!(
        engine.engine.pool[i].render.is_some(),
        "the prefetch left the audition unrendered"
    );
}

/// **What the player says about a member reaches the bank.** A name shows
/// in the ranked list and an empty one gives the generated name back; a
/// pin holds within the pin budget and is refused past it or for an id not
/// there; a logged event is in the save; a preset loaded is ranked as a
/// preset.
#[test]
fn naming_pinning_and_logging_reach_the_bank() {
    let mut engine = filled(0x2A3);
    let ids = pool_ids(&engine);
    let row = |e: &WasmEngine, id: u32| -> serde_json::Value {
        serde_json::from_str::<Vec<serde_json::Value>>(&e.ranked())
            .unwrap()
            .into_iter()
            .find(|r| r["id"] == id)
            .unwrap()
    };
    let generated = row(&engine, ids[0])["name"].clone();
    engine.set_name(ids[0], "My Bass");
    assert_eq!(row(&engine, ids[0])["name"], "My Bass");
    assert_eq!(row(&engine, ids[0])["named"], true);
    engine.set_name(ids[0], "");
    assert_eq!(row(&engine, ids[0])["name"], generated);
    assert_eq!(row(&engine, ids[0])["named"], false);

    let cap = engine.pin_budget()[1];
    assert_eq!(engine.pin_budget(), vec![0, cap]);
    for &id in &ids[..cap as usize] {
        assert!(engine.set_pinned(id, true));
        assert_eq!(row(&engine, id)["pinned"], true);
    }
    assert_eq!(engine.pin_budget(), vec![cap, cap]);
    assert!(
        !engine.set_pinned(ids[cap as usize], true),
        "past the budget"
    );
    assert!(!engine.set_pinned(9_999, true), "not in the pool");
    assert!(engine.set_pinned(ids[0], false));
    assert_eq!(engine.pin_budget(), vec![cap - 1, cap]);

    engine.log_event("promote", ids[1], 2.0);
    let state: SessionState = serde_json::from_str(&engine.export_session()).unwrap();
    let ev = state.events.last().unwrap();
    assert_eq!(
        (ev.kind.as_str(), ev.id, ev.value),
        ("promote", ids[1] as u64, 2.0)
    );

    let preset = engine.load_preset(3);
    assert!(preset > 0);
    assert_eq!(row(&engine, preset)["origin"], "preset");
}

/// **The preset bank crosses the boundary as the grammar holds it.** One
/// row per preset, in its order, with its name, category, blurb and
/// signature; a preset's tree by its index; and an index past the bank is
/// nothing to load or play.
#[test]
fn the_preset_bank_crosses_the_boundary() {
    let mut engine = filled(0x2A4);
    let bank = auracle_grammar::preset_bank();
    let rows: Vec<serde_json::Value> = serde_json::from_str(&engine.preset_list()).unwrap();
    assert_eq!(rows.len(), bank.len());
    for (k, (row, p)) in rows.iter().zip(&bank).enumerate() {
        assert_eq!(row["index"], k);
        assert_eq!(row["name"], p.name);
        assert_eq!(row["category"], p.category);
        assert_eq!(row["blurb"], p.blurb);
        assert_eq!(row["sig"], p.tree.signature());
    }
    let tree: PatchTree = serde_json::from_str(&engine.preset_tree_json(5)).unwrap();
    assert_eq!(tree, bank[5].tree);
    let past = bank.len();
    assert_eq!(engine.preset_tree_json(past), "");
    assert_eq!(engine.load_preset(past), 0);
    assert_eq!(engine.load_preset_heard(past), 0);
}

/// **A preset heard as it is loaded is rendered once.** `load_preset_heard`
/// featurizes it with its audio, so the buffer ▶ plays is in the memo's
/// audio tier when the insert lands; `load_preset` keeps φ only.
#[test]
fn a_preset_heard_as_it_is_loaded_is_rendered_once() {
    let mut engine = filled(0x2A5);
    let key_of =
        |e: &WasmEngine, id: u32| e.engine.pool[e.engine.find(id as u64).unwrap()].key.clone();
    let plain = engine.load_preset(7);
    assert!(plain > 0);
    assert!(engine
        .engine
        .memo()
        .get_audio(&key_of(&engine, plain))
        .is_none());
    let heard = engine.load_preset_heard(8);
    assert!(heard > 0);
    assert!(
        engine
            .engine
            .memo()
            .get_audio(&key_of(&engine, heard))
            .is_some(),
        "the heard preset's audio is not resident"
    );
}

/// **A face is found by its render key, or by its tree.** By key: the
/// memo row's face, else one taken from the row's resident audio (and
/// remembered), else none; a key never rendered has none. By tree: the
/// same, and with `render` a tree never measured is featurized for one; a
/// tree that does not parse or does not render has none.
#[test]
fn a_face_is_found_by_its_render_key_or_its_tree() {
    let mut engine = filled(0x2A6);
    let id = engine.load_preset_heard(9);
    let i = engine.engine.find(id as u64).unwrap();
    let key = engine.engine.pool[i].key.clone();
    let want = engine.face_of(id, false);
    assert_eq!(want.len(), auracle_features::FACE_LEN);
    assert_eq!(engine.face_of_key(&key), want, "from the memo's face");
    let faceless = |e: &WasmEngine| {
        let mut row = e.engine.memo().get(&key).unwrap();
        row.face = None;
        e.engine.memo().put(row, None);
    };
    faceless(&engine);
    assert_eq!(engine.face_of_key(&key), want, "from the resident audio");
    assert!(engine.engine.memo().get(&key).unwrap().face.is_some());
    assert!(engine.face_of_key("no/such/key").is_empty());

    let tree = engine.preset_tree_json(9);
    faceless(&engine);
    assert_eq!(engine.face_of_tree(&tree, false), want, "the tree's audio");
    assert_eq!(engine.face_of_tree(&tree, false), want, "its memo face");
    let unheard = engine.preset_tree_json(10);
    assert!(
        engine.face_of_tree(&unheard, false).is_empty(),
        "no render asked"
    );
    assert_eq!(
        engine.face_of_tree(&unheard, true).len(),
        auracle_features::FACE_LEN
    );
    assert!(engine.face_of_tree("{", true).is_empty());
    let deep = serde_json::to_string(&too_deep()).unwrap();
    assert!(engine.face_of_tree(&deep, true).is_empty());
}

/// **The taste views are the posterior's.** Before a fit there is no lens
/// and no map; after one, calibration, the taste map and the lineage are
/// the engine's own; the styles are one row per lens, a weight per
/// coordinate of φ under its name and the three members the lens scores
/// highest, best first; a lens named is shown by its name, in the styles
/// and in the bench's readout; and a member's best lens is the one most
/// responsible for it.
#[test]
fn the_taste_views_are_the_posteriors() {
    let cold = filled(0x5710);
    assert_eq!(cold.styles(), "null");
    assert_eq!(
        cold.best_style_of(pool_ids(&cold)[0]),
        -1,
        "no fit, no lens"
    );
    assert_eq!(
        WasmEngine::new(3, 6).taste_map(),
        "null",
        "nothing to project"
    );
    let mut engine = taught_wasm(0x5711);
    let value = |s: String| -> serde_json::Value { serde_json::from_str(&s).unwrap() };
    assert_eq!(
        value(engine.calibration()),
        serde_json::to_value(engine.engine.calibration()).unwrap()
    );
    assert_eq!(
        value(engine.lineage()),
        serde_json::to_value(&engine.engine.lineage).unwrap()
    );
    let map = value(engine.taste_map());
    assert!(map["points"].as_array().is_some_and(|p| !p.is_empty()));
    assert_eq!(
        map,
        serde_json::to_value(engine.engine.taste_map()).unwrap()
    );

    let p = engine.engine.posterior.clone().unwrap();
    let styles: Vec<serde_json::Value> = serde_json::from_str(&engine.styles()).unwrap();
    assert_eq!(styles.len(), p.k_styles());
    let names = Features::phi_names();
    for (k, row) in styles.iter().enumerate() {
        let theta = row["theta"].as_array().unwrap();
        let means = p.theta_mean(k);
        assert_eq!(theta.len(), names.len());
        for ((t, name), mean) in theta.iter().zip(&names).zip(&means) {
            assert_eq!(t["name"], *name);
            assert_eq!(t["mean"].as_f64().unwrap(), *mean);
        }
        let mut scored: Vec<(u64, f64)> = engine
            .engine
            .pool
            .iter()
            .map(|c| (c.id, p.utility(&c.phi_std, k).0))
            .collect();
        scored.sort_by(|a, b| b.1.total_cmp(&a.1));
        let best: Vec<u64> = scored.iter().take(3).map(|s| s.0).collect();
        assert_eq!(row["exemplars"], serde_json::json!(best), "lens {k}");
    }
    // The lenses share the pool between them.
    let shares: f64 = styles.iter().map(|r| r["share"].as_f64().unwrap()).sum();
    assert!((shares - 1.0).abs() < 1e-9, "the shares sum to {shares}");
    for c in &engine.engine.pool {
        let r = p.responsibilities(&c.phi_std);
        let most = (0..r.len()).max_by(|&a, &b| r[a].total_cmp(&r[b])).unwrap();
        assert_eq!(engine.best_style_of(c.id as u32), most as i32);
    }
    let id = pool_ids(&engine)[0];
    assert!(engine.edit_begin(id));
    let lens = engine
        .engine
        .explain_phi(engine.bench_phi.as_ref().unwrap())
        .unwrap()
        .style;
    engine.set_style_name(lens, "Dark Drones");
    assert_eq!(value(engine.styles())[lens]["name"], "Dark Drones");
    assert_eq!(value(engine.edit_utility())["lens"], "Dark Drones");
}

/// **A profile travels.** What `export_profile` writes, `import_profile`
/// on another engine takes in whole: the same evidence, measured in the
/// same standardizer. Text that is not a profile is refused and changes
/// nothing.
#[test]
fn a_profile_exported_is_imported_whole() {
    let engine = taught_wasm(0x9F1);
    let profile = engine.export_profile();
    let mut other = WasmEngine::new(5, 6);
    assert!(!other.import_profile("{"));
    assert_eq!(other.engine.log.len(), 0);
    assert!(other.import_profile(&profile));
    assert_eq!(other.engine.log.len(), engine.engine.log.len());
    assert_eq!(other.phi_scale(), engine.phi_scale());
}

/// **The serial driver breeds a generation one parent a call.**
/// `refine_begin` opens the generation and names its parents, the seeds
/// the belief named (none before there is a taste); `refine_seed` walks a
/// parent's job here and absorbs it, answering the child or 0 and the
/// reason; a parent not in the generation is no job; and the last parent
/// finishes the generation, the bank back to size.
#[test]
fn the_serial_driver_breeds_one_parent_a_call() {
    let mut cold = filled(0x5E3);
    assert_eq!(cold.refine_begin(), "[]");
    assert_eq!(cold.refine_seed(pool_ids(&cold)[0]), 0);
    assert_eq!(cold.last_refine_reason(), "unknown_seed");

    let mut engine = taught_wasm(0x5E2);
    let size = pool_ids(&engine).len();
    let belief: serde_json::Value = serde_json::from_str(&engine.belief()).unwrap();
    let parents: Vec<u64> = serde_json::from_str(&engine.refine_begin()).unwrap();
    assert_eq!(serde_json::json!(parents), belief["seeds"]);
    assert_eq!(engine.refine_seed(0xDEAD), 0);
    assert_eq!(engine.last_refine_reason(), "unknown_seed");
    let mut children = 0;
    for &p in &parents {
        if engine.refine_seed(p as u32) > 0 {
            children += 1;
        } else {
            let why = engine.last_refine_reason();
            assert!(
                ["no_move", "duplicate", "not_admitted"].contains(&why.as_str()),
                "{why}"
            );
        }
    }
    assert!(children > 0, "no parent bred a child");
    assert_eq!(
        pool_ids(&engine).len(),
        size,
        "the generation did not finish"
    );
    let retired: Vec<u64> = serde_json::from_str(&engine.refine_retired()).unwrap();
    assert_eq!(retired.len(), children);
}

/// **A deferred restore takes what survives, and finishes the rest here.**
/// A save that does not read restores nothing, deferred or serial. A
/// result for an index not pending, or one that did not survive, is
/// refused; `bank_render` featurizes a pending entry in this worker (what
/// the farm did not finish), and the session it rebuilds is the serial
/// restore's. An entry the compiler can no longer build is dropped, as the
/// serial restore drops it.
#[test]
fn a_deferred_restore_takes_what_survives_and_finishes_the_rest_here() {
    let saved = filled(0x5A5C).export_session();
    let mut d = WasmEngine::new(1, 6);
    assert_eq!(d.import_session_deferred("{"), "[]");
    assert_eq!(d.import_session("{"), 0);
    let jobs: Vec<serde_json::Value> =
        serde_json::from_str(&d.import_session_deferred(&saved)).unwrap();
    assert!(jobs.len() >= 3);
    assert!(
        !d.bank_absorb(jobs.len(), "{}", &[]),
        "no entry pending there"
    );
    assert!(!d.bank_absorb(0, "", &[]), "a result that did not survive");
    assert!(!d.bank_render(jobs.len()));
    for i in 0..jobs.len() {
        assert!(d.bank_render(i));
    }
    assert_eq!(d.restore_finish(), jobs.len());
    let mut serial = WasmEngine::new(1, 6);
    assert_eq!(serial.import_session(&saved), jobs.len());
    assert_eq!(session_content(&d), session_content(&serial));

    let mut state: serde_json::Value = serde_json::from_str(&saved).unwrap();
    state["bank"][0]["tree"] = serde_json::to_value(too_deep()).unwrap();
    let mut broken = WasmEngine::new(1, 6);
    let jobs: Vec<serde_json::Value> =
        serde_json::from_str(&broken.import_session_deferred(&state.to_string())).unwrap();
    assert!(
        !broken.bank_render(0),
        "an entry that does not compile landed"
    );
    for i in 1..jobs.len() {
        assert!(broken.bank_render(i));
    }
    assert_eq!(broken.restore_finish(), jobs.len() - 1);
}

/// **The farm's results are checked, not trusted.** A tree that does not
/// parse, a phrase that does not parse, and a tree that does not compile
/// each come back not ok; a row filed under another tree's key is refused
/// at absorption and burns its draw. A phrase that does not parse has no
/// namespace.
#[test]
fn the_farm_refuses_what_it_cannot_measure_or_place() {
    let mut engine = WasmEngine::new(0x9998, 8);
    let phrase = engine.phrase_json();
    assert_eq!(cache_namespace("{"), "");
    let tree = serde_json::to_string(&presets()[0].1).unwrap();
    let deep = serde_json::to_string(&too_deep()).unwrap();
    for (t, p) in [
        ("{", phrase.as_str()),
        (tree.as_str(), "{"),
        (deep.as_str(), phrase.as_str()),
    ] {
        let job = farm_render(t, p, true);
        assert!(
            !job.ok() && job.cached().is_empty(),
            "{t:.20} under {p:.20}"
        );
    }
    let wave: Vec<serde_json::Value> = serde_json::from_str(&engine.fill_draw(1)).unwrap();
    let index = wave[0]["i"].as_u64().unwrap() as u32;
    let other = farm_render(&tree, &phrase, false);
    assert!(other.ok());
    assert_eq!(engine.fill_absorb(index, &other.cached(), &[]), 0);
    assert_eq!(engine.fill_cursor(), index + 1, "the draw was not burned");
    assert_eq!(pool_ids(&engine).len(), 0);
}

/// **A preset the file names but the bank does not, or one whose
/// measurement is not the length of the standardizer, is skipped** when
/// the shipped wirings are read for the presets nearest a sound; the rest
/// are read.
#[test]
fn a_wiring_file_row_that_does_not_fit_is_skipped() {
    let bank = auracle_grammar::preset_bank();
    let file = serde_json::json!({
        "standardizer": {"mean": [1.0, 2.0], "std": [2.0, 4.0]},
        "presets": [
            {"name": bank[0].name, "data": {"z": [0.5, -1.0]}},
            {"name": "Not A Preset", "data": {"z": [0.0, 0.0]}},
            {"name": bank[1].name, "data": {"z": [0.0]}},
        ],
    });
    let read = presets_from_wirings(&file.to_string());
    assert_eq!(read.len(), 1);
    assert_eq!((read[0].index, read[0].name.as_str()), (0, bank[0].name));
    assert_eq!(read[0].audio, vec![2.0, -2.0], "z × std + mean");
}

/// **PERFORM answers what it cannot read with nothing, and a walk that
/// cannot go with why.** A tree (or an offer) that does not parse is
/// `null`, `[]` or false, each binding's nothing, and no walk is held for
/// it; with no standardizer there is nothing to wire against. A tree past
/// the prior's support (a knob out of its range) cannot begin a walk
/// (`outside_support`); a drift with every live knob locked has nothing to
/// move, and neither, said when its walk ends, has a one-step offer that
/// may not touch a knob (`no_move`). The live knobs are the session's
/// list; a graft is the tree with the one module that gives its control
/// something to turn, or `no_graft`.
#[test]
fn perform_answers_what_it_cannot_read_or_move() {
    let mut cold = WasmEngine::new(3, 6);
    let base = presets()[0].1.clone();
    let tree = serde_json::to_string(&base).unwrap();
    assert_eq!(
        cold.perform_wire(&tree, "[]", None),
        "null",
        "no standardizer"
    );
    assert_eq!(cold.perform_wire_known(&tree, "[]", "[]", None), "null");
    for bad in ["{", "null"] {
        assert_eq!(cold.perform_wire(bad, "[]", None), "null");
        assert_eq!(cold.perform_wire_plan(bad, "[]", "[]", None), "[]");
        assert_eq!(cold.perform_wire_known(bad, "[]", "[]", None), "null");
        assert_eq!(cold.perform_graft(bad, "[]", 0), "null");
        assert_eq!(cold.perform_apply(bad, "[]"), "null");
        assert_eq!(cold.perform_knobs(bad), "[]");
        assert_eq!(cold.perform_offer(bad, "[]", "[]", 4, None, None), "null");
        assert_eq!(cold.perform_drift(bad, "[]", "[]", 4, 0.1), "null");
        assert!(!cold.memo_render(bad));
        assert!(!cold.memo_absorb(bad, "{}"));
        assert!(!cold.perform_record(&tree, "[]", bad, true, u32::MAX));
    }
    assert!(cold.jobs.is_empty(), "a walk was held for nothing");

    let mut engine = filled(3);
    let sr = engine.sample_rate();
    let knobs: Vec<(String, f64)> = serde_json::from_str(&engine.perform_knobs(&tree)).unwrap();
    assert_eq!(knobs, auracle_session::perform::live_knobs(&base, sr));
    let mut wild = base.clone();
    wild.amp.sustain = 7.0;
    let wild = serde_json::to_string(&wild).unwrap();
    assert_eq!(
        engine.perform_offer(&wild, "[]", "[]", 4, None, None),
        r#"{"reason":"outside_support"}"#
    );
    let locks: Vec<&str> = knobs.iter().map(|(a, _)| a.as_str()).collect();
    let locks = serde_json::to_string(&locks).unwrap();
    assert_eq!(
        engine.perform_drift(&tree, "[]", &locks, 4, 0.1),
        r#"{"reason":"no_move"}"#
    );
    let begun: serde_json::Value =
        serde_json::from_str(&engine.perform_offer_begin(&tree, "[]", &locks, 1, None, None))
            .unwrap();
    let job = begun["job"].as_u64().expect("the offer begins") as u32;
    while engine.perform_job_step(job, 1) {}
    assert_eq!(engine.perform_job_finish(job), r#"{"reason":"no_move"}"#);

    let bright = engine.perform_graft(&tree, "[]", 0);
    let grafted: serde_json::Value = serde_json::from_str(&bright).unwrap();
    let grown: PatchTree = serde_json::from_value(grafted["tree"].clone()).unwrap();
    assert_eq!(
        grafted.as_object().unwrap().len(),
        1,
        "a graft is its tree: {bright:.80}"
    );
    assert_eq!(
        grown.root.size(),
        base.root.size() + 1,
        "one module grafted"
    );
    assert!(bright.starts_with(&format!(
        "{{\"tree\":{}",
        serde_json::to_string(&grown).unwrap()
    )));
    let none = auracle_session::perform::CONTROLS.len() as u32;
    assert_eq!(
        engine.perform_graft(&tree, "[]", none),
        r#"{"reason":"no_graft"}"#
    );
}

/// **Every way a held sound stays held has its own sentence**, and says
/// whether anything changed: not held and nothing to replace change
/// nothing; a take that can't be read and one with which the sound still
/// plays nothing leave it kept safe.
#[test]
fn every_readmit_refusal_has_its_own_sentence() {
    let notes = [
        readmit_note(&ReadmitError::NotHeld),
        readmit_note(&ReadmitError::NothingToReplace),
        readmit_note(&ReadmitError::NoTake),
        readmit_note(&ReadmitError::DoesNotVet("silent".into())),
    ];
    for (i, a) in notes.iter().enumerate() {
        assert!(notes[i + 1..].iter().all(|b| a != b), "{a} twice");
    }
    assert!(notes[..2].iter().all(|n| n.contains("nothing changed")));
    assert!(notes[2..].iter().all(|n| n.contains("still kept safe")));
}
