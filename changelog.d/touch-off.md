### Fixed: what velocity does to a note stays with that note

- **Set *Velocity plays* back to *loudness only*, or to another control,
  and the next note you play sounds where the knobs are.** Each voice used
  to keep its knobs where the last note on it had put them: play soft notes
  with velocity on *bright*, set it to *loudness only*, and the next notes
  on those voices still played dark, until a knob moved. A note you're
  holding when you change it keeps its sound until you let go
  (`a_note_held_through_touch_off_keeps_its_touch_until_let_go`, #223).
- **Turning the control velocity plays moves every note from where its
  knobs were.** A turn's first moment used to pull every voice toward
  wherever one note's velocity had put the knob, so after a soft note with
  velocity on *bright*, turning BRIGHT, or Wander moving it, darkened every
  note for an instant (`a_knob_turned_under_touch_ramps_from_the_knob`,
  #223).
