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
//! | `import_patch(tree_json, name) -> u32` | unchanged shape | now also `0` for a tree over the `validate_tree` ceilings, which every other write route already refused. The tree lands in normal form (`normalize_tree`), and a file whose normal form the bank already holds is that sound: `0`, and `bank_twin_of` names it. |
//! | `bank_twin_of(tree_json) -> u32` | the id of the bank's sound the file is, or `0` | Compared in normal form, as `import_patch` compares it, so a `0` from the import is told apart: a twin is a sound to open, no twin a refusal. `0` for a file that does not read. |
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
    apply_struct_op, describe, normalize_tree, presets, set_param, validate_tree, ParamValue,
    PatchGrammarPrior, PatchTree, StructOp,
};
use auracle_session::{
    run_walk, BankEntry, ClipChange, ClipStatus, DealSchedule, EditOutcome, Engine, GuessMemory,
    GuessSkip, Origin, PreFeaturized, Profile, ReadmitError, RenderPolicy, SessionConfig,
    SessionState, WalkContext, WalkJob, WalkResult,
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
    /// Which standardizer the session's φ lives under ([`standardizer_rev`]):
    /// it changes when a fit or a restore moves the scale (the sounds the
    /// session has met changed since), and not on a pick.
    /// PERFORM keys a kept wiring's staleness to it (#290). Empty before there
    /// is one.
    std_rev: String,
}

/// A fingerprint of a standardizer's audio coordinates (their means and
/// spreads, FNV-1a over their bits, as hex): the scale a PERFORM wiring is
/// measured in. Two sessions on the same pool and log have the same one.
fn standardizer_rev(std: &auracle_taste::Standardizer) -> String {
    let n = auracle_features::AudioFeatures::NAMES.len();
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for v in std.mean.iter().take(n).chain(std.std.iter().take(n)) {
        for b in v.to_bits().to_le_bytes() {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
    }
    format!("{h:016x}")
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
    let cached = json_or(&pre.cached, "");
    let samples = pre
        .audition
        .map(|a| Arc::unwrap_or_clone(a).samples)
        .unwrap_or_default();
    RenderJob {
        ok: !cached.is_empty(),
        cached,
        samples,
    }
}

/// `value` as JSON, or `fallback` when it cannot be written.
///
/// Every reply here is a derived `Serialize` whose maps are keyed by
/// strings, which serde_json always writes, so the fallback is not expected
/// to be used. It is there because a binding that panicked would poison the
/// engine for every later call (`docs/runbooks/wasm-engine-poisoned.md`),
/// and each reply names the empty shape its caller already reads instead.
fn json_or<T: Serialize + ?Sized>(value: &T, fallback: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| fallback.to_owned())
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
    match auracle_features::cable_levels(tree, spec) {
        Ok(p) => json_or(&p, "null"),
        Err(_) => "null".into(),
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
    json_or(r, "null")
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
    /// How each kind of module's knob moves φ, for the wiring PERFORM plays
    /// before a sound is measured ([`WasmEngine::perform_table_set`]). `None`
    /// until the worker hands over the shipped wirings; then
    /// [`WasmEngine::perform_first`] predicts.
    knob_table: Option<auracle_session::predict::KnobTable>,
    /// PERFORM's walks in the middle ([`WasmEngine::perform_offer_begin`],
    /// [`WasmEngine::perform_drift_begin`]), by handle.
    jobs: std::collections::HashMap<u32, Held>,
    next_job: u32,
    /// How far into the pool each deal of this session reaches, and how many
    /// have been drawn ([`WasmEngine::set_deal_schedule`]). No schedule until
    /// the worker sets one.
    deals: DealSchedule,
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

/// The ids a deal must not use, from the worker's `Uint32Array`.
fn exclude_ids(exclude: Option<Vec<u32>>) -> Vec<u64> {
    exclude
        .unwrap_or_default()
        .into_iter()
        .map(u64::from)
        .collect()
}

/// The first `seconds` (at least 0.1 s) of `a` as it is played: levelled
/// over the whole phrase and cut afterwards, so a preview is exactly the
/// head of what ▶ plays, and faded out at the cut.
///
/// A phrase cut at an arbitrary sample is a step discontinuity, which is a
/// click, and a click at the end of every audition is the loudest thing in
/// the preview. 12 ms of cosine is below the threshold where a release sounds
/// shortened and well above the one where an edge is audible. The ramp ends
/// exactly at zero: t runs over 0..=1, so the last sample is multiplied by
/// cos(π) + 1 = 0. It used to stop one step short, at (fade−1)/fade, and left
/// about 9e-6 of a loud patch's last sample, the very edge the fade exists to
/// remove.
fn faded_head(a: &Audition, seconds: f64) -> Vec<f32> {
    let played = audition_pcm(a);
    let n = ((seconds.max(0.1) * a.sample_rate) as usize).min(played.len());
    let mut out = played[..n].to_vec();
    let fade = ((0.012 * a.sample_rate) as usize).min(out.len());
    let span = fade.saturating_sub(1).max(1) as f32;
    for i in 0..fade {
        let t = i as f32 / span;
        let k = out.len() - fade + i;
        out[k] *= 0.5 * (1.0 + (std::f32::consts::PI * t).cos());
    }
    out
}

/// Parse `tree_json` and write the knob `overrides_json` (`[[addr, value]]`)
/// into it, each value clamped to a knob's range (a JSON number is always
/// finite). Addresses that are not continuous knobs on this tree are
/// skipped, and overrides that do not read are none. `None` only if the tree
/// itself does not parse.
fn performed_tree(tree_json: &str, overrides_json: &str) -> Option<PatchTree> {
    let tree = serde_json::from_str::<PatchTree>(tree_json).ok()?;
    Some(with_overrides(tree, overrides_json))
}

/// `tree` with the knob `overrides_json` written into it, as
/// [`performed_tree`] does.
fn with_overrides(mut tree: PatchTree, overrides_json: &str) -> PatchTree {
    let overrides: Vec<(String, f64)> = serde_json::from_str(overrides_json).unwrap_or_default();
    for (addr, v) in overrides {
        let v = v.clamp(0.0, auracle_session::perform::KNOB_MAX);
        if let Ok(t) = auracle_grammar::edit::set_param(
            &tree,
            &addr,
            auracle_grammar::edit::ParamValue::Continuous(v),
        ) {
            tree = t;
        }
    }
    tree
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
            knob_table: None,
            jobs: std::collections::HashMap::new(),
            next_job: 1,
            deals: DealSchedule::default(),
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
        json_or(&self.engine.fill_draw(n), "[]")
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
        json_or(&jobs, "[]")
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
            std_rev: self
                .engine
                .standardizer()
                .map(standardizer_rev)
                .unwrap_or_default(),
        })
        .unwrap()
    }

    /// Choose the next duel: JSON `[idA, idB]`, or `null` if the pool is
    /// small. See [`WasmEngine::next_duel_ex`] for the annotated form.
    pub fn next_duel(&mut self) -> String {
        let pair = self
            .deal(&[], true)
            .map(|d| [self.engine.pool[d.a].id, self.engine.pool[d.b].id]);
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
        let choice = self.deal(&exclude, true);
        self.duel_json(choice)
    }

    /// [`WasmEngine::next_duel_ex`] without counting the pair as shown: the
    /// caller says when it puts the pair in front of the player
    /// ([`WasmEngine::duel_shown`]). A deal thrown away unseen then moves
    /// nothing — not the check cadence the calibration sample is paced by,
    /// not the repeat and exposure penalties. Same JSON, same random stream.
    pub fn deal_duel_ex(&mut self, exclude: Option<Vec<u32>>) -> String {
        let exclude = exclude_ids(exclude);
        let choice = self.deal(&exclude, false);
        self.duel_json(choice)
    }

    /// Deal by the fill's schedule (#211): the `k`-th deal of the session
    /// draws only from the first `step · (k + 1)` sounds of the pool, in pool
    /// order, until that reaches the pool's size, and every later deal from
    /// the whole pool ([`DealSchedule`]). In a session opened with a seed in
    /// the address, the worker sets it at boot to the size the app is handed
    /// over at, so the first deal waits for nothing, or to 0 when the pool is
    /// already full (a saved bank that came back whole has no fill to keep
    /// to). Every other session it sets to 0: an ordinary session deals at
    /// once from the sounds that have joined, so a pick never waits for more
    /// to join. Counts deals from 0 again; `0` is no schedule.
    pub fn set_deal_schedule(&mut self, step: usize) {
        self.deals = DealSchedule::new(step);
    }

    /// How many sounds the pool must hold before the next deal, with
    /// `exclude` not dealt, is drawn as the schedule says: 0 when it can be
    /// drawn now. Draws nothing. The worker holds a deal until this is 0, or
    /// the fill is over.
    pub fn deal_need(&self, exclude: Option<Vec<u32>>) -> u32 {
        let exclude = exclude_ids(exclude);
        self.engine.deal_need(&self.rng.duel, &exclude, &self.deals) as u32
    }

    /// The next deal, by the schedule, from the duel stream; counted as shown
    /// at once when `shown`.
    fn deal(&mut self, exclude: &[u64], shown: bool) -> Option<auracle_session::DuelChoice> {
        let choice =
            self.engine
                .deal_duel_scheduled(&mut self.rng.duel, exclude, &mut self.deals)?;
        if shown {
            let (a, b) = (self.engine.pool[choice.a].id, self.engine.pool[choice.b].id);
            self.engine.duel_shown(a, b);
        }
        Some(choice)
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
        auracle_features::render_playback(&c.tree, &self.engine.cfg.phrase, c.features.gain_db)
            .map(|a| self.remember_face(&key, &a).bytes().to_vec())
            .unwrap_or_default()
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

    /// Open a generation with its jobs kept in the engine; returns the parent
    /// ids to refine from as a JSON array, in job order, or `[]` if there is
    /// no taste to refine toward yet (in which case no generation is opened).
    ///
    /// The serial driver: pair it with [`WasmEngine::refine_seed`] to run the
    /// generation one walk at a time in this worker and show progress. The
    /// farm driver is [`WasmEngine::refine_jobs`].
    pub fn refine_begin(&mut self) -> String {
        json_or(&self.engine.refine_begin(&mut self.rng.refine), "[]")
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
        json_or(&reply, r#"{"context":null,"jobs":[]}"#)
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
    /// the lowest members not kept (`Candidate::kept`: saved, or kept as new
    /// and not yet in a pick) are retired until the pool is back to size,
    /// and results still in flight will read `"stale"`. Returns the retired
    /// ids as a JSON array, lowest first. Idempotent.
    pub fn refine_finish(&mut self) -> String {
        json_or(&self.engine.refine_finish(), "[]")
    }

    /// The ids the last generation to finish retired, lowest first, as a JSON
    /// array — including a finish that happened on its last
    /// [`WasmEngine::refine_absorb`]. They are no longer in the bank.
    pub fn refine_retired(&self) -> String {
        json_or(self.engine.retired(), "[]")
    }

    /// The ids the end of the running generation would retire if it ended
    /// now, lowest first, as a JSON array — the rows a save would rescue.
    /// `[]` when the pool is not over size.
    pub fn refine_retiring(&self) -> String {
        json_or(&self.engine.retiring(), "[]")
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
        json_or(&reply, r#"{"reason":"no_taste"}"#)
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
            Err(e) => json_or(
                &OwnReply {
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
                },
                "null",
            ),
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
        json_or(&reply, "null")
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
        json_or(&reply, r#"{"context":null,"jobs":[]}"#)
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
        json_or(&need, "[]")
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

    /// Which way your taste leans along each named control at the performed
    /// state (`tree` plus knob `overrides`), for PERFORM under the model view:
    /// JSON `[{index, name, mean, std}]`, one per control in the order asked
    /// (`controls` as for [`Self::perform_wire`], the six when left out),
    /// `index` the control's palette index. `mean` and `std` are the posterior
    /// slope of the utility along the control's direction at that sound,
    /// through the lens that claims it in each draw
    /// (`auracle_session::Engine::lean`); a lean whose `mean ± std` crosses
    /// zero is a guess. `null` before the first fit, and for a tree that does
    /// not parse or vet. One featurization through the memo: the tree PERFORM
    /// measured renders nothing.
    pub fn perform_lean(
        &self,
        tree_json: &str,
        overrides_json: &str,
        controls: Option<String>,
    ) -> String {
        let Some(tree) = performed_tree(tree_json, overrides_json) else {
            return "null".into();
        };
        let set = palette_set(controls.as_deref());
        match self.engine.lean(&tree, &set) {
            Some(leans) => json_or(&leans, "null"),
            None => "null".into(),
        }
    }

    /// Hand over the table PERFORM predicts a first wiring from (#290): the
    /// text of the app's `perform-wirings.json`, whose `knobs` is how each
    /// kind of module's knob moved φ in the presets' and the standard pool's
    /// measurements (`make perform-wirings`). Returns whether the file held a
    /// table over today's audio φ; without one, [`Self::perform_first`]
    /// predicts nothing.
    pub fn perform_table_set(&mut self, wirings_json: &str) -> bool {
        #[derive(serde::Deserialize)]
        struct File {
            knobs: auracle_session::predict::KnobTable,
        }
        let names = auracle_features::AudioFeatures::NAMES;
        self.knob_table = serde_json::from_str::<File>(wirings_json)
            .ok()
            .map(|f| f.knobs)
            .filter(|t| t.names.iter().map(String::as_str).eq(names.iter().copied()));
        self.knob_table.is_some()
    }

    /// What PERFORM can play `tree_json` on before it is measured (#290),
    /// with no render: `{shape, knobs, predicted}`. `shape` is the tree's
    /// structure without its knob values
    /// ([`auracle_session::predict::shape_of`]): a measured relative of the
    /// same shape lends its wiring, centred on this tree's `knobs` (its live
    /// knobs, `[[addr, value], …]`). `predicted` is the wiring predicted from
    /// the table ([`auracle_session::Engine::wire_predicted`]) in
    /// [`Self::perform_wire`]'s shape, unverified, its `z` empty when the
    /// memo does not hold the tree's render; `null` without a table or a
    /// standardizer. `controls` as for [`Self::perform_wire`]. `null` if the
    /// tree does not parse.
    pub fn perform_first(&self, tree_json: &str, controls: Option<String>) -> String {
        let Ok(tree) = serde_json::from_str::<PatchTree>(tree_json) else {
            return "null".into();
        };
        let set = palette_set(controls.as_deref());
        let predicted = self
            .knob_table
            .as_ref()
            .and_then(|t| self.engine.wire_predicted(&tree, &set, t))
            .map(|(jac, wiring)| {
                serde_json::json!({
                    "addrs": jac.addrs,
                    "values": jac.values,
                    "z": jac.z,
                    "wiring": wiring,
                })
            });
        let knobs = auracle_session::perform::live_knobs(&tree, self.engine.cfg.phrase.sample_rate);
        serde_json::json!({
            "shape": auracle_session::predict::shape_of(&tree),
            "knobs": knobs,
            "predicted": predicted,
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
        json_or(&knobs, "[]")
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
    ///
    /// A recorded answer is a pick for the sound in hand, `tree` as it is in
    /// the bank, whatever its controls were moved to: a sound kept as new and
    /// played in PERFORM competes like any other once it has been in one
    /// ([`auracle_session::Engine::mark_judged`]).
    ///
    /// `as_of` is the newest pool id the page had seen when the answer was
    /// given (`u32::MAX` for no bound): a Take waits eight seconds before it
    /// is recorded, and a sound kept as new in that window is not judged by
    /// it ([`auracle_session::Engine::record_tree_duel_as_of`]).
    pub fn perform_record(
        &mut self,
        tree_json: &str,
        overrides_json: &str,
        offer_json: &str,
        took_offer: bool,
        as_of: u32,
    ) -> bool {
        let (Ok(held), Ok(offer)) = (
            serde_json::from_str::<PatchTree>(tree_json),
            serde_json::from_str::<PatchTree>(offer_json),
        ) else {
            return false;
        };
        let home = with_overrides(held.clone(), overrides_json);
        let as_of = if as_of == u32::MAX {
            u64::MAX
        } else {
            as_of as u64
        };
        let recorded = self.engine.record_tree_duel_as_of(
            &home,
            &offer,
            !took_offer,
            auracle_taste::Provenance::PerformOffer,
            as_of,
        );
        if recorded {
            self.engine.mark_judged(&held, as_of);
        }
        recorded
    }

    /// `tree` with knob `overrides` (`[[addr, value], …]`) written into its
    /// genome, as JSON; `null` if the tree does not parse. Unknown or
    /// structural addresses are skipped rather than failing the whole write:
    /// the performance surface writes the knobs it wired, and a patch that
    /// changed underneath it should lose those writes, not the others.
    pub fn perform_apply(&self, tree_json: &str, overrides_json: &str) -> String {
        match performed_tree(tree_json, overrides_json) {
            Some(t) => json_or(&t, "null"),
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
                    // `display_names` names every member of the pool.
                    name: names.get(&c.id).cloned().unwrap_or_default(),
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
        json_or(
            &self.engine.belief(),
            r#"{"ranked":[],"seeds":[],"may_replace":[]}"#,
        )
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
        json_or(&self.engine.forecasts, "[]")
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
        json_or(&map, "{}")
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
    /// (−1 before the first fit, for an unknown id, or for a member not yet
    /// standardized).
    pub fn best_style_of(&self, id: u32) -> i32 {
        let standardized = self
            .engine
            .find(id as u64)
            .map(|i| &self.engine.pool[i].phi_std)
            .filter(|phi| !phi.is_empty());
        let (Some(phi), Some(p)) = (standardized, &self.engine.posterior) else {
            return -1;
        };
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
    ///
    /// A preset already featurized without its audio (a warm-start card the
    /// worker measured while the player chose, with [`Self::memo_render`]) is
    /// a φ hit here too, and keeps no buffer: its insert renders nothing, and
    /// the `render_of` after it renders the sound once.
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

    /// Import a shared patch (tree JSON + optional name) into the bank, in
    /// normal form ([`auracle_session::Engine::import_patch`]). Returns the
    /// new id, or 0 (bad JSON / over the ceilings / duplicate / vet failure).
    pub fn import_patch(&mut self, tree_json: &str, name: &str) -> u32 {
        let Ok(tree) = serde_json::from_str::<PatchTree>(tree_json) else {
            return 0;
        };
        self.engine.import_patch(tree, name).unwrap_or(0) as u32
    }

    /// The id of the bank's sound a patch file already is, compared in
    /// normal form as `import_patch` compares it
    /// ([`auracle_session::Engine::bank_twin_of`]), or 0 (bad JSON / none).
    /// What the worker asks when an import answers 0: a file the bank holds
    /// is opened as that sound, not called one that failed the vet.
    pub fn bank_twin_of(&self, tree_json: &str) -> u32 {
        let Ok(tree) = serde_json::from_str::<PatchTree>(tree_json) else {
            return 0;
        };
        self.engine.bank_twin_of(&tree).unwrap_or(0) as u32
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
        let edited = match serde_json::from_str::<StructOp>(op_json) {
            Ok(op) => apply_struct_op(tree, &op),
            Err(e) => return format!("the engine couldn’t read that edit ({e})"),
        };
        self.bench_adopt(edited)
    }

    /// Adopt a structural edit's result: the edited tree onto the bench and
    /// `""`, or the reason it was refused, the bench unchanged.
    fn bench_adopt(&mut self, edited: Result<PatchTree, auracle_grammar::StructError>) -> String {
        match edited {
            Ok(tree) => {
                self.bench_set(tree);
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
        // The term is put in normal form and the ceilings are refused, and the
        // split is the same one `finish()` makes: a knob outside its range and
        // a modulation term the grammar folds have one obviously right answer,
        // and a 40-node patch does not. It matters here because a rewrite is
        // computed from the tree already on the bench — so if that tree came
        // out of a session written before this gate, refusing would mean the
        // player cannot edit their way out of the corruption, only look at it.
        // Folded here, once, the term is not left for the next edit to
        // rewrite, or for the guess to read as a patch with no room.
        normalize_tree(&mut tree);
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
        self.bench_set(tree);
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
        // `apply_struct_op` refuses an edit past the grammar's ceilings, the
        // gate `edit_set_tree_apply` runs: a preview is not a commit, but
        // auditioning a patch the grammar would refuse teaches the player a
        // move that will be taken away from them later.
        let Ok(edited) = apply_struct_op(tree, &op) else {
            return Vec::new();
        };
        let (phrase, memo) = (self.phrase(), self.engine.memo().clone());
        let Ok((cf, audio)) = featurize_memo(&edited, &phrase, &memo, true) else {
            return Vec::new();
        };
        // The render is the one this patch would be measured on (a memo hit
        // whose buffer aged out renders it again).
        bench_audio(&edited, &phrase, &cf.features, audio)
            .map(|a| faded_head(&a, seconds))
            .unwrap_or_default()
    }

    /// The patch the bench's guesses are remembered under: the pool id it
    /// was opened from, or the sound keep as new last made from it
    /// (`guess_key`).
    fn guess_patch(&self) -> u64 {
        self.guess_key.unwrap_or(0)
    }

    /// Put `tree` on the bench, after asking the guesses' memory whether it
    /// is the patch as it was before one of its taken guesses: an undo (or
    /// the module taken out again), which counts as a skip, logged once (a
    /// family already skipped there is not logged again).
    fn bench_set(&mut self, tree: PatchTree) {
        let patch = self.guess_patch();
        if let Some(skip) = self.guesses.observe(patch, &tree) {
            self.log_guess("guess_skip", &skip, true);
        }
        self.bench_tree = Some(tree);
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
            Ok(p) => json_or(
                &Plan {
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
                },
                &refusal("full"),
            ),
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
            Ok(r) => json_or(&r, &refusal("full")),
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
        let err = self.bench_adopt(apply_struct_op(&before, &taken.op));
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

    /// The exact per-feature decomposition of that number, as JSON, or
    /// `null` before the first fit (`auracle_session::Engine::explain_phi`):
    ///
    /// ```json
    /// {"id":0,"style":1,"style_name":"Dark Drones",
    ///  "utility":0.84,"utility_std":0.31,
    ///  "mix_utility":0.91,"responsibility":0.86,
    ///  "contributions":[{"name":"centroid_mean","theta":0.42,
    ///                    "phi_std":1.01,"contribution":0.42}, …]}
    /// ```
    ///
    /// Contributions are sorted by descending |contribution| and sum exactly
    /// to `utility`, which is linear within a lens, so this is an exact
    /// decomposition rather than a surrogate. **Draw `mix_utility` as the
    /// score**: it is what the bank is ranked by and what
    /// [`Self::edit_utility`] calls `u`; `utility` is the lens-conditional
    /// quantity the contributions explain, never above it, and
    /// `responsibility` says how far apart the two are for this patch.
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
        json_or(&held, "[]")
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
mod tests;
