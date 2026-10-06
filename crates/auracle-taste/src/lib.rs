//! # auracle-taste
//!
//! The **user model**: a latent utility over patches, fit from human feedback,
//! persisted across sessions.
//!
//! Animated: [*How Auracle learns what you like*](https://auracle.alexnodeland.com/docs/films.html#film-taste) for anyone, and
//! [*The math*](https://auracle.alexnodeland.com/docs/films.html#film-math) for the utility, the likelihoods, the posterior and
//! calibration as this crate computes them.
//!
//! ```text
//! u(x) = θ_z · φ(x)        z ~ per-session style latent (mixture of experts)
//! ```
//!
//! One utility, three observation likelihoods in a single fugue program (the
//! reference: *One utility, three likelihoods*): Bradley–Terry duels
//! (primary), keep/kill against a
//! per-session threshold latent τ, and ordinal star ratings with learned
//! cutpoints. Inference is fugue's adaptive MH over the taste program;
//! the [`observe::ObservationLog`] is the profile's source of truth and the
//! posterior can always be re-fit from it.
//!
//! Ships at **K = 1** (a one-component mixture *is* Bayesian linear
//! regression); the mixture machinery (per-session style sites) is present
//! and unlocked by config.
//!
//! The M3 gate lives in this crate's tests: a [`synthetic::SyntheticUser`]
//! with ground-truth θ* generates noisy feedback and the posterior must
//! recover θ* and predict held-out choices — the taste core is falsifiable
//! with no UI and no human.

pub mod model;
pub mod observe;
pub mod standardize;
pub mod synthetic;
#[cfg(test)]
mod testkit;

pub use model::{TasteConfig, TasteModel, TastePosterior, TasteSample, MAX_NORMAL_SD};
pub use observe::{
    Feedback, FitSet, Observation, ObservationLog, Provenance, PHI_SCHEMA, PHI_SCHEMA_STANDARDIZED,
};
pub use standardize::Standardizer;
pub use synthetic::{IdealPointUser, MixtureSyntheticUser, SyntheticUser};
