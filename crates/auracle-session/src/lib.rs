//! # auracle-session
//!
//! The **two-loop engine** (the reference: *The two loops*) every frontend
//! drives:
//!
//! - **Patch loop** (fast, silent): vetted prior draws fill a pool; once a
//!   posterior exists, a short typed-MH walk on
//!   `π_β ∝ p_grammar · exp(β·E[u_θ])` moves the pool toward the user's taste
//!   ([`engine::Engine::refine`]). Local refinement on that target, not a
//!   draw from it.
//! - **Taste loop** (slow, human-paced): feedback appends to the observation
//!   log as raw φ; the posterior re-fits from it, standardizing at fit time
//!   ([`engine::Engine::fit_posterior`]). Between fits each vote is folded in
//!   by importance reweighting, so the next question responds to the last
//!   answer.
//! - **Acquisition** between them: BALD — expected information gain about θ
//!   ([`engine::Engine::next_duel`]), which measurably beats the dueling
//!   Thompson rule it replaced and ties uniformly-random pairing
//!   ([`engine::Acquisition`] carries the numbers).
//!
//! Animated: [*Under the hood*](https://auracle.alexnodeland.com/docs/films.html#film-engine) follows both loops end to end;
//! [*The math*](https://auracle.alexnodeland.com/docs/films.html#film-math) covers acquisition, the search target and refinement.
//!
//! The M4 gate is this crate's closed-loop test: engine + synthetic user,
//! end-to-end through the *real* grammar → render → vet → features pipeline,
//! asserting the learned taste ranks genuinely-preferred patches on top.

pub mod belief;
pub mod calib;
pub mod engine;
pub mod farm;
pub mod guess;
pub mod job;
pub mod map;
pub mod migrate;
pub mod naming;
pub mod own;
pub mod perform;
pub mod surrogate;
pub mod walk;

#[cfg(test)]
mod testkit;

pub use belief::{Belief, BeliefRow};
pub use calib::{calibration, Calibration, Forecast, ProvenanceScore, ReliabilityBin};
pub use engine::{
    phi_names, tilt_weights, Acquisition, BankEntry, Candidate, ClipChange, ClipStatus,
    Contribution, DuelChoice, EditOutcome, Engine, Explanation, ImplicitEvent, LineageEvent,
    Origin, Profile, ReadmitError, RefineKeep, RefineOutcome, RenderPolicy, SessionConfig,
    SessionState, EVENTS_CAP, EVENT_PHI_KEEP, MIN_SESSION_OBS, OBS_PER_STYLE,
};
pub use farm::{draw_seed, Draw, PreFeaturized};
pub use guess::{
    guess_candidates, guess_is_current, guessable_insert, guessable_source, Guess, GuessCandidate,
    GuessMemory, GuessPlan, GuessRanking, GuessRefusal, GuessSkip, GuessWhy, GUESS_BUDGET_MS,
    GUESS_FLOOR, GUESS_TAKEN_KEEP,
};
pub use job::PerformJob;
pub use map::{
    liking_direction, LikingDirection, MapPoint, OwnPoint, Placement, TasteMap, OWN_PLACEMENT,
};
pub use naming::{claim_name, NameScale, NAME_FLOOR};
pub use own::{OwnSound, PresetPhi, Toward, TowardFitness, OWN_GAMMA};
pub use surrogate::{SurrogateFitness, QUARANTINE_FITNESS};
pub use walk::{run_walk, walk_seed, WalkContext, WalkJob, WalkResult, LOCK_SCALE_CAP};
