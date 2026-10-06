### Fixed: your first pick plays sooner after TEACH IT

- **After you press TEACH IT, your first pick is under your fingers sooner.**
  TEACH IT adds the warm start's nine presets to the pool, and adding a sound
  means rendering it and measuring it: about a quarter of a second each on a
  fast machine, more on a slow one. That used to start when you pressed TEACH
  IT, so your first pick waited for its own render, and for the render the
  engine was in the middle of. Now the nine are measured while you pick, your
  picks first, and TEACH IT adds them from those measurements: the same
  numbers, so what it learns is the same. In Chromium on a 16-core machine
  under load, TEACH IT to your first pick's controls went from 0.40 s to
  0.18 s (the median of eight runs each); on a CI runner it took 1.2 s. The
  rest of the warm start lands sooner too, with no render left to make for a
  preset measured while you picked (`warm_start.test.mjs`, #221).
- **Something you press while the engine is busy in the background waits
  for the one render in progress.** It is measuring PERFORM's controls,
  rendering the next pair, or now the warm start's presets, and two of those
  at once could each slip a render in ahead of what you pressed: TEACH IT
  waited 0.8 s behind three renders on that machine (`worker-lanes.test.mjs`).

### Fixed: the warm start run again starts with nothing picked

- **⋯ › *Re-run the three-pick warm start* lets you pick three new presets.**
  It dealt nine new presets but still held the three you picked the last
  time, so a click on a new one marked nothing, the button read TEACH IT
  anyway, and TEACH IT taught the old three again. Each deal now starts with
  none picked.
