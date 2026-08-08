# What the audition cannot hear

<p class="lede">One assumption runs through every page of this book: that
preference measured under a fixed gesture is the same thing as musical taste.
This page is where that assumption is examined and found to be doing more work
than it can carry.</p>

The argument is not new here. It is already in this book, made once, in the
page that replaced the v1 phrase with the v2 one:

> So the grammar could express patches the audition could never reveal, and the
> taste model was being asked to learn preferences over evidence that was not
> in $\varphi$. No amount of model improvement fixes that; it is a
> **measurement problem**.
>
> — [The standard phrase](../audition/phrase.md#why-each-segment)

That reasoning was applied to four holes — slow pads, sub-Hz modulation,
anything above Eb4, polyphonic stacking — and each was closed with the cheapest
segment that revealed it. Then it stopped. Everything below is the same
sentence, still true, about the things the v2 phrase did not reach.

## Why this is a separate register

[Unraised directions](./directions.md) holds possibilities the design never
considered. This page holds something different and less comfortable: **one
premise the design commits to everywhere**, and the eight places that commitment
costs something. An entry there is an opportunity; an entry here is a limit on
what any amount of modelling can currently buy.

| # | What cannot be heard | Costs |
|---|---|---|
| [1](#1-a-patch-is-a-function-from-performance-to-sound-and-it-is-sampled-once) | How a patch responds to *playing* — velocity above all | The object being modelled |
| [2](#2-modulation-is-the-distinctive-claim-and-its-rate-is-not-measured) | Modulation **rate** and shape | The instrument's best feature, unrewardable |
| [3](#3-loudness-is-normalized-away-and-the-raw-level-is-already-computed) | How loud a patch natively is | A whole axis of ordinary preference |
| [4](#4-everything-is-judged-in-a-silent-room) | How a patch sits against other material | Why isolated judgements mislead |
| [5](#5-there-is-no-tempo-and-the-presets-are-working-around-it-by-hand) | Anything tempo-relative | The difference between a sound and a part |
| [6](#6-the-loop-is-selection-sound-design-is-pursuit) | What the player is *looking for* | Converges on the average of a taste |
| [7](#7-comparability-constrains-the-measurement-not-the-listener) | — a conflation rather than a gap | A free elicitation improvement, unclaimed |
| [8](#8-forty-addresses-and-no-macros-when-the-macro-axis-is-already-fitted) | — an asset already fitted, unexposed | A control only this project could offer |

Seven and eight are not limits of the audition; they are places where the same
premise has quietly shaped the *product* rather than the measurement. They are
here because they come from the same root.

---

## 1. A patch is a function from performance to sound, and it is sampled once

`NoteSpan` — the whole of what the renderer knows about a note — is:

```rust
pub struct NoteSpan {
    pub voct: f64,      // pitch, V/Oct from C4
    pub chord: usize,   // additional gate-synced voices
    pub on_start: usize,
    pub on_end: usize,
}
```

There is **no velocity field**, anywhere in the render path. Every audition note
is struck identically.

Three feet away in the same repository, the live instrument takes MIDI
**velocity**, pitch bend and sustain, and the guide documents playing it that
way. So the instrument responds to a dimension the measurement holds constant.

The consequence is not a missing coordinate; it is a category error about what
a candidate *is*. A patch is a function from performance to sound. $\varphi$
evaluates that function at a single point and hands the result to a model that
then speaks about patches. Everything downstream — $\theta$, the style lenses,
the [map](../../docs/views/taste.html#map), the calibration diagram — is a
faithful model of *preference over point samples of instruments*, presented as
a model of preference over instruments.

What is invisible as a result, in rough order of how much a player would care:

- **Velocity response.** The single largest determinant of whether a patch is
  playable at all.
- **Note-length behaviour.** Whether it blooms, or just holds.
- **Retrigger under fast playing.** Whether the envelope survives a run.
- **Key tracking**, beyond the one octave-up check `high_ratio` performs.
- **The arpeggiator.** It ships in the instrument and appears in no audition.

**This is the one thing on this page that cannot be fixed inside $\varphi$.**
Every other entry is a coordinate or a surface; this is a change to what is
being measured. The in-idiom version is exactly the move the v2 phrase already
made: a second render at a different velocity and articulation, contributing
**difference** coordinates — $\Delta$brightness per velocity, $\Delta$level per
octave — rather than more absolute ones. Two renders instead of one is the same
cost-for-coverage trade the v2 phrase paid knowingly, and the
[segment-local coordinates](../features/audio.md#segment-local-coordinates)
are the precedent for measuring a *contrast* rather than a level.

## 2. Modulation is the distinctive claim, and its rate is not measured

The instrument's distinguishing feature is that modulation is a whole chain: an
`s&h rand → quantize → slew` can reach a cutoff, the node bank exists to
explain where a modulator may legally go, and nearly every module carries a mod
slot.

Here is everything $\varphi$ records about that:

| Coordinate | Says |
|---|---|
| `mod_density` (struct) | how *much* of the term is modulated |
| `mod_depth_mean` (struct) | how *deep* the modulation is |
| `centroid_std` (audio) | how much brightness moved over the phrase |
| `held_centroid_std` (audio) | how much it moved within one held note |

**Rate appears nowhere. Shape appears nowhere.** A 0.3 Hz filter sweep and a
7 Hz tremolo at equal depth land on near-identical coordinates. A random
sample-and-hold and a sine LFO are indistinguishable to every one of them.

So *"I like slow evolving movement and dislike fast wobble"* is not a
preference that is hard to learn. It is **inexpressible** — in exactly the
sense [the log-axis argument](../features/audio.md#frequency-features-are-logarithmic-not-linear-in-hz)
uses about brightness on a linear-Hz axis, and for the same reason: the model is
linear in $\varphi$, so a distinction absent from the coordinates is absent from
the hypothesis space.

The second-order consequence is worse than the first. Proposal tilts read the
[structural coefficients](../search/proposals.md#structural-taste-specifically),
and `mod_density` is one of them — so the search **can** learn *more
modulation* and can **never** learn *slower modulation*. The instrument's most
distinctive capability is the one the search cannot be rewarded for using well.

**The measurement already has its window open.** The held note exists, in the
words of its own page, to reveal "sub-Hz modulation over a register-constant
sustain". The segment was built for this and then not measured for it. An
autocorrelation of the centroid or RMS envelope across that span yields two
coordinates:

- **dominant modulation rate**, on the shared octave axis every other frequency
  in $\varphi$ already uses, and
- **periodicity strength** — how much of the movement is periodic at all, which
  is what separates an LFO from a random walk.

If two numbers could be added to $\varphi$, these are the two.

## 3. Loudness is normalized away, and the raw level is already computed

[Normalizing every render to −18 LUFS](../audition/loudness.md) is correct, and
the reason given is the right one: loudness bias would poison the preference
data.

The other half of that trade is not stated anywhere. **Loudness is part of a
sound's identity.** *Hits hard*, *sits back*, *has weight* are ordinary,
strongly-held preferences, and they have been normalized out of existence by
design. `crest` and `rms_std` recover dynamics *within* a patch; absolute level
is gone.

What makes this an easy win rather than a lament is that the number already
exists. [`VetReport`](../audition/vetting.md#what-it-measures) measures `peak`
and `rms` on the **raw, pre-normalization** render — deliberately, because the
gate's thresholds are about real output level — and both are then discarded.
The quantity *how loud is this patch natively* is computed on every candidate
this project has ever rendered.

Adding $\log(\text{raw rms})$ as a coordinate reintroduces **no** playback bias,
because playback stays normalized; the confound the loudness decision guards
against is between *what the listener hears* and *what they are comparing*, and
a feature the model reads is neither. It simply lets the model see an axis that
is currently invisible.

**The honest caveat**, which decides it: raw level is partly an artifact of gain
staging inside the grammar rather than a property anyone hears. That makes it
possibly noise — and it makes the question a single sweep on existing data
rather than an argument.

## 4. Everything is judged in a silent room

No mix context, no drums, no key, no other material. Every duel asks *which of
these two do you prefer*, in silence.

Musicians almost never choose sounds absolutely. The bass that wins in
isolation is routinely the one that disappears under a kick; the pad that wins
alone is the one that eats the vocal. $\varphi$ carries `bass_fraction` and
three brightness measures, but nothing about **spectral occupancy relative to
other material**, because there is no other material for it to be relative to.

This is probably the deepest reason isolated-audition tools feel wrong to
practitioners in a way that is hard to articulate, and it bites harder here than
elsewhere: the premise of this project is that the instrument is learning what
you like, and what it is learning is what you like *in an empty room*.

The scope that would test it is not "build a DAW". One user-supplied backing
loop, played underneath the audition, changes what every vote means — and it
interacts directly with [§3](#3-loudness-is-normalized-away-and-the-raw-level-is-already-computed),
because level against a bed is exactly the judgement normalization removes.

## 5. There is no tempo, and the presets are working around it by hand

An LFO's rate is sampled as `u01()` and mapped to Hz. There is no global tempo,
no host sync and no note divisions. A `Clock` tempo exists for the euclidean
sequencer's own `bpm` port, and it is not a session-level musical clock.

The evidence that this costs something is in this repository's own preset
source, in comments:

```rust
rate: 0.55, // ≈83 bpm
rate: 0.62, // ≈107 bpm
p0: 0.55,   // ≈83 bpm — about one jump per bar
```

Preset authors are hand-computing, in comments, the thing a sync control would
compute. An unsynced modulator is among the most common reasons a good patch is
unusable in a track: it can be set close by ear and it drifts over sixteen bars.

For an instrument whose output is meant to end up in music, tempo-relative rates
are not a convenience. They are the difference between a **sound** and a
**part** — and they would also give [§2](#2-modulation-is-the-distinctive-claim-and-its-rate-is-not-measured)
a natural axis to express rate *on*, since a listener's preference about
movement is far more plausibly "a cycle per bar" than "0.34 Hz".

## 6. The loop is selection; sound design is pursuit

A duel asks *which do you prefer*. A player with a sound in their head wants
*get closer to this*.

Locks plus `⚡ evolve from this` is a genuine pursuit affordance and a good one.
But the primary loop is judging what you are handed, and the
[target-directed](./directions.md#2-target-directed-search-make-it-sound-like-this)
entry in the other register is better understood from here: it is not a feature,
it is the missing half of a workflow.

There is a sharper form of this, and it is about what the model *converges to*.
A preference fitted over everything a person has ever voted on approaches the
**average** of their taste. [Max-of-experts](../taste/utility.md#why-a-maximum)
answers part of it — islands rather than a centroid, which is the whole reason
for the max — but the islands are **discovered from $\varphi$**, not selected by
intent. So on any given evening the instrument proposes toward the union of
everything the listener has ever liked, when what they need is the one corner
they are working in tonight.

That is the musical argument for
[declared context](./directions.md#3-declared-context-and-the-circularity-it-dissolves),
and it is a stronger one than the modelling argument on that page. It is the
difference between a tool that knows *you* and a tool that is useful *today*.

## 7. Comparability constrains the measurement, not the listener

The [decisions log](./decisions.md) records the audition as *"Standard 5.05 s
phrase + free-play"*, with the rationale *"feature comparability requires fixed
stimulus"*.

The rationale is true of $\varphi$. It is **not** true of the person.

$\varphi$ comes from a deterministic offline render. What a human hears while
deciding is an independent choice, and could be anything at all — including
their own playing, on both patches, with the same lick. The coordinates would
remain exactly as comparable, because nothing about them depends on what came
out of the speakers during the vote.

So *duel in your own hands* costs $\varphi$ nothing. It is a far more musical
elicitation than voting on four notes chosen by the instrument, and it is the
direct remedy for [§1](#1-a-patch-is-a-function-from-performance-to-sound-and-it-is-sampled-once):
a player testing velocity response themselves is measuring the dimension the
phrase holds constant, even if the coordinates still cannot see it.

**The cost, stated rather than hidden.** The vote becomes a judgement about an
experience the coordinates only partly describe. That adds noise, and adds bias
if a player's own gestures systematically emphasize something the phrase does
not. But it is noise in the measurement of something a listener cares about,
against precision about something they do not — and the project already owns the
instrument that would detect it, since
[calibration by provenance](../taste/calibration.md#by-provenance) exists
precisely to score differently-collected answers against each other rather than
assume they are equivalent. A `PlayedDuel` provenance would make this
measurable on arrival.

## 8. Forty addresses and no macros, when the macro axis is already fitted

The rack exposes every trace address, and the word *macro* does not appear in
the web app. A player performing wants two to four hands-on controls, not one
per address in the term.

The interesting part is that **the fitted model already contains the right
axes**. A style lens $\theta_k$ is a direction in feature space whose meaning is
*what this listener cares about*. A macro that moves a patch along the model's
top learned direction is a control that is personal by construction — bite for
one user, movement for another — and nothing else can offer it, because nothing
else has fitted the model.

It is also the continuous form of the
[counterfactual explainer](./directions.md#7-explanation-stops-at-the-coefficients):
same posterior, same trace addresses, same predicted-gain arithmetic. One
reports a discrete edit; the other puts the direction under a finger.

---

## If these were ordered by value per unit of work

1. **Two coordinates for modulation rate and periodicity**
   ([§2](#2-modulation-is-the-distinctive-claim-and-its-rate-is-not-measured)).
   Cheapest and highest value: it lets the search be rewarded for the
   instrument's best feature, and the segment it needs already exists for this
   exact purpose.
2. **`log(raw rms)` as a coordinate**
   ([§3](#3-loudness-is-normalized-away-and-the-raw-level-is-already-computed)).
   Already measured on every candidate, currently discarded; recovers an axis
   of ordinary preference at zero audition cost.
3. **Velocity in the phrase, as difference coordinates**
   ([§1](#1-a-patch-is-a-function-from-performance-to-sound-and-it-is-sampled-once)).
   The expensive one, and the only one that moves the modelled object from *a
   sound* toward *an instrument*.
4. **Tempo-relative modulation rates**
   ([§5](#5-there-is-no-tempo-and-the-presets-are-working-around-it-by-hand)).
   Turns output into something usable in a track, and gives §2 its natural
   axis.
5. **Declared context**
   ([§6](#6-the-loop-is-selection-sound-design-is-pursuit)), promoted from the
   other register on musical grounds.
6. **Duels in the player's own hands**
   ([§7](#7-comparability-constrains-the-measurement-not-the-listener)).
   Nearly free, conceptually the largest unlock, and measurable via provenance
   from the day it ships.

## The summary worth keeping

This is an unusually rigorous instrument for measuring **timbre preference
under a fixed gesture**, and much of the design reads as though that were the
same thing as **musical taste**. It is not, and the gap between them is where
every entry above lives.

The tool for closing it is already in the book. *The grammar can express what
the audition cannot reveal, and no amount of model improvement fixes a
measurement problem* — applied once, to four holes, and it deserves to be
applied to the rest.
