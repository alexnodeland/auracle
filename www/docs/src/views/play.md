# PATCH — the patch

<p class="lede">One patch, in full, playable while you take it apart.</p>

<!-- film:view-patch --><!-- /film:view-patch -->

PATCH shows a single patch as its whole rack: every module, every cable, every
knob at its true position. It is running live the entire time. Turn a knob and
you hear it on the next note you play.

<figure>
<img src="../img/play.webp" alt="The PATCH view, with the bank on the left, the rack centre, the node bank on the right and the keyboard docked below." loading="eager" width="1440" height="900">
<figcaption><strong>PATCH.</strong> The bank on the left, the rack in the
middle, the node bank on the right, the keyboard docked below. Everything
here is live while you edit it.</figcaption>
</figure>

## What is on screen

From the top:

**The subject block.** The patch's name, *(edited)* once you have changed it,
and a caption for what you did to it (*2 locked*). The **▶** plays the standard
sample. Its id and a short structural summary (`#30 · wsqr·mix·cho`) are the
engine's bookkeeping, shown only with **⋯ › Show measurements**.

**The toolbar.** The edit controls (*commit*, *my edit is better*), the layout
and view controls (*freeform / chain*, *snap*, *reset*, *detail*, *belief*,
*map*), the locks, and **⚡ evolve from this**. All covered in
[Reading and editing the rack](../rack.md).

**The next-step chip.** An amber line that always says what to do now (*"Gen 31
bred new patches — hear them ▸"*). It is a suggestion; clicking it takes you
there.

**The belief row.** What the model thinks of *this* patch and why:

```text
MODEL'S GUESS 0.80 · chorus & sweeps +0.78 · body −0.09 ·
drive & fold −0.08   under your style 2 lens
```

That is a prediction (how likely you are to prefer it in a duel), the three
coordinates contributing most, and which style lens is currently judging it.
When the model has no basis for a claim, this row says so instead of printing a
number. See [Reading what it learned](../reading-the-model.md).

Beside it, the **budget**: the ceilings evolution searches within, `24
modules · 6 depth · 3 mod depth`. It speaks up only when one is close
(`5/6 depth`, amber) or reached (red), because a patch *at* a ceiling has no
room left to grow and a hand-built patch past one is refused. With **⋯ › Show
measurements** it shows all three all the time (`8/24 modules · 4/6 depth ·
1/3 mod depth`).

**The rack.** The patch itself. See [the rack chapter](../rack.md).

**The scope.** Bottom right of the frame, tracing the output while you play.
Configurable from **⋯** → *Scope & analyser…* (waveform or spectrum, tap point,
FFT size, colour, corner, size, trigger, freeze).

**The spec strip.** The line under the rack that describes whatever you are
pointing at, in the catalogue or in the patch.

**HELD.** The staging tray. Anything you unplug, delete or bypass lands here
instead of vanishing, and stays across a reload. Drag it back onto any lit ○ to
put it in.

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
Undo with <kbd>⌘Z</kbd>.

Changes are *staged* until you **commit**. Committing inserts the edited patch
into the bank as a new candidate, leaving the original alone.

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
- Click the **⌖** on either side of a duel in [EVOLVE](./evolve.md).
- Click any dot on the [taste map](./taste.md).

All three land the patch on the workbench, live and editable.
