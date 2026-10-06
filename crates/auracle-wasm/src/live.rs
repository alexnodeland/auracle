//! The live performance voice: N copies of one compiled patch, played from a
//! keyboard in real time inside an AudioWorklet.
//!
//! This is the "instrument" half of the app (the `WasmEngine` in the worker
//! is the "brain"). It shares the exact compilation path evolution uses —
//! `auracle_grammar::compile_with_input` with the mandatory ADSR → VCA →
//! Limiter chain — so what you play is byte-for-byte the patch that was
//! evolved, limiter included. Where evolution binds an AUDIO IN to the
//! audition clip, the instrument binds it to the live input
//! ([`LivePoly::write_input`]), one stream for every voice.
//!
//! ## Audio-thread discipline (no clicks, no zipper, no GC)
//!
//! - **Zero allocation per quantum**: [`LivePoly::process_ptr`] renders into
//!   a persistent internal buffer and returns a pointer; the worklet views
//!   wasm memory directly. The live input goes the other way through a
//!   persistent buffer of its own ([`LivePoly::input_ptr`]) and a stream
//!   built once, in [`LivePoly::new`]. The `Vec`-returning [`LivePoly::process`] exists
//!   for native tests only.
//! - **Parameter smoothing**: [`LivePoly::set_param`] never jumps a value.
//!   It sets a target; every quantum a one-pole ramp advances the live
//!   atomics toward it (~25 ms settle), so knob sweeps cannot zipper.
//! - **Click-free patch swaps**: [`LivePoly::set_patch`] parses eagerly but
//!   swaps lazily — fade the output to silence (~6 ms), rebuild **one voice
//!   per quantum while silent** (compile overruns are inaudible at zero
//!   gain), re-press every held note on the new voices, fade back in. A
//!   held chord survives rewiring.
//! - **Envelope carry**: re-pressing restarts an ADSR from zero, so a
//!   sustained pad used to swell in again on every structural edit — the edit
//!   read as an event of its own rather than as a change to the sound. Each
//!   carried note's amp envelope phase is read off the outgoing voice and
//!   seeded into the new one (`auracle_grammar::CompiledVoice::seed_env_phase`) with no
//!   falling edge, so held notes never re-attack. Filter, delay and reverb
//!   tails cannot transfer across a rewire and still die; that is accepted.
//! - Released voices keep ticking through their tails and are parked once
//!   effectively silent, so idle polyphony costs nothing.
//! - **The open voice**: a patch that listens (or tracks) is built one voice
//!   longer, and [`LivePoly::set_open`] holds that voice open at C4
//!   ([`OPEN_NOTE`]), outside the keys' allocation, so the input sounds
//!   through the patch with no key down. In a patch with a TRACK it is the
//!   lead: held at C4 like any open voice, it plays the note it tracks, and
//!   every key's voice follows it ([`Lead`]). A patch that neither listens nor
//!   tracks has none, so holding it open is silent.
//!
//! ## What a patch swap costs, and whom
//!
//! A swap **compiles on the render thread.** [`LivePoly::set_patch`] parses the
//! tree JSON in the worklet's `onmessage` (render thread), and the rebuild
//! stage runs one full `auracle_grammar::compile` per voice per quantum — the
//! same compiler evolution uses, constructing every quiver module by value —
//! for `n_voices` quanta. "A dropped quantum of silence is inaudible" is true
//! of *this node*: its own gain is zero for the whole rebuild. It is not true
//! of the rest of the graph. The duel auditions, the master gain, the
//! analysers and the recorder share the render thread, and a compile that
//! overruns the 2.9 ms quantum is a glitch in **their** output, not this one's.
//! On the machines measured a single voice compiles well inside a quantum; a
//! large patch on a slow laptop does not always. The design that removes this
//! — compile in the engine worker and transfer a ready voice, or at least
//! parse off-thread — is out of scope for now and recorded here so that the
//! next person to see a click on a structural edit knows where it comes from.
//! The parse is the take's too: a sound whose CAPTURE holds a 4 s take spends
//! 6-7 ms decoding it here on every swap (`examples/take_cost.mjs`).
//!
//! **RECORD costs the render thread a copy.** Measured with
//! `examples/take_cost.mjs` (V8, one thread, 48 kHz): compiling one voice of a
//! sound for a recorder took at most 0.07 ms over the 62 presets, but
//! encoding a 4 s take (`take_json`, 1 MB of JSON) took 6.3 ms, and compiling
//! a CAPTURE that already holds one (its take decoded from the tree) 6.3 ms:
//! over two quanta of the 2.67 ms each, in the port handler, a glitch for
//! everything else on the thread. And the recorder rendered its voice every
//! quantum while it rolled (up to 0.66 ms). So none of that is here: while
//! RECORD is lit the worklet only copies its second input into a buffer main
//! handed it, and the engine worker renders the take from that buffer
//! ([`render_take`]), compile, render and encode.
//!
//! Per-quantum work outside a swap allocates nothing: the arpeggiator reuses
//! two buffers sized for a full keyboard, and knob smoothers index a table of
//! live parameter handles that is rebuilt once per swap (`param_slots`), so a
//! knob write is a linear scan and an atomic store rather than a `String`
//! allocation and a `HashMap` lookup per voice. Metering allocates while it is
//! on (see [`Meter`]); ● REC's recorder while it rolls (a slice a quantum).
//! RECORD on a CAPTURE allocates nothing there: a copy into a buffer main
//! handed over (above).

use std::sync::Arc;

use auracle_grammar::{
    compile_follower, compile_with_input, AudioNode, ParamMap, PatchTree, TrackFeed,
};
use quiver::observer::{ObservableValue, StateObserver, SubscriptionTarget};
use quiver::{AtomicF64, AudioInputStream};
use wasm_bindgen::prelude::*;

const GATE_ON: f64 = 5.0;
/// Channels of the live input every AUDIO IN reads: a stereo input, which a
/// mono one fills on both sides.
pub const LIVE_INPUT_CHANNELS: usize = 2;
/// The most frames one write of the live input holds. Web Audio's render
/// quantum is 128 frames; this leaves room for a host that renders larger
/// blocks, and is all the stream allocates.
pub const LIVE_INPUT_FRAMES: usize = 1024;
/// The key the open voice is held at ([`LivePoly::set_open`]): C4, which is
/// 0 V on the pitch CV (`press` maps note `n` to `(n - 60) / 12`), the voice's
/// home pitch, and the note the audition phrase opens on.
pub const OPEN_NOTE: u8 = 60;
/// |L|+|R| below this counts as silence for voice parking.
const SILENCE_EPS: f64 = 1.0e-6;
/// Consecutive silent frames (post-release) before a voice is parked.
const PARK_AFTER: u32 = 4096;
/// Per-frame fade step for patch swaps (≈6 ms at 44.1 kHz).
const FADE_STEP: f32 = 1.0 / 256.0;
/// One-pole smoothing factor per quantum for parameter ramps.
const SMOOTH_COEFF: f64 = 0.3;
/// Snap threshold ending a parameter ramp.
const SMOOTH_EPS: f64 = 1.0e-4;
/// quiver audio is nominal ±5 V; the float domain is ±1.0. Offline rendering
/// applies the same divisor (`auracle_features::render`), and the LUFS makeup
/// gain that rides every patch was fitted in that ±1.0 domain — so the live
/// path **must** normalize identically or it runs ~14 dB hot into the ceiling.
const VOLT_SCALE: f32 = 1.0 / 5.0;
/// Master brickwall ceiling, just under full scale.
const MASTER_CEILING: f32 = 0.98;
/// Master limiter release coefficient per sample (≈80 ms at 44.1 kHz).
const MASTER_RELEASE: f32 = 2.8e-4;
/// The range [`LivePoly::set_makeup`] accepts, dB. The makeup is the gain that
/// brings a patch's phrase to the audition target (`crate::level`), and on a
/// fresh pool that spans −18 to +49 dB. The top is the vet's silence floor
/// (`VetConfig::rms_floor`, −80 dBFS RMS), about 60 dB under the target, so any
/// patch the pool can admit fits; the bottom leaves a few dB under the loudest
/// phrase there can be (the per-voice limiter holds each voice at full scale,
/// and the phrase sounds two at once). What a makeup fitted on the phrase gets
/// wrong about a note held past it is the [`Leveler`]'s to catch, not this
/// clamp's.
pub(crate) const MAKEUP_MIN_DB: f64 = -24.0;
pub(crate) const MAKEUP_MAX_DB: f64 = 60.0;
/// Where the [`Leveler`] holds a sustained sound, in LU over the audition
/// target (`auracle_features::TARGET_LUFS`, so −10 LUFS). Eight is where the
/// loudest moments of the matched auditions already are (their 400 ms maxima
/// reach 7–8 LU over), so the keys are never held louder than a ▶ can be. A
/// single note of a matched patch sits near the target and never meets it; a
/// four-note chord, about 6 LU over one note, reaches it on the loudest
/// quarter of a fresh pool, and is held there rather than at the brickwall.
const LEVELER_OVER_TARGET_LU: f64 = 8.0;
/// The leveler's loudness detector: a one-pole on K-weighted energy with a
/// 200 ms time constant, whose equivalent window is BS.1770's 400 ms momentary
/// block. Long enough that a pluck's attack is averaged into the note rather
/// than read as a level, short enough to follow a swell.
const LEVELER_DETECT_S: f64 = 0.2;
/// Gain-down time constant: 100 ms. A leveler, not a limiter — peaks are the
/// brickwall's — so it turns down about as fast as the detector can say the
/// level rose, and no faster.
const LEVELER_ATTACK_S: f64 = 0.1;
/// Gain-up time constant: 1.5 s, so a held swell or a run of loud chords does
/// not pump back up between notes.
const LEVELER_RELEASE_S: f64 = 1.5;
/// Full-scale unison detune in V/Oct: ±0.05 V = ±60 cents. At the old ±30 c a
/// four-voice stack was a chorus; a JP-8000-style supersaw wants ±50–70 c.
const UNI_DETUNE_VOLT: f64 = 0.05;
/// Arp gate lengths at or above this are *tied*: the step boundary slides the
/// sounding voice to the next pitch instead of releasing and re-attacking.
const ARP_TIE: f64 = 0.95;
/// The velocity [`LivePoly::set_touch`] treats as "no offset": a mezzo touch
/// plays the patch as it is, softer darkens (or thins, or stills — whichever
/// control is on touch) and harder does the opposite.
const TOUCH_MEZZO: f64 = 0.6;
/// Largest value a touch offset may write, in normalized knob units: fugue's
/// `Uniform(0, 1)` is half-open, and the live path should never produce a
/// value the genome could not hold.
const TOUCH_MAX: f64 = 1.0 - 1.0e-6;

/// The classic supersaw detune curve, mapping a voice's uniform position in
/// `[-1, 1]` to its share of the detune spread.
///
/// The outer voices sit disproportionately far out — that asymmetry is what
/// makes a stack read as one wide instrument rather than as a chorus, and it is
/// why a linear spread sounds thin no matter how far you push it.
/// `sign(u)·|u|^1.5` fits the JP-8000's published seven-voice offsets to within
/// a couple of percent.
fn detune_curve(u: f64) -> f64 {
    u.signum() * u.abs().powf(1.5)
}

/// Master bus limiter: instant attack, one-pole release, applied to the summed
/// polyphony. Each voice carries its own limiter, but N voices sum to N× the
/// level of one — without this a four-note chord is ~12 dB hotter than a single
/// note and simply clips. Gain reduction is shared across L/R so the stereo
/// image never wobbles.
struct MasterLimiter {
    /// Current gain reduction (1.0 = no reduction).
    gain: f32,
}

impl MasterLimiter {
    fn new() -> Self {
        Self { gain: 1.0 }
    }

    /// Process one stereo frame in place.
    fn tick(&mut self, l: &mut f32, r: &mut f32) {
        let peak = l.abs().max(r.abs());
        let desired = if peak > MASTER_CEILING {
            MASTER_CEILING / peak
        } else {
            1.0
        };
        if desired < self.gain {
            self.gain = desired; // instant attack — catch the sample that overs
        } else {
            self.gain += (desired - self.gain) * MASTER_RELEASE;
        }
        *l = (*l * self.gain).clamp(-1.0, 1.0);
        *r = (*r * self.gain).clamp(-1.0, 1.0);
    }
}

/// One BS.1770 K-weighting pre-filter stage: a biquad in direct form 1.
#[derive(Clone, Copy)]
struct KStage {
    b: [f64; 3],
    a: [f64; 2],
    x: [f64; 2],
    y: [f64; 2],
}

impl KStage {
    fn tick(&mut self, x0: f64) -> f64 {
        let y0 = self.b[0] * x0 + self.b[1] * self.x[0] + self.b[2] * self.x[1]
            - self.a[0] * self.y[0]
            - self.a[1] * self.y[1];
        self.x = [x0, self.x[0]];
        self.y = [y0, self.y[0]];
        y0
    }

    /// The pre-filter pair — the high shelf, then the ~38 Hz highpass —
    /// derived as `auracle_features::loudness` derives it, so the leveler reads
    /// the loudness the audition was normalized in.
    fn pair(fs: f64) -> [KStage; 2] {
        let stage = |b: [f64; 3], a: [f64; 2]| KStage {
            b,
            a,
            x: [0.0; 2],
            y: [0.0; 2],
        };
        let (g_db, q, fc) = (
            3.999_843_853_973_347,
            0.707_175_236_955_419_6,
            1_681.974_450_955_533,
        );
        let k = (std::f64::consts::PI * fc / fs).tan();
        let vh = 10f64.powf(g_db / 20.0);
        let vb = vh.powf(0.499_666_774_155);
        let a0 = 1.0 + k / q + k * k;
        let shelf = stage(
            [
                (vh + vb * k / q + k * k) / a0,
                2.0 * (k * k - vh) / a0,
                (vh - vb * k / q + k * k) / a0,
            ],
            [2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0],
        );
        let (q, fc) = (0.500_327_037_323_877_3, 38.135_470_876_024_44);
        let k = (std::f64::consts::PI * fc / fs).tan();
        let a0 = 1.0 + k / q + k * k;
        let highpass = stage(
            [1.0 / a0, -2.0 / a0, 1.0 / a0],
            [2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0],
        );
        [shelf, highpass]
    }
}

/// Loudness safety on the summed polyphony, in front of the brickwall.
///
/// The makeup is fitted on the audition phrase, whose longest note is 1.8 s,
/// and a patch can do things the phrase never heard: the amp attack runs to
/// 10 s, a filter can open over seconds, a sequencer can step up. Measured on
/// a fresh pool (`examples/pool_loudness.rs`), a C4 held for 8 s settled 4 LU
/// or more over the audition target on one patch in five *before* the makeup
/// clamp was lifted, and at −2.6 LUFS on the worst — limited, so it did not
/// clip, but 15 LU louder than the patch auditions. The brickwall bounds peaks,
/// not loudness. This bounds loudness: above [`LEVELER_OVER_TARGET_LU`] it turns
/// the gain down until the sound sits there, and gives it back when the sound
/// falls away. With it, and the makeup unclamped, no held note on the same pool
/// settles above −9.5 LUFS. Below its ceiling it is not there at all: the gain
/// is exactly 1.
struct Leveler {
    on: bool,
    /// K-weighting per channel.
    k: [[KStage; 2]; 2],
    /// Smoothed mono-equivalent K-weighted energy.
    energy: f64,
    /// The mean square the target level corresponds to.
    ceiling: f64,
    gain: f64,
    detect: f64,
    attack: f64,
    release: f64,
}

impl Leveler {
    fn new(sample_rate: f64) -> Self {
        let per_sample = |s: f64| 1.0 - (-1.0 / (s * sample_rate)).exp();
        let lufs = auracle_features::TARGET_LUFS + LEVELER_OVER_TARGET_LU;
        Leveler {
            on: true,
            k: [KStage::pair(sample_rate), KStage::pair(sample_rate)],
            energy: 0.0,
            ceiling: 10f64.powf((lufs + 0.691) / 10.0),
            gain: 1.0,
            detect: per_sample(LEVELER_DETECT_S),
            attack: per_sample(LEVELER_ATTACK_S),
            release: per_sample(LEVELER_RELEASE_S),
        }
    }

    /// The gain for one stereo frame.
    fn tick(&mut self, l: f32, r: f32) -> f32 {
        if !self.on {
            return 1.0;
        }
        let weigh =
            |[shelf, highpass]: &mut [KStage; 2], x: f32| highpass.tick(shelf.tick(f64::from(x)));
        let [kl, kr] = &mut self.k;
        let (wl, wr) = (weigh(kl, l), weigh(kr, r));
        self.energy += (0.5 * (wl * wl + wr * wr) - self.energy) * self.detect;
        let want = if self.energy > self.ceiling {
            (self.ceiling / self.energy).sqrt()
        } else {
            1.0
        };
        let rate = if want < self.gain {
            self.attack
        } else {
            self.release
        };
        self.gain += (want - self.gain) * rate;
        // The release is an exponential approach, which never arrives; below
        // the ceiling the leveler must not be there at all.
        if want == 1.0 && self.gain > 1.0 - 1e-6 {
            self.gain = 1.0;
        }
        self.gain as f32
    }
}

struct Voice {
    voice: auracle_grammar::CompiledVoice,
    /// Currently-held MIDI note, if any (gate high).
    note: Option<u8>,
    /// Allocation stamp: when this voice's note was pressed.
    stamp: u64,
    /// When this voice's note was let go, on the same counter as `stamp`, so
    /// a steal can take the release tail that has rung longest.
    released: u64,
    /// Still worth ticking (held, or release tail not yet silent).
    running: bool,
    silent_run: u32,
    /// Velocity gain (0..1) applied to this voice's output.
    vel: f32,
    /// Equal-power pan gains (unison spread; center by default).
    pan_l: f32,
    pan_r: f32,
    /// Pitch in v/oct, smoothed toward `pitch_tgt` (glide). Excludes bend.
    pitch_cur: f64,
    pitch_tgt: f64,
    /// Frames until the gate is re-raised. Stealing a *sounding* voice drops
    /// the gate for one frame so the ADSR sees a rising edge and actually
    /// retriggers — otherwise the new note inherits the stolen note's
    /// envelope position and speaks with no attack.
    regate_in: u32,
}

/// One live parameter across every voice: its trace address, its unit
/// mapping, and the atomic each voice reads it from. Interned once per
/// (re)build — see [`intern_params`] — so a knob write on the render thread
/// is a scan of this table and an atomic store, with no allocation and no
/// hashing per voice per quantum.
struct ParamSlot {
    addr: String,
    map: ParamMap,
    /// Index-parallel to `voices`, then the open voice's when there is one.
    /// Written for every voice only through [`ParamSlot::set_all`]; one
    /// voice is written only as a note starts on it, back to the knob
    /// ([`LivePoly::restore_knobs`]) and then by its touch
    /// ([`LivePoly::apply_touch`]).
    values: Vec<Arc<AtomicF64>>,
    /// The knob's own value, in its own units: what every voice holds but
    /// for a note's touch offset, and what a voice is put back to when it
    /// starts a note ([`LivePoly::restore_knobs`]).
    knob: f64,
}

impl ParamSlot {
    /// Write `v` to every voice, and make it the knob's value.
    fn set_all(&mut self, v: f64) {
        self.knob = v;
        self.values.iter().for_each(|a| a.set(v));
    }
}

/// A `steps` module's tempo-sync wiring: its transport handle, its rate
/// handle, and the rate the patch (or a gesture) asked for before snapping.
struct SyncLane {
    sync_slot: usize,
    rate_slot: usize,
    /// Normalized free rate: what the voices play with sync off, and what
    /// the snap starts from with it on.
    free: f64,
    /// Steps per beat the lane is playing (0 before the first block synced).
    div: f64,
    /// Added to `beats × div`. Zero from a restart; set when `div` changes
    /// mid-play so the sequencer keeps the step it is on and re-grids only
    /// its phase, instead of leaping to wherever `beats × new div` points.
    offset: f64,
}

/// Steps per beat a synced sequencer may run at: straight, triplet and
/// dotted divisions from a whole bar's quarter down to 32nds' worth.
const SYNC_DIVISIONS: [f64; 12] = [
    0.25,
    1.0 / 3.0,
    0.5,
    2.0 / 3.0,
    0.75,
    1.0,
    1.5,
    2.0,
    3.0,
    4.0,
    6.0,
    8.0,
];

/// The synced rate site for a free rate site at `bpm`: the musical division
/// of the beat nearest the free rate in octaves (so a sequencer evolved at
/// 3.7 steps/s at 120 BPM plays 8ths, 4 steps/s), among the divisions the
/// knob can reach.
pub(crate) fn snap_rate(free: f64, bpm: f64) -> f64 {
    use auracle_grammar::steps::{rate_hz, rate_site};
    let hz = rate_hz(free);
    let beat = bpm.clamp(30.0, 300.0) / 60.0;
    let (lo, hi) = (rate_hz(0.0), rate_hz(1.0));
    let best = SYNC_DIVISIONS
        .iter()
        .map(|d| beat * d)
        .filter(|h| *h >= lo * 0.999 && *h <= hi * 1.001)
        .min_by(|a, b| (hz / a).log2().abs().total_cmp(&(hz / b).log2().abs()));
    best.map_or(free, rate_site)
}

struct Smoother {
    /// Index into `param_slots`.
    slot: usize,
    current: f64,
    target: f64,
}

/// One knob that velocity reaches through [`LivePoly::set_touch`].
struct TouchSite {
    addr: String,
    /// Normalized knob travel at full depth and full velocity distance from
    /// [`TOUCH_MEZZO`] — the named control's measured wiring gain.
    gain: f64,
    /// The knob's current normalized value, which the offset is added to.
    base: f64,
}

/// The live parameter table for a set of voices, sorted by address so the
/// order is a property of the patch and not of `HashMap` iteration. Every
/// voice is the same tree compiled, so voice 0's keys are everyone's keys;
/// a voice missing one (which cannot happen) simply has no entry to write.
/// There is always a voice 0: `new` builds `n_voices.max(1)`, and a swap
/// never fewer. The open voice ([`LivePoly::set_open`]), when the patch has
/// one, is in the table too, so a knob turned while it sounds reaches it as
/// it reaches a key.
fn intern_params(voices: &[Voice], open: Option<&Voice>) -> Vec<ParamSlot> {
    let first = &voices[0];
    let mut addrs: Vec<&String> = first.voice.params.keys().collect();
    addrs.sort();
    addrs
        .into_iter()
        .map(|addr| ParamSlot {
            addr: addr.clone(),
            map: first.voice.params[addr].map,
            values: voices
                .iter()
                .chain(open)
                .filter_map(|v| v.voice.params.get(addr).map(|h| Arc::clone(&h.value)))
                .collect(),
            // Freshly compiled, every voice holds the tree's value.
            knob: first.voice.params[addr].value.get(),
        })
        .collect()
}

/// Where a patch swap is. The tree being swapped in lives in the stages
/// that need it, so a rebuild always has a patch to build.
enum Stage {
    Run,
    /// Fading the old voices out, with `tree` to swap in once silent.
    FadeOut {
        tree: PatchTree,
    },
    /// Silent: compiling `tree`, one voice a quantum, into `built`.
    Rebuild {
        tree: PatchTree,
        built: Vec<Voice>,
    },
    FadeIn,
}

/// Event for the worklet to relay (polled once per quantum).
const EVENT_NONE: u32 = 0;
const EVENT_PATCHED: u32 = 1;
const EVENT_PATCH_ERROR: u32 = 2;

/// A polyphonic live instrument over one patch.
#[wasm_bindgen]
pub struct LivePoly {
    voices: Vec<Voice>,
    n_voices: usize,
    sample_rate: f64,
    counter: u64,
    /// Notes physically held right now, with velocity (survive patch swaps).
    held: Vec<(u8, f32)>,
    smoothers: Vec<Smoother>,
    /// The live parameter handles of the current voices, rebuilt on every
    /// swap. What `set_param` scans and `advance_smoothers` writes.
    param_slots: Vec<ParamSlot>,
    stage: Stage,
    gain: f32,
    out_buf: Vec<f32>,
    event: u32,
    last_error: String,
    /// Pitch bend in v/oct, one-pole smoothed toward `bend_tgt`.
    bend: f64,
    bend_tgt: f64,
    /// Glide amount 0..1 (0 = off; 1 ≈ 500 ms portamento).
    glide: f64,
    /// v/oct of the most recent press — glide start point. `None` until the
    /// first press: with nothing behind it there is nowhere to glide *from*,
    /// and a zero would slide the first note of the session in from C4.
    last_pitch: Option<f64>,
    /// Unison: all voices play one note, detuned and panned apart.
    unison: bool,
    uni_detune: f64,
    uni_spread: f64,
    /// Loudness makeup gain (linear); swaps in with the patch it belongs to.
    makeup: f32,
    pending_makeup: Option<f32>,
    /// Loudness safety after the makeup, in front of the brickwall.
    leveler: Leveler,
    /// Master brickwall across the summed polyphony.
    master: MasterLimiter,
    // Arpeggiator (sample-accurate, runs on the audio thread).
    arp_on: bool,
    /// 0 = up, 1 = down, 2 = up-down, 3 = random.
    arp_mode: u32,
    /// Steps per beat (1 = quarters, 2 = eighths, 4 = sixteenths).
    arp_div: f64,
    /// Gate length as a fraction of the step (0.05–1.0); ≥ [`ARP_TIE`] is tied.
    arp_gate: f64,
    /// How many octaves the pattern spans (1–4).
    arp_octaves: u32,
    /// Shuffle amount (0–0.75): even steps lengthen, odd steps shorten.
    arp_swing: f64,
    bpm: f64,
    /// Samples elapsed in the current arp step.
    arp_phase: f64,
    arp_idx: usize,
    /// Steps played since the arp was switched on — swing needs the parity.
    arp_step: u64,
    /// Direction flag for up-down mode.
    arp_up: bool,
    /// The transposed note currently gated on (may be an octave up).
    arp_note: Option<u8>,
    /// The *held* note that `arp_note` was derived from, so releasing a key
    /// mid-step can still find its sounding voice.
    arp_base: Option<u8>,
    /// xorshift state for random mode (deterministic; no wall clock).
    rng_state: u64,
    /// Scratch for [`LivePoly::tick_arp`]: the held chord sorted by pitch,
    /// and the pattern it expands to across the octave range. Kept, not
    /// rebuilt, so a step boundary allocates nothing; sized in `new` for a
    /// full keyboard.
    arp_chord: Vec<(u8, f32)>,
    /// (pitch to play, the key it came from, velocity).
    arp_notes: Vec<(u8, u8, f32)>,
    /// Interior signal metering, off until a surface asks for it. See
    /// [`LivePoly::set_meter`].
    meter: Meter,
    /// Velocity → timbre: the knobs a note's velocity offsets on *its own*
    /// voice. Empty (the default) is velocity-as-gain only, as before.
    touch: Vec<TouchSite>,
    touch_depth: f64,
    /// Tempo sync for `steps` modules: on, their rate knobs are snapped to a
    /// musical division of `bpm` and their clocks follow `transport`.
    sync_on: bool,
    /// Beats since the transport last started (a key sync or a MIDI start),
    /// integrated block by block at the tempo *of that block*. A tempo change
    /// therefore changes speed, never position: the first version computed
    /// the position as elapsed samples × the current rate, and a 1 BPM nudge
    /// two minutes in threw every sequencer four 16ths forward. Only
    /// meaningful while `sync_on`.
    beats: f64,
    /// One per `steps` module in the patch.
    sync_lanes: Vec<SyncLane>,
    /// The live input every AUDIO IN in every voice reads (ADR-015). Built
    /// once, in [`LivePoly::new`] (which the worklet calls in its port
    /// handler, never in `process()`), in quiver's cursor mode: the voices render
    /// a quantum one after another and start and resume at quantum
    /// boundaries, which is the host that mode keeps in step. Every rebuilt
    /// voice binds this same stream, so a patch swap needs no new one.
    input: Arc<AudioInputStream>,
    /// Where the worklet writes each quantum's input, interleaved, before
    /// [`LivePoly::write_input`] publishes it: a view into wasm memory
    /// ([`LivePoly::input_ptr`]), so a quantum's input costs no allocation.
    input_buf: Vec<f32>,
    /// The open voice: one more copy of the current patch, built only when
    /// the patch listens, held open at [`OPEN_NOTE`] while [`Self::open_on`]
    /// so the input sounds through the patch with no key down. It is not one
    /// of `voices`, so no key, chord, unison or arpeggio can take it, and
    /// `all_off` does not close it. See [`LivePoly::set_open`].
    open: Option<Voice>,
    /// The host asked for the open voice (the AUDIO IN's MONITOR is on).
    open_on: bool,
    /// A patch with a TRACK: the open voice leads and the keys' voices
    /// follow ([`Lead`]). `None` for any other patch.
    lead: Option<Lead>,
}

/// Every MIDI note held at once is the most a chord can be.
const ARP_CHORD_CAP: usize = 128;
/// …across the widest octave range the arp offers (`set_arp` clamps to 4).
const ARP_NOTES_CAP: usize = ARP_CHORD_CAP * 4;

/// Per-module level metering, read off the voice the player is hearing.
///
/// Off by default and allocation-free while off, which is the state every
/// player is in: `set_meter(false)` clears the subscriptions and the render
/// loop's metering branch is one `bool` test per voice. While it is *on* it
/// allocates once per quantum in `drain_updates`, on the same terms the
/// recorder already sets in `live-audio.js` — "allocation only while a take is
/// rolling, never in the steady state". A teaching surface the player switched
/// on is that kind of state.
struct Meter {
    observer: StateObserver,
    /// Term keys in [`Self::levels`] order, fixed when the subscriptions are
    /// taken so the main thread can label the values it reads once.
    keys: Vec<String>,
    /// Quiver node name and port for each key, index-parallel to `keys` —
    /// what an update's `node_id`/`port_id` is matched back against.
    ports: Vec<(String, u32)>,
    /// Latest RMS dB per tap, preallocated and overwritten in place so the
    /// worklet can read it as a view into wasm memory.
    levels: Vec<f32>,
    on: bool,
}

impl Meter {
    fn new() -> Self {
        Meter {
            observer: StateObserver::new(),
            keys: Vec::new(),
            ports: Vec::new(),
            levels: Vec::new(),
            on: false,
        }
    }

    /// Subscribe to every tap of `voice`, or clear if `on` is false.
    ///
    /// Re-taken from scratch on every patch swap, not just when the surface
    /// asks. A subscription caches the `NodeId` it resolved its name to, and a
    /// rebuilt patch is a fresh slotmap whose keys mean nothing to the old
    /// one — a stale id is not merely dead, it can silently land on a
    /// different node. Re-subscribing resets those caches.
    fn resubscribe(&mut self, voice: &auracle_grammar::CompiledVoice) {
        self.observer.clear_subscriptions();
        self.keys.clear();
        self.ports.clear();
        self.levels.clear();
        if !self.on {
            return;
        }
        // Sorted so the order the main thread labels once stays put across
        // swaps; a `HashMap` iteration order would reshuffle the readout.
        let mut taps: Vec<(&String, &(String, u32))> = voice.taps.iter().collect();
        taps.sort_by(|a, b| a.0.cmp(b.0));
        let targets: Vec<SubscriptionTarget> = taps
            .iter()
            .map(|(key, (node, port))| {
                self.keys.push((*key).clone());
                self.ports.push((node.clone(), *port));
                self.levels.push(f32::NEG_INFINITY);
                SubscriptionTarget::Level {
                    node_id: node.clone(),
                    port_id: *port,
                }
            })
            .collect();
        self.observer.add_subscriptions(targets);
    }

    /// Move whatever the observer has finished into [`Self::levels`].
    fn drain(&mut self) {
        for update in self.observer.drain_updates() {
            // Only levels are subscribed; anything else is not a tap's.
            if let ObservableValue::Level {
                node_id,
                port_id,
                rms_db,
                ..
            } = update
            {
                if let Some(i) = self
                    .ports
                    .iter()
                    .position(|(n, p)| *p == port_id && *n == node_id)
                {
                    self.levels[i] = rms_db as f32;
                }
            }
        }
    }
}

/// Does this patch hold a TRACK anywhere (a patch played by its input)?
fn has_track(node: &AudioNode) -> bool {
    matches!(node, AudioNode::Track { .. }) || node.children().into_iter().any(has_track)
}

/// The **one tracked voice** of a patch with a TRACK: the open voice tracks
/// the input, and every key's voice is a follower (`compile_follower`) that
/// plays what the lead tracks, frame by frame, and stops with its key.
///
/// The lead renders its quantum first and copies its tracked signals for each
/// frame into `buf` ([`auracle_grammar::CompiledVoice::read_tracks`]); each
/// follower then reads its frame's copy into its feeds before it ticks, so a
/// voice-major render plays exactly what a frame-by-frame one would (the
/// phrase render's `lead`). Without it a key's voice tracked the input itself
/// and its tracker's gate held its amp open after the key was let go, so
/// every key played over a sung line left a voice sounding, and they stacked.
struct Lead {
    /// Values per frame: three per TRACK (pitch, gate, level), in the lead's
    /// `tracker_keys` order.
    stride: usize,
    /// One quantum of the lead's tracked signals, `stride` per frame, sized
    /// for [`LIVE_INPUT_FRAMES`] frames at the build.
    buf: Vec<f64>,
    /// Each key voice's feeds, in the lead's key order (index-parallel to
    /// `voices`).
    feeds: Vec<Vec<TrackFeed>>,
    /// Frames of `buf` the lead wrote this quantum (0 when it is not running).
    filled: usize,
}

impl Lead {
    /// The lead for `voices` led by `open`, or `None` for a patch whose open
    /// voice tracks nothing. Allocates (a build, never a quantum).
    fn build(voices: &[Voice], open: Option<&Voice>) -> Option<Lead> {
        let keys = open?.voice.tracker_keys();
        if keys.is_empty() {
            return None;
        }
        let stride = 3 * keys.len();
        let feeds = voices
            .iter()
            .map(|v| {
                keys.iter()
                    .map(|k| v.voice.track_feeds.get(k).cloned().unwrap_or_default())
                    .collect()
            })
            .collect();
        Some(Lead {
            stride,
            buf: vec![0.0; stride * LIVE_INPUT_FRAMES],
            feeds,
            filled: 0,
        })
    }

    /// Silence every follower's tracked branch: the lead has stopped.
    fn quiet(&self) {
        for feeds in &self.feeds {
            for f in feeds {
                f.gate.set(0.0);
                f.level.set(0.0);
            }
        }
    }
}

fn build_voice(
    tree: &PatchTree,
    sample_rate: f64,
    input: &Arc<AudioInputStream>,
    follow: bool,
) -> Result<Voice, String> {
    let voice = if follow {
        compile_follower(tree, sample_rate, Some(input))
    } else {
        compile_with_input(tree, sample_rate, Some(input))
    }
    .map_err(|e| e.to_string())?;
    voice.gate.set(0.0);
    Ok(Voice {
        voice,
        note: None,
        stamp: 0,
        released: 0,
        running: false,
        silent_run: 0,
        vel: 1.0,
        pan_l: std::f32::consts::FRAC_1_SQRT_2,
        pan_r: std::f32::consts::FRAC_1_SQRT_2,
        pitch_cur: 0.0,
        pitch_tgt: 0.0,
        regate_in: 0,
    })
}

/// What a voice does with a TRACK lead as it ticks ([`Lead`]).
enum Tracks<'a> {
    /// Nothing: the patch has no TRACK, or this voice is not in it.
    None,
    /// This voice is the lead: copy its tracked signals, `stride` per frame,
    /// into the buffer after each tick.
    Lead(&'a mut [f64], usize),
    /// This voice follows: before each tick, set its feeds from the lead's
    /// copy of that frame (`filled` frames of it).
    Follow(&'a [TrackFeed], &'a [f64], usize, usize),
}

/// Render one sounding voice's `frames` into the interleaved `out`, metering
/// it when `meter` is given, and park it once its release tail is silent.
fn tick_voice(
    v: &mut Voice,
    frames: usize,
    out: &mut [f32],
    mut meter: Option<&mut Meter>,
    mut tracks: Tracks,
) {
    let held = v.note.is_some();
    let mut tail_silent = 0u32;
    for f in 0..frames {
        if let Tracks::Follow(feeds, buf, stride, filled) = &tracks {
            if f < *filled {
                let frame = &buf[f * stride..(f + 1) * stride];
                for (i, feed) in feeds.iter().enumerate() {
                    feed.voct.set(frame[3 * i]);
                    feed.gate.set(frame[3 * i + 1]);
                    feed.level.set(frame[3 * i + 2]);
                }
            }
        }
        let (l, r) = v.voice.patch.tick();
        if let Tracks::Lead(buf, stride) = &mut tracks {
            if let Some(frame) = buf.get_mut(f * *stride..(f + 1) * *stride) {
                v.voice.read_tracks(frame);
            }
        }
        // Per sample, not per quantum: the capture is allocation-free
        // and quiver's own guidance is that a per-block sample aliases
        // everything above `sample_rate / (2 * block_size)`. A level
        // read 128 samples apart is not a level.
        if let Some(m) = meter.as_deref_mut() {
            m.observer.collect_sample(&v.voice.patch);
        }
        // Re-raise *after* the tick: the patch has to actually observe
        // the low gate for one sample, or the ADSR's edge detector
        // never sees a falling edge and the retrigger is a no-op.
        if v.regate_in > 0 {
            v.regate_in -= 1;
            if v.regate_in == 0 {
                v.voice.gate.set(GATE_ON);
            }
        }
        let g = v.vel * std::f32::consts::SQRT_2 * VOLT_SCALE;
        out[f * 2] += l as f32 * g * v.pan_l;
        out[f * 2 + 1] += r as f32 * g * v.pan_r;
        if !held && l.abs() + r.abs() < SILENCE_EPS {
            tail_silent += 1;
        } else {
            tail_silent = 0;
        }
    }
    if held {
        v.silent_run = 0;
    } else {
        if tail_silent == frames as u32 {
            v.silent_run += tail_silent;
        } else {
            v.silent_run = tail_silent;
        }
        if v.silent_run >= PARK_AFTER {
            v.running = false;
        }
    }
}

#[wasm_bindgen]
impl LivePoly {
    /// Build an `n_voices`-voice instrument from a `PatchTree` JSON, or say
    /// why not. The error is a `String`, which wasm-bindgen throws as a JS
    /// string (the host reads it with `String(err)`), and which `render_take`
    /// and the native tests read as it is.
    #[wasm_bindgen(constructor)]
    pub fn new(tree_json: &str, sample_rate: f64, n_voices: usize) -> Result<LivePoly, String> {
        let tree: PatchTree = serde_json::from_str(tree_json).map_err(|e| e.to_string())?;
        let n = n_voices.max(1);
        let input = Arc::new(AudioInputStream::new(
            LIVE_INPUT_CHANNELS,
            LIVE_INPUT_FRAMES,
        ));
        // A patch with a TRACK is played by one tracked voice: the keys'
        // voices follow it ([`Lead`]).
        let tracked = has_track(&tree.root);
        let voices: Vec<Voice> = (0..n)
            .map(|_| build_voice(&tree, sample_rate, &input, tracked))
            .collect::<Result<_, _>>()?;
        // A patch that listens (or tracks) gets its open voice now, here in
        // the port handler, like the rest; one that does not never compiles
        // one.
        let open = if tree.listens() || tracked {
            Some(build_voice(&tree, sample_rate, &input, false)?)
        } else {
            None
        };
        let lead = Lead::build(&voices, open.as_ref());
        let param_slots = intern_params(&voices, open.as_ref());
        Ok(LivePoly {
            voices,
            n_voices: n,
            sample_rate,
            counter: 0,
            held: Vec::with_capacity(ARP_CHORD_CAP),
            smoothers: Vec::new(),
            param_slots,
            stage: Stage::Run,
            gain: 1.0,
            out_buf: Vec::new(),
            event: EVENT_NONE,
            last_error: String::new(),
            bend: 0.0,
            bend_tgt: 0.0,
            glide: 0.0,
            last_pitch: None,
            unison: false,
            uni_detune: 0.3,
            uni_spread: 0.7,
            makeup: 1.0,
            pending_makeup: None,
            leveler: Leveler::new(sample_rate),
            master: MasterLimiter::new(),
            arp_on: false,
            arp_mode: 0,
            arp_div: 2.0,
            arp_gate: 0.5,
            arp_octaves: 1,
            arp_swing: 0.0,
            bpm: 120.0,
            arp_phase: 0.0,
            arp_idx: 0,
            arp_step: 0,
            arp_up: true,
            arp_note: None,
            arp_base: None,
            rng_state: 0x9E37_79B9_7F4A_7C15,
            arp_chord: Vec::with_capacity(ARP_CHORD_CAP),
            arp_notes: Vec::with_capacity(ARP_NOTES_CAP),
            meter: Meter::new(),
            touch: Vec::new(),
            touch_depth: 0.0,
            sync_on: false,
            beats: 0.0,
            sync_lanes: Vec::new(),
            input,
            input_buf: vec![0.0; LIVE_INPUT_FRAMES * LIVE_INPUT_CHANNELS],
            open,
            open_on: false,
            lead,
        })
        .map(|mut p| {
            p.rebuild_sync_lanes();
            p
        })
    }

    /// Find every `steps` module's transport and rate handles in the current
    /// param table. Called when the table is (re)made — construction and a
    /// patch swap — which is where parameter allocation already happens.
    fn rebuild_sync_lanes(&mut self) {
        let suffix = format!("#{}", auracle_grammar::compile::STEPS_SYNC_SITE);
        self.sync_lanes = self
            .param_slots
            .iter()
            .enumerate()
            .filter_map(|(sync_slot, p)| {
                let key = p.addr.strip_suffix(&suffix)?;
                let rate_addr = format!("{key}#srate");
                let rate_slot = self.param_slots.iter().position(|q| q.addr == rate_addr)?;
                let free = self.param_slots[rate_slot]
                    .values
                    .first()
                    .map_or(0.5, |v| v.get());
                Some(SyncLane {
                    sync_slot,
                    rate_slot,
                    free,
                    div: 0.0,
                    offset: 0.0,
                })
            })
            .collect();
        self.apply_sync();
    }

    /// Write every lane's rate (snapped with sync on, free with it off) and,
    /// with it off, park the transport handles at free-running.
    fn apply_sync(&mut self) {
        // A rate smoother started before sync would otherwise go on writing
        // its unsnapped target over the snapped value every block.
        let rate_slots: Vec<usize> = self.sync_lanes.iter().map(|l| l.rate_slot).collect();
        self.smoothers.retain(|s| !rate_slots.contains(&s.slot));
        for lane in &self.sync_lanes {
            let x = if self.sync_on {
                snap_rate(lane.free, self.bpm)
            } else {
                lane.free
            };
            let p = &mut self.param_slots[lane.rate_slot];
            let v = p.map.apply(x);
            p.set_all(v);
            if !self.sync_on {
                self.param_slots[lane.sync_slot].set_all(auracle_grammar::steps::SYNC_FREE);
            }
        }
    }

    /// Tempo sync on or off. On, every `steps` module plays the musical
    /// division of the arpeggiator's tempo nearest its own rate, on one
    /// transport that restarts when the first key goes down (key sync) or on
    /// [`Self::restart_transport`] — so the step sequence and the arp share a
    /// grid, and a five-step pattern still cycles against a four-beat bar.
    /// Off, each sequencer free-runs at its own rate, as evolved.
    pub fn set_sync(&mut self, on: bool) {
        if on != self.sync_on {
            self.sync_on = on;
            self.zero_transport();
            self.apply_sync();
        }
    }

    /// Restart the transport now (a MIDI start): the sequencers go back to
    /// step 0 and, if a chord is held, the arp restarts on the same block.
    pub fn restart_transport(&mut self) {
        self.zero_transport();
        if self.arp_on && !self.held.is_empty() {
            self.arp_phase = f64::MAX;
            self.arp_idx = 0;
            self.arp_step = 0;
            self.arp_up = true;
        }
    }

    /// Where the transport is, in beats — for handing to a second instrument
    /// that has to play on the same grid (the B slot).
    pub fn transport_beats(&self) -> f64 {
        self.beats
    }

    /// Put the transport at `beats` without restarting anything: the B slot
    /// joining A's grid, or a MIDI clock pulling a free-running estimate back
    /// onto the room's beat once per beat.
    pub fn set_transport_beats(&mut self, beats: f64) {
        if beats.is_finite() && beats >= 0.0 {
            self.beats = beats;
        }
    }

    fn zero_transport(&mut self) {
        self.beats = 0.0;
        for lane in &mut self.sync_lanes {
            lane.div = 0.0;
            lane.offset = 0.0;
        }
    }

    /// Before a block: tell every sequencer where the transport is.
    fn drive_sync(&mut self) {
        if !self.sync_on {
            return;
        }
        let beat_hz = self.bpm / 60.0;
        let beats = self.beats;
        for lane in &mut self.sync_lanes {
            let div = auracle_grammar::steps::rate_hz(snap_rate(lane.free, self.bpm)) / beat_hz;
            if (div - lane.div).abs() > 1e-9 {
                if lane.div > 0.0 {
                    // Keep the step it is on; take the new division's phase.
                    let here = beats * lane.div + lane.offset;
                    let grid = beats * div;
                    lane.offset = here.floor() + (grid - grid.floor()) - grid;
                }
                lane.div = div;
            }
            let pos = (beats * div + lane.offset).max(0.0);
            self.param_slots[lane.sync_slot].set_all(pos);
        }
    }

    /// Turn interior metering on or off.
    ///
    /// On, every module in the patch gets a `Level` subscription and
    /// [`Self::meter_ptr`] carries its RMS in dB; off, nothing is subscribed
    /// and the render loop does no metering work at all. Returns the number of
    /// taps, which is the length of both [`Self::meter_keys`] and the level
    /// buffer.
    ///
    /// Nothing here needs `sync_output_keepalive`. That call pins ports with
    /// no consumer so a module implementing `tick_masked` still produces them,
    /// and it dirties the patch — a recompile that would have to be staged
    /// around the audio thread the way patch swaps are. It is not needed
    /// because the genome is a typed *tree*: every module's output feeds
    /// exactly one parent, so quiver is already computing every value metered
    /// here. Metering costs no recompile and cannot glitch the audio.
    pub fn set_meter(&mut self, on: bool) -> usize {
        self.meter.on = on;
        // Voice 0 is as good as any: every voice is the same tree compiled
        // again, so they share node names, and a subscription is by name.
        if let Some(v) = self.voices.first() {
            let voice = &v.voice;
            self.meter.resubscribe(voice);
        }
        self.meter.keys.len()
    }

    /// The term keys the level buffer is indexed by, as a JSON array.
    ///
    /// Read once after [`Self::set_meter`] rather than per quantum — this
    /// allocates, and the order is fixed until the next patch swap.
    pub fn meter_keys(&self) -> String {
        crate::json_or(&self.meter.keys, "[]")
    }

    /// Pointer to the RMS dB per tap, in [`Self::meter_keys`] order.
    ///
    /// The same zero-allocation contract as [`Self::process_ptr`]: a view into
    /// wasm memory, overwritten in place, valid until the next patch swap
    /// resizes it. A tap that has not filled a buffer yet reads
    /// `f32::NEG_INFINITY` — silence, not zero dB.
    pub fn meter_ptr(&self) -> *const f32 {
        self.meter.levels.as_ptr()
    }

    /// How many taps [`Self::meter_ptr`] holds.
    pub fn meter_len(&self) -> usize {
        self.meter.levels.len()
    }

    /// Velocity → timbre. `sites_json` is `[[addr, gain, base], …]`: each
    /// knob a note's velocity reaches, its travel at full depth (a named
    /// control's measured wiring gain) and its current normalized value.
    /// `depth` in 0..1 scales the whole thing; 0 or `[]` turns touch off.
    ///
    /// The offset is written on the pressed voice only, at note-on, so a chord
    /// can hold a soft dark note beside a loud bright one. A change here
    /// reaches the notes struck after it: a held note keeps the offset it was
    /// struck with until it is let go, and every later note starts from the
    /// knobs ([`Self::restore_knobs`]), so a knob velocity no longer plays
    /// sounds where it is turned. Stated limit: a parameter ramp on the same
    /// knob ([`Self::set_param`]) writes every voice and so resets held
    /// notes' offsets until their next note-on.
    /// Returns false for unreadable JSON (touch is then off).
    pub fn set_touch(&mut self, sites_json: &str, depth: f64) -> bool {
        let Ok(sites) = serde_json::from_str::<Vec<(String, f64, f64)>>(sites_json) else {
            self.touch.clear();
            return false;
        };
        self.touch = sites
            .into_iter()
            .filter(|(_, g, b)| g.is_finite() && b.is_finite())
            .map(|(addr, gain, base)| TouchSite { addr, gain, base })
            .collect();
        self.touch_depth = if depth.is_finite() {
            depth.clamp(0.0, 1.0)
        } else {
            0.0
        };
        true
    }

    /// Update one touch site's base value (its index in the last
    /// [`Self::set_touch`] list) as the knob moves. Allocation-free.
    pub fn set_touch_base(&mut self, index: usize, base: f64) {
        if let Some(t) = self.touch.get_mut(index) {
            if base.is_finite() {
                t.base = base;
            }
        }
    }

    /// Put every knob of voice `i` back to the knob's own value as a note
    /// starts on it, so nothing an earlier note's touch wrote there outlives
    /// that note: a knob velocity no longer plays (touch off, or moved to
    /// another control) sounds where it is turned, and [`Self::apply_touch`]
    /// then offsets this note's own. One atomic store per knob and no
    /// allocation: it runs on every press, the arpeggiator's in `process()`
    /// among them.
    fn restore_knobs(&self, i: usize) {
        for p in &self.param_slots {
            if let Some(a) = p.values.get(i) {
                a.set(p.knob);
            }
        }
    }

    /// Write this note's touch offsets onto voice `i`.
    fn apply_touch(&mut self, i: usize, vel: f32) {
        if self.touch.is_empty() || self.touch_depth <= 0.0 {
            return;
        }
        let off = (vel as f64 - TOUCH_MEZZO) * 2.0 * self.touch_depth;
        let Some(v) = self.voices.get(i) else { return };
        for t in &self.touch {
            if let Some(h) = v.voice.params.get(&t.addr) {
                h.set_normalized((t.base + off * t.gain).clamp(0.0, TOUCH_MAX));
            }
        }
    }

    /// Queue a patch swap. Parses eagerly (false = bad JSON, nothing
    /// changes); the actual voice rebuild is amortized over the next few
    /// silent quanta. Held notes are re-pressed on the new patch.
    pub fn set_patch(&mut self, tree_json: &str) -> bool {
        let Ok(tree) = serde_json::from_str::<PatchTree>(tree_json) else {
            return false;
        };
        self.stage = match self.stage {
            // Already silent/rebuilding: restart the rebuild with the newer
            // tree (coalesces rapid structural edits).
            Stage::Rebuild { .. } => Stage::Rebuild {
                tree,
                built: Vec::new(),
            },
            _ => Stage::FadeOut { tree },
        };
        true
    }

    /// Poll the latest swap event (0 = none, 1 = patched, 2 = error).
    /// Clears on read.
    pub fn poll_event(&mut self) -> u32 {
        std::mem::replace(&mut self.event, EVENT_NONE)
    }

    /// The message of the last patch error.
    pub fn last_error(&self) -> String {
        self.last_error.clone()
    }

    /// Press a MIDI note (60 = C4) with velocity 0..1. Retriggers if already
    /// held; otherwise takes a parked voice, else steals the oldest. With
    /// the arp on, the note joins the held set and the arp presses it.
    pub fn note_on(&mut self, note: u8, vel: f64) {
        let vel = (vel.clamp(0.0, 1.0) as f32).max(0.05);
        // Key sync: the first key down restarts the transport, in the same
        // block the arp fires its first step, so both start on one grid.
        if self.sync_on && self.held.is_empty() {
            self.zero_transport();
        }
        self.held.retain(|(n, _)| *n != note);
        self.held.push((note, vel));
        if self.arp_on {
            if self.held.len() == 1 {
                // First note: fire the arp immediately, not a step later.
                self.arp_phase = f64::MAX;
                self.arp_idx = 0;
                self.arp_up = true;
            }
            return;
        }
        self.press(note, vel);
    }

    /// Velocity → output level: perceptual-ish curve with a floor so soft
    /// notes still speak.
    fn vel_gain(vel: f32) -> f32 {
        0.15 + 0.85 * vel.powf(1.4)
    }

    fn press(&mut self, note: u8, vel: f32) {
        let target = (note as f64 - 60.0) / 12.0;
        let start = if self.glide > 0.0 {
            self.last_pitch.unwrap_or(target)
        } else {
            target
        };
        let first_press = self.last_pitch.is_none();
        self.last_pitch = Some(target);
        if self.unison {
            // All voices, symmetric detune on the supersaw curve and an
            // equal-power pan spread. Held gates stay high = legato.
            let n = self.voices.len().max(1);
            self.counter += 1;
            let stamp = self.counter;
            for i in 0..n {
                let frac = if n > 1 {
                    (i as f64 / (n - 1) as f64) * 2.0 - 1.0
                } else {
                    0.0
                };
                let det = detune_curve(frac) * self.uni_detune * UNI_DETUNE_VOLT;
                let pan = frac * self.uni_spread;
                let th = (pan + 1.0) * 0.25 * std::f64::consts::PI;
                let v = &mut self.voices[i];
                v.pitch_tgt = target + det;
                v.pitch_cur = if self.glide > 0.0 {
                    start + det
                } else {
                    v.pitch_tgt
                };
                v.voice.pitch.set(v.pitch_cur + self.bend);
                v.voice.gate.set(GATE_ON);
                v.regate_in = 0; // unison is deliberately mono-legato
                v.note = Some(note);
                v.stamp = stamp;
                v.running = true;
                v.silent_run = 0;
                v.vel = Self::vel_gain(vel);
                v.pan_l = th.cos() as f32;
                v.pan_r = th.sin() as f32;
            }
            for i in 0..n {
                self.restore_knobs(i);
                self.apply_touch(i, vel);
            }
            return;
        }
        self.counter += 1;
        let stamp = self.counter;
        // Which voice takes the note, in this order: the voice already on this
        // note (a retrigger); a voice that has gone silent; a voice ringing out
        // a note that was let go, the one let go longest ago; and only when
        // every voice is under a finger, the oldest held note.
        //
        // Stealing by press age alone took the notes being *held*. Hold two
        // notes and trill two others: the trill's release tails keep every
        // voice running, so each new press found no silent voice and stole the
        // oldest there was — a held note — and the notes under the player's
        // hands dropped out while the trill played on.
        let i = self
            .voices
            .iter()
            .position(|v| v.note == Some(note))
            .or_else(|| self.voices.iter().position(|v| !v.running))
            .or_else(|| {
                self.voices
                    .iter()
                    .enumerate()
                    .filter(|(_, v)| v.note.is_none())
                    .min_by_key(|(_, v)| v.released)
                    .map(|(i, _)| i)
            })
            .unwrap_or_else(|| {
                // An instrument has a voice at least (`new` builds
                // `n_voices.max(1)`), so this is the oldest of them.
                self.voices
                    .iter()
                    .enumerate()
                    .min_by_key(|(_, v)| v.stamp)
                    .map_or(0, |(i, _)| i)
            });
        // Is anything under the player's fingers right now? Asked *before* the
        // new voice is assigned, because it decides whether this press is one
        // note of a chord or one note of a line.
        let anything_held = self.voices.iter().any(|v| v.note.is_some());
        let glide_on = self.glide > 0.0;
        let bend = self.bend;
        let v = &mut self.voices[i];
        // Portamento is *per voice* (fingered): a voice that was already
        // sounding slides from its own pitch, a fresh voice starts on
        // target. A single global `last_pitch` would chain note→note
        // through a chord and make it swoop in as a scramble.
        //
        // Per-voice alone, though, meant the control did nothing at all
        // for the one thing portamento is for. Voice assignment prefers a
        // *free* voice, so a melody played on a four-voice keybed rotates
        // through voices that were never sounding: `was_sounding` is false
        // for note after note, and every one of them starts dead on pitch.
        // The glide fader moved a number that could not be heard unless
        // you exceeded the polyphony and forced a steal.
        //
        // So a line glides too. A press with nothing else held is a line —
        // it slides from the pitch of the note before it — and a press
        // made while a key is still down is a chord, which still starts on
        // target and keeps its attack clean. That is the same distinction
        // the original comment was protecting; it just wasn't being made.
        let was_sounding = v.running;
        v.pitch_tgt = target;
        v.pitch_cur = if glide_on && was_sounding {
            v.pitch_cur
        } else if glide_on && !anything_held && !first_press {
            start
        } else {
            target
        };
        v.voice.pitch.set(v.pitch_cur + bend);
        // Stealing a voice whose gate is still high needs a real rising
        // edge, or the ADSR never re-enters Attack and the new note
        // inherits the old note's envelope level.
        if v.note.is_some() {
            v.voice.gate.set(0.0);
            v.regate_in = 1;
        } else {
            v.voice.gate.set(GATE_ON);
            v.regate_in = 0;
        }
        v.note = Some(note);
        v.stamp = stamp;
        v.running = true;
        v.silent_run = 0;
        v.vel = Self::vel_gain(vel);
        v.pan_l = std::f32::consts::FRAC_1_SQRT_2;
        v.pan_r = std::f32::consts::FRAC_1_SQRT_2;
        self.restore_knobs(i);
        self.apply_touch(i, vel);
    }

    fn release_voices(&mut self, note: u8) {
        self.counter += 1;
        let at = self.counter;
        for v in &mut self.voices {
            if v.note == Some(note) {
                v.voice.gate.set(0.0);
                v.note = None;
                v.released = at;
                v.regate_in = 0; // a pending retrigger must not resurrect it
            }
        }
    }

    /// Release a MIDI note (the voice keeps ringing through its tail).
    pub fn note_off(&mut self, note: u8) {
        self.held.retain(|(n, _)| *n != note);
        if self.arp_on {
            // Only the arp's own gate matters; other held notes were never
            // pressed. Match on the *base* note, since with an octave range the
            // sounding pitch may be a transposition of the key that was let go.
            if self.arp_base == Some(note) {
                if let Some(n) = self.arp_note.take() {
                    self.release_voices(n);
                }
                self.arp_base = None;
            }
            return;
        }
        self.release_voices(note);
    }

    /// Release everything.
    pub fn all_off(&mut self) {
        self.held.clear();
        self.arp_note = None;
        self.arp_base = None;
        self.counter += 1;
        let at = self.counter;
        for v in &mut self.voices {
            if v.note.is_some() {
                v.released = at;
            }
            v.voice.gate.set(0.0);
            v.note = None;
            v.regate_in = 0;
        }
    }

    /// Pitch bend in semitones (smoothed on the audio thread).
    pub fn set_bend(&mut self, semitones: f64) {
        if !semitones.is_finite() {
            return;
        }
        self.bend_tgt = semitones.clamp(-24.0, 24.0) / 12.0;
    }

    /// Portamento amount 0..1 (0 = off, 1 ≈ 500 ms).
    pub fn set_glide(&mut self, amount: f64) {
        self.glide = amount.clamp(0.0, 1.0);
    }

    /// Unison mode: every voice plays the same note, detuned/panned apart.
    pub fn set_unison(&mut self, on: bool, detune: f64, spread: f64) {
        self.unison = on;
        self.uni_detune = detune.clamp(0.0, 1.0);
        self.uni_spread = spread.clamp(0.0, 1.0);
        if !on {
            // Collapse: keep the newest voice, release the clones.
            let newest = self.voices.iter().map(|v| v.stamp).max().unwrap_or(0);
            self.counter += 1;
            let at = self.counter;
            for v in &mut self.voices {
                if v.note.is_some() && v.stamp != newest {
                    v.voice.gate.set(0.0);
                    v.note = None;
                    v.released = at;
                }
                v.pan_l = std::f32::consts::FRAC_1_SQRT_2;
                v.pan_r = std::f32::consts::FRAC_1_SQRT_2;
            }
        } else if let Some(&(note, vel)) = self.held.last() {
            if !self.arp_on {
                self.press(note, vel);
            }
        }
    }

    /// Configure the arpeggiator. `mode`: 0 up, 1 down, 2 up-down, 3 random.
    /// `div`: steps per beat. `gate`: note length as a fraction of the step
    /// (0.05 staccato … 1.0; at or above [`ARP_TIE`] the pattern is tied and
    /// slides between pitches instead of retriggering). `octaves`: how many
    /// octaves the pattern climbs before wrapping (1–4). `swing`: 0–0.75, which
    /// lengthens every even step and shortens the odd one after it, leaving the
    /// pair's total duration unchanged.
    ///
    /// Turning it off re-presses the held chord; turning it on hands the held
    /// notes to the scheduler.
    #[allow(clippy::too_many_arguments)]
    pub fn set_arp(
        &mut self,
        on: bool,
        mode: u32,
        div: f64,
        bpm: f64,
        gate: f64,
        octaves: u32,
        swing: f64,
    ) {
        self.arp_mode = mode.min(3);
        self.arp_div = div.clamp(0.5, 8.0);
        let bpm = bpm.clamp(30.0, 300.0);
        let retempo = (bpm - self.bpm).abs() > 1e-9;
        self.bpm = bpm;
        if retempo && self.sync_on {
            self.apply_sync();
        }
        self.arp_gate = if gate.is_finite() {
            gate.clamp(0.05, 1.0)
        } else {
            0.5
        };
        self.arp_octaves = octaves.clamp(1, 4);
        self.arp_swing = if swing.is_finite() {
            swing.clamp(0.0, 0.75)
        } else {
            0.0
        };
        if on == self.arp_on {
            return;
        }
        self.arp_on = on;
        // By index rather than over a clone: `press` and `release_voices`
        // touch voices, never `held`, and this runs on the render thread.
        if on {
            // The scheduler owns the gates now.
            for i in 0..self.held.len() {
                let n = self.held[i].0;
                self.release_voices(n);
            }
            self.arp_note = None;
            self.arp_base = None;
            self.arp_phase = f64::MAX; // fire on the next quantum
            self.arp_idx = 0;
            self.arp_step = 0;
            self.arp_up = true;
        } else {
            if let Some(n) = self.arp_note.take() {
                self.release_voices(n);
            }
            self.arp_base = None;
            for i in 0..self.held.len() {
                let (n, v) = self.held[i];
                self.press(n, v);
            }
        }
    }

    fn next_rand(&mut self) -> u64 {
        // xorshift64* — deterministic, no wall clock on the audio thread.
        let mut x = self.rng_state;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.rng_state = x;
        x
    }

    /// Slide the voice currently sounding `from` to pitch `to` without touching
    /// its gate. This is what makes a tied step tie: no falling edge, so the
    /// amp envelope keeps its place and (with glide up) the step portamentos.
    /// `None` if no voice is sounding `from` (stolen out from under us).
    fn arp_slide(&mut self, from: u8, to: u8, vel: f32) -> Option<()> {
        let target = (to as f64 - 60.0) / 12.0;
        let glide_on = self.glide > 0.0;
        let bend = self.bend;
        let v = self.voices.iter_mut().find(|v| v.note == Some(from))?;
        v.pitch_tgt = target;
        if !glide_on {
            v.pitch_cur = target;
        }
        v.voice.pitch.set(v.pitch_cur + bend);
        v.note = Some(to);
        v.vel = Self::vel_gain(vel);
        v.silent_run = 0;
        Some(())
    }

    /// Advance the arpeggiator by `frames` samples. Step boundaries press the
    /// next note of the pattern — the held chord sorted by pitch, repeated
    /// across [`Self::arp_octaves`] octaves — held for `arp_gate` of the step.
    fn tick_arp(&mut self, frames: usize) {
        if !self.arp_on {
            return;
        }
        // Swing lengthens even steps and shortens the odd step that follows by
        // the same amount, so a pair still spans two straight steps and the
        // pattern does not drift against the beat.
        let beat = self.sample_rate * 60.0 / (self.bpm * self.arp_div);
        let step_len = if self.arp_step.is_multiple_of(2) {
            beat * (1.0 + self.arp_swing)
        } else {
            beat * (1.0 - self.arp_swing)
        };
        // Tying is meaningless in unison, where every voice is already gated on
        // the same note and there is no single voice to slide.
        let tied = self.arp_gate >= ARP_TIE && !self.unison;
        self.arp_phase = (self.arp_phase + frames as f64).min(f64::MAX);
        if let Some(n) = self.arp_note {
            // Release at the gate fraction — or immediately if the key this
            // step came from was let go mid-step (every key let go is that
            // key too).
            let key_gone = self
                .arp_base
                .is_none_or(|b| !self.held.iter().any(|(h, _)| *h == b));
            if key_gone || (!tied && self.arp_phase >= step_len * self.arp_gate) {
                self.release_voices(n);
                self.arp_note = None;
                self.arp_base = None;
            }
        }
        // No chord, no step: the next key down fires the first one at once
        // (`note_on`).
        if self.held.is_empty() || self.arp_phase < step_len {
            return;
        }
        // Carry the overshoot. Steps fire on block boundaries, and resetting
        // to zero dropped up to a block per step: at 44.1 kHz, 16ths at 120
        // BPM ran 2.2% slow and fell a whole step behind the synced sequencers
        // in under six seconds. The first step after a (re)start fires from
        // `f64::MAX` and starts the count clean.
        self.arp_phase = if self.arp_phase >= 2.0 * step_len {
            0.0
        } else {
            self.arp_phase - step_len
        };
        self.arp_step = self.arp_step.wrapping_add(1);
        // Into the kept buffers — a step boundary is render-thread code and
        // used to allocate two `Vec`s here. Disjoint fields, so the chord can
        // be read while the pattern is written.
        self.arp_chord.clear();
        self.arp_chord.extend_from_slice(&self.held);
        self.arp_chord.sort_by_key(|(n, _)| *n);
        self.arp_notes.clear();
        for o in 0..self.arp_octaves {
            for &(n, vel) in &self.arp_chord {
                self.arp_notes
                    .push((n.saturating_add(12 * o as u8).min(127), n, vel));
            }
        }
        let len = self.arp_notes.len();
        let pick = match self.arp_mode {
            1 => {
                // Down.
                self.arp_idx = if self.arp_idx == 0 {
                    len - 1
                } else {
                    (self.arp_idx - 1).min(len - 1)
                };
                self.arp_idx
            }
            2 => {
                // Up-down bounce.
                if len == 1 {
                    0
                } else {
                    if self.arp_up {
                        self.arp_idx = (self.arp_idx + 1) % len;
                        if self.arp_idx == len - 1 {
                            self.arp_up = false;
                        }
                    } else {
                        self.arp_idx = self.arp_idx.saturating_sub(1);
                        if self.arp_idx == 0 {
                            self.arp_up = true;
                        }
                    }
                    self.arp_idx.min(len - 1)
                }
            }
            3 => (self.next_rand() as usize) % len,
            _ => {
                // Up.
                self.arp_idx = (self.arp_idx + 1) % len;
                self.arp_idx
            }
        };
        let (note, base, vel) = self.arp_notes[pick.min(len - 1)];
        match self.arp_note.filter(|_| tied) {
            // Tied: reuse the sounding voice so the gate never falls. If it was
            // stolen in the meantime, fall back to a normal press.
            Some(prev) if self.arp_slide(prev, note, vel).is_some() => {}
            _ => self.press(note, vel),
        }
        self.arp_note = Some(note);
        self.arp_base = Some(base);
    }

    /// Set a knob target in the site's own units. The value ramps in over
    /// ~25 ms on the audio thread (no zipper) — **no recompilation**: filter
    /// and delay state survive. Returns false for addresses with no live
    /// handle (the remaining enums, structure) — those need `set_patch`.
    ///
    /// "The site's own units" is new, and it is the whole reason `table` and
    /// `oct` can be here at all: they send a *category index*, and the blanket
    /// `clamp(0.0, 1.0)` this used to apply would have folded all eight
    /// wavetables onto the first two and every octave onto −2 and −1.
    pub fn set_param(&mut self, addr: &str, value: f64) -> bool {
        // `clamp` passes NaN, and a NaN target would ride the smoother into
        // the atomic the voice reads every sample. Refuse it as a bad gesture.
        if !value.is_finite() {
            return false;
        }
        // A scan of the interned table, not a `HashMap` lookup plus an owned
        // copy of the address: this runs in the worklet's `onmessage`, on the
        // render thread, once per knob message of a drag.
        let Some(slot) = self.param_slots.iter().position(|p| p.addr == addr) else {
            return false;
        };
        // A `steps` rate knob is the free rate its lane snaps from: with sync
        // on, a gesture (or a drift) moves which division plays, not the
        // clock off the grid.
        if let Some(lane) = self.sync_lanes.iter_mut().find(|l| l.rate_slot == slot) {
            lane.free = self.param_slots[slot].map.clamp_input(value);
            if self.sync_on {
                self.smoothers.retain(|s| s.slot != slot);
                let x = snap_rate(lane.free, self.bpm);
                let p = &mut self.param_slots[slot];
                let v = p.map.apply(x);
                p.set_all(v);
                return true;
            }
        }
        let p = &self.param_slots[slot];
        let target = p.map.apply(p.map.clamp_input(value));
        // A ramp starts from the knob, not from voice 0, which may hold a
        // note's touch: from there the ramp's first step pulled every voice
        // toward that note's offset.
        let current = p.knob;
        if let Some(s) = self.smoothers.iter_mut().find(|s| s.slot == slot) {
            s.target = target;
        } else {
            self.smoothers.push(Smoother {
                slot,
                current,
                target,
            });
        }
        true
    }

    /// Whether the leveler holds sustained loudness down (on by default,
    /// which is what the app plays). Off is for an offline renderer that sets
    /// every level by hand — `examples/score.rs` — and must not have a mix
    /// moved under it; the brickwall stays either way.
    pub fn set_leveler(&mut self, on: bool) {
        self.leveler.on = on;
        if !on {
            self.leveler.gain = 1.0;
            self.leveler.energy = 0.0;
        }
    }

    /// Loudness makeup gain (linear), within −24..+60 dB. Applied immediately
    /// when idle, or deferred to swap completion when a patch swap is pending
    /// (so the outgoing patch fades at its own level).
    pub fn set_makeup(&mut self, gain: f64) {
        if !gain.is_finite() {
            return;
        }
        let g = gain.clamp(
            10f64.powf(MAKEUP_MIN_DB / 20.0),
            10f64.powf(MAKEUP_MAX_DB / 20.0),
        ) as f32;
        if matches!(self.stage, Stage::FadeOut { .. } | Stage::Rebuild { .. }) {
            self.pending_makeup = Some(g);
        } else {
            self.makeup = g;
        }
    }

    /// Advance pitch bend (one-pole) and per-voice glide, then write the
    /// combined pitch to each sounding voice's atomic.
    fn advance_pitch(&mut self, frames: usize) {
        self.bend += (self.bend_tgt - self.bend) * 0.5;
        if (self.bend - self.bend_tgt).abs() < 1.0e-6 {
            self.bend = self.bend_tgt;
        }
        let dt = frames as f64 / self.sample_rate;
        let coeff = if self.glide > 0.0 {
            1.0 - (-dt / (self.glide * 0.5).max(1.0e-3)).exp()
        } else {
            1.0
        };
        for v in &mut self.voices {
            if v.note.is_none() && !v.running {
                continue;
            }
            v.pitch_cur += (v.pitch_tgt - v.pitch_cur) * coeff;
            if (v.pitch_cur - v.pitch_tgt).abs() < 1.0e-6 {
                v.pitch_cur = v.pitch_tgt;
            }
            v.voice.pitch.set(v.pitch_cur + self.bend);
        }
        // The open voice stays on its key; the bend reaches it as it reaches
        // a held one.
        if let Some(v) = self.open.as_mut() {
            if v.running {
                v.voice.pitch.set(v.pitch_cur + self.bend);
            }
        }
    }

    fn advance_smoothers(&mut self) {
        if self.smoothers.is_empty() {
            return;
        }
        for s in &mut self.smoothers {
            s.current += (s.target - s.current) * SMOOTH_COEFF;
            if (s.current - s.target).abs() < SMOOTH_EPS {
                s.current = s.target;
            }
            // One atomic store per voice; the handles were resolved at the
            // swap, so nothing is hashed here.
            self.param_slots[s.slot].set_all(s.current);
        }
        self.smoothers.retain(|s| s.current != s.target);
    }

    /// Which voice the meter reads, or `None` when metering is off or nothing
    /// is sounding.
    ///
    /// The **most recently pressed** sounding voice, by allocation stamp —
    /// deliberately not a sum across the bank. A sum averages different notes
    /// at different envelope phases, which is not the level on any wire; the
    /// newest voice is the one the player just played and the one whose
    /// envelope is opening. It is re-chosen every quantum, so the readout
    /// follows the hand.
    fn meter_voice(&self) -> Option<usize> {
        if !self.meter.on {
            return None;
        }
        self.voices
            .iter()
            .enumerate()
            .filter(|(_, v)| v.running)
            .max_by_key(|(_, v)| v.stamp)
            .map(|(i, _)| i)
    }

    fn render_into(&mut self, frames: usize, fade_dir: i8) {
        self.out_buf.clear();
        self.out_buf.resize(frames * 2, 0.0);
        let metered = self.meter_voice();
        // The open voice first: for a tracked patch it is the lead, and the
        // keys' voices play what it tracked this quantum, frame by frame. The
        // meter reads it when no key's voice is sounding, so the rack's levels
        // follow the input then.
        let mut open_metered = false;
        if let Some(lead) = self.lead.as_mut() {
            lead.filled = 0;
        }
        if let Some(v) = self.open.as_mut() {
            if v.running {
                open_metered = self.meter.on && metered.is_none();
                let meter = if open_metered {
                    Some(&mut self.meter)
                } else {
                    None
                };
                let tracks = match self.lead.as_mut() {
                    Some(lead) => {
                        lead.filled = frames.min(LIVE_INPUT_FRAMES);
                        Tracks::Lead(&mut lead.buf, lead.stride)
                    }
                    None => Tracks::None,
                };
                tick_voice(v, frames, &mut self.out_buf, meter, tracks);
            }
        }
        for (vi, v) in self.voices.iter_mut().enumerate() {
            if !v.running {
                continue;
            }
            let meter = if metered == Some(vi) {
                Some(&mut self.meter)
            } else {
                None
            };
            let tracks = match self.lead.as_ref() {
                Some(lead) if lead.filled > 0 => {
                    Tracks::Follow(&lead.feeds[vi], &lead.buf, lead.stride, lead.filled)
                }
                _ => Tracks::None,
            };
            tick_voice(v, frames, &mut self.out_buf, meter, tracks);
        }
        let metered = metered.or(open_metered.then_some(usize::MAX));
        if metered.is_some() {
            self.meter.drain();
        }
        // Per-frame swap fade, loudness makeup, the leveler, then the master
        // brickwall. Each voice carries its own limiter, but N voices sum to N×
        // one voice — the master stage is what keeps a held chord off the rail.
        for f in 0..frames {
            if fade_dir < 0 {
                self.gain = (self.gain - FADE_STEP).max(0.0);
            } else if fade_dir > 0 {
                self.gain = (self.gain + FADE_STEP).min(1.0);
            }
            let g = self.gain * self.makeup;
            let mut l = self.out_buf[f * 2] * g;
            let mut r = self.out_buf[f * 2 + 1] * g;
            let held_down = self.leveler.tick(l, r);
            l *= held_down;
            r *= held_down;
            self.master.tick(&mut l, &mut r);
            self.out_buf[f * 2] = l;
            self.out_buf[f * 2 + 1] = r;
        }
    }

    fn step(&mut self, frames: usize) {
        self.advance_smoothers();
        self.tick_arp(frames);
        self.advance_pitch(frames);
        self.drive_sync();
        if self.sync_on {
            self.beats += frames as f64 * self.bpm / (60.0 * self.sample_rate);
        }
        match std::mem::replace(&mut self.stage, Stage::Run) {
            Stage::Run => self.render_into(frames, 0),
            Stage::FadeOut { tree } => {
                self.render_into(frames, -1);
                self.stage = if self.gain <= 0.0 {
                    Stage::Rebuild {
                        tree,
                        built: Vec::new(),
                    }
                } else {
                    Stage::FadeOut { tree }
                };
            }
            Stage::Rebuild { tree, built } => {
                // Silent: compile exactly one voice per quantum. Overruns
                // here can drop a quantum of *silence* — inaudible.
                self.rebuild_one(tree, built);
                self.emit_silence(frames);
            }
            Stage::FadeIn => {
                self.render_into(frames, 1);
                self.stage = if self.gain >= 1.0 {
                    Stage::Run
                } else {
                    Stage::FadeIn
                };
            }
        }
    }

    /// One quantum of a swap's rebuild: compile the next voice of `tree`
    /// onto `built`, and once there are enough, put them in place of the
    /// old ones and fade in. A tree that does not compile keeps the old
    /// voices, says why, and fades them back in.
    fn rebuild_one(&mut self, tree: PatchTree, mut built: Vec<Voice>) {
        // A patch that listens (or tracks) is built one voice longer: the
        // last is its open voice (`set_open`), which leads a tracked patch's
        // other voices, so it alone is no follower.
        let tracked = has_track(&tree.root);
        let extra = tree.listens() || tracked;
        let follow = tracked && built.len() < self.n_voices;
        match build_voice(&tree, self.sample_rate, &self.input, follow) {
            Err(e) => {
                // Keep the old voices; report and fade back in.
                self.last_error = e;
                self.event = EVENT_PATCH_ERROR;
                self.pending_makeup = None;
                self.stage = Stage::FadeIn;
            }
            Ok(v) => {
                built.push(v);
                if built.len() < self.n_voices + usize::from(extra) {
                    self.stage = Stage::Rebuild { tree, built };
                    return;
                }
                let open = if extra { built.pop() } else { None };
                // The open voice's envelope is carried like a held
                // note's, so a swap does not re-attack the input.
                let open_phase = self
                    .open
                    .as_ref()
                    .filter(|v| v.note.is_some())
                    .map(|v| v.voice.env_phase());
                // Where every sounding note's amp envelope had got
                // to, read off the *outgoing* voices while they are
                // still here. This is the whole of the envelope
                // carry: re-pressing a held note on a fresh voice
                // restarts its ADSR from zero, so a sustained pad
                // re-swelled on every structural edit — the edit
                // was audible as an event in its own right rather
                // than as a change to the sound.
                let carry: Vec<(u8, f64)> = self
                    .voices
                    .iter()
                    .filter_map(|v| Some((v.note?, v.voice.env_phase())))
                    .collect();
                self.voices = built;
                // New voices, new handles: the smoothers indexed
                // the old table, and the table is remade from the
                // voices that exist now. This is the one place
                // outside `new` that allocates for parameters,
                // and it is inside the swap that already compiles.
                self.open = open;
                self.lead = Lead::build(&self.voices, self.open.as_ref());
                self.smoothers.clear();
                self.param_slots = intern_params(&self.voices, self.open.as_ref());
                self.rebuild_sync_lanes();
                // New patch, new node ids, and a new set of module
                // keys. Re-taking the subscriptions here is what
                // keeps a stale `NodeId` from resolving against a
                // slotmap that never issued it.
                if let Some(v) = self.voices.first() {
                    let voice = &v.voice;
                    self.meter.resubscribe(voice);
                }
                if let Some(g) = self.pending_makeup.take() {
                    self.makeup = g;
                }
                if self.arp_on {
                    // The scheduler re-presses on its next step.
                    self.arp_note = None;
                } else {
                    for i in 0..self.held.len() {
                        let (n, v) = self.held[i];
                        self.press(n, v);
                    }
                    // Gates are up and no falling edge was ever
                    // presented, so nothing needs re-gating — the
                    // new envelopes are simply fast-forwarded to
                    // where the old ones were. A note that was
                    // *not* held (a release tail) is not carried:
                    // its voice was reallocated, and a tail cannot
                    // survive a rewire anyway.
                    for v in &mut self.voices {
                        let Some(note) = v.note else { continue };
                        let Some((_, phase)) = carry.iter().find(|(n, _)| *n == note) else {
                            continue;
                        };
                        v.voice.seed_env_phase(*phase);
                    }
                }
                // The new patch's open voice, if it has one and the
                // host wants it; a patch with none has nothing to
                // hold (the old one went with the old voices).
                self.sync_open();
                if let (Some(v), Some(phase)) = (self.open.as_mut(), open_phase) {
                    if v.note.is_some() {
                        v.voice.seed_env_phase(phase);
                    }
                }
                self.event = EVENT_PATCHED;
                self.stage = Stage::FadeIn;
            }
        }
    }

    fn emit_silence(&mut self, frames: usize) {
        self.out_buf.clear();
        self.out_buf.resize(frames * 2, 0.0);
    }

    /// Where to write a quantum's live input, interleaved
    /// (`[l0, r0, l1, r1, …]` for stereo, `[x0, x1, …]` for mono): a view
    /// into wasm memory holding [`Self::input_capacity`] frames of
    /// [`LIVE_INPUT_CHANNELS`] samples. Write it, call
    /// [`Self::write_input`], then [`Self::process_ptr`], every quantum.
    pub fn input_ptr(&mut self) -> *mut f32 {
        self.input_buf.as_mut_ptr()
    }

    /// The most frames one quantum's input may hold.
    pub fn input_capacity(&self) -> usize {
        LIVE_INPUT_FRAMES
    }

    /// Publish the `frames` frames of `channels` interleaved samples just
    /// written at [`Self::input_ptr`] as this quantum's input: every AUDIO IN
    /// in every voice plays them over the next `frames` frames. Allocation
    /// free; frames past the capacity are dropped, and a channel count of 0
    /// (or above two) is read as the stream's own two.
    ///
    /// Write before each [`Self::process_ptr`]. Without a write the input is
    /// silent (quiver never repeats a block), so a dropped or stopped capture
    /// falls silent rather than looping.
    pub fn write_input(&mut self, frames: usize, channels: usize) {
        let channels = if (1..=LIVE_INPUT_CHANNELS).contains(&channels) {
            channels
        } else {
            LIVE_INPUT_CHANNELS
        };
        let n = frames.min(LIVE_INPUT_FRAMES) * channels;
        self.input.write_interleaved(&self.input_buf[..n], channels);
    }

    /// Silence the live input at once: the capture stopped or the device
    /// went away.
    pub fn clear_input(&mut self) {
        self.input.clear();
    }

    /// Hold the patch open for its input, or let it close.
    ///
    /// Every patch ends in the amp envelope, gated by the keys, and a voice
    /// with no key down parks once its tail is silent, so a patch that listens
    /// is silent with no key down however loud its input is: an AUDIO IN into
    /// a filter would be heard only while a note is held, and a patch played
    /// by its input (a TRACK, whose gate opens the amp) only by a voice a key
    /// had left running. With `on`, a patch
    /// that listens sounds its **open voice**: one more voice of the patch,
    /// gated as if [`OPEN_NOTE`] were held at full velocity, so the input
    /// sounds through the whole patch, amp envelope included (it settles at
    /// the sustain level, as a held key does). The keys play the other voices
    /// over it. Each of those hears the input too, as every voice of a chord
    /// in the phrase does, so a key held over the open voice adds a second
    /// copy of the input for as long as it sounds.
    ///
    /// A patch that does not listen has no open voice, so `on` changes nothing
    /// you can hear (no drone from a patch with no input). It is kept across
    /// patch swaps: a swap to a patch that listens opens the new open voice,
    /// carrying the old one's envelope as a held note's is carried, and a swap
    /// to one that does not ends it with the old voices, under the swap's
    /// fade. `off` releases it into its tail, and it parks once that is
    /// silent.
    ///
    /// A patch with a TRACK has an open voice even if nothing in it listens,
    /// and it is the **one tracked voice** ([`Lead`]): it is not held like a
    /// key, because its tracker's gate opens its amp, so it sounds while the
    /// input does; and the keys' voices follow it (their TRACKs play what it
    /// tracks, and they stop with their keys) instead of each tracking the
    /// input and staying open after their key was let go.
    ///
    /// Allocation free: the open voice is compiled with the patch (in
    /// [`Self::new`] or the swap's rebuild), never here.
    pub fn set_open(&mut self, on: bool) {
        self.open_on = on;
        self.sync_open();
    }

    /// Is the open voice sounding (held open, or ringing out)?
    pub fn open_sounding(&self) -> bool {
        self.open.as_ref().is_some_and(|v| v.running)
    }

    /// Raise (`on`) or drop the record gate of the CAPTURE at node `key` in
    /// every voice. A raised gate records the branch patched into the capture
    /// from the top of its buffer, in any voice that is ticking, for at most
    /// `TAKE_SECONDS` a press (quiver's `RecordWindow`). Returns whether the
    /// patch has a capture there. Allocation free.
    ///
    /// The worklet records with an instrument of its own (one voice of the
    /// patch, its key held), so recording neither needs MONITOR nor touches
    /// the voices under the player's hands; it then reads the recording with
    /// [`Self::take_json`] and the page puts it in the patch.
    pub fn set_record(&mut self, key: &str, on: bool) -> bool {
        let level = if on { GATE_ON } else { 0.0 };
        let mut found = false;
        for v in self.voices.iter().chain(self.open.as_ref()) {
            if let Some(gate) = v.voice.records.get(key) {
                gate.set(level);
                found = true;
            }
        }
        found
    }

    /// The recording the CAPTURE at node `key` holds in the first sounding
    /// voice (the one a recording ran in; the first voice when none is
    /// sounding), as the take's saved JSON (`f32le-base64`), the form
    /// `StructOp::SetTake` and `WasmEngine::readmit_held` take. Empty when
    /// the patch has no capture there. Allocates: the port handler's, never
    /// `process()`.
    pub fn take_json(&self, key: &str) -> String {
        self.voices
            .iter()
            .find(|v| v.running)
            .or(self.voices.first())
            .and_then(|v| v.voice.take(key))
            .and_then(|t| serde_json::to_string(&t).ok())
            .unwrap_or_default()
    }

    /// Bring the open voice's gate in line with [`Self::open_on`].
    fn sync_open(&mut self) {
        let on = self.open_on;
        let bend = self.bend;
        self.counter += 1;
        let at = self.counter;
        // A tracked patch's lead is opened by its tracker's gate, not held
        // like a key: it sounds while the input does.
        let tracked = self.lead.is_some();
        if !on {
            if let Some(lead) = self.lead.as_ref() {
                lead.quiet();
            }
        }
        let Some(v) = self.open.as_mut() else { return };
        if on && v.note.is_none() {
            v.pitch_cur = 0.0;
            v.pitch_tgt = 0.0;
            v.voice.pitch.set(bend);
            v.voice.gate.set(if tracked { 0.0 } else { GATE_ON });
            v.regate_in = 0;
            v.note = Some(OPEN_NOTE);
            v.stamp = at;
            v.running = true;
            v.silent_run = 0;
            v.vel = Self::vel_gain(1.0);
            v.pan_l = std::f32::consts::FRAC_1_SQRT_2;
            v.pan_r = std::f32::consts::FRAC_1_SQRT_2;
        } else if !on && v.note.is_some() {
            v.voice.gate.set(0.0);
            v.note = None;
            v.released = at;
            v.regate_in = 0;
        }
    }

    /// Render `frames` frames into the internal interleaved-stereo buffer
    /// and return a pointer into wasm memory — the zero-allocation worklet
    /// path (`[l0, r0, l1, r1, …]`, `frames * 2` floats).
    pub fn process_ptr(&mut self, frames: usize) -> *const f32 {
        self.step(frames);
        self.out_buf.as_ptr()
    }

    /// Render and return a copy (allocating; native tests only).
    pub fn process(&mut self, frames: usize) -> Vec<f32> {
        self.step(frames);
        self.out_buf.clone()
    }
}

/// RECORD's take, rendered off the audio thread (in the engine worker):
/// `samples`, the input as it was recorded (interleaved, `channels` per
/// frame, at `sample_rate`), played through the CAPTURE at `key`'s own branch
/// with the record gate raised, as the live recorder would have done from a
/// key held at C4. One voice of `tree_json`, the same compile and the same
/// input path as the instrument, so the take is the one recording live would
/// have made; but none of it (the compile, the render of the CAPTURE's input
/// branch, the take's encode) runs on the render thread, which now only
/// copies the input while RECORD is lit.
///
/// Returns the take's saved JSON, or an empty string when the tree does not
/// compile or there is no CAPTURE at `key`. Allocates; not for the audio
/// thread.
#[wasm_bindgen]
pub fn render_take(
    tree_json: &str,
    key: &str,
    samples: &[f32],
    channels: usize,
    sample_rate: f64,
) -> String {
    let Ok(mut poly) = LivePoly::new(tree_json, sample_rate, 1) else {
        return String::new();
    };
    poly.set_leveler(false);
    poly.note_on(OPEN_NOTE, 1.0);
    if !poly.set_record(key, true) {
        return String::new();
    }
    let ch = channels.clamp(1, LIVE_INPUT_CHANNELS);
    const Q: usize = 128;
    for block in samples.chunks(Q * ch) {
        let frames = block.len() / ch;
        for f in 0..frames {
            for c in 0..LIVE_INPUT_CHANNELS {
                poly.input_buf[f * LIVE_INPUT_CHANNELS + c] = block[f * ch + c.min(ch - 1)];
            }
        }
        poly.write_input(frames, LIVE_INPUT_CHANNELS);
        poly.process_ptr(frames);
    }
    poly.set_record(key, false);
    poly.take_json(key)
}

#[cfg(test)]
mod tests;
