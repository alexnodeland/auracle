# The patch bank

<p class="lede">Three banks, not one list with filters.</p>

<figure>
<img src="./img/bank.webp" alt="The bank rail: three bank tabs — evolution 40, my patches 1, presets 61 — above a list of rows, each with a name, prediction percentage, play button, five stars and a save icon." loading="eager" width="252" height="720">
</figure>

The rail on the left holds three separate collections, and the separation is the
design rather than an accident of the UI:

| Bank | What it is |
|---|---|
| **evolution** | The live pool the model reasons over and breeds from |
| **my patches** | What you saved. Yours, permanent, never evicted |
| **presets** | The hand-made library, browsed in place |

The **?** in the bank head walks you through what a generation is and what
evolving costs.

## Reading a row

Each row carries a name, an id, a prediction, stars and a save control:

```text
◇ Round Wash            80% #35
  ▶ ★ ★ ★ ★ ★    💾
  ───────────────────
```

- **The name** is generated from what the patch is, and you can rename it.
- **The percentage** is the model's prediction: roughly, how likely you are to
  prefer this patch in a duel. It is blank when the model has no basis for a
  claim rather than showing a made-up number.
- **The bar** under the row is the same value, drawn.
- **▶** plays the standard sample.
- **★★★★★** rates it. This is an observation and it teaches the model.
- **💾** saves it. This is storage and it teaches nothing.

## Stars are not saves

These are two controls doing two unrelated jobs, and keeping them apart is
load-bearing.

**★ is a judgement.** It enters the observation log as an ordinal rating and moves
the taste posterior. Rate honestly, including rating things low.

**save is storage.** It copies the patch into **my patches** and exempts it from
eviction. It records nothing about your preferences.

The app once conflated them — a "saved" filter that really meant "starred at least
once", over a pool that evicts its lowest-utility members. Think about what that
does: it targets precisely the oddball you loved *before* the model had learned
why. Merging them is tempting and wrong for a sharper reason too — the moment a
rating decides what survives, people rate strategically to protect patches, and
every protective over-rating is a preference the user never held. The data would
be quietly poisoned by the interface.

```admonish warning title="If you like it, save it"
The evolution pool is a working set with a fixed size, and breeding a generation
evicts its weakest members. A patch you starred but did not save can be evicted.
Stars are for teaching; **save** is what keeps.
```

## Eviction and pins

The pool holds 48 vetted candidates. Injecting children removes the weakest to
make room, by posterior utility.

Saving pins a patch engine-side so eviction skips it. Pins are capped at a quarter
of the pool, so the pool can never be pinned solid — a fully-pinned pool has no
honest report, because it surfaces as "no proposal beat its parent", which is a
different thing. The head shows your pin budget when you are near it.

## Presets

Twenty-nine hand-made patches across several families, browsed in place — clicking
one loads it on the workbench without adding it to the pool.

They are worth playing through early even if you intend to evolve everything: they
are what the [warm start](./teaching.md#the-warm-start) samples from, and they
cover the palette's range more evenly than the prior does.

## Keyboard

The bank is a **single tab stop**. Reach it with <kbd>Tab</kbd>, then:

| | |
|---|---|
| <kbd>↑</kbd> <kbd>↓</kbd> | Move the cursor |
| <kbd>Enter</kbd> | Open the patch |
| <kbd>1</kbd>–<kbd>5</kbd> | Rate |
| <kbd>m</kbd> | Save |

The save key is <kbd>m</kbd> and not the obvious <kbd>s</kbd> because <kbd>s</kbd>
is a note in the computer keymap, and the global handler deliberately lets note
letters through even when a control has focus. Binding it here would have played a
D on every save.

Rows announce their full state to a screen reader — name, id, saved, rating,
prediction — because the row's buttons are deliberately outside the tab order, so
the label has to carry what they encode.
