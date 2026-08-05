# Vendored KaTeX 0.16.4 (CSS + woff2 only)

`mdbook-katex` renders every `$…$` at **build time**, so the published pages
contain finished markup and need no JavaScript to show a formula. What that
markup still needs is KaTeX's stylesheet and its twenty font faces — KaTeX's
HTML output is a stack of absolutely-positioned spans whose geometry the CSS
supplies, so without it a rendered equation is not plain text, it is rubble.

`no-css = true` in both books' `book.toml` stops the preprocessor emitting its
default `<link>` to `cdn.jsdelivr.net`, and this directory replaces it. That is
the same argument `apps/web/fonts/README.md` makes about the identity faces:
a page whose typography depends on a third party is a page whose typography is
someone else's uptime. It also means the whole site works offline, from a
`file://` copy, and under a strict CSP.

## Why it lives under `theme/fonts/`

mdBook copies exactly one directory out of a custom theme verbatim —
`theme/fonts/` — and ignores every other subdirectory (measured; a
`theme/katex/` is silently dropped). Nesting the package here is what makes it
arrive in the built book under both `mdbook build` **and** `mdbook serve`,
without a post-build copy step that would only fix the former. `fonts.css`
pulls it in with a relative `@import`, so it resolves at any page depth and
under any base path.

## Refreshing it

Pinned to 0.16.4 because that is the KaTeX build `mdbook-katex` 0.9.4 embeds;
the CSS and the HTML it styles are one version pair, so bump them together or
neither.

```bash
cd www/theme/fonts/katex
curl -sSf https://cdn.jsdelivr.net/npm/katex@0.16.4/dist/katex.min.css -o katex.min.css
grep -o 'fonts/KaTeX_[A-Za-z0-9_-]*\.woff2' katex.min.css | sort -u | sed 's|^fonts/||' \
  | while read -r f; do
      curl -sSf "https://cdn.jsdelivr.net/npm/katex@0.16.4/dist/fonts/$f" -o "fonts/$f"
    done
# Drop the woff and ttf sources: every browser that can run the app has woff2,
# so the extra `src` entries are dead weight that only ever 404.
perl -pi -e 's{,url\(fonts/KaTeX_[A-Za-z0-9_-]+\.woff\) format\("woff"\),url\(fonts/KaTeX_[A-Za-z0-9_-]+\.ttf\) format\("truetype"\)}{}g' katex.min.css
```

`make site-check` walks the built site and fails on any stylesheet reference
that does not resolve to a file, so a half-finished refresh cannot ship
quietly.
