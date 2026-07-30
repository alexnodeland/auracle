//! The standard audition phrase.
//!
//! Audio features are only comparable across patches when every patch is
//! rendered under an **identical stimulus** — same notes, same timing, same
//! RNG seed for noise. This module owns that stimulus. The default phrase
//! covers register (a held root, a higher stab, a low note) and articulation
//! (sustain and release tail), in ~3.2 s of audio.

use serde::{Deserialize, Serialize};

/// One note of the phrase.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Note {
    /// Pitch as V/Oct offset from C4.
    pub voct: f64,
    /// Gate-on duration, seconds.
    pub on_s: f64,
    /// Gate-off duration after the note, seconds.
    pub off_s: f64,
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
                // Held root: C4.
                Note {
                    voct: 0.0,
                    on_s: 0.60,
                    off_s: 0.15,
                },
                // Stab a minor third up: Eb4.
                Note {
                    voct: 3.0 / 12.0,
                    on_s: 0.25,
                    off_s: 0.10,
                },
                // Low held note with a long release window: C3.
                Note {
                    voct: -1.0,
                    on_s: 0.80,
                    off_s: 1.25,
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
}
