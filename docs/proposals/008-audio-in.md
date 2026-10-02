---
title: "Audio in: your own signal in the patch, measured and bred like any other"
number: 8
status: accepted
author: Claude Code
created: 2026-09-30
updated: 2026-10-01
supersedes: null
superseded_by: null
---

# RFC-008: Audio in

## Audience

- **The maintainer,** who decided what audio in is for in RFC-006's rounds and
  asked for it to be built, updating quiver where needed.
- **Anyone working on quiver, the grammar, the features, the wasm bindings or
  the web app's audio.**

## Context

[RFC-006](006-the-sound-at-the-centre.md) part 8 set the scope, from the
maintainer's decisions on 2026-09-30
([`decisions.md`](../notes/vision-2026-09/decisions.md), rounds 3 and 4).

An AUDIO IN node has four uses:
- **Process:** Auracle as an effect.
- **Modulate:** the input drives modulation.
- **Play the patch:** pitch and dynamics tracking.
- **Resample:** a new source the model can breed.

Other decisions from those rounds:
- There can be several inputs: a node lists the input devices it detects, and
  the same input can feed several nodes.
- The pieces live in layers: DSP in quiver, node kinds in `auracle-grammar`, φ
  in `auracle-features`, bindings in `auracle-wasm`, capture in `apps/web`, and
  the host input in the plugin.
- "Update quiver if you need to."

What exists today:

- **quiver's `ExternalInput`** (`quiver/src/io.rs`) brings a value in from
  another thread through an atomic, read once per tick. It suits a control
  value, not an audio stream: a host would have to set it before every sample.
- **quiver's npm worklet node** has an input since 0.3.3, so its own effect
  patches can be fed. Auracle's live voice is its own worklet
  (`apps/web/live-audio.js`, `EvoVoiceProcessor`), running `LivePoly` per
  sample, and takes no input.
- **The grammar has no input term.** `Follow`, `Duck`, `Gate` and `Vocoder`
  already process a second signal, but only one the patch makes itself.
- **Every patch is measured by rendering a fixed phrase** (`featurize`), and the
  taste model rates what that render sounds like. A live input is neither fixed
  nor repeatable, so it can't be measured as it is.

## Proposal

### 1. One node, many uses

An **AUDIO IN** term in the grammar is a source: it outputs the input signal.
The use comes from where it is patched, not from a mode switch:

| Use | How it is patched |
| --- | --- |
| Process | AUDIO IN into a filter, a delay or any effect chain |
| Modulate | AUDIO IN into `Follow` (the envelope follower), whose output modulates any knob |
| Play the patch | AUDIO IN into a new **Track** module, whose pitch, gate and level outputs play the patch like a keyboard |
| Resample | AUDIO IN into a new **Capture** module, which records into a buffer; the buffer is a new source the patch plays, and the model can breed |

The node's knobs:
- `input`: which input it reads, chosen from the detected devices and
  channels;
- `gain`;
- `channel`: left, right, or both summed.

The same input can feed any number of AUDIO IN nodes: one capture stream fans
out.

### 2. Measuring a patch that listens

Taste and evolution need a repeatable render. Each AUDIO IN node therefore has
an **audition clip**: the signal it is measured with.

- By default, a few seconds captured from its input the first time it is
  heard, stored with the session.
- Before anything is captured, a built-in reference signal, a short, neutral,
  pitched phrase.

The features, the vet, the map and the walks all render with the audition clip,
so a patch with an input is measured, rated and bred like any other.

- **What a walk may change:** a walk may change the node's gain, channel, and
  everything after it.
- **What it may not change:** the input device, which belongs to the player.

**Capture** buffers are a sound's content, saved with it, and the model breeds
the patch around them.

### 3. Where each piece lands

| Layer | Adds |
| --- | --- |
| quiver | `AudioInput`: a block-fed, multichannel input module (the host writes a block before each process call; per sample, it reads its channel). `Track`: pitch (YIN), gate and level from a signal. `Capture`: records a signal into a buffer and plays it back. |
| `auracle-grammar` | The `AudioIn`, `Track` and `Capture` terms, their knobs and ranges, their place in the prior (rare by default), and `describe` names (AUDIO IN, TRACK, CAPTURE) |
| `auracle-features` | Rendering with each node's audition clip; φ unchanged in shape, with the structural features counting the new kinds |
| `auracle-wasm` | Input blocks into `LivePoly`; setting an audition clip; the device and channel list from the host |
| `apps/web` | Capture: `getUserMedia`, `enumerateDevices`, and the live worklet's input; the permission flow; the AUDIO IN plate's device select, level meter and live face; monitoring off by default, with a headphones note |
| The plugin | The host's input buses, later, under its own proposal |

### 4. Safety and privacy

- **Feedback.** A microphone into speakers is a loop, so monitoring starts off.
  The vet already guards levels, and an input's gain is bounded.
- **Privacy.** Audio never leaves the browser. A clip is stored only with a
  saved sound, and only on the player's machine.
- **Permission.** The app asks for an input only when a player adds an AUDIO IN
  node, and says what it is for.

## Sequencing

1. **quiver:** `AudioInput`, with tests at the block boundary.
2. **The AUDIO IN term** and the web capture, for process and modulate (`Follow`
   exists), with the audition clip and the reference signal.
3. **Track,** to play the patch.
4. **Capture,** to resample.
5. **The prior and the walks:** AUDIO IN in generations, rare and never a
   device change.
6. **The plugin's host input,** later, with the plugin's own proposal.

## Alternatives considered

- **`ExternalInput` per sample.** The host would set an atomic before every
  tick, with no block view and no channels. Too fragile at audio rate.
- **A mode switch on one node** (process, modulate, play, resample). Patching
  says the same thing and keeps the grammar composable.
- **Measuring live input.** It isn't repeatable, so taste would chase the room.
  Rejected for the audition clip.

## Consequences

- **quiver gains three modules and a release.** Auracle's dependency moves to
  it.
- **A sound with a Capture carries audio data,** so a saved session grows.
- **The guide gains a page** (playing through Auracle), and the reference gains
  a section on measuring with audition clips.

## Decided

The uses, multiple inputs, device selection, one input to several nodes, and
the layering are the maintainer's (rounds 3 and 4). On 2026-09-30 the
maintainer asked for the functional improvements to be built, updating quiver
where needed. Accepted on that instruction.

## Open

1. **The quiver dependency.** Auracle used `quiver-dsp` 0.3.3 from crates.io,
   so a new quiver needed a release (0.4.0) or a git dependency. Either one is
   published outside this repository, so it waited for the maintainer's word.
   *Answered (2026-10-01):* a release. quiver 0.4.0 is published to crates.io
   (`quiver-dsp`) and npm (`@quiver-dsp/wasm`) from the `v0.4.0` tag, and
   Auracle depends on it from crates.io.
2. **The reference signal:** what neutral phrase measures a patch before its
   input is heard. *Built (2026-10-01):* a plucked figure in A minor
   pentatonic, A2 to E4, with a noise pick on every note and a quiet tail:
   pitched, with transients and broadband content, so what a patch does to an
   input is measured. The reference's *Audition clips* page says why each
   property is there.
3. **Latency** in the browser's worklet path, measured on the machines the films
   use.
