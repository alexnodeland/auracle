# Development Guide

This document is for people working **on** Auracle (rather than playing it).
For the design rationale and decisions log see [`DESIGN.md`](./DESIGN.md); for
the web app's internals see [`apps/web/README.md`](./apps/web/README.md); for
the documentation site see [`www/README.md`](./www/README.md).

## Layout

```
crates/
  auracle-grammar/    the genome: typed PCFG terms, trace codec, compiler,
                       structural edit ops, describe (rack view), presets
  auracle-features/   phrase render → vet → LUFS-normalize → φ features
  auracle-taste/      max-of-experts taste model + MCMC posterior
  auracle-session/    two-loop engine, acquisition, persistence
  auracle-wasm/       WasmEngine (worker) + LivePoly (AudioWorklet)
apps/web/              the instrument (vanilla JS, no build step)
www/                   the site: landing page + two mdBooks + the shared theme
```

The in-house foundations come from **crates.io** (`quiver-dsp`, `fugue-ppl`,
`fugue-evo`), so a single clone builds. To hack on them alongside Auracle, put
sibling checkouts at `../quiver` and `../fugue-ecosystem/{fugue,fugue-evo}` and
uncomment the `[patch.crates-io]` block at the bottom of the workspace
`Cargo.toml` (don't commit the uncommented patch).

## Workflow

```bash
make check          # fmt-check + clippy -D warnings + release tests (CI gate)
make wasm           # rebuild apps/web/pkg after any Rust change
make serve          # http://localhost:8642 — just the instrument
```

The site is a second, independent gate:

```bash
make site-tools     # install the pinned doc toolchain (once)
make site           # build all four sections into site/
make site-serve     # http://localhost:8643 — the whole site, as published
make site-check     # every link, asset and anchor must resolve
make docs-serve     # live-reloading authoring loop for the guide
make reference-serve
```

CI runs `make site` and `make site-check` on every PR, because the site's
failure modes are invisible to `make check`: an undefined KaTeX macro is a
build *warning*, a cross-section link only exists once four sections are
assembled, and a root-absolute path works locally and 404s under the
`/auracle/` project subpath.

- **Tests run in release mode.** The grammar/features/session suites render
  real audio sample-by-sample; debug DSP is ~20× slower.
- **Wasm builds need rustup's toolchain.** A Homebrew rustc earlier in PATH
  lacks the wasm32 std; `make wasm` prefixes `~/.cargo/bin` for you.
- **The dev server sends `Cache-Control: no-store`** and the app version-stamps
  its worker/wasm URLs. Both are needed; the browser's heuristic cache ignores
  late `no-store` on already-cached module workers.
- **The instrument lives at `/play/` on the published site**, not at the root;
  the root is the landing page. Nothing in the app assumes its own path (every
  asset reference is relative), and `make site-check` is what keeps it that
  way.

## Quality bar

Every change must pass `make check`:

1. `cargo fmt --all --check`
2. `cargo clippy --workspace --all-targets -- -D warnings`
3. `cargo test --workspace --release`

Changes that touch `www/`, `apps/web/` or any public API must also pass `make
site && make site-check`. If you changed a doc comment that the reference
quotes a number from, the number in the reference is now wrong. The books cite
constants by name so they can be grepped.

Beyond that, the codebase leans on **gate tests** rather than mocks: the
closed-loop test fits a real posterior against a synthetic user; the
structural-edit gate applies every op at every node of random trees and
requires the result to stay compilable; the live-audio tests assert numeric
properties of rendered samples (fade boundaries, smoother convergence, chaos
survival). Prefer extending a gate over asserting implementation details.

## Sharp edges

- **AudioWorklets have no `fetch`/`TextDecoder`/`TextEncoder`.** The worklet is
  assembled as a blob with the wasm-bindgen glue inlined behind a polyfill, and
  raw wasm **bytes** are transferred (a transferred `WebAssembly.Module` dies
  as a silent `messageerror` in some engines).
- **No wall clock on the audio thread**: `LivePoly` uses a deterministic
  xorshift for the random arp; `Date.now()`-anything belongs on the main
  thread.
- **The trace address scheme is the spine.** Panel knobs, hand edits, locks,
  live parameter handles, and MH proposals all share the genome's address
  scheme (`node/0#cut`, `amp#attack`, `node/0/m#rate`). The canonical
  `TraceGenome` codec **is** the grammar's addressing, and a round-trip
  property test keeps them from drifting.
- **Persisted UI state must be JS-owned**, never scraped from the DOM at save
  time (a phantom DOM slider reset once poisoned an autosave).
- **Worker replies are load-bearing**: every workbench edit message must get a
  reply (`bench` or `edit_rejected`) or the main thread's in-flight queue
  deadlocks.
- **quiver's `Strict` validation rejects warning-class pairs** the compiler
  deliberately uses (constant bipolar Offset → unipolar knob); patches are
  wired in `Warn` mode with an allowlist test pinning the warning classes.

## Verification beyond `make check`

UI changes are verified live in a browser (Playwright) with **numeric audio
assertions** (an `AnalyserNode` RMS, boundary-sample checks around patch swaps)
plus a zero-console-error requirement. Debug hooks for this live at
`window.__aur` / `window.__aurLog` (`window.__ric` is kept as an alias for
notes written before the rename).

## Cutting a release

A release is **one gesture: push a `vX.Y.Z` tag on a green `main`.** Two
workflows watch that tag and nothing else has to be done by hand:

- [`release.yml`](.github/workflows/release.yml) builds the wasm through the
  Makefile, zips a runnable web bundle as `auracle-vX.Y.Z-web.zip`, and creates
  the GitHub Release with the changelog section as its notes.
- [`pages.yml`](.github/workflows/pages.yml) deploys that same commit to
  <https://alexnodeland.github.io/auracle/>: the landing page, the instrument
  at `/play/`, and both books. It also deploys on every push to `main`; the tag
  deploy exists so the live site and the zip are the same build. A `pages`
  concurrency group serializes the two.

The steps, in order:

1. **Land everything first.** The tag is cut from `main`, and CI must be green
   on the commit you are about to tag. The release workflow does not re-run the
   test suite, it packages what is already there.
2. **Bump the version** in the workspace `Cargo.toml`: `[workspace.package]
   version`, *and* the `version = "…"` on each intra-workspace dependency in
   `[workspace.dependencies]` and in `crates/auracle-wasm/Cargo.toml`. Cargo
   refuses to resolve a path dependency whose version requirement the member no
   longer satisfies, so a half-bump fails loudly at `cargo check` — run it.
3. **Close the changelog section.** Rename `## [Unreleased]` to `## [X.Y.Z] —
   YYYY-MM-DD`, write the short paragraph under it that says what this release
   *is*, and open a fresh empty `## [Unreleased]` above it. This text becomes
   the release notes verbatim, so write it for someone who has never seen the
   repo.
4. **Open a PR for 2 and 3, merge it, wait for green.**
5. **Tag and push:**

   ```bash
   git checkout main && git pull
   git tag -a v0.2.0 -m "Auracle v0.2.0"
   git push origin v0.2.0
   ```

6. **Watch both workflows**, then check the things a green run does not prove:
   download the attached zip, serve it, and confirm the app boots from the
   bundle; and load the live site (`/`, `/play/`, `/docs/`, `/reference/` and
   `/reference/api/`) to confirm the deploy landed and the routes resolve.

The release workflow **fails before building** if the tag and the workspace
version disagree, or if `CHANGELOG.md` has no section for the tag. Both are
cheap to hit and expensive to notice later. An asset labelled v0.3.0 whose
crates all say `0.2.0` is a bug report waiting to happen.

To rehearse the bundle locally without tagging anything:

```bash
make bundle         # → dist/auracle-web.zip, the same assembly the workflow does
```
