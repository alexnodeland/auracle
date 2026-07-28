//! The patch prior: a typed PCFG over [`PatchTree`] terms as a fugue program.
//!
//! Every node at tree path `p` (root key `"node"`, children `"node/0"`,
//! `"node/0/1"`, …; a processor's modulation slot at `"<p>/m"`) emits real
//! probabilistic choices at path-keyed addresses:
//!
//! | Site | Address | Distribution |
//! |---|---|---|
//! | source-vs-processor | `<p>#leaf` | `Bernoulli(source_prob)` (forced at max depth) |
//! | source kind | `<p>#src` | `Categorical(source_weights)` |
//! | processor kind | `<p>#op` | `Categorical(op_weights)` |
//! | modulation kind | `<p>/m#mod` | `Categorical(mod_weights)` |
//! | discrete params | `<p>#wave` / `#oct` / `#color` / `#fkind` | uniform categoricals |
//! | continuous params | `<p>#det`, `#cut`, `#res`, … | `Uniform(0, 1)` |
//!
//! The amplitude envelope lives at `amp#attack` … `amp#release`.
//!
//! Because the structure of an execution is encoded in its own choices, the
//! generic trace machinery (subtree regeneration MH, subtree-swap crossover)
//! applies unchanged — this mirrors fugue-evo's `ArithmeticGrammarPrior`
//! design, with quiver signal sorts in place of arithmetic types.
//!
//! Deeper patches pay more prior mass by construction: parsimony pressure is
//! the grammar itself, not an ad-hoc penalty.

use fugue::{addr, sample, Bernoulli, Categorical, Model, ModelExt, Uniform};
use fugue_evo::inference::prior::GenomePrior;
use rand::Rng;

use crate::term::{AmpEnv, AudioNode, FilterKind, ModNode, NoiseColor, PatchTree, Waveform};

/// Source-kind categorical order: Vco, Supersaw, Noise.
pub const N_SOURCES: usize = 3;
/// Processor-kind categorical order: Mix, Filter, Fold, Delay, Chorus.
pub const N_OPS: usize = 5;
/// Modulation-kind categorical order: None, Lfo, Env.
pub const N_MODS: usize = 3;

/// The typed PCFG over patch terms.
#[derive(Clone, Debug)]
pub struct PatchGrammarPrior {
    /// Probability that a node (below max depth) is a source leaf.
    pub source_prob: f64,
    /// Maximum tree depth; nodes at this depth are forced to be sources.
    pub max_depth: usize,
    /// Weights over source kinds `[Vco, Supersaw, Noise]`.
    pub source_weights: [f64; N_SOURCES],
    /// Weights over processor kinds `[Mix, Filter, Fold, Delay, Chorus]`.
    pub op_weights: [f64; N_OPS],
    /// Weights over modulation kinds `[None, Lfo, Env]`.
    pub mod_weights: [f64; N_MODS],
}

impl Default for PatchGrammarPrior {
    fn default() -> Self {
        Self {
            source_prob: 0.4,
            max_depth: 5,
            // Noise is a spice, not a staple.
            source_weights: [0.45, 0.35, 0.2],
            // Filters carry subtractive character; mixing and time-fx follow.
            op_weights: [0.2, 0.35, 0.15, 0.15, 0.15],
            // Most processor slots are unmodulated; envelopes slightly beat
            // LFOs for the classic filter-sweep idiom.
            mod_weights: [0.5, 0.22, 0.28],
        }
    }
}

fn child_key(key: &str, i: usize) -> String {
    format!("{key}/{i}")
}

fn mod_key(key: &str) -> String {
    format!("{key}/m")
}

fn u01() -> Uniform {
    Uniform::new(0.0, 1.0).expect("valid unit uniform")
}

fn uniform_cat(n: usize) -> Categorical {
    Categorical::new(vec![1.0 / n as f64; n]).expect("valid uniform categorical")
}

fn weighted_cat(weights: &[f64]) -> Categorical {
    let total: f64 = weights.iter().sum();
    Categorical::new(weights.iter().map(|w| w / total).collect()).expect("valid categorical")
}

impl PatchGrammarPrior {
    fn source_model(&self, key: String) -> Model<AudioNode> {
        let weights = self.source_weights;
        sample(addr!(key.clone(), "src"), weighted_cat(&weights)).bind(move |src| match src {
            0 => {
                let k = key.clone();
                sample(addr!(k.clone(), "wave"), uniform_cat(Waveform::ALL.len())).bind(move |w| {
                    let k2 = k.clone();
                    sample(addr!(k2.clone(), "oct"), uniform_cat(5)).bind(move |o| {
                        sample(addr!(k2.clone(), "det"), u01()).map(move |d| AudioNode::Vco {
                            wave: Waveform::from_index(w),
                            octave: o as i8 - 2,
                            detune: d,
                        })
                    })
                })
            }
            1 => {
                let k = key.clone();
                sample(addr!(k.clone(), "oct"), uniform_cat(5)).bind(move |o| {
                    let k2 = k.clone();
                    sample(addr!(k2.clone(), "det"), u01()).bind(move |d| {
                        sample(addr!(k2.clone(), "smix"), u01()).map(move |m| AudioNode::Supersaw {
                            octave: o as i8 - 2,
                            detune: d,
                            mix: m,
                        })
                    })
                })
            }
            _ => sample(
                addr!(key.clone(), "color"),
                uniform_cat(NoiseColor::ALL.len()),
            )
            .map(|c| AudioNode::Noise {
                color: NoiseColor::from_index(c),
            }),
        })
    }

    fn mod_model(&self, key: String) -> Model<ModNode> {
        let weights = self.mod_weights;
        sample(addr!(key.clone(), "mod"), weighted_cat(&weights)).bind(move |kind| match kind {
            0 => fugue::pure(ModNode::None),
            1 => {
                let k = key.clone();
                sample(addr!(k.clone(), "wave"), uniform_cat(Waveform::ALL.len())).bind(move |w| {
                    sample(addr!(k.clone(), "rate"), u01()).map(move |r| ModNode::Lfo {
                        wave: Waveform::from_index(w),
                        rate: r,
                    })
                })
            }
            _ => {
                let k = key.clone();
                sample(addr!(k.clone(), "att"), u01()).bind(move |a| {
                    sample(addr!(k.clone(), "dec"), u01()).map(move |d| ModNode::Env {
                        attack: a,
                        decay: d,
                    })
                })
            }
        })
    }

    fn audio_model(&self, key: String, depth: usize) -> Model<AudioNode> {
        let cfg = self.clone();
        let p_leaf = if depth >= cfg.max_depth {
            1.0
        } else {
            cfg.source_prob
        };
        sample(
            addr!(key.clone(), "leaf"),
            Bernoulli::new(p_leaf).expect("valid leaf probability"),
        )
        .bind(move |is_leaf| {
            if is_leaf {
                cfg.source_model(key.clone())
            } else {
                let cfg2 = cfg.clone();
                let key2 = key.clone();
                sample(addr!(key.clone(), "op"), weighted_cat(&cfg.op_weights))
                    .bind(move |op| cfg2.op_model(key2.clone(), op, depth))
            }
        })
    }

    fn op_model(&self, key: String, op: usize, depth: usize) -> Model<AudioNode> {
        let cfg = self.clone();
        match op {
            // Mix
            0 => {
                let (ka, kb) = (child_key(&key, 0), child_key(&key, 1));
                let (cfg_a, cfg_b) = (cfg.clone(), cfg.clone());
                sample(addr!(key, "bal"), u01()).bind(move |bal| {
                    let cfg_b = cfg_b.clone();
                    let kb = kb.clone();
                    cfg_a.audio_model(ka.clone(), depth + 1).bind(move |a| {
                        cfg_b
                            .audio_model(kb.clone(), depth + 1)
                            .map(move |b| AudioNode::Mix {
                                balance: bal,
                                a: Box::new(a.clone()),
                                b: Box::new(b),
                            })
                    })
                })
            }
            // Filter
            1 => {
                let k = key.clone();
                sample(
                    addr!(k.clone(), "fkind"),
                    uniform_cat(FilterKind::ALL.len()),
                )
                .bind(move |fk| {
                    let k2 = k.clone();
                    let cfg2 = cfg.clone();
                    sample(addr!(k2.clone(), "cut"), u01()).bind(move |cut| {
                        let k3 = k2.clone();
                        let cfg3 = cfg2.clone();
                        sample(addr!(k3.clone(), "res"), u01()).bind(move |res| {
                            let k4 = k3.clone();
                            let cfg4 = cfg3.clone();
                            sample(addr!(k4.clone(), "mdepth"), u01()).bind(move |md| {
                                let k5 = k4.clone();
                                let cfg5 = cfg4.clone();
                                cfg4.mod_model(mod_key(&k5)).bind(move |m| {
                                    let m = m.clone();
                                    cfg5.audio_model(child_key(&k5, 0), depth + 1).map(
                                        move |input| AudioNode::Filter {
                                            kind: FilterKind::from_index(fk),
                                            cutoff: cut,
                                            resonance: res,
                                            mod_depth: md,
                                            input: Box::new(input),
                                            modulation: m.clone(),
                                        },
                                    )
                                })
                            })
                        })
                    })
                })
            }
            // Fold
            2 => {
                let k = key.clone();
                sample(addr!(k.clone(), "thresh"), u01()).bind(move |t| {
                    let k2 = k.clone();
                    let cfg2 = cfg.clone();
                    sample(addr!(k2.clone(), "mdepth"), u01()).bind(move |md| {
                        let k3 = k2.clone();
                        let cfg3 = cfg2.clone();
                        cfg2.mod_model(mod_key(&k3)).bind(move |m| {
                            let m = m.clone();
                            cfg3.audio_model(child_key(&k3, 0), depth + 1)
                                .map(move |input| AudioNode::Fold {
                                    threshold: t,
                                    mod_depth: md,
                                    input: Box::new(input),
                                    modulation: m.clone(),
                                })
                        })
                    })
                })
            }
            // Delay
            3 => {
                let k = key.clone();
                sample(addr!(k.clone(), "time"), u01()).bind(move |t| {
                    let k2 = k.clone();
                    let cfg2 = cfg.clone();
                    sample(addr!(k2.clone(), "fb"), u01()).bind(move |fb| {
                        let k3 = k2.clone();
                        let cfg3 = cfg2.clone();
                        sample(addr!(k3.clone(), "dmix"), u01()).bind(move |mx| {
                            cfg3.audio_model(child_key(&k3, 0), depth + 1)
                                .map(move |input| AudioNode::Delay {
                                    time: t,
                                    feedback: fb,
                                    mix: mx,
                                    input: Box::new(input),
                                })
                        })
                    })
                })
            }
            // Chorus
            _ => {
                let k = key.clone();
                sample(addr!(k.clone(), "crate"), u01()).bind(move |r| {
                    let k2 = k.clone();
                    let cfg2 = cfg.clone();
                    sample(addr!(k2.clone(), "cdepth"), u01()).bind(move |d| {
                        let k3 = k2.clone();
                        let cfg3 = cfg2.clone();
                        sample(addr!(k3.clone(), "cmix"), u01()).bind(move |mx| {
                            cfg3.audio_model(child_key(&k3, 0), depth + 1)
                                .map(move |input| AudioNode::Chorus {
                                    rate: r,
                                    depth: d,
                                    mix: mx,
                                    input: Box::new(input),
                                })
                        })
                    })
                })
            }
        }
    }

    /// Draw a tree with a plain RNG (no trace) — the classic-layer sampler
    /// mirroring [`Self::model`]. Used by `EvolutionaryGenome::generate`.
    pub fn sample_with_rng<R: Rng>(&self, rng: &mut R) -> PatchTree {
        let amp = AmpEnv {
            attack: rng.gen::<f64>(),
            decay: rng.gen::<f64>(),
            sustain: rng.gen::<f64>(),
            release: rng.gen::<f64>(),
        };
        let root = self.sample_audio(rng, 0);
        PatchTree { amp, root }
    }

    fn sample_audio<R: Rng>(&self, rng: &mut R, depth: usize) -> AudioNode {
        let is_leaf = depth >= self.max_depth || rng.gen_bool(self.source_prob);
        if is_leaf {
            match weighted_choice(rng, &self.source_weights) {
                0 => AudioNode::Vco {
                    wave: Waveform::from_index(rng.gen_range(0..Waveform::ALL.len())),
                    octave: rng.gen_range(0..5) as i8 - 2,
                    detune: rng.gen(),
                },
                1 => AudioNode::Supersaw {
                    octave: rng.gen_range(0..5) as i8 - 2,
                    detune: rng.gen(),
                    mix: rng.gen(),
                },
                _ => AudioNode::Noise {
                    color: NoiseColor::from_index(rng.gen_range(0..NoiseColor::ALL.len())),
                },
            }
        } else {
            match weighted_choice(rng, &self.op_weights) {
                0 => AudioNode::Mix {
                    balance: rng.gen(),
                    a: Box::new(self.sample_audio(rng, depth + 1)),
                    b: Box::new(self.sample_audio(rng, depth + 1)),
                },
                1 => AudioNode::Filter {
                    kind: FilterKind::from_index(rng.gen_range(0..FilterKind::ALL.len())),
                    cutoff: rng.gen(),
                    resonance: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng),
                    input: Box::new(self.sample_audio(rng, depth + 1)),
                },
                2 => AudioNode::Fold {
                    threshold: rng.gen(),
                    mod_depth: rng.gen(),
                    modulation: self.sample_mod(rng),
                    input: Box::new(self.sample_audio(rng, depth + 1)),
                },
                3 => AudioNode::Delay {
                    time: rng.gen(),
                    feedback: rng.gen(),
                    mix: rng.gen(),
                    input: Box::new(self.sample_audio(rng, depth + 1)),
                },
                _ => AudioNode::Chorus {
                    rate: rng.gen(),
                    depth: rng.gen(),
                    mix: rng.gen(),
                    input: Box::new(self.sample_audio(rng, depth + 1)),
                },
            }
        }
    }

    fn sample_mod<R: Rng>(&self, rng: &mut R) -> ModNode {
        match weighted_choice(rng, &self.mod_weights) {
            0 => ModNode::None,
            1 => ModNode::Lfo {
                wave: Waveform::from_index(rng.gen_range(0..Waveform::ALL.len())),
                rate: rng.gen(),
            },
            _ => ModNode::Env {
                attack: rng.gen(),
                decay: rng.gen(),
            },
        }
    }
}

fn weighted_choice<R: Rng>(rng: &mut R, weights: &[f64]) -> usize {
    let total: f64 = weights.iter().sum();
    let mut x = rng.gen::<f64>() * total;
    for (i, w) in weights.iter().enumerate() {
        x -= w;
        if x <= 0.0 {
            return i;
        }
    }
    weights.len() - 1
}

impl GenomePrior for PatchGrammarPrior {
    type Genome = PatchTree;

    fn model(&self) -> Model<PatchTree> {
        let cfg = self.clone();
        sample(addr!("amp", "attack"), u01()).bind(move |a| {
            let cfg = cfg.clone();
            sample(addr!("amp", "decay"), u01()).bind(move |d| {
                let cfg = cfg.clone();
                sample(addr!("amp", "sustain"), u01()).bind(move |s| {
                    let cfg = cfg.clone();
                    sample(addr!("amp", "release"), u01()).bind(move |r| {
                        cfg.audio_model("node".to_string(), 0)
                            .map(move |root| PatchTree {
                                amp: AmpEnv {
                                    attack: a,
                                    decay: d,
                                    sustain: s,
                                    release: r,
                                },
                                root,
                            })
                    })
                })
            })
        })
    }
    // `trace_of` uses the default: it delegates to `TraceGenome::to_trace`,
    // whose canonical encoding (crate::genome) IS this grammar's address
    // scheme — the two cannot drift apart without breaking the round-trip
    // property test.
}
