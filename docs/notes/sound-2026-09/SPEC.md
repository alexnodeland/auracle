# Film sound: the specification

This spec was finalised on 2026-09-30, at `7c893ad`. It records the sound of Auracle's films as the maintainer chose it over five rounds of listening, as values a film can be built to. RFC-007 cites it.

**Provenance.**
- Every note is a bank preset played by the engine's own `score` example (`crates/auracle-wasm/examples/score.rs`), from the scores in `scores/`.
- Each part was rendered as its own stem and mixed on stems by a session script. That script is not kept; every setting it applied is stated here.
- The clips in `clips/` are the finals.

**Units.** Knob values are the engine's normalised knob values, the ones a score's `params` take. Pitches are as they sound. LUFS is ITU-R BS.1770-4, as `www/video/tools/mix.py` computes it.

**Still stand-ins.** Three things are marked **(stand-in)** where they appear. A film made to this spec must replace them:
- **The demo** is the engine playing a score, not the app recorded, and its "Bright" gesture is a cutoff knob automated.
- **The portamento** is a bend on each note (`pitch_drop`), not the instrument's glide, which the `score` example cannot set.
- **The bed's sighs** were placed by hand. A film needs them placed in the narration's gaps automatically.

## 1. Key, tempo, form

| | Value |
|---|---|
| Key | F, over an F2/C3 pedal |
| Mode | F Lydian for the cycle's first half (G6/F carries the B natural); minor colour in its second half (Bbm6/F carries the Db) |
| Tempo | 66 BPM, 4/4: a beat is 0.909 s, a bar 3.636 s. The marks are written at 60 BPM, so a beat is a second, and are placed into the 66 BPM grid by time. |
| The bed's cycle | 8 bars (29.09 s), two bars a chord: **Fmaj9 \| G6/F \| Bbmaj7/F \| Bbm6/F** |
| Length | The cycle repeats for as long as the film needs. The drone is held, never re-struck, and the pad's ties carry across cycles. |
| Form of a film | The entrance mark blooms into the bed, and the first word follows it closely. Narration, with demos in the grammar of section 9. The exit mark follows the last word closely and resolves to F. **The motif plays only as the two marks.** |

## 2. The cast, with every knob value

| Part | Preset | Knobs (stock → used) | Other |
|---|---|---|---|
| Drone | Cathedral | `amp#attack` 0.75 → **0.85**. `node/0#cut` breathes **0.495 → 0.605 → 0.495** once per cycle (stock 0.55, ±10%), lowest at the cycle's start. Reverb at stock: `node#rsize` 0.85, `node#rdamp` 0.35, `node#rmix` 0.50. | F2 and C3, held for the whole piece; 4 voices; `trim_db` −6 |
| Bed pad | Cathedral | `amp#attack` 0.75 → **0.85** (10–90% rise 1.18 s → 2.2 s); reverb at stock | 8 voices; `trim_db` −6 |
| Marks' pad | Cathedral | `amp#attack` 0.75 → **0.55** (10–90% rise 0.30 s), so a half-second chord can speak; reverb at stock | 6 voices; `trim_db` −6 |
| Lead: marks, and the bed's melody | Wobble Board | Table below | 2 voices per note; one track per note |
| Burble | Held Under | `amp#attack` 0.05 → **0.12**; `node/0#cut` 0.45 → **0.38** | `transpose` +12 (it sounds an octave below the key); 4 voices |
| Demo **(stand-in)** | Solo Flight | `amp#attack` 0.30 → **0.40**; `amp#release` 0.45 → **0.70**; `node/0#cut` automated **0.40 → 0.78** over the demo's first 6 beats | 4 voices |

Wobble Board, the motif's one voice everywhere it plays:

| Knob | Stock | Used | Effect (measured) |
|---|---|---|---|
| `amp#attack` | 0.04 | **0.25** | A round onset |
| `amp#sustain` | 0.70 | **0.80** | Holds 4.1 dB under its attack (6.4 dB at 0.70) |
| `amp#release` | 0.30 | **0.45** | Note-off to −30 dB in **0.11 s** (0.025–0.030 s at 0.30) |
| `node#cut` | 0.74 | **0.58** | Darker |
| `node#res` | 0.34 | **0.20** | Less peak |
| `node/0/m#rate` | 0.78 | **0.73** | Vibrato 3.45 Hz (5.15 Hz at stock) |
| `node/0#mdepth` | 0.045 | **0.035** | About ±21 cents |

How the lead's lines are played:
- **Portamento (stand-in):** each note bends in from the previous pitch with `pitch_drop` (`semis` = previous − current, `tau_ms` 45, `pre_ms` 12).
- **Legato:** each note is held 0.06 beat into the next.
- **Swell:** a line's last note swells by a fader from −5 dB at its onset to 0 dB, over 1.2 s in the marks and 1.5 beats in the bed.

**Measured for casting** (round 2). These presets came from a two-note probe of all 62 bank presets: noise share ≤ 0.02, roughness ≤ 6, nothing above 4 kHz worth naming, no sub. Cathedral: centroid 176/351 Hz (F3/F4), roughness 0.0. Wobble Board: 300/545 Hz, roughness 1.8/0.3. Held Under: 125/226 Hz, transient 1–3 dB. No part has energy below 60 Hz worth naming (under 0.02%).

## 3. The marks

### Bloom, the entrance (`scores/m2_bloom.json`)

60 BPM; times in seconds; velocities in brackets.

| Part | Notes |
|---|---|
| Lead | C5 0–1.0 (0.60), B4 1.0–1.5 (0.58), A4 1.5–2.0 (0.58), E5 2.0–4.5 (0.60, swell). Bends: +1, +2, −7 semitones. |
| Pad (0.55) | A3 0–1, B3 1–1.5, A3 1.5–4.5; C4 0–1, D4 1–1.5, C4 1.5–4.5; E4 0–1.5; G4 0–4.5. All at velocity 0.55. |
| Harmony | Fmaj9 (0–1) \| G6/F, the Lydian B (1–1.5) \| Fmaj9 without E4 (1.5–4.5), so E5 is alone on top. It ends open, on the major 7th. |
| Drone | F2 (0.56) and C3 (0.52) from 0, entering softly (attack 0.85; in a film, also a fader from −12 dB to 0 over 1.5 s; since 2026-10-07 the film's drone starts before Bloom, below) |

**Into the bed.** Bloom's last chord (A3 C4 G4, from 1.5 s) is the bed's bar 1, so the bed's bar 1 falls at 1.5 s. There is no seam:
- **Held, not handed over:** those three notes stay on the marks' pad and are held on until a voice moves (A3 and C4 at bar 3, G4 at bar 5). The bed pad plays only the voices that move.
- **The bloom:** the bed's E4 blooms in at 4.5 s, when E5 has finished. The burble enters on bar 2.
- **Level:** after the mark, the marks' pad eases from mark level to bed level over 4.0 s.
- **Measured:** no dip at the seam. Round 4 handed the chord to the bed pad, whose 2.2 s attack left a 12 dB hole at about 2 s. (`scores/reel.json`, its first 12.5 s: `clips/bloom_into_n3.mp4`)
- **The first word comes 1.5–2 s after Bloom's last note** (the rule). The bed does not wait for any bar or cycle boundary before the voice.

**The bed first (2026-10-07).** The maintainer chose, watching the launch
film, that the bed sounds from a film's first frame, under its opening
picture, and Bloom comes a moment later: "we should come in with the sound
bed immediately when the video starts … and then, a moment after that, the
sound mark can play." It had been silence, then the bed and Bloom together.
The drone now starts with the film, its fader from −12 dB to 0 over 0.25 s
(a click's worth, no silence), and Bloom enters two of the bed's beats later
(1.82 s at 66 BPM; `form.bed_first.entrance_after_beats`). Everything from
Bloom on is as above, two beats later; the reel's music comes back so
(`tools/test_fit_score.py`'s `with_the_bed_first`).

### Reach, the exit (`scores/m1_reach.json`)

| Part | Notes |
|---|---|
| Lead | F4 0–0.5 (0.58), G4 0.5–1.0 (0.60), C5 1.0–2.5 (0.64), A4 2.5–4.5 (0.60, swell). Bends: −2, −5, +3 semitones. |
| Pad (0.55) | A3 0–1, Bb3 1–2.5, A3 2.5–4.5; C4 0–1, D4 1–2, Db4 2–2.5, C4 2.5–4.5; E4 0–1, F4 1–2.5, E4 2.5–4.5; G4 2–2.5 |
| Harmony | Fmaj7 \| Bbmaj9/F (the C5 is its 9th) \| Bbm6/F (the sigh under the held C5) \| Fmaj7. That is I IV iv I: the line rises by step, leaps a fourth, settles on the 3rd. |
| Drone | F2 and C3, held through and released with the mark |

**Out of the bed.** **Reach enters 1.5–2 s after the last word ends** (the rule), wherever the bed is in its cycle. Reach's own I IV iv I supplies the cadence, so the bed need not be on Bbm6/F first.
- **The hand-over:** the bed's voices end on Reach's downbeat, each stepping to the nearest note of Reach's Fmaj7 (A3 C4 E4), so the hand-over takes about a beat on the bed's release. In the reel the bed is on G6/F: B3→A3, D4→C4, E4 carries into Reach's E4, and G4 ends.
- **If a hand-over would be abrupt,** one passing chord of a beat or two, voice-led. A 2-beat Bbmaj7/F re-struck on the bed pad never bloomed (−5 dB), so the reel holds G6/F instead.
- **What stops and what goes on:** the burble stops on Reach's downbeat; the drone continues and is released with Reach. (`scores/reel.json`, its last 15 s: `clips/n3_into_reach.mp4`)

### Levels within a mark

- **The lead is clearly in front:** 6 dB over the pad sounding with it (momentary median).
- **The pad is a cushion; the drone is the floor,** 6 LU under the pad.
- **In a film,** the lead and the marks' pad are scaled together so the mark's 4.5 s, with the drone and anything under it, is **−18 LUFS**. In the final reel that took −2.6 dB on the entrance and −4.2 dB on the exit.

## 4. The bed: N3 (`scores/n3.json`; in the reel, `scores/reel.json`)

**Drone.** F2 and C3, held for the whole piece and never re-struck, with its cutoff breathing once a cycle (section 2).

**Chord pad.** Two bars a chord, voice-led. Only voices that move are re-struck (soft attack); the rest are tied, not re-struck.

| Bars | Chord | Voicing | Moves |
|---|---|---|---|
| 1–2 | Fmaj9 | A3 C4 E4 G4 | From Bbm6: Bb3→A3, Db4→C4, F4→E4; G4 tied |
| 3–4 | G6/F | B3 D4 E4 G4 | A3→B3, C4→D4; E4 and G4 tied |
| 5–6 | Bbmaj7/F | Bb3 D4 F4 A4 | B3→Bb3, E4→F4, G4→A4; D4 tied |
| 7–8 | Bbm6/F | Bb3 Db4 F4 G4 | D4→Db4, A4→G4; Bb3 and F4 tied |

The inner lines descend chromatically (B→Bb→A, D→Db→C), and the top goes G G A G.

**Burble.** Held Under in dotted eighths (0.75 beat each, held 0.675 beat), cycling a three-note cell (low, high, middle):
- The cell restarts at each chord change; the last note before a change is shortened to fit.
- Velocity is 0.5 × (1 + 0.1·sin(2πk/7)): it breathes ±10%, with no accents.

| Chord | Cell |
|---|---|
| Fmaj9 | C3 A3 F3 |
| G6/F | D3 B3 G3 |
| Bbmaj7/F | D3 Bb3 F3 |
| Bbm6/F | Bb2 Bb3 F3 |

The G6/F and Bbm6/F cells were re-voiced in round 4. As written (B2 G3 D3, and Db3 Bb3 F3), their low notes sat a semitone from the drone's C3 and made a slow throb of about 7.5 Hz (15.5% and 16.9% envelope modulation in 100–165 Hz). Re-voiced, they beat faster, at about 15 Hz, at the level the Bbmaj7/F cell already had (18–20%).

**The bed's melody: sighs (stand-in: hand-placed).** **The motif plays only as the two marks.** The bed never quotes it: not its head, its sequence or a variant. The bed's own melody is falling two-note sighs on chord tones:
- **Shape:** a dotted quarter, then a held note (1.5 + 2.5 beats), the second swelling.
- **Voice:** Wobble Board with the same knobs as the marks, 4 dB under the pad.
- **Where:** only in the narration's gaps, never in the bar before the exit mark. A sigh that has no gap is skipped, not crowded.

| Chord | Sigh |
|---|---|
| Fmaj9 | F5 → E5 |
| G6/F | E5 → D5 |
| Bbmaj7/F | Bb4 → A4 (the pad's top A4 rests under it) |
| Bbm6/F | Db5 → Bb4 |

They fall, mostly by step, two notes long, in a rhythm neither mark uses. The rest sit above the pad's top voice, so nothing doubles it. Where a sigh would double the pad, the pad's top voice rests and returns at its next move.
- **In the narration clip:** one sigh (F5 → E5) after the last line.
- **In the reel:** the narration leaves no gap long enough for one, so the bed has none there.

## 5. The mix (on stems)

Filters are 2nd-order Butterworth, applied causally. Band splits for dynamic moves are zero-phase 4th-order and complementary, so they reconstruct exactly.

| Part | EQ | Stereo | Level |
|---|---|---|---|
| Drone | Low-pass **200 Hz** | **Mono** | **6 LU under the pad** |
| Bed pad, marks' pad | High-pass **165 Hz** | **Wide:** side above 150 Hz ×1.25 (+1.9 dB) | The reference. Under speech, **−2 dB in 300–600 Hz** |
| Burble | Band **110–400 Hz** | **20% left** | **12 LU under the pad** |
| Bed melody | High-pass **220 Hz** | **15% right** | **4 dB under the pad** when it sounds |
| Marks' lead | High-pass **220 Hz** | Centre | **6 dB over the pad** when it sounds |
| Demo | None | Centre | −18 LUFS over its window |
| Narration | Section 6 | Centre (mono) | −18 LUFS |

- **Below 150 Hz everything is centred:** each stem's side signal is high-passed at 150 Hz.
- **Levels are re-checked after the EQ.** Drone, burble and melody against the pad are integrated over the bed (melody: momentary median while it sounds).
- **The drone's low-pass is at 200 Hz** because the partial that beats against the pad's B3 and Db4 is F2's third harmonic, at 262 Hz. Measured on the 15 Hz beat in G6/F: none 14.7%, 450 Hz 13.8%, 220 Hz 8.3%, 180 Hz 6.1%, at under 1 dB of drone level.
- **One room:** only Cathedral exposes a reverb in this cast, and every Cathedral part shares the stock settings. Wobble Board, Held Under and Solo Flight have no reverb node and sit dry in front of it. No outside reverb.

## 6. The voice chain

The narration stem passes through these stages in order, then is normalised to −18 LUFS integrated. The voice is Kokoro `af_heart` (RFC-004).

| Stage | Type | Frequency | Gain | Q / order | Rule |
|---|---|---|---|---|---|
| 1 | High-pass | 85 Hz | — | 2nd-order Butterworth | Always |
| 2 | Peaking cut | 315 Hz | −2 dB | Q 1.2 (RBJ) | If 250–400 Hz power density exceeds 500–800 Hz by more than 3 dB. It measured 3.5–4.8 dB on every narration used. |
| 3 | Peaking boost | 4 kHz | +2 dB | Q 0.9 (RBJ) | Always |
| 4 | De-esser | above 5 kHz | up to −3 dB | Split band, 4th-order zero-phase high-pass; the rest untouched | See below |

The de-esser's settings:
- **Detector:** 5 ms RMS of the band.
- **Threshold:** the 95th percentile of speech frames, which measured −25.3 to −26.9 dBFS at −18 LUFS, so a fixed −26 dBFS is equivalent.
- **Response:** 3:1, at most 3 dB, 1 ms attack and 60 ms release.
- **Measured activity:** 6.9–9.8% of frames.

## 7. The loudness ladder

| Element | Level |
|---|---|
| Narration | −18 LUFS integrated |
| Bed at rest (before the first line, in pauses, after the last) | **−21 LUFS: 3 LU under the voice** |
| Bed under speech | Rest level −2 dB broadband, a further −3 dB in 1–4 kHz, and the pad −2 dB in 300–600 Hz (section 8) |
| Demo | **−21 LUFS** integrated over its window (−18 until 2026-10-07; see below) |
| Bed under a demo | **6 LU** under the demo (about −27 LUFS, where it was). It goes down over 0.5 s from the demo's first note, and comes back over 1.0 s from its last note-off. Never ducked to silence. |
| Marks | −18 LUFS over their 4.5 s (section 3) |
| Film master | The whole mix to −16 LUFS integrated, then `mix.py`'s limiter: ceiling −1.2 dBTP, 5 ms look-ahead, 80 ms release (`mix.py:133`) |
| Cues | **None.** No whoosh, blip, shimmer or logo sting, and nothing in their place. |

## 8. The duck, the carve and the dip

| | Value |
|---|---|
| Voice detector | The voice's 5 ms RMS above −45 dBFS (`mix.py:300–302`) |
| Follower | 80 ms attack, 450 ms release (`mix.py:171`), shared by all three moves |
| Broadband duck (whole bed) | −2 dB × follower |
| Carve (whole bed) | A further −3 dB × follower in **1–4 kHz** |
| Pad dip | A further −2 dB × follower in **300–600 Hz**, on the pad only |
| App sound under the voice | None: in this grammar the instrument never plays under the narration |

**2026-10-07, the maintainer, watching the launch film:** its Bright and
Offer demos were "okay, but a bit too loud", and a little harsh. The demos
come down 3 dB, to −21 LUFS, and the bed under them stays at about −27 LUFS
(so 6 LU under the demo, from 9). The harshness is the demo's sound, recast
for the launch film from the shortlist (its notes in
`www/video/films/launch/`).

## 9. The grammar

These are the rules a film follows:

1. **The motif plays only as the two marks.**
2. **The first word comes 1.5–2 s after the entrance mark's last note.** The bed (the mark's last chord held on) carries the gap and does not wait for a bar or cycle boundary.
3. The voice explains; **0.7 s** after its last word the demo starts, wherever the bed is. It is not held back for a chord change. If a re-strike would dip under the demo, the pad is re-voiced in the pause rather than waiting.
   - In the reel, the pad moves to A3 C4 on the marks' fast pad, so the demo's F3 E4 G4 A4 complete an Fmaj9 without doubling it.
   - The bed sits 9 LU under the demo (6 LU since 2026-10-07, section 7).
4. **The demo is never cut off:** its notes ring out on their own release. If it must end sooner, its playing ends sooner.
5. The voice waits until the demo's tail has fallen **30 dB** under its playing level, then **0.8 s** more on the bed, then continues. The bed returns over 1.0 s from note-off and resumes its cycle; in the reel, on G6/F.
6. **The exit mark enters 1.5–2 s after the last word ends,** wherever the bed is, handing over as in section 3.

Round 3 started the voice 0.4 s after note-off, over the tail. That was heard as an abrupt cut and changed in round 4. Before the final round, the marks were placed on the bed's cycle. That put 21.5 s between Bloom and the first word, and the reel ran 66.7 s.

| Moment (final reel) | Time |
|---|---|
| Bloom, over the drone | 0.0 s; its last note ends at 4.5 s |
| The bed's bar 1 (Bloom's last chord) | 1.5 s |
| First line (view-perform title1) | 6.25 s: **1.75 s after Bloom** |
| Lines title2, named2 | 8.82 s, 14.045 s |
| Pause, the pad re-voiced | 18.27–18.97 s |
| Demo (stand-in), 6.5 s of playing | 18.97–25.47 s |
| Its tail at −30 dB | 1.08 s after note-off |
| The bed back, on G6/F | 26.47 s |
| Next line (named3) | 27.39 s: 1.92 s after note-off |
| Line named4, last word | 30.625 s; last word ends 33.772 s |
| Reach | 35.522 s: **1.75 s after the last word** |
| End | 42.62 s |

## 10. Measured results

**The final reel** (`clips/reel.mp4`):

| | Value |
|---|---|
| Length | **42.62 s** (66.7 s before the final round) |
| Integrated loudness, true peak | -16.08 LUFS, -1.2 dBTP |
| Bloom's last note to the first word | 1.75 s |
| The last word to Reach | 1.75 s |
| Demo after its line | 0.7 s |
| Demo tail to −30 dB; note-off to the next word | 1.08 s; 1.92 s |
| Demo over the bed | 9.1 dB; the bed held -27.8 to -26.0 LUFS under it (no dip) |
| Marks | −18.0 LUFS each, the lead 6 dB over the pad (scaled -2.6 and -4.2 dB) |
| Voice over the bed under speech | 125–250 Hz 8.0 dB; 250–1000 Hz 2.7 dB; 1–4 kHz 23.6 dB; broadband 4.1 dB |
| The motif's notes | 0.108–0.112 s from note-off to −30 dB, all 18 notes in the finals (0.025–0.030 s before the final round) |

**N3 under narration at E4.** The tour's views1–views5 lines; rendered as `n3_narration.mp4`, which is not part of the notes folder. The before column is round 4's N3, summed with no EQ or pan.

| | Before | Final |
|---|---|---|
| Drone vs pad | −7.4 LU | -6.0 LU |
| Burble vs pad | −12.6 LU | -12.0 LU |
| Melody vs pad (sounding) | −2.5 dB | -4.0 dB |
| Bed energy in 100–300 Hz (static) | 44.9% | 39.8% |
| Voice over bed, 250–1000 Hz | 2.2 dB | 3.3 dB |
| Voice over bed, 1–4 kHz | 25.7 dB | 25.5 dB |
| Drone L/R correlation | −0.64 | 1.0 |

The pad is what sits level with the voice in the vowel range, and the specified 2 dB dip gains about 1 dB there. A 5 dB dip in 250–600 Hz was auditioned (round 5, N3v): 3.6 dB over the pad, for 1.4 dB less bed under speech. The maintainer kept the 2 dB dip.

**Transitions** (cut from the reel's music, no narration):
- `clips/bloom_into_n3.mp4`: mark −18.0 LUFS, bed −21.5 LUFS.
- `clips/n3_into_reach.mp4`: bed −20.6 LUFS, mark −18.0 LUFS. The pad holds steady to Reach's downbeat, then steps down to Reach's own pad under its lead.

## 11. What would have to change in `www/video/tools` (not changed)

Line numbers are at `7c893ad`.

**`mix.py`**
- `:28–31`, `:199–200`: the music level and duck defaults (−9 and −8, with the docstring's −9) become a bed at **−3** and a duck of **−2**. Add the 1–4 kHz carve (−3 dB) and the pad's 300–600 Hz dip (−2 dB), keyed to the voice mask and follower (`:298–307`).
- `:219–229`: insert the voice chain (section 6) before the −18 LUFS normalisation (`:226–229`).
- `:231–246`: the bed is laid as one WAV per section. It must take each part's stem (the `score` example already writes `stems/<window>/<track>.wav`) and apply section 5 to each.
- `:247–264`: keep the `levels` gain. Add demo windows: the bed to −9 LU under the demo, 0.5 s down, back over 1.0 s from note-off.
- `:266–277`: no cues. This pass carries only the two marks, each scaled to −18 LUFS over its span; the entrance's pad eases to bed level over 4 s.
- `:279–296`: normalise each demo window to −18 LUFS, rather than the raw recording × `gain_db`.
- `:308`: drop the app's half-depth duck; demos no longer play under the voice.
- `:133`, `:317–319`: unchanged.

**`illustrated.sh:22`, `walkthrough.sh:48–49`**
- `MUSIC_DB` −6 → −3, `DUCK_DB` −9 → −2.
- `APP_DB` becomes a loudness target.
- `--sfx out/sound/stingers` becomes the two marks.

**`app_audio.py`**
- `:90`: `--gain-db −3` → a −18 LUFS target per window.
- `:55–84` (`:59` uses the whole beat): emit the demo windows between lines instead.
- Measure each demo's tail, its time to −30 dB, for `timeline.py`.

**`fit_score.py:65–81`**
- A `phrase`'s `repeat` is never scaled, so a stretched bed falls silent after its written length. This is the audit's fix-now bug.
- It must also carry the drone as one held note and keep the pad's ties across cycles.

**`timeline.py`**
- `:141–151`: a line's `post` (`:151`) already adds a pause. Add a `demo` on a line:
  - 0.7 s of pause;
  - the demo, starting mid-cycle on a bar the arrangement allows;
  - the next line at the demo's note-off + its −30 dB tail time + 0.8 s.
- `:125`, `:189`: write the demo windows (`demos`) and the marks' times into `arrangement.json` beside `levels`.
- The first line after the entrance mark, and the exit mark after the last line, at 1.5–2 s (section 9).

**`arrangement.json`**
- `bed` → N3; `bpm` 66.
- Sections in 8-bar cycles.
- New `demos: [[t0, t1], …]` and `marks: {entrance: t, exit: t}`.
- `levels`/`bed_db` keep their meaning.

**Score generation (a new tool, or `fit_score.py`)**
- Place the marks by time, not on the bed's cycle: the first word 1.5–2 s after the entrance mark, the exit mark 1.5–2 s after the last word.
- Hold the entrance mark's last chord into the bed's bar 1.
- Re-voice the pad in the pause before a demo.
- Resume the cycle after the demo.
- Hand over into the exit mark from whatever chord the bed is on.
- Place the bed's sighs in the narration's gaps (stand-in today).
- Rest the pad's top voice under any doubled note.

**`sound/study.json` → N3** (`scores/n3.json`). **`sound/stingers.json` → the two marks** (`scores/m2_bloom.json`, `scores/m1_reach.json`). Remove every `stage.sfx()` call site:
- `films/launch/film.js:126, 222, 223, 320, 322, 450, 536–542, 686, 773`
- `films/taste/film.js:80, 207, 333, 477, 478, 518`
- `films/math/film.js:2312`
- `films/engine/film.js:701`
- `films/dsp/film.js:325, 2338`
- `films/tour/cards.js:65`

**`films/VIEWS.md:70–72` and the shot generators**
- The bed rule becomes section 9.
- Demo actions come after their line, not under it (`tools/shotgen.py`, each film's `gen_shots.py`).
- Cast from the shortlist, not dealt or grown sounds. The tour's cold open plays an offer grown from Glass Pad and taken: `films/tour/gen_shots.py:83, 85–86, 97, 100, 103`.

**Outside `www/video/tools`.** To replace the bend with real portamento, a `score` track field that calls `LivePoly::set_glide` (`crates/auracle-wasm/src/live.rs:1203`).

## 12. Decided by ear, and by measurement

**Decided by the maintainer, by ear:**

| Choice | Round |
|---|---|
| No cues at all: no whoosh, blip, shimmer or sting, and nothing in their place. The logo sting heard as the worst mark. | 1 |
| A sparse, slow pad bed (C2: Cathedral, 66 BPM) over the original Study | 1 |
| The direction: Mort Garson's *Plantasia*; warm, round, nothing harsh; no "conference music" | 1 |
| The voice explains, a pause, then the demo, then the voice; and the voice mixed better with the music | 1 |
| The voice chain (E2) and a more prominent bed; the motif's contour (B7); a melody and low arpeggio over the pad (C7); the demo grammar (D4) | 2 |
| The bed at −3 LU with a 2 dB duck and 3 dB carve (E4) | 3 |
| A pause after the demo instead of the voice coming straight in | 3 → 4 |
| N3 as the bed; Bloom as the entrance and Reach as the exit | 4 |
| Each part in its own place in the mix | 4 → 5 |
| N3 with the 2 dB vowel dip, not the 5 dB one | 5 |
| A slightly longer sustain and release on the motif | 5 → final |
| The motif only in the marks; the bed's own melody, never quoting it | Final |
| The first word 1.5–2 s after the entrance mark; the exit mark 1.5–2 s after the last word | Final |

**Decided by measurement, within those choices:**

| Choice | Round |
|---|---|
| The cast shortlist (two-note probe of the bank) | 2 |
| Wobble Board's vibrato slowed to 3.45 Hz | 2 |
| Held Under's two burble cells re-voiced against the drone | 4 |
| Solo Flight's release 0.70, so the demo rings out | 4 |
| The drone's low-pass at 200 Hz, not 400–600 | 5 |
| The lead 6 dB over the pad; marks at −18 LUFS, the entrance pad easing to bed level | 5 |
| Wobble Board's `amp#sustain` 0.80 and `amp#release` 0.45 (+0.10 and +0.15, the top of the brief's guide): decay 0.03 → 0.11 s, held level 2.3 dB fuller, every tail clear of the narration. The knob is steep: 0.50 gives 0.17 s, 0.55 gives 0.27 s. | Final |
| The bed's sighs (falling, two notes, chord tones) | Final |
| The pad re-voiced to A3 C4 under the demo; G6/F held into Reach, because a 2-beat Bbmaj7/F dipped 5 dB | Final |
