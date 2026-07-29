# EvoSynth web app

A full instrument (Animoog-Z-style app frame): menu bar with three views,
patch-bank sidebar, and a **playable keyboard** docked at the bottom — the
current patch runs live in an AudioWorklet (4-voice poly). No page scrolling;
everything is visible at once.

- **PLAY** — the patch is the hero: its full rack (modules, cables, knobs at
  true positions), editable and lockable, playable from the keyboard while
  you turn knobs.
- **EVOLVE** — duels (click a card to play that candidate live; ▶ PHRASE for
  the fixed A/B stimulus), EVOLVE POOL, and the generation lineage.
- **TASTE** — the model's mind, full-screen: map / styles / directions.

Keyboard: on-screen keys (mouse/touch with glissando) or computer keys
`a w s e d f t g y h u j k o l p ; '` (Ableton layout), `z`/`x` octave,
HOLD latches, ◼ panics. Volume top right of the dock.

## Architecture

- **live-audio.js** builds the AudioWorklet as a blob (wasm-bindgen glue is
  inlined behind a TextDecoder/TextEncoder polyfill — worklets have neither
  fetch nor text codecs) and transfers the **raw wasm bytes** for a
  synchronous in-worklet compile (a transferred `WebAssembly.Module` arrives
  as a messageerror in some engines). `LivePoly` (evosynth-wasm) holds N
  compiled copies of the patch — the same `compile()` path evolution uses,
  limiter included — with oldest-note stealing and silent-tail voice
  parking. Every workbench edit re-patches the live instrument.

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
