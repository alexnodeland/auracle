### Fixed: the first visit's three picks fit a phone

- **On a phone, SKIP and the button under the nine cards stay on the
  screen.** On a first visit Auracle asks you to pick the three sounds you'd
  reach for, and on a phone held upright the nine cards ran past the bottom
  of the screen with SKIP and **PICK ANY THREE** under them, out of sight and
  with nothing to say they were there. On a phone on its side the card's
  title was cut off above the screen and the buttons below it, and neither
  could be scrolled to. Now the cards scroll, SKIP and the button stay at
  the bottom of the screen, and Tab brings each card and its ▶ into view
  above them (`warm_start.spec.js`, #527).
- **The third pick lights TEACH IT.** The button counts down as you pick,
  and at the third it now lights up amber as well as reading **TEACH IT**,
  so you can see what to press next.
- **A card's ▶ no longer covers the end of its description** on a touch
  screen, and on a phone the first ▶ no longer shows a keyboard's focus ring
  when the cards open.
