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
mod tests {
    use super::*;

    /// Drive the module directly with fixed port values for `seconds`.
    fn run(sr: f64, rate: f64, length: f64, slew: f64, values: [f64; 8], seconds: f64) -> Vec<f64> {
        let mut m = StepsCv::new(sr);
        let mut inp = PortValues::new();
        inp.set(PORT_RATE, rate);
        inp.set(PORT_LENGTH, length);
        inp.set(PORT_SLEW, slew);
        for (i, v) in values.iter().enumerate() {
            inp.set(PORT_S0 + i as PortId, *v);
        }
        let mut out = PortValues::new();
        (0..(sr * seconds) as usize)
            .map(|_| {
                m.tick(&inp, &mut out);
                out.get(PORT_OUT).expect("out is always written")
            })
            .collect()
    }

    const ALT: [f64; 8] = [0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0];

    #[test]
    fn the_maps_hit_their_documented_ends() {
        assert!((rate_hz(0.0) - 0.5).abs() < 1e-12);
        assert!((rate_hz(1.0) - 16.0).abs() < 1e-12);
        assert!((rate_hz(0.4) - 2.0).abs() < 1e-12);
        assert_eq!(step_count(0.0), 2);
        assert_eq!(step_count(1.0), 8);
        // Seven equal bins, every count reachable.
        let counts: std::collections::BTreeSet<_> =
            (0..=700).map(|i| step_count(i as f64 / 700.0)).collect();
        assert_eq!(
            counts.into_iter().collect::<Vec<_>>(),
            (2..=8).collect::<Vec<_>>()
        );
        assert_eq!(step_volts(0.0), -5.0);
        assert_eq!(step_volts(1.0), 5.0);
        assert_eq!(step_volts(0.5), 0.0);
    }

    /// Hard steps at 2 Hz, two of them: ±5 V alternating every half second,
    /// starting on `s0`.
    #[test]
    fn hard_steps_play_the_pattern_at_the_rate() {
        let sr = 48_000.0;
        let out = run(sr, 0.4, 0.0, 0.0, ALT, 2.0);
        for (k, want) in [(0usize, -5.0), (1, 5.0), (2, -5.0), (3, 5.0)] {
            let mid = (k as f64 + 0.5) * 0.5 * sr;
            assert_eq!(out[mid as usize], want, "step {k}");
        }
        // Exactly two values ever appear.
        assert!(out.iter().all(|v| *v == 5.0 || *v == -5.0));
    }

    /// Only the first `length` values play; the rest are latent.
    #[test]
    fn length_hides_the_tail_without_forgetting_it() {
        let mut vals = [0.5; 8];
        vals[5] = 1.0; // only reachable at length ≥ 6
        let short = run(48_000.0, 1.0, 0.0, 0.0, vals, 2.0);
        assert!(short.iter().all(|v| *v == 0.0), "a latent step played");
        let long = run(48_000.0, 1.0, 1.0, 0.0, vals, 2.0);
        assert!(long.contains(&5.0), "step 5 never played at length 8");
    }

    /// Slew is a fraction of the step, so the trajectory is the same curve at
    /// any sample rate, and a full slew never jumps.
    #[test]
    fn slew_is_sample_rate_independent_and_smooth() {
        let a = run(44_100.0, 0.4, 0.0, 0.5, ALT, 2.0);
        let b = run(96_000.0, 0.4, 0.0, 0.5, ALT, 2.0);
        for t in [0.1, 0.3, 0.55, 0.62, 0.9, 1.3, 1.77] {
            let (x, y) = (a[(t * 44_100.0) as usize], b[(t * 96_000.0) as usize]);
            assert!((x - y).abs() < 0.01, "t={t}: {x} at 44.1k vs {y} at 96k");
        }
        let full = run(48_000.0, 0.4, 0.0, 1.0, ALT, 2.0);
        let jump = full
            .windows(2)
            .map(|w| (w[1] - w[0]).abs())
            .fold(0.0, f64::max);
        // 10 V over a half-second glide is 0.0004 V a sample at 48 kHz.
        assert!(jump < 0.001, "a full slew still jumped {jump} V");
    }

    /// Garbage in is not garbage out: a non-finite port reads as its default
    /// and the clock keeps running.
    #[test]
    fn non_finite_inputs_cannot_latch_the_module() {
        let mut m = StepsCv::new(48_000.0);
        let mut inp = PortValues::new();
        for id in 0..11 {
            inp.set(id, f64::NAN);
        }
        let mut out = PortValues::new();
        for _ in 0..48_000 {
            m.tick(&inp, &mut out);
            assert!(out.get(PORT_OUT).unwrap().is_finite());
        }
        inp.set(PORT_RATE, f64::INFINITY);
        inp.set(PORT_S0, 1.0);
        for _ in 0..1000 {
            m.tick(&inp, &mut out);
            assert!(out.get(PORT_OUT).unwrap().is_finite());
        }
    }

    /// `reset` puts the module back exactly where `new` did.
    #[test]
    fn reset_replays_the_same_samples() {
        let mut m = StepsCv::new(48_000.0);
        let mut inp = PortValues::new();
        inp.set(PORT_RATE, 0.8);
        inp.set(PORT_LENGTH, 0.6);
        inp.set(PORT_SLEW, 0.3);
        for i in 0..8 {
            inp.set(PORT_S0 + i, i as f64 / 7.0);
        }
        let mut out = PortValues::new();
        let mut take = |m: &mut StepsCv| {
            (0..30_000)
                .map(|_| {
                    m.tick(&inp, &mut out);
                    out.get(PORT_OUT).unwrap()
                })
                .collect::<Vec<_>>()
        };
        let first = take(&mut m);
        m.reset();
        assert_eq!(take(&mut m), first);
    }

    /// Two sequencers with different histories — one started a third of a
    /// second earlier, like two voices struck at different times — play the
    /// same samples from the moment they are handed the same transport
    /// position, and keep agreeing while it advances. Unsynced they would
    /// not, and the free-running default is untouched.
    #[test]
    fn sync_puts_voices_on_one_grid() {
        let sr = 48_000.0;
        let mut inp = PortValues::new();
        inp.set(PORT_RATE, 0.5);
        inp.set(PORT_LENGTH, 0.7);
        inp.set(PORT_SLEW, 0.0);
        for i in 0..8 {
            inp.set(PORT_S0 + i, i as f64 / 7.0);
        }
        let (mut a, mut b) = (StepsCv::new(sr), StepsCv::new(sr));
        let mut out = PortValues::new();
        for _ in 0..16_000 {
            a.tick(&inp, &mut out);
        }
        let hz = rate_hz(0.5);
        let block = 128;
        let mut transport = 0usize;
        for _ in 0..200 {
            inp.set(PORT_SYNC, transport as f64 * hz / sr);
            for _ in 0..block {
                a.tick(&inp, &mut out);
                let va = out.get(PORT_OUT).unwrap();
                b.tick(&inp, &mut out);
                let vb = out.get(PORT_OUT).unwrap();
                assert!(
                    (va - vb).abs() < 1e-12,
                    "voices left the grid at {transport}"
                );
            }
            transport += block;
        }
    }
}
