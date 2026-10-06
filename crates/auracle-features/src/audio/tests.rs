use super::*;
use crate::phrase::PhraseSpec;
use crate::pipeline::featurize;
use crate::render::RenderedPhrase;
use crate::tests::{amp, vco};
use auracle_grammar::term::{AmpEnv, AudioNode, ModNode, NoiseColor, Uid, Waveform};
use auracle_grammar::PatchTree;
use std::f64::consts::TAU;

const SR: f64 = 48_000.0;

/// A bare phrase around `samples` — no spans, one onset at the start.
/// The segment-local coordinates all return 0.0 without spans, which is
/// what these tests want: they are about two coordinates each.
fn phrase(samples: Vec<f64>) -> RenderedPhrase {
    RenderedPhrase {
        samples,
        sample_rate: SR,
        note_onsets: vec![0],
        spans: vec![],
    }
}

/// A sine with a phase offset, so no sample lands exactly on the centre.
/// A sample of exactly 0.0 has its sign decided by the last bit of the
/// computed mean, which is not a property either test is about.
fn sine(hz: f64, n: usize, amp: f64) -> Vec<f64> {
    (0..n)
        .map(|i| amp * (TAU * hz * i as f64 / SR + 0.3).sin())
        .collect()
}

/// ZCR counts crossings of the signal's own centre, not of zero.
///
/// The fixture is the case the coordinate got wrong: a tone riding a DC
/// offset large enough that it never reaches zero. The first assertion
/// pins that down as a property of the fixture rather than a claim in a
/// comment — this signal crosses zero *never* — and the second says the
/// coordinate must nonetheless read it as exactly as bright as the
/// centred tone it is a copy of, because it is the same oscillation.
#[test]
fn zcr_counts_crossings_of_the_signals_own_centre() {
    let centred = sine(440.0, SR as usize, 0.5);
    // Same oscillation, scaled and lifted clear of zero: ±0.2 about +0.3.
    let riding: Vec<f64> = centred.iter().map(|s| s * 0.4 + 0.3).collect();

    let raw_crossings = riding
        .windows(2)
        .filter(|w| (w[0] >= 0.0) != (w[1] >= 0.0))
        .count();
    assert_eq!(
        raw_crossings, 0,
        "fixture must never cross zero, or it does not exercise the bug"
    );

    let a = audio_features(&phrase(centred));
    let b = audio_features(&phrase(riding));

    // Before the DC removal this read `log_axis(0, nyquist)` — the floor of
    // the axis, i.e. maximally dark — against a genuinely bright tone.
    assert!(
        (a.zcr_mean - b.zcr_mean).abs() < 1e-9,
        "offset tone read {} against {} for the same oscillation",
        b.zcr_mean,
        a.zcr_mean
    );
    assert!(b.zcr_mean > log_axis(0.0, SR / 2.0) + 0.1);
}

/// Flux is the change between *adjacent* frames, so a rest breaks the
/// chain rather than being stepped over.
///
/// Both fixtures are a burst, a rest, and a burst of the same tone; they
/// differ only in how loud the **second** burst is. That is the one edit
/// that isolates the bug, because flux is normalized by the combined frame
/// magnitude: scaling a burst scales every frame overlapping it by the
/// same factor, and a ratio of two scaled quantities is the ratio it was.
/// So every flux sample with both feet in one burst is invariant, and with
/// a rest longer than a frame no single frame straddles both bursts —
/// leaving exactly one comparison in the phrase that can see the amplitude
/// change. It is the comparison across the rest, and it is the one a rest
/// must not produce.
///
/// Every span is a whole number of hops, which is what makes the fixture
/// bite. Frames advance by `HOP` from zero, so unaligned spans leave the
/// last frame before the rest holding a sliver of tone under the near-zero
/// edge of the Hann window; that frame's magnitude is negligible against
/// the one after the rest, the ratio goes to 1 whatever the amplitude, and
/// the bug hides. Aligned, the frames either side of the rest are each
/// half tone at full window weight, and the step between them is real.
///
/// With the chain broken the two fixtures agree to the last bit. Carrying
/// `prev_mag` across instead scores the re-entry as a step from full scale
/// to a tenth of it, which is movement that did not happen in one hop.
#[test]
fn flux_does_not_step_across_a_rest() {
    let burst = 8 * HOP;
    // Four hops of rest: at least one frame is entirely silent, so the
    // chain has somewhere to break, and no frame holds both bursts.
    let rest = vec![0.0; 4 * HOP];
    let build = |second_amp: f64| {
        let mut s = sine(200.0, burst, 0.5);
        s.extend_from_slice(&rest);
        s.extend(sine(200.0, burst, second_amp));
        audio_features(&phrase(s)).flux_mean
    };

    let level = build(0.5);
    let quiet = build(0.05);

    assert!(
        (level - quiet).abs() < 1e-12,
        "re-entering ten times quieter moved flux_mean {level} -> {quiet}, \
         so a rest is still being stepped across"
    );
    // The fixture is only meaningful if there is flux to compare at all.
    assert!(level > 0.0);
}

/// Each modulation band answers to its own rate and only its own rate.
///
/// A 440 Hz tone amplitude-modulated at 1, 4 and 15 Hz — one rate inside
/// each band — held for 1.8 s like the standard phrase's first note. The
/// band containing the rate must read highest, and a static tone must
/// read the floor in all three, exactly: "still" is one value.
#[test]
fn motion_bands_separate_rate() {
    let n = (1.8 * SR) as usize;
    let am = |rate: f64, depth: f64| -> Vec<f64> {
        (0..n)
            .map(|i| {
                let t = i as f64 / SR;
                let g = 1.0 + depth * (TAU * rate * t).sin();
                0.3 * g * (TAU * 440.0 * t + 0.3).sin()
            })
            .collect()
    };
    let bands = |x: &[f64]| motion_bands(x, SR, 0, n);
    let still = bands(&am(1.0, 0.0));
    for b in still {
        assert!(
            (b - MOTION_FLOOR).abs() < 1e-5,
            "static tone moved: {still:?}"
        );
    }
    for (rate, want) in [(1.0, 0), (4.0, 1), (15.0, 2)] {
        let m = bands(&am(rate, 0.5));
        let top = (0..3).max_by(|a, b| m[*a].total_cmp(&m[*b])).unwrap();
        assert_eq!(top, want, "{rate} Hz AM landed in band {top}: {m:?}");
        assert!(
            m[want] > MOTION_FLOOR + 3.0,
            "{rate} Hz AM barely registered: {m:?}"
        );
    }
}

/// A span too short to hold a slow cycle reports the floor rather than a
/// number computed from a handful of frames.
#[test]
fn motion_bands_floor_on_short_spans() {
    let x = sine(440.0, SR as usize, 0.5);
    let m = motion_bands(&x, SR, 0, (0.5 * SR) as usize);
    assert_eq!(m, [MOTION_FLOOR; 3]);
}

/// A slow swell is an attack, not motion: a 0.9 s ramp into a steady tone
/// reads still, as does a steady tone that starts after a silent gap.
/// (Measured from the fixed 0.25 s skip alone, the swell read 4.3 octaves
/// over the floor in the slow band — a ramp is curved in log level, so
/// detrending leaves most of it.)
#[test]
fn motion_bands_ignore_a_slow_attack() {
    let n = (1.8 * SR) as usize;
    let tone = |t: f64| 0.3 * (TAU * 440.0 * t).sin();
    let swell: Vec<f64> = (0..n)
        .map(|i| {
            let t = i as f64 / SR;
            (t / 0.9).min(1.0) * tone(t)
        })
        .collect();
    let late: Vec<f64> = (0..n)
        .map(|i| {
            let t = i as f64 / SR;
            if t < 0.6 {
                0.0
            } else {
                tone(t)
            }
        })
        .collect();
    for (what, x) in [("swell", &swell), ("late start", &late)] {
        let m = motion_bands(x, SR, 0, n);
        for b in m {
            assert!(b < MOTION_FLOOR + 0.5, "{what} read as motion: {m:?}");
        }
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
