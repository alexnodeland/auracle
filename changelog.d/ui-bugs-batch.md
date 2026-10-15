### Fixed: An unheard Take says it wasn't counted

- Taking an offer in PERFORM before you've heard it makes it your sound but
  teaches the model nothing. It now says so (*Took B. Not counted, because
  you hadn’t heard it.*), as a pass on an unheard offer already did, and the
  first-steps pill's last line says it's an offer you hear, then take or
  pass, that teaches it.

### Fixed: PATCH shows the knobs your velocity plays

- With *Velocity plays* set to a control, soft and hard notes sounded darker
  and brighter, but PATCH's knobs stood still. Now each knob velocity reaches
  shows its amber pointer and readout where the last note you struck plays
  it, its hover names velocity, and it folds back when you let go.

### Fixed: The loading card carries the line, and tells the truth on a return

- The card you see while Auracle starts now carries its tagline and
  descriptor. When you come back to a saved session it reads *restoring
  your bank & taste…*, not the first visit's *you start as soon as the
  first 8 land*: a return opens once your whole session is back.
