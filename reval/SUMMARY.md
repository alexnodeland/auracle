# Revalidation: PR #60 (PERFORM: motion bands + Steps leaf; merges in PR #59)

Commit: `74ce1bcbbeb29f6ebb0793156c40a00a8ccafe14`

The targets ran one after another on a 4-core container, with no code changes. Every target exited with code 0.

| target | command | wall time |
|---|---|---|
| phi-stats | `make phi-stats` | 445 s (7m25s; includes the cold build: crate download plus 1m06s compile) |
| norm-peak | `make norm-peak` | 64 s |
| climb | `make climb SEEDS=16` | 5868 s (1h37m48s) |
| search-check | `make search-check` | 9762 s (2h42m42s) |

Full output for each target is in `reval/<target>.txt`.

## phi-stats (`pipeline_stats 1200`)
- Composition over 2000 prior draws: mean size 3.16, depth 2.61, trace sites 28.7, mod slots filled 58.7%. `steps` mod leaf: 0.091 per patch, present in 8.8% of patches.
- Pipeline over 1200 draws: featurized 1168 (97%). Quarantined: silent=31, overlevel=0, dc=1, nonfinite=0. Base quarantine rate 2.7%.
- One kind is flagged `<-- silenced`: `xor` (13 patches, 15.4%, +12.7 over the base rate). `steps` is at 4.3% (+1.7).

## norm-peak (`norm_peak 150`)
- featurized 143/150
- peak: min 0.058, p50 0.553, p90 1.000, p99 1.000, max 1.000 (ceiling 1.00)
- over ceiling: 0/143. Over 1.25: 0/143.
- pulled down to clear the ceiling: 16/143 (11%), mean 3.8 dB, worst 8.9 dB

## climb (`search_health --climb 16`)
- Pool 48, 60 duels, 6 generations, 16 seeds
- **Mean gain: +2.080 ± 0.450 (se)**, climbed on 15/16 seeds
- Median gain +2.200. 10% trimmed mean +2.230 ± 0.303 (se, n=14).
- **Best patch found:** true utility **9.888**, the final max for seed `1d14`. The runner prints only utilities, not the patch itself. The highest final max for each generation, pooled across seeds, went 5.235 → 7.822.
- The one seed that lost ground: `160d`, gain −2.806.

## search-check (`search_health`, full battery)
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

== 2. MH proposals ==
mean trace sites per refinement seed: 44.6
overall acceptance (exact):        5938/12000 = 49.5%   (kernel target 44%)
structural share of accepted (exact): 1875/5938 = 31.6%
structural sites are 33.4% of all sites, so ~4010 of 12000 proposals were structural
  estimated structural acceptance: 47%     estimated parameter acceptance: 51%

== 4. does eviction keep what is good? ==
  fitted vs true utility (spearman):  0.333
  fitted ranking across refits:       0.600
  true-best survived the generation:   36/36 = 100%

== 3. locked refine_from hit rate ==
steps          landed     rate    beat parent     rate
 20             48/48     100%          29/48      60%
*40             48/48     100%          36/48      75%
 80             48/48     100%          33/48      69%
 160            48/48     100%          35/48      73%
(* = shipped SessionConfig::refine_steps)
```
