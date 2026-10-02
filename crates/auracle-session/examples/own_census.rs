//! A sound of your own (Plan-005 task 11): does breeding toward it get
//! closer, and where does it land on the map? The census that chose
//! [`OWN_GAMMA`] and [`OWN_PLACEMENT`].
//!
//! A session is set up as the app has one: a filled pool and a taste taught
//! by a synthetic listener (the one `offer_census` uses). The "files" are
//! presets rendered on a stimulus that is not the phrase (the `melody` of
//! `auracle_features::file::recording_stimuli`) and measured as files, so
//! the truth is known: the preset's own φ on the phrase.
//!
//! **Breeding.** For each target the generation `refine_toward_jobs` opens
//! (parents: the pool members nearest the target) is walked once per arm,
//! every arm from the same job seeds, so the arms are paired: `untilted` is
//! the taste's own target (`toward: None`), the others are tilted at γ.
//! Per arm: the distance to the target (σ, over the coordinates the file
//! measures) at the walk's start and end, the change, how often the end is
//! nearer, what it cost in taste (`ΔE[u]`), and how far the end is from the
//! preset itself rather than from its recording (`end to preset`: a pull
//! harder than the recording can be trusted chases its measurement error).
//! The shipped arm's children are then absorbed into the generation, and
//! the census says how many admission took.
//!
//! **Placement.** Each target preset is put into the pool, so the map draws
//! it; then the file is placed on that map three ways, and the error is the
//! distance to the preset's own point, as a share of the map's spread (the
//! RMS distance of its points from the center). `fit` and `imputed` are
//! [`Placement`]'s two; `nearest 3` is the centroid of the three pool
//! members nearest the file (the prototype's method). `… (phrase)` places
//! from the preset's phrase φ restricted to the same coordinates: what the
//! mask costs, without what the recording costs.
//!
//! ```bash
//! cargo run -p auracle-session --example own_census --release -- \
//!     [sessions=2] [targets=6] [gammas=0.5,1,2] [seeds=5]
//! ```
use std::collections::BTreeMap;
use std::time::Instant;

use auracle_features::file::recording_stimuli;
use auracle_features::render::render_phrase;
use auracle_features::{featurize, featurize_file, featurize_memo, Features, PhraseSpec};
use auracle_grammar::{preset_bank, PatchGrammarPrior, PatchTree, Preset};
use auracle_session::{
    run_walk, Engine, Placement, SessionConfig, WalkContext, WalkJob, WalkResult, OWN_GAMMA,
};
use auracle_taste::SyntheticUser;
use rand::rngs::StdRng;
use rand::SeedableRng;

const TEACH_DUELS: usize = 60;

fn listener() -> SyntheticUser {
    let names = Features::phi_names();
    let mut theta = vec![0.0; names.len()];
    let mut set = |name: &str, w: f64| {
        if let Some(i) = names.iter().position(|n| n.split(':').next() == Some(name)) {
            theta[i] = w;
        }
    };
    set("centroid_mean", 2.0);
    set("flatness_mean", -1.5);
    set("attack_s", -1.5);
    set("bass_fraction", 1.0);
    set("n_filter", 0.8);
    set("tail_ratio", 0.6);
    SyntheticUser {
        theta,
        tau: 0.0,
        cuts: vec![-2.0, -0.9, 0.0, 0.9, 2.0],
    }
}

fn session(seed: u64, seeds: usize) -> Engine {
    let cfg = SessionConfig {
        mcmc_samples: 3_000,
        mcmc_warmup: 900,
        refine_seeds: seeds,
        ..Default::default()
    };
    let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
    engine.begin_session();
    let mut rng = StdRng::seed_from_u64(seed);
    engine.fill_pool(&mut rng);
    let user = listener();
    for _ in 0..4 {
        for _ in 0..(TEACH_DUELS / 4) {
            let Some((a, b)) = engine.next_duel(&mut rng) else {
                break;
            };
            let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
            engine.record_duel(a, b, chose_a);
        }
        engine.fit_posterior(&mut rng);
    }
    engine
}

/// A preset recorded on the melody and measured as a file.
fn recording(p: &Preset) -> Option<auracle_features::FileFeatures> {
    let (_, spec) = recording_stimuli().into_iter().next()?;
    let r = render_phrase(&p.tree, &spec).ok()?;
    let pcm: Vec<f32> = r.samples.iter().map(|&s| s as f32).collect();
    featurize_file(&pcm, spec.sample_rate).ok()
}

fn utility(e: &Engine, t: &PatchTree) -> Option<f64> {
    let std = e.standardizer()?;
    let (cf, _) = featurize_memo(t, &e.cfg.phrase, e.memo(), false).ok()?;
    Some(e.utility_of(&std.transform(&cf.features.phi())))
}

fn z_of(e: &Engine, t: &PatchTree) -> Option<Vec<f64>> {
    let std = e.standardizer()?;
    let (cf, _) = featurize_memo(t, &e.cfg.phrase, e.memo(), false).ok()?;
    Some(std.transform(&cf.features.phi()))
}

#[derive(Default, Clone)]
struct Arm {
    d0: Vec<f64>,
    d1: Vec<f64>,
    du: Vec<f64>,
    /// Distance at the end to the preset itself (its phrase φ on the same
    /// coordinates), not to its recording.
    t1: Vec<f64>,
    moved: usize,
    /// Walks that ended on a patch that does not vet.
    unvetted: usize,
}

#[derive(Default)]
struct Place {
    /// fit, imputed, nearest 3, fit (phrase), imputed (phrase)
    err: [Vec<f64>; 5],
}

/// What one session measured: the two blocks of arms, the placements, and
/// what admission did with the shipped arm's children.
type SessionOut = ([Vec<Arm>; 2], Place, BTreeMap<String, usize>);

fn mean_se(v: &[f64]) -> (f64, f64) {
    let n = v.len().max(1) as f64;
    let m = v.iter().sum::<f64>() / n;
    let var = v.iter().map(|x| (x - m).powi(2)).sum::<f64>() / (n - 1.0).max(1.0);
    (m, (var / n).sqrt())
}

fn run_session(seed: u64, targets: &[&Preset], gammas: &[f64], seeds: usize) -> SessionOut {
    let mut engine = session(seed, seeds);
    let mut outcomes: BTreeMap<String, usize> = BTreeMap::new();
    let mut arms = [
        vec![Arm::default(); gammas.len() + 1],
        vec![Arm::default(); gammas.len() + 1],
    ];
    let mut place = Place::default();
    let spec = PhraseSpec::default();
    let mut rng = StdRng::seed_from_u64(seed ^ 0x0A1D);
    for p in targets {
        let Some(file) = recording(p) else {
            eprintln!("{}: no recording", p.name);
            continue;
        };
        engine.own_set(p.name, &file);
        // ---- breeding ----
        // The generation Breed toward it opens, left open: its own arm's
        // children are absorbed into it below, as the app would.
        let Some((ctx, jobs)) = engine.refine_toward_jobs(&mut rng) else {
            eprintln!("{}: no generation", p.name);
            continue;
        };
        let toward = ctx.toward.clone().expect("a toward generation");
        // The truth the recording stands in for: the preset's own φ on the
        // phrase, on the same coordinates.
        let Some(truth_z) = z_of(&engine, &p.tree) else {
            continue;
        };
        let truth = auracle_session::Toward {
            target: toward.observed.iter().map(|&j| truth_z[j]).collect(),
            ..toward.clone()
        };
        let contexts: Vec<WalkContext> = std::iter::once(WalkContext {
            toward: None,
            ..ctx.clone()
        })
        .chain(gammas.iter().map(|&g| {
            let mut t = toward.clone();
            t.gamma = g;
            WalkContext {
                toward: Some(t),
                ..ctx.clone()
            }
        }))
        .collect();
        let memo = engine.memo().clone();
        let walk_all = |jobs: &[WalkJob]| -> Vec<Vec<WalkResult>> {
            std::thread::scope(|s| {
                let hs: Vec<_> = contexts
                    .iter()
                    .map(|c| {
                        let memo = &memo;
                        s.spawn(move || {
                            jobs.iter()
                                .map(|j| run_walk(c, j, memo))
                                .collect::<Vec<_>>()
                        })
                    })
                    .collect();
                hs.into_iter().map(|h| h.join().unwrap()).collect()
            })
        };
        let tally = |engine: &Engine,
                     arms: &mut Vec<Arm>,
                     jobs: &[WalkJob],
                     results: &[Vec<WalkResult>]| {
            for (a, res) in results.iter().enumerate() {
                let arm = &mut arms[a];
                for (j, r) in jobs.iter().zip(res) {
                    let Some(z0) = z_of(engine, &j.seed) else {
                        continue;
                    };
                    let end = r.child.as_ref().unwrap_or(&j.seed);
                    let Some(z1) = z_of(engine, end) else {
                        arm.unvetted += 1;
                        continue;
                    };
                    let u0 = utility(engine, &j.seed).unwrap_or(0.0);
                    let u1 = utility(engine, end).unwrap_or(0.0);
                    arm.d0.push(toward.distance(&z0));
                    arm.d1.push(toward.distance(&z1));
                    arm.du.push(u1 - u0);
                    arm.t1.push(truth.distance(&z1));
                    if r.child.is_some() {
                        arm.moved += 1;
                    }
                }
            }
        };
        let near = walk_all(&jobs);
        tally(&engine, &mut arms[0], &jobs, &near);
        // The shipped arm's children, absorbed in job order into the open
        // generation: what admission does with them.
        if let Some(k) = gammas.iter().position(|g| *g == OWN_GAMMA) {
            for r in &near[k + 1] {
                engine.refine_absorb(r.clone());
                *outcomes
                    .entry(engine.last_refine().as_str().to_string())
                    .or_default() += 1;
            }
        }
        engine.refine_finish();
        // The taste's own parents (the best ranked), from the same stream:
        // breeding toward the sound from wherever the taste stands.
        let far = engine
            .refine_jobs(&mut rng)
            .map(|(_, jobs)| jobs)
            .unwrap_or_default();
        engine.refine_finish();
        let far_results = walk_all(&far);
        tally(&engine, &mut arms[1], &far, &far_results);
        // ---- placement ----
        // One slot more for the visit, so the preset displaces nobody.
        engine.cfg.pool_size += 1;
        let inserted = engine.insert_preset(p.tree.clone(), p.name);
        engine.cfg.pool_size -= 1;
        let Some(id) = inserted else {
            continue;
        };
        let map = engine.taste_map();
        let Some(truth) = map.points.iter().find(|q| q.id == Some(id)) else {
            continue;
        };
        let spread = (map
            .points
            .iter()
            .map(|q| q.x * q.x + q.y * q.y)
            .sum::<f64>()
            / map.points.len() as f64)
            .sqrt();
        let err = |x: f64, y: f64| ((x - truth.x).powi(2) + (y - truth.y).powi(2)).sqrt() / spread;
        for (k, how) in [Placement::Fit, Placement::Imputed].into_iter().enumerate() {
            if let Some(o) = engine.own_on_map(how) {
                place.err[k].push(err(o.x, o.y));
            }
        }
        let near: Vec<(f64, f64)> = engine
            .own_nearest(4)
            .into_iter()
            .filter(|(n, _)| *n != id)
            .take(3)
            .filter_map(|(n, _)| map.points.iter().find(|q| q.id == Some(n)))
            .map(|q| (q.x, q.y))
            .collect();
        if !near.is_empty() {
            let k = near.len() as f64;
            place.err[2].push(err(
                near.iter().map(|q| q.0).sum::<f64>() / k,
                near.iter().map(|q| q.1).sum::<f64>() / k,
            ));
        }
        if let Ok(vc) = featurize(&p.tree, &spec) {
            let phrase_file = auracle_features::FileFeatures {
                audio: vc.features.audio,
                ..file.clone()
            };
            engine.own_set(p.name, &phrase_file);
            for (k, how) in [Placement::Fit, Placement::Imputed].into_iter().enumerate() {
                if let Some(o) = engine.own_on_map(how) {
                    place.err[3 + k].push(err(o.x, o.y));
                }
            }
        }
        // Leave the pool as it was for the next target.
        if let Some(i) = engine.find(id) {
            engine.pool.remove(i);
        }
        engine.own_clear();
    }
    (arms, place, outcomes)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let sessions: usize = args.first().and_then(|s| s.parse().ok()).unwrap_or(2);
    let n_targets: usize = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(6);
    let gammas: Vec<f64> = args
        .get(2)
        .map(|s| s.as_str())
        .unwrap_or("0.5,1,2")
        .split(',')
        .filter_map(|g| g.parse().ok())
        .collect();
    let seeds: usize = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(5);
    let bank = preset_bank();
    let stride = (bank.len() / n_targets.max(1)).max(1);
    let targets: Vec<&Preset> = bank.iter().step_by(stride).take(n_targets).collect();
    println!(
        "targets: {}",
        targets
            .iter()
            .map(|p| p.name)
            .collect::<Vec<_>>()
            .join(", ")
    );
    let t0 = Instant::now();
    let parts: Vec<SessionOut> = std::thread::scope(|s| {
        let hs: Vec<_> = (0..sessions)
            .map(|k| {
                let (targets, gammas) = (&targets, &gammas);
                s.spawn(move || run_session(0x5EED + k as u64, targets, gammas, seeds))
            })
            .collect();
        hs.into_iter().map(|h| h.join().unwrap()).collect()
    });
    let mut arms = [
        vec![Arm::default(); gammas.len() + 1],
        vec![Arm::default(); gammas.len() + 1],
    ];
    let mut place = Place::default();
    let mut outcomes: BTreeMap<String, usize> = BTreeMap::new();
    for (a, p, o) in parts {
        for (k, n) in o {
            *outcomes.entry(k).or_default() += n;
        }
        for (block, part) in arms.iter_mut().zip(a) {
            for (acc, x) in block.iter_mut().zip(part) {
                acc.d0.extend(x.d0);
                acc.d1.extend(x.d1);
                acc.du.extend(x.du);
                acc.t1.extend(x.t1);
                acc.moved += x.moved;
                acc.unvetted += x.unvetted;
            }
        }
        for (acc, x) in place.err.iter_mut().zip(p.err) {
            acc.extend(x);
        }
    }
    println!(
        "\n{sessions} sessions, {:.0} s (OWN_GAMMA = {OWN_GAMMA})",
        t0.elapsed().as_secs_f64()
    );
    for (block, title) in [
        "from the parents nearest the sound (what Breed toward it does)",
        "from the taste's own parents (the best ranked)",
    ]
    .iter()
    .enumerate()
    {
        let arms = &arms[block];
        println!("\n{title}: {} walks per arm", arms[0].d0.len());
        println!(
            "{:<10} {:>14} {:>14} {:>16} {:>8} {:>8} {:>16} {:>16}",
            "arm",
            "start (σ)",
            "end (σ)",
            "change (σ)",
            "nearer",
            "moved",
            "ΔE[u]",
            "end to preset"
        );
        let untilted_d1 = arms[0].d1.clone();
        for (a, arm) in arms.iter().enumerate() {
            let label = if a == 0 {
                "untilted".to_string()
            } else {
                format!("γ = {}", gammas[a - 1])
            };
            let change: Vec<f64> = arm.d1.iter().zip(&arm.d0).map(|(b, a)| b - a).collect();
            let nearer = change.iter().filter(|c| **c < -1e-9).count();
            let (s0, s0e) = mean_se(&arm.d0);
            let (s1, s1e) = mean_se(&arm.d1);
            let (c, ce) = mean_se(&change);
            let (du, due) = mean_se(&arm.du);
            let (t1, t1e) = mean_se(&arm.t1);
            let n = arm.d0.len().max(1);
            println!(
                "{label:<10} {:>14} {:>14} {:>16} {:>7.0}% {:>7.0}% {:>16} {:>16}",
                format!("{s0:.2} ± {s0e:.2}"),
                format!("{s1:.2} ± {s1e:.2}"),
                format!("{c:+.2} ± {ce:.2}"),
                100.0 * nearer as f64 / n as f64,
                100.0 * arm.moved as f64 / n as f64,
                format!("{du:+.2} ± {due:.2}"),
                format!("{t1:.2} ± {t1e:.2}"),
            );
            if arm.unvetted > 0 {
                println!(
                    "{:<10} {} walk(s) ended on a patch that does not vet",
                    "", arm.unvetted
                );
            }
            if a > 0 {
                let paired: Vec<f64> = arm
                    .d1
                    .iter()
                    .zip(&untilted_d1)
                    .map(|(t, u)| t - u)
                    .collect();
                let (m, se) = mean_se(&paired);
                println!(
                    "{:<10} end minus untilted end, paired: {m:+.2} ± {se:.2} σ",
                    ""
                );
            }
        }
    }
    println!(
        "\nthe γ = {OWN_GAMMA} children from the nearest parents, absorbed: {}",
        outcomes
            .iter()
            .map(|(k, n)| format!("{k} {n}"))
            .collect::<Vec<_>>()
            .join(", ")
    );
    println!(
        "\nplacement error, share of the map's spread ({} targets):",
        place.err[0].len()
    );
    for (k, label) in [
        "fit",
        "imputed",
        "nearest 3",
        "fit (phrase)",
        "imputed (phrase)",
    ]
    .iter()
    .enumerate()
    {
        let (m, se) = mean_se(&place.err[k]);
        println!("  {label:<18} {m:.2} ± {se:.2}");
    }
}
