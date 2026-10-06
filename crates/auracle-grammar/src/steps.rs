//! The timbral step sequencer behind [`ModNode::Steps`](crate::term::ModNode::Steps).
//!
//! # Why this is a module of our own and not quiver's `StepSequencer`
//!
//! quiver ships a step sequencer, and [`crate::term::ModNode`]'s own doc lists
//! it among the modules deliberately left out: its eight values are
//! `steps: [f64; 8]` **internal state with no ports**. A value there can only
//! be set by rebuilding the module, so every drag of a step would be a full
//! patch recompile — a fade-out, a voice rebuild and a fade-in per pointer
//! move — and the step values could never be the live, lockable, evolvable
//! trace addresses every other knob in this instrument is.
//!
//! [`StepsCv`] takes the other road: every control is an **input port**. The
//! compiler cables one live [`ParamHandle`](crate::ParamHandle) into each of
//! the eleven, so dragging a bar in the rack writes an atomic the audio thread
//! reads on the next sample, exactly like turning a cutoff knob.
//!
//! # The values are latent uniforms
//!
//! This is the Mutable Instruments *Marbles* design turned into a genome: each
//! step's value is its own `Uniform(0, 1)` trace site `u_i`, and the step's
//! output is `(2·u_i − 1)·5 V`. An MH proposal that touches one site moves one
//! step and nothing else, so evolution can re-voice a single note of the
//! pattern the way a hand does. `length` chooses how many of the eight play;
//! the rest stay in the genome, **latent**, so shortening the pattern and
//! lengthening it again gives back the steps it hid rather than inventing new
//! ones.
//!
//! # Free-running in the genome, tempo-synced in the hand
//!
//! In the term, and so in every audition, the clock is free-running: `rate`
//! is steps per second on the module's own phase accumulator, because the
//! audition phrase has no tempo in it. Locking to a tempo is a
//! live-instrument concern, and the live engine does it through the `sync`
//! port (see [`StepsCv`]): the rate knob is snapped to the nearest musical
//! division of the tempo, and every voice's clock follows one transport.

use quiver::port::{GraphModule, PortDef, PortId, PortSpec, PortValues, SignalKind};

/// How many step values the module holds. Also the number of `s0`..`s7`
/// trace sites a [`ModNode::Steps`](crate::term::ModNode::Steps) carries.
pub const STEP_SLOTS: usize = 8;

/// The shortest pattern `length` can choose. One step would be a constant —
/// an offset on the destination knob, not a modulator.
pub const MIN_STEPS: usize = 2;

/// Slowest step rate, in steps per second, at `rate = 0`.
const RATE_MIN_HZ: f64 = 0.5;
/// Octaves of rate the knob spans: `0.5·2^(5x)` runs 0.5 → 16 steps per
/// second. The bottom is two seconds a step, so even the slowest setting
/// changes value inside the audition phrase's 1.8 s held note; the top is a
/// sixteenth at 240 BPM, past which a step pattern on a timbre stops reading
/// as a rhythm and starts reading as an audio-rate buzz on the cutoff.
const RATE_OCTAVES: f64 = 5.0;
/// Full swing of one step, in volts: the output is bipolar ±5 V, the same
/// scale as an LFO, so the compiler's bipolar mod-depth tapers apply to it
/// unchanged.
const STEP_PEAK_V: f64 = 5.0;

/// Input port ids, in [`PortSpec`] order.
const PORT_RATE: PortId = 0;
const PORT_LENGTH: PortId = 1;
const PORT_SLEW: PortId = 2;
/// `s0` is port 3, `s7` port 10.
const PORT_S0: PortId = 3;
/// Transport position, in steps since the transport started, or negative for
/// "free-running". See [`StepsCv`]'s *Tempo sync*.
const PORT_SYNC: PortId = 11;
/// The one output.
const PORT_OUT: PortId = 20;
/// What `sync` reads when nothing drives it: free-running.
pub const SYNC_FREE: f64 = -1.0;

/// What an unpatched or non-finite value port reads as: the middle of the
/// knob, which is 0 V — a silent step rather than one pinned to a rail.
const VALUE_DEFAULT: f64 = 0.5;

/// Steps per second for a normalized `rate` site: `0.5·2^(5x)`, 0.5–16 Hz.
pub fn rate_hz(x: f64) -> f64 {
    RATE_MIN_HZ * (RATE_OCTAVES * unit(x, 0.0)).exp2()
}

/// The normalized `rate` site that plays `hz` steps per second: the inverse
/// of [`rate_hz`], clamped to the knob's range.
pub fn rate_site(hz: f64) -> f64 {
    if !(hz.is_finite() && hz > 0.0) {
        return 0.0;
    }
    ((hz / RATE_MIN_HZ).log2() / RATE_OCTAVES).clamp(0.0, 1.0)
}

/// Number of steps that play for a normalized `length` site: seven equal
/// bins of the knob onto `2..=8`.
pub fn step_count(x: f64) -> usize {
    let bins = STEP_SLOTS - MIN_STEPS + 1;
    MIN_STEPS + ((unit(x, 1.0) * bins as f64) as usize).min(bins - 1)
}

/// Output volts for a normalized step value: `(2u − 1)·5 V`.
pub fn step_volts(u: f64) -> f64 {
    (2.0 * unit(u, VALUE_DEFAULT) - 1.0) * STEP_PEAK_V
}

/// Clamp to `[0, 1]`, with anything non-finite read as `default`.
///
/// Every input goes through here. The ports are driven by the panel's
/// atomics, and quiver sums whatever reaches a port; a `NaN` that got as far
/// as the phase accumulator would latch the module silent for the rest of the
/// voice's life, so it is stopped at the door.
fn unit(x: f64, default: f64) -> f64 {
    if x.is_finite() {
        x.clamp(0.0, 1.0)
    } else {
        default
    }
}

/// An eight-slot CV step sequencer with glide, every control a port.
///
/// Ports: `rate`, `length`, `slew`, `s0`..`s7` in (all normalized 0–1, fed by
/// live knobs); `out` out, bipolar ±5 V.
///
/// # Slew is a fraction of the step, so it is sample-rate independent
///
/// `slew` is how much of each step the output spends gliding from where it
/// was to the new value: 0 is a hard step, 1 arrives just as the next step
/// begins. The glide is a function of the step's own **phase**, not of a
/// sample count or a time constant, so the trajectory at 44.1 kHz and at
/// 96 kHz is the same curve sampled more or less finely — and a glide that
/// is "half the step" stays half the step when `rate` moves.
///
/// # Tempo sync
///
/// `sync` carries a transport **position in steps** (the live engine writes
/// it at each block start when tempo sync is on). Whenever the value changes
/// the module re-seats itself on that position — step `⌊pos⌋ mod length`,
/// phase `pos − ⌊pos⌋` — and between changes it integrates `rate` as always,
/// so a block's worth of samples stays sample-accurate and every voice, woken
/// or not, lands on the same grid. A pattern whose length does not divide the
/// bar keeps its polymeter: the position counts steps, not bars. Negative
/// (the default) is free-running, exactly the module it was before sync.
///
/// # Real-time properties
///
/// `tick` allocates nothing, reads no clock and draws no randomness: the
/// output is a pure function of the port values and three numbers of state,
/// so two voices built from one patch produce the same samples.
#[derive(Debug, Clone)]
pub struct StepsCv {
    /// Position inside the current step, `[0, 1)`.
    phase: f64,
    /// Which step is playing, `0..length`.
    index: usize,
    /// Where the current step's glide starts from, in volts.
    from: f64,
    /// The last value written to `out`, in volts.
    last_out: f64,
    /// False until the first tick: the first step starts *on* its value
    /// rather than gliding up to it from 0 V.
    primed: bool,
    /// The last transport position `sync` carried, so a re-seat happens once
    /// per change and not every sample.
    sync_seen: f64,
    sample_rate: f64,
    spec: PortSpec,
}

impl StepsCv {
    /// A sequencer at `sample_rate`, parked on step 0.
    pub fn new(sample_rate: f64) -> Self {
        let mut inputs = vec![
            PortDef::new(PORT_RATE, "rate", SignalKind::CvUnipolar).with_default(0.5),
            PortDef::new(PORT_LENGTH, "length", SignalKind::CvUnipolar).with_default(1.0),
            PortDef::new(PORT_SLEW, "slew", SignalKind::CvUnipolar).with_default(0.0),
        ];
        for i in 0..STEP_SLOTS {
            inputs.push(
                PortDef::new(
                    PORT_S0 + i as PortId,
                    Self::value_port(i),
                    SignalKind::CvUnipolar,
                )
                .with_default(VALUE_DEFAULT),
            );
        }
        inputs.push(PortDef::new(PORT_SYNC, "sync", SignalKind::CvBipolar).with_default(SYNC_FREE));
        Self {
            phase: 0.0,
            index: 0,
            from: 0.0,
            last_out: 0.0,
            primed: false,
            sync_seen: f64::NAN,
            sample_rate: sane_rate(sample_rate),
            spec: PortSpec {
                inputs,
                outputs: vec![PortDef::new(PORT_OUT, "out", SignalKind::CvBipolar)],
            },
        }
    }

    /// The input port name of step `i` (`s0`..`s7`) — the same spelling as
    /// its trace site, so the compiler can wire site to port by name.
    pub fn value_port(i: usize) -> &'static str {
        ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"][i]
    }

    fn value(&self, inputs: &PortValues, i: usize) -> f64 {
        step_volts(inputs.get_or(PORT_S0 + i as PortId, VALUE_DEFAULT))
    }
}

/// A usable sample rate, whatever the host said.
fn sane_rate(sr: f64) -> f64 {
    if sr.is_finite() && sr > 0.0 {
        sr
    } else {
        44_100.0
    }
}

impl GraphModule for StepsCv {
    fn port_spec(&self) -> &PortSpec {
        &self.spec
    }

    fn tick(&mut self, inputs: &PortValues, outputs: &mut PortValues) {
        let rate = rate_hz(inputs.get_or(PORT_RATE, 0.5));
        let len = step_count(inputs.get_or(PORT_LENGTH, 1.0));
        let slew = unit(inputs.get_or(PORT_SLEW, 0.0), 0.0);

        // A `length` turned down past the step that is playing: that step no
        // longer exists, so the pattern wraps now rather than finishing a step
        // the player just removed. The glide carries on from wherever the
        // output is, so the cut is as smooth as `slew` says it should be.
        if self.index >= len {
            self.index = 0;
            self.from = self.last_out;
        }
        // Tempo sync: re-seat on the transport when it moves. A position that
        // agrees with where the clock already is changes nothing audible.
        let sync = inputs.get_or(PORT_SYNC, SYNC_FREE);
        if sync.is_finite() && sync >= 0.0 && sync != self.sync_seen {
            self.sync_seen = sync;
            let idx = (sync.floor() as u64 % len as u64) as usize;
            if idx != self.index && self.primed {
                self.from = self.last_out;
            }
            self.index = idx;
            self.phase = sync - sync.floor();
        }
        let target = self.value(inputs, self.index);
        if !self.primed {
            self.from = target;
            self.primed = true;
        }
        // The target is read live every sample, so a knob turn on the step
        // that is playing lands immediately (through the glide, if any).
        let out = if slew > 0.0 && self.phase < slew {
            self.from + (target - self.from) * (self.phase / slew)
        } else {
            target
        };
        outputs.set(PORT_OUT, out);
        self.last_out = out;

        self.phase += rate / self.sample_rate;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
            // At 16 steps a second no sane host rate can skip a whole step,
            // but a phase that somehow is not below one after the wrap must
            // not stall the clock.
            if self.phase >= 1.0 || !self.phase.is_finite() {
                self.phase = 0.0;
            }
            self.index = (self.index + 1) % len;
            self.from = out;
        }
    }

    fn reset(&mut self) {
        self.phase = 0.0;
        self.index = 0;
        self.from = 0.0;
        self.last_out = 0.0;
        self.primed = false;
        self.sync_seen = f64::NAN;
    }

    fn set_sample_rate(&mut self, sample_rate: f64) {
        self.sample_rate = sane_rate(sample_rate);
    }

    fn type_id(&self) -> &'static str {
        "auracle_steps"
    }
}

#[cfg(test)]
mod tests;
