# www: the site

The landing page, the product guide (`docs/`), the technical reference
(`reference/`), the shared mdBook theme, the brand, the live figures and the
films. `make site` assembles all of it into `site/`, which is what
auracle.alexnodeland.com serves. Rules for the whole repo are in
[`../AGENTS.md`](../AGENTS.md); the long-form notes are this directory's
`README.md`, and the films have their own [`video/AGENTS.md`](video/AGENTS.md).

## Which page says what

| Reader wants | Lives in |
| --- | --- |
| What the instrument does, view by view | `docs/src/views/`: `perform.md`, `play.md` (PATCH), `evolve.md`, `taste.md` |
| How to do a thing | `docs/src/getting-started/`, `docs/src/*.md` |
| How it works, the model, the search, the math | `reference/src/` |
| Why it is built this way (user-facing) | `reference/src/design/decisions.md` |
| The pitch, and the hero film | `landing/index.html` |
| Every film, with chapters and transcripts | `docs/src/films.md`, written by `video/tools/publish.py` |

## Rules

- **The guide describes the app as it is.** Write what a player sees and
  hears, in the app's own words (control names, toast text, status lines).
  When you are not sure, run the app and look; do not describe from the code.
  See the `truth-pass` skill.
- **Everything is relative.** No root-absolute links (`/docs/...`); they break
  under a subpath and from `file://`. `make site-check` fails on them.
- **No external subresources.** No CDN, font service or analytics. Outbound
  hyperlinks are fine.
- **One copy of each asset.** Faces, brand marks and screenshots have one
  source and are copied at build time. The copies are gitignored: never commit
  or edit them (`docs/src/img/` is one).
- **One design system**
  ([ADR-011](../docs/decisions/011-one-design-system.md)). Sizes and marks
  follow the brand spec (`www/brand/index.html`).
- **One voice** ([ADR-013](../docs/decisions/013-one-voice.md)): every word on
  the site follows [`www/brand/voice.md`](brand/voice.md):
  - the line, "A synthesizer that grows toward you", with its descriptor;
  - the character and the tone;
  - the word table, with sound for what you hear and patch for how it's built;
  - American spelling and no em dashes;
  - the spoken voice for the films.

  `make dev-check` and CI fail when a file's count of banned words, em dashes
  or British spellings moves from `brand/voice-baseline.json`
  (`www/checkwords.py`): a sweep lowers it in the same change with
  `python3 www/checkwords.py --update`.
  The check also reads the app's words the engine writes (its `engine`
  surface): every string in the Rust files that send preset descriptions,
  rack labels and edit refusals to the screen, except what builds only for
  tests.
  In a script or Rust source, the comment `// voice: name` marks its line as
  names, not copy: the check skips each literal that starts on that line.
  In Markdown, a quotation keeps its own words between
  `<!-- voice: quote -->` and `<!-- /voice -->`.
- **Motion shows what the engine does**
  ([ADR-012](../docs/decisions/012-motion-shows-what-the-engine-does.md)): a
  figure or film that animates a mechanism shows what the engine does, and a
  stand-in is labelled as one.
- **Colours come from `www/brand/tokens.json`, never a literal**: a new colour
  is a token first, then `make tokens`. `make dev-check` fails on a colour
  written in the landing page, the docs theme, the live figures
  (`www/viz/`), the brand page and its raster source, the 404, the stage,
  the kit or a film, and on a token a figure reads that one of the pages
  loading it (the docs' Rack and Paper, the landing page) does not define
  ([`brand/README.md`](brand/README.md#the-tokens)).
- **A new guide page goes in `SUMMARY.md`**, or mdBook silently skips it.
- **KaTeX macros live in `reference/katex-macros.txt`.** A table in
  `book.toml` parses and is ignored.
- **The reference quotes constants by name.** When a default changes in Rust,
  grep for its name here.
- **Film blocks are generated.** Whatever sits between
  `<!-- film:NAME -->` and `<!-- /film:NAME -->` (and the README's
  `films:readme` block), `docs/src/films.md` and `landing/assets/film/` are
  written by `video/tools/publish.py`. A page opts in by carrying the empty
  markers; to change what they hold, change the tool and re-run it.

## Checks

`make site && make site-check` (links, assets, anchors, subresources), after
`make site-tools` once. For authoring, `make docs-serve` or
`make reference-serve`.
