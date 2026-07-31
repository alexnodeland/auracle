//! The vetting gate (DESIGN.md §2.1, safety layer 1).
//!
//! *No candidate is ever played live unvetted.* The standard-phrase render is
//! inspected **before** normalization; failures are quarantined — never
//! auditioned, never featurized, and reported to the session layer so
//! evolution learns to avoid the region (safety layer 2).

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Why a render was quarantined.
#[derive(Clone, Debug, PartialEq, Error, Serialize, Deserialize)]
pub enum VetFailure {
    /// A non-finite sample survived every DSP-level defense.
    #[error("render contains non-finite samples")]
    NonFinite,
    /// Effectively silent (below the RMS floor / loudness gate).
    #[error("render is effectively silent (rms {rms:.2e})")]
    Silent {
        /// Measured RMS.
        rms: f64,
    },
    /// Peak beyond the limiter ceiling plus overshoot headroom — runaway.
    #[error("render peak {peak:.2} exceeds the safety ceiling")]
    Overlevel {
        /// Measured peak.
        peak: f64,
    },
    /// Dominated by DC offset rather than audio.
    #[error("render is DC-dominated (|mean|/rms = {dc_ratio:.2})")]
    DcDominated {
        /// |mean| / RMS ratio.
        dc_ratio: f64,
    },
}

/// Measurements taken on the raw (pre-normalization) render.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct VetReport {
    /// Peak absolute sample.
    pub peak: f64,
    /// Whole-phrase RMS.
    pub rms: f64,
    /// |mean| / RMS — DC dominance.
    pub dc_ratio: f64,
    /// Fraction of samples pinned near the limiter ceiling (heavy limiting
    /// indicator; informational, not a failure).
    pub pinned_fraction: f64,
}

/// Vet thresholds. Defaults are deliberately lenient — the gate exists to
/// catch pathology, not to encode taste (that's the model's job).
#[derive(Clone, Copy, Debug)]
pub struct VetConfig {
    /// RMS below this is "silent".
    pub rms_floor: f64,
    /// Peak above this is runaway (limiter ceiling 0.8 + generous headroom).
    pub peak_ceiling: f64,
    /// |mean|/rms above this is DC-dominated.
    pub max_dc_ratio: f64,
}

impl Default for VetConfig {
    fn default() -> Self {
        Self {
            rms_floor: 1e-4,
            peak_ceiling: 2.0,
            max_dc_ratio: 0.6,
        }
    }
}

impl VetConfig {
    /// Defaults with the peak ceiling scaled for the phrase's polyphony.
    ///
    /// The default ceiling (2.0) is one limiter-bounded voice (~1.5 peak in
    /// the ±1.0 float domain) plus overshoot headroom. N gate-synced voices
    /// legitimately sum toward N× one voice, and that summing is exactly the
    /// stacking information the chord segment exists to measure — so each
    /// additional simultaneous voice raises the ceiling by one voice's worth
    /// (1.5) rather than the gate quarantining honest polyphony as runaway.
    pub fn for_spec(spec: &crate::phrase::PhraseSpec) -> Self {
        Self {
            peak_ceiling: 2.0 + 1.5 * (spec.max_voices() as f64 - 1.0),
            ..Self::default()
        }
    }
}

/// Inspect a raw render. `Ok(report)` admits the candidate to normalization
/// and feature extraction; `Err` quarantines it.
pub fn vet(samples: &[f64], cfg: &VetConfig) -> Result<VetReport, VetFailure> {
    if samples.is_empty() {
        return Err(VetFailure::Silent { rms: 0.0 });
    }
    if samples.iter().any(|s| !s.is_finite()) {
        return Err(VetFailure::NonFinite);
    }
    let n = samples.len() as f64;
    let peak = samples.iter().fold(0.0f64, |p, s| p.max(s.abs()));
    let mean = samples.iter().sum::<f64>() / n;
    let rms = (samples.iter().map(|s| s * s).sum::<f64>() / n).sqrt();
    let dc_ratio = mean.abs() / (rms + 1e-30);
    let pinned_fraction = if peak > 0.0 {
        samples.iter().filter(|s| s.abs() >= 0.98 * peak).count() as f64 / n
    } else {
        0.0
    };

    let report = VetReport {
        peak,
        rms,
        dc_ratio,
        pinned_fraction,
    };
    if rms < cfg.rms_floor {
        return Err(VetFailure::Silent { rms });
    }
    if peak > cfg.peak_ceiling {
        return Err(VetFailure::Overlevel { peak });
    }
    if dc_ratio > cfg.max_dc_ratio {
        return Err(VetFailure::DcDominated { dc_ratio });
    }
    Ok(report)
}
