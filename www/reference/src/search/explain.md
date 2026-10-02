# Explaining a control: what a figure measures

<p class="lede">A control's figure is the sound in hand rendered twice, the
control at its center and turned, and each render measured the way φ measures
it. The lesson on filters is the same sound rendered through a lowpass from
the grammar, with that filter's response taken from its own impulse.</p>

PERFORM's controls are [directions in φ](./perform.md#a-named-control-is-a-direction),
wired onto each patch's knobs by a measured Jacobian, so no control is a fixed
effect: BRIGHT turns a filter's cutoff on one patch and a detune and an
envelope on another. What a control does is therefore not something the app
can draw from a recipe. It asks the engine. The figure (Plan-005 task 10,
RFC-006 §9, [ADR-012](https://github.com/alexnodeland/auracle/blob/main/docs/decisions/012-motion-shows-what-the-engine-does.md))
draws what came back, and nothing else. This page is how.

The engine side lives in `auracle_features::explain` (the portrait),
`auracle_grammar::lowpass_response` (the lesson's filter) and
`auracle_wasm`'s `explain.rs` (the bindings `explain_render` and
`lesson_filter`). The page side is `apps/web/explain.js`; perform.js's
`explainOf` says what to render, and words.js says what was measured.

## What a figure asks for

When a player asks about the control at panel position $i$ (? with the
pointer over it or keyboard focus on it, its ? chip, or a long press on a
touch screen), PERFORM hands over the performed state twice, as knob overrides on
the tree it is playing (`explainOf`):

- **made**: every knob as it sounds now, but with control $i$ at $c = 0$
  (`soundingOf` with that control's value zeroed);
- **turned**: the same with control $i$ at $c_\text{at}$, where the player
  has it when $\lvert c \rvert \ge 0.05$, else a full turn toward the end its
  wiring opens to (high, unless only the low half was confirmed on real
  renders). Absent for a search control and for one not measured yet: nothing
  turns them.

The worker answers `explain` in its `soon` lane, holding the floor, one
render per turn with the player's gestures served between (`breathe`). Each
render is `WasmEngine::explain_render(tree, overrides, k)`: the performed tree
featurized exactly as the pool is (`featurize`: render, vet, loudness
normalization, φ), then its portrait, and where it measures on control
$k$'s unit direction in σ (`along`, the same dot product as a wiring's
`position`). A render that does not vet answers `{error}`.

Replies are cached by the page under the control, the tree, both override
sets and the wiring's words (measured or not, a search control or not, the
knobs it turns), so switching back to a control costs nothing; the page does
not read `along`, so the model's revision is not in the key. One request is
out at a time: a key asked for while one is out is not queued, and when the
reply lands the answer is built again and asks for whatever its control is
then, as the lesson does. An open figure follows its control: a turn, once it
has rested for 300 ms (`FOLLOW_MS`; the page's 400 ms check leaves a turn in
progress to it), a new measurement or a drift changes what `explainOf`
returns, and the figure asks again. Measured in the browser, a three-second
drag with an answer open sends at most two requests
(`explain.spec.js`). While they render, the last figure stays, dimmed, under
*measuring…*.

## The portrait

Everything is measured on the normalized render (the buffer an audition
plays), so two portraits compare as the model hears them: loudness matched,
shape against shape. The constants are in `auracle-features`'s `explain.rs`.

| Field | What | Drawn by |
|---|---|---|
| `bands` | The long-term spectrum: every sounding frame's power (2048-sample Hann frames, hop 1024, as φ's), in 40 bands log-spaced from 35 Hz to 14 kHz, each the mean power density over its edges, in dB re the loudest band, floored at −60 (`BANDS`, `LO_HZ`, `HI_HZ`, `FLOOR_DB`) | BRIGHT, BODY, WARMTH, AIR |
| `held` | The held note's spectrum bin by bin up to 4 kHz (`HELD_HI_HZ`), C4's first fifteen harmonics and what lies between them, dB re its loudest bin | GRIT, BITE, LO-FI |
| `onset` | The first note's level in φ's 4 ms attack windows, every 2 ms for 400 ms (`ONSET_STEP_S`, `ONSET_S`), re the note's peak | SNAP, ROUND |
| `level` | The phrase's level every 50 ms (`LEVEL_STEP_S`), dB re its RMS, with each note's gate (`notes`) | SPACE, DISTANCE, HAZE, PUNCH, THUMP, HEFT |
| `bright`, `loud` | The held note's spectral centroid (Hz, magnitude-weighted as φ's) and frame level (dB re its loudest frame), frame by frame at a 512-sample hop from its onset to its gate closing | MOTION, THROB, SWAY |
| `facts` | φ's own coordinates of the render in their units (`Facts`) | the sentence |

`bands` is a face's band layout (`BANDS`, `LO_HZ`, `HI_HZ` and `FLOOR_DB`
are `face.rs`'s `FACE_*`, one definition, and `band_edges_hz` is face.rs's),
so a figure's spectrum and the sound's face line up band for band: the
portrait carries the render's own face too (`Portrait::face`,
`Face::of_f64`), which `a_sine_lands_in_its_band` holds to the bands within
a face's 0.5 dB step. The page draws the face (vessel.js `drawVessel`,
whitened against the bank's faces) for BRIGHT, BODY, WARMTH and AIR and the
lesson's shape, the as-made one dashed by its outline; with under four faces
in the bank there is nothing to whiten against, and it draws the spectrum
itself, which the lesson then calls "its spectrum". `response_bands` keeps
its own band weighting, since an impulse response's transform is not a
face's frame length.

`Facts` reads φ's raw audio coordinates back into units a sentence can say:
`centroid_mean`, `rolloff_mean` and `zcr_mean` from φ's log axis to Hz;
`attack_s` to ms; `crest` and `high_ratio` to dB; `tail_ratio` to the last
300 ms against the phrase in dB (floored at −60, φ's own floor); `rms_mean` to
dBFS; `bass_fraction` to %; `held_centroid_std` from φ's log axis to
octaves (one unit of that axis is the span from 20 Hz to Nyquist, about
10.1 octaves at 44.1 kHz, so it is multiplied by
$\log_2(f_\text{Nyquist}/20)$); and the three motion bands from φ's
$0.5\log_2$ of a variance to a standard deviation. That deviation is not in
octaves alone: each band sums the variance of the held note's brightness, in
octaves, and its level, in doublings (6 dB), floored at 0.01, so the sentence
gives it as a number with both named, and its floor as *none*.
`facts_read_phi_in_its_units` pins the inversions to Hz, ms, dB, %, octaves
and the bands. `flux_mean` stays the index φ keeps, 0 to 1, said as one.

## What each figure draws

Each control draws the measurement its direction is made of first, made
dashed and turned lit (words.js `FIGURE_OF`), and its sentence says that
coordinate made then turned:

| Control | Figure | The sentence's measurement |
|---|---|---|
| BRIGHT | spectrum, and the difference band by band (±24 dB) | the center (`centroid_mean`) |
| BODY, WARMTH, THUMP | spectrum; THUMP the level | the share below 250 Hz (`bass_fraction`) |
| AIR | spectrum | where the top rolls off (`rolloff_mean`) |
| SNAP, ROUND | the first 400 ms, each 90% crossing ticked | the attack (`attack_s`) |
| PUNCH | the level | the peaks over the average (`crest`) |
| HEFT | the level | the frames' level (`rms_mean`) |
| SPACE, DISTANCE, HAZE | the level, the last 300 ms shaded | the tail (`tail_ratio`) |
| MOTION | the held note's brightness or level, whichever the turn moved more (an octave against 6 dB, φ's currency) | the brightness's wander (`held_centroid_std`), in octaves |
| THROB, SWAY | the same | the 2–8 Hz or 0.5–2 Hz band (`motion_mid`, `motion_slow`), brightness and level together |
| GRIT, LO-FI | the held note's harmonics | flatness, in dB (`flatness_mean`) |
| BITE | the held note's harmonics | the frame-to-frame change (`flux_mean`), an index from 0 to 1 |

The sentence's second half is the wiring's: the knobs it turns on this
sound. For a search control it is the panel's own words (nothing here turns
it, and turning it asks for an offer), with the made measurement alone.

**What moves.** A figure draws its turned measurement in along its own axis
and holds: band by band from the bottom over two `--d-move`, or along time at
the phrase's own pace. MOTION's runs the held note's measured track at its
real rate, looping, while it is open. Nothing is interpolated between the two
renders: no frame of any figure shows a setting the engine did not render.
Under reduced motion every figure is drawn whole at once.

## The lesson's filter

The lesson renders the sound in hand with `lesson_filter`, one call in `soon`
per render: once as it is (no cutoff: the first step's shape and sound), and
once for each cutoff the player drags to, one request out at a time with the
latest cutoff waiting for it.

- **The filter** is the grammar's own: an `AudioNode::Filter` of kind
  `SvfLp` at the knob `cutoff`, resonance `LESSON_RESONANCE` (0.345, a
  damping of 1.41 on quiver's filter: Butterworth, flat below the cutoff and
  3 dB down at it), inserted on the output below any stereo effect that ends
  the chain (`insert_at_output`, the walk the Bright and Body grafts already
  use). The patch itself is never changed.
- **A patch with no room** for one more module (the grammar's size ceilings:
  16 of 150 pool draws of the shipped seed, none of the 62 presets) gets the
  same filter after the whole voice instead (`placement: "after"`):
  `lowpass_apply` runs quiver's `Svf` over the phrase's raw render, which is
  then vetted and normalized as `featurize` does every render. Nothing keytracks it there, so its corner is the held
  note's on every note, and the lesson says so.
  `a_patch_with_no_room_gets_the_filter_after_it` pins it. Measured by
  `explain_lesson` on those draws at a cutoff of 0.5: 133 rendered inside,
  16 after, 1 silent.
- **When a render fails**, the reply's `error` stands for its portrait
  (`no_tree`, `silent`, `vet`). The page says why in a sentence (words.js
  `lessonTrouble`), draws no curve or readout for that cutoff and plays
  nothing under *through it*; a cutoff that failed may render at another, so
  a drag still asks. When the sound itself fails, or its tree cannot be read,
  the lesson asks nothing more.
- **Its cutoff** is the knob's corner on the held note, `cutoff_hz`: quiver's
  `20 · 1000^x` Hz, which keytracking (`KEYTRACK_AMT`, half an octave per
  octave from C4) leaves unmoved on C4. PATCH prints a filter's cutoff knob in
  the same unit.
- **Its response** is the impulse response of quiver's `Svf` driven as the
  compiler drives it (`lowpass_response`: the cutoff knob as is, the
  resonance knob through the compiler's mapping, keytracking at C4), 8192
  samples, in the portrait's 40 bands (`response_bands`).
  `lowpass_response_is_the_compiled_filter` holds it to a compiled filter's
  gain on a sine at C4 within 0.25 dB, for four cutoffs and resonances.
- **Its sound** is the filtered render's audition at the level every audition
  plays at (`audition_pcm`), looped by the page and swapped in place when a
  new cutoff lands. Every render is normalized to −18 LUFS (`TARGET_LUFS`)
  as the pool's are, so a lower cutoff is heard darker, not quieter, and its
  spectrum is drawn against its own loudest band.

## What it costs

`crates/auracle-wasm/examples/explain_cost.mjs` times each binding on all 62
presets in the built package under node (V8, single-threaded, as the engine
worker is), in CPU ms, median and maximum, on an Apple M3 Max shared with
other jobs:

| Call | Median | Max |
|---|---|---|
| `explain_render` | 207 | 462 |
| `lesson_filter` | 233 | 475 |
| a plain render and φ (`farm_render`) | 199 | 454 |

A portrait adds about 4% to the render it measures; a figure is two renders,
about 0.4 s, and its reply is 5.4 KB of JSON (median). A cached figure opens
at once.

## Where the specimen and the engine differ

Prototype v2's `explain.js` drew each control as the effect it was in the
prototype. The app's controls are not effects, so the engine was followed:

- **BRIGHT is not a filter.** The specimen's figure is a lowpass response with
  its cutoff ("Here it cuts above 3.7 kHz"). The app draws the measured
  difference between two renders band by band, and says what moved and which
  knobs moved it: on Reese, a filter's cutoff; on another sound, something
  else.
- **SNAP, MOTION, GRIT and SPACE** were an envelope, an LFO, a waveshaper's
  curve and a reverb's tail. The app draws the onset, the held note's
  brightness, its harmonics, and the phrase's level and tail, as rendered.
- **The patch with no room.** The specimen's filter is a knob on its fixed
  chain; the app's goes after the voice on the one pool sound in ten that
  has no room for it, and says so.
- **The lesson's filter is added, not BRIGHT.** The specimen's lesson drags
  BRIGHT; the app's adds the grammar's lowpass to a copy, so "BRIGHT turns a
  filter like this one, on any sound" became a sentence from this sound's
  wiring, and "Done puts BRIGHT back" became "Done leaves it as it was".
- **The shape is the face from four faces up.** With fewer in the bank
  there is nothing to whiten against, and the spectrum stands in.
- **The keys play the sound without the lesson's filter**: the lesson's sound
  is the filtered phrase, looped; the live voices are not given the filter.
- **A palette control's preview** (the specimen's `macroAnswer`, a recipe over
  the six) is not drawn: each of the eighteen is its own direction, measured
  when placed.
- **Only the controls ask for now.** The specimen also asks about a bank row's
  liking, the pair, the map's directions and the sound's face; those wait for
  their own tasks, and ⌘K's entries for the shell (Plan-005 task 2).
