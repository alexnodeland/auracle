# Lineage

<p class="lede">Auracle is the third attempt at the same idea. The first two
are why this one is shaped the way it is.</p>

| Iteration | Year | What it proved | What it lacked |
|---|---|---|---|
| **neuralCompressor** (C++/Arduino pedal) | 2020 | The interaction model: human-based GA, fit/unfit foot-switch, mutate/crossover knobs | The engine — EA and DSP were never implemented |
| **evosynth v1** (Next.js/Tone.js + FastAPI/DEAP) | 2025 | A working interactive GA over a fixed ~30-parameter subtractive synth; parameter locking; lineage tracking | Preference *persistence* (ratings died each generation), topology evolution, principled inference |
| **Auracle** (this project) | 2026– | — | — |

v0 had the interaction but no engine. v1 had an engine, but a naive one with no
memory of the user. Both of those gaps are load-bearing in the present design:

- **The engine is real, and it is inference rather than a genetic algorithm.**
  Search is [Metropolis–Hastings in trace space](../search/target.md) against a
  [Boltzmann target](../search/target.md) whose fitness is a fitted posterior,
  not a hand-written scoring function.
- **Preferences persist.** Every judgement enters an
  [observation log](../taste/likelihoods.md) that outlives the generation it
  was made in, the session it was made in, and — via profile export — the
  browser it was made in.

## Platform

Web and WebAssembly first: both foundations ship first-class WASM, and the
interaction design was the unsettled part, so the fastest iteration loop won.
That is what exists.

A desktop plugin via `nih-plug` (VST3/CLAP) and then AUv3 via a Swift shell are
the intended next shells; neither is started. The constraint they inherit is
the one the web build already keeps: **inference and rendering stay off the
audio thread**, which only ever plays the current patch.
