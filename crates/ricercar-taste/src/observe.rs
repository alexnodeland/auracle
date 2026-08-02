//! Feedback observations and the persistent observation log.
//!
//! All three feedback modalities condition the **same latent utility**
//! (DESIGN.md §1.3). An observation stores the **raw** feature vector(s) it
//! was made about, the **names** of those coordinates, a **schema version**,
//! and which session produced it (sessions carry their own keep/kill threshold
//! latent `τ` and, at K > 1, a style latent `z`).
//!
//! ## Why raw φ and not standardized φ
//!
//! Standardization is a *modeling* choice, not a fact about what the user did.
//! Baking it into the log made the log stop being the source of truth in two
//! ways. Because the standardizer was fit once and frozen, z-scores drifted
//! as the pool moved away from that reference sample — the linear model ended
//! up extrapolating far outside where it was calibrated. And, structurally
//! worse, **the feature set could never change again**: adding a coordinate,
//! or fixing one's units, silently invalidated every saved profile with no
//! way to detect it.
//!
//! Storing raw values plus names fixes both. The standardizer is re-fit at
//! fit time over the log *and* the live pool, and a log recorded under an
//! older feature set is re-projected by name onto the current one
//! ([`FitSet::build`]) — coordinates that disappeared are dropped, ones that
//! did not exist yet are imputed at the standardizer mean, which is exactly
//! "no evidence" in standardized space.
//!
//! The names ride on every observation rather than once per log. They
//! duplicate, but a log is a stream of independently-meaningful records: a
//! record that cannot be interpreted without a header elsewhere in the file
//! is the failure mode this whole change exists to prevent.

use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::standardize::Standardizer;

/// Current φ schema: vectors are **raw** (un-standardized) and carry names.
pub const PHI_SCHEMA: u32 = 2;

/// Schema of logs written before raw-φ logging: vectors are *standardized*
/// under the profile's persisted standardizer, and carry no names.
pub const PHI_SCHEMA_STANDARDIZED: u32 = 1;

/// **How** a preference was collected — not what it was.
///
/// Every variant conditions the same latent utility and every variant enters
/// the likelihood identically: [`FitSet`] never reads this field, and it is
/// deliberately not a covariate. Two ways of asking the same question are not
/// two questions, and a per-provenance weight or intercept would be a modeling
/// claim nobody has evidence for yet.
///
/// It is recorded because the *evidence* for that claim is exactly what is
/// missing. A hand edit committed with "my edit is better" ticked is a
/// **self-report**: the player asserts an improvement, usually without having
/// heard the two back to back. The same commit routed through a real duel is a
/// **heard comparison**. If self-reports turn out to be systematically
/// over-confident — and every intuition says they are — the way to find out is
/// to score the two streams separately against the model's own forecasts
/// ([`crate::ObservationLog`] plus the session layer's prequential
/// calibration), which requires having tagged them from the start.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Provenance {
    /// The app dealt a pair, the user heard both and picked one. The default,
    /// and what every observation written before provenance existed was.
    #[default]
    Duel,
    /// A hand edit committed after hearing the edit against the original.
    HeardEdit,
    /// A hand edit committed with "my edit is better" asserted, unheard.
    SelfReport,
}

impl Provenance {
    /// Stable wire/display name (`"duel"`, `"heard_edit"`, `"self_report"`).
    pub fn as_str(&self) -> &'static str {
        match self {
            Provenance::Duel => "duel",
            Provenance::HeardEdit => "heard_edit",
            Provenance::SelfReport => "self_report",
        }
    }

    /// True for the default, so it can be omitted from the wire form.
    pub fn is_duel(&self) -> bool {
        matches!(self, Provenance::Duel)
    }
}

/// What the user did, and the feature vector(s) it was about.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Feedback {
    /// A pairwise duel: the user heard both and picked one.
    Duel {
        /// Features of candidate A.
        a: Vec<f64>,
        /// Features of candidate B.
        b: Vec<f64>,
        /// True if A won.
        chose_a: bool,
    },
    /// A keep/kill triage decision.
    KeepKill {
        /// Features of the candidate.
        x: Vec<f64>,
        /// True if kept.
        kept: bool,
    },
    /// A star rating (ordinal, `0..n_stars`).
    Stars {
        /// Features of the candidate.
        x: Vec<f64>,
        /// The rating, `0..=n_stars-1`.
        rating: u8,
    },
}

impl Feedback {
    /// Every feature vector this feedback refers to.
    pub fn phis(&self) -> Vec<&[f64]> {
        match self {
            Feedback::Duel { a, b, .. } => vec![a, b],
            Feedback::KeepKill { x, .. } | Feedback::Stars { x, .. } => vec![x],
        }
    }

    /// Rebuild with every feature vector passed through `f` (projection,
    /// standardization, unit migration).
    pub fn map_phi(&self, f: impl Fn(&[f64]) -> Vec<f64>) -> Feedback {
        match self {
            Feedback::Duel { a, b, chose_a } => Feedback::Duel {
                a: f(a),
                b: f(b),
                chose_a: *chose_a,
            },
            Feedback::KeepKill { x, kept } => Feedback::KeepKill {
                x: f(x),
                kept: *kept,
            },
            Feedback::Stars { x, rating } => Feedback::Stars {
                x: f(x),
                rating: *rating,
            },
        }
    }
}

/// One feedback event: what happened, in which session, over which features.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Observation {
    /// What the user did.
    pub feedback: Feedback,
    /// Session index (sessions own their own `τ`).
    pub session: usize,
    /// Names of the φ coordinates, in vector order. Empty means "unknown" —
    /// the vectors can only be interpreted positionally.
    pub feature_names: Vec<String>,
    /// Which φ schema the vectors are in ([`PHI_SCHEMA`] for raw values).
    pub schema_version: u32,
    /// How this preference was collected. Omitted from the wire form when it
    /// is [`Provenance::Duel`], which is what every log written before this
    /// field existed contains.
    #[serde(default, skip_serializing_if = "Provenance::is_duel")]
    pub provenance: Provenance,
}

impl Observation {
    /// A fresh observation in the current schema, from a heard duel.
    pub fn new(feedback: Feedback, session: usize, feature_names: &[String]) -> Self {
        Self::tagged(feedback, session, feature_names, Provenance::Duel)
    }

    /// A fresh observation carrying an explicit provenance.
    pub fn tagged(
        feedback: Feedback,
        session: usize,
        feature_names: &[String],
        provenance: Provenance,
    ) -> Self {
        Self {
            feedback,
            session,
            feature_names: feature_names.to_vec(),
            schema_version: PHI_SCHEMA,
            provenance,
        }
    }

    /// The session index of this observation.
    pub fn session(&self) -> usize {
        self.session
    }

    /// True when the vectors are raw values in the current schema (rather
    /// than pre-standardized values from a legacy log).
    pub fn is_raw(&self) -> bool {
        self.schema_version >= PHI_SCHEMA
    }
}

/// The pre-raw-φ on-disk form: an externally-tagged enum whose vectors were
/// already standardized. Kept only so old profiles still load.
#[derive(Deserialize)]
enum LegacyObservation {
    Duel {
        a: Vec<f64>,
        b: Vec<f64>,
        chose_a: bool,
        session: usize,
    },
    KeepKill {
        x: Vec<f64>,
        kept: bool,
        session: usize,
    },
    Stars {
        x: Vec<f64>,
        rating: u8,
        session: usize,
    },
}

#[derive(Deserialize)]
#[serde(untagged)]
enum ObservationRepr {
    Current {
        feedback: Feedback,
        session: usize,
        #[serde(default)]
        feature_names: Vec<String>,
        #[serde(default)]
        schema_version: u32,
        #[serde(default)]
        provenance: Provenance,
    },
    Legacy(LegacyObservation),
}

impl<'de> Deserialize<'de> for Observation {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(match ObservationRepr::deserialize(d)? {
            ObservationRepr::Current {
                feedback,
                session,
                feature_names,
                schema_version,
                provenance,
            } => Observation {
                feedback,
                session,
                feature_names,
                schema_version: if schema_version == 0 {
                    PHI_SCHEMA
                } else {
                    schema_version
                },
                provenance,
            },
            ObservationRepr::Legacy(o) => {
                let (feedback, session) = match o {
                    LegacyObservation::Duel {
                        a,
                        b,
                        chose_a,
                        session,
                    } => (Feedback::Duel { a, b, chose_a }, session),
                    LegacyObservation::KeepKill { x, kept, session } => {
                        (Feedback::KeepKill { x, kept }, session)
                    }
                    LegacyObservation::Stars { x, rating, session } => {
                        (Feedback::Stars { x, rating }, session)
                    }
                };
                Observation {
                    feedback,
                    session,
                    feature_names: Vec::new(),
                    schema_version: PHI_SCHEMA_STANDARDIZED,
                    provenance: Provenance::Duel,
                }
            }
        })
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

    /// How many observations were collected each way. A count, not a weight:
    /// nothing downstream of the likelihood reads it, and the panel shows it
    /// so "the model learned this from a heard comparison" and "…from a
    /// checkbox" are distinguishable claims on screen as well as in the log.
    pub fn n_with(&self, provenance: Provenance) -> usize {
        self.observations
            .iter()
            .filter(|o| o.provenance == provenance)
            .count()
    }

    /// Every raw φ in the log, for fitting a standardizer. Only observations
    /// already in the current schema whose names match `names` contribute —
    /// mixing units into a standardizer is how you get a silently wrong model.
    pub fn raw_rows(&self, names: &[String]) -> Vec<Vec<f64>> {
        self.observations
            .iter()
            .filter(|o| o.is_raw() && o.feature_names == names)
            .flat_map(|o| o.feedback.phis().into_iter().map(|p| p.to_vec()))
            .collect()
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

/// A log projected onto one feature order and standardized — exactly what the
/// likelihood sees. Derived at fit time from the log plus a standardizer, and
/// never persisted: the log is the source of truth, this is a view of it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FitSet {
    /// Standardized feedback, paired with its session index, in log order.
    pub rows: Vec<(Feedback, usize)>,
}

impl FitSet {
    /// Project every observation onto `names` and standardize with `sz`.
    ///
    /// Coordinates the observation does not have are imputed at the
    /// standardizer's mean — which standardizes to exactly 0, i.e. "this
    /// observation says nothing about that axis", the honest imputation for a
    /// feature that did not exist when the vote was cast. Observations from a
    /// legacy standardized log are re-used as-is (they are already z-scores);
    /// they are on a different geometry, so the session layer migrates them to
    /// raw values first where it can.
    pub fn build(log: &ObservationLog, names: &[String], sz: &Standardizer) -> Self {
        let d = names.len();
        let rows = log
            .observations
            .iter()
            .map(|o| {
                let index: Vec<Option<usize>> = if o.feature_names.is_empty() {
                    // No names: positional, which is all a legacy log allows.
                    (0..d).map(Some).collect()
                } else {
                    names
                        .iter()
                        .map(|n| o.feature_names.iter().position(|m| m == n))
                        .collect()
                };
                let raw = o.is_raw();
                let project = |phi: &[f64]| -> Vec<f64> {
                    (0..d)
                        .map(|j| match index[j].and_then(|i| phi.get(i)) {
                            Some(&v) if raw => (v - sz.mean[j]) / sz.std[j],
                            // Already standardized, or absent (mean ⇒ z = 0).
                            Some(&v) => v,
                            None => 0.0,
                        })
                        .collect()
                };
                (o.feedback.map_phi(project), o.session)
            })
            .collect();
        Self { rows }
    }

    /// Take the log's vectors as already being on the model's scale (unit
    /// tests and synthetic users work directly in standardized space).
    pub fn as_is(log: &ObservationLog) -> Self {
        Self {
            rows: log
                .observations
                .iter()
                .map(|o| (o.feedback.clone(), o.session))
                .collect(),
        }
    }

    /// Number of observations.
    pub fn len(&self) -> usize {
        self.rows.len()
    }

    /// True when there is nothing to condition on.
    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    /// Number of distinct sessions referenced (`max session index + 1`).
    pub fn n_sessions(&self) -> usize {
        self.rows.iter().map(|(_, s)| s + 1).max().unwrap_or(0)
    }
}
