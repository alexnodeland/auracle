//! Fixtures the crate's test files share: the test-scale config, the
//! synthetic listener, a taught engine, and the picks and clip several of
//! them build on. Measured like the code it tests, so every helper here runs
//! in the fast tier.

use crate::*;
use auracle_features::Features;
use auracle_grammar::PatchGrammarPrior;
use auracle_taste::SyntheticUser;
use rand::rngs::StdRng;
use rand::SeedableRng;

/// Test-scale engine config.
///
/// Identical to the shipped default except for the MCMC budget. The gap
/// used to be 5× (6k against a shipped 30k) and existed because a suite
/// that fits dozens of times could not afford the shipped chain; the
/// shipped default is now 10k/3k, so the gap is 1.7× and this is a
/// trim rather than a different regime.
///
/// It is kept, narrowed, for the tests whose subject is *machinery* —
/// that refinement injects lineage, that locks hold, that state
/// round-trips — where the posterior only has to be a posterior. The one
/// test whose subject is the posterior's *quality*
/// ([`closed_loop_learns_synthetic_taste`]) opts back up to the shipped
/// budget, because a quality gate measured on a chain no user runs is not
/// a gate on anything shipped.
pub(crate) fn fast() -> SessionConfig {
    SessionConfig {
        mcmc_samples: 6_000,
        mcmc_warmup: 2_000,
        ..Default::default()
    }
}

/// A synthetic user over the REAL standardized feature space: likes
/// bright, bassy, filtered patches with fast attacks; dislikes noisy
/// (flat-spectrum) and slow-attack ones.
pub(crate) fn ground_truth() -> SyntheticUser {
    let names = Features::phi_names();
    let mut theta = vec![0.0; names.len()];
    // Audio names carry a stimulus tag (`centroid_mean:p2`); the synthetic
    // user's taste is about the perceptual axis, not the stimulus, so
    // match on the base name.
    let mut set = |name: &str, w: f64| {
        let i = names
            .iter()
            .position(|n| n.split(':').next() == Some(name))
            .unwrap();
        theta[i] = w;
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

/// A taught engine for the generation tests: a full pool of 16, 30 duels
/// from the synthetic user, one fit, and a budget small enough to run
/// four of these at once. Deterministic in `seed`: two calls build two
/// engines with the same pool, ids, log and posterior.
pub(crate) fn taught(seed: u64) -> Engine {
    let mut rng = StdRng::seed_from_u64(seed);
    let user = ground_truth();
    let cfg = SessionConfig {
        pool_size: 16,
        refine_steps: 12,
        refine_seeds: 5,
        ..fast()
    };
    let mut engine = Engine::new(PatchGrammarPrior::default(), cfg);
    engine.begin_session();
    engine.fill_pool(&mut rng);
    for _ in 0..30 {
        let (a, b) = engine.next_duel(&mut rng).unwrap();
        let chose_a = user.duel(&mut rng, &engine.pool[a].phi_std, &engine.pool[b].phi_std);
        engine.record_duel(a, b, chose_a);
    }
    engine.fit_posterior(&mut rng);
    engine
}

/// The player prefers what the model likes least, `n` times: picks that
/// move the posterior as far as a pick can, with no refit.
pub(crate) fn contrary_picks(engine: &mut Engine, n: usize) {
    for _ in 0..n {
        let ranked = engine.ranked();
        let (best, worst) = (ranked[0].0, ranked[ranked.len() - 1].0);
        engine.record_duel(worst, best, true);
    }
}

/// A captured clip: a falling sweep, the phrase's length.
pub(crate) fn sweep_clip(spec: &auracle_features::PhraseSpec) -> auracle_features::AuditionClip {
    let x: Vec<f32> = (0..spec.total_samples())
        .map(|i| {
            let t = i as f64 / spec.sample_rate;
            let hz = 1200.0 * (-t / 2.5).exp() + 80.0;
            (0.4 * (std::f64::consts::TAU * hz * t).sin()) as f32
        })
        .collect();
    auracle_features::AuditionClip::from_interleaved(&x, 1, spec.sample_rate, spec).unwrap()
}
