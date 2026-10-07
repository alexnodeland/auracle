### Fixed: playing on a slower laptop crackles less

- **When the sound starts to fall behind, Auracle protects it.** On a slower
  laptop the sound under your hands could run short and crackle: with an
  offer in PERFORM's B, the instrument played a second set of four voices
  all the time, and the work Auracle does on its own (filling the bank,
  Wander, growing the next offer, a generation) ran beside it. Auracle now
  listens for the sound falling behind, and only while it does, B follows
  your hands in silence with BLEND at home, and that work waits while you
  play and for a second after (after eight seconds of playing it goes on a
  step at a time, so the bank still fills). The things you ask for and wait
  on (an offer you press, a sound you open, What goes here?) go ahead as
  before. On a computer that keeps up, nothing changes (#288).
- **B comes in where its notes would have been.** While it is silent, moving
  BLEND or holding PEEK brings B in about two hundredths of a second later,
  its held notes at the level they would have reached, without starting
  their attack again. A note let go while B was silent has no tail, and a
  modulation envelope in B starts again, which on some sounds is a brief
  brighter blip as B comes in (#288).
