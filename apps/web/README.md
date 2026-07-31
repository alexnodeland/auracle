# Ricercar web app

A full instrument (Animoog-Z-style app frame): menu bar with three views,
patch-bank sidebar, and a **playable keyboard** docked at the bottom — the
current patch runs live in an AudioWorklet (4-voice poly). No page scrolling;
everything is visible at once. The whole session **autosaves to IndexedDB**
(bank, names, taste history, settings) and restores on reload.

- **PLAY** — the patch is the hero: its full rack (modules, cables, knobs at
  true positions, mod wires pulsing at their modulator's rate), editable and
  lockable, playable from the keyboard while you turn knobs. The rack **scales
  to fill its frame** (1×–2.2×) and centres, knobs wear value arcs and read in
  **musical units** (`840 Hz`, `24 ms`, `−6.0 dB`, `+12 ¢`), and a **live scope**
  traces the output while you play. A quick-pick strip votes without leaving
  the view, and a **next-step chip** always says what to do now.
- **EVOLVE** — duels (click a card to play that candidate live; ▶ PHRASE for
  the fixed A/B stimulus) under a **teaching meter** that counts down to the
  next refit and takes the strip over when the model learns. Candidates carry
  names, not s-expressions. Plus EVOLVE POOL and the generation lineage.
- **TASTE** — the model's mind, full-screen: map / styles / directions /
  **trust**, with nameable, colour-coded style chips and exemplar audition.
  The map encodes posterior *uncertainty* as dot size; TRUST is a reliability
  diagram plus Brier skill, because a running hit-rate is not a proper scoring
  rule and is pinned near 50% by an acquisition function that serves near-ties
  on purpose.

On first run a **warm-start** screen asks you to pick 3 of 9 presets — one
~30 s interaction worth 18 pairwise observations, which is how the model gets
past a cold start that the repo's own synthetic gates measure in the hundreds
of duels.

Playing: on-screen keys (mouse/touch with glissando), computer keys
`a w s e d f t g y h u j k o l p ; '` (Ableton layout, `z`/`x` octave), or a
**MIDI keyboard** (velocity, pitch bend, sustain pedal). HOLD latches,
◼ panics; the dock also has an **arpeggiator** (pattern / division / BPM /
gate / swing), **unison**, **glide**, and **● rec** (bounces your playing to a
WAV). ⌘Z / ⇧⌘Z undo and redo workbench edits. Press `?` in-app for the full map.

**Keyboard and screen readers.** Tab reaches the bank as a single stop (arrows
to move, Enter to open) and the rack as a single stop (arrows between controls,
↑/↓ to turn, Shift for fine, `L` to lock). Letter keys only play notes when
focus is not in the interface. Transient messages go to an `aria-live` toast
stack; conditions that persist — a muted unvetted patch, a crashed engine — go
to a pinned `role="alert"` strip that stays until resolved.

## Architecture

- **live-audio.js** builds the AudioWorklet as a blob (wasm-bindgen glue is
  inlined behind a TextDecoder/TextEncoder polyfill — worklets have neither
  fetch nor text codecs) and transfers the **raw wasm bytes** for a
  synchronous in-worklet compile (a transferred `WebAssembly.Module` arrives
  as a messageerror in some engines). `LivePoly` (ricercar-wasm) holds N
  compiled copies of the patch — the same `compile()` path evolution uses,
  limiter included — with oldest-note stealing and silent-tail voice
  parking. Every workbench edit re-patches the live instrument.

- **worker.js** owns the wasm engine: pool filling (each candidate is
  compiled, rendered, vetted, featurized), posterior fits, refinement, and
  the workbench (address-based knob edits re-render off-thread). Candidates
  are addressed by stable id. Boot is **progressive**: the bank is
  standardized and posted as `playable` at 8 patches — that is when the veil
  lifts and the first duel is dealt — and the remaining ~32 fill in chunks
  that yield to the message queue between batches, so playing during the fill
  is real rather than cosmetic. `filled` still fires, and everything
  downstream of it still runs. `fill_progress` carries `stage`/`stages` so a
  restore and the top-up fill each own a labelled share of the boot bar.

- **farm.js** is a stateless render worker — a wasm instance and nothing else.
  Boot's cost is ~40 renders, each a pure function of `(term, phrase)`, so
  main compiles the binary **once**, spawns
  `N = clamp(hardwareConcurrency − 2, 0, 6)` of these (capped at 2 when
  `deviceMemory ≤ 4`), and transfers one `MessagePort` per farm *into* the
  engine worker — after which main is out of the data path and no audition
  buffer ever touches the UI thread. No nested workers (Safari shipped those
  only in 16.4), no SharedArrayBuffer, no COOP/COEP, no build or server
  change. Override with `?farm=k` or `localStorage["ricercar-renderers"]`;
  `0` is today's serial path exactly.

  **The pool is identical at every width, including 0.** Two properties make
  that structural rather than argued: draws are *indexed* — draw `i` is the
  prior sampled under `StdRng::seed_from_u64(splitmix64(fill_seed, i))`, so a
  term is a pure function of `(fill_seed, i)` — and results are absorbed in
  *index order*, so the pool at index `i` depends only on indices `< i`. A
  lost or timed-out job is therefore re-issued by index with no retained
  state, and speculative work past the stop point is simply discarded. Gated
  natively by `farm_width_does_not_change_the_pool` and
  `farm_absorption_reproduces_the_serial_pool`, on `(id, tree, raw φ)`.

  Restore is farmed too (`import_session_deferred` → `bank_absorb` →
  `restore_finish`), which is the bigger win: it used to be a full bank of
  serial renders behind a bar pinned at zero. Every degradation path — a
  worker that never initializes, one killed mid-boot, a build-stamp mismatch,
  a browser that cannot structured-clone a `WebAssembly.Module` — falls back
  to the serial fill of the *same* draw stream, so it costs time and never
  content. The one exception is loud: a job retired after two attempts logs a
  console warning.

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
  utility, size = posterior *uncertainty*, hue = style island, click to open);
  STYLES shows each learned lens with its pool share; DIRECTIONS shows what
  each lens listens for; TRUST is the reliability diagram.
- **EVOLUTION** strip: per-generation utility trace plus a humanized diff of
  what each step actually did ("cutoff 0.31→0.78, +chorus · Δtaste +0.42").
- All feedback surfaces emit into one observation stream; the posterior
  re-fits **at most** every 6 duels, and only when the engine's own
  `status().needs_refit` says the between-fit importance updates have run out
  of road — signalled by the wordmark's final **R**, which is the "seeking"
  light (*ricercar*: to seek out) rather than a separate LED. The duel pair's
  audio is requested ahead of the fit, so the cards are always audible while
  it runs. Profiles export the log **with** its standardizer.

Keyboard: `1`/`2` play A/B, `←`/`→` choose.

## Design system

`style.css`'s token layer carries three laws, and breaking them is how the
surface degrades:

1. **Text tier vs stroke tier.** Each phosphor exists twice: `--phos-*-dim` is
   text and clears 4.5:1 on the rack; `--phos-*-deep` is for wire glow and jack
   rings. Using one token for both is what made every dimmed label in the app
   fail AA, including the lineage log.
2. **Tracking law.** Uppercase gets tracking; lowercase and mono get none.
3. **No off-system colour.** Every accent is signal-green or mind-amber.

Type is six roles on a scale with a **10px floor** — the panel used to label
its own parameters at 6.5–7.5px. The three faces (Jost, IBM Plex Mono,
Newsreader italic) are **self-hosted** in `fonts/`; see `fonts/README.md` for
why the previous local-only stack silently resolved to Trebuchet MS and Menlo
on most machines.

## Build & run

```bash
# build the wasm package into apps/web/pkg (needs rustup's toolchain, not Homebrew's)
PATH="$HOME/.cargo/bin:$PATH" wasm-pack build crates/ricercar-wasm --target web --release --out-dir ../../apps/web/pkg

# serve (any static server; module workers require http, not file://)
cd apps/web && python3 serve.py   # no-store server — plain http.server lets the browser cache worker.js/pkg across rebuilds
# open http://localhost:8642
```

`pkg/` is a build artifact and is not committed.
