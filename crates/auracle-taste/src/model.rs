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
//! chain applies unchanged.
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
//! seconds, which is far too slow to run after every vote, so between fits the
//! session layer folds each new observation in by sequential importance
//! sampling ([`TastePosterior::reweighted`]): `w_s ← w_s · p(y | θ_s)`. That
//! is exact — the weighted draws target the updated posterior — and it costs
//! O(S). It degrades gracefully rather than silently: effective sample size
//! ([`TastePosterior::ess`]) falls as the weights concentrate, and that is the
//! signal to pay for a real refit.

use fugue::runtime::handler::run;
use fugue::runtime::interpreters::PriorHandler;
use fugue::{
    adaptive_mcmc_chain_thinned, addr, factor, sample, Address, Model, ModelExt, Normal, Trace,
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::observe::{Feedback, FitSet};

/// SD of the maximum of K iid standard normals, K = 1..=5. See the module doc.
pub const MAX_NORMAL_SD: [f64; 5] = [1.000, 0.826, 0.748, 0.701, 0.669];

/// Posterior draws retained from a fit, after thinning.
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
    /// in `[0, 1)`. `None` → 0.25, which is where the closed-loop gate put it.
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
    /// ## Why 0.25 and not more
    ///
    /// Swept against the always-on closed-loop gate, which fits a real
    /// posterior against a synthetic listener over five seeds:
    ///
    /// ```text
    /// rho    mean posterior/truth r
    /// 0.00   0.657   (the flat prior, reproduced exactly)
    /// 0.25   0.702   <- default
    /// 0.50   0.644
    /// 0.75   fails the per-seed floor (seed 0x2 at 0.437)
    /// ```
    ///
    /// The shape is the point. Mild pooling *regularizes* an ill-conditioned
    /// ridge; strong pooling *overrides the data*. That the curve turns over
    /// is a warning about what a fused prior actually assumes: a VIF says the
    /// three brightness coordinates move together **across patches**, which is
    /// a fact about φ. Fusing their coefficients asserts that a listener's
    /// *preferences* about them move together, which is a fact about people
    /// and does not follow. The gate's synthetic listener weights
    /// `centroid_mean` and ignores the other two — a taste that respects the
    /// cluster's geometry not at all — and at rho = 0.75 the prior is confident
    /// enough to lose to it.
    pub fn fused_rho(&self) -> f64 {
        self.fused_rho.unwrap_or(0.25).clamp(0.0, 0.99)
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
        self.theta
            .iter()
            .map(|t| dot(t, phi))
            .fold(f64::NEG_INFINITY, f64::max)
    }

    /// Probability this sample assigns to "a beats b".
    pub fn prob_prefers(&self, a: &[f64], b: &[f64]) -> f64 {
        sigmoid(self.utility_mix(a) - self.utility_mix(b))
    }

    /// Which style lens is this candidate's best (its island).
    pub fn best_style(&self, phi: &[f64]) -> usize {
        (0..self.theta.len())
            .max_by(|&i, &j| dot(&self.theta[i], phi).total_cmp(&dot(&self.theta[j], phi)))
            .unwrap_or(0)
    }

    /// Log-likelihood this draw assigns to one standardized observation.
    pub fn loglik(&self, feedback: &Feedback, session: usize) -> f64 {
        obs_loglik(feedback, session, self)
    }
}

fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// Numerically stable `log σ(x)`.
fn log_sigmoid(x: f64) -> f64 {
    // -softplus(-x) with softplus(t) = max(t,0) + ln(1 + e^{-|t|}).
    -((-x).max(0.0) + (-(-x).abs()).exp().ln_1p())
}

fn sigmoid(x: f64) -> f64 {
    1.0 / (1.0 + (-x).exp())
}

/// Log-likelihood of one standardized observation under the max-of-experts
/// utility.
fn obs_loglik(o: &Feedback, session: usize, s: &TasteSample) -> f64 {
    match o {
        Feedback::Duel { a, b, chose_a } => {
            let d = s.utility_mix(a) - s.utility_mix(b);
            log_sigmoid(if *chose_a { d } else { -d })
        }
        Feedback::KeepKill { x, kept } => {
            // A session with no τ site (reweighting against a posterior fit
            // before that session existed) contributes no threshold evidence.
            let Some(tau) = s.tau.get(session) else {
                return 0.0;
            };
            let d = s.utility_mix(x) - tau;
            log_sigmoid(if *kept { d } else { -d })
        }
        Feedback::Stars { x, rating } => {
            let u = s.utility_mix(x);
            let k = *rating as usize;
            let n_cats = s.cuts.len() + 1;
            let k = k.min(n_cats - 1);
            // Cumulative logit: P(y=k) = σ(c_{k+1}−u) − σ(c_k−u),
            // with c_0 = −∞ and c_{n} = +∞.
            let upper = if k == n_cats - 1 {
                1.0
            } else {
                sigmoid(s.cuts[k] - u)
            };
            let lower = if k == 0 {
                0.0
            } else {
                sigmoid(s.cuts[k - 1] - u)
            };
            (upper - lower).max(1e-12).ln()
        }
    }
}

/// The MCMC site addresses of one taste program, built once.
///
/// Single-site MH re-executes the whole program on **every step**, so every
/// `sample()` node — `d·K + S + (n_stars − 1) + K·G` of them, **211** at
/// K = 5, d = 40, one session and one fused group (206 with no group) — is
/// reconstructed
/// 26 000 times per fit. Building each address inline
/// (`addr!(format!("theta{k}"), i)`) therefore cost a `format!` into a
/// `String`, a re-allocation into `Arc<str>` and a SipHash of that string,
/// *per site per step*: ~3.7 M allocations per mature fit, and measurably the
/// bulk of the fit's wall time (see `examples/fit_bench.rs` — the fit is
/// `steps × sites`-shaped, and the likelihood is ~20 % of it even at
/// n_obs = 100).
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
    /// step budget across, and the number the fit's cost is linear in.
    ///
    /// `d·K + S + (n_stars − 1) + K·G`, where `G` is the number of fused
    /// groups. At K = 5, d = 40, S = 1 and one brightness group that is
    /// 200 + 1 + 5 + 5 = **211**; without the group it is the 206 the module
    /// doc quotes.
    pub fn site_count(&self) -> usize {
        self.theta.len() + self.tau.len() + self.cut.len() + self.mu.len()
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
    /// Builds a fresh [`SiteAddrs`] each call, so it is the right entry point
    /// for one-shot uses ([`Self::prior_sample`]). Inference paths that
    /// rebuild the program per step must hoist the table out of the loop and
    /// call [`Self::model_at`] — that is what [`Self::fit`] does.
    pub fn model(&self, data: &FitSet) -> Model<TasteSample> {
        let addrs = Arc::new(SiteAddrs::new(&self.cfg, data.n_sessions().max(1)));
        self.model_at(data, &addrs)
    }

    /// The fugue program over a precomputed address table.
    ///
    /// `addrs` must have been built by [`SiteAddrs::new`] from this model's
    /// config and this `data`'s session count; it is cheap to clone and is
    /// intended to be built once per fit and shared across every MH step.
    ///
    /// The observation list and the address table both ride in
    /// [`Arc`]: the model is reconstructed every MH step, and
    /// this keeps that reconstruction O(1) in the log size and
    /// allocation-free in the address count.
    pub fn model_at(&self, data: &FitSet, addrs: &Arc<SiteAddrs>) -> Model<TasteSample> {
        let cfg = self.cfg.clone();
        let obs = Arc::new(data.rows.clone());
        // Per-observation likelihood weights: newest = 1, halving every
        // `recency_half_life` observations back.
        let n_obs = data.rows.len();
        let weights = Arc::new(match cfg.recency_half_life {
            Some(hl) if hl > 0.0 => (0..n_obs)
                .map(|i| 0.5f64.powf((n_obs - 1 - i) as f64 / hl))
                .collect(),
            _ => vec![1.0; n_obs],
        });
        let sigma = cfg.sigma_theta();
        let sigma_within = cfg.sigma_within();
        let sigma_group = cfg.sigma_group();
        let group_of = Arc::new(cfg.group_of());
        let n_groups = cfg.effective_fused().len();

        // μ: one latent mean per fused group per style, sampled *before* θ so
        // the members of a group can be drawn around it. With nothing fused
        // this list is empty and the program below is the flat one, node for
        // node.
        let mu_models: Vec<Model<f64>> = addrs
            .mu
            .iter()
            .map(|a| {
                sample(
                    a.clone(),
                    Normal::new(0.0, sigma_group).expect("valid group mean prior"),
                )
            })
            .collect();

        let (d, k_styles) = (cfg.n_features, cfg.k_styles);
        let addrs_outer = addrs.clone();
        fugue::sequence_vec(mu_models).bind(move |mu| {
            let addrs = addrs_outer.clone();
            let group_of = group_of.clone();
            // θ: k_styles × n_features Normal sites. A coordinate in a fused
            // group is drawn about that group's latent mean rather than about
            // zero — which is the whole of the change, and why the group mean had
            // to be sampled first.
            let theta_models: Vec<Model<f64>> = addrs
                .theta
                .iter()
                .enumerate()
                .map(|(idx, a)| {
                    let (k, i) = (idx / d, idx % d);
                    let (mean, sd) = match group_of[i] {
                        Some(g) => (mu[k * n_groups + g], sigma_within),
                        None => (0.0, sigma),
                    };
                    sample(a.clone(), Normal::new(mean, sd).expect("valid theta prior"))
                })
                .collect();

            let addrs = addrs.clone();
            fugue::sequence_vec(theta_models).bind(move |theta_flat| {
                // τ: one Normal site per session.
                let tau_models: Vec<Model<f64>> = addrs
                    .tau
                    .iter()
                    .map(|a| sample(a.clone(), Normal::new(0.0, 1.0).expect("valid tau prior")))
                    .collect();
                let obs = obs.clone();
                let weights = weights.clone();
                fugue::sequence_vec(tau_models).bind(move |tau| {
                    // Cutpoint raws: n_stars − 1 Normal sites (ordered by
                    // transform).
                    let cut_models: Vec<Model<f64>> = addrs
                        .cut
                        .iter()
                        .map(|a| sample(a.clone(), Normal::new(0.0, 1.0).expect("valid cut prior")))
                        .collect();
                    let obs = obs.clone();
                    let weights = weights.clone();
                    fugue::sequence_vec(cut_models).bind(move |cut_raw| {
                        let theta: Vec<Vec<f64>> = (0..k_styles)
                            .map(|ki| theta_flat[ki * d..(ki + 1) * d].to_vec())
                            .collect();
                        // Ordered cutpoints from raw sites.
                        let mut cuts = Vec::with_capacity(cut_raw.len());
                        let mut c = f64::NAN;
                        for (j, r) in cut_raw.iter().enumerate() {
                            c = if j == 0 {
                                -2.0 + 1.5 * r
                            } else {
                                c + (-0.5 + 0.7 * r).exp()
                            };
                            cuts.push(c);
                        }
                        let s = TasteSample { theta, tau, cuts };
                        let ll: f64 = obs
                            .iter()
                            .zip(weights.iter())
                            .map(|((o, session), w)| w * obs_loglik(o, *session, &s))
                            .sum();
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
    /// # The chain is thinned at the driver, not after it
    ///
    /// 97 % of the chain is discarded, and it is discarded *as it is produced*.
    /// That used to happen one line after the whole chain was built:
    /// `adaptive_mcmc_chain` materialized every step — a `(TasteSample, Trace)`
    /// per iteration pushed into a `Vec` returned by value — and only then did
    /// `step_by(stride)` keep every 20th. At K = 5 that is ~10 000 `Trace`
    /// clones of 206 `BTreeMap` entries held live at once to keep 500, scaling
    /// with `n_samples`: a plausible mobile-Safari OOM rather than mere waste
    /// on a 32-bit heap.
    ///
    /// It could not be fixed here — the retention was inside fugue's chain
    /// driver, and the pieces needed to reimplement that driver with identical
    /// RNG consumption (`single_site_mh_step`, `propose_and_score`,
    /// `SingleSiteProposalHandler`) are private or `pub(crate)`. So it was
    /// fixed *there*: `adaptive_mcmc_chain_thinned` (fugue-ppl 0.2.2) takes a
    /// stride and pushes only on `i % thin == 0`.
    ///
    /// **The draws are bit-identical to what the old code returned.** `thin`
    /// gates the push and nothing else: every transition still runs, so the RNG
    /// is consumed in the same order and quantity, and `0, stride, 2·stride, …`
    /// is exactly what `step_by(stride)` kept. `fit_bench`'s per-fit checksum
    /// is the auracle-side witness; fugue's own
    /// `thinning_retains_exactly_the_draws_step_by_would` is the upstream one.
    ///
    /// Measured, `fit_bench 10000 3000` under `/usr/bin/time -l`:
    ///
    /// | | peak RSS | mature-fit checksum |
    /// |---|---|---|
    /// | before | 303.1 MB | `07d204764b58c88b` |
    /// | after | **18.2 MB** | `07d204764b58c88b` |
    ///
    /// **16.7× less peak memory for the same draws** — the checksum is the
    /// point of that table, not a footnote to it. What stays resident is the
    /// 500 draws the posterior actually keeps, so the peak no longer scales
    /// with `mcmc_samples` at all: the budget is free to be chosen on the
    /// recovery tables (`SessionConfig::mcmc_samples`) rather than against a
    /// memory ceiling.
    pub fn fit<R: Rng>(
        &self,
        rng: &mut R,
        data: &FitSet,
        n_samples: usize,
        n_warmup: usize,
    ) -> TastePosterior {
        // Hoisted out of the step loop: the address table is identical for
        // every one of the `n_samples + n_warmup` reconstructions.
        let addrs = Arc::new(SiteAddrs::new(&self.cfg, data.n_sessions().max(1)));
        let model_fn = || self.model_at(data, &addrs);
        // The stride is known before the chain runs, because the driver pushes
        // exactly `n_samples` draws — so asking it to retain only every
        // `stride`-th is the same subsequence `step_by` produced, without ever
        // holding the other 95% live. See `KEEP`.
        let stride = (n_samples / KEEP).max(1);
        let samples: Vec<TasteSample> =
            adaptive_mcmc_chain_thinned(rng, model_fn, n_samples, n_warmup, stride)
                .into_iter()
                .map(|(s, _): (TasteSample, Trace)| s)
                .collect();
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

fn cosine(a: &[f64], b: &[f64]) -> f64 {
    let dot: f64 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let na: f64 = a.iter().map(|x| x * x).sum::<f64>().sqrt();
    let nb: f64 = b.iter().map(|x| x * x).sum::<f64>().sqrt();
    dot / (na * nb + 1e-12)
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
        let n = self.samples.len();
        if n == 0 {
            return 0.0;
        }
        let sq: f64 = (0..n).map(|i| self.weight(i) * self.weight(i)).sum();
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
    /// and this one has no reason not to be.
    pub fn resampled(&self) -> TastePosterior {
        let n = self.samples.len();
        if n == 0 {
            return self.clone();
        }
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
    /// refit costs seconds of MCMC and cannot run per-vote; without this the
    /// acquisition function reads a frozen posterior and re-asks the same
    /// question until the next refit.
    pub fn reweighted(&self, feedback: &Feedback, session: usize) -> TastePosterior {
        let n = self.samples.len();
        if n == 0 {
            return self.clone();
        }
        let ll: Vec<f64> = self
            .samples
            .iter()
            .map(|s| obs_loglik(feedback, session, s))
            .collect();
        // Shift by the max before exponentiating: log-likelihoods here are
        // bounded above by 0, but the same guard keeps mixed modalities safe.
        let m = ll.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let mut w: Vec<f64> = (0..n).map(|i| self.weight(i) * (ll[i] - m).exp()).collect();
        let sum: f64 = w.iter().sum();
        if sum > 0.0 && sum.is_finite() {
            for wi in &mut w {
                *wi /= sum;
            }
        } else {
            w = vec![1.0 / n as f64; n];
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
    pub fn aligned(&self) -> TastePosterior {
        let k = self.k_styles();
        if k == 1 || self.samples.is_empty() {
            return self.clone();
        }
        let perms = permutations(k);
        let relabel = |s: &TasteSample, reference: &[Vec<f64>]| -> TasteSample {
            let best = perms
                .iter()
                .max_by(|p, q| {
                    let score = |perm: &[usize]| -> f64 {
                        (0..k)
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
        // Pass 1: align to the last sample.
        let reference = self.samples.last().expect("nonempty").theta.clone();
        let pass1: Vec<TasteSample> = self
            .samples
            .iter()
            .map(|s| relabel(s, &reference))
            .collect();
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

    fn summarize(&self, f: impl Fn(&TasteSample) -> f64) -> (f64, f64) {
        let us: Vec<f64> = self.samples.iter().map(f).collect();
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
