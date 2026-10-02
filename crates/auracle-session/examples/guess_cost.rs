//! What the model's guess costs, and what it guesses (Plan-005 task 9d).
//!
//! The session `suggest_census` measured the designs in: the app's pool of 40
//! from `shipped::boot`'s seed, then a warm start that picks the three darkest
//! or the three brightest of the nine presets the app shows. For each of the
//! census's patches (the second preset of each family, two of them cleared to
//! an empty socket), from a memo that holds nothing but the patch, as the app
//! has after the patch was opened: the guess the worker makes with no farm
//! (`GUESS_FLOOR` renders, `memo_render` one at a time), then the rest of the
//! output's candidates, as a crew would render them. Each render is timed in
//! this thread's CPU time; the plan and the ranking (no renders) are timed
//! apart. Then the top three guesses and why, as raw lines.
//!
//! cargo run --release -p auracle-session --example guess_cost
//!
//! The wasm twin is `crates/auracle-wasm/examples/guess_cost.mjs`.
use std::collections::HashSet;

use auracle_features::{featurize_memo, RenderMemo};
use auracle_grammar::{preset_bank, AudioNode, PatchGrammarPrior, PatchTree, Uid};
use auracle_session::{Engine, Guess, SessionConfig, GUESS_FLOOR};
use rand::rngs::StdRng;
use rand::SeedableRng;

const POOL: usize = 40;
const SEED: u64 = 20_260_928;
const WARM: [&str; 9] = [
    "First Bass",
    "Folded Lead",
    "Pluck",
    "Cathedral",
    "Noise Wash",
    "Flint",
    "Two Minds",
    "Bell Jar",
    "Glass Pad",
];
const PATCHES: [&str; 7] = [
    "Sub & Sparkle",
    "Hornet",
    "Tine",
    "Detune Dream",
    "Dub Echo",
    "Deadfall",
    "Ceiling",
];

/// This thread's CPU time, in ms.
fn cpu_ms() -> f64 {
    #[repr(C)]
    struct Timespec {
        sec: i64,
        nsec: i64,
    }
    extern "C" {
        fn clock_gettime(clock: i32, tp: *mut Timespec) -> i32;
    }
    #[cfg(target_os = "macos")]
    const THREAD_CPUTIME: i32 = 16;
    #[cfg(not(target_os = "macos"))]
    const THREAD_CPUTIME: i32 = 3;
    let mut t = Timespec { sec: 0, nsec: 0 };
    // SAFETY: `clock_gettime` writes one `timespec` into memory we own.
    let ok = unsafe { clock_gettime(THREAD_CPUTIME, &mut t) } == 0;
    if ok {
        t.sec as f64 * 1e3 + t.nsec as f64 * 1e-6
    } else {
        f64::NAN
    }
}

fn preset(name: &str) -> PatchTree {
    let mut t = preset_bank()
        .into_iter()
        .find(|p| p.name == name)
        .expect("preset")
        .tree;
    t.ensure_uids();
    t
}

/// The warm start as the worker runs it, after the app's boot.
fn warm(bright: bool) -> Engine {
    let cfg = SessionConfig {
        pool_size: POOL,
        ..Default::default()
    };
    let mut e = Engine::new(PatchGrammarPrior::default(), cfg);
    e.begin_session();
    e.fill_pool(&mut StdRng::seed_from_u64(SEED));
    e.restandardize_if_untaught();
    let bank = preset_bank();
    let nine: Vec<_> = WARM
        .iter()
        .map(|n| bank.iter().find(|p| p.name == *n).expect("preset"))
        .collect();
    let mut by: Vec<(f64, usize)> = nine
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let (cf, _) = featurize_memo(&p.tree, &e.cfg.phrase, e.memo(), false).expect("vets");
            (cf.features.audio.centroid_mean, i)
        })
        .collect();
    by.sort_by(|a, b| a.0.total_cmp(&b.0));
    if bright {
        by.reverse();
    }
    let picked: Vec<usize> = by[..3].iter().map(|x| x.1).collect();
    let mut ids = Vec::new();
    for &i in &picked {
        let id = e.insert_preset(nine[i].tree.clone(), nine[i].name).unwrap();
        e.set_pinned(id, true);
        ids.push(id);
    }
    for (i, p) in nine.iter().enumerate() {
        if picked.contains(&i) {
            continue;
        }
        let Some(id) = e.insert_preset(p.tree.clone(), p.name) else {
            continue;
        };
        for &w in &ids {
            if let (Some(a), Some(b)) = (e.find(w), e.find(id)) {
                e.record_duel(a, b, true);
            }
        }
    }
    e.fit_posterior(&mut StdRng::seed_from_u64(SEED ^ 0x51));
    let names: Vec<&str> = picked.iter().map(|&i| nine[i].name).collect();
    println!(
        "\n== warm start: the three {} ({}), {} picks",
        if bright { "brightest" } else { "darkest" },
        names.join(", "),
        e.log.len()
    );
    e
}

/// The app's noun for a structural coordinate (`STYLE_WORDS` in
/// `apps/web/main.js`), for the raw lines.
fn noun(coordinate: &str) -> &str {
    match coordinate {
        "n_vco" => "oscillators",
        "n_supersaw" => "supersaws",
        "n_noise" => "noise",
        "n_wavetable" => "wavetables",
        "n_pluck" => "plucked strings",
        "n_formant" => "formants",
        "n_filter" => "filters",
        "n_drive" => "drive",
        "n_time" => "delays",
        "n_mod_fx" => "sweeps",
        "n_reverb" => "reverb",
        "n_dynamics" => "compression",
        "n_rand" => "stepped modulation",
        "n_lfo" => "wobble",
        "n_env" => "envelopes",
        "n_follow" => "followers",
        "n_mod_shape" => "shaped modulation",
        "n_mod_logic" => "gated modulation",
        "mod_depth_mean" => "chained modulation",
        "chain_balance" => "even branches",
        "frac_sidechained" => "sidechains",
        "mod_density" => "busy modulation",
        other => other,
    }
}

fn sure(p: f64) -> &'static str {
    let d = (p * 100.0 - 50.0).abs();
    if d < 5.0 {
        "a hunch"
    } else if d < 20.0 {
        "leaning"
    } else {
        "fairly sure"
    }
}

fn line(g: &Guess, against: &str) -> String {
    let why = match &g.why {
        Some(w) if w.control.is_some() => format!(
            "it moves toward {} ({:+.2}σ, {}), as your picks lean",
            w.word.unwrap_or(""),
            w.moved,
            w.control.unwrap_or("")
        ),
        Some(w) => format!(
            "your picks lean toward {} {} ({:+.2}σ)",
            if w.moved > 0.0 { "more" } else { "fewer" },
            noun(w.coordinate.unwrap_or("")),
            w.moved
        ),
        None => "no part of it leans your way".into(),
    };
    format!(
        "{} at {}: {why} · {:.0}% over {} · {} · lcb {:+.3}",
        g.kind,
        g.socket,
        g.p * 100.0,
        if against == "patch" {
            "the patch"
        } else {
            "your pool's average"
        },
        sure(g.p),
        g.lcb
    )
}

struct Row {
    floor_renders: usize,
    floor_ms: f64,
    full_renders: usize,
    full_ms: f64,
    plan_ms: f64,
    per: Vec<f64>,
}

/// Render what `limit` plans, one job at a time, timing each render and the
/// plan and ranking calls apart.
fn run(
    e: &Engine,
    tree: &PatchTree,
    limit: usize,
    failed: &mut HashSet<String>,
    per: &mut Vec<f64>,
) -> (usize, f64, f64) {
    let (mut renders, mut ms, mut plan_ms) = (0, 0.0, 0.0);
    loop {
        let t = cpu_ms();
        let plan = e.guess_plan(tree, None, &[], failed, limit).expect("plan");
        plan_ms += cpu_ms() - t;
        if plan.jobs.is_empty() {
            break;
        }
        for j in plan.jobs {
            let t = cpu_ms();
            let ok = featurize_memo(&j.tree, &e.cfg.phrase, e.memo(), false).is_ok();
            let d = cpu_ms() - t;
            if !ok {
                failed.insert(j.key);
            }
            ms += d;
            per.push(d);
            renders += 1;
        }
    }
    (renders, ms, plan_ms)
}

fn main() {
    let mut cleared = Vec::new();
    for name in ["Detune Dream", "Sub & Sparkle"] {
        let mut t = preset(name);
        t.root = AudioNode::Silence { uid: Uid::mint() };
        cleared.push((format!("{name}, cleared"), t));
    }
    let patches: Vec<(String, PatchTree)> = PATCHES
        .iter()
        .map(|n| (n.to_string(), preset(n)))
        .chain(cleared)
        .collect();
    let mut all_per = Vec::new();
    for bright in [false, true] {
        let mut e = warm(bright);
        let mut rows = Vec::new();
        for (name, tree) in &patches {
            // The app's memo after opening the patch: the patch, measured.
            e.set_memo(RenderMemo::default());
            let _ = featurize_memo(tree, &e.cfg.phrase, e.memo(), false);
            let mut failed = HashSet::new();
            let mut per = Vec::new();
            let (fr, fms, p1) = run(&e, tree, GUESS_FLOOR, &mut failed, &mut per);
            let t = cpu_ms();
            let floor = e
                .guess_rank(tree, None, &[], &failed, GUESS_FLOOR)
                .expect("rank");
            let r1 = cpu_ms() - t;
            let (rr, rms, p2) = run(&e, tree, 0, &mut failed, &mut per);
            let t = cpu_ms();
            let full = e.guess_rank(tree, None, &[], &failed, 0).expect("rank");
            let r2 = cpu_ms() - t;
            println!(
                "\n{name}: {} candidates, {} rendered for the floor, {} for all",
                full.total,
                fr,
                fr + rr
            );
            for (label, r) in [("floor (8)", &floor), ("all", &full)] {
                for (i, g) in r.guesses.iter().take(3).enumerate() {
                    println!("  {label:<9} {}. {}", i + 1, line(g, r.against));
                }
            }
            let same_top =
                floor.guesses.first().map(|g| &g.op) == full.guesses.first().map(|g| &g.op);
            println!("  the floor's first guess is all's first: {same_top}");
            all_per.extend(per.iter().copied());
            rows.push((
                name.clone(),
                Row {
                    floor_renders: fr,
                    floor_ms: fms,
                    full_renders: fr + rr,
                    full_ms: fms + rms,
                    plan_ms: p1 + p2 + r1 + r2,
                    per,
                },
            ));
        }
        println!("\npatch                       floor: renders  CPU s   all: renders  CPU s   plan+rank ms  median render ms");
        for (name, r) in &rows {
            let mut per = r.per.clone();
            per.sort_by(f64::total_cmp);
            println!(
                "{name:<27} {:>15} {:>7.2} {:>14} {:>6.2} {:>14.1} {:>17.0}",
                r.floor_renders,
                r.floor_ms / 1e3,
                r.full_renders,
                r.full_ms / 1e3,
                r.plan_ms,
                per.get(per.len() / 2).copied().unwrap_or(f64::NAN)
            );
        }
    }
    all_per.sort_by(f64::total_cmp);
    let q = |f: f64| all_per[((all_per.len() - 1) as f64 * f) as usize];
    println!(
        "\none render, native: median {:.0} CPU ms (quartiles {:.0}–{:.0}) over {}",
        q(0.5),
        q(0.25),
        q(0.75),
        all_per.len()
    );
}
