# φ_audio: perceptual descriptors

<p class="lede">Eighteen dimensions, kept compact and put on axes a
<em>linear</em> model can express a preference along.</p>

Computed on Hann-windowed frames of the normalized mono render (**2048 samples,
50% hop**), plus a few time-domain and segment-local measurements. Every field
is finite by construction, because [vetting](../audition/vetting.md) ran first.

## The coordinates

| # | Name | Is |
|---|---|---|
| 0 | `centroid_mean:p2` | Mean spectral centroid on the log axis: **brightness** |
| 1 | `centroid_std:p2` | SD of that centroid over frames: timbral movement, in octaves |
| 2 | `rolloff_mean:p2` | Mean 85% spectral rolloff, log axis |
| 3 | `flatness_mean:p2` | Mean spectral flatness: 0 tonal … 1 noisy |
| 4 | `flux_mean:p2` | Mean spectral flux: how fast the spectrum changes |
| 5 | `zcr_mean:p2` | Zero-crossing rate as an equivalent frequency, log axis |
| 6 | `rms_mean:p2` | Mean frame RMS |
| 7 | `rms_std:p2` | SD of frame RMS: dynamics |
| 8 | `crest:p2` | $\log$ crest factor |
| 9 | `attack_s:p2` | $\log(\text{attack} + 5\,\text{ms})$ of the first note |
| 10 | `tail_ratio:p2` | $\log$ tail level relative to whole-phrase RMS |
| 11 | `bass_fraction:p2` | Energy fraction below ~250 Hz |
| 12 | `held_centroid_std:p2` | Centroid SD over **the held note's** gate-on span only |
| 13 | `high_ratio:p2` | $\log$ RMS of the **highest note's** span, relative to the held note's |
| 14 | `chord_flatness_delta:p2` | Flatness over the **chord note's** span, minus the held note's |
| 15 | `motion_slow:p2` | Held-note motion energy, 0.5–2 Hz: **sweeps and breathing** |
| 16 | `motion_mid:p2` | Held-note motion energy, 2–8 Hz: **pulsing and tremolo** |
| 17 | `motion_fast:p2` | Held-note motion energy, 8–30 Hz: **flutter** |

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

A linear model in that coordinate cannot represent *a taste for basses a shade
brighter*: the entire usable range is swallowed by the bright tail of the
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
*"very quiet tail"* are the same judgment to a listener anyway.

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

**Centroid.** The magnitude-weighted mean frequency, then mapped by `log_axis`:

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

## Motion bands

`held_centroid_std` says **how much** a held note moves. It cannot say how
**fast**. Measured on one saw-into-ladder patch under a ladder of cutoff
modulations (`cargo run -p auracle-features --example motion_probe --release`),
a 0.55 Hz sweep and a 13 Hz flutter score 0.098 and 0.094, and stepped random
motion scores like a 6 Hz LFO. A linear model on those coordinates cannot hold
"slow breathing, not fast wobble", which is the first thing anyone says about a
texture.

Hearing sorts fluctuation by **modulation rate**: a filterbank over the
envelope, not just its variance (Dau, Kollmeier & Kohlrausch 1997), and the
band-wise modulation power of a sound is much of what makes it recognizable as
a texture at all (McDermott & Simoncelli 2011). The three coordinates are that
filterbank, cut to three bands.

Motion is measured over the held span, starting once the note has *arrived*, so
the attack is not read as motion. That is 250 ms after onset (`MOTION_SKIP_S`,
in `audio.rs`), or later if the level, smoothed over ≈ 46 ms, has not yet
reached 97% of its peak (`MOTION_ARRIVED`). Two trajectories are taken at a
256-sample hop (`MOTION_HOP`, ≈ 172 frames/s); the spectral features' own
43 frames/s would fold the fast band. One is brightness,
$c_t = \log_2(\text{centroid}_t / 20\,\text{Hz})$, in octaves. The other is
level, $\ell_t = \max(\log_2 \text{RMS}_t,\ \log_2 \text{peak} - 10)$, where one
unit is 6 dB (one doubling, the same currency as an octave of brightness). A dip
reads at most 60 dB deep, so one frame of digital silence in a chopped sound
cannot outweigh every audible wobble.

The arrival rule matters for pads. A 0.9 s swell measured from the fixed 250 ms
alone read 4.3 octaves over the floor in the slow band, because a ramp is
curved in log level and detrending leaves most of it.

Each trajectory is linearly detrended (a ramp across the span is drift, which
`held_centroid_std` already carries), Hann-windowed, and transformed. With $r$ the detrended residual, $\sigma^2_r$ its variance and
$P(f)$ its modulation power spectrum, band $B$ gets the variance share

$$
v_B(r) = \sigma^2_r \cdot \frac{\sum_{f \in B} P(f)}{\sum_{f > 0} P(f)},
\qquad
\texttt{motion}_B = \tfrac12 \log_2\!\big(v_B(c) + v_B(\ell) + 10^{-4}\big).
$$

The result is a log standard deviation in octaves. The floor, $\tfrac12\log_2
10^{-4} \approx -6.64$, is a hundredth of an octave: a static tone reads it
exactly in all three bands, so "still" is one value and not numerical noise. A
phrase whose held span is shorter than 0.75 s reads the floor too.

Measured on the probe ladder, the band that reads highest follows the rate:
0.55 Hz lands in slow, 2.7 Hz in mid, 13 Hz in fast, and stepped random motion
spreads across slow and mid as its spectrum says it should.

### What it cannot say

It does not say whether motion is **regular**. Separating a periodic sweep from
a random walk needs several cycles in the window, and the held span holds fewer
than three cycles of anything in the slow band. Both candidate measures tried
(the normalized autocorrelation peak and the harmonic share of the modulation
spectrum) separate periodic from random cleanly at 2.7 Hz and above, and not
at all below 1.5 Hz, which is exactly where evolving textures live. A
coordinate that guesses there would be taught to the model as a measurement,
so regularity waits for a stimulus with a longer held span.

## Deliberately compact

Eighteen dimensions is a choice. The model is a mixture of *linear* experts, and
**interpretable axes are the point**: "bright", "noisy", "slow attack", and
"long tail" are things the [DIRECTIONS tab](../../docs/views/taste.html#directions)
can name and a person can recognize in their own taste.

A 128-dimensional MFCC bank would carry more information and would be
unreadable, and would make the cold start dramatically worse: every dimension
is posterior variance to pay down before the model says anything at all.

## Known collinearity

Measured over 1,200 prior draws (`cargo run -p auracle-features --example
pipeline_stats --release -- 1200`), the variance inflation factors are mostly
comfortable, with one cluster that is not:

| Coordinate | VIF |
|---|---|
| `rolloff_mean` | ≈ 18.4 |
| `zcr_mean` | ≈ 10.4 |
| `centroid_mean` | ≈ 5.9 |

That is the **brightness cluster**: three genuine measurements of one
perceptual thing. It is left standing deliberately: dropping any of them
discards real signal rather than redundancy, since they disagree in informative
ways (a bright noisy patch and a bright tonal patch differ in
ZCR-versus-centroid). A shared (fused) prior over the cluster would be a
modeling change rather than a feature change. It is built and switched off
(`TasteConfig::fused_rho`, 0 by default): it improved θ recovery on the
closed-loop gate and made the climb worse, as
[Open questions](../design/open-questions.md) records.

For contrast, [`φ_struct`](./structural.md) had two *exact* linear
dependencies, which is a different and worse problem and was fixed by dropping
columns.
