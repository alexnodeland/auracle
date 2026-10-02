# The bank

<p class="lede">The bank, on the left of every view, holds your sounds in
three tabs. This page is about finding a sound, keeping it, seeing where a
bred sound came from, and knowing which sounds a generation may replace.</p>

<!-- film:composing --><!-- /film:composing -->

<figure>
<img src="./img/bank.webp" alt="The bank rail: three tabs with counts above a list of rows, each with a name, a percentage, a play button, five stars, and a save icon." loading="eager" width="252" height="720">
<figcaption><strong>The bank.</strong> Three tabs, and a row for each sound
carrying the model’s guess about it. The screenshot predates the current tab
names (POOL, SAVED, and PRESETS), each row’s face, and the column left of each
name where NEW and the dot sit.</figcaption>
</figure>

| Tab | What it holds |
|---|---|
| **POOL** | The sounds the model weighs and breeds from |
| **SAVED** | The sounds you saved. No generation replaces them |
| **PRESETS** | The hand-made library that came with the instrument |

Each tab has a line under it saying what it holds, with **WHAT’S THIS?**,
which walks you through the three tabs and what a generation is. The head
counts your saves (*3/10 saved*).

## Find and keep a sound

1. Click a row to open it as the sound you’re playing. **▶** plays the
   standard phrase without opening it.
2. Rate it with **★** (one to five) if you want to teach the model what you
   think of it.
3. Press the save icon (a disk) to keep it: no generation will replace it.
4. Press **cut** to tell the model “not this one” and take the row out of the
   pairs.

From the keyboard, <kbd>[</kbd> and <kbd>]</kbd> step through the bank in any
view; [the keys](#the-bank-from-the-keyboard) are below.

## Reading a row

<figure>
<img src="./img/bank-row.webp" alt="One bank row, outlined in green: a glyph, a name, a percentage and an id on the right, and below them a play triangle, five filled stars, a save icon, and a horizontal bar." loading="lazy" width="252" height="70">
<figcaption><strong>One row.</strong> The green outline is the row you’re on.
The id at the right shows only with Show measurements now, and the name now
starts a little further right, after the row’s face and a column every row
keeps for its marks.</figcaption>
</figure>

- **The face**, left of the row’s two lines, is the sound’s
  [face](./faces.md): its spectrum against the rest of the bank, from the
  sound’s own render. Every row keeps the face’s column, so the name is in the
  same place before the face arrives, and the bank is wider by the column
  rather than any name narrower.
- **The glyph** says where the sound came from: **◇** grown fresh, with no
  taste in it yet; **⚡** bred toward your taste; **✎** your edit, kept as new;
  **▤** a hand-made preset.
- **NEW**, in the glyph’s place, marks a child of the latest generation (every
  one of them is bred, ⚡). In **POOL**, those children lead the list under
  **NEW · GENERATION 3** and their count, in the order they were bred, and the
  rest follow under **RANKED BY THE MODEL**, highest rated first. A child of
  [⚡ evolve from this](./rack.md#locks-and-evolving-from-here) joins the group
  the same way, since ⚡ counts as a generation of its own. If the generation
  bred children the pool didn’t keep, a line under the group counts them
  (*2 more were bred and rated below the pool.*).
- **The green dot** after the glyph marks a child you haven’t heard yet. It
  goes when its phrase plays (its **▶**, a pair’s **▶ SAMPLE**,
  [Compare](#compare-a-sound-beside-its-seed), or <kbd>Space</kbd> while it’s
  the sound you’re playing) or you play a note on it, and it is remembered
  across a reload until then. Playing an edit of it doesn’t count: that’s
  another sound.
- **The name** comes from what the sound is, and it keeps that name as the
  bank changes around it. Double-click it to rename it. NEW and the dot sit in
  a column every row keeps left of the name, so the name never moves for
  them.
- **The line under a bred sound’s name** says which seed it grew from and
  what changed: *from Soft Pad · +delay, cutoff 1.2 kHz → 3.4 kHz*, the first
  three changes and then how many more. The modules are counted, so the line
  says what the patch gained and lost: a module that moved from one place in
  the patch to another isn’t a change, and a swap (`filter → delay`) is said
  only where one module went and another came. Click the line, or press
  <kbd>c</kbd> on the row, to [compare](#compare-a-sound-beside-its-seed) the
  sound with its seed.
- **The percentage** is the model’s guess: roughly how likely you are to pick
  this sound in a pair. Its tooltip adds the word for how sure that reads
  (*59% · leaning*). Before the model has been fitted it reads **·**.
- **The bar** along the row’s bottom edge draws the same guess. The bright
  tick is the guess, and the dimmer block around it shows how unsure it is: a
  narrow block is a sure guess, a wide one an unsure guess.
- **▶** plays the standard phrase. If it has to be rendered first, a dotted
  amber ring says it’s on its way.
- **★★★★★** rates it, and teaches the model.
- **The save icon** keeps it, and teaches nothing: *Saved Glass Pad. No generation will
  replace it (3 of 10 saved).*
- **cut** teaches the model “not this one”. The sound is never dealt to you in
  a pair again; if it was on the cards, a new pair is dealt. The toast, *Cut
  Soft Wash. It won’t be dealt again.*, carries **UNDO** for seven seconds
  (<kbd>⌘Z</kbd>, or Ctrl Z, does the same), and nothing is recorded until
  they’re up. The cut shows when you hover the row or put the cursor on it,
  and always on a touch screen.

A cut sound stays in the pool until a generation replaces it.

## Compare a sound beside its seed

Click the line under a bred sound’s name, or press <kbd>c</kbd> with the
bank’s cursor on it. Compare opens beside the bank:

- **The figure** draws the seed’s phrase as a dashed outline, and the child’s
  growing out of it into its own. Only the two ends are the engine’s: a walk
  keeps no record of its steps, so the frames between are the one shape
  turning into the other, not the walk’s path.
- **What changed**, every change the walk made, one a line: modules added
  (**+**) or removed (**−**), a module swapped (`filter → delay`), counted as
  the row’s line counts them, and knobs in their own units. A walk can change
  a couple of dozen things, and past about ten lines the list scrolls.
- **What the model rated each when it bred them**, in its own words: *when it
  bred them, it rated Soft Pad 60% · leaning and Warm Drone 2 52% · a hunch*.
  A child rated well below its seed is marked *exploring*, as the
  [EVOLUTION strip](./views/evolve.md#the-evolution-strip) marks it.
- **▶ for each**, the seed and the child, while both are in the pool. A seed
  a generation has replaced is only a name (*Soft Pad · replaced*): its sound
  was dropped, so there is nothing to play.

Press <kbd>Esc</kbd>, **×**, or click anywhere else to close it. From the
keyboard, <kbd>Esc</kbd> hands the keys back to the bank.

## Stars are not saves

The two controls do different jobs.

**★ teaches.** A star rating goes into what the model learns from, and moves
its guess about your taste. Rate the sounds you wouldn’t reach for, too: that
is information.

**save keeps.** It lists the sound in **SAVED** as well as **POOL**, and no
generation replaces it. It records nothing about your taste.

They are kept apart on purpose. The pool replaces the sounds the model rates
lowest. If a star decided what stayed, a high rating would become a way to
protect a sound, and every protective rating would teach the model a taste you
don’t have.

```admonish warning title="If you want to keep it, save it"
The pool has a fixed size, and each generation replaces its lowest-rated
unsaved sounds. A sound you starred but didn’t save can be replaced. Stars are
for teaching; **save** is what keeps.
```

## Which sounds a generation breeds from, and replaces

The pool holds 40 sounds. A generation’s children join it as they are bred,
and when the generation ends (or you stop it), the lowest-rated unsaved sounds
are replaced to bring it back to 40. The toast names them: *Generation 3: 4
new sounds in the pool. The 4 it rated lowest were replaced: Bell Jar, Soft
Wash, Glass Rain, and 1 more.*

1. Hover **EVOLVE POOL** in EVOLVE (or move the focus to it). The ten sounds
   the next generation would breed from get a solid amber rail and **SEED**;
   the sounds it may replace get a dashed rail and **MAY BE REPLACED**. No
   other sound can be replaced when it ends. The words sit where the stars
   are, so no name moves.
2. Save any you want to keep before you press it.

The marks are the engine’s own lists, and they move as your picks move the
model’s ratings.

While a generation runs, hovering **EVOLVE POOL** marks that generation’s
seeds, and **WILL BE REPLACED** on the sounds its end will replace, whether
you stop it now or let it finish: none before its first child, then one more
with each child it takes in. That isn’t all that can go: each child still to
come can add the next lowest-rated unsaved sound. A save still keeps a sound
while the generation runs: its mark goes, and the sound that will be replaced
in its place is marked instead.

While ⚡ evolve from this walks, hovering **EVOLVE POOL** marks its seed, and
**MAY BE REPLACED** on the one sound its child would replace: the
lowest-rated unsaved sound other than its seed, if the pool is full and the
child rates high enough to join it.

When a generation ends, **REPLACED · GENERATION 3** at the foot of **POOL**
counts what it replaced. Click it for their names. Names are all that’s kept:
a replaced sound can’t be played or brought back.

Saves are capped at a quarter of the pool, 10 of 40, so the pool always has
room for new sounds. The engine’s own default pool is 48; the app asks for 40,
which is why the [reference](../reference/architecture/two-loops.html) quotes
48.

## Presets

Sixty-two hand-made sounds in seven families (bass, lead, keys, pad, texture,
perc, and weird), browsed in place.

1. Open **PRESETS**.
2. Press **▶** to hear one, or click its row to open it as the sound you’re
   playing.

The engine can only play what it holds, so a preset you hear or open joins
the pool and replaces the unsaved sound the model rates lowest. The toast names
what it replaced, and saved sounds are never among them. From then on the row
reads **IN POOL**, and a second click opens the same copy.

The presets are worth playing through early. They are what the [warm
start](./teaching.md#the-warm-start) draws from, and they cover the range of
modules more evenly than the fresh sounds do.

## The bank from the keyboard

The bank is a single tab stop. Reach it with <kbd>Tab</kbd>, then:

| | |
|---|---|
| <kbd>↑</kbd> <kbd>↓</kbd> | Move the cursor |
| <kbd>Enter</kbd> | Open the sound |
| <kbd>1</kbd>–<kbd>5</kbd> | Rate it |
| <kbd>m</kbd> | Save it |
| <kbd>c</kbd> | Compare a bred sound with its seed |

In **PRESETS**, <kbd>Enter</kbd> opens the preset under the cursor and
<kbd>p</kbd> plays it. <kbd>p</kbd> is also a note (D♯), but not while the
presets list has focus.

The save key is <kbd>m</kbd> rather than <kbd>s</kbd> because <kbd>s</kbd> is a
note, and note letters get through even when a control has focus.

A screen reader hears each row’s whole state (name, saved, rating, and the
model’s guess), because the row’s buttons sit outside the tab order.

## What to try next

- Save the sounds you’d reach for again, before your next generation.
- Rate a few sounds you wouldn’t reach for: low stars teach too.
- [What the model learns from](./teaching.md) says how stars, picks, and cuts
  differ.
