# Auracle

<p class="lede">A synthesizer that grows toward you. Pick the sound you&rsquo;d reach
for. It learns your ear, and every generation grows a little closer.</p>

<!-- film:launch -->
<figure class="film" id="film-launch">
<video controls preload="none" playsinline poster="../assets/film/launch.jpg">
<source src="../assets/film/launch.mp4" type="video/mp4">
<track kind="captions" src="../assets/film/launch.vtt" srclang="en" label="English" default>
</video>
<figcaption>The launch film: what Auracle is, what it feels like to play, and what is underneath. <span class="film-len">1:38</span> · <a href="films.html#film-launch">chapters and transcript</a></figcaption>
</figure>
<!-- /film:launch -->

Auracle is a modular synthesizer you play in the browser. Pick between two
sounds, and it learns what you like, breeds new sounds toward it, and shows you
what it learned. Every sound is a patch you can open and change.

This guide is for playing it: each page is one view or one task, and says what
to do and what you’ll see. The [reference](../reference/) is for how it works,
with the math.

It’s a synthesizer first. Four voices, a keybed, MIDI, an arpeggiator, and a
rack of 42 modules with typed cables. You can play it without teaching it
anything.

<figure>
<img src="./img/play.webp" alt="The PATCH view: the bank on the left, an eight-module rack wired with green audio cables and amber modulation cables, the module rail on the right, and a keybed along the bottom." loading="eager" width="1440" height="900">
<figcaption><strong>PATCH.</strong> The sound you’re playing, opened as a rack
you can turn, rewire, and lock, live while you edit it.</figcaption>
</figure>

## What it does

- **Every sound is a real patch.** Each one is built from typed modules and
  cables, so every change breeding or your hands make leaves a patch that still
  plays. There is no crossover: every child grows from one seed.
- **It learns your taste, and says how sure it is.** Your taste can have
  several sides, each a *style*, so you can like unrelated sounds at once.
  Before every pick it guesses which you’ll pick, and
  [TRUST](./views/taste.md#trust-is-its-confidence-honest) grades those
  guesses.
- **New sounds grow toward you.** What the model learns shapes where breeding
  steps, not only what it keeps. Lock the parts you love, and breeding leaves
  them alone.
- **What you play is what it heard.** The patch you play live is the same one
  that was bred, checked, and measured.

## The four views

| View | Shows | What you do there |
|---|---|---|
| **PERFORM** | The sound | Play it with controls named for what you hear, let it wander, and hear offers |
| **PATCH** | The patch | Hear it, play it, turn its knobs, rewire it, and lock what you like |
| **EVOLVE** | The question | Pick the one of two sounds you’d reach for, and breed |
| **TASTE** | What it learned | Your styles, how sure it is, and whether its guesses have been right |

PERFORM is where you play, EVOLVE is where you teach, and PATCH is where you
open the sound up. TASTE is where you see whether it’s learning.

```admonish tip title="The whole loop"
1. Pick the three you’d reach for when the warm start asks.
2. Pick between pairs in EVOLVE, a dozen or so.
3. Press **EVOLVE POOL**, and play what it bred.
```

## What to expect

Auracle is pre-1.0. The instrument plays for hours, and the taste loop runs end
to end, but:

- **It takes picks to learn.** A handful of picks isn’t a taste yet. The first
  useful generations come after a dozen or two, and sure ones later. From
  nothing it would take hundreds, which is why the [warm
  start](./teaching.md#the-warm-start) exists.
- **It says when it doesn’t know.** Early on, TRUST will say *not beating a
  coin flip yet*. That is the grading working.
- **The saved format may change between versions.** Your session lives in your
  browser and older ones are upgraded, but [download anything you care
  about](./your-data.md#download-and-open).
- **Desktop only, for now.** A phone gets a screen asking for a desktop
  instead; see [browser
  support](./getting-started/running-locally.md#browser-support).

## Where to go next

- New to it: [your first session](./getting-started/first-session.md).
- Running it yourself, or offline: [running it
  yourself](./getting-started/running-locally.md).
- Already playing, and want the keys: [keyboard and MIDI](./keyboard.md).
- How it works: [the reference](../reference/).
- Something’s wrong: [troubleshooting](./troubleshooting.md).
