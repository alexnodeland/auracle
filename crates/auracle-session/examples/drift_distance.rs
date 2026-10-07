//! How far does one PERFORM drift move the knobs, and how far would
//! refinement's kernel move the same knobs in as few steps?
//!
//! ```bash
//! cargo run -p auracle-session --example drift_distance --release
//! ```
//!
//! From each of the first 12 presets, as it is, before any taste (so every
//! walk targets the vetted grammar prior):
//!
//! - **drift** (`Engine::drift`) at the Wander dial's three marks: drift at
//!   its start (8 steps, σ 0.05), drift at its top (18, 0.08) and roam at its
//!   top (40, 0.15);
//! - **refinement's kernel**: an offer (`Engine::offer`, fugue's adaptive
//!   single-site MH, the walk a generation and PERFORM's offers take) of 8
//!   steps with every site locked but the live knobs, so it may move only
//!   what a drift moves. A locked walk stretches its steps by the share of
//!   sites locked, up to `LOCK_SCALE_CAP` times, so it makes about 8
//!   proposals on a knob (fewer where the live knobs are under a quarter of
//!   the sites). Each fresh chain starts a knob's step at the kernel's initial
//!   scale, 1.0: a Gaussian of the whole range, folded back into it.
//!
//! Each walk prints how many live knobs it moved and how far it moved the
//! farthest, on the knob's 0–1 range. Then each row's range of that farthest
//! move over the presets: the figures `www/reference/src/search/perform.md`
//! quotes. The drifts and the kernel's walks draw from streams of their own,
//! so adding a row moves no other row's figures.
use std::collections::{HashMap, HashSet};

use auracle_grammar::{preset_bank, PatchGrammarPrior, PatchTree};
use auracle_session::perform::{continuous_knobs, live_knobs};
use auracle_session::{Engine, RefineOutcome, SessionConfig};
use rand::SeedableRng;

/// The presets measured: the first of the bank.
const PRESETS: usize = 12;
/// Drift's rows: the Wander dial's marks, as `(steps, σ)`.
const DRIFTS: [(usize, f64); 3] = [(8, 0.05), (18, 0.08), (40, 0.15)];
/// The kernel's row: an offer as long as the gentlest drift.
const KERNEL_STEPS: usize = 8;

/// How far a walk from `from` that ended at `to` moved each of `from`'s live
/// knobs, sorted.
fn moves(from: &PatchTree, to: &PatchTree, sr: f64) -> Vec<f64> {
    let base: HashMap<String, f64> = live_knobs(from, sr).into_iter().collect();
    let mut d: Vec<f64> = live_knobs(to, sr)
        .iter()
        .map(|(a, v)| (v - base.get(a).copied().unwrap_or(*v)).abs())
        .collect();
    d.sort_by(f64::total_cmp);
    d
}

/// One walk's line, and its farthest knob's move (0 for a walk that stayed).
fn report(
    name: &str,
    row: &str,
    from: &PatchTree,
    walked: Result<PatchTree, RefineOutcome>,
    sr: f64,
) -> f64 {
    match walked {
        Ok(t) => {
            let d = moves(from, &t, sr);
            let moved = d.iter().filter(|x| **x > 1e-9).count();
            let farthest = d.last().copied().unwrap_or(0.0);
            println!(
                "{name:<16} {row}: moved {moved:>2}/{:<2} max {farthest:.2}",
                d.len()
            );
            farthest
        }
        Err(e) => {
            println!("{name:<16} {row}: {}", e.as_str());
            0.0
        }
    }
}

fn main() {
    let engine = Engine::new(PatchGrammarPrior::default(), SessionConfig::default());
    let sr = engine.cfg.phrase.sample_rate;
    let mut drift_rng = rand::rngs::StdRng::seed_from_u64(3);
    let mut kernel_rng = rand::rngs::StdRng::seed_from_u64(3);
    let rows: Vec<String> = DRIFTS
        .iter()
        .map(|(steps, sigma)| format!("drift  steps {steps:>2} σ {sigma:.2}"))
        .chain([format!("kernel steps {KERNEL_STEPS:>2}       ")])
        .collect();
    let mut farthest: Vec<Vec<f64>> = vec![Vec::new(); rows.len()];
    for p in preset_bank().iter().take(PRESETS) {
        for (i, &(steps, sigma)) in DRIFTS.iter().enumerate() {
            let walked = engine.drift(&mut drift_rng, &p.tree, &[], steps, sigma);
            farthest[i].push(report(p.name, &rows[i], &p.tree, walked, sr));
        }
        // Every site but the live knobs, held: the structure, the categorical
        // choices and the continuous sites the voices cannot take live.
        let live: HashSet<String> = live_knobs(&p.tree, sr)
            .into_iter()
            .map(|(a, _)| a)
            .collect();
        let held: Vec<String> = auracle_session::perform::structural_addrs(&p.tree)
            .into_iter()
            .chain(continuous_knobs(&p.tree).into_iter().map(|(a, _)| a))
            .filter(|a| !live.contains(a))
            .collect();
        let walked = engine.offer(&mut kernel_rng, &p.tree, &held, KERNEL_STEPS);
        let k = rows.len() - 1;
        farthest[k].push(report(p.name, &rows[k], &p.tree, walked, sr));
    }
    println!("\nfarthest knob moved, over {PRESETS} presets (a walk that stayed counts 0):");
    for (row, f) in rows.iter().zip(&farthest) {
        let lo = f.iter().copied().fold(f64::INFINITY, f64::min);
        let hi = f.iter().copied().fold(0.0, f64::max);
        println!("  {row}: {lo:.2}–{hi:.2}");
    }
}
