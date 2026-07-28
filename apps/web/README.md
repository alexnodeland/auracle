# EvoSynth web app

The first frontend (M5): duel mode + bench + the taste CRT, driving
`evosynth-wasm` inside a Web Worker so rendering and MCMC never block the UI.

## Architecture

- **worker.js** owns the wasm engine: pool filling (each candidate is
  compiled, rendered, vetted, featurized), posterior fits, refinement.
- **main.js** is UI + WebAudio: audition plays pre-rendered, LUFS-normalized
  buffers transferred from the worker (never a live unvetted patch —
  DESIGN.md §2.1), draws the green waveform scopes and the amber taste CRT.
- All feedback surfaces (duels, bench stars, cuts) emit into the same
  observation stream; every 6 duels the posterior re-fits (LEARN LED) and the
  CRT re-sweeps. EVOLVE runs taste-guided MH refinement of the pool.

Keyboard: `1`/`2` play A/B, `←`/`→` choose.

## Build & run

```bash
# build the wasm package into apps/web/pkg (needs rustup's toolchain, not Homebrew's)
PATH="$HOME/.cargo/bin:$PATH" wasm-pack build crates/evosynth-wasm --target web --release --out-dir ../../apps/web/pkg

# serve (any static server; module workers require http, not file://)
cd apps/web && python3 -m http.server 8642
# open http://localhost:8642
```

`pkg/` is a build artifact and is not committed.
