### Fixed: a measurement no longer moves a PERFORM control under your hand

- Turn a control in PERFORM while the sound is still being listened to, and
  hold it: when the measurement lands, the control stays where your hand is.
  It used to jump back to 12 o'clock under the pointer, and the sound jumped
  with your next move.
- The same holds for the XY pad, for a wiring read back from earlier, and
  for a Take's own measurement. What lands waits until you let go, and a
  second and a half more.
- While a control waits for your hand like this, it says *after you let go*
  instead of *listening…*, since nothing is being listened to any more.
  Pressing a pad does not count as a hand on the controls: a sound you open
  right after still plays at once.
