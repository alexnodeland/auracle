### Changed: PERFORM's controls play the moment a sound is in your hands

- A sound you haven't played used to keep its controls silent while
  PERFORM measured it: seconds on a fast computer, and a minute or more on
  a slow one for a sound with many knobs. Its controls now turn at once,
  on a start PERFORM has without rendering anything: a sound with the same
  modules it has already measured, or else what each kind of knob usually
  does, learned from measuring the presets. The status line says
  *listening…* while the sound is measured, and the controls' travel is
  drawn thin and dim until then. When the measurement lands, the controls
  settle on what the sound really does, without moving what you hear.
- A sound you have played before no longer re-measures after every pick:
  its controls go stale only when the model's scale moves.
