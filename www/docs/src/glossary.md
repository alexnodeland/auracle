# Glossary

Terms the interface uses, in the sense it uses them. The
[Reference](../reference/) defines the same things formally; this page is for
reading the app.

### Audition

Playing a candidate's **pre-rendered, loudness-normalized** buffer — not the live
patch. Everything you hear in a duel has already been through the vetting gate,
which is why an unvetted patch can never reach your speakers.

### Bank

One of three collections in the left rail: **evolution** (the live pool),
**my patches** (what you saved), **presets** (the built-in library). See
[The patch bank](./bank.md).

### Belief row

The line under the toolbar in PLAY saying what the model thinks of the current
patch and which coordinates drove that. It reports a silence rather than a number
when it has no basis for one.

### Brier skill

How much better than a coin flip the model's duel forecasts have been. `0` is
chance, `1` is perfect and certain, negative is worse than guessing. Shown in the
menu bar and on [TRUST](./views/taste.md#trust--is-its-confidence-honest).

### Budget

The ceilings evolution searches inside — modules, tree depth, modulation depth.
Shown in PLAY as `8/24 modules · 6/9 depth · 1/4 mod depth`. A patch at its
ceilings has no room to grow.

### Candidate

A patch in the evolution pool. Has a stable id, a rendered audition buffer, a
feature vector and a lineage.

### Check duel

A duel whose pair was drawn **at random** rather than chosen by the pairing rule.
Marked **◇ unbiased probe**. Calibration measured on these is the number without an
asterisk.

### Duel

Two candidates, pick one. The primary teaching signal.

### Feature vector (φ)

The forty numbers the model sees each patch through: fifteen perceptual
descriptors of the standard render, twenty-five structural counts of the term.
**If a preference is not visible in these, it cannot be learned.**

### Generation

One round of breeding. Takes the pool's best patches, walks each a short distance
uphill on the current model, and injects the children — evicting the weakest to
make room.

### Genome / term

The patch's real representation: a **tree** in a typed grammar, not a parameter
list. The rack you see is compiled from it.

### HELD

The staging tray under the rack. Anything you unplug, delete or bypass goes here
rather than vanishing, and stays across a reload.

### Lens

See **style**.

### Lineage

The record of what produced a patch — which parent, which step, what changed, and
how much the model's estimate moved. Shown in the EVOLUTION strip.

### Lock

Freezing a knob, a module or the whole structure so refinement cannot touch it.
Exact rather than best-effort: a locked address cannot be changed, deleted **or
created**.

### LUFS

The loudness unit every render is normalized to (−18 LUFS). Not a mastering
nicety — louder reliably wins A/B tests, so without it the model would learn "I
like loud" and present it as a preference about timbre.

### Pool

The evolution bank: 48 vetted candidates the model reasons over and breeds from.

### Posterior

The fitted model *with its uncertainty* — not a single best guess but a
distribution over possible tastes. Everything the app shows about confidence comes
from its spread.

### Prediction

The percentage on a bank row: roughly how likely you are to prefer this patch in a
duel. A posterior mean, so it averages the uncertainty away — for the uncertainty
itself, read the map's dot sizes.

### Quarantine

What happens to a candidate that fails vetting: never played, never shown, and
scored so badly that the search learns to avoid that region.

### Refit

Full inference over the whole observation log — seconds of work, off the audio
thread. Between refits, votes are folded in by the cheaper **reweighting** path.
The wordmark's **E** lights while a refit runs.

### Sample

The standard five-second audition phrase, identical for every patch. Audio
measurements are only comparable under an identical stimulus, which is what makes
it fixed. It is a measuring instrument, not a demo — play the patch from the
keyboard to actually judge it.

### Standardizer

The scaling that puts the forty raw feature values on a common footing. Saved
**with** the taste profile, always, because the model's coefficients are
meaningless without it.

### Style

One lens of your taste — a direction in feature space that explains some of your
answers. A patch is scored by whichever lens likes it most, which is what lets you
prefer several unrelated kinds of sound at once. Up to five; a lens claiming almost
none of the bank is idle. Nameable, and worth naming.

### Taste model

The whole fitted object: style lenses, star cutpoints, session thresholds, and
their uncertainty.

### Trace address

The name of one site in the genome — `node/0#cut`, `amp#attack`,
`node/0/m#rate`. This is the spine of the instrument: panel knobs, hand edits,
locks, live parameter handles and search proposals all use the same address
scheme, which is what stops the rack and the genome from ever drifting apart.

### Utility

The latent quantity everything conditions: how much the model thinks you would
like a patch. Not a score it stores per patch — a function it infers, which is why
it can rank a patch it has never shown you.

### Vetting

The gate every render passes before it can be heard or measured: all-finite, under
a peak ceiling, not silent, not DC-dominated. Evolution genuinely produces
screaming resonance and silent duds; this is why you never hear them.

### Warm start

The three-of-nine preset pick on first run. Worth 18 pairwise observations for
about thirty seconds of work, which is how the model gets past a cold start the
project's own tests measure in the hundreds of duels.
