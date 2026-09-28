# What the model learns from

<p class="lede">Four kinds of answer, one model, and a few things that feel like
teaching but are not. A duel can be dealt in EVOLVE or answered while you play
in PERFORM.</p>

<!-- film:taste -->
<figure class="film" id="film-taste">
<video controls preload="none" playsinline poster="../assets/film/taste.jpg">
<source src="../assets/film/taste.mp4" type="video/mp4">
<track kind="captions" src="../assets/film/taste.vtt" srclang="en" label="English" default>
</video>
<figcaption>The taste model, animated: what it hears, what a pick tells it, how it keeps score, and how it searches. <span class="film-len">1:49</span> · <a href="films.html#film-taste">chapters and transcript</a></figcaption>
</figure>
<!-- /film:taste -->

## The four signals

Everything you tell Auracle enters **one observation log** and conditions **one
latent quantity**: a utility $u(x)$, "how much this person would like patch
$x$". The signals differ only in how they connect an answer to that utility,
and there are three ways: a duel, stars and keep/kill.

| Signal | Where | What it says |
|---|---|---|
| **A/B duel** | EVOLVE, or the quick-pick strip in PATCH | $A$ scores higher than $B$ |
| **an offer answered** | PERFORM: **Take** an offer you heard, or ask for another | The same duel, between the sound you were playing and the model's offer |
| **★ stars** | Any bank row | This patch's utility falls in the band that rating covers |
| **keep / kill** | A bank row's **cut** (kills only) | This patch is above / below where I'm drawing the line today |
| **edit against original** | **commit** on an edited patch: the **WHICH ONE IS BETTER?** card, or *my edit is better* to skip it | The same duel, between my edit and what I started from, whichever way I answered |

**Duels are the primary signal.** They have the best statistical properties and
the lowest cognitive load: people compare two things reliably, and assign
absolute numbers to one thing inconsistently, including against themselves an
hour later.

If you only ever do one thing, do duels.

### About stars

A star rating is **not** treated as the number three. It is treated as *"this
patch's utility sits between two learned cutpoints"*, and the cutpoints are
fitted alongside everything else. That is what makes the scale survive drift:
if you go through a generous phase and then a harsh one, the model can move the
cutpoints instead of concluding your taste changed.

Rate honestly, including low. A star is a judgement, and rating things you
dislike is information.

### About keep / kill

Keep/kill is modelled against a **per-session threshold** the model also fits.
"Feeling picky today" is represented rather than treated as noise, so a session
where you kill almost everything is read as a strict session rather than a
change in your taste.

A bank row's **cut** records a kill once its seven-second undo window closes;
undo inside it and nothing is recorded. Nothing records a keep yet: the triage
screens that would emit one have not been built.

### What is *not* a signal

Listen time, replays, exports and how long you hovered are not recorded as
preferences. They are cheap to collect and easy to misread: a long listen can
mean fascination or confusion.

**Saving a patch is also not a signal.** See
[stars are not saves](./bank.md#stars-are-not-saves).

**In PERFORM, only an answered offer is a signal.** Taking an offer you heard,
or asking for another after hearing it, is a duel (above). Keep, Back and
control turns are logged with your session and not fitted. See [what PERFORM
teaches the model](./views/perform.md#what-perform-teaches-the-model).

## The warm start

On first run you pick **3 of 9** presets.

That single ~30-second interaction is worth **18 pairwise observations**: each
of your three picks is recorded as beating each of the six you did not pick. It
exists because the cold start is severe. From nothing it takes hundreds of
duels, and eighteen observations before you have answered a single one is the
difference between a model that has an opinion by the end of your first session
and one that does not.

The nine are drawn **one per family first** from the 62-patch library, then
filled from what is left, so the first thirty seconds span the space rather than
landing in one corner. Only those nine are loaded, which keeps the first run
short and most of the pool free for what the search finds.

Your three picks are also **saved**, so no generation can evict them: they take
3 of the pool's 10 save slots, and the message that ends the warm start says
*Your three are saved*. The first of them is opened, ready to play.

Re-run it any time from **⋯** → *Re-run the three-pick warm start*.

## When it learns

Two mechanisms, at two speeds.

**Between refits: reweighting.** Every vote is folded in immediately by
importance sampling, where the draws the model already has get reweighted by
how well each one predicted your answer. It costs almost nothing, and it is
what lets the model's next forecast, and its read of the patch in front of you,
answer your last pick instead of waiting for the next full fit.

**At a refit: inference.** Full Markov-chain inference over the entire log, a
few seconds of work off the audio thread. This is where the model can change
its mind, discover a new style lens, or re-fit the star cutpoints.

**Every sixth pick refits.** The teaching meter counts down to it in six pips
(*3 more picks and it redraws your taste map*). A pick is a duel answered in
EVOLVE or in PATCH's pick strip, or an offer answered in PERFORM. On the sixth
the row fills and the meter reads **● learning from your last 6 picks…**: the
sixth pick keeps its seven seconds to be taken back like any other, and the
refit goes out when they are up (or at once, if you pick again first). While a
generation is breeding it reads **● it will learn from these 6 when breeding
finishes**, because a refit waits for the generation. The wordmark's **E**
lights while the fit runs. When it lands, the TASTE map is redrawn and the
meter reads **● it just learned — see what changed ▸** until your next pick;
the link opens the map.

Reweighting alone would wear thin: as the weights concentrate on fewer and
fewer draws, the model starts claiming more certainty than it has. Refitting on
a fixed count keeps that from building up, and keeps the meter's promise every
time.

## Recency

Old votes fade. An observation `h` places back in the log carries weight

$$w_h = 0.5^{\,h / 150}$$

so about 150 observations ago is worth half as much as your latest. Your taste
is allowed to change, and a model that weighted a vote from three sessions ago
equally with one from a minute ago would fight you when it did.

<figure class="viz" data-viz="recency">
<figcaption><strong>How long what you told it keeps mattering.</strong> At a
half-life of 150, a vote from three hundred observations back still carries a
quarter of a fresh one's weight.</figcaption>
</figure>

## What moves the model most

Roughly in order:

1. **Duels between genuinely different patches.** The most information per answer.
2. **The warm start.** Eighteen observations for thirty seconds. Re-running it
   adds eighteen more.
3. **Duels the model got wrong.** A surprising answer moves a posterior further
   than a confirming one.
4. **Stars, in volume.** Weaker per observation, but cheap, and they anchor the
   absolute scale that duels alone cannot pin down.
5. **Hand edits, committed.** These carry a lot: a direction in genome space,
   and your verdict on it. Answered on the **WHICH ONE IS BETTER?** card, the
   verdict is heard, and "the original won" teaches it the most. Ticked
   as *my edit is better*, it is a claim. TRUST scores the two apart, because an
   asserted improvement and a heard one may not be equally reliable.

## What it cannot learn

Worth knowing, so you do not spend a session teaching something that cannot be
received.

The model sees each patch through a fixed set of measurements: eighteen
perceptual descriptors of a standard render plus twenty-six structural counts.
**If a preference is not visible in those coordinates, no amount of voting will
convey it.** The clearest case is stereo width: the feature vector has no
coordinate for it, so the model will never learn that you like chorus for its
width. The chorus module's [spec card](./wiring.md#the-spec-card) says so in
its **heard** line.

Preferences about *performance* are largely invisible too — how a patch
responds to velocity, how it behaves in a fast run — because the audition
phrase is fixed and modest. What the phrase does and does not reveal is
[spelled out in the reference](../reference/audition/phrase.html).

```admonish tip title="How to check"
Before spending a session teaching a preference, read the **heard** line on the
modules involved. If it says the model cannot pick it up, believe it, and use
**save** and your own naming instead.
```
