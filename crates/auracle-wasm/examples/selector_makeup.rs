//! What level a selector change (a VCO's wave, a filter's mode) would play at
//! if the voices took its tree before the engine had measured it, and what a
//! cheaper measurement would cost.
//!
//! The live voices play a tree at a makeup gain: the loudness makeup that
//! brings the standard phrase to `TARGET_LUFS` (`level::live_makeup`). A
//! selector has no live handle, so the voices hear it only as a new tree. Sent
//! ahead of its render, that tree could carry only the previous tree's makeup
//! (`stale` below), or an estimate from a cheaper render. This walks every
//! preset's every change of a selector the voices hear only as a tree (every
//! enum site but `table` and `oct`, every option other than the preset's
//! own) and compares each early makeup with the one the full render measures.
//! An estimate is the previous tree's measured makeup moved by the change in
//! loudness a cheaper render of both trees shows.
//!
//!   cargo run -p auracle-wasm --release --example selector_makeup
//!
//! Errors are the early makeup minus the measured one, in dB: positive is hot
//! (louder than the measured level). The bar for playing a selector early was
//! within ±3 dB in 95% of changes and never more than 3 dB hot. Times are per
//! tree, native; wasm is about 1.2 to 1.3 times slower (Plan-005, task 9a).
//! The render is almost all of a measurement, so an estimate that meets the
//! bar costs about as much as the measurement it would stand in for: selectors
//! wait for their render (`worker.js`, `edit_param`).
use std::time::Instant;

use auracle_features::phrase::Note;
use auracle_features::{featurize, integrated_lufs, render_phrase, PhraseSpec, TARGET_LUFS};
use auracle_grammar::describe::KnobKind;
use auracle_grammar::{describe, presets, set_param, ParamValue, PatchTree};

/// `LivePoly::set_makeup`'s range (`live.rs`).
const MIN_DB: f64 = -24.0;
const MAX_DB: f64 = 60.0;

fn makeup_db(lufs: f64) -> f64 {
    (TARGET_LUFS - lufs).clamp(MIN_DB, MAX_DB)
}

fn lufs_of(tree: &PatchTree, spec: &PhraseSpec) -> Option<f64> {
    let r = render_phrase(tree, spec).ok()?;
    integrated_lufs(&r.samples, r.sample_rate)
}

/// A phrase of `(voct, on_s)` notes at the full spec's rate and random seed.
fn notes(full: &PhraseSpec, ns: &[(f64, f64)]) -> PhraseSpec {
    PhraseSpec {
        notes: ns
            .iter()
            .map(|&(voct, on_s)| Note {
                voct,
                on_s,
                off_s: 0.0,
                chord: Vec::new(),
            })
            .collect(),
        ..full.clone()
    }
}

fn main() {
    let full = PhraseSpec::default();
    let specs: Vec<(&str, PhraseSpec)> = vec![
        ("C4 0.45 s", notes(&full, &[(0.0, 0.45)])),
        ("C4+C3 0.9 s", notes(&full, &[(0.0, 0.45), (-1.0, 0.45)])),
        (
            "phrase 11 kHz",
            PhraseSpec {
                sample_rate: 11_025.0,
                ..full.clone()
            },
        ),
        (
            "phrase 22 kHz",
            PhraseSpec {
                sample_rate: 22_050.0,
                ..full.clone()
            },
        ),
        ("phrase", full.clone()),
    ];
    // Per change: stale error, then each spec's estimate error.
    let mut rows: Vec<(String, f64, Vec<f64>)> = Vec::new();
    let mut refused = 0usize;
    let mut t_measure = 0.0f64;
    let mut t_spec = vec![0.0f64; specs.len()];
    for (name, tree) in presets() {
        let Ok(base) = featurize(&tree, &full) else {
            continue;
        };
        let m0 = makeup_db(base.features.lufs_before);
        let before: Vec<Option<f64>> = specs.iter().map(|(_, s)| lufs_of(&tree, s)).collect();
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
                    let Ok(edited) = set_param(&tree, &knob.addr, ParamValue::Index(v)) else {
                        continue;
                    };
                    let t = Instant::now();
                    let Ok(after) = featurize(&edited, &full) else {
                        refused += 1;
                        continue;
                    };
                    t_measure += t.elapsed().as_secs_f64();
                    let m1 = makeup_db(after.features.lufs_before);
                    let est = specs
                        .iter()
                        .enumerate()
                        .map(|(i, (_, s))| {
                            let t = Instant::now();
                            let l1 = lufs_of(&edited, s);
                            t_spec[i] += t.elapsed().as_secs_f64();
                            let e = match (before[i], l1) {
                                (Some(a), Some(b)) => (m0 + (a - b)).clamp(MIN_DB, MAX_DB),
                                _ => m0,
                            };
                            e - m1
                        })
                        .collect();
                    let label = format!("{name} {site} {} → {}", options[cur], options[v]);
                    rows.push((label, m0 - m1, est));
                }
            }
        }
    }
    let n = rows.len();
    println!(
        "{n} selector changes over {} presets ({refused} more fail the vet and are muted)",
        presets().len()
    );
    println!(
        "the full measurement (render and features): {:.1} ms a tree",
        1e3 * t_measure / n.max(1) as f64
    );
    println!(
        "| early makeup | within ±3 dB | over 3 dB hot | over 6 dB hot | over 6 dB cold | worst hot | worst cold | ms a tree |"
    );
    println!("| --- | --- | --- | --- | --- | --- | --- | --- |");
    let line = |label: &str, errs: Vec<f64>, ms: f64| {
        let k = errs.len() as f64;
        let within = errs.iter().filter(|e| e.abs() <= 3.0).count() as f64;
        let hot3 = errs.iter().filter(|&&e| e > 3.0).count();
        let hot6 = errs.iter().filter(|&&e| e > 6.0).count();
        let cold6 = errs.iter().filter(|&&e| e < -6.0).count();
        let hot = errs.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let cold = errs.iter().cloned().fold(f64::INFINITY, f64::min);
        println!(
            "| {label} | {:.1}% | {hot3} | {hot6} | {cold6} | {hot:+.1} dB | {cold:+.1} dB | {ms:.1} |",
            100.0 * within / k
        );
    };
    line(
        "the previous tree's (stale)",
        rows.iter().map(|r| r.1).collect(),
        0.0,
    );
    for (i, (label, _)) in specs.iter().enumerate() {
        let ms = 1e3 * t_spec[i] / n.max(1) as f64;
        line(label, rows.iter().map(|r| r.2[i]).collect(), ms);
    }
    // The cheapest estimate that reaches 95%, lowered until it is never more
    // than 3 dB hot.
    let i22 = 3;
    let worst = rows
        .iter()
        .map(|r| r.2[i22])
        .fold(f64::NEG_INFINITY, f64::max);
    let lower = (worst - 3.0).max(0.0);
    let ms22 = 1e3 * t_spec[i22] / n.max(1) as f64;
    line(
        &format!("phrase 22 kHz, {lower:.1} dB lower"),
        rows.iter().map(|r| r.2[i22] - lower).collect(),
        ms22,
    );
    // `PRESET=name` lists that preset's changes.
    if let Ok(p) = std::env::var("PRESET") {
        for r in rows.iter().filter(|r| r.0.starts_with(&format!("{p} "))) {
            println!("  {} stale {:+.1} dB", r.0, r.1);
        }
    }
    let mut by_stale: Vec<&(String, f64, Vec<f64>)> = rows.iter().collect();
    by_stale.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    println!("hottest with the stale makeup:");
    for r in by_stale.iter().take(5) {
        println!("  {} {:+.1} dB", r.0, r.1);
    }
}
