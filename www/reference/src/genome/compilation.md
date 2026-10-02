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

- **Some quiver inputs are gates, not amounts.** `Adsr.shape`, `Vca.response`,
  and `Limiter.soft` are read at a 2.5 V threshold, so 5 V and 10 V do the same
  thing. The compiler uses named constants `GATE_TRUE = 5.0` / `GATE_FALSE =
  0.0` rather than bare numbers, because “5.0” at one of those ports does not
  mean what it looks like.
- **Filter keytracking is fixed at 0.5.** quiver applies $2^{v \cdot a}$, so
  0.5 moves the corner half an octave per octave played: enough that a patch
  still speaks two octaves above where it was dialed in, which is what the
  audition phrase’s C5 stab measures.

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
distortion), and it propagates up through anything downstream of them. An
`AudioIn` always pays for the blocker: a host input can carry an offset of its
own.

Without the blocker, a tube-drive patch measures 1–8% DC as a fraction of RMS.
That is nowhere near the [vet gate’s](../audition/vetting.md) 0.6 limit, which
is the point worth recording: **the vet gate was never what protected the
feature extractor from that offset.** The blocker was.

## Validation mode

Patches are wired under `ValidationMode::Warn`, not `Strict`.

quiver’s `Strict` rejects *warning-class* pairings, and this compiler uses
several of them on purpose, for example:

- a unipolar modulation envelope driving a bipolar FM input;
- a constant bipolar `Offset` feeding a unipolar knob.

The type discipline `Strict` would enforce is **already guaranteed by
construction**: the term’s Audio/Mod sorts are Rust types, and the compiler
only emits known-good connection shapes.

Compile *errors* (invalid ports, cycles) remain hard failures. Accumulated
warnings are returned for inspection, and a property test
(`every_prior_sample_compiles`) asserts they stay within an allowlist that
names each class with its reason. That test keeps a known exception from
drifting into a habit of ignoring warnings.

Separately, the *grammar’s* output is compiled under `Strict` in the test
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

## Taps, and the level on each cable

Compilation also records each term node's **tap**: the quiver port its audio
leaves by (`CompiledVoice::taps`, keyed by the node's trace key). A term is a
tree, so each module's output feeds exactly one parent, and its tap carries
exactly what the cable from that module carries. Two readers use them, and
both read in the same scale, dB re 1 V of the raw port value (quiver's
`calculate_rms_db`), so PATCH maps a level to light one way:

- **The live meter.** While notes sound, `LivePoly::set_meter` subscribes to
  every tap, read on one voice, the newest one sounding, and each tap's RMS
  reaches the page as quiver's level windows fill. It needs no recompile and
  costs nothing when off.
- **The cable probe,** for a patch at rest (`auracle_features::probe_cables`,
  `WasmEngine::edit_cable_levels` in wasm, the worker's `cable_levels`
  message). It renders the
  [audition phrase](../audition/phrase.md) once and reads every audio cable
  after every tick of the main voice, through the routing slot its tap
  resolves to, keeping each cable's RMS and peak over the whole phrase, gaps
  included. A cable that carries nothing reads `PROBE_FLOOR_DB` (−120 dB).

The probe's cables are the rack's: one per audio wire of `describe`, in its
order, with the `from` and `to` module keys PATCH draws a cable by and both
modules' uids, which PATCH's cable identity is made of. Modulation cables are
not measured, because the compiler taps audio nodes only, and PATCH draws a
modulation cable by its rate. Chord voices are not measured either: the
levels are the voice that plays every note of the phrase, as the live meter's
are one voice.

The probe writes nothing: it reads each port's last value and leaves the
patch alone, so a render it watches is the plain render, bit for bit. All 62
presets render identically with and without it
(`crates/auracle-features/examples/cable_probe.rs`), and the test suite holds
every fourth preset to that. It is not φ, and nothing it reads reaches the
featurizer.

Its cost is one render of the phrase. Natively, a probed render took a median
0.99 times a plain one over the 62 presets (162 ms against 165 ms of CPU, on
a shared machine, so the reads are lost in the noise); in wasm under node it
took a median 160 to 206 ms over two runs, against 183 to 238 ms for a render with φ
(`crates/auracle-wasm/examples/cable_cost.mjs`). That is not a per-block
cost, so the probe runs once a structural edit has settled, in the worker's
`later` lane, and the live meter covers the patch while notes sound.

## One compiler, two callers

- **The search** compiles a term to render and measure it.
- **`LivePoly`** compiles the *same* term, through the *same* function, to play
  it: $N$ copies for $N$ voices, limiter included.

So what the player hears under their fingers is the patch that was evolved,
vetted, and featurized. There is no separate “playback engine” that could disagree with the
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
