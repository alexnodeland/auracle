//! A sound's face: the spectrum of its render in 40 bands and 12 slices of
//! time, for the app to draw (Plan-005 task 3, RFC-006 §2).
//!
//! **A picture, not a feature.** Nothing here enters φ, the taste model or
//! the vetting gate, and nothing in φ reads it. It rides beside φ on
//! [`crate::CachedFeatures`] only because the featurization is the one place
//! every render passes through (the serial fill, the farm, a generation's
//! walks, an offer, an edit), so a face costs no render of its own.
//!
//! ## What is measured
//!
//! The render (mono, loudness-normalized, the buffer audition plays) in
//! Hann-windowed frames of 2048 samples, hop 1024:
//!
//! - **Bands:** [`FACE_BANDS`] bands evenly spaced in log frequency from
//!   [`FACE_LO_HZ`] to [`FACE_HI_HZ`] (about a fifth of an octave each).
//!   A band's value is the mean power *density* over its edges, each FFT bin
//!   counted by the fraction of its width inside the band. A band narrower
//!   than one bin (every band below about 150 Hz) therefore reads the bin it
//!   sits in rather than nothing, and white noise reads the same in every
//!   band.
//! - **Slices:** the render cut into [`FACE_SLICES`] equal spans of time; a
//!   frame belongs to the slice its center falls in. On the standard phrase
//!   (5.05 s) a slice is 0.42 s: five for the held C4, one for the C5 stab,
//!   two for the dyad, four for the low C3 and its release.
//! - **The long-term spectrum:** every frame's power averaged, in the same
//!   bands.
//!
//! Each spectrum is in dB relative to its own loudest band (so a face shows
//! shape, not level; the render is already loudness-normalized), floored at
//! [`FACE_FLOOR_DB`]. Each slice's loudness is in dB relative to the loudest
//! slice, with the same floor. Whitening against the bank (the bank's mean
//! per band and its spread) happens where the bank is known, in the app
//! (`apps/web/faces.js`).
//!
//! ## Encoding
//!
//! [`FACE_LEN`] bytes, each a level in [`FACE_STEP_DB`] steps above the
//! floor: the long-term spectrum (40), then the slices (12 × 40, slice by
//! slice, low band first), then the slices' loudness (12). It serializes as
//! one base64 string, about 700 bytes beside a φ row of about 1 KB.
//!
//! ## Determinism
//!
//! A face is a pure function of the samples. The analysis reads every sample
//! as the `f32` the audition buffer holds ([`crate::Audition`]), so the face
//! of the featurization's `f64` render and the face of the stored audition
//! are the same bytes.

use std::sync::Arc;

use rustfft::num_complex::Complex;
use rustfft::{Fft, FftPlanner};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Bands per spectrum.
pub const FACE_BANDS: usize = 40;
/// Slices of time per render.
pub const FACE_SLICES: usize = 12;
/// The lowest band's lower edge, in Hz.
pub const FACE_LO_HZ: f64 = 35.0;
/// The highest band's upper edge, in Hz.
pub const FACE_HI_HZ: f64 = 14_000.0;
/// The floor every level is clamped to, in dB re its reference.
pub const FACE_FLOOR_DB: f64 = -60.0;
/// One encoded step, in dB.
pub const FACE_STEP_DB: f64 = 0.5;
/// Encoded length in bytes: the long-term spectrum, the slices, their loudness.
pub const FACE_LEN: usize = FACE_BANDS + FACE_SLICES * FACE_BANDS + FACE_SLICES;

const FRAME: usize = 2048;
const HOP: usize = 1024;
/// Unnormalized windowed power below which a slice is silence (as in φ's
/// spectral frames, about −170 dBFS).
const SILENT_POWER: f64 = 1e-12;

thread_local! {
    /// The forward transform for [`FRAME`], planned once per thread.
    static PLAN: Arc<dyn Fft<f64>> = FftPlanner::<f64>::new().plan_fft_forward(FRAME);
}

/// A sound's face: its spectrum in bands and slices, encoded (see the module
/// docs). Compared by its bytes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Face {
    bytes: Vec<u8>,
}

impl Face {
    /// The face of `samples` (mono, at `sample_rate`), read as `f32`.
    pub fn of_f32(samples: &[f32], sample_rate: f64) -> Face {
        analyze(samples.len(), sample_rate, |i| samples[i] as f64)
    }

    /// The face of an `f64` render, each sample read as the `f32` its
    /// audition holds, so this equals [`Face::of_f32`] of the audition.
    pub fn of_f64(samples: &[f64], sample_rate: f64) -> Face {
        analyze(samples.len(), sample_rate, |i| samples[i] as f32 as f64)
    }

    /// A face from its encoding, if it is [`FACE_LEN`] bytes.
    pub fn from_bytes(bytes: Vec<u8>) -> Option<Face> {
        (bytes.len() == FACE_LEN).then_some(Face { bytes })
    }

    /// The encoding.
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    fn level(&self, i: usize) -> f64 {
        FACE_FLOOR_DB + self.bytes[i] as f64 * FACE_STEP_DB
    }

    /// The long-term spectrum, dB re its loudest band.
    pub fn ltas_db(&self) -> Vec<f64> {
        (0..FACE_BANDS).map(|b| self.level(b)).collect()
    }

    /// Slice `t`'s spectrum, dB re its own loudest band.
    pub fn slice_db(&self, t: usize) -> Vec<f64> {
        let at = FACE_BANDS + t * FACE_BANDS;
        (0..FACE_BANDS).map(|b| self.level(at + b)).collect()
    }

    /// Each slice's loudness, dB re the loudest slice.
    pub fn loud_db(&self) -> Vec<f64> {
        let at = FACE_BANDS + FACE_SLICES * FACE_BANDS;
        (0..FACE_SLICES).map(|t| self.level(at + t)).collect()
    }
}

/// The band edges, in Hz: `FACE_BANDS + 1` of them, evenly spaced in log
/// frequency.
pub fn band_edges_hz() -> Vec<f64> {
    let ratio = FACE_HI_HZ / FACE_LO_HZ;
    (0..=FACE_BANDS)
        .map(|k| FACE_LO_HZ * ratio.powf(k as f64 / FACE_BANDS as f64))
        .collect()
}

/// Each band's bins and the fraction of each bin's width inside it, divided
/// by the band's width in bins: summing `power[j] * w` gives the band's mean
/// power density.
fn band_weights(sample_rate: f64) -> Vec<Vec<(usize, f64)>> {
    let bin_hz = sample_rate / FRAME as f64;
    let last = FRAME / 2;
    let edges = band_edges_hz();
    (0..FACE_BANDS)
        .map(|b| {
            // In bins: bin j covers [j - 0.5, j + 0.5).
            let lo = edges[b] / bin_hz;
            let hi = (edges[b + 1] / bin_hz).min(last as f64 + 0.5);
            let width = (hi - lo).max(f64::MIN_POSITIVE);
            let first = (lo + 0.5).floor().max(0.0) as usize;
            let end = ((hi + 0.5).ceil() as usize).min(last + 1);
            (first..end)
                .filter_map(|j| {
                    let a = lo.max(j as f64 - 0.5);
                    let z = hi.min(j as f64 + 0.5);
                    (z > a).then(|| (j, (z - a) / width))
                })
                .collect()
        })
        .collect()
}

fn db(x: f64) -> f64 {
    10.0 * (x + 1e-30).log10()
}

fn encode(level_db: f64) -> u8 {
    ((level_db - FACE_FLOOR_DB) / FACE_STEP_DB)
        .round()
        .clamp(0.0, 255.0) as u8
}

/// Band densities of a mean power spectrum, in dB re the loudest band; all
/// floor when the spectrum is silence.
fn shape(power: &[f64], weights: &[Vec<(usize, f64)>], frames: usize) -> [u8; FACE_BANDS] {
    let mut out = [0u8; FACE_BANDS];
    let total: f64 = power.iter().sum();
    if frames == 0 || total / (frames as f64) < SILENT_POWER {
        return out;
    }
    let bands: Vec<f64> = weights
        .iter()
        .map(|w| db(w.iter().map(|(j, f)| power[*j] * f).sum::<f64>()))
        .collect();
    let peak = bands.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    for (o, v) in out.iter_mut().zip(&bands) {
        *o = encode(v - peak);
    }
    out
}

/// Summed power per FFT bin, per slice, and how many frames each slice got:
/// Hann frames of [`FRAME`], hop [`HOP`], each in the slice its center falls
/// in.
fn slice_power(n: usize, sample: impl Fn(usize) -> f64) -> (Vec<Vec<f64>>, [usize; FACE_SLICES]) {
    let bins = FRAME / 2 + 1;
    let hann: Vec<f64> = (0..FRAME)
        .map(|i| 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / FRAME as f64).cos())
        .collect();
    let fft = PLAN.with(Arc::clone);
    // Summed power per bin, per slice, and how many frames each slice got.
    let mut acc = vec![vec![0.0f64; bins]; FACE_SLICES];
    let mut frames = [0usize; FACE_SLICES];
    let mut buf = vec![Complex::new(0.0, 0.0); FRAME];
    let mut pos = 0usize;
    // A render shorter than one frame is read as one frame, zero-padded.
    while pos < n.max(1) && (pos + FRAME <= n || pos == 0) {
        for (i, c) in buf.iter_mut().enumerate() {
            let s = if pos + i < n { sample(pos + i) } else { 0.0 };
            *c = Complex::new(s * hann[i], 0.0);
        }
        fft.process(&mut buf);
        let center = (pos + FRAME / 2).min(n.saturating_sub(1));
        let t = (center * FACE_SLICES / n.max(1)).min(FACE_SLICES - 1);
        for (a, c) in acc[t].iter_mut().zip(&buf[..bins]) {
            *a += c.norm_sqr();
        }
        frames[t] += 1;
        pos += HOP;
    }
    (acc, frames)
}

fn analyze(n: usize, sample_rate: f64, sample: impl Fn(usize) -> f64) -> Face {
    let bins = FRAME / 2 + 1;
    let (acc, frames) = slice_power(n, sample);
    let weights = band_weights(sample_rate);
    let mut bytes = Vec::with_capacity(FACE_LEN);
    // The long-term spectrum: every frame's power, averaged.
    let all_frames: usize = frames.iter().sum();
    let ltas: Vec<f64> = (0..bins)
        .map(|j| acc.iter().map(|s| s[j]).sum::<f64>() / all_frames.max(1) as f64)
        .collect();
    bytes.extend_from_slice(&shape(&ltas, &weights, all_frames));
    let means: Vec<Vec<f64>> = acc
        .iter()
        .zip(&frames)
        .map(|(s, &f)| s.iter().map(|p| p / f.max(1) as f64).collect())
        .collect();
    for (m, &f) in means.iter().zip(&frames) {
        bytes.extend_from_slice(&shape(m, &weights, f));
    }
    // Each slice's loudness, re the loudest slice.
    let level: Vec<Option<f64>> = means
        .iter()
        .zip(&frames)
        .map(|(m, &f)| {
            let p: f64 = m.iter().sum();
            (f > 0 && p >= SILENT_POWER).then(|| db(p))
        })
        .collect();
    let loudest = level
        .iter()
        .flatten()
        .cloned()
        .fold(f64::NEG_INFINITY, f64::max);
    bytes.extend(level.iter().map(|l| match l {
        Some(v) => encode(v - loudest),
        None => 0,
    }));
    debug_assert_eq!(bytes.len(), FACE_LEN);
    Face { bytes }
}

// ---- serialization: one base64 string ----

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn b64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let v = (chunk[0] as u32) << 16
            | (*chunk.get(1).unwrap_or(&0) as u32) << 8
            | *chunk.get(2).unwrap_or(&0) as u32;
        for k in 0..4 {
            if k <= chunk.len() {
                out.push(B64[(v >> (18 - 6 * k) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn b64_decode(text: &str) -> Option<Vec<u8>> {
    let digit = |c: u8| B64.iter().position(|&d| d == c).map(|p| p as u32);
    let raw = text.trim_end_matches('=').as_bytes();
    let mut out = Vec::with_capacity(raw.len() * 3 / 4);
    for chunk in raw.chunks(4) {
        if chunk.len() == 1 {
            return None;
        }
        let mut v = 0u32;
        for (k, &c) in chunk.iter().enumerate() {
            v |= digit(c)? << (18 - 6 * k);
        }
        for k in 0..chunk.len() - 1 {
            out.push((v >> (16 - 8 * k) & 255) as u8);
        }
    }
    Some(out)
}

impl Serialize for Face {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&b64_encode(&self.bytes))
    }
}

impl<'de> Deserialize<'de> for Face {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let text = String::deserialize(d)?;
        b64_decode(&text)
            .and_then(Face::from_bytes)
            .ok_or_else(|| serde::de::Error::custom("not a face"))
    }
}

#[cfg(test)]
mod tests;
