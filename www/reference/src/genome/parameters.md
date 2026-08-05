# Parameter sites and their domains

<p class="lede">Every continuous knob in the genome is a draw from
$\mathrm{Uniform}(0,1)$. The musical meaning is the compiler's job.</p>

## One domain, everywhere

```rust
pub const PARAM_DOMAIN: std::ops::RangeInclusive<f64> = 0.0..=1.0;

pub fn in_domain(v: f64) -> bool {
    v.is_finite() && PARAM_DOMAIN.contains(&v)
}
```

Every continuous site is normalized to $[0,1]$ and the mapping to Hz, seconds,
dB or cents happens in the compiler. Three things fall out of that:

- **The prior is trivially correct.** $\mathrm{Uniform}(0,1)$ at every site,
  with no per-parameter range table to get wrong.
- **A proposal cannot leave the domain.** MH moves are in normalized space.
- **The panel can read in musical units** (`840 Hz`, `24 ms`, `−6.0 dB`, `+12
  ¢`) while the genome stays uniform. The knob and the number under it are two
  representations of the same site.

Note that `in_domain` requires **finite**: `NaN` compares false against every
bound, and an infinity is exactly the runaway the gate exists to stop.

## Bounded by the mapping

Because the mapping is the compiler's, the *musically* dangerous regions are
excluded by how $[0,1]$ is spent rather than by a downstream guard. Filter
resonance maps to a range that stops short of self-oscillation; delay feedback
stops short of 1; V/Oct maps into an audible band.

So the grammar **cannot express the most degenerate settings at all**, which
leaves no pathological region for the search to keep sampling and be penalised
for.

It is not a substitute for [vetting](../audition/vetting.md), which catches
pathology that arises from *composition*: a bounded resonant filter fed by a
bounded distortion fed by a bounded fold can still scream.

## Discrete sites

Uniform categoricals, each with a named domain:

| Site | Domain |
|---|---|
| `#wave` | Waveform: saw, square, triangle, sine |
| `#oct` | Octave offset |
| `#color` | Noise colour |
| `#fkind` | Filter kind |
| `#table` | Wavetable shape |
| `#dmode` | Drive mode: soft, hard, tube |

Plus the structural categoricals (`#src`, `#op`, `#mod`, `#modop`, `#pairop`),
whose orders are the persisted wire format and therefore append-only.

## Enumerating the sites

`domain_violations()` returns every out-of-domain continuous site as `(address,
value)`, in address order. It reads the **trace**, not the term:

```rust
self.to_trace().choices.iter().filter_map(|(a, c)| match c.value {
    ChoiceValue::F64(v) if !in_domain(v) => Some((a.to_string(), v)),
    _ => None,
})
```

The trace enumerates exactly the continuous sites, by construction, from the
same walk the prior samples. A hand-written match over the productions would be
a second table of "which fields are knobs", and the first module somebody
forgot to add to it would be the one the next bad value escaped through.

This is the [address scheme](../architecture/addresses.md) paying for itself:
there is one enumeration of the genome's sites, and it is the one inference
uses.

## Repair, not refusal

`clamp_domains()` pulls every out-of-domain site back in and returns how many
it fixed. `NaN` goes to the domain's midpoint; anything else is clamped.

The asymmetry with the size ceilings is deliberate:

| Violation | Response | Because |
|---|---|---|
| A knob outside $[0,1]$ | **Repaired**, exactly and locally | There is one right answer |
| A term over the module/depth ceilings | **Refused** | Fixing it means deciding which modules to delete |

Repair wins for parameters on product grounds: a saved session that already
contains a bad value must not become an app the player cannot edit, load, or
evolve their way out of. **Corruption must not be load-bearing.**

## The sentinel incident

The gates above are not hypothetical. A shipped session contained `amp.sustain
= 1e30`, an out-of-domain sentinel that had escaped into the genome and then
into the observation log.

What one bad cell did:

1. The value **rendered fine**. The limiter bounds the output, so the audio was
   unremarkable and [vetting](../audition/vetting.md) passed it. The vet gate
   is a gate on the *sound*, not on the term.
2. Its $\varphi$ entered the observation log, with `amp_sustain` $= 10^{30}$.
3. The [standardizer](../features/standardization.md) fit on that column
   produced a mean of $\approx 1.2 \times 10^{29}$ and an SD of $\approx 5.5
   \times 10^{29}$, which standardized **every real patch in the pool** to
   $-0.2 \pm 10^{-30}$.
4. The coordinate was dead. The model could never learn from it again, and the
   belief line still printed a contribution for it.
5. The panel read `SUSTAIN 1200.0 dB`, and the HELD tray printed `1e+30`.

The fixes are at three layers:

- **`clamp_domains` on load**, which repairs the corruption that exists.
- **`FeaturizeError::OutOfDomain`**, which refuses to *measure* a term whose φ
  would be a lie, before spending the render. This is the gate that keeps the
  log clean; every row in the log came through it.
- **Runaway-column detection in the standardizer**, so the *next* escape costs
  a coordinate's precision rather than the coordinate.

Layers 1 and 2 should make layer 3 unnecessary. It exists anyway, because the
value got through everything that was supposed to stop it.

## Budgets

Separately from domains, the search is bounded in size:

| Ceiling | Default |
|---|---|
| Modules | 24 |
| Term depth | 9 |
| Modulation depth | 4 |

Shown in the app as `8/24 modules · 6/9 depth · 1/4 mod depth`. A hand-built
patch past a ceiling is refused, and one *at* a ceiling has no room to grow,
which is a common reason a generation reports "no proposal beat its parent".
