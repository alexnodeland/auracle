//! The taste model as a fugue program, and its MCMC posterior.
//!
//! ```text
//! θ_k  ~ Normal(0, σ_θ)      per style k, per feature      addr theta<k>#i
//! τ_s  ~ Normal(0, 1)        per session s (keep/kill bar) addr tau#s
//! z_s  ~ Categorical(1/K)    per session s (style), K > 1  addr z#s
//! cuts : c_1 = −2 + 1.5·raw₀;  c_j = c_{j−1} + exp(−0.5 + 0.7·raw_j)
//!                                                          addr cut#j
//! u(x) = θ_{z_s} · φ(x)
//! ```
//!
//! and one `factor` carrying the total log-likelihood of the observation log:
//! Bradley–Terry for duels, `σ(u − τ_s)` for keep/kill, cumulative-logit
//! ordinal for stars. Inference is fugue's adaptive single-site MH — every
//! site is `F64` (plus `Usize` style sites at K > 1), so the generic chain
//! applies unchanged.
//!
//! Default `σ_θ = 1/√d`, making the prior utility of a standardized candidate
//! roughly unit-variance — likelihood scales stay sane at any feature count.

use fugue::runtime::handler::run;
use fugue::runtime::interpreters::PriorHandler;
use fugue::{
    adaptive_mcmc_chain, addr, factor, sample, Categorical, Model, ModelExt, Normal, Trace,
};
use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::observe::{Observation, ObservationLog};

/// Model configuration.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TasteConfig {
    /// Feature dimension (after standardization).
    pub n_features: usize,
    /// Number of style components (mixture of linear experts). v1 ships 1.
    pub k_styles: usize,
    /// Number of star categories (ratings `0..n_stars`).
    pub n_stars: usize,
    /// Prior std of each θ coordinate. `None` → `1/√n_features`.
    pub theta_prior_std: Option<f64>,
}

impl TasteConfig {
    /// A K=1 config for the given feature dimension.
    pub fn linear(n_features: usize) -> Self {
        Self {
            n_features,
            k_styles: 1,
            n_stars: 6,
            theta_prior_std: None,
        }
    }

    fn sigma_theta(&self) -> f64 {
        self.theta_prior_std
            .unwrap_or(1.0 / (self.n_features as f64).sqrt())
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
    /// Per-session style assignments (all 0 at K = 1).
    pub styles: Vec<usize>,
}

impl TasteSample {
    /// Utility of a standardized candidate under a given style.
    pub fn utility(&self, phi: &[f64], style: usize) -> f64 {
        dot(&self.theta[style], phi)
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

/// Log-likelihood of one observation given the latents.
fn obs_loglik(o: &Observation, s: &TasteSample) -> f64 {
    match o {
        Observation::Duel {
            a,
            b,
            chose_a,
            session,
        } => {
            let style = s.styles[*session];
            let d = s.utility(a, style) - s.utility(b, style);
            log_sigmoid(if *chose_a { d } else { -d })
        }
        Observation::KeepKill { x, kept, session } => {
            let style = s.styles[*session];
            let d = s.utility(x, style) - s.tau[*session];
            log_sigmoid(if *kept { d } else { -d })
        }
        Observation::Stars { x, rating, session } => {
            let style = s.styles[*session];
            let u = s.utility(x, style);
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
    /// The observation list rides in an [`Arc`](std::sync::Arc): the model is
    /// reconstructed every MH step, and this keeps that reconstruction O(1)
    /// in the log size.
    pub fn model(&self, log: &ObservationLog) -> Model<TasteSample> {
        let cfg = self.cfg.clone();
        let obs = std::sync::Arc::new(log.observations.clone());
        let n_sessions = log.n_sessions().max(1);
        let sigma = cfg.sigma_theta();

        // θ: k_styles × n_features Normal sites.
        let theta_models: Vec<Model<f64>> = (0..cfg.k_styles)
            .flat_map(|k| {
                (0..cfg.n_features).map(move |i| {
                    sample(
                        addr!(format!("theta{k}"), i),
                        Normal::new(0.0, sigma).expect("valid theta prior"),
                    )
                })
            })
            .collect();

        let (d, k_styles) = (cfg.n_features, cfg.k_styles);
        let n_cuts = cfg.n_stars.saturating_sub(1);
        fugue::sequence_vec(theta_models).bind(move |theta_flat| {
            // τ: one Normal site per session.
            let tau_models: Vec<Model<f64>> = (0..n_sessions)
                .map(|s| {
                    sample(
                        addr!("tau", s),
                        Normal::new(0.0, 1.0).expect("valid tau prior"),
                    )
                })
                .collect();
            let obs = obs.clone();
            fugue::sequence_vec(tau_models).bind(move |tau| {
                // Cutpoint raws: n_stars − 1 Normal sites (ordered by transform).
                let cut_models: Vec<Model<f64>> = (0..n_cuts)
                    .map(|j| {
                        sample(
                            addr!("cut", j),
                            Normal::new(0.0, 1.0).expect("valid cut prior"),
                        )
                    })
                    .collect();
                let obs = obs.clone();
                fugue::sequence_vec(cut_models).bind(move |cut_raw| {
                    // z: one categorical style site per session (K > 1 only).
                    let style_models: Vec<Model<usize>> = if k_styles > 1 {
                        (0..n_sessions)
                            .map(|s| {
                                sample(
                                    addr!("z", s),
                                    Categorical::new(vec![1.0 / k_styles as f64; k_styles])
                                        .expect("valid style categorical"),
                                )
                            })
                            .collect()
                    } else {
                        Vec::new()
                    };
                    let obs = obs.clone();
                    fugue::sequence_vec(style_models).bind(move |styles| {
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
                        let styles = if styles.is_empty() {
                            vec![0; tau.len()]
                        } else {
                            styles
                        };
                        let s = TasteSample {
                            theta,
                            tau,
                            cuts,
                            styles,
                        };
                        let ll: f64 = obs.iter().map(|o| obs_loglik(o, &s)).sum();
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
    pub fn fit<R: Rng>(
        &self,
        rng: &mut R,
        log: &ObservationLog,
        n_samples: usize,
        n_warmup: usize,
    ) -> TastePosterior {
        let model_fn = || self.model(log);
        let chain = adaptive_mcmc_chain(rng, model_fn, n_samples, n_warmup);
        let keep = 500usize;
        let stride = (chain.len() / keep).max(1);
        let samples: Vec<TasteSample> = chain
            .into_iter()
            .step_by(stride)
            .map(|(s, _): (TasteSample, Trace)| s)
            .collect();
        TastePosterior {
            cfg: self.cfg.clone(),
            samples,
        }
    }

    /// Draw one prior sample (useful for prior-predictive checks).
    pub fn prior_sample<R: Rng>(&self, rng: &mut R, log: &ObservationLog) -> TasteSample {
        let (s, _) = run(
            PriorHandler {
                rng,
                trace: Trace::default(),
            },
            self.model(log),
        );
        s
    }
}

/// A fitted posterior: thinned MCMC draws plus summaries.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TastePosterior {
    /// The config this posterior was fit under.
    pub cfg: TasteConfig,
    /// Thinned posterior draws.
    pub samples: Vec<TasteSample>,
}

impl TastePosterior {
    /// Posterior mean of θ for a style.
    pub fn theta_mean(&self, style: usize) -> Vec<f64> {
        let d = self.cfg.n_features;
        let mut m = vec![0.0; d];
        for s in &self.samples {
            for (mi, ti) in m.iter_mut().zip(&s.theta[style]) {
                *mi += ti;
            }
        }
        for mi in &mut m {
            *mi /= self.samples.len().max(1) as f64;
        }
        m
    }

    /// Per-dimension posterior std of θ for a style (credible-interval
    /// widths for taste instrumentation).
    pub fn theta_std(&self, style: usize) -> Vec<f64> {
        let d = self.cfg.n_features;
        let mean = self.theta_mean(style);
        let mut var = vec![0.0; d];
        for s in &self.samples {
            for ((v, t), m) in var.iter_mut().zip(&s.theta[style]).zip(&mean) {
                *v += (t - m) * (t - m);
            }
        }
        var.into_iter()
            .map(|v| (v / self.samples.len().max(1) as f64).sqrt())
            .collect()
    }

    /// Posterior mean and std of `u(φ)` under a style.
    pub fn utility(&self, phi: &[f64], style: usize) -> (f64, f64) {
        let us: Vec<f64> = self.samples.iter().map(|s| s.utility(phi, style)).collect();
        let n = us.len().max(1) as f64;
        let mean = us.iter().sum::<f64>() / n;
        let var = us.iter().map(|u| (u - mean) * (u - mean)).sum::<f64>() / n;
        (mean, var.sqrt())
    }

    /// Posterior probability that candidate `a` beats candidate `b` in a duel
    /// (marginalizing θ).
    pub fn prob_prefers(&self, a: &[f64], b: &[f64], style: usize) -> f64 {
        let n = self.samples.len().max(1) as f64;
        self.samples
            .iter()
            .map(|s| sigmoid(s.utility(a, style) - s.utility(b, style)))
            .sum::<f64>()
            / n
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
