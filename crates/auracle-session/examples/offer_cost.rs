//! What a PERFORM offer costs, per preset, and where the time goes.
//!
//! This is what the web worker had to wait for before offers and drifts were
//! jobs it steps (`docs/architecture/web-runtime.md`): the whole of one call.
//! Now it is the sum of the steps, and the worker is deaf to the player for one
//! of them (about the one-render time this prints last). A session is set up
//! as the app has one (a filled pool, a taste taught by a synthetic listener).
//! Then, for
//! every preset in the sample, on a memo holding only the patch (the app has
//! measured that one already, so the first proposals all miss):
//!
//! - **offer**: `Engine::offer`, the Offer button's and the spare's walk, at
//!   the app's `steps` (20);
//! - **toward**: `Engine::offer_toward` on Grit, up (up to `AIM_WALKS` walks);
//! - **drift**: `Engine::drift`, Wander's, 12 steps of σ 0.05.
//!
//! Each row is wall time, the renders it cost (memo misses), and the share of
//! the time those renders took (the rest is the walk's own: the prior's
//! scoring, the surrogate, decoding the trace). A last block times one
//! render's stages on the patch itself: `render_phrase`, `vet`,
//! `normalize_to` and `audio_features`.
//!
//! cargo run -p auracle-session --example offer_cost --release -- \
//!     [presets=12] [offers=3] [steps=20]
use std::time::Instant;

use auracle_features::{
    audio_features, featurize_memo, normalize_to, render_phrase, vet, RenderMemo, VetConfig,
    TARGET_LUFS,
};
use auracle_grammar::{preset_bank, PatchGrammarPrior, Preset};
use auracle_session::{Engine, SessionConfig};
use auracle_taste::SyntheticUser;
use rand::rngs::StdRng;
use rand::SeedableRng;

fn session(seed: u64) -> Engine {
    let cfg = SessionConfig {
        mcmc_samples: 3_000,
        mcmc_warmup: 900,
        ..Default::default()
    };
    let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
    engine.begin_session();
    let mut rng = StdRng::seed_from_u64(seed);
    engine.fill_pool(&mut rng);
    let names = auracle_features::Features::phi_names();
    let mut theta = vec![0.0; names.len()];
    for (name, w) in [("centroid_mean", 2.0), ("flatness_mean", -1.5)] {
        if let Some(i) = names.iter().position(|n| n.split(':').next() == Some(name)) {
            theta[i] = w;
        }
    }
    let user = SyntheticUser {
        theta,
        tau: 0.0,
        cuts: vec![-2.0, -0.9, 0.0, 0.9, 2.0],
    };
    for _ in 0..4 {
        for _ in 0..15 {
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

fn pct(v: &mut [f64], p: f64) -> f64 {
    v.sort_by(f64::total_cmp);
    v[((v.len() - 1) as f64 * p).round() as usize]
}

fn summary(label: &str, ms: &mut [f64], renders: &[f64], render_ms: f64) {
    let n = ms.len() as f64;
    let mean = ms.iter().sum::<f64>() / n;
    let r = renders.iter().sum::<f64>() / n;
    println!(
        "{label:<8} n={:<3} mean {:>7.0} ms  p50 {:>7.0}  p90 {:>7.0}  max {:>7.0}  renders {:>5.1}  renders' share {:>3.0}%",
        ms.len(),
        mean,
        pct(ms, 0.5),
        pct(ms, 0.9),
        pct(ms, 1.0),
        r,
        100.0 * (r * render_ms / mean).min(1.0),
    );
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let n_presets: usize = args.first().and_then(|s| s.parse().ok()).unwrap_or(12);
    let n_offers: usize = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(3);
    let steps: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(20);
    let bank = preset_bank();
    let stride = (bank.len() / n_presets.max(1)).max(1);
    let sample: Vec<&Preset> = bank.iter().step_by(stride).take(n_presets).collect();
    let mut engine = session(7);
    let grit = auracle_session::perform::CONTROLS
        .iter()
        .position(|c| c.name == "Grit")
        .expect("Grit is one of the six");
    let spec = engine.cfg.phrase.clone();
    println!(
        "{} presets (every {stride}th of {}), {n_offers} offers each, {steps} steps\n",
        sample.len(),
        bank.len()
    );

    // One render's stages, on each preset (median of 3).
    let mut stage = [Vec::new(), Vec::new(), Vec::new(), Vec::new()];
    for p in &sample {
        let mut t = [[0.0f64; 3]; 4];
        #[allow(clippy::needless_range_loop)]
        for i in 0..3 {
            let a = Instant::now();
            let Ok(mut r) = render_phrase(&p.tree, &spec) else {
                continue;
            };
            t[0][i] = a.elapsed().as_secs_f64() * 1e3;
            let a = Instant::now();
            let _ = vet(&r.samples, &VetConfig::for_spec(&spec));
            t[1][i] = a.elapsed().as_secs_f64() * 1e3;
            let a = Instant::now();
            let _ = normalize_to(&mut r.samples, r.sample_rate, TARGET_LUFS);
            t[2][i] = a.elapsed().as_secs_f64() * 1e3;
            let a = Instant::now();
            let _ = audio_features(&r);
            t[3][i] = a.elapsed().as_secs_f64() * 1e3;
        }
        for k in 0..4 {
            t[k].sort_by(f64::total_cmp);
            stage[k].push(t[k][1]);
        }
    }

    let mut all: [Vec<f64>; 3] = Default::default();
    let mut all_r: [Vec<f64>; 3] = Default::default();
    println!(
        "{:<16} {:>9} {:>9} {:>9}   (ms; renders in brackets)",
        "preset", "offer", "toward", "drift"
    );
    for p in &sample {
        let mut cells = [Vec::new(), Vec::new(), Vec::new()];
        let mut ren = [Vec::new(), Vec::new(), Vec::new()];
        for i in 0..n_offers {
            for which in 0..3 {
                engine.set_memo(RenderMemo::default());
                if featurize_memo(&p.tree, &spec, engine.memo(), false).is_err() {
                    continue;
                }
                let before = engine.memo().stats().misses;
                let mut r = StdRng::seed_from_u64(1000 * which as u64 + i as u64);
                let t = Instant::now();
                match which {
                    0 => {
                        let _ = engine.offer(&mut r, &p.tree, &[], steps);
                    }
                    1 => {
                        let _ = engine.offer_toward(&mut r, &p.tree, &[], steps, grit, 1.0);
                    }
                    _ => {
                        let _ = engine.drift(&mut r, &p.tree, &[], 12, 0.05);
                    }
                }
                cells[which].push(t.elapsed().as_secs_f64() * 1e3);
                ren[which].push((engine.memo().stats().misses - before) as f64);
            }
        }
        let med = |v: &mut Vec<f64>| if v.is_empty() { f64::NAN } else { pct(v, 0.5) };
        let line: Vec<String> = (0..3)
            .map(|k| {
                let r = if ren[k].is_empty() {
                    f64::NAN
                } else {
                    ren[k].iter().sum::<f64>() / ren[k].len() as f64
                };
                format!("{:>5.0} [{:>3.0}]", med(&mut cells[k].clone()), r)
            })
            .collect();
        println!("{:<16} {}", p.name, line.join(" "));
        for k in 0..3 {
            all[k].extend(cells[k].iter());
            all_r[k].extend(ren[k].iter());
        }
    }
    let one: f64 = stage
        .iter()
        .map(|v| v.iter().sum::<f64>() / v.len() as f64)
        .sum();
    println!(
        "\none render, mean of presets' medians: {:.0} ms = render_phrase {:.0} + vet {:.1} + normalize {:.1} + audio_features {:.1}\n",
        one,
        stage[0].iter().sum::<f64>() / stage[0].len() as f64,
        stage[1].iter().sum::<f64>() / stage[1].len() as f64,
        stage[2].iter().sum::<f64>() / stage[2].len() as f64,
        stage[3].iter().sum::<f64>() / stage[3].len() as f64,
    );
    for (k, label) in ["offer", "toward", "drift"].iter().enumerate() {
        summary(label, &mut all[k], &all_r[k], one);
    }
}
