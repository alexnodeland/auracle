//! What the player hears: one level policy for both ways a patch reaches the
//! speakers — the ▶ audition and the live keys.
//!
//! Loudness normalization ([`auracle_features::loudness`]) exists for the
//! taste model: every candidate is *featurized* at [`TARGET_LUFS`] so that
//! "louder" cannot poison a preference. Two of its bounds are right for φ and
//! wrong for the ear, and this module gives back what they took — on the way to
//! the speakers only. The buffer φ is measured on never passes through here:
//! the pool keeps the stored audition exactly as `featurize` normalized it, and
//! every function below makes a *copy* for WebAudio.
//!
//! ## The audition: the makeup the stored buffer gave up
//!
//! The stored audition misses the target twice over. The peak ceiling
//! ([`auracle_features::PEAK_CEILING`]) gives up whatever makeup would take a
//! peaky render over full scale — a scalar, because a limiter would reshape the
//! waveform φ is measured on. And [`auracle_features::MAX_GAIN_DB`] stops a very
//! quiet render 30 dB short. On a fresh pool the first bound cuts 15 % of the
//! patches (plucks, by up to 11 dB) and the second binds on 12 % (slow swells
//! that have barely begun when the phrase ends, sub-bass, near-silent bells,
//! by up to 19 dB); together they left 5 % of the bank's auditions 10 LU or
//! more under the target (`examples/pool_loudness.rs`).
//!
//! [`audition_pcm`] raises the stored buffer to the target and then runs a
//! true-peak limiter, which is exactly the trade `loudness` could not make:
//! playback is allowed to reshape the transients φ never sees. What the 30 dB
//! cap stopped short mostly has headroom to spare and comes back whole (on a
//! fresh pool all 22 such patches land within 0.5 LU of the target, 19 of them
//! without the limiter touching them). What the ceiling pulled down comes back
//! as far as its transients allow: a pluck's click is limited and its body
//! rises, but a crest that is in the sustained wave (a pulse in the bass)
//! cannot be louder under a true-peak ceiling without being clipped, which
//! would be a different sound — so the limiter gives those back only part of
//! it (4 patches in 200 stay more than 4 LU under, the worst 8.7). A render at
//! the target with no over is returned bit-for-bit as stored, which is most of
//! the pool.
//!
//! ## The live voice: the makeup loudness asked for
//!
//! [`live_makeup`] is `TARGET_LUFS − lufs_before`, the gain that brings the
//! phrase to the target before *either* bound. It used to be the audition's
//! own gain clamped to ±12 dB, which left 43 % of a fresh pool outside the
//! clamp and a quarter of it ten or more LU under target at the keys. Neither
//! bound belongs on this path: the live voice has a brickwall on the summed
//! polyphony for peaks, and a leveler in front of it for held loudness (see
//! `live`), so what the phrase cannot predict about a note held longer than
//! the phrase is caught where it happens rather than guessed at here.

use auracle_features::{integrated_lufs, Audition, Features, PEAK_CEILING, TARGET_LUFS};

use crate::live::{MAKEUP_MAX_DB, MAKEUP_MIN_DB};

/// The live voice's makeup for a featurized patch, linear, within what
/// `LivePoly::set_makeup` accepts: the gain that brings its phrase to
/// [`TARGET_LUFS`], before the peak ceiling or the 30 dB cap.
pub(crate) fn live_makeup(f: &Features) -> f64 {
    let wanted = TARGET_LUFS - f.lufs_before;
    10f64.powf(wanted.clamp(MAKEUP_MIN_DB, MAKEUP_MAX_DB) / 20.0)
}

/// Ceiling of every audition as played, as a **true** peak: full scale, the
/// stored buffer's own [`PEAK_CEILING`], now held between the samples as well
/// as on them. Nothing leaves here hotter than the stored audition was allowed
/// to be, so the app's master gain keeps exactly the margin it had. A
/// hundred-thousandth under (−0.0001 dB), because a peak held *at* the ceiling
/// otherwise leaves a millionth over it once rounded to `f32` (measured: 11
/// of 200 auditions, worst 1.0000008).
const AUDITION_CEILING: f64 = PEAK_CEILING * (1.0 - 1e-5);

/// A stored audition this close under the target is left alone. Half a LU is
/// under the smallest level difference a listener reliably hears (about 1 dB),
/// and it is the size of the gating wobble a normalized buffer shows when it is
/// measured again, so a pool at the target plays bit-for-bit as stored.
const RESTORE_MIN_LU: f64 = 0.5;

/// Measure-and-raise passes. One is not always enough: BS.1770's −70 LUFS
/// absolute gate lets a quiet tail's blocks into the measurement once they are
/// louder, so a near-silent swell measures under the target again after being
/// raised to it (inferring the gain from the features instead left them up to
/// 3 LU short on a fresh pool). A second measurement lands every one of them
/// within [`RESTORE_MIN_LU`] of the target.
const RESTORE_PASSES: usize = 2;

/// How far ahead of a peak the limiter starts turning down. 1.5 ms is the usual
/// mastering-limiter look-ahead: long enough that the gain ramps over dozens
/// of samples instead of stepping (a step is a click), short enough that the
/// ramp does not audibly duck the attack in front of the transient it is
/// making room for.
const LOOKAHEAD_S: f64 = 0.0015;

/// Release time constant: ≈80 ms, the live master brickwall's
/// (`MASTER_RELEASE`), so an audition and the same patch at the keys limit
/// alike.
const RELEASE_S: f64 = 0.080;

/// Limiter passes. The gain is computed against the points between the
/// samples, but a gain that changes across the interpolation window moves those
/// points too: the ramp into a peak leaves it a few hundredths of a dB over
/// (measured, under 0.05 dB). A second pass over the limited buffer catches
/// that residue; the third is margin.
const LIMIT_PASSES: usize = 3;

/// The audition as it should be played: the stored buffer raised to
/// [`TARGET_LUFS`], then held under [`AUDITION_CEILING`] by a true-peak
/// limiter.
///
/// The one consumer of a stored audition on its way to WebAudio (`render_of`,
/// `edit_render`, `preview_op`). The shortfall is *measured* on the stored
/// buffer rather than inferred from the features, because the absolute gate
/// makes a quiet phrase's loudness move by more than its gain (see
/// [`RESTORE_PASSES`]). Returns the stored samples unchanged when there is
/// nothing to raise and nothing to limit.
pub(crate) fn audition_pcm(a: &Audition) -> Vec<f32> {
    let mut x: Vec<f64> = a.samples.iter().map(|&s| f64::from(s)).collect();
    let mut touched = false;
    for _ in 0..RESTORE_PASSES {
        let Some(lufs) = integrated_lufs(&x, a.sample_rate) else {
            break;
        };
        let short = TARGET_LUFS - lufs;
        if short < RESTORE_MIN_LU {
            break;
        }
        let g = 10f64.powf(short / 20.0);
        x.iter_mut().for_each(|s| *s *= g);
        touched = true;
    }
    for _ in 0..LIMIT_PASSES {
        let Some(gain) = limiter_gain(&x, a.sample_rate) else {
            break;
        };
        x.iter_mut().zip(&gain).for_each(|(s, g)| *s *= g);
        touched = true;
    }
    if touched {
        x.iter().map(|&s| s as f32).collect()
    } else {
        a.samples.clone()
    }
}

/// A 4× oversampling interpolator: the three points between each pair of
/// samples, as BS.1770-4's true-peak meter reads them (a Kaiser-windowed sinc,
/// 32 taps a phase where the recommendation's table has 12, so it under-reads
/// less, not more).
struct Interpolator {
    /// One kernel per fractional position ¼, ½, ¾; tap `t` weighs sample
    /// `k + t − (HALF − 1)` for the point after sample `k`.
    phases: [[f64; 2 * Interpolator::HALF]; 3],
    /// The largest kernel ℓ¹ norm: no interpolated point can exceed the
    /// largest sample in its window by more than this factor.
    l1: f64,
}

impl Interpolator {
    const HALF: usize = 16;

    fn new() -> Self {
        // β = 8: sidelobes near −60 dB, the usual choice for a meter.
        let beta = 8.0;
        let i0 = |x: f64| {
            let (mut sum, mut term, mut k) = (1.0, 1.0, 1.0);
            while term > 1e-12 * sum {
                term *= (x / (2.0 * k)).powi(2);
                sum += term;
                k += 1.0;
            }
            sum
        };
        let mut phases = [[0.0; 2 * Self::HALF]; 3];
        for (p, kernel) in phases.iter_mut().enumerate() {
            let frac = (p + 1) as f64 / 4.0;
            for (t, c) in kernel.iter_mut().enumerate() {
                let x = frac - (t as f64 - (Self::HALF as f64 - 1.0));
                let u = x / Self::HALF as f64;
                let sinc = (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x);
                *c = sinc * i0(beta * (1.0 - u * u).max(0.0).sqrt()) / i0(beta);
            }
            // Unit gain at DC, so a constant is not read as a peak.
            let sum: f64 = kernel.iter().sum();
            kernel.iter_mut().for_each(|c| *c /= sum);
        }
        let l1 = phases
            .iter()
            .map(|k| k.iter().map(|c| c.abs()).sum::<f64>())
            .fold(0.0, f64::max);
        Interpolator { phases, l1 }
    }

    /// The largest |x| on the interval from sample `k` to sample `k + 1`,
    /// both ends and the three points between.
    fn interval_peak(&self, x: &[f64], k: usize) -> f64 {
        let mut peak = x[k].abs().max(x.get(k + 1).map_or(0.0, |v| v.abs()));
        let first = k as isize - (Self::HALF as isize - 1);
        for kernel in &self.phases {
            let mut acc = 0.0;
            for (t, c) in kernel.iter().enumerate() {
                let at = first + t as isize;
                if at >= 0 && (at as usize) < x.len() {
                    acc += x[at as usize] * c;
                }
            }
            peak = peak.max(acc.abs());
        }
        peak
    }
}

/// The gain envelope that holds `x` under [`AUDITION_CEILING`] on and between
/// its samples, or `None` when nothing reaches it.
///
/// Offline, so the look-ahead costs no latency: each sample's gain is at most
/// what its neighbourhood needs (`need`), held for [`LOOKAHEAD_S`] after it and
/// released exponentially over [`RELEASE_S`] (`held`), then averaged over the
/// look-ahead window in front of it, which turns every step down into a ramp
/// that has arrived by the time the peak does. The average of a window whose
/// every member is at or below `need[k]` is at or below `need[k]`, which is the
/// whole guarantee; the final `min` only keeps rounding honest.
fn limiter_gain(x: &[f64], sample_rate: f64) -> Option<Vec<f64>> {
    let n = x.len();
    let interp = Interpolator::new();
    // Blocks whose whole neighbourhood is too quiet for any interpolated point
    // to reach the ceiling are skipped outright: most of most buffers.
    const BLOCK: usize = 256;
    let mut reach = vec![0.0f64; n];
    for start in (0..n).step_by(BLOCK) {
        let end = (start + BLOCK).min(n);
        let lo = start.saturating_sub(Interpolator::HALF);
        let hi = (end + Interpolator::HALF).min(n);
        let local = x[lo..hi].iter().fold(0.0f64, |m, s| m.max(s.abs()));
        if local * interp.l1 <= AUDITION_CEILING {
            continue;
        }
        for (k, r) in reach.iter_mut().enumerate().take(end).skip(start) {
            *r = interp.interval_peak(x, k);
        }
    }

    // A sample's gain is what the intervals on either side of it need.
    let need: Vec<f64> = (0..n)
        .map(|k| {
            let around = reach[k].max(if k > 0 { reach[k - 1] } else { 0.0 });
            if around > AUDITION_CEILING {
                AUDITION_CEILING / around
            } else {
                1.0
            }
        })
        .collect();
    if need.iter().all(|g| *g >= 1.0) {
        return None;
    }

    let ahead = ((LOOKAHEAD_S * sample_rate).round() as usize).max(1);
    let mut held = vec![1.0f64; n];
    for (k, &g) in need.iter().enumerate() {
        if g < 1.0 {
            for h in &mut held[k..(k + ahead + 1).min(n)] {
                *h = h.min(g);
            }
        }
    }
    let decay = (-1.0 / (RELEASE_S * sample_rate)).exp();
    let mut prev = 1.0f64;
    for h in &mut held {
        prev = h.min(1.0 - (1.0 - prev) * decay);
        // The release is an exponential approach, which never arrives; a
        // millionth (−0.00001 dB) is arrived, and from there on the limiter
        // is not there at all.
        if 1.0 - prev < 1e-6 {
            prev = 1.0;
        }
        *h = prev;
    }

    // The look-ahead ramp: the mean of `held` over [k, k + ahead], kept as a
    // running sum of *deficits* so that a window with none reads exactly 1.0
    // and the stretches the limiter never touched are left bit-exact.
    let deficit = |m: usize| 1.0 - held[m];
    let mut sum = 0.0;
    let mut active = 0usize;
    for m in 0..(ahead + 1).min(n) {
        sum += deficit(m);
        active += usize::from(deficit(m) != 0.0);
    }
    let mut gain = vec![1.0f64; n];
    for k in 0..n {
        if active > 0 {
            let len = ((k + ahead).min(n - 1) - k + 1) as f64;
            gain[k] = (1.0 - sum / len).min(need[k]);
        }
        sum -= deficit(k);
        active -= usize::from(deficit(k) != 0.0);
        if k + ahead + 1 < n {
            sum += deficit(k + ahead + 1);
            active += usize::from(deficit(k + ahead + 1) != 0.0);
        }
        if active == 0 {
            // Rounding in the running sum ends with the window's last deficit.
            sum = 0.0;
        }
    }
    Some(gain)
}

#[cfg(test)]
mod tests {
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
}
