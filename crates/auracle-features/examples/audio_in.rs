//! What φ hears of a patch that listens: AUDIO IN patches measured through
//! the reference audition clip.
//!
//! Renders a handful of patches built around an AUDIO IN (the input bare,
//! filtered, driven, smeared in time, keying a ducker, modulating a vocoder),
//! featurizes each through the full pipeline (render on the clip, vet,
//! loudness, φ), and prints φ_audio as a table, one column per patch, beside
//! a supersaw that does not listen. Then checks the directions a listener
//! would expect: a lowpass on the input darkens it and a highpass brightens
//! it, drive squares off its peaks, a reverb smears its plucks, and the input
//! keying a ducker or shaping a vocoder sets a supersaw moving. Last, the same
//! lowpass patch under a captured clip instead of the reference: another clip,
//! another φ, another render key.
//!
//! One thing it does not show, on purpose: a longer tail. Every effect in a
//! patch sits before the voice's amp envelope, so a reverb's tail ends with
//! the amp's release, as it does for any patch; `tail_ratio` measures the
//! release.
//!
//! ```bash
//! cargo run -p auracle-features --example audio_in --release
//! ```
use auracle_features::{featurize, render_key, AudioFeatures, AuditionClip, Features, PhraseSpec};
use auracle_grammar::term::{
    AmpEnv, AudioNode, DriveMode, FilterKind, InputChannel, ModNode, PatchTree, Uid,
};
use auracle_grammar::INPUT_GAIN_UNITY;

fn input() -> AudioNode {
    AudioNode::AudioIn {
        uid: Uid::NEW,
        input: 0,
        gain: INPUT_GAIN_UNITY,
        channel: InputChannel::Both,
    }
}

fn supersaw() -> AudioNode {
    AudioNode::Supersaw {
        uid: Uid::NEW,
        octave: 0,
        detune: 0.35,
        mix: 0.5,
        mod_depth: 0.0,
        modulation: ModNode::None,
    }
}

fn filter(kind: FilterKind, cutoff: f64, inner: AudioNode) -> AudioNode {
    AudioNode::Filter {
        uid: Uid::NEW,
        kind,
        cutoff,
        resonance: 0.2,
        mod_depth: 0.0,
        input: Box::new(inner),
        modulation: ModNode::None,
    }
}

fn patch(root: AudioNode) -> PatchTree {
    PatchTree {
        amp: AmpEnv {
            attack: 0.02,
            decay: 0.3,
            sustain: 0.9,
            release: 0.25,
        },
        root,
    }
}

fn patches() -> Vec<(&'static str, PatchTree)> {
    vec![
        ("supersaw", patch(supersaw())),
        ("input", patch(input())),
        ("lowpass", patch(filter(FilterKind::SvfLp, 0.3, input()))),
        ("highpass", patch(filter(FilterKind::SvfHp, 0.65, input()))),
        (
            "drive",
            patch(AudioNode::Distortion {
                uid: Uid::NEW,
                drive: 0.85,
                tone: 0.8,
                mode: DriveMode::Hard,
                mod_depth: 0.0,
                input: Box::new(input()),
                modulation: ModNode::None,
            }),
        ),
        (
            "reverb",
            patch(AudioNode::Reverb {
                uid: Uid::NEW,
                size: 0.85,
                damp: 0.3,
                mix: 0.6,
                mod_depth: 0.0,
                input: Box::new(input()),
                modulation: ModNode::None,
            }),
        ),
        (
            "delay",
            patch(AudioNode::Delay {
                uid: Uid::NEW,
                time: 0.45,
                feedback: 0.55,
                mix: 0.5,
                mod_depth: 0.0,
                input: Box::new(input()),
                modulation: ModNode::None,
            }),
        ),
        (
            // The input as a key: it pumps a supersaw, recovering between
            // plucks (a release shorter than their 250 ms spacing).
            "ducked",
            patch(AudioNode::Duck {
                uid: Uid::NEW,
                amount: 0.9,
                threshold: 0.2,
                release: 0.05,
                mod_depth: 0.0,
                input: Box::new(supersaw()),
                key: Box::new(input()),
                modulation: ModNode::None,
            }),
        ),
        (
            // The input as a modulator: its spectrum shapes a supersaw.
            "vocoded",
            patch(AudioNode::Vocoder {
                uid: Uid::NEW,
                bands: 0.6,
                attack: 0.2,
                release: 0.3,
                mod_depth: 0.0,
                carrier: Box::new(supersaw()),
                modulator: Box::new(input()),
                modulation: ModNode::None,
            }),
        ),
    ]
}

fn coord(f: &Features, name: &str) -> f64 {
    let i = AudioFeatures::NAMES
        .iter()
        .position(|n| n.starts_with(name))
        .unwrap_or_else(|| panic!("no feature {name}"));
    f.audio.to_vec()[i]
}

fn main() {
    let spec = PhraseSpec::default();
    let reference = spec.audition_clip();
    println!(
        "reference clip: {} frames, {} channel, {:.2} s, id {}",
        reference.frames(),
        reference.channel_count(),
        reference.seconds(),
        reference.id()
    );

    let mut measured: Vec<(&str, Features)> = Vec::new();
    for (name, tree) in patches() {
        match featurize(&tree, &spec) {
            Ok(c) => measured.push((name, c.features)),
            Err(e) => println!("{name}: not measured ({e})"),
        }
    }

    // φ_audio, one column per patch.
    print!("\n{:<24}", "φ_audio");
    for (name, _) in &measured {
        print!("{name:>10}");
    }
    println!();
    for (i, feature) in AudioFeatures::NAMES.iter().enumerate() {
        print!("{:<24}", feature.trim_end_matches(":p2"));
        for (_, f) in &measured {
            print!("{:>10.4}", f.audio.to_vec()[i]);
        }
        println!();
    }

    let get = |name: &str| {
        measured
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, f)| f)
            .unwrap_or_else(|| panic!("{name} did not measure"))
    };
    let (bare, lp, hp) = (get("input"), get("lowpass"), get("highpass"));
    let (drive, reverb) = (get("drive"), get("reverb"));
    let (saw, ducked, vocoded) = (get("supersaw"), get("ducked"), get("vocoded"));
    let checks = [
        (
            "a lowpass on the input lowers the centroid",
            coord(lp, "centroid_mean") < coord(bare, "centroid_mean"),
        ),
        (
            "a highpass on the input raises the centroid",
            coord(hp, "centroid_mean") > coord(bare, "centroid_mean"),
        ),
        (
            "a lowpass lowers the rolloff, and a highpass raises it",
            coord(lp, "rolloff_mean") < coord(bare, "rolloff_mean")
                && coord(hp, "rolloff_mean") > coord(bare, "rolloff_mean"),
        ),
        (
            "a highpass takes the bass out, and a lowpass leaves mostly bass",
            coord(hp, "bass_fraction") < coord(bare, "bass_fraction")
                && coord(lp, "bass_fraction") > coord(bare, "bass_fraction"),
        ),
        (
            "drive squares off the peaks: the crest factor falls",
            coord(drive, "crest") < coord(bare, "crest"),
        ),
        (
            "a reverb smears the plucks: crest and spectral movement fall",
            coord(reverb, "crest") < coord(bare, "crest")
                && coord(reverb, "centroid_std") < coord(bare, "centroid_std"),
        ),
        (
            "the input keying a ducker sets the supersaw pumping (motion_mid, crest)",
            coord(ducked, "motion_mid") > coord(saw, "motion_mid")
                && coord(ducked, "crest") > coord(saw, "crest"),
        ),
        (
            "the input on a vocoder moves the supersaw's spectrum",
            coord(vocoded, "centroid_std") > coord(saw, "centroid_std"),
        ),
    ];
    println!();
    for (what, ok) in checks {
        println!("{} {what}", if ok { "  ok" } else { "  NO" });
    }

    // Another clip: a captured one, here a falling sine sweep.
    let sweep: Vec<f32> = (0..spec.total_samples())
        .map(|i| {
            let t = i as f64 / spec.sample_rate;
            let hz = 1200.0 * (-t / 2.5).exp() + 80.0;
            (0.4 * (std::f64::consts::TAU * hz * t).sin()) as f32
        })
        .collect();
    let captured =
        AuditionClip::from_interleaved(&sweep, 1, spec.sample_rate, &spec).expect("a clip");
    let other = PhraseSpec {
        clip: Some(captured),
        ..spec.clone()
    };
    let tree = &patches()[2].1;
    let under = featurize(tree, &other).expect("the sweep is heard");
    println!(
        "\nlowpass under the reference: centroid {:.4}, key {}",
        coord(lp, "centroid_mean"),
        render_key(tree, &spec)
    );
    println!(
        "lowpass under a captured sweep: centroid {:.4}, key {}",
        coord(&under.features, "centroid_mean"),
        render_key(tree, &other)
    );
}
