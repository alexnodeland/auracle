use super::*;
use auracle_features::{AuditionClip, FACE_LEN};

/// A face of `FACE_LEN` bytes, all `level`.
fn flat(level: u8) -> Face {
    Face::from_bytes(vec![level; FACE_LEN]).expect("a face's length")
}

fn row(name: &str, listens: bool, level: u8) -> PresetFace {
    PresetFace {
        name: name.into(),
        source: format!("src-{name}"),
        key: format!("key-{name}"),
        listens,
        face: flat(level),
    }
}

/// The file is a header line and then one preset per line, so a
/// regeneration diffs by preset, and it reads back as what was written:
/// every field of the header and of each row, the face's bytes included.
#[test]
fn the_file_reads_back_as_written_one_preset_a_line() {
    let faces = PresetFaces {
        about: ABOUT.into(),
        fingerprint: "f1".into(),
        ns: "e3:q0:ns".into(),
        clip: "clip-id".into(),
        presets: vec![row("One", false, 7), row("Two", true, 200)],
    };
    let text = faces.to_text();
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(
        lines.len(),
        5,
        "a header, the list's opening, two presets, its close:\n{text}"
    );
    assert!(lines[0].starts_with("{\"about\":") && lines[0].ends_with(','));
    assert_eq!(lines[1], "\"presets\": [");
    assert!(lines[2].starts_with("{\"name\":\"One\"") && lines[2].ends_with("},"));
    assert!(lines[3].starts_with("{\"name\":\"Two\"") && lines[3].ends_with('}'));
    assert_eq!(lines[4], "]}");
    assert!(text.ends_with('\n'));
    let back: PresetFaces = serde_json::from_str(&text).expect("JSON");
    assert_eq!(back, faces);
    assert_eq!(back.presets[1].face.bytes(), &[200u8; FACE_LEN][..]);
}

/// The fingerprint names what a face is measured with besides the preset:
/// the same stimulus gives the same one, and another render namespace (a
/// stimulus of another rate) or another clip (one a player captured) gives
/// another.
#[test]
fn a_fingerprint_moves_with_the_namespace_and_the_clip() {
    let standard = PhraseSpec::default();
    let same = faces_fingerprint(&standard);
    assert_eq!(same, faces_fingerprint(&PhraseSpec::default()));
    assert_eq!(same.len(), 16, "FNV-1a 64 as hex");
    let faster = PhraseSpec {
        sample_rate: 48_000.0,
        ..PhraseSpec::default()
    };
    assert_ne!(cache_namespace(&faster), cache_namespace(&standard));
    assert_ne!(faces_fingerprint(&faster), same, "another namespace");
    let hum: Vec<f32> = (0..44_100).map(|i| (i as f32 * 0.05).sin() * 0.3).collect();
    let captured = PhraseSpec {
        clip: Some(AuditionClip::from_interleaved(&hum, 1, 44_100.0, &standard).expect("a clip")),
        ..PhraseSpec::default()
    };
    assert_eq!(
        cache_namespace(&captured),
        cache_namespace(&standard),
        "a clip is not in the namespace"
    );
    assert_ne!(faces_fingerprint(&captured), same, "another clip");
}
