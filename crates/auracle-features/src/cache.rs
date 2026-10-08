//! Content-addressed memoization of [`crate::featurize`] (design L0).
//!
//! φ is a pure function of `(term, spec)` — that is the determinism contract
//! [`crate::render`] states — so any featurization the engine has already
//! performed can be replayed instead of re-rendered. That matters because the
//! engine performs the *same* featurization repeatedly and unavoidably:
//!
//! - A refinement walk runs the model once per step (the proposal), and a
//!   rejected step proposes a tree the walk may already have rendered; the
//!   drift walks and the chain's seed score re-render trees the same way.
//! - `Engine::insert_candidate` re-featurizes the tree the refinement walk (or
//!   the edit bench) just featurized, to obtain the φ it admits it with.
//!
//! Neither is a bug to be deleted — the first is inside a dependency's kernel,
//! the second is the honest way to admit a candidate. A memo removes the cost
//! without touching either. It is *exactly* lossless: a hit returns the same
//! [`Features`] object the miss produced, so nothing downstream — least of all
//! the raw φ that enters the observation log — can tell the two apart.
//!
//! ## Keys
//!
//! [`render_key`] is `fnv1a128` over `serde_json` of the term and of the
//! phrase spec. FNV rather than `DefaultHasher` because `DefaultHasher`'s
//! output is explicitly not guaranteed stable across Rust releases, and this
//! key is meant to be persistable (design L2) — a toolchain bump must not
//! silently invalidate every stored row. `serde_json` is deterministic across
//! runs and platforms for these types: field order is the struct's, and floats
//! round-trip exactly under the `float_roundtrip` feature the workspace pins.
//!
//! ## Persisting a row: the key is not enough
//!
//! [`render_key`] addresses `(term, spec)`, which is everything φ depends on
//! *given a fixed featurizer*. A stored row survives a reload only if the code
//! that would recompute it agrees, and the key cannot see that code: change the
//! normalizer, a descriptor's formula, or the vet gate, and the same key now
//! names a different measurement.
//!
//! [`RENDER_EPOCH`] is that missing coordinate, and [`cache_namespace`]
//! combines the two. Bumping the epoch orphans every stored row at once, which
//! is the intended and only correct response to φ moving — a persistent cache
//! whose invalidation is *anything less than* total is a cache that will one
//! day serve a number from a featurizer that no longer exists.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use auracle_grammar::PatchTree;
use serde::{Deserialize, Serialize};

use crate::face::Face;
use crate::phrase::PhraseSpec;
use crate::pipeline::{featurize, Features, FeaturizeError};
use crate::render::Audition;

const FNV_OFFSET_128: u128 = 0x6c62_272e_07bb_0142_62b8_2175_6295_c58d;
const FNV_PRIME_128: u128 = 0x0000_0000_0100_0000_0000_0000_0000_013b;

fn fnv1a128(state: u128, bytes: &[u8]) -> u128 {
    let mut h = state;
    for b in bytes {
        h ^= *b as u128;
        h = h.wrapping_mul(FNV_PRIME_128);
    }
    h
}

/// The exact bytes a key is computed over for a term.
///
/// Deterministic across runs and platforms: `serde_json` emits struct fields
/// in declaration order and shortest-round-trip floats (ryu).
pub fn canonical_tree_json(tree: &PatchTree) -> String {
    // Uids are stripped first, and this is load-bearing rather than tidy. A
    // `uid` is UI identity: two trees that differ only in theirs are the same
    // patch and render the same audio, so a key that saw them would miss on
    // *every* refinement step (the chain re-scores a tree it just rendered, and
    // that tree comes back from the trace decoder with fresh identities) and
    // would invalidate every persistable row the moment the editor renamed a
    // node. Cleared uids also serialize to nothing — the field is skipped when
    // unset — so this key is byte-identical to the one this cache used before
    // identities existed, and no stored entry is orphaned by their arrival.
    let mut plain = tree.clone();
    plain.clear_uids();
    serde_json::to_string(&plain).expect("PatchTree always serializes")
}

/// Generation of the featurizer itself.
///
/// **Bump this whenever a stored [`CachedFeatures`] computed by the previous
/// build would differ from what this build computes for the same `(term,
/// spec)`.** [`render_key`] cannot detect that: it hashes the inputs, and this
/// is a change in the function.
///
/// Concretely, bump on any change to: a φ coordinate's formula or its set,
/// loudness normalization (including `loudness::PEAK_CEILING` and
/// `pipeline::TARGET_LUFS`), the vetting thresholds, or the compiler's mapping
/// from a term to quiver modules. When in doubt, bump — the cost is one cold
/// boot, and the cost of not bumping is a posterior fitted on rows from two
/// different featurizers with no way to tell which is which.
///
/// | epoch | what changed |
/// |---|---|
/// | 1 | first persistent cache; peak-capped loudness normalization |
/// | 2 | the motion bands: three φ_audio coordinates (`motion_slow`, `motion_mid`, `motion_fast`) — an epoch-1 row lacks them and does not deserialize |
/// | 3 | pink noise leaves the compiler through a 20 Hz highpass (it carried 22 % of its energy below 20 Hz), so every patch with a pink source renders differently |
///
/// The face ([`CachedFeatures::face`]) is not epoch-bearing: it is optional,
/// a row without one is still current φ, and the app completes a missing
/// face with a render. A change to how a face is *measured* does need a bump,
/// or rows would serve the old picture.
pub const RENDER_EPOCH: u32 = 3;

/// The `quiver-dsp` version this build renders with, folded into
/// [`cache_namespace`] beside [`RENDER_EPOCH`].
///
/// The epoch's list of things that invalidate a stored row named the formula,
/// the vet gate and the compiler's mapping — every function *this* workspace
/// owns — and not the DSP library every one of them calls into. A dependency
/// bump can change a sample without any line here changing, and a stored φ
/// from the old DSP would then be served as if it were the new one. So the
/// dependency is a coordinate of the namespace too.
///
/// Hand-maintained rather than read from the build, because Cargo does not
/// expose a dependency's version to `env!`; `quiver_version_matches_the_lock`
/// reads `Cargo.lock` and fails the suite the moment the two disagree.
pub const QUIVER_DSP_VERSION: &str = "0.4.0";

/// The persistent cache's namespace for one stimulus:
/// `"e<epoch>:q<quiver version>:<spec hash>"`.
///
/// Three coordinates, because three independent things invalidate a stored
/// row — the featurizer changing ([`RENDER_EPOCH`]), the DSP it renders with
/// changing ([`QUIVER_DSP_VERSION`]) and the stimulus changing (the spec). The
/// spec is folded into [`render_key`] as well, so that part is redundant for
/// correctness and useful for operations: it makes a whole stimulus's rows a
/// contiguous, droppable prefix instead of scattered keys that can only be
/// evicted by trying them.
///
/// **The audition clip is not in it.** The farm's store is stamped with its
/// namespace and cleared when the stamp changes, so a clip here would throw
/// away every cached render each time the player captured one, though only
/// the patches that listen measure differently. The clip is in those
/// patches' [`render_key`]s instead, which every stored row's key carries.
pub fn cache_namespace(spec: &PhraseSpec) -> String {
    let spec_json = spec_key_json(spec);
    let h = fnv1a128(FNV_OFFSET_128, spec_json.as_bytes());
    format!("e{RENDER_EPOCH}:q{QUIVER_DSP_VERSION}:{h:032x}")
}

/// Content address of one `(term, spec)` featurization, 32 lowercase hex
/// chars.
///
/// The spec is folded in because φ is only defined relative to the stimulus:
/// two engines with different phrases must never share an entry. A `0xff`
/// separator (not a valid byte anywhere in either JSON) keeps the
/// concatenation unambiguous.
///
/// # The audition clip
///
/// A patch that listens ([`PatchTree::listens`]) is measured with the
/// stimulus's audition clip, so its address names the clip: after the spec, a
/// `0xfe` separator and the clip's content id
/// ([`AuditionClip::id`](crate::clip::AuditionClip::id), the reference's own
/// when the spec has none). Two clips therefore never share a row. The clip's
/// samples are never hashed here (its id already is a hash of them), and a
/// patch that does not listen keys exactly as it did before clips existed,
/// whatever clip the session holds, because its render does not depend on
/// one.
pub fn render_key(tree: &PatchTree, spec: &PhraseSpec) -> String {
    let tree_json = canonical_tree_json(tree);
    let spec_json = spec_key_json(spec);
    let mut h = fnv1a128(FNV_OFFSET_128, tree_json.as_bytes());
    h = fnv1a128(h, &[0xff]);
    h = fnv1a128(h, spec_json.as_bytes());
    if tree.listens() {
        h = fnv1a128(h, &[0xfe]);
        h = fnv1a128(h, spec.audition_clip().id().as_bytes());
    }
    format!("{h:032x}")
}

/// The bytes a key hashes for a stimulus: the spec without its clip, which
/// is the spec as it was serialized before clips existed.
fn spec_key_json(spec: &PhraseSpec) -> String {
    serde_json::to_string(&spec.without_clip()).expect("PhraseSpec always serializes")
}

/// Everything [`featurize`] produces except the samples — the persistable
/// unit, and what a memo hit returns.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CachedFeatures {
    /// Content address ([`render_key`]).
    pub key: String,
    /// The extracted features, byte-for-byte what `featurize` returned.
    pub features: Features,
    /// Sample index where each note's gate opened.
    pub note_onsets: Vec<usize>,
    /// Length of the render in samples.
    pub n_samples: usize,
    /// The render's face ([`crate::face`]): a picture for the app, not part
    /// of φ. Computed from the same render as everything above. `None` in a
    /// row stored before faces existed; such a row is still current φ, and
    /// the app completes its face with a render when it needs one (which is
    /// why faces arriving did not bump [`RENDER_EPOCH`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub face: Option<Face>,
}

/// Memo occupancy and hit accounting.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MemoStats {
    /// Featurizations served from the memo.
    pub hits: u64,
    /// Featurizations that had to render.
    pub misses: u64,
    /// Resident feature entries.
    pub features: usize,
    /// Resident audition buffers.
    pub audio: usize,
    /// Bytes held by those audition buffers.
    pub audio_bytes: usize,
}

struct MemoInner {
    feature_cap: usize,
    audio_cap: usize,
    tick: u64,
    features: HashMap<String, (u64, CachedFeatures)>,
    audio: HashMap<String, (u64, Arc<Audition>)>,
    hits: u64,
    misses: u64,
}

impl MemoInner {
    fn next_tick(&mut self) -> u64 {
        self.tick += 1;
        self.tick
    }
}

/// Evict least-recently-used entries until `map` fits `cap`.
///
/// Linear scan per eviction: with the shipped caps (2048 φ / 12 buffers) that
/// is a few thousand integer compares against the ~0.5 s render an eviction
/// is making room for, so a proper intrusive LRU would be complexity bought
/// with nothing.
fn evict_to<V>(map: &mut HashMap<String, (u64, V)>, cap: usize) {
    while map.len() > cap {
        let oldest = map
            .iter()
            .min_by_key(|(_, (t, _))| *t)
            .map(|(k, _)| k.clone())
            .expect("a map over its cap holds an entry");
        map.remove(&oldest);
    }
}

/// A bounded, content-addressed featurization memo.
///
/// Cheap to clone (shared interior) and guarded by a `Mutex`, and every access
/// here is uncontended.
///
/// This used to say the `Send + Sync` shape was for `fugue_evo::Fitness`, "if
/// the `parallel` feature were ever enabled". Enabling it would do nothing:
/// every `rayon` use in fugue-evo is under `#[cfg(feature = "classic")]` — the
/// classic EC layer's `algorithms/`, `population/` and `fitness/` — and the
/// workspace takes fugue-evo with `["std", "ppl"]`, driving refinement itself
/// through `inference::mh::EvolutionChain`. The flag would compile rayon in and
/// change no code path this crate reaches.
///
/// Parallelising refinement is still possible, just Auracle-side and worth
/// less than it looks: `search_health` and the `refinement_improves_pool`
/// floor already spawn a thread per seed and saturate the cores, so a
/// measurement would not get faster. What it would buy is latency on a *single*
/// refinement — the app's ⚡ button — which is a UX win rather than a harness
/// one, and this type is shaped for it either way.
///
/// Two tiers, both LRU, because they cost three orders of magnitude apart:
/// ~1 KB of φ against ~565 KB of audio. Keeping thousands of the former and a
/// dozen of the latter is what lets a whole refinement generation stay
/// resident while audition memory stays flat.
#[derive(Clone)]
pub struct RenderMemo(Arc<Mutex<MemoInner>>);

/// Feature entries retained. A refinement generation is a few hundred
/// featurizations; 2048 keeps a whole session's worth of walks resident at
/// ~2 MB.
pub const DEFAULT_FEATURE_CAP: usize = 2048;
/// Audition buffers retained (~565 KB each at the default phrase) — enough
/// for the current duel pair, the bench, and recent history, at ~7 MB.
pub const DEFAULT_AUDIO_CAP: usize = 12;

impl Default for RenderMemo {
    fn default() -> Self {
        Self::new(DEFAULT_FEATURE_CAP, DEFAULT_AUDIO_CAP)
    }
}

impl std::fmt::Debug for RenderMemo {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RenderMemo")
            .field("stats", &self.stats())
            .finish()
    }
}

impl RenderMemo {
    /// A memo holding `feature_cap` φ entries and `audio_cap` audition
    /// buffers, both LRU.
    pub fn new(feature_cap: usize, audio_cap: usize) -> Self {
        Self(Arc::new(Mutex::new(MemoInner {
            feature_cap,
            audio_cap,
            tick: 0,
            features: HashMap::new(),
            audio: HashMap::new(),
            hits: 0,
            misses: 0,
        })))
    }

    /// A memo that stores nothing — the null object for callers that want the
    /// unmemoized path without a second code path.
    pub fn disabled() -> Self {
        Self::new(0, 0)
    }

    /// Features for `key`, if resident. Counts as a use for LRU purposes.
    pub fn get(&self, key: &str) -> Option<CachedFeatures> {
        let mut m = self.0.lock().expect("memo poisoned");
        let t = m.next_tick();
        let e = m.features.get_mut(key)?;
        e.0 = t;
        Some(e.1.clone())
    }

    /// Audition buffer for `key`, if resident. Counts as a use.
    ///
    /// Shared, not copied: a ~565 KB buffer is handed out as an [`Arc`] so
    /// that looking one up costs a refcount bump rather than a half-megabyte
    /// memcpy. Callers that need to own samples clone the inner value
    /// explicitly, which makes every deep copy of an audition visible at its
    /// call site.
    pub fn get_audio(&self, key: &str) -> Option<Arc<Audition>> {
        let mut m = self.0.lock().expect("memo poisoned");
        let t = m.next_tick();
        let e = m.audio.get_mut(key)?;
        e.0 = t;
        Some(Arc::clone(&e.1))
    }

    /// Store a featurization, optionally with its audition buffer.
    pub fn put(&self, entry: CachedFeatures, audio: Option<Arc<Audition>>) {
        let mut m = self.0.lock().expect("memo poisoned");
        let t = m.next_tick();
        if let Some(a) = audio {
            if m.audio_cap > 0 {
                m.audio.insert(entry.key.clone(), (t, a));
                let cap = m.audio_cap;
                evict_to(&mut m.audio, cap);
            }
        }
        if m.feature_cap > 0 {
            m.features.insert(entry.key.clone(), (t, entry));
            let cap = m.feature_cap;
            evict_to(&mut m.features, cap);
        }
    }

    /// Occupancy and hit accounting.
    pub fn stats(&self) -> MemoStats {
        let m = self.0.lock().expect("memo poisoned");
        MemoStats {
            hits: m.hits,
            misses: m.misses,
            features: m.features.len(),
            audio: m.audio.len(),
            audio_bytes: m.audio.values().map(|(_, a)| a.bytes()).sum(),
        }
    }

    /// Drop everything. Used when the phrase spec changes under a live
    /// engine, which would otherwise leave keys from two stimuli in one map.
    pub fn clear(&self) {
        let mut m = self.0.lock().expect("memo poisoned");
        m.features.clear();
        m.audio.clear();
    }

    fn record(&self, hit: bool) {
        let mut m = self.0.lock().expect("memo poisoned");
        if hit {
            m.hits += 1;
        } else {
            m.misses += 1;
        }
    }
}

/// [`featurize`], consulting `memo` first and populating it on a miss.
///
/// `want_audio` says whether the caller has any use for samples. It is not a
/// hint: with it `false` this function never converts f64→f32 and never
/// touches the audio tier, so the refinement surrogate — which runs this once
/// per MH step and discards audio every time — pays for φ and nothing else.
/// Asking for audio you will not play costs a ~565 KB conversion on a miss and
/// keeps a buffer alive on a hit, which is the whole expense the memo exists
/// to remove.
///
/// With `want_audio`, returns the audition buffer **when this call rendered it
/// or found it still resident**; a hit whose buffer has aged out of the small
/// audio tier yields `None`, and callers that need one regardless re-derive it
/// with [`crate::render_playback`]. The buffer is shared with the memo through
/// an [`Arc`], so producing it allocates once.
///
/// Only successes are memoized. A quarantined or uncompilable term is
/// re-attempted on every request, which costs a render — but the trees that
/// repeat are precisely the ones MH has *accepted*, and an accepted tree
/// vetted by construction. Caching failures would buy a rounding error and
/// require the vet report to survive round-tripping through the memo, where a
/// stale one would be a DESIGN §2.1 gate bypass.
pub fn featurize_memo(
    tree: &PatchTree,
    spec: &PhraseSpec,
    memo: &RenderMemo,
    want_audio: bool,
) -> Result<(CachedFeatures, Option<Arc<Audition>>), FeaturizeError> {
    let key = render_key(tree, spec);
    if let Some(hit) = memo.get(&key) {
        memo.record(true);
        let audio = if want_audio {
            memo.get_audio(&key)
        } else {
            None
        };
        return Ok((hit, audio));
    }
    memo.record(false);
    let v = featurize(tree, spec)?;
    let audition = want_audio.then(|| Arc::new(v.render.to_audition()));
    let entry = CachedFeatures {
        key,
        features: v.features,
        n_samples: v.render.samples.len(),
        // From the same render, read as the audition's f32 samples, so this
        // face equals the one taken from the stored audition.
        face: Some(Face::of_f64(&v.render.samples, v.render.sample_rate)),
        note_onsets: v.render.note_onsets,
    };
    memo.put(entry.clone(), audition.clone());
    Ok((entry, audition))
}

#[cfg(test)]
mod tests;
