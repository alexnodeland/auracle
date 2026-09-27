# Plugin lab: Auracle's named controls on a third-party synth

A feasibility measurement for stage 4 (the orchestrator), run on
2026-09-27. Question: does the machinery behind PERFORM — φ, the session
standardizer, the finite-difference Jacobian, the ridge wiring and per-half
verification — transfer to a synthesizer that is not a quiver patch?

**Setup.** Surge XT 1.3.4 (prebuilt Linux VST3) hosted headlessly through
pedalboard (GPL, used as a research harness only — nothing here ships). The
init patch with filter 1 switched to a lowpass; fifteen continuous
parameters (filter cutoff/resonance/envelope amount, both envelopes, oscillator
shape/width/sub/detune). Each setting plays the standard audition phrase, and
Auracle's own extractor measures it through
`cargo run -p auracle-features --example phi_of_render`, which is the whole of
what the taste model needs from a sound source. The standardizer is fitted on
forty random Surge settings: a session pool made of Surge sounds.
`lab.py` reproduces everything (`K` renders averaged per setting, step `H`).

## Findings

1. **The seam works unchanged.** φ, standardization, wiring and verification
   run on Surge with no change to their math. The only foreign-synth-specific
   code is "play this phrase and give me the samples".
2. **Surge is not deterministic render to render, and φ inherits it.** Six
   renders of one setting spread by 0.03–0.16σ per coordinate (`attack_s` and
   `held_centroid_std` worst, from random oscillator phase). At `K = 1`, a 0.08
   step and one render per point, the Jacobian is partly noise.
3. **Averaging fixes it cheaply.** At `K = 4`, `H = 0.2`, Bright verifies in
   both directions (−0.41σ / +0.14σ at a full turn), Snap one-sided, Grit and
   Space unreachable (no drive or effects in the init patch — the same
   honest answer PERFORM gives on quiver patches). Surge renders the 5 s
   phrase in ~13 ms against ~600 ms for a quiver patch, so four renders cost
   less than one of ours.
4. **Verification earns its keep.** In one `K = 1` run it refused a Bright
   wiring with a predicted purity of 0.85 whose real renders moved neither
   way.
5. **Purity-optimal is not always what a musician expects.** Bright wired
   mostly through the filter envelope's release rather than the cutoff. For a
   plugin the parameters have *names*, so the principled fix is a semantic
   prior on the ridge — "cutoff" is a priori a brightness knob — which the
   measurement then confirms or overrides. The quiver grammar has the same
   information in its site names and could use the same prior.

## What this means for the stage-4 design

- `perform::jacobian` / `wire` / `verify` should be generic over a "sound
  source" (knob vector in, samples out); nothing in them is grammar-specific
  beyond `set_param`.
- Measurement must take `K` and `H` from the source: 1 and 0.08 for
  deterministic quiver patches, more for plugins that are not.
- The φ render-source seam (`phi_of_render`) is already enough for the taste
  model; the structural half of φ is simply absent for a plugin.
