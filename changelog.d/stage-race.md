### Fixed: stage mode stays on when you leave it and come straight back

- **⇧F to leave stage mode and ⇧F straight back now leaves it on.** The
  browser takes the whole screen back in its own time (on a Mac, after its
  animation), and a stage opened again before it had finished was closed by
  the exit of the one before, a moment after it appeared. Now the new stage
  waits for that exit, then asks for the whole screen again, and stays
  (`perform_stage.spec.js`, #575).
- **Leaving stage mode before the screen has filled hands the screen back.**
  ⇧F twice in quick succession left the window on the whole screen with no
  stage on it. Now the screen is handed back as soon as the browser has
  filled it.
