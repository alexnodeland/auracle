---
title: "Audio in: one source node, measured with an audition clip"
number: 15
status: accepted
author: Claude Code
created: 2026-09-30
originating_proposal: 8
superseded_by: null
---

# ADR-015: Audio in

## Status

Accepted

## Context

The maintainer decided what audio in is for (RFC-006, rounds 3 and 4): process,
modulate, play the patch, and resample. The decisions also allow several inputs,
with device selection, and one input to many nodes. Taste and evolution need a
repeatable render, and a live input is not repeatable
([RFC-008](../proposals/008-audio-in.md)).

## Decision

- **An AUDIO IN term** is a source. Its use comes from where it is patched:
  - into effects to process;
  - into `Follow` to modulate;
  - into a new **Track** module (pitch, gate, level) to play the patch;
  - into a new **Capture** module (a recorded buffer) to resample.
- **Each AUDIO IN node is measured with an audition clip:** a few seconds
  captured from its input, or a built-in reference signal before then. Taste,
  the vet, the map and the walks all use it.
- **The input device belongs to the player.** A walk never changes it.
- **The DSP lives in quiver:** `AudioInput` (block-fed, multichannel), `Track`
  and `Capture`. The node kinds live in the grammar, the measuring in the
  features, the bindings in wasm, and capture in the web app.
- **Monitoring starts off.** Audio never leaves the browser.

## Options Considered

### Option 1: quiver's `ExternalInput`, set once per sample

Too fragile at audio rate, with no channels. Rejected.

### Option 2: A mode switch on one node

Patching expresses the same uses composably. Rejected.

### Option 3: A source node, the uses by patching, measured with an audition clip (chosen)

It costs three quiver modules and a quiver release.

## Consequences

- quiver gets a release, and Auracle moves its dependency. How it is published
  waits for the maintainer.
- Saved sounds with a Capture carry their audio.
- [Plan-007](../plans/007-audio-in.md) builds it.
