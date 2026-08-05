# Loudness normalization

<p class="lede">Louder reliably wins A/B tests. Without normalization the model
would learn "I like loud" and present it as a preference about timbre.</p>

Every render is normalized to **−18 LUFS** (`TARGET_LUFS`) before audition
*and* before feature extraction. Unnormalized loudness would poison $\theta$,
and it would do so in a way that looks like a real result.

## Why LUFS and not RMS

Because the confound is *perceived* loudness. K-weighting approximates the
ear's sensitivity (a high-shelf boost above ~1.7 kHz plus a ~38 Hz highpass),
and 400 ms gated blocks keep silence and release tails from dragging the
measurement down. Plain RMS would under-measure a bright patch and over-measure
a bass-heavy one, and then the "loudness" the model learned about would be a
spectral preference in disguise.

The implementation follows ITU-R BS.1770 (`auracle_features::loudness`).

## K-weighting

Two biquads in direct form 1, derived **parametrically** from the BS.1770
analog prototype by the RBJ bilinear transform, the same approach pyloudnorm
takes, so any sample rate works and the coefficients match the spec's published
48 kHz values at 48 kHz.

**Stage 1, the high shelf:**

$$G = 3.999844\ \text{dB}, \quad Q = 0.707175, \quad f_c = 1681.974\ \text{Hz}$$

**Stage 2, the highpass:**

$$Q = 0.500327, \quad f_c = 38.1355\ \text{Hz}$$

With $k = \tan(\pi f_c / f_s)$, $V_H = 10^{G/20}$ and $V_B = V_H^{0.499667}$,
the shelf's coefficients are

$$
a_0 = 1 + \tfrac{k}{Q} + k^2, \qquad b_0 = \frac{V_H + V_B \tfrac{k}{Q} +
k^2}{a_0}, \qquad b_1 = \frac{2(k^2 - V_H)}{a_0}, \qquad b_2 = \frac{V_H - V_B
\tfrac{k}{Q} + k^2}{a_0}
$$

and the highpass is the standard RBJ form. Deriving rather than tabulating is
what makes the measurement correct at 44 100 Hz, which is the rate the phrase
renders at.

<figure class="viz" data-viz="k-weighting">
<figcaption><strong>The filter, evaluated rather than drawn.</strong> This curve is
computed in the page from the same constants listed above, through the same
bilinear transform, so it is the response the pipeline applies. The two dashed
curves are the shelf and the highpass; the solid one is their sum. Change the
sample rate and the corners stay put, which is what deriving the coefficients
buys.</figcaption>
</figure>

## Block loudness and the two gates

Blocks are **400 ms with 75% overlap**. Each block's loudness is

$$L_j = -0.691 + 10 \log_{10}\!\left(\frac{1}{N}\sum_{n} w[n]^2\right)$$

where $w$ is the K-weighted signal. The $-0.691$ dB offset is the spec's
calibration constant.

Then two gates, in order:

1. **Absolute gate.** Discard blocks with $L_j \le -70$ LUFS. If none survive,
   the signal is silent and the function returns `None`.
2. **Relative gate.** Compute the mean energy of the surviving blocks, and
   discard blocks more than 10 LU below it: $$\Gamma = -0.691 +
   10\log_{10}\!\big(\bar{E}_{\text{abs}}\big) - 10$$

The integrated loudness is the same expression over the twice-gated set:

$$L = -0.691 + 10 \log_{10}\!\left(\frac{1}{|\mathcal{G}|}\sum_{j \in \mathcal{G}} 10^{(L_j + 0.691)/10}\right)$$

Note that gating averages in the **energy** domain, not the dB domain, which is
why the implementation exponentiates each retained block loudness back before
averaging rather than taking a mean of decibels.

The relative gate is what makes this robust for the phrase specifically: the
phrase ends with 1.1 seconds of release tail by design, and a plain average
would let that tail pull the measurement down and then be compensated for by a
boost.

## Applying the gain

```rust
let gain_db = (target_lufs - lufs).min(MAX_GAIN_DB);   // MAX_GAIN_DB = 30.0
let gain = 10f64.powf(gain_db / 20.0);
```

The boost is capped at **+30 dB**. A patch needing more than that is a
*vetting* problem, not something to amplify, and vetting runs first, so in
practice the cap is a backstop.

The report carries `lufs_before` and `gain_db`, both of which survive into
`Features`. They are diagnostics rather than model inputs: they are not
coordinates of $\varphi$, because "how quiet was this before we fixed it" is
exactly the information normalization exists to discard.

## Where it sits in the pipeline

**After** vetting and **before** feature extraction:

$$\text{render} \to \text{vet} \to \text{normalize} \to \varphi_{\text{audio}}$$

Vetting inspects the **raw** render, deliberately: its thresholds are about the
patch's real output level, and measuring them post-normalization would make the
peak ceiling meaningless. See
[the order is the design](./vetting.md#the-order-is-the-design).

The normalized buffer is also **exactly what the user hears**. One buffer
serves the health check, the measurement and the playback, which is what makes
"you never hear an unvetted patch" true by construction rather than by
discipline.

## Mono

The measurement is mono, and so is the buffer $\varphi_{\text{audio}}$ is
computed from. A patch that produces true stereo keeps both channels through to
the live output, because the compiler
[builds the tail per channel](../genome/compilation.md#the-mandatory-output-chain),
but the *measurement* path sums.

So **stereo width is invisible to the model.** There is no width coordinate, so
no amount of voting can teach a preference for it. The app says so on the
chorus module's spec card, and this is why.
