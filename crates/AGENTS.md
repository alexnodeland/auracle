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
- **Strings that reach the screen are copy, and they are checked.** Preset
  names and descriptions, the rack's labels, PERFORM's control words, the
  bank's sound names and the reasons an edit is refused follow
  [`www/brand/voice.md`](../www/brand/voice.md). `make dev-check` reads every
  string literal in the files they come from, listed as the `engine` surface
  in `www/checkwords.py`; it skips comments and what builds only for tests
  (`#[cfg(test)]`, `#[test]`, a `cfg` that implies `test`). A new file whose
  strings reach the screen joins that list. A literal there that holds a
  name, a code or a JSON key and trips the check is exempted by the comment
  `// voice: name` on the line it starts on; a literal that runs over several
  lines can't be marked, so keep such a value on one line.
- **A Rust change the app uses needs `make wasm`** before any browser test or
  film rehearsal means anything.
- **Every line you add or change is covered** by a fast-tier test that checks
  what it does, and no crate falls below its coverage floor
  ([Coverage](#coverage)). `make coverage` says so before CI does.

## Coverage

The fast tier's tests are measured with cargo-llvm-cov, and the *Coverage*
jobs in the required `CI` check hold two things (`make coverage` runs the
same locally; how CI runs it is in `docs/architecture/testing.md`
[§ Coverage](../docs/architecture/testing.md#coverage)):

- **The floors.** Each crate's line and function coverage is at least its
  floor in `crates/coverage-baseline.json`. A floor only rises. The PR that
  raises a crate's coverage runs `make coverage-floors` and commits the
  file, and a floor lowered by hand fails against the merge base. Regions
  are shown, not gated.
- **The changed lines.** Every line a change adds or changes in `crates/` is
  covered, against the merge base with `main`.

**Reading it.** `make coverage`, and the run's summary in CI, print a row
per crate (lines, functions and regions, each with what it misses, and the
floors) and every uncovered changed line with its text (in CI, a link to
it). The HTML report, `target/llvm-cov/html/index.html` (in CI the
`coverage-report` artifact), shows each file with the lines no test ran in
red. A line also counts as uncovered when a function that starts on it
never ran, a closure most often, even though the rest of the line did: the
crate's numbers count that function's line as missed too.

**A covering test asserts behavior.** A test that runs a line and checks
nothing about what it did counts as coverage and proves nothing; one
written only to touch a line fails review (the test audit's standard,
#178). Cover a line at the lowest level that can show what it does, and
assert that. A line no test can reach is a design question first: remove
it, or let a type rule it out.

**What is measured.** Native code, from the fast tier alone. The slow tier
checks outcomes; every line it runs is also run by a fast test.

- Code that builds only for `wasm32`, and the examples, are not built
  natively, so they are not counted.
- A file under a `tests/` directory, or named `tests.rs` (or ending
  `_tests.rs`), is left out by cargo-llvm-cov's default rule. An inline
  `#[cfg(test)] mod tests { … }` is counted. So a crate's tests belong in a
  file of their own (`#[cfg(test)] mod tests;` and a `tests.rs`, as
  `auracle-session/src/guess/tests.rs` does), and a slow-tier test must be
  there: the fast tier never runs its body, so inline it counts as
  uncovered for good. Test code is nearly all covered, so moving a module
  out lowers the crate's percentage: move it in the PR that also covers
  what it leaves uncovered, or that PR's floor check fails.

**No exclusions.** The gate runs on the pinned stable compiler, with no
`#[coverage(off)]`, which is nightly only. Decided for #181 on Oct 5, 2026,
measured at `c92bb12`:

- The 2,699 lines no fast test ran are coverable or removable. About 930
  are test code, most of it the bodies of slow-tier tests, which move to
  `tests.rs` files as above. The rest are functions no fast test calls
  (`genome.rs`'s distances, the wasm bindings only the browser calls, the
  arpeggiator and transport in `live.rs`), PERFORM's paths that only slow
  tests reach, and error and early-return branches. About a dozen are a
  `panic!`, an `unreachable!` or an `expect`.
- The same run on a nightly of the same release train measured the same
  lines, functions and regions in every file, covered and not. A nightly
  would buy `coverage(off)` alone, for a second compiler to install, cache
  and bump, and a measurement made by a compiler the tests don't otherwise
  run on.

So a `#[cfg_attr(coverage_nightly, coverage(off))]` would do nothing here;
don't add one. If a line ever truly can't be covered or removed, that is a
new decision: the nightly, the reason on the line above the attribute, and
a count of them that only goes down (#181 § 2).

## Diagnostics worth knowing

`make climb`, `make search-check`, `make islands`, `make phi-stats`,
`make norm-peak`, `make fit-bench`, `make closed-loop`, `make walk-payload`:
each is a measurement with a table, documented in the `Makefile`.
`make revalidate` runs the ones a φ change owes.
