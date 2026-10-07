# Where a browser spec's time goes, and what a cache takes away

[#323](https://github.com/alexnodeland/auracle/issues/323) asked where a
browser spec's time goes (its boot, its own work, its teardown), and for what
pays among three candidates, in order: an engine the browser can cache, a
boot that starts warm from the app's own render cache, and two Playwright
workers per machine once boots are cheap. Measured on 2026-10-06 at `main`
be46e7a (build `5a3107c6591cceda`), in Playwright 1.63's Chromium, and from
the blob reports of CI's full gate on run
[37554756597](https://github.com/alexnodeland/auracle/actions/runs/37554756597)
(the merge queue checking #322 and #324 together on `main` c854163: 307
tests on twelve 4-vCPU runners). The machine here was a 16-core M3 Max
shared with other agents' builds, at load averages of 81 to 166 (beside each
figure), every browser job through `one_browser.sh` on a port of its own.

## Decisions

- **The engine is not made cacheable.** Compiling the 3 MB binary takes 4 to
  13 ms (`WebAssembly.compileStreaming` compiles lazily) and fetching it from
  localhost 1 to 34 ms. Each test's context is a fresh in-memory profile with
  an HTTP cache of its own, so nothing a cache keeps reaches the next test;
  and even in a profile on disk, where the browser's code cache can keep the
  compiled engine, a boot was 90 ms sooner at the median (1000 against 1093
  ms to the veil) and its fill no sooner (5.6 s against 5.7). `serve.py`
  keeps `no-store`.
- **No warm boot for every spec.** The veil cannot come down sooner from a
  cache: its 8 sounds are rendered with their audio, which the render cache
  never holds (worker.js `FARM_AUDIO_AHEAD`; [the October
  measurements](test-audit-2026-10/measurements.md#the-boot-33) found the
  same, and that a full pool from the first second made the engine waits of
  tests that don't wait for it longer).
- **Renders reused where a test waits for the whole pool first**
  (`app.boot({ reuseRenders: true })`, built): on CI 43 tests spent 13.8 of
  84.1 test-minutes waiting for the pool to fill after the veil. For a test
  that does nothing before the pool is whole, a filled cache removes that
  wait and changes nothing it then sees. 16 fast-tier tests qualify, the
  bank's; together their fill waits were 5.5 test-minutes on CI.
- **Two workers per machine: not measured.** Its condition, boots made cheap,
  did not hold: the boot is still 29.5% of the fast tier on CI, at a median
  4.7 s. Here, `one_browser.sh` already runs two suites side by side, and a
  machine at load 100 to 160 measures its neighbors, not the workers.
- **The headless shell is what runs.** Playwright 1.63 launches
  `chromium_headless_shell-1243` (`chrome-headless-shell`) for headless
  Chromium. On CI its launch is in each runner's first test, 180 to 300 ms;
  a test's setup otherwise is a median 50 ms (a context and a page), its
  teardown 26 ms: together 0.5% of the tier.

## The split

`tests/web/split.mjs` splits each test into its setup (Before Hooks), its
boots (a navigation to the end of the fixture's `app.booted()` after it),
its waits for the whole pool, its own work and its teardown (After Hooks),
from a live run or from CI's blob reports (the commands are in its header).

**CI, the full gate of run 37554756597** (all 307 fast-tier tests):

| Part | Test-minutes | Share |
| --- | --- | --- |
| Setup | 0.3 | 0.3% |
| Boot (309 boots) | 24.8 | 29.5% |
| Waits for the whole pool, the fixture's `filled` only | 4.1 | 4.8% |
| The tests' own work | 54.8 | 65.2% |
| Teardown | 0.1 | 0.2% |
| In all | 84.1 | |

A boot took a median of 4730 ms (p10 3141, p90 5984), of which the page's
load was a median 177 ms: the rest is main's boot up to `playable`, the
engine's start and its first 8 renders on a farm 2 wide. That run's `poolRows`
and `fullPool` waits had no title yet, so they count as the tests' own above.
Read by their source lines instead, every wait for the whole pool after a
boot came to 13.8 test-minutes (16.4%), in 43 tests:

| Spec | Tests | Waiting for the pool (s) | Of the tests' time (s) | Reuses renders now |
| --- | --- | --- | --- | --- |
| `faces.spec.js` | 8 | 263 | 348 | no: about the faces' renders, which land as the pool does |
| `bank_lineage.spec.js` | 10 | 206 | 267 | yes, the 10 that mark a whole pool; those that teach first do not |
| `taste_learning.spec.js` | 11 | 96 | 280 | no: the warm start's fit lands while the pool fills |
| `bank_find.spec.js` | 3 | 62 | 80 | yes |
| `session_seed.spec.js` | 1 | 56 | 72 | no: about a fresh session's pool |
| `bank_touch.spec.js` | 2 | 41 | 55 | yes |
| `evolve_ahead.spec.js` | 3 | 36 | 48 | no: about deals, which the fill's timing shapes |
| `bank_row.spec.js` | 1 | 23 | 30 | yes |
| `evolve_truth.spec.js` | 1 | 22 | 34 | no: about deals |
| `model_view.spec.js` | 2 | 11 | 39 | no: the warm start's fit lands while the pool fills |
| `first_run.spec.js` | 1 | 9 | 24 | no: a first visit |

**Here, the eight view samples** (`changed.mjs`'s `sample`s, the fast tier's
48 tests, 288 s, load 118 to 145): setup 2.7%, boot 23.5% (a median 1327 ms,
p10 1015, p90 1650), the tests' own work 73.2%, teardown 0.7%. By spec, the
boot was 10% (`taste_marks`) to 46% (`shell_levels`) of a test's time.

## A cacheable engine

Each figure is one browser, in one profile, with the server sending
`no-store` on everything (as `serve.py` does) or a year's `max-age` on every
URL that carries the build stamp (`?v=`):

| Profile | Server | Compile, cold (ms) | Boots 2 to 4: veil, median (range) | Boots 2 to 4: pool full, median | n |
| --- | --- | --- | --- | --- | --- |
| In memory (a test's) | no-store | 7 | (a new context: 1367) | 5732 | 1 |
| In memory | `max-age` | 8 | (a new context: 1138) | 5846 | 1 |
| On disk, storage cleared between boots | no-store | 6 to 13 | 1093 (992 to 1181) | 5693 | 9 |
| On disk, storage cleared between boots | `max-age` | 4 to 12 | 1000 (919 to 1029) | 5552 | 9 |

A browser's first boot had the veil down in 1327 to 1909 ms. On disk, the
second and later boots were about 500 ms sooner with either server, `no-store`
too: that is the browser warming up, which every test of a run but its first
already has. Load 109 to 166.

## Renders reused

`app.boot({ reuseRenders: true })` starts a boot with the render cache
(`auracle-renders`) as an earlier boot of the same seed left it once its pool
was whole: the fixture keeps the store's rows (in the worker, and in
`tests/web/.renders/` by the engine binary's hash) and writes them into the
store from a page of their own in the boot's context, before the app's first
script. The first boot of a seed in a run is cold. A hit is the φ a render
gives, bit for bit (a row is stored under the namespace and the draw's
content address, which the engine checks against its tree), so the pool is
the same sound for sound (`fixture_renders.spec.js` holds it to that).

Who asks: a test that does nothing before the pool is whole (`bank_find`,
`bank_touch`, `bank_row`'s sound opened from outside the bank, and
`bank_lineage`'s tests that mark a whole pool). Who doesn't: a test about
boot, the fill or a render (`smoke`, `first_run`, `session_seed`, `budgets`,
`faces`), and one that picks, teaches, deals or fits while the pool fills
(`taste_learning`, `model_view`, `evolve_*`, `bank_lineage`'s taught tests):
there a full pool from the start is another session, as the October
measurements found.

**Here** (the four bank specs' 21 fast-tier tests, 16 of them asking; cold
with the fixture's switch off, a scratch edit not committed, then reused
three times over from an empty `.renders/`, then cold again):

| Run | Load | The 16 that ask (s) | One of them, median (s) | The other 5 (s) |
| --- | --- | --- | --- | --- |
| Cold | 101 to 132 | 136.9 | 8.4 | 27.1 |
| Reused, first round (each seed's first test cold) | 111 to 130 | 68.4 | 3.7 | 24.6 |
| Reused, second round | 87 to 108 | 52.3 | 3.0 | 24.3 |
| Reused, third round | 81 to 130 | 54.5 | 3.0 | 38.8 |
| Cold again | 115 to 135 | 136.6 | 8.5 | 26.5 |

Each of the 16 was faster reused, by its median: 5.9 to 12.8 s cold, 1.9 to
6.4 s reused. A first run in a worktree halves their time, and once a seed's
rows are kept (in the worker, or on disk for the next run) they take about
40% of it. The other five, which do not ask, took the same; the one failure
among them (the third round's 38.8 s) was a test of its own that focused a ▶
its row's strip had already hidden, 3 runs of 20 on its own, which this
branch fixes. `fixture_renders.spec.js` took 7.4 to 9.8 s.

**On CI** each runner keeps its own rows, so a seed's first test on a runner
is cold. Dealt as run 37554756597 was, 4 of the 16 tests would have found
rows kept on their runner: 92 s of the 332 s their fill waits took, about 1.5
test-minutes of 84. The rest needs the rows on every runner from the start:
carried between runs as the timings are (the Actions cache, by the engine's
hash), or a seed's tests dealt to one runner.

## How it was measured

- **The split:** `tests/web/split.mjs`, over the run's twelve blob reports
  merged (`npx playwright merge-reports`), and over a run here. The waits for
  the pool by source line (the table above) and the deal by runner were
  scratch reporters over the same reports, not committed.
- **The engine's compile:** a scratch script (not committed) that served
  `apps/web` both ways on a port of its own and, in one browser, timed
  `WebAssembly.compileStreaming(fetch(<the binary>))` in a page of the
  origin, then booted the app seeded as the fixture boots it, four times,
  reading `auracle:veil-down` and when main heard `filled`. On disk, the
  origin's storage (IndexedDB, local storage, caches, service workers) was
  cleared between boots over CDP (`Storage.clearDataForOrigin`), so the HTTP
  and code caches stayed and each boot was a first visit's. Three rounds,
  the two servers interleaved.
- **Renders reused:** the specs above through `one_browser.sh`, the split
  reporter beside them, the runs back to back under one ticket.
