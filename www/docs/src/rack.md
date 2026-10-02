# Reading and editing the rack

<p class="lede">The rack in PATCH is the patch itself. This page is about
reading it, turning its knobs, keeping an edit as a new sound, and locking what
you like before you breed from it.</p>

<!-- film:sounddesign --><!-- /film:sounddesign -->

<figure>
<img src="./img/rack-detail.webp" alt="Rack detail: wavefolder, mix, chorus, and wavetable modules with labeled knobs, among them RATE 8.23 Hz, BAL +4.0 dB, and MORPH 85%, joined by green audio cables and amber modulation cables ending in named destinations PITCH, THRESHOLD, DEPTH, and MORPH." loading="eager" width="560" height="300">
<figcaption><strong>Two cable colors, two meanings.</strong> Green carries
sound; amber carries modulation, and each amber cable says what it lands
on.</figcaption>
</figure>

## Reading it

**Green is sound. Amber is modulation, and the model’s mind.** That holds
everywhere in the instrument.

- **Modules** each have a title, a **⋯** menu, and their knobs. A knob shows
  its value in its own units (`840 Hz`, `24 ms`, `−6.0 dB`, `+12 ¢`, `8.23 Hz`),
  never as a fraction of its range.
- **Jacks** are small rings labeled `in` and `out`. Their color is the kind of
  signal they carry, and only matching kinds connect.
- **Audio cables** are green, and run left to right through the signal chain.
  Each carries light by its level: once an edit settles, the engine renders
  the phrase once more and measures every audio cable, and the brighter the
  cable, the louder the signal on it. A mark on its middle lights one bar per
  third of the meter's range (−54 dB to 0 dB re 1 V); point at it for the
  number, *measured at rest: −14 dB*. Until a new structure is measured its
  cables sit dim and its marks hollow, and after a knob turn the marks go
  hollow until the change is measured. While notes sound, the cables move at
  the level the live voice measures instead.
- **Modulation cables** are amber, and each one ends in a named destination:
  `PITCH`, `THRESHOLD`, `MORPH`, `DEPTH`. A modulation cable pulses at its
  modulator’s rate, so you can see a 0.2 Hz sweep before you hear it. It is
  not measured, so it has no level mark and carries no light.
- **The last module** is always `ENV / OUT`: the amp envelope and the output.
  Every patch has one, with a limiter before it that you can’t remove.

The rack scales to fill its frame. At small sizes, **DETAIL AUTO** drops the
knobs from modules too small to grab, so a large patch shows as bare modules
until you zoom in.

## Getting around

| | |
|---|---|
| <kbd>Home</kbd> | Fit the whole patch |
| <kbd>.</kbd> | Fit what you’re on |
| <kbd>⌘0</kbd> (Ctrl 0) | Actual size |
| <kbd>⌘−</kbd> / <kbd>⌘=</kbd> | Zoom out or in |
| <kbd>Ctrl</kbd> and the wheel, or pinch | Zoom at the pointer |
| The wheel, or a drag on bare canvas | Pan |
| <kbd>Space</kbd> and drag, or a middle-button drag | Pan from anywhere on the canvas |
| **MAP** | Show the minimap, at the bottom left |
| <kbd>Shift</kbd>-click the minimap | Bookmark a spot |
| <kbd>⇧1</kbd>–<kbd>⇧9</kbd> | Jump to a bookmark |

Zoom runs from 0.30× to 2.50× by hand, and the rack fits its frame when it
opens (up to 2.2×). <kbd>Home</kbd> and the other fits go below 0.30× when
that’s what it takes to show a large patch whole.

## Turning knobs

1. Drag a knob up or down, or focus it and press <kbd>↑</kbd> and
   <kbd>↓</kbd>. Hold <kbd>Shift</kbd> for fine.
2. Click a named setting (`saw`, `square`, `−2 oct`) to cycle it, or reach it
   with the keyboard and press <kbd>Space</kbd> or <kbd>Enter</kbd> (with
   <kbd>Shift</kbd>, it goes back).
3. Press <kbd>⌘Z</kbd> (Ctrl Z) to undo, and <kbd>⇧⌘Z</kbd> to redo.

While you drag, you hear every value the knob passes through. A step
sequencer’s bars are knobs too: press one where you want the step and drag
([the step sequencer](./wiring.md#the-step-sequencer)).

A knob always shows the value you last set. Once you turn it here, PERFORM
plays from your value too ([opening the
circuit](./views/perform.md#opening-the-circuit)).

```admonish info collapsible=true title="How it works: when an edit reaches the sound"
Knobs, and the octave and wavetable selectors, reach the instrument as you
move them. A structural edit re-patches it as soon as the engine has made the
edit. Any other selector (a VCO’s wave, say) re-patches it once the engine has
rendered the patch again, a fraction of a second later and longer while the
engine is busy, because that render measures the level the new sound plays
at. Held notes keep sounding through it.

The patch is rendered and checked again before it can play its phrase, so a ▶
pressed before then waits for it, then plays the edit. So does
<kbd>Space</kbd>, in any view. Edits reach the engine
in the order you make them. On a busy machine the next waits its turn: its
module is outlined, and the caption under the name says *1 edit waiting*.

<kbd>⌘Z</kbd> undoes the last thing you did, even if the engine hasn’t
finished it yet.
```

## Keep an edit as a new sound

1. Change the sound.
2. Press **KEEP AS NEW**.
3. On the card that opens, **WHICH WOULD YOU REACH FOR?**, play **A** and
   **B** with **▶ PLAY** (or <kbd>1</kbd> and <kbd>2</kbd>).
4. Press **THIS ONE** under the one you’d reach for (or <kbd>←</kbd> or
   <kbd>→</kbd>).

The card holds your edit and the original in a random order, unlabeled.
Either answer teaches the model, and picking the original teaches it most. The
receipt names the new sound and says which side was yours: *Kept Warm Wash 2
as new: A was your edit, and you picked it.* The new sound is named for what it
now is, so its name can differ from the original’s, and the original stays in
the bank as it was.

- **CANCEL**, or <kbd>Esc</kbd>, closes the card and keeps nothing. Your edit
  stays open.
- **SKIP COMPARING** keeps the edit as new and teaches nothing.
- **PICK THE EDIT**, ticked before you press KEEP AS NEW, skips the card once:
  it keeps the edit as new and tells the model you’d pick it, without hearing
  the two side by side. Then it unticks itself. [TRUST](./views/taste.md#trust-is-its-confidence-honest)
  grades the edits you heard and the ones you asserted apart.

**⚡ EVOLVE FROM THIS** on an edited sound asks the same question before it
breeds, and canceling it cancels the breeding too. With nothing changed, KEEP
AS NEW stays disabled, and its tooltip says *Nothing to keep yet: turn a knob
first*.

```admonish tip title="Hit targets are bigger than they look"
A knob’s whole face is grabbable, including under its ticks and value arc, and
a jack’s ring answers across its full diameter.
```

## Layout

The first button cycles three layouts, and its label shows the one you’re in:

| | |
|---|---|
| **CHAIN** | The signal path on one baseline |
| **COMPACT** | The same path, packed tight |
| **FREEFORM** | Yours. Drag a module by its face and it snaps to the grid; hold <kbd>Shift</kbd> to place it freely |

Then:

| | |
|---|---|
| **SNAP** | Pin every module where it sits, on the 24 px grid. This is how you start arranging a bred patch by hand |
| **RESET** | Throw away the hand positions, and lay the patch out along the signal chain again |
| **DETAIL** | **AUTO** drops knobs from modules too small to grab; or force them on or off |
| **LEANS** | Tint each module by which way your taste leans on its kind: amber toward, red away, stronger where the model is surer. Off by default |

**SNAP** and **RESET** act only in freeform. Positions are kept for each patch,
survive a reload and a ⚡ generation, and travel in a downloaded patch file. If
a hand layout has spread past what the frame can show, **SNAP** lays it out
again from the signal chain instead.

## Locks, and evolving from here

1. Lock what you like:
   - click a knob’s **lock dot** to lock that knob;
   - click a module’s **▢** to lock the whole module;
   - press **LOCK KNOBS** or **LOCK WIRING** to lock every knob, or the whole
     structure.
2. Press **⚡ EVOLVE FROM THIS**.
3. Play the child when it lands at the top of the bank.

Breeding then changes everything except what you locked. **CLEAR LOCKS**
releases them all.

The button reads **⚡ EVOLVING…**, and the job slot in the menu bar shows
*⚡ evolving Soft Pad* with **STOP**, which drops the walk and adds nothing.
The rack, the bank, and the pairs go on answering while it walks. If you go on
editing, the child waits in the bank rather than replacing your edits, and its
toast has an **OPEN IT** button.

⚡ and **EVOLVE POOL** take turns. While a generation breeds, ⚡ is disabled
and its tooltip says why; while ⚡ walks, EVOLVE POOL waits the same way.

```admonish info collapsible=true title="How it works: what a lock holds"
⚡ is one walk from the sound you’re playing, and the engine counts it as a
generation of its own. It runs on the render farm. With no render farm (a
single-core machine, `?farm=0`, or no worker free to take it), it runs in the
engine itself. There it can’t be stopped, and the job slot shows no STOP.

A lock is a set of exact addresses in the patch. A change that would alter,
delete, or create anything at a locked address is refused. Both directions
matter: allowing a birth at a locked address, while refusing the death that
would undo it, would let the search drift into locked structure and stay
there.

One limit: a structural change that grows a brand-new address inside a locked
module isn’t caught, because that address existed in neither version. A lock
is a promise about addresses, not about everything under them. [Locks](../reference/search/locks.html)
in the reference has the rule.
```

## The ⋯ menu

Each module’s **⋯** menu:

| | |
|---|---|
| **replace with…** | Another module in this socket. It keeps what feeds it |
| **insert before…** | A new module between this one’s input and it. Grayed on a source, which has no input |
| **insert after…** | A new module between this one and what it feeds |
| **duplicate** | A second one in series, with the same settings. Grayed on a source |
| **set aside** | Leaves the socket [empty and silent](#empty-sockets). Drag it back any time |
| **bypass** | The input passes straight through. Grayed on a source |
| **modulate → *destination*** | Arms the module rail at the modulators, for this module’s modulation input. Only on a module that has one |
| **probe this output** | A little scope on the out ○: the patch rendered as if it ended here |
| **swap the two inputs** | On the six two-input modules only |
| **delete** | Below a rule, in red. A source leaves its socket empty |

**replace with…**, **insert…**, and **modulate** hand off to the [module
rail](./wiring.md) with the socket already chosen and lit, so there is one
list of modules in one place. A modulator’s own ⋯ has two rows: **replace
with…** and **unplug this modulator**.

Anything you bypass or delete goes to **SET ASIDE** rather than disappearing,
and stays there across a reload.

## Empty sockets

Unplug a cable, set a module aside, delete a source, or move a source into
another socket, and the socket it leaves is **empty**. It shows as a small dashed module titled
*empty*, it’s listed as *empty* under **IN THIS PATCH**, and it’s silent. On
one side of a mix, only that side goes quiet.

If the empty socket was the patch’s only source, the whole patch is silent.
The caption under its name says *silent: nothing reaches the output*, ▶ and
**KEEP AS NEW** wait for a source, and the line above the rack says *nothing
to rate: no source reaches the output*.

1. Pick any source in the module rail. The empty socket is the one already
   chosen.
2. Place it, or press <kbd>⌘Z</kbd>, and you hear the patch again.

The model hears an empty socket too: *empty sockets* is one of the qualities
it weighs.

## Downloading a patch

From **⋯**, *Download this patch* writes a patch file, and *Download as a
picture…* draws the rack as a PNG or SVG, at a size and background you choose.
The picture carries the patch inside it: open an Auracle PNG or SVG with
*Open a patch file…*, or drop it on the window, and you get the patch back.

## What to try next

- Lock a module you like and press ⚡ EVOLVE FROM THIS a few times.
- Turn **LEANS** on, and see which kinds of module your taste leans toward.
- [Wiring and the module rail](./wiring.md): add a module, or rewire one.
