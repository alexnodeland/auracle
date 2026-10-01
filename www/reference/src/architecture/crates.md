# The crates

<p class="lede">Core-library-first. Every frontend is a thin shell over the same
engine.</p>

```text
crates/
  auracle-grammar    the genome: typed PCFG over quiver combinator terms,
                      trace codec, term → Patch compiler, structural edit ops,
                      rack description, presets
  auracle-features   phrase render → vet → LUFS-normalize → φ extraction
  auracle-taste      max-of-experts utility, three likelihoods, MCMC posterior,
                      standardization, portable profiles
  auracle-session    the two-loop engine: pool, acquisition, refinement,
                      lineage, calibration, persistence, migration
  auracle-wasm       WasmEngine (worker-side brain) + LivePoly (worklet-side
                      instrument)
apps/web             the instrument: vanilla JS, no build step
```

Dependencies run strictly downward: `grammar` knows nothing of features,
`features` nothing of taste, `taste` nothing of the engine. `session` is the
only crate that sees all of them, and `wasm` is a binding surface with no logic
of its own.

## auracle-grammar

The **representation**, and the crate everything else is built on.

| Module | Owns |
|---|---|
| `term` | `PatchTree`, `AudioNode`, `ModNode`: the genome type. The Audio/Mod sort split is enforced by Rust’s type system, so ill-sorted terms are unrepresentable |
| `prior` | `PatchGrammarPrior`: the PCFG as a fugue program. Implements fugue-evo’s `GenomePrior` |
| `genome` | The canonical trace codec. **This is the addressing scheme**, and a round-trip property test keeps it from drifting |
| `compile` | Term → quiver `Patch`, with live parameter handles. Nearly 5,000 lines, the largest single file in the workspace |
| `mutate` | Structural edit operations, and their validity gate |
| `edit` | Single-site parameter writes by address |
| `diff` | Human-readable diffs between two terms: what the lineage log prints |
| `describe` | The rack description the panel draws from |
| `presets` | The 62-patch hand-made library, in seven families |

**`genome`’s codec *is* the grammar’s addressing.** It is one scheme rather
than two kept in sync, which is what makes a knob turn, a lock, and an MH
proposal refer to the same thing.

## auracle-features

The **measurement** crate. One render serves three purposes: the vet report,
the feature vector, and the audition buffer the player hears.

| Module | Owns |
|---|---|
| `phrase` | `PhraseSpec`: the standard stimulus |
| `render` | Deterministic headless rendering through quiver |
| `vet` | The quarantine gate |
| `loudness` | ITU-R BS.1770 K-weighting, gated integrated loudness, and the peak ceiling |
| `audio` | $\varphi_{\text{audio}}$: 18 perceptual descriptors |
| `structural` | $\varphi_{\text{struct}}$: 26 structural descriptors |
| `pipeline` | The composition, in the one order that is safe |
| `cache` | Render memoization and the persistent-cache namespace; what makes the MH walk affordable |

`pipeline::featurize` is the whole crate in forty lines, and the order it
composes them in matters; see
[The vetting gate](../audition/vetting.md#the-order-is-the-design).

## auracle-taste

The **model**. No knowledge of patches at all: it consumes standardized feature
vectors and feedback events.

| Module | Owns |
|---|---|
| `model` | `TasteModel` as a fugue program; `TastePosterior` and its summaries |
| `observe` | `Feedback`, `ObservationLog`, `FitSet`, and the by-name projection that migrates old logs |
| `standardize` | The affine transform, with runaway-column detection |
| `synthetic` | `SyntheticUser`: the non-negotiable validation gate |

`synthetic` is not a test helper that happens to live in `src/`. It validates
the taste model against a simulated user with known ground truth: assert the
posterior concentrates on $\theta^*$, and that acquisition regret shrinks. That
makes the core falsifiable headlessly.

## auracle-session

The **engine** every frontend drives.

| Module | Owns |
|---|---|
| `engine` | `Engine`: pool, log, posterior, refinement, workbench, lineage. About 4,100 lines |
| `walk` | A generation’s walks as data: the jobs, the context they share, and the walk as a pure function |
| `perform` | PERFORM’s named controls, drift, and offers |
| `surrogate` | The learned taste as a fugue-evo `Fitness` |
| `calib` | Prequential forecast scoring and reliability diagrams |
| `map` | The 2D projection behind the taste map |
| `naming` | Generated patch and style names |
| `farm` | Indexed draw seeding: what makes parallel filling reproducible |
| `migrate` | Loading sessions written by older versions |

## auracle-wasm

Two objects, on two threads, and the split matters:

- **`WasmEngine`** is the whole `auracle-session` engine, in a Web Worker. Pool
  filling, posterior fits, refinement, workbench edits. Nothing real-time.
- **`LivePoly`** is the instrument, in an AudioWorklet. It holds $N$ compiled
  copies of the current patch, via **the same `compile()` path evolution
  uses**, limiter included.

So what the instrument plays is not a re-implementation of what was evolved; it
is the same compiled artifact. See [The web runtime](../runtime.md).

## apps/web

Vanilla JavaScript, no build step, no framework, no dependencies. Eight scripts
carry it: `main.js` (UI and Web Audio), `worker.js` (the engine), `farm.js` (a
stateless render and walk worker), `live-audio.js` (worklet assembly),
`perform.js` (PERFORM), `midi.js` (MIDI controllers), `booth.js` (booth mode),
and `taste-geom.js` (the TASTE view’s geometry).

Its own architecture notes are in
[`apps/web/README.md`](https://github.com/alexnodeland/auracle/blob/main/apps/web/README.md);
the parts that constrain the engine are in [The web runtime](../runtime.md).

## Foundations, from crates.io

| | |
|---|---|
| `quiver-dsp` **0.3.3** | Modular DSP. Library name is `quiver` |
| `fugue-evo` **0.3.1** | Evolution as inference. `default-features = false`, because `checkpoint` and `parallel` do not compile on wasm32 |
| `fugue-ppl` **0.2.2** | The probabilistic programming layer |

All three come from the registry. To hack on them alongside Auracle, add a
`[patch.crates-io]` block at the bottom of the workspace manifest.

Two build settings worth knowing, both in `Cargo.toml`:

- **Release builds use `lto = "fat"`, `codegen-units = 1`, `panic = "abort"`.**
  Everything the player waits on is render-bound. `panic = "abort"` also drops
  unwinding tables from the wasm bundle. None of these can change float
  results; only `--fast-math`-style options could, and none is enabled.
- **`serde_json` with `float_roundtrip`.** The observation log is the profile’s
  source of truth and must reload bit-identically; serde_json’s fast float
  parse can be off by one ULP.
