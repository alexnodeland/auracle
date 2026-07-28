# Continuation notes — session of 2026-07-28

Working doc for resuming after context compaction. Durable design lives in
`DESIGN.md` (canonical); lineage/decisions pointer in Claude memory
(`evosynth-lineage`). This file: exact state, gotchas, and the next moves.
Delete when stale.

## Where things stand

**M0–M5 all complete and committed on `main`** (local repo, no GitHub remote
yet). 21 tests green (`cargo test --workspace --release`), clippy clean,
`cargo fmt` clean. History:

```
5602348 chore: remove stray verification screenshots
2cd41b1 feat(web): M5 — wasm bindings + web app (duel mode, bench, taste CRT)
209dedf feat(session): M4 — two-loop engine, Thompson acquisition, closed-loop gate
0bba1d3 feat(taste): M3 — mixture-BLR taste model, three likelihoods, synthetic-user gate
d3b3a25 feat(features): M2 — phrase renderer, BS.1770 loudness, vetting gate, φ
068b059 feat(grammar): M1 — typed PCFG patch prior, genome traits, term→Patch compiler
cd4abe3 feat: M0 scaffold — workspace, design doc, crate skeletons, CI
```

**The user is now playtesting the web app and will return with notes.**
Expect feedback on: duel pacing, phrase length/content, fit cadence (every 6
duels), sound quality/diversity of the prior, taste-CRT legibility, bench UX.

## Run/verify commands

```bash
cargo test --workspace --release          # full suite (~50s)
cargo run -p evosynth-session --example learn_synthetic --release   # fast-forward demo
cargo run -p evosynth-grammar --example random_patches --release    # WAVs → target/random_patches
cargo run -p evosynth-features --example pipeline_stats --release -- 200

# wasm rebuild (Homebrew rustc SHADOWS rustup's and lacks wasm std — always prefix):
PATH="$HOME/.cargo/bin:$PATH" wasm-pack build crates/evosynth-wasm --target web --release --out-dir ../../apps/web/pkg
cd apps/web && python3 -m http.server 8642   # module workers need http://
```

## Architecture map (what lives where)

- `crates/evosynth-grammar` — `PatchTree` term genome (bespoke enums, NOT
  `TreeGenome<T,F>` — its `Terminal::encode` forces single-f64 payloads).
  `PatchGrammarPrior: GenomePrior` (fugue program; addresses `node/0/m#site`);
  canonical `TraceGenome` encoding == grammar scheme (pinned by
  `to_trace_inverts_generative_run`). `compile()` → quiver Patch with
  mandatory ADSR→VCA→Limiter→StereoOutput, `ExternalInput::voct/gate` +
  `AtomicF64` handles, Offset-node constants, `connect_attenuated` mod depth.
  Compiles under `ValidationMode::Warn` + warning-class allowlist (quiver
  `Strict` rejects the blessed Offset→unipolar idiom).
- `crates/evosynth-features` — `PhraseSpec` (3-note phrase, seed; determinism
  via `quiver::rng::seed`), BS.1770 K-weighted gated LUFS + normalize (target
  −18, +30 dB cap), vet gate (NonFinite/Silent/Overlevel/DcDominated),
  φ_audio (12 dims) + φ_struct (16 dims) = d=28, `featurize()` →
  `VettedCandidate` (render doubles as audition buffer). ~98% of prior draws
  pass vet.
- `crates/evosynth-taste` — fugue program: `theta<k>#i ~ N(0, 1/√d)`,
  `tau#s`, ordered cuts via exp-increment transform of `cut#j`, `z#s` at K>1;
  ONE `factor` sums all three likelihoods (BT duels, σ(u−τ) keep/kill,
  cumulative-logit stars). Fit = `fugue::adaptive_mcmc_chain` (model returns
  decoded `TasteSample`). K=1 shipping; K>1 code path exists (smoke-tested
  only). `ObservationLog` JSON = source of truth (workspace serde_json has
  `float_roundtrip` — required for bit-identical reload).
- `crates/evosynth-session` — `Engine`: `fill_pool[_step]` (standardizer fit
  on first full pool), `fit_posterior`, `refine` (EvolutionChain warm-start
  `init_from` on Boltzmann target with `SurrogateFitness` = posterior mean
  utility; quarantine → −50), `next_duel` (dueling Thompson: two posterior
  draws, duel their champions; runner-up under s2 if same), record_*.
  Closed-loop gate: r>0.6 vs truth in 60 duels through the REAL pipeline.
- `crates/evosynth-wasm` — `WasmEngine` for a module Web Worker. JSON +
  transferable Float32Array boundary. fugue-evo dep scoped
  `default-features=false, features=["std","ppl"]` (checkpoint/parallel
  don't compile on wasm32); `getrandom = { features=["js"] }`.
- `apps/web` — `worker.js` (owns engine), `main.js` (WebAudio playback of
  transferred buffers, scopes, taste CRT, bench), `style.css` (Eurorack
  faceplates: rails/screws/Futura silkscreen; green phosphor = audio, amber =
  taste), `index.html`. FIT_EVERY=6 in main.js; poolSize=40 at init;
  wasm mcmc 20k/6k. `pkg/` is a build artifact (self-gitignored by
  wasm-pack). Verified via playwright: boot→duel→fit→CRT→bench→evolve, zero
  console errors.

## Cross-repo state

- **quiver** (`../quiver`): PR #35 (Q198 wrap_phase, Q199 scatter sanitize)
  MERGED. **UNCOMMITTED local change: Q200** — `Rng::from_system_time()`
  wasm fallback (SystemTime::now panics on wasm32 inside the thread-local
  RNG initializer; any first global-RNG touch downed a std wasm module).
  Sits on local `main`. TODO: branch → PR → merge, same flow as #35.
- **fugue-evo / fugue** (`../fugue-ecosystem/*`): used read-only, no changes.
- evosynth CI (`.github/workflows/ci.yml`) checks out quiver/fugue/fugue-evo
  siblings at HEAD (unpinned) and runs release tests. Repo has NO GitHub
  remote yet — `gh repo create` when the user wants it.

## Sharp edges (learned this session)

- fugue `Model<A>` is NOT Clone: build site-model Vecs *inside* the bind
  closure that consumes them; wrap big captured data in `Arc`.
- zsh: quote URLs with `?` in gh api calls; `awk` ranges safer than
  `sed "N,+Mp"` (BSD sed rejects `,+`).
- Debug-mode DSP is ~20× slower — audio tests/CI must run `--release`.
- `Engine.pool` indices are unstable across `refine()` (swap_remove); the
  web app tolerates this because bench holds idx + cached render, but a
  future "stable candidate id" would be cleaner (M6 candidate).

## M6 plan (not started)

1. **Grid mode** — see a generation at once (population grid, v1-style);
   emits keep/kill + stars into the same stream.
2. **Radio mode** — lean-back stream with keep/kill/skip.
3. **K>1 style discovery** — per-session `z`; UI to name/pin discovered
   styles ("saved preference sets" = conditioning on z). Needs a mixture
   quality gate (label-switching handling; currently smoke-only).
4. **Named profiles UX** — export/import exists; add profile naming +
   standardizer persistence with the log (IMPORTANT: θ is only meaningful
   relative to its standardizer; today the standardizer is refit per pool —
   importing a log into a fresh pool is subtly wrong. Fix: serialize
   standardizer alongside the log in export).
5. Quiver Q200 PR; consider pinning CI sibling checkouts.
6. Later/backlog: per-style audition phrases, feedback-loop grammar
   productions (tamed), θ_struct reshaping grammar weights, SMC-based pool
   generation (EvolutionSMC instead of prior + MH refine), plugin (nih-plug)
   frontend, AUv3.

## Known open questions for the user's playtest

- Is the 3.2s phrase right? (notes: C4 hold / Eb4 stab / C3 long tail)
- FIT_EVERY=6 — too eager/lazy? Fit takes a few seconds in-browser.
- Prior diversity: too many near-duds? source_prob=0.4, max_depth=5,
  op_weights favor filters.
- Does the amber CRT read as "the model's mind"? Feature nice-names right?
- Bench: is star-rating there discoverable/used?
