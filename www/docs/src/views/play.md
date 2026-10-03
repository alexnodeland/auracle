# PATCH: the patch, opened up

<p class="lede">PATCH opens one sound as its whole patch: every module, cable,
and knob, live while you change it. Use it to hear a sound properly, change
it, and aim the next breeding at it.</p>

<!-- film:view-patch --><!-- /film:view-patch -->

PATCH shows the sound you’re playing as its rack, with every knob at its true
position. It runs live the whole time: turn a knob and you hear it on the next
note you play.

<figure>
<img src="../img/play.webp" alt="The PATCH view, with the bank on the left, the rack in the center, the module rail on the right, and the keybed docked below." loading="eager" width="1440" height="900">
<figcaption><strong>PATCH.</strong> The bank on the left, the rack in the
middle, the module rail on the right, the keybed below. Everything here is
live while you edit it.</figcaption>
</figure>

## Open a sound and change it

1. Click a row in the [bank](../bank.md). It opens as the sound you’re playing.
2. Play it from the keybed. Hold a chord, or run the arpeggiator.
3. Drag a knob, and hear it change.
4. Press **KEEP AS NEW** to add your edit to the pool as a new sound. The
   original stays as it was, and the new sound is safe until it has been in a
   pick ([the bank](../bank.md#a-sound-you-keep-as-new-is-safe-until-its-been-in-a-pick)).

You can also open a sound with **OPEN IN PATCH** on either side of a pair in
[EVOLVE](./evolve.md), or by clicking a sound on the [TASTE map](./taste.md#a-sounds-card).

## What you see

From the top:

**The name.** The sound’s [face](../faces.md), its name, *(edited)* once
you have changed it, and a caption for what you did to it (*2 locked*). The
face is the sound as it stands: an edit shows in it once the edit’s render
lands. **▶**, or <kbd>Space</kbd>, plays
the standard phrase on the sound as it stands. Pressed while an edit is still on
its way to the engine, ▶ wears a dotted amber ring and plays once the edit
lands; press it again to take that back. Space plays the same phrase from
PERFORM and EVOLVE: the sound as it stands here, which in PERFORM is what you
kept or took, without a control turned since or Wander’s drift. It waits for an
edit the same way, and there *▶ waiting for the edit…* stands in for the
sound’s name at the right of the keybed until it lands.

**The next-step chip.** An amber line that always says what to do now, and
clicking it does the step it names:

- *Play it first: press A, or tap a key below ▸* on a fresh session;
- *Teach it your taste: 6 quick picks below ▸* before your first pick;
- *It’s learned something. Breed a generation ▸* once it has;
- *Breeding: keep playing ▸* while the first generation breeds (this one does
  nothing when clicked);
- *Generation 3 bred 4 new sounds: they’re at the top of the bank ▸* after one.

**⚡ EVOLVE FROM THIS**, on the name’s row: breeding from this sound alone. See
[locks, and evolving from here](../rack.md#locks-and-evolving-from-here).

**NEW PATCH**, at the right of the name's row, before ⚡: [a patch from
nothing](#a-patch-from-nothing). In a window under 1280 px wide it shows its
glyph only, and says its name on hover.

**The toolbar.** **PICK THE EDIT** and **KEEP AS NEW**; the layout and view
controls (**CHAIN**, **SNAP**, **RESET**, **DETAIL**, **LEANS**, **MAP**); and
the locks (**LOCK KNOBS**, **LOCK WIRING**, **CLEAR LOCKS**). [Reading and
editing the rack](../rack.md) covers them all.

**The model's guess for the next module,** over the rack's top left once the
model has fitted your taste: *GUESS · REVERB*, then its reason in the model's
italic, then how likely it guesses you'd pick the patch with it over the patch
as it is:

```text
GUESS · REVERB   it moves toward still, as your picks lean · 67% · leaning
```

The module itself is drawn dashed amber at its place in the patch: above the
cable it would be patched into, over the empty socket it would fill, or under
the module whose modulation input it would take, with a dashed lead to that
place. It stays in view: with no room above the cable it hangs below the
patch, or at the top of the view. Click it (or focus it and
press <kbd>Enter</kbd>) to add it, the same edit the module rail makes, and
<kbd>⌘Z</kbd> takes it out. Its **×** (or <kbd>Delete</kbd>) skips it: that
kind of module stays away from that place for this patch, and the next guess
shows. Undoing a guess you added counts as skipping it. The module rail marks
the guessed module with an amber dot beside its name.

Beside the guessed module stand two [faces](../faces.md): *as it is*, the
patch's own, and *with it*, the patch with the guessed module added. The
second isn't an estimate: to rank its guesses the engine rendered the patch
with each candidate module, and this is that render's face. Until a face
arrives its place stays empty; an empty patch has no sound, so it has no
*as it is*. Both describe the patch as it was when the guess was made, so
turning a knob takes them away: a knob doesn't change the guess, and the
faces come back when the next one is made (after you add, remove or skip a
module, or open another sound).

- It ranks by how sure it is the module helps, not by the percentage, so its
  first guess can be one it isn't sure of. Then the line ends *it may not help*.
- Before the warm start it has nothing to guess from, and shows nothing.
- With no room left (the patch is at a ceiling), it says *no guess: nothing
  more fits, so a module has to come out first*.
- On an empty patch, the percentage is over your pool's average sound, and the
  line says so.

It is worked out again after each change to the patch's structure and after
each refit, never per knob turn: it renders the modules that could go at the
output, all of them on a render crew where the machine has the cores, or the
likeliest eight with none. A guess takes a few seconds, longer the first
time: the crew has to start (and right after the warm start, the refit runs
first), and the three seconds of rendering it allows itself count from
there. [How it guesses](../../reference/search/guess.html).

**The guess.** What the model guesses about the sound you’re playing, and why:

```text
79% · fairly sure · even branches +0.39 · plucked strings +0.18 ·
mod chaining +0.17   in your analog sustain style
```

That is how likely it guesses you’d pick this sound, and a word for how sure
that reads. The words come from one scale: *a hunch* (46–54%), *leaning*
(55–69%, or 31–45%), or *fairly sure* (70% and over, or 30% and under). Then the three qualities that count most,
and the style that rates it highest, by name. While an edit is on its way, the
line dims and ends in *· rating…*: the model rating the edited sound again.

When the model has no basis for a guess, the line says so instead of printing a
number. When nothing reaches the output (the patch’s only source socket is
[empty](../rack.md#empty-sockets)), it says *nothing to rate: no source
reaches the output*. [Reading what it learned](../reading-the-model.md) says how to read
it.

**The budget,** beside the guess: the ceilings breeding searches within (24
modules, a depth of 6, and a modulation depth of 3). It shows a ceiling only
when the patch is close to it (*5/6 depth*, in amber) or at it (red): a patch
at a ceiling has no room to grow, and a hand-built patch past one is refused.

**The rack.** The patch itself. See [reading and editing the rack](../rack.md).
An **AUDIO IN** module carries a row of its own under its settings: the input
it reads, your input’s level and its [face](../faces.md), **MONITOR** and **NEW CLIP**. See [playing
through Auracle](../playing-through.md).

Each green cable carries light by the level the engine measured on it, and a
mark on its middle lights a bar for each third of the meter's range; point at
the mark for the number. The amber modulation cables are not measured, so they
carry no mark. [Cables and their levels](../rack.md#reading-it).

**On a touch screen,** tap a module to open its settings in a sheet: every knob
as a wide slider with **−** and **+** steps, and every named setting as its
choices. Hold **−** or **+** to keep stepping. Close it with **×**, a swipe
down, a tap outside, or <kbd>Esc</kbd>. **REMOVE MODULE** at its foot deletes
the module, as **delete** in its ⋯ menu does.

**The scope,** at the bottom right of the frame, tracing the output while you
play. Set it up from **⋯** › *Scope & analyzer…*: waveform or spectrum, where
it listens, FFT size, color, corner, size, trigger, and freeze.

**The spec strip,** under the rack. It describes whatever you point at, in the
module rail or in the patch.

**SET ASIDE,** under that. Anything you unplug, delete, or bypass lands here
instead of vanishing, and stays across a reload. Drag it back onto a lit ○ to
put it in. The socket it left reads *empty* and makes no sound.

**MODULES,** on the right: [the module rail](../wiring.md).

**TEACH,** along the bottom: the same pair EVOLVE deals, so you can pick
without leaving PATCH. **▶ A** and **▶ B** put each sound under your keys, and
then **PICK A**, **PICK B**, or **↻** for another pair.

**The keybed,** docked below: [playing it](../playing.md).

```admonish info collapsible=true title="How it works: edits in order"
Every knob is live, and every structural edit is a grammar operation, so you
can’t break the patch into something unplayable. Edits reach the engine in
the order you make them. If the engine is still working on the last one, the
next waits its turn and then happens: its module is outlined, and the caption
under the name says *1 edit waiting*.

<kbd>⌘Z</kbd> (Ctrl Z) undoes the last thing you did, even while the engine
is still catching up. **⋯** › **Show measurements** adds the sound’s id and a
short structural summary to the caption, and all three budget ceilings to the
budget (*8/24 modules · 4/6 depth · 1/3 mod depth*).
```

## A patch from nothing

**NEW PATCH** empties the sound you're playing down to its amp envelope: the
name reads *New patch*, its caption *from nothing · 0 modules · nothing to hear
yet*, and the rack holds one [empty socket](../rack.md#empty-sockets) before
`ENV / OUT`. Then:

1. Add modules from the [module rail](../wiring.md), or take the model's guess.
2. Delete any module from its ⋯ menu. A source leaves its socket empty; the
   toast's undo, or <kbd>⌘Z</kbd>, puts it back.
3. **CLEAR** empties it again, with an undo.
4. **KEEP AS NEW** adds it to the pool as a sound of its own, once it makes a
   sound.

**BACK TO** *the sound's name* (or <kbd>Esc</kbd>) reopens the sound you started
from. A new patch with modules in it waits: **NEW PATCH** from that sound brings
it back. <kbd>⌘Z</kbd> past the start, or opening another sound, also ends it.

## The three things PATCH is for

### Hearing a sound properly

The standard phrase is five seconds and the same for every sound, which is
what makes two sounds comparable. It isn’t a performance, though. Play the
sound from the keybed: hold a chord, run the arpeggiator. A sound that seems
thin on the phrase can be the one you’d reach for under your hands.

### Changing it

Drag knobs, click a named setting (or, from the keyboard, press
<kbd>Space</kbd> or <kbd>Enter</kbd> on it) to cycle it, drag cables between
jacks, and place modules from the rail. Your changes
stay on the sound you’re playing until you press **KEEP AS NEW**. That adds
the edit to the pool as a new sound, and leaves the original alone. [Turning
knobs](../rack.md#turning-knobs) has the details.

### Aiming the search

1. Lock the knobs or the wiring you like.
2. Press **⚡ EVOLVE FROM THIS**.

Breeding then changes everything except what you locked. See
[locks](../rack.md#locks-and-evolving-from-here).

```admonish tip title="An example"
Find a sound whose character you like but whose envelope is wrong. Lock every
knob except the envelope’s, and press ⚡ EVOLVE FROM THIS. You get variations
that differ only where you allowed them to.
```

## What to try next

- [Rewire it](../wiring.md) from the module rail.
- Turn **LEANS** on, and see which modules your taste leans toward.
- Open the sound in [PERFORM](./perform.md), and play it with the named
  controls.
