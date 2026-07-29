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

use serde::{Deserialize, Serialize};

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

/// A modulation-slot term: what drives a processor's mod input.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum ModNode {
    /// No modulation attached.
    None,
    /// A low-frequency oscillator.
    Lfo {
        /// LFO waveform.
        wave: Waveform,
        /// Normalized rate (0-1).
        rate: f64,
    },
    /// An attack/decay envelope retriggered by the note gate.
    Env {
        /// Normalized attack time (0-1).
        attack: f64,
        /// Normalized decay time (0-1).
        decay: f64,
    },
}

/// An audio-sort term: sources at the leaves, processors and mixers above.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum AudioNode {
    /// Band-limited analog-style oscillator.
    Vco {
        /// Output waveform.
        wave: Waveform,
        /// Octave offset, −2..=+2.
        octave: i8,
        /// Normalized detune (0-1 → ±50 cents).
        detune: f64,
    },
    /// Seven-voice detuned saw stack with sub oscillator.
    Supersaw {
        /// Octave offset, −2..=+2.
        octave: i8,
        /// Normalized voice detune spread (0-1).
        detune: f64,
        /// Normalized center/stack blend (0-1).
        mix: f64,
    },
    /// Noise source.
    Noise {
        /// Noise color.
        color: NoiseColor,
    },
    /// Equal-power crossfade of two audio terms.
    Mix {
        /// Normalized balance (0 = all `a`, 1 = all `b`).
        balance: f64,
        /// First input.
        a: Box<AudioNode>,
        /// Second input.
        b: Box<AudioNode>,
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
    },
    /// Delay line over an audio term.
    Delay {
        /// Normalized delay time (0-1).
        time: f64,
        /// Normalized feedback (0-1, mapped to a bounded range).
        feedback: f64,
        /// Normalized wet/dry mix (0-1).
        mix: f64,
        /// Audio input.
        input: Box<AudioNode>,
    },
    /// Chorus over an audio term.
    Chorus {
        /// Normalized modulation rate (0-1).
        rate: f64,
        /// Normalized modulation depth (0-1).
        depth: f64,
        /// Normalized wet/dry mix (0-1).
        mix: f64,
        /// Audio input.
        input: Box<AudioNode>,
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
    /// Number of probabilistic-choice sites this mod term occupies.
    pub fn site_count(&self) -> usize {
        match self {
            ModNode::None => 1,       // #mod
            ModNode::Lfo { .. } => 3, // #mod #wave #rate
            ModNode::Env { .. } => 3, // #mod #att #dec
        }
    }
}

impl AudioNode {
    /// Tree depth (a source leaf is depth 1).
    pub fn depth(&self) -> usize {
        match self {
            AudioNode::Vco { .. } | AudioNode::Supersaw { .. } | AudioNode::Noise { .. } => 1,
            AudioNode::Mix { a, b, .. } => 1 + a.depth().max(b.depth()),
            AudioNode::Filter { input, .. }
            | AudioNode::Fold { input, .. }
            | AudioNode::Delay { input, .. }
            | AudioNode::Chorus { input, .. } => 1 + input.depth(),
        }
    }

    /// Number of audio nodes in the tree.
    pub fn size(&self) -> usize {
        match self {
            AudioNode::Vco { .. } | AudioNode::Supersaw { .. } | AudioNode::Noise { .. } => 1,
            AudioNode::Mix { a, b, .. } => 1 + a.size() + b.size(),
            AudioNode::Filter { input, .. }
            | AudioNode::Fold { input, .. }
            | AudioNode::Delay { input, .. }
            | AudioNode::Chorus { input, .. } => 1 + input.size(),
        }
    }

    /// Number of probabilistic-choice sites in this subtree (including the
    /// structural `#leaf`/`#src`/`#op` sites and any modulation subterm).
    pub fn site_count(&self) -> usize {
        // Every node carries #leaf plus either #src or #op.
        match self {
            AudioNode::Vco { .. } => 2 + 3,      // #wave #oct #det
            AudioNode::Supersaw { .. } => 2 + 3, // #oct #det #smix
            AudioNode::Noise { .. } => 2 + 1,    // #color
            AudioNode::Mix { a, b, .. } => 2 + 1 + a.site_count() + b.site_count(),
            AudioNode::Filter {
                input, modulation, ..
            } => 2 + 4 + input.site_count() + modulation.site_count(),
            AudioNode::Fold {
                input, modulation, ..
            } => 2 + 2 + input.site_count() + modulation.site_count(),
            AudioNode::Delay { input, .. } => 2 + 3 + input.site_count(),
            AudioNode::Chorus { input, .. } => 2 + 3 + input.site_count(),
        }
    }

    /// Compact s-expression rendering for logs and tests.
    pub fn to_sexpr(&self) -> String {
        match self {
            AudioNode::Vco {
                wave,
                octave,
                detune,
            } => format!("(vco {} {octave:+} {detune:.2})", wave.port_name()),
            AudioNode::Supersaw {
                octave,
                detune,
                mix,
            } => format!("(supersaw {octave:+} {detune:.2} {mix:.2})"),
            AudioNode::Noise { color } => format!("(noise {})", color.port_name()),
            AudioNode::Mix { balance, a, b } => {
                format!("(mix {balance:.2} {} {})", a.to_sexpr(), b.to_sexpr())
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
            } => format!(
                "(delay t={time:.2} fb={feedback:.2} mix={mix:.2} {})",
                input.to_sexpr()
            ),
            AudioNode::Chorus {
                rate,
                depth,
                mix,
                input,
            } => format!(
                "(chorus r={rate:.2} d={depth:.2} mix={mix:.2} {})",
                input.to_sexpr()
            ),
        }
    }
}

fn mod_sexpr(m: &ModNode) -> String {
    match m {
        ModNode::None => "nomod".to_string(),
        ModNode::Lfo { wave, rate } => format!("(lfo {} {rate:.2})", wave.port_name()),
        ModNode::Env { attack, decay } => format!("(env a={attack:.2} d={decay:.2})"),
    }
}

fn spine_tags(n: &AudioNode, out: &mut Vec<&'static str>) {
    match n {
        AudioNode::Vco { wave, .. } => out.push(wave.port_name()),
        AudioNode::Supersaw { .. } => out.push("ssaw"),
        AudioNode::Noise { .. } => out.push("noiz"),
        AudioNode::Mix { a, .. } => {
            spine_tags(a, out);
            out.push("mix");
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
}
