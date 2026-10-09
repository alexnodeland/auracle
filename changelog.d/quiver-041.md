### Changed: sounds render faster, and filter voices cost less

- **Every sound is measured in about a third less time, and a voice with a
  filter ladder costs about half as much to play.** Measuring runs the same
  sound through the audition phrase, whether the bank fills, EVOLVE breeds,
  PERFORM measures a preset or an edit lands, so each of those waits less. On a
  set of eighteen sounds a render took 39% less time in the background, and the
  ladder voice took 48% less of the audio thread (#388). The sound is the same:
  what the model hears moves by less than a billionth of a step.
