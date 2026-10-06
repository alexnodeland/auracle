### Added: PERFORM shows which way your taste leans

- **Under the model view, each of PERFORM's controls shows which way your
  taste leans along it, from the sound in your hands.** Hold ⌥ (or press
  and hold MODEL) and an amber arc runs from 12 o'clock toward the end of
  the control your taste leans to, with a thin arc behind it for how far
  that could be off, and the line under the control says it in the model's
  words: *it leans bright*. When the model can't yet tell which way you
  lean, the arc is dashed and faint and the words end in a *?*, as LEARNING
  marks a guess; before the model has learned anything, nothing is drawn.
  The model view showed what the model believes everywhere else (the bank,
  TASTE, EVOLVE, PATCH), but on PERFORM it had nothing to say per control,
  because the engine couldn't say it. It is asked for when the view comes
  up, when the sound in your hands changes, and when a pick or a refit
  teaches the model; turning a control doesn't redraw it
  (`perform_lean.spec.js`, the worker's `lanes.test.mjs`, #140).
