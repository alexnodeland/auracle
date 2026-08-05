# What the model learns from

<p class="lede">Four kinds of answer, one model, and a few things that feel like
teaching but are not.</p>

## The four signals

Everything you tell Auracle enters **one observation log** and conditions **one
latent quantity**: a utility $u(x)$, "how much this person would like patch $x$".
The four signals differ only in how they connect an answer to that utility.

| Signal | Where | What it says |
|---|---|---|
| **A/B duel** | EVOLVE, or the quick-pick strip in PLAY | $A$ scores higher than $B$ |
| **★ stars** | Any bank row | This patch's utility falls in the band that rating covers |
| **keep / kill** | Triage | This patch is above / below where I'm drawing the line today |
| **edit beats original** | *my edit is better*, on commit | My edited version scores higher than what I started from |

**Duels are the primary signal** and it is not close. They have the best
statistical properties and the lowest cognitive load: comparing two things is
something people do reliably, whereas assigning an absolute number to one thing is
something people do inconsistently, including against themselves an hour later.

If you only ever do one thing, do duels.

### About stars

A star rating is **not** treated as the number three. It is treated as *"this
patch's utility sits between two learned cutpoints"*, and the cutpoints are fitted
alongside everything else. That is what makes the scale survive drift: if you go
through a generous phase and then a harsh one, the model can move the cutpoints
instead of concluding your taste changed.

Rate honestly, including low. A star is a judgement, and rating things you dislike
is information.

### About keep / kill

Keep/kill is modelled against a **per-session threshold** the model also fits.
"Feeling picky today" is represented rather than treated as noise — so a session
where you kill almost everything is read as a strict session, not as a
transformation of your taste.

### What is *not* a signal

Deliberately: listen time, replays, exports and how long you hovered are not
recorded as preferences. They are cheap to collect and easy to misread — a long
listen can mean fascination or confusion — and this version would rather have less
data that means what it says.

**Saving a patch is also not a signal.** See
[stars are not saves](./bank.md#stars-are-not-saves).

## The warm start

On first run you pick **3 of 9** presets.

That single ~30-second interaction is worth **18 pairwise observations**: each of
your three picks is recorded as beating each of the six you did not pick. It
exists because the cold start is genuinely severe — the project's own synthetic
tests measure it in the *hundreds* of duels — and eighteen observations before you
have answered a single duel is the difference between a model that has an opinion
by the end of your first session and one that does not.

The nine are **sampled one per family** from the 29-patch library, and only those
nine are loaded. An earlier version rendered a card per preset and loaded every
one of them, which at 29 would have been a scrolling first run that spent more
than half a 48-slot pool before you had said anything. Library size and grid size
are independent on purpose.

Re-run it any time from **⋯** → *Re-run the three-pick warm start*.

## When it actually learns

Two mechanisms, at two speeds.

**Between refits — reweighting.** Every vote is folded in immediately by
importance sampling: the draws the model already has get reweighted by how well
each one predicted your answer. This is exact, it costs almost nothing, and it is
what makes the *next* question respond to the *last* answer. Without it the
pairing rule would read a frozen model and re-ask the same question until the next
full fit.

**At a refit — inference.** Full Markov-chain inference over the entire log, a few
seconds of work off the audio thread. This is where the model can genuinely change
its mind, discover a new style lens, or re-fit the star cutpoints.

The teaching meter counts down to the next refit — at most every six duels, and
only when the between-fit reweighting has run out of road. That condition is the
interesting one: reweighting degrades gracefully rather than silently, because the
*effective* sample size of the reweighted draws falls as the weights concentrate
on fewer and fewer of them. When it has collapsed far enough that the model is
pretending to be more certain than it is, that is the trigger to pay for a real
fit. The wordmark's **E** lights while one runs.

## Recency

Old votes fade. An observation `h` places back in the log carries weight

$$w_h = 0.5^{\,h / 150}$$

so about 150 observations ago is worth half as much as your latest. Your taste is
allowed to change, and a model that weighted a vote from three sessions ago
equally with one from a minute ago would fight you when it did.

## What moves the model most

Roughly in order:

1. **Duels between genuinely different patches.** The most information per answer.
2. **The warm start.** Eighteen observations for thirty seconds is unbeatable
   value, and it is available exactly once per reset.
3. **Duels the model got wrong.** A surprising answer moves a posterior further
   than a confirming one. This is also why the pairing rule serves near-ties.
4. **Stars, in volume.** Weaker per observation, but cheap, and they anchor the
   absolute scale that duels alone cannot pin down.
5. **Hand edits committed with *my edit is better*.** Rich — you have told it a
   direction in genome space *and* that the direction was good — but scored
   separately in TRUST, because an asserted improvement and a heard one are not
   obviously equally reliable.

## What it cannot learn

Worth knowing, so you do not spend a session teaching something that cannot be
received.

The model sees each patch through a fixed set of measurements: fifteen perceptual
descriptors of a standard render plus twenty-five structural counts. **If a
preference is not visible in those coordinates, no amount of voting will convey
it.** The clearest case is stereo width: the feature vector has no coordinate for
it, so the model will never learn that you like chorus for its width — and the
chorus module's [spec card](./wiring.md#the-spec-card) says exactly that, in the
**heard as** line.

Related: preferences about *performance* — how a patch responds to velocity, how
it behaves in a fast run — are largely invisible, because the audition phrase is
fixed and modest. What the phrase does and does not reveal is
[spelled out in the reference](../reference/audition/phrase.html).

```admonish tip title="How to check"
Before spending a session teaching a preference, read the **heard as** line on the
modules involved. If it says the model cannot pick it up, believe it — and use
**save** and your own naming instead. That is what those are for.
```
