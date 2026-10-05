# Auracle development targets. `make check` is the CI gate.

CARGO := cargo
# The browser tests and the films run on the Node in .node-version, the one CI
# runs. When fnm has it, it goes first on every recipe's PATH, whatever the
# shell's node is (Playwright 1.56's browser install hangs on Node 26). First,
# so the PATHs below include it.
NODE_BIN := $(shell fnm exec --using="$$(cat .node-version)" sh -c 'dirname "$$(command -v node)"' 2>/dev/null)
ifneq ($(NODE_BIN),)
export PATH := $(NODE_BIN):$(PATH)
endif
# Homebrew's rustc shadows rustup's and lacks the wasm std — always prefer
# ~/.cargo/bin for wasm builds and checks.
WASM_PATH := PATH="$(HOME)/.cargo/bin:$(PATH)"
# The film tools run on .venv-voice when it exists (make film-setup puts the
# voice and the film tools' packages there), else on the python3 on PATH.
FILM_ENV := PATH="$(CURDIR)/.venv-voice/bin:$(PATH)"

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
# Added to the caller's RUSTFLAGS, not in place of them: CI sets -Dwarnings, and
# the engine job's wasm32 build is where a warning only that target has (a
# helper only the native-only items use) must fail.
WASM_RUSTFLAGS := RUSTFLAGS="$(RUSTFLAGS) -C link-arg=-zstack-size=$(WASM_STACK)"

.PHONY: setup film-setup web-check all check build test test-verbose fmt fmt-check lint lint-fix clippy \
        js-check wasm-check smoke smoke-tools \
        nextest-installed test-fast-tier test-slow-tier test-search-floor test-slow-rest \
        browser-fast browser-changed browser-slow \
        climb search-check budget-ab islands phi-stats norm-peak fit-bench \
        closed-loop walk-payload offer-census revalidate \
        wasm wasm-prebuilt wasm-stamp perform-wirings serve doc bundle clean \
        site site-clean site-landing site-play site-docs site-reference \
        site-fonts site-brand site-api site-extras site-serve site-check \
        site-tools brand-rasters docs-serve reference-serve \
        film-sounds film-voice film film-rehearse film-record film-publish \
        film-record-all film-preview dev-check tokens sound help install-hooks

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
## setup: install what the engine, the app and its tests need (scripts/setup.sh)
setup:
	scripts/setup.sh

## film-setup: setup, plus the films: .venv-voice (voice + film tools), the
## voice models and the shared sound (scripts/setup.sh --film)
film-setup:
	scripts/setup.sh --film

install-hooks:
	git config core.hooksPath .githooks
	@printf '  git hooks: .githooks (skip once with --no-verify)\n'

## dev-check: the tooling around the code stays sound: the agent docs'
## links, anchors and frontmatter, the constants the books quote by name, the
## design tokens (every generated block current, no color written outside
## www/brand/tokens.json, no token redefined after its block, each file's
## count of literal sizes and durations at www/brand/sizes-baseline.json, and
## the check's own tests), the voice (each file's
## count of banned words, em dashes and British spellings exactly at
## www/brand/voice-baseline.json, and the check's own tests), the films' sound
## (the scores and mix defaults generated from www/brand/sound.json current,
## its description of the record scores' notes true, no number as a film
## tool's level default or a pipeline's fallback, and the check's own tests), the
## Claude Code hooks against inputs they must block and pass, the syntax of
## every film tool, and the film tools' own tests (on .venv-voice when it
## exists)
##
## Its parts write nothing in the tree but Python's bytecode caches (written
## atomically), so they are prerequisites that `make -j` runs side by side (CI runs `make -j4 -O dev-check`); a plain
## `make dev-check` runs them one after another as before.
DEV_CHECKS := dev-docs dev-names dev-tokens dev-voice dev-sound dev-hooks dev-syntax dev-film-tests
dev-check: $(DEV_CHECKS)
.PHONY: $(DEV_CHECKS)

dev-docs:
	@python3 .claude/checks/check_docs.py
dev-names:
	@python3 www/checknames.py
dev-tokens:
	@python3 www/brand/tokens.py --check
	@python3 www/brand/test_tokens.py
dev-voice:
	@python3 www/checkwords.py
	@python3 www/test_checkwords.py
dev-sound:
	@python3 www/brand/sound.py --check
	@python3 www/brand/test_sound.py
dev-hooks:
	@bash .claude/checks/test_hooks.sh
dev-syntax:
	@for f in www/video/tools/*.mjs www/video/stage/*.js; do node --check $$f || exit 1; done
	@python3 -m py_compile www/video/tools/*.py www/video/voice/*.py
	@for f in www/video/tools/*.sh .claude/hooks/*.sh; do bash -n $$f || exit 1; done
	@printf '  film tools and hooks: syntax OK\n'
dev-film-tests:
	@for f in www/video/tools/test_*.py; do $(FILM_ENV) python3 $$f || exit 1; done

## tokens: write the colors, font families, type scale, spacing, radii and
## motion in www/brand/tokens.json into every surface's stylesheet (the
## generated blocks are committed)
tokens:
	@python3 www/brand/tokens.py

## sound: write the films' sound in www/brand/sound.json into the marks' and
## the bed's scores (www/video/sound/) and the mix's defaults
## (www/video/tools/sound_defaults.py); the generated files are committed
sound:
	@python3 www/brand/sound.py

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
## the edit site (CONTRIBUTING § Sharp edges). Parsed as the ES modules they
## are: `node --check file.js` reads a .js as CommonJS first and let a name
## declared twice inside a function (a SyntaxError the browser refuses the
## whole module for) pass as "parse OK".
js-check:
	@command -v node >/dev/null || { \
		printf '  node not found — the web app is checked with `node --check`; install Node 18+\n'; exit 1; }
	@for f in $(WEB_JS); do node --check --input-type=module < $$f || { printf '  in %s\n' $$f; exit 1; }; done
	@printf '  %s: parse OK\n' $(WEB_JS)

## wasm-check: the engine compiles for wasm32, which the native build does not
## prove (cfg(target_arch) paths, wasm-bindgen signatures, `u64` at the
## boundary), with warnings as errors as CI's wasm32 build has them
wasm-check:
	@rustup target list --installed 2>/dev/null | grep -q '^wasm32-unknown-unknown$$' || { \
		printf '  the wasm32 target is missing — run: rustup target add wasm32-unknown-unknown\n'; exit 1; }
	$(WASM_PATH) RUSTFLAGS="$(RUSTFLAGS) -Dwarnings" $(CARGO) check -p auracle-wasm --target wasm32-unknown-unknown --release

## smoke: boot the instrument in a real browser against the built wasm and
## require a clean console and a registered worklet, then provoke the failure
## flows (unparseable save, engine error, refused vote, profile import) and
## require each to be contained. Needs `make wasm` first, Node, and
## Playwright's Chromium (`make smoke-tools` once).
smoke:
	@test -f apps/web/pkg/auracle_wasm_bg.wasm || { printf '  no built engine — run `make wasm` first\n'; exit 1; }
	cd tests/web && npm ci --no-audit --no-fund && npx playwright test smoke.spec.js failure_flows.spec.js

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

# ─── CI's two tiers ──────────────────────────────────────────────────────────
#
# CI splits the tests into a fast tier that gates merging and a slow tier that
# runs on main, nightly, and on a PR that touches what it covers (see
# docs/architecture/testing.md § CI tiers). These targets run each tier the
# way CI does, so "green in CI" can be reproduced by name. `make test` and
# `make check` still run every Rust test; nothing here replaces them.
#
# The slow Rust tests are the ones that took over a minute in CI (runner times
# from PR #65's run, in the commit that introduced this list). They are named
# here and nowhere else: the fast tier is *everything not named*, so a new or
# renamed test lands in the fast tier and is never dropped from both, and
# `--no-tests=fail` turns a list that no longer matches anything into a red
# run. The search floor is split off because it alone is ~330 s on a runner:
# it walks 16 seeds, one thread each, and gets a runner to itself.
SEARCH_FLOOR := test(=tests::refinement_improves_pool)
SLOW_TESTS := test(=perform::tests::an_aimed_offer_moves_the_way_it_was_turned) \
	| test(=perform::tests::a_planned_measurement_is_the_measurement) \
	| test(=tests::a_walk_is_a_function_of_its_job) \
	| test(=perform::tests::named_controls_move_the_sound_they_name) \
	| test(=tests::evolve_from_this_on_the_farm_is_evolve_from_this) \
	| test(=tests::closed_loop_learns_synthetic_taste) \
	| test(=tests::closed_loop_learns_motion_rate) \
	| test(=perform::tests::drift_is_local_and_follows_sigma) \
	| test(=perform::tests::a_stepped_walk_is_the_walk) \
	| test(=tests::farm_walks_breed_the_serial_generation) \
	| test(=tests::a_generation_absorbed_in_any_completion_order_is_the_serial_one)
NEXTEST := $(CARGO) nextest run --workspace --cargo-profile test-fast --no-tests=fail
# CI passes `--partition hash:k/N` here to split the fast tier across runners.
NEXTEST_ARGS ?=

nextest-installed:
	@$(CARGO) nextest --version >/dev/null 2>&1 || { \
		printf '  cargo-nextest is missing — run: cargo install cargo-nextest --locked\n'; exit 1; }

## test-fast-tier: the Rust tests CI requires on every PR (all but the slow ones)
test-fast-tier: nextest-installed
	$(NEXTEST) -E 'not ($(SEARCH_FLOOR) | $(SLOW_TESTS))' $(NEXTEST_ARGS)

## test-slow-tier: the slow Rust tests: the search floor, then the rest
test-slow-tier: test-search-floor test-slow-rest

## test-search-floor: `refinement_improves_pool` alone (~5 min on a runner)
test-search-floor: nextest-installed
	$(NEXTEST) -E '$(SEARCH_FLOOR)' $(NEXTEST_ARGS)

## test-slow-rest: the slow tier's Rust tests other than the search floor
test-slow-rest: nextest-installed
	$(NEXTEST) -E '$(SLOW_TESTS)' $(NEXTEST_ARGS)

# The browser tiers: a spec tagged `@slow` (tests/web/AGENTS.md says when) or
# `@quarantine` (testing.md § Flakes) runs in the slow tier, every other one in
# the fast tier. Through the browser queue
# and on a port of their own, like any local browser job (ADR-010): the port
# is BROWSER_PORT when set, else AURACLE_TEST_PORT when the environment sets
# it (a branch's worktree is given one; docs/process.md § The machine), else
# 8690.
# Needs `make wasm` first and Playwright's Chromium (`make smoke-tools` once).
BROWSER_PORT ?= $(or $(AURACLE_TEST_PORT),8690)
PLAYWRIGHT := cd tests/web && AURACLE_TEST_PORT=$(BROWSER_PORT) \
	../../www/video/tools/one_browser.sh npx playwright test

## browser-fast: browser specs not tagged @slow or @quarantine, CI's fast tier (~70 min serially)
browser-fast:
	@test -f apps/web/pkg/auracle_wasm_bg.wasm || { printf '  no built engine — run `make wasm` first\n'; exit 1; }
	$(PLAYWRIGHT) --grep-invert "@slow|@quarantine" --reporter=line

## browser-changed: the specs your change reaches against BASE (origin/main):
## changed specs, the specs of a changed helper or app module (tests/web/changed.mjs)
BASE ?= origin/main
browser-changed:
	@test -f apps/web/pkg/auracle_wasm_bg.wasm || { printf '  no built engine — run `make wasm` first\n'; exit 1; }
	@specs="$$(cd tests/web && node changed.mjs $(BASE))"; \
	if [ -z "$$specs" ]; then printf '  no spec to run for this change\n'; exit 0; fi; \
	printf '  %s\n' $$specs; \
	$(PLAYWRIGHT) $$specs --reporter=line

## browser-slow: browser specs tagged @slow or @quarantine, CI's slow tier (~35 min serially)
browser-slow:
	@test -f apps/web/pkg/auracle_wasm_bg.wasm || { printf '  no built engine — run `make wasm` first\n'; exit 1; }
	$(PLAYWRIGHT) --grep "@slow|@quarantine" --reporter=line

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
# the PR.** These targets exist so that is a command rather than a memory. A φ
# change also re-measures the preset wirings the app ships
# (`make perform-wirings`); `make test` fails until it has.
#
# `refinement_improves_pool` and `closed_loop_learns_synthetic_taste` are the
# always-on floors under all of this and they DO run in `make check`, and in
# CI's slow tier (on main, nightly, and on any PR that touches crates/). Floors,
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

## walk-payload: what a generation's walks cost to ship to the render farm (RFC-001)
walk-payload:
	$(CARGO) run -p auracle-session --example walk_payload --release

## offer-census: how far a search control's aimed offer moves, and what it
## costs in taste, at several γ (the measurement behind AIM_GAMMA)
offer-census:
	$(CARGO) run -p auracle-session --example offer_census --release -- 16 2 20

## revalidate: what a φ-touching change owes — run on BOTH sides, diff the tables
revalidate: phi-stats norm-peak climb search-check
	@printf '\n  revalidation complete — the paired before/after table goes in the PR\n'
	@printf '  a φ change also owes `make perform-wirings` (the shipped preset wirings)\n\n'

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
WEB_STAMPED := apps/web/pkg/auracle_wasm_bg.wasm apps/web/pkg/auracle_wasm.js $(WEB_JS) apps/web/perform-wirings.json
wasm-prebuilt:
	@test -f apps/web/pkg/auracle_wasm_bg.wasm || { printf '  WASM_PREBUILT=1 but apps/web/pkg has no engine\n'; exit 1; }
	@$(MAKE) --no-print-directory wasm-stamp

wasm-stamp:
	@python3 -c 'import hashlib, json, sys; h = hashlib.sha256(); [h.update(open(f, "rb").read()) for f in sys.argv[1:]]; json.dump({"build": h.hexdigest()[:16]}, open("apps/web/pkg/build.json", "w"))' $(WEB_STAMPED)
	@printf '  apps/web/pkg/build.json: %s\n' "$$(cat apps/web/pkg/build.json)"

## perform-wirings: measure PERFORM's wiring of every preset natively, the way
## the worker does, into apps/web/perform-wirings.json (a few minutes; commit
## the file). `make test` fails while it is stale: a preset or a named input
## changed, or a re-measured sample (φ, the standard pool, a wiring) differs.
## Owed by every φ change. THREADS=n to use n cores.
perform-wirings:
	nice -n 10 $(CARGO) run -p auracle-wasm --example preset_wirings --release -- $(or $(THREADS),2) apps/web/perform-wirings.json

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

## site: build every section into site/ (what CI's deploy job publishes)
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

## site-play: the instrument, at /play/. `WASM_PREBUILT=1` takes the engine
## already in apps/web/pkg (CI's Site job downloads the one the engine job
## built) instead of building it again
site-play: $(if $(filter 1,$(WASM_PREBUILT)),wasm-prebuilt,wasm)
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

## film-sounds: render the shared beds of the films not yet on N3 (signal, study)
film-sounds:
	$(FILM_ENV) www/video/tools/sounds.sh

## film-voice: voice a film's script and time it to the words (FILM=name)
film-voice:
	$(FILM_ENV) www/video/tools/voice.sh $(FILM)

## film: render an illustrated film, voice to encode (FILM=name POSTER=seconds)
film:
	$(FILM_ENV) www/video/tools/illustrated.sh $(FILM) $(POSTER)

## film-rehearse: check and dry-run a walkthrough's shots, then summarise (FILM=name)
film-rehearse:
	node www/video/tools/validate.mjs $(FILM)
	$(FILM_ENV) www/video/tools/rehearse.sh $(FILM)

## film-record: record a walkthrough on a quiet machine and render it
## (FILM=name POSTER=seconds [DRAFT=1: fast MP4 + preview, no WebM] [SHOTS=a,b: re-record only these])
film-record:
	$(FILM_ENV) www/video/tools/walkthrough.sh $(FILM) $(POSTER) $(if $(DRAFT),--draft) $(if $(SHOTS),--shot $(SHOTS))

## film-record-all: record several walkthroughs (the quiet part), then finish
## each: encoded, previewed, cleared of its frame parts
## (FILMS="name poster name poster …" [DRAFT=1] [SHOTS=a,b])
film-record-all:
	$(FILM_ENV) www/video/tools/record_films.sh $(if $(DRAFT),--draft) $(if $(SHOTS),--shot $(SHOTS)) $(FILMS)

## film-preview: a 720p MP4 of a finished film, for review (FILM=name)
film-preview:
	$(FILM_ENV) www/video/tools/preview.sh $(FILM)

## film-publish: put finished films on the site, guide, reference and README (FILMS="a b")
film-publish:
	$(FILM_ENV) python3 www/video/tools/publish.py $(FILMS)

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
