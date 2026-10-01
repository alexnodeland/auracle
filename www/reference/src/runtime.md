# The web runtime

<p class="lede">Four thread kinds, one wasm binary, and a set of constraints that shaped
the architecture more than any design preference did.</p>

<!-- film:dsp -->
<figure class="film" id="film-dsp">
<video controls preload="none" playsinline poster="../assets/film/dsp.jpg">
<source src="../assets/film/dsp.mp4" type="video/mp4">
<track kind="captions" src="../assets/film/dsp.vtt" srclang="en" label="English" default>
</video>
<figcaption>For audio engineers: the patch graph, the modules and their types, compilation, the audition phrase, loudness, vetting, the features, and the live voices. <span class="film-len">2:49</span> · <a href="../docs/films.html#film-dsp">chapters and transcript</a></figcaption>
</figure>
<!-- /film:dsp -->

## The threads

| Thread | Holds | Runs |
|---|---|---|
| **Main** | UI, Web Audio graph | `main.js`, never in the audio or render data path |
| **Engine worker** | `WasmEngine` (all of `auracle-session`) | `worker.js`: pool fill, fits, refinement, workbench |
| **Render workers** ×N | A wasm instance, nothing else | `farm.js`: stateless `(term, phrase) → φ` at boot, `(context, job) → child` for a generation's walks and ⚡ |
| **AudioWorklet** | `LivePoly` | The instrument. Real-time |

Main compiles the wasm binary **once**, spawns the render workers, and
transfers one `MessagePort` per worker *into* the engine worker. After that
main is out of the data path, and no audition buffer ever touches the UI
thread.

No nested workers (Safari shipped those only in 16.4), no `SharedArrayBuffer`,
no COOP/COEP headers, no build step and no server change. Those constraints are
why the topology is a star around the engine worker rather than a tree.

## The AudioWorklet's hostile environment

An AudioWorklet has **no `fetch`, no `TextDecoder`, no `TextEncoder`**.
wasm-bindgen's glue needs all three.

So the worklet is assembled as a **blob** with the glue inlined behind a
polyfill, and raw wasm **bytes** are transferred into it for a synchronous
in-worklet compile.

The bytes specifically, not the module: a transferred `WebAssembly.Module`
arrives as a silent `messageerror` in some engines. That is the kind of failure
that costs a day: no exception, no log, just a worklet that never initializes.

Also, **no wall clock on the audio thread.** `LivePoly` uses a deterministic
xorshift for the random arpeggiator pattern; anything `Date.now()`-shaped
belongs on the main thread.

`LivePoly` holds $N$ compiled copies of the patch, via
[the same `compile()` path evolution uses](./genome/compilation.md#one-compiler-two-callers)
and with the limiter included, plus oldest-note stealing and silent-tail voice
parking. Every workbench edit re-patches the live instrument.

## The stack size

wasm32's default stack is **1 MB**, and the patch compiler is recursive: every
level of `Compiler::build` constructs quiver modules **by value** before moving
them into the patch, and some carry large inline buffers. A `PitchShifter`
holds `[f64; 4800]` (38 KB), a `Granular` more.

A dozen-module patch overflows it, and it does so as **`memory access out of
bounds`**, nowhere near the flag that caused it. It then *poisons the engine*:
the panic unwinds out of a `&mut self` binding, and every later call fails with
wasm-bindgen's "recursive use of an object" instead of the real fault.

The fix is 8 MB, the same order as the native main-thread stack the test suite
runs on, which is why `make check` never saw this:

```make
WASM_STACK := 8388608
WASM_RUSTFLAGS := RUSTFLAGS="-C link-arg=-zstack-size=$(WASM_STACK)"
```

It lives in the **Makefile**, and every build path goes through it: CI,
releases, the site build. Invoking `wasm-pack` directly ships a 1 MB stack and
reintroduces the bug, which is why the CI workflows build wasm via `make wasm`
rather than calling the tool.

## Progressive boot

Boot costs ~40 renders. The bank is standardized and posted as **`playable` at
8 patches** (`PLAYABLE_AT`, in `worker.js`), which is when the first pair is
dealt. The remaining ~32 fill in
chunks that **yield to the message queue between batches**, so playing during
the fill is real rather than cosmetic.

`filled` still fires, and everything downstream of it still runs.
`fill_progress` carries `stage`/`stages`, so a restore and a top-up fill each
own a labeled share of one bar.

## The render farm

$$N = \mathrm{clamp}(\text{hardwareConcurrency} - 2,\; 0,\; 6)$$

capped at **2** when `deviceMemory ≤ 4`, and a width of 1 is taken as 0:
below two workers the serial path is as fast (`farmWidth`, in `main.js`).
Override with `?farm=k` or `localStorage["auracle-renderers"]`, from 0 to 8;
`0` is the serial path exactly.

### The pool is identical at every width, including 0

This is a **structural** guarantee, and two properties carry it:

**Draws are indexed.** Draw $i$ is the prior sampled under
`StdRng::seed_from_u64(splitmix64(fill_seed, i))`, so a term is a **pure
function of $(\text{fill\_seed}, i)$**. Not of arrival order, not of which
worker got it.

**Results are absorbed in index order.** The pool at index $i$ depends only on
indices $< i$.

Together those mean a lost or timed-out job is re-issued **by index** with no
retained state, and speculative work past the stop point is simply discarded.

Gated natively by `farm_width_does_not_change_the_pool` and
`farm_absorption_reproduces_the_serial_pool`, on `(id, tree, raw φ)`.

**Every degradation path falls back to the serial fill of the same draw
stream**: a worker that never initializes, one killed mid-boot, a build-stamp
mismatch, and a browser that cannot structured-clone a `WebAssembly.Module`. So
parallelism costs time and never content.

A draw retired after two attempts (`MAX_TRIES`, in `worker.js`) is recorded,
not hidden, but in the app's own log (`window.__aurLog`) rather than as a
console warning. It is a designed degradation, and the console gate holds a
clean boot to zero warnings.

### Walks on the farm

A generation is `refine_seeds` walks, and each is a pure function of the
generation's shared context and its own job
([refinement](./search/refinement.md)). So after boot the farm comes back for
them: the engine worker asks main for a crew when a generation or ⚡ evolve
from this starts, main spawns it, and the crew is reaped after a minute with
nothing to walk. Main compiles the wasm module once and keeps it, so a crew is
an instantiation per worker, not a compile: where boot had a farm (four cores
or more) the module was compiled then, and on a two- or three-core machine,
where boot fills serially, the first crew compiles it. A browser that cannot
hand a compiled module to a worker has each worker compile its own. A crew's
width is boot's rule with a floor of one worker wherever there are two cores
(`walkWidth`, in `main.js`), because even one worker takes the walk off the
engine worker, which then answers everything else.

The context (the tilted prior, the posterior's draws, the standardizer, the
phrase: about 2.2 MB of JSON) goes to each worker once per generation, as one
string, and `farm_walk` keeps its parse keyed by that exact text. Results are
absorbed **in job order**, one per turn, whatever order they finished in, so
the pool is the serial path's at every width; natively
`farm_walks_breed_the_serial_generation`. A walk a worker cannot run, or a
crew that never comes up, is walked in the engine worker from the engine's own
copy of the same job.

⚡ evolve from this is one job over the same path. It draws its job from the
`refine` stream **before** it waits for a crew, so a generation asked for
during a cold crew's handshake cannot draw first and change the child: a
seeded session breeds the same ⚡ child however warm the crew was. With no
crew the engine walks that very job (`refine_from_walk`). A generation and ⚡
take turns in the engine worker, and a refit waits for both, so a ⚡ child is never absorbed into a generation
at whatever job count its walk finished on. The engine keeps a ⚡ seed out of
every eviction until its walk is absorbed or stopped.

Replacement waits for the end: children join the pool as they are absorbed,
and `refine_finish` retires the weakest unpinned members once, when the last
job lands or the player stops the generation. Weakest is judged under the
posterior the generation opened with, as admission is, so picks made while it
breeds (they reweight the posterior for the next pair) do not change which
children are kept.

## Worker replies are load-bearing

Every workbench edit message **must** get a reply (`bench` or `edit_rejected`),
or the main thread's in-flight queue deadlocks.

`bench_missing` is the sharpest case. The worker has always sent it when
`edit_begin` fails, and because nothing handled it, the optimistic "it's on the
workbench" toast stayed on screen while the bench showed the previous patch. A
protocol whose failure message has no listener is a protocol with a silent
failure mode.

The general rule: **a control that cannot act says so.** The recurring bug is
silence: a ▶ with no handler, an `if (x == null) return`, a worker failure
nothing listened for. Prefer a disabled control with a reason in its title, or
a note; never a handler that returns.

## Caching, in development

The dev server sends `Cache-Control: no-store` **and** the app version-stamps
its worker and wasm URLs. Both are needed: a browser's heuristic cache ignores
late `no-store` on an already-cached module worker.

Getting this wrong gives a rebuild that appears to change nothing, or an
engine and a UI from two different commits.

## Verification beyond `make check`

UI changes are verified live in a browser (Playwright) with **numeric audio
assertions** (an `AnalyserNode` RMS, boundary-sample checks around patch swaps)
plus a **zero-console-error** requirement.

Debug hooks: `window.__aur` and `window.__aurLog`. (`window.__ric` is kept as
an alias for notes written before the rename.)

That combination is the only thing that can catch a class of bug `make check`
cannot see: the engine is correct, the UI is correct, and the message between
them is wrong.
