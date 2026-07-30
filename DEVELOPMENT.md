# Development Guide

This document is for people working **on** Ricercar (rather than playing it).
For the design rationale and decisions log see [`DESIGN.md`](./DESIGN.md); for
the web app's internals see [`apps/web/README.md`](./apps/web/README.md).

## Layout

```
crates/
  ricercar-grammar/    the genome: typed PCFG terms, trace codec, compiler,
                       structural edit ops, describe (rack view), presets
  ricercar-features/   phrase render → vet → LUFS-normalize → φ features
  ricercar-taste/      max-of-experts taste model + MCMC posterior
  ricercar-session/    two-loop engine, acquisition, persistence
  ricercar-wasm/       WasmEngine (worker) + LivePoly (AudioWorklet)
apps/web/              the instrument (vanilla JS, no build step)
```

Path dependencies expect sibling checkouts:

```
../quiver
../fugue-ecosystem/fugue
../fugue-ecosystem/fugue-evo
```

## Workflow

```bash
make check          # fmt-check + clippy -D warnings + release tests (CI gate)
make wasm           # rebuild apps/web/pkg after any Rust change
make serve          # http://localhost:8642
```

- **Tests run in release mode.** The grammar/features/session suites render
  real audio sample-by-sample; debug DSP is ~20× slower.
- **Wasm builds need rustup's toolchain.** A Homebrew rustc earlier in PATH
  lacks the wasm32 std; `make wasm` prefixes `~/.cargo/bin` for you.
- **The dev server sends `Cache-Control: no-store`** and the app
  version-stamps its worker/wasm URLs — both are needed; the browser's
  heuristic cache ignores late `no-store` on already-cached module workers.

## Quality bar

Every change must pass `make check`:

1. `cargo fmt --all --check`
2. `cargo clippy --workspace --all-targets -- -D warnings`
3. `cargo test --workspace --release`

Beyond that, the codebase leans on **gate tests** rather than mocks: the
closed-loop test fits a real posterior against a synthetic user; the
structural-edit gate applies every op at every node of random trees and
requires the result to stay compilable; the live-audio tests assert numeric
properties of rendered samples (fade boundaries, smoother convergence, chaos
survival). Prefer extending a gate over asserting implementation details.

## Sharp edges (hard-won)

- **AudioWorklets have no `fetch`/`TextDecoder`/`TextEncoder`** — the worklet
  is assembled as a blob with the wasm-bindgen glue inlined behind a
  polyfill, and raw wasm **bytes** are transferred (a transferred
  `WebAssembly.Module` dies as a silent `messageerror` in some engines).
- **No wall clock on the audio thread**: `LivePoly` uses a deterministic
  xorshift for the random arp; `Date.now()`-anything belongs on the main
  thread.
- **The trace address scheme is the spine.** Panel knobs, hand edits, locks,
  live parameter handles, and MH proposals all share the genome's address
  scheme (`node/0#cut`, `amp#attack`, `node/0/m#rate`). The canonical
  `TraceGenome` codec **is** the grammar's addressing — a round-trip property
  test keeps them from drifting.
- **Persisted UI state must be JS-owned**, never scraped from the DOM at save
  time (a phantom DOM slider reset once poisoned an autosave).
- **Worker replies are load-bearing**: every workbench edit message must get
  a reply (`bench` or `edit_rejected`) or the main thread's in-flight queue
  deadlocks.
- **quiver's `Strict` validation rejects warning-class pairs** the compiler
  deliberately uses (constant bipolar Offset → unipolar knob); patches are
  wired in `Warn` mode with an allowlist test pinning the warning classes.

## Verification beyond `make check`

UI changes are verified live in a browser (Playwright) with **numeric audio
assertions** — an `AnalyserNode` RMS, boundary-sample checks around patch
swaps — plus a zero-console-error requirement. Debug hooks for this live at
`window.__ric` / `window.__ricLog`.
