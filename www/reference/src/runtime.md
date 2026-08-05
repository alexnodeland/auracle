# The web runtime

<p class="lede">Three thread kinds, one wasm binary, and a set of constraints that shaped
the architecture more than any design preference did.</p>

## The threads

| Thread | Holds | Runs |
|---|---|---|
| **Main** | UI, Web Audio graph | `main.js` — never in the audio or render data path |
| **Engine worker** | `WasmEngine` (all of `auracle-session`) | `worker.js` — pool fill, fits, refinement, workbench |
| **Render workers** ×N | A wasm instance, nothing else | `farm.js` — stateless `(term, phrase) → φ` |
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
8 patches**, which is when the first duel is dealt. The remaining ~32 fill in
chunks that **yield to the message queue between batches**, so playing during
the fill is real rather than cosmetic.

`filled` still fires, and everything downstream of it still runs.
`fill_progress` carries `stage`/`stages`, so a restore and a top-up fill each
own a labelled share of one bar.

## The render farm

$$N = \mathrm{clamp}(\text{hardwareConcurrency} - 2,\; 0,\; 6)$$

capped at **2** when `deviceMemory ≤ 4`. Override with `?farm=k` or
`localStorage["auracle-renderers"]`; `0` is the serial path exactly.

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
mismatch, a browser that cannot structured-clone a `WebAssembly.Module`. So
parallelism costs time and never content.

The one loud exception: a job retired after two attempts logs a console
warning. That degradation is meant to be visible.

## Worker replies are load-bearing

Every workbench edit message **must** get a reply — `bench` or `edit_rejected`
— or the main thread's in-flight queue deadlocks.

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

Get this wrong and you get a rebuild that appears to change nothing, or an
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
