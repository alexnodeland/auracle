//! [`PatchTree`] as a fugue-evo genome.
//!
//! The canonical [`TraceGenome`] encoding **is** the grammar's address scheme
//! (see [`crate::prior`]): `to_trace` is a deterministic walk emitting the
//! same `#leaf`/`#src`/`#op`/param choices the generative model samples, and
//! `from_trace` inverts it. Because [`GenomePrior::trace_of`]'s default
//! delegates to `to_trace`, scoring, warm-starting chains, and decode-replay
//! all work without a second, divergent encoding.
//!
//! [`GenomePrior::trace_of`]: fugue_evo::inference::prior::GenomePrior::trace_of

use fugue::{addr, Trace};
use fugue_evo::error::GenomeError;
use fugue_evo::genome::bounds::MultiBounds;
use fugue_evo::genome::trace_genome::{ChoiceValue, TraceGenome};
use fugue_evo::genome::traits::EvolutionaryGenome;
use rand::Rng;

use crate::prior::PatchGrammarPrior;
use crate::term::{AmpEnv, AudioNode, FilterKind, ModNode, NoiseColor, PatchTree, Waveform};

impl EvolutionaryGenome for PatchTree {
    type Allele = f64;
    type Phenotype = PatchTree;

    fn decode(&self) -> Self::Phenotype {
        self.clone()
    }

    fn dimension(&self) -> usize {
        self.site_count()
    }

    /// Draws from the **default** grammar configuration; `bounds` is ignored
    /// (this genome has no numeric-box structure). Prefer
    /// [`PatchGrammarPrior::sample_with_rng`] to control the grammar.
    fn generate<R: Rng>(rng: &mut R, _bounds: &MultiBounds) -> Self {
        PatchGrammarPrior::default().sample_with_rng(rng)
    }

    /// Structural distance: parameter L1 where the trees agree, and a
    /// subtree-size penalty where they diverge. Defined for any pair (never
    /// panics); a heuristic for diversity mechanisms, not a metric with
    /// audio-perceptual meaning.
    fn distance(&self, other: &Self) -> f64 {
        let amp = (self.amp.attack - other.amp.attack).abs()
            + (self.amp.decay - other.amp.decay).abs()
            + (self.amp.sustain - other.amp.sustain).abs()
            + (self.amp.release - other.amp.release).abs();
        amp + node_distance(&self.root, &other.root)
    }

    fn try_distance(&self, other: &Self) -> Result<f64, GenomeError> {
        Ok(self.distance(other))
    }
}

fn mod_distance(a: &ModNode, b: &ModNode) -> f64 {
    match (a, b) {
        (ModNode::None, ModNode::None) => 0.0,
        (ModNode::Lfo { wave: wa, rate: ra }, ModNode::Lfo { wave: wb, rate: rb }) => {
            (if wa == wb { 0.0 } else { 1.0 }) + (ra - rb).abs()
        }
        (
            ModNode::Env {
                attack: aa,
                decay: da,
            },
            ModNode::Env {
                attack: ab,
                decay: db,
            },
        ) => (aa - ab).abs() + (da - db).abs(),
        (ModNode::Rand { rate: ra }, ModNode::Rand { rate: rb }) => (ra - rb).abs(),
        _ => 2.0,
    }
}

fn node_distance(a: &AudioNode, b: &AudioNode) -> f64 {
    use AudioNode::*;
    match (a, b) {
        (
            Vco {
                wave: wa,
                octave: oa,
                detune: da,
            },
            Vco {
                wave: wb,
                octave: ob,
                detune: db,
            },
        ) => {
            (if wa == wb { 0.0 } else { 1.0 })
                + (*oa as f64 - *ob as f64).abs() / 4.0
                + (da - db).abs()
        }
        (
            Supersaw {
                octave: oa,
                detune: da,
                mix: ma,
            },
            Supersaw {
                octave: ob,
                detune: db,
                mix: mb,
            },
        ) => (*oa as f64 - *ob as f64).abs() / 4.0 + (da - db).abs() + (ma - mb).abs(),
        (Noise { color: ca }, Noise { color: cb }) => {
            if ca == cb {
                0.0
            } else {
                1.0
            }
        }
        (
            Mix {
                balance: la,
                a: aa,
                b: ba,
            },
            Mix {
                balance: lb,
                a: ab,
                b: bb,
            },
        ) => (la - lb).abs() + node_distance(aa, ab) + node_distance(ba, bb),
        (
            Filter {
                kind: ka,
                cutoff: ca,
                resonance: ra,
                mod_depth: ma,
                input: ia,
                modulation: moda,
            },
            Filter {
                kind: kb,
                cutoff: cb,
                resonance: rb,
                mod_depth: mb,
                input: ib,
                modulation: modb,
            },
        ) => {
            (if ka == kb { 0.0 } else { 1.0 })
                + (ca - cb).abs()
                + (ra - rb).abs()
                + (ma - mb).abs()
                + mod_distance(moda, modb)
                + node_distance(ia, ib)
        }
        (
            Fold {
                threshold: ta,
                mod_depth: ma,
                input: ia,
                modulation: moda,
            },
            Fold {
                threshold: tb,
                mod_depth: mb,
                input: ib,
                modulation: modb,
            },
        ) => (ta - tb).abs() + (ma - mb).abs() + mod_distance(moda, modb) + node_distance(ia, ib),
        (
            Delay {
                time: ta,
                feedback: fa,
                mix: ma,
                input: ia,
            },
            Delay {
                time: tb,
                feedback: fb,
                mix: mb,
                input: ib,
            },
        ) => (ta - tb).abs() + (fa - fb).abs() + (ma - mb).abs() + node_distance(ia, ib),
        (
            Chorus {
                rate: ra,
                depth: da,
                mix: ma,
                input: ia,
            },
            Chorus {
                rate: rb,
                depth: db,
                mix: mb,
                input: ib,
            },
        ) => (ra - rb).abs() + (da - db).abs() + (ma - mb).abs() + node_distance(ia, ib),
        (
            Reverb {
                size: sa,
                damp: da,
                mix: ma,
                input: ia,
            },
            Reverb {
                size: sb,
                damp: db,
                mix: mb,
                input: ib,
            },
        ) => (sa - sb).abs() + (da - db).abs() + (ma - mb).abs() + node_distance(ia, ib),
        // Different constructors: whole-subtree penalty.
        _ => (a.size() + b.size()) as f64,
    }
}

// ---------------------------------------------------------------------------
// Trace encoding (canonical == grammar address scheme)
// ---------------------------------------------------------------------------

fn child_key(key: &str, i: usize) -> String {
    format!("{key}/{i}")
}

fn mod_key(key: &str) -> String {
    format!("{key}/m")
}

fn put_f64(t: &mut Trace, key: &str, site: &str, v: f64) {
    t.insert_choice(addr!(key, site), ChoiceValue::F64(v), 0.0);
}

fn put_usize(t: &mut Trace, key: &str, site: &str, v: usize) {
    t.insert_choice(addr!(key, site), ChoiceValue::Usize(v), 0.0);
}

fn put_bool(t: &mut Trace, key: &str, site: &str, v: bool) {
    t.insert_choice(addr!(key, site), ChoiceValue::Bool(v), 0.0);
}

fn encode_mod(m: &ModNode, key: &str, t: &mut Trace) {
    match m {
        ModNode::None => put_usize(t, key, "mod", 0),
        ModNode::Lfo { wave, rate } => {
            put_usize(t, key, "mod", 1);
            put_usize(t, key, "wave", wave.index());
            put_f64(t, key, "rate", *rate);
        }
        ModNode::Env { attack, decay } => {
            put_usize(t, key, "mod", 2);
            put_f64(t, key, "att", *attack);
            put_f64(t, key, "dec", *decay);
        }
        ModNode::Rand { rate } => {
            put_usize(t, key, "mod", 3);
            put_f64(t, key, "rate", *rate);
        }
    }
}

fn encode_node(n: &AudioNode, key: &str, t: &mut Trace) {
    use AudioNode::*;
    match n {
        Vco {
            wave,
            octave,
            detune,
        } => {
            put_bool(t, key, "leaf", true);
            put_usize(t, key, "src", 0);
            put_usize(t, key, "wave", wave.index());
            put_usize(t, key, "oct", (octave + 2) as usize);
            put_f64(t, key, "det", *detune);
        }
        Supersaw {
            octave,
            detune,
            mix,
        } => {
            put_bool(t, key, "leaf", true);
            put_usize(t, key, "src", 1);
            put_usize(t, key, "oct", (octave + 2) as usize);
            put_f64(t, key, "det", *detune);
            put_f64(t, key, "smix", *mix);
        }
        Noise { color } => {
            put_bool(t, key, "leaf", true);
            put_usize(t, key, "src", 2);
            put_usize(t, key, "color", color.index());
        }
        Mix { balance, a, b } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 0);
            put_f64(t, key, "bal", *balance);
            encode_node(a, &child_key(key, 0), t);
            encode_node(b, &child_key(key, 1), t);
        }
        Filter {
            kind,
            cutoff,
            resonance,
            mod_depth,
            input,
            modulation,
        } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 1);
            put_usize(t, key, "fkind", kind.index());
            put_f64(t, key, "cut", *cutoff);
            put_f64(t, key, "res", *resonance);
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
            encode_node(input, &child_key(key, 0), t);
        }
        Fold {
            threshold,
            mod_depth,
            input,
            modulation,
        } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 2);
            put_f64(t, key, "thresh", *threshold);
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
            encode_node(input, &child_key(key, 0), t);
        }
        Delay {
            time,
            feedback,
            mix,
            input,
        } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 3);
            put_f64(t, key, "time", *time);
            put_f64(t, key, "fb", *feedback);
            put_f64(t, key, "dmix", *mix);
            encode_node(input, &child_key(key, 0), t);
        }
        Chorus {
            rate,
            depth,
            mix,
            input,
        } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 4);
            put_f64(t, key, "crate", *rate);
            put_f64(t, key, "cdepth", *depth);
            put_f64(t, key, "cmix", *mix);
            encode_node(input, &child_key(key, 0), t);
        }
        Reverb {
            size,
            damp,
            mix,
            input,
        } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 5);
            put_f64(t, key, "rsize", *size);
            put_f64(t, key, "rdamp", *damp);
            put_f64(t, key, "rmix", *mix);
            encode_node(input, &child_key(key, 0), t);
        }
    }
}

fn get_f64(t: &Trace, key: &str, site: &str) -> Result<f64, GenomeError> {
    let a = addr!(key, site);
    t.get_f64(&a)
        .ok_or_else(|| GenomeError::MissingAddress(a.to_string()))
}

fn get_usize(t: &Trace, key: &str, site: &str) -> Result<usize, GenomeError> {
    let a = addr!(key, site);
    t.get_usize(&a)
        .ok_or_else(|| GenomeError::MissingAddress(a.to_string()))
}

fn get_bool(t: &Trace, key: &str, site: &str) -> Result<bool, GenomeError> {
    let a = addr!(key, site);
    t.get_bool(&a)
        .ok_or_else(|| GenomeError::MissingAddress(a.to_string()))
}

fn decode_mod(t: &Trace, key: &str) -> Result<ModNode, GenomeError> {
    match get_usize(t, key, "mod")? {
        0 => Ok(ModNode::None),
        1 => Ok(ModNode::Lfo {
            wave: Waveform::from_index(get_usize(t, key, "wave")?),
            rate: get_f64(t, key, "rate")?,
        }),
        2 => Ok(ModNode::Env {
            attack: get_f64(t, key, "att")?,
            decay: get_f64(t, key, "dec")?,
        }),
        3 => Ok(ModNode::Rand {
            rate: get_f64(t, key, "rate")?,
        }),
        k => Err(GenomeError::InvalidStructure(format!(
            "mod kind {k} out of range at {key}"
        ))),
    }
}

fn decode_node(t: &Trace, key: &str) -> Result<AudioNode, GenomeError> {
    if get_bool(t, key, "leaf")? {
        match get_usize(t, key, "src")? {
            0 => Ok(AudioNode::Vco {
                wave: Waveform::from_index(get_usize(t, key, "wave")?),
                octave: get_usize(t, key, "oct")? as i8 - 2,
                detune: get_f64(t, key, "det")?,
            }),
            1 => Ok(AudioNode::Supersaw {
                octave: get_usize(t, key, "oct")? as i8 - 2,
                detune: get_f64(t, key, "det")?,
                mix: get_f64(t, key, "smix")?,
            }),
            2 => Ok(AudioNode::Noise {
                color: NoiseColor::from_index(get_usize(t, key, "color")?),
            }),
            k => Err(GenomeError::InvalidStructure(format!(
                "source kind {k} out of range at {key}"
            ))),
        }
    } else {
        match get_usize(t, key, "op")? {
            0 => Ok(AudioNode::Mix {
                balance: get_f64(t, key, "bal")?,
                a: Box::new(decode_node(t, &child_key(key, 0))?),
                b: Box::new(decode_node(t, &child_key(key, 1))?),
            }),
            1 => Ok(AudioNode::Filter {
                kind: FilterKind::from_index(get_usize(t, key, "fkind")?),
                cutoff: get_f64(t, key, "cut")?,
                resonance: get_f64(t, key, "res")?,
                mod_depth: get_f64(t, key, "mdepth")?,
                modulation: decode_mod(t, &mod_key(key))?,
                input: Box::new(decode_node(t, &child_key(key, 0))?),
            }),
            2 => Ok(AudioNode::Fold {
                threshold: get_f64(t, key, "thresh")?,
                mod_depth: get_f64(t, key, "mdepth")?,
                modulation: decode_mod(t, &mod_key(key))?,
                input: Box::new(decode_node(t, &child_key(key, 0))?),
            }),
            3 => Ok(AudioNode::Delay {
                time: get_f64(t, key, "time")?,
                feedback: get_f64(t, key, "fb")?,
                mix: get_f64(t, key, "dmix")?,
                input: Box::new(decode_node(t, &child_key(key, 0))?),
            }),
            4 => Ok(AudioNode::Chorus {
                rate: get_f64(t, key, "crate")?,
                depth: get_f64(t, key, "cdepth")?,
                mix: get_f64(t, key, "cmix")?,
                input: Box::new(decode_node(t, &child_key(key, 0))?),
            }),
            5 => Ok(AudioNode::Reverb {
                size: get_f64(t, key, "rsize")?,
                damp: get_f64(t, key, "rdamp")?,
                mix: get_f64(t, key, "rmix")?,
                input: Box::new(decode_node(t, &child_key(key, 0))?),
            }),
            k => Err(GenomeError::InvalidStructure(format!(
                "op kind {k} out of range at {key}"
            ))),
        }
    }
}

impl TraceGenome for PatchTree {
    fn to_trace(&self) -> Trace {
        let mut t = Trace::default();
        put_f64(&mut t, "amp", "attack", self.amp.attack);
        put_f64(&mut t, "amp", "decay", self.amp.decay);
        put_f64(&mut t, "amp", "sustain", self.amp.sustain);
        put_f64(&mut t, "amp", "release", self.amp.release);
        encode_node(&self.root, "node", &mut t);
        t
    }

    fn from_trace(trace: &Trace) -> Result<Self, GenomeError> {
        Ok(PatchTree {
            amp: AmpEnv {
                attack: get_f64(trace, "amp", "attack")?,
                decay: get_f64(trace, "amp", "decay")?,
                sustain: get_f64(trace, "amp", "sustain")?,
                release: get_f64(trace, "amp", "release")?,
            },
            root: decode_node(trace, "node")?,
        })
    }

    fn trace_prefix() -> &'static str {
        "node"
    }
}
