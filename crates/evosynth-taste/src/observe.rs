//! Feedback observations and the persistent observation log.
//!
//! All three feedback modalities condition the **same latent utility**
//! (DESIGN.md §1.3); an observation stores the *standardized* feature
//! vector(s) it was made about plus which session produced it (sessions carry
//! their own keep/kill threshold latent `τ` and, at K > 1, a style latent
//! `z`). The log is the profile's source of truth: the posterior can always
//! be re-fit from it.

use serde::{Deserialize, Serialize};
use std::path::Path;

/// One feedback event, in standardized feature space.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Observation {
    /// A pairwise duel: the user heard both and picked one.
    Duel {
        /// Features of candidate A.
        a: Vec<f64>,
        /// Features of candidate B.
        b: Vec<f64>,
        /// True if A won.
        chose_a: bool,
        /// Session index.
        session: usize,
    },
    /// A keep/kill triage decision.
    KeepKill {
        /// Features of the candidate.
        x: Vec<f64>,
        /// True if kept.
        kept: bool,
        /// Session index.
        session: usize,
    },
    /// A star rating (ordinal, `0..n_stars`).
    Stars {
        /// Features of the candidate.
        x: Vec<f64>,
        /// The rating, `0..=n_stars-1`.
        rating: u8,
        /// Session index.
        session: usize,
    },
}

impl Observation {
    /// The session index of this observation.
    pub fn session(&self) -> usize {
        match self {
            Observation::Duel { session, .. }
            | Observation::KeepKill { session, .. }
            | Observation::Stars { session, .. } => *session,
        }
    }
}

/// The append-only feedback log for one taste profile.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ObservationLog {
    /// The observations, in arrival order.
    pub observations: Vec<Observation>,
}

impl ObservationLog {
    /// An empty log.
    pub fn new() -> Self {
        Self::default()
    }

    /// Append an observation.
    pub fn push(&mut self, obs: Observation) {
        self.observations.push(obs);
    }

    /// Number of observations.
    pub fn len(&self) -> usize {
        self.observations.len()
    }

    /// True when the log holds no observations.
    pub fn is_empty(&self) -> bool {
        self.observations.is_empty()
    }

    /// Number of distinct sessions referenced (`max session index + 1`).
    pub fn n_sessions(&self) -> usize {
        self.observations
            .iter()
            .map(|o| o.session() + 1)
            .max()
            .unwrap_or(0)
    }

    /// Serialize to a JSON file.
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        std::fs::write(path, serde_json::to_string_pretty(self)?)
    }

    /// Load from a JSON file.
    pub fn load(path: &Path) -> std::io::Result<Self> {
        Ok(serde_json::from_str(&std::fs::read_to_string(path)?)?)
    }
}
