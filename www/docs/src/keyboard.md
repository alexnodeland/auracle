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
| <kbd>Tab</kbd> | Reach the catalogue — one stop per group |
| <kbd>↑</kbd> <kbd>↓</kbd> | Walk the entries |
| <kbd>Enter</kbd> | Arm the module — it is now in your hand |
| <kbd>↑</kbd> <kbd>↓</kbd> | Then walk the **lit sockets**, each announced |
| <kbd>Enter</kbd> | Place it |
| <kbd>Esc</kbd> | Put it down |

The search matches by **sound as well as by name**: *grit*, *vowel*,
*sidechain*, *wander*.

## Gestures

| | |
|---|---|
| Drag a knob | Change it — you hear it immediately |
| Click an enum plate | Cycle it (`saw`, `square`, `−2 oct`) |
| Drag from an **out** jack | Pull a cable; every legal input lights up |
| Drag a wired **in** jack off its socket | Unplug. The chain goes to **HELD** |
| Drag from **HELD** onto a lit ○ | Put it back |
| Click **⋯** on a plate | Bypass, delete, replace with…, insert after… |
| Click **▢** on a plate | Lock the module so evolution cannot touch it |
| Click a knob's lock dot | Lock just that knob |
| Drag a plate by its faceplate | Move it (freeform mode); <kbd>shift</kbd> to ignore the grid |

## MIDI

Plug in a keyboard and it works — no configuration:

| | |
|---|---|
| Note on/off | With **velocity** |
| Pitch bend | Yes |
| Sustain pedal (CC 64) | Yes |

Web MIDI is Chromium-only today. In Firefox and Safari the computer keyboard and
the on-screen keys are unaffected.

## Performance controls

Not keyboard-bound, but this is where people look for them:

| | |
|---|---|
| **HOLD** | Latch notes |
| **◼** | Panic — kill every voice |
| **ARP** | Pattern, division, BPM, octave range, gate, swing |
| **UNI** | Stack all four voices, detuned |
| **gld** | Glide between single notes; chords stay clean |
| **● REC** | Bounce your playing to a WAV |
| **⇕ tall** | Full-height keybed |
| **keys** | Keybed width, 1–4 octaves |
