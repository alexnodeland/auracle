# Auracle development targets. `make check` is the CI gate.

CARGO := cargo
# Homebrew's rustc shadows rustup's and lacks the wasm std — always prefer
# ~/.cargo/bin for wasm builds.
WASM_PATH := PATH="$(HOME)/.cargo/bin:$(PATH)"

# wasm32's default stack is 1 MB, and the patch compiler is recursive: every
# level of `Compiler::build` constructs quiver modules *by value* before moving
# them into the patch, and some of those are large inline buffers — a
# `PitchShifter` carries [f64; 4800] (38 KB) and a `Granular` more than that.
# A dozen-module patch with the v2 palette overflows it, which wasm reports as
# "memory access out of bounds" and which then poisons the engine: the panic
# unwinds out of a `&mut self` binding and every later call fails with
# wasm-bindgen's "recursive use of an object" instead of the real fault.
#
# 8 MB is the same order as the native main-thread stack the test suite runs
# on, which is why `make check` never saw this. Costs nothing but address
# space; the AudioWorklet build gets it too, and it compiles the same patches.
WASM_STACK := 8388608
WASM_RUSTFLAGS := RUSTFLAGS="-C link-arg=-zstack-size=$(WASM_STACK)"

.PHONY: all check build test test-verbose fmt fmt-check lint lint-fix clippy \
        wasm serve doc bundle clean \
        site site-clean site-landing site-play site-docs site-reference \
        site-fonts site-brand site-api site-extras site-serve site-check \
        site-tools brand-rasters docs-serve reference-serve

all: check

## check: everything CI runs — format, lints as errors, full test suite
check: fmt-check lint test

build:
	$(CARGO) build --workspace

## test: release mode — the grammar/features/session tests render real audio
## sample-by-sample; debug-mode DSP is ~20× slower
test:
	$(CARGO) test --workspace --release

test-verbose:
	$(CARGO) test --workspace --release -- --nocapture

fmt:
	$(CARGO) fmt --all

fmt-check:
	$(CARGO) fmt --all --check

lint:
	$(CARGO) clippy --workspace --all-targets -- -D warnings

lint-fix:
	$(CARGO) clippy --workspace --all-targets --fix --allow-dirty

clippy: lint

## wasm: build the web app's engine into apps/web/pkg
wasm:
	$(WASM_PATH) $(WASM_RUSTFLAGS) wasm-pack build crates/auracle-wasm --target web --release --out-dir ../../apps/web/pkg

## serve: no-store static server for apps/web on http://localhost:8642
serve:
	cd apps/web && python3 serve.py

## bundle: what the release workflow ships — a runnable web zip in dist/
bundle: wasm
	rm -rf dist && mkdir -p dist/auracle-web
	cp -r apps/web/. dist/auracle-web/
	printf '# Running Auracle\n\nPrebuilt web instrument — serve statically and open the URL:\n\n    python3 serve.py    # -> http://localhost:8642\n' > dist/auracle-web/RUNNING.md
	cd dist && zip -qr auracle-web.zip auracle-web

# ─── the site ────────────────────────────────────────────────────────────────
#
# Four sections under one origin, all reached by RELATIVE paths so the whole
# thing works from the Pages project subpath (…github.io/auracle/), from
# `make site-serve` at the root, and from a file:// copy. Nothing may hardcode
# /auracle.
#
#   site/                 the landing page
#   site/play/            the instrument (apps/web + the wasm engine)
#   site/docs/            the product guide      (mdBook)
#   site/reference/       the technical reference (mdBook + KaTeX)
#   site/reference/api/   rustdoc for every crate
#
# Pinned doc toolchain — `make site-tools` installs exactly these. mdBook 0.5.x
# is NOT a drop-in: it changed the preprocessor wire format and both katex and
# admonish fail against it today, so 0.4 is the current stack rather than a
# stale one.
MDBOOK_VERSION := 0.4.52
MDBOOK_KATEX_VERSION := 0.9.4
MDBOOK_ADMONISH_VERSION := 1.20.0

## site: build every section into site/ (what the Pages workflow publishes)
site: site-clean site-landing site-play site-docs site-reference site-api site-extras
	@printf '\n  site/ assembled — %s files, %s\n' \
		"$$(find site -type f | wc -l | tr -d ' ')" "$$(du -sh site | cut -f1)"
	@printf '  serve it with: make site-serve\n\n'

site-clean:
	rm -rf site
	mkdir -p site

## site-landing: the hand-authored landing page
site-landing: site-fonts site-brand
	mkdir -p site/fonts site/assets
	cp -r www/landing/. site/
	# The identity faces live once in the repo, with the instrument, and are
	# copied to each consumer at build time — see www/theme/fonts/README.md.
	cp apps/web/fonts/*.woff2 site/fonts/
	# The marks live once too, in www/brand. Same rule, same reason: three
	# favicon copies drifting apart is the bug this directory exists to stop.
	cp www/brand/mark.svg site/favicon.svg
	cp www/brand/favicon.png site/favicon.png
	cp www/brand/apple-touch-icon.png site/
	cp www/brand/og.png site/assets/og.png
	# One runtime, three consumers — the landing page reads it from the root.
	cp www/viz/viz.js www/viz/viz.css site/

## site-play: the instrument, at /play/
site-play: wasm
	mkdir -p site/play
	cp -r apps/web/. site/play/
	# serve.py is for local development; Pages is the server here.
	rm -f site/play/serve.py

## site-docs: the product guide
site-docs: site-fonts site-brand
	# The guide's figures are the landing page's screenshots; one copy in the
	# repo, copied to whoever needs it.
	mkdir -p www/docs/src/img
	cp www/landing/assets/screens/*.webp www/docs/src/img/
	mdbook build www/docs
	mkdir -p site/docs
	cp -r www/docs/book/. site/docs/
	# The theme's own notes are for contributors, not readers.
	rm -f site/docs/fonts/*.md

## site-reference: the technical reference
site-reference: site-fonts site-brand
	mdbook build www/reference
	mkdir -p site/reference
	cp -r www/reference/book/. site/reference/
	rm -f site/reference/fonts/*.md

# mdBook copies theme/fonts/ verbatim, and that is the only directory it will
# carry out of a shared theme — so the faces and the figure runtime are staged
# into it before a build. Both are gitignored copies: the faces belong to
# apps/web and the runtime to www/viz, and one source each is the whole point.
site-fonts:
	cp apps/web/fonts/*.woff2 www/theme/fonts/
	cp www/viz/viz.js www/viz/viz.css www/theme/fonts/

# The same staging trick for the mark. mdBook picks up `theme/favicon.svg` and
# `theme/favicon.png` by those exact names, so www/brand's copies are placed
# under them before a build. Gitignored, like the faces above — www/brand is
# the one source, and nothing else in the repo is allowed to hold a mark.
site-brand:
	cp www/brand/mark.svg www/theme/favicon.svg
	cp www/brand/favicon.png www/theme/favicon.png

## site-api: rustdoc for every crate, at /reference/api/
site-api:
	$(CARGO) doc --workspace --no-deps
	mkdir -p site/reference/api
	cp -r target/doc/. site/reference/api/

site-extras:
	# Pages must not run the artifact through Jekyll, which would drop the
	# underscore-prefixed wasm-bindgen files.
	touch site/.nojekyll
	cp www/404.html site/404.html
	cp www/robots.txt site/robots.txt
	# The brand spec, at /brand/. It is deliberately not in the menu bar — it
	# is for whoever is about to draw something, not for someone here to play.
	mkdir -p site/brand
	cp www/brand/index.html site/brand/
	cp www/brand/mark.svg www/brand/mark-active.svg site/brand/
	cp -r www/brand/icon-set site/brand/

## site-serve: serve the assembled site on http://localhost:8643
site-serve:
	@printf '  http://localhost:8643/  —  also /docs/ /reference/ /reference/api/ /play/\n'
	cd site && python3 -m http.server 8643

## site-check: every relative link and asset in site/ must resolve
site-check:
	python3 www/checklinks.py site

## brand-rasters: re-render www/brand's committed PNGs from mark.svg
# The PNGs are committed so that neither CI nor a contributor needs a renderer
# installed to build the site — this target is for after mark.svg changes, and
# needs rsvg-convert and ImageMagick.
brand-rasters:
	rsvg-convert -w 32 -h 32 www/brand/mark.svg -o www/brand/favicon.png
	# Full-bleed: iOS lays its own superellipse mask over a touch icon, so
	# flattening onto the rack colour squares the corners rather than letting
	# the tile's own rounding show through as dark notches.
	rsvg-convert -w 180 -h 180 www/brand/mark.svg | \
		magick png:- -background '#0c0d10' -flatten www/brand/apple-touch-icon.png
	@printf '\n  favicon.png and apple-touch-icon.png rebuilt from mark.svg.\n'
	@printf '  lockup.png and og.png set the LOGOTYPE, so they cannot come from\n'
	@printf '  an SVG renderer with no Jost. Serve the repo and screenshot the\n'
	@printf '  #banner and #og elements of www/brand/render.html instead.\n\n'

## site-tools: install the pinned doc toolchain
site-tools:
	@command -v mdbook >/dev/null || \
		$(CARGO) install mdbook --version $(MDBOOK_VERSION) --locked
	@command -v mdbook-katex >/dev/null || \
		$(CARGO) install mdbook-katex --version $(MDBOOK_KATEX_VERSION) --locked
	@command -v mdbook-admonish >/dev/null || \
		$(CARGO) install mdbook-admonish --version $(MDBOOK_ADMONISH_VERSION) --locked
	@mdbook --version && mdbook-katex --version && mdbook-admonish --version

## docs-serve: live-reloading authoring loop for the guide
docs-serve: site-fonts site-brand
	mdbook serve www/docs --open

## reference-serve: live-reloading authoring loop for the reference
reference-serve: site-fonts site-brand
	mdbook serve www/reference --open

doc:
	$(CARGO) doc --workspace --no-deps --open

clean:
	$(CARGO) clean
	rm -rf apps/web/pkg site www/docs/book www/reference/book
	rm -f www/theme/fonts/*.woff2 www/theme/fonts/viz.js www/theme/fonts/viz.css
	rm -f www/theme/favicon.svg www/theme/favicon.png
	rm -f www/docs/src/img/*.webp
