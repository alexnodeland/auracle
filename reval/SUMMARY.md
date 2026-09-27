# Revalidation — arm `main`

- **Commit:** `9f79b7d` (Design review: the instrument this could be — musicality, UX, and applications (#58))
- **Machine:** 4 vCPU cloud container
- Targets were run one at a time, in this order, exactly as the Makefile defines them. Each target's full output is in the matching `reval/<target>.txt` file.
- Wall times are measured around each `make` call and include any cargo build. `phi-stats` ran first and includes the one-off crate download and compile of that example; the build step inside each other target took ≤ 25 s.

| target | command | exit | wall time |
|---|---|---|---|
| phi-stats | `make phi-stats` | 0 | 375 s (6m15s) |
| norm-peak | `make norm-peak` | 0 | 54 s |
| climb | `make climb SEEDS=16` | 0 | 5197 s (1h26m37s) |
| search-check | `make search-check` | 0 | 6887 s (1h54m47s) |

## phi-stats (`pipeline_stats 1200`)
- Composition over 2000 prior draws: mean size 3.07, mean depth 2.54, mean trace sites 27.2, mod slots filled 56.0%, shaped mod term in 19.4% of patches.
- Pipeline over 1200 prior draws: **featurized 1168 (97%)**. Quarantined: silent=30, overlevel=0, dc=2, nonfinite=0. **Base quarantine rate 2.7%**.
- Flagged as silenced: `duck` (15.4% quarantine, +12.7 over base). Kinds with few samples (n≈8–10) show as outliers too: `min`, `max`, `or` at 12.5% each.
- Only VIF flag: `rolloff_mean:p2` at **16.1** (collinear). Next highest are `zcr_mean:p2` at 9.5 and `centroid_std:p2` at 7.8.

## norm-peak (`norm_peak 150`)
- Featurized 144/150.
- Peak: min 0.103, p50 0.623, p90 1.000, p99 1.000, max 1.000 (ceiling 1.00).
- **Over ceiling: 0/144 (0%)**. Over 1.25: 0/144.
- Pulled down to clear the ceiling: 28/144 (19%), mean 2.9 dB, worst 12.2 dB.

## climb (`search_health --climb 16`)
Pool 48, 60 duels, 6 generations, 16 seeds.

- **Mean gain: +2.175 ± 0.297 (se), climbed on 16/16 seeds**
- Median gain +2.169. 10% trimmed mean +2.102 ± 0.207 (se, n=14).
- Pool mean peaks at gen 5 (2.248) and then slips to 2.175 at gen 6 (Δ −0.074).
- **Best patch found: true utility 9.667** (seed `140b`, final max). Next best: 9.262 (`1007`) and 9.193 (`1b12`).
- Highest pool max across seeds, per generation: 7.631 at gen 5 and 7.526 at gen 6.
- Largest per-seed gain: +5.212 (`1b12`). Smallest: +0.153 (`1108`).

## search-check (`search_health`, default 6 seeds)
Note: the Makefile describes this target as "all five measurements". Without flags, however, the example prints only sections 1–4. Section 5, the routing listener, runs only with `--routing`. The section order printed is 1, 2, 4, 3.

**1. Pool true utility per refinement generation** (pool 48, 60 duels, 6 generations)

| gen | mean u | max u | Δ mean |
|---|---|---|---|
| 0 | -0.000 | 5.801 | — |
| 1 | 0.799 | 6.409 | +0.799 |
| 2 | 1.489 | 6.674 | +0.690 |
| 3 | 1.999 | 6.995 | +0.509 |
| 4 | 2.121 | 7.171 | +0.123 |
| 5 | 1.915 | 7.214 | -0.207 |
| 6 | 1.340 | 7.214 | -0.574 |

Mean gain over 6 generations: **+1.340**, climbed on 6/6 seeds. The pool mean peaks at gen 4 and then falls by 0.78 over the last two generations.

**2. MH proposals**
- Mean trace sites per refinement seed: 35.6
- Overall acceptance: 5654/12000 = **47.1%** (kernel target 44%)
- Structural share of accepted: 1681/5654 = 29.7%. Structural sites are 33.3% of all sites (≈3990 of 12000 proposals).
- Estimated acceptance: structural 42%, parameter 50%.

**4. Does eviction keep what is good?**
- Fitted vs true utility (Spearman): **0.339**
- Fitted ranking across refits: 0.561
- True-best survived the generation: 36/36 = 100%

**3. Locked `refine_from` hit rate** (a third of the knobs locked)

| steps | landed | rate | beat parent | rate |
|---|---|---|---|---|
| 20 | 48/48 | 100% | 31/48 | 65% |
| *40 | 48/48 | 100% | 30/48 | 62% |
| 80 | 48/48 | 100% | 36/48 | 75% |
| 160 | 48/48 | 100% | 36/48 | 75% |

(* = shipped `SessionConfig::refine_steps`)
