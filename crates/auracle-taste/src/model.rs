//! The taste model as a fugue program, and its MCMC posterior.
//!
//! ```text
//! θ_k  ~ Normal(0, σ_θ)      per style k, per feature      addr theta<k>#i
//! τ_s  ~ Normal(0, 1)        per session s (keep/kill bar) addr tau#s
//! cuts : c_1 = −2 + 1.5·raw₀;  c_j = c_{j−1} + exp(−0.5 + 0.7·raw_j)
//!                                                          addr cut#j
//! u(x) = max_k θ_k · φ(x)
//! ```
//!
//! **Mixture semantics (K > 1):** taste is a **max of linear experts** — a
//! candidate is as good as its best style thinks it is. This is what lets
//! one user's taste span several islands (dark drones *and* bright plucks):
//! each island gets its own linear lens, and every judgment — including a
//! duel *across* islands — compares candidates on the shared scale
//! `u(x) = max_k u_k(x)`. (A per-observation latent-lens mixture cannot do
//! this: it forces both duel items through the same lens, so cross-island
//! comparisons are unrepresentable. The max-utility form was adopted after a
//! synthetic bimodal user exposed exactly that failure.) There are no
//! discrete latent sites, and at K = 1 the model reduces exactly to the
//! plain linear taste.
//!
//! One `factor` carries the total log-likelihood: Bradley–Terry for duels,
//! `σ(u − τ_s)` for keep/kill, cumulative-logit ordinal for stars. Inference
//! is fugue's adaptive single-site MH — every site is `F64`, so the generic
//! chain applies unchanged — run by a kernel of the fit's own that deals
//! fugue's draws without rebuilding the program each step
//! ([`TasteModel::fit`]).
//!
//! Default `σ_θ = 1/(√d · s_K)`, making the prior utility of a standardized
//! candidate roughly unit-variance — likelihood scales stay sane at any
//! feature count *and* at any K. The `s_K` factor is the correction the
//! max-of-experts form forces on us: with ‖φ‖² ≈ d each `u_k` is marginally
//! N(0,1) under the prior, so `u = max_k u_k` is the max of K iid standard
//! normals, whose SD *falls* with K (1.000, 0.826, 0.748, 0.701, 0.669). The
//! mean shift cancels in duels and is absorbed by `τ`/`cuts` elsewhere; the
//! variance shrinkage does not. Left uncorrected, `Var(u_a − u_b)` drops from
//! 2.0 at K=1 to 0.90 at K=5, so growing K mid-session would quietly make the
//! model *less* able to express a strong preference — the opposite of what
//! adding capacity is supposed to do.
//!
//! Mixture posteriors are permutation-symmetric in the style labels (label
//! switching); call [`TastePosterior::aligned`] before per-style summaries.
//!
//! Posterior draws carry **importance weights**. A full MCMC fit costs
//! thousands of likelihood evaluations, far too many to run after every
//! vote, so between fits the session layer folds each new observation in by
//! sequential importance sampling ([`TastePosterior::reweighted`]):
//! `w_s ← w_s · p(y | θ_s)`. That is exact — the weighted draws target the
//! updated posterior — and it costs O(S). It degrades gracefully rather than silently: effective sample size
//! ([`TastePosterior::ess`]) falls as the weights concentrate, and that is the
//! signal to pay for a real refit.

use fugue::runtime::handler::run;
use fugue::runtime::interpreters::PriorHandler;
use fugue::{addr, factor, sample, Address, Distribution, Model, ModelExt, Normal, Trace};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::observe::{Feedback, FitSet};

mod kernel;

/// SD of the maximum of K iid standard normals, K = 1..=5. See the module doc.
pub const MAX_NORMAL_SD: [f64; 5] = [1.000, 0.826, 0.748, 0.701, 0.669];

/// Posterior draws retained from a fit, after thinning: at most this many,
/// and exactly this many from a budget that is a multiple of it.
///
/// The chain is thinned because single-site draws are heavily autocorrelated —
/// 500 spread over the whole chain carry far more information than 500
/// consecutive ones — and because every retained draw is a `TasteSample` the
/// posterior holds for the rest of the session.
pub const KEEP: usize = 500;

/// Model configuration.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TasteConfig {
    /// Feature dimension (after standardization).
    pub n_features: usize,
    /// Number of style components (mixture of linear experts).
    pub k_styles: usize,
    /// Number of star categories (ratings `0..n_stars`).
    pub n_stars: usize,
    /// Prior std of each θ coordinate. `None` → `1/√n_features`.
    pub theta_prior_std: Option<f64>,
    /// Recency half-life in observations: an observation `h` places back in
    /// the log weighs `0.5^(h / half_life)` in the likelihood, so old taste
    /// fades as new evidence arrives. `None` → no forgetting.
    #[serde(default)]
    pub recency_half_life: Option<f64>,
    /// Groups of φ coordinates that measure **one perceptual thing**, and so
    /// share a latent per-style mean instead of being independent draws.
    ///
    /// Empty by default, which is the flat prior this model has always had.
    /// The caller supplies indices because only it knows the feature *names*;
    /// see `SessionConfig` for the brightness group it fills in.
    ///
    /// ## Why a fused prior rather than dropping a column
    ///
    /// `rolloff_mean`, `zcr_mean` and `centroid_mean` are three genuine
    /// measurements of brightness, and over 1200 prior draws they carry VIFs
    /// of ~16.9 / ~9.7 / ~5.9 — `rolloff_mean` is the worst-conditioned
    /// coordinate in φ. Dropping any of them discards real signal: they
    /// disagree about *which* brightness (spectral tilt, high-frequency
    /// energy, and waveform sign changes are not the same statistic), and a
    /// listener who prefers one shading over another is expressing something
    /// the survivors cannot represent alone.
    ///
    /// A shared mean says what is actually true: these coordinates are
    /// correlated *a priori*, so evidence about one is partial evidence about
    /// the others. The model can still separate them when the data insist —
    /// [`Self::sigma_within`] is what buys that freedom — but with few duels
    /// it pools them instead of splitting an ill-conditioned ridge three ways
    /// at random, which is the failure mode a high VIF names.
    #[serde(default)]
    pub fused: Vec<Vec<usize>>,
    /// How strongly a fused group's coordinates are correlated *a priori*,
    /// in `[0, 1)`. **`None` → 0.0, i.e. off** — see [`Self::fused_rho`] for
    /// the measurement that switched it off.
    ///
    /// Parameterized as a correlation rather than as an inner SD so that the
    /// **marginal** prior on each coordinate is unchanged: with
    /// `σ_μ = σ_θ√ρ` and `σ_within = σ_θ√(1−ρ)`, every θ still has prior
    /// variance `σ_θ²` and only the *covariance* between group members moves.
    /// At `ρ = 0` the program is exactly the flat one.
    ///
    /// That distinction is not cosmetic. An earlier version of this used
    /// `σ_within = σ_θ/2` with `σ_μ = σ_θ`, which quietly inflated the
    /// marginal variance to `1.25 σ_θ²` — so it changed the prior's *scale*
    /// as well as its correlation, and any measurement of "does fusing help"
    /// was really measuring two changes at once.
    #[serde(default)]
    pub fused_rho: Option<f64>,
}

impl TasteConfig {
    /// A K=1 config for the given feature dimension.
    pub fn linear(n_features: usize) -> Self {
        Self {
            n_features,
            k_styles: 1,
            n_stars: 6,
            theta_prior_std: None,
            recency_half_life: None,
            fused: Vec::new(),
            fused_rho: None,
        }
    }

    /// A K-style mixture config for the given feature dimension.
    pub fn mixture(n_features: usize, k_styles: usize) -> Self {
        Self {
            k_styles: k_styles.max(1),
            ..Self::linear(n_features)
        }
    }

    /// Prior correlation within a fused group, clamped to `[0, 0.99]`.
    ///
    /// ## Why this ships at zero
    ///
    /// The machinery is implemented, correct and **switched off**, the way
    /// [`RefineKeep::Best`](../../auracle_session/enum.RefineKeep.html) and
    /// `Acquisition::Thompson` are kept after losing. Two gates were run and
    /// they **disagreed**, which is the finding.
    ///
    /// Swept against the always-on closed-loop gate — five seeds, a real
    /// posterior fit against a synthetic listener — fusing *helps*:
    ///
    /// ```text
    /// rho    mean posterior/truth r
    /// 0.00   0.657   (the flat prior, reproduced exactly)
    /// 0.25   0.702   <- best
    /// 0.50   0.644
    /// 0.75   fails the per-seed floor (seed 0x2 at 0.437)
    /// ```
    ///
    /// Measured on the **climb** at rho = 0.25 — 48 paired seeds, the gate that
    /// asks what the pool is actually worth to the listener — it *hurts*, and
    /// not marginally:
    ///
    /// ```text
    /// paired (fused − flat)   10% trimmed  −0.579 ± 0.188   (−3.09 se)
    ///                         median       −0.726
    ///                         sign         16 better / 32 worse, p = 0.029
    ///                         climbed      41/48 → 38/48
    /// ```
    ///
    /// **Both are true, and the reason is that they measure different things.**
    /// The closed-loop gate scores θ *recovery*, where pooling an
    /// ill-conditioned ridge is a real regularizer. The climb scores the true
    /// utility of the pool the search delivers, and there the pooling is a
    /// bias: this listener's taste puts 2.0 on `centroid_mean` and exactly 0
    /// on the other two, so shrinking them together drags the one coefficient
    /// that matters toward two that do not, and the search aims worse.
    ///
    /// That is the general warning, and it is worth more than the feature. A
    /// VIF says the three brightness coordinates move together **across
    /// patches** — a fact about φ. Fusing their coefficients asserts that a
    /// listener's **preferences** about them move together — a fact about
    /// people, which does not follow from the first and was not measured.
    ///
    /// Re-open this if the listener model ever gains a reason to believe
    /// preferences follow φ's correlation structure; the sweep and both gates
    /// are here to re-run.
    pub fn fused_rho(&self) -> f64 {
        self.fused_rho.unwrap_or(0.0).clamp(0.0, 0.99)
    }

    /// SD of a fused group's latent mean: `σ_θ√ρ`.
    pub fn sigma_group(&self) -> f64 {
        self.sigma_theta() * self.fused_rho().sqrt()
    }

    /// SD of a fused coordinate about its group mean: `σ_θ√(1−ρ)`. Together
    /// with [`Self::sigma_group`] this keeps the marginal at `σ_θ`.
    pub fn sigma_within(&self) -> f64 {
        self.sigma_theta() * (1.0 - self.fused_rho()).sqrt()
    }

    /// The groups actually in force. Empty when `ρ = 0`, so **ρ = 0 is the
    /// flat prior node for node** — no latent means, no extra sites, the same
    /// program this model has always run. A guard rather than an accident: a
    /// zero-SD `Normal` is not a distribution, and "turn the feature off"
    /// should not depend on remembering to also clear `fused`.
    pub fn effective_fused(&self) -> &[Vec<usize>] {
        if self.fused_rho() <= 0.0 {
            &[]
        } else {
            &self.fused
        }
    }

    /// Which fused group each coordinate belongs to, or `None` for the
    /// coordinates that keep the flat prior. Built once per fit.
    fn group_of(&self) -> Vec<Option<usize>> {
        let mut out = vec![None; self.n_features];
        for (g, members) in self.effective_fused().iter().enumerate() {
            for &i in members {
                if i < self.n_features {
                    out[i] = Some(g);
                }
            }
        }
        out
    }

    /// Prior SD of one θ coordinate, corrected for the max-of-K utility so
    /// that `Var(u_a − u_b)` is invariant to K (module doc).
    pub fn sigma_theta(&self) -> f64 {
        let k = self.k_styles.clamp(1, MAX_NORMAL_SD.len());
        let s_k = MAX_NORMAL_SD[k - 1];
        self.theta_prior_std
            .unwrap_or(1.0 / ((self.n_features as f64).sqrt() * s_k))
    }
}

/// One posterior draw of every latent.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TasteSample {
    /// Per-style weight vectors `[k][d]`.
    pub theta: Vec<Vec<f64>>,
    /// Per-session keep/kill thresholds.
    pub tau: Vec<f64>,
    /// Ordered star cutpoints (`n_stars − 1` of them).
    pub cuts: Vec<f64>,
}

impl TasteSample {
    /// Utility of a standardized candidate under one style lens.
    pub fn utility(&self, phi: &[f64], style: usize) -> f64 {
        dot(&self.theta[style], phi)
    }

    /// Mixture utility `u(φ) = max_k u_k(φ)`: a candidate is as good as its
    /// best style thinks it is. Reduces to `u_0` at K = 1. This is the one
    /// utility every likelihood and ranking uses.
    pub fn utility_mix(&self, phi: &[f64]) -> f64 {
        mix_of(self.dots(phi))
    }

    /// Probability this sample assigns to "a beats b".
    pub fn prob_prefers(&self, a: &[f64], b: &[f64]) -> f64 {
        sigmoid(self.utility_mix(a) - self.utility_mix(b))
    }

    /// Which style lens is this candidate's best (its island).
    pub fn best_style(&self, phi: &[f64]) -> usize {
        best_of(self.dots(phi))
    }

    /// Each lens's utility of a candidate, `θ_k · φ` in `k` order: what
    /// every utility, ranking and likelihood here is computed from. The fit's
    /// kernel keeps these per candidate and recomputes one lens's at a time.
    fn dots<'a>(&'a self, phi: &'a [f64]) -> impl Iterator<Item = f64> + Clone + 'a {
        self.theta.iter().map(move |t| dot(t, phi))
    }

    /// Log-likelihood this draw assigns to one standardized observation.
    pub fn loglik(&self, feedback: &Feedback, session: usize) -> f64 {
        obs_loglik(feedback, session, self)
    }

    /// [`Self::loglik`], told which coordinates of the observation were
    /// **imputed** rather than measured — see [`FitSet::absent`].
    pub fn loglik_with(&self, feedback: &Feedback, session: usize, absent: &[usize]) -> f64 {
        obs_loglik_with(feedback, session, self, absent)
    }
}

fn dot(a: &[f64], b: &[f64]) -> f64 {
    // `zip` truncates silently, which would turn a posterior loaded for a
    // different feature set into a utility over a prefix of φ. Every caller
    // pairs a θ with a φ of the posterior's own dimension: that is the
    // callers' contract, and nothing here checks it. (A `debug_assert` did,
    // in no build this repository makes: the tests build under test-fast,
    // which keeps release's `debug-assertions = false`, and the app ships
    // release.)
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// The mixture utility from the lenses' utilities in `k` order: their max,
/// folded from −∞ ([`TasteSample::utility_mix`]).
fn mix_of(dots: impl Iterator<Item = f64>) -> f64 {
    dots.fold(f64::NEG_INFINITY, f64::max)
}

/// The best lens from the lenses' utilities in `k` order: the index of their
/// max by `total_cmp`, the **last** of equal ones, as `max_by` returns it
/// ([`TasteSample::best_style`]); 0 when there are none.
fn best_of(dots: impl Iterator<Item = f64>) -> usize {
    dots.enumerate()
        .max_by(|(_, a), (_, b)| a.total_cmp(b))
        .map_or(0, |(k, _)| k)
}

/// Numerically stable `log σ(x)`.
fn log_sigmoid(x: f64) -> f64 {
    // -softplus(-x) with softplus(t) = max(t,0) + ln(1 + e^{-|t|}), and
    // |-x| = |x|: `-x.abs()` is -(|x|), the method before the sign.
    -((-x).max(0.0) + (-x.abs()).exp().ln_1p())
}

fn sigmoid(x: f64) -> f64 {
    1.0 / (1.0 + (-x).exp())
}

/// `ln(1 − e^{−d})` for `d ≥ 0`, accurate to a few ulps at every `d`
/// (Mächler, *Accurately computing log(1 − exp(−|a|))*, 2012). Near 0,
/// `e^{−d}` rounds toward 1 and `ln_1p(−e^{−d})` loses the digits that make
/// up `d`, which `exp_m1` keeps; far from 0, `1 − e^{−d}` rounds toward 1
/// and `ln` loses the tail, which `ln_1p` keeps. The two are equally good
/// at ln 2, where they change over. At `d = 0` it is −∞.
fn log1mexp(d: f64) -> f64 {
    if d > std::f64::consts::LN_2 {
        (-(-d).exp()).ln_1p()
    } else {
        (-(-d).exp_m1()).ln()
    }
}

/// Log-likelihood of one standardized observation under the max-of-experts
/// utility.
fn obs_loglik(o: &Feedback, session: usize, s: &TasteSample) -> f64 {
    obs_loglik_with(o, session, s, &[])
}

/// `1/√(1 + λ² σ²)` — the logistic analogue of marginalizing a Gaussian
/// through a probit link, with `λ² = π/8`.
///
/// A comparison whose utility is uncertain by `σ` should not be scored as if
/// it were known: `E[σ(u + ε)] ≈ σ(u / √(1 + πσ²/8))` for `ε ~ N(0, σ²)`. The
/// effect is to pull the log-odds toward zero — the model still learns from
/// the observation, it just stops claiming to be certain about a comparison
/// that is partly guesswork.
fn attenuate(var: f64) -> f64 {
    1.0 / (1.0 + std::f64::consts::PI * var / 8.0).sqrt()
}

/// Variance the **imputed** coordinates contribute to `u(x)` under this draw.
///
/// A coordinate imputed at the standardized mean is not known to be zero; it
/// is unknown, and its prior is the unit normal the standardizer defines. So
/// its contribution `θ_i · x_i` has variance `θ_i²`, read off the expert that
/// actually scores this candidate.
///
/// `dots` are the candidate's lens utilities in `k` order, which pick that
/// expert ([`best_of`]).
fn imputed_var(s: &TasteSample, dots: impl Iterator<Item = f64>, absent: &[usize]) -> f64 {
    if absent.is_empty() {
        return 0.0;
    }
    let k = best_of(dots);
    absent
        .iter()
        .filter_map(|&i| s.theta[k].get(i))
        .map(|t| t * t)
        .sum()
}

fn obs_loglik_with(o: &Feedback, session: usize, s: &TasteSample, absent: &[usize]) -> f64 {
    let (first, second) = candidates(o);
    row_loglik(o, session, s, absent, s.dots(first), s.dots(second))
}

/// An observation's candidates: a duel's `a` and `b`, or the one `x` and an
/// empty second.
fn candidates(o: &Feedback) -> (&[f64], &[f64]) {
    match o {
        Feedback::Duel { a, b, .. } => (a, b),
        Feedback::KeepKill { x, .. } | Feedback::Stars { x, .. } => (x, &[]),
    }
}

/// [`obs_loglik_with`] from the candidates' lens utilities in `k` order
/// ([`TasteSample::dots`]): `first` of a duel's `a` or the one `x`, `second`
/// of a duel's `b` (read only for a duel). Every likelihood of an
/// observation is this function, whether its utilities were just computed
/// or kept by the fit's kernel from an earlier step, so the two cannot
/// drift apart.
fn row_loglik<I>(
    o: &Feedback,
    session: usize,
    s: &TasteSample,
    absent: &[usize],
    first: I,
    second: I,
) -> f64
where
    I: Iterator<Item = f64> + Clone,
{
    match o {
        Feedback::Duel { chose_a, .. } => {
            // Nothing to correct: both candidates carry the same absence, so
            // the imputed terms cancel in the difference and the observation
            // is silent about those axes rather than wrong about them.
            let d = mix_of(first) - mix_of(second);
            log_sigmoid(if *chose_a { d } else { -d })
        }
        Feedback::KeepKill { kept, .. } => {
            // A session with no τ site (reweighting against a posterior fit
            // before that session existed) contributes no threshold evidence.
            let Some(tau) = s.tau.get(session) else {
                return 0.0;
            };
            // Here there is no second candidate to cancel against, so the
            // imputed coordinates enter the comparison as if they were
            // measured at the mean. They were not measured at all.
            let d = (mix_of(first.clone()) - tau) * attenuate(imputed_var(s, first, absent));
            log_sigmoid(if *kept { d } else { -d })
        }
        Feedback::Stars { rating, .. } => {
            // Same correction as keep/kill, and for the same reason: an
            // ordinal rating is a comparison of `u` against fixed cutpoints
            // with nothing to cancel the imputation against. The attenuation
            // multiplies the **difference** `c_k − u`, exactly as keep/kill
            // attenuates `u − τ`: it used to scale `u` alone, which applied no
            // correction at all at `u = 0` and moved the probability *away*
            // from the marginalised truth elsewhere (0.205 against 0.133 at
            // `u = 1.5`, by Monte Carlo).
            let a = attenuate(imputed_var(s, first.clone(), absent));
            let u = mix_of(first);
            let k = *rating as usize;
            let n_cats = s.cuts.len() + 1;
            let k = k.min(n_cats - 1);
            // Cumulative logit: P(y=k) = σ(a·(c_k−u)) − σ(a·(c_{k−1}−u)),
            // with `cuts` 0-based, c_{−1} = −∞ and c_{n−1} = +∞, computed in
            // log space, so a rating far from `u` scores its real (very
            // negative) log-prob rather than the `ln(1e-12) = −27.6` floor
            // the subtraction of two near-equal sigmoids used to bottom out
            // at.
            match (k == 0, k == n_cats - 1) {
                (true, true) => 0.0,
                (true, false) => log_sigmoid(a * (s.cuts[k] - u)),
                (false, true) => log_sigmoid(-a * (s.cuts[k - 1] - u)),
                (false, false) => {
                    // With b = a·(c_k − u) above l = a·(c_{k−1} − u),
                    // σ(b) − σ(l) = σ(b)·σ(−l)·(1 − e^{−(b−l)}) exactly, so
                    // ln P is three terms of one sign, none of them a
                    // difference of near-equal numbers: exact to a few ulps
                    // wherever `u` sits. The width b − l is taken from the
                    // cuts, so it does not round with `u`. Far below the
                    // lower cut this tends to a·(u − c_{k−1}) + ln(1 − e^{−d}),
                    // far above the upper one to a·(c_k − u) + ln(1 − e^{−d}).
                    // Written as ln σ(b) + ln(1 − σ(l)/σ(b)), as it was, the
                    // ratio rounded to 1 once `u` sat about 37 below the
                    // lower cut, and the result was −∞ where the true value
                    // is finite (#227).
                    log_sigmoid(a * (s.cuts[k] - u))
                        + log_sigmoid(-a * (s.cuts[k - 1] - u))
                        + log1mexp(a * (s.cuts[k] - s.cuts[k - 1]))
                }
            }
        }
    }
}

/// The MCMC site addresses of one taste program, built once.
///
/// There is one per `sample()` node — `d·K + S + (n_stars − 1) + K·G` of
/// them, **226** as shipped (K = 5, d = 44, one session, and no fused group,
/// since the fused prior defaults to off; a group would add K). The fit now
/// builds the program once, for its starting draw ([`TasteModel::fit`]), but
/// fugue's chain driver rebuilt it on every step, and building each address
/// inline (`addr!(format!("theta{k}"), i)`) then cost a `format!` into a
/// `String`, a re-allocation into `Arc<str>` and a SipHash of that string,
/// *per site per step*: ~3.7 M allocations per mature fit, and measurably the
/// bulk of the fit's wall time (`examples/fit_bench.rs`). The fit's kernel
/// keys its per-site proposal scales by these addresses too.
///
/// The addresses are a pure function of `(k_styles, n_features, n_stars,
/// n_sessions)`, none of which move during a fit, so they are built once and
/// [`Address`] is cloned into each node — an `Arc` refcount bump plus a copy
/// of the cached hash, no allocation and no hashing.
///
/// The strings are produced by the *same* `addr!` invocations as before
/// (`theta<k>#i`, `tau#s`, `cut#j`), so traces, serialized posteriors and any
/// warm-start path see byte-identical addresses.
#[derive(Clone, Debug)]
pub struct SiteAddrs {
    /// θ sites, flattened `k * n_features + i`.
    theta: Vec<Address>,
    /// τ sites, one per session.
    tau: Vec<Address>,
    /// Cutpoint raw sites, `n_stars − 1` of them.
    cut: Vec<Address>,
    /// Latent group means, flattened `k * n_groups + g` — one per fused
    /// group per style. Empty when nothing is fused, which is what keeps the
    /// site count and the addresses byte-identical for a flat config.
    mu: Vec<Address>,
}

impl SiteAddrs {
    /// Total `sample()` nodes in the program — what single-site MH divides its
    /// step budget across.
    ///
    /// `d·K + S + (n_stars − 1) + K·G`, where `G` is the number of fused
    /// groups. At K = 5, d = 44, S = 1 and one brightness group that is
    /// 220 + 1 + 5 + 5 = **231**; without the group it is the 226 the module
    /// doc quotes. (φ was 40 coordinates when these numbers were first
    /// written; `the_site_counts_the_docs_quote_are_the_live_phis` now
    /// checks them against the live feature set.)
    pub fn site_count(&self) -> usize {
        self.theta.len() + self.tau.len() + self.cut.len() + self.mu.len()
    }

    /// Every address in the program's execution order: μ, θ, τ, cuts.
    fn in_program_order(&self) -> impl Iterator<Item = &Address> {
        self.mu
            .iter()
            .chain(&self.theta)
            .chain(&self.tau)
            .chain(&self.cut)
    }

    /// Build the address table for `cfg` over a log spanning `n_sessions`.
    pub fn new(cfg: &TasteConfig, n_sessions: usize) -> Self {
        Self {
            theta: (0..cfg.k_styles)
                .flat_map(|k| (0..cfg.n_features).map(move |i| addr!(format!("theta{k}"), i)))
                .collect(),
            tau: (0..n_sessions).map(|s| addr!("tau", s)).collect(),
            cut: (0..cfg.n_stars.saturating_sub(1))
                .map(|j| addr!("cut", j))
                .collect(),
            mu: (0..cfg.k_styles)
                .flat_map(|k| {
                    (0..cfg.effective_fused().len()).map(move |g| addr!(format!("mu{k}"), g))
                })
                .collect(),
        }
    }
}

/// What the likelihood reads of a fit's data: the standardized rows, the
/// coordinates each imputed ([`FitSet::absent`]), and each row's recency
/// weight. A pure function of the config and the data, so it is built once
/// per fit, not once per MH step: the rows used to be cloned out of the
/// [`FitSet`] and the weights recomputed (a `powf` per row) every time the
/// program was rebuilt.
#[derive(Clone, Debug)]
struct Evidence {
    /// Standardized feedback and its session, in log order.
    rows: Vec<(Feedback, usize)>,
    /// Imputed coordinates per row, index-parallel to `rows` (may be short).
    absent: Vec<Vec<usize>>,
    /// Per-row likelihood weight: newest = 1, halving every
    /// `recency_half_life` rows back.
    weights: Vec<f64>,
}

impl Evidence {
    fn new(cfg: &TasteConfig, data: &FitSet) -> Self {
        let n_obs = data.rows.len();
        let weights = match cfg.recency_half_life {
            Some(hl) if hl > 0.0 => (0..n_obs)
                .map(|i| 0.5f64.powf((n_obs - 1 - i) as f64 / hl))
                .collect(),
            _ => vec![1.0; n_obs],
        };
        Self {
            rows: data.rows.clone(),
            absent: data.absent.clone(),
            weights,
        }
    }

    /// The weighted log-likelihood of every row under one draw: what the
    /// program's single `factor` carries. Its rows' [`Self::term`]s, summed
    /// in row order by `sum`: the fit's kernel sums its kept terms the same
    /// way, so the two totals are one number.
    fn loglik(&self, s: &TasteSample) -> f64 {
        self.rows
            .iter()
            .enumerate()
            .map(|(i, (o, _))| {
                let (first, second) = candidates(o);
                self.term(i, s, s.dots(first), s.dots(second))
            })
            .sum()
    }

    /// Row `i`'s weighted log-likelihood under `s`, from its candidates'
    /// lens utilities ([`row_loglik`]).
    fn term<I>(&self, i: usize, s: &TasteSample, first: I, second: I) -> f64
    where
        I: Iterator<Item = f64> + Clone,
    {
        let (o, session) = &self.rows[i];
        let absent = self.absent.get(i).map(Vec::as_slice).unwrap_or(&[]);
        self.weights[i] * row_loglik(o, *session, s, absent, first, second)
    }
}

/// Every site's prior, in the program's execution order: the μ sites, then
/// θ, then τ, then the cut raws. That is the order the program draws and
/// scores them in, and the order of a state's values in the fit's kernel
/// (`kernel.rs`), so a log-prior summed over it is the program's own sum,
/// term for term. Built once per fit from the config and the address table,
/// and read by both, so the two cannot disagree about a prior.
#[derive(Clone, Debug)]
struct Layout {
    /// One prior per site, in execution order.
    priors: Vec<SitePrior>,
    /// Where θ starts (after the μ sites).
    theta_at: usize,
    /// Where τ starts.
    tau_at: usize,
    /// Where the cut raws start; they run to the end.
    cut_at: usize,
    /// K, the number of θ rows.
    k_styles: usize,
    /// d, the length of each.
    n_features: usize,
}

/// One site's prior.
#[derive(Clone, Copy, Debug)]
enum SitePrior {
    /// The same `Normal` in every state.
    Fixed(Normal),
    /// A fused θ coordinate: `Normal(μ, sd)` about the value of the μ site
    /// at this index of the state (μ sites come first, so it is also the
    /// index into the program's list of drawn μ).
    About { mu: usize, sd: f64 },
}

impl Layout {
    fn new(cfg: &TasteConfig, addrs: &SiteAddrs) -> Self {
        let d = cfg.n_features;
        let n_groups = cfg.effective_fused().len();
        let group_of = cfg.group_of();
        let mut priors: Vec<SitePrior> = addrs
            .mu
            .iter()
            .map(|_| {
                SitePrior::Fixed(
                    Normal::new(0.0, cfg.sigma_group()).expect("valid group mean prior"),
                )
            })
            .collect();
        let theta_at = priors.len();
        // A coordinate in a fused group is drawn about that group's latent
        // mean rather than about zero, which is why the means come first.
        priors.extend((0..addrs.theta.len()).map(|idx| {
            let (k, i) = (idx / d, idx % d);
            match group_of[i] {
                Some(g) => SitePrior::About {
                    mu: k * n_groups + g,
                    sd: cfg.sigma_within(),
                },
                None => SitePrior::Fixed(
                    Normal::new(0.0, cfg.sigma_theta()).expect("valid theta prior"),
                ),
            }
        }));
        let tau_at = priors.len();
        let unit = Normal::new(0.0, 1.0).expect("valid unit prior");
        priors.extend(addrs.tau.iter().map(|_| SitePrior::Fixed(unit)));
        let cut_at = priors.len();
        priors.extend(addrs.cut.iter().map(|_| SitePrior::Fixed(unit)));
        Self {
            priors,
            theta_at,
            tau_at,
            cut_at,
            k_styles: cfg.k_styles,
            n_features: d,
        }
    }

    /// The prior of the site at `slot`, given the μ values drawn so far
    /// (the state's leading values, or the program's list of μ).
    fn normal(&self, slot: usize, mu: &[f64]) -> Normal {
        match self.priors[slot] {
            SitePrior::Fixed(n) => n,
            SitePrior::About { mu: m, sd } => {
                Normal::new(mu[m], sd).expect("valid fused theta prior")
            }
        }
    }

    /// The state's log-prior, summed from 0 in execution order, as the
    /// program's trace accumulates it. The fit's kernel keeps the terms and
    /// sums them with [`prior_total`]; this is the whole computation, the
    /// reference its tests check it against.
    #[cfg(test)]
    fn log_prior(&self, vals: &[f64]) -> f64 {
        prior_total((0..vals.len()).map(|slot| self.prior_term(slot, vals)))
    }

    /// The log-prior of the site at `slot`'s value in the state `vals`.
    fn prior_term(&self, slot: usize, vals: &[f64]) -> f64 {
        self.normal(slot, vals).log_prob(&vals[slot])
    }

    /// Decode a state's values into the draw the program would return.
    fn decode_into(&self, vals: &[f64], out: &mut TasteSample) {
        decode_into(
            self.k_styles,
            self.n_features,
            &vals[self.theta_at..self.tau_at],
            &vals[self.tau_at..self.cut_at],
            &vals[self.cut_at..],
            out,
        );
    }
}

/// A state's log-prior from its sites' terms in execution order: summed from
/// 0, as the program's trace accumulates it.
fn prior_total(terms: impl Iterator<Item = f64>) -> f64 {
    let mut lp = 0.0;
    for t in terms {
        lp += t;
    }
    lp
}

/// Decode the sites' values into a [`TasteSample`], reusing `out`'s buffers:
/// θ in `k_styles` rows, τ as drawn, and the ordered cutpoints from their
/// raw sites (`c₁ = −2 + 1.5·raw₀`, each next one `exp(−0.5 + 0.7·raw_j)`
/// above the last). The program and the kernel both decode through this.
fn decode_into(
    k_styles: usize,
    d: usize,
    theta_flat: &[f64],
    tau: &[f64],
    cut_raw: &[f64],
    out: &mut TasteSample,
) {
    out.theta.resize_with(k_styles, Vec::new);
    for (k, row) in out.theta.iter_mut().enumerate() {
        row.clear();
        row.extend_from_slice(&theta_flat[k * d..(k + 1) * d]);
    }
    out.tau.clear();
    out.tau.extend_from_slice(tau);
    out.cuts.clear();
    let mut c = f64::NAN;
    for (j, r) in cut_raw.iter().enumerate() {
        c = if j == 0 {
            -2.0 + 1.5 * r
        } else {
            c + (-0.5 + 0.7 * r).exp()
        };
        out.cuts.push(c);
    }
}

/// The taste model: prior over latents + observation-log likelihood.
#[derive(Clone, Debug)]
pub struct TasteModel {
    /// Configuration.
    pub cfg: TasteConfig,
}

impl TasteModel {
    /// Build with the given config.
    pub fn new(cfg: TasteConfig) -> Self {
        Self { cfg }
    }

    /// The fugue program. Returns the decoded [`TasteSample`]; the
    /// observation likelihood enters as a single `factor`.
    ///
    /// Builds a fresh [`SiteAddrs`] and a fresh copy of the evidence each
    /// call, so it is the right entry point for one-shot uses
    /// ([`Self::prior_sample`]); an inference path that rebuilt the program
    /// per step would build both once, outside its loop.
    pub fn model(&self, data: &FitSet) -> Model<TasteSample> {
        let addrs = Arc::new(SiteAddrs::new(&self.cfg, data.n_sessions().max(1)));
        let layout = Arc::new(Layout::new(&self.cfg, &addrs));
        self.model_at(&Arc::new(Evidence::new(&self.cfg, data)), &addrs, &layout)
    }

    /// The fugue program over a precomputed address table, layout and
    /// evidence.
    ///
    /// `addrs` must have been built by [`SiteAddrs::new`] from this model's
    /// config and the data's session count, `layout` by [`Layout::new`] from
    /// the config and `addrs`, and `evidence` by [`Evidence::new`] from the
    /// config and the same data. All three ride in [`Arc`] and are built once
    /// per use, so building the program is O(1) in the log size and
    /// allocation-free in the address count.
    fn model_at(
        &self,
        evidence: &Arc<Evidence>,
        addrs: &Arc<SiteAddrs>,
        layout: &Arc<Layout>,
    ) -> Model<TasteSample> {
        let evidence = evidence.clone();
        let layout = layout.clone();

        // μ: one latent mean per fused group per style, sampled *before* θ so
        // the members of a group can be drawn around it. With nothing fused
        // this list is empty and the program below is the flat one, node for
        // node.
        let mu_models: Vec<Model<f64>> = addrs
            .mu
            .iter()
            .enumerate()
            .map(|(slot, a)| sample(a.clone(), layout.normal(slot, &[])))
            .collect();

        let addrs_outer = addrs.clone();
        fugue::sequence_vec(mu_models).bind(move |mu| {
            let addrs = addrs_outer.clone();
            // θ: k_styles × n_features Normal sites, a fused coordinate about
            // its group's mean (`Layout`).
            let theta_models: Vec<Model<f64>> = addrs
                .theta
                .iter()
                .enumerate()
                .map(|(idx, a)| sample(a.clone(), layout.normal(layout.theta_at + idx, &mu)))
                .collect();

            fugue::sequence_vec(theta_models).bind(move |theta_flat| {
                // τ: one Normal site per session.
                let tau_models: Vec<Model<f64>> = addrs
                    .tau
                    .iter()
                    .enumerate()
                    .map(|(s, a)| sample(a.clone(), layout.normal(layout.tau_at + s, &[])))
                    .collect();
                fugue::sequence_vec(tau_models).bind(move |tau| {
                    // Cutpoint raws: n_stars − 1 Normal sites (ordered by
                    // transform).
                    let cut_models: Vec<Model<f64>> = addrs
                        .cut
                        .iter()
                        .enumerate()
                        .map(|(j, a)| sample(a.clone(), layout.normal(layout.cut_at + j, &[])))
                        .collect();
                    fugue::sequence_vec(cut_models).bind(move |cut_raw| {
                        let mut s = TasteSample {
                            theta: Vec::new(),
                            tau: Vec::new(),
                            cuts: Vec::new(),
                        };
                        decode_into(
                            layout.k_styles,
                            layout.n_features,
                            &theta_flat,
                            &tau,
                            &cut_raw,
                            &mut s,
                        );
                        let ll = evidence.loglik(&s);
                        factor(ll).map(move |_| s)
                    })
                })
            })
        })
    }

    /// Fit the posterior by adaptive single-site MH.
    ///
    /// `n_samples` post-warmup draws are kept (thinned to at most 500 for
    /// summary storage). Each MH step moves one site, so budget steps ≈
    /// `sites × desired effective sweeps`.
    ///
    /// # The chain is fugue's, run over a value array
    ///
    /// The kernel is fugue-ppl 0.2.3's adaptive single-site chain
    /// (`adaptive_mcmc_chain_thinned`), with the program taken out of the
    /// loop. fugue's driver rebuilds and re-runs the whole program on every
    /// step, which here meant 226 boxed `sample` nodes, their closures and a
    /// fresh 226-entry `BTreeMap` trace per step, to move one number: that
    /// rebuild, not the likelihood, was most of a refit's time. The program's
    /// structure never changes (every site is a real-valued `Normal`, none
    /// conditional on another's value), so `kernel.rs` holds the state as an
    /// array of values in execution order and scores a proposal with the
    /// program's own pieces (`Layout`'s priors, `decode_into`,
    /// `Evidence::loglik`).
    ///
    /// **The draws are bit-identical to fugue's driver's.** The start is a
    /// prior run of the program itself; the sites are visited in fugue's
    /// order and drawn from the stream as fugue draws them (the site, then
    /// the Gaussian step, then the uniform for the accept test when one is
    /// needed); the log-weight is summed in the trace's order; adaptation
    /// runs in warmup only; and every `stride`-th draw is kept. The kernel's
    /// tests check it against fugue's driver bit for bit, and `fit_bench`'s
    /// checksums are unchanged.
    ///
    /// Measured with `fit_bench 10000 3000` (13 000 steps), µs per step:
    ///
    /// | | first fit (K = 1, 6 rows, 50 sites) | mature fit (K = 5, 100 rows, 226 sites) |
    /// |---|---|---|
    /// | fugue's driver | 22.7 | 207.1 |
    /// | this kernel | **1.9** | **47.8** |
    ///
    /// What was left of a mature step then was the likelihood over its 100
    /// rows, recomputed whole though one site moved, and the prior over its
    /// 226 sites. So a step now recomputes only what its site reaches
    /// (`kernel.rs`): its own prior term (a μ's, those of the θ about it
    /// too), and of the likelihood, for a θ coordinate its lens's utility of
    /// each candidate and then each row's term from the kept utilities, for
    /// a τ its session's keeps, for a cut the stars, for a μ nothing. The
    /// terms are summed as the whole computations sum them, so the draws
    /// stay bit-identical. On another machine (a 4-core Linux box), µs per
    /// step:
    ///
    /// | | first fit | mature fit | split probe |
    /// |---|---|---|---|
    /// | every row and site rescored | 0.9 | 22.8 | 3.0 |
    /// | only what the site reaches | **0.6** | **7.1** | **0.7** |
    ///
    /// # The chain is thinned as it runs
    ///
    /// 97 % of the chain is discarded, and it is discarded *as it is
    /// produced*: only every `stride`-th draw of the sampling phase is ever
    /// copied out, so what stays resident is the 500 draws the posterior
    /// keeps, and the peak no longer scales with `mcmc_samples` (when the
    /// whole chain was materialized and thinned after, `fit_bench 10000
    /// 3000` peaked at 303.1 MB; thinned at the driver, 18.2 MB). The budget
    /// is free to be chosen on the recovery tables
    /// (`SessionConfig::mcmc_samples`) rather than against a memory ceiling.
    pub fn fit<R: Rng>(
        &self,
        rng: &mut R,
        data: &FitSet,
        n_samples: usize,
        n_warmup: usize,
    ) -> TastePosterior {
        // Every `stride`-th draw of the sampling phase is kept. See `KEEP`.
        // Rounded up, so at most `KEEP` are retained at any budget: rounded
        // down, a budget just under twice `KEEP` kept every draw, nearly
        // twice as many.
        let stride = n_samples.div_ceil(KEEP).max(1);
        let samples = kernel::chain(self, rng, data, n_samples, n_warmup, stride);
        TastePosterior {
            cfg: self.cfg.clone(),
            weights: vec![1.0 / samples.len().max(1) as f64; samples.len()],
            samples,
        }
    }

    /// Draw one prior sample (useful for prior-predictive checks).
    pub fn prior_sample<R: Rng>(&self, rng: &mut R, data: &FitSet) -> TasteSample {
        let (s, _) = run(
            PriorHandler {
                rng,
                trace: Trace::default(),
            },
            self.model(data),
        );
        s
    }
}

/// A fitted posterior: thinned MCMC draws, their importance weights, and
/// summaries. Weights are uniform straight out of a fit and concentrate as
/// [`TastePosterior::reweighted`] folds in observations between fits.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TastePosterior {
    /// The config this posterior was fit under.
    pub cfg: TasteConfig,
    /// Thinned posterior draws.
    pub samples: Vec<TasteSample>,
    /// Normalized importance weights, parallel to `samples`. Empty means
    /// uniform (and is what older persisted posteriors deserialize to).
    #[serde(default)]
    pub weights: Vec<f64>,
}

/// All permutations of `0..k` (k! of them; k is small).
fn permutations(k: usize) -> Vec<Vec<usize>> {
    if k <= 1 {
        return vec![(0..k).collect()];
    }
    let mut out = Vec::new();
    for p in permutations(k - 1) {
        for slot in 0..k {
            let mut q = p.clone();
            q.insert(slot, k - 1);
            out.push(q);
        }
    }
    out
}

/// Cosine similarity of two vectors: the cosine of the angle between them,
/// whatever their lengths, and 0 when either is zero (it has no direction).
/// Alignment matches lenses by it ([`TastePosterior::aligned_to`]), and the
/// gates score θ recovery with it (`synthetic::cosine` is this function).
///
/// A zero vector is a test, not an epsilon. Adding 1e-12 to the
/// denominator, as this did, bent the cosine of short vectors: two parallel
/// vectors a millionth long scored 0.5.
pub fn cosine(a: &[f64], b: &[f64]) -> f64 {
    let dot: f64 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let na: f64 = a.iter().map(|x| x * x).sum::<f64>().sqrt();
    let nb: f64 = b.iter().map(|x| x * x).sum::<f64>().sqrt();
    let norms = na * nb;
    if norms > 0.0 {
        dot / norms
    } else {
        0.0
    }
}

impl TastePosterior {
    /// Number of style components.
    pub fn k_styles(&self) -> usize {
        self.cfg.k_styles.max(1)
    }

    /// Importance weight of draw `i` (uniform when no weights are stored).
    pub fn weight(&self, i: usize) -> f64 {
        match self.weights.get(i) {
            Some(w) => *w,
            None => 1.0 / self.samples.len().max(1) as f64,
        }
    }

    /// Effective sample size of the weighted draws, `1 / Σ wₛ²`. Equals the
    /// draw count for uniform weights and collapses toward 1 as the weights
    /// concentrate — the trigger for paying for a full MCMC refit.
    pub fn ess(&self) -> f64 {
        // With no draws the sum is empty, so `sq` is 0 and the ESS is too.
        let sq: f64 = (0..self.samples.len())
            .map(|i| self.weight(i) * self.weight(i))
            .sum();
        if sq <= 0.0 {
            0.0
        } else {
            1.0 / sq
        }
    }

    /// Systematic resampling: draw the weighted set back to a uniformly
    /// weighted one of the same size, deterministically.
    ///
    /// Importance weights degenerate — after enough updates almost all the
    /// mass sits on one draw, and a "posterior" of one point tells the
    /// acquisition function that it is certain when it is merely exhausted.
    /// Resampling trades that for duplicate draws, which is the honest cost:
    /// the sample is impoverished but still spans the posterior's support, and
    /// [`Self::ess`] on the fresh uniform weights no longer *claims* more
    /// information than is there. It is a stopgap between full refits, not a
    /// substitute for one; `Engine::needs_refit` is still the thing to watch.
    ///
    /// Deterministic (systematic, offset ½N) rather than multinomial, because
    /// every other stochastic step in this engine is seeded and reproducible
    /// and this one has no reason not to be. Copy `i` is the weights'
    /// quantile at u = (i + ½)/N: the first draw whose cumulative weight
    /// reaches u. So a u exactly on the boundary between two draws goes to
    /// the earlier one, whose weight it completes.
    pub fn resampled(&self) -> TastePosterior {
        // With no draws the loop below never runs, and this is the empty
        // posterior it was given.
        let n = self.samples.len();
        let step = 1.0 / n as f64;
        let mut u = 0.5 * step;
        let mut cum = 0.0;
        let mut src = 0usize;
        let mut out = Vec::with_capacity(n);
        for _ in 0..n {
            while src + 1 < n && cum + self.weight(src) < u {
                cum += self.weight(src);
                src += 1;
            }
            out.push(self.samples[src].clone());
            u += step;
        }
        TastePosterior {
            cfg: self.cfg.clone(),
            samples: out,
            weights: vec![step; n],
        }
    }

    /// Fold one new standardized observation into the weights by sequential
    /// importance sampling: `w_s ← w_s · p(y | θ_s)`, renormalized.
    ///
    /// This is what makes each duel respond to the one before it. A full
    /// refit costs thousands of MCMC steps and cannot run per-vote; without this the
    /// acquisition function reads a frozen posterior and re-asks the same
    /// question until the next refit.
    ///
    /// While every weighted draw's log-likelihood is finite, the update is
    /// exact however firmly a vote rules out every draw still carrying
    /// weight: the likelihoods are shifted by the best among those draws, so
    /// the products cannot all underflow, and the weight moves to the draw
    /// that contradicts the vote least. A strong enough contradiction
    /// collapses the effective sample size, which is the caller's signal to
    /// resample and refit. Every vote on a finite φ has a finite
    /// log-likelihood under every draw: a duel, a keep/kill vote, and a star
    /// rating however far its utility sits from the cutpoints. So a stronger
    /// contradiction never moves the weights less than a weaker one.
    ///
    /// When a weighted draw's log-likelihood is NaN, or every one is −∞,
    /// there is nothing to update by, and the weights are kept as they were.
    /// Only a vote on a φ that is not finite gets there, such as one that
    /// holds a NaN, which gives every draw a NaN. Keeping the weights keeps
    /// what the votes since the last fit gathered, and the observation waits
    /// in the caller's log for the next fit. The effective sample size is
    /// unchanged.
    pub fn reweighted(&self, feedback: &Feedback, session: usize) -> TastePosterior {
        self.reweighted_with(feedback, session, &[])
    }

    /// [`Self::reweighted`], told which coordinates of the observation were
    /// imputed rather than measured — the same `absent` a full fit receives
    /// through [`FitSet::absent`](crate::observe::FitSet::absent), so the
    /// between-fits update and the fit weigh an imputed row the same way. An
    /// observation written under the current feature names has nothing
    /// absent, which is why [`Self::reweighted`] passes none.
    pub fn reweighted_with(
        &self,
        feedback: &Feedback,
        session: usize,
        absent: &[usize],
    ) -> TastePosterior {
        // With no draws every vector below is empty, and so is the result.
        let n = self.samples.len();
        let ll: Vec<f64> = self
            .samples
            .iter()
            .map(|s| obs_loglik_with(feedback, session, s, absent))
            .collect();
        // Shift by the best log-likelihood among the draws that still carry
        // weight before exponentiating. That draw's product is then its own
        // weight, so however firmly the vote rules out every weighted draw,
        // the sum cannot underflow and the update stays exact, as long as
        // that best log-likelihood is finite, which it is for every vote on
        // a finite φ. A draw with no weight takes no part, in the shift or in the
        // products. In the shift, one that scored best pushed every product
        // under the smallest double, and the update was skipped; in the
        // products, 0 · e^(ll − m) is 0 · ∞ = NaN once it scores far enough
        // above the others.
        let m = (0..n)
            .filter(|&i| self.weight(i) > 0.0)
            .map(|i| ll[i])
            .fold(f64::NEG_INFINITY, f64::max);
        let mut w: Vec<f64> = (0..n)
            .map(|i| match self.weight(i) {
                wi if wi > 0.0 => wi * (ll[i] - m).exp(),
                _ => 0.0,
            })
            .collect();
        let sum: f64 = w.iter().sum();
        if sum > 0.0 && sum.is_finite() {
            for wi in &mut w {
                *wi /= sum;
            }
        } else {
            // Nothing to update by: a weighted draw's log-likelihood is NaN,
            // or every one is −∞, so the shift is too and ll − m is NaN. Only
            // a vote on a φ that is not finite does either (one that holds a
            // NaN gives every draw NaN): on a finite φ every vote's
            // log-likelihood is finite, a middle star rating's too however
            // far below its lower cutpoint (#227). Keep the previous
            // weights, one per draw (a posterior persisted before reweighting
            // existed stores none, which reads as uniform); the observation
            // waits in the log for the next fit. Resetting to uniform here,
            // as this used to, threw away the evidence gathered since the
            // last fit. Weights with nothing left to keep (all zero, which
            // only a posterior built by hand holds) become uniform, so the
            // result is always a distribution.
            let kept: Vec<f64> = (0..n).map(|i| self.weight(i)).collect();
            let total: f64 = kept.iter().sum();
            w = if total > 0.0 && total.is_finite() {
                kept
            } else {
                vec![1.0 / n as f64; n]
            };
        }
        TastePosterior {
            cfg: self.cfg.clone(),
            samples: self.samples.clone(),
            weights: w,
        }
    }

    /// Resolve label switching: relabel each sample's styles to best match a
    /// reference (the last sample, then one refinement pass against the
    /// aligned mean), by total θ cosine similarity. Per-style summaries
    /// ([`Self::theta_mean`] etc.) are only meaningful on an aligned
    /// posterior. No-op at K = 1. K is assumed small (≤ 5): alignment is
    /// exhaustive over permutations.
    ///
    /// This aligns a posterior **to itself**. Two posteriors aligned this way
    /// agree on nothing about *which* lens is index 0 — with probability
    /// ≈ 1 − 1/K! two consecutive fits order the lenses differently — so a
    /// refit needs [`Self::aligned_to`] with the previous fit's means.
    pub fn aligned(&self) -> TastePosterior {
        if self.k_styles() == 1 || self.samples.is_empty() {
            return self.clone();
        }
        let reference = self.samples.last().expect("nonempty").theta.clone();
        self.aligned_to(&reference)
    }

    /// [`Self::aligned`] against an **external** reference: one θ vector per
    /// lens of a previous posterior, so lens `i` here is the lens that most
    /// resembles lens `i` there. This is what keeps a style's identity — and
    /// the name the player gave it — across refits, where the MCMC has no
    /// reason to return the lenses in the same order twice.
    ///
    /// The reference may be shorter than `K` (a lens was added because the log
    /// grew): the extra lenses land on the indices the reference does not
    /// claim, chosen by the same exhaustive search, so an old lens never has
    /// to move over to make room for a new one. A reference longer than `K`
    /// is truncated. An empty reference falls back to [`Self::aligned`].
    pub fn aligned_to(&self, reference: &[Vec<f64>]) -> TastePosterior {
        let k = self.k_styles();
        if k == 1 || self.samples.is_empty() {
            return self.clone();
        }
        if reference.is_empty() {
            return self.aligned();
        }
        let perms = permutations(k);
        let relabel = |s: &TasteSample, reference: &[Vec<f64>]| -> TasteSample {
            let scored = reference.len().min(k);
            let best = perms
                .iter()
                .max_by(|p, q| {
                    let score = |perm: &[usize]| -> f64 {
                        (0..scored)
                            .map(|i| cosine(&s.theta[perm[i]], &reference[i]))
                            .sum()
                    };
                    score(p).total_cmp(&score(q))
                })
                .expect("nonempty perms");
            TasteSample {
                theta: best.iter().map(|&i| s.theta[i].clone()).collect(),
                tau: s.tau.clone(),
                cuts: s.cuts.clone(),
            }
        };
        // Pass 1: align every sample to the reference.
        let pass1: Vec<TasteSample> = self.samples.iter().map(|s| relabel(s, reference)).collect();
        // Pass 2: align to the pass-1 mean.
        //
        // **Importance-weighted**, like every other summary on this type. The
        // draws stop being equally probable as soon as `reweighted` has folded
        // votes in between fits — that is what the weights are for — so an
        // unweighted reference mean aligns the labels against a posterior
        // nobody holds. It leans on draws the evidence has already discounted,
        // and leans hardest exactly when the weights have concentrated, which
        // is when the per-style summaries are most worth reading.
        let d = self.cfg.n_features;
        let mut mean = vec![vec![0.0; d]; k];
        for (i, s) in pass1.iter().enumerate() {
            let w = self.weight(i);
            for (mk, tk) in mean.iter_mut().zip(&s.theta) {
                for (m, t) in mk.iter_mut().zip(tk) {
                    *m += w * t;
                }
            }
        }
        TastePosterior {
            cfg: self.cfg.clone(),
            samples: pass1.iter().map(|s| relabel(s, &mean)).collect(),
            weights: self.weights.clone(),
        }
    }

    /// Posterior mean of θ for a style (align first at K > 1).
    pub fn theta_mean(&self, style: usize) -> Vec<f64> {
        let d = self.cfg.n_features;
        let mut m = vec![0.0; d];
        for (i, s) in self.samples.iter().enumerate() {
            let w = self.weight(i);
            for (mi, ti) in m.iter_mut().zip(&s.theta[style]) {
                *mi += w * ti;
            }
        }
        m
    }

    /// Per-dimension posterior std of θ for a style (credible-interval
    /// widths for taste instrumentation; align first at K > 1).
    pub fn theta_std(&self, style: usize) -> Vec<f64> {
        let d = self.cfg.n_features;
        let mean = self.theta_mean(style);
        let mut var = vec![0.0; d];
        for (i, s) in self.samples.iter().enumerate() {
            let w = self.weight(i);
            for ((v, t), m) in var.iter_mut().zip(&s.theta[style]).zip(&mean) {
                *v += w * (t - m) * (t - m);
            }
        }
        var.into_iter().map(f64::sqrt).collect()
    }

    /// Share of the given candidates claimed by each style: for each φ, the
    /// posterior probability that style k is its best lens, averaged over
    /// candidates. A style with ≈0 share is inactive — the user's taste has
    /// fewer islands than K. Align first at K > 1.
    pub fn style_share(&self, phis: &[Vec<f64>]) -> Vec<f64> {
        let k = self.k_styles();
        let mut m = vec![0.0; k];
        if phis.is_empty() {
            return m;
        }
        for phi in phis {
            for (mi, ri) in m.iter_mut().zip(self.responsibilities(phi)) {
                *mi += ri / phis.len() as f64;
            }
        }
        m
    }

    /// Posterior mean and std of the per-style utility `u_k(φ)`.
    pub fn utility(&self, phi: &[f64], style: usize) -> (f64, f64) {
        self.summarize(|s| s.utility(phi, style))
    }

    /// Posterior mean and std of the mixture utility (the ranking score).
    pub fn utility_mix(&self, phi: &[f64]) -> (f64, f64) {
        self.summarize(|s| s.utility_mix(phi))
    }

    /// Style responsibilities of a candidate: the posterior probability that
    /// each style is its best lens (align first at K > 1).
    pub fn responsibilities(&self, phi: &[f64]) -> Vec<f64> {
        let k = self.k_styles();
        let mut m = vec![0.0; k];
        for (i, s) in self.samples.iter().enumerate() {
            m[s.best_style(phi)] += self.weight(i);
        }
        m
    }

    /// [`Self::utility_mix`] and [`Self::responsibilities`] of one candidate
    /// in a single pass over the draws. Each draw's lens utilities are
    /// computed once and serve both: the max is its mixture utility, the
    /// argmax its best lens. The two calls cost about `3K − 2` dot products
    /// per draw (`best_style` recomputes both sides of every comparison);
    /// this costs `K`.
    ///
    /// Bit-identical to the two calls: the same dot products, folded and
    /// compared in the same order, summarized by the same arithmetic. It is
    /// what a summary taken per pool member after every pick can afford
    /// (`Engine::belief` in `auracle-session`).
    pub fn utility_mix_and_responsibilities(&self, phi: &[f64]) -> ((f64, f64), Vec<f64>) {
        let mut resp = vec![0.0; self.k_styles()];
        let mut us = Vec::with_capacity(self.samples.len());
        let mut lens = Vec::with_capacity(self.k_styles());
        for (i, s) in self.samples.iter().enumerate() {
            lens.clear();
            lens.extend(s.dots(phi));
            us.push(mix_of(lens.iter().copied()));
            resp[best_of(lens.iter().copied())] += self.weight(i);
        }
        (self.summarize_values(&us), resp)
    }

    /// Posterior mean and std of the utility's slope along a direction `d`
    /// at the candidate `phi`: how much the model's rating moves per unit
    /// moved along `d`, starting from that sound. PERFORM's lean on a
    /// control is this along the control's direction (`Engine::lean` in
    /// `auracle-session`).
    ///
    /// The utility is a max of experts, `u(φ) = max_k θ_k·φ`, so it is
    /// piecewise linear and its slope along `d` at `φ` is `θ_k·d` for the
    /// lens `k` that claims `φ`. The lens is chosen **per draw**
    /// ([`TasteSample::best_style`]: at a tie, the lens
    /// [`Self::responsibilities`] counts), so a draw in which another lens
    /// rates this sound highest answers with that lens's slope. That makes
    /// it the slope near this sound, not along the whole of a direction: a
    /// move far enough can hand the sound to another lens. Which lens a draw
    /// names does not depend on how its lenses are labeled, so this needs
    /// no alignment. Weighted by the importance weights, as every summary
    /// here is.
    ///
    /// `d` is over φ's own coordinates, as `phi` is (`cfg.n_features` of
    /// each: the callers' contract, as for every utility here). A unit `d`
    /// gives the slope in utility per σ moved.
    pub fn slope(&self, phi: &[f64], d: &[f64]) -> (f64, f64) {
        self.summarize(|s| dot(&s.theta[s.best_style(phi)], d))
    }

    fn summarize(&self, f: impl Fn(&TasteSample) -> f64) -> (f64, f64) {
        let us: Vec<f64> = self.samples.iter().map(f).collect();
        self.summarize_values(&us)
    }

    /// Weighted mean and std of one value per draw, in draw order.
    fn summarize_values(&self, us: &[f64]) -> (f64, f64) {
        let mean: f64 = us.iter().enumerate().map(|(i, u)| self.weight(i) * u).sum();
        let var: f64 = us
            .iter()
            .enumerate()
            .map(|(i, u)| self.weight(i) * (u - mean) * (u - mean))
            .sum();
        (mean, var.sqrt())
    }

    /// Posterior probability that candidate `a` beats candidate `b` in a duel
    /// (marginalizing θ, weights, and the per-observation lens).
    pub fn prob_prefers(&self, a: &[f64], b: &[f64]) -> f64 {
        self.samples
            .iter()
            .enumerate()
            .map(|(i, s)| self.weight(i) * s.prob_prefers(a, b))
            .sum()
    }

    /// Serialize to a JSON file (posterior snapshot; the log remains the
    /// source of truth).
    pub fn save(&self, path: &std::path::Path) -> std::io::Result<()> {
        std::fs::write(path, serde_json::to_string(self)?)
    }

    /// Load from a JSON file.
    pub fn load(path: &std::path::Path) -> std::io::Result<Self> {
        Ok(serde_json::from_str(&std::fs::read_to_string(path)?)?)
    }
}

#[cfg(test)]
mod tests;
