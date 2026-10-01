# TASTE — the model's mind

<p class="lede">Four views of one posterior: where your patches sit, what your
styles are, what each one listens for, and whether any of it should be
believed.</p>

<!-- film:view-taste --><!-- /film:view-taste -->

TASTE is full-screen and read-only. Nothing here changes the model; it is the
model reporting on itself.

Before the first fit each tab says how far away it is, counted from where you
are: *"1 more pick →"*, *"Your first style appears at pick 6; more split off as
you teach it."* TRUST counts guesses instead of picks: before each pick the
model guesses which you will pick, and after 20 guesses it grades itself
(*"14 to go →"*). Each button takes you to EVOLVE to make them.

The **style chips** across the top are shared by all four tabs. Each carries a
generated name, its share of the bank, and a **▸** that auditions that style's
exemplar. Click a chip's name to rename it. The name persists and is used
everywhere the style is mentioned, and a refit keeps it on the style it named:
each new fit's styles are matched to the last fit's by what they listen for.
What can change is the style's exemplar. It is the patch in the bank that best
fits the style today, so as the model learns, and as the bank changes, a
different patch can become its best example, and a favourite that pleases
more than one style can turn up as another's.

## MAP

<figure>
<img src="../img/taste-map.webp" alt="A dark field scattered with amber dots of varying size and brightness, three style chips above, and a legend reading less / would like and sure / unsure." loading="eager" width="1440" height="900">
<figcaption><strong>MAP.</strong> Every patch you have heard, placed by sound
and structure. Glow is how much it thinks you would like it; size is how sure
it is.</figcaption>
</figure>

Every patch you have heard, placed by sound and structure. It is a 2D
projection (principal components of the feature space), and the footer says
how much of the difference between the patches those two axes can show: *"A
flat view of 40 patches — close dots usually sound alike (it shows 29% of how
they differ)."* In practice that is often a third or less (29–32% in the
sessions we measured), so read a distance as a hint, not a measurement.

The orientation is pinned, so the map does not mirror itself between one
recompute and the next — somewhere you recognise stays where you left it. The
axes themselves still turn slowly as your taste and the bank move, because they
are computed from the patches you have actually heard.

| Channel | Means |
|---|---|
| **Glow** | Posterior mean utility — how much it thinks you would like it |
| **Size** | Posterior *uncertainty* — how sure it is |
| **Hue** | Which style claims it |

The size channel is easy to miss and it is the useful one. A big dim dot is *"I
have no idea about this"*. A small bright dot is *"I am confident you like
this"*. Sizes are spread over the map's own range of uncertainty: the patches
it is surest about are the smallest dots, the ones it knows least about the
largest, and the legend's two rings are those two sizes. Where it is about as
sure of every patch as of any other, the dots come out about the same size
rather than a contrast drawn from noise. Before the first refit there is no
uncertainty to draw, and every dot is the same middling size.

The caption says the same in short: *"Brighter: it thinks you’d like it more.
Bigger: it’s less sure. Click a dot to open it."* Click any dot to open that
sound as the one you're playing. A dotted ring marks the dot while it opens, and a
solid one the patch you are playing. Opening says nothing unless it keeps you
waiting more than a second; then a toast says *Opened* and the patch's name
when it arrives.

## STYLES

<figure>
<img src="../img/taste-styles.webp" alt="Three named style lenses stacked vertically, each with a pool-share percentage and five horizontal amber bars naming its strongest coordinates." loading="lazy" width="1440" height="900">
<figcaption><strong>STYLES.</strong> Each style with the share of the pool it
claims and the five coordinates it weights hardest. A style at ≈0% is idle.</figcaption>
</figure>

Your taste as separate styles. Each shows its name, the share of the bank it
claims, and the five coordinates it leans on hardest, drawn with the same mark
as [DIRECTIONS](#directions): a solid bar when the model is sure, a hollow one,
its label ending in **?**, while it is still a guess.

This exists because **taste is not one direction.** You are allowed to like
dark drones *and* bright plucks, and a single linear model would average them
into a preference for neither. Auracle fits up to five styles and scores every
patch as *its best style's opinion*, so a duel across two islands is still a
well-formed comparison.

Styles appear as evidence arrives. Early on you will have one; more separate
out as the model finds structure it cannot explain with fewer. **A dim style
claiming almost none of the bank is idle.** Your taste has fewer islands than
the model has capacity for, which is common and not a fault.

## DIRECTIONS

<figure>
<img src="../img/taste-directions.webp" alt="A coefficient plot: named perceptual coordinates down the left, horizontal amber bars extending left and right of a centre line, each with a thinner whisker showing the credible interval." loading="lazy" width="1440" height="900">
<figcaption><strong>DIRECTIONS.</strong> Every coefficient with its credible
interval. A long bar whose whisker crosses the centre line is a guess, and the
display says so.</figcaption>
</figure>

What each style listens for, coordinate by coordinate. The caption reads
*"Where each style leans. Solid: it’s sure. Hollow: still a guess, and the thin
line is how far it could be off."* Bar length is the weight; the thin whisker
across its end is the credible interval, ±1σ, drawn on the same scale as the
bar. The widest interval reaches the edge of the panel; a whisker that would
run past it is cut there and ends in an arrowhead, rather than being drawn
shorter than it is.

Every bar is one of two marks:

- **Solid**: the interval clears the centre line. The model is sure which way
  this style leans, however short the bar.
- **Hollow**, a faint outline with the whisker drawn at full strength: the
  interval crosses the centre line, so the lean could be either way. When no
  style is sure of a row, its label ends in **?** (*grit?*).

**Read the whiskers, not the bars.** A long hollow bar is a guess that happens
to be pointing somewhere. A short solid bar is a real, small preference. Early
on nearly every bar is hollow; that is the model being honest about a few
dozen picks. The module rail in PATCH draws its θ bars with the same two marks.

The coordinates are named in perceptual and structural terms: *chorus &
sweeps*, *drive & fold*, *body*, *amp attack*, *mod density*. Where a
coordinate is what one of PERFORM's controls is made of, it carries that
control's word: *body* is bass weight, *grit* is spectral flatness, *space* is
the tail, *snap* is the crest. The reasons the model gives and the knobs you
play say the same thing. What each coordinate measures is
[in the reference](../../reference/features/audio.html).

## TRUST — is its confidence honest?

<figure>
<img src="../img/taste-trust.webp" alt="A reliability diagram: dots plotted against a dashed diagonal labelled perfectly honest, each with a vertical whisker and a sample count, above a line reading 33 forecasts, Brier 0.268, not beating a coin flip yet." loading="lazy" width="1440" height="900">
<figcaption><strong>TRUST.</strong> Forecasts against outcomes. On the dashed
diagonal the model is exactly as confident as it deserves to be; the whiskers
say how little each dot is standing on.</figcaption>
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
- **fair-test picks.** The same score on the duels that were dealt at random,
  which under the default pairing is every duel EVOLVE and PATCH deal you:
  only the forecasts for your edits and for PERFORM's offers are left out,
  since you chose those comparisons yourself. This is the number without an
  asterisk. (Under the information-seeking pairing it is the one duel in ten
  dealt at random as a check.)
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
duels, edits you heard, edits you only asserted, and offers you took or passed
in PERFORM. A hand edit you kept as new
after listening and one you kept by ticking *pick the edit* make the
same claim in the log, and there is no reason to assume they are equally
reliable. This is how you find out.

**"Not beating a coin flip yet (33 guesses)" is the correct thing to see early.** It
means the display is honest and you have not yet given it enough to work with.
Keep duelling.
