### Fixed: a face lighting up no longer slows your keys in Firefox

- **The glow over the face of the sound you're playing is drawn in the
  background where drawing it slows the page.** In Firefox, each frame of
  it took the page 2 ms on a fast machine, and 7 ms on a Retina screen, up
  to two fifths of the page's time while you held a key at PERFORM, and your
  next note, a knob's turn and the pointer waited behind it. The app now
  times its own drawing of a face while the page is idle, before you play
  anything. Where a frame of it takes the page longer than 2 ms (in
  Firefox), the faces are drawn in the background from the first sound you
  play, no frame of the glow is drawn by the page first, and the page spends
  under a millisecond a frame on them: each frame is the same picture, shown
  one frame after it was heard on a fast machine, and two or three frames
  after on a slow one. Where it takes less (in Chromium, which only notes
  what to draw and draws it once the page's own work for the frame is
  done), the faces are drawn as before, in the very frame that heard the
  sound, and go to the background only if their drawing gets slower as you
  play (`live_faces.spec.js`). Chromium on a machine whose graphics card it
  doesn't use draws a canvas in software, and that drawing still costs the
  page after its own work, which the app does not see yet (#569).
