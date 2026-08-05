# `www/` — the site

Four sections under one origin, assembled by `make site` into `site/`:

| Route | Source | Built with |
|---|---|---|
| `/` | `www/landing/` | Hand-authored HTML/CSS/JS, no build step |
| `/play/` | `apps/web/` + `make wasm` | The instrument itself |
| `/docs/` | `www/docs/` | mdBook — the product guide |
| `/reference/` | `www/reference/` | mdBook + KaTeX — the technical reference |
| `/reference/api/` | `cargo doc` | rustdoc for every crate |

```bash
make site-tools     # install the pinned doc toolchain (once)
make site           # build everything into site/
make site-serve     # http://localhost:8643
make site-check     # every link and asset must resolve
```

## Four rules this site keeps

**Everything is relative.** Pages serves from `alexnodeland.github.io/auracle/`,
so a root-absolute `/docs/` works locally and 404s in production. `make
site-check` treats one as an error rather than a warning. The only exception is
`404.html`, which is served at arbitrary depth and therefore computes the site
root in a few lines of JavaScript — see the comment in it.

**No external requests.** No CDN, no font service, no analytics. The identity
faces are self-hosted, KaTeX is vendored, and `make site-check` fails if a
`<script src>` or `<link>` pointing off-origin reappears. Outbound *hyperlinks*
are fine — the check is about subresources.

**Screenshots are real and published 1:1.** The app has a 10px type floor, so a
1440×900 frame scaled into a 750px column is unreadable. Frames are published at
their captured size and detail figures are *crops*, never shrunken frames. See
[SCREENSHOTS.md](./SCREENSHOTS.md).

**One copy of each asset in the repo.** The three identity faces live in
`apps/web/fonts/` and are copied to their consumers at build time; the
screenshots live in `www/landing/assets/screens/` and are copied into the
guide's `src/img/`. Both copies are gitignored, so a stale one cannot be
committed.

## Layout

```text
www/
  landing/          the landing page
    index.html
    style.css       inherits apps/web/style.css's tokens and its three laws
    hero.js         the interactive duel — real WebAudio, real Bradley–Terry
    assets/
      screens/      real app screenshots (webp)
      og.png        the social card
  theme/            ONE mdBook theme, shared by both books
    index.hbs       + the cross-site header; five marked divergences from mdBook's
    head.hbs
    highlight.css   phosphor code theme, serving both themes from one file
    css/variables.css   the palette, for `coal` (rack) and `light` (paper)
    fonts/          the faces, the vendored KaTeX package, and auracle.css
    favicon.svg / favicon.png
  docs/             the product guide  (book.toml + src/)
  reference/        the technical reference (book.toml + src/ + katex-macros.txt)
  viz/              the live-figure runtime, ONE source, three consumers
    viz.js          twelve figures + the shared core
    viz.css
  404.html
  robots.txt
  checklinks.py     the link/asset/anchor/subresource gate
  encode-screens.sh crop + encode raw captures into site assets
  SCREENSHOTS.md    how to recapture them
```

## Live figures

Twelve of them, declared in markdown and built by `www/viz/viz.js`:

```html
<figure class="viz" data-viz="log-axis">
<figcaption>…</figcaption>
</figure>
```

An unknown name is left alone, so a figure can be referenced before it is
written. They build lazily on scroll, and four rules keep them honest:

- **They compute, they do not illustrate.** The K-weighting curve is evaluated
  from the same biquad constants `auracle-features::loudness` uses and lands on
  +4.0 dB at 10 kHz on its own; the log-axis figure reproduces the 0.009 the
  prose quotes; the reliability diagram scores four hundred real forecasts. A
  drawing of a result is a claim about it.
- **They re-theme without rebuilding.** Every paint attribute is a
  `var(--phos-…)`, so a theme switch is a repaint and no JS knows which theme is
  on.
- **They work without a mouse.** Handles are focusable with arrow-key support and
  `aria-valuetext`; sliders are real `<input type=range>`; every figure has a
  `role="status"` readout, which is also the accessible equivalent of the picture.
- **They respect reduced motion.** The animated ones render a static end-state and
  say in words what the motion would have said — a stopped animation and a
  finished diagram are different pictures.

```admonish warning title="Arrow keys must not escape a figure"
mdBook binds ArrowLeft/ArrowRight on `document` to move between chapters, and
exempts only its search box. So a focused slider or handle navigated away from the
page mid-interaction, and `preventDefault` does not help — the document listener
runs regardless. `guardKeys()` stops those keys at the figure. Any new control
that consumes an arrow key is covered automatically; one that consumes some other
key needs adding to `OWNED_KEYS`.
```

## The toolchain is pinned, and 0.4 is current

```
mdBook 0.4.52 · mdbook-katex 0.9.4 · mdbook-admonish 1.20.0
```

**mdBook 0.5.x is not a drop-in.** It changed the preprocessor wire format, and
both preprocessors fail against it today with `Unable to parse the input` — so
0.5 is a choice between the theme and the math. Measured, not assumed. Revisit
when both have released 0.5-compatible versions.

`mdbook-katex` publishes **no prebuilt binaries at any version**, so CI compiles
it once and caches the result keyed on all three versions.

## Authoring

```bash
make docs-serve         # live-reloading guide
make reference-serve    # live-reloading reference
```

Both stage the identity faces into the theme first, which is why they are
Makefile targets rather than a bare `mdbook serve`.

New page: add the file under `src/`, add it to `src/SUMMARY.md`. mdBook will not
find it otherwise, and will not tell you.

### Things that fail quietly

Collected because each cost real time:

- **A KaTeX macro must be defined in `katex-macros.txt`, not in a
  `[preprocessor.katex.macros]` table.** The table form parses without complaint
  and is then ignored; every macro renders as "Undefined control sequence", which
  is a build *warning*, so it deploys. CI greps for it.
- **`*/` inside a CSS comment closes the comment**, and the browser then eats the
  following rule as error recovery. A path glob in prose is enough to do it.
- **`[hidden]` is a UA rule at type strength**, so any class that sets `display`
  defeats it silently.
- **`hidden` inside an HTML comment is still parsed by handlebars** if you write
  a partial's name in braces — `head.hbs` says so at the top.
- **mdBook copies only the flat files in `theme/fonts/`.** Subdirectories are
  skipped with an INFO line, which is why the vendored KaTeX package is
  flattened.
- **mdBook nests `<pre><pre class="playground">`** for Rust blocks, so a border on
  `pre` draws twice.

## One known wart, kept on purpose

Search teasers on math-heavy pages show the rendered formula **and** its TeX
source: *"winsorized moments (μw,sw)(\mu…"*. mdBook indexes the page text,
and `output = "htmlAndMathml"` puts KaTeX's `<annotation
encoding="application/x-tex">` in it.

Switching to `output = "html"` would tidy the teasers and would also remove the
MathML, which is the only thing a screen reader can read — KaTeX marks its visual
output `aria-hidden`. A slightly noisy teaser is a much smaller cost than
inaccessible mathematics, so the annotation stays. Search itself ranks correctly;
only the excerpt is ugly.

## Regenerating the screenshots

[SCREENSHOTS.md](./SCREENSHOTS.md) — the capture is manual (it needs a browser
driving a live engine), the crop and encode are `./encode-screens.sh`.
