# Changelog

All notable changes to Ricercar are documented here, grouped by development
pass. The format is based on [Keep a Changelog](https://keepachangelog.com/);
the project is pre-1.0.

## [Unreleased]

### Added — φ_struct sees how a patch is *arranged*

- **Two arrangement coordinates in φ_struct**, so the taste model can hold an
  opinion about routing and not only about contents: `chain_balance` (mean
  source-to-root path over the longest one — an asymmetric branch, whichever
  side the chain is on) and `frac_sidechained` (binary nodes whose `/1` — a
  ducker's key, a vocoder's modulator — is a chain rather than a bare
  oscillator). `filter(mix(a, b))` and `mix(filter(a), b)` were *the same
  point* in φ before this: same counts, different instrument.
- Both are ratios of shape sums, never linear in any count, which is what keeps
  them clear of the two exact identities that put `size`, `depth` and `n_mix`
  out of φ in the first place. VIF over 300 draws: 2.7 and 2.4, against
  `mod_density` 5.6 and the standing `rolloff_mean` 19.6.
- **Four columns were written and two were cut, both by measurement**, and that
  is the more useful half of the change:
  - `branch_width_max` came back at VIF 10.4 and took `n_vco` from 3.1 to 9.1.
    WS-8 §4 asked for a parallelism coordinate on the reading that serial and
    parallel patches "differ only in `n_mix`". They do not: the leaf count is
    `1 + Σ binaries` exactly, so a patch cannot gain a mixer without gaining a
    source, and the source counts have been in φ since v1. A synthetic listener
    who "likes wide patches" was already learned to Spearman 0.709 by the *old*
    feature set, which says the same thing independently.
  - `mod_at_source` measured *well* — VIF 3.0, full spread — and is out on a
    tie the harness could not break. An 8-seed search-health run made three
    columns look like an unambiguous regression (climb +1.714 → +1.320, best
    patch 8.154 → 6.503, 7/8 seeds climbing → 5/8). At 16 seeds the harness's
    standard error on that quantity turned out to be ±0.64, and the paired
    differences are +0.35 ± 0.73 for two columns and −0.33 ± 0.74 for three:
    neither a regression nor an improvement anything here can see. So the tie
    goes to cost — every column is a dimension of posterior variance the cold
    start pays down — and to scope: two columns answer the question this wave
    was asked, and the third answers a different one. It stays as a display
    field, for a wave with evidence to spend and its own measurement.
- **The routing-lock copy now claims learning.** WS-8 §4 sequenced that
  deliberately: until these columns landed, "lock wiring" could only promise
  that evolution would leave the routing alone.
- **The pre/post evolution measurement, in one line each** (before → after,
  same seeds): pool climb +1.714 → +1.723 · MH acceptance 46.5% → 49.6% ·
  locked refine beat its parent 66% → 69% · fitted-vs-true ranking 0.318 →
  0.389 · true best survived the generation 98% → 100% · closed-loop
  calibration r 0.693 → 0.688 (se ±0.018). And for a synthetic listener whose
  taste *is* a routing preference: fit-vs-truth 0.662 → 0.705, true utility
  gain +2.016 → +2.669, and a pool that ends up 82% sidechained rather than
  71.6%. The full table is on `search_health`'s module doc.
- `search_health` gained three modes. `--routing` is a synthetic listener whose
  taste *is* a routing preference; it walks the term rather than reading
  `StructFeatures`, so the same measurement compiles and runs on both sides of
  a feature-set change. `--climb` runs the pool-climb gate alone at any seed
  count and prints the per-seed numbers, because ±0.4 in the mean gain is
  inside the seed-to-seed spread and the aggregate cannot tell a regression
  from a lottery. `--tail` runs the expensive back half alone, so an
  interrupted comparison run does not have to start over.

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
