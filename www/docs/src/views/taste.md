# TASTE: the sound among all sounds

<p class="lede">TASTE is the map of your pool: every sound placed by how it
sounds, with an amber glow for how much the model guesses you’d like it. Each
pick draws as an arrow, and every glow moves with it.</p>

<!-- film:view-taste --><!-- /film:view-taste -->

TASTE only shows; nothing here changes the model. What it has learned in
detail (the weights, which way liking rises, how its guesses have scored) is
one level up, in [LEARNING](./learning.md).

1. Make a few picks in [EVOLVE](./evolve.md). The glows light once the model
   first fits: at the sixth pick, or right after the warm start.
2. Open **TASTE**.
3. Point at a sound to see its card, and click it to open it.

The line under the title says what the map is drawn from: *From 18 picks.*,
or before the first fit, how far away it is (*3 more picks and it fits your
taste.*).

## Reading the map

| What you see | What it means |
|---|---|
| **Place** | Where the sound sits among the others: close sounds usually sound alike |
| **Amber glow** | How much it guesses you’d like the sound: brighter and wider is more |
| **Dot size** | How unsure it is: bigger is less sure |
| **Dashed ring** | No guess yet: before the first fit, every glow is a dashed ring |
| **Green ring** | The sound you’re playing |
| **Dotted ring** | A sound on its way to you, after a click |

The legend at the top right says which you are looking at: *it likes more*
beside two glows, or *still a guess* beside a dashed ring.

Size is the one people miss, and it’s the useful one. A big, dim dot is a
sound the model has no guess about. A small, bright one is a sound it’s sure
you’d reach for. The sizes are spread over this map’s own range of doubt, and
before the first fit every dot is the same middling size.

The footer says how much a flat picture can hold:

> *A flat view of 40 sounds: close dots usually sound alike (it shows 31% of
> how they differ).*

That is often a third or less, so read a distance as a hint, not a
measurement.

## A sound’s card

Point at a sound and its card opens beside it: the sound’s name, how much the
model guesses you’d like it (*would like: 59% · leaning*), **▶ PLAY**, which
plays its phrase, and **OPEN**, which opens it as the sound you’re playing.

Clicking a sound opens it too. A dotted ring marks it while it opens, and the
green ring moves to it when it’s yours.

The card’s percentage is the model’s rating after your last pick. The bank’s
rows show the rating from the last refit, so between refits the two can
differ.

From the keyboard: Tab to the map, then the arrow keys move to the nearest
sound in that direction, <kbd>Enter</kbd> opens it, and <kbd>Esc</kbd> closes
its card. <kbd>Space</kbd> plays the sound you’re playing, as it does in
every view.

## A pick, drawn as what it teaches

When you pick between two sounds, TASTE draws an arrow from the sound you
passed to the sound you picked, and every glow on the map moves at once.

Every glow moves because a pick is not only about the two sounds you heard.
The model learns which way your taste leans, along the difference between the
two, so its rating of every sound moves with it: the ones that differ the same
way rise, and the ones that differ the other way fall.

- **When.** The arrow appears when the pick reaches the model, as its
  seven-second undo window closes. Picks you made while TASTE wasn’t showing
  are drawn in turn when you open it, up to the last six.
- **Stars and cuts** move the glows without an arrow: they rate one sound,
  not a direction between two.
- **A PERFORM offer** you took or passed moves the glows too, but draws no
  arrow: an offer never joins the pool, so it has no place on the map.

The arrow stays a moment and goes. With reduced motion set on your system it
appears whole, stays as long, and goes, and the glows step to their new
brightness rather than easing there.

## A refit settles everything

Every sixth pick the model fits your taste again from everything it has
learned. Then the map is drawn again, and every glow and every place settles
to the new one together. The map turns rather than flips: a place you
recognize stays near where you left it.

```admonish info collapsible=true title="How it works: the map"
Each sound’s place starts from the two directions in which your sounds differ
most: the principal components of what the model measures, computed from the
pool and the sounds you have heard. Their orientation is pinned from one
redraw to the next. Each axis is then pulled about halfway toward its ranks,
which opens the crowded middle while keeping every sound’s order along both
axes, and marks that would sit on each other are nudged apart.

The glow is the logistic of the model’s average rating of the sound, the same
number as the percentage on its card. After a pick, that is the rating under
the model’s draws reweighted by the pick, which the engine posts with its
reply to the pick. The dot’s size is how far that rating could be off.
```

## What to try next

- Open a big, bright dot: a sound the model guesses you’d like but isn’t sure
  of.
- Make a pick in EVOLVE, then open TASTE, and watch which way the glows move.
- [LEARNING](./learning.md) shows what it weighs to make those guesses, and
  [Reading what it learned](../reading-the-model.md) has the habits that keep
  you from over-reading it.
