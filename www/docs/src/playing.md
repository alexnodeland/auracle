# Playing it

<p class="lede">The sound you’re playing is always live, at every level. This
page is about the three ways to play it, the controls on the keybed, the
arpeggiator, and recording what you play.</p>

<!-- film:playing --><!-- /film:playing -->

The instrument has four voices. A new note past four takes the oldest one, and
a voice whose tail has gone quiet is parked until it’s needed. Every edit you
make on the rack changes the running instrument, so a held chord keeps
sounding through it.

## Three ways in

### The keybed on screen

Click or touch a key, and slide across the keys for a glissando. The keybed
shows the computer keyboard’s letters on the keys they play.

### The computer keyboard

The home row plays the white keys, and the row above it the black keys:

```text
white:  a  s  d  f  g  h  j  k  l  ;  '
black:   w  e     t  y  u     o  p
```

<kbd>z</kbd> and <kbd>x</kbd> shift the octave, so that <kbd>a</kbd> plays
anything from C0 to C7. At the bottom, <kbd>a</kbd> plays C0; at the top,
<kbd>'</kbd> plays F8, five notes past an 88-key piano’s C8. The keybed on
screen stops at C8, so the last few letters sound without a key lighting. The
left of the keys bar always shows the note <kbd>a</kbd> plays (**KEYS**
`Z C4 X octave`), and **Z** and **X** there are buttons too.

```admonish note title="Letters play unless you’re typing"
Note letters stop only while a text field or a drop-down has focus, so naming
a sound doesn’t play a melody. A focused control keeps the keys it uses and
lets the letters through. A button, a bank row, and a setting on the rack
reached with the keyboard take Space and Enter; a knob takes the arrows. A click leaves no focus on a button or a setting, so everywhere else
Space plays the sound you’re playing. That is why <kbd>m</kbd> saves a sound,
not <kbd>s</kbd>: <kbd>s</kbd> is a note.
```

### MIDI

Plug in a keyboard and it plays, with velocity, pitch bend, and the sustain
pedal. The right end of the keys bar shows the MIDI state (*midi ●* with a
device connected); click it for the mapping panel.

A controller with knobs works too, with nothing to set up. The first eight
knobs you turn take the first eight of
[PERFORM](./views/perform.md)’s controls (its panel, then BLEND and WANDER), in the order you turn them, and the panel’s **LEARN** remaps any of them. Channel
pressure brightens the sound, the mod wheel drives MOTION, and incoming MIDI
clock sets the tempo. The mapping is remembered for each device.

**The sustain pedal sustains.** A note you release while the pedal is down
rings until the pedal lifts, and lifting it releases exactly those notes.
Notes still under your fingers keep sounding, and a sustained note you strike
again belongs to your finger again. The pedal is separate from **HOLD**, the
keybed’s latch in **KEYS ⋯**.

Web MIDI works in Chrome, Edge, and the other Chromium browsers, and in
Firefox, which asks the first time whether to add a site permission for it.
Safari has none; there the other two ways in still play. When MIDI isn’t
available the keys bar reads *midi ?*, and the panel says why, with **CONNECT
MIDI** to ask again.

**MIDI plays one tab.** With Auracle open twice, the tab you used last plays
MIDI, and the other reads *midi ○*. A click anywhere in it takes MIDI back.

[Keyboard and MIDI](./keyboard.md#midi) has the whole map, including the bend
range, endless encoders, and soft takeover.

## The keybed’s controls

Three sit at the right end of the keys bar:

| Control | What it does |
|---|---|
| **VOL** | The output level, for live keys and every ▶ |
| **MIDI** | The MIDI state, and its panel (above) |
| **● REC** | Records your playing to a WAV |

**KEYS ⋯** beside them opens the rest. It is lit while HOLD, UNI, ARP or SYNC
is on, and its tooltip names which:

| Control | What it does |
|---|---|
| **HOLD** | Latches every note you play until you switch HOLD off or press **◼ SILENCE**. Playing a held note again strikes it again |
| **UNI** | Unison: all four voices on one note, detuned wide |
| **ARP** | The arpeggiator, below |
| **SYNC** | Puts the patch’s step sequencers on the tempo, below |
| **GLIDE** | How long a note takes to slide into the next when you play a line. Chords stay clean |
| **⇕ TALL** | A taller keybed, for fingers. The rack zooms to fit what is left |
| **SPAN** | How many octaves the keybed shows, one to four: fewer octaves, wider keys |
| **◼ SILENCE** | Silences every voice at once |

**KEYS ⋯** stays open while you play through it (the keybed, the octave,
HOLD), and folds on a click outside the keys bar or <kbd>Esc</kbd>.

The keybed’s width starts at three octaves for a mouse and two for a finger.
The narrow sizes center on the computer keyboard’s octave, so what you see
matches what your keys play. The height and width persist.

## The arpeggiator

1. Press **ARP** in **KEYS ⋯**. Its settings show there, under the four buttons.
2. Hold a chord, or latch one with **HOLD**.
3. Set the pattern and rate against it.

| | |
|---|---|
| **PATTERN** | up, down, up and down (*up·dn*), or random (*rnd*) |
| **RATE** | 1/4, 1/8, 1/16, or 1/8 triplet (*1/8t*) |
| **TEMPO** | BPM |
| **RANGE** | How many octaves it walks, one to four |
| **GATE** | Note length, as a share of the step |
| **SWING** | Shuffle |

While ARP or SYNC runs, a chip at the head of the keys bar’s cluster says what
it is set to (`arp 1/8 · 120`), and opens the settings again after **KEYS ⋯**
folds.

The arpeggiator runs inside the audio engine rather than on a page timer, so
it doesn’t drift, and it doesn’t stutter when the screen is busy.

### SYNC

**SYNC** puts the patch’s step sequencers on the arpeggiator’s tempo. Each
plays the musical division nearest the speed it was bred at: a pattern that ran
at 3.7 steps a second becomes eighths at 120 BPM. All of them restart together
with the first key you press, on the same beat the arpeggiator starts.

A five-step pattern still cycles against the bar; that’s the point of it.
Turning a sequencer’s rate knob with SYNC on moves it between divisions, and
the knob reads the rate it plays (`2.1 Hz sync`). SYNC changes only what you
hear: the model still hears every sound free-running.

```admonish info collapsible=true title="How it works: MIDI start and stop"
MIDI start restarts the synced sequencers too, and from then until a MIDI
stop, the clock pulls them back onto its beat once a beat. [The
clock](./keyboard.md#clock) has the rest.
```

## Recording

1. Press **● REC**.
2. Play.
3. Press it again to stop. The WAV downloads.

It records the real output, after the limiter, at the session’s sample rate.
This records what you play, not the standard phrase, and it’s the way to
capture a sound you like. The five-second phrase is there to make sounds
comparable, not to show them off.

## Every sound at one loudness

Every sound is normalized to −18 LUFS before you hear it, in its phrase and in
what the model measures.

A louder sound reliably wins a comparison, so without that the model would
learn “I like loud” and pass it off as a taste in timbre. If a sound seems
quieter than you expect, that’s the normalization at work.

## If it makes no sound

Check in this order:

1. **The pool is still filling.** The first pair is dealt at eight sounds.
2. **No sound is open.** Click a row in the bank.
3. **The browser hasn’t allowed audio yet.** Browsers need a gesture before
   they start audio. Click anywhere, or press a key.
4. **The sound is muted because it failed its check.** A pinned strip says so,
   and stays until it’s resolved.
5. **Voices are stuck.** Press **◼**.

[Troubleshooting](./troubleshooting.md) has more.

## What to try next

- Latch a chord with **HOLD**, turn **ARP** on, and set the rate against it.
- Turn **SYNC** on with a patch that has a step sequencer.
- Play a sound in [PERFORM](./views/perform.md) with the named controls.
