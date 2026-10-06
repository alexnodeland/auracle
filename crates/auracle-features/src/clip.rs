//! Audition clips: the signal a patch that listens is measured with.
//!
//! A live input is neither fixed nor repeatable, so it cannot be measured as
//! it is ([RFC-008](../../../docs/proposals/008-audio-in.md), part 2). Every
//! AUDIO IN in a measurement render reads an **audition clip** instead: a few
//! seconds of the player's input, captured once and stored with the session,
//! or, before anything is captured, the built-in [`reference`] signal. The
//! clip rides inside the stimulus ([`PhraseSpec::clip`]), so featurizing, the
//! vet, the walks, the render farm and the cache key all see it without a
//! second parameter.
//!
//! ## What a clip is
//!
//! One or two channels at the phrase's sample rate, at most
//! [`MAX_CLIP_SECONDS`] long, **quantized to 16 bits when it is made**. The
//! quantization is the point rather than a compression: the engine measures
//! exactly the samples it saves, so a reload measures the same φ, and the
//! saved form ([`SavedClip`], `s16le-base64`) is half the size of `f32`.
//! A clip is named by a content hash ([`AuditionClip::id`]), which is what the
//! render key folds in for a patch that listens.
//!
//! ## The bound, after quiver's `Capture`
//!
//! A saved clip is untrusted input (a session file can be edited or shared),
//! and [`AuditionClip::from_saved`] follows the rules quiver's `Capture` uses
//! for its saved take: a known format tag, a finite positive rate within
//! [`MAX_CLIP_RATE`], one or two channels, a frame count that agrees with the
//! data and is within [`MAX_CLIP_SECONDS`] at that rate, and the data's length
//! checked **before** it is decoded, so nothing allocates beyond what the
//! file's own bytes already occupy. Anything else is refused, and the session
//! measures with the reference instead and says so. A silent clip is refused
//! too, made or loaded: every patch that listens would fail the vet over it.

use std::sync::{Arc, Mutex};

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use thiserror::Error;

use crate::phrase::PhraseSpec;
use crate::vet::VetConfig;

/// The longest clip kept, in seconds. The audition phrase is about five
/// seconds and a clip is only ever read for the length of the phrase, so this
/// is the phrase with room to spare, and the bound a saved clip is held to.
pub const MAX_CLIP_SECONDS: f64 = 8.0;

/// The highest sample rate a clip may claim: a saved clip's frame bound is
/// `MAX_CLIP_SECONDS` at its own rate, so the rate is bounded too.
pub const MAX_CLIP_RATE: f64 = 192_000.0;

/// The most channels a clip carries. An AUDIO IN reads left, right or both,
/// so two is all a clip can usefully hold.
pub const MAX_CLIP_CHANNELS: usize = 2;

/// The saved form's format tag: interleaved 16-bit little-endian samples in
/// standard base64 (RFC 4648, padded).
pub const CLIP_FORMAT: &str = "s16le-base64";

/// The 16-bit full scale. A quantized sample is `q / 32768` for an integer
/// `q` in `-32768..=32767`, which `f32` holds exactly.
const FULL_SCALE: f32 = 32_768.0;

/// Why a clip could not be made or loaded.
#[derive(Debug, Error, PartialEq)]
pub enum ClipError {
    /// The saved clip names a format this build does not read.
    #[error("format must be \"{CLIP_FORMAT}\"")]
    Format,
    /// The sample rate is not finite, not positive, or above [`MAX_CLIP_RATE`].
    #[error("sample rate {0} is not a rate a clip can have")]
    Rate(f64),
    /// The channel count is not 1 or 2.
    #[error("{0} channels; a clip has one or two")]
    Channels(usize),
    /// No frames at all.
    #[error("the clip is empty")]
    Empty,
    /// More frames than [`MAX_CLIP_SECONDS`] at the clip's rate.
    #[error("{frames} frames is longer than {MAX_CLIP_SECONDS} s at {rate} Hz")]
    TooLong {
        /// Frames claimed.
        frames: usize,
        /// The clip's rate.
        rate: f64,
    },
    /// The data does not hold the frames claimed, or is not base64.
    #[error("the data does not hold {0} frames")]
    Data(usize),
    /// A sample handed in is not a finite number.
    #[error("a sample is not a finite number")]
    NonFinite,
    /// The clip is silent: below the vet's silence floor
    /// ([`VetConfig::rms_floor`]) over its whole length.
    #[error("the clip is silent (rms {rms:.1e})")]
    Silent {
        /// The clip's RMS over every channel.
        rms: f64,
    },
}

/// Where a clip came from: what the session says when it reports which clip
/// patches with an input are measured with.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClipSource {
    /// The built-in [`reference`] signal.
    Reference,
    /// Captured from the player's input.
    Captured,
}

/// An audition clip: planar channels at one sample rate, quantized to 16
/// bits, named by a hash of that content.
///
/// Cheap to clone (the samples are shared). Equality is equality of content:
/// two clips are the same clip when their ids are.
#[derive(Clone)]
pub struct AuditionClip {
    /// One `Vec` per channel, every sample a multiple of `1/32768`.
    channels: Arc<Vec<Vec<f32>>>,
    sample_rate: f64,
    source: ClipSource,
    /// 32 hex chars of FNV-1a 128 over the canonical bytes ([`Self::id`]).
    id: String,
}

/// What a clip is, not what it holds: a phrase, a session config or a walk
/// context printed with `{:?}` would otherwise print every sample.
impl std::fmt::Debug for AuditionClip {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuditionClip")
            .field("id", &self.id)
            .field("source", &self.source)
            .field("frames", &self.frames())
            .field("channels", &self.channel_count())
            .field("sample_rate", &self.sample_rate)
            .finish()
    }
}

impl PartialEq for AuditionClip {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

/// The saved form of a clip, field for field what the session file holds.
///
/// Its fields are public and unvalidated on purpose: this is what a file
/// *says*, and [`AuditionClip::from_saved`] decides whether to believe it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SavedClip {
    /// [`CLIP_FORMAT`].
    pub format: String,
    /// Sample rate, Hz.
    pub sample_rate: f64,
    /// 1 or 2.
    pub channels: usize,
    /// Frames (samples per channel).
    pub frames: usize,
    /// `frames · channels` interleaved `i16` samples, little-endian, base64.
    pub data: String,
    /// Where it came from. Absent reads as captured.
    #[serde(default = "captured")]
    pub source: ClipSource,
}

fn captured() -> ClipSource {
    ClipSource::Captured
}

impl AuditionClip {
    /// A clip from interleaved samples, at the rate the phrase renders at.
    ///
    /// `samples` holds `channels` samples per frame at `sample_rate`. The clip
    /// is resampled to `spec.sample_rate` if the two differ (linearly: a
    /// browser captures at 48 kHz, the phrase renders at 44.1 kHz), cut to the
    /// phrase's length (nothing past it is ever read) and to
    /// [`MAX_CLIP_SECONDS`], and quantized to 16 bits.
    pub fn from_interleaved(
        samples: &[f32],
        channels: usize,
        sample_rate: f64,
        spec: &PhraseSpec,
    ) -> Result<Self, ClipError> {
        if !(1..=MAX_CLIP_CHANNELS).contains(&channels) {
            return Err(ClipError::Channels(channels));
        }
        check_rate(sample_rate)?;
        check_rate(spec.sample_rate)?;
        if samples.iter().any(|s| !s.is_finite()) {
            return Err(ClipError::NonFinite);
        }
        let frames = samples.len() / channels;
        if frames == 0 {
            return Err(ClipError::Empty);
        }
        let keep = spec
            .total_samples()
            .min((MAX_CLIP_SECONDS * spec.sample_rate) as usize)
            .max(1);
        let planar: Vec<Vec<f32>> = (0..channels)
            .map(|c| {
                let one: Vec<f32> = (0..frames).map(|f| samples[f * channels + c]).collect();
                let mut at_rate = resample(&one, sample_rate, spec.sample_rate);
                at_rate.truncate(keep);
                at_rate.iter_mut().for_each(|s| *s = quantize(*s));
                at_rate
            })
            .collect();
        check_heard(&planar)?;
        Ok(Self::assemble(
            planar,
            spec.sample_rate,
            ClipSource::Captured,
        ))
    }

    /// Load a saved clip, refusing anything a clip cannot be (see the module
    /// doc's *The bound*). Allocates only in proportion to `saved.data`, and
    /// only once its length has been checked against the frames it claims.
    pub fn from_saved(saved: &SavedClip) -> Result<Self, ClipError> {
        if saved.format != CLIP_FORMAT {
            return Err(ClipError::Format);
        }
        check_rate(saved.sample_rate)?;
        if !(1..=MAX_CLIP_CHANNELS).contains(&saved.channels) {
            return Err(ClipError::Channels(saved.channels));
        }
        if saved.frames == 0 {
            return Err(ClipError::Empty);
        }
        if saved.frames as f64 > MAX_CLIP_SECONDS * saved.sample_rate {
            return Err(ClipError::TooLong {
                frames: saved.frames,
                rate: saved.sample_rate,
            });
        }
        // The data's length is a function of the frames, so a file claiming
        // a few frames cannot make the decoder allocate for a large string,
        // and one claiming many cannot make it allocate beyond its own text.
        let bytes = saved.frames * saved.channels * 2;
        if saved.data.len() != bytes.div_ceil(3) * 4 {
            return Err(ClipError::Data(saved.frames));
        }
        let raw = base64::decode(&saved.data).ok_or(ClipError::Data(saved.frames))?;
        if raw.len() != bytes {
            return Err(ClipError::Data(saved.frames));
        }
        let mut planar = vec![Vec::with_capacity(saved.frames); saved.channels];
        for (i, pair) in raw.chunks_exact(2).enumerate() {
            let q = i16::from_le_bytes([pair[0], pair[1]]);
            planar[i % saved.channels].push(q as f32 / FULL_SCALE);
        }
        check_heard(&planar)?;
        Ok(Self::assemble(planar, saved.sample_rate, saved.source))
    }

    /// The saved form: lossless, so [`Self::from_saved`] gives back this clip,
    /// id and all.
    pub fn to_saved(&self) -> SavedClip {
        SavedClip {
            format: CLIP_FORMAT.to_string(),
            sample_rate: self.sample_rate,
            channels: self.channels.len(),
            frames: self.frames(),
            data: base64::encode(&self.le_bytes()),
            source: self.source,
        }
    }

    /// Content address: FNV-1a 128 over the rate, the channel count and the
    /// interleaved 16-bit samples, as 32 lowercase hex chars. The tag a
    /// listening patch's render key carries.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// Where this clip came from.
    pub fn source(&self) -> ClipSource {
        self.source
    }

    /// Frames (samples per channel).
    pub fn frames(&self) -> usize {
        self.channels.first().map_or(0, Vec::len)
    }

    /// Channels, 1 or 2.
    pub fn channel_count(&self) -> usize {
        self.channels.len()
    }

    /// Sample rate, Hz.
    pub fn sample_rate(&self) -> f64 {
        self.sample_rate
    }

    /// Length in seconds.
    pub fn seconds(&self) -> f64 {
        self.frames() as f64 / self.sample_rate
    }

    /// The channels, planar, as quiver's `AudioInputStream::write` takes
    /// them.
    pub fn planar(&self) -> &[Vec<f32>] {
        &self.channels
    }

    /// This clip at another sample rate (itself when the rates agree).
    pub fn at_rate(&self, sample_rate: f64) -> AuditionClip {
        if sample_rate == self.sample_rate {
            return self.clone();
        }
        let planar = self
            .channels
            .iter()
            .map(|c| {
                let mut r = resample(c, self.sample_rate, sample_rate);
                r.iter_mut().for_each(|s| *s = quantize(*s));
                r
            })
            .collect();
        Self::assemble(planar, sample_rate, self.source)
    }

    fn assemble(channels: Vec<Vec<f32>>, sample_rate: f64, source: ClipSource) -> Self {
        let mut clip = AuditionClip {
            channels: Arc::new(channels),
            sample_rate,
            source,
            id: String::new(),
        };
        clip.id = clip.content_id();
        clip
    }

    fn le_bytes(&self) -> Vec<u8> {
        let (n, c) = (self.frames(), self.channels.len());
        let mut out = Vec::with_capacity(n * c * 2);
        for f in 0..n {
            for ch in self.channels.iter() {
                out.extend_from_slice(&to_i16(ch[f]).to_le_bytes());
            }
        }
        out
    }

    fn content_id(&self) -> String {
        let mut h = fnv1a128(FNV_OFFSET_128, &self.sample_rate.to_bits().to_le_bytes());
        h = fnv1a128(h, &(self.channels.len() as u64).to_le_bytes());
        h = fnv1a128(h, &self.le_bytes());
        format!("{h:032x}")
    }
}

impl Serialize for AuditionClip {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        self.to_saved().serialize(s)
    }
}

impl<'de> Deserialize<'de> for AuditionClip {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let saved = SavedClip::deserialize(d)?;
        AuditionClip::from_saved(&saved).map_err(serde::de::Error::custom)
    }
}

/// Refuse a silent clip. Every patch that listens would render silent over
/// it and fail the vet, so a capture of nothing (a muted input, the wrong
/// device) would take every such patch out of measurement at once; refusing
/// it keeps the clip the session had.
fn check_heard(planar: &[Vec<f32>]) -> Result<(), ClipError> {
    let n: usize = planar.iter().map(Vec::len).sum();
    let energy: f64 = planar
        .iter()
        .flat_map(|c| c.iter())
        .map(|s| (*s as f64) * (*s as f64))
        .sum();
    let rms = (energy / n.max(1) as f64).sqrt();
    if rms < VetConfig::default().rms_floor {
        Err(ClipError::Silent { rms })
    } else {
        Ok(())
    }
}

fn check_rate(rate: f64) -> Result<(), ClipError> {
    if rate.is_finite() && rate > 0.0 && rate <= MAX_CLIP_RATE {
        Ok(())
    } else {
        Err(ClipError::Rate(rate))
    }
}

/// Round to the 16-bit grid, clipping at full scale.
fn quantize(s: f32) -> f32 {
    to_i16(s) as f32 / FULL_SCALE
}

fn to_i16(s: f32) -> i16 {
    (s * FULL_SCALE)
        .round()
        .clamp(-FULL_SCALE, FULL_SCALE - 1.0) as i16
}

/// Linear-interpolation resampling. Enough for a measurement clip: it moves
/// the clip to the rate the phrase renders at, and the 16-bit rounding that
/// follows is a larger change than its error.
fn resample(x: &[f32], from: f64, to: f64) -> Vec<f32> {
    if from == to || x.is_empty() {
        return x.to_vec();
    }
    let n = ((x.len() as f64) * to / from).floor().max(1.0) as usize;
    let step = from / to;
    (0..n)
        .map(|i| {
            let pos = i as f64 * step;
            let j = pos.floor() as usize;
            let frac = (pos - j as f64) as f32;
            let a = x[j.min(x.len() - 1)];
            let b = x[(j + 1).min(x.len() - 1)];
            a + (b - a) * frac
        })
        .collect()
}

const FNV_OFFSET_128: u128 = 0x6c62_272e_07bb_0142_62b8_2175_6295_c58d;
const FNV_PRIME_128: u128 = 0x0000_0000_0100_0000_0000_0000_0000_013b;

fn fnv1a128(state: u128, bytes: &[u8]) -> u128 {
    let mut h = state;
    for b in bytes {
        h ^= *b as u128;
        h = h.wrapping_mul(FNV_PRIME_128);
    }
    h
}

// ---------------------------------------------------------------------------
// The reference signal
// ---------------------------------------------------------------------------

/// One event of the reference figure: onset in seconds, MIDI note, velocity,
/// decay time constant in seconds, and the harmonic tilt (partial `k` at
/// `1/k^tilt`: 1 is a bright, saw-like stack, 1.6 a darker one).
struct Pluck {
    at: f64,
    note: u8,
    vel: f64,
    tau: f64,
    tilt: f64,
}

/// The reference figure: fourteen plucked notes over four and a half
/// seconds, in A minor pentatonic from A2 to E4, then a rest.
///
/// Two bars of eighth-note plucks with an accent pattern, and in each bar one
/// note left to ring longer (decaying over 0.35 s and 0.2 s against a pluck's
/// 0.08 s). A pluck has fallen at least 27 dB by the next note, and a held
/// note 19 dB, so every onset is a rise a follower or a compressor can see.
/// Bright and dark notes alternate, so the spectrum the figure presents moves
/// as it plays.
const FIGURE: [Pluck; 14] = [
    Pluck {
        at: 0.00,
        note: 45,
        vel: 1.00,
        tau: 0.08,
        tilt: 1.0,
    },
    Pluck {
        at: 0.25,
        note: 52,
        vel: 0.55,
        tau: 0.07,
        tilt: 1.6,
    },
    Pluck {
        at: 0.50,
        note: 57,
        vel: 0.80,
        tau: 0.08,
        tilt: 1.0,
    },
    Pluck {
        at: 0.75,
        note: 60,
        vel: 0.55,
        tau: 0.07,
        tilt: 1.6,
    },
    Pluck {
        at: 1.00,
        note: 64,
        vel: 0.90,
        tau: 0.35,
        tilt: 1.2,
    },
    Pluck {
        at: 1.75,
        note: 62,
        vel: 0.55,
        tau: 0.07,
        tilt: 1.6,
    },
    Pluck {
        at: 2.00,
        note: 60,
        vel: 0.80,
        tau: 0.08,
        tilt: 1.0,
    },
    Pluck {
        at: 2.25,
        note: 55,
        vel: 0.55,
        tau: 0.07,
        tilt: 1.6,
    },
    Pluck {
        at: 2.50,
        note: 45,
        vel: 1.00,
        tau: 0.08,
        tilt: 1.0,
    },
    Pluck {
        at: 2.75,
        note: 52,
        vel: 0.55,
        tau: 0.07,
        tilt: 1.6,
    },
    Pluck {
        at: 3.00,
        note: 60,
        vel: 0.80,
        tau: 0.08,
        tilt: 1.0,
    },
    Pluck {
        at: 3.25,
        note: 55,
        vel: 0.55,
        tau: 0.07,
        tilt: 1.6,
    },
    Pluck {
        at: 3.50,
        note: 57,
        vel: 0.90,
        tau: 0.20,
        tilt: 1.2,
    },
    Pluck {
        at: 4.25,
        note: 52,
        vel: 0.70,
        tau: 0.08,
        tilt: 1.0,
    },
];

/// The reference figure's notes as `(onset in seconds, MIDI note)`, in order:
/// what a patch that tracks the reference should play.
#[cfg(test)]
pub(crate) fn reference_notes() -> impl Iterator<Item = (f64, u8)> {
    FIGURE.iter().map(|p| (p.at, p.note))
}

/// Partials per note, at most: up to 32, and never above 45% of the sample
/// rate, so the stack is bandlimited at any rate.
const REFERENCE_PARTIALS: usize = 32;
/// The attack ramp of each note, seconds.
const REFERENCE_ATTACK: f64 = 0.002;
/// Each note's pick: a burst of white noise this long, seconds ...
const PICK_LENGTH: f64 = 0.012;
/// ... decaying with this time constant ...
const PICK_TAU: f64 = 0.003;
/// ... at this level relative to the note's partials at full velocity.
const PICK_LEVEL: f64 = 0.8;
/// Where the reference peaks: −6 dBFS, so an AUDIO IN at unity gain meets
/// the patch at half of quiver's full-scale 5 V.
pub const REFERENCE_PEAK: f64 = 0.5;

/// The built-in reference signal at `spec`'s rate and length: what every
/// AUDIO IN is measured with before the player's input has been captured.
///
/// A plucked figure ([`FIGURE`]), because it has to exercise what a patch
/// does to an input:
///
/// - **pitched**: every note a harmonic stack across A2–E4, so a filter, a
///   folder, a pitch shifter or a vocoder has partials to work on;
/// - **transients**: a sharp attack and a noise pick on every note, and an
///   accent pattern, so a follower, a compressor, a gate or a ducker has
///   something to react to, and a delay has onsets to repeat;
/// - **broadband**: the picks are white noise across the whole band and the
///   notes' stacks reach up to 10 kHz, so a lowpass on the input moves the
///   spectral centroid;
/// - **space around it**: the plucks decay between notes, and every note has
///   died away before the phrase's last 300 ms (the window its tail is
///   measured in), so a reverb's or a delay's tail is heard as a tail.
///
/// Mono, so an AUDIO IN's channel makes no difference to it (a captured
/// stereo clip is where the channel is heard). **Deterministic**: integer
/// sample indices, `libm`'s sine (pure Rust, so the native build and the wasm
/// build compute the same samples), a fixed xorshift for the picks, and the
/// same 16-bit quantization as a capture. Built once per rate and length and
/// shared.
pub fn reference(spec: &PhraseSpec) -> AuditionClip {
    let frames = spec
        .total_samples()
        .min((MAX_CLIP_SECONDS * spec.sample_rate) as usize)
        .max(1);
    // A panic elsewhere while the list was held leaves it whole (it is only
    // changed after the clip is built), so a poisoned lock is still a good
    // list: recover it rather than take every later render down with it.
    let mut built = REFERENCES.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(c) = built
        .iter()
        .find(|c| c.sample_rate == spec.sample_rate && c.frames() == frames)
    {
        return c.clone();
    }
    let clip = synthesize_reference(spec.sample_rate, frames);
    if built.len() >= REFERENCES_KEPT {
        built.remove(0);
    }
    built.push(clip.clone());
    clip
}

/// The references built so far, oldest first: [`reference`] builds each
/// (rate, length) once and shares it.
static REFERENCES: Mutex<Vec<AuditionClip>> = Mutex::new(Vec::new());

/// How many references are kept. A handful of (rate, length) pairs is all a
/// process meets; the cap only keeps a sweep over rates from growing the
/// list without end.
const REFERENCES_KEPT: usize = 8;

fn synthesize_reference(sr: f64, frames: usize) -> AuditionClip {
    use std::f64::consts::TAU;
    let mut out = vec![0.0f64; frames];
    let mut noise: u64 = 0x5EED_A0D1_0C11_0001;
    let mut white = move || {
        // xorshift64*, mapped to [-1, 1).
        noise ^= noise >> 12;
        noise ^= noise << 25;
        noise ^= noise >> 27;
        let x = noise.wrapping_mul(0x2545_F491_4F6C_DD1D);
        (x >> 11) as f64 / (1u64 << 52) as f64 - 1.0
    };
    for p in &FIGURE {
        let start = (p.at * sr) as usize;
        if start >= frames {
            continue;
        }
        let f0 = 440.0 * libm::pow(2.0, (p.note as f64 - 69.0) / 12.0);
        let partials = ((0.45 * sr / f0) as usize).clamp(1, REFERENCE_PARTIALS);
        let gains: Vec<f64> = (1..=partials)
            .map(|k| 1.0 / libm::pow(k as f64, p.tilt))
            .collect();
        let end = (start + (6.0 * p.tau * sr) as usize).min(frames);
        for (n, slot) in out[start..end].iter_mut().enumerate() {
            let t = n as f64 / sr;
            let env = if t < REFERENCE_ATTACK {
                t / REFERENCE_ATTACK
            } else {
                libm::exp(-(t - REFERENCE_ATTACK) / p.tau)
            };
            // The partials by the sine recurrence: one `sin` and one `cos` a
            // sample, then sin(kθ) from sin((k−1)θ) and sin((k−2)θ).
            let theta = TAU * f0 * t;
            let (s1, c1) = (libm::sin(theta), libm::cos(theta));
            let (mut prev, mut cur) = (0.0, s1);
            let mut tone = 0.0;
            for g in &gains {
                tone += g * cur;
                let next = 2.0 * c1 * cur - prev;
                prev = cur;
                cur = next;
            }
            *slot += p.vel * env * tone;
        }
        let pick_end = (start + (PICK_LENGTH * sr) as usize).min(frames);
        for (n, slot) in out[start..pick_end].iter_mut().enumerate() {
            let t = n as f64 / sr;
            *slot += PICK_LEVEL * p.vel * libm::exp(-t / PICK_TAU) * white();
        }
    }
    let peak = out.iter().fold(0.0f64, |m, s| m.max(s.abs()));
    let scale = if peak > 0.0 {
        REFERENCE_PEAK / peak
    } else {
        0.0
    };
    let mono: Vec<f32> = out.iter().map(|s| quantize((s * scale) as f32)).collect();
    AuditionClip::assemble(vec![mono], sr, ClipSource::Reference)
}

/// Standard base64 (RFC 4648, padded), as quiver's `Capture` writes it.
mod base64 {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    pub(super) fn encode(bytes: &[u8]) -> String {
        let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
        for chunk in bytes.chunks(3) {
            let b = [
                chunk[0],
                *chunk.get(1).unwrap_or(&0),
                *chunk.get(2).unwrap_or(&0),
            ];
            let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
            for (i, shift) in [18, 12, 6, 0].into_iter().enumerate() {
                if i <= chunk.len() {
                    out.push(ALPHABET[((n >> shift) & 63) as usize] as char);
                } else {
                    out.push('=');
                }
            }
        }
        out
    }

    pub(super) fn decode(text: &str) -> Option<Vec<u8>> {
        let text = text.as_bytes();
        if !text.len().is_multiple_of(4) {
            return None;
        }
        let value = |c: u8| -> Option<u32> {
            Some(match c {
                b'A'..=b'Z' => c - b'A',
                b'a'..=b'z' => c - b'a' + 26,
                b'0'..=b'9' => c - b'0' + 52,
                b'+' => 62,
                b'/' => 63,
                _ => return None,
            } as u32)
        };
        let mut out = Vec::with_capacity(text.len() / 4 * 3);
        let quads = text.len() / 4;
        for (q, quad) in text.chunks(4).enumerate() {
            let pad = quad.iter().rev().take_while(|&&c| c == b'=').count();
            if pad > 2 || (pad > 0 && q + 1 != quads) {
                return None;
            }
            let mut n = 0u32;
            for &c in &quad[..4 - pad] {
                n = (n << 6) | value(c)?;
            }
            n <<= 6 * pad as u32;
            let bytes = [(n >> 16) as u8, (n >> 8) as u8, n as u8];
            out.extend_from_slice(&bytes[..3 - pad]);
        }
        Some(out)
    }
}

#[cfg(test)]
mod tests;
