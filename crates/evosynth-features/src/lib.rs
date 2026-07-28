//! # evosynth-features
//!
//! The feature pipeline: renders every candidate patch under an identical
//! stimulus and extracts the feature vector `φ(x) = [φ_audio ; φ_struct]`
//! that the taste model scores.
//!
//! ## Pipeline invariants (see DESIGN.md §2)
//!
//! - **Standard phrase**: a fixed short mono phrase (note-on / sustain /
//!   release) rendered headlessly through quiver. Features are only
//!   comparable across patches under an identical stimulus.
//! - **LUFS normalization**: every render is loudness-normalized before
//!   audition *and* feature extraction — otherwise "louder" poisons θ.
//! - **Deterministic renders**: fixed RNG seed for noise/analog drift so a
//!   patch's features are reproducible across the SMC loop.
//!
//! ## Feature families
//!
//! - `φ_audio` (costs a render): spectral centroid/spread/flux, loudness
//!   envelope stats, attack time, harmonicity, roughness, …
//! - `φ_struct` (free): module histogram, term depth, modulation density,
//!   parallel-branch count, … — enables the cheap screening cascade.

pub mod phrase {
    //! The standard audition phrase spec (notes, tempo, length, seed).
}

pub mod render {
    //! Headless rendering of a compiled patch under the standard phrase,
    //! plus LUFS normalization.
}

pub mod audio {
    //! `φ_audio`: perceptual descriptors extracted from the normalized render.
}

pub mod structural {
    //! `φ_struct`: render-free descriptors extracted from the term itself.
}

#[cfg(test)]
mod tests {
    #[test]
    fn workspace_smoke() {
        // Replaced by real tests in M2: identical (term, seed) → identical
        // feature vector; LUFS within tolerance across the palette.
    }
}
