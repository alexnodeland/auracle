# Auracle

<p class="lede">A playable modular synthesizer that learns what you like, and can
show you what it learned.</p>

Auracle generates patches by evolutionary search, plays them to you, and asks
which one you prefer. From your answers it fits a model of your taste — an
actual statistical model, with uncertainty, that you can inspect — and then uses
it to steer the search. Over a session it stops guessing and starts proposing.

It is also, plainly, a synthesizer. Four-voice polyphony, a keyboard, MIDI, an
arpeggiator, a patchable rack with typed cables and forty-one modules. You can
ignore the model entirely and play it like an instrument.

<figure class="wide">
<img src="./img/play.webp" alt="The PLAY view: a patch bank on the left, an eight-module rack wired with green audio cables and amber modulation cables, the node bank catalogue on the right, and a keyboard docked along the bottom." loading="eager" width="1440" height="900">
<figcaption><strong>PLAY.</strong> The current patch as a rack you can turn,
rewire and lock — running live in an audio worklet while you edit it.</figcaption>
</figure>

## What makes it different

Sound design tools usually make you choose. **Presets and randomizers** are fast
and shallow: you audition until something works, and nothing accumulates.
**Patching from scratch** is deep and slow. Genetic-algorithm synths tried to
bridge the gap with star-a-generation workflows, but they forget everything
between sessions and cannot tell you why they suggest what they suggest.

Auracle treats the problem as inference instead:

- **Every patch is a term in a typed grammar.** Not a bag of parameters — a
  tree, whose types are signal kinds. That is why every mutation, every
  crossover and every edit you make by hand is still a valid, playable patch.
  Illegal patches are not rejected, they are unrepresentable.
- **Your taste is a model with a posterior.** It has a shape — a handful of
  independent *style lenses*, so you are allowed to like several unrelated
  things — it has uncertainty, and it makes a prediction before every vote,
  which means it can be checked and can be *wrong in public*. The
  [TRUST tab](./views/taste.md#trust--is-its-confidence-honest) is where it
  reports on itself.
- **The search proposes toward you.** What the model learns reshapes how
  evolution *proposes*, not only how it scores. Lock the parts you love and
  refinement provably leaves them alone.
- **One compiler serves both.** What you play live is byte-for-byte the patch
  that was evolved, vetted and measured. There is no "render version" that
  differs from the "play version".

If you want the machinery rather than the workflow, that is the
[Reference](../reference/), which carries the actual math.

## The shape of a session

Three views, one loop between them.

| View | Shows | What you do there |
|---|---|---|
| **PLAY** | the patch | Hear it, play it, turn its knobs, rewire it, lock what you like |
| **EVOLVE** | the question | Two candidates; pick one. This is what teaches it |
| **TASTE** | the answer | What it thinks your taste is, how sure it is, whether it has been right |

You will spend most of your time in PLAY and EVOLVE. TASTE is where you go to
find out whether it is actually working.

```admonish tip title="The shortest version"
Open it, pick 3 of 9 presets when it asks, then answer duels in EVOLVE. After a
dozen or so picks press **EVOLVE POOL** and listen to what it bred. That is the
whole loop.
```

## What to expect, honestly

Auracle is **pre-1.0**. The instrument is finished enough to play for hours and
the taste loop is closed end to end, but:

- **It takes real evidence to learn anything.** A handful of duels is not a
  taste model. Expect the first useful proposals somewhere after a dozen or two
  picks and genuinely confident ones considerably later — the project's own
  synthetic tests measure a cold start in the *hundreds* of duels, which is
  exactly why the [three-pick warm start](./teaching.md#the-warm-start) exists.
- **It will tell you when it does not know.** Early on, TRUST will say the model
  is not beating a coin flip. That is the display working, not failing.
- **The save format may change between versions.** Your session lives in your
  browser and there is a migration path, but
  [export anything you care about](./your-data.md#exporting-and-importing).
- **Desktop only, for now.** A phone or small tablet gets a stand-in screen
  rather than a broken instrument — see
  [browser support](./getting-started/running-locally.md#browser-support).

## Where to go next

- Never used it → [Your first session](./getting-started/first-session.md)
- Want it running locally or offline → [Running it yourself](./getting-started/running-locally.md)
- Already playing, want the key map → [Keyboard and MIDI](./keyboard.md)
- Want to know how it works → [the Reference](../reference/)
- Something is wrong → [Troubleshooting](./troubleshooting.md)
