//! Watch the synth learn a fake user's taste in fast-forward (DESIGN.md §4).
//!
//! A synthetic user who likes bright, bassy, filtered, fast-attack patches
//! answers Thompson-chosen duels; between rounds the posterior re-fits and
//! the pool re-ranks. Printed per round: how well the learned taste ranks the
//! pool (Pearson r against ground truth) and the current top patches.
//!
//! ```bash
//! cargo run -p ricercar-session --example learn_synthetic --release
//! ```

use rand::rngs::StdRng;
use rand::SeedableRng;
use ricercar_features::Features;
use ricercar_grammar::PatchGrammarPrior;
use ricercar_session::{Engine, SessionConfig};
use ricercar_taste::SyntheticUser;

fn pearson(xs: &[f64], ys: &[f64]) -> f64 {
    let n = xs.len() as f64;
    let mx = xs.iter().sum::<f64>() / n;
    let my = ys.iter().sum::<f64>() / n;
    let cov: f64 = xs.iter().zip(ys).map(|(x, y)| (x - mx) * (y - my)).sum();
    let vx: f64 = xs.iter().map(|x| (x - mx) * (x - mx)).sum();
    let vy: f64 = ys.iter().map(|y| (y - my) * (y - my)).sum();
    cov / (vx.sqrt() * vy.sqrt() + 1e-12)
}

fn main() {
    let mut rng = StdRng::seed_from_u64(0xFAB);

    // The fake user's taste, in named feature space.
    let names = Features::phi_names();
    let mut theta = vec![0.0; names.len()];
    for (name, w) in [
        ("centroid_mean", 2.0),
        ("flatness_mean", -1.5),
        ("attack_s", -1.5),
        ("bass_fraction", 1.0),
        ("n_filter", 0.8),
        ("tail_ratio", 0.6),
    ] {
        theta[names.iter().position(|n| *n == name).unwrap()] = w;
    }
    let user = SyntheticUser {
        theta,
        tau: 0.0,
        cuts: vec![-2.0, -0.9, 0.0, 0.9, 2.0],
    };
    println!("synthetic user: bright, bassy, filtered, fast attack, long tails\n");

    let mut engine = Engine::new(
        PatchGrammarPrior::default(),
        SessionConfig {
            pool_size: 48,
            ..Default::default()
        },
    );
    engine.begin_session();
    print!("rendering + vetting candidate pool… ");
    engine.fill_pool(&mut rng);
    println!("{} vetted candidates\n", engine.pool.len());

    for round in 1..=5 {
        for _ in 0..12 {
            let (a, b) = engine.next_duel(&mut rng).unwrap();
            let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
            engine.record_duel(a, b, chose_a);
        }
        engine.fit_posterior(&mut rng);

        let posterior = engine.posterior.as_ref().unwrap();
        let (mut xs, mut ys) = (Vec::new(), Vec::new());
        for c in &engine.pool {
            xs.push(posterior.utility_mix(&c.phi_std).0);
            ys.push(user.utility(&c.phi_std));
        }
        let r = pearson(&xs, &ys);
        let ranked = engine.ranked();
        let (top, tm, ts) = ranked[0];
        println!(
            "round {round}: {:>3} duels | model↔truth r = {r:.2} | top: u = {tm:.2}±{ts:.2}",
            engine.log.len()
        );
        println!("         {}", engine.pool[top].tree.to_sexpr());
    }

    println!("\nfinal top 3 in the user's learned taste:");
    for &(i, m, s) in engine.ranked().iter().take(3) {
        println!("  u = {m:5.2} ± {s:.2}  {}", engine.pool[i].tree.to_sexpr());
    }
}
