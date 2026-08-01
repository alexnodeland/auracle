//! Content-addressed memoization of [`crate::featurize`] (design L0).
//!
//! φ is a pure function of `(term, spec)` — that is the determinism contract
//! [`crate::render`] states — so any featurization the engine has already
//! performed can be replayed instead of re-rendered. That matters because the
//! engine performs the *same* featurization repeatedly and unavoidably:
//!
//! - `fugue-ppl`'s adaptive single-site MH executes the model **twice per
//!   step**, once to re-score the current trace — which is bit-identically the
//!   tree the previous step accepted. Every refinement step therefore renders
//!   one tree it has already rendered.
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
//! Only the *in-process* memo is built here. The persistent-cache namespace
//! (`RENDER_EPOCH`, `cache_namespace`) and the admit path belong to the
//! IndexedDB layer and are deliberately not present yet.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use ricercar_grammar::PatchTree;
use serde::{Deserialize, Serialize};

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
    serde_json::to_string(tree).expect("PatchTree always serializes")
}

/// Content address of one `(term, spec)` featurization, 32 lowercase hex
/// chars.
///
/// The spec is folded in because φ is only defined relative to the stimulus:
/// two engines with different phrases must never share an entry. A `0xff`
/// separator (not a valid byte anywhere in either JSON) keeps the
/// concatenation unambiguous.
pub fn render_key(tree: &PatchTree, spec: &PhraseSpec) -> String {
    let tree_json = canonical_tree_json(tree);
    let spec_json = serde_json::to_string(spec).expect("PhraseSpec always serializes");
    let mut h = fnv1a128(FNV_OFFSET_128, tree_json.as_bytes());
    h = fnv1a128(h, &[0xff]);
    h = fnv1a128(h, spec_json.as_bytes());
    format!("{h:032x}")
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
        let Some(oldest) = map
            .iter()
            .min_by_key(|(_, (t, _))| *t)
            .map(|(k, _)| k.clone())
        else {
            return;
        };
        map.remove(&oldest);
    }
}

/// A bounded, content-addressed featurization memo.
///
/// Cheap to clone (shared interior) and guarded by a `Mutex`, so it satisfies
/// the `Send + Sync` shape `fugue_evo::Fitness` would need if the `parallel`
/// feature were ever enabled — today the workspace takes fugue-evo with
/// default features off, and every access here is uncontended.
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
/// touches the audio tier, so the refinement surrogate — which runs this twice
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
        note_onsets: v.render.note_onsets,
        n_samples: v.render.samples.len(),
    };
    memo.put(entry.clone(), audition.clone());
    Ok((entry, audition))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::render_playback;
    use ricercar_grammar::term::{AmpEnv, AudioNode, Waveform};

    fn tree(detune: f64) -> PatchTree {
        PatchTree {
            amp: AmpEnv {
                attack: 0.05,
                decay: 0.3,
                sustain: 0.8,
                release: 0.3,
            },
            root: AudioNode::Vco {
                wave: Waveform::Saw,
                octave: 0,
                detune,
                mod_depth: 0.0,
                modulation: ricercar_grammar::term::ModNode::None,
            },
        }
    }

    /// The whole contract: a hit is indistinguishable from a miss.
    #[test]
    fn memo_hit_equals_fresh_featurize() {
        let spec = PhraseSpec::default();
        let memo = RenderMemo::default();
        let t = tree(0.5);
        let fresh = featurize(&t, &spec).unwrap();
        let (miss, _) = featurize_memo(&t, &spec, &memo, true).unwrap();
        let (hit, _) = featurize_memo(&t, &spec, &memo, true).unwrap();
        assert_eq!(fresh.features.phi(), miss.features.phi());
        assert_eq!(fresh.features.phi(), hit.features.phi());
        assert_eq!(fresh.features.gain_db, hit.features.gain_db);
        assert_eq!(fresh.features.lufs_before, hit.features.lufs_before);
        assert_eq!(fresh.render.note_onsets, hit.note_onsets);
        assert_eq!(fresh.render.samples.len(), hit.n_samples);
        let s = memo.stats();
        assert_eq!((s.hits, s.misses), (1, 1), "second call must not render");
    }

    /// Keys separate distinct terms and distinct stimuli, and are stable.
    #[test]
    fn keys_are_content_addressed() {
        let spec = PhraseSpec::default();
        assert_eq!(render_key(&tree(0.5), &spec), render_key(&tree(0.5), &spec));
        assert_ne!(render_key(&tree(0.5), &spec), render_key(&tree(0.6), &spec));
        let other = PhraseSpec {
            seed: spec.seed ^ 1,
            ..spec.clone()
        };
        assert_ne!(
            render_key(&tree(0.5), &spec),
            render_key(&tree(0.5), &other),
            "a different stimulus is a different φ"
        );
        assert_eq!(render_key(&tree(0.5), &spec).len(), 32);
    }

    /// `render_playback` replays the recorded gain, so the buffer it produces
    /// is the one `featurize` normalized — bit for bit. This is what makes a
    /// lazily-materialized audition safe to hand to the audio path.
    #[test]
    fn render_playback_is_bit_identical() {
        let spec = PhraseSpec::default();
        for detune in [0.0, 0.5, 0.9] {
            let t = tree(detune);
            let v = featurize(&t, &spec).unwrap();
            let replayed = render_playback(&t, &spec, v.features.gain_db).unwrap();
            let direct = v.render.to_audition();
            assert_eq!(replayed.sample_rate, direct.sample_rate);
            assert_eq!(
                replayed.samples, direct.samples,
                "lazy audition drifted from the featurized render"
            );
        }
    }

    /// Both tiers stay bounded, and the audio tier is the one that shrinks.
    #[test]
    fn caps_are_enforced() {
        let spec = PhraseSpec::default();
        let memo = RenderMemo::new(3, 1);
        for i in 0..4 {
            featurize_memo(&tree(0.1 * (i as f64 + 1.0)), &spec, &memo, true).unwrap();
        }
        let s = memo.stats();
        assert_eq!(s.features, 3, "feature tier over cap");
        assert_eq!(s.audio, 1, "audio tier over cap");
        assert!(s.audio_bytes > 0);
        memo.clear();
        assert_eq!(memo.stats().features, 0);
    }

    /// A zero-cap memo is a working no-op, not a panic or a leak.
    #[test]
    fn disabled_memo_stores_nothing() {
        let spec = PhraseSpec::default();
        let memo = RenderMemo::disabled();
        let t = tree(0.5);
        featurize_memo(&t, &spec, &memo, true).unwrap();
        let (again, _) = featurize_memo(&t, &spec, &memo, true).unwrap();
        assert_eq!(memo.stats().features, 0);
        assert_eq!(memo.stats().misses, 2);
        assert_eq!(
            again.features.phi(),
            featurize(&t, &spec).unwrap().features.phi()
        );
    }
}
