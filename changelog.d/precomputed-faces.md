### Fixed: faces come at once, on a slower computer too

- **Every preset's face comes with the app.** A preset's face was a render
  the engine made for it only once everything else it had to do was done:
  the bank arriving, PERFORM listening to the sound the app opens with, and
  the warm start's own background work. With the engine slowed to a quarter
  of its speed, as on an older laptop, the warm start's nine faces came
  almost seven minutes after its cards, and the PRESETS rows' nearly four
  minutes after the tab opened. Each preset's face is now rendered ahead of
  time and shipped with the app, so the warm start's cards and the PRESETS
  rows have theirs as soon as they show, without asking the engine
  (`faces_presets.spec.js`, #287).
- **Your bank's faces no longer wait for PERFORM to finish listening.** The
  faces of the sounds in your pool were looked up only once the engine had
  nothing longer to do, so while PERFORM measured the sound the app opens
  with, no face came at all. A face is drawn against your bank, so none
  could be drawn anywhere, the warm start's included. With the engine
  slowed to a quarter of its speed, as on an older laptop, that was two and
  a half minutes after the warm start opened. The engine now answers a face
  it already holds at once (`tests/worker/faces.test.mjs`, #287).
