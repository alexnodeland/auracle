# The engine crates

Five crates, one direction of dependency:

```
auracle-grammar ─► auracle-features ─► auracle-taste ─► auracle-session ─► auracle-wasm
        └──────────────────┴────────────────────────────────┘ (session uses all three)
```

The grammar says what a patch can be and compiles it to a quiver graph. The
features crate renders a patch on one fixed phrase and measures it (φ). The
taste crate turns observations over φ into a posterior. The session crate runs
the engine the app drives. The wasm crate binds it for the browser. The full
walk-through is [`docs/architecture/system.md`](../docs/architecture/system.md);
each crate's own `AGENTS.md` has its rules.

## Rules for every crate

- **Tests run optimized**: `cargo test -p <crate> --profile test-fast`. Debug
  builds are about 20 times slower on audio and overflow the stack in the
  grammar suite. `make test` runs the workspace.
- **Clippy is `-D warnings`** and `cargo fmt` is enforced
  (`make fmt-check lint`).
- **Prefer gate tests to mocks.** Property tests over random trees and
  synthetic users are the house style: the closed-loop test fits a real
  posterior, the edit gate applies every op at every node. Extend a gate
  before you assert an implementation detail.
- **The address scheme is the spine.** `node/0#cut`, `amp#attack`,
  `node/0/m#rate` are shared by knobs, edits, locks, live handles and MH
  proposals. Never invent a second addressing.
- **Serialize trees from their types.** A `PatchTree` goes out through its
  own `Serialize`, in declaration order. Never through `serde_json::json!`,
  which sorts keys (this workspace has no `preserve_order`), so the same patch
  would read as two texts ([ADR-002](../docs/decisions/002-trees-serialize-in-declaration-order.md)).
- **One random stream per consumer.** Pass the caller's `Rng` in; never share
  one generator between fills, duels, fits, evolution and PERFORM
  ([ADR-001](../docs/decisions/001-one-random-stream-per-consumer.md)).
- **Numbers the books quote are named constants.** If you change a default,
  grep `www/reference` and `www/docs` for its name and fix the text.
- **A Rust change the app uses needs `make wasm`** before any browser test or
  film rehearsal means anything.

## Diagnostics worth knowing

`make climb`, `make search-check`, `make islands`, `make phi-stats`,
`make norm-peak`, `make fit-bench`, `make closed-loop`: each is a measurement
with a table, documented in the `Makefile`. `make revalidate` runs the ones a
φ change owes.
