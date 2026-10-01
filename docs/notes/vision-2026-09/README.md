# The sound at the centre: prototype v2, September 2026

The evidence for [RFC-006](../../proposals/006-the-sound-at-the-centre.md).
Built and reviewed on 2026-09-30. Dated, and not kept current.

- [`decisions.md`](decisions.md): what the maintainer decided, round by round,
  quoted where the words matter.
- [`prototype/`](prototype/): prototype v2's source, a single page. It was
  published as a private artifact, `claude.ai/artifact/PyY8gzPqFrA47k1iC4H2iB`,
  which only people the maintainer shares it with can open. To open it from
  here instead, run `python3 build.py` in `prototype/` and open
  `preview.html`. Its notes (the "What to try" panel, `notes.html`) say what to
  try, what each animation shows, how that maps to the engine, and what isn't
  real in it.
- [`audit/`](audit/): the review that tore v2 apart before the maintainer saw
  it. Six areas (shell, PERFORM, PATCH, EVOLVE, TASTE and LEARNING, mobile), on
  a desktop, a phone and a small phone, with real input, against
  [`RUBRIC.md`](audit/RUBRIC.md). Each finding was fixed in the prototype or
  is listed there as deferred.

## What the prototype is made of

- `template.html`, `style.css` and `core.js`: the shell (the header, the rail,
  ⌘K, the lens, the bank) and the shared parts (the faces, the stand-in model,
  the audio, the morph between levels).
- One script per view: `perform.js`, `patch.js`, `evolve.js`, `taste.js`,
  `model.js` (LEARNING), `own.js` (a sound of your own), `stage.js` (stage
  mode) and `explain.js` (ask, how it works, the lessons).
- `data.js`: the 63 presets as the engine rendered them for prototype v1: each
  one's phrase as audio, its spectrum in 40 bands with 12 time slices, its 18
  standardized audio features, its place on a 2-D map, and its tree. It is a
  snapshot. No make target regenerates it.

## What is not real in it

The prototype plays the presets' recorded phrases. It does not run the engine,
so:

- PATCH edits are not heard.
- A bred child is the unpooled preset nearest its seed.
- An offer is a nearby preset.
- Its model is a single weight vector over the 18 audio features.

`notes.html` lists each stand-in beside what the engine does. The engine's side
was traced in the code on 2026-09-30, and RFC-006 cites it.
