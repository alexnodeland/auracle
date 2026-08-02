//! # ricercar-wasm
//!
//! Thin `wasm-bindgen` bindings over [`ricercar_session::Engine`] for the web
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

use std::sync::Arc;

use rand::rngs::StdRng;
use rand::SeedableRng;
use ricercar_features::{featurize_memo, Audition, CachedFeatures, Features, PhraseSpec};
use ricercar_grammar::{
    apply_struct_op, describe, presets, set_param, validate_tree, ParamValue, PatchGrammarPrior,
    PatchTree, StructOp,
};
use ricercar_session::{
    BankEntry, Engine, Origin, PreFeaturized, Profile, RenderPolicy, SessionConfig, SessionState,
};
use serde::Serialize;
use wasm_bindgen::prelude::*;

/// One row of the ranked-pool summary.
///
/// `name` is the display name — the user's if they gave one, otherwise a
/// **musical** name read off the measured features (`Bright Pluck`,
/// `Fat Sub`), disambiguated across the pool. `signature` is the topology
/// (`ssaw·lp·ladr`), kept as separate metadata: it describes the circuit, not
/// the sound, and it collides constantly, so it belongs under the name rather
/// than in place of it.
#[derive(Serialize)]
struct RankedRow {
    id: u64,
    mean: f64,
    std: f64,
    origin: &'static str,
    name: String,
    named: bool,
    signature: String,
    sexpr: String,
    pinned: bool,
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
    /// User-given name ("" = unnamed).
    name: String,
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
    /// Effective sample size of the posterior draws after the importance
    /// updates folded in since the last full fit (0 before the first fit).
    ess: f64,
    /// True when those weights have degenerated enough that a full MCMC
    /// refit is worth its seconds — a better refit trigger than a fixed
    /// vote count.
    needs_refit: bool,
}

fn origin_str(o: Origin) -> &'static str {
    match o {
        Origin::Prior => "prior",
        Origin::Refined => "refined",
        Origin::Edited => "edited",
        Origin::Preset => "preset",
    }
}

/// The buffer form WebAudio wants. Cloned rather than moved because the
/// engine and the workbench both keep the authoritative copy — every consumer
/// of an audition on this boundary hands it straight to a `Float32Array`.
fn pcm(a: &Audition) -> Vec<f32> {
    a.samples.clone()
}

// ----------------------------------------------------------------------
// The render farm's stateless surface
// ----------------------------------------------------------------------

/// One farm result: a render + vet + featurize that happened with **no
/// [`Engine`] anywhere in sight**.
///
/// This is the whole farm-worker contract. A farm worker holds a wasm instance
/// and nothing else — no pool, no RNG, no session — so any worker is
/// interchangeable with any other and with the engine itself. `samples` is
/// moved out on the first read so the buffer can be transferred rather than
/// copied.
#[wasm_bindgen]
pub struct RenderJob {
    ok: bool,
    cached: String,
    samples: Vec<f32>,
}

#[wasm_bindgen]
impl RenderJob {
    /// Whether the term rendered and passed vetting. A `false` here is a
    /// **normal outcome** — a quarantined draw — not an error to report.
    #[wasm_bindgen(getter)]
    pub fn ok(&self) -> bool {
        self.ok
    }

    /// Serialized `ricercar_features::CachedFeatures`: the content key, the
    /// raw φ and vet report, the note onsets and the render length. `""` when
    /// `!ok`.
    #[wasm_bindgen(getter)]
    pub fn cached(&self) -> String {
        self.cached.clone()
    }

    /// The normalized audition as `f32`, emptying the job.
    ///
    /// `f32` is not a precision compromise: a stored render is only ever
    /// consumed through this boundary (`render_of`, `edit_render`), and the
    /// engine measures φ on the f64 render inside the farm worker, before this
    /// conversion. See `ricercar_features::Audition`'s one-way-door note.
    pub fn take_samples(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.samples)
    }

    /// Number of samples still held (0 after [`RenderJob::take_samples`]).
    #[wasm_bindgen(getter)]
    pub fn n_samples(&self) -> usize {
        self.samples.len()
    }
}

/// Render, vet and featurize one term under `phrase_json` — the farm worker's
/// entire job, and a pure function of its two arguments.
///
/// The phrase travels with the handshake rather than being reconstructed from
/// a default, so a farm worker can never measure φ under a stimulus the pool
/// was not measured under. A vet failure returns `ok:false` rather than
/// throwing: a quarantined draw is a normal outcome, and the engine consumes
/// its index either way.
///
/// `want_audio` decides whether the ~565 KB buffer comes back at all. The
/// engine's own fill asks for φ only (its `RenderPolicy::Lazy` pool keeps no
/// audio at admission), so the flag exists to let the caller pay for audio
/// exactly where it will be heard — the first few patches, which are the ones
/// the user auditions while the rest of the bank lands.
#[wasm_bindgen]
pub fn farm_render(tree_json: &str, phrase_json: &str, want_audio: bool) -> RenderJob {
    let rejected = || RenderJob {
        ok: false,
        cached: String::new(),
        samples: Vec::new(),
    };
    let (Ok(tree), Ok(spec)) = (
        serde_json::from_str::<PatchTree>(tree_json),
        serde_json::from_str::<PhraseSpec>(phrase_json),
    ) else {
        return rejected();
    };
    let Ok(pre) = PreFeaturized::render(tree, &spec, want_audio) else {
        return rejected();
    };
    let Ok(cached) = serde_json::to_string(&pre.cached) else {
        return rejected();
    };
    let samples = pre
        .audition
        .map(|a| Arc::try_unwrap(a).unwrap_or_else(|a| (*a).clone()).samples)
        .unwrap_or_default();
    RenderJob {
        ok: true,
        cached,
        samples,
    }
}

/// The session engine, wasm-side.
#[wasm_bindgen]
pub struct WasmEngine {
    engine: Engine,
    rng: StdRng,
    bench_tree: Option<PatchTree>,
    bench_render: Option<Arc<Audition>>,
    bench_original: Option<u64>,
    bench_vet_ok: bool,
    bench_gain_db: f64,
    /// Bank entries of a deferred restore, awaiting off-engine featurization.
    /// Held here rather than shipped to JS so the orchestrator addresses them
    /// by index — the same statelessness the pool fill gets from its draw
    /// stream.
    pending_bank: Vec<BankEntry>,
}

/// The workbench's audition buffer after a featurize.
///
/// The bench is the one surface that *always* needs audio — the user is
/// looking at a scope of the edit they just made — so a memo hit whose buffer
/// has aged out is re-derived rather than left blank. `render_playback` is
/// bit-identical to what `featurize` normalized, so the scope and the sound
/// are the same artifact either way.
fn bench_audio(
    tree: &PatchTree,
    phrase: &PhraseSpec,
    features: &Features,
    fresh: Option<Arc<Audition>>,
) -> Option<Arc<Audition>> {
    fresh.or_else(|| {
        ricercar_features::render_playback(tree, phrase, features.gain_db)
            .ok()
            .map(Arc::new)
    })
}

/// LUFS makeup as a linear gain, clamped to ±12 dB so near-silent patches
/// don't get cranked into the noise floor.
fn makeup_linear(gain_db: f64) -> f64 {
    10f64.powf(gain_db.clamp(-12.0, 12.0) / 20.0)
}

#[wasm_bindgen]
impl WasmEngine {
    /// Create an engine with the default grammar and session config.
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u64, pool_size: usize) -> WasmEngine {
        console_error_panic_hook::set_once();
        let cfg = SessionConfig {
            pool_size,
            // The browser is the one place audition memory is scarce and the
            // one place audio is actually played. Lazy is the answer to both:
            // a full eager pool is tens of megabytes of buffers the user will
            // mostly never hear, while the dozen that matter (the duel pair,
            // the bench subject, whatever was just auditioned) stay resident.
            render_policy: RenderPolicy::Lazy,
            audio_cache: 12,
            // The MCMC budget is no longer overridden here. This used to run
            // 20 000/6 000 as a "slightly lighter chain than the native
            // default" of 30 000/10 000; the default is now 10 000/3 000
            // (chosen from a measured recovery-vs-budget curve — see
            // `SessionConfig::mcmc_samples`), so an override would make the
            // browser, the one place a fit blocks a human, the *heaviest*
            // chain in the tree.
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
            bench_gain_db: 0.0,
            pending_bank: Vec::new(),
        }
    }

    /// Loudness-makeup linear gain for live playback of candidate `id`
    /// (evens patches out to the audition target). 1.0 for unknown ids.
    pub fn makeup_of(&self, id: u32) -> f64 {
        self.engine
            .find(id as u64)
            .map(|i| makeup_linear(self.engine.pool[i].features.gain_db))
            .unwrap_or(1.0)
    }

    /// Loudness-makeup linear gain for the current workbench tree.
    pub fn edit_makeup(&self) -> f64 {
        makeup_linear(self.bench_gain_db)
    }

    /// Add up to `max_new` vetted candidates. Returns how many were added,
    /// so the worker can post fill progress between calls.
    ///
    /// The serial path, and the fallback whenever no farm is available. It
    /// folds the same indexed draw stream `fill_draw`/`fill_absorb` fold, so
    /// the pool it builds is the pool the farm builds.
    pub fn fill_step(&mut self, max_new: usize) -> usize {
        self.engine.fill_pool_step(&mut self.rng, max_new)
    }

    // ------------------------------------------------------------------
    // Render farm (see `ricercar_session::farm`)
    // ------------------------------------------------------------------

    /// The audition stimulus as JSON, for the farm handshake.
    ///
    /// Shipped rather than assumed: a farm worker that defaulted its own
    /// `PhraseSpec` would measure φ under a different stimulus the moment the
    /// engine's phrase ever becomes configurable, and the drift would be
    /// silent because every individual render would still be internally
    /// consistent.
    pub fn phrase_json(&self) -> String {
        serde_json::to_string(&self.engine.cfg.phrase).unwrap_or_default()
    }

    /// Next index of the pool draw stream the engine will fold in.
    pub fn fill_cursor(&self) -> u32 {
        self.engine.draw_cursor() as u32
    }

    /// Hand out up to `n` unrendered draws as JSON
    /// `[{"i":7,"tree":{…},"dup":false}]`, possibly shorter than `n` or empty.
    ///
    /// Empty means "nothing to issue *right now*" — the pool has as much work
    /// outstanding as it can use, or the draw budget is spent. It is a stop
    /// signal only in combination with nothing outstanding; see
    /// `Engine::fill_draw`.
    pub fn fill_draw(&mut self, n: usize) -> String {
        self.engine.ensure_fill_seed(&mut self.rng);
        serde_json::to_string(&self.engine.fill_draw(n)).unwrap_or_else(|_| "[]".into())
    }

    /// The term at `index` of the draw stream, as JSON (`""` before the stream
    /// starts).
    ///
    /// The re-issue path: a farm worker that dies or hangs loses nothing but
    /// its render, because the job it was doing is fully named by its index.
    /// No tree JSON has to be retained anywhere to recover it.
    pub fn draw_json(&self, index: u32) -> String {
        self.engine
            .draw_at(index as u64)
            .and_then(|t| serde_json::to_string(&t).ok())
            .unwrap_or_default()
    }

    /// Fold one farm result into the pool, in index order.
    ///
    /// `cached_json == ""` (or samples whose length disagrees with the render
    /// the farm reported) means the draw did not survive: the index is
    /// consumed and 0 returned, exactly as a vet failure burns an attempt in
    /// the serial loop. Returns the new candidate id otherwise, or 0 for a
    /// duplicate or a full pool.
    pub fn fill_absorb(&mut self, index: u32, cached_json: &str, samples: &[f32]) -> u32 {
        let i = index as u64;
        let pre = self
            .engine
            .draw_at(i)
            .and_then(|tree| self.pre_featurized(tree, cached_json, samples));
        self.engine.absorb_prior(i, pre).unwrap_or(0) as u32
    }

    /// Restore a session but leave the bank un-rendered: returns JSON
    /// `[{"i":0,"tree":{…}}]` in bank order. Every entry must come back
    /// through [`WasmEngine::bank_absorb`], after which
    /// [`WasmEngine::restore_finish`] closes the restore.
    pub fn import_session_deferred(&mut self, json: &str) -> String {
        let Ok(state) = serde_json::from_str::<SessionState>(json) else {
            return "[]".into();
        };
        self.pending_bank = self.engine.import_state_deferred(state);
        self.engine.begin_session();
        let jobs: Vec<serde_json::Value> = self
            .pending_bank
            .iter()
            .enumerate()
            .map(|(i, e)| serde_json::json!({ "i": i, "tree": e.tree }))
            .collect();
        serde_json::to_string(&jobs).unwrap_or_else(|_| "[]".into())
    }

    /// The term of pending bank entry `index`, as JSON (`""` if unknown) —
    /// the restore path's re-issue hook.
    pub fn bank_draw_json(&self, index: usize) -> String {
        self.pending_bank
            .get(index)
            .and_then(|e| serde_json::to_string(&e.tree).ok())
            .unwrap_or_default()
    }

    /// Reinstate one restored bank entry from an off-engine featurization.
    /// Returns false for an unknown index or a result that did not survive —
    /// a bank entry that no longer vets is dropped, exactly as the serial
    /// restore drops it.
    pub fn bank_absorb(&mut self, index: usize, cached_json: &str, samples: &[f32]) -> bool {
        let Some(entry) = self.pending_bank.get(index).cloned() else {
            return false;
        };
        let Some(pre) = self.pre_featurized(entry.tree.clone(), cached_json, samples) else {
            return false;
        };
        self.engine.absorb_bank_entry(entry, pre);
        true
    }

    /// Featurize and reinstate pending bank entry `index` **in this worker**.
    ///
    /// The deferred restore's serial completion: whatever the farm did not
    /// finish is finished here, so a restore never depends on the farm having
    /// survived. Same work, same order, same result — it just blocks.
    pub fn bank_render(&mut self, index: usize) -> bool {
        let Some(entry) = self.pending_bank.get(index).cloned() else {
            return false;
        };
        let want_audio = self.engine.cfg.render_policy == RenderPolicy::Eager;
        let Ok((cached, audition)) = featurize_memo(
            &entry.tree,
            &self.engine.cfg.phrase,
            self.engine.memo(),
            want_audio,
        ) else {
            return false;
        };
        let pre = PreFeaturized {
            tree: entry.tree.clone(),
            cached,
            audition,
        };
        self.engine.absorb_bank_entry(entry, pre);
        true
    }

    /// Close a deferred restore (standardizer + φ resolution). Returns the
    /// number of bank entries that landed.
    pub fn restore_finish(&mut self) -> usize {
        self.pending_bank = Vec::new();
        self.engine.finish_restore()
    }

    /// Make the pool duel-able **now**, mid-fill: standardize every member,
    /// fitting a standardizer over whatever has been drawn so far if none
    /// exists yet. Cheap — no renders, just mean/variance over φ.
    ///
    /// This is what lets a progressive boot hand the user a duel after ~8
    /// candidates instead of after all 40: `next_duel` refuses any candidate
    /// with an empty `phi_std`, and without this the engine only standardizes
    /// when the pool first *reaches* its target.
    pub fn standardize_now(&mut self) {
        self.engine.standardize_now();
    }

    /// Re-fit the standardizer once the fill completes, over the full pool
    /// rather than the first few draws. No-op if a posterior already exists —
    /// moving the scale under live θ would rescale every utility on screen.
    pub fn restandardize_if_untaught(&mut self) {
        self.engine.restandardize_if_untaught();
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
            ess: self.engine.posterior_ess().unwrap_or(0.0),
            needs_refit: self.engine.needs_refit(),
        })
        .unwrap()
    }

    /// Choose the next duel: JSON `[idA, idB]`, or `null` if the pool is
    /// small. See [`WasmEngine::next_duel_ex`] for the annotated form.
    pub fn next_duel(&mut self) -> String {
        let pair = self
            .engine
            .next_duel(&mut self.rng)
            .map(|(a, b)| [self.engine.pool[a].id, self.engine.pool[b].id]);
        serde_json::to_string(&pair).unwrap()
    }

    /// Choose the next duel, with the reasoning attached — `null` if the pool
    /// is too small:
    ///
    /// ```json
    /// {"a":12,"b":31,"info_gain":0.41,"random_check":false,"method":"bald"}
    /// ```
    ///
    /// `a`/`b` are candidate **ids**. `info_gain` is expected information
    /// about θ in nats (max `ln 2 ≈ 0.693`). `method` is `"bald"`,
    /// `"check"` (a uniformly-random calibration probe — worth labelling in
    /// the UI, since the model is deliberately not choosing it) or
    /// `"random"` (no posterior yet).
    pub fn next_duel_ex(&mut self) -> String {
        #[derive(Serialize)]
        struct Row {
            a: u64,
            b: u64,
            info_gain: f64,
            random_check: bool,
            method: &'static str,
        }
        match self.engine.next_duel_full(&mut self.rng) {
            Some(d) => serde_json::to_string(&Row {
                a: self.engine.pool[d.a].id,
                b: self.engine.pool[d.b].id,
                info_gain: d.info_gain,
                random_check: d.random_check,
                method: d.method,
            })
            .unwrap(),
            None => "null".into(),
        }
    }

    /// The audition buffer of candidate `id` (mono, ±1.0), for WebAudio.
    ///
    /// **`&mut self`, and it can take a render.** Under the lazy policy this
    /// engine boots with, the buffer is materialized here on first request
    /// rather than retained from the fill. An **empty** return means the term
    /// no longer renders (a restored bank can outlive the DSP that made it) —
    /// callers must treat it as a failure and stop waiting, not as "not yet".
    pub fn render_of(&mut self, id: u32) -> Vec<f32> {
        self.engine
            .render_of(id as u64)
            .map(|a| pcm(&a))
            .unwrap_or_default()
    }

    /// Materialize `id`'s audition buffer without returning it.
    ///
    /// The deal path calls this for both sides the moment a pair is chosen,
    /// so the lazy render happens while the user is still reading the cards
    /// rather than after they press ▶. Cheap and idempotent once resident.
    pub fn prefetch_render(&mut self, id: u32) -> bool {
        self.engine.render_of(id as u64).is_some()
    }

    /// Featurization-memo counters as JSON
    /// (`{hits, misses, features, audio, audio_bytes}`) — how much rendering
    /// the memo is deleting, and how much audio is resident.
    pub fn memo_stats(&self) -> String {
        let s = self.engine.memo().stats();
        serde_json::to_string(&serde_json::json!({
            "hits": s.hits,
            "misses": s.misses,
            "features": s.features,
            "audio": s.audio,
            "audio_bytes": s.audio_bytes,
        }))
        .unwrap()
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

    /// Open a generation; returns the parent ids to refine from as a JSON
    /// array, or `[]` if there is no taste to refine toward yet (in which case
    /// no generation is opened).
    ///
    /// Paired with [`WasmEngine::refine_seed`] so the caller can drive a
    /// generation one seed at a time and show progress. A generation is tens
    /// of seconds of render-bound work; as a single call it looks like a hang.
    pub fn refine_begin(&mut self) -> String {
        serde_json::to_string(&self.engine.refine_begin()).unwrap_or_else(|_| "[]".into())
    }

    /// Refine one seed of the open generation. Returns the child id, or 0 if
    /// the walk was rejected or landed on a patch already in the pool.
    pub fn refine_seed(&mut self, parent_id: u32) -> u32 {
        self.engine
            .refine_seed(&mut self.rng, parent_id as u64)
            .unwrap_or(0) as u32
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

    /// Ranked pool as JSON
    /// (`[{id, mean, std, origin, name, named, signature, sexpr}]`).
    pub fn ranked(&self) -> String {
        let names = self.engine.display_names();
        let rows: Vec<RankedRow> = self
            .engine
            .ranked()
            .into_iter()
            .map(|(idx, mean, std)| {
                let c = &self.engine.pool[idx];
                RankedRow {
                    id: c.id,
                    mean,
                    std,
                    origin: origin_str(c.origin),
                    name: names
                        .get(&c.id)
                        .cloned()
                        .unwrap_or_else(|| c.tree.signature()),
                    named: c.name.is_some(),
                    signature: c.tree.signature(),
                    sexpr: c.tree.to_sexpr(),
                    pinned: c.pinned,
                }
            })
            .collect();
        serde_json::to_string(&rows).unwrap()
    }

    /// Display name of one candidate (user-given, else musical).
    pub fn name_of(&self, id: u32) -> String {
        self.engine
            .display_names()
            .get(&(id as u64))
            .cloned()
            .unwrap_or_default()
    }

    /// **Why this patch scores what it does**, as JSON, or `null` before the
    /// first fit / for an unknown id:
    ///
    /// ```json
    /// {"id":12,"style":1,"style_name":"Dark Drones",
    ///  "utility":0.84,"utility_std":0.31,
    ///  "mix_utility":0.91,"responsibility":0.86,
    ///  "contributions":[{"name":"centroid_mean","theta":0.42,
    ///                    "phi_std":1.01,"contribution":0.42}, …]}
    /// ```
    ///
    /// Contributions are sorted by descending |contribution| and sum exactly
    /// to `utility` — utility is linear within a lens, so this is an exact
    /// decomposition rather than a surrogate approximation.
    ///
    /// **Draw `mix_utility` as the score.** It is the value `ranked()` sorts
    /// the bank by; `utility` is the lens-conditional quantity the
    /// contributions explain, and it is always ≤ `mix_utility`. Rendering
    /// `utility` beside a row ranked by `mix_utility` shows a number that
    /// disagrees with its own list. `responsibility` says how much that
    /// distinction matters for this patch: near 1 the two coincide, well
    /// below 1 the patch sits between styles.
    pub fn explain(&self, id: u32) -> String {
        match self.engine.explain(id as u64) {
            Some(e) => serde_json::to_string(&e).unwrap(),
            None => "null".into(),
        }
    }

    /// Prequential calibration as JSON — a **proper** score, replacing the
    /// running hit rate (which is not one, and which the acquisition function
    /// pins near 50 % by design):
    ///
    /// ```json
    /// {"n":42,"brier":0.19,"log_loss":0.58,"skill":0.24,
    ///  "bins":[{"lo":0.0,"hi":0.2,"n":7,"predicted":0.11,"observed":0.14}, …],
    ///  "check_n":4,"check_skill":0.18,"check_log_loss":0.61,"hit_rate":0.55}
    /// ```
    ///
    /// `skill` is `1 − Brier/0.25`: 0 means no better than a coin flip, 1
    /// means perfect and certain. `log_loss` is in nats (`ln 2 ≈ 0.693` is
    /// the coin-flip baseline). `bins` is the reliability diagram over
    /// `P(A wins)`. `check_*` restricts the score to the uniformly-random
    /// check duels, which is the only selection-bias-free number here.
    pub fn calibration(&self) -> String {
        serde_json::to_string(&self.engine.calibration()).unwrap()
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
                    name: self.engine.style_names.get(k).cloned().unwrap_or_default(),
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

    /// Name (or rename; empty clears) a candidate.
    pub fn set_name(&mut self, id: u32, name: &str) {
        self.engine.set_name(id as u64, name);
    }

    /// Pin or unpin a patch against eviction. Returns `false` when the id is
    /// gone or the pin budget is full — the caller must say which, because a
    /// pin control that silently does nothing is the exact failure this whole
    /// mechanism exists to end.
    pub fn set_pinned(&mut self, id: u32, pinned: bool) -> bool {
        self.engine.set_pinned(id as u64, pinned)
    }

    /// How many patches are pinned, and the ceiling, as `[count, cap]`.
    pub fn pin_budget(&self) -> Vec<u32> {
        vec![
            self.engine.pinned_count() as u32,
            self.engine.pin_cap() as u32,
        ]
    }

    /// Name an aligned style index.
    pub fn set_style_name(&mut self, k: usize, name: &str) {
        self.engine.set_style_name(k, name);
    }

    /// Log an implicit preference event (promote, play counts, …).
    pub fn log_event(&mut self, kind: &str, id: u32, value: f64) {
        self.engine.log_event(kind, id as u64, value);
    }

    /// Model's predicted probability that `a` beats `b` (−1 before the
    /// first fit / unknown ids).
    pub fn duel_pred(&self, a: u32, b: u32) -> f64 {
        match (self.engine.find(a as u64), self.engine.find(b as u64)) {
            (Some(i), Some(j)) => self.engine.predict_duel(i, j).unwrap_or(-1.0),
            _ => -1.0,
        }
    }

    /// The aligned style index that best explains candidate `id`
    /// (−1 before the first fit / unknown id).
    pub fn best_style_of(&self, id: u32) -> i32 {
        let (Some(i), Some(p)) = (self.engine.find(id as u64), &self.engine.posterior) else {
            return -1;
        };
        let phi = &self.engine.pool[i].phi_std;
        if phi.is_empty() {
            return -1;
        }
        let r = p.responsibilities(phi);
        r.iter()
            .enumerate()
            .max_by(|(_, x), (_, y)| x.total_cmp(y))
            .map(|(k, _)| k as i32)
            .unwrap_or(-1)
    }

    /// The built-in preset bank as JSON
    /// (`[{index, name, category, blurb, sig}]`).
    ///
    /// `category` is what the browser groups by and what the warm start
    /// samples across — with the library past two dozen, an unstratified
    /// sample of nine would keep landing in one corner of the space, which is
    /// the same cold-start bias the warm start exists to remove.
    pub fn preset_list(&self) -> String {
        #[derive(Serialize)]
        struct Row {
            index: usize,
            name: &'static str,
            category: &'static str,
            blurb: &'static str,
            sig: String,
        }
        let rows: Vec<Row> = ricercar_grammar::preset_bank()
            .into_iter()
            .enumerate()
            .map(|(index, p)| Row {
                index,
                name: p.name,
                category: p.category,
                blurb: p.blurb,
                sig: p.tree.signature(),
            })
            .collect();
        serde_json::to_string(&rows).unwrap()
    }

    /// Load preset `index` into the bank; returns its id (existing id if the
    /// identical patch is already there), or 0 on failure.
    pub fn load_preset(&mut self, index: usize) -> u32 {
        let all = presets();
        let Some((name, tree)) = all.into_iter().nth(index) else {
            return 0;
        };
        self.engine.insert_preset(tree, name).unwrap_or(0) as u32
    }

    // ------------------------------------------------------------------
    // Workbench (the interactive panel)
    // ------------------------------------------------------------------

    /// Import a shared patch (tree JSON + optional name) into the bank.
    /// Returns the new id, or 0 (bad JSON / duplicate / vet failure).
    pub fn import_patch(&mut self, tree_json: &str, name: &str) -> u32 {
        let Ok(tree) = serde_json::from_str::<PatchTree>(tree_json) else {
            return 0;
        };
        match self.engine.commit_edit(None, tree, false) {
            Some(id) => {
                self.engine.set_name(id, name);
                id as u32
            }
            None => 0,
        }
    }

    /// Load candidate `id` onto the workbench. Returns false for unknown id.
    pub fn edit_begin(&mut self, id: u32) -> bool {
        let id = id as u64;
        match self.engine.find(id) {
            Some(i) => {
                self.bench_tree = Some(self.engine.pool[i].tree.clone());
                self.bench_gain_db = self.engine.pool[i].features.gain_db;
                // Materializes the buffer if the lazy pool had let it go: the
                // panel shows a scope the moment it opens, so the bench must
                // never start empty for a candidate that renders fine.
                self.bench_render = self.engine.render_of(id);
                self.bench_original = Some(id);
                // A pool member vetted when it was admitted, but a bank
                // restored across a DSP change can hold a term that no longer
                // renders — and `bench_vet_ok` is what gates commit *and*
                // playback. Take it from whether a buffer actually exists,
                // not from the fact that this id is in the pool.
                self.bench_vet_ok = self.bench_render.is_some();
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
        let (phrase, memo) = (self.phrase(), self.engine.memo().clone());
        match set_param(tree, addr, v) {
            Ok(edited) => {
                match featurize_memo(&edited, &phrase, &memo, true) {
                    Ok((cf, audio)) => {
                        self.bench_gain_db = cf.features.gain_db;
                        self.bench_render = bench_audio(&edited, &phrase, &cf.features, audio);
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

    /// Adopt a structural edit (replace/insert/delete/set_mod/swap_mix, as
    /// JSON — see `ricercar_grammar::StructOp`) **without** re-rendering.
    /// Returns an empty string on success or the rejection reason.
    ///
    /// Split out of [`Self::edit_structure`] because the render is the entire
    /// cost. The live worklet can swap a new tree in ~23 ms; the featurizer
    /// takes the better part of a second, and the only thing that ever put it
    /// between a player's gesture and the sound was that the two lived in one
    /// call. A caller that splits gets to speak to the audio thread first and
    /// featurize after — but it owes a following [`Self::edit_revet`], because
    /// until then `edit_render`/`edit_vet_ok` describe the tree *before* this
    /// edit.
    pub fn edit_structure_apply(&mut self, op_json: &str) -> String {
        let Some(tree) = &self.bench_tree else {
            return "no patch on the bench".into();
        };
        let op: StructOp = match serde_json::from_str(op_json) {
            Ok(op) => op,
            Err(e) => return format!("bad op: {e}"),
        };
        match apply_struct_op(tree, &op) {
            Ok(edited) => {
                self.bench_tree = Some(edited);
                String::new()
            }
            Err(e) => e.to_string(),
        }
    }

    /// Adopt a whole replacement workbench tree (undo/redo restore, and every
    /// client-side rewrite the graph editor commits) **without** re-rendering.
    /// Returns an empty string on success or the rejection reason.
    ///
    /// The ceiling check is the load-bearing line. This route does not go
    /// through `apply_struct_op`, so until `validate_tree` existed it was a
    /// hole straight through MAX_SIZE / MAX_DEPTH / MAX_MOD_DEPTH — and it is
    /// exactly the route a move or a reconnect uses. A patch built past those
    /// ceilings is not just big: it has ~zero mass under the prior, sits
    /// outside the range the standardizer was fitted on, and gets mutated back
    /// inside them by the next refinement, so the player's structure
    /// disappears on the next evolve with nothing ever having said no.
    pub fn edit_set_tree_apply(&mut self, tree_json: &str) -> String {
        if self.bench_tree.is_none() {
            return "no patch on the bench".into();
        }
        let mut tree: PatchTree = match serde_json::from_str(tree_json) {
            Ok(t) => t,
            Err(e) => return format!("bad tree: {e}"),
        };
        if let Err(e) = validate_tree(&tree) {
            return e;
        }
        // The panel builds this tree itself, so it is also the one route by
        // which a node can arrive with no identity (a module the editor just
        // made) or with someone else's (a duplicated subtree brings its
        // original's uids along in the copy). Settling assigns the first and
        // breaks the second, and it is idempotent for every node that merely
        // moved — which is the whole point: a reconnect must not reissue
        // identities, or the locks and positions riding on them die on a
        // gesture that changed nothing but a wire.
        tree.ensure_uids();
        self.bench_tree = Some(tree);
        String::new()
    }

    /// Re-render and re-vet whatever tree is currently on the bench.
    ///
    /// The expensive half of an edit, callable on its own so the cheap half
    /// can be delivered to the ear first. Idempotent.
    pub fn edit_revet(&mut self) {
        let Some(tree) = self.bench_tree.clone() else {
            return;
        };
        let (phrase, memo) = (self.phrase(), self.engine.memo().clone());
        match featurize_memo(&tree, &phrase, &memo, true) {
            Ok((cf, audio)) => {
                self.bench_gain_db = cf.features.gain_db;
                self.bench_render = bench_audio(&tree, &phrase, &cf.features, audio);
                self.bench_vet_ok = true;
            }
            Err(_) => {
                self.bench_render = None;
                self.bench_vet_ok = false;
            }
        }
    }

    /// Apply a structural edit and re-render in one call — apply + revet, for
    /// callers with nothing to do in between.
    pub fn edit_structure(&mut self, op_json: &str) -> String {
        let err = self.edit_structure_apply(op_json);
        if err.is_empty() {
            self.edit_revet();
        }
        err
    }

    /// Replace the whole workbench tree and re-render in one call.
    pub fn edit_set_tree(&mut self, tree_json: &str) -> String {
        let err = self.edit_set_tree_apply(tree_json);
        if err.is_empty() {
            self.edit_revet();
        }
        err
    }

    /// The workbench audition buffer (empty when the current edit failed
    /// vetting — DESIGN.md §2.1: never play an unvetted patch).
    pub fn edit_render(&self) -> Vec<f32> {
        self.bench_render.as_deref().map(pcm).unwrap_or_default()
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

    /// Reconstitute a farm result. `None` is the "did not survive" answer that
    /// every absorb site treats as a vet failure.
    ///
    /// Two gates, both from DESIGN §2.1. The content key is re-derived from
    /// the tree the *engine* chose for this index and compared against the key
    /// the farm reported: a mis-routed reply — a duplicated or reordered worker
    /// message that files φ(A) under index B — is otherwise indistinguishable
    /// from a good result, and admitting it writes another patch's raw φ into
    /// the observation log, `export_profile` and the standardizer's reference
    /// population. That is durable corruption; an FNV-128 over the canonical
    /// tree is microseconds against a ~500 ms render.
    ///
    /// The samples-length check is the same argument one level down: a buffer
    /// whose length disagrees with the render the farm itself reported is a
    /// buffer belonging to some *other* patch, and admitting it would put audio
    /// into the pool whose vet report is a lie about it. Refusing either gate
    /// costs one draw; accepting costs the gate.
    fn pre_featurized(
        &self,
        tree: PatchTree,
        cached_json: &str,
        samples: &[f32],
    ) -> Option<PreFeaturized> {
        if cached_json.is_empty() {
            return None;
        }
        let cached: CachedFeatures = serde_json::from_str(cached_json).ok()?;
        if cached.key != ricercar_features::render_key(&tree, &self.engine.cfg.phrase) {
            return None;
        }
        let audition = if samples.is_empty() {
            None
        } else {
            if samples.len() != cached.n_samples {
                return None;
            }
            Some(Arc::new(Audition {
                samples: samples.to_vec(),
                sample_rate: self.engine.cfg.phrase.sample_rate,
            }))
        };
        Some(PreFeaturized {
            tree,
            cached,
            audition,
        })
    }

    // ------------------------------------------------------------------
    // Persistence
    // ------------------------------------------------------------------

    /// Export the full session (profile + bank trees/names/origins +
    /// lineage) as JSON, for autosave.
    pub fn export_session(&self) -> String {
        serde_json::to_string(&self.engine.export_state()).unwrap()
    }

    /// Restore a saved session (replacing pool, log, lineage). Returns the
    /// number of bank entries restored, 0 on parse failure. Re-featurizes
    /// every tree — seconds of work; call from the worker.
    pub fn import_session(&mut self, json: &str) -> usize {
        match serde_json::from_str::<SessionState>(json) {
            Ok(state) => {
                let n = self.engine.import_state(state);
                self.engine.begin_session();
                n
            }
            Err(_) => 0,
        }
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    /// The structural-edit vocabulary is a **wire format**: `main.js` builds
    /// these payloads by hand and posts them at `apply_struct_op`, and the
    /// same strings are what `describe` reports as a module's `kind`, so the
    /// palette, the faceplate and the edit all key off one spelling. A serde
    /// rename drifting from the rack description would be invisible in Rust
    /// and would break exactly one button in the browser.
    #[test]
    fn the_structural_edit_vocabulary_keeps_its_spellings() {
        use ricercar_grammar::{ModKind, NodeKind};
        for (kind, want) in [
            (NodeKind::Vco, "vco"),
            (NodeKind::Supersaw, "supersaw"),
            (NodeKind::Noise, "noise"),
            (NodeKind::Wavetable, "wavetable"),
            (NodeKind::Pluck, "pluck"),
            (NodeKind::Mix, "mix"),
            (NodeKind::Filter, "filter"),
            (NodeKind::Fold, "fold"),
            (NodeKind::Delay, "delay"),
            (NodeKind::Chorus, "chorus"),
            (NodeKind::Reverb, "reverb"),
            (NodeKind::Distortion, "distortion"),
            (NodeKind::Bitcrush, "bitcrush"),
            (NodeKind::Phaser, "phaser"),
            // Not `ring_mod`: `describe` reports `ringmod`, and one module
            // must not have two names.
            (NodeKind::RingMod, "ringmod"),
            (NodeKind::Formant, "formant"),
            (NodeKind::Flanger, "flanger"),
            (NodeKind::Tremolo, "tremolo"),
            (NodeKind::Vibrato, "vibrato"),
            (NodeKind::Eq, "eq"),
            (NodeKind::Granular, "granular"),
            (NodeKind::Shift, "shift"),
            (NodeKind::Comp, "comp"),
            (NodeKind::Duck, "duck"),
            (NodeKind::Gate, "gate"),
            (NodeKind::Vocoder, "vocoder"),
        ] {
            assert_eq!(serde_json::to_string(&kind).unwrap(), format!("\"{want}\""));
        }
        for (kind, want) in [
            (ModKind::None, "none"),
            (ModKind::Lfo, "lfo"),
            (ModKind::Env, "env"),
            (ModKind::Rand, "rand"),
            (ModKind::Follow, "follow"),
            // Wave 2C. Each of these is also a `RackModule::kind` — the
            // shapers report `ModOp::label`/`PairOp::label`, which are the
            // same eleven strings, so the palette button and the module it
            // produces agree exactly as they do for the audio kinds.
            (ModKind::Euclid, "euclid"),
            (ModKind::Quantize, "quantize"),
            (ModKind::Slew, "slew"),
            (ModKind::Rectify, "rectify"),
            (ModKind::Hold, "hold"),
            (ModKind::Min, "min"),
            (ModKind::Max, "max"),
            (ModKind::And, "and"),
            (ModKind::Or, "or"),
            (ModKind::Xor, "xor"),
            (ModKind::Switch, "switch"),
        ] {
            assert_eq!(serde_json::to_string(&kind).unwrap(), format!("\"{want}\""));
        }
        // Every buildable kind is also a kind the rack description names, so
        // the palette button and the module it produces agree.
        for kind in [
            NodeKind::Wavetable,
            NodeKind::Pluck,
            NodeKind::Distortion,
            NodeKind::Bitcrush,
            NodeKind::Phaser,
            NodeKind::RingMod,
            NodeKind::Formant,
            NodeKind::Flanger,
            NodeKind::Tremolo,
            NodeKind::Vibrato,
            NodeKind::Eq,
            NodeKind::Granular,
            NodeKind::Shift,
            NodeKind::Comp,
            NodeKind::Duck,
            NodeKind::Gate,
            NodeKind::Vocoder,
        ] {
            let tree = ricercar_grammar::apply_struct_op(
                &ricercar_grammar::presets()[0].1,
                &ricercar_grammar::StructOp::Replace {
                    key: "node".into(),
                    kind,
                },
            )
            .expect("replace at the root always applies");
            let rack = ricercar_grammar::describe(&tree);
            let spelled = serde_json::to_string(&kind).unwrap();
            assert!(
                rack.modules
                    .iter()
                    .any(|m| format!("\"{}\"", m.kind) == spelled),
                "no module named {spelled} in the rack it built"
            );
        }
    }

    /// Drive one pool fill entirely through the farm boundary: the exact JSON
    /// shapes, index types and byte buffers `farm.js` and `worker.js` move.
    fn farm_fill(engine: &mut WasmEngine, want_audio: bool) {
        let phrase = engine.phrase_json();
        loop {
            let wave: Vec<serde_json::Value> =
                serde_json::from_str(&engine.fill_draw(4)).expect("fill_draw JSON");
            if wave.is_empty() {
                break;
            }
            // Deliberately absorbed in issue order after rendering the whole
            // wave — the reordering a real farm introduces lives between these
            // two loops.
            let mut results = Vec::new();
            for job in &wave {
                let index = job["i"].as_u64().expect("draw index") as u32;
                let tree = serde_json::to_string(&job["tree"]).expect("tree JSON");
                if job["dup"].as_bool().unwrap_or(false) {
                    results.push((index, String::new(), Vec::new()));
                    continue;
                }
                let mut r = farm_render(&tree, &phrase, want_audio);
                if !r.ok() {
                    results.push((index, String::new(), Vec::new()));
                    continue;
                }
                results.push((index, r.cached(), r.take_samples()));
            }
            for (index, cached, samples) in results {
                engine.fill_absorb(index, &cached, &samples);
            }
            let st: serde_json::Value =
                serde_json::from_str(&engine.status()).expect("status JSON");
            if st["pool"].as_u64() >= st["pool_target"].as_u64() {
                break;
            }
        }
    }

    /// A saved session with its node identities stripped.
    ///
    /// Two engines that built the same patches by different routes are the
    /// same session, and identities are the one thing that legitimately differs
    /// between them: uids come from a process-global mint, so the second engine
    /// in a test has simply counted further. Comparing exports is comparing
    /// *content*, and content is what this strips to. (The identities
    /// themselves are pinned by the grammar and session suites.)
    fn session_content(engine: &WasmEngine) -> String {
        let mut state: ricercar_session::SessionState =
            serde_json::from_str(&engine.export_session()).expect("a session round-trips");
        for entry in &mut state.bank {
            entry.tree.clear_uids();
        }
        serde_json::to_string(&state).expect("a session serializes")
    }

    /// The whole point, at the boundary the browser actually crosses: a pool
    /// filled through `fill_draw` → `farm_render` → `fill_absorb` is the pool
    /// `fill_step` builds. If these ever disagree, a user whose browser cannot
    /// spawn a worker is running a different instrument.
    #[test]
    fn the_farm_boundary_builds_the_serial_pool() {
        let mut serial = WasmEngine::new(0xBEEF, 6);
        while serial.fill_step(2) > 0 {}
        let mut farmed = WasmEngine::new(0xBEEF, 6);
        farm_fill(&mut farmed, false);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&serial.status()).unwrap()["pool"],
            serde_json::from_str::<serde_json::Value>(&farmed.status()).unwrap()["pool"],
        );
        assert_eq!(
            session_content(&serial),
            session_content(&farmed),
            "the farm boundary built a different session than the serial fill"
        );
    }

    /// Audio may ride along, and when it does it must be the render φ was
    /// measured on. Asking for it must not move the pool either — it is a
    /// transport option, not a featurization one.
    #[test]
    fn transported_audio_neither_moves_nor_misses_the_pool() {
        let mut dry = WasmEngine::new(0x1234, 4);
        farm_fill(&mut dry, false);
        let mut wet = WasmEngine::new(0x1234, 4);
        farm_fill(&mut wet, true);
        assert_eq!(
            session_content(&dry),
            session_content(&wet),
            "asking the farm for audio changed the pool"
        );
        // The absorbed buffer is what `render_of` hands WebAudio, and it must
        // match a fresh in-process render of the same term.
        let ranked: Vec<serde_json::Value> = serde_json::from_str(&wet.ranked()).unwrap();
        let id = ranked[0]["id"].as_u64().expect("ranked id") as u32;
        let from_farm = wet.render_of(id);
        assert!(
            !from_farm.is_empty(),
            "absorbed audio never reached the pool"
        );
        let mut cold = WasmEngine::new(0x1234, 4);
        farm_fill(&mut cold, false);
        assert_eq!(
            from_farm,
            cold.render_of(id),
            "a transported audition drifted from the render it names"
        );
    }

    /// A result that does not survive transport is a *vet failure*, not an
    /// admission: the draw's index is consumed and nothing enters the pool.
    /// Admitting audio whose length disagrees with its own vet report would be
    /// exactly the DESIGN §2.1 bypass the gate exists to prevent.
    #[test]
    fn a_corrupted_farm_result_burns_its_draw_and_admits_nothing() {
        let mut engine = WasmEngine::new(0x9999, 8);
        let phrase = engine.phrase_json();
        let wave: Vec<serde_json::Value> = serde_json::from_str(&engine.fill_draw(1)).unwrap();
        let index = wave[0]["i"].as_u64().unwrap() as u32;
        let tree = serde_json::to_string(&wave[0]["tree"]).unwrap();
        let mut r = farm_render(&tree, &phrase, true);
        assert!(r.ok(), "reference draw must render");
        let mut samples = r.take_samples();
        samples.truncate(samples.len() - 1);

        assert_eq!(engine.fill_cursor(), index);
        assert_eq!(
            engine.fill_absorb(index, &r.cached(), &samples),
            0,
            "a length-mismatched buffer was admitted"
        );
        assert_eq!(engine.fill_cursor(), index + 1, "the draw was not consumed");
        let st: serde_json::Value = serde_json::from_str(&engine.status()).unwrap();
        assert_eq!(st["pool"], 0, "a refused result still reached the pool");

        // An empty result (the farm's own vet failure) behaves identically.
        let next: Vec<serde_json::Value> = serde_json::from_str(&engine.fill_draw(1)).unwrap();
        let i2 = next[0]["i"].as_u64().unwrap() as u32;
        assert_eq!(engine.fill_absorb(i2, "", &[]), 0);
        assert_eq!(engine.fill_cursor(), i2 + 1);
    }

    /// Absorption is in index order, and out-of-order results are refused
    /// rather than folded in — the invariant the whole width-equivalence
    /// argument rests on. A reorder buffer that silently accepted them would
    /// build a pool no other width reproduces.
    #[test]
    fn out_of_order_absorption_is_refused() {
        let mut engine = WasmEngine::new(0x77, 8);
        let phrase = engine.phrase_json();
        let wave: Vec<serde_json::Value> = serde_json::from_str(&engine.fill_draw(3)).unwrap();
        assert!(wave.len() >= 2, "need two draws to reorder");
        let cursor = engine.fill_cursor();
        let later = wave[1]["i"].as_u64().unwrap() as u32;
        let tree = serde_json::to_string(&wave[1]["tree"]).unwrap();
        let mut r = farm_render(&tree, &phrase, false);
        let samples = r.take_samples();
        assert_eq!(
            engine.fill_absorb(later, &r.cached(), &samples),
            0,
            "a result that jumped the queue was absorbed"
        );
        assert_eq!(
            engine.fill_cursor(),
            cursor,
            "the cursor moved out of order"
        );
    }

    /// A deferred restore rebuilds the session the serial restore rebuilds,
    /// through the same index-addressed boundary the pool fill uses.
    #[test]
    fn deferred_restore_matches_the_serial_restore() {
        let mut origin = WasmEngine::new(0x5A5A, 5);
        while origin.fill_step(2) > 0 {}
        let saved = origin.export_session();

        let mut serial = WasmEngine::new(1, 5);
        let n_serial = serial.import_session(&saved);
        assert!(n_serial >= 3, "bank too small to test");

        let mut deferred = WasmEngine::new(1, 5);
        let phrase = deferred.phrase_json();
        let jobs: Vec<serde_json::Value> =
            serde_json::from_str(&deferred.import_session_deferred(&saved)).unwrap();
        assert_eq!(jobs.len(), n_serial);
        for job in &jobs {
            let index = job["i"].as_u64().unwrap() as usize;
            let tree = serde_json::to_string(&job["tree"]).unwrap();
            let mut r = farm_render(&tree, &phrase, false);
            assert!(deferred.bank_absorb(index, &r.cached(), &r.take_samples()));
        }
        assert_eq!(deferred.restore_finish(), n_serial);
        assert_eq!(
            serial.export_session(),
            deferred.export_session(),
            "the deferred restore rebuilt a different session"
        );
    }

    /// Re-issue is stateless: the term at a draw index is recoverable from the
    /// engine alone, so a farm worker that dies mid-job costs its render and
    /// nothing else. Nobody has to have kept the tree JSON.
    #[test]
    fn a_lost_job_is_recoverable_from_its_index_alone() {
        let mut engine = WasmEngine::new(0x1D, 8);
        let wave: Vec<serde_json::Value> = serde_json::from_str(&engine.fill_draw(2)).unwrap();
        for job in &wave {
            let index = job["i"].as_u64().unwrap() as u32;
            let reissued: serde_json::Value =
                serde_json::from_str(&engine.draw_json(index)).expect("re-issued tree JSON");
            assert_eq!(
                reissued, job["tree"],
                "draw {index} could not be re-derived from its index"
            );
        }
        // And it stays true after the pool has moved underneath it: the stream
        // is indexed, not advanced.
        let far = engine.draw_json(37);
        while engine.fill_step(2) > 0 {}
        assert_eq!(engine.draw_json(37), far, "the draw stream advanced");
    }
}
