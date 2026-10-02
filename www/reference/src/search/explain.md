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
pointer over it or focus on it, its ? chip, or a long press on a touch
screen), PERFORM hands over the performed state twice, as knob overrides on
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
sets and the model's observation count, so switching back to a control costs
nothing. An open figure follows its control: a turn, once it has rested for
300 ms (`FOLLOW_MS`), a new measurement or a drift changes what `explainOf`
returns, and the figure asks again.

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

`bands` uses the band layout of a sound's face, so a figure's shape and a
face line up band for band; it is the spectrum before the face's whitening
against the bank, which is why the lesson calls it "its spectrum".

`Facts` reads φ's raw audio coordinates back into units a sentence can say:
`centroid_mean`, `rolloff_mean` and `zcr_mean` from φ's log axis to Hz;
`attack_s` to ms; `crest` and `high_ratio` to dB; `tail_ratio` to the last
300 ms against the phrase in dB (floored at −60, φ's own floor); `rms_mean` to
dBFS; `bass_fraction` to %; `held_centroid_std` in octaves; and the three
motion bands from φ's $0.5\log_2$ of a variance to a standard deviation in
octaves. `facts_read_phi_in_its_units` pins each inversion.

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
| MOTION | the held note's brightness or level, whichever the turn moved more (an octave against 6 dB, φ's currency) | the brightness's wander (`held_centroid_std`) |
| THROB, SWAY | the same | the 2–8 Hz or 0.5–2 Hz band (`motion_mid`, `motion_slow`) |
| GRIT, LO-FI | the held note's harmonics | flatness, in dB (`flatness_mean`) |
| BITE | the held note's harmonics | the frame-to-frame change (`flux_mean`) |

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

The lesson renders the sound in hand three ways, each one `lesson_filter`
call in `soon`: as it is (no cutoff: the first step's shape and sound), and
through a lowpass at the cutoff the player drags to, one request out at a
time with the latest cutoff waiting for it.

- **The filter** is the grammar's own: an `AudioNode::Filter` of kind
  `SvfLp` at the knob `cutoff`, resonance `LESSON_RESONANCE` (0.345, a
  damping of 1.41 on quiver's filter: Butterworth, flat below the cutoff and
  3 dB down at it), inserted on the output below any stereo effect that ends
  the chain (`insert_at_output`, the walk the Bright and Body grafts already
  use). The patch itself is never changed.
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
  new cutoff lands.

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
- **The lesson's filter is added, not BRIGHT.** The specimen's lesson drags
  BRIGHT; the app's adds the grammar's lowpass to a copy, so "BRIGHT turns a
  filter like this one, on any sound" became a sentence from this sound's
  wiring, and "Done puts BRIGHT back" became "Done leaves it as it was".
- **The shape is its spectrum, not yet its face**: the face (Plan-005 task 3)
  is whitened against the bank. When faces land, the figure's and the lesson's
  shape take the render's face (`drawVessel`), marked `faces:` in
  explain.js.
- **The keys play the sound without the lesson's filter**: the lesson's sound
  is the filtered phrase, looped; the live voices are not given the filter.
- **A palette control's preview** (the specimen's `macroAnswer`, a recipe over
  the six) is not drawn: each of the eighteen is its own direction, measured
  when placed.
- **Only the controls ask for now.** The specimen also asks about a bank row's
  liking, the pair, the map's directions and the sound's face; those wait for
  their own tasks, and ⌘K's entries for the shell (Plan-005 task 2).
