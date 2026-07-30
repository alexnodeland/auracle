//! The synthetic user (DESIGN.md §4, the M3 gate).
//!
//! A ground-truth taste (θ*, τ*, cuts*) that generates noisy feedback exactly
//! per the observation model. The gate tests assert the posterior recovers
//! θ* and predicts held-out feedback — making the taste core falsifiable with
//! no UI and no human. Later this doubles as demo mode ("watch it learn a
//! fake user in fast-forward").

use rand::Rng;

use crate::observe::Observation;

fn sigmoid(x: f64) -> f64 {
    1.0 / (1.0 + (-x).exp())
}

/// A simulated user with fixed ground-truth taste.
#[derive(Clone, Debug)]
pub struct SyntheticUser {
    /// Ground-truth weight vector.
    pub theta: Vec<f64>,
    /// Ground-truth keep/kill threshold.
    pub tau: f64,
    /// Ground-truth ordered star cutpoints.
    pub cuts: Vec<f64>,
}

impl SyntheticUser {
    /// True utility of a (standardized) candidate.
    pub fn utility(&self, phi: &[f64]) -> f64 {
        self.theta.iter().zip(phi).map(|(t, x)| t * x).sum()
    }

    /// Sample a duel outcome (true = chose A), Bradley–Terry noise.
    pub fn duel<R: Rng>(&self, rng: &mut R, a: &[f64], b: &[f64]) -> bool {
        rng.gen_bool(sigmoid(self.utility(a) - self.utility(b)).clamp(1e-9, 1.0 - 1e-9))
    }

    /// Sample a keep/kill decision.
    pub fn keep<R: Rng>(&self, rng: &mut R, x: &[f64]) -> bool {
        rng.gen_bool(sigmoid(self.utility(x) - self.tau).clamp(1e-9, 1.0 - 1e-9))
    }

    /// Sample a star rating (cumulative-logit ordinal).
    pub fn stars<R: Rng>(&self, rng: &mut R, x: &[f64]) -> u8 {
        let u = self.utility(x);
        let r: f64 = rng.gen();
        let mut cum_prev = 0.0;
        for (k, c) in self.cuts.iter().enumerate() {
            let cum = sigmoid(c - u);
            if r < cum {
                return k as u8;
            }
            cum_prev = cum;
        }
        let _ = cum_prev;
        self.cuts.len() as u8
    }

    /// Generate a full duel observation on the given pair.
    pub fn observe_duel<R: Rng>(
        &self,
        rng: &mut R,
        a: Vec<f64>,
        b: Vec<f64>,
        session: usize,
    ) -> Observation {
        let chose_a = self.duel(rng, &a, &b);
        Observation::Duel {
            a,
            b,
            chose_a,
            session,
        }
    }
}

/// A simulated user whose taste has several islands: true utility is the
/// **max** over component tastes ("I love a great drone OR a great pluck").
/// A single linear θ provably cannot represent this — it is the ground truth
/// for the K > 1 mixture gate.
#[derive(Clone, Debug)]
pub struct MixtureSyntheticUser {
    /// Component ground-truth weight vectors.
    pub thetas: Vec<Vec<f64>>,
}

impl MixtureSyntheticUser {
    /// True utility: best component's score.
    pub fn utility(&self, phi: &[f64]) -> f64 {
        self.thetas
            .iter()
            .map(|t| t.iter().zip(phi).map(|(a, b)| a * b).sum::<f64>())
            .fold(f64::NEG_INFINITY, f64::max)
    }

    /// Sample a duel outcome (true = chose A), Bradley–Terry noise on the
    /// max-utility.
    pub fn duel<R: Rng>(&self, rng: &mut R, a: &[f64], b: &[f64]) -> bool {
        rng.gen_bool(sigmoid(self.utility(a) - self.utility(b)).clamp(1e-9, 1.0 - 1e-9))
    }

    /// Generate a full duel observation on the given pair.
    pub fn observe_duel<R: Rng>(
        &self,
        rng: &mut R,
        a: Vec<f64>,
        b: Vec<f64>,
        session: usize,
    ) -> Observation {
        let chose_a = self.duel(rng, &a, &b);
        Observation::Duel {
            a,
            b,
            chose_a,
            session,
        }
    }
}

/// Cosine similarity between two vectors (θ-recovery metric).
pub fn cosine(a: &[f64], b: &[f64]) -> f64 {
    let dot: f64 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let na: f64 = a.iter().map(|x| x * x).sum::<f64>().sqrt();
    let nb: f64 = b.iter().map(|x| x * x).sum::<f64>().sqrt();
    dot / (na * nb + 1e-12)
}
