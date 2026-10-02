# auracle-wasm: the engine in the browser

`WasmEngine` runs in the app's Web Worker; `LivePoly` runs in the AudioWorklet.
Rules shared by all crates are in [`../AGENTS.md`](../AGENTS.md). The JS side is
[`apps/web/AGENTS.md`](../../apps/web/AGENTS.md).

## Where things are

| File | Holds |
| --- | --- |
| `lib.rs` | `WasmEngine`: every method `worker.js` calls; `Streams` (one RNG per consumer); `TreeReply`; the farm's stateless exports (`farm_render`, `farm_walk`) |
| `live.rs` | `LivePoly`: N compiled copies of the patch played from the render thread; the arpeggiator |
| `level.rs` | One level policy for everything the player hears (live makeup) |
| `examples/score.rs` | Renders a film score (`www/video/sound/*.json`) with the engine's own voices |
| `examples/pick_belief.rs` | Measures what each pick's reply costs: the reweight, `belief`, and what a refit posts (ranked list, map, lenses), per number of lenses, at rest and with a generation open (`breed`) |
| `examples/pick_belief.mjs` | The same loop against the built package under node, for the wasm figures (`make wasm` first) |
| `examples/guess_cost.mjs` | What the model's guess costs in wasm under node: the bindings the worker calls (`guess_plan`, `memo_render`, `guess_rank`) after both warm starts, at the floor and in full (`make wasm` first); native twin `auracle-session`'s `guess_cost` |
| `examples/cable_cost.mjs` | What the cable probe (`cable_levels`) costs in wasm under node on every preset, beside a render with φ (`make wasm` first); native twin `auracle-features`'s `cable_probe` |
| `examples/suggest_cost.mjs` | What one rendered module suggestion costs in wasm: `preview_op` over the candidates `suggest_census --ops` lists, in CPU time under node (`make wasm` first; `docs/notes/suggest-2026-10/`) |
| `examples/pool_loudness.rs` | Measures what a fresh bank sounds like, level-wise |
| `examples/selector_makeup.rs` | Measures the level a selector change (a wave, a filter mode) would play at if its tree reached the voices before its render, against what cheaper renders would estimate, over every preset's selector changes: why selectors wait for theirs |
| `examples/preset_wirings.rs` | Measures PERFORM's wiring of every preset through this surface and writes `apps/web/perform-wirings.json` (`make perform-wirings`) |
| `examples/palette_census.rs` | The palette's eighteen directions (Plan-005 task 9c): their definitions and cosines, how often each reaches the presets alone and beside the six, and what measuring eighteen costs against six, on the shipped engine; `--prototype` adds the prototype's blends |
| `examples/palette_cost.mjs` | The same measurement's cost in wasm under node, six against eighteen (`make wasm` first) |
| `shipped.rs` | What that file was measured from: fingerprints of the presets and named inputs, and the standard engine (`boot`) a sample of it is re-measured on, with the session engine inside it (`session`) for the measurement examples. `tests/shipped_wirings.rs` fails when a preset, an input or the measurement's arithmetic changes without regenerating it (native only). Its `boot_probe` is also in the page's wasm (about 18 KB raw, 5 KB brotli): a test-only export that `tests/web/boot_agrees.spec.js` runs to compare the browser's pool with `tests/boot_probe.json` |

## Rules

- **Ids crossing the boundary are `u32`.** wasm-bindgen turns `u64` into
  `BigInt`, and every JS arithmetic site would have to know.
- **Structures cross as JSON, audio as `Float32Array`.** A tree in a reply is
  serialized from a struct (`TreeReply`), never with `json!`
  ([ADR-002](../../docs/decisions/002-trees-serialize-in-declaration-order.md)).
- **The audio thread allocates nothing per quantum and reads no clock.**
  `LivePoly` uses a deterministic xorshift. Chaos tests catch panics, but
  review for these properties explicitly.
- **A panic poisons the engine.** It unwinds out of a `&mut self` binding and
  every later call fails with "recursive use of an object". The worker must
  report it, not retry
  ([runbook](../../docs/runbooks/wasm-engine-poisoned.md)).
- **The wasm stack is 8 MB** (`WASM_STACK` in the `Makefile`). The compiler
  recurses with large modules by value, and the default 1 MB overflows as
  "memory access out of bounds". Build through `make wasm`, never wasm-pack
  directly.
- **An edit's refusal is copy.** `edit_structure_apply` and
  `edit_set_tree_apply` return the reason PATCH's toast quotes, so
  `make dev-check` reads `lib.rs`'s strings against `www/brand/voice.md`
  ([`../AGENTS.md`](../AGENTS.md)). A JSON shape or a code there that trips
  the check gets the comment `// voice: name` on the line the literal starts
  on (as `edit_utility`'s shape does); the comment exempts only literals that
  start on its line.
- **Every new binding needs its caller.** Add the method, call it from
  `worker.js`, and let `tests/web/smoke.spec.js` prove the binary exports it.
  The one exception is `shipped::boot_probe`, a test-only export whose only
  caller is `tests/web/boot_agrees.spec.js`; it costs the page about 18 KB raw.
  Do not add another without the same reason.

## Tests

`cargo test -p auracle-wasm --profile test-fast` (native), `make wasm-check`
(the wasm32 build), then `make wasm` and the browser specs.
