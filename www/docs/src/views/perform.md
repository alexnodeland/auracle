# PERFORM: the sound under your hands

<p class="lede">PERFORM is for playing a sound. It gives you up to eight
controls named for what you hear, chosen from a palette of eighteen, BLEND
and WANDER, and six pads, and nothing in it stops to ask you a question.</p>

<!-- film:view-perform --><!-- /film:view-perform -->

[PATCH](./play.md) shows what a sound is made of, knob by knob. PERFORM is for
playing it: you reach for *brighter*, not for a filter’s cutoff, and the
instrument works out which of this patch’s knobs make it brighter. It plays
the sound already under your fingers, and the keybed below is the same one
every view shares.

## Play it

1. Play a key: <kbd>A</kbd> to <kbd>L</kbd> on your computer keyboard, or tap
   the keybed.
2. Turn a named control: drag it up or down. Double-click it to go back to the
   center.
3. Press **OFFER**, then hold **PEEK** to hear the variant it grew, or press
   **TAKE** to make it yours.
4. Press **KEEP** when you like where you are. **BACK** returns there.
5. Turn **WANDER** up, and let the sound move on its own.

Until you have done the first three once, a strip under the header lays them
out and ticks each off as you do it. Its second step names a control that
turns on this sound (*Turn BRIGHT: drag up or down*), never one it can’t
reach.

## What you see

<img src="../img/perform.webp" alt="PERFORM: eight round controls in a row, a touch row, six large pads, a B strip, an XY pad, and an under-the-hood list of knobs with bars and values." loading="eager" width="1440" height="900">

From the top:

- **The header.** The sound’s name, a status line, **ARRANGE**, **STAGE ⇧F**,
  and a small scope. The status line says what PERFORM is doing with the
  sound: *listening to this sound…* while it measures a new one, then *4 of 6
  controls reach this patch*, with *re-checking* after it while it measures
  again in the background, or *listening to Bite…* while it measures a
  control you just placed.
- **Your controls in a row:** to start, **BRIGHT**, **SNAP**, **MOTION**,
  **BODY**, **GRIT**, and **SPACE**, then **BLEND** and **WANDER**. **ARRANGE**
  changes which sit here and in what order (see [the
  palette](#the-palette)). The line under each says what it turns, or what
  state it’s in.
- **TOUCH.** What your playing velocity drives: *loudness only*, or one of
  the named controls (*bright: soft dark, hard bright*), with a slider for how
  far it reaches. The note beside it names the knobs velocity moves.
- **Six pads:** **KEEP**, **BACK**, **OFFER**, **TAKE**, **PEEK**, and
  **FREEZE**.
- **The B strip.** One line, labeled **B**, that says whether an offer is
  waiting and where it came from: *no offer: press Offer to grow a variant
  from here* until there is one.
- **XY.** Two named controls under one finger.
- **UNDER THE HOOD.** The patch’s own knobs the controls and Wander are
  turning right now, each a bar with its value in its own units.
- **HOW IT WORKS.** Every control on the panel and what it does on this
  sound (see [How it works](#how-it-works)), then a short version of this
  page. Closed at rest.

**Show measurements** in the **⋯** menu adds the numbers behind each control
to its tooltip: purity, reach in σ, the measured halves, and the knob gains.

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
3. Press **↑** or **↓** to move one earlier or later. BLEND and WANDER stay
   at the end.

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
doing stays in the knobs. Reordering costs nothing at all.

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
| Long-press, about half a second, without moving | Hear it |

Turning a control changes knob values only. The voices take them without
rebuilding the patch, so a held chord keeps sounding through the turn.

**The controls re-center without moving the sound.** After a KEEP, a TAKE, a
fresh measurement, or a Wander glide, what the controls were doing is folded
into the patch, and they return to 12 o’clock. The pointer glides home over a
quarter of a second, and a faint tick marks where it was. A MIDI knob on a
re-centered control keeps working from where it is (see [soft
takeover](../keyboard.md#soft-takeover)).

### Long-press to hear it

A long-press plays the control to you. Over about two and a half seconds it
sweeps to the low end, across to the high end, and back to where it was. If no
note is held, it plays a C3 for the length of the sweep.

This is the quickest way to learn what a control does on this sound, since the
same name moves different knobs on different patches.

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

## How it works

**HOW IT WORKS**, below the hood, opens on the control you last touched, with
every control on the panel a tap away. For each, it says what you hear it do
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

**XY** puts two named controls under one finger. It starts as BRIGHT across
and MOTION up, and either axis can be any of the six.

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

## Blend, Peek, and the B slot

An offer is a second sound in a second set of voices that follows the same
hands: every note you play sounds on both. You hear B by crossfading to it,
never by a jump.

- **BLEND** sets the mix, from *home* at the left to *offer* at the right.
- **PEEK** plays B alone for as long as you hold it. Let go, and the mix
  returns to wherever BLEND is.
- **TAKE** makes the offer your sound.

The named controls turn the sound you’re on, not the offer.

**What you see is what happened.** An offer is grown from the sound you’re
playing, so B grows out of the sound’s name into its place. TAKE fills B with
green from the bottom, and B goes into the name: it is the sound you play
now, heard or not. NEXT folds B back into the name it grew from: it is dropped, nothing
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
- *frozen* while **FREEZE** stops it;
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

**Tap to freeze.** A short tap on WANDER (or the **FREEZE** pad) stops it
where it is, and the line reads *frozen*. Tap again to release it.

## The pads

| Pad | What it does |
|---|---|
| **KEEP** | Makes the sound you hear home: *Kept: this is home now. Back returns here.* The controls’ positions are written into the patch as one undo step, so PATCH shows it, and the controls re-center on it |
| **BACK** | Glides back to home: the last sound you kept or opened |
| **OFFER** | Grows a variant from here into B. The first is usually there at once, grown ahead once the sound has been steady for a few seconds and your hands have been off it for two |
| **NEXT** | What OFFER reads while B holds an offer, with *passes on B* under it. It passes on B (B empties, BLEND glides home) and brings the next, which has been growing meanwhile |
| **TAKE** | Makes the offer in B your sound. It becomes home, with *(taken offer)* after its name, and BLEND returns home. The controls play on while the taken sound is measured, and the status line says *re-checking* until it is |
| **PEEK** | Hold to hear the offer alone |
| **FREEZE** | Stops Wander where it is, and its line reads *frozen*. The same as tapping the WANDER dial; not the dock’s **HOLD**, which latches notes |

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

<kbd>⇧F</kbd>, or **STAGE ⇧F** in the header, puts the sound you’re playing
on the whole screen, for a gig or a stream: its name, and what you hear,
drawn as its spectrum, mirrored about the middle with the lows at the base
and 100 Hz, 1 kHz and 10 kHz marked beside it. What is drawn is the output,
so nothing moves while nothing sounds, and what you play fades like
phosphor.

Everything still plays: the keys, a MIDI keyboard, and <kbd>Space</kbd> for
the phrase (a tap does the same on a touch screen). <kbd>⇧F</kbd> again, or
<kbd>Esc</kbd>, or **×** in the corner leaves. F on its own is still a note.

## Nothing opens a dialog

Nothing reachable from PERFORM opens a modal. A player in the middle of a
phrase can’t answer a question, so everything PERFORM needs to tell you arrives
as a line: the status line, the B strip, or a toast. Everything it offers you
is a pad you can ignore.

## Before you have taught it anything

Offers and drift walk toward your taste. Before there is a fitted model there
is no taste to walk toward, so they are drawn from the grammar instead. They
still only land on sounds that pass the [vetting gate](../glossary.md#vetting).
PERFORM says which you’re hearing:

```text
drift · gliding · no taste yet
grown before it has learned your taste
```

The first is the line under WANDER, the second the B strip. Once the model has
been fitted, the first loses *· no taste yet*, and the second reads *grown
toward your taste*.

## What PERFORM teaches the model

**An offer you heard and answered is a pick.** An offer is the model’s
proposal, played against the sound in your hands: the question an EVOLVE pair
asks, without stopping the music. Once you have heard B, your answer counts:

| You | It records |
|---|---|
| Press **TAKE** | B over what you had: *Took B. That counts as a pick over what you had.* |
| Press **NEXT** | What you had over B: *Passed on B. That counts as a pick for what you had.* |

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
offers, so TRUST grades them as their own stream (*offers you took or
passed*) beside the pairs it deals. If answers given mid-performance turn out
less reliable than dealt ones, that is where it will show.
```

## MIDI

Plug in a controller and turn its first eight knobs: they take the first eight
controls on PERFORM’s deck, in the order you turn them. A slot is a place on
the deck, so after you rearrange the panel the same knob turns whatever is in
its place now. Channel pressure brightens, and the mod wheel drives MOTION,
wherever they sit on the panel; while one is off it, its source adds
nothing. [MIDI](../keyboard.md#midi) has the whole map, including
learn, endless encoders, and soft takeover.

## What to try next

- Turn WANDER into *ideas*, and let the offers come to you.
- Turn an amber control past its notch, and hear what B grows.
- Open the sound in [PATCH](./play.md), and watch the amber pointers move as
  you play.
- [Performance: named controls and the drift walk](../../reference/search/perform.html)
  has the measurements and the math.
