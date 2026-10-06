use super::*;

const SR: f64 = 44_100.0;

fn audition(samples: Vec<f64>) -> Audition {
    Audition {
        samples: samples.into_iter().map(|s| s as f32).collect(),
        sample_rate: SR,
    }
}

fn lufs(x: &[f32]) -> f64 {
    let x: Vec<f64> = x.iter().map(|s| f64::from(*s)).collect();
    integrated_lufs(&x, SR).expect("not silent")
}

/// `x` scaled to `target` LUFS.
fn at(x: Vec<f64>, target: f64) -> Vec<f64> {
    let g = 10f64.powf((target - integrated_lufs(&x, SR).expect("not silent")) / 20.0);
    x.into_iter().map(|s| s * g).collect()
}

/// A true-peak meter that shares nothing with the limiter's: 16×
/// oversampling by windowed-sinc interpolation of a different length and
/// window, so the limiter is not graded by its own detector. It reads the
/// points after samples `from..to` with taps over the whole buffer: a
/// signal cut off at a slice edge rings, and that ringing is the slice's,
/// not the signal's.
fn true_peak_16x(x: &[f32], from: usize, to: usize) -> f64 {
    let half = 24isize;
    let mut peak = x[from..to]
        .iter()
        .fold(0.0f64, |m, s| m.max(f64::from(s.abs())));
    for k in from as isize..to as isize {
        for p in 1..16 {
            let frac = p as f64 / 16.0;
            let mut acc = 0.0;
            for j in -half + 1..=half {
                let at = k + j;
                if at < 0 || at >= x.len() as isize {
                    continue;
                }
                let t = frac - j as f64;
                let sinc = (std::f64::consts::PI * t).sin() / (std::f64::consts::PI * t);
                // Blackman over ±half.
                let u = (t / half as f64 + 1.0) / 2.0;
                let w = 0.42 - 0.5 * (std::f64::consts::TAU * u).cos()
                    + 0.08 * (2.0 * std::f64::consts::TAU * u).cos();
                acc += f64::from(x[at as usize]) * sinc * w;
            }
            peak = peak.max(acc.abs());
        }
    }
    peak
}

/// A struck, decaying 440 Hz tone under a loud, bright click on the
/// onset: a pluck's crest factor, which is the kind of render the peak
/// ceiling pulls down. Its peak sits ~28 dB over its loudness, and the
/// ceiling binds on anything over 18 (`-TARGET_LUFS`).
fn pluck(amp: f64) -> Vec<f64> {
    (0..(1.5 * SR) as usize)
        .map(|i| {
            let t = i as f64 / SR;
            let body = (std::f64::consts::TAU * 440.0 * t).sin() * (-t / 0.4).exp();
            let click = (std::f64::consts::TAU * 5_000.0 * t).sin() * (-t / 0.004).exp();
            amp * (0.08 * body + 0.9 * click)
        })
        .collect()
}

/// A steady 440 Hz tone that swells in over the first half second: no
/// crest to speak of, the shape of a quiet pad.
fn swell() -> Vec<f64> {
    (0..(1.5 * SR) as usize)
        .map(|i| {
            let t = i as f64 / SR;
            (std::f64::consts::TAU * 440.0 * t).sin() * (t / 0.5).min(1.0)
        })
        .collect()
}

/// The common case has to cost nothing: a render the normalizer took to
/// the target, with headroom, is played exactly as it is stored.
#[test]
fn a_render_at_target_with_headroom_plays_bit_for_bit() {
    let stored = audition(at(swell(), TARGET_LUFS));
    assert!(stored.samples.iter().all(|s| s.abs() < 0.5));
    assert_eq!(audition_pcm(&stored), stored.samples);
}

/// **The defect, fixed.** A peaky render the ceiling held ~10 dB short
/// comes back louder and still never leaves above full scale — between
/// the samples included, read by a meter the limiter does not share. Past
/// the limiter's reach the whole shortfall is back, sample for sample; on
/// the onset the limiter takes what the ceiling demands, which for this
/// fixture (a 4 ms click carrying most of its energy) is half of it.
#[test]
fn a_peak_cut_render_comes_back_louder_and_under_the_ceiling() {
    // Normalize the way `normalize_to` does: to the target, then back off
    // whatever the ceiling demands.
    let raw = pluck(1.0);
    let peak = raw.iter().fold(0.0f64, |m, s| m.max(s.abs()));
    let stored = audition(raw.iter().map(|s| s / peak).collect());
    let short = TARGET_LUFS - lufs(&stored.samples);
    assert!(short > 3.0, "the fixture is not peaky enough");

    let played = audition_pcm(&stored);
    let tp = true_peak_16x(&played, 0, played.len());
    assert!(
        tp <= AUDITION_CEILING * 1.001,
        "true peak {tp:.4} over the ceiling"
    );
    let heard = lufs(&played);
    assert!(
        heard > TARGET_LUFS - short * 2.0 / 3.0,
        "{short:.1} dB short; played at {heard:.1} LUFS"
    );
    // 1.25 s in, the release (80 ms, from ~10 dB down) has let go: the
    // stored buffer times one constant.
    let tail: Vec<f64> = played
        .iter()
        .zip(&stored.samples)
        .skip((1.25 * SR) as usize)
        .filter(|(_, s)| s.abs() > 1e-3)
        .map(|(p, s)| f64::from(*p) / f64::from(*s))
        .collect();
    let (lo, hi) = tail
        .iter()
        .fold((f64::MAX, f64::MIN), |(lo, hi), r| (lo.min(*r), hi.max(*r)));
    assert!(
        hi / lo < 1.0 + 1e-6,
        "the tail is not a plain gain: {lo}..{hi}"
    );
}

/// What the 30 dB cap stopped short is only raised — there is headroom, so
/// nothing is limited: the waveform is the stored one, louder, at target.
#[test]
fn a_render_the_gain_cap_stopped_short_is_raised_not_limited() {
    let stored = audition(at(swell(), TARGET_LUFS - 12.0));
    let played = audition_pcm(&stored);
    assert!((lufs(&played) - TARGET_LUFS).abs() < 0.5);
    let ratio: Vec<f64> = played
        .iter()
        .zip(&stored.samples)
        .filter(|(_, s)| s.abs() > 1e-3)
        .map(|(p, s)| f64::from(*p) / f64::from(*s))
        .collect();
    let (lo, hi) = ratio
        .iter()
        .fold((f64::MAX, f64::MIN), |(lo, hi), r| (lo.min(*r), hi.max(*r)));
    assert!(hi / lo < 1.0 + 1e-6, "not a plain gain: {lo}..{hi}");
}

/// A buffer whose samples are all under full scale can still overshoot it
/// between them; the limiter reads those points too.
#[test]
fn an_intersample_over_is_caught() {
    // fs/4 at 45°: every sample is ±0.707·A, the waveform between them
    // peaks at A.
    let a = 1.3;
    let x: Vec<f64> = (0..(0.5 * SR) as usize)
        .map(|i| {
            let phase = std::f64::consts::FRAC_PI_2 * i as f64 + std::f64::consts::FRAC_PI_4;
            a * phase.sin()
        })
        .collect();
    let stored = audition(x);
    assert!(stored.samples.iter().all(|s| s.abs() < 1.0));
    let played = audition_pcm(&stored);
    // The interior: the fixture starts and stops at full amplitude, which
    // no audition does (every one opens and closes on silence).
    let tp = true_peak_16x(&played, 2_000, played.len() - 2_000);
    assert!(
        tp <= AUDITION_CEILING * 1.001,
        "true peak {tp:.4} over the ceiling"
    );
}

/// The live makeup is what loudness asked for — no ±12 dB clamp, no peak
/// ceiling, no 30 dB cap — within what the worklet accepts.
#[test]
fn live_makeup_is_the_loudness_makeup() {
    use auracle_features::{featurize, PhraseSpec};
    let preset = &auracle_grammar::preset_bank()[0];
    let mut f = featurize(&preset.tree, &PhraseSpec::default())
        .expect("presets vet")
        .features;
    let db = |f: &Features| 20.0 * live_makeup(f).log10();
    for (before, want) in [
        (-48.0, 30.0),
        (-60.0, 42.0),
        (-2.0, -16.0),
        (-200.0, MAKEUP_MAX_DB),
    ] {
        f.lufs_before = before;
        f.gain_db = 0.0;
        assert!(
            (db(&f) - want).abs() < 1e-9,
            "{before} LUFS → {} dB",
            db(&f)
        );
    }
}
