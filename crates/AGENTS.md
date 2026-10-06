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
- **No mutant of the code you change survives**, or its survival is
  answered ([Mutation testing](#mutation-testing)). `make mutants DIFF=1`
  says so before review.

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
red.

A closure that never ran, on a line whose other code did, is counted three
ways. The HTML report (and its lcov) shows the line covered, with a `^0`
under the closure. The crate's line percentage counts a line once for each
function on it, so this one once covered and once missed, and its function
percentage counts the closure as missed. The changed-line check names the
line as uncovered: stricter than the HTML report by design, since a
closure no test ran is code no test checked. (Measured on a one-function
crate: lcov 8 lines, all covered; the summary 9 lines, 8 covered; 2 of 3
functions. At `c92bb12`, 82 lines read as covered in lcov while a closure
on them never ran.)

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
  `_tests.rs` or `-tests.rs`), is left out by cargo-llvm-cov's default rule. An inline
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
don't add one.

**A poisoned lock's recovery is tested, not excluded.** A
`lock().unwrap_or_else(|e| e.into_inner())` runs its closure only after
another thread panicked while holding the lock, and the closure counts
against the crate's functions and lines. Decided for #181 by the first crate
PR that brought one to 100% (auracle-features):

- A lock's poisoned-recovery closure is covered by a test that poisons that
  lock on purpose and checks that the next caller still gets a good value.
  Where the lock is a static reachable from its module's tests
  (`auracle-features/src/clip.rs`'s `REFERENCES`, by
  `a_poisoned_reference_list_still_serves_the_reference`), the test poisons
  it. Otherwise the crate routes its locks through one helper that a single
  test poisons. No exclusion.
- A poisoned static stays poisoned for the rest of a `cargo test` process.
  Every caller must recover through `into_inner`, and no test may assert the
  lock is unpoisoned.

The other sites are `auracle-session/src/map.rs` and `engine.rs`, and
`auracle-wasm/src/shipped.rs`; each crate's coverage PR applies the rule.

**An error no tree reaches records its fault, and the build returns it.**
A step that only a mistake in the engine's own code can make fail (a
compiler's cable to a port it named itself, a pin that cannot take) keeps
its error, the first one, and the build returns it when it ends, with one
test that makes the step fail and checks what is recorded and returned.
Never a panic (an `expect`, an `unwrap`) for such a path in code the wasm
engine runs: a panic there aborts the engine. Decided for #181 by
auracle-grammar's coverage PR (`Compiler::record` and `take_fault` in
`compile.rs`).

## Mutation testing

Coverage says a test ran a line; mutation testing says whether a test would
notice if the line were wrong. [cargo-mutants](https://mutants.rs) changes
the code one small way at a time (a function returns a default value, a `<`
becomes `<=`, a `+` becomes `-`, a `!` goes), builds the crate, and runs
its fast tier. A mutant some test fails on is *caught*. A mutant every test
passes on *survives*: the tests run that code and don't check what it does.
A mutant that doesn't compile is *unviable*, and one whose tests run past
five times the unmutated run's test time (20 s at least) is stopped as a
*timeout* (a hang, such as a changed loop bound, or tests slowed past the
limit); neither is a survivor.

**What runs.** `.cargo/mutants.toml` says, each choice with its reason: the
`test-fast` profile and nextest; a mutant is tested by its own crate's tests
only, so a survivor is code its crate's tests don't check; the fast tier,
the slow tests never (the Makefile passes `SEARCH_FLOOR` and `SLOW_TESTS`);
no examples, which are neither mutated nor built; and the hand-written
`Debug` impls left out. Judging each crate by its own tests is stricter
than coverage, which is measured over the whole workspace's run: a branch
of grammar's that only a session test reaches is covered, and its mutants
survive.

**Running it.** cargo-mutants is pinned in the `Makefile`
(`MUTANTS_VERSION`), and `make setup` installs it.

- `make mutants DIFF=1`: the mutants in the code changed since `origin/main`
  (`BASE=` for another), uncommitted changes included (a new file once it
  is `git add`ed). Run it before review on any Rust change.
- `make mutants CRATE=auracle-taste`: one crate. With `DIFF=1` too, that
  crate's changed code.
- `make mutants`: the whole workspace, 8,320 mutants: a day or two on a
  16-core Mac, estimated. CI's weekly run takes it a part at a time.
- Two mutants at a time (`MUTANTS_JOBS`), each in a copy of the tree whose
  first build is from clean, at `nice -n 10`. It holds a machine for long:
  on a shared one, `nice -n 19 make mutants …`.
- What it found is in `mutants.out/`: `missed.txt` lists the survivors,
  `timeout.txt` the timeouts, `log/` holds each mutant's change, build and
  test output. `python3 scripts/mutants_report.py mutants.out` prints them
  per crate. `make mutants` succeeds only when every mutant was caught or
  unviable. Any other end fails it with make's own exit code, 2, whatever
  the cause; the line before make's error gives cargo-mutants' code (2: a
  survivor; 3: a timeout, and maybe survivors too; 4: the unmutated tests
  failed), and the report says what it found.

**Reading a survivor.** Each names a place, a function and a change:
`crates/auracle-taste/src/model.rs:326:16: replace + with - in sigmoid`
(at `cf61f48`) says that with `1.0 + (-x).exp()` made `1.0 - (-x).exp()`,
every test of `auracle-taste` still passed. It is one of three things:

1. **A test that checks too little.** The usual case: a test runs the code
   and asserts something the change keeps (a loose bound, a property that
   holds either way), or no test calls it and the line is uncovered too.
   Kill it with a test that asserts what the code does, at the lowest level
   that can show it ([Coverage](#coverage)'s standard).
2. **A change no behavior can show** (an equivalent mutant): a `<` that
   becomes `<=` where the two sides are never equal, a value every caller
   overwrites. Say why in the PR. If it is permanent, exclude it in
   `.cargo/mutants.toml`'s `exclude_re`, by file, function and change (not
   by line, which moves), with the reason above it. That is rare, and
   review sees each one.
3. **Code that doesn't matter.** Remove it.

**Review treats a survivor in changed code as a finding**, as it does an
uncovered changed line: killed, or answered with why it can't be. The
crates don't start clean: on `main` at `cf61f48`, with taste's PR (#198)
merged, 87 of `auracle-taste`'s 619 mutants survived (506 were caught, 26
unviable). Taste's and features' PRs merged before this check existed, so
a follow-up issue tracks their survivors; each crate's PR still to come in
#181 kills or answers its own. The PR job becomes required once they are
done.

**In CI**, the *Mutants* workflow (`.github/workflows/mutants.yml`), which is
not part of the required `CI` check (how long each part takes, and why it is
shaped so: `docs/architecture/testing.md`
[§ Mutants](../docs/architecture/testing.md#mutants)):

- **On every PR:** the mutants in the changed code (`make mutants
  DIFF=1`'s command against the merge base, run directly so the job reads
  cargo-mutants' own exit code), one at a time on one runner, stopped after
  25 minutes, the unmutated build and tests included, with what was judged
  reported. A PR that changes no Rust in `crates/` passes at once. Mutants
  run in source order, so a stopped run has judged the first. A change to
  taste or grammar finishes; one that changes much of session, features or
  wasm is judged in part, and the local `make mutants DIFF=1` is the
  complete run. The run's summary lists each survivor (its line, linked,
  its function and its change) and each timeout, the PR's changed files
  mark survivors on their lines (the first ten), and the job is red when
  one survived.
- **Weekly, and by hand:** one part of the workspace. The whole does not fit
  in a week's runners, so each crate's mutants are cut into shards (the
  `plan` job's `PLAN`), four run each week, two runners at a time, and the
  parts come in turn: a cycle of fifteen weeks aims to cover the workspace.
  The cover is approximate: a shard is a slice of its crate's mutants in
  source order on the day it runs, so code that changes between weeks
  moves the slices' edges, and a mutant near one can be tested twice in a
  cycle or not at all. A week whose run is dropped leaves its part to the
  next cycle. Every shard's survivors are in one summary, and a run on
  `main` that finds any files or comments on one issue, *Mutants that
  survive*, naming the part it covered. A shard stopped at its cap means
  its crate needs more shards in `PLAN`.

## Diagnostics worth knowing

`make climb`, `make search-check`, `make islands`, `make phi-stats`,
`make norm-peak`, `make fit-bench`, `make closed-loop`, `make walk-payload`:
each is a measurement with a table, documented in the `Makefile`.
`make revalidate` runs the ones a φ change owes.
