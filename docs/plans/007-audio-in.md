---
title: "Audio in: quiver to the plate"
number: 7
status: active
author: Claude Code
created: 2026-09-30
updated: 2026-10-02
originating_proposal: 8
related_adrs: [4, 12, 15]
---

# Plan-007: Audio in

## Objective

This plan builds [RFC-008](../proposals/008-audio-in.md) under
[ADR-015](../decisions/015-audio-in.md): the AUDIO IN node and its four uses,
measured with audition clips, from quiver to the PATCH plate.

## Bounded contexts

| Context | Owns | Files |
| --- | --- | --- |
| DSP | `AudioInput`, `Track`, `Capture` | `../quiver/src/` (its own repo and release) |
| Grammar | The `AudioIn`, `Track` and `Capture` terms; knobs and prior; describe | `crates/auracle-grammar` |
| Measure | Audition clips in rendering and featurizing | `crates/auracle-features`, `crates/auracle-session` |
| Bindings | Input blocks into `LivePoly`; the clips; the device list | `crates/auracle-wasm` |
| Capture | `getUserMedia`, the device list, the worklet's input, permission, the plate | `apps/web` |

## Tasks

1. **quiver `AudioInput`.** *Done* in quiver-dsp 0.4.0, published to
   crates.io and npm (`@quiver-dsp/wasm`) from the `v0.4.0` tag (RFC-008,
   Open 1), and Auracle depends on it from crates.io.
   - `AudioInput` and `AudioInputStream`: block-fed and multichannel. The
     host writes each block before processing (`write`, planar, or
     `write_interleaved`). A stream is read by cursor
     (`AudioInputStream::new`, for voice-major hosts like `LivePoly`) or on
     the host's clock (`with_host_clock` and `advance()` per frame, for a
     frame-by-frame render like `render_phrase`, whose chord voices start
     mid-block).
   - Tests at block boundaries and with mismatched block sizes (quiver's
     `io.rs`), and allocation-free on both sides (`tests/zero_alloc.rs`).
   - The same release carries quiver's half of tasks 5 and 6: `PitchTracker`
     (the Track module: pitch by YIN, gate and level) and `Capture`.
2. **The AUDIO IN term:** knobs (`input`, `gain`, `channel`), `describe`, rare
   in the prior. Walks never change `input`. *Done* (engine), and **off in
   the prior until task 4**:
   - `AudioNode::AudioIn`, source index 7, compiled to quiver's `AudioInput`
     on the stream `compile_with_input` binds (`compile` leaves it silent);
   - `input` a slot (1 to 8) the prior never chooses (`PlayerInput`: drawn
     nodes read slot 0, every slot scores alike), `gain` −24 to +12 dB and
     live, `channel` left, right or both;
   - described as `audio_in`, "audio in", with `NodeKind::AudioIn` in the
     edit vocabulary;
   - a **player kind** (the maintainer's decision, 2026-10-02, replacing the
     plan to turn its weight on): source weight 0 (`AUDIO_IN_WEIGHT`), so no
     fill, walk or offer draws one and every seed deals the pool it dealt
     before the term, while `SourceKind` scores a player's at
     `PLAYER_SOURCE_MASS`, so a listening patch is in support and is bred
     like any other. `boot_probe.json` and `perform-wirings.json` are
     unchanged (the latter regenerated equal apart from node uids, which
     differ run to run);
   - every walk locks each `#input` its seed holds, so the node and its input
     stay;
   - φ keeps its shape: a display counter, `n_audio_in`, and no column.
   - Open: the face is task 4's (see task 4).

   The paired `make revalidate` below measured the term drawn **at 0.5%**,
   the setting that was planned and not shipped: before is
   main at 728dd65, after is this branch with the term at 0.5% (16-seed climb
   re-run on the rebased heads, byte-identical). Nothing moved beyond noise.
   The one row that moved the wrong way, locked refine at 160 steps, is
   about 2 se, not the shipped setting, and non-monotone on the after side.

   | Row | Before | After (0.5%) |
   |---|---|---|
   | phi-stats: featurized, quarantine | 1168 (97%), 2.7% | 1172 (98%), 2.3% |
   | phi-stats: mean size, depth | 3.16, 2.61 | 3.12, 2.58 |
   | phi-stats: top VIF (rolloff, zcr) | 19.7, 12.9 | 19.9, 13.0 |
   | phi-stats: audio in quarantined | — | 1 of 17 |
   | norm-peak: over ceiling; pulled down | 0/144; 10%, 3.8 dB | 0/142; 13%, 4.0 dB |
   | 1 climb, 16 seeds, mean gain | +2.000 ± 0.380 | +1.693 ± 0.404 |
   | 1 climb, paired gain; best patch | | −0.31 ± 0.49; +0.28 ± 0.56 |
   | 1 search-check, 6 seeds | +0.790 (4/6) | +1.295 (6/6) |
   | 2 MH acceptance; structural share | 48.9%; 30.1% | 47.8%; 31.1% |
   | 3 locked refine beat parent, 20/*40/80/160 | 54/62/77/88% | 58/69/81/71% |
   | 4 fit vs truth; ranking across refits | 0.372; 0.569 | 0.375; 0.610 |
   | 4 true best survived | 100% | 100% |

3. **Audition clips:**
   - a built-in reference signal; *done*: a plucked figure (A2 to E4, a noise
     pick on every note, a quiet tail), deterministic, mono;
   - capturing a few seconds on first listen; *done* (task 4's web half): 6 s
     of the input once it carries a signal, through the worker's
     `set_audition_clip` message to `WasmEngine::set_audition_clip`;
   - storing clips with the session; *done*: one session clip, saved as 16-bit
     base64 and bounded like quiver's `Capture`; an unreadable one restores as
     the reference and says so;
   - `featurize`, the vet, and walks rendering with them; *done*: the clip
     rides in `PhraseSpec`, a listening patch renders on a host-clock stream,
     its render key (and so the farm's stored key, and PERFORM's wiring key)
     carries the clip, and `LivePoly` binds a cursor-mode input stream. A
     fill's farm result for a listener measured under another clip (or vetted
     out under one) is measured on the engine instead (`Engine::absorb_prior`),
     and a restore's falls back to `bank_render`. The farm's phrase is re-sent
     after a capture and a restore that installs one (task 4). Open: a clip
     per input.
4. **Web capture.** *Done* (web), except the live face
   (`apps/web/audio-in.js`; the guide's *Playing through Auracle*;
   `tests/web/audio_in.spec.js`):
   - the permission flow, only when a node is added; *done*: `queueStruct`
     asks inside the gesture; a sound that listens opened later opens its
     input only if the browser already granted one, otherwise the module
     shows ALLOW INPUT; a refusal keeps the node, silent, with ASK AGAIN;
   - `enumerateDevices`, and one capture stream per input fanned out to every
     node that uses it; *done*: slot → device in `auracle-inputs`, one
     `getUserMedia` per device the bench reads, one source fanned out to each
     module's meter, the voices and the capture; unplug and replug handled.
     `LivePoly` binds one stream, so the voices hear the first AUDIO IN's
     device and a module on another input is metered only (said on it);
   - the live worklet's input; *done*: the voice node has one input, written
     through `input_ptr`/`write_input` before `process_ptr` for A and B, the
     view re-checked every quantum. A patch that listens is held open by an
     **open voice** (`LivePoly::set_open`): one more voice of the patch, built
     with it, gated at C4 outside the keys' allocation while monitoring is on;
   - the AUDIO IN plate: device select, level meter, live face; *done*: the
     input line opens the input menu, and the square draws the input's face
     (`createLiveMeter` on the level's own analyser frame, eased, drawn by
     `drawVessel` against the bank's `faceStats`) with a level bar at its
     left edge; with no stats (under four faces) the bar alone;
   - monitoring off, with a headphones note; *done*: MONITOR, off on every
     load and never saved, USE HEADPHONES under it and in its toast;
   - the clip on first listen (task 3's web half); *done*: 6 s of the voices'
     input once it carries a signal, sent as `set_audition_clip`; NEW CLIP
     captures again. One clip for every input (a clip per input stays open);
   - the farm's phrase re-sent after a capture and after a restore that
     installs a clip; *done* (`farmResendPhrase`);
   - **held sounds** (task 6); *done* (the second web PR): the pool's tab
     lists them at its foot under *kept safe*, each with the engine's
     sentence and RECORD AGAIN, which records the sound from its saved term
     (`held_sounds` now carries it and the capture's key,
     `PatchTree::lost_take_key`) on an instrument of its own, lending the
     input it reads, and sends the take to `readmit_held`. It does not open
     the sound on the bench: a held sound is not in the pool, and the bench
     opens pool sounds;
   - **TRACK live** (task 5); *done* (the second web PR): one tracked voice.
     A patch with a TRACK builds its open voice as the lead and the keys'
     voices as followers (`compile_follower`), fed the lead's tracked
     signals frame by frame (`CompiledVoice::read_tracks`); the lead is
     opened by its tracker's gate, not held like a key, so keys over a sung
     line stop with their keys instead of stacking;
   - **the rail and the plates for TRACK and CAPTURE**; *done*: TRACK in
     DYNAMICS (its default listen branch an AUDIO IN, so placing it asks for
     an input), CAPTURE in SPACE with RECORD and its take's length on
     its plate (`takes.js`);
   - **AUDIO IN in the prior.** *Decided* (2026-10-02): not turned on. It
     is a player kind like TRACK and CAPTURE (task 2): never drawn, scored
     finite, so a player's listening patch is bred and no draw moved (no
     revalidate, perform-wirings or boot probe owed). ⚡ and generations walk a
     listening seed, on the farm as on the engine, with the session's clip
     and the seed's takes.

   Constraints the engine half leaves for this task:
   - **Re-send the farm's phrase** after a capture *and* after any restore
     that installs a saved clip. The farm handshake runs before the staged
     restore, so until it is re-sent every farm render of a listener carries
     the old clip's key. The engine stays correct without it (a fill measures
     such a draw itself, a restore's entry falls back to `bank_render`), but
     each one costs a serial render on the engine's worker.
   - **The walk context carries the phrase**, clip included (about 600 KB of
     JSON with a capture), and goes with every walk job. `farm_walk` reuses
     its parsed context only while the text matches, so each job costs the
     message and a full-text compare, and each new generation a re-parse.
   - **The worklet's input view** into wasm memory must re-check
     `view.buffer !== wasm.memory.buffer` every quantum and re-make the view
     when memory has grown, as the output view does.
   - `LivePoly`'s input stream is built in `LivePoly::new`, which the worklet
     calls in its port handler (`port.onmessage`), never in `process()`.
5. **Track** (pitch by YIN, gate, level) in quiver and the grammar. Play the
   patch from a voice or an instrument. quiver's half is done (`PitchTracker`,
   0.4.0). *Done* (engine):
   - `AudioNode::Track { band, sensitivity, dynamics, /0 played, /1 followed }`,
     `#op` 20, compiled to `PitchTracker` on `/1`. While `/0` is built the
     tracker's pitch and gate stand in for the keys', so everything in the
     played branch follows the input; its gate is summed into the amp gate
     (either one opens the voice); `dynamics` sets how far the level shapes
     `/0`. Outside `/0` the keys play as before;
   - described as `track`, "track", with "band", "sensitivity", "dynamics";
     `NodeKind::Track` in #90's checklist (the default `/1` is an AUDIO IN);
   - a **player kind**: `OpKind` never draws it and scores it finite
     (`PLAYER_OP_MASS`), so draws, the pool and φ are unchanged and no
     revalidate is owed, while a player's tracked sound stays evolvable
     (its AUDIO IN scores finite too, as a player kind at `#src`);
   - every walk holds its `#op` (`PatchTree::player_sites`), so the node,
     the chain it plays and the input chain it follows stay;
   - rendered on the reference clip, it plays the figure's notes (thirteen of
     fourteen within 1.4 cents; one over a ringing note, 17 cents).
   - Live: *done* (task 4's second web PR). The open voice tracks, and the
     keys' voices follow it and stop with their keys, so their amps keep
     their own gates and a stolen voice re-gates as any key's does. Measured
     in the browser (`audio_in_takes.spec.js`) and natively
     (`a_tracked_patch_has_one_tracked_voice_and_the_keys_do_not_stack`).
6. **Capture** (record and play back) in quiver and the grammar. A captured
   buffer is saved with the sound. quiver's half is done (`Capture`, 0.4.0,
   which saves its take with the patch). *Done* (engine):
   - `AudioNode::Capture { play, /0 recorded, take }`, `#op` 21, compiled to
     quiver's `Capture` holding the take, played by the keys (once, hold,
     loop) at the keys' pitch; its output is the take, never `/0`;
   - the take (`auracle_grammar::Take`) is saved in the term as quiver's own
     state (`f32le-base64`, lossless), bounded like `SavedClip`: rate at most
     192 kHz, length at most `TAKE_SECONDS` (4 s, quiver's default buffer) at
     that rate, the data's length checked before it is decoded. An
     unreadable take loads empty with the sound intact and counts as a
     repaired sound on restore;
   - the compiled voice has a record gate per capture and `take(key)` reads
     the recording back; `StructOp::SetTake` puts a take in the term through
     the existing `edit_structure` binding. A render never records;
   - a player kind, like TRACK; walks hold its `#op`, never propose a take
     (it is not a trace site), and carry it onto every term they score.
   - a sound whose only source was a take that couldn't be read is **held**:
     restore keeps it out of the pool (never dealt, fitted, mapped, wired or
     bred), reports it apart from the repairs, and the app says "One sound's
     take couldn't be read. It's kept safe until you record it again."
     once per set of such sounds; a save writes its take back JSON-equal to
     what was loaded; `Engine::readmit_held` (wasm `readmit_held`) brings it
     back with a readable take, measured as a new sound;
   - a recording stops at `TAKE_SECONDS` at the voice's rate
     (`RecordWindow`), so it always reads back as a take.
   - Live: *done* (task 4's second web PR): `LivePoly::set_record` and
     `take_json`, RECORD on the plate (an instrument of its own in the
     worklet, the take sent as `set_take`), and the held sounds in the bank.
7. **The guide and the reference:** a guide page on playing through Auracle,
   and a reference section on audition clips (ADR-004). The reference section
   is *done* (*Audition clips*, with the AUDIO IN term on the grammar page),
   and so is the guide page (*Playing through Auracle*, with task 4).

## Done when

- A player can add AUDIO IN, pick an input, hear it processed, modulate with it,
  play the patch with it, and capture it.
- A generation can breed a patch with an input, using its audition clip.
- quiver's new modules have tests and a release, and Auracle depends on it.
