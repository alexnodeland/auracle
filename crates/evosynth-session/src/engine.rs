//! The two-loop session engine (DESIGN.md §1.5).
//!
//! - **Patch loop** (machine-paced, silent): fill a pool with vetted prior
//!   draws; once a posterior exists, *refine* — warm-start fugue-evo's typed
//!   MH from the best pool members on the Boltzmann target
//!   `π_β ∝ p_grammar · exp(β·E[u(x)])` and inject improved candidates.
//! - **Taste loop** (human-paced, persistent): feedback events append to the
//!   [`ObservationLog`]; the posterior is re-fit from the log.
//!
//! Between them, **acquisition**: duels are chosen by dueling Thompson
//! sampling — draw two posterior samples, duel each sample's champion.
//! Early on the posterior is diffuse, so champions disagree and duels are
//! informative; as it concentrates, duels converge on the frontier of taste.
//! With no posterior yet, duels are uniform random.
//!
//! **Locks** (partial evolution): any set of trace addresses can be frozen
//! during refinement. The MH kernel still proposes over all sites; a proposal
//! that touches a locked address is rejected outside the kernel. Because the
//! underlying kernel satisfies detailed balance on the full space, rejecting
//! locked-coordinate moves yields a valid Metropolis-within-Gibbs sampler on
//! the *conditional* posterior given the locked values — locking is exact,
//! not a heuristic. Wasted proposals are compensated by scaling step counts.
//!
//! All UI modes are emitters into the same observation stream: the engine
//! does not know which surface produced an event. Candidates carry stable
//! `id`s — pool positions shift on eviction, ids never do.

use std::collections::HashSet;
use std::sync::Arc;

use evosynth_features::{featurize, Features, PhraseSpec, RenderedPhrase};
use evosynth_grammar::{tree_diff, DiffEntry, PatchGrammarPrior, PatchTree};
use evosynth_taste::{
    Observation, ObservationLog, Standardizer, TasteConfig, TasteModel, TastePosterior,
};
use fugue::Trace;
use fugue_evo::inference::mh::EvolutionChain;
use fugue_evo::inference::model::EvolutionModel;
use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::surrogate::SurrogateFitness;

/// Engine configuration.
#[derive(Clone, Debug)]
pub struct SessionConfig {
    /// Vetted candidates to maintain in the pool.
    pub pool_size: usize,
    /// Maximum prior draws attempted per `fill_pool` (vet failures burn
    /// attempts).
    pub max_draws: usize,
    /// MH refinement steps per seed (scaled up when locks waste proposals).
    pub refine_steps: usize,
    /// How many top candidates to refine from.
    pub refine_seeds: usize,
    /// Boltzmann sharpness β of the refinement target.
    pub beta: f64,
    /// Maximum style components in the taste mixture
    /// (max-of-linear-experts); the fitted K grows with evidence up to this
    /// cap.
    pub k_styles: usize,
    /// The audition stimulus.
    pub phrase: PhraseSpec,
    /// Keep audition buffers in the pool (frontends want them; headless
    /// tests don't need the memory).
    pub keep_renders: bool,
    /// MCMC samples / warmup for posterior fits.
    pub mcmc_samples: usize,
    /// MCMC warmup steps.
    pub mcmc_warmup: usize,
    /// Recency half-life for the taste likelihood, in observations
    /// (`None` = no forgetting). Tastes drift; old votes should fade.
    pub recency_half_life: Option<f64>,
    /// Strength of the taste→grammar proposal tilt (0 disables): structural
    /// θ components multiply the grammar's kind weights by
    /// `exp(η·θ)` during refinement.
    pub proposal_tilt: f64,
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            pool_size: 48,
            max_draws: 400,
            refine_steps: 12,
            refine_seeds: 3,
            beta: 2.0,
            k_styles: 5,
            phrase: PhraseSpec::default(),
            keep_renders: false,
            mcmc_samples: 30_000,
            mcmc_warmup: 10_000,
            recency_half_life: Some(150.0),
            proposal_tilt: 0.6,
        }
    }
}

/// Where a candidate came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Origin {
    /// Drawn from the grammar prior.
    Prior,
    /// Produced by taste-guided MH refinement.
    Refined,
    /// Hand-edited on the panel and committed.
    Edited,
    /// Loaded from the built-in preset bank.
    Preset,
}

/// A vetted pool member.
pub struct Candidate {
    /// Stable id (unique for the lifetime of the engine; survives pool
    /// reordering and eviction of *other* members).
    pub id: u64,
    /// The term.
    pub tree: PatchTree,
    /// Its extracted features.
    pub features: Features,
    /// Standardized feature vector (empty until the standardizer exists).
    pub phi_std: Vec<f64>,
    /// The audition buffer (kept only when `keep_renders`).
    pub render: Option<RenderedPhrase>,
    /// Provenance.
    pub origin: Origin,
    /// User-given name (frontends fall back to `tree.signature()`).
    pub name: Option<String>,
}

/// One recorded evolution/edit step, for the lineage display.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LineageEvent {
    /// Generation counter at the time of the event (increments per
    /// `refine`/`refine_from` call).
    pub generation: usize,
    /// `"refine"` or `"edit"`.
    pub kind: String,
    /// Parent candidate id.
    pub parent_id: u64,
    /// Child candidate id.
    pub child_id: u64,
    /// What changed, in trace-address terms.
    pub diff: Vec<DiffEntry>,
    /// Parent posterior-mean utility at event time (0 with no posterior).
    pub parent_utility: f64,
    /// Child posterior-mean utility at event time.
    pub child_utility: f64,
}

/// A portable taste profile: the observation log **plus the standardizer its
/// φ vectors were standardized under**. θ is only meaningful relative to its
/// standardizer, so the two persist together.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Profile {
    /// The observation log (source of truth).
    pub log: ObservationLog,
    /// The standardizer under which every φ in the log was recorded.
    pub standardizer: Option<Standardizer>,
}

/// Tilt categorical proposal weights by taste: `w'_i ∝ w_i · exp(η·t_i)`,
/// with each multiplier clamped to `[1/4, 4]` so no kind is ever starved or
/// monopolized, and the result renormalized. Pure, so the taste→grammar
/// mapping is testable without an MCMC fit.
pub fn tilt_weights(base: &[f64], tilts: &[f64], eta: f64) -> Vec<f64> {
    let mut out: Vec<f64> = base
        .iter()
        .zip(tilts)
        .map(|(w, t)| w * (eta * t).exp().clamp(0.25, 4.0))
        .collect();
    let sum: f64 = out.iter().sum();
    if sum > 0.0 {
        for w in &mut out {
            *w /= sum;
        }
    }
    out
}

/// One bank entry of a saved session (renders and features are re-derived
/// on import — trees are the source of truth).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BankEntry {
    /// The candidate's stable id (preserved so lineage references stay
    /// meaningful).
    pub id: u64,
    /// The patch term.
    pub tree: PatchTree,
    /// Provenance.
    pub origin: Origin,
    /// User-given name.
    pub name: Option<String>,
}

/// An implicit preference signal, logged but (for now) not modeled: promote
/// events, hand-edit commits, per-patch play counts. Un-logged signal is
/// gone forever; modeling can come later.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ImplicitEvent {
    /// `"promote"`, `"play"`, `"edit"`, …
    pub kind: String,
    /// Candidate id the event is about.
    pub id: u64,
    /// Magnitude (play counts, 1 for point events).
    pub value: f64,
    /// Session index when it happened.
    pub session: usize,
}

/// A full saved session: everything needed to restore the app across a
/// reload — the portable profile plus the bank and its history.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SessionState {
    /// Log + standardizer.
    pub profile: Profile,
    /// The patch bank (trees, origins, names).
    pub bank: Vec<BankEntry>,
    /// Evolution/edit history.
    pub lineage: Vec<LineageEvent>,
    /// Generation counter.
    pub generation: usize,
    /// User-given style names (index = aligned style index).
    #[serde(default)]
    pub style_names: Vec<String>,
    /// Implicit preference events.
    #[serde(default)]
    pub events: Vec<ImplicitEvent>,
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
    /// The current posterior, if fit (label-aligned).
    pub posterior: Option<Arc<TastePosterior>>,
    /// Current session index.
    pub session: usize,
    /// The candidate pool.
    pub pool: Vec<Candidate>,
    /// Evolution/edit history.
    pub lineage: Vec<LineageEvent>,
    /// Generation counter (one per refinement call).
    pub generation: usize,
    /// User-given style names (index = aligned style index; empty = unnamed).
    pub style_names: Vec<String>,
    /// Implicit preference events (logged, not yet modeled).
    pub events: Vec<ImplicitEvent>,
    next_id: u64,
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
            lineage: Vec::new(),
            generation: 0,
            style_names: Vec::new(),
            events: Vec::new(),
            next_id: 1,
        }
    }

    fn alloc_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    /// Pool index of a candidate id.
    pub fn find(&self, id: u64) -> Option<usize> {
        self.pool.iter().position(|c| c.id == id)
    }

    /// Start a new session (its own τ latent). Returns its index.
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
                let id = self.alloc_id();
                self.pool.push(Candidate {
                    id,
                    tree,
                    phi_std: Vec::new(),
                    render: self.cfg.keep_renders.then_some(v.render),
                    features: v.features,
                    origin: Origin::Prior,
                    name: None,
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

    /// Fit (or re-fit) the taste posterior from the observation log. The
    /// stored posterior is label-aligned (safe for per-style summaries).
    pub fn fit_posterior<R: Rng>(&mut self, rng: &mut R) {
        let d = match &self.standardizer {
            Some(sz) => sz.dimension(),
            None => return,
        };
        if self.log.is_empty() {
            return;
        }
        // Style capacity grows with evidence: one lens per ~20 observations,
        // capped by config. Idle lenses collapse to ~0 share on their own,
        // so K is an upper bound the data may or may not use.
        let k = (1 + self.log.len() / 20).min(self.cfg.k_styles).max(1);
        let mut taste_cfg = TasteConfig::mixture(d, k);
        taste_cfg.recency_half_life = self.cfg.recency_half_life;
        let model = TasteModel::new(taste_cfg);
        let posterior = model.fit(rng, &self.log, self.cfg.mcmc_samples, self.cfg.mcmc_warmup);
        self.posterior = Some(Arc::new(posterior.aligned()));
    }

    /// Posterior-mean mixture utility of a standardized φ (0 with no
    /// posterior).
    fn utility_of(&self, phi_std: &[f64]) -> f64 {
        match &self.posterior {
            Some(p) if !phi_std.is_empty() => p.utility_mix(phi_std).0,
            _ => 0.0,
        }
    }

    /// Did the step from `prev` to `next` touch any locked address?
    /// "Touch" = change its value or delete it (structure moves that would
    /// rewrite a locked module's path are rejected too — locked means *don't
    /// touch*).
    fn violates_locks(prev: &Trace, next: &Trace, locked: &HashSet<String>) -> bool {
        if locked.is_empty() {
            return false;
        }
        for (addr, c) in &prev.choices {
            if locked.contains(&**addr) {
                match next.choices.get(addr) {
                    Some(n) if n.value == c.value => {}
                    _ => return true,
                }
            }
        }
        false
    }

    /// Grammar prior with kind-weights tilted toward the fitted taste: each
    /// structural θ component (share-weighted across styles) multiplies its
    /// kind's proposal weight by `exp(η·θ)`. This is θ_struct → grammar
    /// feedback — refinement *proposes* toward the user instead of merely
    /// filtering, which is where visible directionality comes from.
    fn biased_prior(&self) -> PatchGrammarPrior {
        let mut prior = self.prior.clone();
        let eta = self.cfg.proposal_tilt;
        let Some(p) = &self.posterior else {
            return prior;
        };
        if eta <= 0.0 {
            return prior;
        }
        let names = Features::phi_names();
        let pool_phis: Vec<Vec<f64>> = self
            .pool
            .iter()
            .filter(|c| !c.phi_std.is_empty())
            .map(|c| c.phi_std.clone())
            .collect();
        let shares = p.style_share(&pool_phis);
        let mut theta = vec![0.0; names.len()];
        for k in 0..p.k_styles() {
            let m = p.theta_mean(k);
            let w = shares.get(k).copied().unwrap_or(0.0);
            for (t, mi) in theta.iter_mut().zip(m) {
                *t += w * mi;
            }
        }
        let g = |name: &str| {
            names
                .iter()
                .position(|n| *n == name)
                .map(|i| theta[i])
                .unwrap_or(0.0)
        };
        let src = tilt_weights(
            &prior.source_weights,
            &[g("n_vco"), g("n_supersaw"), g("n_noise")],
            eta,
        );
        prior.source_weights = [src[0], src[1], src[2]];
        let op = tilt_weights(
            &prior.op_weights,
            &[
                g("n_mix"),
                g("n_filter"),
                g("n_fold"),
                g("n_delay"),
                g("n_chorus"),
                g("n_reverb"),
            ],
            eta,
        );
        prior.op_weights = op.try_into().expect("op weight arity");
        // "no modulation" carries no tilt — only the filled kinds compete.
        let md = tilt_weights(
            &prior.mod_weights,
            &[0.0, g("n_lfo"), g("n_env"), g("n_rand")],
            eta,
        );
        prior.mod_weights = md.try_into().expect("mod weight arity");
        prior
    }

    /// Posterior probability that pool member `a` beats `b` in a duel
    /// (`None` before the first fit).
    pub fn predict_duel(&self, a: usize, b: usize) -> Option<f64> {
        let p = self.posterior.as_ref()?;
        let (pa, pb) = (&self.pool[a].phi_std, &self.pool[b].phi_std);
        if pa.is_empty() || pb.is_empty() {
            return None;
        }
        Some(p.prob_prefers(pa, pb))
    }

    /// Log an implicit preference event (promote, play time, …). Logged
    /// only — not yet part of the likelihood.
    pub fn log_event(&mut self, kind: &str, id: u64, value: f64) {
        self.events.push(ImplicitEvent {
            kind: kind.into(),
            id,
            value,
            session: self.session,
        });
    }

    /// Name (or rename; empty clears) an aligned style index.
    pub fn set_style_name(&mut self, k: usize, name: &str) {
        if k >= 16 {
            return;
        }
        if self.style_names.len() <= k {
            self.style_names.resize(k + 1, String::new());
        }
        self.style_names[k] = name.trim().chars().take(24).collect();
    }

    /// Run locked MH refinement from one seed. Returns the end state if it
    /// differs from the seed.
    fn refine_one<R: Rng>(
        &self,
        rng: &mut R,
        seed: &PatchTree,
        locked: &HashSet<String>,
        steps: usize,
    ) -> Option<PatchTree> {
        let (posterior, standardizer) = match (&self.posterior, &self.standardizer) {
            (Some(p), Some(s)) => (Arc::clone(p), Arc::clone(s)),
            _ => return None,
        };
        let fitness = SurrogateFitness {
            posterior,
            standardizer,
            phrase: self.cfg.phrase.clone(),
        };
        let model = EvolutionModel::new(self.biased_prior(), fitness).with_beta(self.cfg.beta);
        let mut chain = EvolutionChain::new(model);
        let mut trace = chain.init_from(seed)?;

        // Scale steps for proposals wasted on locked sites.
        let total_sites = trace.choices.len().max(1);
        let locked_present = trace
            .choices
            .keys()
            .filter(|a| locked.contains(&***a))
            .count();
        let free = total_sites.saturating_sub(locked_present).max(1);
        let factor = (total_sites as f64 / free as f64).min(4.0);
        let steps = ((steps as f64) * factor).ceil() as usize;

        let mut current = seed.clone();
        for _ in 0..steps {
            let (g, t) = chain.step(rng, &trace);
            if Self::violates_locks(&trace, &t, locked) {
                continue; // reject outside the kernel; stay at `trace`
            }
            current = g;
            trace = t;
        }
        (current != *seed).then_some(current)
    }

    /// Insert a candidate (evicting the worst if full, never `protect`).
    /// Returns the new id, or `None` if the newcomer ranks below the evictee.
    fn insert_candidate(
        &mut self,
        tree: PatchTree,
        origin: Origin,
        protect: Option<u64>,
    ) -> Option<u64> {
        let standardizer = self.standardizer.as_ref()?;
        let v = featurize(&tree, &self.cfg.phrase).ok()?;
        let phi_std = standardizer.transform(&v.features.phi());
        let mean_new = self.utility_of(&phi_std);
        if self.pool.len() >= self.cfg.pool_size {
            let worst = self
                .pool
                .iter()
                .enumerate()
                .filter(|(_, c)| Some(c.id) != protect)
                .min_by(|(_, x), (_, y)| {
                    self.utility_of(&x.phi_std)
                        .total_cmp(&self.utility_of(&y.phi_std))
                })
                .map(|(i, c)| (i, self.utility_of(&c.phi_std)));
            match worst {
                Some((worst_idx, worst_mean)) => {
                    // Hand edits always land (the user asked for them);
                    // refined candidates must earn their slot.
                    if origin == Origin::Refined && mean_new <= worst_mean {
                        return None;
                    }
                    self.pool.swap_remove(worst_idx);
                }
                None => return None,
            }
        }
        let id = self.alloc_id();
        self.pool.push(Candidate {
            id,
            tree,
            phi_std,
            render: self.cfg.keep_renders.then_some(v.render),
            features: v.features,
            origin,
            name: None,
        });
        Some(id)
    }

    /// Taste-guided refinement: run fugue-evo typed MH on the Boltzmann
    /// target from each of the top seeds, and add improved, vetted, novel
    /// candidates to the pool (evicting the worst if full). Each injection
    /// is recorded as a lineage event.
    pub fn refine<R: Rng>(&mut self, rng: &mut R) {
        if self.posterior.is_none() || self.standardizer.is_none() {
            return;
        }
        self.generation += 1;
        let seeds: Vec<(u64, PatchTree)> = self
            .ranked()
            .iter()
            .take(self.cfg.refine_seeds)
            .map(|&(i, _, _)| (self.pool[i].id, self.pool[i].tree.clone()))
            .collect();
        let no_locks = HashSet::new();
        for (parent_id, seed) in seeds {
            let Some(end) = self.refine_one(rng, &seed, &no_locks, self.cfg.refine_steps) else {
                continue;
            };
            if self.pool.iter().any(|c| c.tree == end) {
                continue;
            }
            self.record_child(parent_id, &seed, end, "refine", None);
        }
    }

    /// Locked refinement from one explicit seed candidate: evolve everything
    /// *except* the locked addresses. Returns the injected child id.
    pub fn refine_from<R: Rng>(
        &mut self,
        rng: &mut R,
        seed_id: u64,
        locked: &[String],
    ) -> Option<u64> {
        let seed = self.pool[self.find(seed_id)?].tree.clone();
        let locked: HashSet<String> = locked.iter().cloned().collect();
        self.generation += 1;
        let end = self.refine_one(rng, &seed, &locked, self.cfg.refine_steps)?;
        if self.pool.iter().any(|c| c.tree == end) {
            return None;
        }
        self.record_child(seed_id, &seed, end, "refine", Some(seed_id))
    }

    /// Commit a hand-edited tree as a new candidate. If `original_id` is
    /// given, a lineage event links them; if additionally `as_improvement`,
    /// an "edited beats original" duel observation is recorded.
    pub fn commit_edit(
        &mut self,
        original_id: Option<u64>,
        tree: PatchTree,
        as_improvement: bool,
    ) -> Option<u64> {
        if self.pool.iter().any(|c| c.tree == tree) {
            return None;
        }
        let original = original_id.and_then(|id| self.find(id)).map(|i| {
            (
                self.pool[i].id,
                self.pool[i].tree.clone(),
                self.pool[i].phi_std.clone(),
            )
        });
        let child_id = self.insert_candidate(tree, Origin::Edited, original_id)?;
        if let Some((pid, ptree, pphi)) = original {
            let ci = self.find(child_id).expect("just inserted");
            let (ctree, cphi) = (self.pool[ci].tree.clone(), self.pool[ci].phi_std.clone());
            self.lineage.push(LineageEvent {
                generation: self.generation,
                kind: "edit".into(),
                parent_id: pid,
                child_id,
                diff: tree_diff(&ptree, &ctree),
                parent_utility: self.utility_of(&pphi),
                child_utility: self.utility_of(&cphi),
            });
            if as_improvement && !pphi.is_empty() && !cphi.is_empty() {
                self.log.push(Observation::Duel {
                    a: cphi,
                    b: pphi,
                    chose_a: true,
                    session: self.session,
                });
            }
        }
        Some(child_id)
    }

    fn record_child(
        &mut self,
        parent_id: u64,
        seed: &PatchTree,
        end: PatchTree,
        kind: &str,
        protect: Option<u64>,
    ) -> Option<u64> {
        let parent_phi = self
            .find(parent_id)
            .map(|i| self.pool[i].phi_std.clone())
            .unwrap_or_default();
        let child_id = self.insert_candidate(end, Origin::Refined, protect)?;
        let ci = self.find(child_id).expect("just inserted");
        let (ctree, cphi) = (self.pool[ci].tree.clone(), self.pool[ci].phi_std.clone());
        self.lineage.push(LineageEvent {
            generation: self.generation,
            kind: kind.into(),
            parent_id,
            child_id,
            diff: tree_diff(seed, &ctree),
            parent_utility: self.utility_of(&parent_phi),
            child_utility: self.utility_of(&cphi),
        });
        Some(child_id)
    }

    /// Pool indices ranked by posterior-mean mixture utility (descending);
    /// with no posterior, arbitrary order with zero scores.
    pub fn ranked(&self) -> Vec<(usize, f64, f64)> {
        let mut rows: Vec<(usize, f64, f64)> = self
            .pool
            .iter()
            .enumerate()
            .map(|(i, c)| match &self.posterior {
                Some(p) if !c.phi_std.is_empty() => {
                    let (m, s) = p.utility_mix(&c.phi_std);
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
                            s.utility_mix(&x.phi_std)
                                .total_cmp(&s.utility_mix(&y.phi_std))
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
                            s2.utility_mix(&x.phi_std)
                                .total_cmp(&s2.utility_mix(&y.phi_std))
                        })
                        .map(|(i, _)| i)
                        .unwrap_or((a + 1) % self.pool.len());
                }
                Some((a, b))
            }
        }
    }

    /// Record a duel outcome between two pool members (by pool index).
    pub fn record_duel(&mut self, a: usize, b: usize, chose_a: bool) {
        self.log.push(Observation::Duel {
            a: self.pool[a].phi_std.clone(),
            b: self.pool[b].phi_std.clone(),
            chose_a,
            session: self.session,
        });
    }

    /// Record a keep/kill decision on a pool member (by pool index).
    pub fn record_keep(&mut self, idx: usize, kept: bool) {
        self.log.push(Observation::KeepKill {
            x: self.pool[idx].phi_std.clone(),
            kept,
            session: self.session,
        });
    }

    /// Record a star rating on a pool member (by pool index).
    pub fn record_stars(&mut self, idx: usize, rating: u8) {
        self.log.push(Observation::Stars {
            x: self.pool[idx].phi_std.clone(),
            rating,
            session: self.session,
        });
    }

    /// Name (or rename; empty clears) a candidate.
    pub fn set_name(&mut self, id: u64, name: &str) {
        if let Some(i) = self.find(id) {
            let trimmed = name.trim();
            self.pool[i].name = (!trimmed.is_empty()).then(|| trimmed.chars().take(40).collect());
        }
    }

    /// Insert a named preset into the pool (protected from immediate
    /// eviction pressure only by its utility, like any candidate). Returns
    /// the new id.
    pub fn insert_preset(&mut self, tree: PatchTree, name: &str) -> Option<u64> {
        if let Some(existing) = self.pool.iter().find(|c| c.tree == tree) {
            return Some(existing.id);
        }
        let id = self.insert_candidate(tree, Origin::Preset, None)?;
        self.set_name(id, name);
        Some(id)
    }

    /// Export the portable profile (log + standardizer, which only mean
    /// anything together).
    pub fn export_profile(&self) -> Profile {
        Profile {
            log: self.log.clone(),
            standardizer: self.standardizer.as_deref().cloned(),
        }
    }

    /// Export the full session (profile + bank + lineage) for persistence.
    /// Renders and features are intentionally omitted — trees re-featurize
    /// deterministically on import.
    pub fn export_state(&self) -> SessionState {
        SessionState {
            profile: self.export_profile(),
            bank: self
                .pool
                .iter()
                .map(|c| BankEntry {
                    id: c.id,
                    tree: c.tree.clone(),
                    origin: c.origin,
                    name: c.name.clone(),
                })
                .collect(),
            lineage: self.lineage.clone(),
            generation: self.generation,
            style_names: self.style_names.clone(),
            events: self.events.clone(),
        }
    }

    /// Restore a saved session, replacing pool, log, standardizer, lineage,
    /// and id allocation. Each bank tree is re-featurized (and re-rendered
    /// when `keep_renders`); entries that no longer vet are dropped. Returns
    /// how many bank entries were restored.
    pub fn import_state(&mut self, state: SessionState) -> usize {
        self.import_profile(state.profile);
        self.lineage = state.lineage;
        self.generation = state.generation;
        self.style_names = state.style_names;
        self.events = state.events;
        self.pool.clear();
        let mut max_id = 0;
        for entry in state.bank {
            let Ok(v) = featurize(&entry.tree, &self.cfg.phrase) else {
                continue;
            };
            let phi_std = self
                .standardizer
                .as_ref()
                .map(|sz| sz.transform(&v.features.phi()))
                .unwrap_or_default();
            max_id = max_id.max(entry.id);
            self.pool.push(Candidate {
                id: entry.id,
                tree: entry.tree,
                features: v.features,
                phi_std,
                render: self.cfg.keep_renders.then_some(v.render),
                origin: entry.origin,
                name: entry.name,
            });
        }
        // The standardizer normally comes from the profile; a session saved
        // before the first fit completes has none — fit one from the
        // restored bank so φ isn't left raw.
        if self.standardizer.is_none() && !self.pool.is_empty() {
            let rows: Vec<Vec<f64>> = self.pool.iter().map(|c| c.features.phi()).collect();
            let sz = Arc::new(Standardizer::fit(&rows));
            for c in &mut self.pool {
                c.phi_std = sz.transform(&c.features.phi());
            }
            self.standardizer = Some(sz);
        }
        self.next_id = self.next_id.max(max_id + 1);
        self.pool.len()
    }

    /// Import a profile: replaces the log, **and adopts its standardizer**
    /// (re-standardizing the current pool under it) so imported θ geometry
    /// stays valid. A profile without a standardizer just replaces the log.
    pub fn import_profile(&mut self, profile: Profile) {
        self.log = profile.log;
        if let Some(sz) = profile.standardizer {
            let sz = Arc::new(sz);
            for c in &mut self.pool {
                c.phi_std = sz.transform(&c.features.phi());
            }
            self.standardizer = Some(sz);
        }
        self.session = self.log.n_sessions();
        self.posterior = None;
    }
}
