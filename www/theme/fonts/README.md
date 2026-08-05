# `theme/fonts/` — and why the stylesheets are in here

This directory holds more than fonts, and that is a constraint rather than a
choice.

mdBook copies exactly **one** subdirectory of a custom theme verbatim:
`theme/fonts/`. Every other subdirectory is silently dropped — measured, not
assumed: a `theme/katex/` and a `theme/toplevel.txt` both vanish from the built
book with no warning. The obvious alternative, `additional-css`, does not help
either. mdBook emits that path *literally* instead of routing it through
`path_to_root`, so `additional-css = ["../theme/css/auracle.css"]` produces a
link that is wrong at every page depth **and** copies nothing.

Two books share this one theme (`theme = "../theme"` in both `book.toml`s), so
a per-book copy of the style layer would be two files to keep in sync. This
directory is the only channel that survives both `mdbook build` and
`mdbook serve` without a post-build patch step that would fix only the first.

| File | What it is |
|---|---|
| `fonts.css` | `@font-face` for the three identity faces |
| `auracle.css` | **the site's style layer** — typography, header, callouts, figures |
| `katex/` | vendored KaTeX 0.16.4 CSS + woff2, so math needs no CDN |
| `*.woff2` | the identity faces, **copied in by the build** |

`index.hbs` links all three stylesheets directly rather than chaining
`@import`s, so they load in parallel, and it links them *after* mdBook's
`general.css` and `chrome.css` — which is the reason the layer needs no
`!important` anywhere.

## The `.woff2` files are not committed here

They are copied from `apps/web/fonts/` by `make site` and `make docs-serve`,
and `www/theme/fonts/*.woff2` is gitignored. One copy of each face lives in the
repo and the instrument owns it: the faces are the product's identity, and two
copies is how one of them silently becomes stale.

`apps/web/fonts/README.md` is the argument for self-hosting them at all — the
short version is that the previous local-only stack resolved to Trebuchet MS
and Menlo on most machines, so the identity was a coin flip on the reader's OS.
