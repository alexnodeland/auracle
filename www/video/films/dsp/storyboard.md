# The sound engine — storyboard

An illustrated film, no footage. Eleven beats, 380 words at speed 0.9. Every
drawing is of something `auracle-grammar`, `auracle-features` or
`auracle-wasm` actually does; numbers on screen carry their constant names.

**Build.** `films/dsp/film.js` in the style of `films/engine/film.js` (same
helpers: `stack`, `voiceLine`/`speak`, `wordTime`, `box`, `arrow`). Green
dominates this film: it is about sound. Amber appears only where the model
does (the quarantine fitness, the φ vector as the model's input).

**Kit gap.** `kit.js`'s `PHI_AUDIO` labels are not the real φ_audio names:
indices 7–9 read `attack · decay · sustain`, but the coordinates are
`rms_std`, `crest`, `attack_s`, and there is no `decay` or `sustain`
coordinate at all. Beat 8 needs `phiBars` to take a `names` option (or a
corrected constant) with the real list:
`centroid · centroid spread · rolloff · flatness · flux · zero crossings ·
level · level swing · crest · attack · tail · bass · held-note spread ·
high-note level · chord flatness · slow motion · mid motion · fast motion`
(`AudioFeatures::NAMES`, in that order).

**Audio.** The score bed plays under everything, as in the other explainers.
A beat that shows a render draws it and does not play it
([ADR-014](../../../../docs/decisions/014-the-films-sound.md): no cues).

---

## 1. `intro` (intro1)

- A green `scope` trace of Glass Pad's standard-phrase render sweeps across
  the frame. Eyebrow: `THE SOUND ENGINE`.
- On `intro1:graph` a small plate-and-cable chain (three `plate`s, two
  `cable`s) fades in on the left; on `intro1:voices` four thin voice lanes
  light on the right.

## 2. `graph` — quiver, one sample per tick, live knobs (graph1–3)

- **graph1.** Reuse the engine film's compile scene (`sceneCompile`): saw →
  ladder → vca → verb → out plates with green cables, lfo and env on amber
  mod cables. Caption pill: `quiver · modular synthesis in Rust`.
- **graph2.** On `graph2:tick` a mono counter `Patch::tick() → (L, R)` starts
  ticking and white sample dots travel the chain, one per tick.
- **graph3.** A large `knob` on the ladder turns. On `graph3:atomic` a leader
  from it to the running module is labelled `ParamHandle · AtomicF64 ·
  node/0#cut`, and the dots keep flowing (no pause, pill "no recompile"). A
  second, dimmer knob labelled `wave` beside it carries the tag "compile-time:
  a rebuild" (`window.__aur.nonLiveAddrs`).

## 3. `modules` — the palette, the filters, the types (modules1–3)

- **modules1.** The node bank as a picture: 42 glyph tiles in its ten groups
  (sources · shape · filter · space · motion · dynamics · combine ·
  modulation · shape cv · combine cv), drawn fresh or cropped from
  `landing/assets/screens/node-bank.webp`. On `modules1:plucked` the pluck
  tile lights; on `modules1:sidechained` comp, duck and gate light with their
  second (control) input drawn in amber.
- **modules2.** Four small magnitude responses: SVF low, band and high pass,
  and the diode ladder (label them "state variable ×3 · diode ladder"). On
  `modules2:ladder` a transfer curve: `tanh(1.2x)` above zero, `tanh(0.8x)`
  below (`DiodeLadderFilter::diode_sat`); a scope under it shows the
  resulting DC offset as a line lifted off zero.
- **modules3.** Port `VIZ['term-tree']`: green audio edges, amber dashed
  modulation edges. On `modules3:types` an amber mod term is dragged toward
  an audio socket and refused with a red ✕ and "cannot be constructed"
  (`AudioNode` / `ModNode`).

## 4. `compile` — the mandatory tail, bounded parameters (compile1–2)

- **compile1.** A row of plates:
  `⟨audio⟩ → DC blocker → VCA ← ADSR → Limiter → StereoOutput`.
  The DC blocker is labelled "SVF high pass at 20 Hz · only after a ladder or
  tube drive (`makes_dc`)"; on `compile1:blocker` it lights and the offset
  line from beat 3 drops to zero *before* the VCA. On
  `compile1:exponential` the ADSR draws an exponential contour and the VCA is
  tagged "exponential response". On `compile1:limiter` the limiter is tagged
  "threshold 5 V · a safety net; the real limiting is on the master bus".
  Small print: "built once per channel, so stereo tails stay stereo".
- **compile2.** Two green dials with capped arcs: resonance "× 0.85 — never
  self-oscillation", delay feedback "× 0.7 — cannot run away". The last part
  of each arc is drawn but greyed: the grammar cannot reach it.

## 5. `phrase` — the standard phrase, and determinism (phrase1–4)

- **phrase1.** Reuse the engine film's piano roll (`sceneAudition`), re-timed
  exactly to `PhraseSpec::default()` on a seconds axis: C4 on 0–1.80 s,
  C5 2.00–2.30 s, C4 + E4 2.45–2.95 s, C3 3.15–3.95 s, then its 1.10 s release
  window to 5.05 s. Tag: "44 100 Hz · 5.05 s".
- **phrase2.** Notes light in order on `phrase2:holds`, `phrase2:stabs` and
  `phrase2:chord`; the dyad's second voice is drawn on its own lane ("its own
  compiled voice, gate-synced").
- **phrase3.** On `phrase3:low` the C3 lights; the final 300 ms turns amber
  ("`tail_ratio` is measured here, which is why the low note is last").
- **phrase4.** Two renders of the same patch overlaid, then subtracted: the
  difference trace is a flat line at zero. Mono: `quiver::rng::seed(0xE05F00D)`
  before compile, "tick order fixed". On `phrase4:bit` the flat line glows.

## 6. `vetting` — the gate on the raw render (vetting1–3)

- **vetting1.** A raw (not yet normalized) waveform flows into a gate.
- **vetting2.** Four checks in the code's order, each a pill with its
  threshold: non-finite · silent (`RMS < 10⁻⁴`) · overlevel
  (`peak > 2.0 + 1.5·(voices − 1)` = 3.5 for the dyad) · DC
  (`|mean| / RMS > 0.6`). The narration names three; the pill for non-finite
  is on screen only. On `vetting2:silence`, `vetting2:runaway` and
  `vetting2:DC` three failing waveforms bounce off their gates.
- **vetting3.** The failures drop into a quarantine box tagged in amber
  "fitness −50 (`QUARANTINE_FITNESS`) · never played"; the passing render
  continues right to beat 7. Small print: "a domain check on the term runs
  even before the render".

## 7. `loudness` — BS.1770, to −18 LUFS (loudness1–3; music `loop_b`)

- **loudness1.** Port `VIZ['k-weighting']`: the evaluated response (high
  shelf +4 dB above 1 682 Hz, high pass at 38 Hz) with its two dashed
  components. Tag: "ITU-R BS.1770 · K weighting". Then the waveform is cut
  into 400 ms blocks at 75 % overlap; blocks below −70 LUFS grey out
  (absolute gate), then blocks 10 LU under the mean grey out (relative gate).
- **loudness2.** Reuse the engine film's meter: integrated loudness settles
  on the target line "−18 LUFS (`TARGET_LUFS`)". Two traces, a bright patch
  and a bass patch, end at the same loudness though not the same RMS.
- **loudness3.** Gain as a formula:
  `gain = min(−18 − L, +30 dB, headroom to peak 1.0)`. A percussive waveform
  scales up until its peak touches 1.0 and stops there, short of the target.
  Small table from `audition/loudness.md` (150 vetted draws): peak p99
  2.098 → 1.000 · over full scale 22 → 0 · 15 % give up gain, 3.0 dB on
  average. Tag: "a scalar, not a limiter: timbre untouched".

## 8. `features` — φ_audio (18) and φ_struct (26) (features1–6)

- **features1.** `phiBars` with the real labels (see the kit gap above) grows
  in; pill `φ_audio · 18`.
- **features2.** Bars 0, 1, 2 and 5 (centroid, centroid spread, rolloff,
  zero crossings) stay lit, the rest dim. Beside them, port `VIZ['log-axis']`:
  one octave is the same distance at 200 Hz and at 8 kHz. Formula:
  `log_axis(f) = log₂(max(f, 20)/20) / log₂(f_Nyq/20)`.
- **features3.** Bars 3–4 (flatness, flux) light as "texture", 6–8 (level,
  level swing, crest) as "level", 9–10 (attack, tail) as "envelope", then
  11 (bass, "energy below ~250 Hz").
- **features4.** Bars 12–14 light, each with a leader to its note on a small
  copy of the phrase roll: held-note centroid spread → the held C4, high-note
  level → the C5 stab, chord flatness → the dyad. Then 15–17 light.
- **features5.** Over the held note: a modulation spectrum with three band
  humps, 0.5–2 Hz, 2–8 Hz, 8–30 Hz (`MOTION_BANDS`), labelled "sweeps ·
  pulsing · flutter", each feeding its bar. Formula, small:
  `motion_B = ½ log₂(v_B(brightness) + v_B(level) + 10⁻⁴)`.
- **features6.** The engine film's 26-cell structural grid:
  "19 family counts + 7 term-level numbers · no compile, no render". Pill
  `φ_struct · 26`, then `φ ∈ ℝ⁴⁴` in amber.

## 9. `live` — LivePoly in the AudioWorklet (live1–4)

- **live1.** A box "AudioWorklet" with a row of four green voice lanes, label
  "slot A · 4 voices (`LivePoly`)". Arrow from a `compile()` box on the left.
- **live2.** A second row of four, "slot B · PERFORM's offers", and between
  them `y = cos(πm/2)·A + sin(πm/2)·B`, `m ← m + 0.002 (m* − m)` (about
  10 ms at 48 kHz). On `live2:equal` a blend dot slides from A to B.
- **live3.** A strip of render quanta; each writes into the same persistent
  buffer (`process_ptr`), tag "no allocation per quantum".
- **live4.** A patch-swap timeline: fade out (≈6 ms) → rebuild voice 1, 2,
  3, 4, one per quantum at zero gain → the held chord is re-pressed with its
  envelope phase carried (no new attack) → fade in. On `live4:held` the
  chord's keys stay lit across the gap. Small print: "master limiter across
  the sum, ceiling 0.98".

## 10. `farm` — the render farm (farm1–2)

- **farm1.** Star topology: the main thread spawns the engine worker and
  N render workers and hands each a `MessagePort`; the engine worker sits at
  the centre. `N = clamp(cores − 2, 0, 6)`, 2 when `deviceMemory ≤ 4`.
- **farm2.** Draw `i` is `splitmix64(fill_seed, i)`. Workers finish out of
  order (dots arrive 3, 1, 4, 2 …) but the pool strip fills strictly in index
  order. On `farm2:identical` three pools computed at widths 0, 2 and 6 stack
  and match; tests named small: `farm_width_does_not_change_the_pool`,
  `farm_absorption_reproduces_the_serial_pool`.

## 11. `outro` (outro1)

- One box, `auracle_grammar::compile`, with two arrows out: up to "search:
  render → vet → normalize → φ", down to "LivePoly: 4 + 4 voices". On
  `outro1:measured` both arrows pulse together. The lockup from the engine
  film's outro follows; fade over the 2.5 s tail.
