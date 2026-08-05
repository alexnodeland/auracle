# EVOLVE — the duels

<p class="lede">Two candidates, one question, and the machinery that turns your
answer into a better next question.</p>

<figure class="wide">
<img src="../img/evolve.webp" alt="Two duel cards side by side with rendered waveforms, SAMPLE / BENCH / CHOOSE controls, a teaching meter above and a generation lineage log below." loading="eager" width="1440" height="900">
</figure>

## The duel

Two cards, A and B. Each carries a **name** rather than an s-expression — names
are generated from what the patch actually is, so *Round Wash* and *Gritty Swell*
are descriptions and not decoration — an id, and its rendered waveform.

| | |
|---|---|
| <kbd>1</kbd> / <kbd>2</kbd>, or **▶ SAMPLE** | Play the standard five-second phrase |
| Click the card body | Load that candidate live on the keyboard |
| <kbd>←</kbd> / <kbd>→</kbd>, or **CHOOSE A/B** | Vote |
| **⊕ BENCH** | Send it to the workbench in [PLAY](./play.md) without voting |
| **↻** | Deal a different pair |
| **skip** | This pair is uninformative; do not record anything |

Both sides play the *same* phrase. That is the point: audio features are only
comparable across patches under an identical stimulus, so the sample is a fixed
five seconds — a held C4, a C5 stab, a C4+E4 dyad, and a low C3 with a long
release tail. Each of those segments exists to reveal something a shorter phrase
could not; if you want to know exactly what,
[the reference explains the phrase](../../reference/audition/phrase.html).

Clicking the card instead gives you the patch live under your hands, which is
often the faster way to tell two near-ties apart.

```admonish tip title="Vote fast"
A duel is a gut reaction. The model is built for noisy answers and averages over
them; a carefully deliberated vote is not worth more than a quick one, and
deliberating is how a session stops being fun. If you genuinely cannot tell,
**skip** — a coin flip you record as a preference is worse than no data.
```

## The teaching meter

The strip above the cards is the session's state of play:

```text
●●●●●○○   44 picks in. Every 6 it redraws your taste map.
          ◇ unbiased probe — picks like this one score the honesty meter
```

The pips count down to the next **refit**. Between refits your votes are not
ignored — each one is folded into the model immediately by reweighting, which is
what makes the next question respond to the last answer. A refit is the expensive
version: full Markov-chain inference over the whole log, a few seconds, off the
audio thread. When one runs, the **E** of the wordmark lights.

**◇ unbiased probe** marks a duel that was drawn at random rather than chosen.
Those are the ones that can score the model's honesty without circularity — see
[TRUST](./taste.md#trust--is-its-confidence-honest).

```admonish note title="Why the pair sometimes looks like a near-tie"
Because it often is one, on purpose. A pair the model already knows the answer to
teaches it nothing. The default pairing is uniformly random over the pool, which
makes *every* duel an unbiased calibration sample; an information-seeking
alternative that deliberately serves near-ties is also implemented and
selectable. Either way, "these two sound similar" frequently means "this is a
question worth asking".
```

## EVOLVE POOL

Breeds a generation.

The engine takes the ten highest-scoring patches in the pool, runs a short
Metropolis–Hastings walk from each — mutating structure and parameters, with the
proposal distribution tilted by what your taste model has learned — and injects
the children. Weakest members are evicted to make room; anything you have
**saved** is exempt.

It is *local hill-climbing* on what the model believes, not a draw from the
target distribution. That matters for what you should expect: children resemble
their parents, and a generation moves the pool rather than replacing it. The
[reference is precise about this](../../reference/search/refinement.html), because
the difference is easy to overstate.

Nothing happens if there is no fitted model yet — there is no direction to climb
in. Answer some duels first.

## The EVOLUTION strip

What each generation actually did, per step:

```text
gen 31 ⚡ evolution on #90 → #91 · attack 0.59→0.83, decay 0.45→0.28,
       release 0.13→0.82, +1 more, +noise, −distortion, −filter · Δtaste +0.65
gen 30 ✎ your edit on #49 → #90 · leaf processor→source,
       mod depth 0.24→0.30, mod follower→no mod, +vco, −delay
```

Parameter moves are named and shown as before→after; structural moves as
`+module` / `−module`. `Δtaste` is how much the model's estimate of the patch
moved. The sparkline to the left is the pool's utility over generations.

Hand edits appear here too, tagged **✎** rather than **⚡**, because the lineage
is a record of everything that produced a patch and not only of what the machine
did.

## What to do here, in order

1. **Answer duels** until the meter fires a refit. Ten to fifteen is a good first
   batch.
2. **Check [TASTE](./taste.md)** — has a style separated out? Is TRUST improving?
3. **EVOLVE POOL** and listen to the children.
4. Repeat. When a child is genuinely good, take it to
   [PLAY](./play.md), lock what you like, and **⚡ evolve from this** for
   variations around it.
