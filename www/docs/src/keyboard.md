# Keyboard and MIDI map

<p class="lede">Everything bound, in one place. <kbd>?</kbd> in the app shows the
same map without leaving it.</p>

## Notes

An Ableton-style layout across the bottom two rows:

```text
black:    w  e     t  y  u     o  p
white:  a  s  d  f  g  h  j  k  l  ;  '
```

| | |
|---|---|
| <kbd>a</kbd> <kbd>w</kbd> <kbd>s</kbd> <kbd>e</kbd> <kbd>d</kbd> <kbd>f</kbd> <kbd>t</kbd> <kbd>g</kbd> <kbd>y</kbd> <kbd>h</kbd> <kbd>u</kbd> <kbd>j</kbd> <kbd>k</kbd> <kbd>o</kbd> <kbd>l</kbd> <kbd>p</kbd> <kbd>;</kbd> <kbd>'</kbd> | Play notes |
| <kbd>z</kbd> / <kbd>x</kbd> | Octave down / up |

```admonish note
Note letters only reach the synth when focus is **not** in a control, so typing in
a name field does not play a melody. This is also why the bank's save key is
<kbd>m</kbd> rather than <kbd>s</kbd>.
```

## Global

| | |
|---|---|
| <kbd>space</kbd> | Audition the current patch |
| <kbd>[</kbd> / <kbd>]</kbd> | Step through the bank |
| <kbd>1</kbd>–<kbd>5</kbd> | Rate the patch you are on |
| <kbd>m</kbd> | Save the patch you are on |
| <kbd>p</kbd> | In **presets**, play the row |
| <kbd>⌘Z</kbd> / <kbd>⇧⌘Z</kbd> | Undo / redo a workbench edit |
| <kbd>?</kbd> | Key map and gestures |
| <kbd>Esc</kbd> | Close a dialog, or put down an armed module |

## In EVOLVE

| | |
|---|---|
| <kbd>1</kbd> / <kbd>2</kbd> | Audition A / B |
| <kbd>←</kbd> / <kbd>→</kbd> | Vote A / B |
| <kbd>⌘Z</kbd> | Take back a vote |

## The rack canvas

| | |
|---|---|
| <kbd>Home</kbd> | Fit the whole patch |
| <kbd>.</kbd> | Fit what you are on |
| <kbd>⌘0</kbd> | Actual size |
| <kbd>⌘−</kbd> / <kbd>⌘=</kbd> | Zoom out / in |
| <kbd>ctrl</kbd> + wheel, or pinch | Zoom at the pointer |
| wheel, or drag on bare canvas | Pan |
| <kbd>space</kbd> + drag, or middle-drag | Pan from anywhere |
| <kbd>shift</kbd>-click the minimap | Bookmark this spot |
| <kbd>shift</kbd> + <kbd>1</kbd>–<kbd>9</kbd> | Jump to a bookmark |

## Inside the rack

<kbd>Tab</kbd> reaches the rack as a **single** stop, then:

| | |
|---|---|
| <kbd>←</kbd> <kbd>→</kbd> | Move between controls |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Turn the focused knob |
| <kbd>shift</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd> | Fine |
| <kbd>L</kbd> | Lock the focused control |

## The bank

<kbd>Tab</kbd> reaches the bank as a **single** stop, then:

| | |
|---|---|
| <kbd>↑</kbd> <kbd>↓</kbd> | Move the cursor |
| <kbd>Enter</kbd> | Open the patch |
| <kbd>1</kbd>–<kbd>5</kbd> | Rate |
| <kbd>m</kbd> | Save |

## The node bank

| | |
|---|---|
| <kbd>/</kbd> | Focus the search index |
| <kbd>Tab</kbd> | Reach the catalogue: one stop per group |
| <kbd>↑</kbd> <kbd>↓</kbd> | Walk the entries |
| <kbd>Enter</kbd> | Arm the module. It is now in your hand |
| <kbd>↑</kbd> <kbd>↓</kbd> | Then walk the **lit sockets**, each announced |
| <kbd>Enter</kbd> | Place it |
| <kbd>Esc</kbd> | Put it down |

The search matches by **sound as well as by name**: *grit*, *vowel*,
*sidechain*, *wander*.

## Gestures

| | |
|---|---|
| Drag a knob | Change it; you hear it immediately |
| Click an enum plate | Cycle it (`saw`, `square`, `−2 oct`) |
| Drag from an **out** jack | Pull a cable; every legal input lights up |
| Drag a wired **in** jack off its socket | Unplug. The chain goes to **HELD** |
| Drag from **HELD** onto a lit ○ | Put it back |
| Click **⋯** on a plate | Bypass, delete, replace with…, insert after… |
| Click **▢** on a plate | Lock the module so evolution cannot touch it |
| Click a knob's lock dot | Lock just that knob |
| Drag a plate by its faceplate | Move it (freeform mode); <kbd>shift</kbd> to ignore the grid |

## In PERFORM

A focused control (reach it with <kbd>Tab</kbd>):

| | |
|---|---|
| <kbd>↑</kbd> / <kbd>→</kbd> | Turn up |
| <kbd>↓</kbd> / <kbd>←</kbd> | Turn down |
| <kbd>shift</kbd> + arrow | Fine |
| <kbd>Home</kbd> | Back to the centre (Blend: to *home*; Wander: to *still*) |
| <kbd>Enter</kbd> | Hear it: a sweep through both ends and back |

With the mouse: drag up or down, <kbd>shift</kbd> for fine, double-click to
centre, long-press to hear it, a short tap on Wander to hold it. See
[PERFORM](./views/perform.md).

## MIDI

Plug in a keyboard and it works, with no configuration. Plug in a controller
with knobs and they work too.

| Message | Does |
|---|---|
| Note on/off | Plays, with **velocity** |
| Pitch bend | Bends every voice. Range **±2** semitones by default; ±7, ±12, ±24 or ±48 in the MIDI panel |
| Sustain pedal (CC 64) | Sustains. Notes you release while it is down ring until it lifts |
| Mod wheel (CC 1) | Drives **Motion**, unless you learn CC 1 onto another control |
| Channel pressure | Drives **Bright**: pressing harder turns it from the centre toward *bright* |
| Any other CC | The first eight you move claim PERFORM's controls, in order |
| MIDI clock | Sets the tempo |
| CC 120, CC 123 | All sound off / all notes off: the same as **◼** |

Web MIDI works in Chromium browsers and in Firefox, which asks once whether
to add a site permission for it. Safari has none; there the computer keyboard
and the on-screen keys still play. When MIDI is not available the dock reads
`midi ?`, and the panel says why and offers **connect midi** to ask again.

### The MIDI panel

Click **midi** in the dock (it reads `midi ●` when a device is connected). The
panel lists PERFORM's eight controls, what drives each, and two buttons per
row:

- **learn**: the next CC you move is bound to this control. Any CC it
  replaces is unbound.
- **clear**: unbind this control.

Below the rows: a switch for auto-mapping (*first knobs you turn claim free
controls*), the bend range, and the incoming clock tempo.

### Knobs you just turn

With auto-mapping on, the first eight distinct CCs you move claim PERFORM's
controls in the order you move them: **Bright, Snap, Motion, Body, Grit, Space,
Blend, Wander**. Each claim is announced (*mapped: CC 74 → Bright*). The mod
wheel and the sustain pedal are left out, because they already mean something.

The controls are measured when PERFORM first shows a patch, so a mapped knob
moves nothing on a patch PERFORM has not measured yet. Open PERFORM once and
the knobs work from any view.

### Endless encoders

A relative encoder is recognised from what it sends, with nothing to set. An
ordinary pot only sends when its value changes, so it rarely sends the same
number twice in a row. An encoder sends the same small tick over and over. Once
a CC has sent a few values that repeat like that and sit where encoder ticks
sit, it is followed relatively and the note lane says so (*CC 21 is an endless
encoder*). Both common encodings are recognised: two's complement and
offset-around-64. One tick moves a control 1% of its travel.

When in doubt it treats a CC as an ordinary pot. A pot mistaken for an encoder
would be unusable; an encoder mistaken for a pot is only jumpy.

### Soft takeover

An ordinary pot does nothing until it passes through the control's current
position. Then it takes over. This is often called *pickup*.

It matters more here than on most instruments, because the controls move
without the pot. Wander drifts the sound and re-centres the controls, and you
can turn a control with the mouse or the keys. Without pickup, the first nudge
of a pot left at three o'clock would snap a control that is now at nine.
Whenever a control moves by the mouse, the keys or Wander, the pots bound to it
have to pick it up again.

The mod wheel works the same way. With Motion at its centre, the wheel takes
over as it passes its halfway point; below that it makes the sound stiller,
above it more restless. Channel pressure is not picked up: it only ever
brightens from the centre, and letting go (pressure back to zero) returns
Bright to the centre.

### Clock

MIDI clock sets the tempo, which is what the arpeggiator follows. The tempo is
a least-squares fit over the last two beats of clock ticks, so a single late
tick moves it by a fraction of its lateness rather than all of it. It needs one
full beat of ticks before it reads anything, updates when it moves by more than
0.4 BPM, and stays within 30–300 BPM. A gap of more than a second is read as a
stop rather than a very slow tempo.

**Start** is a restart: a running arpeggio begins again from its first note if
a chord is held, and with **SYNC** on the step sequencers go back to their first
step. From a Start until a **Stop**, the clock also pulls the synced sequencers
back onto its beat once a beat. Stop silences nothing, and continue is ignored.

### Per device

The mapping, the auto-mapping switch and the bend range are remembered for each
device, or combination of devices, in this browser. Plug the same controller in
tomorrow and its knobs mean what they meant today.

## Performance controls

Not keyboard-bound, but this is where people look for them:

| | |
|---|---|
| **HOLD** | Latch notes |
| **◼** | Panic. Kills every voice |
| **ARP** | Pattern, division, BPM, octave range, gate, swing |
| **UNI** | Stack all four voices, detuned |
| **gld** | Glide between single notes; chords stay clean |
| **● REC** | Bounce your playing to a WAV |
| **⇕ tall** | Full-height keybed |
| **keys** | Keybed width, 1–4 octaves |
