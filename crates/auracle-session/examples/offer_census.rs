//! How hard, and how long, should a search control's offer aim? The census
//! that chose [`AIM_GAMMA`] and [`AIM_WALKS`].
//!
//! Turning a search control asks for an offer walked on the tilted target
//! `π ∝ p_grammar · exp(β·(f + γ·s·ê·z))` (`Engine::offer_toward`), which keeps
//! walking from where it stopped, up to W walks, until it has moved the asked
//! way by `REACH_FLOOR`. γ trades aim against taste: at 0 a single walk is the
//! Offer button's undirected offer, and large enough it is a walk toward the
//! label that no longer cares what the player likes. W trades aim against the
//! wait. This measures all three.
//!
//! A session is set up as the app has one: a filled pool (its standardizer is
//! the session's), and a taste taught by a synthetic listener over the pool's
//! duels (`--prior` skips the teaching, for the before-the-first-fit case).
//! Then, for every preset in the sample, the controls PERFORM would draw as
//! search controls (`Engine::wire_controls`, verification included), each
//! turned both ways, on each arm, `n` offers of `steps` steps a walk. Every arm
//! uses the same seeds, so the arms are paired and `0×1` is the undirected
//! offer itself. With `--timed` each walk starts from a fresh memo holding
//! only the patch it grew from (the app has measured that one already), so
//! its time is what a player waits for, on this machine; without it the arms
//! share one memo per preset, which is faster and changes nothing but the
//! clock.
//!
//! Per arm it prints how far the offer moved the way it was turned (`s·ê·Δz`,
//! in σ of the session's spread), how often that is at least `REACH_FLOOR`
//! (the gate's floor for a control that reaches) and at least R*, a
//! knob-reachable control's median verified reach on the same presets (what a
//! full turn of a control that works does), what it cost in taste (`ΔE[u]`,
//! also as a share of the spread of `E[u]` over the pool), and how long an
//! offer took.
//!
//! cargo run -p auracle-session --example offer_census --release -- \
//!     [presets=16] [offers=2] [steps=20] [arms=0x1,0.5x1,1x1,2x1,4x1,0x3,1x3,2x3] \
//!     [--prior] [--timed]
//!
//! An arm is `γ` or `γxW`. `CENSUS_THREADS` (default 3) sessions run side by
//! side, each the same session (same seed, pool and fit), each taking every
//! third preset.
use std::time::Instant;

use auracle_features::{featurize_memo, Features, RenderMemo};
use auracle_grammar::{preset_bank, PatchGrammarPrior, PatchTree, Preset};
use auracle_session::perform::{AIM_GAMMA, AIM_WALKS, CONTROLS, REACH_FLOOR};
use auracle_session::{Engine, SessionConfig};
use auracle_taste::SyntheticUser;
use rand::rngs::StdRng;
use rand::SeedableRng;

/// Duels taught before the census, refit in four instalments.
const TEACH_DUELS: usize = 60;

/// The listener the session is taught by: the one `search_health` climbs
/// toward. It likes bright, snappy, full, far sounds and dislikes noise
/// (`flatness_mean` −1.5), so every control has one way that pleases it and
/// one that costs, and Grit turned up costs the most.
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

/// The session the census runs in: pool filled, taste taught (or not).
fn session(seed: u64, prior_only: bool) -> Engine {
    let cfg = SessionConfig {
        mcmc_samples: 3_000,
        mcmc_warmup: 900,
        ..Default::default()
    };
    let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
    engine.begin_session();
    let mut rng = StdRng::seed_from_u64(seed);
    engine.fill_pool(&mut rng);
    if !prior_only {
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
    }
    engine
}

fn median(v: &mut [f64]) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    v.sort_by(f64::total_cmp);
    let n = v.len();
    if n % 2 == 1 {
        v[n / 2]
    } else {
        0.5 * (v[n / 2 - 1] + v[n / 2])
    }
}

/// One offer's outcome.
struct Trial {
    control: usize,
    sign: f64,
    gamma_i: usize,
    /// `s·ê·Δz`: σ moved the way it was turned (0 for a walk that stayed).
    moved: f64,
    /// `E[u](offer) − E[u](home)` under the fitted posterior.
    du: f64,
    ms: f64,
}

/// What one worker measured.
#[derive(Default)]
struct Census {
    trials: Vec<Trial>,
    /// Verified reach of every open half of every reachable control.
    reach: Vec<f64>,
    searched: [usize; 6],
    log: Vec<String>,
}

fn utility(e: &Engine, t: &PatchTree) -> Option<f64> {
    let std = e.standardizer()?;
    let (cf, _) = featurize_memo(t, &e.cfg.phrase, e.memo(), false).ok()?;
    Some(e.utility_of(&std.transform(&cf.features.phi())))
}

#[allow(clippy::too_many_arguments)]
fn census_preset(
    engine: &mut Engine,
    c: &mut Census,
    pi: usize,
    p: &Preset,
    arms: &[(f64, usize)],
    n_offers: usize,
    steps: usize,
    seed: u64,
    timed: bool,
) {
    engine.set_memo(RenderMemo::default());
    let Some((_, wiring)) = engine.wire_controls(&p.tree) else {
        c.log.push(format!("{}: does not vet, skipped", p.name));
        return;
    };
    for w in &wiring {
        if !w.search {
            c.reach
                .extend(w.up.into_iter().chain(w.down).filter(|r| *r > 0.0));
        }
    }
    let search: Vec<usize> = (0..wiring.len()).filter(|&k| wiring[k].search).collect();
    c.log.push(format!(
        "{:<18} search: {}",
        p.name,
        search
            .iter()
            .map(|&k| CONTROLS[k].name)
            .collect::<Vec<_>>()
            .join(" ")
    ));
    for &k in &search {
        c.searched[k] += 1;
        for sign in [1.0, -1.0] {
            for i in 0..n_offers {
                let mix = ((pi as u64) << 32) ^ ((k as u64) << 16) ^ (u64::from(sign > 0.0) << 8);
                for (gi, &(gamma, walks)) in arms.iter().enumerate() {
                    // Timed: a fresh memo with only the home patch in it, as
                    // in the app, so the walk's time is a player's wait.
                    // Otherwise the arms share renders (same seeds, same
                    // early proposals), which is faster and changes nothing
                    // but the clock.
                    if timed {
                        engine.set_memo(RenderMemo::default());
                    }
                    let u0 = utility(engine, &p.tree);
                    let mut r = StdRng::seed_from_u64(seed ^ mix ^ i as u64);
                    let t = Instant::now();
                    let out =
                        engine.offer_aimed(&mut r, &p.tree, &[], steps, k, sign, gamma, walks);
                    let ms = t.elapsed().as_secs_f64() * 1e3;
                    let (moved, du) = match &out {
                        Ok(o) => (
                            sign * engine.moved_along(&p.tree, o, k).unwrap_or(0.0),
                            match (u0, utility(engine, o)) {
                                (Some(a), Some(b)) => b - a,
                                _ => 0.0,
                            },
                        ),
                        Err(_) => (0.0, 0.0),
                    };
                    c.trials.push(Trial {
                        control: k,
                        sign,
                        gamma_i: gi,
                        moved,
                        du,
                        ms,
                    });
                }
            }
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let prior_only = args.iter().any(|a| a == "--prior");
    let timed = args.iter().any(|a| a == "--timed");
    let pos: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();
    let n_presets: usize = pos.first().and_then(|s| s.parse().ok()).unwrap_or(16);
    let n_offers: usize = pos.get(1).and_then(|s| s.parse().ok()).unwrap_or(2);
    let steps: usize = pos.get(2).and_then(|s| s.parse().ok()).unwrap_or(20);
    // Arms as `γ` or `γxW` (W walks at most, `AIM_WALKS` for the shipped
    // offer), comma-separated.
    let arms: Vec<(f64, usize)> = pos
        .get(3)
        .map(|s| s.as_str())
        .unwrap_or("0x1,0.5x1,1x1,2x1,4x1,0x3,1x3,2x3")
        .split(',')
        .filter_map(|a| {
            let mut it = a.split('x');
            let g = it.next()?.parse().ok()?;
            let w = it.next().map_or(Some(1), |w| w.parse().ok())?;
            Some((g, w))
        })
        .collect();
    let seed = 7u64;
    let threads: usize = std::env::var("CENSUS_THREADS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3)
        .max(1);

    // Every `k`th preset, so a small sample still spans the bank's families.
    let bank = preset_bank();
    let stride = (bank.len() / n_presets.max(1)).max(1);
    let sample: Vec<&Preset> = bank.iter().step_by(stride).take(n_presets).collect();

    let t0 = Instant::now();
    let (u_sd, taught, parts): (f64, bool, Vec<Census>) = std::thread::scope(|s| {
        let handles: Vec<_> = (0..threads)
            .map(|w| {
                let (sample, arms) = (&sample, &arms);
                s.spawn(move || {
                    let mut engine = session(seed, prior_only);
                    let us: Vec<f64> = engine
                        .pool
                        .iter()
                        .map(|c| engine.utility_of(&c.phi_std))
                        .collect();
                    let m = us.iter().sum::<f64>() / us.len().max(1) as f64;
                    let sd = (us.iter().map(|u| (u - m).powi(2)).sum::<f64>()
                        / us.len().max(2) as f64)
                        .sqrt();
                    let mut c = Census::default();
                    for (pi, p) in sample.iter().enumerate().filter(|(i, _)| i % threads == w) {
                        census_preset(
                            &mut engine,
                            &mut c,
                            pi,
                            p,
                            arms,
                            n_offers,
                            steps,
                            seed,
                            timed,
                        );
                    }
                    (sd, engine.has_taste(), c)
                })
            })
            .collect();
        let mut out = Vec::new();
        let (mut sd, mut taught) = (0.0, false);
        for h in handles {
            let (s, t, c) = h.join().expect("a census worker panicked");
            (sd, taught) = (s, t);
            out.push(c);
        }
        (sd, taught, out)
    });
    let u_sd = u_sd.max(1e-9);
    let mut trials: Vec<Trial> = Vec::new();
    let mut reach: Vec<f64> = Vec::new();
    let mut searched = [0usize; 6];
    for c in parts {
        for l in &c.log {
            eprintln!("{l}");
        }
        trials.extend(c.trials);
        reach.extend(c.reach);
        for k in 0..6 {
            searched[k] += c.searched[k];
        }
    }

    let r_star = median(&mut reach.clone());
    println!(
        "\n{} presets (every {stride}th), {n_offers} offers × {steps} steps per search control per way, seed {seed}, {}, {:.0} s",
        sample.len(),
        if taught { "taught taste" } else { "prior only" },
        t0.elapsed().as_secs_f64()
    );
    println!(
        "search controls seen: {}",
        CONTROLS
            .iter()
            .zip(searched)
            .map(|(c, n)| format!("{} {n}", c.name))
            .collect::<Vec<_>>()
            .join(", ")
    );
    println!(
        "a reachable control's median verified reach at a full turn: R* = {r_star:.2}σ ({} open halves); E[u] sd over the pool {u_sd:.3}",
        reach.len()
    );
    println!(
        "\n{:>7} {:>6} {:>9} {:>8} {:>8} {:>8} {:>10} {:>9} {:>9} {:>8}",
        "γ×walks",
        "offers",
        "med move",
        "moved>0",
        "≥ floor",
        "≥ R*",
        "med ΔE[u]",
        "ΔE[u]/sd",
        "mean ms",
        "p90 ms"
    );
    for (gi, (g, w)) in arms.iter().enumerate() {
        let ts: Vec<&Trial> = trials.iter().filter(|t| t.gamma_i == gi).collect();
        let n = ts.len().max(1) as f64;
        let mut mv: Vec<f64> = ts.iter().map(|t| t.moved).collect();
        let mut du: Vec<f64> = ts.iter().map(|t| t.du).collect();
        let pos = ts.iter().filter(|t| t.moved > 0.0).count() as f64 / n;
        let far = ts.iter().filter(|t| t.moved >= r_star).count() as f64 / n;
        let floor = ts.iter().filter(|t| t.moved >= REACH_FLOOR).count() as f64 / n;
        let ms = ts.iter().map(|t| t.ms).sum::<f64>() / n;
        let mut times: Vec<f64> = ts.iter().map(|t| t.ms).collect();
        times.sort_by(f64::total_cmp);
        let p90 = times.get(times.len() * 9 / 10).copied().unwrap_or(f64::NAN);
        let mdu = median(&mut du);
        println!(
            "{:>7} {:>6} {:>8.2}σ {:>7.0}% {:>7.0}% {:>7.0}% {:>10.3} {:>9.2} {:>9.0} {:>8.0}",
            format!("{g}×{w}"),
            ts.len(),
            median(&mut mv),
            100.0 * pos,
            100.0 * floor,
            100.0 * far,
            mdu,
            mdu / u_sd,
            ms,
            p90
        );
    }
    println!("\nshare of offers that moved the asked way by at least REACH_FLOOR (at least R* in brackets), per control and way");
    print!("{:<9}", "control");
    for (g, w) in &arms {
        print!(" {:>11}", format!("{g}×{w}"));
    }
    println!();
    for (k, c) in CONTROLS.iter().enumerate() {
        for sign in [1.0, -1.0] {
            let n = trials
                .iter()
                .filter(|t| t.control == k && t.sign == sign && t.gamma_i == 0)
                .count();
            if n == 0 {
                continue;
            }
            print!(
                "{:<9}",
                format!("{} {}", c.name, if sign > 0.0 { "up" } else { "dn" })
            );
            for gi in 0..arms.len() {
                let ts: Vec<&Trial> = trials
                    .iter()
                    .filter(|t| t.control == k && t.sign == sign && t.gamma_i == gi)
                    .collect();
                let far = ts.iter().filter(|t| t.moved >= r_star).count() * 100 / ts.len().max(1);
                let floor =
                    ts.iter().filter(|t| t.moved >= REACH_FLOOR).count() * 100 / ts.len().max(1);
                print!(" {:>11}", format!("{floor}% ({far}%)"));
            }
            println!(" n={n}");
        }
    }
    println!("\nmedian move the way it was turned, per control and way (σ)");
    print!("{:<9}", "control");
    for (g, w) in &arms {
        print!(" {:>8}", format!("{g}×{w}"));
    }
    println!();
    for (k, c) in CONTROLS.iter().enumerate() {
        for sign in [1.0, -1.0] {
            let rows: Vec<Vec<f64>> = (0..arms.len())
                .map(|gi| {
                    trials
                        .iter()
                        .filter(|t| t.control == k && t.sign == sign && t.gamma_i == gi)
                        .map(|t| t.moved)
                        .collect()
                })
                .collect();
            if rows[0].is_empty() {
                continue;
            }
            print!(
                "{:<9}",
                format!("{} {}", c.name, if sign > 0.0 { "up" } else { "dn" })
            );
            for mut r in rows {
                print!(" {:>7.2}σ", median(&mut r));
            }
            println!();
        }
    }
    println!("\nshipped: AIM_GAMMA = {AIM_GAMMA}, AIM_WALKS = {AIM_WALKS}");
}
