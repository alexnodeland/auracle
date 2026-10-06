use super::*;
use fugue::runtime::handler::run;
use fugue::runtime::interpreters::PriorHandler;
use fugue::Trace;
use fugue_evo::genome::trace_genome::TraceGenome;
use rand::rngs::StdRng;
use rand::SeedableRng;

/// The leaves are exactly the non-recursive kinds, wherever the append-only
/// order happened to put them.
#[test]
fn leafness_is_a_predicate_not_a_range() {
    let leaves: Vec<usize> = (0..N_MODS).filter(|k| mod_kind_is_leaf(*k)).collect();
    assert_eq!(leaves, vec![0, 1, 2, 3, 4, 5, 8]);
    let prior = PatchGrammarPrior::default();
    let at_bound = prior.mod_weights_at(prior.max_mod_depth, false);
    assert_eq!(at_bound[MOD_OP], 0.0, "Op survived the depth bound");
    assert_eq!(at_bound[MOD_PAIR], 0.0, "Pair survived the depth bound");
    assert!(
        at_bound[MOD_STEPS] > 0.0,
        "the depth bound switched off the steps leaf along with the branches"
    );
}

/// Every modulation term that reaches the depth bound can still bottom out
/// in `Steps`.
///
/// The fixture offers the grammar *only* `Pair` and `Steps` below the top
/// of a slot, so a two-deep pair chain reaches the bound with `Steps` as
/// the single legal leaf. Under the old `skip(6)` rule the bound zeroed
/// index 8 too, left the categorical with no mass at all, and the draw
/// could not complete — which is exactly the regression this pins.
#[test]
fn a_max_depth_mod_term_can_still_draw_steps() {
    let prior = PatchGrammarPrior {
        mod_weights: [0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0],
        ..PatchGrammarPrior::default()
    };
    fn leaves_are_steps(m: &ModNode) -> bool {
        match m {
            ModNode::None | ModNode::Steps { .. } => true,
            ModNode::Pair { a, b, .. } => leaves_are_steps(a) && leaves_are_steps(b),
            _ => false,
        }
    }
    fn slots<'a>(n: &'a AudioNode, out: &mut Vec<&'a ModNode>) {
        if let Some(m) = n.modulation() {
            out.push(m);
        }
        for c in n.children() {
            slots(c, out);
        }
    }
    let mut rng = StdRng::seed_from_u64(0x57E95);
    let mut deepest = 0usize;
    for _ in 0..40 {
        let (drawn, _): (PatchTree, Trace) = run(
            PriorHandler {
                rng: &mut rng,
                trace: Trace::default(),
            },
            prior.model(),
        );
        let plain = prior.sample_with_rng(&mut rng);
        for t in [&drawn, &plain] {
            let mut ms = Vec::new();
            slots(&t.root, &mut ms);
            for m in ms {
                assert!(
                    leaves_are_steps(m),
                    "a leaf other than steps: {}",
                    t.to_sexpr()
                );
                assert!(m.depth() <= prior.max_mod_depth + 1);
                deepest = deepest.max(m.depth());
            }
            assert_eq!(&PatchTree::from_trace(&t.to_trace()).unwrap(), t);
        }
    }
    assert_eq!(
        deepest,
        prior.max_mod_depth + 1,
        "no term reached the depth bound, so this proved nothing"
    );
}

/// A kind at weight 0 is never drawn by the RNG sampler, at either edge
/// of the unit interval: not by a draw of exactly 0 when it comes first,
/// and not by the rounding sliver past the last boundary when it comes
/// last (AUDIO IN, while it is off, is the last source). Both used to
/// land on it.
#[test]
fn a_kind_at_weight_zero_is_never_drawn() {
    /// An RNG whose every word is `w`: `gen::<f64>()` is 0 for 0 and the
    /// largest value below 1 for `u64::MAX`.
    struct Fixed(u64);
    impl rand::RngCore for Fixed {
        fn next_u32(&mut self) -> u32 {
            self.0 as u32
        }
        fn next_u64(&mut self) -> u64 {
            self.0
        }
        fn fill_bytes(&mut self, dest: &mut [u8]) {
            dest.fill(self.0 as u8);
        }
        fn try_fill_bytes(&mut self, dest: &mut [u8]) -> Result<(), rand::Error> {
            self.fill_bytes(dest);
            Ok(())
        }
    }
    // Weights whose sum rounds so that the top of the interval falls past
    // the last positive boundary.
    assert_eq!(
        weighted_choice(&mut Fixed(u64::MAX), &[0.19, 0.626, 0.166, 0.0]),
        2
    );
    assert_eq!(weighted_choice(&mut Fixed(0), &[0.0, 1.0]), 1);
    // The shipped sources at both edges.
    let w = PatchGrammarPrior::default().source_weights;
    assert_eq!(w[N_SOURCES - 1], AUDIO_IN_WEIGHT);
    assert_ne!(weighted_choice(&mut Fixed(u64::MAX), &w), N_SOURCES - 1);
    assert_eq!(weighted_choice(&mut Fixed(0), &w), 0);
}

/// **`#src` draws what it drew before AUDIO IN was a player kind, bit for
/// bit.** For the shipped weights and for tilted ones (AUDIO IN untilted
/// at 0, as `Engine::biased_prior` leaves it), `SourceKind` and the
/// categorical the prior used to build return the same index from the
/// same stream and leave the stream in the same state, so no fill, walk or
/// offer deals anything different, and none deals an AUDIO IN. Every
/// drawn kind scores exactly what it scored, AUDIO IN scores the player
/// mass, and weights that draw AUDIO IN score it as drawn.
#[test]
fn source_kind_samples_what_the_old_table_sampled() {
    use fugue::Distribution;
    use rand::Rng;
    let mut tilt = StdRng::seed_from_u64(0x5C0);
    let mut tables = vec![PatchGrammarPrior::default().source_weights];
    for _ in 0..8 {
        let mut w = PatchGrammarPrior::default().source_weights;
        for x in &mut w {
            *x *= (tilt.gen::<f64>() * 2.0 - 1.0).exp();
        }
        tables.push(w);
    }
    for w in &tables {
        assert_eq!(w[SRC_AUDIO_IN], 0.0);
        let (new, old) = (SourceKind::new(w), weighted_cat(w));
        for seed in 0..50u64 {
            let mut a = StdRng::seed_from_u64(seed);
            let mut b = StdRng::seed_from_u64(seed);
            for _ in 0..400 {
                let (x, y) = (new.sample(&mut a), old.sample(&mut b));
                assert_eq!(x, y, "#src drew {x}, the old table {y}");
                assert_ne!(x, SRC_AUDIO_IN, "an AUDIO IN was drawn");
            }
            assert_eq!(
                a.gen::<u64>(),
                b.gen::<u64>(),
                "the stream moved differently"
            );
        }
        for i in 0..SRC_AUDIO_IN {
            assert_eq!(new.log_prob(&i).to_bits(), old.log_prob(&i).to_bits());
        }
        assert_eq!(old.log_prob(&SRC_AUDIO_IN), f64::NEG_INFINITY);
        assert_eq!(new.log_prob(&SRC_AUDIO_IN), PLAYER_SOURCE_MASS.ln());
        assert_eq!(new.log_prob(&N_SOURCES), f64::NEG_INFINITY);
    }
    // A test's prior that draws AUDIO IN scores it as it draws it.
    let mut w = PatchGrammarPrior::default().source_weights;
    w[SRC_AUDIO_IN] = 0.2;
    let (new, old) = (SourceKind::new(&w), weighted_cat(&w));
    assert_eq!(
        new.log_prob(&SRC_AUDIO_IN).to_bits(),
        old.log_prob(&SRC_AUDIO_IN).to_bits()
    );
}

/// **`#op` draws what it drew before the player kinds existed, bit for
/// bit.** For the default weights and for tilted ones, `OpKind` and the
/// categorical the prior used to build over `op_weights` return the same
/// index from the same stream, and leave the stream in the same state, so
/// no fill, walk or offer deals anything different. The drawn kinds score
/// exactly what they scored; the player kinds score finite; past them is
/// outside the support.
#[test]
fn op_kind_samples_what_the_old_table_sampled() {
    use fugue::Distribution;
    use rand::Rng;
    let mut tilt = StdRng::seed_from_u64(0x0B5);
    let mut tables = vec![PatchGrammarPrior::default().op_weights];
    for _ in 0..8 {
        let mut w = PatchGrammarPrior::default().op_weights;
        for x in &mut w {
            *x *= (tilt.gen::<f64>() * 2.0 - 1.0).exp();
        }
        tables.push(w);
    }
    for w in &tables {
        let (new, old) = (OpKind::new(w), weighted_cat(w));
        for seed in 0..50u64 {
            let mut a = StdRng::seed_from_u64(seed);
            let mut b = StdRng::seed_from_u64(seed);
            for _ in 0..400 {
                let (x, y) = (new.sample(&mut a), old.sample(&mut b));
                assert_eq!(x, y, "#op drew {x}, the old table {y}");
                assert!(x < N_OPS, "a player kind was drawn");
            }
            assert_eq!(
                a.gen::<u64>(),
                b.gen::<u64>(),
                "the stream moved differently"
            );
        }
        for i in 0..N_OPS {
            assert_eq!(new.log_prob(&i).to_bits(), old.log_prob(&i).to_bits());
        }
        for i in [OP_TRACK, OP_CAPTURE] {
            assert_eq!(new.log_prob(&i), PLAYER_OP_MASS.ln());
        }
        assert_eq!(new.log_prob(&N_OP_KINDS), f64::NEG_INFINITY);
    }
    assert_eq!(op_label(OP_TRACK), Some("track"));
    assert_eq!(op_label(OP_CAPTURE), Some("capture"));
    assert_eq!(op_label(N_OPS - 1), Some("vocoder"));
    assert_eq!(op_label(N_OP_KINDS), None);
}

/// **`#input` is the player's, at every slot alike**: a drawn AUDIO IN
/// reads slot 0, every slot in `0..INPUT_SLOTS` scores the same (0), and a
/// slot past the last is outside the support.
#[test]
fn every_input_slot_scores_alike_and_a_draw_reads_the_first() {
    use fugue::Distribution;
    let mut rng = StdRng::seed_from_u64(0x1A9);
    assert!((0..50).all(|_| PlayerInput.sample(&mut rng) == 0));
    for slot in 0..INPUT_SLOTS {
        assert_eq!(PlayerInput.log_prob(&slot), 0.0, "slot {slot}");
    }
    assert_eq!(PlayerInput.log_prob(&INPUT_SLOTS), f64::NEG_INFINITY);
}

/// The three site distributions the grammar writes itself (`#input`, `#op`,
/// `#src`) clone, as fugue clones a boxed distribution, into ones that draw
/// the same indices from the same stream and score every index the same:
/// over weights far from the defaults, so a clone rebuilt from them would
/// not pass.
#[test]
fn the_grammars_own_distributions_clone_into_the_same_distribution() {
    let defaults = PatchGrammarPrior::default();
    let op_weights: [f64; N_OPS] = std::array::from_fn(|i| ((i + 1) * (i + 1)) as f64);
    let mut source_weights = [1.0; N_SOURCES];
    source_weights[0] = 9.0;
    source_weights[SRC_AUDIO_IN] = 0.5;
    type Site = Box<dyn fugue::Distribution<usize>>;
    let sites: [(&str, Site, Site); 3] = [
        ("#input", Box::new(PlayerInput), Box::new(PlayerInput)),
        (
            "#op",
            Box::new(OpKind::new(&op_weights)),
            Box::new(OpKind::new(&defaults.op_weights)),
        ),
        (
            "#src",
            Box::new(SourceKind::new(&source_weights)),
            Box::new(SourceKind::new(&defaults.source_weights)),
        ),
    ];
    for (site, d, default) in &sites {
        if *site != "#input" {
            assert!(
                (0..N_OP_KINDS).any(|i| d.log_prob(&i) != default.log_prob(&i)),
                "{site}'s weights are the defaults"
            );
        }
        let copy = d.clone_box();
        for i in 0..=N_OP_KINDS {
            assert_eq!(copy.log_prob(&i), d.log_prob(&i), "{site} at {i}");
        }
        let (mut a, mut b) = (StdRng::seed_from_u64(0xC10), StdRng::seed_from_u64(0xC10));
        for _ in 0..200 {
            assert_eq!(copy.sample(&mut a), d.sample(&mut b), "{site}");
        }
    }
}
