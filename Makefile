# Auracle development targets. `make check` is the CI gate.

# The browser tests and the films run on the Node in .node-version, the one CI
# runs. When fnm has it, it goes first on every recipe's PATH, whatever the
# shell's node is (Playwright 1.56's browser install hangs on Node 26). First,
# so the PATHs below include it.
NODE_BIN := $(shell fnm exec --using="$$(cat .node-version)" sh -c 'dirname "$$(command -v node)"' 2>/dev/null)
ifneq ($(NODE_BIN),)
export PATH := $(NODE_BIN):$(PATH)
endif
# Every cargo, rustc, rustfmt and wasm-pack call runs rustup's proxies, which
# build with the toolchain rust-toolchain.toml pins (and install it on first
# use). Homebrew's cargo, first on PATH on a Mac that has both, ignores the
# file. Both halves below are needed, each measured on such a Mac:
# - CARGO names rustup's cargo by its path. make (3.81) runs a recipe line
#   with no shell syntax itself and finds the program on the PATH it started
#   with, not the one exported here: a bare `cargo test` ran Homebrew's cargo.
# - rustup's directory also goes first on every recipe's PATH. Even rustup's
#   cargo compiles with the first `rustc` on PATH (Homebrew's 1.96.1, when it
#   came first), and wasm-pack runs `cargo` by name.
CARGO_BIN := $(or $(CARGO_HOME),$(HOME)/.cargo)/bin
ifneq ($(wildcard $(CARGO_BIN)/cargo),)
CARGO := $(CARGO_BIN)/cargo
export PATH := $(CARGO_BIN):$(PATH)
else
# Without them, cargo and rustc come from PATH. Said once, by the first
# recipe that runs cargo or wasm-pack (RUSTUP_NOTE empties itself on use),
# and not at all by a target that builds no Rust.
RUSTUP_NOTE = $(eval RUSTUP_NOTE :=)$(warning no cargo in $(CARGO_BIN): cargo and rustc come from PATH, and rust-toolchain.toml applies only if they are rustup's proxies)
CARGO = $(RUSTUP_NOTE)cargo
endif
# sccache, on whenever it is installed (`make setup` installs it): every cargo
# call here compiles through it, so a new worktree's first build takes the
# crates.io dependencies from one cache on this disk instead of compiling
# them again (docs/architecture/testing.md § The local loop has what that
# saves). It is safe with a target directory per worktree, where sharing one
# target directory is not: sccache keys each compile by its inputs, among them
# every CARGO_* variable and the compile's working directory, so a workspace
# crate, whose CARGO_MANIFEST_DIR and directory differ in each worktree, never
# hits another worktree's entry; nor does a dependency that reads its build
# script's OUT_DIR (a variable its dep-info lists, which is hashed too, and a
# path inside the worktree). An incremental compile (the workspace's crates
# under test-fast, and clippy's) is not cached at all.
# Left alone when:
# - there is no sccache, or AURACLE_SCCACHE=0 (the builds are as they were
#   without one), or GITHUB_ACTIONS is set (CI's runners have rust-cache), or
#   RUSTC_WRAPPER is set, empty too, which names the wrapper;
# - the goals compile no Rust (RUST_GOALS; `make` alone is `all`): `make
#   serve`, `make dev-check` and the rest don't start a server or wait on one.
#   A goal left out of the list compiles without sccache, as before it;
# - its server does not answer on its port within ten seconds (a server that
#   is stuck, or another program on the port): said once, and the builds go
#   without it, where a server that does not answer would fail every compile.
#   AURACLE_SCCACHE=1 also says when there is no sccache.
# The server, not the cargo call, runs the compiles, and serves every
# checkout until it has been idle for ten minutes, so it is started here at a
# priority of 10 whatever the priority of the make that starts it (at its own
# when that is already 10 or more: a priority can't be raised back), and with
# the cache capped at SCCACHE_CACHE_SIZE, 2G here (sccache's own default is
# 10G; the three builds `make check` makes put about 0.3 G in it, and each
# worktree's own crates 0.05 G more), evicting the least recently used. A
# server that is already running keeps the priority and the cache size it was
# started with: `sccache --stop-server` stops it, and the next make starts it
# again.
# `make` alone makes `all` (said here, above the first target, so the list
# below can name it).
.DEFAULT_GOAL := all
RUST_GOALS := all check test test-verbose test-crate test-fast-tier test-slow-tier \
	test-search-floor test-slow-rest build lint lint-fix clippy doc wasm wasm-dev wasm-check \
	bundle coverage coverage-run coverage-archive mutants perform-wirings preset-faces \
	climb search-check islands budget-ab phi-stats norm-peak fit-bench closed-loop \
	walk-payload offer-census revalidate site site-api site-tools
ifneq ($(AURACLE_SCCACHE),0)
ifeq ($(origin RUSTC_WRAPPER),undefined)
ifeq ($(GITHUB_ACTIONS),)
SCCACHE := $(firstword $(wildcard $(CARGO_BIN)/sccache) $(shell command -v sccache 2>/dev/null))
ifneq ($(SCCACHE),)
ifneq ($(filter $(RUST_GOALS),$(or $(MAKECMDGOALS),$(.DEFAULT_GOAL))),)
SCCACHE_SIZE := $(or $(SCCACHE_CACHE_SIZE),2G)
SCCACHE_PORT := $(or $(SCCACHE_SERVER_PORT),4226)
# Whatever answers on its port is waited for ten seconds, not for ever.
SCCACHE_WITHIN := perl -e 'alarm 10; exec @ARGV'
# The increment that brings this make's priority to 10, or 0 when it is there
# already (`nice` on macOS can't print the priority; `ps` can).
SCCACHE_NICE := n=$$(ps -o nice= -p $$$$ 2>/dev/null | tr -d ' '); i=$$((10 - $${n:-0})); [ "$$i" -gt 0 ] || i=0
SCCACHE_UP := $(shell ($(SCCACHE_NICE); SCCACHE_CACHE_SIZE=$(SCCACHE_SIZE) nice -n "$$i" $(SCCACHE_WITHIN) $(SCCACHE) --start-server >/dev/null 2>&1; $(SCCACHE_WITHIN) $(SCCACHE) --show-stats >/dev/null 2>&1 && echo ok) 2>/dev/null)
ifeq ($(SCCACHE_UP),ok)
export RUSTC_WRAPPER := $(SCCACHE)
export SCCACHE_CACHE_SIZE := $(SCCACHE_SIZE)
else
$(warning sccache's server does not answer on port $(SCCACHE_PORT) within ten seconds: building without it. An sccache server there: `$(SCCACHE) --stop-server`, or end the process `lsof -iTCP:$(SCCACHE_PORT) -sTCP:LISTEN` names (--stop-server waits for ever on a server that does not answer). Another program: SCCACHE_SERVER_PORT=<a free port>. AURACLE_SCCACHE=0 builds without sccache and skips this wait)
endif
endif
else
ifeq ($(AURACLE_SCCACHE),1)
$(warning AURACLE_SCCACHE=1, but there is no sccache: run scripts/setup.sh; building without it)
endif
endif
endif
endif
endif

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

.PHONY: setup film-setup web-check spec-lint all check check-changed build test test-verbose fmt fmt-check lint lint-fix clippy \
        js-check wasm-check smoke smoke-tools worker-test \
        test-crate nextest-installed test-fast-tier test-slow-tier test-search-floor test-slow-rest \
        llvm-cov-installed coverage coverage-run coverage-archive coverage-report coverage-floors \
        mutants-installed mutants-diff mutants mutants-command \
        browser-fast browser-changed browser-slow \
        climb search-check budget-ab islands phi-stats norm-peak fit-bench \
        closed-loop walk-payload offer-census revalidate bench-render \
        wasm wasm-dev pkg-reuse wasm-prebuilt wasm-stamp perform-wirings preset-faces serve doc bundle clean \
        site site-clean site-landing site-play site-docs site-reference \
        site-fonts site-brand site-api site-extras site-serve site-check \
        site-tools brand-rasters docs-serve reference-serve \
        film-sounds film-voice film film-rehearse film-record film-publish \
        film-record-all film-preview dev-check tokens sound help install-hooks \
        worktree worktree-rm

all: check

## check: everything CI runs — format, lints as errors, the app's syntax and
## its pure-logic unit tests, the tooling's own checks, the wasm target, full
## test suite. `make -j check` runs the parts side by side
#
# Side by side, the parts don't wait for one another: cargo locks each
# profile's directory on its own, so lint (target/debug), wasm-check (the
# wasm32 release build) and test (target/test-fast) build at once, beside
# web-check and dev-check. Plain -j: macOS ships GNU Make 3.81, which has no
# -O and prints its usage instead. On GNU Make 4, `make -j -O check` also
# keeps each part's output together, as CI's Web job runs dev-check
# (`make -j4 -O dev-check`).
check: fmt-check lint web-check dev-check wasm-check test

## check-changed: the parts of `make check` your change reaches since BASE
## (origin/main), uncommitted and untracked files included, by the classifier
## CI's fast lane uses (scripts/changes.py), and what else CI runs for it.
## `make -j check-changed` runs them side by side
check-changed:
	@parts="$$(python3 scripts/changes.py check --base $(BASE))" || exit 1; \
	if [ -n "$$parts" ]; then $(MAKE) --no-print-directory $$parts; fi

## help: every target with a description, in the order this file defines them
help:
	@awk '/^## [a-z][a-z0-9-]*:/ { sub(/^## /, ""); split($$0, a, ":"); \
		printf "  %-18s%s\n", a[1], substr($$0, length(a[1]) + 2) }' $(MAKEFILE_LIST)

## install-hooks: use the repo's git hooks (.githooks): fast format and syntax
## checks on staged files before each commit. Opt-in, per clone.
## setup: install what the engine, the app and its tests need (scripts/setup.sh),
## sccache among them (`make` compiles through it; AURACLE_SCCACHE=0 skips it)
setup:
	scripts/setup.sh

## film-setup: setup, plus the films: .venv-voice (voice + film tools), the
## voice models and the shared sound (scripts/setup.sh --film)
film-setup:
	scripts/setup.sh --film

install-hooks:
	git config core.hooksPath .githooks
	@printf '  git hooks: .githooks (skip once with --no-verify)\n'

## worktree: a new branch's worktree, at .claude/worktrees/TOPIC in the main
## checkout (git ignores it), from any checkout: TOPIC's branch (claude/TOPIC,
## or BRANCH=) from a fresh origin/main, with tests/web's packages installed
## and the release engine of another checkout built from the same Rust, if
## there is one (`make pkg-reuse`; if not it says `make wasm` is owed); it
## prints the path (docs/process.md § Building)
## worktree-rm: once merged, remove TOPIC's worktree and the branch it is on
## (read from the worktree; BRANCH= only checks it); it refuses a worktree
## holding work not committed, one on no branch, and a branch whose commits
## no remote branch holds (FORCE=1 deletes them anyway: a merged branch whose
## remote branch was pruned)
# The main checkout is the one holding the repository (.git), whichever
# checkout make runs in: run from a worktree, the new one still goes beside it,
# not inside it.
MAIN_CHECKOUT = $(shell dirname "$$(git rev-parse --path-format=absolute --git-common-dir)")
WT_BRANCH = $(or $(BRANCH),claude/$(TOPIC))
worktree:
	@test -n "$(TOPIC)" || { printf '  name it: make worktree TOPIC=<topic> [BRANCH=<branch>]\n'; exit 1; }
	git -C "$(MAIN_CHECKOUT)" fetch -q origin
	git -C "$(MAIN_CHECKOUT)" worktree add -q -b $(WT_BRANCH) .claude/worktrees/$(TOPIC) origin/main
	cd "$(MAIN_CHECKOUT)/.claude/worktrees/$(TOPIC)/tests/web" && npm ci --no-audit --no-fund
	@cd "$(MAIN_CHECKOUT)/.claude/worktrees/$(TOPIC)" && $(MAKE) --no-print-directory pkg-reuse SOFT=1
	@[ -n "$(SCCACHE)" ] || [ "$(AURACLE_SCCACHE)" = 0 ] || [ -n "$(GITHUB_ACTIONS)" ] || [ "$(origin RUSTC_WRAPPER)" != undefined ] || \
		printf '  no sccache: its first build compiles the dependencies in full; scripts/setup.sh installs it, and the next one takes them from its cache\n'
	@printf '  %s, on %s\n' "$(MAIN_CHECKOUT)/.claude/worktrees/$(TOPIC)" "$(WT_BRANCH)"

# The branch to delete is the one the worktree is on, never one named from
# TOPIC: a worktree's branch need not be claude/TOPIC, and a claude/TOPIC
# elsewhere may hold other work. `branch -D`, since a squash merge leaves the
# branch unmerged to git; so first, unless FORCE=1, its commits must be on a
# remote branch (pushed, or in origin/main).
worktree-rm:
	@test -n "$(TOPIC)" || { printf '  name it: make worktree-rm TOPIC=<topic> [BRANCH=<branch>] [FORCE=1]\n'; exit 1; }
	@wt="$(MAIN_CHECKOUT)/.claude/worktrees/$(TOPIC)"; \
	test -f "$$wt/.git" || { printf '  no worktree at %s\n' "$$wt"; exit 1; }; \
	b="$$(git -C "$$wt" symbolic-ref -q --short HEAD)" || { \
		printf '  nothing removed: %s is on no branch (a detached HEAD); look at its commits, then git worktree remove it\n' "$$wt"; exit 1; }; \
	if [ -n "$(BRANCH)" ] && [ "$(BRANCH)" != "$$b" ]; then \
		printf '  nothing removed: %s is on %s, not %s\n' "$$wt" "$$b" "$(BRANCH)"; exit 1; fi; \
	if [ -z "$(FORCE)" ] && [ -z "$$(git -C "$$wt" for-each-ref --contains "$$b" --count=1 refs/remotes)" ]; then \
		printf '  nothing removed: %s has commits no remote branch holds; push them, or, for a merged branch whose remote branch was pruned, FORCE=1 deletes them\n' "$$b"; exit 1; fi; \
	git -C "$(MAIN_CHECKOUT)" worktree remove "$$wt" && git -C "$(MAIN_CHECKOUT)" branch -D "$$b"

## dev-check: the tooling around the code stays sound: the agent docs'
## links, anchors and frontmatter (this checkout's, never a worktree's inside
## it, and the check's own tests), the constants the books quote by name, the
## design tokens (every generated block current, no color written outside
## www/brand/tokens.json, no token redefined after its block, each file's
## count of literal sizes and durations at www/brand/sizes-baseline.json, and
## the check's own tests), the voice (each file's
## count of banned words, em dashes and British spellings exactly at
## www/brand/voice-baseline.json, and the check's own tests), the films' sound
## (the scores and mix defaults generated from www/brand/sound.json current,
## its description of the record scores' notes true, no number as a film
## tool's level default or a pipeline's fallback, and the check's own tests), the
## changelog (every entry waiting in changelog.d/ parses, and the assembler's
## own tests), the PR checks' own tests (scripts/test_pr_checks.py: a PR's
## title, its issue links, the changelog's warning, what a merge does to the
## issues), the path classifier's tests (scripts/test_changes.py: what each
## kind of change reaches), the Claude Code hooks against inputs they must block and pass,
## the syntax of every film tool, the film tools' own tests (on .venv-voice
## when it exists), the tests of the coverage gate's, the mutation
## report's, CI stats', the engine stamp's and the release's scripts
## (scripts/test_release.py: the version the titles call for, the bump, what
## a tag owes, the list of what merged by type), and the operator's
## (dev-ops): the saved Claude Code workflows (.claude/workflows/), each run
## dry on stubbed agents by scripts/ops/check_workflows.mjs, that check's own
## tests, what the workflows promise the operator on scripted agents
## (workflows.test.mjs), and the tests and syntax of scripts/ops/
##
## Its parts write nothing in the tree but Python's bytecode caches (written
## atomically), so they are prerequisites that `make -j` runs side by side; a
## plain `make dev-check` runs them one after another as before. CI runs
## `make -j4 -O dev-check` on Linux (GNU Make 4, where `-O` keeps each part's
## output together); macOS ships GNU Make 3.81, which has no `-O`, so locally
## run plain `make -j8 dev-check` (the pre-commit hook does).
DEV_CHECKS := dev-docs dev-names dev-tokens dev-voice dev-sound dev-changelog dev-pr-checks dev-changes dev-hooks dev-syntax dev-film-tests dev-coverage dev-mutants dev-ci-stats dev-ops dev-wasm-pkg dev-release
dev-check: $(DEV_CHECKS)
.PHONY: $(DEV_CHECKS)

dev-docs:
	@python3 .claude/checks/check_docs.py
	@python3 .claude/checks/test_check_docs.py
dev-names:
	@python3 www/checknames.py
dev-tokens:
	@python3 www/brand/tokens.py --check
	@python3 www/brand/test_tokens.py
dev-voice:
	@python3 www/checkwords.py
	@python3 www/test_checkwords.py
	@python3 www/test_stamppage.py
dev-sound:
	@python3 www/brand/sound.py --check
	@python3 www/brand/test_sound.py
dev-changelog:
	@python3 scripts/changelog.py --check
	@python3 scripts/test_changelog.py
dev-pr-checks:
	@python3 scripts/test_pr_checks.py
dev-changes:
	@python3 scripts/test_changes.py
dev-hooks:
	@bash .claude/checks/test_hooks.sh
# The stage's scripts are ES modules: `node --check` on a .js with an
# `import` or `export` in it passes whatever follows (Node hands the file to
# its module loader, which --check never runs), so they are read as modules.
dev-syntax:
	@for f in www/video/tools/*.mjs; do node --check $$f || exit 1; done
	@for f in www/video/stage/*.js; do node --check --input-type=module < $$f || { printf '  in %s\n' $$f; exit 1; }; done
	@python3 -m py_compile www/video/tools/*.py www/video/voice/*.py
	@for f in www/video/tools/*.sh .claude/hooks/*.sh; do bash -n $$f || exit 1; done
	@printf '  film tools and hooks: syntax OK\n'
dev-film-tests:
	@for f in www/video/tools/test_*.py; do $(FILM_ENV) python3 $$f || exit 1; done
dev-coverage:
	@python3 scripts/test_coverage_gate.py
dev-mutants:
	@python3 scripts/test_mutants_report.py
dev-ci-stats:
	@python3 scripts/test_ci_stats.py
dev-ops:
	@node scripts/ops/check_workflows.mjs
	@node --test --test-reporter=dot scripts/ops/check_workflows.test.mjs scripts/ops/workflows.test.mjs
	@for f in scripts/ops/test_*.py; do python3 $$f || exit 1; done
	@for f in scripts/ops/*.sh; do bash -n $$f || exit 1; done
dev-wasm-pkg:
	@python3 scripts/test_wasm_pkg.py

dev-release:
	@python3 scripts/test_release.py

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

## web-check: every web module parses (js-check), the pure-logic modules'
## unit tests pass, the browser specs pass their lint (spec-lint), and CI's
## flake routing passes its tests: which issue a failed test is said on
## (tests/web/flakes.mjs) and how it is said there (.github/actions/file-issue);
## and so do the timings the browser runners are dealt by (tests/web/shard.mjs
## timings) and `make browser-changed`'s selection (tests/web/changed.test.mjs).
## With COVERAGE=1, what the unit tests ran of apps/web as well, as an lcov in
## target/js-cov/web.lcov
web-check: js-check spec-lint
	$(JS_COV_MKDIR)
	node --test $(call NODE_COV,web) apps/web/tests/*.test.mjs tests/web/flakes.test.mjs tests/web/shard.test.mjs tests/web/changed.test.mjs .github/actions/file-issue/file-issue.test.mjs

# COVERAGE=1: Node's own coverage of the lines of apps/web that web-check's
# unit tests and worker-test run (apps/web/tests and the generated pkg/ left
# out), written as an lcov per suite in JS_COV_DIR beside the usual output (the
# spec reporter, named because a second reporter replaces the default). CI's
# Web and Worker protocol jobs ask for it and upload the lcov to Codecov, a
# view only: the browser specs, which run most of apps/web, are not measured
# (docs/architecture/testing.md § Coverage). Off by default, so the local gates
# run as they always have. Needs Node 22.5 or later (CI's is 22: .node-version).
JS_COV_DIR := target/js-cov
NODE_COV = $(if $(COVERAGE),--experimental-test-coverage \
	--test-coverage-include='apps/web/**' \
	--test-coverage-exclude='apps/web/tests/**' --test-coverage-exclude='apps/web/pkg/**' \
	--test-reporter=spec --test-reporter-destination=stdout \
	--test-reporter=lcov --test-reporter-destination=$(JS_COV_DIR)/$(1).lcov)
JS_COV_MKDIR = $(if $(COVERAGE),@mkdir -p $(JS_COV_DIR))

## spec-lint: ESLint over tests/web's specs and helpers (tests/web/eslint.config.mjs):
## the Playwright plugin's recommended rules and the house rules, with no
## file's count of a rule above tests/web/eslint-suppressions.json and none
## below it unrecorded; the lint's own tests (eslint.test.mjs); the
## suppressions file against the merge base with BASE (origin/main): every
## key a file, no count risen, no file with a new entry (suppressions.mjs);
## and every test tagged @quarantine naming its issue (flakes.mjs check).
## tests/web/AGENTS.md § The lint. Run from tests/web, where the
## suppressions are; needs tests/web's packages (npm ci there).
LINT_PACKAGES := .bin/eslint eslint-plugin-playwright @eslint-community/eslint-plugin-eslint-comments
spec-lint:
	@for p in $(LINT_PACKAGES); do test -e tests/web/node_modules/$$p || { \
		printf '  ESLint is not installed in tests/web (no %s): run  cd tests/web && npm ci\n' "$$p"; exit 1; }; done
	@cd tests/web && node_modules/.bin/eslint . && node --test --test-reporter=dot eslint.test.mjs && node suppressions.mjs $(BASE) && node flakes.mjs check

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
## whole module for) pass as "parse OK". The saved workflows in
## .claude/workflows/ are not modules (a body with a top-level return): make
## dev-check runs them dry instead (dev-ops).
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
		printf '  the wasm32 target is missing — run: rustup toolchain install (it reads rust-toolchain.toml)\n'; exit 1; }
	RUSTFLAGS="$(RUSTFLAGS) -Dwarnings" $(CARGO) check -p auracle-wasm --target wasm32-unknown-unknown --release

## smoke: boot the instrument in a real browser against the built wasm and
## require a clean console and a registered worklet, then provoke the failure
## flows (unparseable save, engine error, refused vote, profile import) and
## require each to be contained. Needs `make wasm` first, Node, and
## Playwright's Chromium (`make smoke-tools` once).
# The two specs are tests/web/package.json's `smoke` script, which CI's
# Browser smoke job (ci.yml) runs too: name a spec there, not here.
smoke:
	$(RELEASE_ENGINE)
	cd tests/web && npm ci --no-audit --no-fund && npm run --silent smoke

## smoke-tools: Playwright's Chromium, once, on a workstation (which usually
## has its system libraries). CI needs none: its browser jobs run in
## Playwright's image, which has Chromium and its libraries.
smoke-tools:
	cd tests/web && npm ci --no-audit --no-fund && npx playwright install chromium

## worker-test: the worker-protocol tests (tests/worker): apps/web/worker.js
## run as it is in a Node worker thread over the built engine, with no page,
## for what it answers and in what order (its lanes). Needs `make wasm` first.
## Its files run four at a time on any machine (`--test-concurrency=4`), and a
## test fails at 150 s: CI's job limit counts on both.
## With COVERAGE=1, what they ran of apps/web as well, in target/js-cov/worker.lcov
worker-test:
	@test -f apps/web/pkg/auracle_wasm_bg.wasm || { printf '  no built engine in apps/web/pkg: run `make wasm` first\n'; exit 1; }
	$(JS_COV_MKDIR)
	node --test --test-concurrency=4 $(call NODE_COV,worker) tests/worker/*.test.mjs

## test: every Rust test, optimized (the grammar/features/session tests render
## real audio sample by sample; debug-mode DSP is ~20× slower), on nextest,
## then the doctests. Needs cargo-nextest (`make setup`)
#
# `test-fast` is release codegen without release's shipping flags (see the
# profile in Cargo.toml). Same opt-level, so the suite runs at the same speed it
# always did; no fat LTO, so it stops paying a serialized link for each test
# binary. CI builds the tests under this profile too — one definition of what
# an optimized test build is.
#
# The test builds name their targets (TEST_TARGETS): the libraries, the
# binaries and the test targets. Left to itself, `cargo test` (and nextest)
# also compiles every example and runs none: 34 of them, about half the
# workspace's compile CPU. `make lint` (clippy --all-targets) still compiles
# them. Naming targets turns the doctests off, so `test` runs them on their
# own (there are none today; CI's Doctests job checks that the same way).
#
# nextest runs every test in the workspace in one pool, each in a process of
# its own, where `cargo test` ran the workspace's test binaries one after
# another and waited on the slowest test of each before starting the next. What a
# test needs from that pool (the threads it starts, how long before it is
# slow, and when a hung one is stopped) is in .config/nextest.toml. nextest
# runs no doctests, hence the second line. It stops starting tests at the
# first failure, where `cargo test` finished the failing binary:
# `NEXTEST_ARGS=--no-fail-fast` runs them all (NEXTEST_ARGS takes any of
# nextest's options, a filter too).
TEST_TARGETS := --lib --bins --tests
test: nextest-installed
	$(NEXTEST) $(NEXTEST_ARGS)
	$(CARGO) test --workspace --profile test-fast --doc

# Every test's output, printed as it finishes (nextest's --no-capture would
# run them one at a time).
test-verbose: nextest-installed
	$(NEXTEST) --success-output immediate --failure-output immediate $(NEXTEST_ARGS)

## test-crate: one crate's tests, optimized, with the pinned compiler:
## `make test-crate CRATE=auracle-session` (FILTER= a test name filter;
## TEST_TARGETS="--test boot_agrees" for one test target). A bare `cargo test`
## in a shell with Homebrew's cargo or rustc first on PATH builds with those
test-crate:
	@test -n "$(CRATE)" || { printf '  name the crate: make test-crate CRATE=auracle-<crate>\n'; exit 2; }
	$(CARGO) test -p $(CRATE) --profile test-fast $(TEST_TARGETS) $(FILTER)

# ─── CI's two tiers ──────────────────────────────────────────────────────────
#
# CI splits the tests into a fast tier that gates merging and a slow tier that
# runs on main, nightly, and on a PR labelled `full-ci` (see
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
SEARCH_FLOOR := test(=engine::tests::refinement_improves_pool)
SLOW_TESTS := test(=perform::tests::an_aimed_offer_moves_the_way_it_was_turned) \
	| test(=perform::tests::a_planned_measurement_is_the_measurement) \
	| test(=walk::tests::a_walk_is_a_function_of_its_job) \
	| test(=perform::tests::named_controls_move_the_sound_they_name) \
	| test(=engine::tests::closed_loop_learns_synthetic_taste) \
	| test(=engine::tests::closed_loop_learns_motion_rate) \
	| test(=perform::tests::drift_is_local_and_follows_sigma) \
	| test(=perform::tests::a_stepped_walk_is_the_walk) \
	| test(=engine::tests::a_generation_absorbed_in_any_completion_order_is_the_serial_one)
NEXTEST = $(CARGO) nextest run --workspace --cargo-profile test-fast $(TEST_TARGETS) --no-tests=fail
# CI passes `--partition slice:k/N` here to split the fast tier across runners.
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

# ─── coverage ────────────────────────────────────────────────────────────────
#
# The fast tier's Rust tests, instrumented by cargo-llvm-cov with the pinned
# compiler's llvm-tools: each crate's line and function coverage against its
# floor in crates/coverage-baseline.json, and every line changed since BASE
# that no test ran (scripts/coverage_gate.py; docs/architecture/testing.md
# § Coverage). Native code only: what builds only for wasm32 is not measured,
# nor are the examples, nor a file the report's default rule leaves out (one
# under a `tests/` directory, or named `tests.rs`).
#
# cargo-llvm-cov 0.7 and later instrument the workspace's crates and nothing
# else, so the run costs about a fifth more than the plain tier. 0.6
# instrumented quiver's DSP loops too and took about thirteen times as long:
# hence the version floor below, which CI pins exactly.
#
# In CI the run is split (ci.yml's Coverage jobs): `coverage-archive` builds
# once into a nextest archive (COV_ARCHIVE), `coverage-run` runs one
# partition of it on each runner (NEXTEST_ARGS='--partition slice:k/N'), and
# `coverage-report` reads every runner's profiles against the archive.
#
# Not incremental, as in CI (CARGO_INCREMENTAL=0 there): each run starts
# from `llvm-cov clean`, so test-fast's incremental state would be written
# and never read.
LLVM_COV_VERSION := 0.9.1
COV := CARGO_INCREMENTAL=0 $(CARGO) llvm-cov
COV_DIR := target/llvm-cov
COV_SUMMARY := $(COV_DIR)/summary.json
COV_LCOV := $(COV_DIR)/lcov.info
COV_ARCHIVE ?=
COV_FAST := -E 'not ($(SEARCH_FLOOR) | $(SLOW_TESTS))' --no-tests=fail
COV_FROM = $(if $(COV_ARCHIVE),--nextest-archive-file $(COV_ARCHIVE),--profile test-fast)
# CI appends the tables to the run's summary (COV_MARKDOWN) and links each
# uncovered line (COV_LINK).
COV_MD = $(if $(COV_MARKDOWN),--markdown $(COV_MARKDOWN))

llvm-cov-installed:
	@v="$$($(CARGO) llvm-cov --version 2>/dev/null | awk '{ print $$2 }')"; \
	if [ -z "$$v" ] || [ "$$(printf '%s\n%s\n' "$(LLVM_COV_VERSION)" "$$v" | sort -V | head -1)" != "$(LLVM_COV_VERSION)" ]; then \
		printf '  cargo-llvm-cov %s or later is needed (found: %s); run: cargo install cargo-llvm-cov --version %s --locked\n' \
			"$(LLVM_COV_VERSION)" "$${v:-none}" "$(LLVM_COV_VERSION)"; exit 1; fi
	@rustup component list --installed 2>/dev/null | grep -q '^llvm-tools' || { \
		printf '  the llvm-tools component is missing; run: rustup component add llvm-tools\n'; exit 1; }

## coverage: the fast tier's Rust tests, instrumented: each crate's line and
## function coverage against its floor (crates/coverage-baseline.json), and
## every line changed since BASE (origin/main) that no test ran. Writes
## target/llvm-cov/html/index.html, lcov.info and summary.json there. Needs
## cargo-llvm-cov and the llvm-tools component (`make setup`)
coverage: coverage-run
	@$(MAKE) --no-print-directory coverage-report

# One instrumented run of the fast tier, profiles only: the whole tier from a
# clean build, or with COV_ARCHIVE, the tests in that archive (one partition
# of them, in CI).
coverage-run: nextest-installed llvm-cov-installed
ifeq ($(COV_ARCHIVE),)
	$(COV) clean --workspace
	$(COV) nextest --workspace --cargo-profile test-fast $(TEST_TARGETS) $(COV_FAST) --no-report $(NEXTEST_ARGS)
else
	mkdir -p target/llvm-cov-target
	$(COV) nextest --archive-file $(COV_ARCHIVE) $(COV_FAST) --no-report $(NEXTEST_ARGS)
endif

# The fast tier's test binaries, instrumented, as a nextest archive (CI's
# build for its coverage runners).
coverage-archive: nextest-installed llvm-cov-installed
	@test -n "$(COV_ARCHIVE)" || { printf '  name the archive: make coverage-archive COV_ARCHIVE=<file>.tar.zst\n'; exit 2; }
	$(COV) clean --workspace
	$(COV) nextest-archive --workspace --cargo-profile test-fast $(TEST_TARGETS) --archive-file $(COV_ARCHIVE)

## coverage-report: the reports and the gate again, from the last run's
## profiles (target/llvm-cov-target), without running the tests
coverage-report: llvm-cov-installed
	$(COV) report $(COV_FROM) --html
	$(COV) report $(COV_FROM) --json --summary-only --output-path $(COV_SUMMARY)
	$(COV) report $(COV_FROM) --lcov --output-path $(COV_LCOV)
	@printf '  report: %s/html/index.html\n' $(COV_DIR)
	@rc=0; \
	python3 scripts/coverage_gate.py floors $(COV_SUMMARY) --base $(BASE) $(COV_MD) || rc=1; \
	python3 scripts/coverage_gate.py diff $(COV_LCOV) --base $(BASE) $(COV_MD) $(if $(COV_LINK),--link $(COV_LINK)) || rc=1; \
	exit $$rc

## coverage-floors: raise each crate's floor to what the last `make coverage`
## measured (never lowers one); commit crates/coverage-baseline.json
coverage-floors:
	python3 scripts/coverage_gate.py floors $(COV_SUMMARY) --raise

# ─── mutation testing ────────────────────────────────────────────────────────
#
# cargo-mutants, configured in .cargo/mutants.toml: each mutant (a small
# change to the code) is built and its crate's fast tier run on it; a mutant
# no test fails on survives, and each survivor is a finding
# (crates/AGENTS.md § Mutation testing). The fast tier's filter is passed
# here, so the slow tests stay named in one place (SEARCH_FLOOR, SLOW_TESTS
# above). Pinned exactly, here, in scripts/setup.sh and in mutants.yml and
# mutants-weekly.yml: a new version can make mutants an old one did not,
# and the workflows read its mutants.out.
#
# Results go to mutants.out/ (missed.txt lists the survivors, timeout.txt
# the mutants stopped at the time limit, outcomes.json all of it, log/ each
# mutant's build and tests). make exits 2 for any failing recipe, whatever
# the cause, so the recipe says cargo-mutants' own code when it fails (2: a
# survivor; 3: a timeout, and maybe survivors too; 4: the unmutated tests
# failed; others: the run broke) and `scripts/mutants_report.py` says what
# it found. CI runs `make -s mutants-command`'s command itself, under its
# own time limit, to read that code. MUTANTS_JOBS mutants at a time, each
# in its own copy of the tree (its first build is from clean; what git tracks
# or does not ignore, so no worktree in .claude/worktrees/); MUTANTS_ARGS
# for any other option (CI's `--in-place`, `--shard k/N`). At nice 10, as
# perform-wirings is: it holds every core for as long as it runs.
MUTANTS_VERSION := 27.1.0
MUTANTS_JOBS ?= 2
MUTANTS_ARGS ?=
# Empty MUTANTS_JOBS passes no --jobs, which `--in-place` refuses.
MUTANTS_J = $(if $(MUTANTS_JOBS),--jobs $(MUTANTS_JOBS))
MUTANTS_DIFF := target/mutants.diff
MUTANTS_CMD = $(CARGO) mutants $(if $(CRATE),--package $(CRATE),--workspace) \
	$(if $(DIFF),--in-diff $(MUTANTS_DIFF)) $(MUTANTS_J) $(MUTANTS_ARGS) \
	-- -E 'not ($(SEARCH_FLOOR) | $(SLOW_TESTS))'

mutants-installed:
	@v="$$($(CARGO) mutants --version 2>/dev/null | awk '{ print $$2 }')"; \
	if [ "$$v" != "$(MUTANTS_VERSION)" ]; then \
		printf '  cargo-mutants %s is needed (found: %s); run: cargo install --locked cargo-mutants@%s\n' \
			"$(MUTANTS_VERSION)" "$${v:-none}" "$(MUTANTS_VERSION)"; exit 1; fi

# DIFF=1's diff: the Rust in crates/ changed since the merge base with BASE,
# to the working tree (so uncommitted changes count). Empty when none did.
# The diff reads the index, so it runs without the file-system monitor, as
# changes.py's git does: in a worktree it waited on the monitor's socket for
# over a minute.
mutants-diff:
	@git rev-parse --verify --quiet "$(BASE)^{commit}" >/dev/null || { \
		printf '  %s is not here to diff against: run `git fetch origin` first (or name another BASE=)\n' "$(BASE)"; exit 1; }
	@mkdir -p target
	@git -c core.fsmonitor=false diff "$$(git merge-base $(BASE) HEAD)" -- 'crates/*.rs' > $(MUTANTS_DIFF)

## mutants: mutation testing against the fast tier: `make mutants CRATE=auracle-taste`
## for one crate, `make mutants DIFF=1` for the code changed since BASE
## (origin/main), uncommitted changes included; both together for one crate's
## changes; neither for the workspace (a day or two; CI's weekly run takes a part). Survivors
## in mutants.out/missed.txt. Long: on a shared machine, `nice -n 19 make mutants …`
mutants: nextest-installed mutants-installed $(if $(DIFF),mutants-diff)
	@if [ -n "$(DIFF)" ] && [ ! -s $(MUTANTS_DIFF) ]; then \
		printf '  no Rust in crates/ changed since %s: nothing to mutate\n' "$(BASE)"; exit 0; fi; \
	printf '%s\n' "$(MUTANTS_CMD)"; \
	nice -n 10 $(MUTANTS_CMD) || { rc=$$?; \
		printf '  cargo-mutants exited %s (2: a survivor; 3: a timeout, maybe survivors too; 4: the unmutated tests failed): python3 scripts/mutants_report.py mutants.out\n' $$rc; \
		exit $$rc; }

# The command `make mutants` runs, printed for CI to run under its own time
# limit and read cargo-mutants' exit code, which make's own 2 would hide.
# With DIFF=1, `make mutants-diff` first.
mutants-command:
	@printf '%s\n' "$(MUTANTS_CMD)"

# The browser tiers: a spec tagged `@slow` (tests/web/AGENTS.md says when) or
# `@quarantine` (testing.md § Flakes) runs in the slow tier, every other one in
# the fast tier (in CI the Slow suite runs the quarantined ones in a job of
# their own, which says a failure on the test's issue). Through the browser queue
# and on a port of their own, like any local browser job (ADR-010): the port
# is BROWSER_PORT when set, else AURACLE_TEST_PORT when the environment sets
# it (a branch's worktree is given one; docs/process.md § The machine), else
# 8690.
# Needs the release engine (`make wasm`, or `make pkg-reuse` in a worktree
# that changed no Rust; a `make wasm-dev` build is refused) and Playwright's
# Chromium (`make smoke-tools` once).
BROWSER_PORT ?= $(or $(AURACLE_TEST_PORT),8690)
PLAYWRIGHT := cd tests/web && AURACLE_TEST_PORT=$(BROWSER_PORT) \
	../../www/video/tools/one_browser.sh npx playwright test

## browser-fast: browser specs not tagged @slow or @quarantine, CI's fast tier (~75 min serially)
browser-fast:
	$(RELEASE_ENGINE)
	$(PLAYWRIGHT) --grep-invert "@slow|@quarantine" --reporter=line

## browser-changed: the specs your change reaches against BASE (origin/main):
## changed specs, the specs of a changed helper or app module, for main.js
## the specs of the views its changed sections draw, and for worker.js, the
## page or the engine each view's sample (tests/web/changed.mjs --views).
## REPEAT=n runs the spec files the branch adds or edits n times each, first,
## and the rest once (the ship skill's REPEAT=3 before a push)
BASE ?= origin/main
REPEAT ?= 1
# Two runs when REPEAT is more than 1: the repeat is the burn-in of what the
# branch wrote (#177 §1.1), not of every spec a main.js change reaches,
# which can be most of the tier. The repeated run goes first, and a failure
# stops there, so its test-results/ is the one left to read.
browser-changed:
	@case "$(REPEAT)" in ''|*[!0-9]*|0) printf '  REPEAT is how many times each spec the branch adds or edits runs (1, 3 …), not "%s"\n' "$(REPEAT)"; exit 2;; esac
	$(RELEASE_ENGINE)
	@specs="$$(cd tests/web && node changed.mjs --views $(BASE))" || exit $$?; \
	if [ -z "$$specs" ]; then printf '  no spec to run for this change\n'; exit 0; fi; \
	again=""; \
	if [ "$(REPEAT)" != 1 ]; then again="$$(cd tests/web && node changed.mjs --touched $(BASE))" || exit $$?; fi; \
	once=""; for s in $$specs; do case " $$(echo $$again) " in *" $$s "*) ;; *) once="$$once $$s";; esac; done; \
	printf '  spec files: %s\n' "$$(printf '%s\n' $$specs | wc -l | tr -d ' ')"; \
	if [ -n "$$again" ]; then printf '  %s times each, the ones this branch adds or edits:\n' "$(REPEAT)"; printf '    %s\n' $$again; fi; \
	if [ -n "$$once" ] && [ "$(REPEAT)" != 1 ]; then \
	  if [ -n "$$again" ]; then printf '  once each, the ones it reaches:\n'; else printf '  once each (the branch adds or edits no spec, so nothing repeats):\n'; fi; \
	fi; \
	if [ -n "$$once" ]; then printf '    %s\n' $$once; fi; \
	( if [ -n "$$again" ]; then $(PLAYWRIGHT) $$(printf '/%s ' $$again) --repeat-each=$(REPEAT) --reporter=line; fi ) && \
	( if [ -n "$$once" ]; then $(PLAYWRIGHT) $$(printf '/%s ' $$once) --reporter=line; fi )

## browser-slow: browser specs tagged @slow or @quarantine, CI's slow tier (~35 min serially)
browser-slow:
	$(RELEASE_ENGINE)
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
# (`make perform-wirings`) and renders its presets' faces again
# (`make preset-faces`); `make test` fails until it has.
#
# `refinement_improves_pool` and `closed_loop_learns_synthetic_taste` are the
# always-on floors under all of this and they DO run in `make check`, and in
# CI's slow tier (on main, nightly, and on a PR labelled `full-ci`). Floors,
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

## bench-render: what one phrase render costs, natively and in wasm: a fixed
## set of 18 trees (PERFORM's six presets and twelve prior draws, frozen in
## crates/auracle-features/examples/bench_render.json) rendered as a farm
## worker does, each the least of REPS (5) repeats, in thread CPU ms per
## render, with the load average. The wasm half runs on the release engine in
## apps/web/pkg (`make wasm` first). Not niced, and not in CI yet (#299):
## docs/notes/render-cost-2026-10/ says how to read it and compare two builds
REPS ?= 5
bench-render:
	$(CARGO) run -p auracle-features --example bench_render --release -- --reps=$(REPS)
	$(RELEASE_ENGINE)
	node crates/auracle-wasm/examples/bench_render.mjs --reps=$(REPS)

## revalidate: what a φ-touching change owes — run on BOTH sides, diff the tables
revalidate: phi-stats norm-peak climb search-check
	@printf '\n  revalidation complete — the paired before/after table goes in the PR\n'
	@printf '  a φ change also owes `make perform-wirings` and `make preset-faces` (the shipped preset wirings and faces)\n\n'

# The engine's two builds, and what pkg/build.json says of them
# (scripts/wasm_pkg.py): which build it is, and what it was made from (a
# hash of the Rust it reads and the command below), so another checkout can
# take it instead of building the same one (`make pkg-reuse`). Each marks
# pkg/ unfinished before it starts (`begin`): wasm-pack writes the engine
# before wasm-opt runs, and a build that stops there would otherwise leave
# it under the last build's stamp. The inputs are hashed again once it is
# done, and kept only if the Rust didn't change while it built.
WASM_PKG := python3 scripts/wasm_pkg.py
WASM_PACK := wasm-pack build crates/auracle-wasm --target web --out-dir ../../apps/web/pkg
WASM_RELEASE := $(WASM_RUSTFLAGS) $(WASM_PACK) --release
# test-fast's codegen (Cargo.toml: release's opt-level, no LTO, 256 codegen
# units for the workspace's crates) into its own target directory,
# incremental, and no wasm-opt.
WASM_DEV := CARGO_INCREMENTAL=1 $(WASM_RUSTFLAGS) $(WASM_PACK) --profile test-fast --no-opt
# The browser targets' first line: a release build is in pkg/, or they stop
# and say what to run.
RELEASE_ENGINE := @$(WASM_PKG) check

## wasm: build the web app's engine into apps/web/pkg (the release build: fat
## LTO, wasm-opt; what CI, the browser specs and the films run on), and stamp it
wasm:
	@src="$$($(WASM_PKG) source --recipe '$(WASM_RELEASE)')"; \
	printf '%s\n' '$(WASM_RELEASE)'; \
	$(WASM_PKG) begin && \
	$(RUSTUP_NOTE)$(WASM_RELEASE) && \
	$(WASM_PKG) stamp --profile release --source "$$src" --recipe '$(WASM_RELEASE)' $(WEB_STAMPED)

## wasm-dev: a quick engine build, for trying an engine edit in the browser
## (`make serve`) in seconds rather than a minute: no LTO, no wasm-opt,
## incremental. Stamped `dev`, which the browser targets, the specs and the
## films refuse: `make wasm` before them
wasm-dev:
	@src="$$($(WASM_PKG) source --recipe '$(WASM_DEV)')"; \
	printf '%s\n' '$(WASM_DEV)'; \
	$(WASM_PKG) begin && \
	$(RUSTUP_NOTE)$(WASM_DEV) && \
	$(WASM_PKG) stamp --profile dev --source "$$src" --recipe '$(WASM_DEV)' $(WEB_STAMPED)

## pkg-reuse: take another checkout's release engine instead of building it
## again (about a second, not minutes of fat LTO): the first of this
## repository's checkouts and worktrees (`git worktree list`: the main
## checkout, then the most recently built) whose engine was built from this
## tree's Rust and the same build command, and is still the engine its stamp
## was written for; copied, never linked, as new files; otherwise it says why
## each was passed over, and `make wasm` is owed. `make worktree` tries it.
## PKG_FROM=<dir> takes that checkout's only. SOFT=1 says a refusal and
## doesn't fail on it
pkg-reuse:
	@$(WASM_PKG) reuse --recipe '$(WASM_RELEASE)' $(if $(PKG_FROM),--from $(PKG_FROM)) $(WEB_STAMPED) $(if $(filter-out 0,$(SOFT)),|| true)

# The version stamp main.js puts on its worker and wasm URLs (`?v=…`). A content
# hash over the engine and the app scripts, so the same bytes get the same URL
# and the ~2 MB binary is served from the browser's cache across reloads — and
# re-fetched exactly when it changed. Without the file the app falls back to
# `Date.now()`, which is correct and never cached. python3 because it is already
# required (serve.py, checklinks.py) and `sha256sum`/`shasum` differ by OS.
# Every app script, not a list: a module main.js imports with `?v=` (perform.js,
# midi.js) that was left out would keep its old URL when it changed and be
# served from cache.
WEB_STAMPED := apps/web/pkg/auracle_wasm_bg.wasm apps/web/pkg/auracle_wasm.js $(WEB_JS) apps/web/perform-wirings.json apps/web/preset-faces.json
wasm-prebuilt:
	@test -f apps/web/pkg/auracle_wasm_bg.wasm || { printf '  WASM_PREBUILT=1 but apps/web/pkg has no engine\n'; exit 1; }
	@$(MAKE) --no-print-directory wasm-stamp

# The same engine against new app scripts (a JS-only change, CI's cached
# engine on a new commit): its profile and source stay as they were.
wasm-stamp:
	@$(WASM_PKG) stamp $(WEB_STAMPED)

## perform-wirings: measure PERFORM's wiring of every preset natively, the way
## the worker does, into apps/web/perform-wirings.json (a few minutes; commit
## the file). `make test` fails while it is stale: a preset or a named input
## changed, or a re-measured sample (φ, the standard pool, a wiring) differs.
## Owed by every φ change. THREADS=n to use n cores.
perform-wirings:
	nice -n 10 $(CARGO) run -p auracle-wasm --example preset_wirings --release -- $(or $(THREADS),2) apps/web/perform-wirings.json

## preset-faces: render every preset's face natively, the way the worker
## renders a preset's, into apps/web/preset-faces.json (one render per preset,
## about 14 s of one core's time; commit the file). The page draws a preset's face
## from it without asking the engine. `make test` fails while it is stale: a
## preset, the render namespace, the reference clip or the face's encoding
## changed, or a face renders differently today. Owed by every φ change.
## One thread unless THREADS=n.
preset-faces:
	nice -n 10 $(CARGO) run -p auracle-wasm --example preset_faces --release -- $(or $(THREADS),1) apps/web/preset-faces.json

## serve: no-store static server for apps/web on http://localhost:8642
serve:
	cd apps/web && python3 serve.py

## bundle: what the release workflow ships — a runnable web zip in dist/
bundle: wasm
	rm -rf dist && mkdir -p dist/auracle-web
	cp -r apps/web/. dist/auracle-web/
	python3 www/stamppage.py dist/auracle-web
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
	# serve.py is for local development; Pages is the server here, and it
	# caches: the page's style.css and main.js get their content hashes.
	rm -f site/play/serve.py
	python3 www/stamppage.py site/play

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
