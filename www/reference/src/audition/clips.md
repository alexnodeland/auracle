# Audition clips

<p class="lede">A live input is neither fixed nor repeatable, so it cannot be
measured as it is. A patch with an AUDIO IN is measured with an audition clip
instead, and the clip is part of the stimulus.</p>

A patch that reads the player’s input (an
[`AudioIn`](../genome/grammar.md#audio-in-the-players-input) anywhere in its
term, `PatchTree::listens`) would otherwise be rated on whatever the room
sounded like when it was rendered. Taste would chase the room. So every AUDIO
IN in a measurement render reads an **audition clip**: its input slot’s own,
a capture of the player’s device on that input, if it has one, else the clip
every slot hears, which is a built-in reference signal unless a session saved
before slots had clips of their own brought back its one capture
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
reference. An input slot can have a clip of its own, in `PhraseSpec::clips`,
which an AUDIO IN on that slot reads in its place (`PhraseSpec::slot_clip`).
A spec without a clip serializes exactly as it did before clips existed, which
is what keeps every existing cache key and fingerprint where it was.

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
each input slot it reads, for the whole render, built with `with_host_clock`;
slots that hear the same clip share one stream. The whole clip is written once,
as one block, and the render calls `advance()` after each frame’s tick of every
voice, never `tick_block`. That is quiver’s rule for a frame-by-frame host, and
it is what keeps the [chord voices](./phrase.md#chord-voices) in step: a chord
voice is compiled at its note’s onset, mid-render, and on the host’s clock its
AUDIO IN reads the frame every other voice is reading from its first tick. (On
a cursor-mode stream a voice built mid-block would be silent until the next
block, and a render has only one.) The test renders a dyad over a clip that is
silent until the dyad and a tone after it, and the dyad’s render is the mono
render doubled, bit for bit.

A patch that does not listen has no stream to keep in step, and its render
ticks each voice in blocks of 64 frames (`tick_block`): the same samples, bit
for bit, at about two thirds of the CPU. Its chord voice still ticks frame by
frame beside the main voice while it rings if it follows a TRACK, or if its
sources draw quiver’s shared random stream (noise, a plucked string), whose
draws come in tick order across the voices.

Frame $n$ of the render reads frame $n$ of the clip: a clip shorter than the
phrase falls silent at its end.

A patch that does not listen gets no stream at all, so its render, and every
row cached from it, is the same whatever clip the session holds.

The compiler binds the streams: `compile_with_input` (and `compile_for_render`,
the same voice with its knobs folded, which a measurement render uses) builds
each AUDIO IN in the patch on the stream it is given for that AUDIO IN’s slot
(`InputStreams`), a slot it is given none for on a stream nothing writes
(silent), and `compile` builds them all so, which is the same voice for any
patch that does not listen. The live instrument, `LivePoly`, binds its own
stream to every slot (`InputStreams::every`): quiver’s cursor
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
  does, when every slot it reads hears one clip, a `0xfe` separator and the
  clip’s content id (the reference’s when the spec has none) follow the spec.
  When its slots hear different clips, each slot it reads follows instead, in
  order, as a `0xfd` separator, the slot and its clip’s id. A clip on a slot
  the patch does not read moves nothing. The clip’s samples are never hashed
  per key: the id already is their hash.
- **`cache_namespace`** never sees the clip. The farm’s store is stamped with
  its namespace and cleared when the stamp changes, so a clip there would throw
  away every cached render each time a player captured one.
- **The farm’s stored key**, `"<namespace>/<render_key>"`, therefore carries
  the clip for exactly the patches that listen.
- **PERFORM’s wiring key** (`wireKey` in `perform.js`) appends the clips to
  the key of a sound with an AUDIO IN, and to no other, named as `render_key`
  names them (`clipKey` in `clips.js`): the one clip’s id when every input the
  sound reads hears it, which is the key such a sound had before an input
  could have a clip of its own, and otherwise each input it reads with its
  clip’s id, in order (`0:<id>+1:<id>`).

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
  measures the draw itself, on the session’s clips, as the serial fill would.
  It does the same when the farm sent no result for a listener, since the old
  clip may be why it failed the vet. A draw that does not listen keys no clip
  and is taken as sent.
- **A restore**’s entry is refused by `bank_absorb`, and the worker measures
  it with `bank_render`.

The pool is right either way, but each such patch costs a serial render. So
the engine worker sends the handshake again (`farmResendPhrase` in
`worker.js`): to the crew standing whenever a capture is taken, and in a
staged restore right after the import installs a captured clip on any input,
before the bank’s first render goes out. The phrase carries every input’s
clip, so one handshake brings the farm every one of them. A crew raised later is handed the current
phrase when it starts.

## Capturing a clip

The web app captures a clip of each input from the player’s device on that
input (`audio-in.js`), and each becomes that input slot’s own:

- **On an input’s first listen.** When an input a sound on the bench reads
  first carries a signal (over −50 dBFS RMS, `CLIP_SIGNAL_DB`) while the
  engine still hears that input through the reference, it records
  `CLIP_SECONDS` (6 s) of it, before the patch, at the browser’s rate. Each
  input waits for its own signal, so a patch reading two inputs has each
  captured when it is first played. The engine cuts a capture to the phrase
  (about 5.05 s), so the capture leaves room over it; a mono device is sent as
  one channel.
- **On NEW CLIP**, whatever the input holds: a module’s NEW CLIP captures the
  input that module reads, whether the keys read it or its meter only.
- It is sent to the engine worker as `set_input_clip` with the input’s slot,
  which calls `WasmEngine::set_input_clip`. The reply carries the engine’s
  sentence, which the app shows, what it measured again (only the pool’s
  members that read that input), and which clip every input now hears
  (`clips`, from `input_clip`), as the worker’s `ready` and a restore carry
  it.

The app never sets the clip every input hears (`set_audition_clip`): a
capture of one device is that input’s, not another’s. So in a new session an
input that has not been listened to is heard through the reference, and the
clip every input hears is the reference, unless a session saved before inputs
had clips of their own brought its one clip back. Such a session’s inputs all
hear that clip, so none is captured again by itself; NEW CLIP gives an input
its own.

A silent capture is refused (see above) and changes nothing; the app shows the
engine’s sentence and does not capture that input again by itself.

## Stored with the session

The clip is saved in `SessionState.audition_clip`, in its saved form:

```json
{"format":"s16le-base64","sample_rate":44100.0,"channels":1,
 "frames":222703,"data":"…","source":"captured"}
```

Interleaved 16-bit little-endian samples in base64: about 600 KB of text for
five seconds of mono. The reference is never saved; no clip means the
reference. The slots’ own clips are saved beside it in
`SessionState.audition_clips`, an object from the slot (`"0"` to `"7"`) to the
same form: one per slot at most, and a slot whose clip is the one every slot
hears is not written, so the file holds at most nine clips.

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
binding `audition_clip`) says why, in `unreadable`. A slot’s own clip that
cannot be read costs that slot alone, which hears the one every slot hears,
and its status (`Engine::slot_clip_status`, the binding `input_clip`) says
why. A session saved before slots had clips of their own restores its one
clip on every slot.

Setting a clip (`Engine::set_audition_clip`) measures the pool’s members that
listen again, and only them. A member that no longer vets under the new clip
keeps the measurement it had and is reported as `unmeasured`: a clip change
never deletes a patch. Observations already in the log keep the $\varphi$
they were logged with. Setting it also takes each slot’s own clip away.
Setting one slot’s (`Engine::set_slot_clip`, the binding `set_input_clip`)
measures again only the members that read that slot.

## Breeding a patch that listens

AUDIO IN is a player kind ([grammar](../genome/grammar.md#audio-in-the-players-input)):
the prior never draws one, so no fill or walk deals an input, and it scores a
player’s, so a listening patch is walked like any other. A walk renders every
proposal with the session’s clips, because `WalkContext.phrase` carries them,
and the farm’s walk (`farm_walk`) is handed the same context: a ⚡ or a
generation from a listening seed lands the same child on the farm as on the
engine, with the seed’s inputs held and any CAPTURE’s take carried through
(`crates/auracle-wasm`’s
`a_listening_seed_evolves_on_the_farm_with_its_clip_and_take`).

## What is open

- **One live input.** `LivePoly` binds one input stream, so in the live voices
  every AUDIO IN reads the device of the patch’s first one; the app opens
  each other input for its module’s meter only, and says so. The model
  measures a patch that reads two inputs through each input’s own clip, so it
  rates the patch as it sounds with each device on its own input, which the
  live voices do not play yet.
