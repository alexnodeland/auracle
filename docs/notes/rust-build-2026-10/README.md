# A Rust edit builds and tests faster: what was measured (#321)

2026-10-06 and 07. The maintainer asked whether a faster Rust toolchain could speed
up the builds and tests, on a machine that is rarely quiet. This is what was
measured on this repository, how, and what came of it. A record: dated, not
kept current.

## How the figures were taken

- **The machine.** One 16-core Apple M3 Max (12 performance cores, 4
  efficiency) that other agents' builds share: the load average read 44 to
  222 through the runs, and was never below 44. The compiler is the pinned
  1.99.0 (`rust-toolchain.toml`); Apple's linker is ld-prime (ld 1221.4,
  Xcode 26.0.1).
- **CPU time is the figure, wall time is shown beside it.** At a load of 100
  a build's wall time is two to four times its CPU time and moves by that
  much between two runs of the same command (the cold test build took 85 s
  at a load of 48 and 173 s at 100, on 306 and 294 CPU seconds); the CPU
  time (user and system, from `/usr/bin/time -l`) moved by 5 to 10 %. Every
  figure here is CPU seconds unless it says wall, with the load average
  before and after in the raw table. On a quiet machine the wall time of a
  build is its CPU time over the cores it can use, bounded by the chain of
  crates that wait on one another.
- **Where sccache ran, its server's CPU is counted.** The server runs the
  compiles, so `/usr/bin/time` on cargo alone misses them. The harness
  started a server of its own for each measurement (its own port, its own
  cache directory), under `time`, and added its CPU to cargo's.
- **Scratch copies, never another worktree.** Each variant built in a copy
  of this tree made with `git archive` (so a different path, as a second
  worktree has) with its own `target/`; the one-line edits were made in the
  copies.
- **Interleaved, repeated, the least taken.** The variants alternated
  (A B A B) so that the load's drift fell on both, and each was run two to
  four times; where a figure is a range, the range is every run.
- **Builds under `nice -n 10`.** The harness is [`measure.sh`](measure.sh) in this
  directory: `nice -n 10 /usr/bin/time -l`, the load average read before and
  after, one line per run.
- **What the figures can't resolve.** A cold build of four minutes moved by
  5 to 10 % between runs of the same command; a run of the tests by about
  5 %. Short runs moved more: two session-crate rebuilds after the same
  kind of edit took 87 and 36 CPU seconds, and a cold non-incremental build
  283 and 204. I did not find why (work at `nice -n 10` landing on the
  efficiency cores, where the same work takes more CPU time, is a guess I
  did not check). So the figures to read are the least of several runs, and
  a difference under about 5 % on a build or a test run is not a difference;
  on a rebuild, only one that holds in every run.

## Where a cold test build and a test run spend their CPU

The tests as `make test` builds them (`test-fast`, `--lib --bins --tests`),
cold, on 1.99.0, with nothing cached:

| | CPU s | Of it |
| --- | --- | --- |
| The dependencies and the workspace's crates, cold | 285 | |
| The workspace's five crates alone (the dependencies already built) | 216 | 76 %: the crates and their test targets, at opt-level 3, incremental |
| The fast tier's run (646 tests) | 1,078 | four times the build |

So a test run is four fifths of `make test`'s CPU, and the dependencies a
cache can give back are a quarter of the build. That bounds what the
options below can save, and is why none of them is a large win.

`cargo test --no-run --timings` (one cold run, at a load of 145 to 215, so
the durations are wall time and add to more than the build took) says which
units: the workspace's thirteen units (each crate's library, and again with
its tests) 953 s of 1,459, the 89 dependencies 491 s and the 19 build-script
runs 15 s. The heaviest units are the workspace's own: the session crate's
tests 148 s, the wasm crate's 135, grammar's 127, then the wasm library
120 s, features' tests 105 and grammar's library 101; the heaviest
dependencies are nalgebra (52 s), quiver-dsp (50) and js-sys (47).

## 1. sccache, on by default

`make check` builds three things from a clean `target/`: the tests
(`test-fast`), clippy over every target, and the wasm32 check. Each ran in
a copy of the tree, four times without sccache and four with, alternating,
with a server of its own per run and the CPU of its compiles counted
(user + system, seconds; every run is shown):

| | tests | clippy | wasm32 check | the three |
| --- | --- | --- | --- | --- |
| No sccache (four runs) | 306, 284, 278, 294 | 53, 48, 47, 50 | 41, 43, 42, 42 | 400, 375, 367, 386 |
| sccache, the cache empty (the first build ever) | 314 | 62 | 51 | 427 (+7 %) |
| A second worktree (another path), the cache warm | 270 | 43 | 31 | 344 |
| The same worktree, `target/` cleaned and built again | 251, 245 | 33, 35 | 20, 21 | 304, 301 |

A first build costs 7 % (against the same worktree's run) to 16 % (against
the least) more with an empty cache: it hashes and stores every compile. A
second worktree's first build costs 6 to 14 % less than without, and a
rebuild after a `cargo clean` or a branch switch, where the workspace's own
crates come back as well, 17 to 25 % less.

What comes back, and what can't. Of the 65 compiles the test build asks
the server for, 49 were taken from the cache in a second worktree, and 16
were not: the five workspace crates, and eleven more that I take to be the
dependencies with a build script (18 of them run one in this build), whose
`OUT_DIR`, a path inside the worktree's `target/`, is part of what sccache
hashes; I did not check each of the eleven. sccache never caches a build script, a
procedural macro or a binary (27 of the test build's 120 requests: its
`crate-type`), nor an incremental compile (12: the workspace's crates under
`test-fast`). The cache grew from 132 MB after the first worktree's three
builds to 180 MB after the second's (each new path caches its own crates
again), and stayed there when a worktree built a second time.

sccache cannot change the edit-and-test loop: an incremental compile is
never cached, and the rebuilds ran as they did without it (98 and 36 CPU
seconds with it in the way, 102 and 87 without, for the same two edits).

`make wasm` (fat LTO, one codegen unit, wasm-opt), cold, CPU seconds:

| | |
| --- | --- |
| No sccache | 134, 135, 124 |
| sccache, the cache empty | 136 |
| A second worktree, the cache warm | 112 (-10 to -17 %) |
| The same worktree again | 72 (-42 to -47 %) |

The wasm32 builds do go through sccache: 48 of the 68 compiles of a second
worktree's `make wasm` came back. The engine's own link (the fat LTO of the
`cdylib`, which is `crate-type` and never cached) does not, and is most of
what is left. The engine it built was the same file, byte for byte
(`sha256` equal), with and without it.

**Adopted.** `make` compiles through sccache whenever it is installed, and
`scripts/setup.sh` installs it; the Makefile caps the cache at 2 GB (the
dependencies of the three builds take about 0.3 GB), starts the server at
`nice -n 10`, and says so when the server won't start. See the testing
guide's *The local loop*. A saving of a tenth to a fifth of a fresh
worktree's compile CPU is modest; the better second worktree is the one
that doesn't build at all (below).

**That it builds and judges the same.** Each of these ran with and
without the wrapper:

- The 64 dependency rlibs of the cold `test-fast` build are the same bytes
  (a `sha256` of each, compared), and `cargo nextest list` names the same
  656 tests.
- Clippy over every target printed nothing in all eight runs, with and
  without; with a variable left unused in a copy it failed the same way
  (`-D warnings`, the same message, exit 101) through the wrapper, and a
  test written to fail failed through it (nextest's exit 100).
- `make coverage`'s own commands (`cargo llvm-cov nextest`, then its
  reports), on auracle-taste: the line, function and region totals of the
  summary, 11,925 lines of which 943 covered, 953 functions and 171, 18,939
  regions and 1,675, and the lcov file, are the same in four runs (two
  with, two without). cargo-llvm-cov 0.9.1 keeps a wrapper that was already
  set (its source names it `PRE_EXISTING`), and it only instruments the
  workspace's crates, so the dependencies came from the cache of the test
  builds (52 hits, 2 misses), and the same run again took 54 hits and none:
  64 CPU seconds against 112 to 117 without (-45 %).
- `make mutants`'s command (cargo-mutants, `--package auracle-taste -F
  winsor_k`, the fast tier's filter), eight mutants: eight caught with the
  wrapper and eight without, the same verdict on each; 156 CPU seconds
  against 171 (-9 %, with 38 hits in the copies that cargo-mutants builds
  in a path of its own).
- `make lint` and `make wasm-check` ran clean in this worktree through the
  default, against the real cache and the default port.

**A server that will not start.** A foreign process on sccache's port made
every compile fail with `Failed to send data to or receive data from
server`, and one `sccache --show-stats` against it waited for ever; the
Makefile now asks for the stats under a ten-second alarm and builds without
sccache, with a warning, when it does not answer. An unwritable cache
directory made no difference to a build.

## 2. A new worktree's engine is copied

`make wasm` is the slowest step of a fresh worktree (124 to 135 CPU seconds,
330 to 530 s of wall at a load average of 100 to 130), and a worktree that
changed no Rust builds the same engine as another checkout's. `make
pkg-reuse` already took the main checkout's build when its stamp
(`apps/web/pkg/build.json`) carried the same source hash; it now takes any
checkout's, the main one first, then the most recently built, by copy, and
`make worktree` runs it. When there is none it says `make wasm` is owed.
Tested in `scripts/test_wasm_pkg.py`.

## 3. The `test-fast` profile

`[profile.test-fast]` is release's opt-level 3, no LTO, 16 codegen units,
incremental. Each variant changed the five workspace crates only (a
`[profile.test-fast.package.auracle-…]` section each; the dependencies stay
at opt-level 3, 16 units). Measured as a cold build of those crates (the
dependencies built already), the fast tier's run (the 646 tests `make
test-fast-tier` runs, all passing), and the rebuild after a one-statement
edit in the body of a plain function, in `auracle-grammar` (`tree_diff`) and
in `auracle-session` (`claim_name`), each edit different from the last
(CPU seconds; every run of the rebuilds, the builds' least first):

| Workspace crates at | cold build | fast tier's run | build + run | rebuild, grammar edit | rebuild, session edit |
| --- | --- | --- | --- | --- | --- |
| opt-level 3, 16 units (until now) | 216, 225, 225, 226 | 1,078, 1,083 | 1,294 | 31 to 41 (six runs) | 33 to 40 (seven) |
| opt-level 2 | 217 | 1,117 | 1,334 | 42 | 33 |
| opt-level 1 | 156, 162 | 1,131 | 1,293 | 27 to 31 (four) | 24 to 25 (four) |
| opt-level 3, 256 units (adopted) | 224, 229, 245, 253 | 1,069, 1,105 | 1,293 to 1,358 | 9 to 11 (seven) | 12 to 13 (seven) |

The first rebuilds measured (98 and 102 CPU seconds in grammar, 87 and 36 in
session) were edits to `gen_index`, an `#[inline]` generic function every
crate calls, and to `draw_cursor`, a one-line getter, and every crate that
calls such a function compiles it again: what an edit touches costs as much
as the profile does. They are left out of the table; the edits in it are
to the bodies of plain functions. In wall time at a load of 100 to 190 the
rebuilds took 43 to 54 s today and 16 to 23 s with 256 units (grammar),
29 to 54 s and 20 to 33 s (session).

- **Opt-level 2 builds no cheaper** (the same 217), and opt-level 1 builds
  a quarter cheaper (-54 CPU seconds) while the run costs +53: a wash. The
  test run is four fifths of `make test`'s CPU, so run time decides, and
  nothing under opt-level 3 gains on it.
- **256 codegen units make the edit loop three times cheaper** (9 to 13 CPU
  seconds a rebuild against 31 to 41): incremental compilation reuses whole
  codegen units, and a unit is one sixteenth of a crate at 16 and a
  two-hundred-and-fifty-sixth at 256, so an edited function dirties much
  less. The fast tier takes the same CPU (1,069 and 1,105 against 1,078 and
  1,083). A cold incremental build costs about 7 % more (a mean of 238
  against 223).
- **CI's builds are not incremental** (`CARGO_INCREMENTAL=0`), and neither
  is cargo-mutants' there, so the same variants ran that way too, in the
  same copy: the workspace's crates cold took 283 and 204 CPU seconds at 16
  units and 237 and 224 at 256 (the spread is the noise described above:
  nothing separates them), and a rebuild of `auracle-taste` and its tests
  after an edit to one function, the size of a mutant, took 9 CPU seconds in
  each of four runs at 16 units and 10 in each of four at 256 (the first
  rebuild of each variant is left out: it rebuilt dependencies that a `-p`
  build unifies differently). So the 256 units cost CI nothing that can be
  seen; a local `make mutants`, whose mutants are incremental edits, should
  gain as the edit loop does (not measured).

**Adopted: `codegen-units = 256` for the workspace's crates, 16 for the
dependencies** (`[profile.test-fast]` and `[profile.test-fast.package."*"]`
in `Cargo.toml`; `cargo build --unit-graph` shows the five crates at 256 and
every dependency at 16). Opt-level stays 3: no variant of it was better by
more than the noise, and the run is four fifths of the CPU. Under
cargo-mutants (`profile = "test-fast"` in `.cargo/mutants.toml`) a slower run
per mutant would have counted against the 25 minutes the PR's *Mutants* job
has, another reason not to trade run time for build time.

## 4. The linker

**macOS.** `ld -v` says `PROJECT:ld-1221.4` (Xcode 26.0.1): Apple's linker
since Xcode 15, ld-prime, which is multi-threaded and is the fast one there
(the alternatives, lld and zld, are not faster on a Mac). A wrapper around
`cc` timed every link of a cold test build: 35 links (17 of them test and
`cdylib` outputs, the rest build scripts and procedural macros) took 3.3 CPU
seconds of the build's 285 (1.2 %), and the 15 s of wall they spent were
spread across the build. After an edit, the 9 relinks after a grammar edit
took 1.2 CPU seconds, and the 6 after a session-crate edit 0.8 to 1.0. Linking
is a small part of a test build here, and nothing is left to gain from
another linker on the Mac.

**Linux, what CI runs.** Rust 1.99 on `x86_64-unknown-linux-gnu` links with
its own `rust-lld` by default (`-fuse-ld=lld` with the toolchain's
`gcc-ld/ld.lld`, as `rustc --print link-args` shows). No CI leg could be
run without a push, so the same cold test build ran in an
`ubuntu:24.04` x86_64 container on this Mac (Rosetta; four CPUs, two runs
each, alternating; `CARGO_INCREMENTAL=0`, as CI has it), with `cc` wrapped to
time each link, once with the default and once with `-C
link-arg=-fuse-ld=mold` (mold 2.30.0; its `.comment` section names it in a
linked program):

| | links | link CPU | the 8 test executables | the build's CPU |
| --- | --- | --- | --- | --- |
| default (`rust-lld`) | 35 | 17.0 and 18.4 s | 3.7 and 3.7 s | 1,070 and 1,003 s |
| mold | 35 | 4.1 and 3.5 s | 0.9 and 0.9 s | 1,052 and 870 s |

mold links in a quarter of lld's CPU, and that is 13 to 15 CPU seconds of a
cold build of about a thousand (under emulation, which multiplies every
figure): 1.4 %. The wall time of the links was not shorter (58 and 48 s of
link wall against 54 and 40: the host's load decides it), and the builds'
walls (296 and 245 s against 306 and 274) are inside that load's noise. The
eight test executables, which a changed crate relinks in the edit loop (CI
has no edit loop), save at most 2.8 CPU seconds there. Installing mold on a runner (`apt-get install mold`, or
a pinned action) costs about what the saving is worth, on every Rust job.

**Not adopted: mold on CI.** Its ceiling is a bit over one percent of a
Rust job's CPU, with a package to install on each; no workflow changed. If
one wants the number from CI itself, `gh run view <id> --log` of a Coverage
archive job, with `-C link-arg=-fuse-ld=mold` in a copy of the workflow, is
the measurement, and this is what it is expected to find.

## 5. The parallel front end (`-Zthreads`)

The pinned stable compiler refuses the flag (`the option 'Z' is only
accepted on the nightly compiler`) and accepts it under `RUSTC_BOOTSTRAP=1`,
which is what the figures used (a different compiler, nightly, would change
every cache key and is a PR of its own). The parallel front end is in the
stable build: a rustc given `-Zthreads=8` showed 27 and 28 threads at its
peak, against at most 10 given `-Zthreads=1` (sampled with `ps -M`).

At a load average of 180 to 220, CPU and wall seconds:

| | `-Zthreads=1` | `-Zthreads=8` |
| --- | --- | --- |
| `cargo check --workspace --all-targets`, cold (the front end alone: CI's Lint job's shape) | CPU 46, 50, 47; wall 95, 160, 160 | CPU 55, 57, 57 (+20 %); wall 54, 86, 85 (-43 to -47 %) |
| The tests' cold build | CPU 283, 277; wall 175, 311 | CPU 288; wall 230 |
| Rebuild after an edit (grammar, session) | CPU 31, 34 | CPU 32, 34 |

A build that is the front end (a check, clippy) finishes in about half the
wall for a fifth more CPU, even with no idle cores to speak of; one that is
LLVM's (the tests') gains nothing, and the incremental rebuild neither. On a
runner with four cores to itself the check might gain more or less; that is
CI's number to take. Not adopted: it needs `-Z` flags, so `RUSTC_BOOTSTRAP=1`
(which unlocks every nightly feature for cargo and the build scripts of the
dependencies too) or a nightly compiler, in `make` and in every job, to keep
the lint here and CI's the same compiler's judgement. A decision for the
maintainer, with this number.

## 6. Cranelift: considered, and out

`rustc-codegen-cranelift` is a component of the nightly channel only (the
pinned 1.99.0's component list has none), and a codegen backend is chosen
with `-Zcodegen-backend`, so it needs nightly (or `RUSTC_BOOTSTRAP`) whatever
else is said of it. It was measured on the local nightly (1.99.0-nightly of
2026-07-10), on what does not render audio, auracle-taste's tests, with
`RUSTFLAGS=-Zcodegen-backend=cranelift` (so the dependencies, fugue-ppl's
MCMC among them, are Cranelift's too), `test-fast`, CPU seconds:

| | LLVM | Cranelift |
| --- | --- | --- |
| Build the crate's tests (the dependencies too, from nothing) | 101 | 43 (-57 %) |
| Run its 59 tests | 17 | 124 (7 times) |
| `cargo check --workspace --all-targets`, cold | 50 | 48 |

The build is cheaper and builds; the tests that fit a posterior run eight
to ten times as long (`posterior_ranks_a_pool` took 91 s against 10, and `duels_recover_theta`
111 against 13). That is what an optimized test needs LLVM for, in
this crate as in the ones that render, so the tests that matter can't use it.
`cargo check` and clippy run no code generation of the crates', so the
backend changes nothing there (the 2 s are inside the noise). Not adopted, and not a decision for the maintainer: it
only loses.

## What the branch changed, and what is left

Adopted, each with its figures above: sccache by default (§ 1), copying
another checkout's engine (§ 2), and 256 codegen units for the workspace's
crates (§ 3). Measured and not adopted: opt-levels 2 and 1 for the
workspace, mold on CI (§ 4: a ceiling of 1.4 % of a Rust job's CPU, and a
package to install on each), Cranelift (§ 6), and the parallel front end
(§ 5). No workflow changed.

For the maintainer:

- **The parallel front end** needs `-Z` flags, which the pinned stable
  accepts only under `RUSTC_BOOTSTRAP=1`, and changes what CI's and the
  machine's lint judge only if every job sets it: see § 5 for what it saves.
- **sccache's priority.** A running server serves every worktree and keeps
  the priority and the cache size it was started with. `make` starts it at
  `nice -n 10`, so a compile the operator wants first runs at that priority
  too when it goes through `make` and a server. `AURACLE_SCCACHE=0` is the
  way out for one command.
- **mold's number from a runner** is the CI-side measurement in § 4, and
  `.github/workflows` is #177's.

## The raw figures

[`results.tsv`](results.tsv) has every run, in the order it ran: the tag,
the load average before and after, wall seconds, CPU seconds (user + system,
the sccache server's included), user, system, peak resident MB and the exit
code. The tags:

| Tag | Run |
| --- | --- |
| `N1` to `N4`, `S1` to `S4` | `make check`'s three builds (`.test`, `.clippy`, `.wasm` for the wasm32 check), without (`N`) and with (`S`) sccache: `S1` the first build with an empty cache, `S2` and `S4` a second worktree's, `S3` the first worktree again |
| `WN1` to `WN3`, `WS1` to `WS3` | `make wasm`, without and with sccache (the same order) |
| `P0.cold` | the cold test build |
| `R1.V0` to `R1.V3`, `R3.…`, `R4.…` | the profile variants: `V0` today's, `V1` opt-level 2, `V2` opt-level 1, `V3` 256 units; `.build` the workspace's crates cold, `.run` the fast tier, `.eg`, `.es` a rebuild after an edit in grammar or session (`.scc` with sccache) |
| `NI.…` | the same, not incremental (`CARGO_INCREMENTAL=0`); `.mu` the rebuild of auracle-taste |
| `N9`, `S9`, `F.…` | the sccache checks: the build with and without (`S9.run` was stopped), and the failing lint and test |
| `CV.…`, `MU.…` | coverage and mutants on auracle-taste, `P` without and `S` with sccache |
| `Z1.…`, `Z8.…`, `ZC…` | `-Zthreads=1` and `8`: the tests' build and edits, and `cargo check` |
| `CL.…` | Cranelift (`clif`) and LLVM on nightly: `tf` the tests' build and run, `chk` the check |
| `T1.cold` | the cold test build with `--timings` |

The first `CV.P1` (exit 1) ran `llvm-cov report` without the profile and
was run again; the two `Z1.a` rows are the same cold build, run twice (a
first run was interrupted before its edits).
