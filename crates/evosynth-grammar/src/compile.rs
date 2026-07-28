//! Compile a [`PatchTree`] term into a playable quiver [`Patch`].
//!
//! Every compiled voice gets the mandatory output chain
//! `<audio> → VCA (amp ADSR) → Limiter → StereoOutput` and two external
//! controls (`pitch` in V/Oct, `gate` in volts) fanned out to every pitched
//! source and every envelope — no evolved patch can bypass the limiter or
//! end up unplayable.
//!
//! ## Validation mode
//!
//! Patches are wired under [`ValidationMode::Warn`], not `Strict`: quiver's
//! `Strict` rejects *warning-class* pairs, which includes the blessed idiom
//! this compiler leans on (a bipolar [`Offset`] constant driving a unipolar
//! CV knob — the same pattern as quiver's own tutorials). The type discipline
//! that `Strict` would enforce is already guaranteed by construction: the
//! term's Audio/Mod sorts are Rust types, and this compiler only emits
//! known-good connection shapes. Compile errors (invalid ports, cycles) are
//! still hard failures; accumulated warnings are returned for inspection and
//! property tests assert they stay within the expected classes.
//!
//! ## Parameter mapping
//!
//! Genome parameters are normalized `[0, 1]`; this module owns their musical
//! mapping. Ranges are deliberately **bounded away from pathology** (max
//! resonance 0.85, max delay feedback 0.7) — the grammar cannot express the
//! most degenerate settings, which is safety layer 3 of DESIGN.md §2.1.

use std::sync::Arc;

use quiver::modules::{Chorus, DelayLine, Limiter, Supersaw};
use quiver::prelude::*;
use quiver::{AtomicF64, ExternalInput};

use crate::term::{AudioNode, FilterKind, ModNode, PatchTree};

/// A compiled, playable voice: the patch plus its external control handles.
pub struct CompiledVoice {
    /// The compiled quiver patch (output already selected and compiled).
    pub patch: Patch,
    /// Pitch control, V/Oct (0 V = C4). Shared with the patch.
    pub pitch: Arc<AtomicF64>,
    /// Gate control (≥ 2.5 V = on). Shared with the patch.
    pub gate: Arc<AtomicF64>,
    /// Signal-kind warnings accumulated while wiring (Warn mode).
    pub warnings: Vec<String>,
}

/// Bounded musical mappings from normalized genome parameters.
mod map {
    /// Resonance: cap below self-oscillation screech.
    pub fn resonance(x: f64) -> f64 {
        0.85 * x
    }
    /// Delay feedback: cap below runaway.
    pub fn feedback(x: f64) -> f64 {
        0.7 * x
    }
    /// Wavefolder threshold: keep off the hard-zero fold-everything corner.
    pub fn fold_threshold(x: f64) -> f64 {
        0.1 + 0.9 * x
    }
    /// Detune: ±50 cents expressed in V/Oct.
    pub fn detune_voct(x: f64) -> f64 {
        (x * 2.0 - 1.0) * (50.0 / 1200.0)
    }
    /// Modulation depth as cable attenuation.
    pub fn mod_depth(x: f64) -> f64 {
        x
    }
    /// Crossfader position: 0..1 → −5..+5 V.
    pub fn xfade_pos(x: f64) -> f64 {
        (x * 2.0 - 1.0) * 5.0
    }
}

struct Compiler {
    patch: Patch,
    pitch_out: PortRef,
    gate_out: PortRef,
}

impl Compiler {
    /// Add an [`Offset`] node emitting the constant `value` and connect it to
    /// `target`. This is the quiver-tutorial idiom for setting a knob.
    fn constant(&mut self, name: String, value: f64, target: PortRef) -> Result<(), PatchError> {
        let k = self.patch.add(name, Offset::new(value));
        self.patch.connect(k.out("out"), target)?;
        Ok(())
    }

    /// Wire a modulation term into `target` with the given depth
    /// (as cable attenuation). `ModNode::None` wires nothing.
    fn wire_mod(
        &mut self,
        m: &ModNode,
        key: &str,
        depth: f64,
        target: PortRef,
    ) -> Result<(), PatchError> {
        match m {
            ModNode::None => Ok(()),
            ModNode::Lfo { wave, rate } => {
                let lfo = self.patch.add(format!("{key}:lfo"), Lfo::new(self.sr()));
                self.constant(format!("{key}:lfo_rate"), *rate, lfo.in_("rate"))?;
                self.patch.connect_attenuated(
                    lfo.out(wave.port_name()),
                    target,
                    map::mod_depth(depth),
                )?;
                Ok(())
            }
            ModNode::Env { attack, decay } => {
                let env = self.patch.add(format!("{key}:env"), Adsr::new(self.sr()));
                self.patch.connect(self.gate_out, env.in_("gate"))?;
                self.constant(format!("{key}:env_a"), *attack, env.in_("attack"))?;
                self.constant(format!("{key}:env_d"), *decay, env.in_("decay"))?;
                // AD shape: no sustain plateau, quick release.
                self.constant(format!("{key}:env_s"), 0.0, env.in_("sustain"))?;
                self.constant(format!("{key}:env_r"), 0.1, env.in_("release"))?;
                self.patch
                    .connect_attenuated(env.out("env"), target, map::mod_depth(depth))?;
                Ok(())
            }
        }
    }

    /// Route pitch (plus a per-source V/Oct offset) into a `voct` input.
    fn wire_pitch(
        &mut self,
        key: &str,
        octave: i8,
        detune: f64,
        target: PortRef,
    ) -> Result<(), PatchError> {
        let offset = octave as f64 + map::detune_voct(detune);
        let node = self.patch.add(format!("{key}:pitch"), Offset::new(offset));
        self.patch.connect(self.pitch_out, node.in_("in"))?;
        self.patch.connect(node.out("out"), target)?;
        Ok(())
    }

    fn sr(&self) -> f64 {
        self.patch.sample_rate()
    }

    /// Build the audio subtree rooted at `node`; returns its output port.
    fn build(&mut self, node: &AudioNode, key: &str) -> Result<PortRef, PatchError> {
        match node {
            AudioNode::Vco {
                wave,
                octave,
                detune,
            } => {
                let vco = self.patch.add(format!("{key}:vco"), Vco::new(self.sr()));
                self.wire_pitch(key, *octave, *detune, vco.in_("voct"))?;
                Ok(vco.out(wave.port_name()))
            }
            AudioNode::Supersaw {
                octave,
                detune,
                mix,
            } => {
                let saw = self
                    .patch
                    .add(format!("{key}:supersaw"), Supersaw::new(self.sr()));
                self.wire_pitch(key, *octave, 0.5, saw.in_("voct"))?;
                self.constant(format!("{key}:ss_det"), *detune, saw.in_("detune"))?;
                self.constant(format!("{key}:ss_mix"), *mix, saw.in_("mix"))?;
                Ok(saw.out("out"))
            }
            AudioNode::Noise { color } => {
                let noise = self
                    .patch
                    .add(format!("{key}:noise"), NoiseGenerator::new());
                Ok(noise.out(color.port_name()))
            }
            AudioNode::Mix { balance, a, b } => {
                let a_out = self.build(a, &format!("{key}/0"))?;
                let b_out = self.build(b, &format!("{key}/1"))?;
                let xf = self.patch.add(format!("{key}:mix"), Crossfader::new());
                self.patch.connect(a_out, xf.in_("a"))?;
                self.patch.connect(b_out, xf.in_("b"))?;
                self.constant(
                    format!("{key}:bal"),
                    map::xfade_pos(*balance),
                    xf.in_("pos"),
                )?;
                Ok(xf.out("out"))
            }
            AudioNode::Filter {
                kind,
                cutoff,
                resonance,
                mod_depth,
                input,
                modulation,
            } => {
                let in_out = self.build(input, &format!("{key}/0"))?;
                let (filt, out_port) = match kind {
                    FilterKind::SvfLp | FilterKind::SvfBp | FilterKind::SvfHp => {
                        let f = self.patch.add(format!("{key}:svf"), Svf::new(self.sr()));
                        let port = match kind {
                            FilterKind::SvfLp => "lp",
                            FilterKind::SvfBp => "bp",
                            _ => "hp",
                        };
                        (f, port)
                    }
                    FilterKind::Ladder => {
                        let f = self
                            .patch
                            .add(format!("{key}:ladder"), DiodeLadderFilter::new(self.sr()));
                        (f, "out")
                    }
                };
                self.patch.connect(in_out, filt.in_("in"))?;
                self.constant(format!("{key}:cut"), *cutoff, filt.in_("cutoff"))?;
                self.constant(
                    format!("{key}:res"),
                    map::resonance(*resonance),
                    filt.in_("res"),
                )?;
                self.wire_mod(modulation, &format!("{key}/m"), *mod_depth, filt.in_("fm"))?;
                Ok(filt.out(out_port))
            }
            AudioNode::Fold {
                threshold,
                mod_depth,
                input,
                modulation,
            } => {
                let in_out = self.build(input, &format!("{key}/0"))?;
                let fold = self.patch.add(
                    format!("{key}:fold"),
                    Wavefolder::new(map::fold_threshold(*threshold)),
                );
                self.patch.connect(in_out, fold.in_("in"))?;
                self.wire_mod(
                    modulation,
                    &format!("{key}/m"),
                    *mod_depth,
                    fold.in_("threshold"),
                )?;
                Ok(fold.out("out"))
            }
            AudioNode::Delay {
                time,
                feedback,
                mix,
                input,
            } => {
                let in_out = self.build(input, &format!("{key}/0"))?;
                let dl = self
                    .patch
                    .add(format!("{key}:delay"), DelayLine::new(self.sr()));
                self.patch.connect(in_out, dl.in_("in"))?;
                self.constant(format!("{key}:d_time"), *time, dl.in_("time"))?;
                self.constant(
                    format!("{key}:d_fb"),
                    map::feedback(*feedback),
                    dl.in_("feedback"),
                )?;
                self.constant(format!("{key}:d_mix"), *mix, dl.in_("mix"))?;
                Ok(dl.out("out"))
            }
            AudioNode::Chorus {
                rate,
                depth,
                mix,
                input,
            } => {
                let in_out = self.build(input, &format!("{key}/0"))?;
                let ch = self
                    .patch
                    .add(format!("{key}:chorus"), Chorus::new(self.sr()));
                self.patch.connect(in_out, ch.in_("in"))?;
                self.constant(format!("{key}:c_rate"), *rate, ch.in_("rate"))?;
                self.constant(format!("{key}:c_depth"), *depth, ch.in_("depth"))?;
                self.constant(format!("{key}:c_mix"), *mix, ch.in_("mix"))?;
                Ok(ch.out("out"))
            }
        }
    }
}

/// Compile a patch term into a playable voice at the given sample rate.
pub fn compile(tree: &PatchTree, sample_rate: f64) -> Result<CompiledVoice, PatchError> {
    let mut patch = Patch::new(sample_rate);
    patch.set_validation_mode(ValidationMode::Warn);

    let pitch = Arc::new(AtomicF64::new(0.0));
    let gate = Arc::new(AtomicF64::new(0.0));
    let pitch_in = patch.add("io:pitch", ExternalInput::voct(Arc::clone(&pitch)));
    let gate_in = patch.add("io:gate", ExternalInput::gate(Arc::clone(&gate)));

    let mut c = Compiler {
        patch,
        pitch_out: pitch_in.out("out"),
        gate_out: gate_in.out("out"),
    };

    // The evolved tree.
    let audio_out = c.build(&tree.root, "node")?;

    // Mandatory voice stage: amp ADSR → VCA → limiter → stereo out.
    let adsr = c.patch.add("voice:adsr", Adsr::new(sample_rate));
    c.patch.connect(c.gate_out, adsr.in_("gate"))?;
    c.constant("voice:a".into(), tree.amp.attack, adsr.in_("attack"))?;
    c.constant("voice:d".into(), tree.amp.decay, adsr.in_("decay"))?;
    c.constant("voice:s".into(), tree.amp.sustain, adsr.in_("sustain"))?;
    c.constant("voice:r".into(), tree.amp.release, adsr.in_("release"))?;

    let vca = c.patch.add("voice:vca", Vca::new());
    c.patch.connect(audio_out, vca.in_("in"))?;
    c.patch.connect(adsr.out("env"), vca.in_("cv"))?;

    let limiter = c.patch.add("voice:limiter", Limiter::new(sample_rate));
    c.patch.connect(vca.out("out"), limiter.in_("in"))?;

    let out = c.patch.add("voice:out", StereoOutput::new());
    // Right is normalled to left inside StereoOutput.
    c.patch.connect(limiter.out("out"), out.in_("left"))?;

    let mut patch = c.patch;
    patch.set_output(out.id());
    patch.compile()?;
    let warnings = patch.warnings().to_vec();

    Ok(CompiledVoice {
        patch,
        pitch,
        gate,
        warnings,
    })
}
