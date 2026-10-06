### Fixed: the cable into the amp stays a curve while the amp slides

- **The cable into the amp stays a curve all the way through a slide.** When
  a change to the patch slid the amp past the module plugged into it
  (inserting a module before the amp, or ⌘Z or BACK TO after NEW PATCH), the
  cable took a right-angle run below both modules for the first half of the
  slide or more, then jumped to a curve as the amp came out from behind. Its
  shape is now decided by where the modules come to rest, so it bends with the
  amp instead (`patch_motion.spec.js`, #228).
