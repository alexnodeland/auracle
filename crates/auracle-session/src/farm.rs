//! The stateless render farm: an **indexed** pool-draw stream, and the
//! off-engine unit of work it hands out.
//!
//! ## Why the draw stream is indexed
//!
//! The pool used to be filled from one advancing [`rand::Rng`]: draw, render,
//! dedupe, push, repeat. That makes the *n*-th tree a function of how many
//! draws happened before it, which is fine while one loop owns the RNG and
//! fatal the moment renders are farmed out to workers — a lost job, a
//! speculative draw past the stop point, or simply a different number of
//! renders in flight all shift the stream.
//!
//! Here draw *i* is instead sampled from a fresh
//! `StdRng::seed_from_u64(draw_seed(fill_seed, i))`. Three properties follow,
//! and together they are what makes the farm's determinism structural rather
//! than argued:
//!
//! 1. **Re-issue is stateless.** A worker that dies mid-job costs nothing but
//!    the render: the job is `(fill_seed, i)`, so any other worker can redo it
//!    with no retained state on either side.
//! 2. **Over-issue is free.** Work dispatched past the point the pool fills is
//!    simply discarded; it cannot desynchronize a stream it never advanced.
//! 3. **Width is invisible.** The pool is the fold of indices `0, 1, 2, …` in
//!    order — dedupe and vetting applied at absorption time — so the result
//!    depends on `(fill_seed, pool_size)` alone, at any farm width including
//!    zero.
//!
//! The consequence, stated plainly: **fixed-seed pools re-baselined** when this
//! landed. That is invisible to the app (the browser seeds from
//! `Math.random()`, and saved sessions store trees rather than seeds) but any
//! test asserting exact pool contents from a fixed seed had to move with it.

use std::sync::Arc;

use auracle_features::{
    featurize_memo, Audition, CachedFeatures, FeaturizeError, PhraseSpec, RenderMemo,
};
use auracle_grammar::PatchTree;
use serde::{Deserialize, Serialize};

/// splitmix64 over `(base, index)` — the pool draw stream's index function.
///
/// splitmix64 rather than "seed the RNG with `base ^ index`" because adjacent
/// seeds must produce *unrelated* streams: `StdRng` is ChaCha12, which would
/// tolerate the naive version, but the whole point of this function is that
/// nothing downstream has to know that. splitmix64 decorrelates by
/// construction and is the mixer `SeedableRng::seed_from_u64` itself uses.
#[inline]
pub fn draw_seed(base: u64, index: u64) -> u64 {
    let mut z = base
        .wrapping_add(index.wrapping_mul(0x9E37_79B9_7F4A_7C15))
        .wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// A candidate whose render, vetting and featurization already happened —
/// in a farm worker, or on the way back from transport.
///
/// It carries exactly what [`auracle_features::featurize_memo`] produces,
/// minus the work: the term, its [`CachedFeatures`] (content key, raw φ, vet
/// report, onsets, length), and optionally the audition buffer. The engine
/// folds one of these in with [`crate::Engine::absorb_prior`] or
/// [`crate::Engine::absorb_bank_entry`], which apply the *same* dedupe,
/// standardization and admission rules the in-process path applies.
///
/// A **failed** vet has no `PreFeaturized`: it is `None` at the absorb site,
/// which is how a quarantined draw stays a normal outcome rather than an
/// error.
#[derive(Clone, Debug)]
pub struct PreFeaturized {
    /// The term.
    pub tree: PatchTree,
    /// Everything the featurization produced except the samples.
    pub cached: CachedFeatures,
    /// The audition buffer, when the producer was asked for one and it
    /// survived transport. Absent is never a failure signal — φ is the
    /// product, audio is the option.
    pub audition: Option<Arc<Audition>>,
}

impl PreFeaturized {
    /// Render, vet and featurize one term **without an [`crate::Engine`]** —
    /// the farm worker's entire job.
    ///
    /// Deliberately unmemoized: a farm worker is a pure function of its
    /// arguments and holds no state between jobs, which is what lets the
    /// engine treat any worker as interchangeable with any other (and with
    /// itself).
    pub fn render(
        tree: PatchTree,
        spec: &PhraseSpec,
        want_audio: bool,
    ) -> Result<Self, FeaturizeError> {
        let (cached, audition) = featurize_memo(&tree, spec, &RenderMemo::disabled(), want_audio)?;
        Ok(Self {
            tree,
            cached,
            audition,
        })
    }
}

/// One unit of farm work: an index of the draw stream and the term it names.
///
/// `dup` is a courtesy, not a decision: the term already sits in the pool, so
/// rendering it would be wasted. The absorbing engine re-checks against the
/// pool as it actually stands at index `index`, so a stale or missing `dup`
/// costs a render and changes nothing.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Draw {
    /// Index in the pool draw stream.
    #[serde(rename = "i")]
    pub index: u64,
    /// The term at that index.
    pub tree: PatchTree,
    /// Already in the pool when this was issued — skippable.
    pub dup: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Indexing must decorrelate: neighbouring indices are unrelated seeds,
    /// and the same `(base, index)` always names the same one.
    #[test]
    fn draw_seed_is_pure_and_decorrelated() {
        assert_eq!(draw_seed(7, 3), draw_seed(7, 3));
        assert_ne!(draw_seed(7, 3), draw_seed(7, 4));
        assert_ne!(draw_seed(7, 3), draw_seed(8, 3));
        // Adjacent indices must not differ in a handful of bits.
        let a = draw_seed(0xC0FFEE, 0);
        let b = draw_seed(0xC0FFEE, 1);
        assert!(
            (a ^ b).count_ones() > 8,
            "adjacent draw seeds barely differ: {a:x} vs {b:x}"
        );
    }
}
