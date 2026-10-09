### Changed: the model relearns your taste in about half the time again

- **A refit after many picks takes about half as long, and learns exactly
  what it learned before.** Each of the thirteen thousand small steps a fit
  takes changes one number, and each used to redo all the arithmetic over
  your whole history to judge it; a step now redoes only the part that
  number changes.
  Measured outside the browser on the engine the app runs, a refit after a
  hundred picks went from 436 ms to 202 ms, and a first one from 18 ms to
  12 ms, with the same result to the last bit (#396).
