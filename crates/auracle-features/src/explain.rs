//! What a control does to a sound, measured: a portrait of one render, for
//! the app's figures (Plan-005 task 10, RFC-006 §9).
//!
//! **A picture, not a feature.** Nothing here enters φ, the taste model or the
//! vetting gate. A PERFORM control is a direction in φ (`perform::PALETTE`),
//! so what it does to a sound is what moves in the measurements φ is made of;
//! the app renders the sound twice (the control at its centre and turned) and
//! draws each portrait's view of the coordinates that control listens to:
//!
//! - **bands**: the long-term spectrum in [`BANDS`] bands, evenly spaced in
//!   log frequency from [`LO_HZ`] to [`HI_HZ`] (the layout of a sound's face,
//!   `face.rs` once faces land), each the mean power density over its edges,
//!   in dB re the loudest band. What Bright, Warmth, Air and Body move.
//! - **held**: the held note's spectrum, bin by bin up to [`HELD_HI_HZ`], in
//!   dB re its loudest bin: its harmonics and what lies between them. What
//!   Grit, Bite and Lo-fi move (flatness is noise filling those gaps).
//! - **onset**: the first note's level in φ's attack windows (4 ms), every
//!   [`ONSET_STEP_S`] for [`ONSET_S`], re that note's peak. What Snap and
//!   Round move (φ's `attack_s` is the 90% crossing of this envelope).
//! - **level**: the phrase's level every [`LEVEL_STEP_S`], in dB re the whole
//!   phrase's RMS, with the notes' gates. What Space, Distance and Haze move
//!   (φ's `tail_ratio` is the last 300 ms against the whole), and Punch,
//!   Thump and Heft (its peaks and how full it stays).
//! - **bright** and **loud**: the held note's brightness (spectral centroid,
//!   Hz) and level (dB re its loudest frame) frame by frame, the two
//!   trajectories φ's motion bands are measured on. What Motion, Throb and
//!   Sway move.
//! - **facts**: φ's own coordinates for this render, in their units (Hz, ms,
//!   dB, %), for the figure's sentence.
//!
//! Every value is measured on the normalized render (`featurize`'s, the
//! buffer an audition plays), so two portraits compare as the model hears
//! the two renders: loudness matched, shape against shape.

use std::sync::Arc;

use rustfft::num_complex::Complex;
use rustfft::{Fft, FftPlanner};
use serde::Serialize;

use crate::audio::AudioFeatures;
use crate::face::Face;
use crate::render::RenderedPhrase;

/// Bands of the long-term spectrum.
/// A face's bands ([`crate::face`]): one definition, so a figure's spectrum
/// and the sound's face line up band for band.
pub const BANDS: usize = crate::face::FACE_BANDS;
/// The lowest band's lower edge, Hz (a face's).
pub const LO_HZ: f64 = crate::face::FACE_LO_HZ;
/// The highest band's upper edge, Hz (a face's).
pub const HI_HZ: f64 = crate::face::FACE_HI_HZ;
/// The floor every spectrum level is clamped to, dB re its reference (a
/// face's).
pub const FLOOR_DB: f64 = crate::face::FACE_FLOOR_DB;
/// The held note's spectrum is kept up to here: C4's first fifteen
/// harmonics, where a 2048-sample frame resolves each from the next.
pub const HELD_HI_HZ: f64 = 4_000.0;
/// The onset envelope's span and step, seconds.
pub const ONSET_S: f64 = 0.4;
pub const ONSET_STEP_S: f64 = 0.002;
/// φ's attack window (`audio.rs` `ENV_WIN_S`).
const ONSET_WIN_S: f64 = 0.004;
/// The phrase level's step (and window), seconds.
pub const LEVEL_STEP_S: f64 = 0.05;
/// φ's tail window (`audio.rs`, `tail_ratio`).
pub const TAIL_S: f64 = 0.3;

const FRAME: usize = 2048;
/// The spectra's hop, as φ's spectral frames.
const HOP: usize = 1024;
/// The held-note tracks' hop: ~86 frames a second at 44.1 kHz, enough to
/// draw a tremolo of 8 Hz with ten points a cycle.
const TRACK_HOP: usize = 512;
/// Unnormalized windowed power below which a frame is silence (φ's).
const SILENT_POWER: f64 = 1e-12;

thread_local! {
    static PLAN: Arc<dyn Fft<f64>> = FftPlanner::<f64>::new().plan_fft_forward(FRAME);
}

/// φ's coordinates for one render, in the units a sentence can say.
#[derive(Clone, Debug, Serialize)]
pub struct Facts {
    /// `centroid_mean`: where the spectrum's centre sits, Hz (the geometric
    /// mean over frames, since φ averages it on a log axis).
    pub centroid_hz: f64,
    /// `rolloff_mean`: below this, 85% of the energy, Hz.
    pub rolloff_hz: f64,
    /// `zcr_mean`: the zero-crossing rate as a frequency, Hz.
    pub zcr_hz: f64,
    /// `flatness_mean`: 0 a pure tone, 1 white noise.
    pub flatness: f64,
    /// `flux_mean`: how fast the spectrum changes, 0 to 1.
    pub flux: f64,
    /// `attack_s`: the first note's onset to 90% of its peak, ms.
    pub attack_ms: f64,
    /// `crest`: the peak over the phrase's RMS, dB.
    pub crest_db: f64,
    /// `rms_mean`: the frames' mean level, dBFS.
    pub level_db: f64,
    /// `rms_std` over `rms_mean`: how much the level moves, as a fraction.
    pub swing: f64,
    /// `tail_ratio`: the last 300 ms against the whole phrase, dB.
    pub tail_db: f64,
    /// `bass_fraction`: the share of energy below about 250 Hz, %.
    pub bass_pct: f64,
    /// `high_ratio`: the highest note against the held one, dB.
    pub high_db: f64,
    /// `held_centroid_std`: how far the held note's brightness wanders,
    /// octaves (φ keeps it on its log axis, where one unit is the whole span
    /// from 20 Hz to Nyquist, about 10.1 octaves at 44.1 kHz).
    pub held_move_oct: f64,
    /// `motion_slow`, `motion_mid`, `motion_fast`: the held note's movement
    /// at 0.5–2, 2–8 and 8–30 Hz, each `2^x` of φ's `0.5·log2` of a
    /// variance: a standard deviation over brightness in octaves and level in
    /// doublings (6 dB) together, floored at 0.01 (`MOTION_VAR_FLOOR`), which
    /// is "no movement".
    pub motion_oct: [f64; 3],
}

impl Facts {
    /// The facts φ holds for a render at `sample_rate`.
    pub fn of(phi: &AudioFeatures, sample_rate: f64) -> Facts {
        let nyquist = sample_rate / 2.0;
        // `audio::log_axis` inverted: octaves above 20 Hz, 1.0 at Nyquist.
        let span = (nyquist.max(40.0) / 20.0).log2();
        let hz = |a: f64| 20.0 * 2f64.powf(a * span);
        let db = |ratio: f64| 20.0 * ratio.max(1e-6).log10();
        let ln_db = 20.0 / std::f64::consts::LN_10;
        Facts {
            centroid_hz: hz(phi.centroid_mean),
            rolloff_hz: hz(phi.rolloff_mean),
            zcr_hz: hz(phi.zcr_mean),
            flatness: phi.flatness_mean,
            flux: phi.flux_mean,
            attack_ms: ((phi.attack_s.exp() - 0.005) * 1000.0).max(0.0),
            crest_db: phi.crest * ln_db,
            level_db: db(phi.rms_mean),
            swing: phi.rms_std / phi.rms_mean.max(1e-12),
            // `tail_ratio` is ln(tail/whole + 1e-3): the 1e-3 floor reads −60 dB.
            tail_db: db(phi.tail_ratio.exp() - 1e-3).max(-60.0),
            bass_pct: phi.bass_fraction * 100.0,
            high_db: phi.high_ratio * ln_db,
            held_move_oct: phi.held_centroid_std * span,
            motion_oct: [
                2f64.powf(phi.motion_slow),
                2f64.powf(phi.motion_mid),
                2f64.powf(phi.motion_fast),
            ],
        }
    }
}

/// One render, measured for a figure: see the module's docs.
#[derive(Clone, Debug, Serialize)]
pub struct Portrait {
    /// The long-term spectrum, [`BANDS`] bands, dB re the loudest band.
    pub bands: Vec<f64>,
    /// The held note's spectrum, bin by bin from 0 Hz, dB re its loudest
    /// bin, floored at [`FLOOR_DB`]; `held_step_hz` apart.
    pub held: Vec<f64>,
    pub held_step_hz: f64,
    /// The first note's level, re its peak (0 to 1), `onset_step_s` apart.
    pub onset: Vec<f64>,
    pub onset_step_s: f64,
    /// The phrase's level, dB re its RMS, `level_step_s` apart.
    pub level: Vec<f64>,
    pub level_step_s: f64,
    /// The held note's brightness (Hz) and level (dB re its loudest frame),
    /// `track_step_s` apart from its onset to its gate closing; a silent
    /// frame is `null` in both.
    pub bright: Vec<Option<f64>>,
    pub loud: Vec<Option<f64>>,
    pub track_step_s: f64,
    /// Each note's gate, opened and closed, seconds.
    pub notes: Vec<[f64; 2]>,
    /// The render's length, seconds.
    pub seconds: f64,
    /// φ's coordinates in their units.
    pub facts: Facts,
    /// The render's face ([`crate::face::Face`], one base64 string): what
    /// the app draws the figure's and the lesson's shape with, whitened
    /// against the bank as every face is.
    pub face: Face,
}

/// The band edges, Hz: [`BANDS`] + 1 of them, a face's.
pub use crate::face::band_edges_hz;

/// Mean power density of `power` (bins `bin_hz` apart, bin `i` centred on
/// `i·bin_hz`) over each band, counting a bin by the fraction of its width
/// inside the band, so a band narrower than a bin reads the bin it sits in.
fn band_power(power: &[f64], bin_hz: f64) -> Vec<f64> {
    let edges = band_edges_hz();
    (0..BANDS)
        .map(|b| {
            let (lo, hi) = (edges[b], edges[b + 1]);
            let first = ((lo / bin_hz) - 0.5).floor().max(0.0) as usize;
            let last = (((hi / bin_hz) + 0.5).ceil() as usize).min(power.len().saturating_sub(1));
            let mut acc = 0.0;
            for (i, p) in power.iter().enumerate().take(last + 1).skip(first) {
                let (a, z) = ((i as f64 - 0.5) * bin_hz, (i as f64 + 0.5) * bin_hz);
                let overlap = (z.min(hi) - a.max(lo)).max(0.0);
                acc += p * overlap / bin_hz;
            }
            acc / ((hi - lo) / bin_hz)
        })
        .collect()
}

/// `power` in dB re its largest value, floored at `floor`, to 0.1 dB.
fn rel_db(power: &[f64], floor: f64) -> Vec<f64> {
    let top = power.iter().cloned().fold(0.0f64, f64::max);
    power
        .iter()
        .map(|p| {
            let d = if top > 0.0 && *p > 0.0 {
                10.0 * (p / top).log10()
            } else {
                floor
            };
            round1(d.max(floor))
        })
        .collect()
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

fn round3(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

/// The power spectrum of the Hann-windowed frame at `pos`, and its total.
fn frame_power(x: &[f64], pos: usize, hann: &[f64]) -> (Vec<f64>, f64) {
    let fft = PLAN.with(Arc::clone);
    let mut buf: Vec<Complex<f64>> = x[pos..pos + FRAME]
        .iter()
        .zip(hann)
        .map(|(s, w)| Complex::new(s * w, 0.0))
        .collect();
    fft.process(&mut buf);
    let power: Vec<f64> = buf[..FRAME / 2].iter().map(|c| c.norm_sqr()).collect();
    let total = power.iter().sum();
    (power, total)
}

/// The RMS of `seg`; 0 for no samples.
fn rms(seg: &[f64]) -> f64 {
    (seg.iter().map(|s| s * s).sum::<f64>() / seg.len().max(1) as f64).sqrt()
}

/// The portrait of a render whose audio φ is `phi` (both from one
/// `featurize`: its normalized render and its features).
pub fn portrait(r: &RenderedPhrase, phi: &AudioFeatures) -> Portrait {
    let x = &r.samples;
    let n = x.len();
    let sr = r.sample_rate;
    let bin_hz = sr / FRAME as f64;
    let hann: Vec<f64> = (0..FRAME)
        .map(|i| 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / FRAME as f64).cos())
        .collect();

    // The long-term spectrum: every sounding frame's power, averaged.
    let mut ltas = vec![0.0; FRAME / 2];
    let mut frames = 0usize;
    let mut pos = 0;
    while pos + FRAME <= n {
        let (p, total) = frame_power(x, pos, &hann);
        if total > SILENT_POWER {
            ltas.iter_mut().zip(&p).for_each(|(a, b)| *a += b);
            frames += 1;
        }
        pos += HOP;
    }
    if frames > 0 {
        ltas.iter_mut().for_each(|a| *a /= frames as f64);
    }
    let bands = rel_db(&band_power(&ltas, bin_hz), FLOOR_DB);

    // The held note: its spectrum, and its brightness and level frame by frame.
    let held_span = r.spans.first().map(|h| (h.on_start, h.on_end.min(n)));
    let held_bins = ((HELD_HI_HZ / bin_hz).ceil() as usize + 1).min(FRAME / 2);
    let mut held_power = vec![0.0; held_bins];
    let mut bright = Vec::new();
    let mut loud_lin = Vec::new();
    if let Some((lo, hi)) = held_span {
        let mut pos = lo;
        let mut counted = 0usize;
        while pos + FRAME <= hi {
            let (p, total) = frame_power(x, pos, &hann);
            if total > SILENT_POWER {
                // φ's centroid: magnitude-weighted, in Hz.
                let mags: Vec<f64> = p.iter().map(|q| q.sqrt()).collect();
                let msum: f64 = mags.iter().sum();
                let c = mags
                    .iter()
                    .enumerate()
                    .map(|(i, m)| i as f64 * bin_hz * m)
                    .sum::<f64>()
                    / msum;
                bright.push(Some(c.round()));
                loud_lin.push(Some(rms(&x[pos..pos + FRAME])));
                held_power.iter_mut().zip(&p).for_each(|(a, b)| *a += b);
                counted += 1;
            } else {
                bright.push(None);
                loud_lin.push(None);
            }
            pos += TRACK_HOP;
        }
        if counted > 0 {
            held_power.iter_mut().for_each(|a| *a /= counted as f64);
        }
    }
    let held = rel_db(&held_power, FLOOR_DB);
    let top = loud_lin.iter().flatten().cloned().fold(0.0f64, f64::max);
    let loud = loud_lin
        .iter()
        .map(|v| v.map(|l| round1((20.0 * (l / top.max(1e-12)).max(1e-6).log10()).max(FLOOR_DB))))
        .collect();

    // The first note's onset, in φ's 4 ms windows.
    let onset = {
        let start = r.note_onsets.first().copied().unwrap_or(0).min(n);
        let end = r.note_onsets.get(1).copied().unwrap_or(n).min(n);
        let win = ((ONSET_WIN_S * sr) as usize).max(1);
        let step = ((ONSET_STEP_S * sr) as usize).max(1);
        let steps = (ONSET_S / ONSET_STEP_S).round() as usize;
        let env: Vec<f64> = (0..steps)
            .map(|k| {
                let a = start + k * step;
                if a + win <= end {
                    rms(&x[a..a + win])
                } else {
                    0.0
                }
            })
            .collect();
        // Re the note's own peak, over the whole note as φ takes it.
        let mut peak = 0.0f64;
        let mut a = start;
        while a + win <= end {
            peak = peak.max(rms(&x[a..a + win]));
            a += step;
        }
        env.iter().map(|e| round3(e / peak.max(1e-12))).collect()
    };

    // The phrase's level against its own RMS.
    let whole = rms(x);
    let lstep = ((LEVEL_STEP_S * sr) as usize).max(1);
    let level = (0..n.div_ceil(lstep))
        .map(|k| {
            let seg = &x[k * lstep..((k + 1) * lstep).min(n)];
            round1((20.0 * (rms(seg) / whole.max(1e-12)).max(1e-6).log10()).max(FLOOR_DB))
        })
        .collect();

    let notes = r
        .spans
        .iter()
        .map(|s| [round3(s.on_start as f64 / sr), round3(s.on_end as f64 / sr)])
        .collect();
    Portrait {
        bands,
        held,
        held_step_hz: bin_hz,
        onset,
        onset_step_s: ONSET_STEP_S,
        level,
        level_step_s: LEVEL_STEP_S,
        bright,
        loud,
        track_step_s: TRACK_HOP as f64 / sr,
        notes,
        seconds: n as f64 / sr,
        facts: Facts::of(phi, sr),
        face: Face::of_f64(x, sr),
    }
}

/// An impulse response's gain in each of the [`BANDS`] bands, dB (power
/// density over the band, as a spectrum's bands are taken), to 0.1 dB and
/// floored at −80: what a linear stage does to a sound, band by band.
pub fn response_bands(h: &[f64], sample_rate: f64) -> Vec<f64> {
    let len = h.len().next_power_of_two().max(FRAME);
    let mut planner = FftPlanner::<f64>::new();
    let fft = planner.plan_fft_forward(len);
    let mut buf: Vec<Complex<f64>> = (0..len)
        .map(|i| Complex::new(h.get(i).copied().unwrap_or(0.0), 0.0))
        .collect();
    fft.process(&mut buf);
    let power: Vec<f64> = buf[..len / 2].iter().map(|c| c.norm_sqr()).collect();
    band_power(&power, sample_rate / len as f64)
        .iter()
        .map(|p| round1((10.0 * p.max(1e-12).log10()).max(-80.0)))
        .collect()
}

#[cfg(test)]
mod tests;
