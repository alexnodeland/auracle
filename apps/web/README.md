# EvoSynth web app

First frontend, built in M5 against `evosynth-wasm`.

- AudioWorklet playback of the current patch (quiver WASM)
- Candidate rendering + feature extraction in Web Workers (never the audio thread)
- Session surfaces, in build order: **duel stream + bench → population grid → radio**

All surfaces emit into the same observation stream; the taste model doesn't
know which one produced an event.
