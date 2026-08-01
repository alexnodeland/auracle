//! Compile a [`PatchTree`] term into a playable quiver [`Patch`].
//!
//! Every compiled voice gets the mandatory output chain
//! `<audio> → DC blocker → VCA (amp ADSR) → Limiter → StereoOutput` and two
//! external controls (`pitch` in V/Oct, `gate` in volts) fanned out to every
//! pitched source and every envelope — no evolved patch can bypass the
//! limiter or end up unplayable.
//!
//! The tail is built once per channel: a subtree that produces true stereo
//! (reverb, chorus) keeps its two tanks all the way to the output rather than
//! having the right one discarded.
//!
//! ## Validation mode
//!
//! Patches are wired under [`ValidationMode::Warn`], not `Strict`: quiver's
//! `Strict` rejects *warning-class* pairs, which includes blessed idioms this
//! compiler leans on (a unipolar mod envelope driving a bipolar FM input, the
//! bipolar pitch [`Offset`] driving V/Oct inputs). The type discipline
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

use std::collections::HashMap;
use std::sync::Arc;

use quiver::modules::{Attenuverter, Chorus, DelayLine, Limiter, Reverb, SampleAndHold, Supersaw};
use quiver::prelude::*;
use quiver::{AtomicF64, ExternalInput};

use crate::term::{AudioNode, FilterKind, ModNode, PatchTree};

/// quiver reads `Adsr.shape`, `Vca.response` and `Limiter.soft` as *gates* at
/// the 2.5 V threshold, not as continuous curve amounts — 5 V and 10 V do the
/// same thing. These two names say which side of the threshold we mean.
const GATE_TRUE: f64 = 5.0;
const GATE_FALSE: f64 = 0.0;
/// Filter keytracking amount (`Svf`/`DiodeLadderFilter` port 5). quiver applies
/// `2^(voct · amt)`, so 0.5 moves the corner half an octave per octave played:
/// enough that a patch still speaks two octaves above where it was dialled in,
/// not so much that a bass patch turns thin in the upper register. Fixed rather
/// than a knob because a `keytrack` genome field is a grammar-shape change.
const KEYTRACK_AMT: f64 = 0.5;
/// Normalized cutoff of the voice's DC blocker. quiver maps `cutoff` as
/// `20·1000^x` and then hard-clamps to 20 Hz, so 0.0 is the lowest corner the
/// engine can produce — measured at −17 dB at 8 Hz, −2.7 dB at C1 and −0.8 dB
/// at C2, which blocks offset without auditing as a bass cut.
const DC_BLOCK_CUTOFF: f64 = 0.0;

/// How a normalized knob value maps to the volts written to its handle.
#[derive(Clone, Copy, Debug)]
pub enum ParamMap {
    /// Pass through (0..1 knob CV).
    Unit,
    /// Bounded resonance (`0.85·x`).
    Resonance,
    /// Bounded delay feedback (`0.7·x`).
    Feedback,
    /// Crossfader position (`(2x−1)·5 V`).
    XfadePos,
    /// Wavefolder threshold (`0.1 + 0.9·x`).
    FoldThreshold,
    /// Mod depth for a ±5 V source, as an attenuverter level.
    ModDepthBipolar,
    /// Mod depth for a 0–10 V source, as an attenuverter level.
    ModDepthUnipolar,
}

impl ParamMap {
    /// Map a normalized value to the wire value.
    pub fn apply(self, x: f64) -> f64 {
        match self {
            ParamMap::Unit => x,
            ParamMap::Resonance => map::resonance(x),
            ParamMap::Feedback => map::feedback(x),
            ParamMap::XfadePos => map::xfade_pos(x),
            ParamMap::FoldThreshold => map::fold_threshold(x),
            ParamMap::ModDepthBipolar => map::mod_depth_bipolar(x),
            ParamMap::ModDepthUnipolar => map::mod_depth_unipolar(x),
        }
    }
}

/// A live control: the atomic the audio thread reads, plus the knob mapping.
#[derive(Clone)]
pub struct ParamHandle {
    /// Shared with the running patch — writing it changes the sound on the
    /// next sample, no recompilation.
    pub value: Arc<AtomicF64>,
    /// Normalized-to-volts mapping.
    pub map: ParamMap,
}

impl ParamHandle {
    /// Write a normalized (0..1) knob value.
    pub fn set_normalized(&self, x: f64) {
        self.value.set(self.map.apply(x.clamp(0.0, 1.0)));
    }
}

/// A compiled, playable voice: the patch plus its external control handles.
pub struct CompiledVoice {
    /// The compiled quiver patch (output already selected and compiled).
    pub patch: Patch,
    /// Pitch control, V/Oct (0 V = C4). Shared with the patch.
    pub pitch: Arc<AtomicF64>,
    /// Gate control (≥ 2.5 V = on). Shared with the patch.
    pub gate: Arc<AtomicF64>,
    /// Live parameter handles, keyed by the knob's trace address
    /// (`node/0#cut`, `amp#attack`, …). Continuous knobs only — enum and
    /// structural changes require recompilation.
    pub params: HashMap<String, ParamHandle>,
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
    /// Modulation depth for a ±5 V source (LFO, S&H), expressed as an
    /// [`quiver::modules::Attenuverter`] level in volts (its gain is
    /// `level / 5`), so knob 1.0 = ±5 octaves of cutoff.
    ///
    /// Both destinations are *normalized*, not volt-scaled: `Svf.fm` sums
    /// straight into a 0..1 cutoff CV whose full span is 20 Hz–20 kHz (~10
    /// octaves), and `Wavefolder.threshold` lives in 0.1..1. A raw ±5 V cable
    /// is ~5× full scale, so every knob position above ~0.2 only clipped the
    /// modulator harder into a square wave — 97% of the travel did nothing.
    ///
    /// The taper is deliberately **linear, not square-law**. A square taper
    /// gives a nicer knob feel, but this function is not only a knob mapping:
    /// the grammar draws `mod_depth ~ U(0,1)` and the compiler applies the same
    /// curve, so squaring also reshapes the *evolutionary prior* toward weak
    /// modulation. Measured over eight seeds of the closed-loop synthetic-taste
    /// gate, the square taper cost the posterior 0.11 of its correlation with
    /// ground truth (0.59 vs 0.70) — the pool simply stopped moving enough for
    /// timbral-movement preferences to be learnable. Linear costs nothing and
    /// is still perfectly dialable once the 10× scale error is gone: the
    /// musically useful first ±2 octaves occupy the bottom 40% of the sweep.
    pub fn mod_depth_bipolar(x: f64) -> f64 {
        5.0 * 0.1 * x
    }
    /// Modulation depth for a 0–10 V source (the mod envelope). Half the
    /// bipolar scale, so both source families reach the same depth at the same
    /// knob position.
    pub fn mod_depth_unipolar(x: f64) -> f64 {
        5.0 * 0.05 * x
    }
    /// Crossfader position: 0..1 → −5..+5 V.
    pub fn xfade_pos(x: f64) -> f64 {
        (x * 2.0 - 1.0) * 5.0
    }
}

/// What a subtree hands back: mono (`right == None`) or a true stereo pair.
///
/// Only [`Reverb`] and [`Chorus`] widen — everything else is a mono processor,
/// and feeding one a stereo signal downmixes (see [`Compiler::feed`]). Carrying
/// the pair instead of dropping it is the whole point of having a chorus.
#[derive(Clone, Copy)]
struct Sig {
    left: PortRef,
    right: Option<PortRef>,
}

impl Sig {
    fn mono(port: PortRef) -> Self {
        Sig {
            left: port,
            right: None,
        }
    }
    fn stereo(left: PortRef, right: PortRef) -> Self {
        Sig {
            left,
            right: Some(right),
        }
    }
}

struct Compiler {
    patch: Patch,
    pitch_out: PortRef,
    gate_out: PortRef,
    params: HashMap<String, ParamHandle>,
}

impl Compiler {
    /// Pin the control input `port` on `node` to a constant `value`. Used only
    /// for fixed wiring decisions; user knobs go through [`Self::knob`].
    ///
    /// Implemented as [`Patch::set_param_by_id`]: the override is baked into
    /// the port's *default* when quiver builds its routing, so pinning costs
    /// no node and no per-sample work. (An earlier version cabled a pooled
    /// [`Offset`] node into each site, on the belief that a port default could
    /// not be overridden from outside the module; `set_param_by_id` does
    /// exactly that, and quiver's gather writes the identical constant either
    /// way, so this is bit-exact and strictly cheaper.)
    ///
    /// The one thing a baked default cannot do is coexist with a cable: gather
    /// sums the cables into a patched port and **ignores** its default. So any
    /// port that also receives a knob or modulation cable must be pinned by a
    /// real cable instead (the wavefolder threshold sums `#thresh` plus its
    /// mod source on one port), and [`Self::wire_pitch`] keeps a real
    /// [`Offset`] node because it *sums with* the incoming pitch CV rather
    /// than replacing an unpatched default.
    fn constant(&mut self, value: f64, node: NodeId, port: &str) -> Result<(), PatchError> {
        if self.patch.set_param_by_id(node, port, value) {
            Ok(())
        } else {
            Err(PatchError::InvalidPort {
                node,
                name: Some(port.to_string()),
                port: None,
                available: Vec::new(),
            })
        }
    }

    /// Add a **live** knob: an [`ExternalInput`] whose atomic value the
    /// audio thread reads every sample, registered under the knob's trace
    /// address. Turning the knob writes the atomic — the sound changes
    /// immediately, and all filter/delay state survives.
    fn knob(
        &mut self,
        key: &str,
        site: &str,
        raw: f64,
        pmap: ParamMap,
        bipolar: bool,
        target: PortRef,
    ) -> Result<(), PatchError> {
        let value = Arc::new(AtomicF64::new(pmap.apply(raw)));
        let input = if bipolar {
            ExternalInput::cv_bipolar(Arc::clone(&value))
        } else {
            ExternalInput::cv(Arc::clone(&value))
        };
        let n = self.patch.add(format!("{key}:{site}!"), input);
        self.patch.connect(n.out("out"), target)?;
        self.params
            .insert(format!("{key}#{site}"), ParamHandle { value, map: pmap });
        Ok(())
    }

    /// Wire a modulation term into `target`. `ModNode::None` wires nothing.
    ///
    /// `key` names the mod source's own nodes and knobs (`node/m:lfo`,
    /// `node/m#rate`); `owner` is the *modulated* module, because that is where
    /// `describe.rs` advertises the `#mdepth` knob.
    ///
    /// The depth is an [`Attenuverter`] driven by a real [`Self::knob`], not a
    /// baked-in cable attenuation. Turning it used to require a full
    /// recompile — a 6 ms fade-out, per-quantum voice rebuild and fade-in for
    /// the length of the drag, while every neighbouring knob swept
    /// continuously.
    fn wire_mod(
        &mut self,
        m: &ModNode,
        key: &str,
        owner: &str,
        depth: f64,
        target: PortRef,
    ) -> Result<(), PatchError> {
        // (source port, the taper that matches its output range)
        let (src, pmap) = match m {
            ModNode::None => return Ok(()),
            ModNode::Lfo { wave, rate } => {
                let lfo = self.patch.add(format!("{key}:lfo"), Lfo::new(self.sr()));
                self.knob(key, "rate", *rate, ParamMap::Unit, false, lfo.in_("rate"))?;
                (lfo.out(wave.port_name()), ParamMap::ModDepthBipolar)
            }
            ModNode::Rand { rate } => {
                // S&H burble: white noise sampled on an internal square-LFO
                // clock. The knob drives the clock rate.
                let clk = self.patch.add(format!("{key}:rclk"), Lfo::new(self.sr()));
                self.knob(key, "rate", *rate, ParamMap::Unit, false, clk.in_("rate"))?;
                let noise = self
                    .patch
                    .add(format!("{key}:rnoise"), NoiseGenerator::new());
                let snh = self.patch.add(format!("{key}:snh"), SampleAndHold::new());
                self.patch.connect(noise.out("white"), snh.in_("in"))?;
                self.patch.connect(clk.out("sqr"), snh.in_("trig"))?;
                (snh.out("out"), ParamMap::ModDepthBipolar)
            }
            ModNode::Env { attack, decay } => {
                let env = self.patch.add(format!("{key}:env"), Adsr::new(self.sr()));
                self.patch.connect(self.gate_out, env.in_("gate"))?;
                self.knob(
                    key,
                    "att",
                    *attack,
                    ParamMap::Unit,
                    false,
                    env.in_("attack"),
                )?;
                self.knob(key, "dec", *decay, ParamMap::Unit, false, env.in_("decay"))?;
                // AD shape: no sustain plateau, quick release.
                self.constant(0.0, env.id(), "sustain")?;
                self.constant(0.1, env.id(), "release")?;
                // Exponential contour, as on the amp envelope — a linear filter
                // sweep reads as a fader move, not as a decay.
                self.constant(GATE_TRUE, env.id(), "shape")?;
                (env.out("env"), ParamMap::ModDepthUnipolar)
            }
        };
        let att = self.patch.add(format!("{key}:depth"), Attenuverter::new());
        self.patch.connect(src, att.in_("in"))?;
        self.knob(owner, "mdepth", depth, pmap, true, att.in_("level"))?;
        self.patch.connect(att.out("out"), target)?;
        Ok(())
    }

    /// Feed a subtree's output into a mono input. A stereo pair is summed at
    /// −6 dB per side (two cables into one input sum in quiver's gather), which
    /// is the level-preserving downmix for the correlated dry path.
    fn feed(&mut self, sig: Sig, target: PortRef) -> Result<(), PatchError> {
        match sig.right {
            None => {
                self.patch.connect(sig.left, target)?;
            }
            Some(r) => {
                self.patch.connect_attenuated(sig.left, target, 0.5)?;
                self.patch.connect_attenuated(r, target, 0.5)?;
            }
        }
        Ok(())
    }

    /// Block DC ahead of the VCA, using an [`Svf`] highpass parked at its
    /// lowest corner.
    ///
    /// `DiodeLadderFilter::diode_sat` is asymmetric by design (`tanh(1.2x)` up,
    /// `tanh(0.8x)` down) and audio reaches it at nominal ±5 V, so it emits real
    /// DC. Blocking downstream of the VCA would be too late: the amp envelope
    /// has already multiplied that offset into a per-note thump whose spectrum
    /// reaches far above the offset itself. Removing it first means the thump is
    /// never created.
    ///
    /// An `x[n] − x[n−1] + R·y[n−1]` one-pole at 5 Hz, assembled from a `Mixer`
    /// and two `UnitDelay`s, is the textbook answer and measures correctly — but
    /// its state is not sanitized, so after a note ends it rings on as a smooth
    /// sub-audio decay that never reaches zero. That residue is inaudible and
    /// harmless to play, and *ruinous* to the feature extractor: spectral
    /// flatness is a geometric mean, and a tail of near-DC frames drags the
    /// phrase mean down by two orders of magnitude, which would silently
    /// corrupt every preference observation. `Svf` flushes its state, so its
    /// tail lands on exact zero.
    fn dc_blocker(&mut self, name: &str, input: PortRef) -> Result<PortRef, PatchError> {
        let f = self.patch.add(format!("{name}:hp"), Svf::new(self.sr()));
        self.patch.connect(input, f.in_("in"))?;
        self.constant(DC_BLOCK_CUTOFF, f.id(), "cutoff")?;
        self.constant(0.0, f.id(), "res")?;
        Ok(f.out("hp"))
    }

    /// Build one channel of the mandatory voice tail:
    /// `input → DC blocker → VCA → Limiter`. Called twice when the tree ends
    /// in a stereo module, sharing the one amp envelope.
    fn voice_tail(
        &mut self,
        side: &str,
        input: PortRef,
        env: PortRef,
        block_dc: bool,
    ) -> Result<PortRef, PatchError> {
        let blocked = if block_dc {
            self.dc_blocker(&format!("voice:dc{side}"), input)?
        } else {
            input
        };

        let vca = self.patch.add(format!("voice:vca{side}"), Vca::new());
        self.patch.connect(blocked, vca.in_("in"))?;
        self.patch.connect(env, vca.in_("cv"))?;
        // Exponential response. A linear VCA fed a linear envelope loses its
        // last 20 dB in the final instant of the decay, which is why the
        // instrument read as "wrong" before anyone could name why.
        self.constant(GATE_TRUE, vca.id(), "response")?;

        let limiter = self
            .patch
            .add(format!("voice:limiter{side}"), Limiter::new(self.sr()));
        self.patch.connect(vca.out("out"), limiter.in_("in"))?;
        // A safety net, not a tone stage. Three things had to change together:
        // the threshold is 1.0 (= 5 V, the top of nominal quiver audio) rather
        // than the 0.8 default, which put every patch permanently inside the
        // knee; `soft` is off, so there is no continuous tanh shaping with a
        // release that pumps against the amp envelope; and the sidechain is
        // patched from the same signal, because quiver's gather writes the
        // port default (0 V) to an unpatched input, so the detector was
        // reading silence and the stage was in fact a bare hard clipper at
        // 4 V. Real limiting lives on the master bus, across the voice sum.
        self.constant(1.0, limiter.id(), "threshold")?;
        self.constant(GATE_FALSE, limiter.id(), "soft")?;
        self.patch
            .connect(vca.out("out"), limiter.in_("sidechain"))?;
        Ok(limiter.out("out"))
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

    /// Build the audio subtree rooted at `node`; returns its output signal.
    fn build(&mut self, node: &AudioNode, key: &str) -> Result<Sig, PatchError> {
        match node {
            AudioNode::Vco {
                wave,
                octave,
                detune,
            } => {
                let vco = self.patch.add(format!("{key}:vco"), Vco::new(self.sr()));
                self.wire_pitch(key, *octave, *detune, vco.in_("voct"))?;
                Ok(Sig::mono(vco.out(wave.port_name())))
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
                self.knob(
                    key,
                    "det",
                    *detune,
                    ParamMap::Unit,
                    false,
                    saw.in_("detune"),
                )?;
                self.knob(key, "smix", *mix, ParamMap::Unit, false, saw.in_("mix"))?;
                Ok(Sig::mono(saw.out("out")))
            }
            AudioNode::Noise { color } => {
                let noise = self
                    .patch
                    .add(format!("{key}:noise"), NoiseGenerator::new());
                Ok(Sig::mono(noise.out(color.port_name())))
            }
            AudioNode::Mix { balance, a, b } => {
                let a_out = self.build(a, &format!("{key}/0"))?;
                let b_out = self.build(b, &format!("{key}/1"))?;
                let xf = self.patch.add(format!("{key}:mix"), Crossfader::new());
                self.feed(a_out, xf.in_("a"))?;
                self.feed(b_out, xf.in_("b"))?;
                self.knob(
                    key,
                    "bal",
                    *balance,
                    ParamMap::XfadePos,
                    true,
                    xf.in_("pos"),
                )?;
                Ok(Sig::mono(xf.out("out")))
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
                self.feed(in_out, filt.in_("in"))?;
                self.knob(
                    key,
                    "cut",
                    *cutoff,
                    ParamMap::Unit,
                    false,
                    filt.in_("cutoff"),
                )?;
                self.knob(
                    key,
                    "res",
                    *resonance,
                    ParamMap::Resonance,
                    false,
                    filt.in_("res"),
                )?;
                // Keyboard tracking. Without it `keytrack_amt` stays at
                // quiver's 0.0 default and the corner never moves: a patch
                // dialled in at cutoff 0.3 (≈159 Hz) speaks at C3 and is gone
                // by C6. Half-tracking keeps the timbre recognisable across the
                // keyboard without following pitch so exactly that the filter
                // stops colouring anything.
                self.patch.connect(self.pitch_out, filt.in_("keytrack"))?;
                self.constant(KEYTRACK_AMT, filt.id(), "keytrack_amt")?;
                self.wire_mod(
                    modulation,
                    &format!("{key}/m"),
                    key,
                    *mod_depth,
                    filt.in_("fm"),
                )?;
                Ok(Sig::mono(filt.out(out_port)))
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
                self.feed(in_out, fold.in_("in"))?;
                // `#thresh` is a live knob cabled into port 1, *not* the
                // constructor argument. `Wavefolder::new` only sets that port's
                // default, and quiver's gather ignores a default the moment any
                // cable arrives — so as soon as `wire_mod` patched the fold, the
                // threshold knob went silently dead. Two cables into one input
                // sum, which is exactly the offset-plus-modulation the module
                // has no dedicated port for.
                self.knob(
                    key,
                    "thresh",
                    *threshold,
                    ParamMap::FoldThreshold,
                    false,
                    fold.in_("threshold"),
                )?;
                self.wire_mod(
                    modulation,
                    &format!("{key}/m"),
                    key,
                    *mod_depth,
                    fold.in_("threshold"),
                )?;
                Ok(Sig::mono(fold.out("out")))
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
                self.feed(in_out, dl.in_("in"))?;
                self.knob(key, "time", *time, ParamMap::Unit, false, dl.in_("time"))?;
                self.knob(
                    key,
                    "fb",
                    *feedback,
                    ParamMap::Feedback,
                    false,
                    dl.in_("feedback"),
                )?;
                self.knob(key, "dmix", *mix, ParamMap::Unit, false, dl.in_("mix"))?;
                Ok(Sig::mono(dl.out("out")))
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
                self.feed(in_out, ch.in_("in"))?;
                self.knob(key, "crate", *rate, ParamMap::Unit, false, ch.in_("rate"))?;
                self.knob(
                    key,
                    "cdepth",
                    *depth,
                    ParamMap::Unit,
                    false,
                    ch.in_("depth"),
                )?;
                self.knob(key, "cmix", *mix, ParamMap::Unit, false, ch.in_("mix"))?;
                // Width is the entire reason a chorus exists; port 10 (`out`)
                // is the mono sum of the two voices and throws it away.
                Ok(Sig::stereo(ch.out("left"), ch.out("right")))
            }
            AudioNode::Reverb {
                size,
                damp,
                mix,
                input,
            } => {
                let in_out = self.build(input, &format!("{key}/0"))?;
                let rv = self
                    .patch
                    .add(format!("{key}:reverb"), Reverb::new(self.sr()));
                self.feed(in_out, rv.in_("in"))?;
                self.knob(key, "rsize", *size, ParamMap::Unit, false, rv.in_("size"))?;
                self.knob(
                    key,
                    "rdamp",
                    *damp,
                    ParamMap::Unit,
                    false,
                    rv.in_("damping"),
                )?;
                self.knob(key, "rmix", *mix, ParamMap::Unit, false, rv.in_("mix"))?;
                // The decorrelation between the two tanks *is* the reverb.
                Ok(Sig::stereo(rv.out("left"), rv.out("right")))
            }
        }
    }
}

/// Does this subtree contain a nonlinearity that can rectify, i.e. produce a
/// standing DC offset?
///
/// Only [`DiodeLadderFilter`] can. Its `diode_sat` is deliberately asymmetric
/// (`tanh(1.2x)` up, `tanh(0.8x)` down) and is applied at six points in the
/// ladder core. Everything else in the palette is either linear or exactly
/// odd-symmetric, and an odd nonlinearity cannot create DC from a zero-mean
/// input: `saturation::fold` is `±2t − y`, the SVF's state clipper is
/// `L·tanh(x/L)`, the limiter clamps symmetrically, and every source
/// (`Vco`, `Supersaw`, noise) is zero-mean.
fn has_ladder(node: &AudioNode) -> bool {
    match node {
        AudioNode::Vco { .. } | AudioNode::Supersaw { .. } | AudioNode::Noise { .. } => false,
        AudioNode::Mix { a, b, .. } => has_ladder(a) || has_ladder(b),
        AudioNode::Filter { kind, input, .. } => {
            matches!(kind, FilterKind::Ladder) || has_ladder(input)
        }
        AudioNode::Fold { input, .. }
        | AudioNode::Delay { input, .. }
        | AudioNode::Chorus { input, .. }
        | AudioNode::Reverb { input, .. } => has_ladder(input),
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
        params: HashMap::new(),
    };

    // The evolved tree.
    let audio_out = c.build(&tree.root, "node")?;

    // Mandatory voice stage: amp ADSR → VCA → limiter → stereo out.
    let adsr = c.patch.add("voice:adsr", Adsr::new(sample_rate));
    c.patch.connect(c.gate_out, adsr.in_("gate"))?;
    c.knob(
        "amp",
        "attack",
        tree.amp.attack,
        ParamMap::Unit,
        false,
        adsr.in_("attack"),
    )?;
    c.knob(
        "amp",
        "decay",
        tree.amp.decay,
        ParamMap::Unit,
        false,
        adsr.in_("decay"),
    )?;
    c.knob(
        "amp",
        "sustain",
        tree.amp.sustain,
        ParamMap::Unit,
        false,
        adsr.in_("sustain"),
    )?;
    c.knob(
        "amp",
        "release",
        tree.amp.release,
        ParamMap::Unit,
        false,
        adsr.in_("release"),
    )?;
    // Exponential contour. quiver's `shape` is a gate, not a curve amount: at
    // its 0 V default the whole instrument ran linear envelopes, and a linear
    // decay sounds like a fader being pulled, not like a note dying.
    c.constant(GATE_TRUE, adsr.id(), "shape")?;

    let env = adsr.out("env");
    // Only pay for the blocker where DC can actually arise. It is an `Svf`,
    // and `Svf::tick` evaluates three transcendentals per sample — measured at
    // 0.057 s of render per patch, ~18% of a typical voice — so putting one on
    // every patch taxes the 91% that have no rectifying nonlinearity at all.
    let block_dc = has_ladder(&tree.root) || std::env::var("RIC_DCB_ALWAYS").is_ok();
    let left = c.voice_tail("", audio_out.left, env, block_dc)?;
    let right = match audio_out.right {
        Some(r) => Some(c.voice_tail("R", r, env, block_dc)?),
        None => None,
    };

    let out = c.patch.add("voice:out", StereoOutput::new());
    c.patch.connect(left, out.in_("left"))?;
    // A mono tree leaves `right` unpatched — StereoOutput normals it to left,
    // and any cable at all would break that normal.
    if let Some(r) = right {
        c.patch.connect(r, out.in_("right"))?;
    }

    let params = std::mem::take(&mut c.params);
    let mut patch = c.patch;
    patch.set_output(out.id());
    patch.compile()?;
    let warnings = patch.warnings().to_vec();

    Ok(CompiledVoice {
        patch,
        pitch,
        gate,
        params,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::term::{AmpEnv, FilterKind, ModNode, NoiseColor, Waveform};

    const SR: f64 = 44_100.0;

    fn sustained(root: AudioNode) -> PatchTree {
        PatchTree {
            amp: AmpEnv {
                attack: 0.1,
                decay: 0.3,
                sustain: 1.0,
                release: 0.3,
            },
            root,
        }
    }

    fn saw() -> AudioNode {
        AudioNode::Vco {
            wave: Waveform::Saw,
            octave: 0,
            detune: 0.5,
        }
    }

    /// Overwrite one of the compiler's baked constants — a `set_param_by_id`
    /// default on the named node's port — in an already compiled voice (the
    /// next tick recompiles and bakes it in). Every wiring decision in this
    /// module that is *not* a knob is such a constant, so this renders the
    /// exact counterfactual — the identical graph with one pinned value
    /// neutralized.
    fn set_constant(v: &mut CompiledVoice, node: &str, port: &str, value: f64) {
        let id = v
            .patch
            .get_node_id_by_name(node)
            .unwrap_or_else(|| panic!("no node `{node}`"));
        assert!(
            v.patch.set_param_by_id(id, port, value),
            "no control port `{port}` on `{node}`"
        );
    }

    fn hold(v: &mut CompiledVoice, voct: f64, n: usize) -> Vec<(f64, f64)> {
        v.pitch.set(voct);
        v.gate.set(5.0);
        (0..n).map(|_| v.patch.tick()).collect()
    }

    fn rms(buf: &[(f64, f64)]) -> f64 {
        (buf.iter().map(|(l, _)| l * l).sum::<f64>() / buf.len() as f64).sqrt()
    }

    /// Filter keytracking is wired and follows the keyboard. White noise is a
    /// pitch-independent source, so *any* change of level with pitch through a
    /// fixed-cutoff lowpass is the keytrack and nothing else — and with
    /// `keytrack_amt` neutralized the level must stop moving entirely.
    #[test]
    fn filter_tracks_the_keyboard() {
        let tree = sustained(AudioNode::Filter {
            kind: FilterKind::SvfLp,
            cutoff: 0.3,
            resonance: 0.0,
            mod_depth: 0.0,
            input: Box::new(AudioNode::Noise {
                color: NoiseColor::White,
            }),
            modulation: ModNode::None,
        });
        let level = |amt: Option<f64>, voct: f64| {
            let mut v = compile(&tree, SR).expect("compiles");
            if let Some(a) = amt {
                set_constant(&mut v, "node:svf", "keytrack_amt", a);
            }
            // Every leg hears the *same* noise. quiver's noise draws from a
            // thread-local RNG seeded from the system clock, so without this
            // each measurement gets a different realisation — and the patch
            // ends in a limiter, whose gain reduction tracks peak statistics
            // rather than RMS, so the difference between two realisations is
            // far larger than sampling error. Measured over 120 unseeded runs
            // the flat-control ratio spread from 0.0000 to 0.1332 against a
            // 0.1 tolerance: a 1.7%-per-run CI failure that says nothing about
            // keytracking. Seeded, both legs differ only by the thing under
            // test, which is also why the tolerance below can be tight.
            quiver::rng::seed(0x5EED_1E55);
            let out = hold(&mut v, voct, 88_200);
            rms(&out[44_100..])
        };
        let (low, mid, high) = (level(None, -2.0), level(None, 0.0), level(None, 2.0));
        assert!(
            low < mid && mid < high && high > low * 1.8,
            "cutoff does not follow pitch: C2 {low:.4}, C4 {mid:.4}, C6 {high:.4}"
        );
        // Counterfactual: amount 0 is quiver's default, i.e. the old behaviour.
        let (flat_low, flat_high) = (level(Some(0.0), -2.0), level(Some(0.0), 2.0));
        assert!(
            (flat_high / flat_low - 1.0).abs() < 0.01,
            "control is not flat, so the test proves nothing: \
             C2 {flat_low:.4}, C6 {flat_high:.4}"
        );
    }

    /// The DC blocker removes the ladder's saturation offset. `diode_sat` is
    /// deliberately asymmetric and audio reaches it at nominal ±5 V, so without
    /// the blocker the amp envelope multiplies a standing offset into a thump
    /// on every note.
    #[test]
    fn dc_blocker_removes_the_ladder_offset() {
        let tree = sustained(AudioNode::Filter {
            kind: FilterKind::Ladder,
            cutoff: 0.35,
            resonance: 0.3,
            mod_depth: 0.0,
            input: Box::new(saw()),
            modulation: ModNode::None,
        });
        let mut v = compile(&tree, SR).expect("compiles");
        let n = (SR * 5.0) as usize;
        let out = hold(&mut v, -2.0, n);
        let tail = &out[n / 2..];
        let dc = tail.iter().map(|(l, _)| l).sum::<f64>() / tail.len() as f64;
        let level = rms(tail);
        assert!(level > 0.1, "patch was silent, nothing to measure");
        assert!(
            dc.abs() / level < 2.0e-3,
            "standing DC offset {dc:.6} against {level:.4} rms"
        );
    }

    /// Reverb and chorus keep both tanks all the way to the stereo output, and
    /// a mono tree still normals right to left rather than going silent.
    #[test]
    fn stereo_tanks_reach_the_output() {
        let mut wide = compile(
            &sustained(AudioNode::Reverb {
                size: 0.7,
                damp: 0.4,
                mix: 0.6,
                input: Box::new(saw()),
            }),
            SR,
        )
        .expect("compiles");
        let out = hold(&mut wide, 0.0, 44_100);
        let tail = &out[22_050..];
        let width: f64 = tail.iter().map(|(l, r)| (l - r).abs()).sum::<f64>() / tail.len() as f64;
        assert!(
            width > 1.0e-2,
            "reverb collapsed to mono (width {width:.5})"
        );

        let mut narrow = compile(&sustained(saw()), SR).expect("compiles");
        let out = hold(&mut narrow, 0.0, 4_410);
        assert!(
            out.iter().all(|(l, r)| l == r) && rms(&out) > 1.0e-3,
            "mono tree lost its right channel"
        );
    }

    /// The wavefolder's `#thresh` knob is live *while the fold is modulated*.
    /// `Wavefolder::new` only sets port 1's default, and quiver ignores a
    /// default the moment any cable lands on the port — so the knob used to go
    /// silently dead exactly when a mod source was attached.
    #[test]
    fn fold_threshold_stays_live_under_modulation() {
        let tree = sustained(AudioNode::Fold {
            threshold: 0.5,
            mod_depth: 0.6,
            input: Box::new(saw()),
            modulation: ModNode::Lfo {
                wave: Waveform::Sine,
                rate: 0.4,
            },
        });
        let at = |thresh: f64| {
            let mut v = compile(&tree, SR).expect("compiles");
            v.params
                .get("node#thresh")
                .expect("fold threshold has no live handle")
                .set_normalized(thresh);
            let out = hold(&mut v, 0.0, 44_100);
            rms(&out[22_050..])
        };
        let (hard, soft) = (at(0.0), at(1.0));
        assert!(
            (hard - soft).abs() / soft.max(1.0e-9) > 0.05,
            "fold threshold knob is inaudible: {hard:.4} vs {soft:.4}"
        );
        // The mod depth advertised by `describe.rs` is a live handle too, so
        // dragging it no longer forces a whole-patch recompile.
        assert!(
            tree_params(&tree).contains(&"node#mdepth".to_string()),
            "mod depth has no live handle"
        );
    }

    fn tree_params(tree: &PatchTree) -> Vec<String> {
        compile(tree, SR)
            .expect("compiles")
            .params
            .keys()
            .cloned()
            .collect()
    }

    /// Amp envelope and VCA run exponential, not linear. Measured as the
    /// convexity of the decay: a linear contour through a linear VCA is a
    /// straight line to the sustain floor, so it sits at exactly half its
    /// starting level halfway through the decay.
    #[test]
    fn amp_contour_is_exponential() {
        let tree = PatchTree {
            amp: AmpEnv {
                attack: 0.0,
                decay: 0.7, // ≈630 ms
                sustain: 0.0,
                release: 0.3,
            },
            root: saw(),
        };
        let half_life = |exp: bool| {
            let mut v = compile(&tree, SR).expect("compiles");
            if !exp {
                // The gate is baked on both `Adsr.shape` and `Vca.response`.
                set_constant(&mut v, "voice:adsr", "shape", GATE_FALSE);
                set_constant(&mut v, "voice:vca", "response", GATE_FALSE);
            }
            let out = hold(&mut v, 0.0, (SR * 0.7) as usize);
            // Peak amplitude in each 10 ms window, as an envelope follower.
            let win = (SR * 0.01) as usize;
            let env: Vec<f64> = out
                .chunks(win)
                .map(|c| c.iter().fold(0.0f64, |m, (l, _)| m.max(l.abs())))
                .collect();
            let start = env[2];
            env.iter()
                .position(|&e| e < start * 0.5)
                .unwrap_or(env.len()) as f64
                * 0.01
        };
        let (exp, lin) = (half_life(true), half_life(false));
        assert!(
            exp < lin * 0.8,
            "decay is not exponential: half-life {exp:.2}s exp vs {lin:.2}s linear"
        );
    }

    /// ...and it is not a bass cut. A DC blocker that audits as "thin" has
    /// traded one defect for a worse one, so the passband is pinned where the
    /// instrument actually plays.
    #[test]
    fn dc_blocker_keeps_the_bass() {
        let tree = PatchTree {
            amp: AmpEnv {
                attack: 0.1,
                decay: 0.3,
                sustain: 0.3, // well under the limiter, so gains are readable
                release: 0.3,
            },
            // A ladder, so the patch actually receives a blocker; a sine
            // through it stays a sine, so output level reads as filter gain.
            root: AudioNode::Filter {
                kind: FilterKind::Ladder,
                cutoff: 1.0,
                resonance: 0.0,
                mod_depth: 0.0,
                input: Box::new(AudioNode::Vco {
                    wave: Waveform::Sine,
                    octave: 0,
                    detune: 0.5,
                }),
                modulation: ModNode::None,
            },
        };
        let at = |voct: f64| {
            let mut v = compile(&tree, SR).expect("compiles");
            let out = hold(&mut v, voct, 44_100);
            rms(&out[22_050..])
        };
        let reference = at(0.0); // C4
                                 // C2 (65 Hz) within 1 dB, C3 within 0.5 dB.
        assert!(at(-2.0) > reference * 0.89, "C2 lost more than 1 dB");
        assert!(at(-1.0) > reference * 0.945, "C3 lost more than 0.5 dB");
    }
}
