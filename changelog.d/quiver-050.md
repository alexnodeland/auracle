### Changed: sounds measure faster, and every voice costs the audio thread less

- **Every sound is measured in about a third less time, and each voice you
  play costs about a third of what it did.** The engine now runs a sound a
  block of samples at a time instead of one sample at a time, for the same
  samples, bit for bit. Measuring a sound is what the bank's fill, EVOLVE's
  breeding, PERFORM's offers and an edit landing all wait on, so each waits
  less: on a set of eighteen sounds a render took 37% less time. The live
  voices leave far more room on a slow machine before the audio starts to
  struggle, even with an offer playing beside the sound in hand (#397).
- **Sounds with the ladder filter sound very slightly different.** The ladder
  now settles its resonance in one step, which is cheaper. You would be hard
  put to hear it: the largest move in what the model hears is a tenth of the
  spread between sounds, on one preset, and one more of 1,200 random sounds is
  set aside as silent.
