# φ_audio — perceptual descriptors

<p class="lede">Fifteen dimensions, kept compact and put on axes a
<em>linear</em> model can express a preference along.</p>

Computed on Hann-windowed frames of the normalized mono render (**2048 samples,
50% hop**), plus a few time-domain and segment-local measurements. Every field
is finite by construction, because [vetting](../audition/vetting.md) ran first.

## The coordinates

| # | Name | Is |
|---|---|---|
| 0 | `centroid_mean:p2` | Mean spectral centroid on the log axis — **brightness** |
| 1 | `centroid_std:p2` | SD of that centroid over frames — timbral movement, in octaves |
| 2 | `rolloff_mean:p2` | Mean 85% spectral rolloff, log axis |
| 3 | `flatness_mean:p2` | Mean spectral flatness — 0 tonal … 1 noisy |
| 4 | `flux_mean:p2` | Mean spectral flux — how fast the spectrum changes |
| 5 | `zcr_mean:p2` | Zero-crossing rate as an equivalent frequency, log axis |
| 6 | `rms_mean:p2` | Mean frame RMS |
| 7 | `rms_std:p2` | SD of frame RMS — dynamics |
| 8 | `crest:p2` | $\log$ crest factor |
| 9 | `attack_s:p2` | $\log(\text{attack} + 5\,\text{ms})$ of the first note |
| 10 | `tail_ratio:p2` | $\log$ tail level relative to whole-phrase RMS |
| 11 | `bass_fraction:p2` | Energy fraction below ~250 Hz |
| 12 | `held_centroid_std:p2` | Centroid SD over **the held note's** gate-on span only |
| 13 | `high_ratio:p2` | $\log$ RMS of the **highest note's** span, relative to the held note's |
| 14 | `chord_flatness_delta:p2` | Flatness over the **chord note's** span, minus the held note's |

The `:p2` suffix is the [stimulus generation
tag](../audition/phrase.md#the-p2-stimulus-tag), and it is the migration
mechanism rather than a comment.

## Why these axes and not the obvious ones

The model downstream is **linear in $\varphi$**, so the axis a feature lives on
decides what preferences are *expressible at all*.

### Frequency features are logarithmic, not linear in Hz

Brightness and pitch perception are octave-based. On a linear-Hz axis
normalized by Nyquist, moving a patch from 200 Hz to 400 Hz (a full octave, an
enormous audible change) shifts the coordinate by **0.009**, while 8 kHz → 16
kHz shifts it by **0.36**.

A linear model in that coordinate cannot represent *"I like my basses a shade
brighter"*: the entire usable range is swallowed by the bright tail of the
pool. The preference is not hard to learn, it is **inexpressible**.

<figure class="viz" data-viz="log-axis">
<figcaption><strong>Drag the low note, or use the two presets.</strong> Both rows
place a frequency by ear, with the same distance meaning the same interval, but
they report different <em>coordinates</em>. On the linear axis one octave is
worth forty times more at the top of the spectrum than at the bottom, so a
single weight cannot mean "brighter" in both places. On the log axis an octave
is an octave, which is what makes the coordinate weightable at
all.</figcaption>
</figure>

So `log_axis` puts centroid, rolloff and ZCR on a shared **octaves-above-20
Hz** scale, normalized to $[0,1]$ at Nyquist:

$$\text{log\_axis}(f) = \frac{\log_2\!\big(\max(f, f_0)/f_0\big)}{\log_2\!\big(\max(f_{\text{Nyq}}, 2f_0)/f_0\big)}, \qquad f_0 = 20\ \text{Hz}$$

20 Hz because below it frequency is not audible as pitch and the ratio scale
stops meaning anything. Normalizing at Nyquist keeps the vector sample-rate
agnostic.

Note that a zero-crossing rate **is** a frequency (two crossings per cycle), so
it goes on the same axis:

$$\text{zcr\_mean} = \text{log\_axis}\!\left(\frac{r \cdot f_s}{2}\right)$$

where $r$ is the crossing fraction. Leaving it as a raw fraction would put a
frequency-like quantity on a non-frequency axis beside three that are on one.

### Heavy tails are logged

`crest` spans 1 to 40+; `tail_ratio` spans three orders of magnitude.
Standardizing either raw hands the model a coordinate whose z-score is
near-constant for most of the pool and $+4$ for a handful of outliers: a
coordinate that separates nothing except the outliers.

$$\text{crest} = \log\!\frac{\text{peak}}{\text{RMS} + \epsilon}, \qquad
\text{tail\_ratio} = \log\!\left(\frac{\text{RMS}_{\text{last 300
ms}}}{\text{RMS} + \epsilon} + 10^{-3}\right)$$

The $10^{-3}$ floor inside the tail log matters: a pluck fully decayed by the
last 300 ms would otherwise send the log to $-\infty$, and *"silent tail"* and
*"very quiet tail"* are the same judgement to a listener anyway.

### The attack crossing is interpolated, not floored

Quantizing the 90%-of-peak crossing to the analysis-window index makes
`attack_s` **exactly zero** for every patch whose first window is already at
peak (most percussive patches), turning a continuous axis into a zero-inflated
spike.

So the envelope uses a fine grid (**4 ms window, 1 ms hop**) and interpolates
linearly between the last sub-threshold hop and the first one over it:

$$
h^\star = (i-1) + \frac{0.9\,\max(e) - e_{i-1}}{e_i - e_{i-1}}, \qquad
\text{attack\_s} = \log\!\left(\frac{h^\star \cdot \text{hop}}{f_s} +
0.005\right)
$$

The measurement window is onset → **the second note's onset** (2.0 s under the
v2 phrase), and the $+5$ ms inside the log keeps the fast end resolved instead
of compressing every percussive patch into the same value.

## Spectral definitions

Per frame, with magnitudes $m_i$ over $\text{bins} = 1024$ and $\text{power} =
\sum m_i^2$:

**Centroid.** The magnitude-weighted mean frequency, then log-axised:

$$f_c = \frac{\sum_i i \cdot \Delta f \cdot m_i}{\sum_i m_i}$$

**Rolloff.** The lowest bin at which cumulative *power* reaches 85% of the
total.

**Flatness.** Geometric over arithmetic mean of the power spectrum, clamped to
1:

$$\text{flatness} = \min\!\left(1,\ \frac{\exp\!\big(\tfrac{1}{N}\sum_i \log(m_i^2 + \epsilon)\big)}{\tfrac{1}{N}\sum_i m_i^2 + \epsilon}\right)$$

**Flux.** Normalized by the **combined** magnitude sum of both frames:

$$\text{flux} = \frac{\lVert m^{(t)} - m^{(t-1)} \rVert_2}{\sum_i m^{(t)}_i + \sum_i m^{(t-1)}_i + \epsilon}$$

Dividing by the current frame alone is the obvious choice and it explodes: a
loud frame decaying into near-silence gives an enormous flux for a change that
is barely audible. The combined denominator keeps it in roughly $[0,1]$.

Frames whose power is below $10^{-12}$ contribute to none of the spectral
means: a silent frame has no centroid, and averaging in a zero would drag
brightness down in proportion to how much silence the phrase happens to
contain.

## Segment-local coordinates

The last three are measured over **one note's gate-on span**, and they exist
because whole-phrase statistics conflate things a listener does not.

Roles are found by **property, not position**, which is what keeps them
meaningful if the phrase changes:

- **held**: the first note.
- **high**: the highest note at least half an octave above the held one.
- **chord**: the first note with chord voices.

A phrase missing a role yields **0.0** for its features, which reads as "no
evidence" rather than as a measurement.

**`held_centroid_std`** is the important one. `centroid_std` over the whole
phrase conflates note-to-note register jumps with genuine timbral motion: a
static patch played across two octaves has a large `centroid_std`. Restricted
to the held note's span the coordinate is **register-constant by
construction**, so it is the axis on which "a filter sweeping at 0.4 Hz" and "a
static patch" are different patches at all. It needs at least 3 frames in the
span, or it reports 0.0.

**`high_ratio`** = $\log$ of the high note's span RMS over the held note's.
Does the patch speak in the upper register, or does its filter choke it?

**`chord_flatness_delta`** = mean flatness over the chord span minus the held
span. Intermodulation and mud when voices stack.

## Deliberately compact

Fifteen dimensions is a choice. The model is a mixture of *linear* experts, and
**interpretable axes are the point**: "bright", "noisy", "slow attack", "long
tail" are things the [DIRECTIONS tab](../../docs/views/taste.html#directions)
can name and a person can recognise in their own preferences.

A 128-dimensional MFCC bank would carry more information and would be
unreadable, and would make the cold start dramatically worse: every dimension
is posterior variance to pay down before the model says anything at all.

## Known collinearity

Measured over 1200 prior draws (`cargo run -p auracle-features --example
pipeline_stats --release -- 1200`), the variance inflation factors are mostly
comfortable, with one cluster that is not:

| Coordinate | VIF |
|---|---|
| `rolloff_mean` | ≈ 18.4 |
| `zcr_mean` | ≈ 10.4 |
| `centroid_mean` | ≈ 5.9 |

That is the **brightness cluster** — three genuine measurements of one
perceptual thing. It is left standing deliberately: dropping any of them
discards real signal rather than redundancy, since they disagree in informative
ways (a bright noisy patch and a bright tonal patch differ in
ZCR-versus-centroid). The right fix is a shared or fused prior over the
cluster, which is a modelling change rather than a feature change, and is not
done.

For contrast, [`φ_struct`](./structural.md) had two *exact* linear
dependencies, which is a different and worse problem and was fixed by dropping
columns.
