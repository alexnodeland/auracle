### Fixed: PERFORM's first steps and a control's sweep by ear

- **The first steps no longer ask for a turn no control can make.** On a
  sound none of PERFORM's controls reach (every one of them amber), the pill
  at the bottom left kept asking you to turn a control, and since no turn
  there counts, it never moved past that step. Now it leaves that step out
  on such a sound, its pip too, and asks for it again on a sound one of the
  controls turns (#480).
- **A control you hear by ear ends where it began.** <kbd>Enter</kbd> on a
  control, a long press with a mouse, and **HEAR IT** sweep it to both ends
  and back. If the instrument finished measuring the sound during the sweep,
  that measurement could fold the sweep's turn into the sound, and the sweep
  then left it somewhere you never put it. A measurement now waits for the
  sweep to end, as it waits while your hand is on a control, and the sound
  is where it was. <kbd>Enter</kbd> again while it plays starts it over,
  where it used to start a second sweep that ended wherever the first had
  got to, and pressing the control stops the sweep and puts the control back
  where it was (#481).
