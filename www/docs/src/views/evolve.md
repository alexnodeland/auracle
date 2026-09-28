# EVOLVE — the duels

<p class="lede">Two candidates, one question, and the machinery that turns your
answer into a better next question.</p>

<!-- film:view-evolve --><!-- /film:view-evolve -->

<figure>
<img src="../img/evolve.webp" alt="Two duel cards side by side with rendered waveforms, SAMPLE / BENCH / CHOOSE controls, a teaching meter above and a generation lineage log below." loading="eager" width="1440" height="900">
<figcaption><strong>EVOLVE.</strong> Two candidates and one question. The meter
above counts down to the next refit; the strip below says what the last
generation changed.</figcaption>
</figure>

## The duel

Two cards, A and B. Each carries a **name**, an id, and its rendered waveform.
The names are generated from what the patch is, so *Round Wash* and *Gritty
Swell* mean something.

| | |
|---|---|
| <kbd>1</kbd> / <kbd>2</kbd>, or **▶ SAMPLE** | Play the standard five-second phrase; press again to stop it |
| Click the card body | Load that candidate live on the keyboard |
| <kbd>←</kbd> / <kbd>→</kbd>, or **CHOOSE A/B** | Vote |
| **⌖ BENCH** | Send it to the workbench in [PATCH](./play.md) without voting |
| **skip ↻** | Deal a new pair and record nothing |

A vote counts the moment you cast it: **PICKS** in the menu bar and the pips
move at once. For seven seconds it can still be taken back, with
<kbd>⌘Z</kbd> or *not what I meant* on its toast, and then it goes into the
log. The toast always names the vote <kbd>⌘Z</kbd> would undo: vote again
and the new pick's toast takes the old one's place.

Both sides play the *same* phrase. That is the point: audio features are only
comparable across patches under an identical stimulus, so the sample is a fixed
five seconds: a held C4, a C5 stab, a C4+E4 dyad, and a low C3 with a long
release tail.
[The reference explains why each segment is there](../../reference/audition/phrase.html).

Clicking the card instead gives you the patch live under your hands, which is
often the faster way to tell two near-ties apart.

```admonish tip title="Vote fast"
A duel is a gut reaction. The model is built for noisy answers and averages over
them; a carefully deliberated vote is not worth more than a quick one, and
deliberating is how a session stops being fun. If you cannot tell, press
**skip ↻**. A coin flip recorded as a preference is worse than no data.
```

## The teaching meter

The strip above the cards is the session's state of play:

<figure>
<img src="../img/teach-meter.webp" alt="The teaching meter: six pips, then the line 12 picks in. Every 6 it redraws your taste map. In the middle, ◇ random pair — a fair test beside a skip button, and EVOLVE POOL at the right end." loading="eager" width="1172" height="60">
<figcaption><strong>The teaching meter.</strong> Six pips to the next refit, the
count so far, and how the pair on the table was dealt.</figcaption>
</figure>

The pips count down to the next **refit**, and the sixth pick always brings
one: the row fills, the strip glows amber and says *● it just learned*, and
the [TASTE](./taste.md) map is redrawn. Between refits your votes still count:
each one is folded into the model immediately by reweighting, so the next
question responds to the last answer. A refit is the expensive version: full
Markov-chain inference over the whole log, a few seconds, off the audio
thread. When one runs, the **E** of the wordmark lights.

**◇ random pair — a fair test**, beside **skip ↻**, says how pairs are
dealt: at random from the pool. The model does not choose what you hear, and
that is what makes every pick a fair test of the forecast it makes before you
vote. [TRUST](./taste.md#trust--is-its-confidence-honest) scores them all.
The line holds its place from duel to duel; the forecast for the pick you
just made appears above it.

```admonish note title="Why the pair sometimes looks like a near-tie"
Because it sometimes is one, and a random pairing asks those as often as any
other. The default pairing is uniformly random over the pool, which makes
*every* duel an unbiased calibration sample; measured, it teaches the model as
fast as the information-seeking rule the engine also has, which deliberately
serves near-ties. Under that rule the line reads *chosen where it's least
sure*, and about one duel in ten is still dealt at random as a check, marked
**◇ unbiased probe — dealt at random**. Either way, "these two sound similar"
is a question worth answering.
```

## EVOLVE POOL

Breeds a generation.

The engine takes the ten highest-scoring patches in the pool and runs a short
Metropolis–Hastings walk from each, mutating structure and parameters with the
proposal distribution tilted by what your taste model has learned, then injects
the children. Weakest members are evicted to make room; anything you have
**saved** is exempt.

It is *local hill-climbing* on what the model believes, not a draw from the
target distribution. In practice that means children resemble their parents,
and a generation moves the pool rather than replacing it. The
[reference is precise about this](../../reference/search/refinement.html).

Nothing happens if there is no fitted model yet; there is no direction to climb
in. Answer some duels first.

A generation is a walk of a few dozen renders from each of ten seeds, a minute
or two on a laptop. The rest of the instrument stays playable while it runs:
a ▶, a bench open or a pick is answered between one seed and the next, and the
button counts the seeds as they go. A refit waits for the generation to
finish.

## The EVOLUTION strip

What each generation did, per step:

```text
gen 1 ⚡ evolution on #51 → #52 · release 398 ms → 759 ms, mod depth 25% → 4%,
      filter → delay, +1 more, +mix, +filter, −supersaw · Δtaste −0.48 exploring
gen 0 ✎ your edit on #50 → #51 · cutoff 1.78 kHz → 20 kHz · Δtaste −0.31
```

Parameter moves are named and shown before → after in their own units (ms,
dB, Hz, %); a module that became another reads `filter → delay`, and one added
or removed reads `+module` / `−module`. `Δtaste` is how much the model's
estimate of the patch moved. **exploring** marks a bred step that went down:
evolution samples your taste rather than only climbing it, so some steps go
sideways or down to keep it from getting stuck, and your picks decide whether
they were worth it. The sparkline to the left is the pool's utility over
generations.

Hand edits appear here too, tagged **✎** instead of **⚡**. The lineage records
everything that produced a patch, not only what the machine did.

## A working rhythm

1. **Answer duels** until the meter fires a refit. Ten to fifteen is a good
   first batch.
2. **Check [TASTE](./taste.md).** Has a style separated out? Is TRUST improving?
3. **EVOLVE POOL** and listen to the children.
4. Repeat. When a child is genuinely good, take it to [PATCH](./play.md), lock
   what you like, and **⚡ evolve from this** for variations around it.
