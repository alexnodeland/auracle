//! # ricercar-features
//!
//! The feature pipeline: renders every candidate patch under an identical
//! stimulus and extracts the feature vector `φ(x) = [φ_audio ; φ_struct]`
//! that the taste model scores.
//!
//! ## Pipeline invariants (DESIGN.md §2)
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
    use ricercar_grammar::term::{AmpEnv, AudioNode, ModNode, NoiseColor, Waveform};
    use ricercar_grammar::{PatchGrammarPrior, PatchTree};

    /// Every built-in preset renders and passes the vetting gate — a preset
    /// that can't be auditioned must never ship.
    #[test]
    fn presets_pass_vetting() {
        let spec = PhraseSpec::default();
        for (name, tree) in ricercar_grammar::presets() {
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
                wave,
                octave: 0,
                detune: 0.5,
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
                kind: ricercar_grammar::term::FilterKind::SvfLp,
                cutoff: 0.5,
                resonance: 0.4,
                mod_depth: 0.3,
                modulation: ModNode::Lfo {
                    wave: Waveform::Triangle,
                    rate: 0.5,
                },
                input: Box::new(AudioNode::Noise {
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
                        wave: Waveform::Saw,
                        octave: 0,
                        detune: 0.5,
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

    /// `size` is exactly the sum of the nine module counts, so it must not be
    /// a φ coordinate — an exact collinearity is a rank-deficient design
    /// matrix and an unidentified ridge for the sampler to wander along.
    #[test]
    fn phi_carries_no_exact_collinearity() {
        let names = Features::phi_names();
        assert!(!names.contains(&"size"), "`size` is back in φ");
        let spec = PhraseSpec::default();
        for (_, tree) in ricercar_grammar::presets() {
            let f = featurize(&tree, &spec).unwrap().features;
            let s = &f.structural;
            let sum = s.n_vco
                + s.n_supersaw
                + s.n_noise
                + s.n_mix
                + s.n_filter
                + s.n_fold
                + s.n_delay
                + s.n_chorus
                + s.n_reverb;
            assert_eq!(s.size, sum, "the collinearity this test guards is real");
        }
    }

    /// Structural features count exactly what's in the tree.
    #[test]
    fn struct_features_count_the_tree() {
        let tree = PatchTree {
            amp: amp(),
            root: AudioNode::Delay {
                time: 0.5,
                feedback: 0.5,
                mix: 0.5,
                input: Box::new(AudioNode::Filter {
                    kind: ricercar_grammar::term::FilterKind::Ladder,
                    cutoff: 0.5,
                    resonance: 0.5,
                    mod_depth: 0.5,
                    modulation: ModNode::Env {
                        attack: 0.2,
                        decay: 0.6,
                    },
                    input: Box::new(AudioNode::Mix {
                        balance: 0.5,
                        a: Box::new(vco(Waveform::Saw).root),
                        b: Box::new(AudioNode::Noise {
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
        assert_eq!(f.mod_density, 1.0); // one slot, one filled
        assert_eq!(f.to_vec().len(), StructFeatures::NAMES.len());
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
}
