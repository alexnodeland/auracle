# EvoSynth web app

Duel mode + the **workbench** (every patch as interactive hardware) + the
taste instruments (map / styles / directions) + evolution lineage + bench,
driving `evosynth-wasm` inside a Web Worker so rendering and MCMC never block
the UI.

## Architecture

- **worker.js** owns the wasm engine: pool filling (each candidate is
  compiled, rendered, vetted, featurized), posterior fits, refinement, and
  the workbench (address-based knob edits re-render off-thread). Candidates
  are addressed by stable id.
- **main.js** is UI + WebAudio: audition plays pre-rendered, LUFS-normalized
  buffers transferred from the worker (never a live unvetted patch —
  DESIGN.md §2.1). Green phosphor = audio; amber = the model's mind.
- **Workbench**: open any candidate (⌖ on a duel side, ⌖ on a bench keeper,
  or click a taste-map dot) to see its full rack — modules, patch cables,
  knobs at their true positions. Drag knobs / click selectors to edit (each
  edit is a one-site write at the knob's trace address, re-rendered and
  re-vetted before playback). Lock any knob or whole module, then
  **⚡ evolve from this**: MH refines everything *except* the locked
  addresses. **Commit** saves an edit as a new candidate; the "my edit is
  better" toggle also teaches the model an edited-beats-original duel.
- **Taste tabs**: MAP is a 2D PCA of every patch heard (glow = posterior
  utility, hue = style island, click to open); STYLES shows each learned
  lens with its pool share; DIRECTIONS shows what each lens listens for.
- **EVOLUTION** strip: per-generation utility trace plus a humanized diff of
  what each step actually did ("cutoff 0.31→0.78, +chorus · Δtaste +0.42").
- All feedback surfaces emit into one observation stream; every 6 duels the
  posterior re-fits (LEARN LED). Profiles export the log **with** its
  standardizer.

Keyboard: `1`/`2` play A/B, `←`/`→` choose.

## Build & run

```bash
# build the wasm package into apps/web/pkg (needs rustup's toolchain, not Homebrew's)
PATH="$HOME/.cargo/bin:$PATH" wasm-pack build crates/evosynth-wasm --target web --release --out-dir ../../apps/web/pkg

# serve (any static server; module workers require http, not file://)
cd apps/web && python3 serve.py   # no-store server — plain http.server lets the browser cache worker.js/pkg across rebuilds
# open http://localhost:8642
```

`pkg/` is a build artifact and is not committed.
