# Two measurements: background load and warm start

[#177](https://github.com/alexnodeland/auracle/issues/177) asked for two
measurements before anything was built: §1.8, whether a test mode with less
background load cuts the engine waits; and §3.3, whether a boot with the
render cache already filled is much faster. Both were measured on
2026-10-06 at `main` 719629f (build `fff1d675414a5632`), on a 16-core M3 Max,
in Playwright 1.63's Chromium, through `one_browser.sh` on a port of their
own: about 45 minutes of browser runs. The instrumentation was a scratch
edit of the fixture, not committed. Nothing in the app or the suite changed.

## Decisions

- **§1.8: no test mode.** Neither candidate cuts the engine waits where it
  matters. On the eight tests below, at throttle 4 and CI's farm width, a
  boot with no fill after the veil (warm) took 10% longer in all, its engine
  waits 17% longer. A pool of 8 took 8% longer, and failed one test of the
  eight every time: the pool's size is in what the model shows. Without that
  test, a pool of 8 was 6% faster, still under the 10% bar for a change to
  what the specs boot into. Its spread was lower too (the max less the min
  of three runs, summed over the seven: 7.7 s against 11.7), on too few runs
  to call clear, and not worth the failure. A narrower farm makes the fill
  longer, and CI's runners are already at width 2.
- **§3.3: no warm start.** At CI's width a filled cache does not move the
  veil (1.68 to 1.65 s at throttle 1, 2.10 to 1.95 s at throttle 4): the
  boot renders its first 8 sounds with their audio, and the cache never holds
  audio. It can remove about 1% of the fast tier's test time, on the specs it
  reaches, against a full fill per seed to make the state.

## How it was measured

- **The boot:** a fresh context per boot, seeded as the fixture seeds it,
  waiting for `filled`. Times are `window.__aur.marks()`, from `boot-start`
  to `veil-down` and `pool-full`; the cache's tally is the worker's
  `render_cache` log line (rows served from the store, and rendered).
- **Modes:**
  - *default*: the app as shipped (a pool of 40, `playableAt` 8).
  - *pool 8*: the `init` request's `poolSize` rewritten to 8 by an init
    script around the tap. `main.js` sends `poolSize: 40` as a literal;
    there is no URL parameter for it.
  - *warm*: the context starts with an `auracle-renders` store filled by
    earlier boots of the same build, for the seeds the measured specs use
    (`SEED`, `PERFORM_SEED` and the films' 20260928): 89 rows, 258 KB. It was
    taken with `context.storageState({ indexedDB: true })`, filtered to that
    database, and handed to `browser.newContext({ storageState })`.
  - *empty store*: the same database, with its namespace stamp and no rows.
  - *narrower farm*: `?farm=2`.
- **Throttle:** `AURACLE_CPU_THROTTLE=4` slows the page (CDP) and the
  engine's wasm calls, but not the farm's workers (`perform_budget.js`), and
  this machine's farm is 6 wide where a 4-vCPU CI runner's is 2 (`farmWidth`
  in `main.js`: the cores less 2, at most 6). So every throttle 4 run here is
  also at `?farm=2`, the nearest this machine comes to a CI runner. Throttle 1
  runs are at this machine's own width, 6.
- **The specs:** eight tests on the shared fixture, from the areas #177
  named: PATCH editing, PATCH's and PERFORM's keys, PERFORM's controls and
  layout, and TASTE's marks. Each was run 3 times per mode and throttle, each
  run its own Playwright process, the modes' order rotated from run to run.
  *Total* is Playwright's duration of the test. *Engine wait* is the time
  the fixture's engine waits took (`app.engine`, so `app.reply`,
  `app.booted` and the rest), less the boot's own; waits bounded by
  `offerBudget` and plain `expect` waits are not in it. *Boot* is
  `app.boot()` until the veil is down. Another suite shared the browser queue
  for 20 s of one default run (run 3, throttle 4); the other 18 runs had the
  machine to themselves.

## The boot (§3.3)

Milliseconds from `boot-start`, the median of n boots (range):

| Width | Throttle | Store | n | Veil down | Pool full | Rows served / draws |
| --- | --- | --- | --- | --- | --- | --- |
| 6 | 1 | none (cold) | 4 | 2329 (2312 to 2586) | 5869 | 0 / 41 |
| 6 | 1 | empty | 4 | 826 (816 to 960) | 4570 | 0 / 42 |
| 6 | 1 | filled (warm) | 4 | 825 (814 to 995) | 826 | 34 / 45 |
| 2 | 1 | none (cold) | 4 | 1675 (1597 to 1809) | 10279 | 0 / 40 |
| 2 | 1 | empty | 4 | 1665 (1611 to 1673) | 10224 | 0 / 40 |
| 2 | 1 | filled (warm) | 4 | 1653 (1617 to 1725) | 1653 | 34 / 43 |
| 2 | 4 | none (cold) | 5 | 2101 (1904 to 2764) | 41161 | 0 / 41 |
| 2 | 4 | filled (warm) | 5 | 1951 (1930 to 2176) | 1953 | 33 / 42 |
| 2 | 4 | none, pool 8 | 5 | 2102 (1888 to 2168) | 2104 | 0 / 9 |

Two earlier passes agree: 8 cold boots at width 6 had the veil at a median
2593 ms and 8 warm ones at 969 ms.

- **The veil waits for renders the cache cannot hold.** The worker asks the
  farm for audio with the first 8 draws (`wantAudio: (i) => i <
  FARM_AUDIO_AHEAD`, 8), and `farm.js` consults the store only for a job
  that wants no audio. The veil lifts at 8 sounds, so a warm boot renders
  nearly everything a cold one renders before it. A quarantined draw is not
  stored either: every warm boot of `SEED` still rendered 9 to 11 draws.
- **At width 6, the 1.5 s a warm boot gains is the store's creation.** An
  empty store gains all of it (826 ms against 2329), so it is the store's
  absence, not rendering, that holds the first sounds back. In a fresh
  profile each farm worker opens, creates and stamps the store before its
  first job (`cacheOpen`); with six at once that costs 1.5 s, and with two
  nothing that shows (1675 against 1665 ms).
- **What the rows remove is the fill after the veil:** the pool is full at
  the veil, where a cold boot fills for another 3.5 s at width 6, 8.6 s at
  width 2, and 39 s at width 2 and throttle 4.
- **Typed arrays survive `storageState`** (Playwright 1.63): a
  `Float32Array`, an `ArrayBuffer` and a `Float64Array` inside an object came
  back with their types and values. The render store holds strings anyway
  (`RenderJob::cached() -> String` in `crates/auracle-wasm`, its namespace
  stamp a string too), and the engine checks each row's content address
  against its tree before folding it in (`WasmEngine::pre_featurized`).

**What warm boots could remove from the fast tier's boot time.** Main's last
timings hold 77.9 test-minutes for 289 fast-tier tests; the 198 tests on the
fixture, the only ones a fixture option reaches, hold 54.8 of them, so about
15 boot test-minutes at #177's 28%. At CI's width a warm boot lifts the veil
1 to 7% sooner: at most about 1 test-minute, about 1% of the tier, and only
for the seeds the state was filled for. Making the state costs a full fill
per seed (41 s for `SEED`'s at width 2 and throttle 4; three seeds), on
every shard or in a job ahead of them.

## The background load (§1.8)

At throttle 4 and width 2 the fill outlasts the tests: 23 of the 24 default
runs ended before the pool was full (the 24th saw it at 16.4 s). In the boot
probe the pool held 11 to 13 sounds 5 s after the boot began, 15 to 17 at
10 s, 21 to 25 at 20 s, and was full at 36 to 43 s. So on a CI runner most
tests run beside the fill, as #177 says, and beside a pool of 10 to 25
sounds, not 40.

Eight tests, three runs each per mode and throttle (throttle 4 at width 2):

- `patch_editing.spec.js:95`: two knobs turned in quick succession under a
  slow engine both land
- `patch_editing.spec.js:125`: a second drag of the same knob starts from
  where the first one left it
- `patch_keys.spec.js:144`: a module in hand: the arrows choose a socket and
  Enter places it
- `perform_controls.spec.js:14`: a half-closed control stops at the centre
  on its closed side
- `perform_layout.spec.js:138`: the moved bar shows only when the sound has
  left home
- `pad_keys.spec.js:75`: ↵ keeps after a mouse turn
- `taste_marks.spec.js:47`: a guess is drawn hollow with a ?
- `taste_marks.spec.js:135`: TASTE's and LEARNING's early states count what
  is left

| Spec | Throttle | Mode | Total, median / max (s) | Engine wait, median / max (s) | Boot, median (s) | Failed |
| --- | --- | --- | --- | --- | --- | --- |
| `patch_editing.spec.js:95` | 1 | default | 10.8 / 11.6 | 7.2 / 7.5 | 2.8 |  |
| `patch_editing.spec.js:95` | 1 | pool 8 | 10.5 / 11.8 | 6.9 / 8.2 | 2.9 |  |
| `patch_editing.spec.js:95` | 1 | warm | 9.7 / 10.2 | 7.5 / 8.0 | 1.4 |  |
| `patch_editing.spec.js:95` | 4 | default | 19.1 / 22.2 | 14.8 / 17.3 | 2.6 |  |
| `patch_editing.spec.js:95` | 4 | pool 8 | 19.0 / 21.8 | 14.6 / 17.4 | 2.5 |  |
| `patch_editing.spec.js:95` | 4 | warm | 21.3 / 22.0 | 17.0 / 17.6 | 2.5 |  |
| `patch_editing.spec.js:125` | 1 | default | 14.7 / 15.6 | 5.2 / 5.9 | 2.8 |  |
| `patch_editing.spec.js:125` | 1 | pool 8 | 14.3 / 14.7 | 4.4 / 4.5 | 2.9 |  |
| `patch_editing.spec.js:125` | 1 | warm | 13.6 / 13.6 | 5.2 / 5.2 | 1.4 |  |
| `patch_editing.spec.js:125` | 4 | default | 21.0 / 23.0 | 11.0 / 12.8 | 2.5 |  |
| `patch_editing.spec.js:125` | 4 | pool 8 | 20.6 / 20.6 | 10.4 / 10.6 | 2.5 |  |
| `patch_editing.spec.js:125` | 4 | warm | 22.3 / 22.6 | 11.8 / 11.8 | 2.6 |  |
| `patch_keys.spec.js:144` | 1 | default | 5.2 / 5.4 | 1.6 / 2.1 | 2.9 |  |
| `patch_keys.spec.js:144` | 1 | pool 8 | 4.1 / 4.8 | 1.1 / 1.6 | 2.4 |  |
| `patch_keys.spec.js:144` | 1 | warm | 4.9 / 4.9 | 2.6 / 2.6 | 1.4 |  |
| `patch_keys.spec.js:144` | 4 | default | 9.1 / 9.6 | 5.1 / 5.6 | 2.6 |  |
| `patch_keys.spec.js:144` | 4 | pool 8 | 8.4 / 9.1 | 4.7 / 5.1 | 2.5 |  |
| `patch_keys.spec.js:144` | 4 | warm | 10.1 / 10.1 | 6.1 / 6.1 | 2.6 |  |
| `perform_controls.spec.js:14` | 1 | default | 3.3 / 3.7 | 0.8 / 0.8 | 1.9 |  |
| `perform_controls.spec.js:14` | 1 | pool 8 | 3.2 / 3.3 | 0.8 / 0.8 | 1.8 |  |
| `perform_controls.spec.js:14` | 1 | warm | 2.2 / 2.4 | 0.8 / 0.8 | 0.9 |  |
| `perform_controls.spec.js:14` | 4 | default | 5.1 / 5.5 | 1.9 / 2.4 | 2.1 |  |
| `perform_controls.spec.js:14` | 4 | pool 8 | 4.2 / 4.2 | 1.3 / 1.4 | 2.0 |  |
| `perform_controls.spec.js:14` | 4 | warm | 5.9 / 6.0 | 2.9 / 2.9 | 2.1 |  |
| `perform_layout.spec.js:138` | 1 | default | 11.0 / 11.2 | 7.6 / 7.6 | 1.8 |  |
| `perform_layout.spec.js:138` | 1 | pool 8 | 7.1 / 7.1 | 3.6 / 3.6 | 1.8 |  |
| `perform_layout.spec.js:138` | 1 | warm | 10.1 / 10.2 | 7.6 / 7.6 | 0.8 |  |
| `perform_layout.spec.js:138` | 4 | default | 11.2 / 11.4 | 7.3 / 7.3 | 2.1 |  |
| `perform_layout.spec.js:138` | 4 | pool 8 | 8.1 / 8.3 | 4.2 / 4.2 | 2.0 |  |
| `perform_layout.spec.js:138` | 4 | warm | 11.3 / 11.4 | 7.3 / 7.3 | 2.0 |  |
| `pad_keys.spec.js:75` | 1 | default | 6.8 / 7.0 | 0.8 / 1.0 | 2.5 |  |
| `pad_keys.spec.js:75` | 1 | pool 8 | 6.4 / 7.0 | 0.8 / 1.0 | 2.0 |  |
| `pad_keys.spec.js:75` | 1 | warm | 5.5 / 5.6 | 0.9 / 1.0 | 1.0 |  |
| `pad_keys.spec.js:75` | 4 | default | 9.2 / 9.5 | 2.8 / 3.2 | 2.2 |  |
| `pad_keys.spec.js:75` | 4 | pool 8 | 8.4 / 8.8 | 2.1 / 2.7 | 2.2 |  |
| `pad_keys.spec.js:75` | 4 | warm | 8.8 / 9.9 | 2.7 / 3.7 | 2.2 |  |
| `taste_marks.spec.js:47` | 1 | default | 6.6 / 6.6 | 3.7 / 3.7 | 1.8 |  |
| `taste_marks.spec.js:47` | 1 | pool 8 | 21.5 / 21.8 | 18.6 / 18.6 | 1.8 | 3 of 3 |
| `taste_marks.spec.js:47` | 1 | warm | 5.5 / 6.0 | 3.7 / 3.7 | 0.8 |  |
| `taste_marks.spec.js:47` | 4 | default | 14.9 / 16.7 | 10.7 / 12.7 | 2.1 |  |
| `taste_marks.spec.js:47` | 4 | pool 8 | 29.8 / 31.8 | 25.7 / 26.7 | 2.0 | 3 of 3 |
| `taste_marks.spec.js:47` | 4 | warm | 19.2 / 22.2 | 14.8 / 17.8 | 2.0 |  |
| `taste_marks.spec.js:135` | 1 | default | 13.2 / 13.7 | 7.9 / 7.9 | 1.8 |  |
| `taste_marks.spec.js:135` | 1 | pool 8 | 13.1 / 14.0 | 7.9 / 7.9 | 2.0 |  |
| `taste_marks.spec.js:135` | 1 | warm | 12.1 / 12.2 | 7.9 / 7.9 | 0.8 |  |
| `taste_marks.spec.js:135` | 4 | default | 16.9 / 17.6 | 9.7 / 10.2 | 2.0 |  |
| `taste_marks.spec.js:135` | 4 | pool 8 | 17.0 / 17.6 | 9.9 / 10.0 | 2.2 |  |
| `taste_marks.spec.js:135` | 4 | warm | 18.4 / 20.2 | 11.4 / 12.9 | 2.0 |  |

In all, the sum over the eight tests of each one's median:

| Throttle | Mode | Total (s) | Engine wait (s) | Boot (s) | Spread: max less min, summed (s) | Failed |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | default | 71.7 | 34.7 | 18.4 | 5.6 | |
| 1 | pool 8 | 80.2 (+12%) | 44.2 (+27%) | 17.6 | 6.3 | 3 of 24 |
| 1 | warm | 63.6 (−11%) | 36.1 (+4%) | 8.5 | 3.3 | |
| 4 | default | 106.5 | 63.3 | 18.3 | 13.9 | |
| 4 | pool 8 | 115.5 (+8%) | 72.8 (+15%) | 18.1 | 9.7 | 3 of 24 |
| 4 | warm | 117.6 (+10%) | 73.9 (+17%) | 18.1 | 12.6 | |

Without `taste_marks.spec.js:47`, which a pool of 8 fails: at throttle 4,
default 91.6 s, pool 8 85.7 s (−6%; engine wait −10%; spread 11.7 to 7.7 s),
warm 98.3 s (+7%); at throttle 1, default 65.1 s, pool 8 58.7 s (−10%), warm
58.1 s (−11%, all of it the boot).

- **Taking the fill away does not shorten the waits.** At throttle 1, warm's
  11% is the boot (the store's creation, above); its engine waits are 4%
  longer. At throttle 4 they are 17% longer.
- **A likely cause: the engine's work grows with the pool, and the default
  load keeps the pool small.** Warm gives a test all 40 sounds from its first
  second, where under the fill it has 10 to 25. The page asked the engine
  for nearly the same things in both modes (the tap's counts, three tests,
  two runs each: the same kinds of request, within a duel and two renders),
  yet warm was slower on six of the eight tests, most on the two that fit
  and deal over the bank (`taste_marks.spec.js:47`, 14.9 to 19.2 s;
  `taste_marks.spec.js:135`, 16.9 to 18.4 s), while a pool of 8 was fastest
  on PERFORM's (`perform_layout.spec.js:138`, 11.2 to 8.1 s;
  `perform_controls.spec.js:14`, 5.1 to 4.2 s). This is consistent with
  the timings; no request was timed on its own.
- **A pool of 8 changes what the specs assert.** `taste_marks.spec.js:47`
  failed all 6 of its runs under it: LEARNING's oscillator cell was drawn
  thin, "Too little to go on: 3 of 8 sounds carry this." (`nbPaintTheta`),
  where the test expects a guess. The pool's size is in what the model shows
  (how many sounds carry a feature, the standardizer refit on the finished
  pool), so a small pool is another session, not the same one under less
  load.
- **A narrower farm was not run on the specs.** It lengthens the fill
  (8.6 s after the veil at width 2 against 3.5 s at width 6, throttle 1), and
  CI's runners are at width 2 already.
- **How a spec would opt in.** `?farm=` is the only URL parameter there is,
  and `app.boot({ query: "?farm=N" })` reaches it today. The pool's size has
  none: an option would rewrite the `init` request in the page, as this
  measurement did, with nothing in the app changed. A warm boot would be
  Playwright's `storageState` option, from a file a global setup writes.

## The store made once (#200)

The store's creation, left open below, was
[#200](https://github.com/alexnodeland/auracle/issues/200). Its fix: the
engine worker opens the render store, creates it on a first visit and stamps
it with the namespace, then hands boot's crew the phrase (`farmBoot` in
`worker.js`, the store's rules in `render-store.js`), so the farm workers'
opens only read. Measured on 2026-10-06 on the same machine, in the same
Chromium, booted and seeded as above: `main` e31f60c (build
`80f90b7e8d2ca5c5`) against the fix (build `66e175c4735b44ce`, whose code
differs from the commit's by one comment's wording), each served on a port
of its own, their boots interleaved and the order swapped from run to run,
through `one_browser.sh` with the machine to themselves. Each boot was a
fresh profile: in memory (`browser.newContext()`, as the suite's contexts
are) or on disk (`launchPersistentContext` on a new directory, as a player's
browser has it on a first visit).

**What the wait was.** A scratch timing of `cacheOpen` in each farm worker
(not committed), on `main`, cold, at width 6: the worker that created the
store was done with it in 2 or 3 ms, and the other five at up to 1,930 ms
(19 of the 20 after 160 ms), nearly all of it waiting to write the stamp
(their clears of the rows mostly took 1 or 2 ms). A store made beforehand
with both object stores and no stamp still had the veil down at a median
1,528 ms (828 to 2,345, n 4), against 816 with the stamp written. So the step
done once has to write the stamp, which is the engine's namespace: main,
which has no wasm instance, could not do it.

Milliseconds from `boot-start` to `veil-down`, median (range), 6 boots each:

| Width | Profile | Before | After | Pool full, before → after |
| --- | --- | --- | --- | --- |
| 6 | in memory | 2296 (1901 to 2330) | 903 (822 to 1000) | 5728 → 4767 |
| 6 | on disk | 2520 (2423 to 2673) | 1050 (989 to 1178) | 5528 → 4861 |
| 2 | in memory | 1649 (1617 to 1729) | 1644 (1623 to 1694) | 10490 → 10280 |
| 2 | on disk | 2136 (1920 to 2213) | 1887 (1834 to 1920) | 10931 → 10582 |

- **At width 6 the veil is down about 1.4 s sooner,** near where a store
  already made had it (826 above). Five more boots of the fix alone, in
  memory, had it at 836 ms (816 to 952), and a store made and stamped
  beforehand at 814 (807 to 891): with the fix, a first visit's store costs
  nothing that shows.
- **At width 2, in memory, nothing moved,** as the table above found. On
  disk a first visit at width 2 gained about 250 ms too, likely the two
  workers' writes, which a disk makes dearer (not timed on their own).
- **The cache still serves.** A cold boot at width 6 left 34 rows under the
  stamp, and a reload in the same context served 22 and then 11 of them
  (73% and 100% of its two waves), with nothing in the console.

## Left open

- **Six farm workers creating the render store cost a fresh profile about
  1.5 s before the veil** on this machine (width 6), and nothing measurable
  at width 2. Every local browser test paid it (about 7 minutes over the
  fast tier's 289 boots); CI's runners do not. A player's first visit on a
  machine with 8 or more cores (width 6) went the same way. Fixed in #200:
  [The store made once](#the-store-made-once-200).
- **These numbers emulate a CI runner.** A runner's farm workers are slower
  too, and its engine is not slowed four times. One CI job printing the marks
  (#177 §3.3's first proposal) would give the fill's real length there. The
  decisions hold unless a runner's fill ends before most tests do.
