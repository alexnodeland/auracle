---
title: "Audio in: quiver to the plate"
number: 7
status: active
author: Claude Code
created: 2026-09-30
updated: 2026-10-01
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
   in the prior. Walks never change `input`. *Done* (engine):
   - `AudioNode::AudioIn`, source index 7, compiled to quiver's `AudioInput`
     on the stream `compile_with_input` binds (`compile` leaves it silent);
   - `input` a slot (1 to 8) the prior never chooses (`PlayerInput`: drawn
     nodes read slot 0, every slot scores alike), `gain` −24 to +12 dB and
     live, `channel` left, right or both;
   - described as `audio_in`, "audio in", with `NodeKind::AudioIn` in the
     edit vocabulary;
   - Silence's 0.5% prior weight, untilted by taste;
   - every walk locks each `#input` its seed holds, so the node and its input
     stay;
   - φ keeps its shape: a display counter, `n_audio_in`, and no column.
   - Open: the node bank entry, the device list and the face are task 4's;
     `make revalidate` for the prior change is paired with this branch.
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
     carries the clip, and `LivePoly` binds a cursor-mode input stream.
     Open: re-sending the farm's phrase after a capture, and a clip per
     input.
4. **Web capture:**
   - the permission flow, only when a node is added;
   - `enumerateDevices`, and one capture stream per input fanned out to every
     node that uses it;
   - the live worklet's input;
   - the AUDIO IN plate: device select, level meter, live face;
   - monitoring off, with a headphones note.
5. **Track** (pitch by YIN, gate, level) in quiver and the grammar. Play the
   patch from a voice or an instrument. quiver's half is done
   (`PitchTracker`, 0.4.0).
6. **Capture** (record and play back) in quiver and the grammar. A captured
   buffer is saved with the sound. quiver's half is done (`Capture`, 0.4.0,
   which saves its take with the patch).
7. **The guide and the reference:** a guide page on playing through Auracle,
   and a reference section on audition clips (ADR-004). The reference section
   is *done* (*Audition clips*, with the AUDIO IN term on the grammar page);
   the guide page waits for task 4.

## Done when

- A player can add AUDIO IN, pick an input, hear it processed, modulate with it,
  play the patch with it, and capture it.
- A generation can breed a patch with an input, using its audition clip.
- quiver's new modules have tests and a release, and Auracle depends on it.
