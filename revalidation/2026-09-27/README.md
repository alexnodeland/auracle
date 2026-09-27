# Revalidation 2026-09-27: main vs #59 vs motion bands

Three refs measured with identical commands, one after another on the same 4-core container. Nothing ran concurrently.

| arm | ref | commit |
|---|---|---|
| A | `origin/main` | `bb0c7f59a07fc9199b7ab71a5e1ea54bb24ffd38` |
| B | `origin/claude/auracle-stack-audit-ixwq3k` (PR #59) | `334b3a9a104fab02ebb3aff352a6525bf6bcecd5` |
| C | `origin/claude/auracles-composer-performer-gtlo9w` (motion-band φ) | `53581f0503278b171a34c376455100c54ae7c5d2` |

Commands, run in each arm's worktree:

```
make phi-stats    > phi.log    2>&1
make norm-peak    > peak.log   2>&1
make climb SEEDS=16 > climb.log 2>&1
make search-check > search.log 2>&1
```

All 12 runs exited 0. Logs are here as `{A,B,C}-{phi,peak,climb,search}.log`.

## Wall-clock

Times include `cargo` compilation. Each worktree had its own `target/`, so each arm's first command also includes the full build. A's first command also includes the crates.io download.

| command | A | B | C |
|---|---|---|---|
| phi-stats | 8m47s | 8m56s | 9m09s |
| norm-peak | 1m12s | 1m16s | 1m20s |
| climb SEEDS=16 | 2h00m28s | 1h51m03s | 2h03m54s |
| search-check | 2h36m55s | 2h40m35s | 2h49m39s ¹ |

¹ The container restarted during C's first search-check run, which was killed inside measurement 4. The partial output is kept as `C-search.interrupted.log`. `C-search.log` is a complete rerun of the same command on the same commit, and the time shown is for that rerun.

## Climb (`make climb SEEDS=16`), paired over the same 16 seeds

Gain = final-generation pool mean true utility minus generation 0, per seed.

- The trimmed mean drops the single highest and lowest seed (n = 14), the same cut as the harness. The A, B and C per-arm figures match the harness's own printed lines.
- "best final max u" is the highest final-generation pool max over the 16 seeds.
- Paired differences are taken per seed. Their se is the sample stdev over √16.

| arm | mean gain ± se | median | 10% trimmed ± se (n=14) | climbed | mean final max u | best final max u (seed) |
|---|---|---|---|---|---|---|
| A | +2.175 ± 0.297 | +2.170 | +2.102 ± 0.207 | 16/16 | 7.526 | 9.667 (140b) |
| B | +2.321 ± 0.370 | +2.532 | +2.303 ± 0.279 | 15/16 | 7.697 | 10.749 (1b12) |
| C | +1.963 ± 0.765 | +2.745 | +2.513 ± 0.350 | 14/16 | 8.059 | 11.192 (1b12) |

| paired diff | mean ± se | median | 10% trimmed ± se (n=14) | seeds better / worse | mean Δ final max u ± se |
|---|---|---|---|---|---|
| B−A | +0.146 ± 0.241 | +0.166 | +0.231 ± 0.159 | 9 / 6 | +0.172 ± 0.247 |
| C−A | -0.212 ± 0.716 | +0.649 | +0.248 ± 0.375 | 9 / 7 | +0.533 ± 0.364 |

| seed | A gain | B gain | C gain | B−A | C−A |
|---|---|---|---|---|---|
| e05 | +2.403 | +3.236 | +3.129 | +0.833 | +0.726 |
| f06 | +1.727 | +3.345 | +1.432 | +1.618 | -0.295 |
| 1007 | +1.368 | +1.278 | +2.694 | -0.090 | +1.326 |
| 1108 | +0.153 | +1.383 | +2.796 | +1.230 | +2.643 |
| 1209 | +0.476 | +1.320 | +3.066 | +0.844 | +2.590 |
| 130a | +1.915 | -0.602 | -0.039 | -2.517 | -1.954 |
| 140b | +3.148 | +3.148 | +4.167 | +0.000 | +1.019 |
| 150c | +1.936 | +1.376 | +2.508 | -0.560 | +0.572 |
| 160d | +1.125 | +0.348 | -8.384 | -0.777 | -9.509 |
| 170e | +2.893 | +3.917 | +4.615 | +1.024 | +1.722 |
| 180f | +2.823 | +2.511 | +1.347 | -0.312 | -1.476 |
| 1910 | +1.677 | +1.873 | +0.736 | +0.196 | -0.941 |
| 1a11 | +2.612 | +2.554 | +1.698 | -0.058 | -0.914 |
| 1b12 | +5.212 | +5.487 | +3.860 | +0.275 | -1.352 |
| 1c13 | +2.784 | +3.275 | +3.549 | +0.491 | +0.765 |
| 1d14 | +2.544 | +2.681 | +4.234 | +0.137 | +1.690 |

### Noise

The harness doc gives se ≈ 0.64 on a 16-seed mean gain. The paired standard errors measured here are 0.241 for B−A and 0.716 for C−A.

- **B−A.** Mean +0.146 ± 0.241 (0.6 se). Trimmed +0.231 ± 0.159 (1.5 se). Median +0.166. Mean Δ final max +0.172 ± 0.247 (0.7 se). **Every one is within noise, under 2 se.**
- **C−A.** Mean −0.212 ± 0.716 (0.3 se). Trimmed +0.248 ± 0.375 (0.7 se). Median +0.649. Mean Δ final max +0.533 ± 0.364 (1.5 se). **Every one is within noise, under 2 se.**
  - Mean and trimmed mean point in opposite directions. The gap comes from seed `160d` (C gain −8.384, C−A −9.509), which the trimmed mean drops.
  - C's per-arm se on the mean gain (0.765) is more than twice A's (0.297) for the same reason.

## search-check headline numbers

Measurement 1 in search-check uses the shipped config's seed count: 6 seeds, and it prints no se. Its gain is therefore noisier than the 16-seed climb above.

| measurement | A | B | C | B−A | C−A |
|---|---|---|---|---|---|
| 1. mean gain over 6 gens | +1.340 | +1.660 | +2.180 | +0.320 | +0.840 |
| 1. climbed | 6/6 | 5/6 | 5/6 | −1 | −1 |
| 1. gen-0 max u | 5.801 | 5.820 | 5.801 | +0.019 | 0.000 |
| 1. gen-6 max u | 7.214 | 6.939 | 7.863 | −0.275 | +0.649 |
| 2. mean trace sites / seed | 35.6 | 33.6 | 37.5 | −2.0 | +1.9 |
| 2. MH acceptance (exact) | 47.1% | 46.6% | 48.5% | −0.5 pt | +1.4 pt |
| 2. structural share of accepted | 29.7% | 29.4% | 31.1% | −0.3 pt | +1.4 pt |
| 2. est. structural / parameter acceptance | 42% / 50% | 42% / 49% | 45% / 50% | 0 / −1 pt | +3 / 0 pt |
| 4. fitted vs true (spearman) | 0.339 | 0.413 | 0.358 | +0.074 | +0.019 |
| 4. fitted ranking across refits | 0.561 | 0.542 | 0.543 | −0.019 | −0.018 |
| 4. true-best survived | 36/36 | 36/36 | 36/36 | 0 | 0 |
| 3. locked refine beat parent @20 | 31/48 | 30/48 | 26/48 | −1 | −5 |
| 3. locked refine beat parent @40 (shipped) | 30/48 | 31/48 | 29/48 | +1 | −1 |
| 3. locked refine beat parent @80 | 36/48 | 38/48 | 25/48 | +2 | −11 |
| 3. locked refine beat parent @160 | 36/48 | 36/48 | 38/48 | 0 | +2 |
| 3. landed (all step counts) | 48/48 | 48/48 | 48/48 | 0 | 0 |

The search-check log prints no standard errors, so none are given for these differences.

## phi-stats and norm-peak

- **norm-peak.** The output after the build lines is byte-identical across A, B and C:
  - 144/150 featurized
  - peak p50 0.623
  - 0/144 over the ceiling
  - 28/144 pulled down, mean 2.9 dB, worst 12.2 dB
- **phi-stats, composition and pipeline sections.** Identical across all three arms:
  - mean size 3.07, trace sites 27.2
  - 1168/1200 featurized
  - base quarantine rate 2.7%
- **phi-stats, feature and VIF tables.**
  - **A vs B:** these differ in two VIF rows by 0.1 (`attack_s:p2` 5.0→5.1, `crest:p2` 3.1→3.0).
  - **A vs C:** C adds `motion_slow:p2`, `motion_mid:p2` and `motion_fast:p2`, which takes the feature table from 42 to 45 rows. In C their VIFs are 2.7, 3.8 and 3.6.
    - The top VIF is `rolloff_mean:p2` in every arm: 16.1 in A and B, 16.2 in C. It is the only row flagged collinear.
    - Other VIFs in C shift by up to +0.8 (`attack_s:p2` 5.0→5.8).
