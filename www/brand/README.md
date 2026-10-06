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

`tokens.json` is the one source of every color, font family, type size,
spacing step, radius and motion on every surface: the app, the landing page,
the docs theme, this brand page (and `render.html`, the source of its
rasters), the 404, and the film stage. It holds:

- **the palettes**: the rack (the instrument's dark palette, in the tiers the
  app has always named: `rack`, `panel`, `hairline`, the plate and button
  faces, `silk`/`silk-dim`/`silk-mute`, the two phosphors with their `-dim`
  text tier and `-deep` stroke tier, `led-red`, and the few shades more than
  one surface uses), and Paper, the docs' light theme, whose `--bezel` is the
  rack's on purpose: a film keeps its dark ground on Paper. `black` and
  `white`, for shadows and highlights only, go with both;
- **the font families**: `--font-silk`, `--font-mono`, `--font-voice` (the
  last is Newsreader italic, for the model's own words and nothing else);
- **each surface's own named shades** (a value only that surface uses, such as
  the keybed's white keys) and **the opacities it uses** of any token.
  `--phos-b-30` is `--phos-b` at 30%; a third digit is a tenth, so
  `--phos-a-045` is green at 4.5%. An opacity is generated as `rgba()`, not
  `color-mix()`: a gradient with a `color-mix()` color in it interpolates in
  Oklab rather than sRGB, and moved pixels;
- **the type scale, spacing, radii and motion**, every surface's, from the
  approved specimen (prototype v2's `:root`, in
  `docs/notes/vision-2026-09/prototype/style.css`, which `test_tokens.py`
  holds them to):

  | Group | Tokens |
  | --- | --- |
  | `type` | One ratio, 1.2, from the value size: `--t-value` 12 px (mono values, readouts), `--t-body` 14 (prose, names), `--t-voice` 17 (the model speaking, in Newsreader italic, and nothing else), `--t-title` 21 (a sound's name, a card's heading, the wordmark), `--t-display` 52 (a level's one headline). Each is 12 × 1.2ⁿ rounded, and the check holds them to it. `--t-label` 11 px (silk caps) sits under the scale and is the page's floor. `--t-canvas` 12 px is the floor for text a canvas draws. |
  | `space` | `--s1` to `--s7`: 4, 8, 12, 16, 24, 32, 48 px. 1 to 3 px is an optical nudge, not a space, and is written as it is. |
  | `radius` | `--r1` 4 px (a row, a chip), `--r2` 8 (a button, a pad, a card), `--r3` 14 (the well, a sheet). A circle is `50%` and a pill `999px`. |
  | `motion` | `--d-press` 90 ms, `--d-state` 180 ms, `--d-move` 320 ms; `--e-settle` (arriving and coming to rest) and `--e-swap` (one thing giving way to another). Under `prefers-reduced-motion` every duration is 0 ms. A loop's period is none of these. |

- **each surface's own sizes**: the rack's type tier in the app (`--t-rack-*`,
  drawn through its camera and sized at zoom 1), the landing page's display
  tier, prose size and wide steps (`--s8`, `--s9`), the headings of the brand
  page and the 404, the docs' prose and headings (`--t-prose`, `--t-h1`,
  `--t-h3`), and the film stage's frame tier: a film's text is set in pixels
  of its 1920 × 1080 frame, on the type scale's ratio continued past the
  page's steps (`--t-frame-n` is step n, 12 × 1.2ⁿ rounded, which
  `test_tokens.py` holds). The docs' sizes go in their stylesheet's `:root`,
  which both themes share: a consumer whose families' rule holds no palette
  names the surface whose sizes it writes (`sizes` in `tokens.py`). A surface
  may restate a shared size for itself, with a note that says why (the landing
  page reads its prose at `1rem`).

A token's `note` (a contrast ratio, the role it plays) is written into the CSS
beside it.

    make tokens

writes them into each consumer's stylesheet, between `/* tokens:begin … */`
and `/* tokens:end */`. The blocks are committed, like the film blocks
`publish.py` fills, so the app and the site still serve with no build step.
Edit the JSON, never a block. The consumers, and which surface each reads, are
listed at the top of `tokens.py`. The live figures (`www/viz/`) have no block
of their own: they paint with the tokens of the page they are on, the docs'
Rack or Paper or the landing page, so a theme switch is a repaint.

Scripts read the same tokens through a helper: `tok()` in the app's
`main.js`, `ink()` in the landing page's `hero.js`, and `ink()`/`inkA()`
exported by the film kit (`www/video/stage/kit.js`), which every film uses.
Each reads `getComputedStyle(document.documentElement)` once per name. A
canvas needs the value, since it takes a color rather than a custom property,
and so does a color a script mixes or fades (`inkA()`, the app's `inkMix()`).
The live figures need no helper: they write tokens straight into their SVG
attributes (`fill="var(--phos-a)"`), so a theme switch repaints them.

The app's canvases read `--t-canvas` the same way (`canvasFont()` in
`main.js`), and the rack reads its own tier.

`make dev-check` runs `tokens.py --check`. It fails when `tokens.json` holds a
color that is not a color, a size that is not a length, a duration not in ms,
an easing that is not a `cubic-bezier()`, or a type step off the ratio; when a
block is stale; when a stylesheet defines, after its block, a token the block
already defines (the later one would silently win) or one another surface owns;
and on a color written
outside a block in any of these (the `SCANNED` list in `tokens.py`):

- the app: `apps/web/*.css`, `*.js` and `index.html`;
- the landing page: `www/landing/*.css`, `*.js` and `index.html`;
- the docs theme: `www/theme/css/*.css`, `highlight.css`, `index.hbs` and
  `fonts/auracle.css`;
- the live figures: `www/viz/*.js` and `*.css`, as the docs' two themes and
  the landing page, which all load them;
- the brand page, the source of its rasters and the 404: `www/brand/*.html`
  and `www/404.html`;
- the films: `www/video/stage/*.css`, `*.js` and `*.html` (the stage, the kit,
  the poster), and every film's `film.js`, `cards.js` and `index.html`.

A color there is a hex, an `rgb()`/`rgba()` or `hsl()`, an `"r,g,b"` string in
a script, or a CSS named color (`white`, `rebeccapurple` …) used as a color:
in a declaration's value, an SVG color attribute, an inline style or a
script's color property. `transparent`, `currentColor` and `inherit` pass,
comments are not read, and a word like "green" in prose or a script's own
names is not a color. It also fails when a script reads a token its surface
does not define, when a stylesheet uses a token another surface owns, when a
figure reads a name one of the pages that load it does not define (`ON_EVERY`
in `tokens.py`), when a `theme-color` is not the rack, and when a hex quoted
in prose (`<code>#0c0d10</code>`) is not a token's value.

The figures' rules hold on the docs' Rack, the docs' Paper and the landing
page at once, so every name they read must be on all three: a token in the
page's block, and an alias such as `--fg`, `--code-bg` or `--mono-font` in the
page's own stylesheet, in `:root` or in its theme's rule (`html.light` for
Paper). On a page that lacks one, a tile's fill would turn black (an SVG
`fill` falls back to the one it inherits) and the stage would lose its
ground. A `var()` with a fallback of its own is held to the same rule.

A page that has to hold colors of its own while a token is decided goes on
`NOT_YET` in `tokens.py`, with why; it is not scanned, and `--check` names it
every time it runs. The list is empty.

Never scanned: the marks (`*.svg`, assets a favicon slot reads without CSS)
and `docs/notes/` (dated records). A new color is a token first: add it to
`tokens.json`, run `make tokens`, then use it. `test_tokens.py`, also run by
`make dev-check`, plants each kind of stray color in a copy of the tree and
expects the check to fail on it, and holds the two drifts the tokens closed
(the films' deep amber, the brand page's lamp) in place.

**Sizes and durations are a ratchet.** The same files are counted, outside
their blocks, for four kinds of literal, in any unit case:

- a font size in px, rem, em or % (`font-size` and the `font` shorthand; not
  100% or 1em, which are the parent's size), an SVG `font-size` attribute,
  and any assignment to a canvas context's `.font` (`ctx`, `…Ctx`,
  `context`) that is not `canvasFont(…)`;
- a `padding`, `margin` or `gap` of 4 px or more, in px or rem;
- a `border-radius` from 4 to 99 px;
- a `transition` or `animation` time, and in a script a `duration: N` or a
  bare number inside an `.animate(…)` call's arguments.

They are read in stylesheets, `<style>` blocks and `style` attributes, and
in a script's strings, `.style.*` assignments, style objects and
`style.setProperty()` calls; a literal held in a custom property counts when
that property is `var()`'d in one of the declarations above, in a file of
the same surface. A script's other durations (a `duration:` outside
`.animate()`, timers: when something happens, not how long it moves), a
`.font` on anything but a canvas context, widths, heights, offsets, shadows
and spacing in em are not counted.
`sizes-baseline.json` holds each file's counts, and the check fails when one
rises, when a file it does not list has any, or when one falls below it (a
move lowers the baseline in the same change, so the floor only goes down):

    python3 www/brand/tokens.py --where FILE    every counted literal in a file
    python3 www/brand/tokens.py --update        lower the baseline to today's counts

Every scanned file is at zero, so the baseline is empty and a new literal
fails the check. Where the scale has no step for one (a loop's period, a
glyph sized to its button, a key that must light at once, a lockup specimen
at a set size, the geometry a raster is drawn at, inline code sized to its
line), the declaration says why with a trailing `token-exempt:` comment,
which covers that declaration and no other. `--check` names any file the
baseline holds a count for every time it runs.

## The sound

`sound.json` is the one source of the films' sound, as `tokens.json` is of
their colors ([ADR-014](../../docs/decisions/014-the-films-sound.md); every
value was chosen in `docs/notes/sound-2026-09/SPEC.md`). Its keys:

| Key | Holds |
| --- | --- |
| `key`, `tempo`, `form` | F over an F2/C3 pedal; 66 BPM (the marks at 60); the 8-bar cycle Fmaj9, G6/F, Bbmaj7/F, Bbm6/F |
| `cast` | The sixteen presets a film casts from, by role (RFC-007); the one room (Cathedral's stock reverb); and each part (drone, bed pad, marks' pad, lead, burble, demo) with its preset, voices and every knob the finals turned, stock and used |
| `marks` | Bloom and Reach: each one's record score, its generated file, which part plays each track, and how it meets the bed |
| `bed` | N3: its record score and generated file, and its parts (voicings, the pad under a demo, burble cells, sighs and the rule that places them) |
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
  the room. `mix.py` reads every level it sets from there. The bed's parts
  and how the lead plays a line go there too (`BED`, `LEAD`), for
  `fit_score.py --film` to write a film's bed from.
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
- a number is a film tool's `--music-db`, `--duck-db` or `--gain-db`
  default, or a film tool's shell code has a numeric `MUSIC_DB`, `DUCK_DB`
  or `APP_DB` fallback or a numeric `--music-db`/`--duck-db`/`--gain-db`
  flag. These are the ways the duck came to have three values; docstrings,
  help strings and comments may quote a level, and the scan does not look
  for every other way to write one.

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
`render.html`, and its comment says how to shoot them; its colors are the
brand page's tokens, generated into it by `make tokens`. They also carry the
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
- **The lit lamp belongs to the app.** `apps/web` sets a round lamp after the
  wordmark (Plan-008, the prototype's) and lights it from
  `$("wm-lamp").classList.add("thinking")` while the model works, so there it
  is a live reading. In static materials it would be a light that is always
  on, which is why the landing page, the 404 and the README all set the
  wordmark in plain silk.
