### Fixed: an opened patch file gets a guess when it has room

- **A patch file that holds a module doing nothing now opens without it, and
  the guess offers a module for it.** A file written by an older build could
  hold a modulation module with nothing plugged into it (a quantize with no
  modulator feeding it, say), which does nothing to the sound. It came into
  the pool as it was, every module the guess could add would also have taken
  it away, and so PATCH said *no guess: nothing more fits, so a module has to
  come out first* on a patch with room. Now the sound arrives without the
  module that did nothing, and the guess offers what it would offer on that
  patch
  (`an_imported_patch_not_in_normal_form_gets_the_guess_its_normal_form_gets`,
  #208).
- **A saved session with such a module loads without it and sounds the
  same.** The restored sound plays sample for sample what it played before,
  and the note that says what was repaired on load counts it, since a module
  you could see on the rack is gone
  (`a_saved_sound_not_in_normal_form_restores_folded_and_sounds_the_same`).
