### Fixed: a toast no longer lands on EVOLVE's foot, or on the top of a level on a phone

- **After a pick, EVOLVE POOL and *what each generation did* can be
  pressed at once.** The pick's toast (*Picked Glass Pad over Soft Wash.*,
  with **NOT WHAT I MEANT**) landed on EVOLVE's foot, over both, for its
  seven seconds, after every pick. On PERFORM a toast covered rows of
  **UNDER THE HOOD**, and on a smaller screen the levels' bottom stop. A
  toast now stands where nothing is pressed: in free space near the bottom
  right, or over a picture (the foot of an EVOLVE card's well, above its
  **PLAY** and **PICK**; the floor of PERFORM's well), clear of every
  button, knob, pad and level's title at every window size but one, PERFORM
  with the keys up on a small phone (below). When the XY pad or a panel
  opens under a toast, it moves clear, but not while your pointer rests on
  it: then it stays put until you move off (`toasts_keep_clear.spec.js`,
  #517).
- **On a phone, a toast no longer covers the top of the level.** The banner
  stood just under the menu bar, over PERFORM's share button and the place
  where **KEEP** and **BACK** come up after you turn a knob, EVOLVE's pips
  and its small TASTE map, and each level's title. It now stands in the
  free band nearest the foot of the level (on PERFORM, over the floor of
  the well, under the sound's face), and on EVOLVE under the cards' corners,
  away from the thumb that swipes a card up to pick it. On a phone on its
  side the toast fits itself inside PERFORM's well. With the keys up on a
  small phone PERFORM has no room left at all, and a toast there stands
  over the foot of the knobs, their middles still free to turn. Its **+1**
  keeps to its words' row where the row has room, rather than taking a row
  of its own. A swipe up still puts it away.
- **Where PERFORM has no other room for a toast, the first-steps pill steps
  aside.** On a small phone, or with the XY pad or HOW IT WORKS filling the
  well, the pill goes unseen while the toast stands in its place, and comes
  back, **×** and all, when the toast goes. A screen reader still hears a
  step that comes up meanwhile.
