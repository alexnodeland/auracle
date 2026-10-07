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
| `crates/auracle-features/examples/bench_render.rs` | The native bench (`make bench-render`): the set in ms per render; `--stages`, `--nodes`, `--census=N`, `--kinds`, `--digest`, `--loop=N` (its header says each) |
| `crates/auracle-features/examples/bench_render.json` | The set: PERFORM's six presets (the ones `auracle-session`'s PERFORM tests play) and the first twelve vetted draws of the prior from seed 20261006, frozen as trees |
| `crates/auracle-wasm/examples/bench_render.mjs` | The wasm bench: the same trees through `farm_render` under node; two packages side by side for a before and after |
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

# the native profile (macOS)
CARGO_PROFILE_RELEASE_DEBUG=line-tables-only cargo build --release -p auracle-features --example bench_render
xctrace record --template 'Time Profiler' --output r.trace --launch -- target/release/examples/bench_render --loop=2
xctrace export --input r.trace --xpath '/trace-toc/run[@number="1"]/data/table[@schema="time-profile"]' > r.xml
python3 docs/notes/render-cost-2026-10/fold_xctrace.py r.xml
```

Run the bench without `nice`: it measures CPU time, but a niced process on a
busy machine lands on efficiency cores more often, and their time is not a
performance core's.

## In short

- **A render is its DSP: 94 to 96% of the farm's job** is ticking the patch
  through the phrase. φ's analysis is 3%, loudness 1%, the face 0.8%, vetting
  0.2%; compiling the tree (and the chord's second voice) is 0.03%, and the
  JSON the farm parses and writes 0.003% ([stages](stages-before.txt)).
- **More than half of the DSP is not the modules' DSP.** quiver walks its
  graph every sample: for each node it gathers the inputs into a `PortValues`,
  calls the module through `dyn GraphModule`, and scatters the outputs, and
  that walk (`Patch::tick`, with what it inlines) is 55% of a render, against
  39% in the modules' own `tick`s ([profile](native-profile.txt)). Inside it,
  the biggest single cost is `PortValues`' linear scan for a port's slot
  (17% of the whole render), then the scatter (8%) and walking the input
  plans (6%) ([profile with line tables](native-profile-lines.txt)).
- **About half of a patch's nodes are knobs** (354 of 606 on the set): each
  live knob is an `ExternalInput` node the walk visits every sample to read a
  value nothing changes during a measurement. **Built here:** a measurement
  render folds each knob into the port it drives, so the walk visits 55% of
  the nodes it did, with the same samples, bit for bit. A render takes 14.8%
  less CPU natively and 17.4% less in wasm (below).
- **The ladder is the one module that matters most.** Natively it is 8% of the
  set's time on its own, the most of any module, from only two ladders in 606
  nodes; per voice it adds 41 ms of CPU per voice-second to a saw voice of
  10.5 natively, and 47 ms to 14.5 in wasm: a ladder voice costs about four
  times a voice without one ([one voice of each kind](#one-voice-of-each-module-kind)).

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
code: it is upstream's to change (below).

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
what the cable delivered, quiver's arithmetic mirrored (`cabled_value`). If
that moves the order of the modules that draw from quiver's thread-wide random
stream, or the patch's feedback breaks (its `Schedule`), the voice is compiled
again without folding: 2 of 2000 prior draws ([census.txt](census.txt)). The
live voice (`LivePoly`) keeps every knob live.

- **The same measurement:** φ, the vet report, the face and the onsets digest
  the same on the set and all 63 presets (`bench_render --digest`), and
  `a_render_compile_plays_the_full_voice_bit_for_bit` holds it over every
  preset and 60 prior draws, as a main voice and as a follower.
- **The gain:** a render walks 352 nodes of the set's 606 and 55% of the nodes
  over 2000 prior draws. The set, the least of three rounds of three:

| | Before | After | |
| --- | ---: | ---: | ---: |
| Native, CPU ms for the set ([ab-native-fold.txt](ab-native-fold.txt), load 92 to 145) | 4282 | 3650 | -14.8% |
| Wasm under node, CPU ms for the set ([ab-wasm-fold.txt](ab-wasm-fold.txt), load 76 to 133) | 5596 | 4623 | -17.4% |
| Wasm, a render's mean | 311 ms | 257 ms | |

Per tree it is 5% (First Bass, whose ladder dominates) to 25% (a large prior
draw), more where a patch has more knobs.

## What is left

To come in this note, from the measurements still running: the wasm profile's
split; the browsers (Chromium and Firefox); build settings (`simd128`,
`wasm-opt`'s passes); quiver's walk (`PortValues` by index); the ladder's
candidates (one fewer fixed-point pass, a cheaper `tanh`) with `make
revalidate` on both sides.
