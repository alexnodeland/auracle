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

use fugue_evo::fitness::traits::Fitness;
use ricercar_features::{featurize_memo, PhraseSpec, RenderMemo};
use ricercar_grammar::PatchTree;
use ricercar_taste::{Standardizer, TastePosterior};

/// Fitness a quarantined (unrenderable/unlistenable) candidate receives.
pub const QUARANTINE_FITNESS: f64 = -50.0;

/// Expected posterior utility as a scalar fitness over patch terms.
#[derive(Clone, Debug)]
pub struct SurrogateFitness {
    /// The fitted taste posterior.
    pub posterior: Arc<TastePosterior>,
    /// The standardizer the posterior's observations were made under.
    pub standardizer: Arc<Standardizer>,
    /// The audition stimulus (must match the one used for observations).
    pub phrase: PhraseSpec,
    /// The engine's featurization memo.
    ///
    /// Not an optimization detail — it is what makes the MH walk affordable.
    /// `adaptive_single_site_mh` executes the model **twice per step**: once
    /// to re-score the current trace, which is bit-identically the tree the
    /// previous step accepted and therefore already featurized, and once for
    /// the proposal. Without a memo, one render in two is a recomputation of a
    /// number the walk already has.
    pub memo: RenderMemo,
}

impl Fitness for SurrogateFitness {
    type Genome = PatchTree;
    type Value = f64;

    fn evaluate(&self, genome: &PatchTree) -> f64 {
        // `want_audio: false` — the surrogate only ever wants φ, and nothing
        // in a refinement generation is ever played. Asking for samples here
        // would undo the memo: a miss would convert 141 k f64s it then drops,
        // and a hit would copy a ~565 KB buffer out of the audio tier. Twice
        // per MH step, ~96 times per seed, that is tens of megabytes of churn
        // for a value discarded on the next line.
        match featurize_memo(genome, &self.phrase, &self.memo, false) {
            Ok((cf, _)) => {
                let phi = self.standardizer.transform(&cf.features.phi());
                self.posterior.utility_mix(&phi).0
            }
            Err(_) => QUARANTINE_FITNESS,
        }
    }
}
