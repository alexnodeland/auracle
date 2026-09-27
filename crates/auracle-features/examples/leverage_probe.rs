//! Measurement: how concentrated is a patch's *perceptual leverage*?
//!
//! For every preset and every continuous knob, nudge the knob ±0.15 and
//! measure how far the audio half of φ moves, in units of the preset
//! library's own per-coordinate spread. Prints one CSV row per (preset, knob)
//! so the distribution can be read offline: if a handful of knobs carry most of
//! the movement, "map the controller to the knobs that matter" is a real
//! operation; if leverage is flat, it is a random pick with a story attached.
//!
//! ```bash
//! cargo run -p auracle-features --example leverage_probe --release > leverage.csv
//! ```

use auracle_features::{featurize, PhraseSpec};
use auracle_grammar::edit::{set_param, ParamValue};
use auracle_grammar::{preset_bank, PatchTree};
use fugue_evo::genome::trace_genome::ChoiceValue;
use fugue_evo::genome::trace_genome::TraceGenome;

const STEP: f64 = 0.15;

fn audio_phi(t: &PatchTree, spec: &PhraseSpec) -> Option<Vec<f64>> {
    featurize(t, spec).ok().map(|v| v.features.audio.to_vec())
}

fn main() {
    let spec = PhraseSpec::default();
    let bank = preset_bank();
    let bases: Vec<Option<Vec<f64>>> = bank.iter().map(|p| audio_phi(&p.tree, &spec)).collect();
    let ok: Vec<&Vec<f64>> = bases.iter().flatten().collect();
    let d = ok[0].len();
    let sd: Vec<f64> = (0..d)
        .map(|j| {
            let m = ok.iter().map(|v| v[j]).sum::<f64>() / ok.len() as f64;
            let v = ok.iter().map(|x| (x[j] - m).powi(2)).sum::<f64>() / ok.len() as f64;
            v.sqrt().max(1e-9)
        })
        .collect();
    println!("preset,addr,leverage");
    std::thread::scope(|s| {
        let handles: Vec<_> = bank
            .iter()
            .zip(&bases)
            .map(|(p, base)| {
                let spec = spec.clone();
                let sd = sd.clone();
                s.spawn(move || {
                    let mut rows = Vec::new();
                    let Some(base) = base else { return rows };
                    let trace = p.tree.to_trace();
                    for (addr, choice) in trace.choices.iter() {
                        let ChoiceValue::F64(v) = choice.value else {
                            continue;
                        };
                        let a = addr.to_string();
                        let mut dist = Vec::new();
                        for tgt in [v - STEP, v + STEP] {
                            let tgt = tgt.clamp(0.0, 1.0);
                            if (tgt - v).abs() < 1e-9 {
                                continue;
                            }
                            let Ok(t2) = set_param(&p.tree, &a, ParamValue::Continuous(tgt)) else {
                                continue;
                            };
                            if let Some(phi) = audio_phi(&t2, &spec) {
                                let z: f64 = phi
                                    .iter()
                                    .zip(base)
                                    .zip(&sd)
                                    .map(|((x, b), s)| ((x - b) / s).powi(2))
                                    .sum::<f64>()
                                    .sqrt();
                                // per unit of knob travel, so clamped nudges compare
                                dist.push(z * STEP / (tgt - v).abs());
                            }
                        }
                        if !dist.is_empty() {
                            let l = dist.iter().sum::<f64>() / dist.len() as f64;
                            rows.push(format!("{},{a},{l:.5}", p.name));
                        }
                    }
                    rows
                })
            })
            .collect();
        for h in handles {
            for r in h.join().unwrap() {
                println!("{r}");
            }
        }
    });
}
