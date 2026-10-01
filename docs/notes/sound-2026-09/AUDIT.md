# Auracle films: audio audit

Date: 2026-09-30. Repo HEAD `7c893ad`. This audit records facts and measurements only. It does not propose a direction. It is round 1 of the sound work in this folder, kept as it was written: a record, not kept current.

Paths are relative to the repo root. The audit's working files are not part of this record and are not in the repo: its renders, rebuilt mixes, measurement scripts and their output.

## Method

- **Scores rendered at HEAD** into a working folder: `stingers.json`, `study.json` and `signal.json`. All 77 WAVs are bit-identical (md5) to `www/video/out/sound/`, so the renders on disk are current.
- **Each film's bed** was fitted with `tools/fit_score.py` into a working folder and rendered there, for the nine films with no render in `out/`. For the six films in `out/`, the fitted JSONs I made are identical to `out/<film>/study.fitted.json`.
- **Levels**: `sound/analyze.py`, run with `.venv-voice/bin/python`. It needs pyloudnorm 0.2.0, which is installed there, and nothing was installed. Centroid and band shares come from the audit's own numpy/scipy code: Welch PSD with 8192-point segments.
- **Six walkthrough mixes** (tour, playing, view-perform, view-patch, view-evolve, view-taste) were rebuilt stem by stem with a copy of `mix.py`'s `main()` arithmetic that writes nothing into the repo. Each rebuild matches `out/<film>/mix.wav` to a residual of −181 to −189 dB. Per-stem numbers are measured on the rebuilt stems after the final gain.
- **Momentary loudness** is BS.1770 over 400 ms blocks with a 100 ms hop. A stem counts as "audible" above −60 LUFS in §3 and above −50 LUFS in §2 (§2 uses the bed normalised to −24 LUFS as mixed).
- **Five published films** (`www/landing/assets/film/*.mp4`) were decoded for checks.
- **Cue counts**: the six `out/*/cues.json` lists exist and were counted by cue name. The illustrated films have no cue list on disk, so their counts come from evaluating each `stage.sfx()` call site in `film.js`, loop lengths included. I did not run `render.mjs --cues`, because it writes into `out/`.
- `zzprobe` is excluded. It is a one-shot probe copy of `playing` (its `arrangement.json` says `"film": "playing"`).
- The audit's scripts import `mix.py`, so they write a `.pyc` into `www/video/tools/__pycache__/`. That folder is git-ignored. The one this audit created was deleted afterwards. Re-run the scripts with `PYTHONDONTWRITEBYTECODE=1`.
- The raw numbers were kept with the working files.

---

## 1. Cues

### What each cue is (`www/video/sound/stingers.json`, 60 BPM, seed 20260927)

| Cue | Tracks → preset | Treatment | Pitch | Length, loudness, true peak (analyze.py) |
|---|---|---|---|---|
| `whoosh` | `noise` → **Static Ocean** (L18–29) | White noise, resonant bandpass, large reverb. Attack 0.58, release 0.5, LFO depth 0, res 0.45. Cutoff automated 0.32 → 0.86 (+0.7 s) → 0.62 (+1.2 s). `_why`: "a pass-by" (L21) | C4 note on noise, so effectively unpitched | 1.45 s, −17.6 LUFS, −9.6 dBTP |
| `blip` | `blip` → **Tine** (L30–38) | One A5 note held 60 ms, release knob 0.5 → 0.42, −4 dB. `_why`: "a soft sine click with a glassy top" | A5 | 0.34 s, −22.3 LUFS (zero-padded), −11.4 dBTP |
| `offer_shimmer` | `shimmer_bell` → **Ghost Bell** (L39–51) + `shimmer_pad` → **Glass Pad** (L52–65) | 8 bell strikes climbing A4→E6 in 0.63 s, velocity rising 0.40→0.70. Under them an open fifth (A4 E5 A5) swells in, fader −24→0 dB over 0.8 s, cutoff 0.45→0.82 | A minor pentatonic (L3) | 1.86 s, −18.8 LUFS, −8.8 dBTP |
| `logo_sting` | `sting_boom` → **Deadfall** (L66–76) + `sting_body` → **First Bass** (L77–88) + `sting_bell` → **Ghost Bell** (L89–99) | Boom: D1 and D2 sines with a 12-semitone pitch drop (τ 150 ms, L74). Body: the same drop on D2 (L86). Bell: D6 + A6 struck with it | D | 3.11 s, −17.8 LUFS, −1.0 dBTP |
| `render_glass_pad` (dsp only) | Not in `stingers.json`. The comment at `films/dsp/film.js:323` points to `out/dsp/sfx/render_glass_pad.wav` | — | — | **The file does not exist.** `illustrated.sh:22` passes `--sfx out/sound/stingers`, and `mix.py:271–273` skips a cue with no WAV without saying so |

How `mix.py` levels a cue (L276): a cue longer than 0.4 s is normalised to −24 LUFS, then the cue's own gain is applied. `blip` (0.34 s) is normalised by peak instead, to 0.25 (−12 dBFS), then its gain. Voice sits at −18 LUFS in the same stage. So a whoosh at −3 to −10 dB lands 9–16 LU under the voice, and a logo sting at −2 dB lands 8 LU under it.

### Which films use each cue, counted by cue name

| Film | whoosh | blip | offer_shimmer | logo_sting | render_glass_pad | Source |
|---|---:|---:|---:|---:|---:|---|
| launch | 5 | 22 | 1 | 1 | – | `films/launch/film.js` |
| taste | – | 9 | 1 | 1 | – | `films/taste/film.js` |
| math | – | – | – | 1 | – | `films/math/film.js:2312` |
| engine | – | – | – | 1 | – | `films/engine/film.js:701` |
| dsp | – | – | – | 1 | 1 (dropped) | `films/dsp/film.js:325, 2338` |
| tour | 1 | – | – | – | – | `out/tour/cues.json` (`films/tour/cards.js:65`) |
| playing, view-perform, view-patch, view-evolve, view-taste | – | – | – | – | – | `out/<film>/cues.json` = `[]` |
| circuit, composing, perform, sounddesign | – | – | – | – | – | No `sfx()` call in their sources |
| **Total** | **6** | **31** | **2** | **5** | **1** | |

Launch also has a second logo hit inside its bed: Signal's own `sting` section (`signal.json:18`, with boom L241–251, boom_body L252–263 and bell L193) at 93.6 s.

### When each cue plays

| Cue | Film | Moment | film.js line, gain |
|---|---|---|---|
| whoosh | launch | 0.9 s before the title lockup ("a synthesizer that searches for your sound") | :222, −3 |
| whoosh | launch | Start of the `grow` beat ("and it grows new patches toward it") | :450, −8 |
| whoosh | launch | Start of the `play` chapter ("Then you play it") | :536, −4 |
| whoosh | launch | Start of the `depth` chapter ("Open the circuit…") | :686, −6 |
| whoosh | launch | Start of the `close` chapter ("Every note in this film is Auracle") | :773, −6 |
| whoosh | tour | Title card, 13.936 s | cards.js:65, −10 |
| blip ×3 | launch | Open: three knob turns | :126, −6 |
| blip ×3 | launch | Duel: hear A, hear B, pick B | :320, −2 |
| blip ×11 | launch | Duel: a run of duels, one per beat, as the pick counter climbs | :322, −12 |
| blip ×5 | launch | Perform: turn Bright, let it wander, press Offer, blend, take | :537–539, :541–542, −2 to −4 |
| blip ×1 | taste | Hook, on "like," | :80, −4 |
| blip ×6 | taste | Posterior: six picks | :207, −8 |
| blip ×1 | taste | Forecast, on "checks" | :333, −4 |
| blip ×1 | taste | Playing, on "take" | :478, −4 |
| offer_shimmer | launch | The offer appears (`offer1` +0.5 s) | :540, −2 |
| offer_shimmer | taste | On "an offer" | :477, −4 |
| logo_sting | launch | Wordmark lockup, title beat +1.85 s | :223, −5 |
| logo_sting | taste, math, engine | End card, 0.1 s before the outro beat | taste:518, math:2312, engine:701, −2 |
| logo_sting | dsp | End card, 0.15 s after the outro's first line ends (`tLk − 0.1`, with `tLk = l1.t1 + 0.25`) | dsp:2337–2338, −2 |
| render_glass_pad | dsp | Intro +0.3 s, "the engine's own normalized audition" | dsp:325, −6 |

The published dsp.mp4 is consistent with the Glass Pad render being absent. Between 0.35 and 1.35 s (before the first line, at 1.5 s) its spectral centroid is 655 Hz, against 862 Hz for the fitted bed alone. Its momentary loudness follows the bed at a constant +8.7 to +9.0 dB offset, and nothing extra is added.

---

## 2. Beds

### Score facts

| | **Signal** (`sound/signal.json`) | **Study** (`sound/study.json`) |
|---|---|---|
| Used by | launch only | The other 14 films (SCRIPTS.md:4–5, VIEWS.md:70) |
| Key | D minor (L2) | F Lydian (L2). Pitch set F G A B C D E, the same as C major |
| Tempo, meter | **100 BPM**, 4/4 (L5) | 84 BPM, 4/4 (L5) |
| Form | intro 4, build 8, main_a 8, main_b 8, breakdown 4, finale 8, sting 2 bars (L11–19) | loop_a 16 bars and loop_b 16 bars, seamless loops (L11–14) |
| Progression | Dm9 \| Bbmaj7 \| Fmaj7/A \| C6sus2, one chord per bar, in every section. Finale ends on Dm(add9) (L3, patterns L39–49) | Fmaj7 \| G6/F \| Em7 \| Am7, four times per loop (L3) |
| Tracks → presets | pad **Glass Pad**; loom **Loom**; bass **First Bass**; arp **Acid Line** (16ths, up-down); lead **Bell Jar**; bell **Ghost Bell**; kick **Deadfall**; hat **Flint**; riser **Static Ocean**; boom **Deadfall**; boom_body **First Bass**. That is 11 tracks on 9 presets | pad **Cathedral**; pluck **Tine**; bass **First Bass** (loop_b only). That is 3 tracks on 3 presets |
| Master | Fitted to a −1 dBFS peak | Fixed at −9.8 dB (L10) |

### Measurements (renders at HEAD; LUFS and TP from analyze.py; centroid and bands from Welch)

| File | s | LUFS | TP dBTP | Centroid Hz | Frame-median centroid Hz | <60 Hz % | 60–120 % | 120 Hz–1 kHz % | 1–4 kHz % | >4 kHz % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| signal/full | 102.54 | −21.5 | −2.6 | 572 | 456 | 14.1 | 22.4 | 53.9 | 7.9 | 1.8 |
| signal/intro | 12.11 | −29.7 | −17.6 | 704 | 579 | 0.0 | 0.0 | 77.6 | 20.5 | 1.9 |
| signal/build | 20.59 | −23.8 | −9.2 | 344 | 260 | 19.0 | 24.6 | 50.5 | 5.5 | 0.5 |
| signal/main_a | 20.60 | −21.6 | −3.7 | 539 | 434 | 14.9 | 25.1 | 51.1 | 7.1 | 1.8 |
| signal/main_b | 20.50 | −20.2 | −3.1 | 648 | 527 | 12.0 | 20.9 | 57.4 | 7.8 | 2.0 |
| signal/breakdown | 12.13 | −27.8 | −16.0 | 614 | 559 | 0.0 | 0.0 | 88.9 | 11.0 | 0.1 |
| signal/finale | 24.78 | −19.8 | −1.0 | 671 | 501 | 11.1 | 21.8 | 54.7 | 9.9 | 2.5 |
| signal/sting | 6.54 | −24.3 | −6.3 | 301 | 104 | **63.2** | 20.3 | 7.3 | 7.1 | 2.1 |
| study/loop_a | 45.71 | −26.8 | −15.2 | 458 | 367 | 0.0 | 1.2 | 94.9 | 3.9 | 0.1 |
| study/loop_b | 45.71 | −26.3 | −14.0 | 373 | 294 | 4.4 | 17.3 | 75.3 | 3.0 | 0.1 |

- Signal spans 9.9 LU from section to section, from intro −29.7 to finale −19.8. The two Study loops sit 0.5 LU apart.
- Per-track centroids, Signal full stems: hat 12 932 Hz, riser 4 032, bell 1 481, arp 1 451, lead 1 034, pad 483, loom 410, kick 149, boom_body 135, bass 126, boom 77.
- Per-track centroids, Study: pluck 956 Hz, pad 278 (study.json:19 claims 282), bass 89.
- Study's loop seams are clean: the wrap step sits at the 31st–46th percentile of ordinary steps (analyze.py). All 77 files are under −1 dBTP, with no DC and no non-finite samples.

### Share of each film's runtime with a bed audible

"Intended" is where `arrangement.json` puts a section and its `levels` are above −60 dB. "Audible" is measured on the bed as the pipeline actually renders it (fitted, laid out and levelled as `mix.py` does it, before ducking).

| Film | Bed | Duration s | Intended | Audible | of which pad/pluck s | of which bass only s | Intended but silent (s, spans) |
|---|---|---:|---:|---:|---:|---:|---|
| launch | Signal | 98.4 | 98.1 s (99.7%) | 95.0 s (96.5%) | — | — | 3.1 (0.2–1.4 fade-in; 96.4–98.2 after the sting) |
| taste | Study | 108.6 | 107.5 s (99.0%) | 108.2 s (99.7%) | 84.5 | 23.7 | 0 |
| math | Study | 165.7 | 164.8 s (99.4%) | 121.2 s (**73.1%**) | 93.5 | 27.7 | **43.8 (46.8–90.6)** |
| engine | Study | 137.1 | 136.1 s (99.2%) | 128.7 s (93.8%) | 93.5 | 35.2 | 7.5 (46.8–54.3) |
| dsp | Study | 168.6 | 168.2 s (99.8%) | 132.3 s (**78.5%**) | 93.6 | 38.7 | **35.9 (46.8–82.7)** |
| circuit | Study | 77.1 | 76.3 s (98.9%) | 76.8 s (99.6%) | 76.8 | 0 | 0 |
| perform | Study | 108.6 | 107.4 s (98.9%) | 94.4 s (86.9%) | 93.5 | 0.9 | 13.2 (46.8–60.0) |
| composing | Study | 148.6 | 148.2 s (99.8%) | 138.1 s (93.0%) | 93.7 | 44.4 | 10.1 (46.9–57.0) |
| sounddesign | Study | 162.9 | 162.5 s (99.8%) | 118.0 s (**72.5%**) | 93.6 | 24.4 | **44.5 (46.8–91.3)** |
| playing | Study | 142.9 | 142.0 s (99.4%) | 132.6 s (92.8%) | 93.6 | 39.0 | 9.5 (46.8–56.3) |
| tour | Study | 140.0 | 50.6 s (36.1%) | 30.7 s (21.9%) | 30.6 | 0.1 | 20.4 (82.9–103.3, the `header` beat) |
| view-perform | Study | 334.3 | 57.6 s (17.2%) | 47.0 s (14.1%) | 23.3 | 23.7 | 11.9 (chapter turns at 58, 103, 140, 163 s) |
| view-patch | Study | 305.7 | 52.5 s (17.2%) | 40.7 s (13.3%) | 22.5 | 18.2 | 13.0 (turns at 91, 117, 149, 174 s) |
| view-evolve | Study | 280.0 | 51.6 s (18.4%) | 43.2 s (15.4%) | 25.0 | 18.2 | 9.8 (turns at 60, 89, 109 s) |
| view-taste | Study | 251.4 | 146.2 s (58.1%) | 119.0 s (47.3%) | 79.9 | 39.1 | 27.8 (46.9–74.7, the `map` beat) |

- **Why the silent spans exist.** Study's pad and pluck are `phrase` patterns with a fixed repeat count: 4 × 4 bars (study.json:24, :30) and 2 × 8 bars (:46, :55), so 16 bars each. `fit_score.py` lengthens a section, but for patterns it changes only `bars` and `start_bar` (L65–81), never `repeat`. As a result, any section fitted longer than 16 bars plays pad and pluck for 16 bars (45.7 s) and then stops.
  - loop_a has nothing else in it, so it goes **silent**.
  - loop_b keeps only the bass, whose `pulse` pattern fills any length (L75), so it goes **bass-only**.
  - A film can therefore hear pad and pluck for at most about 93.6 s, whatever its length.
- **Published films confirm it.** In math.mp4 and dsp.mp4, the narration gaps inside the predicted silent span measure digital silence: −120.7 LUFS momentary, over 1.8 s and 1.1 s of gap. Outside that span, the gap medians are −26.4 and −28.3 LUFS.
- The view films' `levels` bring the bed up only for the title, one-bar chapter turns and the outro. That follows VIEWS.md:70–72.
- view-taste's `map` beat (45.7–73.9 s) is the longest intended-but-silent span in the view films. For 28 s the arrangement asks for the bed at 0 dB, but loop_a is past bar 16 and the shot has no app sound. The rebuilt mix has music on for 1.2 s of it and the app on for 0 s, so the beat is narration alone.
- Of the walkthroughs, circuit, composing, perform, playing and sounddesign have **no `levels`**, so the bed plays under every demo. Only tour and the four view-* films set `levels`.

---

## 3. The mix ladder (`www/video/tools/mix.py`)

| Layer | Rule | Where | Value in the pipeline |
|---|---|---|---|
| Voice | Normalised to −18 LUFS integrated | L226–229 | −18 |
| Music | Normalised to −18 + `music_db` | L199, L244–246 | Default −9 (→ −27 LUFS). **Pipeline −6 (→ −24 LUFS)** (`illustrated.sh:22`, `walkthrough.sh:49`) |
| Bed levels | `arrangement.json` `levels`, 0.4 s linear ramps, ≤ −60 dB means out | L247–264 | Per film (§2) |
| Ducking | Music × 10^(duck·env/20). `env` is an envelope follower (80 ms attack, 450 ms release, L171) of a mask that is 1 wherever the voice's 5 ms RMS is above −45 dBFS (L300–302) | L298–307 | **Three values:** the docstring says −9 (L30), the argparse default is −8 (L200), and both pipeline scripts pass **−9** |
| Effects | Cues longer than 0.4 s go to −24 LUFS, shorter ones to a 0.25 peak, then the per-cue gain | L266–277 | — |
| App sound | The recorded master bus × `gain_db`, **not loudness-normalised**. Cut to its beat's window, with a 120 ms fade in and 250 ms fade out | L279–296 | −3 dB (`app_audio.py:90`, `walkthrough.sh:48` `APP_DB`) |
| App ducking | **Half the music's duck**: 10^(0.5·duck·env/20) | **L308** | **−4.5 dB** (−4 at the default) |
| Master | The whole mix gained to −16 LUFS, then a look-ahead limiter (ceiling −1.2 dBTP, 5 ms look-ahead, 80 ms release) | L317–319, L133 | −16 LUFS |

### Measured on the six rebuilt walkthrough mixes (integrated LUFS, after the final gain)

| Film | Final gain | Voice | Music (ducked) | Music (unducked) | App (ducked) | App (unducked) | FX | Bed audible s | App audible s | Both sounding s | App under bed s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| tour | +1.86 | −16.1 | −26.0 | −21.9 | −18.8 | −16.9 | −31.7 | 30.7 | 85.8 | 2.2 | 0.5 |
| playing | +1.14 | −16.9 | −28.9 | −22.9 | −20.4 | −17.3 | — | 132.7 | 130.4 | **120.6** | **10.7** (9.8 of it under narration) |
| view-perform | +1.30 | −16.7 | −24.9 | −23.5 | −19.1 | −16.4 | — | 48.1 | 244.5 | 4.2 | 0.9 |
| view-patch | +1.57 | −16.4 | −24.6 | −23.4 | −18.2 | −16.3 | — | 41.4 | 216.0 | 6.7 | 1.8 |
| view-evolve | +2.34 | −15.7 | −22.6 | −21.2 | −19.0 | −17.3 | — | 43.7 | 93.1 | 2.0 | 0.8 |
| view-taste | +2.11 | −15.9 | −27.0 | −21.0 | −17.3 | −15.8 | — | 119.7 | 48.6 | 0.5 | 0.2 |

- **Raw app takes.** The recorded shot WAVs in `out/<film>/shots/*.wav`, measured before the −3 dB, have median integrated loudness of −14.4 to −16.9 LUFS depending on the film. The film minimums run from −16.6 to −21.7 LUFS. tour, view-evolve and view-taste each have silent shots (3, 1 and 7).
- **Per beat in playing** (medians of momentary loudness while sounding):

  | Beat | Bed | App | App minus bed |
  |---|---:|---:|---:|
  | keys | −29.8 | −30.4 | +0.9 dB (6.1 s under the bed) |
  | touch | −29.4 | −31.0 | −1.8 dB (3.1 s under the bed) |
  | controls, wander, offer | about −29 | −21.7 to −22.4 | +7 to +8 dB |
  | midi, booth, outro | −37.5 to −39.4 (bass only, past bar 16 of loop_b) | — | — |

- **Published illustrated films.** These are voice, bed and effects only, with no app sound.

  | Film | Median momentary during speech (LUFS) | Median in narration gaps (LUFS) | Gap level relative to speech |
  |---|---:|---:|---:|
  | launch | −16.0 | −17.7 (finale −16.4, main_b −16.3) | 1.7 dB below overall; 0.3–0.4 dB below in main_b and the finale |
  | taste | −16.3 | −30.5 | 14.2 dB below |
  | math | −16.2 | −26.4 | 10.2 dB below |
  | engine | −16.4 | −30.4 | 14.0 dB below |
  | dsp | −16.4 | −28.3 | 11.9 dB below |

**Can the instrument's own sound sit below the music bed? Yes.** The pipeline sets no level for the app against the bed.

- **How the levels are set.** The bed is loudness-matched to −24 LUFS. The app is laid in at whatever level the take recorded, minus 3 dB. Under narration the bed ducks 9 dB and the app only 4.5 dB. On integrated loudness the app ends up above the bed in every rebuilt film, by 3.6 LU (view-evolve) to 9.7 LU (view-taste) once both are ducked.
- **When it happens:**
  1. **Films with no `levels`**, where the bed plays under the demos. In playing, the app is under the bed for 10.7 s of the 120.6 s where both sound, mostly in the `keys` and `touch` demos, and 9.8 s of that is under narration. circuit, composing, perform and sounddesign are built the same way. They have no mix on disk, so they could not be measured.
  2. **Chapter turns in the view films**, where the bed comes up to 0 dB for one bar while the previous shot's sound decays. This lasts 0.2–1.8 s per film. For example, at view-evolve `turn6` the app is at −41 LUFS against the bed's −18.

  In both cases a quiet passage of playing, soft keys or a decaying tail, falls under the bed.

---

## 4. The cast

### What each film plays

"Shots" is the number of shots whose set-up loads the preset (`op: preset` in `shots.json`).

| Film | Kind | Bed presets | Stinger presets heard | On-camera presets (shots) | Shots with no preset op (sound dealt, bred or offered by the seeded session) |
|---|---|---|---|---|---|
| launch | Illustrated, plus 3 footage shots | Signal: Glass Pad, Loom, First Bass, Acid Line, Bell Jar, Ghost Bell, Deadfall, Flint, Static Ocean | Static Ocean, Tine, Ghost Bell, Glass Pad, Deadfall, First Bass | Glass Pad 2, First Bass 1. **Seen, not heard**: `illustrated.sh` passes no `--app` | — |
| taste | Illustrated | Cathedral, Tine, First Bass | Tine, Ghost Bell, Glass Pad, Deadfall, First Bass | — | — |
| math | Illustrated | Cathedral, Tine, First Bass | Deadfall, First Bass, Ghost Bell | — | — |
| engine | Illustrated | Cathedral, Tine, First Bass | Deadfall, First Bass, Ghost Bell | — | — |
| dsp | Illustrated | Cathedral, Tine, First Bass | Deadfall, First Bass, Ghost Bell (plus the Glass Pad render cue, dropped) | — | — |
| circuit | Walkthrough, 8 shots, not seeded | Study | — | Glass Pad 5, Loom 1, First Bass 1 | 1 (c-evolve) |
| composing | Walkthrough, 11 shots, seeded | Study | — | Glass Pad 4, Loom 3, First Bass 2, Sub & Sparkle 1, Acid Line 1 | 4 (direction, evolve, keep, outro) |
| perform | Walkthrough, 11 shots, not seeded | Study | — | Glass Pad 10, Ceiling 1 | 0. Offers grown from Glass Pad in p-offer and p-take |
| playing | Walkthrough, 12 shots, seeded | Study | — | Glass Pad 10, Acid Line 1 | 1 (booth). Offers in wander and offer |
| sounddesign | Walkthrough, 11 shots, seeded | Study | — | Glass Pad 10, Ask The Dice 1 | 0. Bred children in evolve and bank; duels in commit |
| tour | Walkthrough, 8 shots, seeded | Study | Static Ocean (whoosh) | Glass Pad 6, Acid Line 1 | 1 (first). Duels in views and header |
| view-perform | Walkthrough, 10 shots, seeded | Study | — | Glass Pad 7, Tine 1, Loom 1, Acid Line 1 | 0. Offers in honest, offer, wander and together |
| view-patch | Walkthrough, 11 shots, seeded | Study | — | Glass Pad 7, Acid Line 2, Ask The Dice 1, Loom 1 | 0 |
| view-evolve | Walkthrough, 10 shots, seeded | Study | — | **none** | **10 of 10**: duels, pool and breeding |
| view-taste | Walkthrough, 12 shots, seeded | Study | — | **none** | **12 of 12**: map and pool patches, duels |

- The high name counts in `view-taste/shots.json` (for example 75 mentions of each preset) come from its `init` JavaScript, which lists every preset. They are not plays.
- The names on launch's duel cards (`launch/film.js:280–289`: "Hollow Reed", "Rust Choir"…) are invented labels, apart from Glass Pad. They are drawn, not heard.
- On camera the demos play C, Am, F and G, in the order C–Am–F–G (`playing/gen_shots.py:169`, `sounddesign/gen_shots.py:271`). On the app's keymap these are `a d g`, `h k ;`, `f h k` and `g j l` (`apps/web/main.js:4234–4237`). Across the 11 shot files the holds are C 68, Am 33, F 25 and G 17. view-taste and view-perform also hold Fmaj7 (`f h k ;`) and Em7 (`d g j l`).

### Presets that recur across films

| Preset | Where it is heard or seen |
|---|---|
| **Glass Pad** | Loaded on camera in 9 of the 11 films that have shots (61 of 107 shots, 57%). Also Signal's pad, the shimmer's pad and dsp's (missing) render cue |
| **Cathedral**, **Tine** | Study's pad and pluck, so the bed of all 14 Study films. Tine is also the `blip` (31 plays) and one view-perform shot |
| **First Bass** | Study's bass (loop_b), Signal's bass and boom_body, the logo sting's body (5 films), and on camera in circuit, composing and launch |
| **Ghost Bell** | Signal's bell, the shimmer's bells and the logo sting's bell |
| **Deadfall** | Signal's kick and boom, and the logo sting's boom |

### Floor and approval

**No cast sound is recorded as approved, and none is recorded as above the sonic floor.**

- RFC-004 §6 (L227–231) says a walkthrough plays "presets, or patches chosen from above the floor" and that "a film's sounds are listened to and approved before recording". Decision 6 (L332) and ADR-011 (L49–50) repeat the rule. Plan-004 task 8 (L106) schedules it "once RFC-005 lands".
- There is no RFC-005 in `docs/proposals/`. No approval record exists in `www/video/` or `docs/`.
- The film runbook (`docs/runbooks/finish-the-view-films.md:8–19`) holds round one, partly because "the sounds the seeded session dealt were often blaring, noisy or harsh".
- view-evolve and view-taste load no preset at all. Every sound in them is what the seed deals.

---

## 5. Launch-video tropes, measured

| Trope | Present | Where (file:line) | Measured | Heard in |
|---|---|---|---|---|
| Pass-by whoosh | Yes | `stingers.json:18–29` (`_why` "a pass-by", L21; sweep L27) | Centroid rises from 0.78 kHz (0.1 s) to 6.5 kHz (0.8 s), then falls to 4.7 kHz (1.0 s) as it fades. 49% of energy above 4 kHz; overall centroid 4.7 kHz | launch ×5 (film.js:222, 450, 536, 686, 773), tour ×1 (cards.js:65) |
| Riser | Yes | `signal.json:226–240` (Static Ocean, bandpass 0.35 → 0.9 over two bars, L237–238) | Centroid 630 Hz → 9.8 kHz over 4.6 s, level rising from −70 to −38 dBFS RMS | launch, 29.4–33.8 s, into the kick's entry at the `play` chapter (33.6 s) |
| Blips / UI-style ticks | Yes | `stingers.json:30–38` (Tine A5, 60 ms) | 0.34 s, centroid 1.45 kHz. Timed to on-screen UI events: knob turns, picks, Offer, Take | launch ×22, taste ×9 (§1). RFC-004 decision 3, "No UI sounds" (L225, L327), is scoped to the app |
| Shimmer | Yes | `stingers.json:39–65` (8-note rising pentatonic run over a swelling pad). Also Signal's bell: "the detuned partial beats, which is the shimmer" (`signal.json:174`) | 1.86 s, 47% of energy at 1–4 kHz | launch ×1 (:540), taste ×1 (:477) |
| Logo sting | Yes | `stingers.json:66–99`, and Signal's `sting` section (`signal.json:18, 193, 241–263`) | −17.8 LUFS, −1.0 dBTP. 78% of energy below 120 Hz | launch (title and bed end), taste, math, engine, dsp outros: 5 cue plays + 1 in the bed |
| Four-chord pop progression | Yes, three | Signal: Dm9–Bbmaj7–Fmaj7/A–C6sus2, i–VI–III–VII, the same chords in the same order as vi–IV–I–V in F (`signal.json:3`, L39–49). Study: Fmaj7–G6/F–Em7–Am7, IV–V–iii–vi of C major, the "royal road" order (`study.json:3`). On camera: C–Am–F–G, I–vi–IV–V (§4) | Signal and Study loop it every 4 bars, all the way through | launch; every Study film; every walkthrough demo |
| Tempo ≥ 100 BPM | Yes, one | `signal.json:5` (100); `launch/arrangement.json` and `launch/script.json` bpm 100. Study is 84 (`study.json:5`) and the stingers 60 | — | launch |
| Sub-bass drop | Yes, three sources | Logo sting boom: D1 + D2 sines that start an octave up and fall 12 semitones, τ 150 ms (`stingers.json:74`, body L86). Signal boom (`signal.json:249`) and boom_body (L261). Signal kick: 24 semitones, τ 36 ms, "215 Hz to 57 Hz in 110 ms" (L200, L205) | Logo sting: low-band peak 74 → 41 Hz within 150 ms; 62% of energy below 60 Hz. Signal sting section: 63% below 60 Hz. Kick peak 154 → 56 Hz within 150 ms | 5 films' logo stings; launch's kick and ending |
| Other launch-arc features | Yes | Signal's arc: intro → build (riser) → main (kick on 1 and 3, off-beat hats, 16th-note acid arp) → breakdown → finale → sting (`signal.json:11–19, 100–133, 197–225`) | Section loudness −29.7 → −23.8 → −21.6 / −20.2 → −27.8 → −19.8 LUFS | launch |

---

## 6. Harmonic consistency

### Key centres

| Source | Tonal centre | Pitch set | File |
|---|---|---|---|
| Signal (launch bed) | D minor | D E F G A **B♭** C | `signal.json:2–3` |
| Study (14 films' bed) | F Lydian as labelled. The cycle ends on Am7 and its pad drops to A2 | F G A **B** C D E (the C-major set) | `study.json:2–3` |
| logo_sting | D (D1, D2, D6, A6), "Signal's D" | D A | `stingers.json:3, 75, 87, 98` |
| offer_shimmer | A minor pentatonic, open fifth on A | A C D E G | `stingers.json:3, 48–60` |
| blip | A5 | A | `stingers.json:37` |
| whoosh | Unpitched (noise through a bandpass) | — | `stingers.json:25` |
| On-camera demos | C major: C–Am–F–G, plus Fmaj7 and Em7 | White keys | `apps/web/main.js:4234`; gen_shots |
| Ask The Dice (sounddesign and view-patch, 1 shot each) | "quantized to A minor" | A natural minor | `crates/auracle-grammar/src/presets.rs:2035` |

- The films do not share one tonal centre. There are at least four: **D** (Signal, logo sting), **F** (Study as labelled), **A** (shimmer, blip, Ask The Dice) and **C** (the app demos).
- Pitch classes line up more closely than the centres do. Everything except Signal fits the white-key set. Signal differs by a single note, B♭ where the others have B.
- `stingers.json:3` records the intent that the pitched cues "sit inside both D minor and F Lydian". That holds for pitch classes only.
- In four films (taste, math, engine and dsp) a D-rooted logo sting closes a film whose bed is F Lydian. In all four, loop_b has passed bar 16 before the outro, so the sting lands on a bare First Bass line with F2/F2/E2/A1 roots:

  | Film | loop_b passes bar 16 | Outro starts |
  |---|---:|---:|
  | taste | 83.6 s | 100.0 s |
  | math | 136.4 s | 157.1 s |
  | engine | 100.7 s | 125.7 s |
  | dsp | 128.6 s | 159.3 s |

  Launch's sting (13.85 s) lands in Signal's build section, which has pad, loom and bass.

### Rooms

There is one room per preset, and no shared room. The score renderer adds only a fader, pan and one master gain, with "no EQ, compressor or limiter" (`crates/auracle-wasm/examples/score.rs:30–34`). `mix.py` adds gain, ducking and a limiter. App footage carries whatever room the on-camera patch has.

| Preset | Reverb node (size / damp / mix) | Other effects | Role in the films |
|---|---|---|---|
| Cathedral | 0.85 / 0.35 / 0.50 | — | Study pad |
| Static Ocean | 0.90 / 0.60 / 0.55 | — | whoosh, Signal riser |
| Ghost Bell | 0.72 / 0.35 / 0.40 | Ring mod | Signal bell, shimmer bells, logo bell |
| Bell Jar | 0.70 / 0.30 / 0.40 | Fold | Signal lead |
| Loom | 0.70 / 0.45 / 0.30 | Ladder | Signal loom, on camera |
| Tine | None | Chorus | Study pluck, blip |
| Glass Pad | None | Chorus | Signal pad, shimmer pad, on camera |
| First Bass, Acid Line, Deadfall ("the room taken out"), Flint | None (dry) | Ladder | Bass, arp, kick, boom, hat |

Source: `crates/auracle-grammar/src/presets.rs` at L201, 244, 652, 681, 752, 850, 881, 1232, 1518, 1568 and 1592. Five reverb settings are in use, alongside dry and chorus-only sources.

**Brand.** `www/brand/README.md` has no sound section. Its only mention of sound is "Green is sound, amber is the model's mind" (L156). The mark's SVG comment describes the rings visually (`www/brand/mark.svg`) and names no sonic counterpart.

---

## 7. Existing renders on disk

### Shared scores: `www/video/out/sound/` (all bit-identical to a HEAD render)

| File | s | File | s |
|---|---:|---|---:|
| signal/full.wav | 102.54 | study/loop_a.wav | 45.71 |
| signal/intro.wav | 12.11 | study/loop_b.wav | 45.71 |
| signal/build.wav | 20.59 | stingers/whoosh.wav | 1.45 |
| signal/main_a.wav | 20.60 | stingers/blip.wav | 0.34 |
| signal/main_b.wav | 20.50 | stingers/offer_shimmer.wav | 1.86 |
| signal/breakdown.wav | 12.13 | stingers/logo_sting.wav | 3.11 |
| signal/finale.wav | 24.78 | | |
| signal/sting.wav | 6.54 | | |

Every file also has per-track stems under `stems/<section>/<track>.wav`: 77 WAVs in all, 24-bit, 48 kHz.

### Fitted beds: `www/video/out/<film>/music/study/`

| Film | loop_a s | loop_b s |
|---|---:|---:|
| playing | 57.14 | 85.77 |
| tour | 105.71 | 22.29 |
| view-evolve | 120.00 | 148.63 |
| view-patch | 185.71 | 108.63 |
| view-perform | 185.71 | 137.20 |
| view-taste | 122.86 | 128.63 |

Stems sit alongside. The same fitted beds for the other nine films were rendered in the working folder: 1.6 GB, including launch's fitted Signal.

### Mixed films: the held round, 2026-09-29, not published

| Film | s | mix.wav | .mp4 (AAC 192k) | .webm (Opus 128k) | -preview.mp4 |
|---|---:|---|---|---|---|
| tour | 140.0 | `out/tour/mix.wav` | 40.8 MB | 24.5 MB | 6.4 MB |
| playing | 142.9 | `out/playing/mix.wav` | 49.6 MB | 32.4 MB | 8.3 MB |
| view-perform | 334.3 | `out/view-perform/mix.wav` | 88.9 MB | 56.6 MB | 15.4 MB |
| view-patch | 305.7 | `out/view-patch/mix.wav` | 97.6 MB | 58.7 MB | 15.1 MB |
| view-evolve | 280.0 | `out/view-evolve/mix.wav` | 69.3 MB | 40.4 MB | 9.6 MB |
| view-taste | 251.4 | `out/view-taste/mix.wav` | 94.1 MB | 51.8 MB | 11.2 MB |

- The same folders hold each shot's recorded app sound (`out/<film>/shots/<shot>.wav`: 8, 12, 10, 11, 10 and 12 files) and the narration (`out/<film>/voice/*.wav`).
- `out/tour 30/` is an empty stray folder.

### Published films: `www/landing/assets/film/`, listed in films.json

| Film | s | Size | Audio |
|---|---:|---:|---|
| launch.mp4 | 98.4 | 28.7 MB | AAC 48 kHz stereo, about 200 kb/s |
| taste.mp4 | 108.6 | 30.7 MB | AAC 48 kHz stereo, about 192 kb/s |
| engine.mp4 | 137.1 | 25.8 MB | AAC 48 kHz stereo, about 191 kb/s |
| math.mp4 | 165.7 | 38.1 MB | AAC 48 kHz stereo, about 185 kb/s |
| dsp.mp4 | 168.6 | 39.0 MB | AAC 48 kHz stereo, about 188 kb/s |

- `launch-loop.mp4` and `launch-loop.webm` (17.2 s) are video only.
- The published films' audio was decoded to WAV (32-bit float, 48 kHz) for the checks.

### Renders made for this audit (working files, not kept)

The four stingers, and 20 s excerpts of Study's two loops and each of Signal's seven sections (whole where a section is shorter), were rendered at 48 kHz 24-bit and encoded to AAC and Opus at 96 kb/s, about 2 MB in all, for the first audition. They are not part of this record.
