# What one phrase render costs, October 2026

The profile [#298](https://github.com/alexnodeland/auracle/issues/298) asks
for: where the time of one render of the audition phrase goes, natively and in
wasm, and what can be taken out of it. Almost every wait in the app is a
number of these renders (#297): PERFORM's measurement is about 25, an offer's
walk 15 to 20, a fill one per sound.

Measured on 2026-10-06 from `c8541631`, with quiver-dsp 0.4.0, on an Apple M3
Max (12 performance and 4 efficiency cores) that other jobs were sharing: the
load average ran between 60 and 175 throughout, and each table says what it
was. Under that load wall time says little (a 650 ms render took 7 s of wall
time in one run), so every figure is a thread's CPU time, and the least of
several repeats: a busy machine stretches a render's wall time by however long
its thread waited for a core, and does not stretch its CPU time, though an
efficiency core or a contended cache still can, which is why the least is the
one to read. Shares from a sampling profiler hold under load. Absolute times on
a quiet machine will be lower. Dated, and not kept current; `make bench-render`
is.

## Files

| File | What it is |
| --- | --- |
| `crates/auracle-features/examples/bench_render.rs` | The native bench (`make bench-render`): the set in ms per render; `--stages`, `--nodes`, `--census=N`, `--kinds`, `--allocs`, `--digest`, `--phi`, `--loop=N` (its header says each) |
| `crates/auracle-features/examples/bench_render.json` | The set: PERFORM's six presets (the ones `auracle-session`'s PERFORM tests play) and the first twelve vetted draws of the prior from seed 20261006, frozen as trees |
| `crates/auracle-wasm/examples/bench_render.mjs` | The wasm bench: the same trees through `farm_render` under node; two packages side by side for a before and after; `--digest` (and `--bank`) for the same measurement, bit for bit |
| `crates/auracle-wasm/examples/voice_cost.mjs` | One live voice of each module kind through `LivePoly`, in wasm |
| [`ab_native.py`](ab_native.py) | Two native bench binaries, run alternately, each tree's least kept on each side |
| [`fold_xctrace.py`](fold_xctrace.py) | A native Time Profiler trace folded into stages, the graph walk and each module kind |
| [`fold_cpuprofile.py`](fold_cpuprofile.py) | The same for a V8 CPU profile of the wasm bench |
| [`stages-before.txt`](stages-before.txt), [`stages-after.txt`](stages-after.txt) | `bench_render --stages` before and after the knobs were folded |
| [`native-profile.txt`](native-profile.txt) | The native profile, folded (symbols only) |
| [`native-profile-lines.txt`](native-profile-lines.txt) | The native profile on a build with line tables: what the graph walk is made of |
| [`nodes.txt`](nodes.txt), [`census.txt`](census.txt) | What each tree of the set compiles to and walks; the same over 2000 prior draws |
| [`voice-cost-native.txt`](voice-cost-native.txt), [`voice-cost-wasm.txt`](voice-cost-wasm.txt) | One voice of each module kind, natively and in wasm |
| [`ab-native-fold.txt`](ab-native-fold.txt), [`ab-wasm-fold.txt`](ab-wasm-fold.txt) | Folding the knobs, before and after, natively and in wasm |
| [`ab-native-review.txt`](ab-native-review.txt) | After the review: the baseline and the fold as first shipped, each against the fold tried on stand-ins |
| [`wasm-profile.txt`](wasm-profile.txt) | The wasm profile (V8, a build that keeps its names), folded, and its math split by caller |
| [`browsers.txt`](browsers.txt) | The set in Chromium and Firefox, in a worker and on the page |
| [`allocs.txt`](allocs.txt) | What one render allocates (`bench_render --allocs`) |
| [`build-settings.txt`](build-settings.txt) | `simd128` and `wasm-opt -O4`, in wasm |
| [`phi_moves.py`](phi_moves.py) | How far a change that moves the sound moves φ, in each coordinate's spread |
| [`analysis-norm-sqr.diff`](analysis-norm-sqr.diff), [`phi-moves-norm-sqr.txt`](phi-moves-norm-sqr.txt), [`ab-native-norm-sqr.txt`](ab-native-norm-sqr.txt), [`ab-wasm-norm-sqr.txt`](ab-wasm-norm-sqr.txt) | `norm_sqr().sqrt()` for `hypot` in φ's spectral frames: the diff, how far φ moves, and its runs |
| [`revalidate/`](revalidate/) | `make revalidate`'s tables before and after the folding, and L1's and L2's `phi-stats` and `norm-peak`, with L1's diff |
| [`quiver/`](quiver/) | The quiver changes measured in a scratch copy (each a diff against 0.4.0) and their runs: `ab-native-*` (the set), `ab-kinds-*` (one live voice of each kind), `ab-wasm-*`, `voice-wasm-*`, `phi-moves.txt` |

## How to run it again

```
make bench-render                                   # both halves, on this checkout (make wasm first)
cargo run -p auracle-features --example bench_render --release -- --stages
cargo run -p auracle-features --example bench_render --release -- --kinds=/tmp/kinds.json
node crates/auracle-wasm/examples/voice_cost.mjs /tmp/kinds.json

# two builds against each other: build each checkout's bench, then
python3 docs/notes/render-cost-2026-10/ab_native.py BEFORE/bench_render AFTER/bench_render 3 3
node crates/auracle-wasm/examples/bench_render.mjs --reps=3 --rounds=3 BEFORE/apps/web/pkg AFTER/apps/web/pkg

# the same measurement, bit for bit? (φ, the vet report, the face, the onsets)
bench_render --digest; bench_render --digest --bank        # on each build; diff the two

# a quiver change, measured without releasing quiver: in a scratch copy of the
# workspace, append to Cargo.toml
#   [patch.crates-io]
#   quiver-dsp = { path = "/path/to/a/patched/quiver-dsp-0.4.0" }
# build its bench and engine, and compare as above; bench_render --phi on both,
# then phi_moves.py, says how far φ moves

# the native profile (macOS)
CARGO_PROFILE_RELEASE_DEBUG=line-tables-only cargo build --release -p auracle-features --example bench_render
xctrace record --template 'Time Profiler' --output r.trace --launch -- target/release/examples/bench_render --loop=2
xctrace export --input r.trace --xpath '/trace-toc/run[@number="1"]/data/table[@schema="time-profile"]' > r.xml
python3 docs/notes/render-cost-2026-10/fold_xctrace.py r.xml

# the wasm profile: fold_cpuprofile.py's header says how to build an engine that keeps its names
node --cpu-prof --cpu-prof-dir=/tmp/prof crates/auracle-wasm/examples/bench_render.mjs --reps=2 /tmp/pkg-prof
python3 docs/notes/render-cost-2026-10/fold_cpuprofile.py /tmp/prof/*.cpuprofile
```

Run the bench without `nice`: it measures CPU time, but a niced process on a
busy machine lands on efficiency cores more often, and their time is not a
performance core's.

## In short

- **A render is its DSP.** Natively 94% of the farm's job is ticking the patch
  through the phrase; φ's analysis is 3%, loudness 1%, the face 0.8%, vetting
  0.2%, compiling the tree 0.03%, and the farm's JSON 0.003%
  ([stages](stages-before.txt)). In wasm the analysis is about 12%, most of it
  one function (`hypot`, below).
- **More than half of the DSP is quiver's graph walk, not the modules.** For
  each node, every sample, quiver gathers the inputs into a `PortValues`,
  calls the module through `dyn GraphModule`, and scatters the outputs. That
  walk is 55% of a render natively and 41% in wasm, against 39% and 28% in the
  modules' own `tick`s ([native](native-profile.txt), [wasm](wasm-profile.txt)).
- **Built here: a measurement render folds its knobs.** About half of a
  patch's nodes are live knobs, each a node the walk visits every sample to
  read a value nothing changes during a measurement. A render now folds each
  into the port it drives: the same samples, bit for bit, through 55% of the
  nodes. **A render takes 14.8% less CPU natively, 17.4% less in wasm under
  node, and 15.4% and 19.6% less wall time in Chromium's and Firefox's
  workers.**
- **The ladder is the costliest module by far.** One live voice costs 10.5 ms
  of CPU per voice-second natively and 14.5 in wasm with a saw; a ladder adds
  41 and 47. A cheaper `tanh` in quiver's ladder (a Padé approximant) takes
  35% off a ladder voice, natively and in wasm, and moves φ by at most 2e-10
  of a coordinate's spread; it is quiver's to release, and the maintainer's
  to decide ([the ladder](#the-ladder)).
- **In wasm, 7.5% of a render is one function**: `hypot`, taken on every bin
  of φ's spectral frames, which wasm computes with a software fused
  multiply-add. `norm_sqr().sqrt()` in its place takes 9.2% off a wasm render
  and moves φ by at most 1.1e-14 of a spread: the maintainer's to decide
  ([in wasm](#in-wasm)).
- **Firefox renders in a worker at about 1.2 times Chromium's time**, which
  is where the app renders. On a page's main thread it took 5 to 6 times as
  long, which the app never asks of it ([browsers](#in-the-browsers)).
- **Build settings are spent.** Release is already fat LTO, one codegen unit,
  `panic = "abort"` and `wasm-opt -O3`; `simd128` measured 2.2% faster in wasm
  and `wasm-opt -O4` 1.1%, both within the spread here ([build settings](#build-settings)).

## Built

Measured on 2026-10-09 on a 4-core Linux machine (a node v22 process's CPU time,
the least of three repeats, nothing else running for the wasm A/B), `make wasm`
build `a75387180e8f160c`.

- **quiver-dsp 0.4.1** carries L0 and L2 (the cheaper module paths and the
  Padé-clamped `tanh` in the diode ladder) and the shorter graph walk. This
  workspace takes it as `quiver-dsp = "0.4.1"`.
- **`norm_sqr().sqrt()`** replaces `hypot` at both spectral sites in
  `auracle-features/src/audio.rs`.
- **A wasm render takes 39% less CPU**: the set of 18 trees, 9691 ms before and
  5870 ms after, in one process with both packages run alternately
  (every tree between 0.50 and 0.71 of its time).
- **A native render takes about 32% less**: 6048 ms to 4122 ms over the set.
  The before run shared the machine with other jobs (load 6 to 20) and the
  after run did not (load 1), so read this as an upper bound; the wasm figure
  is the paired one.
- **A live ladder voice costs about half**: 95.7 ms per voice-second before,
  49.7 after in wasm; the saw voice alone went from 37.0 to 20.0
  (`voice_cost.mjs`, the process's CPU time on node 22).
- **φ moves by at most 1.34e-11 of a spread** (`phi_moves.py` over
  `bench_render --phi`, 17 of 18 trees moved, `Ceiling` most). `phi-stats` and
  `norm-peak` print the same tables; `climb` (8 seeds on both sides, the
  maintainer's call, in place of 16) differs in generations 4 to 6 by at most
  0.006 and in one seed's final gain by 0.02 (a chaotic divergence from the last
  digit), and `search-check` was not run. `perform-wirings` re-measured, and
  `preset-faces` wrote the same faces.

## The render, by stage

`bench_render --stages`: each stage of the farm's job timed on its own, the
least of five, natively, before folding ([stages-before.txt](stages-before.txt),
load 132 to 142). Summed over the set's 18 renders:

| Stage | ms | Share |
| --- | ---: | ---: |
| The farm job (all of it) | 4509 | 100% |
| DSP: the phrase's ticks, main voice and the dyad's second | 4246 | 94.2% |
| φ's audio features | 123 | 2.7% |
| Loudness normalization | 41 | 0.9% |
| The face | 34 | 0.8% |
| Vetting | 10 | 0.2% |
| Compiling the tree, and the chord voice | 1.5 | 0.03% |
| The f32 copy of the audition, the memo key, φ_struct, the domain check | 0.9 | 0.02% |

The farm's JSON, which a farm worker adds on top (the tree parsed from the
message, the reply written), is 0.1 ms over the set
([stages-after.txt](stages-after.txt)). In wasm, `farm_render` also copies
the reply's string out; with `want_audio` it copies the 222,705-sample
audition too, which only the first few renders of a fill ask for.

So the analysis is about 4% of a render, and the FFT plans are already
shared (one per thread, `audio.rs` and `face.rs`): a cheaper analysis could
take at most a few percent, and the cheaper analyses (a real FFT, fewer
frames) move φ. Everything that pays is in the ticks.

## The DSP and the graph walk

[`native-profile.txt`](native-profile.txt): a Time Profiler trace of the set
rendered twice, every sample bucketed by the first frame from the leaf that
names a stage, a module's `tick` or `Patch::tick` itself:

| Bucket | Share of a render |
| --- | ---: |
| The graph walk (`Patch::tick`'s own time: gather, `PortValues`, dispatch, scatter) | 55.4% |
| The modules' `tick`s, with the libm they call | 39.4% |
| φ's audio features, loudness, the face | 4.5% |
| Compiling, the memo key, the rest | 0.7% |

Of the modules' 39%: the diode ladder 8.3% (two nodes in 606), the ADSR 5.0%
(one per voice), the SVF 2.7%, the limiter 2.0% (one per voice), formant 1.9%,
supersaw 1.6%, VCA 1.5%, chorus 1.4%, EQ 1.2%; nothing else over 1.1%.

What the walk is made of, from a build with line tables
([`native-profile-lines.txt`](native-profile-lines.txt)): `PortValues::slot_of`'s
linear scan 17.2% of the whole render (every `get`, `get_or` and `set` of a
port, in the gather and in every module), the scatter 8.1% (`get_at`, the
sanitize and the denormal flush per output), walking the input plans 6.1%,
`Option<f64>` slots cleared and written 4.7% + 2.8%, `get_at` 3.6%, the
gather's own loop 3.2%. That is quiver's per-sample engine, not auracle's
code: it is upstream's to change (below). Read those shares as where the
walk's time is, not as what a change would save: xctrace names each sampled
address by the innermost function inlined there, and a `PortValues` that
finds a slot by a table instead of the scan made renders no faster
([quiver](#quiver)).

## In wasm

[`wasm-profile.txt`](wasm-profile.txt): V8's profile of the wasm bench on the
set, on a build that keeps its function names (release codegen, `wasm-opt
-O3 -g`), the folded engine, under node:

| Bucket | Share of a render |
| --- | ---: |
| The graph walk (`Patch::tick`) | 41.1% |
| The modules' `tick`s, without the math they call | 27.8% |
| libm and `compiler_builtins`' math, called by the modules (1.5% of it from a caller the profiler lost) | 13.4% |
| `hypot`, under φ's audio features (`compiler_builtins`' software `fma`) | 7.5% |
| The FFTs (rustfft), φ's audio features, loudness, the face | 4.6% |
| The render loop, serde (the JSON at the boundary), the allocator, compiling | 1.1% |
| Other (`log`, `__multi3`, the loader) | 4.5% |

The ladder is 7.2% of the set's time in wasm (1.0% its own `tick`, 6.2% the
`tanh` and `expm1` it calls) from two trees of eighteen. And φ's analysis is
about 12% of a render in wasm against 4% natively, because of one function:
`num_complex`'s `norm()` is a `hypot`, taken on every bin of every FFT frame
(1024 bins by about 215 frames a render), and in wasm, which has no fused
multiply-add, `compiler_builtins`' correctly rounded `hypot` emulates one in
software. Natively it is the platform's. `norm_sqr().sqrt()` in its place
([diff](analysis-norm-sqr.diff)) takes 9.2% off the set in wasm and nothing
natively, and moves φ by at most 1.1e-14 of a coordinate's spread
([phi-moves-norm-sqr.txt](phi-moves-norm-sqr.txt)): a rounding, but not the
same bits, so it is the maintainer's to decide ([what is left](#what-is-left-ranked)).

A render allocates nothing per sample ([allocs.txt](allocs.txt)): about seven
allocations in a whole render's ticks (its buffers), 900 to 5,600 to compile
its voices, and 1,080 to 1,380 allocations (26 to 35 MB) in the analysis,
mostly a buffer per FFT frame. The analysis is 4% of a render natively, so
reusing those buffers would be worth under 1%.

## In the browsers

[`browsers.txt`](browsers.txt): the set through `farm_render` in Chromium 153
and Firefox 155, headless, through Playwright and `one_browser.sh`, the least
of three wall-clock renders per tree after a warm-up pass (a browser has no
CPU clock for a thread), twice each, alternating:

| | Before folding | After | |
| --- | ---: | ---: | ---: |
| Chromium, a module worker, ms for the set | 5108 | 4322 | -15.4% |
| Firefox, a module worker, ms for the set | 6345 | 5103 | -19.6% |

In a worker, where the app renders (the farm and the engine worker), Firefox
takes about 1.2 times Chromium's time. On a page's main thread it took 4.9 to
6.2 times (1167 to 1482 ms a render against 239), with or without warm-up
passes, three to ten times per tree: headless Firefox's main thread, which the
app never renders on. Under node the folded engine's set is 4623 ms of CPU,
close to Chromium's worker.

## One voice of each module kind

What one voice costs is the number that limits how many can play (#320: up to
ten). `bench_render --kinds` builds a saw voice, then each source in its place,
each processor inserted over it (the module a player's insert makes), the
ladder, and each modulation on the saw's slot, and holds each on C4 for a
second. Natively ([voice-cost-native.txt](voice-cost-native.txt)), CPU ms per
voice-second, as the live voice is built (every knob live) and as a render's
voice is (knobs folded); in wasm ([voice-cost-wasm.txt](voice-cost-wasm.txt)),
`LivePoly` with one voice held, as the worklet runs it, at 48 kHz:

| Kind | Native, live | + on the saw | Native, render | Wasm, live | + on the saw |
| --- | ---: | ---: | ---: | ---: | ---: |
| The saw voice (13 nodes) | 10.5 | | 9.1 | 14.5 | |
| Filter, ladder | 51.6 | 41.1 | 53.1 | 61.7 | 47.1 |
| Filter, SVF lowpass | 15.2 | 4.7 | 12.0 | 20.1 | 5.6 |
| Phaser | 21.0 | 10.6 | 18.1 | 28.0 | 13.4 |
| Gate, Duck, Comp | 18.1 to 21.5 | 7.7 to 11.0 | 14.7 to 15.8 | 25.4 to 27.7 | 10.9 to 13.2 |
| Track | 23.4 | 13.0 | 21.6 | 19.1 | 4.6 |
| Mix, RingMod, Chorus, Reverb, Flanger, EQ, Vocoder | 16.3 to 19.2 | 5.9 to 8.7 | 14.5 to 16.9 | 22.0 to 24.5 | 7.5 to 9.9 |
| A logic modulation (And, Or, Xor, Switch) | 22.5 to 25.6 | 12.1 to 15.1 | 19.3 to 21.3 | 29.1 to 32.5 | 14.6 to 17.9 |
| Any other modulation | 14.6 to 22.9 | 4.2 to 12.4 | 11.3 to 22.9 | 18.5 to 27.3 | 3.9 to 12.7 |
| Any other source or processor | 9.4 to 18.7 | -1.1 to 8.2 | 8.0 to 15.3 | 12.6 to 23.3 | -2.0 to 8.8 |

At 48 kHz a core has 1000 ms a second, so the wasm saw voice is 1.5% of an M3
Max core and a ladder voice 6.2%. On a CPU 4.5 times slower (#288's figure
for the Intel MacBook Air), ten saw voices are about 65% of a core and ten
ladder voices about 2.8 cores, before the page, the browser and the second
slot of an offer: for ten voices, the ladder has to get cheaper (below), and
so does the walk every voice pays for its 13 or more nodes.

The table is per kind, so a patch's cost is roughly the saw voice plus what
each of its modules adds. A modulation is several nodes (the source, a depth
attenuverter and its knob, often an offset), which is why a logic modulation,
with two sources, costs more than most processors.

## Built: a measurement render folds its knobs

`auracle_grammar::compile_for_render` (`CompiledVoice::pin_knobs`), used by
`render_phrase` for the main voice and the chord's: each live knob whose one
cable reaches a control input exactly as a default would (unit gain, no other
cable on the port, not normalled) is removed, and the port's default set to
what the cable delivered, quiver's arithmetic mirrored (`cabled_value`): 87.2%
of the knobs over 2000 prior draws ([census.txt](census.txt)); in the review's
census of 2062 trees, every knob kept was kept because a modulation's cable
shares its port. STEPS' transport (`…:sync!`) is a live handle and no knob,
and is never folded. Folding a knob can move the
other nodes in quiver's execution order, and the order of the modules that
draw from quiver's thread-wide random stream (`noise` and `karplus_strong`;
`Granular` seeds a stream of its own) and the patch's feedback breaks (its
`Schedule`) are part of what it renders. So the fold is first tried on a
patch of stand-ins (the voice's ports, feedback flags and kinds, in the
voice's node and cable order, which is all quiver's scheduler reads), and
made on the voice only if the schedule holds there; otherwise the voice is
left whole: 2 of 2000 prior draws, and none of the presets. The voice is
compiled once either way, so a render, which seeds quiver's stream and then
compiles, draws from it what the live compile does even the day a module's
constructor draws. The live voice (`LivePoly`) keeps every knob live.

- **The same measurement:** φ, the vet report, the face and the onsets digest
  the same on the set and the 62 presets (`bench_render --digest`, natively
  and in wasm). `a_render_compile_plays_the_full_voice_bit_for_bit` plays
  the folded voice against the live one over every preset, 60 prior draws,
  the tree whose fold is refused, and the patches only a player makes (a
  TRACK in each band, an AUDIO IN, a CAPTURE in each mode, hearing a tone),
  the presets and the player's patches also as a chord's follower; no preset
  or draw has a TRACK, an AUDIO IN or a CAPTURE, so an earlier version of
  this test, over the presets alone, proved nothing about them.
  `a_folded_render_is_the_live_render` renders the phrase both ways, where a
  TRACK's dyad is a follower fed by the main voice every frame
  (`CompiledVoice::lead`), on a TRACK in each band, an AUDIO IN and a CAPTURE
  on the audition clip, the refused tree and two presets: the same samples,
  onsets and spans. `a_render_compiles_each_voice_once` counts the compiles
  and the stream's draws.
- **The gain:** a render walks 352 nodes of the set's 606 and 55% of the nodes
  over 2000 prior draws. The set, the least of three rounds of three:

| | Before | After | |
| --- | ---: | ---: | ---: |
| Native, CPU ms for the set ([ab-native-fold.txt](ab-native-fold.txt), load 92 to 145) | 4282 | 3650 | -14.8% |
| Wasm under node, CPU ms for the set ([ab-wasm-fold.txt](ab-wasm-fold.txt), load 76 to 133) | 5596 | 4623 | -17.4% |
| Wasm, a render's mean | 311 ms | 257 ms | |

Per tree it is 5% (First Bass, whose ladder dominates) to 25% (a large prior
draw), more where a patch has more knobs. In the browsers' workers it is
15.4% (Chromium) and 19.6% (Firefox) ([above](#in-the-browsers)).

**`make revalidate`, before and after** (`c8541631`, then `5a6824d5`, each in a
copy of its tree, at niceness 0, load 60 to 220), in
[`revalidate/`](revalidate/), cargo's lines, the run's header and `time`'s
block stripped and nothing else: `phi-stats` (1,200 prior draws rendered and
measured, the composition, φ's ranges and VIF) and `norm-peak` (150) are the
same, line for line, and so is `climb`'s table over 16 seeds (the pool's true
utility per refinement generation, each seed's final mean, max and gain: +2.000
± 0.380, climbed on 14 of 16, on both). The last part, `search-check` (its own
climb over 6 of those seeds, then MH acceptance and the rest), had run 1.5
hours on each side under a load of about 200 without finishing, and was
stopped unfinished when the session wound down; its climb's seeds are the
first six of the 16 that match. `5a6824d5` is the folding before
`0eff8f4f` removed a match guard that never fires (no knob drives no port);
the two build the same voices (`0eff8f4f`'s digests match `c8541631`'s on the
set and the 62 presets, and its fast tier, 651 tests, passed). The review that
followed made the refused fold leave the voice whole instead of compiling it
again, and tried the fold on stand-ins first: the same voices fold, the
digests are the same again (natively and in wasm, on the set and the 62
presets), compiling stays at 0.8 ms over the set's 18 trees, and nothing of
the gain went: the set takes 15.0% less CPU than `c8541631`'s and the same as
the fold as first shipped ([ab-native-review.txt](ab-native-review.txt)).

## Build settings

[`build-settings.txt`](build-settings.txt). The release profile is fat LTO,
one codegen unit, `panic = "abort"`, and `wasm-opt -O3` with exactly the
features rustc emits. Two more, each measured against the same Rust in wasm
under node, alternating, the least of three rounds of three:

| Setting | φ | The set |
| --- | --- | ---: |
| `-C target-feature=+simd128` (and `wasm-opt --enable-simd`) | the same on the 62 presets | -2.2% (per tree -8.5% to +4.1%) |
| `wasm-opt -O4` over the `-O3` engine | the same on the 62 presets | -1.1% |

Both are within what the load moves a run here. `simd128` would also set the
app's floor at Safari 16.4, Chrome 91 and Firefox 89 (an engine built with it
does not instantiate on an older one), for a gain this machine cannot see:
not built, and the maintainer's to decide. The DSP is scalar `f64` through
`dyn` calls, so there is little for LLVM to vectorize; SIMD pays only in hot
loops written for it (quiver's, below).

## The ladder

quiver's `DiodeLadderFilter::tick` (quiver-dsp 0.4.0) runs its four-stage
cascade three times a sample (two fixed-point passes for the resonance
feedback, then the pass that commits the state), with libm's `tanh` on the
input, on every stage's output and on the feedback each pass: 19 `tanh` a
sample. Three candidates and two of their combinations, each a diff against
0.4.0 in [`quiver/`](quiver/),
patched into a scratch copy of this workspace (`[patch.crates-io]`); none
changes quiver or its version here. Natively, against `0eff8f4f`, alternating,
the least of three rounds of three; "a ladder voice" is the live voice of
`--kinds` (a saw through the ladder), CPU ms per voice-second; φ's move is the
largest change of any coordinate on any of the 62 presets, in that
coordinate's spread over them ([phi-moves.txt](quiver/phi-moves.txt)):

| Candidate | φ | The set | First Bass | Ceiling | A ladder voice | In wasm |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| L0: no saturation after the fourth stage, whose value nothing reads | the same, bit for bit | -1.8% | -3.9% | -3.9% | 50.2 to 50.0 | |
| L1: one fixed-point pass, not two (13 `tanh`) | 0.096 of a spread (Fifth Wheel's `centroid_std`); every other move under 0.007, on 11 ladder presets | -5.2% | -22.5% | -18.4% | 50.1 to 39.5 (-21%) | |
| L2: a Padé (7,6) `tanh`, clamped (within 1e-8 of `tanh` below 2, 1e-4 at worst) | at most 2e-10 of a spread | -6.5% | -34.1% | -28.1% | 48.8 to 31.8 (-35%) | the set -3.3%, First Bass -29.6%, Ceiling -27.0%; a ladder voice in `LivePoly` 55.9 to 36.4 (-35%) |
| L2 and L0 | at most 2e-10 of a spread | -5.9% | -32.7% | -29.6% | 30.9 | |
| L1, L2 and L0 | as L1's | -6.1% | -41.6% | -37.2% | 28.2 | |

(The voices of the last two rows were not alternated with a before; the head
read 49.4 in the same hour.)

L2 is nearly all of the gain and moves φ by a rounding: a ladder voice costs
a third less, which is the difference between ten ladder voices fitting and
not (#320). With L0 too it is the candidate to release first. L1 adds about
as much again on the ladder presets, at the price of moving one preset's
`centroid_std` by a tenth of a spread: a sound decision, not a speed one.
`make revalidate` on L1 and on L2, in their scratch workspaces, reached
`phi-stats` and `norm-peak` ([`revalidate/`](revalidate/)) before the session
wound down (their climbs were stopped unfinished). L2's tables are the
baseline's, line for line: its moves are below what they print. L1's differ on
132 lines ([l1-diff.txt](revalidate/l1-diff.txt)): one more of the 1,200 prior
draws is quarantined as silent (1,168 featurized becomes 1,167), and the
per-kind rates and φ's ranges move in their last printed digit (the filter's
quarantine rate 5.7% to 5.9%). L1 changes what the gate lets through, which is
a sound decision; L2 does not, at the precision the tables print.

## quiver

What else is quiver's to change, measured the same way:

- **`PortValues` by a table, not a scan** ([diff](quiver/portvalues-slot-table.diff)):
  the same samples; the live voices of `--kinds` 9% cheaper natively (a saw
  voice 22%), but renders 1.3% slower natively and 9.5% slower in wasm, and
  a saw voice in `LivePoly` 9% slower. Not a win, and so the walk's cost is
  not in finding a slot: it is the walk's shape (a `PortValues` per node, an
  `Option<f64>` per port, a `dyn` call per node).
- **The walk's shape** (not prototyped; the largest that is left): the walk is
  41 to 55% of a render, and a voice's 13 to 90 nodes each pay it every
  sample. Ports as plain `&[f64]` slices a module reads by index (an API
  change for every module), a node's whole block at a time where the graph
  has no feedback (for a chain of nodes with no loop, `tick` over 128 samples
  instead of one), and `dyn` dispatch replaced by an enum of quiver's own
  modules are the candidates, each bit-identical by construction where the
  per-sample arithmetic is kept.

## What is left, ranked

| | Change | Where | φ | Gain, measured or estimated |
| --- | --- | --- | --- | --- |
| 1 | The ladder's Padé `tanh` and no dead saturation (L2 and L0) | quiver | moves by at most 2e-10 of a spread | A ladder voice -35%, natively and in wasm; ladder presets' renders -30%; the set -6% |
| 2 | `norm_sqr().sqrt()` for `norm()` in φ's spectral frames ([diff](analysis-norm-sqr.diff)) | `auracle-features/src/audio.rs` | moves by at most 1.1e-14 of a spread, on 43 presets | The set -9.2% in wasm ([run](ab-wasm-norm-sqr.txt)); natively the same (+0.2%) |
| 3 | The walk's shape: ports as slices, blocks where there is no feedback, enum dispatch | quiver | the same where the arithmetic is | Up to the walk's 41 to 55% of every render and every live voice; not prototyped |
| 4 | One fixed-point pass in the ladder (L1) | quiver | 0.1 of a spread on one preset; one more prior draw of 1,200 quarantined as silent | A further -15 to -20% on ladder presets |
| 5 | `simd128` | the build | the same | -2.2% in wasm, within the noise; sets a browser floor |
| 6 | Reusing the analysis's FFT buffers | `auracle-features` | the same | Under 1% |
| 7 | A shorter or lower-rate audition phrase for measuring | `auracle-features` | moves φ everywhere | In proportion to the samples (a render is its ticks): a phrase at 22.05 kHz would be about half; a decision on what the model can hear |

Not measured: wasm threads (the app has no COOP and COEP headers, and the farm
already renders on several workers), and `f32` in the DSP (quiver's modules
are `f64` throughout; every module would change and φ would move).
