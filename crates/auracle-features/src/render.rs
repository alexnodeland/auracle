//! Headless rendering of a compiled voice under the standard phrase.
//!
//! Determinism contract: quiver's thread-local RNG is re-seeded from
//! [`PhraseSpec::seed`] immediately before ticking, and the patch is compiled
//! fresh per render, so `(term, spec)` → bit-identical samples on any thread.
//!
//! A patch that listens ([`PatchTree::listens`]) also reads the stimulus's
//! audition clip ([`PhraseSpec::audition_clip`]), through one quiver
//! `AudioInputStream` on the **host's clock**: the whole clip is written once
//! as one block, and the render calls `advance()` after each frame's tick of
//! every voice, never `tick_block`. That is quiver's rule for a frame-by-frame
//! host, and it is what keeps the chord voices in step: a chord voice is
//! compiled at its note's onset, mid-render, and on the host's clock its
//! AUDIO IN reads the frame every other voice reads, from its first tick (a
//! cursor-mode stream would leave a voice built mid-block silent until the
//! next block, and this render has only one). A patch that does not listen
//! gets no stream at all, so its render is what it always was.

use std::sync::Arc;

use auracle_grammar::{compile_with_input, PatchTree};
use quiver::{AudioInputStream, PatchError};

use crate::phrase::PhraseSpec;

/// Where one phrase note sits in the rendered buffer, and what it was — the
/// role information segment-local features key on ([`crate::audio`] finds the
/// held note, the highest note and the chord note by *property*, never by
/// position, so custom test phrases degrade gracefully).
#[derive(Clone, Copy, Debug)]
pub struct NoteSpan {
    /// Pitch of the note's primary voice, V/Oct from C4.
    pub voct: f64,
    /// Number of additional chord voices gate-synced with this note.
    pub chord: usize,
    /// Sample index where the gate opened.
    pub on_start: usize,
    /// Sample index where the gate closed (exclusive end of the on-span).
    pub on_end: usize,
}

/// A rendered phrase: mono samples normalized from quiver's ±5 V audio level
/// to nominal ±1.0.
#[derive(Clone, Debug)]
pub struct RenderedPhrase {
    /// Mono samples (left/right average), nominal ±1.0 full scale.
    pub samples: Vec<f64>,
    /// Sample rate in Hz.
    pub sample_rate: f64,
    /// Sample index where each note's gate opens (for attack-time features).
    pub note_onsets: Vec<usize>,
    /// Gate spans and roles of each note, in phrase order.
    pub spans: Vec<NoteSpan>,
}

/// A chord voice: its own compiled copy of the patch, alive from its note's
/// onset until its release tail parks on silence.
struct ChordVoice {
    voice: auracle_grammar::CompiledVoice,
    /// Consecutive below-threshold samples seen since the gate closed.
    quiet_run: usize,
    /// Gate is closed and the tail has decayed — stop ticking.
    parked: bool,
    /// Gate currently open (ignore silence while held: a slow attack is
    /// silent and must not be parked).
    gated: bool,
}

/// Silence threshold and run length for parking a released chord voice —
/// the same judgment the live engine makes when it stops ticking a silent
/// voice, deterministic here because the render itself is.
const PARK_ABS: f64 = 1e-6;
const PARK_RUN: usize = 1024;

/// Compile `tree` and render it playing the phrase.
///
/// Chord notes ([`crate::phrase::Note::chord`]) are rendered by additional
/// compiled voices summed into the same buffer with **no attenuation**: two
/// voices sounding at once being louder and denser than one is exactly the
/// polyphonic-stacking information the stimulus exists to capture, whole-
/// phrase loudness is normalized downstream, and the vet ceiling scales with
/// [`crate::phrase::PhraseSpec::max_voices`]. Chord voices tick from their
/// note's onset (cold start, like live voice allocation), share the note's
/// gate, and after release keep ticking until their output parks on silence
/// so a long tail is never truncated into a click. Tick order per sample is
/// fixed (main voice, then chord voices in pitch order), which keeps the
/// thread-local RNG draw sequence — and therefore the render — deterministic.
pub fn render_phrase(tree: &PatchTree, spec: &PhraseSpec) -> Result<RenderedPhrase, PatchError> {
    render_phrase_observed(tree, spec, &mut ())
}

/// What may watch a render: the main voice once it is compiled, then after
/// every tick. It reads the voice and never writes it, so a render it watches
/// is the render it would have been (`crate::probe`'s tests hold that bit for
/// bit). Chord voices are not shown to it.
pub(crate) trait VoiceObserver {
    /// The main voice, compiled, before its first tick.
    fn start(&mut self, voice: &auracle_grammar::CompiledVoice);
    /// The main voice, just ticked.
    fn tick(&mut self, voice: &auracle_grammar::CompiledVoice);
}

/// No observer: [`render_phrase`] itself.
impl VoiceObserver for () {
    #[inline(always)]
    fn start(&mut self, _: &auracle_grammar::CompiledVoice) {}
    #[inline(always)]
    fn tick(&mut self, _: &auracle_grammar::CompiledVoice) {}
}

/// [`render_phrase`], with `obs` watching the main voice.
pub(crate) fn render_phrase_observed<O: VoiceObserver>(
    tree: &PatchTree,
    spec: &PhraseSpec,
    obs: &mut O,
) -> Result<RenderedPhrase, PatchError> {
    // Determinism: fix the stochastic-module RNG for this render — **before**
    // anything is compiled. quiver's RNG is one thread-local stream, and some
    // of its module constructors draw from it (`AnalogVco` takes four). No
    // module the grammar compiles does so today, which is why seeding *after*
    // the main voice used to work; that was luck, not construction, and the
    // contract this crate makes — `(term, spec)` → bit-identical samples —
    // should not depend on which constructors quiver adds a draw to next.
    quiver::rng::seed(spec.seed);

    // The clip, for a patch that listens: one stream every voice reads, on
    // this render's clock (see the module doc).
    let input = tree.listens().then(|| audition_stream(spec));
    let mut voice = compile_with_input(tree, spec.sample_rate, input.as_ref())?;
    // Chord voices for the note being (or last) played. Compiled lazily at
    // the first chord note; a mono spec pays nothing.
    let mut chord_voices: Vec<ChordVoice> = Vec::new();

    let mut samples = Vec::with_capacity(spec.total_samples());
    let mut note_onsets = Vec::with_capacity(spec.notes.len());
    let mut spans = Vec::with_capacity(spec.notes.len());
    obs.start(&voice);

    let tick_all =
        |voice: &mut auracle_grammar::CompiledVoice, chord: &mut Vec<ChordVoice>| -> f64 {
            let (l, r) = voice.patch.tick();
            let mut s = (l + r) * 0.5 / 5.0;
            for cv in chord.iter_mut().filter(|cv| !cv.parked) {
                let (cl, cr) = cv.voice.patch.tick();
                let c = (cl + cr) * 0.5 / 5.0;
                s += c;
                if !cv.gated {
                    if c.abs() < PARK_ABS {
                        cv.quiet_run += 1;
                        if cv.quiet_run >= PARK_RUN {
                            cv.parked = true;
                        }
                    } else {
                        cv.quiet_run = 0;
                    }
                }
            }
            // Every voice has read this frame; the next tick reads the next.
            if let Some(stream) = &input {
                stream.advance();
            }
            s
        };

    for note in &spec.notes {
        // Retire the previous note's chord voices only once parked; a voice
        // still ringing keeps ticking into this note, tail intact.
        if !note.chord.is_empty() {
            chord_voices.retain(|cv| !cv.parked);
            for &voct in &note.chord {
                // On the same stream: its AUDIO IN reads the frame the main
                // voice is on, from this, its first, tick.
                let v = compile_with_input(tree, spec.sample_rate, input.as_ref())?;
                v.pitch.set(voct);
                v.gate.set(5.0);
                chord_voices.push(ChordVoice {
                    voice: v,
                    quiet_run: 0,
                    parked: false,
                    gated: true,
                });
            }
        }

        voice.pitch.set(note.voct);
        let on_start = samples.len();
        note_onsets.push(on_start);
        voice.gate.set(5.0);
        for _ in 0..(note.on_s * spec.sample_rate) as usize {
            let s = tick_all(&mut voice, &mut chord_voices);
            samples.push(s);
            obs.tick(&voice);
        }
        let on_end = samples.len();
        voice.gate.set(0.0);
        for cv in chord_voices.iter_mut().filter(|cv| cv.gated) {
            cv.voice.gate.set(0.0);
            cv.gated = false;
        }
        for _ in 0..(note.off_s * spec.sample_rate) as usize {
            let s = tick_all(&mut voice, &mut chord_voices);
            samples.push(s);
            obs.tick(&voice);
        }
        spans.push(NoteSpan {
            voct: note.voct,
            chord: note.chord.len(),
            on_start,
            on_end,
        });
    }

    Ok(RenderedPhrase {
        samples,
        sample_rate: spec.sample_rate,
        note_onsets,
        spans,
    })
}

/// The stream a listening patch reads during a render of `spec`: the
/// stimulus's clip (or the reference) written once, whole, as one block on a
/// host-clock stream, so frame `n` of the render reads frame `n` of the clip
/// and a clip shorter than the phrase falls silent at its end.
fn audition_stream(spec: &PhraseSpec) -> Arc<AudioInputStream> {
    let clip = spec.audition_clip();
    let stream = Arc::new(AudioInputStream::with_host_clock(
        clip.channel_count(),
        clip.frames(),
    ));
    stream.write(clip.planar());
    stream
}

/// A playback-ready audition buffer.
///
/// `f32` because that is the **only** form a stored render is ever consumed
/// in — every consumer in the tree converts at the boundary for WebAudio
/// (`auracle_wasm`'s `render_of` / `edit_render`). Storing it converted
/// halves resident audio and removes a per-request conversion pass.
///
/// One-way door, stated explicitly: **features are never derived from an
/// `Audition`.** [`crate::featurize`] measures on the f64 [`RenderedPhrase`]
/// and always will; anything that wants φ from a term must featurize it, not
/// analyze its audition buffer.
#[derive(Clone, Debug)]
pub struct Audition {
    /// Mono samples, nominal ±1.0 full scale, loudness-normalized.
    pub samples: Vec<f32>,
    /// Sample rate in Hz.
    pub sample_rate: f64,
}

impl Audition {
    /// Resident bytes of the sample buffer (for memo accounting).
    pub fn bytes(&self) -> usize {
        self.samples.len() * std::mem::size_of::<f32>()
    }
}

impl RenderedPhrase {
    /// The playback-ready view of this render.
    pub fn to_audition(&self) -> Audition {
        Audition {
            samples: self.samples.iter().map(|s| *s as f32).collect(),
            sample_rate: self.sample_rate,
        }
    }
}

/// Re-derive the audition buffer of an already-featurized term **without**
/// re-running the loudness analysis, using the `gain_db` its
/// [`crate::Features`] recorded.
///
/// Bit-identical to what [`crate::featurize`] produced for the same term:
/// [`crate::loudness::normalize_to`] measures a gain and then applies it as a
/// *uniform scalar multiply* over the buffer, so replaying the recorded gain
/// reproduces the same products exactly. `gain_db` is stored already bounded —
/// by `loudness::MAX_GAIN_DB` above and by `loudness::PEAK_CEILING` below — so
/// no bound is re-applied here. Re-applying would be a no-op; *not* applying
/// is what keeps this in lockstep with the one place the decision is made.
///
/// That single-scalar shape is why the peak ceiling is a gain reduction rather
/// than a limiter: a limiter would have to exist here too, identically, forever.
///
/// This is the second code path that must stay in lockstep with `featurize`'s
/// normalization forever; `render_playback_is_bit_identical` is the test that
/// keeps it honest.
pub fn render_playback(
    tree: &PatchTree,
    spec: &PhraseSpec,
    gain_db: f64,
) -> Result<Audition, PatchError> {
    let mut render = render_phrase(tree, spec)?;
    let gain = 10f64.powf(gain_db / 20.0);
    for s in render.samples.iter_mut() {
        *s *= gain;
    }
    Ok(render.to_audition())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clip::AuditionClip;
    use crate::phrase::Note;
    use auracle_grammar::term::{AmpEnv, AudioNode, InputChannel, Uid};
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
        let gap = (1.85 * spec.sample_rate) as usize..(1.95 * spec.sample_rate) as usize;
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
}
