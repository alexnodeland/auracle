//! `φ_audio`: perceptual descriptors of the normalized standard-phrase render.
//!
//! Computed on Hann-windowed frames (2048 samples, 50% hop) of the mono
//! render. Spectral features are frequency-normalized to `[0, 1]` by Nyquist
//! so the vector is sample-rate-agnostic; every field is finite by
//! construction (renders are vetted first). Deliberately compact (~12 dims) —
//! the taste model is a mixture of *linear* experts, and interpretable axes
//! ("bright", "noisy", "slow attack", "long tail") are the point.

use rustfft::num_complex::Complex;
use rustfft::FftPlanner;
use serde::{Deserialize, Serialize};

use crate::render::RenderedPhrase;

const FRAME: usize = 2048;
const HOP: usize = 1024;

/// Named perceptual descriptors. `to_vec` order matches [`AudioFeatures::NAMES`].
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct AudioFeatures {
    /// Mean spectral centroid (fraction of Nyquist) — brightness.
    pub centroid_mean: f64,
    /// Std of spectral centroid over frames — timbral movement.
    pub centroid_std: f64,
    /// Mean 85% spectral rolloff (fraction of Nyquist).
    pub rolloff_mean: f64,
    /// Mean spectral flatness (0 tonal … 1 noisy).
    pub flatness_mean: f64,
    /// Mean spectral flux — how fast the spectrum changes.
    pub flux_mean: f64,
    /// Mean zero-crossing rate (fraction of sample pairs).
    pub zcr_mean: f64,
    /// Mean frame RMS of the normalized render.
    pub rms_mean: f64,
    /// Std of frame RMS — dynamics/movement.
    pub rms_std: f64,
    /// Crest factor: peak / whole-phrase RMS.
    pub crest: f64,
    /// First-note attack time in seconds (onset → 90% of that note's peak RMS).
    pub attack_s: f64,
    /// Tail level: RMS of the final 300 ms relative to whole-phrase RMS —
    /// captures release length and delay/reverb tails.
    pub tail_ratio: f64,
    /// Low-band energy fraction (below ~250 Hz) — weight/sub character.
    pub bass_fraction: f64,
}

impl AudioFeatures {
    /// Feature names in `to_vec` order.
    pub const NAMES: [&'static str; 12] = [
        "centroid_mean",
        "centroid_std",
        "rolloff_mean",
        "flatness_mean",
        "flux_mean",
        "zcr_mean",
        "rms_mean",
        "rms_std",
        "crest",
        "attack_s",
        "tail_ratio",
        "bass_fraction",
    ];

    /// Flatten to a vector in [`Self::NAMES`] order.
    pub fn to_vec(&self) -> Vec<f64> {
        vec![
            self.centroid_mean,
            self.centroid_std,
            self.rolloff_mean,
            self.flatness_mean,
            self.flux_mean,
            self.zcr_mean,
            self.rms_mean,
            self.rms_std,
            self.crest,
            self.attack_s,
            self.tail_ratio,
            self.bass_fraction,
        ]
    }
}

/// Extract [`AudioFeatures`] from a (normalized) render.
pub fn audio_features(r: &RenderedPhrase) -> AudioFeatures {
    let x = &r.samples;
    let n = x.len();
    let sr = r.sample_rate;

    // --- time-domain ---
    let global_rms = (x.iter().map(|s| s * s).sum::<f64>() / n.max(1) as f64).sqrt();
    let peak = x.iter().fold(0.0f64, |p, s| p.max(s.abs()));
    let crest = peak / (global_rms + 1e-12);

    let tail_len = ((0.3 * sr) as usize).min(n);
    let tail_rms =
        (x[n - tail_len..].iter().map(|s| s * s).sum::<f64>() / tail_len.max(1) as f64).sqrt();
    let tail_ratio = tail_rms / (global_rms + 1e-12);

    // Attack: short-window RMS from the first onset to the start of the
    // second note (or end), time to reach 90% of that segment's max.
    let attack_s = {
        let start = r.note_onsets.first().copied().unwrap_or(0);
        let end = r.note_onsets.get(1).copied().unwrap_or(n).min(n);
        let win = (0.005 * sr) as usize; // 5 ms
        let seg = &x[start..end];
        let mut env = Vec::with_capacity(seg.len() / win.max(1) + 1);
        let mut i = 0;
        while i + win <= seg.len() {
            let w = &seg[i..i + win];
            env.push((w.iter().map(|s| s * s).sum::<f64>() / win as f64).sqrt());
            i += win;
        }
        let max = env.iter().cloned().fold(0.0f64, f64::max);
        let idx = env.iter().position(|&e| e >= 0.9 * max).unwrap_or(0);
        idx as f64 * win as f64 / sr
    };

    let zcr_mean = if n > 1 {
        x.windows(2)
            .filter(|w| (w[0] >= 0.0) != (w[1] >= 0.0))
            .count() as f64
            / (n - 1) as f64
    } else {
        0.0
    };

    // --- spectral, framewise ---
    let mut planner = FftPlanner::<f64>::new();
    let fft = planner.plan_fft_forward(FRAME);
    let hann: Vec<f64> = (0..FRAME)
        .map(|i| 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / FRAME as f64).cos())
        .collect();

    let bins = FRAME / 2;
    let bass_bin = (250.0 / (sr / 2.0) * bins as f64) as usize; // ≤ ~250 Hz

    let mut centroids = Vec::new();
    let mut rolloffs = Vec::new();
    let mut flatnesses = Vec::new();
    let mut fluxes = Vec::new();
    let mut frame_rms = Vec::new();
    let mut bass_energy = 0.0f64;
    let mut total_energy = 0.0f64;
    let mut prev_mag: Option<(Vec<f64>, f64)> = None;

    let mut pos = 0;
    while pos + FRAME <= n {
        let mut buf: Vec<Complex<f64>> = x[pos..pos + FRAME]
            .iter()
            .zip(&hann)
            .map(|(s, w)| Complex::new(s * w, 0.0))
            .collect();
        fft.process(&mut buf);
        let mag: Vec<f64> = buf[..bins].iter().map(|c| c.norm()).collect();
        let power: f64 = mag.iter().map(|m| m * m).sum();

        frame_rms
            .push((x[pos..pos + FRAME].iter().map(|s| s * s).sum::<f64>() / FRAME as f64).sqrt());

        if power > 1e-12 {
            let msum: f64 = mag.iter().sum();
            let centroid = mag
                .iter()
                .enumerate()
                .map(|(i, m)| i as f64 * m)
                .sum::<f64>()
                / msum
                / bins as f64;
            centroids.push(centroid);

            let target = 0.85 * power;
            let mut acc = 0.0;
            let mut roll = bins - 1;
            for (i, m) in mag.iter().enumerate() {
                acc += m * m;
                if acc >= target {
                    roll = i;
                    break;
                }
            }
            rolloffs.push(roll as f64 / bins as f64);

            // Flatness: geometric / arithmetic mean of the power spectrum.
            let log_mean = mag.iter().map(|m| (m * m + 1e-20).ln()).sum::<f64>() / bins as f64;
            let arith_mean = power / bins as f64;
            flatnesses.push((log_mean.exp() / (arith_mean + 1e-20)).min(1.0));

            bass_energy += mag[..bass_bin.min(bins)].iter().map(|m| m * m).sum::<f64>();
            total_energy += power;

            if let Some((prev, prev_msum)) = &prev_mag {
                // Normalize by the *combined* frame energy so flux stays in
                // ~[0, 1]: dividing by the current frame alone explodes when
                // a loud frame decays into near-silence.
                let flux: f64 = mag
                    .iter()
                    .zip(prev)
                    .map(|(a, b)| {
                        let d = a - b;
                        d * d
                    })
                    .sum::<f64>()
                    .sqrt()
                    / (msum + prev_msum + 1e-12);
                fluxes.push(flux);
            }
            prev_mag = Some((mag, msum));
        }
        pos += HOP;
    }

    let mean = |v: &[f64]| {
        if v.is_empty() {
            0.0
        } else {
            v.iter().sum::<f64>() / v.len() as f64
        }
    };
    let std = |v: &[f64]| {
        if v.len() < 2 {
            0.0
        } else {
            let m = mean(v);
            (v.iter().map(|x| (x - m) * (x - m)).sum::<f64>() / v.len() as f64).sqrt()
        }
    };

    AudioFeatures {
        centroid_mean: mean(&centroids),
        centroid_std: std(&centroids),
        rolloff_mean: mean(&rolloffs),
        flatness_mean: mean(&flatnesses),
        flux_mean: mean(&fluxes),
        zcr_mean,
        rms_mean: mean(&frame_rms),
        rms_std: std(&frame_rms),
        crest,
        attack_s,
        tail_ratio,
        bass_fraction: if total_energy > 0.0 {
            bass_energy / total_energy
        } else {
            0.0
        },
    }
}
