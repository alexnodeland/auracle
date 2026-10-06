### Fixed: a new cable stays a curve while its module slides past its source

- **A cable that comes with a change to the patch stays a curve all the way
  through the slide.** When a change slid a module past the module newly
  plugged into it (inserting a module, which fades in where the next one was
  as that one slides along, or ⌘Z or BACK TO after NEW PATCH, which slide
  the amp back), the new cable took a right-angle run below both modules for
  about half the slide or more, then jumped to a curve as the module came out
  from behind. It now fades in as the curve it ends as, and bends with the
  module as it slides (`patch_motion.spec.js`, #228).

### Fixed: a cable's level mark and its words move with the cable

- **What sits on a cable now stays on it while the modules slide.** When an
  edit or a switch of layout slid the modules along, each audio cable's
  level mark stayed where its cable had been as the slide began and jumped
  back onto it as the modules came to rest, and a modulation cable's words
  (*depth 25% · 0.51 Hz*) waited where the cable would end up while the
  cable slid toward them. Dragging a module by hand left its modulation
  cable's words behind until you let go. The marks and the words now ride
  their cables the whole way (`patch_motion.spec.js`, #228).
