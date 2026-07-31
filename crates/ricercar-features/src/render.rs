//! Headless rendering of a compiled voice under the standard phrase.
//!
//! Determinism contract: quiver's thread-local RNG is re-seeded from
//! [`PhraseSpec::seed`] immediately before ticking, and the patch is compiled
//! fresh per render, so `(term, spec)` → bit-identical samples on any thread.

use quiver::PatchError;
use ricercar_grammar::{compile, PatchTree};

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

/// A playback-ready audition buffer.
///
/// `f32` because that is the **only** form a stored render is ever consumed
/// in — every consumer in the tree converts at the boundary for WebAudio
/// (`ricercar_wasm`'s `render_of` / `edit_render`). Storing it converted
/// halves resident audio and removes a per-request conversion pass.
///
/// One-way door, stated explicitly: **features are never derived from an
/// `Audition`.** [`crate::featurize`] measures on the f64 [`RenderedPhrase`]
/// and always will; anything that wants φ from a term must featurize it, not
/// analyze its audition buffer.
#[derive(Clone, Debug)]
pub struct Audition {
    /// Mono samples, nominal ±1.0 full scale, loudness-normalized.
    pub samples: Vec<f32>,
    /// Sample rate in Hz.
    pub sample_rate: f64,
}

impl Audition {
    /// Resident bytes of the sample buffer (for memo accounting).
    pub fn bytes(&self) -> usize {
        self.samples.len() * std::mem::size_of::<f32>()
    }
}

impl RenderedPhrase {
    /// The playback-ready view of this render.
    pub fn to_audition(&self) -> Audition {
        Audition {
            samples: self.samples.iter().map(|s| *s as f32).collect(),
            sample_rate: self.sample_rate,
        }
    }
}

/// Re-derive the audition buffer of an already-featurized term **without**
/// re-running the loudness analysis, using the `gain_db` its
/// [`crate::Features`] recorded.
///
/// Bit-identical to what [`crate::featurize`] produced for the same term:
/// [`crate::loudness::normalize_to`] measures a gain and then applies it as a
/// *uniform scalar multiply* over the buffer, so replaying the recorded gain
/// reproduces the same products exactly. `gain_db` is stored already clamped
/// (`loudness::MAX_GAIN_DB`), so no clamp is re-applied here — clamping twice
/// would be a no-op, and not clamping at all is what keeps this in lockstep
/// with the one place the decision is made.
///
/// This is the second code path that must stay in lockstep with `featurize`'s
/// normalization forever; `render_playback_is_bit_identical` is the test that
/// keeps it honest.
pub fn render_playback(
    tree: &PatchTree,
    spec: &PhraseSpec,
    gain_db: f64,
) -> Result<Audition, PatchError> {
    let mut render = render_phrase(tree, spec)?;
    let gain = 10f64.powf(gain_db / 20.0);
    for s in render.samples.iter_mut() {
        *s *= gain;
    }
    Ok(render.to_audition())
}
