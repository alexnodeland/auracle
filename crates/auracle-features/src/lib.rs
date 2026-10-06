//! # auracle-features
//!
//! The feature pipeline: renders every candidate patch under an identical
//! stimulus and extracts the feature vector `φ(x) = [φ_audio ; φ_struct]`
//! that the taste model scores.
//!
//! Animated: [*The sound engine*](https://auracle.alexnodeland.com/docs/films.html#film-dsp) walks the audition phrase, the vetting
//! gate, loudness normalization and the features, on the engine's own renders.
//!
//! ## Pipeline invariants (the reference: *Audition*, *Features*)
//!
//! - **Standard phrase** ([`phrase::PhraseSpec`]): a fixed short mono phrase;
//!   features are only comparable across patches under an identical stimulus.
//! - **Determinism** ([`render`]): quiver's RNG is re-seeded per render, so
//!   `(term, spec)` → bit-identical samples.
//! - **Vetting gate** ([`vet`]): raw renders are inspected for non-finite,
//!   silent, runaway, or DC-dominated output *before* anything else; failures
//!   are quarantined and never auditioned.
//! - **LUFS normalization** ([`loudness`]): K-weighted gated loudness matched
//!   to a fixed target before audition *and* feature extraction — otherwise
//!   "louder" poisons the preference data.
//!
//! - **Audition clips** ([`clip`]): an AUDIO IN is measured with the
//!   stimulus's clip, a capture of the player's input or the built-in
//!   reference, read on the render's own clock, so a patch that listens is
//!   as repeatable as one that does not.
//! - **Memoization** ([`cache`]): because `(term, spec) → φ` is pure, a
//!   featurization the engine has already performed is replayed rather than
//!   re-rendered. A hit is indistinguishable from a miss by construction —
//!   the same [`pipeline::Features`] object comes back either way.
//!
//! [`pipeline::featurize`] composes it all; the [`pipeline::VettedCandidate`]
//! it returns carries the exact buffer audition will play. [`render::Audition`]
//! is that buffer in the f32 form every consumer actually wants, and
//! [`render::render_playback`] reproduces it bit-identically from a term plus
//! its recorded `gain_db`, which is what makes deferring the buffer safe.

pub mod audio;
pub mod cache;
pub mod clip;
pub mod explain;
pub mod face;
pub mod file;
pub mod loudness;
pub mod phrase;
pub mod pipeline;
pub mod probe;
pub mod render;
pub mod structural;
pub mod vet;

pub use audio::{audio_features, AudioFeatures};
pub use cache::{
    cache_namespace, canonical_tree_json, featurize_memo, render_key, CachedFeatures, MemoStats,
    RenderMemo, DEFAULT_AUDIO_CAP, DEFAULT_FEATURE_CAP, QUIVER_DSP_VERSION, RENDER_EPOCH,
};
pub use clip::{
    reference, AuditionClip, ClipError, ClipSource, SavedClip, CLIP_FORMAT, MAX_CLIP_SECONDS,
};
pub use face::{Face, FACE_BANDS, FACE_LEN, FACE_SLICES};
pub use file::{
    featurize_file, file_masked_names, file_observed, FileError, FileFeatures, FILE_MASKED,
    FILE_MAX_SECONDS,
};
pub use loudness::{integrated_lufs, normalize_to, MAX_GAIN_DB, PEAK_CEILING};
pub use phrase::PhraseSpec;
pub use pipeline::{featurize, Features, FeaturizeError, VettedCandidate, TARGET_LUFS};
pub use probe::{cable_levels, probe_cables, CableLevel, CableProbe, PROBE_FLOOR_DB};
pub use render::{render_phrase, render_playback, Audition, RenderedPhrase};
pub use structural::{struct_features, StructFeatures};
pub use vet::{vet, VetConfig, VetFailure, VetReport};

#[cfg(test)]
mod tests;
