# Brand

The marks and the color tokens live here once, and so does the films' sound
(`sound.json`). Everything else in the repo is a copy (the marks copied at
build time, the tokens generated into each stylesheet by `make tokens`, the
sound into the films' scores and mix by `make sound`), which is the point:
before this directory existed there were three different Auracle icons in
circulation (a ring-and-pip in the site favicon, an unrelated base64 PNG
inlined in the app, and a `🎼` at the top of the README) and six hand copies
of the palette that had begun to disagree.

`index.html` is the full specification: the lockups, the construction rules,
the tracking ramp, the icon set, and the rule behind each. It builds to
`/brand/` on the site, and is written to stay true without dating: it states
what the system is, not how it came to be. Read it before changing anything
here, and keep new text in that register.

## The voice

[`voice.md`](voice.md) is the one set of language rules for every medium
([ADR-013](../../docs/decisions/013-one-voice.md)):

- the line, "A synthesizer that grows toward you", with its descriptor;
- who Auracle sounds like and what it believes;
- the tone by moment;
- the registers;
- the spoken voice of the films;
- the word table and the banned list the check reads;
- the mechanics: American spelling and no em dashes.

| File | What it is |
| --- | --- |
| `voice.md` | **The guide.** Its `banned` block is the list the check reads. |
| `voice-baseline.json` | The voice check's floor: each file's count of each banned word, em dash and British spelling. Written by `python3 www/checkwords.py --update`, which only lowers a count (`--allow-rise` raises one). |

`make dev-check` and CI run `www/checkwords.py`, which fails when a file's
count rises above `voice-baseline.json`, a file it does not list has any hit,
or a count falls below it (a sweep lowers the baseline in the same change).
Its tests are `www/test_checkwords.py`. How the check reads each surface is
in the script's docstring; why it is a ratchet is in voice.md's "How this is
kept".

Where a lockup carries words, they are the line: `lockup.png` sets the tagline
under the wordmark, and `og.png` sets the tagline with the descriptor under it.

## The mark

| File | What it is |
| --- | --- |
| `mark.svg` | **The mark.** The only icon. Copied into every favicon slot by `make site-brand`. |
| `mark-active.svg` | The mark with one quadrant lit: a *state*, for use beside a running fit. Never a favicon. |
| `favicon.png` | 32×32 raster of `mark.svg`, for clients that will not take the SVG. |
| `apple-touch-icon.png` | 180×180, square-cornered: iOS applies its own mask, so rounding it here double-rounds it. |
| `lockup.png` | The horizontal lockup over the tagline, drawn at 2× for the README, which cannot run CSS or load a webfont. |
| `og.png` | The 1200×630 social card: the lockup, the tagline, and the descriptor. Staged to `site/assets/og.png`. |

The logotype is not a file. It is Jost 500 caps on a tracking ramp, set in CSS:
see the `.lk` rule in `index.html`, which is the spec rather than a picture of
one. `lockup.png` is the single exception, rendered to raster only because
GitHub has no fonts.

## The icon set

`icon-set/` holds the UI icons. They are a different kind of object from the
mark:
**single-color, `currentColor`, no tile, 24px grid, 2px stroke**, because a UI
icon has to take the color of the control it sits in, and the two-phosphor
split belongs to the brand mark alone.

| File | Means | Where it belongs |
| --- | --- | --- |
| `play.svg` | Two jacks and a cable | PATCH, modules, cables, the rack |
| `evolve.svg` | A peak: one proposal at the mode | EVOLVE, pairs, generations |
| `taste.svg` | A posterior over the ground | TASTE, the model's mind, what it learned |
| `teach.svg` | A meter | Teaching, the teach meter, what it learns from |
| `active.svg` | A ring with one quadrant sweeping | The model is fitting. The only icon allowed to animate. |

The first four line up with the guide's own chapters (`views/play.md`, which
is PATCH, `views/evolve.md`, `views/taste.md`, and `teaching.md`), which is the
test of whether an icon set is real: it names things the product already names.

`make site-extras` stages them to `site/brand/icon-set/`. Wiring them into the
app's view tabs or the guide's chapter heads is a change to a working
instrument, and belongs in its own commit.

## The tokens

`tokens.json` is the one source of every color and font family on every
surface: the app, the landing page, the docs theme, this brand page, the 404,
and the film stage. It holds:

- **the palettes**: the rack (the instrument's dark palette, in the tiers the
  app has always named: `rack`, `panel`, `hairline`, the plate and button
  faces, `silk`/`silk-dim`/`silk-mute`, the two phosphors with their `-dim`
  text tier and `-deep` stroke tier, `led-red`, and the few shades more than
  one surface uses), and Paper, the docs' light theme; `black` and `white`,
  for shadows and highlights only, go with both;
- **the font families**: `--font-silk`, `--font-mono`, `--font-voice` (the
  last is Newsreader italic, for the model's own words and nothing else);
- **each surface's own named shades** (a value only that surface uses, such as
  the keybed's white keys) and **the opacities it uses** of any token.
  `--phos-b-30` is `--phos-b` at 30%; a third digit is a tenth, so
  `--phos-a-045` is green at 4.5%. An opacity is generated as `rgba()`, not
  `color-mix()`: a gradient with a `color-mix()` color in it interpolates in
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

`make dev-check` runs `tokens.py --check`. It fails when `tokens.json` holds
something that is not a color, when a block is stale, and on a color written
outside a block in any of these (the `SCANNED` list in `tokens.py`):

- the app: `apps/web/*.css`, `*.js` and `index.html`;
- the landing page: `www/landing/*.css`, `*.js` and `index.html`;
- the docs theme: `www/theme/css/*.css`, `highlight.css` and `index.hbs`;
- the brand page and the 404: `www/brand/*.html` (not `render.html`) and
  `www/404.html`;
- the films: `www/video/stage/*.css`, `*.js` and `*.html` (the stage, the kit,
  the poster), and every film's `film.js`, `cards.js` and `index.html`.

A color there is a hex, an `rgb()`/`rgba()` or `hsl()`, an `"r,g,b"` string in
a script, or a CSS named color (`white`, `rebeccapurple` …) used as a color:
in a declaration's value, an SVG color attribute, an inline style or a
script's color property. `transparent`, `currentColor` and `inherit` pass,
comments are not read, and a word like "green" in prose or a script's own
names is not a color. It also fails when a script reads a token its surface
does not define, when a stylesheet uses a token another surface owns, when a
`theme-color` is not the rack, and when a hex quoted in prose
(`<code>#0c0d10</code>`) is not a token's value.

**Not checked yet** (`NOT_YET` in `tokens.py`, which `--check` lists every
time it runs), each waiting on a token decision rather than a substitution:

- `www/viz/viz.js` and `viz.css`, the live figures: the grammar figure fills
  its tiles with the dark theme's phosphors as `rgba()` literals, which is
  wrong on the docs' Paper theme, and their `var()` fallbacks are literals;
- `www/theme/fonts/auracle.css`: a film's ground is `var(--bezel, #07080a)`,
  and Paper defines no `--bezel`, so on Paper the literal is what shows;
- `render.html`: a hand copy of seven tokens, with the marks work (Plan-004
  task 3).

Never scanned: the marks (`*.svg`, assets a favicon slot reads without CSS)
and `docs/notes/` (dated records). A new color is a token first: add it to
`tokens.json`, run `make tokens`, then use it. `test_tokens.py`, also run by
`make dev-check`, plants each kind of stray color in a copy of the tree and
expects the check to fail on it, and holds the two drifts the tokens closed
(the films' deep amber, the brand page's lamp) in place.

## The sound

`sound.json` is the one source of the films' sound, as `tokens.json` is of
their colors ([ADR-014](../../docs/decisions/014-the-films-sound.md); every
value was chosen in `docs/notes/sound-2026-09/SPEC.md`). Its keys:

| Key | Holds |
| --- | --- |
| `key`, `tempo`, `form` | F over an F2/C3 pedal; 66 BPM (the marks at 60); the 8-bar cycle Fmaj9, G6/F, Bbmaj7/F, Bbm6/F |
| `cast` | The sixteen presets a film casts from, by role (RFC-007); the one room (Cathedral's stock reverb); and each part (drone, bed pad, marks' pad, lead, burble, demo) with its preset, voices and every knob the finals turned, stock and used |
| `marks` | Bloom and Reach: each one's record score, its generated file, which part plays each track, and how it meets the bed |
| `bed` | N3: its record score and generated file, and its parts (voicings, burble cells, sighs) |
| `mix` | Each part's EQ, pan and level, on stems |
| `voice_chain` | The narration's four stages, from the 85 Hz high-pass to the de-esser |
| `ladder` | Every element's loudness, from the narration at −18 LUFS to the master at −16 |
| `duck` | The bed under the voice: the 2 dB duck, the 3 dB carve in 1–4 kHz, the pad's 2 dB dip in 300–600 Hz |
| `grammar` | The timings: 0.7 s to a demo, its tail to −30 dB plus 0.8 s, the marks 1.5–2 s from the voice (1.75 s in a film), and 2.6 s for the room after the exit mark |

    make sound

runs `sound.py`, which writes the marks' and the bed's scores into
`www/video/sound/` and the mix's defaults into
`www/video/tools/sound_defaults.py`. The generated files are committed and say
so at their top; edit the JSON, never them.

- **Into the scores** go the tempo and the cast: each part's preset, voices,
  trim, transpose and used knobs, the lead's bend times, and the drone's
  breath. The notes are the auditioned finals'.
- **Into `sound_defaults.py`** go `mix`, `voice_chain`, `ladder`, `duck`, the
  timings in `grammar`, the marks' levels and hand-overs, the shortlist and
  the room. `mix.py` reads every level it sets from there.
- **The rest describes the notes:** the pedal, the marks' length, the lead's
  legato and swell, the bed's voicings, burble and sighs, and the demo (which
  only the reel played). `make sound` leaves the notes as they are, so these
  are checked against the record scores instead. Strings are prose.

`make dev-check` runs `sound.py --check`. It fails when:
- a generated file is stale;
- a value that describes the notes is not what the records play;
- a preset in the cast or the shortlist is not in the bank;
- a knob is outside 0–1, the drone's breath does not run low ≤ stock ≤ high,
  or a part turns the room's knobs;
- a number is `mix.py`'s `--music-db` or `--duck-db` default, or a film
  tool's shell code has a numeric `MUSIC_DB`/`DUCK_DB` fallback or a numeric
  `--music-db`/`--duck-db` flag. These are the ways the duck came to have
  three values; docstrings, help strings and comments may quote a level, and
  the scan does not look for every other way to write one.

`test_sound.py`, also run by `make dev-check`, makes each of these changes in
a copy of the tree and expects the check to fail on it. With
`AURACLE_RENDER_SCORES=1` it also renders every generated score with the
engine and checks each track sounds, and checks each stock knob value against
the preset's own.

## Regenerating the rasters

The PNGs are committed rather than built, so neither CI nor a contributor needs
`rsvg-convert` installed to build the site. Regenerate them only when
`mark.svg` changes:

    make brand-rasters

`lockup.png` and `og.png` set the logotype, so they come out of a browser with
the real Jost outlines rather than out of an SVG renderer. Their source is
`render.html`, and its comment says how to shoot them. They also carry the
line, so a change to the tagline or the descriptor in `voice.md` re-renders
them: edit `#banner` and `#og` in `render.html`, then shoot both again.

## Why the directory is `icon-set/` and not `icons/`

Because `icons/` does not survive `git add` on a Mac. The widely copied macOS
global gitignore carries `Icon?` (for the `Icon\r` file Finder leaves behind),
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
