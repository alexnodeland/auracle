### Fixed: faces come at once, on a slower computer too

- **Your bank's faces no longer wait for PERFORM to finish listening.** The
  faces of the sounds in your pool were looked up only once the engine had
  nothing longer to do, so while PERFORM measured the sound the app opens
  with, no face came at all. A face is drawn against your bank, so none
  could be drawn anywhere, the warm start's included. With the engine
  slowed to a quarter of its speed, as on an older laptop, that was two and
  a half minutes after the warm start opened. The engine now answers a face
  it already holds at once (`tests/worker/faces.test.mjs`, #287).
