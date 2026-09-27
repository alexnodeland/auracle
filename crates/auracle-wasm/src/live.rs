//! The live performance voice: N copies of one compiled patch, played from a
//! keyboard in real time inside an AudioWorklet.
//!
//! This is the "instrument" half of the app (the `WasmEngine` in the worker
//! is the "brain"). It shares the exact compilation path evolution uses —
//! `auracle_grammar::compile` with the mandatory ADSR → VCA → Limiter chain
//! — so what you play is byte-for-byte the patch that was evolved, limiter
//! included.
//!
//! ## Audio-thread discipline (no clicks, no zipper, no GC)
//!
//! - **Zero allocation per quantum**: [`LivePoly::process_ptr`] renders into
//!   a persistent internal buffer and returns a pointer; the worklet views
//!   wasm memory directly. The `Vec`-returning [`LivePoly::process`] exists
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
//!
//! Per-quantum work outside a swap allocates nothing: the arpeggiator reuses
//! two buffers sized for a full keyboard, and knob smoothers index a table of
//! live parameter handles that is rebuilt once per swap (`param_slots`), so a
//! knob write is a linear scan and an atomic store rather than a `String`
//! allocation and a `HashMap` lookup per voice. Metering allocates while it is
//! on (see [`Meter`]); the recorder while a take is rolling.

use std::sync::Arc;

use auracle_grammar::{compile, ParamMap, PatchTree};
use quiver::observer::{ObservableValue, StateObserver, SubscriptionTarget};
use quiver::AtomicF64;
use wasm_bindgen::prelude::*;

const GATE_ON: f64 = 5.0;
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

struct Voice {
    voice: auracle_grammar::CompiledVoice,
    /// Currently-held MIDI note, if any (gate high).
    note: Option<u8>,
    /// Allocation stamp for oldest-first stealing.
    stamp: u64,
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
    /// Index-parallel to `voices`.
    values: Vec<Arc<AtomicF64>>,
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
/// 3.7 steps/s at 120 BPM plays 16ths, 4 steps/s), among the divisions the
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
fn intern_params(voices: &[Voice]) -> Vec<ParamSlot> {
    let Some(first) = voices.first() else {
        return Vec::new();
    };
    let mut addrs: Vec<&String> = first.voice.params.keys().collect();
    addrs.sort();
    addrs
        .into_iter()
        .map(|addr| ParamSlot {
            addr: addr.clone(),
            map: first.voice.params[addr].map,
            values: voices
                .iter()
                .filter_map(|v| v.voice.params.get(addr).map(|h| Arc::clone(&h.value)))
                .collect(),
        })
        .collect()
}

enum Stage {
    Run,
    FadeOut,
    Rebuild { built: Vec<Voice> },
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
    pending: Option<PatchTree>,
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
            let ObservableValue::Level {
                node_id,
                port_id,
                rms_db,
                ..
            } = update
            else {
                continue;
            };
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

fn build_voice(tree: &PatchTree, sample_rate: f64) -> Result<Voice, String> {
    let voice = compile(tree, sample_rate).map_err(|e| e.to_string())?;
    voice.gate.set(0.0);
    Ok(Voice {
        voice,
        note: None,
        stamp: 0,
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

#[wasm_bindgen]
impl LivePoly {
    /// Build an `n_voices`-voice instrument from a `PatchTree` JSON.
    #[wasm_bindgen(constructor)]
    pub fn new(tree_json: &str, sample_rate: f64, n_voices: usize) -> Result<LivePoly, JsValue> {
        let tree: PatchTree =
            serde_json::from_str(tree_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let n = n_voices.max(1);
        let voices: Vec<Voice> = (0..n)
            .map(|_| build_voice(&tree, sample_rate))
            .collect::<Result<_, _>>()
            .map_err(|e| JsValue::from_str(&e))?;
        let param_slots = intern_params(&voices);
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
            pending: None,
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
            let p = &self.param_slots[lane.rate_slot];
            let v = p.map.apply(x);
            p.values.iter().for_each(|a| a.set(v));
            if !self.sync_on {
                let s = &self.param_slots[lane.sync_slot];
                s.values
                    .iter()
                    .for_each(|a| a.set(auracle_grammar::steps::SYNC_FREE));
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
            let s = &self.param_slots[lane.sync_slot];
            s.values.iter().for_each(|a| a.set(pos));
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
        serde_json::to_string(&self.meter.keys).unwrap_or_else(|_| "[]".into())
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
    /// can hold a soft dark note beside a loud bright one. Stated limit: a
    /// parameter ramp on the same knob ([`Self::set_param`]) writes every
    /// voice and so resets held notes' offsets until their next note-on.
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
        self.pending = Some(tree);
        match self.stage {
            // Already silent/rebuilding: restart the rebuild with the newer
            // tree (coalesces rapid structural edits).
            Stage::Rebuild { .. } => self.stage = Stage::Rebuild { built: Vec::new() },
            _ => self.stage = Stage::FadeOut,
        }
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
                self.apply_touch(i, vel);
            }
            return;
        }
        self.counter += 1;
        let stamp = self.counter;
        let idx = self
            .voices
            .iter()
            .position(|v| v.note == Some(note))
            .or_else(|| self.voices.iter().position(|v| !v.running))
            .or_else(|| {
                self.voices
                    .iter()
                    .enumerate()
                    .min_by_key(|(_, v)| v.stamp)
                    .map(|(i, _)| i)
            });
        // Is anything under the player's fingers right now? Asked *before* the
        // new voice is assigned, because it decides whether this press is one
        // note of a chord or one note of a line.
        let anything_held = self.voices.iter().any(|v| v.note.is_some());
        if let Some(i) = idx {
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
            self.apply_touch(i, vel);
        }
    }

    fn release_voices(&mut self, note: u8) {
        for v in &mut self.voices {
            if v.note == Some(note) {
                v.voice.gate.set(0.0);
                v.note = None;
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
        for v in &mut self.voices {
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
            for v in &mut self.voices {
                if v.note.is_some() && v.stamp != newest {
                    v.voice.gate.set(0.0);
                    v.note = None;
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
    /// Returns false if that voice was stolen out from under us.
    fn arp_slide(&mut self, from: u8, to: u8, vel: f32) -> bool {
        let Some(i) = self.voices.iter().position(|v| v.note == Some(from)) else {
            return false;
        };
        let target = (to as f64 - 60.0) / 12.0;
        let glide_on = self.glide > 0.0;
        let bend = self.bend;
        let v = &mut self.voices[i];
        v.pitch_tgt = target;
        if !glide_on {
            v.pitch_cur = target;
        }
        v.voice.pitch.set(v.pitch_cur + bend);
        v.note = Some(to);
        v.vel = Self::vel_gain(vel);
        v.silent_run = 0;
        true
    }

    /// Advance the arpeggiator by `frames` samples. Step boundaries press the
    /// next note of the pattern — the held chord sorted by pitch, repeated
    /// across [`Self::arp_octaves`] octaves — held for `arp_gate` of the step.
    fn tick_arp(&mut self, frames: usize) {
        if !self.arp_on {
            return;
        }
        if self.held.is_empty() {
            if let Some(n) = self.arp_note.take() {
                self.release_voices(n);
            }
            self.arp_base = None;
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
            // step came from was let go mid-step.
            let key_gone = self
                .arp_base
                .is_none_or(|b| !self.held.iter().any(|(h, _)| *h == b));
            if key_gone || (!tied && self.arp_phase >= step_len * self.arp_gate) {
                self.release_voices(n);
                self.arp_note = None;
                self.arp_base = None;
            }
        }
        if self.arp_phase < step_len {
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
            Some(prev) if self.arp_slide(prev, note, vel) => {}
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
                let p = &self.param_slots[slot];
                let v = p.map.apply(x);
                p.values.iter().for_each(|a| a.set(v));
                return true;
            }
        }
        let p = &self.param_slots[slot];
        let target = p.map.apply(p.map.clamp_input(value));
        let current = p.values.first().map_or(target, |v| v.get());
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

    /// Loudness makeup gain (linear). Applied immediately when idle, or
    /// deferred to swap completion when a patch swap is pending (so the
    /// outgoing patch fades at its own level).
    pub fn set_makeup(&mut self, gain: f64) {
        if !gain.is_finite() {
            return;
        }
        let g = gain.clamp(0.1, 8.0) as f32;
        if self.pending.is_some() {
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
            for value in &self.param_slots[s.slot].values {
                value.set(s.current);
            }
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
        for (vi, v) in self.voices.iter_mut().enumerate() {
            if !v.running {
                continue;
            }
            let meter_this = metered == Some(vi);
            let held = v.note.is_some();
            let mut tail_silent = 0u32;
            for f in 0..frames {
                let (l, r) = v.voice.patch.tick();
                // Per sample, not per quantum: the capture is allocation-free
                // and quiver's own guidance is that a per-block sample aliases
                // everything above `sample_rate / (2 * block_size)`. A level
                // read 128 samples apart is not a level.
                if meter_this {
                    self.meter.observer.collect_sample(&v.voice.patch);
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
                self.out_buf[f * 2] += l as f32 * g * v.pan_l;
                self.out_buf[f * 2 + 1] += r as f32 * g * v.pan_r;
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
        if metered.is_some() {
            self.meter.drain();
        }
        // Per-frame swap fade, loudness makeup, then the master brickwall.
        // Each voice carries its own limiter, but N voices sum to N× one
        // voice — the master stage is what keeps a held chord off the rail.
        for f in 0..frames {
            if fade_dir < 0 {
                self.gain = (self.gain - FADE_STEP).max(0.0);
            } else if fade_dir > 0 {
                self.gain = (self.gain + FADE_STEP).min(1.0);
            }
            let g = self.gain * self.makeup;
            let mut l = self.out_buf[f * 2] * g;
            let mut r = self.out_buf[f * 2 + 1] * g;
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
        let rebuilding = matches!(self.stage, Stage::Rebuild { .. });
        if rebuilding {
            // Silent: compile exactly one voice per quantum. Overruns here
            // can drop a quantum of *silence* — inaudible.
            let Stage::Rebuild { built } = std::mem::replace(&mut self.stage, Stage::FadeIn) else {
                unreachable!()
            };
            let mut built = built;
            if let Some(tree) = self.pending.clone() {
                match build_voice(&tree, self.sample_rate) {
                    Ok(v) => {
                        built.push(v);
                        if built.len() >= self.n_voices {
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
                            self.pending = None;
                            // New voices, new handles: the smoothers indexed
                            // the old table, and the table is remade from the
                            // voices that exist now. This is the one place
                            // outside `new` that allocates for parameters,
                            // and it is inside the swap that already compiles.
                            self.smoothers.clear();
                            self.param_slots = intern_params(&self.voices);
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
                                    let Some((_, phase)) = carry.iter().find(|(n, _)| *n == note)
                                    else {
                                        continue;
                                    };
                                    v.voice.seed_env_phase(*phase);
                                }
                            }
                            self.event = EVENT_PATCHED;
                            self.stage = Stage::FadeIn;
                        } else {
                            self.stage = Stage::Rebuild { built };
                        }
                    }
                    Err(e) => {
                        // Keep the old voices; report and fade back in.
                        self.last_error = e;
                        self.event = EVENT_PATCH_ERROR;
                        self.pending = None;
                        self.pending_makeup = None;
                        self.stage = Stage::FadeIn;
                    }
                }
            }
            self.emit_silence(frames);
            return;
        }
        match self.stage {
            Stage::Run => self.render_into(frames, 0),
            Stage::FadeOut => {
                self.render_into(frames, -1);
                if self.gain <= 0.0 {
                    self.stage = Stage::Rebuild { built: Vec::new() };
                }
            }
            Stage::FadeIn => {
                self.render_into(frames, 1);
                if self.gain >= 1.0 {
                    self.stage = Stage::Run;
                }
            }
            Stage::Rebuild { .. } => unreachable!(),
        }
    }

    fn emit_silence(&mut self, frames: usize) {
        self.out_buf.clear();
        self.out_buf.resize(frames * 2, 0.0);
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

#[cfg(test)]
mod tests {
    use super::*;
    use auracle_grammar::{PatchGrammarPrior, Uid};
    use rand::rngs::StdRng;
    use rand::{Rng, SeedableRng};

    fn tree_json(rng: &mut StdRng) -> String {
        serde_json::to_string(&PatchGrammarPrior::default().sample_with_rng(rng)).unwrap()
    }

    /// A plain saw → lowpass voice with a **percussive** amp envelope: fast
    /// attack, medium decay, sustain 0. Once the decay has run the voice is
    /// silent while its gate is still high, which makes an envelope retrigger
    /// unmistakable — with one, a stolen voice speaks; without one, it cannot.
    fn plucked_json() -> String {
        use auracle_grammar::term::{AmpEnv, FilterKind, Waveform};
        use auracle_grammar::{AudioNode, ModNode, PatchTree};
        serde_json::to_string(&PatchTree {
            amp: AmpEnv {
                attack: 0.2,  // ≈6 ms
                decay: 0.45,  // ≈63 ms
                sustain: 0.0, // the whole point
                release: 0.3, // ≈16 ms
            },
            root: AudioNode::Filter {
                uid: Uid::NEW,
                kind: FilterKind::SvfLp,
                cutoff: 0.7,
                resonance: 0.1,
                mod_depth: 0.0,
                input: Box::new(AudioNode::Vco {
                    uid: Uid::NEW,
                    wave: Waveform::Saw,
                    octave: 0,
                    detune: 0.5,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                }),
                modulation: ModNode::None,
            },
        })
        .unwrap()
    }

    fn peak(buf: &[f32]) -> f32 {
        buf.iter().fold(0.0f32, |m, s| m.max(s.abs()))
    }

    fn energy(buf: &[f32]) -> f64 {
        buf.iter().map(|s| (*s as f64) * (*s as f64)).sum()
    }

    /// Native smoke: a prior patch plays a note (finite, audible), rings a
    /// tail after release, and eventually parks its voices.
    #[test]
    fn live_poly_plays_and_parks() {
        let mut rng = StdRng::seed_from_u64(0x11FE);
        let json = tree_json(&mut rng);
        let mut poly = LivePoly::new(&json, 44_100.0, 4).expect("compiles");

        poly.note_on(60, 1.0);
        poly.note_on(64, 1.0);
        let mut energy = 0.0f64;
        for _ in 0..40 {
            let out = poly.process(512);
            assert!(out.iter().all(|s| s.is_finite()));
            energy += out.iter().map(|s| (*s as f64) * (*s as f64)).sum::<f64>();
        }
        assert!(energy > 1e-6, "held notes produced silence");

        poly.note_off(60);
        poly.note_off(64);
        for _ in 0..900 {
            poly.process(512);
            if poly.voices.iter().all(|v| !v.running) {
                break;
            }
        }
        assert!(
            poly.voices.iter().all(|v| !v.running),
            "voices never parked after release"
        );
    }

    /// Live params: setting a knob mid-note ramps the sound smoothly to the
    /// mapped target without resetting the voice, and junk/enum addresses
    /// are refused.
    #[test]
    fn live_params_ramp_without_retrigger() {
        let (_, tree) = auracle_grammar::presets()
            .into_iter()
            .find(|(n, _)| *n == "First Bass")
            .expect("preset exists");
        let json = serde_json::to_string(&tree).unwrap();
        let mut a = LivePoly::new(&json, 44_100.0, 1).unwrap();
        let mut b = LivePoly::new(&json, 44_100.0, 1).unwrap();
        a.note_on(48, 1.0);
        b.note_on(48, 1.0);
        let _ = a.process(2048);
        let _ = b.process(2048);
        assert!(a.set_param("node#cut", 1.0), "cutoff handle missing");
        assert!(
            !a.set_param("node#wave", 0.5),
            "enum sites must not be live"
        );
        // Ramp converges to the mapped target.
        for _ in 0..64 {
            let _ = a.process(128);
        }
        let cut = a.voices[0]
            .voice
            .params
            .get("node#cut")
            .unwrap()
            .value
            .get();
        assert!((cut - 1.0).abs() < 1e-3, "smoother never converged: {cut}");
        let out_a = a.process(4096);
        let out_b = b.process(4096);
        let diff: f64 = out_a
            .iter()
            .zip(&out_b)
            .map(|(x, y)| ((x - y) as f64).abs())
            .sum();
        assert!(diff > 1e-3, "cutoff change was inaudible (diff {diff})");
        let energy: f64 = out_a.iter().map(|s| (*s as f64).powi(2)).sum();
        assert!(energy > 1e-8, "voice died on param change");
    }

    /// Patch swap: output fades (no hard discontinuity), the swap completes
    /// with an event, and held notes are re-pressed on the new patch.
    #[test]
    fn patch_swap_is_gapless_for_held_notes() {
        let mut rng = StdRng::seed_from_u64(0x5A5A);
        let mut poly = LivePoly::new(&tree_json(&mut rng), 44_100.0, 4).unwrap();
        poly.note_on(57, 1.0);
        for _ in 0..20 {
            let _ = poly.process(128);
        }
        assert!(poly.set_patch(&tree_json(&mut rng)));
        assert!(!poly.set_patch("not json"));

        // Drive through the whole transition, collecting the peak of every
        // quantum. Click-freeness = the quanta bordering the silent rebuild
        // gap are faded to (near) zero — the waveform never truncates hard.
        let mut quanta: Vec<(f32, f32, f32)> = Vec::new(); // (peak, first, last)
        let mut patched = false;
        for _ in 0..200 {
            let out = poly.process(128);
            assert!(out.iter().all(|s| s.is_finite()));
            let peak = out.iter().fold(0.0f32, |m, s| m.max(s.abs()));
            quanta.push((peak, out[0].abs(), out[out.len() - 2].abs()));
            if poly.poll_event() == EVENT_PATCHED {
                patched = true;
            }
        }
        assert!(patched, "swap never completed");
        let silent: Vec<usize> = (0..quanta.len()).filter(|&i| quanta[i].0 == 0.0).collect();
        assert!(!silent.is_empty(), "no silent rebuild gap observed");
        let (first, last) = (silent[0], *silent.last().unwrap());
        if first > 0 {
            // The final sample before the gap must have been faded to ~0.
            assert!(
                quanta[first - 1].2 < 0.02,
                "hard cut into silence: boundary sample {}",
                quanta[first - 1].2
            );
        }
        if last + 1 < quanta.len() {
            // The first sample after the gap starts from ~0 (fade-in).
            assert!(
                quanta[last + 1].1 < 0.02,
                "hard jump out of silence: boundary sample {}",
                quanta[last + 1].1
            );
        }
        // The held note survived onto the new patch.
        assert!(
            poly.voices.iter().any(|v| v.note == Some(57)),
            "held note lost across patch swap"
        );
    }

    /// A pad: slow attack (≈100 ms), full sustain, so the envelope's position
    /// is legible in the output level and a restart is unmissable.
    fn pad_json() -> String {
        use auracle_grammar::term::{AmpEnv, Waveform};
        use auracle_grammar::{AudioNode, ModNode, PatchTree};
        serde_json::to_string(&PatchTree {
            amp: AmpEnv {
                attack: 0.5,
                decay: 0.3,
                sustain: 1.0,
                release: 0.4,
            },
            root: AudioNode::Vco {
                uid: Uid::NEW,
                wave: Waveform::Saw,
                octave: 0,
                detune: 0.5,
                mod_depth: 0.0,
                modulation: ModNode::None,
            },
        })
        .unwrap()
    }

    /// A tempo change changes speed, not position. Two minutes in at 120
    /// BPM, a nudge to 121 used to throw every synced sequencer four 16ths
    /// forward (position was elapsed samples × the current rate); integrated
    /// beats move on by exactly one block's worth.
    #[test]
    fn a_tempo_change_does_not_jump_the_sequencers() {
        let (_, tree) = auracle_grammar::presets()
            .into_iter()
            .find(|(n, _)| *n == "Loom")
            .expect("Loom exists");
        let json = serde_json::to_string(&tree).unwrap();
        let mut p = LivePoly::new(&json, 48_000.0, 2).expect("compiles");
        p.set_arp(false, 0, 4.0, 120.0, 0.5, 1, 0.0);
        p.set_sync(true);
        p.note_on(60, 0.8);
        let slot = p.sync_lanes[0].sync_slot;
        let pos = |p: &LivePoly| p.param_slots[slot].values[0].get();
        for _ in 0..(120 * 48_000 / 128) {
            p.process(128);
        }
        // Each nudge is one block of travel at most, and never backwards —
        // including 140, where the snapped division itself changes.
        for bpm in [121.0, 126.0, 140.0] {
            let before = pos(&p);
            p.set_arp(false, 0, 4.0, bpm, 0.5, 1, 0.0);
            p.process(128);
            let after = pos(&p);
            assert!(
                (0.0..0.2).contains(&(after - before)),
                "{bpm} BPM moved the sequencer {before:.2} -> {after:.2}"
            );
        }
    }

    /// The arp keeps time: over a minute at 120 BPM in 16ths it fires 480
    /// steps, not the ~470 it did when each step dropped its overshoot past
    /// the block boundary.
    #[test]
    fn the_arp_does_not_drift() {
        let json = serde_json::to_string(&auracle_grammar::presets()[0].1).unwrap();
        let mut p = LivePoly::new(&json, 44_100.0, 2).expect("compiles");
        p.set_arp(true, 0, 4.0, 120.0, 0.5, 1, 0.0);
        p.note_on(60, 0.8);
        let blocks = 60 * 44_100 / 128;
        for _ in 0..blocks {
            p.process(128);
        }
        let steps = p.arp_step as i64;
        assert!(
            (steps - 480).abs() <= 1,
            "arp fired {steps} steps in 60 s, want 480"
        );
    }

    /// Tempo sync snaps a sequencer to the musical division nearest its own
    /// rate: 3.7 steps/s at 120 BPM (2 beats/s) is 16ths, 4 steps/s.
    #[test]
    fn sync_snaps_to_the_nearest_division() {
        use auracle_grammar::steps::{rate_hz, rate_site};
        let x = snap_rate(rate_site(3.7), 120.0);
        assert!((rate_hz(x) - 4.0).abs() < 1e-9, "{}", rate_hz(x));
        // A slow patch goes to a slow division, not the nearest fast one.
        let x = snap_rate(rate_site(0.9), 120.0);
        assert!((rate_hz(x) - 1.0).abs() < 1e-9, "{}", rate_hz(x));
        // Tempo changes move the division with it: at 90 BPM, 3.7 steps/s
        // is nearer triplet 8ths (4.5) than straight 8ths (3), in octaves.
        let x = snap_rate(rate_site(3.7), 90.0);
        assert!((rate_hz(x) - 4.5).abs() < 1e-9, "{}", rate_hz(x));
    }

    /// With sync on, every voice's sequencer reads one transport, the first
    /// key down restarts it, a gesture on the rate knob stays on the grid,
    /// and sync off returns every sequencer to free-running at its own rate.
    #[test]
    fn sync_drives_every_voice_from_one_transport() {
        use auracle_grammar::steps::{rate_hz, SYNC_FREE};
        let (_, tree) = auracle_grammar::presets()
            .into_iter()
            .find(|(n, _)| *n == "Loom")
            .expect("Loom exists");
        let json = serde_json::to_string(&tree).unwrap();
        let mut p = LivePoly::new(&json, 44_100.0, 4).expect("compiles");
        assert_eq!(p.sync_lanes.len(), 1, "Loom has one sequencer");
        let lane = (p.sync_lanes[0].sync_slot, p.sync_lanes[0].rate_slot);
        let free = p.sync_lanes[0].free;
        p.set_arp(false, 0, 2.0, 120.0, 0.5, 1, 0.0);
        p.set_sync(true);
        p.process(128);
        p.note_on(60, 0.8);
        p.process(128);
        let at = |p: &LivePoly| -> Vec<f64> {
            p.param_slots[lane.0]
                .values
                .iter()
                .map(|v| v.get())
                .collect()
        };
        let first = at(&p);
        assert!(
            first.iter().all(|v| *v == first[0]),
            "voices disagree: {first:?}"
        );
        assert_eq!(first[0], 0.0, "the first key down restarts the transport");
        for _ in 0..100 {
            p.process(128);
        }
        let later = at(&p);
        let hz = rate_hz(snap_rate(free, 120.0));
        let want = 100.0 * 128.0 * hz / 44_100.0;
        assert!(
            later.iter().all(|v| (v - want).abs() < 1e-9),
            "{later:?} vs {want}"
        );
        // A drag of the rate knob moves the division, not off the grid.
        let rate_addr = p.param_slots[lane.1].addr.clone();
        assert!(p.set_param(&rate_addr, 0.93));
        let r = rate_hz(p.param_slots[lane.1].values[0].get());
        let beat = 2.0;
        assert!(
            SYNC_DIVISIONS.iter().any(|d| (r - beat * d).abs() < 1e-9),
            "{r} is off the grid"
        );
        p.set_sync(false);
        assert!(
            at(&p).iter().all(|v| *v == SYNC_FREE),
            "sync off must free-run"
        );
        assert!(
            (p.param_slots[lane.1].values[0].get() - 0.93).abs() < 1e-12,
            "free rate restored"
        );
    }

    /// **Touch.** Velocity reaches timbre, per voice: two notes of one chord
    /// at different velocities leave their own voices' wired knob at
    /// different values, in the direction asked, and a mezzo note leaves it
    /// exactly where the knob is.
    #[test]
    fn velocity_touch_offsets_its_own_voice_only() {
        use auracle_grammar::term::{AmpEnv, FilterKind, Waveform};
        use auracle_grammar::{AudioNode, ModNode, PatchTree};
        let json = serde_json::to_string(&PatchTree {
            amp: AmpEnv {
                attack: 0.01,
                decay: 0.3,
                sustain: 0.8,
                release: 0.3,
            },
            root: AudioNode::Filter {
                uid: Uid::NEW,
                kind: FilterKind::Ladder,
                cutoff: 0.5,
                resonance: 0.3,
                mod_depth: 0.0,
                input: Box::new(AudioNode::Vco {
                    uid: Uid::NEW,
                    wave: Waveform::Saw,
                    octave: 0,
                    detune: 0.5,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                }),
                modulation: ModNode::None,
            },
        })
        .unwrap();
        let mut poly = LivePoly::new(&json, 44_100.0, 4).unwrap();
        assert!(poly.set_touch(r#"[["node#cut", 0.3, 0.5]]"#, 1.0));
        let cut = |poly: &LivePoly, note: u8| {
            let v = poly
                .voices
                .iter()
                .find(|v| v.note == Some(note))
                .expect("voice");
            v.voice.params.get("node#cut").unwrap().value.get()
        };
        poly.note_on(60, 1.0);
        poly.note_on(64, 0.2);
        poly.note_on(67, TOUCH_MEZZO);
        let (loud, soft, mezzo) = (cut(&poly, 60), cut(&poly, 64), cut(&poly, 67));
        assert!(
            loud > mezzo && mezzo > soft,
            "loud {loud} mezzo {mezzo} soft {soft}"
        );
        let home = poly.voices[0]
            .voice
            .params
            .get("node#cut")
            .unwrap()
            .map
            .apply(0.5);
        // Relative: velocity crosses an f32 on the way in (0.6 is not exact
        // there), and the cutoff map is exponential, so the leftover is a few
        // parts per million of the value rather than zero.
        assert!(
            (mezzo - home).abs() < 1e-5 * home.abs(),
            "mezzo moved the knob"
        );
        // Off is off: no offsets on the next note.
        assert!(poly.set_touch("[]", 1.0));
        poly.note_on(72, 1.0);
        assert!((cut(&poly, 72) - home).abs() < 1e-9);
        // Bad input turns touch off rather than half-applying it.
        assert!(!poly.set_touch("not json", 1.0));
        assert!(poly.touch.is_empty());
    }

    /// **The envelope carry.** Swapping the patch under a held pad used to
    /// re-press every held note on the new voices, which restarts their ADSRs
    /// from zero — so every structural edit made the pad swell in again from
    /// nothing, and the edit was audible as an event of its own rather than as
    /// a change to the sound.
    ///
    /// The patch swapped in here is the *same* tree, so the only thing that can
    /// move the level is the envelope. 23 ms of silence across the rebuild is
    /// expected and accepted (R3); coming back at a fraction of the level is
    /// not.
    #[test]
    fn a_held_pad_keeps_its_envelope_across_a_patch_swap() {
        let json = pad_json();
        let mut poly = LivePoly::new(&json, 44_100.0, 4).unwrap();
        poly.note_on(60, 1.0);
        // ~1.2 s: past a 100 ms attack and its decay, sitting on sustain. The
        // level is measured over 16 quanta, not one — a saw at 262 Hz does not
        // fit a whole number of periods into 128 frames, so a single quantum's
        // energy swings ±40% for reasons that have nothing to do with an
        // envelope.
        let mut warm: Vec<f64> = Vec::new();
        for _ in 0..400 {
            warm.push(energy(&poly.process(128)));
        }
        let mean = |w: &[f64]| w.iter().sum::<f64>() / w.len() as f64;
        let before = mean(&warm[384..]);
        assert!(before > 1.0e-4, "the pad never spoke: {before}");

        assert!(poly.set_patch(&json));
        let mut after: Vec<f64> = Vec::new();
        let mut patched_at = None;
        for i in 0..200 {
            let e = energy(&poly.process(128));
            after.push(e);
            if poly.poll_event() == EVENT_PATCHED && patched_at.is_none() {
                patched_at = Some(i);
            }
        }
        let at: usize = patched_at.expect("swap never completed");
        // Four quanta past the swap the ~6 ms fade-in is over. Without the
        // carry the envelope is ~12 ms into a 100 ms exponential attack —
        // about a tenth of the level it left with, climbing.
        let resumed = mean(&after[at + 4..at + 20]);
        assert!(
            resumed > before * 0.85,
            "the pad re-attacked: {resumed:.3e} against {before:.3e} before the \
             swap ({:.1}% of it)",
            100.0 * resumed / before
        );
        // …and it does not overshoot either, which is what parking a
        // mid-envelope note on the sustain shelf would look like from here.
        assert!(
            mean(&after[at + 4..at + 20]) < before * 1.15,
            "the level jumped after the swap: {resumed:.3e} against {before:.3e}"
        );
    }

    /// Below sustain the envelope is unambiguously still in Attack, and the
    /// seeder has to leave it there rather than parking it on the sustain
    /// shelf: a note swapped 30 ms into a 1 s attack must keep rising.
    #[test]
    fn a_mid_attack_note_resumes_its_attack_rather_than_jumping_to_sustain() {
        use auracle_grammar::term::{AmpEnv, Waveform};
        use auracle_grammar::{AudioNode, ModNode, PatchTree};
        let json = serde_json::to_string(&PatchTree {
            amp: AmpEnv {
                attack: 0.75, // ≈1 s
                decay: 0.3,
                sustain: 1.0,
                release: 0.4,
            },
            root: AudioNode::Vco {
                uid: Uid::NEW,
                wave: Waveform::Saw,
                octave: 0,
                detune: 0.5,
                mod_depth: 0.0,
                modulation: ModNode::None,
            },
        })
        .unwrap();
        let mut poly = LivePoly::new(&json, 44_100.0, 4).unwrap();
        poly.note_on(60, 1.0);
        let mut before = 0.0;
        for _ in 0..20 {
            before = energy(&poly.process(128));
        }
        let phase_before = poly.voices[0].voice.env_phase();
        assert!(
            phase_before > 0.01 && phase_before < 0.3,
            "the probe note is not mid-attack: {phase_before}"
        );

        assert!(poly.set_patch(&json));
        let mut patched = false;
        for _ in 0..60 {
            let _ = poly.process(128);
            patched |= poly.poll_event() == EVENT_PATCHED;
        }
        assert!(patched, "swap never completed");
        let phase_after = poly.voices[0].voice.env_phase();
        assert!(
            phase_after > phase_before * 0.8 && phase_after < 0.5,
            "a mid-attack note came back at {phase_after} from {phase_before} — \
             either restarted or parked on the sustain shelf"
        );
        // It is still climbing, which is the half a level check cannot see.
        for _ in 0..60 {
            let _ = poly.process(128);
        }
        assert!(
            poly.voices[0].voice.env_phase() > phase_after * 1.2,
            "the envelope stopped rising after the swap"
        );
        let _ = before;
    }

    /// The two categorical sites that went live are reachable through the live
    /// path at their *own* domain — an index, not a 0..1 knob — and neither
    /// forces a recompile.
    #[test]
    fn table_and_oct_are_live_at_index_scale() {
        use auracle_grammar::term::{AmpEnv, TableShape, Waveform};
        use auracle_grammar::{AudioNode, ModNode, PatchTree};
        let tree = |root| PatchTree {
            amp: AmpEnv {
                attack: 0.1,
                decay: 0.3,
                sustain: 1.0,
                release: 0.3,
            },
            root,
        };
        let wt = serde_json::to_string(&tree(AudioNode::Wavetable {
            uid: Uid::NEW,
            table: TableShape::Sine,
            octave: 0,
            morph: 0.0,
            mod_depth: 0.0,
            modulation: ModNode::None,
        }))
        .unwrap();
        let mut poly = LivePoly::new(&wt, 44_100.0, 1).unwrap();
        poly.note_on(60, 1.0);
        for _ in 0..40 {
            let _ = poly.process(128);
        }
        // Table 7 is the last of eight; the old blanket clamp to 0..1 would
        // have written table 1.
        assert!(poly.set_param("node#table", 7.0), "`table` has no handle");
        for _ in 0..40 {
            let _ = poly.process(128);
        }
        let cv = poly.voices[0].voice.params["node#table"].value.get();
        assert!(
            (cv - 1.0).abs() < 1.0e-3,
            "table 7 should land on cv 1.0, not {cv}"
        );

        let vco = serde_json::to_string(&tree(AudioNode::Vco {
            uid: Uid::NEW,
            wave: Waveform::Saw,
            octave: 0,
            detune: 0.5,
            mod_depth: 0.0,
            modulation: ModNode::None,
        }))
        .unwrap();
        let mut poly = LivePoly::new(&vco, 44_100.0, 1).unwrap();
        poly.note_on(60, 1.0);
        for _ in 0..40 {
            let _ = poly.process(128);
        }
        // Index 4 is +2 octaves; the compiled octave is 0, so the trim is +2.
        assert!(poly.set_param("node#oct", 4.0), "`oct` has no handle");
        for _ in 0..60 {
            let _ = poly.process(128);
        }
        let cv = poly.voices[0].voice.params["node#oct"].value.get();
        assert!(
            (cv - 2.0).abs() < 1.0e-3,
            "oct +2 should land on a 2 V trim, not {cv}"
        );
        // No recompile was queued: the swap machinery never woke up.
        assert!(
            matches!(poly.stage, Stage::Run),
            "a live index write started a patch swap"
        );
    }

    /// The arpeggiator steps through a held chord on its own clock, and
    /// velocity scales output level.
    #[test]
    fn arp_steps_and_velocity_scales() {
        let (_, tree) = auracle_grammar::presets()
            .into_iter()
            .find(|(n, _)| *n == "First Bass")
            .expect("preset exists");
        let json = serde_json::to_string(&tree).unwrap();

        // Velocity: same note, soft vs hard, soft must be quieter.
        let energy_at = |vel: f64| {
            let mut p = LivePoly::new(&json, 44_100.0, 1).unwrap();
            p.note_on(60, vel);
            (0..20)
                .flat_map(|_| p.process(512))
                .map(|s| (s as f64) * (s as f64))
                .sum::<f64>()
        };
        let (soft, hard) = (energy_at(0.15), energy_at(1.0));
        assert!(
            soft < hard * 0.5,
            "velocity had no effect: soft {soft}, hard {hard}"
        );

        // Arp: hold a triad with the arp on; distinct pitches must be
        // pressed over time, and turning it off restores the chord.
        let mut p = LivePoly::new(&json, 44_100.0, 4).unwrap();
        p.set_arp(true, 0, 4.0, 240.0, 0.5, 1, 0.0); // 16ths at 240 BPM ≈ 16 steps/s
        p.note_on(48, 1.0);
        p.note_on(52, 1.0);
        p.note_on(55, 1.0);
        let mut seen = std::collections::HashSet::new();
        for _ in 0..400 {
            let out = p.process(128);
            assert!(out.iter().all(|s| s.is_finite()));
            for v in &p.voices {
                if let Some(n) = v.note {
                    seen.insert(n);
                }
            }
        }
        assert!(
            seen.len() >= 3,
            "arp never cycled the chord: pressed {seen:?}"
        );
        // At any instant the arp holds at most one gated note.
        let gated = p.voices.iter().filter(|v| v.note.is_some()).count();
        assert!(gated <= 1, "arp gated {gated} notes at once");
        p.set_arp(false, 0, 4.0, 240.0, 0.5, 1, 0.0);
        let gated: Vec<_> = p.voices.iter().filter_map(|v| v.note).collect();
        assert_eq!(gated.len(), 3, "chord not re-pressed after arp off");
    }

    /// The master bus holds a full chord inside full scale. Four voices sum to
    /// ~4× one voice, and before the master limiter existed a four-note chord
    /// sat exactly on the rail — hard-clipped, and clipped again by the device
    /// conversion because the old ceiling was above 1.0.
    #[test]
    fn chord_never_exceeds_full_scale() {
        let mut rng = StdRng::seed_from_u64(0xC401);
        for i in 0..8 {
            let json = tree_json(&mut rng);
            let mut poly = LivePoly::new(&json, 44_100.0, 4).unwrap();
            for n in [48, 55, 60, 64] {
                poly.note_on(n, 1.0);
            }
            let mut hottest = 0.0f32;
            for _ in 0..60 {
                let out = poly.process(512);
                assert!(out.iter().all(|s| s.is_finite()), "patch {i}: non-finite");
                hottest = hottest.max(peak(&out));
            }
            assert!(
                hottest <= 1.0,
                "patch {i}: four-note chord peaked at {hottest}"
            );
            // And it is limited, not clipped: the brickwall lands on the
            // ceiling, so nothing should be sitting above it.
            assert!(
                hottest <= MASTER_CEILING + 1e-6,
                "patch {i}: output ran past the ceiling into the clamp ({hottest})"
            );
        }
    }

    /// A stolen voice retriggers its amp envelope. On a percussive patch the
    /// voice is silent at sustain 0 by the time it is stolen, so the fifth note
    /// on a four-voice instrument is *only* audible if the ADSR sees a real
    /// falling-then-rising gate edge.
    #[test]
    fn stolen_voice_retriggers_its_envelope() {
        let json = plucked_json();
        let mut poly = LivePoly::new(&json, 44_100.0, 1).unwrap();
        poly.note_on(60, 1.0);
        // Run past the decay: the note has fallen to sustain 0 and is silent
        // even though its gate is still high.
        for _ in 0..40 {
            let _ = poly.process(512);
        }
        let decayed = energy(&poly.process(4096));
        // Steal the (still-held) voice with a new note.
        poly.note_on(67, 1.0);
        let after_steal = energy(&poly.process(4096));
        assert!(
            after_steal > decayed * 100.0 && after_steal > 1e-4,
            "stolen voice did not retrigger: {decayed:.3e} decayed vs \
             {after_steal:.3e} after the steal"
        );
    }

    /// The arp's new controls each do their documented thing: a short gate
    /// shortens the note without moving the step clock, an octave range reaches
    /// pitches nobody is holding, and swing makes consecutive steps unequal.
    #[test]
    fn arp_gate_octaves_and_swing() {
        let json = plucked_json();
        // Octave range: hold one key, span three octaves, collect the pitches
        // the scheduler actually presses.
        let mut p = LivePoly::new(&json, 44_100.0, 4).unwrap();
        p.set_arp(true, 0, 4.0, 240.0, 0.5, 3, 0.0);
        p.note_on(48, 1.0);
        let mut seen = std::collections::HashSet::new();
        for _ in 0..400 {
            let _ = p.process(128);
            if let Some(n) = p.arp_note {
                seen.insert(n);
            }
        }
        assert_eq!(
            seen,
            [48u8, 60, 72].into_iter().collect(),
            "octave range did not transpose the pattern: {seen:?}"
        );

        // Gate length: staccato must sound for a smaller share of the step than
        // legato, with the step clock itself unchanged.
        let sounding_frac = |gate: f64| {
            let mut p = LivePoly::new(&json, 44_100.0, 4).unwrap();
            p.set_arp(true, 0, 2.0, 120.0, gate, 1, 0.0);
            p.note_on(48, 1.0);
            p.note_on(52, 1.0);
            let (mut on, mut total) = (0, 0);
            for _ in 0..600 {
                let _ = p.process(128);
                total += 1;
                if p.arp_note.is_some() {
                    on += 1;
                }
            }
            on as f64 / total as f64
        };
        let (staccato, legato) = (sounding_frac(0.1), sounding_frac(0.9));
        assert!(
            staccato < legato * 0.5,
            "gate length had no effect: {staccato:.2} staccato vs {legato:.2} legato"
        );

        // Swing: measure the sample distance between consecutive note-ons.
        let step_gaps = |swing: f64| {
            let mut p = LivePoly::new(&json, 44_100.0, 4).unwrap();
            p.set_arp(true, 0, 4.0, 120.0, 0.5, 1, swing);
            p.note_on(48, 1.0);
            p.note_on(52, 1.0);
            let mut starts: Vec<usize> = Vec::new();
            let mut prev = None;
            for q in 0..1200 {
                let _ = p.process(128);
                if p.arp_note.is_some() && prev.is_none() {
                    starts.push(q * 128);
                }
                prev = p.arp_note;
            }
            starts.windows(2).map(|w| w[1] - w[0]).collect::<Vec<_>>()
        };
        let straight = step_gaps(0.0);
        let swung = step_gaps(0.6);
        let spread = |g: &[usize]| {
            let (lo, hi) = (g.iter().min().copied(), g.iter().max().copied());
            hi.unwrap_or(0) as i64 - lo.unwrap_or(0) as i64
        };
        assert!(straight.len() > 3 && swung.len() > 3, "arp never stepped");
        assert!(
            spread(&swung) > spread(&straight) + 2000,
            "swing did not stagger the steps: straight {straight:?}, swung {swung:?}"
        );
    }

    /// Unison detune reaches supersaw width (±60 cents at full travel) and
    /// spreads the voices non-uniformly.
    #[test]
    fn unison_detune_is_wide_and_non_uniform() {
        let json = plucked_json();
        let mut p = LivePoly::new(&json, 44_100.0, 4).unwrap();
        p.set_unison(true, 1.0, 0.5);
        p.note_on(60, 1.0);
        let mut cents: Vec<f64> = p.voices.iter().map(|v| v.pitch_tgt * 1200.0).collect();
        cents.sort_by(|a, b| a.partial_cmp(b).unwrap());
        assert!(
            (cents[0] + 60.0).abs() < 1.0 && (cents[3] - 60.0).abs() < 1.0,
            "unison spread is not ±60 cents: {cents:?}"
        );
        // Non-uniform: the inner pair sits far closer to centre than an even
        // split across four voices (±20 c) would put it.
        assert!(
            cents[1].abs() < 15.0,
            "detune curve is still linear: {cents:?}"
        );
    }

    /// Chaos: random notes, knob writes (real and junk addresses), and
    /// patch swaps — output must stay finite forever, no panics.
    #[test]
    fn live_stress_survives_chaos() {
        let mut rng = StdRng::seed_from_u64(0xC405);
        let mut poly = LivePoly::new(&tree_json(&mut rng), 44_100.0, 4).unwrap();
        let sites = [
            "node#cut",
            "node#res",
            "node#fb",
            "node#time",
            "amp#attack",
            "amp#sustain",
            "node/0#cut",
            "node/0/1#bal",
            "bogus#x",
            "",
        ];
        for i in 0..600 {
            match rng.gen_range(0..10) {
                0 | 1 => poly.note_on(rng.gen_range(36..85), rng.gen_range(0.0..1.2)),
                6 => poly.set_bend(rng.gen_range(-30.0..30.0)),
                7 if i % 11 == 0 => poly.set_arp(
                    rng.gen_bool(0.5),
                    rng.gen_range(0..5),
                    rng.gen_range(0.25..9.0),
                    rng.gen_range(20.0..400.0),
                    rng.gen_range(-0.5..1.5),
                    rng.gen_range(0..7),
                    rng.gen_range(-0.5..1.5),
                ),
                8 if i % 13 == 0 => {
                    poly.set_unison(rng.gen_bool(0.5), rng.gen(), rng.gen());
                    poly.set_glide(rng.gen_range(-0.5..1.5));
                    poly.set_makeup(rng.gen_range(0.0..10.0));
                }
                2 => poly.note_off(rng.gen_range(36..85)),
                3 => {
                    let _ = poly.set_param(
                        sites[rng.gen_range(0..sites.len())],
                        rng.gen_range(-1.0..2.0),
                    );
                }
                4 if i % 37 == 0 => {
                    let _ = poly.set_patch(&tree_json(&mut rng));
                }
                5 if i % 97 == 0 => poly.all_off(),
                _ => {}
            }
            let out = poly.process(128);
            assert!(
                out.iter().all(|s| s.is_finite() && s.abs() <= 1.5),
                "iteration {i}: bad sample"
            );
            let _ = poly.poll_event();
        }
    }

    /// Glide has to be audible on the thing portamento is *for*: a melody.
    /// Voice assignment prefers a free voice, so a line rotates through voices
    /// that were never sounding — with per-voice-only portamento every note of
    /// a tune started dead on pitch and the fader did nothing you could hear.
    #[test]
    fn glide_slides_a_line_but_not_a_chord() {
        let json = plucked_json();

        // A line: press, release, press. The second note starts an octave
        // below its target and slides up.
        let mut p = LivePoly::new(&json, 44_100.0, 4).unwrap();
        p.set_glide(0.5);
        p.note_on(60, 1.0);
        let _ = p.process(256);
        p.note_off(60);
        let _ = p.process(256);
        p.note_on(72, 1.0);
        let v = p.voices.iter().find(|v| v.note == Some(72)).unwrap();
        assert!(
            (v.pitch_tgt - 1.0).abs() < 1.0e-9,
            "second note should target C6: {}",
            v.pitch_tgt
        );
        assert!(
            v.pitch_cur < 0.1,
            "second note of a line must start back at the first note, not on \
             pitch (pitch_cur={})",
            v.pitch_cur
        );

        // ...and it actually arrives.
        let _ = p.process(44_100 * 4);
        let v = p.voices.iter().find(|v| v.note == Some(72)).unwrap();
        assert!(
            (v.pitch_cur - 1.0).abs() < 1.0e-3,
            "glide never reached its target: {}",
            v.pitch_cur
        );

        // A chord: the second note is pressed while the first is still held,
        // so it speaks on pitch. Portamento must not scramble a chord.
        let mut q = LivePoly::new(&json, 44_100.0, 4).unwrap();
        q.set_glide(0.5);
        q.note_on(60, 1.0);
        let _ = q.process(64);
        q.note_on(64, 1.0);
        let v = q.voices.iter().find(|v| v.note == Some(64)).unwrap();
        assert!(
            (v.pitch_cur - v.pitch_tgt).abs() < 1.0e-9,
            "a chord tone must start on pitch: cur={} tgt={}",
            v.pitch_cur,
            v.pitch_tgt
        );

        // The very first note of the session has nothing to glide from.
        let mut r = LivePoly::new(&json, 44_100.0, 4).unwrap();
        r.set_glide(1.0);
        r.note_on(48, 1.0);
        let v = r.voices.iter().find(|v| v.note == Some(48)).unwrap();
        assert!(
            (v.pitch_cur - v.pitch_tgt).abs() < 1.0e-9,
            "the first note ever played swooped in from C4: {}",
            v.pitch_cur
        );

        // Glide off: nothing slides, however the line is played.
        let mut o = LivePoly::new(&json, 44_100.0, 4).unwrap();
        o.note_on(60, 1.0);
        let _ = o.process(256);
        o.note_off(60);
        let _ = o.process(256);
        o.note_on(72, 1.0);
        let v = o.voices.iter().find(|v| v.note == Some(72)).unwrap();
        assert!(
            (v.pitch_cur - v.pitch_tgt).abs() < 1.0e-9,
            "glide is off; this must start on pitch: {}",
            v.pitch_cur
        );
    }

    /// The meter reads a real level off a real interior port, and reads the
    /// mixer's two branches *apart* when the balance is hard over.
    ///
    /// The second half is what makes this a measurement rather than a smoke
    /// test. A crossfader at balance 0 passes branch `a` and mutes branch `b`
    /// downstream — but both sources are still oscillating, so a meter reading
    /// each module's own output must show both alive. What must differ is the
    /// *mix* against its quiet branch. Estimating levels from the term (what
    /// the rack did before this) gets that right by construction; the point
    /// here is that measuring gets it right too, from the audio.
    #[test]
    fn meter_reads_levels_off_interior_ports() {
        use auracle_grammar::term::{AmpEnv, Waveform};
        use auracle_grammar::{AudioNode, ModNode, PatchTree};

        let json = serde_json::to_string(&PatchTree {
            amp: AmpEnv {
                attack: 0.1,
                decay: 0.3,
                sustain: 1.0,
                release: 0.3,
            },
            root: AudioNode::Mix {
                uid: Uid::NEW,
                balance: 0.0, // hard over to `a`
                a: Box::new(AudioNode::Vco {
                    uid: Uid::NEW,
                    wave: Waveform::Saw,
                    octave: 0,
                    detune: 0.5,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                }),
                b: Box::new(AudioNode::Vco {
                    uid: Uid::NEW,
                    wave: Waveform::Saw,
                    octave: 0,
                    detune: 0.5,
                    mod_depth: 0.0,
                    modulation: ModNode::None,
                }),
            },
        })
        .unwrap();

        let mut poly = LivePoly::new(&json, 44_100.0, 4).expect("compiles");
        assert_eq!(poly.meter_len(), 0, "metering must be off until asked for");

        let n = poly.set_meter(true);
        assert_eq!(n, 3, "one tap per term node: the mix and its two sources");
        let keys: Vec<String> = serde_json::from_str(&poly.meter_keys()).unwrap();
        assert_eq!(keys, vec!["node", "node/0", "node/1"]);

        poly.note_on(60, 1.0);
        // Long enough for the 128-sample level buffers to fill several times.
        for _ in 0..16 {
            let _ = poly.process(512);
        }

        let db = poly.meter.levels.clone();
        assert!(db.iter().all(|d| d.is_finite()), "levels went non-finite");
        for (k, d) in keys.iter().zip(&db) {
            assert!(*d > -120.0, "tap `{k}` never read a level ({d} dB)");
        }

        // Both oscillators are running, whatever the crossfader does with them.
        let a = db[keys.iter().position(|k| k == "node/0").unwrap()];
        let b = db[keys.iter().position(|k| k == "node/1").unwrap()];
        assert!(a > -60.0 && b > -60.0, "a source read silent: {a}, {b} dB");

        // Off again clears the subscriptions and the buffer with them.
        assert_eq!(poly.set_meter(false), 0);
        assert_eq!(poly.meter_len(), 0);
    }
}
