# Brand

The marks and the colour tokens live here once. Everything else in the repo is
a copy (the marks copied at build time, the tokens generated into each
stylesheet by `make tokens`), which is the point: before this directory existed
there were three different Auracle icons in circulation — a ring-and-pip in the
site favicon, an unrelated base64 PNG inlined in the app, and a `🎼` at the top
of the README — and six hand copies of the palette that had begun to disagree.

`index.html` is the full specification — the lockups, the construction rules,
the tracking ramp, the icon set, and the rule behind each. It builds to
`/brand/` on the site, and is written to stay true without dating: it states
what the system is, not how it came to be. Read it before changing anything
here, and keep new text in that register.

## The mark

| File | What it is |
| --- | --- |
| `mark.svg` | **The mark.** The only icon. Copied into every favicon slot by `make site-brand`. |
| `mark-active.svg` | The mark with one quadrant lit — a *state*, for use beside a running fit. Never a favicon. |
| `favicon.png` | 32×32 raster of `mark.svg`, for clients that will not take the SVG. |
| `apple-touch-icon.png` | 180×180, square-cornered — iOS applies its own mask, so rounding it here double-rounds it. |
| `lockup.png` | The horizontal lockup, drawn at 2× for the README, which cannot run CSS or load a webfont. |
| `og.png` | The 1200×630 social card. Staged to `site/assets/og.png`. |

The logotype is not a file. It is Jost 500 caps on a tracking ramp, set in CSS —
see the `.lk` rule in `index.html`, which is the spec rather than a picture of
one. `lockup.png` is the single exception, rendered to raster only because
GitHub has no fonts.

## The icon set

`icon-set/` holds the UI icons. They are a different kind of object from the
mark:
**single-colour, `currentColor`, no tile, 24px grid, 2px stroke** — because a UI
icon has to take the colour of the control it sits in, and the two-phosphor
split belongs to the brand mark alone.

| File | Means | Where it belongs |
| --- | --- | --- |
| `play.svg` | Two jacks and a cable | PLAY, the patch, wiring, the rack |
| `evolve.svg` | A peak — one proposal at the mode | EVOLVE, duels, proposals |
| `taste.svg` | A posterior over the ground | TASTE, the model's mind, what it learned |
| `teach.svg` | A meter | Teaching, the teach meter, what it learns from |
| `active.svg` | A ring with one quadrant sweeping | The model is fitting. The only icon allowed to animate. |

The first four line up with the guide's own chapters (`views/play.md`,
`views/evolve.md`, `views/taste.md`, `teaching.md`), which is the test of
whether an icon set is real: it names things the product already names.

`make site-extras` stages them to `site/brand/icon-set/`. Wiring them into the
app's view tabs or the guide's chapter heads is a change to a working
instrument, and belongs in its own commit.

## The tokens

`tokens.json` is the one source of every colour and font family on every
surface: the app, the landing page, the docs theme, this brand page, the 404
and the film stage. It holds:

- **the palettes**: the rack (the instrument's dark palette, in the tiers the
  app has always named: `rack`, `panel`, `hairline`, the plate and button
  faces, `silk`/`silk-dim`/`silk-mute`, the two phosphors with their `-dim`
  text tier and `-deep` stroke tier, `led-red`, and the few shades more than
  one surface uses), and Paper, the docs' light theme; `black` and `white`,
  for shadows and highlights only, go with both;
- **the font families**: `--font-silk`, `--font-mono`, `--font-voice`;
- **each surface's own named shades** (a value only that surface uses, such as
  the keybed's white keys) and **the opacities it uses** of any token.
  `--phos-b-30` is `--phos-b` at 30%; a third digit is a tenth, so
  `--white-045` is white at 4.5%. An opacity is generated as `rgba()`, not
  `color-mix()`: a gradient with a `color-mix()` colour in it interpolates in
  Oklab rather than sRGB, and moved pixels.

A token's `note` (a contrast ratio, the role it plays) is written into the CSS
beside it.

    make tokens

writes them into each consumer's stylesheet, between `/* tokens:begin … */`
and `/* tokens:end */`. The blocks are committed, like the film blocks
`publish.py` fills, so the app and the site still serve with no build step.
Edit the JSON, never a block. The consumers, and which surface each reads, are
listed at the top of `tokens.py`.

Scripts read the same tokens, because a canvas or an SVG attribute cannot use
a custom property: `tok()` in the app's `main.js`, `ink()` in the landing
page's `hero.js`, and `ink()`/`inkA()` exported by the film kit
(`www/video/stage/kit.js`), which every film uses. Each reads
`getComputedStyle(document.documentElement)` once per name.

`make dev-check` runs `tokens.py --check`. It fails when a block is stale, and
on any colour literal (hex, `rgb()`/`rgba()`, `hsl()`, or an `"r,g,b"` string
in a script) outside a block in the app, the landing page, the docs theme, the
brand page, the 404, the stage, the kit or a film; comments are not read. It
also fails when a script reads a token its surface does not define, when a
stylesheet uses a token another surface owns, when a `theme-color` is not the
rack, and when a hex quoted in prose (`<code>#0c0d10</code>`) is not a
token's value. The marks (`*.svg`), `render.html` and `docs/notes/` are
exempt: the marks are assets a favicon slot reads without CSS. A new colour
is a token first: add it to `tokens.json`, run `make tokens`, then use it.
`test_tokens.py`, also run by `make dev-check`, plants each kind of stray
colour in a copy of the tree and expects the check to fail on it, and holds
the two drifts the tokens closed (the films' deep amber, the brand page's
lamp) in place.

## Regenerating the rasters

The PNGs are committed rather than built, so neither CI nor a contributor needs
`rsvg-convert` installed to build the site. Regenerate them only when
`mark.svg` changes:

    make brand-rasters

`lockup.png` and `og.png` are rendered from a headless browser rather than from
SVG, because both set the logotype and need the real Jost outlines — see the
target for how.

## Why the directory is `icon-set/` and not `icons/`

Because `icons/` does not survive `git add` on a Mac. The widely-copied macOS
global gitignore carries `Icon?` — for the `Icon\r` file Finder leaves behind —
and git's `?` is a single-character wildcard, so with `core.ignorecase` on (the
default on macOS) the pattern matches the directory `icons` and every file in
it disappears silently. It cost this directory one confused commit. Do not
rename it back.

## The rules that are easy to break

- **Two phosphors, no third.** Green is sound, amber is the model's mind.
- **The mark keeps its dark tile everywhere**, including on paper. The logotype
  inverts; the mark does not.
- **The lit E belongs to the app.** `apps/web` lights the wordmark's `E` from
  `$("wm-lamp").classList.add("thinking")` while the model is fitting, so there
  it is a live reading. In static materials it would be a light that is always
  on, which is why the landing page, the 404 and the README all set the
  wordmark in plain silk.
