# Revalidation 2 — PR #60 arm

- **Commit:** `c986709` (fix: red-team pass over tempo sync, the wiring gate and the drift walk)
- No code was changed. The raw logs are in this directory.

## Wall time (`time make …`, real)

| target | real | user |
|---|---|---|
| `make phi-stats` | 9m08.0s (includes a ~1m20s cold build) | 9m53.8s |
| `make norm-peak` | 1m18.0s | 1m16.8s |
| `make climb SEEDS=16` | 120m49.1s | 456m27.0s |
| `make search-check` | 200m03.7s | 712m23.1s |

All four targets ran to completion.

## phi-stats headline (1200 prior draws)

```
mean size 3.16   mean depth 2.61   mean trace sites 28.7   mean mod slots filled 58.7%
mean mod-tree depth 1.094 (over filled slots)   patches with a shaped mod term 18.1%
featurized:    1168 (97%)
quarantined:   silent=31 overlevel=0 dc=1 nonfinite=0
base quarantine rate: 2.7%
xor                 13         15.4%     +12.7  <-- silenced
VIF flags: rolloff_mean:p2 17.1 (collinear), zcr_mean:p2 10.4 (collinear); next highest motion_mid:p2 7.5
```

## norm-peak headline (150 renders)

```
featurized 143/150
peak: min 0.058  p50 0.553  p90 1.000  p99 1.000  max 1.000   (ceiling 1.00)
over ceiling: 0/143 (0%)   over 1.25 (clips at master 0.8): 0/143 (0%)
pulled down to clear the ceiling: 16/143 (11%)  mean 3.8 dB  worst 8.9 dB
```

## climb (SEEDS=16; pool 48, 60 duels, 6 generations)

- **Mean gain:** +2.080 ± 0.450 (se), climbed on 15/16 seeds
- Median gain: +2.200; 10% trimmed: +2.230 ± 0.303 (se, n=14)
- **Best patch** (gen-6 mean of per-seed max u): 7.822 ± 0.274 (se; sd 1.094; range 6.376–9.888).
  *The tool prints no spread for this number. The ± comes from the 16 per-seed `final max` values in `climb.txt`.*
- One seed went down: `160d`, with gain −2.806.

```
gen        mean u      max u     Δ mean
0          -0.000      5.235          —
1           0.778      5.905     +0.778
2           1.361      6.670     +0.583
3           1.717      7.116     +0.355
4           1.912      7.253     +0.195
5           1.982      7.635     +0.070
6           2.080      7.822     +0.098
```

## search-check (full battery)

```
== 1. pool true utility per refinement generation ==
(pool 48, 60 duels, 6 generations, refine_steps/seeds from config)
gen        mean u      max u     Δ mean
0          -0.000      5.269          —
1           0.859      6.284     +0.859
2           1.516      6.775     +0.656
3           1.862      7.179     +0.346
4           1.933      7.543     +0.071
5           2.002      7.835     +0.069
6           2.010      7.835     +0.008
  mean gain over 6 generations: +2.010   climbed on 6/6 seeds

== 2. MH proposals (fugue-evo exposes no acceptance or target-site counter) ==
mean trace sites per refinement seed: 44.6
overall acceptance (exact):        5938/12000 = 49.5%   (kernel target 44%)
structural share of accepted (exact): 1875/5938 = 31.6%
structural sites are 33.4% of all sites, so ~4010 of 12000 proposals were structural
  estimated structural acceptance: 47%     estimated parameter acceptance: 51%

== 4. does eviction keep what is good? ==
(fit↔truth: does the model know? · stability: does its ranking hold still?)
  fitted vs true utility (spearman):  0.333
  fitted ranking across refits:       0.600
  true-best survived the generation:   36/36 = 100%

== 3. locked refine_from hit rate ==
(a third of each seed's knobs locked at random; a hit is a new patch that beats the evictee)
steps          landed     rate    beat parent     rate
 20             48/48     100%          29/48      60%
*40             48/48     100%          36/48      75%
 80             48/48     100%          33/48      69%
 160            48/48     100%          35/48      73%
(* = shipped SessionConfig::refine_steps)
```
