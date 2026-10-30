### Fixed: the bank, ⚡ and EVOLVE's pair no longer move what you're reaching for

- **The bank's rows stay put under your pointer.** Each child of a
  generation landed at the top of the bank and pushed every row below it
  down, up to ten times a generation, so a click aimed at one row's cut or
  save could land on its neighbour. A generation's end, the pool filling and
  a refit's new order under the model view moved the rows the same way. Now
  they wait while your pointer is over the bank, a finger is on it, or you
  are stepping through it with the arrow keys, and land when you move off it
  or rest for a second, the rows gliding to their places while the one under
  your pointer stays where it is.
- **A click on the bank is never lost to a knob.** Every knob you turned
  rebuilt the whole bank when the engine answered, sixty rows of presets
  included, and a click pressed just before that answer and released after
  it did nothing. A knob's answer now rebuilds no row, and the bank never
  redraws between a press and its release. A row that does redraw keeps the
  focus on the ▶ that had it, and a preset's ▶ that is playing keeps its
  mark.
- **⚡'s child no longer replaces the sound in your hands.** It opened by
  itself unless you had edited, even over a sound you had opened since or
  notes you were holding. Now it opens itself only when you're still on the
  sound ⚡ started from, you haven't opened another, and nothing is
  sounding. Otherwise it waits at the top of the bank, and its
  toast says why with **OPEN IT**.
- **A generation's end no longer swaps the pair you're about to pick.** When
  it replaced one of the two sounds on EVOLVE's cards, another pair went up
  under your pointer. Now the pair stays: the replaced sound's card says so
  and its ▶ goes off, and your next pick (which can't teach anything about a
  sound that's gone, and says so) or **ANOTHER PAIR** puts up the next pair.
