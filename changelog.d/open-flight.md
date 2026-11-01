### Fixed: opening a sound flies one face into your hands, and the well is never empty

- **A sound you open flies in the moment you click.** Opening a sound from
  the bank emptied PERFORM's well for a moment while its name was already
  up, then popped the new face in, and only then flew a second copy of it
  from the row, to land on the first. Now the face leaves its row as you
  click, and the well, and the sound in hand in the menu bar, keep the face
  they had until it lands, then show the new one: never empty, and never
  the face twice. A face on an EVOLVE card you click, or
  open with **↓ PATCH**, flies from the card to the menu bar the same way;
  from PATCH it flies to the menu bar, and the face at **OUT** changes with
  the patch once it has opened. With reduced motion set, the new face takes
  the old one's place with no empty moment (`shell_zoom.spec.js`, #522).
- **TEACH IT puts your first pick's face in the well at once.** After the
  warm start, the well and the menu bar showed no face for up to a second
  and a half, though the cards had just drawn it. They now show it the
  moment you press, from the faces that come with the app
  (`warm_start.spec.js`, #522).
