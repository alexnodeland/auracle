//! User-driven structural edits: create, delete, replace, and rewire nodes
//! in a patch tree — the "reconnect anything" surface of the workbench.
//!
//! Because the genome is a *typed tree*, rewiring is expressed as a small
//! vocabulary of operations that are type-safe by construction (an LFO can
//! never end up in an audio slot; a filter always has exactly one audio
//! input): replace a node, insert a node into a wire, delete/splice a node,
//! change a modulation source, swap a mixer's inputs. These are the same
//! moves evolution's structural proposals make — hand edits and MH walk the
//! same lattice.
//!
//! Nodes are addressed by their trace **key** (`node`, `node/0`, `node/0/1`,
//! `node/0/m` for mod slots — see [`crate::genome`]).

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::term::{
    AudioNode, DriveMode, FilterKind, ModNode, ModOp, NoiseColor, PairOp, PatchTree, TableShape,
    Uid, Waveform,
};

/// Hard ceilings on hand-built patches (protects the realtime voice and the
/// feature pipeline; evolution's own prior rarely exceeds these).
pub const MAX_SIZE: usize = 24;
/// Maximum tree depth for hand-built patches.
pub const MAX_DEPTH: usize = 9;
/// Maximum nesting depth of a hand-built **modulation** term.
///
/// Above the prior's `max_mod_depth` of 2, on the same argument as
/// [`MAX_DEPTH`] against the prior's `max_depth`: a person stacking shapers by
/// hand knows what they are building, and the ceiling is there to protect the
/// realtime voice rather than to shape the search. It stops well short of the
/// audio ceiling because a `Pair` branches, so depth 4 is up to sixteen leaves
/// on one cable — and each of them is another level of the compiler's
/// by-value recursion on top of the audio tree's.
pub const MAX_MOD_DEPTH: usize = 4;

/// The buildable node palette (everything the grammar can express).
///
/// Serialized in snake_case, which is also the string the rack description
/// reports as [`crate::describe::RackModule::kind`] and the frontend keys its
/// palette off. `RingMod` is renamed by hand because the derived spelling
/// would be `ring_mod` while the module is `ringmod` everywhere else, and one
/// module with two spellings is a defect waiting for a caller.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    /// Band-limited oscillator.
    Vco,
    /// Seven-voice detuned saw stack.
    Supersaw,
    /// Noise source.
    Noise,
    /// Equal-power crossfade.
    Mix,
    /// SVF / ladder filter.
    Filter,
    /// Wavefolder.
    Fold,
    /// Delay line.
    Delay,
    /// Chorus.
    Chorus,
    /// Algorithmic reverb.
    Reverb,
    /// Morphing wavetable oscillator.
    Wavetable,
    /// Karplus-Strong plucked string.
    Pluck,
    /// Waveshaping distortion.
    Distortion,
    /// Bit / sample-rate crusher.
    Bitcrush,
    /// Swept allpass phaser.
    Phaser,
    /// Ring modulator, crossfaded against its carrier.
    #[serde(rename = "ringmod")]
    RingMod,
    /// Formant (vocal-tract) oscillator.
    Formant,
    /// Swept comb flanger.
    Flanger,
    /// Amplitude tremolo.
    Tremolo,
    /// Pitch vibrato.
    Vibrato,
    /// Three-band tone control.
    Eq,
    /// Granular re-reader.
    Granular,
    /// Grain pitch shifter.
    Shift,
    /// Sidechain compressor.
    Comp,
    /// Sidechain ducker.
    Duck,
    /// Keyed noise gate.
    Gate,
    /// Carrier/modulator vocoder.
    Vocoder,
}

impl NodeKind {
    /// Is this a source (leaf) kind?
    pub fn is_source(self) -> bool {
        matches!(
            self,
            NodeKind::Vco
                | NodeKind::Supersaw
                | NodeKind::Noise
                | NodeKind::Wavetable
                | NodeKind::Pluck
                | NodeKind::Formant
        )
    }
}

/// A modulation choice for [`StructOp::SetMod`].
///
/// The first five are **sources**: they replace whatever is in the slot. The
/// eleven below them are **shapers**, and setting one *wraps* the slot's
/// current term rather than discarding it — placing a quantizer on a cable
/// that already carries an S&H is the gesture, and asking the panel to send a
/// whole [`ModNode`] through [`StructOp::SetModTree`] to express it would make
/// the common edit the awkward one.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModKind {
    /// No modulation.
    None,
    /// LFO.
    Lfo,
    /// Attack/decay envelope.
    Env,
    /// Sample-and-hold random source.
    Rand,
    /// Envelope follower on the owning module's own input.
    Follow,
    /// Clocked euclidean gate pattern.
    Euclid,
    /// Wrap the slot in a scale quantizer.
    Quantize,
    /// Wrap the slot in a slew limiter.
    Slew,
    /// Wrap the slot in a rectifier.
    Rectify,
    /// Wrap the slot in a clocked sample-and-hold.
    Hold,
    /// Combine the slot with a second modulator, taking the lower.
    Min,
    /// …the higher.
    Max,
    /// …their gate AND.
    And,
    /// …their gate OR.
    Or,
    /// …their gate XOR.
    Xor,
    /// …switching between them.
    Switch,
}

impl ModKind {
    /// The unary CV processor this kind wraps the slot in, if any.
    fn as_op(self) -> Option<ModOp> {
        Some(match self {
            ModKind::Quantize => ModOp::Quantize,
            ModKind::Slew => ModOp::Slew,
            ModKind::Rectify => ModOp::Rectify,
            ModKind::Hold => ModOp::Hold,
            _ => return None,
        })
    }

    /// The binary CV combiner this kind wraps the slot in, if any.
    fn as_pair(self) -> Option<PairOp> {
        Some(match self {
            ModKind::Min => PairOp::Min,
            ModKind::Max => PairOp::Max,
            ModKind::And => PairOp::And,
            ModKind::Or => PairOp::Or,
            ModKind::Xor => PairOp::Xor,
            ModKind::Switch => PairOp::Switch,
            _ => return None,
        })
    }
}

/// Default knob values for a hand-placed [`ModOp`], as `(p0, p1)`.
///
/// Every one is chosen so the module is audibly doing something the instant it
/// lands, on the same argument as [`default_node`]'s second branches.
fn default_op_params(kind: ModOp) -> (f64, f64) {
    match kind {
        // Root C, and **minor** rather than chromatic: a chromatic quantizer
        // on a random source is a random source with extra steps, and minor is
        // the scale that reads as deliberate on the first note.
        ModOp::Quantize => (0.0, 2.5 / 7.0),
        // A 0.16 s glide (quiver's `0.001 + cv²·10` under `map::slew_time`),
        // symmetric — long enough to hear as portamento between S&H steps,
        // short enough that an LFO still arrives.
        ModOp::Slew => (0.2, 0.2),
        // Full-wave: the only mode that changes a bipolar modulator's shape
        // rather than gating half of it away.
        ModOp::Rectify => (0.0, 0.0),
        // ≈115 BPM on `map::clock_rate`, i.e. about two samples a second —
        // slow enough that the steps are individually audible.
        ModOp::Hold => (0.5, 0.0),
    }
}

/// The second branch a hand-placed [`PairOp`] gets.
///
/// A euclidean gate for the three logic ops and the switch, because those four
/// only mean anything against something that crosses the 2.5 V gate threshold
/// on a rhythm; a slow triangle LFO for min and max, which are envelope
/// arithmetic and want a continuous partner.
fn default_pair_b(kind: PairOp) -> ModNode {
    if kind.is_gate() || kind == PairOp::Switch {
        ModNode::Euclid {
            uid: Uid::NEW,
            rate: 0.5,
            steps: 0.5,
            pulses: 0.4,
        }
    } else {
        ModNode::Lfo {
            uid: Uid::NEW,
            wave: Waveform::Triangle,
            rate: 0.3,
        }
    }
}

/// One structural edit.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum StructOp {
    /// Replace the node at `key` with a `kind` (subtrees preserved where the
    /// sorts allow; replacing a source with a processor wraps the source).
    Replace {
        /// Node key.
        key: String,
        /// New kind.
        kind: NodeKind,
    },
    /// Insert a processor/mix between the node at `key` and its parent
    /// (i.e., into the wire toward the output).
    Insert {
        /// Node key.
        key: String,
        /// Inserted kind (must not be a source).
        kind: NodeKind,
    },
    /// Delete the node at `key`, splicing its (primary) input up.
    Delete {
        /// Node key.
        key: String,
    },
    /// Set the modulation slot of the module at `key` (everything but the
    /// two slotless binary nodes has one).
    ///
    /// `key` addresses the **audio** module that owns the slot, not the slot
    /// itself. A source kind replaces the slot's whole term; a shaper wraps
    /// it — see [`ModKind`]. To edit deeper into a chain, or to install one
    /// wholesale, use [`StructOp::SetModTree`].
    SetMod {
        /// Node key.
        key: String,
        /// New modulation kind.
        kind: ModKind,
    },
    /// Swap the two audio inputs of the binary node at `key`.
    ///
    /// Named for the only production that accepted it when it was written; it
    /// now applies to all six two-input kinds, because "swap the two inputs"
    /// is a musical move on every one of them and the menu has always
    /// offered it on every one of them.
    SwapMix {
        /// Node key.
        key: String,
    },
    /// Replace the subtree at `key` with an explicit fragment (the wire
    /// gesture "plug this staged chain in here, discard what was there" —
    /// callers park the old subtree client-side).
    ReplaceTree {
        /// Node key.
        key: String,
        /// The fragment to install.
        node: AudioNode,
    },
    /// Insert an explicit processor/mix fragment into the wire between
    /// `key` and its parent; the old subtree becomes the fragment's primary
    /// input (a Mix keeps its own `b` branch).
    InsertTree {
        /// Node key.
        key: String,
        /// The fragment to graft in (must not be a source).
        node: AudioNode,
    },
    /// Install an explicit modulation fragment on the module at `key`.
    SetModTree {
        /// Node key.
        key: String,
        /// The modulation term.
        m: ModNode,
    },
}

/// Why a structural edit was rejected.
#[derive(Debug, Error)]
pub enum StructError {
    /// No node at that key.
    #[error("no node at {0}")]
    NoSuchNode(String),
    /// The operation does not apply to this node kind.
    #[error("{0}")]
    Invalid(String),
    /// The edit would exceed the size/depth ceilings.
    #[error("patch would exceed limits ({0} nodes max, depth {1})")]
    TooBig(usize, usize),
    /// The edit would stack more CV processors on one cable than the realtime
    /// voice is willing to carry.
    #[error("modulation chain would exceed depth {0}")]
    ModTooDeep(usize),
}

fn default_node(kind: NodeKind, input: Option<AudioNode>) -> AudioNode {
    let boxed = |n: Option<AudioNode>| Box::new(n.unwrap_or_else(|| saw_vco(0)));
    match kind {
        NodeKind::Vco => saw_vco(0),
        NodeKind::Supersaw => AudioNode::Supersaw {
            uid: Uid::NEW,
            octave: 0,
            detune: 0.35,
            mix: 0.5,
            mod_depth: 0.3,
            modulation: ModNode::None,
        },
        NodeKind::Noise => AudioNode::Noise {
            uid: Uid::NEW,
            color: NoiseColor::White,
        },
        NodeKind::Mix => AudioNode::Mix {
            uid: Uid::NEW,
            balance: 0.5,
            a: boxed(input),
            b: Box::new(AudioNode::Vco {
                uid: Uid::NEW,
                wave: Waveform::Triangle,
                octave: 0,
                detune: 0.5,
                mod_depth: 0.3,
                modulation: ModNode::None,
            }),
        },
        NodeKind::Filter => AudioNode::Filter {
            uid: Uid::NEW,
            kind: FilterKind::SvfLp,
            cutoff: 0.6,
            resonance: 0.3,
            mod_depth: 0.3,
            input: boxed(input),
            modulation: ModNode::None,
        },
        NodeKind::Fold => AudioNode::Fold {
            uid: Uid::NEW,
            threshold: 0.5,
            mod_depth: 0.3,
            input: boxed(input),
            modulation: ModNode::None,
        },
        NodeKind::Delay => AudioNode::Delay {
            uid: Uid::NEW,
            time: 0.35,
            feedback: 0.35,
            mix: 0.35,
            mod_depth: 0.3,
            input: boxed(input),
            modulation: ModNode::None,
        },
        NodeKind::Chorus => AudioNode::Chorus {
            uid: Uid::NEW,
            rate: 0.3,
            depth: 0.4,
            mix: 0.35,
            mod_depth: 0.3,
            input: boxed(input),
            modulation: ModNode::None,
        },
        NodeKind::Reverb => AudioNode::Reverb {
            uid: Uid::NEW,
            size: 0.5,
            damp: 0.5,
            mix: 0.3,
            mod_depth: 0.3,
            input: boxed(input),
            modulation: ModNode::None,
        },
        NodeKind::Wavetable => AudioNode::Wavetable {
            uid: Uid::NEW,
            table: TableShape::Saw,
            octave: 0,
            morph: 0.35,
            mod_depth: 0.3,
            modulation: ModNode::None,
        },
        NodeKind::Pluck => AudioNode::Pluck {
            uid: Uid::NEW,
            octave: 0,
            damping: 0.45,
            brightness: 0.6,
            mod_depth: 0.3,
            modulation: ModNode::None,
        },
        NodeKind::Distortion => AudioNode::Distortion {
            uid: Uid::NEW,
            drive: 0.45,
            tone: 0.5,
            mode: DriveMode::Soft,
            mod_depth: 0.3,
            input: boxed(input),
            modulation: ModNode::None,
        },
        NodeKind::Bitcrush => AudioNode::Bitcrush {
            uid: Uid::NEW,
            bits: 0.55,
            downsample: 0.3,
            mod_depth: 0.3,
            input: boxed(input),
            modulation: ModNode::None,
        },
        NodeKind::Phaser => AudioNode::Phaser {
            uid: Uid::NEW,
            rate: 0.3,
            depth: 0.6,
            feedback: 0.5,
            mod_depth: 0.3,
            input: boxed(input),
            modulation: ModNode::None,
        },
        NodeKind::RingMod => AudioNode::RingMod {
            uid: Uid::NEW,
            mix: 0.5,
            a: boxed(input),
            // A sine an octave up, not a copy of the carrier: ring-modulating
            // a signal against itself squares it, which is a quiet, dull
            // module that looks broken. The default has to *ring*.
            b: Box::new(AudioNode::Vco {
                uid: Uid::NEW,
                wave: Waveform::Sine,
                octave: 1,
                detune: 0.5,
                mod_depth: 0.3,
                modulation: ModNode::None,
            }),
        },
        NodeKind::Formant => AudioNode::Formant {
            uid: Uid::NEW,
            // Off the /a/ end: at vowel 0 the mod slot can only sweep one
            // way, and a formant oscillator parked on a single vowel is a
            // static filter bank.
            vowel: 0.3,
            shift: 0.5,
            octave: 0,
            mod_depth: 0.3,
            modulation: ModNode::None,
        },
        NodeKind::Flanger => AudioNode::Flanger {
            uid: Uid::NEW,
            rate: 0.35,
            depth: 0.6,
            // Bipolar: 0.62 is a gentle *positive* 0.17, enough to hear the
            // comb without the module announcing itself as a jet.
            feedback: 0.62,
            mod_depth: 0.3,
            input: boxed(input),
            modulation: ModNode::None,
        },
        NodeKind::Tremolo => AudioNode::Tremolo {
            uid: Uid::NEW,
            rate: 0.4,
            depth: 0.5,
            shape: 0.0,
            mod_depth: 0.3,
            input: boxed(input),
            modulation: ModNode::None,
        },
        NodeKind::Vibrato => AudioNode::Vibrato {
            uid: Uid::NEW,
            rate: 0.45,
            depth: 0.25,
            // Fully wet. A half-wet vibrato *is* a chorus, and shipping the
            // default at 0.5 would erase the distinction between the two
            // modules on the very first click.
            mix: 1.0,
            mod_depth: 0.3,
            input: boxed(input),
            modulation: ModNode::None,
        },
        NodeKind::Eq => AudioNode::Eq {
            uid: Uid::NEW,
            // All three bands at centre, i.e. 0 dB: a freshly placed tone
            // control is audibly a no-op until you move it, which is correct
            // for a tone control and better than hiding it behind a tilt
            // nobody asked for.
            low: 0.5,
            mid: 0.5,
            high: 0.5,
            mod_depth: 0.3,
            input: boxed(input),
            modulation: ModNode::None,
        },
        NodeKind::Granular => AudioNode::Granular {
            uid: Uid::NEW,
            position: 0.5,
            size: 0.4,
            density: 0.6,
            mod_depth: 0.3,
            input: boxed(input),
            modulation: ModNode::None,
        },
        NodeKind::Shift => AudioNode::Shift {
            uid: Uid::NEW,
            // Off unison, or the module is a wire on first placement: 0.62 is
            // a bright +3 semitones, an interval rather than a detune.
            semis: 0.62,
            window: 0.5,
            // Half wet, so the harmony arrives *against* the original rather
            // than replacing it — which is what a shifter in a patch is for.
            mix: 0.5,
            mod_depth: 0.3,
            input: boxed(input),
            modulation: ModNode::None,
        },
        // The four below default their `/1` branch to something that makes the
        // module audibly do its job the instant it lands. A compressor keyed
        // off a copy of its own input is a gain trim; a ducker keyed off a pad
        // is a slow tremolo; a vocoder on a sine carrier is silence. The
        // second branch is the point of these modules, so the default has to
        // demonstrate it.
        NodeKind::Comp => AudioNode::Comp {
            uid: Uid::NEW,
            // 0.3 is ≈0.2 V of detector level, just under a plucked string's
            // own envelope peak — measured, because on the geometric knob
            // (`map::detector_volts`) the difference between 0.3 and 0.4 is
            // the difference between a compressor that pumps and one that is
            // a wire. 10.5:1 above it, which is limiting rather than gluing,
            // because a sidechain compressor that only just moves is one
            // nobody can hear working.
            threshold: 0.3,
            ratio: 0.5,
            makeup: 0.4,
            mod_depth: 0.3,
            input: boxed(input),
            // A pluck, like the ducker's and the gate's. A *sustained*
            // sidechain — the obvious choice, and what an earlier draft of
            // this table had — makes the compressor a static gain trim: the
            // detector settles inside the first 20 ms and never moves again,
            // so the module reviews as correct and does nothing. Sidechain
            // compression is a transient pushing a level down and letting it
            // come back, and only a pluck has the transient.
            sidechain: Box::new(pluck_key()),
            modulation: ModNode::None,
        },
        NodeKind::Duck => AudioNode::Duck {
            uid: Uid::NEW,
            amount: 0.7,
            threshold: 0.4,
            release: 0.35,
            mod_depth: 0.3,
            input: boxed(input),
            key: Box::new(pluck_key()),
            modulation: ModNode::None,
        },
        NodeKind::Gate => AudioNode::Gate {
            uid: Uid::NEW,
            // 0.45 is ≈0.4 V, in the middle of the band where a plucked key
            // opens the gate on its attack and lets it shut again as the
            // string decays. Below ≈0.42 it never shuts and above ≈0.47 it
            // never opens; both were measured, and both read on the faceplate
            // as a fixed −10 dB pad rather than as a gate.
            threshold: 0.45,
            range: 0.7,
            release: 0.3,
            mod_depth: 0.3,
            input: boxed(input),
            sidechain: Box::new(pluck_key()),
            modulation: ModNode::None,
        },
        NodeKind::Vocoder => AudioNode::Vocoder {
            uid: Uid::NEW,
            bands: 0.6,
            attack: 0.25,
            release: 0.3,
            mod_depth: 0.3,
            // A supersaw carrier because a vocoder can only reveal spectrum
            // the carrier already has — on a sine there is nothing in fifteen
            // of the sixteen bands to reveal.
            carrier: Box::new(AudioNode::Supersaw {
                uid: Uid::NEW,
                octave: 0,
                detune: 0.45,
                mix: 0.6,
                mod_depth: 0.3,
                modulation: ModNode::None,
            }),
            // A formant oscillator as the modulator, because the vowel is what
            // makes a vocoder audibly a vocoder rather than a moving filter.
            modulator: Box::new(AudioNode::Formant {
                uid: Uid::NEW,
                vowel: 0.3,
                shift: 0.5,
                octave: 0,
                mod_depth: 0.3,
                modulation: ModNode::None,
            }),
            modulation: ModNode::None,
        },
    }
}

/// The default key/sidechain branch for the ducker and the gate.
///
/// A pluck, deliberately: it is the only source in the palette with a sharp
/// transient *and* a decay, which is exactly the envelope a ducker or a gate
/// needs in order to visibly do something on the first note. A sustained
/// source keys them into a static gain change nobody can hear as an effect.
fn pluck_key() -> AudioNode {
    AudioNode::Pluck {
        uid: Uid::NEW,
        octave: -1,
        damping: 0.4,
        brightness: 0.7,
        mod_depth: 0.3,
        modulation: ModNode::None,
    }
}

/// The grammar's fallback source: a plain saw at the given octave.
///
/// Extracted because `default_node` names it three times and it gained two
/// fields in wave 2A — three places to forget one of them.
fn saw_vco(octave: i8) -> AudioNode {
    AudioNode::Vco {
        uid: Uid::NEW,
        wave: Waveform::Saw,
        octave,
        detune: 0.5,
        mod_depth: 0.3,
        modulation: ModNode::None,
    }
}

fn primary_input(n: AudioNode) -> Option<AudioNode> {
    match n {
        AudioNode::Vco { .. }
        | AudioNode::Supersaw { .. }
        | AudioNode::Noise { .. }
        | AudioNode::Wavetable { .. }
        | AudioNode::Pluck { .. }
        | AudioNode::Formant { .. } => None,
        // For a ring modulator the carrier is the primary input, exactly as
        // `a` is for a mix — the modulator is the branch that gets dropped.
        AudioNode::Mix { a, .. } | AudioNode::RingMod { a, .. } => Some(*a),
        // Same rule on the 2B binaries, and here it is not even a choice:
        // `/1` is a control signal, so the branch that survives a splice is
        // always the one you were listening to.
        AudioNode::Comp { input, .. }
        | AudioNode::Duck { input, .. }
        | AudioNode::Gate { input, .. } => Some(*input),
        AudioNode::Vocoder { carrier, .. } => Some(*carrier),
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
        | AudioNode::Granular { input, .. } => Some(*input),
    }
}

/// Parse a node key (`node`, `node/0`, `node/0/1`) into a child-index path.
fn parse_key(key: &str) -> Option<Vec<usize>> {
    let rest = key.strip_prefix("node")?;
    if rest.is_empty() {
        return Some(Vec::new());
    }
    rest.strip_prefix('/')?
        .split('/')
        .map(|s| s.parse::<usize>().ok())
        .collect()
}

fn child_mut(n: &mut AudioNode, i: usize) -> Option<&mut AudioNode> {
    match n {
        AudioNode::Mix { a, b, .. } | AudioNode::RingMod { a, b, .. } => match i {
            0 => Some(a),
            1 => Some(b),
            _ => None,
        },
        // `/0` signal, `/1` control — the same two indices `describe` labels
        // and `genome` encodes, so a key like `node/1/0` addresses the same
        // node in all three.
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
        } => match i {
            0 => Some(input),
            1 => Some(other),
            _ => None,
        },
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
        | AudioNode::Granular { input, .. } => (i == 0).then_some(input),
        _ => None,
    }
}

fn node_at_mut<'a>(root: &'a mut AudioNode, path: &[usize]) -> Option<&'a mut AudioNode> {
    let mut cur = root;
    for &i in path {
        cur = child_mut(cur, i)?;
    }
    Some(cur)
}

fn take(n: &mut AudioNode) -> AudioNode {
    std::mem::replace(
        n,
        AudioNode::Noise {
            uid: Uid::NEW,
            color: NoiseColor::White,
        },
    )
}

/// Apply a structural edit, returning the new tree.
pub fn apply_struct_op(tree: &PatchTree, op: &StructOp) -> Result<PatchTree, StructError> {
    let mut out = tree.clone();
    match op {
        StructOp::Replace { key, kind } => {
            let path = parse_key(key).ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let slot = node_at_mut(&mut out.root, &path)
                .ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let old = take(slot);
            *slot = if kind.is_source() {
                // Source kinds swap in place; any old subtree is dropped.
                default_node(*kind, None)
            } else {
                // Processor/mix keeps the old primary input; replacing a
                // source wraps that source.
                let input = match primary_input(old.clone()) {
                    Some(i) => Some(i),
                    None => Some(old),
                };
                default_node(*kind, input)
            };
        }
        StructOp::Insert { key, kind } => {
            if kind.is_source() {
                return Err(StructError::Invalid(
                    "sources cannot be inserted into a wire — use replace, or insert a mix".into(),
                ));
            }
            let path = parse_key(key).ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let slot = node_at_mut(&mut out.root, &path)
                .ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let old = take(slot);
            *slot = default_node(*kind, Some(old));
        }
        StructOp::Delete { key } => {
            let path = parse_key(key).ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            // Deleting one branch of a binary node collapses it to the
            // sibling. On the 2B family that reads exactly right in the
            // direction people actually use: pulling the key out of a ducker
            // leaves the pad, which is what "remove the ducking" means.
            if let Some((&last, parent_path)) = path.split_last() {
                let parent = node_at_mut(&mut out.root, parent_path)
                    .ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
                if let Some((a, b)) = binary_children_mut(parent) {
                    let keep = take(if last == 0 { b } else { a });
                    *parent = keep;
                    return finish(out);
                }
            }
            let slot = node_at_mut(&mut out.root, &path)
                .ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let old = take(slot);
            match primary_input(old) {
                Some(input) => *slot = input,
                None => {
                    return Err(StructError::Invalid(
                        "a lone source cannot be deleted — replace it instead".into(),
                    ))
                }
            }
        }
        StructOp::SetMod { key, kind } => {
            let path = parse_key(key).ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let slot = node_at_mut(&mut out.root, &path)
                .ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let m = mod_slot_mut(slot)?;
            // A shaper wraps what is already there; a source replaces it. An
            // empty slot has nothing to wrap, so a shaper placed on one gets
            // the default source underneath — an S&H, which is the modulator
            // every one of these eleven exists to make musical.
            let existing = std::mem::take(m);
            let inner = move || match existing {
                ModNode::None => ModNode::Rand {
                    uid: Uid::NEW,
                    rate: 0.4,
                    glide: 0.0,
                },
                existing => existing,
            };
            let replacement = if let Some(op) = kind.as_op() {
                let (p0, p1) = default_op_params(op);
                ModNode::Op {
                    uid: Uid::NEW,
                    kind: op,
                    p0,
                    p1,
                    input: Box::new(inner()),
                }
            } else if let Some(pair) = kind.as_pair() {
                ModNode::Pair {
                    uid: Uid::NEW,
                    kind: pair,
                    a: Box::new(inner()),
                    b: Box::new(default_pair_b(pair)),
                }
            } else {
                match kind {
                    ModKind::Lfo => ModNode::Lfo {
                        uid: Uid::NEW,
                        wave: Waveform::Triangle,
                        rate: 0.4,
                    },
                    ModKind::Env => ModNode::Env {
                        uid: Uid::NEW,
                        attack: 0.2,
                        decay: 0.5,
                    },
                    ModKind::Rand => ModNode::Rand {
                        uid: Uid::NEW,
                        rate: 0.4,
                        glide: 0.0,
                    },
                    ModKind::Follow => ModNode::Follow {
                        uid: Uid::NEW,
                        sens: 0.5,
                        release: 0.4,
                    },
                    ModKind::Euclid => ModNode::Euclid {
                        uid: Uid::NEW,
                        rate: 0.5,
                        steps: 0.5,
                        pulses: 0.4,
                    },
                    // `None` and the ten handled above.
                    _ => ModNode::None,
                }
            };
            *m = replacement;
        }
        StructOp::SwapMix { key } => {
            let path = parse_key(key).ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let slot = node_at_mut(&mut out.root, &path)
                .ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            // Mix is the one binary whose knob is anchored to a *side*: the
            // crossfade has to mirror or an edit that only reorders the two
            // branches would also change the balance you hear. Every other
            // binary's knob names a process (threshold, amount, dry/wet), not
            // a side, so it stays put — and on those four the swap is the
            // whole point: exchanging a ducker's `in` and `key` is the
            // difference between the pad ducking under the kick and the kick
            // ducking under the pad, and there was no other way to say it.
            if let AudioNode::Mix { balance, .. } = slot {
                *balance = 1.0 - *balance;
            }
            let Some((a, b)) = binary_children_mut(slot) else {
                return Err(StructError::Invalid(
                    "this module has only one input — there is nothing to swap".into(),
                ));
            };
            std::mem::swap(a, b);
        }
        StructOp::ReplaceTree { key, node } => {
            let path = parse_key(key).ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let slot = node_at_mut(&mut out.root, &path)
                .ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            *slot = node.clone();
        }
        StructOp::InsertTree { key, node } => {
            let path = parse_key(key).ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let slot = node_at_mut(&mut out.root, &path)
                .ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let old = take(slot);
            *slot = graft(node.clone(), old)?;
        }
        StructOp::SetModTree { key, m } => {
            let path = parse_key(key).ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            let slot = node_at_mut(&mut out.root, &path)
                .ok_or_else(|| StructError::NoSuchNode(key.clone()))?;
            // Normalized, because this is the one edit that installs a whole
            // modulation term the panel built: a `Pair` with an empty branch
            // or an `Op` over nothing is a rack module that cannot make a
            // sound, and the prior can only rule those out for terms it drew
            // itself. See [`ModNode::normalized`].
            *mod_slot_mut(slot)? = m.clone().normalized();
        }
    }
    finish(out)
}

/// The two audio children of a binary node, `(/0, /1)`, or `None` for
/// everything else.
///
/// Six productions are binary now, so the shape that used to be one `if let`
/// pattern in `Delete` is worth a name. `/0` is always the branch that carries
/// the signal you hear.
fn binary_children_mut(n: &mut AudioNode) -> Option<(&mut AudioNode, &mut AudioNode)> {
    match n {
        AudioNode::Mix { a, b, .. } | AudioNode::RingMod { a, b, .. } => Some((a, b)),
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
        } => Some((input, other)),
        _ => None,
    }
}

/// The modulation slot of a node, or an error for the two slotless binaries.
///
/// Ring mod and mix are the exceptions, and *only* they: both of their inputs
/// are audio and their one knob is the blend, so there is no parameter left
/// for a modulator to reach. Having two children is not itself
/// disqualifying — the four 2B dynamics nodes take two subterms and still own
/// a slot.
fn mod_slot_mut(n: &mut AudioNode) -> Result<&mut ModNode, StructError> {
    match n {
        // The two oldest sources joined this list in wave 2A: their slot goes
        // to *pitch*, which is the one modulation destination no processor in
        // the grammar can offer.
        AudioNode::Vco { modulation, .. }
        | AudioNode::Supersaw { modulation, .. }
        | AudioNode::Formant { modulation, .. }
        | AudioNode::Wavetable { modulation, .. }
        | AudioNode::Pluck { modulation, .. }
        | AudioNode::Filter { modulation, .. }
        | AudioNode::Fold { modulation, .. }
        | AudioNode::Delay { modulation, .. }
        | AudioNode::Chorus { modulation, .. }
        | AudioNode::Reverb { modulation, .. }
        | AudioNode::Distortion { modulation, .. }
        | AudioNode::Bitcrush { modulation, .. }
        | AudioNode::Phaser { modulation, .. }
        | AudioNode::Flanger { modulation, .. }
        | AudioNode::Tremolo { modulation, .. }
        | AudioNode::Vibrato { modulation, .. }
        | AudioNode::Eq { modulation, .. }
        | AudioNode::Granular { modulation, .. }
        | AudioNode::Shift { modulation, .. }
        | AudioNode::Comp { modulation, .. }
        | AudioNode::Duck { modulation, .. }
        | AudioNode::Gate { modulation, .. }
        | AudioNode::Vocoder { modulation, .. } => Ok(modulation),
        _ => Err(StructError::Invalid(
            "mixers and ring modulators have no modulation slot".into(),
        )),
    }
}

/// Graft `old` into `frag`'s primary input slot (the binary nodes keep their
/// `/1` — the fragment's own second branch is what the user staged, and on the
/// dynamics family it is a control signal that has nothing to do with the wire
/// being spliced).
fn graft(frag: AudioNode, old: AudioNode) -> Result<AudioNode, StructError> {
    match frag {
        AudioNode::Mix { balance, b, .. } => Ok(AudioNode::Mix {
            uid: Uid::NEW,
            balance,
            a: Box::new(old),
            b,
        }),
        AudioNode::RingMod { mix, b, .. } => Ok(AudioNode::RingMod {
            uid: Uid::NEW,
            mix,
            a: Box::new(old),
            b,
        }),
        AudioNode::Comp {
            threshold,
            ratio,
            makeup,
            mod_depth,
            sidechain,
            modulation,
            ..
        } => Ok(AudioNode::Comp {
            uid: Uid::NEW,
            threshold,
            ratio,
            makeup,
            mod_depth,
            sidechain,
            modulation,
            input: Box::new(old),
        }),
        AudioNode::Duck {
            amount,
            threshold,
            release,
            mod_depth,
            key,
            modulation,
            ..
        } => Ok(AudioNode::Duck {
            uid: Uid::NEW,
            amount,
            threshold,
            release,
            mod_depth,
            key,
            modulation,
            input: Box::new(old),
        }),
        AudioNode::Gate {
            threshold,
            range,
            release,
            mod_depth,
            sidechain,
            modulation,
            ..
        } => Ok(AudioNode::Gate {
            uid: Uid::NEW,
            threshold,
            range,
            release,
            mod_depth,
            sidechain,
            modulation,
            input: Box::new(old),
        }),
        AudioNode::Vocoder {
            bands,
            attack,
            release,
            mod_depth,
            modulator,
            modulation,
            ..
        } => Ok(AudioNode::Vocoder {
            uid: Uid::NEW,
            bands,
            attack,
            release,
            mod_depth,
            modulator,
            modulation,
            carrier: Box::new(old),
        }),
        AudioNode::Shift {
            semis,
            window,
            mix,
            mod_depth,
            modulation,
            ..
        } => Ok(AudioNode::Shift {
            uid: Uid::NEW,
            semis,
            window,
            mix,
            mod_depth,
            modulation,
            input: Box::new(old),
        }),
        AudioNode::Filter {
            kind,
            cutoff,
            resonance,
            mod_depth,
            modulation,
            ..
        } => Ok(AudioNode::Filter {
            uid: Uid::NEW,
            kind,
            cutoff,
            resonance,
            mod_depth,
            modulation,
            input: Box::new(old),
        }),
        AudioNode::Fold {
            threshold,
            mod_depth,
            modulation,
            ..
        } => Ok(AudioNode::Fold {
            uid: Uid::NEW,
            threshold,
            mod_depth,
            modulation,
            input: Box::new(old),
        }),
        AudioNode::Delay {
            time,
            feedback,
            mix,
            mod_depth,
            modulation,
            ..
        } => Ok(AudioNode::Delay {
            uid: Uid::NEW,
            time,
            feedback,
            mix,
            mod_depth,
            modulation,
            input: Box::new(old),
        }),
        AudioNode::Chorus {
            rate,
            depth,
            mix,
            mod_depth,
            modulation,
            ..
        } => Ok(AudioNode::Chorus {
            uid: Uid::NEW,
            rate,
            depth,
            mix,
            mod_depth,
            modulation,
            input: Box::new(old),
        }),
        AudioNode::Reverb {
            size,
            damp,
            mix,
            mod_depth,
            modulation,
            ..
        } => Ok(AudioNode::Reverb {
            uid: Uid::NEW,
            size,
            damp,
            mix,
            mod_depth,
            modulation,
            input: Box::new(old),
        }),
        AudioNode::Distortion {
            drive,
            tone,
            mode,
            mod_depth,
            modulation,
            ..
        } => Ok(AudioNode::Distortion {
            uid: Uid::NEW,
            drive,
            tone,
            mode,
            mod_depth,
            modulation,
            input: Box::new(old),
        }),
        AudioNode::Bitcrush {
            bits,
            downsample,
            mod_depth,
            modulation,
            ..
        } => Ok(AudioNode::Bitcrush {
            uid: Uid::NEW,
            bits,
            downsample,
            mod_depth,
            modulation,
            input: Box::new(old),
        }),
        AudioNode::Phaser {
            rate,
            depth,
            feedback,
            mod_depth,
            modulation,
            ..
        } => Ok(AudioNode::Phaser {
            uid: Uid::NEW,
            rate,
            depth,
            feedback,
            mod_depth,
            modulation,
            input: Box::new(old),
        }),
        AudioNode::Flanger {
            rate,
            depth,
            feedback,
            mod_depth,
            modulation,
            ..
        } => Ok(AudioNode::Flanger {
            uid: Uid::NEW,
            rate,
            depth,
            feedback,
            mod_depth,
            modulation,
            input: Box::new(old),
        }),
        AudioNode::Tremolo {
            rate,
            depth,
            shape,
            mod_depth,
            modulation,
            ..
        } => Ok(AudioNode::Tremolo {
            uid: Uid::NEW,
            rate,
            depth,
            shape,
            mod_depth,
            modulation,
            input: Box::new(old),
        }),
        AudioNode::Vibrato {
            rate,
            depth,
            mix,
            mod_depth,
            modulation,
            ..
        } => Ok(AudioNode::Vibrato {
            uid: Uid::NEW,
            rate,
            depth,
            mix,
            mod_depth,
            modulation,
            input: Box::new(old),
        }),
        AudioNode::Eq {
            low,
            mid,
            high,
            mod_depth,
            modulation,
            ..
        } => Ok(AudioNode::Eq {
            uid: Uid::NEW,
            low,
            mid,
            high,
            mod_depth,
            modulation,
            input: Box::new(old),
        }),
        AudioNode::Granular {
            position,
            size,
            density,
            mod_depth,
            modulation,
            ..
        } => Ok(AudioNode::Granular {
            uid: Uid::NEW,
            position,
            size,
            density,
            mod_depth,
            modulation,
            input: Box::new(old),
        }),
        AudioNode::Vco { .. }
        | AudioNode::Supersaw { .. }
        | AudioNode::Noise { .. }
        | AudioNode::Wavetable { .. }
        | AudioNode::Pluck { .. }
        | AudioNode::Formant { .. } => Err(StructError::Invalid(
            "a source has no input to splice into".into(),
        )),
    }
}

/// The deepest modulation chain anywhere in a subtree.
///
/// Walks through `mod_slot_mut`/`child_mut` rather than re-matching every
/// variant: those two already know which productions own a slot and which own
/// children, and a second copy of that table is a second place to forget a
/// module.
fn max_mod_depth_of(n: &mut AudioNode) -> usize {
    let mut best = mod_slot_mut(n).map(|m| m.depth()).unwrap_or(0);
    for i in 0..2 {
        if let Some(child) = child_mut(n, i) {
            best = best.max(max_mod_depth_of(child));
        }
    }
    best
}

/// Every ceiling a hand-built patch has to respect, in one callable place.
///
/// [`apply_struct_op`] has always enforced these on its way out. The whole-tree
/// replace route (the wasm `edit_set_tree`, which is what undo/redo and every
/// client-side rewrite go through) never did — and that is precisely the route
/// a graph editor uses for move/reconnect. A forty-node hand-built patch is not
/// merely large: it sits outside the range the standardizer was fitted on, has
/// ~zero mass under the prior, and the next refinement mutates it straight back
/// inside these ceilings, so the structure the player built by hand evaporates
/// the first time they press evolve, silently. Same ceilings, both routes.
///
/// Takes a shared reference — a caller validating a tree does not necessarily
/// own it — and pays one clone of a ≤24-node term for it, because the mod-depth
/// walk reuses the `_mut` accessors that already know which productions carry a
/// slot rather than standing up a second copy of that table to drift.
pub fn validate_tree(tree: &PatchTree) -> Result<(), String> {
    let mut probe = tree.clone();
    check_ceilings(&mut probe).map_err(|e| e.to_string())
}

fn check_ceilings(tree: &mut PatchTree) -> Result<(), StructError> {
    if tree.root.size() > MAX_SIZE || tree.root.depth() > MAX_DEPTH {
        return Err(StructError::TooBig(MAX_SIZE, MAX_DEPTH));
    }
    if max_mod_depth_of(&mut tree.root) > MAX_MOD_DEPTH {
        return Err(StructError::ModTooDeep(MAX_MOD_DEPTH));
    }
    Ok(())
}

fn finish(mut tree: PatchTree) -> Result<PatchTree, StructError> {
    check_ceilings(&mut tree)?;
    // Identity survives a structural edit for free, and the reason is worth
    // stating: [`apply_struct_op`] works on a *clone* of the incoming tree and
    // splices it in place, so every node that lives through the edit carries
    // its own `uid` across with it in the same `memmove` that carried its
    // knobs. The only nodes wanting an identity here are the ones this op just
    // made (`default_node`, the mod-term literals, the `take` placeholder) and
    // any subtree the panel handed in through `ReplaceTree`/`InsertTree` —
    // which is also where a duplicated uid could arrive. Settling covers both.
    tree.ensure_uids();
    Ok(tree)
}
