# PATCH — the patch

<p class="lede">One patch, in full, playable while you take it apart.</p>

<!-- film:view-patch --><!-- /film:view-patch -->

PATCH shows a single patch as its whole rack: every module, every cable, every
knob at its true position. It is running live the entire time. Turn a knob and
you hear it on the next note you play.

<figure>
<img src="../img/play.webp" alt="The PATCH view, with the bank on the left, the rack centre, the node bank on the right and the keyboard docked below." loading="eager" width="1440" height="900">
<figcaption><strong>PATCH.</strong> The bank on the left, the rack in the
middle, the module rail on the right, the keyboard docked below. Everything
here is live while you edit it.</figcaption>
</figure>

## What is on screen

From the top:

**The subject block.** The patch's name, *(edited)* once you have changed it,
and a caption for what you did to it (*2 locked*). The **▶** (or
<kbd>Space</kbd>) plays the standard sample of the patch as it stands, or says
why it cannot. Pressed while an edit is still on its way to the engine, it
wears a dotted amber ring and plays once the edit lands; press it again, or
<kbd>Space</kbd>, to take that back. Its id and a short structural summary
(`#30 · wsqr·mix·cho`) are the engine's bookkeeping, shown only with **⋯ ›
Show measurements**.

**The toolbar.** The edit controls (*keep as new*, *pick the edit*), the layout
and view controls (*freeform / chain*, *snap*, *reset*, *detail*, *leans*,
*map*), the locks, and **⚡ evolve from this**. All covered in
[Reading and editing the rack](../rack.md).

**The next-step chip.** An amber line that always says what to do now
(*"Generation 31 bred 4 new sounds: they’re at the top of the bank ▸"*, or *a
new sound* after a ⚡). It is a suggestion,
and clicking it does the step it names: it points you at a key to play, opens
EVOLVE for picks, starts a generation, scrolls the bank to the newest
generation's patches, or (when that generation kept none) opens TASTE. While
the first generation breeds and before any child of it has landed, it only
says *Breeding: keep playing*, and clicking it does nothing.

**The belief row.** What the model guesses about the sound you're playing, and why:

```text
80% · fairly sure · chorus & sweeps +0.78 · body −0.09 ·
drive & fold −0.08   in your chorus & sweeps style
```

That is its guess as a percentage (the same one the bank row's bar draws) and
a word for how sure that reads, on one scale: *a hunch* (46–54%), *leaning*
(55–69% or 31–45%) or *fairly sure* (70% and over, or 30% and under). The word
reads the percentage; how wide the model's own doubt is stays with the bank
row's block. Then the three coordinates contributing most, and which style is
judging it, by its name. While an edit is on its way the row dims and ends in
*· rating…*: the model rating the edited sound again.
When the model has no basis for a claim, this row says so instead of printing a
number, and when nothing reaches the output (the patch's only source socket is
[empty](../rack.md#empty-sockets)) it says *no guess while nothing reaches the
output*. See [Reading what it learned](../reading-the-model.md).

Beside it, the **budget**: the ceilings evolution searches within, `24
modules · 6 depth · 3 mod depth`. It speaks up only when one is close
(`5/6 depth`, amber) or reached (red), because a patch *at* a ceiling has no
room left to grow and a hand-built patch past one is refused. With **⋯ › Show
measurements** it shows all three all the time (`8/24 modules · 4/6 depth ·
1/3 mod depth`).

**The rack.** The patch itself. See [the rack chapter](../rack.md).

**The scope.** Bottom right of the frame, tracing the output while you play.
Configurable from **⋯** → *Scope & analyzer…* (waveform or spectrum, tap point,
FFT size, colour, corner, size, trigger, freeze).

**The spec strip.** The line under the rack that describes whatever you are
pointing at, in the catalogue or in the patch.

**SET ASIDE.** The staging tray. Anything you unplug, delete, or bypass lands here
instead of vanishing, and stays across a reload. Drag it back onto any lit ○ to
put it in. The socket an unplug leaves reads EMPTY and makes no sound.

**The quick-pick strip.** <kbd>TEACH</kbd> plus the current duel pair, so you
can vote without leaving PATCH.

**The keyboard dock.** [Playing it](../playing.md).

## The three things PATCH is for

### Hearing a patch properly

The standard sample is five seconds and identical for every patch, which is
what makes candidates comparable. It is not a performance, though. Play the
patch from the keyboard. Hold a chord. Run the arpeggiator. A patch that sounds
thin on the sample can be excellent under your hands, and the sample cannot
tell you that.

### Changing it

Every knob is live and every structural edit is a grammar operation, so you
cannot break the patch into something unplayable. Drag knobs, click selectors,
drag cables between typed jacks, arm a module from the catalogue and place it.
Undo with <kbd>⌘Z</kbd>: it undoes the last thing you did, even while the
engine is still catching up.

Edits happen in the order you make them. If the engine is still working on the
last one, the next one waits its turn and then happens: its plate is outlined
and the caption under the patch name says *1 edit waiting*. See
[turning knobs](../rack.md#turning-knobs).

Changes are *staged* until you press **keep as new**, which inserts the edited
patch into the bank as a new sound, leaving the original alone.

### Aiming the search

This is the part that is easy to miss. Lock the knobs or the wiring you like,
then press **⚡ evolve from this**: refinement mutates everything *except* what
you locked. Locked addresses are excluded from the search outright. See
[locks](../rack.md#locks-and-evolving-from-here).

```admonish tip title="An example"
Find a patch whose *character* you like but whose envelope is wrong. Lock every
knob except the envelope. Evolve. You get variations that differ only where you
allowed them to.
```

## Getting a patch here

- Click any row in the [bank](../bank.md).
- Click **OPEN IN PATCH** on either side of a pair in [EVOLVE](./evolve.md).
- Click any dot on the [taste map](./taste.md).

All three open it as the sound you're playing, live and editable.
