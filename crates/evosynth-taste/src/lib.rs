//! # evosynth-taste
//!
//! The **user model**: a latent utility over patches, fit from human feedback,
//! persisted across sessions.
//!
//! ```text
//! u(x) = θ_z · φ(x)        z ~ per-session style latent (mixture of experts)
//! ```
//!
//! One utility, three observation likelihoods (all `observe` statements in a
//! single fugue program — see DESIGN.md §1.3):
//!
//! | signal          | likelihood                                    |
//! |-----------------|-----------------------------------------------|
//! | pairwise duel   | Bradley–Terry: `p(A ≻ B) = σ(u(A) − u(B))`    |
//! | keep / kill     | `σ(u(x) − τ_session)`, τ a per-session latent |
//! | star rating     | ordinal regression with learned cutpoints      |
//!
//! ## Staging
//!
//! Ships at **K = 1** (a one-component mixture *is* Bayesian linear
//! regression — same code path, trivial inference). K > 1 unlocks per-session
//! style discovery; pinning a named profile = conditioning on `z`.
//!
//! ## The synthetic user (M3 gate — non-negotiable)
//!
//! This crate is validated headlessly against a simulated user: ground-truth
//! θ* generating noisy synthetic feedback, asserting posterior concentration
//! on θ* and shrinking regret. No UI exists before this passes.

pub mod utility {
    //! The mixture-of-linear-experts utility `u_θ` and its priors.
}

pub mod observe {
    //! Feedback event types and the three likelihoods conditioning `u`.
}

pub mod posterior {
    //! Inference over (θ, z, τ, cutpoints) via fugue; online updates.
}

pub mod profile {
    //! Persistence: observation log + posterior snapshots; named style
    //! profiles (conditioning on z).
}

pub mod synthetic {
    //! The simulated user: ground-truth θ*, noisy feedback generators,
    //! recovery/regret metrics.
}

#[cfg(test)]
mod tests {
    #[test]
    fn workspace_smoke() {
        // Replaced in M3 by the synthetic-user suite: posterior recovers θ*;
        // acquisition regret shrinks with observations.
    }
}
