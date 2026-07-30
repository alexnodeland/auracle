//! The full featurization pipeline: compile → render → **vet** → normalize →
//! extract. One render serves the vet report, the features, and (upstream in
//! the session layer) the audition buffer — DESIGN.md §2.1's "no candidate is
//! ever played live unvetted" is enforced here by construction.

use quiver::PatchError;
use ricercar_grammar::PatchTree;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::audio::{audio_features, AudioFeatures};
use crate::loudness::normalize_to;
use crate::phrase::PhraseSpec;
use crate::render::{render_phrase, RenderedPhrase};
use crate::structural::{struct_features, StructFeatures};
use crate::vet::{vet, VetConfig, VetFailure, VetReport};

/// Target integrated loudness for audition and feature extraction.
pub const TARGET_LUFS: f64 = -18.0;

/// Why featurization rejected a candidate.
#[derive(Debug, Error)]
pub enum FeaturizeError {
    /// The term failed to compile into a quiver patch (grammar bug — the
    /// typed prior should make this unreachable).
    #[error("compile failed: {0}")]
    Compile(#[from] PatchError),
    /// The render was quarantined by the vetting gate.
    #[error("quarantined: {0}")]
    Quarantined(#[from] VetFailure),
}

/// Everything the taste model and audition path need for one candidate.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Features {
    /// Perceptual descriptors of the normalized render.
    pub audio: AudioFeatures,
    /// Render-free structural descriptors of the term.
    pub structural: StructFeatures,
    /// Raw-render measurements from the vet gate.
    pub vet: VetReport,
    /// Integrated loudness before normalization (LUFS).
    pub lufs_before: f64,
    /// Gain applied to reach [`TARGET_LUFS`] (dB).
    pub gain_db: f64,
}

impl Features {
    /// The concatenated feature vector `φ(x) = [φ_audio ; φ_struct]`.
    pub fn phi(&self) -> Vec<f64> {
        let mut v = self.audio.to_vec();
        v.extend(self.structural.to_vec());
        v
    }

    /// Names for [`Self::phi`] entries, in order.
    pub fn phi_names() -> Vec<&'static str> {
        AudioFeatures::NAMES
            .iter()
            .chain(StructFeatures::NAMES.iter())
            .copied()
            .collect()
    }
}

/// A vetted, loudness-normalized render plus its features — the single
/// artifact one candidate costs.
#[derive(Clone, Debug)]
pub struct VettedCandidate {
    /// The normalized render (this exact buffer is what audition plays).
    pub render: RenderedPhrase,
    /// The extracted features.
    pub features: Features,
}

/// Run the full pipeline for one term.
pub fn featurize(tree: &PatchTree, spec: &PhraseSpec) -> Result<VettedCandidate, FeaturizeError> {
    let mut render = render_phrase(tree, spec)?;
    let report = vet(&render.samples, &VetConfig::default())?;
    // A signal that passed the RMS floor always clears the loudness gate in
    // practice; treat a `None` here as silence for safety.
    let norm = normalize_to(&mut render.samples, render.sample_rate, TARGET_LUFS)
        .ok_or(VetFailure::Silent { rms: report.rms })?;
    let audio = audio_features(&render);
    let structural = struct_features(tree);
    Ok(VettedCandidate {
        render,
        features: Features {
            audio,
            structural,
            vet: report,
            lufs_before: norm.lufs_before,
            gain_db: norm.gain_db,
        },
    })
}
