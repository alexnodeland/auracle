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

use quiver::modules::{
    Attenuverter, Bitcrusher, Chorus, Clock, Compressor, DelayLine, Distortion, Ducker,
    EnvelopeFollower, Euclidean, Flanger, FormantOsc, Granular, KarplusStrong, Limiter, LogicAnd,
    LogicOr, LogicXor, Max, Min, NoiseGate, ParametricEq, Phaser, Rectifier, Reverb, SampleAndHold,
    ScaleQuantizer, Supersaw, Tremolo, VcSwitch, Vibrato,
};
use quiver::prelude::*;
use quiver::{AtomicF64, ExternalInput};

use crate::term::{
    rect_mode_index, AudioNode, DriveMode, FilterKind, ModNode, ModOp, PairOp, PatchTree,
};

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
/// Attack time of every [`ModNode::Follow`] detector, normalized on quiver's
/// `0.1 + 99.9·x` ms map — so 0.05 is ≈5 ms. Fixed rather than a knob because
/// the faceplate is already at its four-knob budget, and because a follower
/// that is slow on the *attack* stops being an envelope follower: it misses
/// the transient, which is the only part of a note whose dynamics carry
/// timbral information the rest of the patch does not already have. Release
/// is the musical choice, so release gets the knob.
const FOLLOW_ATTACK: f64 = 0.05;
/// Number of allpass stages in the phaser, as quiver's `stages` CV (< 0.33 →
/// 2, < 0.66 → 4, else 6). Pinned to 6: fewer stages give fewer notches, and
/// a two-notch phaser on a bright source is hard to tell from a chorus.
const PHASER_STAGES: f64 = 1.0;
/// Phaser stereo spread (0 = mono, 1 = the two sweeps 180° apart). A little
/// under half keeps the notches audibly decorrelated without the swimming,
/// phase-cancelling collapse a full 180° gives on a mono playback system.
const PHASER_SPREAD: f64 = 0.35;
/// Phaser wet/dry. A phaser *is* the interference between wet and dry, so an
/// even blend is the only setting at which the notches reach full depth;
/// `#pdepth` and `#pfb` are the expressive controls and this is not one.
const PHASER_MIX: f64 = 0.5;
/// The formant oscillator's own vibrato depth (quiver's port 3, a fixed
/// 5.5 Hz LFO on pitch). Pinned off: a pre-baked vibrato at a rate the patch
/// cannot name is exactly what the modulation slot exists to replace, and now
/// that [`Offset`]-based pitch modulation exists the grammar can express the
/// same gesture with a rate, a waveform and a depth of its own.
const FORMANT_VIBRATO: f64 = 0.0;
/// Flanger wet/dry. A flanger *is* the interference between the swept comb and
/// the dry signal, so an even blend is where the notches reach full depth —
/// the same argument as [`PHASER_MIX`], and `#fdepth`/`#ffb` are the
/// expressive controls.
const FLANGER_MIX: f64 = 0.5;
/// Flanger stereo spread (0 = mono, 1 = the two sweeps 180° apart). Matched to
/// [`PHASER_SPREAD`] for the same reason and, incidentally, because a non-zero
/// spread is what makes quiver's ports 11/12 differ at all — at 0 they are
/// bit-identical and the stereo pair would be a lie.
const FLANGER_SPREAD: f64 = 0.35;
/// EQ low-shelf corner, on quiver's `50·10^cv` Hz map — 0.2 is ≈79 Hz, under
/// the fundamental of most of what this instrument plays, so the shelf lifts
/// or cuts *weight* rather than re-voicing the note.
const EQ_LOW_FREQ: f64 = 0.2;
/// EQ mid-bell centre, on quiver's `200·40^cv` Hz map — 0.5 is ≈1.26 kHz, the
/// presence region where a synth patch reads as forward or recessed.
const EQ_MID_FREQ: f64 = 0.5;
/// EQ mid-bell Q, on quiver's `0.5 + 9.5·cv` map — 0.35 is Q ≈ 3.8, so the
/// bell is about a third of an octave wide. Narrow enough that the band is a
/// *place* rather than a broad tilt the two shelves already cover, wide enough
/// that a full cut is a scoop and not a notch.
const EQ_MID_Q: f64 = 0.35;
/// EQ high-shelf corner, on quiver's `2000 + 10000·cv` Hz map — 0.5 is 7 kHz,
/// above the highest fundamental the keyboard reaches, so the shelf is
/// unambiguously air and never a second mid control.
const EQ_HIGH_FREQ: f64 = 0.5;
/// Granular pitch shift. Pinned to no transposition: quiver reads this port as
/// ±24 semitones, and a granulator that also transposes is a second pitch
/// source fighting the keyboard for the same note.
const GRANULAR_PITCH: f64 = 0.0;
/// Granular position randomization. A little spray decorrelates the grain
/// starts so overlapping grains stop phase-summing into a single tone; at 0
/// the module is an odd stutter rather than a texture.
const GRANULAR_SPRAY: f64 = 0.15;
/// Granular buffer freeze (a quiver `Gate` port). Pinned open: freeze is a
/// performance gesture, not a genome parameter, and a frozen buffer in an
/// evolved patch is a patch that ignores the keyboard — every note after the
/// first would replay the first one's audio.
const GRANULAR_FREEZE: f64 = 0.0;
/// Compressor attack, on quiver's `0.1 + 99.9·x` ms map — 0.15 is ≈15 ms.
/// Slow enough to let a transient through before the gain moves, which is what
/// makes a compressed patch still sound plucked. Fixed rather than a knob
/// because ratio and threshold are the character and the faceplate is at its
/// four-knob budget; the ballistics are where that budget spends least.
const COMP_ATTACK: f64 = 0.15;
/// Compressor release, on quiver's `10 + 990·x` ms map — 0.35 is ≈357 ms.
/// Long enough that the gain does not chatter on a decaying note, short enough
/// that a sidechain pump recovers inside one beat at any tempo the phrase
/// implies. Fixed for the same reason as [`COMP_ATTACK`].
const COMP_RELEASE: f64 = 0.35;
/// Ducker attack, on quiver's `0.1 + 99.9·x` ms map — 0.05 is ≈5 ms. A ducker
/// that opens slowly is a ducker you cannot hear working: the whole gesture is
/// the *edge* of the key's transient, and anything past ~10 ms puts the duck
/// behind the hit that caused it.
const DUCK_ATTACK: f64 = 0.05;
/// Gate attack, on quiver's `0.1 + 49.9·x` ms map — 0.02 is ≈1.1 ms. Same
/// argument as [`DUCK_ATTACK`], and more so: a gate that opens slowly eats the
/// transient it was opened by, which is the one part of the note that carried
/// the information.
const GATE_ATTACK: f64 = 0.02;
/// [`quiver::modules::Euclidean`]'s pattern rotation. Pinned to no rotation:
/// with `steps` and `pulses` both live, rotation only chooses *which* of the
/// pattern's rests the cycle starts on, which is a phase and not a timbre —
/// and a phase is inaudible in a five-second phrase that fires the pattern
/// once or twice.
const EUCLID_ROTATION: f64 = 0.0;
/// Attenuverter level (gain = `level/5`) on the **input** of a
/// [`ModOp::Quantize`], and its inverse on the output.
///
/// quiver's `ScaleQuantizer` reads and writes **V/Oct**: it snaps to the
/// nearest scale degree on a fixed 1/12 V grid. Handed a modulator at its
/// native ±5 V that is ±60 semitones, so the port emits 121 steps — finer than
/// the destination can show and, after the mod cable's own attenuation, finer
/// than the ear can hear. It would have been a quantizer that reviews as
/// correct and sounds continuous.
///
/// So the input is scaled *into* a musical window and the output scaled back
/// out, leaving the cable's gain unchanged and only the **grid** resized. At
/// level 0.5 (gain 0.1) a ±5 V source arrives as ±0.5 V = ±6 semitones, so the
/// scale gets 13 chromatic degrees to choose from — and the effective grid
/// referred to the mod cable is `(1/12)/0.1 = 0.833 V`.
///
/// That number is chosen so the headline case lands exactly: on the pitch
/// [`Offset`] at full `mod_depth` the cable's gain is 0.1, so a grid step is
/// `0.833 · 0.1 = 1/12 V` — **one semitone**, over the ±6 semitones
/// [`map::mod_depth_pitch`] allows. A quantized random melody is in tune at
/// depth 1.0 and in a stretched tuning below it, which is the honest
/// consequence of putting one attenuverter between every modulator and its
/// destination: depth scales interval size.
const QUANTIZE_IN_LEVEL: f64 = 0.5;
/// The output side of [`QUANTIZE_IN_LEVEL`] — `25 / QUANTIZE_IN_LEVEL`, so the
/// two gains multiply to exactly 1 and the op is transparent in scale.
/// `Attenuverter` is `in · level/5` with no clamp, and a pinned port default
/// is not range-checked, so a level above 5 V is a real gain of 10.
const QUANTIZE_OUT_LEVEL: f64 = 25.0 / QUANTIZE_IN_LEVEL;
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
    /// Bounded feedback on a bipolar port (`(2x−1)·0.7`), where the sign of
    /// the feedback is itself a timbre.
    FeedbackBipolar,
    /// Crossfader position (`(2x−1)·5 V`).
    XfadePos,
    /// Wavefolder threshold (`0.1 + 0.9·x`).
    FoldThreshold,
    /// Shelf/bell gain on a ±5 V port (`(2x−1)·5`), where knob centre must be
    /// 0 dB.
    GainBipolar,
    /// Formant shift on a ±5 V port (`(2x−1)·5`), where knob centre is no
    /// shift.
    FormantShift,
    /// A [`quiver::modules::Clock`] tempo (`10·x`), i.e. the port's whole
    /// 0–10 V range.
    ClockRate,
    /// Euclidean step count (`0.14 + 0.86·x`), i.e. 4..16 rather than 2..16.
    EuclidSteps,
    /// Euclidean pulse density (`0.25 + 0.74·x`), bounded off both degenerate
    /// ends at every step count.
    EuclidPulses,
    /// A [`quiver::modules::SlewLimiter`] time (`0.4·x`), i.e. the bottom of a
    /// port whose own map is already square-law.
    SlewTime,
    /// Transposition on the pitch shifter's ±5 V `shift` port
    /// (`(2x−1)·2.5`), i.e. ∓12 semitones with unison at knob centre.
    Semitones,
    /// The ducker's `amount`, a bipolar CV summed onto a knob base of 1.0
    /// (`(x−1)·5`).
    DuckAmount,
    /// A dynamics detector threshold, geometric over 0.05–5 V, on a port
    /// quiver reads as `cv · 5` volts.
    DetectorThreshold,
    /// The same threshold on the ducker's `ModulatedParam` port, which reads
    /// as `(0.2 + cv/5)·5` volts.
    DuckThreshold,
    /// Mod depth for a ±5 V source into a **normalized** 0..1 port.
    ModDepthBipolar,
    /// Mod depth for a 0–10 V source into a **normalized** 0..1 port.
    ModDepthUnipolar,
    /// Mod depth for a ±5 V source into the **pitch** [`Offset`] (V/Oct).
    ModDepthPitch,
    /// Mod depth for a 0–10 V source into the **pitch** [`Offset`] (V/Oct).
    ModDepthPitchUnipolar,
    /// Mod depth for a ±5 V source into a **±5 V gain** port (the EQ bands).
    ModDepthGain,
    /// Mod depth for a 0–10 V source into a **±5 V gain** port.
    ModDepthGainUnipolar,
    /// Mod depth for a ±5 V source into the pitch shifter's **semitone** port.
    ModDepthShift,
    /// Mod depth for a 0–10 V source into the **semitone** port.
    ModDepthShiftUnipolar,
    /// Mod depth for a ±5 V source into a [`quiver::prelude::ModulatedParam`]
    /// knob+CV port, where ±5 V spans the whole normalized parameter.
    ModDepthParamCv,
    /// Mod depth for a 0–10 V source into a `ModulatedParam` knob+CV port.
    ModDepthParamCvUnipolar,
    /// Mod depth for a ±5 V source into a **dynamics threshold** port.
    ModDepthDetector,
    /// Mod depth for a 0–10 V source into a dynamics threshold port.
    ModDepthDetectorUnipolar,
}

impl ParamMap {
    /// Map a normalized value to the wire value.
    pub fn apply(self, x: f64) -> f64 {
        match self {
            ParamMap::Unit => x,
            ParamMap::Resonance => map::resonance(x),
            ParamMap::Feedback => map::feedback(x),
            ParamMap::FeedbackBipolar => map::feedback_bipolar(x),
            ParamMap::XfadePos => map::xfade_pos(x),
            ParamMap::FoldThreshold => map::fold_threshold(x),
            ParamMap::GainBipolar => map::gain_bipolar(x),
            ParamMap::FormantShift => map::formant_shift(x),
            ParamMap::ClockRate => map::clock_rate(x),
            ParamMap::EuclidSteps => map::euclid_steps(x),
            ParamMap::EuclidPulses => map::euclid_pulses(x),
            ParamMap::SlewTime => map::slew_time(x),
            ParamMap::Semitones => map::semitones(x),
            ParamMap::DuckAmount => map::duck_amount(x),
            ParamMap::DetectorThreshold => map::detector_threshold(x),
            ParamMap::DuckThreshold => map::duck_threshold(x),
            ParamMap::ModDepthBipolar => map::mod_depth_bipolar(x),
            ParamMap::ModDepthUnipolar => map::mod_depth_unipolar(x),
            ParamMap::ModDepthPitch => map::mod_depth_pitch(x),
            ParamMap::ModDepthPitchUnipolar => map::mod_depth_pitch_unipolar(x),
            ParamMap::ModDepthGain => map::mod_depth_gain(x),
            ParamMap::ModDepthGainUnipolar => map::mod_depth_gain_unipolar(x),
            ParamMap::ModDepthShift => map::mod_depth_shift(x),
            ParamMap::ModDepthShiftUnipolar => map::mod_depth_shift_unipolar(x),
            ParamMap::ModDepthParamCv => map::mod_depth_param_cv(x),
            ParamMap::ModDepthParamCvUnipolar => map::mod_depth_param_cv_unipolar(x),
            ParamMap::ModDepthDetector => map::mod_depth_detector(x),
            ParamMap::ModDepthDetectorUnipolar => map::mod_depth_detector_unipolar(x),
        }
    }
}

/// Which *destination* a modulation cable is headed for.
///
/// The attenuverter level that means "full depth" is a property of the
/// destination's volt scale, not of the knob: a normalized 0..1 CV port, the
/// V/Oct pitch [`Offset`] and a ±5 V gain port all want different levels for
/// the same musical amount. [`Compiler::wire_mod`] picks the source polarity;
/// this picks the scale, and the two together choose the taper.
#[derive(Clone, Copy, Debug)]
enum DepthScale {
    /// A 0..1 CV port (cutoff, morph, depth, drive, position, …) — where
    /// almost every mod slot in this grammar lands.
    Normalized,
    /// The pitch [`Offset`]'s summing input, in V/Oct.
    Pitch,
    /// A ±5 V gain port, read by quiver as `cv/5 · 12` dB.
    Gain,
    /// The pitch shifter's `shift` port, read by quiver as `cv/5 · 24`
    /// semitones.
    Shift,
    /// A [`quiver::prelude::ModulatedParam`] knob+CV port — the ducker's
    /// `amount` and `threshold`. The CV is summed onto the module's own knob
    /// base after `cv / 5`, so ±5 V spans the parameter's *whole* normalized
    /// range rather than the 0..1 the plain CV ports carry.
    ParamCv,
    /// A dynamics detector threshold: a 0..1 CV port whose *knob* is
    /// geometric, so the useful settings crowd the bottom of it.
    Detector,
}

impl DepthScale {
    /// The taper for this destination, given the source's polarity.
    fn taper(self, unipolar: bool) -> ParamMap {
        match (self, unipolar) {
            (DepthScale::Normalized, false) => ParamMap::ModDepthBipolar,
            (DepthScale::Normalized, true) => ParamMap::ModDepthUnipolar,
            (DepthScale::Pitch, false) => ParamMap::ModDepthPitch,
            (DepthScale::Pitch, true) => ParamMap::ModDepthPitchUnipolar,
            (DepthScale::Gain, false) => ParamMap::ModDepthGain,
            (DepthScale::Gain, true) => ParamMap::ModDepthGainUnipolar,
            (DepthScale::Shift, false) => ParamMap::ModDepthShift,
            (DepthScale::Shift, true) => ParamMap::ModDepthShiftUnipolar,
            (DepthScale::ParamCv, false) => ParamMap::ModDepthParamCv,
            (DepthScale::ParamCv, true) => ParamMap::ModDepthParamCvUnipolar,
            (DepthScale::Detector, false) => ParamMap::ModDepthDetector,
            (DepthScale::Detector, true) => ParamMap::ModDepthDetectorUnipolar,
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
    /// Feedback on a port whose *sign* is musical (the phaser's resonance:
    /// negative feedback notches, positive peaks). Knob centre is no
    /// feedback, and the ends stop short of quiver's own ±0.95 clamp so the
    /// allpass chain never sits on the edge of ringing.
    pub fn feedback_bipolar(x: f64) -> f64 {
        (2.0 * x - 1.0) * 0.7
    }
    /// Wavetable select: the CV that lands table `i` of eight.
    ///
    /// The port is a **crossfade position**, not a quantizer, and getting that
    /// wrong is inaudible in a code review and unmissable at the keyboard.
    /// quiver computes `table_pos = cv·7`, takes `idx = floor(table_pos)` and
    /// then blends table `idx` into table `idx+1` by `frac + morph`
    /// (`quiver::modules::Wavetable`, oscillators.rs). So the cell-centre
    /// convention that is right for the *quantized* `mode` port below is
    /// exactly wrong here: `(i + 0.5)/8` put every table at a fractional
    /// position, which meant picking `sine` gave 56% sine and 44% triangle —
    /// and left `morph`, the knob this module exists for, with only the top
    /// half of its travel doing anything before `frac + morph` clamped at 1.
    ///
    /// `i/7` lands `frac` on exactly 0 for every table, so the plate names what
    /// you hear and morph sweeps the whole way to the next shape. (`i = 7`
    /// gives `table_pos = 7`, which quiver clamps to `idx = 6, frac = 1.0` —
    /// i.e. table 7 at full blend, still exact.)
    pub fn table_cv(index: usize) -> f64 {
        index as f64 / 7.0
    }
    /// Distortion mode select. quiver quantizes this port as `cv·3.99`, and
    /// its slot 2 is foldback, which this grammar deliberately does not
    /// expose (that module is [`crate::term::AudioNode::Fold`]), so the three
    /// values step *over* it: 0.125 → soft, 0.375 → hard, 0.875 → tube.
    pub fn drive_mode_cv(index: usize) -> f64 {
        match index {
            0 => 0.125,
            1 => 0.375,
            _ => 0.875,
        }
    }
    /// Wavefolder threshold: keep off the hard-zero fold-everything corner.
    pub fn fold_threshold(x: f64) -> f64 {
        0.1 + 0.9 * x
    }
    /// Shelf/bell gain on a bipolar ±5 V port. quiver's `ParametricEq` reads
    /// each band as `cv/5 · 12` dB, so this spans ±12 dB with **unity at knob
    /// centre** — the only sane home position for a tone control, and the
    /// reason a freshly placed eq is audibly a no-op until you move it.
    pub fn gain_bipolar(x: f64) -> f64 {
        (2.0 * x - 1.0) * 5.0
    }
    /// Formant shift on a bipolar ±5 V port. quiver's `FormantOsc` applies
    /// `2^(cv/5)` to every formant frequency, so the full sweep is 0.5×–2×
    /// (an octave either way) with **no shift at knob centre**. Both ends stay
    /// vocal: at 2× the /i/ formants land where a child's do, and at 0.5×
    /// where a very large chest does. Passing the raw 0..1 knob instead would
    /// have given 1.0×–1.15× and no downward shift at all.
    pub fn formant_shift(x: f64) -> f64 {
        (2.0 * x - 1.0) * 5.0
    }
    /// Transposition on the pitch shifter's bipolar `shift` port. quiver reads
    /// it as `cv/5 · 24` semitones and hard-clamps at ±24 (`PitchShifter`,
    /// nonlinear.rs), so a volt is 4.8 semitones and the port's full swing is
    /// two octaves each way.
    ///
    /// Half of it is the knob: **±12 semitones with unison at centre**. Two
    /// reasons for stopping there rather than at the rail. Musically, an
    /// octave either way is the whole harmony vocabulary this module has —
    /// the module aliases by design (no oversampling) and two octaves up is a
    /// 4× resample of a buffer that is already grainy. Structurally, the knob
    /// and the modulation cable **sum on this one port** (as on the wavefolder
    /// threshold), so leaving half the port free means a fully modulated,
    /// fully transposed shifter lands exactly on quiver's ±24 clamp instead of
    /// pinning against it for most of the sweep.
    pub fn semitones(x: f64) -> f64 {
        (2.0 * x - 1.0) * SHIFT_PEAK_V
    }
    /// The ducker's `amount` knob, in volts on its bipolar CV port.
    ///
    /// This port is **not** a plain CV: quiver reads it through a
    /// [`ModulatedParam`](quiver::prelude::ModulatedParam) whose value is
    /// `base + cv/5` over a `Linear{0, 1}` range, and `Ducker::new` sets
    /// `base = 1.0`. The base is only reachable through `set_amount` on the
    /// Rust struct — there is no port for it — so the *knob* has to arrive as
    /// the CV, and it arrives as a **negative offset from full depth**: knob
    /// 1.0 is 0 V (duck all the way), knob 0.0 is −5 V (do not duck at all).
    ///
    /// Passing the raw 0..1 knob instead would have run the parameter from
    /// 1.0 to 1.2 and clamped — a control that is at full depth across its
    /// entire travel and reviews as correct because the cable is there.
    pub fn duck_amount(x: f64) -> f64 {
        (x - DUCK_AMOUNT_BASE) * PARAM_CV_FULL_SCALE_V
    }
    /// Detector level, in volts, for a dynamics threshold knob — **geometric**
    /// over 0.05–5 V rather than linear over 0–5 V.
    ///
    /// Every one of quiver's three dynamics modules reads its threshold as a
    /// straight `cv · 5` volts against a smoothed `|x|` detector, and passing
    /// the raw knob through would have been the wave-2A eq bug in reverse: not
    /// a control that is too small to hear, but one whose entire useful range
    /// is squeezed into the bottom tenth of its travel.
    ///
    /// The reason is that this instrument's sources are nowhere near a common
    /// level. Measured as mean `|x|` on a held note through the voice tail: a
    /// sine vco is 3.18 V, a supersaw ≈0.6 V, and a **plucked string 0.14 V** —
    /// 27 dB below the vco, and the pluck is precisely what a gate or a ducker
    /// is most often keyed from. A linear 0–5 V knob puts every source but the
    /// oscillators under knob position 0.1; the default gate threshold of 0.35
    /// measured as 1.75 V, which no key in the palette ever reaches, so the
    /// gate sat shut for the whole note and read as a fixed −10 dB pad.
    ///
    /// 0.05–5 V is 40 dB, which covers that spread with the midpoint (0.5 V)
    /// between a supersaw and a pluck. Geometric, because level is.
    fn detector_volts(x: f64) -> f64 {
        DETECT_MIN_V * (DETECT_MAX_V / DETECT_MIN_V).powf(x.clamp(0.0, 1.0))
    }
    /// [`detector_volts`] on the compressor's and gate's plain CV ports, which
    /// quiver reads as `clamp(cv, 0, 1) · 5` volts.
    pub fn detector_threshold(x: f64) -> f64 {
        detector_volts(x) / PARAM_CV_FULL_SCALE_V
    }
    /// [`detector_volts`] on the ducker's `ModulatedParam` port.
    ///
    /// Same shape as [`duck_amount`] — the knob arrives as an offset from
    /// quiver's own base — but the range is `Linear{0, 5}` **volts** of key
    /// level, so the port resolves to `(0.2 + cv/5)·5 = 1 + cv` volts and the
    /// knob is the wanted level minus one.
    pub fn duck_threshold(x: f64) -> f64 {
        detector_volts(x) - DUCK_THRESHOLD_BASE * PARAM_CV_FULL_SCALE_V
    }
    /// Attenuverter level, in volts, for a destination whose full modulation
    /// excursion is `peak` volts, driven by a **±5 V** source.
    ///
    /// The attenuverter's gain is `level / 5`, so a ±5 V source arrives at
    /// `±level` volts: the level *is* the peak excursion.
    fn mod_level_bipolar(peak: f64, x: f64) -> f64 {
        peak * x
    }
    /// The same, driven by a **0–10 V** source (the mod envelope and the
    /// follower). Half the level for the same peak excursion, so both source
    /// families reach the same depth at the same knob position.
    fn mod_level_unipolar(peak: f64, x: f64) -> f64 {
        peak * x * 0.5
    }
    /// Peak excursion for a **normalized 0..1** destination port: half of full
    /// scale at knob 1.0.
    const PEAK_NORMALIZED: f64 = 0.5;
    /// Peak excursion for the **pitch [`Offset`]**, in volts — which on a
    /// V/Oct summing input is numerically octaves, so knob 1.0 is ±0.5 octave.
    const PEAK_PITCH: f64 = 0.5;
    /// Peak excursion for a **±5 V gain** port: the whole port, i.e. ±12 dB at
    /// knob 1.0.
    const PEAK_GAIN: f64 = 5.0;
    /// Half of the pitch shifter's `shift` port, in volts — the same half the
    /// knob gets (see [`semitones`]), so knob and cable each own one octave
    /// and their sum lands on quiver's ±24-semitone clamp rather than through
    /// it.
    pub(super) const SHIFT_PEAK_V: f64 = 2.5;
    /// Volts of CV that move a [`ModulatedParam`](quiver::prelude::ModulatedParam)
    /// across its whole normalized range — quiver's
    /// `ModulatedParam::CV_FULL_SCALE_VOLTS`.
    pub(super) const PARAM_CV_FULL_SCALE_V: f64 = 5.0;
    /// `Ducker::new`'s `amount` knob base. The CV port offsets *this*.
    pub(super) const DUCK_AMOUNT_BASE: f64 = 1.0;
    /// `Ducker::new`'s `threshold` knob base, on its 0–5 V range.
    pub(super) const DUCK_THRESHOLD_BASE: f64 = 0.2;
    /// Quietest detector level a dynamics threshold knob can ask for, in
    /// volts. Under a plucked string's own envelope, so knob 0 is "trigger on
    /// anything" for every source in the palette.
    pub(super) const DETECT_MIN_V: f64 = 0.05;
    /// Loudest — the nominal full scale of quiver audio, so knob 1 is
    /// "trigger on nothing short of a bare oscillator".
    pub(super) const DETECT_MAX_V: f64 = 5.0;
    /// Peak excursion for a `ModulatedParam` port: half of the parameter's
    /// full normalized range, matching [`PEAK_NORMALIZED`]'s convention — but
    /// **ten times its volts**, because on this port a normalized unit costs
    /// 5 V rather than 1. Getting that wrong is the eq's ±1.2 dB bug again,
    /// with the ducker's depth knob doing nothing across its whole travel.
    const PEAK_PARAM_CV: f64 = 2.5;
    /// Peak excursion for a **dynamics threshold** port, in the port's own
    /// 0..1 CV units — 0.1, i.e. ±0.5 V of detector level. A tenth of full
    /// scale rather than a half, for the reason on [`mod_depth_detector`].
    const PEAK_DETECTOR: f64 = 0.1;
    /// Modulation depth for a ±5 V source (LFO, S&H), expressed as an
    /// [`quiver::modules::Attenuverter`] level in volts (its gain is
    /// `level / 5`), so knob 1.0 = ±5 octaves of cutoff.
    ///
    /// Every destination this taper reaches is *normalized*, not volt-scaled,
    /// which is what makes one curve serve all of them: `Svf.fm` sums straight
    /// into a 0..1 cutoff CV whose full span is 20 Hz–20 kHz (~10 octaves),
    /// `Wavefolder.threshold` lives in 0.1..1, and the palette's other slots —
    /// `Wavetable.morph`, `KarplusStrong.damping`, `Distortion.drive`,
    /// `Bitcrusher.bits`, `Chorus.depth`, `Reverb.size`, `Phaser.depth`,
    /// `Flanger.depth`, `Tremolo.depth`, `Vibrato.depth`, `FormantOsc.vowel`,
    /// `Granular.position` — are all 0..1 CVs on the same convention. A raw
    /// ±5 V cable is ~5× full scale, so every knob position above ~0.2 only
    /// clipped the modulator harder into a square wave — 97% of the travel did
    /// nothing.
    ///
    /// The two destinations that are *not* normalized get their own tapers
    /// ([`mod_depth_pitch`], [`mod_depth_gain`]) rather than borrowing this
    /// one, because "half of full scale" means a different number of volts on
    /// each of them.
    ///
    /// `DelayLine.time` is the one destination whose port is 0..1 but whose
    /// *musical* range is exponential (1 ms · 2000^cv), so a given depth buys
    /// far more motion there than anywhere else. That is the classic tape-wow
    /// gesture rather than a defect, but it is the slot to look at first if a
    /// dedicated taper is ever wanted.
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
        mod_level_bipolar(PEAK_NORMALIZED, x)
    }
    /// Modulation depth for a 0–10 V source (the mod envelope, the follower).
    /// Half the bipolar scale, so both source families reach the same depth at
    /// the same knob position.
    pub fn mod_depth_unipolar(x: f64) -> f64 {
        mod_level_unipolar(PEAK_NORMALIZED, x)
    }
    /// Modulation depth for a ±5 V source landing on the **pitch**
    /// [`Offset`]'s summing input.
    ///
    /// That input is V/Oct and the attenuverter's gain is `level / 5`, so a
    /// ±5 V source arrives at `±level` **volts** — and on a V/Oct wire a volt
    /// is an octave. The level is therefore numerically the octave depth, and
    /// knob 1.0 gives **±0.5 octave** (±6 semitones).
    ///
    /// That ceiling is a deliberate compromise and reads as one on the knob: a
    /// musical vibrato is ±50 cents, which sits at ~8% of the sweep — a small
    /// corner to dial in. Capping tighter would make that corner usable and
    /// put the other pitch-mod idiom, a mod envelope dropping a note in from
    /// several semitones above, out of reach entirely. Six semitones covers
    /// both; the vibrato end is fiddly and the alternative was not having it.
    ///
    /// Linear rather than square-law for the reason documented at length on
    /// [`mod_depth_bipolar`] — the grammar draws `mod_depth ~ U(0,1)`, so the
    /// curve here is an evolutionary prior and not only a knob feel.
    ///
    /// It currently evaluates to the same number as [`mod_depth_bipolar`],
    /// which is a coincidence of two peaks both being 0.5 and not a shared
    /// derivation: one is half of a normalized port's full scale, the other is
    /// half an octave. They are two names so that retuning either cannot
    /// silently move the other.
    pub fn mod_depth_pitch(x: f64) -> f64 {
        mod_level_bipolar(PEAK_PITCH, x)
    }
    /// [`mod_depth_pitch`] for a 0–10 V source: an envelope reaching the same
    /// ±0.5 octave at the same knob position, as one-sided motion.
    pub fn mod_depth_pitch_unipolar(x: f64) -> f64 {
        mod_level_unipolar(PEAK_PITCH, x)
    }
    /// Modulation depth for a ±5 V source landing on a **±5 V gain** port
    /// (the EQ's three bands).
    ///
    /// Ten times [`mod_depth_bipolar`], and it has to be: the destination is
    /// volt-scaled, not normalized. quiver reads the band as `cv/5 · 12` dB,
    /// so the normalized taper's ±0.5 V would be ±1.2 dB at *full* depth —
    /// around the level JND, i.e. a mod slot that does nothing across its
    /// whole travel. This reaches the port's own ±5 V, so knob 1.0 is a
    /// ±12 dB pump on the mid band and the bottom of the sweep is where the
    /// subtle settings live.
    pub fn mod_depth_gain(x: f64) -> f64 {
        mod_level_bipolar(PEAK_GAIN, x)
    }
    /// [`mod_depth_gain`] for a 0–10 V source.
    pub fn mod_depth_gain_unipolar(x: f64) -> f64 {
        mod_level_unipolar(PEAK_GAIN, x)
    }
    /// Modulation depth for a ±5 V source landing on the pitch shifter's
    /// **semitone** port.
    ///
    /// Five times [`mod_depth_bipolar`], because the destination is
    /// volt-scaled: quiver reads the port as `cv/5 · 24` semitones, so the
    /// normalized taper's ±0.5 V would be ±2.4 semitones at *full* depth —
    /// dialable, but it would put the module's whole reason for existing (a
    /// modulated harmony line, a warble that crosses a semitone) in the top
    /// fifth of the knob. This reaches [`SHIFT_PEAK_V`], the same half of the
    /// port the knob owns, so full depth is ±12 semitones and the classic
    /// slow detune-warble sits around 0.05 rather than under 0.01.
    pub fn mod_depth_shift(x: f64) -> f64 {
        mod_level_bipolar(SHIFT_PEAK_V, x)
    }
    /// [`mod_depth_shift`] for a 0–10 V source (a mod envelope sweeping a
    /// note in from up to an octave away, one-sided).
    pub fn mod_depth_shift_unipolar(x: f64) -> f64 {
        mod_level_unipolar(SHIFT_PEAK_V, x)
    }
    /// Modulation depth for a ±5 V source landing on a `ModulatedParam`
    /// knob+CV port (the ducker's `amount`).
    ///
    /// The parameter is normalized 0..1 like every `DepthScale::Normalized`
    /// destination, but it is *reached* in volts on a ±5 V scale, so the same
    /// musical depth costs ten times the attenuverter level. Full depth is
    /// ±0.5 of the duck amount — half the parameter, matching
    /// [`PEAK_NORMALIZED`]'s "half of full scale" everywhere else.
    pub fn mod_depth_param_cv(x: f64) -> f64 {
        mod_level_bipolar(PEAK_PARAM_CV, x)
    }
    /// [`mod_depth_param_cv`] for a 0–10 V source.
    pub fn mod_depth_param_cv_unipolar(x: f64) -> f64 {
        mod_level_unipolar(PEAK_PARAM_CV, x)
    }
    /// Modulation depth for a ±5 V source landing on a **dynamics threshold**
    /// port (the compressor's and the gate's).
    ///
    /// The one destination where "half of full scale" is the wrong answer in
    /// the *other* direction. The port spans 0..1 for 0..5 V, but the knob
    /// reads it geometrically (see [`detector_volts`]) and the settings that
    /// matter live between 0.05 V and 1 V — so the normalized taper's ±0.5 in
    /// CV, i.e. ±2.5 V, would hold the threshold pinned at one rail or the
    /// other for most of every cycle and the module would simply switch on and
    /// off. [`PEAK_DETECTOR`] is ±0.5 V instead: around a typical setting that
    /// is a full sweep from "always open" to a dozen dB above the key, and the
    /// bottom of the knob buys the few-dB movement that reads as breathing.
    pub fn mod_depth_detector(x: f64) -> f64 {
        mod_level_bipolar(PEAK_DETECTOR, x)
    }
    /// [`mod_depth_detector`] for a 0–10 V source.
    pub fn mod_depth_detector_unipolar(x: f64) -> f64 {
        mod_level_unipolar(PEAK_DETECTOR, x)
    }
    /// Tempo for a [`quiver::modules::Clock`], which drives the euclidean
    /// generator and the sample-and-hold op.
    ///
    /// The `bpm` port is `CvUnipolar`, and quiver's `voltage_range` for that
    /// kind is **0–10 V, not 0–1**: `cv_to_bpm` is `20 · 15^(cv/10)`, so the
    /// raw 0..1 knob would have spanned 20 BPM to 21.4 BPM — a rate control
    /// with a 7% range, which is the class of defect this file has now found
    /// four times. `10·x` spans the port's real 20–300 BPM, i.e. 0.33–5 Hz of
    /// clock, which is the rhythmic band a five-second phrase can show.
    pub fn clock_rate(x: f64) -> f64 {
        x.clamp(0.0, 1.0) * CLOCK_CV_FULL_SCALE_V
    }
    /// Volts of `bpm` CV that reach the top of quiver's tempo map.
    const CLOCK_CV_FULL_SCALE_V: f64 = 10.0;
    /// Euclidean step count: quiver's `2 + (cv·14.99)` restricted to **4..16**
    /// rather than 2..16.
    ///
    /// The two shortest patterns are dropped because they are what makes the
    /// density knob below un-mappable, not because a two-step rhythm is
    /// uninteresting: a pattern of two can hold either one pulse or two, and a
    /// density floor low enough to keep a 1-of-16 rhythm reachable rounds to
    /// *zero* pulses there. Four is the shortest count at which one CV floor
    /// serves the whole range, and a 4-step pattern is still a bar of four.
    pub fn euclid_steps(x: f64) -> f64 {
        0.14 + 0.86 * x.clamp(0.0, 1.0)
    }
    /// Euclidean pulse density, bounded off both degenerate ends **at every
    /// step count**.
    ///
    /// quiver takes `pulses = (cv · steps) as usize`, so a raw knob has two
    /// dead corners the grammar would otherwise draw: below `1/steps` the
    /// pattern has no pulses at all and the cable carries a constant 0 V, and
    /// at exactly 1.0 every step fires and it carries a constant 5 V. The
    /// first is not a rounding corner — with steps uniform over the range it
    /// is about one draw in seven.
    ///
    /// The floor is `1/4`, the reciprocal of [`euclid_steps`]'s coarsest
    /// count, so a pulse survives however few steps there are; the ceiling
    /// leaves at least one rest for the same reason at the other end. Between
    /// them every setting is a rhythm at every step count: 1..3 of four,
    /// 4..15 of sixteen.
    pub fn euclid_pulses(x: f64) -> f64 {
        0.25 + 0.74 * x.clamp(0.0, 1.0)
    }
    /// Slew time for a [`quiver::modules::SlewLimiter`] `rise`/`fall` port.
    ///
    /// quiver's own map is `0.001 + cv²·10` seconds, which is already
    /// square-law — so the musically useful glide times (10 ms to ~1.5 s) all
    /// live below cv 0.39 and a raw knob would spend three fifths of its
    /// travel freezing the modulator solid. `0.4·x` puts the whole range on
    /// the plate: full travel is a 1.6 s glide and a uniform draw averages
    /// ≈0.4 s, which reads as portamento rather than as a mute.
    ///
    /// [`crate::term::ModNode::Rand`]'s own `glide` knob keeps the raw map it
    /// shipped with — it is a saved-patch parameter, and re-tapering it would
    /// change how every existing S&H sounds.
    pub fn slew_time(x: f64) -> f64 {
        SLEW_MAX_CV * x.clamp(0.0, 1.0)
    }
    /// Top of the slew knob, on quiver's `0.001 + cv²·10` s map — 1.6 s.
    const SLEW_MAX_CV: f64 = 0.4;
    /// Detune: ±50 cents expressed in V/Oct.
    pub fn detune_voct(x: f64) -> f64 {
        (x * 2.0 - 1.0) * (50.0 / 1200.0)
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
        self.knob_to(key, site, raw, pmap, bipolar, &[target])
    }

    /// [`Self::knob`] with the same atomic cabled to several ports.
    ///
    /// One trace site must stay one knob: the S&H glide drives a
    /// [`SlewLimiter`]'s `rise` *and* `fall`, and adding a second
    /// [`Self::knob`] for the second port would register a second node under
    /// the same name and silently overwrite the first's [`ParamHandle`] — the
    /// handle the panel then drags would move only half the module.
    fn knob_to(
        &mut self,
        key: &str,
        site: &str,
        raw: f64,
        pmap: ParamMap,
        bipolar: bool,
        targets: &[PortRef],
    ) -> Result<(), PatchError> {
        let value = Arc::new(AtomicF64::new(pmap.apply(raw)));
        let input = if bipolar {
            ExternalInput::cv_bipolar(Arc::clone(&value))
        } else {
            ExternalInput::cv(Arc::clone(&value))
        };
        let n = self.patch.add(format!("{key}:{site}!"), input);
        for target in targets {
            self.patch.connect(n.out("out"), *target)?;
        }
        self.params
            .insert(format!("{key}#{site}"), ParamHandle { value, map: pmap });
        Ok(())
    }

    /// Wire a modulation term into `target`. `ModNode::None` wires nothing.
    ///
    /// `owner` is the *modulated* module — that is where `describe.rs`
    /// advertises the `#mdepth` knob, and the mod source's own nodes and knobs
    /// hang off `<owner>/m` (`node/m:lfo`, `node/m#rate`). The slot key is
    /// derived here rather than passed in: it is `<owner>/m` at every call
    /// site, and a hand-built key that disagrees with `owner` would put the
    /// depth knob on one module and the LFO's knobs under another.
    ///
    /// The depth is an [`Attenuverter`] driven by a real [`Self::knob`], not a
    /// baked-in cable attenuation. Turning it used to require a full
    /// recompile — a 6 ms fade-out, per-quantum voice rebuild and fade-in for
    /// the length of the drag, while every neighbouring knob swept
    /// continuously.
    ///
    /// `owner_input` is the signal the owning module is *about to process*,
    /// tapped before it enters. Only [`ModNode::Follow`] reads it, and it is
    /// `None` exactly where there is nothing to tap — a source's own mod slot
    /// (a wavetable or a pluck generates its input rather than receiving
    /// one). That case wires no modulation at all rather than failing: the
    /// grammar and the panel can both express "follower on an oscillator",
    /// and the honest compilation of it is silence on that cable, not a
    /// refusal to compile a term the prior can draw.
    ///
    /// `scale` says what kind of port `target` is. The source's polarity is
    /// decided here, but "how many volts is full depth" is a property of the
    /// destination, and the two together pick the taper — see [`DepthScale`].
    fn wire_mod(
        &mut self,
        m: &ModNode,
        owner: &str,
        depth: f64,
        target: PortRef,
        owner_input: Option<Sig>,
        scale: DepthScale,
    ) -> Result<(), PatchError> {
        let key = &format!("{owner}/m");
        let Some((src, unipolar)) = self.build_mod(m, key, owner_input)? else {
            return Ok(());
        };
        let att = self.patch.add(format!("{key}:depth"), Attenuverter::new());
        self.patch.connect(src, att.in_("in"))?;
        self.knob(
            owner,
            "mdepth",
            depth,
            scale.taper(unipolar),
            true,
            att.in_("level"),
        )?;
        self.patch.connect(att.out("out"), target)?;
        Ok(())
    }

    /// Build a modulation term and return `(its output port, whether it swings
    /// 0–10 V rather than ±5 V)`, or `None` for a term that produces nothing.
    ///
    /// This is the recursion [`ModNode`] gained when modulation became a sort:
    /// [`ModNode::Op`] builds its subterm first and processes it,
    /// [`ModNode::Pair`] builds two. Subterm keys follow the audio tree's
    /// convention — `<key>/0` and `<key>/1` — which never collides with an
    /// audio node's, because every modulation key sits under a `/m`.
    ///
    /// # The polarity flag is a *scale* claim, not a sign claim
    ///
    /// It selects between [`map::mod_level_bipolar`]'s "a ±5 V source arrives
    /// at ±level" and [`map::mod_level_unipolar`]'s halving for an 0–10 V one,
    /// so what it really asks is **"can this term reach 10 V?"**. A gate
    /// reaches 5, so `Euclid` and the logic ops answer *no* even though they
    /// never go negative — answering yes would halve their depth for nothing.
    /// The shapers pass their subterm's answer through, because none of them
    /// changes the magnitude scale: rectifying ±5 V gives 0–5 V, which is
    /// still a signal whose extreme is 5 V.
    fn build_mod(
        &mut self,
        m: &ModNode,
        key: &str,
        owner_input: Option<Sig>,
    ) -> Result<Option<(PortRef, bool)>, PatchError> {
        let built = match m {
            ModNode::None => return Ok(None),
            ModNode::Lfo { wave, rate, .. } => {
                let lfo = self.patch.add(format!("{key}:lfo"), Lfo::new(self.sr()));
                self.knob(key, "rate", *rate, ParamMap::Unit, false, lfo.in_("rate"))?;
                (lfo.out(wave.port_name()), false)
            }
            ModNode::Rand { rate, glide, .. } => {
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
                // Glide turns the same source into two different modulators:
                // at 0 it is the stepped burble, and as it opens the steps
                // become a smooth random walk — the classic sample-and-glide.
                // Symmetric (one knob into both `rise` and `fall`) because an
                // asymmetric slew on a random signal reads as a *shape*, not
                // as glide, and that is a second timbral choice this module
                // has no faceplate room to offer.
                let slew = self
                    .patch
                    .add(format!("{key}:glide"), SlewLimiter::new(self.sr()));
                self.patch.connect(snh.out("out"), slew.in_("in"))?;
                self.knob_to(
                    key,
                    "glide",
                    *glide,
                    ParamMap::Unit,
                    false,
                    &[slew.in_("rise"), slew.in_("fall")],
                )?;
                (slew.out("out"), false)
            }
            ModNode::Follow { sens, release, .. } => {
                // The tap is the owning module's *own* input, taken before it
                // enters — so the follower measures what the module is about
                // to process rather than what it produced, which would be a
                // feedback loop through the parameter it drives.
                let Some(input) = owner_input else {
                    return Ok(None);
                };
                let f = self
                    .patch
                    .add(format!("{key}:follow"), EnvelopeFollower::new(self.sr()));
                self.feed(input, f.in_("in"))?;
                self.knob(key, "sens", *sens, ParamMap::Unit, false, f.in_("gain"))?;
                self.knob(
                    key,
                    "rel",
                    *release,
                    ParamMap::Unit,
                    false,
                    f.in_("release"),
                )?;
                self.constant(FOLLOW_ATTACK, f.id(), "attack")?;
                // 0–10 V detector output, so it shares the mod envelope's
                // taper rather than the bipolar one.
                (f.out("out"), true)
            }
            ModNode::Env { attack, decay, .. } => {
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
                (env.out("env"), true)
            }
            ModNode::Euclid {
                rate,
                steps,
                pulses,
                ..
            } => {
                let clk = self.patch.add(format!("{key}:eclk"), Clock::new(self.sr()));
                self.knob(
                    key,
                    "erate",
                    *rate,
                    ParamMap::ClockRate,
                    false,
                    clk.in_("bpm"),
                )?;
                let eu = self
                    .patch
                    .add(format!("{key}:euclid"), Euclidean::new(self.sr()));
                self.patch.connect(clk.out("out"), eu.in_("clock"))?;
                self.knob(
                    key,
                    "esteps",
                    *steps,
                    ParamMap::EuclidSteps,
                    false,
                    eu.in_("steps"),
                )?;
                self.knob(
                    key,
                    "epulses",
                    *pulses,
                    ParamMap::EuclidPulses,
                    false,
                    eu.in_("pulses"),
                )?;
                self.constant(EUCLID_ROTATION, eu.id(), "rotation")?;
                // `reset` stays unpatched: quiver's gather writes the port's
                // own 0 V default, and the pattern is already re-armed by its
                // own step counter wrapping. A reset cable would need a
                // per-note trigger, and a euclidean pattern that restarts on
                // every note is a fixed rhythm rather than a running one.
                //
                // The sample-and-hold is what turns the pattern into a
                // **gate**. quiver's `Euclidean` emits a `Trigger`, and its
                // implementation takes that literally: `out` is `GATE_HIGH_V`
                // on the single sample the clock's edge lands on and 0 V for
                // every other sample of the step. One sample in two thousand
                // is inaudible on any destination in this grammar — it is a
                // modulator that measures as a dead cable — so the pattern is
                // latched on the same clock that produced it. Holding it
                // stretches each hit across its whole step, which makes the
                // duty cycle `pulses/steps` and the output a real rhythm.
                //
                // Both modules are edge-triggered from the same clock and the
                // hold reads the generator, so quiver's topological order
                // evaluates the pattern first and the latch sees the fresh
                // step rather than the previous one.
                let gate = self.patch.add(format!("{key}:egate"), SampleAndHold::new());
                self.patch.connect(eu.out("out"), gate.in_("in"))?;
                self.patch.connect(clk.out("out"), gate.in_("trig"))?;
                (gate.out("out"), false)
            }
            ModNode::Op {
                kind,
                p0,
                p1,
                input,
                ..
            } => {
                let Some((src, unipolar)) =
                    self.build_mod(input, &format!("{key}/0"), owner_input)?
                else {
                    return Ok(None);
                };
                self.build_mod_op(*kind, *p0, *p1, key, src, unipolar)?
            }
            ModNode::Pair { kind, a, b, .. } => {
                let (a, b) = (
                    self.build_mod(a, &format!("{key}/0"), owner_input)?,
                    self.build_mod(b, &format!("{key}/1"), owner_input)?,
                );
                // A branch that produced nothing collapses to the other one
                // rather than to a constant, matching
                // [`ModNode::normalized`]. In practice only a `Follow` on a
                // source can get here — every other empty branch was already
                // folded away — and the honest compilation of "follow an
                // oscillator" is the rest of the term, not silence.
                match (a, b) {
                    (None, None) => return Ok(None),
                    (Some(x), None) | (None, Some(x)) => x,
                    (Some(a), Some(b)) => self.build_mod_pair(*kind, key, a, b)?,
                }
            }
        };
        Ok(Some(built))
    }

    /// One [`ModOp`] over an already-built modulation signal.
    fn build_mod_op(
        &mut self,
        kind: ModOp,
        p0: f64,
        p1: f64,
        key: &str,
        src: PortRef,
        unipolar: bool,
    ) -> Result<(PortRef, bool), PatchError> {
        Ok(match kind {
            ModOp::Quantize => {
                // Scale into the quantizer's grid and back out again — see
                // [`QUANTIZE_IN_LEVEL`], which is where the whole musical
                // argument for this module lives.
                let a_in = self.patch.add(format!("{key}:qin"), Attenuverter::new());
                self.patch.connect(src, a_in.in_("in"))?;
                self.constant(QUANTIZE_IN_LEVEL, a_in.id(), "level")?;
                let q = self
                    .patch
                    .add(format!("{key}:quant"), ScaleQuantizer::new(self.sr()));
                self.patch.connect(a_in.out("out"), q.in_("in"))?;
                self.knob(key, "qroot", p0, ParamMap::Unit, false, q.in_("root"))?;
                // Straight through: quiver's own `(cv·6.99) as u8` is the
                // seven-way selector, so the knob *is* the categorical and
                // `crate::term::quant_scale_index` reads it the same way.
                self.knob(key, "qscale", p1, ParamMap::Unit, false, q.in_("scale"))?;
                let a_out = self.patch.add(format!("{key}:qout"), Attenuverter::new());
                self.patch.connect(q.out("out"), a_out.in_("in"))?;
                self.constant(QUANTIZE_OUT_LEVEL, a_out.id(), "level")?;
                (a_out.out("out"), unipolar)
            }
            ModOp::Slew => {
                let s = self
                    .patch
                    .add(format!("{key}:slew"), SlewLimiter::new(self.sr()));
                self.patch.connect(src, s.in_("in"))?;
                self.knob(key, "rise", p0, ParamMap::SlewTime, false, s.in_("rise"))?;
                self.knob(key, "fall", p1, ParamMap::SlewTime, false, s.in_("fall"))?;
                (s.out("out"), unipolar)
            }
            ModOp::Rectify => {
                let r = self.patch.add(format!("{key}:rect"), Rectifier::new());
                self.patch.connect(src, r.in_("in"))?;
                // `mode` is a choice of output *port*, not a CV: quiver's
                // `Rectifier` publishes all three at once and has no mode
                // input at all. The knob therefore picks a cable, and the
                // register of what it picked lives in the plate label.
                //
                // On a source that never goes negative — a mod envelope, a
                // follower, a euclidean gate — `full` and `positive` are both
                // the identity and `negative` is silence. That is a real dead
                // corner and it is left visible rather than special-cased:
                // rectification is a statement about a *bipolar* signal, and
                // hiding the fact that it says nothing about a unipolar one
                // would make the knob lie in the other direction.
                //
                // No [`Self::knob`] and so no [`ParamHandle`]: like every
                // other enum site in this grammar, turning it is a structural
                // change and the host has to recompile (`live::set_param`
                // returns false and the panel calls `set_patch`). Registering
                // a handle nothing reads would be a knob that drags smoothly
                // and never changes the sound.
                let port = match rect_mode_index(p0) {
                    0 => "full",
                    1 => "half_pos",
                    _ => "half_neg",
                };
                (r.out(port), unipolar)
            }
            ModOp::Hold => {
                let clk = self.patch.add(format!("{key}:hclk"), Clock::new(self.sr()));
                self.knob(key, "hrate", p0, ParamMap::ClockRate, false, clk.in_("bpm"))?;
                let snh = self.patch.add(format!("{key}:hold"), SampleAndHold::new());
                self.patch.connect(src, snh.in_("in"))?;
                self.patch.connect(clk.out("out"), snh.in_("trig"))?;
                (snh.out("out"), unipolar)
            }
        })
    }

    /// One [`PairOp`] over two already-built modulation signals.
    fn build_mod_pair(
        &mut self,
        kind: PairOp,
        key: &str,
        a: (PortRef, bool),
        b: (PortRef, bool),
    ) -> Result<(PortRef, bool), PatchError> {
        // Min, max and the switch hand back one of their inputs, so the pair
        // can reach 10 V if either branch can. The logic gates emit a 5 V gate
        // whatever they were fed.
        let unipolar = a.1 || b.1;
        Ok(match kind {
            PairOp::Min => {
                let n = self.patch.add(format!("{key}:min"), Min::new());
                self.patch.connect(a.0, n.in_("a"))?;
                self.patch.connect(b.0, n.in_("b"))?;
                (n.out("out"), unipolar)
            }
            PairOp::Max => {
                let n = self.patch.add(format!("{key}:max"), Max::new());
                self.patch.connect(a.0, n.in_("a"))?;
                self.patch.connect(b.0, n.in_("b"))?;
                (n.out("out"), unipolar)
            }
            PairOp::And => {
                let n = self.patch.add(format!("{key}:and"), LogicAnd::new());
                self.patch.connect(a.0, n.in_("a"))?;
                self.patch.connect(b.0, n.in_("b"))?;
                (n.out("out"), false)
            }
            PairOp::Or => {
                let n = self.patch.add(format!("{key}:or"), LogicOr::new());
                self.patch.connect(a.0, n.in_("a"))?;
                self.patch.connect(b.0, n.in_("b"))?;
                (n.out("out"), false)
            }
            PairOp::Xor => {
                let n = self.patch.add(format!("{key}:xor"), LogicXor::new());
                self.patch.connect(a.0, n.in_("a"))?;
                self.patch.connect(b.0, n.in_("b"))?;
                (n.out("out"), false)
            }
            PairOp::Switch => {
                // quiver's `VcSwitch` needs a *third* input to choose with,
                // and `Pair` has only two branches to offer. The contract
                // proposed the voice gate; that is wrong, and measurably so:
                // the gate is high for the whole of every note and low only
                // between notes, when the VCA is shut — so `b` would be
                // selected for every sample anybody hears and the `a` branch
                // would be a module on the rack that is never once audible.
                //
                // `b` is its own control instead: the switch passes `b` while
                // `b` is above the 2.5 V gate threshold and `a` the rest of
                // the time. That makes `Switch(pad, euclid)` "punch this
                // rhythm in over that modulator", which is what the module is
                // for, and every branch is heard.
                let n = self.patch.add(format!("{key}:sw"), VcSwitch::new());
                self.patch.connect(a.0, n.in_("a"))?;
                self.patch.connect(b.0, n.in_("b"))?;
                self.patch.connect(b.0, n.in_("cv"))?;
                (n.out("out"), unipolar)
            }
        })
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
    ///
    /// Returns the [`Offset`]'s own `in` port — the grammar's one **pitch
    /// modulation** site. quiver's gather sums every cable into a patched
    /// input, so a second cable here adds to the incoming keyboard CV rather
    /// than replacing it, which is precisely why this stage is a real node and
    /// not a baked default (see [`Self::constant`]). A volt on that wire is an
    /// octave, so what arrives is transposition: vibrato, or a pitch envelope.
    fn wire_pitch(
        &mut self,
        key: &str,
        octave: i8,
        detune: f64,
        target: PortRef,
    ) -> Result<PortRef, PatchError> {
        let offset = octave as f64 + map::detune_voct(detune);
        let node = self.patch.add(format!("{key}:pitch"), Offset::new(offset));
        self.patch.connect(self.pitch_out, node.in_("in"))?;
        self.patch.connect(node.out("out"), target)?;
        Ok(node.in_("in"))
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
                mod_depth,
                modulation,
                ..
            } => {
                let vco = self.patch.add(format!("{key}:vco"), Vco::new(self.sr()));
                let pitch_in = self.wire_pitch(key, *octave, *detune, vco.in_("voct"))?;
                // The mod cable joins the keyboard CV at the pitch offset, not
                // at the oscillator: everything downstream of the summing node
                // sees one V/Oct signal, so vibrato and transposition are the
                // same mechanism and cannot disagree.
                self.wire_mod(
                    modulation,
                    key,
                    *mod_depth,
                    pitch_in,
                    // A source generates its own input, so there is nothing
                    // for a follower to tap — as on the wavetable and pluck.
                    None,
                    DepthScale::Pitch,
                )?;
                Ok(Sig::mono(vco.out(wave.port_name())))
            }
            AudioNode::Supersaw {
                octave,
                detune,
                mix,
                mod_depth,
                modulation,
                ..
            } => {
                let saw = self
                    .patch
                    .add(format!("{key}:supersaw"), Supersaw::new(self.sr()));
                let pitch_in = self.wire_pitch(key, *octave, 0.5, saw.in_("voct"))?;
                self.wire_mod(
                    modulation,
                    key,
                    *mod_depth,
                    pitch_in,
                    None,
                    DepthScale::Pitch,
                )?;
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
            AudioNode::Noise { color, .. } => {
                let noise = self
                    .patch
                    .add(format!("{key}:noise"), NoiseGenerator::new());
                Ok(Sig::mono(noise.out(color.port_name())))
            }
            AudioNode::Wavetable {
                table,
                octave,
                morph,
                mod_depth,
                modulation,
                ..
            } => {
                let wt = self
                    .patch
                    .add(format!("{key}:wavetable"), Wavetable::new(self.sr()));
                // Detune 0.5 is the no-offset centre of `map::detune_voct`:
                // this module has no detune site, but pitch still goes
                // through the same Offset every other source uses.
                self.wire_pitch(key, *octave, 0.5, wt.in_("v_oct"))?;
                // The table is an enum site, not a knob — changing it is a
                // recompile either way — so it is a baked default rather than
                // an `ExternalInput`.
                self.constant(map::table_cv(table.index()), wt.id(), "table")?;
                // No hard sync: the grammar has no second oscillator to sync
                // *to*, and quiver retriggers phase on any positive edge, so
                // an unpinned Gate-kind port would be one stray cable away
                // from turning the oscillator into a buzz.
                self.constant(0.0, wt.id(), "sync")?;
                self.knob(key, "morph", *morph, ParamMap::Unit, false, wt.in_("morph"))?;
                self.wire_mod(
                    modulation,
                    key,
                    *mod_depth,
                    wt.in_("morph"),
                    None,
                    DepthScale::Normalized,
                )?;
                Ok(Sig::mono(wt.out("out")))
            }
            AudioNode::Pluck {
                octave,
                damping,
                brightness,
                mod_depth,
                modulation,
                ..
            } => {
                let ks = self
                    .patch
                    .add(format!("{key}:pluck"), KarplusStrong::new(self.sr()));
                self.wire_pitch(key, *octave, 0.5, ks.in_("voct"))?;
                // The note gate is the pluck. quiver edge-detects it, so a
                // held note excites the string exactly once and then rings —
                // which is why this source ignores the amp envelope's sustain
                // in a way no other source does.
                self.patch.connect(self.gate_out, ks.in_("trigger"))?;
                self.knob(
                    key,
                    "damp",
                    *damping,
                    ParamMap::Unit,
                    false,
                    ks.in_("damping"),
                )?;
                self.knob(
                    key,
                    "bright",
                    *brightness,
                    ParamMap::Unit,
                    false,
                    ks.in_("brightness"),
                )?;
                // No inharmonicity. `stretch` detunes the string's partials
                // away from the harmonic series, and quiver applies it as a
                // one-pole allpass inside the feedback loop, so it also moves
                // the pitch — a fifth knob that makes the module play out of
                // tune is not the fifth knob to have.
                self.constant(0.0, ks.id(), "stretch")?;
                self.wire_mod(
                    modulation,
                    key,
                    *mod_depth,
                    ks.in_("damping"),
                    None,
                    DepthScale::Normalized,
                )?;
                Ok(Sig::mono(ks.out("out")))
            }
            AudioNode::Formant {
                vowel,
                shift,
                octave,
                mod_depth,
                modulation,
                ..
            } => {
                let fo = self
                    .patch
                    .add(format!("{key}:formant"), FormantOsc::new(self.sr()));
                // Detune 0.5 is `map::detune_voct`'s no-offset centre: this
                // module has no detune site, but its pitch still goes through
                // the same Offset as every other source.
                self.wire_pitch(key, *octave, 0.5, fo.in_("v_oct"))?;
                self.knob(key, "vowel", *vowel, ParamMap::Unit, false, fo.in_("vowel"))?;
                self.knob(
                    key,
                    "fshift",
                    *shift,
                    ParamMap::FormantShift,
                    true,
                    fo.in_("formant_shift"),
                )?;
                self.constant(FORMANT_VIBRATO, fo.id(), "vibrato")?;
                // The vowel knob and the mod cable sum on one port, as on the
                // wavefolder threshold.
                self.wire_mod(
                    modulation,
                    key,
                    *mod_depth,
                    fo.in_("vowel"),
                    None,
                    DepthScale::Normalized,
                )?;
                Ok(Sig::mono(fo.out("out")))
            }
            AudioNode::Mix { balance, a, b, .. } => {
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
                ..
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
                    key,
                    *mod_depth,
                    filt.in_("fm"),
                    Some(in_out),
                    DepthScale::Normalized,
                )?;
                Ok(Sig::mono(filt.out(out_port)))
            }
            AudioNode::Fold {
                threshold,
                mod_depth,
                input,
                modulation,
                ..
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
                    key,
                    *mod_depth,
                    fold.in_("threshold"),
                    Some(in_out),
                    DepthScale::Normalized,
                )?;
                Ok(Sig::mono(fold.out("out")))
            }
            AudioNode::Delay {
                time,
                feedback,
                mix,
                mod_depth,
                input,
                modulation,
                ..
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
                // Modulating delay time is the only way this grammar reaches
                // tape wow, flange and doppler smear; the knob and the mod
                // cable sum on one port, as on the wavefolder.
                self.wire_mod(
                    modulation,
                    key,
                    *mod_depth,
                    dl.in_("time"),
                    Some(in_out),
                    DepthScale::Normalized,
                )?;
                Ok(Sig::mono(dl.out("out")))
            }
            AudioNode::Chorus {
                rate,
                depth,
                mix,
                mod_depth,
                input,
                modulation,
                ..
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
                self.wire_mod(
                    modulation,
                    key,
                    *mod_depth,
                    ch.in_("depth"),
                    Some(in_out),
                    DepthScale::Normalized,
                )?;
                // Width is the entire reason a chorus exists; port 10 (`out`)
                // is the mono sum of the two voices and throws it away.
                Ok(Sig::stereo(ch.out("left"), ch.out("right")))
            }
            AudioNode::Reverb {
                size,
                damp,
                mix,
                mod_depth,
                input,
                modulation,
                ..
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
                self.wire_mod(
                    modulation,
                    key,
                    *mod_depth,
                    rv.in_("size"),
                    Some(in_out),
                    DepthScale::Normalized,
                )?;
                // The decorrelation between the two tanks *is* the reverb.
                Ok(Sig::stereo(rv.out("left"), rv.out("right")))
            }
            AudioNode::Distortion {
                drive,
                tone,
                mode,
                mod_depth,
                input,
                modulation,
                ..
            } => {
                let in_out = self.build(input, &format!("{key}/0"))?;
                let ds = self
                    .patch
                    .add(format!("{key}:dist"), Distortion::new(self.sr()));
                self.feed(in_out, ds.in_("in"))?;
                self.knob(key, "drive", *drive, ParamMap::Unit, false, ds.in_("drive"))?;
                self.knob(key, "tone", *tone, ParamMap::Unit, false, ds.in_("tone"))?;
                self.constant(map::drive_mode_cv(mode.index()), ds.id(), "mode")?;
                // Fully wet. quiver's `mix` blends the shaped signal back
                // against the dry one, which is a *second* wet/dry control on
                // top of whatever mixer the patch already has — and at low
                // drive the module is nearly transparent anyway, so the knob
                // would spend most of its travel duplicating `#drive`.
                self.constant(1.0, ds.id(), "mix")?;
                self.wire_mod(
                    modulation,
                    key,
                    *mod_depth,
                    ds.in_("drive"),
                    Some(in_out),
                    DepthScale::Normalized,
                )?;
                Ok(Sig::mono(ds.out("out")))
            }
            AudioNode::Bitcrush {
                bits,
                downsample,
                mod_depth,
                input,
                modulation,
                ..
            } => {
                let in_out = self.build(input, &format!("{key}/0"))?;
                let bc = self.patch.add(format!("{key}:crush"), Bitcrusher::new());
                self.feed(in_out, bc.in_("in"))?;
                self.knob(key, "bits", *bits, ParamMap::Unit, false, bc.in_("bits"))?;
                self.knob(
                    key,
                    "dsamp",
                    *downsample,
                    ParamMap::Unit,
                    false,
                    bc.in_("downsample"),
                )?;
                self.wire_mod(
                    modulation,
                    key,
                    *mod_depth,
                    bc.in_("bits"),
                    Some(in_out),
                    DepthScale::Normalized,
                )?;
                Ok(Sig::mono(bc.out("out")))
            }
            AudioNode::Phaser {
                rate,
                depth,
                feedback,
                mod_depth,
                input,
                modulation,
                ..
            } => {
                let in_out = self.build(input, &format!("{key}/0"))?;
                let ph = self
                    .patch
                    .add(format!("{key}:phaser"), Phaser::new(self.sr()));
                self.feed(in_out, ph.in_("in"))?;
                self.knob(key, "prate", *rate, ParamMap::Unit, false, ph.in_("rate"))?;
                self.knob(
                    key,
                    "pdepth",
                    *depth,
                    ParamMap::Unit,
                    false,
                    ph.in_("depth"),
                )?;
                self.knob(
                    key,
                    "pfb",
                    *feedback,
                    ParamMap::FeedbackBipolar,
                    true,
                    ph.in_("feedback"),
                )?;
                self.constant(PHASER_STAGES, ph.id(), "stages")?;
                self.constant(PHASER_SPREAD, ph.id(), "spread")?;
                self.constant(PHASER_MIX, ph.id(), "mix")?;
                self.wire_mod(
                    modulation,
                    key,
                    *mod_depth,
                    ph.in_("depth"),
                    Some(in_out),
                    DepthScale::Normalized,
                )?;
                // Ports 11/12 are the spread pair; port 10 is the mono sweep
                // and discards the decorrelation `spread` exists to create.
                Ok(Sig::stereo(ph.out("left"), ph.out("right")))
            }
            AudioNode::Flanger {
                rate,
                depth,
                feedback,
                mod_depth,
                input,
                modulation,
                ..
            } => {
                let in_out = self.build(input, &format!("{key}/0"))?;
                let fl = self
                    .patch
                    .add(format!("{key}:flanger"), Flanger::new(self.sr()));
                self.feed(in_out, fl.in_("in"))?;
                self.knob(key, "frate", *rate, ParamMap::Unit, false, fl.in_("rate"))?;
                self.knob(
                    key,
                    "fdepth",
                    *depth,
                    ParamMap::Unit,
                    false,
                    fl.in_("depth"),
                )?;
                // A `CvBipolar` port, exactly as on the phaser: negative
                // feedback deepens the notches, positive one sharpens the
                // peaks, and knob centre is neither.
                self.knob(
                    key,
                    "ffb",
                    *feedback,
                    ParamMap::FeedbackBipolar,
                    true,
                    fl.in_("feedback"),
                )?;
                self.constant(FLANGER_MIX, fl.id(), "mix")?;
                self.constant(FLANGER_SPREAD, fl.id(), "spread")?;
                self.wire_mod(
                    modulation,
                    key,
                    *mod_depth,
                    fl.in_("depth"),
                    Some(in_out),
                    DepthScale::Normalized,
                )?;
                // Ports 11/12 are the spread pair; port 10 is bit-identical to
                // `left` and throws the decorrelation away.
                Ok(Sig::stereo(fl.out("left"), fl.out("right")))
            }
            AudioNode::Tremolo {
                rate,
                depth,
                shape,
                mod_depth,
                input,
                modulation,
                ..
            } => {
                let in_out = self.build(input, &format!("{key}/0"))?;
                let tr = self
                    .patch
                    .add(format!("{key}:tremolo"), Tremolo::new(self.sr()));
                self.feed(in_out, tr.in_("in"))?;
                self.knob(key, "trate", *rate, ParamMap::Unit, false, tr.in_("rate"))?;
                self.knob(
                    key,
                    "tdepth",
                    *depth,
                    ParamMap::Unit,
                    false,
                    tr.in_("depth"),
                )?;
                // Sine at 0, triangle at 1 — the difference between a breathing
                // amplitude and a stepped one at the same rate.
                self.knob(
                    key,
                    "tshape",
                    *shape,
                    ParamMap::Unit,
                    false,
                    tr.in_("shape"),
                )?;
                self.wire_mod(
                    modulation,
                    key,
                    *mod_depth,
                    tr.in_("depth"),
                    Some(in_out),
                    DepthScale::Normalized,
                )?;
                Ok(Sig::mono(tr.out("out")))
            }
            AudioNode::Vibrato {
                rate,
                depth,
                mix,
                mod_depth,
                input,
                modulation,
                ..
            } => {
                let in_out = self.build(input, &format!("{key}/0"))?;
                let vb = self
                    .patch
                    .add(format!("{key}:vibrato"), Vibrato::new(self.sr()));
                self.feed(in_out, vb.in_("in"))?;
                self.knob(key, "vrate", *rate, ParamMap::Unit, false, vb.in_("rate"))?;
                self.knob(
                    key,
                    "vdepth",
                    *depth,
                    ParamMap::Unit,
                    false,
                    vb.in_("depth"),
                )?;
                // Kept as a knob rather than pinned wet, because the whole
                // travel is musical — it is just that the interesting half is
                // the top. Below ~0.7 the dry copy beats against the shifted
                // one and the module becomes a chorus, which is a different
                // module in this palette.
                self.knob(key, "vmix", *mix, ParamMap::Unit, false, vb.in_("mix"))?;
                self.wire_mod(
                    modulation,
                    key,
                    *mod_depth,
                    vb.in_("depth"),
                    Some(in_out),
                    DepthScale::Normalized,
                )?;
                Ok(Sig::mono(vb.out("out")))
            }
            AudioNode::Eq {
                low,
                mid,
                high,
                mod_depth,
                input,
                modulation,
                ..
            } => {
                let in_out = self.build(input, &format!("{key}/0"))?;
                let eq = self
                    .patch
                    .add(format!("{key}:eq"), ParametricEq::new(self.sr()));
                self.feed(in_out, eq.in_("in"))?;
                // All three bands are bipolar ±5 V ports read as `cv/5 · 12`
                // dB, so knob centre has to be 0 dB — a tone control whose
                // home position colours the sound is a tone control nobody can
                // reason about.
                self.knob(
                    key,
                    "low",
                    *low,
                    ParamMap::GainBipolar,
                    true,
                    eq.in_("low_gain"),
                )?;
                self.knob(
                    key,
                    "mid",
                    *mid,
                    ParamMap::GainBipolar,
                    true,
                    eq.in_("mid_gain"),
                )?;
                self.knob(
                    key,
                    "high",
                    *high,
                    ParamMap::GainBipolar,
                    true,
                    eq.in_("high_gain"),
                )?;
                self.constant(EQ_LOW_FREQ, eq.id(), "low_freq")?;
                self.constant(EQ_MID_FREQ, eq.id(), "mid_freq")?;
                self.constant(EQ_MID_Q, eq.id(), "mid_q")?;
                self.constant(EQ_HIGH_FREQ, eq.id(), "high_freq")?;
                // The mid band is the modulated one: it is the only band with
                // a centre rather than a corner, so a wobble there is heard as
                // the patch moving forward and back rather than as a fade.
                self.wire_mod(
                    modulation,
                    key,
                    *mod_depth,
                    eq.in_("mid_gain"),
                    Some(in_out),
                    DepthScale::Gain,
                )?;
                Ok(Sig::mono(eq.out("out")))
            }
            AudioNode::Granular {
                position,
                size,
                density,
                mod_depth,
                input,
                modulation,
                ..
            } => {
                let in_out = self.build(input, &format!("{key}/0"))?;
                // Allocates a fixed 96 000-sample buffer (≈768 KB) at
                // construction, on the same order as `Reverb`'s comb bank and
                // on the same thread — compile time, never the audio thread.
                let gr = self
                    .patch
                    .add(format!("{key}:granular"), Granular::new(self.sr()));
                self.feed(in_out, gr.in_("in"))?;
                self.knob(
                    key,
                    "gpos",
                    *position,
                    ParamMap::Unit,
                    false,
                    gr.in_("position"),
                )?;
                self.knob(key, "gsize", *size, ParamMap::Unit, false, gr.in_("size"))?;
                self.knob(
                    key,
                    "gdens",
                    *density,
                    ParamMap::Unit,
                    false,
                    gr.in_("density"),
                )?;
                self.constant(GRANULAR_PITCH, gr.id(), "pitch")?;
                self.constant(GRANULAR_SPRAY, gr.id(), "spray")?;
                self.constant(GRANULAR_FREEZE, gr.id(), "freeze")?;
                // Position is the slot: sweeping where in the buffer the
                // grains are read from is the gesture the module exists for,
                // and it is the one that reads as motion rather than as a
                // different setting.
                self.wire_mod(
                    modulation,
                    key,
                    *mod_depth,
                    gr.in_("position"),
                    Some(in_out),
                    DepthScale::Normalized,
                )?;
                Ok(Sig::mono(gr.out("out")))
            }
            AudioNode::RingMod { mix, a, b, .. } => {
                let a_out = self.build(a, &format!("{key}/0"))?;
                let b_out = self.build(b, &format!("{key}/1"))?;
                let rm = self.patch.add(format!("{key}:ring"), RingModulator::new());
                self.feed(a_out, rm.in_("carrier"))?;
                self.feed(b_out, rm.in_("modulator"))?;
                // Ring modulation replaces the fundamental with sum and
                // difference tones, so at full wet the patch loses its own
                // pitch. Crossfading against the dry *carrier* — not against
                // silence, and not against the modulator — is what makes the
                // knob a "how metallic" control rather than a "how atonal"
                // one, and is why `a` is the carrier.
                let xf = self.patch.add(format!("{key}:rgmix"), Crossfader::new());
                self.feed(a_out, xf.in_("a"))?;
                self.patch.connect(rm.out("out"), xf.in_("b"))?;
                self.knob(key, "rgmix", *mix, ParamMap::XfadePos, true, xf.in_("pos"))?;
                Ok(Sig::mono(xf.out("out")))
            }
            AudioNode::Shift {
                semis,
                window,
                mix,
                mod_depth,
                input,
                modulation,
                ..
            } => {
                let in_out = self.build(input, &format!("{key}/0"))?;
                let ps = self
                    .patch
                    .add(format!("{key}:shift"), PitchShifter::new(self.sr()));
                self.feed(in_out, ps.in_("in"))?;
                // `#semis` and the mod cable sum on one port, as on the
                // wavefolder threshold — which is why each is given half of
                // quiver's ±24-semitone range rather than all of it.
                self.knob(
                    key,
                    "semis",
                    *semis,
                    ParamMap::Semitones,
                    true,
                    ps.in_("shift"),
                )?;
                self.knob(
                    key,
                    "window",
                    *window,
                    ParamMap::Unit,
                    false,
                    ps.in_("window"),
                )?;
                self.knob(key, "smix", *mix, ParamMap::Unit, false, ps.in_("mix"))?;
                self.wire_mod(
                    modulation,
                    key,
                    *mod_depth,
                    ps.in_("shift"),
                    Some(in_out),
                    DepthScale::Shift,
                )?;
                Ok(Sig::mono(ps.out("out")))
            }
            AudioNode::Comp {
                threshold,
                ratio,
                makeup,
                mod_depth,
                input,
                sidechain,
                modulation,
                ..
            } => {
                let in_out = self.build(input, &format!("{key}/0"))?;
                let key_out = self.build(sidechain, &format!("{key}/1"))?;
                let cp = self
                    .patch
                    .add(format!("{key}:comp"), Compressor::new(self.sr()));
                self.feed(in_out, cp.in_("in"))?;
                // quiver normals an unpatched sidechain to the main input, so
                // the `/1` branch is what makes this a *sidechain* compressor
                // rather than a plain one — and it is the only thing the
                // branch does: port 6 reaches the detector and never the
                // output.
                self.feed(key_out, cp.in_("sidechain"))?;
                self.knob(
                    key,
                    "thresh",
                    *threshold,
                    ParamMap::DetectorThreshold,
                    false,
                    cp.in_("threshold"),
                )?;
                self.knob(key, "ratio", *ratio, ParamMap::Unit, false, cp.in_("ratio"))?;
                self.knob(
                    key,
                    "makeup",
                    *makeup,
                    ParamMap::Unit,
                    false,
                    cp.in_("makeup"),
                )?;
                self.constant(COMP_ATTACK, cp.id(), "attack")?;
                self.constant(COMP_RELEASE, cp.id(), "release")?;
                // Threshold is the slot: moving it is what turns a static gain
                // trim into an audible pump. The port is a plain 0..1 CV, but
                // it is *not* a `Normalized` destination — see
                // `DepthScale::Detector`.
                self.wire_mod(
                    modulation,
                    key,
                    *mod_depth,
                    cp.in_("threshold"),
                    Some(in_out),
                    DepthScale::Detector,
                )?;
                Ok(Sig::mono(cp.out("out")))
            }
            AudioNode::Duck {
                amount,
                threshold,
                release,
                mod_depth,
                input,
                key: key_input,
                modulation,
                ..
            } => {
                let in_out = self.build(input, &format!("{key}/0"))?;
                let key_out = self.build(key_input, &format!("{key}/1"))?;
                let dk = self
                    .patch
                    .add(format!("{key}:duck"), Ducker::new(self.sr()));
                self.feed(in_out, dk.in_("in"))?;
                self.feed(key_out, dk.in_("key"))?;
                // Both of these are `ModulatedParam` knob+CV ports, not plain
                // CVs — the knob arrives as an offset from quiver's own base.
                // See `map::duck_amount`.
                self.knob(
                    key,
                    "amount",
                    *amount,
                    ParamMap::DuckAmount,
                    true,
                    dk.in_("amount"),
                )?;
                self.knob(
                    key,
                    "dthresh",
                    *threshold,
                    ParamMap::DuckThreshold,
                    true,
                    dk.in_("threshold"),
                )?;
                self.knob(
                    key,
                    "drel",
                    *release,
                    ParamMap::Unit,
                    false,
                    dk.in_("release"),
                )?;
                self.constant(DUCK_ATTACK, dk.id(), "attack")?;
                self.wire_mod(
                    modulation,
                    key,
                    *mod_depth,
                    dk.in_("amount"),
                    Some(in_out),
                    DepthScale::ParamCv,
                )?;
                Ok(Sig::mono(dk.out("out")))
            }
            AudioNode::Gate {
                threshold,
                range,
                release,
                mod_depth,
                input,
                sidechain,
                modulation,
                ..
            } => {
                let in_out = self.build(input, &format!("{key}/0"))?;
                let key_out = self.build(sidechain, &format!("{key}/1"))?;
                let ng = self
                    .patch
                    .add(format!("{key}:gate"), NoiseGate::new(self.sr()));
                self.feed(in_out, ng.in_("in"))?;
                // As on the compressor: unpatched, port 5 normals to the main
                // input and the module is an ordinary gate. The branch is what
                // makes it keyed.
                self.feed(key_out, ng.in_("sidechain"))?;
                self.knob(
                    key,
                    "gthresh",
                    *threshold,
                    ParamMap::DetectorThreshold,
                    false,
                    ng.in_("threshold"),
                )?;
                self.knob(key, "range", *range, ParamMap::Unit, false, ng.in_("range"))?;
                self.knob(
                    key,
                    "grel",
                    *release,
                    ParamMap::Unit,
                    false,
                    ng.in_("release"),
                )?;
                self.constant(GATE_ATTACK, ng.id(), "attack")?;
                self.wire_mod(
                    modulation,
                    key,
                    *mod_depth,
                    ng.in_("threshold"),
                    Some(in_out),
                    DepthScale::Detector,
                )?;
                Ok(Sig::mono(ng.out("out")))
            }
            AudioNode::Vocoder {
                bands,
                attack,
                release,
                mod_depth,
                carrier,
                modulator,
                modulation,
                ..
            } => {
                let carrier_out = self.build(carrier, &format!("{key}/0"))?;
                let mod_out = self.build(modulator, &format!("{key}/1"))?;
                let vc = self
                    .patch
                    .add(format!("{key}:vocoder"), Vocoder::new(self.sr()));
                self.feed(carrier_out, vc.in_("carrier"))?;
                self.feed(mod_out, vc.in_("modulator"))?;
                self.knob(key, "bands", *bands, ParamMap::Unit, false, vc.in_("bands"))?;
                self.knob(
                    key,
                    "vatt",
                    *attack,
                    ParamMap::Unit,
                    false,
                    vc.in_("attack"),
                )?;
                self.knob(
                    key,
                    "vrel",
                    *release,
                    ParamMap::Unit,
                    false,
                    vc.in_("release"),
                )?;
                // Band count is the slot. quiver quantizes it (`round(4 +
                // 12·cv)`), so this is the one mod destination in the grammar
                // that steps rather than sweeps — which is the honest thing
                // for it to do: resolution is what a vocoder's band count
                // *is*, and sweeping it is heard as the vowel going from
                // legible to smeared and back. The ballistics were the
                // alternative, and they are a decay time, not a timbre.
                self.wire_mod(
                    modulation,
                    key,
                    *mod_depth,
                    vc.in_("bands"),
                    // The carrier is what the module processes, so it is the
                    // tap — the same `/0`-is-the-signal rule the child order
                    // follows.
                    Some(carrier_out),
                    DepthScale::Normalized,
                )?;
                Ok(Sig::mono(vc.out("out")))
            }
        }
    }
}

/// Does this subtree contain a nonlinearity that can rectify, i.e. produce a
/// standing DC offset?
///
/// Two things in the palette can.
///
/// [`DiodeLadderFilter`]'s `diode_sat` is deliberately asymmetric
/// (`tanh(1.2x)` up, `tanh(0.8x)` down) and is applied at six points in the
/// ladder core.
///
/// [`Distortion`] in [`DriveMode::Tube`] is asymmetric *by definition* — it is
/// `1 − e^{−x}` above zero against `tanh(x)` below, which is the whole reason
/// the mode exists — so it emits DC at every drive setting above zero. Its two
/// siblings do not: soft clip is `tanh`, hard clip is a symmetric clamp, and
/// an odd nonlinearity cannot create DC from a zero-mean input. Skipping the
/// blocker on tube drive would put a per-note thump into every one of that
/// patch's feature vectors — and unlike a listener, the extractor cannot
/// discount it.
///
/// Everything else is linear or exactly odd-symmetric: `saturation::fold` is
/// `±2t − y`, the SVF's state clipper is `L·tanh(x/L)`, the bitcrusher's
/// quantizer is mid-tread (rounding, so unbiased), the ring modulator is a
/// product of two zero-mean signals, the limiter clamps symmetrically, and
/// every source is zero-mean — `KarplusStrong` explicitly zero-means its
/// excitation and leaks its loop for exactly this reason.
///
/// [`FormantOsc`] is the one that looks like an exception and is not. Its
/// glottal excitation is strictly **non-negative** (a half-sine open phase, a
/// quarter-cosine close, then zero), so it carries a large DC term — but it is
/// never heard directly: it reaches the output only through five parallel
/// 2-pole resonators whose numerator is `b0·(1 − z⁻²)`, which has an exact
/// zero at DC. The offset is annihilated in the filter bank, not by the voice
/// tail.
///
/// The 2A processors are all linear or amplitude-scaling: the flanger, vibrato
/// and granulator are (time-varying) delay reads, the EQ is a biquad cascade,
/// and the tremolo multiplies by a positive envelope — a gain, which cannot
/// create an offset a zero-mean input did not already have.
///
/// The 2B binaries are where this function stops being a plain recursion into
/// every child, and both directions matter:
///
/// - [`AudioNode::Comp`], [`AudioNode::Duck`] and [`AudioNode::Gate`] are
///   gains, so they pass their input's offset through — but their `/1` branch
///   reaches only the **detector** (quiver's ports 5/6/1 feed the envelope
///   follower and nothing else), so a ladder in the sidechain cannot put DC on
///   the output and must not buy a blocker.
/// - [`AudioNode::Vocoder`] is the opposite: both branches are consumed, and
///   *neither* can emit DC. Every band on both the analysis and the synthesis
///   side is a Chamberlin SVF bandpass, which has an exact zero at DC — at a
///   steady input the loop settles with `band = 0` — so the carrier's offset
///   is annihilated in the filter bank and the modulator's never reaches the
///   output at all. Same shape of argument as [`FormantOsc`] above, and the
///   same conclusion: no blocker.
fn makes_dc(node: &AudioNode) -> bool {
    match node {
        AudioNode::Comp { input, .. }
        | AudioNode::Duck { input, .. }
        | AudioNode::Gate { input, .. } => makes_dc(input),
        AudioNode::Vocoder { .. } => false,
        AudioNode::Vco { .. }
        | AudioNode::Supersaw { .. }
        | AudioNode::Noise { .. }
        | AudioNode::Wavetable { .. }
        | AudioNode::Pluck { .. }
        | AudioNode::Formant { .. } => false,
        AudioNode::Mix { a, b, .. } | AudioNode::RingMod { a, b, .. } => makes_dc(a) || makes_dc(b),
        AudioNode::Filter { kind, input, .. } => {
            matches!(kind, FilterKind::Ladder) || makes_dc(input)
        }
        AudioNode::Distortion { mode, input, .. } => {
            matches!(mode, DriveMode::Tube) || makes_dc(input)
        }
        AudioNode::Fold { input, .. }
        | AudioNode::Delay { input, .. }
        | AudioNode::Chorus { input, .. }
        | AudioNode::Reverb { input, .. }
        | AudioNode::Bitcrush { input, .. }
        | AudioNode::Phaser { input, .. }
        | AudioNode::Flanger { input, .. }
        | AudioNode::Tremolo { input, .. }
        | AudioNode::Vibrato { input, .. }
        | AudioNode::Eq { input, .. }
        | AudioNode::Granular { input, .. }
        // A windowed buffer read plus a dry/wet blend: linear, so an offset
        // arrives unchanged rather than being created.
        | AudioNode::Shift { input, .. } => makes_dc(input),
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
    let block_dc = makes_dc(&tree.root) || std::env::var("RIC_DCB_ALWAYS").is_ok();
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
    use crate::term::{
        AmpEnv, DriveMode, FilterKind, ModNode, NoiseColor, TableShape, Uid, Waveform,
    };

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
            uid: Uid::NEW,
            wave: Waveform::Saw,
            octave: 0,
            detune: 0.5,
            mod_depth: 0.0,
            modulation: ModNode::None,
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
            uid: Uid::NEW,
            kind: FilterKind::SvfLp,
            cutoff: 0.3,
            resonance: 0.0,
            mod_depth: 0.0,
            input: Box::new(AudioNode::Noise {
                uid: Uid::NEW,
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
            uid: Uid::NEW,
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
                uid: Uid::NEW,
                size: 0.7,
                damp: 0.4,
                mix: 0.6,
                mod_depth: 0.0,
                modulation: ModNode::None,
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
            uid: Uid::NEW,
            threshold: 0.5,
            mod_depth: 0.6,
            input: Box::new(saw()),
            modulation: ModNode::Lfo {
                uid: Uid::NEW,
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

    /// Zero crossings per window, over `windows` equal slices of `buf`.
    ///
    /// A sine's crossing count is a direct read of its instantaneous
    /// frequency and is blind to amplitude, so this survives the amp envelope
    /// and the limiter sitting between the oscillator and the measurement.
    fn crossings_per_window(buf: &[(f64, f64)], windows: usize) -> Vec<usize> {
        let w = buf.len() / windows;
        (0..windows)
            .map(|i| {
                buf[i * w..(i + 1) * w]
                    .windows(2)
                    .filter(|p| (p[0].0 < 0.0) != (p[1].0 < 0.0))
                    .count()
            })
            .collect()
    }

    /// Pitch modulation is **in octaves**, and the taper's full depth is
    /// exactly ±0.5 of one.
    ///
    /// This is the wave-2A capability nothing else in the grammar offers, and
    /// the arithmetic behind it is a three-step chain that is easy to get
    /// wrong by a factor of five: the [`Attenuverter`]'s gain is `level / 5`,
    /// its ±5 V source therefore arrives at `±level` **volts**, and the
    /// [`Offset`] it lands on is V/Oct — so the level *is* the octave depth.
    /// At `mod_depth` 1.0 that is ±0.5 octave, i.e. the fastest moment of the
    /// sweep is a full **2×** the slowest. Asserting the ratio rather than
    /// "something moved" is what makes this a test of the mapping instead of
    /// a test that a cable exists.
    ///
    /// The LFO runs one full cycle across the render, so the measurement does
    /// not depend on where its phase starts.
    #[test]
    fn pitch_modulation_spans_exactly_one_octave_at_full_depth() {
        let vco = |mod_depth: f64| AudioNode::Vco {
            uid: Uid::NEW,
            wave: Waveform::Sine,
            octave: 0,
            detune: 0.5,
            mod_depth,
            modulation: ModNode::Lfo {
                uid: Uid::NEW,
                wave: Waveform::Sine,
                // 0.01·3000^x Hz ⇒ 0.5 Hz, one cycle in the 2 s rendered.
                rate: 0.4886,
            },
        };
        // Held two octaves up: a 100 ms window then spans ~420 crossings, so
        // the ±1 quantization of counting them is 0.2% rather than the 4% it
        // would be at C4 — which is the difference between "the depth-0 leg is
        // inert" being a measurement and being a hope.
        let span = |mod_depth: f64| {
            let mut v = compile(&sustained(vco(mod_depth)), SR).expect("compiles");
            let out = hold(&mut v, 2.0, 88_200);
            let counts = crossings_per_window(&out, 20);
            let hi = *counts.iter().max().expect("windows") as f64;
            let lo = *counts.iter().min().expect("windows") as f64;
            hi / lo.max(1.0)
        };

        let full = span(1.0);
        assert!(
            (1.8..2.2).contains(&full),
            "full pitch depth spans {full:.3}× in frequency, not the 2.0× that \
             ±0.5 octave means — the attenuverter/V-Oct arithmetic is off"
        );
        // A tenth of the knob is the vibrato corner: ±0.05 octave ≈ ±60 cents,
        // so the span is 2^0.1 ≈ 1.072. Linear taper, so this follows from the
        // number above — and would not if the taper were square-law.
        let tenth = span(0.1);
        assert!(
            (1.03..1.12).contains(&tenth),
            "pitch depth 0.1 spans {tenth:.4}×, not the ~1.072× a linear taper gives"
        );
        // And the cable is inert at zero depth rather than merely quiet.
        let none = span(0.0);
        assert!(
            none < 1.02,
            "an empty pitch depth still moved the pitch by {none:.4}×"
        );
    }

    /// The EQ's modulation slot lands on a **volt-scaled** port, and is taken
    /// to that port's own scale rather than the normalized one.
    ///
    /// quiver reads `ParametricEq`'s bands as `cv/5 · 12` dB. The taper every
    /// other slot in this grammar uses is sized for a 0..1 CV — half of full
    /// scale, i.e. ±0.5 V — which on this port is **±1.2 dB at full depth**,
    /// about the level JND. That is a mod slot that does nothing across its
    /// entire travel, and it reviews as correct because the cable is there.
    /// `DepthScale::Gain` reaches the port's own ±5 V, so full depth is a
    /// ±12 dB pump.
    ///
    /// The two tapers differ by exactly 10×, which is what makes this
    /// measurable rather than arguable: **`mod_depth` 0.1 under the gain taper
    /// is precisely what `mod_depth` 1.0 would have been under the normalized
    /// one**, so the same render measures both designs. A sine parked on the
    /// bell's centre (≈1.26 kHz, i.e. 2.27 octaves above C4) makes the band's
    /// gain the whole signal's gain; the voice limiter clips the boost half,
    /// so what the swing reports is the cut half reaching its full −12 dB.
    #[test]
    fn eq_modulation_reaches_the_bands_own_volt_scale() {
        let eq = |mod_depth: f64| AudioNode::Eq {
            uid: Uid::NEW,
            low: 0.5,
            mid: 0.5,
            high: 0.5,
            mod_depth,
            input: Box::new(AudioNode::Vco {
                uid: Uid::NEW,
                wave: Waveform::Sine,
                octave: 0,
                detune: 0.5,
                mod_depth: 0.0,
                modulation: ModNode::None,
            }),
            modulation: ModNode::Lfo {
                uid: Uid::NEW,
                wave: Waveform::Sine,
                rate: 0.4886, // 0.5 Hz — one cycle in the 2 s rendered
            },
        };
        let swing = |mod_depth: f64| {
            let mut v = compile(&sustained(eq(mod_depth)), SR).expect("compiles");
            let out = hold(&mut v, 2.27, 88_200);
            let w = out.len() / 20;
            let levels: Vec<f64> = (0..20).map(|i| rms(&out[i * w..(i + 1) * w])).collect();
            let hi = levels.iter().cloned().fold(0.0_f64, f64::max);
            let lo = levels.iter().cloned().fold(f64::MAX, f64::min);
            hi / lo.max(1.0e-12)
        };

        // −12 dB is 3.98×; anything near it means the cable reached the port.
        let full = swing(1.0);
        assert!(
            full > 3.5,
            "eq modulation swings the level only {full:.3}× at full depth, not \
             the ~4× that ±12 dB on the mid band means"
        );
        // The counterfactual: the normalized taper's entire travel, which is
        // a hair over the level JND and 4% of the swing above.
        let as_normalized = swing(0.1);
        assert!(
            as_normalized < 1.25,
            "the normalized taper reaches {as_normalized:.3}× here — if that is \
             no longer ~1.15× the 10× ratio between the two tapers has moved"
        );
        // And the cable is inert at zero depth rather than merely quiet.
        let none = swing(0.0);
        assert!(
            none < 1.05,
            "an empty eq mod depth still moved the level by {none:.3}×"
        );
    }

    /// Magnitude of `buf` at `hz`, normalized by length — a one-bin DFT.
    ///
    /// The pitch shifter's output is a windowed sum of two resampled grains,
    /// so counting zero crossings measures the grain boundaries as much as the
    /// pitch. Correlating against the tone being looked for does not.
    fn tone_mag(buf: &[(f64, f64)], hz: f64, sr: f64) -> f64 {
        let (mut re, mut im) = (0.0, 0.0);
        for (n, (l, _)) in buf.iter().enumerate() {
            let w = std::f64::consts::TAU * hz * n as f64 / sr;
            re += l * w.cos();
            im += l * w.sin();
        }
        (re * re + im * im).sqrt() / buf.len() as f64
    }

    /// The semitone offset (over `range`) whose tone is strongest in `buf`,
    /// relative to `base_hz`.
    fn dominant_semitone(buf: &[(f64, f64)], base_hz: f64, range: i32) -> i32 {
        (-range..=range)
            .max_by(|a, b| {
                let m = |k: &i32| tone_mag(buf, base_hz * 2f64.powf(*k as f64 / 12.0), SR);
                m(a).total_cmp(&m(b))
            })
            .expect("non-empty range")
    }

    fn sine_src() -> AudioNode {
        AudioNode::Vco {
            uid: Uid::NEW,
            wave: Waveform::Sine,
            octave: 0,
            detune: 0.5,
            mod_depth: 0.0,
            modulation: ModNode::None,
        }
    }

    /// A plucked string, the default key/sidechain branch — and the quietest
    /// source in the palette, which is the whole reason the threshold knobs
    /// are geometric.
    fn pluck_key() -> AudioNode {
        AudioNode::Pluck {
            uid: Uid::NEW,
            octave: -1,
            damping: 0.4,
            brightness: 0.7,
            mod_depth: 0.0,
            modulation: ModNode::None,
        }
    }

    /// Per-window RMS over `n` equal slices, with quiver's noise RNG seeded.
    ///
    /// The seed is not optional here: every one of these patches is keyed from
    /// a Karplus-Strong string, whose excitation is drawn from a clock-seeded
    /// thread-local RNG — so an unseeded run measures a different string each
    /// time, and a gate's close *time* moves by hundreds of milliseconds
    /// between realisations.
    fn window_rms(tree: &PatchTree, voct: f64, n: usize) -> Vec<f64> {
        quiver::rng::seed(0x2B_5EED);
        let mut v = compile(tree, SR).expect("compiles");
        let out = hold(&mut v, voct, 44_100);
        let w = out.len() / n;
        (0..n).map(|i| rms(&out[i * w..(i + 1) * w])).collect()
    }

    /// The pitch shifter's `#semis` knob is in **semitones**, on quiver's own
    /// scale, with unison at knob centre.
    ///
    /// quiver reads the port as `cv/5 · 24` semitones and hard-clamps at ±24
    /// (`PitchShifter`, nonlinear.rs), so this is the third member of the
    /// family of errors wave 2A kept making: a control that reviews as correct
    /// because the cable exists and is off by a factor. Passing the raw 0..1
    /// knob would have given 0..+4.8 semitones with **no downward shift at
    /// all** — a "pitch shift" that can only go up, and only by a third.
    ///
    /// Measured as a one-bin DFT rather than by counting zero crossings,
    /// because the output is a windowed sum of two resampled grains: the grain
    /// boundaries cross zero too.
    #[test]
    fn pitch_shift_lands_on_quivers_semitone_scale() {
        // C4 held two octaves up, so a 1 s window resolves the interval and
        // the grain-rate sidebands sit further from the fundamental.
        let base = 261.625_565 * 4.0;
        let at = |semis: f64| {
            let tree = sustained(AudioNode::Shift {
                uid: Uid::NEW,
                semis,
                window: 0.5,
                mix: 1.0, // fully wet: the dry copy would win every bin
                mod_depth: 0.0,
                input: Box::new(sine_src()),
                modulation: ModNode::None,
            });
            let mut v = compile(&tree, SR).expect("compiles");
            let out = hold(&mut v, 2.0, 88_200);
            dominant_semitone(&out[44_100..], base, 14)
        };
        for (knob, want) in [(0.0, -12), (0.5, 0), (1.0, 12)] {
            let got = at(knob);
            assert!(
                (got - want).abs() <= 1,
                "shift knob {knob} transposes {got:+} semitones, not {want:+} — \
                 the ±12-at-the-ends, unison-at-centre map is off"
            );
        }
    }

    /// ...and its modulation slot lands on that same semitone scale rather
    /// than on the normalized one every other slot in the grammar uses.
    ///
    /// The two tapers differ by exactly 5× (`SHIFT_PEAK_V` 2.5 V against
    /// `PEAK_NORMALIZED` 0.5), which is what makes this measurable rather than
    /// arguable: **`mod_depth` 0.2 under the shift taper is precisely what
    /// `mod_depth` 1.0 would have been under the normalized one**, so the same
    /// render measures both designs.
    #[test]
    fn pitch_shift_modulation_reaches_the_ports_own_semitone_scale() {
        let base = 261.625_565 * 4.0;
        let span = |mod_depth: f64| {
            let tree = sustained(AudioNode::Shift {
                uid: Uid::NEW,
                semis: 0.5,
                window: 0.5,
                mix: 1.0,
                mod_depth,
                input: Box::new(sine_src()),
                modulation: ModNode::Lfo {
                    uid: Uid::NEW,
                    wave: Waveform::Triangle,
                    rate: 0.4886, // ≈0.5 Hz — one cycle in the 2 s rendered
                },
            });
            let mut v = compile(&tree, SR).expect("compiles");
            let out = hold(&mut v, 2.0, 88_200);
            let w = out.len() / 16;
            let ks: Vec<i32> = (0..16)
                .map(|i| dominant_semitone(&out[i * w..(i + 1) * w], base, 14))
                .collect();
            ks.iter().max().expect("windows") - ks.iter().min().expect("windows")
        };

        let full = span(1.0);
        assert!(
            full >= 18,
            "full shift depth sweeps only {full} semitones, not the ~24 that \
             ±12 means — the attenuverter arithmetic is off"
        );
        // The counterfactual: the normalized taper's *entire* travel.
        let as_normalized = span(0.2);
        assert!(
            as_normalized <= 8,
            "the normalized taper sweeps {as_normalized} semitones here — if \
             that is no longer ~5 the 5× ratio between the two tapers has moved"
        );
        assert_eq!(span(0.0), 0, "an empty shift depth still moved the pitch");
    }

    /// The three dynamics thresholds are **geometric over 0.05–5 V**, and they
    /// have to be, because this instrument's sources are not on one level.
    ///
    /// quiver reads all three as a plain `cv · 5` volts against a smoothed
    /// `|x|` detector, so passing the raw knob through is the obvious thing —
    /// and it produces a gate that never opens. Measured mean `|x|` on a held
    /// note: sine vco 3.18 V, plucked string 0.14 V. The pluck is what a gate
    /// or a ducker is usually keyed from, and under the linear map its whole
    /// useful range sat below knob position 0.1.
    ///
    /// The arithmetic first, then the behaviour it buys: with the default key
    /// branch the gate must both **open** on the pluck's attack and **shut**
    /// again as the string decays, inside one held note.
    #[test]
    fn the_dynamics_threshold_knob_spans_the_levels_the_palette_produces() {
        let volts = |x: f64| map::detector_threshold(x) * 5.0;
        assert!((volts(0.0) - 0.05).abs() < 1e-9, "bottom of the knob moved");
        assert!((volts(1.0) - 5.0).abs() < 1e-9, "top of the knob moved");
        // Geometric: the midpoint is the geometric mean, not the arithmetic
        // one (which would be 2.5 V and put every non-oscillator off the dial).
        assert!((volts(0.5) - 0.5).abs() < 1e-3, "the knob is not geometric");
        assert!(
            volts(0.35) < 0.3,
            "knob 0.35 asks for {:.3} V — under the linear map it asked for \
             1.75 V, which no key in the palette ever reaches",
            volts(0.35)
        );

        // The behaviour. `range` 0.7 means a shut gate passes 0.3 of the
        // signal, so open and shut differ by ~10 dB and are unmistakable.
        let gated = sustained(AudioNode::Gate {
            uid: Uid::NEW,
            threshold: 0.45,
            range: 0.7,
            release: 0.3,
            mod_depth: 0.0,
            input: Box::new(sine_src()),
            sidechain: Box::new(pluck_key()),
            modulation: ModNode::None,
        });
        let levels = window_rms(&gated, 0.0, 20);
        let (hi, lo) = (
            levels.iter().cloned().fold(0.0_f64, f64::max),
            levels.iter().cloned().fold(f64::MAX, f64::min),
        );
        assert!(
            hi / lo.max(1e-12) > 2.5,
            "the gate never changes state across a held note: {levels:?}"
        );
        // ...and in that order: open on the transient, shut on the decay.
        assert!(
            levels[1] > 2.0 * levels[19],
            "the gate did not open on the attack and shut on the decay: {levels:?}"
        );
    }

    /// The ducker's two knobs are **offsets from quiver's own knob base**, not
    /// plain CVs — and getting that wrong is a control that is at full depth
    /// across its entire travel.
    ///
    /// `Ducker` reads `amount` and `threshold` through a `ModulatedParam`
    /// (`base + cv/5`, dynamics.rs) whose base is set in `Ducker::new` and is
    /// reachable only from Rust, not from a port. `amount`'s base is **1.0**,
    /// so passing the raw 0..1 knob would have run the parameter from 1.0 to
    /// 1.2 and clamped: full ducking at every knob position, including zero.
    #[test]
    fn the_ducker_knob_offsets_quivers_own_base() {
        let ducked = |amount: f64| {
            let tree = sustained(AudioNode::Duck {
                uid: Uid::NEW,
                amount,
                threshold: 0.4,
                release: 0.35,
                mod_depth: 0.0,
                input: Box::new(sine_src()),
                key: Box::new(pluck_key()),
                modulation: ModNode::None,
            });
            let levels = window_rms(&tree, 0.0, 10);
            // The key decays, so the deepest duck is at the start.
            levels[0]
        };
        let (open, deep) = (ducked(0.0), ducked(1.0));
        assert!(
            deep < open * 0.5,
            "full duck depth only reaches {deep:.3} against {open:.3} unducked"
        );
        // The end that the raw-knob bug would have destroyed: at zero the
        // module must be a wire.
        let dry = window_rms(&sustained(sine_src()), 0.0, 10)[0];
        assert!(
            (open - dry).abs() / dry < 0.02,
            "a ducker at amount 0 is not a wire: {open:.3} against {dry:.3}"
        );
        // Monotone in between, so the knob is a depth and not a switch.
        let mid = ducked(0.5);
        assert!(
            deep < mid && mid < open,
            "duck depth is not monotone: {deep:.3} {mid:.3} {open:.3}"
        );
    }

    /// The ducker's modulation slot lands on a `ModulatedParam` port, which
    /// costs **ten times** the volts a normalized port does for the same
    /// musical depth.
    ///
    /// `PEAK_PARAM_CV` is 2.5 V against `PEAK_NORMALIZED`'s 0.5, so — as with
    /// the eq — `mod_depth` 0.2 here is exactly what `mod_depth` 1.0 would
    /// have been under the normalized taper, and one pair of renders measures
    /// both designs.
    #[test]
    fn duck_modulation_reaches_the_param_cv_scale() {
        let swing = |mod_depth: f64| {
            let tree = sustained(AudioNode::Duck {
                uid: Uid::NEW,
                // Mid depth, so the cable has room to move it both ways.
                amount: 0.5,
                threshold: 0.2,
                release: 0.35,
                mod_depth,
                input: Box::new(sine_src()),
                key: Box::new(pluck_key()),
                modulation: ModNode::Lfo {
                    uid: Uid::NEW,
                    wave: Waveform::Sine,
                    rate: 0.5595, // ≈0.9 Hz — a full cycle inside the render
                },
            });
            let levels = window_rms(&tree, 0.0, 20);
            let hi = levels.iter().cloned().fold(0.0_f64, f64::max);
            let lo = levels.iter().cloned().fold(f64::MAX, f64::min);
            hi / lo.max(1e-12)
        };
        let full = swing(1.0);
        assert!(
            full > 2.0,
            "duck modulation swings the level only {full:.3}× at full depth"
        );
        let as_normalized = swing(0.2);
        assert!(
            as_normalized < full * 0.6,
            "the normalized taper reaches {as_normalized:.3}× against the \
             gain taper's {full:.3}× — the 5× ratio between them has moved"
        );
    }

    /// A vocoder emits no DC, so `makes_dc` is right to refuse it a blocker.
    ///
    /// The argument is that every band on both sides is a Chamberlin SVF
    /// *bandpass*, which has an exact zero at DC — so the carrier's offset is
    /// annihilated in the filter bank and the modulator's never reaches the
    /// output at all. That is a claim about quiver's arithmetic, and this
    /// measures it on the module rather than trusting it: a ladder in the
    /// carrier is the palette's own DC generator, and the ladder alone would
    /// fail the vetting gate's `|mean|/rms` test without a blocker.
    #[test]
    fn a_vocoder_annihilates_its_carriers_dc() {
        let tree = sustained(AudioNode::Vocoder {
            uid: Uid::NEW,
            bands: 0.6,
            attack: 0.25,
            release: 0.3,
            mod_depth: 0.0,
            carrier: Box::new(AudioNode::Filter {
                uid: Uid::NEW,
                kind: FilterKind::Ladder,
                cutoff: 0.6,
                resonance: 0.4,
                mod_depth: 0.0,
                modulation: ModNode::None,
                input: Box::new(saw()),
            }),
            modulator: Box::new(AudioNode::Formant {
                uid: Uid::NEW,
                vowel: 0.3,
                shift: 0.5,
                octave: 0,
                mod_depth: 0.0,
                modulation: ModNode::None,
            }),
            modulation: ModNode::None,
        });
        assert!(
            !makes_dc(&tree.root),
            "a vocoder must not buy the voice a DC blocker"
        );
        quiver::rng::seed(0x2B_5EED);
        let mut v = compile(&tree, SR).expect("compiles");
        let out = hold(&mut v, 0.0, 44_100);
        let tail = &out[22_050..];
        let dc = tail.iter().map(|(l, _)| l).sum::<f64>() / tail.len() as f64;
        let level = rms(tail);
        assert!(level > 1e-3, "the vocoder was silent, nothing to measure");
        assert!(
            dc.abs() / level < 2.0e-3,
            "standing DC offset {dc:.6} against {level:.4} rms — the bandpass \
             zero this skips the blocker for is not where it was thought to be"
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

    /// Tube drive rectifies, and `makes_dc` is right to buy a blocker for it.
    ///
    /// The premise first, measured on quiver's module rather than asserted: a
    /// zero-mean sine through the asymmetric curve comes out with a standing
    /// offset, while the two symmetric curves leave it at zero (the ~0.0015
    /// floor below is the window's own partial cycle, not a signal).
    ///
    /// The offset is largest at *low* drive — 7.7% of RMS at drive 0.05,
    /// falling to 1.0% at drive 1.0 — because `1 − e^{−x}` and `tanh(x)` both
    /// saturate to ±1, so heavy drive is nearly symmetric and it is the gentle
    /// settings, the ones a patch is most likely to use, that rectify. −22 dB
    /// of DC multiplied by the amp envelope is an audible per-note thump, and
    /// one whose spectrum reaches far above the offset itself.
    #[test]
    fn dc_blocker_removes_the_tube_distortion_offset() {
        let raw_offset = |mode_cv: f64| {
            let mut p = Patch::new(SR);
            p.set_validation_mode(ValidationMode::Warn);
            let osc = p.add("osc", Vco::new(SR));
            let d = p.add("d", Distortion::new(SR));
            p.connect(osc.out("sin"), d.in_("in")).expect("wires");
            // Tone wide open, so nothing but the shaper is being measured.
            for (port, v) in [
                ("drive", 0.1),
                ("tone", 1.0),
                ("mode", mode_cv),
                ("mix", 1.0),
            ] {
                assert!(p.set_param_by_id(d.id(), port, v), "no port {port}");
            }
            let out = p.add("out", StereoOutput::new());
            p.connect(d.out("out"), out.in_("left")).expect("wires");
            p.set_output(out.id());
            p.compile().expect("compiles");
            let buf: Vec<f64> = (0..(SR as usize)).map(|_| p.tick().0).collect();
            let tail = &buf[SR as usize / 2..];
            let mean = tail.iter().sum::<f64>() / tail.len() as f64;
            let rms = (tail.iter().map(|x| x * x).sum::<f64>() / tail.len() as f64).sqrt();
            mean.abs() / rms.max(1.0e-12)
        };
        let (soft, hard, tube) = (
            raw_offset(map::drive_mode_cv(0)),
            raw_offset(map::drive_mode_cv(1)),
            raw_offset(map::drive_mode_cv(2)),
        );
        assert!(
            tube > 0.05 && soft < 5.0e-3 && hard < 5.0e-3,
            "the asymmetry premise is wrong: soft {soft:.5}, hard {hard:.5}, tube {tube:.5}"
        );

        // ...and the compiled voice has none of it left. Sustain is well
        // under the limiter: clipping an asymmetric waveform is itself a
        // rectifier, downstream of the blocker, and it would be measured here
        // as a failure of a stage that cannot see it.
        let tree = PatchTree {
            amp: AmpEnv {
                attack: 0.05,
                decay: 0.3,
                sustain: 0.35,
                release: 0.3,
            },
            root: AudioNode::Distortion {
                uid: Uid::NEW,
                drive: 0.15,
                tone: 0.7,
                mode: DriveMode::Tube,
                mod_depth: 0.0,
                input: Box::new(saw()),
                modulation: ModNode::None,
            },
        };
        assert!(makes_dc(&tree.root), "tube drive must buy a blocker");
        let mut v = compile(&tree, SR).expect("compiles");
        let n = (SR * 3.0) as usize;
        let out = hold(&mut v, -1.0, n);
        let tail = &out[n / 2..];
        let dc = tail.iter().map(|(l, _)| l).sum::<f64>() / tail.len() as f64;
        let level = rms(tail);
        assert!(level > 0.1, "patch was silent, nothing to measure");
        assert!(
            dc.abs() / level < 2.0e-3,
            "standing DC offset {dc:.6} against {level:.4} rms"
        );
        // The symmetric modes pay nothing for it.
        for mode in [DriveMode::Soft, DriveMode::Hard] {
            let clean = sustained(AudioNode::Distortion {
                uid: Uid::NEW,
                drive: 0.15,
                tone: 0.7,
                mode,
                mod_depth: 0.0,
                input: Box::new(saw()),
                modulation: ModNode::None,
            });
            assert!(!makes_dc(&clean.root), "{mode:?} must not buy a blocker");
        }
    }

    /// The envelope follower rides the owning module's *own* input, and
    /// degrades to silence rather than to a panic where there is no input.
    #[test]
    fn the_follower_reads_the_signal_below_it() {
        // A lowpass whose cutoff is opened by the level of what it is
        // filtering. Playing louder is not available, so the counterfactual is
        // the same tree with the depth knob at zero: identical graph, one
        // attenuverter neutralized.
        let tree = |depth: f64| {
            sustained(AudioNode::Filter {
                uid: Uid::NEW,
                kind: FilterKind::SvfLp,
                cutoff: 0.25,
                resonance: 0.0,
                mod_depth: depth,
                input: Box::new(saw()),
                modulation: ModNode::Follow {
                    uid: Uid::NEW,
                    sens: 0.8,
                    release: 0.3,
                },
            })
        };
        let level = |depth: f64| {
            let mut v = compile(&tree(depth), SR).expect("compiles");
            let out = hold(&mut v, 0.0, 44_100);
            rms(&out[22_050..])
        };
        let (off, on) = (level(0.0), level(0.9));
        assert!(
            on > off * 1.05,
            "the follower is inaudible: {off:.4} closed vs {on:.4} open"
        );

        // A source's slot has nothing to tap. That must compile and stay
        // silent on the cable, because both the prior and the panel can put a
        // follower there.
        let lone = sustained(AudioNode::Wavetable {
            uid: Uid::NEW,
            table: crate::term::TableShape::Saw,
            octave: 0,
            morph: 0.4,
            mod_depth: 0.8,
            modulation: ModNode::Follow {
                uid: Uid::NEW,
                sens: 0.8,
                release: 0.3,
            },
        });
        let mut v = compile(&lone, SR).expect("a follower on a source must still compile");
        assert!(
            rms(&hold(&mut v, 0.0, 22_050)) > 1.0e-3,
            "the wavetable went silent"
        );
    }

    /// `table_cv` has to land each table on an *exact* integer position in
    /// quiver's stack, because the port is a crossfade, not a selector: quiver
    /// takes `idx = floor(cv·7)` and blends table `idx` into `idx+1` by
    /// `frac + morph`. Any non-zero `frac` both mis-names the table on the
    /// plate and eats the top of the morph knob's travel, and neither symptom
    /// is visible in a diff — this is the guard that makes it visible.
    #[test]
    fn every_wavetable_shape_lands_on_its_own_table() {
        for i in 0..TableShape::ALL.len() {
            let pos = map::table_cv(i) * 7.0;
            let frac = pos - pos.floor();
            assert!(
                frac < 1e-12 || (1.0 - frac) < 1e-12,
                "table {i} lands at {pos} — fraction {frac} blends it into its neighbour"
            );
            // …and inside the stack, so no shape is unreachable.
            assert!(
                (0.0..=7.0).contains(&pos),
                "table {i} maps outside the stack"
            );
        }
        // Distinct tables, in order: the plate's index IS the table you hear.
        let cvs: Vec<f64> = (0..TableShape::ALL.len()).map(map::table_cv).collect();
        assert!(
            cvs.windows(2).all(|w| w[1] > w[0]),
            "table CVs are not monotonic"
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
                uid: Uid::NEW,
                kind: FilterKind::Ladder,
                cutoff: 1.0,
                resonance: 0.0,
                mod_depth: 0.0,
                input: Box::new(AudioNode::Vco {
                    uid: Uid::NEW,
                    wave: Waveform::Sine,
                    octave: 0,
                    detune: 0.5,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
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

    // ---------------------------------------------------------------------
    // Wave 2C: modulation as a sort.
    //
    // Every test below measures the *scale* of a control rather than the
    // presence of a cable, because four palette waves running the presence
    // check let four dead controls through.
    // ---------------------------------------------------------------------

    /// A sine oscillator whose **pitch** is driven by `m`.
    ///
    /// Pitch is the measuring destination for the whole of this wave: it is
    /// the only mod target whose value can be read straight out of the
    /// rendered audio, by counting zero crossings, without a spectral estimate
    /// in the way.
    fn pitch_modulated(m: ModNode, mod_depth: f64) -> PatchTree {
        sustained(AudioNode::Vco {
            uid: Uid::NEW,
            wave: Waveform::Sine,
            octave: 0,
            detune: 0.5,
            mod_depth,
            modulation: m,
        })
    }

    /// A slow triangle LFO: 0.125 Hz on quiver's `0.01·3000^cv` map, so one
    /// cycle takes 8 s and a 4 s render sweeps up and back down once.
    const SLOW_LFO_RATE: f64 = 0.3155;

    /// Semitone offsets of each window relative to the lowest, read off the
    /// zero-crossing count. At C6 a 100 ms window holds ~209 crossings, so the
    /// ±1 count quantization is 0.08 of a semitone — fine enough to say
    /// whether a pitch landed on the 12-TET grid.
    fn semitone_track(out: &[(f64, f64)], windows: usize) -> Vec<f64> {
        let counts = crossings_per_window(out, windows);
        let lo = *counts.iter().min().expect("windows") as f64;
        counts
            .iter()
            .map(|c| 12.0 * (*c as f64 / lo.max(1.0)).log2())
            .collect()
    }

    /// Transitions of more than a semitone between adjacent windows — how a
    /// gate arriving on a pitch cable reads.
    fn gate_edges(out: &[(f64, f64)], windows: usize) -> usize {
        let t = semitone_track(out, windows);
        t.windows(2).filter(|w| (w[0] - w[1]).abs() > 1.0).count()
    }

    /// The quantizer snaps a modulator onto the **12-TET grid**, and the grid
    /// is sized so a fully-modulated pitch cable lands on whole semitones.
    ///
    /// This is the one module in the wave whose musical claim is arithmetic
    /// rather than taste, and it is arithmetic in three stages that multiply.
    /// `ScaleQuantizer` snaps in V/Oct on a fixed 1/12 V grid, so handed a
    /// modulator at its native ±5 V it emits 121 steps across ±60 semitones —
    /// a "quantizer" whose output is finer than the ear and, after the mod
    /// cable's own 0.1 gain, finer than a tenth of a semitone.
    /// [`QUANTIZE_IN_LEVEL`] scales the input into a ±6 semitone window and
    /// its inverse scales the output back out, so the *grid* is resized and
    /// the cable's gain is not.
    ///
    /// Both halves are asserted: that the modulation still spans its full
    /// ±0.5 octave (the round trip is unity, not an attenuation), and that
    /// what it visits on the way is a staircase on the semitone grid rather
    /// than a ramp.
    #[test]
    fn the_quantizer_lands_a_pitch_cable_on_whole_semitones() {
        let lfo = || ModNode::Lfo {
            uid: Uid::NEW,
            wave: Waveform::Triangle,
            rate: SLOW_LFO_RATE,
        };
        let track = |m: ModNode| {
            let mut v = compile(&pitch_modulated(m, 1.0), SR).expect("compiles");
            // Two octaves up, for the crossing-count resolution the grid
            // check needs.
            let out = hold(&mut v, 2.0, (SR * 4.0) as usize);
            semitone_track(&out, 40)
        };
        let quantized = track(ModNode::Op {
            uid: Uid::NEW,
            kind: ModOp::Quantize,
            p0: 0.0, // root C
            p1: 0.0, // chromatic — every semitone is reachable
            input: Box::new(lfo()),
        });
        let plain = track(lfo());

        // 1. The round trip is transparent: a triangle sweeping the full
        //    ±0.5 octave still spans an octave after being quantized.
        let span = |t: &[f64]| t.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let (qs, ps) = (span(&quantized), span(&plain));
        assert!(
            ps > 8.0,
            "the control sweep is too small to measure: {ps:.2}"
        );
        assert!(
            (qs - ps).abs() < 1.5,
            "quantizing changed the modulation's range: {qs:.2} vs {ps:.2} \
             semitones — the input and output levels do not cancel"
        );

        // 2. It is a staircase. Adjacent windows land on the *same* pitch far
        //    more often than a continuous sweep ever does…
        let plateaus = |t: &[f64]| {
            t.windows(2).filter(|w| (w[0] - w[1]).abs() < 0.05).count() as f64
                / (t.len() - 1) as f64
        };
        let (qp, pp) = (plateaus(&quantized), plateaus(&plain));
        assert!(
            qp > 0.3 && qp > pp + 0.15,
            "quantized pitch is not stepped: {:.0}% of windows held, against \
             {:.0}% for the unquantized control",
            100.0 * qp,
            100.0 * pp
        );
        // …and every pitch it holds is on the grid, which is the claim about
        // the grid's *size* rather than about its existence.
        let off_grid = |t: &[f64]| {
            let mut d: Vec<f64> = t.iter().map(|s| (s - s.round()).abs()).collect();
            d.sort_by(f64::total_cmp);
            d[d.len() / 2]
        };
        let (qg, pg) = (off_grid(&quantized), off_grid(&plain));
        assert!(
            qg < 0.15 && qg < pg * 0.7,
            "quantized pitch sits {qg:.3} semitones off the grid (control \
             {pg:.3}) — QUANTIZE_IN_LEVEL is not sizing the grid to the \
             destination"
        );
    }

    /// A euclidean pattern's clock spans the tempo the port actually offers.
    ///
    /// `Clock`'s `bpm` port is `CvUnipolar`, which in quiver is **0–10 V and
    /// not 0–1**: `cv_to_bpm` is `20·15^(cv/10)`, so passing the raw knob
    /// through would have given 20 BPM at one end of the control and 21.4 at
    /// the other — a rate knob with a 7% range. `ParamMap::ClockRate` spans
    /// the port, and the ratio asserted here is most of the 15× the map can
    /// produce.
    #[test]
    fn the_euclid_clock_spans_the_ports_own_tempo_range() {
        let edges = |rate: f64| {
            let m = ModNode::Euclid {
                uid: Uid::NEW,
                rate,
                steps: 0.3,
                pulses: 0.6,
            };
            let mut v = compile(&pitch_modulated(m, 1.0), SR).expect("compiles");
            let out = hold(&mut v, 2.0, (SR * 8.0) as usize);
            gate_edges(&out, 400)
        };
        let (slow, fast) = (edges(0.0), edges(1.0));
        assert!(slow > 0, "the slowest clock never fired at all");
        assert!(
            fast as f64 / slow as f64 > 5.0,
            "the euclid rate knob spans only {:.1}× ({slow} to {fast} edges in \
             8 s) — the bpm port is 0–10 V, not 0–1",
            fast as f64 / slow as f64
        );
    }

    /// Neither end of the euclid's `pulses` knob is a dead cable, at either
    /// end of its `steps` knob.
    ///
    /// quiver takes `pulses = (cv · steps) as usize`, so a raw knob emits
    /// nothing at all below `1/steps` — about one uniform draw in seven — and
    /// a solid gate at exactly 1.0. `ParamMap::EuclidSteps` gives up the two
    /// shortest patterns so that one CV floor can serve every step count, and
    /// this checks all four corners.
    #[test]
    fn every_corner_of_the_euclid_knobs_still_makes_a_rhythm() {
        let edges = |steps: f64, pulses: f64| {
            let m = ModNode::Euclid {
                uid: Uid::NEW,
                rate: 1.0,
                steps,
                pulses,
            };
            let mut v = compile(&pitch_modulated(m, 1.0), SR).expect("compiles");
            let out = hold(&mut v, 2.0, (SR * 8.0) as usize);
            gate_edges(&out, 400)
        };
        for (steps, pulses) in [(0.0, 0.0), (0.0, 1.0), (1.0, 0.0), (1.0, 1.0)] {
            assert!(
                edges(steps, pulses) > 0,
                "euclid at steps {steps} / pulses {pulses} emits a constant"
            );
        }
    }

    /// The switch hears **both** of its branches.
    ///
    /// quiver's `VcSwitch` needs a third input to choose with and `Pair` has
    /// only two to give. The contract proposed the voice gate; that is a
    /// control that reviews as correct and does nothing, because the gate is
    /// high for the whole of every note and low only between notes when the
    /// VCA is shut — so `b` would win every sample anybody hears and `a` would
    /// be a module on the rack that is never once audible. Wiring `b` as its
    /// own control makes the module "punch `b` in over `a`", and the way to
    /// prove `a` is alive is to change only `a`.
    #[test]
    fn the_switch_is_not_stuck_on_one_branch() {
        let render = |a_rate: f64| {
            let m = ModNode::Pair {
                uid: Uid::NEW,
                kind: PairOp::Switch,
                a: Box::new(ModNode::Lfo {
                    uid: Uid::NEW,
                    wave: Waveform::Triangle,
                    rate: a_rate,
                }),
                b: Box::new(ModNode::Euclid {
                    uid: Uid::NEW,
                    rate: 0.7,
                    steps: 0.4,
                    pulses: 0.5,
                }),
            };
            let mut v = compile(&pitch_modulated(m, 1.0), SR).expect("compiles");
            let out = hold(&mut v, 2.0, (SR * 2.0) as usize);
            crossings_per_window(&out, 40)
        };
        let (slow, fast) = (render(SLOW_LFO_RATE), render(0.6));
        let moved = slow
            .iter()
            .zip(&fast)
            .filter(|(a, b)| (**a as i64 - **b as i64).abs() > 4)
            .count();
        assert!(
            moved * 4 > slow.len(),
            "changing only the switch's `a` branch moved {moved} of {} windows \
             — that branch is never selected",
            slow.len()
        );
    }

    /// The slew limiter's useful glide times are on the plate rather than
    /// crammed into its first quarter, and its top is a freeze rather than a
    /// third of one.
    ///
    /// quiver's own map is `0.001 + cv²·10` seconds — already square-law — so
    /// a raw knob puts every glide under 1.5 s below position 0.39 and spends
    /// the remaining three fifths of its travel holding the modulator still.
    /// `ParamMap::SlewTime` is `0.4·x`, which is measured here at three
    /// points: a quarter turn already smooths, and the top of the knob has
    /// nearly stopped the modulator.
    #[test]
    fn the_slew_knob_spends_its_travel_on_audible_glide_times() {
        // Movement per window: how far the pitch jumps between adjacent
        // 50 ms windows. A stepped source jumps; a slewed one ramps.
        // The *largest* jump between adjacent 50 ms windows, which is the
        // step height a slew limiter exists to soften. A mean would be the
        // wrong statistic: slewing spreads one big jump over several windows,
        // so it moves the mean up while moving the maximum down.
        let jump = |m: ModNode| {
            let mut v = compile(&pitch_modulated(m, 1.0), SR).expect("compiles");
            let out = hold(&mut v, 2.0, (SR * 4.0) as usize);
            // 25 ms windows: fine enough that a 50 ms glide — a quarter turn
            // of the knob — spreads its step across more than one of them.
            let t = semitone_track(&out, 160);
            t.windows(2)
                .map(|w| (w[0] - w[1]).abs())
                .fold(0.0f64, f64::max)
        };
        let stepped = || ModNode::Euclid {
            uid: Uid::NEW,
            rate: 0.75,
            steps: 0.3,
            pulses: 0.5,
        };
        let slewed = |t: f64| ModNode::Op {
            uid: Uid::NEW,
            kind: ModOp::Slew,
            p0: t,
            p1: t,
            input: Box::new(stepped()),
        };
        let bare = jump(stepped());
        assert!(bare > 3.0, "the control source barely moves: {bare:.3}");
        let quarter = jump(slewed(0.25));
        assert!(
            quarter < bare * 0.75,
            "a quarter turn of slew changed the step height from {bare:.3} to \
             {quarter:.3} — the useful glide times are not on the plate"
        );
        let full = jump(slewed(1.0));
        assert!(
            full < quarter * 0.4,
            "full slew ({full:.3}) is not much slower than a quarter turn \
             ({quarter:.3})"
        );
    }

    /// The rectifier picks an output **port**, and the three it offers are
    /// three different signals.
    ///
    /// quiver's `Rectifier` has no `mode` input at all — it publishes `full`,
    /// `half_pos` and `half_neg` simultaneously — so `rmode` chooses a cable
    /// at compile time rather than writing a CV, which is also why it is the
    /// one 2C knob with no live handle.
    #[test]
    fn the_three_rectifier_modes_are_three_different_signals() {
        let track = |mode: f64| {
            let m = ModNode::Op {
                uid: Uid::NEW,
                kind: ModOp::Rectify,
                p0: mode,
                p1: 0.0,
                input: Box::new(ModNode::Lfo {
                    uid: Uid::NEW,
                    wave: Waveform::Triangle,
                    rate: SLOW_LFO_RATE,
                }),
            };
            let mut v = compile(&pitch_modulated(m, 1.0), SR).expect("compiles");
            let out = hold(&mut v, 2.0, (SR * 4.0) as usize);
            crossings_per_window(&out, 40)
        };
        let differs = |a: &[usize], b: &[usize]| {
            a.iter()
                .zip(b)
                .filter(|(x, y)| (**x as i64 - **y as i64).abs() > 4)
                .count()
        };
        // Cell centres of a three-way split: full / positive / negative.
        let (full, pos, neg) = (track(0.1), track(0.5), track(0.9));
        assert!(
            differs(&full, &pos) * 5 > full.len(),
            "full-wave and positive-half rectification render the same"
        );
        assert!(
            differs(&pos, &neg) * 5 > pos.len(),
            "the two half-wave modes render the same"
        );
        // A full-wave rectified triangle is a triangle at twice the rate and
        // never goes below the base note, so the *lowest* pitch it visits is
        // the unmodulated one — which is what "folded into one polarity"
        // means and what distinguishes it from the bare LFO.
        let bare = {
            let mut v = compile(
                &pitch_modulated(
                    ModNode::Lfo {
                        uid: Uid::NEW,
                        wave: Waveform::Triangle,
                        rate: SLOW_LFO_RATE,
                    },
                    1.0,
                ),
                SR,
            )
            .expect("compiles");
            let out = hold(&mut v, 2.0, (SR * 4.0) as usize);
            crossings_per_window(&out, 40)
        };
        assert!(
            differs(&full, &bare) * 5 > full.len(),
            "rectifying a bipolar LFO changed nothing"
        );
    }

    /// A modulation chain compiles as a chain: two processors over a leaf all
    /// reach the destination, and every knob in it is a real trace address.
    ///
    /// This is the shape the whole wave exists for — `s&h rand → quantize →
    /// slew` — and the thing that would break silently is the recursion
    /// dropping a level and wiring the leaf straight to the attenuverter.
    #[test]
    fn a_two_deep_mod_chain_reaches_the_destination_through_every_stage() {
        let chain = ModNode::Op {
            uid: Uid::NEW,
            kind: ModOp::Slew,
            p0: 0.3,
            p1: 0.3,
            input: Box::new(ModNode::Op {
                uid: Uid::NEW,
                kind: ModOp::Quantize,
                p0: 0.0,
                p1: 2.5 / 7.0, // minor
                input: Box::new(ModNode::Rand {
                    uid: Uid::NEW,
                    rate: 0.6,
                    glide: 0.0,
                }),
            }),
        };
        // Two processors over a leaf — the deepest term the default prior can
        // draw, so this is the shape the search actually has to survive and
        // not a hand-built extreme.
        assert_eq!(
            chain.depth(),
            1 + crate::PatchGrammarPrior::default().max_mod_depth
        );
        let tree = pitch_modulated(chain, 1.0);
        let v = compile(&tree, SR).expect("compiles");
        // Each stage's knobs live under its own key, one level deeper than
        // its parent's — `node/m` for the slew, `node/m/0` for the quantizer,
        // `node/m/0/0` for the S&H.
        for addr in [
            "node#mdepth",
            "node/m#rise",
            "node/m#fall",
            "node/m/0#qroot",
            "node/m/0#qscale",
            "node/m/0/0#rate",
            "node/m/0/0#glide",
        ] {
            assert!(
                v.params.contains_key(addr),
                "chain stage `{addr}` has no live handle"
            );
        }
        // And the top stage is what reaches the oscillator: a recursion that
        // dropped a level would wire the leaf straight to the attenuverter
        // and leave the hard steps on the pitch.
        //
        // Measured on the same two-deep shape with a **euclidean** leaf
        // rather than the S&H one above, because the comparison has to be
        // controlled: two patches containing a noise generator are two
        // different random signals, and the difference between them would
        // measure the noise rather than the slew.
        let jump = |m: ModNode| {
            let mut v = compile(&pitch_modulated(m, 1.0), SR).expect("compiles");
            let out = hold(&mut v, 2.0, (SR * 4.0) as usize);
            let t = semitone_track(&out, 160);
            t.windows(2)
                .map(|w| (w[0] - w[1]).abs())
                .fold(0.0f64, f64::max)
        };
        let inner = || ModNode::Op {
            uid: Uid::NEW,
            kind: ModOp::Quantize,
            p0: 0.0,
            p1: 2.5 / 7.0, // minor
            input: Box::new(ModNode::Euclid {
                uid: Uid::NEW,
                rate: 0.75,
                steps: 0.3,
                pulses: 0.5,
            }),
        };
        let raw = jump(inner());
        let slewed = jump(ModNode::Op {
            uid: Uid::NEW,
            kind: ModOp::Slew,
            p0: 1.0,
            p1: 1.0,
            input: Box::new(inner()),
        });
        assert!(raw > 3.0, "the two-stage control barely moves: {raw:.3}");
        assert!(
            slewed < raw * 0.5,
            "the slew stage did not reach the pitch: {slewed:.3} against \
             {raw:.3} without it"
        );
    }
}
