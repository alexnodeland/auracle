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
//! Genome parameters are normalized `[0, 1)`; this module owns their musical
//! mapping. Ranges are deliberately **bounded away from pathology** (max
//! resonance 0.85, max delay feedback 0.7) — the grammar cannot express the
//! most degenerate settings, which is safety layer 3 of the vetting design.

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

use crate::prior::STEPS_SITES;
use crate::steps::StepsCv;
use crate::take::{Take, TAKE_SECONDS};
use crate::term::CaptureMode;
/// The live-only handle a `steps` module's transport position rides on
/// (`<key>#~sync`). Never a trace site; the live engine finds it by suffix.
pub const STEPS_SYNC_SITE: &str = "~sync";
use crate::term::{
    rect_mode_index, AudioNode, DriveMode, FilterKind, ModNode, ModOp, NoiseColor, PairOp,
    PatchTree,
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
    /// An AUDIO IN's gain, in dB across the knob
    /// ([`INPUT_GAIN_DB_MIN`]..[`INPUT_GAIN_DB_MAX`]), as the linear factor
    /// quiver's `AudioInput` reads on its `gain` port.
    InputGain,
    /// A TRACK's sensitivity, as the gate threshold quiver's `PitchTracker`
    /// reads on its `level` scale: geometric from [`TRACK_GATE_LOUD`] down to
    /// [`TRACK_GATE_QUIET`] volts, so up opens on a quieter input.
    TrackSensitivity,
    /// A TRACK's dynamics, as the attenuverter level (`10·x` V, a gain of
    /// `2x`) that sets how far the tracked level moves its VCA.
    TrackDynamics,
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
    /// **Categorical.** Wavetable select, as a table *index* rather than a
    /// 0..1 knob: `i ↦ i/7`, the same [`map::table_cv`] the port used to be
    /// pinned to. See [`Self::clamp_input`] for why the domain is not 0..1.
    TableIndex,
    /// **Categorical.** Octave select, as an index `0..=4` (`i ↦ i−2`
    /// octaves), *minus the octave already baked into this voice's pitch
    /// [`Offset`]* — which is the `i8` payload.
    ///
    /// The relative form is the whole trick, and it is what keeps this change
    /// from moving a single sample of an existing patch. quiver **sums** every
    /// cable into a patched input and **writes** the default into an unpatched
    /// one, so a cable carrying the absolute offset would have to be added in
    /// a different place in the sum than the [`Offset`]'s own constant is:
    /// `(pitch + oct) + detune` instead of `pitch + (oct + detune)`, which
    /// disagree in the last bit, and again with a pitch-mod cable in the sum.
    /// A trim is `+0.0` at compile time, and `x + 0.0` is exactly `x`.
    ///
    /// It also means the panel and the compiler can never double-count: a
    /// recompile re-bakes whatever octave the tree now holds and re-zeroes the
    /// trim in the same breath.
    OctaveTrim(i8),
}

impl ParamMap {
    /// Clamp a value arriving from the panel to this map's input domain.
    ///
    /// Continuous knobs are `[0, 1)` ([`crate::PARAM_DOMAIN`]) and go through
    /// the same [`crate::clamp_param`] as a tree edit, so the value the live
    /// voice hears is the value the term will hold once the gesture commits.
    /// The two categorical sites that became live send a *category index*, so
    /// the blanket `value.clamp(0.0, 1.0)` the live path used to apply would
    /// have folded all eight wavetables onto the first two.
    pub fn clamp_input(self, x: f64) -> f64 {
        match self {
            ParamMap::TableIndex => x.round().clamp(0.0, 7.0),
            ParamMap::OctaveTrim(_) => x.round().clamp(0.0, 4.0),
            _ => crate::genome::clamp_param(x),
        }
    }

    /// Map a normalized value to the wire value.
    pub fn apply(self, x: f64) -> f64 {
        match self {
            ParamMap::Unit => x,
            ParamMap::Resonance => map::resonance(x),
            ParamMap::Feedback => map::feedback(x),
            ParamMap::FeedbackBipolar => map::feedback_bipolar(x),
            ParamMap::XfadePos => map::xfade_pos(x),
            ParamMap::InputGain => map::input_gain(x),
            ParamMap::TrackSensitivity => map::track_threshold(x),
            ParamMap::TrackDynamics => map::track_dynamics(x),
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
            ParamMap::TableIndex => map::table_cv(x),
            ParamMap::OctaveTrim(baked) => (x - 2.0) - baked as f64,
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
    /// Write a knob value in the site's own units — 0..1 for a continuous
    /// knob, a category index for the two live categorical sites (see
    /// [`ParamMap::clamp_input`], which is why this is no longer a bare
    /// `clamp(0.0, 1.0)`).
    pub fn set_normalized(&self, x: f64) {
        self.value.set(self.map.apply(self.map.clamp_input(x)));
    }
}

/// The node name of the mandatory amp envelope. Every compiled voice has
/// exactly one, and [`CompiledVoice::seed_env_phase`] is the only thing that
/// reaches for it by name.
const AMP_ADSR: &str = "voice:adsr";
/// `Adsr`'s `env` output port id (0–10 V unipolar).
const ADSR_ENV_PORT: PortId = 10;
/// quiver's `Adsr` runs its exponential segments until it is within this of
/// the target, then snaps. Mirrored here so the seeder knows when a segment
/// has finished rather than guessing at a settling time.
const ADSR_EXP_DONE: f64 = 1.0e-3;
/// Ticks [`CompiledVoice::seed_env_phase`] will spend per segment. The
/// envelope is running its fastest possible segment (1 ms) while it seeds, so
/// ~7 time constants is a few hundred ticks at any sane rate; this is the
/// guard rail, not the expected cost.
const SEED_MAX_TICKS: usize = 4096;

/// A compiled, playable voice: the patch plus its external control handles.
pub struct CompiledVoice {
    /// The compiled quiver patch (output already selected and compiled).
    pub patch: Patch,
    /// Pitch control, V/Oct (0 V = C4). Shared with the patch.
    pub pitch: Arc<AtomicF64>,
    /// Gate control (≥ 2.5 V = on). Shared with the patch.
    pub gate: Arc<AtomicF64>,
    /// Live parameter handles, keyed by the knob's trace address
    /// (`node/0#cut`, `amp#attack`, `node/0#table`, `node/0#oct`, …).
    /// Everything the panel can move without a recompile.
    pub params: HashMap<String, ParamHandle>,
    /// Each CAPTURE's record gate, keyed by the node's key (`node/0`): raise
    /// it (to 5 V) to record from the top of the buffer, drop it to stop.
    /// Nothing in the engine raises one, so a measurement render never
    /// records; the host does, then reads the recording with [`Self::take`].
    pub records: HashMap<String, Arc<AtomicF64>>,
    /// A follower's TRACK feeds, by the TRACK's node key: in a voice built by
    /// [`compile_follower`], each TRACK reads its pitch, gate and level from
    /// these instead of tracking its own input. Empty in any other voice.
    pub track_feeds: HashMap<String, TrackFeed>,
    /// Each TRACK's `PitchTracker`, by node key: what [`CompiledVoice::lead`]
    /// reads to feed a follower. Empty in a follower.
    trackers: Vec<Tracker>,
    /// Signal-kind warnings accumulated while wiring (Warn mode).
    pub warnings: Vec<String>,
    /// Where each term node's audio leaves it: trace key → the **name** of the
    /// quiver node carrying its output, and the port id on that node.
    ///
    /// Named rather than `NodeId`-keyed because that is what
    /// `StateObserver::add_subscriptions` takes, and because a name survives
    /// the patch being rebuilt while a `NodeId` does not — the rack asks for a
    /// tap by the key of the module the player is looking at, and the answer
    /// has to still mean something after the next swap.
    ///
    /// **Every tap here already has a consumer**, which is why nothing needs
    /// `StateObserver::sync_output_keepalive`: the genome is a typed tree, so
    /// each module's output feeds exactly one parent and quiver is already
    /// producing it. That call exists for ports nothing reads, and it dirties
    /// the patch — a recompile the audio thread would have to be staged around.
    /// Metering here costs no recompile at all.
    pub taps: HashMap<String, (String, PortId)>,
}

/// A gate that stays high for at most [`TAKE_SECONDS`] after it rises: a
/// CAPTURE's record gate goes through one, so no press records more than a
/// take may hold at the voice's rate. Low until the gate falls and rises
/// again. Allocates nothing.
pub struct RecordWindow {
    sample_rate: f64,
    /// Samples left in this press; 0 once spent.
    left: usize,
    held: bool,
    spec: quiver::port::PortSpec,
}

impl RecordWindow {
    /// A window for a voice at `sample_rate`.
    pub fn new(sample_rate: f64) -> Self {
        use quiver::port::{PortDef, PortSpec, SignalKind};
        Self {
            sample_rate,
            left: 0,
            held: false,
            spec: PortSpec {
                inputs: vec![PortDef::new(0, "in", SignalKind::Gate)],
                outputs: vec![PortDef::new(10, "out", SignalKind::Gate)],
            },
        }
    }

    /// Samples one press may record.
    pub fn max_samples(&self) -> usize {
        (TAKE_SECONDS * self.sample_rate).floor() as usize
    }
}

impl GraphModule for RecordWindow {
    fn port_spec(&self) -> &quiver::port::PortSpec {
        &self.spec
    }

    fn tick(&mut self, inputs: &quiver::port::PortValues, outputs: &mut quiver::port::PortValues) {
        let high = inputs.get_or(0, 0.0) > 2.5;
        if high && !self.held {
            self.left = self.max_samples();
        }
        self.held = high;
        let open = high && self.left > 0;
        if open {
            self.left -= 1;
        }
        outputs.set(10, if open { GATE_TRUE } else { GATE_FALSE });
    }

    fn reset(&mut self) {
        self.left = 0;
        self.held = false;
    }

    fn set_sample_rate(&mut self, sample_rate: f64) {
        if sample_rate > 0.0 && sample_rate.is_finite() {
            self.sample_rate = sample_rate;
        }
    }

    fn type_id(&self) -> &'static str {
        "auracle_record_window"
    }
}

/// The three signals a TRACK plays its branch with, held outside the patch:
/// what a follower voice ([`compile_follower`]) reads in place of a tracker of
/// its own. Written by [`CompiledVoice::lead`].
#[derive(Clone, Debug, Default)]
pub struct TrackFeed {
    /// Pitch, V/Oct.
    pub voct: Arc<AtomicF64>,
    /// Gate, 0 or 5 V.
    pub gate: Arc<AtomicF64>,
    /// Level, 0 to 10 V.
    pub level: Arc<AtomicF64>,
}

/// A TRACK's tracker in a compiled voice, with the routing slots of its
/// pitch, gate and level outputs resolved once, at the compile: reading them
/// every frame is then three indexed loads, where `get_output_value` hashes a
/// `(node, port)` key per read.
#[derive(Clone, Debug)]
struct Tracker {
    key: String,
    id: NodeId,
    /// The slots of ports 10, 11, 12 (pitch, gate, level), valid for
    /// routing generation `generation`.
    slots: [Option<usize>; 3],
    generation: u64,
}

impl Tracker {
    fn new(patch: &Patch, key: String, id: NodeId) -> Tracker {
        Tracker {
            key,
            id,
            slots: [10, 11, 12].map(|port| patch.output_slot(id, port)),
            generation: patch.routing_generation(),
        }
    }

    /// Its three signals after the last tick: by slot while the routing is
    /// the one they were resolved against, by name otherwise (nothing rebuilds
    /// a compiled voice's routing, so that is a guard, not a path).
    fn read(&self, patch: &Patch) -> [f64; 3] {
        let fresh = patch.routing_generation() == self.generation;
        let mut out = [0.0; 3];
        for (i, port) in [10, 11, 12].into_iter().enumerate() {
            out[i] = match (fresh, self.slots[i]) {
                (true, Some(slot)) => patch.output_value_at(slot),
                _ => patch.get_output_value(self.id, port),
            }
            .unwrap_or(0.0);
        }
        out
    }
}

impl CompiledVoice {
    /// Hand this voice's tracked signals, as they stand after its last tick,
    /// to `follower`'s TRACKs (matched by node key). Call it every frame,
    /// after this voice ticks and before the follower does, and the follower
    /// plays each frame's tracked note exactly as this voice does, from its
    /// first frame. Allocates nothing.
    pub fn lead(&self, follower: &CompiledVoice) {
        for t in &self.trackers {
            let Some(feed) = follower.track_feeds.get(&t.key) else {
                continue;
            };
            let [voct, gate, level] = t.read(&self.patch);
            feed.voct.set(voct);
            feed.gate.set(gate);
            feed.level.set(level);
        }
    }

    /// The node keys of this voice's TRACKs, in the order
    /// [`Self::read_tracks`] writes them. Empty in a follower. Allocates; read
    /// it once per compiled voice, not per tick.
    pub fn tracker_keys(&self) -> Vec<String> {
        self.trackers.iter().map(|t| t.key.clone()).collect()
    }

    /// Each TRACK's pitch (V/Oct), gate and level as they stand after this
    /// voice's last tick, three values per TRACK in [`Self::tracker_keys`]
    /// order, into the front of `out`: what [`Self::lead`] hands a follower,
    /// for a host that ticks this voice ahead of its followers by more than a
    /// frame and feeds them each frame from the copy (`LivePoly` renders one
    /// voice's quantum after another). Writes nothing past `out`'s end.
    /// Allocates nothing.
    pub fn read_tracks(&self, out: &mut [f64]) {
        for (i, t) in self.trackers.iter().enumerate() {
            let Some(slot) = out.get_mut(3 * i..3 * i + 3) else {
                return;
            };
            slot.copy_from_slice(&t.read(&self.patch));
        }
    }

    /// The take the CAPTURE at `key` holds right now: what it was compiled
    /// with, or what it has recorded since. `None` only when there is no
    /// CAPTURE there: a take it was compiled with passed the bound, and a
    /// recording stops at [`TAKE_SECONDS`] at this voice's rate (the record
    /// gate goes through [`RecordWindow`]), even into a buffer a longer,
    /// higher-rate take enlarged, so its state always reads as a take.
    ///
    /// Reads the module's own saved state, which is the take's saved form, so
    /// what comes back is bit for bit what it recorded. Allocates; not for the
    /// audio thread.
    pub fn take(&self, key: &str) -> Option<Take> {
        let id = self.patch.get_node_id_by_name(&format!("{key}:capture"))?;
        let (_, _, module) = self.patch.nodes().find(|(n, _, _)| *n == id)?;
        match module.serialize_state() {
            None => Some(Take::empty()),
            Some(state) => serde_json::from_value::<crate::take::SavedTake>(state)
                .ok()
                .and_then(|saved| Take::from_saved(&saved).ok()),
        }
    }

    /// Where the amp envelope is right now, 0..1 — quiver's 0–10 V `env`
    /// output scaled back down.
    ///
    /// Reads the routing's last computed value, so it is meaningful after the
    /// voice has ticked at least once and zero before that.
    pub fn env_phase(&self) -> f64 {
        self.patch
            .get_node_id_by_name(AMP_ADSR)
            .and_then(|n| self.patch.get_output_value(n, ADSR_ENV_PORT))
            .map(|v| (v * 0.1).clamp(0.0, 1.0))
            .unwrap_or(0.0)
    }

    /// Fast-forward this voice's amp envelope to `level` (0..1), with the gate
    /// **already high**, so a note carried across a patch swap resumes where it
    /// was instead of re-attacking from silence.
    ///
    /// ## Why this is a pre-roll and not a setter
    ///
    /// The plan asked for an envelope-phase getter *and setter* on this type.
    /// The getter is above and is honest. The setter cannot be: quiver's
    /// `Adsr` keeps `stage` and `level` private and exposes no parameter,
    /// state-serialization or introspection surface for them (`GraphModule`
    /// gives it `port_spec`/`tick`/`reset`/`set_sample_rate`/`type_id` and
    /// nothing else), so there is no way to write a level into it from
    /// outside. The alternative was to fork the ADSR into this crate to gain
    /// two accessors, which would put a hand-copy of quiver's envelope
    /// arithmetic — `Libm` transcendentals and all — on the critical path of
    /// every patch the instrument has ever rendered. That is a rendered-audio
    /// change dressed as a refactor.
    ///
    /// So the envelope is driven to the level the same way the player would:
    /// the attack and decay CVs are pinned to their fastest (1 ms) settings,
    /// the patch is ticked in silence until `env` arrives, and the CVs are put
    /// back. It costs a few hundred ticks — well inside the swap's silent
    /// window, which already budgets a whole voice compile per quantum — and
    /// it leaves the envelope in the *stage* the level implies, which is the
    /// part that actually matters:
    ///
    /// - below sustain, only Attack can be there, so the rise stops on arrival
    ///   and the envelope goes on attacking at its real rate;
    /// - at or above sustain, the note is in Decay or Sustain, so the rise runs
    ///   to the peak (which is what puts quiver's stage machine into Decay) and
    ///   then falls to the level.
    ///
    /// A side effect worth naming: the pre-roll is real audio, so it also
    /// primes the new voice's filters and delay lines with ~15 ms of its own
    /// signal rather than handing the fade-in an empty reverb. Tails still do
    /// not transfer across a rewire — that is [R3] and is accepted.
    ///
    /// Returns whether anything was seeded.
    ///
    /// [R3]: the panel plan's §4 risk register.
    pub fn seed_env_phase(&mut self, level: f64) -> bool {
        let level = level.clamp(0.0, 1.0);
        let Some(adsr) = self.patch.get_node_id_by_name(AMP_ADSR) else {
            return false;
        };
        // A percussive patch (sustain 0) whose note has already decayed has no
        // phase to carry, and neither has a note that never sounded.
        if level <= 0.0 {
            return false;
        }
        let (Some(attack), Some(decay), Some(sustain)) = (
            self.params.get("amp#attack").cloned(),
            self.params.get("amp#decay").cloned(),
            self.params.get("amp#sustain").cloned(),
        ) else {
            return false;
        };
        let sustain = sustain.value.get();
        let (a0, d0) = (attack.value.get(), decay.value.get());
        // `ParamMap::Unit` on both, and quiver maps 0 V to its 1 ms floor.
        attack.value.set(0.0);
        decay.value.set(0.0);

        let peak = if level < sustain { level } else { 1.0 };
        for _ in 0..SEED_MAX_TICKS {
            let now = self
                .patch
                .get_output_value(adsr, ADSR_ENV_PORT)
                .unwrap_or(0.0)
                * 0.1;
            // The exponential attack snaps to exactly 1.0 (and hands the stage
            // machine over to Decay) once it is within `ADSR_EXP_DONE`.
            if now >= peak - ADSR_EXP_DONE {
                break;
            }
            self.patch.tick();
        }
        if level >= sustain {
            for _ in 0..SEED_MAX_TICKS {
                let now = self
                    .patch
                    .get_output_value(adsr, ADSR_ENV_PORT)
                    .unwrap_or(0.0)
                    * 0.1;
                if now <= level {
                    break;
                }
                self.patch.tick();
            }
        }

        attack.value.set(a0);
        decay.value.set(d0);
        true
    }
}

/// The quietest an AUDIO IN's gain knob goes, in dB: far enough down to tuck
/// a hot line input under a patch, never so far that the knob's bottom is
/// silence (a silent branch is what the vet refuses).
pub const INPUT_GAIN_DB_MIN: f64 = -24.0;
/// The loudest, in dB: quiver's `AudioInput::MAX_GAIN` is 4 (+12 dB), and a
/// quiet microphone needs most of it.
pub const INPUT_GAIN_DB_MAX: f64 = 12.0;
/// The normalized gain at 0 dB: two thirds of the way up the knob. What a
/// player's AUDIO IN starts at.
pub const INPUT_GAIN_UNITY: f64 = -INPUT_GAIN_DB_MIN / (INPUT_GAIN_DB_MAX - INPUT_GAIN_DB_MIN);

/// The gate threshold a TRACK's sensitivity knob reaches at its bottom, in
/// volts on quiver's `PitchTracker` level scale (a full-scale sine reads
/// 10 V): about 12 dB under a full-scale sine, so only a strong input opens it.
pub const TRACK_GATE_LOUD: f64 = 2.5;
/// The threshold at the knob's top, 40 dB lower, so a quiet microphone opens
/// it. Knob centre is quiver's own default, 0.25 V.
pub const TRACK_GATE_QUIET: f64 = 0.025;
/// The tracked level, in volts on the same scale, at which a TRACK with its
/// dynamics all the way up plays the branch at full level (an input 6 dB
/// under a full-scale sine). Louder holds at full level; quieter plays
/// quieter, in proportion.
pub const TRACK_FULL_LEVEL: f64 = 5.0;
/// The normalized sensitivity at quiver's default threshold (0.25 V): the
/// geometric middle of the knob. What a player's TRACK starts at.
pub const TRACK_SENSITIVITY_DEFAULT: f64 = 0.5;

/// Bounded musical mappings from normalized genome parameters.
mod map {
    use super::{INPUT_GAIN_DB_MAX, INPUT_GAIN_DB_MIN, TRACK_GATE_LOUD, TRACK_GATE_QUIET};
    use crate::term::{InputChannel, PitchBand};

    /// A TRACK's sensitivity as its gate threshold, in volts on the tracker's
    /// level scale: geometric, because level is.
    pub fn track_threshold(x: f64) -> f64 {
        TRACK_GATE_LOUD * (TRACK_GATE_QUIET / TRACK_GATE_LOUD).powf(x.clamp(0.0, 1.0))
    }
    /// A TRACK's dynamics as an attenuverter level: `10·x` V is a gain of
    /// `2x`, which takes the VCA to 10 V at `TRACK_FULL_LEVEL` (see the arm).
    pub fn track_dynamics(x: f64) -> f64 {
        10.0 * x.clamp(0.0, 1.0)
    }
    /// The grammar's band as quiver's (the two index orders agree).
    pub fn pitch_range(b: PitchBand) -> quiver::prelude::PitchRange {
        match b {
            PitchBand::Low => quiver::prelude::PitchRange::Low,
            PitchBand::Mid => quiver::prelude::PitchRange::Mid,
            PitchBand::High => quiver::prelude::PitchRange::High,
        }
    }

    /// An AUDIO IN's gain: dB linear across the knob, as a linear factor.
    pub fn input_gain(x: f64) -> f64 {
        let db = INPUT_GAIN_DB_MIN + (INPUT_GAIN_DB_MAX - INPUT_GAIN_DB_MIN) * x;
        10f64.powf(db / 20.0)
    }
    /// The grammar's channel as quiver's (the two index orders agree).
    pub fn input_channel(c: InputChannel) -> quiver::io::InputChannel {
        match c {
            InputChannel::Left => quiver::io::InputChannel::Left,
            InputChannel::Right => quiver::io::InputChannel::Right,
            InputChannel::Both => quiver::io::InputChannel::Both,
        }
    }
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
    ///
    /// The index is an `f64` because the site is live: a smoothed write ramps
    /// *through* the fractional positions between two tables, which is the
    /// morph this port was always capable of and the panel could never ask
    /// for. Integral inputs are the shapes the grammar can name.
    pub fn table_cv(index: f64) -> f64 {
        index / 7.0
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
    /// Where each term node's audio leaves it — see [`CompiledVoice::taps`].
    /// Recorded by [`Self::build`] as the tree is walked, because that is the
    /// only point at which the association between a trace key and the quiver
    /// node that *ends* its chain exists: a term node compiles to anywhere
    /// between one and half a dozen quiver nodes, and which of them carries
    /// the audio out is a fact about the arm that built it.
    taps: Vec<(String, PortRef)>,
    /// The stream every AUDIO IN reads, or `None` for an unbound (silent) one.
    /// See [`compile_with_input`].
    input: Option<Arc<AudioInputStream>>,
    /// Every TRACK's gate output: summed into the amp envelope's gate with the
    /// keys', so a tracked note opens the voice as a key does.
    track_gates: Vec<PortRef>,
    /// Every CAPTURE's record gate, by node key ([`CompiledVoice::records`]).
    records: HashMap<String, Arc<AtomicF64>>,
    /// Building a follower ([`compile_follower`]): every TRACK reads a
    /// [`TrackFeed`] instead of tracking, and its gate is not summed into the
    /// amp's.
    follow: bool,
    /// A follower's feeds ([`CompiledVoice::track_feeds`]).
    track_feeds: HashMap<String, TrackFeed>,
    /// Every constant [`Self::constant`] pinned, so a test build can check,
    /// once the whole patch is wired, that no cable landed on a pinned port
    /// afterwards (the end of [`compile`]).
    #[cfg(test)]
    pins: Vec<(NodeId, &'static str, f64)>,
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
    ///
    /// Since quiver 0.4.0, `set_param_by_id` says so itself: it returns
    /// `false` for a port that already has a cable (it used to return `true`
    /// and let the cable shadow the value). Every pin here is made before any
    /// cable reaches its port and no cable is added after one, which the test
    /// build checks for every patch it compiles (the end of [`compile`]).
    fn constant(&mut self, value: f64, node: NodeId, port: &'static str) -> Result<(), PatchError> {
        #[cfg(test)]
        self.pins.push((node, port, value));
        if self.patch.set_param_by_id(node, port, value) {
            return Ok(());
        }
        // `false` has three causes, all the compiler's mistake and never the
        // tree's: a cable already on the control input, whose sum shadows a
        // base value; an id that is not a control input, which quiver hands to
        // the module's own parameter setter, and the setter refused the value;
        // or no such input or parameter at all. Told apart only here, on the
        // error path.
        let input = self
            .patch
            .nodes()
            .find(|(id, _, _)| *id == node)
            .and_then(|(_, _, m)| m.port_spec().input_by_name(port).map(|p| p.id));
        let cabled = input.is_some_and(|id| {
            let to = PortRef { node, port: id };
            self.patch.cables().iter().any(|c| c.to == to)
        });
        if cabled {
            Err(PatchError::CompilationFailed(format!(
                "pinned constant `{port}` would be shadowed by the cable already on it"
            )))
        } else if self.patch.get_param_by_id(node, port).is_some() {
            Err(PatchError::CompilationFailed(format!(
                "`{port}` is not a control input, and the module refused {value} for it"
            )))
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
    /// one). That case builds a follower with nothing on its input, which
    /// emits 0 V: the grammar and the panel can both express "follower on an
    /// oscillator", the honest compilation of it is a cable carrying nothing,
    /// and every knob the rack advertises for it still gets its live handle.
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
                //
                // A source has no input to tap. This used to return `Ok(None)`
                // — wire nothing — which was honest about the sound and wrong
                // about the panel: the rack still advertised the owner's
                // `mdepth` and the follower's own knobs, none of which had a
                // live handle, so a drag on any of them fell back to a full
                // patch swap. The follower is now built regardless: its input
                // port is left unpatched and reads its default of 0 V, so it
                // emits exactly 0 V, the term above it compiles as any other,
                // every advertised knob gets its handle, and the cable that
                // finally reaches the destination carries `+0.0` — which adds
                // nothing to any sample (`a_follower_on_a_source_changes_no_sample`
                // pins that bit-for-bit).
                let f = self
                    .patch
                    .add(format!("{key}:follow"), EnvelopeFollower::new(self.sr()));
                if let Some(input) = owner_input {
                    self.feed(input, f.in_("in"))?;
                }
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
            ModNode::Steps {
                rate,
                length,
                slew,
                values,
                ..
            } => {
                // Our own module rather than quiver's `StepSequencer`, whose
                // values are internal state: every one of the eleven sites
                // here is a live knob on a port, so dragging a step bar is an
                // atomic write and not a recompile. The ports take the
                // normalized knob straight through and the musical maps live
                // in `crate::steps`, next to the clock that uses them.
                let seq = self
                    .patch
                    .add(format!("{key}:steps"), StepsCv::new(self.sr()));
                let knobs = [(*rate, "rate"), (*length, "length"), (*slew, "slew")]
                    .into_iter()
                    .chain(
                        values
                            .iter()
                            .enumerate()
                            .map(|(i, v)| (*v, StepsCv::value_port(i))),
                    );
                for ((raw, port), site) in knobs.zip(STEPS_SITES) {
                    self.knob(key, site, raw, ParamMap::Unit, false, seq.in_(port))?;
                }
                // The transport position for tempo sync: a live handle that is
                // not a genome site (the `~` keeps it out of any address a
                // term can produce), free-running until the live engine
                // drives it.
                let sync = Arc::new(AtomicF64::new(crate::steps::SYNC_FREE));
                let n = self.patch.add(
                    format!("{key}:sync!"),
                    ExternalInput::cv_bipolar(Arc::clone(&sync)),
                );
                self.patch.connect(n.out("out"), seq.in_("sync"))?;
                self.params.insert(
                    format!("{key}#{STEPS_SYNC_SITE}"),
                    ParamHandle {
                        value: sync,
                        map: ParamMap::Unit,
                    },
                );
                // ±5 V, like an LFO — so it takes the bipolar depth taper.
                (seq.out("out"), false)
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
                // [`ModNode::normalized`]. Nothing reaches this today — a
                // `Follow` on a source now builds (above) and every other
                // empty branch is folded away before compile — but the fold
                // stays, so a future term that compiles to nothing degrades
                // the same way rather than to a stuck constant.
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
    ///
    /// A third cable lands here too, and it is the reason `oct` is a live
    /// site: an [`ExternalInput`] carrying an **octave trim**, zero at compile
    /// time, that the panel writes when the octave chip is cycled. Changing
    /// the octave used to be a recompile — a fade-out, a per-quantum voice
    /// rebuild and a re-attack of every held note, for a number that is one
    /// addition on a CV wire. See [`ParamMap::OctaveTrim`] for why the live
    /// value is a *trim* rather than the octave itself; the short version is
    /// that a trim of `+0.0` is the additive identity in the gather sum and an
    /// absolute octave is not, so this costs a node and no samples.
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
        self.knob(
            key,
            "oct",
            (octave + 2) as f64,
            ParamMap::OctaveTrim(octave),
            // The trim is signed, and the port is `CvBipolar`; a unipolar
            // `ExternalInput` here would be a validation warning on every
            // source in every patch.
            true,
            node.in_("in"),
        )?;
        Ok(node.in_("in"))
    }

    fn sr(&self) -> f64 {
        self.patch.sample_rate()
    }

    /// Build the audio subtree rooted at `node`; returns its output signal.
    /// Build `node` and record where its audio came out.
    ///
    /// A wrapper rather than a line in each of the thirty-odd arms of
    /// [`Self::build_node`]: the tap is the same fact for every kind — the
    /// `Sig` the arm returned — and writing it once means a new production
    /// cannot forget to. The left channel is the tap for a stereo `Sig`;
    /// metering both would report a width, not a level, and the flow
    /// animation asks how much signal is on the wire.
    fn build(&mut self, node: &AudioNode, key: &str) -> Result<Sig, PatchError> {
        let sig = self.build_node(node, key)?;
        self.taps.push((key.to_string(), sig.left));
        Ok(sig)
    }

    fn build_node(&mut self, node: &AudioNode, key: &str) -> Result<Sig, PatchError> {
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
                let out = noise.out(color.port_name());
                // quiver's pink is a 16-row Voss generator, so its 1/f slope
                // runs down to ~1 Hz: measured, 22 % of its energy sits below
                // 20 Hz, with a DC-to-RMS ratio of 0.13. That is inaudible,
                // and it is not harmless — loudness normalization is
                // K-weighted and ignores it, so it spends the peak ceiling:
                // behind a lowpass `Noise Wash` measured 77 % sub-40 Hz and
                // gave up the level it should have had. The voice's DC
                // blocker is the same 20 Hz corner, applied at the source.
                let out = match color {
                    NoiseColor::Pink => self.dc_blocker(&format!("{key}:sub"), out)?,
                    NoiseColor::White => out,
                };
                Ok(Sig::mono(out))
            }
            // A `Vca` with nothing patched into its audio input, which is a
            // constant zero: quiver reads an unpatched port as 0.0, and the
            // gain that multiplies it cannot make it anything else.
            //
            // Chosen over the obvious `Offset::new(0.0)` because `Offset`'s
            // ports are `CvBipolar`, so feeding one to an audio consumer would
            // raise an Audio/CV signal-kind warning on every patch holding a
            // hole. `Vca` is `Audio` in and `Audio` out, so this production
            // adds no cable, no warning, and no new class to the allowlist in
            // `every_prior_sample_compiles`.
            AudioNode::Silence { .. } => {
                let z = self.patch.add(format!("{key}:silence"), Vca::new());
                Ok(Sig::mono(z.out("out")))
            }
            // quiver's `AudioInput` on the caller's stream. Its `out` carries
            // the chosen channel at quiver's audio level (a full-scale input is
            // ±5 V, as a full-scale oscillator is), so everything downstream
            // meets it as it would meet a source. `input` is not compiled in:
            // which stream a node reads is the caller's binding, one stream for
            // every slot today (see `compile_with_input`).
            //
            // The gain is a live knob into the module's own `gain` port
            // (unipolar CV into unipolar CV, so no new warning class), and the
            // channel is baked like a VCO's waveform: changing it recompiles.
            AudioNode::AudioIn { gain, channel, .. } => {
                let module = match &self.input {
                    Some(stream) => AudioInput::new(Arc::clone(stream)),
                    None => AudioInput::unbound(),
                }
                .with_channel(map::input_channel(*channel));
                let n = self.patch.add(format!("{key}:audio_in"), module);
                self.knob(
                    key,
                    "gain",
                    *gain,
                    ParamMap::InputGain,
                    false,
                    n.in_("gain"),
                )?;
                Ok(Sig::mono(n.out("out")))
            }
            AudioNode::Wavetable {
                table,
                octave,
                morph,
                mod_depth,
                modulation,
                ..
            } => {
                let sr = self.sr();
                let wt = self
                    .patch
                    .add_boxed(format!("{key}:wavetable"), off_frame(|| Wavetable::new(sr)));
                // Detune 0.5 is the no-offset centre of `map::detune_voct`:
                // this module has no detune site, but pitch still goes
                // through the same Offset every other source uses.
                self.wire_pitch(key, *octave, 0.5, wt.in_("v_oct"))?;
                // The table is an enum site, and it used to be a baked default
                // on the reasoning that "changing it is a recompile either
                // way". That reasoning was circular: it was a recompile
                // *because* it was baked. The port is a crossfade position —
                // see [`map::table_cv`], which exists entirely to explain that
                // — so a live write does not switch tables, it **morphs**
                // between them, over the live path's own ~25 ms smoothing
                // ramp. This is the one control the module is named for, and
                // it was the only one that cost a fade-out, a voice rebuild
                // and a re-attack of every held note.
                //
                // Bit-exact with the constant it replaces: quiver writes an
                // unpatched port's default and sums a patched one's cables
                // starting from `+0.0`, and `0.0 + table_cv` is `table_cv`.
                self.knob(
                    key,
                    "table",
                    table.index() as f64,
                    ParamMap::TableIndex,
                    false,
                    wt.in_("table"),
                )?;
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
                let sr = self.sr();
                let ps = self
                    .patch
                    .add_boxed(format!("{key}:shift"), off_frame(|| PitchShifter::new(sr)));
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
            // The input plays `/0`. The tracker is built on `/1` first, and
            // while `/0` is built its pitch and gate stand in for the keys':
            // every source, pluck, mod envelope and capture in the played
            // branch reads them where it would read the keys. Restored before
            // the result is looked at, so a sibling branch (a mix's other
            // input) is still played by the keys.
            AudioNode::Track {
                band,
                sensitivity,
                dynamics,
                input,
                listen,
                ..
            } => {
                let (voct, gate, level) = if self.follow {
                    // A follower: the leading voice tracks, this one plays what
                    // it tracked. Nothing listens here, so `/1` is not built.
                    let feed = TrackFeed::default();
                    let v = self.patch.add(
                        format!("{key}:track_voct"),
                        ExternalInput::voct(Arc::clone(&feed.voct)),
                    );
                    let g = self.patch.add(
                        format!("{key}:track_gate"),
                        ExternalInput::gate(Arc::clone(&feed.gate)),
                    );
                    let l = self.patch.add(
                        format!("{key}:track_level"),
                        ExternalInput::cv(Arc::clone(&feed.level)),
                    );
                    self.track_feeds.insert(key.to_string(), feed);
                    (v.out("out"), g.out("out"), l.out("out"))
                } else {
                    let heard = self.build(listen, &format!("{key}/1"))?;
                    let sr = self.sr();
                    let range = map::pitch_range(*band);
                    let tr = self.patch.add_boxed(
                        format!("{key}:track"),
                        off_frame(move || PitchTracker::new(sr).with_range(range)),
                    );
                    self.feed(heard, tr.in_("in"))?;
                    self.knob(
                        key,
                        "tsens",
                        *sensitivity,
                        ParamMap::TrackSensitivity,
                        false,
                        tr.in_("threshold"),
                    )?;
                    (tr.out("voct"), tr.out("gate"), tr.out("level"))
                };
                let keys = (self.pitch_out, self.gate_out);
                self.pitch_out = voct;
                self.gate_out = gate;
                let played = self.build(input, &format!("{key}/0"));
                (self.pitch_out, self.gate_out) = keys;
                let played = played?;
                // A follower keeps its own key's gate on its amp: it sounds for
                // its note, as the other voices of a chord do.
                if !self.follow {
                    self.track_gates.push(gate);
                }
                // Dynamics: a VCA on the played branch whose CV is
                // `10 + 2d·(level − TRACK_FULL_LEVEL)`, i.e. `10·(1 − d) +
                // 2d·level`: unity at d = 0, the tracked level (full at
                // TRACK_FULL_LEVEL, the VCA clamps above) at d = 1. Built from
                // an offset, the live depth knob on an attenuverter, and an
                // offset back up, so turning it costs no recompile.
                let dip = self
                    .patch
                    .add(format!("{key}:tdip"), Offset::new(-TRACK_FULL_LEVEL));
                self.patch.connect(level, dip.in_("in"))?;
                let depth = self.patch.add(format!("{key}:tdepth"), Attenuverter::new());
                self.patch.connect(dip.out("out"), depth.in_("in"))?;
                self.knob(
                    key,
                    "tdyn",
                    *dynamics,
                    ParamMap::TrackDynamics,
                    false,
                    depth.in_("level"),
                )?;
                let cv = self.patch.add(format!("{key}:tcv"), Offset::new(10.0));
                self.patch.connect(depth.out("out"), cv.in_("in"))?;
                let left = self.track_vca(key, "", played.left, cv.out("out"))?;
                Ok(match played.right {
                    Some(r) => Sig::stereo(left, self.track_vca(key, "R", r, cv.out("out"))?),
                    None => Sig::mono(left),
                })
            }
            // quiver's `Capture`, holding the take. `/0` is built and fed to
            // its input, so the host can record it through the record gate;
            // what the arm hands on is the playback. The buffer is quiver's
            // default length at this rate (the take's bound, `TAKE_SECONDS`),
            // and a take recorded at another rate plays at its own speed.
            AudioNode::Capture {
                play, input, take, ..
            } => {
                let rec = self.build(input, &format!("{key}/0"))?;
                let sr = self.sr();
                let take = take.clone();
                let cap = self.patch.add_boxed(
                    format!("{key}:capture"),
                    off_frame(move || {
                        let mut c = Capture::with_seconds(sr, TAKE_SECONDS);
                        if let Some(rate) = take.sample_rate() {
                            c.set_recording(take.samples(), rate);
                        }
                        c
                    }),
                );
                self.feed(rec, cap.in_("in"))?;
                let record = Arc::new(AtomicF64::new(GATE_FALSE));
                let gate = self.patch.add(
                    format!("{key}:rec"),
                    ExternalInput::gate(Arc::clone(&record)),
                );
                // At most `TAKE_SECONDS` of recording per press, at this
                // rate: the buffer can be longer than that (a higher-rate
                // take loaded into it grows it), and a longer recording would
                // be a take its own loader refuses.
                let window = self
                    .patch
                    .add(format!("{key}:recwin"), RecordWindow::new(self.sr()));
                self.patch.connect(gate.out("out"), window.in_("in"))?;
                self.patch.connect(window.out("out"), cap.in_("record"))?;
                self.records.insert(key.to_string(), record);
                // Pitched by whoever plays this branch: C4 (0 V) plays the
                // take at the speed it was recorded.
                self.patch.connect(self.pitch_out, cap.in_("voct"))?;
                match play {
                    CaptureMode::Once => {
                        self.patch.connect(self.gate_out, cap.in_("trig"))?;
                    }
                    CaptureMode::Hold => {
                        self.patch.connect(self.gate_out, cap.in_("gate"))?;
                    }
                    CaptureMode::Loop => {
                        self.constant(GATE_TRUE, cap.id(), "loop")?;
                        self.patch.connect(self.gate_out, cap.in_("gate"))?;
                    }
                }
                Ok(Sig::mono(cap.out("out")))
            }
        }
    }

    /// One channel of a TRACK's dynamics: a VCA on `from` under `cv`.
    fn track_vca(
        &mut self,
        key: &str,
        side: &str,
        from: PortRef,
        cv: PortRef,
    ) -> Result<PortRef, PatchError> {
        let v = self.patch.add(format!("{key}:tvca{side}"), Vca::new());
        self.patch.connect(from, v.in_("in"))?;
        self.patch.connect(cv, v.in_("cv"))?;
        Ok(v.out("out"))
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
        // The played branch is what is heard; `/1` reaches only the tracker,
        // as a compressor's sidechain reaches only its detector.
        AudioNode::Track { input, .. } => makes_dc(input),
        // A take recorded from an input can carry the input's offset, so a
        // capture pays for the blocker as an AUDIO IN does.
        AudioNode::Capture { .. } => true,
        AudioNode::Vco { .. }
        | AudioNode::Supersaw { .. }
        | AudioNode::Noise { .. }
        | AudioNode::Wavetable { .. }
        | AudioNode::Pluck { .. }
        | AudioNode::Formant { .. }
        // A constant zero has no offset to block.
        | AudioNode::Silence { .. } => false,
        // A host input can carry an offset of its own (a cheap interface's
        // converter, a phantom-powered mic settling), and the amp envelope
        // would turn it into a thump on every note. So an input always pays
        // for the blocker.
        AudioNode::AudioIn { .. } => true,
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

/// The deepest nesting `compile` will attempt: audio depth plus the deepest
/// modulation chain hanging off it, which is how deep the compiler's by-value
/// recursion actually goes.
///
/// **A stack guard, not a grammar ceiling.** The ceilings on what a hand may
/// build are [`crate::mutate::MAX_DEPTH`] and [`crate::mutate::MAX_MOD_DEPTH`],
/// enforced by `validate_tree` on every edit route. This is the line behind
/// them: a shared patch file or a saved session is parsed straight into a
/// `PatchTree`, and until this constant existed nothing between that parse and
/// the recursive compiler asked how deep the term was. At ~60 nested nodes the
/// compiler's frames (38 KB and up) overflow the wasm build's 8 MB stack, and a
/// wasm trap is not an error the caller sees — it poisons the engine for the
/// rest of the session. 32 is well above any tree a session written under any
/// ceiling this crate has ever shipped can hold (`MAX_SIZE` is 24, so a valid
/// tree is never deeper than 24 audio nodes), and well below the overflow.
pub const COMPILE_MAX_NESTING: usize = 32;

/// Build a module on the heap from outside the recursive compile frame.
///
/// `build_node` recurses once per level of the audio tree, and every module a
/// match arm constructs by value is laid out in *that* frame, whether or not
/// the arm runs. quiver's `Wavetable` is 128 KiB inline (its tables) and
/// `PitchShifter` 38 KiB, so while they were built in place each level of the
/// tree reserved over 256 KiB of stack: a patch eight levels deep overflowed
/// a 2 MiB thread (measured, a test thread compiling a filter stack past the
/// depth ceiling). Built here, in a frame of their own that is gone before
/// the recursion continues, they cost the recursion nothing.
#[inline(never)]
fn off_frame<M: GraphModule + 'static>(make: impl FnOnce() -> M) -> Box<dyn GraphModule> {
    Box::new(make())
}

/// Compile a patch term into a playable voice at the given sample rate, with
/// every AUDIO IN unbound (silent).
///
/// Right for every caller that does not play an input: the rack's knob
/// table, PERFORM's live-knob list, and any patch that does not listen
/// ([`PatchTree::listens`]), which compiles to the same voice either way. A
/// caller that plays a patch that listens binds a stream with
/// [`compile_with_input`].
///
/// Refuses, with [`PatchError::CompilationFailed`], a term nested deeper than
/// [`COMPILE_MAX_NESTING`] — an error every caller already handles, in place
/// of a stack overflow none of them can.
pub fn compile(tree: &PatchTree, sample_rate: f64) -> Result<CompiledVoice, PatchError> {
    compile_with_input(tree, sample_rate, None)
}

/// [`compile`], with every [`AudioNode::AudioIn`] reading `input`.
///
/// One stream for every AUDIO IN in the patch, whatever its `input` slot: the
/// session's audition clip in a measurement render
/// (`auracle_features::render_phrase`, on a host-clock stream), and the live
/// voice's one input in the instrument (`auracle_wasm`'s `LivePoly`, on a
/// cursor stream). Every compiled copy of a patch may share the one `Arc`:
/// quiver's `AudioInput` fans one stream out to any number of readers.
/// `None` builds each AUDIO IN on a stream nothing writes, so it is silent.
pub fn compile_with_input(
    tree: &PatchTree,
    sample_rate: f64,
    input: Option<&Arc<AudioInputStream>>,
) -> Result<CompiledVoice, PatchError> {
    compile_voice(tree, sample_rate, input, false)
}

/// [`compile_with_input`] for a voice that plays *under* another one, as a
/// chord's second voice does: every TRACK in it reads the leading voice's
/// tracked pitch, gate and level ([`CompiledVoice::track_feeds`], written by
/// [`CompiledVoice::lead`]) instead of tracking the input itself, and its
/// amp keeps its own key's gate.
///
/// So a chord voice that joins mid-phrase plays the note the input is on from
/// its first frame, rather than C4 until a cold tracker settles, and it stops
/// with its key, rather than sounding for as long as the input does. For a
/// patch with no TRACK this is [`compile_with_input`] exactly.
pub fn compile_follower(
    tree: &PatchTree,
    sample_rate: f64,
    input: Option<&Arc<AudioInputStream>>,
) -> Result<CompiledVoice, PatchError> {
    compile_voice(tree, sample_rate, input, true)
}

fn compile_voice(
    tree: &PatchTree,
    sample_rate: f64,
    input: Option<&Arc<AudioInputStream>>,
    follow: bool,
) -> Result<CompiledVoice, PatchError> {
    let nesting = tree.root.depth() + tree.root.max_mod_depth();
    if nesting > COMPILE_MAX_NESTING {
        return Err(PatchError::CompilationFailed(format!(
            "patch nests {nesting} levels deep; the compiler stops at {COMPILE_MAX_NESTING}"
        )));
    }
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
        taps: Vec::new(),
        input: input.cloned(),
        track_gates: Vec::new(),
        records: HashMap::new(),
        follow,
        track_feeds: HashMap::new(),
        #[cfg(test)]
        pins: Vec::new(),
    };

    // The evolved tree.
    let audio_out = c.build(&tree.root, "node")?;

    // Mandatory voice stage: amp ADSR → VCA → limiter → stereo out.
    let adsr = c.patch.add("voice:adsr", Adsr::new(sample_rate));
    c.patch.connect(c.gate_out, adsr.in_("gate"))?;
    // A TRACK's gate opens the voice the way a key does. quiver sums every
    // cable into a port, and the envelope reads anything above 2.5 V as high,
    // so the sum is an OR: a key, a tracked note, or both (10 V) play it, and
    // a key let go while the input still sounds (10 V to 5 V) holds it open.
    for g in std::mem::take(&mut c.track_gates) {
        c.patch.connect(g, adsr.in_("gate"))?;
    }
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
    //
    // Decided by the term alone. There used to be an `AUR_DCB_ALWAYS`
    // environment override here (a measurement hook from when the blocker was
    // made conditional), which meant a process with it set rendered a different
    // voice — and wrote different φ into the same persistent cache namespace —
    // for the same `(term, spec)`. The render is a function of its inputs, and
    // the environment is not one of them.
    let block_dc = makes_dc(&tree.root);
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

    // Every pinned constant still drives its port now that the whole patch is
    // wired: a cable connected to a pinned port *after* the pin would shadow
    // it in silence (gather sums the cables and ignores the base value), and
    // quiver 0.4.0's `set_param_by_id` returns `false` for exactly that port,
    // so asking it again with the same value is the check. Test builds only:
    // the grammar's gates compile every preset, hundreds of random trees and
    // every edit op at every node through here.
    #[cfg(test)]
    for &(node, port, value) in &c.pins {
        assert!(
            c.patch.set_param_by_id(node, port, value),
            "pinned constant `{port}` on {node:?} is shadowed by a cable connected after it"
        );
    }

    let params = std::mem::take(&mut c.params);
    let records = std::mem::take(&mut c.records);
    let track_feeds = std::mem::take(&mut c.track_feeds);
    let recorded = std::mem::take(&mut c.taps);
    let mut patch = c.patch;
    patch.set_output(out.id());
    patch.compile()?;
    let warnings = patch.warnings().to_vec();

    // Resolve each tap's `NodeId` back to the name it was added under. Done in
    // one pass here rather than by threading names through the builder: every
    // `Patch::add` call site would otherwise have to remember to record one,
    // and `Patch::nodes` already knows the answer for all of them.
    let names: HashMap<NodeId, &str> = patch.nodes().map(|(id, name, _)| (id, name)).collect();
    let taps = recorded
        .into_iter()
        .filter_map(|(key, port)| {
            names
                .get(&port.node)
                .map(|name| (key, (name.to_string(), port.port)))
        })
        .collect();

    // In key order, so every voice of a patch lists its TRACKs alike.
    let mut trackers: Vec<Tracker> = names
        .iter()
        .filter_map(|(id, name)| {
            name.strip_suffix(":track")
                .map(|key| Tracker::new(&patch, key.to_string(), *id))
        })
        .collect();
    trackers.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(CompiledVoice {
        patch,
        pitch,
        gate,
        params,
        records,
        track_feeds,
        trackers,
        warnings,
        taps,
    })
}

/// The impulse response of a lowpass [`AudioNode::Filter`] (`SvfLp`) at
/// normalized `cutoff` and `resonance`, as the compiler wires it and heard on
/// the phrase's held note (C4, `voct` 0, where keytracking moves the corner by
/// nothing): `len` samples at `sample_rate`, from a unit impulse.
///
/// This is the grammar's DSP, not a formula for it: quiver's [`Svf`] driven
/// with the same values [`compile`] gives it (the cutoff knob as is, the
/// resonance knob through [`map::resonance`], keytracking at
/// [`KEYTRACK_AMT`]). The filter is linear, so its response is the whole
/// story of what it does to any sound; the app's lesson on filters draws its
/// spectrum (`auracle_features::explain::response_bands`). Pinned against a
/// compiled filter over white noise by `lowpass_response_is_the_compiled_filter`.
pub fn lowpass_response(cutoff: f64, resonance: f64, sample_rate: f64, len: usize) -> Vec<f64> {
    let mut impulse = vec![0.0; len];
    if let Some(first) = impulse.first_mut() {
        *first = 1.0;
    }
    lowpass_apply(&mut impulse, cutoff, resonance, sample_rate);
    impulse
}

/// `x` through the same lowpass [`lowpass_response`] measures, in place: quiver's
/// `Svf` driven as the compiler drives it, its corner held where the held note
/// (C4) puts it. What the app's lesson on filters plays when the filter cannot
/// go inside a patch (one more module would break the size ceilings): the
/// filter then follows the whole voice, at one corner for every note.
pub fn lowpass_apply(x: &mut [f64], cutoff: f64, resonance: f64, sample_rate: f64) {
    let mut svf = Svf::new(sample_rate);
    let mut inputs = PortValues::new();
    let mut outputs = PortValues::new();
    for s in x.iter_mut() {
        inputs.clear();
        // Ports as `Svf::new` declares them: in, cutoff, res, keytrack,
        // keytrack amount; the lowpass is output 10.
        inputs.set(0, *s);
        inputs.set(1, cutoff.clamp(0.0, 1.0));
        inputs.set(2, map::resonance(resonance.clamp(0.0, 1.0)));
        inputs.set(4, 0.0);
        inputs.set(5, KEYTRACK_AMT);
        outputs.clear();
        svf.tick(&inputs, &mut outputs);
        *s = outputs.get_or(10, 0.0);
    }
}

/// The corner a lowpass [`AudioNode::Filter`]'s `cutoff` knob sets on the
/// held note (C4), in Hz: quiver's `20 · 1000^x`, which is also what PATCH
/// prints for the knob.
pub fn cutoff_hz(cutoff: f64) -> f64 {
    20.0 * 1000f64.powf(cutoff.clamp(0.0, 1.0))
}

#[cfg(test)]
mod tests;
