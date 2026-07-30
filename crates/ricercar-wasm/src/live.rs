//! The live performance voice: N copies of one compiled patch, played from a
//! keyboard in real time inside an AudioWorklet.
//!
//! This is the "instrument" half of the app (the `WasmEngine` in the worker
//! is the "brain"). It shares the exact compilation path evolution uses —
//! `ricercar_grammar::compile` with the mandatory ADSR → VCA → Limiter chain
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
//! - Released voices keep ticking through their tails and are parked once
//!   effectively silent, so idle polyphony costs nothing.

use ricercar_grammar::{compile, PatchTree};
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

struct Voice {
    voice: ricercar_grammar::CompiledVoice,
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
}

struct Smoother {
    addr: String,
    current: f64,
    target: f64,
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
    /// v/oct of the most recent press — glide start point.
    last_pitch: f64,
    /// Unison: all voices play one note, detuned and panned apart.
    unison: bool,
    uni_detune: f64,
    uni_spread: f64,
    /// Loudness makeup gain (linear); swaps in with the patch it belongs to.
    makeup: f32,
    pending_makeup: Option<f32>,
    // Arpeggiator (sample-accurate, runs on the audio thread).
    arp_on: bool,
    /// 0 = up, 1 = down, 2 = up-down, 3 = random.
    arp_mode: u32,
    /// Steps per beat (1 = quarters, 2 = eighths, 4 = sixteenths).
    arp_div: f64,
    bpm: f64,
    /// Samples elapsed in the current arp step.
    arp_phase: f64,
    arp_idx: usize,
    /// Direction flag for up-down mode.
    arp_up: bool,
    /// The arp note currently gated on.
    arp_note: Option<u8>,
    /// xorshift state for random mode (deterministic; no wall clock).
    rng_state: u64,
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
        Ok(LivePoly {
            voices,
            n_voices: n,
            sample_rate,
            counter: 0,
            held: Vec::new(),
            smoothers: Vec::new(),
            stage: Stage::Run,
            gain: 1.0,
            pending: None,
            out_buf: Vec::new(),
            event: EVENT_NONE,
            last_error: String::new(),
            bend: 0.0,
            bend_tgt: 0.0,
            glide: 0.0,
            last_pitch: 0.0,
            unison: false,
            uni_detune: 0.3,
            uni_spread: 0.7,
            makeup: 1.0,
            pending_makeup: None,
            arp_on: false,
            arp_mode: 0,
            arp_div: 2.0,
            bpm: 120.0,
            arp_phase: 0.0,
            arp_idx: 0,
            arp_up: true,
            arp_note: None,
            rng_state: 0x9E37_79B9_7F4A_7C15,
        })
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
            self.last_pitch
        } else {
            target
        };
        self.last_pitch = target;
        if self.unison {
            // All voices, symmetric detune (±uni_detune·30 cents) and
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
                let det = frac * self.uni_detune * 0.025; // v/oct (30 c max)
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
                v.note = Some(note);
                v.stamp = stamp;
                v.running = true;
                v.silent_run = 0;
                v.vel = Self::vel_gain(vel);
                v.pan_l = th.cos() as f32;
                v.pan_r = th.sin() as f32;
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
        if let Some(i) = idx {
            let v = &mut self.voices[i];
            v.pitch_tgt = target;
            v.pitch_cur = start;
            v.voice.pitch.set(v.pitch_cur + self.bend);
            // Stealing a *held* voice keeps its gate high (legato steal — the
            // envelope doesn't retrigger). Only happens past N held notes.
            v.voice.gate.set(GATE_ON);
            v.note = Some(note);
            v.stamp = stamp;
            v.running = true;
            v.silent_run = 0;
            v.vel = Self::vel_gain(vel);
            v.pan_l = std::f32::consts::FRAC_1_SQRT_2;
            v.pan_r = std::f32::consts::FRAC_1_SQRT_2;
        }
    }

    fn release_voices(&mut self, note: u8) {
        for v in &mut self.voices {
            if v.note == Some(note) {
                v.voice.gate.set(0.0);
                v.note = None;
            }
        }
    }

    /// Release a MIDI note (the voice keeps ringing through its tail).
    pub fn note_off(&mut self, note: u8) {
        self.held.retain(|(n, _)| *n != note);
        if self.arp_on {
            // Only the arp's own gate matters; other held notes were never
            // pressed.
            if self.arp_note == Some(note) && !self.held.iter().any(|(n, _)| *n == note) {
                self.release_voices(note);
                self.arp_note = None;
            }
            return;
        }
        self.release_voices(note);
    }

    /// Release everything.
    pub fn all_off(&mut self) {
        self.held.clear();
        self.arp_note = None;
        for v in &mut self.voices {
            v.voice.gate.set(0.0);
            v.note = None;
        }
    }

    /// Pitch bend in semitones (smoothed on the audio thread).
    pub fn set_bend(&mut self, semitones: f64) {
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

    /// Configure the arpeggiator. `mode`: 0 up, 1 down, 2 up-down,
    /// 3 random. `div`: steps per beat. Turning it off re-presses the held
    /// chord; turning it on hands the held notes to the scheduler.
    pub fn set_arp(&mut self, on: bool, mode: u32, div: f64, bpm: f64) {
        self.arp_mode = mode.min(3);
        self.arp_div = div.clamp(0.5, 8.0);
        self.bpm = bpm.clamp(30.0, 300.0);
        if on == self.arp_on {
            return;
        }
        self.arp_on = on;
        if on {
            // The scheduler owns the gates now.
            for &(n, _) in self.held.clone().iter() {
                self.release_voices(n);
            }
            self.arp_note = None;
            self.arp_phase = f64::MAX; // fire on the next quantum
            self.arp_idx = 0;
            self.arp_up = true;
        } else {
            if let Some(n) = self.arp_note.take() {
                self.release_voices(n);
            }
            for &(n, v) in self.held.clone().iter() {
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

    /// Advance the arpeggiator by `frames` samples: half-step gate length,
    /// step boundaries press the next held note (sorted by pitch).
    fn tick_arp(&mut self, frames: usize) {
        if !self.arp_on {
            return;
        }
        if self.held.is_empty() {
            if let Some(n) = self.arp_note.take() {
                self.release_voices(n);
            }
            return;
        }
        let step_len = self.sample_rate * 60.0 / (self.bpm * self.arp_div);
        self.arp_phase = (self.arp_phase + frames as f64).min(f64::MAX);
        // Gate off at half the step.
        if let Some(n) = self.arp_note {
            if self.arp_phase >= step_len * 0.5 && !self.held.iter().any(|(h, _)| *h == n) {
                // Note left the chord mid-step: release now.
                self.release_voices(n);
                self.arp_note = None;
            } else if self.arp_phase >= step_len * 0.5 {
                self.release_voices(n);
                self.arp_note = None;
            }
        }
        if self.arp_phase < step_len {
            return;
        }
        self.arp_phase = 0.0;
        let mut notes: Vec<(u8, f32)> = self.held.clone();
        notes.sort_by_key(|(n, _)| *n);
        let len = notes.len();
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
        let (note, vel) = notes[pick.min(len - 1)];
        self.press(note, vel);
        self.arp_note = Some(note);
    }

    /// Set a normalized knob target. The value ramps in over ~25 ms on the
    /// audio thread (no zipper) — **no recompilation**: filter and delay
    /// state survive. Returns false for addresses with no live handle
    /// (enums, structure) — those need `set_patch`.
    pub fn set_param(&mut self, addr: &str, value: f64) -> bool {
        let Some(handle) = self.voices.first().and_then(|v| v.voice.params.get(addr)) else {
            return false;
        };
        let target = handle.map.apply(value.clamp(0.0, 1.0));
        let current = handle.value.get();
        if let Some(s) = self.smoothers.iter_mut().find(|s| s.addr == addr) {
            s.target = target;
        } else {
            self.smoothers.push(Smoother {
                addr: addr.to_string(),
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
            for v in &self.voices {
                if let Some(h) = v.voice.params.get(&s.addr) {
                    h.value.set(s.current);
                }
            }
        }
        self.smoothers.retain(|s| s.current != s.target);
    }

    fn render_into(&mut self, frames: usize, fade_dir: i8) {
        self.out_buf.clear();
        self.out_buf.resize(frames * 2, 0.0);
        for v in &mut self.voices {
            if !v.running {
                continue;
            }
            let held = v.note.is_some();
            let mut tail_silent = 0u32;
            for f in 0..frames {
                let (l, r) = v.voice.patch.tick();
                self.out_buf[f * 2] += l as f32 * v.vel * v.pan_l * std::f32::consts::SQRT_2;
                self.out_buf[f * 2 + 1] += r as f32 * v.vel * v.pan_r * std::f32::consts::SQRT_2;
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
        // Per-frame fade + safety clamp (each voice is already limited).
        for f in 0..frames {
            if fade_dir < 0 {
                self.gain = (self.gain - FADE_STEP).max(0.0);
            } else if fade_dir > 0 {
                self.gain = (self.gain + FADE_STEP).min(1.0);
            }
            for c in 0..2 {
                let s = &mut self.out_buf[f * 2 + c];
                *s = (*s * self.gain * self.makeup).clamp(-1.5, 1.5);
            }
        }
    }

    fn step(&mut self, frames: usize) {
        self.advance_smoothers();
        self.tick_arp(frames);
        self.advance_pitch(frames);
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
                            self.voices = built;
                            self.pending = None;
                            self.smoothers.clear();
                            if let Some(g) = self.pending_makeup.take() {
                                self.makeup = g;
                            }
                            if self.arp_on {
                                // The scheduler re-presses on its next step.
                                self.arp_note = None;
                            } else {
                                for (n, v) in self.held.clone() {
                                    self.press(n, v);
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
    use rand::rngs::StdRng;
    use rand::{Rng, SeedableRng};
    use ricercar_grammar::PatchGrammarPrior;

    fn tree_json(rng: &mut StdRng) -> String {
        serde_json::to_string(&PatchGrammarPrior::default().sample_with_rng(rng)).unwrap()
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
        let (_, tree) = ricercar_grammar::presets()
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

    /// The arpeggiator steps through a held chord on its own clock, and
    /// velocity scales output level.
    #[test]
    fn arp_steps_and_velocity_scales() {
        let (_, tree) = ricercar_grammar::presets()
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
        p.set_arp(true, 0, 4.0, 240.0); // 16ths at 240 BPM ≈ 16 steps/s
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
        p.set_arp(false, 0, 4.0, 240.0);
        let gated: Vec<_> = p.voices.iter().filter_map(|v| v.note).collect();
        assert_eq!(gated.len(), 3, "chord not re-pressed after arp off");
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
}
