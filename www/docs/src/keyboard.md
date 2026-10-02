# Keyboard and MIDI map

<p class="lede">Every key and MIDI message Auracle answers to, in one place.
Press <kbd>?</kbd> in the app for the same map without leaving it.</p>

The keys below use the Mac’s ⌘. On Windows and Linux, use Ctrl where you see
⌘: <kbd>⌘Z</kbd> is Ctrl Z, and the app shows it that way there.

## Notes

The home row plays the white keys, and the row above it the black keys:

```text
black:    w  e     t  y  u     o  p
white:  a  s  d  f  g  h  j  k  l  ;  '
```

| | |
|---|---|
| <kbd>a</kbd> <kbd>w</kbd> <kbd>s</kbd> <kbd>e</kbd> <kbd>d</kbd> <kbd>f</kbd> <kbd>t</kbd> <kbd>g</kbd> <kbd>y</kbd> <kbd>h</kbd> <kbd>u</kbd> <kbd>j</kbd> <kbd>k</kbd> <kbd>o</kbd> <kbd>l</kbd> <kbd>p</kbd> <kbd>;</kbd> <kbd>'</kbd> | Play notes |
| <kbd>Shift</kbd> and a note key | The note, harder: an accent. In PERFORM, <kbd>⇧F</kbd> is stage mode instead (below) |
| <kbd>z</kbd> / <kbd>x</kbd> | Octave down / up |

```admonish note
Note letters stop only while a text field or a drop-down has focus, so typing
a name doesn’t play a melody. Everywhere else they play, even with a button or
knob focused, which is why the save key is <kbd>m</kbd> rather than
<kbd>s</kbd>. Two letters are the exception, where something focused uses
them: <kbd>p</kbd> in the presets list plays the preset, and <kbd>L</kbd> in
the rack locks; neither plays its note then. PERFORM’s drop-downs (the XY
pad’s axes, and TOUCH) hand the keys back as soon as you choose, unless you
are stepping through them with the arrow keys.
```

## Everywhere

| | |
|---|---|
| <kbd>Space</kbd> | Hear the sound you’re playing as it stands on the rack: your edits in PATCH, and what you kept or took in PERFORM, without a control turned since or Wander’s drift. Pressed while an edit is on its way, it plays once the edit lands; outside PATCH, *▶ waiting for the edit…* stands in for the sound’s name at the right of the keybed until then. It plays with a knob or a PERFORM control focused. |
| <kbd>[</kbd> / <kbd>]</kbd> | Step through the bank |
| <kbd>1</kbd>–<kbd>5</kbd> | Rate the sound you’re on |
| <kbd>m</kbd> | Save the sound you’re on |
| <kbd>⌘Z</kbd> | Take back your last pick or cut while its seven seconds last, in any view. Otherwise, in PATCH, undo an edit; elsewhere it changes nothing and says *Nothing to undo here. PATCH edits undo in PATCH.* |
| <kbd>⇧⌘Z</kbd> | In PATCH, redo an edit |
| <kbd>?</kbd> | What the PERFORM control under the pointer, or in focus, does (its figure); anywhere else, the key map and gestures |
| <kbd>Esc</kbd> | Close a dialog, put PERFORM’s palette away, or put down a module you picked up |

## In EVOLVE

| | |
|---|---|
| <kbd>1</kbd> / <kbd>2</kbd> | Hear A / B |
| <kbd>←</kbd> / <kbd>→</kbd> | Pick A / B, from the moment you click the EVOLVE tab |
| <kbd>⌘Z</kbd> | Take back your last pick, the sixth included, within seven seconds |

Clicking a view’s tab puts the keyboard in that view. If you reach the tabs
with <kbd>Tab</kbd>, <kbd>←</kbd> and <kbd>→</kbd> move between them.

## The rack canvas

| | |
|---|---|
| <kbd>Home</kbd> | Fit the whole patch |
| <kbd>.</kbd> | Fit what you’re on |
| <kbd>⌘0</kbd> | Actual size |
| <kbd>⌘−</kbd> / <kbd>⌘=</kbd> | Zoom out / in |
| <kbd>Ctrl</kbd> and the wheel, or pinch | Zoom at the pointer |
| The wheel, or a drag on bare canvas | Pan |
| <kbd>Space</kbd> and drag, or a middle-button drag | Pan from anywhere |
| <kbd>Shift</kbd>-click the minimap | Bookmark this spot |
| <kbd>⇧1</kbd>–<kbd>⇧9</kbd> | Jump to a bookmark |

## Inside the rack

<kbd>Tab</kbd> reaches the rack as a single stop, then:

| | |
|---|---|
| <kbd>←</kbd> <kbd>→</kbd> | Move between controls: a module’s knobs, then its buttons (AUDIO IN’s input, **MONITOR** and **NEW CLIP**; CAPTURE’s **RECORD**) |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Turn the focused knob |
| <kbd>Shift</kbd> and <kbd>↑</kbd> / <kbd>↓</kbd> | Fine |
| <kbd>Space</kbd> or <kbd>Enter</kbd> / <kbd>⇧</kbd> and either | Cycle the focused setting (a wave, a filter mode) forward / back. A click leaves no focus on a setting, so Space after a click plays. |
| <kbd>Space</kbd> or <kbd>Enter</kbd> on a button | Press it (AUDIO IN’s input opens its menu) |
| <kbd>L</kbd> | Lock the focused control |

## The bank

<kbd>Tab</kbd> reaches the bank as a single stop, then:

| | |
|---|---|
| <kbd>↑</kbd> <kbd>↓</kbd> | Move the cursor |
| <kbd>Enter</kbd> | Open the sound |
| <kbd>1</kbd>–<kbd>5</kbd> | Rate it |
| <kbd>m</kbd> | Save it |
| <kbd>c</kbd> | Compare a bred sound with its seed |
| <kbd>Enter</kbd> on a sound kept safe | **RECORD AGAIN** (and **STOP**). Past the pool’s last row, the cursor reaches the [sounds kept safe](./playing-through.md#record-into-it-capture) |

In **PRESETS** the cursor keys work the same, <kbd>Home</kbd> and
<kbd>End</kbd> jump to the first and last row, <kbd>Enter</kbd> opens the
preset, and <kbd>p</kbd> plays it.

## The module rail

| | |
|---|---|
| <kbd>/</kbd> | Search the modules |
| <kbd>Tab</kbd> | Reach the rail: one stop per group |
| <kbd>↑</kbd> <kbd>↓</kbd> | Walk the modules |
| <kbd>Enter</kbd> | Pick one up. It is now in your hand |
| <kbd>↑</kbd> <kbd>↓</kbd> | Then walk the lit sockets, each one announced |
| <kbd>Enter</kbd> | Place it |
| <kbd>Esc</kbd> | Put it down |

The search finds a module by sound as well as by name: *grit*, *vowel*,
*sidechain*, *wander*.

## Gestures

| | |
|---|---|
| Drag a knob | Change it; you hear it at once |
| Click a named setting | Cycle it (`saw`, `square`, `−2 oct`) |
| Drag from an **out** jack | Pull a cable; every input it can go into lights up |
| Drag a wired **in** jack off its socket | Unplug it. The chain goes to **SET ASIDE**, and the socket goes quiet |
| Drag from **SET ASIDE** onto a lit ○ | Put it back |
| Click **⋯** on a module | replace with…, insert before…, insert after…, duplicate, set aside, bypass, modulate → *destination*, probe this output, swap the two inputs, delete |
| Click **▢** on a module | Lock the module, so breeding can’t touch it |
| Click a knob’s lock dot | Lock that knob |
| Drag a module by its face | Move it (in freeform); <kbd>Shift</kbd> to ignore the grid |

## In PERFORM

| | |
|---|---|
| <kbd>⇧F</kbd> | Stage mode: the sound you’re playing on the whole screen. <kbd>⇧F</kbd> again or <kbd>Esc</kbd> leaves. It takes the place of F’s accent here; <kbd>F</kbd> on its own is still a note, and in every other view <kbd>⇧F</kbd> is the accented F |

A focused control (reach it with <kbd>Tab</kbd>):

| | |
|---|---|
| <kbd>↑</kbd> / <kbd>→</kbd> | Turn up |
| <kbd>↓</kbd> / <kbd>←</kbd> | Turn down |
| <kbd>Shift</kbd> and an arrow | Fine |
| <kbd>Home</kbd> | Back to the center (BLEND: to *home*; WANDER: to *still*) |
| <kbd>Enter</kbd> | Hear it: a sweep through both ends and back |

A run of arrow presses is one turn. An amber search control, or one still
*listening…*, springs back to the center about half a second after the last
press. A search control turned past its notch then asks, as letting go of a
drag does.

With the mouse: drag up or down, <kbd>Shift</kbd> for fine, double-click a
named control to center it (BLEND and WANDER ignore a double-click),
long-press to hear it, and tap WANDER to freeze it. See
[PERFORM](./views/perform.md).

## MIDI

Plug in a keyboard and it plays, with nothing to set up. Plug in a controller
with knobs, and they work too.

| Message | What it does |
|---|---|
| Note on and off | Plays, with velocity |
| Pitch bend | Bends every voice. Two semitones each way by default; 7, 12, 24, or 48 in the MIDI panel |
| Sustain pedal (CC 64) | Sustains. Notes you release while it’s down ring until it lifts |
| Mod wheel (CC 1) | Adds MOTION on top of where the control sits, unless you learn CC 1 onto a control. With MOTION off PERFORM’s panel, it adds nothing |
| Channel pressure | Adds BRIGHT on top of where the control sits: press harder, brighter. With BRIGHT off the panel, it adds nothing |
| Any other CC | The first eight you move take the first eight controls on PERFORM’s deck, in order. Reserved CCs are never taken (below) |
| MIDI clock | Sets the tempo |
| CC 120, CC 123 | All sound off, all notes off: the same as **◼** |
| CC 121 | Reset all controllers: the mod wheel and pressure add nothing until they move again |

Web MIDI works in Chromium browsers and in Firefox, which asks once whether to
add a site permission for it. Safari has none; there the computer keyboard and
the keybed on screen still play. When MIDI isn’t available, the keybed reads
*midi ?*, and the panel says why and offers **CONNECT MIDI** to ask again.

With Auracle open in more than one tab, MIDI plays the tab you used last. The
others read *midi ○*, and play nothing from MIDI until you click in one.

### The MIDI panel

1. Click the MIDI state at the right of the keybed (*midi ●* with a device
   connected).
2. Press **LEARN** on a row, then move a knob: that knob now drives the row’s
   control (*CC 21 now moves Snap.*). Any knob it replaces is unbound.
3. Press **CLEAR** to unbind a row. It shows only on a row with a knob bound.

The panel lists the first eight controls on PERFORM’s deck and what drives
each. A row is a place on the deck: after you [arrange PERFORM’s
panel](./views/perform.md#the-palette), a row names whatever sits there now. A row with no
knob bound says what does drive it: *mod wheel* on MOTION, *pressure* on
BRIGHT, and *·* elsewhere. Below the rows: a switch for *first knobs you turn
claim free controls*, the bend range, and the incoming clock’s tempo.

### Knobs you turn

With that switch on, the first eight different knobs you move take PERFORM’s
controls in the order you move them, in the deck’s order: with the six,
BRIGHT, SNAP, MOTION, BODY, GRIT, SPACE, BLEND, and WANDER. With seven on the
panel, WANDER falls past the eighth, and with eight BLEND does too: MIDI
doesn’t reach what falls past. Each is announced (*CC 74 now moves Bright, the first free
control.*). The mod wheel is left out, because it already means something.

Some controllers are never taken, by the switch or by **LEARN**, because MIDI
gives them a meaning of their own:

- bank select (CC 0 and 32);
- data entry and (N)RPN (CC 6, 38, and 96–101);
- the sustain, sostenuto, and soft pedals (CC 64, 66, and 67);
- the channel-mode messages (CC 120–127).

So a keyboard that sets its bend range over RPN can’t take a control that
way.

A sound’s controls have to be measured before they turn anything. Moving a
mapped knob measures the sound you’re playing if PERFORM hasn’t already, so the
knobs work from any view.

### Endless encoders

A relative encoder is recognized from what it sends, with nothing to set. An
ordinary knob sends only when its value changes, so it rarely sends the same
number twice in a row; an encoder sends the same small tick over and over.
Once a CC has sent a few values that repeat like that, it is followed
relatively, and a toast says so (*CC 21 is an endless encoder, so it’s followed
relatively.*).

Both common encodings are recognized: two’s complement and
offset around 64. One tick moves a control 1% of its travel.

When in doubt it treats a CC as an ordinary knob. A knob mistaken for an
encoder would be unusable; an encoder mistaken for a knob is only jumpy.

### Soft takeover

An ordinary knob does nothing until it passes through the control’s current
position. Then it takes over. This is often called *pickup*.

It matters here more than on most instruments, because the controls move
without the knob: you can turn a control with the mouse, the keys, or the XY
pad. Without pickup, the first nudge of a knob left at three o’clock would
jump a control that is now at nine. So whenever a control is set some other
way, the knobs bound to it have to pick it up again.

PERFORM also re-centers its controls, after a KEEP, a TAKE, a fresh
measurement, or a Wander glide, without moving the sound. A knob you’re using
isn’t let go then: the control’s new center is where the knob is now. The
knob’s next movement moves the control from there, scaled so each end of the
knob still reaches the same end of the control. Once they agree again, the
knob follows.

BLEND is different. When B empties (you pass on an offer, or take it), BLEND
returns home, and a knob on BLEND is let go. It does nothing until you bring it
back down to home, and then it follows again. Otherwise a knob left near the
top would sweep the whole of BLEND in its last few steps, and the next nudge
would pour the next offer over the sound you chose.

The mod wheel and channel pressure aren’t picked up, because they don’t set a
control’s position. Unless you learn CC 1 onto a control, each adds to the
control it drives, on top of wherever it sits. The wheel pushes MOTION toward
*restless*, and pressure pushes BRIGHT toward *bright*.

At rest they add nothing, so letting go returns the sound to where the
control is. They never count as touching the controls, so they don’t pause
Wander.

### Clock

MIDI clock sets the tempo, which the arpeggiator follows. It needs one full
beat of ticks before it reads anything, updates when the tempo moves by more
than 0.4 BPM, and stays within 30–300 BPM. A gap of more than a second reads as
a stop, not a very slow tempo.

**Start** is a restart: a running arpeggio begins again from its first note if
a chord is held, and with **SYNC** on the step sequencers go back to their
first step. From a Start until a **Stop**, the clock also pulls the synced
sequencers back onto its beat once a beat. Stop silences nothing, and Continue
is ignored.

```admonish info collapsible=true title="How it works: reading the tempo"
The tempo is a least-squares fit over the last two beats of clock ticks, so
one late tick moves it by a fraction of its lateness rather than all of it.
```

### For each device

The mapping, the switch, and the bend range are remembered for each device,
or combination of devices, in this browser. Plug the same controller in
tomorrow, and its knobs mean what they meant today.

## The keybed’s controls

Not bound to keys, but this is where people look for them:

| | |
|---|---|
| **HOLD** | Latch notes |
| **◼** | Silence every voice |
| **ARP** | Pattern, rate, tempo, range, gate, and swing |
| **UNI** | All four voices on one note, detuned |
| **GLD** | Glide between single notes; chords stay clean |
| **● REC** | Record your playing to a WAV |
| **⇕ TALL** | A taller keybed |
| **KEYS** | Keybed width, one to four octaves |
