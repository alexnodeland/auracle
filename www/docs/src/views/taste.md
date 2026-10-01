# TASTE: what it learned

<p class="lede">TASTE shows what the model has learned about your taste, in
four views: where your sounds sit, what your styles are, what each one leans
toward, and whether its guesses deserve your trust.</p>

<!-- film:view-taste --><!-- /film:view-taste -->

TASTE only shows; nothing here changes the model. The four tabs are **MAP**,
**STYLES**, **DIRECTIONS**, and **TRUST**, and each has a caption that says
what it draws.

1. Make a few picks in [EVOLVE](./evolve.md). TASTE fills in once the model
   first fits: at the sixth pick, or right after the warm start.
2. Open **TASTE**, and pick a tab.
3. Click a dot on the map to open that sound.
4. Name a style: click its name in the chips, and type.

Before the first fit, each tab says how far away it is, counted from where you
are. The map reads NOTHING PREDICTED YET. STYLES says *Your first style appears
at pick 6; more split off as you teach it.* TRUST counts guesses
instead (4 OF 20 GUESSES), because it grades the model once it has made 20.
Each tab’s button (**3 MORE PICKS →**, **16 TO GO →**) takes you to EVOLVE to
make them.

## The style chips

The chips above every tab are your styles. Each shows a name, its share of the
pool, and **▶**, which plays the sound that style rates highest.

A style is named for what it leans toward (*analog sustain*), until you name
it. Click the name and type; the name is kept, and every place the style
appears uses it. A refit keeps your name on the style it named, matched by what
each style listens for.

What a chip plays can change. It’s the sound in the pool that the style rates
highest today, so as the model learns and the pool changes, a different sound
can take its place.

## MAP

<figure>
<img src="../img/taste-map.webp" alt="A dark field scattered with amber dots of varying size and brightness, style chips above, and a legend below." loading="eager" width="1440" height="900">
<figcaption><strong>MAP.</strong> Every sound you have heard, placed by sound
and structure. Brighter means it thinks you’d like it more; bigger means it’s
less sure.</figcaption>
</figure>

Every sound you have heard, placed by sound and structure. The caption says how
to read it: *Brighter: it thinks you’d like it more. Bigger: it’s less sure.
Click a dot to open it.*

| What you see | What it means |
|---|---|
| **Glow** | How much it guesses you’d like the sound |
| **Size** | How unsure it is: bigger is less sure |
| **Color** | Which style rates the sound highest |

Size is the one people miss, and it’s the useful one. A big, dim dot is a
sound the model has no guess about. A small, bright dot is one it’s sure you’d
reach for. The legend’s two rings are the surest and least sure sizes on this
map, and before the first fit every dot is the same middling size.

Click a dot to open that sound as the one you’re playing. A dotted ring marks
the dot while it opens, and a solid one marks the sound you’re playing.

The footer says how much a flat picture can hold:

> *A flat view of 40 sounds: close dots usually sound alike (it shows 29% of
> how they differ).*

That is often a third or less, so read a distance as a hint, not a
measurement.

```admonish info collapsible=true title="How it works: the map’s axes"
The two axes are the two directions in which your sounds differ most (the
principal components of what the model measures). They are computed from the
sounds you have heard, so they turn slowly as the pool and your taste move.
The orientation is pinned, so the map doesn’t flip between one redraw and the
next: a place you recognize stays where you left it.

Dot sizes are spread over this map’s own range of doubt. Where the model is
about as sure of every sound, the dots come out about the same size, rather
than a contrast drawn from noise.
```

## STYLES

<figure>
<img src="../img/taste-styles.webp" alt="Three named styles stacked vertically, each with a share percentage and five horizontal amber bars naming what it leans toward." loading="lazy" width="1440" height="900">
<figcaption><strong>STYLES.</strong> Each style with its share of the pool and
the five qualities it leans on hardest. A style near 0% is idle.</figcaption>
</figure>

Your taste as separate styles, up to five. Each shows its name, its share of
the pool, and the five qualities it leans on hardest. They are drawn as
[DIRECTIONS](#directions) draws them: a solid bar when the model is sure, and
a hollow one, its label ending in **?**, while it’s still a guess.

Styles exist because taste isn’t one direction. You can like dark drones and
bright plucks, and one direction would average them into a taste for neither.
The model rates each sound by the style that likes it most, so a pick between
a drone and a pluck still says something.

Styles appear as the evidence comes in. Early on you’ll have one, and more
split off as the model finds what one style can’t explain. **A dim style
claiming almost none of the pool is idle.** Your taste has fewer sides than
the model has room for, which is common.

## DIRECTIONS

<figure>
<img src="../img/taste-directions.webp" alt="Named qualities down the left, horizontal amber bars extending left and right of a center line, each with a thinner whisker." loading="lazy" width="1440" height="900">
<figcaption><strong>DIRECTIONS.</strong> Which way each style leans on each
quality, with how far it could be off. A bar whose whisker crosses the center
line is a guess, and is drawn as one.</figcaption>
</figure>

What each style leans toward, quality by quality. The caption reads *Where each
style leans. Solid: it’s sure. Hollow: still a guess, and the thin line is how
far it could be off.*

Bar length is how hard the style leans, and the thin whisker across its end is
how far that could be off. Every bar is one of two marks:

- **Solid:** the whisker clears the center line. The model is sure which way
  this style leans, however short the bar.
- **Hollow,** a faint outline with the whisker at full strength: the whisker
  crosses the center line, so the lean could go either way. When no style is
  sure of a row, its label ends in **?** (*grit?*).

**Read the whiskers, not the bars.** A long hollow bar is a guess that happens
to point somewhere, and a short solid bar is a real, small lean. Early on
nearly every bar is hollow: the model is being honest about a few dozen picks.
The module rail in PATCH draws its bars with the same two marks.

The qualities have names you can hear or see in a patch: *chorus & sweeps*,
*drive & fold*, *body*, *amp attack*, *mod density*. Where one is what a
PERFORM control is made of, it carries that control’s word. *body* is weight
down low, *grit* is noisiness, *space* is the tail, and *snap* is the attack’s
peak. So the reasons the model gives and the controls you play say the same
thing.

```admonish info collapsible=true title="How it works: the whiskers"
Each bar is a coefficient of the model, and its whisker is one standard
deviation either way, drawn on the bar’s own scale. The widest whisker reaches
the edge of the panel; one that would run past it is cut there and ends in an
arrowhead, rather than drawn shorter than it is. What each quality measures is
[in the reference](../../reference/features/audio.html).
```

## TRUST: is its confidence honest?

<figure>
<img src="../img/taste-trust.webp" alt="A reliability diagram: dots plotted against a dashed diagonal labeled perfectly honest, each with a vertical whisker and a count, above lines of scores." loading="lazy" width="1440" height="900">
<figcaption><strong>TRUST.</strong> Its guesses against what you picked. On the
dashed diagonal, the model is exactly as sure as it deserves to be; the
whiskers say how little each dot stands on.</figcaption>
</figure>

TRUST is the tab that says whether to believe the other three.

Before every pick, the model guesses which sound you’ll pick and how sure it
is. Then your answer arrives. TRUST grades those guesses, all made before it
knew your answer:

- **The chart.** Across the bottom, *it said A would win this often*; up the
  side, *A actually won this often*. The dashed diagonal, *perfectly honest*,
  is where those agree. Each dot is a bucket of guesses, with its count (*n=7*)
  and a whisker for how much a bucket that size could wobble by chance. *dots
  inside their whisker are indistinguishable from honest*.
- **The first line.** The number of guesses, the Brier score, and the skill:
  *33 guesses · Brier 0.268 · not beating a coin flip yet (33 guesses)*, or
  *13% sharper than chance*.
- **The second line.** The same skill on the **fair-test picks**, the pairs
  dealt at random, which is every pair EVOLVE and PATCH deal you: *on 24
  fair-test picks: 13% sharper than chance, the number to trust*. Until there
  are 20, it counts toward them.
- **At the right,** once there is more than one kind, the skill by where the
  answer came from: *dealt pairs*, *edits you heard*, *edits you asserted*, and
  *offers you took or passed*.

The menu bar shows the same skill: *calibrating · 4/20* until 20 guesses,
then the number TRUST shows.

**“Not beating a coin flip yet” is the right thing to see early.** It means
the grading is honest and the model hasn’t had enough picks to beat chance.
Keep picking.

```admonish info collapsible=true title="How it works: why not accuracy"
Accuracy (how often the guess was right) would mislead here. A model that says
51% every time and is right 51% of the time scores the same as one that says
99% and is right 51% of the time. The Brier score is the mean squared error of
the guesses, so it rewards being sure only when being sure is earned. Always
saying 50% scores 0.25, and skill is measured against that: 0 is a coin flip,
and 1 is perfect.

Fair-test picks leave out the comparisons you chose yourself: a sound you kept
as new against its original, and PERFORM’s offers. A kept edit you heard and
one you asserted with **PICK THE EDIT** make the same claim in the log. There
is no reason to assume they are equally reliable, so they are graded apart. [Calibration](../../reference/taste/calibration.html) in the reference
has the math.
```

## What to try next

- Rename a style to what you’d call it, and watch the name appear in PATCH.
- Open a big, bright dot from the map: a sound the model guesses you’d like
  but isn’t sure of.
- [Reading what it learned](../reading-the-model.md) has the habits that keep
  you from over-reading a bar.
