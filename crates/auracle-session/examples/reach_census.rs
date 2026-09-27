//! How many named controls reach a patch a new player meets?
//!
//! Fills a session pool the way the app does (seeded prior draws, the pool's
//! own standardizer) and wires the first `n` pool members exactly as PERFORM
//! does (`Engine::wire_controls`: Jacobian, ridge, verification at ±½ and ±1).
//! Prints, per control, how often it is reachable at all, how often each
//! half is open, and the median purity and reach — and, for contrast, the
//! same patches under the preset bank's standardizer.
//!
//! cargo run -p auracle-session --example reach_census --release -- [n] [seed]
use auracle_features::featurize;
use auracle_grammar::{preset_bank, PatchGrammarPrior};
use auracle_session::perform::{jacobian, verify, wire, Wiring, CONTROLS};
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
    // What ships: the pattern against this pool's audio correlation.
    let patterned: Vec<Vec<Wiring>> = trees
        .iter()
        .filter_map(|t| engine.wire_controls(t).map(|(_, w)| w))
        .collect();
    for (label, set) in [
        ("pool standardizer, bare axes", &pool),
        ("preset standardizer, bare axes", &presets),
        ("pool standardizer, patterned (shipped)", &patterned),
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
