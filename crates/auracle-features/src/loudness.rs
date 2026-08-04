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
    /// Gain in dB (clamped to [`MAX_GAIN_DB`]).
    pub gain_db: f64,
}

/// Maximum boost applied during normalization — a very quiet patch is a vet
/// problem, not something to amplify by 60 dB.
pub const MAX_GAIN_DB: f64 = 30.0;

/// Normalize `samples` in place to the target integrated loudness.
/// Returns `None` (leaving samples untouched) when the signal is gated silent.
pub fn normalize_to(samples: &mut [f64], sample_rate: f64, target_lufs: f64) -> Option<NormReport> {
    let lufs = integrated_lufs(samples, sample_rate)?;
    let gain_db = (target_lufs - lufs).min(MAX_GAIN_DB);
    let gain = 10f64.powf(gain_db / 20.0);
    for s in samples.iter_mut() {
        *s *= gain;
    }
    Some(NormReport {
        lufs_before: lufs,
        gain,
        gain_db,
    })
}
