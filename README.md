<div align="center">

# 🎼 Ricercar

**A synthesizer that searches for your sound.**

*Ricercar — the searching, pre-fugue form of Bach's Musical Offering; Italian
for "to seek". Built on [fugue-evo](https://github.com/alexnodeland/fugue-evo)
(evolution as Bayesian inference) and
[quiver](https://github.com/alexnodeland/quiver) (patch-graph DSP).
Formerly known as EvoSynth.*

[![CI](https://github.com/alexnodeland/ricercar/actions/workflows/ci.yml/badge.svg)](https://github.com/alexnodeland/ricercar/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/rust-stable-orange.svg)](https://www.rust-lang.org/)

</div>

Ricercar is a playable modular synthesizer that **models your taste over
time**. It generates patches by evolutionary search, collects your feedback on
what it plays — A/B duels, star ratings, keep/kill triage, your own hand
edits — and fits a persistent Bayesian model of what you like. Evolution then
*proposes toward you*: the fitted taste posterior reshapes the grammar's own
proposal distribution. Over time it stops asking and starts knowing —
generating patches in your style, and able to say why.

## Table of Contents

- [Project Status](#-project-status)
- [Why Ricercar?](#-why-ricercar)
- [Features](#-features)
- [Architecture](#-architecture)
- [Quick Start](#-quick-start)
- [Documentation](#-documentation)
- [Development](#-development)
- [Contributing](#-contributing)
- [License](#-license)

## 🚧 Project Status

Ricercar is **pre-1.0 and under active development**. There are no published
releases of Ricercar itself — build and run it locally (one clone; its
foundations come from crates.io). The instrument is fully playable and the
taste loop is closed, but the public API and the save format may change
between commits without notice.

## 🤔 Why Ricercar?

Sound design tools make you choose between exploring (presets, randomizers —
fast but shallow) and constructing (patching from scratch — deep but slow).
Genetic-algorithm synths tried to bridge this with star-a-generation
workflows, but they forget everything between sessions and can't tell you
*why* they suggest what they suggest.

Ricercar treats the problem as inference:

| Idea | What it buys |
|---|---|
| Patches are **terms in a typed PCFG** over quiver combinators | Every sample, mutation, and hand edit is a valid, playable patch by construction |
| Evolution is **MH on a Boltzmann posterior** `π(x) ∝ p_grammar(x) · exp(β·u(x))` via fugue-evo | Parsimony comes from the prior, search intensity is one dial, and locked knobs give *exact* conditional refinement |
| Taste is a **max-of-linear-experts utility with its own posterior** | One user can love several unrelated islands of sound; the model names them, shows its confidence, and forecasts your votes |
| The instrument and the search **share one compiler** | What you play live is byte-for-byte the patch that was evolved, vetted, and featurized |

## ✨ Features

- **A real instrument** — 4-voice polyphony in an AudioWorklet, on-screen and
  computer-key keyboards, Web MIDI (velocity, pitch bend, sustain), sample-
  accurate arpeggiator, glide, unison, per-patch loudness normalization, WAV
  recording of your playing. Zero-allocation render path, parameter
  smoothing, click-free patch swaps that keep held chords alive.
- **A live rack** — every knob is a trace address; turning one writes the
  running voices' atomics (no recompile) *and* the genome. Rewire by dragging
  typed jacks; structural edits are grammar operations, so illegal patches
  are unrepresentable. Undo/redo, per-knob and per-module locks.
- **A taste model that earns trust** — Bradley–Terry duels, ordinal stars,
  and keep/kill feed one max-of-experts posterior (fitted style count grows
  with evidence). It forecasts each duel *before* your vote and shows its
  running calibration; styles are nameable and color-coded everywhere; old
  votes fade with a recency half-life.
- **Taste-directed evolution** — refinement warm-starts typed MH from your
  best patches on the Boltzmann target, with kind-proposal weights tilted by
  the structural taste posterior. Lock what you love; evolution provably
  leaves it alone.
- **Persistence by default** — the whole session (bank, names, taste log,
  lineage, style names) autosaves to IndexedDB; profiles and single patches
  export as shareable files.
- **A curated palette** — VCO / supersaw / noise / mix / SVF+ladder filters /
  wavefolder / delay / chorus / reverb, with LFO / envelope / sample-and-hold
  random modulation — all evolvable, all hand-patchable.

## 🏗 Architecture

Two loops around one observation stream:

```
  patch loop (machine-paced)                taste loop (human-paced)
  ┌──────────────────────────┐              ┌──────────────────────┐
  │ grammar prior ──► vet ──►│   pool       │ duels / stars / kill │
  │      ▲                   │──────────────►      observation log │
  │      └── MH refine on    │   duels by   │           │          │
  │          π ∝ p·exp(βu),  │   Thompson   │           ▼          │
  │          proposals tilted│   sampling   │  taste posterior     │
  │          by taste ◄──────┼──────────────┤  u(x) = maxₖ θₖ·φ(x) │
  └──────────────────────────┘              └──────────────────────┘
```

| Crate | Role |
|---|---|
| `ricercar-grammar` | Typed PCFG over quiver combinator terms; term ⇄ trace codec; term → `Patch` compiler with live parameter handles; structural edit ops; presets |
| `ricercar-features` | Deterministic phrase rendering, vet gate, BS.1770 LUFS normalization, audio + structural features (φ) |
| `ricercar-taste` | Max-of-experts utility, three likelihoods, recency weighting, MCMC posterior, label alignment, portable profiles |
| `ricercar-session` | Two-loop engine: pool, dueling-Thompson acquisition, locked refinement, taste-tilted proposals, session persistence |
| `ricercar-wasm` | `WasmEngine` (worker-side brain) and `LivePoly` (worklet-side instrument) |
| `apps/web` | The instrument: PLAY / EVOLVE / TASTE, patch bank, keyboard dock |

## 🚀 Quick Start

Ricercar's foundations ([`quiver-dsp`](https://crates.io/crates/quiver-dsp),
[`fugue-ppl`](https://crates.io/crates/fugue-ppl),
[`fugue-evo`](https://crates.io/crates/fugue-evo)) come from crates.io — one
clone is all you need:

```bash
git clone https://github.com/alexnodeland/ricercar.git
cd ricercar
```

Build and run the instrument:

```bash
make wasm    # wasm-pack build → apps/web/pkg (uses rustup's toolchain)
make serve   # no-store static server on http://localhost:8642
```

Open http://localhost:8642, wait for the pool to warm up, and play
(`a w s e d f t g y h u j …`, or plug in a MIDI keyboard). Press `?` in the
app for the full key map and gesture guide.

## 📚 Documentation

- [`DESIGN.md`](./DESIGN.md) — the canonical design document: genome,
  taste model, engine, safety layers, decisions log, roadmap.
- [`DEVELOPMENT.md`](./DEVELOPMENT.md) — working *on* Ricercar: layout,
  workflow, quality bar, sharp edges.
- [`apps/web/README.md`](./apps/web/README.md) — the web app's
  architecture (worklet assembly, worker protocol, workbench).
- [`CHANGELOG.md`](./CHANGELOG.md) — notable changes by pass.

## 🛠 Development

```bash
make check   # fmt-check + clippy (-D warnings) + tests — the CI gate
make test    # cargo test --workspace --release (DSP tests need release)
make fmt     # rustfmt
make lint    # clippy
```

See [`DEVELOPMENT.md`](./DEVELOPMENT.md) for the full guide.

## 🤝 Contributing

Contributions are welcome — see
[`.github/CONTRIBUTING.md`](./.github/CONTRIBUTING.md). Run `make check`
before opening a PR.

## 📄 License

MIT — see [LICENSE](./LICENSE).
