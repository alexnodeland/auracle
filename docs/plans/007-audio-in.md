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
   - prior weight 0 for now (`AUDIO_IN_WEIGHT` in `prior.rs`), so no fill or
     walk draws one and every seed deals the pool it dealt before the term.
     Before the app can capture, a drawn listener would be heard as the
     reference pluck in a duel or the bank and as silence from the keys and
     PERFORM, on a plate the player cannot use. Task 4 turns it on at
     `AUDIO_IN_ENABLED_WEIGHT`, Silence's 0.5%, untilted by taste
     (`PatchGrammarPrior::with_audio_in` is that prior, and the tests reach the
     term through it);
   - every walk locks each `#input` its seed holds, so the node and its input
     stay;
   - φ keeps its shape: a display counter, `n_audio_in`, and no column.
   - Open: the node bank entry, the device list and the face are task 4's,
     and so is turning the weight on (see task 4).

   The paired `make revalidate` measured the prior **at 0.5%**: before is
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
   - capturing a few seconds on first listen; *open*, the web half (task 4).
     The engine takes a capture through `WasmEngine::set_audition_clip` and
     the worker's `set_audition_clip` message;
   - storing clips with the session; *done*: one session clip, saved as 16-bit
     base64 and bounded like quiver's `Capture`; an unreadable one restores as
     the reference and says so;
   - `featurize`, the vet, and walks rendering with them; *done*: the clip
     rides in `PhraseSpec`, a listening patch renders on a host-clock stream,
     its render key (and so the farm's stored key, and PERFORM's wiring key)
     carries the clip, and `LivePoly` binds a cursor-mode input stream. A
     fill's farm result for a listener measured under another clip (or vetted
     out under one) is measured on the engine instead (`Engine::absorb_prior`),
     and a restore's falls back to `bank_render`. Open: re-sending the farm's
     phrase (task 4), and a clip per input.
4. **Web capture:**
   - the permission flow, only when a node is added;
   - `enumerateDevices`, and one capture stream per input fanned out to every
     node that uses it;
   - the live worklet's input;
   - the AUDIO IN plate: device select, level meter, live face;
   - monitoring off, with a headphones note;
   - **held sounds** (task 6), owed: a bank surface for the sounds a restore
     kept aside because a CAPTURE's recording couldn't be read
     (`held_sounds`), which opens one on the bench to record it again and
     sends the take (`readmit_held`); both are wired in `worker.js` with
     nothing asking yet, and the restore's note says so once per set;
   - **TRACK live**: a key let go while the input still sounds holds its
     voice open (the tracker's gate is summed into the amp's), so voices can
     stack while the player plays keys over a sung line, each a copy of the
     tracked note. The audition render's chord voices are followers that
     stop with their key; `LivePoly` has no follower yet;
   - **turning AUDIO IN on in the prior** once a player can hear a live input:
     set `AUDIO_IN_WEIGHT` to `AUDIO_IN_ENABLED_WEIGHT`. The revalidation in
     task 2 measured exactly that setting, so if nothing else has changed it
     owes no new run; it does owe `make perform-wirings` and a re-pinned boot
     probe (`UPDATE_BOOT_PROBE=1`, `crates/auracle-wasm/tests/boot_agrees.rs`),
     because the pool a seed deals moves.

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
     (once AUDIO IN is on: while its weight is 0, an AUDIO IN under a
     TRACK still scores −∞);
   - every walk holds its `#op` (`PatchTree::player_sites`), so the node,
     the chain it plays and the input chain it follows stay;
   - rendered on the reference clip, it plays the figure's notes (thirteen of
     fourteen within 1.4 cents; one over a ringing note, 17 cents).
   - Open: live, `LivePoly` runs a voice only while a key is held, so a
     tracked patch sounds from the input alone once the web task keeps a
     voice running for it (and a tracker holding the gate defeats the
     stolen-voice regate); the node bank entry and the plate.
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
     recording couldn't be read. It's kept safe until you record it again."
     once per set of such sounds; a save writes its take back JSON-equal to
     what was loaded; `Engine::readmit_held` (wasm `readmit_held`) brings it
     back with a readable take, measured as a new sound;
   - a recording stops at `TAKE_SECONDS` at the voice's rate
     (`RecordWindow`), so it always reads back as a take.
   - Open: `LivePoly`'s record and read-back bindings and the record control,
     and showing held sounds in the bank (task 4).
7. **The guide and the reference:** a guide page on playing through Auracle,
   and a reference section on audition clips (ADR-004). The reference section
   is *done* (*Audition clips*, with the AUDIO IN term on the grammar page);
   the guide page waits for task 4.

## Done when

- A player can add AUDIO IN, pick an input, hear it processed, modulate with it,
  play the patch with it, and capture it.
- A generation can breed a patch with an input, using its audition clip.
- quiver's new modules have tests and a release, and Auracle depends on it.
