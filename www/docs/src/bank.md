# The patch bank

<p class="lede">Three separate collections, each with its own rules.</p>

<figure>
<img src="./img/bank.webp" alt="The bank rail: three bank tabs — evolution 40, my patches 1, presets 61 — above a list of rows, each with a name, prediction percentage, play button, five stars and a save icon." loading="eager" width="252" height="720">
<figcaption><strong>The bank rail.</strong> Three collections, and a row for
each patch carrying what the model predicts you would say about it.</figcaption>
</figure>

The rail on the left holds three of them:

| Bank | What it is |
|---|---|
| **evolution** | The live pool the model reasons over and breeds from |
| **my patches** | What you saved. Yours, permanent, never evicted |
| **presets** | The hand-made library, browsed in place |

The **?** in the bank head walks you through what a generation is and what
evolving costs.

## Reading a row

Each row carries a name, an id, a prediction, stars and a save control:

<figure>
<img src="./img/bank-row.webp" alt="One bank row, outlined in green because it is the row the cursor is on: a diamond glyph, the name Round Wash, the prediction 80% and the id #35 on the right, and below them a play triangle, five filled stars, a save icon, and a horizontal bar drawn at the same 80%." loading="lazy" width="252" height="70">
<figcaption><strong>One row.</strong> The green outline is the row you are on.
Everything else on it is described below.</figcaption>
</figure>

- **The name** is generated from what the patch is, and you can rename it.
- **The percentage** is the model's prediction: roughly, how likely you are to
  prefer this patch in a duel. It is blank when the model has no basis for a
  claim.
- **The bar** under the row is the same value, drawn.
- **▶** plays the standard sample.
- **★★★★★** rates it. This is an observation and it teaches the model.
- **💾** saves it. This is storage and it teaches nothing.

## Stars are not saves

Two controls, two unrelated jobs.

**★ is a judgement.** It enters the observation log as an ordinal rating and
moves the taste posterior. Rate honestly, including rating things low.

**save is storage.** It copies the patch into **my patches** and exempts it
from eviction. It records nothing about your preferences.

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

The pool holds **40** vetted candidates. Injecting children removes the weakest
to make room, by posterior utility.

(The engine's library default is 48; the web app asks for 40. If you see 48
quoted in the [reference](../reference/architecture/two-loops.html), that is
why.)

Saving pins a patch so eviction skips it. Pins are capped at a quarter of the
pool, so it can never be pinned solid and leave the search nowhere to put new
candidates. The head shows your pin budget when you are near it.

## Presets

Sixty-one hand-made patches across seven families — bass, lead, keys, pad,
texture, perc, weird — browsed in place: clicking one loads it on the workbench
without adding it to the pool.

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

The save key is <kbd>m</kbd> rather than <kbd>s</kbd> because <kbd>s</kbd> is a
note in the computer keymap, and note letters get through even when a control
has focus. Binding save to it would have played a D every time.

Rows announce their full state to a screen reader (name, id, saved, rating,
prediction), because the row's buttons sit outside the tab order and the label
has to carry what they encode.
