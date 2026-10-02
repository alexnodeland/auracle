# Glossary

<p class="lede">The words the app uses, in the sense it uses them. The
[reference](../reference/) defines the same things in full; this page is for
reading the app.</p>

### Bank

The rail on the left, with three tabs: **POOL** (the sounds the model weighs
and breeds from), **SAVED** (what you saved), and **PRESETS** (the hand-made
library). See [the bank](./bank.md).

### Brier skill

How much better than a coin flip the model’s guesses have been. 0 is a coin
flip, 1 is perfect, and below 0 is worse than guessing. The menu bar shows it
(*13% sharper than chance*), and so does
[TRUST](./views/taste.md#trust-is-its-confidence-honest).

### Budget

The ceilings breeding searches within: 24 modules, a depth of 6, and a
modulation depth of 3. PATCH shows a ceiling only when the patch is one short
of it or at it (*23/24 modules*). **⋯** › **Show measurements** shows all
three (*8/24 modules · 4/6 depth · 1/3 mod depth*). A patch at a ceiling has
no room to grow.

### Card

The picture of a sound you download to share it: its face, its name and
where it came from, with the patch inside. See
[sharing a sound as a card](./faces.md#share-a-sound-as-a-card).

### Child, NEW

A sound a generation bred. The children of the latest generation lead the
**POOL** tab under **NEW · GENERATION 3**, each tagged **NEW**, with a green
dot until you hear it. Under a child’s name, the bank says which seed it grew
from and what changed; click that line to compare the two.

### Control

One of PERFORM’s round controls: the named controls on your panel (the six
to start, up to eight), **BLEND**, and **WANDER**.

### EVOLUTION strip

The strip under EVOLVE’s cards: what each generation did, step by step. Each
step names the seed and the child, what changed, and how much more the model
guessed you’d like the child than its seed (*liked +0.06*). See [the EVOLUTION
strip](./views/evolve.md#the-evolution-strip).

### Face

A sound’s drawn shape, beside its name everywhere: its spectrum from its own
render, low at the base, wide where it has more than the bank’s sounds and
narrow where it has less. See [a sound’s face](./faces.md).

### Fair-test picks

The pairs dealt at random, which is every pair EVOLVE and PATCH deal you; the
line beside **ANOTHER PAIR** says so (*◇ random pair · a fair test*). TRUST
grades the model on them apart, as *the number to trust*, because you didn’t
choose them.

### Generation

One round of breeding. **EVOLVE POOL** walks a short way from each of the ten
sounds the model rates highest, and adds each child that rates above the sound
it would replace. When the generation ends (or you stop it), the lowest-rated
unsaved sounds are replaced, and the toast names them. There is no crossover:
every child grows from one seed.

**⚡ evolve from this** is one walk from the sound you’re playing, and counts
as a generation of its own.

### Guess

The model’s guess about a sound: roughly how likely you are to pick it in a
pair. It is always a percentage and a word, from one scale: *a hunch*
(46–54%), *leaning* (55–69%, or 31–45%), or *fairly sure* (70% and over, or 30%
and under), as in *59% · leaning*. A bank row draws it as a bar, with a block
around the guess for how unsure it is, and PATCH shows it above the rack with
the qualities that count most.

### Job slot

The place in the menu bar where long work shows while it runs: a generation
(*⚡ breeding 3/10 · about 40 s*), ⚡ evolve from this, or a refit. It has
**STOP** where the job can be stopped. The **E** of the wordmark is lit
exactly while it shows.

### Keep as new

PATCH’s way to keep an edit: it joins the pool as a new sound, and the
original stays as it was. It asks first, **WHICH WOULD YOU REACH FOR?**, and
your answer teaches the model. **PICK THE EDIT** skips the question once.

### Leans

PATCH’s toggle that tints each module by which way your taste leans on its
kind: amber toward, red away.

### Lock

Holding a knob, a module, or the whole wiring, so breeding can’t touch it. A
locked place in the patch can’t be changed, deleted, or created.

### LUFS

The loudness unit every sound is normalized to (−18 LUFS). A louder sound
reliably wins a comparison, so without it the model would learn “I like loud”
and pass it off as a taste in timbre.

### Measurements (φ)

The 44 numbers the model hears each sound through: 18 of the standard render’s
sound, and 26 counts of how the patch is built. **If a taste of yours doesn’t
show in these, it can’t be learned.**

### Module, module rail

A module is one part of a patch: a VCO, a filter, a reverb. The module rail,
headed **MODULES**, is the list on PATCH’s right that you add them from. See
[wiring and the module rail](./wiring.md).

### Named control

One of PERFORM’s controls named for what you hear: **BRIGHT**, **SNAP**,
**MOTION**, **BODY**, **GRIT**, and **SPACE** to start, and any of the twelve
more in [the palette](./views/perform.md#the-palette). Each has the same name
and the same two end words on every sound. What it turns is measured for each sound: up
to four of that patch’s knobs, the ones that move the sound most purely that
way. Until it’s measured, it reads *listening…* and does nothing.

See [the named controls](./views/perform.md#the-named-controls).

### Offer, B

A variant grown from the sound you’re playing, held in a second set of voices
called **B** that plays every note you play. You hear it with **BLEND** or
**PEEK**, at matched loudness, and it becomes your sound only if you press
**TAKE**. An offer may add or change a module; Wander never does. See [Blend,
Peek, and the B slot](./views/perform.md#blend-peek-and-the-b-slot).

### Palette, panel

PERFORM’s **palette** is the eighteen controls the instrument can measure, in
six families. Your **panel** is the ones you place on PERFORM, up to eight, in
your order; **ARRANGE** places, hides, and orders them. See [the
palette](./views/perform.md#the-palette).

### Pair

The two sounds you pick between, A and B. EVOLVE deals them, and so does the
TEACH strip in PATCH. **ANOTHER PAIR** deals a new one without picking.

### Patch, sound, preset

A **sound** is what you hear, pick, save, and breed. A **patch** is how it’s
built: its modules, knobs, and cables. A **preset** is a sound from the
library, made by hand. Open a sound in PATCH to see its patch.

### Phrase, sample

The standard five seconds every sound is heard on: the same notes for every
sound, so sounds can be compared. **▶ SAMPLE** plays it. It is a measuring
instrument, not a demo: play the sound from the keybed to judge it.

### Pick

Any choice between two sounds: an EVOLVE pair, a PERFORM take or pass, the
warm start, or keep as new. **TAUGHT** counts picks, stars, and cuts.

### Pickup

Soft takeover for a MIDI knob: it does nothing until it passes through the
control’s current position, and then follows your hand. See [soft
takeover](./keyboard.md#soft-takeover).

### Pool

The **POOL** tab: the 40 sounds the model weighs and breeds from. The engine’s
own default is 48; the app asks for 40.

### Quarantine

What happens to a sound that fails its check: it is never played or shown, and
the search learns to avoid where it came from.

### Rating…

What the guess above the rack in PATCH ends with while the model rates an
edited sound again.

### Refit

The model fitting again from everything you have taught it: a few seconds of
work, off the audio thread, every sixth pick. Between refits each answer is
folded in at once. The **E** of the wordmark lights while a refit runs, and
EVOLVE’s line says *● learning from your last 6 picks…* until it lands, then
*● it just learned*.

### Replaced

What happens to the pool’s lowest-rated unsaved sounds when a generation ends,
or when a preset joins the pool. The toast names them, and **REPLACED ·
GENERATION 3** at the foot of the pool lists what the latest generation
replaced. Only their names are kept.

### Search control

A named control drawn in amber with a dashed ring: this patch’s knobs can’t
make the change it names. Turn it past the notch and let go. Either the patch
gets something to turn (a tone EQ for BRIGHT and BODY, a longer release for
SPACE turned up), or an offer grows in B, aimed the way you turned it. See
[search controls](./views/perform.md#amber-dashed-search-controls).

### Seed

The sound a child grew from. A generation breeds from the ten the model
rates highest; hover **EVOLVE POOL** and the bank marks them **SEED**. (A
random number generator’s seed is always called a random seed.)

### Set aside

The strip under the rack, labeled **SET ASIDE**. Anything you unplug, delete,
or bypass goes there instead of vanishing, and stays across a reload.

### Stage mode

<kbd>⇧F</kbd> in PERFORM: the sound you’re playing on the whole screen,
drawn from what you hear. See [stage mode](./views/perform.md#stage-mode).

### Standardizer

The scaling that puts the 44 measurements on a common footing. It is saved
with your taste, always, because what the model learned means nothing
without it.

### Style

One side of your taste, named for what it leans toward (*analog sustain*)
until you name it. A sound is rated by the style that likes it most, which is
how you can like several unrelated kinds of sound at once. Up to five; a style
claiming almost none of the pool is idle.

### TAUGHT

The counter in the menu bar: everything the model learned from. Its tooltip
splits it (*52 picks · 4 stars · 2 cuts*).

### Vetting

The check every sound passes before it can be heard or measured: finite
samples, a peak under a ceiling, not silent, and not mostly DC offset. Breeding
does produce screaming resonance and silent duds; this is why you never hear
them.

### Wander

PERFORM’s dial for how alive the sound is on its own: *still*, *ideas*
(variants appear in B), *drift* (the knobs glide through nearby settings), and
*roam* (bigger and faster). It never changes the patch’s structure, it pauses
while your hands are on the other controls, and a tap freezes it. See
[Wander](./views/perform.md#wander).

### Warm start

Picking three of nine presets on a first visit, under **PICK THE THREE YOU’D
REACH FOR**. It teaches the model 18 picks in half a minute, and your three are
saved. Run it again from **⋯** › *Re-run the three-pick warm start*.

### Your taste, the model

Your taste is what the model has learned; the model is what learns it. It
guesses how much you’d like any sound, including ones it has never played you,
and how sure it is of each guess. The reference has [what the model
holds](../reference/taste/posterior.html) in full.
