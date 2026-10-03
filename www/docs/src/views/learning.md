# LEARNING: how it learns

<p class="lede">LEARNING is the model room: what the model weighs, which way
liking rises on the map, how its guesses have scored, your taste as JSON, and
the math behind all of it.</p>

LEARNING only shows; nothing here changes the model, except a style’s name.
It is the level above [TASTE](./taste.md), for when you want to see inside.

1. Make a few picks in [EVOLVE](./evolve.md). LEARNING fills in once the model
   first fits: at the sixth pick, or right after the warm start.
2. Go to **LEARNING**: its stop at the top of the levels, or <kbd>⌥5</kbd>.
3. Choose a style, read what it weighs, and name it.

The line under the title says what the model was fitted from (*From 18
picks.*), or how far its first fit is (*3 more picks and it fits your
taste.*).

## What it weighs

The model hears every sound as 44 numbers: 18 about how it sounds and 26 about
how its patch is built. For each style it holds one weight per number, and
WHAT IT WEIGHS shows them, largest first.

**The styles.** A chip for each style that claims at least 2% of the pool,
with its share. Click a chip to show its weights; a dot at the chip’s left
marks the one shown. Click its name and type to name it, and every place the
style appears uses your name; a refit keeps it on the style it named. **▶**
plays the sound that style rates highest today.

**The rows.** Each row is one quality: its name (*body*, *grit*, *drive &
fold*), the technical name beside it, a bar, and the weight.

- A bar to the right of the center line: it likes more of this. To the left:
  less.
- The thin line across the bar is how far the weight could be off, one
  standard deviation each way.
- **Solid:** that line clears the center. It is sure which way the style
  leans, however short the bar.
- **Hollow, with a ? in the margin:** the line crosses the center, so the
  lean could go either way. Early on nearly every row is hollow.

The bars move with every pick. A pick reweights the model’s draws, and after
each one LEARNING asks for the weights under the reweighted draws and moves
every bar to them; a refit, a generation or a file you open moves them too.

**Point at a weight** (or Tab to it) and the small map beside it shades every
sound by how much of that quality it has: brighter and larger for more,
dimmer for less. The legend names it (*dots: grit*).

**REPLAY** (or <kbd>R</kbd>) steps the bars through the moments this session
kept, one after another, and each bar moves to where that moment left it. The
label beside it says which moment: *after 21 picks* for a pick, *refit ·
after 24 picks* for a refit, and likewise a generation, an opened taste file,
a star or a cut. A step is credited to what it was. Only a step from one pick
to the very next draws where each bar was as a dashed outline and lights the
weight the pick moved most; a step across a refit, a generation or a file
says that it moved, and a step across moments that weren’t kept (a quick run
of picks keeps only the last one’s weights) says what moved since the moment
before. It ends on now, and starts from the first moment the session kept, as
TASTE’s track does.

On a narrow window the six that weigh most show, and **ALL 44 WEIGHTS** opens
the rest. Before the first fit there are none: *none yet: it weighs nothing
until it first fits*.

## Where liking rises

The pool on the map, each sound glowing by how much the model guesses you’d
like it, with the sound you’re playing ringed and named. The arrow is the way
liking rises across the map: a summary fit, made by the model, of each
sound’s liking on the map’s two axes, and the legend gives that fit’s r², how
much of the glow one direction explains (*the arrow: liking rises · explains
16%*). A low
share means your taste doesn’t lie along one line across this picture, which
is common: the map is flat, and your styles can pull different ways.

The arrow follows every pick. When a pick moves the ratings, it turns to its
new heading, and the old one stays a moment as a dashed line. Before the first
fit there is nothing to point along: *no direction yet*.

## Its forecasts

Before every pick between two sounds, the model writes down the chance it
gives each side. Then your answer arrives, and the forecast is scored against
it.

- **The count:** how many it guessed right, out of every forecast (*14 / 22*).
- **Under it:** what it expected against what it got (*expected 64% · was
  58%*). Expected is the average confidence it had in its own guesses; close
  to what it got means its confidence is honest.
- **The strip:** each forecast as the chance it gave the sound you picked,
  from 0% to 100%. Bright where it guessed right, dim where it guessed the
  other. The newest drops in as it lands.
- **The skill line:** *calibrating · 4/20*
  until it has 20 guesses, then how much sharper than a coin flip it has been
  (*13% sharper than chance*), on the fair-test picks once there are 20 of
  them.
- **By kind,** once there is more than one: *dealt pairs*, *edits you heard*,
  *edits you asserted*, *offers you took or passed*, each with its own skill.

Pairs in EVOLVE and PATCH’s strip, **KEEP AS NEW**’s comparison and PERFORM’s
offers are all forecast. Nothing is forecast before the first fit, so the warm
start’s picks have none, and after it the panel says *none yet: it guesses
before each pick from here* until your next pick.

```admonish info collapsible=true title="How it works: why skill, and not the count"
The count is accuracy, and accuracy alone would mislead. A model that says
51% every time and is right 51% of the time gets the same count as one that
says 99% and is right 51% of the time. That is why the count has *expected*
beside it, and why the skill line uses the Brier score: the mean squared error
of the forecasts, which rewards being sure only when being sure is earned.
Always saying 50% scores 0.25, and skill is measured against that: 0 is a coin
flip, and 1 is perfect.

Fair-test picks are the pairs dealt at random, which is every pair EVOLVE and
PATCH deal you: they grade its guesses without the model’s own choice of
question leaning on the answer. The comparisons you choose yourself (an edit
against its original, a PERFORM offer) are left out of them. [Calibration](../../reference/taste/calibration.html)
in the reference has the math.
```

## Copy as JSON

**COPY AS JSON** puts your taste’s data on the clipboard, as the engine posted
it: what it learned from, the math’s numbers, every style’s weights, every
sound’s rating, every forecast, and the calibration. Where the browser won’t
let a page write to the clipboard, the JSON appears in a box below to select
and copy. Nothing is downloaded; **Download your taste** in the ⋯ menu saves
the whole record as a file.

## The math

**THE MATH** opens the model in one line and five sentences, with every number
read from the engine:

> P(A over B) = σ(u(A) − u(B)),  u = max over styles of w · φ
>
> φ is a sound’s 18 audio and 26 structural features, standardized, and w
> holds one weight for each. A pick moves w along φ(picked) − φ(passed), so
> every sound’s rating moves at once, not only the two you heard. It holds 500
> draws of w. Each pick reweights them, and every 6 picks it fits them again.
> It is allowed one more style for every 20 things it learns from, up to 5. It
> rates a sound by the style that likes it most.

“Things it learns from” are what **TAUGHT** counts: picks, stars and cuts.
The [reference](../../reference/taste/utility.html) goes further.

## What to try next

- Name your largest style for what it leans on, then find the name in PATCH’s
  module rail.
- Make six picks, and watch a hollow row turn solid at the refit.
- Copy the JSON and look at a forecast: the chance it gave, and what you
  picked.
