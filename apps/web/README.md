# Ricercar web app

A full instrument (Animoog-Z-style app frame): menu bar with three views,
patch-bank sidebar, and a **playable keyboard** docked at the bottom — the
current patch runs live in an AudioWorklet (4-voice poly). No page scrolling;
everything is visible at once. The whole session **autosaves to IndexedDB**
(bank, names, taste history, settings) and restores on reload.

The sidebar is **three banks**, not one list with filters: **evolution** (the
live pool the model reasons over and breeds from), **my patches** (what you
saved), and **presets** (the hand-made library, browsed in place). A `?` in
the bank head walks through what a generation is and what evolving costs.

- **PLAY** — the patch is the hero: its full rack (modules, cables, knobs at
  true positions, mod wires pulsing at their modulator's rate), editable and
  lockable, playable from the keyboard while you turn knobs. The rack **scales
  to fill its frame** (1×–2.2×) and centres, knobs wear value arcs and read in
  **musical units** (`840 Hz`, `24 ms`, `−6.0 dB`, `+12 ¢`), and a **live scope**
  traces the output while you play. A quick-pick strip votes without leaving
  the view, and a **next-step chip** always says what to do now.
- **EVOLVE** — duels (click a card to play that candidate live; ▶ SAMPLE for
  the fixed A/B stimulus) under a **teaching meter** that counts down to the
  next refit and takes the strip over when the model learns. Candidates carry
  names, not s-expressions. Plus EVOLVE POOL and the generation lineage.
- **TASTE** — the model's mind, full-screen: map / styles / directions /
  **trust**, with nameable, colour-coded style chips and exemplar audition.
  The map encodes posterior *uncertainty* as dot size; TRUST is a reliability
  diagram plus Brier skill, because a running hit-rate is not a proper scoring
  rule and is pinned near 50% by an acquisition function that serves near-ties
  on purpose.

## The node bank

The rail on the right of PLAY is the instrument's **catalogue** — forty-one
modules in eight signal-flow groups (sources → shape → filter → space → motion
→ dynamics → combine → modulation), not one alphabetical shelf. Every entry carries four things at
rest: a **transfer-function glyph** (what this does to a wave — never a
pictogram, so the set cannot drift as it grows), the name a synthesist would
use, a **port signature** in both phosphors, and, once the model has been fitted
*and* at least five patches in the pool use the module, a **θ bar with a ±σ
whisker**. Below that support threshold it draws a dash: "the model barely
likes this" and "the model has never seen this" must not look alike.

`/` focuses the index, which matches by **sound as well as by name** — *grit*
finds distortion and bitcrush, *wander* finds s&h rand, *vowel* finds the
formant oscillator. Hovering or focusing an
entry opens a **spec card**: one sentence in the app's voice, the port map, the
parameters it will arrive with, an honest line about what the model believes
(with four distinct silences — not measured / not fitted / too few examples /
here is the belief), and a **heard as** line saying what the feature extractor
can and cannot pick up. Chorus's says the model will not learn it, because φ has
no stereo-width coordinate.

Placing is **arm-and-place**: click a module and it is in your hand; every
socket it can legally go into lights up and *names what will happen there* —
green **inserts** ahead of what is in the socket, amber **replaces** it. Click a
lit ○ to place, `esc` to put it down. Press-drag from an entry still works for
anyone who prefers it, and a missed drop now says so instead of silently doing
nothing. Every placement is one undo step and the toast offers **take it out**.

The whole path has a keyboard equivalent, which wiring did not have at all
before: arrows walk the catalogue (one tab stop per group), `enter` arms,
arrows then walk the **lit sockets** with each one announced, `enter` places.
**IN THIS PATCH** lists what the bench patch is made of; clicking a pill jumps
to that module in the rack. Collapsed, the rail keeps its name and the count of
anything **held** below, because a drawer that can hide staged work without
saying so is a trap. Its width, its collapsed state and which groups are folded
all persist.

Modulation is a **sort, not a slot**: a cable can carry `s&h rand → quantize →
slew` before it reaches a cutoff, and the rack draws the whole chain in amber.
Dropping a CV shaper on an occupied slot **wraps** what is already there rather
than evicting it, and the socket says which of fill / replace / wrap you are
about to do.

The rack's ⋯ menu no longer reprints the module list: **replace with…** and
**insert after…** hand off to the rail with the socket already chosen and lit.
One inventory, one place — the palette and the right-click menu cannot describe
different instruments.

On first run a **warm-start** screen asks you to pick 3 of 9 presets — one
~30 s interaction worth 18 pairwise observations, which is how the model gets
past a cold start that the repo's own synthetic gates measure in the hundreds
of duels. Those nine are **sampled one per family** from the 29-patch library
and only those nine are loaded: the screen used to render a card per preset and
load every one of them, which at 29 would be a scrolling first run that spent
more than half a 40-slot pool before the user had said anything. Library size
and grid size are independent on purpose.

Playing: on-screen keys (mouse/touch with glissando), computer keys
`a w s e d f t g y h u j k o l p ; '` (Ableton layout, `z`/`x` octave), or a
**MIDI keyboard** (velocity, pitch bend, sustain pedal). HOLD latches,
◼ panics; the dock also has an **arpeggiator** (pattern / division / BPM /
gate / swing), **unison**, **glide**, and **● rec** (bounces your playing to a
WAV). ⌘Z / ⇧⌘Z undo and redo workbench edits. Press `?` in-app for the full map.

**Keyboard and screen readers.** Tab reaches the bank as a single stop (arrows
to move, Enter to open, `1`–`5` to rate, `m` to save) and the rack as a single
stop (arrows between controls, ↑/↓ to turn, Shift for fine, `L` to lock). The
bank's cursor is announced: rows carry ids and the list carries
`aria-activedescendant`, which it did not — it claimed `role="listbox"` while
arrowing through it said nothing at all. Because the row's buttons are
deliberately outside the tab order, the row's own label has to carry what they
encode, so it announces name, id, saved state, rating and prediction. The save
key is `m` rather than the obvious `s` because `s` is a note in the Ableton
layout and the global handler deliberately lets note letters through even when
a control has focus — binding it here would have played a D on every save.

Letter keys only play notes when
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

- **Hit targets are measured, not eyeballed.** Two controls turned out to be
  much smaller than they looked, both because an SVG shape only hit-tests
  where it is *painted*. A jack's outer circle is unfilled, so only its 1.6px
  ring responded — scanning a jack's 11px diameter found 4 live pixels in two
  slivers. A knob's ticks, track and value arc all ride outside its body and
  intercepted the press, so a 44px face had a 36px control inside it. Both are
  fixed (`pointer-events: all` on the jack ring, `.knob-hit` covering the
  knob's whole face, decoration set to `pointer-events: none`). When adding a
  rack control, scan across it with `elementFromPoint` before trusting it.
- **Stars and saves are different questions, and must stay different
  controls.** ★ is an *observation*: it enters the taste log and moves θ.
  **save** is *storage*: it exempts a patch from eviction and logs nothing. The
  bank used to conflate them — a `saved` filter that meant "starred ≥ 1" over a
  pool that evicts by lowest posterior utility, i.e. it targeted precisely the
  oddball you loved before the model had learned it, and the app apologized for
  this in three separate strings. Merging the two is tempting and wrong: the
  moment a rating decides what survives, people rate strategically to protect
  patches, and every protective over-rating is a preference they never held.
  Pins live engine-side (`Candidate::pinned`, `BankEntry::pinned` with
  `#[serde(default)]`) because the engine is what evicts; holding them in the
  UI beside `starsById` would rebuild the same split that made the old bug
  possible. Capped at `pool_size / 4` so the pool can never be pinned solid —
  that state has no honest report, since it surfaces as `insert_candidate`
  returning `None`, which callers already render as "no proposal beat its
  parent".
- **Escape everything that a user or a file can name.** `renderBank` built rows
  by interpolating `r.name` straight into `innerHTML`. Renaming a patch to
  `<img src=x onerror=…>` executed, persisted into `BankEntry.name`, and
  re-fired on every reload — and the same sink is fed by *imported patch JSON*,
  so opening a shared patch was script execution in the recipient's session.
  `esc()` now covers every interpolation of a name, including the two that land
  in attributes. Prefer `textContent` where the node allows it.
- **A control that can't act says so.** The audit's recurring bug was silence:
  a ▶ with no handler, an `if (x == null) return`, a worker failure message
  nothing listened for. `bench_missing` is the sharpest case — the worker has
  always sent it when `edit_begin` fails, and because nothing handled it the
  optimistic "it's on the workbench" toast stayed on screen while the bench
  showed the previous patch. Prefer a disabled control with a reason in its
  title, or a note; never a handler that returns.
- **Touch**: everything the rack does works under a finger on a tablet —
  knob drags, cable pulls, locks, the ⋯ menu. Two rules carry it. Controls
  that own a drag claim the gesture before the browser can (`claimGesture`:
  `touch-action` plus a non-passive `touchstart` preventDefault, because
  `touch-action` is unreliable on SVG *children*), which lets the rack frame
  keep its own panning. And affordances that a mouse reveals by hovering —
  the knob lock dots, the bank's stars and CUT — are shown outright on a
  coarse pointer, since hover-to-reveal on a tablet means "never". Small
  glyphs get an invisible `fingerPad`, created only for coarse pointers, so
  desktop hit areas are byte-for-byte what they were.
- **Keybed size**: `⇕ tall` is height (the dock grows via `--keybar-h`, the
  deck re-zooms into what's left); `keys` is width, 1–4 octaves. Both persist
  in `perf`. The width defaults by input device — three octaves for a mouse,
  two for a finger — and the narrow sizes anchor on the computer keymap's
  octave rather than an octave below it.
- **Handheld gate**: a coarse pointer with a min viewport dimension under
  620px never boots the engine at all — an inline check in `index.html`
  injects `main.js` only when it passes, and otherwise shows a stand-in
  screen asking for a desktop. Gating *before* the script tag is the point:
  a phone would otherwise pay for 40 renders it can't display. `look around
  anyway` sets a session flag and reloads past it. A real handheld layout is
  still to be built.
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
