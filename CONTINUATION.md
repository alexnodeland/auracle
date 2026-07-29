# Continuation notes — updated 2026-07-29 (post-playtest pass 2: the instrument)

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
