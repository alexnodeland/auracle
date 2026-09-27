# Revalidation (arm: main)

- Commit: `9f79b7db55ac18b2787c7f2243cae44b75f23ee6` (main)
- Run date: 2026-09-27, cloud container. No code changed. All four targets exited successfully.

## Wall time (`time`, `real`)

| target | real | user | note |
|---|---|---|---|
| `make phi-stats` | 5m29.7s | 5m56.2s | includes the cold dependency fetch and build (~1m07s) |
| `make norm-peak` | 0m47.5s | 0m46.4s | incremental build ~14s |
| `make climb SEEDS=16` | 72m11.7s | 273m16.6s | incremental build ~25s |
| `make search-check` | 95m23.4s | 349m37.8s | already built |

## phi-stats (1200 prior draws; composition over 2000)

- composition: mean size 3.07, mean depth 2.54, mean trace sites 27.2, mod slots filled 56.0%, mod-tree depth 1.117, shaped mod term 19.4%
- featurized: 1168/1200 (97%); quarantined: silent=30 overlevel=0 dc=2 nonfinite=0; **base quarantine rate: 2.7%**
- only flagged kind: `duck` 15.4% quarantined (+12.7 vs base) `<-- silenced`
- VIF: only `rolloff_mean:p2` 16.1 is flagged `<-- collinear`; next are zcr_mean 9.5 and centroid_std 7.8

## norm-peak (150 renders)

```
featurized 144/150
peak: min 0.103  p50 0.623  p90 1.000  p99 1.000  max 1.000   (ceiling 1.00)
over ceiling: 0/144 (0%)   over 1.25 (clips at master 0.8): 0/144 (0%)
pulled down to clear the ceiling: 28/144 (19%)  mean 2.9 dB  worst 12.2 dB
```

## climb (SEEDS=16; pool 48, 60 duels, 6 generations)

- **mean gain: +2.175 ± 0.297 (se)**, climbed on 16/16
- median gain +2.169; 10% trimmed +2.102 ± 0.207 (se, n=14)
- **best patch (final max u):** the overall best is 9.667 (seed 140b). The mean over seeds of the final max is 7.526 ± 0.330 (se; sd 1.318, n=16). The program does not print this spread: I computed it from the per-seed table. The seed-averaged gen-6 max printed by the program is 7.526, and the peak of that average was 7.631 at gen 5.
- per-generation mean u: 0.872, 1.500, 1.926, 2.191, 2.248, 2.175 (the step from gen 5 to gen 6 is -0.074)

## search-check (full output)

The target says "all five measurements", but this build printed four sections, in the order 1, 2, 4, 3.

```
== 1. pool true utility per refinement generation ==
(pool 48, 60 duels, 6 generations, refine_steps/seeds from config)
gen        mean u      max u     Δ mean
0          -0.000      5.801          —
1           0.799      6.409     +0.799
2           1.489      6.674     +0.690
3           1.999      6.995     +0.509
4           2.121      7.171     +0.123
5           1.915      7.214     -0.207
6           1.340      7.214     -0.574
  mean gain over 6 generations: +1.340   climbed on 6/6 seeds

== 2. MH proposals (fugue-evo exposes no acceptance or target-site counter) ==
mean trace sites per refinement seed: 35.6
overall acceptance (exact):        5654/12000 = 47.1%   (kernel target 44%)
structural share of accepted (exact): 1681/5654 = 29.7%
structural sites are 33.3% of all sites, so ~3990 of 12000 proposals were structural
  estimated structural acceptance: 42%     estimated parameter acceptance: 50%

== 4. does eviction keep what is good? ==
(fit↔truth: does the model know? · stability: does its ranking hold still?)
  fitted vs true utility (spearman):  0.339
  fitted ranking across refits:       0.561
  true-best survived the generation:   36/36 = 100%

== 3. locked refine_from hit rate ==
(a third of each seed's knobs locked at random; a hit is a new patch that beats the evictee)
steps          landed     rate    beat parent     rate
 20             48/48     100%          31/48      65%
*40             48/48     100%          30/48      62%
 80             48/48     100%          36/48      75%
 160            48/48     100%          36/48      75%
(* = shipped SessionConfig::refine_steps)
```
