use super::*;
use crate::loudness::{self, PEAK_CEILING};
use crate::phrase::PhraseSpec;
use crate::render::render_phrase;
use crate::tests::{amp, vco};
use auracle_grammar::term::{AmpEnv, AudioNode, ModNode, NoiseColor, Uid, Waveform};
use auracle_grammar::{PatchGrammarPrior, PatchTree};
use fugue::runtime::handler::run;
use fugue::runtime::interpreters::PriorHandler;
use fugue::Trace;
use fugue_evo::inference::prior::GenomePrior;
use rand::rngs::StdRng;
use rand::SeedableRng;

/// A tree that is all holes renders silent and the gate quarantines it.
///
/// This is the designed path for `Silence`, and it is what makes a small
/// nonzero prior weight safe rather than reckless. The prior can propose a
/// hole; if a whole patch collapses to one, the render is exactly zero,
/// `vet` returns `Silent`, and the candidate never reaches the pool — so
/// evolution is free to discover that holes are bad instead of being
/// forbidden from representing one.
#[test]
fn an_all_silence_tree_is_quarantined_as_silent() {
    let tree = PatchTree {
        amp: AmpEnv {
            attack: 0.1,
            decay: 0.3,
            sustain: 0.9,
            release: 0.3,
        },
        root: AudioNode::Silence { uid: Uid::NEW },
    };
    let got = featurize(&tree, &PhraseSpec::default()).map(|_| ());
    assert!(
        matches!(
            got,
            Err(FeaturizeError::Quarantined(VetFailure::Silent { .. }))
        ),
        "a patch of nothing but holes must fail the vet gate as silent: {got:?}"
    );
}

/// A hole inside a live patch is *not* quarantined — it is one muted
/// branch of a mixer, which is an ordinary patch and must stay auditionable.
#[test]
fn a_hole_beside_a_source_still_renders() {
    let tree = PatchTree {
        amp: AmpEnv {
            attack: 0.1,
            decay: 0.3,
            sustain: 0.9,
            release: 0.3,
        },
        root: AudioNode::Mix {
            uid: Uid::NEW,
            balance: 0.5,
            a: Box::new(AudioNode::Silence { uid: Uid::NEW }),
            b: Box::new(AudioNode::Noise {
                uid: Uid::NEW,
                color: NoiseColor::White,
            }),
        },
    };
    featurize(&tree, &PhraseSpec::default()).expect("half a mixer is still a patch you can hear");
}

/// **Nothing leaves the pipeline able to clip.**
///
/// The gate belongs here rather than in `loudness`, because the claim that
/// matters is about the buffer `featurize` hands out — the one audition
/// plays and the one preference data is collected on — not about a
/// function in isolation. A clipped audition collects a vote about
/// clipping rather than about the patch.
///
/// Measured over 150 prior draws before the ceiling existed: 15% of vetted
/// renders peaked over full scale, worst case 4.06. Run
/// `cargo run -p auracle-features --example norm_peak --release` for the
/// distribution; this is the always-on floor under it, over the presets
/// (hand-authored, and the loudest thing a new user meets) plus a sample of
/// the prior.
///
/// Every built-in preset has to vet to get that far, so this is also the
/// gate that a preset that can't be auditioned never ships. And over the
/// prior's draws, every candidate the pipeline lets through is a
/// measurement: φ has the documented dimension and is finite, a draw that
/// fails fails only as a quarantine (never a compile error, an out-of-domain
/// term or a non-finite feature), and most draws vet. Over a sweep of 26
/// seeds of 30 draws, the fewest that vetted was 28; the bound is half.
#[test]
fn no_vetted_render_leaves_above_the_peak_ceiling() {
    let spec = PhraseSpec::default();
    let mut checked = 0usize;
    let mut pulled = 0usize;

    let mut check = |what: &str, vc: &VettedCandidate| {
        let phi = vc.features.phi();
        assert_eq!(phi.len(), Features::phi_names().len(), "{what}");
        assert!(phi.iter().all(|x| x.is_finite()), "{what}: φ {phi:?}");
        let peak = vc.render.samples.iter().fold(0.0f64, |p, s| p.max(s.abs()));
        assert!(
            peak <= PEAK_CEILING + 1e-9,
            "{what}: normalized peak {peak:.3} is over the {PEAK_CEILING:.2} ceiling"
        );
        // The reduction has to be *reported* as well as applied, or a
        // surface cannot tell a peak-limited patch from a quiet one.
        assert!(vc.features.peak_reduction_db >= 0.0);
        if vc.features.peak_reduction_db > 0.0 {
            pulled += 1;
        }
        checked += 1;
    };

    for (name, tree) in auracle_grammar::presets() {
        let vc =
            featurize(&tree, &spec).unwrap_or_else(|e| panic!("preset {name} failed vetting: {e}"));
        check(&format!("preset {name}"), &vc);
    }

    let mut rng = StdRng::seed_from_u64(0xE05);
    let prior = PatchGrammarPrior::default();
    let n = 30;
    let mut vetted = 0;
    for i in 0..n {
        let (tree, _): (PatchTree, Trace) = run(
            PriorHandler {
                rng: &mut rng,
                trace: Trace::default(),
            },
            prior.model(),
        );
        let got = featurize(&tree, &spec);
        assert!(
            matches!(got, Ok(_) | Err(FeaturizeError::Quarantined(_))),
            "prior draw {i} failed as more than a quarantine: {:?}",
            got.map(|_| ())
        );
        // Quarantined draws are never auditioned, so they have no peak to
        // make a claim about.
        if let Ok(vc) = got {
            vetted += 1;
            check(&format!("prior draw {i}"), &vc);
        }
    }
    assert!(vetted * 2 > n, "only {vetted}/{n} prior draws vetted");
    println!("{checked} renders under the ceiling, {pulled} of them pulled down to get there");
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

/// **φ is eighteen audio coordinates, then twenty-six structural ones:
/// forty-four.** The books say so by number: the films (`films.md`), the
/// guide (`views/learning.md`) and the reference (`features/audio.md`,
/// `features/structural.md`, `audition/vetting.md`). A change to either
/// count fails here until they are updated, and owes `make revalidate`.
/// And `phi()` lays the values out in `phi_names()`'s order: the audio half,
/// then the structural half, each in its own `NAMES` order.
#[test]
fn phi_is_eighteen_audio_then_twenty_six_structural_coordinates() {
    assert_eq!(
        (AudioFeatures::NAMES.len(), StructFeatures::NAMES.len()),
        (18, 26),
        "φ's size moved: update the films, the guide and the reference"
    );
    let names = Features::phi_names();
    assert_eq!(names[..18], AudioFeatures::NAMES);
    assert_eq!(names[18..], StructFeatures::NAMES);

    let v = featurize(&vco(Waveform::Saw), &PhraseSpec::default()).expect("a saw vets");
    let phi = v.features.phi();
    assert_eq!(phi.len(), 44);
    assert_eq!(phi[..18], v.features.audio.to_vec());
    assert_eq!(phi[18..], v.features.structural.to_vec());
}

/// **A coordinate that is not a number never leaves the featurizer.** The
/// guard names the first one, by its φ name, whichever half of φ it is in;
/// a φ whose every coordinate is finite passes as it was.
#[test]
fn a_non_finite_coordinate_is_refused_by_name() {
    let good = featurize(&vco(Waveform::Saw), &PhraseSpec::default())
        .expect("a saw vets")
        .features;
    assert_eq!(good.clone().finite().unwrap().phi(), good.phi());

    let mut audio_nan = good.clone();
    audio_nan.audio.flux_mean = f64::NAN;
    audio_nan.audio.motion_fast = f64::INFINITY;
    match audio_nan.finite() {
        Err(FeaturizeError::NonFiniteFeature { name, value }) => {
            assert_eq!(name, "flux_mean:p2", "the first one, by name");
            assert!(value.is_nan());
        }
        other => panic!("a NaN in φ_audio got through: {:?}", other.map(|_| ())),
    }
    let mut struct_inf = good;
    struct_inf.structural.amp_release = f64::INFINITY;
    match struct_inf.finite() {
        Err(FeaturizeError::NonFiniteFeature { name, value }) => {
            assert_eq!((name.as_str(), value), ("amp_release", f64::INFINITY));
        }
        other => panic!(
            "an infinity in φ_struct got through: {:?}",
            other.map(|_| ())
        ),
    }
}
