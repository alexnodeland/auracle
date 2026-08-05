# API documentation

<p class="lede">Generated rustdoc for every crate in the workspace.</p>

<div class="crate-grid">

- [**auracle_grammar**](./api/auracle_grammar/index.html) — the genome: typed
  PCFG, trace codec, compiler, structural edits, presets
- [**auracle_features**](./api/auracle_features/index.html) — render, vet,
  LUFS-normalize, extract $\varphi$
- [**auracle_taste**](./api/auracle_taste/index.html) — the utility model,
  three likelihoods, MCMC posterior, standardization
- [**auracle_session**](./api/auracle_session/index.html) — the two-loop
  engine, acquisition, calibration, persistence
- [**auracle_wasm**](./api/auracle_wasm/index.html) — `WasmEngine` and `LivePoly`

</div>

Built with `cargo doc --workspace --no-deps`, so the dependency crates are not
included. [quiver](https://docs.rs/quiver-dsp), [fugue-ppl](https://docs.rs/fugue-ppl)
and [fugue-evo](https://docs.rs/fugue-evo) have their own docs on docs.rs.

## Where to start

The doc comments in this codebase carry a lot of the reasoning, and a few are
worth reading directly rather than through this book's summary of them:

| For | Read |
|---|---|
| The grammar's site table | `auracle_grammar::prior` module docs |
| Why $\varphi_{\text{struct}}$ has families rather than per-module columns | `auracle_features::structural` module docs |
| The max-of-experts argument, and the $s_K$ correction | `auracle_taste::model` module docs |
| Why the standardizer's threshold is $10^6$ | `auracle_taste::standardize::RUNAWAY_RATIO` |
| Why refinement is 40 steps × 10 seeds | `auracle_session::SessionConfig::refine_steps` |
| The acquisition measurement, in full | `auracle_session::Acquisition` |
| Why accuracy was replaced by Brier skill | `auracle_session::calib` module docs |

## Building it locally

```bash
cargo doc --workspace --no-deps --open
# or, the target this site uses:
make site-api
```

## What rustdoc covers

The generated docs are authoritative about **signatures and invariants**, and
they are where the numbers live. They are deliberately quiet about the
*pipeline*: no rustdoc page explains why vetting has to run before
normalization, because that fact belongs to no single item.

That is the division of labour between this book and the API docs: the book
owns the reasoning that spans crates, and rustdoc owns the reasoning that fits
beside a definition.
