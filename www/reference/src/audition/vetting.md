# The vetting gate

<p class="lede">No candidate is ever played live unvetted. This is what makes
randomly composed DSP graphs safe to put in front of a person.</p>

Evolution **will** generate pathological patches: screaming resonance, silent
duds, NaN-poisoned state, astronomically high pitches. The gate is what makes
that acceptable rather than dangerous.

## What it measures

`vet(samples, cfg)` inspects the **raw, pre-normalization** render and returns
either a report or a quarantine reason.

```rust
pub struct VetReport {
    pub peak: f64,             // max |sample|
    pub rms: f64,              // whole-phrase RMS
    pub dc_ratio: f64,         // |mean| / rms
    pub pinned_fraction: f64,  // fraction within 2% of peak
}
```

Failures, checked in this order:

| Order | Failure | Condition |
|---|---|---|
| 1 | `Silent` | Empty buffer |
| 2 | `NonFinite` | Any sample is not finite |
| 3 | `Silent` | $\text{rms} < 10^{-4}$ |
| 4 | `Overlevel` | $\text{peak} > \text{ceiling}$ |
| 5 | `DcDominated` | $\lvert\text{mean}\rvert / \text{rms} > 0.6$ |

`pinned_fraction`, the share of samples within 2% of the peak, is
**informational only**. It indicates heavy limiting, which is a character
rather than a fault; promoting it to a failure would quarantine an entire
timbre.

## The thresholds

```rust
impl Default for VetConfig {
    fn default() -> Self {
        Self { rms_floor: 1e-4, peak_ceiling: 2.0, max_dc_ratio: 0.6 }
    }
}
```

Deliberately **lenient**. The gate exists to catch pathology, not to encode
taste; that is the model's job, and a gate that quietly enforces a preference
corrupts the data it protects.

### The polyphony-scaled ceiling

`VetConfig::for_spec` scales the peak ceiling with the phrase's polyphony:

$$\text{ceiling} = 2.0 + 1.5\,(V - 1)$$

where $V$ is `max_voices()`. The default 2.0 is one limiter-bounded voice (~1.5
peak in the ±1.0 float domain) plus overshoot headroom; $N$ gate-synced voices
legitimately sum toward $N$× one voice.

Not scaling it would quarantine honest polyphony as runaway, and specifically
the dyad segment, which exists to *measure* that summing. The measurement and
the gate have to agree about what stacking is.

## The thresholds were re-checked, and did not move

Worth recording, because a gate tuned before a whole family of modules existed
is exactly the kind that starts quarantining a timbre.

When the drive modules arrived, the three thresholds were measured over the
full cross of `{soft, hard, tube} × drive {0.3, 0.6, 0.85, 1.0} × {saw, square,
supersaw}`, plus a stacked fold → tube drive → resonant ladder chain:

| Measured | Against | Result |
|---|---|---|
| **peak** never exceeded 2.00 | ceiling 3.5 (at $V=2$) | Fine |
| $\lvert\text{mean}\rvert/\text{rms}$ never exceeded 0.0016 | limit 0.6 | Fine |
| **rms** stayed far above the floor | $10^{-4}$ | Fine — distortion raises level |

Peak is bounded **by construction**: quiver's shapers all normalize into the ±1
domain and rescale, so a drive module is bounded at ±5 V however hard it is
pushed. Drive buys harmonics, not level.

The DC result is 0.0016 only because
[`compile::makes_dc`](../genome/compilation.md#the-dc-blocker-and-makes_dc) puts a
blocker in front of every tube-mode patch. Without it the same renders measure
1–8%, still nowhere near 0.6. **So this gate was never what protected the
feature extractor from that offset.** A threshold a defect passes comfortably
is not a defence against it.

The one threshold that would have had to move, had the shaper not been bounded,
is `peak_ceiling`.

## The order is the design

`pipeline::featurize` composes the stages, and the order matters:

```rust
// 1. Domain check — BEFORE the render
if let Some((site, value)) = tree.domain_violations().into_iter().next() {
    return Err(FeaturizeError::OutOfDomain { site, value });
}
// 2. Render
let mut render = render_phrase(tree, spec)?;
// 3. Vet the RAW render
let report = vet(&render.samples, &VetConfig::for_spec(spec))?;
// 4. Normalize
let norm = normalize_to(&mut render.samples, render.sample_rate, TARGET_LUFS)…;
// 5. Extract φ
let audio = audio_features(&render);
let structural = struct_features(tree);
// 6. Non-finite check on the VECTOR
for (name, value) in Features::phi_names().iter().zip(features.phi()) {
    if !value.is_finite() { return Err(FeaturizeError::NonFiniteFeature { … }); }
}
```

Four things about that order:

**The domain check is first, before the render.** A term with a knob outside
its range is not a candidate that happens to sound bad: it is a term whose
$\varphi$ would be a lie, and the ~600 ms render is wasted on it either way.
This is the gate that keeps the observation log clean: **every row in the log
came through here.** It is also the gate that was missing when the `1e30`
sentinel got in, because vetting is a gate on the *sound* and `amp.sustain =
1e30` renders perfectly well.

**Vetting is on the raw render.** Its thresholds are about the patch's real
output level; measuring peak after normalization would make the ceiling
meaningless.

**Normalization is before extraction.** Otherwise loudness leaks into every
amplitude-sensitive coordinate.

**There is a second finiteness check, on the vector.** It costs one pass over
forty-one doubles against a render that took most of a second, and it is the only
thing standing between a NaN out of a spectral descriptor and a posterior fit
that returns all-NaN $\theta$. It is a *different* error from `OutOfDomain` and
names the coordinate rather than a genome site, because at that point the term
was legal and the *measurement* went wrong.

## Quarantine is not just hiding

A failed candidate is never played and never shown, and it also scores
`QUARANTINE_FITNESS = -50.0` in the search target.

That is safety layer 2: evolution **learns to avoid the pathological region**
rather than repeatedly sampling it. Hiding alone would leave the search wasting
its budget in a place it cannot see is bad.

## The five layers, in one place

| Layer | Where | What |
|---|---|---|
| **0** | quiver | Denormals flushed at graph scatter; NaN-latch protection on stateful modules; soft-clipped filter state; cycle detection; non-finite module outputs zeroed at scatter so one module's NaN cannot poison another's state |
| **1** | `auracle-features` | This gate. Audition plays pre-rendered, vetted, normalized buffers — never a live unvetted patch |
| **2** | `auracle-session` | Quarantine → large negative fitness, so the search avoids the region |
| **3** | `auracle-grammar` | Mandatory `… → Limiter → StereoOutput`, and parameter ranges bounded away from pathology |
| **4** | tests | `ValidationMode::Strict` as a property-test oracle over grammar output |

### Two upstream bugs

Both in quiver, both fixed there, and both worth knowing as the class of thing
that lurks under randomly composed DSP:

- **Q198.** Oscillator phase accumulators latched NaN *permanently* on
  non-finite pitch (`NaN − floor(NaN)`), and the `while phase >= 1.0` wrap
  style used by Wavetable and FormantOsc **spun the audio thread forever** on
  an infinite increment (`voct_to_hz` overflows at extreme V/Oct). An infinite
  loop on the audio thread is not a glitch; it is a dead tab. Fixed with a
  shared $O(1)$ `wrap_phase` that recovers non-finite values.
- **Q199.** Graph scatter now zeroes non-finite module outputs, so one module's
  NaN/Inf can never poison another module's recursive state through the routing
  buffers. Containment at the graph boundary; per-module input sanitization
  remains defence in depth.

Still open upstream, and non-blocking: `voct_to_hz` is unclamped. Q198
*recovers* from the overflow rather than preventing it, and a pitch clamp would
additionally tame the aliasing garbage that absurd-but-finite pitches produce.
