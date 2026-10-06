# Reading what it learned

<p class="lede">This page is about telling a real lean in your taste from a
bar that happens to point somewhere. It covers the habits that read the model
well, and what the app does to keep a guess looking like a guess.</p>

<!-- film:math -->
<figure class="film" id="film-math">
<video controls preload="none" playsinline poster="../assets/film/math.jpg">
<source src="../assets/film/math.mp4" type="video/mp4">
<track kind="captions" src="../assets/film/math.vtt" srclang="en" label="English" default>
</video>
<figcaption>For a technical audience: the taste model and the search as the code computes them, and why each piece has the form it does. <span class="film-len">2:46</span> · <a href="films.html#film-math">chapters and transcript</a></figcaption>
</figure>
<!-- /film:math -->

[TASTE](./views/taste.md) and [LEARNING](./views/learning.md) say what they
show. This page is about reading them well.

## Five states, and what each means

The app tells five states apart, and never lets two of them look alike. A
module’s spec card in PATCH's catalog says them in these words:

| The card says | It means |
|---|---|
| *Not a coordinate the taste model measures on its own.* | The model has no measurement for this, and never will |
| *The model hasn’t fitted your taste yet. Make a few picks.* | Nothing learned yet. Make some picks |
| *In 3 of 40 sounds: too few for the model to lean yet.* | Fewer than five sounds in the pool use it: too few to learn from |
| *In 6 of 40 sounds. Still a guess: it could lean either way (θ 0.05 ± 0.17, an interval that crosses zero).* | Enough sounds use it, and the model has looked, but it can’t yet tell which way you lean |
| *In 12 of 40 sounds. In analog sustain (60% of your pool), you lean toward it (θ +0.62 ± 0.20).* | Here is the lean, and how far to trust it |

The count is of sounds, each once, that use the module or another of its
family: a filter, an EQ, and a vocoder are one family to the model, so a
filter’s card counts the sounds with any of the three.

A dash is not zero. “The model isn’t sure yet” and “the model has had no
chance to form a view” are different statements, and one gray bar can’t say
both.

In the catalog, under the model view (hold <kbd>⌥</kbd>), *still a guess* is
a hollow bar whose whisker crosses zero, and a lean it’s sure of is a solid
bar. The three silences before them
are a dash. LEARNING’s weights draw the same two marks.

## Read the whisker, not the bar

This is the one habit worth keeping.

In [LEARNING’s weights](./views/learning.md#what-it-weighs), every bar has a
whisker for how far it could be off. **If the whisker crosses the center line,
the model hasn’t settled that lean.** The bar is a guess that happens to point
somewhere, and it will likely point elsewhere after ten more picks. The app
draws such a bar hollow, with its whisker at full strength, and marks the row
with a **?** in the margin. Only a whisker clear of the center line gets a
solid bar.

A short bar with a tight whisker is worth more than a long bar with a wide
one. The first is a small lean the model is sure of; the second is noise drawn
with confidence.

<figure class="viz" data-viz="interval">
<figcaption><strong>Drag the evidence slider.</strong> Early on every whisker
crosses zero, and the bars mean nothing even though they point somewhere. As
answers come in, the whiskers narrow and the leans clear zero one at a time.
Hollow bars, labeled with a <strong>?</strong>, are the ones that haven’t,
drawn as the app draws them.
</figcaption>
</figure>

The catalog’s bars follow the same logic, which is why they draw a dash
below five sounds that use the module or another of its family. A lean
learned from three examples would otherwise look the same as one learned from
three hundred.

## On the map, size is doubt

On the [TASTE map](./views/taste.md#reading-the-map), **glow** is how much it
guesses you’d like a sound, and **size** is how unsure it is. People read the
glow and miss the size.

- **Small and bright:** it’s sure you’d like it. Play it.
- **Big and bright:** you might love it. This is where to look.
- **Small and dim:** it’s sure it isn’t for you.
- **Big and dim:** it has no guess. Also worth a look, for another reason.

Early in a session every dot is big. That is what a cold start looks like, and
it’s why the first generation you breed isn’t very targeted.

Read the footer too (*it shows 29% of how they differ*). The two axes often
hold a third or less of how the sounds differ, so two dots close together
*usually* sound alike, and two far apart are *probably* different. It’s a
flat picture of something with more sides.

## Styles are leanings, not genres

A style is one direction your picks lean in. It isn’t a genre or a mood. Its
name (*analog sustain*, *driven sweeps*) describes what it leans toward in the
measurements, not the music.

Two things follow:

- **A style claiming almost none of the pool is idle.** The model has room for
  up to five and lets your answers decide how many it uses. Two live styles and
  three idle ones isn’t a fault: your taste, as these measurements hear it, has
  two sides.
- **You can rename them, and it helps.** Click a chip’s name in LEARNING and
  type. Once a style is called what you’d call it, every place it appears
  reads at a glance, and the name is kept.

## The model view

Hold <kbd>⌥</kbd> (Alt off Apple platforms) for a moment, at any level, and
what the model believes comes up over it; let go and it goes. Press and hold
**MODEL** in the menu bar for the same, or tap it to keep the view up until
you tap it again or press <kbd>Esc</kbd> with nothing nearer to close: a press
closes the nearest thing first (a menu, a panel, PERFORM’s XY, a sound’s card
on TASTE’s map, the module you selected in PATCH), and the view goes on the
press after. A tapped view is still up after a reload. Its light is lit while the view is
up, and a tag under the menu bar says what it is reading from: *what it
believes, from 18 picks*, or *still guessing · 4 more picks and it fits*
before its first fit. A key pressed while you hold <kbd>⌥</kbd> (a level key
such as <kbd>⌥↑</kbd>) is that key, and the view doesn’t come up; in a text
field or under a dialog <kbd>⌥</kbd> is left alone.

It shows only what the engine has:

- **The bank:** each row’s guess, a percentage and a bar (below), and the pool
  in the order the model rates it, which the rows glide into and back out of.
- **TASTE:** the halos, and the map’s TASTE side, as if you had switched the
  toggle; dashed rings before the first fit, when there is no rating to draw.
- **EVOLVE:** its guess for the pair on the table before you pick, on the card
  it favours (*it guesses this · 62% · leaning*), and each card’s
  [style](#styles-are-leanings-not-genres). The guess is the same one the line
  after your pick reads, asked again if the model refits before you pick.
- **PATCH:** the belief line in place of the subtitle (*it’d like this 62% ·
  leaning · was 58% ▲*), what adds up to it in the readout at the well's
  foot, what the model makes of the selected module's family, each module's
  edge tinted by which way your taste leans on its family, a chip per family
  with what one more is worth, and the guess's two runners-up with their
  lower bounds ([the model view in PATCH](./views/play.md#the-model-view-in-patch)).
- **PERFORM:** which way your taste leans along each control, from the sound
  in your hands: an amber arc toward the end it leans to, and *it leans
  bright* under the control; dashed, with a **?**, while it is still a guess
  ([which way your taste leans](./views/perform.md#which-way-your-taste-leans)).
  Nothing before the first fit.

## The guess on a bank row

Under the model view, each bank row shows the model’s guess. The percentage is
roughly how likely you are to pick this sound in a pair. On its own, a sure
80% and an unsure 80% print the same number.

The bar under the row tells them apart. Its bright tick is the same guess, and
the dimmer block around it shows the doubt: a narrow block is a sure guess, a
wide one an unsure guess. The map’s dot sizes say the same at more length. The
row is a way to rank sounds, not a measurement.

## Its forecasts, over time

[LEARNING’s forecasts](./views/learning.md#its-forecasts) say whether the
rest deserves belief. A realistic course:

| Stage | What the forecasts say |
|---|---|
| A first session, under 20 picks | The skill counts toward 20 guesses, then *not beating a coin flip yet*. That is expected |
| 20 to 60 picks | Skill crosses zero and wobbles. A handful of misses moves it a lot |
| Beyond that | Skill climbs, and *expected* and *was* come close together |

Two shapes are worth recognizing:

- **Expected well above was.** It is overconfident: when it says 80%, it’s
  right less often than that. It has usually latched onto a quality that was
  a coincidence. More picks fix it, especially ones you expect to surprise
  it.
- **Skill stuck near zero after many picks.** Either your taste doesn’t show in
  what the model measures (see [what it can’t
  learn](./teaching.md#what-it-cannot-learn)), or your answers vary, which
  happens: some days you aren’t choosing on one quality.

The number to watch is the skill on **fair-test picks**, the line that ends
*the number to trust*. Fair-test picks are the pairs dealt at random, which is
every pair EVOLVE and PATCH deal you. The overall number also counts
comparisons you chose yourself (an edit against its original, a PERFORM
offer), and those aren’t a fair sample.

```admonish note title="Why a low score early is the honest one"
Auracle makes its guess about every pick before you pick, then grades its own
error. A score made that way can come out badly, and early on it does. That is
what makes it worth reading later.
```

## When it’s working

You’ll hear it before the numbers say so:

- More pairs hold two sounds you’d reach for. The pairs are still dealt at
  random; it’s the pool that has grown toward you.
- Generations bring children you want to keep, not ones you skip.
- The guess above the rack in PATCH names your own reason for liking a sound.
- A style’s name is one you’d have written yourself.

That last one is the real milestone.

## What to try next

- Open LEARNING, and count the solid bars. Those are the leans the model is
  sure of.
- Open a big, bright dot from the map.
- [Calibration](../reference/taste/calibration.html) in the reference has the
  scoring in full.
