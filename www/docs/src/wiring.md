# Wiring and the node bank

<p class="lede">Forty-two modules, each one honest about what the model does and
does not know about it.</p>

## The catalogue

<figure>
<img src="./img/node-bank.webp" alt="The PATCH view with the node bank open on the right: ten groups of modules down a rail, each entry carrying a transfer-function glyph, a name, a port signature and a θ bar, with the formant oscillator's spec card opened beside it." loading="eager" width="1440" height="900">
<figcaption><strong>The node bank, with a card open.</strong> Every entry says
what it does to a wave, what it takes and gives, and what the model makes of
it.</figcaption>
</figure>

The rail on the right of PATCH is the instrument's inventory: **forty-two
modules in ten groups**, ordered along the signal path: sources → shape →
filter → space → motion → dynamics → combine, then the modulators: modulation
→ shape cv (what bends a modulator) → combine cv (two modulators, one cable).
That way "what goes after a filter" is a question the ordering answers.

Every entry carries four things at rest:

- A **transfer-function glyph** showing what this does to a wave.
- The **name a synthesist would use**.
- A **port signature** in both phosphors: what it takes and what it gives.
- A **θ bar with a ±σ whisker**: what the model thinks of this module. It
  appears only once the model has been fitted **and** at least five patches in
  the pool use it. Below that it draws a dash. The bar is solid when the
  whisker clears zero and hollow while it crosses it (still a guess), the same
  two marks as TASTE's DIRECTIONS.

That threshold matters. "The model barely likes this" and "the model has never
seen this" are completely different statements and should not look alike.

### Searching it

<kbd>/</kbd> focuses the index. It matches **by sound as well as by name**:
*grit* finds distortion and bitcrush, *wander* finds sample-and-hold random,
*vowel* finds the formant oscillator.

### The spec card

Hovering or focusing an entry opens its card:

<figure>
<img src="./img/spec-card.webp" alt="The formant oscillator's spec card: a glyph, the name FORMANT, the port map out — audio, mod → vowel, a sentence describing it, its default parameters, a heard-as line, and a note reading in 6 of 40 patches, the model has looked and has no lean either way, θ 0.05 ± 0.17, an interval that straddles zero." loading="eager" width="950" height="108">
<figcaption><strong>A spec card.</strong> What the module does, what it takes
and gives, what it arrives set to, and — only where the evidence supports it —
what the model makes of it.</figcaption>
</figure>

Five things:

1. One sentence in the instrument's voice.
2. The port map.
3. The parameters it will arrive with.
4. **What the model believes**, in one of five states: *not measured*, *not
   fitted*, *too few examples*, *still a guess*, or *here is the belief, with
   its interval*. The card above is the fourth: *still a guess: it could lean
   either way*, with an interval that crosses zero. (The screenshot shows the
   older wording, *has no lean either way*.)
   [Reading what it learned](./reading-the-model.md#five-states-and-what-each-means)
   quotes all five.
5. **heard**: what the feature extractor can and cannot pick up about this
   module. Chorus's card says the model hears it *as comb filtering, not as
   width*: the feature pipeline sums left and right, so the model can learn the
   artefact but never the effect.

That fifth line tells you when your preference is real but *invisible* to the
machinery. In that case, starring patches that use it will not teach the model
what you think it is teaching.

## Placing a module

**Arm and place** is the primary path:

1. **Click** an entry. It is now in your hand.
2. Every socket it can legally go into **lights up and names what will happen
   there**: green **inserts** ahead of what is in the socket, amber
   **replaces** it.
3. **Click a lit ○** to place. <kbd>Esc</kbd> to put it down.

Press-dragging from an entry also works, and a missed drop tells you so.

To hear a placement before you make it, rest the pointer on a lit ○ for a
moment, or press **▶** on the strip under the rack: it renders two seconds of
this patch with the module spliced in, and places nothing. Once the pointer has
left the socket, the strip names the one it is about ("hear it after the
filter") and that socket is ringed, so ▶ always plays what the strip shows.

Every placement is **one undo step**, and the confirmation toast offers **take
it out**.

### From the keyboard

The whole path has a keyboard equivalent:

| | |
|---|---|
| <kbd>Tab</kbd> | Reach the catalogue (one tab stop per group) |
| <kbd>↑</kbd> <kbd>↓</kbd> | Walk the entries |
| <kbd>Enter</kbd> | Arm the module |
| <kbd>↑</kbd> <kbd>↓</kbd> | Then walk the **lit sockets**, each one announced |
| <kbd>Enter</kbd> | Place |
| <kbd>Esc</kbd> | Put it down |

## Dragging cables

Drag from an **out** jack. As you drag:

- Every legal input lights up. Illegal ones do not, and the dragged module's
  own subtree is excluded, so you cannot create a cycle.
- The cable snaps within a tolerance.
- Dropping into empty space opens the catalogue **filtered**, with the socket
  pre-chosen.
- An illegal drop **says why**.

Click-source-then-click-target reaches the same place, with roving focus.

If you drop an output onto something that already has a consumer, you get a
pinned two-choice offer naming both consequences in plain English: *"A copy:
one output cannot feed two places."*

## Modulation chains

A modulation input does not take "an LFO". It takes a **modulation term**,
which can be a chain: `s&h rand → quantize → slew` before it ever reaches a
cutoff. The rack draws the whole chain in amber.

Consequences in the interface:

- Dropping a CV shaper onto an occupied slot **wraps** what is already there
  rather than evicting it.
- The socket tells you which of **fill** / **replace** / **wrap** you are about
  to do.
- Depth is bounded, so a modulation cannot be wired to swamp its destination.

### The step sequencer

**steps** is the one modulator you draw rather than dial. Under its three
knobs (rate, length, glide) sits a row of eight bars, one per step: press a
bar and drag up or down to set that step, or focus it with the arrow keys and
use Up/Down like any other knob. The line through the middle is "no push";
a bar above it pushes the destination up, a bar below pushes it down.

Cable it to a cutoff, a wavefolder or a wavetable's morph and the timbre plays
a rhythm of its own. Glide at zero gives hard steps; turned up, each step
slides into the next.

**length** decides how many of the eight bars play. The ones past it are
greyed but not gone: they stay in the patch, you can still set them, and
lengthening the pattern brings them back. Evolution treats every bar as its own
knob, so it can change one step of a pattern without touching the others, and a
lock on a bar (press <kbd>L</kbd> with it focused) holds that step while the rest
evolve.

Nearly every module carries a modulation slot with a named destination. Among
the sources, `vco` and `supersaw` take it as pitch, `wavetable` as morph,
`pluck` as decay and `formant` as vowel. The exceptions are the ones with
nowhere sensible to send it: `noise`, whose only control is a colour switch,
and `mix` and `ring mod`, whose two inputs are both audio.

## Binary modules

Six processors take **two** inputs, and the distinction matters when you wire
them:

| | Second input | |
|---|---|---|
| **mix** (crossfade), **ring mod** | audio | Merges two chains into one |
| **comp**, **duck**, **gate**, **vocoder** | *control* | Real sidechaining, in a typed tree |

In the second group the second input is a control signal, not audio, and the
rack will not let you wire it as though it were.

## IN THIS PATCH

Above the catalogue, what the current patch is made of. Clicking a pill jumps
to that module in the rack.

## The HELD tray

Anything you unplug, delete or bypass goes here, and **stays across a reload**.
Drag it back onto any lit ○ to put it in. The socket it came out of is left
[empty and silent](./rack.md#empty-sockets).

Collapsed, the rail keeps its name and the count of what is held below it, so
staged work is never hidden silently. The rail's width, its collapsed state,
and which groups are folded all persist.
