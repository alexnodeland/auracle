# Wiring and the module rail

<p class="lede">The module rail on the right of PATCH holds all 43 modules.
This page is about adding a module to a patch, rewiring it with cables, and
reading what the model makes of each module.</p>

## Add a module

1. Click a module in the rail. It is now in your hand.
2. Every socket it can go into lights up and says what will happen there:
   green **inserts** it after what’s in the socket, and amber **replaces** it.
3. Click a lit ○ to place it. <kbd>Esc</kbd> puts it down.

To hear a placement before you make it, rest the pointer on a lit ○ for a
moment, or press **▶** on the strip under the rack. It renders two seconds of
the patch with the module in it, and places nothing. Once the pointer leaves
the socket, the strip names the one it means (*hear it after the filter*) and
that socket is ringed, so ▶ plays what the strip shows.

Every placement is one undo step, and its toast offers **TAKE IT OUT**.
Dragging a module from the rail onto a socket works too, and a missed drop
says so.

### From the keyboard

| | |
|---|---|
| <kbd>Tab</kbd> | Reach the rail: one stop per group |
| <kbd>↑</kbd> <kbd>↓</kbd> | Walk the modules |
| <kbd>Enter</kbd> | Pick one up |
| <kbd>↑</kbd> <kbd>↓</kbd> | Then walk the lit sockets, each one announced |
| <kbd>Enter</kbd> | Place it |
| <kbd>Esc</kbd> | Put it down |

## The module rail

<figure>
<img src="./img/node-bank.webp" alt="The PATCH view with the module rail open on the right: ten groups of modules down a rail, each module with a glyph, a name, its ports, and a bar, with the formant oscillator’s card open beside it." loading="eager" width="1440" height="900">
<figcaption><strong>The module rail, with a card open.</strong> Every module
says what it does to a wave, what it takes and gives, and what the model makes
of it.</figcaption>
</figure>

The rail, headed **MODULES**, holds 43 modules in ten groups, in the order a
signal meets them:

- the sound: **SOURCES**, **SHAPE**, **FILTER**, **SPACE**, **MOTION**,
  **DYNAMICS**, and **COMBINE**;
- then the modulators: **MODULATION**, **SHAPE CV** (what bends a modulator),
  and **COMBINE CV** (two modulators, one cable).

So “what goes after a filter” is a question the order answers.

Above the groups, **IN THIS PATCH** lists the modules the patch is made of.
Click one to jump to it in the rack.

Each module shows four things at rest:

- a **glyph** for what it does to a wave;
- the **name** a synthesist would use;
- its **ports**: what it takes, and what it gives;
- a **bar with a whisker**: which way your taste leans on this kind of module,
  and how sure the model is.

The bar appears only once the model has been fitted and at least five sounds
in the pool use the module; until then it’s a dash. It is solid when the
whisker clears zero, and hollow while it crosses it (still a guess), as
LEARNING’s weights draw it. “The model barely leans on this” and “the model has never
seen this” are different statements, and they don’t look alike.

### Searching it

Press <kbd>/</kbd> to search. It finds a module by sound as well as by name:
*grit* finds distortion and bitcrush, *wander* finds sample-and-hold random,
and *vowel* finds the formant oscillator. A search for something Auracle
doesn’t have says so, and says why.

### The spec card

Point at a module, or focus it, and its card opens:

<figure>
<img src="./img/spec-card.webp" alt="The formant oscillator’s spec card: a glyph, the name FORMANT, its ports, a sentence describing it, its default settings, a heard line, and a line on what the model makes of it." loading="eager" width="950" height="108">
<figcaption><strong>A spec card.</strong> What the module does, what it takes
and gives, what it arrives set to, and what the model makes of it. The
screenshot shows the older wording, <em>has no lean either way</em>; the card
now says <em>Still a guess: it could lean either way</em>.</figcaption>
</figure>

1. **One sentence** on what it does to a sound.
2. **Its ports.**
3. **The settings it arrives with.**
4. **What the model makes of it,** in one of five states, from *Not a
   coordinate the taste model measures on its own.* to *you lean toward it*.
   [Reading what it learned](./reading-the-model.md#five-states-and-what-each-means)
   quotes all five.
5. **heard:** what the model can and can’t hear of this module. The chorus
   card says the model hears it *as comb filtering, not as width: the model
   hears left and right summed, so it learns the artifact rather than the
   effect.*

That last line tells you when a taste of yours is real but out of the model’s
hearing. Then starring sounds that use the module won’t teach the model what
you mean.

## Dragging cables

1. Drag from an **out** jack.
2. Every input it can go into lights up. The module’s own chain is left out,
   so you can’t make a loop.
3. Drop it on a lit jack. It snaps within a short distance.

Dropping into empty space opens the module rail with that socket already
chosen, and a drop that can’t work says why. Clicking the source and then the
target works too.

Drop an output onto a socket that already has something in it, and a small
menu asks which you mean:

- **move it here**: the module leaves its old socket (which becomes empty), and
  what was here is set aside below;
- **branch here**: a copy joins what is here through a mix, and nothing moves.
  It’s a copy because one output can’t feed two places.

## Modulation chains

A modulation input takes a chain, not only one modulator: `s&h rand →
quantize → slew` before it ever reaches a cutoff. The rack draws the whole
chain in amber.

- Drop a **SHAPE CV** module (quantize, slew, rectify, hold) on a cable that
  already carries a modulator, and it takes that modulator as its input
  instead of replacing it.
- **COMBINE CV** takes two modulators and gives back one.
- The socket says which of fill, replace, or shape it’s about to do.
- How deep a modulation can go is bounded, so it can’t be wired to swamp its
  destination.

Nearly every module has a modulation input with a named destination. Among
the sources, `vco` and `supersaw` take it as pitch, `wavetable` as morph,
`pluck` as decay, and `formant` as vowel. The ones with nowhere sensible to
send it go without: `noise`, whose only setting is a color switch, and `mix`
and `ring mod`, whose two inputs are both audio.

### The step sequencer

**steps** is the one modulator you draw rather than dial. Under its three
knobs (rate, length, and glide) sits a row of eight bars, one per step.

1. Press a bar and drag up or down to set that step, or focus it and use
   <kbd>↑</kbd> and <kbd>↓</kbd> like any other knob.
2. Cable it to a cutoff, a wavefolder, or a wavetable’s morph, and the timbre
   plays a rhythm of its own.
3. Turn **glide** up to slide each step into the next; at zero the steps are
   hard.

The line through the middle is no push: a bar above it pushes the destination
up, and a bar below pushes it down. **length** sets how many of the eight bars
play. The ones past it are grayed but kept, and lengthening the pattern brings
them back.

Breeding treats every bar as its own knob, so it can change one step without
touching the others. Press <kbd>L</kbd> on a focused bar to lock that step
while the rest evolve.

## Two-input modules

Six modules take two inputs, and the difference matters when you wire them:

| | Second input | |
|---|---|---|
| **mix** (crossfade), **ring mod** | audio | Merges two chains into one |
| **comp**, **duck**, **gate**, **vocoder** | control | Real sidechaining |

In the second group the second input is a control signal, not audio, and the
rack won’t let you wire it as audio.

## SET ASIDE

Anything you unplug, delete, or bypass goes to **SET ASIDE** under the rack,
and stays across a reload.

1. Drag a wired **in** jack off its socket to unplug it. The chain is set
   aside, and the socket it left is [empty and silent](./rack.md#empty-sockets).
2. Drag it back from **SET ASIDE** onto a lit ○ to put it in.

Folded away, the rail keeps its name and a count of what is set aside, so
staged work is never hidden. The rail’s width, whether it is folded, and which
groups are open all persist.

## What to try next

- Search the rail for *grit*, and try each module it finds on the same sound.
- Drop a **SHAPE CV** module on an amber cable, and hear the modulation change
  shape.
- [Reading what it learned](./reading-the-model.md): what the bars on the rail
  can and can’t tell you.
