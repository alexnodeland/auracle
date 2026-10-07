### Added: the face of the sound you're playing answers what you hear

- **Play, and the face of the sound lights up wherever it is.** Until now
  only stage mode drew what you hear over a sound's face; everywhere else the
  face was a still picture. Now PERFORM's well, the face at OUT in PATCH,
  the face flying between the levels, the EVOLVE card whose PLAY you
  pressed, and the sound's mark on TASTE's map and LEARNING's ring all do it
  too, at their own size: the outline lights up as loud as the sound is,
  the outline of what you hear right now is drawn over it, and it fades like
  phosphor when the sound stops. A small face, like a mark on the map, only
  brightens its outline.
- **Each face answers its own sound.** With an offer in B, PERFORM's two
  faces each show what you hear of their own sound: at BLEND's home only
  yours, holding B only the offer, and both in between. An EVOLVE card
  answers its own PLAY and never the other card's.
- **It costs little and stops in silence.** Nothing is drawn or measured
  while nothing sounds, and with reduced motion set on your system the
  faces stay still (`live_faces.spec.js`).

### Changed: a sound picked from the bank opens where you are

- **Clicking a row in the bank no longer takes you to PATCH.** A pool sound
  or a preset clicked at PERFORM, EVOLVE, TASTE or LEARNING now opens right
  there, as Enter on a row and ⌘K's sounds already did, and its face flies
  from the row to where that level shows the sound you're playing. ↓ PATCH
  on an EVOLVE card still opens the sound in PATCH (`shell_zoom.spec.js`).
