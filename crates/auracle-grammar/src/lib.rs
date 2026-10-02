//! # auracle-grammar
//!
//! The **patch prior**: a typed probabilistic context-free grammar (PCFG) over
//! quiver-backed synthesizer patch terms, plus the compiler from sampled terms
//! to playable quiver [`Patch`](quiver) graphs.
//!
//! Animated: [*The sound engine*](https://auracle.alexnodeland.com/docs/films.html#film-dsp) walks the patch graph, its modules
//! and their compilation; [*The math*](https://auracle.alexnodeland.com/docs/films.html#film-math) the prior as the search's target.
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
//! ## v1 constraints (the reference: *The genome*, *The vetting gate*)
//!
//! - Acyclic terms only — no feedback combinator productions. Modules with
//!   *internal* feedback (delay, chorus) are allowed.
//! - Curated palette: Vco, Supersaw, NoiseGenerator, Wavetable,
//!   KarplusStrong, FormantOsc, Svf, DiodeLadderFilter, ParametricEq,
//!   Wavefolder, Distortion, Bitcrusher, DelayLine, Chorus, Reverb, Phaser,
//!   Flanger, Tremolo, Vibrato, Granular, PitchShifter, RingModulator,
//!   Compressor, Ducker, NoiseGate, Vocoder, Adsr, Vca, Lfo, SampleAndHold,
//!   SlewLimiter, EnvelopeFollower, AudioInput — plus one module of this
//!   crate's own, [`steps::StepsCv`], a step sequencer whose every value is a
//!   port.
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
pub mod rng;
pub mod steps;
pub mod term;

pub use compile::{
    compile, compile_with_input, CompiledVoice, ParamHandle, ParamMap, COMPILE_MAX_NESTING,
    INPUT_GAIN_UNITY,
};
pub use describe::{describe, RackDescription};
pub use diff::{tree_diff, DiffEntry};
pub use edit::{set_param, EditError, ParamValue};
pub use genome::{clamp_param, in_domain, PARAM_DOMAIN, PARAM_MAX};
pub use mutate::{apply_struct_op, validate_tree, ModKind, NodeKind, StructError, StructOp};
pub use presets::{preset_bank, presets, Category, Preset, CATEGORIES};
pub use prior::PatchGrammarPrior;
pub use term::{AudioNode, InputChannel, ModNode, PatchTree, Uid, INPUT_SLOTS};

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

    /// Both samplers actually reach every modulation kind — `Steps` included —
    /// and every tree that contains one survives the codec both ways.
    ///
    /// The round-trip tests above run fifty draws each, and at a 3% prior
    /// weight per slot a fifty-draw window is not *guaranteed* to contain the
    /// newest leaf. This one keeps drawing until it has seen every kind, so the
    /// property is checked on the kind rather than hoped for.
    #[test]
    fn every_mod_kind_is_drawn_and_round_trips() {
        fn kinds(m: &ModNode, out: &mut std::collections::BTreeSet<&'static str>) {
            let k = match m {
                ModNode::None => return,
                ModNode::Lfo { .. } => "lfo",
                ModNode::Env { .. } => "env",
                ModNode::Rand { .. } => "rand",
                ModNode::Follow { .. } => "follow",
                ModNode::Euclid { .. } => "euclid",
                ModNode::Op { .. } => "op",
                ModNode::Pair { .. } => "pair",
                ModNode::Steps { .. } => "steps",
            };
            out.insert(k);
            for c in m.children() {
                kinds(c, out);
            }
        }
        fn walk(n: &term::AudioNode, out: &mut std::collections::BTreeSet<&'static str>) {
            if let Some(m) = n.modulation() {
                kinds(m, out);
            }
            for c in n.children() {
                walk(c, out);
            }
        }
        let prior = PatchGrammarPrior::default();
        let mut rng = StdRng::seed_from_u64(0x57E95);
        let mut seen_gen = std::collections::BTreeSet::new();
        let mut seen_plain = std::collections::BTreeSet::new();
        let mut steps_trees = 0;
        for _ in 0..600 {
            let (tree, gen_trace) = draw(&prior, &mut rng);
            let mut here = std::collections::BTreeSet::new();
            walk(&tree.root, &mut here);
            if here.contains("steps") {
                steps_trees += 1;
                let enc = tree.to_trace();
                assert_eq!(enc.choices.len(), gen_trace.choices.len());
                for (addr, choice) in &gen_trace.choices {
                    assert_eq!(enc.choices[addr].value, choice.value, "at {addr}");
                }
                assert_eq!(PatchTree::from_trace(&enc).unwrap(), tree);
                assert!(compile(&tree, SR).is_ok(), "{}", tree.to_sexpr());
            }
            seen_gen.extend(here);
            let plain = prior.sample_with_rng(&mut rng);
            walk(&plain.root, &mut seen_plain);
            assert_eq!(PatchTree::from_trace(&plain.to_trace()).unwrap(), plain);
        }
        let all: std::collections::BTreeSet<&str> = [
            "lfo", "env", "rand", "follow", "euclid", "op", "pair", "steps",
        ]
        .into();
        assert_eq!(seen_gen, all, "the generative prior never drew some kind");
        assert_eq!(seen_plain, all, "the plain sampler never drew some kind");
        assert!(
            steps_trees >= 3,
            "only {steps_trees} trees held a steps leaf"
        );
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

    /// The two categorical sites that reach the running voices without a
    /// recompile have a live handle on **every** module that advertises them.
    ///
    /// `oct` is live because it rides the pitch [`compile`]r's one `Offset`,
    /// and every pitched source goes through `wire_pitch` to get there. A
    /// future source that hand-wires its own pitch would still describe an
    /// `oct` chip and would silently be back to a full patch swap per click —
    /// which is invisible in a diff and audible as a dropout, so it is checked
    /// here rather than left to be noticed.
    ///
    /// Extended from the two categorical sites to every `mdepth` and to every
    /// knob of every **modulation** module. The gap that showed: a `Follow`
    /// under a source compiled to nothing, so the owner's `mdepth` and the
    /// follower's own knobs were on the faceplate with no handle behind them,
    /// and a drag on any of them fell back to a full patch swap. Not extended
    /// to every audio knob, because some are baked by design — a VCO's `det`
    /// is folded into the pitch `Offset` with the octave — and the remaining
    /// enums (`wave`, `fkind`, `color`, `dmode`) are documented as needing
    /// `set_patch`.
    #[test]
    fn every_advertised_live_site_has_a_live_handle() {
        use describe::KnobKind;
        let prior = PatchGrammarPrior::default();
        let mut rng = StdRng::seed_from_u64(0x1_11E);
        let mut seen = std::collections::BTreeSet::new();
        let mut missing = std::collections::BTreeSet::new();
        let mut trees: Vec<PatchTree> = (0..200).map(|_| prior.sample_with_rng(&mut rng)).collect();
        // The case the draw is unlikely to produce often enough: a follower,
        // and a shaped follower, directly on an oscillator's pitch slot.
        let follow = term::ModNode::Follow {
            uid: Uid::NEW,
            sens: 0.5,
            release: 0.4,
        };
        for m in [
            follow.clone(),
            term::ModNode::Op {
                uid: Uid::NEW,
                kind: term::ModOp::Slew,
                p0: 0.5,
                p1: 0.5,
                input: Box::new(follow),
            },
        ] {
            let mut t = presets::presets()[0].1.clone();
            t.root = term::AudioNode::Vco {
                uid: Uid::NEW,
                wave: term::Waveform::Saw,
                octave: 0,
                detune: 0.5,
                mod_depth: 0.5,
                modulation: m,
            };
            trees.push(t);
        }
        for tree in &trees {
            let rack = describe::describe(tree);
            let voice = compile(tree, SR).expect("compiles");
            for m in &rack.modules {
                // An empty slot's depth knob has nothing to attenuate and is
                // advertised as a knob for the slot to come; it is live once
                // the slot is filled, which the rack shows as a `<key>/m`
                // module.
                let slot_filled = rack.modules.iter().any(|o| o.key == format!("{}/m", m.key));
                for knob in &m.knobs {
                    let site = knob.addr.rsplit('#').next().unwrap_or("");
                    // The three selector knobs (`qroot`, `qscale`, `rmode`)
                    // choose a scale or a mode *inside* a module and are baked
                    // at compile, like the audio enums.
                    let selector = matches!(site, "qroot" | "qscale" | "rmode");
                    let live = (site == "mdepth" && slot_filled)
                        || (m.is_mod && matches!(knob.kind, KnobKind::Continuous) && !selector)
                        || site == "table"
                        || site == "oct";
                    if !live {
                        continue;
                    }
                    seen.insert(site.to_string());
                    if !voice.params.contains_key(&knob.addr) {
                        missing.insert(format!("{} {site}", m.kind));
                    }
                }
            }
        }
        assert!(
            missing.is_empty(),
            "advertised with no live handle (a click is a full patch swap): {missing:?}"
        );
        for want in ["oct", "table", "mdepth", "sens", "rel", "rate"] {
            assert!(
                seen.contains(want),
                "the sweep never met a `{want}` knob, so it proved nothing about it"
            );
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
            // A step lane names knobs that exist, all continuous, and the
            // count of them that play is the decoded `length`.
            for m in &rack.modules {
                let Some(lane) = &m.lane else { continue };
                assert_eq!(m.kind, "steps", "a lane on a {} module", m.kind);
                assert_eq!(lane.count, steps::STEP_SLOTS);
                assert!(lane.first + lane.count <= m.knobs.len());
                assert!((steps::MIN_STEPS..=lane.count).contains(&lane.active));
                for k in &m.knobs[lane.first..lane.first + lane.count] {
                    assert_eq!(k.kind, describe::KnobKind::Continuous, "{}", k.addr);
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

    /// The audio node at a rack key (`node`, `node/0/1`). `children()` is in
    /// key order, so this is the node `describe` names at that key.
    fn node_at<'a>(root: &'a term::AudioNode, key: &str) -> Option<&'a term::AudioNode> {
        let mut cur = root;
        for seg in key.strip_prefix("node")?.split('/').skip(1) {
            cur = *cur.children().get(seg.parse::<usize>().ok()?)?;
        }
        Some(cur)
    }

    /// `tree` with the module at `key` lifted out and its `/0` spliced up in
    /// its place: the inverse of an insert there.
    fn lift(tree: &PatchTree, key: &str) -> PatchTree {
        let mut out = tree.clone();
        let mut cur = &mut out.root;
        for seg in key
            .strip_prefix("node")
            .expect("a node key")
            .split('/')
            .skip(1)
        {
            let i: usize = seg.parse().expect("a child index");
            cur = cur
                .children_mut()
                .into_iter()
                .nth(i)
                .expect("a child there");
        }
        *cur = cur.children()[0].clone();
        out
    }

    /// The module at `key`, with its `/0` unplugged: what an edit placed
    /// there, apart from the chain it seated. Its knobs and its own `/1` are
    /// what a placement brings, so this is the part to compare with the
    /// kind's default module.
    fn placed_at(tree: &PatchTree, key: &str) -> term::AudioNode {
        let mut m = node_at(&tree.root, key).expect("a module there").clone();
        *m.children_mut().into_iter().next().expect("a /0") =
            term::AudioNode::Silence { uid: Uid::NEW };
        m
    }

    /// Every module identity in a subtree, audio and modulation, in walk
    /// order, as numbers: `Uid`'s own equality is blind on purpose.
    fn identities(n: &term::AudioNode, out: &mut Vec<u64>) {
        fn of_mod(m: &ModNode, out: &mut Vec<u64>) {
            if let Some(u) = m.uid() {
                out.push(u.0);
            }
            for c in m.children() {
                of_mod(c, out);
            }
        }
        out.push(n.uid().0);
        if let Some(m) = n.modulation() {
            of_mod(m, out);
        }
        for c in n.children() {
            identities(c, out);
        }
    }

    /// Every preset compiles, and structural edits (replace / insert /
    /// delete / set-mod / swap) always yield compilable, describable,
    /// trace-roundtrippable trees — hand rewiring cannot leave the grammar.
    ///
    /// And a splice loses nothing it was not asked to remove. An `Insert`
    /// seats the whole subtree it lands on as the new module's `/0` and
    /// moves nothing else; a processor `Replace` keeps the replaced node's
    /// primary input there (the node itself, when it was a source). A
    /// vocoder used to be built with a fresh carrier of its own, so both
    /// edits threw away the chain they landed on. Apart from that `/0`, the
    /// module placed is the kind's default one, its knobs and its own `/1`
    /// included, so a splice that took the chain for a sidechain would fail
    /// here too.
    #[test]
    fn presets_and_struct_ops_stay_in_grammar() {
        use mutate::{ModKind, NodeKind, StructOp};
        for (name, tree) in presets::presets() {
            assert!(compile(&tree, SR).is_ok(), "preset {name} fails to compile");
            assert!(!tree.signature().is_empty());
        }
        let prior = PatchGrammarPrior::default();
        let mut rng = StdRng::seed_from_u64(21);
        // Every kind a hand can place. The four sidechain binaries are the
        // point: every structural op has to survive a node with two audio
        // subtrees *and* a modulation slot, which nothing but mix and ring mod
        // ever had. So is the unplug: every node replaced by a hole must still
        // compile, describe and round-trip, wherever the hole lands. This was
        // a hand-kept list, and it had fallen seven kinds behind the palette.
        let kinds = NodeKind::ALL;
        let mut inserts = 0usize;
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
                // The whole modulation vocabulary: the sources replace the
                // slot, the shapers wrap whatever the draw put there — which
                // is how a `Steps` ends up under a quantizer or inside a pair
                // here without anyone writing that case down.
                for mk in [
                    ModKind::None,
                    ModKind::Lfo,
                    ModKind::Env,
                    ModKind::Rand,
                    ModKind::Follow,
                    ModKind::Euclid,
                    ModKind::Steps,
                    ModKind::Quantize,
                    ModKind::Slew,
                    ModKind::Rectify,
                    ModKind::Hold,
                    ModKind::Min,
                    ModKind::Max,
                    ModKind::And,
                    ModKind::Or,
                    ModKind::Xor,
                    ModKind::Switch,
                ] {
                    ops.push(StructOp::SetMod {
                        key: key.clone(),
                        kind: mk,
                    });
                }
                ops.push(StructOp::SwapMix { key: key.clone() });
            }
            for op in ops {
                // Invalid ops may refuse, but never panic, and never by losing
                // a key `describe` has just named: that refusal would let the
                // checks below skip an op silently.
                let next = match mutate::apply_struct_op(&tree, &op) {
                    Ok(next) => next,
                    Err(StructError::NoSuchNode(k)) => {
                        panic!("sample {i}: {op:?} found no node at {k}, a key describe named")
                    }
                    Err(_) => continue,
                };
                assert!(
                    compile(&next, SR).is_ok(),
                    "sample {i}: op {op:?} produced uncompilable tree"
                );
                assert!(next.root.size() <= mutate::MAX_SIZE);
                let back = PatchTree::from_trace(&next.to_trace()).unwrap();
                assert_eq!(back, next, "trace roundtrip after {op:?}");
                describe::describe(&next); // must not panic
                match &op {
                    StructOp::Insert { key, kind } => {
                        assert_eq!(
                            node_at(&next.root, &format!("{key}/0")),
                            node_at(&tree.root, key),
                            "sample {i}: {op:?} dropped the chain it landed on"
                        );
                        assert_eq!(
                            lift(&next, key),
                            tree,
                            "sample {i}: {op:?} changed more than its own module"
                        );
                        assert_eq!(
                            placed_at(&next, key),
                            mutate::default_fragment(*kind),
                            "sample {i}: {op:?} did not place the kind's own module"
                        );
                        inserts += 1;
                    }
                    StructOp::Replace { key, kind } if !kind.is_source() => {
                        let old = node_at(&tree.root, key).expect("the replaced node");
                        let chain = old.children().first().copied().unwrap_or(old);
                        assert_eq!(
                            node_at(&next.root, &format!("{key}/0")),
                            Some(chain),
                            "sample {i}: {op:?} dropped the input it should keep"
                        );
                        assert_eq!(
                            placed_at(&next, key),
                            mutate::default_fragment(*kind),
                            "sample {i}: {op:?} did not place the kind's own module"
                        );
                    }
                    _ => {}
                }
            }
        }
        assert!(inserts > 500, "the gate checked only {inserts} inserts");
    }

    /// **An insert keeps every module of the chain it lands on**, by
    /// identity: every kind a hand can insert, at every key of every preset.
    ///
    /// Identity rather than content, because a lock, a hand position and a
    /// selection all ride on a module staying the module it was. The chain
    /// arrives at `{key}/0` module for module, and nothing anywhere in the
    /// patch loses its identity.
    #[test]
    fn an_insert_keeps_every_module_of_the_chain_it_lands_on() {
        use mutate::{NodeKind, StructOp};
        let processors: Vec<NodeKind> = NodeKind::ALL
            .into_iter()
            .filter(|k| !k.is_source())
            .collect();
        // The largest chain each kind was inserted onto.
        let mut largest = vec![0usize; processors.len()];
        for (name, mut tree) in presets::presets() {
            tree.ensure_uids();
            let mut before = Vec::new();
            identities(&tree.root, &mut before);
            let keys: Vec<String> = describe::describe(&tree)
                .modules
                .iter()
                .filter(|m| m.key != "amp" && !m.is_mod)
                .map(|m| m.key.clone())
                .collect();
            for key in &keys {
                let chain = node_at(&tree.root, key).expect("a module at its own key");
                let mut want = Vec::new();
                identities(chain, &mut want);
                for (k, &kind) in processors.iter().enumerate() {
                    let op = StructOp::Insert {
                        key: key.clone(),
                        kind,
                    };
                    // The ceilings may refuse an insert; nothing else may.
                    let next = match mutate::apply_struct_op(&tree, &op) {
                        Ok(next) => next,
                        Err(StructError::TooBig(..)) => continue,
                        Err(e) => panic!("{name}: {op:?} refused: {e}"),
                    };
                    let mut after = Vec::new();
                    identities(&next.root, &mut after);
                    let lost = before.iter().filter(|u| !after.contains(u)).count();
                    assert_eq!(lost, 0, "{name}: {op:?} lost {lost} modules");
                    let below = node_at(&next.root, &format!("{key}/0")).expect("a /0");
                    let mut seated = Vec::new();
                    identities(below, &mut seated);
                    assert_eq!(
                        seated, want,
                        "{name}: {op:?} did not seat the chain at {key}/0"
                    );
                    assert_eq!(below, chain, "{name}: {op:?} changed the chain");
                    largest[k] = largest[k].max(chain.size());
                }
            }
        }
        // Not vacuous: every kind landed on a real chain somewhere.
        for (kind, n) in processors.iter().zip(&largest) {
            assert!(*n >= 4, "{kind:?} never landed on a chain of 4+ modules");
        }
    }

    /// **A vocoder placed on a chain speaks through it.** The chain is its
    /// carrier, the branch whose waveform reaches the output, and the vocoder
    /// brings a formant voice as its modulator.
    ///
    /// `Insert` and `Replace` built the vocoder with a supersaw carrier of its
    /// own and dropped the chain they were handed: on First Bass the ladder
    /// and its saw were thrown away, and the patch became a stock vocoder.
    /// `InsertTree`, which the app sends to place a module into a wire,
    /// always seated the chain as the carrier. The two now place the same
    /// patch.
    #[test]
    fn a_vocoder_placed_on_a_chain_keeps_it_as_its_carrier() {
        use mutate::{NodeKind, StructOp};
        let (_, seed) = presets::presets()
            .into_iter()
            .find(|(n, _)| *n == "First Bass")
            .expect("First Bass is in the library");
        let insert = |t: &PatchTree, key: &str| {
            mutate::apply_struct_op(
                t,
                &StructOp::Insert {
                    key: key.into(),
                    kind: NodeKind::Vocoder,
                },
            )
            .expect("a vocoder inserts")
        };

        let placed = insert(&seed, "node");
        let term::AudioNode::Vocoder {
            carrier, modulator, ..
        } = &placed.root
        else {
            panic!("no vocoder at the output: {}", placed.to_sexpr());
        };
        assert_eq!(
            **carrier,
            seed.root,
            "the ladder and its saw are the carrier: {}",
            placed.to_sexpr()
        );
        assert!(
            matches!(**modulator, term::AudioNode::Formant { .. }),
            "the voice is a formant oscillator: {}",
            placed.to_sexpr()
        );

        // The same module as a fragment, the way the app places one.
        let grafted = mutate::apply_struct_op(
            &seed,
            &StructOp::InsertTree {
                key: "node".into(),
                node: placed.root.clone(),
            },
        )
        .expect("the fragment grafts");
        assert_eq!(
            grafted, placed,
            "Insert and InsertTree place the same patch"
        );

        // A replace keeps the replaced module's input: the ladder goes, and
        // its saw is the carrier.
        let swapped = mutate::apply_struct_op(
            &seed,
            &StructOp::Replace {
                key: "node".into(),
                kind: NodeKind::Vocoder,
            },
        )
        .expect("a vocoder replaces the ladder");
        let term::AudioNode::Vocoder { carrier, .. } = &swapped.root else {
            panic!("no vocoder at the output: {}", swapped.to_sexpr());
        };
        assert_eq!(
            **carrier,
            *seed.root.children()[0],
            "the saw is the carrier"
        );

        // Over an empty socket a vocoder has nothing to speak through, like
        // every processor. It used to bring a supersaw of its own and sound.
        let unplugged = mutate::apply_struct_op(
            &seed,
            &StructOp::Replace {
                key: "node/0".into(),
                kind: NodeKind::Silence,
            },
        )
        .expect("the saw unplugs");
        let quiet = held_peak_dbfs(&insert(&unplugged, "node/0"));
        assert!(
            quiet < -90.0,
            "a vocoder over an empty socket plays at {quiet:.1} dBFS"
        );
    }

    /// The loudest sample of `tree` over half a second of a held C4.
    fn held_peak_dbfs(tree: &PatchTree) -> f64 {
        let mut v = compile(tree, SR).expect("compiles");
        v.pitch.set(0.0);
        v.gate.set(5.0);
        let mut peak = 0.0f64;
        for _ in 0..(SR as usize / 2) {
            let (l, r) = v.patch.tick();
            peak = peak.max(l.abs()).max(r.abs());
        }
        if peak > 0.0 {
            20.0 * peak.log10()
        } else {
            f64::NEG_INFINITY
        }
    }

    /// An unplugged socket is silent, and plugging a source back in sounds.
    ///
    /// The app used to unplug a socket by standing a saw VCO in it and drawing
    /// an EMPTY plate over the top: the plate said nothing was there while a
    /// saw played under a held chord, and the model scored the saw. The socket
    /// holds `Silence` now, reached through the edit vocabulary as
    /// [`NodeKind::Silence`], so this pins the three things that make that
    /// true: the unplugged patch renders nothing, a refill with a source is
    /// heard again, and both survive the JSON the app posts and reads back —
    /// including the bare `{"Silence":{}}` it writes for a hole it just made.
    #[test]
    fn an_unplugged_socket_is_silent_and_filling_it_sounds() {
        use mutate::{NodeKind, StructOp};
        // First Bass: a ladder over one saw, so the saw's socket is the only
        // thing the patch can hear.
        let (_, seed) = presets::presets()
            .into_iter()
            .find(|(n, _)| *n == "First Bass")
            .expect("First Bass is in the library");
        assert!(
            held_peak_dbfs(&seed) > -40.0,
            "the preset itself must sound"
        );

        let unplugged = mutate::apply_struct_op(
            &seed,
            &StructOp::Replace {
                key: "node/0".into(),
                kind: NodeKind::Silence,
            },
        )
        .expect("a source can be replaced by a hole");
        assert!(
            matches!(
                &unplugged.root,
                term::AudioNode::Filter { input, .. }
                    if matches!(**input, term::AudioNode::Silence { .. })
            ),
            "the filter's input is the hole: {}",
            unplugged.to_sexpr()
        );
        let quiet = held_peak_dbfs(&unplugged);
        assert!(
            quiet < -90.0,
            "an unplugged socket plays at {quiet:.1} dBFS"
        );
        // The rack names it as a hole, so the plate and the patch agree.
        let rack = describe::describe(&unplugged);
        let hole = rack
            .modules
            .iter()
            .find(|m| m.key == "node/0")
            .expect("a module at node/0");
        assert_eq!(hole.kind, "silence");

        // The form the app writes for a hole it has just made: no uid yet.
        let json = serde_json::to_string(&unplugged).expect("serializes");
        let bare = json.replacen(
            &serde_json::to_string(&unplugged.root.children()[0]).unwrap(),
            r#"{"Silence":{}}"#,
            1,
        );
        assert!(
            bare != json && bare.contains(r#"{"Silence":{}}"#),
            "the hole was not found in its own tree's JSON: {json}"
        );
        let back: PatchTree = serde_json::from_str(&bare).expect("a bare hole parses");
        assert_eq!(back, unplugged, "JSON round trip of the unplugged tree");
        assert!(held_peak_dbfs(&back) < -90.0);

        // Filling the hole with a source sounds again, and round-trips.
        let filled = mutate::apply_struct_op(
            &back,
            &StructOp::Replace {
                key: "node/0".into(),
                kind: NodeKind::Vco,
            },
        )
        .expect("a hole can be refilled");
        let loud = held_peak_dbfs(&filled);
        assert!(loud > -40.0, "the refilled socket plays at {loud:.1} dBFS");
        let json = serde_json::to_string(&filled).unwrap();
        let again: PatchTree = serde_json::from_str(&json).unwrap();
        assert_eq!(again, filled);
        assert_eq!(
            serde_json::to_string(&again).unwrap(),
            json,
            "one text for one tree"
        );

        // A hole beside a live branch mutes only its side of the mix.
        let mix = mutate::apply_struct_op(
            &seed,
            &StructOp::Insert {
                key: "node/0".into(),
                kind: NodeKind::Mix,
            },
        )
        .expect("a mix over the saw");
        let one_side = mutate::apply_struct_op(
            &mix,
            &StructOp::Replace {
                key: "node/0/1".into(),
                kind: NodeKind::Silence,
            },
        )
        .expect("one side of the mix unplugged");
        assert!(
            held_peak_dbfs(&one_side) > -40.0,
            "the other side still plays"
        );
        // A hole cannot be spliced into a wire: it is a source.
        assert!(mutate::apply_struct_op(
            &seed,
            &StructOp::Insert {
                key: "node/0".into(),
                kind: NodeKind::Silence,
            },
        )
        .is_err());
    }

    /// **`NodeKind::ALL` names every kind once, in declaration order.**
    ///
    /// `ALL` is what the edit gate sweeps, so a kind missing from it is a kind
    /// no gate ever places. The compile-time check beside `ALL` sees every kind
    /// declared before its last entry; this sees the rest. serde's derive
    /// refuses an unknown name by listing every variant it knows, in
    /// declaration order, so that list is the enum read without a second copy
    /// to keep.
    #[test]
    fn node_kind_all_names_every_kind() {
        use mutate::NodeKind;
        let refusal = serde_json::from_str::<NodeKind>("\"no such kind\"")
            .expect_err("an unknown name is refused")
            .to_string();
        let (_, listed) = refusal
            .split_once("expected one of")
            .unwrap_or_else(|| panic!("serde's refusal changed its wording: {refusal}"));
        let declared: Vec<&str> = listed.split('`').skip(1).step_by(2).collect();
        let all: Vec<String> = NodeKind::ALL
            .iter()
            .map(|k| {
                serde_json::to_string(k)
                    .unwrap()
                    .trim_matches('"')
                    .to_string()
            })
            .collect();
        assert_eq!(
            all, declared,
            "NodeKind::ALL is not every kind, once, in order"
        );
    }

    /// `NodeKind::Silence` is spelled `silence` on the wire, which is also
    /// the `kind` the rack reports for a hole.
    #[test]
    fn the_silence_kind_round_trips_as_silence() {
        use mutate::NodeKind;
        let s = serde_json::to_string(&NodeKind::Silence).unwrap();
        assert_eq!(s, "\"silence\"");
        let back: NodeKind = serde_json::from_str(&s).unwrap();
        assert_eq!(back, NodeKind::Silence);
        assert!(NodeKind::Silence.is_source());
        assert!(NodeKind::ALL.contains(&NodeKind::Silence));
    }

    /// The log-prior of `tree` under `prior`, scored the way the engine scores
    /// a seed: replay the generative program against the term's own trace.
    fn log_prior(prior: &PatchGrammarPrior, tree: &PatchTree) -> f64 {
        let (_, scored) = run(
            ScoreGivenTrace {
                base: tree.to_trace(),
                trace: Trace::default(),
            },
            prior.model(),
        );
        scored.log_prior
    }

    /// **The finite-prior gate.** Every term a hand can reach — every shipped
    /// preset, every `default_fragment` the palette places, every result of every
    /// structural op over a sweep of prior draws, and every knob at either end
    /// of its range — must have a finite log-prior under the default grammar.
    ///
    /// The engine's refinement path is `EvolutionChain::init_from(seed)`, and
    /// fugue returns `None` for a seed whose total log-weight is not finite.
    /// So `log p = −∞` is not a low score: it is ⚡ evolve doing nothing. Two
    /// ways to get there were shipping when this test was written — a knob at
    /// exactly `1.0` (the closed domain against fugue's half-open `Uniform`),
    /// and a hand edit past the prior's `max_depth` (a ceiling of 9 against
    /// support that ends at 6) — and neither had a test because nothing scored
    /// what the panel produced. This does.
    #[test]
    fn everything_a_hand_can_reach_has_finite_prior() {
        use mutate::{ModKind, NodeKind, StructOp};
        // With AUDIO IN on. Nothing else's mass depends on its weight, so for
        // every other kind this is the default grammar; and AUDIO IN is the
        // term the default turns on (`AUDIO_IN_WEIGHT`, Plan-007 task 4).
        // Until then a placed one scores −∞ under the default, which
        // `audio_in_is_rare_and_the_prior_never_picks_an_input` pins.
        let prior = PatchGrammarPrior::default().with_audio_in();
        let finite = |what: &str, t: &PatchTree| {
            let lp = log_prior(&prior, t);
            assert!(lp.is_finite(), "{what}: log-prior is {lp}");
        };

        for (name, tree) in presets::presets() {
            finite(&format!("preset {name}"), &tree);
        }

        // Every default node, as a source and as an insert over a source.
        let base = presets::presets()[0].1.clone();
        for kind in NodeKind::ALL {
            let op = StructOp::Replace {
                key: "node".into(),
                kind,
            };
            let t = mutate::apply_struct_op(&base, &op).expect("replace root is always legal");
            finite(&format!("default_fragment({kind:?}) as root"), &t);
            if !kind.is_source() {
                let op = StructOp::Insert {
                    key: "node".into(),
                    kind,
                };
                let t = mutate::apply_struct_op(&base, &op).expect("insert over a preset root");
                finite(&format!("default_fragment({kind:?}) inserted"), &t);
            }
        }
        // Every modulation choice, set on the root and then wrapped again, so
        // the shapers meet an occupied slot as well as an empty one.
        for mk in ModKind::ALL {
            let op = StructOp::SetMod {
                key: "node".into(),
                kind: mk,
            };
            if let Ok(t) = mutate::apply_struct_op(&base, &op) {
                finite(&format!("SetMod({mk:?}) on a preset root"), &t);
                if let Ok(t2) = mutate::apply_struct_op(&t, &op) {
                    finite(&format!("SetMod({mk:?}) twice"), &t2);
                }
            }
        }

        // A knob at both ends of its range — the stop is where the panel puts
        // a dragged knob, and the stop used to be `1.0`.
        for (addr, v) in [
            ("amp#attack", 1.0),
            ("amp#sustain", 1e30),
            ("node#cut", 0.0),
        ] {
            let t = set_param(&base, addr, ParamValue::Continuous(v))
                .or_else(|_| set_param(&base, "amp#release", ParamValue::Continuous(v)))
                .expect("a knob edit");
            finite(&format!("knob {addr} = {v}"), &t);
        }

        // The whole op vocabulary over prior draws. Whatever `apply_struct_op`
        // accepts, the prior must be able to score — that is what the ceilings
        // are *for* now.
        let mut rng = StdRng::seed_from_u64(20_260_905);
        let mut applied = 0usize;
        for i in 0..24 {
            let (tree, _) = draw(&prior, &mut rng);
            let keys: Vec<String> = describe::describe(&tree)
                .modules
                .iter()
                .filter(|m| m.key != "amp" && !m.is_mod)
                .map(|m| m.key.clone())
                .collect();
            for key in &keys {
                let mut ops: Vec<StructOp> = vec![
                    StructOp::Delete { key: key.clone() },
                    StructOp::SwapMix { key: key.clone() },
                ];
                for kind in NodeKind::ALL {
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
                for mk in ModKind::ALL {
                    ops.push(StructOp::SetMod {
                        key: key.clone(),
                        kind: mk,
                    });
                }
                for op in ops {
                    if let Ok(next) = mutate::apply_struct_op(&tree, &op) {
                        applied += 1;
                        finite(&format!("draw {i}: {op:?}"), &next);
                    }
                }
            }
        }
        assert!(applied > 1000, "the sweep applied only {applied} ops");
    }

    /// A term far past every ceiling is an *error* from `compile`, not a stack
    /// overflow. `import_patch` and the session file are parsed straight into
    /// a `PatchTree`, and the compiler recurses by value with frames large
    /// enough that ~60 nested nodes overflow the wasm stack — a trap that
    /// poisons the engine rather than an error anyone sees. The guard has to
    /// live in `compile` itself so no caller can route around it.
    #[test]
    fn compile_refuses_a_term_nested_past_the_stack_guard() {
        let mut tree = presets::presets()[0].1.clone();
        while tree.root.depth() <= compile::COMPILE_MAX_NESTING {
            tree.root = default_filter_over(tree.root);
        }
        let err = match compile(&tree, SR) {
            Err(e) => e,
            Ok(_) => panic!("a 33-deep term must be refused"),
        };
        assert!(err.to_string().contains("nests"), "{err}");
        // And the guard counts modulation nesting on top of audio depth: a
        // legal audio tree with a legal mod chain is still fine.
        let ok = presets::presets()[0].1.clone();
        assert!(compile(&ok, SR).is_ok());
    }

    /// The depth boundary, from both sides: the deepest tree the ceilings admit
    /// scores finite, and the first one they refuse is the first one the prior
    /// cannot score. If either half fails, `MAX_DEPTH`/`MAX_MOD_DEPTH` and the
    /// prior's support have drifted apart again.
    #[test]
    fn ceilings_end_exactly_where_the_prior_support_does() {
        let prior = PatchGrammarPrior::default();
        let mut tree = presets::presets()[0].1.clone();
        tree.root = term::AudioNode::Vco {
            uid: Uid::NEW,
            wave: term::Waveform::Saw,
            octave: 0,
            detune: 0.5,
            mod_depth: 0.3,
            modulation: term::ModNode::None,
        };
        while tree.root.depth() < mutate::MAX_DEPTH {
            tree.root = default_filter_over(tree.root);
        }
        assert_eq!(tree.root.depth(), mutate::MAX_DEPTH);
        assert!(validate_tree(&tree).is_ok());
        assert!(
            log_prior(&prior, &tree).is_finite(),
            "the deepest legal tree must score"
        );
        tree.root = default_filter_over(tree.root);
        assert!(validate_tree(&tree).is_err());
        assert_eq!(log_prior(&prior, &tree), f64::NEG_INFINITY);

        // The same for a modulation chain: `Op` wrapping `Op` wrapping a leaf.
        let mut m = term::ModNode::Lfo {
            uid: Uid::NEW,
            wave: term::Waveform::Sine,
            rate: 0.5,
        };
        let wrap = |inner: term::ModNode| term::ModNode::Op {
            uid: Uid::NEW,
            kind: term::ModOp::Slew,
            p0: 0.5,
            p1: 0.0,
            input: Box::new(inner),
        };
        while m.depth() < mutate::MAX_MOD_DEPTH {
            m = wrap(m);
        }
        let mut shaped = presets::presets()[0].1.clone();
        let op = mutate::StructOp::SetModTree {
            key: "node".into(),
            m: m.clone(),
        };
        let shaped_ok = mutate::apply_struct_op(&shaped, &op).expect("at the ceiling");
        assert!(log_prior(&prior, &shaped_ok).is_finite());
        let over = mutate::StructOp::SetModTree {
            key: "node".into(),
            m: wrap(m),
        };
        assert!(mutate::apply_struct_op(&shaped, &over).is_err());
        shaped.root = shaped_ok.root;
        assert!(validate_tree(&shaped).is_ok());
    }

    /// The plain-RNG sampler and the fugue program are documented as drawing
    /// from the same grammar. Held to it by frequency: over a few thousand
    /// trees from each, every module kind the rack can show appears at a rate
    /// the other sampler agrees with, and `silence` — which the RNG path
    /// could never draw at all, its arm having been written before the hole
    /// joined the palette — appears in both.
    #[test]
    fn the_two_samplers_agree_on_kind_frequencies() {
        use std::collections::BTreeMap;
        // With AUDIO IN on, so both samplers have every kind to agree on; the
        // default differs only in drawing none.
        let prior = PatchGrammarPrior::default().with_audio_in();
        let n = 3000;
        let count = |trees: &[PatchTree]| -> (BTreeMap<String, f64>, f64) {
            let mut c: BTreeMap<String, f64> = BTreeMap::new();
            let mut total = 0.0;
            for t in trees {
                for m in describe::describe(t).modules {
                    if m.key == "amp" {
                        continue;
                    }
                    *c.entry(m.kind).or_insert(0.0) += 1.0;
                    total += 1.0;
                }
            }
            (c, total)
        };
        let mut rng = StdRng::seed_from_u64(0x5A11);
        let by_rng: Vec<PatchTree> = (0..n).map(|_| prior.sample_with_rng(&mut rng)).collect();
        let mut rng = StdRng::seed_from_u64(0x5A12);
        let by_model: Vec<PatchTree> = (0..n).map(|_| draw(&prior, &mut rng).0).collect();
        let (a, ta) = count(&by_rng);
        let (b, tb) = count(&by_model);
        assert!(
            a.get("silence").copied().unwrap_or(0.0) > 0.0,
            "the RNG path never drew a hole"
        );
        assert!(
            b.get("silence").copied().unwrap_or(0.0) > 0.0,
            "the program never drew a hole"
        );
        // The input is as rare as the hole, and both samplers reach it.
        for (side, counts) in [("RNG path", &a), ("program", &b)] {
            assert!(
                counts.get("audio_in").copied().unwrap_or(0.0) > 0.0,
                "the {side} never drew an audio in"
            );
        }
        let kinds: std::collections::BTreeSet<&String> = a.keys().chain(b.keys()).collect();
        for k in kinds {
            let fa = a.get(k).copied().unwrap_or(0.0) / ta;
            let fb = b.get(k).copied().unwrap_or(0.0) / tb;
            // ~12 000 modules a side: the standard error of a frequency is
            // ≲ 0.005, so 0.02 is a four-sigma band on the busiest kind.
            assert!(
                (fa - fb).abs() < 0.02,
                "{k}: rng sampler {fa:.4} vs program {fb:.4} — the samplers disagree"
            );
        }
    }

    /// `ReplaceTree`/`InsertTree` normalise the modulation slots of the
    /// fragment they graft, as `SetModTree` always did for its one term. A
    /// processor over nothing encodes `#mod = 0` where the prior's weight is
    /// zero (`log p = −∞`, the un-evolvable state again), and a one-parameter
    /// `Op` carrying a stray `p1` would not survive its own trace round trip —
    /// which is the equality refinement uses to ask whether it moved.
    #[test]
    fn grafted_fragments_have_their_mod_slots_normalised() {
        use mutate::StructOp;
        let prior = PatchGrammarPrior::default();
        let base = presets::presets()[0].1.clone();
        let dead_op = term::ModNode::Op {
            uid: Uid::NEW,
            kind: term::ModOp::Quantize,
            p0: 0.5,
            p1: 0.5,
            input: Box::new(term::ModNode::None),
        };
        let stray_p1 = term::ModNode::Op {
            uid: Uid::NEW,
            kind: term::ModOp::Rectify,
            p0: 0.4,
            p1: 0.7, // not a site for a one-parameter op
            input: Box::new(term::ModNode::Lfo {
                uid: Uid::NEW,
                wave: term::Waveform::Sine,
                rate: 0.3,
            }),
        };
        let filter = |m: term::ModNode, inner: term::AudioNode| term::AudioNode::Filter {
            uid: Uid::NEW,
            kind: term::FilterKind::SvfLp,
            cutoff: 0.5,
            resonance: 0.2,
            mod_depth: 0.5,
            input: Box::new(inner),
            modulation: m,
        };
        let vco = term::AudioNode::Vco {
            uid: Uid::NEW,
            wave: term::Waveform::Saw,
            octave: 0,
            detune: 0.5,
            mod_depth: 0.3,
            modulation: term::ModNode::None,
        };

        let replaced = mutate::apply_struct_op(
            &base,
            &StructOp::ReplaceTree {
                key: "node".into(),
                node: filter(dead_op, vco.clone()),
            },
        )
        .expect("a legal graft");
        assert_eq!(
            replaced.root.modulation(),
            Some(&term::ModNode::None),
            "an Op over nothing must fold to an empty slot"
        );
        assert!(log_prior(&prior, &replaced).is_finite());

        let inserted = mutate::apply_struct_op(
            &base,
            &StructOp::InsertTree {
                key: "node".into(),
                node: filter(stray_p1, vco),
            },
        )
        .expect("a legal graft");
        let Some(term::ModNode::Op { p1, .. }) = inserted.root.modulation() else {
            panic!(
                "the shaped modulator should have survived: {}",
                inserted.root.to_sexpr()
            );
        };
        assert_eq!(*p1, 0.0, "a one-parameter op's p1 must be pinned to 0");
        let back = PatchTree::from_trace(&inserted.to_trace()).unwrap();
        assert_eq!(
            back, inserted,
            "the grafted tree must survive its own round trip"
        );
        assert!(log_prior(&prior, &inserted).is_finite());
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
        // itself is pinned in `auracle_features::cache`, where the key lives.
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

    /// **R6, the other half.** Turning a knob must not rename the patch.
    ///
    /// `set_param` edits the *trace* and decodes it back, which is the same
    /// anonymising round trip refinement takes — and it is on the hottest path
    /// in the app. It went unnoticed because nothing in the engine reads a uid:
    /// the loss only shows in the panel, where after one knob turn every lock
    /// id collapses onto `0#site`, the motion system sees the whole rack
    /// arrive at once, and every hand-placed position is orphaned. Measured in
    /// the browser, not deduced from the code, which is why the assertion is
    /// on `describe` — what the panel actually reads.
    #[test]
    fn identity_survives_a_knob_turn() {
        let mut tree = presets::presets()[2].1.clone();
        tree.ensure_uids();
        let before = describe::describe(&tree);
        // A continuous site somewhere below the root, so this is not just a
        // statement about the amp.
        let addr = before
            .modules
            .iter()
            .filter(|m| m.key != "amp")
            .find_map(|m| {
                m.knobs
                    .iter()
                    .find(|k| k.kind == describe::KnobKind::Continuous)
                    .map(|k| k.addr.clone())
            })
            .expect("a preset with a knob on it");
        let edited = set_param(&tree, &addr, ParamValue::Continuous(0.375)).expect("a plain knob");
        let after = describe::describe(&edited);
        assert_eq!(before.modules.len(), after.modules.len());
        for (x, y) in before.modules.iter().zip(&after.modules) {
            assert_eq!(x.key, y.key);
            assert_eq!(x.uid, y.uid, "a knob turn renamed {}", x.key);
        }
        // …and the edit itself still happened.
        let value_at = |t: &PatchTree| {
            t.to_trace()
                .choices
                .iter()
                .find(|(k, _)| &***k == addr.as_str())
                .map(|(_, c)| c.value.clone())
        };
        assert_ne!(value_at(&edited), value_at(&tree));
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

    // ---- AUDIO IN (ADR-015, Plan-007 task 2) ----

    fn listening(input: u8, channel: term::InputChannel) -> PatchTree {
        let mut t = presets::presets()[0].1.clone();
        t.amp = term::AmpEnv {
            attack: 0.0,
            decay: 0.3,
            sustain: PARAM_MAX,
            release: 0.2,
        };
        t.root = term::AudioNode::Filter {
            uid: Uid::NEW,
            kind: term::FilterKind::SvfLp,
            cutoff: 0.9,
            resonance: 0.1,
            mod_depth: 0.0,
            input: Box::new(term::AudioNode::AudioIn {
                uid: Uid::NEW,
                input,
                gain: INPUT_GAIN_UNITY,
                channel,
            }),
            modulation: term::ModNode::None,
        };
        t
    }

    /// The rack draws an AUDIO IN as its own plate: kind `audio_in` (the
    /// `NodeKind` spelling), title "audio in", and three knobs whose
    /// addresses are trace sites a knob edit can write.
    #[test]
    fn audio_in_is_a_plate_with_three_knobs() {
        use describe::KnobKind;
        let tree = listening(2, term::InputChannel::Right);
        let rack = describe::describe(&tree);
        let m = rack
            .modules
            .iter()
            .find(|m| m.key == "node/0")
            .expect("the input's plate");
        assert_eq!(
            (m.kind.as_str(), m.title.as_str()),
            ("audio_in", "audio in")
        );
        assert!(!m.is_mod);
        let labels: Vec<&str> = m.knobs.iter().map(|k| k.label.as_str()).collect();
        assert_eq!(labels, ["input", "gain", "channel"]);
        let addrs: Vec<&str> = m.knobs.iter().map(|k| k.addr.as_str()).collect();
        assert_eq!(addrs, ["node/0#input", "node/0#gain", "node/0#channel"]);
        match &m.knobs[0].kind {
            KnobKind::Enum { options } => {
                assert_eq!(options.len(), term::INPUT_SLOTS);
                assert_eq!((options[0].as_str(), m.knobs[0].value), ("1", 2.0));
            }
            k => panic!("input is a selector, not {k:?}"),
        }
        match &m.knobs[2].kind {
            KnobKind::Enum { options } => {
                assert_eq!(options, &["left", "right", "both"]);
                assert_eq!(m.knobs[2].value, 1.0);
            }
            k => panic!("channel is a selector, not {k:?}"),
        }
        assert_eq!(m.structural_addrs, ["node/0#leaf", "node/0#src"]);
        // Every knob is an address a knob edit writes, and nothing else moves.
        let set = set_param(&tree, "node/0#input", ParamValue::Index(5)).unwrap();
        match &set.root.children()[0] {
            term::AudioNode::AudioIn { input, channel, .. } => {
                assert_eq!((*input, *channel), (5, term::InputChannel::Right));
            }
            n => panic!("the edit replaced the node: {}", n.to_sexpr()),
        }
        let clamped = set_param(&tree, "node/0#input", ParamValue::Index(99)).unwrap();
        assert_eq!(
            clamped
                .to_trace()
                .get_usize(&fugue::addr!("node/0", "input")),
            Some(term::INPUT_SLOTS - 1),
            "an input past the last slot is clamped to it"
        );
        let louder = set_param(&tree, "node/0#gain", ParamValue::Continuous(0.9)).unwrap();
        assert_eq!(tree_diff(&tree, &louder).len(), 1);
        assert_eq!(tree.input_sites(), ["node/0#input"]);
        assert!(tree.listens() && !presets::presets()[0].1.listens());
    }

    /// Off in the shipped prior, rare once on, and the prior never picks a
    /// device.
    ///
    /// The default prior draws no AUDIO IN from either sampler and gives one
    /// no mass, because live capture is not built yet (`AUDIO_IN_WEIGHT`).
    /// With the term on ([`PatchGrammarPrior::with_audio_in`]), a drawn AUDIO
    /// IN is rare and reads the first input, and a tree reading any other
    /// slot scores exactly what the same tree reading slot 0 does.
    #[test]
    fn audio_in_is_rare_and_the_prior_never_picks_an_input() {
        let off = PatchGrammarPrior::default();
        let mut rng = StdRng::seed_from_u64(0xA0D1_0000);
        for _ in 0..3000 {
            assert!(
                !off.sample_with_rng(&mut rng).listens(),
                "the RNG path drew an input"
            );
            assert!(
                !draw(&off, &mut rng).0.listens(),
                "the program drew an input"
            );
        }
        let lp = log_prior(&off, &listening(0, term::InputChannel::Both));
        assert_eq!(
            lp,
            f64::NEG_INFINITY,
            "the shipped prior gives an input mass"
        );

        let prior = PatchGrammarPrior::default().with_audio_in();
        let n = 3000;
        let mut rng = StdRng::seed_from_u64(0xA0D1_0001);
        let mut drawn = Vec::new();
        for _ in 0..n {
            drawn.push(prior.sample_with_rng(&mut rng));
            drawn.push(draw(&prior, &mut rng).0);
        }
        let listeners: Vec<&PatchTree> = drawn.iter().filter(|t| t.listens()).collect();
        let rate = listeners.len() as f64 / drawn.len() as f64;
        assert!(
            (0.002..0.03).contains(&rate),
            "{rate:.4} of drawn trees listen; the input should be rare, not absent"
        );
        for t in &listeners {
            let trace = t.to_trace();
            for site in t.input_sites() {
                let (key, _) = edit::split_addr(&site);
                assert_eq!(
                    trace.get_usize(&fugue::addr!(key, "input")),
                    Some(0),
                    "the prior chose an input: {}",
                    t.to_sexpr()
                );
            }
        }
        // Every slot carries the same prior mass, so a player's input is
        // never what makes a patch improbable (or un-evolvable).
        let lp0 = log_prior(&prior, &listening(0, term::InputChannel::Both));
        assert!(lp0.is_finite());
        for slot in 1..term::INPUT_SLOTS as u8 {
            let lp = log_prior(&prior, &listening(slot, term::InputChannel::Both));
            assert_eq!(lp, lp0, "slot {slot} scores differently from slot 0");
        }
        // Past the last slot is outside the support, and the decoder says so.
        let mut past = listening(0, term::InputChannel::Both).to_trace();
        past.insert_choice(
            fugue::addr!("node/0", "input"),
            fugue_evo::genome::trace_genome::ChoiceValue::Usize(term::INPUT_SLOTS),
            0.0,
        );
        assert!(PatchTree::from_trace(&past).is_err());
    }

    /// The codec round-trips an AUDIO IN at every slot and channel, with the
    /// site count `site_count` claims, and the generative program replays the
    /// same choices.
    #[test]
    fn audio_in_round_trips_at_every_slot_and_channel() {
        // Scored with the term on: the default prior gives it no mass while
        // live capture is not built (`AUDIO_IN_WEIGHT`).
        let prior = PatchGrammarPrior::default().with_audio_in();
        for slot in 0..term::INPUT_SLOTS as u8 {
            for channel in term::InputChannel::ALL {
                let t = listening(slot, channel);
                let trace = t.to_trace();
                assert_eq!(trace.choices.len(), t.site_count());
                assert_eq!(PatchTree::from_trace(&trace).unwrap(), t);
                let (replayed, scored) = run(
                    ScoreGivenTrace {
                        base: trace,
                        trace: Trace::default(),
                    },
                    prior.model(),
                );
                assert_eq!(replayed, t, "the program replays another tree");
                assert!(scored.log_prior.is_finite());
            }
        }
    }

    /// An AUDIO IN compiles to quiver's `AudioInput` on the caller's stream:
    /// silent unbound, the stream's signal bound, its gain a live knob, and
    /// its channel the one it names.
    #[test]
    fn audio_in_compiles_to_a_bound_input() {
        use quiver::prelude::AudioInputStream;
        use std::sync::Arc;
        let level =
            |tree: &PatchTree, stream: Option<&Arc<AudioInputStream>>, gain: Option<f64>| {
                let mut v = compile_with_input(tree, SR, stream).expect("compiles");
                if let Some(g) = gain {
                    v.params["node/0#gain"].set_normalized(g);
                }
                v.gate.set(5.0);
                let mut peak = 0.0f64;
                for _ in 0..4096 {
                    let (l, _) = v.patch.tick();
                    peak = peak.max(l.abs());
                    if let Some(s) = stream {
                        s.advance();
                    }
                }
                peak
            };
        let stream = || {
            let s = Arc::new(AudioInputStream::with_host_clock(2, 4096));
            // Left a 220 Hz tone, right silent.
            let left: Vec<f32> = (0..4096)
                .map(|i| (0.25 * (i as f64 * 220.0 * std::f64::consts::TAU / SR).sin()) as f32)
                .collect();
            s.write(&[&left[..], &[0.0f32; 4096][..]]);
            s
        };
        let left = listening(0, term::InputChannel::Left);
        assert_eq!(level(&left, None, None), 0.0, "an unbound input is silent");
        let heard = level(&left, Some(&stream()), None);
        assert!(heard > 0.1, "a bound input is heard ({heard})");
        let quieter = level(&left, Some(&stream()), Some(0.0));
        assert!(
            quieter < heard * 0.2,
            "the gain knob is live: −24 dB should be far quieter ({quieter} vs {heard})"
        );
        let right = listening(0, term::InputChannel::Right);
        assert!(
            level(&right, Some(&stream()), None) < 1e-6,
            "the right channel of this input is silent"
        );
    }
}
