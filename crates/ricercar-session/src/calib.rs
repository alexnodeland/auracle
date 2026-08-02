//! Prequential calibration: is the model's confidence *honest*?
//!
//! Every duel is forecast before it is answered — `record_duel` scores the
//! posterior's `P(A wins)` and only then appends the observation — so these
//! are genuinely out-of-sample, one-step-ahead predictions. What was done with
//! them was not: a running count of `p > 0.5` outcomes is **accuracy**, and
//! accuracy is not a proper scoring rule. A model that says 0.51 every time
//! and is right 51 % of the time scores identically to one that says 0.99 and
//! is right 51 % of the time. Worse, an information-seeking acquisition
//! function *deliberately* picks pairs near p = 0.5, so the hit rate is pinned
//! near 50 % by construction — a perfectly calibrated model looks like a coin
//! flip, and the user concludes it is not learning.
//!
//! Two honest replacements:
//!
//! - **Brier score** `B = mean (p_chosen − 1)²`, reported as skill
//!   `1 − B/0.25` against the always-0.5 baseline. Proper, bounded, and it
//!   moves as sharpness improves rather than only as accuracy does.
//! - **A reliability diagram**: bin the forecasts and compare predicted with
//!   observed frequency. This is the display that makes calibration legible —
//!   the diagonal is the claim, the bars are the evidence.
//!
//! And a selection-bias fix, because the acquisition function chooses which
//! duels get scored: a fraction of duels are drawn uniformly at random and
//! flagged ([`Forecast::random_check`]). Calibration on *those* is unbiased,
//! and it is reported separately. It costs a small share of the query budget
//! and it is the only number here that means what it says without an asterisk.

use serde::{Deserialize, Serialize};

use ricercar_taste::Provenance;

/// One out-of-sample duel forecast, recorded before the answer was known.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Forecast {
    /// Posterior probability the model gave to candidate A winning.
    pub p_a: f64,
    /// What the user actually did.
    pub chose_a: bool,
    /// True when the pair was drawn uniformly at random rather than by the
    /// acquisition function — the unbiased subsample.
    pub random_check: bool,
    /// How the answer was collected. `#[serde(default)]` because forecasts
    /// persist with the session and every one already on disk was a dealt
    /// duel, which is exactly what [`Provenance::Duel`] means.
    #[serde(default)]
    pub provenance: Provenance,
}

impl Forecast {
    /// Probability the model gave to the option the user actually picked.
    pub fn p_chosen(&self) -> f64 {
        if self.chose_a {
            self.p_a
        } else {
            1.0 - self.p_a
        }
    }
}

/// One bucket of the reliability diagram.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct ReliabilityBin {
    /// Inclusive lower edge of the forecast bucket.
    pub lo: f64,
    /// Exclusive upper edge (inclusive for the last bucket).
    pub hi: f64,
    /// Forecasts in this bucket.
    pub n: usize,
    /// Mean forecast probability in the bucket (the model's claim).
    pub predicted: f64,
    /// Observed frequency of "A won" in the bucket (the evidence).
    pub observed: f64,
}

/// One provenance's slice of the forecast stream.
///
/// The comparison this exists for: a hand edit committed through a **heard**
/// duel and one committed by ticking "my edit is better" make the same claim
/// in the log, and there is no reason to believe they are equally reliable.
/// Scoring them against forecasts the model made *before* either answer
/// arrived is the only way to find out which — and it costs one tag.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProvenanceScore {
    /// Which stream (`"duel"`, `"heard_edit"`, `"self_report"`).
    pub provenance: String,
    /// Forecasts scored in it.
    pub n: usize,
    /// Mean Brier score over them.
    pub brier: f64,
    /// Mean log-loss over them, in nats.
    pub log_loss: f64,
    /// Brier skill against a coin flip, `1 − B/0.25`.
    pub skill: f64,
}

/// Calibration summary over a set of forecasts.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Calibration {
    /// Forecasts scored.
    pub n: usize,
    /// Prequential Brier score, `mean (p_chosen − 1)²`. Lower is better;
    /// 0.25 is the always-0.5 baseline.
    pub brier: f64,
    /// Prequential log-loss, `mean −ln p_chosen`, in nats. Lower is better;
    /// `ln 2 ≈ 0.693` is the always-0.5 baseline.
    ///
    /// Comparable across *time* for one acquisition rule, and **not**
    /// comparable across acquisition rules: an information-seeking rule
    /// deliberately serves duels near p = 0.5, which carry the highest
    /// log-loss by construction. Comparing rules on their own self-chosen
    /// question sets would score the willingness to ask hard questions as a
    /// failure. Use `check_log_loss` for that.
    pub log_loss: f64,
    /// Brier skill against a coin flip, `1 − B/0.25`. 0 = no better than
    /// chance, 1 = perfect and certain, negative = worse than a coin.
    pub skill: f64,
    /// Reliability diagram buckets over `P(A wins)`.
    pub bins: Vec<ReliabilityBin>,
    /// Forecasts among the uniformly-random check duels.
    pub check_n: usize,
    /// Brier skill restricted to the check duels — the selection-bias-free
    /// number.
    pub check_skill: f64,
    /// Log-loss restricted to the uniformly-random check duels, in nats. The
    /// only log-loss here that means the same thing under any acquisition
    /// rule.
    pub check_log_loss: f64,
    /// Running hit rate, kept only so a frontend can show how misleading it
    /// is next to the skill score.
    pub hit_rate: f64,
    /// The same scores, split by how the answer was collected. Empty streams
    /// are omitted, so a session that has never committed a hand edit carries
    /// exactly one row and reads as it always did.
    #[serde(default)]
    pub by_provenance: Vec<ProvenanceScore>,
}

/// Number of reliability buckets. Five is the most a small session can fill
/// without every bucket being noise.
const N_BINS: usize = 5;

/// Count, mean Brier, and mean log-loss (nats) over a forecast stream.
fn score(fs: impl Iterator<Item = Forecast>) -> (usize, f64, f64) {
    let mut n = 0usize;
    let (mut b, mut ll) = (0.0, 0.0);
    for f in fs {
        n += 1;
        let p = f.p_chosen();
        let e = p - 1.0;
        b += e * e;
        ll += -p.clamp(1e-12, 1.0).ln();
    }
    if n == 0 {
        (0, 0.0, 0.0)
    } else {
        (n, b / n as f64, ll / n as f64)
    }
}

/// Summarize a forecast stream.
pub fn calibration(forecasts: &[Forecast]) -> Calibration {
    let (n, b, ll) = score(forecasts.iter().copied());
    let (check_n, check_b, check_ll) = score(forecasts.iter().copied().filter(|f| f.random_check));
    let hits = forecasts.iter().filter(|f| f.p_chosen() > 0.5).count();

    let mut bins: Vec<ReliabilityBin> = (0..N_BINS)
        .map(|i| ReliabilityBin {
            lo: i as f64 / N_BINS as f64,
            hi: (i + 1) as f64 / N_BINS as f64,
            n: 0,
            predicted: 0.0,
            observed: 0.0,
        })
        .collect();
    for f in forecasts {
        let i = ((f.p_a * N_BINS as f64) as usize).min(N_BINS - 1);
        bins[i].n += 1;
        bins[i].predicted += f.p_a;
        bins[i].observed += f.chose_a as u8 as f64;
    }
    for b in &mut bins {
        if b.n > 0 {
            b.predicted /= b.n as f64;
            b.observed /= b.n as f64;
        }
    }

    let by_provenance = [
        Provenance::Duel,
        Provenance::HeardEdit,
        Provenance::SelfReport,
    ]
    .into_iter()
    .filter_map(|p| {
        let (n, b, ll) = score(forecasts.iter().copied().filter(|f| f.provenance == p));
        (n > 0).then(|| ProvenanceScore {
            provenance: p.as_str().into(),
            n,
            brier: b,
            log_loss: ll,
            skill: 1.0 - b / 0.25,
        })
    })
    .collect();

    Calibration {
        n,
        brier: b,
        log_loss: ll,
        skill: if n == 0 { 0.0 } else { 1.0 - b / 0.25 },
        bins,
        check_n,
        check_skill: if check_n == 0 {
            0.0
        } else {
            1.0 - check_b / 0.25
        },
        check_log_loss: check_ll,
        hit_rate: if n == 0 { 0.0 } else { hits as f64 / n as f64 },
        by_provenance,
    }
}
