//! The standard audition phrase.
//!
//! Audio features are only comparable across patches when every patch is
//! rendered under an **identical stimulus** — same notes, same timing, same
//! RNG seed for noise. This module owns that stimulus.
//!
//! ## The v2 phrase, and why each segment exists
//!
//! The original 3-note phrase (0.6 s stab / 0.25 s stab / 0.8 s low note) was
//! the loop's weakest link, and the deficit *compounded* with every
//! correctness fix: it could not discriminate slow pads (a 2 s attack was
//! silent for most of the stimulus), anything modulated below ~1 Hz (no
//! register-constant segment long enough to hold a modulation cycle),
//! anything above Eb4 (its highest note), or how a patch stacks
//! polyphonically (strictly monophonic) — so the grammar could express
//! patches the audition could never reveal, and the taste model was asked to
//! learn preferences over evidence that wasn't in φ. The v2 default covers
//! each hole with the cheapest segment that reveals it:
//!
//! 1. **C4 held 1.8 s** — the attack window (onset → next onset) is now
//!    2.0 s instead of 0.75 s, and a register-constant sustain long enough
//!    that sub-Hz modulation completes most of a cycle
//!    ([`crate::audio::AudioFeatures::held_centroid_std`] measures it here).
//! 2. **C5 stab** — one octave above the old ceiling; with the fixed 0.5
//!    keytracking this is where dark patches reveal whether they speak at all
//!    up high ([`crate::audio::AudioFeatures::high_ratio`]).
//! 3. **C4+E4 dyad** ([`Note::chord`]) — a second compiled voice, gate-synced
//!    with the main voice, reveals intermodulation and mud when stacked
//!    ([`crate::audio::AudioFeatures::chord_flatness_delta`]). A dyad rather
//!    than a triad because render cost is per-voice-second and pairwise
//!    intermodulation is the first-order phenomenon.
//! 4. **C3 held + 1.1 s release window** — bass register, and kept *last* so
//!    the tail measurement (final 300 ms) still sees release length and
//!    delay/reverb tails, not a truncated chord decay.
//!
//! ~5.0 s of audio, ~2× the render cost of v1 (measured; the dyad's second
//! voice is the difference between wall seconds and rendered voice-seconds).
//! Changing the stimulus changes what every audio feature *means*, which is
//! why [`crate::audio::AudioFeatures::NAMES`] carry a stimulus tag — see the
//! migration note there.

use serde::{Deserialize, Serialize};

/// One note of the phrase.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Note {
    /// Pitch as V/Oct offset from C4.
    pub voct: f64,
    /// Gate-on duration, seconds.
    pub on_s: f64,
    /// Gate-off duration after the note, seconds.
    pub off_s: f64,
    /// Additional simultaneous pitches (V/Oct from C4), each rendered by its
    /// own compiled voice, gate-synced with this note. Empty for a mono note.
    ///
    /// Chord voices start cold at this note's onset (exactly how live voice
    /// allocation behaves) and, after the shared gate closes, keep ticking
    /// until their own output parks on silence — a truncated release tail is
    /// a broadband click that would poison every spectral feature.
    #[serde(default)]
    pub chord: Vec<f64>,
}

/// The audition stimulus: notes, sample rate, and the RNG seed used for any
/// stochastic module (noise, drift) so renders are bit-reproducible.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PhraseSpec {
    /// Sample rate in Hz.
    pub sample_rate: f64,
    /// Seed installed into quiver's thread-local RNG before rendering.
    pub seed: u64,
    /// The phrase notes, played in order.
    pub notes: Vec<Note>,
}

impl Default for PhraseSpec {
    fn default() -> Self {
        Self {
            sample_rate: 44_100.0,
            seed: 0xE05_F00D,
            notes: vec![
                // Held root: C4, long enough that slow attacks and sub-Hz
                // modulation are audible facts rather than invisible ones.
                Note {
                    voct: 0.0,
                    on_s: 1.80,
                    off_s: 0.20,
                    chord: Vec::new(),
                },
                // High stab: C5 — the register the old phrase never visited.
                Note {
                    voct: 1.0,
                    on_s: 0.30,
                    off_s: 0.15,
                    chord: Vec::new(),
                },
                // Stacked dyad: C4 + E4 on a second voice.
                Note {
                    voct: 0.0,
                    on_s: 0.50,
                    off_s: 0.20,
                    chord: vec![4.0 / 12.0],
                },
                // Low held note with a long release window: C3, kept last so
                // the tail features measure release/reverb, not a chord cut.
                Note {
                    voct: -1.0,
                    on_s: 0.80,
                    off_s: 1.10,
                    chord: Vec::new(),
                },
            ],
        }
    }
}

impl PhraseSpec {
    /// Total rendered length in samples.
    pub fn total_samples(&self) -> usize {
        self.notes
            .iter()
            .map(|n| ((n.on_s + n.off_s) * self.sample_rate) as usize)
            .sum()
    }

    /// Total rendered length in seconds.
    pub fn total_seconds(&self) -> f64 {
        self.notes.iter().map(|n| n.on_s + n.off_s).sum()
    }

    /// Largest number of voices gated on simultaneously anywhere in the
    /// phrase (1 for a purely monophonic spec). The vet gate's peak ceiling
    /// scales with this: N legitimate voices can legitimately sum to N× one
    /// voice's level, and that summing is signal, not runaway.
    pub fn max_voices(&self) -> usize {
        1 + self.notes.iter().map(|n| n.chord.len()).max().unwrap_or(0)
    }
}
