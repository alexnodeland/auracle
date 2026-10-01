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
| `examples/pool_loudness.rs` | Measures what a fresh bank sounds like, level-wise |
| `examples/selector_makeup.rs` | Measures the level a selector change (a wave, a filter mode) would play at if its tree reached the voices before its render, against what cheaper renders would estimate, over every preset's selector changes: why selectors wait for theirs |
| `examples/preset_wirings.rs` | Measures PERFORM's wiring of every preset through this surface and writes `apps/web/perform-wirings.json` (`make perform-wirings`) |
| `shipped.rs` | What that file was measured from: fingerprints of the presets and named inputs, and the standard engine (`boot`) a sample of it is re-measured on. `tests/shipped_wirings.rs` fails when a preset, an input or the measurement's arithmetic changes without regenerating it (native only) |

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
- **Every new binding needs its caller.** Add the method, call it from
  `worker.js`, and let `tests/web/smoke.spec.js` prove the binary exports it.

## Tests

`cargo test -p auracle-wasm --profile test-fast` (native), `make wasm-check`
(the wasm32 build), then `make wasm` and the browser specs.
