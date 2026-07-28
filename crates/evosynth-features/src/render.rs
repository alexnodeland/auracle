//! Headless rendering of a compiled voice under the standard phrase.
//!
//! Determinism contract: quiver's thread-local RNG is re-seeded from
//! [`PhraseSpec::seed`] immediately before ticking, and the patch is compiled
//! fresh per render, so `(term, spec)` → bit-identical samples on any thread.

use evosynth_grammar::{compile, PatchTree};
use quiver::PatchError;

use crate::phrase::PhraseSpec;

/// A rendered phrase: mono samples normalized from quiver's ±5 V audio level
/// to nominal ±1.0.
#[derive(Clone, Debug)]
pub struct RenderedPhrase {
    /// Mono samples (left/right average), nominal ±1.0 full scale.
    pub samples: Vec<f64>,
    /// Sample rate in Hz.
    pub sample_rate: f64,
    /// Sample index where each note's gate opens (for attack-time features).
    pub note_onsets: Vec<usize>,
}

/// Compile `tree` and render it playing the phrase.
pub fn render_phrase(tree: &PatchTree, spec: &PhraseSpec) -> Result<RenderedPhrase, PatchError> {
    let mut voice = compile(tree, spec.sample_rate)?;

    // Determinism: fix the stochastic-module RNG for this render.
    quiver::rng::seed(spec.seed);

    let mut samples = Vec::with_capacity(spec.total_samples());
    let mut note_onsets = Vec::with_capacity(spec.notes.len());

    for note in &spec.notes {
        voice.pitch.set(note.voct);
        note_onsets.push(samples.len());
        voice.gate.set(5.0);
        for _ in 0..(note.on_s * spec.sample_rate) as usize {
            let (l, r) = voice.patch.tick();
            samples.push((l + r) * 0.5 / 5.0);
        }
        voice.gate.set(0.0);
        for _ in 0..(note.off_s * spec.sample_rate) as usize {
            let (l, r) = voice.patch.tick();
            samples.push((l + r) * 0.5 / 5.0);
        }
    }

    Ok(RenderedPhrase {
        samples,
        sample_rate: spec.sample_rate,
        note_onsets,
    })
}
