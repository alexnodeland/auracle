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
use crate::term::{
    AmpEnv, AudioNode, DriveMode, FilterKind, ModNode, ModOp, NoiseColor, PairOp, PatchTree,
    TableShape, Uid, Waveform,
};

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
        (
            ModNode::Lfo {
                wave: wa, rate: ra, ..
            },
            ModNode::Lfo {
                wave: wb, rate: rb, ..
            },
        ) => (if wa == wb { 0.0 } else { 1.0 }) + (ra - rb).abs(),
        (
            ModNode::Env {
                attack: aa,
                decay: da,
                ..
            },
            ModNode::Env {
                attack: ab,
                decay: db,
                ..
            },
        ) => (aa - ab).abs() + (da - db).abs(),
        (
            ModNode::Rand {
                rate: ra,
                glide: ga,
                ..
            },
            ModNode::Rand {
                rate: rb,
                glide: gb,
                ..
            },
        ) => (ra - rb).abs() + (ga - gb).abs(),
        (
            ModNode::Follow {
                sens: sa,
                release: ra,
                ..
            },
            ModNode::Follow {
                sens: sb,
                release: rb,
                ..
            },
        ) => (sa - sb).abs() + (ra - rb).abs(),
        (
            ModNode::Euclid {
                rate: ra,
                steps: sa,
                pulses: pa,
                ..
            },
            ModNode::Euclid {
                rate: rb,
                steps: sb,
                pulses: pb,
                ..
            },
        ) => (ra - rb).abs() + (sa - sb).abs() + (pa - pb).abs(),
        // Recursive arms, on the same rule the audio tree uses: parameter L1
        // where the terms agree, and a flat penalty where they diverge.
        (
            ModNode::Op {
                kind: ka,
                p0: p0a,
                p1: p1a,
                input: ia,
                ..
            },
            ModNode::Op {
                kind: kb,
                p0: p0b,
                p1: p1b,
                input: ib,
                ..
            },
        ) if ka == kb => (p0a - p0b).abs() + (p1a - p1b).abs() + mod_distance(ia, ib),
        (
            ModNode::Pair {
                kind: ka,
                a: aa,
                b: ba,
                ..
            },
            ModNode::Pair {
                kind: kb,
                a: ab,
                b: bb,
                ..
            },
        ) if ka == kb => mod_distance(aa, ab) + mod_distance(ba, bb),
        // Diverging structures pay by size, so replacing a leaf with a
        // two-deep chain reads as further away than swapping two leaves — the
        // same shape as `node_distance`'s subtree penalty.
        (a, b) => 2.0 + (a.size() as f64 - b.size() as f64).abs(),
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
                mod_depth: mda,
                modulation: moda,
                ..
            },
            Vco {
                wave: wb,
                octave: ob,
                detune: db,
                mod_depth: mdb,
                modulation: modb,
                ..
            },
        ) => {
            (if wa == wb { 0.0 } else { 1.0 })
                + (*oa as f64 - *ob as f64).abs() / 4.0
                + (da - db).abs()
                + (mda - mdb).abs()
                + mod_distance(moda, modb)
        }
        (
            Supersaw {
                octave: oa,
                detune: da,
                mix: ma,
                mod_depth: mda,
                modulation: moda,
                ..
            },
            Supersaw {
                octave: ob,
                detune: db,
                mix: mb,
                mod_depth: mdb,
                modulation: modb,
                ..
            },
        ) => {
            (*oa as f64 - *ob as f64).abs() / 4.0
                + (da - db).abs()
                + (ma - mb).abs()
                + (mda - mdb).abs()
                + mod_distance(moda, modb)
        }
        (
            Formant {
                vowel: va,
                shift: sa,
                octave: oa,
                mod_depth: mda,
                modulation: moda,
                ..
            },
            Formant {
                vowel: vb,
                shift: sb,
                octave: ob,
                mod_depth: mdb,
                modulation: modb,
                ..
            },
        ) => {
            (va - vb).abs()
                + (sa - sb).abs()
                + (*oa as f64 - *ob as f64).abs() / 4.0
                + (mda - mdb).abs()
                + mod_distance(moda, modb)
        }
        (Noise { color: ca, .. }, Noise { color: cb, .. }) => {
            if ca == cb {
                0.0
            } else {
                1.0
            }
        }
        (
            Wavetable {
                table: ta,
                octave: oa,
                morph: ma,
                mod_depth: da,
                modulation: moda,
                ..
            },
            Wavetable {
                table: tb,
                octave: ob,
                morph: mb,
                mod_depth: db,
                modulation: modb,
                ..
            },
        ) => {
            (if ta == tb { 0.0 } else { 1.0 })
                + (*oa as f64 - *ob as f64).abs() / 4.0
                + (ma - mb).abs()
                + (da - db).abs()
                + mod_distance(moda, modb)
        }
        (
            Pluck {
                octave: oa,
                damping: da,
                brightness: ba,
                mod_depth: mda,
                modulation: moda,
                ..
            },
            Pluck {
                octave: ob,
                damping: db,
                brightness: bb,
                mod_depth: mdb,
                modulation: modb,
                ..
            },
        ) => {
            (*oa as f64 - *ob as f64).abs() / 4.0
                + (da - db).abs()
                + (ba - bb).abs()
                + (mda - mdb).abs()
                + mod_distance(moda, modb)
        }
        (
            Mix {
                balance: la,
                a: aa,
                b: ba,
                ..
            },
            Mix {
                balance: lb,
                a: ab,
                b: bb,
                ..
            },
        ) => (la - lb).abs() + node_distance(aa, ab) + node_distance(ba, bb),
        (
            RingMod {
                mix: la,
                a: aa,
                b: ba,
                ..
            },
            RingMod {
                mix: lb,
                a: ab,
                b: bb,
                ..
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
                ..
            },
            Filter {
                kind: kb,
                cutoff: cb,
                resonance: rb,
                mod_depth: mb,
                input: ib,
                modulation: modb,
                ..
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
                ..
            },
            Fold {
                threshold: tb,
                mod_depth: mb,
                input: ib,
                modulation: modb,
                ..
            },
        ) => (ta - tb).abs() + (ma - mb).abs() + mod_distance(moda, modb) + node_distance(ia, ib),
        (
            Delay {
                time: ta,
                feedback: fa,
                mix: ma,
                mod_depth: dpa,
                input: ia,
                modulation: moda,
                ..
            },
            Delay {
                time: tb,
                feedback: fb,
                mix: mb,
                mod_depth: dpb,
                input: ib,
                modulation: modb,
                ..
            },
        ) => {
            (ta - tb).abs()
                + (fa - fb).abs()
                + (ma - mb).abs()
                + (dpa - dpb).abs()
                + mod_distance(moda, modb)
                + node_distance(ia, ib)
        }
        (
            Chorus {
                rate: ra,
                depth: da,
                mix: ma,
                mod_depth: dpa,
                input: ia,
                modulation: moda,
                ..
            },
            Chorus {
                rate: rb,
                depth: db,
                mix: mb,
                mod_depth: dpb,
                input: ib,
                modulation: modb,
                ..
            },
        ) => {
            (ra - rb).abs()
                + (da - db).abs()
                + (ma - mb).abs()
                + (dpa - dpb).abs()
                + mod_distance(moda, modb)
                + node_distance(ia, ib)
        }
        (
            Reverb {
                size: sa,
                damp: da,
                mix: ma,
                mod_depth: dpa,
                input: ia,
                modulation: moda,
                ..
            },
            Reverb {
                size: sb,
                damp: db,
                mix: mb,
                mod_depth: dpb,
                input: ib,
                modulation: modb,
                ..
            },
        ) => {
            (sa - sb).abs()
                + (da - db).abs()
                + (ma - mb).abs()
                + (dpa - dpb).abs()
                + mod_distance(moda, modb)
                + node_distance(ia, ib)
        }
        (
            Distortion {
                drive: ga,
                tone: ta,
                mode: ka,
                mod_depth: dpa,
                input: ia,
                modulation: moda,
                ..
            },
            Distortion {
                drive: gb,
                tone: tb,
                mode: kb,
                mod_depth: dpb,
                input: ib,
                modulation: modb,
                ..
            },
        ) => {
            (ga - gb).abs()
                + (ta - tb).abs()
                + (if ka == kb { 0.0 } else { 1.0 })
                + (dpa - dpb).abs()
                + mod_distance(moda, modb)
                + node_distance(ia, ib)
        }
        (
            Bitcrush {
                bits: ba,
                downsample: sa,
                mod_depth: dpa,
                input: ia,
                modulation: moda,
                ..
            },
            Bitcrush {
                bits: bb,
                downsample: sb,
                mod_depth: dpb,
                input: ib,
                modulation: modb,
                ..
            },
        ) => {
            (ba - bb).abs()
                + (sa - sb).abs()
                + (dpa - dpb).abs()
                + mod_distance(moda, modb)
                + node_distance(ia, ib)
        }
        (
            Phaser {
                rate: ra,
                depth: da,
                feedback: fa,
                mod_depth: dpa,
                input: ia,
                modulation: moda,
                ..
            },
            Phaser {
                rate: rb,
                depth: db,
                feedback: fb,
                mod_depth: dpb,
                input: ib,
                modulation: modb,
                ..
            },
        ) => {
            (ra - rb).abs()
                + (da - db).abs()
                + (fa - fb).abs()
                + (dpa - dpb).abs()
                + mod_distance(moda, modb)
                + node_distance(ia, ib)
        }
        (
            Flanger {
                rate: xa,
                depth: ya,
                feedback: za,
                mod_depth: dpa,
                input: ia,
                modulation: moda,
                ..
            },
            Flanger {
                rate: xb,
                depth: yb,
                feedback: zb,
                mod_depth: dpb,
                input: ib,
                modulation: modb,
                ..
            },
        ) => {
            (xa - xb).abs()
                + (ya - yb).abs()
                + (za - zb).abs()
                + (dpa - dpb).abs()
                + mod_distance(moda, modb)
                + node_distance(ia, ib)
        }
        (
            Tremolo {
                rate: xa,
                depth: ya,
                shape: za,
                mod_depth: dpa,
                input: ia,
                modulation: moda,
                ..
            },
            Tremolo {
                rate: xb,
                depth: yb,
                shape: zb,
                mod_depth: dpb,
                input: ib,
                modulation: modb,
                ..
            },
        ) => {
            (xa - xb).abs()
                + (ya - yb).abs()
                + (za - zb).abs()
                + (dpa - dpb).abs()
                + mod_distance(moda, modb)
                + node_distance(ia, ib)
        }
        (
            Vibrato {
                rate: xa,
                depth: ya,
                mix: za,
                mod_depth: dpa,
                input: ia,
                modulation: moda,
                ..
            },
            Vibrato {
                rate: xb,
                depth: yb,
                mix: zb,
                mod_depth: dpb,
                input: ib,
                modulation: modb,
                ..
            },
        ) => {
            (xa - xb).abs()
                + (ya - yb).abs()
                + (za - zb).abs()
                + (dpa - dpb).abs()
                + mod_distance(moda, modb)
                + node_distance(ia, ib)
        }
        (
            Eq {
                low: xa,
                mid: ya,
                high: za,
                mod_depth: dpa,
                input: ia,
                modulation: moda,
                ..
            },
            Eq {
                low: xb,
                mid: yb,
                high: zb,
                mod_depth: dpb,
                input: ib,
                modulation: modb,
                ..
            },
        ) => {
            (xa - xb).abs()
                + (ya - yb).abs()
                + (za - zb).abs()
                + (dpa - dpb).abs()
                + mod_distance(moda, modb)
                + node_distance(ia, ib)
        }
        (
            Granular {
                position: xa,
                size: ya,
                density: za,
                mod_depth: dpa,
                input: ia,
                modulation: moda,
                ..
            },
            Granular {
                position: xb,
                size: yb,
                density: zb,
                mod_depth: dpb,
                input: ib,
                modulation: modb,
                ..
            },
        ) => {
            (xa - xb).abs()
                + (ya - yb).abs()
                + (za - zb).abs()
                + (dpa - dpb).abs()
                + mod_distance(moda, modb)
                + node_distance(ia, ib)
        }
        (
            Shift {
                semis: xa,
                window: ya,
                mix: za,
                mod_depth: dpa,
                input: ia,
                modulation: moda,
                ..
            },
            Shift {
                semis: xb,
                window: yb,
                mix: zb,
                mod_depth: dpb,
                input: ib,
                modulation: modb,
                ..
            },
        ) => {
            (xa - xb).abs()
                + (ya - yb).abs()
                + (za - zb).abs()
                + (dpa - dpb).abs()
                + mod_distance(moda, modb)
                + node_distance(ia, ib)
        }
        // The binary dynamics nodes: both branches are real audio subtrees, so
        // both are walked, exactly as `Mix` and `RingMod` are.
        (
            Comp {
                threshold: xa,
                ratio: ya,
                makeup: za,
                mod_depth: dpa,
                input: ia,
                sidechain: sa,
                modulation: moda,
                ..
            },
            Comp {
                threshold: xb,
                ratio: yb,
                makeup: zb,
                mod_depth: dpb,
                input: ib,
                sidechain: sb,
                modulation: modb,
                ..
            },
        ) => {
            (xa - xb).abs()
                + (ya - yb).abs()
                + (za - zb).abs()
                + (dpa - dpb).abs()
                + mod_distance(moda, modb)
                + node_distance(ia, ib)
                + node_distance(sa, sb)
        }
        (
            Duck {
                amount: xa,
                threshold: ya,
                release: za,
                mod_depth: dpa,
                input: ia,
                key: ka,
                modulation: moda,
                ..
            },
            Duck {
                amount: xb,
                threshold: yb,
                release: zb,
                mod_depth: dpb,
                input: ib,
                key: kb,
                modulation: modb,
                ..
            },
        ) => {
            (xa - xb).abs()
                + (ya - yb).abs()
                + (za - zb).abs()
                + (dpa - dpb).abs()
                + mod_distance(moda, modb)
                + node_distance(ia, ib)
                + node_distance(ka, kb)
        }
        (
            Gate {
                threshold: xa,
                range: ya,
                release: za,
                mod_depth: dpa,
                input: ia,
                sidechain: sa,
                modulation: moda,
                ..
            },
            Gate {
                threshold: xb,
                range: yb,
                release: zb,
                mod_depth: dpb,
                input: ib,
                sidechain: sb,
                modulation: modb,
                ..
            },
        ) => {
            (xa - xb).abs()
                + (ya - yb).abs()
                + (za - zb).abs()
                + (dpa - dpb).abs()
                + mod_distance(moda, modb)
                + node_distance(ia, ib)
                + node_distance(sa, sb)
        }
        (
            Vocoder {
                bands: xa,
                attack: ya,
                release: za,
                mod_depth: dpa,
                carrier: ca,
                modulator: ma,
                modulation: moda,
                ..
            },
            Vocoder {
                bands: xb,
                attack: yb,
                release: zb,
                mod_depth: dpb,
                carrier: cb,
                modulator: mb,
                modulation: modb,
                ..
            },
        ) => {
            (xa - xb).abs()
                + (ya - yb).abs()
                + (za - zb).abs()
                + (dpa - dpb).abs()
                + mod_distance(moda, modb)
                + node_distance(ca, cb)
                + node_distance(ma, mb)
        }
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
        ModNode::Lfo { wave, rate, .. } => {
            put_usize(t, key, "mod", 1);
            put_usize(t, key, "wave", wave.index());
            put_f64(t, key, "rate", *rate);
        }
        ModNode::Env { attack, decay, .. } => {
            put_usize(t, key, "mod", 2);
            put_f64(t, key, "att", *attack);
            put_f64(t, key, "dec", *decay);
        }
        ModNode::Rand { rate, glide, .. } => {
            put_usize(t, key, "mod", 3);
            put_f64(t, key, "rate", *rate);
            put_f64(t, key, "glide", *glide);
        }
        ModNode::Follow { sens, release, .. } => {
            put_usize(t, key, "mod", 4);
            put_f64(t, key, "sens", *sens);
            put_f64(t, key, "rel", *release);
        }
        ModNode::Euclid {
            rate,
            steps,
            pulses,
            ..
        } => {
            put_usize(t, key, "mod", 5);
            put_f64(t, key, "erate", *rate);
            put_f64(t, key, "esteps", *steps);
            put_f64(t, key, "epulses", *pulses);
        }
        // The recursive arms. Subterm keys are `<key>/0` and `<key>/1`, the
        // same convention the audio tree uses — unambiguous because every
        // modulation key already sits below a `/m`.
        ModNode::Op {
            kind,
            p0,
            p1,
            input,
            ..
        } => {
            put_usize(t, key, "mod", 6);
            put_usize(t, key, "modop", kind.index());
            let sites = kind.param_sites();
            put_f64(t, key, sites[0], *p0);
            if let Some(site) = sites.get(1) {
                put_f64(t, key, site, *p1);
            }
            encode_mod(input, &child_key(key, 0), t);
        }
        ModNode::Pair { kind, a, b, .. } => {
            put_usize(t, key, "mod", 7);
            put_usize(t, key, "pairop", kind.index());
            encode_mod(a, &child_key(key, 0), t);
            encode_mod(b, &child_key(key, 1), t);
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
            mod_depth,
            modulation,
            ..
        } => {
            put_bool(t, key, "leaf", true);
            put_usize(t, key, "src", 0);
            put_usize(t, key, "wave", wave.index());
            put_usize(t, key, "oct", (octave + 2) as usize);
            put_f64(t, key, "det", *detune);
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
        }
        Supersaw {
            octave,
            detune,
            mix,
            mod_depth,
            modulation,
            ..
        } => {
            put_bool(t, key, "leaf", true);
            put_usize(t, key, "src", 1);
            put_usize(t, key, "oct", (octave + 2) as usize);
            put_f64(t, key, "det", *detune);
            put_f64(t, key, "smix", *mix);
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
        }
        Noise { color, .. } => {
            put_bool(t, key, "leaf", true);
            put_usize(t, key, "src", 2);
            put_usize(t, key, "color", color.index());
        }
        Wavetable {
            table,
            octave,
            morph,
            mod_depth,
            modulation,
            ..
        } => {
            put_bool(t, key, "leaf", true);
            put_usize(t, key, "src", 3);
            put_usize(t, key, "table", table.index());
            put_usize(t, key, "oct", (octave + 2) as usize);
            put_f64(t, key, "morph", *morph);
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
        }
        Pluck {
            octave,
            damping,
            brightness,
            mod_depth,
            modulation,
            ..
        } => {
            put_bool(t, key, "leaf", true);
            put_usize(t, key, "src", 4);
            put_usize(t, key, "oct", (octave + 2) as usize);
            put_f64(t, key, "damp", *damping);
            put_f64(t, key, "bright", *brightness);
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
        }
        Formant {
            vowel,
            shift,
            octave,
            mod_depth,
            modulation,
            ..
        } => {
            put_bool(t, key, "leaf", true);
            put_usize(t, key, "src", 5);
            put_f64(t, key, "vowel", *vowel);
            put_f64(t, key, "fshift", *shift);
            put_usize(t, key, "oct", (octave + 2) as usize);
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
        }
        Mix { balance, a, b, .. } => {
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
            ..
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
            ..
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
            mod_depth,
            input,
            modulation,
            ..
        } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 3);
            put_f64(t, key, "time", *time);
            put_f64(t, key, "fb", *feedback);
            put_f64(t, key, "dmix", *mix);
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
            encode_node(input, &child_key(key, 0), t);
        }
        Chorus {
            rate,
            depth,
            mix,
            mod_depth,
            input,
            modulation,
            ..
        } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 4);
            put_f64(t, key, "crate", *rate);
            put_f64(t, key, "cdepth", *depth);
            put_f64(t, key, "cmix", *mix);
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
            encode_node(input, &child_key(key, 0), t);
        }
        Reverb {
            size,
            damp,
            mix,
            mod_depth,
            input,
            modulation,
            ..
        } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 5);
            put_f64(t, key, "rsize", *size);
            put_f64(t, key, "rdamp", *damp);
            put_f64(t, key, "rmix", *mix);
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
            encode_node(input, &child_key(key, 0), t);
        }
        Distortion {
            drive,
            tone,
            mode,
            mod_depth,
            input,
            modulation,
            ..
        } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 6);
            put_f64(t, key, "drive", *drive);
            put_f64(t, key, "tone", *tone);
            put_usize(t, key, "dmode", mode.index());
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
            encode_node(input, &child_key(key, 0), t);
        }
        Bitcrush {
            bits,
            downsample,
            mod_depth,
            input,
            modulation,
            ..
        } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 7);
            put_f64(t, key, "bits", *bits);
            put_f64(t, key, "dsamp", *downsample);
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
            encode_node(input, &child_key(key, 0), t);
        }
        Phaser {
            rate,
            depth,
            feedback,
            mod_depth,
            input,
            modulation,
            ..
        } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 8);
            put_f64(t, key, "prate", *rate);
            put_f64(t, key, "pdepth", *depth);
            put_f64(t, key, "pfb", *feedback);
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
            encode_node(input, &child_key(key, 0), t);
        }
        Flanger {
            rate,
            depth,
            feedback,
            mod_depth,
            input,
            modulation,
            ..
        } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 10);
            put_f64(t, key, "frate", *rate);
            put_f64(t, key, "fdepth", *depth);
            put_f64(t, key, "ffb", *feedback);
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
            encode_node(input, &child_key(key, 0), t);
        }
        Tremolo {
            rate,
            depth,
            shape,
            mod_depth,
            input,
            modulation,
            ..
        } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 11);
            put_f64(t, key, "trate", *rate);
            put_f64(t, key, "tdepth", *depth);
            put_f64(t, key, "tshape", *shape);
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
            encode_node(input, &child_key(key, 0), t);
        }
        Vibrato {
            rate,
            depth,
            mix,
            mod_depth,
            input,
            modulation,
            ..
        } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 12);
            put_f64(t, key, "vrate", *rate);
            put_f64(t, key, "vdepth", *depth);
            put_f64(t, key, "vmix", *mix);
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
            encode_node(input, &child_key(key, 0), t);
        }
        Eq {
            low,
            mid,
            high,
            mod_depth,
            input,
            modulation,
            ..
        } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 13);
            put_f64(t, key, "low", *low);
            put_f64(t, key, "mid", *mid);
            put_f64(t, key, "high", *high);
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
            encode_node(input, &child_key(key, 0), t);
        }
        Granular {
            position,
            size,
            density,
            mod_depth,
            input,
            modulation,
            ..
        } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 14);
            put_f64(t, key, "gpos", *position);
            put_f64(t, key, "gsize", *size);
            put_f64(t, key, "gdens", *density);
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
            encode_node(input, &child_key(key, 0), t);
        }
        RingMod { mix, a, b, .. } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 9);
            put_f64(t, key, "rgmix", *mix);
            encode_node(a, &child_key(key, 0), t);
            encode_node(b, &child_key(key, 1), t);
        }
        Shift {
            semis,
            window,
            mix,
            mod_depth,
            input,
            modulation,
            ..
        } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 15);
            put_f64(t, key, "semis", *semis);
            put_f64(t, key, "window", *window);
            put_f64(t, key, "smix", *mix);
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
            encode_node(input, &child_key(key, 0), t);
        }
        // The four binary nodes write their control branch at `/1`, exactly
        // where `Mix` and `RingMod` write theirs — the address scheme cannot
        // tell a second audio input from a second *audio* input.
        Comp {
            threshold,
            ratio,
            makeup,
            mod_depth,
            input,
            sidechain,
            modulation,
            ..
        } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 16);
            put_f64(t, key, "thresh", *threshold);
            put_f64(t, key, "ratio", *ratio);
            put_f64(t, key, "makeup", *makeup);
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
            encode_node(input, &child_key(key, 0), t);
            encode_node(sidechain, &child_key(key, 1), t);
        }
        Duck {
            amount,
            threshold,
            release,
            mod_depth,
            input,
            key: key_input,
            modulation,
            ..
        } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 17);
            put_f64(t, key, "amount", *amount);
            put_f64(t, key, "dthresh", *threshold);
            put_f64(t, key, "drel", *release);
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
            encode_node(input, &child_key(key, 0), t);
            encode_node(key_input, &child_key(key, 1), t);
        }
        Gate {
            threshold,
            range,
            release,
            mod_depth,
            input,
            sidechain,
            modulation,
            ..
        } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 18);
            put_f64(t, key, "gthresh", *threshold);
            put_f64(t, key, "range", *range);
            put_f64(t, key, "grel", *release);
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
            encode_node(input, &child_key(key, 0), t);
            encode_node(sidechain, &child_key(key, 1), t);
        }
        Vocoder {
            bands,
            attack,
            release,
            mod_depth,
            carrier,
            modulator,
            modulation,
            ..
        } => {
            put_bool(t, key, "leaf", false);
            put_usize(t, key, "op", 19);
            put_f64(t, key, "bands", *bands);
            put_f64(t, key, "vatt", *attack);
            put_f64(t, key, "vrel", *release);
            put_f64(t, key, "mdepth", *mod_depth);
            encode_mod(modulation, &mod_key(key), t);
            encode_node(carrier, &child_key(key, 0), t);
            encode_node(modulator, &child_key(key, 1), t);
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

/// A site added *after* traces were already being persisted: absent means the
/// value the palette-v1 engine behaved as if it had, not a corrupt genome.
///
/// Old traces are the user's taste history and the bank they saved; the only
/// two ways to treat a missing site are "default it" and "throw the session
/// away", so every v2 site on a v1 variant reads through here.
fn get_f64_or(t: &Trace, key: &str, site: &str, default: f64) -> f64 {
    t.get_f64(&addr!(key, site)).unwrap_or(default)
}

fn decode_mod(t: &Trace, key: &str) -> Result<ModNode, GenomeError> {
    match get_usize(t, key, "mod")? {
        0 => Ok(ModNode::None),
        1 => Ok(ModNode::Lfo {
            uid: Uid::NEW,
            wave: Waveform::from_index(get_usize(t, key, "wave")?),
            rate: get_f64(t, key, "rate")?,
        }),
        2 => Ok(ModNode::Env {
            uid: Uid::NEW,
            attack: get_f64(t, key, "att")?,
            decay: get_f64(t, key, "dec")?,
        }),
        3 => Ok(ModNode::Rand {
            uid: Uid::NEW,
            rate: get_f64(t, key, "rate")?,
            // v1 S&H had no slew: hard steps.
            glide: get_f64_or(t, key, "glide", 0.0),
        }),
        4 => Ok(ModNode::Follow {
            uid: Uid::NEW,
            sens: get_f64(t, key, "sens")?,
            release: get_f64(t, key, "rel")?,
        }),
        5 => Ok(ModNode::Euclid {
            uid: Uid::NEW,
            rate: get_f64(t, key, "erate")?,
            steps: get_f64(t, key, "esteps")?,
            pulses: get_f64(t, key, "epulses")?,
        }),
        6 => {
            let kind = ModOp::from_index(get_usize(t, key, "modop")?);
            let sites = kind.param_sites();
            Ok(ModNode::Op {
                uid: Uid::NEW,
                kind,
                p0: get_f64(t, key, sites[0])?,
                // The one-parameter ops do not write `p1` at all, so there is
                // nothing to read back — see `ModOp::param_sites`.
                p1: match sites.get(1) {
                    Some(site) => get_f64(t, key, site)?,
                    None => 0.0,
                },
                input: Box::new(decode_mod(t, &child_key(key, 0))?),
            })
        }
        7 => Ok(ModNode::Pair {
            uid: Uid::NEW,
            kind: PairOp::from_index(get_usize(t, key, "pairop")?),
            a: Box::new(decode_mod(t, &child_key(key, 0))?),
            b: Box::new(decode_mod(t, &child_key(key, 1))?),
        }),
        k => Err(GenomeError::InvalidStructure(format!(
            "mod kind {k} out of range at {key}"
        ))),
    }
}

/// Decode a modulation slot that did not exist when the trace was written
/// (`Delay`, `Chorus`, `Reverb` from the v2 palette; `Vco` and `Supersaw` from
/// wave 2A's pitch slot): a trace with no `#mod` site at all decodes to an
/// empty slot, which is exactly how those modules used to sound.
fn decode_new_mod(t: &Trace, key: &str) -> Result<ModNode, GenomeError> {
    if t.get_usize(&addr!(key, "mod")).is_none() {
        return Ok(ModNode::None);
    }
    decode_mod(t, key)
}

/// The mod-depth a v2 module gets when its trace predates the slot. Matches
/// `mutate::default_node`, so a migrated patch and a hand-placed one start
/// from the same knob.
const DEFAULT_MOD_DEPTH: f64 = 0.3;

fn decode_node(t: &Trace, key: &str) -> Result<AudioNode, GenomeError> {
    if get_bool(t, key, "leaf")? {
        match get_usize(t, key, "src")? {
            // The pitch-modulation sites postdate every trace written before
            // wave 2A, and a vco is in nearly all of them — so these two read
            // through the defaulting accessors, exactly as `Delay` does.
            0 => Ok(AudioNode::Vco {
                uid: Uid::NEW,
                wave: Waveform::from_index(get_usize(t, key, "wave")?),
                octave: get_usize(t, key, "oct")? as i8 - 2,
                detune: get_f64(t, key, "det")?,
                mod_depth: get_f64_or(t, key, "mdepth", DEFAULT_MOD_DEPTH),
                modulation: decode_new_mod(t, &mod_key(key))?,
            }),
            1 => Ok(AudioNode::Supersaw {
                uid: Uid::NEW,
                octave: get_usize(t, key, "oct")? as i8 - 2,
                detune: get_f64(t, key, "det")?,
                mix: get_f64(t, key, "smix")?,
                mod_depth: get_f64_or(t, key, "mdepth", DEFAULT_MOD_DEPTH),
                modulation: decode_new_mod(t, &mod_key(key))?,
            }),
            2 => Ok(AudioNode::Noise {
                uid: Uid::NEW,
                color: NoiseColor::from_index(get_usize(t, key, "color")?),
            }),
            3 => Ok(AudioNode::Wavetable {
                uid: Uid::NEW,
                table: TableShape::from_index(get_usize(t, key, "table")?),
                octave: get_usize(t, key, "oct")? as i8 - 2,
                morph: get_f64(t, key, "morph")?,
                mod_depth: get_f64(t, key, "mdepth")?,
                modulation: decode_new_mod(t, &mod_key(key))?,
            }),
            4 => Ok(AudioNode::Pluck {
                uid: Uid::NEW,
                octave: get_usize(t, key, "oct")? as i8 - 2,
                damping: get_f64(t, key, "damp")?,
                brightness: get_f64(t, key, "bright")?,
                mod_depth: get_f64(t, key, "mdepth")?,
                modulation: decode_new_mod(t, &mod_key(key))?,
            }),
            5 => Ok(AudioNode::Formant {
                uid: Uid::NEW,
                vowel: get_f64(t, key, "vowel")?,
                shift: get_f64(t, key, "fshift")?,
                octave: get_usize(t, key, "oct")? as i8 - 2,
                mod_depth: get_f64(t, key, "mdepth")?,
                modulation: decode_mod(t, &mod_key(key))?,
            }),
            k => Err(GenomeError::InvalidStructure(format!(
                "source kind {k} out of range at {key}"
            ))),
        }
    } else {
        match get_usize(t, key, "op")? {
            0 => Ok(AudioNode::Mix {
                uid: Uid::NEW,
                balance: get_f64(t, key, "bal")?,
                a: Box::new(decode_node(t, &child_key(key, 0))?),
                b: Box::new(decode_node(t, &child_key(key, 1))?),
            }),
            1 => Ok(AudioNode::Filter {
                uid: Uid::NEW,
                kind: FilterKind::from_index(get_usize(t, key, "fkind")?),
                cutoff: get_f64(t, key, "cut")?,
                resonance: get_f64(t, key, "res")?,
                mod_depth: get_f64(t, key, "mdepth")?,
                modulation: decode_mod(t, &mod_key(key))?,
                input: Box::new(decode_node(t, &child_key(key, 0))?),
            }),
            2 => Ok(AudioNode::Fold {
                uid: Uid::NEW,
                threshold: get_f64(t, key, "thresh")?,
                mod_depth: get_f64(t, key, "mdepth")?,
                modulation: decode_mod(t, &mod_key(key))?,
                input: Box::new(decode_node(t, &child_key(key, 0))?),
            }),
            3 => Ok(AudioNode::Delay {
                uid: Uid::NEW,
                time: get_f64(t, key, "time")?,
                feedback: get_f64(t, key, "fb")?,
                mix: get_f64(t, key, "dmix")?,
                mod_depth: get_f64_or(t, key, "mdepth", DEFAULT_MOD_DEPTH),
                modulation: decode_new_mod(t, &mod_key(key))?,
                input: Box::new(decode_node(t, &child_key(key, 0))?),
            }),
            4 => Ok(AudioNode::Chorus {
                uid: Uid::NEW,
                rate: get_f64(t, key, "crate")?,
                depth: get_f64(t, key, "cdepth")?,
                mix: get_f64(t, key, "cmix")?,
                mod_depth: get_f64_or(t, key, "mdepth", DEFAULT_MOD_DEPTH),
                modulation: decode_new_mod(t, &mod_key(key))?,
                input: Box::new(decode_node(t, &child_key(key, 0))?),
            }),
            5 => Ok(AudioNode::Reverb {
                uid: Uid::NEW,
                size: get_f64(t, key, "rsize")?,
                damp: get_f64(t, key, "rdamp")?,
                mix: get_f64(t, key, "rmix")?,
                mod_depth: get_f64_or(t, key, "mdepth", DEFAULT_MOD_DEPTH),
                modulation: decode_new_mod(t, &mod_key(key))?,
                input: Box::new(decode_node(t, &child_key(key, 0))?),
            }),
            6 => Ok(AudioNode::Distortion {
                uid: Uid::NEW,
                drive: get_f64(t, key, "drive")?,
                tone: get_f64(t, key, "tone")?,
                mode: DriveMode::from_index(get_usize(t, key, "dmode")?),
                mod_depth: get_f64(t, key, "mdepth")?,
                modulation: decode_mod(t, &mod_key(key))?,
                input: Box::new(decode_node(t, &child_key(key, 0))?),
            }),
            7 => Ok(AudioNode::Bitcrush {
                uid: Uid::NEW,
                bits: get_f64(t, key, "bits")?,
                downsample: get_f64(t, key, "dsamp")?,
                mod_depth: get_f64(t, key, "mdepth")?,
                modulation: decode_mod(t, &mod_key(key))?,
                input: Box::new(decode_node(t, &child_key(key, 0))?),
            }),
            8 => Ok(AudioNode::Phaser {
                uid: Uid::NEW,
                rate: get_f64(t, key, "prate")?,
                depth: get_f64(t, key, "pdepth")?,
                feedback: get_f64(t, key, "pfb")?,
                mod_depth: get_f64(t, key, "mdepth")?,
                modulation: decode_mod(t, &mod_key(key))?,
                input: Box::new(decode_node(t, &child_key(key, 0))?),
            }),
            9 => Ok(AudioNode::RingMod {
                uid: Uid::NEW,
                mix: get_f64(t, key, "rgmix")?,
                a: Box::new(decode_node(t, &child_key(key, 0))?),
                b: Box::new(decode_node(t, &child_key(key, 1))?),
            }),
            10 => Ok(AudioNode::Flanger {
                uid: Uid::NEW,
                rate: get_f64(t, key, "frate")?,
                depth: get_f64(t, key, "fdepth")?,
                feedback: get_f64(t, key, "ffb")?,
                mod_depth: get_f64(t, key, "mdepth")?,
                modulation: decode_mod(t, &mod_key(key))?,
                input: Box::new(decode_node(t, &child_key(key, 0))?),
            }),
            11 => Ok(AudioNode::Tremolo {
                uid: Uid::NEW,
                rate: get_f64(t, key, "trate")?,
                depth: get_f64(t, key, "tdepth")?,
                shape: get_f64(t, key, "tshape")?,
                mod_depth: get_f64(t, key, "mdepth")?,
                modulation: decode_mod(t, &mod_key(key))?,
                input: Box::new(decode_node(t, &child_key(key, 0))?),
            }),
            12 => Ok(AudioNode::Vibrato {
                uid: Uid::NEW,
                rate: get_f64(t, key, "vrate")?,
                depth: get_f64(t, key, "vdepth")?,
                mix: get_f64(t, key, "vmix")?,
                mod_depth: get_f64(t, key, "mdepth")?,
                modulation: decode_mod(t, &mod_key(key))?,
                input: Box::new(decode_node(t, &child_key(key, 0))?),
            }),
            13 => Ok(AudioNode::Eq {
                uid: Uid::NEW,
                low: get_f64(t, key, "low")?,
                mid: get_f64(t, key, "mid")?,
                high: get_f64(t, key, "high")?,
                mod_depth: get_f64(t, key, "mdepth")?,
                modulation: decode_mod(t, &mod_key(key))?,
                input: Box::new(decode_node(t, &child_key(key, 0))?),
            }),
            14 => Ok(AudioNode::Granular {
                uid: Uid::NEW,
                position: get_f64(t, key, "gpos")?,
                size: get_f64(t, key, "gsize")?,
                density: get_f64(t, key, "gdens")?,
                mod_depth: get_f64(t, key, "mdepth")?,
                modulation: decode_mod(t, &mod_key(key))?,
                input: Box::new(decode_node(t, &child_key(key, 0))?),
            }),
            15 => Ok(AudioNode::Shift {
                uid: Uid::NEW,
                semis: get_f64(t, key, "semis")?,
                window: get_f64(t, key, "window")?,
                mix: get_f64(t, key, "smix")?,
                mod_depth: get_f64(t, key, "mdepth")?,
                modulation: decode_mod(t, &mod_key(key))?,
                input: Box::new(decode_node(t, &child_key(key, 0))?),
            }),
            16 => Ok(AudioNode::Comp {
                uid: Uid::NEW,
                threshold: get_f64(t, key, "thresh")?,
                ratio: get_f64(t, key, "ratio")?,
                makeup: get_f64(t, key, "makeup")?,
                mod_depth: get_f64(t, key, "mdepth")?,
                modulation: decode_mod(t, &mod_key(key))?,
                input: Box::new(decode_node(t, &child_key(key, 0))?),
                sidechain: Box::new(decode_node(t, &child_key(key, 1))?),
            }),
            17 => Ok(AudioNode::Duck {
                uid: Uid::NEW,
                amount: get_f64(t, key, "amount")?,
                threshold: get_f64(t, key, "dthresh")?,
                release: get_f64(t, key, "drel")?,
                mod_depth: get_f64(t, key, "mdepth")?,
                modulation: decode_mod(t, &mod_key(key))?,
                input: Box::new(decode_node(t, &child_key(key, 0))?),
                key: Box::new(decode_node(t, &child_key(key, 1))?),
            }),
            18 => Ok(AudioNode::Gate {
                uid: Uid::NEW,
                threshold: get_f64(t, key, "gthresh")?,
                range: get_f64(t, key, "range")?,
                release: get_f64(t, key, "grel")?,
                mod_depth: get_f64(t, key, "mdepth")?,
                modulation: decode_mod(t, &mod_key(key))?,
                input: Box::new(decode_node(t, &child_key(key, 0))?),
                sidechain: Box::new(decode_node(t, &child_key(key, 1))?),
            }),
            19 => Ok(AudioNode::Vocoder {
                uid: Uid::NEW,
                bands: get_f64(t, key, "bands")?,
                attack: get_f64(t, key, "vatt")?,
                release: get_f64(t, key, "vrel")?,
                mod_depth: get_f64(t, key, "mdepth")?,
                modulation: decode_mod(t, &mod_key(key))?,
                carrier: Box::new(decode_node(t, &child_key(key, 0))?),
                modulator: Box::new(decode_node(t, &child_key(key, 1))?),
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

// ---------------------------------------------------------------------------
// Parameter domains
// ---------------------------------------------------------------------------

/// The declared range of **every** continuous site in this grammar.
///
/// Not a convention: [`crate::prior`] samples every one of them from `u01()`,
/// so a value outside this interval has zero prior mass by construction and is
/// a corruption rather than an unusual patch. Stated once, here, so the check
/// and the repair below cannot drift from the generative model — and so that
/// the day a site wants a different range, this is the line that has to change.
pub const PARAM_DOMAIN: std::ops::RangeInclusive<f64> = 0.0..=1.0;

/// Is `v` a legal value for a continuous site?
///
/// Non-finite fails: `NaN` compares false against every bound, and an infinity
/// is exactly the runaway this gate exists to stop.
pub fn in_domain(v: f64) -> bool {
    v.is_finite() && PARAM_DOMAIN.contains(&v)
}

impl PatchTree {
    /// Every continuous site of this term that sits outside [`PARAM_DOMAIN`],
    /// as `(trace address, value)`, in address order.
    ///
    /// Reads the **trace**, not the term, and that is the whole point: the
    /// trace enumerates exactly the continuous sites, by construction, from the
    /// same walk the prior samples. A hand-written match over 26 productions
    /// would be a second table of "which fields are knobs" — and the first
    /// module somebody forgot to add to it would be the one the next sentinel
    /// escaped through.
    pub fn domain_violations(&self) -> Vec<(String, f64)> {
        let mut out: Vec<(String, f64)> = self
            .to_trace()
            .choices
            .iter()
            .filter_map(|(a, c)| match c.value {
                ChoiceValue::F64(v) if !in_domain(v) => Some((a.to_string(), v)),
                _ => None,
            })
            .collect();
        out.sort_by(|a, b| a.0.cmp(&b.0));
        out
    }

    /// Pull every out-of-domain continuous site back into [`PARAM_DOMAIN`].
    /// Returns how many sites were repaired (0 = the term was already clean,
    /// and nothing was rebuilt).
    ///
    /// **Repair, not refusal, and the asymmetry is deliberate.** A term over
    /// the size/depth ceilings cannot be fixed without deciding which modules
    /// to delete, so those are refused. A knob outside its range *can* be
    /// fixed, exactly and locally, and the alternative — refusing — would mean
    /// a saved session that already contains one becomes an app the player
    /// cannot edit, load or evolve their way out of. Corruption must not be
    /// load-bearing.
    ///
    /// `NaN` clamps to the middle of the range rather than to an end: it
    /// carries no information about which way it went, and pinning it to a
    /// boundary would state one.
    ///
    /// Identities survive. The rebuild goes through the trace, which does not
    /// carry `uid`s, so the repaired term inherits them back from the term it
    /// replaced — same rule, and the same reason, as [`crate::set_param`].
    pub fn clamp_domains(&mut self) -> usize {
        let mut trace = self.to_trace();
        let mut fixed = 0usize;
        for c in trace.choices.values_mut() {
            if let ChoiceValue::F64(v) = c.value {
                if !in_domain(v) {
                    let repaired = if v.is_nan() {
                        (PARAM_DOMAIN.start() + PARAM_DOMAIN.end()) / 2.0
                    } else {
                        v.clamp(*PARAM_DOMAIN.start(), *PARAM_DOMAIN.end())
                    };
                    c.value = ChoiceValue::F64(repaired);
                    fixed += 1;
                }
            }
        }
        if fixed == 0 {
            return 0;
        }
        // Decoding can only fail on a *structurally* broken trace, and this one
        // came from `to_trace` on a live term with nothing but leaf values
        // touched. If it somehow does, keep the term we have: a patch with a
        // bad knob is worth more to the player than no patch at all, and every
        // consumer downstream of here has its own guard.
        if let Ok(mut repaired) = PatchTree::from_trace(&trace) {
            repaired.inherit_uids(self);
            *self = repaired;
        }
        fixed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::term::FilterKind;

    /// A trace written by the v1 palette still decodes.
    ///
    /// Saved sessions, bank entries and the whole observation log are stored
    /// as traces, so a site added to an *existing* variant is a wire-format
    /// change: `Delay` gained `#mdepth` and a `/m` slot, and `Rand` gained
    /// `#glide`, none of which appear in a trace written last week. The
    /// defaults are chosen so the decoded patch still *sounds* like the one
    /// that was saved — an empty slot and a mod depth that modulates nothing.
    #[test]
    fn a_v1_trace_still_decodes() {
        let mut t = Trace::default();
        for (site, v) in [
            ("attack", 0.1),
            ("decay", 0.3),
            ("sustain", 0.6),
            ("release", 0.2),
        ] {
            put_f64(&mut t, "amp", site, v);
        }
        // node = Delay { time, fb, dmix } — no #mdepth, no /m slot at all.
        put_bool(&mut t, "node", "leaf", false);
        put_usize(&mut t, "node", "op", 3);
        put_f64(&mut t, "node", "time", 0.6);
        put_f64(&mut t, "node", "fb", 0.4);
        put_f64(&mut t, "node", "dmix", 0.35);
        // node/0 = Filter modulated by a v1 Rand — rate but no glide.
        put_bool(&mut t, "node/0", "leaf", false);
        put_usize(&mut t, "node/0", "op", 1);
        put_usize(&mut t, "node/0", "fkind", 3);
        put_f64(&mut t, "node/0", "cut", 0.5);
        put_f64(&mut t, "node/0", "res", 0.4);
        put_f64(&mut t, "node/0", "mdepth", 0.5);
        put_usize(&mut t, "node/0/m", "mod", 3);
        put_f64(&mut t, "node/0/m", "rate", 0.62);
        // node/0/0 = Vco.
        put_bool(&mut t, "node/0/0", "leaf", true);
        put_usize(&mut t, "node/0/0", "src", 0);
        put_usize(&mut t, "node/0/0", "wave", 2);
        put_usize(&mut t, "node/0/0", "oct", 1);
        put_f64(&mut t, "node/0/0", "det", 0.5);

        let tree = PatchTree::from_trace(&t).expect("a v1 trace must still load");
        let AudioNode::Delay {
            mod_depth,
            modulation,
            input,
            ..
        } = &tree.root
        else {
            panic!("decoded the wrong node: {}", tree.root.to_sexpr());
        };
        assert_eq!(*mod_depth, 0.3, "new mod depth did not default");
        assert_eq!(*modulation, ModNode::None, "absent slot must decode empty");
        let AudioNode::Filter {
            kind, modulation, ..
        } = &**input
        else {
            panic!("decoded the wrong child: {}", input.to_sexpr());
        };
        assert_eq!(*kind, FilterKind::Ladder);
        assert_eq!(
            *modulation,
            ModNode::Rand {
                uid: Uid::NEW,
                rate: 0.62,
                glide: 0.0
            },
            "a v1 S&H must come back as hard steps"
        );
        // The vco at the bottom is the one that matters most: wave 2A gave it
        // a pitch slot, and a vco is in nearly every trace ever written. An
        // absent `#mdepth`/`/m` must decode to "no pitch modulation", not to
        // a missing-address error that fails the whole genome.
        let AudioNode::Filter { input, .. } = &**input else {
            unreachable!("checked above")
        };
        assert_eq!(
            **input,
            AudioNode::Vco {
                uid: Uid::NEW,
                wave: Waveform::Saw,
                octave: -1,
                detune: 0.5,
                mod_depth: DEFAULT_MOD_DEPTH,
                modulation: ModNode::None,
            },
            "a v1 vco must decode with its pitch slot empty"
        );

        // ...and once loaded it is a v2 genome like any other: re-encoding it
        // writes the new sites, and that trace round-trips.
        let back = PatchTree::from_trace(&tree.to_trace()).expect("re-encoded trace decodes");
        assert_eq!(back, tree);
    }
}

#[cfg(test)]
mod domain_tests {
    use super::*;
    use crate::mutate::{apply_struct_op, validate_tree, StructOp};
    use crate::term::{FilterKind, Waveform};
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    fn filter_over_vco(cutoff: f64) -> PatchTree {
        PatchTree {
            amp: AmpEnv {
                attack: 0.1,
                decay: 0.3,
                sustain: 0.6,
                release: 0.2,
            },
            root: AudioNode::Filter {
                uid: Uid(7),
                kind: FilterKind::SvfBp,
                cutoff,
                resonance: 0.4,
                mod_depth: 0.5,
                input: Box::new(AudioNode::Vco {
                    uid: Uid(9),
                    wave: Waveform::Saw,
                    octave: 0,
                    detune: 0.5,
                    mod_depth: 0.3,
                    modulation: ModNode::None,
                }),
                modulation: ModNode::None,
            },
        }
    }

    /// The generative model's own claim, checked rather than trusted: every
    /// continuous site the prior can draw lands inside [`PARAM_DOMAIN`]. If
    /// this ever fails, the domain constant is wrong and every gate built on
    /// it is refusing legitimate patches.
    #[test]
    fn every_prior_draw_is_in_domain() {
        let prior = PatchGrammarPrior::default();
        let mut rng = StdRng::seed_from_u64(20260802);
        for _ in 0..400 {
            let t = prior.sample_with_rng(&mut rng);
            assert!(
                t.domain_violations().is_empty(),
                "the prior drew an out-of-domain site: {:?}",
                t.domain_violations()
            );
        }
    }

    /// The sentinel, exactly as it was found in the shipped session: four
    /// sites of one patch at `1e30`. Repair moves all four and nothing else,
    /// and every node keeps the identity it had — locks and hand-placed
    /// positions ride on `uid`, so a repair that reissued them would fix a
    /// number by destroying the player's arrangement.
    #[test]
    fn clamp_repairs_the_sentinel_and_keeps_identity() {
        let mut t = filter_over_vco(1e30);
        t.amp.sustain = 1e30;
        assert_eq!(t.domain_violations().len(), 2);

        assert_eq!(t.clamp_domains(), 2);
        assert!(t.domain_violations().is_empty());
        assert_eq!(t.amp.sustain, 1.0);
        assert_eq!(t.amp.attack, 0.1, "a clean site must not move");
        let AudioNode::Filter {
            uid,
            cutoff,
            resonance,
            input,
            ..
        } = &t.root
        else {
            panic!("the repair changed the term's shape");
        };
        assert_eq!(*cutoff, 1.0);
        assert_eq!(*resonance, 0.4);
        assert_eq!(*uid, Uid(7), "the repair reissued an identity");
        let AudioNode::Vco { uid, .. } = &**input else {
            panic!("the repair changed the child");
        };
        assert_eq!(*uid, Uid(9));

        // Idempotent, and free on a clean term.
        assert_eq!(t.clamp_domains(), 0);
    }

    /// NaN carries no direction, so it lands in the middle rather than being
    /// pinned to an end that would state one.
    #[test]
    fn nan_lands_mid_range() {
        let mut t = filter_over_vco(f64::NAN);
        assert_eq!(t.clamp_domains(), 1);
        let AudioNode::Filter { cutoff, .. } = &t.root else {
            unreachable!()
        };
        assert_eq!(*cutoff, 0.5);
    }

    /// `validate_tree` is the predicate and names the site — the WS-1 rider
    /// used to speak only about size and depth, which is why a value could
    /// walk through it.
    #[test]
    fn validate_tree_refuses_an_out_of_domain_site() {
        assert!(validate_tree(&filter_over_vco(0.6)).is_ok());
        let err = validate_tree(&filter_over_vco(1e30)).expect_err("must refuse");
        assert!(
            err.contains("node#cut"),
            "the reason must name the site: {err}"
        );
        assert!(err.contains("out of range"), "{err}");
    }

    /// The route the corruption actually travelled: an explicit fragment
    /// handed to `apply_struct_op` (a HELD subtree, a bank drop) is adopted
    /// verbatim, so `finish()` has to be the funnel that cleans it.
    #[test]
    fn an_explicit_fragment_cannot_seat_a_bad_value() {
        let host = filter_over_vco(0.6);
        let bad = AudioNode::Fold {
            uid: Uid::NEW,
            threshold: 1e30,
            mod_depth: 0.3,
            input: Box::new(AudioNode::Noise {
                uid: Uid::NEW,
                color: crate::term::NoiseColor::White,
            }),
            modulation: ModNode::None,
        };
        let out = apply_struct_op(
            &host,
            &StructOp::InsertTree {
                key: "node/0".into(),
                node: bad,
            },
        )
        .expect("a repairable fragment must still land");
        assert!(
            out.domain_violations().is_empty(),
            "finish() seated {:?}",
            out.domain_violations()
        );
    }
}
