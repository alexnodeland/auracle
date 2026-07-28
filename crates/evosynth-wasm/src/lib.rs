//! # evosynth-wasm
//!
//! Thin `wasm-bindgen` bindings over `evosynth-session` for the web app
//! (`apps/web`). The frontend is a shell: AudioWorklet playback of the current
//! patch, worker-based candidate rendering, and the duel/grid/radio surfaces
//! emitting events into the session engine.
//!
//! Inference and rendering never run on the audio thread.

// Bindings land in M5.
