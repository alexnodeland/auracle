//! Headless rendering of a compiled voice under the standard phrase.
//!
//! Determinism contract: quiver's thread-local RNG is re-seeded from
//! [`PhraseSpec::seed`] immediately before ticking, and the patch is compiled
//! fresh per render, so `(term, spec)` → bit-identical samples on any thread.

use auracle_grammar::{compile, PatchTree};
use quiver::PatchError;

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
    let mut voice = compile(tree, spec.sample_rate)?;
    // Chord voices for the note being (or last) played. Compiled lazily at
    // the first chord note; a mono spec pays nothing.
    let mut chord_voices: Vec<ChordVoice> = Vec::new();

    // Determinism: fix the stochastic-module RNG for this render.
    quiver::rng::seed(spec.seed);

    let mut samples = Vec::with_capacity(spec.total_samples());
    let mut note_onsets = Vec::with_capacity(spec.notes.len());
    let mut spans = Vec::with_capacity(spec.notes.len());

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
            s
        };

    for note in &spec.notes {
        // Retire the previous note's chord voices only once parked; a voice
        // still ringing keeps ticking into this note, tail intact.
        if !note.chord.is_empty() {
            chord_voices.retain(|cv| !cv.parked);
            for &voct in &note.chord {
                let v = compile(tree, spec.sample_rate)?;
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
