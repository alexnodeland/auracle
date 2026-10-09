use super::*;
use crate::clip::AuditionClip;
use crate::phrase::Note;
use crate::pipeline::featurize;
use crate::tests::vco;
use auracle_grammar::term::{AmpEnv, AudioNode, InputChannel, ModNode, Uid, Waveform};
use auracle_grammar::{INPUT_GAIN_UNITY, PARAM_MAX};

/// A patch that is nothing but an input through the voice stage.
fn only_input() -> PatchTree {
    PatchTree {
        amp: AmpEnv {
            attack: 0.0,
            decay: 0.2,
            sustain: PARAM_MAX,
            release: 0.0,
        },
        root: AudioNode::AudioIn {
            uid: Uid::NEW,
            input: 0,
            gain: INPUT_GAIN_UNITY,
            channel: InputChannel::Both,
        },
    }
}

/// Two notes: one the clip is silent under, then one with `chord`'s
/// voices, each compiled at its onset, mid-render.
fn two_notes(chord: &[f64]) -> PhraseSpec {
    PhraseSpec {
        notes: vec![
            Note {
                voct: 0.0,
                on_s: 0.1,
                off_s: 0.4,
                chord: Vec::new(),
            },
            Note {
                voct: 0.0,
                on_s: 0.3,
                off_s: 0.3,
                chord: chord.to_vec(),
            },
        ],
        ..PhraseSpec::default()
    }
}

/// **Chord voices read the frame the main voice reads.** The clip is
/// silent until the second note's onset and a tone after it, so every
/// voice meets the tone cold at the same sample. On the host's clock the
/// chord voices, compiled at that onset mid-render (one for a dyad, two
/// for a triad), read exactly the frames the main voice reads: the dyad's
/// render is the mono render doubled and the triad's tripled, bit for bit.
///
/// This fails both ways the render could get it wrong. Without an
/// `advance()` per frame every voice reads frame 0 (silence) and the mono
/// render is silent. On a cursor-mode stream a voice built mid-block waits
/// for a block that never comes, and the dyad is the mono render, not
/// twice it.
#[test]
fn chord_voices_read_the_frame_the_main_voice_reads() {
    let mono = two_notes(&[]);
    let onset = ((0.1 + 0.4) * mono.sample_rate) as usize;
    let held = (0.3 * mono.sample_rate) as usize;
    let clip: Vec<f32> = (0..mono.total_samples())
        .map(|i| {
            if i < onset {
                0.0
            } else {
                let t = i as f64 / mono.sample_rate;
                (0.4 * (t * 330.0 * std::f64::consts::TAU).sin()) as f32
            }
        })
        .collect();
    let clip = AuditionClip::from_interleaved(&clip, 1, mono.sample_rate, &mono).unwrap();
    let with_clip = |s: PhraseSpec| PhraseSpec {
        clip: Some(clip.clone()),
        ..s
    };
    let tree = only_input();
    let one = render_phrase(&tree, &with_clip(mono)).unwrap().samples;
    let two = render_phrase(&tree, &with_clip(two_notes(&[7.0 / 12.0])))
        .unwrap()
        .samples;
    let three = render_phrase(&tree, &with_clip(two_notes(&[4.0 / 12.0, 7.0 / 12.0])))
        .unwrap()
        .samples;
    assert!(
        one[..onset].iter().all(|s| *s == 0.0),
        "the clip is silent before the dyad, and so is the render"
    );
    let heard = one[onset..onset + held]
        .iter()
        .fold(0.0f64, |m, s| m.max(s.abs()));
    assert!(
        heard > 0.05,
        "the input is heard under the second note ({heard})"
    );
    for i in onset..onset + held {
        assert_eq!(
            two[i],
            2.0 * one[i],
            "frame {i}: the chord voice is not reading the main voice's frame"
        );
        assert_eq!(
            three[i],
            3.0 * one[i],
            "frame {i}: the two chord voices are not reading the main voice's frame"
        );
    }
}

/// A patch that does not listen renders identically under any clip: it
/// never reads one, so neither its samples nor its cached rows move.
#[test]
fn a_patch_that_does_not_listen_ignores_the_clip() {
    let spec = PhraseSpec::default();
    let clip =
        AuditionClip::from_interleaved(&[0.25f32; 4410], 1, spec.sample_rate, &spec).unwrap();
    let tree = auracle_grammar::presets()[0].1.clone();
    assert!(!tree.listens());
    let plain = render_phrase(&tree, &spec).unwrap().samples;
    let clipped = render_phrase(
        &tree,
        &PhraseSpec {
            clip: Some(clip),
            ..spec
        },
    )
    .unwrap()
    .samples;
    assert_eq!(plain, clipped);
}

/// The vet judges the render made with the clip: a patch that listens to
/// the reference passes, and the same patch over a clip that only sounds
/// in the phrase's first gap (while its amp is closed) is refused as
/// silent.
#[test]
fn the_vet_hears_the_clip() {
    let spec = PhraseSpec::default();
    let tree = only_input();
    assert!(
        crate::featurize(&tree, &spec).is_ok(),
        "the reference is heard"
    );
    // The middle half of the first note's rest, wherever the phrase puts it.
    let first = &spec.notes[0];
    let at = |s: f64| (s * spec.sample_rate) as usize;
    let gap = at(first.on_s + 0.25 * first.off_s)..at(first.on_s + 0.75 * first.off_s);
    let between: Vec<f32> = (0..spec.total_samples())
        .map(|i| if gap.contains(&i) { 0.5 } else { 0.0 })
        .collect();
    let between = AuditionClip::from_interleaved(&between, 1, spec.sample_rate, &spec)
        .expect("a clip that is not silent");
    let err = crate::featurize(
        &tree,
        &PhraseSpec {
            clip: Some(between),
            ..spec
        },
    )
    .expect_err("the patch is silent over it");
    assert!(
        matches!(
            err,
            crate::FeaturizeError::Quarantined(crate::VetFailure::Silent { .. })
        ),
        "{err}"
    );
}

/// Frequency of `x` from its rising zero crossings, interpolated (Hz at
/// `sr`); `None` with fewer than two.
fn crossing_hz(x: &[f64], sr: f64) -> Option<f64> {
    let mean = x.iter().sum::<f64>() / x.len() as f64;
    let (mut first, mut last, mut n) = (None, 0.0, 0usize);
    for i in 1..x.len() {
        let (a, b) = (x[i - 1] - mean, x[i] - mean);
        if a < 0.0 && b >= 0.0 {
            let t = (i - 1) as f64 + a / (a - b);
            match first {
                None => first = Some(t),
                Some(_) => n += 1,
            }
            last = t;
        }
    }
    first.filter(|_| n > 0).map(|f| sr * n as f64 / (last - f))
}

/// **TRACK on the reference clip plays the clip's notes.** A sine VCO under
/// a TRACK listening to an AUDIO IN, rendered on the standard phrase the
/// way every measurement is (`render_phrase`, the reference on the host's
/// clock, chord voices joining mid-render), sings each of the figure's
/// fourteen notes, A2 to E4. Measured from the render's zero crossings
/// between 60 and 140 ms after each onset (after the tracker's ~48 ms to
/// confirm a note, before the next one or a chord voice joins), every note
/// is the figure's note within `NOTE_CENTS`, and the typical note is within
/// `TYPICAL_CENTS`.
///
/// Measured (2026-10-02): thirteen notes within 1.4 cents; the D4 at 1.75 s
/// reads 17 cents sharp, because the figure is not quite monophonic there:
/// the E4 held from 1.00 s (decaying over 0.35 s) still rings under the
/// quieter, darker D4, and YIN hears the pair. That is the tracker reading
/// its input honestly, so the bound for one note is the note, not 5 cents.
#[test]
fn track_plays_the_reference_figures_notes() {
    use auracle_grammar::term::{PitchBand, Waveform};
    use auracle_grammar::{ModNode, TRACK_SENSITIVITY_DEFAULT};
    /// A quarter-tone: every note is the right note.
    const NOTE_CENTS: f64 = 25.0;
    /// The median note: quiver pins a plucked note within 5 cents.
    const TYPICAL_CENTS: f64 = 5.0;
    let tree = PatchTree {
        amp: AmpEnv {
            attack: 0.0,
            decay: 0.2,
            sustain: PARAM_MAX,
            release: 0.6,
        },
        root: AudioNode::Track {
            uid: Uid::NEW,
            band: PitchBand::Mid,
            sensitivity: TRACK_SENSITIVITY_DEFAULT,
            dynamics: 0.0,
            input: Box::new(AudioNode::Vco {
                uid: Uid::NEW,
                wave: Waveform::Sine,
                octave: 0,
                detune: 0.5,
                mod_depth: 0.0,
                modulation: ModNode::None,
            }),
            listen: Box::new(AudioNode::AudioIn {
                uid: Uid::NEW,
                input: 0,
                gain: INPUT_GAIN_UNITY,
                channel: InputChannel::Both,
            }),
        },
    };
    assert!(tree.listens());
    let spec = PhraseSpec::default();
    let render = render_phrase(&tree, &spec).expect("renders");
    let sr = render.sample_rate;
    let mut errors = Vec::new();
    let mut report = Vec::new();
    for (at, note) in crate::clip::reference_notes() {
        let want = 440.0 * 2f64.powf((note as f64 - 69.0) / 12.0);
        let (from, to) = (((at + 0.06) * sr) as usize, ((at + 0.14) * sr) as usize);
        let hz = crossing_hz(&render.samples[from..to], sr)
            .unwrap_or_else(|| panic!("nothing plays after the note at {at} s"));
        let cents = 1200.0 * (hz / want).log2();
        report.push(format!("{at:.2}s midi {note}: {cents:+.1}c"));
        errors.push(cents.abs());
    }
    let report = report.join(", ");
    assert_eq!(errors.len(), 14);
    errors.sort_by(f64::total_cmp);
    let (median, worst) = (errors[errors.len() / 2], errors[errors.len() - 1]);
    assert!(
        worst < NOTE_CENTS,
        "a tracked note strays {worst:.1} cents: {report}"
    );
    assert!(
        median < TYPICAL_CENTS,
        "the typical tracked note strays {median:.1} cents: {report}"
    );
}

/// **A TRACK's chord voice is gate-synced with its note and starts on the
/// tracked pitch.** The standard phrase rendered with its dyad and without
/// it differs only by the chord voice. That difference is exactly silent
/// before the dyad's onset and silent again once its key is up (the
/// tracker's gate keeps only the main voice open), and from its first
/// frame it sings the note the main voice is tracking (G3, the figure's
/// note at 2.25 s), with no C4 while a cold tracker would settle.
#[test]
fn a_tracks_chord_voice_starts_on_the_tracked_note_and_stops_with_its_key() {
    use auracle_grammar::term::{PitchBand, Waveform};
    use auracle_grammar::{ModNode, TRACK_SENSITIVITY_DEFAULT};
    let tree = PatchTree {
        amp: AmpEnv {
            attack: 0.0,
            decay: 0.2,
            sustain: PARAM_MAX,
            release: 0.4,
        },
        root: AudioNode::Track {
            uid: Uid::NEW,
            band: PitchBand::Mid,
            sensitivity: TRACK_SENSITIVITY_DEFAULT,
            dynamics: 0.0,
            input: Box::new(AudioNode::Vco {
                uid: Uid::NEW,
                wave: Waveform::Sine,
                octave: 0,
                detune: 0.5,
                mod_depth: 0.0,
                modulation: ModNode::None,
            }),
            listen: Box::new(AudioNode::AudioIn {
                uid: Uid::NEW,
                input: 0,
                gain: INPUT_GAIN_UNITY,
                channel: InputChannel::Both,
            }),
        },
    };
    let with = PhraseSpec::default();
    let mut without = with.clone();
    let dyad = without
        .notes
        .iter()
        .position(|n| !n.chord.is_empty())
        .expect("the standard phrase has a dyad");
    without.notes[dyad].chord.clear();
    let a = render_phrase(&tree, &with).unwrap();
    let b = render_phrase(&tree, &without).unwrap();
    let sr = with.sample_rate;
    let onset: f64 = with.notes[..dyad].iter().map(|n| n.on_s + n.off_s).sum();
    let off = onset + with.notes[dyad].on_s;
    let chord: Vec<f64> = a
        .samples
        .iter()
        .zip(&b.samples)
        .map(|(x, y)| x - y)
        .collect();
    let at = |t: f64| (t * sr) as usize;
    assert!(
        chord[..at(onset)].iter().all(|d| *d == 0.0),
        "the dyad changed the render before it began"
    );
    let after = chord[at(off + 0.3)..]
        .iter()
        .fold(0.0f64, |m, d| m.max(d.abs()));
    assert!(
        after < 1e-6,
        "the chord voice still sounds after its key is up ({after:.2e})"
    );
    let first = &chord[at(onset)..at(onset + 0.03)];
    let hz = crossing_hz(first, sr).expect("the chord voice sounds at once");
    let cents_from_g3 = 1200.0 * (hz / 195.997_717_99).log2();
    assert!(
        cents_from_g3.abs() < 30.0,
        "the chord voice starts at {hz:.1} Hz, not the tracked G3"
    );
}

/// A follower on a source now compiles to a follower with nothing on its
/// input (so its knobs have live handles) instead of to nothing. The cable
/// it drives carries exactly 0 V, and this pins that the render is
/// **bit-identical** to the same oscillator with an empty slot — which is
/// what lets the change ship without a `RENDER_EPOCH` bump.
#[test]
fn a_follower_on_a_source_changes_no_sample() {
    let mut bare = vco(Waveform::Saw);
    if let AudioNode::Vco { mod_depth, .. } = &mut bare.root {
        *mod_depth = 0.8;
    }
    let mut followed = bare.clone();
    if let AudioNode::Vco { modulation, .. } = &mut followed.root {
        *modulation = ModNode::Follow {
            uid: Uid::NEW,
            sens: 0.6,
            release: 0.4,
        };
    }
    let spec = PhraseSpec::default();
    let a = render_phrase(&bare, &spec).expect("renders");
    let b = render_phrase(&followed, &spec).expect("renders");
    assert_eq!(a.samples.len(), b.samples.len());
    assert!(
        a.samples
            .iter()
            .zip(&b.samples)
            .all(|(x, y)| x.to_bits() == y.to_bits()),
        "a follower with nothing to follow moved a sample"
    );
}

/// The chord note really is a second voice: the render is bit-identical
/// up to the chord onset, diverges inside it, carries ~2× the energy of
/// the mono render there, and the chord feature goes live exactly (and
/// only) when the phrase has a chord.
#[test]
fn chord_segment_stacks_a_second_voice() {
    let spec = PhraseSpec::default();
    assert_eq!(spec.max_voices(), 2);
    let mut mono = spec.clone();
    for n in &mut mono.notes {
        n.chord.clear();
    }
    let tree = vco(Waveform::Saw);
    let poly_r = render_phrase(&tree, &spec).unwrap();
    let mono_r = render_phrase(&tree, &mono).unwrap();
    let chord = poly_r
        .spans
        .iter()
        .find(|s| s.chord > 0)
        .expect("chord span");
    assert_eq!(
        poly_r.samples[..chord.on_start],
        mono_r.samples[..chord.on_start],
        "chord voice leaked ahead of its onset"
    );
    assert_ne!(
        poly_r.samples[chord.on_start..chord.on_end],
        mono_r.samples[chord.on_start..chord.on_end],
        "chord segment is not polyphonic"
    );
    let energy = |s: &[f64]| s.iter().map(|x| x * x).sum::<f64>();
    let ratio = energy(&poly_r.samples[chord.on_start..chord.on_end])
        / energy(&mono_r.samples[chord.on_start..chord.on_end]);
    assert!(
        (1.4..=3.0).contains(&ratio),
        "dyad energy ratio {ratio:.2} outside the plausible band"
    );
    let poly_f = featurize(&tree, &spec).unwrap().features.audio;
    let mono_f = featurize(&tree, &mono).unwrap().features.audio;
    assert_ne!(poly_f.chord_flatness_delta, 0.0);
    assert_eq!(
        mono_f.chord_flatness_delta, 0.0,
        "chord feature must read 'no evidence' without a chord"
    );
}

/// **A chord voice still ringing keeps its tail into the next chord.** Two
/// chord notes back to back, the first one's voice released only 50 ms
/// before the second's onset: rendered with and without the first chord,
/// the difference is that voice alone, and it is still sounding after the
/// second chord starts (a voice retired at the new onset would cut it
/// there). After a rest long enough for it to fall silent, it is parked and
/// retired, and the second chord is exactly what it would have been.
#[test]
fn a_ringing_chord_voice_keeps_its_tail_into_the_next_chord() {
    let tree = PatchTree {
        amp: AmpEnv {
            release: 0.6,
            ..crate::tests::amp()
        },
        root: vco(Waveform::Saw).root,
    };
    let render = |first_chord: &[f64], rest: f64| {
        let spec = PhraseSpec {
            notes: vec![
                Note {
                    voct: 0.0,
                    on_s: 0.3,
                    off_s: rest,
                    chord: first_chord.to_vec(),
                },
                Note {
                    voct: 0.0,
                    on_s: 0.3,
                    off_s: 0.3,
                    chord: vec![7.0 / 12.0],
                },
            ],
            ..PhraseSpec::default()
        };
        let r = render_phrase(&tree, &spec).expect("renders");
        (r.samples, r.spans[1].on_start, spec.sample_rate)
    };
    let tail = |rest: f64| {
        let (with, onset, sr) = render(&[4.0 / 12.0], rest);
        let (without, _, _) = render(&[], rest);
        let diff: Vec<f64> = with.iter().zip(&without).map(|(a, b)| a - b).collect();
        let window = &diff[onset..onset + (0.02 * sr) as usize];
        window.iter().fold(0.0f64, |m, d| m.max(d.abs()))
    };
    let ringing = tail(0.05);
    assert!(
        ringing > 1e-3,
        "the first chord's tail was cut at the next onset ({ringing:.2e})"
    );
    let parked = tail(2.0);
    assert_eq!(parked, 0.0, "a parked chord voice still sounded");
}

/// **A measurement render plays what the instrument's voices play, bit for
/// bit** (#298). A render's voices are compiled with their live knobs folded
/// into the ports they drive (`Build::Folded`); here each tree is rendered
/// again with every knob live (`Build::Live`) on the standard phrase, whose
/// dyad compiles a chord voice mid-render, and the samples, the onsets and
/// the spans are the same. Over what only a render exercises: a TRACK in
/// each band, whose dyad is a follower fed by the main voice through
/// `CompiledVoice::lead` every frame; an AUDIO IN and a CAPTURE playing a
/// take, on the audition clip; the tree whose fold is refused (two plucked
/// strings, one under an LFO, which would draw each other's noise if
/// folded); and two presets as they are.
#[test]
fn a_folded_render_is_the_live_render() {
    use auracle_grammar::term::{CaptureMode, PitchBand};
    use auracle_grammar::{Take, TRACK_SENSITIVITY_DEFAULT};
    let spec = PhraseSpec::default();
    let presets: Vec<PatchTree> = auracle_grammar::presets()
        .into_iter()
        .map(|(_, t)| t)
        .take(3)
        .collect();
    let input = || AudioNode::AudioIn {
        uid: Uid::NEW,
        input: 0,
        gain: INPUT_GAIN_UNITY,
        channel: InputChannel::Both,
    };
    let around = |root: AudioNode| PatchTree {
        amp: presets[0].amp.clone(),
        root,
    };
    let mix = |a: AudioNode, b: AudioNode| AudioNode::Mix {
        uid: Uid::NEW,
        balance: 0.5,
        a: Box::new(a),
        b: Box::new(b),
    };
    let tone: Vec<f32> = (0..4_000)
        .map(|i| {
            (0.3 + 0.5 * (i as f64 * 330.0 * std::f64::consts::TAU / spec.sample_rate).sin()) as f32
        })
        .collect();
    let take = Take::from_samples(&tone, spec.sample_rate).expect("a take");
    let string = |modulation| AudioNode::Pluck {
        uid: Uid::NEW,
        octave: 0,
        damping: 0.4,
        brightness: 0.6,
        mod_depth: 0.5,
        modulation,
    };
    let mut trees: Vec<(String, PatchTree)> = Vec::new();
    for (band, preset) in [PitchBand::Low, PitchBand::Mid, PitchBand::High]
        .into_iter()
        .zip(&presets)
    {
        let mut t = preset.clone();
        t.root = AudioNode::Track {
            uid: Uid::NEW,
            band,
            sensitivity: TRACK_SENSITIVITY_DEFAULT,
            dynamics: 0.5,
            input: Box::new(preset.root.clone()),
            listen: Box::new(input()),
        };
        trees.push((format!("TRACK {band:?}"), t));
    }
    trees.push((
        "AUDIO IN".to_string(),
        around(mix(presets[1].root.clone(), input())),
    ));
    trees.push((
        "CAPTURE".to_string(),
        around(mix(
            presets[2].root.clone(),
            AudioNode::Capture {
                uid: Uid::NEW,
                play: CaptureMode::Loop,
                input: Box::new(input()),
                take,
            },
        )),
    ));
    trees.push((
        "two strings".to_string(),
        around(mix(
            string(ModNode::Lfo {
                wave: Waveform::Sine,
                rate: 0.3,
                uid: Uid::NEW,
            }),
            string(ModNode::None),
        )),
    ));
    trees.push(("a preset".to_string(), presets[0].clone()));
    trees.push(("another".to_string(), presets[1].clone()));
    let spans = |r: &RenderedPhrase| -> Vec<(u64, usize, usize, usize)> {
        r.spans
            .iter()
            .map(|s| (s.voct.to_bits(), s.chord, s.on_start, s.on_end))
            .collect()
    };
    // Each tree on a thread of its own: quiver's stream is a thread's, and a
    // render seeds it before it compiles.
    let rendered: Vec<(String, RenderedPhrase, RenderedPhrase)> = std::thread::scope(|s| {
        let handles: Vec<_> = trees
            .iter()
            .map(|(name, tree)| {
                let spec = &spec;
                s.spawn(move || {
                    let folded = render_built(tree, spec, &mut (), Build::Folded);
                    let live = render_built(tree, spec, &mut (), Build::Live);
                    (
                        name.clone(),
                        folded.expect("renders"),
                        live.expect("renders"),
                    )
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().expect("renders"))
            .collect()
    });
    for (name, folded, live) in &rendered {
        let bits = |r: &RenderedPhrase| r.samples.iter().map(|x| x.to_bits()).collect::<Vec<_>>();
        assert!(bits(folded) == bits(live), "{name}: other samples");
        assert_eq!(folded.note_onsets, live.note_onsets, "{name}");
        assert_eq!(spans(folded), spans(live), "{name}");
        assert!(
            folded.samples.iter().any(|x| x.abs() > 1e-3),
            "{name}: silent, so the comparison proves nothing"
        );
    }
}

/// An observer that reads nothing but counts the frames it is shown: a
/// render it watches walks a tick per frame (`VoiceObserver::BLIND` is
/// false), so beside [`render_phrase`] it is the frame walk the block walk
/// must equal.
struct Frames(usize);

impl VoiceObserver for Frames {
    fn start(&mut self, _: &CompiledVoice) {}
    fn tick(&mut self, _: &CompiledVoice) {
        self.0 += 1;
    }
}

/// The trees beside the presets that a block walk must get right: chord
/// voices that draw quiver's thread-wide stream (noise, a plucked string, a
/// random modulation), a TRACK whose dyad is a follower led frame by frame
/// (on an internal source, so the render is not one that listens), a grain
/// cloud over a saw (its own seeded stream), and a long release whose dyad voice parks
/// inside a block.
fn walk_trees() -> Vec<(&'static str, PatchTree)> {
    use auracle_grammar::term::{NoiseColor, PitchBand};
    use auracle_grammar::TRACK_SENSITIVITY_DEFAULT;
    let around = |root: AudioNode| PatchTree {
        amp: crate::tests::amp(),
        root,
    };
    let saw = || vco(Waveform::Saw).root;
    let noise = || AudioNode::Noise {
        color: NoiseColor::Pink,
        uid: Uid::NEW,
    };
    let rand = || ModNode::Rand {
        rate: 0.7,
        glide: 0.2,
        uid: Uid::NEW,
    };
    vec![
        ("noise", around(noise())),
        (
            "a string",
            around(AudioNode::Pluck {
                uid: Uid::NEW,
                octave: 0,
                damping: 0.4,
                brightness: 0.6,
                mod_depth: 0.5,
                modulation: rand(),
            }),
        ),
        (
            "a random wobble",
            around(AudioNode::Vco {
                uid: Uid::NEW,
                wave: Waveform::Square,
                octave: 0,
                detune: 0.5,
                mod_depth: 0.6,
                modulation: rand(),
            }),
        ),
        (
            "TRACK",
            around(AudioNode::Track {
                uid: Uid::NEW,
                band: PitchBand::Mid,
                sensitivity: TRACK_SENSITIVITY_DEFAULT,
                dynamics: 0.5,
                input: Box::new(saw()),
                listen: Box::new(vco(Waveform::Sine).root),
            }),
        ),
        (
            "grains",
            around(AudioNode::Granular {
                position: 0.3,
                size: 0.4,
                density: 0.6,
                mod_depth: 0.2,
                input: Box::new(saw()),
                modulation: ModNode::None,
                uid: Uid::NEW,
            }),
        ),
        (
            "a long release",
            PatchTree {
                amp: AmpEnv {
                    release: 0.6,
                    ..crate::tests::amp()
                },
                root: saw(),
            },
        ),
    ]
}

/// **A render in blocks is the render a tick per frame gives, bit for bit**
/// (#397). Every preset and each of [`walk_trees`] is rendered on the
/// standard phrase, whose dyad compiles a chord voice mid-render that parks
/// in the low note's release, once as [`render_phrase`] renders it (in
/// blocks, or in blocks while no coupled chord voice rings) and once watched
/// (a tick per frame, every frame shown to the observer): the samples, the
/// onsets and the spans are the same. This fails if a chord voice that draws
/// the shared random stream, or follows a TRACK, ran in blocks beside the
/// main voice, if a parked voice's tail past its park point were summed, or
/// if a watched render skipped a frame.
#[test]
fn a_block_walk_is_the_frame_walk() {
    let spec = PhraseSpec::default();
    let mut trees: Vec<(String, PatchTree)> = auracle_grammar::presets()
        .into_iter()
        .map(|(name, t)| (name.to_string(), t))
        .collect();
    trees.extend(walk_trees().into_iter().map(|(n, t)| (n.to_string(), t)));
    let bits = |r: &RenderedPhrase| r.samples.iter().map(|x| x.to_bits()).collect::<Vec<_>>();
    // A thread per worker, the trees dealt round: quiver's stream is a
    // thread's, and a render seeds it before it compiles.
    let workers = 4;
    std::thread::scope(|s| {
        for w in 0..workers {
            let (trees, spec) = (&trees, &spec);
            s.spawn(move || {
                for (name, tree) in trees.iter().skip(w).step_by(workers) {
                    let blocks = render_phrase(tree, spec).expect("renders");
                    let mut frames = Frames(0);
                    let walked = render_phrase_observed(tree, spec, &mut frames).expect("renders");
                    assert!(bits(&blocks) == bits(&walked), "{name}: other samples");
                    assert_eq!(blocks.note_onsets, walked.note_onsets, "{name}");
                    assert_eq!(frames.0, walked.samples.len(), "{name}: a frame unseen");
                    assert!(
                        blocks.samples.iter().any(|x| x.abs() > 1e-3),
                        "{name}: silent, so the comparison proves nothing"
                    );
                }
            });
        }
    });
}

/// **A render walks frames only where a voice reads what another changes**:
/// a render that may not walk blocks (watched, or listening) walks frames;
/// one whose chord voices would draw the shared random stream or follow a
/// TRACK walks blocks only while they are parked; any other walks blocks.
/// The grains seed their own stream, so they draw nothing another voice
/// reads.
#[test]
fn the_walk_couples_only_voices_that_share_state() {
    let walk_of = |tree: &PatchTree, blocks: bool| {
        let voice = Build::Folded
            .voice(tree, 44_100.0, None, false)
            .expect("compiles");
        Walk::of(&voice, blocks)
    };
    for (name, tree) in walk_trees() {
        let alone = matches!(name, "noise" | "a string" | "a random wobble" | "TRACK");
        let want = if alone {
            Walk::BlocksAlone
        } else {
            Walk::Blocks
        };
        assert_eq!(walk_of(&tree, true), want, "{name}");
        assert_eq!(walk_of(&tree, false), Walk::Frames, "{name}");
    }
}

/// **A released chord voice parks after [`PARK_RUN`] quiet samples in a
/// row**, not one sooner; a sample at or over [`PARK_ABS`] starts the count
/// again, and a held voice never parks, however quiet (a slow attack).
#[test]
fn a_released_voice_parks_after_a_quiet_run() {
    let tree = vco(Waveform::Saw);
    let voice = Build::Folded
        .voice(&tree, 44_100.0, None, false)
        .expect("compiles");
    let mut cv = ChordVoice {
        voice,
        quiet_run: 0,
        parked: false,
        gated: true,
    };
    for _ in 0..2 * PARK_RUN {
        assert!(!cv.heard(0.0), "a held voice parked");
    }
    assert_eq!(cv.quiet_run, 0);
    cv.gated = false;
    for _ in 0..PARK_RUN - 1 {
        assert!(!cv.heard(PARK_ABS / 2.0));
    }
    assert!(
        !cv.heard(PARK_ABS),
        "a sample at the threshold is not quiet"
    );
    assert_eq!(cv.quiet_run, 0);
    for _ in 0..PARK_RUN - 1 {
        assert!(!cv.heard(-PARK_ABS / 2.0));
    }
    assert!(cv.heard(0.0), "the run's last quiet sample parks it");
    assert!(cv.parked);
}
