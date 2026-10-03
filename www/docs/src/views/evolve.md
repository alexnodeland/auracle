# EVOLVE: breeding sounds you’d reach for

<p class="lede">EVOLVE is where you teach the model and breed from what it
learned. It plays you two sounds, you pick the one you’d reach for, and
EVOLVE POOL grows new sounds toward your picks.</p>

<!-- film:view-evolve --><!-- /film:view-evolve -->

<figure>
<img src="../img/evolve.webp" alt="Two cards side by side with rendered waveforms and three buttons each, a teaching line above them, and a log of recent generations below." loading="eager" width="1440" height="900">
<figcaption><strong>EVOLVE.</strong> Two sounds and one question. The line
above them counts down to the next refit; the strip below says what the last
generation changed.</figcaption>
</figure>

## Pick between two sounds

1. Press <kbd>1</kbd> and <kbd>2</kbd> (or **▶ SAMPLE** on each card) to hear
   A and B. Press again to stop.
2. Click a card’s body to play that sound live on the keys, when the phrase
   doesn’t tell two sounds apart.
3. Press <kbd>←</kbd> or <kbd>→</kbd> (or **PICK A**, **PICK B**) for the one
   you’d reach for.
4. Press **ANOTHER PAIR** to deal a new pair without picking. It records
   nothing.

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

**The cards.** Each card is one sound: its [face](../faces.md) and its
name, the style that rates it highest, its waveform, and **▶ SAMPLE**, **OPEN IN PATCH**, and **PICK A** (or
**PICK B**). The names come from what the sound is, so *Round Wash* and
*Gritty Swell* mean something. **⇄ CIRCUIT** flips the waveform to the patch’s
modules. **OPEN IN PATCH** opens the sound in [PATCH](./play.md) without
picking.

**The teaching line.** Above the cards, six pips count down to the next
refit, and the line says how far it is:

- *Play both. Pick the one you’d reach for.* before your first pick;
- *3 more picks and it redraws your taste map.* on the way;
- *● learning from your last 6 picks…* while the refit runs;
- *● it just learned: see what changed ▸* when it lands. The link opens the
  [TASTE](./taste.md) map, and the line says so until your next pick.

During a generation or a ⚡ walk the line reads *● it will learn from these 6
when breeding finishes* instead, because a refit waits for them.

**The forecast.** After each pick, the line above **ANOTHER PAIR** says what
the model guessed before you picked, and how sure it was: *it guessed this ·
72% · fairly sure*, or *it guessed the other · 62% · leaning*. The words come
from one scale: *a hunch*, *leaning*, and *fairly sure*.

**How the pair was dealt.** Beside **ANOTHER PAIR**, *◇ random pair · a fair
test* says that every pair is dealt at random from the pool. The model
doesn’t choose what you hear, so every pick is a fair test of its guess.
[its forecasts in LEARNING](./learning.md#its-forecasts) are graded on them all.

**EVOLVE POOL**, at the right. It’s the next section.

```admonish info collapsible=true title="How it works: the next pair is already waiting"
While a pair is on the table, the engine deals the one after it and renders
both its sounds, so a pick or **ANOTHER PAIR** puts it up at once. The pair
after that is dealt behind it. Pairs go up in the order they were dealt, so a
seeded session shows the same pairs in the same order however long each deal
took.

The next pair is chosen before your pick is known. That changes nothing,
because pairs are dealt at random and your pick is held for its seven seconds
anyway. A sound you cut meanwhile is never put up: that pair is dropped and
dealt again, and so is one that lost a sound to a generation.

Those renders wait behind what you ask for: a sound you open, a ▶ you press,
and PERFORM’s offers and first measurements. When no pair is waiting (right
after a cut, say), the cards dim until the next is dealt. A deal that takes
longer says why on the cards, for example *dealing: the engine is breeding
(seed 4/10)*.
```

```admonish info collapsible=true title="How it works: between refits"
Your picks count before the refit, too. Each one is folded into the model
at once by reweighting the guesses it already holds, so its next forecast
answers your last pick. The refit is the full version: inference over every
pick so far, a few seconds of work off the audio thread.

While a refit runs, the job slot in the menu bar says *refitting your taste
map…*, and the **E** of the wordmark is lit. The reference has [the fit and the
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
walks with the time left (*⚡ breeding 3/10 · about 40 s*), in every view.
**GENERATIONS** in the menu bar counts the generation once its first child
lands. Hover **EVOLVE POOL** while it breeds and the bank marks this
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
three and a half minutes. The instrument goes on answering while it breeds. A
pick deals its next pair at once, a ▶ plays, a sound opens, and PERFORM
measures and grows offers.

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
replace: the lowest-rated unsaved one, passing over a sound you kept as new
that hasn’t been in a pick yet
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

## The EVOLUTION strip

Under the cards, **EVOLUTION · what each generation did** lists the three most
recent steps, newest first:

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
- **✎ your edit** marks a sound you kept as new in PATCH. The strip records
  everything that made a sound, not only breeding.

The sparkline to the left has one point per step, oldest to newest: amber for
a bred step, green for your edit. Each point is the child as the model rated
it when the step was made. It’s a record of the steps, not a score of the
pool over time.

Before any step, the strip says so: *No generations yet. Make a few picks,
then press EVOLVE POOL, or ⚡ on a sound you like.* If generations have run
and none added a sound, it says that instead (*2 generations ran, and none
put a new sound in the pool.*).

## What to try next

1. Make picks until the line says *● it just learned*. Ten to fifteen is a
   good first batch.
2. Open [TASTE](./taste.md), and see whether a style has separated out.
3. Press **EVOLVE POOL**, and play the children.
4. When a child is one you’d reach for, open it in [PATCH](./play.md), lock
   what you like, and press [⚡ evolve from this](../rack.md#locks-and-evolving-from-here)
   for variations around it.
