# Revalidation (arm 2) — PR #59

- **Commit:** `334b3a9a104fab02ebb3aff352a6525bf6bcecd5`
- **Machine:** 4 vCPU cloud container; all four targets ran one after another in a single background script. No target failed.

## Wall time

| target | real | user |
|---|---|---|
| `make phi-stats` | 5m37.8s (includes ~1m06s cold build + crate download) | 6m04.0s |
| `make norm-peak` | 0m48.5s | 0m47.7s |
| `make climb SEEDS=16` | 67m17.5s | 261m47.7s |
| `make search-check` | 99m50.4s | 363m32.6s |

## phi-stats headline

```
== composition over 2000 prior draws (no render) ==
mean size 3.07   mean depth 2.54   mean trace sites 27.2   mean mod slots filled 56.0%
mean mod-tree depth 1.117 (over filled slots)   patches with a shaped mod term 19.4%

== pipeline over 1200 prior draws ==
featurized:    1168 (97%)
quarantined:   silent=30 overlevel=0 dc=2 nonfinite=0
base quarantine rate: 2.7%
```
Flags: `duck` quarantined 15.4% (+12.7 vs base, "silenced"); highest VIF `rolloff_mean:p2` 16.1 ("collinear").

## norm-peak headline

```
featurized 144/150
peak: min 0.103  p50 0.623  p90 1.000  p99 1.000  max 1.000   (ceiling 1.00)
over ceiling: 0/144 (0%)   over 1.25 (clips at master 0.8): 0/144 (0%)
pulled down to clear the ceiling: 28/144 (19%)  mean 2.9 dB  worst 12.2 dB
```

## climb (SEEDS=16)

- **Mean gain:** +2.321 ± 0.370 (se). Climbed on 15/16 seeds.
- Median gain +2.532. 10% trimmed mean +2.303 ± 0.279 (se, n=14).
- **Best patch:** the output has no line labelled "best patch". The closest figures are:
  - the pool max at gen 6, averaged over seeds: 7.697 (gen 0: 5.374). No ± is printed for it.
  - the best single seed: `1b12`, final max 10.749, gain +5.487.
- Worst seed: `130a`, gain −0.602 (the only one that did not climb).

```
== 1. pool true utility per refinement generation ==
(pool 48, 60 duels, 6 generations, 16 seeds)
gen        mean u      max u     Δ mean
0          -0.000      5.374          —
1           0.758      6.166     +0.758
2           1.391      6.670     +0.633
3           1.846      6.886     +0.455
4           2.122      7.403     +0.276
5           2.243      7.765     +0.121
6           2.321      7.697     +0.078
  mean gain: +2.321 ± 0.370 (se)   climbed on 15/16
  median gain: +2.532   10% trimmed: +2.303 ± 0.279 (se, n=14)
seed     final mean  final max       gain
e05           3.236      7.000     +3.236
f06           3.345      7.006     +3.345
1007          1.278      9.262     +1.278
1108          1.383      6.938     +1.383
1209          1.320      7.424     +1.320
130a         -0.602      4.005     -0.602
140b          3.148      9.667     +3.148
150c          1.376      5.956     +1.376
160d          0.348      8.764     +0.348
170e          3.917      8.102     +3.917
180f          2.511      7.675     +2.511
1910          1.873      6.592     +1.873
1a11          2.554      8.361     +2.554
1b12          5.487     10.749     +5.487
1c13          3.275      7.761     +3.275
1d14          2.681      7.896     +2.681
```

## search-check (full output)

Note: the Makefile comment says "all five measurements", but this run printed only sections 1, 2, 4 and 3, in that order. It printed no section 5.

```
== 1. pool true utility per refinement generation ==
(pool 48, 60 duels, 6 generations, refine_steps/seeds from config)
gen        mean u      max u     Δ mean
0          -0.000      5.820          —
1           0.649      6.075     +0.649
2           1.319      6.621     +0.671
3           1.758      6.722     +0.438
4           1.968      7.034     +0.211
5           1.886      7.372     -0.082
6           1.660      6.939     -0.226
  mean gain over 6 generations: +1.660   climbed on 5/6 seeds

== 2. MH proposals (fugue-evo exposes no acceptance or target-site counter) ==
mean trace sites per refinement seed: 33.6
overall acceptance (exact):        5597/12000 = 46.6%   (kernel target 44%)
structural share of accepted (exact): 1643/5597 = 29.4%
structural sites are 32.5% of all sites, so ~3901 of 12000 proposals were structural
  estimated structural acceptance: 42%     estimated parameter acceptance: 49%

== 4. does eviction keep what is good? ==
(fit↔truth: does the model know? · stability: does its ranking hold still?)
  fitted vs true utility (spearman):  0.413
  fitted ranking across refits:       0.542
  true-best survived the generation:   36/36 = 100%

== 3. locked refine_from hit rate ==
(a third of each seed's knobs locked at random; a hit is a new patch that beats the evictee)
steps          landed     rate    beat parent     rate
 20             48/48     100%          30/48      62%
*40             48/48     100%          31/48      65%
 80             48/48     100%          38/48      79%
 160            48/48     100%          36/48      75%
(* = shipped SessionConfig::refine_steps)
```

Raw logs: `phi-stats.txt`, `norm-peak.txt`, `climb.txt`, `search-check.txt`.
