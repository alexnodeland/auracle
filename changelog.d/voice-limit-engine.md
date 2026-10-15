### Fixed: a chord bigger than the keyboard's voices no longer swells after a patch edit

- **Hold more keys than the instrument has voices (five, on its four) and
  change the patch: the notes you hear carry on at the level they were
  at.** Each such edit used to press every held key again on the new
  patch, and the extra keys took voices from each other, so the notes
  that kept sounding dropped out and swelled back from silence, about
  four times as loud, over more than a second
  (`a_pad_held_past_the_voice_limit_keeps_its_envelope_across_a_swap`,
  #320).
