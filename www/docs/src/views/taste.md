# TASTE — the model's mind

<p class="lede">Four views of one posterior: where your patches sit, what your
styles are, what each one listens for, and whether any of it should be
believed.</p>

TASTE is full-screen and read-only. Nothing here changes the model; it is the
model reporting on itself.

The **style chips** across the top are shared by all four tabs. Each carries a
generated name, its share of the bank, and a **▸** that auditions that style's
exemplar. Click a chip's name to rename it. The name persists and is used
everywhere the style is mentioned.

## MAP

<figure class="wide">
<img src="../img/taste-map.webp" alt="A dark field scattered with amber dots of varying size and brightness, three style chips above, and a legend reading less / would like and sure / unsure." loading="eager" width="1440" height="900">
</figure>

Every patch you have heard, placed by sound and structure. It is a 2D
projection (principal components of the feature space), and the footer tells
you how much of the variance those two axes capture, typically around half.
Worth knowing before you read too much into a distance.

| Channel | Means |
|---|---|
| **Glow** | Posterior mean utility — how much it thinks you would like it |
| **Size** | Posterior *uncertainty* — how sure it is |
| **Hue** | Which style lens claims it |

The size channel is easy to miss and it is the useful one. A big dim dot is *"I
have no idea about this"*. A small bright dot is *"I am confident you like
this"*. Early in a session everything is big; that is what a cold start looks
like.

Click any dot to open that patch on the workbench.

## STYLES

<figure class="wide">
<img src="../img/taste-styles.webp" alt="Three named style lenses stacked vertically, each with a pool-share percentage and five horizontal amber bars naming its strongest coordinates." loading="lazy" width="1440" height="900">
</figure>

Your taste as separate lenses. Each shows its name, the share of the bank it
claims, and its strongest coordinates.

This exists because **taste is not one direction.** You are allowed to like
dark drones *and* bright plucks, and a single linear model would average them
into a preference for neither. Auracle fits up to five lenses and scores every
patch as *its best lens's opinion*, so a duel across two islands is still a
well-formed comparison.

Lenses appear as evidence arrives. Early on you will have one; more separate
out as the model finds structure it cannot explain with fewer. **A dim lens
claiming almost none of the bank is idle.** Your taste has fewer islands than
the model has capacity for, which is common and not a fault.

## DIRECTIONS

<figure class="wide">
<img src="../img/taste-directions.webp" alt="A coefficient plot: named perceptual coordinates down the left, horizontal amber bars extending left and right of a centre line, each with a thinner whisker showing the credible interval." loading="lazy" width="1440" height="900">
</figure>

What each lens listens for, coordinate by coordinate. Bar length is the weight;
the thin whisker behind it is the credible interval.

**Read the whiskers, not the bars.** A long bar with a whisker that crosses the
centre line is a coefficient the model has not established: a guess that
happens to be pointing somewhere. A short bar with a tight whisker is a real,
small preference. Both are shown, because hiding the uncertainty is how a model
starts sounding more certain than it is.

The coordinates are named in perceptual and structural terms: *chorus &
sweeps*, *drive & fold*, *bass weight*, *amp attack*, *mod density*. What each
one measures is [in the reference](../../reference/features/audio.html).

## TRUST — is its confidence honest?

<figure class="wide">
<img src="../img/taste-trust.webp" alt="A reliability diagram: dots plotted against a dashed diagonal labelled perfectly honest, each with a vertical whisker and a sample count, above a line reading 33 forecasts, Brier 0.268, not beating a coin flip yet." loading="lazy" width="1440" height="900">
</figure>

This is the tab that makes the rest trustworthy.

Every duel is **forecast before you answer it.** The model commits to a
probability that A wins, then your answer arrives. Those are out-of-sample,
one-step-ahead predictions, and this diagram scores them: the dashed diagonal
is the model's claim, each dot is what happened at that confidence level, and
the whisker is how much a bucket that size could wobble by chance.

Underneath, the numbers:

- **Brier score.** Mean squared error of the forecasts. Lower is better; `0.25`
  is what always saying "50/50" scores. Reported as **skill** against that
  baseline, so `0` means no better than a coin and `1` means perfect.
- **check duels.** The same score restricted to the randomly-drawn probes. This
  is the number without an asterisk.
- **hit rate.** Kept so you can see how misleading it is.

```admonish note title="Why not just show accuracy"
Because accuracy is not a proper scoring rule, and here it would lie. A model
that says 0.51 every time and is right 51% of the time scores exactly like one
that says 0.99 and is right 51% of the time. Worse, an information-seeking
pairing rule *deliberately* asks near-ties, so the hit rate is pinned near 50%
by construction: a perfectly calibrated model would look like a coin flip and
you would conclude it had learned nothing. Brier skill moves when *sharpness*
improves, which is what you want to watch.
```

Split out at the right, the same scores by where the answer came from: dealt
duels, edits you heard, edits you only asserted. A hand edit you committed
after listening and one you committed by ticking *my edit is better* make the
same claim in the log, and there is no reason to assume they are equally
reliable. This is how you find out.

**"Not beating a coin flip yet (n=33)" is the correct thing to see early.** It
means the display is honest and you have not yet given it enough to work with.
Keep duelling.
