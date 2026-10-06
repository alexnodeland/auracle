//! φ from a recording: a sound of your own (Plan-005 task 11).
//!
//! A patch is measured on the standard phrase ([`crate::phrase`]): four notes
//! with rests between them, a chord, a release window. A dropped file is one
//! recording of something else entirely, with no notes the engine knows of,
//! so only part of φ means the same thing on it. This module measures that
//! part the way a render is measured, and says which part it is.
//!
//! ## The mapping
//!
//! The decoded file (mono, any rate) is checked against the bounds below,
//! trimmed of the silence before and after the sound, cut to
//! [`FILE_MAX_SECONDS`], resampled to the phrase's rate (so every
//! log-frequency coordinate, normalized at Nyquist, sits on the same axis a
//! render's does), loudness-normalized exactly as [`crate::featurize`] does
//! ([`normalize_to`] at [`TARGET_LUFS`], under the same peak ceiling), and
//! handed to the same [`audio_features`] a render goes through. Nothing in
//! that function changes for a file: its segment features find no note
//! spans, so they read their documented "no evidence" values, and the mask
//! says not to believe them.
//!
//! The first note's attack window is the one the phrase gives its first note
//! (onset to the second onset, [`attack_window_s`]), measured from where the
//! sound starts.
//!
//! ## The mask
//!
//! [`FILE_MASKED`] names the audio coordinates a file does not measure, and
//! every structural coordinate is masked too: a recording has no patch. Two
//! kinds of reason, both written next to the list:
//!
//! - **By construction:** the coordinates that read one note of the phrase
//!   by its role (the held note's motion, the high note, the chord) have no
//!   such note in a file.
//! - **By measurement:** `examples/file_phi.rs` renders every preset on
//!   stimuli that are not the phrase (a legato melody with no rests, one long
//!   note), measures each render as a file, and compares the result with the
//!   preset's φ on the phrase. A coordinate whose file value does not track
//!   its phrase value across the presets is masked.
//!
//! What downstream does with a masked coordinate is the session crate's
//! business (`auracle_session::own`): left out of every distance, imputed at
//! the standardizer's mean for anything linear in θ.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::audio::{audio_features, AudioFeatures};
use crate::loudness::normalize_to;
use crate::phrase::PhraseSpec;
use crate::pipeline::{Features, TARGET_LUFS};
use crate::render::RenderedPhrase;
use crate::structural::StructFeatures;

/// Most seconds of a file that are measured, from where its sound starts.
/// The rest is ignored (and [`FileFeatures::truncated`] says so): a long
/// recording's first half minute is a fair sample of what it is, and the
/// measurement stays near a third of a second at 48 kHz in wasm (about a
/// second at 192 kHz, most of it resampling: `auracle-wasm`'s
/// `examples/own_cost.mjs`).
pub const FILE_MAX_SECONDS: f64 = 30.0;

/// Longest input accepted at all, in seconds. A guard on memory, not on
/// meaning: the page should send no more than it needs, and a ten-minute
/// track at 48 kHz is 115 MB of `f32` crossing into the worker for nothing.
pub const FILE_INPUT_MAX_SECONDS: f64 = 120.0;

/// Fewest seconds of sound, after trimming, that can be measured: one
/// loudness block (400 ms) plus room for its gate.
///
/// A shorter one-shot was measured and does not hold the mask. With a single
/// G4 of 0.25 s added to [`recording_stimuli`], `zcr_mean` (rmse 0.55σ) and
/// `bass_fraction` (0.62σ) miss [`SURVIVES_RMSE`]; at 0.5 s they still miss
/// (0.54σ, 0.61σ), while the centroid, the rolloff and the flatness hold at
/// both. One short note at one pitch says less about weight and brightness
/// than a sound that moves, so the minimum stays here rather than measuring
/// a one-shot on coordinates it cannot carry.
pub const FILE_MIN_SECONDS: f64 = 0.5;

/// Lowest sample rate accepted, Hz.
pub const FILE_MIN_RATE: f64 = 8_000.0;

/// Highest sample rate accepted, Hz.
pub const FILE_MAX_RATE: f64 = 192_000.0;

/// Where a file's sound starts and stops: the first and last 10 ms window
/// within this many dB of the loudest one. Silence inside the recording is
/// kept; it is part of the sound.
pub const TRIM_DB: f64 = 60.0;

/// The audio coordinates a file does not measure, by name (see the module
/// doc for how each was decided). Every structural coordinate is masked as
/// well; [`file_observed`] is the whole mask over φ.
///
/// What is left is the file's spectral balance: brightness
/// (`centroid_mean`, `rolloff_mean`, `zcr_mean`), noisiness
/// (`flatness_mean`) and weight (`bass_fraction`). Those depend on what the
/// sound *is*; everything below depends as well on what was played.
pub const FILE_MASKED: [&str; 13] = [
    // By measurement (`examples/file_phi.rs`): each misses
    // [`SURVIVES_R`] or [`SURVIVES_RMSE`] on at least one stimulus of
    // [`recording_stimuli`].
    //
    // Movement over the whole phrase is mostly its register jumps, and a
    // file's is whatever it plays.
    "centroid_std:p2",
    "flux_mean:p2",
    // The phrase's level coordinates carry its four rests and its release
    // window; a recording has neither.
    "rms_mean:p2",
    "rms_std:p2",
    "crest:p2",
    // The first event of a file is not the phrase's held C4.
    "attack_s:p2",
    // The phrase's last 300 ms are its release window; a trimmed file's are
    // wherever the sound stopped.
    "tail_ratio:p2",
    // By construction: each reads a note of the phrase by its role, and a
    // file has no such note.
    "held_centroid_std:p2",
    "high_ratio:p2",
    "chord_flatness_delta:p2",
    "motion_slow:p2",
    "motion_mid:p2",
    "motion_fast:p2",
];

/// Smallest correlation, across the presets, between a coordinate measured
/// on a file of a preset and on the phrase, for the coordinate to count as
/// measured by a file. Ordering the presets the way the phrase does is the
/// least a coordinate must do to be used in a distance.
pub const SURVIVES_R: f64 = 0.9;

/// Largest root-mean-square difference, in σ of the presets' spread on the
/// phrase, between a coordinate on a file of a preset and on the phrase.
/// Two presets drawn at random differ by about 1.4σ on a coordinate; a third
/// of that is the most a file may be off and still be placed by it.
pub const SURVIVES_RMSE: f64 = 0.5;

/// The stimuli the mask was measured on: what a "recording" of a preset is
/// made of, each unlike the phrase in its own way. `melody`: eight legato
/// notes over C3–C5 with no rests. `drone`: one E4 held three seconds.
/// `stabs`: six short notes over C3–C5 with rests unlike the phrase's.
pub fn recording_stimuli() -> Vec<(&'static str, PhraseSpec)> {
    let note = |semis: f64, on_s: f64, off_s: f64| crate::phrase::Note {
        voct: semis / 12.0,
        on_s,
        off_s,
        chord: Vec::new(),
    };
    let base = PhraseSpec::default();
    let melody = [2.0, 5.0, 9.0, -5.0, 7.0, 0.0, 10.0, -2.0]
        .iter()
        .enumerate()
        .map(|(i, &s)| note(s, 0.45, if i == 7 { 0.6 } else { 0.02 }))
        .collect();
    let stabs = [7.0, -12.0, 3.0, 12.0, -7.0, 0.0]
        .iter()
        .map(|&s| note(s, 0.15, 0.35))
        .collect();
    vec![
        (
            "melody",
            PhraseSpec {
                notes: melody,
                ..base.clone()
            },
        ),
        (
            "drone",
            PhraseSpec {
                notes: vec![note(4.0, 3.0, 0.5)],
                ..base.clone()
            },
        ),
        (
            "stabs",
            PhraseSpec {
                notes: stabs,
                ..base
            },
        ),
    ]
}

/// How well one coordinate survives: Pearson's r between `truth` (the
/// phrase) and `file` across presets, the root-mean-square difference in
/// units of `sd`, and the mean difference (file minus truth) in the same
/// units.
pub fn agreement(truth: &[f64], file: &[f64], sd: f64) -> (f64, f64, f64) {
    let n = truth.len().max(1) as f64;
    let (ma, mb) = (truth.iter().sum::<f64>() / n, file.iter().sum::<f64>() / n);
    let (mut sab, mut saa, mut sbb, mut se, mut sd_sum) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for (x, y) in truth.iter().zip(file) {
        sab += (x - ma) * (y - mb);
        saa += (x - ma) * (x - ma);
        sbb += (y - mb) * (y - mb);
        se += ((y - x) / sd).powi(2);
        sd_sum += (y - x) / sd;
    }
    let r = if saa <= 0.0 || sbb <= 0.0 {
        0.0
    } else {
        sab / (saa * sbb).sqrt()
    };
    (r, (se / n).sqrt(), sd_sum / n)
}

/// Why a file was not measured. A flag the app words, never text.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Error, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileError {
    /// The sample rate is outside [`FILE_MIN_RATE`]..=[`FILE_MAX_RATE`].
    #[error("bad_rate")]
    BadRate,
    /// Longer than [`FILE_INPUT_MAX_SECONDS`].
    #[error("too_long")]
    TooLong,
    /// Less than [`FILE_MIN_SECONDS`] of sound once trimmed.
    #[error("too_short")]
    TooShort,
    /// A sample is not a finite number.
    #[error("non_finite")]
    NonFinite,
    /// Nothing above the loudness gate.
    #[error("silent")]
    Silent,
}

impl FileError {
    /// The flag's code, as the wasm reply carries it.
    pub fn code(self) -> &'static str {
        match self {
            FileError::BadRate => "bad_rate",
            FileError::TooLong => "too_long",
            FileError::TooShort => "too_short",
            FileError::NonFinite => "non_finite",
            FileError::Silent => "silent",
        }
    }
}

/// A file, measured.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FileFeatures {
    /// The audio half of φ, as [`audio_features`] reads the file. Masked
    /// coordinates ([`FILE_MASKED`]) hold its "no evidence" values and mean
    /// nothing.
    pub audio: AudioFeatures,
    /// Seconds of sound measured, after trimming and the cut.
    pub seconds: f64,
    /// The sound ran past [`FILE_MAX_SECONDS`] and was cut there.
    pub truncated: bool,
    /// Integrated loudness before normalization, LUFS.
    pub lufs_before: f64,
    /// Gain applied toward [`TARGET_LUFS`], dB.
    pub gain_db: f64,
}

impl FileFeatures {
    /// φ over [`Features::phi_names`], structural coordinates at 0 (masked;
    /// see [`file_observed`]), so it lines up with a render's φ index for
    /// index.
    pub fn phi(&self) -> Vec<f64> {
        let mut v = self.audio.to_vec();
        v.resize(Features::phi_names().len(), 0.0);
        v
    }
}

/// Which coordinates of φ ([`Features::phi_names`] order) a file measures:
/// `true` for observed, `false` for masked. Every structural coordinate is
/// masked, and the audio ones named in [`FILE_MASKED`].
pub fn file_observed() -> Vec<bool> {
    let audio = AudioFeatures::NAMES.len();
    Features::phi_names()
        .iter()
        .enumerate()
        .map(|(i, n)| i < audio && !FILE_MASKED.contains(n))
        .collect()
}

/// The names of the coordinates a file does not measure, in φ order.
pub fn file_masked_names() -> Vec<&'static str> {
    Features::phi_names()
        .into_iter()
        .zip(file_observed())
        .filter(|(_, o)| !o)
        .map(|(n, _)| n)
        .collect()
}

/// How many structural coordinates there are (all masked for a file).
pub fn structural_len() -> usize {
    StructFeatures::NAMES.len()
}

/// The phrase's first-note attack window: from its first onset to its
/// second, which is what [`audio_features`] measures `attack_s` over on a
/// render.
pub fn attack_window_s() -> f64 {
    let spec = PhraseSpec::default();
    spec.notes.first().map_or(2.0, |n| n.on_s + n.off_s)
}

/// Measure a decoded recording: mono samples at `sample_rate`.
///
/// See the module doc for the steps. Errors are flags
/// ([`FileError::code`]); nothing here is copy.
pub fn featurize_file(pcm: &[f32], sample_rate: f64) -> Result<FileFeatures, FileError> {
    if !(FILE_MIN_RATE..=FILE_MAX_RATE).contains(&sample_rate) {
        return Err(FileError::BadRate);
    }
    if pcm.len() as f64 > FILE_INPUT_MAX_SECONDS * sample_rate {
        return Err(FileError::TooLong);
    }
    if pcm.iter().any(|s| !s.is_finite()) {
        return Err(FileError::NonFinite);
    }
    // The input stays `f32` until it is cut to the sound: the envelope is
    // read off the samples as they came, and only the span measured (at most
    // `FILE_MAX_SECONDS`) is ever widened, by the resampler, at the phrase's
    // rate. Widening the whole input first cost 8 bytes a sample of linear
    // memory that wasm never gives back: 132 MB for two minutes at 96 kHz.
    let (start, end) = sound_span(pcm, sample_rate).ok_or(FileError::Silent)?;
    let max_len = (FILE_MAX_SECONDS * sample_rate) as usize;
    let truncated = end - start > max_len;
    let end = end.min(start + max_len);
    if ((end - start) as f64) < FILE_MIN_SECONDS * sample_rate {
        return Err(FileError::TooShort);
    }
    let rate = PhraseSpec::default().sample_rate;
    let mut samples = resample(&pcm[start..end], sample_rate, rate);
    let norm = normalize_to(&mut samples, rate, TARGET_LUFS).ok_or(FileError::Silent)?;
    let n = samples.len();
    let attack_end = ((attack_window_s() * rate) as usize).min(n);
    let render = RenderedPhrase {
        samples,
        sample_rate: rate,
        note_onsets: vec![0, attack_end],
        spans: Vec::new(),
    };
    let audio = measured(audio_features(&render))?;
    Ok(FileFeatures {
        audio,
        seconds: n as f64 / rate,
        truncated,
        lufs_before: norm.lufs_before,
        gain_db: norm.gain_db,
    })
}

/// The audio half of φ as a file measured it, or [`FileError::NonFinite`] if
/// a coordinate is not a number. Not reachable on a buffer that cleared the
/// loudness gate, but a NaN here would standardize to NaN and poison every
/// distance.
fn measured(audio: AudioFeatures) -> Result<AudioFeatures, FileError> {
    if audio.to_vec().iter().all(|v| v.is_finite()) {
        Ok(audio)
    } else {
        Err(FileError::NonFinite)
    }
}

/// The span of `x` that holds its sound: from the first 10 ms window within
/// [`TRIM_DB`] of the loudest to the end of the last. `None` for a buffer
/// with nothing in it.
fn sound_span(x: &[f32], sample_rate: f64) -> Option<(usize, usize)> {
    let win = ((0.010 * sample_rate) as usize).max(1);
    let rms: Vec<f64> = x
        .chunks(win)
        .map(|w| {
            let e: f64 = w.iter().map(|&s| f64::from(s) * f64::from(s)).sum();
            (e / w.len() as f64).sqrt()
        })
        .collect();
    let peak = rms.iter().copied().fold(0.0, f64::max);
    // −150 dBFS: digital silence and dither-free fades, not a quiet sound.
    if peak <= 3e-8 {
        return None;
    }
    let floor = peak * 10f64.powf(-TRIM_DB / 20.0);
    let first = rms.iter().position(|&r| r >= floor)?;
    let last = rms.iter().rposition(|&r| r >= floor)?;
    Some((first * win, ((last + 1) * win).min(x.len())))
}

/// Zero crossings of the resampling kernel on each side, at the lower of the
/// two rates. Sixteen keeps the passband flat to 0.97 of the lower Nyquist
/// with the stopband below −70 dB under a Blackman window.
const SINC_ZEROS: f64 = 16.0;

/// Band-limited resampling by windowed sinc. `from == to` returns the
/// samples unchanged, bit for bit (a render measured as a file is not
/// touched). The cutoff is 0.97 of the lower Nyquist, so going down removes
/// what the new rate cannot hold and going up adds nothing.
pub fn resample<T: Copy + Into<f64>>(x: &[T], from: f64, to: f64) -> Vec<f64> {
    if from == to || x.is_empty() {
        return x.iter().map(|&v| v.into()).collect();
    }
    let ratio = from / to;
    let n_out = ((x.len() as f64) / ratio).floor() as usize;
    // Cutoff as a fraction of the input rate (cycles per input sample).
    let fc = 0.5 * 0.97 * (to / from).min(1.0);
    let half = (SINC_ZEROS / (2.0 * fc)).ceil() as isize;
    // The kernel, tabulated once on a fine grid and read by linear
    // interpolation: evaluating a sine and two cosines per tap cost 4.6 s
    // for half a minute at 48 kHz in wasm, and the table's error (under
    // 1e-6 of the tap) is far below the kernel's own stopband.
    let table: Vec<f64> = (0..=(half as usize) * KERNEL_GRID + 1)
        .map(|i| {
            let d = i as f64 / KERNEL_GRID as f64;
            let w = d / half as f64; // 0..1 across half the kernel
            if w >= 1.0 {
                return 0.0;
            }
            let arg = 2.0 * fc * d;
            let sinc = if arg < 1e-12 {
                1.0
            } else {
                (std::f64::consts::PI * arg).sin() / (std::f64::consts::PI * arg)
            };
            let t = std::f64::consts::PI * (w + 1.0); // π..2π
            let blackman = 0.42 - 0.5 * t.cos() + 0.08 * (2.0 * t).cos();
            2.0 * fc * sinc * blackman
        })
        .collect();
    let len = x.len() as isize;
    let mut out = Vec::with_capacity(n_out);
    for i in 0..n_out {
        let p = i as f64 * ratio;
        let c = p.floor() as isize;
        let mut acc = 0.0;
        for k in (c - half + 1).max(0)..=(c + half).min(len - 1) {
            // In the table: |p − k| ≤ half, so j + 1 ≤ half·KERNEL_GRID + 1,
            // its last index.
            let g = (p - k as f64).abs() * KERNEL_GRID as f64;
            let j = g as usize;
            let h = table[j] + (g - j as f64) * (table[j + 1] - table[j]);
            acc += x[k as usize].into() * h;
        }
        out.push(acc);
    }
    out
}

/// Points per input sample in the resampling kernel's table.
const KERNEL_GRID: usize = 512;

#[cfg(test)]
mod tests;
