### Fixed: a face lighting up no longer slows your keys in Firefox

- **The glow over the face of the sound you're playing is drawn in the
  background where drawing it slows the page.** In Firefox, each frame of
  it took the page 2 ms on a fast machine, and 7 ms on a Retina screen, up
  to two fifths of the page's time while you held a key at PERFORM, and your
  next note, a knob's turn and the pointer waited behind it. The app now
  times its own drawing of the faces. While a frame of it takes the page
  less than 2 ms (in Chromium, which draws it on the graphics card), the
  faces are drawn as before, in the very frame that heard the sound. Once
  it takes longer (in Firefox, about a sixth of a second into the first
  sound you play), the faces are drawn in the background from then on, and
  the page spends under a millisecond a frame on them: each frame is the
  same picture, shown one frame after it was heard on a fast machine, and
  two or three frames after on a slow one (`live_faces.spec.js`).
