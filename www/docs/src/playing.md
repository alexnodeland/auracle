# Playing it

<p class="lede">Four voices, three input paths, and an arpeggiator that runs on
the audio thread.</p>

The current patch is always live in an AudioWorklet — four-voice polyphony, with
oldest-note stealing and silent-tail voice parking. Every edit you make on the
rack re-patches the running instrument, so held chords survive a patch change
without a click.

## Three ways in

### The on-screen keys

Mouse or touch, with glissando — press and slide. The keybed shows the computer
keymap on the keys it covers.

### The computer keyboard

An Ableton-style layout:

```text
white:  a  s  d  f  g  h  j  k  l  ;  '
black:   w  e     t  y  u     o  p
```

<kbd>z</kbd> / <kbd>x</kbd> shift octave. The left of the dock always shows the
current anchor (`a = C4`).

```admonish note title="Letters only play when the interface does not want them"
Note letters reach the synth only when focus is not in a control. That is why
<kbd>m</kbd> saves a patch in the bank rather than the obvious <kbd>s</kbd> —
<kbd>s</kbd> is a note, and the global handler deliberately lets note letters
through even when a control has focus, so binding save to it would have played a
D every time you saved.
```

### MIDI

Plug in a keyboard and it works: **velocity**, **pitch bend** and **sustain
pedal**. The dock's right side shows the MIDI state.

Web MIDI is Chromium-only today. In Firefox and Safari the other two paths are
unaffected.

## The dock

| Control | |
|---|---|
| **HOLD** | Latch: notes stay on until you play them again |
| **◼** | Panic. Kills every voice immediately |
| **⇕ tall** | Grow the dock; the rack re-zooms into what is left |
| **keys** | Keybed width, 1–4 octaves |
| **ARP** | The arpeggiator, below |
| **UNI ×4** | Unison — stack detuned copies per note, trading polyphony for width |
| **gld** | Glide (portamento) between notes |
| **● REC** | Bounce your playing to a WAV |
| **vol** | Output level |

The keybed width defaults by input device — three octaves for a mouse, two for a
finger — and the narrow sizes anchor on the computer keymap's octave rather than an
octave below it, so what you see matches what your keyboard plays. Both height and
width persist.

## The arpeggiator

| | |
|---|---|
| **PATTERN** | up / down / up-down / random / order played |
| **RATE** | Division: 1/4 through 1/32, straight or triplet |
| **TEMPO** | BPM |
| **RANGE** | How many octaves it walks |
| **GATE** | Note length as a fraction of the division |
| **SWING** | Shuffle |

It is **sample-accurate** — it runs inside the audio worklet rather than on a
timer in the page, so it does not drift and it does not stutter when the UI is
busy. Its random pattern uses a deterministic generator seeded per run, because
there is no wall clock on the audio thread.

## Recording

**● REC** captures your playing to a WAV — the real output, post-limiter, at the
session sample rate. Press it again to stop; the file downloads.

This records *performance*, not the standard sample. It is the right way to
capture a patch you like: the five-second audition phrase exists to make patches
comparable to each other, not to show one off.

## Per-patch loudness

Every patch is loudness-normalized (to −18 LUFS) before you hear it, in audition
*and* in feature extraction.

This is not a mastering nicety, it is a correctness requirement. Louder reliably
wins A/B tests, so without normalization the taste model would learn "I like
loud" and dress it up as a preference about timbre. If a patch seems quieter than
you expect, that is the normalization working — a patch that needed more than
30 dB of boost is a vetting problem, not something to amplify further.

## If it does not make sound

In order of likelihood:

1. **The pool is still warming up.** The boot bar is real work; the first duel is
   dealt at 8 patches.
2. **No patch is loaded.** Click a row in the bank.
3. **The browser has not granted audio.** Browsers require a gesture before
   starting an audio context. Click anywhere, or press a key.
4. **The patch is muted as unvetted.** A pinned strip will say so — that is the
   safety gate, and it stays visible until resolved.
5. **Voices are stuck.** Press **◼**.

More in [Troubleshooting](./troubleshooting.md).
