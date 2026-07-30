# Continuation notes — updated 2026-07-30 (pass 6: four-tier panel plan)

## Pass 6: panel critique → all four tiers shipped (commits 4e94345, d12a23b, + tier-4)

A four-persona panel critique (music technologist / creative designer / ML
researcher / UX) produced a 4-tier plan; the user chose ALL tiers.

**Tier 1 — trust.** IndexedDB autosave/restore of the full session
(`Engine::export_state/import_state`, `SessionState` = profile + bank +
lineage + style_names + events; trees re-featurized on import, ids
preserved, next_id bumped past max). Worker `init` takes `saved`,
restores, tops up the pool, auto-refits. Main: `idbGet/idbPut("state")`,
`scheduleSave()` debounce 2.5 s hooked into every mutating reply. Undo/redo:
snapshot wb.tree on knob-gesture start / enum click / sendStruct;
`edit_set_tree` wasm restores; ⌘Z/⇧⌘Z. Web MIDI (velocity, bend ±2 st,
sustain=hold, CC123 panic). LUFS makeup: `Features.gain_db` →
`makeup_linear` (±12 dB clamp) rides every patch load
(`live.setPatch(tree, makeup)`; applied at swap completion via
`pending_makeup`). Worklet recorder (`rec` message, copies interleaved
blocks only while rolling) → PCM16 WAV encode + download in main.
`.evopatch.json` export/import (`import_patch` wasm → commit_edit path).
**Master volume is JS-owned state** (`let volume`), the slider is just a
view — a phantom DOM zeroing (never reproduced under instrumentation;
audio was never affected because no input event fired) once poisoned the
save; never scrape the DOM for persisted state.

**Tier 2 — musicality.** LivePoly grew: velocity (`note_on(note, vel)`,
gain 0.15+0.85·v^1.4, floor so soft notes speak), pitch bend (one-pole
smoothed, `advance_pitch` writes pitch_cur+bend to atomics), glide
(per-voice one-pole toward pitch_tgt; τ = glide·0.5 s), unison
(all-voice press with ±detune·30c offsets + equal-power pan; render path
now applies vel·pan·√2 per voice), sample-accurate arp on the audio
thread (up/down/updown/random via xorshift — NO wall clock; half-step
gate; held list owns the chord, scheduler owns the gates; arp-off
re-presses the chord; swap completion skips re-press when arp on).
Keybar: arp/mode/div/BPM, uni, gld, ●rec, midi indicator; perf state
persisted. Palette: **Reverb** (quiver Freeverb; mono = take "left";
rsize/rdamp/rmix live knobs) and **S&H Rand mod** (Noise→SampleAndHold
clocked by square LFO at `rate`) threaded through term/prior (N_OPS=6,
N_MODS=4)/trace codec/compile/mutate/describe/features (φ d=30:
n_reverb, n_rand)/presets ("Cathedral")/JS palette. New warning classes
allowlisted: Audio/CV, Audio→Trigger, CvBipolar→Trigger.

**Tier 3 — taste loop.** `refine_one` now proposes from a
**taste-tilted prior**: share-weighted mean structural θ multiplies
source/op/mod kind weights by exp(η·θ) (η = cfg.proposal_tilt = 0.6,
multiplier clamped [¼,4]; pure `tilt_weights` fn, unit-tested). Recency:
obs likelihood weighted 0.5^(age/half_life), cfg 150 obs
(TasteConfig.recency_half_life, serde-default). Implicit events
(`ImplicitEvent` kind/id/value/session): play counts flushed with every
autosave, promote clicks; logged only, not modeled. Style identity:
engine.style_names (persisted), chips on TASTE (color + editable name +
share + exemplar ▶), auto-label = top-2 positive θ pulls; best-style
badges on duel cards (`best_style_of`). Honest forecast: `duel_pred`
computed BEFORE each vote, shown with running right/wrong calibration.

**Tier 4 — surface.** Mod wires + target jacks pulse at ~the modulator's
rate (animationDuration from rate/att+dec knobs; prefers-reduced-motion
respected). Duel cards "deal" in. **Quick-duel strip on PLAY** (pd-a/b
load live, pick a/b vote, ↻ skip — zero tab switches). Help overlay
(?, first-run auto-show via localStorage flag) with keymap/gestures.
Coarse-pointer touch targets.

**Deliberately deferred** (design-heavy): genome-level tempo-synced
LFO/delay semantics; learned audio embeddings under the linear experts;
duel loudness is now fair live (makeup) so the remaining confound is
phrase-vs-noodling mismatch.


## Pass 5: audio-thread bulletproofing ("no break/skip/crackle")

`LivePoly` became a proper audio-thread state machine:
- **Zero-alloc render**: `process_ptr(frames)` fills a persistent internal
  buffer, worklet views wasm memory directly (cached Float32Array view,
  invalidated on memory growth / ptr change). The Vec-returning `process`
  is native-tests-only.
- **Param smoothing**: `set_param` sets a *target*; a one-pole ramp
  (0.3/quantum, ~25 ms settle) advances the atomics each quantum — no
  zipper. Smoothers cleared on patch swap.
- **Click-free patch swaps**: Stage machine Run → FadeOut (1/256 per frame
  ≈6 ms) → Rebuild (ONE voice compiled per quantum while output is silent —
  compile overruns drop silent quanta, inaudible) → FadeIn. `held: Vec<u8>`
  tracked at LivePoly level; held notes are **re-pressed on the new patch**
  after a swap, so a held chord survives rewiring. Rapid swaps coalesce
  (Rebuild restarts with the newest pending tree). Compile failure → keeps
  old voices, EVENT_PATCH_ERROR. Worklet polls `poll_event()` once per
  quantum and relays patched/patch_error.
- Tests: gapless-swap (silent gap bordered by ~0 boundary samples, held
  note survives), smoothing convergence, 600-iteration chaos (random
  notes/params/junk addrs/patch swaps → always finite, |s| ≤ 1.5).
- Browser gauntlet: 12 s × 120 rounds of note hammering + knob storms +
  structural menu ops + bank switches: 0 NaN samples, 0 worklet errors,
  ctx running. Wire-drag re-entrancy guarded (`if (wire) return`).
- Test-metric lesson: "no adjacent-sample jump" is a WRONG click test
  (square waves jump legitimately); assert near-zero *boundary* samples
  around the silent gap instead.

# (pass 4) — the live surface

## Pass 4 (playtest-4 response): everything real-time + the wiring surface

- **Zero-recompile knobs**: `compile()` now emits every continuous param as
  an `ExternalInput::cv/cv_bipolar` with an `Arc<AtomicF64>` handle,
  registered in `CompiledVoice.params` keyed by trace address
  (`node/0#cut`). `ParamMap` {Unit, Resonance, Feedback, XfadePos} applies
  the bounded musical mapping at write time. `LivePoly::set_param(addr, x)`
  writes all voices' atomics — **audible next sample, no recompile, filter/
  delay state survives** (test: mid-note cutoff sweep diverges from a clone
  without killing the voice). Knob drags route: sound-first to the worklet
  (`live.param`) + genome-second to the worker (debounced). Bench replies
  only re-patch on subject load / structural edit / non-live addr
  (`param_miss` from the worklet populates `nonLiveAddrs`). Non-live: vco
  detune/octave, fold threshold, mod_depth (cable attenuation), all enums.
- **Wiring surface**: labeled jacks on every module (green audio in/out;
  amber mod; mix has a/b in-jacks; amp in-jack accepts the root), wires
  land on jacks (mod cables land on the bottom mod jack). **Node bank**
  (collapsible right panel) stages modules into the **tray** (client-side
  fragments, serde-shaped JSON mirroring mutate.rs defaults). Drag a tray
  out-jack → legal jacks pulse → drop: processor/mix = `insert_tree`
  (grafts old subtree as its input; Mix keeps its own b), source =
  `replace_tree` (old chain parks in the tray). LFO/env → mod jack =
  `set_mod_tree`. Dragging an occupied in-jack off = unplug: subtree parks
  in tray, a default vco holds the socket; mod jack unplug = set_mod none.
  Rewiring between existing modules = unplug + replug (two gestures, fully
  general). Wire-drag rubber band lives in a fixed `#wire-overlay` svg.
- New tree-carrying StructOps: ReplaceTree / InsertTree / SetModTree (+
  `graft`). Gate test still applies every op everywhere.
- Verified live: analyser peak changed 0.77→1.5 on a held note with zero
  worklet re-patch messages; bank→tray→wire→module-count flows; LFO→mod;
  unplug→tray. Zero console errors.
- JS/Rust must agree on serde shapes: fragments are externally tagged
  (`{"Vco":{...}}`, `"None"`), StructOp is `{"op":"insert_tree",...}`.

# (pass 3) — feature-complete

## Pass 3 (playtest-3 response): toward feature-complete

- **Structural editing** (`grammar/mutate.rs`): StructOp {Replace, Insert,
  Delete, SetMod, SwapMix} by node key — type-safe by construction on the
  typed tree ("reconnect nodes" = tree restructuring, not free cables);
  defaults per NodeKind; MAX_SIZE 24 / MAX_DEPTH 9 caps. Gate test applies
  every op at every key of 30 random trees: always compilable +
  trace-roundtrippable, invalid ops reject cleanly. UI: per-module ⋯ menu
  (replace with / insert after / modulation / swap inputs / delete; amp
  module = add-at-output); structural edits go through the bench flow (wasm
  `edit_structure`), re-render, re-patch the live synth, and **clear locks**
  (addresses shift).
- **Presets** (`grammar/presets.rs`): 8 hand-designed named patches, all
  vet-gated by test; bank-header PRESETS popup → `load_preset` inserts with
  `Origin::Preset` (glyph ▤) and opens it. Seeds taste fast.
- **Names**: `Candidate.name` + `set_name`; unnamed patches display
  `PatchTree::signature()` (spine tags like `saw·ladr·dly`) instead of bare
  numbers; double-click bank name → inline rename (keydown/keyup
  stopPropagation so typing doesn't play notes!).
- **Dynamic styles**: fit K = 1 + observations/20, capped at
  `cfg.k_styles` (now 5). Idle lenses collapse on their own. NOTE: this
  diluted the closed-loop test's per-lens cosine → that check is now a 0.3
  sanity floor (predictive asserts are the real gate).
- **Map click** now selects in place (no tab jump): opens on bench + live +
  highlights/scrolls the bank item; stays on TASTE.
- **Duel card flip**: ⇄ circuit flips waveform → read-only mini rack
  (shared `buildRack(svg, rack, {interactive, fit})` renderer) + "⌖ promote
  to play". Flips reset on each new duel.
- 30 tests green; all flows playwright-verified, zero console errors.

# (pass 2) — the instrument

## Pass 2 (playtest-2 response): EvoSynth is now a playable instrument

User feedback: "this is a modular synthesizer — people will want to PLAY it";
virtual keyboard + computer keys; patch is the main screen; no scrolling;
sidebars/menus/tabs; Animoog Z inspiration. Decisions (AskUserQuestion):
**4-voice poly**, **3-tab frame** (PLAY / EVOLVE / TASTE + bank sidebar +
docked keyboard), **everything live** (duel cards load into the live synth;
phrase button kept for fair A/B stimulus).

What shipped:
- `evosynth-wasm/src/live.rs` — `LivePoly`: N compiled copies of one patch
  (same `compile()` path as evolution, limiter included), MIDI note_on/off
  with oldest-note stealing, legato steal past N held notes, **silent-tail
  voice parking** (|L|+|R| < 1e-6 for 4096 frames → stop ticking). Native
  test `live_poly_plays_and_parks`. Perf: ~11 s of 4-voice audio in 0.14 s
  native — huge real-time headroom.
- `apps/web/live-audio.js` — AudioWorklet assembly. **Hard-won gotchas:**
  worklets have no fetch and no TextDecoder/TextEncoder (polyfill required);
  static imports inside a worklet would hit the un-versioned browser cache;
  and a transferred `WebAssembly.Module` silently dies as a `messageerror`.
  Solution: fetch versioned glue text, strip `export` statements, inline it
  into a **blob module** (polyfill + glue + processor), transfer **raw wasm
  bytes**, `initSync` inside the worklet (sync compile is allowed
  off-main-thread). Debug hooks: `window.__evo`, `window.__evoLog` (worklet
  posts boot/ready/patched/patch_error/worklet_error).
- App frame (index.html/style.css/main.js rewritten): menubar (wordmark,
  PLAY/EVOLVE/TASTE viewtabs, counters, LEDs, profile), 252px patch-bank
  sidebar (ranked pool: origin glyph ◇⚡✎, utility bar, stars, cut; click →
  workbench + live), stage views (PLAY = rack full-screen + toolbar;
  EVOLVE = duel cards + evolve pool + lineage strip; TASTE = full-screen
  map/styles/directions), docked piano C3–C6 (pointer glissando, key hints,
  z/x octave, HOLD latch, ◼ panic, volume). 100vh, `overflow: hidden`
  everywhere. Old bench panel is gone — the bank replaced it.
- Live-patch routing rule: every worker `bench` message carries `treeJson`;
  whenever one arrives (open, knob edit, evolved child) the worklet
  re-patches — **edits are audible on the keyboard in real time**. Duel-card
  click sends `tree_json` for that id.
- Verified via playwright incl. **audio RMS through an AnalyserNode** (peak
  0.41 on a latched C4), edit→"patched" roundtrip, duel-card live load,
  6 duels → fit, all tabs, zero console errors.

Prior notes (pass 1) follow — still accurate for the engine layer.

# (pass 1) Continuation notes — 2026-07-29

Working doc for resuming after context compaction. Durable design lives in
`DESIGN.md` (canonical); lineage/decisions pointer in Claude memory
(`evosynth-lineage`). This file: exact state, gotchas, next moves. Delete
when stale.

## Where things stand

M0–M5 plus the **playtest-1 response pass** are complete on `main` (local
repo, no GitHub remote). 27 tests green (`cargo test --workspace --release`,
~90s — locked-refinement test renders a lot), clippy/fmt clean. The web app
was verified live via playwright: boot → duels → fit → workbench edit →
lock → commit(+improvement duel) → ⚡ evolve-from (both the locked-refusal
and accepted paths) → lineage/diff display → map click-to-open. Zero console
errors.

**User's playtest-1 notes and what was built in response:**
1. *"No obvious directionality"* → lineage system: every refine/edit is a
   `LineageEvent` (generation, parent→child ids, trace-address diff,
   Δutility), shown as the EVOLUTION strip (utility sparkline + humanized
   moves: "gen 2 ⚡ on #41 → #42 · release 0.42→0.44 · Δtaste +0.14").
2. *"See the full patch, knobs in position, fully interactive"* → the
   WORKBENCH: `describe()` (grammar crate) renders any `PatchTree` as
   modules/knobs/wires; every knob carries its live trace address; dragging
   writes via `set_param` (trace roundtrip), re-renders + re-vets in the
   worker. COMMIT inserts as a new candidate; "my edit is better" logs an
   edited-beats-original duel (user chose "Both, user-flagged").
3. *"Lock knobs and evolve the rest / evolve structure"* → per-knob and
   per-module locks; `Engine::refine_from(seed, locked)` rejects MH steps
   touching locked addresses **outside the kernel** (valid
   Metropolis-within-Gibbs on the conditional; step count scaled for wasted
   proposals). LOCK KNOBS / LOCK WIRING give settings-only / structure-only
   evolution.
4. *"Box-whisker reads as one patch, not my taste"* → (a) model change:
   utility is now **max of K=3 linear experts** `u = max_k θ_k·φ` (see
   below); (b) three taste views: MAP (2D PCA of pool + history ghosts,
   glow = posterior utility, hue = style island, click-to-open), STYLES
   (per-lens pool share + top features + exemplars), DIRECTIONS (per-lens
   feature bars with capped whiskers).

## The mixture story (important modeling lesson)

First attempt was a per-observation *marginalized latent lens*:
`log p(o) = lse_k(ln w_k + ll(o|θ_k))`. The synthetic bimodal gate
**failed**: that model applies one lens to both duel items, so a duel
*across* islands (great drone vs mediocre pluck) is unrepresentable — it
scored no better than K=1. Fix: put the nonlinearity in the utility itself,
`u(x) = max_k θ_k·φ(x)`, shared by all three likelihoods. No discrete sites;
K=1 ≡ old model; label switching handled by `TastePosterior::aligned()`
(exhaustive permutation match, K ≤ 5). Gate
`mixture_captures_bimodal_taste` (taste crate) pins all of this: mirrored-θ
bimodal user, K=2 must beat K=1 on held-out duels AND recover both
directions. `responsibilities(φ)` = posterior P(lens k is φ's argmax);
`style_share(pool)` ≈ island sizes; a lens with ~0 share is idle.

## What lives where (deltas from M5)

- `evosynth-grammar`: + `describe.rs` (RackDescription: modules/knobs/wires,
  every knob addr is a live trace site — pinned by
  `rack_description_addresses_are_live`), + `edit.rs` (`set_param` via trace
  roundtrip; structural sites rejected), + `diff.rs` (`tree_diff` in
  trace-address terms, display-formatted values).
- `evosynth-taste`: max-of-experts model (above); `TasteSample` lost
  `styles`/`weights` fields; `utility_mix`, `prob_prefers(a,b)` (no style
  arg), `aligned()`, `responsibilities`, `style_share`;
  `MixtureSyntheticUser` (max-utility ground truth).
- `evosynth-session`: `Candidate.id` (stable, u64) + `find(id)`; `Origin`
  {Prior,Refined,Edited} replaced `refined: bool`; `LineageEvent` +
  `Engine.lineage`/`generation`; `refine_from(seed_id, locked)`;
  `commit_edit(original, tree, as_improvement)` (edited patches always land,
  protected original, optional duel obs); `Profile` = log **+ standardizer**
  (fixes the θ-vs-standardizer portability gap; `import_profile`
  re-standardizes the pool); `map.rs` = `taste_map()` (top-2 PCA by power
  iteration, deterministic start, pool + ≤400 history ghosts). K=3 default
  (`SessionConfig.k_styles`).
- `evosynth-wasm`: id-based API (ids as **u32** over the boundary —
  wasm-bindgen maps u64→BigInt, avoid); workbench (`edit_begin/param/
  render/describe/commit/cancel`, vet-withholds audio on failure);
  `refine_from(id, locks_json)`; `taste_map/styles/lineage`;
  `export_profile/import_profile`.
- `apps/web`: WORKBENCH panel (SVG rack: gradient faceplates, rotary knobs
  −135°..+135°, enum selectors, green/amber cables with sag, per-knob lock
  dots + module locks, drag-to-edit with in-flight coalescing +
  audition-on-release), taste tabs, EVOLUTION strip, bench ⌖ open buttons,
  map click-to-open. Worker protocol is id-based; `edit_rejected` reply
  prevents an in-flight deadlock.

## Sharp edges (new ones)

- **wasm-bindgen u64 → BigInt**: keep boundary ids u32.
- Knob drags must NOT re-render the SVG mid-drag (pointer capture dies) —
  `knobDragging` flag suppresses `renderRack()` until pointerup.
- Worker must reply to every `edit_param` (ok or `edit_rejected`), else the
  main-thread edit queue deadlocks.
- Evolving with *everything* locked usually finds no acceptable move
  (structural proposals shift locked addresses → rejected). The UI says so
  ("loosen some locks"). Expected, not a bug.
- `closed_loop` test: with K=3 and a unimodal synthetic user, check the
  **best** lens's cosine, not lens 0's.
- Old sharp edges from M5 all still apply (Model not Clone, release-only
  audio tests, `PATH="$HOME/.cargo/bin:$PATH"` for wasm builds, quiver Q200
  still uncommitted in ../quiver).

## Run/verify

```bash
cargo test --workspace --release
PATH="$HOME/.cargo/bin:$PATH" wasm-pack build crates/evosynth-wasm --target web --release --out-dir ../../apps/web/pkg
cd apps/web && python3 serve.py   # no-store server — plain http.server lets the browser cache worker.js/pkg across rebuilds
```

## Next moves (playtest 2 will decide)

- Grid mode & radio mode (M6 remainder); naming/pinning styles.
- Structure *editing* on the workbench (add/remove modules by hand) — edits
  currently cover knobs/selectors only; structure changes go through ⚡.
- Stable-id cleanup is done; remaining backlog: per-style audition phrases,
  feedback-loop grammar productions, θ_struct → grammar weights, SMC pool
  generation, nih-plug/AUv3, GitHub remote, quiver Q200 PR.
- Watch: does K=3 discover real islands in the user's actual taste? Are
  duels still the right primary surface once the workbench exists?
