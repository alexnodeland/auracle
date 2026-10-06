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
    // In seconds, the phrase's length (each note rounds down to a whole
    // sample, so within a sample a note).
    let slack = spec.notes.len() as f64 / spec.sample_rate;
    assert!(
        (clip.seconds() - spec.total_seconds()).abs() <= slack,
        "{} s against the phrase's {} s",
        clip.seconds(),
        spec.total_seconds()
    );
    // And never past MAX_CLIP_SECONDS, however long the phrase.
    let long_phrase = PhraseSpec {
        notes: vec![crate::phrase::Note {
            voct: 0.0,
            on_s: 10.0,
            off_s: 1.0,
            chord: Vec::new(),
        }],
        ..PhraseSpec::default()
    };
    let twelve = tone((12.0 * spec.sample_rate) as usize, 1, spec.sample_rate);
    let clip = AuditionClip::from_interleaved(&twelve, 1, spec.sample_rate, &long_phrase).unwrap();
    assert_eq!(clip.seconds(), MAX_CLIP_SECONDS);
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
    // The right length of text that decodes to the wrong number of bytes:
    // the last quad's padding dropped, so it holds one byte too many.
    refused(
        &|s| {
            assert!(s.data.ends_with('='));
            s.data.pop();
            s.data.push('A');
        },
        |e| *e == ClipError::Data(1000),
    );
    // Padding before the end, and three of it at the end.
    refused(&|s| s.data.replace_range(0..4, "AA=="), |e| {
        *e == ClipError::Data(1000)
    });
    refused(
        &|s| {
            let n = s.data.len();
            s.data.replace_range(n - 4.., "A===");
        },
        |e| *e == ClipError::Data(1000),
    );
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

/// A capture of no channels or of three, or at a rate no clip can have, is
/// refused before anything is read.
#[test]
fn a_capture_of_the_wrong_shape_is_refused() {
    let spec = PhraseSpec::default();
    let x = tone(100, 1, 44_100.0);
    for channels in [0, 3] {
        assert_eq!(
            AuditionClip::from_interleaved(&x, channels, 44_100.0, &spec),
            Err(ClipError::Channels(channels))
        );
    }
    for rate in [0.0, f64::NAN, MAX_CLIP_RATE * 2.0] {
        assert!(matches!(
            AuditionClip::from_interleaved(&x, 1, rate, &spec),
            Err(ClipError::Rate(_))
        ));
    }
}

/// A clip is its content: two captures of the same samples are the same
/// clip, its saved form loads as the same clip, and one sample changed is
/// another clip.
#[test]
fn a_clip_is_its_content() {
    let spec = PhraseSpec::default();
    let x = tone(1000, 1, 44_100.0);
    let a = AuditionClip::from_interleaved(&x, 1, 44_100.0, &spec).unwrap();
    let b = AuditionClip::from_interleaved(&x, 1, 44_100.0, &spec).unwrap();
    assert_eq!(a, b);
    assert_eq!(AuditionClip::from_saved(&a.to_saved()).unwrap(), a);
    let mut y = x.clone();
    y[500] += 0.01;
    let c = AuditionClip::from_interleaved(&y, 1, 44_100.0, &spec).unwrap();
    assert_ne!(a, c);
    assert_ne!(a.id(), c.id());
}

/// Where a clip came from survives its saved form, and a saved form written
/// before clips said where they came from reads as captured: only a capture
/// was ever saved then.
#[test]
fn a_saved_clip_says_where_it_came_from() {
    let spec = PhraseSpec::default();
    let reference = reference(&spec);
    let back = AuditionClip::from_saved(&reference.to_saved()).unwrap();
    assert_eq!(back.source(), ClipSource::Reference);

    let capture = AuditionClip::from_interleaved(&tone(1000, 1, 44_100.0), 1, 44_100.0, &spec)
        .unwrap()
        .to_saved();
    let mut old = serde_json::to_value(&capture).unwrap();
    old.as_object_mut().unwrap().remove("source");
    let old: SavedClip = serde_json::from_value(old).unwrap();
    assert_eq!(old.source, ClipSource::Captured);
    assert_eq!(old, capture);
}

/// A clip saved at another rate is heard at the phrase's: the same length in
/// seconds, the same pitch, on the 16-bit grid, from the same source. At the
/// phrase's own rate it is the clip itself.
#[test]
fn a_clip_at_another_rate_is_heard_at_the_phrases() {
    let at_48k = PhraseSpec {
        sample_rate: 48_000.0,
        ..PhraseSpec::default()
    };
    let clip =
        AuditionClip::from_interleaved(&tone(48_000, 1, 48_000.0), 1, 48_000.0, &at_48k).unwrap();
    assert_eq!(clip.at_rate(48_000.0).id(), clip.id());

    let spec = PhraseSpec {
        clip: Some(clip.clone()),
        ..PhraseSpec::default()
    };
    let heard = spec.audition_clip();
    assert_eq!(heard.sample_rate(), spec.sample_rate);
    assert_eq!(heard.frames(), 44_100);
    assert_eq!(heard.source(), clip.source());
    assert_ne!(heard.id(), clip.id(), "another rate is another clip");
    let x = &heard.planar()[0];
    assert!(
        x.iter().all(|s| (s * 32_768.0).fract() == 0.0),
        "a resampled clip is quantized again"
    );
    // 330 Hz for one second: 660 crossings of zero, give or take the ends.
    let crossings = x
        .windows(2)
        .filter(|w| (w[0] < 0.0) != (w[1] < 0.0))
        .count();
    assert!((655..=665).contains(&crossings), "{crossings} crossings");
}

/// The references are built once for each rate and length and shared, and
/// the list of them stays bounded however many rates a process meets; one
/// that aged out is built again, the same clip.
#[test]
fn references_are_shared_and_bounded() {
    let at = |sr: f64| PhraseSpec {
        sample_rate: sr,
        ..PhraseSpec::default()
    };
    let rates: Vec<f64> = (0..REFERENCES_KEPT + 3)
        .map(|k| 20_000.0 + 1_000.0 * k as f64)
        .collect();
    let first = reference(&at(rates[0]));
    for &sr in &rates {
        let clip = reference(&at(sr));
        let again = reference(&at(sr));
        assert!(
            Arc::ptr_eq(&clip.channels, &again.channels),
            "{sr} Hz was built twice"
        );
        let kept = REFERENCES.lock().unwrap_or_else(|e| e.into_inner()).len();
        assert!(kept <= REFERENCES_KEPT, "{kept} references kept");
    }
    assert_eq!(reference(&at(rates[0])), first);
}

/// A panic while the list of references was held (another render's, on
/// another thread) does not take the reference down with it: the lock is
/// poisoned, and the next render still gets its clip.
///
/// The rule in crates/AGENTS.md § Coverage: a lock's poisoned-recovery
/// closure is covered by a test that poisons that lock on purpose, here the
/// static itself. It stays poisoned for the rest of a `cargo test` process,
/// so every caller (`reference`, and `references_are_shared_and_bounded`'s
/// read of the list) recovers through `into_inner`, and no test may assert
/// the lock is unpoisoned.
#[test]
fn a_poisoned_reference_list_still_serves_the_reference() {
    let spec = PhraseSpec::default();
    let want = synthesize_reference(spec.sample_rate, spec.total_samples());
    let _ = std::thread::spawn(|| {
        let _held = REFERENCES.lock();
        panic!("a render panicked while it held the reference list (on purpose)");
    })
    .join();
    assert!(REFERENCES.is_poisoned());
    assert_eq!(reference(&spec), want);
}

/// A phrase shorter than the figure hears the figure's opening: the notes
/// that start inside it, scaled to the reference's peak, and nothing of the
/// notes after it.
#[test]
fn a_short_phrase_hears_the_figures_opening() {
    let short = PhraseSpec {
        notes: vec![crate::phrase::Note {
            voct: 0.0,
            on_s: 0.6,
            off_s: 0.2,
            chord: Vec::new(),
        }],
        ..PhraseSpec::default()
    };
    let clip = reference(&short);
    assert_eq!(clip.frames(), short.total_samples());
    let x = &clip.planar()[0];
    let peak = x.iter().fold(0.0f32, |m, s| m.max(s.abs())) as f64;
    assert!((peak - REFERENCE_PEAK).abs() < 1e-3, "peak {peak}");
    // The same shape as the full figure's first 0.8 s, sample for sample.
    let full = reference(&PhraseSpec::default());
    let y = &full.planar()[0][..x.len()];
    let dot = |a: &[f32], b: &[f32]| {
        a.iter()
            .zip(b)
            .map(|(p, q)| *p as f64 * *q as f64)
            .sum::<f64>()
    };
    let r = dot(x, y) / (dot(x, x) * dot(y, y)).sqrt();
    assert!(r > 0.9999, "the opening is not the figure's: r = {r}");
}

/// The saved form's base64 is strict: whole quads, at most two pads and only
/// at the end, and only the standard alphabet. Anything else is no data at
/// all, never a guess.
#[test]
fn the_saved_forms_base64_is_strict() {
    for n in 0..8 {
        let bytes: Vec<u8> = (0..n).map(|i| (i * 37 + 11) as u8).collect();
        assert_eq!(base64::decode(&base64::encode(&bytes)), Some(bytes));
    }
    // RFC 4648's own vectors.
    assert_eq!(base64::encode(b"fo"), "Zm8=");
    assert_eq!(base64::encode(b"foobar"), "Zm9vYmFy");
    for bad in ["A", "AAA", "AAAAA", "A===", "AA==AAAA", "AA!A"] {
        assert_eq!(base64::decode(bad), None, "{bad:?} decoded");
    }
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
