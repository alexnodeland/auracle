//! # ricercar-grammar
//!
//! The **patch prior**: a typed probabilistic context-free grammar (PCFG) over
//! quiver-backed synthesizer patch terms, plus the compiler from sampled terms
//! to playable quiver [`Patch`](quiver) graphs.
//!
//! The genome is a *term* ([`term::PatchTree`]), not a raw patch graph. The
//! Audio/Mod sort distinction is enforced by the Rust type system — ill-sorted
//! terms are unrepresentable — and the grammar ([`prior::PatchGrammarPrior`])
//! is a fugue generative program, so all three levels of evolution live in one
//! representation:
//!
//! - node settings   → leaf parameter sites (`F64`/`Usize` draws per module)
//! - connectivity    → interior structure (chains, mix, modulation slots)
//! - node set        → which module productions fire
//!
//! [`PatchTree`](term::PatchTree) implements fugue-evo's genome traits with a
//! canonical trace encoding that **is** the grammar's address scheme, so
//! subtree mutation/crossover are generic trace moves and tempered SMC / typed
//! MH come for free.
//!
//! ## v1 constraints (DESIGN.md §1.1, §2.1)
//!
//! - Acyclic terms only — no feedback combinator productions. Modules with
//!   *internal* feedback (delay, chorus) are allowed.
//! - Curated palette: Vco, Supersaw, NoiseGenerator, Wavetable,
//!   KarplusStrong, FormantOsc, Svf, DiodeLadderFilter, ParametricEq,
//!   Wavefolder, Distortion, Bitcrusher, DelayLine, Chorus, Reverb, Phaser,
//!   Flanger, Tremolo, Vibrato, Granular, PitchShifter, RingModulator,
//!   Compressor, Ducker, NoiseGate, Vocoder, Adsr, Vca, Lfo, SampleAndHold,
//!   SlewLimiter, EnvelopeFollower.
//! - Every compiled patch gets the mandatory voice stage — amp ADSR → VCA →
//!   **Limiter** → StereoOutput — and bounded parameter mappings (resonance,
//!   feedback), so the grammar cannot express the most degenerate settings.

pub mod compile;
pub mod describe;
pub mod diff;
pub mod edit;
pub mod genome;
pub mod mutate;
pub mod presets;
pub mod prior;
pub mod term;

pub use compile::{compile, CompiledVoice, ParamHandle, ParamMap};
pub use describe::{describe, RackDescription};
pub use diff::{tree_diff, DiffEntry};
pub use edit::{set_param, EditError, ParamValue};
pub use mutate::{apply_struct_op, validate_tree, ModKind, NodeKind, StructError, StructOp};
pub use presets::{preset_bank, presets, Category, Preset, CATEGORIES};
pub use prior::PatchGrammarPrior;
pub use term::{AudioNode, ModNode, PatchTree, Uid};

#[cfg(test)]
mod tests {
    use super::*;
    use fugue::runtime::handler::run;
    use fugue::runtime::interpreters::{PriorHandler, ScoreGivenTrace};
    use fugue::Trace;
    use fugue_evo::genome::trace_genome::TraceGenome;
    use fugue_evo::inference::prior::GenomePrior;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    const SR: f64 = 44_100.0;

    fn draw(prior: &PatchGrammarPrior, rng: &mut StdRng) -> (PatchTree, Trace) {
        run(
            PriorHandler {
                rng,
                trace: Trace::default(),
            },
            prior.model(),
        )
    }

    /// M1 gate: every prior sample compiles to a valid quiver patch, and any
    /// wiring warnings stay within the two known-benign classes (constant
    /// bipolar Offset → unipolar knob, unipolar env → bipolar FM input).
    #[test]
    fn every_prior_sample_compiles() {
        let prior = PatchGrammarPrior::default();
        let mut rng = StdRng::seed_from_u64(1);
        for i in 0..200 {
            let (tree, trace) = draw(&prior, &mut rng);
            assert!(trace.log_prior.is_finite(), "sample {i}: log_prior finite");
            assert!(trace.log_prior < 0.0, "sample {i}: pays prior mass");
            let voice = compile(&tree, SR).unwrap_or_else(|e| {
                panic!("sample {i} failed to compile: {e}\n{}", tree.to_sexpr())
            });
            for w in &voice.warnings {
                assert!(
                    w.contains("Bipolar/Unipolar CV mismatch")
                        || w.contains("Unipolar CV to V/Oct")
                        || w.contains("may need offset adjustment")
                        // S&H random wiring: noise (audio) into the CV
                        // sampler, and the square clock into its trigger.
                        || w.contains("Audio/CV connection")
                        || w.contains("Audio to Gate/Trigger")
                        // ±5 V square clock into the S&H trigger thresholds
                        // cleanly at the 2.5 V gate level.
                        || w.contains("Unusual connection: CvBipolar -> Trigger")
                        // The note gate plucks the string. quiver edge-detects
                        // the port, so a held gate excites once — which is the
                        // behaviour this class warns *might* differ, and here
                        // is exactly the behaviour wanted.
                        || w.contains("Gate/Trigger connection")
                        // `Adsr.shape`, `Vca.response` and `Limiter.soft` are
                        // Gate-kind ports quiver reads as booleans at 2.5 V.
                        // Pinning them is a baked `set_param_by_id` default
                        // now (no cable, no warning), but the class stays
                        // allowed for any remaining CvBipolar-into-Gate wiring.
                        || w.contains("Unusual connection: CvBipolar -> Gate")
                        // Wave 2C: modulation is a sort, so CV now meets CV
                        // through quiver's utility modules, whose ports are
                        // typed for the job they usually do rather than for
                        // the one this grammar gives them. All six are volt
                        // arithmetic on wires that are already in range.
                        //
                        // `Rectifier` and `VcSwitch` type their inputs as
                        // Audio because they are usually waveshapers; here
                        // they are fed a modulator or a gate, and `|x|` and
                        // "pick one of two" do not read the signal kind.
                        || w.contains("Unusual connection: CvUnipolar -> Audio")
                        || w.contains("Unusual connection: Gate -> Audio")
                        || w.contains("Unusual connection: Trigger -> Audio")
                        // A 0–10 V modulator into a logic input, thresholded
                        // at 2.5 V — which is the whole point of putting a
                        // logic gate on a modulator.
                        || w.contains("Unusual connection: CvUnipolar -> Gate")
                        // A euclidean pattern or a logic output into the mod
                        // cable's own attenuverter, or into `Min`/`Max`/the
                        // sample-and-hold: 5 V arriving on a ±5 V wire.
                        || w.contains("Unusual connection: Gate -> CvBipolar")
                        || w.contains("Unusual connection: Trigger -> CvBipolar"),
                    "sample {i}: unexpected warning class: {w}"
                );
            }
        }
    }

    /// Compiled patches make sound and stay bounded: gate a note, tick a
    /// second of audio, assert finite output everywhere, a bounded peak, and
    /// that a healthy fraction of patches are audible.
    #[test]
    fn compiled_patches_sound_and_stay_bounded() {
        let prior = PatchGrammarPrior::default();
        let mut rng = StdRng::seed_from_u64(2);
        let n = 24;
        let mut audible = 0;
        for i in 0..n {
            let (tree, _) = draw(&prior, &mut rng);
            let mut voice = compile(&tree, SR).expect("compiles");
            voice.gate.set(5.0);
            voice.pitch.set(0.0); // C4
            let mut peak = 0.0f64;
            let mut sum_sq = 0.0f64;
            let ticks = SR as usize / 2; // half a second
            for _ in 0..ticks {
                let (l, r) = voice.patch.tick();
                assert!(
                    l.is_finite() && r.is_finite(),
                    "sample {i}: non-finite output"
                );
                peak = peak.max(l.abs()).max(r.abs());
                sum_sq += l * l;
            }
            // The limiter's ceiling is threshold·5 V ≤ 5 V; leave headroom for
            // its release-time overshoot but fail on runaway.
            assert!(peak <= 10.0, "sample {i}: peak {peak} exceeds bound");
            let rms = (sum_sq / ticks as f64).sqrt();
            if rms > 1e-3 {
                audible += 1;
            }
        }
        // Slow attacks and low sustains legitimately produce quiet patches;
        // the vetting gate (M2) will quarantine them. But most must sound.
        assert!(
            audible * 2 > n,
            "only {audible}/{n} patches audible in 1s — grammar is generating duds"
        );
    }

    /// The canonical trace encoding is the exact inverse of the generative
    /// program: choices match site-for-site, and replay-scoring the encoding
    /// recovers the same PCFG log-prior. This pins `to_trace` to the grammar —
    /// they cannot drift apart.
    #[test]
    fn to_trace_inverts_generative_run() {
        let prior = PatchGrammarPrior::default();
        let mut rng = StdRng::seed_from_u64(3);
        for _ in 0..50 {
            let (tree, gen_trace) = draw(&prior, &mut rng);
            let enc = tree.to_trace();
            assert_eq!(enc.choices.len(), gen_trace.choices.len());
            for (addr, choice) in &gen_trace.choices {
                assert_eq!(
                    enc.choices[addr].value, choice.value,
                    "encoding mismatch at {addr}"
                );
            }
            let (replayed, scored) = run(
                ScoreGivenTrace {
                    base: enc,
                    trace: Trace::default(),
                },
                prior.model(),
            );
            assert_eq!(replayed, tree);
            assert!((scored.log_prior - gen_trace.log_prior).abs() < 1e-9);
        }
    }

    /// `from_trace(to_trace(t)) == t` for prior draws and for the plain-RNG
    /// sampler (the two samplers must agree on representable trees).
    #[test]
    fn trace_roundtrip() {
        let prior = PatchGrammarPrior::default();
        let mut rng = StdRng::seed_from_u64(4);
        for _ in 0..50 {
            let (tree, _) = draw(&prior, &mut rng);
            let back = PatchTree::from_trace(&tree.to_trace()).expect("roundtrip");
            assert_eq!(back, tree);
        }
        for _ in 0..50 {
            let tree = prior.sample_with_rng(&mut rng);
            let back = PatchTree::from_trace(&tree.to_trace()).expect("roundtrip");
            assert_eq!(back, tree);
            assert!(compile(&tree, SR).is_ok());
        }
    }

    /// Every knob address in the rack description is a real trace site, every
    /// continuous/enum knob is editable through it, and the edit is exactly a
    /// one-site trace change (the panel cannot drift from the genome).
    #[test]
    fn rack_description_addresses_are_live() {
        use fugue_evo::genome::trace_genome::ChoiceValue;
        let prior = PatchGrammarPrior::default();
        let mut rng = StdRng::seed_from_u64(11);
        for _ in 0..50 {
            let (tree, _) = draw(&prior, &mut rng);
            let rack = describe::describe(&tree);
            let trace = tree.to_trace();
            for m in &rack.modules {
                for a in &m.structural_addrs {
                    assert!(
                        trace.choices.keys().any(|k| &**k == a.as_str()),
                        "structural addr {a} not in trace"
                    );
                }
                for knob in &m.knobs {
                    let found = trace
                        .choices
                        .iter()
                        .find(|(k, _)| &***k == knob.addr.as_str())
                        .unwrap_or_else(|| panic!("knob addr {} not in trace", knob.addr));
                    let edited = match knob.kind {
                        describe::KnobKind::Continuous => {
                            assert!(matches!(found.1.value, ChoiceValue::F64(_)));
                            set_param(&tree, &knob.addr, ParamValue::Continuous(0.5)).unwrap()
                        }
                        describe::KnobKind::Enum { .. } | describe::KnobKind::Octave => {
                            assert!(matches!(found.1.value, ChoiceValue::Usize(_)));
                            set_param(&tree, &knob.addr, ParamValue::Index(0)).unwrap()
                        }
                    };
                    // The edit changes at most that one site.
                    let d = tree_diff(&tree, &edited);
                    assert!(d.len() <= 1, "edit at {} touched {:?}", knob.addr, d);
                    assert!(compile(&edited, SR).is_ok());
                }
            }
            // Wires reference existing modules only.
            for w in &rack.wires {
                assert!(rack.modules.iter().any(|m| m.key == w.from) || w.from == "node");
                assert!(rack.modules.iter().any(|m| m.key == w.to));
            }
        }
    }

    /// Structural sites reject knob edits; unknown addresses error cleanly.
    #[test]
    fn edits_reject_structure_and_unknowns() {
        let prior = PatchGrammarPrior::default();
        let mut rng = StdRng::seed_from_u64(12);
        let (tree, _) = draw(&prior, &mut rng);
        assert!(matches!(
            set_param(&tree, "node#leaf", ParamValue::Index(0)),
            Err(EditError::Structural(_))
        ));
        assert!(matches!(
            set_param(&tree, "nowhere#cut", ParamValue::Continuous(0.5)),
            Err(EditError::UnknownAddress(_))
        ));
    }

    /// tree_diff is empty on identity and localizes a single edit.
    #[test]
    fn diff_localizes_edits() {
        let prior = PatchGrammarPrior::default();
        let mut rng = StdRng::seed_from_u64(13);
        let (tree, _) = draw(&prior, &mut rng);
        assert!(tree_diff(&tree, &tree).is_empty());
        let edited = set_param(&tree, "amp#attack", ParamValue::Continuous(0.9)).unwrap();
        let d = tree_diff(&tree, &edited);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].addr, "amp#attack");
        assert!(d[0].before.is_some() && d[0].after.is_some());
    }

    /// Every preset compiles, and structural edits (replace / insert /
    /// delete / set-mod / swap) always yield compilable, describable,
    /// trace-roundtrippable trees — hand rewiring cannot leave the grammar.
    #[test]
    fn presets_and_struct_ops_stay_in_grammar() {
        use mutate::{ModKind, NodeKind, StructOp};
        for (name, tree) in presets::presets() {
            assert!(compile(&tree, SR).is_ok(), "preset {name} fails to compile");
            assert!(!tree.signature().is_empty());
        }
        let prior = PatchGrammarPrior::default();
        let mut rng = StdRng::seed_from_u64(21);
        let kinds = [
            NodeKind::Vco,
            NodeKind::Supersaw,
            NodeKind::Noise,
            NodeKind::Wavetable,
            NodeKind::Pluck,
            NodeKind::Mix,
            NodeKind::RingMod,
            NodeKind::Filter,
            NodeKind::Fold,
            NodeKind::Delay,
            NodeKind::Chorus,
            NodeKind::Distortion,
            NodeKind::Bitcrush,
            NodeKind::Phaser,
            // Wave 2B, and the four binaries are the point: every structural
            // op has to survive a node with two audio subtrees *and* a
            // modulation slot, which nothing but mix and ring mod ever had.
            NodeKind::Shift,
            NodeKind::Comp,
            NodeKind::Duck,
            NodeKind::Gate,
            NodeKind::Vocoder,
        ];
        for i in 0..30 {
            let (tree, _) = draw(&prior, &mut rng);
            let keys: Vec<String> = describe::describe(&tree)
                .modules
                .iter()
                .filter(|m| m.key != "amp" && !m.is_mod)
                .map(|m| m.key.clone())
                .collect();
            let mut ops: Vec<StructOp> = Vec::new();
            for key in &keys {
                for kind in kinds {
                    ops.push(StructOp::Replace {
                        key: key.clone(),
                        kind,
                    });
                    if !kind.is_source() {
                        ops.push(StructOp::Insert {
                            key: key.clone(),
                            kind,
                        });
                    }
                }
                ops.push(StructOp::Delete { key: key.clone() });
                for mk in [
                    ModKind::None,
                    ModKind::Lfo,
                    ModKind::Env,
                    ModKind::Rand,
                    ModKind::Follow,
                ] {
                    ops.push(StructOp::SetMod {
                        key: key.clone(),
                        kind: mk,
                    });
                }
                ops.push(StructOp::SwapMix { key: key.clone() });
            }
            for op in ops {
                // Invalid ops are allowed to reject — but never panic.
                if let Ok(next) = mutate::apply_struct_op(&tree, &op) {
                    assert!(
                        compile(&next, SR).is_ok(),
                        "sample {i}: op {op:?} produced uncompilable tree"
                    );
                    assert!(next.root.size() <= mutate::MAX_SIZE);
                    let back = PatchTree::from_trace(&next.to_trace()).unwrap();
                    assert_eq!(back, next, "trace roundtrip after {op:?}");
                    describe::describe(&next); // must not panic
                }
            }
        }
    }

    /// Every structural path that treats a binary node specially, exercised on
    /// each of the six deterministically rather than waiting for the prior to
    /// draw one.
    ///
    /// Mix and ring mod were the only two-child productions for two waves, so
    /// `child_mut`, `graft`, `primary_input`, `Delete`-a-branch, the mod slot
    /// and the trace address scheme are the least-travelled code in the crate
    /// — and wave 2B quadrupled the number of shapes going through them, with
    /// the new ones carrying a modulation slot the old two never had.
    #[test]
    fn every_binary_node_survives_the_whole_edit_vocabulary() {
        use mutate::{ModKind, NodeKind, StructOp};
        let seed = presets::presets()[0].1.clone();
        for kind in [
            NodeKind::Mix,
            NodeKind::RingMod,
            NodeKind::Comp,
            NodeKind::Duck,
            NodeKind::Gate,
            NodeKind::Vocoder,
        ] {
            let tree = mutate::apply_struct_op(
                &seed,
                &StructOp::Replace {
                    key: "node".into(),
                    kind,
                },
            )
            .unwrap_or_else(|e| panic!("{kind:?}: replace at the root: {e}"));
            // A binary node plus two branches: `size` has to count both, and
            // an arm that forgets `/1` reports the tree a node short.
            assert!(
                tree.root.size() >= 3,
                "{kind:?}: size {} — the second branch is not being counted",
                tree.root.size()
            );
            // Both branches are real nodes at `/0` and `/1`, and the rack
            // names them there — those keys are what the frontend hangs its
            // per-module jack labels off.
            let rack = describe::describe(&tree);
            for k in ["node/0", "node/1"] {
                assert!(
                    rack.modules.iter().any(|m| m.key == k),
                    "{kind:?}: no module at {k}"
                );
                assert!(
                    rack.wires.iter().any(|w| w.from == k && w.to == "node"),
                    "{kind:?}: no audio wire from {k}"
                );
            }
            // Deleting either branch collapses to the sibling, both ways.
            for (gone, kept) in [(0usize, 1usize), (1, 0)] {
                let before = describe::describe(&tree);
                let sibling = before
                    .modules
                    .iter()
                    .find(|m| m.key == format!("node/{kept}"))
                    .expect("sibling")
                    .kind
                    .clone();
                let after = mutate::apply_struct_op(
                    &tree,
                    &StructOp::Delete {
                        key: format!("node/{gone}"),
                    },
                )
                .unwrap_or_else(|e| panic!("{kind:?}: delete /{gone}: {e}"));
                assert_eq!(
                    describe::describe(&after).modules[1].kind,
                    sibling,
                    "{kind:?}: deleting /{gone} did not leave /{kept} at the root"
                );
                assert!(compile(&after, SR).is_ok());
            }
            // The modulation slot: the two pure binaries have none, the four
            // dynamics nodes do, and setting one must not disturb `/1`.
            let has_slot = !matches!(kind, NodeKind::Mix | NodeKind::RingMod);
            let set = mutate::apply_struct_op(
                &tree,
                &StructOp::SetMod {
                    key: "node".into(),
                    kind: ModKind::Lfo,
                },
            );
            assert_eq!(
                set.is_ok(),
                has_slot,
                "{kind:?}: modulation slot present = {}, expected {has_slot}",
                set.is_ok()
            );
            if let Ok(set) = set {
                let rack = describe::describe(&set);
                assert!(rack.modules.iter().any(|m| m.key == "node/m" && m.is_mod));
                assert!(rack.modules.iter().any(|m| m.key == "node/1"));
                assert!(compile(&set, SR).is_ok());
                assert_eq!(PatchTree::from_trace(&set.to_trace()).unwrap(), set);
                // A node is never distance-zero from itself with a different
                // slot — `node_distance` has to walk both branches *and* the
                // slot, and a missed arm reads as "identical".
                use fugue_evo::genome::traits::EvolutionaryGenome;
                assert!(set.distance(&tree) > 0.0, "{kind:?}: distance is blind");
            }
            // Insert-into-the-wire keeps the fragment's own `/1`.
            let inserted = mutate::apply_struct_op(
                &tree,
                &StructOp::InsertTree {
                    key: "node/0".into(),
                    node: mutate::apply_struct_op(
                        &seed,
                        &StructOp::Replace {
                            key: "node".into(),
                            kind,
                        },
                    )
                    .unwrap()
                    .root,
                },
            )
            .unwrap_or_else(|e| panic!("{kind:?}: insert into a wire: {e}"));
            assert!(compile(&inserted, SR).is_ok());
            assert_eq!(
                PatchTree::from_trace(&inserted.to_trace()).unwrap(),
                inserted
            );
            // "Swap the two inputs" is offered on every binary in the rack
            // menu, and for five of the six it used to be a guaranteed
            // rejection — a verb the UI printed and the engine refused. It
            // now applies to all six, and it has to actually exchange the
            // branches, not merely return Ok.
            let before = describe::describe(&tree);
            let kind_at = |r: &describe::RackDescription, k: &str| {
                r.modules
                    .iter()
                    .find(|m| m.key == k)
                    .unwrap_or_else(|| panic!("{kind:?}: no module at {k}"))
                    .kind
                    .clone()
            };
            let swapped = mutate::apply_struct_op(&tree, &StructOp::SwapMix { key: "node".into() })
                .unwrap_or_else(|e| panic!("{kind:?}: swap the two inputs: {e}"));
            let after = describe::describe(&swapped);
            assert_eq!(kind_at(&after, "node/0"), kind_at(&before, "node/1"));
            assert_eq!(kind_at(&after, "node/1"), kind_at(&before, "node/0"));
            assert!(compile(&swapped, SR).is_ok());
            assert_eq!(PatchTree::from_trace(&swapped.to_trace()).unwrap(), swapped);
        }
    }

    /// The ceilings have to hold on *both* routes into the bench.
    ///
    /// `apply_struct_op` has always checked them on its way out; the whole-tree
    /// replace behind undo/redo and the editor's client-side rewrites did not,
    /// and that is the route a graph editor leans on hardest. A tree that
    /// `apply_struct_op` would refuse must be refused by `validate_tree` too,
    /// or the ceiling is decorative.
    #[test]
    fn validate_tree_refuses_what_apply_struct_op_refuses() {
        use mutate::{NodeKind, StructOp};
        let mut tree = presets::presets()[0].1.clone();
        assert!(
            validate_tree(&tree).is_ok(),
            "a preset is inside the ceilings"
        );
        // Stack filters at the root until the depth ceiling bites. The op that
        // finally fails is the one whose *result* is out of bounds, so build
        // that result by hand and check the validator agrees.
        let mut over = None;
        for _ in 0..(mutate::MAX_DEPTH + mutate::MAX_SIZE + 4) {
            let op = StructOp::Insert {
                key: "node".into(),
                kind: NodeKind::Filter,
            };
            match mutate::apply_struct_op(&tree, &op) {
                Ok(next) => tree = next,
                Err(_) => {
                    // Same edit, ceiling check skipped: exactly what
                    // `edit_set_tree` used to hand the engine.
                    let mut raw = tree.clone();
                    raw.root = default_filter_over(raw.root);
                    over = Some(raw);
                    break;
                }
            }
        }
        let over = over.expect("the ceilings must bite within a bounded number of inserts");
        assert!(
            validate_tree(&over).is_err(),
            "validate_tree let through a tree apply_struct_op refuses"
        );
    }

    /// A filter wrapping `inner`, built without going through the op vocabulary
    /// — the point of the test above is to construct a tree the vocabulary
    /// would never return.
    fn default_filter_over(inner: term::AudioNode) -> term::AudioNode {
        term::AudioNode::Filter {
            uid: Uid::NEW,
            kind: term::FilterKind::SvfLp,
            cutoff: 0.5,
            resonance: 0.2,
            mod_depth: 0.0,
            input: Box::new(inner),
            modulation: term::ModNode::None,
        }
    }

    /// Deeper patches pay more prior mass — parsimony is the grammar itself.
    #[test]
    fn prior_penalizes_depth() {
        let prior = PatchGrammarPrior::default();
        let mut rng = StdRng::seed_from_u64(5);
        let mut sized: Vec<(usize, f64)> = Vec::new();
        for _ in 0..300 {
            let (tree, trace) = draw(&prior, &mut rng);
            sized.push((tree.root.size(), trace.log_prior));
        }
        let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len() as f64;
        let small: Vec<f64> = sized
            .iter()
            .filter(|(s, _)| *s <= 2)
            .map(|(_, lp)| *lp)
            .collect();
        let large: Vec<f64> = sized
            .iter()
            .filter(|(s, _)| *s >= 5)
            .map(|(_, lp)| *lp)
            .collect();
        assert!(!small.is_empty() && !large.is_empty());
        assert!(
            mean(&small) > mean(&large),
            "small patches {} should out-mass large ones {}",
            mean(&small),
            mean(&large)
        );
    }

    // ---------- node identity ----------

    /// Uids must be invisible to every system that reasons about *content*.
    ///
    /// Three of those, and all three would break loudly: the engine's pool
    /// dedup and refinement's own "did the walk move" test are both
    /// `PatchTree` equality, and the render memo is a hash of the tree's JSON.
    /// If a fresh identity could make two identical patches differ, evolution
    /// would admit duplicates forever and every refinement step would miss a
    /// cache it had just filled.
    #[test]
    fn uid_is_invisible_to_content() {
        let mut a = presets::presets()[0].1.clone();
        let mut b = a.clone();
        a.ensure_uids();
        b.ensure_uids();
        assert_ne!(
            a.root.uid().0,
            b.root.uid().0,
            "two settlings must mint different identities, or the test is vacuous"
        );
        assert_eq!(a, b, "patches that differ only in uid are the same patch");

        // The render memo's content address is `canonical_tree_json`, which
        // clears identities first; the half of that contract this crate can
        // state is that clearing lands both trees on the same term. The JSON
        // itself is pinned in `ricercar_features::cache`, where the key lives.
        let (mut ca, mut cb) = (a.clone(), b.clone());
        ca.clear_uids();
        cb.clear_uids();
        assert!(ca.root.uid().is_new() && cb.root.uid().is_new());
        assert_eq!(ca, cb);
    }

    /// A structural edit keeps the identity of every module that lived
    /// through it, and mints one for the module it added.
    ///
    /// This is the difference between "insert a filter" and "throw the patch
    /// away and build a new one that looks similar", and every lock, hand
    /// position and selection in the panel rides on it.
    #[test]
    fn struct_ops_carry_identity_through() {
        use mutate::{NodeKind, StructOp};
        let mut tree = presets::presets()[0].1.clone();
        tree.ensure_uids();
        let before = describe::describe(&tree);
        let uid_of = |d: &describe::RackDescription, key: &str| {
            d.modules.iter().find(|m| m.key == key).map(|m| m.uid)
        };
        let root_uid = uid_of(&before, "node").expect("a root module");

        // Insert above the root: everything shifts down one key, and nothing
        // changes identity but the new plate.
        let after = describe::describe(
            &mutate::apply_struct_op(
                &tree,
                &StructOp::Insert {
                    key: "node".into(),
                    kind: NodeKind::Filter,
                },
            )
            .expect("insert at the root is legal"),
        );
        assert_eq!(
            uid_of(&after, "node/0"),
            Some(root_uid),
            "the module that was at `node` is now at `node/0` and is the same module"
        );
        assert!(
            uid_of(&after, "node") != Some(root_uid) && uid_of(&after, "node") != Some(0),
            "the inserted filter gets an identity of its own"
        );

        // And the identities in one tree are unique, including after a splice.
        let mut seen = std::collections::HashSet::new();
        for m in &after.modules {
            if m.key == "amp" {
                continue;
            }
            assert!(seen.insert(m.uid), "duplicate uid on {}", m.key);
        }
    }

    /// **R6.** A refined child must inherit its seed's identities wherever the
    /// structure survived.
    ///
    /// Refinement proposes over the *trace* and rebuilds the genome from it on
    /// every accepted step, and a trace has no room for a uid — so the decoded
    /// tree comes back anonymous. This is that exact round trip, without the
    /// MCMC: encode, decode, and check that identity is gone and that
    /// `inherit_uids` puts it back. Without it every ⚡ evolve would look to
    /// the panel like a brand-new patch and every lock and hand position in it
    /// would evaporate on the app's central action.
    #[test]
    fn identity_survives_the_trace_round_trip() {
        let mut seed = presets::presets()[3].1.clone();
        seed.ensure_uids();
        let mut child = PatchTree::from_trace(&seed.to_trace()).expect("a trace decodes");
        assert!(
            child.root.uid().is_new(),
            "the decoder cannot carry identities — that is why inheritance exists"
        );
        child.inherit_uids(&seed);
        let (a, b) = (describe::describe(&seed), describe::describe(&child));
        assert_eq!(a.modules.len(), b.modules.len());
        for (x, y) in a.modules.iter().zip(&b.modules) {
            assert_eq!(x.key, y.key);
            assert_eq!(x.uid, y.uid, "identity lost at {}", x.key);
        }
    }

    /// Settling reaches **every** module the rack draws, in every patch the
    /// prior can produce.
    ///
    /// The walk has to know which productions carry children and which carry a
    /// modulation slot, and a wildcard arm in either table is a module that
    /// silently never gets an identity — which is how a `Shift`'s modulator
    /// went uid-less on the first pass here. Prior draws are the right net:
    /// they reach productions no preset uses.
    #[test]
    fn every_drawn_module_gets_an_identity() {
        let prior = PatchGrammarPrior::default();
        let mut rng = StdRng::seed_from_u64(0x1D_5E7);
        for _ in 0..200 {
            let (mut tree, _) = draw(&prior, &mut rng);
            tree.ensure_uids();
            let rack = describe::describe(&tree);
            let mut seen = std::collections::HashSet::new();
            for m in rack.modules.iter().filter(|m| m.key != "amp") {
                assert_ne!(m.uid, 0, "{} ({}) has no identity", m.key, m.kind);
                assert!(seen.insert(m.uid), "{} shares an identity", m.key);
            }
        }
    }

    /// A restored save carries identities the mint has never issued, and the
    /// mint must not issue them again.
    ///
    /// The counter is per-process and a page reload starts it at 1, while the
    /// save it restores is full of ids from the session that wrote it. Without
    /// this, inserting one module into a restored patch would hand out an id
    /// that patch already uses and two nodes would answer to one lock — the
    /// exact confusion identities exist to end, arriving only for the returning
    /// user, only after a reload.
    #[test]
    fn settling_pushes_the_mint_past_what_it_has_seen() {
        // Stand in for a save written by an older session: a tree whose
        // identities are far above anything this process has minted.
        let mut restored = presets::presets()[0].1.clone();
        restored.ensure_uids();
        let high = term::Uid(9_000_000);
        restored.root.set_uid(high);
        restored.ensure_uids();
        assert_eq!(
            restored.root.uid().0,
            high.0,
            "a set identity is not reissued"
        );

        let mut fresh = presets::presets()[0].1.clone();
        fresh.ensure_uids();
        assert!(
            fresh.root.uid().0 > high.0,
            "the mint reissued an identity a restored patch is already using"
        );
    }

    /// A duplicated subtree brings its original's identities with it in the
    /// copy, and two nodes claiming one identity is worse than none: a lock on
    /// either would light both. Settling breaks the tie.
    #[test]
    fn settling_breaks_duplicate_identities() {
        let mut inner = presets::presets()[0].1.clone();
        inner.ensure_uids();
        let mut tree = inner.clone();
        tree.root = term::AudioNode::Mix {
            uid: Uid::NEW,
            balance: 0.5,
            a: Box::new(inner.root.clone()),
            b: Box::new(inner.root.clone()),
        };
        tree.ensure_uids();
        let d = describe::describe(&tree);
        let mut seen = std::collections::HashSet::new();
        for m in d.modules.iter().filter(|m| m.key != "amp") {
            assert_ne!(m.uid, 0, "{} was left without an identity", m.key);
            assert!(seen.insert(m.uid), "{} shares an identity", m.key);
        }
    }
}
