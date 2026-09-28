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

.PHONY: web-check all check build test test-verbose fmt fmt-check lint lint-fix clippy \
        js-check wasm-check smoke smoke-tools \
        climb search-check budget-ab islands phi-stats norm-peak fit-bench \
        closed-loop revalidate \
        wasm wasm-stamp serve doc bundle clean \
        site site-clean site-landing site-play site-docs site-reference \
        site-fonts site-brand site-api site-extras site-serve site-check \
        site-tools brand-rasters docs-serve reference-serve \
        film-sounds film-voice film film-rehearse film-record film-publish \
        film-record-all film-preview dev-check help install-hooks

all: check

## check: everything CI runs — format, lints as errors, the app's syntax and
## its pure-logic unit tests, the tooling's own checks, the wasm target, full
## test suite
check: fmt-check lint web-check dev-check wasm-check test

## help: every target with a description, in the order this file defines them
help:
	@awk '/^## [a-z][a-z0-9-]*:/ { sub(/^## /, ""); split($$0, a, ":"); \
		printf "  %-18s%s\n", a[1], substr($$0, length(a[1]) + 2) }' $(MAKEFILE_LIST)

## install-hooks: use the repo's git hooks (.githooks): fast format and syntax
## checks on staged files before each commit. Opt-in, per clone.
install-hooks:
	git config core.hooksPath .githooks
	@printf '  git hooks: .githooks (skip once with --no-verify)\n'

## dev-check: the tooling around the code stays sound — the agent docs'
## links, anchors and frontmatter, the constants the books quote by name, the
## Claude Code hooks against inputs they must block and pass, and the syntax
## of every film tool
dev-check:
	@python3 .claude/checks/check_docs.py
	@python3 www/checknames.py
	@bash .claude/checks/test_hooks.sh
	@for f in www/video/tools/*.mjs www/video/stage/*.js; do node --check $$f || exit 1; done
	@python3 -m py_compile www/video/tools/*.py www/video/voice/*.py
	@for f in www/video/tools/*.sh .claude/hooks/*.sh; do bash -n $$f || exit 1; done
	@printf '  film tools and hooks: syntax OK\n'

## web-check: every web module parses (js-check), and the pure-logic modules'
## unit tests pass
web-check: js-check
	node --test apps/web/tests/*.test.mjs

build:
	$(CARGO) build --workspace

# ─── the web app ─────────────────────────────────────────────────────────────

WEB_JS := $(wildcard apps/web/*.js)

## js-check: every app script parses. This is the only gate that catches a
## backtick inside live-audio.js's PROCESSOR template literal — the failure
## mode there is a worklet blob that silently never registers, not an error at
## the edit site (CONTRIBUTING § Sharp edges).
js-check:
	@command -v node >/dev/null || { \
		printf '  node not found — the web app is checked with `node --check`; install Node 18+\n'; exit 1; }
	@for f in $(WEB_JS); do node --check $$f || exit 1; done
	@printf '  %s: parse OK\n' $(WEB_JS)

## wasm-check: the engine compiles for wasm32, which the native build does not
## prove (cfg(target_arch) paths, wasm-bindgen signatures, `u64` at the
## boundary). CI ran this and `make check` did not, so "green locally" and
## "green in CI" were two different claims.
wasm-check:
	@rustup target list --installed 2>/dev/null | grep -q '^wasm32-unknown-unknown$$' || { \
		printf '  the wasm32 target is missing — run: rustup target add wasm32-unknown-unknown\n'; exit 1; }
	$(CARGO) check -p auracle-wasm --target wasm32-unknown-unknown --release

## smoke: boot the instrument in a real browser against the built wasm and
## require a clean console and a registered worklet, then provoke the failure
## flows (unparseable save, engine error, refused vote, profile import) and
## require each to be contained. Needs `make wasm` first, Node, and
## Playwright's Chromium (`make smoke-tools` once).
smoke:
	@test -f apps/web/pkg/auracle_wasm_bg.wasm || { printf '  no built engine — run `make wasm` first\n'; exit 1; }
	cd tests/web && npm ci --no-audit --no-fund && npx playwright test

## smoke-tools: Playwright's Chromium, once. CI passes --with-deps for the
## runner's system libraries; a workstation usually has them.
smoke-tools:
	cd tests/web && npm ci --no-audit --no-fund && npx playwright install chromium

## test: optimized — the grammar/features/session tests render real audio
## sample-by-sample; debug-mode DSP is ~20× slower
#
# `test-fast` is release codegen without release's shipping flags (see the
# profile in Cargo.toml). Same opt-level, so the suite runs at the same speed it
# always did; no fat LTO, so it stops paying a serialized link for five test
# binaries. CI builds the tests under this profile too — one definition of what
# an optimized test build is.
test:
	$(CARGO) test --workspace --profile test-fast

test-verbose:
	$(CARGO) test --workspace --profile test-fast -- --nocapture

fmt:
	$(CARGO) fmt --all

fmt-check:
	$(CARGO) fmt --all --check

lint:
	$(CARGO) clippy --workspace --all-targets -- -D warnings

lint-fix:
	$(CARGO) clippy --workspace --all-targets --fix --allow-dirty

clippy: lint

# ─── search health ───────────────────────────────────────────────────────────
#
# `make check` is a gate on *correctness*. It says nothing about whether the
# search still searches or whether the model still learns — those are
# statistical properties of a loop, measured over seeds, and they cost minutes
# of real audio rendering rather than seconds. A change can be green on `check`
# and have halved the pool's climb.
#
# So they live here, and the standing rule is: **anything that touches φ, the
# grammar prior, the audition stimulus, the surrogate or the MH kernel runs
# `make revalidate` on both sides of the change, and the paired table goes in
# the PR.** These targets exist so that is a command rather than a memory.
#
# `refinement_improves_pool` and `closed_loop_learns_synthetic_taste` are the
# always-on floors under all of this and they DO run in `make check`. Floors,
# not the measurement: they catch a loop that stopped working, not one that
# quietly got worse.
SEEDS ?= 16

## climb: does the pool still climb? The iteration loop for any φ change.
climb:
	$(CARGO) run -p auracle-session --example search_health --release -- --climb $(SEEDS)

## search-check: the full search-health battery (all five measurements)
search-check:
	$(CARGO) run -p auracle-session --example search_health --release

## islands: can refinement leave the island it started on? (bimodal user)
islands:
	$(CARGO) run -p auracle-session --example search_health --release -- --islands 8

## budget-ab: re-derive the shipped (refine_steps, refine_seeds) split
budget-ab:
	$(CARGO) run -p auracle-session --example search_health --release -- --budget-ab

## phi-stats: composition, feature ranges, prevalence and VIF over prior draws
phi-stats:
	$(CARGO) run -p auracle-features --example pipeline_stats --release -- 1200

## norm-peak: peak distribution of normalized renders against the ceiling
norm-peak:
	$(CARGO) run -p auracle-features --example norm_peak --release -- 150

## fit-bench: posterior recovery against MCMC budget
fit-bench:
	$(CARGO) run -p auracle-taste --example fit_bench --release -- sweep 12

## closed-loop: the taste-loop gate swept over seeds (the noisy instrument)
closed-loop:
	$(CARGO) run -p auracle-session --example closed_loop_sweep --release

## revalidate: what a φ-touching change owes — run on BOTH sides, diff the tables
revalidate: phi-stats norm-peak climb search-check
	@printf '\n  revalidation complete — the paired before/after table goes in the PR\n\n'

## wasm: build the web app's engine into apps/web/pkg, and stamp the build
wasm:
	$(WASM_PATH) $(WASM_RUSTFLAGS) wasm-pack build crates/auracle-wasm --target web --release --out-dir ../../apps/web/pkg
	@$(MAKE) --no-print-directory wasm-stamp

# The version stamp main.js puts on its worker and wasm URLs (`?v=…`). A content
# hash over the engine and the app scripts, so the same bytes get the same URL
# and the ~2 MB binary is served from the browser's cache across reloads — and
# re-fetched exactly when it changed. Without the file the app falls back to
# `Date.now()`, which is correct and never cached. python3 because it is already
# required (serve.py, checklinks.py) and `sha256sum`/`shasum` differ by OS.
# Every app script, not a list: a module main.js imports with `?v=` (perform.js,
# midi.js) that was left out would keep its old URL when it changed and be
# served from cache.
WEB_STAMPED := apps/web/pkg/auracle_wasm_bg.wasm apps/web/pkg/auracle_wasm.js $(WEB_JS)
wasm-stamp:
	@python3 -c 'import hashlib, json, sys; h = hashlib.sha256(); [h.update(open(f, "rb").read()) for f in sys.argv[1:]]; json.dump({"build": h.hexdigest()[:16]}, open("apps/web/pkg/build.json", "w"))' $(WEB_STAMPED)
	@printf '  apps/web/pkg/build.json: %s\n' "$$(cat apps/web/pkg/build.json)"

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
	$(PRINT_ASSETS) site/docs/print.html
	# The theme's own notes are for contributors, not readers.
	rm -f site/docs/fonts/*.md

# mdBook's one-page print view inlines every chapter at the book's root and
# re-roots their links (href), but not raw HTML's src and poster: a film
# embedded in a nested chapter (../../assets/film/…) would point above the site
# there. From a book's print.html the site's assets are always ../assets/.
PRINT_ASSETS := python3 -c 'import re, sys; [(lambda t, p=p: open(p, "w").write(t))(re.sub(r"(src|poster)=(\x22)(?:\.\./)+assets/", r"\1=\2../assets/", open(p).read())) for p in sys.argv[1:]]'

## site-reference: the technical reference
site-reference: site-fonts site-brand
	mdbook build www/reference
	mkdir -p site/reference
	cp -r www/reference/book/. site/reference/
	$(PRINT_ASSETS) site/reference/print.html
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

## film-sounds: render the films' shared scores (signal, study, stingers), once
film-sounds:
	www/video/tools/sounds.sh

## film-voice: voice a film's script and time it to the words (FILM=name)
film-voice:
	www/video/tools/voice.sh $(FILM)

## film: render an illustrated film, voice to encode (FILM=name POSTER=seconds)
film:
	www/video/tools/illustrated.sh $(FILM) $(POSTER)

## film-rehearse: check and dry-run a walkthrough's shots, then summarise (FILM=name)
film-rehearse:
	node www/video/tools/validate.mjs $(FILM)
	www/video/tools/rehearse.sh $(FILM)

## film-record: record a walkthrough on a quiet machine and render it
## (FILM=name POSTER=seconds [DRAFT=1: fast MP4 + preview, no WebM] [SHOTS=a,b: re-record only these])
film-record:
	www/video/tools/walkthrough.sh $(FILM) $(POSTER) $(if $(DRAFT),--draft) $(if $(SHOTS),--shot $(SHOTS))

## film-record-all: record several walkthroughs (the quiet part), then finish
## each: encoded, previewed, cleared of its frame parts
## (FILMS="name poster name poster …" [DRAFT=1] [SHOTS=a,b])
film-record-all:
	www/video/tools/record_films.sh $(if $(DRAFT),--draft) $(if $(SHOTS),--shot $(SHOTS)) $(FILMS)

## film-preview: a 720p MP4 of a finished film, for review (FILM=name)
film-preview:
	www/video/tools/preview.sh $(FILM)

## film-publish: put finished films on the site, guide, reference and README (FILMS="a b")
film-publish:
	python3 www/video/tools/publish.py $(FILMS)

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
