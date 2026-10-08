# What the model learns from

<p class="lede">The model learns your taste from what you tell it: picks,
stars, cuts, and the edits you keep. This page says what each one teaches, when
it learns, and what it can’t learn at all.</p>

<!-- film:taste -->
<figure class="film" id="film-taste">
<video controls preload="none" playsinline poster="../assets/film/taste.jpg">
<source src="../assets/film/taste.mp4" type="video/mp4">
<track kind="captions" src="../assets/film/taste.vtt" srclang="en" label="English" default>
</video>
<figcaption>The taste model, animated: what it hears, what a pick tells it, how it keeps score, and how it searches. <span class="film-len">1:49</span> · <a href="films.html#film-taste">chapters and transcript</a></figcaption>
</figure>
<!-- /film:taste -->

## What teaches it

Everything you tell Auracle goes into one log, and the model learns one thing
from all of it: how much you’d like each sound. The kinds of answer differ only
in what they say about that.

| You | Where | What it says |
|---|---|---|
| **Pick** between two sounds | EVOLVE, or **TEACH** at the foot of PATCH's well | You’d reach for A over B |
| **Take** or **pass** (NEXT or PASS) on an offer you heard | PERFORM | The same, between the sound you were playing and the offer |
| **★** a sound | Any bank row: its **★** opens five stars, or <kbd>1</kbd>–<kbd>5</kbd> on the row under the cursor | Where it sits on your scale, one to five |
| **×** cut a sound | Any bank row | Not this one |
| **Keep as new** an edit | PATCH's edit bar: the **WHICH WOULD YOU REACH FOR?** card, or **PICK THE EDIT** to skip it | Your edit over the original, or the original over your edit |

**Picks teach the most.** People compare two sounds reliably, and give one
sound a number much less reliably, even against themselves an hour later. If
you do one thing, pick between pairs.

### About stars

A star rating isn’t read as the number three. It’s read as “this sound sits
between two points on your scale”, and the model learns where those points are
along with everything else. So if you go through a generous phase and then a
harsh one, the model can move the points instead of deciding your taste
changed.

Rate the sounds you wouldn’t reach for, too. A low star is information.

### About cuts

A cut is read against a line the model also learns: how picky you are being
today. A session where you cut almost everything reads as a strict session,
not as a change in your taste.

A cut is recorded once its seven seconds to take it back have passed; take it
back and nothing is recorded. The other half of that answer, a keep, has
nothing in the app that records it yet.

### What doesn’t teach it

Listening time, replays, downloads, and hovering aren’t recorded as answers.
They are cheap to collect and hard to read right: a long listen can mean you love
it or that you’re puzzled by it.

**Saving a sound teaches nothing.** See [stars are not
saves](./bank.md#stars-are-not-saves).

**In PERFORM, only an answered offer teaches.** KEEP, BACK, and control turns
are logged with your session, and the model doesn’t learn from them. See
[what PERFORM teaches the model](./views/perform.md#what-perform-teaches-the-model).

## The warm start

On a first visit you pick three of nine presets, under **PICK THE THREE YOU’D
REACH FOR**. That half minute teaches the model 18 picks: each of your three
over each of the six you passed over. From nothing, the model needs hundreds of
picks, and those 18 are the difference between a model that has a guess by the
end of your first session and one that doesn’t.

The nine are drawn one per family first from the 62 presets, then filled from
the rest, so the first half minute spans the range instead of one corner. Only
those nine are loaded, which keeps most of the pool free for what breeding
finds.

Your three are saved, so no generation replaces them: they take 3 of your 10
saves, and the toast that ends the warm start says so. The first of them opens
in PERFORM, ready to play.

1. Open [⌘K](./levels.md#k-find-anything).
2. Choose *Re-run the three-pick warm start*, any time, to teach it 18 more.

## When it learns

It learns at two speeds.

**After every pick, a little.** Each answer is folded in at once, so the
model’s next guess, and its guess about the sound you’re playing, answer your
last pick. This costs almost nothing.

**Every sixth pick, a refit.** The model fits again from the whole log: a
few seconds of work at most, off the audio thread. This is where it can change its mind,
find a new style, or move the points on your star scale.

In EVOLVE, the teaching line counts down to the refit in six pips (*3 more
picks and it redraws your taste map.*). A pick counts from EVOLVE, TEACH in
PATCH, or an offer answered in PERFORM. Then:

1. On the sixth pick, the pips fill and the line reads *● learning from your
   last 6 picks…*. The sixth pick keeps its seven seconds to be taken back
   like any other, and the refit goes out when they’re up, or at once if you
   pick again first.
2. The amber lamp after the wordmark lights while the refit runs.
3. When it lands, the TASTE map is redrawn, and the line reads *● it just
   learned: see what changed ▸* until your next pick.

While a generation or a ⚡ walk is breeding, the line reads *● it will learn
from these 6 when breeding finishes* instead, because the refit waits for it.

```admonish info collapsible=true title="How it works: reweighting between refits"
The model holds 500 draws of your taste, each a full guess at it, and each new
answer reweights them by how well each one predicted it. As the weight
gathers on fewer and fewer of them, the model would start to claim more
certainty than it has, so it refits on a fixed count before that builds up.
The reference has [the fit and the reweighting](../reference/taste/posterior.html)
in full.
```

## Recency

Old answers fade, so your taste is allowed to change. An answer from about 150
answers ago counts half as much as your latest. A model that weighed an answer
from three sessions ago the same as one from a minute ago would fight you when
your taste moved.

<figure class="viz" data-viz="recency">
<figcaption><strong>How long what you told it keeps mattering.</strong> With a
half-life of 150, an answer from 300 answers back still carries a quarter of a
new one’s weight.</figcaption>
</figure>

```admonish info collapsible=true title="How it works: the half-life"
An answer $h$ places back in the log carries weight

$$w_h = 0.5^{\,h / 150}$$

so the weight halves every 150 answers.
```

## What moves the model most

Roughly in order:

1. **Picks between sounds that differ a lot.** The most information in one
   answer.
2. **The warm start.** Eighteen picks in half a minute. Running it again adds
   18 more.
3. **Picks it guessed wrong.** A surprise moves the model further than a
   confirmation.
4. **Stars, in volume.** Each one says less, but they are quick, and they set
   the scale that picks alone can’t pin down.
5. **Edits, kept as new.** These carry a lot: a change to the patch, and your
   verdict on it. Answered on the **WHICH WOULD YOU REACH FOR?** card, the
   verdict is heard, and picking the original teaches the most. Ticked as
   **PICK THE EDIT**, it is a claim. LEARNING grades the two apart.

## What it cannot learn

Worth knowing, so you don’t spend a session teaching something it can’t hear.

The model hears each sound through a fixed set of 44 measurements: 18 of the
standard render’s sound, and 26 counts of how the patch is built. **If a taste
of yours doesn’t show in those, no number of picks will teach it.** The
clearest case is stereo width. The model hears left and right summed, so it
will never learn that you like chorus for its width. The chorus module’s [spec
card](./wiring.md#the-spec-card) says so on its **heard** line.

Tastes about playing are mostly out of its hearing too: how a sound answers
velocity, or how it behaves in a fast run, because the phrase it hears is fixed
and modest. The reference spells out [what the phrase does and doesn’t
reveal](../reference/audition/phrase.html).

```admonish tip title="Check before you teach"
Before you spend a session teaching a taste, read the **heard** line on the
modules involved. If it says the model can’t hear it, believe it, and use
**save** and your own names instead.
```

## What to try next

- Rate a handful of sounds you wouldn’t reach for.
- Keep an edit as new, and pick the original when you prefer it: that teaches
  the most.
- [Reading what it learned](./reading-the-model.md) says how to read what all
  this taught it.
