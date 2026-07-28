//! # evosynth-grammar
//!
//! The **patch prior**: a typed probabilistic context-free grammar (PCFG) over
//! quiver's Layer-1 combinator algebra (`>>>`, `***`, `&&&`), plus the
//! compiler from sampled terms to playable quiver [`Patch`](quiver) graphs.
//!
//! The genome is a *term*, not a raw patch graph. Grammar productions are
//! typed by quiver signal kinds (Audio / V-Oct / Gate / CV) so that **every
//! sampled term compiles to a valid, sound-making patch**. All three levels of
//! evolution live in this one representation:
//!
//! - node settings   → leaf parameter sites (`F64`/`Usize` draws per module)
//! - connectivity    → interior structure (chains, parallel, modulation)
//! - node set        → which module productions fire
//!
//! The grammar is exposed to fugue-evo as a `GenomePrior` (`Model<PatchTerm>`),
//! so subtree mutation/crossover are generic trace moves and tempered SMC /
//! typed MH come for free.
//!
//! ## v1 constraints (see DESIGN.md §1.1)
//!
//! - Acyclic terms only — no feedback combinator productions. Modules with
//!   *internal* feedback (delay, chorus) are allowed.
//! - Curated palette (~10 modules): Vco, Supersaw, NoiseGenerator, Svf,
//!   DiodeLadderFilter, Adsr, Vca, Lfo, DelayLine, Chorus, Wavefolder.
//! - Every compiled patch gets a hard-wired Limiter before the output.

pub mod palette {
    //! The curated v1 module palette and per-module parameter site specs.
}

pub mod term {
    //! `PatchTerm`: the combinator-term genome (tree) and its trace addressing.
}

pub mod prior {
    //! The typed PCFG as a fugue `GenomePrior` — `Model<PatchTerm>`.
}

pub mod compile {
    //! `PatchTerm` → `quiver::Patch` compilation (+ output Limiter insertion).
}

#[cfg(test)]
mod tests {
    #[test]
    fn workspace_smoke() {
        // Replaced by real tests in M1: sample N terms from the prior and
        // assert every one compiles to a Patch that `compile()`s in quiver.
    }
}
