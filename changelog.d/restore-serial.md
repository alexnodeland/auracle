### Fixed: coming back with no render workers goes sound by sound, with the bar moving

- **Coming back to a session without render workers no longer sits on one
  line.** With none (a machine with few cores, `?farm=0`, or workers too slow
  to start), the engine brought all your sounds back in one go, rendering
  each again and saying nothing until the last: 40 sounds took 15 s in
  Firefox on a busy M-series laptop, on *restoring your bank & taste…* the
  whole time, and over two minutes on an older Intel MacBook Air. Now it
  brings them back one at a time, the bar counting them (*recalling 12 of 40
  sounds…*), and keeps what it renders. A sound this browser has measured
  before is read back rather than rendered: the first such return took about
  as long as before (11 to 15 s here), and the next took 0.6 s (#285).
- **Sounds the render workers measured come back without them too.** The
  workers kept no record of the first eight sounds they rendered, the ones
  you hear first, so a visit without workers rendered those eight again.
- **Render workers slow to start join the boot.** The engine waits five
  seconds for one to be ready. A worker ready a moment later used to sit out
  the whole boot; now the engine starts on its own and hands the rest to each
  worker as it's ready.
