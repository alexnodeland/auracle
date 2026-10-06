### Fixed: faces in PRESETS, and IN POOL beside its ▶

- **One render of a sound's face reaches every place waiting for it.** A
  preset's row, that preset's row in the pool and the sound you're playing
  can wait on the same render. Only the first to ask was answered, so the
  others kept an empty face for the rest of the session, and a preset row
  scrolled out of view could take the face away from the rest. Now each one
  gets it, and a row that leaves the view lets go of its own ask only
  (`worker-faces.test.mjs`, `faces_presets.spec.js`, #130, #153).
- **A preset row's IN POOL and its ▶ both read whole.** Hearing a preset
  puts it in the pool, and its row then said IN POOL under its ▶ while it
  played or kept the focus, cut by it. IN POOL now stands just left of the
  ▶ whenever the ▶ shows, at every window size, and the name stays where it
  is. On a touch screen, where the ▶ is under the name, IN POOL stays at the
  row's end (`bank_row.spec.js`, #130).

### Fixed: the model view's Esc, subtitle and leans

- **Esc closes the nearest thing first at every level, and a tapped model
  view goes last.** In PATCH one press closed one thing and the view
  outlasted it, but elsewhere the same press that put PERFORM's XY or How
  it works away, closed the ? card, the scope or picture panel, or a
  sound's card on TASTE's map also ended the view. A press that folded a
  bank row's ★ took a second thing with it at every level: the view, or in
  PATCH the module you had selected. In PATCH so did a press that closed
  the scope or picture panel: it put down the module you had selected, or
  ended a new patch, and the scope panel left the keyboard focus nowhere
  rather than on ⋯. A press that closed KEYS ⋯ over a new patch ended the
  new patch too, and so could one that closed another menu, the SET ASIDE
  shelf or TEACH over it. After a press on HOW IT WORKS, Esc didn't put the
  face back at all (`model_view_esc.spec.js`, `patch_keys.spec.js`, #153).
- **Under the model view, a new patch's subtitle and sound A's in TEACH
  follow the belief line after a "·".** They were written as one bare
  line, so a new patch read *nothing to rate: no source reaches the output*
  and *0 modules · nothing to hear yet* run together (`patch_model_view.spec.js`,
  #153).
- **A patch's leans, its worth chips and a selected module's note read the
  same style.** The leans read your largest style and the chips the one
  that rates the patch highest, so a solid chip could sit under *no settled
  lean on anything in this patch yet* (`patch_model_view.spec.js`, #153).
- **The ✕ that takes the guess back to the output's sits beside the
  guess's line, not in it,** so a screen reader no longer reads its label
  each time the line changes (`patch_facts.spec.js`, #153).
