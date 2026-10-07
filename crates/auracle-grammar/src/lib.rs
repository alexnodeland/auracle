//! # auracle-grammar
//!
//! The **patch prior**: a typed probabilistic context-free grammar (PCFG) over
//! quiver-backed synthesizer patch terms, plus the compiler from sampled terms
//! to playable quiver [`Patch`](quiver) graphs.
//!
//! Animated: [*The sound engine*](https://auracle.alexnodeland.com/docs/films.html#film-dsp) walks the patch graph, its modules
//! and their compilation; [*The math*](https://auracle.alexnodeland.com/docs/films.html#film-math) the prior as the search's target.
//!
//! The genome is a *term* ([`term::PatchTree`]), not a raw patch graph. The
//! Audio/Mod sort distinction is enforced by the Rust type system — ill-sorted
//! terms are unrepresentable — and the grammar ([`prior::PatchGrammarPrior`])
//! is a fugue generative program, so all three levels of evolution live in one
//! representation:
//!
//! - node settings   → leaf parameter sites (`F64`/`Usize` draws per module)
//! - connectivity    → interior structure (chains, mix, modulation slots)
//! - node set        → which module productions fire
//!
//! [`PatchTree`](term::PatchTree) implements fugue-evo's genome traits with a
//! canonical trace encoding that **is** the grammar's address scheme, so
//! subtree mutation/crossover are generic trace moves and tempered SMC / typed
//! MH come for free.
//!
//! ## v1 constraints (the reference: *The genome*, *The vetting gate*)
//!
//! - Acyclic terms only — no feedback combinator productions. Modules with
//!   *internal* feedback (delay, chorus) are allowed.
//! - Curated palette: Vco, Supersaw, NoiseGenerator, Wavetable,
//!   KarplusStrong, FormantOsc, Svf, DiodeLadderFilter, ParametricEq,
//!   Wavefolder, Distortion, Bitcrusher, DelayLine, Chorus, Reverb, Phaser,
//!   Flanger, Tremolo, Vibrato, Granular, PitchShifter, RingModulator,
//!   Compressor, Ducker, NoiseGate, Vocoder, Adsr, Vca, Lfo, SampleAndHold,
//!   SlewLimiter, EnvelopeFollower, AudioInput — plus one module of this
//!   crate's own, [`steps::StepsCv`], a step sequencer whose every value is a
//!   port.
//! - Every compiled patch gets the mandatory voice stage — amp ADSR → VCA →
//!   **Limiter** → StereoOutput — and bounded parameter mappings (resonance,
//!   feedback), so the grammar cannot express the most degenerate settings.

pub mod compile;
pub mod describe;
pub mod diff;
pub mod edit;
pub mod genome;
pub mod mutate;
pub mod presets;
pub mod prior;
pub mod rng;
pub mod steps;
pub mod take;
pub mod term;

pub use compile::{
    compile, compile_follower, compile_follower_for_render, compile_for_render, compile_with_input,
    cutoff_hz, lowpass_apply, lowpass_response, CompiledVoice, ParamHandle, ParamMap, TrackFeed,
    COMPILE_MAX_NESTING, INPUT_GAIN_UNITY, TRACK_SENSITIVITY_DEFAULT,
};
pub use describe::{describe, RackDescription};
pub use diff::{tree_diff, DiffEntry};
pub use edit::{set_param, EditError, ParamValue};
pub use genome::{clamp_param, in_domain, PARAM_DOMAIN, PARAM_MAX};
pub use mutate::{
    apply_struct_op, normalize_tree, validate_tree, ModKind, NodeKind, Normalized, StructError,
    StructOp,
};
pub use presets::{preset_bank, presets, Category, Preset, CATEGORIES};
pub use prior::PatchGrammarPrior;
pub use take::{SavedTake, Take, TakeError, MAX_TAKE_RATE, TAKE_FORMAT, TAKE_SECONDS};
pub use term::{
    AudioNode, CaptureMode, InputChannel, ModNode, PatchTree, PitchBand, Uid, INPUT_SLOTS,
};

#[cfg(test)]
mod tests;
