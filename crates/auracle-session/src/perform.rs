//! Performance: named controls wired through a patch's own Jacobian, and a
//! knob-only walk on the taste target.
//!
//! ## Named controls
//!
//! A performer reaches for *brighter*, not for `node/0#cut`. A **named
//! control** is a fixed direction `d` in standardized audio-φ space — *Bright*
//! is `+centroid_mean +rolloff_mean`, *Snap* is `−attack_s +crest`, and so
//! on — with a name that means the same thing on every patch. What it moves
//! differs per patch, and is found by measurement rather than by a table:
//!
//! 1. [`jacobian`] renders the patch once per continuous knob, nudged, and
//!    records `J = ∂z/∂p` — how each knob moves each standardized audio
//!    coordinate.
//! 2. [`wire`] solves `min ‖J x − d‖² + λ‖x‖²` for the knob move `x` that best
//!    produces the named direction, keeps the [`MAX_KNOBS`] largest entries,
//!    and re-solves on that support. A control value `c ∈ [−1, 1]` then moves
//!    the patch to `p₀ + c·α·x`, with `α` set so no knob travels more than
//!    [`MAX_TRAVEL`] of its range.
//! 3. The gate asks whether the move is *this* control: [`Wiring::purity`] is
//!    the cosine with `d` inside the subspace of the six named axes, so a
//!    brightening that also raises the zero-crossing rate is still Bright,
//!    and one that also slows the attack is not. [`separate`] makes sure no
//!    two controls are one gesture, and [`verify`] checks each half on real
//!    renders.
//!
//! Why measured, and not a table of "what a cutoff knob usually does": the
//! `jacobian_probe` example measured both over the 61 presets. Wired from each
//! patch's own Jacobian, the median purity (cosine between the φ movement
//! achieved and the direction asked for) was 0.61 for Bright, 0.77 for Snap and
//! 0.75 for Motion. Wired from the best leave-one-out table of per-site-kind
//! averages it was 0.23, 0.16 and 0.09: the same knob does different things in
//! different patches, which is the whole reason the grammar exists.
//!
//! **A control the patch cannot reach is not faked.** Grit and Space measured
//! a median purity of ~0 by knobs alone, because most patches contain no drive
//! or reverb to turn. [`Wiring::search`] marks such a control; the instrument
//! then offers a structural variant in that direction instead of moving knobs
//! that do not do what the label says.
//!
//! ## The palette
//!
//! The six are the panel's ([`CONTROLS`]) and the first six of [`PALETTE`]'s
//! eighteen, six families of three (RFC-006 §4). Each of the twelve after them
//! is a direction of its own over φ, measured exactly like the six
//! ([`Engine::wire_named`]); its purity is the cosine inside the six axes'
//! span widened by its own direction ([`purity_basis`]). The Jacobian's
//! renders are shared, so wiring more controls costs arithmetic and only
//! their verification renders. `examples/palette_census.rs` in auracle-wasm
//! measures the definitions, their redundancy and their reach.
//!
//! ## Drift and offers
//!
//! [`Engine::drift`] samples the same Boltzmann target refinement uses,
//! `π_β ∝ p_grammar · exp(β·E[u])`, but with its own kernel: a local
//! Metropolis walk (a reflected Gaussian step, `sigma` from the Wander dial)
//! over the patch's [`live_knobs`] only. Everything else — structure,
//! categorical choices, sites without a live handle, the player's locks — is
//! held fixed, which is exact conditioning, so structure cannot change under
//! the player's hands. Nothing is inserted into the pool: a performance
//! gesture is not a candidate until the player keeps it.
//! [`Engine::offer`] is the same walk with only the player's locks, so it may
//! change structure; its result is heard through a crossfade, never a jump.

use std::collections::HashSet;
use std::sync::Arc;

use auracle_features::{featurize_memo, render_key, AudioFeatures, PhraseSpec, RenderMemo};
use auracle_grammar::edit::{set_param, ParamValue};
use auracle_grammar::term::{AudioNode, ModNode, Uid};
use auracle_grammar::PatchTree;
use auracle_grammar::{apply_struct_op, StructOp};
use auracle_taste::Standardizer;
use fugue_evo::genome::trace_genome::{ChoiceValue, TraceGenome};
use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::engine::{Engine, RefineOutcome};
use crate::surrogate::QUARANTINE_FITNESS;

/// The fitness of a taste model that has seen nothing: zero for every patch
/// that vets, quarantine for one that does not. Under it the Boltzmann target
/// is the grammar prior restricted to listenable patches, which is what the
/// posterior *is* before any evidence — so an offer or a drift made before the
/// first pick is exploration by the grammar, stated as such, rather than
/// nothing at all.
#[derive(Clone, Debug)]
pub struct VetOnlyFitness {
    /// The audition stimulus the vet is run under.
    pub phrase: PhraseSpec,
    /// The engine's featurization memo.
    pub memo: RenderMemo,
}

impl fugue_evo::fitness::traits::Fitness for VetOnlyFitness {
    type Genome = PatchTree;
    type Value = f64;

    fn evaluate(&self, genome: &PatchTree) -> f64 {
        match featurize_memo(genome, &self.phrase, &self.memo, false) {
            Ok(_) => 0.0,
            Err(_) => QUARANTINE_FITNESS,
        }
    }
}

/// Any fitness, tilted along a named control's direction in standardized
/// audio φ: a search control's offer walks
/// `π ∝ p_grammar · exp(β·(f(x) + γ·s·ê·z(x)))`, where `f` is the taste
/// surrogate (or [`VetOnlyFitness`] before a fit), `ê` the control's unit
/// direction, `s` the way it was turned and `γ` how hard to aim
/// ([`AIM_GAMMA`]).
///
/// Costs no render of its own: the inner fitness featurizes through the same
/// memo first, so the tilt's look at `z` is a memo hit. A proposal that does
/// not vet keeps the quarantine score untilted, and is not rendered twice.
#[derive(Clone, Debug)]
pub struct TiltedFitness<F> {
    /// The target being tilted: [`crate::SurrogateFitness`], or
    /// [`VetOnlyFitness`] before any taste has been fitted.
    pub inner: F,
    /// The standardizer the session's φ lives under.
    pub standardizer: Arc<Standardizer>,
    /// `ê`: the control's unit direction over [`AudioFeatures::NAMES`].
    pub direction: Vec<f64>,
    /// `+1` turned up (toward the control's high word), `−1` turned down.
    pub sign: f64,
    /// How hard to aim, in fitness per σ moved along `ê`.
    pub gamma: f64,
    /// The audition stimulus (the inner fitness's own).
    pub phrase: PhraseSpec,
    /// The engine's featurization memo, shared with `inner`.
    pub memo: RenderMemo,
}

impl<F> TiltedFitness<F> {
    /// The same tilt around another fitness.
    pub fn around<G>(self, inner: G) -> TiltedFitness<G> {
        TiltedFitness {
            inner,
            standardizer: self.standardizer,
            direction: self.direction,
            sign: self.sign,
            gamma: self.gamma,
            phrase: self.phrase,
            memo: self.memo,
        }
    }

    /// `ê · z(tree)`: where `tree` measures along the direction, in σ, or
    /// `None` if it does not vet.
    pub fn along(&self, tree: &PatchTree) -> Option<f64> {
        let z = audio_z(tree, &self.phrase, &self.memo, &self.standardizer)?;
        Some(dot(&self.direction, &z))
    }
}

impl<F> fugue_evo::fitness::traits::Fitness for TiltedFitness<F>
where
    F: fugue_evo::fitness::traits::Fitness<Genome = PatchTree, Value = f64>,
{
    type Genome = PatchTree;
    type Value = f64;

    fn evaluate(&self, genome: &PatchTree) -> f64 {
        let f = self.inner.evaluate(genome);
        if f <= QUARANTINE_FITNESS {
            return f;
        }
        match self.along(genome) {
            Some(a) => f + self.gamma * self.sign * a,
            None => f,
        }
    }
}

fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// Finite-difference step on a knob's normalized range. Large enough to move
/// φ past its numerical floor on a 5 s render, small enough to stay local;
/// the same step the `jacobian_probe` measurements used.
pub const JACOBIAN_STEP: f64 = 0.08;
/// Two reachable controls whose predicted movements are this collinear
/// (|cos| above it) are one gesture with two names; the later control in the
/// order they were wired in becomes a search control ([`separate`]).
pub const COLLINEAR: f64 = 0.8;
/// Ridge on the wiring solve, in the units of `z` per unit knob.
pub const RIDGE: f64 = 0.05;
/// Share of [`RIDGE`] a semantically named knob pays ([`NamedControl::sites`]).
/// In Bayesian terms the wiring is the posterior mean under a Gaussian prior
/// on the knob move, and a named knob's prior variance is `1 / 0.25 = 4×`
/// wider: it is *expected* to matter, but its sign still comes from the data.
pub const SEMANTIC_RIDGE: f64 = 0.25;
/// Most knobs one named control may move. Four carried a median 68% of a
/// preset's audible leverage (`leverage_probe`); more makes a control that
/// is hard to hear as one gesture.
pub const MAX_KNOBS: usize = 4;
/// Largest share of a knob's range a full turn of a named control may move it.
pub const MAX_TRAVEL: f64 = 0.5;
/// Largest value [`apply`] writes. fugue's `Uniform(0, 1)` is half-open, so a
/// knob at exactly 1.0 has log-prior −∞ and makes the patch un-evolvable; a
/// performance gesture must never be the thing that does that.
pub const KNOB_MAX: f64 = 1.0 - 1.0e-6;
/// Below this purity a control is a *search* control on this patch.
pub const PURITY_FLOOR: f64 = 0.35;
/// Largest reversal, in σ of the session's spread, the performance gate
/// tolerates between verified points — two orders of magnitude under any
/// audible difference, and above the numerical noise of a 5 s render.
pub const MONO_TOL: f64 = 0.05;
/// Below this reach (σ of the named direction at a full turn) likewise. The
/// σ is the session pool's spread, which is wider than a curated library's,
/// so a floor set against the presets (0.25σ) hid controls that are plainly
/// audible on a live patch.
pub const REACH_FLOOR: f64 = 0.15;
/// How hard a search control's offer aims along the control's direction: γ
/// in [`TiltedFitness`]'s target, in fitness per σ moved. At β = 2 a proposal
/// one σ further the asked way gains `2γ` of log-weight. Chosen by census
/// (`make offer-census`; the table is in the reference's PERFORM page).
pub const AIM_GAMMA: f64 = 1.0;
/// Most walks one aimed offer may take: a walk of the asked steps that has not
/// yet moved the asked way by [`REACH_FLOOR`] keeps walking from where it
/// stopped, up to this many times ([`Engine::offer_toward`]). Chosen by the
/// same census.
pub const AIM_WALKS: usize = 3;

/// A named performance control: a fixed direction in audio-φ.
#[derive(Clone, Copy, Debug)]
pub struct NamedControl {
    /// The control's name, the same on every patch.
    pub name: &'static str,
    /// The palette family it is listed under (RFC-006 §4): Tone, Weight,
    /// Dynamics, Movement, Space or Character.
    pub family: &'static str,
    /// What the low end of the control sounds like.
    pub low: &'static str,
    /// What the high end sounds like.
    pub high: &'static str,
    /// The direction, as `(audio φ name without its stimulus tag, weight)`.
    pub axis: &'static [(&'static str, f64)],
    /// Knob sites a musician would reach for to do this, by trace site name
    /// (`cut`, `attack`, `rmix`, …). A prior, not a mapping: these knobs get a
    /// wider prior in the wiring solve ([`SEMANTIC_RIDGE`]), so where the
    /// measurement is ambiguous the knob that says what it does wins — and
    /// where the measurement disagrees, it does not.
    pub sites: &'static [&'static str],
}

const BRIGHT: NamedControl = NamedControl {
    name: "Bright",
    family: "Tone",
    low: "dark",
    high: "bright",
    axis: &[("centroid_mean", 1.0), ("rolloff_mean", 1.0)],
    sites: &[
        "cut", "bright", "tone", "high", "thresh", "drive", "morph", "vowel",
    ],
};
const SNAP: NamedControl = NamedControl {
    name: "Snap",
    family: "Dynamics",
    low: "bloom",
    high: "snap",
    axis: &[("attack_s", -1.0), ("crest", 1.0)],
    sites: &["attack", "att", "decay", "dec", "sustain"],
};
const MOTION: NamedControl = NamedControl {
    name: "Motion",
    family: "Movement",
    low: "still",
    high: "restless",
    axis: &[
        ("held_centroid_std", 1.0),
        ("motion_slow", 1.0),
        ("motion_mid", 1.0),
        ("motion_fast", 1.0),
    ],
    sites: &[
        "mdepth", "rate", "crate", "cdepth", "prate", "pdepth", "trate", "tdepth", "vrate",
        "vdepth", "frate", "fdepth", "erate", "hrate", "glide",
    ],
};
const BODY: NamedControl = NamedControl {
    name: "Body",
    family: "Weight",
    low: "thin",
    high: "full",
    axis: &[("bass_fraction", 1.0)],
    sites: &["det", "smix", "low", "bal", "cut"],
};
const GRIT: NamedControl = NamedControl {
    name: "Grit",
    family: "Character",
    low: "smooth",
    high: "rough",
    axis: &[("flatness_mean", 1.0)],
    sites: &["drive", "bits", "dsamp", "thresh", "res"],
};
const SPACE: NamedControl = NamedControl {
    name: "Space",
    family: "Space",
    low: "close",
    high: "far",
    axis: &[("tail_ratio", 1.0)],
    sites: &["rmix", "rsize", "rdamp", "time", "fb", "dmix", "release"],
};

/// The six measured controls, in panel order. Blend and Wander are not
/// directions in φ and live in the instrument, not here. These are the
/// [`PALETTE`]'s first six, at the same indices, and the set PERFORM wires
/// unless asked for others ([`Engine::wire_named`]).
pub const CONTROLS: [NamedControl; 6] = [BRIGHT, SNAP, MOTION, BODY, GRIT, SPACE];

// The palette's twelve. Each is its own direction over φ's coordinates, chosen
// for what the name means to a player and measured against the six by
// `examples/palette_census.rs` in auracle-wasm (the reference's PERFORM page
// has the tables). The prototype's blends of the six were tried first, and
// five pairs of them sat at |cos| ≥ 0.9 (Air +0.94 to Bright, Softness −0.94
// to Snap, Wobble +0.99 to Motion, Distance +0.92 to Space, and Warmth −0.94
// to Air): two names for one control. No pair of these eighteen does.

/// Weight low down and a soft upper register: `bass_fraction` up and
/// `high_ratio` down (the highest note comes through quieter than the held
/// one, as under a low-pass that does not follow the keys). φ has no low-mid
/// band. Defined with the spectrum's top instead (−rolloff, or −rolloff and
/// −zcr, with bass), Warmth moved with Body across the presets and the pool
/// (r 0.92) and on most presets wired to Bright's gesture turned down.
const WARMTH: NamedControl = NamedControl {
    name: "Warmth",
    family: "Tone",
    low: "cold",
    high: "warm",
    axis: &[("bass_fraction", 1.0), ("high_ratio", -1.0)],
    sites: &["cut", "tone", "high", "low", "bright", "smix"],
};
/// The very top, above the notes: the zero-crossing rate (the highest
/// partials and any breath or hiss) and the rolloff, measured against the
/// centroid, so the top opens while the body of the sound stays where it is.
/// Bright moves all three together; the prototype's Air (mostly Bright) was
/// +0.94 to it.
const AIR: NamedControl = NamedControl {
    name: "Air",
    family: "Tone",
    low: "closed",
    high: "airy",
    axis: &[
        ("zcr_mean", 1.0),
        ("rolloff_mean", 0.5),
        ("centroid_mean", -0.5),
    ],
    sites: &["high", "cut", "res", "bright", "tone", "vowel"],
};
/// Weight low down that hits: `bass_fraction` and `crest` (a peak well above
/// the sound's average level).
const THUMP: NamedControl = NamedControl {
    name: "Thump",
    family: "Weight",
    low: "light",
    high: "thumping",
    axis: &[("bass_fraction", 1.0), ("crest", 1.0)],
    sites: &["smix", "low", "bal", "attack", "decay", "dec", "sustain"],
};
/// Dense, held weight: `rms_mean` (each frame full of level, which loudness
/// normalization gives a sound that is sustained and low, since K-weighting
/// counts the lows for less) and `bass_fraction`. The twelfth control, the
/// Weight family's third: the opposite of a light pluck, not of a dark one.
/// With −crest in it as well, it was Thump turned down on two presets in
/// three (both turned the amp envelope, opposite ways).
const HEFT: NamedControl = NamedControl {
    name: "Heft",
    family: "Weight",
    low: "slight",
    high: "heavy",
    axis: &[("rms_mean", 1.0), ("bass_fraction", 1.0)],
    sites: &[
        "sustain", "decay", "release", "drive", "smix", "low", "ratio", "makeup",
    ],
};
/// Hits that stand out and fall away: `crest` and `rms_std` (the level moving
/// over the phrase). Snap is the attack's speed; Punch is the size of the hit
/// against the rest. The prototype's Punch was +0.89 to Snap.
const PUNCH: NamedControl = NamedControl {
    name: "Punch",
    family: "Dynamics",
    low: "gentle",
    high: "punchy",
    axis: &[("crest", 1.0), ("rms_std", 1.0)],
    sites: &["decay", "dec", "sustain", "attack", "att"],
};
/// A soft attack and few harmonics, the voice's "round": `attack_s` up and
/// `rolloff_mean` down. The prototype's Softness (−0.8 Snap, −0.3 Bright) was
/// −0.94 to Snap: Snap turned down under another name.
const ROUND: NamedControl = NamedControl {
    name: "Round",
    family: "Dynamics",
    low: "hard",
    high: "round",
    axis: &[("attack_s", 1.0), ("rolloff_mean", -1.0)],
    sites: &["attack", "att", "cut", "tone", "bright", "high"],
};
/// Pulsing and tremolo: the held note's motion in the 2–8 Hz band alone.
/// Motion is all four motion coordinates; the prototype's Wobble was +0.99 to
/// it.
const THROB: NamedControl = NamedControl {
    name: "Throb",
    family: "Movement",
    low: "steady",
    high: "throbbing",
    axis: &[("motion_mid", 1.0)],
    sites: &[
        "rate", "mdepth", "trate", "tdepth", "vrate", "vdepth", "crate", "cdepth", "prate",
        "pdepth", "frate", "fdepth", "erate",
    ],
};
/// Sweeps and breathing: the held note's motion in the 0.5–2 Hz band alone.
const SWAY: NamedControl = NamedControl {
    name: "Sway",
    family: "Movement",
    low: "fixed",
    high: "swaying",
    axis: &[("motion_slow", 1.0)],
    sites: &[
        "rate", "mdepth", "prate", "pdepth", "crate", "cdepth", "frate", "fdepth", "glide",
    ],
};
/// What distance does to a sound: a longer tail, a softer attack, smaller
/// peaks and a duller top (`tail_ratio` and, at half weight, `attack_s`,
/// −`crest` and −`rolloff_mean`). The prototype's Distance was +0.92 to
/// Space.
const DISTANCE: NamedControl = NamedControl {
    name: "Distance",
    family: "Space",
    low: "near",
    high: "distant",
    axis: &[
        ("tail_ratio", 1.0),
        ("attack_s", 0.5),
        ("crest", -0.5),
        ("rolloff_mean", -0.5),
    ],
    sites: &[
        "rmix", "rsize", "rdamp", "release", "dmix", "time", "fb", "cut", "attack",
    ],
};
/// A wash: a longer tail, a shimmer (`motion_fast`, the 8–30 Hz beating that
/// detune and chorus give) and peaks smoothed away (−`crest`).
const HAZE: NamedControl = NamedControl {
    name: "Haze",
    family: "Space",
    low: "clear",
    high: "hazy",
    axis: &[("tail_ratio", 1.0), ("motion_fast", 1.0), ("crest", -1.0)],
    sites: &[
        "rmix", "rsize", "release", "cmix", "cdepth", "crate", "det", "dmix", "fb",
    ],
};
/// An edge: the spectrum changing fast (`flux_mean`) and high partials
/// (`zcr_mean`). Grit is noise (flatness); Bite is bright change, a filter
/// that snaps open or a resonance that rings.
const BITE: NamedControl = NamedControl {
    name: "Bite",
    family: "Character",
    low: "mild",
    high: "biting",
    axis: &[("flux_mean", 1.0), ("zcr_mean", 1.0)],
    sites: &["res", "cut", "drive", "thresh", "att", "dec", "mdepth"],
};
/// Worn like tape: hiss (`flatness_mean`), a dull top (−`rolloff_mean`) and
/// flutter (`motion_fast`). φ has no bit-depth or bandwidth feature, so a
/// crusher is heard only through the flatness it adds.
const LOFI: NamedControl = NamedControl {
    name: "Lo-fi",
    family: "Character",
    low: "clean",
    high: "worn",
    axis: &[
        ("flatness_mean", 1.0),
        ("rolloff_mean", -1.0),
        ("motion_fast", 1.0),
    ],
    sites: &["bits", "dsamp", "cut", "drive", "tone", "vdepth", "vrate"],
};

/// The palette: eighteen controls in six families (RFC-006 §4), each a fixed
/// direction in standardized audio φ measured and wired per patch exactly as
/// the six are. The first six are [`CONTROLS`], at the same indices, so an
/// index into either names the same control; the twelve after them follow
/// in family order.
pub const PALETTE: [NamedControl; 18] = [
    BRIGHT, SNAP, MOTION, BODY, GRIT, SPACE, WARMTH, AIR, THUMP, HEFT, PUNCH, ROUND, THROB, SWAY,
    DISTANCE, HAZE, BITE, LOFI,
];

/// The [`PALETTE`] entries `set` names, in its order: indices out of range
/// and repeats are dropped, so every control is wired once.
pub fn palette_controls(set: &[usize]) -> Vec<NamedControl> {
    let mut seen = [false; PALETTE.len()];
    set.iter()
        .filter_map(|&k| {
            let fresh = !std::mem::replace(seen.get_mut(k)?, true);
            fresh.then_some(PALETTE[k])
        })
        .collect()
}

/// `∂z/∂p` for one patch: how each continuous knob moves each standardized
/// audio coordinate.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Jacobian {
    /// Knob addresses, column order.
    pub addrs: Vec<String>,
    /// The knobs' current normalized values.
    pub values: Vec<f64>,
    /// Audio φ names (with their stimulus tag), row order.
    pub names: Vec<String>,
    /// The patch's own standardized audio φ.
    pub z: Vec<f64>,
    /// One column per knob: `∂z/∂p`, per unit of normalized knob travel.
    pub cols: Vec<Vec<f64>>,
}

/// How one named control is wired on one patch.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Wiring {
    /// The control's name.
    pub name: String,
    /// Low-end word.
    pub low: String,
    /// High-end word.
    pub high: String,
    /// `(address, knob travel at a full turn)`; add `c ×` this to each knob.
    pub knobs: Vec<(String, f64)>,
    /// How much of the predicted movement is this control rather than the
    /// **other named controls**: the cosine with the control's axis within
    /// the subspace the six named axes span. 1 moves none of the others;
    /// the search gate reads it ([`PURITY_FLOOR`]).
    pub purity: f64,
    /// Predicted movement along the named axis at a full turn, in σ.
    pub reach: f64,
    /// Where the patch measures on this axis now, in σ.
    pub position: f64,
    /// True when the knobs cannot honestly produce this control, and turning
    /// it should ask for a structural offer instead.
    pub search: bool,
    /// Measured movement along the axis at `c = +1`, in σ, from a real render
    /// (see [`verify`]). `None` until verified.
    #[serde(default)]
    pub up: Option<f64>,
    /// Measured movement along the axis at `c = −1`, in σ (positive means the
    /// sound moved toward the low word, as asked).
    #[serde(default)]
    pub down: Option<f64>,
    /// The predicted φ movement per unit turn, unit length — kept only to
    /// tell two controls apart ([`separate`]); not sent to the page.
    #[serde(skip, default)]
    pub moved: Vec<f64>,
    /// The control's unit direction the wiring was solved for, kept so
    /// [`verify`] projects on the same axis whichever controls were wired;
    /// not sent to the page. Empty on a wiring read back from JSON, which
    /// verification then leaves alone.
    #[serde(skip, default)]
    pub axis: Vec<f64>,
}

impl Wiring {
    /// The range of control values this wiring honestly supports: a half the
    /// verification did not confirm is closed. An unverified wiring is taken
    /// at the Jacobian's word.
    pub fn range(&self) -> (f64, f64) {
        if self.search {
            return (0.0, 0.0);
        }
        let ok = |m: Option<f64>| m.is_none_or(|v| v >= REACH_FLOOR * 0.5);
        (
            if ok(self.down) { -1.0 } else { 0.0 },
            if ok(self.up) { 1.0 } else { 0.0 },
        )
    }
}

/// The unit direction for `control` over `names` (tagged φ names).
pub fn direction(control: &NamedControl, names: &[String]) -> Vec<f64> {
    let mut d: Vec<f64> = names
        .iter()
        .map(|n| {
            let bare = n.split(':').next().unwrap_or(n);
            control
                .axis
                .iter()
                .find(|(a, _)| *a == bare)
                .map_or(0.0, |(_, w)| *w)
        })
        .collect();
    let norm = d.iter().map(|x| x * x).sum::<f64>().sqrt();
    if norm > 0.0 {
        d.iter_mut().for_each(|x| *x /= norm);
    }
    d
}

/// The subspace a control's purity is measured in, as an orthonormal basis
/// with the control's unit direction `d` first: `d` and the six named axes
/// ([`CONTROLS`]), Gram–Schmidt in that order.
///
/// For one of the six, `d` is its own axis and the other five are already
/// orthogonal to it (no two share a coordinate), so they enter unchanged and
/// purity is exactly what it always was: the cosine with `d` inside the six
/// axes' span. A palette control that blends the six (Thump is Body with some
/// Snap) lies inside that span, so the axes it leans on are taken up by `d`
/// and only their remainders count against it. A control with a coordinate
/// of its own (Air's zero-crossing rate) widens the span by that much. In
/// every case a move along the control's own direction has purity 1, and a
/// move along a named axis it does not lean on counts against it in full.
pub fn purity_basis(d: &[f64], names: &[String]) -> Vec<Vec<f64>> {
    let mut basis = vec![d.to_vec()];
    for c in &CONTROLS {
        let a = direction(c, names);
        let proj: Vec<f64> = basis.iter().map(|b| dot(b, &a)).collect();
        // Exactly orthogonal already (disjoint coordinates): kept as it is,
        // so the six's purity is bit-for-bit what it was before the palette.
        if proj.iter().all(|p| *p == 0.0) {
            basis.push(a);
            continue;
        }
        let mut r = a;
        for (b, p) in basis.iter().zip(&proj) {
            r.iter_mut().zip(b).for_each(|(x, y)| *x -= p * y);
        }
        let n = r.iter().map(|x| x * x).sum::<f64>().sqrt();
        if n > 1e-9 {
            r.iter_mut().for_each(|x| *x /= n);
            basis.push(r);
        }
    }
    basis
}

/// The module PERFORM grafts onto the output of a patch whose knobs cannot
/// reach control `k` ([`PALETTE`] order), so the control has something to
/// turn: a neutral EQ, for Bright and Body. At 0 dB on all three bands it is
/// transparent, and its high and low shelves are the knobs a player would
/// name for either. `examples/perform_inserts.rs` measures both claims.
///
/// `None` for everything else, each of the six for a measured reason (the
/// palette's twelve have no graft measured yet):
///
/// * **Snap, Motion** — no single module answers them.
/// * **Grit** — its axis is spectral flatness, and a drive adds harmonics
///   (which is Bright), not noise. A crusher is transparent only at 16 bits,
///   where its slope is zero so the local measurement cannot see it, and it
///   clips anything hotter than its ±5 V window.
/// * **Space** — every effect sits before the voice's amp envelope, so a
///   reverb's tail is cut at note-off: on First Bass with a reverb grafted,
///   ∂(Space)/∂mix measured −0.04 and ∂/∂release +3.65. What gives a patch
///   space here is its release, which [`graft_for`] lengthens instead.
///
/// The fragment's input is a placeholder; `StructOp::InsertTree` replaces it
/// with the patch it wraps.
pub fn insert_for(k: usize) -> Option<AudioNode> {
    match PALETTE.get(k)?.name {
        "Bright" | "Body" => Some(AudioNode::Eq {
            uid: Uid::NEW,
            low: 0.5,
            mid: 0.5,
            high: 0.5,
            mod_depth: 0.0,
            modulation: ModNode::None,
            input: Box::new(AudioNode::Silence { uid: Uid::NEW }),
        }),
        _ => None,
    }
}

/// `tree` changed so named control `k` has something to turn, or `None`:
/// Bright and Body get [`insert_for`]'s EQ on the output, below any stereo
/// effect that ends the chain (unless the patch
/// already has one, or it would break the size ceilings); Space gets its amp
/// release brought up to [`SPACE_RELEASE`] (unless it is already there).
/// Space is only grafted when turned up, so the longer release is what was
/// asked for; the EQ is transparent in either direction.
pub fn graft_for(tree: &PatchTree, k: usize) -> Option<PatchTree> {
    if PALETTE.get(k)?.name == "Space" {
        if tree.amp.release >= SPACE_RELEASE {
            return None;
        }
        let mut t = tree.clone();
        t.amp.release = SPACE_RELEASE;
        return Some(t);
    }
    let node = insert_for(k)?;
    let same = |n: &AudioNode| std::mem::discriminant(n) == std::mem::discriminant(&node);
    fn any(n: &AudioNode, f: &dyn Fn(&AudioNode) -> bool) -> bool {
        f(n) || n.children().into_iter().any(|c| any(c, f))
    }
    if any(&tree.root, &same) {
        return None;
    }
    // Below any stereo tail, not after it: the EQ is mono, and grafted onto
    // a reverb or chorus at the output it folded the patch to one channel
    // (Ghost Bell moved 0.27σ). The stereo modules have one input, at `/0`.
    let mut key = String::from("node");
    let mut n = &tree.root;
    while matches!(
        n,
        AudioNode::Reverb { .. }
            | AudioNode::Chorus { .. }
            | AudioNode::Phaser { .. }
            | AudioNode::Flanger { .. }
    ) {
        n = n.children()[0];
        key.push_str("/0");
    }
    apply_struct_op(tree, &StructOp::InsertTree { key, node }).ok()
}

/// The amp release a Space graft brings a patch up to: a ≈250 ms time
/// constant (`1 ms·10000^x`), long enough for a tail to exist.
pub const SPACE_RELEASE: f64 = 0.6;

/// The continuous knobs of `tree`, as `(address, value)` in trace order.
pub fn continuous_knobs(tree: &PatchTree) -> Vec<(String, f64)> {
    tree.to_trace()
        .choices
        .iter()
        .filter_map(|(a, c)| match c.value {
            ChoiceValue::F64(v) => Some((a.to_string(), v)),
            _ => None,
        })
        .collect()
}

/// The continuous knobs of `tree` the voices can take **live**, as
/// `(address, value)` in trace order: those the compiler gave a
/// [`ParamHandle`](auracle_grammar::ParamHandle). Not every continuous site
/// has one — a modulation depth with no modulator compiles to nothing, and a
/// value the compiler bakes into a constant has no atomic to write — and a
/// performance surface must only ever turn knobs it can turn without a
/// recompile. Writing one without a handle is a miss, and the app answers a
/// miss by reloading the patch: mid-phrase, that is a dropout and every
/// pending offer lost. Empty if the tree does not compile.
pub fn live_knobs(tree: &PatchTree, sample_rate: f64) -> Vec<(String, f64)> {
    let Ok(voice) = auracle_grammar::compile(tree, sample_rate) else {
        return Vec::new();
    };
    continuous_knobs(tree)
        .into_iter()
        .filter(|(a, _)| voice.params.contains_key(a))
        .collect()
}

/// Every address of `tree` that is **not** a continuous knob: structure and
/// categorical choices. Locking these makes a walk knob-only.
pub fn structural_addrs(tree: &PatchTree) -> Vec<String> {
    tree.to_trace()
        .choices
        .iter()
        .filter(|(_, c)| !matches!(c.value, ChoiceValue::F64(_)))
        .map(|(a, _)| a.to_string())
        .collect()
}

/// Standardized audio φ from a featurization's raw features: the `z` every
/// measurement starts from (and the one `apps/web/perform-wirings.json`
/// records per preset, which is why it is public).
pub fn standardized_audio(features: &auracle_features::Features, std: &Standardizer) -> Vec<f64> {
    features
        .audio
        .to_vec()
        .iter()
        .enumerate()
        .map(|(i, x)| (x - std.mean[i]) / std.std[i])
        .collect()
}

/// Standardized audio φ of `tree`, or `None` if it does not vet.
fn audio_z(
    tree: &PatchTree,
    spec: &PhraseSpec,
    memo: &RenderMemo,
    std: &Standardizer,
) -> Option<Vec<f64>> {
    let (cf, _) = featurize_memo(tree, spec, memo, false).ok()?;
    Some(standardized_audio(&cf.features, std))
}

/// What a measurement knows about one tree's standardized audio φ.
///
/// A measurement ([`jacobian`] then [`verify`]) is thirty-odd renders, each a
/// pure function of one tree, and it used to be one synchronous call of 10–30
/// s on the engine's only thread — in front of every ▶, bench open and ⌘Z the
/// player made meanwhile. Asking through a lookup instead of rendering inline
/// lets the same code do three jobs: **measure** (render on a miss, exactly
/// what it always did), **plan** (a miss is written down as a render still
/// owed, and nothing is rendered), and **finish** a measurement whose renders
/// were made elsewhere — in chunks between the player's requests, or on the
/// render farm — and are now in the memo. The numbers are the same in all
/// three, because the arithmetic below never sees which one it is in.
pub(crate) enum Look {
    /// Measured.
    Z(Vec<f64>),
    /// Does not vet (or does not build): the measurement treats it exactly as
    /// the rendering path always treated a failed render.
    Fails,
    /// Not measured yet. Only a plan ever answers this.
    Pending,
}

/// The rendering lookup: memo first, render on a miss.
fn rendered(tree: &PatchTree, spec: &PhraseSpec, memo: &RenderMemo, std: &Standardizer) -> Look {
    match audio_z(tree, spec, memo, std) {
        Some(z) => Look::Z(z),
        None => Look::Fails,
    }
}

/// Measure the audio Jacobian of `tree` by one-sided finite differences,
/// stepping each knob toward the interior of its range. `n + 1` renders for
/// `n` knobs, all through the memo. Knobs whose nudge fails to vet get a zero
/// column: the wiring then simply cannot use them.
///
/// `std` must be the standardizer the session's φ lives under; the audio
/// coordinates are the first [`AudioFeatures::NAMES`] entries of it.
pub fn jacobian(
    tree: &PatchTree,
    spec: &PhraseSpec,
    memo: &RenderMemo,
    std: &Standardizer,
) -> Option<Jacobian> {
    jacobian_by(tree, spec.sample_rate, &mut |t| {
        rendered(t, spec, memo, std)
    })
    .ok()
    .flatten()
}

/// [`jacobian`] through a lookup. `Err(())` means some render is still
/// [`Look::Pending`] — every one of them has been asked for by then, the
/// patch's own and each knob's nudge alike, since none depends on another's
/// result. `Ok(None)` is a patch that does not vet, as before.
pub(crate) fn jacobian_by(
    tree: &PatchTree,
    sample_rate: f64,
    look: &mut dyn FnMut(&PatchTree) -> Look,
) -> Result<Option<Jacobian>, ()> {
    // A patch that does not vet has no Jacobian, and its nudges are never
    // rendered — the order the rendering path has always had.
    let base = look(tree);
    if matches!(base, Look::Fails) {
        return Ok(None);
    }
    let mut pending = matches!(base, Look::Pending);
    let knobs = live_knobs(tree, sample_rate);
    let mut nudged = Vec::with_capacity(knobs.len());
    for (addr, v) in &knobs {
        let h = if *v < 0.5 {
            JACOBIAN_STEP
        } else {
            -JACOBIAN_STEP
        };
        let zn = match set_param(tree, addr, ParamValue::Continuous(v + h)) {
            Ok(t) => match look(&t) {
                Look::Z(zn) => Some(zn),
                Look::Fails => None,
                Look::Pending => {
                    pending = true;
                    None
                }
            },
            Err(_) => None,
        };
        nudged.push((h, zn));
    }
    let z = match base {
        Look::Z(z) if !pending => z,
        _ => return Err(()),
    };
    let cols = nudged
        .into_iter()
        .map(|(h, zn)| match zn {
            Some(zn) => zn.iter().zip(&z).map(|(a, b)| (a - b) / h).collect(),
            None => vec![0.0; z.len()],
        })
        .collect();
    Ok(Some(Jacobian {
        addrs: knobs.iter().map(|(a, _)| a.clone()).collect(),
        values: knobs.iter().map(|(_, v)| *v).collect(),
        names: AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect(),
        z,
        cols,
    }))
}

/// Solve the symmetric positive-definite system `M x = b` (Gaussian
/// elimination with partial pivoting; the systems here are at most a few
/// dozen square).
fn solve(mut m: Vec<Vec<f64>>, mut b: Vec<f64>) -> Vec<f64> {
    let n = b.len();
    for c in 0..n {
        let p = (c..n)
            .max_by(|&i, &j| m[i][c].abs().total_cmp(&m[j][c].abs()))
            .unwrap_or(c);
        m.swap(c, p);
        b.swap(c, p);
        let piv = m[c][c];
        if piv.abs() < 1e-12 {
            continue;
        }
        let pivot_row = m[c].clone();
        for r in (c + 1)..n {
            let f = m[r][c] / piv;
            if f == 0.0 {
                continue;
            }
            for (x, p) in m[r][c..].iter_mut().zip(&pivot_row[c..]) {
                *x -= f * p;
            }
            b[r] -= f * b[c];
        }
    }
    let mut x = vec![0.0; n];
    for c in (0..n).rev() {
        let s: f64 = ((c + 1)..n).map(|k| m[c][k] * x[k]).sum();
        x[c] = if m[c][c].abs() < 1e-12 {
            0.0
        } else {
            (b[c] - s) / m[c][c]
        };
    }
    x
}

/// Weighted ridge least squares over the columns in `support`:
/// `(AᵀA + λ·diag(w))⁻¹ Aᵀ d`, with `w` the per-column penalty share.
fn ridge(cols: &[Vec<f64>], support: &[usize], d: &[f64], w: &[f64]) -> Vec<f64> {
    let k = support.len();
    let mut m = vec![vec![0.0; k]; k];
    let mut b = vec![0.0; k];
    for (i, &ci) in support.iter().enumerate() {
        b[i] = cols[ci].iter().zip(d).map(|(a, x)| a * x).sum();
        for (j, &cj) in support.iter().enumerate() {
            m[i][j] = cols[ci].iter().zip(&cols[cj]).map(|(a, x)| a * x).sum();
        }
        m[i][i] += RIDGE * w[ci];
    }
    solve(m, b)
}

/// Wire every [`CONTROLS`] entry onto the patch `jac` was measured on.
pub fn wire(jac: &Jacobian) -> Vec<Wiring> {
    wire_with(jac, SEMANTIC_RIDGE)
}

/// [`wire`] with the semantic prior's penalty share given explicitly: 1.0 is
/// no prior at all. For measuring what the prior costs and buys.
pub fn wire_with(jac: &Jacobian, semantic: f64) -> Vec<Wiring> {
    wire_named(jac, &CONTROLS, semantic)
}

/// Wire `controls` (any of the [`PALETTE`], or a direction being tried out)
/// onto the patch `jac` was measured on, in their order, then [`separate`]
/// them in that order. Arithmetic only: the Jacobian's renders are shared by
/// every control, so wiring eighteen costs no more renders than wiring six.
/// What does cost renders is [`verify`], four or eight per reachable control.
pub fn wire_named(jac: &Jacobian, controls: &[NamedControl], semantic: f64) -> Vec<Wiring> {
    let mut w: Vec<Wiring> = controls
        .iter()
        .map(|c| wire_one(c, jac, semantic))
        .collect();
    separate(&mut w);
    w
}

/// Make sure no two reachable controls are the same gesture. When a later
/// control's predicted movement is within [`COLLINEAR`] of an earlier one's
/// (either sign), it cannot honestly claim a direction of its own on this
/// patch and becomes a search control. (Found when a pattern-aimed variant
/// of the wiring put Bright and Body onto the same knobs with opposite signs
/// on 2 of 12 fresh-pool patches; the guard costs nothing where they differ.)
pub fn separate(wiring: &mut [Wiring]) {
    for j in 0..wiring.len() {
        if wiring[j].search || wiring[j].moved.is_empty() {
            continue;
        }
        let clash = (0..j).any(|i| {
            !wiring[i].search
                && wiring[i].moved.len() == wiring[j].moved.len()
                && wiring[i]
                    .moved
                    .iter()
                    .zip(&wiring[j].moved)
                    .map(|(a, b)| a * b)
                    .sum::<f64>()
                    .abs()
                    > COLLINEAR
        });
        if clash {
            wiring[j].search = true;
        }
    }
}

/// Wire `control`, preferring the knobs a musician would name for it.
///
/// First the solve is restricted to the control's own sites
/// ([`NamedControl::sites`]); if that wiring clears the gate it is the one
/// used, because a player who turns Bright and watches the cutoff move has
/// learned something true about the patch, and one who watches the amp
/// release move has learned nothing. Only when the named knobs cannot do it
/// honestly does the solve range over every live knob — which is how Bright
/// ended up on Acid Line's attack and release. `semantic` is kept as the
/// soft prior inside the unrestricted solve.
fn wire_one(control: &NamedControl, jac: &Jacobian, semantic: f64) -> Wiring {
    let named: Vec<usize> = jac
        .addrs
        .iter()
        .enumerate()
        .filter(|(_, a)| control.sites.contains(&a.rsplit('#').next().unwrap_or(a)))
        .map(|(i, _)| i)
        .collect();
    if !named.is_empty() && named.len() < jac.addrs.len() {
        let w = wire_over(control, jac, semantic, &named);
        if !w.search {
            return w;
        }
    }
    let all: Vec<usize> = (0..jac.cols.len()).collect();
    wire_over(control, jac, semantic, &all)
}

fn wire_over(control: &NamedControl, jac: &Jacobian, semantic: f64, all: &[usize]) -> Wiring {
    let d = direction(control, &jac.names);
    let position: f64 = d.iter().zip(&jac.z).map(|(a, b)| a * b).sum();
    let n = jac.cols.len();
    let mut out = Wiring {
        name: control.name.into(),
        low: control.low.into(),
        high: control.high.into(),
        knobs: Vec::new(),
        purity: 0.0,
        reach: 0.0,
        position,
        search: true,
        up: None,
        down: None,
        moved: Vec::new(),
        axis: d.clone(),
    };
    if n == 0 || all.is_empty() {
        return out;
    }
    let w: Vec<f64> = jac
        .addrs
        .iter()
        .map(|a| {
            let site = a.rsplit('#').next().unwrap_or(a);
            if control.sites.contains(&site) {
                semantic
            } else {
                1.0
            }
        })
        .collect();
    let x_sub = ridge(&jac.cols, all, &d, &w);
    let mut x = vec![0.0; n];
    for (&i, v) in all.iter().zip(&x_sub) {
        x[i] = *v;
    }
    // Rank by *effect* — coefficient times how much the knob moves φ at all —
    // not by coefficient, and let only the knobs that do real work set the
    // travel scale. A knob that barely moves the sound needs a large
    // coefficient to contribute anything; ranked by coefficient it headed the
    // support, and scaled so the largest coefficient got MAX_TRAVEL it gave
    // the knob doing the work a sliver of a turn. Iron Bass: Bright wired to
    // drive (|∂z| 0.15 per unit) at +0.50 and its cutoff (|∂z| 5.2, +4σ of
    // centroid per unit) barely moved: 0.03σ of reach. Weak knobs are kept —
    // Motion leans on several small ones together, and dropping them cost it
    // a sixth of its patches — but clamped at MAX_TRAVEL instead of setting
    // the scale. (Letting any knob with a quarter of the top effect set it
    // still held Iron Bass's Bright to 0.56σ, via the distortion's tone.)
    let col_norm: Vec<f64> = jac
        .cols
        .iter()
        .map(|c| c.iter().map(|v| v * v).sum::<f64>().sqrt())
        .collect();
    let effect = |i: usize, xi: f64| xi.abs() * col_norm[i];
    let mut support: Vec<usize> = all.to_vec();
    support.sort_by(|&a, &b| effect(b, x[b]).total_cmp(&effect(a, x[a])));
    support.truncate(MAX_KNOBS);
    support.retain(|&i| x[i].abs() > 1e-9);
    if support.is_empty() {
        return out;
    }
    let xs = ridge(&jac.cols, &support, &d, &w);
    // The knob with the largest effect gets the full MAX_TRAVEL; the rest
    // follow in proportion and clamp there.
    let peak = support
        .iter()
        .zip(&xs)
        .max_by(|(&i, &a), (&j, &b)| effect(i, a).total_cmp(&effect(j, b)))
        .map_or(0.0, |(_, v)| v.abs());
    let alpha = MAX_TRAVEL / peak.max(1e-12);
    let travel: Vec<f64> = xs
        .iter()
        .map(|v| (alpha * v).clamp(-MAX_TRAVEL, MAX_TRAVEL))
        .collect();
    // The φ movement this wiring predicts at a full turn.
    let m = jac.names.len();
    let mut moved = vec![0.0; m];
    for (i, &ci) in support.iter().enumerate() {
        for (mv, j) in moved.iter_mut().zip(&jac.cols[ci]) {
            *mv += j * travel[i];
        }
    }
    let along: f64 = moved.iter().zip(&d).map(|(a, b)| a * b).sum();
    let norm = moved.iter().map(|v| v * v).sum::<f64>().sqrt();
    if norm <= 1e-12 || along <= 0.0 {
        return out;
    }
    // Purity is measured where cross-talk is heard: against the other named
    // axes. A real brightening also raises the zero-crossing rate and the
    // high band, and against the full φ those correlates read as impurity
    // (Bright's median cosine with its own axis over a fresh pool is 0.26);
    // what a player hears as "this control does something else" is a move
    // along *another control's* axis — attack when asked for bright.
    let off: f64 = purity_basis(&d, &jac.names)
        .iter()
        .skip(1)
        .map(|b| {
            b.iter()
                .zip(&moved)
                .map(|(x, y)| x * y)
                .sum::<f64>()
                .powi(2)
        })
        .sum();
    out.purity = along / (along * along + off).sqrt().max(1e-12);
    out.moved = moved.iter().map(|v| v / norm).collect();
    out.reach = along;
    out.knobs = support
        .iter()
        .zip(&travel)
        .map(|(&ci, &v)| (jac.addrs[ci].clone(), v))
        .collect();
    out.search = out.purity < PURITY_FLOOR || out.reach < REACH_FLOOR;
    out
}

/// Apply named-control settings `c` (one per wiring, each in `[−1, 1]`) to
/// the knob values the Jacobian was measured at. Returns `(address, value)`
/// for every knob that moved, clamped into the knob domain.
pub fn apply(jac: &Jacobian, wiring: &[Wiring], c: &[f64]) -> Vec<(String, f64)> {
    let mut vals = jac.values.clone();
    let mut touched = vec![false; vals.len()];
    for (w, &ci) in wiring.iter().zip(c) {
        if w.search || ci == 0.0 {
            continue;
        }
        let (lo, hi) = w.range();
        let ci = ci.clamp(lo, hi);
        for (addr, gain) in &w.knobs {
            if let Some(k) = jac.addrs.iter().position(|a| a == addr) {
                vals[k] += ci * gain;
                touched[k] = true;
            }
        }
    }
    jac.addrs
        .iter()
        .zip(vals)
        .zip(touched)
        .filter(|(_, t)| *t)
        .map(|((a, v), _)| (a.clone(), v.clamp(0.0, KNOB_MAX)))
        .collect()
}

/// Check every reachable wiring against real renders: the patch at `c = ±1`
/// on that one control, projected onto the control's own axis.
///
/// The Jacobian is a local, linear claim, and it is wrong exactly where a
/// performer would notice: at a boundary. A patch already as still as it gets
/// cannot be made stiller, and on First Bass turning Motion *down* measurably
/// made it very slightly more restless — the linear prediction said otherwise.
/// So each half is confirmed or closed ([`Wiring::range`]), and a control with
/// neither half confirmed becomes a search control. Four renders per
/// reachable control (±½ and ±1), through the memo, and four more for one
/// retried at half travel. Each wiring is checked on the axis it was solved
/// for ([`Wiring::axis`]), so any set [`wire_named`] wired verifies the same
/// way.
pub fn verify(
    tree: &PatchTree,
    jac: &Jacobian,
    wiring: &mut [Wiring],
    spec: &PhraseSpec,
    memo: &RenderMemo,
    std: &Standardizer,
) {
    verify_by(tree, jac, wiring, &mut |t| rendered(t, spec, memo, std));
}

/// The patch at `c` on control `i` alone (every other control at zero), with
/// the wiring taken at the Jacobian's word — the tree [`verify`] renders to
/// test one point of one half. `None` if a knob write fails.
fn tree_at(
    tree: &PatchTree,
    jac: &Jacobian,
    wiring: &[Wiring],
    i: usize,
    c: f64,
) -> Option<PatchTree> {
    let mut cs = vec![0.0; wiring.len()];
    cs[i] = c;
    let unverified: Vec<Wiring> = wiring
        .iter()
        .map(|w| Wiring {
            up: None,
            down: None,
            ..w.clone()
        })
        .collect();
    let mut t = tree.clone();
    for (a, v) in apply(jac, &unverified, &cs) {
        t = set_param(&t, &a, ParamValue::Continuous(v)).ok()?;
    }
    Some(t)
}

/// [`verify`] through a lookup. Returns false while any render it needs is
/// still [`Look::Pending`]; a control with an unmeasured point is left
/// unverified rather than decided on a guess, and its retry at half travel —
/// which depends on the full-travel result — is not asked for until that
/// result exists.
pub(crate) fn verify_by(
    tree: &PatchTree,
    jac: &Jacobian,
    wiring: &mut [Wiring],
    look: &mut dyn FnMut(&PatchTree) -> Look,
) -> bool {
    let mut complete = true;
    for i in 0..wiring.len() {
        if wiring[i].search || wiring[i].axis.len() != jac.names.len() {
            continue;
        }
        let d = wiring[i].axis.clone();
        let along = |z: &[f64]| z.iter().zip(&d).map(|(a, b)| a * b).sum::<f64>();
        let base = along(&jac.z);
        let mut pending = false;
        // One point: its movement along the control's own axis, `None` for a
        // point that does not vet.
        let mut at = |c: f64, wiring: &[Wiring], pending: &mut bool| -> Option<f64> {
            let t = tree_at(tree, jac, wiring, i, c)?;
            match look(&t) {
                Look::Z(z) => Some(along(&z)),
                Look::Fails => None,
                Look::Pending => {
                    *pending = true;
                    None
                }
            }
        };
        // A half is confirmed only if the sound moved the asked-for way at
        // both half and full travel; its reach is the full-travel movement.
        // A half that moves at the end but reverses on the way is closed.
        let mut half = |c: f64, scale: f64, wiring: &[Wiring], pending: &mut bool| -> f64 {
            let near = at(c * scale * 0.5, wiring, pending)
                .map(|v| (v - base) * c)
                .unwrap_or(0.0);
            let far = at(c * scale, wiring, pending)
                .map(|v| (v - base) * c)
                .unwrap_or(0.0);
            if near > 0.0 && far > near {
                far
            } else {
                0.0
            }
        };
        let (mut up, mut down) = (
            half(1.0, 1.0, wiring, &mut pending),
            half(-1.0, 1.0, wiring, &mut pending),
        );
        if pending {
            complete = false;
            continue;
        }
        // A control that would close at full travel gets one retry at half:
        // the same two-point test over ±¼ and ±½ (±½ is already rendered and
        // memoized). Wiring by effect gives the knob doing the work its whole
        // MAX_TRAVEL, which is where a Motion wiring most often turns back on
        // itself — so it keeps half the turn instead of closing.
        let open = |m: f64| m >= REACH_FLOOR * 0.5;
        if !open(up) && !open(down) {
            let (u2, d2) = (
                half(1.0, 0.5, wiring, &mut pending),
                half(-1.0, 0.5, wiring, &mut pending),
            );
            if pending {
                complete = false;
                continue;
            }
            if open(u2) || open(d2) {
                for (_, g) in wiring[i].knobs.iter_mut() {
                    *g *= 0.5;
                }
                wiring[i].reach *= 0.5;
                (up, down) = (u2, d2);
            }
        }
        wiring[i].up = Some(up);
        wiring[i].down = Some(down);
        let (lo, hi) = wiring[i].range();
        if lo == 0.0 && hi == 0.0 {
            wiring[i].search = true;
        }
    }
    complete
}

impl Engine {
    /// Measure, wire and verify the named controls on `tree`: [`jacobian`],
    /// [`wire`], then [`verify`]. `None` before a standardizer exists or when
    /// the tree does not vet.
    pub fn wire_controls(&self, tree: &PatchTree) -> Option<(Jacobian, Vec<Wiring>)> {
        self.wire_controls_known(tree, &HashSet::new())
    }

    /// [`Self::wire_controls`] with the renders already known not to vet
    /// named by their memo key, so they are not rendered again: the memo keeps
    /// only successes, and a measurement finished from renders made elsewhere
    /// ([`Self::wire_plan`]) would otherwise re-render each of its failures
    /// here, on the thread the split exists to keep free. Every other render
    /// comes from the memo, or is made here on a miss. The result is the one
    /// `wire_controls` would give: a failure is deterministic, so skipping its
    /// render changes nothing but the time.
    pub fn wire_controls_known(
        &self,
        tree: &PatchTree,
        failed: &HashSet<String>,
    ) -> Option<(Jacobian, Vec<Wiring>)> {
        self.wire_named(tree, &CONTROLS, failed)
    }

    /// [`Self::wire_controls_known`] for any `controls` ([`palette_controls`]
    /// picks them from the [`PALETTE`]), wired and separated in their order.
    /// The Jacobian's renders are the same whatever is wired; each reachable
    /// control adds its own verification renders. The six of [`CONTROLS`]
    /// give exactly what `wire_controls_known` gives.
    pub fn wire_named(
        &self,
        tree: &PatchTree,
        controls: &[NamedControl],
        failed: &HashSet<String>,
    ) -> Option<(Jacobian, Vec<Wiring>)> {
        let std = self.standardizer.as_deref()?;
        let (spec, memo) = (&self.cfg.phrase, self.memo());
        let mut look = |t: &PatchTree| {
            if !failed.is_empty() && failed.contains(&render_key(t, spec)) {
                Look::Fails
            } else {
                rendered(t, spec, memo, std)
            }
        };
        let jac = jacobian_by(tree, spec.sample_rate, &mut look).ok()??;
        let mut wiring = wire_named(&jac, controls, SEMANTIC_RIDGE);
        verify_by(tree, &jac, &mut wiring, &mut look);
        Some((jac, wiring))
    }

    /// The renders [`Self::wire_controls`] would make next on `tree` and the
    /// memo does not hold, as `(memo key, tree)`, rendering nothing.
    ///
    /// A measurement comes in up to three rounds, because each depends on the
    /// last: the patch and its nudges (the Jacobian), then four points per
    /// reachable control (their trees depend on the wiring the Jacobian
    /// gives), then a retry at half travel for any control that closed at full
    /// travel (which depends on those results). This answers the earliest round
    /// still owed, all of it at once, so a caller can render the round in
    /// parallel or one tree at a time between other requests, fold the results
    /// into the memo, and ask again. Empty when nothing more is owed: then
    /// [`Self::wire_controls_known`] finishes from the memo without a render.
    /// `failed` names the renders already known not to vet, which the memo
    /// does not keep. Empty, too, before a standardizer exists.
    pub fn wire_plan(
        &self,
        tree: &PatchTree,
        failed: &HashSet<String>,
    ) -> Vec<(String, PatchTree)> {
        self.wire_plan_named(tree, &CONTROLS, failed)
    }

    /// [`Self::wire_plan`] for the measurement [`Self::wire_named`] makes of
    /// `controls`: the same rounds, with each reachable control's points in
    /// the second and third.
    pub fn wire_plan_named(
        &self,
        tree: &PatchTree,
        controls: &[NamedControl],
        failed: &HashSet<String>,
    ) -> Vec<(String, PatchTree)> {
        let mut need: Vec<(String, PatchTree)> = Vec::new();
        let Some(std) = self.standardizer.as_deref() else {
            return need;
        };
        let (spec, memo) = (&self.cfg.phrase, self.memo());
        let mut look = |t: &PatchTree| {
            let key = render_key(t, spec);
            if failed.contains(&key) {
                return Look::Fails;
            }
            match memo.get(&key) {
                Some(cf) => Look::Z(standardized_audio(&cf.features, std)),
                None => {
                    if !need.iter().any(|(k, _)| *k == key) {
                        need.push((key, t.clone()));
                    }
                    Look::Pending
                }
            }
        };
        if let Ok(Some(jac)) = jacobian_by(tree, spec.sample_rate, &mut look) {
            let mut wiring = wire_named(&jac, controls, SEMANTIC_RIDGE);
            verify_by(tree, &jac, &mut wiring, &mut look);
        }
        need
    }

    /// The standardizer this session's φ lives under, once the pool is filled.
    pub fn standardizer(&self) -> Option<&Standardizer> {
        self.standardizer.as_deref()
    }

    /// True once the walks are taste-directed; false while they explore the
    /// vetted grammar prior.
    pub fn has_taste(&self) -> bool {
        self.posterior.is_some() && self.standardizer.is_some()
    }

    /// [`jacobian`] under this session's stimulus, memo and standardizer.
    pub fn jacobian(&self, tree: &PatchTree) -> Option<Jacobian> {
        let std = self.standardizer.as_deref()?;
        jacobian(tree, &self.cfg.phrase, self.memo(), std)
    }

    /// One knob-only drift: a local Metropolis walk ([`Engine::local_walk`],
    /// step `sigma` on the knob's 0–1 range) over the patch's live knobs
    /// minus the player's locks, on the taste target.
    /// Nothing enters the pool. Before any taste has been fitted the target is
    /// the vetted grammar prior ([`VetOnlyFitness`]). The error says why
    /// nothing came back: [`RefineOutcome::NoMove`] for a walk that stayed,
    /// [`RefineOutcome::OutsideSupport`] for a patch the prior gives no mass
    /// (a walk cannot start there at all).
    pub fn drift<R: Rng>(
        &self,
        rng: &mut R,
        tree: &PatchTree,
        player_locks: &[String],
        steps: usize,
        sigma: f64,
    ) -> Result<PatchTree, RefineOutcome> {
        let locked: HashSet<&str> = player_locks.iter().map(String::as_str).collect();
        let free: Vec<String> = live_knobs(tree, self.cfg.phrase.sample_rate)
            .into_iter()
            .map(|(a, _)| a)
            .filter(|a| !locked.contains(a.as_str()))
            .collect();
        self.local_walk(rng, tree, &free, steps, sigma)
    }

    /// A structural offer: the same walk with only the player's locks. Like
    /// [`Self::drift`], it inserts nothing, and it too falls back to the
    /// vetted grammar prior before the first fit.
    pub fn offer<R: Rng>(
        &self,
        rng: &mut R,
        tree: &PatchTree,
        player_locks: &[String],
        steps: usize,
    ) -> Result<PatchTree, RefineOutcome> {
        let locked: HashSet<String> = player_locks.iter().cloned().collect();
        self.refine_walk(rng, tree, &locked, steps)
    }

    /// A search control's offer: [`Self::offer`]'s walk on the target tilted
    /// along named control `control` ([`PALETTE`] order, whose first six are
    /// [`CONTROLS`]), turned up (a
    /// positive `sign`) or down, at [`AIM_GAMMA`]. A walk that has not yet moved the asked
    /// way by [`REACH_FLOOR`] keeps walking from where it stopped, up to
    /// [`AIM_WALKS`] walks of `steps`. The Offer button and Wander stay on
    /// [`Self::offer`].
    ///
    /// Without a standardizer there is no `z` to aim along, and an unknown
    /// control has no direction: both walk undirected, exactly as
    /// [`Self::offer`], and [`Self::moved_along`] then has nothing to say.
    pub fn offer_toward<R: Rng>(
        &self,
        rng: &mut R,
        tree: &PatchTree,
        player_locks: &[String],
        steps: usize,
        control: usize,
        sign: f64,
    ) -> Result<PatchTree, RefineOutcome> {
        self.offer_aimed(
            rng,
            tree,
            player_locks,
            steps,
            control,
            sign,
            AIM_GAMMA,
            AIM_WALKS,
        )
    }

    /// [`Self::offer_toward`] at a stated `gamma` and number of `walks`: the
    /// census (`examples/offer_census.rs`) sweeps both; everything else uses
    /// [`AIM_GAMMA`] and [`AIM_WALKS`].
    ///
    /// Each further walk continues the chain from the state the last one
    /// ended in (or from `tree` again, with the stream advanced, if it did
    /// not move), so nothing grown is thrown away: it is one longer walk that
    /// stops as soon as it has gone the asked way, not several offers
    /// filtered afterwards.
    #[allow(clippy::too_many_arguments)]
    pub fn offer_aimed<R: Rng>(
        &self,
        rng: &mut R,
        tree: &PatchTree,
        player_locks: &[String],
        steps: usize,
        control: usize,
        sign: f64,
        gamma: f64,
        walks: usize,
    ) -> Result<PatchTree, RefineOutcome> {
        let (Some(c), Some(std)) = (PALETTE.get(control), self.standardizer.as_ref()) else {
            return self.offer(rng, tree, player_locks, steps);
        };
        let names: Vec<String> = AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect();
        let locked: HashSet<String> = player_locks.iter().cloned().collect();
        let tilt = TiltedFitness {
            inner: (),
            standardizer: Arc::clone(std),
            direction: direction(c, &names),
            sign: if sign < 0.0 { -1.0 } else { 1.0 },
            gamma,
            phrase: self.cfg.phrase.clone(),
            memo: self.memo().clone(),
        };
        let home = tilt.along(tree);
        let mut grown: Result<PatchTree, RefineOutcome> = Err(RefineOutcome::NoMove);
        for _ in 0..walks.max(1) {
            let from = grown.as_ref().unwrap_or(tree);
            match self.tilted_walk(rng, from, &locked, steps, &tilt) {
                Ok(t) => grown = Ok(t),
                // A patch the prior gives no mass cannot be walked from at
                // all; nothing further will change that.
                Err(RefineOutcome::OutsideSupport) if grown.is_err() => {
                    return Err(RefineOutcome::OutsideSupport)
                }
                Err(_) => {}
            }
            let went = match (&grown, home) {
                (Ok(t), Some(h)) => tilt.along(t).map(|a| tilt.sign * (a - h)),
                _ => None,
            };
            if went.is_some_and(|m| m >= REACH_FLOOR) {
                break;
            }
        }
        grown
    }

    /// One walk on `tilt` around the target [`Self::refine_walk`] would
    /// choose: the taste surrogate, or the vetted prior before a fit.
    fn tilted_walk<R: Rng>(
        &self,
        rng: &mut R,
        from: &PatchTree,
        locked: &HashSet<String>,
        steps: usize,
        tilt: &TiltedFitness<()>,
    ) -> Result<PatchTree, RefineOutcome> {
        match (&self.posterior, &self.standardizer) {
            (Some(p), Some(std)) => {
                let inner = crate::SurrogateFitness {
                    posterior: Arc::clone(p),
                    standardizer: Arc::clone(std),
                    phrase: self.cfg.phrase.clone(),
                    memo: self.memo().clone(),
                };
                self.walk_fitness(rng, from, locked, steps, tilt.clone().around(inner))
            }
            _ => {
                let inner = VetOnlyFitness {
                    phrase: self.cfg.phrase.clone(),
                    memo: self.memo().clone(),
                };
                self.walk_fitness(rng, from, locked, steps, tilt.clone().around(inner))
            }
        }
    }

    /// How far `to` moved from `from` along named control `control`'s
    /// direction, in σ of the session's spread: `ê · (z(to) − z(from))`.
    /// Positive is toward the control's high word. What B's strip reports of
    /// an aimed offer. `None` before a standardizer exists, for an unknown
    /// control, or if either tree does not vet. Both renders are memo hits
    /// after the walk that produced `to`.
    pub fn moved_along(&self, from: &PatchTree, to: &PatchTree, control: usize) -> Option<f64> {
        let c = PALETTE.get(control)?;
        let std = self.standardizer.as_deref()?;
        let names: Vec<String> = AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect();
        let d = direction(c, &names);
        let (spec, memo) = (&self.cfg.phrase, self.memo());
        let a = audio_z(from, spec, memo, std)?;
        let b = audio_z(to, spec, memo, std)?;
        Some(dot(&d, &b) - dot(&d, &a))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use auracle_features::featurize;
    use auracle_grammar::preset_bank;

    fn preset_standardizer(spec: &PhraseSpec) -> Standardizer {
        let rows: Vec<Vec<f64>> = preset_bank()
            .iter()
            .filter_map(|p| featurize(&p.tree, spec).ok())
            .map(|v| v.features.phi())
            .collect();
        Standardizer::fit(&rows)
    }

    /// Every palette direction is unit length over φ's real names, and every
    /// coordinate it names exists: a control whose one coordinate was renamed
    /// away has no direction at all, and one that lost one of several would
    /// quietly narrow to the rest, so each weight is checked by name. The
    /// six are the palette's first six, and names are unique (a wiring is
    /// told apart by its name).
    #[test]
    fn directions_are_unit_and_named_coordinates_exist() {
        let names: Vec<String> = AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect();
        let bare: Vec<&str> = names
            .iter()
            .map(|n| n.split(':').next().unwrap_or(n))
            .collect();
        for c in &PALETTE {
            let d = direction(c, &names);
            let n: f64 = d.iter().map(|x| x * x).sum::<f64>().sqrt();
            assert!(
                (n - 1.0).abs() < 1e-9,
                "{} names a coordinate φ lacks",
                c.name
            );
            for (a, _) in c.axis {
                assert!(bare.contains(a), "{}: φ has no {a}", c.name);
            }
        }
        for (k, c) in CONTROLS.iter().enumerate() {
            assert_eq!(PALETTE[k].name, c.name, "the six lead the palette");
        }
        let mut seen = HashSet::new();
        assert!(PALETTE.iter().all(|c| seen.insert(c.name)), "a name twice");
        let families = [
            "Tone",
            "Weight",
            "Dynamics",
            "Movement",
            "Space",
            "Character",
        ];
        for f in families {
            let n = PALETTE.iter().filter(|c| c.family == f).count();
            assert_eq!(n, 3, "{f} has {n} controls");
        }
        assert_eq!(
            palette_controls(&[6, 99, 0, 6])
                .iter()
                .map(|c| c.name)
                .collect::<Vec<_>>(),
            [PALETTE[6].name, PALETTE[0].name],
            "out of range and repeats are dropped, order kept"
        );
    }

    /// Purity generalizes without moving the six. For each of the six it is
    /// bit-for-bit the formula it always was (the cosine with its axis
    /// against the other five axes); for every palette control a move along
    /// its own direction is pure, and a move along a named axis orthogonal to
    /// it is not this control at all.
    #[test]
    fn purity_keeps_the_six_and_extends_to_the_palette() {
        let names: Vec<String> = AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect();
        let mut rng = <rand::rngs::StdRng as rand::SeedableRng>::seed_from_u64(5);
        let purity = |d: &[f64], m: &[f64]| {
            let along = dot(m, d);
            let off: f64 = purity_basis(d, &names)
                .iter()
                .skip(1)
                .map(|b| dot(b, m).powi(2))
                .sum();
            along / (along * along + off).sqrt().max(1e-12)
        };
        for _ in 0..200 {
            let m: Vec<f64> = (0..names.len()).map(|_| rng.gen_range(-1.0..1.0)).collect();
            for c in &CONTROLS {
                let d = direction(c, &names);
                let along: f64 = m.iter().zip(&d).map(|(a, b)| a * b).sum();
                let off: f64 = CONTROLS
                    .iter()
                    .filter(|o| o.name != c.name)
                    .map(|o| {
                        direction(o, &names)
                            .iter()
                            .zip(&m)
                            .map(|(x, y)| x * y)
                            .sum::<f64>()
                            .powi(2)
                    })
                    .sum();
                let was = along / (along * along + off).sqrt().max(1e-12);
                assert_eq!(purity(&d, &m).to_bits(), was.to_bits(), "{}", c.name);
            }
        }
        for c in &PALETTE {
            let d = direction(c, &names);
            assert!((purity(&d, &d) - 1.0).abs() < 1e-12, "{}", c.name);
            for o in &CONTROLS {
                let a = direction(o, &names);
                if dot(&a, &d).abs() < 1e-12 {
                    assert!(purity(&d, &a).abs() < 1e-12, "{} vs {}", c.name, o.name);
                }
            }
        }
    }

    /// PERFORM only turns knobs the voices can take live. Every live knob has
    /// a compiled handle, and on the shipped presets there are continuous
    /// sites without one (a modulation depth with nothing to modulate): those
    /// are exactly what the old list wrote, missed, and answered with a patch
    /// reload mid-phrase. A drift may move nothing else.
    /// A control the knobs cannot reach may be given something to turn, and
    /// the EQ that does it for Bright and Body is inaudible until turned: on
    /// every preset that has no EQ, the grafted patch vets and its audio φ
    /// stays within a hair of the original (standardized, so "a hair" is in
    /// the units the controls move in). A second EQ is never grafted, and
    /// Space's release graft is a floor, not a reset.
    #[test]
    fn grafts_are_transparent_and_do_not_stack() {
        let spec = PhraseSpec::default();
        let std = preset_standardizer(&spec);
        let n_audio = AudioFeatures::NAMES.len();
        let z = |t: &PatchTree| {
            let v = featurize(t, &spec).expect("grafted patch vets");
            std.transform(&v.features.phi())[..n_audio].to_vec()
        };
        let bright = CONTROLS.iter().position(|c| c.name == "Bright").unwrap();
        let space = CONTROLS.iter().position(|c| c.name == "Space").unwrap();
        let mut grafted = 0;
        let mut worst: f64 = 0.0;
        for p in preset_bank().into_iter().step_by(4) {
            let Some(t) = graft_for(&p.tree, bright) else {
                continue;
            };
            grafted += 1;
            let d = z(&p.tree)
                .iter()
                .zip(z(&t))
                .map(|(a, b)| (a - b).powi(2))
                .sum::<f64>()
                .sqrt();
            worst = worst.max(d);
            assert!(graft_for(&t, bright).is_none(), "{}: a second EQ", p.name);
        }
        assert!(grafted >= 8, "only {grafted} presets took the EQ graft");
        assert!(worst < 0.05, "an EQ graft moved the sound by {worst:.3}σ");

        let mut short = preset_bank()[0].tree.clone();
        short.amp.release = 0.2;
        let long = graft_for(&short, space).expect("a short release grows");
        assert_eq!(long.amp.release, SPACE_RELEASE);
        assert_eq!(long.root, short.root, "Space changes the release only");
        assert!(graft_for(&long, space).is_none(), "already long enough");
        assert!(insert_for(space).is_none() && graft_for(&short, 4).is_none());
    }

    #[test]
    fn performance_touches_live_knobs_only() {
        let sr = PhraseSpec::default().sample_rate;
        let mut excluded = 0;
        for p in preset_bank() {
            let voice = auracle_grammar::compile(&p.tree, sr).expect("presets compile");
            let live = live_knobs(&p.tree, sr);
            for (a, _) in &live {
                assert!(
                    voice.params.contains_key(a),
                    "{}: {a} has no handle",
                    p.name
                );
            }
            excluded += continuous_knobs(&p.tree).len() - live.len();
        }
        assert!(
            excluded > 0,
            "the presets have handle-less sites; this test must see one"
        );
    }

    /// A drift is local and knob-only: it changes no structural or
    /// categorical choice and no knob without a live handle, and the farthest
    /// knob it moves grows with `sigma` — the Wander dial's reach. (The old
    /// walk, fugue's adaptive kernel from a fresh chain, moved some knob by
    /// 0.3–0.85 of its range in eight steps.)
    #[test]
    fn drift_is_local_and_follows_sigma() {
        use crate::engine::{Engine, SessionConfig};
        let engine = Engine::new(
            auracle_grammar::PatchGrammarPrior::default(),
            SessionConfig::default(),
        );
        let sr = engine.cfg.phrase.sample_rate;
        let mut rng = <rand::rngs::StdRng as rand::SeedableRng>::seed_from_u64(11);
        let (mut small, mut large) = (0.0f64, 0.0f64);
        for p in preset_bank().iter().take(6) {
            let before: std::collections::HashMap<String, f64> =
                continuous_knobs(&p.tree).into_iter().collect();
            let live: HashSet<String> = live_knobs(&p.tree, sr)
                .into_iter()
                .map(|(a, _)| a)
                .collect();
            for (sigma, acc) in [(0.03, &mut small), (0.2, &mut large)] {
                let t = engine
                    .drift(&mut rng, &p.tree, &[], 12, sigma)
                    .expect("a vetted preset drifts");
                assert_eq!(
                    structural_addrs(&t),
                    structural_addrs(&p.tree),
                    "{}: structure moved",
                    p.name
                );
                let mut far = 0.0f64;
                for (a, v) in continuous_knobs(&t) {
                    let d = (v - before[&a]).abs();
                    if !live.contains(&a) {
                        assert!(d < 1e-12, "{}: non-live {a} moved", p.name);
                    }
                    far = far.max(d);
                }
                *acc += far;
            }
        }
        assert!(
            small < 0.5 * large,
            "sigma should set the reach: {small:.2} vs {large:.2}"
        );
        assert!(
            small / 6.0 < 0.15,
            "a gentle drift should stay local: mean max {:.2}",
            small / 6.0
        );
    }

    /// The tilt is exactly `f + γ·s·ê·z` and renders nothing of its own: the
    /// inner fitness's render is the one the tilt reads, and a proposal that
    /// does not vet keeps its quarantine score, untilted.
    #[test]
    fn a_tilt_adds_its_aim_and_costs_no_render() {
        let spec = PhraseSpec::default();
        let std = Arc::new(preset_standardizer(&spec));
        let names: Vec<String> = AudioFeatures::NAMES.iter().map(|s| s.to_string()).collect();
        let memo = RenderMemo::default();
        let inner = VetOnlyFitness {
            phrase: spec.clone(),
            memo: memo.clone(),
        };
        use fugue_evo::fitness::traits::Fitness;
        let bank = preset_bank();
        let p = bank.iter().find(|p| p.name == "Glass Pad").expect("preset");
        for sign in [1.0, -1.0] {
            let tilt = TiltedFitness {
                inner: inner.clone(),
                standardizer: Arc::clone(&std),
                direction: direction(&CONTROLS[4], &names),
                sign,
                gamma: 1.5,
                phrase: spec.clone(),
                memo: memo.clone(),
            };
            let before = memo.stats().misses;
            let f = tilt.evaluate(&p.tree);
            assert!(
                memo.stats().misses <= before + 1,
                "the tilt rendered a second time"
            );
            let z = audio_z(&p.tree, &spec, &memo, &std).expect("vets");
            let want = 1.5 * sign * dot(&tilt.direction, &z);
            assert!((f - want).abs() < 1e-12, "{f} vs {want}");
        }
    }

    /// Does the patch have anything that makes it rough — a drive, a folder, a
    /// crusher or a noise source? Grit's axis is spectral flatness.
    fn has_grit(n: &AudioNode) -> bool {
        matches!(
            n,
            AudioNode::Distortion { .. }
                | AudioNode::Bitcrush { .. }
                | AudioNode::Fold { .. }
                | AudioNode::Noise { .. }
        ) || n.children().into_iter().any(has_grit)
    }

    /// ADR-008: a search control's offer moves the way the control was
    /// turned. On presets with nothing rough in them (no drive, folder,
    /// crusher or noise: where Grit is a search control), `offer_toward(Grit,
    /// +1)` ends at least [`REACH_FLOOR`] grittier in most trials, and further
    /// than the undirected `offer` from the same seeds, which mostly does not
    /// move that way at all. Before the first fit (the tilt around the vetted
    /// prior), which is when a new player meets it.
    #[test]
    fn an_aimed_offer_moves_the_way_it_was_turned() {
        use crate::engine::{Engine, SessionConfig};
        let mut engine = Engine::new(
            auracle_grammar::PatchGrammarPrior::default(),
            SessionConfig::default(),
        );
        engine.standardizer = Some(Arc::new(preset_standardizer(&engine.cfg.phrase)));
        let grit = CONTROLS.iter().position(|c| c.name == "Grit").unwrap();
        let bank = preset_bank();
        let (mut aimed, mut plain) = (Vec::new(), Vec::new());
        for name in ["Glass Pad", "Detune Dream", "Choirboy"] {
            let p = bank.iter().find(|p| p.name == name).expect("preset exists");
            assert!(!has_grit(&p.tree.root), "{name} has something rough in it");
            for seed in 0..3u64 {
                let mut r = <rand::rngs::StdRng as rand::SeedableRng>::seed_from_u64(seed);
                let a = engine
                    .offer_toward(&mut r, &p.tree, &[], 20, grit, 1.0)
                    .ok()
                    .and_then(|t| engine.moved_along(&p.tree, &t, grit))
                    .unwrap_or(0.0);
                let mut r = <rand::rngs::StdRng as rand::SeedableRng>::seed_from_u64(seed);
                let u = engine
                    .offer(&mut r, &p.tree, &[], 20)
                    .ok()
                    .and_then(|t| engine.moved_along(&p.tree, &t, grit))
                    .unwrap_or(0.0);
                eprintln!("{name} seed {seed}: aimed {a:+.2}σ, undirected {u:+.2}σ");
                aimed.push(a);
                plain.push(u);
            }
        }
        let hits = |v: &[f64]| v.iter().filter(|&&m| m >= REACH_FLOOR).count();
        let median = |v: &[f64]| {
            let mut v = v.to_vec();
            v.sort_by(f64::total_cmp);
            v[v.len() / 2]
        };
        assert!(
            hits(&aimed) * 2 > aimed.len(),
            "aimed offers moved grittier in only {} of {}",
            hits(&aimed),
            aimed.len()
        );
        assert!(
            hits(&plain) < hits(&aimed) && median(&plain) < median(&aimed),
            "the undirected offer moved as often or as far: {} hits, median {:.2}σ, against {} and {:.2}σ",
            hits(&plain),
            median(&plain),
            hits(&aimed),
            median(&aimed)
        );
    }

    #[test]
    fn solve_recovers_a_known_system() {
        let m = vec![vec![4.0, 1.0], vec![1.0, 3.0]];
        let x = solve(m, vec![1.0, 2.0]);
        assert!((x[0] - 1.0 / 11.0).abs() < 1e-12 && (x[1] - 7.0 / 11.0).abs() < 1e-12);
    }

    /// The gate: where a control claims it can reach, turning it moves the
    /// **measured** sound along its axis, in order, on real renders.
    ///
    /// Verification ([`verify`]) opens a half only if the renders at ±½ and ±1
    /// both moved the right way; this checks the claim somewhere verification
    /// did not look — ±¾ — with a stated tolerance of [`MONO_TOL`]σ. No finite
    /// set of samples proves a nonlinear response monotone; this is the
    /// measurable version of the promise. A wiring whose predicted move does not survive the
    /// nonlinearity of a real render is exactly the dishonest control this
    /// module exists to refuse. It holds for the whole [`PALETTE`]: the six as
    /// the panel wires them, and each of the twelve wired alone.
    #[test]
    fn named_controls_move_the_sound_they_name() {
        let spec = PhraseSpec::default();
        let std = preset_standardizer(&spec);
        let memo = RenderMemo::default();
        let bank = preset_bank();
        // The six as the panel wires them, then each of the palette's twelve
        // alone, so every control is held to its claim wherever it makes one.
        let mut sets: Vec<Vec<NamedControl>> = vec![CONTROLS.to_vec()];
        sets.extend(PALETTE[CONTROLS.len()..].iter().map(|c| vec![*c]));
        // One preset per thread: every render is a pure function of its tree,
        // and the memo is shared, so this changes the time and nothing else.
        let check = |name: &str| -> (usize, usize, HashSet<String>) {
            let (mut checked, mut palette_checked) = (0, 0);
            let mut palette_names = HashSet::new();
            let p = bank.iter().find(|p| p.name == name).expect("preset exists");
            let jac = jacobian(&p.tree, &spec, &memo, &std).expect("preset vets");
            for set in &sets {
                let mut wiring = wire_named(&jac, set, SEMANTIC_RIDGE);
                verify(&p.tree, &jac, &mut wiring, &spec, &memo, &std);
                for (i, w) in wiring.iter().enumerate() {
                    let (lo, hi) = w.range();
                    if w.search {
                        continue;
                    }
                    assert_eq!(w.axis, direction(&set[i], &jac.names), "{}", w.name);
                    let d = w.axis.clone();
                    let mine = set.len() == 1;
                    if mine && (lo < 0.0 || hi > 0.0) {
                        palette_names.insert(w.name.clone());
                    }
                    let at = |c: f64| {
                        let mut cs = vec![0.0; wiring.len()];
                        cs[i] = c;
                        let mut t = p.tree.clone();
                        for (a, v) in apply(&jac, &wiring, &cs) {
                            t = set_param(&t, &a, ParamValue::Continuous(v)).unwrap();
                        }
                        let z = audio_z(&t, &spec, &memo, &std).expect("still vets");
                        z.iter().zip(&d).map(|(a, b)| a * b).sum::<f64>()
                    };
                    let mid = at(0.0);
                    let count = if mine {
                        &mut palette_checked
                    } else {
                        &mut checked
                    };
                    if hi > 0.0 {
                        let h = at(0.75);
                        assert!(
                            h > mid - MONO_TOL,
                            "{name}/{} up half: {mid:.3} -> {h:.3}",
                            w.name
                        );
                        *count += 1;
                    }
                    if lo < 0.0 {
                        let l = at(-0.75);
                        assert!(
                            l < mid + MONO_TOL,
                            "{name}/{} down half: {mid:.3} -> {l:.3}",
                            w.name
                        );
                        *count += 1;
                    }
                }
            }
            (checked, palette_checked, palette_names)
        };
        let names = ["First Bass", "Ceiling", "Detune Dream", "Long Way Down"];
        let results: Vec<(usize, usize, HashSet<String>)> = std::thread::scope(|s| {
            let jobs: Vec<_> = names
                .iter()
                .map(|name| {
                    let check = &check;
                    s.spawn(move || check(name))
                })
                .collect();
            jobs.into_iter()
                .map(|j| j.join().unwrap_or_else(|e| std::panic::resume_unwind(e)))
                .collect()
        });
        let checked: usize = results.iter().map(|r| r.0).sum();
        let palette_checked: usize = results.iter().map(|r| r.1).sum();
        let palette_names: HashSet<String> =
            results.into_iter().flat_map(|r| r.2.into_iter()).collect();
        assert!(checked >= 8, "too few open halves to be a gate: {checked}");
        eprintln!(
            "the twelve: {palette_checked} open halves checked, over {} controls",
            palette_names.len()
        );
        assert!(
            palette_checked >= 16 && palette_names.len() >= 8,
            "too few of the palette's halves to be a gate: {palette_checked} over {palette_names:?}"
        );
    }

    /// A measurement paid for in rounds — planned, its renders made elsewhere
    /// and folded into the memo, then finished — is the measurement
    /// `wire_controls` makes in one call: the same wiring, to the bit. And a
    /// plan renders nothing: the thread asking for one stays free. The same
    /// holds for the whole palette (`wire_plan_named`, `wire_named`).
    #[test]
    fn a_planned_measurement_is_the_measurement() {
        use crate::engine::{Engine, SessionConfig};
        let bank = preset_bank();
        let six = CONTROLS.len();
        // Fitted once: a fit renders every preset, and each engine below
        // needs only the same standardizer, not its own sixty renders.
        let std = Arc::new(preset_standardizer(&SessionConfig::default().phrase));
        for (name, controls) in [
            ("First Bass", &PALETTE[..six]),
            ("Glass Pad", &PALETTE[..six]),
            ("First Bass", &PALETTE[..]),
        ] {
            let p = bank.iter().find(|p| p.name == name).expect("preset exists");
            let fresh = || {
                let mut e = Engine::new(
                    auracle_grammar::PatchGrammarPrior::default(),
                    SessionConfig::default(),
                );
                e.standardizer = Some(Arc::clone(&std));
                e
            };
            let palette = controls.len() > six;
            let whole = if palette {
                fresh().wire_named(&p.tree, controls, &HashSet::new())
            } else {
                fresh().wire_controls(&p.tree)
            }
            .expect("preset vets");

            // The planned path, with its renders made on a separate memo — a
            // stand-in for a farm worker — and handed over as rows.
            let engine = fresh();
            let farm = RenderMemo::default();
            let mut failed: HashSet<String> = HashSet::new();
            let mut rounds = 0;
            loop {
                let misses = engine.memo().stats().misses;
                let need = if palette {
                    engine.wire_plan_named(&p.tree, controls, &failed)
                } else {
                    engine.wire_plan(&p.tree, &failed)
                };
                assert_eq!(
                    engine.memo().stats().misses,
                    misses,
                    "{name}: a plan rendered"
                );
                if need.is_empty() {
                    break;
                }
                rounds += 1;
                assert!(rounds <= 3, "{name}: a measurement is at most three rounds");
                for (key, t) in need {
                    match featurize_memo(&t, &engine.cfg.phrase, &farm, false) {
                        Ok((cf, _)) => engine.memo().put(cf, None),
                        Err(_) => {
                            failed.insert(key);
                        }
                    }
                }
            }
            let before = engine.memo().stats().misses;
            let planned = if palette {
                engine.wire_named(&p.tree, controls, &failed)
            } else {
                engine.wire_controls_known(&p.tree, &failed)
            }
            .expect("preset vets");
            assert_eq!(planned.1.len(), controls.len(), "{name}: one wiring each");
            assert_eq!(
                engine.memo().stats().misses,
                before,
                "{name}: finishing a planned measurement rendered"
            );
            assert_eq!(
                serde_json::to_string(&planned.1).unwrap(),
                serde_json::to_string(&whole.1).unwrap(),
                "{name}: the wiring differs"
            );
            assert_eq!(planned.0.cols, whole.0.cols, "{name}: the Jacobian differs");
        }
    }
}
