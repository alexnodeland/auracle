### Fixed: a new cable stays a curve while its module slides past its source

- **A cable that comes with a change to the patch stays a curve all the way
  through the slide.** When a change slid a module past the module newly
  plugged into it (inserting a module, which fades in where the next one was
  as that one slides along, or ⌘Z or BACK TO after NEW PATCH, which slide
  the amp back), the new cable took a right-angle run below both modules for
  about half the slide or more, then jumped to a curve as the module came out
  from behind. It now fades in as the curve it ends as, and bends with the
  module as it slides (`patch_motion.spec.js`, #228).
