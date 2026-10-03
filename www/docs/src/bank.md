# The bank

<p class="lede">The bank, on the left of every level, holds your sounds in
three tabs. This page is about finding a sound, keeping it, seeing where a
bred sound came from, what the model thinks of each, and knowing which sounds
a generation may replace.</p>

<!-- film:composing --><!-- /film:composing -->

<figure>
<img src="./img/bank.webp" alt="The bank: three tabs, POOL, SAVED and PRESETS, each with its count; a Find a sound field; and a list of rows, each a small face, a glyph and a name." loading="eager" width="280" height="766">
<figcaption><strong>The bank.</strong> Three tabs, Find a sound, and a row
for each sound: its face, a mark for where it came from, and its name. The
green rail marks the sound you’re playing, a silk rail a saved sound, and an
amber name is one it was given (a preset’s, or one you typed) rather than one
drawn from the sound.</figcaption>
</figure>

| Tab | What it holds |
|---|---|
| **POOL** | The sounds the model weighs and breeds from |
| **SAVED** | The sounds you saved. No generation replaces them |
| **PRESETS** | The hand-made library that came with the instrument |

Each tab carries its count, and its tooltip says what it holds. SAVED’s
tooltip also counts your saves (*3 of 10 saved*), and its count turns amber
when every save is used. While the pool is still filling after a start, POOL
reads **+12** beside its count, the sounds still on their way.

The **?** at the end of the find row walks you through the three tabs and
what a generation is, starting at the tab you’re on.

## Find a sound

Type in **Find a sound** under the tabs, and the bank keeps only the sounds
whose name, family, or description has what you typed: *bass*, *bright*,
*saws*. It works in every tab, and what you typed stays as you switch tabs,
rate, cut, or rename. While it narrows **POOL**, the rows stand on their own,
without the groups below. <kbd>Esc</kbd> clears it.

A preset’s family and description are its own; a pool sound you opened from a
preset is found by that preset’s too. Typing in the field plays no notes.

## Find and keep a sound

1. Click a row to open it as the sound you’re playing.
2. Point at a row (or put the bank’s cursor on it) and its actions appear at
   its end: **▶** plays the standard phrase without opening it.
3. **★** opens five stars in the actions’ place: press one to rate the sound
   and teach the model what you think of it. From the keyboard,
   <kbd>1</kbd>–<kbd>5</kbd> rate the row under the cursor.
4. The save icon (a disk) keeps it: no generation will replace it.
5. **×** cuts it: it tells the model “not this one” and takes the row out of
   the pairs.

From the keyboard, <kbd>[</kbd> and <kbd>]</kbd> step through the bank at any
level; [the keys](#the-bank-from-the-keyboard) are below.

## Reading a row

<figure>
<img src="./img/bank-row.webp" alt="One bank row under the pointer: a small face, a glyph and a name, with its actions at the end: play, a star, a save icon, and a cross." loading="lazy" width="280" height="40">
<figcaption><strong>One row,</strong> pointed at: its actions sit over the
row’s end.</figcaption>
</figure>

- **The face**, left of the name, is the sound’s [face](./faces.md): its
  spectrum against the rest of the bank, from the sound’s own render. Every row
  keeps the face’s column, so the name is in the same place before the face
  arrives, and the bank is wider by the column rather than any name narrower.
- **The glyph** says where the sound came from: **◇** grown fresh, with no
  taste in it yet; **⚡** bred toward your taste; **✎** your edit, kept as new;
  **▤** a hand-made preset.
- **NEW**, in the glyph’s place, marks a child of the latest generation (every
  one of them is bred, ⚡). In **POOL**, those children lead the list under
  **NEW · GENERATION 3** and their count, in the order they were bred, and the
  rest follow under **IN THE POOL**, in the order they joined it. A child of
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
  only where one module went and another came. Click the line, the row’s
  EVOLVE mark among its actions, or press <kbd>c</kbd> on the row, to
  [compare](#compare-a-sound-beside-its-seed) the sound with its seed.
- **The actions**, at the row’s end when you point at it or the cursor is on
  it (and on the sound you’re playing, on a touch screen): the EVOLVE mark for
  a bred sound (compare), **▶**, **★**, the save icon and **×**. Out of sight
  they can’t be pressed either.
  - **▶** plays the standard phrase, and shows **■** while it plays. If it has
    to be rendered first, a dotted amber ring says it’s on its way.
  - **★** opens the five stars; a rated sound’s ★ is filled. Rating teaches
    the model.
  - **The save icon** keeps it, and teaches nothing: *Saved Glass Pad. No
    generation will replace it (3 of 10 saved).*
  - **×** cuts it, which teaches the model “not this one”. The sound is never
    dealt to you in a pair again; if it was on the cards, a new pair is dealt.
    The toast, *Cut Soft Wash. It won’t be dealt again.*, carries **UNDO** for
    seven seconds (<kbd>⌘Z</kbd>, or Ctrl Z, does the same), and nothing is
    recorded until they’re up.

A cut sound stays in the pool until a generation replaces it. With Show
measurements on, a row also shows its id, and its tooltip its signature.

## What the model thinks of each: hold ⌥

Hold <kbd>⌥</kbd> (Alt off Apple platforms), or press and hold **MODEL** in
the menu bar, and the bank shows [the model view](./reading-the-model.md#the-model-view):

- **A percentage** at each row’s end: the model’s guess, roughly how likely you
  are to pick this sound in a pair. Its tooltip adds the word for how sure that
  reads (*59% · leaning*). Before the model has been fitted it reads **·**.
- **A bar** along the row’s foot draws the same guess. The bright tick is the
  guess, and the dimmer block around it shows how unsure it is: a narrow block
  is a sure guess, a wide one an unsure guess. Before the first fit it is
  hatched: there is no guess yet.
- **The pool in the order the model rates it**, highest first, under
  **RANKED BY THE MODEL**, once it has been fitted. The rows glide to their
  places, and when you let go they glide back to the order they joined the
  pool. **NEW** keeps its children in the order they were bred.

Let go and the bank is as it was. A tap on **MODEL** keeps the model view up
until you tap it again or press <kbd>Esc</kbd>. The row’s actions still come
when you point at it. A screen reader hears the guess in every row’s name, at
rest too.

## Compare a sound beside its seed

Click the line under a bred sound’s name, its EVOLVE mark among the row’s
actions, or press <kbd>c</kbd> with the bank’s cursor on it. Compare opens
beside the bank:

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
The pool has a fixed size, and each generation replaces the lowest-rated
sounds it can: any that aren’t saved, once they’ve been in a pick. A sound you
starred but didn’t save can be replaced. Stars are
for teaching; **save** is what keeps.
```

## A sound you keep as new is safe until it’s been in a pick

A sound you make in PATCH and [keep as new](./views/play.md), or open from a
[patch file](./your-data.md#a-patch), isn’t replaced until it has been in a
pick. Until then nothing replaces it, not a generation, not a preset you open,
not a ⚡ child, even when the model rates it lowest of all: it hasn’t heard an
answer about it yet. These end the wait, with the sound on either side,
whatever you picked:

- **a pair in EVOLVE** (or PATCH’s quick-pick strip) with it in it;
- **an offer in PERFORM** you [heard and answered](./views/perform.md#what-perform-teaches-the-model)
  while playing it, TAKE or NEXT, counted when the answer is (after its
  window), and only if you had kept the sound before you answered;
- **keeping an edit of it as new** with an answer: you picked between your
  edit and it on the **WHICH WOULD YOU REACH FOR?** card, or ticked **PICK
  THE EDIT**;
- **a cut**: you told the model “not this one”.

The question KEEP AS NEW asks about the sound you’re keeping doesn’t count:
that one is about the sound you edited from, and the new sound is safe
whatever you answer. **SKIP COMPARING** on a later edit doesn’t count either,
and nor do stars. After its first pick it’s an ordinary pool sound, rated and
replaced like any other, so save it if you want to keep it for good.

It isn’t a save. The row carries no mark, it doesn’t count toward your saves,
and it isn’t listed in **SAVED**. A quarter of the pool, 10 of 40, can wait
this way at once, not counting any you have also saved: keep an eleventh as
new before any of them has been in a pick, and the oldest of them goes back to
being an ordinary pool sound (it stays in the pool; it can be replaced again).
Saves and these together never take more than half the pool, so there is
always room for what a generation breeds.

## Which sounds a generation breeds from, and replaces

The pool holds 40 sounds. A generation’s children join it as they are bred,
and when the generation ends (or you stop it), it replaces the lowest-rated
sounds it can to bring it back to 40: not a saved sound, nor one you kept as
new that is still waiting for its first pick
([above](#a-sound-you-keep-as-new-is-safe-until-its-been-in-a-pick)). The
toast names them: *Generation 3: 4 new sounds in the pool. It replaced the 4
lowest-rated sounds it could: Bell Jar, Soft Wash, Glass Rain, and 1 more.*

1. Hover **EVOLVE POOL** in EVOLVE (or move the focus to it). The ten sounds
   the next generation would breed from get a solid amber rail and **SEED**;
   the sounds it may replace get a dashed rail and **MAY BE REPLACED**. No
   other sound can be replaced when it ends. A saved sound is never marked,
   and nor is a sound you kept as new that hasn’t been in a pick yet. The
   words sit at the row’s end, where its actions come when you point at the
   row, so no name moves.
2. Save any you want to keep before you press it.

The marks are the engine’s own lists, and they move as your picks move the
model’s ratings.

While a generation runs, hovering **EVOLVE POOL** marks that generation’s
seeds, and **WILL BE REPLACED** on the sounds its end will replace, whether
you stop it now or let it finish: none before its first child, then one more
with each child it takes in. That isn’t all that can go: each child still to
come can add the next lowest-rated sound it can replace. A save still keeps a sound
while the generation runs: its mark goes, and the sound that will be replaced
in its place is marked instead.

While ⚡ evolve from this walks, hovering **EVOLVE POOL** marks its seed, and
**MAY BE REPLACED** on the one sound its child would replace: the
lowest-rated sound it can replace other than its seed, if the pool is full and
the child rates high enough to join it.

When a generation ends, **REPLACED · GENERATION 3** at the foot of **POOL**
counts what it replaced. Click it for their names. Names are all that’s kept:
a replaced sound can’t be played or brought back.

Saves are capped at a quarter of the pool, 10 of 40, so the pool always has
room for new sounds. The engine’s own default pool is 48; the app asks for 40,
which is why the [reference](../reference/architecture/two-loops.html) quotes
48.

## Presets

Sixty-two hand-made sounds in seven families (bass, lead, keys, pad, texture,
perc, and weird), browsed in place under each family’s name and count. A
preset’s description is its name’s tooltip.

1. Open **PRESETS**.
2. Point at a row and press **▶** to hear it, or click the row to open it as
   the sound you’re playing.

The engine can only play what it holds, so a preset you hear or open joins
the pool and replaces the lowest-rated sound it can. The toast names what it
replaced (*It replaced the lowest-rated sound it could: Bell Jar.*), and saved
sounds are never among them, nor is a sound you kept as new that hasn’t been in
a pick yet. From then on the row
reads **IN POOL**, and a second click opens the same copy.

The presets are worth playing through early. They are what the [warm
start](./teaching.md#the-warm-start) draws from, and they cover the range of
modules more evenly than the fresh sounds do.

## The bank from the keyboard

The tabs are one tab stop: <kbd>←</kbd> and <kbd>→</kbd> (or <kbd>Home</kbd>
and <kbd>End</kbd>) show the next bank as they move. **Find a sound** and the
walkthrough’s **?** are the next stops, and the list is a single stop after
them. In the list:

| | |
|---|---|
| <kbd>↑</kbd> <kbd>↓</kbd> | Move the cursor (the row’s actions show on it) |
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
- Hold <kbd>⌥</kbd> and see which sounds the model rates highest, and how
  sure it is of each.
- [What the model learns from](./teaching.md) says how stars, picks, and cuts
  differ.
