//! What PERFORM's shipped wirings were measured from.
//!
//! The app ships a measurement of every preset (`apps/web/perform-wirings.json`,
//! written by the `preset_wirings` example, `make perform-wirings`), so a
//! preset's named controls work the moment it lands instead of after the
//! eleven-odd seconds of renders a first measurement costs in the browser. A
//! shipped wiring is a starting point, not the last word: it was taken under
//! the standardizer of the pool [`SEED`] deals, not this session's (a session's
//! seed is its own), and the app re-measures it in the background as it does
//! any stale wiring. [`SEED`] deals that pool natively and in the browser's
//! wasm alike (`tests/boot_agrees.rs`): the shipped measurement is the one a
//! wasm engine booted from it would take.
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
use wasm_bindgen::prelude::wasm_bindgen;

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
///
/// Each result is set once, into a slot of its own: there is no lock, so
/// nothing to poison. A job that panics panics the scope, and so the caller.
#[cfg(not(target_arch = "wasm32"))]
fn par_map<T: Sync, U: Send + Sync>(
    items: &[T],
    threads: usize,
    job: impl Fn(&T) -> U + Sync,
) -> Vec<U> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::OnceLock;
    let threads = threads.clamp(1, items.len().max(1));
    if threads == 1 {
        return items.iter().map(job).collect();
    }
    let next = AtomicUsize::new(0);
    let out: Vec<OnceLock<U>> = items.iter().map(|_| OnceLock::new()).collect();
    std::thread::scope(|s| {
        for _ in 0..threads {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                let Some(item) = items.get(i) else { break };
                let _ = out[i].set(job(item));
            });
        }
    });
    out.into_iter()
        .map(|slot| slot.into_inner().expect("every item ran"))
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
        // A draw marked `dup` is rendered too: the mark is a courtesy that
        // spares the farm a render, and `absorb_prior` refuses a duplicate
        // itself, so the pool is the same (and the shipped seed's fill
        // deals none).
        let done = par_map(&draws, threads, |d| {
            PreFeaturized::render(d.tree.clone(), &spec, false).ok()
        });
        for (d, pre) in draws.iter().zip(done) {
            e.engine.absorb_prior(d.index, pre);
        }
    }
    e.restandardize_if_untaught();
    e
}

/// Draws of the fill stream [`boot_probe`] digests.
const PROBE_DRAWS: u32 = 400;
/// Of those, how many it lists one by one, so a disagreement names the first
/// draw that parts and not only that something did.
const PROBE_LISTED: usize = 12;
/// The pool the probe fills: a handful of renders, not [`POOL`].
const PROBE_POOL: usize = 8;
/// Duels the probe deals from that pool.
const PROBE_DUELS: usize = 6;

/// A tree's digest, uids aside (they are minted per process).
fn tree_digest(tree_json: &str) -> String {
    let mut v: serde_json::Value = serde_json::from_str(tree_json).unwrap_or_default();
    strip_uids(&mut v);
    fnv(v.to_string().as_bytes())
}

/// What a seed deals, in a form two targets can compare: the digest of every
/// tree of the fill stream's first [`PROBE_DRAWS`] draws (a pure function of
/// the seed, no render), a small pool filled from [`SEED`] (which draws it
/// consumed, which trees it kept, the audio standardizer's spreads) and the
/// first duels dealt from that pool.
///
/// The page's engine runs as wasm and the diagnostics and wirings run
/// natively, and a seed has to mean the same pool on both. This is the one
/// function both targets run: `tests/boot_agrees.rs` pins its native output
/// to `tests/boot_probe.json`, and `tests/web/boot_agrees.spec.js` runs it in
/// the built wasm and compares what it returns with the same file, in
/// JavaScript ([`boot_probe_difference`] is the native half of that
/// comparison and stays out of the page's wasm). A disagreement in the draws is the stream itself reading
/// differently (a draw whose width depends on the target: see
/// [`auracle_grammar::rng`]); in the pool only, the renders or the features.
#[wasm_bindgen]
pub fn boot_probe() -> String {
    let mut e = WasmEngine::new(SEED, PROBE_POOL);
    let _ = e.fill_draw(0); // starts the stream, takes nothing from it
    let draws: Vec<String> = (0..PROBE_DRAWS)
        .map(|i| tree_digest(&e.draw_json(i)))
        .collect();
    while e.fill_step(2) > 0 {}
    e.restandardize_if_untaught();
    let mut ids: Vec<u64> = serde_json::from_str::<Vec<serde_json::Value>>(&e.ranked())
        .unwrap_or_default()
        .iter()
        .filter_map(|r| r["id"].as_u64())
        .collect();
    ids.sort_unstable();
    let kept: Vec<String> = ids
        .iter()
        .map(|&id| tree_digest(&e.tree_json_of(id as u32)))
        .collect();
    // The duel stream's first deals: another consumer of randomness, with
    // index draws of its own (ADR-001: each consumer has a stream).
    let duels: Vec<serde_json::Value> = (0..PROBE_DUELS)
        .map(|_| serde_json::from_str(&e.next_duel()).unwrap_or_default())
        .collect();
    serde_json::json!({
        "seed": SEED,
        "draws": &draws[..PROBE_LISTED],
        "draws_digest": fnv(draws.concat().as_bytes()),
        "duels": duels,
        "pool": {
            "size": PROBE_POOL,
            "draws_consumed": e.fill_cursor(),
            "kept": kept,
            "spread": serde_json::from_str::<serde_json::Value>(&e.phi_scale()).unwrap_or_default(),
        },
    })
    .to_string()
}

/// Where `now` first differs from `was`, as a path and both values: numbers
/// within [`TOLERANCE`] of their size, everything else exactly. Native only:
/// the spec makes the same comparison in JavaScript.
#[cfg(not(target_arch = "wasm32"))]
fn first_difference(
    was: &serde_json::Value,
    now: &serde_json::Value,
    path: &str,
) -> Option<String> {
    use serde_json::Value;
    let differs = || Some(format!("{path}: pinned {was}, now {now}"));
    match (was, now) {
        (Value::Number(a), Value::Number(b)) => {
            let (a, b) = (a.as_f64()?, b.as_f64()?);
            let scale = a.abs().max(b.abs()).max(1.0);
            ((a - b).abs() > TOLERANCE * scale).then(differs).flatten()
        }
        (Value::Array(a), Value::Array(b)) => {
            if a.len() != b.len() {
                return Some(format!(
                    "{path}: {} entries pinned, {} now",
                    a.len(),
                    b.len()
                ));
            }
            a.iter()
                .zip(b)
                .enumerate()
                .find_map(|(i, (x, y))| first_difference(x, y, &format!("{path}[{i}]")))
        }
        (Value::Object(a), Value::Object(b)) => {
            if a.keys().ne(b.keys()) {
                let only = |from: &serde_json::Map<String, Value>,
                            not: &serde_json::Map<String, Value>| {
                    from.keys()
                        .filter(|k| !not.contains_key(*k))
                        .cloned()
                        .collect::<Vec<_>>()
                };
                return Some(format!(
                    "{path}: keys only in the pinned probe {:?}, only now {:?}",
                    only(a, b),
                    only(b, a)
                ));
            }
            a.iter()
                .find_map(|(k, x)| first_difference(x, &b[k], &format!("{path}.{k}")))
        }
        _ => (was != now).then(differs).flatten(),
    }
}

/// Where [`boot_probe`], run here and now, first differs from `pinned` (the
/// JSON `tests/boot_probe.json` holds); `""` if it agrees. Numbers agree
/// within [`TOLERANCE`], everything else exactly. Native only.
#[cfg(not(target_arch = "wasm32"))]
pub fn boot_probe_difference(pinned: &str) -> String {
    let Ok(was) = serde_json::from_str::<serde_json::Value>(pinned) else {
        return "the pinned probe is not JSON".into();
    };
    // The text the page's wasm hands the spec, read back as the spec reads it.
    let now: serde_json::Value = serde_json::from_str(&boot_probe()).unwrap_or_default();
    first_difference(&was, &now, "probe").unwrap_or_default()
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
mod tests;
