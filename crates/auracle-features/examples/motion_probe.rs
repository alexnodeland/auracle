//! Measurement: can φ tell a moving texture from a static one?
//!
//! Renders one base patch (saw → lowpass) under a ladder of cutoff
//! modulations — none, sine LFOs from 0.1 to 13 Hz, stepped and gliding
//! random, a euclidean gate, a per-note envelope — and writes, per variant,
//! the φ it gets under the standard phrase plus a long single-note render for
//! offline analysis.
//!
//! ```bash
//! cargo run -p auracle-features --example motion_probe --release -- OUT_DIR
//! ```

use auracle_features::phrase::Note;
use auracle_features::{featurize, render_phrase, Features, PhraseSpec};
use auracle_grammar::term::{AmpEnv, AudioNode, FilterKind, ModNode, PatchTree, Uid, Waveform};
use std::io::Write;

fn tree(modulation: ModNode, depth: f64) -> PatchTree {
    PatchTree {
        amp: AmpEnv {
            attack: 0.05,
            decay: 0.3,
            sustain: 0.8,
            release: 0.3,
        },
        root: AudioNode::Filter {
            uid: Uid::NEW,
            kind: FilterKind::Ladder,
            cutoff: 0.45,
            resonance: 0.5,
            mod_depth: depth,
            input: Box::new(AudioNode::Vco {
                uid: Uid::NEW,
                wave: Waveform::Saw,
                octave: 0,
                detune: 0.5,
                mod_depth: 0.0,
                modulation: ModNode::None,
            }),
            modulation,
        },
    }
}

fn lfo(rate: f64) -> ModNode {
    ModNode::Lfo {
        uid: Uid::NEW,
        wave: Waveform::Sine,
        rate,
    }
}

fn main() {
    let out = std::env::args().nth(1).unwrap_or_else(|| "probe".into());
    std::fs::create_dir_all(&out).unwrap();
    let mut variants: Vec<(String, PatchTree)> = vec![("static".into(), tree(ModNode::None, 0.0))];
    for r in [0.3, 0.5, 0.6, 0.7, 0.8, 0.9] {
        let hz = 0.01 * 3000f64.powf(r);
        variants.push((format!("lfo_{hz:.2}hz"), tree(lfo(r), 0.7)));
    }
    variants.push((
        "rand_step".into(),
        tree(
            ModNode::Rand {
                uid: Uid::NEW,
                rate: 0.7,
                glide: 0.0,
            },
            0.7,
        ),
    ));
    variants.push((
        "rand_drift".into(),
        tree(
            ModNode::Rand {
                uid: Uid::NEW,
                rate: 0.45,
                glide: 0.85,
            },
            0.7,
        ),
    ));
    variants.push((
        "euclid".into(),
        tree(
            ModNode::Euclid {
                uid: Uid::NEW,
                rate: 0.5,
                steps: 0.5,
                pulses: 0.5,
            },
            0.7,
        ),
    ));
    variants.push((
        "env".into(),
        tree(
            ModNode::Env {
                uid: Uid::NEW,
                attack: 0.02,
                decay: 0.45,
            },
            0.7,
        ),
    ));

    let std_spec = PhraseSpec::default();
    let long = PhraseSpec {
        notes: vec![Note {
            voct: 0.0,
            on_s: 8.0,
            off_s: 0.5,
            chord: Vec::new(),
        }],
        ..PhraseSpec::default()
    };
    let mut csv = std::fs::File::create(format!("{out}/phi.csv")).unwrap();
    let names = Features::phi_names();
    writeln!(csv, "variant,{}", names.join(",")).unwrap();
    for (name, t) in &variants {
        match featurize(t, &std_spec) {
            Ok(v) => {
                let phi: Vec<String> = v.features.phi().iter().map(|x| format!("{x:.6}")).collect();
                writeln!(csv, "{name},{}", phi.join(",")).unwrap();
            }
            Err(e) => eprintln!("{name}: {e:?}"),
        }
        for (tag, spec) in [("long", &long), ("std", &std_spec)] {
            let r = render_phrase(t, spec).unwrap();
            let bytes: Vec<u8> = r
                .samples
                .iter()
                .flat_map(|s| (*s as f32).to_le_bytes())
                .collect();
            std::fs::write(format!("{out}/{name}.{tag}.f32"), bytes).unwrap();
        }
        eprintln!("{name}");
    }
}
