# The patch bank

<p class="lede">Three separate collections, each with its own rules.</p>

<!-- film:composing --><!-- /film:composing -->

<figure>
<img src="./img/bank.webp" alt="The bank rail: three bank tabs — evolution, my patches and presets, each with its count — above a list of rows, each with a name, prediction percentage, play button, five stars and a save icon." loading="eager" width="252" height="720">
<figcaption><strong>The bank rail.</strong> Three collections, and a row for
each patch carrying what the model predicts you would say about it.</figcaption>
</figure>

The rail on the left holds three of them:

| Bank | What it is |
|---|---|
| **pool** | The sounds the model weighs and breeds from |
| **saved** | What you saved. Yours, and no generation replaces them |
| **presets** | The hand-made library, browsed in place |

The **?** in the bank head walks you through what a generation is and what
evolving costs.

## Reading a row

Each row carries a name, an id, a prediction, stars, a save control and a cut:

<figure>
<img src="./img/bank-row.webp" alt="One bank row, outlined in green because it is the row the cursor is on: a diamond glyph, the name Round Wash, the prediction 80% and the id #35 on the right, and below them a play triangle, five filled stars, a save icon, and a horizontal bar drawn at the same 80%." loading="lazy" width="252" height="70">
<figcaption><strong>One row.</strong> The green outline is the row you are on.
Everything else on it is described below.</figcaption>
</figure>

- **The name** is generated from what the patch is, next to the bank it
  joined, and it keeps that name as the bank changes around it. You can
  rename it: double-click it.
- **new** beside the name marks a child of the latest generation. In the
  **pool** bank those children lead the list under **new · gen N**, in
  the order they were bred, and the rest follow under **ranked by the
  model**, the sounds it rates highest first. While a
  generation breeds, each child joins the group the moment it is bred and
  glows once; the rows below it do not move. A child of
  [⚡ evolve from this](./rack.md#locks-and-evolving-from-here) joins the
  group the same way: ⚡ is a generation of its own, so its one child is the
  group until the next generation's first child replaces it.
- **The percentage** is the model's guess: roughly, how likely you are to
  pick this sound in a pair. Its tooltip adds the word for how sure that reads
  (*59% · leaning*). Before the model has been fitted it reads **·**.
- **The bar** along the row's bottom edge draws the prediction. The bright tick
  is the model's guess; the dimmer block around it spans one standard
  deviation either way, so its width is how sure the model is. Before a fit the
  bar is an empty hatched track.
- **▶** plays the standard sample. If the sample has to be rendered first, a
  dotted amber ring says it is on its way.
- **★★★★★** rates it. This is an observation and it teaches the model.
- **💾** saves it. This is storage and it teaches nothing.
- **cut** teaches the model "not this one" and takes the row out of the bank.
  A cut patch is never dealt to you in a duel again; if it was on the cards,
  a new pair is dealt. The message *Cut Soft Wash. It won’t be dealt again.*
  offers an **undo** for seven seconds (<kbd>⌘Z</kbd> does the same), and
  nothing is recorded until they are up. The patch stays in the pool until a
  generation replaces it. The cut shows when you hover the row or put the
  cursor on it, and always on a touch screen.

## Stars are not saves

Two controls, two unrelated jobs.

**★ is a judgement.** It enters the observation log as an ordinal rating and
moves the taste posterior. Rate honestly, including rating things low.

**save is storage.** It lists the sound in **saved** as well as in
**pool**, and exempts it from eviction. It records nothing about your
preferences.

Merging them is tempting and wrong. The pool evicts its lowest-utility members,
so the moment a rating decides what survives, people rate strategically to
protect patches, and every protective over-rating is a preference you never
held.

```admonish warning title="If you like it, save it"
The evolution pool is a working set with a fixed size, and breeding a generation
evicts its weakest members. A patch you starred but did not save can be evicted.
Stars are for teaching; **save** is what keeps.
```

## Eviction and pins

The pool holds **40** vetted candidates. A generation's children join it as
they are bred, and when the generation ends (or you stop it) the weakest
unsaved members, by posterior utility, are removed to bring it back to 40. So
a patch you save while a generation is still breeding is safe. Hovering
**EVOLVE POOL** marks the rows it may replace with a dashed rail and *may be
replaced*.

(The engine's library default is 48; the web app asks for 40. If you see 48
quoted in the [reference](../reference/architecture/two-loops.html), that is
why.)

Saving pins a patch so eviction skips it. Pins are capped at a quarter of the
pool, so it can never be pinned solid and leave the search nowhere to put new
candidates. The head shows how many you have used, `3/10 saved`, from the
moment the app knows the cap.

## Presets

Sixty-two hand-made patches across seven families — bass, lead, keys, pad,
texture, perc, weird — browsed in place: clicking one opens it as the sound
you're playing. The engine can only play what it holds, so a preset you open or ▶
joins the pool and takes the place of the unsaved sound the model rates
lowest; the toast names what it replaced, saved sounds are never among them,
and the row reads **in pool** from then on, so a second click opens the same
copy instead of loading another.

They are worth playing through early even if you intend to evolve everything.
They are what the [warm start](./teaching.md#the-warm-start) samples from, and
they cover the palette's range more evenly than the prior does.

## Keyboard

The bank is a **single tab stop**. Reach it with <kbd>Tab</kbd>, then:

| | |
|---|---|
| <kbd>↑</kbd> <kbd>↓</kbd> | Move the cursor |
| <kbd>Enter</kbd> | Open the patch |
| <kbd>1</kbd>–<kbd>5</kbd> | Rate |
| <kbd>m</kbd> | Save |

In **presets**, <kbd>Enter</kbd> opens the preset under the cursor and
<kbd>p</kbd> plays it. <kbd>p</kbd> is also a note (D♯), but not while the
presets list has focus: there it only plays the preset.

The save key is <kbd>m</kbd> rather than <kbd>s</kbd> because <kbd>s</kbd> is a
note in the computer keymap, and note letters get through even when a control
has focus. Binding save to it would have played a D every time.

Rows announce their full state to a screen reader (name, id, saved, rating,
prediction), because the row's buttons sit outside the tab order and the label
has to carry what they encode.
