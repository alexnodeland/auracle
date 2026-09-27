# Revalidation run: commit 96a9df1

The four Makefile targets were run one after another, exactly as the Makefile defines them. Each target's full stdout and stderr is in the file of the same name in this directory.

| target | exit | wall |
|---|---|---|
| `make phi-stats` | 0 | 566 s (9.4 min) |
| `make norm-peak` | 0 | 79 s |
| `make climb SEEDS=16` | 0 | 7347 s (2.04 h) |
| `make search-check` | 0 | 11994 s (3.33 h) |

The phi-stats wall time includes the first release build (1m 29s). The machine had 4 cores.

## phi-stats (1200 prior draws)

- **featurized: 1168 / 1200 (97%)**
- quarantined: silent=31, overlevel=0, dc=1, nonfinite=0
- **base quarantine rate: 2.7%**
- The only row flagged `<-- silenced` is `xor`: 2 of 13 draws quarantined, 15.4%, which is +12.7 over base.
- VIF flagged as collinear: `rolloff_mean:p2` at 19.6 and `zcr_mean:p2` at 12.9.

## norm-peak (150 renders)

- featurized 143 / 150
- peak: min 0.058, p50 0.553, p90 0.999, p99 1.000, max 1.000 (ceiling 1.00)
- **over ceiling: 0 / 143 (0%)**
- **over 1.25 (clips at master 0.8): 0 / 143 (0%)**
- pulled down to clear the ceiling: 15 / 143 (10%), mean 3.8 dB, worst 8.9 dB

## climb (SEEDS=16)

Pool true utility per refinement generation (pool 48, 60 duels, 6 generations, 16 seeds):

```
gen        mean u      max u     Δ mean
0          -0.000      5.346          —
1           0.835      6.489     +0.835
2           1.446      6.657     +0.610
3           1.788      7.006     +0.342
4           1.947      7.168     +0.159
5           2.042      7.551     +0.095
6           1.944      7.569     -0.099
```

- **mean gain: +1.944 ± 0.370 (se)**
- **climbed on 16 / 16 seeds**
- median gain: +1.554. The 10% trimmed mean is +1.853 ± 0.320 (se, n=14).

Per-seed gains, as printed:

```
seed     final mean  final max       gain
e05           0.941      6.454     +0.941
f06           1.635      6.146     +1.635
1007          1.472      7.181     +1.472
1108          0.007      6.156     +0.007
1209          0.038      4.463     +0.038
130a          1.320      6.485     +1.320
140b          3.920      7.851     +3.920
150c          2.059      5.910     +2.059
160d          0.328     10.442     +0.328
170e          5.153     12.881     +5.153
180f          2.451      5.952     +2.451
1910          3.695      8.447     +3.695
1a11          3.329      9.671     +3.329
1b12          0.929      7.836     +0.929
1c13          1.348      5.915     +1.348
1d14          2.473      9.305     +2.473
```

## search-check

The Makefile comment calls this "all five measurements", but the output has only four sections, numbered 1, 2, 4 and 3, in that order. There is no section 5. They are shown below in the order they were printed.

### 1. Pool true utility per refinement generation

Pool 48, 60 duels, 6 generations, with refine_steps and refine_seeds taken from the config.

```
gen        mean u      max u     Δ mean
0          -0.000      5.428          —
1           0.683      5.753     +0.683
2           1.092      6.019     +0.409
3           1.306      6.191     +0.214
4           1.330      6.119     +0.025
5           1.177      6.024     -0.154
6           0.902      6.148     -0.275
  mean gain over 6 generations: +0.902   climbed on 6/6 seeds
```

### 2. MH proposals

```
mean trace sites per refinement seed: 45.5
overall acceptance (exact):        5742/12000 = 47.9%   (kernel target 44%)
structural share of accepted (exact): 1771/5742 = 30.8%
structural sites are 32.5% of all sites, so ~3903 of 12000 proposals were structural
  estimated structural acceptance: 45%     estimated parameter acceptance: 49%
```

### 4. Does eviction keep what is good?

```
  fitted vs true utility (spearman):  0.321
  fitted ranking across refits:       0.535
  true-best survived the generation:   36/36 = 100%
```

### 3. Locked refine_from hit rate

A third of each seed's knobs are locked at random. A hit is a new patch that beats the evictee.

```
steps          landed     rate    beat parent     rate
 20             48/48     100%          26/48      54%
*40             48/48     100%          36/48      75%
 80             48/48     100%          38/48      79%
 160            48/48     100%          39/48      81%
(* = shipped SessionConfig::refine_steps)
```
