# Changelog

All notable changes to Ricercar are documented here, grouped by development
pass. The format is based on [Keep a Changelog](https://keepachangelog.com/);
the project is pre-1.0 and has no releases yet.

## [Unreleased]

### Renamed
- **EvoSynth → Ricercar** (`efceab6`): crates `ricercar-*`, wasm artifacts,
  worklet processor, storage keys (with one-time migration of old saves),
  export filenames, UI wordmark. Old `.evopatch` files still import.

### Added — pass 6, "four tiers" (`4e94345`, `d12a23b`, `ca82994`)
- **Trust**: IndexedDB session autosave/restore; undo/redo over knob and
  structural edits; Web MIDI in (velocity, pitch bend, sustain); per-patch
  LUFS makeup gain for loudness-fair live audition; in-worklet WAV recording;
  shareable single-patch files.
- **Musicality**: sample-accurate arpeggiator (up/down/up-down/random, BPM ×
  division), glide, unison with detune + stereo spread, velocity→level
  curve; palette grew **reverb** (Freeverb) and a **sample-and-hold random**
  modulation source, end to end (grammar → features → UI).
- **Taste loop**: refinement proposals tilted by the structural taste
  posterior (`exp(η·θ)` on grammar kind weights); recency-weighted
  likelihood (half-life 150 observations); implicit signals logged (play
  counts, promotes); nameable, color-coded styles with auto-labels and
  exemplar audition; pre-vote duel forecasts with running calibration.
- **Surface**: modulation wires pulse at the modulator's rate; duel-deal
  staging; quick-duel strip on PLAY; `?` help overlay with first-run onboarding;
  coarse-pointer touch targets.

### Added — pass 5, bulletproofing (`a0e5628`)
- Zero-allocation render path, one-pole parameter smoothing, click-free
  patch swaps (fade → silent amortized rebuild → re-press held notes →
  fade-in), swap coalescing, compile-failure fallback, chaos gate tests.

### Added — passes 1–4 (`ad00e32`, `05bfbe4`, `76962fc`, `5819ef9`)
- Interactive workbench (every knob a live trace address), locks with exact
  conditional refinement, max-of-experts taste model, taste map / styles /
  directions views, lineage strip.
- The instrument: AudioWorklet 4-voice polyphony, app frame
  (PLAY/EVOLVE/TASTE), patch bank, docked keyboard.
- Feature-complete push: typed structural editing, presets, patch naming,
  dynamic style count, duel-card circuit flip.
- The live surface: zero-recompile knobs (`ExternalInput` atomics), typed
  jack-drag rewiring with a parts tray, labeled jacks, colored wires.

### Added — milestones M0–M5
- Workspace scaffold; grammar + trace codec + compiler; feature pipeline
  (vet gate, LUFS, φ); taste model with three likelihoods; two-loop session
  engine with dueling-Thompson acquisition (closed-loop gate: r > 0.6 in 60
  duels against a synthetic user); wasm bindings and the first web frontend.
