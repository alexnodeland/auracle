//! A CAPTURE's take: the audio a capture recorded, saved with the sound.
//!
//! [`crate::AudioNode::Capture`] records what is patched into it and plays
//! the recording back as a source ([ADR-015](../../../docs/decisions/015-audio-in.md),
//! RFC-008's *resample*). The recording is the sound's content, as a sample
//! player's buffer is, so it lives **in the term** and is saved wherever the
//! term is: a bank entry, a shared patch, the bench.
//!
//! ## The saved form, after quiver's `Capture`
//!
//! A take serializes exactly as quiver's `Capture` saves its own recording
//! (`ModuleDef.state`): `{format, sample_rate, length, data}`, with `data` the
//! samples as little-endian `f32` in standard base64 ([`TAKE_FORMAT`]). The
//! encoding is lossless, so a reloaded take plays back bit-identically, and
//! the state a compiled capture reports reads straight back in
//! ([`crate::CompiledVoice::take`]). quiver's extra `capacity` key is ignored
//! on the way in and not written: the compiler sizes the buffer.
//!
//! ## The bound
//!
//! A saved take is untrusted input (a session file can be edited or shared),
//! and [`Take::from_saved`] holds it to the rules
//! `auracle_features::SavedClip` follows for an audition clip:
//!
//! - a known format tag;
//! - a finite, positive rate no higher than [`MAX_TAKE_RATE`];
//! - a length no longer than [`TAKE_SECONDS`] at that rate, which is quiver's
//!   own default `Capture` buffer, the one the compiler builds;
//! - data whose length agrees with the length claimed, checked **before** it
//!   is decoded, so nothing allocates beyond what the file's own text
//!   occupies;
//! - finite samples (quiver refuses a non-finite one too).
//!
//! **A take that breaks a rule never costs the sound.** Deserializing a term
//! cannot fail on its take: an unreadable one loads empty, remembers why
//! ([`Take::unreadable`]), and the session counts the sound as repaired, so
//! the player is told. The patch around it comes back whole.
//!
//! It also keeps the saved text it could not read, unserialized, so a sound
//! the session holds back because that take was its only source can be
//! written back JSON-equal to what was loaded ([`Take::kept`]); nothing else ever
//! writes it.
//!
//! ## Not a trace site
//!
//! A take is data, not a random choice, so [`crate::genome`] neither encodes
//! nor decodes it: a walk can never propose a new one. A term rebuilt from
//! its trace comes back with empty takes, and
//! [`crate::PatchTree::inherit_uids`] carries them back from the term it was
//! made from, as it carries node identities.

use std::sync::Arc;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use thiserror::Error;

/// The saved form's format tag: mono `f32` samples, little-endian, in
/// standard base64 (RFC 4648, padded). quiver's `Capture` writes the same.
pub const TAKE_FORMAT: &str = "f32le-base64";

/// The longest take, in seconds at the take's own rate: quiver's default
/// `Capture` buffer, which is the buffer the compiler builds, so a take a
/// compiled capture records always fits it. Four seconds of mono `f32` at
/// 48 kHz is 768 KB, about 1 MB in a saved session.
pub const TAKE_SECONDS: f64 = quiver::prelude::Capture::DEFAULT_SECONDS;

/// The highest rate a take may claim. Its length bound is
/// [`TAKE_SECONDS`] at its own rate, so the rate is bounded too (the same
/// ceiling an audition clip has).
pub const MAX_TAKE_RATE: f64 = 192_000.0;

/// Why a take could not be made or loaded. Never shown as it is: a sound
/// whose take is unreadable is reported as a repaired sound.
#[derive(Debug, Error, PartialEq)]
pub enum TakeError {
    /// The saved take is not an object of the four fields.
    #[error("the take is not a saved take ({0})")]
    Shape(String),
    /// The saved take names a format this build does not read.
    #[error("format must be \"{TAKE_FORMAT}\"")]
    Format,
    /// The rate is not finite, not positive, or above [`MAX_TAKE_RATE`].
    #[error("sample rate {0} is not a rate a take can have")]
    Rate(f64),
    /// Longer than [`TAKE_SECONDS`] at the take's rate.
    #[error("{length} samples is longer than {TAKE_SECONDS} s at {rate} Hz")]
    TooLong {
        /// Samples claimed.
        length: usize,
        /// The take's rate.
        rate: f64,
    },
    /// The data does not hold the samples claimed, or is not base64.
    #[error("the data does not hold {0} samples")]
    Data(usize),
    /// A sample is not a finite number.
    #[error("a sample is not a finite number")]
    NonFinite,
}

/// The saved form of a take, field for field what a saved sound holds.
///
/// Public and unvalidated on purpose: this is what a file *says*, and
/// [`Take::from_saved`] decides whether to believe it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SavedTake {
    /// [`TAKE_FORMAT`].
    pub format: String,
    /// The rate the take was recorded at, Hz.
    pub sample_rate: f64,
    /// Samples.
    pub length: usize,
    /// `length` little-endian `f32` samples, base64.
    pub data: String,
}

/// What a non-empty take holds. Built once and shared: a term is cloned at
/// every step of a walk, and a take is the one large thing in it.
struct Body {
    samples: Vec<f32>,
    sample_rate: f64,
    /// The saved text, encoded once, so serializing a term (which the render
    /// key does for every featurize) copies a string rather than re-encoding.
    data: String,
    /// FNV-1a 64 of the rate and the samples: equality's fast path.
    hash: u64,
}

/// A CAPTURE's recording: mono `f32` samples at the rate they were made at,
/// or nothing.
///
/// Cheap to clone (the samples are shared). Equality is equality of content;
/// whether a saved take was unreadable is bookkeeping and does not count.
#[derive(Clone, Default)]
pub struct Take {
    body: Option<Arc<Body>>,
    /// Set when a saved take could not be read, so this one loaded empty:
    /// why. Never serialized.
    unreadable: Option<String>,
    /// The saved value that could not be read, as it was. Written back only
    /// when `keep` is set ([`Take::kept`]).
    raw: Option<Arc<serde_json::Value>>,
    /// Serialize `raw` verbatim instead of the (empty) take.
    keep: bool,
}

impl Take {
    /// No recording: what a fresh CAPTURE holds, and what plays silence.
    pub fn empty() -> Self {
        Self::default()
    }

    /// A take from recorded samples at `sample_rate`, held to the same bound a
    /// saved take is (an empty slice is the empty take).
    pub fn from_samples(samples: &[f32], sample_rate: f64) -> Result<Self, TakeError> {
        check_rate(sample_rate)?;
        check_length(samples.len(), sample_rate)?;
        if samples.iter().any(|s| !s.is_finite()) {
            return Err(TakeError::NonFinite);
        }
        if samples.is_empty() {
            return Ok(Self::empty());
        }
        Ok(Self::assemble(samples.to_vec(), sample_rate))
    }

    /// Load a saved take, refusing anything a take cannot be (the module
    /// doc's *The bound*). Allocates only in proportion to `saved.data`, and
    /// only once its length has been checked against the samples it claims.
    pub fn from_saved(saved: &SavedTake) -> Result<Self, TakeError> {
        if saved.format != TAKE_FORMAT {
            return Err(TakeError::Format);
        }
        check_rate(saved.sample_rate)?;
        check_length(saved.length, saved.sample_rate)?;
        if saved.length == 0 {
            return Ok(Self::empty());
        }
        // The data's length is a function of the samples claimed (bounded
        // just above), so a file claiming a few samples cannot make the
        // decoder allocate for a large string.
        let bytes = saved.length * 4;
        if saved.data.len() != bytes.div_ceil(3) * 4 {
            return Err(TakeError::Data(saved.length));
        }
        let raw = base64::decode(&saved.data).ok_or(TakeError::Data(saved.length))?;
        if raw.len() != bytes {
            return Err(TakeError::Data(saved.length));
        }
        let samples: Vec<f32> = raw
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect();
        if samples.iter().any(|s| !s.is_finite()) {
            return Err(TakeError::NonFinite);
        }
        Ok(Self::assemble(samples, saved.sample_rate))
    }

    /// The saved form, or `None` for the empty take. Lossless: a take loaded
    /// from it plays the same samples.
    pub fn to_saved(&self) -> Option<SavedTake> {
        self.body.as_ref().map(|b| SavedTake {
            format: TAKE_FORMAT.to_string(),
            sample_rate: b.sample_rate,
            length: b.samples.len(),
            data: b.data.clone(),
        })
    }

    /// Whether nothing is recorded.
    pub fn is_empty(&self) -> bool {
        self.body.is_none()
    }

    /// The recording (empty for the empty take).
    pub fn samples(&self) -> &[f32] {
        self.body.as_ref().map_or(&[], |b| &b.samples)
    }

    /// Samples recorded.
    pub fn len(&self) -> usize {
        self.samples().len()
    }

    /// The rate the take was recorded at, Hz (`None` for the empty take).
    pub fn sample_rate(&self) -> Option<f64> {
        self.body.as_ref().map(|b| b.sample_rate)
    }

    /// Length in seconds (0 for the empty take).
    pub fn seconds(&self) -> f64 {
        self.body
            .as_ref()
            .map_or(0.0, |b| b.samples.len() as f64 / b.sample_rate)
    }

    /// When a saved take could not be read and this one loaded empty in its
    /// place: why.
    pub fn unreadable(&self) -> Option<&str> {
        self.unreadable.as_deref()
    }

    /// This take, to be written back as it was loaded: an unreadable take
    /// that kept its saved value serializes that value verbatim, so a sound
    /// held back for it loses nothing in a save. Any other take is unchanged.
    /// Equality and every other reading of the take are unaffected.
    pub fn kept(&self) -> Self {
        Self {
            keep: self.raw.is_some(),
            ..self.clone()
        }
    }

    /// Whether serializing this take writes nothing: an empty take, unless it
    /// is an unreadable one [`Self::kept`] for writing back.
    pub fn saves_nothing(&self) -> bool {
        self.body.is_none() && !(self.keep && self.raw.is_some())
    }

    fn refused(why: String, raw: serde_json::Value) -> Self {
        Self {
            body: None,
            unreadable: Some(why),
            raw: Some(Arc::new(raw)),
            keep: false,
        }
    }

    fn assemble(samples: Vec<f32>, sample_rate: f64) -> Self {
        let mut bytes = Vec::with_capacity(samples.len() * 4);
        for s in &samples {
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        let mut hash = fnv1a64(FNV_OFFSET_64, &sample_rate.to_bits().to_le_bytes());
        hash = fnv1a64(hash, &bytes);
        Self {
            body: Some(Arc::new(Body {
                data: base64::encode(&bytes),
                samples,
                sample_rate,
                hash,
            })),
            ..Self::default()
        }
    }
}

/// What a take is, not what it holds: a term printed with `{:?}` would
/// otherwise print every sample.
impl std::fmt::Debug for Take {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut d = f.debug_struct("Take");
        d.field("samples", &self.len())
            .field("sample_rate", &self.sample_rate());
        if let Some(why) = &self.unreadable {
            d.field("unreadable", why);
        }
        d.finish()
    }
}

impl PartialEq for Take {
    fn eq(&self, other: &Self) -> bool {
        match (&self.body, &other.body) {
            (None, None) => true,
            (Some(a), Some(b)) => {
                Arc::ptr_eq(a, b)
                    || (a.hash == b.hash
                        && a.sample_rate.to_bits() == b.sample_rate.to_bits()
                        && a.samples.len() == b.samples.len()
                        && a.samples
                            .iter()
                            .zip(&b.samples)
                            .all(|(x, y)| x.to_bits() == y.to_bits()))
            }
            _ => false,
        }
    }
}

impl Serialize for Take {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match (&self.raw, self.keep) {
            (Some(raw), true) => raw.serialize(s),
            _ => self.to_saved().serialize(s),
        }
    }
}

/// Never fails on what the take holds: anything that is not a readable take
/// loads as the empty take, marked [`Take::unreadable`]. Only a deserializer
/// that cannot produce a value at all (truncated input) is an error, and that
/// error is the term's, not the take's.
impl<'de> Deserialize<'de> for Take {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(d)?;
        if value.is_null() {
            return Ok(Self::empty());
        }
        Ok(serde_json::from_value::<SavedTake>(value.clone())
            .map_err(|e| TakeError::Shape(e.to_string()))
            .and_then(|saved| Take::from_saved(&saved))
            .unwrap_or_else(|e| Take::refused(e.to_string(), value)))
    }
}

fn check_rate(rate: f64) -> Result<(), TakeError> {
    if rate.is_finite() && rate > 0.0 && rate <= MAX_TAKE_RATE {
        Ok(())
    } else {
        Err(TakeError::Rate(rate))
    }
}

fn check_length(length: usize, rate: f64) -> Result<(), TakeError> {
    if length as f64 > TAKE_SECONDS * rate {
        Err(TakeError::TooLong { length, rate })
    } else {
        Ok(())
    }
}

const FNV_OFFSET_64: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME_64: u64 = 0x0000_0100_0000_01b3;

fn fnv1a64(state: u64, bytes: &[u8]) -> u64 {
    let mut h = state;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(FNV_PRIME_64);
    }
    h
}

/// Standard base64 (RFC 4648, padded), as quiver's `Capture` writes it. The
/// same codec `auracle_features`' audition clips use; each crate keeps its
/// own copy because the grammar cannot depend on the features crate. Public
/// for the crates above it: a saved session's fitted draws use it too.
pub mod base64 {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    /// `bytes` as base64.
    pub fn encode(bytes: &[u8]) -> String {
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

    /// The bytes `text` holds, or `None` when it is not padded base64.
    pub fn decode(text: &str) -> Option<Vec<u8>> {
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
