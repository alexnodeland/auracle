use super::*;
use crate::SessionConfig;
use auracle_features::{featurize_memo, RenderMemo};
use auracle_grammar::{preset_bank, validate_tree, PatchGrammarPrior, Uid};
use rand::rngs::StdRng;
use rand::SeedableRng;

/// An engine with a filled pool of 12 and no fit: before the warm start.
fn filled(seed: u64) -> Engine {
    let cfg = SessionConfig {
        pool_size: 12,
        mcmc_samples: 3_000,
        mcmc_warmup: 1_000,
        ..Default::default()
    };
    let mut e = Engine::new(PatchGrammarPrior::default(), cfg);
    e.begin_session();
    e.fill_pool(&mut StdRng::seed_from_u64(seed));
    e
}

/// [`filled`], then the warm start as the worker runs it: three of nine
/// presets picked over the other six, eighteen picks, one fit. `bright`
/// picks the three brightest by centroid, else the three darkest.
fn warm(seed: u64, bright: bool) -> Engine {
    let mut e = filled(seed);
    let bank = preset_bank();
    let nine: Vec<_> = [
        "First Bass",
        "Folded Lead",
        "Pluck",
        "Cathedral",
        "Noise Wash",
        "Flint",
        "Two Minds",
        "Bell Jar",
        "Glass Pad",
    ]
    .iter()
    .map(|n| bank.iter().find(|p| p.name == *n).expect("preset"))
    .collect();
    let mut by: Vec<(f64, usize)> = nine
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let (cf, _) = featurize_memo(&p.tree, &e.cfg.phrase, e.memo(), false).expect("vets");
            (cf.features.audio.centroid_mean, i)
        })
        .collect();
    by.sort_by(|a, b| a.0.total_cmp(&b.0));
    if bright {
        by.reverse();
    }
    let picked: Vec<usize> = by[..3].iter().map(|x| x.1).collect();
    let mut ids = Vec::new();
    for &i in &picked {
        let id = e.insert_preset(nine[i].tree.clone(), nine[i].name).unwrap();
        e.set_pinned(id, true);
        ids.push(id);
    }
    for (i, p) in nine.iter().enumerate() {
        if picked.contains(&i) {
            continue;
        }
        let Some(id) = e.insert_preset(p.tree.clone(), p.name) else {
            continue;
        };
        for &w in &ids {
            if let (Some(a), Some(b)) = (e.find(w), e.find(id)) {
                e.record_duel(a, b, true);
            }
        }
    }
    e.fit_posterior(&mut StdRng::seed_from_u64(seed ^ 0x51));
    e
}

fn preset(name: &str) -> PatchTree {
    let mut t = preset_bank()
        .into_iter()
        .find(|p| p.name == name)
        .expect("preset")
        .tree;
    t.ensure_uids();
    t
}

/// Plan and render until nothing is owed, the way the worker does with no
/// farm; returns the keys that did not vet.
fn render_all(
    e: &Engine,
    tree: &PatchTree,
    at: Option<&str>,
    skips: &[GuessSkip],
    limit: usize,
) -> HashSet<String> {
    let mut failed = HashSet::new();
    for _ in 0..4 {
        let plan = e
            .guess_plan(tree, at, skips, &failed, limit)
            .expect("a plan");
        if plan.jobs.is_empty() {
            break;
        }
        for job in plan.jobs {
            if featurize_memo(&job.tree, &e.cfg.phrase, e.memo(), false).is_err() {
                failed.insert(job.key);
            }
        }
    }
    failed
}

/// Every module count the term's structural features keep, by name, empty
/// sockets (`n_silence`) aside: φ's columns and the counts with none.
fn module_counts(tree: &PatchTree) -> HashMap<String, f64> {
    let fields = serde_json::to_value(struct_features(tree)).unwrap();
    fields
        .as_object()
        .unwrap()
        .iter()
        .filter(|(k, _)| k.starts_with("n_") && *k != "n_silence")
        .map(|(k, v)| (k.clone(), v.as_f64().unwrap()))
        .collect()
}

/// **Every candidate adds, and its family is φ's.** Over random trees from
/// the prior, at the output and at a deeper socket: each candidate is a
/// valid tree, placed at the module asked for (when one is), larger than
/// the patch, adds a module without taking any away (no count falls, and
/// their sum rises), and raises its family's φ
/// coordinate, `n_<family>` (bar the mix, which φ does not count); at the
/// output, every socket is the output, the root's slot or an empty socket.
#[test]
fn every_candidate_adds_and_its_family_is_phis() {
    let prior = PatchGrammarPrior::default();
    let mut rng = StdRng::seed_from_u64(9);
    let names = StructFeatures::NAMES;
    let mut seen = HashSet::new();
    for _ in 0..40 {
        let mut tree = prior.sample_with_rng(&mut rng);
        tree.ensure_uids();
        let before = struct_features(&tree).to_vec();
        let had = module_counts(&tree);
        let mut ks = Vec::new();
        keys(&tree.root, "node".into(), &mut ks);
        let deep = ks.last().map(|k| k.0.clone());
        for at in [None, deep.as_deref()] {
            for c in guess_candidates(&tree, at) {
                assert!(validate_tree(&c.tree).is_ok());
                // Asked at a module, every guess is placed at that module.
                if let Some(key) = at {
                    assert_eq!(op_key(&c.op), key, "{:?} placed elsewhere", c.op);
                }
                if !matches!(c.op, StructOp::SetMod { .. }) {
                    // A modulator is not an audio node; its family says it
                    // was added (below).
                    assert!(c.tree.root.size() > tree.root.size(), "{:?}", c.op);
                }
                let has = module_counts(&c.tree);
                assert!(
                    had.iter().all(|(k, n)| has[k] >= *n),
                    "{:?} took a module away",
                    c.op
                );
                assert!(has.values().sum::<f64>() > had.values().sum::<f64>());
                let after = struct_features(&c.tree).to_vec();
                if c.family != "mix" {
                    let j = names
                        .iter()
                        .position(|n| *n == format!("n_{}", c.family))
                        .unwrap_or_else(|| panic!("no φ coordinate for {}", c.family));
                    assert!(
                        after[j] > before[j],
                        "{} ({}) did not raise n_{}",
                        c.kind,
                        c.family,
                        c.family
                    );
                }
                if at.is_none() {
                    assert!(
                        c.socket == OUTPUT_SOCKET
                            || c.socket.starts_with("mod:")
                            || c.socket.starts_with("in:"),
                        "{}",
                        c.socket
                    );
                }
                seen.insert(c.kind.clone());
            }
        }
    }
    assert!(seen.len() > 20, "only {} kinds were offered", seen.len());
}

/// **Nothing before the warm start:** with no fit there is nothing to guess
/// from, and the plan and the ranking both say so.
#[test]
fn nothing_before_the_warm_start() {
    let e = filled(4);
    let tree = preset("Hornet");
    let none = HashSet::new();
    assert_eq!(
        e.guess_plan(&tree, None, &[], &none, 0),
        Err(GuessRefusal::NoTaste)
    );
    assert_eq!(
        e.guess_rank(&tree, None, &[], &none, 0).map(|r| r.total),
        Err(GuessRefusal::NoTaste)
    );
}

/// **Ranked by the lower bound.** After the warm start, on a preset and on
/// an empty patch: the plan owes the patch first, then its candidates; once
/// all are rendered, every guess's numbers are the posterior's draws of its
/// gain worked out again by hand, and the list runs by mean − sd, best
/// first, which is not the order of the mean.
#[test]
fn guesses_are_ranked_by_the_lower_bound() {
    let e = warm(4, false);
    let post = e.posterior.as_deref().unwrap();
    let sz = e.standardizer().unwrap();
    let mut empty = preset("Detune Dream");
    empty.root = AudioNode::Silence { uid: Uid::NEW };
    let mut by_mean_differs = false;
    for (tree, against) in [(preset("Hornet"), "patch"), (empty, "pool")] {
        let none = HashSet::new();
        let first = e.guess_plan(&tree, None, &[], &none, 0).unwrap();
        if against == "patch" {
            assert_eq!(first.jobs.len(), 1, "the patch is owed first");
            assert_eq!(first.jobs[0].tree, tree);
            assert_eq!(
                e.guess_rank(&tree, None, &[], &none, 0),
                Err(GuessRefusal::Unmeasured)
            );
        } else {
            assert!(first.jobs.iter().all(|j| j.tree != tree));
            assert_eq!(first.total, 6, "an empty socket takes the six sources");
        }
        let failed = render_all(&e, &tree, None, &[], 0);
        let r = e.guess_rank(&tree, None, &[], &failed, 0).unwrap();
        assert_eq!(r.against, against);
        assert_eq!(r.rendered, r.planned);
        assert_eq!(r.planned, r.total);
        assert!(!r.guesses.is_empty());
        let zp = match against {
            "patch" => {
                let hit = e.memo().get(&render_key(&tree, &e.cfg.phrase)).unwrap();
                sz.transform(&hit.features.phi())
            }
            _ => vec![0.0; sz.mean.len()],
        };
        for g in &r.guesses {
            let t = apply_struct_op(&tree, &g.op).unwrap();
            let hit = e.memo().get(&render_key(&t, &e.cfg.phrase)).unwrap();
            let z = sz.transform(&hit.features.phi());
            let gains: Vec<f64> = post
                .samples
                .iter()
                .map(|s| s.utility_mix(&z) - s.utility_mix(&zp))
                .collect();
            let m: f64 = gains
                .iter()
                .enumerate()
                .map(|(i, g)| post.weight(i) * g)
                .sum();
            let v: f64 = gains
                .iter()
                .enumerate()
                .map(|(i, g)| post.weight(i) * (g - m) * (g - m))
                .sum();
            assert!((g.mean - m).abs() < 1e-9, "{}: mean", g.kind);
            assert!((g.sd - v.sqrt()).abs() < 1e-6, "{}: sd", g.kind);
            assert!((g.lcb - (m - v.sqrt())).abs() < 1e-6, "{}: lcb", g.kind);
            assert!((g.p - post.prob_prefers(&z, &zp)).abs() < 1e-12);
            if let Some(w) = &g.why {
                assert!(w.part > 0.0, "a why leans your way");
                // A reason names what the guess changes, never what it
                // inherits from the patch (an empty patch's amp envelope).
                if let Some(c) = w.coordinate {
                    let j = StructFeatures::NAMES.iter().position(|n| *n == c).unwrap();
                    let (a, b) = (
                        struct_features(&t).to_vec()[j],
                        struct_features(&tree).to_vec()[j],
                    );
                    assert_ne!(
                        a, b,
                        "{} at {}: the why names {c}, unmoved",
                        g.kind, g.socket
                    );
                }
            }
        }
        for w in r.guesses.windows(2) {
            assert!(w[0].lcb >= w[1].lcb, "not by the lower bound");
        }
        let mut by_mean = r.guesses.clone();
        by_mean.sort_by(|a, b| b.mean.total_cmp(&a.mean));
        by_mean_differs |= by_mean.iter().zip(&r.guesses).any(|(a, b)| a.op != b.op);
    }
    assert!(
        by_mean_differs,
        "the mean and the lower bound agreed everywhere, so this proved nothing"
    );
}

/// **A skip is that family at that socket, for this patch.** Skipping the
/// filter family at the output takes the filter, the EQ and the vocoder
/// away from the output, and only them; the same family at a deeper socket,
/// and at the output of another patch, is still planned.
#[test]
fn a_skip_is_that_family_at_that_socket_for_this_patch() {
    let e = warm(4, false);
    let tree = preset("Hornet");
    let mut mem = GuessMemory::default();
    let skip = GuessSkip {
        socket: OUTPUT_SOCKET.into(),
        family: "filter".into(),
    };
    assert!(mem.skip(1, skip.clone()));
    assert!(!mem.skip(1, skip.clone()), "a skip is recorded once");
    let none = HashSet::new();
    featurize_memo(&tree, &e.cfg.phrase, e.memo(), false).unwrap();
    let all = guess_candidates(&tree, None);
    let skipped: Vec<&str> = all
        .iter()
        .filter(|c| c.skip() == skip)
        .map(|c| c.kind.as_str())
        .collect();
    assert_eq!(skipped, ["filter", "eq", "vocoder"]);
    let mine = e.guess_plan(&tree, None, mem.skips(1), &none, 0).unwrap();
    let theirs = e.guess_plan(&tree, None, mem.skips(2), &none, 0).unwrap();
    assert_eq!((mine.skipped, theirs.skipped), (3, 0));
    assert_eq!(mine.total + 3, theirs.total);
    let planned =
        |p: &GuessPlan| -> Vec<PatchTree> { p.jobs.iter().map(|j| j.tree.clone()).collect() };
    let (mine, theirs) = (planned(&mine), planned(&theirs));
    for c in &all {
        assert_eq!(
            mine.contains(&c.tree),
            c.skip() != skip,
            "{} at {}",
            c.kind,
            c.socket
        );
        assert!(theirs.contains(&c.tree), "patch 2 has no skips");
    }
    let deeper = e
        .guess_plan(&tree, Some("node/0"), mem.skips(1), &none, 0)
        .unwrap();
    assert_eq!(deeper.skipped, 0, "a deeper wire is another socket");
    assert!(guess_candidates(&tree, Some("node/0"))
        .iter()
        .any(|c| c.family == "filter" && c.socket.starts_with("wire:")));
}

/// **Undoing a taken guess counts as a skip.** The memory records the skip
/// when the patch is back to what it was before the guess (uids aside, as an
/// undo restores it), for no other tree and no other patch, once. A skip
/// the memory holds is planned no more:
/// `a_skip_is_that_family_at_that_socket_for_this_patch` shows the plan.
#[test]
fn undoing_a_taken_guess_counts_as_a_skip() {
    let tree = preset("Hornet");
    let c = guess_candidates(&tree, None)
        .into_iter()
        .find(|c| c.kind == "reverb")
        .expect("a reverb at the output");
    let mut mem = GuessMemory::default();
    mem.took(7, c.skip(), tree.clone());
    assert_eq!(mem.observe(7, &c.tree), None, "the guess is in");
    let mut other = tree.clone();
    other.amp.attack = (other.amp.attack + 0.1).min(1.0);
    assert_eq!(mem.observe(7, &other), None, "another tree");
    assert_eq!(mem.observe(8, &tree), None, "another patch");
    let mut undone = tree.clone();
    undone.clear_uids();
    assert_eq!(mem.observe(7, &undone), Some(c.skip()));
    assert_eq!(mem.skips(7), [c.skip()]);
    assert_eq!(mem.observe(7, &tree), None, "counted once");
    assert!(mem.skips(8).is_empty());

    // Two guesses taken, then undone twice: each is skipped as the undo
    // passes back through the tree before it, the newer first.
    let a = guess_candidates(&tree, None)
        .into_iter()
        .find(|c| c.kind == "delay")
        .expect("a delay at the output");
    let b = guess_candidates(&a.tree, None)
        .into_iter()
        .find(|c| c.kind == "chorus")
        .expect("a chorus at the output");
    let mut mem = GuessMemory::default();
    mem.took(3, a.skip(), tree.clone());
    mem.took(3, b.skip(), a.tree.clone());
    assert_eq!(mem.observe(3, &b.tree), None);
    assert_eq!(mem.observe(3, &a.tree), Some(b.skip()), "the first undo");
    assert_eq!(mem.observe(3, &tree), Some(a.skip()), "the second undo");
    assert_eq!(mem.skips(3), [b.skip(), a.skip()]);
}

/// **Seeded means reproducible.** Two sessions from one seed guess the
/// same, number for number, even when one renders its candidates in the
/// opposite order into a cold memo (a farm finishes in any order); and the
/// dark and the bright warm starts guess differently: the guess follows
/// taste.
#[test]
fn a_seeded_session_guesses_the_same() {
    let tree = preset("Sub & Sparkle");
    let rank = |mut e: Engine, reverse: bool| {
        if reverse {
            e.set_memo(RenderMemo::default());
            featurize_memo(&tree, &e.cfg.phrase, e.memo(), false).unwrap();
            let mut jobs = e
                .guess_plan(&tree, None, &[], &HashSet::new(), GUESS_FLOOR)
                .unwrap()
                .jobs;
            jobs.reverse();
            for j in jobs {
                let _ = featurize_memo(&j.tree, &e.cfg.phrase, e.memo(), false);
            }
        }
        let failed = render_all(&e, &tree, None, &[], GUESS_FLOOR);
        let r = e
            .guess_rank(&tree, None, &[], &failed, GUESS_FLOOR)
            .unwrap();
        assert_eq!(r.planned, GUESS_FLOOR.min(r.total));
        serde_json::to_string(&r).unwrap()
    };
    let (a, b, bright) = std::thread::scope(|s| {
        let a = s.spawn(|| rank(warm(4, false), false));
        let b = s.spawn(|| rank(warm(4, false), true));
        let c = s.spawn(|| rank(warm(4, true), false));
        (a.join().unwrap(), b.join().unwrap(), c.join().unwrap())
    });
    assert_eq!(a, b);
    assert_ne!(a, bright, "the dark and the bright warm starts guess alike");
}

/// A guess's renders are keyed under the engine's own stimulus: another
/// phrase plans other keys, so a memo or a store shared across stimuli
/// cannot serve one's φ to the other.
#[test]
fn a_guess_is_keyed_under_the_engines_phrase() {
    let e = warm(4, false);
    let tree = preset("Hornet");
    featurize_memo(&tree, &e.cfg.phrase, e.memo(), false).unwrap();
    let plan = e.guess_plan(&tree, None, &[], &HashSet::new(), 0).unwrap();
    assert!(!plan.jobs.is_empty());
    let mut other = e.cfg.phrase.clone();
    other.seed ^= 1;
    for j in &plan.jobs {
        assert_eq!(j.key, render_key(&j.tree, &e.cfg.phrase));
        assert_ne!(j.key, render_key(&j.tree, &other));
    }
}

fn phi_index(name: &str) -> usize {
    Features::phi_names()
        .iter()
        .position(|n| n.split(':').next() == Some(name))
        .unwrap_or_else(|| panic!("no φ coordinate {name}"))
}

/// **A control's reason names where its gain comes from.** A move whose
/// centroid rises while its rolloff falls further reads "toward dark" along
/// Bright, but a taste that cares only for the centroid gains from the rise:
/// Bright must not be the reason. Over random tastes and moves, a control
/// named is one the move and the lean point the same way along, its word is
/// the side the move goes, and no reason names a move under 0.005σ.
#[test]
fn a_control_reason_names_where_its_gain_comes_from() {
    let d = Features::phi_names().len();
    let (centroid, rolloff) = (phi_index("centroid_mean"), phi_index("rolloff_mean"));
    let mut theta = vec![0.0; d];
    theta[centroid] = 1.0;
    let mut dz = vec![0.0; d];
    dz[centroid] = 1.0;
    dz[rolloff] = -1.2;
    let why = why_from(&theta, &dz, 0);
    assert!(
        why.as_ref().is_none_or(|w| w.control != Some("Bright")),
        "{why:?}"
    );

    // A structural move too small to print is no reason.
    let n_drive = phi_index("n_drive");
    let mut dz = vec![0.0; d];
    dz[n_drive] = 0.001;
    let mut theta = vec![0.0; d];
    theta[n_drive] = 50.0;
    assert_eq!(why_from(&theta, &dz, 0), None);

    let names: Vec<String> = Features::phi_names()
        .into_iter()
        .map(String::from)
        .collect();
    let mut rng = StdRng::seed_from_u64(11);
    let mut uniform = |lo: f64, hi: f64| lo + (hi - lo) * rand::Rng::gen::<f64>(&mut rng);
    let mut named = 0;
    for _ in 0..2000 {
        let theta: Vec<f64> = (0..d).map(|_| uniform(-1.0, 1.0)).collect();
        let dz: Vec<f64> = (0..d).map(|_| uniform(-2.0, 2.0)).collect();
        let Some(w) = why_from(&theta, &dz, 0) else {
            continue;
        };
        assert!(w.part > 0.0 && w.moved.abs() >= 0.005, "{w:?}");
        if let Some(c) = w.control {
            named += 1;
            let ctl = CONTROLS.iter().find(|x| x.name == c).unwrap();
            let e = direction(ctl, &names);
            let lean: f64 = theta.iter().zip(&e).map(|(t, e)| t * e).sum();
            assert_eq!(
                lean > 0.0,
                w.moved > 0.0,
                "{c}: the lean and the move disagree"
            );
            assert_eq!(w.word, Some(if w.moved > 0.0 { ctl.high } else { ctl.low }));
        }
    }
    assert!(named > 100, "only {named} control reasons were tried");
}

/// **A stale guess is not current.** A noise ranked for an empty socket is a
/// guess for the empty patch; once the player has put a pluck there and a
/// filter after it, the same edit would wipe both, so it is not current. A
/// guess still offered for the new patch is.
#[test]
fn a_guess_ranked_on_an_earlier_tree_is_not_current() {
    let mut empty = preset("Hornet");
    empty.root = AudioNode::Silence { uid: Uid::mint() };
    let noise = guess_candidates(&empty, None)
        .into_iter()
        .find(|c| c.kind == "noise")
        .expect("noise in the empty socket");
    assert!(guess_is_current(
        &empty,
        &noise.op,
        &noise.socket,
        &noise.family
    ));
    assert!(!guess_is_current(
        &empty,
        &noise.op,
        OUTPUT_SOCKET,
        &noise.family
    ));
    assert!(!guess_is_current(&empty, &noise.op, &noise.socket, "drive"));
    let mut built = apply_struct_op(
        &empty,
        &StructOp::Replace {
            key: "node".into(),
            kind: NodeKind::Pluck,
        },
    )
    .unwrap();
    built = apply_struct_op(
        &built,
        &StructOp::Insert {
            key: "node".into(),
            kind: NodeKind::Filter,
        },
    )
    .unwrap();
    built.ensure_uids();
    assert!(!guess_is_current(
        &built,
        &noise.op,
        &noise.socket,
        &noise.family
    ));
    let reverb = guess_candidates(&built, None)
        .into_iter()
        .find(|c| c.kind == "reverb")
        .unwrap();
    assert!(guess_is_current(
        &built,
        &reverb.op,
        &reverb.socket,
        &reverb.family
    ));
}

/// The memory forgets its takes when told (a patch opened, the bench
/// closed), keeps its skips, carries both to a patch kept as new, and does
/// not report a skip it already had.
#[test]
fn the_memory_forgets_takes_and_carries_to_a_kept_patch() {
    let tree = preset("Hornet");
    let pick = |kind: &str| {
        guess_candidates(&tree, None)
            .into_iter()
            .find(|c| c.kind == kind)
            .unwrap()
    };
    let (c, d) = (pick("reverb"), pick("delay"));
    let mut mem = GuessMemory::default();
    mem.took(1, c.skip(), tree.clone());
    mem.clear_taken();
    assert_eq!(mem.observe(1, &tree), None, "a forgotten take");
    mem.skip(1, c.skip());
    mem.took(1, c.skip(), tree.clone());
    assert_eq!(mem.observe(1, &tree), None, "already skipped: nothing new");
    mem.took(1, d.skip(), tree.clone());
    mem.carry(1, 2);
    assert_eq!(mem.skips(2), [c.skip()]);
    assert_eq!(mem.observe(2, &tree), Some(d.skip()), "the take came along");
}

/// **AUDIO IN is never guessed, and a patch of nothing but an input does not
/// sound to the guess.** No empty socket is offered AUDIO IN; it has a
/// family of its own; and a lone input is offered no processor (live it is
/// silent until an input is connected), while the empty socket beside it in
/// a mix is offered the six sources.
#[test]
fn audio_in_is_never_guessed_and_a_lone_input_is_silent() {
    let input = || AudioNode::AudioIn {
        uid: Uid::NEW,
        input: 0,
        gain: auracle_grammar::INPUT_GAIN_UNITY,
        channel: auracle_grammar::InputChannel::Both,
    };
    assert_eq!(node_family(NodeKind::AudioIn), "audio_in");
    assert!(!guessable_source(NodeKind::AudioIn));
    assert!(!guessable_insert(NodeKind::AudioIn));
    let mut lone = preset("Hornet");
    lone.root = input();
    lone.ensure_uids();
    assert!(!sounds(&lone.root));
    assert!(
        guess_candidates(&lone, None).is_empty(),
        "a lone input was offered something"
    );
    let mut beside = preset("Hornet");
    beside.root = AudioNode::Mix {
        uid: Uid::NEW,
        balance: 0.5,
        a: Box::new(input()),
        b: Box::new(AudioNode::Silence { uid: Uid::NEW }),
    };
    beside.ensure_uids();
    let offered = guess_candidates(&beside, None);
    let kinds: Vec<&str> = offered.iter().map(|c| c.kind.as_str()).collect();
    assert_eq!(kinds.len(), 6, "{kinds:?}");
    assert!(offered
        .iter()
        .all(|c| matches!(c.op, StructOp::Replace { .. }) && c.kind != "audio_in"));
}

/// **Why there is no guess crosses to the app as a code**, so the codes are
/// a wire format, pinned as a literal table in `GuessRefusal::ALL`'s order.
/// A new refusal cannot compile until it is in `ALL` (a const in guess.rs),
/// and then not until it is in this table, whose length is `ALL`'s.
#[test]
fn guess_refusal_codes_are_pinned() {
    const WIRE: [&str; GuessRefusal::ALL.len()] = ["no_taste", "full", "unmeasured"];
    for (refusal, code) in GuessRefusal::ALL.into_iter().zip(WIRE) {
        assert_eq!(refusal.code(), code, "{refusal:?}");
    }
}

/// **Every kind is counted in a family φ names**, or is one of the few φ
/// counts without a column of their own (pinned here: the mix, AUDIO IN,
/// TRACK and CAPTURE). Swept from `NodeKind::ALL` and `ModKind::ALL`, so a
/// new kind is checked the day it is added; a modulator's `None` is no
/// family at all.
#[test]
fn every_kind_is_counted_in_a_family_phi_names() {
    let column = |family: &str| StructFeatures::NAMES.contains(&format!("n_{family}").as_str());
    const NO_COLUMN: [&str; 4] = ["mix", "audio_in", "track", "capture"];
    for kind in NodeKind::ALL {
        let family = node_family(kind);
        assert!(
            column(family) != NO_COLUMN.contains(&family),
            "{kind:?} is counted as {family}, which is neither a column nor pinned as none"
        );
    }
    for kind in ModKind::ALL {
        let family = mod_family(kind);
        assert_eq!(column(family), kind != ModKind::None, "{kind:?}: {family}");
    }
}

/// A sounding patch at the size ceiling, mixes of oscillators and one
/// filter, under a mix: nothing can go in at its output without breaking the
/// ceiling, and its output has no modulation slot a guess could fill.
fn at_the_ceiling() -> PatchTree {
    use auracle_grammar::term::{FilterKind, Waveform};
    let vco = || AudioNode::Vco {
        wave: Waveform::Saw,
        octave: 0,
        detune: 0.2,
        mod_depth: 0.0,
        modulation: ModNode::None,
        uid: Uid::NEW,
    };
    fn mix(a: AudioNode, b: AudioNode) -> AudioNode {
        AudioNode::Mix {
            balance: 0.5,
            a: Box::new(a),
            b: Box::new(b),
            uid: Uid::NEW,
        }
    }
    let four = || mix(mix(vco(), vco()), mix(vco(), vco()));
    let filtered = |input| AudioNode::Filter {
        kind: FilterKind::SvfLp,
        cutoff: 0.5,
        resonance: 0.2,
        mod_depth: 0.0,
        modulation: ModNode::None,
        input: Box::new(input),
        uid: Uid::NEW,
    };
    let mut tree = preset("Hornet");
    tree.root = mix(
        mix(four(), four()),
        mix(mix(vco(), vco()), mix(vco(), filtered(vco()))),
    );
    tree.ensure_uids();
    tree
}

/// **A patch with no room is offered nothing, and the guess says it is
/// full.** Every placement at its output would break the size ceiling and is
/// refused as it is made, so there is no candidate, and a plan for it is
/// refused as `full` rather than planning nothing.
#[test]
fn a_patch_with_no_room_is_refused_as_full() {
    let tree = at_the_ceiling();
    assert_eq!(tree.root.size(), auracle_grammar::mutate::MAX_SIZE);
    assert!(validate_tree(&tree).is_ok());
    assert!(guess_candidates(&tree, None).is_empty());
    let e = warm(4, false);
    let none = HashSet::new();
    assert_eq!(
        e.guess_plan(&tree, None, &[], &none, 0).map(|p| p.total),
        Err(GuessRefusal::Full)
    );
    // An op no guess makes is never a current guess, even where the same
    // key, socket and family hold one.
    let hornet = preset("Hornet");
    let mix = StructOp::Insert {
        key: "node".into(),
        kind: NodeKind::Mix,
    };
    assert!(guess_is_current(&hornet, &mix, OUTPUT_SOCKET, "mix"));
    assert!(!guess_is_current(
        &hornet,
        &StructOp::Delete { key: "node".into() },
        OUTPUT_SOCKET,
        "mix"
    ));
}

/// [`warm`], then picks enough for a second lens (`OBS_PER_STYLE`), and a
/// fit with two.
fn two_lenses() -> Engine {
    let mut e = warm(4, false);
    let mut rng = StdRng::seed_from_u64(0x2A4);
    while e.log.len() < crate::OBS_PER_STYLE {
        let (a, b) = e.next_duel(&mut rng).unwrap();
        e.record_duel(a, b, a < b);
    }
    e.fit_posterior(&mut rng);
    assert_eq!(e.posterior.as_ref().unwrap().k_styles(), 2);
    e
}

/// **A ranking reads only what is rendered.** A planned candidate known not
/// to vet counts as rendered and is left out; one the memo does not hold yet
/// is neither ranked nor counted. Here on a taste with two lenses, where a
/// reason is read under the lens most responsible for the guess.
#[test]
fn a_ranking_reads_only_what_is_rendered() {
    let e = two_lenses();
    let tree = preset("Hornet");
    let none = HashSet::new();
    featurize_memo(&tree, &e.cfg.phrase, e.memo(), false).unwrap();
    let plan = e.guess_plan(&tree, None, &[], &none, 0).unwrap();
    assert!(plan.jobs.len() >= 3);
    let failed: HashSet<String> = [plan.jobs[0].key.clone()].into();
    featurize_memo(&plan.jobs[1].tree, &e.cfg.phrase, e.memo(), false).unwrap();
    let r = e.guess_rank(&tree, None, &[], &failed, 0).unwrap();
    assert_eq!(
        r.rendered, 2,
        "a failure is rendered, an owed render is not"
    );
    let keys: Vec<&str> = r.guesses.iter().map(|g| g.key.as_str()).collect();
    assert_eq!(keys, [plan.jobs[1].key.as_str()]);
}

/// **The memory carries to a kept sound, and remembers only so many
/// takes.** A patch carried to itself is unchanged; one with skips and no
/// taken guess carries the skips alone. Past `GUESS_TAKEN_KEEP` taken
/// guesses the oldest is forgotten: undoing back to the tree before it is
/// no longer a skip.
#[test]
fn the_memory_carries_and_remembers_only_so_many_takes() {
    let tree = preset("Hornet");
    let cands = guess_candidates(&tree, None);
    let mut mem = GuessMemory::default();
    assert!(mem.skip(1, cands[0].skip()));
    mem.carry(1, 1);
    assert_eq!(mem.skips(1), [cands[0].skip()]);
    mem.carry(1, 2);
    assert_eq!(mem.skips(2), [cands[0].skip()]);
    assert_eq!(mem.observe(2, &tree), None, "a take carried that never was");

    let mut befores = Vec::new();
    for (i, c) in cands.iter().take(GUESS_TAKEN_KEEP + 1).enumerate() {
        let mut before = tree.clone();
        before.amp.attack = 0.01 * (i + 1) as f64;
        mem.took(3, c.skip(), before.clone());
        befores.push(before);
    }
    assert_eq!(
        mem.observe(3, &befores[0]),
        None,
        "the oldest take was kept"
    );
    assert_eq!(mem.observe(3, &befores[1]), Some(cands[1].skip()));
}

/// Hornet with a quantizer over nothing on its root's slot, where Hornet
/// has its burble: a term the grammar folds away, as a shared file written
/// by an older build can hold.
fn hornet_with_a_quantizer_over_nothing() -> PatchTree {
    use auracle_grammar::term::ModOp;
    let mut tree = preset("Hornet");
    *tree.root.modulation_mut().expect("the root has a slot") = ModNode::Op {
        kind: ModOp::Quantize,
        p0: 0.5,
        p1: 0.0,
        input: Box::new(ModNode::None),
        uid: Uid::NEW,
    };
    tree
}

/// **A guess never takes a module away, even from a patch not in normal
/// form.** Every op a guess makes normalizes the whole term it lands on, so
/// on a patch with a quantizer over nothing each placement, a slew on that
/// slot included, would delete the quantizer: none is offered, and the plan
/// is refused as full rather than offering a guess that silently takes a
/// module away. No patch the engine holds is one (every way in folds it,
/// the import below), but the guess takes any tree it is handed, so the
/// filter stays.
#[test]
fn a_guess_never_takes_a_module_away_from_a_patch_not_in_normal_form() {
    let e = warm(4, false);
    let tree = hornet_with_a_quantizer_over_nothing();
    let had = module_counts(&tree);
    let slew = StructOp::SetMod {
        key: "node".into(),
        kind: ModKind::Slew,
    };
    let taken = apply_struct_op(&tree, &slew).unwrap();
    assert!(
        module_counts(&taken).iter().any(|(k, n)| *n < had[k]),
        "a slew here keeps the quantizer, so this is not the case"
    );
    assert!(guess_candidates(&tree, None).is_empty());
    let none = HashSet::new();
    assert_eq!(
        e.guess_plan(&tree, None, &[], &none, 0).map(|p| p.total),
        Err(GuessRefusal::Full)
    );
}

/// **An imported patch not in normal form gets the guess its normal form
/// gets** (#208). The import (`Engine::import_patch`, after the binding's
/// parse) folds the quantizer over nothing, so the bank holds Hornet with
/// an empty root slot, and the guess on it plans what the guess on that
/// tree written by hand plans, not the refusal that said the patch was
/// full.
#[test]
fn an_imported_patch_not_in_normal_form_gets_the_guess_its_normal_form_gets() {
    let mut e = warm(4, false);
    let file = serde_json::to_string(&hornet_with_a_quantizer_over_nothing()).unwrap();
    let id = e
        .import_patch(serde_json::from_str(&file).unwrap(), "Hornet, shared")
        .expect("the import lands");
    let imported = e.pool[e.find(id).unwrap()].tree.clone();
    let mut normal = preset("Hornet");
    *normal.root.modulation_mut().unwrap() = ModNode::None;
    assert_eq!(imported, normal, "the import kept the quantizer");
    let none = HashSet::new();
    let plan = e.guess_plan(&imported, None, &[], &none, 0);
    assert!(plan.as_ref().is_ok_and(|p| p.total > 0), "{plan:?}");
    assert_eq!(plan, e.guess_plan(&normal, None, &[], &none, 0));
}

/// **A reason is read under the lens most responsible for the guess.** On
/// a taste with two lenses, every guess's reason names the lens whose
/// responsibility for the guessed sound is highest (the first of equals),
/// the lens LEARNING shows the sound under. On this taste the two lenses
/// part for some guess, so the choice of lens is tested, not assumed.
#[test]
fn a_reason_is_read_under_the_lens_most_responsible_for_the_guess() {
    let e = two_lenses();
    let (post, sz) = (e.posterior.as_deref().unwrap(), e.standardizer().unwrap());
    let tree = preset("Hornet");
    let failed = render_all(&e, &tree, None, &[], 0);
    let r = e.guess_rank(&tree, None, &[], &failed, 0).unwrap();
    let (mut read, mut parted) = (0, 0);
    for g in &r.guesses {
        let Some(why) = &g.why else {
            continue;
        };
        let t = apply_struct_op(&tree, &g.op).unwrap();
        let hit = e.memo().get(&render_key(&t, &e.cfg.phrase)).unwrap();
        let resp = post.responsibilities(&sz.transform(&hit.features.phi()));
        let most = (0..resp.len()).fold(0, |m, k| if resp[k] > resp[m] { k } else { m });
        let least = (0..resp.len()).fold(0, |m, k| if resp[k] < resp[m] { k } else { m });
        assert_eq!(
            why.style, most,
            "{} at {}: another lens's reason",
            g.kind, g.socket
        );
        read += 1;
        parted += usize::from(most != least);
    }
    assert!(read > 0, "no guess had a reason: nothing was compared");
    assert!(
        parted > 0,
        "the lenses never parted: the choice was not tested"
    );
}
