# Standardization

<p class="lede">A Gaussian prior over $\theta$ only makes sense on a common scale. The
fitting of that scale is a view of the data, not the data.</p>

Raw $\varphi$ scales vary wildly: counts 0–5, log-octave axes ~0–1, log crest 0–4. The
standardizer is a per-dimension affine map

$$z_j = \frac{\varphi_j - \mu_j}{s_j}$$

re-fit at **every posterior fit**, over the union of the observation log and the live
pool.

## It persists with the profile, always

$\theta$ is only meaningful relative to the standardization that produced it, so a
[taste profile](../persistence.md) carries **both or neither**. A log without its
standardizer is a set of numbers whose units have been lost.

The log stores **raw** $\varphi$, which is what makes re-fitting safe: a re-fit
standardizer simply re-expresses the same evidence on a scale that still matches where
the pool actually is. Had the log stored z-scores, the scale would be frozen at
whatever the pool looked like on the day each vote was cast.

The inverse map exists for exactly one reason — migrating logs written before raw-φ
logging. A legacy log **plus the standardizer it was written under** *is* the raw data,
just encoded.

## Robustness: a fault detector, not a policy

`Standardizer::fit` is the plain moments **unless a column is provably runaway**. On
clean data it is bit-identical to the naive fit, by construction rather than by luck.

Per column:

1. Drop non-finite cells (a column that is *entirely* non-finite falls back to
   $\mu = 0, s = 1$ — the honest reading of "no usable evidence on this axis").
2. Compute the plain moments $(\mu, s)$.
3. Compute winsorized moments $(\mu_w, s_w)$ with the extreme 2% of each tail pulled in.
4. **Use the winsorized pair only if $s > 10^6 \, s_w$.**

```rust
const WINSOR_TAIL: f64 = 0.02;
const WINSOR_MIN_ROWS: usize = 10;
const RUNAWAY_RATIO: f64 = 1e6;
```

Finally $s_j \gets 1.0$ if $s_j < 10^{-9}$, so a degenerate column standardizes
everything to itself rather than dividing by nothing.

### Why not just winsorize always

Because it was tried first and thrown out, and the measurement is the argument.

Clipping 2% of each tail unconditionally took a 16-seed `search_health --climb` run
from **+1.877 ± 0.362** mean gain, climbing on 15 of 16 seeds, to **+0.204 ± 1.347** on
11 of 16 — with one seed at **−18.2**.

Trimming a real tail is not free. A data-hygiene fix that costs the search a standard
deviation is not a fix. So the clip became a **fault detector**: plain moments unless
the column is provably broken.

### Why the threshold is $10^6$

The first guess was 8×, on the reasoning that clean columns differ "by a factor of order
one". The paired run said otherwise: 15 of 16 seeds came back bit-identical and the
sixteenth went from **+0.12** to **−40.5**.

So the threshold was measured.

```bash
cargo run -p auracle-features --example winsor_ratio --release -- 150
```

fits 150 clean 48-patch pools and reports the largest plain/winsorized $\sigma$ ratio
per column. Over 6 000 column-fits the maximum is **14.6** (`rms_std:p2`), with
`chord_flatness_delta:p2` at 13.9 — and still climbing with the sample, because a
log-scale audio descriptor over a pool that happens to contain one near-silent patch
genuinely *has* a tail.

Meanwhile a single $10^{30}$ in a column whose real values live in $[0,1]$ gives a ratio
near $2 \times 10^{29}$.

$10^6$ sits five orders above anything clean $\varphi$ has been observed to produce and
twenty-three below the fault — which is as far from both edges as this quantity allows
anyone to be.

### The tail size

$$k(n) = \begin{cases}
0 & n < 10 \\
\mathrm{clamp}\big(\lceil 0.02n \rceil,\ 1,\ \lfloor (n-1)/2 \rfloor\big) & n \ge 10
\end{cases}$$

**`ceil`, not `floor`** — and this is how the first version of the rule was rendered
inert exactly where it was needed. The reference population is a 48-patch pool, and
$\lfloor 48 \times 0.02 \rfloor = 0$, so nothing was clipped at the size the app
actually fits at. The pre/post measurement came back bit-identical and said so.

Below 10 rows nothing is winsorized at all: with a handful of values the min and max
*are* the spread, and pulling them in throws away the only information about it.

There is also a `hi > lo` guard, which keeps a legitimately rare column intact: when 96%
of rows are the same value — a module that appears in two patches out of forty-eight —
the tail *is* the column's only information, and clipping it would flatten a real
coordinate to nothing in the name of robustness.

### Winsorizing rather than trimming

When it does fire, the extreme rows are **pulled in**, not dropped. The rows are not
independent draws from a nuisance distribution — they are the patches the player
actually met, and a real extreme patch is evidence about where the pool is. Winsorizing
keeps its vote and takes away only its leverage on the units.

## Two properties, both tested

**A single escaped row cannot kill a column.** Fifty values spread over $[0,1]$ plus one
$10^{30}$: unwinsorized, the outlier owns the mean and the scale, every real patch
standardizes to the same place, and the column is dead — the model can never learn from
an axis whose fifty honest values are separated by $10^{-30}$ of a standard deviation.
The test asserts $\sigma$ moves by less than 0.05 and that the coordinate still
separates two real patches by more than 3.

**Clean columns come out bit-identical to the plain moments.** The load-bearing
property, asserted with `assert_eq!` on floats — deliberately, because "close enough"
would let the regression back in — over a heavy right tail, a near-constant column, a
bipolar one, a count with a legitimately extreme member, and a five-row column below the
floor entirely.

One implementation detail exists to protect that property: the column stays in **row
order** and the quantiles come off a *copy*. Floating-point addition is not associative,
so summing the sorted column would move the mean by a ULP on clean data — and the whole
claim is that clean data comes out bit-identical.

## Where this fits in the defence

The fault this detector exists for is fixed upstream of here — `clamp_domains` on load,
`FeaturizeError::OutOfDomain` before the render, the load-time repair. This is the line
that means **the next** escape costs a coordinate's precision rather than the
coordinate.

That layering is deliberate and slightly uncomfortable: layers above should make this
unnecessary, and it exists anyway, because the whole lesson of
[the sentinel](../genome/parameters.md#the-sentinel-that-motivated-all-of-this) is that
the value got through everything that was supposed to stop it.
