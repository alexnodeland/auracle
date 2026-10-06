### Fixed: the catalog counts a sound once

- **Under the model view, the catalog's *In 12 of 40 sounds* counts each
  sound once.** It says how many sounds in the pool use a module's family,
  and some modules are one family to the model: the wavefolder,
  distortion, bitcrush and ring mod are one. A sound with two of them was
  counted twice, so on one pool the distortion's card said *In 14 of 40
  sounds* where 11 sounds had any of them. The same count is quoted on a
  plate's lean and on the price of a module in hand, and it decides when
  there are too few sounds to lean yet (under five). All of them now count
  sounds (`support.test.mjs`, #202).
