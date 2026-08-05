//! The full featurization pipeline: compile → render → **vet** → normalize →
//! extract. One render serves the vet report, the features, and (upstream in
//! the session layer) the audition buffer — the vetting gate's "no candidate is
//! ever played live unvetted" is enforced here by construction.

use auracle_grammar::PatchTree;
use quiver::PatchError;
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
    /// A continuous site of the term sits outside its declared range, so the
    /// φ this would produce is not a measurement of anything.
    ///
    /// The quarantine used to catch only *audio* pathology — a render that was
    /// silent, clipped or DC-dominated — which is a gate on the sound and not
    /// on the term. `amp.sustain = 1e30` renders perfectly well (the limiter
    /// bounds it), so it passed the vet, and its φ then entered the observation
    /// log where one row's outlier set the whole `amp_sustain` column's scale
    /// and killed the coordinate. A row the model cannot interpret must not be
    /// recorded as evidence, and this is the last place that can say so.
    #[error("out of domain: {value} at {site} (every knob is normalized 0–1)")]
    OutOfDomain {
        /// The offending trace address.
        site: String,
        /// The value found there.
        value: f64,
    },
    /// An extracted coordinate is not a finite number.
    ///
    /// Distinct from [`Self::OutOfDomain`]: the term was legal, so this is the
    /// *measurement* having gone wrong (an audio descriptor over a degenerate
    /// buffer), and it names the coordinate rather than a genome site.
    #[error("feature {name} is not finite ({value})")]
    NonFiniteFeature {
        /// The φ coordinate's name.
        name: String,
        /// The value computed for it.
        value: f64,
    },
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
    /// Gain applied (dB) — toward [`TARGET_LUFS`], but never past
    /// [`auracle_features::PEAK_CEILING`](crate::loudness::PEAK_CEILING).
    pub gain_db: f64,
    /// Makeup gain given up so the render would not clip, in dB (≥ 0).
    ///
    /// Zero for most patches. Positive means this one auditions *below*
    /// [`TARGET_LUFS`] because its crest factor would not let it reach the
    /// target without going over full scale — so a surface comparing two
    /// candidates' levels can say which of them was pulled down and by how
    /// much, rather than presenting a peak-limited patch as a quiet one.
    ///
    /// `#[serde(default)]` is forward-looking rather than a migration.
    /// Features cross the farm as [`crate::CachedFeatures`] within a single
    /// boot, where the worker's version stamp guarantees one build on both
    /// ends, and nothing persists them across boots today — `BankEntry` stores
    /// trees, so a reloaded pool is re-featurized under whatever normalizer is
    /// current. The default matters the moment the persistent render cache
    /// lands, and the thing to note there is that a row written before this
    /// ceiling carries a `gain_db` that *would* clip: normalization changing
    /// has to invalidate the cache namespace, not merely default a field.
    #[serde(default)]
    pub peak_reduction_db: f64,
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
    // Before the render, not after: a term with a knob outside its range is not
    // a candidate that happens to sound bad, it is a term whose φ would be a
    // lie, and the ~600 ms render is wasted on it either way. This is the gate
    // that keeps the observation log clean — every row in the log came through
    // here.
    if let Some((site, value)) = tree.domain_violations().into_iter().next() {
        return Err(FeaturizeError::OutOfDomain { site, value });
    }
    let mut render = render_phrase(tree, spec)?;
    let report = vet(&render.samples, &VetConfig::for_spec(spec))?;
    // A signal that passed the RMS floor always clears the loudness gate in
    // practice; treat a `None` here as silence for safety.
    let norm = normalize_to(&mut render.samples, render.sample_rate, TARGET_LUFS)
        .ok_or(VetFailure::Silent { rms: report.rms })?;
    let audio = audio_features(&render);
    let structural = struct_features(tree);
    let features = Features {
        audio,
        structural,
        vet: report,
        lufs_before: norm.lufs_before,
        gain_db: norm.gain_db,
        peak_reduction_db: norm.peak_reduction_db,
    };
    // The second half of the same guard, on the vector rather than the term.
    // Costs one pass over 37 doubles against a render that took most of a
    // second, and it is the only thing standing between a NaN out of a
    // spectral descriptor and a posterior fit that returns all-NaN θ.
    for (name, value) in Features::phi_names().iter().zip(features.phi()) {
        if !value.is_finite() {
            return Err(FeaturizeError::NonFiniteFeature {
                name: (*name).to_string(),
                value,
            });
        }
    }
    Ok(VettedCandidate { render, features })
}
