---
title: "Audio in: quiver to the plate"
number: 7
status: active
author: Claude Code
created: 2026-09-30
updated: 2026-09-30
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

1. **quiver `AudioInput`.**
   - Block-fed and multichannel, with a host API to write each block before
     processing.
   - Tests at block boundaries and with mismatched block sizes.
   - A quiver release: how it is published waits for the maintainer (RFC-008,
     Open 1). Until then, a path dependency on a branch, for local work only.
2. **The AUDIO IN term:** knobs (`input`, `gain`, `channel`), `describe`, rare
   in the prior. Walks never change `input`.
3. **Audition clips:**
   - a built-in reference signal;
   - capturing a few seconds on first listen;
   - storing clips with the session;
   - `featurize`, the vet, and walks rendering with them.
4. **Web capture:**
   - the permission flow, only when a node is added;
   - `enumerateDevices`, and one capture stream per input fanned out to every
     node that uses it;
   - the live worklet's input;
   - the AUDIO IN plate: device select, level meter, live face;
   - monitoring off, with a headphones note.
5. **Track** (pitch by YIN, gate, level) in quiver and the grammar. Play the
   patch from a voice or an instrument.
6. **Capture** (record and play back) in quiver and the grammar. A captured
   buffer is saved with the sound.
7. **The guide and the reference:** a guide page on playing through Auracle,
   and a reference section on audition clips (ADR-004).

## Done when

- A player can add AUDIO IN, pick an input, hear it processed, modulate with it,
  play the patch with it, and capture it.
- A generation can breed a patch with an input, using its audition clip.
- quiver's new modules have tests and a release, and Auracle depends on it.
