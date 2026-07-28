//! The two-loop session engine (DESIGN.md §1.5).
//!
//! - **Patch loop** (machine-paced, silent): fill a pool with vetted prior
//!   draws; once a posterior exists, *refine* — warm-start fugue-evo's typed
//!   MH from the best pool members on the Boltzmann target
//!   `π_β ∝ p_grammar · exp(β·E[u_θ])` and inject improved candidates.
//! - **Taste loop** (human-paced, persistent): feedback events append to the
//!   [`ObservationLog`]; the posterior is re-fit from the log.
//!
//! Between them, **acquisition**: duels are chosen by dueling Thompson
//! sampling — draw two posterior θ samples, duel each sample's champion.
//! Early on the posterior is diffuse, so champions disagree and duels are
//! informative; as it concentrates, duels converge on the frontier of taste.
//! With no posterior yet, duels are uniform random.
//!
//! All UI modes are emitters into the same observation stream: the engine
//! does not know which surface produced an event.

use evosynth_features::{featurize, Features, PhraseSpec, RenderedPhrase};
use evosynth_grammar::{PatchGrammarPrior, PatchTree};
use evosynth_taste::{
    Observation, ObservationLog, Standardizer, TasteConfig, TasteModel, TastePosterior,
};
use fugue_evo::inference::mh::EvolutionChain;
use fugue_evo::inference::model::EvolutionModel;
use rand::Rng;
use std::sync::Arc;

use crate::surrogate::SurrogateFitness;

/// Engine configuration.
#[derive(Clone, Debug)]
pub struct SessionConfig {
    /// Vetted candidates to maintain in the pool.
    pub pool_size: usize,
    /// Maximum prior draws attempted per `fill_pool` (vet failures burn
    /// attempts).
    pub max_draws: usize,
    /// MH refinement steps per seed.
    pub refine_steps: usize,
    /// How many top candidates to refine from.
    pub refine_seeds: usize,
    /// Boltzmann sharpness β of the refinement target.
    pub beta: f64,
    /// The audition stimulus.
    pub phrase: PhraseSpec,
    /// Keep audition buffers in the pool (frontends want them; headless
    /// tests don't need the memory).
    pub keep_renders: bool,
    /// MCMC samples / warmup for posterior fits.
    pub mcmc_samples: usize,
    /// MCMC warmup steps.
    pub mcmc_warmup: usize,
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            pool_size: 48,
            max_draws: 400,
            refine_steps: 12,
            refine_seeds: 3,
            beta: 2.0,
            phrase: PhraseSpec::default(),
            keep_renders: false,
            mcmc_samples: 30_000,
            mcmc_warmup: 10_000,
        }
    }
}

/// A vetted pool member.
pub struct Candidate {
    /// The term.
    pub tree: PatchTree,
    /// Its extracted features.
    pub features: Features,
    /// Standardized feature vector (empty until the standardizer exists).
    pub phi_std: Vec<f64>,
    /// The audition buffer (kept only when `keep_renders`).
    pub render: Option<RenderedPhrase>,
    /// True if this candidate came from taste-guided refinement rather than
    /// the prior.
    pub refined: bool,
}

/// The session engine.
pub struct Engine {
    /// Configuration.
    pub cfg: SessionConfig,
    /// The patch prior.
    pub prior: PatchGrammarPrior,
    /// Standardizer fit on the first pool fill; persisted with the profile.
    pub standardizer: Option<Arc<Standardizer>>,
    /// The observation log (source of truth).
    pub log: ObservationLog,
    /// The current posterior, if fit.
    pub posterior: Option<Arc<TastePosterior>>,
    /// Current session index.
    pub session: usize,
    /// The candidate pool.
    pub pool: Vec<Candidate>,
}

impl Engine {
    /// Create an engine over the given prior.
    pub fn new(prior: PatchGrammarPrior, cfg: SessionConfig) -> Self {
        Self {
            cfg,
            prior,
            standardizer: None,
            log: ObservationLog::new(),
            posterior: None,
            session: 0,
            pool: Vec::new(),
        }
    }

    /// Start a new session (its own τ / style latents). Returns its index.
    pub fn begin_session(&mut self) -> usize {
        if !self.log.is_empty() {
            self.session = self.log.n_sessions();
        }
        self.session
    }

    /// Fill the pool with vetted prior draws (up to `pool_size`). Fits the
    /// standardizer on the first successful fill.
    pub fn fill_pool<R: Rng>(&mut self, rng: &mut R) {
        let target = self.cfg.pool_size;
        while self.pool.len() < target {
            if self.fill_pool_step(rng, target - self.pool.len()) == 0 {
                break;
            }
        }
        // Fill fell short (vet failures exhausted the draw budget): fit the
        // standardizer on what we have rather than leaving φ un-standardized.
        if self.standardizer.is_none() && !self.pool.is_empty() {
            let rows: Vec<Vec<f64>> = self.pool.iter().map(|c| c.features.phi()).collect();
            self.standardizer = Some(Arc::new(Standardizer::fit(&rows)));
            for c in &mut self.pool {
                c.phi_std = self
                    .standardizer
                    .as_ref()
                    .unwrap()
                    .transform(&c.features.phi());
            }
        }
    }

    /// Add up to `max_new` vetted candidates (bounded by `max_draws`
    /// attempts). Returns how many were added — the incremental unit that
    /// lets a frontend post progress between batches. Standardization runs
    /// once the pool first reaches `pool_size` (or on any later addition).
    pub fn fill_pool_step<R: Rng>(&mut self, rng: &mut R, max_new: usize) -> usize {
        let mut draws = 0;
        let mut added = 0;
        while added < max_new && self.pool.len() < self.cfg.pool_size && draws < self.cfg.max_draws
        {
            draws += 1;
            let tree = self.prior.sample_with_rng(rng);
            if self.pool.iter().any(|c| c.tree == tree) {
                continue;
            }
            if let Ok(v) = featurize(&tree, &self.cfg.phrase) {
                self.pool.push(Candidate {
                    tree,
                    phi_std: Vec::new(),
                    render: self.cfg.keep_renders.then_some(v.render),
                    features: v.features,
                    refined: false,
                });
                added += 1;
            }
        }
        if self.standardizer.is_none() && self.pool.len() >= self.cfg.pool_size {
            let rows: Vec<Vec<f64>> = self.pool.iter().map(|c| c.features.phi()).collect();
            self.standardizer = Some(Arc::new(Standardizer::fit(&rows)));
        }
        if let Some(sz) = &self.standardizer {
            for c in &mut self.pool {
                if c.phi_std.is_empty() {
                    c.phi_std = sz.transform(&c.features.phi());
                }
            }
        }
        added
    }

    /// Fit (or re-fit) the taste posterior from the observation log.
    pub fn fit_posterior<R: Rng>(&mut self, rng: &mut R) {
        let d = match &self.standardizer {
            Some(sz) => sz.dimension(),
            None => return,
        };
        if self.log.is_empty() {
            return;
        }
        let model = TasteModel::new(TasteConfig::linear(d));
        let posterior = model.fit(rng, &self.log, self.cfg.mcmc_samples, self.cfg.mcmc_warmup);
        self.posterior = Some(Arc::new(posterior));
    }

    /// Taste-guided refinement: run fugue-evo typed MH on the Boltzmann
    /// target from each of the top seeds, and add improved, vetted, novel
    /// candidates to the pool (evicting the worst if full).
    pub fn refine<R: Rng>(&mut self, rng: &mut R) {
        let (Some(posterior), Some(standardizer)) = (&self.posterior, &self.standardizer) else {
            return;
        };
        let fitness = SurrogateFitness {
            posterior: Arc::clone(posterior),
            standardizer: Arc::clone(standardizer),
            phrase: self.cfg.phrase.clone(),
            style: 0,
        };
        let model =
            EvolutionModel::new(self.prior.clone(), fitness.clone()).with_beta(self.cfg.beta);
        let mut chain = EvolutionChain::new(model);

        let ranked = self.ranked();
        let seeds: Vec<PatchTree> = ranked
            .iter()
            .take(self.cfg.refine_seeds)
            .map(|&(i, _, _)| self.pool[i].tree.clone())
            .collect();

        for seed in seeds {
            let Some(mut trace) = chain.init_from(&seed) else {
                continue;
            };
            let mut current = seed;
            for _ in 0..self.cfg.refine_steps {
                let (g, t) = chain.step(rng, &trace);
                current = g;
                trace = t;
            }
            if self.pool.iter().any(|c| c.tree == current) {
                continue;
            }
            if let Ok(v) = featurize(&current, &self.cfg.phrase) {
                let phi_std = standardizer.transform(&v.features.phi());
                let (mean_new, _) = posterior.utility(&phi_std, 0);
                // Evict the worst member if the pool is full and the
                // newcomer beats it.
                if self.pool.len() >= self.cfg.pool_size {
                    if let Some((worst_idx, worst_mean)) =
                        self.ranked().last().map(|&(i, m, _)| (i, m))
                    {
                        if mean_new <= worst_mean {
                            continue;
                        }
                        self.pool.swap_remove(worst_idx);
                    }
                }
                self.pool.push(Candidate {
                    tree: current,
                    phi_std,
                    render: self.cfg.keep_renders.then_some(v.render),
                    features: v.features,
                    refined: true,
                });
            }
        }
    }

    /// Pool indices ranked by posterior-mean utility (descending); with no
    /// posterior, arbitrary order with zero scores.
    pub fn ranked(&self) -> Vec<(usize, f64, f64)> {
        let mut rows: Vec<(usize, f64, f64)> = self
            .pool
            .iter()
            .enumerate()
            .map(|(i, c)| match &self.posterior {
                Some(p) if !c.phi_std.is_empty() => {
                    let (m, s) = p.utility(&c.phi_std, 0);
                    (i, m, s)
                }
                _ => (i, 0.0, 0.0),
            })
            .collect();
        rows.sort_by(|a, b| b.1.total_cmp(&a.1));
        rows
    }

    /// Choose the next duel by dueling Thompson sampling. Returns pool
    /// indices `(a, b)`; `None` if the pool holds fewer than two candidates.
    pub fn next_duel<R: Rng>(&self, rng: &mut R) -> Option<(usize, usize)> {
        if self.pool.len() < 2 {
            return None;
        }
        match &self.posterior {
            None => {
                // No taste yet: uniform random pair.
                let a = rng.gen_range(0..self.pool.len());
                let mut b = rng.gen_range(0..self.pool.len() - 1);
                if b >= a {
                    b += 1;
                }
                Some((a, b))
            }
            Some(posterior) => {
                // Two independent posterior draws; duel their champions.
                let champion = |s: &evosynth_taste::TasteSample| -> usize {
                    self.pool
                        .iter()
                        .enumerate()
                        .max_by(|(_, x), (_, y)| {
                            s.utility(&x.phi_std, 0)
                                .total_cmp(&s.utility(&y.phi_std, 0))
                        })
                        .map(|(i, _)| i)
                        .unwrap_or(0)
                };
                let n = posterior.samples.len();
                let s1 = &posterior.samples[rng.gen_range(0..n)];
                let s2 = &posterior.samples[rng.gen_range(0..n)];
                let a = champion(s1);
                let mut b = champion(s2);
                if a == b {
                    // Same champion: duel it against the runner-up under s2.
                    b = self
                        .pool
                        .iter()
                        .enumerate()
                        .filter(|(i, _)| *i != a)
                        .max_by(|(_, x), (_, y)| {
                            s2.utility(&x.phi_std, 0)
                                .total_cmp(&s2.utility(&y.phi_std, 0))
                        })
                        .map(|(i, _)| i)
                        .unwrap_or((a + 1) % self.pool.len());
                }
                Some((a, b))
            }
        }
    }

    /// Record a duel outcome between two pool members.
    pub fn record_duel(&mut self, a: usize, b: usize, chose_a: bool) {
        self.log.push(Observation::Duel {
            a: self.pool[a].phi_std.clone(),
            b: self.pool[b].phi_std.clone(),
            chose_a,
            session: self.session,
        });
    }

    /// Record a keep/kill decision on a pool member.
    pub fn record_keep(&mut self, idx: usize, kept: bool) {
        self.log.push(Observation::KeepKill {
            x: self.pool[idx].phi_std.clone(),
            kept,
            session: self.session,
        });
    }

    /// Record a star rating on a pool member.
    pub fn record_stars(&mut self, idx: usize, rating: u8) {
        self.log.push(Observation::Stars {
            x: self.pool[idx].phi_std.clone(),
            rating,
            session: self.session,
        });
    }
}
