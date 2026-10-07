# Five new films: scripts and storyboards

The spoken voice is [`www/brand/voice.md`](../../brand/voice.md)'s, and it wins
where this file differs (the voice is now speed 0.81, and nothing plays under
speech).

Each film has a `script.json` (narration, in the explainers' format) and a
`storyboard.md` (what is on screen, beat by beat). All five use the `study`
bed at 84 BPM, `loop_a` on the first beat and `loop_b` about halfway, the
`af_heart` voice at speed 0.9, `snap: "beat"`, beat lead and tail 0.2 (first
lead 1.5, outro tail 2.5), pauses of 0.4 s between lines and 0.7 s at the end
of a beat. Sentences are short and carry one idea each, because the script is
also the caption.

| Film | Title | Beats | Words | Kind |
|---|---|---|---|---|
| `math` | The math | 11 | 379 | illustrated |
| `dsp` | The sound engine | 11 | 380 | illustrated |
| `playing` | Playing it | 12 | 362 | walkthrough (footage) |
| `composing` | Composing with it | 11 | 316 | walkthrough (footage) |
| `sounddesign` | Sound design with it | 11 | 358 | walkthrough (footage) |

## Who each film is for

**The math** is for people who read the reference for fun: statisticians, ML
engineers, anyone who wants to disagree with the model on its own terms. They
should come away knowing the exact form of the utility (a max over linear
experts on standardized φ) and why a max and not a mixture; the three real
likelihoods (Bradley–Terry duels, a per-session threshold for kills, ordinal
stars with fitted cutpoints) and what each protects against; that the
posterior is MCMC draws kept current by exact importance reweighting, not a
Gaussian approximation; why forecasts are scored with Brier rather than
accuracy, per kind of evidence; that pairs are random because a measured
comparison said so; what the Boltzmann target is and why β is the only dial;
that shipped refinement climbs the target rather than sampling it; why a lock
is exact; and how PERFORM's controls are wired and checked.

**The sound engine** is for audio and DSP engineers and synth builders. They
should come away knowing that every patch is a real quiver graph ticked one
sample at a time, what the palette contains and how its two sorts are typed,
what every voice is forced to end with, how the standard phrase, BS.1770
loudness matching and the vetting gate make patches comparable and safe, the
real list of eighteen audio features and what the twenty-six structural ones
are, how LivePoly plays and swaps patches in the AudioWorklet without
allocating in steady state, and why the pool is identical however many render
workers run.

**Playing it** is for performers and keyboard players who want to play the
instrument rather than study it. They should come away able to play from the
computer keys, the screen keys or MIDI, use velocity as timbre, treat the six
named controls and the XY pad as expression, let Wander play along and stop it,
take or pass offers without stopping, use Keep and Back, and reach for the
dock's hold, unison, glide, arpeggiator and sync, MIDI learn and clock, and
booth mode.

**Composing with it** is for producers and composers building sounds for a
piece. They should come away knowing how to point the model at the piece (the
warm start and fast duels), what a generation does, the difference between
saving and rating, how to put timbre (Steps) and the arpeggiator on the tempo
and on an incoming MIDI clock, how to move between sounds inside and between
parts, and how to record takes and carry patches out as files and pictures
that open again.

**Sound design with it** is for sound designers who start from a preset and
want to end with their own sound. They should come away knowing how to read
and edit the rack, what locks guarantee and what *⚡ evolve from this* does
with them, how the node bank's arm-and-place works (green inserts, amber
replaces, preview before placing), what a spec card says about the model's
belief and its blind spots, how modulation chains are built, what the commit
duel records and how that differs from *my edit is better*, where unplugged
modules go, and where the history lives.

## Pronunciation: terms to add to `lexicon.json`

Phonemes are misaki US (the lexicon's own alphabet: `A` = eɪ, `I` = aɪ,
`O` = oʊ, `Y` = ɔɪ). "Check" means misaki probably has it; listen once.

| Term | Films | Suggested | ASR alias |
|---|---|---|---|
| Bradley-Terry | math | `bɹˈædli tˈɛɹi` (one entry, hyphen kept) | "Bradley Terry" |
| Boltzmann | math | `bˈOltsmən` | "Boltzman" |
| Brier | math | `bɹˈIəɹ` (BRY-er, after Glenn Brier) | "briar" |
| timbre | dsp, playing, composing | `tˈæmbəɹ` (misaki may say "timber") | "timber" |
| cutpoints | math | `kˈʌtpˌYnts` | "cut points" |
| reweights | math | `ɹiwˈAts` | "re-weights" |
| rolloff | dsp storyboard only | `ɹˈOlˌɔf` | "roll off" |
| WAV | composing | `wˈAv` (said "wave") | "wave" |
| AudioWorklet | dsp | `ˌɔdiO wˈɜɹklət` (check; the engine film's ASR heard "audio worklet") | "audio worklet" |
| Jacobian | math | check (misaki: `ʤəkˈObiən`, per `tts.py`) | — |
| Metropolis-Hastings | math | already in the lexicon | — |
| fugue-evo | math | already in the lexicon | "fugue evo" |
| arpeggiator | playing, composing | check (`ɑɹpˈɛʤiˌAtəɹ`) | — |
| quantizer | sounddesign | check (`kwˈɑntˌIzəɹ`) | — |
| sidechained | dsp | check (`sˈIdʧˌAnd`) | "side chained" |
| centroid | math | check (`sˈɛntɹˌYd`) | — |
| parsimony | math | check (`pˈɑɹsəmˌOni`) | — |
| PERFORM, PATCH, EVOLVE | several | read as words already (see the perform and circuit ASR reports) | — |
| forty-four, forty-two, Twenty-six | math, dsp | number words; the existing scripts' "Twenty-six" passed ASR | — |

Kept out of the narration on purpose, and put on screen instead: **LUFS**
(spoken as "loudness units"), **ITU-R BS.1770** (spoken as "the broadcast
way"), **BALD** (spoken as "the most informative pair"), **SVF** ("state
variable"), **s&h** ("sample and hold"), **K-weighting** ("K weighting", no
hyphen), and file extensions (`.auracle.json`, `.png`, `.svg`).

## Facts corrected, or not what the brief assumed

1. **The posterior is not a Laplace approximation.** `TasteModel::fit` runs
   fugue's adaptive single-site Metropolis–Hastings (3 000 warmup + 10 000
   steps, thinned to 500 draws); between fits each answer reweights the draws
   by sequential importance sampling, weights are systematically resampled when
   they concentrate, and `needs_refit()` asks for a full fit once a resample has
   happened (the app refits at most every six duels). The only Laplace in the
   repo is the landing page's toy demo (`www/landing/hero.js`). At the time of
   writing, the engine film's script still says "the posterior is a Laplace
   approximation" and its `film.js` draws a Gaussian ellipse labelled
   `Laplace: N(θ̂, H⁻¹)`; both should change, and the new films do not use
   either.
2. **Heard edits and self-reports do not have their own likelihood.** They are
   duels (Bradley–Terry) with a provenance tag. The three likelihoods are duels,
   keep/kill and stars; calibration is split by provenance (dealt duels,
   PERFORM offers, heard edits, self-reports). The engine film's `utility2`
   says otherwise.
3. **Keep/kill is emitted by the app.** The bank row's **cut** button records
   `record_keep(id, false)` after its 7 s undo window
   (`main.js` `cutRow`). The reference (`taste/likelihoods.md`: "No frontend
   emits this today") and the guide (`teaching.md`: "Nothing in the app
   records one yet") are stale. The math film says "Cutting a patch is a
   kill".
4. **Acquisition:** the shipped rule is uniform random pairing
   (`Acquisition::Random`). BALD (expected information gain) tied it on a
   synthetic listener in both a static and an evolving pool, and dueling
   Thompson sampling lost; random pairing also makes every duel an unbiased
   calibration check. The film says exactly that.
5. **The search target includes the taste tilt.** With a posterior, the
   grammar's categorical weights are tilted (η = 0.6, clamped to ¼…4) and that
   tilted grammar is installed as the prior, so the walk climbs
   `p_tilted · e^{β𝔼[u]}`, not `p_grammar · e^{β𝔼[u]}` (the reference's own
   September 2026 correction). The narration states π_β as the brief asked;
   the storyboard puts the tilt on screen as a footnote.
6. **Refinement climbs; it does not sample.** Forty adaptive MH steps from each
   of the ten best pool members, keeping the last state (`RefineKeep::Last`).
   Tempered SMC is the design, not the code. *⚡ evolve from this* is the same
   walk from one seed with the locks, and injects **one** child.
7. **"Keep/Back as scene changes"** is only half true. Keep holds one home at
   a time, and Back glides only when the structure is unchanged (otherwise it
   re-commits home, a jump). Scene changes are really saved patches stepped
   with `[` and `]`, which swap click-free with held notes carried (envelope
   phase included). The composing film says both.
8. **Sync is for Steps only.** It snaps each Steps module's rate to the
   nearest division of the tempo and restarts on the first key or a MIDI
   Start; it does not touch LFOs or the Euclidean module. A MIDI Start also
   restarts a running arpeggio when a chord is held (`restart_transport`).
9. **The guide's arpeggiator is wider than the app's.** `playing.md` lists an
   "order played" pattern and rates down to 1/32 with triplets; the dock offers
   up, down, up·down and random, at 1/4, 1/8, 1/16 and 1/8 triplet. The films
   claim only what the dock offers.
10. **MIDI Start and Stop are acted on.** `keyboard.md` says "Start, stop and
    continue are not acted on"; `midi.js` restarts the tempo-sync transport on
    Start and stops the phase lock on Stop (Continue is ignored). Program
    change calls `host.program`, which `main.js` never provides, so it does
    nothing; not claimed.
11. **The circuit film's Steps line** ("walk any knob through a pattern, in
    time with the tempo") overstates twice: a Steps module drives its slot's
    one fixed destination (cutoff, fold threshold, delay time …), and it runs
    free unless Sync is on.
12. **No allocation "on the audio path"** is true in steady state only. A patch
    swap compiles on the render thread while that node is silent, and the
    recorder and meters allocate while they run. The sound engine film says
    "in steady state".
13. **Kit labels.** `stage/kit.js`'s `PHI_AUDIO` names do not match
    `AudioFeatures::NAMES`: indices 7–10 read `attack · decay · sustain · tail`
    but the coordinates are `rms_std · crest · attack_s · tail_ratio`, and there
    is no decay or sustain coordinate. The taste and engine films draw those
    labels; the sound engine film needs the real ones (listed in its
    storyboard).
14. **Stale numbers in the reference and docs**, not used in the films:
    `notation.md` gives the feature dimension as 40 (the code fits on all 44);
    `features/structural.md` says seven unit coordinates (the code has six);
    `audition/vetting.md` says "forty-one doubles"; the web README says the
    preset library has 29 patches (it has 61) and that the node bank has eight
    groups (it has ten, adding *shape cv* and *combine cv*).
15. **HELD survives a reload** in the code (the tray is saved as UI state, and
    the rendered hint says so), but two static strings still say the
    opposite: the tray hint in `index.html` ("until you reload") and the help
    overlay ("held under the rack until you reload").
16. **`launch/shots.json`** switched views with `{"op": "view", "v": "patch"}`
    when the PATCH tab was `data-view="play"`. Fixed: the levels are the
    cross's stops (`.rail-stop[data-level]`), which `footage.mjs`'s `view`
    clicks, and launch's takes are generated by its `gen_shots.py`.
17. **Velocity, precisely:** computer keys play 0.78 and 1.0 with Shift; the
    screen keys take velocity from where the key is struck (0.35 at the top to
    1.0 at the front edge), or pen pressure; MIDI sends its own. Touch treats
    0.6 as "no change", so only notes softer than that play darker.
18. **Offers count only once heard** (Peek held, or Blend at or past half, for a
    second while notes sound); a Take counts after eight seconds unless *don't
    count it* is pressed. Keep, Back, turns and Wander are logged, not fitted.
19. **Saving is capped** at a quarter of the pool: 10 patches in the web app,
    whose pool is 40 (the engine's default is 48).
20. **Loudness matching stops at the peak.** Gain is the smaller of the
    distance to −18 LUFS, +30 dB, and the headroom to a peak of 1.0, so about
    15 % of patches audition below target rather than through a limiter.

## Things I could not verify, or that depend on the day

- Whether **Bright** reaches **Glass Pad** in a fresh session pool (the
  playing film's swell and XY beats assume it). The wiring depends on the
  session's standardizer; check the status line (`n of 6 controls reach`) and
  the ring before recording, and fall back to another pad if it is amber.
- How long a **refit after the warm start** takes on the recording machine;
  the taught set-ups wait on `#belief .bl-u` and `#evolve-btn:not([disabled])`
  with generous timeouts.
- Whether the **spec card** fills `#spec-dock` or the floating `#nb-spec` on
  hover in the current build; the sound design storyboard names both.
- The exact **socket keys** for arm-and-place (`.jack[data-childkey='node/0']`
  for "after the filter" on Glass Pad, `.jack[data-modkey='node/1/m']` for Sub &
  Sparkle's filter, `.jack[data-modkey='node/m']` for Ask The Dice's filter):
  derived from the trace-address scheme and `lightSockets()`, not measured.
  Record a `mark` on each before trusting the callouts.
- **Drift timing:** Wander's drift moves once every 14–36 s after 3.5 s of
  hands off, so a glide may not land inside the playing film's Wander beat.
  The storyboard says not to fake one.
- The acquisition, refinement-budget and purity numbers on screen in the math
  film are quoted from the reference's tables; I did not re-run
  `learn_synthetic`, `search_health` or `reach_census`.
- Pronunciation of the number compounds and of the terms marked "check" above
  has not been heard; run `asr_check.py` on the first voice pass.

## Tool and app gaps the storyboards flag (⚑)

- `footage.mjs`: `press` needs `ox`/`oy` (velocity from strike position);
  `dblclick` and `type` ops (renaming); a download filter so an export in a
  shot is not taken as its audio; a `drop` op (or an `eval` recipe) and a
  fixture patch file; a drag to a target element (putting a held module back).
- The shot's audio capture shares the app's recorder, so **● rec** cannot be
  pressed on camera until the capture has its own tap.
- A `?film` hook for **MIDI** (`midi.feed` exists but is private to
  `main.js`), plus a way to mark a device connected, for MIDI learn, pressure,
  the mod wheel and clock.
- `walk.js`: **a cut inside a beat** (two clip windows, or a clip rate), so a
  press and a result tens of seconds later (EVOLVE POOL, ⚡ evolve from this)
  can share a beat.
