//! The live performance voice: N copies of one compiled patch, played from a
//! keyboard in real time inside an AudioWorklet.
//!
//! This is the "instrument" half of the app (the `WasmEngine` in the worker
//! is the "brain"). It shares the exact compilation path evolution uses —
//! `evosynth_grammar::compile` with the mandatory ADSR → VCA → Limiter chain
//! — so what you play is byte-for-byte the patch that was evolved, limiter
//! included.
//!
//! Voice management: simple oldest-note stealing. Released voices keep
//! ticking through their release/delay tails and are parked (skipped
//! entirely) once their output has been effectively silent for a while, so
//! idle polyphony costs nothing.

use evosynth_grammar::{compile, PatchTree};
use wasm_bindgen::prelude::*;

const GATE_ON: f64 = 5.0;
/// |L|+|R| below this counts as silence for voice parking.
const SILENCE_EPS: f64 = 1.0e-6;
/// Consecutive silent frames (post-release) before a voice is parked.
const PARK_AFTER: u32 = 4096;

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

/// A polyphonic live instrument over one patch.
#[wasm_bindgen]
pub struct LivePoly {
    voices: Vec<Voice>,
    sample_rate: f64,
    counter: u64,
}

fn build_voices(tree: &PatchTree, sample_rate: f64, n: usize) -> Result<Vec<Voice>, String> {
    (0..n)
        .map(|_| {
            let voice = compile(tree, sample_rate).map_err(|e| e.to_string())?;
            voice.gate.set(0.0);
            Ok(Voice {
                voice,
                note: None,
                stamp: 0,
                running: false,
                silent_run: 0,
            })
        })
        .collect()
}

#[wasm_bindgen]
impl LivePoly {
    /// Build an `n_voices`-voice instrument from a `PatchTree` JSON.
    #[wasm_bindgen(constructor)]
    pub fn new(tree_json: &str, sample_rate: f64, n_voices: usize) -> Result<LivePoly, JsValue> {
        let tree: PatchTree =
            serde_json::from_str(tree_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let voices =
            build_voices(&tree, sample_rate, n_voices.max(1)).map_err(|e| JsValue::from_str(&e))?;
        Ok(LivePoly {
            voices,
            sample_rate,
            counter: 0,
        })
    }

    /// Swap in a new patch (keeps voice count). Held notes are dropped —
    /// the caller should re-press or treat this as a patch change. Returns
    /// false (and keeps the old patch) if the new tree fails to compile.
    pub fn set_patch(&mut self, tree_json: &str) -> bool {
        let Ok(tree) = serde_json::from_str::<PatchTree>(tree_json) else {
            return false;
        };
        match build_voices(&tree, self.sample_rate, self.voices.len()) {
            Ok(voices) => {
                self.voices = voices;
                true
            }
            Err(_) => false,
        }
    }

    /// Press a MIDI note (60 = C4). Retriggers if already held; otherwise
    /// takes a parked voice, else steals the oldest.
    pub fn note_on(&mut self, note: u8) {
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
            // envelope doesn't retrigger). Only happens past 4 held notes.
            v.voice.gate.set(GATE_ON);
            v.note = Some(note);
            v.stamp = stamp;
            v.running = true;
            v.silent_run = 0;
        }
    }

    /// Release a MIDI note (the voice keeps ringing through its tail).
    pub fn note_off(&mut self, note: u8) {
        for v in &mut self.voices {
            if v.note == Some(note) {
                v.voice.gate.set(0.0);
                v.note = None;
            }
        }
    }

    /// Release everything.
    pub fn all_off(&mut self) {
        for v in &mut self.voices {
            v.voice.gate.set(0.0);
            v.note = None;
        }
    }

    /// Render `frames` frames of interleaved stereo (`[l0, r0, l1, r1, …]`).
    pub fn process(&mut self, frames: usize) -> Vec<f32> {
        let mut out = vec![0.0f32; frames * 2];
        for v in &mut self.voices {
            if !v.running {
                continue;
            }
            let held = v.note.is_some();
            let mut tail_silent = 0u32;
            for f in 0..frames {
                let (l, r) = v.voice.patch.tick();
                out[f * 2] += l as f32;
                out[f * 2 + 1] += r as f32;
                if !held && l.abs() + r.abs() < SILENCE_EPS {
                    tail_silent += 1;
                } else {
                    tail_silent = 0;
                }
            }
            if held {
                v.silent_run = 0;
            } else {
                // Only a block-terminal silent run carries across blocks.
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
        // Soft safety clamp on the sum (each voice is already limited).
        for s in &mut out {
            *s = s.clamp(-1.5, 1.5);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use evosynth_grammar::PatchGrammarPrior;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    /// Native smoke: a prior patch plays a note (finite, audible), rings a
    /// tail after release, and eventually parks its voices.
    #[test]
    fn live_poly_plays_and_parks() {
        let mut rng = StdRng::seed_from_u64(0x11FE);
        let tree = PatchGrammarPrior::default().sample_with_rng(&mut rng);
        let json = serde_json::to_string(&tree).unwrap();
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
        // Long tail budget: 10 s of processing must park every voice.
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
}
