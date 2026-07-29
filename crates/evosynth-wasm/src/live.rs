//! The live performance voice: N copies of one compiled patch, played from a
//! keyboard in real time inside an AudioWorklet.
//!
//! This is the "instrument" half of the app (the `WasmEngine` in the worker
//! is the "brain"). It shares the exact compilation path evolution uses —
//! `evosynth_grammar::compile` with the mandatory ADSR → VCA → Limiter chain
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

use evosynth_grammar::{compile, PatchTree};
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
    voice: evosynth_grammar::CompiledVoice,
    /// Currently-held MIDI note, if any (gate high).
    note: Option<u8>,
    /// Allocation stamp for oldest-first stealing.
    stamp: u64,
    /// Still worth ticking (held, or release tail not yet silent).
    running: bool,
    silent_run: u32,
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
    /// Notes physically held right now (survive patch swaps).
    held: Vec<u8>,
    smoothers: Vec<Smoother>,
    stage: Stage,
    gain: f32,
    pending: Option<PatchTree>,
    out_buf: Vec<f32>,
    event: u32,
    last_error: String,
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

    /// Press a MIDI note (60 = C4). Retriggers if already held; otherwise
    /// takes a parked voice, else steals the oldest.
    pub fn note_on(&mut self, note: u8) {
        self.held.retain(|n| *n != note);
        self.held.push(note);
        self.press(note);
    }

    fn press(&mut self, note: u8) {
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
            v.voice.pitch.set((note as f64 - 60.0) / 12.0);
            // Stealing a *held* voice keeps its gate high (legato steal — the
            // envelope doesn't retrigger). Only happens past N held notes.
            v.voice.gate.set(GATE_ON);
            v.note = Some(note);
            v.stamp = stamp;
            v.running = true;
            v.silent_run = 0;
        }
    }

    /// Release a MIDI note (the voice keeps ringing through its tail).
    pub fn note_off(&mut self, note: u8) {
        self.held.retain(|n| *n != note);
        for v in &mut self.voices {
            if v.note == Some(note) {
                v.voice.gate.set(0.0);
                v.note = None;
            }
        }
    }

    /// Release everything.
    pub fn all_off(&mut self) {
        self.held.clear();
        for v in &mut self.voices {
            v.voice.gate.set(0.0);
            v.note = None;
        }
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
                self.out_buf[f * 2] += l as f32;
                self.out_buf[f * 2 + 1] += r as f32;
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
                *s = (*s * self.gain).clamp(-1.5, 1.5);
            }
        }
    }

    fn step(&mut self, frames: usize) {
        self.advance_smoothers();
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
                            for n in self.held.clone() {
                                self.press(n);
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
    use evosynth_grammar::PatchGrammarPrior;
    use rand::rngs::StdRng;
    use rand::{Rng, SeedableRng};

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

        poly.note_on(60);
        poly.note_on(64);
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
        let (_, tree) = evosynth_grammar::presets()
            .into_iter()
            .find(|(n, _)| *n == "First Bass")
            .expect("preset exists");
        let json = serde_json::to_string(&tree).unwrap();
        let mut a = LivePoly::new(&json, 44_100.0, 1).unwrap();
        let mut b = LivePoly::new(&json, 44_100.0, 1).unwrap();
        a.note_on(48);
        b.note_on(48);
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
        poly.note_on(57);
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
                0 | 1 => poly.note_on(rng.gen_range(36..85)),
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
