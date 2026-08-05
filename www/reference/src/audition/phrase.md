# The standard phrase

<p class="lede">Audio features are only comparable under an identical stimulus. This
module owns that stimulus, and every segment of it exists to reveal something.</p>

## The spec

`PhraseSpec::default()` — four notes, ~5.05 seconds, 44 100 Hz, RNG seed
`0xE05_F00D`:

| # | Note | Gate on | Gate off | Chord | Reveals |
|---|---|---|---|---|---|
| 1 | C4 | 1.80 s | 0.20 s | — | Slow attacks; sub-Hz modulation over a register-constant sustain |
| 2 | C5 | 0.30 s | 0.15 s | — | Whether the patch speaks at all an octave up |
| 3 | C4 | 0.50 s | 0.20 s | +E4 | Intermodulation and mud when voices stack |
| 4 | C3 | 0.80 s | **1.10 s** | — | Bass register, and the release / delay / reverb tail |

Pitches are V/Oct offsets from C4. The seed is installed into quiver's thread-local
RNG before rendering, so noise and analog drift are **bit-reproducible** — a patch's
features are the same every time it is measured.

<figure class="viz" data-viz="phrase">
<figcaption><strong>Click a segment.</strong> Solid is gate-on, dashed is the
release window after it, and the second lane is the dyad's own compiled voice.
The amber band is the final 300 ms — the window <code>tail_ratio</code> is
measured in, which is the reason the low note is <em>last</em> rather than
anywhere else.</figcaption>
</figure>

## Why each segment

The original phrase was three short notes (0.6 s stab, 0.25 s stab, 0.8 s low note),
and it was the loop's weakest link. Worse, the deficit *compounded* with every
correctness fix elsewhere: it could not discriminate

- **slow pads** — a 2-second attack was silent for most of the stimulus,
- **anything modulated below ~1 Hz** — no register-constant segment long enough to
  hold a modulation cycle,
- **anything above Eb4** — its highest note,
- **how a patch stacks polyphonically** — strictly monophonic.

So the grammar could express patches the audition could never reveal, and the taste
model was being asked to learn preferences over evidence that was not in $\varphi$.
No amount of model improvement fixes that; it is a measurement problem.

The v2 default covers each hole with the cheapest segment that reveals it:

1. **C4 held 1.8 s.** The attack measurement window (onset → next onset) is now
   2.0 s rather than 0.75 s, and the sustain is long enough that sub-Hz modulation
   completes most of a cycle. `held_centroid_std` is measured **here specifically**,
   which is what makes it register-constant by construction.
2. **C5 stab.** One octave above the old ceiling. With the compiler's fixed 0.5
   keytracking, this is where dark patches reveal whether they speak up high —
   `high_ratio`.
3. **C4+E4 dyad.** A second compiled voice, gate-synced with the main voice, reveals
   intermodulation — `chord_flatness_delta`. A dyad rather than a triad because
   render cost is per voice-second and pairwise intermodulation is the first-order
   phenomenon.
4. **C3 with a 1.1 s release window, kept last.** Bass register, and its position
   matters: the tail measurement is the final 300 ms, so putting this note last is
   what makes the tail see release length and reverb rather than a truncated chord
   decay.

Cost: about 2× the v1 render, measured. The dyad's second voice is the difference
between wall seconds and rendered voice-seconds.

## Chord voices

`Note::chord` carries additional simultaneous pitches, each rendered by **its own
compiled voice**, gate-synced with the main note.

Two behaviours that had to be got right:

- Chord voices **start cold** at the note's onset — exactly how live voice
  allocation behaves, so the measurement matches what a player would hear.
- After the shared gate closes they **keep ticking until their own output parks on
  silence**. A truncated release tail is a broadband click, and a click would poison
  every spectral feature in the frame it lands in.

`max_voices()` reports the largest simultaneous count (2 for the default spec), and
the [vet gate's peak ceiling scales with it](./vetting.md#the-polyphony-scaled-ceiling).

## The `:p2` stimulus tag

Every audio feature name carries a generation tag:

```text
centroid_mean:p2   rms_std:p2   attack_s:p2   …
```

This is the migration mechanism, not a version comment.

A stimulus change changes what every audio value *means*, even when the formula is
untouched — a slow pad's `rms_mean` under a phrase that never lets it open is a
different quantity from the same field under one that does. The observation log
stores raw $\varphi$ **by name**, and `FitSet::build` projects old logs onto the
current names on the rule *same name ⇒ same coordinate*.

So tagging the name with the stimulus generation means votes recorded under the v1
phrase:

- **keep** their structural coordinates, which are stimulus-independent;
- have their old-stimulus audio coordinates **honestly imputed as "no evidence"**,
  rather than being silently mixed into a standardizer they were never commensurable
  with.

Bump the tag whenever `PhraseSpec::default()` changes audibly. Failing to bump it is
worse than a wrong number: it is old evidence presented as current evidence.

## What the phrase still does not reveal

Stated because the model cannot learn what the stimulus does not show:

- **Velocity response.** The phrase plays at one velocity.
- **Fast passages.** No segment tests how the patch behaves in a run.
- **Long-term behaviour.** Five seconds cannot reveal a 30-second evolving pad.
- **Stereo width.** The render is summed to mono for feature extraction, and there is
  no width coordinate in $\varphi$ at all. The chorus module's spec card says so
  outright in the app.

The intended direction is **per-style audition phrases** — a discovered bass style
picks a bassline, a pad style picks a chord swell — which would make the stimulus
adaptive rather than fixed. That is a design note, not shipped code, and the `:p2`
tag is the mechanism that would let it happen without invalidating history.
