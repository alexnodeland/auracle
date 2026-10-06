### Added: moving between the levels carries the sound with you

- **A move between PERFORM, PATCH, EVOLVE, TASTE and LEARNING is one
  motion, not a cut.** The level you leave scales and fades, the one you
  reach comes in from the other side, and the face of the sound you're
  playing travels from where one level draws it to where the next does:
  PERFORM's well, the face at OUT, its mark on TASTE's map. Where a level
  doesn't draw it (a sound you have edited has no mark on the map) the face
  fades rather than fly to a place that isn't it, and while a sound is still
  on its way to you the levels simply cross-fade. The level's name slides
  in from the way you went, and a light runs along the levels' stops. With
  reduced motion set, every move is instant (`shell_zoom.spec.js`, #131).
- **Hold ⌥ and turn the wheel to zoom between the levels,** one level a
  turn, anywhere on the stage. Ctrl and the wheel, which is how a
  trackpad's pinch arrives, do the same, except over a patch in PATCH,
  where they still zoom the patch. On a touch screen, spread two fingers to
  zoom in and pinch to zoom out. At either end, the levels nod
  (`shell_zoom.spec.js`, #131).
- **A sound you open from the bank flies from its row into your hands,**
  once it has opened: to the face at OUT in PATCH, or wherever the level
  you're at shows the sound you're playing (`shell_zoom.spec.js`, #131).
- **PERFORM's first steps go on to the levels:** after asking for an offer,
  *Press ⌥↑ to zoom out to TASTE*, then *Hold ⌥ to see what the model
  believes* (`guide_pill.spec.js`, #131).

### Changed: ctrl and the wheel over the stage

- **Over the stage, ctrl and the wheel and a pinch move between the levels
  instead of zooming the page.** Your browser's own zoom (⌘+ and ⌘−, or
  Ctrl + and Ctrl − off a Mac) still works everywhere (#131).
