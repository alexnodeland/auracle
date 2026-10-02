# Audition clips

<p class="lede">A live input is neither fixed nor repeatable, so it cannot be
measured as it is. A patch with an AUDIO IN is measured with an audition clip
instead, and the clip is part of the stimulus.</p>

A patch that reads the player’s input (an
[`AudioIn`](../genome/grammar.md#audio-in-the-players-input) anywhere in its
term, `PatchTree::listens`) would otherwise be rated on whatever the room
sounded like when it was rendered. Taste would chase the room. So every AUDIO
IN in a measurement render reads the session’s **audition clip**: a capture of
the player’s input, or, before one exists, a built-in reference signal
([RFC-008](https://github.com/alexnodeland/auracle/blob/main/docs/proposals/008-audio-in.md),
part 2). The features, the vet, the walks and the render farm all render with
it, so a patch that listens is measured, rated and bred like any other.

## What a clip is

`AuditionClip` (`auracle-features`, `clip.rs`):

- one or two channels, at the phrase’s sample rate;
- at most `MAX_CLIP_SECONDS` (8 s) long;
- **quantized to 16 bits when it is made**, so the engine measures exactly the
  samples it saves and a reload measures the same $\varphi$;
- named by a content id: FNV-1a 128 over its rate, channel count and samples.

A capture becomes a clip through `AuditionClip::from_interleaved`. It is
resampled linearly to the phrase’s rate (a browser captures at 48 kHz, the
phrase renders at 44.1 kHz) and cut to the phrase’s length, since nothing past
the phrase is ever read. Two captures are refused rather than repaired: one
holding a sample that is not a number, and one that is silent (below the vet’s
silence floor, an RMS of $10^{-4}$), because every patch that listens would
fail the vet over it.

The clip rides inside the stimulus, as `PhraseSpec::clip`. `None` means the
reference. A spec without a clip serializes exactly as it did before clips
existed, which is what keeps every existing cache key and fingerprint where it
was.

## The reference signal

`auracle_features::reference` builds it from the phrase’s rate and length. It
is a plucked figure: fourteen notes over four and a half seconds, in A minor
pentatonic from A2 to E4, then a rest.

| | |
|---|---|
| Notes | Harmonic stacks of up to 32 partials, none above 45% of the sample rate, at $1/k$ (bright) or $1/k^{1.6}$ (dark), alternating |
| Envelope | A 2 ms attack, then an exponential decay: 0.07 to 0.08 s for a pluck, 0.35 s and 0.2 s for one longer note in each bar |
| Picks | 12 ms of white noise at every onset |
| Dynamics | An accent pattern across each bar |
| Level | Peaks at −6 dBFS (`REFERENCE_PEAK`), so an AUDIO IN at unity meets the patch at half of quiver’s 5 V full scale |
| Channels | Mono |

It has to exercise what a patch does to an input, and each property is there
for a reason:

- **Pitched.** Every note is a harmonic stack, so a filter, a wavefolder, a
  pitch shifter or a vocoder has partials to work on.
- **Transients.** A pluck has fallen at least 27 dB by the next note, and a
  longer note 19 dB, so every onset is a rise a follower, a compressor, a gate
  or a ducker can react to, and a delay has onsets to repeat.
- **Broadband.** The picks are white noise across the whole band and the
  stacks reach up to 10 kHz, so a lowpass on the input moves the spectral
  centroid.
- **Space around it.** Every note has died away before the phrase’s last
  300 ms, the window `tail_ratio` is measured in.

It is **deterministic**: integer sample indices, `libm`’s sine and
exponential (pure Rust, so the native build and the wasm build compute the
same samples), a fixed xorshift for the picks, and the same 16-bit
quantization a capture gets. It is built once per rate and length and shared.

Being mono, it makes an AUDIO IN’s `channel` knob inaudible to the model. A
stereo capture is where that knob is heard.

`examples/audio_in.rs` measures eight patches built around an input through it:
a lowpass on the input lowers the centroid (0.63 to 0.38) and a highpass raises
it (to 0.74); hard drive lowers the crest factor (2.69 to 1.56); a reverb
smears the plucks (crest 2.04, centroid movement halved); the input keying a
ducker sets a supersaw pumping (`motion_mid` −2.54 to −0.90); and the input
as a vocoder’s modulator moves the supersaw’s spectrum. A reverb does not
lengthen the tail: every effect sits before the voice’s amp envelope, so the
tail ends with the amp’s release, for this patch as for any.

## Rendering on the host’s clock

`render_phrase` gives a patch that listens one quiver `AudioInputStream` for
the whole render, built with `with_host_clock`. The whole clip is written once,
as one block, and the render calls `advance()` after each frame’s tick of every
voice, never `tick_block`. That is quiver’s rule for a frame-by-frame host, and
it is what keeps the [chord voices](./phrase.md#chord-voices) in step: a chord
voice is compiled at its note’s onset, mid-render, and on the host’s clock its
AUDIO IN reads the frame every other voice is reading from its first tick. (On
a cursor-mode stream a voice built mid-block would be silent until the next
block, and a render has only one.) The test renders a dyad over a clip that is
silent until the dyad and a tone after it, and the dyad’s render is the mono
render doubled, bit for bit.

Frame $n$ of the render reads frame $n$ of the clip: a clip shorter than the
phrase falls silent at its end.

A patch that does not listen gets no stream at all, so its render, and every
row cached from it, is the same whatever clip the session holds.

The compiler binds the stream: `compile_with_input` builds every AUDIO IN in
the patch on the stream it is given, and `compile` builds them on a stream
nothing writes (silent), which is the same voice for any patch that does not
listen. The live instrument, `LivePoly`, binds its own stream: quiver’s cursor
mode, built once in `LivePoly::new`, which the worklet calls in its port
handler and never in `process()`, and which every voice it rebuilds shares.
The worklet writes each quantum’s input through `input_ptr` and `write_input`,
with no allocation, and a quantum with no write is silent. It writes only
while the player monitors (MONITOR on the AUDIO IN module); otherwise the live
input is silent and only the module’s meter reads it.

Every patch ends in its amp envelope, gated by the keys, so a live patch that
listens would be silent with no key down. `LivePoly` builds such a patch one
voice longer (`LivePoly::set_open`): with monitoring on, that **open voice** is
held at C4 (0 V, `OPEN_NOTE`) at full velocity, outside the keys’ allocation,
so the input sounds through the whole patch, amp envelope included. Every
voice reads the one stream, so a key held over the open voice adds a second
copy of the input while it sounds, as a chord voice in the phrase does.

## Cache keys

Two clips never share a cached row, and a new clip costs no row it does not
have to.

- **`render_key`** is unchanged for a patch that does not listen. For one that
  does, a `0xfe` separator and the clip’s content id (the reference’s when the
  spec has none) follow the spec. The clip’s samples are never hashed per key:
  the id already is their hash.
- **`cache_namespace`** never sees the clip. The farm’s store is stamped with
  its namespace and cleared when the stamp changes, so a clip there would throw
  away every cached render each time a player captured one.
- **The farm’s stored key**, `"<namespace>/<render_key>"`, therefore carries
  the clip for exactly the patches that listen.
- **PERFORM’s wiring key** (`wireKey` in `perform.js`) appends the clip’s id
  to the key of a sound with an AUDIO IN, and to no other.

## Walks and the farm

A walk renders with the clip because `WalkContext.phrase` carries it, and the
context goes with every walk job (`farm_walk` reuses its parsed copy while the
text matches). A farm worker’s fill and restore renders use the clip because
the phrase handshake carries it, parsed once per worker rather than once per
render: a phrase with a clip is about 600 KB of JSON.

The handshake is sent when the farm starts, which is before a staged restore
installs the session’s saved clip. So after a capture, or a restore with a
clip, the farm can be a phrase behind, and its render of a patch that listens
carries the old clip’s key:

- **A fill** draw that listens is admitted only on the session’s own key.
  `pre_featurized` refuses the stale result, and `Engine::absorb_prior`
  measures the draw itself, on the session’s clip, as the serial fill would.
  It does the same when the farm sent no result for a listener, since the old
  clip may be why it failed the vet. A draw that does not listen keys no clip
  and is taken as sent.
- **A restore**’s entry is refused by `bank_absorb`, and the worker measures
  it with `bank_render`.

The pool is right either way, but each such patch costs a serial render. So
the engine worker sends the handshake again (`farmResendPhrase` in
`worker.js`): to the crew standing whenever a capture is taken, and in a
staged restore right after the import installs a captured clip, before the
bank’s first render goes out. A crew raised later is handed the current
phrase when it starts.

## Capturing a clip

The web app captures the clip from the player’s input (`audio-in.js`):

- **On first listen.** When an AUDIO IN’s input first carries a signal (over
  −50 dBFS RMS, `CLIP_SIGNAL_DB`) and the session’s clip is still the
  reference, it records `CLIP_SECONDS` (6 s) of that input, before the patch,
  at the browser’s rate. The engine cuts it to the phrase (about 5.05 s), so
  the capture leaves room over it; a mono device is sent as one channel.
- **On NEW CLIP**, whatever the session holds.
- It is sent to the engine worker as `set_audition_clip`, which calls
  `WasmEngine::set_audition_clip`; the reply carries the engine’s sentence,
  which the app shows, and what it measured again.

A silent capture is refused (see above) and changes nothing; the app shows the
engine’s sentence and does not capture again by itself.

## Stored with the session

The clip is saved in `SessionState.audition_clip`, in its saved form:

```json
{"format":"s16le-base64","sample_rate":44100.0,"channels":1,
 "frames":222703,"data":"…","source":"captured"}
```

Interleaved 16-bit little-endian samples in base64: about 600 KB of text for
five seconds of mono. The reference is never saved; no clip means the
reference.

A saved clip is untrusted input, and `AuditionClip::from_saved` holds it to the
bound quiver’s `Capture` uses for its saved take:

- the format tag must be `s16le-base64`;
- the rate must be finite, positive and at most 192 kHz (`MAX_CLIP_RATE`);
- one or two channels;
- at most `MAX_CLIP_SECONDS` at its own rate;
- a frame count that agrees with the data, and the data’s length is checked
  **before** it is decoded, so nothing allocates beyond what the file’s own
  bytes occupy;
- and not silent.

The session holds the clip as raw JSON and checks it on the way in, so a clip
that cannot be read costs the session its clip and nothing else. It is
restored before the bank is measured. An unreadable one restores as the
reference, and the clip’s status (`Engine::audition_clip_status`, the wasm
binding `audition_clip`) says why, in `unreadable`.

Setting a clip (`Engine::set_audition_clip`) measures the pool’s members that
listen again, and only them. A member that no longer vets under the new clip
keeps the measurement it had and is reported as `unmeasured`: a clip change
never deletes a patch. Observations already in the log keep the $\varphi$
they were logged with.

## What is open

- **AUDIO IN in the prior.** Its weight is still 0 (`AUDIO_IN_WEIGHT`), so no
  fill or walk draws one. A player places one from the module rail, and such a
  patch has `log p = −∞` under the shipped prior: ⚡ evolve from it is refused
  (`OutsideSupport`, which the app explains as AUDIO IN), and a generation’s
  walk from it never starts. Everything on this page is built and tested with
  the term on (`PatchGrammarPrior::with_audio_in`); turning it on is setting
  `AUDIO_IN_WEIGHT` to `AUDIO_IN_ENABLED_WEIGHT` (Plan-007 task 4).
- **One clip for every input.** The session has one clip, and every AUDIO IN
  reads it whatever its input slot. A clip per input would make the render
  depend on the slot.
- **One live input.** `LivePoly` binds one input stream, so in the live voices
  every AUDIO IN reads the device of the patch’s first one; the app opens
  each other input for its module’s meter only, and says so.
