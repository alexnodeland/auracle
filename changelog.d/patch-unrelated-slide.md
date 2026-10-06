### Fixed: a sound opened in PATCH arrives whole, without the last one's amp sliding across

- **A sound that shares no module with the one before it now fades up where
  it lands.** Every patch ends in the amp, and PATCH took the two amps for
  one: opening Reese over another sound left that sound's modules fading out
  behind Reese, and slid the amp across the rack from where the last sound
  had it, the cable into it routed around Reese's modules on the way. Now
  nothing of the last sound stays on screen and the amp fades up in its own
  place. Changes to one sound still move: insert a module and the amp slides
  along to make room, and NEW PATCH, which keeps the amp, fades out what it
  took as the amp slides over (`patch_motion.spec.js`, #165).
