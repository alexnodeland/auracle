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
//! patches (plucks, by up to 11 dB) and the second binds on 13 % (slow swells
//! that have barely begun by the end of the phrase, sub-bass, near-silent
//! bells, by up to 19 dB).
//!
//! [`audition_pcm`] multiplies that shortfall back in and then runs a
//! true-peak limiter, which is exactly the trade `loudness` could not make:
//! playback is allowed to reshape the transients φ never sees. What was pulled
//! down to clear the ceiling comes back at the target with its peaks held at
//! full scale; what the 30 dB cap stopped short comes back with headroom to
//! spare and is not limited at all. A render that needs neither is returned
//! bit-for-bit as stored, which is most of the pool.
//!
//! ## The live voice: the makeup loudness asked for
//!
//! [`Level::live_makeup`] is `TARGET_LUFS − lufs_before`, the gain that brings
//! the phrase to the target before *either* bound. It used to be the audition's
//! own gain clamped to ±12 dB, which left 43 % of a fresh pool outside the
//! clamp and a quarter of it ten or more LU under target at the keys. Neither
//! bound belongs on this path: the live voice has a brickwall on the summed
//! polyphony for peaks, and a leveler in front of it for held loudness (see
//! `live`), so what the phrase cannot predict about a note held longer than
//! the phrase is caught where it happens rather than guessed at here.

use auracle_features::{Audition, Features, PEAK_CEILING, TARGET_LUFS};

use crate::live::{MAKEUP_MAX_DB, MAKEUP_MIN_DB};

/// The two numbers playback needs from a featurization: how loud the raw
/// render was, and the gain the stored audition already carries.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Level {
    /// Integrated loudness of the raw render, LUFS.
    lufs_before: f64,
    /// Gain `featurize` applied to the stored audition, dB, after both bounds.
    gain_db: f64,
}

impl Level {
    /// Nothing measured yet: unity makeup live, nothing to give back.
    pub(crate) const UNMEASURED: Level = Level {
        lufs_before: TARGET_LUFS,
        gain_db: 0.0,
    };

    pub(crate) fn of(f: &Features) -> Level {
        Level {
            lufs_before: f.lufs_before,
            gain_db: f.gain_db,
        }
    }

    /// The makeup loudness alone asks for: what brings the phrase to
    /// [`TARGET_LUFS`], before the peak ceiling or the 30 dB cap.
    fn wanted_db(self) -> f64 {
        TARGET_LUFS - self.lufs_before
    }

    /// How far under [`TARGET_LUFS`] the stored audition sits, dB (≥ 0): what
    /// the two bounds took. Scaling a buffer moves its integrated loudness by
    /// exactly the gain, so this is a subtraction, not a measurement.
    fn shortfall_db(self) -> f64 {
        (self.wanted_db() - self.gain_db).max(0.0)
    }

    /// The live voice's makeup, linear, within what `LivePoly::set_makeup`
    /// accepts.
    pub(crate) fn live_makeup(self) -> f64 {
        10f64.powf(self.wanted_db().clamp(MAKEUP_MIN_DB, MAKEUP_MAX_DB) / 20.0)
    }
}

/// Ceiling of every audition as played, as a **true** peak: full scale, the
/// stored buffer's own [`PEAK_CEILING`], now held between the samples as well
/// as on them. Nothing leaves here hotter than the stored audition was allowed
/// to be, so the app's master gain keeps exactly the margin it had.
const AUDITION_CEILING: f64 = PEAK_CEILING;

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

/// The audition as it should be played: the stored buffer with the makeup the
/// normalizer gave up multiplied back in, then held under [`AUDITION_CEILING`]
/// by a true-peak limiter.
///
/// The one consumer of a stored audition on its way to WebAudio (`render_of`,
/// `edit_render`, `preview_op`). Returns the stored samples unchanged when
/// there is nothing to give back and nothing to limit.
pub(crate) fn audition_pcm(a: &Audition, level: Level) -> Vec<f32> {
    let restore = 10f64.powf(level.shortfall_db() / 20.0);
    let x: Vec<f64> = a.samples.iter().map(|&s| f64::from(s) * restore).collect();
    match limiter_gain(&x, a.sample_rate) {
        None => x.iter().map(|&s| s as f32).collect(),
        Some(g) => x.iter().zip(&g).map(|(s, g)| (s * g) as f32).collect(),
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

    fn level(lufs_before: f64, gain_db: f64) -> Level {
        Level {
            lufs_before,
            gain_db,
        }
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

    /// The common case has to cost nothing: a render the normalizer took to
    /// the target, with headroom, is played exactly as it is stored.
    #[test]
    fn a_render_at_target_with_headroom_plays_bit_for_bit() {
        let stored = audition(pluck(0.5));
        let played = audition_pcm(&stored, level(-30.0, 12.0));
        assert_eq!(played, stored.samples);
    }

    /// **The defect, fixed.** A peaky render the ceiling held ~10 dB short
    /// comes back louder and still never leaves above full scale — between
    /// the samples included, read by a meter the limiter does not share. Past
    /// the limiter's reach the whole shortfall is back, sample for sample; on
    /// the onset the limiter takes what the ceiling demands, which for this
    /// fixture (a 4 ms click carrying most of its energy) is half of it.
    #[test]
    fn a_peak_cut_render_comes_back_louder_and_under_the_ceiling() {
        use auracle_features::integrated_lufs;
        // Normalize the way `normalize_to` does: to the target, then back off
        // whatever the ceiling demands.
        let raw = pluck(1.0);
        let lufs = integrated_lufs(&raw, SR).expect("not silent");
        let peak = raw.iter().fold(0.0f64, |m, s| m.max(s.abs()));
        let wanted = TARGET_LUFS - lufs;
        let gain_db = wanted.min(20.0 * (PEAK_CEILING / peak).log10());
        let short = wanted - gain_db;
        assert!(short > 3.0, "the fixture is not peaky enough");
        let g = 10f64.powf(gain_db / 20.0);
        let stored = audition(raw.iter().map(|s| s * g).collect());

        let played = audition_pcm(&stored, level(lufs, gain_db));
        let tp = true_peak_16x(&played, 0, played.len());
        assert!(tp <= AUDITION_CEILING * 1.005, "true peak {tp:.4} over the ceiling");
        let played_f64: Vec<f64> = played.iter().map(|s| f64::from(*s)).collect();
        let heard = integrated_lufs(&played_f64, SR).expect("not silent");
        assert!(
            heard > lufs + gain_db + short / 3.0,
            "{short:.1} dB short; played at {heard:.1} LUFS from {:.1}",
            lufs + gain_db
        );
        // A second in, the release has long finished: the shortfall, exactly.
        let restore = 10f64.powf(short / 20.0);
        for (p, s) in played.iter().zip(&stored.samples).skip(SR as usize) {
            assert_eq!(*p, (f64::from(*s) * restore) as f32);
        }
    }

    /// What the 30 dB cap stopped short is only multiplied back — there is
    /// headroom, so nothing is limited and the waveform is the stored one,
    /// louder.
    #[test]
    fn a_render_the_gain_cap_stopped_short_is_scaled_not_limited() {
        let stored = audition(pluck(0.01));
        let played = audition_pcm(&stored, level(-60.0, 30.0)); // 12 dB short
        let g = 10f64.powf(12.0 / 20.0);
        for (p, s) in played.iter().zip(&stored.samples) {
            assert_eq!(*p, (f64::from(*s) * g) as f32);
        }
    }

    /// A buffer whose samples are all under full scale can still overshoot it
    /// between them; the limiter reads those points too.
    #[test]
    fn an_intersample_over_is_caught() {
        // fs/4 at 45°: every sample is ±0.707·A, the waveform between them
        // peaks at A.
        let a = 1.3;
        let x: Vec<f64> = (0..(0.5 * SR) as usize)
            .map(|i| a * (std::f64::consts::FRAC_PI_2 * i as f64 + std::f64::consts::FRAC_PI_4).sin())
            .collect();
        let stored = audition(x);
        assert!(stored.samples.iter().all(|s| s.abs() < 1.0));
        let played = audition_pcm(&stored, Level::UNMEASURED);
        // The interior: the fixture starts and stops at full amplitude, which
        // no audition does (every one opens and closes on silence).
        let tp = true_peak_16x(&played, 2_000, played.len() - 2_000);
        assert!(tp <= AUDITION_CEILING * 1.005, "true peak {tp:.4} over the ceiling");
    }

    /// The live makeup is what loudness asked for — no ±12 dB clamp, no peak
    /// ceiling, no 30 dB cap — and nothing measured means unity.
    #[test]
    fn live_makeup_is_the_loudness_makeup() {
        let db = |l: Level| 20.0 * l.live_makeup().log10();
        assert!((db(level(-48.0, 12.0)) - 30.0).abs() < 1e-9);
        assert!((db(level(-60.0, 30.0)) - 42.0).abs() < 1e-9);
        assert!((db(level(-2.0, -16.0)) + 16.0).abs() < 1e-9);
        assert_eq!(Level::UNMEASURED.live_makeup(), 1.0);
        assert_eq!(Level::UNMEASURED.shortfall_db(), 0.0);
        assert!((db(level(-200.0, 30.0)) - MAKEUP_MAX_DB).abs() < 1e-9);
    }
}
