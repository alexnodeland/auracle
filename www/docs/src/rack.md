# Reading and editing the rack

<p class="lede">Every knob is an address in the genome, which is why turning one
teaches the machine something.</p>

<!-- film:sounddesign --><!-- /film:sounddesign -->

<figure>
<img src="./img/rack-detail.webp" alt="Rack detail: wavefolder, mix, chorus and wavetable modules with labelled knobs, among them the wavefolder's threshold, RATE 8.23 Hz, BAL +4.0 dB and MORPH 85%, joined by green audio cables and amber modulation cables ending in named destinations PITCH, THRESHOLD, DEPTH and MORPH." loading="eager" width="560" height="300">
<figcaption><strong>Two cable colours, two meanings.</strong> Green carries
audio; amber carries modulation, and its cable says what it lands
on.</figcaption>
</figure>

## Reading it

**Green is sound. Amber is the model's mind, and modulation.** That rule holds
everywhere in the instrument.

- **Modules** are plates with a title, a ⋯ menu, and their controls. Knobs wear
  a value arc and read in **musical units** (`840 Hz`, `24 ms`, `−6.0 dB`, `+12
  ¢`, `8.23 Hz`) rather than a normalized 0–1, because you are being asked to
  make a musical judgement and `0.63` is not one.
- **Jacks** are small rings labelled `in` / `out`. Their colour tells you the
  signal kind, and only matching kinds will connect.
- **Audio cables** are green and run left to right through the signal chain.
- **Modulation cables** are amber, and each one **ends in a named
  destination**: `PITCH`, `THRESHOLD`, `MORPH`, `DEPTH`. A modulation cable
  pulses at its modulator's rate, so you can see a 0.2 Hz sweep before you hear
  it.
- **The last module** is always `ENV / OUT`: the amp envelope and the output
  stage. Every patch has one, with a limiter compiled in ahead of it that you
  cannot remove.

The rack **scales to fill its frame** and centres itself. At small sizes the
`detail auto` setting drops knobs from plates once they are too small to grab,
so a very large patch shows as bare plates until you zoom in.

## Navigating

| | |
|---|---|
| <kbd>Home</kbd> | Fit the whole patch |
| <kbd>.</kbd> | Fit what you are on |
| <kbd>⌘0</kbd> | Actual size |
| <kbd>⌘−</kbd> / <kbd>⌘=</kbd> | Zoom out / in |
| <kbd>ctrl</kbd> + wheel, or pinch | Zoom at the pointer |
| wheel, or drag on bare canvas | Pan |
| <kbd>space</kbd> + drag, or middle-drag | Pan from anywhere on the canvas |
| **map** | Show the minimap, bottom-left |
| <kbd>shift</kbd>-click the minimap | Bookmark a spot |
| <kbd>shift</kbd> + <kbd>1</kbd>–<kbd>9</kbd> | Jump to a bookmark |

Zoom runs 0.30×–2.50× by hand, and it fits to the frame on load (capped at
2.2× there). <kbd>Home</kbd> and the other fits may go below 0.30× when that is
what it takes to show the whole of a large patch.

## Turning knobs

Drag a knob, or focus it and use <kbd>↑</kbd>/<kbd>↓</kbd>; hold
<kbd>Shift</kbd> for fine. Click a selector (`saw`, `square`, `−2 oct`) to
cycle it. A step sequencer's bars are knobs too: press one where you want the
step to sit and drag ([more on the step sequencer](./wiring.md#the-step-sequencer)).

Every edit is a **one-site write at that knob's trace address**. The patch is
re-rendered and re-vetted before it can be auditioned, and the live instrument
is re-patched immediately so held notes keep sounding. While you drag you hear
every value the knob passes through; the engine re-renders the one you let go
on. A run of <kbd>↑</kbd>/<kbd>↓</kbd> presses on one knob is one turn.

Edits reach the engine **in the order you make them**. On a busy machine the
engine can still be working on the last one when you make the next: a bypass
right after a knob turn, a cable pulled right after ⌘Z. The new one waits its
turn and then happens. Its plate is outlined while it waits and the caption
under the patch name says *1 edit waiting*. A knob always shows the value you
last set, never an older one the engine is still catching up on, and never
PERFORM's older copy of it: once you turn it here, PERFORM plays from your
value too ([the circuit](./views/perform.md#opening-the-circuit)).

Edits are staged. The toolbar's **commit** inserts the result as a new
candidate, leaving the original intact. <kbd>⌘Z</kbd> / <kbd>⇧⌘Z</kbd> undo and
redo, and ⌘Z always undoes the last thing you did, even if the engine has not
finished it yet. Each structural edit's message replaces the last one's, and
undoing an edit takes down the message that announced it.

**Commit asks first.** If the edit really changed the patch, a card opens:
**WHICH ONE IS BETTER?** It holds the original and your edit as **A** and
**B**, in a random order and unlabelled, each with **▶ play** and **this one**.
Either answer teaches the model; picking the original teaches it the most. The
receipt says which side was yours: *"committed as patch #51 · B was your edit ·
taught: your edit won the comparison."* <kbd>1</kbd> / <kbd>2</kbd> play,
<kbd>←</kbd> / <kbd>→</kbd> pick. <kbd>Esc</kbd> or **cancel** closes the card
and commits nothing: your edit stays on the bench. **commit without
comparing** commits and teaches nothing. **⚡ evolve from this** on an edited
patch asks the same question before it breeds, and cancelling it cancels the
generation too.

**my edit is better** is the shortcut past the card, for one commit. Tick it
and the next commit files a claim that your edit won, without hearing the two
back to back; then it unticks itself. The
[TRUST tab scores the two apart](./views/taste.md#trust--is-its-confidence-honest):
answers you heard, and claims you filed.

A commit's receipt takes the place of the edits' receipts it follows: once the
edit is committed, their *take it out* buttons are gone.

```admonish tip title="Hit targets are bigger than they look"
A knob's whole face is grabbable, including under its ticks and value arc, and a
jack's ring responds across its full diameter. If you remember these feeling
fiddly, try again.
```

## Layout

The first button cycles three layout modes, and its label shows the one you are
in:

| | |
|---|---|
| **chain** | The signal path on one baseline |
| **compact** | The same path, packed tight |
| **freeform** | Yours. Drag a plate by its faceplate and it snaps to the grid; hold <kbd>shift</kbd> to place it freely |

Then:

| | |
|---|---|
| **snap** | Pin everything where it currently sits, on the 24px grid. This is how you start hand-arranging an evolved patch |
| **reset** | Throw away the hand positions and re-lay along the signal chain |
| **detail** | `auto` drops knobs when plates get too small to grab; force it on or off |
| **belief** | Tint each plate by what the model believes about its family: amber toward, red away, stronger where it is certain. Off by default |

Positions are kept **per patch**, survive a reload and a generation of ⚡, and
travel inside an exported patch file. If a hand layout has spread past anything
the frame can show, **snap** re-lays it from the signal chain instead of
pinning it somewhere you cannot see.

## Locks, and evolving from here

- Click a knob's **lock dot** to freeze that knob.
- Click a module's **▢** to freeze the whole module.
- **lock knobs** / **lock wiring** freeze every parameter, or the whole structure.
- **clear locks** releases everything.

Then **⚡ evolve from this**: refinement mutates everything *except* the locked
addresses. It is one walk of a few dozen renders, and it runs on the render
farm, so the rack, the bank and the duels go on answering while it walks. The
button reads **⚡ evolving…**, and the job slot in the menu bar shows *⚡
evolving Soft Pad* with **stop**, which drops the walk and adds nothing. (With no
render farm, on a single-core machine or with `?farm=0`, or when no render
worker could take the walk, it runs in the engine itself, where it cannot be
stopped, and other requests wait for it; the job slot then shows no **stop**.)
If you go on editing while it walks, the child waits in the bank rather than
replacing your edits; the message that announces it has an **open it** button.
The patch it walks from stays in the bank until the walk lands or is stopped,
whatever else comes in meanwhile.

⚡ and **EVOLVE POOL** take turns. While a generation breeds, ⚡ is disabled,
and hovering it says why; while ⚡ walks, EVOLVE POOL waits the same way. A
refit waits for either, so each is bred under the model it started with.

A proposal that would change, delete **or create** any locked address is
rejected. Both directions matter: allowing a *birth* at a locked address while
rejecting the death that would undo it lets the search drift into locked
structure and stay there.

One limit. A lock is a set of exact addresses, so a structural move that grows
a *brand-new* address inside a locked module is not caught, because that
address existed in neither version. "Locked" is a promise about **addresses**,
not about subtrees.

## The ⋯ menu

Per module:

| | |
|---|---|
| **replace with…** | Another module in this socket; it keeps what feeds it |
| **insert before…** | A new module between this one's input and it. Greyed on a source, which has no input |
| **insert after…** | A new module between this one and what it feeds |
| **duplicate** | A second one in series, with the same settings. Greyed on a source |
| **extract to HELD** | Leaves the socket [empty and silent](#empty-sockets); drag it back any time |
| **bypass** | The input passes straight through. Greyed on a source |
| **modulate → *destination*** | Arms the node bank at the modulators, for this module's mod slot. Only on a module that has one |
| **probe this output** | A little scope on the out ○: the patch rendered as if it ended here |
| **swap the two inputs** | On the six two-input modules only |
| **delete** | Set apart below a rule, in red |

The *replace*, *insert* and *modulate* rows hand off to the
[node bank](./wiring.md) with the socket already chosen and lit, so there is one
module inventory in one place. A modulator's own ⋯ has two rows: **replace
with…** and **unplug this modulator**.

Anything you bypass or delete goes to the **HELD** tray rather than
disappearing, and stays there across a reload.

## Empty sockets

Unplug a cable, extract a module or move a source into another socket, and the
socket it leaves is **empty**: a small dashed plate titled *empty*, listed as
*empty* under IN THIS PATCH, and **silent**. Nothing plays there. On one side
of a mix, only that side goes quiet. Under a module you insert after it, that
module has nothing to process.

If the empty socket was the patch's only source, the whole patch is silent.
The caption under its name says *silent — nothing reaches the output*, ▶ and
**commit** wait for a source, and the model's line says it has no guess. Arm
any source and the empty socket is the one already picked; place it, or press
<kbd>⌘Z</kbd>, and you hear the patch again.

The model sees an empty socket as one too: *empty sockets* is one of the
structural coordinates it weighs.

## Exporting a patch

From **⋯** → *Export this patch* (JSON) or *Export as image…* (PNG or SVG, at a
scale and background you choose). The exported image **contains the patch**: an
Auracle PNG or SVG can be imported back, so a screenshot of a rack is also the
rack.
