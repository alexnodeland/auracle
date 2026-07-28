//! # evosynth-wasm
//!
//! Thin `wasm-bindgen` bindings over [`evosynth_session::Engine`] for the web
//! app. Designed to run inside a **Web Worker**: all methods here can take
//! seconds (rendering, MCMC); the main thread only plays transferred audio
//! buffers and draws instrumentation.
//!
//! Everything crossing the boundary is either JSON (structures) or a
//! `Float32Array` (audio). The engine is deterministic given the seed.

use evosynth_features::Features;
use evosynth_grammar::PatchGrammarPrior;
use evosynth_session::{Engine, SessionConfig};
use evosynth_taste::ObservationLog;
use rand::rngs::StdRng;
use rand::SeedableRng;
use serde::Serialize;
use wasm_bindgen::prelude::*;

/// One row of the ranked-pool summary.
#[derive(Serialize)]
struct RankedRow {
    idx: usize,
    mean: f64,
    std: f64,
    refined: bool,
    sexpr: String,
}

/// One row of the taste-posterior summary.
#[derive(Serialize)]
struct ThetaRow {
    name: String,
    mean: f64,
    std: f64,
}

/// Engine status snapshot for the UI.
#[derive(Serialize)]
struct Status {
    pool: usize,
    pool_target: usize,
    observations: usize,
    session: usize,
    has_posterior: bool,
}

/// The session engine, wasm-side.
#[wasm_bindgen]
pub struct WasmEngine {
    engine: Engine,
    rng: StdRng,
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
        })
        .unwrap()
    }

    /// Choose the next duel: JSON `[a, b]`, or `null` if the pool is small.
    pub fn next_duel(&mut self) -> String {
        serde_json::to_string(&self.engine.next_duel(&mut self.rng)).unwrap()
    }

    /// The audition buffer of pool member `idx` (mono, ±1.0), for WebAudio.
    pub fn render_of(&self, idx: usize) -> Vec<f32> {
        self.engine.pool[idx]
            .render
            .as_ref()
            .map(|r| r.samples.iter().map(|s| *s as f32).collect())
            .unwrap_or_default()
    }

    /// The render sample rate.
    pub fn sample_rate(&self) -> f64 {
        self.engine.cfg.phrase.sample_rate
    }

    /// Patch term of pool member `idx`, as an s-expression.
    pub fn sexpr_of(&self, idx: usize) -> String {
        self.engine.pool[idx].tree.to_sexpr()
    }

    /// Record a duel outcome.
    pub fn record_duel(&mut self, a: usize, b: usize, chose_a: bool) {
        self.engine.record_duel(a, b, chose_a);
    }

    /// Record a keep/kill decision.
    pub fn record_keep(&mut self, idx: usize, kept: bool) {
        self.engine.record_keep(idx, kept);
    }

    /// Record a star rating.
    pub fn record_stars(&mut self, idx: usize, rating: u8) {
        self.engine.record_stars(idx, rating);
    }

    /// Re-fit the taste posterior from the log (seconds of MCMC — worker!).
    pub fn fit(&mut self) {
        self.engine.fit_posterior(&mut self.rng);
    }

    /// One round of taste-guided refinement (renders — worker!).
    pub fn refine(&mut self) {
        self.engine.refine(&mut self.rng);
    }

    /// Ranked pool as JSON (`[{idx, mean, std, refined, sexpr}]`).
    pub fn ranked(&self) -> String {
        let rows: Vec<RankedRow> = self
            .engine
            .ranked()
            .into_iter()
            .map(|(idx, mean, std)| RankedRow {
                idx,
                mean,
                std,
                refined: self.engine.pool[idx].refined,
                sexpr: self.engine.pool[idx].tree.to_sexpr(),
            })
            .collect();
        serde_json::to_string(&rows).unwrap()
    }

    /// Taste-posterior summary as JSON (`[{name, mean, std}]` per feature),
    /// or `null` before the first fit.
    pub fn taste(&self) -> String {
        match &self.engine.posterior {
            None => "null".into(),
            Some(p) => {
                let means = p.theta_mean(0);
                let stds = p.theta_std(0);
                let rows: Vec<ThetaRow> = Features::phi_names()
                    .into_iter()
                    .zip(means)
                    .zip(stds)
                    .map(|((name, mean), std)| ThetaRow {
                        name: name.to_string(),
                        mean,
                        std,
                    })
                    .collect();
                serde_json::to_string(&rows).unwrap()
            }
        }
    }

    /// Export the observation log (the profile's source of truth) as JSON.
    pub fn export_log(&self) -> String {
        serde_json::to_string(&self.engine.log).unwrap()
    }

    /// Import an observation log, replacing the current one, and start a new
    /// session on top of it. Returns false on parse failure.
    pub fn import_log(&mut self, json: &str) -> bool {
        match serde_json::from_str::<ObservationLog>(json) {
            Ok(log) => {
                self.engine.log = log;
                self.engine.begin_session();
                true
            }
            Err(_) => false,
        }
    }
}
