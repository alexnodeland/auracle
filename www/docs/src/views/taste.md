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
2. Go to **TASTE**: its stop above PERFORM’s, <kbd>⌥↑</kbd> from PERFORM, or
   <kbd>⌥4</kbd> ([the levels](../levels.md)).
3. Point at a sound to see its card, and click it to open it.

On the way, the face of the sound you’re playing flies to its mark on the
map. A sound that isn’t on the map as it is (one you have edited since you
opened it) has no mark to fly to, and its face fades as you go.

The line under the title says what the map is drawn from: *From 18 picks.*,
or before the first fit, how far away it is (*3 more picks and it fits your
taste.*).

## Reading the map

| What you see | What it means |
|---|---|
| **Place** | Where the sound sits among the others: close sounds usually sound alike |
| **Amber glow** | How much it guesses you’d like the sound: brighter and wider is more |
| **The sound's mark** | Its [face](../faces.md), or a dot until the face arrives. The face of the sound you’re playing lights up while you play it |
| **Mark size** | How unsure it is: bigger is less sure |
| **Dashed ring** | No guess yet: before the first fit, and after you open a taste file until its fit lands, with **TASTE** on, every glow is a dashed ring |
| **Green ring** | The sound you’re playing |
| **Dotted ring** | A sound on its way to you, after a click |

The legend at the top right says which you are looking at: *it likes more*
beside two glows, or *still a guess* beside a dashed ring.

## SOUND and TASTE

The switch at the map’s top left chooses how the sounds are shown.

- **SOUND**, the default, shows the sounds as they are. Once the model has
  fitted, their glows show too; before that, there are none.
- **TASTE** colors the map by what the model thinks you’d like: every sound
  is dimmed by how little it is liked, so the ones it guesses you’d reach for
  stand out. Before the first fit it shows every glow as a dashed ring, a
  guess.

Holding <kbd>⌥</kbd> for [the model view](../reading-the-model.md#the-model-view)
switches the map to its **TASTE** side while you hold it (or while **MODEL**
is tapped on), and back to where you left the switch when it goes. While the
view is up the switch rests, dimmed, and its tooltip says why.

Size is the one people miss, and it’s the useful one. A big, dim face is a
sound the model has no guess about. A small, bright one is a sound it’s sure
you’d reach for. The sizes are spread over this map’s own range of doubt, and
before the first fit every face is the same middling size.

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
rows, under the model view, show the rating from the last refit, so between
refits the two can differ.

From the keyboard: Tab to the map, then the arrow keys move to the nearest
sound in that direction, <kbd>Enter</kbd> opens it, and <kbd>Esc</kbd> closes
its card. <kbd>Space</kbd> plays the sound you’re playing, as it does at
every level.

## Taste over time

Once there are two moments to move between, a track runs along the map’s
foot. Each tick is one moment: amber for a pick (thin and dim before the
first fit), a short silk tick below the line for a star or a cut, a faint line
where the map was redrawn, a green diamond for a generation, with how many
sounds joined (*+3*), and a bright full-height line where you opened a taste
file. The label says which moment the map shows: *now · after 26 picks* at
the right-hand end, counting your picks as the title does; an earlier moment
counts the picks the model had taken then.

1. Drag along the track, or click it, to look back. The line under the title
   reads *Looking back.*, and the map shows the glows and places as the
   model had them then. Stepping one moment at a time draws that moment’s
   pick as its arrow (reversed when you step back past it); a jump draws
   none.
2. With the track focused, <kbd>←</kbd> and <kbd>→</kbd> step one moment,
   and <kbd>Home</kbd> and <kbd>End</kbd> go to the first and to now.
3. **▶** at the track’s left replays every moment in turn, from the first.

The track shows exactly what the model posted at each moment, because the
page keeps each reply as it arrives: the model itself keeps no history of its
ratings. The track begins when this session began keeping it, so a session
from before this version starts its track at its first load since. It holds
the last 200 moments and is saved with your session; a reset clears it.

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
recognize stays near where you left it. If your pointer is on the map when
the refit lands, it waits until you move off it, or rest a second, so
nothing moves under your hand.

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

## In ⌘K

At TASTE, [⌘K’s list](../levels.md#k-find-anything) starts with THIS LEVEL:
*Color by taste* (it says *on* while the map is colored by taste) and
*Replay how your taste moved*, the track’s ▶.

## What to try next

- Open a big, bright dot: a sound the model guesses you’d like but isn’t sure
  of.
- Make a pick in EVOLVE, then open TASTE, and watch which way the glows move.
- [LEARNING](./learning.md) shows what it weighs to make those guesses, and
  [Reading what it learned](../reading-the-model.md) has the habits that keep
  you from over-reading it.
