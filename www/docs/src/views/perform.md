# PERFORM: the sound under your hands

<p class="lede">PERFORM is for playing a sound. It shows the sound large, in
a well, and gives you up to eight controls named for what you hear, chosen
from a palette of eighteen, WANDER and four pads, and nothing in it stops to
ask you a question.</p>

<!-- film:view-perform --><!-- /film:view-perform -->

[PATCH](./play.md) shows what a sound is made of, knob by knob. PERFORM is for
playing it: you reach for *brighter*, not for a filter’s cutoff, and the
instrument works out which of this patch’s knobs make it brighter. It plays
the sound already under your fingers, and the keybed below is the same one
every level shares. It is the middle of [the levels](../levels.md), where the
app opens: zoom out (<kbd>⌥↑</kbd>) to TASTE, in (<kbd>⌥↓</kbd>) to PATCH, or
step beside it (<kbd>⌥←</kbd>) to EVOLVE.

## Play it

1. Play a key: <kbd>A</kbd> to <kbd>L</kbd> on your computer keyboard, or tap
   the keybed.
2. Turn a named control: drag it up or down. Double-click it to go back to the
   center.
3. Press **OFFER** (<kbd>N</kbd>), then hold **PEEK** (or hold <kbd>B</kbd>) to
   hear the variant it grew beside your sound, or press **TAKE**
   (<kbd>⇧↵</kbd>) to make it yours.
4. Once the sound has moved, *moved · KEEP · BACK* shows by its name. Press
   **KEEP** (<kbd>↵</kbd>) when you like where you are; **BACK**
   (<kbd>⇧⌫</kbd>) returns there.
5. Turn **WANDER**, at the start of the pads, up, and let the sound move on
   its own.

Until you have done five first steps once, a pill at the bottom left shows
them one at a time, with a pip for each, and ticks each off as you do it:
the first three above, then zoom out to [TASTE](./taste.md)
(<kbd>⌥↑</kbd>, or a pinch on a touch screen), and hold <kbd>⌥</kbd>
(**MODEL** on a touch screen) to see what the model believes. Its second
step names a control that turns on this sound (*Turn BRIGHT: drag up or
down*), never one it can’t reach. Its **×** stops it showing.

## What you see

<img src="../img/perform.webp" alt="PERFORM: on the left the sound's family and name, large, and a well holding its face, with B's amber face beside it; on the right CONTROLS with six round controls in two rows, the knobs they turn, and the pads Wander, Next, Peek, Take and Pass." loading="eager" width="1440" height="900">

On the left, the sound:

- **The head.** Its family and *in hand* (*BASS · IN HAND*; the family only
  for a sound opened from the library and not edited since: a bred or edited
  sound has none, so it reads *IN HAND*), its name, large, with **share**
  beside it, and its blurb where it has one. Share opens **Download a
  picture** on *the sound’s card*: its face, its name and its patch in one
  picture. When the sound has moved from home, *moved · KEEP · BACK* shows at
  the end of the first line (see [the pads](#the-pads)).
- **The well.** The sound’s [face](../faces.md), large, standing on a floor
  that reflects it, as stage mode draws it. The face is the sound as it was
  last rendered, so turning a control doesn’t change it; keeping or taking
  does. Click it to play the phrase, as <kbd>Space</kbd> does. While B holds
  an offer, B’s face stands beside it in amber, with **BLEND** under the two
  (see [Blend, Peek, and B](#blend-peek-and-b)); a click on B’s face plays
  nothing, since B is heard with **PEEK** or by holding <kbd>B</kbd>. In its corner: **XY** (see
  [the XY pad](#the-xy-pad)) and **⇧F** for [stage mode](#stage-mode); in
  the top left, a small trace of what is sounding now.

On the right, what you turn:

- **CONTROLS**, with **ARRANGE** (see [the palette](#the-palette)) and
  **HOW IT WORKS** (see [How it works](#how-it-works)), then a status line
  saying what PERFORM is doing with the sound: *listening to this sound…*
  while it measures a new one, then *4 of 6 controls reach this patch*, with
  *re-checking* after it while it measures again in the background, or
  *listening to Bite…* while it measures a control you just placed. If the
  engine fails partway, it says so instead: *couldn’t measure this patch*,
  or, after the count, *couldn’t re-check this patch* when the controls
  still play on their last measurement. After the engine has crashed,
  PERFORM asks it for nothing more: an offer it would have to grow says
  *the engine crashed: reload to continue* (one grown ahead before the
  crash still comes into B).
- **Your controls**, three to a row: to start, **BRIGHT**, **SNAP**,
  **MOTION**, **BODY**, **GRIT**, and **SPACE** (a longer panel takes four to
  a row). The line under each says what it turns, or what state it’s in;
  under the model view (hold <kbd>⌥</kbd>), which way your taste leans along
  it (see [which way your taste leans](#which-way-your-taste-leans)). A
  small *vel* on one says your velocity plays it (see [what velocity
  plays](#what-velocity-plays)).
- **UNDER THE HOOD.** The patch’s own knobs the controls and Wander are
  turning right now, each a bar with its value in its own units.
- **The pads:** **WANDER**, ringed in amber, then **OFFER**, **PEEK**,
  **TAKE** and **PASS**, each with its key. On a window under about 1360
  pixels wide, WANDER takes a line of its own above the four.

**Show measurements**, in [⌘K](../levels.md#k-find-anything), adds the
numbers behind each control to its tooltip: purity, reach in σ, the measured
halves, and the knob gains.

### What velocity plays

**ARRANGE** has a row, **Velocity plays**: what your playing velocity drives,
*loudness only* or one of the named controls that turns both ways on this
sound (*bright: soft dark, hard bright*), with **depth**, a slider for how far
it reaches, and a note naming the knobs velocity moves. The control it plays
carries a small *vel* in its corner.

## The named controls

The panel starts with six:

| Control | Low · high | What moves in the sound |
|---|---|---|
| **BRIGHT** | dark · bright | Where the energy sits, low or high |
| **SNAP** | bloom · snap | How fast the attack is, and how sharp its peak |
| **MOTION** | still · restless | How much a held note moves: slow sweeps, pulsing, and flutter |
| **BODY** | thin · full | How much weight sits below about 250 Hz |
| **GRIT** | smooth · rough | How noisy the sound is, rather than tonal |
| **SPACE** | close · far | How loud the tail is after the notes stop |

The name is fixed, and the knobs behind it are not. Each control is wired to
at most four of this patch’s knobs: the ones that move the sound most purely
in its direction. A full turn moves any one knob at most half its range. Hover
a control to see which knobs it moves, how purely, and how far it measured.

A small amber dot on a control’s outer ring shows where the sound measures on
that axis, compared with the sounds in your session. A sound that is already
very bright has its BRIGHT dot near the right stop.

A named control is in one of four states, each with its own look:

| Look | Line under it | What it means |
|---|---|---|
| A solid ring both ways | the knobs it turns (*mod depth · lfo rate +2*), or one and how many more when two names would run long | It turns both ways on this sound |
| Solid on one side, dotted on the other, a stop at the top | *turns toward restless only* | It turns one way only (see [half-closed controls](#half-closed-controls)) |
| Amber, a dashed ring | *turn to ask for it* | This patch’s knobs can’t do it (see [search controls](#amber-dashed-search-controls)) |
| Dim, a thin ring | *listening…* | Not measured on this sound yet. It does nothing, and springs back |

### The palette

The six are a start. **ARRANGE** opens the palette: all eighteen controls the
instrument can measure, in six families, with the ones on your panel at the
top.

| Family | Controls (low · high) |
|---|---|
| Tone | **BRIGHT** (dark · bright), **WARMTH** (cold · warm), **AIR** (closed · airy) |
| Weight | **BODY** (thin · full), **THUMP** (light · thumping), **HEFT** (slight · heavy) |
| Dynamics | **SNAP** (bloom · snap), **PUNCH** (gentle · punchy), **ROUND** (hard · round) |
| Movement | **MOTION** (still · restless), **THROB** (steady · throbbing), **SWAY** (fixed · swaying) |
| Space | **SPACE** (close · far), **DISTANCE** (near · distant), **HAZE** (clear · hazy) |
| Character | **GRIT** (smooth · rough), **BITE** (mild · biting), **LO-FI** (clean · worn) |

1. Press **+** on a control to place it on the panel, at the end. Up to eight
   sit there at once; with eight placed, **+** waits until you hide one.
2. Press **×** to hide one. One always stays.
3. Press **↑** or **↓** to move one earlier or later.

The panel is kept with your session, through a reload. Press <kbd>Esc</kbd>
or **×** at the top to put the palette away. It is a panel, not a dialog: the
keys play while it is open.

Each placed control has a mark to the left of its name: a green dot where it
turns this sound, a dashed amber ring where this patch’s knobs can’t reach it
(a [search control](#amber-dashed-search-controls)), and a dotted amber ring
with *listening…* while it is being measured. A control that isn’t placed
isn’t measured, and has no mark.

**A placed control is measured on the sound you’re playing, and only then.**
Each control on the panel costs about five renders a sound, so nothing off
the panel is measured. While it is, the control reads *listening…* in amber
where the line under it goes, and the status line names it (*listening to
Bite…*). The controls beside it keep playing. A set of controls measured on
a sound before is kept, so on that sound it plays at once, after a reload too.

Hiding a control you have turned leaves the sound where it is: what it was
doing stays in the knobs, and the controls you keep turn on from there.
**BACK** returns to the last sound you kept, from before it; ⌘Z doesn’t,
because hiding a control is not an edit of the patch. A mod wheel or
pressure held on the control you hide is let go. If velocity was playing
it, velocity moves to the first control left that turns both ways, or to
loudness only, and a note says which. Reordering costs nothing at all: the
same controls are the same measurement.

```admonish info collapsible=true title="How it works: measuring a sound’s controls"
The first time PERFORM plays a sound, it nudges each of the patch’s knobs
once, renders the result, and measures how the sound moved. Each control is a
direction in what the instrument can hear, and it is wired to the knobs that
move the sound that way and little else. Each half of the control is then
checked on real renders.

Measuring costs one render per knob, plus up to four more per control to check
the result, so a large patch takes a moment. Meanwhile every control reads
*listening…*, and the keys play throughout.

The controls are measured together, in the palette’s order rather than your
panel’s. Two controls whose moves on a patch would be one gesture are one
control with two names there, so the later one in the palette is a search
control on that patch. That is why a palette control can be amber on a sound where
it would turn with fewer controls beside it.

The presets don’t wait: each was measured when the app was built, so its six
controls work the moment it opens. That measurement used a standard pool
rather than yours, so PERFORM measures the preset again in the background,
with *re-checking* on the status line meanwhile. A sound you have played
before is as quick, from its last measurement, even after a reload.

MOTION listens to the [motion bands](../../reference/features/audio.html#motion-bands).
The rest are [perceptual descriptors](../../reference/features/audio.html) of
the same render the taste model hears. [Performance: named controls and the
drift walk](../../reference/search/perform.html) has the wiring in full.
```

### Turning them

| | |
|---|---|
| Drag up or down | Turn it. The full range is about 180 pixels |
| <kbd>Shift</kbd> and drag | Fine |
| Double-click | Back to the center |
| Near the center | A light detent, so you can find the center by feel |
| Long-press, about half a second, without moving | Hear it; on a touch screen, see it (its figure) |
| <kbd>?</kbd> with the pointer over it, or its **?** chip | See what it does: its figure |

Turning a control changes knob values only. The voices take them without
rebuilding the patch, so a held chord keeps sounding through the turn.

**The controls re-center without moving the sound.** After a KEEP, a TAKE, a
fresh measurement, or a Wander glide, what the controls were doing is folded
into the patch, and they return to 12 o’clock. The pointer glides home over a
quarter of a second, and a faint tick marks where it was. A MIDI knob on a
re-centered control keeps working from where it is (see [soft
takeover](../keyboard.md#soft-takeover)).

### Long-press to hear it

A long-press with a mouse plays the control to you. Over about two and a half
seconds it sweeps to the low end, across to the high end, and back to where it
was. If no note is held, it plays a C3 for the length of the sweep. On a touch
screen a long press opens the control's figure instead (below), and its **HEAR
IT** plays the same sweep.

This is the quickest way to learn what a control does on this sound, since the
same name moves different knobs on different patches.

### Ask what it does

Point at a control and a small **?** appears beside it. Press it, or press
<kbd>?</kbd> while the pointer is over the control or it has focus, or hold it
on a touch screen (a ring fills under your finger, then it opens). An answer
opens beside the control: **BRIGHT · WHAT IT DOES**, a figure, and a sentence.

The figure is the sound in your hands rendered twice, once with the control
at its center and once turned, and each render measured the way the model
hears it. A turn means where you have the control; at the center, a full turn
toward the end it opens to. The render with the control at its center is
dashed, the turned one lit. What the figure draws is the measurement the
control listens to:

| Control | The figure |
|---|---|
| **BRIGHT**, **BODY**, **WARMTH**, **AIR** | The sound's [face](../faces.md), low at the base (its spectrum stood up while your bank holds under four faces), beside how much each band rose or fell (±24 dB), with a dotted line at what the control listens to: the center for BRIGHT, where the top rolls off for AIR, 250 Hz for the weight |
| **SNAP**, **ROUND** | The first note's first 400 ms, with a tick where each reaches 90% of its peak |
| **SPACE**, **DISTANCE**, **HAZE**, **PUNCH**, **THUMP**, **HEFT** | The phrase's level over its five seconds, with the notes above it; for the space controls, the last 300 ms shaded |
| **MOTION**, **THROB**, **SWAY** | The held note's brightness or its level over time, whichever the turn moved more, running at its own pace |
| **GRIT**, **BITE**, **LO-FI** | The held note's harmonics, up to 4 kHz, and what lies between them |

The sentence says the measurement before and after, in its own unit, then
what the control turns on this sound: *Turned to bright, its center moves
from 359 Hz to 2.5 kHz. Here it turns filter cutoff.* A control nothing here
turns says so, and gives the measurement as it stands. While the two renders
are made (about half a second), the figure reads *measuring…*; one you have
asked about before opens at once.

The figure draws itself in, band by band or along time, and holds; MOTION's
keeps running while it is open. Click it to draw it again. Under reduced
motion it is drawn whole at once.

Every control on the panel is a tap away under the figure, or an arrow key.
Turn the control while its answer is open and the answer follows: a moment
after your hand rests, it is measured again, and the last figure stays,
dimmed, under *measuring…* until the new one is drawn. A control placed from
the palette and asked about before it has been measured says so, and answers
once it has. <kbd>Esc</kbd>, the ×, a click
elsewhere, another level, or booth mode's attract puts it away. **HEAR IT**
plays the long-press sweep. <kbd>Space</kbd> still plays the sound while it
is open, after a click on one of its buttons too, and <kbd>?</kbd>
answers for the control under the pointer, or one you reached with the
keyboard; a control you just turned with the mouse, once the pointer has
left it, is not asked again, and <kbd>?</kbd> opens [⌘K’s
list](../levels.md#k-find-anything) instead. In ⌘K, *What does BRIGHT do?*
opens BRIGHT’s answer while BRIGHT is on the panel, and *Learn: what a filter
does* opens the lesson below from any level.

### Learn: what a filter does

BRIGHT's answer has a **LEARN: WHAT A FILTER DOES** button, a lesson of about
a minute that uses the sound in your hands as its example. It has three steps;
<kbd>Enter</kbd> or **NEXT** moves on, and <kbd>Space</kbd> plays the step's
sound wherever focus is in the lesson (NEXT and DONE take <kbd>Enter</kbd>).

1. **A sound has a shape.** The sound's [face](../faces.md), low at the base:
   wide where it has more than most of your sounds, narrow where it has less
   (with under four faces in your bank, its spectrum stood up instead). Play
   it, and a bright line shows what you hear as it plays, against the same
   bank.
2. **A filter lets some through.** A lowpass filter from the instrument's own
   modules is put on the sound, and you drag its **cutoff** along the graph
   (or use the arrow keys, and <kbd>Home</kbd> and <kbd>End</kbd> for its
   ends). Each position is rendered: the filter's own curve
   lights the graph, the shape's top narrows above the cutoff while the
   unfiltered shape stays dashed behind it, and **PLAY … THROUGH IT** plays
   the filtered sound, looping, so a new cutoff is heard in place. Each
   cutoff is played as loud as the sound itself (every phrase the instrument
   plays is set to one loudness), so you hear it darken, not fade. The
   cutoff is the knob's value in its own unit on the held note, as PATCH
   shows a filter's cutoff.

   A sound with no room for one more module (about one pool sound in ten;
   none of the presets) gets the filter after it instead, at one cutoff for
   every note, and the lesson says so. If the filtered sound doesn't render
   at a cutoff (it goes silent, or doesn't pass the
   [vet](../glossary.md#vetting)), the
   lesson says that too, draws no curve for it, and plays nothing under
   **THROUGH IT**; another cutoff may. If the sound itself doesn't render,
   the lesson says why and has nothing to play.
3. **What to remember.** What a lowpass does, and what BRIGHT turns on this
   sound: a filter's cutoff on some sounds, other knobs on others.

The filter is only the lesson's. **DONE** (or <kbd>Esc</kbd>) leaves the
sound as it was. The keyboard plays the sound without it.

```admonish info collapsible=true title="How it works: a figure"
A control is a direction in what the instrument can hear, wired to the knobs
of each sound, so its figure can't be drawn from a recipe. PERFORM hands the
engine the sound as you are playing it, twice, and the engine renders and
measures each: its spectrum, its first note's attack, its level, its held
note's brightness and harmonics, and the same measurements the model is
taught with. The lesson's filter is the instrument's own lowpass, inserted
at the output below any reverb, chorus, phaser or flanger that ends the
chain, and its curve is measured from the filter itself.
[Explaining a control](../../reference/search/explain.html) has the details.
```

### Half-closed controls

Sometimes a control can only go one way. A sound with no movement at all
can’t be made stiller, and the knobs that would try may do something else. On
First Bass, turning MOTION down made the sound very slightly more restless:
the opposite of its name.

So each half of each control is checked on real renders before it is offered,
and a half that didn’t move the sound the way its word says is closed. The
ring is solid on the side you can turn toward and dotted on the other, with a
stop at the top. The control won’t go past the center on the closed side, and
the line under it says which way it turns:

```text
turns toward restless only
```

That is a statement about the control, not about where the sound sits. The
amber dot can sit anywhere.

### Amber, dashed: search controls

A control drawn in amber with a dashed ring is a **search control**: this
patch’s knobs can’t make that change. A patch with no drive can’t get rougher
by turning a filter, and one with no delay or reverb can’t get much farther
away. Over the preset library, GRIT and SPACE are search controls on most
sounds for that reason.

1. Turn it past the amber notch, three tenths of the way to either end. The
   line under it reads *turn further to ask* short of the notch, then *let go
   to ask for rough*, or *let go to add a tone EQ*.
2. Let go. It always springs back to the center.

Let go short of the notch, and it asks nothing. Past it, one of two things
happens.

**Where one change would give it something to turn, that change is made.**

| Control | What it gets |
|---|---|
| **BRIGHT**, **BODY** | A tone EQ at the end of the chain, before any reverb, chorus, phaser, or flanger. It starts flat, so the sound doesn’t change until you turn it |
| **SPACE**, turned up | A longer amp release (about 250 ms), because every effect sits before the amp envelope, and a reverb’s tail is cut at note-off |

The toast says *Bright: giving it a tone EQ to turn…*. The change goes onto
the sound as one undo step, and the patch is measured again. The control is
set to where your hand left it, and the toast then names the knobs it turns.
Each control gets this once per sound, never twice.

**Otherwise** (SNAP, MOTION, GRIT, SPACE turned down, or a change that still
didn’t reach it), no knob moves. An **offer** is grown from the sound,
**aimed the way you turned**, and arrives in **B**. The toast says so (*Grit:
no knobs here make it rough, so it’s growing a grittier offer instead.*), and B
counts the seconds while it grows.

When it arrives, B says how far it went, in amber: *grittier by 1.8σ*. σ is
the spread of the sounds in your session, so *by 1σ* is about as far as a
working control moves the sound at a full turn. When the walk didn’t get
there, B says so: *not grittier: this walk found no way there. Turn it again
to try another*.

```admonish info collapsible=true title="How it works: an aimed offer"
The offer is a variant grown from where you are, on the same walk breeding
uses, pulled the way you turned. Every variant it tries is measured, and one
that goes further the way you asked counts for more. Your taste still counts,
so it doesn’t trade everything you like for the one thing you asked for.

It may add or change a module, so it can bring in the noise or the release
the patch lacked. If the first walk hasn’t moved that way, it keeps walking
from where it stopped, up to three walks. That is why an aimed offer can take
longer than one from the OFFER pad.

GRIT gets no added module because of what it measures: noisiness. A drive adds
harmonics, which read as brighter, and a bitcrusher is transparent only at 16
bits, where turning it changes nothing measurable.

Over sixteen presets, GRIT turned up came out grittier in about two offers of
three before any picks, and in about half once the model had learned a taste
that dislikes noise. An offer from the OFFER pad did one time in seven or
fewer. It can’t go where there is nowhere to go: a sound with no noise can’t
get smoother, and one with no tail can’t get closer.
```

### Which way your taste leans

Hold <kbd>⌥</kbd> (Alt off Apple platforms), or press and hold **MODEL** in
the menu bar, and each control shows which way your taste leans along it,
from the sound in your hands. An amber arc runs from 12 o’clock toward the end
it leans to, just outside the ring, and the line under the control says it in
the model’s words:

```text
it leans brighter
it leans softer?
```

The longer the arc, the more the model’s rating of a sound changes as it moves
that way: the whole panel is drawn on one scale. Behind it, a thin arc shows
how far that could be off. When that thin arc crosses 12 o’clock, the model
can’t yet tell which way you lean, so the lean is drawn as a guess: dashed and
faint, its words ending in **?**, as LEARNING marks one. Before the model has
fitted anything there is no lean, and nothing is drawn.

A lean is about your taste, not the knobs. An amber, dashed search control
has one too: its knobs can’t move the sound that way, but your taste may
still lean there. Let go of <kbd>⌥</kbd> and the lines under the controls are
back. The lean is asked for as the view comes up, and again when the sound in
your hands changes (for a sound with AUDIO IN, a new
[clip](../playing-through.md#the-clip-what-the-model-hears) too) or the model
learns from a pick or fits again. Open a taste file and the leans go until the
model has fitted again (at once from a file with picks in it; from one with
none, once you have taught it).

```admonish info collapsible=true title="How it works: a lean"
Each control is a fixed direction in the measurements the model hears. Its
lean is the slope of the model’s rating along that direction at the sound in
your hands, as a mean over the model’s draws and one standard deviation. Your
taste is a set of styles, and a sound is rated by the style that likes it
most, so in each draw the slope is that style’s. Far enough along a control,
another style may take the sound over, so a lean is true near here, not along
the whole control. It is taken at the sound as it stands, without your turns:
turning a control doesn’t redraw it.
```

## How it works

To see what one control does to this sound, [ask it](#ask-what-it-does).
**HOW IT WORKS**, in CONTROLS’ head, opens in the well over the dimmed face,
on the control you last touched, with every control on the panel a tap away;
the controls stay in reach beside it. **×**, <kbd>Esc</kbd> or HOW IT WORKS
again puts the face back. For each, it says what you hear it do
(*A soft attack and few harmonics.*), what it listens to, and what it does on
this sound, from its measurement: the knobs it turns (*On this sound it turns
amp attack and filter cutoff.*), that nothing here turns it, or that it hasn’t
been measured yet. Under that, the rest of this page in short: the amber dot,
half-closed controls, search controls, and WANDER.

## Opening the circuit

Everything PERFORM does lands on real knobs, and PATCH shows it while it
happens. A knob PERFORM is playing away from its kept value carries a second,
**amber** pointer at the value sounding, and its readout shows that value in
amber. The green pointer is the kept value. Hover the amber pointer to see
what is moving it.

**KEEP** writes the amber into the patch, and the two pointers become one.
It works the other way too: a knob you turn in PATCH is the kept value from
that moment, PERFORM plays from it, and BACK glides home to it.

Click a knob under **UNDER THE HOOD** to open its module in [PATCH](./play.md),
pulsing where it is.

## The XY pad

**XY**, in the well’s corner, puts two named controls under one finger: the
well becomes the pad, with the face dimmed behind it, the axis drop-downs
along its top and each control’s end words at its edges. **XY** again, or
<kbd>Esc</kbd>, puts the face back. It starts as BRIGHT across and
MOTION up, and either axis can be any control on the panel.

1. Choose an axis from its drop-down. The note keys play straight away after,
   so a note letter can’t change the axis.
2. Drag to play both controls at once. Double-click to go back to the center.
3. With the pad focused, use the arrow keys. Hold <kbd>Shift</kbd> for fine
   steps.

The pad follows the controls, so turning BRIGHT on its dial moves the dot
too. Only an axis whose control reaches the sound moves. A search control’s
end words are struck through, and an axis not measured yet is dimmed, with
*listening to this sound…*. The pad has no “turn to ask” gesture; use the dial
for that.

## Blend, Peek, and B

An offer is a second sound in a second set of voices that follows the same
hands: every note you play sounds on both. You hear B by crossfading to it,
never by a jump.

B stands in the well beside your sound: its label (**B**, or **B · GRITTIER**
for an [aimed offer](#amber-dashed-search-controls)), its face in amber, and
under its floor what changed, then where it grew from and how to hear it
(*grown toward your taste · offered · hold B to peek*). While an offer grows,
B says so where its face will be (*growing an offer…*). With nothing in B,
your sound stands alone.

- **BLEND**, the slider under the two faces while B holds an offer, sets the
  mix, from *home* at the left to *B* at the right.
- **PEEK** plays B alone for as long as you hold it, or hold <kbd>B</kbd>.
  Let go, and the mix returns to wherever BLEND is.
- **TAKE** (<kbd>⇧↵</kbd>) makes the offer your sound.

The named controls turn the sound you’re on, not the offer.

**What you see is what happened.** An offer is grown from the sound you’re
playing, so B grows out of the sound’s face into its place. TAKE fills B with
green from the bottom, and B goes into the face: it is the sound you play
now, heard or not. NEXT folds B back into the face it grew from: it is dropped, nothing
joins the pool, and you keep playing what you had. With reduced motion on,
nothing moves: B fills for a moment when taken, and empties when passed.

```admonish info collapsible=true title="How it works: matched loudness"
The crossfade is equal-power, so the level stays roughly steady across it,
and B plays at matched loudness: normalized to −18 LUFS, as every sound is. A
louder sound reliably wins a comparison, so without that the crossfade would
be a volume knob.
```

## Wander

WANDER sets how alive the sound is on its own. It is one dial with four
zones, left to right:

| Zone | What happens |
|---|---|
| **still** | Nothing moves unless you move it |
| **ideas** | About every 24 seconds, if B is empty, an offer grows into it |
| **drift** | The knobs glide to a nearby setting the walk prefers: one move every 36 seconds at the left of the zone, every 14 at the right, each glide taking six to four seconds |
| **roam** | The same, with longer walks and so bigger moves: one every 12 to 7 seconds, gliding in three to two |

Three short ticks outside the ring mark where *ideas*, *drift*, and *roam*
begin. Let go of WANDER in a new zone, and it answers in a second and a half;
the zone’s pace sets the moves after that.

The line under WANDER says what it is doing:

- *drift · next in 9 s* while it waits, with a thin amber arc inside the ring
  filling toward that move;
- *drift · walking…* while the walk looks for the next setting;
- *drift · gliding* while the knobs glide;
- *ideas · one in B* while B holds an offer;
- *paused 3 s* while your hands are on other controls;
- *frozen* while it is frozen;
- *nothing better nearby* when the walk finds nothing it prefers, and stays.

Wander runs only while PERFORM is on screen.

**Structure never changes on its own.** Drift and roam move knob values only,
and they respect the locks you set in PATCH. A new module only ever arrives as
an offer in B, and becomes your sound only if you take it.

**Hands on, it waits.** Touching any other control or pad, or moving one from
MIDI, pauses Wander for three and a half seconds, and the line counts them
down. A touch mid-glide stops the glide where it is, and the sound stays
there. Turning WANDER itself is not a touch: it waits while you turn it, and
answers once you let go.

**Tap to freeze.** A short tap on WANDER stops it where it is: its ring
lights, and the line reads *frozen*. Tap again to release it. With WANDER
focused, <kbd>Enter</kbd> does the same. Freeze has no key of its own.

## The pads

| Pad | Key | What it does |
|---|---|---|
| **WANDER** | | How alive the sound is (see [Wander](#wander)); a tap freezes it. Not **HOLD** in the keys bar’s **KEYS ⋯**, which latches notes |
| **OFFER** | <kbd>N</kbd> | Grows a variant from here into B. The first is usually there at once, grown ahead once the sound has been steady for a few seconds and your hands have been off it for two |
| **NEXT** | <kbd>N</kbd> | What OFFER reads while B holds an offer, with *passes on B* under it. It passes on B (B empties, BLEND glides home) and brings the next, which has been growing meanwhile |
| **PEEK** | hold <kbd>B</kbd> | Hold to hear the offer alone |
| **TAKE** | <kbd>⇧↵</kbd> | Makes the offer in B your sound. It becomes home, with *(taken offer)* after its name, and BLEND returns home. The controls play on while the taken sound is measured, and the status line says *re-checking* until it is |
| **PASS** | | Passes on B without growing another: B empties and BLEND glides home. A pass as NEXT’s is, with the same UNDO |

PEEK, TAKE and PASS wait, dashed, with *needs an offer* under them, until B
holds one.

**Moved · KEEP · BACK.** When the sound has left home (a control turned, a
drift not kept, a glide under way), *moved · KEEP · BACK* shows at the end of
the head’s first line, in a place it always keeps, so nothing moves when it
comes or goes.

| | Key | What it does |
|---|---|---|
| **KEEP** | <kbd>↵</kbd>, with nothing focused | Makes the sound you hear home: *Kept: this is home now. Back returns here.* The controls’ positions are written into the patch as one undo step, so PATCH shows it, and the controls re-center on it |
| **BACK** | <kbd>⇧⌫</kbd> | Glides back to home: the last sound you kept or opened |

With a control you reached with <kbd>Tab</kbd> focused, <kbd>↵</kbd> is that
control’s (a button presses, a named control plays its sweep), not KEEP. A
turn with the mouse or a finger leaves nothing focused, so <kbd>↵</kbd> keeps
straight after it. With the sound at home, either key
says there is nothing to keep or go back to. None of the pad keys act while
you type in a field or a dialog is open ([the key map](../keyboard.md#in-perform)).

KEEP changes the sound you’re playing, not the bank. To keep the result as a
sound of its own, press **KEEP AS NEW** in [PATCH](./play.md). Until a sound
you opened has arrived, KEEP and TAKE change nothing and say why: *Take waits
for Acid Line to finish opening. Try again in a moment.*

```admonish info collapsible=true title="How it works: opening a sound"
While a sound you opened is on its way, the status line names it: *opening
Acid Line…*. The name above stays the sound your keys still play, dimmed,
until the new one lands. It lands as soon as the engine turns to it, before
it has rendered it for PATCH’s rack.

A preset you have opened before in this browser doesn’t wait for the engine
at all. It plays the moment you click it, after a reload too, and its controls
work at once if PERFORM has measured it. The first open after an update of the
app asks the engine again.
```

## Stage mode

In PERFORM, <kbd>⇧F</kbd>, or **⇧F** in the well’s corner, puts the sound
you’re playing on the whole screen, for a gig or a stream: the wordmark and
the model’s lamp at the top left, × at the top right, its name and *family ·
in hand* at the bottom left (the family only where it has one), the keys along
the foot, and its [face](../faces.md), large, standing on a floor that reflects it, and over the
face what you hear, drawn in the face’s own bands against the same bank, with
100 Hz, 1 kHz and 10 kHz marked beside it. The face stands whether or not
anything sounds; what you play lights the face’s outline and draws its own
outline over it, and fades like phosphor, so nothing moves while nothing
sounds.

Everything still plays: the keys, a MIDI keyboard, and <kbd>Space</kbd> for
the phrase (a tap does the same on a touch screen). <kbd>⇧F</kbd> again, or
<kbd>Esc</kbd>, or **×** in the corner leaves, and the keyboard is back where
it was. <kbd>Tab</kbd> stays on the stage: nothing behind it can be reached
until you leave. A refusal said while it is on (*Nothing to undo here*) shows
over the stage, and in its line at the bottom for a few seconds.

In PERFORM, <kbd>⇧F</kbd> takes the place of F’s accent (Shift with a note key
plays it harder). F on its own is still a note, and at every other level
<kbd>⇧F</kbd> is the accented F it always was.

## Nothing opens a dialog

Nothing PERFORM does on its own opens a dialog. A player in the middle of a
phrase can’t answer a question, so everything PERFORM needs to tell you arrives
as a line: the status line, B’s words in the well, or a toast. Everything it offers you
is a pad you can ignore. The dialogs you can open from it are your own
choice, ⌘K’s list and the lesson on filters, and <kbd>Esc</kbd> closes
either.

## In ⌘K

At PERFORM, [⌘K’s list](../levels.md#k-find-anything) starts with THIS
LEVEL: the pads and the buttons, each with its key. *Offer: grow a variant
into B* (<kbd>N</kbd>), *Take the offer in B* (<kbd>⇧↵</kbd>), *Pass on the
offer in B*, and once the sound has moved *Keep: make the sound home*
(<kbd>↵</kbd>) and *Back: glide back to the last sound you kept*
(<kbd>⇧⌫</kbd>); *Freeze Wander*, *Arrange your controls*, *How it works*,
*XY pad: two controls under one finger*, *Stage mode* (<kbd>⇧F</kbd>),
*Share this sound as a picture*, and *What does BRIGHT do?* while BRIGHT is
on the panel.

## Before you have taught it anything

Offers and drift walk toward your taste. Before there is a fitted model there
is no taste to walk toward, so they are drawn from the grammar instead. They
still only land on sounds that pass the [vetting gate](../glossary.md#vetting).
PERFORM says which you’re hearing:

```text
drift · gliding · no taste yet
grown before it has learned your taste
```

The first is the line under WANDER, the second B’s words in the well. Once the model has
been fitted, the first loses *· no taste yet*, and the second reads *grown
toward your taste*.

## What PERFORM teaches the model

**An offer you heard and answered is a pick.** An offer is the model’s
proposal, played against the sound in your hands: the question an EVOLVE pair
asks, without stopping the music. Once you have heard B, your answer counts:

| You | It records |
|---|---|
| Press **TAKE** | B over what you had: *Took B. That counts as a pick over what you had.* |
| Press **NEXT** or **PASS** | What you had over B: *Passed on B. That counts as a pick for what you had.* |

Heard means PEEK held, or BLEND past half, for at least a second while notes
were sounding. An offer you answer without hearing it teaches nothing, and a
pass says so: *Skipped B. Not counted, because you hadn’t heard it.*

Each answer can be taken back while its toast is up. A take carries **DON’T
COUNT IT** for eight seconds, since taking a sound to hear it in place isn’t
always a verdict. A pass carries **UNDO** for seven, which brings B back and
records nothing.

KEEP, BACK, control turns, and Wander are logged with your session, and they
don’t teach the model. A KEEP might mean *this is the one* or *hold on a
moment*, and a turn is a gesture, not a verdict.

```admonish info collapsible=true title="How it works: why both answers count"
A log that recorded only takes would be the model hearing its own proposals
agreed with. Answers enter the model exactly as EVOLVE’s picks do, tagged as
offers, so LEARNING grades them as their own stream (*offers you took or
passed*) beside the pairs it deals. If answers given mid-performance turn out
less reliable than dealt ones, that is where it will show.
```

## MIDI

Plug in a controller and turn its first eight knobs: they take the first eight
of PERFORM’s slots, in the order you turn them: the panel’s controls in its
order, then BLEND and WANDER. A slot is a place in that order, so after you
rearrange the panel the same knob turns whatever is in its place now. Channel pressure brightens, and the mod wheel drives MOTION,
wherever they sit on the panel; while one is off it, its source adds
nothing. [MIDI](../keyboard.md#midi) has the whole map, including
learn, endless encoders, and soft takeover.

## What to try next

- Turn WANDER into *ideas*, and let the offers come to you.
- Turn an amber control past its notch, and hear what B grows.
- Hold <kbd>⌥</kbd>, and see which way your taste leans along each control.
- Open the sound in [PATCH](./play.md), and watch the amber pointers move as
  you play.
- [Performance: named controls and the drift walk](../../reference/search/perform.html)
  has the measurements and the math.
