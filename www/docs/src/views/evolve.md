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
log and the button leaves the toast. That holds for every pick, the sixth
included. The toast always names the vote <kbd>⌘Z</kbd> would undo: vote again
and the new pick's toast takes the old one's place.

<kbd>⌘Z</kbd> in EVOLVE only ever takes back a pick (or a cut) still inside
its seven seconds. With none left it changes nothing and says *nothing to undo
here — PATCH edits undo in PATCH*: edits to the patch are undone in PATCH,
where you can see them.

The next pair is already waiting. While a pair is on the table the engine
deals the one after it and renders both its sounds, so a pick or a skip puts
it up at once, sounds and all, and the pair after that is dealt behind it. It
is chosen before your pick is known, which changes nothing: the pick is held
in its seven seconds anyway, and pairs are dealt at random (see below). A
patch you cut meanwhile is never put up: that pair is dropped and dealt again.
Nor is a pair that lost a patch to the pool (a generation replaced it): the
waiting pair goes up in its place. Taking a pick back puts its pair back on
the table, and the pair it had brought up, or the one still being dealt,
waits as the next.

Pairs go up in the order they were dealt. A pick made while the next pair is
still being dealt waits for that pair rather than asking for another, so a
seeded session shows the same pairs in the same order however long each deal
took.

Only when no pair is waiting (right after a cut, say) do the cards dim and
their buttons do nothing until the next pair is dealt, usually a few
hundredths of a second, generation or not. A deal that takes longer says why
on the cards: with no render farm (see [EVOLVE POOL](#evolve-pool)), a deal
during a generation waits for the walk in progress, and the cards read, for
example, *dealing — the engine is breeding (seed 4/10)*.

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
one. The row fills and the strip says *● learning from your last 6 picks…*
while the sixth pick's seven seconds run out and the refit runs (pick again
first and the refit goes out at once). During a generation it says *● it will
learn from these 6 when breeding finishes* instead, because a refit waits for
the generation. When the refit lands, the [TASTE](./taste.md) map is redrawn
and the strip glows amber and says *● it just learned — see what changed ▸*;
the link opens the map. It says so until your next pick.

Between refits your votes still count: each one is folded into the model
immediately by reweighting, so the next question responds to the last answer.
A refit is the expensive version: full Markov-chain inference over the whole
log, a few seconds, off the audio thread. While a refit, a generation or ⚡
evolve from this runs, the **job slot** in the menu bar, beside
**generations**, says so (*refitting your taste map…*, *⚡ breeding 3/10 ·
about 40 s*, *⚡ evolving Soft Pad*), and the **E** of the wordmark is lit
exactly while the slot shows.

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
the children. Each child appears the moment it is bred, at the top of the bank
under **new · gen N**, in the order the walks were dealt, and can be played at
once; the ranked rows below it do not move. The patches it likes least are
replaced to make room when the generation ends, and the generation's toast
names them (the first three, then *+N more*); anything you have **saved** by
then is exempt, including a patch you save while the generation is still
running. A child bred early can end up below the children bred after it;
then it is the one not kept, and the toast says so. Hover **EVOLVE POOL** to see which rows it may replace: they get a
dashed rail and *may be replaced*. A patch you cut is never dealt to you
again, though it stays in the pool until a generation replaces it.

It is *local hill-climbing* on what the model believes, not a draw from the
target distribution. In practice that means children resemble their parents,
and a generation moves the pool rather than replacing it. The
[reference is precise about this](../../reference/search/refinement.html).

Nothing happens if there is no fitted model yet; there is no direction to climb
in. Answer some duels first.

A generation is a walk of a few dozen renders from each of ten seeds. The
walks run side by side on the render farm, as many at once as your machine
has workers to spare, and a generation lasts as long as its slowest walks:
measured on a busy four-core machine, about two to three and a half minutes,
a little less with more cores to spare. The whole instrument goes on
answering while it breeds: a pick deals its next pair in a few hundredths of
a second, a ▶ plays, a patch opens, and PERFORM measures and grows offers.
Only a refit waits for the generation to finish, so the generation is bred
under the model it started with. The seeds give the same children however
many workers walk them.

While it breeds, **EVOLVE POOL** is its own progress bar, *breeding 3/10*
(the walks folded in so far), with **stop** beside it; the job slot in the
menu bar says the same with the time left, in every view. **Stop** keeps the
children bred so far and replaces only as many patches as they need.

With no render farm (a single-core machine, or `?farm=0` in the address) the
walks run in the engine itself, one after another, and a generation takes
about three and a half to four minutes on the same machine. Then a ▶, a bench
open or a pick is answered between one walk and the next, so after a pick the
next pair can take up to about 20 seconds, and the cards say which seed they
are waiting on.

## The EVOLUTION strip

What each generation did, per step, newest first (the three most recent
steps):

```text
gen 1 ⚡ evolution on Soft Pad → Warm Drone 2 · release 398 ms → 759 ms, mod depth 25% → 4%,
      filter → delay, +1 more, +mix, +filter, −supersaw · liked −0.48 exploring
gen 0 ✎ your edit on Glass Rain → Glass Rain 2 · cutoff 1.78 kHz → 20 kHz · liked −0.31
```

Each step names the parent and the child it became, by the names the bank
gives them (a parent since replaced keeps the name it had). Parameter moves
are named and shown before → after in their own units (ms, dB, Hz, %); a
module that became another reads `filter → delay`, and one added or removed
reads `+module` / `−module`. **liked** is how much more (or, below zero, less)
the model expected you to like the child than its parent when the step was
made. **exploring** marks a bred step that went down: evolution samples your
taste rather than only climbing it, so some steps go sideways or down to keep
it from getting stuck, and your picks decide whether they were worth it.

The sparkline to the left has one point per step, oldest to newest: the
child's predicted score as the model saw it when the step was made, amber for
a bred step and green for your edit. It is a record of the steps, not a score
of the whole pool over time.

A generation that bred nothing leaves no step. If no step has been made yet,
the strip says the generation ran but *no move was accepted*, in the same
words as that generation's toast.

Hand edits appear here too, tagged **✎** instead of **⚡**. The lineage records
everything that produced a patch, not only what the machine did.

## A working rhythm

1. **Answer duels** until the meter fires a refit. Ten to fifteen is a good
   first batch.
2. **Check [TASTE](./taste.md).** Has a style separated out? Is TRUST improving?
3. **EVOLVE POOL** and listen to the children.
4. Repeat. When a child is genuinely good, take it to [PATCH](./play.md), lock
   what you like, and **⚡ evolve from this** for variations around it.
