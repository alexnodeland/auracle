//! # evosynth-grammar
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
//! - Curated palette: Vco, Supersaw, NoiseGenerator, Svf, DiodeLadderFilter,
//!   Adsr, Vca, Lfo, DelayLine, Chorus, Wavefolder.
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
pub use mutate::{apply_struct_op, ModKind, NodeKind, StructError, StructOp};
pub use presets::presets;
pub use prior::PatchGrammarPrior;
pub use term::{AudioNode, ModNode, PatchTree};

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
                        || w.contains("Unusual connection: CvBipolar -> Trigger"),
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
            NodeKind::Mix,
            NodeKind::Filter,
            NodeKind::Fold,
            NodeKind::Delay,
            NodeKind::Chorus,
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
                for mk in [ModKind::None, ModKind::Lfo, ModKind::Env] {
                    ops.push(StructOp::SetMod {
                        key: key.clone(),
                        kind: mk,
                    });
                }
                ops.push(StructOp::SwapMix { key: key.clone() });
            }
            for op in ops {
                match mutate::apply_struct_op(&tree, &op) {
                    Ok(next) => {
                        assert!(
                            compile(&next, SR).is_ok(),
                            "sample {i}: op {op:?} produced uncompilable tree"
                        );
                        assert!(next.root.size() <= mutate::MAX_SIZE);
                        let back = PatchTree::from_trace(&next.to_trace()).unwrap();
                        assert_eq!(back, next, "trace roundtrip after {op:?}");
                        describe::describe(&next); // must not panic
                    }
                    Err(_) => {} // invalid ops are allowed to reject, never panic
                }
            }
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
}
