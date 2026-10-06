use super::*;
use crate::testkit::*;

/// A member's mixture utility under the posterior the long way, from the
/// draws and their weights: `(mean, std, the lens most responsible)`, the
/// last of equals as the map's rule keeps.
fn summary_by_hand(p: &auracle_taste::TastePosterior, phi: &[f64]) -> (f64, f64, usize) {
    let mut us = Vec::new();
    let mut resp = vec![0.0; p.k_styles()];
    for (s, draw) in p.samples.iter().enumerate() {
        let lens: Vec<f64> = draw
            .theta
            .iter()
            .map(|t| t.iter().zip(phi).map(|(a, b)| a * b).sum())
            .collect();
        let (best, u) = lens
            .iter()
            .enumerate()
            .fold((0, f64::NEG_INFINITY), |acc, (k, &v)| {
                if v >= acc.1 {
                    (k, v)
                } else {
                    acc
                }
            });
        us.push(u);
        resp[best] += p.weight(s);
    }
    let mean: f64 = us.iter().enumerate().map(|(s, u)| p.weight(s) * u).sum();
    let var: f64 = us
        .iter()
        .enumerate()
        .map(|(s, u)| p.weight(s) * (u - mean) * (u - mean))
        .sum();
    let lens = (0..resp.len()).fold(0, |best, k| if resp[k] >= resp[best] { k } else { best });
    (mean, var.sqrt(), lens)
}

/// **The belief after a pick is the posterior the pick left.** Picks
/// between refits reweight the draws and fit nothing; `Engine::belief`
/// must report the reweighted posterior, number for number what a refit's
/// views would show of it (the ranked list, the map's pool dots), and what
/// the draws and their weights give computed the long way.
#[test]
fn the_belief_after_a_pick_is_the_reweighted_posterior() {
    let mut engine = taught(0xBE1F);
    let fitted = engine.belief();
    contrary_picks(&mut engine, 4);
    // The direction is fitted on the last map drawn, which is engine
    // state too: draw it first, as every views post does.
    let _ = engine.taste_map();
    let after = engine.belief();
    let p = engine.posterior.clone().expect("taught");
    assert!(
        p.ess() < p.samples.len() as f64 - 1e-6 || engine.needs_refit(),
        "the picks did not reweight the draws"
    );
    let numbers = |b: &Belief| -> Vec<(u64, u64, u64)> {
        b.ranked
            .iter()
            .map(|r| (r.id, r.mean.to_bits(), r.std.to_bits()))
            .collect()
    };
    assert_ne!(
        numbers(&after),
        numbers(&fitted),
        "the picks moved nothing, so nothing was tested"
    );
    assert!(p.k_styles() > 1, "one lens, so no lens was tested");

    let ranked = engine.ranked();
    assert_eq!(after.ranked.len(), engine.pool.len());
    for (row, &(i, mean, std)) in after.ranked.iter().zip(&ranked) {
        assert_eq!(row.id, engine.pool[i].id, "not the ranked order");
        assert_eq!(row.mean.to_bits(), mean.to_bits(), "not the ranked mean");
        assert_eq!(row.std.to_bits(), std.to_bits(), "not the ranked std");
    }
    let map = engine.taste_map();
    let mut dots = 0;
    for pt in map.points.iter().filter(|pt| pt.id.is_some()) {
        let row = after.ranked.iter().find(|r| Some(r.id) == pt.id).unwrap();
        assert_eq!(row.mean.to_bits(), pt.utility.to_bits(), "not the glow");
        assert_eq!(row.std.to_bits(), pt.utility_std.to_bits(), "not the size");
        assert_eq!(row.style, pt.style, "not the color");
        dots += 1;
    }
    assert_eq!(dots, engine.pool.len());
    for row in &after.ranked {
        let c = &engine.pool[engine.find(row.id).unwrap()];
        let (mean, std, lens) = summary_by_hand(&p, &c.phi_std);
        assert!((row.mean - mean).abs() <= 1e-9 * (1.0 + mean.abs()));
        assert!((row.std - std).abs() <= 1e-9 * (1.0 + std.abs()));
        assert_eq!(row.style, lens);
    }
    assert_eq!(
        after,
        engine.belief(),
        "a belief is a function of the engine"
    );
}
