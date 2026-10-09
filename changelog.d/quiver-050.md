### Changed: sounds measure faster, and every voice costs the audio thread less

- **Every sound is measured in about a third less time, and each voice you
  play costs well under half of what it did.** The engine now runs a sound a
  block of samples at a time instead of one sample at a time, and every sample
  is the same, bit for bit, so nothing sounds or measures differently. Measuring
  a sound is what the bank's fill, EVOLVE's breeding, PERFORM's offers and an
  edit landing all wait on, so each waits less. The live voices leave far more
  room on a slow machine before the audio starts to struggle, even with an
  offer playing beside the sound in hand (#397).
