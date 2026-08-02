//! The patch term: a typed tree over the v1 module palette.
//!
//! The Audio/Mod sort distinction is enforced by the Rust type system itself —
//! an ill-sorted term (an LFO where audio is expected, a filter in a
//! modulation slot) is unrepresentable. The grammar prior samples these types
//! directly and the compiler interprets them into a quiver [`Patch`](quiver);
//! there is no unvalidated intermediate representation.
//!
//! All continuous parameters are **normalized to `[0, 1]`** (uniform prior
//! support); musical mappings (log cutoff scales, bounded resonance/feedback)
//! live in [`crate::compile`]. Discrete parameters are small enums.

use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

/// A stable identity for one node, independent of where it sits.
///
/// # Why the tree needs one
///
/// Every other handle on a node in this system is its **position**: the trace
/// key (`node/0/1`), and therefore the trace address of every knob on it, and
/// therefore every lock, every remembered hand position, every selection. That
/// is fine until the structure moves. Insert one filter at the top of a chain
/// and every key below it shifts by one segment; delete a mixer branch and the
/// survivor is re-rooted; run one generation of refinement and the tree is
/// rebuilt from a trace with no memory of the object graph at all. Under
/// positional identity the only honest response to a structural edit is to
/// throw the UI's state away — which is exactly what the workbench used to do,
/// with the comment "structure changed — locks cleared" — and that destroys the
/// loop the graph editor exists to serve: build a routing by hand, pin it, and
/// breed around it.
///
/// A `Uid` is minted once, travels with the node through clones, splices and
/// refinement, and is dropped only when the node itself is.
///
/// # It is deliberately invisible to the model
///
/// `uid` is UI identity, nothing else. It must never reach the generative
/// model, the featurizer, the compiler, or anything content-addressed, because
/// two patches that differ only in uids are the *same patch* and every one of
/// those systems is entitled to say so:
///
/// - **Equality ignores it.** [`PartialEq`] here is `true` unconditionally, so
///   the derived `PartialEq` on [`AudioNode`]/[`PatchTree`] keeps comparing
///   patches by content. The engine's pool dedup (`self.pool.iter().any(|c|
///   c.tree == end)`) and refinement's own "did this walk move at all"
///   (`current != *seed`) are both that comparison, and both would break the
///   moment a fresh uid could make two identical trees differ.
/// - **Hashing ignores it**, for the same reason and so the two stay coherent.
/// - **It is skipped in JSON when unset**, and
///   `ricercar_features::cache::canonical_tree_json` clears uids before hashing,
///   so the render memo's content address is byte-identical to what it was
///   before uids existed. A cache key that moved with the UI's bookkeeping
///   would miss on every refinement step *and* invalidate every persisted row.
/// - **It is not a choice site.** [`crate::genome`] neither encodes nor decodes
///   it, so `to_trace`/`from_trace` round-trips carry no uid — which is why
///   [`PatchTree::inherit_uids`] exists.
///
/// # `Uid::NEW` and settling
///
/// Construction sites write [`Uid::NEW`] (zero, "unset") rather than minting
/// eagerly. The prior samples thousands of trees per refinement walk and all
/// but one are thrown away; minting there would burn identities for nothing and
/// make the counter's value depend on how much search ran. Instead a tree is
/// *settled* — [`PatchTree::ensure_uids`] — at the few points where it becomes
/// something a person can point at: admitted to the pool, adopted onto the
/// bench, restored from a save. Everything before that is anonymous.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Uid(pub u64);

/// The mint. One process-global counter, monotonic from 1.
///
/// Not seeded, not per-engine, and deliberately not derived from the tree:
/// uniqueness *within a session* is the whole contract, and a content-derived
/// id would give two identical sibling modules the same identity — which is
/// precisely the confusion uids exist to end.
static UID_SOURCE: AtomicU64 = AtomicU64::new(1);

impl Uid {
    /// The unset identity: a node that has not been settled yet.
    pub const NEW: Uid = Uid(0);

    /// Mint a fresh identity.
    pub fn mint() -> Uid {
        Uid(UID_SOURCE.fetch_add(1, Ordering::Relaxed))
    }

    /// Note that this identity already exists, so the mint never reissues it.
    ///
    /// The counter is per *process*, and a restored session is the case that
    /// makes that a problem rather than a detail: a save carries the uids it
    /// was written with (that is the entire point — a hand-placed layout has to
    /// survive a reload), but a fresh page load starts the counter at 1. Insert
    /// one module into a restored patch and the mint would hand out an id that
    /// tree is already using, and two nodes would answer to one lock. So every
    /// identity the engine *sees* pushes the counter past itself, and a restore
    /// — which settles the whole bank on the way in — leaves it above every id
    /// in the save.
    pub fn observe(id: Uid) {
        UID_SOURCE.fetch_max(id.0.saturating_add(1), Ordering::Relaxed);
    }

    /// Whether this node still needs an identity.
    pub fn is_new(&self) -> bool {
        self.0 == 0
    }
}

// Two patches that differ only in uids are the same patch. See the type docs:
// pool dedup, refinement's fixed-point test and every golden-tree assertion in
// the suite are this comparison, and all of them mean "same content".
impl PartialEq for Uid {
    fn eq(&self, _: &Self) -> bool {
        true
    }
}
impl Eq for Uid {}
impl Hash for Uid {
    fn hash<H: Hasher>(&self, _: &mut H) {}
}

/// Every [`AudioNode`] variant, in declaration order — the one list the uid
/// accessors expand over, so a new module cannot be added without one.
macro_rules! audio_variants {
    ($mac:ident) => {
        $mac!(
            Vco, Supersaw, Noise, Wavetable, Pluck, Formant, Mix, Filter, Fold, Delay, Chorus,
            Reverb, Distortion, Bitcrush, Phaser, Flanger, Tremolo, Vibrato, Eq, Granular, RingMod,
            Shift, Comp, Duck, Gate, Vocoder
        )
    };
}

/// Every [`AudioNode`] variant that carries a modulation slot — all of them
/// but `Noise`, `Mix` and `RingMod`.
macro_rules! modulated_variants {
    ($mac:ident) => {
        $mac!(
            Vco, Supersaw, Wavetable, Pluck, Formant, Filter, Fold, Delay, Chorus, Reverb,
            Distortion, Bitcrush, Phaser, Flanger, Tremolo, Vibrato, Eq, Granular, Shift, Comp,
            Duck, Gate, Vocoder
        )
    };
}

/// Every non-empty [`ModNode`] variant. `None` is excluded on purpose: an
/// empty slot is not a module and carries no identity.
macro_rules! mod_variants {
    ($mac:ident) => {
        $mac!(Lfo, Env, Rand, Follow, Euclid, Op, Pair)
    };
}

/// Oscillator / LFO waveform. Index order matches the trace-site categorical
/// and the quiver output-port table.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Waveform {
    /// Sine
    Sine,
    /// Triangle
    Triangle,
    /// Sawtooth
    Saw,
    /// Square
    Square,
}

impl Waveform {
    /// All waveforms, in categorical-site index order.
    pub const ALL: [Waveform; 4] = [
        Waveform::Sine,
        Waveform::Triangle,
        Waveform::Saw,
        Waveform::Square,
    ];

    /// Categorical-site index of this waveform.
    pub fn index(self) -> usize {
        Self::ALL.iter().position(|w| *w == self).expect("in table")
    }

    /// Waveform from a categorical-site index.
    pub fn from_index(i: usize) -> Self {
        Self::ALL[i % Self::ALL.len()]
    }

    /// The quiver output-port name on `Vco` / `Lfo` for this waveform.
    pub fn port_name(self) -> &'static str {
        match self {
            Waveform::Sine => "sin",
            Waveform::Triangle => "tri",
            Waveform::Saw => "saw",
            Waveform::Square => "sqr",
        }
    }
}

/// Noise color; maps to `NoiseGenerator` output ports.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum NoiseColor {
    /// White noise (flat spectrum).
    White,
    /// Pink noise (1/f spectrum).
    Pink,
}

impl NoiseColor {
    /// All colors, in categorical-site index order.
    pub const ALL: [NoiseColor; 2] = [NoiseColor::White, NoiseColor::Pink];

    /// Categorical-site index.
    pub fn index(self) -> usize {
        Self::ALL.iter().position(|c| *c == self).expect("in table")
    }

    /// From a categorical-site index.
    pub fn from_index(i: usize) -> Self {
        Self::ALL[i % Self::ALL.len()]
    }

    /// The quiver output-port name on `NoiseGenerator`.
    pub fn port_name(self) -> &'static str {
        match self {
            NoiseColor::White => "white",
            NoiseColor::Pink => "pink",
        }
    }
}

/// Filter kind: three SVF responses plus the diode ladder.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum FilterKind {
    /// State-variable lowpass.
    SvfLp,
    /// State-variable bandpass.
    SvfBp,
    /// State-variable highpass.
    SvfHp,
    /// Diode ladder lowpass (TB-303 flavor).
    Ladder,
}

impl FilterKind {
    /// All kinds, in categorical-site index order.
    pub const ALL: [FilterKind; 4] = [
        FilterKind::SvfLp,
        FilterKind::SvfBp,
        FilterKind::SvfHp,
        FilterKind::Ladder,
    ];

    /// Categorical-site index.
    pub fn index(self) -> usize {
        Self::ALL.iter().position(|k| *k == self).expect("in table")
    }

    /// From a categorical-site index.
    pub fn from_index(i: usize) -> Self {
        Self::ALL[i % Self::ALL.len()]
    }
}

/// Wavetable shape. Index order matches the trace-site categorical and
/// quiver's own `WavetableType` table, which the `table` CV selects into.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TableShape {
    /// Pure sine.
    Sine,
    /// Triangle.
    Tri,
    /// Sawtooth.
    Saw,
    /// Square.
    Square,
    /// 25% pulse.
    Pulse25,
    /// 12.5% pulse.
    Pulse12,
    /// Vowel "ah" formant stack.
    FormantA,
    /// Vowel "oh" formant stack.
    FormantO,
}

impl TableShape {
    /// All shapes, in categorical-site index order.
    pub const ALL: [TableShape; 8] = [
        TableShape::Sine,
        TableShape::Tri,
        TableShape::Saw,
        TableShape::Square,
        TableShape::Pulse25,
        TableShape::Pulse12,
        TableShape::FormantA,
        TableShape::FormantO,
    ];

    /// Categorical-site index.
    pub fn index(self) -> usize {
        Self::ALL.iter().position(|s| *s == self).expect("in table")
    }

    /// From a categorical-site index.
    pub fn from_index(i: usize) -> Self {
        Self::ALL[i % Self::ALL.len()]
    }

    /// Silkscreen label; also the s-expression tag.
    pub fn label(self) -> &'static str {
        match self {
            TableShape::Sine => "sine",
            TableShape::Tri => "tri",
            TableShape::Saw => "saw",
            TableShape::Square => "square",
            TableShape::Pulse25 => "pulse 25",
            TableShape::Pulse12 => "pulse 12",
            TableShape::FormantA => "formant a",
            TableShape::FormantO => "formant o",
        }
    }
}

/// Distortion shaping curve.
///
/// quiver's `Distortion` also offers a foldback mode; it is deliberately
/// absent here because [`AudioNode::Fold`] already *is* that module, and a
/// second production for one timbre only splits the prior mass that teaches
/// the model what "folded" means.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum DriveMode {
    /// Bounded `tanh` — symmetric, warm.
    Soft,
    /// Hard clip — symmetric, brittle.
    Hard,
    /// Asymmetric tube curve. The only member that rectifies, so it is also
    /// the only one that costs a DC blocker (see `compile::makes_dc`).
    Tube,
}

impl DriveMode {
    /// All modes, in categorical-site index order.
    pub const ALL: [DriveMode; 3] = [DriveMode::Soft, DriveMode::Hard, DriveMode::Tube];

    /// Categorical-site index.
    pub fn index(self) -> usize {
        Self::ALL.iter().position(|m| *m == self).expect("in table")
    }

    /// From a categorical-site index.
    pub fn from_index(i: usize) -> Self {
        Self::ALL[i % Self::ALL.len()]
    }

    /// Silkscreen label; also the s-expression tag.
    pub fn label(self) -> &'static str {
        match self {
            DriveMode::Soft => "soft",
            DriveMode::Hard => "hard",
            DriveMode::Tube => "tube",
        }
    }
}

/// A unary CV processor: something that sits *between* a modulator and its
/// destination. Index order matches the `#modop` categorical.
///
/// The four are quiver's CV utilities that survive contact with this grammar.
/// The ones that did not, and why, are recorded on [`ModNode`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModOp {
    /// Snap the incoming CV to a musical scale (`ScaleQuantizer`).
    Quantize,
    /// Rate-limit it, with separate up and down times (`SlewLimiter`).
    Slew,
    /// Fold it into one polarity (`Rectifier`).
    Rectify,
    /// Sample it on an internal clock (`Clock` → `SampleAndHold`).
    Hold,
}

impl ModOp {
    /// All kinds, in categorical-site index order.
    pub const ALL: [ModOp; 4] = [ModOp::Quantize, ModOp::Slew, ModOp::Rectify, ModOp::Hold];

    /// Categorical-site index.
    pub fn index(self) -> usize {
        Self::ALL.iter().position(|k| *k == self).expect("in table")
    }

    /// From a categorical-site index.
    pub fn from_index(i: usize) -> Self {
        Self::ALL[i % Self::ALL.len()]
    }

    /// Silkscreen title, and the `RackModule::kind` tag.
    pub fn label(self) -> &'static str {
        match self {
            ModOp::Quantize => "quantize",
            ModOp::Slew => "slew",
            ModOp::Rectify => "rectify",
            ModOp::Hold => "hold",
        }
    }

    /// The continuous trace sites this op owns, in `(p0, p1)` order.
    ///
    /// Two ops carry one parameter rather than two, and the unused `p1` is
    /// **not** a trace site: sampling a choice nothing reads would cost prior
    /// mass and hand MH a proposal that can never change the sound. It is
    /// pinned to 0 by [`ModNode::normalized`] so the term still round-trips
    /// through its own encoding.
    pub fn param_sites(self) -> &'static [&'static str] {
        match self {
            ModOp::Quantize => &["qroot", "qscale"],
            ModOp::Slew => &["rise", "fall"],
            ModOp::Rectify => &["rmode"],
            ModOp::Hold => &["hrate"],
        }
    }
}

/// A binary CV combiner over two modulation terms. Index order matches the
/// `#pairop` categorical.
///
/// None of the six takes a continuous parameter, which is what keeps
/// `#pairop` cheap: a `Pair` costs its two subterms and one categorical.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PairOp {
    /// Lower of the two (`Min`).
    Min,
    /// Higher of the two (`Max`).
    Max,
    /// Gate AND (`LogicAnd`).
    And,
    /// Gate OR (`LogicOr`).
    Or,
    /// Gate XOR (`LogicXor`).
    Xor,
    /// `b` while `b` is above the gate threshold, `a` otherwise (`VcSwitch`).
    Switch,
}

impl PairOp {
    /// All kinds, in categorical-site index order.
    pub const ALL: [PairOp; 6] = [
        PairOp::Min,
        PairOp::Max,
        PairOp::And,
        PairOp::Or,
        PairOp::Xor,
        PairOp::Switch,
    ];

    /// Categorical-site index.
    pub fn index(self) -> usize {
        Self::ALL.iter().position(|k| *k == self).expect("in table")
    }

    /// From a categorical-site index.
    pub fn from_index(i: usize) -> Self {
        Self::ALL[i % Self::ALL.len()]
    }

    /// Silkscreen title, and the `RackModule::kind` tag.
    pub fn label(self) -> &'static str {
        match self {
            PairOp::Min => "min",
            PairOp::Max => "max",
            PairOp::And => "and",
            PairOp::Or => "or",
            PairOp::Xor => "xor",
            PairOp::Switch => "switch",
        }
    }

    /// Whether this op emits a 0–5 V **gate** rather than passing its inputs'
    /// own voltage range through. The three logic gates do; min, max and the
    /// switch hand back one of their inputs.
    pub fn is_gate(self) -> bool {
        matches!(self, PairOp::And | PairOp::Or | PairOp::Xor)
    }
}

/// The scales quiver's `ScaleQuantizer` selects between, in **its own** index
/// order — which is not `quiver::modules::Scale`'s.
///
/// `ScaleQuantizer` does not use that enum at all: it matches on
/// `(scale_cv · 6.99) as u8` against its own inline table of **seven** scales
/// (`utilities.rs`), and Mixolydian — index 6 of the eight-member `Scale` enum
/// — is simply absent from it. Taking `Scale`'s order would have selected
/// blues whenever the plate said mixolydian, and nothing at all for blues.
pub const QUANT_SCALES: [&str; 7] = [
    "chromatic",
    "major",
    "minor",
    "penta major",
    "penta minor",
    "dorian",
    "blues",
];

/// Which of [`QUANT_SCALES`] a normalized `qscale` knob selects — quiver's own
/// `(cv · 6.99) as u8`, so the plate and the module cannot disagree.
pub fn quant_scale_index(x: f64) -> usize {
    ((x.clamp(0.0, 1.0) * 6.99) as usize).min(QUANT_SCALES.len() - 1)
}

/// Root-note names for the quantizer's `root` port, which quiver reads as
/// `(cv · 11.99) as i32` semitones above C.
pub const QUANT_ROOTS: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

/// Which of [`QUANT_ROOTS`] a normalized `qroot` knob selects.
pub fn quant_root_index(x: f64) -> usize {
    ((x.clamp(0.0, 1.0) * 11.99) as usize).min(QUANT_ROOTS.len() - 1)
}

/// Rectifier polarities, in the order `rmode` selects them.
///
/// quiver's `Rectifier` has **no `mode` port**: it publishes all three at once
/// as separate output ports (`full`, `half_pos`, `half_neg`), so this knob
/// picks a cable at compile time rather than writing a CV.
pub const RECT_MODES: [&str; 3] = ["full", "positive", "negative"];

/// Which of [`RECT_MODES`] a normalized `rmode` knob selects — cell centres on
/// a three-way split, the convention the other quantized knobs use.
pub fn rect_mode_index(x: f64) -> usize {
    ((x.clamp(0.0, 1.0) * 2.99) as usize).min(RECT_MODES.len() - 1)
}

/// A modulation-slot term: what drives a processor's mod input.
///
/// Modulation is a **recursive sort** with a depth bound, not a flat list of
/// leaves: [`ModNode::Op`] wraps one modulation term in a CV processor and
/// [`ModNode::Pair`] combines two, so `s&h rand → quantize → slew` is a term
/// the grammar writes, the taste model reads and the rack draws.
///
/// The bound is [`crate::prior::PatchGrammarPrior::max_mod_depth`]. Without it
/// the mod sort has no parsimony pressure at all — nothing in the audio tree's
/// prior mass objects to a forty-node CV chain that moves one knob.
///
/// # What quiver ships that is deliberately *not* here
///
/// - **`StepSequencer`** — its eight step values are `steps: [f64; 8]`
///   *internal state* with no ports (`utilities.rs`, and its own comment says
///   so). It would need eight genome sites baked at compile time and could not
///   be edited live, which breaks both the four-knob faceplate budget and the
///   "every knob is a trace address you can turn" contract the instrument
///   rests on.
/// - **`Quantizer`** — subsumed by `ScaleQuantizer`, which is the same module
///   with a scale rather than raw semitones.
/// - **`Comparator`** — its useful output is a gate, and [`PairOp`]'s logic
///   ops already make gates out of the sources that matter.
/// - **`Multiple`, `PrecisionAdder`** — the tree already fans out, and
///   quiver's gather already sums several cables into one port.
/// - **`Attenuverter`** — this *is* `mod_depth`. It is already in every mod
///   cable, one per slot.
/// - **`EdgeDetector`** — a primitive the clocked modules use internally.
/// - **`ChordMemory`, `Arpeggiator`** — polyphonic pitch generators; the
///   instrument already has an arpeggiator in the keybed and a per-voice one
///   would fight it.
/// - **`MidSideEncode`/`Decode`** — needs a stereo sort the grammar has no
///   way to name.
/// - **`SamplePlayer`** — no asset pipeline, and it would make this something
///   other than a synth.
/// - **`Crosstalk`, `GroundLoop`, `Oversampler`, `UnitDelay`, `Mixer`** —
///   analog imperfection, a wrapper, a one-sample primitive, and a module
///   `Crossfader` already covers.
///
/// `Default` is [`ModNode::None`], which is what `#[serde(default)]` on the
/// modulation slots that the v2 palette *added* to already-shipped variants
/// resolves to — see [`AudioNode::Delay`].
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub enum ModNode {
    /// No modulation attached.
    #[default]
    None,
    /// A low-frequency oscillator.
    Lfo {
        /// LFO waveform.
        wave: Waveform,
        /// Normalized rate (0-1).
        rate: f64,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// An attack/decay envelope retriggered by the note gate.
    Env {
        /// Normalized attack time (0-1).
        attack: f64,
        /// Normalized decay time (0-1).
        decay: f64,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// A random stepped source (noise sampled-and-held on an internal
    /// clock) — the classic S&H burble.
    Rand {
        /// Normalized clock rate (0-1).
        rate: f64,
        /// Normalized slew between steps (0 = hard steps, 1 = a drift).
        glide: f64,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// An envelope follower riding the *owning module's own input* — the
    /// patch's dynamics fed back into its timbre (a filter that opens on the
    /// transient, a fold that hardens when the note is loud).
    ///
    /// Deliberately a **leaf**: it takes no audio subterm of its own, so the
    /// grammar gains a modulation source without gaining a second recursion
    /// or a second audio-sort site. Its source is whatever the compiler has
    /// already built for the module below it.
    Follow {
        /// Normalized sensitivity (detector output gain).
        sens: f64,
        /// Normalized release time.
        release: f64,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// A clocked euclidean gate pattern — pulses spread as evenly as the step
    /// count allows. A **leaf**, like the four above: it generates rather than
    /// processes, and its clock is its own.
    Euclid {
        /// Normalized clock rate (0-1 → 20..300 BPM).
        rate: f64,
        /// Normalized step count (0-1 → 2..16 steps).
        steps: f64,
        /// Normalized pulse density (0-1 → 1..steps−1 pulses).
        pulses: f64,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// A unary CV processor wrapping another modulation term.
    ///
    /// `p0`/`p1` are the op's two continuous knobs; which sites they occupy is
    /// [`ModOp::param_sites`]. The ops that take one parameter pin `p1` to 0
    /// and do not encode it.
    Op {
        /// Which processor.
        kind: ModOp,
        /// First continuous parameter (root / rise / mode / rate).
        p0: f64,
        /// Second continuous parameter (scale / fall); 0 and unused on the
        /// one-parameter ops.
        p1: f64,
        /// The modulation term being processed. Never [`ModNode::None`] — a
        /// processor with nothing under it is a dead cable, so the grammar
        /// renormalizes it away rather than drawing it (see
        /// [`ModNode::normalized`]).
        input: Box<ModNode>,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// A binary CV combiner over two modulation terms.
    Pair {
        /// Which combiner.
        kind: PairOp,
        /// First input. Never [`ModNode::None`].
        a: Box<ModNode>,
        /// Second input. Never [`ModNode::None`]; on
        /// [`PairOp::Switch`] it is also the control.
        b: Box<ModNode>,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
}

/// An audio-sort term: sources at the leaves, processors and mixers above.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum AudioNode {
    /// Band-limited analog-style oscillator.
    ///
    /// Its modulation slot lands on **pitch**, not on a timbre parameter — the
    /// one destination no other module in the grammar can offer, and the
    /// reason vibrato and pitch envelopes exist at all here. See
    /// [`crate::compile`]'s `wire_pitch`.
    ///
    /// `mod_depth`/`modulation` are `#[serde(default)]` for the reason spelled
    /// out on [`AudioNode::Delay`], and more urgently: a vco is in *every*
    /// saved patch, so without the defaults no session on disk deserializes at
    /// all.
    Vco {
        /// Output waveform.
        wave: Waveform,
        /// Octave offset, −2..=+2.
        octave: i8,
        /// Normalized detune (0-1 → ±50 cents).
        detune: f64,
        /// Normalized pitch-modulation depth (0-1 → ±0.5 octave). Absent in
        /// pre-2A saves; defaults to 0, i.e. no pitch modulation.
        #[serde(default)]
        mod_depth: f64,
        /// Pitch modulation source. Absent in pre-2A saves.
        #[serde(default)]
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Seven-voice detuned saw stack with sub oscillator.
    Supersaw {
        /// Octave offset, −2..=+2.
        octave: i8,
        /// Normalized voice detune spread (0-1).
        detune: f64,
        /// Normalized center/stack blend (0-1).
        mix: f64,
        /// Normalized pitch-modulation depth (0-1 → ±0.5 octave). Absent in
        /// pre-2A saves — see [`AudioNode::Vco`].
        #[serde(default)]
        mod_depth: f64,
        /// Pitch modulation source. Absent in pre-2A saves.
        #[serde(default)]
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Noise source.
    Noise {
        /// Noise color.
        color: NoiseColor,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Morphing wavetable oscillator: eight bandlimited tables, crossfaded.
    ///
    /// It has no `detune` — the faceplate budget is four knobs and `morph` is
    /// the reason this module exists, so detune loses. The compiler still
    /// routes pitch through the usual offset, pinned at "no detune".
    Wavetable {
        /// Base table.
        table: TableShape,
        /// Octave offset, −2..=+2.
        octave: i8,
        /// Normalized morph toward the next table (0-1).
        morph: f64,
        /// Normalized modulation depth (0-1, cable attenuation).
        mod_depth: f64,
        /// Morph modulation source.
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Karplus-Strong plucked string, retriggered by the note gate.
    Pluck {
        /// Octave offset, −2..=+2.
        octave: i8,
        /// Normalized loop damping (0-1; higher rings longer and brighter).
        damping: f64,
        /// Normalized excitation brightness (0-1, noise-vs-impulse blend).
        brightness: f64,
        /// Normalized modulation depth (0-1).
        mod_depth: f64,
        /// Damping modulation source.
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Formant (vocal-tract) oscillator: a glottal pulse through five
    /// parallel resonators.
    ///
    /// `vowel` is a **continuous** position interpolated across A/E/I/O/U
    /// rather than a five-way switch, which is what makes it worth a
    /// modulation slot: sweeping it moves the formant peaks, and that is a
    /// spectral movement `φ`'s centroid and rolloff coordinates measure
    /// directly.
    Formant {
        /// Normalized vowel position (0-1 across A/E/I/O/U).
        vowel: f64,
        /// Normalized formant shift (0-1 → 0.5×..2× formant frequencies;
        /// 0.5 is no shift).
        shift: f64,
        /// Octave offset, −2..=+2.
        octave: i8,
        /// Normalized modulation depth (0-1).
        mod_depth: f64,
        /// Vowel modulation source.
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Equal-power crossfade of two audio terms.
    Mix {
        /// Normalized balance (0 = all `a`, 1 = all `b`).
        balance: f64,
        /// First input.
        a: Box<AudioNode>,
        /// Second input.
        b: Box<AudioNode>,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// A filter over an audio term, with an optional cutoff modulation.
    Filter {
        /// Which filter.
        kind: FilterKind,
        /// Normalized cutoff (0-1, exponential inside quiver).
        cutoff: f64,
        /// Normalized resonance (0-1, mapped to a bounded range).
        resonance: f64,
        /// Normalized modulation depth (0-1, cable attenuation).
        mod_depth: f64,
        /// Audio input.
        input: Box<AudioNode>,
        /// Cutoff modulation source.
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Wavefolder over an audio term, with optional threshold modulation.
    Fold {
        /// Normalized fold threshold (0-1; lower folds harder).
        threshold: f64,
        /// Normalized modulation depth (0-1).
        mod_depth: f64,
        /// Audio input.
        input: Box<AudioNode>,
        /// Threshold modulation source.
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Delay line over an audio term, with optional delay-time modulation.
    ///
    /// `mod_depth` and `modulation` are `#[serde(default)]` because this
    /// variant **shipped without them**: the v2 palette added a modulation
    /// slot to a module users already have saved patches of. Serde requires
    /// every field of a struct variant unless told otherwise, so without the
    /// defaults a single v1-era delay anywhere in a bank fails the
    /// `SessionState` deserialize — and that failure is not local to the
    /// patch, it takes the whole save down: bank, observation log, lineage.
    /// A grammar that grows knobs on existing modules must default them, and
    /// the defaults must be the *v1 behaviour* (depth 0, no source), so a
    /// restored patch sounds like the one that was saved. Same for
    /// [`AudioNode::Chorus`] and [`AudioNode::Reverb`]. The variants the v2
    /// palette *introduced* (wavetable, pluck, distortion, bitcrush, phaser,
    /// ring mod) need no such treatment: no old save can contain one.
    Delay {
        /// Normalized delay time (0-1).
        time: f64,
        /// Normalized feedback (0-1, mapped to a bounded range).
        feedback: f64,
        /// Normalized wet/dry mix (0-1).
        mix: f64,
        /// Normalized modulation depth (0-1). Absent in v1 saves; defaults
        /// to 0, which is "no modulation reaches the delay time".
        #[serde(default)]
        mod_depth: f64,
        /// Audio input.
        input: Box<AudioNode>,
        /// Delay-time modulation source. Absent in v1 saves; defaults to
        /// [`ModNode::None`].
        #[serde(default)]
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Chorus over an audio term, with optional depth modulation.
    Chorus {
        /// Normalized modulation rate (0-1).
        rate: f64,
        /// Normalized modulation depth (0-1).
        depth: f64,
        /// Normalized wet/dry mix (0-1).
        mix: f64,
        /// Normalized modulation depth of the *modulation slot* (0-1).
        /// Absent in v1 saves — see [`AudioNode::Delay`].
        #[serde(default)]
        mod_depth: f64,
        /// Audio input.
        input: Box<AudioNode>,
        /// Chorus-depth modulation source. Absent in v1 saves.
        #[serde(default)]
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Algorithmic reverb (Freeverb) over an audio term, with optional size
    /// modulation.
    Reverb {
        /// Normalized room size (0-1).
        size: f64,
        /// Normalized damping (0-1).
        damp: f64,
        /// Normalized wet/dry mix (0-1).
        mix: f64,
        /// Normalized modulation depth (0-1). Absent in v1 saves — see
        /// [`AudioNode::Delay`].
        #[serde(default)]
        mod_depth: f64,
        /// Audio input.
        input: Box<AudioNode>,
        /// Room-size modulation source. Absent in v1 saves.
        #[serde(default)]
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Waveshaping distortion over an audio term.
    Distortion {
        /// Normalized drive (0-1).
        drive: f64,
        /// Normalized tone (0-1; a real one-pole lowpass, dark to open).
        tone: f64,
        /// Shaping curve.
        mode: DriveMode,
        /// Normalized modulation depth (0-1).
        mod_depth: f64,
        /// Audio input.
        input: Box<AudioNode>,
        /// Drive modulation source.
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Bit-depth and sample-rate reduction over an audio term.
    Bitcrush {
        /// Normalized bit depth (0-1 → 1..16 bits).
        bits: f64,
        /// Normalized sample-rate reduction (0-1).
        downsample: f64,
        /// Normalized modulation depth (0-1).
        mod_depth: f64,
        /// Audio input.
        input: Box<AudioNode>,
        /// Bit-depth modulation source.
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Swept allpass phaser over an audio term.
    Phaser {
        /// Normalized sweep rate (0-1).
        rate: f64,
        /// Normalized sweep depth (0-1).
        depth: f64,
        /// Normalized resonance feedback (0-1, mapped bipolar and bounded).
        feedback: f64,
        /// Normalized modulation depth (0-1).
        mod_depth: f64,
        /// Audio input.
        input: Box<AudioNode>,
        /// Sweep-depth modulation source.
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Flanging comb over an audio term: a 1–10 ms swept delay against the
    /// dry signal, with signed feedback. Stereo — its `spread` decorrelates
    /// the two sweeps, exactly as the phaser's does.
    Flanger {
        /// Normalized sweep rate (0-1).
        rate: f64,
        /// Normalized sweep depth (0-1).
        depth: f64,
        /// Normalized feedback (0-1, mapped bipolar and bounded — the sign is
        /// a timbre, as on the phaser).
        feedback: f64,
        /// Normalized modulation depth (0-1).
        mod_depth: f64,
        /// Audio input.
        input: Box<AudioNode>,
        /// Sweep-depth modulation source.
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Amplitude modulation over an audio term, sine-to-triangle.
    Tremolo {
        /// Normalized LFO rate (0-1).
        rate: f64,
        /// Normalized depth (0-1).
        depth: f64,
        /// Normalized waveform blend (0 = sine, 1 = triangle).
        shape: f64,
        /// Normalized modulation depth (0-1).
        mod_depth: f64,
        /// Audio input.
        input: Box<AudioNode>,
        /// Depth modulation source.
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Pitch wobble over an audio term (a modulated delay read).
    ///
    /// The distinction from [`AudioNode::Chorus`] is `mix`: a half-wet
    /// vibrato *is* a chorus, because the dry and the pitch-shifted copies
    /// beat against each other. This module earns its place by running wet.
    Vibrato {
        /// Normalized LFO rate (0-1).
        rate: f64,
        /// Normalized depth (0-1).
        depth: f64,
        /// Normalized wet/dry mix (0-1; 1 is the module's own idiom).
        mix: f64,
        /// Normalized modulation depth (0-1).
        mod_depth: f64,
        /// Audio input.
        input: Box<AudioNode>,
        /// Depth modulation source.
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Three-band tone control over an audio term (low shelf, parametric mid,
    /// high shelf), each ±12 dB with unity at the knob's centre.
    Eq {
        /// Normalized low-shelf gain (0-1; 0.5 is 0 dB).
        low: f64,
        /// Normalized mid-bell gain (0-1; 0.5 is 0 dB).
        mid: f64,
        /// Normalized high-shelf gain (0-1; 0.5 is 0 dB).
        high: f64,
        /// Normalized modulation depth (0-1).
        mod_depth: f64,
        /// Audio input.
        input: Box<AudioNode>,
        /// Mid-gain modulation source.
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Granular re-reading of an audio term: overlapping Hann-windowed grains
    /// taken from a rolling buffer of what the input just played.
    Granular {
        /// Normalized playback position in the buffer (0-1).
        position: f64,
        /// Normalized grain size (0-1 → 10..500 ms).
        size: f64,
        /// Normalized grain density (0-1 → 1..20 grains/second).
        density: f64,
        /// Normalized modulation depth (0-1).
        mod_depth: f64,
        /// Audio input.
        input: Box<AudioNode>,
        /// Position modulation source.
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Ring modulation of two audio terms, crossfaded against the dry
    /// carrier. The grammar's **second** binary node.
    RingMod {
        /// Normalized dry/ring balance (0 = all carrier, 1 = all ring).
        mix: f64,
        /// Carrier (also the dry side of the crossfade).
        a: Box<AudioNode>,
        /// Modulator.
        b: Box<AudioNode>,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Grain-based pitch shifter over an audio term: two Hann-windowed grains
    /// read from a rolling buffer at a resampled rate.
    ///
    /// Unary, unlike the four modules below it. Wave one cut it alongside the
    /// compressor and the vocoder on the belief that it needed a second audio
    /// input; it does not — quiver's `PitchShifter` is `in`/`shift`/`window`/
    /// `mix`, one signal in and one out.
    Shift {
        /// Normalized transposition (0-1; 0.5 is unison, the ends are ∓12
        /// semitones).
        semis: f64,
        /// Normalized grain window (0-1 → 10..100 ms).
        window: f64,
        /// Normalized wet/dry mix (0-1).
        mix: f64,
        /// Normalized modulation depth (0-1).
        mod_depth: f64,
        /// Audio input.
        input: Box<AudioNode>,
        /// Transposition modulation source.
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Compressor whose detector runs on a **second** audio term: the
    /// grammar's third binary node, and the first whose `/1` branch is heard
    /// only as a control.
    ///
    /// The four binary nodes below all follow [`AudioNode::Mix`]'s child
    /// order: `/0` is the signal you hear, `/1` the signal that shapes it.
    Comp {
        /// Normalized threshold (0-1 → 0..5 V of detector level).
        threshold: f64,
        /// Normalized ratio (0-1 → 1:1..20:1).
        ratio: f64,
        /// Normalized makeup gain (0-1 → 1×..4×).
        makeup: f64,
        /// Normalized modulation depth (0-1).
        mod_depth: f64,
        /// The signal being compressed.
        input: Box<AudioNode>,
        /// The signal the detector listens to.
        sidechain: Box<AudioNode>,
        /// Threshold modulation source.
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Ducker: a key signal pulls the main signal down, in proportion to how
    /// far the key's envelope sits above the threshold.
    ///
    /// The difference from [`AudioNode::Comp`] is what the gain reduction is
    /// proportional to — a compressor reduces by the *excess over* the
    /// threshold in dB, a ducker by the key's level *relative to* it, up to a
    /// fixed depth. That is the sidechain-pump gesture rather than dynamics
    /// control, and it is the one people actually reach for.
    Duck {
        /// Normalized duck depth (0-1; 1 is full attenuation on a loud key).
        amount: f64,
        /// Normalized key level for full ducking (0-1 → 0..5 V).
        threshold: f64,
        /// Normalized recovery time (0-1 → 10..1000 ms).
        release: f64,
        /// Normalized modulation depth (0-1).
        mod_depth: f64,
        /// The signal being ducked.
        input: Box<AudioNode>,
        /// The key that ducks it.
        key: Box<AudioNode>,
        /// Duck-amount modulation source.
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Noise gate keyed by a second audio term.
    Gate {
        /// Normalized open threshold (0-1 → 0..5 V of detector level).
        threshold: f64,
        /// Normalized gate range (0-1; 1 closes to silence, 0 is a no-op).
        range: f64,
        /// Normalized release time (0-1 → 10..500 ms).
        release: f64,
        /// Normalized modulation depth (0-1).
        mod_depth: f64,
        /// The signal being gated.
        input: Box<AudioNode>,
        /// The signal that opens the gate.
        sidechain: Box<AudioNode>,
        /// Threshold modulation source.
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
    /// Vocoder: a bank of bandpass filters whose per-band envelopes are taken
    /// from the **modulator** and imposed on the **carrier**.
    ///
    /// Both branches are audible in the sense that both shape the output, but
    /// only the carrier's *waveform* reaches it — the modulator contributes
    /// its spectral envelope and nothing else, which is why `/1` is still the
    /// control side under this family's child-order convention.
    Vocoder {
        /// Normalized band count (0-1 → 4..16 bands).
        bands: f64,
        /// Normalized envelope attack (0-1 → 10..200 ms).
        attack: f64,
        /// Normalized envelope release (0-1 → 10..200 ms).
        release: f64,
        /// Normalized modulation depth (0-1).
        mod_depth: f64,
        /// The signal that is spectrally shaped (wants harmonic richness).
        carrier: Box<AudioNode>,
        /// The signal whose spectrum is measured (wants formants).
        modulator: Box<AudioNode>,
        /// Band-count modulation source.
        modulation: ModNode,
        /// Stable identity for this node; see [`Uid`].
        #[serde(default, skip_serializing_if = "Uid::is_new")]
        uid: Uid,
    },
}

/// The mandatory amplitude envelope on every voice (ADSR, normalized 0-1).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AmpEnv {
    /// Normalized attack.
    pub attack: f64,
    /// Normalized decay.
    pub decay: f64,
    /// Normalized sustain level.
    pub sustain: f64,
    /// Normalized release.
    pub release: f64,
}

/// A complete patch genome: an audio term wrapped in the mandatory voice
/// stage (amp ADSR → VCA → limiter → stereo out, added by the compiler).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PatchTree {
    /// Amplitude envelope parameters.
    pub amp: AmpEnv,
    /// The evolved audio-term tree.
    pub root: AudioNode,
}

impl ModNode {
    /// This term's stable identity — `None` for [`ModNode::None`], which is an
    /// empty slot rather than a module.
    pub fn uid(&self) -> Option<Uid> {
        macro_rules! arms {
            ($($v:ident),*) => {
                match self { $(ModNode::$v { uid, .. } => Some(*uid),)* ModNode::None => None }
            };
        }
        mod_variants!(arms)
    }

    /// Overwrite this term's identity (a no-op on [`ModNode::None`]).
    pub fn set_uid(&mut self, id: Uid) {
        macro_rules! arms {
            ($($v:ident),*) => {
                match self { $(ModNode::$v { uid, .. } => *uid = id,)* ModNode::None => {} }
            };
        }
        mod_variants!(arms)
    }

    /// Sub-terms in key-index order (`Op`'s input is `/0`; a `Pair`'s two
    /// branches are `/0` and `/1`).
    pub fn children(&self) -> Vec<&ModNode> {
        match self {
            ModNode::Op { input, .. } => vec![input],
            ModNode::Pair { a, b, .. } => vec![a, b],
            _ => Vec::new(),
        }
    }

    /// Mutable [`Self::children`].
    pub fn children_mut(&mut self) -> Vec<&mut ModNode> {
        match self {
            ModNode::Op { input, .. } => vec![input],
            ModNode::Pair { a, b, .. } => vec![a, b],
            _ => Vec::new(),
        }
    }

    /// Number of probabilistic-choice sites this mod term occupies.
    pub fn site_count(&self) -> usize {
        match self {
            ModNode::None => 1,          // #mod
            ModNode::Lfo { .. } => 3,    // #mod #wave #rate
            ModNode::Env { .. } => 3,    // #mod #att #dec
            ModNode::Rand { .. } => 3,   // #mod #rate #glide
            ModNode::Follow { .. } => 3, // #mod #sens #rel
            // #mod #erate #esteps #epulses
            ModNode::Euclid { .. } => 4,
            // #mod #modop, the op's own knobs, then the subterm.
            ModNode::Op { kind, input, .. } => 2 + kind.param_sites().len() + input.site_count(),
            // #mod #pairop and two subterms — no continuous sites of its own.
            ModNode::Pair { a, b, .. } => 2 + a.site_count() + b.site_count(),
        }
    }

    /// Nesting depth of this modulation term: an empty slot is 0, a leaf is 1,
    /// and every processor above one adds a level.
    ///
    /// This is the quantity [`crate::prior::PatchGrammarPrior::max_mod_depth`]
    /// bounds and that `φ`'s `mod_depth_mean` averages.
    pub fn depth(&self) -> usize {
        match self {
            ModNode::None => 0,
            ModNode::Lfo { .. }
            | ModNode::Env { .. }
            | ModNode::Rand { .. }
            | ModNode::Follow { .. }
            | ModNode::Euclid { .. } => 1,
            ModNode::Op { input, .. } => 1 + input.depth(),
            ModNode::Pair { a, b, .. } => 1 + a.depth().max(b.depth()),
        }
    }

    /// Number of nodes in this modulation term (an empty slot is 0).
    pub fn size(&self) -> usize {
        match self {
            ModNode::None => 0,
            ModNode::Op { input, .. } => 1 + input.size(),
            ModNode::Pair { a, b, .. } => 1 + a.size() + b.size(),
            _ => 1,
        }
    }

    /// The canonical form of a hand-built modulation term.
    ///
    /// Two normalizations, both of which the prior enforces by construction
    /// (it renormalizes the `#mod` categorical over the non-empty kinds below
    /// an `Op` or inside a `Pair`) but which an explicit term arriving from
    /// the panel through
    /// [`StructOp::SetModTree`](crate::mutate::StructOp::SetModTree) can
    /// violate:
    ///
    /// - **A processor over nothing is nothing.** `Op` with an empty input is
    ///   a quantizer fed 0 V; `Pair` with two empty inputs is a logic gate
    ///   fed two zeroes. Both compile to a cable carrying a constant, which is
    ///   a module on the rack that does nothing. A `Pair` with *one* empty
    ///   input collapses to the other side rather than to nothing — `And(x, 0)`
    ///   is identically low and `Min(x, 0)` throws away the positive half, so
    ///   there is no reading under which the empty branch is a musical choice.
    /// - **An unused parameter is pinned to 0.** [`ModOp::param_sites`] does
    ///   not encode `p1` for the one-parameter ops, so a term carrying a
    ///   non-zero one would not survive its own trace round-trip.
    ///
    /// Folding here rather than in the prior is deliberate: the generative
    /// model and [`crate::genome`]'s encoding are asserted site-for-site
    /// identical, so a prior that *sampled* a degenerate term and then folded
    /// it would emit choices the encoding does not.
    pub fn normalized(self) -> ModNode {
        match self {
            ModNode::Op {
                kind,
                p0,
                p1,
                input,
                ..
            } => match input.normalized() {
                ModNode::None => ModNode::None,
                input => ModNode::Op {
                    uid: Uid::NEW,
                    kind,
                    p0,
                    p1: if kind.param_sites().len() > 1 {
                        p1
                    } else {
                        0.0
                    },
                    input: Box::new(input),
                },
            },
            ModNode::Pair { kind, a, b, .. } => match (a.normalized(), b.normalized()) {
                (ModNode::None, ModNode::None) => ModNode::None,
                (a, ModNode::None) => a,
                (ModNode::None, b) => b,
                (a, b) => ModNode::Pair {
                    uid: Uid::NEW,
                    kind,
                    a: Box::new(a),
                    b: Box::new(b),
                },
            },
            leaf => leaf,
        }
    }
}

impl AudioNode {
    /// This node's stable identity ([`Uid::NEW`] until the tree is settled).
    pub fn uid(&self) -> Uid {
        macro_rules! arms {
            ($($v:ident),*) => { match self { $(AudioNode::$v { uid, .. } => *uid,)* } };
        }
        audio_variants!(arms)
    }

    /// Overwrite this node's identity. Only the settling and inheritance
    /// passes have any business calling this.
    pub fn set_uid(&mut self, id: Uid) {
        macro_rules! arms {
            ($($v:ident),*) => { match self { $(AudioNode::$v { uid, .. } => *uid = id,)* } };
        }
        audio_variants!(arms)
    }

    /// Audio children in **key-index order** — the same `/0`, `/1` order
    /// `mutate::child_mut`, `describe` and `genome` all use, so index `i` here
    /// and the key segment `i` there address the same node.
    pub fn children(&self) -> Vec<&AudioNode> {
        match self {
            AudioNode::Mix { a, b, .. } | AudioNode::RingMod { a, b, .. } => vec![a, b],
            AudioNode::Comp {
                input,
                sidechain: other,
                ..
            }
            | AudioNode::Gate {
                input,
                sidechain: other,
                ..
            }
            | AudioNode::Duck {
                input, key: other, ..
            }
            | AudioNode::Vocoder {
                carrier: input,
                modulator: other,
                ..
            } => vec![input, other],
            AudioNode::Shift { input, .. }
            | AudioNode::Filter { input, .. }
            | AudioNode::Fold { input, .. }
            | AudioNode::Delay { input, .. }
            | AudioNode::Chorus { input, .. }
            | AudioNode::Reverb { input, .. }
            | AudioNode::Distortion { input, .. }
            | AudioNode::Bitcrush { input, .. }
            | AudioNode::Phaser { input, .. }
            | AudioNode::Flanger { input, .. }
            | AudioNode::Tremolo { input, .. }
            | AudioNode::Vibrato { input, .. }
            | AudioNode::Eq { input, .. }
            | AudioNode::Granular { input, .. } => vec![input],
            // The sources. Spelled out rather than caught by a wildcard so
            // that a new production cannot quietly become childless — and so
            // become invisible to identity — by being forgotten here.
            AudioNode::Vco { .. }
            | AudioNode::Supersaw { .. }
            | AudioNode::Noise { .. }
            | AudioNode::Wavetable { .. }
            | AudioNode::Pluck { .. }
            | AudioNode::Formant { .. } => Vec::new(),
        }
    }

    /// Mutable [`Self::children`].
    pub fn children_mut(&mut self) -> Vec<&mut AudioNode> {
        match self {
            AudioNode::Mix { a, b, .. } | AudioNode::RingMod { a, b, .. } => vec![a, b],
            AudioNode::Comp {
                input,
                sidechain: other,
                ..
            }
            | AudioNode::Gate {
                input,
                sidechain: other,
                ..
            }
            | AudioNode::Duck {
                input, key: other, ..
            }
            | AudioNode::Vocoder {
                carrier: input,
                modulator: other,
                ..
            } => vec![input, other],
            AudioNode::Shift { input, .. }
            | AudioNode::Filter { input, .. }
            | AudioNode::Fold { input, .. }
            | AudioNode::Delay { input, .. }
            | AudioNode::Chorus { input, .. }
            | AudioNode::Reverb { input, .. }
            | AudioNode::Distortion { input, .. }
            | AudioNode::Bitcrush { input, .. }
            | AudioNode::Phaser { input, .. }
            | AudioNode::Flanger { input, .. }
            | AudioNode::Tremolo { input, .. }
            | AudioNode::Vibrato { input, .. }
            | AudioNode::Eq { input, .. }
            | AudioNode::Granular { input, .. } => vec![input],
            // The sources. Spelled out rather than caught by a wildcard so
            // that a new production cannot quietly become childless — and so
            // become invisible to identity — by being forgotten here.
            AudioNode::Vco { .. }
            | AudioNode::Supersaw { .. }
            | AudioNode::Noise { .. }
            | AudioNode::Wavetable { .. }
            | AudioNode::Pluck { .. }
            | AudioNode::Formant { .. } => Vec::new(),
        }
    }

    /// The modulation term hanging off this node's one mod slot, if the module
    /// has one (`Mix`, `RingMod`, `Noise` and `Shift` do not).
    pub fn modulation(&self) -> Option<&ModNode> {
        macro_rules! arms {
            ($($v:ident),*) => {
                match self {
                    $(AudioNode::$v { modulation, .. } => Some(modulation),)*
                    // The three productions with nothing worth modulating:
                    // `Noise` has only a colour, and `Mix`/`RingMod` have two
                    // audio inputs and a blend. Named rather than wildcarded so
                    // a new module with a slot cannot silently land here.
                    AudioNode::Noise { .. }
                    | AudioNode::Mix { .. }
                    | AudioNode::RingMod { .. } => None,
                }
            };
        }
        modulated_variants!(arms)
    }

    /// Mutable [`Self::modulation`].
    pub fn modulation_mut(&mut self) -> Option<&mut ModNode> {
        macro_rules! arms {
            ($($v:ident),*) => {
                match self {
                    $(AudioNode::$v { modulation, .. } => Some(modulation),)*
                    // The three productions with nothing worth modulating:
                    // `Noise` has only a colour, and `Mix`/`RingMod` have two
                    // audio inputs and a blend. Named rather than wildcarded so
                    // a new module with a slot cannot silently land here.
                    AudioNode::Noise { .. }
                    | AudioNode::Mix { .. }
                    | AudioNode::RingMod { .. } => None,
                }
            };
        }
        modulated_variants!(arms)
    }

    /// Tree depth (a source leaf is depth 1).
    pub fn depth(&self) -> usize {
        match self {
            AudioNode::Vco { .. }
            | AudioNode::Supersaw { .. }
            | AudioNode::Noise { .. }
            | AudioNode::Wavetable { .. }
            | AudioNode::Pluck { .. }
            | AudioNode::Formant { .. } => 1,
            AudioNode::Mix { a, b, .. } | AudioNode::RingMod { a, b, .. } => {
                1 + a.depth().max(b.depth())
            }
            // The control branch is a full audio subtree that has to be built
            // and rendered, so it counts toward depth exactly as a mixer's
            // second input does — the render budget cannot tell the two apart.
            AudioNode::Comp {
                input,
                sidechain: other,
                ..
            }
            | AudioNode::Gate {
                input,
                sidechain: other,
                ..
            }
            | AudioNode::Duck {
                input, key: other, ..
            }
            | AudioNode::Vocoder {
                carrier: input,
                modulator: other,
                ..
            } => 1 + input.depth().max(other.depth()),
            AudioNode::Shift { input, .. }
            | AudioNode::Filter { input, .. }
            | AudioNode::Fold { input, .. }
            | AudioNode::Delay { input, .. }
            | AudioNode::Chorus { input, .. }
            | AudioNode::Reverb { input, .. }
            | AudioNode::Distortion { input, .. }
            | AudioNode::Bitcrush { input, .. }
            | AudioNode::Phaser { input, .. }
            | AudioNode::Flanger { input, .. }
            | AudioNode::Tremolo { input, .. }
            | AudioNode::Vibrato { input, .. }
            | AudioNode::Eq { input, .. }
            | AudioNode::Granular { input, .. } => 1 + input.depth(),
        }
    }

    /// Number of audio nodes in the tree.
    pub fn size(&self) -> usize {
        match self {
            AudioNode::Vco { .. }
            | AudioNode::Supersaw { .. }
            | AudioNode::Noise { .. }
            | AudioNode::Wavetable { .. }
            | AudioNode::Pluck { .. }
            | AudioNode::Formant { .. } => 1,
            AudioNode::Mix { a, b, .. } | AudioNode::RingMod { a, b, .. } => {
                1 + a.size() + b.size()
            }
            AudioNode::Comp {
                input,
                sidechain: other,
                ..
            }
            | AudioNode::Gate {
                input,
                sidechain: other,
                ..
            }
            | AudioNode::Duck {
                input, key: other, ..
            }
            | AudioNode::Vocoder {
                carrier: input,
                modulator: other,
                ..
            } => 1 + input.size() + other.size(),
            AudioNode::Shift { input, .. }
            | AudioNode::Filter { input, .. }
            | AudioNode::Fold { input, .. }
            | AudioNode::Delay { input, .. }
            | AudioNode::Chorus { input, .. }
            | AudioNode::Reverb { input, .. }
            | AudioNode::Distortion { input, .. }
            | AudioNode::Bitcrush { input, .. }
            | AudioNode::Phaser { input, .. }
            | AudioNode::Flanger { input, .. }
            | AudioNode::Tremolo { input, .. }
            | AudioNode::Vibrato { input, .. }
            | AudioNode::Eq { input, .. }
            | AudioNode::Granular { input, .. } => 1 + input.size(),
        }
    }

    /// Number of probabilistic-choice sites in this subtree (including the
    /// structural `#leaf`/`#src`/`#op` sites and any modulation subterm).
    pub fn site_count(&self) -> usize {
        // Every node carries #leaf plus either #src or #op.
        match self {
            // #wave #oct #det #mdepth
            AudioNode::Vco { modulation, .. } => 2 + 4 + modulation.site_count(),
            // #oct #det #smix #mdepth
            AudioNode::Supersaw { modulation, .. } => 2 + 4 + modulation.site_count(),
            AudioNode::Noise { .. } => 2 + 1, // #color
            // #vowel #fshift #oct #mdepth
            AudioNode::Formant { modulation, .. } => 2 + 4 + modulation.site_count(),
            AudioNode::Wavetable { modulation, .. } => 2 + 4 + modulation.site_count(), // #table #oct #morph #mdepth
            AudioNode::Pluck { modulation, .. } => 2 + 4 + modulation.site_count(), // #oct #damp #bright #mdepth
            AudioNode::Mix { a, b, .. } => 2 + 1 + a.site_count() + b.site_count(),
            AudioNode::RingMod { a, b, .. } => 2 + 1 + a.site_count() + b.site_count(),
            AudioNode::Filter {
                input, modulation, ..
            } => 2 + 4 + input.site_count() + modulation.site_count(),
            AudioNode::Fold {
                input, modulation, ..
            } => 2 + 2 + input.site_count() + modulation.site_count(),
            AudioNode::Delay {
                input, modulation, ..
            } => 2 + 4 + input.site_count() + modulation.site_count(),
            AudioNode::Chorus {
                input, modulation, ..
            } => 2 + 4 + input.site_count() + modulation.site_count(),
            AudioNode::Reverb {
                input, modulation, ..
            } => 2 + 4 + input.site_count() + modulation.site_count(),
            AudioNode::Distortion {
                input, modulation, ..
            } => 2 + 4 + input.site_count() + modulation.site_count(),
            AudioNode::Bitcrush {
                input, modulation, ..
            } => 2 + 3 + input.site_count() + modulation.site_count(),
            AudioNode::Phaser {
                input, modulation, ..
            } => 2 + 4 + input.site_count() + modulation.site_count(),
            AudioNode::Flanger {
                input, modulation, ..
            } => 2 + 4 + input.site_count() + modulation.site_count(),
            AudioNode::Tremolo {
                input, modulation, ..
            } => 2 + 4 + input.site_count() + modulation.site_count(),
            AudioNode::Vibrato {
                input, modulation, ..
            } => 2 + 4 + input.site_count() + modulation.site_count(),
            AudioNode::Eq {
                input, modulation, ..
            } => 2 + 4 + input.site_count() + modulation.site_count(),
            AudioNode::Granular {
                input, modulation, ..
            } => 2 + 4 + input.site_count() + modulation.site_count(),
            // #semis #window #smix #mdepth
            AudioNode::Shift {
                input, modulation, ..
            } => 2 + 4 + input.site_count() + modulation.site_count(),
            // Four knobs plus a modulation subterm, as the unary processors
            // have — and *two* audio subterms, as the binary ones do.
            AudioNode::Comp {
                input,
                sidechain,
                modulation,
                ..
            } => 2 + 4 + input.site_count() + sidechain.site_count() + modulation.site_count(),
            AudioNode::Duck {
                input,
                key,
                modulation,
                ..
            } => 2 + 4 + input.site_count() + key.site_count() + modulation.site_count(),
            AudioNode::Gate {
                input,
                sidechain,
                modulation,
                ..
            } => 2 + 4 + input.site_count() + sidechain.site_count() + modulation.site_count(),
            AudioNode::Vocoder {
                carrier,
                modulator,
                modulation,
                ..
            } => 2 + 4 + carrier.site_count() + modulator.site_count() + modulation.site_count(),
        }
    }

    /// Compact s-expression rendering for logs and tests.
    pub fn to_sexpr(&self) -> String {
        match self {
            AudioNode::Vco {
                wave,
                octave,
                detune,
                modulation,
                ..
            } => format!(
                "(vco {} {octave:+} {detune:.2} {})",
                wave.port_name(),
                mod_sexpr(modulation)
            ),
            AudioNode::Supersaw {
                octave,
                detune,
                mix,
                modulation,
                ..
            } => format!(
                "(supersaw {octave:+} {detune:.2} {mix:.2} {})",
                mod_sexpr(modulation)
            ),
            AudioNode::Noise { color, .. } => format!("(noise {})", color.port_name()),
            AudioNode::Formant {
                vowel,
                shift,
                octave,
                modulation,
                ..
            } => format!(
                "(formant v={vowel:.2} s={shift:.2} {octave:+} {})",
                mod_sexpr(modulation)
            ),
            AudioNode::Wavetable {
                table,
                octave,
                morph,
                modulation,
                ..
            } => format!(
                "(wavetable {} {octave:+} m={morph:.2} {})",
                table.label(),
                mod_sexpr(modulation)
            ),
            AudioNode::Pluck {
                octave,
                damping,
                brightness,
                modulation,
                ..
            } => format!(
                "(pluck {octave:+} d={damping:.2} b={brightness:.2} {})",
                mod_sexpr(modulation)
            ),
            AudioNode::Mix { balance, a, b, .. } => {
                format!("(mix {balance:.2} {} {})", a.to_sexpr(), b.to_sexpr())
            }
            AudioNode::RingMod { mix, a, b, .. } => {
                format!("(ringmod {mix:.2} {} {})", a.to_sexpr(), b.to_sexpr())
            }
            AudioNode::Filter {
                kind,
                cutoff,
                resonance,
                input,
                modulation,
                ..
            } => format!(
                "(filter {kind:?} c={cutoff:.2} r={resonance:.2} {} {})",
                mod_sexpr(modulation),
                input.to_sexpr()
            ),
            AudioNode::Fold {
                threshold,
                input,
                modulation,
                ..
            } => format!(
                "(fold t={threshold:.2} {} {})",
                mod_sexpr(modulation),
                input.to_sexpr()
            ),
            AudioNode::Delay {
                time,
                feedback,
                mix,
                input,
                modulation,
                ..
            } => format!(
                "(delay t={time:.2} fb={feedback:.2} mix={mix:.2} {} {})",
                mod_sexpr(modulation),
                input.to_sexpr()
            ),
            AudioNode::Chorus {
                rate,
                depth,
                mix,
                input,
                modulation,
                ..
            } => format!(
                "(chorus r={rate:.2} d={depth:.2} mix={mix:.2} {} {})",
                mod_sexpr(modulation),
                input.to_sexpr()
            ),
            AudioNode::Reverb {
                size,
                damp,
                mix,
                input,
                modulation,
                ..
            } => format!(
                "(reverb s={size:.2} d={damp:.2} mix={mix:.2} {} {})",
                mod_sexpr(modulation),
                input.to_sexpr()
            ),
            AudioNode::Distortion {
                drive,
                tone,
                mode,
                input,
                modulation,
                ..
            } => format!(
                "(dist {} g={drive:.2} t={tone:.2} {} {})",
                mode.label(),
                mod_sexpr(modulation),
                input.to_sexpr()
            ),
            AudioNode::Bitcrush {
                bits,
                downsample,
                input,
                modulation,
                ..
            } => format!(
                "(bitcrush b={bits:.2} r={downsample:.2} {} {})",
                mod_sexpr(modulation),
                input.to_sexpr()
            ),
            AudioNode::Phaser {
                rate,
                depth,
                feedback,
                input,
                modulation,
                ..
            } => format!(
                "(phaser r={rate:.2} d={depth:.2} fb={feedback:.2} {} {})",
                mod_sexpr(modulation),
                input.to_sexpr()
            ),
            AudioNode::Flanger {
                rate,
                depth,
                feedback,
                input,
                modulation,
                ..
            } => format!(
                "(flanger r={rate:.2} d={depth:.2} fb={feedback:.2} {} {})",
                mod_sexpr(modulation),
                input.to_sexpr()
            ),
            AudioNode::Tremolo {
                rate,
                depth,
                shape,
                input,
                modulation,
                ..
            } => format!(
                "(tremolo r={rate:.2} d={depth:.2} s={shape:.2} {} {})",
                mod_sexpr(modulation),
                input.to_sexpr()
            ),
            AudioNode::Vibrato {
                rate,
                depth,
                mix,
                input,
                modulation,
                ..
            } => format!(
                "(vibrato r={rate:.2} d={depth:.2} mix={mix:.2} {} {})",
                mod_sexpr(modulation),
                input.to_sexpr()
            ),
            AudioNode::Eq {
                low,
                mid,
                high,
                input,
                modulation,
                ..
            } => format!(
                "(eq l={low:.2} m={mid:.2} h={high:.2} {} {})",
                mod_sexpr(modulation),
                input.to_sexpr()
            ),
            AudioNode::Granular {
                position,
                size,
                density,
                input,
                modulation,
                ..
            } => format!(
                "(granular p={position:.2} s={size:.2} d={density:.2} {} {})",
                mod_sexpr(modulation),
                input.to_sexpr()
            ),
            AudioNode::Shift {
                semis,
                window,
                mix,
                input,
                modulation,
                ..
            } => format!(
                "(shift s={semis:.2} w={window:.2} mix={mix:.2} {} {})",
                mod_sexpr(modulation),
                input.to_sexpr()
            ),
            AudioNode::Comp {
                threshold,
                ratio,
                makeup,
                input,
                sidechain,
                modulation,
                ..
            } => format!(
                "(comp t={threshold:.2} r={ratio:.2} m={makeup:.2} {} {} {})",
                mod_sexpr(modulation),
                input.to_sexpr(),
                sidechain.to_sexpr()
            ),
            AudioNode::Duck {
                amount,
                threshold,
                release,
                input,
                key,
                modulation,
                ..
            } => format!(
                "(duck a={amount:.2} t={threshold:.2} r={release:.2} {} {} {})",
                mod_sexpr(modulation),
                input.to_sexpr(),
                key.to_sexpr()
            ),
            AudioNode::Gate {
                threshold,
                range,
                release,
                input,
                sidechain,
                modulation,
                ..
            } => format!(
                "(gate t={threshold:.2} rg={range:.2} r={release:.2} {} {} {})",
                mod_sexpr(modulation),
                input.to_sexpr(),
                sidechain.to_sexpr()
            ),
            AudioNode::Vocoder {
                bands,
                attack,
                release,
                carrier,
                modulator,
                modulation,
                ..
            } => format!(
                "(vocoder b={bands:.2} a={attack:.2} r={release:.2} {} {} {})",
                mod_sexpr(modulation),
                carrier.to_sexpr(),
                modulator.to_sexpr()
            ),
        }
    }
}

fn mod_sexpr(m: &ModNode) -> String {
    match m {
        ModNode::None => "nomod".to_string(),
        ModNode::Lfo { wave, rate, .. } => format!("(lfo {} {rate:.2})", wave.port_name()),
        ModNode::Env { attack, decay, .. } => format!("(env a={attack:.2} d={decay:.2})"),
        ModNode::Rand { rate, glide, .. } => format!("(rand r={rate:.2} g={glide:.2})"),
        ModNode::Follow { sens, release, .. } => format!("(follow s={sens:.2} r={release:.2})"),
        ModNode::Euclid {
            rate,
            steps,
            pulses,
            ..
        } => format!("(euclid r={rate:.2} s={steps:.2} p={pulses:.2})"),
        ModNode::Op {
            kind,
            p0,
            p1,
            input,
            ..
        } => match kind.param_sites().len() {
            1 => format!("({} {p0:.2} {})", kind.label(), mod_sexpr(input)),
            _ => format!("({} {p0:.2} {p1:.2} {})", kind.label(), mod_sexpr(input)),
        },
        ModNode::Pair { kind, a, b, .. } => {
            format!("({} {} {})", kind.label(), mod_sexpr(a), mod_sexpr(b))
        }
    }
}

fn spine_tags(n: &AudioNode, out: &mut Vec<&'static str>) {
    match n {
        AudioNode::Vco { wave, .. } => out.push(wave.port_name()),
        AudioNode::Supersaw { .. } => out.push("ssaw"),
        AudioNode::Noise { .. } => out.push("noiz"),
        AudioNode::Wavetable { table, .. } => out.push(match table {
            TableShape::Sine => "wsin",
            TableShape::Tri => "wtri",
            TableShape::Saw => "wsaw",
            TableShape::Square => "wsqr",
            TableShape::Pulse25 | TableShape::Pulse12 => "wpul",
            TableShape::FormantA | TableShape::FormantO => "wfmt",
        }),
        AudioNode::Pluck { .. } => out.push("plk"),
        AudioNode::Formant { .. } => out.push("vox"),
        AudioNode::Mix { a, .. } => {
            spine_tags(a, out);
            out.push("mix");
        }
        // The carrier is the spine; the modulator is a side branch, exactly as
        // for `Mix`.
        AudioNode::RingMod { a, .. } => {
            spine_tags(a, out);
            out.push("ring");
        }
        AudioNode::Filter { kind, input, .. } => {
            spine_tags(input, out);
            out.push(match kind {
                FilterKind::Ladder => "ladr",
                FilterKind::SvfLp => "lp",
                FilterKind::SvfBp => "bp",
                FilterKind::SvfHp => "hp",
            });
        }
        AudioNode::Fold { input, .. } => {
            spine_tags(input, out);
            out.push("fold");
        }
        AudioNode::Delay { input, .. } => {
            spine_tags(input, out);
            out.push("dly");
        }
        AudioNode::Chorus { input, .. } => {
            spine_tags(input, out);
            out.push("cho");
        }
        AudioNode::Reverb { input, .. } => {
            spine_tags(input, out);
            out.push("rvb");
        }
        AudioNode::Distortion { input, mode, .. } => {
            spine_tags(input, out);
            out.push(match mode {
                DriveMode::Soft => "drv",
                DriveMode::Hard => "clip",
                DriveMode::Tube => "tube",
            });
        }
        AudioNode::Bitcrush { input, .. } => {
            spine_tags(input, out);
            out.push("crsh");
        }
        AudioNode::Phaser { input, .. } => {
            spine_tags(input, out);
            out.push("phsr");
        }
        AudioNode::Flanger { input, .. } => {
            spine_tags(input, out);
            out.push("flng");
        }
        AudioNode::Tremolo { input, .. } => {
            spine_tags(input, out);
            out.push("trem");
        }
        AudioNode::Vibrato { input, .. } => {
            spine_tags(input, out);
            out.push("vib");
        }
        AudioNode::Eq { input, .. } => {
            spine_tags(input, out);
            out.push("eq");
        }
        AudioNode::Granular { input, .. } => {
            spine_tags(input, out);
            out.push("gran");
        }
        AudioNode::Shift { input, .. } => {
            spine_tags(input, out);
            out.push("shft");
        }
        // `/0` is the spine and `/1` the side branch, exactly as for `Mix` and
        // `RingMod` — and here the convention is not just a convention: the
        // control branch is never heard on its own.
        AudioNode::Comp { input, .. } => {
            spine_tags(input, out);
            out.push("comp");
        }
        AudioNode::Duck { input, .. } => {
            spine_tags(input, out);
            out.push("duck");
        }
        AudioNode::Gate { input, .. } => {
            spine_tags(input, out);
            out.push("gate");
        }
        AudioNode::Vocoder { carrier, .. } => {
            spine_tags(carrier, out);
            out.push("voc");
        }
    }
}

impl PatchTree {
    /// Total probabilistic-choice sites (amp envelope + tree).
    pub fn site_count(&self) -> usize {
        4 + self.root.site_count()
    }

    /// Short human-readable signature along the main signal spine
    /// (`saw·ladr·dly`) — the default display name for unnamed patches.
    pub fn signature(&self) -> String {
        let mut tags = Vec::new();
        spine_tags(&self.root, &mut tags);
        if tags.len() > 4 {
            let skipped = tags.len() - 4;
            let tail: Vec<&str> = tags[skipped..].to_vec();
            format!("{}+·{}", skipped, tail.join("·"))
        } else {
            tags.join("·")
        }
    }

    /// Compact s-expression rendering for logs and tests.
    pub fn to_sexpr(&self) -> String {
        format!(
            "(voice a={:.2} d={:.2} s={:.2} r={:.2} {})",
            self.amp.attack,
            self.amp.decay,
            self.amp.sustain,
            self.amp.release,
            self.root.to_sexpr()
        )
    }

    /// Give every node that still lacks an identity a fresh one, and break any
    /// duplicates.
    ///
    /// This is the *settle* step: the point at which an anonymous tree becomes
    /// a thing a person can point at. Call it wherever a tree is adopted —
    /// admitted to the pool, put on the bench, restored from a save, arrived
    /// from the panel — and nowhere in the middle of search.
    ///
    /// De-duplication is not paranoia. A whole-tree replace from the panel is
    /// arbitrary client JSON, and the one gesture that most obviously produces
    /// a repeat is "duplicate this module": copying a subtree copies its uids,
    /// and two nodes claiming one identity is worse than no identity at all —
    /// a lock on either would light both. First occurrence in walk order keeps
    /// the id; the copies are minted fresh.
    pub fn ensure_uids(&mut self) {
        let mut seen = std::collections::HashSet::new();
        settle_audio(&mut self.root, &mut seen);
    }

    /// Strip every identity back to [`Uid::NEW`].
    ///
    /// Used where a tree must hash or serialize as pure content — the render
    /// memo's key, above all, which would otherwise miss on every refinement
    /// step and invalidate every persisted row the moment uids started moving.
    pub fn clear_uids(&mut self) {
        walk_audio_mut(&mut self.root, &mut |n| n.set_uid(Uid::NEW), &mut |m| {
            m.set_uid(Uid::NEW)
        });
    }

    /// Carry `parent`'s identities onto this tree wherever the structure is
    /// unchanged.
    ///
    /// **This is what makes locks and hand positions survive ⚡ evolve.**
    /// Refinement does not mutate a tree in place — `EvolutionChain` proposes
    /// over the *trace*, and every accepted step reconstructs the whole genome
    /// through [`crate::genome`]'s decoder, which knows nothing about uids and
    /// cannot: a trace is a map from address to value. So a refined child comes
    /// back structurally near-identical to its seed and completely anonymous,
    /// and without this pass every generation would look to the UI like a brand
    /// new patch — the exact failure (`R6`) that would make pinned routings and
    /// freeform layout read as broken.
    ///
    /// The match is positional and shallow-by-variant: walking both trees in
    /// lockstep, a node inherits its counterpart's identity **only if it is the
    /// same variant**, but the walk descends either way. That last part
    /// matters — a step that swaps one filter for a reverb should not orphan
    /// the entire chain beneath it, which was not touched.
    ///
    /// Anything left unmatched (a genuinely new module, a branch that grew)
    /// stays [`Uid::NEW`] and is minted by the following [`Self::ensure_uids`].
    pub fn inherit_uids(&mut self, parent: &PatchTree) {
        inherit_audio(&mut self.root, &parent.root);
    }
}

/// Depth-first over an audio subtree and every modulation term hanging off it.
fn walk_audio_mut(
    n: &mut AudioNode,
    fa: &mut impl FnMut(&mut AudioNode),
    fm: &mut impl FnMut(&mut ModNode),
) {
    fa(n);
    if let Some(m) = n.modulation_mut() {
        walk_mod_mut(m, fm);
    }
    for c in n.children_mut() {
        walk_audio_mut(c, fa, fm);
    }
}

fn walk_mod_mut(n: &mut ModNode, fm: &mut impl FnMut(&mut ModNode)) {
    fm(n);
    for c in n.children_mut() {
        walk_mod_mut(c, fm);
    }
}

fn settle_audio(n: &mut AudioNode, seen: &mut std::collections::HashSet<u64>) {
    let uid = n.uid();
    if uid.is_new() || !seen.insert(uid.0) {
        let fresh = Uid::mint();
        seen.insert(fresh.0);
        n.set_uid(fresh);
    } else {
        Uid::observe(uid);
    }
    if let Some(m) = n.modulation_mut() {
        settle_mod(m, seen);
    }
    for c in n.children_mut() {
        settle_audio(c, seen);
    }
}

fn settle_mod(n: &mut ModNode, seen: &mut std::collections::HashSet<u64>) {
    // `None` is an empty slot, not a module: it draws no plate, owns no knobs
    // and cannot be locked, so it has nothing to be identified by — and
    // `ModNode::uid` says so by returning `None` for it.
    if let Some(uid) = n.uid() {
        if uid.is_new() || !seen.insert(uid.0) {
            let fresh = Uid::mint();
            seen.insert(fresh.0);
            n.set_uid(fresh);
        } else {
            Uid::observe(uid);
        }
    }
    for c in n.children_mut() {
        settle_mod(c, seen);
    }
}

fn inherit_audio(child: &mut AudioNode, parent: &AudioNode) {
    if std::mem::discriminant(&*child) == std::mem::discriminant(parent) {
        child.set_uid(parent.uid());
    }
    if let (Some(cm), Some(pm)) = (child.modulation_mut(), parent.modulation()) {
        inherit_mod(cm, pm);
    }
    let pk = parent.children();
    for (i, c) in child.children_mut().into_iter().enumerate() {
        if let Some(p) = pk.get(i) {
            inherit_audio(c, p);
        }
    }
}

fn inherit_mod(child: &mut ModNode, parent: &ModNode) {
    if std::mem::discriminant(&*child) == std::mem::discriminant(parent) {
        if let Some(u) = parent.uid() {
            child.set_uid(u);
        }
    }
    let pk = parent.children();
    for (i, c) in child.children_mut().into_iter().enumerate() {
        if let Some(p) = pk.get(i) {
            inherit_mod(c, p);
        }
    }
}
