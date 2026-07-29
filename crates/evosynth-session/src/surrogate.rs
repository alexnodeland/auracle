//! The learned taste as a fugue-evo fitness: the surrogate that lets the
//! machine evolve thousands of candidates silently (DESIGN.md §1.5).
//!
//! `SurrogateFitness` plugs the taste posterior's expected utility into
//! fugue-evo's `Fitness`, so the Boltzmann target
//! `π_β(x) ∝ p_grammar(x) · exp(β · E[u_θ(φ(x))])` becomes an ordinary
//! `EvolutionModel` and typed-MH / SMC drivers apply unchanged. Quarantined
//! candidates score a large negative fitness — safety layer 2: evolution
//! learns to avoid the pathological region.

use std::sync::Arc;

use evosynth_features::{featurize, PhraseSpec};
use evosynth_grammar::PatchTree;
use evosynth_taste::{Standardizer, TastePosterior};
use fugue_evo::fitness::traits::Fitness;

/// Fitness a quarantined (unrenderable/unlistenable) candidate receives.
pub const QUARANTINE_FITNESS: f64 = -50.0;

/// Expected posterior utility as a scalar fitness over patch terms.
#[derive(Clone)]
pub struct SurrogateFitness {
    /// The fitted taste posterior.
    pub posterior: Arc<TastePosterior>,
    /// The standardizer the posterior's observations were made under.
    pub standardizer: Arc<Standardizer>,
    /// The audition stimulus (must match the one used for observations).
    pub phrase: PhraseSpec,
}

impl Fitness for SurrogateFitness {
    type Genome = PatchTree;
    type Value = f64;

    fn evaluate(&self, genome: &PatchTree) -> f64 {
        match featurize(genome, &self.phrase) {
            Ok(v) => {
                let phi = self.standardizer.transform(&v.features.phi());
                self.posterior.utility_mix(&phi).0
            }
            Err(_) => QUARANTINE_FITNESS,
        }
    }
}
