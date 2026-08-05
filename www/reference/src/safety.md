# Safety

<p class="lede">Evolution <em>will</em> generate pathological patches. Five layers make
that acceptable rather than dangerous.</p>

Randomly composed DSP graphs produce screaming resonance, silent duds,
NaN-poisoned recursive state and astronomically high pitches. None of that is
hypothetical and none of it is rare. Safety is layered because no single check
covers it.

## The layers

| Layer | Where | What |
|---|---|---|
| **0** | quiver | Denormals flushed at graph scatter; NaN-latch protection on stateful modules; soft-clipped filter state; cycle detection with named paths; non-finite module outputs zeroed at scatter |
| **1** | `auracle-features` | [The vetting gate](./audition/vetting.md). Audition plays pre-rendered, vetted, normalized buffers — never a live unvetted patch |
| **2** | `auracle-session` | Quarantine → `QUARANTINE_FITNESS = -50.0`, so the search *learns to avoid* the region |
| **3** | `auracle-grammar` | Mandatory `… → DC blocker → VCA → Limiter → StereoOutput`; parameter ranges bounded away from pathology |
| **4** | tests | `ValidationMode::Strict` as a property-test oracle over grammar output |

Layer 0 is a dependency's, and the one Auracle has least control over, which is
why it was audited and why two bugs found there are recorded below.

## Layer 0 — quiver

Verified 2026-07-28 and hardened where needed. quiver was already substantially
prepared for this use:

- Denormals flushed at graph scatter.
- NaN-latch protection on stateful modules — filters, limiter and EQ sanitize
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
outputs, so one module's NaN or Inf cannot poison another module's recursive
state through the routing buffers. Containment at the graph boundary;
per-module input sanitization remains defence in depth.

Still open upstream, non-blocking: `voct_to_hz` is unclamped. Q198 *recovers*
from the overflow rather than preventing it, and a pitch clamp would
additionally tame the aliasing garbage that absurd-but-finite pitches produce.

## Layer 1 — the vetting gate

*No candidate is ever played live unvetted.* Audition plays **pre-rendered,
LUFS-normalized buffers**, and the standard-phrase render doubles as a health
check.

Thresholds, the measurements that confirmed them, and the ordering that makes
the whole thing work are in [The vetting gate](./audition/vetting.md).

The structural point: **one render serves the health check, the features and
the playback.** That is what makes "you never hear an unvetted patch" true by
construction rather than by discipline: there is no second path that could skip
the check, because there is no second render.

## Layer 2 — fitness shaping

Quarantined patches do not just get hidden; they score $-50$ in the search
target.

Hiding alone would leave the search spending its budget in a region it cannot
observe is bad, repeatedly rediscovering the same pathology. Shaping the
fitness makes avoidance something the search *learns*.

## Layer 3 — the live path

Only vetted patches are free-playable, and the compiled output chain is
**mandatory**:

$$\langle\text{audio}\rangle \to \text{DC blocker} \to \text{VCA} \to \text{Limiter} \to \text{StereoOutput}$$

The limiter is compiled in by `auracle-grammar`, not optional and not a
setting. On top of quiver's scatter sanitization.

And parameter priors are **bounded** (resonance max 0.85, delay feedback max
0.7, V/Oct into an audible band) so the grammar cannot *express* the most
degenerate settings. That is categorically better than generating and rejecting
them: there is no pathological region for the search to keep sampling.

## Layer 4 — Strict as an oracle

Grammar output is compiled with `ValidationMode::Strict` in the test suite.
Because the grammar is typed, **a `SignalMismatch` is by construction a bug in
our grammar**, so Strict is a property-test oracle: sample $N$ terms, compile
all, any error fails the test with quiver's actionable message.

Patches are *wired* in `Warn` mode, with an allowlist test pinning the two
warning classes the compiler deliberately uses. See
[Validation mode](./genome/compilation.md#validation-mode): two different modes for
two different questions.

## Non-audio safety

The gates above are about sound. Two others are worth listing here because they
are the same kind of thinking applied elsewhere.

**Escape everything a user or a file can name.** `renderBank` once built rows
by interpolating `r.name` straight into `innerHTML`. Renaming a patch to `<img
src=x onerror=…>` executed, persisted into the saved bank, and re-fired on
every reload. The *same* sink is fed by **imported patch JSON**, so opening a
shared patch was script execution in the recipient's session. Every
interpolation of a name is now escaped, including the two that land in
attributes, and `textContent` is preferred wherever the node allows it.

**Refuse to measure a term you cannot interpret.**
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
- **Hearing damage** is mitigated (limiter, LUFS normalization, no unvetted
  playback) but the output level is ultimately yours. Nothing stops you turning
  a limiter-bounded signal up.
- **Denial of service via a huge patch** is bounded by the module and depth
  ceilings, not by a time limit. A 24-module patch with granular and reverb is
  legitimately expensive.
- **The audio thread can still be starved** by the rest of the machine. That is
  a browser scheduling matter and outside what the engine can fix.
