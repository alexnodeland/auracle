use super::*;

fn tone(frames: usize, channels: usize, rate: f64) -> Vec<f32> {
    (0..frames * channels)
        .map(|i| {
            let f = (i / channels) as f64;
            let c = (i % channels) as f64;
            (0.3 * ((f * 330.0 * (1.0 + c)) / rate * std::f64::consts::TAU).sin()) as f32
        })
        .collect()
}

/// A clip survives its saved form bit for bit, id included, and the saved
/// form is the 16-bit size, not the float one.
#[test]
fn a_clip_round_trips_through_its_saved_form() {
    let spec = PhraseSpec::default();
    let clip = AuditionClip::from_interleaved(&tone(44_100, 2, 48_000.0), 2, 48_000.0, &spec)
        .expect("a stereo capture");
    assert_eq!(clip.channel_count(), 2);
    assert_eq!(clip.sample_rate(), spec.sample_rate);
    // 44 100 frames at 48 kHz is 40 516 at 44.1 kHz.
    assert_eq!(clip.frames(), 40_516);
    let saved = clip.to_saved();
    assert_eq!(saved.data.len(), (clip.frames() * 2 * 2).div_ceil(3) * 4);
    let back = AuditionClip::from_saved(&saved).unwrap();
    assert_eq!(back.id(), clip.id());
    assert_eq!(back.planar(), clip.planar());
    let json = serde_json::to_string(&clip).unwrap();
    let again: AuditionClip = serde_json::from_str(&json).unwrap();
    assert_eq!(again.planar(), clip.planar());
    assert_eq!(again.source(), ClipSource::Captured);
}

/// A debug print of anything that carries a clip (a phrase, a session
/// config, a walk context) names the clip and does not dump its samples.
#[test]
fn a_debug_print_names_the_clip_and_does_not_dump_it() {
    let spec = PhraseSpec::default();
    let clip = AuditionClip::from_interleaved(&tone(44_100, 2, 48_000.0), 2, 48_000.0, &spec)
        .expect("a stereo capture");
    let printed = format!(
        "{:?}",
        PhraseSpec {
            clip: Some(clip.clone()),
            ..spec.clone()
        }
    );
    assert!(printed.contains(clip.id()), "{printed}");
    assert!(printed.len() < 2_000, "{} bytes", printed.len());
}

/// A capture longer than the phrase is cut to it: nothing past the
/// phrase is ever read, so nothing past it is stored.
#[test]
fn a_long_capture_is_cut_to_the_phrase() {
    let spec = PhraseSpec::default();
    let long = tone(spec.total_samples() * 2, 1, spec.sample_rate);
    let clip = AuditionClip::from_interleaved(&long, 1, spec.sample_rate, &spec).unwrap();
    assert_eq!(clip.frames(), spec.total_samples());
}

/// The bound: every way a saved clip can lie is refused, and a claim of
/// a huge clip is refused before anything is decoded.
#[test]
fn a_saved_clip_is_held_to_its_bound() {
    let spec = PhraseSpec::default();
    let good = AuditionClip::from_interleaved(&tone(1000, 1, 44_100.0), 1, 44_100.0, &spec)
        .unwrap()
        .to_saved();
    let refused = |f: &dyn Fn(&mut SavedClip), want: fn(&ClipError) -> bool| {
        let mut s = good.clone();
        f(&mut s);
        let err = AuditionClip::from_saved(&s).expect_err("refused");
        assert!(want(&err), "wrong refusal: {err}");
    };
    refused(&|s| s.format = "f32le-base64".into(), |e| {
        *e == ClipError::Format
    });
    refused(&|s| s.sample_rate = f64::NAN, |e| {
        matches!(e, ClipError::Rate(_))
    });
    refused(&|s| s.sample_rate = 1e9, |e| {
        matches!(e, ClipError::Rate(_))
    });
    refused(&|s| s.channels = 3, |e| *e == ClipError::Channels(3));
    refused(&|s| s.frames = 0, |e| *e == ClipError::Empty);
    refused(&|s| s.frames = 999, |e| *e == ClipError::Data(999));
    refused(&|s| s.data.replace_range(0..4, "!!!!"), |e| {
        matches!(e, ClipError::Data(_))
    });
    // Nine seconds claimed: refused on the claim, before the data.
    refused(&|s| s.frames = (9.0 * 44_100.0) as usize, |e| {
        matches!(e, ClipError::TooLong { .. })
    });
    assert!(AuditionClip::from_saved(&good).is_ok());
    // And in a stimulus: a phrase carrying a bad clip does not parse.
    let mut v = serde_json::to_value(PhraseSpec::default()).unwrap();
    let mut bad = serde_json::to_value(&good).unwrap();
    bad["channels"] = 5.into();
    v["clip"] = bad;
    assert!(serde_json::from_value::<PhraseSpec>(v).is_err());
}

/// A clip made from samples that are not numbers is refused, not silently
/// zeroed: a broken capture should be heard about. So is an empty one, and
/// a silent one, which every patch that listens would fail the vet over.
#[test]
fn a_capture_with_a_non_finite_sample_is_refused() {
    let spec = PhraseSpec::default();
    let mut x = tone(100, 1, 44_100.0);
    x[50] = f32::NAN;
    assert_eq!(
        AuditionClip::from_interleaved(&x, 1, 44_100.0, &spec),
        Err(ClipError::NonFinite)
    );
    assert_eq!(
        AuditionClip::from_interleaved(&x[..0], 1, 44_100.0, &spec),
        Err(ClipError::Empty)
    );
    assert!(matches!(
        AuditionClip::from_interleaved(&[0.0; 4410], 1, 44_100.0, &spec),
        Err(ClipError::Silent { .. })
    ));
}

/// The reference is deterministic, the phrase's length, peaks where it
/// says, is mono, and has what it is for: transients and a final rest.
#[test]
fn the_reference_is_what_it_says() {
    let spec = PhraseSpec::default();
    let a = synthesize_reference(spec.sample_rate, spec.total_samples());
    let b = reference(&spec);
    assert_eq!(a.id(), b.id(), "two builds of the reference differ");
    assert_eq!(a.planar(), b.planar());
    assert_eq!((a.channel_count(), a.frames()), (1, spec.total_samples()));
    assert_eq!(a.source(), ClipSource::Reference);
    let x = &a.planar()[0];
    let peak = x.iter().fold(0.0f32, |m, s| m.max(s.abs())) as f64;
    assert!((peak - REFERENCE_PEAK).abs() < 1e-3, "peak {peak}");
    let rms = |r: std::ops::Range<f64>| {
        let e = ((r.end * spec.sample_rate) as usize).min(x.len());
        let s = (r.start * spec.sample_rate) as usize;
        (x[s..e].iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / (e - s) as f64).sqrt()
    };
    // Every onset is a transient: the first 5 ms after it are far louder
    // than the 5 ms before it.
    for p in &FIGURE[1..] {
        let before = rms(p.at - 0.005..p.at);
        let after = rms(p.at..p.at + 0.005);
        assert!(after > 3.0 * before, "no transient at {} s", p.at);
    }
    // The last 300 ms, the phrase's tail window, are nearly quiet.
    let end = spec.total_seconds();
    let (tail, body) = (rms(end - 0.3..end), rms(0.0..0.5));
    assert!(
        tail < 0.01 * body,
        "the tail window is not quiet: {tail:.5} against {body:.5}"
    );
}
