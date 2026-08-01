# Changelog

All notable changes to Ricercar are documented here, grouped by development
pass. The format is based on [Keep a Changelog](https://keepachangelog.com/);
the project is pre-1.0.

## [Unreleased]

### Changed

- Two open questions about the search loop are now **answered in the code**
  rather than in a commit message, because both would otherwise be re-asked
  from scratch:
  - The refinement budget split (`2·N_OPS` steps from `N_OPS/2` seeds) is a
    measured optimum, not an argument — moving off it in *either* direction
    scores worse, and depth from few seeds is actively harmful. The table is
    on `SessionConfig::refine_steps`.
  - The pool-decline scare from the palette expansion: the fitted ranking
    genuinely does churn between refits (Spearman 0.556), and it genuinely
    does not matter, because the true best survives 98% of generations and
    eviction only reads the bottom of the order. Recorded on
    `search_health`'s `retention`, along with why the upper-confidence-bound
    eviction rule it motivated was designed and not shipped.

### Added — wave 2C: modulation becomes a sort

- `ModNode` was a flat enum of leaves: one modulator, one destination, and
  nowhere to put anything in between. It is now **recursive with a depth
  bound**, so `s&h rand → quantize to a minor scale → slew` is a term the
  grammar can write, the taste model can learn and the rack can draw.
- Eleven new modulators: `euclid` (a clocked pattern — the rhythm behind most
  drum machines), the CV shapers `quantize`, `slew`, `rectify` and `hold`, and
  the combiners `min`, `max`, `and`, `or`, `xor` and `switch`.
- **Shapers wrap rather than replace.** Dropping a quantizer on a cable that
  already carries an LFO takes the LFO as its input — chaining is the whole
  point of the recursive sort, and it should not first cost you the modulator
  that made the cable worth quantizing. The socket says which of the three
  things will happen before you click.
- Palette: **30 → 41 modules**, and 43 of quiver's 65 are now reachable.

### Added — wave 2B: the binary-node family

- **Five more modules.** `pitch shift` (a harmoniser — one note becomes an
  interval), and four **binary** nodes whose second child is a *control* rather
  than something you hear: `compressor`, `ducker`, `gate` and `vocoder`.
- Wave one cut all five on the grounds that they "need a second free audio input
  the typed tree cannot name". `ring mod` shipped in that same wave *as a
  two-child node*, so the premise was already false — and the pitch shifter
  turned out to be unary all along; the port map that condemned it belonged to
  the vocoder.
- A `dynamics` group joins the catalogue, and binary sockets now carry real
  names — `in`/`key`, `carrier`/`voice` — instead of `a`/`b`.
- Palette: **25 → 30 modules**.

### Added — wave 2A: motion, voice, and pitch that can bend

- **Six more modules**, none of which needed an architectural change — they were
  cut in wave one on product grounds that did not survive re-reading:
  `formant` (a glottal pulse through five resonators, with a *continuous* vowel
  slide rather than a five-way switch), `flanger`, `tremolo`, `vibrato`,
  `eq` (three bands, ±12 dB, arriving flat) and `granular`.
- **Pitch modulation.** `vco` and `supersaw` gained a modulation slot landing on
  the pitch offset. Until this existed nothing in the instrument could bend a
  pitch — no vibrato, no pitch envelope, no siren — which made "vibrato is just
  an LFO on pitch, pre-baked" an argument for a capability that was not there.
- Palette: **19 → 25 modules**, and modulation slots **10 → 18**.
- A `motion` group joins the catalogue, between `space` and `combine`.

### Added — the palette, and the catalogue that holds it

- **Six new modules, appended to the grammar**: `wavetable` (eight bandlimited
  shapes with a modulatable morph — the first source whose timbre moves),
  `pluck` (Karplus–Strong, gate-triggered), `distortion` (soft / hard / tube),
  `bitcrush`, `phaser`, and `ringmod` — the grammar's **second binary node**,
  which is what makes COMBINE a real sort rather than a sidebar heading.
  Plus `follower`, an envelope follower that taps the module's own input so a
  patch responds to itself, and a `glide` knob on `s&h rand`. Nineteen modules,
  from twelve.
- **Modulation almost everywhere.** Delay, chorus, reverb, wavetable, pluck,
  distortion, bitcrush and phaser gained a modulation slot, each with a fixed,
  **named destination** the rack prints on the jack (`→ time`, `→ size`,
  `→ drive`). It was filter and wavefolder only, in an instrument whose DSP had
  supported the rest all along.
- **The node bank became a catalogue.** Six signal-flow groups, a transfer-
  function glyph per module, a port signature in both phosphors at rest, search
  by sound as well as by name (`grit`, `metal`, `wander`), a spec card with one
  sentence of plain English per module, and — where the evidence supports it —
  the model's own θ with a ±σ whisker.
- **Arm-and-place**, with a full keyboard equivalent. Click a module and every
  legal socket lights up and says what will happen to it: green **inserts**,
  amber **replaces**. Wiring previously had no keyboard path at all.
- **IN THIS PATCH** in the rail, a resizable and persisted width, a collapsed
  rail that keeps its name and its held count, and six new presets that
  exercise the new modules.

### Changed

- `φ_struct` carries **families**, not one column per module: `n_drive` covers
  fold + distortion + bitcrush, `n_mod_fx` covers chorus + phaser. Ten sparse
  per-kind columns would have arrived as near-indicator variables and cost the
  cold start ten dimensions of posterior variance before the model said
  anything.
- The taste→grammar proposal tilt is **shrunk by θ's own uncertainty** rather
  than reading `theta_mean` raw, and the refinement budget scales with the op
  alphabet.
- The rack's ⋯ menu stopped reprinting the module list — **replace with…** and
  **insert after…** hand off to the rail with the socket pre-chosen. One
  inventory, one place.
- The tray is now **held**, and states its terms where it stands.

### Fixed

- The belief the sidebar shows is gated on **evidence, not prevalence**: a
  coefficient whose |mean| sits inside its own σ draws a dot on zero and says
  "the model has looked and has no lean either way", rather than a short bar
  and a direction the posterior does not have.
- Tube-mode distortion is now included in the voice's DC-blocker test — its
  asymmetric shaping emits real DC, which the amp envelope would otherwise
  multiply into a per-note thump and carry into every feature vector.

## [0.1.0] — 2026-07-30

The first tagged release: a playable, taste-learning instrument. The
attached `ricercar-v0.1.0-web.zip` is the prebuilt web app — unzip,
`python3 serve.py`, play.

### Changed
- Dependencies come from crates.io (`quiver-dsp 0.1.1`, `fugue-ppl 0.2.1`,
  `fugue-evo 0.3.1`) — a single clone builds. The quiver wasm32
  `SystemTime` panic was fixed upstream and released as `quiver-dsp 0.1.1`.
- Repository adopted the fugue-ecosystem / quiver OSS standards: MIT
  license, Makefile (`make check` = the CI gate), DEVELOPMENT.md,
  contributing + issue/PR templates, CI with separate
  fmt/clippy/test/wasm jobs under `-D warnings`, and this changelog.

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
