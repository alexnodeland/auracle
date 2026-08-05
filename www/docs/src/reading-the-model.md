# Reading what it learned

<p class="lede">How to tell a real preference from a coefficient that happens to
be pointing somewhere.</p>

The [TASTE view](./views/taste.md) documents what each tab shows. This page is
about reading it well — the interpretation mistakes that are easy to make, and how
the interface tries to stop you making them.

## Three silences, and what each means

The instrument distinguishes four states, and never lets two of them look alike:

| It says | It means |
|---|---|
| *not measured* | The feature vector has no coordinate for this. It never will |
| *not fitted* | No posterior yet. Answer some duels |
| *too few examples* | Fewer than five patches in the pool use it. Not enough to fit a coefficient |
| a value **± an interval** | Here is the belief, and here is how much to trust it |

A dash is not zero. "The model is indifferent to this" and "the model has never
had a chance to form a view" are opposite statements, and collapsing them into one
grey bar is how instrumentation starts lying.

## Read the interval, not the bar

The single most useful habit.

In [DIRECTIONS](./views/taste.md#directions), every coefficient is drawn with a
credible interval behind it. **If the interval crosses the centre line, the model
has not established that coordinate** — the bar is a guess that happens to point
somewhere, and it will likely point elsewhere after ten more duels.

A short bar with a tight interval is worth more than a long bar with a wide one.
The former is a small preference the model is sure of; the latter is noise with
confidence.

<figure class="viz" data-viz="interval">
<figcaption><strong>Drag the evidence slider.</strong> Early on every interval
straddles zero, and the bars — which <em>are</em> pointing somewhere — mean nothing
individually. As observations accumulate the intervals narrow and coefficients
start clearing zero one at a time. Red whiskers are the ones that have not.
</figcaption>
</figure>

The same logic runs the node bank's θ bars, which is why they draw a dash below
five supporting patches: a coefficient fitted from three examples, rendered beside
one fitted from three hundred, is a misleading comparison presented as a fair one.

## Size on the map is uncertainty

On the [MAP](./views/taste.md#map), **glow** is how much it thinks you would like a
patch and **size** is how unsure it is. People read glow and ignore size.

- **Small and bright** — confident it is good. Worth playing.
- **Big and bright** — it *might* be excellent. This is where to explore.
- **Small and dim** — confident it is not for you.
- **Big and dim** — it knows nothing. Also worth exploring, for a different
  reason.

Early in a session everything is big. That is what a cold start looks like, and it
is why the first generation you breed is not very targeted.

Also read the variance footer: the two axes typically capture around half the
variation in the feature space, so two dots close together are *probably* similar
and two far apart are *probably* different. It is a projection, not a map of the
territory.

## Styles are lenses, not genres

A style lens is a direction in feature space that explains some of your answers.
It is not a genre and it is not a mood, and the generated names — *drive & fold +
chorus*, *dynamics + plucked strings* — are descriptions of coefficients, not
claims about music.

Two things follow:

- **A lens claiming almost none of the bank is idle.** The model fits up to five
  and lets the data decide how many are actually used. Having two live lenses and
  three idle ones is not a failure; it means your taste, as measured by these
  coordinates, has two islands.
- **You can rename them, and should.** Click a chip's name. Once *"drive & fold +
  chorus"* is *"the mean one"*, every place the style appears becomes readable at a
  glance. The name is yours and it persists.

## The prediction on a bank row

The percentage is roughly "how likely you are to prefer this patch in a duel
against an average pool member". It is a posterior mean, so it already accounts
for the model's uncertainty by averaging over it — which means a confident 80% and
an unsure 80% look identical here.

If you want the uncertainty, that is what the map's size channel and the belief
row's interval are for. The row is a ranking aid, not a measurement.

## Trust, and what to expect over time

[TRUST](./views/taste.md#trust--is-its-confidence-honest) is the tab that decides
whether any of the others deserve belief. A realistic trajectory:

| Stage | What TRUST says |
|---|---|
| First session, < 20 picks | *Not beating a coin flip.* Correct and expected |
| 20–60 picks | Skill crosses zero and wobbles. Buckets too small to read |
| Beyond that | Skill climbs; dots settle near the diagonal |

Two failure shapes worth recognising:

- **Dots consistently below the diagonal on the right** — it is overconfident: when
  it says 80% it is right less often than that. Usually a sign it has locked onto
  a coordinate that was coincidental. More duels, especially ones you expect to
  surprise it, is the fix.
- **Skill stuck near zero with many observations** — either your preference is
  genuinely not visible in the feature space (see
  [what it cannot learn](./teaching.md#what-it-cannot-learn)), or your answers are
  inconsistent, which is a real thing and not a criticism: some days you are not
  choosing on one axis.

And the number to actually watch is **check-duel skill**, not overall skill. The
overall number is measured on questions the model helped choose; the check duels
are drawn at random and are the only ones that mean what they say without
qualification.

```admonish note title="Why a low score early is a feature"
Almost every system that claims to learn your preferences shows you a confidence
number it cannot justify. Auracle forecasts every duel *before* you answer it and
then reports its own error against a proper scoring rule, which means it is capable
of publicly failing. That is the price of the number meaning anything at all.
```

## When it is working

You will notice it before the numbers say so:

- The duels get **harder** — both candidates are plausible.
- Generations produce children you want to keep rather than children you want to
  skip.
- The belief row's explanation matches your own reason for liking a patch.
- A style chip's name is one you would have written yourself.

That last one is the real milestone. When the model names an island of your taste
in words you recognise, it has learned something rather than merely fitted
something.
