//! Hand-designed preset patches: a starting vocabulary for the bank, and a
//! fast way to seed the taste model ("keep the ones you like").
//!
//! Every preset must compile and pass the vetting gate — pinned by a test in
//! the features crate's dependents (see ricercar-wasm tests).

use crate::term::{AmpEnv, AudioNode, FilterKind, ModNode, NoiseColor, PatchTree, Waveform};

fn amp(attack: f64, decay: f64, sustain: f64, release: f64) -> AmpEnv {
    AmpEnv {
        attack,
        decay,
        sustain,
        release,
    }
}

fn vco(wave: Waveform, octave: i8, detune: f64) -> AudioNode {
    AudioNode::Vco {
        wave,
        octave,
        detune,
    }
}

/// The built-in presets, as `(name, tree)` pairs.
pub fn presets() -> Vec<(&'static str, PatchTree)> {
    use AudioNode::*;
    vec![
        (
            "First Bass",
            PatchTree {
                amp: amp(0.03, 0.35, 0.55, 0.2),
                root: Filter {
                    kind: FilterKind::Ladder,
                    cutoff: 0.45,
                    resonance: 0.55,
                    mod_depth: 0.6,
                    modulation: ModNode::Env {
                        attack: 0.02,
                        decay: 0.45,
                    },
                    input: Box::new(vco(Waveform::Saw, -1, 0.5)),
                },
            },
        ),
        (
            "Cathedral",
            PatchTree {
                amp: amp(0.4, 0.4, 0.75, 0.7),
                root: Reverb {
                    size: 0.85,
                    damp: 0.35,
                    mix: 0.5,
                    input: Box::new(Filter {
                        kind: FilterKind::SvfLp,
                        cutoff: 0.55,
                        resonance: 0.25,
                        mod_depth: 0.3,
                        modulation: ModNode::Rand { rate: 0.35 },
                        input: Box::new(vco(Waveform::Triangle, 0, 0.55)),
                    }),
                },
            },
        ),
        (
            "Glass Pad",
            PatchTree {
                amp: amp(0.55, 0.4, 0.8, 0.65),
                root: Chorus {
                    rate: 0.25,
                    depth: 0.5,
                    mix: 0.45,
                    input: Box::new(Filter {
                        kind: FilterKind::SvfLp,
                        cutoff: 0.65,
                        resonance: 0.2,
                        mod_depth: 0.25,
                        modulation: ModNode::Lfo {
                            wave: Waveform::Sine,
                            rate: 0.2,
                        },
                        input: Box::new(Supersaw {
                            octave: 0,
                            detune: 0.4,
                            mix: 0.6,
                        }),
                    }),
                },
            },
        ),
        (
            "Pluck",
            PatchTree {
                amp: amp(0.0, 0.25, 0.05, 0.25),
                root: Filter {
                    kind: FilterKind::SvfBp,
                    cutoff: 0.6,
                    resonance: 0.45,
                    mod_depth: 0.5,
                    modulation: ModNode::Env {
                        attack: 0.0,
                        decay: 0.25,
                    },
                    input: Box::new(vco(Waveform::Triangle, 0, 0.5)),
                },
            },
        ),
        (
            "Dub Echo",
            PatchTree {
                amp: amp(0.02, 0.3, 0.5, 0.4),
                root: Delay {
                    time: 0.45,
                    feedback: 0.75,
                    mix: 0.5,
                    input: Box::new(Filter {
                        kind: FilterKind::SvfLp,
                        cutoff: 0.5,
                        resonance: 0.35,
                        mod_depth: 0.0,
                        modulation: ModNode::None,
                        input: Box::new(vco(Waveform::Square, 0, 0.5)),
                    }),
                },
            },
        ),
        (
            "Folded Lead",
            PatchTree {
                amp: amp(0.02, 0.3, 0.7, 0.3),
                root: Fold {
                    threshold: 0.4,
                    mod_depth: 0.5,
                    modulation: ModNode::Lfo {
                        wave: Waveform::Triangle,
                        rate: 0.35,
                    },
                    input: Box::new(vco(Waveform::Saw, 0, 0.55)),
                },
            },
        ),
        (
            "Noise Wash",
            PatchTree {
                amp: amp(0.7, 0.5, 0.75, 0.8),
                root: Filter {
                    kind: FilterKind::SvfLp,
                    cutoff: 0.45,
                    resonance: 0.5,
                    mod_depth: 0.5,
                    modulation: ModNode::Lfo {
                        wave: Waveform::Sine,
                        rate: 0.15,
                    },
                    input: Box::new(Noise {
                        color: NoiseColor::Pink,
                    }),
                },
            },
        ),
        (
            "Detune Dream",
            PatchTree {
                amp: amp(0.35, 0.4, 0.75, 0.55),
                root: Delay {
                    time: 0.3,
                    feedback: 0.45,
                    mix: 0.35,
                    input: Box::new(Chorus {
                        rate: 0.3,
                        depth: 0.55,
                        mix: 0.4,
                        input: Box::new(Supersaw {
                            octave: 0,
                            detune: 0.55,
                            mix: 0.5,
                        }),
                    }),
                },
            },
        ),
        (
            "Sub & Sparkle",
            PatchTree {
                amp: amp(0.05, 0.35, 0.65, 0.35),
                root: Mix {
                    balance: 0.35,
                    a: Box::new(vco(Waveform::Sine, -1, 0.5)),
                    b: Box::new(Filter {
                        kind: FilterKind::SvfHp,
                        cutoff: 0.7,
                        resonance: 0.3,
                        mod_depth: 0.0,
                        modulation: ModNode::None,
                        input: Box::new(vco(Waveform::Saw, 1, 0.6)),
                    }),
                },
            },
        ),
    ]
}
