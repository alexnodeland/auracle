# EVOLVE: breeding sounds you’d reach for

<p class="lede">EVOLVE is where you teach the model and breed from what it
learned. It plays you two sounds, you pick the one you’d reach for, and
EVOLVE POOL grows new sounds toward your picks.</p>

<!-- film:view-evolve --><!-- /film:view-evolve -->

EVOLVE is [the level](../levels.md) beside PERFORM: <kbd>⌥←</kbd> (or
<kbd>⌥3</kbd>, or the stop left of PERFORM’s) goes there, and <kbd>⌥→</kbd>
comes back. Zooming from it is measured from PERFORM: <kbd>⌥↑</kbd> goes to
TASTE, <kbd>⌥↓</kbd> to PATCH.

<figure>
<img src="../img/evolve.webp" alt="EVOLVE: the question Pick the one you’d reach for, with six pips and a teaching line under it and a small TASTE map at its right; two cards, each with its sound’s face large in a well, its name, and PLAY and PICK; ANOTHER PAIR and EVOLVE POOL under them." loading="eager" width="1440" height="900">
<figcaption><strong>EVOLVE.</strong> Two sounds and one question. The line
under it counts down to the next refit; the small map shows the pair among
every sound.</figcaption>
</figure>

## Pick between two sounds

1. Press <kbd>1</kbd> and <kbd>2</kbd> (or **▶ PLAY** on each card) to hear
   A and B. Press again to stop.
2. Click a card’s body to play that sound live on the keys, when the phrase
   doesn’t tell two sounds apart.
3. Press <kbd>←</kbd> or <kbd>→</kbd> (or **PICK A**, **PICK B**) for the one
   you’d reach for.
4. Press **ANOTHER PAIR** (<kbd>N</kbd>) to deal a new pair without picking.
   It records nothing.

Both sides play the same five-second phrase: a held C4, a C5 stab, a C4 and E4
together, and a low C3 with a long release. The same phrase is what makes two
sounds comparable, and [the reference says why each part is
there](../../reference/audition/phrase.html).

A pick counts the moment you make it: **TAUGHT** in the menu bar and the pips
move at once. For seven seconds you can take it back, with <kbd>⌘Z</kbd>
(Ctrl Z) or **NOT WHAT I MEANT** on its toast (*Picked Glass Pad over Soft
Wash.*). After that it goes into the log for good.

<kbd>⌘Z</kbd> in EVOLVE only ever takes back a pick or a cut. With none to
take back it says *Nothing to undo here. PATCH edits undo in PATCH.*

## What you see

**The head.** *Pick the one you’d reach for.*, with the six pips and the
teaching line under it (below), and at its right a small [TASTE](./taste.md)
map: every sound in the pool where the map puts it, with A and B ringed where
they are on it. Click it to go to TASTE.

**The cards.** Each card is one sound: its [face](../faces.md), large, in a
well, then its name, its family and blurb where it has them (a sound opened
from the library keeps its preset’s), and **▶ PLAY** and **PICK A** (or
**PICK B**). While its **PLAY** sounds, what you hear is drawn over its face
([while you play it](../faces.md#while-you-play-it)), and the other card’s
stays still. While a sound’s audio is on its way, *rendering…* sweeps across
its well. In the well’s corner, **⇄ CIRCUIT** flips the face to the patch’s
modules (and back, **⇄ FACE**), and **↓ PATCH** opens the sound in
[PATCH](./play.md) without picking. Hold <kbd>⌥</kbd> for [the model
view](../reading-the-model.md#the-model-view) and each card also shows the
style that rates it highest, and the card the model favours says so before
you pick: *it guesses this · 62% · leaning*. The names come from what the
sound is, so *Round Wash* and *Gritty Swell* mean something.

**The teaching line.** Under the question, six pips count down to the next
refit, and the line says how far it is:

- *Play both. Pick the one you’d reach for.* before your first pick;
- *3 more picks and it redraws your taste map.* on the way;
- *● learning from your last 6 picks…* while the refit runs;
- *● it just learned: see what changed ▸* when it lands. The link opens the
  [TASTE](./taste.md) map, and the line says so until your next pick.

During a generation or a ⚡ walk the line reads *● it will learn from these 6
when breeding finishes* instead, because a refit waits for them.

**The forecast.** After each pick, the line beside **ANOTHER PAIR** says what
the model guessed before you picked, and how sure it was: *it guessed this ·
72% · fairly sure*, or *it guessed the other · 62% · leaning*. The words come
from one scale: *a hunch*, *leaning*, and *fairly sure*. It is the same guess
the model view shows on a card before the pick; if the model refits while the
pair is up, the card’s guess is asked again.

**How the pair was dealt.** Beside **ANOTHER PAIR**, *◇ random pair · a fair
test* says that every pair is dealt at random from the pool. The model
doesn’t choose what you hear, so every pick is a fair test of its guess.
[its forecasts in LEARNING](./learning.md#its-forecasts) are graded on them all.

**EVOLVE POOL**, at the right under the cards, with **WHAT EACH GENERATION
DID** under it. It’s the next section. Until your picks have taught the model
(its first refit), EVOLVE POOL is dashed amber: a generation then breeds from
the grammar alone, a guess. It can still be pressed.

```admonish info collapsible=true title="How it works: the next pair is already waiting"
While a pair is on the table, the engine deals the one after it and renders
both its sounds, so a pick or **ANOTHER PAIR** puts it up at once. The pair
after that is dealt behind it. Pairs go up in the order they were dealt, so a
seeded session shows the same pairs in the same order however long each deal
took.

When the pool is still filling as the app opens (a new session, or a saved
one that came back with sounds missing), each pair is dealt at once from the
sounds that have arrived, so a pick never waits for more. Which sounds
those are depends on how fast the pool fills, so a session opened with a
random seed in the address
(`?seed=`, [Running locally](../getting-started/running-locally.md#overrides))
deals by a fixed schedule instead. Its first four deals each reach eight
sounds further, in the order the pool fills: the first deal is from its
first eight sounds, the next from the first 16, then 24 and 32, even if the
pool has filled by then. Every deal after that is from the whole pool. (A
pair that can’t go up, such as the pair just put away, is dealt again, and
that counts as a deal.) A deal whose sounds haven’t all arrived waits for
them, so the same seed and the same picks deal the same pairs on any
machine, however fast its pool fills. Pick very fast in the first seconds of
such a session and the next pair can take a moment, longer on a slower
computer; the cards then say *dealing: the engine is filling the pool
(16/40)*, with how many sounds have arrived. A saved session that comes
back with its whole pool has nothing to fill, and every deal is from all of
it.

The next pair is chosen before your pick is known. That changes nothing,
because pairs are dealt at random and your pick is held for its seven seconds
anyway. A sound you cut meanwhile is never put up: that pair is dropped and
dealt again, and so is one that lost a sound to a generation. A cut changes
no pair but one holding the sound you cut. After <kbd>⌘Z</kbd>, picking
again or **ANOTHER PAIR** shows the same pairs, however fast their sounds
arrived.

Those renders wait behind what you ask for: a sound you open, a ▶ you press,
and PERFORM’s offers and first measurements. When no pair is waiting (right
after a cut, say), the cards dim, their buttons off, until the next is dealt.
A deal that takes longer says why on the cards, for example *dealing: the
engine is breeding (seed 4/10)*.

When fewer than two sounds in the pool are left uncut, there is no pair to
deal. The cards stay dimmed, with **▶ PLAY**, **PICK A**, **PICK B**,
**⇄ CIRCUIT**, **↓ PATCH** and **ANOTHER PAIR** off, and say *Nothing to
pair. Fewer than two sounds are left to deal.* They deal again by themselves
when a cut is taken back or the pool changes.

If the engine can’t deal a pair, the cards stay dimmed with **▶ PLAY**,
**PICK A**, **PICK B**, **⇄ CIRCUIT** and **↓ PATCH** off, and say
*Couldn’t deal a pair. ANOTHER PAIR tries again.* **ANOTHER PAIR** (or
<kbd>N</kbd>) deals again.
```

```admonish info collapsible=true title="How it works: between refits"
Your picks count before the refit, too. Each one is folded into the model
at once by reweighting the guesses it already holds, so its next forecast
answers your last pick. The refit is the full version: inference over every
pick so far, a few seconds of work off the audio thread.

While a refit runs, the job slot in the menu bar says *refitting your taste
map…*, and the amber lamp after the wordmark is lit. The reference has [the fit and the
reweighting](../../reference/taste/posterior.html) and [how pairs are
dealt](../../reference/search/acquisition.html).
```

## Breed a generation

1. Make a few picks first, so the model has something to breed toward.
2. Hover **EVOLVE POOL** to see what it would do, in the bank: the ten sounds
   it would breed from get a solid amber rail and **SEED**, and the sounds it
   may replace a dashed rail and **MAY BE REPLACED**. Save any you want to
   keep.
3. Press **EVOLVE POOL**. The bank shows **POOL**, where the children land.
4. Play the new sounds as they land at the top of the bank.

**EVOLVE POOL** becomes its own progress bar, with **STOP** beside it. It
says each walk as it comes back, and what came of it: **WALK 3 OF 10**
*joined the pool*, *rated below the pool*, *already in the pool*, *came back
unchanged*, or *couldn’t start*. The job slot in the menu bar counts the
walks with the time left (*⚡ breeding 3/10 · about 40 s*), at every level.
**GENERATIONS**, at the top of EVOLVE beside its name, counts the generation
once its first child lands. Hover **EVOLVE POOL** while it breeds and the bank marks this
generation’s seeds, and **WILL BE REPLACED** on the sounds its end will
replace so far; each child still to come can add one more, so save what you
want to keep.

Each child appears the moment it’s bred, at the top of the bank under **NEW ·
GENERATION 1**, tagged **NEW** with a green dot until you hear it, and can be
played at once. The line under its name says which seed it grew from and what
changed. The ranked rows below it don’t move. Where the seed’s row is in view,
the child buds out of it, its seed’s rail lit, and moves up into its place in
New. A child the pool won’t take buds beside its seed with the reason
(*rated below the pool*) and fades: the engine dropped it. With your system
set to reduce motion nothing moves, and the button, the row, and the line
under New say the same.

When the generation ends, its toast says what joined and what was replaced,
and **REPLACED · GENERATION 1** at the foot of the pool lists the replaced
sounds by name. [The bank](../bank.md#which-sounds-a-generation-breeds-from-and-replaces)
has the marks, and [Compare](../bank.md#compare-a-sound-beside-its-seed) shows
a child beside its seed.

A generation takes from under a minute to a few, depending on how many cores
your machine has to spare. On a busy four-core machine it takes about two to
three and a half minutes. While the sound is running short on a slower
computer ([Blend, Peek, and B](perform.md#blend-peek-and-b)), the walks not
yet under way wait while notes sound, and go on a second after the last one.
The instrument goes on answering while it breeds. A pick deals its next pair
at once, a ▶ plays, a sound opens, and PERFORM measures and grows offers.

**STOP** ends the generation with the children bred so far. Then, as at any
generation’s end, the pool goes back to its size.

```admonish info collapsible=true title="How it works: what a generation does"
The model takes the ten sounds in the pool it rates highest, and walks a short
way from each. A walk is about 40 small changes to the seed’s knobs and
modules, each rendered, measured, and kept or refused by how the model rates
the result. There is no crossover: every child grows from one seed.

The walk leans toward what the model rates higher, but it sometimes steps
sideways or down so it doesn’t get stuck. So children resemble their seeds,
and a generation moves the pool rather than replacing it. The walks run side
by side on the render farm, as many at once as your machine has workers to
spare. The same seeds give the same children however many workers walk them.

A child joins the pool only if the model rates it above the sound it would
replace: the lowest-rated one it can, not saved, nor kept as new and still
waiting for its first pick
([the bank](../bank.md#a-sound-you-keep-as-new-is-safe-until-its-been-in-a-pick)).
When the generation ends, those sounds
are replaced to bring the pool back to its size, and the toast names them
(the first three, then *and N more*). A sound you save before then is never
among them, even while the generation is still running. A child bred early
can rank below one bred after it, and then it’s the one replaced.

A refit and ⚡ evolve from this wait for the generation: the refit so the
generation is judged by the model it started with, and ⚡ because the two take
turns. A pick you make meanwhile counts from the refit after it. The reference
has [the walk in full](../../reference/search/refinement.html).
```

### When a generation adds nothing

Before the model has been fitted there is nothing to breed toward, and the
toast says so: *Nothing to breed toward yet. Make a few picks first, then
evolve.*

A generation can also end with nothing new in the pool. Its toast says why,
from each walk’s own outcome:

- *Generation 4: every walk came back unchanged.*
- *Generation 4: 3 were bred, but none rated above the sounds they would
  replace.*
- a count of each, when the walks differ.

[Troubleshooting](../troubleshooting.md#evolution-does-nothing) says what to
do when it keeps happening.

```admonish info collapsible=true title="How it works: with no render farm"
With no render farm (a single-core machine, or `?farm=0` in the address), the
walks run in the engine itself, one after another. A generation then takes
about three and a half to four minutes on the same machine. A ▶, an open, or
a pick is answered between one walk and the next, so after a pick the next
pair can take up to about 20 seconds, and the cards say which seed they are
waiting on.
```

## What each generation did

**WHAT EACH GENERATION DID**, under EVOLVE POOL, opens **EVOLUTION · what
each generation did** over the foot of the cards (<kbd>Esc</kbd>, **×** or the
button again folds it). It lists the three most recent steps, newest first:

```text
gen 1 ⚡ bred from Soft Pad → Warm Drone 2 · release 398 ms → 759 ms, mod depth 25% → 4%,
      filter → delay, +1 more, +mix, +filter, −supersaw · liked −0.48 exploring
gen 0 ✎ your edit from Glass Rain → Glass Rain 2 · cutoff 1.78 kHz → 20 kHz · liked −0.31
```

- **The names** are the seed and the child it became, as the bank names them.
  A seed since replaced keeps the name it had.
- **The changes** show each knob before → after in its own units (ms, dB, Hz,
  %). A module that became another reads `filter → delay`, and one added or
  removed reads `+mix` or `−supersaw`.
- **liked** is how much more (or, below zero, less) the model guessed you’d
  like the child than its seed, when the step was made.
- **exploring** marks a bred step it rated lower: the walk stepping sideways or
  down. Your picks decide whether it was worth it.
- **✎ your edit** marks a sound you kept as new in PATCH. It records
  everything that made a sound, not only breeding.

The sparkline to the left has one point per step, oldest to newest: amber for
a bred step, green for your edit. Each point is the child as the model rated
it when the step was made. It’s a record of the steps, not a score of the
pool over time.

Before any step, it says so: *No generations yet. Make a few picks,
then press EVOLVE POOL, or ⚡ on a sound you like.* If generations have run
and none added a sound, it says that instead (*2 generations ran, and none
put a new sound in the pool.*).

## In ⌘K

At EVOLVE, [⌘K’s list](../levels.md#k-find-anything) starts with THIS LEVEL,
each with its key: *Play A* (<kbd>1</kbd>) and *Play B* (<kbd>2</kbd>), *Pick
A* (<kbd>←</kbd>) and *Pick B* (<kbd>→</kbd>) while a pair is dealt,
*Another pair* (<kbd>N</kbd>), *Evolve pool: breed a generation from the
seeds it marks*, and *What each generation did*.

## What to try next

1. Make picks until the line says *● it just learned*. Ten to fifteen is a
   good first batch.
2. Open [TASTE](./taste.md), and see whether a style has separated out.
3. Press **EVOLVE POOL**, and play the children.
4. When a child is one you’d reach for, open it in [PATCH](./play.md), lock
   what you like, and press [⚡ evolve from this](../rack.md#locks-and-evolving-from-here)
   for variations around it.
