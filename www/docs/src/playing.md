# Playing it

<p class="lede">Four voices, three ways in, and an arpeggiator.</p>

<!-- film:playing --><!-- /film:playing -->

The current patch is always live: four-voice polyphony, with oldest-note
stealing and silent-tail voice parking. Every edit you make on the rack
re-patches the running instrument, so held chords survive a patch change
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

<kbd>z</kbd> / <kbd>x</kbd> shift octave, from `a = C0` to `a = C7`, so the
letters reach C0 to C8: an 88-key piano's compass, and a few notes below. The
left of the dock always shows the current anchor (`a = C4`).

```admonish note title="Letters only play when the interface does not want them"
Note letters reach the synth only when focus is not in a control, and they get
through even when it is. That is why <kbd>m</kbd> saves a patch in the bank
instead of the obvious <kbd>s</kbd>: <kbd>s</kbd> is a note, so binding save to
it would have played a D every time.
```

### MIDI

Plug in a keyboard and it works: **velocity**, **pitch bend** and the
**sustain pedal**. The dock's right side shows the MIDI state; click **midi**
there for the mapping panel.

A controller with knobs works too, with nothing to set up. The first eight
knobs you turn claim [PERFORM](./views/perform.md)'s eight controls in the
order you turn them, and the panel's **learn** remaps any of them. Endless
encoders are recognised from what they send. Ordinary pots pick a control up
as they pass through its position rather than snapping it, which matters
because Wander moves the controls under a pot that has not moved. Channel
pressure brightens the sound and the mod wheel drives Motion. Incoming MIDI
clock sets the tempo. The mapping is remembered per device.

**The sustain pedal sustains.** A note you release while the pedal is down
keeps ringing until the pedal lifts, and lifting it releases exactly those
notes. Notes still under your fingers keep sounding. Strike a sustained note
again and it belongs to your finger again. The pedal is separate from
**HOLD**, the dock's latch; it used to be wired to it.

The whole map, including bend range and how encoders are detected, is in
[Keyboard and MIDI](./keyboard.md#midi).

Web MIDI works in Chrome, Edge and the other Chromium browsers, and in
Firefox, which asks the first time whether to add a site permission for it.
Safari has none; there the other two ways in still play. Whenever MIDI is not
available the dock reads `midi ?`, and the MIDI panel says why, with a
**connect midi** button that asks again.

**MIDI plays one tab.** The browser hands your controller to every tab that
asks for it, so with Auracle open twice, the tab you used last plays MIDI and
the other stands aside: its dock reads `midi ○`, and a click anywhere in it
takes MIDI back. The computer keyboard already worked that way.

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

The keybed width defaults by input device: three octaves for a mouse, two for a
finger. The narrow sizes anchor on the computer keymap's octave, so what you
see matches what your keyboard plays. Both height and width persist.

## The arpeggiator

| | |
|---|---|
| **PATTERN** | up / down / up-down / random |
| **RATE** | Division: 1/4, 1/8, 1/16 or 1/8 triplet |
| **TEMPO** | BPM |
| **RANGE** | How many octaves it walks |
| **GATE** | Note length as a fraction of the division |
| **SWING** | Shuffle |

It is **sample-accurate**: it runs inside the audio engine rather than on a
page timer, so it does not drift and it does not stutter when the interface is
busy.

The settings open in a drawer above the dock when you switch ARP or SYNC on,
and fold to a chip under the buttons (`arp 1/8 · 120`) when you click outside
the dock or press <kbd>Esc</kbd>; the chip opens it again. Playing, HOLD and
the dock's other controls leave it open, so you can latch a chord and set the
rate against it.

**SYNC** (next to ARP) puts a patch's step sequencers on the same tempo. Each
one plays the musical division nearest the speed it was evolved at, so a
pattern that ran at 3.7 steps a second becomes 8ths at 120 BPM, and all of
them restart together with the first key you press, on the same beat the arp
starts. MIDI start restarts them too, and from then until a MIDI stop the
clock pulls them back onto its beat once a beat. A five-step pattern still cycles against
the bar; that is the point of it. Turning a sequencer's rate knob with sync on
moves it between divisions rather than off the grid, and the knob reads the
rate it plays (`2.1 Hz sync`); its tooltip gives the free-running rate. Sync
changes only what you hear live: the model still auditions every patch
free-running.

## Recording

**● REC** captures your playing to a WAV: the real output, post-limiter, at the
session sample rate. Press it again to stop; the file downloads.

This records *performance*, not the standard sample, and it is the right way to
capture a patch you like. The five-second audition phrase exists to make
patches comparable to each other.

## Per-patch loudness

Every patch is loudness-normalized (to −18 LUFS) before you hear it, in
audition *and* in feature extraction.

Louder reliably wins A/B tests, so without normalization the taste model would
learn "I like loud" and dress it up as a preference about timbre. If a patch
seems quieter than you expect, that is the normalization working.

## If it does not make sound

In order of likelihood:

1. **The pool is still warming up.** The first duel is dealt at 8 patches.
2. **No patch is loaded.** Click a row in the bank.
3. **The browser has not granted audio.** Browsers require a gesture before
   starting an audio context. Click anywhere, or press a key.
4. **The patch is muted as unvetted.** A pinned strip says so, and stays
   visible until it is resolved.
5. **Voices are stuck.** Press **◼**.

More in [Troubleshooting](./troubleshooting.md).
