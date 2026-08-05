//! # auracle-features
//!
//! The feature pipeline: renders every candidate patch under an identical
//! stimulus and extracts the feature vector `φ(x) = [φ_audio ; φ_struct]`
//! that the taste model scores.
//!
//! ## Pipeline invariants (the reference: *Audition*, *Features*)
//!
//! - **Standard phrase** ([`phrase::PhraseSpec`]): a fixed short mono phrase;
//!   features are only comparable across patches under an identical stimulus.
//! - **Determinism** ([`render`]): quiver's RNG is re-seeded per render, so
//!   `(term, spec)` → bit-identical samples.
//! - **Vetting gate** ([`vet`]): raw renders are inspected for non-finite,
//!   silent, runaway, or DC-dominated output *before* anything else; failures
//!   are quarantined and never auditioned.
//! - **LUFS normalization** ([`loudness`]): K-weighted gated loudness matched
//!   to a fixed target before audition *and* feature extraction — otherwise
//!   "louder" poisons the preference data.
//!
//! - **Memoization** ([`cache`]): because `(term, spec) → φ` is pure, a
//!   featurization the engine has already performed is replayed rather than
//!   re-rendered. A hit is indistinguishable from a miss by construction —
//!   the same [`pipeline::Features`] object comes back either way.
//!
//! [`pipeline::featurize`] composes it all; the [`pipeline::VettedCandidate`]
//! it returns carries the exact buffer audition will play. [`render::Audition`]
//! is that buffer in the f32 form every consumer actually wants, and
//! [`render::render_playback`] reproduces it bit-identically from a term plus
//! its recorded `gain_db`, which is what makes deferring the buffer safe.

pub mod audio;
pub mod cache;
pub mod loudness;
pub mod phrase;
pub mod pipeline;
pub mod render;
pub mod structural;
pub mod vet;

pub use audio::{audio_features, AudioFeatures};
pub use cache::{
    canonical_tree_json, featurize_memo, render_key, CachedFeatures, MemoStats, RenderMemo,
    DEFAULT_AUDIO_CAP, DEFAULT_FEATURE_CAP,
};
pub use phrase::PhraseSpec;
pub use pipeline::{featurize, Features, FeaturizeError, VettedCandidate, TARGET_LUFS};
pub use render::{render_phrase, render_playback, Audition, RenderedPhrase};
pub use structural::{struct_features, StructFeatures};
pub use vet::{vet, VetConfig, VetFailure, VetReport};

#[cfg(test)]
mod tests {
    use super::*;
    use auracle_grammar::term::{AmpEnv, AudioNode, ModNode, NoiseColor, Uid, Waveform};
    use auracle_grammar::{PatchGrammarPrior, PatchTree};

    /// Every built-in preset renders and passes the vetting gate — a preset
    /// that can't be auditioned must never ship.
    #[test]
    fn presets_pass_vetting() {
        let spec = PhraseSpec::default();
        for (name, tree) in auracle_grammar::presets() {
            featurize(&tree, &spec).unwrap_or_else(|e| panic!("preset {name} failed vetting: {e}"));
        }
    }
    use fugue::runtime::handler::run;
    use fugue::runtime::interpreters::PriorHandler;
    use fugue::Trace;
    use fugue_evo::inference::prior::GenomePrior;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    fn amp() -> AmpEnv {
        AmpEnv {
            attack: 0.05,
            decay: 0.3,
            sustain: 0.8,
            release: 0.3,
        }
    }

    fn vco(wave: Waveform) -> PatchTree {
        PatchTree {
            amp: amp(),
            root: AudioNode::Vco {
                uid: Uid::NEW,
                wave,
                octave: 0,
                detune: 0.5,
                mod_depth: 0.0,
                modulation: ModNode::None,
            },
        }
    }

    /// Determinism: identical (term, spec) → bit-identical render and
    /// features, including for stochastic modules (noise).
    #[test]
    fn renders_are_deterministic() {
        let spec = PhraseSpec::default();
        let noisy = PatchTree {
            amp: amp(),
            root: AudioNode::Filter {
                uid: Uid::NEW,
                kind: auracle_grammar::term::FilterKind::SvfLp,
                cutoff: 0.5,
                resonance: 0.4,
                mod_depth: 0.3,
                modulation: ModNode::Lfo {
                    uid: Uid::NEW,
                    wave: Waveform::Triangle,
                    rate: 0.5,
                },
                input: Box::new(AudioNode::Noise {
                    uid: Uid::NEW,
                    color: NoiseColor::White,
                }),
            },
        };
        for tree in [vco(Waveform::Saw), noisy] {
            let a = render_phrase(&tree, &spec).unwrap();
            let b = render_phrase(&tree, &spec).unwrap();
            assert_eq!(a.samples, b.samples, "bit-identical renders");
            let fa = featurize(&tree, &spec).unwrap();
            let fb = featurize(&tree, &spec).unwrap();
            assert_eq!(fa.features.phi(), fb.features.phi());
        }
    }

    /// The features order by physics: saw is brighter than sine; noise is
    /// flatter than either; slower amp attack → longer measured attack.
    #[test]
    fn features_track_physics() {
        let spec = PhraseSpec::default();
        let saw = featurize(&vco(Waveform::Saw), &spec).unwrap().features;
        let sine = featurize(&vco(Waveform::Sine), &spec).unwrap().features;
        assert!(
            saw.audio.centroid_mean > sine.audio.centroid_mean,
            "saw centroid {} should exceed sine {}",
            saw.audio.centroid_mean,
            sine.audio.centroid_mean
        );

        let noise = featurize(
            &PatchTree {
                amp: amp(),
                root: AudioNode::Noise {
                    uid: Uid::NEW,
                    color: NoiseColor::White,
                },
            },
            &spec,
        )
        .unwrap()
        .features;
        assert!(noise.audio.flatness_mean > saw.audio.flatness_mean);
        assert!(noise.audio.flatness_mean > 0.1);

        let slow = PatchTree {
            amp: AmpEnv {
                attack: 0.7,
                ..amp()
            },
            root: vco(Waveform::Saw).root,
        };
        let slow_f = featurize(&slow, &spec).unwrap().features;
        assert!(
            slow_f.audio.attack_s > saw.audio.attack_s,
            "slow attack {} should exceed fast {}",
            slow_f.audio.attack_s,
            saw.audio.attack_s
        );
    }

    /// Normalization lands renders near the target loudness (within 1 LU),
    /// for both loud and quiet sources.
    #[test]
    fn normalization_hits_target() {
        let spec = PhraseSpec::default();
        for tree in [vco(Waveform::Saw), vco(Waveform::Sine)] {
            let v = featurize(&tree, &spec).unwrap();
            let lufs_after =
                loudness::integrated_lufs(&v.render.samples, v.render.sample_rate).unwrap();
            assert!(
                (lufs_after - TARGET_LUFS).abs() < 1.0,
                "normalized loudness {lufs_after} not near {TARGET_LUFS}"
            );
        }
    }

    /// The vet gate quarantines silence (a phrase whose gate never opens).
    #[test]
    fn vet_quarantines_silence() {
        let spec = PhraseSpec {
            notes: vec![crate::phrase::Note {
                voct: 0.0,
                on_s: 0.0,
                off_s: 1.0,
                chord: Vec::new(),
            }],
            ..Default::default()
        };
        let err = featurize(&vco(Waveform::Saw), &spec).unwrap_err();
        assert!(
            matches!(err, FeaturizeError::Quarantined(VetFailure::Silent { .. })),
            "expected Silent quarantine, got: {err}"
        );
    }

    /// Brightness lives on an **octave** axis, not a linear-Hz one: equal
    /// frequency *ratios* must move the coordinate equally, or a linear model
    /// in it cannot express "a shade brighter" anywhere but the top octave.
    #[test]
    fn spectral_axis_is_logarithmic() {
        use crate::audio::log_axis;
        let ny = 22_050.0;
        let octave_low = log_axis(400.0, ny) - log_axis(200.0, ny);
        let octave_high = log_axis(16_000.0, ny) - log_axis(8_000.0, ny);
        assert!(
            (octave_low - octave_high).abs() < 1e-12,
            "an octave is {octave_low} down low but {octave_high} up high"
        );
        // Anchored and normalized: 20 Hz is 0, Nyquist is 1.
        assert!(log_axis(20.0, ny).abs() < 1e-12);
        assert!((log_axis(ny, ny) - 1.0).abs() < 1e-12);
        // Sub-anchor frequencies clamp rather than diverge.
        assert_eq!(log_axis(1.0, ny), 0.0);
    }

    /// `attack_s` must stay a *continuous* axis at the fast end. Flooring the
    /// 90%-crossing to the analysis-window index collapsed every percussive
    /// patch to exactly zero — a spike, not a coordinate, and standardizing a
    /// spike gives the model a feature that is one value for most of the pool.
    #[test]
    fn fast_attacks_are_resolved_not_floored() {
        let spec = PhraseSpec::default();
        let measure = |attack: f64| {
            featurize(
                &PatchTree {
                    amp: AmpEnv { attack, ..amp() },
                    root: AudioNode::Vco {
                        uid: Uid::NEW,
                        wave: Waveform::Saw,
                        octave: 0,
                        detune: 0.5,
                        mod_depth: 0.0,
                        modulation: ModNode::None,
                    },
                },
                &spec,
            )
            .unwrap()
            .features
            .audio
            .attack_s
        };
        let (a0, a1, a2) = (measure(0.0), measure(0.02), measure(0.05));
        assert!(
            a0 < a1 && a1 < a2,
            "attack not monotone/resolved: {a0} {a1} {a2}"
        );
    }

    /// The v1 stimulus, kept as a fixture: the phrase whose blind spots the
    /// v2 default exists to remove. The gates below assert both directions —
    /// that v2 discriminates, *and* that v1 could not, so the next person
    /// reading a failure knows what the segment is for.
    fn v1_spec() -> PhraseSpec {
        use crate::phrase::Note;
        PhraseSpec {
            notes: vec![
                Note {
                    voct: 0.0,
                    on_s: 0.60,
                    off_s: 0.15,
                    chord: Vec::new(),
                },
                Note {
                    voct: 3.0 / 12.0,
                    on_s: 0.25,
                    off_s: 0.10,
                    chord: Vec::new(),
                },
                Note {
                    voct: -1.0,
                    on_s: 0.80,
                    off_s: 1.25,
                    chord: Vec::new(),
                },
            ],
            ..Default::default()
        }
    }

    fn filtered(cutoff: f64, modulation: ModNode) -> PatchTree {
        PatchTree {
            amp: amp(),
            root: AudioNode::Filter {
                uid: Uid::NEW,
                kind: auracle_grammar::term::FilterKind::SvfLp,
                cutoff,
                resonance: 0.3,
                mod_depth: 0.8,
                modulation,
                input: Box::new(vco(Waveform::Saw).root),
            },
        }
    }

    /// Slow attacks resolve well past the old 0.75 s onset window. Under the
    /// v1 phrase every attack knob position from ~0.7 up measured the same
    /// (the envelope was still rising when the window closed, so t90 pinned
    /// to the window end); the 1.8 s held note spreads that range back out.
    #[test]
    fn slow_attacks_resolve_beyond_the_old_window() {
        let attack_under = |spec: &PhraseSpec, attack: f64| {
            featurize(
                &PatchTree {
                    amp: AmpEnv { attack, ..amp() },
                    root: vco(Waveform::Saw).root,
                },
                spec,
            )
            .unwrap()
            .features
            .audio
            .attack_s
        };
        let (v1, v2) = (v1_spec(), PhraseSpec::default());
        let v1_gap = attack_under(&v1, 0.82) - attack_under(&v1, 0.7);
        let v2_gap = attack_under(&v2, 0.82) - attack_under(&v2, 0.7);
        assert!(
            v1_gap.abs() < 0.05,
            "v1 no longer saturates ({v1_gap:.3}) — this gate's premise moved"
        );
        assert!(
            v2_gap > 0.10,
            "v2 fails to separate slow attacks ({v2_gap:.3})"
        );
        // And the axis stays monotone through the newly-resolved range.
        let (a, b, c) = (
            attack_under(&v2, 0.6),
            attack_under(&v2, 0.7),
            attack_under(&v2, 0.82),
        );
        assert!(a < b && b < c, "not monotone: {a:.3} {b:.3} {c:.3}");
    }

    /// A register-constant held note makes sub-Hz modulation a measurable
    /// fact. `held_centroid_std` is near-zero for a static patch and orders
    /// of magnitude larger with a slow LFO on the filter — including at
    /// ~0.1 Hz, which the whole v1 phrase was too short to witness.
    #[test]
    fn held_note_reveals_sub_hz_modulation() {
        let spec = PhraseSpec::default();
        let hcs = |m: ModNode| {
            featurize(&filtered(0.4, m), &spec)
                .unwrap()
                .features
                .audio
                .held_centroid_std
        };
        let still = hcs(ModNode::None);
        let slow = hcs(ModNode::Lfo {
            uid: Uid::NEW,
            wave: Waveform::Triangle,
            rate: 0.45, // ≈ 0.4 Hz
        });
        let crawl = hcs(ModNode::Lfo {
            uid: Uid::NEW,
            wave: Waveform::Triangle,
            rate: 0.3, // ≈ 0.1 Hz
        });
        assert!(still < 0.005, "static patch moves on its own: {still:.4}");
        assert!(
            slow > 10.0 * still.max(1e-4) && slow > 0.03,
            "0.4 Hz motion invisible: {slow:.4} vs still {still:.4}"
        );
        assert!(
            crawl > 10.0 * still.max(1e-4) && crawl > 0.01,
            "0.1 Hz motion invisible: {crawl:.4} vs still {still:.4}"
        );
    }

    /// The C5 note exposes whether a patch speaks in the upper register: a
    /// dark low-cutoff filter chokes it (strongly negative `high_ratio`)
    /// while an open patch carries it at roughly the held note's level.
    #[test]
    fn high_note_reveals_register_response() {
        let spec = PhraseSpec::default();
        let dark = featurize(&filtered(0.12, ModNode::None), &spec)
            .unwrap()
            .features
            .audio
            .high_ratio;
        let open = featurize(&vco(Waveform::Saw), &spec)
            .unwrap()
            .features
            .audio
            .high_ratio;
        assert!(
            dark < open - 0.3,
            "register response indistinct: dark {dark:.3} vs open {open:.3}"
        );
        assert!(
            open.abs() < 0.5,
            "open patch should speak evenly: {open:.3}"
        );
    }

    /// The chord note really is a second voice: the render is bit-identical
    /// up to the chord onset, diverges inside it, carries ~2× the energy of
    /// the mono render there, and the chord feature goes live exactly (and
    /// only) when the phrase has a chord.
    #[test]
    fn chord_segment_stacks_a_second_voice() {
        let spec = PhraseSpec::default();
        assert_eq!(spec.max_voices(), 2);
        let mut mono = spec.clone();
        for n in &mut mono.notes {
            n.chord.clear();
        }
        let tree = vco(Waveform::Saw);
        let poly_r = render_phrase(&tree, &spec).unwrap();
        let mono_r = render_phrase(&tree, &mono).unwrap();
        let chord = poly_r
            .spans
            .iter()
            .find(|s| s.chord > 0)
            .expect("chord span");
        assert_eq!(
            poly_r.samples[..chord.on_start],
            mono_r.samples[..chord.on_start],
            "chord voice leaked ahead of its onset"
        );
        assert_ne!(
            poly_r.samples[chord.on_start..chord.on_end],
            mono_r.samples[chord.on_start..chord.on_end],
            "chord segment is not polyphonic"
        );
        let energy = |s: &[f64]| s.iter().map(|x| x * x).sum::<f64>();
        let ratio = energy(&poly_r.samples[chord.on_start..chord.on_end])
            / energy(&mono_r.samples[chord.on_start..chord.on_end]);
        assert!(
            (1.4..=3.0).contains(&ratio),
            "dyad energy ratio {ratio:.2} outside the plausible band"
        );
        let poly_f = featurize(&tree, &spec).unwrap().features.audio;
        let mono_f = featurize(&tree, &mono).unwrap().features.audio;
        assert_ne!(poly_f.chord_flatness_delta, 0.0);
        assert_eq!(
            mono_f.chord_flatness_delta, 0.0,
            "chord feature must read 'no evidence' without a chord"
        );
    }

    /// The default stimulus keeps its advertised shape — each clause here is
    /// one of the four blind spots the v2 phrase exists to remove, so a
    /// "harmless" retiming that reopens one fails loudly.
    #[test]
    fn the_default_phrase_keeps_its_advertised_shape() {
        let spec = PhraseSpec::default();
        let first = &spec.notes[0];
        assert!(
            first.on_s >= 1.5,
            "held note too short to reveal slow attacks / sub-Hz motion"
        );
        assert!(
            spec.notes.iter().any(|n| n.voct >= 1.0),
            "no note above the old Eb4 ceiling"
        );
        assert!(
            spec.notes.iter().any(|n| !n.chord.is_empty()),
            "no polyphonic segment"
        );
        let last = spec.notes.last().unwrap();
        assert!(
            last.chord.is_empty() && last.off_s >= 1.0,
            "tail window must stay last, long, and mono"
        );
        assert!(
            spec.total_seconds() <= 5.5,
            "stimulus creep: {:.2}s — the render budget was ~2× v1",
            spec.total_seconds()
        );
    }

    /// The two exact collinearities φ must not contain, checked on the term
    /// rather than assumed: `size` is the sum of every module count, and the
    /// sources exceed the binary nodes by exactly one. Either one makes the
    /// design matrix rank-deficient — an unidentified ridge for the sampler
    /// to wander along, and per-feature weights the Styles tab would render
    /// as if they meant something individually.
    ///
    /// Wave 2B is where the second identity stops being about two nodes:
    /// `Comp`, `Duck`, `Gate` and `Vocoder` each take two audio subterms, so
    /// all six binary counts appear in it. The φ-side consequence is checked
    /// in `phi_hides_every_binary_count_inside_a_family` below.
    ///
    /// Wave 2C adds a **third** identity, over the modulation forest rather
    /// than the audio tree — the leaves of a forest exceed its binary nodes by
    /// its tree count — and it is asserted here alongside the other two. It
    /// does not reach φ, for the reason spelled out in
    /// [`crate::structural`]: its tree count is `filled_slots`, which φ only
    /// carries inside the `mod_density` ratio, and the euclid sits on the
    /// same side of the sum as the combiners rather than opposite them.
    #[test]
    fn phi_carries_no_exact_collinearity() {
        let names = Features::phi_names();
        // `n_delay` is here because wave 2A *renamed* it to `n_time`: the
        // column counts granulators now, and a stale name in φ is a Styles
        // tab row that says "delay" about something else.
        for gone in [
            "size",
            "depth",
            "n_mix",
            "n_ringmod",
            "n_delay",
            "n_comp",
            "n_duck",
            "n_gate",
            "n_vocoder",
        ] {
            assert!(!names.contains(&gone), "`{gone}` is back in φ");
        }
        let spec = PhraseSpec::default();
        for (name, tree) in auracle_grammar::presets() {
            let f = featurize(&tree, &spec).unwrap().features;
            let s = &f.structural;
            let sources =
                s.n_vco + s.n_supersaw + s.n_noise + s.n_wavetable + s.n_pluck + s.n_formant;
            let binaries = s.n_mix + s.n_ringmod + s.n_comp + s.n_duck + s.n_gate + s.n_vocoder;
            let sum = sources
                + binaries
                + s.n_filter
                + s.n_eq
                + s.n_fold
                + s.n_distortion
                + s.n_bitcrush
                + s.n_delay
                + s.n_granular
                + s.n_shift
                + s.n_chorus
                + s.n_phaser
                + s.n_flanger
                + s.n_tremolo
                + s.n_vibrato
                + s.n_reverb;
            assert_eq!(s.size, sum, "{name}: size is not the sum of the counts");
            // Every production is unary except the six that take two audio
            // inputs, so every tree is a forest of `sources` leaves joined by
            // `sources − 1` binary nodes. This is ONE equation, so exactly one
            // column has to leave φ — `n_mix`. The other five stay, each
            // inside a family that also counts something outside the identity,
            // which is what stops it coming back.
            assert_eq!(
                sources - binaries,
                1.0,
                "{name}: the collinearity this test guards is not what it says"
            );
            // The modulation forest's own identity. `mod_density` is
            // `filled/slots`, so the filled count has to be reconstructed
            // here rather than read off φ — which is exactly why the equation
            // is not available to a linear model.
            let slots = mod_slots(&tree);
            let filled = (s.mod_density * slots as f64).round();
            let mod_leaves = s.n_lfo + s.n_env + s.n_rand + s.n_follow + s.n_euclid;
            let combiners = s.n_min + s.n_max + s.n_and + s.n_or + s.n_xor + s.n_switch;
            assert_eq!(
                mod_leaves - combiners,
                filled,
                "{name}: the modulation forest does not have one more leaf \
                 per tree than it has binary nodes"
            );
            // …and neither side of it is separately visible in φ: the euclid
            // is summed *with* the combiners, not against them.
            assert!(
                s.n_mod_logic() >= s.n_euclid + combiners - 1e-9,
                "{name}: n_mod_logic stopped hiding the euclid with the \
                 combiners, which is what keeps the identity out of φ"
            );
        }
    }

    /// How many modulation slots a tree has, counted the way
    /// `struct_features` does — one per module that owns one, regardless of
    /// how deep the chain hanging off it goes.
    fn mod_slots(tree: &PatchTree) -> usize {
        // A slot's address is `<owner>/m#mod` and nothing deeper: the nodes
        // *inside* a chain live at `<owner>/m/0#mod` and below, and they are
        // not slots — which is the same distinction `count_mod` draws.
        auracle_grammar::describe(tree)
            .modules
            .iter()
            .flat_map(|m| &m.structural_addrs)
            .filter(|a| a.ends_with("/m#mod"))
            .count()
    }

    /// No **retained** φ coordinate isolates a binary count, so the identity
    /// above cannot be reconstructed from what φ carries.
    ///
    /// This is the check `n_dynamics` needs and the earlier families did not:
    /// it is *exactly* `n_comp + n_duck + n_gate`, three of the six binary
    /// terms, with no unary member diluting it. The argument that it is
    /// nonetheless safe rests entirely on the other three terms being
    /// unrecoverable — so that is what gets asserted, by constructing the one
    /// tree that would expose a family with no unary member and checking each
    /// family moves when something outside the identity is added to it.
    #[test]
    fn phi_hides_every_binary_count_inside_a_family() {
        use auracle_grammar::term::{DriveMode, FilterKind};
        let saw = || vco(Waveform::Saw).root;
        // n_drive must move for a fold, which is not a binary node — so
        // `n_drive` alone never reads back as `n_ringmod`.
        let folded = StructFeatures {
            n_fold: 1.0,
            ..Default::default()
        };
        assert!(folded.n_drive() > 0.0 && folded.n_ringmod == 0.0);
        // Same for the filter family and the vocoder.
        let tilted = StructFeatures {
            n_eq: 1.0,
            ..Default::default()
        };
        assert!(tilted.n_filter_family() > 0.0 && tilted.n_vocoder == 0.0);
        // `n_dynamics` has no such dilution, and does not need one: it
        // contributes three of the six binary terms and nothing in φ supplies
        // `n_mix`, `n_ringmod` or `n_vocoder` separately from a family that
        // also counts unary nodes.
        let dynamics = PatchTree {
            amp: amp(),
            root: AudioNode::Duck {
                uid: Uid::NEW,
                amount: 0.7,
                threshold: 0.4,
                release: 0.35,
                mod_depth: 0.0,
                modulation: ModNode::None,
                input: Box::new(AudioNode::Distortion {
                    uid: Uid::NEW,
                    drive: 0.4,
                    tone: 0.5,
                    mode: DriveMode::Soft,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(saw()),
                }),
                key: Box::new(AudioNode::Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::SvfLp,
                    cutoff: 0.5,
                    resonance: 0.2,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                    input: Box::new(saw()),
                }),
            },
        };
        let s = struct_features(&dynamics);
        assert_eq!(s.n_dynamics(), 1.0);
        assert_eq!(s.size, 5.0, "the key branch was not counted");
        assert_eq!(s.n_vco, 2.0, "the key branch's source was not counted");
        // …and the identity holds on a tree whose binary node is a 2B one.
        assert_eq!(s.n_vco - s.n_duck, 1.0);
    }

    /// Structural features count exactly what's in the tree.
    #[test]
    fn struct_features_count_the_tree() {
        let tree = PatchTree {
            amp: amp(),
            root: AudioNode::Delay {
                uid: Uid::NEW,
                time: 0.5,
                feedback: 0.5,
                mix: 0.5,
                mod_depth: 0.0,
                modulation: ModNode::None,
                input: Box::new(AudioNode::Filter {
                    uid: Uid::NEW,
                    kind: auracle_grammar::term::FilterKind::Ladder,
                    cutoff: 0.5,
                    resonance: 0.5,
                    mod_depth: 0.5,
                    modulation: ModNode::Env {
                        uid: Uid::NEW,
                        attack: 0.2,
                        decay: 0.6,
                    },
                    input: Box::new(AudioNode::Mix {
                        uid: Uid::NEW,
                        balance: 0.5,
                        a: Box::new(vco(Waveform::Saw).root),
                        b: Box::new(AudioNode::Noise {
                            uid: Uid::NEW,
                            color: NoiseColor::Pink,
                        }),
                    }),
                }),
            },
        };
        let f = struct_features(&tree);
        assert_eq!(f.n_delay, 1.0);
        assert_eq!(f.n_filter, 1.0);
        assert_eq!(f.n_mix, 1.0);
        assert_eq!(f.n_vco, 1.0);
        assert_eq!(f.n_noise, 1.0);
        assert_eq!(f.n_env, 1.0);
        assert_eq!(f.n_lfo, 0.0);
        assert_eq!(f.size, 5.0);
        assert_eq!(f.depth, 4.0);
        // Three slots — the delay, the filter, and the vco, whose slot reaches
        // pitch — with only the filter's filled. The mix and the noise have
        // none: two audio inputs and no parameter respectively.
        assert_eq!(f.mod_density, 1.0 / 3.0);
        // Families, not per-kind columns: the ladder is the only `n_drive`
        // candidate here and there is none, so the coordinate reads zero.
        assert_eq!(f.n_drive(), 0.0);
        assert_eq!(f.n_mod_fx(), 0.0);
        // The filter family is the filter alone; the time family the delay.
        assert_eq!(f.n_filter_family(), 1.0);
        assert_eq!(f.n_time(), 1.0);
        assert_eq!(f.to_vec().len(), StructFeatures::NAMES.len());
        // Shape. Levels are delay(1) · filter(1) · mix(1) · vco+noise(2), so
        // the tree is two wide at its widest; both sources sit four nodes from
        // the root, so it is perfectly balanced; the mix's `/1` is a bare
        // noise source, so nothing is sidechained; and the one filled slot is
        // on the filter, one step down a four-deep tree.
        assert_eq!(f.branch_width_max, 2.0);
        assert_eq!(f.chain_balance, 1.0);
        assert_eq!(f.frac_sidechained, 0.0);
        assert!((f.mod_at_source - 1.0 / 3.0).abs() < 1e-12);
    }

    /// The wave-3 shape coordinates: two patches with **identical counts** and
    /// different routing must land on different φ.
    ///
    /// This is WS-8 §4's acceptance test in one assertion. `filter(mix(a, b))`
    /// filters the sum; `mix(filter(a), b)` filters one layer and leaves the
    /// other dry. One filter, two VCOs, one mixer either way — so under the
    /// twenty-three columns that shipped before this wave the two patches were
    /// *the same point*, and no amount of voting could have taught the model
    /// which one the user meant.
    #[test]
    fn shape_separates_serial_from_parallel() {
        let mix = |a: AudioNode, b: AudioNode| AudioNode::Mix {
            uid: Uid::NEW,
            balance: 0.5,
            a: Box::new(a),
            b: Box::new(b),
        };
        let filter = |input: AudioNode| AudioNode::Filter {
            uid: Uid::NEW,
            kind: auracle_grammar::term::FilterKind::SvfLp,
            cutoff: 0.5,
            resonance: 0.2,
            mod_depth: 0.0,
            modulation: ModNode::None,
            input: Box::new(input),
        };
        let src = || vco(Waveform::Saw).root;

        let sum_then_filter = struct_features(&PatchTree {
            amp: amp(),
            root: filter(mix(src(), src())),
        });
        let filter_one_layer = struct_features(&PatchTree {
            amp: amp(),
            root: mix(filter(src()), src()),
        });

        // Every count agrees, which is the point.
        for (a, b) in [
            (sum_then_filter.n_vco, filter_one_layer.n_vco),
            (sum_then_filter.n_filter, filter_one_layer.n_filter),
            (sum_then_filter.n_mix, filter_one_layer.n_mix),
            (sum_then_filter.size, filter_one_layer.size),
            (sum_then_filter.depth, filter_one_layer.depth),
        ] {
            assert_eq!(a, b);
        }
        // Both are two wide, which is why width is not the coordinate that
        // does the work here (and, per the module doc, is not a φ coordinate
        // at all). Balance is: sources at three and three against three and
        // two.
        assert_eq!(sum_then_filter.branch_width_max, 2.0);
        assert_eq!(filter_one_layer.branch_width_max, 2.0);
        assert_eq!(sum_then_filter.chain_balance, 1.0);
        assert!((filter_one_layer.chain_balance - 5.0 / 6.0).abs() < 1e-12);
        assert_ne!(sum_then_filter.to_vec(), filter_one_layer.to_vec());

        // A serial chain is one node wide however long it gets — the property
        // the proposal tilt reads to decide whether to offer a binary at all.
        let serial = struct_features(&PatchTree {
            amp: amp(),
            root: filter(filter(filter(src()))),
        });
        assert_eq!(serial.branch_width_max, 1.0);
        assert_eq!(serial.chain_balance, 1.0);

        // `frac_sidechained` asks whether the second input is a chain of its
        // own. Bare source on the right: no. A filter on the right: yes.
        assert_eq!(
            struct_features(&PatchTree {
                amp: amp(),
                root: mix(src(), src()),
            })
            .frac_sidechained,
            0.0
        );
        assert_eq!(
            struct_features(&PatchTree {
                amp: amp(),
                root: mix(src(), filter(src())),
            })
            .frac_sidechained,
            1.0
        );
    }

    /// Pipeline over prior samples: most draws featurize; quarantines are
    /// only ever the legitimate classes; φ has the documented dimension and
    /// is always finite.
    #[test]
    fn pipeline_over_prior_samples() {
        let spec = PhraseSpec::default();
        let prior = PatchGrammarPrior::default();
        let mut rng = StdRng::seed_from_u64(7);
        let n = 30;
        let mut ok = 0;
        for _ in 0..n {
            let (tree, _) = run(
                PriorHandler {
                    rng: &mut rng,
                    trace: Trace::default(),
                },
                prior.model(),
            );
            match featurize(&tree, &spec) {
                Ok(v) => {
                    ok += 1;
                    let phi = v.features.phi();
                    assert_eq!(phi.len(), Features::phi_names().len());
                    assert!(phi.iter().all(|x| x.is_finite()));
                }
                Err(FeaturizeError::Quarantined(_)) => {}
                Err(e) => panic!("unexpected pipeline error: {e}"),
            }
        }
        assert!(ok * 2 > n, "only {ok}/{n} prior samples featurized");
    }

    /// A term with a knob outside its range never becomes a row.
    ///
    /// The heart of M1: `amp.sustain = 1e30` **renders fine** — quiver's
    /// limiter bounds the voice — so it sailed through a vet gate that only
    /// asks about the audio, and its φ went into the observation log where it
    /// killed the `amp_sustain` column. The quarantine has to be able to
    /// refuse the *term*, not just the sound it makes.
    #[test]
    fn an_out_of_domain_term_is_quarantined() {
        let spec = PhraseSpec::default();
        let prior = PatchGrammarPrior::default();
        let mut rng = StdRng::seed_from_u64(31);
        let (mut tree, _) = run(
            PriorHandler {
                rng: &mut rng,
                trace: Trace::default(),
            },
            prior.model(),
        );
        // The exact shape found in the shipped session.
        tree.amp.sustain = 1e30;
        match featurize(&tree, &spec) {
            Err(FeaturizeError::OutOfDomain { site, value }) => {
                assert_eq!(site, "amp#sustain");
                assert_eq!(value, 1e30);
            }
            other => panic!("the sentinel got through the quarantine: {other:?}"),
        }
        // …and the same term, repaired, is an ordinary candidate again.
        assert_eq!(tree.clamp_domains(), 1);
        assert!(!matches!(
            featurize(&tree, &spec),
            Err(FeaturizeError::OutOfDomain { .. })
        ));
    }
}
