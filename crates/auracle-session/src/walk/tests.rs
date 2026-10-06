use super::*;
use crate::testkit::*;
use crate::*;
use auracle_grammar::term::{AmpEnv, AudioNode, FilterKind, InputChannel, ModNode, Waveform};
use auracle_grammar::PatchGrammarPrior;
use auracle_grammar::{Uid, INPUT_GAIN_UNITY};
use fugue_evo::genome::trace_genome::TraceGenome;
use rand::rngs::StdRng;
use rand::SeedableRng;

/// A fitness that renders nothing: the walk's target is the grammar prior
/// itself, which is the walk with the most freedom to move anything.
#[derive(Clone)]
struct Flat;
impl fugue_evo::fitness::traits::Fitness for Flat {
    type Genome = PatchTree;
    type Value = f64;
    fn evaluate(&self, _: &PatchTree) -> f64 {
        0.0
    }
}

fn reads(tree: &PatchTree, key: &str) -> Option<usize> {
    tree.to_trace().get_usize(&fugue::addr!(key, "input"))
}

/// **A listening seed walks under the shipped prior, and walks never
/// change an input.** AUDIO IN is a player kind: the shipped prior never
/// draws one and scores a player's finite, so a seed whose AUDIO IN reads
/// slot 4 starts a walk (it used to be refused as outside the support),
/// and walked on the bare prior (where nothing about the sound holds a
/// site in place) every walk comes back with the node where it was and
/// still reading slot 4, while the rest of the patch moves.
///
/// Without the lock this fails at once: the kernel resamples `#input`
/// from `PlayerInput`, which proposes slot 0, and on a flat target that
/// proposal is always accepted.
#[test]
fn walks_never_change_an_input() {
    let seed = PatchTree {
        amp: AmpEnv {
            attack: 0.1,
            decay: 0.4,
            sustain: 0.7,
            release: 0.3,
        },
        root: AudioNode::Mix {
            uid: Uid::NEW,
            balance: 0.5,
            a: Box::new(AudioNode::Vco {
                uid: Uid::NEW,
                wave: Waveform::Saw,
                octave: 0,
                detune: 0.5,
                mod_depth: 0.0,
                modulation: ModNode::None,
            }),
            b: Box::new(AudioNode::Filter {
                uid: Uid::NEW,
                kind: FilterKind::SvfLp,
                cutoff: 0.5,
                resonance: 0.2,
                mod_depth: 0.0,
                input: Box::new(AudioNode::AudioIn {
                    uid: Uid::NEW,
                    input: 4,
                    gain: INPUT_GAIN_UNITY,
                    channel: InputChannel::Left,
                }),
                modulation: ModNode::None,
            }),
        },
    };
    assert_eq!(seed.input_sites(), ["node/1/0#input"]);
    // The shipped prior, which never draws AUDIO IN and scores it finite.
    let prior = PatchGrammarPrior::default();
    let mut moved = 0;
    for w in 0..24u64 {
        let mut rng = StdRng::seed_from_u64(0xA0D1_0000 + w);
        let end = walk_on(
            prior.clone(),
            1.0,
            RefineKeep::Last,
            Flat,
            &mut rng,
            &seed,
            &HashSet::new(),
            120,
        );
        let Ok(child) = end else { continue };
        moved += 1;
        assert_eq!(
            reads(&child, "node/1/0"),
            Some(4),
            "walk {w} changed or removed the input: {}",
            child.to_sexpr()
        );
    }
    assert!(
        moved >= 20,
        "only {moved} of 24 walks moved, so this proved little"
    );
}

/// A seed holding both player kinds: a TRACK playing a saw from input 3
/// beside a filter over a CAPTURE with a take.
fn player_seed() -> PatchTree {
    use auracle_grammar::term::{CaptureMode, PitchBand};
    use auracle_grammar::{Take, TRACK_SENSITIVITY_DEFAULT};
    let take: Vec<f32> = (0..2_000).map(|i| (i as f32 * 0.05).sin() * 0.4).collect();
    PatchTree {
        amp: AmpEnv {
            attack: 0.1,
            decay: 0.4,
            sustain: 0.7,
            release: 0.3,
        },
        root: AudioNode::Mix {
            uid: Uid::NEW,
            balance: 0.5,
            a: Box::new(AudioNode::Track {
                uid: Uid::NEW,
                band: PitchBand::Mid,
                sensitivity: TRACK_SENSITIVITY_DEFAULT,
                dynamics: 0.5,
                input: Box::new(AudioNode::Vco {
                    uid: Uid::NEW,
                    wave: Waveform::Saw,
                    octave: 0,
                    detune: 0.5,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                }),
                listen: Box::new(AudioNode::AudioIn {
                    uid: Uid::NEW,
                    input: 3,
                    gain: INPUT_GAIN_UNITY,
                    channel: InputChannel::Both,
                }),
            }),
            b: Box::new(AudioNode::Filter {
                uid: Uid::NEW,
                kind: FilterKind::SvfLp,
                cutoff: 0.5,
                resonance: 0.2,
                mod_depth: 0.0,
                input: Box::new(AudioNode::Capture {
                    uid: Uid::NEW,
                    play: CaptureMode::Once,
                    input: Box::new(AudioNode::AudioIn {
                        uid: Uid::NEW,
                        input: 0,
                        gain: INPUT_GAIN_UNITY,
                        channel: InputChannel::Left,
                    }),
                    take: Take::from_samples(&take, 44_100.0).unwrap(),
                }),
                modulation: ModNode::None,
            }),
        },
    }
}

/// The take of the CAPTURE at `node/1/0`, whatever the walk made of the
/// modules above it.
fn take_at(tree: &PatchTree) -> Option<auracle_grammar::Take> {
    let mut n = &tree.root;
    for i in [1, 0] {
        n = *n.children().get(i)?;
    }
    match n {
        AudioNode::Capture { take, .. } => Some(take.clone()),
        _ => None,
    }
}

/// A fitness that counts the terms it was asked about that hold the
/// seed's CAPTURE with its take missing. (The kernel also scores
/// proposals that remove the capture, which the hold then rejects; those
/// have no take to carry and are not counted.)
#[derive(Clone)]
struct CountsDeaf(Arc<std::sync::atomic::AtomicUsize>);
impl fugue_evo::fitness::traits::Fitness for CountsDeaf {
    type Genome = PatchTree;
    type Value = f64;
    fn evaluate(&self, g: &PatchTree) -> f64 {
        if take_at(g).is_some_and(|t| t.is_empty()) {
            self.0.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
        0.0
    }
}

/// **Walks hold TRACK and CAPTURE, and never touch a take.** On the bare
/// prior, where nothing about the sound holds a site, every child keeps
/// the TRACK and the CAPTURE where they were, the input the TRACK
/// follows, and the take bit for bit, while the rest of the patch moves.
/// The fitness is never asked about a term without its take.
///
/// Without the `#op` hold this fails at once: the kernel regrows either
/// node away and the prior can never draw it back.
#[test]
fn walks_hold_track_and_capture_and_their_take() {
    let seed = player_seed();
    assert_eq!(
        seed.player_sites(),
        [
            "node/0#op",
            "node/0/1#input",
            "node/1/0#op",
            "node/1/0/0#input"
        ]
    );
    let op = |t: &PatchTree, key: &str| t.to_trace().get_usize(&fugue::addr!(key, "op"));
    let take = take_at(&seed).unwrap();
    let deaf = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let mut moved = 0;
    for w in 0..24u64 {
        let mut rng = StdRng::seed_from_u64(0x7AC0_0000 + w);
        let end = walk_on(
            // The shipped prior: the seed's AUDIO INs are player kinds.
            PatchGrammarPrior::default(),
            1.0,
            RefineKeep::Last,
            CountsDeaf(Arc::clone(&deaf)),
            &mut rng,
            &seed,
            &HashSet::new(),
            120,
        );
        let Ok(child) = end else { continue };
        moved += 1;
        assert_eq!(op(&child, "node/0"), Some(auracle_grammar::prior::OP_TRACK));
        assert_eq!(
            op(&child, "node/1/0"),
            Some(auracle_grammar::prior::OP_CAPTURE)
        );
        assert_eq!(reads(&child, "node/0/1"), Some(3), "{}", child.to_sexpr());
        assert_eq!(
            take_at(&child).as_ref(),
            Some(&take),
            "walk {w} lost the take"
        );
    }
    assert!(moved >= 20, "only {moved} of 24 walks moved");
    assert_eq!(
        deaf.load(std::sync::atomic::Ordering::Relaxed),
        0,
        "the fitness heard a capture without its take"
    );
}

/// **A walk bred toward a sound hears the takes too.** `walk_on` wraps
/// whatever fitness it is given in `WithTakes`, so a tilted walk is
/// `WithTakes(TowardFitness(taste))`: the tilt measures the same term the
/// taste scores, with the seed's take carried back, never the deaf one
/// the decoder hands out. Every child keeps its take, and the fitness
/// under the tilt is never asked about a capture without one.
#[test]
fn a_tilted_walk_carries_and_hears_the_takes() {
    let seed = player_seed();
    let take = take_at(&seed).unwrap();
    let deaf = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let phrase = auracle_features::PhraseSpec::default();
    let memo = RenderMemo::default();
    let d = auracle_features::Features::phi_names().len();
    let tilted = crate::own::TowardFitness {
        inner: CountsDeaf(Arc::clone(&deaf)),
        toward: crate::own::Toward {
            observed: vec![0, 3],
            target: vec![0.3, -0.2],
            gamma: crate::own::OWN_GAMMA,
        },
        standardizer: Arc::new(auracle_taste::Standardizer {
            mean: vec![0.0; d],
            std: vec![1.0; d],
        }),
        phrase,
        memo,
    };
    let ends: Vec<_> = std::thread::scope(|s| {
        let hs: Vec<_> = (0..3u64)
            .map(|w| {
                let (seed, tilted) = (&seed, tilted.clone());
                s.spawn(move || {
                    let mut rng = StdRng::seed_from_u64(0x70A2_0000 + w);
                    walk_on(
                        PatchGrammarPrior::default(),
                        1.0,
                        RefineKeep::Last,
                        tilted,
                        &mut rng,
                        seed,
                        &HashSet::new(),
                        20,
                    )
                })
            })
            .collect();
        hs.into_iter().map(|h| h.join().unwrap()).collect()
    });
    let mut moved = 0;
    for end in ends {
        let Ok(child) = end else { continue };
        moved += 1;
        assert_eq!(
            take_at(&child).as_ref(),
            Some(&take),
            "a tilted walk lost the take"
        );
    }
    assert!(moved >= 1, "no tilted walk moved, so this proved little");
    assert_eq!(
        deaf.load(std::sync::atomic::Ordering::Relaxed),
        0,
        "the tilted fitness heard a capture without its take"
    );
}

/// A walk that accepts only steps changing nothing is no move, even
/// though every term it accepted came back from the decoder without the
/// take: the take is carried back before the fixed-point test.
#[test]
fn a_walk_that_moves_nothing_is_no_move_with_a_take() {
    let seed = player_seed();
    let every: HashSet<String> = seed
        .to_trace()
        .choices
        .keys()
        .map(|a| a.to_string())
        .collect();
    for w in 0..4u64 {
        let mut rng = StdRng::seed_from_u64(0x0F1E + w);
        let end = walk_on(
            // The shipped prior: the seed's AUDIO INs are player kinds.
            PatchGrammarPrior::default(),
            1.0,
            RefineKeep::Last,
            Flat,
            &mut rng,
            &seed,
            &every,
            60,
        );
        assert!(matches!(end, Err(RefineOutcome::NoMove)), "{end:?}");
    }
}

/// A walk is a pure function of its context and job: the same job on a
/// cold memo, on a warm one, and after its context and job have been
/// through JSON (the farm's wire) gives the same result, byte for byte.
#[test]
fn a_walk_is_a_function_of_its_job() {
    let mut engine = taught(0xA1C);
    let (ctx, jobs) = engine
        .refine_jobs(&mut StdRng::seed_from_u64(3))
        .expect("taught");
    let text = |r: &WalkResult| serde_json::to_string(r).unwrap();
    let wire_ctx: WalkContext =
        serde_json::from_str(&serde_json::to_string(&ctx).unwrap()).unwrap();
    let mut moved = 0;
    for job in jobs.iter().take(3) {
        let cold = run_walk(&ctx, job, &auracle_features::RenderMemo::default());
        let warm = run_walk(&ctx, job, engine.memo());
        let wire_job: walk::WalkJob =
            serde_json::from_str(&serde_json::to_string(job).unwrap()).unwrap();
        assert_eq!(&wire_job, job);
        let wired = run_walk(
            &wire_ctx,
            &wire_job,
            &auracle_features::RenderMemo::default(),
        );
        assert_eq!(
            text(&cold),
            text(&warm),
            "job {}: the memo moved a walk",
            job.index
        );
        assert_eq!(
            text(&cold),
            text(&wired),
            "job {}: the wire moved a walk",
            job.index
        );
        if let Some(child) = &cold.child {
            moved += 1;
            let cached = cold.cached.as_ref().expect("a child carries its features");
            assert_eq!(cached.key, auracle_features::render_key(child, &ctx.phrase));
        }
    }
    assert!(moved > 0, "no walk moved, so no child was compared");
}
