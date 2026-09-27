//! How many named controls reach a patch a new player meets?
//!
//! Fills a session pool the way the app does (seeded prior draws, the pool's
//! own standardizer) and wires the first `n` pool members exactly as PERFORM
//! does (`Engine::wire_controls`: Jacobian, ridge, verification at ±½ and ±1).
//! Prints, per control, how often it is reachable at all, how often each
//! half is open, and the median purity and reach — and, for contrast, the
//! same patches under the preset bank's standardizer, and (predicted, without
//! verification) how the gate would read with purity measured against the
//! bare axis instead of against the other named axes.
//!
//! cargo run -p auracle-session --example reach_census --release -- [n] [seed]
use auracle_features::featurize;
use auracle_grammar::{preset_bank, PatchGrammarPrior};
use auracle_session::perform::{direction, jacobian, verify, wire, Wiring, CONTROLS};
use auracle_session::{Engine, SessionConfig};
use auracle_taste::Standardizer;
use rand::SeedableRng;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let n: usize = args.first().and_then(|s| s.parse().ok()).unwrap_or(24);
    let seed: u64 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(7);
    let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
    let mut engine = Engine::new(PatchGrammarPrior::default(), SessionConfig::default());
    engine.begin_session();
    engine.fill_pool(&mut rng);
    let spec = engine.cfg.phrase.clone();
    let trees: Vec<_> = engine.pool.iter().take(n).map(|c| c.tree.clone()).collect();
    let rows: Vec<Vec<f64>> = preset_bank()
        .iter()
        .filter_map(|p| featurize(&p.tree, &spec).ok())
        .map(|v| v.features.phi())
        .collect();
    let preset_std = Standardizer::fit(&rows);
    println!(
        "{} pool patches (pool of {}), seed {seed}",
        trees.len(),
        engine.pool.len()
    );
    let std = engine.standardizer().expect("filled pool").clone();
    let pool: Vec<Vec<Wiring>> = trees
        .iter()
        .filter_map(|t| {
            let jac = jacobian(t, &spec, engine.memo(), &std)?;
            let mut w = wire(&jac);
            verify(t, &jac, &mut w, &spec, engine.memo(), &std);
            Some(w)
        })
        .collect();
    let presets: Vec<Vec<Wiring>> = trees
        .iter()
        .filter_map(|t| {
            let jac = jacobian(t, &spec, engine.memo(), &preset_std)?;
            let mut w = wire(&jac);
            verify(t, &jac, &mut w, &spec, engine.memo(), &preset_std);
            Some(w)
        })
        .collect();
    // Variant: purity measured only against the *other named axes* — "does
    // turning Bright move Snap, Motion, Body, Grit or Space?" — predicted
    // only (no verification), for comparison with the predicted gate of the
    // bare-axis arm below.
    {
        let (mut reach_axis, mut reach_sub) = ([0usize; 6], [0usize; 6]);
        let mut pur_sub: Vec<Vec<f64>> = vec![Vec::new(); 6];
        let mut per_axis = [0usize; 7];
        let mut per_sub = [0usize; 7];
        for t in &trees {
            let Some(jac) = jacobian(t, &spec, engine.memo(), &std) else {
                continue;
            };
            let w = wire(&jac);
            let axes: Vec<Vec<f64>> = CONTROLS.iter().map(|c| direction(c, &jac.names)).collect();
            let (mut na, mut ns) = (0, 0);
            for (k, wk) in w.iter().enumerate() {
                if wk.moved.is_empty() {
                    pur_sub[k].push(0.0);
                    continue;
                }
                let dot = |a: &[f64]| a.iter().zip(&wk.moved).map(|(x, y)| x * y).sum::<f64>();
                let along = dot(&axes[k]);
                let off: f64 = (0..6)
                    .filter(|&j| j != k)
                    .map(|j| dot(&axes[j]).powi(2))
                    .sum();
                let sub = along / (along * along + off).sqrt().max(1e-12);
                pur_sub[k].push(sub);
                let reach_ok = wk.reach >= 0.15;
                if along >= 0.35 && reach_ok {
                    reach_axis[k] += 1;
                    na += 1;
                }
                if sub >= 0.35 && reach_ok {
                    reach_sub[k] += 1;
                    ns += 1;
                }
            }
            per_axis[na] += 1;
            per_sub[ns] += 1;
        }
        let n = trees.len() as f64;
        println!("\npredicted gate (no verification): axis purity vs named-subspace purity");
        println!(
            "{:<7} {:>10} {:>10} {:>12}",
            "control", "axis", "subspace", "med sub-pur"
        );
        for (k, c) in CONTROLS.iter().enumerate() {
            let mut v = pur_sub[k].clone();
            v.sort_by(f64::total_cmp);
            println!(
                "{:<7} {:>10.2} {:>10.2} {:>12.2}",
                c.name,
                reach_axis[k] as f64 / n,
                reach_sub[k] as f64 / n,
                v[v.len() / 2]
            );
        }
        println!("per patch, axis: {per_axis:?}  subspace: {per_sub:?}");
    }
    for (label, set) in [
        ("pool standardizer (what ships)", &pool),
        ("preset standardizer", &presets),
    ] {
        println!("\n{label}: {} wired", set.len());
        println!(
            "{:<7} {:>6} {:>6} {:>6} {:>8} {:>8}",
            "control", "reach", "down", "up", "purity", "reachσ"
        );
        for (k, c) in CONTROLS.iter().enumerate() {
            let ws: Vec<&Wiring> = set.iter().map(|w| &w[k]).collect();
            let m = ws.len().max(1) as f64;
            let open = |f: &dyn Fn(&Wiring) -> bool| ws.iter().filter(|w| f(w)).count() as f64 / m;
            let med = |mut v: Vec<f64>| {
                v.sort_by(f64::total_cmp);
                v.get(v.len() / 2).copied().unwrap_or(f64::NAN)
            };
            println!(
                "{:<7} {:>6.2} {:>6.2} {:>6.2} {:>8.2} {:>8.2}",
                c.name,
                open(&|w: &Wiring| !w.search),
                open(&|w: &Wiring| w.range().0 < 0.0),
                open(&|w: &Wiring| w.range().1 > 0.0),
                med(ws.iter().map(|w| w.purity).collect()),
                med(ws.iter().map(|w| w.reach).collect()),
            );
        }
        let per: Vec<usize> = set
            .iter()
            .map(|w| w.iter().filter(|x| !x.search).count())
            .collect();
        let mut hist = [0usize; 7];
        per.iter().for_each(|&c| hist[c] += 1);
        println!("controls reachable per patch (0..6): {hist:?}");
    }
}
