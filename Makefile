# Ricercar development targets. `make check` is the CI gate.

CARGO := cargo
# Homebrew's rustc shadows rustup's and lacks the wasm std — always prefer
# ~/.cargo/bin for wasm builds.
WASM_PATH := PATH="$(HOME)/.cargo/bin:$(PATH)"

.PHONY: all check build test test-verbose fmt fmt-check lint lint-fix clippy \
        wasm serve doc bundle clean

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
	$(WASM_PATH) wasm-pack build crates/ricercar-wasm --target web --release --out-dir ../../apps/web/pkg

## serve: no-store static server for apps/web on http://localhost:8642
serve:
	cd apps/web && python3 serve.py

## bundle: what the release workflow ships — a runnable web zip in dist/
bundle: wasm
	rm -rf dist && mkdir -p dist/ricercar-web
	cp -r apps/web/. dist/ricercar-web/
	printf '# Running Ricercar\n\nPrebuilt web instrument — serve statically and open the URL:\n\n    python3 serve.py    # -> http://localhost:8642\n' > dist/ricercar-web/RUNNING.md
	cd dist && zip -qr ricercar-web.zip ricercar-web

doc:
	$(CARGO) doc --workspace --no-deps --open

clean:
	$(CARGO) clean
	rm -rf apps/web/pkg
