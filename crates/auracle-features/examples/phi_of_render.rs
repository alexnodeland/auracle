//! φ_audio of *any* render of the standard phrase — the seam a foreign
//! synthesizer plugs into.
//!
//! Reads raw little-endian `f32` mono samples (44.1 kHz) of the default
//! phrase played by something that is not a quiver patch — a hosted plugin,
//! a hardware synth, a recording — rebuilds the note spans from
//! [`PhraseSpec::default`]'s timing, applies the same loudness normalization
//! the pipeline does, and prints the audio half of φ as JSON on stdout. Many
//! files may be given; one JSON array per line, in order.
//!
//! ```bash
//! cargo run -p auracle-features --example phi_of_render --release -- a.f32 b.f32
//! ```
//!
//! This is the whole of what the taste model needs from a sound source; the
//! structural half of φ is grammar-specific and a plugin simply has none.
use auracle_features::render::{NoteSpan, RenderedPhrase};
use auracle_features::{audio_features, normalize_to, PhraseSpec, TARGET_LUFS};

fn main() {
    let spec = PhraseSpec::default();
    let sr = spec.sample_rate;
    for path in std::env::args().skip(1) {
        let bytes = std::fs::read(&path).expect("readable file");
        let mut samples: Vec<f64> = bytes
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]) as f64)
            .collect();
        let mut onsets = Vec::new();
        let mut spans = Vec::new();
        let mut t = 0usize;
        for n in &spec.notes {
            let on = (n.on_s * sr) as usize;
            let off = (n.off_s * sr) as usize;
            onsets.push(t);
            spans.push(NoteSpan {
                voct: n.voct,
                chord: n.chord.len(),
                on_start: t,
                on_end: t + on,
            });
            t += on + off;
        }
        samples.resize(t, 0.0);
        if normalize_to(&mut samples, sr, TARGET_LUFS).is_none() {
            println!("null");
            continue;
        }
        let phi = audio_features(&RenderedPhrase {
            samples,
            sample_rate: sr,
            note_onsets: onsets,
            spans,
        })
        .to_vec();
        println!("{}", serde_json::to_string(&phi).unwrap());
    }
}
