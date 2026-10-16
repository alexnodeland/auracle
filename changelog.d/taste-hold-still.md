### Fixed: TASTE and LEARNING no longer move what you're pointing at

- **The map's sounds stay put under your pointer.** When a new map landed
  (the end of a generation, a taste file you opened), every sound on TASTE's
  map slid to its new place over a third of a second, and a click in that
  moment could open whichever sound slid under it; a refit did the same
  while a sound's card was up from the keyboard. Now the glows settle at
  once, and the places wait while your pointer is on the map or a sound's
  card is up, then settle when you move off it or rest for a second. *It
  fitted your taste again* is said when the places move. (A refit that lands
  under your pointer already waited whole.)
- **The track no longer shifts the map.** The first time the track appeared
  along the map's foot, every sound jumped up to make room. Its room is now
  kept from the start.
- **A ▶ pressed while the app updates still plays.** A sound's card on the
  map, and each style's chip in LEARNING, were rebuilt whenever new ratings
  or weights came in, so a press that landed during one was lost. They are
  now updated in place.
- **LEARNING's weights keep their order under your pointer.** A pick's new
  weights re-sorted the rows, so the row under a still pointer changed while
  the small map stayed shaded by the old one. Now only the bars' lengths move
  while you point at them, and the rows slide into their new order when you
  move off them or rest for a second (#315).
