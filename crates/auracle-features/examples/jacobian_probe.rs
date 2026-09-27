//! Measurement: the audio Jacobian `∂φ_audio/∂knob` of every preset.
//!
//! Central differences with step `H` (one-sided at a range end). One CSV row
//! per (preset, knob) holding the knob's current value and the derivative of
//! each audio coordinate, plus a `BASE` row per preset holding φ itself. This
//! is the raw material for asking whether a *named* perceptual control
//! ("brighter") can be wired onto a given patch's knobs by least squares, and
//! how well-conditioned that solve is.
//!
//! ```bash
//! cargo run -p auracle-features --example jacobian_probe --release > jac.csv
//! ```

use auracle_features::{featurize, AudioFeatures, PhraseSpec};
use auracle_grammar::edit::{set_param, ParamValue};
use auracle_grammar::{preset_bank, PatchTree};
use fugue_evo::genome::trace_genome::{ChoiceValue, TraceGenome};

const H: f64 = 0.08;

fn audio_phi(t: &PatchTree, spec: &PhraseSpec) -> Option<Vec<f64>> {
    featurize(t, spec).ok().map(|v| v.features.audio.to_vec())
}

fn row(v: &[f64]) -> String {
    v.iter()
        .map(|x| format!("{x:.6}"))
        .collect::<Vec<_>>()
        .join(",")
}

fn main() {
    let spec = PhraseSpec::default();
    let bank = preset_bank();
    println!("preset,addr,value,{}", AudioFeatures::NAMES.join(","));
    std::thread::scope(|s| {
        let handles: Vec<_> = bank
            .iter()
            .map(|p| {
                let spec = spec.clone();
                s.spawn(move || {
                    let mut rows = Vec::new();
                    let Some(base) = audio_phi(&p.tree, &spec) else {
                        return rows;
                    };
                    rows.push(format!("{},BASE,0,{}", p.name, row(&base)));
                    for (addr, choice) in p.tree.to_trace().choices.iter() {
                        let ChoiceValue::F64(v) = choice.value else {
                            continue;
                        };
                        let a = addr.to_string();
                        let lo = (v - H).max(0.0);
                        let hi = (v + H).min(1.0);
                        let at = |x: f64| -> Option<Vec<f64>> {
                            if (x - v).abs() < 1e-12 {
                                return Some(base.clone());
                            }
                            let t = set_param(&p.tree, &a, ParamValue::Continuous(x)).ok()?;
                            audio_phi(&t, &spec)
                        };
                        let (Some(fl), Some(fh)) = (at(lo), at(hi)) else {
                            continue;
                        };
                        let d: Vec<f64> = fh
                            .iter()
                            .zip(&fl)
                            .map(|(h, l)| (h - l) / (hi - lo))
                            .collect();
                        rows.push(format!("{},{a},{v:.4},{}", p.name, row(&d)));
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
