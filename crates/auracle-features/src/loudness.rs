//! ITU-R BS.1770-style loudness measurement and normalization (mono).
//!
//! Why LUFS and not plain RMS: preference data is poisoned by loudness —
//! louder reliably wins A/B tests — so candidates must be matched on
//! *perceived* loudness before audition and feature extraction. K-weighting
//! (a high-shelf boost above ~1.7 kHz plus a ~38 Hz highpass) approximates
//! the ear's sensitivity, and 400 ms gated blocks keep silence and release
//! tails from dragging the measurement down.
//!
//! The filter coefficients are derived parametrically (RBJ bilinear
//! transform) from the BS.1770 analog prototype — the same approach
//! pyloudnorm uses — so any sample rate works, matching the spec's published
//! 48 kHz coefficients at 48 kHz.
//!
//! ## Loudness is a target, not a promise: the peak wins
//!
//! Matching integrated loudness says nothing about the peak. Crest factor
//! varies by tens of dB across this grammar — a pad and a pluck at the same
//! LUFS are nowhere near the same peak — so normalizing to a target level
//! sends percussive patches well over full scale. Measured over 150 vetted
//! prior draws before [`PEAK_CEILING`] existed: **15 % of renders peaked above
//! 1.0 and 8 % above 1.25** (which is where the app's `master.gain = 0.8`
//! clips), with a worst case of **4.06** — 12 dB over.
//!
//! That is not a cosmetic defect. Preference data is elicited on this exact
//! buffer, so a clipped audition collects a vote about *clipping* rather than
//! about the patch — which is precisely the confound loudness normalization
//! exists to remove, one stage later and silent. The live voice was never
//! exposed to it (`auracle_wasm::live`'s master limiter has always held a 0.98
//! ceiling); the offline path took the volt divisor and not the limiter.
//!
//! **The fix is a smaller gain, not a limiter.** [`normalize_to`] gives up
//! whatever makeup it has to for the peak to clear [`PEAK_CEILING`], and
//! reports how much in [`NormReport::peak_reduction_db`]. A limiter would hold
//! the loudness target but reshape the waveform, which moves `crest`,
//! `flatness_mean` and `flux_mean` as well as the RMS pair, and would need a
//! second copy of itself inside
//! [`render_playback`](crate::render::render_playback) kept in lockstep
//! forever. A scalar keeps that replay bit-identical **by construction** and
//! cannot change timbre at all.
//!
//! What it costs, stated plainly: the ~15 % of patches that hit the ceiling
//! sit *below* the loudness target, so they audition quieter than the rest.
//! Loudness matching degrades exactly where crest is highest. That is the
//! right trade — quieter is a smaller bias on a preference judgment than
//! clipped — but it is a trade, and `peak_reduction_db` is on the record so a
//! surface can say "pulled down 3.2 dB so it would not clip" instead of
//! pretending the patch was simply quiet.

/// A biquad in direct form 1.
#[derive(Clone, Copy, Debug)]
struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
}

impl Biquad {
    fn process(self, x: &mut [f64]) {
        let (mut x1, mut x2, mut y1, mut y2) = (0.0, 0.0, 0.0, 0.0);
        for s in x.iter_mut() {
            let x0 = *s;
            let y0 = self.b0 * x0 + self.b1 * x1 + self.b2 * x2 - self.a1 * y1 - self.a2 * y2;
            x2 = x1;
            x1 = x0;
            y2 = y1;
            y1 = y0;
            *s = y0;
        }
    }
}

/// BS.1770 stage 1: high-shelf (+3.99984 dB above ~1681.97 Hz, Q 0.70718).
fn k_shelf(fs: f64) -> Biquad {
    let (g_db, q, fc) = (
        3.999_843_853_973_347,
        0.707_175_236_955_419_6,
        1_681.974_450_955_533,
    );
    let k = (std::f64::consts::PI * fc / fs).tan();
    let vh = 10f64.powf(g_db / 20.0);
    let vb = vh.powf(0.499_666_774_155);
    let a0 = 1.0 + k / q + k * k;
    Biquad {
        b0: (vh + vb * k / q + k * k) / a0,
        b1: 2.0 * (k * k - vh) / a0,
        b2: (vh - vb * k / q + k * k) / a0,
        a1: 2.0 * (k * k - 1.0) / a0,
        a2: (1.0 - k / q + k * k) / a0,
    }
}

/// BS.1770 stage 2: highpass (~38.135 Hz, Q 0.50033).
fn k_highpass(fs: f64) -> Biquad {
    let (q, fc) = (0.500_327_037_323_877_3, 38.135_470_876_024_44);
    let k = (std::f64::consts::PI * fc / fs).tan();
    let a0 = 1.0 + k / q + k * k;
    Biquad {
        b0: 1.0 / a0,
        b1: -2.0 / a0,
        b2: 1.0 / a0,
        a1: 2.0 * (k * k - 1.0) / a0,
        a2: (1.0 - k / q + k * k) / a0,
    }
}

/// Gated integrated loudness in LUFS. `None` when no block clears the
/// −70 LUFS absolute gate (i.e. the signal is effectively silent).
pub fn integrated_lufs(samples: &[f64], sample_rate: f64) -> Option<f64> {
    let block = (0.4 * sample_rate) as usize; // 400 ms
    let step = block / 4; // 75% overlap
    if samples.len() < block || block == 0 {
        return None;
    }

    // K-weight a copy.
    let mut w = samples.to_vec();
    k_shelf(sample_rate).process(&mut w);
    k_highpass(sample_rate).process(&mut w);

    // Block loudnesses.
    let block_loudness: Vec<f64> = w
        .windows(block)
        .step_by(step)
        .map(|b| {
            let ms = b.iter().map(|s| s * s).sum::<f64>() / b.len() as f64;
            -0.691 + 10.0 * (ms + 1e-30).log10()
        })
        .collect();

    // Absolute gate at −70 LUFS.
    let abs_gated: Vec<f64> = block_loudness
        .iter()
        .copied()
        .filter(|l| *l > -70.0)
        .collect();
    if abs_gated.is_empty() {
        return None;
    }
    let mean_energy = |ls: &[f64]| {
        ls.iter()
            .map(|l| 10f64.powf((l + 0.691) / 10.0))
            .sum::<f64>()
            / ls.len() as f64
    };
    // Relative gate 10 LU below the absolute-gated mean.
    let rel_threshold = -0.691 + 10.0 * mean_energy(&abs_gated).log10() - 10.0;
    let rel_gated: Vec<f64> = abs_gated
        .into_iter()
        .filter(|l| *l > rel_threshold)
        .collect();
    if rel_gated.is_empty() {
        return None;
    }
    Some(-0.691 + 10.0 * mean_energy(&rel_gated).log10())
}

/// Result of loudness normalization.
#[derive(Clone, Copy, Debug)]
pub struct NormReport {
    /// Integrated loudness before normalization.
    pub lufs_before: f64,
    /// Linear gain applied.
    pub gain: f64,
    /// Gain in dB, after both [`MAX_GAIN_DB`] and the [`PEAK_CEILING`] cap.
    /// This is the number [`crate::render::render_playback`] replays.
    pub gain_db: f64,
    /// Peak absolute sample *before* the gain was applied.
    pub peak_before: f64,
    /// How much makeup gain was given up so the peak would clear
    /// [`PEAK_CEILING`], in dB — always ≥ 0. Zero means the loudness target
    /// was reached outright, which is the common case; a positive value means
    /// this patch auditions below target because it is too peaky to reach it.
    pub peak_reduction_db: f64,
}

/// Maximum boost applied during normalization — a very quiet patch is a vet
/// problem, not something to amplify by 60 dB.
pub const MAX_GAIN_DB: f64 = 30.0;

/// Peak ceiling of the normalized buffer, in the nominal ±1.0 float domain.
///
/// Full scale, not a dB of headroom below it, because there is already margin
/// downstream: every audible path runs through the app's `master.gain = 0.8`
/// (≈1.9 dB), which is what absorbs the intersample peaks a resampling output
/// device can produce from a buffer that is exactly at 1.0. Taking the margin
/// once, downstream, rather than twice keeps this constant meaning the one
/// thing it says — *no sample leaves here above full scale* — and keeps the
/// loudness the trade is paid out of as high as it can be.
pub const PEAK_CEILING: f64 = 1.0;

/// Normalize `samples` in place toward the target integrated loudness, never
/// exceeding [`PEAK_CEILING`].
///
/// Returns `None` (leaving samples untouched) when the signal is gated silent.
pub fn normalize_to(samples: &mut [f64], sample_rate: f64, target_lufs: f64) -> Option<NormReport> {
    let lufs = integrated_lufs(samples, sample_rate)?;
    let wanted_db = (target_lufs - lufs).min(MAX_GAIN_DB);

    // The peak is measured *before* the gain, so the headroom below is exactly
    // the gain at which the loudest sample lands on the ceiling. Guarded on
    // `peak > 0` rather than assumed: a buffer of exact zeros cannot reach the
    // loudness gate above, but nothing here should depend on that reasoning
    // holding somewhere else.
    let peak_before = samples.iter().fold(0.0f64, |p, s| p.max(s.abs()));
    let gain_db = if peak_before > 0.0 {
        let headroom_db = 20.0 * (PEAK_CEILING / peak_before).log10();
        wanted_db.min(headroom_db)
    } else {
        wanted_db
    };
    // Measured against what *loudness* wanted, not against unity: a patch that
    // was already over the ceiling and also needed attenuating to reach the
    // target reports only the extra the ceiling took, because the rest was
    // going to happen anyway. Non-negative by construction — `gain_db` is a
    // `min` of `wanted_db` — so this is a subtraction, not a clamp.
    let peak_reduction_db = wanted_db - gain_db;

    let gain = 10f64.powf(gain_db / 20.0);
    for s in samples.iter_mut() {
        *s *= gain;
    }
    Some(NormReport {
        lufs_before: lufs,
        gain,
        gain_db,
        peak_before,
        peak_reduction_db,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A phrase-length buffer at `amp`, with one sample spiked to `peak` — a
    /// crest factor built to order.
    fn peaky(amp: f64, peak: f64, sr: f64) -> Vec<f64> {
        let n = (2.0 * sr) as usize;
        // A 220 Hz sine, so the K-weighted loudness is a real measurement
        // rather than an artifact of a square or of DC.
        let mut v: Vec<f64> = (0..n)
            .map(|i| amp * (std::f64::consts::TAU * 220.0 * i as f64 / sr).sin())
            .collect();
        v[n / 2] = peak;
        v
    }

    /// **The defect, as a number.** A quiet, very peaky render asks for tens of
    /// dB of makeup; without the ceiling it gets it, and the audition arrives
    /// over full scale. The measured worst case over 150 prior draws was 4.06.
    #[test]
    fn a_peaky_render_never_leaves_above_full_scale() {
        let sr = 44_100.0;
        let mut x = peaky(0.02, 0.5, sr);
        let r = normalize_to(&mut x, sr, -18.0).expect("not silent");
        let peak = x.iter().fold(0.0f64, |p, s| p.max(s.abs()));
        assert!(
            peak <= PEAK_CEILING + 1e-12,
            "normalized peak {peak} is over the ceiling"
        );
        // …and it says so, rather than reading as a patch that is simply quiet.
        assert!(
            r.peak_reduction_db > 0.0,
            "the ceiling bound the gain but reported no reduction"
        );
    }

    /// **An ordinary render must come out exactly as it did before the ceiling
    /// existed.** The ceiling is a fault stop, not a level policy: if it moved
    /// the gain of a patch that was never going to clip, it would be quietly
    /// re-levelling the whole pool and every audio feature that is not
    /// scale-invariant with it.
    #[test]
    fn a_render_with_headroom_is_untouched_by_the_ceiling() {
        let sr = 44_100.0;
        let mut x = peaky(0.1, 0.1, sr); // crest ≈ √2, nothing to catch
        let r = normalize_to(&mut x, sr, -18.0).expect("not silent");
        assert_eq!(r.peak_reduction_db, 0.0, "the ceiling bound a clean render");
        assert_eq!(
            r.gain_db,
            (-18.0 - r.lufs_before).min(MAX_GAIN_DB),
            "gain moved on a render that had headroom"
        );
    }

    /// A render that is *already* over the ceiling and also over the loudness
    /// target is attenuated by the loudness target, and the ceiling claims no
    /// credit for it. The naive `wanted − got` would report a reduction here
    /// and make every loud patch look peak-limited.
    #[test]
    fn attenuation_the_loudness_target_asked_for_is_not_charged_to_the_ceiling() {
        let sr = 44_100.0;
        let mut x = peaky(0.9, 0.95, sr); // loud, but crest ≈ 1.5
        let r = normalize_to(&mut x, sr, -18.0).expect("not silent");
        assert!(r.gain_db < 0.0, "a loud render should be attenuated");
        assert_eq!(
            r.peak_reduction_db, 0.0,
            "loudness attenuation was charged to the peak ceiling"
        );
    }
}
