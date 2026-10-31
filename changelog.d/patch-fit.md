### Fixed: PATCH reads at its fit on every screen, a phone's included

- **A big patch opens at a size you can read, and the rest is a swipe
  away.** The camera used to shrink the whole patch into the well whatever
  that cost: on a phone held upright the seeded session's first sound drew
  its fourteen modules as a thin band across the middle of the well, their
  names under 3 px tall and their sockets 3 px across, and on a 1440 px
  screen its names were under 8 px. Now the fit (on opening, and **FIT** or
  ⇧Home) stops where every module's name is as large as the app's smallest
  text, and a patch that is still too big shows where it starts, with the
  rest past the well's right edge: drag or swipe to it, press the edge's
  *n ›*, or open **MAP** to see it all. Once you've moved the camera over a
  patch that big, an edit leaves it where you put it.
- **Nothing on the rack is drawn too small to read.** Drawn smaller than
  its own size, each module's name prints larger, and the knob labels, the
  readouts and OUT's name step aside before they would print smaller than
  the rack's own smallest type. Every knob is still there to turn.
- **A finger reaches what it needs at the fit.** On a touch screen, each
  module's ⋯ and lock answer a finger 44 px across at any zoom, the face at
  OUT is at least that big, and a tap beside an out ○ picks its cable up,
  as a tap right on it does (`patch_fit.spec.js`, #519).
