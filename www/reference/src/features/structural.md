# φ_struct — structural descriptors

<p class="lede">Twenty-five dimensions, free to compute.</p>

These cost nothing: no compile, no render, just a walk of the term. That is
what makes the [screening
cascade](../search/refinement.md#the-screening-cascade) possible: a
structure-only surrogate prunes candidates before the expensive render path.
They also capture taste axes audio features cannot fully separate ("likes
supersaws", "likes deep modulated chains").

## The coordinates

**Fourteen family counts:**

```text
n_vco  n_supersaw  n_noise  n_wavetable  n_pluck  n_formant
n_filter  n_drive  n_time  n_mod_fx  n_reverb  n_dynamics
n_lfo  n_env  n_rand  n_follow  n_mod_shape  n_mod_logic
```

**Seven term-level numbers:**

```text
mod_density  mod_depth_mean  amp_attack  amp_sustain  amp_release
chain_balance  frac_sidechained
```

Twenty-five in total, appended after the [fifteen audio
coordinates](./audio.md) to give $\varphi \in \R^{40}$.

## Families, not one column per module

`StructFeatures` keeps a raw counter per module kind internally (the Styles tab
and the auto-namer both want "two filters", not "two subtractive stages"), but
`NAMES` and `to_vec` collapse **forty-one module kinds into fourteen family
counts**.

Two reasons.

**Nothing meaningful distinguishes them.** `n_fold`, `n_distortion` and
`n_bitcrush` all answer "how much nonlinear colour". `n_chorus`, `n_phaser`,
`n_flanger`, `n_tremolo` and `n_vibrato` all answer "how much periodic
movement". A user who likes drive does not first decide *which* drive.

**Per-kind columns arrive as near-indicator variables.** The prior draws
bitcrush at 2.5%, ring mod at 2% and granular at 1.5%, so those columns are
zero in ~19 of every 20 pool members. A coefficient fitted on a column that is
almost always zero is estimated from a handful of rows, and the Styles tab
would render it beside coefficients fitted on hundreds, at the same visual
weight.

Measured over 1200 draws, the extreme case: each of the four CV processors
appears in under 4% of patches and each of the six combiners in **under 1%**. A
column that is zero in 99 rows of every 100 is not a coefficient, it is a
rounding error with a name in the UI.

Sixteen sparse columns would also cost sixteen dimensions of posterior variance
for the cold start to pay down before the model says anything at all.

## What is deliberately not in φ

### `size`, an exact identity

Every audio node increments exactly one raw counter, so

$$\text{size} \equiv \sum_i n_i \qquad\text{exactly, for every tree}$$

Including it makes the design matrix **rank-deficient**. The Gaussian prior
keeps the posterior proper, so nothing crashes and no test fails, but there is
an unidentified ridge along which the MH chain random-walks forever. That
wrecks mixing, splits each coefficient arbitrarily between `size` and the
counts (so the per-feature weights the Styles tab renders mean nothing
*individually*), and poisons the
[taste→grammar proposal tilt](../search/proposals.md), which reads exactly those
coefficients.

`size − depth` would be no better: still an exact linear combination of
coordinates already present.

The field is kept for display and naming. It just never reaches the model.

### A second, subtler identity

Dropping `size` alone was **not enough**, and a VIF sweep caught it: VIF
$\approx 10^9$ on every column involved, which is what an exact dependency
looks like numerically.

A tree is a forest of source leaves joined by productions that each take some
number of audio children, so the leaf count exceeds the total branch count by
exactly one:

$$
n_{\text{vco}} + n_{\text{supersaw}} + n_{\text{noise}} + n_{\text{wavetable}}
+ n_{\text{pluck}} + n_{\text{formant}} + n_{\text{silence}}
$$
$$
{} - n_{\text{mix}} - n_{\text{ringmod}} - n_{\text{comp}} - n_{\text{duck}} -
n_{\text{gate}} - n_{\text{vocoder}} \;=\; 1
$$

`Silence` joins that sum as a source leaf, because that is what it is: it has
no children, so it ends a branch exactly as a `Vco` does. Joining keeps this
**one** equation with **one** dropped column, and $n_{\text{mix}}$ stays the
column dropped. Leaving it outside instead would make the identity exact for a
tree with no holes and slack for one with them — near-exact almost always,
which is a worse thing to carry than an exact dependency: an exact one is
unmistakable in a VIF sweep, and a near-exact one is a large number that looks
like a judgment call.

exactly, for every tree. This only became a *general* statement when the four
dynamics productions arrived, each taking two audio subterms exactly as mix and
ring mod do.

That is **one** equation, so exactly **one** column has to go, and dropping
more would remove real dimensions rather than redundant ones. With both binary
counts gone, $\varphi$ could not tell a crossfade from a ring modulator at all,
which are about as different as two nodes in this grammar get.

So `n_mix` leaves: it is the one determined by the others, and its proposal
tilt is recovered from the source coefficients in the engine's `biased_prior`.
The other five stay, but **never as columns of their own**: ring mod lives
inside `n_drive`, the vocoder inside `n_filter`, and comp/duck/gate inside
`n_dynamics`.

### Why `n_dynamics` is still safe

Worth checking rather than assuming, because `n_dynamics` is *exactly*
$n_{\text{comp}} + n_{\text{duck}} + n_{\text{gate}}$ and it is a **retained**
column, the only family whose members are all on the wrong side of the
identity.

It is safe because the identity needs each binary count **separately**.
`n_ringmod` is only ever visible summed with folds, distortions and
bitcrushers; `n_vocoder` only summed with filters and EQs. No linear
combination of the retained columns isolates either, so the equation cannot be
reconstructed. `n_dynamics` supplies three of the six binary terms and nothing
supplies the other three.

Confirmed empirically: on the 1200-draw sweep every structural coordinate came
back well under 10, with `n_dynamics` at **1.9**.

### `depth`, a weaker but real argument

VIF $\approx 21.7$. Not exact, so the posterior stays proper, but a coefficient
that unstable is not individually meaningful, and the Styles tab renders these
per-feature weights as though they were. Dropped.

## Health of the retained set

Every family coordinate came back **under 4** on the 1200-draw sweep, the
highest being `mod_depth_mean` at 3.8. That is the reason the families exist;
forty separate module columns would not have managed it.

The three most recent additions: `n_mod_shape` 1.6, `n_mod_logic` 1.3,
`mod_depth_mean` 3.8, with `mod_density` rising from 2.7 to 4.1 as the one
visible cost of adding a second modulation-shape coordinate beside it.

Reproduce with:

```bash
cargo run -p auracle-features --example pipeline_stats --release -- 1200
```

## The unit coordinates

Seven of the twenty-five are `UNIT_NAMES`, a **subset** of `NAMES` rather than
a reordering. Each is either a normalized genome site read straight through
(`amp_attack`, `amp_sustain`, `amp_release`, `mod_depth_mean`) or a ratio that
is already in $[0,1]$ (`mod_density`, `chain_balance`, `frac_sidechained`).

The distinction matters for display: these can be rendered as percentages
honestly, whereas a family count cannot.

`amp_sustain` is also the coordinate the `1e30` sentinel killed; see
[the sentinel](../genome/parameters.md#the-sentinel-incident).
