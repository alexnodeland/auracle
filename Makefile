# Ricercar development targets. `make check` is the CI gate.

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
        wasm serve doc bundle site clean

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
	$(WASM_PATH) $(WASM_RUSTFLAGS) wasm-pack build crates/ricercar-wasm --target web --release --out-dir ../../apps/web/pkg

## serve: no-store static server for apps/web on http://localhost:8642
serve:
	cd apps/web && python3 serve.py

## bundle: what the release workflow ships — a runnable web zip in dist/
bundle: wasm
	rm -rf dist && mkdir -p dist/ricercar-web
	cp -r apps/web/. dist/ricercar-web/
	printf '# Running Ricercar\n\nPrebuilt web instrument — serve statically and open the URL:\n\n    python3 serve.py    # -> http://localhost:8642\n' > dist/ricercar-web/RUNNING.md
	cd dist && zip -qr ricercar-web.zip ricercar-web

## site: what the Pages workflow publishes — site/ served at any subpath
site: wasm
	rm -rf site && mkdir -p site
	cp -r apps/web/. site/
	rm -f site/serve.py
	touch site/.nojekyll

doc:
	$(CARGO) doc --workspace --no-deps --open

clean:
	$(CARGO) clean
	rm -rf apps/web/pkg
