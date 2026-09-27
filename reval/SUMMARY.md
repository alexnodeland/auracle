# Revalidation — PR #59 (stack audit)

Commit: `334b3a9a104fab02ebb3aff352a6525bf6bcecd5`

All four targets ran one after another on a 4-core container, invoked exactly as the Makefile defines them. The code was not changed. Each target's full output is in `reval/<target>.txt`, and `reval/timings.txt` has the raw exit codes and wall times.

| target | command | exit | wall time |
|---|---|---|---|
| phi-stats | `make phi-stats` | 0 | 353 s (5m 53s) |
| norm-peak | `make norm-peak` | 0 | 51 s |
| climb | `make climb SEEDS=16` | 0 | 4336 s (1h 12m 16s) |
| search-check | `make search-check` | 0 | 6238 s (1h 43m 58s) |

Wall times include cargo compile time: 1m 04s for phi-stats, 15 s for norm-peak and 27 s for climb.

## phi-stats (`pipeline_stats 1200`)
- Composition over 2000 prior draws: mean size 3.07, mean depth 2.54, mean trace sites 27.2, mod slots filled 56.0%, mean mod-tree depth 1.117, patches with a shaped mod term 19.4%.
- Per-patch totals: sources 1.343, ops 1.722, mods 1.759, modops 0.123, pairops 0.046.
- Pipeline over 1200 draws: **featurized 1168 (97%)**. Quarantined: silent=30, overlevel=0, dc=2, nonfinite=0. **Base quarantine rate 2.7%.**
- The highest per-kind quarantine rates were formant 5.5% (+2.8 vs base) and filter 5.4% (+2.7). The full per-kind and per-feature tables are in `phi-stats.txt`.

## norm-peak (`norm_peak 150`)
- Featurized 144/150.
- Peak: min 0.103, p50 0.623, p90 1.000, p99 1.000, max 1.000 (ceiling 1.00).
- Over ceiling: 0/144 (0%). Over 1.25: 0/144 (0%).
- Pulled down to clear the ceiling: 28/144 (19%), mean 2.9 dB, worst 12.2 dB.

## climb (`search_health --climb 16`)
Pool 48, 60 duels, 6 generations, 16 seeds.

| gen | mean u | max u | Δ mean |
|---|---|---|---|
| 0 | -0.000 | 5.374 | — |
| 1 | 0.758 | 6.166 | +0.758 |
| 2 | 1.391 | 6.670 | +0.633 |
| 3 | 1.846 | 6.886 | +0.455 |
| 4 | 2.122 | 7.403 | +0.276 |
| 5 | 2.243 | 7.765 | +0.121 |
| 6 | 2.321 | 7.697 | +0.078 |

- **Mean gain: +2.321 ± 0.370 (se); climbed on 15/16 seeds.**
- Median gain +2.532. 10% trimmed mean +2.303 ± 0.279 (se, n=14).
- **Best patch found: final max u = 10.749, on seed `1b12`.** That seed also had the largest gain, +5.487. The example prints only utilities per seed, not the patch itself.
- Worst seed: `130a`, gain -0.602. It is the only seed that did not climb.

## search-check (`search_health`, full battery)
The Makefile comment says "all five measurements", but the output has only sections 1–4, printed in the order 1, 2, 4, 3. The four tables are reproduced as printed:

**1. Pool true utility per refinement generation** (pool 48, 60 duels, 6 generations, refine_steps/seeds from config)

| gen | mean u | max u | Δ mean |
|---|---|---|---|
| 0 | -0.000 | 5.820 | — |
| 1 | 0.649 | 6.075 | +0.649 |
| 2 | 1.319 | 6.621 | +0.671 |
| 3 | 1.758 | 6.722 | +0.438 |
| 4 | 1.968 | 7.034 | +0.211 |
| 5 | 1.886 | 7.372 | -0.082 |
| 6 | 1.660 | 6.939 | -0.226 |

Mean gain over 6 generations: +1.660. Climbed on 5/6 seeds. The mean falls in generations 5 and 6.

**2. MH proposals**
- Mean trace sites per refinement seed: 33.6.
- Overall acceptance: 5597/12000 = 46.6% (kernel target 44%).
- Structural share of accepted proposals: 1643/5597 = 29.4%. Structural sites are 32.5% of all sites, which is about 3901 structural proposals out of 12000.
- Estimated structural acceptance 42%, estimated parameter acceptance 49%.

**4. Does eviction keep what is good?**
- Fitted vs true utility (spearman): 0.413.
- Fitted ranking across refits: 0.542.
- True-best survived the generation: 36/36 = 100%.

**3. Locked refine_from hit rate** (a third of each seed's knobs locked at random)

| steps | landed | rate | beat parent | rate |
|---|---|---|---|---|
| 20 | 48/48 | 100% | 30/48 | 62% |
| *40 | 48/48 | 100% | 31/48 | 65% |
| 80 | 48/48 | 100% | 38/48 | 79% |
| 160 | 48/48 | 100% | 36/48 | 75% |

(* = shipped `SessionConfig::refine_steps`)
