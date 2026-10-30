### Added: Auracle plays on a phone

- **Every size starts the instrument.** A phone used to meet a screen that
  never started the engine (*Open this on a desktop browser*), and any window
  under 1000 px a notice asking for a wider one. Both are gone: a phone, a
  tablet held upright and a narrow window each get a layout of their own
  (`shell_phone.spec.js`, #134).
- **On a phone held upright the levels are the bar along the bottom.** Each
  stop is named under its icon (LEARNING, TASTE, PERFORM, PATCH, then EVOLVE
  beside them), and a tap goes there. **KEYS** at the bar's end brings the
  keys up over it, one octave across the screen with each key a finger wide,
  and puts them away again.
- **Under 1000 px the bank is a sheet behind BANK.** **BANK**, at the start
  of the menu bar, opens it over the level, from the left, or on a phone from
  the bottom with a handle to pull it down. A sound chosen in it opens and
  the sheet goes; a tap beside it or <kbd>Esc</kbd> puts it away too.
- **Each level is one column on a phone, and scrolls.** PERFORM's sound and
  well come first, then its controls, hood and pads; EVOLVE's cards keep
  **PLAY** and **PICK** under each name; PATCH's head stacks over the well;
  nothing scrolls sideways. On a phone on its side the levels stay at the
  right edge, with **KEYS** under them.
- **A touch screen prints no keys.** The keys beside buttons and the letters
  on the keybed are left off, and PERFORM's first step says to tap the
  keybed, or on a phone to tap **KEYS** first.

### Fixed: a tapped module's sheet presses nothing under the finger

- **Opening a module's sheet with a tap no longer presses what the sheet
  puts under your finger.** On a phone the sheet rises from the bottom, and
  the tap that opened it went on to press whatever came up under it:
  **REMOVE MODULE**, a mode, or a slider (`shell_phone.spec.js`).
