# Compilation to a patch

<p class="lede">Term → quiver `Patch`. One path, used by both the search and the
live instrument.</p>

`auracle_grammar::compile` is the largest single module in the workspace, and
its job is narrow: turn a `PatchTree` into a playable quiver patch graph, with
handles for every live parameter.

## The mandatory output chain

Every compiled voice ends the same way, and none of it is optional:

$$
\langle\text{audio}\rangle \to \text{DC blocker} \to \text{VCA (amp ADSR)} \to
\text{Limiter} \to \text{StereoOutput}
$$

Plus two external controls (`pitch` in V/Oct and `gate` in volts) fanned out to
every pitched source and every envelope.

**No evolved patch can bypass the limiter or end up unplayable.** That is
safety layer 3, and it is enforced by the compiler emitting the chain, not by
asking the grammar not to.

The tail is built **once per channel**, so a subtree that produces true stereo
(reverb, chorus) keeps both tanks all the way to the output rather than having
the right one discarded on the way to a mono sum.

## Parameter mapping

The compiler owns the musical meaning of every normalized $[0,1]$ site, and the
ranges are **deliberately bounded away from pathology**:

| | Bound |
|---|---|
| Filter resonance | max 0.85 |
| Delay feedback | max 0.7 |

So the grammar cannot express self-oscillating resonance or a runaway delay.
This is the same argument as [parameter
domains](./parameters.md#bounded-by-the-mapping), one layer down: excluding a
region is better than generating it and rejecting it.

Two details worth knowing when reading the code:

- **Some quiver inputs are gates, not amounts.** `Adsr.shape`, `Vca.response`
  and `Limiter.soft` are read at a 2.5 V threshold, so 5 V and 10 V do the same
  thing. The compiler uses named constants `GATE_TRUE = 5.0` / `GATE_FALSE =
  0.0` rather than bare numbers, because "5.0" at one of those ports does not
  mean what it looks like.
- **Filter keytracking is fixed at 0.5.** quiver applies $2^{v \cdot a}$, so
  0.5 moves the corner half an octave per octave played: enough that a patch
  still speaks two octaves above where it was dialled in, which is what the
  audition phrase's C5 stab measures.

## The DC blocker, and `makes_dc`

The output chain includes a DC blocker, and the compiler decides whether it is
needed by walking the term:

```rust
fn makes_dc(node: &AudioNode) -> bool {
    match node {
        AudioNode::Filter { kind, input, .. } =>
            matches!(kind, FilterKind::Ladder) || makes_dc(input),
        AudioNode::Distortion { mode, input, .. } =>
            matches!(mode, DriveMode::Tube) || makes_dc(input),
        AudioNode::Mix { a, b, .. } | AudioNode::RingMod { a, b, .. } =>
            makes_dc(a) || makes_dc(b),
        // sources produce none; dynamics inherit from their audio input
        …
    }
}
```

Two productions generate a DC offset (the ladder filter and tube-mode
distortion), and it propagates up through anything downstream of them.

Without the blocker, a tube-drive patch measures 1–8% DC as a fraction of RMS.
That is nowhere near the [vet gate's](../audition/vetting.md) 0.6 limit, which
is the point worth recording: **the vet gate was never what protected the
feature extractor from that offset.** The blocker was.

## Validation mode

Patches are wired under `ValidationMode::Warn`, not `Strict`.

quiver's `Strict` rejects *warning-class* pairings, and two of them are idioms
this compiler leans on deliberately:

- a unipolar modulation envelope driving a bipolar FM input,
- the bipolar pitch `Offset` driving V/Oct inputs.

The type discipline `Strict` would enforce is **already guaranteed by
construction**: the term's Audio/Mod sorts are Rust types, and the compiler
only emits known-good connection shapes.

Compile *errors* (invalid ports, cycles) remain hard failures. Accumulated
warnings are returned for inspection, and a property test asserts they stay
within the expected classes. That test is what stops "we know about these two"
from drifting into "we ignore all warnings".

Separately, the *grammar's* output is compiled under `Strict` in the test
suite, where a `SignalMismatch` is by construction a bug in the grammar and
therefore a useful oracle. Two different modes for two different questions.

## Live parameter handles

Compilation returns a `ParamMap`: address → `ParamHandle`, each wrapping an
`AtomicF64` the audio thread reads.

This is what makes knob turns free. Turning a knob writes the atomic, so the
running voices change on the next block with no recompile, and writes the
genome at the same address. Both, always; see
[Trace addresses](../architecture/addresses.md#live-parameter-handles).

Structural changes do require a recompile, and so do the handful of parameters
that feed compile-time decisions.

## One compiler, two callers

- **The search** compiles a term to render and measure it.
- **`LivePoly`** compiles the *same* term, through the *same* function, to play
  it: $N$ copies for $N$ voices, limiter included.

So what you hear under your fingers is the patch that was evolved, vetted and
featurized. There is no separate "playback engine" that could disagree with the
one the model learned from.

## Cost

The compiler is **recursive and builds by value**: every level of
`Compiler::build` constructs quiver modules before moving them into the patch,
and some of those carry large inline buffers. A `PitchShifter` holds `[f64;
4800]`, which is 38 KB, and a `Granular` holds more.

On a native main thread this is invisible. On wasm32, whose default stack is 1
MB, a dozen-module patch overflows it, and it does so as `memory access out of
bounds`, nowhere near the flag that caused it. See
[the stack size](../runtime.md#the-stack-size) for the fix and why it lives in the
Makefile.
