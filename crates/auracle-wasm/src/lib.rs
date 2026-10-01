//! # auracle-wasm
//!
//! Thin `wasm-bindgen` bindings over [`auracle_session::Engine`] for the web
//! app. Designed to run inside a **Web Worker**: all methods here can take
//! seconds (rendering, MCMC); the main thread only plays transferred audio
//! buffers and draws instrumentation.
//!
//! Animated: [*The sound engine*](https://auracle.alexnodeland.com/docs/films.html#film-dsp) shows the live voices, the patch
//! swap and the render farm; [*Under the hood*](https://auracle.alexnodeland.com/docs/films.html#film-engine) the runtime around them.
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
//!
//! ## Surface added by the September 2026 audit
//!
//! Every method below exists so the app can tell a failure from a no-op. The
//! older methods they sit beside keep their shapes; nothing here removes or
//! changes an existing signature.
//!
//! | method | returns | meaning |
//! |---|---|---|
//! | `import_session_checked(json) -> String` | `{"status":"ok"\|"empty"\|"unparseable","restored":n}` | The serial restore, with a verdict. `unparseable` means **the save must not be overwritten**: the current build could not read it. `empty` is a save that parsed but holds no bank. |
//! | `import_session_deferred_v2(json) -> String` | `{"status":"ok"\|"empty"\|"unparseable","jobs":[{"i":0,"tree":{…}}]}` | The deferred restore, same verdict, `jobs` exactly as `import_session_deferred` returns them (empty unless `ok`). |
//! | `record_duel(a, b, chose_a) -> bool` | `true` iff the vote was recorded | `false` when either id is no longer in the pool (evicted in the undo window); the vote was **dropped** and the UI must say so. |
//! | `record_keep(id, kept) -> bool` | same | same |
//! | `record_stars(id, rating) -> bool` | same | same |
//! | `last_refine_reason() -> String` | `"idle"\|"injected"\|"no_taste"\|"unknown_seed"\|"outside_support"\|"no_move"\|"duplicate"\|"not_admitted"\|"stale"` | Why the last `refine_seed`/`refine_absorb`/`refine_from` returned 0. `stale` means a walk result was offered out of job order or after its generation finished, and changed nothing. `outside_support` is the one to surface: the seed has zero prior mass (a knob past its domain, a tree deeper than the prior can score) and no budget will move it. |
//! | `edit_param(addr, value, is_index) -> bool` | unchanged shape | now also `false` for a non-finite `value`. |
//! | `import_patch(tree_json, name) -> u32` | unchanged shape | now also `0` for a tree over the `validate_tree` ceilings, which every other write route already refused. |
//! | `budget_ceilings() -> String` (free function) | `{"size":24,"depth":6,"mod":3}` | The hand-edit ceilings, read from the grammar rather than restated in the app. |

mod level;
mod live;
pub use live::LivePoly;
// PERFORM's shipped preset wirings: what they were measured from (native
// only — the generator and its currency test use it; the app does not).
#[cfg(not(target_arch = "wasm32"))]
pub mod shipped;

use std::cell::RefCell;
use std::sync::Arc;

use auracle_features::{
    featurize_memo, Audition, CachedFeatures, Features, FeaturizeError, PhraseSpec, RenderMemo,
    VetFailure,
};
use auracle_grammar::{
    apply_struct_op, describe, presets, set_param, validate_tree, ParamValue, PatchGrammarPrior,
    PatchTree, StructOp,
};
use auracle_session::{
    run_walk, BankEntry, EditOutcome, Engine, Origin, PreFeaturized, Profile, RenderPolicy,
    SessionConfig, SessionState, WalkContext, WalkJob, WalkResult,
};
use level::{audition_pcm, live_makeup};
use rand::rngs::StdRng;
use rand::SeedableRng;
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
    /// The log split the way the menu bar's TAUGHT tooltip names it: picks
    /// (every duel, whichever surface it came from), stars, and cuts. Their
    /// sum is `observations` (a cut is the only keep/kill the app records).
    picks: usize,
    stars: usize,
    cuts: usize,
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

/// The structural ceilings a hand-built patch must respect, as JSON
/// `{"size":24,"depth":6,"mod":3}` — `MAX_SIZE`, `MAX_DEPTH`, `MAX_MOD_DEPTH`
/// from the grammar. The app used to restate these as literals, and the two
/// depth ceilings moved when they were derived from the prior's support; a
/// number the engine owns should be read from the engine.
#[wasm_bindgen]
pub fn budget_ceilings() -> String {
    use auracle_grammar::mutate::{MAX_DEPTH, MAX_MOD_DEPTH, MAX_SIZE};
    format!(r#"{{"size":{MAX_SIZE},"depth":{MAX_DEPTH},"mod":{MAX_MOD_DEPTH}}}"#)
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

    /// Serialized `auracle_features::CachedFeatures`: the content key, the
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
    /// conversion. See `auracle_features::Audition`'s one-way-door note.
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
/// The persistent render cache's namespace for `phrase_json`, or `""` if the
/// phrase does not parse.
///
/// Two rows may only be compared, stored or served under the same namespace:
/// it pins the stimulus, [`auracle_features::RENDER_EPOCH`] (the featurizer's
/// own generation) and [`auracle_features::QUIVER_DSP_VERSION`] (the DSP it
/// renders with). A build whose φ differs from the one that wrote a row
/// therefore cannot read it — the namespace simply does not match, so there is
/// no stale-row path to get wrong. The worker also hands it to PERFORM, which
/// stamps the wirings it keeps with it.
///
/// The store this keys is `namespace → key → CachedFeatures`. Dropping a
/// namespace is how a cache is invalidated, and it is the *only* correct
/// granularity: φ moving invalidates everything measured under the old φ.
#[wasm_bindgen]
pub fn cache_namespace(phrase_json: &str) -> String {
    serde_json::from_str::<PhraseSpec>(phrase_json)
        .map(|spec| auracle_features::cache_namespace(&spec))
        .unwrap_or_default()
}

/// The content address of `(tree_json, phrase_json)` **without rendering it** —
/// what a caller asks the persistent cache about before paying for a render.
///
/// Returns `""` if either argument fails to parse, which the caller should
/// treat as a miss rather than an error: the render path validates its own
/// inputs and is the one place allowed to reject them.
#[wasm_bindgen]
pub fn farm_key(tree_json: &str, phrase_json: &str) -> String {
    let (Ok(tree), Ok(spec)) = (
        serde_json::from_str::<PatchTree>(tree_json),
        serde_json::from_str::<PhraseSpec>(phrase_json),
    ) else {
        return String::new();
    };
    auracle_features::render_key(&tree, &spec)
}

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

// ----------------------------------------------------------------------
// Walks on the farm (RFC-001, ADR-007)
// ----------------------------------------------------------------------

thread_local! {
    /// This farm worker's featurization memo, kept between walk jobs. A walk
    /// re-scores the state it stands on every step, and its seed is the first
    /// thing it renders, so a warm memo saves renders; it never changes a
    /// result (a hit is bit-identical to a miss). One per wasm instance: each
    /// farm worker is its own instance.
    static WALK_MEMO: RenderMemo = RenderMemo::default();
    /// The last walk context this worker parsed, with the text it came from.
    /// A generation sends the same context with every job; parsing it once
    /// per worker per generation is the difference between one parse of the
    /// posterior and one per walk. Matched on the whole text, so a new
    /// generation's context is never mistaken for the last one's.
    static WALK_CONTEXT: RefCell<Option<(String, Arc<WalkContext>)>> = const { RefCell::new(None) };
}

/// Run one refinement walk with **no [`Engine`] anywhere in sight** — what a
/// farm worker does with a walk job. `context_json` is the `context` of a
/// `refine_jobs` (or `refine_from_job`) reply and `job_json` one of its jobs,
/// both as sent; returns the `WalkResult` JSON to hand to
/// [`WasmEngine::refine_absorb`] (or `refine_from_absorb`):
///
/// ```json
/// {"generation":3,"index":0,"parent_id":17,"child":{…}|null,
///  "reason":null|"no_move"|"outside_support",
///  "cached":{…}|null}
/// ```
///
/// A pure function of its two arguments: the per-worker memo and the parsed
/// context it keeps only save work. Returns `""` when either argument does not
/// parse, which is a broken caller or instance, not a walk that found nothing:
/// report it as `cannot` and let the engine run the job itself.
#[wasm_bindgen]
pub fn farm_walk(context_json: &str, job_json: &str) -> String {
    let Ok(job) = serde_json::from_str::<WalkJob>(job_json) else {
        return String::new();
    };
    let cached = WALK_CONTEXT.with(|c| {
        c.borrow()
            .as_ref()
            .filter(|(text, _)| text == context_json)
            .map(|(_, ctx)| Arc::clone(ctx))
    });
    let ctx = match cached {
        Some(ctx) => ctx,
        None => {
            let Ok(ctx) = serde_json::from_str::<WalkContext>(context_json) else {
                return String::new();
            };
            let ctx = Arc::new(ctx);
            WALK_CONTEXT.with(|c| {
                *c.borrow_mut() = Some((context_json.to_owned(), Arc::clone(&ctx)));
            });
            ctx
        }
    };
    let result = WALK_MEMO.with(|memo| run_walk(&ctx, &job, memo));
    serde_json::to_string(&result).unwrap_or_default()
}

/// A generation's jobs, as [`WasmEngine::refine_jobs`] replies: the context
/// every walk shares (`null` when there is no taste yet) and the jobs in
/// absorption order. Serialized from this struct, so each tree goes out in
/// its own key order (ADR-002).
#[derive(Serialize)]
struct JobsReply<'a> {
    context: Option<&'a WalkContext>,
    jobs: &'a [WalkJob],
}

/// `⚡ evolve from this` as a job ([`WasmEngine::refine_from_job`]): the
/// context and the one job, or the reason there is none.
#[derive(Serialize)]
struct FromJobReply<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    context: Option<&'a WalkContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    job: Option<&'a WalkJob>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
}

/// A PERFORM reply that carries a tree (a graft, a drift, an offer).
///
/// Serialized from this struct, so the tree goes out through its own
/// `Serialize`, keys in declaration order, as every other path writes it.
/// Through `serde_json::json!` its keys came out sorted (this workspace's
/// serde_json has no `preserve_order`), so the same patch read as two
/// different texts. PERFORM compares trees' text to tell a new structure from
/// new knob values, and after any drift it took Back home for a new patch: B
/// was cleared, the dials reset, and nothing glided. The wiring cache's keys
/// split the same way.
#[derive(Serialize)]
struct TreeReply<'a> {
    tree: &'a PatchTree,
    #[serde(skip_serializing_if = "Option::is_none")]
    knobs: Option<&'a [(String, f64)]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    makeup: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    taste: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    diff: Option<&'a [auracle_grammar::DiffEntry]>,
    /// An aimed offer's move along the control it was asked for, in σ,
    /// positive toward the control's high word
    /// ([`auracle_session::Engine::moved_along`]). Only on a search control's
    /// offer: the Offer button's is not aimed anywhere.
    #[serde(skip_serializing_if = "Option::is_none")]
    moved: Option<f64>,
}

fn tree_reply(r: &TreeReply) -> String {
    serde_json::to_string(r).unwrap_or_else(|_| "null".into())
}

/// The engine's randomness, one stream per consumer.
///
/// It used to be one generator for everything, and anything that drew from it
/// moved every later draw. PERFORM grows a spare offer in the background, and
/// when that finishes depends on the machine, so two identical sessions dealt
/// different duels and fitted different posteriors: the same patch read 0.39 in
/// one and 0.43 in the other. Now fills, duels, evolution and PERFORM each
/// advance only their own stream, so timing in one can't move another. A fit
/// is seeded from the seed and the number of observations, so the same
/// evidence always fits the same posterior. The streams are derived from the
/// session seed (splitmix64), so a seeded session still reproduces exactly.
struct Streams {
    seed: u64,
    /// Pool fills (the draw stream's base seed and the serial fill path).
    fill: StdRng,
    /// Duel pairing.
    duel: StdRng,
    /// Evolution: EVOLVE POOL's walks and ⚡ evolve from this.
    refine: StdRng,
    /// PERFORM: offers (including the spare grown in the background) and
    /// Wander's drift.
    perform: StdRng,
}

impl Streams {
    fn new(seed: u64) -> Self {
        let stream = |tag: u64| StdRng::seed_from_u64(mix_seed(seed, tag));
        Streams {
            seed,
            fill: stream(1),
            duel: stream(2),
            refine: stream(3),
            perform: stream(4),
        }
    }

    /// A fit's generator: a function of the session seed and how many
    /// observations it is fitted on, and of nothing that happened in between.
    fn fit(&self, observations: usize) -> StdRng {
        StdRng::seed_from_u64(mix_seed(mix_seed(self.seed, 5), observations as u64))
    }
}

/// Two words into one well-mixed seed (splitmix64's finalizer over their
/// combination), so streams tagged 1, 2, 3… share no structure.
fn mix_seed(a: u64, b: u64) -> u64 {
    let mut z = a ^ b.wrapping_mul(0x9E37_79B9_7F4A_7C15).rotate_left(17);
    z = z.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// The session engine, wasm-side.
#[wasm_bindgen]
pub struct WasmEngine {
    engine: Engine,
    rng: Streams,
    bench_tree: Option<PatchTree>,
    bench_render: Option<Arc<Audition>>,
    bench_original: Option<u64>,
    bench_vet_ok: bool,
    /// Whether the bench's last vet failed because the render was *silent*
    /// (rather than running away). A patch whose only source socket is
    /// unplugged is a `Silence`-fed chain now, and it fails the vet for being
    /// quiet, which is the truth about it: the app must say "nothing reaches
    /// the output", not the runaway warning it gives every other failure.
    bench_vet_silent: bool,
    /// The live makeup of the bench's last featurization.
    bench_makeup: f64,
    /// Raw φ of the tree on the bench, and of the tree that was on it before
    /// the last featurize.
    ///
    /// The current one is what the live utility readout is computed from: the
    /// bench re-featurizes on every edit regardless, so `θ · φ_std` costs a
    /// dot product and the alternative — a number describing the patch you
    /// loaded rather than the one under your hands — is not cheaper, only
    /// wrong. The previous one exists for the implicit stream: a revert is a
    /// transition, and a transition logged with only one side of it says
    /// nothing about the direction the player moved.
    bench_phi: Option<Vec<f64>>,
    bench_phi_prev: Option<Vec<f64>>,
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
        auracle_features::render_playback(tree, phrase, features.gain_db)
            .ok()
            .map(Arc::new)
    })
}

/// Parse `tree_json` and write the knob `overrides_json` (`[[addr, value]]`)
/// into it. Non-finite values and addresses that are not continuous knobs on
/// this tree are skipped. `None` only if the tree itself does not parse.
/// The ids a deal must not use, from the worker's `Uint32Array`.
fn exclude_ids(exclude: Option<Vec<u32>>) -> Vec<u64> {
    exclude
        .unwrap_or_default()
        .into_iter()
        .map(u64::from)
        .collect()
}

fn performed_tree(tree_json: &str, overrides_json: &str) -> Option<PatchTree> {
    let mut tree = serde_json::from_str::<PatchTree>(tree_json).ok()?;
    let overrides: Vec<(String, f64)> = serde_json::from_str(overrides_json).unwrap_or_default();
    for (addr, v) in overrides {
        if !v.is_finite() {
            continue;
        }
        let v = v.clamp(0.0, auracle_session::perform::KNOB_MAX);
        if let Ok(t) = auracle_grammar::edit::set_param(
            &tree,
            &addr,
            auracle_grammar::edit::ParamValue::Continuous(v),
        ) {
            tree = t;
        }
    }
    Some(tree)
}

/// Did a featurize fail because the render was silent? The one vet failure
/// that is not a hazard: an unplugged socket, not a runaway.
fn is_silent(e: &FeaturizeError) -> bool {
    matches!(e, FeaturizeError::Quarantined(VetFailure::Silent { .. }))
}

/// A JSON array of memo keys as a set; empty for anything else.
fn key_set(json: &str) -> std::collections::HashSet<String> {
    serde_json::from_str::<Vec<String>>(json)
        .unwrap_or_default()
        .into_iter()
        .collect()
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
            rng: Streams::new(seed),
            bench_tree: None,
            bench_render: None,
            bench_original: None,
            bench_vet_ok: false,
            bench_vet_silent: false,
            bench_makeup: 1.0,
            bench_phi: None,
            bench_phi_prev: None,
            pending_bank: Vec::new(),
        }
    }

    /// Loudness-makeup linear gain for live playback of candidate `id`
    /// (evens patches out to the audition target; see `level`). 1.0 for
    /// unknown ids.
    pub fn makeup_of(&self, id: u32) -> f64 {
        self.engine
            .find(id as u64)
            .map(|i| live_makeup(&self.engine.pool[i].features))
            .unwrap_or(1.0)
    }

    /// Loudness-makeup linear gain for the current workbench tree.
    pub fn edit_makeup(&self) -> f64 {
        self.bench_makeup
    }

    /// Add up to `max_new` vetted candidates. Returns how many were added,
    /// so the worker can post fill progress between calls.
    ///
    /// The serial path, and the fallback whenever no farm is available. It
    /// folds the same indexed draw stream `fill_draw`/`fill_absorb` fold, so
    /// the pool it builds is the pool the farm builds.
    pub fn fill_step(&mut self, max_new: usize) -> usize {
        self.engine.fill_pool_step(&mut self.rng.fill, max_new)
    }

    // ------------------------------------------------------------------
    // Render farm (see `auracle_session::farm`)
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
        self.engine.ensure_fill_seed(&mut self.rng.fill);
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
    ///
    /// `"[]"` for a save this build cannot parse **and** for one with an empty
    /// bank; [`WasmEngine::import_session_deferred_v2`] tells the two apart.
    pub fn import_session_deferred(&mut self, json: &str) -> String {
        let Ok(state) = serde_json::from_str::<SessionState>(json) else {
            return "[]".into();
        };
        let jobs = self.begin_deferred_import(state);
        serde_json::to_string(&jobs).unwrap_or_else(|_| "[]".into())
    }

    /// [`WasmEngine::import_session_deferred`] with a verdict the caller can
    /// act on: JSON `{"status":"ok"|"empty"|"unparseable","jobs":[…]}`.
    ///
    /// The old method returns `"[]"` both for a save this build cannot parse
    /// and for a save with nothing in it, and the app treated both as "nothing
    /// to restore" — then autosaved a fresh session over the one it could not
    /// read. `unparseable` is the answer that must stop that write. `jobs` is
    /// exactly what the old method returns, and is empty unless `ok`.
    pub fn import_session_deferred_v2(&mut self, json: &str) -> String {
        let (status, jobs) = match serde_json::from_str::<SessionState>(json) {
            Err(_) => ("unparseable", Vec::new()),
            Ok(state) => {
                let jobs = self.begin_deferred_import(state);
                (if jobs.is_empty() { "empty" } else { "ok" }, jobs)
            }
        };
        serde_json::json!({ "status": status, "jobs": jobs }).to_string()
    }

    /// The shared body of both deferred imports: adopt the state, open a
    /// session, return the bank as farm jobs in bank order.
    fn begin_deferred_import(&mut self, state: SessionState) -> Vec<serde_json::Value> {
        self.pending_bank = self.engine.import_state_deferred(state);
        self.engine.begin_session();
        self.pending_bank
            .iter()
            .enumerate()
            .map(|(i, e)| serde_json::json!({ "i": i, "tree": e.tree }))
            .collect()
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
        let taught = self
            .engine
            .log
            .observations
            .iter()
            .fold((0, 0, 0), |(p, s, c), o| match o.feedback {
                auracle_taste::Feedback::Duel { .. } => (p + 1, s, c),
                auracle_taste::Feedback::Stars { .. } => (p, s + 1, c),
                auracle_taste::Feedback::KeepKill { .. } => (p, s, c + 1),
            });
        serde_json::to_string(&Status {
            pool: self.engine.pool.len(),
            pool_target: self.engine.cfg.pool_size,
            observations: self.engine.log.len(),
            picks: taught.0,
            stars: taught.1,
            cuts: taught.2,
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
            .next_duel(&mut self.rng.duel)
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
    /// about θ in nats (max `ln 2 ≈ 0.693`). `method` is `"random"` (the
    /// default rule deals every pair at random, and so does any rule before
    /// the first fit), `"check"` (a scheduled random probe under a choosing
    /// rule, worth labelling in the UI since the model is deliberately not
    /// choosing it), `"thompson"` or `"bald"`.
    ///
    /// `exclude` lists candidate ids that must not be dealt (the patches the
    /// player has cut); omitted, every standardized candidate may be.
    ///
    /// The pair counts as shown at once. The app, which deals ahead and
    /// throws some deals away, uses [`WasmEngine::deal_duel_ex`] and
    /// [`WasmEngine::duel_shown`] instead.
    pub fn next_duel_ex(&mut self, exclude: Option<Vec<u32>>) -> String {
        let exclude = exclude_ids(exclude);
        let choice = self.engine.next_duel_except(&mut self.rng.duel, &exclude);
        self.duel_json(choice)
    }

    /// [`WasmEngine::next_duel_ex`] without counting the pair as shown: the
    /// caller says when it puts the pair in front of the player
    /// ([`WasmEngine::duel_shown`]). A deal thrown away unseen then moves
    /// nothing — not the check cadence the calibration sample is paced by,
    /// not the repeat and exposure penalties. Same JSON, same random stream.
    pub fn deal_duel_ex(&mut self, exclude: Option<Vec<u32>>) -> String {
        let exclude = exclude_ids(exclude);
        let choice = self.engine.deal_duel_except(&mut self.rng.duel, &exclude);
        self.duel_json(choice)
    }

    /// The pair `a`, `b` (ids, either order), dealt by
    /// [`WasmEngine::deal_duel_ex`], is on the table now. False, counting
    /// nothing, for a pair not dealt or already reported (a retracted pick's
    /// pair put back up is not shown twice).
    pub fn duel_shown(&mut self, a: u32, b: u32) -> bool {
        self.engine.duel_shown(u64::from(a), u64::from(b))
    }

    fn duel_json(&self, choice: Option<auracle_session::DuelChoice>) -> String {
        #[derive(Serialize)]
        struct Row {
            a: u64,
            b: u64,
            info_gain: f64,
            random_check: bool,
            method: &'static str,
        }
        match choice {
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

    /// The audition buffer of candidate `id` (mono, ±1.0), for WebAudio: the
    /// stored audition at the level it is played at (`level::audition_pcm`),
    /// never the stored buffer itself.
    ///
    /// **`&mut self`, and it can take a render.** Under the lazy policy this
    /// engine boots with, the buffer is materialized here on first request
    /// rather than retained from the fill. An **empty** return means the term
    /// no longer renders (a restored bank can outlive the DSP that made it) —
    /// callers must treat it as a failure and stop waiting, not as "not yet".
    pub fn render_of(&mut self, id: u32) -> Vec<f32> {
        self.engine
            .render_of(id as u64)
            .map(|a| audition_pcm(&a))
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

    /// Record a duel outcome between candidate ids. Returns `false` — and
    /// records **nothing** — when either id is no longer in the pool.
    ///
    /// That happens: a duel side can be evicted by an evolve, a preset load or
    /// an import inside the undo window, and the vote then arrives for a patch
    /// that is gone. It used to vanish silently while the app counted it as
    /// taken and toasted "rated"; a dropped vote is the app's to report.
    pub fn record_duel(&mut self, a: u32, b: u32, chose_a: bool) -> bool {
        let (a, b) = (a as u64, b as u64);
        match (self.engine.find(a), self.engine.find(b)) {
            (Some(i), Some(j)) if i != j => {
                self.engine.record_duel(i, j, chose_a);
                true
            }
            _ => false,
        }
    }

    /// Record a keep/kill decision on a candidate id. `false` (nothing
    /// recorded) for an id no longer in the pool.
    pub fn record_keep(&mut self, id: u32, kept: bool) -> bool {
        match self.engine.find(id as u64) {
            Some(i) => {
                self.engine.record_keep(i, kept);
                true
            }
            None => false,
        }
    }

    /// Record a star rating on a candidate id. `false` (nothing recorded) for
    /// an id no longer in the pool.
    pub fn record_stars(&mut self, id: u32, rating: u8) -> bool {
        match self.engine.find(id as u64) {
            Some(i) => {
                self.engine.record_stars(i, rating);
                true
            }
            None => false,
        }
    }

    /// Re-fit the taste posterior from the log (seconds of MCMC — worker!).
    pub fn fit(&mut self) {
        let mut rng = self.rng.fit(self.engine.log.len());
        self.engine.fit_posterior(&mut rng);
    }

    /// One whole generation of taste-guided refinement, serially (renders —
    /// worker!). The same jobs, walk and absorption as the farm path.
    pub fn refine(&mut self) {
        self.engine.refine(&mut self.rng.refine);
    }

    /// Open a generation with its jobs kept in the engine; returns the parent
    /// ids to refine from as a JSON array, in job order, or `[]` if there is
    /// no taste to refine toward yet (in which case no generation is opened).
    ///
    /// The serial driver: pair it with [`WasmEngine::refine_seed`] to run the
    /// generation one walk at a time in this worker and show progress. The
    /// farm driver is [`WasmEngine::refine_jobs`].
    pub fn refine_begin(&mut self) -> String {
        serde_json::to_string(&self.engine.refine_begin(&mut self.rng.refine))
            .unwrap_or_else(|_| "[]".into())
    }

    /// Run the open generation's job for `parent_id` here and absorb it.
    /// Returns the child id, or 0 with the reason in
    /// [`WasmEngine::last_refine_reason`]. Also the fallback for a job the
    /// farm could not run: it runs the next job with that parent, skipping any
    /// earlier job never absorbed.
    pub fn refine_seed(&mut self, parent_id: u32) -> u32 {
        self.engine.refine_seed(parent_id as u64).unwrap_or(0) as u32
    }

    /// Open a generation as data, for the render farm:
    ///
    /// ```json
    /// {"context":{"prior":{…},"posterior":{…},"standardizer":{…},
    ///             "phrase":{…},"beta":2.0,"refine_keep":"last"},
    ///  "jobs":[{"generation":3,"index":0,"parent_id":17,"seed":{…},
    ///           "locked":[],"steps":40,"rng_seed":123456789}, …]}
    /// ```
    ///
    /// `context` is `null` (and `jobs` empty) when there is no taste yet; no
    /// generation is opened then. Any generation still open is finished
    /// first. Send `context` to each farm worker once and each job to one of
    /// them ([`farm_walk`]); `rng_seed` is at most 2⁵³ − 1, so a job survives
    /// `JSON.parse`/`JSON.stringify` unchanged. The context is the heavy half
    /// (the posterior's draws): `auracle-session`'s `walk_payload` example
    /// measures it.
    pub fn refine_jobs(&mut self) -> String {
        let opened = self.engine.refine_jobs(&mut self.rng.refine);
        let reply = match &opened {
            Some((ctx, jobs)) => JobsReply {
                context: Some(ctx),
                jobs,
            },
            None => JobsReply {
                context: None,
                jobs: &[],
            },
        };
        serde_json::to_string(&reply).unwrap_or_else(|_| r#"{"context":null,"jobs":[]}"#.into())
    }

    /// Absorb one walk's result (`farm_walk`'s reply) into the open
    /// generation. Returns the child id, or 0 with the reason in
    /// [`WasmEngine::last_refine_reason`].
    ///
    /// Strictly in job order: a result that is not the next job's reads
    /// `"stale"` and changes nothing — hold it and absorb it in its turn. A
    /// result that does not parse returns 0 and leaves the generation waiting
    /// for that job (run it with [`WasmEngine::refine_seed`]). Absorbing the
    /// last job finishes the generation and retires what the children
    /// displaced; nothing is retired before that.
    pub fn refine_absorb(&mut self, result_json: &str) -> u32 {
        let Ok(result) = serde_json::from_str::<WalkResult>(result_json) else {
            return 0;
        };
        self.engine.refine_absorb(result).unwrap_or(0) as u32
    }

    /// Stop (or close) the open generation: the children absorbed so far stay,
    /// the lowest unpinned members are retired until the pool is back to size,
    /// and results still in flight will read `"stale"`. Returns the retired
    /// ids as a JSON array, lowest first. Idempotent.
    pub fn refine_finish(&mut self) -> String {
        serde_json::to_string(&self.engine.refine_finish()).unwrap_or_else(|_| "[]".into())
    }

    /// The ids the last generation to finish retired, lowest first, as a JSON
    /// array — including a finish that happened on its last
    /// [`WasmEngine::refine_absorb`]. They are no longer in the bank.
    pub fn refine_retired(&self) -> String {
        serde_json::to_string(self.engine.retired()).unwrap_or_else(|_| "[]".into())
    }

    /// The ids the end of the running generation would retire if it ended
    /// now, lowest first, as a JSON array — the rows a save would rescue.
    /// `[]` when the pool is not over size.
    pub fn refine_retiring(&self) -> String {
        serde_json::to_string(&self.engine.retiring()).unwrap_or_else(|_| "[]".into())
    }

    /// Locked refinement from candidate `id`: evolve everything except the
    /// locked addresses (`locked_json` = JSON array of `key#site` strings).
    /// Returns the new child id, or 0 with the reason in
    /// [`WasmEngine::last_refine_reason`]. Runs the walk in this worker; the
    /// farm path is [`WasmEngine::refine_from_job`].
    pub fn refine_from(&mut self, id: u32, locked_json: &str) -> u32 {
        let id = id as u64;
        let locked: Vec<String> = serde_json::from_str(locked_json).unwrap_or_default();
        self.engine
            .refine_from(&mut self.rng.refine, id, &locked)
            .unwrap_or(0) as u32
    }

    /// `⚡ evolve from this` as one farm job: `{"context":{…},"job":{…}}`
    /// (shapes as [`WasmEngine::refine_jobs`]), or `{"reason":"unknown_seed"}`
    /// / `{"reason":"no_taste"}`. Walk it with [`farm_walk`] and hand the
    /// result to [`WasmEngine::refine_from_absorb`] with the same `id`.
    pub fn refine_from_job(&mut self, id: u32, locked_json: &str) -> String {
        let locked: Vec<String> = serde_json::from_str(locked_json).unwrap_or_default();
        let made = self
            .engine
            .refine_from_job(&mut self.rng.refine, id as u64, &locked);
        let reply = match &made {
            Ok((ctx, job)) => FromJobReply {
                context: Some(ctx),
                job: Some(job),
                reason: None,
            },
            Err(reason) => FromJobReply {
                context: None,
                job: None,
                reason: Some(reason.as_str()),
            },
        };
        serde_json::to_string(&reply).unwrap_or_else(|_| r#"{"reason":"no_taste"}"#.into())
    }

    /// Walk the job [`WasmEngine::refine_from_job`] dealt for seed `id` here,
    /// in this worker, and absorb it: the child a farm worker would breed from
    /// that job. The worker draws the job before it knows whether a crew will
    /// come up, so a request that arrives meanwhile cannot draw first; this is
    /// how the job is walked when none does. Returns the child id, or 0 with
    /// the reason in [`WasmEngine::last_refine_reason`] (`"unknown_seed"`
    /// when no job for `id` is in flight).
    pub fn refine_from_walk(&mut self, id: u32) -> u32 {
        self.engine.refine_from_walk(id as u64).unwrap_or(0) as u32
    }

    /// Drop the ⚡ job in flight for seed `id` (a stop): its seed may be
    /// replaced again. Until its result is absorbed or it is dropped, the seed
    /// of a ⚡ walk is never evicted. Returns whether one was in flight.
    pub fn refine_from_cancel(&mut self, id: u32) -> bool {
        self.engine.refine_from_cancel(id as u64)
    }

    /// Absorb the walk of a [`WasmEngine::refine_from_job`] for seed `id`.
    /// Returns the child id, or 0 with the reason in
    /// [`WasmEngine::last_refine_reason`] (a result that does not parse
    /// returns 0 and changes nothing). With no generation running the child
    /// is a generation of its own and what it displaced is retired at once;
    /// during a generation it joins it, its seed spared by the finish.
    pub fn refine_from_absorb(&mut self, id: u32, result_json: &str) -> u32 {
        let Ok(result) = serde_json::from_str::<WalkResult>(result_json) else {
            return 0;
        };
        self.engine
            .refine_from_absorb(id as u64, result)
            .unwrap_or(0) as u32
    }

    // ---- performance (see `auracle_session::perform`) ----

    /// Measure the audio Jacobian of the performed state (`tree` plus knob
    /// `overrides`) and wire the named controls onto it.
    /// Returns `{addrs, values, z, wiring: [Wiring]}` as JSON, or `null` when
    /// the session has no standardizer yet or the tree does not vet. Costs one
    /// render per continuous knob, through the memo.
    pub fn perform_wire(&self, tree_json: &str, overrides_json: &str) -> String {
        let Some(tree) = performed_tree(tree_json, overrides_json) else {
            return "null".into();
        };
        let Some((jac, wiring)) = self.engine.wire_controls(&tree) else {
            return "null".into();
        };
        serde_json::json!({
            "addrs": jac.addrs,
            "values": jac.values,
            "z": jac.z,
            "wiring": wiring,
        })
        .to_string()
    }

    /// The renders [`Self::perform_wire`] on this performed state would make
    /// next and the memo does not hold: JSON `[{"key", "tree"}]` (`tree` as
    /// JSON text, ready for a farm job), empty when the measurement can be
    /// finished from the memo — see `Engine::wire_plan`. `failed_json` is a
    /// JSON array of the keys already known not to vet. Renders nothing, so
    /// it is cheap enough to ask between the player's requests.
    pub fn perform_wire_plan(
        &self,
        tree_json: &str,
        overrides_json: &str,
        failed_json: &str,
    ) -> String {
        let Some(tree) = performed_tree(tree_json, overrides_json) else {
            return "[]".into();
        };
        let failed = key_set(failed_json);
        let need: Vec<serde_json::Value> = self
            .engine
            .wire_plan(&tree, &failed)
            .into_iter()
            .map(|(key, t)| {
                serde_json::json!({
                    "key": key,
                    "tree": serde_json::to_string(&t).unwrap_or_default(),
                })
            })
            .collect();
        serde_json::to_string(&need).unwrap_or_else(|_| "[]".into())
    }

    /// [`Self::perform_wire`], skipping the renders `failed_json` names as
    /// known not to vet (the memo keeps only successes). Once
    /// [`Self::perform_wire_plan`] answers `[]`, this renders nothing; the
    /// answer is the one `perform_wire` would give.
    pub fn perform_wire_known(
        &self,
        tree_json: &str,
        overrides_json: &str,
        failed_json: &str,
    ) -> String {
        let Some(tree) = performed_tree(tree_json, overrides_json) else {
            return "null".into();
        };
        let Some((jac, wiring)) = self
            .engine
            .wire_controls_known(&tree, &key_set(failed_json))
        else {
            return "null".into();
        };
        serde_json::json!({
            "addrs": jac.addrs,
            "values": jac.values,
            "z": jac.z,
            "wiring": wiring,
        })
        .to_string()
    }

    /// The knobs of `tree_json` the voices can take live, as `[[addr, value],
    /// …]` (`auracle_session::perform::live_knobs`): a compile, no render.
    /// Rides with a tree on its way to the voices, so PERFORM can keep playing
    /// a taken offer on the wiring it had until the offer's own measurement
    /// lands — it needs the new tree's knob values to centre on, and which of
    /// the old wiring's addresses the new tree still has. `[]` if the tree
    /// does not parse or compile.
    pub fn perform_knobs(&self, tree_json: &str) -> String {
        let Ok(tree) = serde_json::from_str::<PatchTree>(tree_json) else {
            return "[]".into();
        };
        let knobs = auracle_session::perform::live_knobs(&tree, self.engine.cfg.phrase.sample_rate);
        serde_json::to_string(&knobs).unwrap_or_else(|_| "[]".into())
    }

    /// Featurize one tree into the engine's memo, φ only: the unit a
    /// measurement is paid in when it is paid here, one render per turn, so
    /// the thread answers the player between renders. False when the tree does
    /// not parse or does not vet.
    pub fn memo_render(&self, tree_json: &str) -> bool {
        let Ok(tree) = serde_json::from_str::<PatchTree>(tree_json) else {
            return false;
        };
        featurize_memo(&tree, &self.engine.cfg.phrase, self.engine.memo(), false).is_ok()
    }

    /// Fold a farm featurization (`farm_render`'s `cached`) of `tree_json`
    /// into the engine's memo. Checked, not trusted, as the pool's farm path
    /// is ([`Self::pre_featurized`]): a row whose key is not this tree's under
    /// this engine's stimulus is refused, so a farm on another build or
    /// another phrase can cost a render but never a wrong φ.
    pub fn memo_absorb(&self, tree_json: &str, cached_json: &str) -> bool {
        let (Ok(tree), Ok(cached)) = (
            serde_json::from_str::<PatchTree>(tree_json),
            serde_json::from_str::<CachedFeatures>(cached_json),
        ) else {
            return false;
        };
        if cached.key != auracle_features::render_key(&tree, &self.engine.cfg.phrase) {
            return false;
        }
        self.engine.memo().put(cached, None);
        true
    }

    /// The performed state (`tree` plus `overrides`) with the module that
    /// gives named control `k` something to turn grafted onto its output
    /// ([`auracle_session::perform::graft_for`]): `{tree}`, or `{reason:
    /// "no_graft"}` when there is none to give, or `null` if the tree does
    /// not parse. Renders nothing; the page commits the tree and re-measures.
    pub fn perform_graft(&self, tree_json: &str, overrides_json: &str, k: u32) -> String {
        let Some(tree) = performed_tree(tree_json, overrides_json) else {
            return "null".into();
        };
        match auracle_session::perform::graft_for(&tree, k as usize) {
            Some(t) => tree_reply(&TreeReply {
                tree: &t,
                knobs: None,
                makeup: None,
                taste: None,
                diff: None,
                moved: None,
            }),
            None => serde_json::json!({ "reason": "no_graft" }).to_string(),
        }
    }

    /// A PERFORM offer answered: the performed state (`tree` plus
    /// `overrides`) against the `offer` tree, heard both ways, with
    /// `took_offer` saying which the player kept. Recorded as a duel tagged
    /// `perform_offer` ([`auracle_session::Engine::record_tree_duel`]; A is
    /// the performed sound). Returns whether it was recorded.
    pub fn perform_record(
        &mut self,
        tree_json: &str,
        overrides_json: &str,
        offer_json: &str,
        took_offer: bool,
    ) -> bool {
        let (Some(home), Ok(offer)) = (
            performed_tree(tree_json, overrides_json),
            serde_json::from_str::<PatchTree>(offer_json),
        ) else {
            return false;
        };
        self.engine.record_tree_duel(
            &home,
            &offer,
            !took_offer,
            auracle_taste::Provenance::PerformOffer,
        )
    }

    /// `tree` with knob `overrides` (`[[addr, value], …]`) written into its
    /// genome, as JSON; `null` if the tree does not parse. Unknown or
    /// structural addresses are skipped rather than failing the whole write:
    /// the performance surface writes the knobs it wired, and a patch that
    /// changed underneath it should lose those writes, not the others.
    pub fn perform_apply(&self, tree_json: &str, overrides_json: &str) -> String {
        match performed_tree(tree_json, overrides_json) {
            Some(t) => serde_json::to_string(&t).unwrap_or_else(|_| "null".into()),
            None => "null".into(),
        }
    }

    /// One knob-only drift from the performed state (`tree` plus
    /// `overrides`) on the taste target: a local walk of `steps` moves of
    /// size `sigma` (on a knob's 0–1 range) over the live knobs, structure and
    /// the player's `locks_json` held fixed. Returns `{tree, knobs: [[addr, value], …],
    /// taste}`, or `{reason}` ([`Self::last_refine_reason`]'s spellings:
    /// `no_move`, `outside_support`) when there is nothing to glide to, or
    /// `null` if the tree does not parse. With no
    /// posterior yet the walk still runs, on the prior alone (`taste: false`):
    /// the grammar's own idea of a nearby sound. Inserts nothing into the
    /// pool.
    pub fn perform_drift(
        &mut self,
        tree_json: &str,
        overrides_json: &str,
        locks_json: &str,
        steps: u32,
        sigma: f64,
    ) -> String {
        let Some(tree) = performed_tree(tree_json, overrides_json) else {
            return "null".into();
        };
        let locks: Vec<String> = serde_json::from_str(locks_json).unwrap_or_default();
        match self.engine.drift(
            &mut self.rng.perform,
            &tree,
            &locks,
            steps.max(1) as usize,
            sigma,
        ) {
            Ok(t) => {
                let knobs =
                    auracle_session::perform::live_knobs(&t, self.engine.cfg.phrase.sample_rate);
                tree_reply(&TreeReply {
                    tree: &t,
                    knobs: Some(&knobs),
                    makeup: None,
                    taste: Some(self.engine.has_taste()),
                    diff: None,
                    moved: None,
                })
            }
            Err(why) => serde_json::json!({ "reason": why.as_str() }).to_string(),
        }
    }

    /// A structural offer from the performed state: the locked walk with only
    /// the player's locks. Returns `{tree, makeup, taste, diff}` — makeup so the
    /// offer is heard at matched loudness, taste as for [`Self::perform_drift`]
    /// — or `{reason}` / `null` as there. Inserts nothing into the pool.
    ///
    /// With `control` (a named control's index, [`auracle_session::perform::CONTROLS`]
    /// order) the offer is a search control's, aimed along that control's
    /// direction, up for a positive `sign` and down otherwise
    /// ([`auracle_session::Engine::offer_toward`]), and the reply adds `moved`:
    /// how far the offer went that way, in σ, positive toward the control's
    /// high word — so the page can say "grittier by 0.8σ", or that it did not
    /// move that way. Without `control` it is the Offer button's undirected
    /// walk, and there is no `moved`.
    pub fn perform_offer(
        &mut self,
        tree_json: &str,
        overrides_json: &str,
        locks_json: &str,
        steps: u32,
        control: Option<u32>,
        sign: Option<f64>,
    ) -> String {
        let Some(tree) = performed_tree(tree_json, overrides_json) else {
            return "null".into();
        };
        let locks: Vec<String> = serde_json::from_str(locks_json).unwrap_or_default();
        let steps = steps.max(1) as usize;
        let rng = &mut self.rng.perform;
        let grown = match control {
            Some(k) => {
                let s = sign.unwrap_or(1.0);
                self.engine
                    .offer_toward(rng, &tree, &locks, steps, k as usize, s)
            }
            None => self.engine.offer(rng, &tree, &locks, steps),
        };
        let t = match grown {
            Ok(t) => t,
            Err(why) => return serde_json::json!({ "reason": why.as_str() }).to_string(),
        };
        let makeup = featurize_memo(&t, &self.engine.cfg.phrase, self.engine.memo(), false)
            .map(|(cf, _)| live_makeup(&cf.features))
            .unwrap_or(1.0);
        // What changed, so the B strip can say it ("+chorus, cutoff 448 Hz→1.2
        // kHz") instead of only "an offer is waiting".
        let diff = auracle_grammar::tree_diff(&tree, &t);
        let moved = control.and_then(|k| self.engine.moved_along(&tree, &t, k as usize));
        tree_reply(&TreeReply {
            tree: &t,
            knobs: None,
            makeup: Some(makeup),
            taste: Some(self.engine.has_taste()),
            diff: Some(&diff),
            moved,
        })
    }

    /// Why the most recent `refine_seed`/`refine_from` returned what it did,
    /// as one of `idle`, `injected`, `no_taste`, `unknown_seed`,
    /// `outside_support`, `no_move`, `duplicate`, `not_admitted`.
    ///
    /// The one worth a sentence in the UI is `outside_support`: the seed has
    /// zero mass under the grammar prior — a knob past its domain, a tree
    /// deeper than the prior can score — so the walk never started, and no
    /// amount of budget or lock-loosening will change that. Until this
    /// existed it was indistinguishable from `no_move`.
    pub fn last_refine_reason(&self) -> String {
        self.engine.last_refine().as_str().into()
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

    /// The belief as it stands, as JSON: what the worker posts after every
    /// pick (as `ratings`, since `belief` in `main.js` is the bench's guess),
    /// so the app's ratings and map can move per pick and not only on a
    /// refit.
    ///
    /// ```json
    /// {"ranked":[{"id":12,"mean":0.84,"std":0.31,"style":1}, …],
    ///  "seeds":[12,7,31, …],
    ///  "may_replace":[40,3, …]}
    /// ```
    ///
    /// `ranked` is [`WasmEngine::ranked`]'s rows and order with the numbers
    /// only, plus `style`, the lens the map colors the member by. Each number
    /// is under the posterior the engine holds now: a pick reweights the
    /// draws between refits, and these are the reweighted summaries, the
    /// same ones a refit's `ranked` and `taste_map` would show. `seeds` are
    /// the parents EVOLVE POOL would refine from if pressed now, best first,
    /// exactly as [`WasmEngine::refine_jobs`] would choose them (`[]` before
    /// the first fit). `may_replace` are the members that generation could
    /// retire, lowest first: no other member can leave at its end unless
    /// something else changes the pool meanwhile. It includes members the
    /// app has cut, which the engine does not know about.
    pub fn belief(&self) -> String {
        serde_json::to_string(&self.engine.belief())
            .unwrap_or_else(|_| r#"{"ranked":[],"seeds":[],"may_replace":[]}"#.into())
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

    /// The standardizer's per-coordinate scale, as `{"n_filter":1.42,…}`
    /// (`{}` before one is fitted).
    ///
    /// θ lives in standardized space and everything that has ever been shown
    /// to the user lived there with it, which was fine while the only claim
    /// being made was "this coefficient is positive". Pricing a placement is a
    /// different claim: adding one filter is a **raw** unit step in
    /// `n_filter`, and turning that into a utility needs the divisor that
    /// carried it into z-scores. Without it the client can render θ and cannot
    /// render what θ is worth.
    ///
    /// Names rather than a bare vector, because the client already keys every
    /// module to its coordinate *by name* (`MODULES[k].phi`) and an index
    /// agreement across the wasm boundary is a silent-drift bug waiting for
    /// the next φ column to land. Mean is deliberately absent: a **delta** is
    /// invariant to it, so shipping it would only invite someone to use it.
    pub fn phi_scale(&self) -> String {
        let Some(sz) = &self.engine.standardizer else {
            return "{}".into();
        };
        let map: std::collections::BTreeMap<&'static str, f64> = Features::phi_names()
            .into_iter()
            .zip(sz.std.iter().copied())
            .collect();
        serde_json::to_string(&map).unwrap_or_else(|_| "{}".into())
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
        let rows: Vec<Row> = auracle_grammar::preset_bank()
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

    /// [`Self::load_preset`] for a caller about to play it — a warm-start ▶.
    ///
    /// Hearing a preset used to cost two full phrase renders back to back:
    /// one to featurize it into the pool, which keeps φ and drops the audio
    /// (the pool is `RenderPolicy::Lazy`), and a second for the `render` that
    /// followed, of the very same phrase. Featurizing with audio first keeps
    /// the buffer in the memo's audio tier, where `render_of` finds it, so the
    /// ▶ waits on one render instead of two. Nothing else differs: the insert
    /// is a φ hit on the same featurization.
    pub fn load_preset_heard(&mut self, index: usize) -> u32 {
        let all = presets();
        let Some((name, tree)) = all.into_iter().nth(index) else {
            return 0;
        };
        // Before the standardizer exists the insert refuses, and a render
        // made for it would be a render made for nothing.
        if self.engine.standardizer.is_some() {
            let _ = featurize_memo(&tree, &self.engine.cfg.phrase, self.engine.memo(), true);
        }
        self.engine.insert_preset(tree, name).unwrap_or(0) as u32
    }

    // ------------------------------------------------------------------
    // Workbench (the interactive panel)
    // ------------------------------------------------------------------

    /// Import a shared patch (tree JSON + optional name) into the bank.
    /// Returns the new id, or 0 (bad JSON / over the ceilings / duplicate /
    /// vet failure).
    pub fn import_patch(&mut self, tree_json: &str, name: &str) -> u32 {
        let Ok(mut tree) = serde_json::from_str::<PatchTree>(tree_json) else {
            return 0;
        };
        // A shared file is untrusted input by definition, and the pictures
        // already in circulation carry whatever the build that wrote them had
        // on the bench — including `1e30`. Repair on the way in, so an imported
        // patch cannot reintroduce a fault the session has just been mended of.
        tree.clamp_domains();
        // Same split as `finish()` and `edit_set_tree_apply`: domains repaired,
        // ceilings refused. This was the one write route without the check,
        // and `commit_edit` always lands a hand edit — so a depth-40 tree from
        // a shared file went straight into the pool, evicted a member, and
        // put its out-of-range φ into the log on the next vote.
        if validate_tree(&tree).is_err() {
            return 0;
        }
        match self.engine.commit_edit(None, tree, EditOutcome::Untold) {
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
                self.bench_makeup = live_makeup(&self.engine.pool[i].features);
                // Materializes the buffer if the lazy pool had let it go: the
                // panel shows a scope the moment it opens, so the bench must
                // never start empty for a candidate that renders fine.
                self.bench_render = self.engine.render_of(id);
                self.bench_original = Some(id);
                // A different patch entirely: nothing about the last one's φ
                // is a "before" for anything this one does.
                self.bench_phi = Some(self.engine.pool[i].features.phi());
                self.bench_phi_prev = None;
                // A pool member vetted when it was admitted, but a bank
                // restored across a DSP change can hold a term that no longer
                // renders — and `bench_vet_ok` is what gates commit *and*
                // playback. Take it from whether a buffer actually exists,
                // not from the fact that this id is in the pool.
                self.bench_vet_ok = self.bench_render.is_some();
                self.bench_vet_silent = false;
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
        // `f64::clamp` passes NaN through, and a NaN knob would then be
        // written into the tree, featurized, and logged. Refuse it here, where
        // it is still a rejected gesture and not evidence.
        if !value.is_finite() {
            return false;
        }
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
                        self.bench_makeup = live_makeup(&cf.features);
                        self.bench_render = bench_audio(&edited, &phrase, &cf.features, audio);
                        self.bench_vet_ok = true;
                        self.bench_vet_silent = false;
                        self.set_bench_phi(Some(cf.features.phi()));
                    }
                    Err(e) => {
                        // Keep the edit (the user asked for it) but flag it:
                        // the buffer is withheld, never played unvetted.
                        self.bench_render = None;
                        self.bench_vet_ok = false;
                        self.bench_vet_silent = is_silent(&e);
                        self.set_bench_phi(None);
                    }
                }
                self.bench_tree = Some(edited);
                true
            }
            Err(_) => false,
        }
    }

    /// Adopt a structural edit (replace/insert/delete/set_mod/swap_mix, as
    /// JSON — see `auracle_grammar::StructOp`) **without** re-rendering.
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
        // Domains are repaired, ceilings are refused, and the split is the same
        // one `finish()` makes: a knob outside its range has one obviously
        // right answer and a 40-node patch does not. It matters here because a
        // rewrite is computed from the tree already on the bench — so if that
        // tree came out of a session written before this gate, refusing would
        // mean the player cannot edit their way out of the corruption, only
        // look at it.
        tree.clamp_domains();
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
                self.bench_makeup = live_makeup(&cf.features);
                self.bench_render = bench_audio(&tree, &phrase, &cf.features, audio);
                self.bench_vet_ok = true;
                self.bench_vet_silent = false;
                self.set_bench_phi(Some(cf.features.phi()));
            }
            Err(e) => {
                self.bench_render = None;
                self.bench_vet_ok = false;
                self.bench_vet_silent = is_silent(&e);
                self.set_bench_phi(None);
            }
        }
    }

    /// Advance the bench's φ, keeping the one it displaces.
    ///
    /// Not a plain assignment: `edit_revet` is documented as idempotent and
    /// callers rely on that, so a second revet of the same tree must not
    /// shuffle the *actual* previous φ out of reach — a revert logged after
    /// one would carry `phi_before == phi_after` and read as a no-op edit.
    fn set_bench_phi(&mut self, phi: Option<Vec<f64>>) {
        if phi != self.bench_phi {
            self.bench_phi_prev = self.bench_phi.take();
        }
        self.bench_phi = phi;
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

    /// The workbench audition buffer, at the level it is played at (empty
    /// when the current edit failed vetting — the gate's rule is that no
    /// unvetted patch ever plays).
    pub fn edit_render(&self) -> Vec<f32> {
        self.bench_render
            .as_deref()
            .map(audition_pcm)
            .unwrap_or_default()
    }

    /// Whether the current workbench state passed vetting.
    pub fn edit_vet_ok(&self) -> bool {
        self.bench_vet_ok
    }

    /// Whether the current workbench state failed vetting for being silent —
    /// nothing reaches the output, typically because the only source socket
    /// is unplugged. False whenever [`Self::edit_vet_ok`] is true.
    pub fn edit_vet_silent(&self) -> bool {
        !self.bench_vet_ok && self.bench_vet_silent
    }

    /// Render the **first `seconds`** of the bench tree with `op` applied,
    /// without the bench ever having held that tree.
    ///
    /// Hearing a module before you place it is the whole point, and the one
    /// thing it must not cost is the patch you already have. Every other route
    /// to a rendered edit goes through `bench_tree` — apply, revet, and now the
    /// player's patch *is* the proposal, recoverable only by an undo they did
    /// not ask for. So this clones, applies to the clone, and drops it:
    /// `bench_tree`, `bench_render`, `bench_phi` and `bench_vet_ok` are all
    /// untouched, which is what lets a hover be free of consequence.
    ///
    /// It takes a whole [`StructOp`] rather than a key and a fragment because
    /// the placement it is previewing is a `StructOp` — the same JSON, from the
    /// same call site. A preview built from a re-derived splice would be a
    /// second implementation of insertion semantics, and the day the two
    /// disagreed the app would be lying about a sound.
    ///
    /// The render is the **full phrase**, truncated after the fact. Two
    /// reasons, and the second is the one that makes previewing usable at all:
    /// a shorter phrase is a different stimulus, so its φ would not be the φ
    /// this patch is scored under and its loudness normalization would not
    /// match the bench's; and the full phrase is the memo's key, so re-hovering
    /// a socket — which is what hovering *is* — costs a hash lookup instead of
    /// a render. An empty return means "nothing to play": no bench, a rejected
    /// op, or a term that failed vetting. Never a silent zero-filled buffer.
    pub fn preview_op(&mut self, op_json: &str, seconds: f64) -> Vec<f32> {
        let Some(tree) = &self.bench_tree else {
            return Vec::new();
        };
        let Ok(op) = serde_json::from_str::<StructOp>(op_json) else {
            return Vec::new();
        };
        let Ok(edited) = apply_struct_op(tree, &op) else {
            return Vec::new();
        };
        // The same ceiling gate `edit_set_tree_apply` runs. A preview is not a
        // commit, but auditioning a patch the grammar would refuse teaches the
        // player a move that will be taken away from them later.
        if validate_tree(&edited).is_err() {
            return Vec::new();
        }
        let (phrase, memo) = (self.phrase(), self.engine.memo().clone());
        let Ok((cf, audio)) = featurize_memo(&edited, &phrase, &memo, true) else {
            return Vec::new();
        };
        let Some(a) = bench_audio(&edited, &phrase, &cf.features, audio) else {
            return Vec::new();
        };
        // Levelled over the whole phrase and cut afterwards, so the preview is
        // exactly the head of what ▶ would play once the module is placed.
        let played = audition_pcm(&a);
        let n = ((seconds.max(0.1) * a.sample_rate) as usize).min(played.len());
        let mut out = played[..n].to_vec();
        // A phrase cut at an arbitrary sample is a step discontinuity, which is
        // a click — and a click at the end of every audition is the loudest
        // thing in the preview. 12 ms of cosine is below the threshold where a
        // release sounds shortened and well above the one where an edge is
        // audible.
        //
        // The ramp ends exactly at zero: t runs over 0..=1, so the last sample
        // is multiplied by cos(π) + 1 = 0. It used to stop one step short, at
        // (fade−1)/fade, and left about 9e-6 of a loud patch's last sample,
        // the very edge the fade exists to remove.
        let fade = ((0.012 * a.sample_rate) as usize).min(out.len());
        let span = fade.saturating_sub(1).max(1) as f32;
        for i in 0..fade {
            let t = i as f32 / span;
            let k = out.len() - fade + i;
            out[k] *= 0.5 * (1.0 + (std::f32::consts::PI * t).cos());
        }
        out
    }

    /// Rack description of the workbench tree as JSON (`null` if empty).
    pub fn edit_describe(&self) -> String {
        match &self.bench_tree {
            Some(t) => serde_json::to_string(&describe(t)).unwrap(),
            None => "null".into(),
        }
    }

    /// Commit the workbench tree as a new candidate. Returns the new
    /// candidate id, or 0 (duplicate / unvetted / empty bench).
    ///
    /// `outcome` is what the player reported about the edit against the
    /// original, as a wire string:
    ///
    /// - `"none"` — they said nothing. Lineage only.
    /// - `"heard_edited"` / `"heard_original"` — they heard both and picked.
    ///   **`"heard_original"` is the point of this API**: an edit that lost is
    ///   the more informative half of the comparison and had no way to be
    ///   said before ([`EditOutcome`]).
    /// - `"self_edited"` — the express "my edit is better" checkbox, tagged
    ///   [`Provenance::SelfReport`] so calibration can score an assertion
    ///   against a heard comparison instead of averaging them.
    ///
    /// An unknown string is `"none"`: a typo must not silently become a vote.
    pub fn edit_commit(&mut self, outcome: &str) -> u32 {
        let outcome = match outcome {
            "heard_edited" => EditOutcome::Heard { edited_won: true },
            "heard_original" => EditOutcome::Heard { edited_won: false },
            "self_edited" => EditOutcome::SelfReported,
            _ => EditOutcome::Untold,
        };
        let (Some(tree), true) = (self.bench_tree.clone(), self.bench_vet_ok) else {
            return 0;
        };
        self.engine
            .commit_edit(self.bench_original, tree, outcome)
            .unwrap_or(0) as u32
    }

    /// The pool id the bench was opened from (0 for none) — what a commit
    /// duel plays against.
    pub fn edit_original_id(&self) -> u32 {
        self.bench_original.unwrap_or(0) as u32
    }

    /// Has the bench actually diverged from the patch it was opened from?
    ///
    /// The gate on dealing a real duel at commit. The panel's own `dirty` flag
    /// answers "did the player touch anything", which is not the same
    /// question: turn a knob and turn it back, or undo to the start, and there
    /// is nothing to compare. Asking two patches that are the same patch which
    /// one is better is a question with no answer, and an answer to it is a
    /// row of noise in the log.
    ///
    /// `PatchTree`'s equality is content equality — `Uid`'s `PartialEq` is
    /// unconditionally true by construction (see `term.rs`), so a reconnect
    /// that reissued nothing and a rewrite that minted fresh identities
    /// compare the same way, which is what "the same patch" has to mean here.
    pub fn edit_differs_from_original(&self) -> bool {
        let (Some(tree), Some(oid)) = (&self.bench_tree, self.bench_original) else {
            return false;
        };
        match self.engine.find(oid) {
            Some(i) => self.engine.pool[i].tree != *tree,
            None => false,
        }
    }

    /// What the model currently thinks of the tree on the bench:
    /// `{"ok":bool,"u":f64,"sd":f64,"lens":string}`.
    ///
    /// `u` is the **mixture** utility — the same quantity the bank is ranked
    /// by, so the number above the rack and the number beside the patch in the
    /// bank are the same claim. `ok:false` means there is nothing honest to
    /// show yet (no posterior, no standardizer, or a bench that failed
    /// vetting), and the panel says so rather than drawing a zero.
    pub fn edit_utility(&self) -> String {
        let ex = self
            .bench_phi
            .as_ref()
            .and_then(|phi| self.engine.explain_phi(phi));
        match ex {
            Some(ex) => format!(
                r#"{{"ok":true,"u":{},"sd":{},"lens":{}}}"#,
                ex.mix_utility,
                ex.utility_std,
                serde_json::to_string(&if ex.style_name.is_empty() {
                    format!("style {}", ex.style + 1)
                } else {
                    ex.style_name.clone()
                })
                .unwrap()
            ),
            None => r#"{"ok":false}"#.into(),
        }
    }

    /// The exact per-feature decomposition of that number (`null` before the
    /// first fit). Same shape as [`Self::explain`], for the bench.
    pub fn edit_explain(&self) -> String {
        match self
            .bench_phi
            .as_ref()
            .and_then(|phi| self.engine.explain_phi(phi))
        {
            Some(ex) => serde_json::to_string(&ex).unwrap(),
            None => "null".into(),
        }
    }

    /// Append one row of the editor's implicit stream (WS-8 §3): a revert, a
    /// commit, an evolve-from, a structural op, a link-drag query.
    ///
    /// `detail` is opaque JSON. `with_phi` attaches the bench's φ on both
    /// sides of the event, which only a transition (a revert) has — everything
    /// else passes false and stores the strings it knows.
    ///
    /// None of this enters the likelihood, and that is deliberate: a revert is
    /// confounded with plain curiosity, and the fit the app shows a number
    /// from is not the place to smuggle in an unvalidated signal. It is logged
    /// because it cannot be logged retroactively.
    pub fn log_edit_event(
        &mut self,
        kind: &str,
        id: u32,
        value: f64,
        detail: &str,
        with_phi: bool,
    ) {
        let (before, after) = if with_phi {
            (
                self.bench_phi_prev.clone().unwrap_or_default(),
                self.bench_phi.clone().unwrap_or_default(),
            )
        } else {
            (Vec::new(), Vec::new())
        };
        self.engine
            .log_event_detail(kind, id as u64, value, detail, before, after);
    }

    /// Clear the workbench.
    pub fn edit_cancel(&mut self) {
        self.bench_tree = None;
        self.bench_render = None;
        self.bench_original = None;
        self.bench_vet_ok = false;
        self.bench_vet_silent = false;
        self.bench_phi = None;
        self.bench_phi_prev = None;
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
        if cached.key != auracle_features::render_key(&tree, &self.engine.cfg.phrase) {
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

    /// [`WasmEngine::import_session`] with a verdict: JSON
    /// `{"status":"ok"|"empty"|"unparseable","restored":n}`.
    ///
    /// The old method's `0` covers both a save this build cannot parse and a
    /// save with an empty bank. Only the first must stop the next autosave
    /// from overwriting the record; this is how the caller learns which it is.
    pub fn import_session_checked(&mut self, json: &str) -> String {
        let (status, restored) = match serde_json::from_str::<SessionState>(json) {
            Err(_) => ("unparseable", 0),
            Ok(state) => {
                let n = self.engine.import_state(state);
                self.engine.begin_session();
                (if n == 0 { "empty" } else { "ok" }, n)
            }
        };
        serde_json::json!({ "status": status, "restored": restored }).to_string()
    }

    /// What the last restore had to mend, as JSON
    /// `{"terms":n,"cells":n,"dropped":n}` — saved patches whose knobs were
    /// outside their range, observation-log cells clamped back inside it, and
    /// votes dropped because a coordinate was not a number.
    ///
    /// All three are 0 for any session written by a build that carries the
    /// domain gate. Non-zero means the profile *was* being fitted on values
    /// that were not measurements, and the player is entitled to be told so
    /// rather than have it quietly corrected under them.
    pub fn repair_report(&self) -> String {
        let (terms, cells, dropped) = self.engine.repair_report();
        format!(r#"{{"terms":{terms},"cells":{cells},"dropped":{dropped}}}"#)
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
    use rand::RngCore;

    /// PERFORM's replies write a tree exactly as the rest of the app does, key
    /// for key: through `json!` they came out with sorted keys, and PERFORM,
    /// which tells a new structure from new knob values by comparing trees'
    /// text, took Back after a drift for a new patch.
    #[test]
    fn perform_replies_write_trees_in_their_own_key_order() {
        let mut engine = WasmEngine::new(3, 6);
        while engine.fill_step(3) > 0 {}
        let id = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked()).unwrap()[0]["id"]
            .as_u64()
            .unwrap() as u32;
        assert!(engine.edit_begin(id));
        let tree_json = engine.edit_tree_json();
        let mut compared = 0;
        for reply in [
            engine.perform_drift(&tree_json, "{}", "[]", 3, 0.15),
            engine.perform_offer(&tree_json, "{}", "[]", 3, None, None),
        ] {
            let v: serde_json::Value = serde_json::from_str(&reply).unwrap();
            if v.get("reason").is_some() {
                continue; // nothing grew this time; nothing to compare
            }
            let tree: PatchTree = serde_json::from_value(v["tree"].clone()).unwrap();
            let own = serde_json::to_string(&tree).unwrap();
            assert!(
                reply.starts_with(&format!("{{\"tree\":{own}")),
                "the reply's tree is not in its own key order"
            );
            compared += 1;
        }
        assert!(
            compared > 0,
            "neither a drift nor an offer grew, so nothing was checked"
        );
    }

    /// The menu bar's TAUGHT tooltip splits the count by kind from
    /// `status()`: a duel is a pick, a rating a star, a keep/kill a cut, and
    /// the three add up to `observations`.
    #[test]
    fn status_counts_picks_stars_and_cuts_apart() {
        let mut engine = WasmEngine::new(3, 6);
        while engine.fill_step(3) > 0 {}
        let ids: Vec<u32> = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked())
            .unwrap()
            .iter()
            .map(|r| r["id"].as_u64().unwrap() as u32)
            .collect();
        assert!(engine.record_duel(ids[0], ids[1], true));
        assert!(engine.record_stars(ids[2], 3));
        assert!(engine.record_stars(ids[3], 1));
        assert!(engine.record_keep(ids[4], false));
        let st: serde_json::Value = serde_json::from_str(&engine.status()).unwrap();
        assert_eq!(
            (&st["picks"], &st["stars"], &st["cuts"], &st["observations"]),
            (
                &serde_json::json!(1),
                &serde_json::json!(2),
                &serde_json::json!(1),
                &serde_json::json!(4)
            ),
            "status: {st}"
        );
    }

    /// A taught engine with a unit-test budget. The shipped refinement budget
    /// is a minute and more of walks per generation natively, which a unit
    /// test cannot pay; the machinery under test does not depend on it.
    /// Deterministic in `seed`: two calls build the same engine.
    fn taught_wasm(seed: u64) -> WasmEngine {
        let mut engine = WasmEngine::new(seed, 12);
        engine.engine.cfg.refine_steps = 8;
        engine.engine.cfg.refine_seeds = 3;
        engine.engine.cfg.mcmc_samples = 3_000;
        engine.engine.cfg.mcmc_warmup = 1_000;
        while engine.fill_step(4) > 0 {}
        for _ in 0..16 {
            let [a, b]: [u64; 2] = serde_json::from_str::<Option<[u64; 2]>>(&engine.next_duel())
                .unwrap()
                .expect("a duel");
            // Any fixed rule will do: the test compares two twins, not a taste.
            engine.record_duel(a as u32, b as u32, (a * 7 + b) % 3 != 0);
        }
        engine.fit();
        engine
    }

    fn twins(seed: u64) -> (WasmEngine, WasmEngine) {
        std::thread::scope(|s| {
            let a = s.spawn(move || taught_wasm(seed));
            let b = s.spawn(move || taught_wasm(seed));
            (a.join().unwrap(), b.join().unwrap())
        })
    }

    /// **The farm's wire changes no child.** One twin breeds a generation
    /// serially (`refine`); the other hands its jobs out as JSON
    /// (`refine_jobs`), walks each through the stateless `farm_walk` export —
    /// which must answer exactly what `run_walk` answers on the engine's own
    /// context and job — and absorbs the JSON results in order. The two must
    /// end with the same bank and the same lineage.
    #[test]
    fn farm_walks_breed_the_serial_generation() {
        let (mut serial, mut farmed) = twins(0xFA2);
        serial.refine();

        let reply: serde_json::Value = serde_json::from_str(&farmed.refine_jobs()).unwrap();
        // Re-serialized through `Value`, so its keys come out sorted: the
        // context is parsed by name, and its floats survive exactly
        // (`float_roundtrip`), which is what the worker's JSON relies on.
        let context = serde_json::to_string(&reply["context"]).unwrap();
        let own = farmed.engine.walk_context().expect("taught");
        let jobs = reply["jobs"].as_array().unwrap();
        assert_eq!(jobs.len(), 3);
        let mut children = 0;
        for job in jobs {
            let job_text = serde_json::to_string(job).unwrap();
            let wired = farm_walk(&context, &job_text);
            assert!(
                !wired.is_empty(),
                "farm_walk refused a job refine_jobs made"
            );
            let native: WalkJob = serde_json::from_value(job.clone()).unwrap();
            let direct = run_walk(&own, &native, &RenderMemo::default());
            assert_eq!(
                wired,
                serde_json::to_string(&direct).unwrap(),
                "job {}: farm_walk differs from run_walk",
                native.index
            );
            children += (farmed.refine_absorb(&wired) > 0) as usize;
        }
        assert!(
            children > 0,
            "no walk bred a child, so no child was compared"
        );
        assert_eq!(farmed.ranked(), serial.ranked(), "the bank differs");
        assert_eq!(
            serde_json::to_string(&farmed.engine.lineage).unwrap(),
            serde_json::to_string(&serial.engine.lineage).unwrap()
        );
        assert_eq!(farmed.refine_retired(), serial.refine_retired());
        assert_eq!(
            farmed.refine_finish(),
            "[]",
            "the last absorb already finished"
        );
        assert_eq!(
            farm_walk("{", "{}"),
            "",
            "a broken job is refused, not walked"
        );
    }

    /// **The belief the worker posts after a pick.** On a taught engine with
    /// picks no refit has seen, `belief`'s rows are `ranked`'s ids, order and
    /// numbers, under the reweighted posterior (the picks move them); its
    /// seeds are the parents the twin's `refine_jobs` then hands out; and
    /// what may be replaced is the lowest member per walk.
    #[test]
    fn belief_is_the_ranked_numbers_and_the_next_seeds() {
        let (mut engine, mut twin) = twins(0xB31F);
        let fitted = engine.belief();
        let ids = |json: &str| -> Vec<u64> {
            serde_json::from_str::<Vec<serde_json::Value>>(json)
                .unwrap()
                .iter()
                .map(|r| r["id"].as_u64().unwrap())
                .collect()
        };
        for e in [&mut engine, &mut twin] {
            for _ in 0..3 {
                let order = ids(&e.ranked());
                let (best, worst) = (order[0] as u32, order[order.len() - 1] as u32);
                assert!(e.record_duel(worst, best, true));
            }
        }
        let text = engine.belief();
        assert_ne!(text, fitted, "the picks did not move the belief");
        let belief: serde_json::Value = serde_json::from_str(&text).unwrap();
        let ranked: Vec<serde_json::Value> = serde_json::from_str(&engine.ranked()).unwrap();
        let rows = belief["ranked"].as_array().unwrap();
        assert_eq!(rows.len(), ranked.len());
        for (row, r) in rows.iter().zip(&ranked) {
            for field in ["id", "mean", "std"] {
                assert_eq!(row[field], r[field], "{field} differs from ranked()");
            }
            assert!(row["style"].as_u64().is_some());
        }
        let list = |v: &serde_json::Value| -> Vec<u64> {
            v.as_array()
                .unwrap()
                .iter()
                .map(|x| x.as_u64().unwrap())
                .collect()
        };
        let jobs: serde_json::Value = serde_json::from_str(&twin.refine_jobs()).unwrap();
        let parents: Vec<u64> = jobs["jobs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|j| j["parent_id"].as_u64().unwrap())
            .collect();
        assert_eq!(
            list(&belief["seeds"]),
            parents,
            "not the parents refine_jobs takes"
        );
        assert_eq!(parents.len(), 3);
        let lowest: Vec<u64> = ranked
            .iter()
            .rev()
            .take(3)
            .map(|r| r["id"].as_u64().unwrap())
            .collect();
        assert_eq!(list(&belief["may_replace"]), lowest);
    }

    /// ⚡ as one farm job lands the same child as ⚡ in the engine, and so
    /// does the job drawn first and walked here afterwards (`refine_from_walk`,
    /// the worker's path when no crew comes up). An unknown seed says so
    /// instead of producing a job, and a walk with no job drawn is refused.
    #[test]
    fn evolve_from_this_on_the_farm_is_evolve_from_this() {
        let (mut serial, mut farmed) = twins(0x1F7);
        let mut walked = taught_wasm(0x1F7);
        let ranked: Vec<serde_json::Value> = serde_json::from_str(&serial.ranked()).unwrap();
        let mut landed = 0;
        for row in ranked.iter().take(4) {
            let id = row["id"].as_u64().unwrap() as u32;
            let here = serial.refine_from(id, "[]");
            let reply: serde_json::Value =
                serde_json::from_str(&farmed.refine_from_job(id, "[]")).unwrap();
            let result = farm_walk(
                &serde_json::to_string(&reply["context"]).unwrap(),
                &serde_json::to_string(&reply["job"]).unwrap(),
            );
            let there = farmed.refine_from_absorb(id, &result);
            assert_eq!(here, there, "seed {id}: the farm's ⚡ landed elsewhere");
            assert_eq!(serial.last_refine_reason(), farmed.last_refine_reason());
            let drawn: serde_json::Value =
                serde_json::from_str(&walked.refine_from_job(id, "[]")).unwrap();
            // The draw, not the whole job: a tree's node identities come from
            // a process-wide mint and differ between twins.
            assert_eq!(
                drawn["job"]["rng_seed"], reply["job"]["rng_seed"],
                "seed {id}: another job was drawn"
            );
            let later = walked.refine_from_walk(id);
            assert_eq!(
                here, later,
                "seed {id}: the job walked here landed elsewhere"
            );
            assert_eq!(serial.last_refine_reason(), walked.last_refine_reason());
            landed += (here > 0) as usize;
        }
        assert!(landed > 0, "no ⚡ landed, so no child was compared");
        assert_eq!(farmed.ranked(), serial.ranked());
        assert_eq!(walked.ranked(), serial.ranked());
        assert_eq!(serial.status(), farmed.status());
        assert_eq!(walked.refine_from_walk(0xDEAD), 0);
        assert_eq!(walked.last_refine_reason(), "unknown_seed");
        assert!(!walked.refine_from_cancel(0xDEAD));
        assert_eq!(
            farmed.refine_from_job(0xDEAD, "[]"),
            r#"{"reason":"unknown_seed"}"#
        );
    }

    /// A search control's offer says how far it moved the way it was turned
    /// (ADR-008): the reply is the struct reply with `moved`, a number in σ
    /// that is the engine's own measure of the move, the tree still in its
    /// own key order. The Offer button's reply has no `moved`, and neither
    /// does one for a control that does not exist (it walks undirected).
    #[test]
    fn an_aimed_offer_reply_carries_how_far_it_moved() {
        let mut engine = WasmEngine::new(3, 6);
        while engine.fill_step(3) > 0 {}
        let id = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked()).unwrap()[0]["id"]
            .as_u64()
            .unwrap() as u32;
        assert!(engine.edit_begin(id));
        let tree_json = engine.edit_tree_json();
        let home: PatchTree = serde_json::from_str(&tree_json).unwrap();
        let grit = auracle_session::perform::CONTROLS
            .iter()
            .position(|c| c.name == "Grit")
            .unwrap() as u32;
        let mut aimed = 0;
        for _ in 0..4 {
            let reply = engine.perform_offer(&tree_json, "{}", "[]", 6, Some(grit), Some(1.0));
            let v: serde_json::Value = serde_json::from_str(&reply).unwrap();
            if v.get("reason").is_some() {
                continue; // nothing grew this time
            }
            let tree: PatchTree = serde_json::from_value(v["tree"].clone()).unwrap();
            let own = serde_json::to_string(&tree).unwrap();
            assert!(reply.starts_with(&format!("{{\"tree\":{own}")));
            let moved = v["moved"]
                .as_f64()
                .expect("an aimed offer says how far it moved");
            let want = engine
                .engine
                .moved_along(&home, &tree, grit as usize)
                .unwrap();
            assert!((moved - want).abs() < 1e-9, "{moved} vs {want}");
            aimed += 1;
        }
        assert!(aimed > 0, "no aimed offer grew, so nothing was checked");
        for (control, sign) in [(None, None), (Some(99), Some(-1.0))] {
            let reply = engine.perform_offer(&tree_json, "{}", "[]", 6, control, sign);
            let v: serde_json::Value = serde_json::from_str(&reply).unwrap();
            assert!(v.get("moved").is_none(), "{control:?}: {reply}");
        }
    }

    /// A draw on one stream never moves another: a spare offer grown in the
    /// background, however early or late it lands, leaves the duels and the
    /// fills where they were. And a fit's generator is a function of the seed
    /// and the evidence count alone.
    #[test]
    fn a_consumer_draws_only_from_its_own_stream() {
        let mut quiet = Streams::new(20260927);
        let mut busy = Streams::new(20260927);
        for _ in 0..1000 {
            busy.perform.next_u64();
            busy.refine.next_u64();
        }
        for _ in 0..8 {
            assert_eq!(quiet.duel.next_u64(), busy.duel.next_u64());
            assert_eq!(quiet.fill.next_u64(), busy.fill.next_u64());
        }
        assert_eq!(quiet.fit(55).next_u64(), busy.fit(55).next_u64());
        assert_ne!(quiet.fit(55).next_u64(), quiet.fit(56).next_u64());
        // Distinct streams, not one stream under four names.
        let mut s = Streams::new(7);
        let firsts = [
            s.fill.next_u64(),
            s.duel.next_u64(),
            s.refine.next_u64(),
            s.perform.next_u64(),
        ];
        for i in 0..firsts.len() {
            for j in i + 1..firsts.len() {
                assert_ne!(firsts[i], firsts[j]);
            }
        }
    }

    /// The structural-edit vocabulary is a **wire format**: `main.js` builds
    /// these payloads by hand and posts them at `apply_struct_op`, and the
    /// same strings are what `describe` reports as a module's `kind`, so the
    /// palette, the faceplate and the edit all key off one spelling. A serde
    /// rename drifting from the rack description would be invisible in Rust
    /// and would break exactly one button in the browser.
    #[test]
    fn the_structural_edit_vocabulary_keeps_its_spellings() {
        use auracle_grammar::{ModKind, NodeKind};
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
            // The empty socket, which `describe` reports as `silence`.
            (NodeKind::Silence, "silence"),
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
            // A leaf, and a `RackModule::kind` too: `describe` reports
            // `steps` for the module this places.
            (ModKind::Steps, "steps"),
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
            NodeKind::Silence,
        ] {
            let tree = auracle_grammar::apply_struct_op(
                &auracle_grammar::presets()[0].1,
                &auracle_grammar::StructOp::Replace {
                    key: "node".into(),
                    kind,
                },
            )
            .expect("replace at the root always applies");
            let rack = auracle_grammar::describe(&tree);
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
        let mut state: auracle_session::SessionState =
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

    /// `render_of` hands WebAudio the audition at the level it is played at,
    /// and the pool keeps the one φ was measured on. Seed 1's first eight hold
    /// a slow swell the 30 dB cap stopped 17 dB short — its peaks are far
    /// under the ceiling, so all of that comes back — and a sub-bass drone the
    /// peak ceiling pulled 6 dB down, whose crest is in a sustained waveform,
    /// so the limiter can return only part of it without clipping the wave
    /// (`examples/pool_loudness.rs`, load 1).
    #[test]
    fn render_of_plays_the_audition_at_its_level_and_stores_it_untouched() {
        use auracle_features::{integrated_lufs, TARGET_LUFS};
        // A seed whose eight-patch pool holds at least two auditions more than
        // 3 dB short of the target: the fixture is chosen for them. (Seed 1
        // held two until the engine's randomness was split into one stream
        // per consumer, which moved every seeded pool.)
        let mut engine = WasmEngine::new(3, 8);
        farm_fill(&mut engine, true);
        let lufs = |x: &[f32]| {
            let x: Vec<f64> = x.iter().map(|s| f64::from(*s)).collect();
            integrated_lufs(&x, 44_100.0).expect("vetted, so not silent")
        };
        let ids: Vec<u64> = engine.engine.pool.iter().map(|c| c.id).collect();
        let (mut short, mut whole) = (0, 0);
        for id in ids {
            let i = engine.engine.find(id).expect("pool member");
            let f = engine.engine.pool[i].features.clone();
            let stored = engine.engine.render_of(id).expect("renders");
            let played = engine.render_of(id as u32);
            assert_eq!(played.len(), stored.samples.len());
            assert!(
                played.iter().all(|s| s.abs() <= 1.0),
                "id {id} over full scale"
            );
            let shortfall = TARGET_LUFS - f.lufs_before - f.gain_db;
            if shortfall > 3.0 {
                short += 1;
                let (was, now) = (lufs(&stored.samples), lufs(&played));
                assert!(
                    now > was + 1.0,
                    "id {id}: {shortfall:.1} dB short, played {was:.1} → {now:.1} LUFS"
                );
                whole += usize::from((now - TARGET_LUFS).abs() < 0.5);
            } else if stored.samples.iter().all(|s| s.abs() < 0.45) {
                // At target, and too quiet for any point between the samples
                // to reach full scale: nothing to do, so nothing done.
                assert_eq!(played, stored.samples, "id {id} was touched");
            }
            // The stored buffer is still exactly what the featurizer made.
            let replay = auracle_features::render_playback(
                &engine.engine.pool[i].tree,
                &engine.engine.cfg.phrase,
                f.gain_db,
            )
            .expect("renders");
            assert_eq!(
                replay.samples, stored.samples,
                "id {id}: the stored audition moved"
            );
        }
        assert!(short >= 2, "the fixture lost its short patches ({short})");
        assert!(whole >= 1, "no shortfall came back to the target");
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

    /// The tri-state the persistence layer was missing: a save the build
    /// cannot parse, a save with nothing in it, and a real one are three
    /// different answers. The first is the one that matters — it is the signal
    /// "do not overwrite this record" — and both old methods folded it into
    /// the second.
    #[test]
    fn a_restore_says_whether_it_could_read_the_save() {
        let mut origin = WasmEngine::new(0x5A5B, 4);
        while origin.fill_step(2) > 0 {}
        let saved = origin.export_session();
        let empty = WasmEngine::new(7, 4).export_session();

        let verdict = |s: &str| -> serde_json::Value { serde_json::from_str(s).unwrap() };

        let mut e = WasmEngine::new(1, 4);
        let v = verdict(&e.import_session_checked("{not json"));
        assert_eq!(v["status"], "unparseable");
        assert_eq!(v["restored"], 0);
        let v = verdict(&e.import_session_checked(&empty));
        assert_eq!(v["status"], "empty");
        let v = verdict(&e.import_session_checked(&saved));
        assert_eq!(v["status"], "ok");
        assert!(v["restored"].as_u64().unwrap() >= 3);

        let mut d = WasmEngine::new(1, 4);
        let v = verdict(&d.import_session_deferred_v2("[1,2,3]"));
        assert_eq!(v["status"], "unparseable");
        assert_eq!(v["jobs"].as_array().unwrap().len(), 0);
        let v = verdict(&d.import_session_deferred_v2(&empty));
        assert_eq!(v["status"], "empty");
        let v = verdict(&d.import_session_deferred_v2(&saved));
        assert_eq!(v["status"], "ok");
        // Same jobs as the old method hands out, so the farm loop is unchanged.
        let mut d2 = WasmEngine::new(1, 4);
        let old: serde_json::Value =
            serde_json::from_str(&d2.import_session_deferred(&saved)).unwrap();
        assert_eq!(v["jobs"], old);
    }

    /// A vote on an id the pool no longer holds is refused out loud. The app
    /// used to count it, save, and toast "rated" while the engine had dropped
    /// it on the floor.
    #[test]
    fn a_vote_on_a_gone_id_is_refused_not_swallowed() {
        let mut engine = WasmEngine::new(0x7E5, 4);
        while engine.fill_step(2) > 0 {}
        let ranked: Vec<serde_json::Value> = serde_json::from_str(&engine.ranked()).unwrap();
        let a = ranked[0]["id"].as_u64().unwrap() as u32;
        let b = ranked[1]["id"].as_u64().unwrap() as u32;
        let before = engine.engine.log.len();
        assert!(engine.record_duel(a, b, true));
        assert!(engine.record_keep(a, true));
        assert!(engine.record_stars(b, 4));
        assert_eq!(engine.engine.log.len(), before + 3);
        assert!(!engine.record_duel(a, 0xFFFF, true));
        assert!(
            !engine.record_duel(a, a, true),
            "a duel needs two candidates"
        );
        assert!(!engine.record_keep(0xFFFF, false));
        assert!(!engine.record_stars(0xFFFF, 1));
        assert_eq!(
            engine.engine.log.len(),
            before + 3,
            "a refused vote was logged"
        );
    }

    /// A cut patch is never dealt again. The cut hides the row and logs a
    /// kill, but the patch stays in the pool until a generation replaces it;
    /// dealing used to ignore the cut, so a sound the player had thrown out
    /// came back as a duel side. The app passes its cut ids with every deal.
    #[test]
    fn a_cut_patch_is_never_dealt_again() {
        let mut engine = WasmEngine::new(0xC07, 6);
        while engine.fill_step(3) > 0 {}
        let ranked: Vec<serde_json::Value> = serde_json::from_str(&engine.ranked()).unwrap();
        let ids: Vec<u32> = ranked
            .iter()
            .map(|r| r["id"].as_u64().unwrap() as u32)
            .collect();
        assert!(ids.len() >= 4, "pool too small to test: {}", ids.len());
        let cut = ids[0];
        assert!(engine.record_keep(cut, false));
        let dealt = |reply: String| -> Option<[u32; 2]> {
            let v: serde_json::Value = serde_json::from_str(&reply).unwrap();
            (!v.is_null()).then(|| {
                [
                    v["a"].as_u64().unwrap() as u32,
                    v["b"].as_u64().unwrap() as u32,
                ]
            })
        };
        // Without the exclusion the cut patch is dealt (the old behaviour),
        // which is what makes the check below mean something.
        let mut seen_uncut = false;
        for _ in 0..200 {
            let [a, b] = dealt(engine.next_duel_ex(None)).expect("a pair");
            seen_uncut |= a == cut || b == cut;
        }
        assert!(seen_uncut, "the cut patch was never dealt even unexcluded");
        for _ in 0..200 {
            let [a, b] = dealt(engine.next_duel_ex(Some(vec![cut]))).expect("a pair");
            assert!(a != cut && b != cut, "the cut patch #{cut} was dealt");
            assert_ne!(a, b);
        }
        // Cut all but one and there is no pair left to deal.
        assert_eq!(dealt(engine.next_duel_ex(Some(ids[1..].to_vec()))), None);
    }

    /// The app's deal is counted when it reports the pair on the table, not
    /// when it is dealt: `deal_duel_ex` deals what `next_duel_ex` would from
    /// the same stream, and only `duel_shown` of a pair it dealt counts.
    #[test]
    fn a_deal_counts_when_it_is_shown() {
        let fresh = || {
            let mut e = WasmEngine::new(0x5E1, 6);
            while e.fill_step(3) > 0 {}
            e
        };
        let pair = |reply: &str| -> [u32; 2] {
            let v: serde_json::Value = serde_json::from_str(reply).unwrap();
            [
                v["a"].as_u64().unwrap() as u32,
                v["b"].as_u64().unwrap() as u32,
            ]
        };
        let (mut counted, mut deferred) = (fresh(), fresh());
        for _ in 0..5 {
            let a = counted.next_duel_ex(None);
            let b = deferred.deal_duel_ex(None);
            assert_eq!(a, b, "one stream, one deal");
            let [x, y] = pair(&b);
            assert!(deferred.duel_shown(y, x));
            assert!(!deferred.duel_shown(x, y), "shown once");
        }
        assert_eq!(
            counted.engine.shown_pairs_len(),
            deferred.engine.shown_pairs_len()
        );
        // Deals thrown away until one is a pair never shown before: under
        // the old count-at-the-deal it would have added a row.
        let before = deferred.engine.shown_pairs_len();
        for _ in 0..20 {
            let _ = deferred.deal_duel_ex(None);
        }
        assert!(!deferred.duel_shown(u32::MAX, u32::MAX - 1), "never dealt");
        assert_eq!(
            deferred.engine.shown_pairs_len(),
            before,
            "a deal thrown away is not shown"
        );
    }

    /// The import route enforces the same ceilings as every other write route,
    /// and the knob boundary refuses what `clamp` would let through.
    #[test]
    fn import_and_knob_boundaries_refuse_what_they_used_to_pass() {
        use auracle_grammar::term::{AudioNode, FilterKind, ModNode};
        use auracle_grammar::Uid;
        let mut engine = WasmEngine::new(0x1A7, 4);
        while engine.fill_step(2) > 0 {}
        assert_eq!(engine.last_refine_reason(), "idle");

        let mut deep = auracle_grammar::presets()[0].1.clone();
        while deep.root.depth() <= auracle_grammar::mutate::MAX_DEPTH {
            deep.root = AudioNode::Filter {
                uid: Uid::NEW,
                kind: FilterKind::SvfLp,
                cutoff: 0.5,
                resonance: 0.2,
                mod_depth: 0.0,
                input: Box::new(deep.root),
                modulation: ModNode::None,
            };
        }
        let pool_before = engine.engine.pool.len();
        assert_eq!(
            engine.import_patch(&serde_json::to_string(&deep).unwrap(), "too deep"),
            0
        );
        assert_eq!(
            engine.engine.pool.len(),
            pool_before,
            "the over-ceiling tree landed"
        );
        // A legal preset still imports (a novel one — the pool holds prior draws).
        let ok = auracle_grammar::presets()[3].1.clone();
        assert_ne!(
            engine.import_patch(&serde_json::to_string(&ok).unwrap(), "fine"),
            0
        );

        let ranked: Vec<serde_json::Value> = serde_json::from_str(&engine.ranked()).unwrap();
        let id = ranked[0]["id"].as_u64().unwrap() as u32;
        assert!(engine.edit_begin(id));
        let before = engine.edit_tree_json();
        assert!(!engine.edit_param("amp#attack", f64::NAN, false));
        assert!(!engine.edit_param("amp#attack", f64::INFINITY, false));
        assert_eq!(
            engine.edit_tree_json(),
            before,
            "a refused knob moved the bench"
        );
        // A knob dragged to the stop lands inside the half-open domain.
        assert!(engine.edit_param("amp#attack", 1.0, false));
        let t: auracle_grammar::PatchTree = serde_json::from_str(&engine.edit_tree_json()).unwrap();
        assert_eq!(t.amp.attack, auracle_grammar::PARAM_MAX);

        let b: serde_json::Value = serde_json::from_str(&budget_ceilings()).unwrap();
        assert_eq!(b["size"], auracle_grammar::mutate::MAX_SIZE);
        assert_eq!(b["depth"], auracle_grammar::mutate::MAX_DEPTH);
        assert_eq!(b["mod"], auracle_grammar::mutate::MAX_MOD_DEPTH);
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

    /// The commit duel's gate. `wb.dirty` in the panel means "the player
    /// touched something", which is a different question from "is there
    /// anything to compare": turn a knob and turn it back, or undo to where
    /// you started, and dealing a duel would be asking which of two identical
    /// patches is better — a question whose answer is a row of noise in the
    /// preference log.
    #[test]
    fn a_bench_edited_back_to_where_it_started_has_no_duel_to_deal() {
        let mut engine = WasmEngine::new(0xD0E1, 6);
        while engine.fill_step(3) > 0 {}
        let id = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked()).unwrap()[0]["id"]
            .as_u64()
            .unwrap() as u32;
        assert!(engine.edit_begin(id));
        assert_eq!(engine.edit_original_id(), id);
        assert!(
            !engine.edit_differs_from_original(),
            "a freshly benched patch is the patch it came from"
        );

        let before = engine.edit_tree_json();
        assert!(engine.edit_param("amp#attack", 0.42, false));
        assert!(engine.edit_differs_from_original(), "a knob moved");
        // …and back, through the same route undo takes.
        assert_eq!(engine.edit_set_tree(&before), "");
        assert!(
            !engine.edit_differs_from_original(),
            "returning to the original tree still read as an edit"
        );
    }

    /// The readout above the rack describes the tree under the player's
    /// hands, on every edit — the WHY line's failure was that it described the
    /// patch that was *loaded*, silently, through any number of edits. Both
    /// surfaces have to move with the bench and agree with each other, and
    /// both have to say "nothing to show" rather than draw a zero when there
    /// is no posterior to ask.
    #[test]
    fn the_bench_readout_follows_the_bench() {
        let mut engine = WasmEngine::new(0x0B1E, 6);
        while engine.fill_step(3) > 0 {}
        let id = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked()).unwrap()[0]["id"]
            .as_u64()
            .unwrap() as u32;
        assert!(engine.edit_begin(id));

        // Untaught: no posterior, so no honest number exists.
        let u: serde_json::Value = serde_json::from_str(&engine.edit_utility()).unwrap();
        assert_eq!(u["ok"], false, "a number was drawn with nothing behind it");
        assert_eq!(engine.edit_explain(), "null");

        // Teach it something, then the same two calls have to answer.
        let ranked: Vec<serde_json::Value> = serde_json::from_str(&engine.ranked()).unwrap();
        let (a, b) = (
            ranked[0]["id"].as_u64().unwrap() as u32,
            ranked[1]["id"].as_u64().unwrap() as u32,
        );
        engine.record_duel(a, b, true);
        engine.fit();
        let u0: serde_json::Value = serde_json::from_str(&engine.edit_utility()).unwrap();
        assert_eq!(u0["ok"], true);
        let ex0: serde_json::Value = serde_json::from_str(&engine.edit_explain()).unwrap();
        let sum: f64 = ex0["contributions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["contribution"].as_f64().unwrap())
            .sum();
        assert!(
            (sum - ex0["utility"].as_f64().unwrap()).abs() < 1e-9,
            "the decomposition is exact within a lens, or it is not a decomposition"
        );

        // An edit big enough to move φ has to move the number with it.
        assert_eq!(
            engine.edit_structure(r#"{"op":"insert","key":"node","kind":"distortion"}"#),
            ""
        );
        let u1: serde_json::Value = serde_json::from_str(&engine.edit_utility()).unwrap();
        assert_eq!(u1["ok"], true);
        assert_ne!(
            u0["u"], u1["u"],
            "the readout kept describing the patch that was edited away"
        );
    }

    /// A bench with nothing reaching the output fails the vet as *silent*,
    /// and says so: the app tells an unplugged patch apart from a runaway one
    /// by this flag, and a runaway warning over a silent patch is untrue.
    #[test]
    fn a_bench_with_its_only_source_unplugged_fails_the_vet_as_silent() {
        let mut engine = WasmEngine::new(0x5117, 6);
        while engine.fill_step(3) > 0 {}
        let id = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked()).unwrap()[0]["id"]
            .as_u64()
            .unwrap() as u32;
        assert!(engine.edit_begin(id));
        assert!(engine.edit_vet_ok());
        assert!(!engine.edit_vet_silent());
        let before = engine.edit_tree_json();
        assert_eq!(
            engine.edit_structure(r#"{"op":"replace","key":"node","kind":"silence"}"#),
            ""
        );
        assert!(!engine.edit_vet_ok(), "a patch of nothing passed the vet");
        assert!(
            engine.edit_vet_silent(),
            "an empty patch failed as something other than silent"
        );
        assert_eq!(engine.edit_set_tree(&before), ""); // ⌘Z
        assert!(engine.edit_vet_ok());
        assert!(!engine.edit_vet_silent());
    }

    /// The implicit stream: a revert has to arrive with φ on *both* sides of
    /// it, because a transition logged from one side says nothing about the
    /// direction the player moved — and direction is the entire signal.
    #[test]
    fn a_logged_revert_carries_both_sides_of_the_edit() {
        let mut engine = WasmEngine::new(0x2E7, 6);
        while engine.fill_step(3) > 0 {}
        let id = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked()).unwrap()[0]["id"]
            .as_u64()
            .unwrap() as u32;
        assert!(engine.edit_begin(id));
        let before = engine.edit_tree_json();
        assert_eq!(
            engine.edit_structure(r#"{"op":"insert","key":"node","kind":"distortion"}"#),
            ""
        );
        assert_eq!(engine.edit_set_tree(&before), ""); // ⌘Z
        engine.log_edit_event(
            "revert",
            id,
            3400.0,
            r#"{"op":"insert","kind":"distortion"}"#,
            true,
        );

        let state: auracle_session::SessionState =
            serde_json::from_str(&engine.export_session()).unwrap();
        let ev = state.events.last().expect("the revert was logged");
        assert_eq!(ev.kind, "revert");
        assert_eq!(ev.value, 3400.0);
        assert!(!ev.phi_before.is_empty() && !ev.phi_after.is_empty());
        assert_ne!(
            ev.phi_before, ev.phi_after,
            "a revert whose two sides are equal reverted nothing"
        );
        assert!(ev.detail.contains("distortion"));
        // And it stays out of the likelihood, which is the whole premise of
        // logging it this early.
        assert_eq!(state.profile.log.len(), 0);
    }

    /// The one property the whole pre-placement audition rests on: you can
    /// hear the proposal without owning it. If the bench moved, a hover would
    /// be an edit, and the player would be undoing sounds they only looked at.
    #[test]
    fn a_preview_renders_the_proposal_and_leaves_the_bench_alone() {
        // A seed whose top-ranked patch can take a distortion at its root, the
        // splice this test previews (with one RNG stream per consumer, 0x9A1's
        // pool no longer can; the property is the fixture, not the seed).
        let mut engine = WasmEngine::new(0x9A2, 6);
        while engine.fill_step(3) > 0 {}
        let id = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked()).unwrap()[0]["id"]
            .as_u64()
            .unwrap() as u32;
        assert!(engine.edit_begin(id));
        let before_tree = engine.edit_tree_json();
        let before_render = engine.edit_render();
        let before_desc = engine.edit_describe();

        let pcm = engine.preview_op(r#"{"op":"insert","key":"node","kind":"distortion"}"#, 1.6);
        assert!(!pcm.is_empty(), "the spliced patch should have rendered");
        // Truncated, not the whole phrase: the phrase is ~5 s and the audition
        // is a glance.
        let want = (1.6 * engine.sample_rate()) as usize;
        assert_eq!(pcm.len(), want);
        assert!(
            pcm.iter().any(|s| s.abs() > 1e-4),
            "a preview of a real patch is not silence"
        );
        // The tail is faded, so the cut cannot click.
        assert!(pcm[pcm.len() - 1].abs() < 1e-6);

        assert_eq!(engine.edit_tree_json(), before_tree);
        assert_eq!(engine.edit_render(), before_render);
        assert_eq!(engine.edit_describe(), before_desc);
        assert!(engine.edit_vet_ok());
        // Nor did it move the belief readout — a hover must not restate what
        // the model thinks of a patch the player never adopted.
        assert!(!engine.edit_differs_from_original());
    }

    /// An op the grammar refuses and an op past the ceilings both come back as
    /// "nothing to play", never as a buffer of zeros that would audition as a
    /// patch that had gone silent.
    #[test]
    fn an_unplayable_preview_is_empty_rather_than_silent() {
        let mut engine = WasmEngine::new(0x9A2, 6);
        while engine.fill_step(3) > 0 {}
        let id = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked()).unwrap()[0]["id"]
            .as_u64()
            .unwrap() as u32;

        // No bench at all.
        assert!(engine
            .preview_op(r#"{"op":"insert","key":"node","kind":"distortion"}"#, 1.6)
            .is_empty());

        assert!(engine.edit_begin(id));
        // A key that is not in the tree.
        assert!(engine
            .preview_op(r#"{"op":"insert","key":"node/9/9/9","kind":"fold"}"#, 1.6)
            .is_empty());
        // Not a `StructOp` at all.
        assert!(engine.preview_op(r#"{"op":"teleport"}"#, 1.6).is_empty());
        // And a source where a processor belongs — the grammar's own refusal.
        assert!(engine
            .preview_op(r#"{"op":"insert","key":"node","kind":"vco"}"#, 1.6)
            .is_empty());
    }

    /// The scale is what turns θ into a price. Shipping it keyed by name (and
    /// only after a standardizer exists) is what keeps the client from
    /// inventing one.
    #[test]
    fn the_phi_scale_ships_by_name_once_it_exists() {
        let mut engine = WasmEngine::new(0x9A3, 6);
        assert_eq!(engine.phi_scale(), "{}", "no standardizer, no scale");
        while engine.fill_step(3) > 0 {}
        engine.standardize_now();
        let map: std::collections::BTreeMap<String, f64> =
            serde_json::from_str(&engine.phi_scale()).unwrap();
        assert_eq!(map.len(), Features::phi_names().len());
        for name in Features::phi_names() {
            let s = *map.get(name).expect("every φ coordinate is priced");
            assert!(s > 0.0, "{name} scaled by a non-positive divisor");
        }
        // The one the sockets are priced through most often.
        assert!(map.contains_key("n_filter"));
    }
}
