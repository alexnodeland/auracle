use super::*;
use crate::SessionConfig;
use auracle_features::{featurize_memo, RenderMemo};
use auracle_grammar::{preset_bank, PatchGrammarPrior, Uid};
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

/// **Every candidate adds, and its family is φ's.** Over random trees from
/// the prior, at the output and at a deeper socket: each candidate is a
/// valid tree, larger than the patch, and raises its family's φ
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
        let mut ks = Vec::new();
        keys(&tree.root, "node".into(), &mut ks);
        let deep = ks.last().map(|k| k.0.clone());
        for at in [None, deep.as_deref()] {
            for c in guess_candidates(&tree, at) {
                assert!(validate_tree(&c.tree).is_ok());
                if !matches!(c.op, StructOp::SetMod { .. }) {
                    // A modulator is not an audio node; its family says it
                    // was added (below).
                    assert!(c.tree.root.size() > tree.root.size(), "{:?}", c.op);
                }
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
/// undo restores it), for no other tree and no other patch, once; the guess
/// is then planned no more.
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

    let e = warm(4, false);
    featurize_memo(&tree, &e.cfg.phrase, e.memo(), false).unwrap();
    let plan = e
        .guess_plan(&tree, None, mem.skips(7), &HashSet::new(), 0)
        .unwrap();
    assert!(plan.skipped > 0);
    assert!(plan.jobs.iter().all(|j| j.tree != c.tree));

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
