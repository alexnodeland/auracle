use super::*;
use crate::render::render_playback;
use auracle_grammar::term::{AmpEnv, AudioNode, Uid, Waveform};

fn tree(detune: f64) -> PatchTree {
    PatchTree {
        amp: AmpEnv {
            attack: 0.05,
            decay: 0.3,
            sustain: 0.8,
            release: 0.3,
        },
        root: AudioNode::Vco {
            uid: Uid::NEW,
            wave: Waveform::Saw,
            octave: 0,
            detune,
            mod_depth: 0.0,
            modulation: auracle_grammar::term::ModNode::None,
        },
    }
}

/// The whole contract: a hit is indistinguishable from a miss.
#[test]
fn memo_hit_equals_fresh_featurize() {
    let spec = PhraseSpec::default();
    let memo = RenderMemo::default();
    let t = tree(0.5);
    let fresh = featurize(&t, &spec).unwrap();
    let (miss, _) = featurize_memo(&t, &spec, &memo, true).unwrap();
    let (hit, _) = featurize_memo(&t, &spec, &memo, true).unwrap();
    assert_eq!(fresh.features.phi(), miss.features.phi());
    assert_eq!(fresh.features.phi(), hit.features.phi());
    assert_eq!(fresh.features.gain_db, hit.features.gain_db);
    assert_eq!(fresh.features.lufs_before, hit.features.lufs_before);
    assert_eq!(fresh.render.note_onsets, hit.note_onsets);
    assert_eq!(fresh.render.samples.len(), hit.n_samples);
    // The face rides with the row: the same picture on a hit, and the
    // picture of the render φ was measured on.
    let face = Face::of_f64(&fresh.render.samples, fresh.render.sample_rate);
    assert_eq!(miss.face.as_ref(), Some(&face));
    assert_eq!(hit.face.as_ref(), Some(&face));
    let s = memo.stats();
    assert_eq!((s.hits, s.misses), (1, 1), "second call must not render");
}

/// Keys separate distinct terms and distinct stimuli, and are stable.
#[test]
fn keys_are_content_addressed() {
    let spec = PhraseSpec::default();
    assert_eq!(render_key(&tree(0.5), &spec), render_key(&tree(0.5), &spec));
    assert_ne!(render_key(&tree(0.5), &spec), render_key(&tree(0.6), &spec));
    let other = PhraseSpec {
        seed: spec.seed ^ 1,
        ..spec.clone()
    };
    assert_ne!(
        render_key(&tree(0.5), &spec),
        render_key(&tree(0.5), &other),
        "a different stimulus is a different φ"
    );
    assert_eq!(render_key(&tree(0.5), &spec).len(), 32);
}

/// Node identities are UI bookkeeping and the content address must not see
/// them.
///
/// If it did, every refinement step would miss a row it had just written —
/// the chain re-scores a tree it just rendered, and that tree comes back
/// from the trace decoder with fresh identities — and every persisted row
/// would be orphaned the moment the editor touched a patch. The second
/// assertion is the migration half: a settled tree keys exactly as the same
/// term did before uids existed, so nothing already stored is lost.
#[test]
fn keys_ignore_node_identity() {
    let spec = PhraseSpec::default();
    let plain = tree(0.5);
    let (mut a, mut b) = (plain.clone(), plain.clone());
    a.ensure_uids();
    b.ensure_uids();
    assert_ne!(a.root.uid().0, b.root.uid().0, "distinct settlings");
    assert_eq!(render_key(&a, &spec), render_key(&b, &spec));
    assert_eq!(render_key(&a, &spec), render_key(&plain, &spec));
    assert!(!canonical_tree_json(&a).contains("uid"));
}

/// `render_playback` replays the recorded gain, so the buffer it produces
/// is the one `featurize` normalized — bit for bit. This is what makes a
/// lazily-materialized audition safe to hand to the audio path.
#[test]
fn render_playback_is_bit_identical() {
    let spec = PhraseSpec::default();
    for detune in [0.0, 0.5, 0.9] {
        let t = tree(detune);
        let v = featurize(&t, &spec).unwrap();
        let replayed = render_playback(&t, &spec, v.features.gain_db).unwrap();
        let direct = v.render.to_audition();
        assert_eq!(replayed.sample_rate, direct.sample_rate);
        assert_eq!(
            replayed.samples, direct.samples,
            "lazy audition drifted from the featurized render"
        );
    }
}

/// Both tiers stay bounded, and the audio tier is the one that shrinks.
#[test]
fn caps_are_enforced() {
    let spec = PhraseSpec::default();
    let memo = RenderMemo::new(3, 1);
    for i in 0..4 {
        featurize_memo(&tree(0.1 * (i as f64 + 1.0)), &spec, &memo, true).unwrap();
    }
    let s = memo.stats();
    assert_eq!(s.features, 3, "feature tier over cap");
    assert_eq!(s.audio, 1, "audio tier over cap");
    assert!(s.audio_bytes > 0);
    memo.clear();
    assert_eq!(memo.stats().features, 0);
}

/// The audio tier is touched only by a caller that wants audio. A hit that
/// asks for it gets the resident buffer itself, shared rather than copied;
/// a call that does not ask gets none and leaves the tier as it was, down
/// to which buffer is the oldest and goes next.
#[test]
fn only_a_caller_that_wants_audio_touches_the_audio_tier() {
    let spec = PhraseSpec::default();
    let memo = RenderMemo::new(8, 2);
    let (a, c, d) = (tree(0.1), tree(0.2), tree(0.3));
    let (_, a_audio) = featurize_memo(&a, &spec, &memo, true).unwrap();
    let (_, again) = featurize_memo(&a, &spec, &memo, true).unwrap();
    assert!(Arc::ptr_eq(
        a_audio.as_ref().unwrap(),
        again.as_ref().unwrap()
    ));
    featurize_memo(&c, &spec, &memo, true).unwrap();
    // A hit on `a` that wants no audio: no buffer, and `a`'s stays the
    // oldest, so the next buffer stored evicts it rather than `c`'s.
    let (hit, none) = featurize_memo(&a, &spec, &memo, false).unwrap();
    assert!(none.is_none());
    assert_eq!(hit.key, render_key(&a, &spec));
    featurize_memo(&d, &spec, &memo, true).unwrap();
    assert!(memo.get_audio(&render_key(&a, &spec)).is_none());
    assert!(memo.get_audio(&render_key(&c, &spec)).is_some());
    assert_eq!(memo.stats().hits, 2);
}

/// A memo prints its occupancy, never its rows: an engine printed with
/// `{:?}` would otherwise dump thousands of φ rows and a dozen buffers.
#[test]
fn a_memo_prints_its_occupancy_not_its_contents() {
    let spec = PhraseSpec::default();
    let memo = RenderMemo::default();
    featurize_memo(&tree(0.5), &spec, &memo, true).unwrap();
    let printed = format!("{memo:?}");
    assert!(printed.starts_with("RenderMemo"), "{printed}");
    assert!(
        printed.contains(&format!("{:?}", memo.stats())),
        "{printed}"
    );
    assert!(printed.len() < 200, "{} bytes: {printed}", printed.len());
}

/// A zero-cap memo is a working no-op, not a panic or a leak.
#[test]
fn disabled_memo_stores_nothing() {
    let spec = PhraseSpec::default();
    let memo = RenderMemo::disabled();
    let t = tree(0.5);
    featurize_memo(&t, &spec, &memo, true).unwrap();
    let (again, _) = featurize_memo(&t, &spec, &memo, true).unwrap();
    assert_eq!(memo.stats().features, 0);
    assert_eq!(memo.stats().misses, 2);
    assert_eq!(
        again.features.phi(),
        featurize(&t, &spec).unwrap().features.phi()
    );
}

/// A patch that listens (AUDIO IN) has the face of what it heard: the
/// face is taken from the listening render like any other, so a clip of a
/// 1 kHz tone lights the band holding 1 kHz, and two clips give two
/// faces, each on its own row.
#[test]
fn a_listening_patch_has_the_face_of_its_clip() {
    use crate::clip::AuditionClip;
    use crate::face::{band_edges_hz, FACE_BANDS};
    use auracle_grammar::term::InputChannel;
    let spec = PhraseSpec::default();
    let clip = |hz: f64| {
        let n = (spec.total_seconds() * 44_100.0) as usize;
        let x: Vec<f32> = (0..n)
            .map(|i| (0.3 * (i as f64 * hz / 44_100.0 * std::f64::consts::TAU).sin()) as f32)
            .collect();
        PhraseSpec {
            clip: Some(AuditionClip::from_interleaved(&x, 1, 44_100.0, &spec).unwrap()),
            ..spec.clone()
        }
    };
    let mut listens = tree(0.5);
    listens.root = AudioNode::AudioIn {
        uid: Uid::NEW,
        input: 0,
        gain: 0.5,
        channel: InputChannel::Both,
    };
    let memo = RenderMemo::default();
    let face_of = |s: &PhraseSpec| {
        featurize_memo(&listens, s, &memo, false)
            .expect("a listening render vets")
            .0
            .face
            .expect("it has a face")
    };
    let (low, high) = (face_of(&clip(1000.0)), face_of(&clip(4000.0)));
    assert_ne!(low, high, "two clips, two faces");
    let edges = band_edges_hz();
    let band = |hz: f64| {
        (0..FACE_BANDS)
            .find(|&b| hz >= edges[b] && hz < edges[b + 1])
            .unwrap()
    };
    assert_eq!(
        low.ltas_db()[band(1000.0)],
        0.0,
        "1 kHz lights its own band"
    );
    assert_eq!(
        high.ltas_db()[band(4000.0)],
        0.0,
        "4 kHz lights its own band"
    );
}

/// **Two clips never share a row.** A patch that listens keys by its
/// clip (the reference's when the spec has none); a patch that does not
/// keys the same under any clip, exactly as before clips existed; and the
/// namespace, which stamps the farm's whole store, never sees the clip.
#[test]
fn the_clip_is_in_a_listening_key_and_nowhere_else() {
    use crate::clip::AuditionClip;
    use auracle_grammar::term::InputChannel;
    let spec = PhraseSpec::default();
    let clip = |hz: f64| {
        let x: Vec<f32> = (0..4410)
            .map(|i| (0.3 * (i as f64 * hz / 44_100.0 * std::f64::consts::TAU).sin()) as f32)
            .collect();
        AuditionClip::from_interleaved(&x, 1, 44_100.0, &spec).unwrap()
    };
    let with = |c: AuditionClip| PhraseSpec {
        clip: Some(c),
        ..spec.clone()
    };
    let (a, b) = (with(clip(220.0)), with(clip(330.0)));
    let mut listens = tree(0.5);
    listens.root = AudioNode::AudioIn {
        uid: Uid::NEW,
        input: 0,
        gain: 0.5,
        channel: InputChannel::Both,
    };
    let keys = [
        render_key(&listens, &spec),
        render_key(&listens, &a),
        render_key(&listens, &b),
    ];
    assert!(
        keys[0] != keys[1] && keys[1] != keys[2] && keys[0] != keys[2],
        "a listening patch shared a key across clips: {keys:?}"
    );
    assert_eq!(render_key(&listens, &with(clip(220.0))), keys[1]);
    let plain = tree(0.5);
    assert_eq!(render_key(&plain, &spec), render_key(&plain, &a));
    assert_eq!(render_key(&plain, &a), render_key(&plain, &b));
    assert_eq!(cache_namespace(&spec), cache_namespace(&a));
    assert_eq!(cache_namespace(&a), cache_namespace(&b));
    // A spec with no clip serializes, and so keys, as it always did.
    let json = serde_json::to_string(&spec).unwrap();
    assert!(!json.contains("clip"));
    assert_eq!(spec_key_json(&spec), json);
}

/// The version folded into the namespace is the version actually built.
#[test]
fn quiver_version_matches_the_lock() {
    let lock = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../Cargo.lock"))
        .expect("workspace Cargo.lock");
    let mut lines = lock.lines();
    let mut found = None;
    while let Some(l) = lines.next() {
        if l.trim() == "name = \"quiver-dsp\"" {
            found = lines
                .next()
                .and_then(|v| v.trim().strip_prefix("version = \""))
                .map(|v| v.trim_end_matches('"').to_string());
            break;
        }
    }
    assert_eq!(
        found.as_deref(),
        Some(QUIVER_DSP_VERSION),
        "QUIVER_DSP_VERSION is stale"
    );
}
