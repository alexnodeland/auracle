### Fixed: changing what velocity plays puts its knobs back

- **Set *Velocity plays* back to *loudness only*, or to another control,
  and the next note you play sounds where the knobs are.** Each voice used
  to keep its knobs where the last note on it had put them: play soft notes
  with velocity on *bright*, set it to *loudness only*, and the next notes
  on those voices still played dark, until BRIGHT, or Wander, moved those
  knobs. A note you're holding when you change it keeps its sound until
  you let go (`a_note_held_through_touch_off_keeps_its_touch_until_let_go`,
  #223).
