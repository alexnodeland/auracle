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

mod explain;
mod level;
mod live;
pub use live::LivePoly;
// PERFORM's shipped preset wirings: what they were measured from. The generator
// and its currency test use it natively (its `boot` and `warm` are native only);
// the page's wasm carries only `boot_probe` (and what it needs): a test-only
// export no script calls, which `tests/web/boot_agrees.spec.js` runs under Node
// to check that the browser's engine deals what the native one does.
pub mod shipped;

use std::cell::RefCell;
use std::sync::Arc;

use auracle_features::{
    featurize_memo, Audition, AuditionClip, CachedFeatures, ClipError, ClipSource, Face, Features,
    FeaturizeError, PhraseSpec, RenderMemo, VetFailure,
};
use auracle_grammar::{
    apply_struct_op, describe, presets, set_param, validate_tree, ParamValue, PatchGrammarPrior,
    PatchTree, StructOp,
};
use auracle_session::{
    run_walk, BankEntry, ClipChange, ClipStatus, EditOutcome, Engine, GuessMemory, GuessSkip,
    Origin, PreFeaturized, Profile, ReadmitError, RenderPolicy, SessionConfig, SessionState,
    WalkContext, WalkJob, WalkResult,
};
use level::{audition_pcm, live_makeup};
use rand::rngs::StdRng;
use rand::{RngCore, SeedableRng};
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

/// The longest take a CAPTURE holds, in seconds (`TAKE_SECONDS` in the
/// grammar, quiver's `Capture::DEFAULT_SECONDS`). RECORD stops itself a
/// little after it; the app reads it here rather than restate it.
#[wasm_bindgen]
pub fn take_seconds() -> f64 {
    auracle_grammar::TAKE_SECONDS
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

/// The persistent render cache's namespace for `phrase_json`, or `""` if the
/// phrase does not parse.
///
/// Two rows may only be compared, stored or served under the same namespace:
/// it pins the stimulus, [`auracle_features::RENDER_EPOCH`] (the featurizer's
/// own generation) and [`auracle_features::QUIVER_DSP_VERSION`] (the DSP it
/// renders with). A build whose φ differs from the one that wrote a row
/// therefore cannot read it: every row is stored under a key that begins with
/// its namespace ([`farm_key`]), so a row from another namespace is never a
/// hit, and there is no stale-row path to get wrong. The worker also hands
/// the namespace to PERFORM, which stamps the wirings it keeps with it.
///
/// The store this keys is `namespace → key → CachedFeatures`. Dropping a
/// namespace is how a cache is invalidated, and it is the *only* correct
/// granularity: φ moving invalidates everything measured under the old φ.
#[wasm_bindgen]
pub fn cache_namespace(phrase_json: &str) -> String {
    parsed_phrase(phrase_json)
        .map(|spec| auracle_features::cache_namespace(&spec))
        .unwrap_or_default()
}

thread_local! {
    /// The last phrase this instance parsed, with the text it came from.
    /// A phrase carrying an audition clip is ~600 KB of JSON, and the farm
    /// hands the same text to every `farm_render` and `farm_key`; parsing it
    /// once per instance, not once per render, is the difference. Matched on
    /// the whole text, so a new clip is never mistaken for the last one.
    static PHRASE: RefCell<Option<(String, Arc<PhraseSpec>)>> = const { RefCell::new(None) };
}

/// `phrase_json` parsed, through [`PHRASE`]; `None` if it does not parse.
fn parsed_phrase(phrase_json: &str) -> Option<Arc<PhraseSpec>> {
    let hit = PHRASE.with(|p| {
        p.borrow()
            .as_ref()
            .filter(|(text, _)| text == phrase_json)
            .map(|(_, spec)| Arc::clone(spec))
    });
    if hit.is_some() {
        return hit;
    }
    let spec = Arc::new(serde_json::from_str::<PhraseSpec>(phrase_json).ok()?);
    PHRASE.with(|p| *p.borrow_mut() = Some((phrase_json.to_owned(), Arc::clone(&spec))));
    Some(spec)
}

/// The persistent render cache's key for `(tree_json, phrase_json)`,
/// computed **without rendering it**: what a caller asks the persistent cache
/// about before paying for a render. See [`persistent_key`].
///
/// Returns `""` if either argument fails to parse, which the caller should
/// treat as a miss rather than an error: the render path validates its own
/// inputs and is the one place allowed to reject them.
#[wasm_bindgen]
pub fn farm_key(tree_json: &str, phrase_json: &str) -> String {
    let (Ok(tree), Some(spec)) = (
        serde_json::from_str::<PatchTree>(tree_json),
        parsed_phrase(phrase_json),
    ) else {
        return String::new();
    };
    persistent_key(&tree, &spec)
}

/// `"<cache_namespace>/<render_key>"`: a row's namespace, then its content
/// address.
///
/// The namespace is in every key, not only in the store's stamp, because the
/// stamp is checked once, when a farm worker opens the store (`cacheOpen` in
/// `farm.js`). A tab still running an older build keeps writing rows into a
/// store that a newer tab has since cleared and re-stamped, and the engine's
/// own check (`pre_featurized`) compares the content address alone, which a
/// DSP or featurizer change does not move. Keyed by `render_key` alone, those
/// rows were served to the newer build as current φ; keyed with the
/// namespace, they are never a hit.
fn persistent_key(tree: &PatchTree, spec: &PhraseSpec) -> String {
    format!(
        "{}/{}",
        auracle_features::cache_namespace(spec),
        auracle_features::render_key(tree, spec)
    )
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
    let (Ok(tree), Some(spec)) = (
        serde_json::from_str::<PatchTree>(tree_json),
        parsed_phrase(phrase_json),
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

/// `{"reason": code}`: why a guess has nothing to say.
fn refusal(code: &str) -> String {
    #[derive(Serialize)]
    struct Refusal<'a> {
        reason: &'a str,
    }
    serde_json::to_string(&Refusal { reason: code }).unwrap_or_default()
}

/// Every audio cable of `tree`, measured on one render of `spec`
/// ([`auracle_features::probe_cables`]), as [`WasmEngine::edit_cable_levels`]
/// replies; `null` when the tree does not compile.
fn cable_levels_json(tree: &PatchTree, spec: &PhraseSpec) -> String {
    auracle_features::cable_levels(tree, spec)
        .ok()
        .and_then(|p| serde_json::to_string(&p).ok())
        .unwrap_or_else(|| "null".into())
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

/// [`WasmEngine::audition_clip`]'s reply: the status, and the sentence the
/// app shows for it. Serialized from this struct (ADR-002).
#[derive(Serialize)]
struct ClipView<'a> {
    note: &'static str,
    #[serde(flatten)]
    clip: &'a ClipStatus,
}

/// [`WasmEngine::set_audition_clip`]'s reply. Ids are `u32` at the boundary.
#[derive(Serialize)]
struct ClipReply<'a> {
    ok: bool,
    note: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    clip: &'a ClipStatus,
    remeasured: Vec<u32>,
    unmeasured: Vec<u32>,
}

/// The sentence the app shows for which clip the model hears the sounds
/// that listen through.
fn clip_note(status: &ClipStatus) -> &'static str {
    match (status.source, status.unreadable.is_some()) {
        (ClipSource::Captured, _) => {
            "The model hears sounds with an input through the clip captured from it."
        }
        (ClipSource::Reference, false) => {
            "The model hears sounds with an input through a built-in phrase until your input is captured."
        }
        (ClipSource::Reference, true) => {
            "The saved input clip didn't load, so the model hears sounds with an input through the built-in phrase. Capture your input again to replace it."
        }
    }
}

/// One sound the last restore held back, as [`WasmEngine::held_sounds`]
/// lists it. Ids are `u32` at the boundary.
#[derive(Serialize)]
struct HeldView<'a> {
    id: u32,
    /// The node key of the CAPTURE to record again
    /// (`PatchTree::lost_take_key`): what the page records into and
    /// [`WasmEngine::readmit_held`] fills.
    #[serde(skip_serializing_if = "Option::is_none")]
    capture: Option<String>,
    /// Its term, as it was saved, so the page can record it again without
    /// opening it (a held sound is not in the pool, and the bench opens pool
    /// sounds). Serialized from its type, in declaration order (ADR-002),
    /// as every tree the page is sent is: not through a `Value`, whose map
    /// sorts the keys.
    tree: &'a auracle_grammar::PatchTree,
    /// The player's name for it, if it has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    /// The name it was shown under, if it had a generated one.
    #[serde(skip_serializing_if = "Option::is_none")]
    auto_name: Option<String>,
    note: &'static str,
}

/// The sentence for a held sound.
const HELD_NOTE: &str = "Its take couldn’t be read. It’s kept safe until you record it again.";

/// [`WasmEngine::readmit_held`]'s reply.
#[derive(Serialize)]
struct ReadmitReply {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'static str>,
}

/// The sentence for a held sound that did not come back.
fn readmit_note(e: &ReadmitError) -> &'static str {
    match e {
        ReadmitError::NotHeld => "That sound isn’t waiting for a new take, so nothing changed.",
        ReadmitError::NoTake => "That take couldn’t be read, so the sound is still kept safe.",
        ReadmitError::NothingToReplace => {
            "That sound has no lost take to replace, so nothing changed."
        }
        ReadmitError::DoesNotVet(_) => {
            "With that take it still makes no usable sound, so it’s still kept safe."
        }
    }
}

/// The sentence for a capture the engine would not take.
fn refused_note(e: &ClipError) -> &'static str {
    match e {
        ClipError::Silent { .. } => {
            "That capture was silent, so nothing changed. Check the input, then capture again."
        }
        _ => "That capture couldn't be used, so nothing changed. Try capturing again.",
    }
}

/// A generation's jobs, as [`WasmEngine::refine_jobs`] replies: the context
/// every walk shares (`null` when there is no taste yet) and the jobs in
/// absorption order. Serialized from this struct, so each tree goes out in
/// its own key order (ADR-002).
#[derive(Serialize)]
struct JobsReply<'a> {
    context: Option<&'a WalkContext>,
    jobs: &'a [WalkJob],
    /// Why nothing was opened, for a breed toward a sound of your own
    /// (`Engine::own_breed_blocked`: `no_sound`, `untaught`, `stale_sound`).
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
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

/// How many of the pool's sounds, and of the presets, a sound of your own's
/// reply names as nearest. The card shows three; six leave room for the
/// ones already gone from the pool.
const OWN_NEAREST: usize = 6;

/// A sound of your own, as [`WasmEngine::own_sound_set`] and
/// [`WasmEngine::own_sound`] reply. Serialized from this struct.
#[derive(Serialize)]
struct OwnReply<'a> {
    ok: bool,
    /// Why the file was not measured: a flag the app words
    /// (`auracle_features::FileError::code`).
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    truncated: Option<bool>,
    /// Standardized φ, every coordinate in `phi_names` order, `null` where
    /// the file does not measure it. `null` as a whole before the pool has
    /// a standardizer.
    #[serde(skip_serializing_if = "Option::is_none")]
    z: Option<Option<Vec<Option<f64>>>>,
    /// The names of the coordinates a file does not measure.
    #[serde(skip_serializing_if = "Option::is_none")]
    masked: Option<Vec<&'static str>>,
    /// Its place on TASTE's map (`taste_map`'s axes), or `null`.
    #[serde(skip_serializing_if = "Option::is_none")]
    map: Option<Option<auracle_session::OwnPoint>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    nearest: Option<Vec<OwnNear>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    nearest_presets: Option<Vec<OwnNearPreset>>,
    /// The pool ids a breed toward it would start from, nearest first;
    /// empty before there is a taste to breed with.
    #[serde(skip_serializing_if = "Option::is_none")]
    seeds: Option<Vec<u32>>,
}

#[derive(Serialize)]
struct OwnNear {
    id: u32,
    distance: f64,
}

#[derive(Serialize)]
struct OwnNearPreset {
    index: usize,
    name: String,
    distance: f64,
}

/// The presets' audio φ from the app's shipped wirings
/// (`apps/web/perform-wirings.json`): each preset's `data.z` under the
/// file's `standardizer`, back to raw. Presets the bank does not name today
/// are skipped.
fn presets_from_wirings(json: &str) -> Vec<auracle_session::PresetPhi> {
    #[derive(serde::Deserialize)]
    struct Std {
        mean: Vec<f64>,
        std: Vec<f64>,
    }
    #[derive(serde::Deserialize)]
    struct Data {
        z: Vec<f64>,
    }
    #[derive(serde::Deserialize)]
    struct Row {
        name: String,
        data: Data,
    }
    #[derive(serde::Deserialize)]
    struct File {
        standardizer: Std,
        presets: Vec<Row>,
    }
    let Ok(f) = serde_json::from_str::<File>(json) else {
        return Vec::new();
    };
    let names: Vec<&'static str> = auracle_grammar::preset_bank()
        .iter()
        .map(|p| p.name)
        .collect();
    f.presets
        .into_iter()
        .filter_map(|r| {
            let index = names.iter().position(|n| *n == r.name)?;
            let n = f.standardizer.mean.len().min(f.standardizer.std.len());
            if r.data.z.len() != n {
                return None;
            }
            let audio = r
                .data
                .z
                .iter()
                .zip(&f.standardizer.mean)
                .zip(&f.standardizer.std)
                .map(|((z, m), s)| z * s + m)
                .collect();
            Some(auracle_session::PresetPhi {
                index,
                name: r.name,
                audio,
            })
        })
        .collect()
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
    /// Wander's drift. Each takes one draw when it begins and walks on a
    /// generator of its own seeded from it ([`Held`]), so a walk paused and
    /// resumed, or another begun beside it, cannot move what it finds.
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
    /// The model's guesses' skips and last taken guess, per patch: what the
    /// ranking cannot remember.
    guesses: GuessMemory,
    /// The patch the bench's guesses are filed under: the pool id it was
    /// opened from, until keep as new moves it to the new sound's id.
    ///
    /// Not `bench_original`, which stays the id the bench was opened from
    /// after a commit (a later commit duel plays against it, and the page
    /// does not reopen the kept sound): skips made after keep as new were
    /// filed under the old id, so the kept sound, opened again, offered
    /// them back.
    guess_key: Option<u64>,
    /// The last key [`Self::guess_patch_as`] made for a patch of its own,
    /// counting down from `u32::MAX`, clear of every pool id.
    guess_fresh: u64,
    /// Every preset's audio φ, for the presets nearest a sound of your own
    /// ([`WasmEngine::own_presets_set`]). Empty until the worker hands over
    /// the shipped wirings; then only pool members are named as nearest.
    own_presets: Vec<auracle_session::PresetPhi>,
    /// PERFORM's walks in the middle ([`WasmEngine::perform_offer_begin`],
    /// [`WasmEngine::perform_drift_begin`]), by handle.
    jobs: std::collections::HashMap<u32, Held>,
    next_job: u32,
}

/// A PERFORM walk begun and not yet answered: the job, the generator it
/// draws from, and what its reply says about it.
struct Held {
    job: auracle_session::PerformJob,
    /// The walk's own stream, seeded from one draw of the session's `perform`
    /// stream when it began. So what a walk draws never depends on what
    /// else was drawn between its steps, however many walks are paused at
    /// once (ADR-001).
    rng: StdRng,
    /// The performed state it grows from.
    home: PatchTree,
    drift: bool,
    /// Whether the walk's target was taste-directed when it began: what the
    /// reply says, whatever was imported or fitted since.
    taste: bool,
}

impl WasmEngine {
    /// Hold a begun walk and answer with its handle, or with why it cannot
    /// start.
    fn hold(
        &mut self,
        made: Result<auracle_session::PerformJob, auracle_session::RefineOutcome>,
        home: PatchTree,
        drift: bool,
    ) -> String {
        match made {
            Ok(job) => {
                // The next handle not in hand (a handle counts up and skips 0,
                // so only a walk held across four billion others could be
                // met on the way round).
                while self.next_job == 0 || self.jobs.contains_key(&self.next_job) {
                    self.next_job = self.next_job.wrapping_add(1);
                }
                let id = self.next_job;
                self.next_job = self.next_job.wrapping_add(1);
                let rng = StdRng::seed_from_u64(self.rng.perform.next_u64());
                self.jobs.insert(
                    id,
                    Held {
                        job,
                        rng,
                        home,
                        drift,
                        taste: self.engine.has_taste(),
                    },
                );
                serde_json::json!({ "job": id }).to_string()
            }
            Err(why) => serde_json::json!({ "reason": why.as_str() }).to_string(),
        }
    }

    /// Run a begun walk (`begun`, the reply of a `_begin`) to the end and
    /// answer it: the one-call forms of the offer and the drift.
    fn run_job(&mut self, begun: &str) -> String {
        let Some(id) = serde_json::from_str::<serde_json::Value>(begun)
            .ok()
            .and_then(|v| v.get("job").and_then(|j| j.as_u64()))
        else {
            return begun.to_string();
        };
        let id = id as u32;
        while self.perform_job_step(id, u32::MAX) {}
        self.perform_job_finish(id)
    }

    /// The reply for a walk's verdict: the offer's (`makeup`, `diff`, and
    /// `moved` for an aimed one) or the drift's (`knobs`).
    fn job_reply(
        &self,
        grown: Result<PatchTree, auracle_session::RefineOutcome>,
        home: &PatchTree,
        moved: Option<f64>,
        drift: bool,
        taste: bool,
    ) -> String {
        let t = match grown {
            Ok(t) => t,
            Err(why) => return serde_json::json!({ "reason": why.as_str() }).to_string(),
        };
        if drift {
            let knobs =
                auracle_session::perform::live_knobs(&t, self.engine.cfg.phrase.sample_rate);
            return tree_reply(&TreeReply {
                tree: &t,
                knobs: Some(&knobs),
                makeup: None,
                taste: Some(taste),
                diff: None,
                moved: None,
            });
        }
        let makeup = featurize_memo(&t, &self.engine.cfg.phrase, self.engine.memo(), false)
            .map(|(cf, _)| live_makeup(&cf.features))
            .unwrap_or(1.0);
        // What changed, so the B strip can say it ("+chorus, cutoff 448 Hz→1.2
        // kHz") instead of only "an offer is waiting".
        let diff = auracle_grammar::tree_diff(home, &t);
        tree_reply(&TreeReply {
            tree: &t,
            knobs: None,
            makeup: Some(makeup),
            taste: Some(taste),
            diff: Some(&diff),
            moved,
        })
    }
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

/// The named controls a PERFORM measurement wires: the palette entries a
/// JSON array of indices names, or the six of `CONTROLS` when there is no
/// array, which is what the panel has always been measured with. The array
/// is read entry by entry: each non-negative whole number is an index (an
/// out-of-range one or a repeat is dropped,
/// `auracle_session::perform::palette_controls`), and anything else in it
/// (a negative, a fraction, a string) is dropped on its own rather than
/// turning the whole request into the six. An array with nothing valid in it
/// wires nothing.
fn palette_set(json: Option<&str>) -> Vec<auracle_session::perform::NamedControl> {
    use auracle_session::perform::{palette_controls, CONTROLS, PALETTE};
    let Some(serde_json::Value::Array(items)) =
        json.and_then(|j| serde_json::from_str::<serde_json::Value>(j).ok())
    else {
        return CONTROLS.to_vec();
    };
    let index = |v: &serde_json::Value| -> Option<usize> {
        if let Some(k) = v.as_u64() {
            return usize::try_from(k).ok();
        }
        // `6.0` is the index 6; `1.5`, `-1` and `1e21` are not indices.
        let f = v.as_f64()?;
        (f >= 0.0 && f.fract() == 0.0 && f < PALETTE.len() as f64).then_some(f as usize)
    };
    palette_controls(&items.iter().filter_map(index).collect::<Vec<_>>())
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
            guesses: GuessMemory::default(),
            guess_key: None,
            guess_fresh: u32::MAX as u64 + 1,
            own_presets: Vec::new(),
            jobs: std::collections::HashMap::new(),
            next_job: 1,
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

    /// The makeup of the tree on the bench if the engine has measured that
    /// exact tree before (a feature-memo hit, no render), else −1. After
    /// `edit_set_tree_apply`, `edit_makeup` is still the makeup of the tree
    /// being left; an undo or a redo lands on a tree measured when it was
    /// made, and the worker hands the voices that tree at this makeup
    /// before its render, or waits for the render when it is unknown. The
    /// tree being left's makeup put a redone selector up to 27 dB hot.
    pub fn edit_known_makeup(&self) -> f64 {
        let Some(tree) = &self.bench_tree else {
            return -1.0;
        };
        let key = auracle_features::render_key(tree, &self.phrase());
        match self.engine.memo().get(&key) {
            Some(hit) => live_makeup(&hit.features),
            None => -1.0,
        }
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
        // Another session's ids: its patches are not the ones skipped here.
        self.guesses = GuessMemory::default();
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

    // ------------------------------------------------------------------
    // Faces (Plan-005 task 3; `auracle_features::face`)
    // ------------------------------------------------------------------

    /// The face of pool member `id` ([`auracle_features::Face`], its
    /// [`auracle_features::FACE_LEN`] encoded bytes), or empty.
    ///
    /// From the featurization memo when the row there carries one (every
    /// render since faces exist does), else from the audition if it is
    /// resident. Only with `render` does it render the member (about half a
    /// second): a row restored from a store written before faces existed.
    /// That render is not kept, so it evicts no resident audition. A face is
    /// a picture of the render and never enters φ.
    pub fn face_of(&mut self, id: u32, render: bool) -> Vec<u8> {
        let Some(i) = self.engine.find(id as u64) else {
            return Vec::new();
        };
        let key = self.engine.pool[i].key.clone();
        if let Some(face) = self.engine.memo().get(&key).and_then(|c| c.face) {
            return face.bytes().to_vec();
        }
        if let Some(a) = self.engine.pool[i]
            .render
            .clone()
            .or_else(|| self.engine.memo().get_audio(&key))
        {
            return self.remember_face(&key, &a).bytes().to_vec();
        }
        if !render {
            return Vec::new();
        }
        // Rendered for its face alone, and not kept: making it resident
        // (`Engine::render_of`) would push a sound the player is about to
        // hear out of the small audition cache, for a picture.
        let c = &self.engine.pool[i];
        match auracle_features::render_playback(
            &c.tree,
            &self.engine.cfg.phrase,
            c.features.gain_db,
        ) {
            Ok(a) => self.remember_face(&key, &a).bytes().to_vec(),
            Err(_) => Vec::new(),
        }
    }

    /// The face of the memo row `key` (a render key), or empty: what the
    /// model's guess rendered for each of its candidates (`Guess::key`), the
    /// patch with that module, as rendered. Never renders.
    pub fn face_of_key(&self, key: &str) -> Vec<u8> {
        if let Some(face) = self.engine.memo().get(key).and_then(|c| c.face) {
            return face.bytes().to_vec();
        }
        self.engine
            .memo()
            .get_audio(key)
            .map(|a| self.remember_face(key, &a).bytes().to_vec())
            .unwrap_or_default()
    }

    /// `"<cache_namespace>/<render_key>"` of pool member `id` (as
    /// [`farm_key`] names a tree's), the key a face is stored under; empty
    /// for an id not in the pool.
    pub fn face_key(&self, id: u32) -> String {
        self.engine
            .find(id as u64)
            .map(|i| {
                format!(
                    "{}/{}",
                    auracle_features::cache_namespace(&self.engine.cfg.phrase),
                    self.engine.pool[i].key
                )
            })
            .unwrap_or_default()
    }

    /// The face of a tree (a preset, an offer, the patch on the bench), or
    /// empty: from the memo (an offer, a PERFORM measurement or an edit has
    /// featurized it), else, with `render`, by featurizing it. A tree that
    /// does not vet has no face.
    pub fn face_of_tree(&self, tree_json: &str, render: bool) -> Vec<u8> {
        let Ok(tree) = serde_json::from_str::<PatchTree>(tree_json) else {
            return Vec::new();
        };
        let spec = self.phrase();
        let key = auracle_features::render_key(&tree, &spec);
        if let Some(face) = self.engine.memo().get(&key).and_then(|c| c.face) {
            return face.bytes().to_vec();
        }
        if let Some(a) = self.engine.memo().get_audio(&key) {
            return self.remember_face(&key, &a).bytes().to_vec();
        }
        if !render {
            return Vec::new();
        }
        match featurize_memo(&tree, &spec, self.engine.memo(), false) {
            Ok((cached, _)) => cached.face.map(|f| f.bytes().to_vec()).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
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
                reason: None,
            },
            None => JobsReply {
                context: None,
                jobs: &[],
                reason: None,
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

    // ---- a sound of your own (see `auracle_session::own`) ----

    /// Bring a sound of your own: `pcm`, a decoded file mixed to mono, at
    /// `sample_rate`, called `name` (the file's name; "Your sound" when
    /// left out). Measured as `auracle_features::featurize_file` measures a
    /// recording, kept by the session (saved with it as features, never the
    /// audio), and replied as JSON:
    ///
    /// ```json
    /// {"ok":true,"name":"Field recording 03","seconds":12.4,"truncated":false,
    ///  "z":[0.41,null,…],"masked":["centroid_std:p2",…],
    ///  "map":{"x":1.2,"y":-0.4,"observed":5},
    ///  "nearest":[{"id":17,"distance":0.38},…],
    ///  "nearest_presets":[{"index":12,"name":"Glass Pad","distance":0.21},…],
    ///  "seeds":[17,4,…]}
    /// ```
    ///
    /// or `{"ok":false,"error":"silent"}` (`bad_rate`, `too_long`,
    /// `too_short`, `non_finite`, `silent`), leaving any sound brought
    /// before in place. `z` is every coordinate of φ in `phi_names` order,
    /// `null` where a file does not measure it; distances are in σ over the
    /// coordinates it does. `nearest_presets` is empty until
    /// [`WasmEngine::own_presets_set`] has run.
    ///
    /// The caller sends the file mixed to mono, at most 120 s (`too_long`
    /// means cut it and send it again) and at most 48 kHz: the samples are
    /// copied into linear memory, which never shrinks (two minutes grow it by
    /// about 42 MB at 48 kHz and 108 MB at 192 kHz). `too_short` is under
    /// half a second of sound, which does not measure what a file is placed
    /// by; there is nothing to retry. After any refusal, ask
    /// [`WasmEngine::own_sound`] to redraw the sound still kept.
    ///
    /// Costs the file's analysis and one map frame, in one uninterruptible
    /// call. For 30 s of sound, measured in wasm under node
    /// (`examples/own_cost.mjs`, an M3 Max under load): 0.16 s at 44.1 kHz,
    /// 0.31 s at 48, 0.52 s at 96 and 0.94 s at 192, most of it resampling.
    pub fn own_sound_set(&mut self, pcm: &[f32], sample_rate: f64, name: Option<String>) -> String {
        match auracle_features::featurize_file(pcm, sample_rate) {
            Ok(f) => {
                let name = name
                    .as_deref()
                    .map(str::trim)
                    .filter(|n| !n.is_empty())
                    .unwrap_or("Your sound");
                self.engine.own_set(name, &f);
                self.own_sound()
            }
            Err(e) => serde_json::to_string(&OwnReply {
                ok: false,
                error: Some(e.code()),
                name: None,
                seconds: None,
                truncated: None,
                z: None,
                masked: None,
                map: None,
                nearest: None,
                nearest_presets: None,
                seeds: None,
            })
            .unwrap_or_else(|_| "null".into()),
        }
    }

    /// The sound of your own as it stands now, in
    /// [`WasmEngine::own_sound_set`]'s reply, or `null` when there is none:
    /// after a reload (the session brings it back), or after the pool or
    /// the taste has moved its neighbours and its place.
    pub fn own_sound(&self) -> String {
        let Some(own) = self.engine.own_sound() else {
            return "null".into();
        };
        let reply = OwnReply {
            ok: true,
            error: None,
            name: Some(&own.name),
            seconds: Some(own.seconds),
            truncated: Some(own.truncated),
            z: Some(self.engine.own_z()),
            masked: Some(auracle_features::file_masked_names()),
            map: Some(self.engine.own_on_map(auracle_session::OWN_PLACEMENT)),
            nearest: Some(
                self.engine
                    .own_nearest(OWN_NEAREST)
                    .into_iter()
                    .map(|(id, distance)| OwnNear {
                        id: id as u32,
                        distance,
                    })
                    .collect(),
            ),
            nearest_presets: Some(
                self.engine
                    .own_nearest_presets(OWN_NEAREST, &self.own_presets)
                    .into_iter()
                    .filter_map(|(index, distance)| {
                        let name = self.own_presets.iter().find(|p| p.index == index)?;
                        Some(OwnNearPreset {
                            index,
                            name: name.name.clone(),
                            distance,
                        })
                    })
                    .collect(),
            ),
            seeds: Some(
                self.engine
                    .own_seeds()
                    .into_iter()
                    .map(|id| id as u32)
                    .collect(),
            ),
        };
        serde_json::to_string(&reply).unwrap_or_else(|_| "null".into())
    }

    /// Put the sound of your own down. Returns whether there was one.
    pub fn own_sound_clear(&mut self) -> bool {
        self.engine.own_clear()
    }

    /// Hand over every preset's audio φ for the presets nearest a sound of
    /// your own: the text of the app's `perform-wirings.json`, whose
    /// `presets[].data.z` and `standardizer` are each preset's measurement
    /// (fingerprinted against the presets by `make perform-wirings`).
    /// Returns how many presets were read; 0 leaves the presets unknown and
    /// only pool members are named as nearest.
    pub fn own_presets_set(&mut self, wirings_json: &str) -> u32 {
        self.own_presets = presets_from_wirings(wirings_json);
        self.own_presets.len() as u32
    }

    /// Open a generation bred toward the sound of your own, as data for the
    /// render farm, in [`WasmEngine::refine_jobs`]'s shape: its `context`
    /// carries `toward` (the target and the coordinates it is measured on),
    /// which tilts every walk, and its jobs start from the pool members
    /// nearest the sound. `context` is `null` (and nothing is opened) without
    /// a sound or before there is a taste to breed with. Absorb and finish
    /// as any generation. Draws from the evolution stream.
    pub fn refine_toward_jobs(&mut self) -> String {
        let opened = self.engine.refine_toward_jobs(&mut self.rng.refine);
        let reply = match &opened {
            Some((ctx, jobs)) => JobsReply {
                context: Some(ctx),
                jobs,
                reason: None,
            },
            None => JobsReply {
                context: None,
                jobs: &[],
                reason: Some(self.engine.own_breed_blocked().unwrap_or("untaught")),
            },
        };
        serde_json::to_string(&reply).unwrap_or_else(|_| r#"{"context":null,"jobs":[]}"#.into())
    }

    // ---- performance (see `auracle_session::perform`) ----

    /// Measure the audio Jacobian of the performed state (`tree` plus knob
    /// `overrides`) and wire the named controls onto it.
    /// Returns `{addrs, values, z, wiring: [Wiring]}` as JSON, or `null` when
    /// the session has no standardizer yet or the tree does not vet. Costs one
    /// render per continuous knob, through the memo.
    ///
    /// `controls` is which to wire: a JSON array of indices into the
    /// palette's eighteen (`auracle_session::perform::PALETTE`), read entry
    /// by entry (`palette_set`). `wiring` then holds one entry per valid
    /// index, in the order asked, each carrying its `name` and its palette
    /// `index`. **Name a control back by its `index`, never by its position
    /// in `wiring`**: asked for `[16, 6]`, the first wiring is Bite (index
    /// 16), and position 0 is Bright to `perform_offer` and `perform_graft`.
    /// An array with no valid index wires nothing and renders only the patch
    /// itself (for `addrs`, `values` and `z`). Left out (`undefined` from
    /// JS), it is the six of `CONTROLS` in order, so each position is its
    /// index, exactly as before the palette: what today's panel asks for.
    pub fn perform_wire(
        &self,
        tree_json: &str,
        overrides_json: &str,
        controls: Option<String>,
    ) -> String {
        let Some(tree) = performed_tree(tree_json, overrides_json) else {
            return "null".into();
        };
        let set = palette_set(controls.as_deref());
        let Some((jac, wiring)) =
            self.engine
                .wire_named(&tree, &set, &std::collections::HashSet::new())
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

    /// The renders [`Self::perform_wire`] on this performed state would make
    /// next and the memo does not hold: JSON `[{"key", "tree"}]` (`tree` as
    /// JSON text, ready for a farm job), empty when the measurement can be
    /// finished from the memo — see `Engine::wire_plan`. `failed_json` is a
    /// JSON array of the keys already known not to vet. Renders nothing, so
    /// it is cheap enough to ask between the player's requests. `controls`
    /// as for [`Self::perform_wire`].
    pub fn perform_wire_plan(
        &self,
        tree_json: &str,
        overrides_json: &str,
        failed_json: &str,
        controls: Option<String>,
    ) -> String {
        let Some(tree) = performed_tree(tree_json, overrides_json) else {
            return "[]".into();
        };
        let failed = key_set(failed_json);
        let set = palette_set(controls.as_deref());
        let need: Vec<serde_json::Value> = self
            .engine
            .wire_plan_named(&tree, &set, &failed)
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
    /// answer is the one `perform_wire` would give. `controls` as there, and
    /// the same set the plan was asked for.
    pub fn perform_wire_known(
        &self,
        tree_json: &str,
        overrides_json: &str,
        failed_json: &str,
        controls: Option<String>,
    ) -> String {
        let Some(tree) = performed_tree(tree_json, overrides_json) else {
            return "null".into();
        };
        let set = palette_set(controls.as_deref());
        let Some((jac, wiring)) = self.engine.wire_named(&tree, &set, &key_set(failed_json)) else {
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
    /// gives named control `k` (a palette index, a wiring's `index`) something
    /// to turn grafted onto its output
    /// ([`auracle_session::perform::graft_for`]): `{tree}`, or `{reason:
    /// "no_graft"}` when there is none to give (as for all of the palette's
    /// twelve so far), or `null` if the tree does
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
    ///
    /// One call, uninterruptible: the worker uses
    /// [`Self::perform_drift_begin`] and steps it, and this is those three
    /// calls in a row, so the two give the same drift.
    pub fn perform_drift(
        &mut self,
        tree_json: &str,
        overrides_json: &str,
        locks_json: &str,
        steps: u32,
        sigma: f64,
    ) -> String {
        let begun = self.perform_drift_begin(tree_json, overrides_json, locks_json, steps, sigma);
        self.run_job(&begun)
    }

    /// A structural offer from the performed state: the locked walk with only
    /// the player's locks. Returns `{tree, makeup, taste, diff}` — makeup so the
    /// offer is heard at matched loudness, taste as for [`Self::perform_drift`]
    /// — or `{reason}` / `null` as there. Inserts nothing into the pool.
    ///
    /// With `control` (a palette index, [`auracle_session::perform::PALETTE`]
    /// order: 0–5 are the panel's six, 6–17 the palette's twelve; a wiring's
    /// `index`) the offer is a search control's, aimed along that control's
    /// direction, up for a positive `sign` and down otherwise
    /// ([`auracle_session::Engine::offer_toward`]), and the reply adds `moved`:
    /// how far the offer went that way, in σ, positive toward the control's
    /// high word — so the page can say "grittier by 0.8σ", or that it did not
    /// move that way. Without `control` it is the Offer button's undirected
    /// walk, and there is no `moved`.
    ///
    /// One call, uninterruptible: the worker uses [`Self::perform_offer_begin`]
    /// and steps it, and this is those three calls in a row, so the two give
    /// the same offer.
    pub fn perform_offer(
        &mut self,
        tree_json: &str,
        overrides_json: &str,
        locks_json: &str,
        steps: u32,
        control: Option<u32>,
        sign: Option<f64>,
    ) -> String {
        let begun =
            self.perform_offer_begin(tree_json, overrides_json, locks_json, steps, control, sign);
        self.run_job(&begun)
    }

    /// Begin [`Self::perform_offer`] as a job the worker can step: returns
    /// `{"job": n}` (a handle for [`Self::perform_job_step`],
    /// [`Self::perform_job_finish`] and [`Self::perform_job_drop`]), or
    /// `{reason}` / `null` exactly as `perform_offer` would answer a walk that
    /// cannot start. The walk draws from its own stream, seeded here from one
    /// draw of the session's PERFORM stream, and reads the target (the prior,
    /// the posterior, the memo) as it stands now.
    pub fn perform_offer_begin(
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
        let made = match control {
            Some(k) => self.engine.offer_aimed_job(
                &tree,
                &locks,
                steps,
                k as usize,
                sign.unwrap_or(1.0),
                auracle_session::perform::AIM_GAMMA,
                auracle_session::perform::AIM_WALKS,
            ),
            None => self.engine.offer_job(&tree, &locks, steps),
        };
        self.hold(made, tree, false)
    }

    /// Begin [`Self::perform_drift`] as a job, as
    /// [`Self::perform_offer_begin`] does for an offer.
    pub fn perform_drift_begin(
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
        let made = self
            .engine
            .drift_job(&tree, &locks, steps.max(1) as usize, sigma);
        self.hold(made, tree, true)
    }

    /// Advance walk `job` by up to `n` steps, each one proposal (at most one
    /// phrase render):
    /// the unit the worker can be interrupted at. True while there is more to
    /// do; false once the walk has its verdict (or `job` is not a walk in
    /// hand), and then [`Self::perform_job_finish`] answers.
    pub fn perform_job_step(&mut self, job: u32, n: u32) -> bool {
        match self.jobs.get_mut(&job) {
            Some(h) => h.job.step(&mut h.rng, n.max(1) as usize),
            None => false,
        }
    }

    /// The reply of walk `job`, as [`Self::perform_offer`] or
    /// [`Self::perform_drift`] gives it; the handle is spent. A walk stopped
    /// before its end answers as a walk that did not move, so call this once
    /// [`Self::perform_job_step`] has said false. `null` for a walk not in
    /// hand.
    pub fn perform_job_finish(&mut self, job: u32) -> String {
        let Some(h) = self.jobs.remove(&job) else {
            return "null".into();
        };
        let Held {
            job,
            home,
            drift,
            taste,
            ..
        } = h;
        let (grown, moved) = job.finish_moved();
        self.job_reply(grown, &home, moved, drift, taste)
    }

    /// Give up walk `job` (its patch was left behind): nothing is answered
    /// and the handle is spent. False for a walk not in hand.
    pub fn perform_job_drop(&mut self, job: u32) -> bool {
        self.jobs.remove(&job).is_some()
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
    ///  "may_replace":[40,3, …],
    ///  "direction":{"gx":0.031,"gy":-0.012,"r2":0.42}}
    /// ```
    ///
    /// `direction` is which way liking rises across the last map drawn
    /// (`auracle_session::liking_direction`, in map units), what LEARNING
    /// draws as its arrow; `null` before a fit or a map.
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

    /// Every forecast [`Self::calibration`] scores, oldest first, as JSON:
    ///
    /// ```json
    /// [{"p_a":0.62,"chose_a":true,"random_check":false,"provenance":"duel"}, …]
    /// ```
    ///
    /// Each is the posterior's `P(A wins)` taken before the answer joined
    /// the log, so LEARNING draws the model's forecasts one by one (the chance
    /// it gave the sound you picked, `p_a` or `1 − p_a`) rather than only
    /// their summary. None exist before the first fit: there is no posterior
    /// to forecast with. They persist with the session.
    pub fn forecasts(&self) -> String {
        serde_json::to_string(&self.engine.forecasts).unwrap_or_else(|_| "[]".into())
    }

    /// Every pool member's standardized features, as JSON:
    ///
    /// ```json
    /// {"names":["centroid_mean:p2", …],"rows":[{"id":12,"z":[0.41,-1.2, …]}, …]}
    /// ```
    ///
    /// `z` is the candidate's φ through the current standardizer
    /// (`Candidate::phi_std`), in `names` order: the coordinates θ is a
    /// weight on. LEARNING shades the map by one of them while a weight is
    /// pointed at. Members not yet featurized, or everything before a
    /// standardizer exists, are left out. 40 × 44 numbers: cheap enough to
    /// ride every views post.
    pub fn pool_features(&self) -> String {
        let rows: Vec<serde_json::Value> = self
            .engine
            .pool
            .iter()
            .filter(|c| !c.phi_std.is_empty())
            .map(|c| serde_json::json!({ "id": c.id, "z": c.phi_std }))
            .collect();
        serde_json::json!({ "names": Features::phi_names(), "rows": rows }).to_string()
    }

    /// The numbers LEARNING's math states, read from the engine rather than
    /// written twice:
    ///
    /// ```json
    /// {"audio":18,"structural":26,"draws":500,"styles":2,"styles_max":5,
    ///  "obs_per_style":20}
    /// ```
    ///
    /// `audio` and `structural` are the lengths of φ's two halves
    /// (`AudioFeatures::NAMES`, `StructFeatures::NAMES`). `draws` is how many
    /// posterior draws the model holds now, or the most a fit keeps
    /// (`auracle_taste::model::KEEP`) before the first fit. `styles` is the
    /// lenses the current fit was allowed (0 before it), `styles_max` the cap
    /// (`SessionConfig::k_styles`), and a fit over `n` observations is
    /// allowed `1 + n / obs_per_style` of them ([`auracle_session::OBS_PER_STYLE`]).
    pub fn model_facts(&self) -> String {
        let (draws, styles) = match &self.engine.posterior {
            Some(p) => (p.samples.len(), p.k_styles()),
            None => (auracle_taste::model::KEEP, 0),
        };
        serde_json::json!({
            "audio": auracle_features::AudioFeatures::NAMES.len(),
            "structural": auracle_features::StructFeatures::NAMES.len(),
            "draws": draws,
            "styles": styles,
            "styles_max": self.engine.cfg.k_styles,
            "obs_per_style": auracle_session::OBS_PER_STYLE,
        })
        .to_string()
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

    /// Preset `index`'s tree as JSON, or empty: what the worker asks a
    /// preset's face by (a preset row, a warm-start card) without inserting
    /// it into the bank.
    pub fn preset_tree_json(&self, index: usize) -> String {
        presets()
            .into_iter()
            .nth(index)
            .and_then(|(_, tree)| serde_json::to_string(&tree).ok())
            .unwrap_or_default()
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
                // A patch opened (another, or this one again): an edit back to
                // a tree from before is no longer an undo of a taken guess.
                self.guesses.clear_taken();
                self.bench_tree = Some(self.engine.pool[i].tree.clone());
                self.bench_makeup = live_makeup(&self.engine.pool[i].features);
                // Materializes the buffer if the lazy pool had let it go: the
                // panel shows a scope the moment it opens, so the bench must
                // never start empty for a candidate that renders fine.
                self.bench_render = self.engine.render_of(id);
                self.bench_original = Some(id);
                self.guess_key = Some(id);
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
    /// unknown address, no workbench). A failed vet keeps the edit (the user
    /// asked for it) but flags it: the buffer is withheld, never played
    /// unvetted.
    pub fn edit_param(&mut self, addr: &str, value: f64, is_index: bool) -> bool {
        let ok = self.edit_param_apply(addr, value, is_index);
        if ok {
            self.edit_revet();
        }
        ok
    }

    /// Write one knob on the workbench tree **without** re-rendering: the
    /// cheap half of [`Self::edit_param`], which [`Self::edit_revet`]
    /// completes, as [`Self::edit_structure_apply`] and `edit_revet` make a
    /// structural edit. Not exported: no caller posts a selector's tree ahead
    /// of its render, because only the render measures the makeup it plays
    /// at (`examples/selector_makeup.rs`). Returns false, changing nothing,
    /// where `edit_param` would.
    fn edit_param_apply(&mut self, addr: &str, value: f64, is_index: bool) -> bool {
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
        match set_param(tree, addr, v) {
            Ok(edited) => {
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
            return "there is no sound open to edit".into();
        };
        let op: StructOp = match serde_json::from_str(op_json) {
            Ok(op) => op,
            Err(e) => return format!("the engine couldn’t read that edit ({e})"),
        };
        match apply_struct_op(tree, &op) {
            Ok(edited) => {
                self.bench_tree = Some(edited);
                self.guess_observe();
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
            return "there is no sound open to edit".into();
        }
        let mut tree: PatchTree = match serde_json::from_str(tree_json) {
            Ok(t) => t,
            Err(e) => return format!("the engine couldn’t read that patch ({e})"),
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
        self.guess_observe();
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

    /// The patch the bench's guesses are remembered under: the pool id it
    /// was opened from, or the sound keep as new last made from it
    /// (`guess_key`).
    fn guess_patch(&self) -> u64 {
        self.guess_key.unwrap_or(0)
    }

    /// Whatever the bench just became, ask the guesses' memory whether it is
    /// the patch as it was before one of its taken guesses: an undo (or the
    /// module taken out again), which counts as a skip, logged once (a family
    /// already skipped there is not logged again).
    fn guess_observe(&mut self) {
        let patch = self.guess_patch();
        let Some(tree) = &self.bench_tree else {
            return;
        };
        if let Some(skip) = self.guesses.observe(patch, tree) {
            self.log_guess("guess_skip", &skip, true);
        }
    }

    /// One row of the implicit stream for a guess: logged, as a revert is,
    /// and never evidence.
    fn log_guess(&mut self, kind: &str, skip: &GuessSkip, undo: bool) {
        #[derive(Serialize)]
        struct Detail<'a> {
            socket: &'a str,
            family: &'a str,
            undo: bool,
        }
        let detail = serde_json::to_string(&Detail {
            socket: &skip.socket,
            family: &skip.family,
            undo,
        })
        .unwrap_or_default();
        let patch = self.guess_patch();
        self.engine
            .log_event_detail(kind, patch, 0.0, &detail, Vec::new(), Vec::new());
    }

    /// What the model's guess for the patch in hand still owes (Plan-005
    /// task 9d, [`auracle_session::Engine::guess_plan`]): `{"jobs":[{"key",
    /// "cache","tree"}],"total","planned","skipped"}`, or `{"reason":
    /// "no_taste"|"full"|"no_patch"}`. Renders nothing.
    ///
    /// Each job is one render, `tree` as JSON text: on the farm,
    /// [`farm_render`] (`cache` is its key in the persistent store,
    /// namespace first, as [`farm_key`] makes it) and then
    /// [`Self::memo_absorb`]; with none, [`Self::memo_render`], one per turn.
    /// `key` is the memo's: a job that does not vet goes into `failed_json`,
    /// a JSON array of such keys. Ask again until `jobs` is empty, then
    /// [`Self::guess_rank`] with the same arguments. While the patch itself
    /// is unmeasured, it is the only job. `at` names one deeper socket by
    /// its module's key (the output's candidates otherwise); `limit` is how
    /// many candidates to render, likeliest first (0 for all;
    /// `GUESS_FLOOR`, 8, with no farm).
    pub fn guess_plan(&self, at: Option<String>, failed_json: &str, limit: u32) -> String {
        #[derive(Serialize)]
        struct Job {
            key: String,
            cache: String,
            tree: String,
        }
        #[derive(Serialize)]
        struct Plan {
            jobs: Vec<Job>,
            total: usize,
            planned: usize,
            skipped: usize,
        }
        let Some(tree) = &self.bench_tree else {
            return refusal("no_patch");
        };
        let phrase = &self.engine.cfg.phrase;
        match self.engine.guess_plan(
            tree,
            at.as_deref(),
            self.guesses.skips(self.guess_patch()),
            &key_set(failed_json),
            limit as usize,
        ) {
            Ok(p) => serde_json::to_string(&Plan {
                jobs: p
                    .jobs
                    .into_iter()
                    .map(|j| Job {
                        cache: persistent_key(&j.tree, phrase),
                        tree: serde_json::to_string(&j.tree).unwrap_or_default(),
                        key: j.key,
                    })
                    .collect(),
                total: p.total,
                planned: p.planned,
                skipped: p.skipped,
            })
            .unwrap_or_else(|_| refusal("full")),
            Err(r) => refusal(r.code()),
        }
    }

    /// The model's guesses for the patch in hand, best first by the lower
    /// bound of the gain, from the renders the memo holds
    /// ([`auracle_session::Engine::guess_rank`]): `{"guesses":[{"op",
    /// "kind","family","socket","lcb","mean","sd","p","why"}],"rendered",
    /// "planned","total","skipped","against","observations"}`, or
    /// `{"reason"}` as [`Self::guess_plan`] gives it, or `"unmeasured"` when
    /// the patch itself has not been rendered. The same arguments as the
    /// plan. Renders nothing.
    ///
    /// `op` is what TRY applies ([`Self::guess_take`]); `socket` and
    /// `family` are what a skip covers ([`Self::guess_skip`]); `p` is the
    /// pick forecast the app words; `why` the part of the gain that leads
    /// (a PERFORM control and its end word, or a structural coordinate), or
    /// null when no part leans the player's way.
    pub fn guess_rank(&self, at: Option<String>, failed_json: &str, limit: u32) -> String {
        let Some(tree) = &self.bench_tree else {
            return refusal("no_patch");
        };
        match self.engine.guess_rank(
            tree,
            at.as_deref(),
            self.guesses.skips(self.guess_patch()),
            &key_set(failed_json),
            limit as usize,
        ) {
            Ok(r) => serde_json::to_string(&r).unwrap_or_else(|_| refusal("full")),
            Err(r) => refusal(r.code()),
        }
    }

    /// File the bench's guesses under `key` from here on, and return it; 0
    /// gives the bench a key of its own that no pool id has. A patch started
    /// from nothing (PATCH's NEW PATCH) is not the sound it was started from:
    /// its skips must not be that sound's when the player goes back to it,
    /// nor that sound's skips its. The page keeps the key it is given, to
    /// file a new patch it comes back to under the same key, and gives the
    /// sound's own id back when an undo leaves the new patch. Taken guesses
    /// are forgotten (an edit back to a tree from before is no longer an
    /// undo of one). Keep as new carries whatever the key holds, as it does
    /// a sound's.
    pub fn guess_patch_as(&mut self, key: u32) -> u32 {
        self.guesses.clear_taken();
        let key = if key > 0 {
            key as u64
        } else {
            self.guess_fresh = self.guess_fresh.saturating_sub(1);
            self.guess_fresh
        };
        self.guess_key = Some(key);
        key as u32
    }

    /// Skip a guess: its family stays away from its socket for the patch in
    /// hand. `guess_json` is a guess as [`Self::guess_rank`] gives it (its
    /// `socket` and `family` are read). Logged, not evidence. False when it
    /// does not parse or was already skipped.
    pub fn guess_skip(&mut self, guess_json: &str) -> bool {
        let Ok(skip) = serde_json::from_str::<GuessSkip>(guess_json) else {
            return false;
        };
        let patch = self.guess_patch();
        let fresh = self.guesses.skip(patch, skip.clone());
        if fresh {
            self.log_guess("guess_skip", &skip, false);
        }
        fresh
    }

    /// Take a guess: apply its `op` to the bench **without** re-rendering,
    /// exactly as [`Self::edit_structure_apply`] does (and owing the same
    /// [`Self::edit_revet`]), and remember it, so that undoing it counts as a
    /// skip. Returns an empty string, or the reason the edit was refused.
    /// Not evidence: the edit is an ordinary one, and keep as new is where
    /// the player says what they thought of it.
    ///
    /// The guess must still be one for the patch in hand
    /// ([`auracle_session::guess_is_current`]: the same edit, socket and
    /// family among its candidates now). A guess ranked on an earlier tree is
    /// refused, not applied: a source ranked for an empty socket, sent after
    /// the player filled it, would otherwise wipe what they placed there.
    pub fn guess_take(&mut self, guess_json: &str) -> String {
        #[derive(serde::Deserialize)]
        struct Taken {
            op: StructOp,
            socket: String,
            family: String,
        }
        let taken: Taken = match serde_json::from_str(guess_json) {
            Ok(t) => t,
            Err(e) => return format!("the engine couldn’t read that edit ({e})"),
        };
        let Some(before) = self.bench_tree.clone() else {
            return "there is no sound open to edit".into();
        };
        if !auracle_session::guess_is_current(&before, &taken.op, &taken.socket, &taken.family) {
            return "the patch changed after that guess, so it was not placed".into();
        }
        let err = match serde_json::to_string(&taken.op) {
            Ok(op) => self.edit_structure_apply(&op),
            Err(e) => format!("the engine couldn’t read that edit ({e})"),
        };
        if err.is_empty() {
            let skip = GuessSkip {
                socket: taken.socket,
                family: taken.family,
            };
            let patch = self.guess_patch();
            self.guesses.took(patch, skip.clone(), before);
            self.log_guess("guess_take", &skip, false);
        }
        err
    }

    /// The cables of the patch in hand, measured on one render of this
    /// engine's phrase ([`auracle_features::probe_cables`]), its **audio**
    /// cables only (the compiler taps audio nodes; PATCH draws a modulation
    /// cable by its rate): `{"cables":
    /// [{"from":"node/0","to":"node","from_uid":7,"to_uid":3,"rms_db":-4.1,
    /// "peak_db":2.0}],"samples":n}`, `null` with nothing open. The cables are
    /// those [`Self::edit_describe`] draws, in its order and keyed the same
    /// way; levels are in dB re 1 V, the live meter's scale, and a cable that
    /// carries nothing reads [`auracle_features::PROBE_FLOOR_DB`]. One render
    /// (`examples/cable_cost.mjs`), so it is asked once an edit has settled,
    /// never per knob step or per quantum: while notes sound, `LivePoly`'s
    /// meter reads the cables live. It changes nothing on the bench.
    pub fn edit_cable_levels(&self) -> String {
        match &self.bench_tree {
            Some(t) => cable_levels_json(t, &self.engine.cfg.phrase),
            None => "null".into(),
        }
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
        let id = self
            .engine
            .commit_edit(self.bench_original, tree, outcome)
            .unwrap_or(0);
        // The new sound is the patch the player is working on: it keeps the
        // guesses' skips and takes, and the skips and takes made from here
        // on are filed under it.
        if let (true, Some(from)) = (id > 0, self.guess_key) {
            self.guesses.carry(from, id);
            self.guess_key = Some(id);
        }
        id as u32
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
                r#"{{"ok":true,"u":{},"sd":{},"lens":{}}}"#, // voice: name
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
        self.guesses.clear_taken();
        self.bench_tree = None;
        self.bench_render = None;
        self.bench_original = None;
        self.guess_key = None;
        self.bench_vet_ok = false;
        self.bench_vet_silent = false;
        self.bench_phi = None;
        self.bench_phi_prev = None;
    }

    fn phrase(&self) -> PhraseSpec {
        self.engine.cfg.phrase.clone()
    }

    /// The face of a stored audition, written back onto its memo row (when
    /// the row is resident) so the next ask is a lookup.
    fn remember_face(&self, key: &str, audio: &Audition) -> Face {
        let face = Face::of_f32(&audio.samples, audio.sample_rate);
        if let Some(mut row) = self.engine.memo().get(key) {
            row.face = Some(face.clone());
            self.engine.memo().put(row, None);
        }
        face
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
                self.guesses = GuessMemory::default();
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
                self.guesses = GuessMemory::default();
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
    ///
    /// `held` counts apart from the repairs: sounds whose only source was a
    /// CAPTURE take that couldn't be read, kept out of the pool and in the
    /// save ([`Self::held_sounds`]).
    pub fn repair_report(&self) -> String {
        let (terms, cells, dropped) = self.engine.repair_report();
        let held = self.engine.held().len();
        format!(r#"{{"terms":{terms},"cells":{cells},"dropped":{dropped},"held":{held}}}"#)
        // voice: name
    }

    /// The sounds the last restore held back, as JSON
    /// `[{"id":3,"capture":"node/1","tree":{…},"name":"…","note":"Its take couldn’t be read. …"}]`:
    /// each one's only source was a CAPTURE whose take couldn't be read. They
    /// are not in the bank's pool (never dealt, ranked or bred) and are saved
    /// with the session unchanged. The capture plate (Plan-007 task 4) lists
    /// them and opens one to record it again, then calls
    /// [`Self::readmit_held`].
    pub fn held_sounds(&self) -> String {
        let held: Vec<HeldView> = self
            .engine
            .held()
            .iter()
            .map(|e| HeldView {
                id: e.id as u32,
                capture: e.tree.lost_take_key(),
                tree: &e.tree,
                name: e.name.clone(),
                auto_name: e.auto_name.clone(),
                note: HELD_NOTE,
            })
            .collect();
        serde_json::to_string(&held).unwrap_or_else(|_| "[]".into())
    }

    /// Bring held sound `id` back with a new recording: `take_json` is a take's
    /// saved form, quiver's `Capture` state (`{"format":"f32le-base64",
    /// "sample_rate":…,"length":…,"data":…}`). The sound is measured as a new
    /// one and joins the pool. Replies as JSON: `{"ok":true,"id":3}`, or
    /// `{"ok":false,"error":"…"}` with the sentence to show, the sound still
    /// held.
    pub fn readmit_held(&mut self, id: u32, take_json: &str) -> String {
        let take: auracle_grammar::Take =
            serde_json::from_str(take_json).unwrap_or_else(|_| auracle_grammar::Take::empty());
        let reply = match self.engine.readmit_held(id as u64, take) {
            Ok(id) => ReadmitReply {
                ok: true,
                id: Some(id as u32),
                error: None,
            },
            Err(e) => ReadmitReply {
                ok: false,
                id: None,
                error: Some(readmit_note(&e)),
            },
        };
        serde_json::to_string(&reply).unwrap_or_default()
    }

    // ------------------------------------------------------------------
    // Audition clips (Plan-007 task 3, ADR-015)
    // ------------------------------------------------------------------

    /// Measure the sounds that listen with a clip captured from the player's
    /// input: `samples` interleaved, `channels` per frame (1 or 2), at
    /// `sample_rate` (the AudioContext's; the engine resamples it to the
    /// phrase's, quantizes it to 16 bits and cuts it to the phrase's length).
    /// The pool's members that listen are measured again with it, and it is
    /// saved with the session from now on. Replies as JSON:
    ///
    /// ```json
    /// {"ok":true,"note":"…","clip":{"source":"captured","id":"…","seconds":5.05,"channels":1},
    ///  "remeasured":[3,9],"unmeasured":[]}
    /// {"ok":false,"note":"…","error":"the clip is silent (rms 0.0e0)","clip":{…},
    ///  "remeasured":[],"unmeasured":[]}
    /// ```
    ///
    /// A refused clip changes nothing. `note` is the sentence the app shows;
    /// `error` is for the console. An accepted clip changes
    /// [`Self::phrase_json`], so the farm's handshake has to be sent again;
    /// until it is, a farm render of a sound that listens carries the old
    /// clip's key, and the engine measures that sound itself.
    pub fn set_audition_clip(
        &mut self,
        samples: Vec<f32>,
        channels: u32,
        sample_rate: f64,
    ) -> String {
        match AuditionClip::from_interleaved(
            &samples,
            channels as usize,
            sample_rate,
            &self.engine.cfg.phrase,
        ) {
            Ok(clip) => {
                let change = self.engine.set_audition_clip(Some(clip));
                self.clip_reply(None, change)
            }
            Err(e) => self.clip_reply(Some(e), ClipChange::default()),
        }
    }

    /// Go back to measuring the sounds that listen with the built-in
    /// reference, and measure them again. Replies as
    /// [`Self::set_audition_clip`] does.
    pub fn clear_audition_clip(&mut self) -> String {
        let change = self.engine.set_audition_clip(None);
        self.clip_reply(None, change)
    }

    /// Which clip the sounds that listen are measured with, as JSON
    /// `{"note":"…","source":"reference"|"captured","id":"…","seconds":…,
    /// "channels":…,"unreadable":"…"?}`. `unreadable` is there after a
    /// restore whose saved clip could not be read, which is why it is the
    /// reference.
    pub fn audition_clip(&self) -> String {
        let status = self.engine.audition_clip_status();
        serde_json::to_string(&ClipView {
            note: clip_note(&status),
            clip: &status,
        })
        .unwrap_or_default()
    }

    fn clip_reply(&self, refused: Option<ClipError>, change: ClipChange) -> String {
        let status = self.engine.audition_clip_status();
        let reply = ClipReply {
            ok: refused.is_none(),
            note: refused
                .as_ref()
                .map_or_else(|| clip_note(&status), refused_note),
            error: refused.map(|e| e.to_string()),
            clip: &status,
            remeasured: change.remeasured.iter().map(|id| *id as u32).collect(),
            unmeasured: change.unmeasured.iter().map(|id| *id as u32).collect(),
        };
        serde_json::to_string(&reply).unwrap_or_default()
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

    /// A row in the farm's persistent cache is keyed by its namespace, so a
    /// row another build wrote (another quiver, another featurizer) is never
    /// a hit. The store's own stamp is checked only when a farm worker opens
    /// it, and a tab still on the old build writes on into a store a newer
    /// tab has re-stamped; the engine re-checks a row's content address, which
    /// a DSP change does not move. One build has one namespace, so this pins
    /// the key's shape: the namespace this binary measures in, then the
    /// content address.
    #[test]
    fn a_stored_row_is_keyed_by_its_namespace() {
        let spec = PhraseSpec::default();
        let phrase = serde_json::to_string(&spec).unwrap();
        let tree = auracle_grammar::presets()[0].1.clone();
        let tree_json = serde_json::to_string(&tree).unwrap();
        let ns = cache_namespace(&phrase);
        assert!(
            ns.contains(&format!(":q{}:", auracle_features::QUIVER_DSP_VERSION)),
            "the namespace names the DSP: {ns}"
        );
        assert_eq!(
            farm_key(&tree_json, &phrase),
            format!("{ns}/{}", auracle_features::render_key(&tree, &spec)),
            "a stored row's key must begin with the namespace it was measured in"
        );
        assert_eq!(farm_key("{", &phrase), "", "an unparsable tree is a miss");
    }

    /// LEARNING's math reads its numbers from `model_facts`, and its
    /// forecast strip from `forecasts`: the facts are φ's two halves, the
    /// draws the posterior holds and the lenses it was allowed; each forecast
    /// is the `duel_pred` taken before the pick it scores, and none exists
    /// before the first fit.
    #[test]
    fn model_facts_and_forecasts_are_the_engines() {
        let mut engine = WasmEngine::new(5, 8);
        while engine.fill_step(4) > 0 {}
        let facts: serde_json::Value = serde_json::from_str(&engine.model_facts()).unwrap();
        let names = Features::phi_names();
        let audio = names.iter().filter(|n| n.contains(':')).count();
        assert_eq!(facts["audio"], serde_json::json!(audio), "{facts}");
        assert_eq!(facts["audio"], serde_json::json!(18), "{facts}");
        assert_eq!(
            facts["structural"],
            serde_json::json!(names.len() - audio),
            "{facts}"
        );
        assert_eq!(facts["structural"], serde_json::json!(26), "{facts}");
        assert_eq!(
            facts["draws"],
            serde_json::json!(auracle_taste::model::KEEP),
            "{facts}"
        );
        assert_eq!(
            facts["styles"],
            serde_json::json!(0),
            "no fit, no lens: {facts}"
        );
        assert_eq!(facts["styles_max"], serde_json::json!(5), "{facts}");
        assert_eq!(facts["obs_per_style"], serde_json::json!(20), "{facts}");
        assert_eq!(engine.forecasts(), "[]");

        let mut taught = taught_wasm(0x1EA);
        let facts: serde_json::Value = serde_json::from_str(&taught.model_facts()).unwrap();
        let p = taught.engine.posterior.as_ref().unwrap();
        assert_eq!(
            facts["draws"],
            serde_json::json!(p.samples.len()),
            "{facts}"
        );
        assert_eq!(facts["draws"], serde_json::json!(500), "{facts}");
        assert_eq!(facts["styles"], serde_json::json!(p.k_styles()), "{facts}");
        let before: Vec<serde_json::Value> = serde_json::from_str(&taught.forecasts()).unwrap();
        let [a, b]: [u64; 2] = serde_json::from_str::<Option<[u64; 2]>>(&taught.next_duel())
            .unwrap()
            .expect("a duel");
        let pred = taught.duel_pred(a as u32, b as u32);
        assert!(taught.record_duel(a as u32, b as u32, false));
        let after: Vec<serde_json::Value> = serde_json::from_str(&taught.forecasts()).unwrap();
        assert_eq!(after.len(), before.len() + 1);
        let last = after.last().unwrap();
        assert_eq!(last["p_a"].as_f64().unwrap(), pred, "{last}");
        assert_eq!(last["chose_a"], serde_json::json!(false));
        assert_eq!(last["provenance"], serde_json::json!("duel"));

        // The pool's z, one row per featurized member, in φ's order: exactly
        // the coordinates θ weighs.
        let f: serde_json::Value = serde_json::from_str(&taught.pool_features()).unwrap();
        assert_eq!(f["names"].as_array().unwrap().len(), names.len());
        let rows = f["rows"].as_array().unwrap();
        let pool: Vec<_> = taught
            .engine
            .pool
            .iter()
            .filter(|c| !c.phi_std.is_empty())
            .collect();
        assert_eq!(rows.len(), pool.len());
        for (row, c) in rows.iter().zip(&pool) {
            assert_eq!(row["id"], serde_json::json!(c.id));
            let z: Vec<f64> = serde_json::from_value(row["z"].clone()).unwrap();
            assert_eq!(z, c.phi_std, "z is the member's standardized φ");
        }
    }

    /// The bench's cable probe names the cables PATCH draws, keyed as the rack
    /// keys them (`data-from`/`data-to`, and the uids of `midOf`), measures
    /// each, and leaves the bench as it found it: the same buffer, bit for
    /// bit, and the same tree.
    #[test]
    fn the_bench_probe_names_the_cables_patch_draws() {
        let mut engine = WasmEngine::new(3, 6);
        while engine.fill_step(3) > 0 {}
        assert_eq!(engine.edit_cable_levels(), "null", "nothing open");
        let id = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked()).unwrap()[0]["id"]
            .as_u64()
            .unwrap() as u32;
        assert!(engine.edit_begin(id));
        let (before, tree) = (engine.edit_render(), engine.edit_tree_json());
        let probe: serde_json::Value = serde_json::from_str(&engine.edit_cable_levels()).unwrap();
        assert_eq!(
            engine.edit_render(),
            before,
            "the probe moved the bench's buffer"
        );
        assert_eq!(
            engine.edit_tree_json(),
            tree,
            "the probe moved the bench's tree"
        );
        let rack: serde_json::Value = serde_json::from_str(&engine.edit_describe()).unwrap();
        let uid = |key: &serde_json::Value| {
            rack["modules"]
                .as_array()
                .unwrap()
                .iter()
                .find(|m| &m["key"] == key)
                .map(|m| m["uid"].clone())
                .unwrap()
        };
        let drawn: Vec<_> = rack["wires"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|w| w["kind"] == "audio")
            .map(|w| {
                (
                    w["from"].clone(),
                    w["to"].clone(),
                    uid(&w["from"]),
                    uid(&w["to"]),
                )
            })
            .collect();
        let probed: Vec<_> = probe["cables"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| {
                assert!(c["rms_db"].as_f64().unwrap().is_finite());
                (
                    c["from"].clone(),
                    c["to"].clone(),
                    c["from_uid"].clone(),
                    c["to_uid"].clone(),
                )
            })
            .collect();
        assert!(!drawn.is_empty());
        assert_eq!(probed, drawn, "the probe's cables are not the rack's");
        let direct: PatchTree = serde_json::from_str(&tree).unwrap();
        assert_eq!(
            serde_json::to_string(
                &auracle_features::cable_levels(&direct, &engine.engine.cfg.phrase).unwrap()
            )
            .unwrap(),
            engine.edit_cable_levels(),
            "the binding and the probe disagree"
        );
    }

    /// The session's clip, through the boundary the worker uses. A capture is
    /// taken (resampled from the context's rate), reported, carried in the
    /// phrase the farm is handed, folded into a listening sound's stored key
    /// and nobody else's, saved with the session and restored from it; a
    /// silent capture is refused and changes nothing; and clearing it goes
    /// back to the reference.
    #[test]
    fn the_session_clip_crosses_the_boundary() {
        use auracle_grammar::term::{AudioNode, InputChannel};
        let mut engine = WasmEngine::new(5, 4);
        while engine.fill_step(4) > 0 {}
        let status =
            |e: &WasmEngine| serde_json::from_str::<serde_json::Value>(&e.audition_clip()).unwrap();
        assert_eq!(status(&engine)["source"], "reference");
        assert!(status(&engine)["note"]
            .as_str()
            .unwrap()
            .contains("built-in"));
        let before = engine.phrase_json();

        // A second of a 48 kHz stereo capture.
        let capture: Vec<f32> = (0..48_000 * 2)
            .map(|i| {
                let t = (i / 2) as f32 / 48_000.0;
                0.3 * (t * 220.0 * std::f32::consts::TAU).sin()
            })
            .collect();
        let silent = engine.set_audition_clip(vec![0.0; 48_000], 1, 48_000.0);
        let silent: serde_json::Value = serde_json::from_str(&silent).unwrap();
        assert_eq!(silent["ok"], false);
        assert!(silent["error"].as_str().unwrap().contains("silent"));
        assert_eq!(
            silent["clip"]["source"], "reference",
            "a refusal changes nothing"
        );

        let reply: serde_json::Value =
            serde_json::from_str(&engine.set_audition_clip(capture, 2, 48_000.0)).unwrap();
        assert_eq!(reply["ok"], true);
        assert_eq!(reply["clip"]["source"], "captured");
        assert_eq!(reply["clip"]["channels"], 2);
        assert!((reply["clip"]["seconds"].as_f64().unwrap() - 1.0).abs() < 0.001);
        let id = reply["clip"]["id"].as_str().unwrap().to_string();
        assert_eq!(status(&engine)["id"].as_str().unwrap(), id);

        // The farm's phrase now carries it: a listening sound keys apart,
        // every other sound and the namespace do not move.
        let after = engine.phrase_json();
        assert!(after.contains("\"clip\"") && !before.contains("\"clip\""));
        let mut listens = auracle_grammar::presets()[0].1.clone();
        listens.root = AudioNode::AudioIn {
            uid: auracle_grammar::Uid::NEW,
            input: 0,
            gain: auracle_grammar::INPUT_GAIN_UNITY,
            channel: InputChannel::Both,
        };
        let listens = serde_json::to_string(&listens).unwrap();
        let deaf = serde_json::to_string(&auracle_grammar::presets()[0].1).unwrap();
        assert_ne!(farm_key(&listens, &before), farm_key(&listens, &after));
        assert_eq!(farm_key(&deaf, &before), farm_key(&deaf, &after));
        assert_eq!(cache_namespace(&before), cache_namespace(&after));
        // And the farm renders with it: the row it returns is the engine's key.
        let job = farm_render(&listens, &after, false);
        assert!(job.ok());
        let row: CachedFeatures = serde_json::from_str(&job.cached()).unwrap();
        assert_eq!(
            format!("{}/{}", cache_namespace(&after), row.key),
            farm_key(&listens, &after)
        );

        // Saved with the session, and restored from it.
        let saved = engine.export_session();
        let mut back = WasmEngine::new(6, 4);
        assert!(back.import_session(&saved) > 0);
        assert_eq!(status(&back)["id"].as_str().unwrap(), id);
        assert_eq!(back.phrase_json(), after);

        let cleared: serde_json::Value =
            serde_json::from_str(&engine.clear_audition_clip()).unwrap();
        assert_eq!(cleared["clip"]["source"], "reference");
        assert_eq!(engine.phrase_json(), before);
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

    /// Plan and render a guess the way the worker does with no farm
    /// (`memo_render`, one job at a time, a job that does not vet into
    /// `failed`), then rank. Returns the ranking and the failed keys.
    fn guess_serial(engine: &WasmEngine, limit: u32) -> (serde_json::Value, String) {
        let mut failed: Vec<String> = Vec::new();
        for _ in 0..4 {
            let fj = serde_json::to_string(&failed).unwrap();
            let plan: serde_json::Value =
                serde_json::from_str(&engine.guess_plan(None, &fj, limit)).unwrap();
            let jobs = plan["jobs"].as_array().expect("jobs").clone();
            if jobs.is_empty() {
                break;
            }
            for j in jobs {
                if !engine.memo_render(j["tree"].as_str().unwrap()) {
                    failed.push(j["key"].as_str().unwrap().to_string());
                }
            }
        }
        let fj = serde_json::to_string(&failed).unwrap();
        (
            serde_json::from_str(&engine.guess_rank(None, &fj, limit)).unwrap(),
            fj,
        )
    }

    /// **The guess through the bindings, and an undo that counts as a skip.**
    /// No guess before the fit; after it, the bench's patch is planned
    /// first, then its candidates; the ranking runs by the lower bound.
    /// Taking the top guess is an ordinary edit of the bench, and putting the
    /// tree back (as ⌘Z does, through `edit_set_tree_apply`) skips that
    /// family at that socket for this patch, logged as a skip; another
    /// patch keeps its own (empty) skips.
    #[test]
    fn a_taken_guess_undone_is_a_skip_through_the_bindings() {
        let mut cold = WasmEngine::new(5, 6);
        while cold.fill_step(3) > 0 {}
        let first = serde_json::from_str::<Vec<serde_json::Value>>(&cold.ranked()).unwrap()[0]["id"]
            .as_u64()
            .unwrap() as u32;
        assert!(cold.edit_begin(first));
        assert_eq!(cold.guess_plan(None, "[]", 0), r#"{"reason":"no_taste"}"#);

        let mut engine = taught_wasm(5);
        assert_eq!(engine.guess_plan(None, "[]", 0), r#"{"reason":"no_patch"}"#);
        let ids: Vec<u32> = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked())
            .unwrap()
            .iter()
            .map(|r| r["id"].as_u64().unwrap() as u32)
            .collect();
        assert!(engine.edit_begin(ids[0]));
        let before = engine.edit_tree_json();
        let (rank, failed) = guess_serial(&engine, 8);
        let guesses = rank["guesses"].as_array().expect("guesses").clone();
        assert!(!guesses.is_empty(), "{rank}");
        assert!(rank["planned"].as_u64().unwrap() <= 8);
        for w in guesses.windows(2) {
            assert!(w[0]["lcb"].as_f64().unwrap() >= w[1]["lcb"].as_f64().unwrap());
        }
        let top = guesses[0].clone();
        assert_eq!(engine.guess_take(&top.to_string()), "");
        engine.edit_revet();
        assert_ne!(engine.edit_tree_json(), before, "the guess went in");
        // ⌘Z: the tree before the guess comes back whole.
        assert_eq!(engine.edit_set_tree_apply(&before), "");
        engine.edit_revet();
        let skip = |e: &WasmEngine| {
            e.engine
                .events
                .iter()
                .filter(|ev| ev.kind == "guess_skip")
                .count()
        };
        assert_eq!(skip(&engine), 1, "the undo was not logged as a skip");
        let again: serde_json::Value =
            serde_json::from_str(&engine.guess_rank(None, &failed, 8)).unwrap();
        assert!(again["skipped"].as_u64().unwrap() >= 1, "{again}");
        assert!(again["guesses"]
            .as_array()
            .unwrap()
            .iter()
            .all(|g| g["socket"] != top["socket"] || g["family"] != top["family"]));
        assert!(!engine.guess_skip(&top.to_string()), "already skipped");
        // Another patch has its own skips.
        assert!(engine.edit_begin(ids[1]));
        let other: serde_json::Value =
            serde_json::from_str(&engine.guess_plan(None, "[]", 0)).unwrap();
        assert_eq!(other["skipped"], 0, "{other}");
        assert_eq!(skip(&engine), 1);
    }

    /// Skips are remembered per patch by pool id, and an import brings
    /// another session's ids: after one, no skip from before applies.
    #[test]
    fn an_import_forgets_the_skips() {
        let mut engine = WasmEngine::new(3, 6);
        while engine.fill_step(3) > 0 {}
        let id = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked()).unwrap()[0]["id"]
            .as_u64()
            .unwrap() as u32;
        assert!(engine.edit_begin(id));
        let skip = r#"{"socket":"out","family":"drive"}"#;
        assert!(engine.guess_skip(skip));
        assert!(!engine.guess_skip(skip), "remembered");
        let saved = engine.export_session();
        assert!(engine.import_session(&saved) > 0);
        assert!(engine.edit_begin(id));
        assert!(engine.guess_skip(skip), "a skip outlived the import");
    }

    /// A guess for the bench as JSON, as `guess_rank` would give it: the
    /// first of `guess_candidates` of `kind`.
    fn a_guess(engine: &WasmEngine, kind: &str) -> String {
        let tree = engine.bench_tree.clone().unwrap();
        let c = auracle_session::guess_candidates(&tree, None)
            .into_iter()
            .find(|c| c.kind == kind)
            .unwrap_or_else(|| panic!("no {kind} to guess"));
        serde_json::json!({ "op": c.op, "socket": c.socket, "family": c.family }).to_string()
    }

    fn pool_ids(engine: &WasmEngine) -> Vec<u32> {
        serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked())
            .unwrap()
            .iter()
            .map(|r| r["id"].as_u64().unwrap() as u32)
            .collect()
    }

    fn guess_skips_logged(engine: &WasmEngine) -> usize {
        engine
            .engine
            .events
            .iter()
            .filter(|ev| ev.kind == "guess_skip")
            .count()
    }

    /// **An old take does not turn an unrelated undo into a skip.** Take a
    /// guess on A, open B, open A again (back at the tree before the guess),
    /// make an edit, then undo it to that tree: that undo is of the edit, not
    /// of the guess, so nothing is skipped or logged.
    #[test]
    fn an_old_take_does_not_turn_an_unrelated_undo_into_a_skip() {
        let mut engine = WasmEngine::new(3, 6);
        while engine.fill_step(3) > 0 {}
        let ids = pool_ids(&engine);
        assert!(engine.edit_begin(ids[0]));
        let t0 = engine.edit_tree_json();
        let reverb = a_guess(&engine, "reverb");
        assert_eq!(engine.guess_take(&reverb), "");
        assert!(engine.edit_begin(ids[1]));
        assert!(engine.edit_begin(ids[0]));
        assert_eq!(
            engine.edit_tree_json(),
            t0,
            "back at the tree before the guess"
        );
        let edit = r#"{"op":"insert","key":"node","kind":"delay"}"#; // voice: name
        assert_eq!(engine.edit_structure_apply(edit), "");
        assert_eq!(engine.edit_set_tree_apply(&t0), "");
        assert_eq!(
            guess_skips_logged(&engine),
            0,
            "an unrelated undo was a skip"
        );
        assert!(engine.guess_skip(&reverb), "the family was hidden");
        assert_eq!(guess_skips_logged(&engine), 1);
    }

    /// **A guess ranked on an earlier tree is refused, not applied.** A noise
    /// ranked for the empty socket, sent after the player put a pluck there
    /// and a filter after it, would wipe both: it is refused with a reason,
    /// and the bench is untouched.
    #[test]
    fn a_stale_guess_is_refused() {
        let mut engine = WasmEngine::new(3, 6);
        while engine.fill_step(3) > 0 {}
        assert!(engine.edit_begin(pool_ids(&engine)[0]));
        let mut empty: PatchTree = serde_json::from_str(&engine.edit_tree_json()).unwrap();
        empty.root = auracle_grammar::AudioNode::Silence {
            uid: auracle_grammar::Uid::NEW,
        };
        assert_eq!(
            engine.edit_set_tree_apply(&serde_json::to_string(&empty).unwrap()),
            ""
        );
        let noise = a_guess(&engine, "noise");
        for op in [
            r#"{"op":"replace","key":"node","kind":"pluck"}"#, // voice: name
            r#"{"op":"insert","key":"node","kind":"filter"}"#, // voice: name
        ] {
            assert_eq!(engine.edit_structure_apply(op), "");
        }
        let built = engine.edit_tree_json();
        let err = engine.guess_take(&noise);
        assert!(!err.is_empty(), "a stale guess was applied");
        assert_eq!(
            engine.edit_tree_json(),
            built,
            "the refusal moved the bench"
        );
        // A guess for the patch as it is now is taken.
        let reverb = a_guess(&engine, "reverb");
        assert_eq!(engine.guess_take(&reverb), "");
    }

    /// **Keep as new carries the skips.** The kept sound is the patch the
    /// player is working on, so a family skipped before keeping stays
    /// skipped on it.
    #[test]
    fn keep_as_new_carries_the_skips() {
        let mut engine = WasmEngine::new(3, 6);
        while engine.fill_step(3) > 0 {}
        assert!(engine.edit_begin(pool_ids(&engine)[0]));
        let reverb = a_guess(&engine, "reverb");
        assert!(engine.guess_skip(&reverb));
        let edit = r#"{"op":"insert","key":"node","kind":"delay"}"#; // voice: name
        assert_eq!(engine.edit_structure(edit), "");
        let kept = engine.edit_commit("none");
        assert!(kept > 0, "the edit was not kept");
        assert!(engine.edit_begin(kept));
        assert!(
            !engine.guess_skip(&reverb),
            "the skip stayed with the old id"
        );
    }

    /// **A new patch keeps its own skips.** NEW PATCH empties the sound in
    /// hand into a patch of its own (`guess_patch_as(0)`): a skip made there
    /// is not the sound's when the player goes back to it, the sound's are
    /// not the new patch's, and coming back to the new patch under its key
    /// finds its skip again.
    #[test]
    fn a_new_patch_files_its_skips_under_its_own_key() {
        let mut engine = WasmEngine::new(3, 6);
        while engine.fill_step(3) > 0 {}
        let sound = pool_ids(&engine)[0];
        assert!(engine.edit_begin(sound));
        let delay = a_guess(&engine, "delay");
        assert!(engine.guess_skip(&delay), "the sound's own skip");
        let key = engine.guess_patch_as(0);
        assert!(key > 0 && key != sound);
        assert!(
            engine.guess_skip(&delay),
            "the new patch took the sound's skip"
        );
        let reverb = a_guess(&engine, "reverb");
        assert!(engine.guess_skip(&reverb));
        // BACK TO the sound: its skips are its own.
        assert!(engine.edit_begin(sound));
        assert!(
            engine.guess_skip(&reverb),
            "the sound took a skip made on the new patch"
        );
        // NEW PATCH again, under the key it was given: its skip is there.
        assert_eq!(engine.guess_patch_as(key), key);
        assert!(!engine.guess_skip(&reverb), "the new patch lost its skip");
        assert_ne!(
            engine.guess_patch_as(0),
            key,
            "a second new patch reused a key"
        );
    }

    /// **Keep as new carries the skips made after it.** The page does not
    /// reopen the kept sound, so the bench is still "opened from" the old
    /// id (`bench_original`, what a later commit duel plays against). A skip
    /// made after the commit is a skip on the kept sound: opened again, it
    /// is still skipped there, and the sound it was made from never had it.
    #[test]
    fn keep_as_new_carries_the_skips_made_after_it() {
        let mut engine = WasmEngine::new(3, 6);
        while engine.fill_step(3) > 0 {}
        let original = pool_ids(&engine)[0];
        assert!(engine.edit_begin(original));
        let edit = r#"{"op":"insert","key":"node","kind":"delay"}"#; // voice: name
        assert_eq!(engine.edit_structure(edit), "");
        let kept = engine.edit_commit("none");
        assert!(kept > 0, "the edit was not kept");
        assert_eq!(
            engine.edit_original_id(),
            original,
            "a commit duel still plays against the sound it was opened from"
        );
        // After keep as new, on the same bench: skip a reverb.
        let reverb = a_guess(&engine, "reverb");
        assert!(engine.guess_skip(&reverb));
        assert!(engine.edit_begin(kept));
        assert!(
            !engine.guess_skip(&reverb),
            "a skip made after keep as new was filed under the old id"
        );
        assert!(engine.edit_begin(original));
        assert!(
            engine.guess_skip(&reverb),
            "the sound it was kept from took a skip made on the kept one"
        );
    }

    /// **A guess's renders respect the render namespace.** Each job's
    /// `cache` key is the persistent store's (`farm_key`: this binary's
    /// namespace, then the content address), and a farm row rendered under
    /// another phrase is refused by `memo_absorb`, so the candidate stays
    /// unrendered rather than ranked on another stimulus's φ.
    #[test]
    fn a_guess_respects_the_render_namespace() {
        let mut engine = taught_wasm(6);
        let id = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked()).unwrap()[0]["id"]
            .as_u64()
            .unwrap() as u32;
        assert!(engine.edit_begin(id));
        let phrase = engine.phrase_json();
        let ns = cache_namespace(&phrase);
        let plan = |e: &WasmEngine| -> serde_json::Value {
            serde_json::from_str(&e.guess_plan(None, "[]", 2)).unwrap()
        };
        // The patch first, if the memo lacks it.
        let mut p = plan(&engine);
        if p["jobs"][0]["tree"].as_str() == Some(engine.edit_tree_json().as_str()) {
            assert!(engine.memo_render(p["jobs"][0]["tree"].as_str().unwrap()));
            p = plan(&engine);
        }
        let jobs = p["jobs"].as_array().unwrap().clone();
        assert!(!jobs.is_empty());
        let mut other: PhraseSpec = serde_json::from_str(&phrase).unwrap();
        other.seed ^= 1;
        let other = serde_json::to_string(&other).unwrap();
        for j in &jobs {
            let tree = j["tree"].as_str().unwrap();
            assert_eq!(j["cache"].as_str().unwrap(), farm_key(tree, &phrase));
            assert!(j["cache"].as_str().unwrap().starts_with(&format!("{ns}/")));
            let foreign = farm_render(tree, &other, false);
            assert!(foreign.ok);
            assert!(
                !engine.memo_absorb(tree, &foreign.cached),
                "a row from another stimulus was absorbed"
            );
        }
        let r: serde_json::Value = serde_json::from_str(&engine.guess_rank(None, "[]", 2)).unwrap();
        assert_eq!(r["rendered"], 0, "{r}");
        // This stimulus's rows are taken, and ranked.
        for j in &jobs {
            let tree = j["tree"].as_str().unwrap();
            let row = farm_render(tree, &phrase, false);
            if row.ok {
                assert!(engine.memo_absorb(tree, &row.cached));
            }
        }
        let r: serde_json::Value = serde_json::from_str(&engine.guess_rank(None, "[]", 2)).unwrap();
        assert!(r["rendered"].as_u64().unwrap() > 0, "{r}");
    }

    fn twins(seed: u64) -> (WasmEngine, WasmEngine) {
        std::thread::scope(|s| {
            let a = s.spawn(move || taught_wasm(seed));
            let b = s.spawn(move || taught_wasm(seed));
            (a.join().unwrap(), b.join().unwrap())
        })
    }

    /// A saw-ish note with a slow swell, as a page would decode it: mono
    /// `f32` at 48 kHz.
    fn decoded_file(seconds: f64) -> Vec<f32> {
        let sr = 48_000.0;
        (0..(seconds * sr) as usize)
            .map(|i| {
                let t = i as f64 / sr;
                let saw: f64 = (1..24)
                    .map(|h| (std::f64::consts::TAU * 147.0 * h as f64 * t).sin() / h as f64)
                    .sum();
                (0.25 * saw * (1.0 - (-t * 3.0).exp())) as f32
            })
            .collect()
    }

    /// **A sound of your own, through the binding.** It is measured, placed
    /// and its nearest named; a file that cannot be measured is refused by a
    /// flag and leaves the sound in place; a breed toward it carries its
    /// target over the farm's wire, so `farm_walk` walks the tilted target
    /// `run_walk` walks; and the session saves it as features only and
    /// brings it back.
    #[test]
    fn a_sound_of_your_own_through_the_binding() {
        // Before the pool has a standardizer the sound is kept, and its
        // standardized reading is null, not missing.
        let mut fresh = WasmEngine::new(1, 4);
        let early: serde_json::Value =
            serde_json::from_str(&fresh.own_sound_set(&decoded_file(1.0), 48_000.0, None)).unwrap();
        assert_eq!(early["ok"], true);
        assert!(early.get("z").is_some_and(|z| z.is_null()), "{early}");
        assert!(early["map"].is_null());
        assert_eq!(early["nearest"], serde_json::json!([]));
        // A breed before any taste opens nothing and says so.
        let none: serde_json::Value = serde_json::from_str(&fresh.refine_toward_jobs()).unwrap();
        assert!(none["context"].is_null());
        assert_eq!(none["reason"], "untaught");
        // The taste's own generation carries no reason key at all.
        assert!(!fresh.refine_jobs().contains("reason"));

        let mut engine = taught_wasm(0x0A1D);
        assert_eq!(engine.own_sound(), "null");
        let reply: serde_json::Value = serde_json::from_str(&engine.own_sound_set(
            &decoded_file(3.0),
            48_000.0,
            Some("Field recording 03".into()),
        ))
        .unwrap();
        assert_eq!(reply["ok"], true);
        assert_eq!(reply["name"], "Field recording 03");
        let names = auracle_features::Features::phi_names();
        let z = reply["z"].as_array().unwrap();
        assert_eq!(z.len(), names.len());
        let masked: Vec<&str> = reply["masked"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        for (n, v) in names.iter().zip(z) {
            assert_eq!(v.is_null(), masked.contains(n), "{n}");
        }
        assert!(reply["map"]["x"].as_f64().unwrap().is_finite());
        let nearest = reply["nearest"].as_array().unwrap();
        assert_eq!(nearest.len(), OWN_NEAREST);
        for n in nearest {
            assert!(engine.engine.find(n["id"].as_u64().unwrap()).is_some());
        }
        assert_eq!(reply["nearest_presets"].as_array().unwrap().len(), 0);
        assert_eq!(reply["seeds"].as_array().unwrap().len(), 3);

        let refused: serde_json::Value =
            serde_json::from_str(&engine.own_sound_set(&vec![0.0; 48_000], 48_000.0, None))
                .unwrap();
        assert_eq!(refused["ok"], false);
        assert_eq!(refused["error"], "silent");
        assert!(engine.own_sound().contains("Field recording 03"));

        let jobs: serde_json::Value = serde_json::from_str(&engine.refine_toward_jobs()).unwrap();
        assert!(
            jobs["context"]["toward"].is_object(),
            "the target rides the wire"
        );
        let context = serde_json::to_string(&jobs["context"]).unwrap();
        let ctx: WalkContext = serde_json::from_str(&context).unwrap();
        for job in jobs["jobs"].as_array().unwrap() {
            let text = serde_json::to_string(job).unwrap();
            let native: WalkJob = serde_json::from_str(&text).unwrap();
            let wired = farm_walk(&context, &text);
            assert_eq!(
                wired,
                serde_json::to_string(&run_walk(&ctx, &native, &RenderMemo::default())).unwrap()
            );
            engine.refine_absorb(&wired);
        }

        let saved = engine.export_session();
        let state: serde_json::Value = serde_json::from_str(&saved).unwrap();
        let own = &state["own_sound"];
        assert_eq!(own["name"], "Field recording 03");
        assert_eq!(
            own["features"].as_array().unwrap().len(),
            names.len() - masked.len(),
            "features only: the measured coordinates, by name"
        );
        let mut back = WasmEngine::new(5, 12);
        assert!(back.import_session(&saved) > 0);
        let again: serde_json::Value = serde_json::from_str(&back.own_sound()).unwrap();
        assert_eq!(again["name"], "Field recording 03");
        assert_eq!(again["z"], engine_z(&engine));
        assert!(engine.own_sound_clear());
        assert_eq!(engine.own_sound(), "null");
        let gone: serde_json::Value = serde_json::from_str(&engine.refine_toward_jobs()).unwrap();
        assert_eq!(gone["reason"], "no_sound");
    }

    fn engine_z(e: &WasmEngine) -> serde_json::Value {
        serde_json::from_str::<serde_json::Value>(&e.own_sound()).unwrap()["z"].clone()
    }

    /// The presets nearest a sound come from the wirings the app ships:
    /// every preset is read, back to the raw φ a render measures today.
    #[test]
    fn presets_come_back_from_the_shipped_wirings() {
        let presets = presets_from_wirings(include_str!("../../../apps/web/perform-wirings.json"));
        let bank = auracle_grammar::preset_bank();
        assert_eq!(
            presets.len(),
            bank.len(),
            "a preset is missing from the file"
        );
        let spec = PhraseSpec::default();
        for p in presets.iter().step_by(20) {
            let truth = auracle_features::featurize(&bank[p.index].tree, &spec)
                .unwrap()
                .features
                .audio
                .to_vec();
            for (a, b) in p.audio.iter().zip(&truth) {
                assert!(
                    (a - b).abs() <= 1e-9 * (1.0 + b.abs()),
                    "{}: {a} vs {b}",
                    p.name
                );
            }
        }
        assert!(presets_from_wirings("{").is_empty());
        let mut engine = taught_wasm(0x5E7);
        let n = engine.own_presets_set(include_str!("../../../apps/web/perform-wirings.json"));
        assert_eq!(n as usize, bank.len());
        let reply: serde_json::Value =
            serde_json::from_str(&engine.own_sound_set(&decoded_file(2.0), 48_000.0, None))
                .unwrap();
        assert_eq!(reply["name"], "Your sound");
        let near = reply["nearest_presets"].as_array().unwrap();
        assert_eq!(near.len(), OWN_NEAREST);
        let d: Vec<f64> = near
            .iter()
            .map(|n| n["distance"].as_f64().unwrap())
            .collect();
        assert!(d.windows(2).all(|w| w[0] <= w[1]));
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

    /// **A listening seed evolves on the farm as it does in the engine, with
    /// the session's clip and its take.** AUDIO IN is a player kind, so a
    /// player's patch with one is inside the prior's support and ⚡ walks it.
    /// The seed (a filter over input 3, mixed with a CAPTURE of input 1
    /// holding a take) is imported into twins that hold the same captured
    /// clip. Every ⚡ starts (never `outside_support`); the farm's job carries
    /// the session's phrase with its clip and the seed with its take, and the
    /// child it lands is the engine's own. A child keeps its inputs and its
    /// take.
    #[test]
    fn a_listening_seed_evolves_on_the_farm_with_its_clip_and_take() {
        use auracle_grammar::term::{
            AmpEnv, AudioNode, CaptureMode, FilterKind, InputChannel, ModNode,
        };
        use auracle_grammar::{Take, Uid, INPUT_GAIN_UNITY};
        let (mut serial, mut farmed) = twins(0xA0D1);
        // A plucked 220 Hz figure, three seconds at 48 kHz, as a browser
        // would capture it.
        let rate = 48_000.0f32;
        let clip: Vec<f32> = (0..(3.0 * rate) as usize)
            .map(|i| {
                let t = i as f32 / rate;
                let env = (-(t % 0.5) * 6.0).exp();
                (t * 220.0 * std::f32::consts::TAU).sin() * 0.3 * env
            })
            .collect();
        let take: Vec<f32> = (0..4_000).map(|i| (i as f32 * 0.05).sin() * 0.4).collect();
        let seed = PatchTree {
            amp: AmpEnv {
                attack: 0.05,
                decay: 0.3,
                sustain: 0.8,
                release: 0.3,
            },
            root: AudioNode::Mix {
                uid: Uid::NEW,
                balance: 0.5,
                a: Box::new(AudioNode::Filter {
                    uid: Uid::NEW,
                    kind: FilterKind::SvfLp,
                    cutoff: 0.55,
                    resonance: 0.2,
                    mod_depth: 0.0,
                    input: Box::new(AudioNode::AudioIn {
                        uid: Uid::NEW,
                        input: 3,
                        gain: INPUT_GAIN_UNITY,
                        channel: InputChannel::Both,
                    }),
                    modulation: ModNode::None,
                }),
                b: Box::new(AudioNode::Capture {
                    uid: Uid::NEW,
                    play: CaptureMode::Hold,
                    input: Box::new(AudioNode::AudioIn {
                        uid: Uid::NEW,
                        input: 1,
                        gain: INPUT_GAIN_UNITY,
                        channel: InputChannel::Left,
                    }),
                    take: Take::from_samples(&take, 44_100.0).unwrap(),
                }),
            },
        };
        let json = serde_json::to_string(&seed).unwrap();
        let mut ids = Vec::new();
        for e in [&mut serial, &mut farmed] {
            let r: serde_json::Value =
                serde_json::from_str(&e.set_audition_clip(clip.clone(), 1, rate as f64)).unwrap();
            assert_eq!(r["ok"], true, "{r}");
            ids.push(e.import_patch(&json, "Mic Pad"));
        }
        let (a, b) = (ids[0], ids[1]);
        assert!(a > 0 && b > 0, "the listening patch was not admitted");
        let phrase: serde_json::Value = serde_json::from_str(&farmed.phrase_json()).unwrap();
        assert!(
            !phrase["clip"].is_null(),
            "the session's phrase carries no clip"
        );
        let mut landed = 0;
        for attempt in 0..4 {
            let here = serial.refine_from(a, "[]");
            assert_ne!(
                serial.last_refine_reason(),
                "outside_support",
                "attempt {attempt}"
            );
            let reply: serde_json::Value =
                serde_json::from_str(&farmed.refine_from_job(b, "[]")).unwrap();
            assert_eq!(
                reply["context"]["phrase"], phrase,
                "the walk's context is not the session's phrase with its clip"
            );
            let job: auracle_session::WalkJob =
                serde_json::from_value(reply["job"].clone()).expect("a job");
            assert!(
                job.seed.listens() && job.seed.has_takes(),
                "the job lost the seed's input or take"
            );
            let result = farm_walk(
                &serde_json::to_string(&reply["context"]).unwrap(),
                &serde_json::to_string(&reply["job"]).unwrap(),
            );
            let there = farmed.refine_from_absorb(b, &result);
            assert_eq!(
                here, there,
                "attempt {attempt}: the farm's ⚡ landed elsewhere"
            );
            assert_eq!(serial.last_refine_reason(), farmed.last_refine_reason());
            if here > 0 {
                landed += 1;
                let child: PatchTree = serde_json::from_str(&serial.tree_json_of(here)).unwrap();
                assert!(
                    child.listens(),
                    "the child lost its input: {}",
                    child.to_sexpr()
                );
                assert_eq!(
                    child.input_sites().len(),
                    seed.input_sites().len(),
                    "{}",
                    child.to_sexpr()
                );
                assert!(
                    child.has_takes(),
                    "the child lost the take: {}",
                    child.to_sexpr()
                );
            }
        }
        println!("{landed} of 4 ⚡ walks from the listening seed landed a child");
        // Every comparison above is about a child: with none landed, the
        // test would pass having compared nothing.
        assert!(landed > 0, "no ⚡ from the listening seed landed a child");
        assert_eq!(farmed.ranked(), serial.ranked());
    }

    /// PERFORM's measurement wires the six it always has unless the worker
    /// names palette controls, and then exactly those, in the order named,
    /// each with its name and its palette `index`, which is how the page
    /// names it back (a position is not: asked for Bite then Warmth, position
    /// 0 is Bite, and 0 is Bright to an offer). The request is read entry by
    /// entry: an index out of range, a repeat, a negative, a fraction or a
    /// string is dropped alone, and naming the six is the same as naming none
    /// (the panel's request, unchanged). Naming nothing wires nothing and
    /// renders no nudge. The plan and its finish take the same set, and a
    /// finish whose renders are all in the memo is the one-call answer.
    #[test]
    fn perform_wire_measures_the_palette_controls_asked_for() {
        use auracle_session::perform::{CONTROLS, PALETTE};
        let mut engine = WasmEngine::new(3, 6);
        while engine.fill_step(3) > 0 {}
        let ranked = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked()).unwrap();
        let id_of = |k: usize| ranked[k]["id"].as_u64().unwrap() as u32;
        let (id, other) = (id_of(0), id_of(1));
        // `(name, index)` of each wiring, in reply order.
        let wired = |reply: &str| -> Vec<(String, Option<usize>)> {
            let v: serde_json::Value = serde_json::from_str(reply).unwrap();
            v["wiring"]
                .as_array()
                .expect("a wiring")
                .iter()
                .map(|w| {
                    let index = w["index"].as_u64().map(|k| k as usize);
                    (w["name"].as_str().unwrap().to_string(), index)
                })
                .collect()
        };
        let palette = |ks: &[usize]| -> Vec<(String, Option<usize>)> {
            ks.iter()
                .map(|&k| (PALETTE[k].name.to_string(), Some(k)))
                .collect()
        };

        // Naming nothing: the patch's knobs and z, no wiring, and none of the
        // nudges a Jacobian renders (the pool's member is already in the memo).
        let lone = engine.tree_json_of(other);
        let misses = || {
            serde_json::from_str::<serde_json::Value>(&engine.memo_stats()).unwrap()["misses"]
                .as_u64()
                .unwrap()
        };
        let before = misses();
        assert_eq!(
            engine.perform_wire_plan(&lone, "[]", "[]", Some("[]".into())),
            "[]"
        );
        let empty: serde_json::Value =
            serde_json::from_str(&engine.perform_wire(&lone, "[]", Some("[]".into()))).unwrap();
        assert_eq!(misses(), before, "naming nothing rendered");
        assert_eq!(empty["wiring"], serde_json::json!([]));
        assert!(empty["addrs"].as_array().is_some_and(|a| !a.is_empty()) && empty["z"].is_array());
        assert_ne!(
            engine.perform_wire_plan(&lone, "[]", "[]", Some("[6]".into())),
            "[]",
            "naming one control owes the Jacobian's nudges"
        );

        assert!(engine.edit_begin(id));
        let tree = engine.edit_tree_json();
        let six = engine.perform_wire(&tree, "[]", None);
        assert_eq!(wired(&six), palette(&[0, 1, 2, 3, 4, 5]));
        assert!(CONTROLS.iter().zip(&PALETTE).all(|(a, b)| a.name == b.name));
        assert_eq!(
            engine.perform_wire(&tree, "[]", Some("[0,1,2,3,4,5]".into())),
            six,
            "naming the six is the panel's request"
        );
        for not_a_set in ["not json", "{\"0\": 6}", "6"] {
            assert_eq!(
                engine.perform_wire(&tree, "[]", Some(not_a_set.into())),
                six,
                "{not_a_set}: what is not an array is the six"
            );
        }
        // A request in an order that is not the palette's.
        let asked = engine.perform_wire(&tree, "[]", Some("[16, 6, 99, 16, 0]".into()));
        assert_eq!(wired(&asked), palette(&[16, 6, 0]));
        assert_ne!(wired(&asked)[0].1, Some(0), "position 0 is not index 0");
        for (ask, want) in [
            ("[6, -1]", vec![6]),
            ("[6, 1.5]", vec![6]),
            ("[6.0]", vec![6]),
            ("[\"6\", 7]", vec![7]),
            ("[1e21]", vec![]),
            ("[]", vec![]),
        ] {
            let reply = engine.perform_wire(&tree, "[]", Some(ask.into()));
            assert_eq!(wired(&reply), palette(&want), "{ask}");
        }
        let all = format!("{:?}", (0..PALETTE.len()).collect::<Vec<_>>());
        let full = engine.perform_wire(&tree, "[]", Some(all.clone()));
        assert_eq!(
            wired(&full),
            palette(&(0..PALETTE.len()).collect::<Vec<_>>())
        );
        assert_eq!(
            engine.perform_wire_plan(&tree, "[]", "[]", Some(all.clone())),
            "[]",
            "everything the eighteen need is in the memo"
        );
        assert_eq!(
            engine.perform_wire_known(&tree, "[]", "[]", Some(all)),
            full
        );
        // A palette index names the same control to an aimed offer: the
        // reply says how far it moved along that control's own direction.
        let home: PatchTree = serde_json::from_str(&tree).unwrap();
        let mut aimed = 0;
        for _ in 0..4 {
            let reply = engine.perform_offer(&tree, "[]", "[]", 6, Some(16), Some(1.0));
            let v: serde_json::Value = serde_json::from_str(&reply).unwrap();
            if v.get("reason").is_some() {
                continue;
            }
            let grown: PatchTree = serde_json::from_value(v["tree"].clone()).unwrap();
            let want = engine.engine.moved_along(&home, &grown, 16).unwrap();
            assert!((v["moved"].as_f64().expect("moved") - want).abs() < 1e-9);
            aimed += 1;
        }
        assert!(aimed > 0, "no offer aimed along Bite grew");
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

    /// **The worker's way of asking is the same offer.** `perform_offer` is
    /// `perform_offer_begin`, stepped, `perform_job_finish`; the worker steps
    /// one render at a time and answers the player between steps. Two twins
    /// taught alike and asked alike give the same reply, the Offer button's
    /// and a search control's and a drift, even when a pick is recorded on
    /// one of them between two steps: the walk keeps the target it began on.
    /// No handle outlives its reply, and a handle that is not in hand answers
    /// as nothing.
    #[test]
    fn a_stepped_offer_gives_the_reply_the_one_call_gives() {
        let tree_of = |e: &mut WasmEngine| -> String {
            let id = serde_json::from_str::<Vec<serde_json::Value>>(&e.ranked()).unwrap()[0]["id"]
                .as_u64()
                .unwrap() as u32;
            assert!(e.edit_begin(id));
            e.edit_tree_json()
        };
        let mut one = taught_wasm(5);
        let mut stepped = taught_wasm(5);
        // The same tree for both (module uids come off a process-wide
        // counter, so the twins' own copies are numbered apart).
        let tree = tree_of(&mut one);
        let grit = auracle_session::perform::CONTROLS
            .iter()
            .position(|c| c.name == "Grit")
            .unwrap() as u32;
        let mut picked = false;
        let mut compared = 0;
        for (control, sign, drift) in [
            (None, None, false),
            (Some(grit), Some(1.0), false),
            (None, None, true),
        ] {
            let (want, begun) = if drift {
                (
                    one.perform_drift(&tree, "[]", "[]", 5, 0.1),
                    stepped.perform_drift_begin(&tree, "[]", "[]", 5, 0.1),
                )
            } else {
                (
                    one.perform_offer(&tree, "[]", "[]", 4, control, sign),
                    stepped.perform_offer_begin(&tree, "[]", "[]", 4, control, sign),
                )
            };
            let Some(job) = serde_json::from_str::<serde_json::Value>(&begun)
                .unwrap()
                .get("job")
                .and_then(|j| j.as_u64())
            else {
                // Cannot start: the one call said the same.
                assert_eq!(begun, want);
                continue;
            };
            let job = job as u32;
            assert_eq!(stepped.jobs.len(), 1);
            let mut steps = 0;
            while stepped.perform_job_step(job, 1) {
                steps += 1;
                // A pick, between two steps (once, and only with a tree to
                // pick against).
                let v: serde_json::Value = serde_json::from_str(&want).unwrap();
                if steps == 1 && !picked && v.get("tree").is_some() {
                    picked = stepped.perform_record(&tree, "[]", &v["tree"].to_string(), true);
                    assert!(picked, "the pick was not recorded");
                }
            }
            assert!(steps > 1, "a walk of several renders is several steps");
            assert_eq!(stepped.perform_job_finish(job), want);
            assert_eq!(stepped.jobs.len(), 0, "the handle was spent");
            compared += 1;
        }
        assert!(compared > 0, "no walk began, so nothing was compared");
        assert!(picked, "no pick was made between steps");
        // Not in hand: nothing to step, nothing to answer.
        assert!(!stepped.perform_job_step(9_999, 1));
        assert_eq!(stepped.perform_job_finish(9_999), "null");
        // Dropped: spent, and not answered.
        let begun = stepped.perform_offer_begin(&tree, "[]", "[]", 4, None, None);
        if let Some(job) = serde_json::from_str::<serde_json::Value>(&begun)
            .unwrap()
            .get("job")
            .and_then(|j| j.as_u64())
        {
            assert!(stepped.perform_job_drop(job as u32));
            assert!(!stepped.perform_job_drop(job as u32));
            assert_eq!(stepped.jobs.len(), 0);
        }
    }

    /// A walk's reply says what was true when it began. A drift begun before
    /// any taste existed says `taste: false` even if a posterior was fitted
    /// before it finished (an import, a refit): it was walked on the grammar.
    #[test]
    fn a_walk_replies_with_the_state_it_began_in() {
        let mut engine = WasmEngine::new(7, 12);
        engine.engine.cfg.mcmc_samples = 3_000;
        engine.engine.cfg.mcmc_warmup = 1_000;
        while engine.fill_step(4) > 0 {}
        let id = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked()).unwrap()[0]["id"]
            .as_u64()
            .unwrap() as u32;
        assert!(engine.edit_begin(id));
        let tree = engine.edit_tree_json();
        assert!(!engine.engine.has_taste(), "an untaught engine");
        let begun: serde_json::Value =
            serde_json::from_str(&engine.perform_drift_begin(&tree, "[]", "[]", 6, 0.15)).unwrap();
        let job = begun["job"].as_u64().expect("a drift begins") as u32;
        assert!(engine.perform_job_step(job, 1));
        for _ in 0..16 {
            let [a, b]: [u64; 2] = serde_json::from_str::<Option<[u64; 2]>>(&engine.next_duel())
                .unwrap()
                .expect("a duel");
            engine.record_duel(a as u32, b as u32, (a * 7 + b) % 3 != 0);
        }
        engine.fit();
        assert!(engine.engine.has_taste(), "taught while the drift was out");
        while engine.perform_job_step(job, 1) {}
        let reply: serde_json::Value =
            serde_json::from_str(&engine.perform_job_finish(job)).unwrap();
        if reply.get("reason").is_none() {
            assert_eq!(reply["taste"], false, "{reply}");
        }
        // A walk begun now is taste-directed.
        let begun: serde_json::Value =
            serde_json::from_str(&engine.perform_drift_begin(&tree, "[]", "[]", 6, 0.15)).unwrap();
        assert!(begun.get("job").is_some(), "a drift begins");
        let reply: serde_json::Value =
            serde_json::from_str(&engine.run_job(&begun.to_string())).unwrap();
        if reply.get("reason").is_none() {
            assert_eq!(reply["taste"], true, "{reply}");
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
            // The player's input, which `describe` reports as `audio_in`.
            (NodeKind::AudioIn, "audio_in"),
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
            NodeKind::AudioIn,
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

    /// A face is the picture of the audition the member plays from, taken
    /// from the memo when its row has one and from a render when it has not
    /// (a row stored before faces existed).
    #[test]
    fn a_members_face_is_its_stored_auditions_from_the_memo_or_a_render() {
        let mut engine = WasmEngine::new(3, 8);
        farm_fill(&mut engine, false);
        let ids: Vec<u64> = engine.engine.pool.iter().map(|c| c.id).collect();
        for &id in &ids {
            // From the memo: the fill featurized it, and the face came with it.
            let from_memo = engine.face_of(id as u32, false);
            assert_eq!(from_memo.len(), auracle_features::FACE_LEN);
            let stored = engine.engine.render_of(id).expect("renders");
            let of_audition = Face::of_f32(&stored.samples, stored.sample_rate);
            assert_eq!(
                from_memo,
                of_audition.bytes(),
                "id {id}: the picture of the audition it plays"
            );
            assert!(engine
                .face_key(id as u32)
                .ends_with(&engine.engine.pool[engine.engine.find(id).unwrap()].key));
        }
        // A row without a face (stored before faces): none without a render,
        // the same face with one.
        let id = ids[0];
        let i = engine.engine.find(id).unwrap();
        let key = engine.engine.pool[i].key.clone();
        let want = engine.face_of(id as u32, false);
        let mut row = engine.engine.memo().get(&key).unwrap();
        row.face = None;
        engine.engine.memo().put(row, None);
        engine.engine.pool[i].render = None;
        let tree = serde_json::to_string(&engine.engine.pool[i].tree).unwrap();
        if engine.engine.memo().get_audio(&key).is_none() {
            assert!(
                engine.face_of(id as u32, false).is_empty(),
                "no face without a render"
            );
        }
        assert_eq!(engine.face_of(id as u32, true), want);
        assert!(
            engine.engine.pool[i].render.is_none(),
            "a face's render is not kept: it evicts no audition"
        );
        assert_eq!(
            engine.face_of_tree(&tree, false),
            want,
            "and the tree's face is the member's"
        );
        assert!(engine.face_of(9_999, true).is_empty());
        assert!(engine.face_key(9_999).is_empty());
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

    /// A selector's tree reaches the voices with the makeup its own render
    /// measured, never the previous tree's: on a sample of the presets'
    /// selector changes (every enum site but `table` and `oct`, every other
    /// option; `examples/selector_makeup.rs` walks all 355), the makeup that
    /// comes back with the edited tree is the one a full measurement of that
    /// tree gives. The previous tree's makeup was off by more than 3 dB on
    /// almost half of the changes, up to 27 dB hot.
    #[test]
    fn a_selector_change_comes_back_at_its_measured_makeup() {
        use auracle_grammar::describe::KnobKind;
        let phrase = PhraseSpec::default();
        let mut changes = Vec::new();
        for (name, tree) in presets() {
            for module in describe(&tree).modules {
                for knob in module.knobs {
                    let KnobKind::Enum { options } = &knob.kind else {
                        continue;
                    };
                    let site = knob.addr.rsplit('#').next().unwrap_or("");
                    if site == "table" || site == "oct" {
                        continue;
                    }
                    let cur = knob.value.round() as usize;
                    for v in (0..options.len()).filter(|&v| v != cur) {
                        changes.push((name, tree.clone(), knob.addr.clone(), v));
                    }
                }
            }
        }
        assert!(changes.len() > 300, "{} selector changes", changes.len());
        let mut engine = WasmEngine::new(0x5E1E, 6);
        while engine.fill_step(3) > 0 {}
        let id = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked()).unwrap()[0]["id"]
            .as_u64()
            .unwrap() as u32;
        assert!(engine.edit_begin(id));
        let mut far = 0;
        let sample: Vec<_> = changes.iter().step_by(25).collect();
        for (name, tree, addr, v) in &sample {
            assert_eq!(
                engine.edit_set_tree(&serde_json::to_string(tree).unwrap()),
                ""
            );
            let before = engine.edit_makeup();
            assert!(engine.edit_param(addr, *v as f64, true), "{name} {addr}");
            let edited = set_param(tree, addr, ParamValue::Index(*v)).unwrap();
            let measured = live_makeup(
                &auracle_features::featurize(&edited, &phrase)
                    .expect("presets' selector changes vet")
                    .features,
            );
            assert!(engine.edit_vet_ok(), "{name} {addr} → {v}");
            assert!(
                (engine.edit_makeup() - measured).abs() < 1e-9 * measured,
                "{name} {addr} → {v}: makeup {} where its render measures {measured}",
                engine.edit_makeup()
            );
            if (20.0 * (before / measured).log10()).abs() > 3.0 {
                far += 1;
            }
        }
        // Why the tree waits: the sample holds changes the previous makeup
        // would have played more than 3 dB off.
        assert!(far > 0, "no change in the sample moved the level 3 dB");
    }

    /// An undo or a redo lands on a tree the engine measured when it was made,
    /// and `edit_known_makeup` gives that measurement before the render: the
    /// makeup the revet then measures. A tree never measured has none.
    #[test]
    fn an_undone_selector_has_its_measured_makeup_before_its_render() {
        let mut engine = WasmEngine::new(0x5E1E, 6);
        while engine.fill_step(3) > 0 {}
        let id = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked()).unwrap()[0]["id"]
            .as_u64()
            .unwrap() as u32;
        assert!(engine.edit_begin(id));
        let rack: serde_json::Value = serde_json::from_str(&engine.edit_describe()).unwrap();
        let wave = rack["modules"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|m| m["knobs"].as_array().unwrap().iter())
            .find(|k| k["addr"].as_str().unwrap().ends_with("#wave"))
            .expect("the patch has an oscillator with a wave selector");
        let addr = wave["addr"].as_str().unwrap().to_string();
        let n = wave["kind"]["options"].as_array().unwrap().len();
        let next = ((wave["value"].as_f64().unwrap().round() as usize + 1) % n) as f64;
        let (tree0, makeup0) = (engine.edit_tree_json(), engine.edit_makeup());
        assert!(engine.edit_param(&addr, next, true));
        let (tree1, makeup1) = (engine.edit_tree_json(), engine.edit_makeup());
        assert_ne!(makeup1, makeup0);
        // Undo: the tree being left is measured as makeup1, the one landed
        // on as makeup0, before any render.
        assert_eq!(engine.edit_set_tree_apply(&tree0), "");
        assert_eq!(engine.edit_makeup(), makeup1, "the makeup moved unmeasured");
        assert_eq!(engine.edit_known_makeup(), makeup0);
        engine.edit_revet();
        assert_eq!(engine.edit_makeup(), makeup0);
        // Redo, the same way.
        assert_eq!(engine.edit_set_tree_apply(&tree1), "");
        assert_eq!(engine.edit_known_makeup(), makeup1);
        // A tree never measured: no makeup to go on.
        assert!(engine.edit_param_apply("amp#attack", 0.123_456_7, false));
        assert_eq!(engine.edit_known_makeup(), -1.0);
    }

    /// `edit_param` is its write and `edit_revet`: the tree moves at once and
    /// the render, the makeup, the vet and φ wait for the revet, which lands
    /// exactly where `edit_param` does. A refused write moves nothing.
    #[test]
    fn a_selector_written_before_its_render_lands_where_edit_param_does() {
        let mut engine = WasmEngine::new(0x5E1E, 6);
        while engine.fill_step(3) > 0 {}
        let id = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked()).unwrap()[0]["id"]
            .as_u64()
            .unwrap() as u32;
        assert!(engine.edit_begin(id));
        let rack: serde_json::Value = serde_json::from_str(&engine.edit_describe()).unwrap();
        let (addr, next) = rack["modules"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|m| m["knobs"].as_array().unwrap().iter())
            .find(|k| k["addr"].as_str().unwrap().ends_with("#wave"))
            .map(|k| {
                let n = k["kind"]["options"].as_array().unwrap().len();
                let v = k["value"].as_f64().unwrap().round() as usize;
                (
                    k["addr"].as_str().unwrap().to_string(),
                    ((v + 1) % n) as f64,
                )
            })
            .expect("the patch has an oscillator with a wave selector");
        let (tree0, render0) = (engine.edit_tree_json(), engine.edit_render());
        let (makeup0, phi0) = (engine.edit_makeup(), engine.bench_phi.clone());
        assert!(engine.edit_vet_ok() && phi0.is_some());

        assert!(!engine.edit_param_apply(&addr, f64::NAN, true));
        assert!(!engine.edit_param_apply("node/9/9#nowhere", next, true));
        assert_eq!(
            engine.edit_tree_json(),
            tree0,
            "a refused write moved the tree"
        );

        assert!(engine.edit_param_apply(&addr, next, true));
        let tree1 = engine.edit_tree_json();
        assert_ne!(tree1, tree0, "the write did not reach the tree");
        assert_eq!(
            engine.edit_render(),
            render0,
            "the render moved before it was asked for"
        );
        assert_eq!(engine.edit_makeup(), makeup0, "the makeup moved unmeasured");
        assert_eq!(engine.bench_phi, phi0, "φ moved unmeasured");
        engine.edit_revet();
        let (render1, makeup1, phi1) = (
            engine.edit_render(),
            engine.edit_makeup(),
            engine.bench_phi.clone(),
        );
        assert!(engine.edit_vet_ok());
        assert_ne!(render1, render0, "another wave rendered the same phrase");
        assert_ne!(phi1, phi0, "another wave measured the same φ");
        assert_ne!(makeup1, makeup0, "another wave measured the same makeup");

        assert_eq!(engine.edit_set_tree(&tree0), "");
        assert_eq!(engine.edit_makeup(), makeup0);
        assert!(engine.edit_param(&addr, next, true));
        assert_eq!(engine.edit_tree_json(), tree1);
        assert_eq!(engine.edit_render(), render1);
        assert_eq!(engine.edit_makeup(), makeup1);
        assert_eq!(engine.bench_phi, phi1);
        assert!(engine.edit_vet_ok());
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

    /// **A take reaches a sound through the edit the app already sends.** A
    /// CAPTURE placed on the bench plays nothing yet and fails the vet as
    /// silent, as an unplugged socket does; a recording arriving as a
    /// `set_take` structural edit (the saved form quiver's `Capture` writes)
    /// makes it a sound that vets, saved in the bench's term; an unreadable
    /// one is refused in words and changes nothing. No new binding: the web
    /// task's capture flow rides `edit_structure`.
    #[test]
    fn a_take_arrives_on_the_bench_through_a_structural_edit() {
        let mut engine = WasmEngine::new(0xCA9, 6);
        while engine.fill_step(3) > 0 {}
        let id = serde_json::from_str::<Vec<serde_json::Value>>(&engine.ranked()).unwrap()[0]["id"]
            .as_u64()
            .unwrap() as u32;
        assert!(engine.edit_begin(id));
        assert_eq!(
            engine.edit_structure(r#"{"op":"replace","key":"node","kind":"capture"}"#),
            ""
        );
        assert!(
            engine.edit_vet_silent(),
            "an empty capture played something"
        );
        let sr = auracle_features::PhraseSpec::default().sample_rate;
        let x: Vec<f32> = (0..(1.5 * sr) as usize)
            .map(|i| (0.5 * (i as f64 * 220.0 * std::f64::consts::TAU / sr).sin()) as f32)
            .collect();
        let take =
            serde_json::to_string(&auracle_grammar::Take::from_samples(&x, sr).unwrap()).unwrap();
        let set = format!(r#"{{"op":"set_take","key":"node","take":{take}}}"#);
        assert_eq!(engine.edit_structure(&set), "");
        assert!(engine.edit_vet_ok(), "a capture with a take failed the vet");
        let bench: auracle_grammar::PatchTree =
            serde_json::from_str(&engine.edit_tree_json()).unwrap();
        assert!(bench.has_takes(), "the take is not in the bench's term");
        let refused =
            engine.edit_structure(r#"{"op":"set_take","key":"node","take":{"format":"x"}}"#);
        assert!(!refused.is_empty(), "an unreadable take was taken");
        assert!(engine.edit_vet_ok(), "a refused take changed the bench");
    }

    /// **A held sound, through the boundary the worker uses.** A session whose
    /// bank holds a sound that is only a CAPTURE with an unreadable take
    /// restores without it in the pool, reports it as held (apart from the
    /// repairs) and lists it with its sentence; a readable take brings it back
    /// into the pool, and a bad one is refused in words and changes nothing.
    #[test]
    fn a_held_sound_is_listed_and_readmitted_through_the_worker_surface() {
        use auracle_grammar::term::{AmpEnv, AudioNode, CaptureMode, InputChannel};
        let mut engine = WasmEngine::new(0x4E1D, 6);
        while engine.fill_step(3) > 0 {}
        let sr = PhraseSpec::default().sample_rate;
        let x: Vec<f32> = (0..sr as usize)
            .map(|i| (0.5 * (i as f64 * 196.0 * std::f64::consts::TAU / sr).sin()) as f32)
            .collect();
        let take = auracle_grammar::Take::from_samples(&x, sr).unwrap();
        let tree = PatchTree {
            amp: AmpEnv {
                attack: 0.02,
                decay: 0.3,
                sustain: 0.8,
                release: 0.3,
            },
            root: AudioNode::Capture {
                uid: auracle_grammar::Uid::NEW,
                play: CaptureMode::Once,
                input: Box::new(AudioNode::AudioIn {
                    uid: auracle_grammar::Uid::NEW,
                    input: 0,
                    gain: auracle_grammar::INPUT_GAIN_UNITY,
                    channel: InputChannel::Both,
                }),
                take: take.clone(),
            },
        };
        let mut state: serde_json::Value = serde_json::from_str(&engine.export_session()).unwrap();
        let bank = state["bank"].as_array_mut().unwrap();
        let mut held = bank[0].clone();
        held["id"] = 9_999.into();
        held["name"] = "Held One".into();
        held["tree"] = serde_json::to_value(&tree).unwrap();
        held["tree"]["root"]["Capture"]["take"]["length"] = 3.into();
        bank.push(held);
        let restored = engine.import_session(&state.to_string());
        let listed: serde_json::Value = serde_json::from_str(&engine.held_sounds()).unwrap();
        assert_eq!(listed.as_array().unwrap().len(), 1);
        assert_eq!(listed[0]["id"], 9_999);
        assert_eq!(listed[0]["name"], "Held One");
        // What the page records it again with: the capture's key, and the
        // term (so a recorder can be built from it with no bench).
        assert_eq!(listed[0]["capture"], "node");
        let listed_tree: PatchTree =
            serde_json::from_value(listed[0]["tree"].clone()).expect("the held term");
        assert_eq!(listed_tree.lost_take_key().as_deref(), Some("node"));
        // …serialized from its type, in declaration order (ADR-002), not
        // through a `Value`'s sorted map (which put a Capture's `input`
        // before its `play`).
        let own = serde_json::to_string(&engine.engine.held()[0].tree).unwrap();
        assert!(
            engine.held_sounds().contains(&own),
            "the held term is not listed as it serializes"
        );
        assert!(listed[0]["note"]
            .as_str()
            .unwrap()
            .contains("couldn’t be read"));
        let report: serde_json::Value = serde_json::from_str(&engine.repair_report()).unwrap();
        assert_eq!(report["held"], 1);
        assert_eq!(
            report["terms"], 0,
            "a held sound is not counted as repaired"
        );
        let ranked: Vec<serde_json::Value> = serde_json::from_str(&engine.ranked()).unwrap();
        assert!(
            ranked.iter().all(|r| r["id"] != 9_999),
            "a held sound was ranked"
        );
        assert_eq!(ranked.len(), restored);
        // A take that can't be read is refused in words.
        let refused: serde_json::Value =
            serde_json::from_str(&engine.readmit_held(9_999, r#"{"format":"x"}"#)).unwrap();
        assert_eq!(refused["ok"], false);
        assert!(!refused["error"].as_str().unwrap().is_empty());
        // A readable one brings it back.
        let good = serde_json::to_string(&take).unwrap();
        let back: serde_json::Value =
            serde_json::from_str(&engine.readmit_held(9_999, &good)).unwrap();
        assert_eq!(back["ok"], true);
        assert_eq!(back["id"], 9_999);
        assert_eq!(engine.held_sounds(), "[]");
        let ranked: Vec<serde_json::Value> = serde_json::from_str(&engine.ranked()).unwrap();
        assert!(
            ranked.iter().any(|r| r["id"] == 9_999),
            "the readmitted sound is not in the bank"
        );
    }
}
