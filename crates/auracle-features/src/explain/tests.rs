use super::*;
use crate::audio::log_axis;
use crate::render::NoteSpan;

fn phrase(samples: Vec<f64>, sr: f64) -> RenderedPhrase {
    let n = samples.len();
    RenderedPhrase {
        samples,
        sample_rate: sr,
        note_onsets: vec![0],
        spans: vec![NoteSpan {
            voct: 0.0,
            chord: 0,
            on_start: 0,
            on_end: n,
        }],
    }
}

/// A sine sits in the band holding its frequency, and that band is the
/// loudest; the held note's spectrum peaks at its bin.
#[test]
fn a_sine_lands_in_its_band() {
    let sr = 44_100.0;
    let f = 1_000.0;
    let x: Vec<f64> = (0..44_100)
        .map(|i| 0.5 * (std::f64::consts::TAU * f * i as f64 / sr).sin())
        .collect();
    let r = phrase(x, sr);
    let p = portrait(&r, &crate::audio::audio_features(&r));
    let edges = band_edges_hz();
    let band = (0..BANDS)
        .find(|&b| edges[b] <= f && f < edges[b + 1])
        .unwrap();
    assert_eq!(p.bands[band], 0.0);
    // The face of the same render is the same spectrum, in its 0.5 dB
    // steps: one band layout for both.
    for (a, b) in p.face.ltas_db().iter().zip(&p.bands) {
        assert!((a - b).abs() <= 0.55, "{a} vs {b}");
    }
    assert!(p
        .bands
        .iter()
        .enumerate()
        .all(|(b, d)| b == band || *d < 0.0));
    let peak = p
        .held
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(b.1))
        .unwrap()
        .0;
    assert!(((peak as f64 * p.held_step_hz) - f).abs() <= p.held_step_hz);
    // A steady sine's centroid is its frequency, and it does not move.
    let b: Vec<f64> = p.bright.iter().flatten().cloned().collect();
    assert!(b.iter().all(|c| (c - f).abs() < 30.0), "{b:?}");
    assert!(
        (p.facts.centroid_hz - f).abs() / f < 0.05,
        "{}",
        p.facts.centroid_hz
    );
}

/// The facts invert φ's coordinates: a known attack and tail read back.
#[test]
fn facts_read_phi_in_its_units() {
    let phi = AudioFeatures {
        centroid_mean: log_axis(2_000.0, 22_050.0),
        centroid_std: 0.0,
        rolloff_mean: log_axis(5_000.0, 22_050.0),
        flatness_mean: 0.1,
        flux_mean: 0.2,
        zcr_mean: log_axis(3_000.0, 22_050.0),
        rms_mean: 0.1,
        rms_std: 0.05,
        crest: 2.0f64.ln(),
        attack_s: (0.020f64 + 0.005).ln(),
        tail_ratio: (0.1f64 + 1e-3).ln(),
        bass_fraction: 0.25,
        held_centroid_std: 0.03,
        high_ratio: 0.5f64.ln(),
        chord_flatness_delta: 0.0,
        motion_slow: 0.5 * (0.04f64).log2(),
        motion_mid: crate::audio::MOTION_FLOOR,
        motion_fast: crate::audio::MOTION_FLOOR,
    };
    let f = Facts::of(&phi, 44_100.0);
    assert!((f.centroid_hz - 2_000.0).abs() < 0.5);
    assert!((f.rolloff_hz - 5_000.0).abs() < 1.0);
    assert!((f.zcr_hz - 3_000.0).abs() < 1.0);
    assert!((f.attack_ms - 20.0).abs() < 1e-9);
    assert!((f.tail_db + 20.0).abs() < 1e-9);
    assert!((f.crest_db - 6.0206).abs() < 1e-3);
    assert!((f.high_db + 6.0206).abs() < 1e-3);
    assert!((f.bass_pct - 25.0).abs() < 1e-9);
    assert!((f.swing - 0.5).abs() < 1e-9);
    assert!((f.motion_oct[0] - 0.2).abs() < 1e-9);
    // The held note's wander is on φ's log axis: 0.03 of 20 Hz to
    // Nyquist is 0.30 octave at 44.1 kHz, not 0.03.
    assert!((f.held_move_oct - 0.03 * (22_050.0f64 / 20.0).log2()).abs() < 1e-12);
    assert!((f.held_move_oct - 0.3032).abs() < 1e-3);
    assert!((f.motion_oct[1] - 0.01).abs() < 1e-9);
}

/// **A rest is a gap, not a level.** The held note's tracks are `null`
/// where its frames are silent, and its onset curve is the first note's
/// alone: past the second onset it reads nothing, not the next note. A render
/// that never sounds draws every spectrum at the floor and no track at all.
#[test]
fn a_rest_is_a_gap_and_silence_is_the_floor() {
    let sr = 44_100.0;
    let at = |s: f64| (s * sr) as usize;
    let tone = |i: usize| 0.5 * (std::f64::consts::TAU * 440.0 * i as f64 / sr).sin();
    // 0.3 s of A4, 0.3 s of digital silence, 0.4 s of A4: the held span is
    // the first 0.6 s, and the second note starts at 0.3 s.
    let x: Vec<f64> = (0..at(1.0))
        .map(|i| {
            if (at(0.3)..at(0.6)).contains(&i) {
                0.0
            } else {
                tone(i)
            }
        })
        .collect();
    let r = RenderedPhrase {
        samples: x,
        sample_rate: sr,
        note_onsets: vec![0, at(0.3)],
        spans: vec![NoteSpan {
            voct: 0.0,
            chord: 0,
            on_start: 0,
            on_end: at(0.6),
        }],
    };
    let p = portrait(&r, &crate::audio::audio_features(&r));
    let sounding = p.bright.iter().filter(|b| b.is_some()).count();
    let gaps = p.bright.iter().filter(|b| b.is_none()).count();
    assert!(sounding > 0 && gaps > 0, "{sounding} sounding, {gaps} gaps");
    assert_eq!(
        p.bright.iter().map(Option::is_none).collect::<Vec<_>>(),
        p.loud.iter().map(Option::is_none).collect::<Vec<_>>(),
        "a silent frame is null in both tracks"
    );
    assert!(p.bright.first().unwrap().is_some() && p.bright.last().unwrap().is_none());
    let past = ((0.3 - ONSET_WIN_S) / ONSET_STEP_S).ceil() as usize + 1;
    assert!(p.onset[..past - 1].iter().any(|v| *v > 0.5));
    assert!(
        p.onset[past..].iter().all(|v| *v == 0.0),
        "the onset curve went on past its note: {:?}",
        &p.onset[past..]
    );

    let silent = RenderedPhrase {
        samples: vec![0.0; at(1.0)],
        ..r
    };
    let q = portrait(&silent, &crate::audio::audio_features(&silent));
    assert!(q.bands.iter().all(|d| *d == FLOOR_DB), "{:?}", q.bands);
    assert!(q.held.iter().all(|d| *d == FLOOR_DB), "{:?}", q.held);
    assert!(q.bright.iter().all(Option::is_none) && q.loud.iter().all(Option::is_none));
}

/// An impulse passes every band at 0 dB.
#[test]
fn an_impulse_has_a_flat_response() {
    let mut h = vec![0.0; 4096];
    h[0] = 1.0;
    let r = response_bands(&h, 44_100.0);
    assert_eq!(r.len(), BANDS);
    assert!(r.iter().all(|d| d.abs() < 0.05), "{r:?}");
}
