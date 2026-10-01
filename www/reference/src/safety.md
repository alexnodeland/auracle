# Safety

<p class="lede">Evolution <em>will</em> generate pathological patches. Five layers make
that acceptable rather than dangerous.</p>

Randomly composed DSP graphs produce screaming resonance, silent duds,
NaN-poisoned recursive state, and astronomically high pitches. None of that is
hypothetical and none of it is rare. Safety is layered because no single check
covers it.

## The layers

| Layer | Where | What |
|---|---|---|
| **0** | quiver | Denormals flushed at graph scatter; NaN-latch protection on stateful modules; soft-clipped filter state; cycle detection with named paths; non-finite module outputs zeroed at scatter |
| **1** | `auracle-features` | [The vetting gate](./audition/vetting.md). Every ▶ plays a pre-rendered, vetted, normalized buffer. The live keys play an edit before its check, and a failed check mutes them ([below](#the-live-keys-play-an-edit-before-its-check)) |
| **2** | `auracle-session` | Quarantine → `QUARANTINE_FITNESS = -50.0`, so the search *learns to avoid* the region |
| **3** | `auracle-grammar` | Mandatory `… → DC blocker → VCA → Limiter → StereoOutput`; parameter ranges bounded away from pathology |
| **4** | tests | `ValidationMode::Strict` as a property-test oracle over grammar output |

Layer 0 is a dependency’s, and the one Auracle has least control over, which is
why it was audited and why two bugs found there are recorded below.

## Layer 0: quiver

Verified 2026-07-28 and hardened where needed. quiver was already substantially
prepared for this use:

- Denormals flushed at graph scatter.
- NaN-latch protection on stateful modules: filters, limiter, and EQ sanitize
  inputs so non-finite samples cannot poison recursive state.
- Soft-clipped SVF state.
- Cycle detection with named-path errors.
- Actionable `PatchError`s (`InvalidPort` lists the available ports).
- `ValidationMode::Strict` for typed connections.

Two gaps were found and fixed upstream:

**Q198: permanently latched NaN, and an infinite loop on the audio thread.**
Oscillator phase accumulators latched NaN forever on non-finite pitch, because
`NaN − floor(NaN)` is NaN. Worse, the `while phase >= 1.0` wrap style used by
Wavetable and FormantOsc **spun the audio thread forever** on an infinite
increment, and `voct_to_hz` overflows at extreme V/Oct, which the grammar can
reach. An infinite loop on the audio thread is not a glitch, it is a dead tab
with no error message. Fixed with a shared $O(1)$ `wrap_phase` that recovers
non-finite values.

**Q199: cross-module poisoning.** Graph scatter now zeroes non-finite module
outputs, so one module’s NaN or Inf cannot poison another module’s recursive
state through the routing buffers. Containment at the graph boundary;
per-module input sanitization remains defense in depth.

`voct_to_hz` is clamped to ±32 octaves as of quiver-dsp 0.3.0 (Auracle pins
0.4.0), so the overflow Q198 recovers from can no longer be produced by pitch
CV at all; what remains at the clamp is finite aliasing garbage, which the vet
gate quarantines like any other.

## Layer 1: the vetting gate

*No candidate is ever auditioned unvetted.* Every ▶ plays **pre-rendered,
LUFS-normalized buffers**, and the standard-phrase render doubles as a health
check.

Thresholds, the measurements that confirmed them, and the ordering that makes
the whole thing work are in [The vetting gate](./audition/vetting.md).

The structural point: **one render serves the health check, the features, and
the playback.** That is what makes “no audition is unvetted” true by
construction rather than by discipline: there is no second path that could
skip the check, because there is no second render.

### The live keys play an edit before its check

The gate stands between a patch and every ▶. The keys are another path: the
live voices (`LivePoly`, in the AudioWorklet) play the sound you're playing,
and they take an edit before the engine has rendered and checked it, so that
a turn is heard as it is made. What reaches them early, and what happens when
its check fails:

| Edit | Reaches the voices | A failed check |
|---|---|---|
| A knob, the octave, a wavetable position | At once, as a parameter written into the running voices | The voices are muted until a check passes, and the alarm says so |
| A structural edit (a module placed, removed or rewired; an undo) | As a new tree, as soon as the engine has made the edit (`tree_json`), at the previous tree’s makeup until the check’s reply corrects it | The same mute |
| Any other selector (a VCO’s wave, a filter’s mode) | With the check’s reply, after its render, at the makeup the render measured | Never reaches them: the voices keep the tree before it |

So an unchecked edit can sound for as long as its render takes (a fraction
of a second, longer while the engine is busy) before a failed check mutes it.
Everything the voices play passes the master brickwall on the summed
polyphony and the leveler in front of it (`live.rs`), which bound the level
that reaches the output, not the sound. A selector waits because only its
render measures the level it plays at: sent early, the previous tree's
makeup was off by more than 3 dB on 46% of the presets' selector changes,
up to 27 dB hot (`crates/auracle-wasm/examples/selector_makeup.rs`).

## Layer 2: fitness shaping

Quarantined patches do not just get hidden; they score $-50$ in the search
target.

Hiding alone would leave the search spending its budget in a region it cannot
observe is bad, repeatedly rediscovering the same pathology. Shaping the
fitness makes avoidance something the search *learns*.

## Layer 3: the live path

Only vetted patches are free-playable, and the compiled output chain is
**mandatory**:

$$\langle\text{audio}\rangle \to \text{DC blocker} \to \text{VCA} \to \text{Limiter} \to \text{StereoOutput}$$

The limiter is compiled in by `auracle-grammar`, not optional and not a
setting. It sits on top of quiver’s scatter sanitization.

And parameter priors are **bounded** (resonance max 0.85, delay feedback max
0.7, V/Oct into an audible band) so the grammar cannot *express* the most
degenerate settings. That is categorically better than generating and rejecting
them: there is no pathological region for the search to keep sampling.

## Layer 4: Strict as an oracle

Grammar output is compiled with `ValidationMode::Strict` in the test suite.
Because the grammar is typed, **a `SignalMismatch` is by construction a bug in
the grammar**, so Strict is a property-test oracle: sample $N$ terms, compile
all, any error fails the test with quiver’s actionable message.

Patches are *wired* in `Warn` mode, with an allowlist test pinning the warning
classes the compiler uses on purpose. See
[Validation mode](./genome/compilation.md#validation-mode): two different modes for
two different questions.

## Non-audio safety

The gates above are about sound. Two others are worth listing here because they
are the same kind of thinking applied elsewhere.

**Escape everything a user or a file can name.** `renderBank` once built rows
by interpolating `r.name` straight into `innerHTML`. Renaming a patch to `<img
src=x onerror=…>` executed, persisted into the saved bank, and re-fired on
every reload. The *same* sink is fed by **imported patch JSON**, so opening a
shared patch was script execution in the recipient’s session. Every
interpolation of a name is now escaped, including the two that land in
attributes, and `textContent` is preferred wherever the node allows it.

**Refuse to measure a term that cannot be interpreted.**
`FeaturizeError::OutOfDomain` rejects a term with a knob outside its range
*before* the render, because its $\varphi$ would be a lie and a row the model
cannot interpret must not enter the log. This is the gate the
[`1e30` sentinel](./genome/parameters.md#the-sentinel-incident) got past
when it did not exist.

## What is not defended against

- **A malicious patch file** can name things and set parameters. Names are
  escaped and parameters are domain-checked and repaired, so the blast radius
  is intended to be zero. It is still a parser handling untrusted input, and
  that is always a claim rather than a guarantee.
- **Hearing damage** is mitigated (limiters, LUFS normalization to a
  [peak ceiling](./audition/loudness.md#loudness-is-a-target-the-peak-is-a-limit),
  vetted auditions, a mute when an edit's check fails), but the output level
  is ultimately the player’s. An edit at the keys plays until its check
  fails, which is a fraction of a second or longer
  ([above](#the-live-keys-play-an-edit-before-its-check)).
  Nothing stops a limiter-bounded signal from being turned up.
- **Denial of service via a huge patch** is bounded by the module and depth
  ceilings, not by a time limit. A 24-module patch with granular and reverb is
  legitimately expensive.
- **The audio thread can still be starved** by the rest of the machine. That is
  a browser scheduling matter and outside what the engine can fix.
