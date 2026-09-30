# How much the app says, September 2026

Measured on 2026-09-30 at `242991f`, in Chromium at 1440×900, with
[`measure.js`](measure.js) (its header says how to run it and what counts as a
word). It informed RFC-004's part on interaction and disclosure. Dated and not
kept current.

**Blocks** are runs of text in one element; a block of six or more words is a
sentence of guidance or explanation rather than a label. **Tooltips** are the
`title` text of the visible elements.

## At rest

| State | Words on screen | Words in tooltips | Blocks of 6+ words |
| --- | ---: | ---: | ---: |
| First visit: the warm start (and the view behind it) | 383 | 1,131 | 16 |
| First visit: PERFORM | 193 | 972 | 5 |
| First visit: PATCH | 254 | 1,102 | 6 |
| First visit: EVOLVE | 156 | 909 | 5 |
| First visit: TASTE | 169 | 822 | 5 |
| Mid-session: PERFORM | 246 | 1,311 | 6 |
| Mid-session: PATCH | 267 | 1,663 | 6 |
| Mid-session: EVOLVE | 177 | 1,003 | 6 |
| Mid-session: TASTE, map / styles / directions / trust | 141 / 149 / 140 / 167 | 917 | 3 / 3 / 3 / 4 |

Mid-session is after the warm start's three favourites (18 picks) and six
duels, picked by key; no note had been played.

## On request

| Surface | Words | Largest block |
| --- | ---: | --- |
| The **?** card ("How to play") | 799, in 17 blocks | Six paragraphs of 59–80 words each |
| The spec strip, pointing at a module | 65 | A 26-word description and a 20-word model line ("θ −0.01 ± 0.20, an interval that crosses zero") |
| A bank tour step | 36 | One paragraph |
| The lineage log, after one generation | 90 | Rows of 28–32 words, mostly numbers in running text ("attack 3.98 s → 1.00 s, decay 4.0 ms → 1.3 ms, sustain −43.9 dB → −29.8 dB, +3 more, +pluck, −distortion …") |

## What it shows

- **Many voices at once, more than one long text.** Every view shows five or
  six sentences of guidance at rest, each from a different surface. PATCH on
  a first visit: the next-step pill, the coach, the bench strip, the spec
  strip, the bank note and the model's guess. [`ui-hierarchy.md`](../ui-hierarchy.md)
  set one teaching surface per view when PATCH had four.
- **One instruction, several times.** How to play the first note shows as
  PERFORM's first step, PATCH's next-step pill and the coach. The coach stays
  in every view until a note is played. TASTE's empty map says "6 more
  picks" twice.
- **Placeholder rows.** The spec strip's resting text (29 words) and the
  lineage log's empty text (17 words) are instructions standing in for
  content, which `ui-hierarchy.md` ruled out and PA-17 reported.
- **Prose where a figure would do.** TASTE's captions (17–30 words a tab)
  explain the drawing's encoding ("Solid = it's sure; hollow, with a ?, =
  still a guess"), which a legend on the figure would show. The ? card
  explains every view in paragraphs. The lineage log reports each child's
  changes as a sentence of numbers.
- **Explanation hidden in tooltips.** 800–1,700 words a view sit in `title`
  attributes: out of reach of touch and keyboard, invisible until hovered, and
  shown only after the browser's delay.
