//! What PERFORM's shipped wirings were measured from.
//!
//! The app ships a measurement of every preset (`apps/web/perform-wirings.json`,
//! written by the `preset_wirings` example, `make perform-wirings`), so a
//! preset's named controls work the moment it lands instead of after the
//! eleven-odd seconds of renders a first measurement costs in the browser. A
//! shipped wiring is a starting point, not the last word: it was taken under a
//! standardizer fitted natively, not this session's, and the app re-measures
//! it in the background as it does any stale wiring.
//!
//! What can go stale without anyone noticing is the file itself, and a stale
//! file wires a control to the wrong knobs until the re-check lands — and then
//! the re-check re-centres the controls, the jump shipping them was meant to
//! remove. Two kinds of change make it stale, and `tests/shipped_wirings.rs`
//! catches each its own way:
//!
//! - **Named inputs**: a preset edited, added or renamed, or the phrase, the
//!   render namespace (the featurizer's `RENDER_EPOCH` or the quiver
//!   version), the feature names, the controls or PERFORM's constants
//!   changed. The file carries a fingerprint of each preset's content and one
//!   of these inputs ([`preset_source`], [`measurement_fingerprint`]);
//!   comparing them renders nothing.
//! - **Arithmetic**: the feature maths, loudness normalization, vetting, the
//!   compiler and the DSP, the grammar prior the standard pool is drawn from,
//!   the standardizer fit, PERFORM's solver. No fingerprint of the inputs sees
//!   these, so the test re-measures a fixed sample instead: it boots the engine
//!   the file was measured under ([`boot`], a few seconds of renders spread
//!   over the machine's cores), compares its standardizer with the one the
//!   file records, re-renders the standardized φ (`z`) of every
//!   [`Z_PROBE_STRIDE`]-th preset, and re-measures the whole wiring of the
//!   [`WIRE_PROBES`], all within [`TOLERANCE`].
//!
//! A change that moves none of the sample can still slip through; the sample
//! is chosen to be cheap and broad, not complete.

use auracle_features::{cache_namespace, featurize_memo, AudioFeatures, PhraseSpec};
use auracle_grammar::PatchTree;
use auracle_session::perform;

use crate::WasmEngine;

/// The engine seed the shipped wirings are measured under. Fixed, so the file
/// is reproducible.
pub const SEED: u64 = 20_260_928;
/// The pool the standardizer is fitted to: the page's own size.
pub const POOL: usize = 40;
/// Every this-many-th preset (from the first) has its standardized φ
/// re-rendered by the currency test: one render each.
pub const Z_PROBE_STRIDE: usize = 8;
/// Presets the currency test re-measures in full, wiring and all: two of the
/// cheapest to measure (seven and six knobs, a couple of seconds each), so
/// PERFORM's own arithmetic is covered without minutes of renders.
pub const WIRE_PROBES: [usize; 2] = [7, 19];
/// How far a re-measured number may sit from the shipped one, relative to its
/// size (absolute below 1). Loose enough for another platform's `libm`, tight
/// enough that any change to what is measured shows.
pub const TOLERANCE: f64 = 1e-6;

/// FNV-1a, 64 bit, as 16 hex digits: stable across platforms and runs, which
/// `std`'s hasher does not promise.
fn fnv(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// Drop every node uid: they are minted per process, and two trees that
/// differ only in uids are the same patch (as the app's `wireKey` treats them).
fn strip_uids(v: &mut serde_json::Value) {
    match v {
        serde_json::Value::Object(m) => {
            m.remove("uid");
            m.values_mut().for_each(strip_uids);
        }
        serde_json::Value::Array(xs) => xs.iter_mut().for_each(strip_uids),
        _ => {}
    }
}

/// A preset's content, uids aside: its name and its tree.
pub fn preset_source(name: &str, tree: &PatchTree) -> String {
    let mut v = serde_json::to_value(tree).unwrap_or(serde_json::Value::Null);
    strip_uids(&mut v);
    fnv(format!("{name}\n{v}").as_bytes())
}

/// The measurement's inputs other than the patch: the audition phrase, the
/// render namespace φ is measured in ([`cache_namespace`]: the featurizer's
/// `RENDER_EPOCH` and the quiver version), the feature names the controls'
/// directions are read in, the controls themselves and the constants that
/// shape a wiring.
///
/// The namespace is here because a new quiver or featurizer changes what a
/// preset measures as without changing any other input, and the file should
/// say it is stale by name rather than wait for the re-measured sample to
/// happen to cover a module that moved.
pub fn measurement_fingerprint(phrase: &PhraseSpec) -> String {
    let consts = [
        perform::JACOBIAN_STEP,
        perform::COLLINEAR,
        perform::RIDGE,
        perform::SEMANTIC_RIDGE,
        perform::MAX_KNOBS as f64,
        perform::MAX_TRAVEL,
        perform::PURITY_FLOOR,
        perform::MONO_TOL,
        perform::REACH_FLOOR,
    ];
    let text = format!(
        "{}\n{}\n{:?}\n{:?}\n{:?}",
        serde_json::to_string(phrase).unwrap_or_default(),
        cache_namespace(phrase),
        AudioFeatures::NAMES,
        perform::CONTROLS,
        consts,
    );
    fnv(text.as_bytes())
}

/// The audio block of `e`'s standardizer, `(mean, std)`: the part a wiring is
/// measured in. `None` before the pool is filled.
pub fn audio_standardizer(e: &WasmEngine) -> Option<(Vec<f64>, Vec<f64>)> {
    let s = e.engine.standardizer()?;
    let n = AudioFeatures::NAMES.len();
    Some((s.mean[..n].to_vec(), s.std[..n].to_vec()))
}

/// The standardized audio φ of the tree whose JSON is `tree_json`, as a
/// wiring's `z` records it; `None` if it does not parse or vet.
pub fn preset_z(e: &WasmEngine, tree_json: &str) -> Option<Vec<f64>> {
    let tree: PatchTree = serde_json::from_str(tree_json).ok()?;
    let std = e.engine.standardizer()?;
    let (cf, _) = featurize_memo(&tree, &e.engine.cfg.phrase, e.engine.memo(), false).ok()?;
    Some(perform::standardized_audio(&cf.features, std))
}

/// The session engine inside `e`, for the measurement examples that ask what
/// the bindings do not say (a Jacobian, the memo's render count), under the
/// engine the shipped wirings are measured on. Native only.
#[cfg(not(target_arch = "wasm32"))]
pub fn session(e: &WasmEngine) -> &auracle_session::Engine {
    &e.engine
}

/// Run `job` over `items` on up to `threads` threads, results in item order.
#[cfg(not(target_arch = "wasm32"))]
fn par_map<T: Sync, U: Send>(items: &[T], threads: usize, job: impl Fn(&T) -> U + Sync) -> Vec<U> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;
    let threads = threads.clamp(1, items.len().max(1));
    if threads == 1 {
        return items.iter().map(job).collect();
    }
    let next = AtomicUsize::new(0);
    let out: Vec<Mutex<Option<U>>> = items.iter().map(|_| Mutex::new(None)).collect();
    std::thread::scope(|s| {
        for _ in 0..threads {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                let Some(item) = items.get(i) else { break };
                let u = job(item);
                *out[i].lock().unwrap_or_else(|p| p.into_inner()) = Some(u);
            });
        }
    });
    out.into_iter()
        .map(|m| {
            m.into_inner()
                .unwrap_or_else(|p| p.into_inner())
                .expect("every item ran")
        })
        .collect()
}

/// Boot the engine the shipped wirings are measured under, as the page boots
/// one: a [`POOL`]-patch pool filled from [`SEED`], then re-standardized as the
/// worker does after its fill.
///
/// The fill is the render farm's fold (`fill_draw`, render, `absorb_prior` in
/// index order) with the renders spread over `threads` threads. The pool it
/// builds is the serial fill's at any width (`auracle_session::farm`), so the
/// width changes the time, never the numbers. Native only.
#[cfg(not(target_arch = "wasm32"))]
pub fn boot(threads: usize) -> WasmEngine {
    use auracle_session::PreFeaturized;
    let mut e = WasmEngine::new(SEED, POOL);
    e.engine.ensure_fill_seed(&mut e.rng.fill);
    let spec = e.engine.cfg.phrase.clone();
    loop {
        // Everything issued is absorbed before the next ask, so an empty
        // answer means the pool is full or the draw budget is spent.
        let draws = e.engine.fill_draw(usize::MAX);
        if draws.is_empty() {
            break;
        }
        let done = par_map(&draws, threads, |d| {
            if d.dup {
                None
            } else {
                PreFeaturized::render(d.tree.clone(), &spec, false).ok()
            }
        });
        for (d, pre) in draws.iter().zip(done) {
            e.engine.absorb_prior(d.index, pre);
        }
    }
    e.restandardize_if_untaught();
    e
}

/// Render `trees` into `e`'s memo on `threads` threads, so the serial calls
/// that follow (`load_preset`, [`preset_z`]) find them there. Native only.
#[cfg(not(target_arch = "wasm32"))]
pub fn warm(e: &WasmEngine, trees: &[PatchTree], threads: usize) {
    let (spec, memo) = (&e.engine.cfg.phrase, e.engine.memo());
    par_map(trees, threads, |t| {
        let _ = featurize_memo(t, spec, memo, false);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_source_ignores_uids_and_sees_everything_else() {
        let bank = auracle_grammar::preset_bank();
        let p = &bank[0];
        let mut again = p.tree.clone();
        again.ensure_uids();
        assert_eq!(
            preset_source(p.name, &p.tree),
            preset_source(p.name, &again)
        );
        assert_ne!(
            preset_source(p.name, &p.tree),
            preset_source("renamed", &p.tree)
        );
        assert_ne!(
            preset_source(p.name, &p.tree),
            preset_source(p.name, &bank[1].tree)
        );
    }
}
