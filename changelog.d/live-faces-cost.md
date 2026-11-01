### Fixed: a face lighting up no longer slows your keys in Firefox

- **The glow over the face of the sound you're playing is drawn in the
  background.** In Firefox, each frame of it took the page 2 ms on a fast
  machine, and 7 ms on a Retina screen, up to two fifths of the page's time
  while you held a key at PERFORM, and your next note, a knob's turn and the
  pointer waited behind it. Now the page spends under a millisecond a frame
  on it. Each frame of the faces is the same picture as before, shown one
  frame later than it was on a fast machine, and two or three frames later
  on a slow one (`live_faces.spec.js`).
