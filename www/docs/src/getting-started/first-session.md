# Your first session

<p class="lede">This page takes you from the first sound to a generation bred
toward your taste, in about fifteen minutes. Each step is one thing to do, and
what you’ll see when you’ve done it.</p>

<!-- film:tour --><!-- /film:tour -->

[Open the instrument](../../play/). There is nothing to install, and
everything below happens in one browser tab. Your session is kept in this
browser as you play, and it’s there when you come back.

## 1. Let it listen

1. Open the instrument.
2. Wait for the boot card to fill.

The card reads *listening to 40 sounds: you start as soon as the first 8 land*.
Each of the 40 is drawn from the grammar, rendered on one five-second phrase,
checked, and measured. Once eight have landed the instrument opens, and the
rest arrive while you play.

```admonish info collapsible=true title="How it works: nothing plays unchecked"
Every sound is rendered and checked before it can reach your speakers. Its
samples must be finite, its peak under a ceiling, and it must be neither
silent nor mostly DC offset. Breeding does produce screaming resonance and
silent duds, and this check is why you never hear them.

A sound that fails is quarantined, and the search learns to avoid that
region. On a machine with cores to spare, the renders run side by side.
[The vetting gate](../../reference/audition/vetting.html) in the reference
has the thresholds.
```

## 2. Pick the three you’d reach for

The warm start opens over the instrument. It teaches the model 18 picks in
about thirty seconds, which is the difference between a model that has a
guess by the end of this session and one that doesn’t.

<figure>
<img src="../img/warm-start.webp" alt="The warm-start card: nine named presets in a three-by-three grid, each with a one-line description and a play button, and two buttons below." loading="lazy" width="760" height="464">
<figcaption><strong>The warm start.</strong> Nine presets, one per family
first. The screenshot predates the current wording: the card now reads PICK
THE THREE YOU’D REACH FOR.</figcaption>
</figure>

1. Press **▶** on a card to hear it. Press it again to stop.
2. Click the three you’d reach for. Pick on sound alone: there is no wrong
   answer.
3. Press **TEACH IT**.

The card is headed **PICK THE THREE YOU’D REACH FOR**, over nine presets drawn
one per family from the library, each with its [face](../faces.md), which
arrives once the bank has filled and the preset has been rendered. The button under them counts down as you
pick (**PICK ANY THREE**, **2 MORE**, **1 MORE**) and then reads **TEACH IT**.

When you press it, PERFORM opens on your first pick, and **TAUGHT** in the
menu bar reads 18. The toast says what happened: *Your three taught it 18
picks, so it starts out pointed at you. Your three are saved, and Glass Pad is
under your fingers.*

Your three are **saved**, so no generation will replace them. They take 3 of
your 10 save slots; release any of them from its row if you want the room.

```admonish info collapsible=true title="How it works: why three picks are worth 18"
Each of your three picks is recorded as a pick over each of the six you passed
over: three times six. These picks fade with time like any other, so the warm
start points the model at you without holding it there.
```

**SKIP** goes straight to the instrument. A few picks later it offers the warm
start once more, and you can run it again any time from **⋯** › *Re-run the
three-pick warm start*.

## 3. Pick between pairs

EVOLVE is where you teach the model most. It plays you two sounds, A and B,
on the same phrase, and you pick the one you’d reach for.

<figure>
<img src="../img/evolve.webp" alt="The EVOLVE view: two cards side by side, each with a name and a rendered waveform and three buttons below it, a teaching line above them, and a strip of recent generations below." loading="lazy" width="1440" height="900">
<figcaption><strong>EVOLVE.</strong> Two sounds and one question. The line
above them counts down to the next refit.</figcaption>
</figure>

1. Open **EVOLVE**.
2. Press <kbd>1</kbd> and <kbd>2</kbd> (or **▶ SAMPLE** on each card) to hear A
   and B.
3. Click a card’s body to play that sound live on the keys, if the phrase
   doesn’t tell you enough.
4. Press <kbd>←</kbd> or <kbd>→</kbd> (or **PICK A**, **PICK B**) for the one
   you’d reach for.
5. Press **ANOTHER PAIR** when a pair tells you nothing.

Ten or fifteen picks is a good first batch. If neither sound is one you’d
reach for, pick the nearer one: what the model learns from a pick is a
direction, and that’s still one. The model expects answers to waver, and
averages over them.

What you see:

- **The line above the cards.** Before your first pick it reads *Play both.
  Pick the one you’d reach for.* After that it counts down to the next redraw
  (*3 more picks and it redraws your taste map.*), and six pips fill as you go.
- **The forecast.** After each pick, the model says what it guessed before you
  picked: *it guessed this · 72% · fairly sure*, or *it guessed the other · 62%
  · leaning*. Its misses are how it learns.
- **The toast.** *Picked Glass Pad over Soft Wash.*, with **NOT WHAT I MEANT**
  for seven seconds. <kbd>⌘Z</kbd> (Ctrl Z) does the same.
- **The refit.** On the sixth pick the line reads *● learning from your last 6
  picks…*, and the **E** of the wordmark lights while the model fits. Then it
  reads *● it just learned: see what changed ▸*, and the link opens TASTE.

## 4. See what it learned

1. Open **TASTE**.
2. Open **STYLES**, and read each style’s name.
3. Open **TRUST**, and see how close it is to grading the model.

<figure>
<img src="../img/taste-map.webp" alt="The TASTE map: a dark field scattered with amber dots of varying size and glow, named style chips above it, and a legend below." loading="lazy" width="1440" height="900">
<figcaption><strong>MAP.</strong> Every sound you have heard, placed by sound
and structure. Brighter means it thinks you’d like it more; bigger means it’s
less sure.</figcaption>
</figure>

Early on the map is sparse, and the styles are a first guess. A style is
named for what it leans toward until you rename it, so a style called *analog
sustain* means the model has heard you leaning that way.

TRUST grades the model once it has made 20 guesses, one before each pick,
and until then it counts toward them (4 OF 20 GUESSES, **16 TO GO →**). Once
it has 20, it will likely say *not beating a coin flip yet*. That is the
honest answer this early, and [the TASTE guide](../views/taste.md#trust-is-its-confidence-honest)
says why a plain hit rate would have flattered it.

## 5. Breed a generation

1. Open **EVOLVE**.
2. Press **EVOLVE POOL**.
3. Play the new sounds as they land at the top of the bank.

The model takes the ten sounds it rates highest and walks a short way from
each, toward what it has learned. Hover **EVOLVE POOL** before you press it,
and the bank marks those ten **SEED**. **EVOLVE POOL** becomes its own
progress bar, saying each walk as it comes back (**WALK 3 OF 10** *joined the
pool*), with **STOP** beside it, and the job slot in the menu bar counts the
walks in every view. A generation takes from under a minute to a few,
depending on the machine, and the instrument keeps answering while it breeds.

Each child appears the moment it’s bred, at the top of the bank under **NEW ·
GENERATION 1**, tagged **NEW**, with the seed it grew from under its name. The
**EVOLUTION** strip under the cards says what each step changed:

```text
gen 1 ⚡ bred from Soft Pad → Warm Drone 2 · release 100 ms → 251 ms,
cutoff 1.78 kHz → 20 kHz, delay → chorus, +lfo · liked +0.62
```

*liked* is how much more the model guesses you’d like the child than its
seed. A step it rated lower is tagged *exploring*: the walk sometimes steps
sideways or down so it doesn’t get stuck, and your next picks say whether it
was worth it.

```admonish info collapsible=true title="How it works: what a generation does"
There is no crossover: every child grows from one seed. Each walk is about 40
small changes to the seed’s knobs and modules, each one rendered, measured, and
kept or refused by how the model rates it.

A child joins the pool only if the model rates it above the sound it would
replace: the lowest-rated unsaved one. When the generation ends, those sounds
are replaced and the toast names them. [Refinement](../../reference/search/refinement.html)
in the reference has the walk in full.
```

Then go back to picking. The new sounds are in the pairs now, and every pick
still teaches the model and tests its forecast.

## 6. Keep what you’d reach for again

A bank row has two ways to keep a sound, and they do different jobs:

- **★** rates it. That teaches the model.
- **save** keeps it. The sound stays in **POOL**, is listed in **SAVED** too,
  and no generation will replace it. It teaches the model nothing.

[Stars are not saves](../bank.md#stars-are-not-saves) says when you want
which.

## What to try next

- Turn some knobs: [reading and editing the rack](../rack.md).
- Rewire it: [wiring and the module rail](../wiring.md).
- Play it: [playing it](../playing.md) and [PERFORM](../views/perform.md).
- Lock what you love and breed around it: [⚡ evolve from this](../rack.md#locks-and-evolving-from-here).
- See what the model learns from: [what the model learns from](../teaching.md).

Press <kbd>?</kbd> in the app at any point for the full key map.
