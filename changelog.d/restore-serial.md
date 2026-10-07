### Fixed: coming back with no render workers goes sound by sound, with the bar moving

- **Coming back to a session without render workers no longer sits on one
  line.** With none (a machine with few cores, `?farm=0`, or workers too slow
  to start), the engine brought all your sounds back in one go, rendering
  every one again and saying nothing until the last: 40 sounds took 13.6 s
  in Firefox on an M-series laptop, on *restoring your bank & taste…* the
  whole time, and over two minutes on an older Intel MacBook Air. Now it
  brings them back one at a time, the bar counting them (*recalling 12 of 40
  sounds…*), and keeps each one it renders. A sound the render workers
  measured as the app loaded, or that an earlier return measured, is read
  back rather than rendered: in Firefox held to four cores on a busy
  M-series laptop, a return after a visit with workers took 1.1 to 1.7 s,
  where it took 12.5 to 13.1 s. With nothing stored, a return still renders
  every sound, in about the time it took before (11 to 15 s there), and the
  next return took 0.6 s. A sound that joined while you played (a
  generation's, an edit you kept, a patch file you opened) is rendered again
  on the next return (#285).
- **Render workers slow to start join the boot.** The engine waits five
  seconds for one to be ready. A worker ready a moment later used to sit out
  the whole boot; now the engine starts on its own and hands the rest to each
  worker as it's ready.
