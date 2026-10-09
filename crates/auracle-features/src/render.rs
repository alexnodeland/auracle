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
//!
//! A render nothing watches, of a patch that does not listen, ticks in
//! blocks instead: quiver's `tick_block`, bit for bit the samples a tick per
//! frame gives, at about two thirds of the CPU (see `Walk`).

use std::sync::Arc;

use auracle_grammar::{compile_follower_for_render, compile_for_render, CompiledVoice, PatchTree};
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
/// so a long tail is never truncated into a click. Every voice is compiled
/// with its live knobs folded into the ports they drive
/// (`auracle_grammar::compile_for_render`): nothing turns a knob during a
/// render, the samples are the same, bit for bit, and each sample walks
/// about half the nodes. A chord voice of a patch with a TRACK is a follower
/// (`auracle_grammar::compile_follower_for_render`): it plays
/// the note the main voice's tracker hears that frame, from its first, and its
/// amp keeps the chord note's gate, so it starts on the tracked note and stops
/// with its key. Tick order per sample is
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
    /// Whether it reads nothing, so the render may tick in blocks: an
    /// observer that reads the voice sees it after every frame, which only a
    /// tick per frame shows it.
    const BLIND: bool = false;
    /// The main voice, compiled, before its first tick.
    fn start(&mut self, voice: &auracle_grammar::CompiledVoice);
    /// The main voice, just ticked.
    fn tick(&mut self, voice: &auracle_grammar::CompiledVoice);
}

/// No observer: [`render_phrase`] itself.
impl VoiceObserver for () {
    const BLIND: bool = true;
    #[inline(always)]
    fn start(&mut self, _: &auracle_grammar::CompiledVoice) {}
    #[inline(always)]
    fn tick(&mut self, _: &auracle_grammar::CompiledVoice) {}
}

/// How a render builds its voices. A measurement folds each live knob it can
/// into the port it drives (`Folded`, what [`render_phrase`] does); the tests also
/// render with every knob live (`Live`, the voices the instrument plays), to
/// hold the two to the same samples.
#[derive(Clone, Copy)]
pub(crate) enum Build {
    Folded,
    #[cfg(test)]
    Live,
}

impl Build {
    /// `tree`'s main voice, or with `follow` a chord's follower, on `input`.
    fn voice(
        self,
        tree: &PatchTree,
        sample_rate: f64,
        input: Option<&Arc<AudioInputStream>>,
        follow: bool,
    ) -> Result<CompiledVoice, PatchError> {
        match (self, follow) {
            (Build::Folded, false) => compile_for_render(tree, sample_rate, input),
            (Build::Folded, true) => compile_follower_for_render(tree, sample_rate, input),
            #[cfg(test)]
            (Build::Live, false) => auracle_grammar::compile_with_input(tree, sample_rate, input),
            #[cfg(test)]
            (Build::Live, true) => auracle_grammar::compile_follower(tree, sample_rate, input),
        }
    }
}

/// [`render_phrase`], with `obs` watching the main voice.
pub(crate) fn render_phrase_observed<O: VoiceObserver>(
    tree: &PatchTree,
    spec: &PhraseSpec,
    obs: &mut O,
) -> Result<RenderedPhrase, PatchError> {
    render_built(tree, spec, obs, Build::Folded)
}

/// [`render_phrase_observed`], its voices built as `build` says.
pub(crate) fn render_built<O: VoiceObserver>(
    tree: &PatchTree,
    spec: &PhraseSpec,
    obs: &mut O,
    build: Build,
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
    let mut voice = build.voice(tree, spec.sample_rate, input.as_ref(), false)?;
    // Chord voices for the note being (or last) played. Compiled lazily at
    // the first chord note; a mono spec pays nothing.
    let mut chord_voices: Vec<ChordVoice> = Vec::new();

    let mut samples = Vec::with_capacity(spec.total_samples());
    let mut note_onsets = Vec::with_capacity(spec.notes.len());
    let mut spans = Vec::with_capacity(spec.notes.len());
    obs.start(&voice);

    let walk = Walk::of(&voice, O::BLIND && input.is_none());
    let input = input.as_ref();

    for note in &spec.notes {
        // Retire the previous note's chord voices only once parked; a voice
        // still ringing keeps ticking into this note, tail intact.
        if !note.chord.is_empty() {
            chord_voices.retain(|cv| !cv.parked);
            for &voct in &note.chord {
                // On the same stream: its AUDIO IN reads the frame the main
                // voice is on, from this, its first, tick. A follower: each
                // TRACK in it plays what the main voice's tracks (so it starts
                // on the tracked note, not on C4 while a cold tracker settles)
                // and its amp keeps this note's gate, so it stops with the
                // dyad. For a patch with no TRACK it is the same voice.
                let v = build.voice(tree, spec.sample_rate, input, true)?;
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
        let frames = (note.on_s * spec.sample_rate) as usize;
        walk.run(
            frames,
            &mut voice,
            &mut chord_voices,
            input,
            &mut samples,
            obs,
        );
        let on_end = samples.len();
        voice.gate.set(0.0);
        for cv in chord_voices.iter_mut().filter(|cv| cv.gated) {
            cv.voice.gate.set(0.0);
            cv.gated = false;
        }
        let frames = (note.off_s * spec.sample_rate) as usize;
        walk.run(
            frames,
            &mut voice,
            &mut chord_voices,
            input,
            &mut samples,
            obs,
        );
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

/// Frames per block of a block walk: quiver's own block (`tick_block` cuts a
/// longer call into these), so a block here is one of its blocks.
const BLOCK: usize = 64;

/// How a render ticks its voices.
///
/// A block walk is `tick_block` per voice: the main voice through a block,
/// then each ringing chord voice through the same block, their samples summed
/// frame by frame in the order a tick per frame sums them (the main voice,
/// then the chord voices in order), so each sample is the same bits. Each
/// voice's own block is bit for bit its ticks (quiver's contract); what a
/// block walk changes is only the order in which *different* voices run their
/// frames, so it is exact whenever no voice reads what another changes within
/// a frame. Three things do, and each keeps a tick per frame:
///
/// - **The clip** (a patch that listens): its stream is on the host's clock
///   and advances after every voice has read a frame, so it needs a tick per
///   frame (the module doc). The whole render walks frames.
/// - **An observer** that reads the voice after each frame
///   ([`VoiceObserver::BLIND`] false). The whole render walks frames.
/// - **Coupled chord voices** ([`Walk::of`]): a TRACK's follower is led
///   frame by frame by the main voice ([`CompiledVoice::lead`]), and the
///   kinds that draw quiver's thread-wide random stream (noise,
///   `karplus_strong`: the grammar seeds no module's own stream, and
///   [`render_built`] seeds the thread's) take their draws in tick order
///   across every voice. While a chord voice of such a patch rings, the
///   render walks frames; once each is parked, the main voice alone walks in
///   blocks (within one patch, quiver runs the drawers frame by frame itself).
///
/// A chord voice that parks inside a block has run the rest of that block
/// past its park point; those samples are not heard, and a parked voice never
/// ticks again (only [`render_built`]'s `retain` touches it, to drop it), so
/// they change nothing but its own state, which nothing reads, and the
/// random stream, which a coupled voice never reaches in a block.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Walk {
    /// A tick per frame for every voice.
    Frames,
    /// Blocks for every voice.
    Blocks,
    /// Blocks while no chord voice rings, a tick per frame while one does.
    BlocksAlone,
}

impl Walk {
    /// The walk for a render of `voice`, in blocks only if `blocks` allows.
    fn of(voice: &CompiledVoice, blocks: bool) -> Walk {
        let draws = voice
            .patch
            .nodes()
            .any(|(_, _, m)| m.shares_state() == Some(quiver::port::SharedState::RANDOM_STREAM));
        let coupled = draws || !voice.tracker_keys().is_empty();
        match (blocks, coupled) {
            (false, _) => Walk::Frames,
            (true, false) => Walk::Blocks,
            (true, true) => Walk::BlocksAlone,
        }
    }

    /// `count` frames of every voice, their sum pushed onto `samples`.
    fn run<O: VoiceObserver>(
        self,
        count: usize,
        voice: &mut CompiledVoice,
        chord: &mut [ChordVoice],
        input: Option<&Arc<AudioInputStream>>,
        samples: &mut Vec<f64>,
        obs: &mut O,
    ) {
        let (mut l, mut r) = ([0.0; BLOCK], [0.0; BLOCK]);
        let mut left = count;
        while left > 0 {
            let frames = match self {
                Walk::Frames => true,
                Walk::Blocks => false,
                Walk::BlocksAlone => chord.iter().any(|cv| !cv.parked),
            };
            if frames {
                samples.push(tick_frame(voice, chord, input));
                obs.tick(voice);
                left -= 1;
                continue;
            }
            let n = left.min(BLOCK);
            voice.patch.tick_block(&mut l[..n], &mut r[..n]);
            let base = samples.len();
            samples.extend(l[..n].iter().zip(&r[..n]).map(|(l, r)| (l + r) * 0.5 / 5.0));
            for cv in chord.iter_mut().filter(|cv| !cv.parked) {
                cv.voice.patch.tick_block(&mut l[..n], &mut r[..n]);
                for (i, s) in samples[base..].iter_mut().enumerate() {
                    let c = (l[i] + r[i]) * 0.5 / 5.0;
                    *s += c;
                    if cv.heard(c) {
                        break;
                    }
                }
            }
            left -= n;
        }
    }
}

/// One frame of every voice: the main voice, then each chord voice still
/// ringing, in order, summed; then the clip's stream moves to the next frame.
fn tick_frame(
    voice: &mut CompiledVoice,
    chord: &mut [ChordVoice],
    input: Option<&Arc<AudioInputStream>>,
) -> f64 {
    let (l, r) = voice.patch.tick();
    let mut s = (l + r) * 0.5 / 5.0;
    for cv in chord.iter_mut().filter(|cv| !cv.parked) {
        // A chord voice plays the note the main voice's TRACKs hear this
        // frame (a no-op for a patch without one).
        voice.lead(&cv.voice);
        let (cl, cr) = cv.voice.patch.tick();
        let c = (cl + cr) * 0.5 / 5.0;
        s += c;
        cv.heard(c);
    }
    // Every voice has read this frame; the next tick reads the next.
    if let Some(stream) = input {
        stream.advance();
    }
    s
}

impl ChordVoice {
    /// Count `c`, this voice's latest sample, toward parking it: once
    /// released, [`PARK_RUN`] samples in a row under [`PARK_ABS`] park it.
    /// Returns whether it parked.
    fn heard(&mut self, c: f64) -> bool {
        if !self.gated {
            if c.abs() < PARK_ABS {
                self.quiet_run += 1;
                if self.quiet_run >= PARK_RUN {
                    self.parked = true;
                }
            } else {
                self.quiet_run = 0;
            }
        }
        self.parked
    }
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
mod tests;
