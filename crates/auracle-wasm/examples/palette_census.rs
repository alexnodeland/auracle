//! The palette's eighteen directions (Plan-005 task 9c, RFC-006 Open 4): how
//! each is defined in φ, how far apart they are, how often each reaches the
//! presets, and what measuring eighteen costs against six.
//!
//! ```bash
//! cargo run -p auracle-wasm --example palette_census --release -- [threads]
//! make wasm && node crates/auracle-wasm/examples/palette_cost.mjs   # the wasm times
//! ```
//!
//! "The measurement PERFORM uses" means the engine the shipped wirings are
//! measured under (`shipped::boot`: the page's 40-patch pool and its
//! standardizer), each preset loaded with `load_preset` and read back with
//! `tree_json_of`, and wired by `Engine::wire_named`, which is what
//! `perform_wire` calls: the Jacobian, the ridge solve onto at most four
//! knobs, the purity and reach gate, separation, and verification on real
//! renders at ±½ and ±1. Each thread boots its own engine from the same seed,
//! so the thread count changes the time, never the numbers.
//!
//! Each preset is wired four ways, all from one Jacobian:
//!
//! * **the six**, as the panel is today (and the cost baseline);
//! * **all eighteen** in palette order, separated in that order;
//! * **each control alone**: does this patch have knobs that move it, purely
//!   and verifiably? The headline;
//! * **each of the twelve beside the six**: does it still reach once the six
//!   have claimed their gestures (`separate`, |cos| > `COLLINEAR` between
//!   predicted movements)? Whether it adds a gesture the six do not have.
//!
//! It prints the directions, their cosines (geometric, and as the presets and
//! the pool move along them), the reach table, how often two controls wire
//! to the same gesture, the renders and time per patch, and what the shipped
//! file would weigh with the twelve in it. With `--prototype` it also wires
//! the prototype's blends (`docs/notes/vision-2026-09/prototype/perform.js`)
//! by prediction alone, for comparison.

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Instant;

use auracle_features::{featurize_memo, AudioFeatures};
use auracle_grammar::{preset_bank, PatchTree};
use auracle_session::perform::{
    direction, standardized_audio, wire_named, Jacobian, NamedControl, Wiring, COLLINEAR, CONTROLS,
    PALETTE, SEMANTIC_RIDGE,
};
use auracle_wasm::shipped;

/// One preset's measurement.
struct Row {
    name: &'static str,
    knobs: usize,
    jac: Jacobian,
    /// Renders and seconds: the six from cold, then what all eighteen add.
    six: (u64, f64),
    more: (u64, f64),
    /// Renders each control alone added beyond those (a control the
    /// eighteen's separation made search is verified alone).
    alone_renders: u64,
    in_order: Vec<Wiring>,
    alone: Vec<Wiring>,
    beside: Vec<Wiring>,
    /// The JSON the twelve would add to this preset's row in the shipped file.
    extra_bytes: usize,
}

fn names() -> Vec<String> {
    AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect()
}

fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

fn median(mut v: Vec<f64>) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    v.sort_by(f64::total_cmp);
    v[v.len() / 2]
}

fn pearson(a: &[f64], b: &[f64]) -> f64 {
    let n = a.len() as f64;
    let (ma, mb) = (a.iter().sum::<f64>() / n, b.iter().sum::<f64>() / n);
    let cov: f64 = a.iter().zip(b).map(|(x, y)| (x - ma) * (y - mb)).sum();
    let va: f64 = a.iter().map(|x| (x - ma).powi(2)).sum();
    let vb: f64 = b.iter().map(|y| (y - mb).powi(2)).sum();
    cov / (va * vb).sqrt().max(1e-12)
}

/// The prototype's blends of the six, as `NamedControl`s with their axes
/// written out over φ: `Σ w_b ê_b` over the base controls' unit directions.
fn prototype() -> Vec<NamedControl> {
    let base = |n: &str| CONTROLS.iter().find(|c| c.name == n).copied().unwrap();
    let blends: [(&'static str, &[(&str, f64)]); 11] = [
        ("Warmth*", &[("Bright", -0.6), ("Body", 0.5)]),
        ("Air*", &[("Bright", 0.7), ("Body", -0.25)]),
        ("Thump*", &[("Body", 0.7), ("Snap", 0.5)]),
        ("Punch*", &[("Snap", 0.8), ("Body", 0.35), ("Grit", 0.2)]),
        ("Softness*", &[("Snap", -0.8), ("Bright", -0.3)]),
        ("Wobble*", &[("Motion", 0.9), ("Space", 0.15)]),
        ("Drift*", &[("Motion", 0.45), ("Space", 0.45)]),
        ("Distance*", &[("Space", 0.85), ("Bright", -0.35)]),
        ("Haze*", &[("Space", 0.6), ("Motion", 0.3), ("Snap", -0.3)]),
        ("Bite*", &[("Grit", 0.6), ("Snap", 0.4), ("Bright", 0.25)]),
        ("Lo-fi*", &[("Grit", 0.75), ("Bright", -0.45)]),
    ];
    blends
        .iter()
        .map(|(name, w)| {
            let mut axis: Vec<(&'static str, f64)> = Vec::new();
            let mut sites: Vec<&'static str> = Vec::new();
            for (b, wb) in w.iter() {
                let c = base(b);
                let norm = c.axis.iter().map(|(_, x)| x * x).sum::<f64>().sqrt();
                for (f, x) in c.axis {
                    axis.push((f, wb * x / norm));
                }
                sites.extend(c.sites.iter().copied());
            }
            NamedControl {
                name,
                family: "prototype",
                low: "",
                high: "",
                axis: Box::leak(axis.into_boxed_slice()),
                sites: Box::leak(sites.into_boxed_slice()),
            }
        })
        .collect()
}

fn cosine_table(title: &str, set: &[NamedControl], flag: f64) {
    let n = names();
    let dirs: Vec<Vec<f64>> = set.iter().map(|c| direction(c, &n)).collect();
    println!("\n### {title}\n");
    let mut flagged = Vec::new();
    print!("| |");
    set.iter().for_each(|c| print!(" {} |", c.name));
    println!();
    print!("|---|");
    set.iter().for_each(|_| print!("---|"));
    println!();
    for (i, a) in set.iter().enumerate() {
        print!("| {} |", a.name);
        for (j, _) in set.iter().enumerate() {
            let c = dot(&dirs[i], &dirs[j]);
            if j > i && c.abs() >= flag {
                flagged.push(format!("{} · {} {:+.2}", a.name, set[j].name, c));
            }
            if i == j {
                print!(" |");
            } else if c.abs() < 0.005 {
                print!(" · |");
            } else {
                print!(" {c:+.2} |");
            }
        }
        println!();
    }
    println!(
        "\nflagged (|cos| ≥ {flag}): {}",
        if flagged.is_empty() {
            "none".to_string()
        } else {
            flagged.join("; ")
        }
    );
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let threads: usize = args.iter().find_map(|s| s.parse().ok()).unwrap_or(2).max(1);
    let with_prototype = args.iter().any(|a| a == "--prototype");
    let bank = preset_bank();
    let n = bank.len();
    let t0 = Instant::now();
    let names = names();

    println!("# The palette census\n");
    println!(
        "{n} presets, measured on the shipped engine (seed {}, pool {}).",
        shipped::SEED,
        shipped::POOL
    );
    println!("\n## The eighteen directions\n");
    println!("| # | Control | Family | Low · high | Direction (unit, over φ) |");
    println!("|---|---|---|---|---|");
    for (k, c) in PALETTE.iter().enumerate() {
        let d = direction(c, &names);
        let w: Vec<String> = names
            .iter()
            .zip(&d)
            .filter(|(_, x)| x.abs() > 1e-12)
            .map(|(f, x)| format!("`{}` {x:+.2}", f.split(':').next().unwrap_or(f)))
            .collect();
        println!(
            "| {k} | {} | {} | {} · {} | {} |",
            c.name,
            c.family,
            c.low,
            c.high,
            w.join(", ")
        );
    }
    cosine_table("Cosines between the eighteen directions", &PALETTE, 0.9);
    let proto = prototype();
    let mut with_base: Vec<NamedControl> = CONTROLS.to_vec();
    with_base.extend(proto.iter().copied());
    cosine_table(
        "Cosines of the prototype's blends, as given (for comparison)",
        &with_base,
        0.9,
    );

    // ---- every preset, on its own thread's engine ----
    let rows: Mutex<Vec<Option<Row>>> = Mutex::new((0..n).map(|_| None).collect());
    let pop: Mutex<Vec<Vec<f64>>> = Mutex::new(Vec::new());
    std::thread::scope(|s| {
        for t in 0..threads {
            let (bank, rows, pop) = (&bank, &rows, &pop);
            s.spawn(move || {
                let mut e = shipped::boot(1);
                if t == 0 {
                    let eng = shipped::session(&e);
                    let std = eng.standardizer().expect("standardized").clone();
                    let mut p = pop.lock().unwrap();
                    for c in &eng.pool {
                        if let Ok((cf, _)) =
                            featurize_memo(&c.tree, &eng.cfg.phrase, eng.memo(), false)
                        {
                            p.push(standardized_audio(&cf.features, &std));
                        }
                    }
                }
                for i in (t..n).step_by(threads) {
                    let p = &bank[i];
                    let id = e.load_preset(i);
                    assert!(id > 0, "{} did not load", p.name);
                    let tree: PatchTree =
                        serde_json::from_str(&e.tree_json_of(id)).expect("tree JSON");
                    let eng = shipped::session(&e);
                    let none = HashSet::new();
                    let misses = || eng.memo().stats().misses;
                    let (m0, c0) = (misses(), Instant::now());
                    let (jac, _six) = eng.wire_named(&tree, &CONTROLS, &none).expect("vets");
                    let six = (misses() - m0, c0.elapsed().as_secs_f64());
                    let (m1, c1) = (misses(), Instant::now());
                    let (_, in_order) = eng.wire_named(&tree, &PALETTE, &none).expect("vets");
                    let more = (misses() - m1, c1.elapsed().as_secs_f64());
                    let m2 = misses();
                    let alone: Vec<Wiring> = PALETTE
                        .iter()
                        .map(|c| eng.wire_named(&tree, &[*c], &none).expect("vets").1.remove(0))
                        .collect();
                    let beside: Vec<Wiring> = PALETTE
                        .iter()
                        .map(|c| {
                            let mut set = CONTROLS.to_vec();
                            if !CONTROLS.iter().any(|b| b.name == c.name) {
                                set.push(*c);
                            }
                            let w = eng.wire_named(&tree, &set, &none).expect("vets").1;
                            w.into_iter().find(|w| w.name == c.name).expect("wired")
                        })
                        .collect();
                    let alone_renders = misses() - m2;
                    let extra_bytes = serde_json::to_string(&in_order[CONTROLS.len()..])
                        .map_or(0, |s| s.len());
                    eprintln!(
                        "  {:>2}/{n} {:<20} {:>2} knobs · six {:>3} renders {:>5.1} s · eighteen +{:>3} {:>5.1} s · alone +{} · {:.0} s",
                        i + 1,
                        p.name,
                        jac.addrs.len(),
                        six.0,
                        six.1,
                        more.0,
                        more.1,
                        alone_renders,
                        t0.elapsed().as_secs_f64()
                    );
                    rows.lock().unwrap()[i] = Some(Row {
                        name: p.name,
                        knobs: jac.addrs.len(),
                        jac,
                        six,
                        more,
                        alone_renders,
                        in_order,
                        alone,
                        beside,
                        extra_bytes,
                    });
                }
            });
        }
    });
    let rows: Vec<Row> = rows
        .into_inner()
        .unwrap()
        .into_iter()
        .map(|r| r.expect("measured"))
        .collect();
    let mut pop = pop.into_inner().unwrap();
    let presets_z: Vec<Vec<f64>> = rows.iter().map(|r| r.jac.z.clone()).collect();

    // ---- how the presets and the pool move along the directions ----
    pop.extend(presets_z.iter().cloned());
    println!(
        "\n### Correlation of the eighteen positions over the presets and the pool ({} sounds)\n",
        pop.len()
    );
    println!("Two directions the sounds move along together rank sounds the same way, whatever their geometric angle.\n");
    let dirs: Vec<Vec<f64>> = PALETTE.iter().map(|c| direction(c, &names)).collect();
    let proj: Vec<Vec<f64>> = dirs
        .iter()
        .map(|d| pop.iter().map(|z| dot(d, z)).collect())
        .collect();
    let mut flagged = Vec::new();
    let mut close = Vec::new();
    for i in 0..PALETTE.len() {
        for j in (i + 1)..PALETTE.len() {
            let r = pearson(&proj[i], &proj[j]);
            let s = format!("{} · {} {r:+.2}", PALETTE[i].name, PALETTE[j].name);
            if r.abs() >= 0.9 {
                flagged.push(s);
            } else if r.abs() >= 0.7 {
                close.push(s);
            }
        }
    }
    println!(
        "|r| ≥ 0.9: {}",
        if flagged.is_empty() {
            "none".into()
        } else {
            flagged.join("; ")
        }
    );
    println!(
        "0.7 ≤ |r| < 0.9: {}",
        if close.is_empty() {
            "none".into()
        } else {
            close.join("; ")
        }
    );

    // ---- reach ----
    let m = rows.len() as f64;
    let frac = |f: &dyn Fn(&Row) -> bool| rows.iter().filter(|r| f(r)).count() as f64 / m;
    println!("\n## Reach over the {} presets\n", rows.len());
    println!("Alone: the control wired by itself. Beside the six: wired after them, so a control whose gesture on a patch is one of theirs (|cos| > {COLLINEAR}) is a search control there. Palette order: all eighteen at once. Predicted: alone, from the Jacobian only, before verification.\n");
    println!("| Control | Family | Predicted | Alone | Beside the six | Palette order | Both halves | Median purity | Median reach (σ) |");
    println!("|---|---|---|---|---|---|---|---|---|");
    for (k, c) in PALETTE.iter().enumerate() {
        let predicted = frac(&|r: &Row| !wire_named(&r.jac, &[*c], SEMANTIC_RIDGE)[0].search);
        let reached: Vec<&Wiring> = rows
            .iter()
            .map(|r| &r.alone[k])
            .filter(|w| !w.search)
            .collect();
        let both = reached.iter().filter(|w| w.range() == (-1.0, 1.0)).count() as f64 / m;
        println!(
            "| {} | {} | {:.0}% | {:.0}% | {:.0}% | {:.0}% | {:.0}% | {:.2} | {:.2} |",
            c.name,
            c.family,
            100.0 * predicted,
            100.0 * frac(&|r: &Row| !r.alone[k].search),
            100.0 * frac(&|r: &Row| !r.beside[k].search),
            100.0 * frac(&|r: &Row| !r.in_order[k].search),
            100.0 * both,
            median(reached.iter().map(|w| w.purity).collect()),
            median(reached.iter().map(|w| w.reach).collect()),
        );
    }
    let per: Vec<usize> = rows
        .iter()
        .map(|r| r.alone.iter().filter(|w| !w.search).count())
        .collect();
    let per6: Vec<usize> = rows
        .iter()
        .map(|r| {
            r.alone[..CONTROLS.len()]
                .iter()
                .filter(|w| !w.search)
                .count()
        })
        .collect();
    println!(
        "\nControls reaching a preset, alone: median {} of 18 (min {}, max {}); of the six, median {}.",
        median(per.iter().map(|&x| x as f64).collect()),
        per.iter().min().unwrap(),
        per.iter().max().unwrap(),
        median(per6.iter().map(|&x| x as f64).collect()),
    );

    // ---- the same gesture with two names ----
    println!("\n### Pairs wired to one gesture\n");
    println!("Over the presets where both reach alone, how often their predicted movements are within |cos| > {COLLINEAR} (`separate` would make the later one a search control). Pairs at 50% or more:\n");
    println!("| Pair | Both reach | One gesture |");
    println!("|---|---|---|");
    for (i, a) in PALETTE.iter().enumerate() {
        for (j, b) in PALETTE.iter().enumerate().skip(i + 1) {
            let both: Vec<f64> = rows
                .iter()
                .filter(|r| !r.alone[i].search && !r.alone[j].search)
                .map(|r| dot(&r.alone[i].moved, &r.alone[j].moved).abs())
                .collect();
            if both.len() < 4 {
                continue;
            }
            let same = both.iter().filter(|&&c| c > COLLINEAR).count() as f64 / both.len() as f64;
            if same >= 0.5 {
                println!(
                    "| {} · {} | {} | {:.0}% |",
                    a.name,
                    b.name,
                    both.len(),
                    100.0 * same
                );
            }
        }
    }

    // ---- cost ----
    let r6: Vec<f64> = rows.iter().map(|r| r.six.0 as f64).collect();
    let r18: Vec<f64> = rows.iter().map(|r| (r.six.0 + r.more.0) as f64).collect();
    let jac_r: Vec<f64> = rows.iter().map(|r| (r.knobs + 1) as f64).collect();
    let t6: Vec<f64> = rows.iter().map(|r| r.six.1).collect();
    let t18: Vec<f64> = rows.iter().map(|r| r.six.1 + r.more.1).collect();
    let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len() as f64;
    println!("\n## Cost per preset, native\n");
    println!("| Measured | Renders, median | mean | max | Seconds, median | mean |");
    println!("|---|---|---|---|---|---|");
    println!(
        "| The Jacobian alone (one per live knob, plus the patch) | {:.0} | {:.1} | {:.0} | | |",
        median(jac_r.clone()),
        mean(&jac_r),
        jac_r.iter().cloned().fold(0.0, f64::max)
    );
    println!(
        "| The six (today) | {:.0} | {:.1} | {:.0} | {:.2} | {:.2} |",
        median(r6.clone()),
        mean(&r6),
        r6.iter().cloned().fold(0.0, f64::max),
        median(t6.clone()),
        mean(&t6)
    );
    println!(
        "| All eighteen | {:.0} | {:.1} | {:.0} | {:.2} | {:.2} |",
        median(r18.clone()),
        mean(&r18),
        r18.iter().cloned().fold(0.0, f64::max),
        median(t18.clone()),
        mean(&t18)
    );
    let per_render: f64 = t6.iter().sum::<f64>() / r6.iter().sum::<f64>().max(1.0);
    println!(
        "\nOne render: {:.0} ms here. Each control alone added {:.1} renders per preset on top (those the eighteen's separation had made search are verified alone).",
        1e3 * per_render,
        rows.iter().map(|r| r.alone_renders as f64).sum::<f64>() / m
    );
    // Verification renders per control that reached after it: what one more
    // control on the panel costs.
    let reached = |w: &[Wiring]| w.iter().filter(|w| !w.search).count() as f64;
    let six_reach: f64 = rows
        .iter()
        .map(|r| reached(&r.in_order[..CONTROLS.len()]))
        .sum();
    let all_reach: f64 = rows.iter().map(|r| reached(&r.in_order)).sum();
    println!(
        "Verification renders per control that reaches: {:.1} for the six ({:.2} reach a preset), {:.1} for the eighteen in palette order ({:.2} reach).",
        (r6.iter().sum::<f64>() - jac_r.iter().sum::<f64>()) / six_reach.max(1.0),
        six_reach / m,
        (r18.iter().sum::<f64>() - jac_r.iter().sum::<f64>()) / all_reach.max(1.0),
        all_reach / m,
    );

    // ---- the shipped file ----
    let file = std::fs::metadata(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/web/perform-wirings.json"
    ))
    .map_or(0, |m| m.len() as usize);
    let extra: usize = rows.iter().map(|r| r.extra_bytes + 12).sum();
    println!(
        "\n## The shipped file\n\n`apps/web/perform-wirings.json` is {file} bytes with the six. The twelve's wirings, as a `palette` array beside `wiring` in each row, would add {extra} bytes: {} bytes in all, {:.1}× today.",
        file + extra,
        (file + extra) as f64 / file.max(1) as f64
    );

    if with_prototype {
        println!("\n## The prototype's blends, by prediction (no verification)\n");
        println!("| Blend | Reaches (predicted) | Median purity |");
        println!("|---|---|---|");
        for c in &proto {
            let w: Vec<Wiring> = rows
                .iter()
                .map(|r| wire_named(&r.jac, &[*c], SEMANTIC_RIDGE).remove(0))
                .collect();
            let reach = w.iter().filter(|w| !w.search).count() as f64 / m;
            println!(
                "| {} | {:.0}% | {:.2} |",
                c.name,
                100.0 * reach,
                median(w.iter().filter(|w| !w.search).map(|w| w.purity).collect())
            );
        }
    }

    println!("\n### Per preset (alone)\n");
    print!("| Preset | Knobs |");
    PALETTE.iter().for_each(|c| print!(" {} |", c.name));
    println!();
    print!("|---|---|");
    PALETTE.iter().for_each(|_| print!("---|"));
    println!();
    for r in &rows {
        print!("| {} | {} |", r.name, r.knobs);
        for w in &r.alone {
            print!(" {} |", if w.search { "·" } else { "●" });
        }
        println!();
    }
    eprintln!("census done in {:.0} s", t0.elapsed().as_secs_f64());
}
