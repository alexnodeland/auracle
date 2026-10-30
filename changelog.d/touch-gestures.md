### Added: swipe up to pick, long press to see what the model believes

- **Swipe an EVOLVE card up to pick it.** On a touch screen the card follows
  your finger; let go past a third of its height, or swipe up fast, and it
  is picked exactly as its **PICK** button would pick it, with the same
  moment to take it back. Short of that it settles back and nothing is
  picked. A drag down or sideways is left to whatever scrolls under it
  (`touch_gestures.spec.js`, #134).
- **Long press to see what the model believes.** A long press (about half a
  second, without moving) on an EVOLVE card, a bank row or TASTE's map shows
  the model view while the finger stays down, as holding <kbd>⌥</kbd> does
  on a keyboard. A ring fills under the finger as you press; moving first is
  an ordinary touch, and the long press opens nothing when you lift. No text
  is selected and no callout opens. A module on PATCH's rack keeps its own
  long press, which opens its menu.
