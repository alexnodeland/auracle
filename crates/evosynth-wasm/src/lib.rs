//! # evosynth-wasm
//!
//! Thin `wasm-bindgen` bindings over [`evosynth_session::Engine`] for the web
//! app. Designed to run inside a **Web Worker**: all methods here can take
//! seconds (rendering, MCMC); the main thread only plays transferred audio
//! buffers and draws instrumentation.
//!
//! Everything crossing the boundary is either JSON (structures) or a
//! `Float32Array` (audio). Candidates are addressed by **stable id** — pool
//! positions shift on eviction, ids never do. The engine is deterministic
//! given the seed.
//!
//! The **workbench** is the interactive-panel surface: `edit_begin(id)`
//! clones a candidate's tree; `edit_param` writes one knob (a trace-address
//! edit) and re-renders; `edit_commit` inserts the result as a new candidate
//! (optionally logging an "edited beats original" duel);
//! `refine_from(id, locks)` evolves everything *except* the locked
//! addresses.

mod live;
pub use live::LivePoly;

use evosynth_features::{featurize, Features, PhraseSpec, RenderedPhrase};
use evosynth_grammar::{describe, set_param, ParamValue, PatchGrammarPrior, PatchTree};
use evosynth_session::{Engine, Origin, Profile, SessionConfig};
use rand::rngs::StdRng;
use rand::SeedableRng;
use serde::Serialize;
use wasm_bindgen::prelude::*;

/// One row of the ranked-pool summary.
#[derive(Serialize)]
struct RankedRow {
    id: u64,
    mean: f64,
    std: f64,
    origin: &'static str,
    sexpr: String,
}

/// One θ coordinate of one style.
#[derive(Serialize)]
struct ThetaRow {
    name: String,
    mean: f64,
    std: f64,
}

/// One style lens of the taste posterior.
#[derive(Serialize)]
struct StyleRow {
    /// Fraction of the pool this lens claims (its island's share).
    share: f64,
    /// Feature weights of this lens.
    theta: Vec<ThetaRow>,
    /// Pool ids this lens scores highest (its exemplar patches).
    exemplars: Vec<u64>,
}

/// Engine status snapshot for the UI.
#[derive(Serialize)]
struct Status {
    pool: usize,
    pool_target: usize,
    observations: usize,
    session: usize,
    has_posterior: bool,
    generation: usize,
    k_styles: usize,
}

fn origin_str(o: Origin) -> &'static str {
    match o {
        Origin::Prior => "prior",
        Origin::Refined => "refined",
        Origin::Edited => "edited",
    }
}

fn to_f32(r: &RenderedPhrase) -> Vec<f32> {
    r.samples.iter().map(|s| *s as f32).collect()
}

/// The session engine, wasm-side.
#[wasm_bindgen]
pub struct WasmEngine {
    engine: Engine,
    rng: StdRng,
    bench_tree: Option<PatchTree>,
    bench_render: Option<RenderedPhrase>,
    bench_original: Option<u64>,
    bench_vet_ok: bool,
}

#[wasm_bindgen]
impl WasmEngine {
    /// Create an engine with the default grammar and session config.
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u64, pool_size: usize) -> WasmEngine {
        console_error_panic_hook::set_once();
        let cfg = SessionConfig {
            pool_size,
            keep_renders: true,
            // Browser budget: slightly lighter chains than native default.
            mcmc_samples: 20_000,
            mcmc_warmup: 6_000,
            ..Default::default()
        };
        let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
        engine.begin_session();
        WasmEngine {
            engine,
            rng: StdRng::seed_from_u64(seed),
            bench_tree: None,
            bench_render: None,
            bench_original: None,
            bench_vet_ok: false,
        }
    }

    /// Add up to `max_new` vetted candidates. Returns how many were added,
    /// so the worker can post fill progress between calls.
    pub fn fill_step(&mut self, max_new: usize) -> usize {
        self.engine.fill_pool_step(&mut self.rng, max_new)
    }

    /// Engine status as JSON.
    pub fn status(&self) -> String {
        serde_json::to_string(&Status {
            pool: self.engine.pool.len(),
            pool_target: self.engine.cfg.pool_size,
            observations: self.engine.log.len(),
            session: self.engine.session,
            has_posterior: self.engine.posterior.is_some(),
            generation: self.engine.generation,
            k_styles: self.engine.cfg.k_styles,
        })
        .unwrap()
    }

    /// Choose the next duel: JSON `[idA, idB]`, or `null` if the pool is
    /// small.
    pub fn next_duel(&mut self) -> String {
        let pair = self
            .engine
            .next_duel(&mut self.rng)
            .map(|(a, b)| [self.engine.pool[a].id, self.engine.pool[b].id]);
        serde_json::to_string(&pair).unwrap()
    }

    /// The audition buffer of candidate `id` (mono, ±1.0), for WebAudio.
    pub fn render_of(&self, id: u32) -> Vec<f32> {
        let id = id as u64;
        self.engine
            .find(id)
            .and_then(|i| self.engine.pool[i].render.as_ref())
            .map(to_f32)
            .unwrap_or_default()
    }

    /// The render sample rate.
    pub fn sample_rate(&self) -> f64 {
        self.engine.cfg.phrase.sample_rate
    }

    /// Patch term of candidate `id`, as an s-expression.
    pub fn sexpr_of(&self, id: u32) -> String {
        let id = id as u64;
        self.engine
            .find(id)
            .map(|i| self.engine.pool[i].tree.to_sexpr())
            .unwrap_or_default()
    }

    /// The patch tree of candidate `id` as JSON — the payload the live
    /// instrument (`LivePoly` in the AudioWorklet) compiles and plays.
    pub fn tree_json_of(&self, id: u32) -> String {
        let id = id as u64;
        match self.engine.find(id) {
            Some(i) => serde_json::to_string(&self.engine.pool[i].tree).unwrap(),
            None => "null".into(),
        }
    }

    /// The workbench tree as JSON (`null` if the bench is empty), for live
    /// playing of in-progress edits.
    pub fn edit_tree_json(&self) -> String {
        match &self.bench_tree {
            Some(t) => serde_json::to_string(t).unwrap(),
            None => "null".into(),
        }
    }

    /// Rack description (modules, knobs with live trace addresses, wires) of
    /// candidate `id`, as JSON. `null` for an unknown id.
    pub fn describe_of(&self, id: u32) -> String {
        let id = id as u64;
        match self.engine.find(id) {
            Some(i) => serde_json::to_string(&describe(&self.engine.pool[i].tree)).unwrap(),
            None => "null".into(),
        }
    }

    /// Record a duel outcome between candidate ids.
    pub fn record_duel(&mut self, a: u32, b: u32, chose_a: bool) {
        let (a, b) = (a as u64, b as u64);
        if let (Some(i), Some(j)) = (self.engine.find(a), self.engine.find(b)) {
            self.engine.record_duel(i, j, chose_a);
        }
    }

    /// Record a keep/kill decision on a candidate id.
    pub fn record_keep(&mut self, id: u32, kept: bool) {
        let id = id as u64;
        if let Some(i) = self.engine.find(id) {
            self.engine.record_keep(i, kept);
        }
    }

    /// Record a star rating on a candidate id.
    pub fn record_stars(&mut self, id: u32, rating: u8) {
        let id = id as u64;
        if let Some(i) = self.engine.find(id) {
            self.engine.record_stars(i, rating);
        }
    }

    /// Re-fit the taste posterior from the log (seconds of MCMC — worker!).
    pub fn fit(&mut self) {
        self.engine.fit_posterior(&mut self.rng);
    }

    /// One round of taste-guided refinement (renders — worker!).
    pub fn refine(&mut self) {
        self.engine.refine(&mut self.rng);
    }

    /// Locked refinement from candidate `id`: evolve everything except the
    /// locked addresses (`locked_json` = JSON array of `key#site` strings).
    /// Returns the new child id, or 0 if no move was accepted.
    pub fn refine_from(&mut self, id: u32, locked_json: &str) -> u32 {
        let id = id as u64;
        let locked: Vec<String> = serde_json::from_str(locked_json).unwrap_or_default();
        self.engine
            .refine_from(&mut self.rng, id, &locked)
            .unwrap_or(0) as u32
    }

    /// Ranked pool as JSON (`[{id, mean, std, origin, sexpr}]`).
    pub fn ranked(&self) -> String {
        let rows: Vec<RankedRow> = self
            .engine
            .ranked()
            .into_iter()
            .map(|(idx, mean, std)| RankedRow {
                id: self.engine.pool[idx].id,
                mean,
                std,
                origin: origin_str(self.engine.pool[idx].origin),
                sexpr: self.engine.pool[idx].tree.to_sexpr(),
            })
            .collect();
        serde_json::to_string(&rows).unwrap()
    }

    /// The 2D taste map (pool + history ghosts) as JSON, or `null` when
    /// there is too little to project.
    pub fn taste_map(&self) -> String {
        let map = self.engine.taste_map();
        if map.points.is_empty() {
            "null".into()
        } else {
            serde_json::to_string(&map).unwrap()
        }
    }

    /// Style lenses of the aligned posterior as JSON
    /// (`[{share, theta: [{name, mean, std}], exemplars: [ids]}]`), or
    /// `null` before the first fit. Inactive lenses have share ≈ 0.
    pub fn styles(&self) -> String {
        let Some(p) = &self.engine.posterior else {
            return "null".into();
        };
        let names = Features::phi_names();
        let pool_phis: Vec<Vec<f64>> = self
            .engine
            .pool
            .iter()
            .filter(|c| !c.phi_std.is_empty())
            .map(|c| c.phi_std.clone())
            .collect();
        let shares = p.style_share(&pool_phis);
        let rows: Vec<StyleRow> = (0..p.k_styles())
            .map(|k| {
                let means = p.theta_mean(k);
                let stds = p.theta_std(k);
                let theta = names
                    .iter()
                    .zip(means)
                    .zip(stds)
                    .map(|((name, mean), std)| ThetaRow {
                        name: name.to_string(),
                        mean,
                        std,
                    })
                    .collect();
                let mut scored: Vec<(u64, f64)> = self
                    .engine
                    .pool
                    .iter()
                    .filter(|c| !c.phi_std.is_empty())
                    .map(|c| (c.id, p.utility(&c.phi_std, k).0))
                    .collect();
                scored.sort_by(|a, b| b.1.total_cmp(&a.1));
                StyleRow {
                    share: shares.get(k).copied().unwrap_or(0.0),
                    theta,
                    exemplars: scored.iter().take(3).map(|&(id, _)| id).collect(),
                }
            })
            .collect();
        serde_json::to_string(&rows).unwrap()
    }

    /// The lineage log (evolution/edit events, oldest first) as JSON.
    pub fn lineage(&self) -> String {
        serde_json::to_string(&self.engine.lineage).unwrap()
    }

    // ------------------------------------------------------------------
    // Workbench (the interactive panel)
    // ------------------------------------------------------------------

    /// Load candidate `id` onto the workbench. Returns false for unknown id.
    pub fn edit_begin(&mut self, id: u32) -> bool {
        let id = id as u64;
        match self.engine.find(id) {
            Some(i) => {
                self.bench_tree = Some(self.engine.pool[i].tree.clone());
                self.bench_render = self.engine.pool[i].render.clone();
                self.bench_original = Some(id);
                self.bench_vet_ok = true;
                true
            }
            None => false,
        }
    }

    /// Write one knob on the workbench tree (`value` is the normalized
    /// continuous value, or the index when `is_index`), then re-render and
    /// re-vet. Returns false if the edit was rejected (structural site,
    /// unknown address, no workbench).
    pub fn edit_param(&mut self, addr: &str, value: f64, is_index: bool) -> bool {
        let Some(tree) = &self.bench_tree else {
            return false;
        };
        let v = if is_index {
            ParamValue::Index(value.max(0.0) as usize)
        } else {
            ParamValue::Continuous(value)
        };
        match set_param(tree, addr, v) {
            Ok(edited) => {
                match featurize(&edited, &self.phrase()) {
                    Ok(vetted) => {
                        self.bench_render = Some(vetted.render);
                        self.bench_vet_ok = true;
                    }
                    Err(_) => {
                        // Keep the edit (the user asked for it) but flag it:
                        // the buffer is withheld, never played unvetted.
                        self.bench_render = None;
                        self.bench_vet_ok = false;
                    }
                }
                self.bench_tree = Some(edited);
                true
            }
            Err(_) => false,
        }
    }

    /// The workbench audition buffer (empty when the current edit failed
    /// vetting — DESIGN.md §2.1: never play an unvetted patch).
    pub fn edit_render(&self) -> Vec<f32> {
        self.bench_render.as_ref().map(to_f32).unwrap_or_default()
    }

    /// Whether the current workbench state passed vetting.
    pub fn edit_vet_ok(&self) -> bool {
        self.bench_vet_ok
    }

    /// Rack description of the workbench tree as JSON (`null` if empty).
    pub fn edit_describe(&self) -> String {
        match &self.bench_tree {
            Some(t) => serde_json::to_string(&describe(t)).unwrap(),
            None => "null".into(),
        }
    }

    /// Commit the workbench tree as a new candidate. When `as_improvement`,
    /// also records "edited beats original" as a duel observation. Returns
    /// the new candidate id, or 0 (duplicate / unvetted / empty bench).
    pub fn edit_commit(&mut self, as_improvement: bool) -> u32 {
        let (Some(tree), true) = (self.bench_tree.clone(), self.bench_vet_ok) else {
            return 0;
        };
        self.engine
            .commit_edit(self.bench_original, tree, as_improvement)
            .unwrap_or(0) as u32
    }

    /// Clear the workbench.
    pub fn edit_cancel(&mut self) {
        self.bench_tree = None;
        self.bench_render = None;
        self.bench_original = None;
        self.bench_vet_ok = false;
    }

    fn phrase(&self) -> PhraseSpec {
        self.engine.cfg.phrase.clone()
    }

    // ------------------------------------------------------------------
    // Persistence
    // ------------------------------------------------------------------

    /// Export the portable profile (observation log + its standardizer — θ
    /// is only meaningful relative to the standardizer, so they travel
    /// together) as JSON.
    pub fn export_profile(&self) -> String {
        serde_json::to_string(&self.engine.export_profile()).unwrap()
    }

    /// Import a profile, replacing the log, adopting its standardizer, and
    /// starting a new session on top. Returns false on parse failure.
    pub fn import_profile(&mut self, json: &str) -> bool {
        match serde_json::from_str::<Profile>(json) {
            Ok(profile) => {
                self.engine.import_profile(profile);
                self.engine.begin_session();
                true
            }
            Err(_) => false,
        }
    }
}
