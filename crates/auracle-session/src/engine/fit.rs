//! A refit as data, so it can run off the engine (#300).
//!
//! A refit is one MCMC call: about a second on a fast laptop and several on
//! the reference machine for a mature log. Run on the engine's own thread it
//! held every gesture behind it. So it is cut in three, each a function of
//! what the one before handed it:
//!
//! - [`Engine::fit_job`] takes what the fit reads (the log standardized on
//!   the scale it will be fitted on, that scale, the model's configuration
//!   and the chain's length). It changes nothing in the engine.
//! - [`FitJob::run`] is the MCMC, and the alignment of its lenses to the
//!   last fit's: a pure function of the job and the caller's generator, with
//!   no engine anywhere. A render farm's worker runs it.
//! - [`Engine::install_fit`] takes the posterior back: the scale it was
//!   fitted on becomes the engine's, and the observations recorded while it
//!   ran are folded in as any pick between fits is.
//!
//! [`Engine::fit_posterior`] is the three in a row, so a fit made elsewhere
//! from the same job with the same generator is the fit made here, draw for
//! draw ([ADR-001](../../../../docs/decisions/001-one-random-stream-per-consumer.md)).
//!
//! A saved session keeps the draws ([`SavedFit`]), so a restore installs
//! them and fits nothing.

use std::sync::Arc;

use auracle_taste::{
    Feedback, FitSet, ObservationLog, Standardizer, TasteConfig, TasteModel, TastePosterior,
};
use rand::Rng;
use serde::{Deserialize, Serialize};

use super::{phi_names, Engine, StyleShareRecord, OBS_PER_STYLE};

/// Everything a refit reads, as data ([`Engine::fit_job`]).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FitJob {
    /// The log's epoch when the job was made ([`Engine::install_fit`]
    /// refuses a fit of a log since replaced).
    pub epoch: u64,
    /// How many observations of the log it fits.
    pub observations: usize,
    /// The scale the fit is on: the standardizer refitted over the pool and
    /// the log as they stood.
    pub standardizer: Standardizer,
    /// The model the chain samples.
    pub taste: TasteConfig,
    /// The log on that scale, in log order, each row with its session.
    pub rows: Vec<(Feedback, usize)>,
    /// The coordinates imputed in each row ([`FitSet::absent`]).
    pub absent: Vec<Vec<usize>>,
    /// The chain's sampling steps.
    pub samples: usize,
    /// The chain's warmup steps.
    pub warmup: usize,
    /// The lenses of the posterior it replaces, as they stood when the job
    /// was made (each lens's θ mean): what the new lenses are aligned to.
    /// Empty before a first fit.
    pub reference: Vec<Vec<f64>>,
}

/// A fit's answer, for [`Engine::install_fit`].
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FitResult {
    /// The job's epoch.
    pub epoch: u64,
    /// How many observations of the log it fitted.
    pub observations: usize,
    /// The scale its draws are on.
    pub standardizer: Standardizer,
    /// The draws, aligned to the job's reference, with uniform weights
    /// ([`packed`] on the wire).
    #[serde(with = "packed")]
    pub posterior: TastePosterior,
}

/// Why [`Engine::install_fit`] refused a fit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FitRefused {
    /// The log it fitted was replaced (a restore, a taste file) or is shorter
    /// than the fit says it was.
    Stale,
    /// Its scale or its draws are not over this build's φ.
    Shape,
}

/// The posterior a saved session keeps, so a restore needs no fit.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SavedFit {
    /// How many observations of the saved log it was fitted on; the rest were
    /// folded in by reweighting, and are in its weights.
    pub observations: usize,
    /// How often the weights collapsed and were resampled since that fit
    /// ([`Engine::needs_refit`]).
    #[serde(default)]
    pub resamples: usize,
    /// The draws and their weights, aligned, on the saved standardizer's
    /// scale ([`packed`] on the wire).
    #[serde(with = "packed")]
    pub posterior: TastePosterior,
}

/// A saved session's fit, read leniently: one that cannot be read costs the
/// session its fit (it is fitted again after it loads), never the session.
pub(super) fn tolerant<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<SavedFit>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Read {
        Readable(Box<SavedFit>),
        Unreadable(serde::de::IgnoredAny),
    }
    Ok(match Read::deserialize(d)? {
        Read::Readable(fit) => Some(*fit),
        Read::Unreadable(_) => None,
    })
}

/// A posterior's draws on the wire: every number of every draw as `f64`
/// little-endian bytes in base64, where JSON spelled each one out in decimal.
/// The draws a mature fit keeps (500 of them, five lenses over φ) were about
/// 2.3 MB of JSON, and reading them back held the engine's thread for the
/// parse of every number. Exact to the bit either way. A posterior whose
/// draws are not all of one shape (none the engine fits) is written as plain
/// JSON, and either form is read.
pub mod packed {
    use auracle_grammar::take::base64;
    use auracle_taste::{TasteConfig, TastePosterior, TasteSample};
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    #[derive(Serialize, Deserialize)]
    struct Packed {
        cfg: TasteConfig,
        /// Lenses per draw, coordinates per lens, τ per draw, cuts per draw.
        shape: [usize; 4],
        /// Each draw's θ (lens by lens), τ and cuts, draw by draw.
        draws: String,
        weights: String,
    }

    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Either {
        Packed(Packed),
        Plain(TastePosterior),
    }

    /// Write `p` packed, or as plain JSON when its draws are not of one shape.
    pub fn serialize<S: Serializer>(p: &TastePosterior, s: S) -> Result<S::Ok, S::Error> {
        match pack(p) {
            Some(packed) => packed.serialize(s),
            None => p.serialize(s),
        }
    }

    /// Read either form; packed draws that do not unpack are an error.
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<TastePosterior, D::Error> {
        match Either::deserialize(d)? {
            Either::Packed(p) => {
                unpack(p).ok_or_else(|| serde::de::Error::custom("unreadable draws"))
            }
            Either::Plain(p) => Ok(p),
        }
    }

    fn bytes(xs: impl Iterator<Item = f64>) -> String {
        base64::encode(&xs.flat_map(f64::to_le_bytes).collect::<Vec<u8>>())
    }

    fn floats(text: &str) -> Option<Vec<f64>> {
        let raw = base64::decode(text)?;
        let words = raw.chunks_exact(8);
        if !words.remainder().is_empty() {
            return None;
        }
        Some(
            words
                .map(|w| f64::from_le_bytes(w.try_into().unwrap_or_default()))
                .collect(),
        )
    }

    fn pack(p: &TastePosterior) -> Option<Packed> {
        let first = p.samples.first()?;
        let shape = [
            first.theta.len(),
            first.theta.first()?.len(),
            first.tau.len(),
            first.cuts.len(),
        ];
        let [k, d, tau, cuts] = shape;
        let uniform = p.samples.iter().all(|s| {
            s.theta.len() == k
                && s.theta.iter().all(|t| t.len() == d)
                && s.tau.len() == tau
                && s.cuts.len() == cuts
        });
        (uniform && d > 0).then(|| Packed {
            cfg: p.cfg.clone(),
            shape,
            draws: bytes(p.samples.iter().flat_map(|s| {
                s.theta
                    .iter()
                    .flatten()
                    .chain(&s.tau)
                    .chain(&s.cuts)
                    .copied()
            })),
            weights: bytes(p.weights.iter().copied()),
        })
    }

    fn unpack(p: Packed) -> Option<TastePosterior> {
        let [k, d, tau, cuts] = p.shape;
        let lenses = k.checked_mul(d)?;
        let per = lenses.checked_add(tau)?.checked_add(cuts)?;
        let xs = floats(&p.draws)?;
        if d == 0 || per == 0 || xs.len() % per != 0 {
            return None;
        }
        let samples = xs
            .chunks(per)
            .map(|c| TasteSample {
                theta: c[..lenses].chunks(d).map(<[f64]>::to_vec).collect(),
                tau: c[lenses..lenses + tau].to_vec(),
                cuts: c[lenses + tau..].to_vec(),
            })
            .collect();
        Some(TastePosterior {
            cfg: p.cfg,
            samples,
            weights: floats(&p.weights)?,
        })
    }
}

impl FitJob {
    /// The MCMC: a pure function of the job and `rng`.
    pub fn run<R: Rng>(&self, rng: &mut R) -> FitResult {
        let data = FitSet {
            rows: self.rows.clone(),
            absent: self.absent.clone(),
        };
        // Aligned to the **previous** fit's lenses, not merely to itself. MCMC
        // has no reason to return the lenses in the same order twice — with
        // probability ≈ 1 − 1/K! two consecutive fits disagree — and everything
        // keyed by lens index (`style_names`, the style shares, the panel's
        // lens colours) would silently attach to a different taste after every
        // refit. Lens `i` now stays the lens that most resembles the old lens
        // `i`; a lens added because the log grew takes an index the old fit
        // did not claim, so no name has to move. Here rather than at install:
        // it searches every permutation of the lenses for every draw, the
        // larger part of what a mature fit's install held the engine for.
        let posterior = TasteModel::new(self.taste.clone())
            .fit(rng, &data, self.samples, self.warmup)
            .aligned_to(&self.reference);
        FitResult {
            epoch: self.epoch,
            observations: self.observations,
            standardizer: self.standardizer.clone(),
            posterior,
        }
    }
}

impl Engine {
    /// What a refit of the log as it stands reads, or `None` with nothing to
    /// fit (an empty log, or no scale to fit it on). Changes nothing: the
    /// standardizer it fits on is adopted when the fit is installed.
    pub fn fit_job(&self) -> Option<FitJob> {
        if self.log.is_empty() {
            return None;
        }
        let sz = self
            .evidence_standardizer()
            .or_else(|| self.standardizer.as_deref().cloned())?;
        let names = phi_names();
        let d = names.len();
        // Style capacity grows with evidence: one lens per ~20 observations,
        // capped by config. Idle lenses collapse to ~0 share on their own,
        // so K is an upper bound the data may or may not use.
        let k = (1 + self.log.len() / OBS_PER_STYLE)
            .min(self.cfg.k_styles)
            .max(1);
        let mut taste = TasteConfig::mixture(d, k);
        taste.recency_half_life = self.cfg.recency_half_life;
        // The brightness cluster shares a latent mean per style. Resolved by
        // *name* here because this is the layer that knows them; the taste
        // crate is handed indices and never learns what they mean. A name that
        // is not in φ simply does not join the group, so a stimulus-tag bump
        // or a dropped column degrades to the flat prior rather than panicking
        // or silently fusing the wrong coordinate.
        let bright: Vec<usize> = ["rolloff_mean", "zcr_mean", "centroid_mean"]
            .iter()
            .filter_map(|want| names.iter().position(|n| n.split(':').next() == Some(want)))
            .collect();
        if bright.len() > 1 {
            taste.fused = vec![bright];
        }
        let data = FitSet::build(&self.log, &names, &sz);
        Some(FitJob {
            epoch: self.log_epoch,
            observations: self.log.len(),
            standardizer: sz,
            taste,
            rows: data.rows,
            absent: data.absent,
            samples: self.cfg.mcmc_samples,
            warmup: self.cfg.mcmc_warmup,
            reference: self
                .posterior
                .as_ref()
                .filter(|p| p.cfg.n_features == d)
                .map(|p| (0..p.k_styles()).map(|k| p.theta_mean(k)).collect())
                .unwrap_or_default(),
        })
    }

    /// Install a fit made from [`Engine::fit_job`], here or elsewhere: its
    /// scale becomes the engine's (the pool re-expressed on it), the pool's
    /// style shares are recorded, and every observation recorded since the
    /// job was made is folded in by reweighting, as a pick between fits is.
    /// Refused, leaving the engine as it was, when the log it fitted has been
    /// replaced since or its draws are not over this build's φ.
    pub fn install_fit(&mut self, fit: FitResult) -> Result<(), FitRefused> {
        if fit.epoch != self.log_epoch || fit.observations > self.log.len() {
            return Err(FitRefused::Stale);
        }
        let d = phi_names().len();
        if fit.standardizer.dimension() != d || fit.posterior.cfg.n_features != d {
            return Err(FitRefused::Shape);
        }
        let sz = Arc::new(fit.standardizer);
        self.adopt_standardizer(sz.clone());
        let k = fit.posterior.cfg.k_styles;
        let posterior = fit.posterior;
        // Measured against the pool the fit is about to be used on, which is
        // the population the shares are a statement about — not against the
        // log, whose φ are the things already judged.
        let pool_phis: Vec<Vec<f64>> = self
            .pool
            .iter()
            .filter(|c| !c.phi_std.is_empty())
            .map(|c| c.phi_std.clone())
            .collect();
        if !pool_phis.is_empty() {
            self.style_shares.push(StyleShareRecord {
                observations: fit.observations,
                k,
                shares: posterior.style_share(&pool_phis),
            });
        }
        self.posterior = Some(Arc::new(posterior));
        self.resamples_since_fit = 0;
        // What was recorded while the fit ran (nothing, for a fit made and
        // installed in one go), folded in on the fit's scale as a pick
        // between fits is.
        if self.cfg.sis_between_fits {
            let tail = ObservationLog {
                observations: self.log.observations[fit.observations..].to_vec(),
            };
            for (feedback, session) in FitSet::build(&tail, &phi_names(), &sz).rows {
                self.fold_in(&feedback, session);
            }
        }
        self.fitted_on = fit.observations;
        Ok(())
    }

    /// The posterior as a saved session keeps it, or `None` before a fit.
    pub(super) fn saved_fit(&self) -> Option<SavedFit> {
        self.posterior.as_ref().map(|p| SavedFit {
            observations: self.fitted_on,
            resamples: self.resamples_since_fit,
            posterior: (**p).clone(),
        })
    }

    /// Install a restored session's posterior, when it still describes what
    /// was restored: the log and the standardizer came back exactly as saved
    /// (no migration or repair touched them; `saved_log`, `saved_sz`), and
    /// the draws are over this build's φ. Otherwise the session has no
    /// posterior until it is fitted again. Says whether it was installed.
    pub(super) fn restore_fit(
        &mut self,
        fit: Option<SavedFit>,
        saved_log: &ObservationLog,
        saved_sz: Option<&Standardizer>,
    ) -> bool {
        let Some(fit) = fit else {
            return false;
        };
        let d = phi_names().len();
        let p = &fit.posterior;
        let usable = &self.log == saved_log
            && self
                .standardizer
                .as_deref()
                .is_some_and(|sz| Some(sz) == saved_sz)
            && fit.observations <= self.log.len()
            && p.cfg.n_features == d
            && !p.samples.is_empty()
            && (p.weights.is_empty() || p.weights.len() == p.samples.len())
            && p.samples
                .iter()
                .all(|s| s.theta.len() == p.k_styles() && s.theta.iter().all(|t| t.len() == d));
        if !usable {
            return false;
        }
        self.posterior = Some(Arc::new(fit.posterior));
        self.fitted_on = fit.observations;
        self.resamples_since_fit = fit.resamples;
        true
    }

    /// How many observations the posterior was fitted on; 0 before a fit.
    pub fn fitted_on(&self) -> usize {
        self.fitted_on
    }
}

#[cfg(test)]
mod tests;
