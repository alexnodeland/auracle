# Glossary

Terms the interface uses, in the sense it uses them. The
[Reference](../reference/) defines the same things formally; this page is for
reading the app.

### Audition

Playing a candidate's **pre-rendered, loudness-normalized** buffer, rather than
the live patch. Everything you hear in a duel has already been through the
vetting gate, which is why an unvetted patch can never reach your speakers.

### Bank

One of three collections in the left rail: **pool** (the sounds the model
weighs and breeds from), **saved** (what you saved), **presets** (the built-in
library). See
[The patch bank](./bank.md).

### Belief row

The line under the toolbar in PATCH saying what the model thinks of the current
patch and which coordinates drove that. It reports a silence rather than a
number when it has no basis for one.

### Brier skill

How much better than a coin flip the model's duel forecasts have been. `0` is
chance, `1` is perfect and certain, negative is worse than guessing. Shown in
the menu bar and on [TRUST](./views/taste.md#trust--is-its-confidence-honest).

### Budget

The ceilings evolution searches inside: modules, tree depth, modulation depth.
PATCH shows a cell only when it is tight (one short of its ceiling) or full,
such as `23/24 modules`; **⋯ → Show measurements** shows all three
(`8/24 modules · 4/6 depth · 1/3 mod depth`). A patch at its ceilings has no
room to grow.

### Candidate

A patch in the evolution pool. Has a stable id, a rendered audition buffer, a
feature vector and a lineage.

### Check duel

A duel whose pair was drawn **at random** rather than chosen by the model.
Under the default pairing that is every duel EVOLVE deals, and the meter says
so of every pair: **◇ random pair · a fair test**. Under the
information-seeking pairing it is about one duel in ten, each marked
**◇ fair test · dealt at random**. The app calls these **fair-test picks**. Calibration measured on these is the
number without an asterisk.

### Duel

Two candidates, pick one. The primary teaching signal.

### Feature vector (φ)

The forty-four numbers the model sees each patch through: eighteen perceptual
descriptors of the standard render, twenty-six structural counts of the term.
**If a preference is not visible in these, it cannot be learned.**

### Generation

One round of breeding. Takes the pool's best patches, walks each a short
distance uphill on the current model, and injects the children as they are
bred (a child joins only if the model rates it above the sound it would
replace); when it ends (or you stop it) the lowest-rated unsaved sounds are
replaced (the toast names them). The walks run in parallel on the render farm,
so the rest of the instrument keeps answering while it breeds.

### Genome / term

The patch's real representation: a **tree** in a typed grammar, not a parameter
list. The rack you see is compiled from it.

### Set aside

The staging tray under the rack, labelled **SET ASIDE**. Anything you unplug, delete or bypass goes
here rather than vanishing, and stays across a reload.

### Job slot

The place in the menu bar, beside **generations**, where long work shows while
it runs: a generation (*⚡ breeding 3/10 · about 40 s*), ⚡ evolve from this, a
refit. It has **stop** where the job can be stopped. The wordmark's **E** is lit
exactly while it shows.

### Lineage

The record of what produced a patch: which parent, which step, what changed,
and how much more the model expected you to like the child than its parent
(*liked +0.06*). Shown in the EVOLUTION strip, by name.

### Lock

Freezing a knob, a module or the whole structure so refinement cannot touch it.
A locked address cannot be changed, deleted **or created**.

### LUFS

The loudness unit every render is normalized to (−18 LUFS). Louder reliably
wins A/B tests, so without it the model would learn "I like loud" and present
it as a preference about timbre.

### Named control

One of PERFORM's six controls: **Bright, Snap, Motion, Body, Grit, Space**. Each
is a fixed direction in what the instrument can hear, with the same name and
the same two end words on every patch. What it turns is measured per patch: at
most four of that patch's knobs, chosen because they move the sound most purely
in that direction. Until it has been measured on a patch it reads *listening…*
and does nothing. See [PERFORM](./views/perform.md#the-named-controls).

### Offer / B slot

A variant grown from the sound you are playing, held in a second voice set
called **B** that plays every note you play. You hear it by crossfading with
**Blend** or holding **Peek**, at matched loudness, and it replaces your sound
only if you press **Take**. An offer from the **Offer** pad or Wander is grown
toward your taste; one a search control asks for is also aimed the way it was
turned. An offer may change structure. The only other
thing in PERFORM that can is a **search control** that grafts a tone EQ on (see
below); Wander never does. See [Blend, Peek and the B
slot](./views/perform.md#blend-peek-and-the-b-slot).

### Pickup

Soft takeover for a MIDI pot: it does nothing until it passes through the
control's current position, then follows your hand. It stops a pot left in one
place from snapping a control that Wander, the mouse or the keys have since
moved. See [soft takeover](./keyboard.md#soft-takeover).

### Pool

The bank's **pool** tab: 40 vetted sounds the model weighs and breeds
from. (The engine's own default is 48; the web app configures 40.)

### Posterior

The fitted model *with its uncertainty*: a distribution over possible tastes
rather than a single best guess. Everything the app shows about confidence
comes from its spread.

### Prediction

The percentage on a bank row: roughly how likely you are to pick this sound
in a pair. Wherever the app prints one as a guess it gives a word beside it,
from one scale: *a hunch* (46–54%), *leaning* (55–69% or 31–45%), *fairly
sure* (70% and over, or 30% and under), as in *59% · leaning*. A posterior mean, so the number alone averages the uncertainty away.
The bar under it shows the uncertainty: a tick at the mean inside a block one
standard deviation wide on each side. The map's dot sizes show it too.

### Quarantine

What happens to a candidate that fails vetting: never played, never shown, and
scored so badly that the search learns to avoid that region.

### Refit

Full inference over the whole observation log: seconds of work, off the audio
thread. Between refits, votes are folded in by the cheaper **reweighting**
path. The wordmark's **E** lights while a refit runs. The sixth pick's refit
goes out when that pick's seven-second undo window closes; the teaching meter
says *● learning from your last 6 picks…* until it lands, then *● it just
learned*.

### Sample

The standard five-second audition phrase, identical for every patch. Audio
measurements are only comparable under an identical stimulus, which is what
makes it fixed. It is a measuring instrument, not a demo. Play the patch from
the keyboard to judge it.

### Search control

A named control drawn in amber with a dashed ring: this patch's knobs cannot
honestly make the change it names (no drive to make it rougher, no reverb to
make it farther). It always springs back when let go. Turn it past the notch
(three tenths of the way to either end) and let go, and it does one of two
things. **Bright** and **Body** can be given something
to turn: a flat tone EQ grafted onto the patch. So can **Space** turned up: a
longer release. The graft
goes in as one undo step, the patch is measured again, and the control is set
where your hand left it (*Bright now turns …*). Otherwise, or when the graft
does not reach, the control springs back and asks for an offer in B, aimed the
way you turned it: the walk that grows it counts a variant for more the further
it goes that way, and B says how far it went (*grittier by 1.8σ*), or that it
did not get there. See
[search controls](./views/perform.md#amber-dashed-search-controls).

### Standardizer

The scaling that puts the forty-four raw feature values on a common footing. Saved
**with** the taste profile, always, because the model's coefficients are
meaningless without it.

### Style

One cluster of your taste: a direction in feature space that explains some of your
answers. A patch is scored by whichever style rates it highest, which is what lets
you prefer several unrelated kinds of sound at once. Up to five; a style
claiming almost none of the bank is idle. Named for what it leans on until you
name it, and worth naming.

### Taste model

The whole fitted object: styles, star cutpoints, session thresholds, and
their uncertainty.

### Trace address

The name of one site in the genome: `node/0#cut`, `amp#attack`,
`node/0/m#rate`. Panel knobs, hand edits, locks, live parameter handles and
search proposals all use the same scheme, so the rack and the genome cannot
drift apart.

### Utility

The latent quantity everything conditions: how much the model thinks you would
like a patch. It is a function it infers rather than a score stored per patch,
which is why it can rank a patch it has never shown you.

### Vetting

The gate every render passes before it can be heard or measured: all-finite,
under a peak ceiling, not silent, not DC-dominated. Evolution does produce
screaming resonance and silent duds; this is why you never hear them.

### Wander

PERFORM's dial for how alive the patch is on its own: **still**, **ideas**
(variants appear in B), **drift** (the knobs glide through nearby settings the
search prefers), **roam** (bigger and faster). It answers a second and a half
after you let go of it in a new region, the line under it says what it is
doing and when it moves next, it never changes structure, it pauses while
your hands are on the other controls, and a tap holds it. See
[Wander](./views/perform.md#wander).

### Warm start

The three-of-nine preset pick on first run. Worth 18 pairwise observations for
about thirty seconds of work, which is how the model gets past a cold start
that otherwise takes hundreds of duels. Your three picks are saved. Re-run it
from **⋯** at any time.
