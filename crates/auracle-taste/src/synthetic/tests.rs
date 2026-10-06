use super::*;
use crate::model::TasteSample;
use crate::testkit::{ground_truth, D};
use rand::rngs::mock::StepRng;
use rand::rngs::StdRng;
use rand::SeedableRng;

/// Answers per share: a share's binomial SD is under 0.0036.
const N: usize = 20_000;

/// The share of [`N`] tries on which `event` happens.
fn share(mut event: impl FnMut() -> bool) -> f64 {
    (0..N).filter(|_| event()).count() as f64 / N as f64
}

/// A φ along `theta` that it scores at `u`.
fn scored_at(theta: &[f64], u: f64) -> Vec<f64> {
    let norm2: f64 = theta.iter().map(|t| t * t).sum();
    theta.iter().map(|t| t * u / norm2).collect()
}

/// The logistic function, written out here so that what the listeners are
/// checked against does not share their code.
fn logistic(v: f64) -> f64 {
    1.0 / (1.0 + (-v).exp())
}

/// How far a share may be from its probability. Swept over 201 seeds (this
/// one and 0 to 199), the largest miss of any of the nine shares was
/// 0.0118; 0.02 is over five binomial SDs.
const SHARE_BOUND: f64 = 0.02;

/// The synthetic listener answers as the model's likelihood says a listener
/// with its taste would: it picks a candidate in a duel, and keeps one, as
/// often as `exp(loglik)` of a posterior draw holding its θ and τ, so the
/// M3 gate fits the model to feedback from its own observation model,
/// Bradley–Terry noise and all. So do the two-island listener, whose
/// utility is its best lens's, and the ideal-point listener, by its own
/// utility.
#[test]
fn every_synthetic_listener_answers_by_the_models_likelihood() {
    let mut rng = StdRng::seed_from_u64(0x5A7E);
    for miss in listener_misses(&mut rng) {
        assert!(miss.0 < SHARE_BOUND, "{}", miss.1);
    }
}

/// Each share these listeners answer at, against its probability: how far
/// apart they are, and what was asked.
fn listener_misses(rng: &mut StdRng) -> Vec<(f64, String)> {
    let mut misses = Vec::new();
    let mut check = |got: f64, want: f64, what: String| {
        misses.push(((got - want).abs(), format!("{what}: {got}, not {want}")));
    };

    let user = ground_truth();
    let draw = TasteSample {
        theta: vec![user.theta.clone()],
        tau: vec![user.tau],
        cuts: user.cuts.clone(),
    };
    for (ua, ub) in [(1.0, 0.5), (-0.3, 0.8), (2.0, -1.0)] {
        let (a, b) = (scored_at(&user.theta, ua), scored_at(&user.theta, ub));
        let duel = Feedback::Duel {
            a: a.clone(),
            b: b.clone(),
            chose_a: true,
        };
        let want = draw.loglik(&duel, 0).exp();
        let got = share(|| user.duel(rng, &a, &b));
        check(got, want, format!("A at {ua} picked over B at {ub}"));
    }
    for u in [1.0, -0.5, 1.9] {
        let x = scored_at(&user.theta, u);
        let keep = Feedback::KeepKill {
            x: x.clone(),
            kept: true,
        };
        let want = draw.loglik(&keep, 0).exp();
        let got = share(|| user.keep(rng, &x));
        check(
            got,
            want,
            format!("a candidate at {u} kept (τ {})", user.tau),
        );
    }

    // Two islands: lens 0 likes coordinate 0, lens 1 coordinate 1.
    let unit = |i: usize| -> Vec<f64> {
        let mut e = vec![0.0; D];
        e[i] = 1.0;
        e
    };
    let islands = MixtureSyntheticUser {
        thetas: vec![unit(0), unit(1)],
    };
    let both = TasteSample {
        theta: islands.thetas.clone(),
        tau: vec![0.0],
        cuts: Vec::new(),
    };
    let mix = |p: f64, q: f64| -> Vec<f64> {
        let mut x = vec![0.0; D];
        (x[0], x[1]) = (p, q);
        x
    };
    for (a, b) in [
        (mix(0.8, 0.2), mix(0.1, 0.5)),
        (mix(-1.0, 0.4), mix(0.9, -2.0)),
    ] {
        let duel = Feedback::Duel {
            a: a.clone(),
            b: b.clone(),
            chose_a: true,
        };
        let want = both.loglik(&duel, 0).exp();
        let got = share(|| islands.duel(rng, &a, &b));
        check(
            got,
            want,
            format!("two islands: {:?} picked over {:?}", &a[..2], &b[..2]),
        );
    }

    // An ideal point: A at it, B half a unit off on the sharpest axis.
    let ideal = ideal_point();
    let a = ideal.center.clone();
    let mut b = a.clone();
    b[0] += 0.5;
    let want = logistic(ideal.utility(&a) - ideal.utility(&b));
    let got = share(|| ideal.duel(rng, &a, &b));
    check(
        got,
        want,
        "the ideal point picked over a sound off it".into(),
    );
    misses
}

/// A listener looking for one sound: bright-ish and quiet on axis 1.
fn ideal_point() -> IdealPointUser {
    let mut center = vec![0.0; D];
    let mut weights = vec![0.1; D];
    (center[0], center[1]) = (0.5, -0.2);
    (weights[0], weights[1]) = (0.9, 0.4);
    IdealPointUser { center, weights }
}

/// The ideal-point listener likes the sound it is looking for best, and
/// likes a sound less the further it is from it on any axis, either way:
/// its utility is `−Σ wᵢ(φᵢ − cᵢ)²`, 0 at the center.
#[test]
fn an_ideal_point_is_liked_best_and_less_either_side() {
    let ideal = ideal_point();
    assert_eq!(ideal.utility(&ideal.center), 0.0);
    for (axis, w) in [(0, 0.9), (1, 0.4), (5, 0.1)] {
        for step in [-0.5, 0.5] {
            let mut x = ideal.center.clone();
            x[axis] += step;
            let u = ideal.utility(&x);
            assert!(
                (u + w * 0.25).abs() < 1e-12,
                "half a unit off on axis {axis} scores {u}, not {}",
                -w * 0.25
            );
        }
    }
}

/// A star rating is the inverse of the cumulative logit: a uniform draw `r`
/// in [0, 1) rates the first category `k` whose cumulative probability
/// `P(rating ≤ k) = σ(c_k − u)` is above `r`, so each rating comes up
/// exactly as often as the model's ordinal likelihood says. That holds at
/// the boundary too: a draw exactly at `σ(c_k − u)` rates above `k`, since
/// a uniform `r` is below it with probability `σ(c_k − u)`, no more.
///
/// Walked over the draws `j/16` (rand's uniform `f64` is a `u64`'s top 53
/// bits over 2^53, so a generator that returns `j·2^60` draws exactly
/// `j/16`), at candidates the listener scores −1.5, 0 and 0.3. At 0, the
/// middle cutpoint sits exactly at the draw 1/2.
#[test]
fn a_star_rating_inverts_the_cumulative_logit() {
    let user = ground_truth();
    for u_target in [-1.5, 0.0, 0.3] {
        let x = scored_at(&user.theta, u_target);
        let u = user.utility(&x);
        for j in 0..16u64 {
            let r = j as f64 / 16.0;
            let below = user.cuts.iter().filter(|&&c| logistic(c - u) <= r).count();
            let rating = user.stars(&mut StepRng::new(j << 60, 0), &x);
            assert_eq!(
                usize::from(rating),
                below,
                "at u = {u} the draw {r} rated {rating}"
            );
        }
    }
}

/// Where the observation model is certain, so are the listeners: at a
/// utility gap of 200, whose logistic is 1 to the last bit one way and
/// under 2^-64 (rand's resolution for a probability) the other, every draw
/// picks and keeps the better candidate, the largest `u64` included, and
/// none picks or keeps the worse, the smallest included. The noise has no
/// floor and no ceiling: a 1e-9 one used to make every answer uncertain,
/// which is not the model the gates fit.
#[test]
fn where_the_model_is_certain_so_are_the_listeners() {
    let user = ground_truth();
    let (better, worse) = (
        scored_at(&user.theta, 100.0),
        scored_at(&user.theta, -100.0),
    );
    let mut e = vec![0.0; D];
    e[0] = 100.0;
    let islands = MixtureSyntheticUser {
        thetas: vec![e.clone(), e.iter().rev().copied().collect()],
    };
    let ideal = ideal_point();
    let mut far = ideal.center.clone();
    far[0] += 20.0;
    for draw in [0, u64::MAX] {
        let mut fixed = StepRng::new(draw, 0);
        let rng = &mut fixed;
        assert!(user.duel(rng, &better, &worse) && !user.duel(rng, &worse, &better));
        assert!(user.keep(rng, &better) && !user.keep(rng, &worse));
        let (high, low) = (vec![1.0; D], vec![-1.0; D]);
        assert!(islands.duel(rng, &high, &low) && !islands.duel(rng, &low, &high));
        assert!(ideal.duel(rng, &ideal.center, &far) && !ideal.duel(rng, &far, &ideal.center));
    }
}
